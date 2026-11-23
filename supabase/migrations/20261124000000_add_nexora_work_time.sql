/*
# Control de horas trabajadas

Cuenta las horas y minutos de cada persona SOLO cuando inicia sesión desde un equipo autorizado
(la tablet o el PC asignados al restaurante). Desde cualquier otro lugar no se cuenta nada.

- nexora_work_devices: equipos autorizados. El dueño/gerente asigna un equipo desde la app y se genera
  un código secreto que queda guardado en ese equipo. En la base solo se guarda su huella (sha256), nunca el código.
- nexora_work_sessions: una fila por turno de trabajo (entrada, última señal, salida).

Cómo cuenta (la app manda una señal cada minuto mientras está abierta):
- Al entrar desde un equipo autorizado, empieza el turno solo.
- Si la señal se pierde más de 5 minutos, el turno se cierra a la hora de la última señal (no se cuentan horas fantasma).
  Excepción: si la app estuvo abierta todo el tiempo y solo se cayó el internet (continuous = true), el turno sigue,
  hasta un máximo de 6 horas sin señal.
- Al cerrar sesión, el turno termina en ese momento.
- Una persona solo puede tener un turno abierto a la vez; si entra desde otro equipo, el anterior se cierra.

Correcciones: solo propietario y gerente pueden ajustar o agregar un turno, con una nota obligatoria. Queda registrado quién lo hizo.
Cada persona ve sus propias horas; propietario y gerente ven las de todos.
*/

