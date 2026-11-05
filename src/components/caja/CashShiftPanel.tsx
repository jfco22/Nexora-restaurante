import { useState } from 'react';
import { CircleDollarSign, CreditCard, Lock, LockOpen, Smartphone, Wallet, X } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { closeCashShift, formatOpenedAt, openCashShift, type CashShiftSummary } from '@/lib/cashShift';
import '@/components/salon/account.css';
import '@/components/caja/cash-shift.css';

type ClosedShift = { expected: number; difference: number };

type CashShiftPanelProps = {
  shift: CashShiftSummary | null;
  onChanged: () => Promise<void>;
  onClose: () => void;
};

const isWholeAmount = (value: string, minimum: number): boolean => {
  const parsed = Number(value);
  return value.trim() !== '' && Number.isInteger(parsed) && parsed >= minimum;
};

export function CashShiftPanel({ shift, onChanged, onClose }: CashShiftPanelProps) {
  const [closedShift, setClosedShift] = useState<ClosedShift | null>(null);

  let content: React.ReactNode;
  if (closedShift) {
    content = <ClosedShiftResult result={closedShift} onDone={onClose} />;
  } else if (shift) {
    content = <OpenShiftView shift={shift} onClosed={setClosedShift} onChanged={onChanged} />;
  } else {
    content = <OpenShiftForm onChanged={onChanged} />;
  }

  return (
    <div className="account-modal-layer" role="dialog" aria-modal="true" aria-label="Caja">
      <section className="account-modal cash-modal">
        <header className="account-header">
          <div>
            <p className="eyebrow">Caja</p>
            <h2>{closedShift ? 'Caja cerrada' : shift ? 'Turno abierto' : 'Abrir caja'}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}><X size={17} /></button>
        </header>
        {content}
      </section>
    </div>
  );
}

type OpenShiftFormProps = { onChanged: () => Promise<void> };

function OpenShiftForm({ onChanged }: OpenShiftFormProps) {
  const [opening, setOpening] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = isWholeAmount(opening, 0) && !busy;

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const failure = await openCashShift(Number(opening));
    if (failure) {
      setError(failure);
      setBusy(false);
      return;
    }
    await onChanged();
  };

  return (
    <form className="cash-body" onSubmit={(event: React.FormEvent<HTMLFormElement>) => void submit(event)}>
      <p className="cash-intro">Registra el efectivo con el que empiezas el turno. Los cobros en efectivo se sumarán a este valor.</p>
      <label>
        Fondo inicial en caja
        <input type="number" inputMode="numeric" min={0} step={1} value={opening} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setOpening(event.target.value)} />
      </label>
      {error && <p className="auth-feedback error" role="alert">{error}</p>}
      <button className="primary-button full-width" type="submit" disabled={!canSubmit}>
        <LockOpen size={16} /> {busy ? 'Abriendo...' : 'Abrir caja'}
      </button>
    </form>
  );
}

type OpenShiftViewProps = {
  shift: CashShiftSummary;
  onClosed: (closed: ClosedShift) => void;
  onChanged: () => Promise<void>;
};

function OpenShiftView({ shift, onClosed, onChanged }: OpenShiftViewProps) {
  const [counted, setCounted] = useState(String(shift.expected_cash_cop));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = isWholeAmount(counted, 0) && !busy;
  const countedValue = Number(counted);
  const liveDifference = isWholeAmount(counted, 0) ? countedValue - shift.expected_cash_cop : null;

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const result = await closeCashShift(countedValue);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    onClosed({ expected: result.expected, difference: result.difference });
    await onChanged();
  };

  return (
    <form className="cash-body" onSubmit={(event: React.FormEvent<HTMLFormElement>) => void submit(event)}>
      <p className="cash-intro">Abierta desde las {formatOpenedAt(shift.opened_at)}.</p>

      <dl className="cash-summary">
        <div><dt>Fondo inicial</dt><dd>{formatCurrency(shift.opening_cash_cop)}</dd></div>
        <div><dt>Efectivo cobrado</dt><dd>{formatCurrency(shift.cash_sales_cop)}</dd></div>
        <div className="cash-expected"><dt>Efectivo esperado</dt><dd>{formatCurrency(shift.expected_cash_cop)}</dd></div>
        <div><dt><CreditCard size={14} /> Tarjeta</dt><dd>{formatCurrency(shift.card_sales_cop)}</dd></div>
        <div><dt><Smartphone size={14} /> Bre-B confirmado</dt><dd>{formatCurrency(shift.bre_b_paid_cop)}</dd></div>
      </dl>

      {shift.bre_b_pending_cop > 0 && (
        <p className="cash-warning" role="status">
          Hay {formatCurrency(shift.bre_b_pending_cop)} en transferencias Bre-B sin confirmar. Confírmalas desde la cuenta de la mesa.
        </p>
      )}

      <label>
        Efectivo contado
        <input type="number" inputMode="numeric" min={0} step={1} value={counted} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCounted(event.target.value)} />
      </label>
      {liveDifference !== null && (
        <p className={`cash-difference ${liveDifference === 0 ? 'even' : liveDifference > 0 ? 'over' : 'short'}`}>
          {liveDifference === 0 ? 'Caja cuadrada' : liveDifference > 0 ? `Sobrante de ${formatCurrency(liveDifference)}` : `Faltante de ${formatCurrency(-liveDifference)}`}
        </p>
      )}

      {error && <p className="auth-feedback error" role="alert">{error}</p>}
      <button className="primary-button full-width" type="submit" disabled={!canSubmit}>
        <Lock size={16} /> {busy ? 'Cerrando...' : 'Cerrar caja'}
      </button>
    </form>
  );
}

type ClosedShiftResultProps = { result: ClosedShift; onDone: () => void };

function ClosedShiftResult({ result, onDone }: ClosedShiftResultProps) {
  return (
    <div className="cash-body">
      <div className="cash-result">
        <Wallet size={22} />
        <p>Efectivo esperado: <strong>{formatCurrency(result.expected)}</strong></p>
        <p className={result.difference === 0 ? 'even' : result.difference > 0 ? 'over' : 'short'}>
          {result.difference === 0 ? 'Caja cuadrada' : result.difference > 0 ? `Sobrante de ${formatCurrency(result.difference)}` : `Faltante de ${formatCurrency(-result.difference)}`}
        </p>
      </div>
      <button className="primary-button full-width" type="button" onClick={onDone}>Listo</button>
    </div>
  );
}
