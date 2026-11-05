import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Landmark, Banknote, CreditCard, RefreshCw, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import './cashier-orders.css';

type PaymentMethod = 'cash' | 'bre_b' | 'card';

type PendingOrder = {
  id: string;
  order_number: number;
  total_cop: number;
  guest_name: string | null;
  guest_phone: string | null;
  created_at: string;
  nexora_order_items: { product_name: string; quantity: number }[];
};

const methodOptions: { value: PaymentMethod; label: string; icon: React.ReactNode }[] = [
  { value: 'cash', label: 'Efectivo', icon: <Banknote size={15} /> },
  { value: 'bre_b', label: 'Bre-B', icon: <Landmark size={15} /> },
  { value: 'card', label: 'Tarjeta', icon: <CreditCard size={15} /> },
];

const approvalErrorMessage = (raw: string): string => {
  if (/inventario suficiente|ya fue aprobado|caja/i.test(raw)) return raw;
  return 'No pudimos aprobar el pago. Revisa la caja e inténtalo de nuevo.';
};

export function CashierOrders() {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadOrders = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from('nexora_orders')
      .select('id, order_number, total_cop, guest_name, guest_phone, created_at, nexora_order_items(product_name, quantity)')
      .eq('status', 'pending_payment')
      .order('created_at');
    setLoading(false);
    if (error) {
      setLoadError('No pudimos cargar los pedidos pendientes de pago.');
      return;
    }
    setOrders((data ?? []) as PendingOrder[]);
  }, []);

  useEffect(() => { void loadOrders(); }, [loadOrders]);

  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operación · Dinero</p>
          <h1>Caja</h1>
          <p className="muted">Aprueba los pagos de los pedidos. Al aprobar, el pedido pasa a cocina y se descuenta el inventario.</p>
        </div>
        <button className="outline-button" type="button" onClick={() => void loadOrders()}><RefreshCw size={15} /> Actualizar</button>
      </div>
      {loadError && <p className="auth-feedback error" role="alert">{loadError}</p>}
      {loading ? (
        <p className="kitchen-empty">Cargando pedidos...</p>
      ) : orders.length === 0 ? (
        <div className="cashier-empty"><CheckCircle2 size={28} /><strong>No hay pagos pendientes</strong><span>Los pedidos de clientes aparecerán aquí para aprobar el cobro.</span></div>
      ) : (
        <section className="cashier-list">
          {orders.map((order: PendingOrder) => <PendingOrderCard key={order.id} order={order} onApproved={loadOrders} />)}
        </section>
      )}
    </div>
  );
}

function PendingOrderCard({ order, onApproved }: { order: PendingOrder; onApproved: () => Promise<void> }) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = async (): Promise<void> => {
    setError(null);
    const cleanReference = reference.trim();
    if (method === 'bre_b' && !cleanReference) {
      setError('Escribe la referencia de la transferencia Bre-B para aprobar.');
      return;
    }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('approve_nexora_order_payment', {
      order_id_input: order.id,
      method_input: method,
      reference_input: method === 'bre_b' ? cleanReference : null,
    });
    setBusy(false);
    if (rpcError) {
      setError(approvalErrorMessage(rpcError.message));
      return;
    }
    await onApproved();
  };

  return (
    <article className="cashier-card">
      <header className="cashier-card-top">
        <div>
          <strong>Pedido #{order.order_number}</strong>
          <span className="cashier-guest"><UserRound size={13} /> {order.guest_name ?? 'Cliente'}{order.guest_phone ? ` · ${order.guest_phone}` : ''}</span>
        </div>
        <strong className="cashier-total">{formatCurrency(order.total_cop)}</strong>
      </header>
      <ul className="cashier-items">
        {order.nexora_order_items.map((item: { product_name: string; quantity: number }, index: number) => (
          <li key={index}><b>{item.quantity}×</b> {item.product_name}</li>
        ))}
      </ul>
      <div className="cashier-methods" role="radiogroup" aria-label="Medio de pago">
        {methodOptions.map((option) => (
          <button key={option.value} type="button" role="radio" aria-checked={method === option.value} className={method === option.value ? 'selected' : ''} onClick={() => setMethod(option.value)}>
            {option.icon} {option.label}
          </button>
        ))}
      </div>
      {method === 'bre_b' && (
        <label className="cashier-reference">
          Referencia Bre-B
          <input value={reference} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setReference(event.target.value)} placeholder="Número de referencia de la transferencia" />
        </label>
      )}
      {error && <p className="auth-feedback error" role="alert">{error}</p>}
      <button className="primary-button full-width" type="button" disabled={busy} onClick={() => void approve()}>
        <CheckCircle2 size={16} /> {busy ? 'Aprobando...' : 'Aprobar pago'}
      </button>
    </article>
  );
}
