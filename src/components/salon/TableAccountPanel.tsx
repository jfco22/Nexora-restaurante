import { useEffect, useState } from 'react';
import { CheckCircle2, Minus, Plus, Trash2, Wallet, X } from 'lucide-react';
import '@/components/salon/account.css';
import { AccountProductPicker } from '@/components/salon/AccountProductPicker';
import { PaymentDialog } from '@/components/salon/PaymentDialog';
import { formatCurrency } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { fetchOpenTableAccount, paymentMethodLabels, userFacingError, type AccountPayment, type TableAccount } from '@/lib/tableAccount';

const accountStatusLabels: Record<string, string> = {
  draft: 'Borrador sin enviar',
  submitted: 'Enviada a cocina',
  accepted: 'En preparación',
  ready: 'Lista para entregar',
  completed: 'Entregada',
};

type TableAccountPanelProps = {
  tableId: string;
  tableName: string;
  onClose: () => void;
  onChanged: () => void;
};

export function TableAccountPanel({ tableId, tableName, onClose, onChanged }: TableAccountPanelProps) {
  const [account, setAccount] = useState<TableAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const loadAccount = async (): Promise<void> => {
    const result = await fetchOpenTableAccount(tableId);
    setLoadError(result.error);
    setAccount(result.account);
    setLoading(false);
  };

  useEffect(() => { void loadAccount(); }, [tableId]);

  const runAction = async (rpcName: string, params: Record<string, unknown>, successMessage: string | null): Promise<string | null> => {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.rpc(rpcName, params);
    setBusy(false);
    if (error) {
      const text = userFacingError(error);
      setMessage(text);
      return text;
    }
    setMessage(successMessage);
    onChanged();
    await loadAccount();
    return null;
  };

  const registeredTotal = account?.payments.reduce((sum: number, payment: AccountPayment) => sum + payment.amount_cop, 0) ?? 0;
  const balance = (account?.total_cop ?? 0) - registeredTotal;
  const hasPending = account?.payments.some((payment: AccountPayment) => payment.status === 'pending') ?? false;
  const isDraft = account?.status === 'draft';
  const canCharge = !!account && !isDraft && account.lines.length > 0 && balance > 0;
  const canClose = !!account && account.status === 'completed' && balance === 0 && !hasPending;

  const addItems = (items: { product_id: string; quantity: number }[]): Promise<string | null> => {
    if (!account) return Promise.resolve('La cuenta ya no está disponible.');
    return runAction('add_nexora_table_order_items', { order_id_input: account.id, items }, 'Productos agregados a la cuenta.');
  };

  const registerPayment = (method: string, amount: number, reference: string | null): Promise<string | null> => {
    if (!account) return Promise.resolve('La cuenta ya no está disponible.');
    return runAction('register_nexora_payment', { order_id_input: account.id, method_input: method, amount_input: amount, reference_input: reference }, 'Pago registrado.');
  };

  const confirmPayment = (paymentId: string, reference: string): Promise<string | null> =>
    runAction('confirm_nexora_bre_b_payment', { payment_id_input: paymentId, reference_input: reference }, 'Pago Bre-B confirmado.');

  const sendToKitchen = (): void => {
    if (!account) return;
    void runAction('advance_nexora_order_status', { order_id_input: account.id }, 'Cuenta enviada a cocina.');
  };

  const removeLine = (lineId: string): void => {
    void runAction('remove_nexora_order_item', { item_id_input: lineId }, null);
  };

  const cancelAccount = async (): Promise<void> => {
    if (!account) return;
    const error = await runAction('cancel_nexora_table_order', { order_id_input: account.id }, null);
    if (!error) onClose();
  };

  const closeAccount = async (): Promise<void> => {
    if (!account) return;
    const error = await runAction('close_nexora_table_order', { order_id_input: account.id }, null);
    if (!error) onClose();
  };

  const waitingHint = (): string | null => {
    if (!account || isDraft || canClose) return null;
    if (hasPending) return 'Confirma la referencia de los pagos Bre-B pendientes para poder cerrar la cuenta.';
    if (balance === 0) return 'La cuenta se podrá cerrar cuando cocina marque la entrega.';
    return null;
  };

  return (
    <div className="account-layer">
      <button className="account-backdrop" type="button" aria-label="Cerrar panel de cuenta" onClick={onClose} />
      <aside className="account-drawer" role="dialog" aria-modal="true" aria-label={`Cuenta de ${tableName}`}>
        <header className="account-header">
          <div>
            <p className="eyebrow">Cuenta de mesa</p>
            <h2>{tableName}</h2>
            {account && <p className="muted">Pedido #{account.order_number} · {accountStatusLabels[account.status] ?? account.status}</p>}
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}><X size={17} /></button>
        </header>

        <div className="account-body">
          {loading && <p className="account-empty">Cargando cuenta...</p>}
          {!loading && loadError && <p className="auth-feedback error" role="alert">{loadError}</p>}
          {!loading && !loadError && !account && <p className="account-empty">Esta mesa no tiene una cuenta abierta.</p>}

          {account && (
            <>
              <section className="account-section">
                <h3>Consumo</h3>
                {account.lines.length === 0 ? (
                  <p className="account-empty">Agrega productos para empezar la cuenta.</p>
                ) : (
                  <ul className="account-lines">
                    {account.lines.map((line) => (
                      <li key={line.id}>
                        <div>
                          <strong>{line.product_name}</strong>
                          <span>{line.quantity} × {formatCurrency(line.unit_price_cop)}</span>
                        </div>
                        <div className="account-line-end">
                          <b>{formatCurrency(line.line_total_cop)}</b>
                          {isDraft && (
                            <button className="icon-button small" type="button" aria-label={`Quitar ${line.product_name}`} disabled={busy} onClick={() => removeLine(line.id)}>
                              <Minus size={13} />
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="account-totals">
                <div><span>Total</span><strong>{formatCurrency(account.total_cop)}</strong></div>
                <div><span>Pagado</span><strong>{formatCurrency(registeredTotal - pendingTotal(account.payments))}</strong></div>
                <div className="account-balance"><span>Saldo por cobrar</span><strong>{formatCurrency(Math.max(balance, 0))}</strong></div>
              </section>

              {account.payments.length > 0 && (
                <section className="account-section">
                  <h3>Pagos</h3>
                  <ul className="account-payments">
                    {account.payments.map((payment) => (
                      <AccountPaymentRow key={payment.id} payment={payment} disabled={busy} onConfirm={confirmPayment} />
                    ))}
                  </ul>
                </section>
              )}

              {waitingHint() && <p className="account-hint">{waitingHint()}</p>}
            </>
          )}
        </div>

        {message && <p className="account-message" role="status">{message}</p>}

        {account && (
          <footer className="account-footer">
            {isDraft && (
              <>
                <button className="outline-button" type="button" disabled={busy} onClick={() => setPickerOpen(true)}><Plus size={15} /> Agregar productos</button>
                <button className="primary-button" type="button" disabled={busy || account.lines.length === 0} onClick={sendToKitchen}>Enviar a cocina</button>
                {account.payments.length === 0 && (
                  <button className="account-danger-button" type="button" disabled={busy} onClick={() => void cancelAccount()}><Trash2 size={14} /> Cancelar cuenta</button>
                )}
              </>
            )}
            {canCharge && (
              <button className="primary-button" type="button" disabled={busy} onClick={() => setPaymentOpen(true)}><Wallet size={15} /> Cobrar</button>
            )}
            {canClose && (
              <button className="primary-button" type="button" disabled={busy} onClick={() => void closeAccount()}><CheckCircle2 size={15} /> Cerrar cuenta</button>
            )}
          </footer>
        )}

        {pickerOpen && <AccountProductPicker onAddItems={addItems} onClose={() => setPickerOpen(false)} />}
        {paymentOpen && <PaymentDialog balance={Math.max(balance, 0)} onRegister={registerPayment} onClose={() => setPaymentOpen(false)} />}
      </aside>
    </div>
  );
}

function pendingTotal(payments: AccountPayment[]): number {
  return payments.reduce((sum: number, payment: AccountPayment) => (payment.status === 'pending' ? sum + payment.amount_cop : sum), 0);
}

type AccountPaymentRowProps = {
  payment: AccountPayment;
  disabled: boolean;
  onConfirm: (paymentId: string, reference: string) => Promise<string | null>;
};

function AccountPaymentRow({ payment, disabled, onConfirm }: AccountPaymentRowProps) {
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    const result = await onConfirm(payment.id, reference.trim());
    if (result) setError(result);
    else setReference('');
  };

  return (
    <li className="account-payment">
      <div className="account-payment-top">
        <div>
          <strong>{paymentMethodLabels[payment.method]}</strong>
          {payment.status === 'paid' && payment.reference && <span>Ref. {payment.reference}</span>}
        </div>
        <b>{formatCurrency(payment.amount_cop)}</b>
      </div>
      {payment.status === 'pending' ? (
        <form className="account-confirm" onSubmit={(event: React.FormEvent<HTMLFormElement>) => void submit(event)}>
          <input
            value={reference}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setReference(event.target.value)}
            placeholder="Referencia del banco"
            aria-label="Referencia del banco para confirmar el pago Bre-B"
          />
          <button className="outline-button" type="submit" disabled={disabled || !reference.trim()}>Confirmar</button>
          {error && <p className="auth-feedback error" role="alert">{error}</p>}
        </form>
      ) : (
        <span className="account-paid-tag"><CheckCircle2 size={13} /> Pagado</span>
      )}
    </li>
  );
}
