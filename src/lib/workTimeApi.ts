import { supabase } from '@/lib/supabase';
import { userFacingError } from '@/lib/tableAccount';
import type { WorkRow } from '@/lib/workTime';

export type WorkDevice = { device_id: string; device_name: string };
export type DeviceRecord = { id: string; name: string; is_active: boolean; created_at: string; last_seen_at: string | null };

/**
 * - ok: el equipo está autorizado.
 * - none: este equipo no está autorizado (sin código, o el código fue desactivado).
 * - unknown: no se pudo verificar (sin internet).
 * - unavailable: falta aplicar la migración en Supabase; el control de horas aún no existe.
 */
export type DeviceCheck = { status: 'ok'; device: WorkDevice } | { status: 'none' } | { status: 'unknown' } | { status: 'unavailable' };

const isMissingFunction = (error: { code?: string; message?: string }): boolean =>
  error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message ?? '');

export async function checkDevice(token: string | null): Promise<DeviceCheck> {
  if (!token) return { status: 'none' };
  try {
    const { data, error } = await supabase.rpc('get_nexora_work_device', { token_input: token });
    if (error) return isMissingFunction(error) ? { status: 'unavailable' } : { status: 'unknown' };
    const rows = Array.isArray(data) ? (data as WorkDevice[]) : [];
    return rows.length > 0 ? { status: 'ok', device: rows[0] } : { status: 'none' };
  } catch {
    return { status: 'unknown' };
  }
}

export type BeatResult = { kind: 'counting'; sessionId: string; startedAt: string; deviceName: string } | { kind: 'denied' } | { kind: 'error' };

export async function beatWorkSession(token: string, continuous: boolean): Promise<BeatResult> {
  try {
    const { data, error } = await supabase.rpc('beat_nexora_work_session', { token_input: token, continuous_input: continuous });
    if (error) return { kind: 'error' };
    const row = Array.isArray(data) ? (data[0] as { session_id: string | null; started_at: string | null; device_name: string | null; counting: boolean } | undefined) : undefined;
    if (!row || !row.counting || !row.session_id || !row.started_at) return { kind: 'denied' };
    return { kind: 'counting', sessionId: row.session_id, startedAt: row.started_at, deviceName: row.device_name ?? '' };
  } catch {
    return { kind: 'error' };
  }
}

export async function endWorkSession(): Promise<void> {
  try {
    await supabase.rpc('end_nexora_work_session');
  } catch {
    /* sin internet: el turno se cierra solo a la hora de la última señal */
  }
}

type Failure = string | null;
const failure = (error: { code?: string; message?: string } | null): Failure => (error ? userFacingError(error) : null);

export async function createWorkDevice(name: string): Promise<{ token: string | null; error: Failure }> {
  const { data, error } = await supabase.rpc('create_nexora_work_device', { name_input: name });
  if (error || typeof data !== 'string') return { token: null, error: failure(error) ?? 'No se pudo asignar el equipo.' };
  return { token: data, error: null };
}

export async function listWorkDevices(): Promise<{ devices: DeviceRecord[]; error: Failure }> {
  const { data, error } = await supabase.rpc('list_nexora_work_devices');
  if (error || !Array.isArray(data)) return { devices: [], error: failure(error) ?? 'No pudimos cargar los equipos.' };
  return { devices: data as DeviceRecord[], error: null };
}

export async function setWorkDeviceActive(deviceId: string, active: boolean): Promise<Failure> {
  const { error } = await supabase.rpc('set_nexora_work_device_active', { device_id_input: deviceId, active_input: active });
  return failure(error);
}

export async function fetchWorkReport(from: string, to: string): Promise<{ rows: WorkRow[]; error: Failure }> {
  const { data, error } = await supabase.rpc('get_nexora_work_report', { from_date: from, to_date: to, user_filter: null });
  if (error || !Array.isArray(data)) return { rows: [], error: failure(error) ?? 'No pudimos cargar las horas.' };
  return { rows: data as WorkRow[], error: null };
}

export async function adjustWorkSession(sessionId: string, startIso: string, endIso: string, note: string): Promise<Failure> {
  const { error } = await supabase.rpc('adjust_nexora_work_session', { session_id_input: sessionId, started_at_input: startIso, ended_at_input: endIso, note_input: note });
  return failure(error);
}

export async function addWorkSession(userId: string, startIso: string, endIso: string, note: string): Promise<Failure> {
  const { error } = await supabase.rpc('add_nexora_work_session', { user_id_input: userId, started_at_input: startIso, ended_at_input: endIso, note_input: note });
  return failure(error);
}
