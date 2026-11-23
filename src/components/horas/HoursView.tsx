import { useCallback, useEffect, useMemo, useState } from 'react';
import { MonitorCheck, Plus, X } from 'lucide-react';
import { FormProblem } from '@/components/FormProblem';
import { NumberInput } from '@/components/NumberInput';
import '@/components/equipo/team.css';
import '@/components/horas/hours.css';
import { formatCurrency } from '@/lib/format';
import { wholeAmountProblem } from '@/lib/formProblems';
import { supabase } from '@/lib/supabase';
import { roleLabels } from '@/lib/staffRoles';
import type { WorkTracking } from '@/lib/useWorkTracking';
import {
  formatMinutes, fromInputValue, groupReport, paymentAmount, payablePreview, sessionProblem, shiftDate, startOfMonth, startOfWeek, todayBogota, toInputValue,
  type DaySummary, type PersonSummary, type WeekSummary, type WorkRow,
} from '@/lib/workTime';
import {
  addWorkSession, adjustWorkSession, createWorkDevice, fetchWorkReport, listWorkDevices, listWorkPayments, payMethodLabels, payWorkHours, setWorkDeviceActive, setWorkRate, voidWorkPayment,
  type DeviceRecord, type PayMethod, type PaymentRecord,
} from '@/lib/workTimeApi';

type RangeKey = 'hoy' | 'semana' | 'mes' | 'rango';
type StaffOption = { user_id: string; display_name: string };
type PayTarget = { userId: string; name: string; rate: number; from: string; to: string };

