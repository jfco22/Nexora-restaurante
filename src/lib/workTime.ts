/** Control de horas: lógica pura (sin Supabase) para poder probarla. */

/** Roles que solo pueden trabajar desde un equipo asignado al restaurante. Propietario, gerente, marketing y auditor pueden entrar desde cualquier lugar. */
export const DEVICE_REQUIRED_ROLES: readonly string[] = ['cashier', 'waiter', 'kitchen', 'inventory'];

export const deviceRequiredFor = (role: string | null | undefined): boolean => Boolean(role) && DEVICE_REQUIRED_ROLES.includes(role as string);

const TOKEN_KEY = 'nexora.work.device-token.v1';
type StoreLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StoreLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getDeviceToken(storage: StoreLike | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function saveDeviceToken(token: string, storage: StoreLike | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(TOKEN_KEY, token);
    return true;
  } catch {
    return false;
  }
}

export function clearDeviceToken(storage: StoreLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(TOKEN_KEY);
  } catch {
    /* nada que hacer */
  }
}

export type WorkRow = {
  session_id: string;
  user_id: string;
  display_name: string;
  role: string;
  device_name: string | null;
  started_at: string;
  ended_at: string | null;
  minutes: number;
  is_live: boolean;
  adjusted: boolean;
  adjust_note: string | null;
  paid: boolean;
  payment_id: string | null;
  hourly_rate_cop: number;
};

export type DaySummary = { date: string; minutes: number; paidMinutes: number; sessions: WorkRow[] };
export type PayStatus = 'paid' | 'partial' | 'pending';
export type WeekSummary = { start: string; end: string; minutes: number; paidMinutes: number; payableMinutes: number; status: PayStatus; days: DaySummary[] };
export type PersonSummary = {
  userId: string; name: string; role: string; rate: number;
  totalMinutes: number; paidMinutes: number;
  /** Minutos sin pagar que ya se pueden pagar (turnos terminados). */
  payableMinutes: number;
  live: boolean; weeks: WeekSummary[];
};

/** Monto de pagar unos minutos a un valor por hora, redondeado al peso (igual que la base de datos). */
export const paymentAmount = (minutes: number, hourlyRate: number): number => Math.round((minutes * hourlyRate) / 60);

/** "3 h 05 min", "45 min", "0 min". */
export function formatMinutes(total: number): string {
  const minutes = Math.max(0, Math.round(total));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return `${hours} h ${String(rest).padStart(2, '0')} min`;
}

/** Fecha (AAAA-MM-DD) en hora de Colombia de un instante. */
export function bogotaDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export const todayBogota = (): string => bogotaDate(new Date().toISOString());

/** Suma (o resta) días a una fecha AAAA-MM-DD. */
export function shiftDate(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/** Lunes de la semana de una fecha. */
export function startOfWeek(ymd: string): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = domingo
  return shiftDate(ymd, -((weekday + 6) % 7));
}

export const startOfMonth = (ymd: string): string => `${ymd.slice(0, 7)}-01`;

/** Valor para <input type="datetime-local"> en hora de Colombia. */
export function toInputValue(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (type: string): string => parts.find((part: Intl.DateTimeFormatPart) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Convierte lo escrito en datetime-local (hora de Colombia, UTC-5 todo el año) a un instante ISO. Devuelve null si no es válido. */
export function fromInputValue(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00-05:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Estado de pago según los minutos pagados de un total. */
export function payStatus(paidMinutes: number, minutes: number): PayStatus {
  if (minutes > 0 && paidMinutes >= minutes) return 'paid';
  return paidMinutes > 0 ? 'partial' : 'pending';
}

/**
 * Agrupa los turnos por persona, semana (lunes a domingo) y día, en hora de Colombia.
 * Personas ordenadas por horas pendientes de pago y luego por total; semanas y días del más reciente al más antiguo.
 */
export function groupReport(rows: WorkRow[]): PersonSummary[] {
  const people = new Map<string, PersonSummary>();
  for (const row of rows) {
    let person = people.get(row.user_id);
    if (!person) {
      person = { userId: row.user_id, name: row.display_name, role: row.role, rate: row.hourly_rate_cop, totalMinutes: 0, paidMinutes: 0, payableMinutes: 0, live: false, weeks: [] };
      people.set(row.user_id, person);
    }
    person.totalMinutes += row.minutes;
    if (row.paid) person.paidMinutes += row.minutes;
    else if (!row.is_live) person.payableMinutes += row.minutes;
    person.live = person.live || row.is_live;

    const date = bogotaDate(row.started_at);
    const weekStart = startOfWeek(date);
    let week = person.weeks.find((item: WeekSummary) => item.start === weekStart);
    if (!week) {
      week = { start: weekStart, end: shiftDate(weekStart, 6), minutes: 0, paidMinutes: 0, payableMinutes: 0, status: 'pending', days: [] };
      person.weeks.push(week);
    }
    week.minutes += row.minutes;
    if (row.paid) week.paidMinutes += row.minutes;
    else if (!row.is_live) week.payableMinutes += row.minutes;

    let day = week.days.find((item: DaySummary) => item.date === date);
    if (!day) {
      day = { date, minutes: 0, paidMinutes: 0, sessions: [] };
      week.days.push(day);
    }
    day.minutes += row.minutes;
    if (row.paid) day.paidMinutes += row.minutes;
    day.sessions.push(row);
  }
  const result = [...people.values()];
  for (const person of result) {
    person.weeks.sort((a: WeekSummary, b: WeekSummary) => b.start.localeCompare(a.start));
    for (const week of person.weeks) {
      week.status = payStatus(week.paidMinutes, week.minutes);
      week.days.sort((a: DaySummary, b: DaySummary) => b.date.localeCompare(a.date));
      for (const day of week.days) day.sessions.sort((a: WorkRow, b: WorkRow) => a.started_at.localeCompare(b.started_at));
    }
  }
  return result.sort((a: PersonSummary, b: PersonSummary) => b.payableMinutes - a.payableMinutes || b.totalMinutes - a.totalMinutes || a.name.localeCompare(b.name));
}

/** Minutos que se pagarían a una persona entre dos fechas (AAAA-MM-DD) según los turnos cargados: sin pagar y terminados. */
export function payablePreview(rows: WorkRow[], userId: string, from: string, to: string): { minutes: number; sessions: number } {
  let minutes = 0;
  let sessions = 0;
  for (const row of rows) {
    if (row.user_id !== userId || row.paid || row.is_live) continue;
    const date = bogotaDate(row.started_at);
    if (date < from || date > to) continue;
    minutes += row.minutes;
    sessions += 1;
  }
  return { minutes, sessions };
}

/** Problema de un turno escrito a mano, o null si está bien. */
export function sessionProblem(startText: string, endText: string, note: string, nowMs: number = Date.now()): string | null {
  const start = fromInputValue(startText);
  const end = fromInputValue(endText);
  if (!start) return 'Escribe la fecha y hora de entrada.';
  if (!end) return 'Escribe la fecha y hora de salida.';
  if (new Date(end).getTime() <= new Date(start).getTime()) return 'La salida debe ser posterior a la entrada. Revisa las horas y el AM/PM.';
  if (new Date(end).getTime() > nowMs + 60000) return 'La salida no puede estar en el futuro.';
  if (new Date(end).getTime() - new Date(start).getTime() > 16 * 3600 * 1000) return 'Un turno no puede durar más de 16 horas; divídelo en dos.';
  if (note.trim().length < 3) return 'Escribe el motivo de la corrección (por ejemplo: olvidó cerrar sesión).';
  return null;
}
