import { useCallback, useEffect, useMemo, useState } from 'react';
import '@/components/finanzas/finance.css';
import { FormProblem } from '@/components/FormProblem';
import { formatCurrency } from '@/lib/format';
import { methodLabels } from '@/lib/dashboardData';
import { expenseCategories, fetchSummary, longDay, type ReportSummary } from '@/lib/finance';
import { shiftDate, startOfMonth, startOfWeek, todayBogota } from '@/lib/workTime';

type RangeKey = 'hoy' | 'semana' | 'mes' | 'mes_pasado' | 'rango';

/** Resultado del negocio en un período: ventas, compras, gastos, horas pagadas y lo que queda. */
export function ReportsView({ onOpenSales }: { onOpenSales: () => void }) {
  const today = todayBogota();
  const [range, setRange] = useState<RangeKey>('mes');
  const [customFrom, setCustomFrom] = useState(shiftDate(today, -29));
  const [customTo, setCustomTo] = useState(today);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { from, to } = useMemo((): { from: string; to: string } => {
    if (range === 'hoy') return { from: today, to: today };
    if (range === 'semana') return { from: startOfWeek(today), to: today };
    if (range === 'mes') return { from: startOfMonth(today), to: today };
    if (range === 'mes_pasado') {
      const lastDay = shiftDate(startOfMonth(today), -1);
      return { from: startOfMonth(lastDay), to: lastDay };
    }
    return { from: customFrom, to: customTo };
  }, [range, today, customFrom, customTo]);
  const rangeProblem = !from || !to ? 'Elige la fecha inicial y la final.' : to < from ? 'La fecha final no puede ser anterior a la inicial.' : null;

  const load = useCallback(async (): Promise<void> => {
    if (rangeProblem) { setSummary(null); setLoading(false); return; }
    setLoading(true);
    const result = await fetchSummary(from, to);
    setSummary(result.data);
    setError(result.error);
    setLoading(false);
  }, [from, to, rangeProblem]);

  useEffect(() => { void load(); }, [load]);

  const maxDay = summary ? Math.max(1, ...summary.by_day.map((entry) => Number(entry.total))) : 1;
  const maxProduct = summary ? Math.max(1, ...summary.top_products.map((entry) => Number(entry.quantity))) : 1;
  const costs = summary ? Number(summary.purchases_total) + Number(summary.expenses_total) + Number(summary.work_paid_total) : 0;

  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administración</p>
          <h1>Reportes</h1>
          <p className="muted">Cuánto vendiste, cuánto salió y cuánto quedó en el período que elijas.</p>
        </div>
        <button className="outline-button" type="button" onClick={onOpenSales}>Ver ventas una por una</button>
      </div>

      <div className="fin-controls">
        {([['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['mes_pasado', 'Mes pasado'], ['rango', 'Entre fechas']] as [RangeKey, string][]).map(([key, label]) => (
          <button key={key} className={`chip ${range === key ? 'active' : ''}`} type="button" onClick={() => setRange(key)}>{label}</button>
        ))}
        {range === 'rango' && (
          <>
            <input type="date" value={customFrom} max={today} aria-label="Desde" onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCustomFrom(event.target.value)} />
            <input type="date" value={customTo} max={today} aria-label="Hasta" onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCustomTo(event.target.value)} />
          </>
        )}
      </div>
      <FormProblem message={rangeProblem} />
      <p className="fin-note">Del {longDay(from)} al {longDay(to)}</p>
      {error && <p className="auth-feedback error" role="alert">{error}</p>}
      {loading && <p className="muted">Cargando reporte...</p>}

      {summary && !loading && (
        <>
          <div className="fin-cards">
            <div className="fin-card"><span>Ventas</span><strong>{formatCurrency(Number(summary.sales_total))}</strong><small>{summary.payments_count} pagos · {summary.orders_count} pedidos</small></div>
            <div className="fin-card"><span>Compras de insumos</span><strong>{formatCurrency(Number(summary.purchases_total))}</strong><small>según el inventario</small></div>
            <div className="fin-card"><span>Gastos</span><strong>{formatCurrency(Number(summary.expenses_total))}</strong></div>
            <div className="fin-card"><span>Horas pagadas</span><strong>{formatCurrency(Number(summary.work_paid_total))}</strong><small>pagos al personal</small></div>
            <div className={`fin-card ${Number(summary.result) < 0 ? 'negative' : 'positive'}`}><span>Queda</span><strong>{formatCurrency(Number(summary.result))}</strong><small>ventas − {formatCurrency(costs)}</small></div>
          </div>
          <p className="fin-note">"Queda" es una cuenta simple de caja: ventas menos compras, gastos y horas pagadas del período. No descuenta el costo del inventario que ya tenías.</p>

          <div className="fin-split">
            <section className="panel">
              <h2>Ventas por día</h2>
              {summary.by_day.length === 0 ? <p className="muted">Sin ventas en el período.</p> : (
                <table className="fin-table"><tbody>
                  {summary.by_day.map((entry) => (
                    <tr key={entry.day}>
                      <td>{longDay(entry.day)}</td>
                      <td style={{ width: '30%' }}><div className="fin-bar"><i style={{ width: `${Math.round((Number(entry.total) / maxDay) * 100)}%` }} /></div></td>
                      <td className="num">{formatCurrency(Number(entry.total))}</td>
                    </tr>
                  ))}
                </tbody></table>
              )}
            </section>

            <section className="panel">
              <h2>Medios de pago</h2>
              {summary.by_method.length === 0 ? <p className="muted">Sin ventas en el período.</p> : (
                <table className="fin-table"><tbody>
                  {summary.by_method.map((entry) => (
                    <tr key={entry.method}><td>{methodLabels[entry.method] ?? entry.method}</td><td className="num">{entry.count} pagos</td><td className="num">{formatCurrency(Number(entry.total))}</td></tr>
                  ))}
                </tbody></table>
              )}
              <h2 style={{ marginTop: 18 }}>Gastos por categoría</h2>
              {summary.expenses_by_category.length === 0 ? <p className="muted">Sin gastos en el período.</p> : (
                <table className="fin-table"><tbody>
                  {summary.expenses_by_category.map((entry) => (
                    <tr key={entry.category}><td>{expenseCategories[entry.category] ?? entry.category}</td><td className="num">{formatCurrency(Number(entry.total))}</td></tr>
                  ))}
                </tbody></table>
              )}
            </section>
          </div>

          <section className="panel">
            <h2>Lo más vendido</h2>
            {summary.top_products.length === 0 ? <p className="muted">Sin ventas en el período.</p> : (
              <table className="fin-table">
                <thead><tr><th>Producto</th><th></th><th className="num">Unidades</th><th className="num">Vendido</th></tr></thead>
                <tbody>
                  {summary.top_products.map((entry) => (
                    <tr key={entry.name}>
                      <td>{entry.name}</td>
                      <td style={{ width: '25%' }}><div className="fin-bar"><i style={{ width: `${Math.round((Number(entry.quantity) / maxProduct) * 100)}%` }} /></div></td>
                      <td className="num">{entry.quantity}</td>
                      <td className="num">{formatCurrency(Number(entry.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