const timeOf = (iso: string): string => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
const dayLabel = (ymd: string): string => new Date(`${ymd}T12:00:00-05:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'America/Bogota' });
const shortDate = (ymd: string): string => new Date(`${ymd}T12:00:00-05:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' });
const dateTimeLabel = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' }) : 'nunca');
const statusLabel = { paid: 'Pagada', partial: 'Pago parcial', pending: 'Sin pagar' } as const;

/** Solo el propietario y los gerentes llegan a esta pantalla. */
export function HoursView({ tracking }: { tracking: WorkTracking }) {
  const today = todayBogota();
  const [range, setRange] = useState<RangeKey>('semana');
  const [customFrom, setCustomFrom] = useState(shiftDate(today, -6));
  const [customTo, setCustomTo] = useState(today);
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<PayTarget | null>(null);
  const [rateFor, setRateFor] = useState<{ userId: string; name: string; rate: number } | null>(null);
  const [voiding, setVoiding] = useState<PaymentRecord | null>(null);
  const [people, setPeople] = useState<StaffOption[]>([]);

  const { from, to } = useMemo((): { from: string; to: string } => {
    if (range === 'hoy') return { from: today, to: today };
    if (range === 'semana') return { from: startOfWeek(today), to: today };
    if (range === 'mes') return { from: startOfMonth(today), to: today };
    return { from: customFrom, to: customTo };
  }, [range, today, customFrom, customTo]);

  const rangeProblem = !from || !to ? 'Elige la fecha inicial y la final.' : to < from ? 'La fecha final no puede ser anterior a la inicial.' : null;

  const load = useCallback(async (): Promise<void> => {
    if (rangeProblem) { setRows([]); setPayments([]); setLoading(false); return; }
    setLoading(true);
    const [report, paid] = await Promise.all([fetchWorkReport(from, to), listWorkPayments(from, to)]);
    setRows(report.rows);
    setPayments(paid.payments);
    setError(report.error ?? paid.error);
    setLoading(false);
  }, [from, to, rangeProblem]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void supabase.rpc('list_nexora_staff').then(({ data }) => {
      if (Array.isArray(data)) setPeople((data as StaffOption[]).map((person: StaffOption) => ({ user_id: person.user_id, display_name: person.display_name })));
    });
  }, []);

  const summary: PersonSummary[] = useMemo(() => groupReport(rows), [rows]);
  const grandTotal = summary.reduce((sum: number, person: PersonSummary) => sum + person.totalMinutes, 0);
  const payableTotal = summary.reduce((sum: number, person: PersonSummary) => sum + person.payableMinutes, 0);
  const payableAmount = summary.reduce((sum: number, person: PersonSummary) => sum + paymentAmount(person.payableMinutes, person.rate), 0);
  const withoutRate = summary.filter((person: PersonSummary) => person.payableMinutes > 0 && person.rate <= 0).map((person: PersonSummary) => person.name);
  const activePayments = payments.filter((payment: PaymentRecord) => !payment.voided_at);
  const paidAmount = activePayments.reduce((sum: number, payment: PaymentRecord) => sum + payment.amount_cop, 0);

  const done = (message: string): void => { setNotice(message); void load(); };

  const openPay = (person: PersonSummary, payFrom: string, payTo: string): void => {
    setNotice(null);
    setPaying({ userId: person.userId, name: person.name, rate: person.rate, from: payFrom < from ? from : payFrom, to: payTo > to ? to : payTo });
  };

  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administración</p>
          <h1>Horas trabajadas</h1>
          <p className="muted">Las horas de cada persona se cuentan solas desde que inicia sesión en un equipo del restaurante. Aquí las revisas, las corriges y registras el pago.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setAdding(true)}><Plus size={16} /> Agregar turno</button>
      </div>

      {notice && <p className="auth-feedback success team-notice" role="status">{notice}</p>}
      {error && <p className="auth-feedback error team-notice" role="alert">{error}</p>}

      <div className="hours-grid">
        <section className="panel hours-panel">
          <h2>Horas por persona</h2>
          <div className="hours-ranges">
            {([['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['rango', 'Entre dos fechas']] as [RangeKey, string][]).map(([key, label]: [RangeKey, string]) => (
              <button key={key} type="button" className={`chip ${range === key ? 'active' : ''}`} onClick={() => setRange(key)}>{label}</button>
            ))}
            {range === 'rango' && (
              <>
                <input type="date" aria-label="Desde" value={customFrom} max={today} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCustomFrom(event.target.value)} />
                <span className="muted">hasta</span>
                <input type="date" aria-label="Hasta" value={customTo} max={today} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCustomTo(event.target.value)} />
              </>
            )}
          </div>
          <FormProblem message={rangeProblem} />

          <div className="hours-total">
            <div><strong>{formatMinutes(grandTotal)}</strong><span>Horas del periodo</span></div>
            <div><strong>{formatMinutes(payableTotal)}</strong><span>Por pagar · {formatCurrency(payableAmount)}</span></div>
            <div><strong>{formatCurrency(paidAmount)}</strong><span>Pagado en el periodo</span></div>
          </div>
          {withoutRate.length > 0 && <p className="hours-pending-box" role="status">Falta definir el valor por hora de {withoutRate.join(', ')}. Toca el botón "Valor por hora" junto a su nombre para poder pagarle.</p>}

          {loading && <p className="muted">Cargando horas...</p>}
          {!loading && !error && !rangeProblem && summary.length === 0 && <p className="muted">No hay turnos en este periodo. Los turnos se registran solos cuando alguien inicia sesión desde un equipo asignado.</p>}

          {summary.map((person: PersonSummary) => (
            <details className="hours-person" key={person.userId}>
              <summary>
                <span className="name">{person.name}{person.role && <small className="muted"> · {roleLabels[person.role] ?? person.role}</small>}</span>
                {person.live && <span className="hours-live">Trabajando ahora</span>}
                {person.payableMinutes > 0 && <span className="pay-status pending">Por pagar {formatMinutes(person.payableMinutes)}</span>}
                <span className="total">{formatMinutes(person.totalMinutes)}</span>
              </summary>
              <div className="hours-person-actions">
                <button type="button" className={`hours-rate ${person.rate <= 0 ? 'missing' : ''}`} onClick={() => setRateFor({ userId: person.userId, name: person.name, rate: person.rate })}>
                  {person.rate > 0 ? `Valor por hora: ${formatCurrency(person.rate)}` : 'Definir valor por hora'}
                </button>
                {person.payableMinutes > 0 && <button type="button" className="outline-button" onClick={() => openPay(person, from, to)}>Pagar entre fechas…</button>}
              </div>
              {person.weeks.map((week: WeekSummary) => (
                <div className="hours-week" key={week.start}>
                  <div className="hours-week-head">
                    <strong>Semana del {shortDate(week.start)} al {shortDate(week.end)}</strong>
                    <span className={`pay-status ${week.status}`}>{statusLabel[week.status]}</span>
                    <span>{formatMinutes(week.minutes)}</span>
                    {week.payableMinutes > 0 && <button type="button" className="primary-button" onClick={() => openPay(person, week.start, week.end)}>Pagar semana</button>}
                  </div>
                  {week.days.map((day: DaySummary) => (
                    <div className={`hours-day ${day.paidMinutes >= day.minutes ? 'is-paid' : ''}`} key={day.date}>
                      <div className="hours-day-head"><span>{dayLabel(day.date)}</span><span>{formatMinutes(day.minutes)}</span></div>
                      {day.sessions.map((row: WorkRow) => (
                        <div className="hours-session" key={row.session_id}>
                          <span className="when">{timeOf(row.started_at)} → {row.ended_at ? timeOf(row.ended_at) : row.is_live ? 'ahora' : 'sin cierre'}</span>
                          <span>{formatMinutes(row.minutes)}</span>
                          <span className="meta">{row.device_name ?? 'Ajuste manual'}{row.adjust_note ? ` · ${row.adjust_note}` : ''}</span>
                          {row.adjusted && <span className="badge">Corregido</span>}
                          {row.paid ? <span className="paid-mark">Pagado</span> : <span className="unpaid-mark">{row.is_live ? 'En curso' : 'Sin pagar'}</span>}
                          {!row.paid && <button type="button" onClick={() => setEditing(row)}>Corregir</button>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </details>
          ))}
        </section>

        <section className="panel hours-panel">
          <h2>Pagos realizados</h2>
          <p className="muted">Cada pago queda registrado con quién lo hizo y qué horas cubre. Si te equivocas, anúlalo: las horas vuelven a quedar sin pagar y el pago queda en el historial.</p>
          {!loading && payments.length === 0 && <p className="muted">No hay pagos en este periodo.</p>}
          <ul className="hours-payments">
            {payments.map((payment: PaymentRecord) => (
              <li key={payment.payment_id} className={payment.voided_at ? 'voided' : ''}>
                <div className="info">
                  <strong>{payment.display_name}</strong>
                  <small>{shortDate(payment.from_date)} al {shortDate(payment.to_date)} · {formatMinutes(payment.minutes)} × {formatCurrency(payment.hourly_rate_cop)}/h · {payMethodLabels[payment.method]}</small>
                  <small>Pagado el {dateTimeLabel(payment.paid_at)} por {payment.paid_by_name}{payment.note ? ` · ${payment.note}` : ''}</small>
                  {payment.voided_at && <small>Anulado el {dateTimeLabel(payment.voided_at)}: {payment.void_reason}</small>}
                </div>
                <span className="amount">{formatCurrency(payment.amount_cop)}</span>
                {payment.voided_at ? <span className="pay-status pending">Anulado</span> : <button className="outline-button" type="button" onClick={() => setVoiding(payment)}>Anular</button>}
              </li>
            ))}
          </ul>
        </section>

        <DevicePanel tracking={tracking} />
        <DevicesList tracking={tracking} />
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
          onSaved={() => { setEditing(null); done('Turno corregido. Quedó registrado quién lo cambió y por qué.'); }}
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
          onSaved={() => { setAdding(false); done('Turno agregado.'); }}
        />
      )}
      {paying && <PayDialog target={paying} rows={rows} minFrom={from} maxTo={to} onClose={() => setPaying(null)} onPaid={(message: string) => { setPaying(null); done(message); }} />}
      {rateFor && <RateDialog target={rateFor} onClose={() => setRateFor(null)} onSaved={(message: string) => { setRateFor(null); done(message); }} />}
      {voiding && <VoidDialog payment={voiding} onClose={() => setVoiding(null)} onVoided={() => { setVoiding(null); done('Pago anulado. Esas horas volvieron a quedar sin pagar.'); }} />}
    </div>
  );
}

function Dialog({ title, eyebrow, busy, onClose, children }: { title: string; eyebrow: string; busy: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="team-dialog-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <section className="team-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event: React.MouseEvent<HTMLElement>) => event.stopPropagation()}>
        <div className="team-dialog-heading">
          <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose} disabled={busy}><X size={17} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function PayDialog({ target, rows, minFrom, maxTo, onClose, onPaid }: { target: PayTarget; rows: WorkRow[]; minFrom: string; maxTo: string; onClose: () => void; onPaid: (message: string) => void }) {
  const [from, setFrom] = useState(target.from);
  const [to, setTo] = useState(target.to);
  const [method, setMethod] = useState<PayMethod>('efectivo');
  const [note, setNote] = useState('');
  const [rateText, setRateText] = useState(target.rate > 0 ? String(target.rate) : '');
  const [saveRate, setSaveRate] = useState(target.rate <= 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = payablePreview(rows, target.userId, from, to);
  const rate = Number(rateText);
  const amount = paymentAmount(preview.minutes, Number.isFinite(rate) ? rate : 0);
  const problem = !from || !to ? 'Elige la fecha inicial y la final.'
    : to < from ? 'La fecha final no puede ser anterior a la inicial.'
    : wholeAmountProblem(rateText, 'el valor por hora', { min: 1, max: 10000000, example: '9000' })
    ?? (preview.minutes <= 0 ? 'No hay horas sin pagar de esta persona entre esas fechas. Cambia las fechas (solo se pagan turnos ya terminados y no pagados).' : null);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (problem) return;
    setBusy(true);
    setError(null);
    const result = await payWorkHours(target.userId, from, to, method, note.trim(), rate);
    if (result.error) { setBusy(false); setError(result.error); return; }
    if (saveRate && rate !== target.rate) await setWorkRate(target.userId, rate);
    setBusy(false);
    onPaid(`Pago generado: ${formatCurrency(result.amount)} por ${formatMinutes(result.minutes)} a ${target.name}. Esas horas quedaron marcadas como pagadas.`);
  };

  return (
    <Dialog title={`Pagar a ${target.name}`} eyebrow="Pago de horas" busy={busy} onClose={onClose}>
      <form className="team-form" noValidate onSubmit={(event: React.FormEvent<HTMLFormElement>) => void submit(event)}>
        <div className="hours-two">
          <label>Desde<input type="date" value={from} min={minFrom} max={maxTo} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFrom(event.target.value)} /></label>
          <label>Hasta<input type="date" value={to} min={minFrom} max={maxTo} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTo(event.target.value)} /></label>
        </div>
        <label>Valor por hora (COP)<NumberInput value={rateText} onChange={setRateText} /></label>
        {target.rate <= 0 || rate !== target.rate ? (
          <label className="inventory-check"><input type="checkbox" checked={saveRate} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSaveRate(event.target.checked)} /> Guardar como valor por hora de {target.name}</label>
        ) : null}
        <label>Forma de pago
          <select value={method} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setMethod(event.target.value as PayMethod)}>
            {(Object.keys(payMethodLabels) as PayMethod[]).map((key: PayMethod) => <option key={key} value={key}>{payMethodLabels[key]}</option>)}
          </select>
        </label>
        <label>Nota (opcional)<input value={note} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNote(event.target.value)} placeholder="Ej. semana 47, Nequi" maxLength={200} /></label>
        <p className="hours-preview">
          {preview.minutes > 0
            ? <>Se pagan <strong>{formatMinutes(preview.minutes)}</strong> ({preview.sessions} {preview.sessions === 1 ? 'turno' : 'turnos'}) a {formatCurrency(Number.isFinite(rate) ? rate : 0)} por hora = <strong>{formatCurrency(amount)}</strong>. Los turnos en curso quedan pendientes.</>
            : 'Elige fechas con horas sin pagar para ver el total.'}
        </p>
        <FormProblem message={problem} />
        {error && <p className="auth-feedback error" role="alert">{error}</p>}
        <div className="team-dialog-actions">
          <button className="outline-button" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="primary-button" type="submit" disabled={busy || problem !== null}>{busy ? 'Generando…' : `Generar pago de ${formatCurrency(amount)}`}</button>
        </div>
      </form>
    </Dialog>
  );
}

