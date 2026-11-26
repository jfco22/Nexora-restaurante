import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { FormProblem } from '@/components/FormProblem';
import { formatCurrency } from '@/lib/format';
import { ageHours, ageLabel, cancelStuckOrder, fetchOpenOrders, statusLabels, STALE_HOURS, type OpenOrder } from '@/lib/openOrders';
import '@/components/finanzas/finance.css';

type Props = { canManage: boolean; onOpenCaja: () => void; onOpenKitchen: () => void; onOpenSalon: () => void; onChanged: () => void };

/** Detalle de lo que cuentan "Pendiente por cobrar" y "Pedidos abiertos": cada pedido, su estado, cuánto lleva y qué hacer. */
export function OpenOrdersView({ canManage, onOpenCaja, onOpenKitchen, onOpenSalon, onChanged }: Props) {
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchOpenOrders();
    setOrders(r.data);
    setError(r.error);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const unpaid = orders.filter((o: OpenOrder) => o.payment_status === 'unpaid' || o.payment_status === 'pending');
  const unpaidTotal = unpaid.reduce((sum: number, o: OpenOrder) => sum + o.total_cop, 0);
  const inProgress = orders.filter((o: OpenOrder) => o.status !== 'completed');
  const stale = orders.filter((o: OpenOrder) => ageHours(o.created_at) > STALE_HOURS);

  const cancel = async (o: OpenOrder): Promise<void> => {
    if (!window.confirm(`¿Anular el pedido #${o.order_number} por ${formatCurrency(o.total_cop)}? No se cobra ni se descuenta inventario.`)) return;
    setBusy(o.id);
    const problem = await cancelStuckOrder(o.id);
    setBusy(null);
    setError(problem);
    if (!problem) { await load(); onChanged(); }
  };

  const where = (o: OpenOrder): string => o.nexora_tables?.name ? `Mesa ${o.nexora_tables.name}` : o.guest_name ? `${o.guest_name} · ${o.order_type === 'delivery' ? 'domicilio' : 'para llevar'}` : o.order_type === 'delivery' ? 'Domicilio' : o.order_type === 'takeaway' ? 'Para llevar' : 'Salón';

  const action = (o: OpenOrder): { label: string; run: () => void } | null =>
    o.status === 'pending_payment' ? { label: 'Ir a Caja', run: onOpenCaja }
    : o.status === 'completed' ? { label: 'Ir a Salón', run: onOpenSalon }
    : { label: 'Ver cocina', run: onOpenKitchen };

  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operación</p>
          <h1>Pedidos abiertos y por cobrar</h1>
          <p className="muted">Estos son los pedidos que suman en las dos tarjetas del inicio. Cada uno dice en qué paso está y cuánto lleva.</p>
        </div>
        <button className="outline-button" type="button" onClick={() => void load()}><RefreshCw size={15} /> Actualizar</button>
      </div>
      {error && <FormProblem message={error} />}

      <div className="fin-cards">
        <div className="fin-card"><span>Pendiente por cobrar</span><strong>{formatCurrency(unpaidTotal)}</strong><small>{unpaid.length} {unpaid.length === 1 ? 'pedido' : 'pedidos'} sin pagar</small></div>
        <div className="fin-card"><span>Pedidos abiertos</span><strong>{inProgress.length}</strong><small>en caja, cocina o por entregar</small></div>
        <div className={`fin-card ${stale.length > 0 ? 'negative' : 'positive'}`}><span>Olvidados (más de {STALE_HOURS} h)</span><strong>{stale.length}</strong><small>{stale.length > 0 ? 'revísalos o anúlalos' : 'ninguno'}</small></div>
      </div>

      {loading ? <p className="muted">Cargando…</p> : orders.length === 0 ? (
        <p className="muted">No hay pedidos abiertos ni por cobrar. Si el inicio aún muestra cifras, toca “Actualizar” allá.</p>
      ) : (
        <div className="fin-split" style={{ gridTemplateColumns: '1fr' }}>
          <table className="fin-table">
            <thead><tr><th>Pedido</th><th>Dónde</th><th>Qué pidió</th><th>Estado</th><th>Lleva</th><th className="num">Total</th><th /></tr></thead>
            <tbody>
              {orders.map((o: OpenOrder) => {
                const old = ageHours(o.created_at) > STALE_HOURS;
                const a = action(o);
                const items = (o.nexora_order_items ?? []).map((i) => `${i.quantity}× ${i.product_name}`).join(', ');
                return (
                  <tr key={o.id}>
                    <td><strong>#{o.order_number}</strong></td>
                    <td>{where(o)}</td>
                    <td>{items || <span className="muted">sin productos</span>}</td>
                    <td>{statusLabels[o.status] ?? o.status}{o.payment_status === 'paid' ? '' : ' · sin pagar'}</td>
                    <td style={old ? { color: '#b3321b', fontWeight: 700 } : undefined}>{ageLabel(o.created_at)}{old ? ' ⚠' : ''}</td>
                    <td className="num">{formatCurrency(o.total_cop)}</td>
                    <td>
                      {a && <button type="button" className="outline-button" onClick={a.run}>{a.label}</button>}
                      {canManage && (o.status === 'pending_payment') && <button type="button" className="outline-button" disabled={busy === o.id} onClick={() => void cancel(o)}>Anular</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {stale.length > 0 && <p className="muted">⚠ Un pedido con más de {STALE_HOURS} horas casi siempre es de prueba o quedó olvidado. Si estaba esperando pago en caja y ya no existe, anúlalo para que deje de contar.</p>}
        </div>
      )}
    </div>
  );
}
