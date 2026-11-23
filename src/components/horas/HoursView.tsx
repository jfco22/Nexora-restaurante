import { useCallback, useEffect, useMemo, useState } from 'react';
import { MonitorCheck, Plus, X } from 'lucide-react';
import { FormProblem } from '@/components/FormProblem';
import '@/components/equipo/team.css';
import '@/components/horas/hours.css';
import { supabase } from '@/lib/supabase';
import { roleLabels } from '@/lib/staffRoles';
import type { WorkTracking } from '@/lib/useWorkTracking';
import {
  bogotaDate, formatMinutes, fromInputValue, groupReport, sessionProblem, shiftDate, startOfMonth, startOfWeek, todayBogota, toInputValue,
  type DaySummary, type PersonSummary, type WorkRow,
} from '@/lib/workTime';
import { addWorkSession, adjustWorkSession, createWorkDevice, fetchWorkReport, listWorkDevices, setWorkDeviceActive, type DeviceRecord } from '@/lib/workTimeApi';

type HoursViewProps = { isManager: boolean; tracking: WorkTracking };
type RangeKey = 'hoy' | 'semana' | 'mes' | 'rango';
type StaffOption = { user_id: string; display_name: string };

const timeOf = (iso: string): string => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (ymd: string): string => new Date(`${ymd}T12:00:00-05:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'America/Bogota' });
const dateTimeLabel = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' }) : 'nunca');

export function HoursView({ isManager, tracking }: HoursViewProps) {
  const today = todayBogota();
  const [range, setRange] = useState<RangeKey>('semana');
  const [customFrom, setCustomFrom] = useState(shiftDate(today, -6));
  const [customTo, setCustomTo] = useState(today);
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [people, setPeople] = useState<StaffOption[]>([]);

  const { from, to } = useMemo((): { from: string; to: string } => {
    if (range === 'hoy') return { from: today, to: today };
    if (range === 'semana') return { from: startOfWeek(today), to: today };
    if (range === 'mes') return { from: startOfMonth(today), to: today };
    return { from: customFrom, to: customTo };
  }, [range, today, customFrom, customTo]);

  const rangeProblem = !from || !to ? 'Elige la fecha inicial y la final.' : to < from ? 'La fecha final no puede ser anterior a la inicial.' : null;

  const load = useCallback(async (): Promise<void> => {
    if (rangeProblem) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const result = await fetchWorkReport(from, to);
    setRows(result.rows);
    setError(result.error);
    setLoading(false);
  }, [from, to, rangeProblem]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!isManager) return;
    void supabase.rpc('list_nexora_staff').then(({ data }) => {
      if (Array.isArray(data)) setPeople((data as StaffOption[]).map((person: StaffOption) => ({ user_id: person.user_id, display_name: person.display_name })));
    });
  }, [isManager]);

  const summary: PersonSummary[] = useMemo(() => groupReport(rows), [rows]);
  const grandTotal = summary.reduce((sum: number, person: PersonSummary) => sum + person.totalMinutes, 0);
  const daysCount = new Set(rows.map((row: WorkRow) => `${row.user_id}|${bogotaDate(row.started_at)}`)).size;

  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administración</p>
          <h1>Horas trabajadas</h1>
          <p className="muted">{isManager ? 'Las horas de cada persona, contadas solo cuando entra desde un equipo asignado al restaurante.' : 'Tus horas de trabajo, contadas desde el equipo asignado al restaurante.'}</p>
        </div>
        {isManager && <button className="primary-button" type="button" onClick={() => setAdding(true)}><Plus size={16} /> Agregar turno</button>}
      </div>

      {notice && <p className="auth-feedback success team-notice" role="status">{notice}</p>}
      {error && <p className="auth-feedback error team-notice" role="alert">{error}</p>}

      <div className="hours-grid">
        <DevicePanel isManager={isManager} tracking={tracking} />

        <section className="panel hours-panel">
          <h2>{isManager ? 'Horas por persona' : 'Mis horas'}</h2>
          <div className="hours-ranges">
            {([['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['rango', 'Elegir fechas']] as [RangeKey, string][]).map(([key, label]: [RangeKey, string]) => (
              <button key={key} type="button" className={`chip ${range === key ? 'active' : ''}`} onClick={() => setRange(key)}>{label}</button>
            ))}
            {range === 'rango' && (
              <>
                <input type="date" aria-label="Desde" value={customFrom} max={today} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCustomFrom(event.target.value)} />
                <span className="muted">a</span>
                <input type="date" aria-label="Hasta" value={customTo} max={today} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCustomTo(event.target.value)} />
              </>
            )}
          </div>
          <FormProblem message={rangeProblem} />

          <div className="hours-total">
            <div><strong>{formatMinutes(grandTotal)}</strong><span>Total del periodo</span></div>
            <div><strong>{daysCount}</strong><span>{isManager ? 'Días trabajados (suma de personas)' : 'Días trabajados'}</span></div>
            {isManager && <div><strong>{summary.length}</strong><span>Personas</span></div>}
          </div>

          {loading && <p className="muted">Cargando horas...</p>}
          {!loading && !error && !rangeProblem && summary.length === 0 && <p className="muted">No hay turnos registrados en este periodo. Los turnos se registran solos cuando alguien entra desde un equipo asignado.</p>}
          {summary.map((person: PersonSummary) => (
            <details className="hours-person" key={person.userId} open={!isManager}>
              <summary>
                <span className="name">{person.name}{isManager && person.role && <small className="muted"> · {roleLabels[person.role] ?? person.role}</small>}</span>
                {person.live && <span className="hours-live">Trabajando ahora</span>}
                <span className="total">{formatMinutes(person.totalMinutes)}</span>
              </summary>
              {person.days.map((day: DaySummary) => (
                <div className="hours-day" key={day.date}>
                  <div className="hours-day-head"><span>{dayLabel(day.date)}</span><span>{formatMinutes(day.minutes)}</span></div>
                  {day.sessions.map((row: WorkRow) => (
                    <div className="hours-session" key={row.session_id}>
                      <span className="when">{timeOf(row.started_at)} → {row.ended_at ? timeOf(row.ended_at) : row.is_live ? 'ahora' : 'sin cierre'}</span>
                      <span>{formatMinutes(row.minutes)}</span>
                      <span className="meta">{row.device_name ?? 'Ajuste manual'}{row.adjust_note ? ` · ${row.adjust_note}` : ''}</span>
                      {row.adjusted && <span className="badge">Corregido</span>}
                      {isManager && <button type="button" onClick={() => setEditing(row)}>Corregir</button>}
                    </div>
                  ))}
                </div>
              ))}
            </details>
          ))}
        </section>

        {isManager && <DevicesList tracking={tracking} />}
      </div>

      {editing && (
        <SessionDialog
          title="Corregir turno"
          subtitle={editing.display_name}
          initialStart={toInputValue(editing.started_at)}
          initialEnd={editing.ended_at ? toInputValue(editing.ended_at) : toInputValue(new Date().toISOString())}
          people={null}
          onClose={() => setEditing(null)}
          onSave={async (start: string, end: string, note: string): Promise<string | null> => adjustWorkSession(editing.session_id, start, end, note)}
          onSaved={() => { setEditing(null); setNotice('Turno corregido. Quedó registrado quién lo cambió y por qué.'); void load(); }}
        />
      )}
      {adding && (
        <SessionDialog
          title="Agregar turno"
          subtitle="Para un turno que no se registró (equipo apagado, sin internet, etc.)"
          initialStart={`${today}T08:00`}
          initialEnd={`${today}T16:00`}
          people={people}
          onClose={() => setAdding(false)}
          onSave={async (start: string, end: string, note: string, userId?: string): Promise<string | null> => addWorkSession(userId ?? '', start, end, note)}
          onSaved={() => { setAdding(false); setNotice('Turno agregado.'); void load(); }}
        />
      )}
    </div>
  );
}

function DevicePanel({ isManager, tracking }: { isManager: boolean; tracking: WorkTracking }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameProblem = name.trim().length < 2 ? 'Ponle un nombre al equipo (mínimo 2 letras), por ejemplo: Caja principal.' : null;

  const assign = async (): Promise<void> => {
    if (nameProblem) return;
    setBusy(true);
    setError(null);
    const result = await createWorkDevice(name.trim());
    setBusy(false);
    if (!result.token) { setError(result.error); return; }
    if (!tracking.authorizeThisDevice(result.token)) {
      setError('El navegador bloqueó el almacenamiento y no pudo guardar la autorización de este equipo. Quita el modo privado o permite guardar datos del sitio e inténtalo de nuevo.');
      return;
    }
    setName('');
    setMessage('Listo: este equipo quedó asignado. Desde ahora las horas de quien entre aquí se cuentan solas.');
  };

  const authorized = tracking.status === 'counting';
  return (
    <section className="panel hours-panel">
      <h2>Este equipo</h2>
      <p className="muted">Las horas solo se cuentan cuando se entra desde un equipo asignado al restaurante (la tablet o el PC de la caja).</p>
      <div className="hours-device">
        <div>
          {authorized && <strong><MonitorCheck size={16} /> Equipo autorizado{tracking.deviceName ? `: ${tracking.deviceName}` : ''}</strong>}
          {tracking.status === 'checking' && <strong>Verificando este equipo…</strong>}
          {tracking.status === 'not_authorized' && <strong>Este equipo NO está asignado al restaurante</strong>}
          {tracking.status === 'unavailable' && <strong>El control de horas aún no está activado</strong>}
          {tracking.status === 'unavailable' && <p className="muted">Falta correr la migración 20261124000000_add_nexora_work_time.sql en Supabase.</p>}
        </div>
        {authorized && isManager && <button className="outline-button" type="button" onClick={() => { if (window.confirm('¿Quitar la autorización de este equipo? Dejará de contar horas aquí y el personal no podrá entrar desde él.')) tracking.forgetThisDevice(); }}>Quitar autorización de este equipo</button>}
      </div>
      {tracking.status === 'not_authorized' && !isManager && <p className="muted">Pídele al propietario o a un gerente que entre desde este equipo y lo asigne.</p>}
      {tracking.status === 'not_authorized' && isManager && (
        <div className="hours-device-form">
          <input value={name} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)} placeholder="Nombre del equipo, ej. Caja principal" maxLength={60} aria-label="Nombre del equipo" />
          <button className="primary-button" type="button" disabled={busy || nameProblem !== null} onClick={() => void assign()}>{busy ? 'Asignando…' : 'Asignar este equipo'}</button>
        </div>
      )}
      {tracking.status === 'not_authorized' && isManager && name.length > 0 && <FormProblem message={nameProblem} />}
      {message && <p className="auth-feedback success" role="status">{message}</p>}
      {error && <p className="auth-feedback error" role="alert">{error}</p>}
    </section>
  );
}

function DevicesList({ tracking }: { tracking: WorkTracking }) {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    const result = await listWorkDevices();
    setDevices(result.devices);
    setError(result.error);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load, tracking.status]);

  const toggle = async (device: DeviceRecord): Promise<void> => {
    if (device.is_active && !window.confirm(`¿Desactivar "${device.name}"? Dejará de contar horas y el personal no podrá entrar desde ese equipo.`)) return;
    const failure = await setWorkDeviceActive(device.id, !device.is_active);
    if (failure) setError(failure);
    else { setError(null); tracking.recheck(); }
    void load();
  };

  return (
    <section className="panel hours-panel">
      <h2>Equipos autorizados</h2>
      <p className="muted">Cada equipo asignado tiene un código secreto guardado en él. Si se pierde o lo roban, desactívalo aquí y deja de funcionar al instante.</p>
      {error && <p className="auth-feedback error" role="alert">{error}</p>}
      {loading && <p className="muted">Cargando equipos…</p>}
      {!loading && !error && devices.length === 0 && <p className="muted">Todavía no hay equipos asignados. Entra desde la tablet o el PC del restaurante y usa "Asignar este equipo".</p>}
      <ul className="hours-devices">
        {devices.map((device: DeviceRecord) => (
          <li key={device.id}>
            <div className="info"><strong className={device.is_active ? '' : 'off'}>{device.name}</strong><small>Última señal: {dateTimeLabel(device.last_seen_at)}</small></div>
            <button className="outline-button" type="button" onClick={() => void toggle(device)}>{device.is_active ? 'Desactivar' : 'Reactivar'}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type SessionDialogProps = {
  title: string;
  subtitle: string;
  initialStart: string;
  initialEnd: string;
  people: StaffOption[] | null;
  onClose: () => void;
  onSave: (startIso: string, endIso: string, note: string, userId?: string) => Promise<string | null>;
  onSaved: () => void;
};

function SessionDialog({ title, subtitle, initialStart, initialEnd, people, onClose, onSave, onSaved }: SessionDialogProps) {
  const [userId, setUserId] = useState('');
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = people && userId === '' ? 'Elige a la persona.' : sessionProblem(start, end, note);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const startIso = fromInputValue(start);
    const endIso = fromInputValue(end);
    if (problem || !startIso || !endIso) return;
    setBusy(true);
    setError(null);
    const failure = await onSave(startIso, endIso, note.trim(), userId);
    setBusy(false);
    if (failure) { setError(failure); return; }
    onSaved();
  };

  return (
    <div className="team-dialog-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <section className="team-dialog" role="dialog" aria-modal="true" aria-labelledby="session-dialog-title" onClick={(event: React.MouseEvent<HTMLElement>) => event.stopPropagation()}>
        <div className="team-dialog-heading">
          <div>
            <p className="eyebrow">{subtitle}</p>
            <h2 id="session-dialog-title">{title}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose} disabled={busy}><X size={17} /></button>
        </div>
        <form className="team-form" noValidate onSubmit={(event: React.FormEvent<HTMLFormElement>) => void submit(event)}>
          {people && (
            <label>Persona
              <select value={userId} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setUserId(event.target.value)}>
                <option value="">Elige a la persona…</option>
                {people.map((person: StaffOption) => <option key={person.user_id} value={person.user_id}>{person.display_name}</option>)}
              </select>
            </label>
          )}
          <label>Entrada<input type="datetime-local" value={start} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setStart(event.target.value)} /></label>
          <label>Salida<input type="datetime-local" value={end} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEnd(event.target.value)} /></label>
          <label>Motivo (obligatorio)<input value={note} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNote(event.target.value)} placeholder="Ej. olvidó cerrar sesión" maxLength={200} /></label>
          <FormProblem message={problem} />
          {error && <p className="auth-feedback error" role="alert">{error}</p>}
          <div className="team-dialog-actions">
            <button className="outline-button" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="primary-button" type="submit" disabled={busy || problem !== null}>{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