CREATE TABLE IF NOT EXISTS public.nexora_work_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  token_hash text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.nexora_work_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES public.nexora_work_devices(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  end_reason text,
  adjusted_by uuid,
  adjusted_at timestamptz,
  adjust_note text,
  CONSTRAINT work_session_order CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS nexora_work_one_open_session_per_user
  ON public.nexora_work_sessions (user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS nexora_work_sessions_user_started_idx
  ON public.nexora_work_sessions (user_id, started_at DESC);

ALTER TABLE public.nexora_work_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexora_work_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexora_work_devices FROM anon, authenticated;
REVOKE ALL ON public.nexora_work_sessions FROM anon, authenticated;
GRANT SELECT ON public.nexora_work_devices TO authenticated;
GRANT SELECT ON public.nexora_work_sessions TO authenticated;

DROP POLICY IF EXISTS "Managers read work devices" ON public.nexora_work_devices;
CREATE POLICY "Managers read work devices" ON public.nexora_work_devices
  FOR SELECT TO authenticated USING (public.nexora_is_manager());

DROP POLICY IF EXISTS "Read own or managed work sessions" ON public.nexora_work_sessions;
CREATE POLICY "Read own or managed work sessions" ON public.nexora_work_sessions
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.nexora_is_manager());

CREATE OR REPLACE FUNCTION public.nexora_hash_device_token(token_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT encode(sha256(convert_to(coalesce(token_input, ''), 'utf8')), 'hex') $$;

REVOKE EXECUTE ON FUNCTION public.nexora_hash_device_token(text) FROM PUBLIC, anon, authenticated;

-- Asigna un equipo. Devuelve el código secreto UNA sola vez: la app lo guarda en ese equipo.
CREATE OR REPLACE FUNCTION public.create_nexora_work_device(name_input text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
BEGIN
  IF NOT public.nexora_is_manager() THEN
    RAISE EXCEPTION 'Solo el propietario o un gerente puede asignar equipos';
  END IF;
  IF char_length(btrim(coalesce(name_input, ''))) < 2 THEN
    RAISE EXCEPTION 'Ponle un nombre al equipo (mínimo 2 letras), por ejemplo: Caja principal';
  END IF;
  INSERT INTO public.nexora_work_devices (name, token_hash)
  VALUES (btrim(name_input), public.nexora_hash_device_token(v_token));
  RETURN v_token;
END;
$$;

-- ¿Este equipo está autorizado? Devuelve 0 filas si no.
CREATE OR REPLACE FUNCTION public.get_nexora_work_device(token_input text)
RETURNS TABLE(device_id uuid, device_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id, d.name
  FROM public.nexora_work_devices d
  WHERE auth.uid() IS NOT NULL AND d.is_active AND d.token_hash = public.nexora_hash_device_token(token_input)
$$;

-- Señal de vida: inicia o continúa el turno. counting = false si el equipo no está autorizado.
CREATE OR REPLACE FUNCTION public.beat_nexora_work_session(token_input text, continuous_input boolean DEFAULT false)
RETURNS TABLE(session_id uuid, started_at timestamptz, device_name text, counting boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_device uuid;
  v_device_name text;
  v_open public.nexora_work_sessions%ROWTYPE;
  v_new uuid;
  v_started timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión para registrar tus horas';
  END IF;

  SELECT d.id, d.name INTO v_device, v_device_name
  FROM public.nexora_work_devices d
  WHERE d.is_active AND d.token_hash = public.nexora_hash_device_token(token_input);

  IF v_device IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::timestamptz, NULL::text, false;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text, 1));
  UPDATE public.nexora_work_devices SET last_seen_at = now() WHERE id = v_device;

  SELECT * INTO v_open FROM public.nexora_work_sessions s WHERE s.user_id = v_user AND s.ended_at IS NULL;

  IF FOUND THEN
    IF v_open.device_id = v_device
       AND (now() - v_open.last_seen_at <= interval '5 minutes'
            OR (continuous_input AND now() - v_open.last_seen_at <= interval '6 hours')) THEN
      UPDATE public.nexora_work_sessions SET last_seen_at = now() WHERE id = v_open.id;
      RETURN QUERY SELECT v_open.id, v_open.started_at, v_device_name, true;
      RETURN;
    END IF;
    -- Se perdió la señal o cambió de equipo: el turno anterior termina en su última señal.
    UPDATE public.nexora_work_sessions
    SET ended_at = v_open.last_seen_at,
        end_reason = CASE WHEN v_open.device_id IS DISTINCT FROM v_device THEN 'cambio de equipo' ELSE 'sin señal' END
    WHERE id = v_open.id;
  END IF;

  INSERT INTO public.nexora_work_sessions (user_id, device_id)
  VALUES (v_user, v_device)
  RETURNING id, nexora_work_sessions.started_at INTO v_new, v_started;

  RETURN QUERY SELECT v_new, v_started, v_device_name, true;
END;
$$;

-- Cierra el turno al cerrar sesión.
CREATE OR REPLACE FUNCTION public.end_nexora_work_session()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.nexora_work_sessions
  SET ended_at = GREATEST(now(), started_at), end_reason = 'cierre de sesión'
  WHERE user_id = auth.uid() AND ended_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_nexora_work_devices()
RETURNS TABLE(id uuid, name text, is_active boolean, created_at timestamptz, last_seen_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_is_manager() THEN
    RAISE EXCEPTION 'Solo el propietario o un gerente puede ver los equipos';
  END IF;
  RETURN QUERY SELECT d.id, d.name, d.is_active, d.created_at, d.last_seen_at
  FROM public.nexora_work_devices d ORDER BY d.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_nexora_work_device_active(device_id_input uuid, active_input boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.nexora_is_manager() THEN
    RAISE EXCEPTION 'Solo el propietario o un gerente puede cambiar los equipos';
  END IF;
  UPDATE public.nexora_work_devices SET is_active = active_input WHERE id = device_id_input;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese equipo no existe'; END IF;
END;
$$;

-- Reporte de turnos. Cada persona ve los suyos; propietario y gerente ven todos (o los de user_filter).
CREATE OR REPLACE FUNCTION public.get_nexora_work_report(from_date date, to_date date, user_filter uuid DEFAULT NULL)
RETURNS TABLE(
  session_id uuid, user_id uuid, display_name text, role text, device_name text,
  started_at timestamptz, ended_at timestamptz, minutes integer, is_live boolean,
  adjusted boolean, adjust_note text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager boolean := public.nexora_is_manager();
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicia sesión para ver las horas'; END IF;
  IF from_date IS NULL OR to_date IS NULL OR to_date < from_date THEN
    RAISE EXCEPTION 'El rango de fechas no es válido: la fecha final no puede ser anterior a la inicial';
  END IF;
  IF to_date - from_date > 366 THEN
    RAISE EXCEPTION 'Elige un rango de máximo un año';
  END IF;
  v_from := from_date::timestamp AT TIME ZONE 'America/Bogota';
  v_to := (to_date + 1)::timestamp AT TIME ZONE 'America/Bogota';

  RETURN QUERY
  SELECT s.id, s.user_id, COALESCE(p.display_name, 'Usuario'), COALESCE(p.role, ''), d.name,
         s.started_at, s.ended_at,
         GREATEST(0, round(extract(epoch FROM (COALESCE(s.ended_at, s.last_seen_at) - s.started_at)) / 60.0))::integer,
         (s.ended_at IS NULL AND s.last_seen_at > now() - interval '5 minutes'),
         (s.adjusted_by IS NOT NULL), s.adjust_note
  FROM public.nexora_work_sessions s
  LEFT JOIN public.nexora_profiles p ON p.id = s.user_id
  LEFT JOIN public.nexora_work_devices d ON d.id = s.device_id
  WHERE s.started_at >= v_from AND s.started_at < v_to
    AND (CASE WHEN v_manager THEN (user_filter IS NULL OR s.user_id = user_filter) ELSE s.user_id = auth.uid() END)
  ORDER BY s.started_at DESC;
END;
$$;

-- Corrige un turno (ej. se olvidaron de cerrar sesión). Nota obligatoria.
CREATE OR REPLACE FUNCTION public.adjust_nexora_work_session(session_id_input uuid, started_at_input timestamptz, ended_at_input timestamptz, note_input text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
BEGIN
  IF NOT public.nexora_is_manager() THEN
    RAISE EXCEPTION 'Solo el propietario o un gerente puede corregir horas';
  END IF;
  IF char_length(btrim(coalesce(note_input, ''))) < 3 THEN
    RAISE EXCEPTION 'Escribe el motivo de la corrección (mínimo 3 letras)';
  END IF;
  IF started_at_input IS NULL OR ended_at_input IS NULL OR ended_at_input <= started_at_input THEN
    RAISE EXCEPTION 'La salida debe ser posterior a la entrada';
  END IF;
  IF ended_at_input > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'La salida no puede estar en el futuro';
  END IF;
  SELECT s.user_id INTO v_user FROM public.nexora_work_sessions s WHERE s.id = session_id_input;
  IF v_user IS NULL THEN RAISE EXCEPTION 'Ese turno no existe'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.nexora_work_sessions o
    WHERE o.user_id = v_user AND o.id <> session_id_input
      AND o.started_at < ended_at_input AND COALESCE(o.ended_at, o.last_seen_at) > started_at_input
  ) THEN
    RAISE EXCEPTION 'Ese horario se cruza con otro turno de la misma persona';
  END IF;
  UPDATE public.nexora_work_sessions
  SET started_at = started_at_input, ended_at = ended_at_input, last_seen_at = GREATEST(last_seen_at, ended_at_input),
      end_reason = 'corregido', adjusted_by = auth.uid(), adjusted_at = now(), adjust_note = btrim(note_input)
  WHERE id = session_id_input;
END;
$$;

-- Agrega un turno que no se registró (ej. el equipo estaba apagado).
CREATE OR REPLACE FUNCTION public.add_nexora_work_session(user_id_input uuid, started_at_input timestamptz, ended_at_input timestamptz, note_input text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.nexora_is_manager() THEN
    RAISE EXCEPTION 'Solo el propietario o un gerente puede agregar horas';
  END IF;
  IF char_length(btrim(coalesce(note_input, ''))) < 3 THEN
    RAISE EXCEPTION 'Escribe el motivo (mínimo 3 letras), por ejemplo: equipo apagado';
  END IF;
  IF user_id_input IS NULL OR NOT EXISTS (SELECT 1 FROM public.nexora_profiles WHERE id = user_id_input) THEN
    RAISE EXCEPTION 'Elige a la persona';
  END IF;
  IF started_at_input IS NULL OR ended_at_input IS NULL OR ended_at_input <= started_at_input THEN
    RAISE EXCEPTION 'La salida debe ser posterior a la entrada';
  END IF;
  IF ended_at_input > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'La salida no puede estar en el futuro';
  END IF;
  IF ended_at_input - started_at_input > interval '16 hours' THEN
    RAISE EXCEPTION 'Un turno no puede durar más de 16 horas; divídelo en dos';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.nexora_work_sessions o
    WHERE o.user_id = user_id_input AND o.started_at < ended_at_input AND COALESCE(o.ended_at, o.last_seen_at) > started_at_input
  ) THEN
    RAISE EXCEPTION 'Ese horario se cruza con otro turno de la misma persona';
  END IF;
  INSERT INTO public.nexora_work_sessions (user_id, started_at, last_seen_at, ended_at, end_reason, adjusted_by, adjusted_at, adjust_note)
  VALUES (user_id_input, started_at_input, ended_at_input, ended_at_input, 'manual', auth.uid(), now(), btrim(note_input))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_nexora_work_device(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_nexora_work_device(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.beat_nexora_work_session(text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.end_nexora_work_session() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_nexora_work_devices() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_nexora_work_device_active(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_nexora_work_report(date, date, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.adjust_nexora_work_session(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_nexora_work_session(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_nexora_work_device(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_nexora_work_device(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.beat_nexora_work_session(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_nexora_work_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_nexora_work_devices() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_nexora_work_device_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_nexora_work_report(date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_nexora_work_session(uuid, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_nexora_work_session(uuid, timestamptz, timestamptz, text) TO authenticated;