function RateDialog({ target, onClose, onSaved }: { target: { userId: string; name: string; rate: number }; onClose: () => void; onSaved: (message: string) => void }) {
  const [rateText, setRateText] = useState(target.rate > 0 ? String(target.rate) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = wholeAmountProblem(rateText, 'el valor por hora', { min: 1, max: 10000000, example: '9000' });

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (problem) return;
    setBusy(true);
    setError(null);
    const failure = await setWorkRate(target.userId, Number(rateText));
    setBusy(false);
    if (failure) { setError(failure); return; }
    onSaved(`Valor por hora de ${target.name}: ${formatCurrency(Number(rateText))}. Se aplica a los pagos nuevos; los ya generados no cambian.`);
  };

  return (
    <Dialog title={`Valor por hora de ${target.name}`} eyebrow="Pago de horas" busy={busy} onClose={onClose}>
      <form className="team-form" noValidate onSubmit={(event: React.FormEvent<HTMLFormElement>) => void submit(event)}>
        <label>Valor por hora (COP)<NumberInput value={rateText} onChange={setRateText} /></label>
        <FormProblem message={problem} />
        {error && <p className="auth-feedback error" role="alert">{error}</p>}
        <div className="team-dialog-actions">
          <button className="outline-button" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="primary-button" type="submit" disabled={busy || problem !== null}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function VoidDialog({ payment, onClose, onVoided }: { payment: PaymentRecord; onClose: () => void; onVoided: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = reason.trim().length < 3 ? 'Escribe el motivo de la anulación (mínimo 3 letras), por ejemplo: pago equivocado.' : null;

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (problem) return;
    setBusy(true);
    setError(null);
    const failure = await voidWorkPayment(payment.payment_id, reason.trim());
    setBusy(false);
    if (failure) { setError(failure); return; }
    onVoided();
  };

  return (
    <Dialog title="Anular pago" eyebrow={`${payment.display_name} · ${formatCurrency(payment.amount_cop)}`} busy={busy} onClose={onClose}>
      <form className="team-form" noValidate onSubmit={(event: React.FormEvent<HTMLFormElement>) => void submit(event)}>
        <p className="hours-preview">Las horas de este pago ({formatMinutes(payment.minutes)}) volverán a quedar <strong>sin pagar</strong>. El pago se queda en el historial como anulado.</p>
        <label>Motivo (obligatorio)<input value={reason} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setReason(event.target.value)} placeholder="Ej. pago equivocado" maxLength={200} /></label>
        <FormProblem message={problem} />
        {error && <p className="auth-feedback error" role="alert">{error}</p>}
        <div className="team-dialog-actions">
          <button className="outline-button" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="primary-button" type="submit" disabled={busy || problem !== null}>{busy ? 'Anulando…' : 'Anular pago'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function DevicePanel({ tracking }: { tracking: WorkTracking }) {
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
    setMessage('Listo: este equipo quedó asignado. Desde ahora las horas de quien inicie sesión aquí se cuentan solas.');
  };

  const authorized = tracking.status === 'counting';
  return (
    <section className="panel hours-panel">
      <h2>Este equipo</h2>
      <p className="muted">Las horas solo se cuentan cuando se inicia sesión desde un equipo asignado al restaurante (la tablet o el PC de la caja).</p>
      <div className="hours-device">
        <div>
          {authorized && <strong><MonitorCheck size={16} /> Equipo autorizado{tracking.deviceName ? `: ${tracking.deviceName}` : ''}</strong>}
          {tracking.status === 'checking' && <strong>Verificando este equipo…</strong>}
          {tracking.status === 'not_authorized' && <strong>Este equipo NO está asignado al restaurante</strong>}
          {tracking.status === 'unavailable' && <strong>El control de horas aún no está activado</strong>}
          {tracking.status === 'unavailable' && <p className="muted">Falta correr las migraciones 20261124000000 y 20261125000000 en Supabase.</p>}
        </div>
        {authorized && <button className="outline-button" type="button" onClick={() => { if (window.confirm('¿Quitar la autorización de este equipo? Dejará de contar horas aquí y el personal no podrá entrar desde él.')) tracking.forgetThisDevice(); }}>Quitar autorización de este equipo</button>}
      </div>
      {tracking.status === 'not_authorized' && (
        <div className="hours-device-form">
          <input value={name} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)} placeholder="Nombre del equipo, ej. Caja principal" maxLength={60} aria-label="Nombre del equipo" />
          <button className="primary-button" type="button" disabled={busy || nameProblem !== null} onClick={() => void assign()}>{busy ? 'Asignando…' : 'Asignar este equipo'}</button>
        </div>
      )}
      {tracking.status === 'not_authorized' && name.length > 0 && <FormProblem message={nameProblem} />}
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
    <Dialog title={title} eyebrow={subtitle} busy={busy} onClose={onClose}>
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
    </Dialog>
  );
}
