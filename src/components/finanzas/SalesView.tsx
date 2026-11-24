import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, WifiOff } from 'lucide-react';
import '@/components/finanzas/finance.css';
import { formatCurrency } from '@/lib/format';
import { methodLabels } from '@/lib/dashboardData';
import { clockTime, dayOf, endOfMonth, fetchSales, longDay, monthLabel, orderTypeLabels, shiftDate, type SaleRecord } from '@/lib/finance';
import { todayBogota } from '@/lib/workTime';

type Mode = 'dia' | 'mes';

/** Detalle de ventas, una por una, de un día o de un mes. Solo propietario y gerente. */
export function SalesView({ initialMode = 'dia' }: { initialMode?: Mode }) {
  const today = todayBogota();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [method, setMethod] = useState<'todos' | 'cash' | 'card' | 'bre_b'>('todos');
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const range = useMemo(() => (mode === 'dia' ? { from: day, to: day } : { from: `${month}-01`, to: endOfMonth(`${month}-01`) }), [mode, day, month]);

  const load = useCallback(async (): Promise<void> => {
    if (!range.from) return;
    setLoading(true);
    const result = await fetchSales(range.from, range.to);
    setSales(result.data);
    setError(result.error);
    setLoading(false);
  }, [range]);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => sales.filter((sale: SaleRecord) => method === 'todos' || sale.method === method), [sales, method]);
  const total = shown.reduce((sum: number, sale: SaleRecord) => sum + sale.amount_cop, 0);
  const orders = new Set(shown.map((sale: SaleRecord) => sale.order_id)).size;
  const byMethod = useMemo(() => {
    const totals = new Map<string, number>();
    for (const sale of sales) totals.set(sale.method, (totals.get(sale.method) ?? 0) + sale.amount_cop);
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [sales]);
  const groups = useMemo(() => {
    const map = new Map<string, SaleRecord[]>();
    for (const sale of shown) {
      const key = dayOf(sale.paid_at);
      map.set(key, [...(map.get(key) ?? []), sale]);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [shown]);

  const step = (delta: number): void => {
    if (mode === 'dia') setDay((current: string) => shiftDate(current, delta));
    else setMonth((current: string) => shiftDate(`${current}-15`, delta * 30).slice(0, 7));
  };
  const toggle = (id: string): void => setOpen((current: Set<string>) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const sameMonthAsToday = month === today.slice(0, 7);
  const atLimit = mode === 'dia' ? day >= today : sameMonthAsToday;

  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operación</p>
          <h1>Ventas</h1>
          <p className="muted">Cada pago recibido, uno por uno, de un día o de todo un mes. Toca una venta para ver qué se vendió.</p>
        </div>
      </div>

      <div className="fin-controls">
        <button className={`chip ${mode === 'dia' ? 'active' : ''}`} type="button" onClick={() => setMode('dia')}>Por día</button>
        <button className={`chip ${mode === 'mes' ? 'active' : ''}`} type="button" onClick={() => setMode('mes')}>Por mes</button>
        <button className="icon-button" type="button" aria-label="Anterior" onClick={() => step(-1)}><ChevronLeft size={16} /></button>
        {mode === 'dia'
          ? <input type="date" value={day} max={today} aria-label="Día" onChange={(event: React.ChangeEvent<HTMLInputElement>) => event.target.value && setDay(event.target.value)} />
          : <input type="month" value={month} max={today.slice(0, 7)} aria-label="Mes" onChange={(event: React.ChangeEvent<HTMLInputElement>) => event.target.value && setMonth(event.target.value)} />}
        <button className="icon-button" type="button" aria-label="Siguiente" disabled={atLimit} onClick={() => step(1)}><ChevronRight size={16} /></button>
        <span className="spacer" />
        <select value={method} aria-label="Medio de pago" onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setMethod(event.target.value as typeof method)}>
          <option value="todos">Todos los medios de pago</option>
          <option value="cash">Efectivo</option>
          <option value="card">Tarjeta</option>
          <option value="bre_b">Bre-B</option>
        </select>
      </div>
      <p className="fin-note">{mode === 'dia' ? longDay(day) : monthLabel(month)}</p>

      {error && <p className="auth-feedback error" role="alert">{error}</p>}
      {loading && <p className="muted">Cargando ventas...</p>}

      {!loading && !error && (
        <>
          <div className="fin-cards">
            <div className="fin-card"><span>Total vendido</span><strong>{formatCurrency(total)}</strong><small>{method === 'todos' ? 'Todos los medios' : methodLabels[method]}</small></div>
            <div className="fin-card"><span>Pagos</span><strong>{shown.length}</strong><small>{orders} pedidos</small></div>
            <div className="fin-card"><span>Ticket promedio</span><strong>{formatCurrency(orders > 0 ? Math.round(total / orders) : 0)}</strong><small>por pedido</small></div>
            {byMethod.map(([key, value]) => <div className="fin-card" key={key}><span>{methodLabels[key] ?? key}</span><strong>{formatCurrency(value)}</strong></div>)}
          </div>

          {shown.length === 0 && <p className="muted">No hay ventas en este {mode === 'dia' ? 'día' : 'mes'}{method !== 'todos' ? ' con ese medio de pago' : ''}.</p>}

          {groups.map(([key, list]) => (
            <section key={key}>
              {mode === 'mes' && (
                <div className="sale-day">{longDay(key)}<span>{list.length} pagos · {formatCurrency(list.reduce((sum: number, sale: SaleRecord) => sum + sale.amount_cop, 0))}</span></div>
              )}
              {list.map((sale: SaleRecord) => (
                <article className="sale-row" key={sale.payment_id}>
                  <button className="sale-head" type="button" aria-expanded={open.has(sale.payment_id)} onClick={() => toggle(sale.payment_id)}>
                    <span className="time">{clockTime(sale.paid_at)}</span>
                    <span>#{sale.order_number}</span>
                    <span className="meta">
                      {sale.table_name ?? orderTypeLabels[sale.order_type] ?? sale.order_type}{sale.guest_name ? ` · ${sale.guest_name}` : ''} · {sale.cashier_name}
                    </span>
                    <span className="tag">{methodLabels[sale.method] ?? sale.method}{sale.was_offline && <> <WifiOff size={11} aria-label="Sin internet" /></>}</span>
                    <strong>{formatCurrency(sale.amount_cop)}</strong>
                  </button>
                  {open.has(sale.payment_id) && (
                    <div className="sale-body">
                      <ul>
                        {sale.items.map((item, index) => (
                          <li key={index}><span>{item.quantity} × {item.name}</span><span>{formatCurrency(item.line_total_cop)}</span></li>
                        ))}
                      </ul>
                      <small className="muted">
                        {sale.was_offline ? 'Vendida sin internet y subida después. ' : ''}{sale.reference ? `Referencia: ${sale.reference}. ` : ''}Pago de {formatCurrency(sale.amount_cop)} del pedido #{sale.order_number}.
                      </small>
                    </div>
                  )}
                </article>
              ))}
            </section>
          ))}
          {sales.length >= 5000 && <p className="muted">Se muestran las 5.000 ventas más recientes del rango.</p>}
        </>
      )}
    </div>
  );
}
