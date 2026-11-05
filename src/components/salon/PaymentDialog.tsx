import { useState } from 'react';
import { CircleDollarSign, CreditCard, Smartphone, X } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { paymentMethodLabels, type PaymentMethod } from '@/lib/tableAccount';

const methodOptions: { value: PaymentMethod; icon: React.ReactNode; hint: string }[] = [
  { value: 'cash', icon: <CircleDollarSign size={16} />, hint: 'Dinero recibido en caja.' },
  { value: 'card', icon: <CreditCard size={16} />, hint: 'Pago aprobado en el datáfono.' },
  { value: 'bre_b', icon: <Smartphone size={16} />, hint: 'Queda pendiente hasta confirmar la referencia de la transferencia.' },
];

type PaymentDialogProps = {
  balance: number;
  onRegister: (method: PaymentMethod, amount: number, reference: string | null) => Promise<string | null>;
  onClose: () => void;
};

export function PaymentDialog({ balance, onRegister, onClose }: PaymentDialogProps) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState(String(balance));
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = Number(amount);
  const amountValid = Number.isInteger(parsedAmount) && parsedAmount > 0 && parsedAmount <= balance;
  const referenceValid = method !== 'bre_b' || reference.trim().length > 0;
  const canSubmit = amountValid && referenceValid && !busy;
  const selectedHint = methodOptions.find((option) => option.value === method)?.hint ?? '';

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const result = await onRegister(method, parsedAmount, method === 'bre_b' ? reference.trim() : null);
    setBusy(false);
    if (result) setError(result);
    else onClose();
  };

  return (
    <div className="account-modal-layer" role="dialog" aria-modal="true" aria-label="Cobrar cuenta">
      <form className="account-modal payment-modal" onSubmit={(event: React.FormEvent<HTMLFormElement>) => void submit(event)}>
        <header className="account-header">
          <div>
            <p className="eyebrow">Cobro</p>
            <h2>Registrar pago</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}><X size={17} /></button>
        </header>

        <div className="payment-balance">
          <span>Saldo por cobrar</span>
          <strong>{formatCurrency(balance)}</strong>
        </div>

        <div className="payment-methods" role="group" aria-label="Método de pago">
          {methodOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={method === option.value}
              className={method === option.value ? 'selected' : ''}
              onClick={() => setMethod(option.value)}
            >
              {option.icon}
              <span>{paymentMethodLabels[option.value]}</span>
            </button>
          ))}
        </div>
        <p className="payment-hint">{selectedHint}</p>

        <label>
          Valor a cobrar
          <input type="number" inputMode="numeric" min={1} max={balance} step={1} value={amount} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setAmount(event.target.value)} />
        </label>

        {method === 'bre_b' && (
          <label>
            Referencia de la transferencia
            <input value={reference} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setReference(event.target.value)} placeholder="Ej. 4839201" />
          </label>
        )}

        {error && <p className="auth-feedback error" role="alert">{error}</p>}

        <button className="primary-button full-width" type="submit" disabled={!canSubmit}>
          {busy ? 'Registrando...' : `Registrar ${formatCurrency(parsedAmount > 0 ? parsedAmount : 0)}`}
        </button>
      </form>
    </div>
  );
}
