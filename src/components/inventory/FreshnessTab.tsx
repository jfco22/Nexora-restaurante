import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Megaphone, ShoppingBasket, TrendingUp } from 'lucide-react';
import { FormProblem } from '@/components/FormProblem';
import { formatCurrency } from '@/lib/format';
import { fetchInsights, fetchPurchaseForecast, fetchSalesForecast, sendFeedback, type Insight, type PurchaseForecast, type SalesForecast } from '@/lib/assistant';
import { fetchFreshness, saveShelfLife, shelfLifeProblem, type FreshnessRow } from '@/lib/freshness';
import { formatQuantity, type InventoryUnit } from '@/lib/inventory';
import '@/components/inventory/freshness.css';

const days = (value: number | null): string => (value === null ? '—' : `${Number.isInteger(Number(value)) ? Number(value) : Number(value).toFixed(1)} d`);

/** Insumos que se están quedando guardados más de lo normal, para actuar antes de que se dañen. */
export function FreshnessTab({ canSeeSales = false }: { canSeeSales?: boolean }) {
  const [rows, setRows] = useState<FreshnessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [purchases, setPurchases] = useState<PurchaseForecast[]>([]);
  const [horizon, setHorizon] = useState(7);
  const [sales, setSales] = useState<SalesForecast[]>([]);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const [result, smart] = await Promise.all([fetchFreshness(), fetchInsights()]);
    setRows(result.rows);
    // Si el asistente aún no está activado en la base, se usan las alertas simples.
    setInsights(smart.error ? null : smart.data);
    setError(result.error);
    setLoading(false);
  }, []);

  const loadForecasts = useCallback(async (): Promise<void> => {
    const bought = await fetchPurchaseForecast(horizon);
    setPurchases(bought.error ? [] : bought.data);
    if (canSeeSales) {
      const expected = await fetchSalesForecast();
      setSales(expected.error ? [] : expected.data);
    }
  }, [horizon, canSeeSales]);

  useEffect(() => { void loadForecasts(); }, [loadForecasts]);

  const answer = async (itemId: string, kind: 'handled' | 'false_alarm'): Promise<void> => {
    const failure = await sendFeedback(itemId, kind);
    setFeedbackError(failure);
    if (!failure) await load();
  };

  useEffect(() => { void load(); }, [load]);

  type Card = { item_id: string; name: string; unit: string; current_stock: number; level: 'alert' | 'watch' | 'ok'; reason: string | null; used_in: string[] };
  const source: Card[] = insights ?? rows;
  const alerts = useMemo(() => source.filter((row: Card) => row.level === 'alert'), [source]);
  const watch = useMemo(() => source.filter((row: Card) => row.level === 'watch'), [source]);

  return (
    <section className="fresh-tab">
      <p className="inventory-intro">
        Cuenta cuántos días lleva guardado lo más viejo de cada insumo (lo que se compró primero se gasta primero). Si tiene un límite de días,
        como las empanadas o las hamburguesitas, avisa cuando lo pasa para que hagas una promoción. Si no tiene límite, lo compara con lo que
        normalmente tarda en gastarse (promedio de los últimos lotes) y avisa cuando se está estancando, como tomates o cebollas.
      </p>

      {error && <p className="auth-feedback error" role="alert">{error}</p>}
      {loading && <p className="muted">Revisando el inventario...</p>}

      {!loading && !error && (
        <>
          <div className="fresh-summary">
            <div className={`fresh-count ${alerts.length > 0 ? 'alert' : ''}`}><strong>{alerts.length}</strong><span>para actuar ya</span></div>
            <div className={`fresh-count ${watch.length > 0 ? 'watch' : ''}`}><strong>{watch.length}</strong><span>por vigilar</span></div>
          </div>

          {alerts.length === 0 && watch.length === 0 && <p className="muted">Nada se está estancando por ahora. Todo está rotando dentro de lo normal.</p>}

          {feedbackError && <p className="auth-feedback error" role="alert">{feedbackError}</p>}
          {[...alerts, ...watch].map((row: Card) => (
            <article key={row.item_id} className={`fresh-card ${row.level}`}>
              <div className="fresh-card-top">
                <strong>{row.level === 'alert' ? <AlertTriangle size={16} /> : <Clock size={16} />} {row.name}</strong>
                <span>Hay {formatQuantity(row.current_stock, row.unit as InventoryUnit)}</span>
              </div>
              <p>{row.reason}</p>
              {row.used_in.length > 0 && (
                <p className="fresh-promo"><Megaphone size={14} /> Para moverlo: promoción en {row.used_in.join(', ')}.</p>
              )}
              {insights && (
                <div className="fresh-actions">
                  <button className="outline-button" type="button" onClick={() => void answer(row.item_id, 'handled')}>Ya lo atendí</button>
                  <button className="outline-button" type="button" onClick={() => void answer(row.item_id, 'false_alarm')}>Falsa alarma</button>
                </div>
              )}
            </article>
          ))}

          {insights === null && <p className="muted">El asistente que predice y aprende todavía no está activado en la base de datos; mientras tanto se muestran las alertas simples.</p>}

          <section className="fresh-section">
            <h3><ShoppingBasket size={16} /> Qué comprar</h3>
            <div className="fresh-horizon">
              {[3, 7, 14].map((days: number) => (
                <button key={days} type="button" className={`chip ${horizon === days ? 'active' : ''}`} onClick={() => setHorizon(days)}>Próximos {days} días</button>
              ))}
            </div>
            {purchases.length === 0 ? (
              <p className="muted">Aún no hay suficiente consumo registrado para predecir. A medida que se vende y se registran compras, el asistente aprende cuánto gastas cada día de la semana.</p>
            ) : (
              <div className="fresh-table-wrap">
                <table className="fresh-table">
                  <thead><tr><th>Insumo</th><th>Hay</th><th>Se gastará</th><th>Alcanza para</th><th>Conviene comprar</th><th>Confianza</th></tr></thead>
                  <tbody>
                    {purchases.map((row: PurchaseForecast) => (
                      <tr key={row.item_id} className={row.days_of_cover !== null && row.days_of_cover < 2 ? 'watch' : ''}>
                        <td>{row.name}</td>
                        <td>{formatQuantity(row.current_stock, row.unit as InventoryUnit)}</td>
                        <td>{formatQuantity(row.need_qty, row.unit as InventoryUnit)}</td>
                        <td>{row.days_of_cover === null ? `${horizon}+ días` : `${days(row.days_of_cover)}`}</td>
                        <td>{row.suggest_buy > 0 ? <strong>{formatQuantity(row.suggest_buy, row.unit as InventoryUnit)}</strong> : 'No hace falta'}{row.horizon_used < horizon ? <small className="muted"> (solo para {row.horizon_used} d, por lo que dura)</small> : null}</td>
                        <td>{row.confidence} <small className="muted">({row.history_days} d de datos)</small></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted">Se calcula con lo que gastaste el mismo día de la semana en las últimas semanas. Con pocos días de datos la confianza es baja y mejora sola con el uso.</p>
              </div>
            )}
          </section>

          {canSeeSales && sales.length > 0 && (
            <section className="fresh-section">
              <h3><TrendingUp size={16} /> Ventas esperadas</h3>
              <div className="fresh-table-wrap">
                <table className="fresh-table">
                  <thead><tr><th>Día</th><th>Esperado</th><th>Rango normal</th><th>Días usados</th></tr></thead>
                  <tbody>
                    {sales.map((row: SalesForecast) => (
                      <tr key={row.day}>
                        <td>{new Date(`${row.day}T12:00:00-05:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'America/Bogota' })}</td>
                        <td>{row.days_used === 0 ? 'sin datos (¿cerrado?)' : <strong>{formatCurrency(row.expected_cop)}</strong>}</td>
                        <td>{row.days_used === 0 ? '—' : `${formatCurrency(row.low_cop)} a ${formatCurrency(row.high_cop)}`}</td>
                        <td>{row.days_used}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted">Promedio del mismo día de la semana, solo en días que abriste.</p>
              </div>
            </section>
          )}

          <button className="outline-button" type="button" onClick={() => setShowAll((value: boolean) => !value)}>
            {showAll ? 'Ocultar todos los insumos' : 'Ver todos los insumos y poner límites de días'}
          </button>

          {showAll && (
            <div className="fresh-table-wrap">
              <table className="fresh-table">
                <thead><tr><th>Insumo</th><th>Hay</th><th>Lleva guardado</th><th>Normalmente se gasta en</th><th>Límite de días</th></tr></thead>
                <tbody>{rows.map((row: FreshnessRow) => <LimitRow key={row.item_id} row={row} onSaved={load} />)}</tbody>
              </table>
              <p className="muted">"Normalmente se gasta en" necesita al menos 3 lotes ya gastados. Pon un límite de días a lo que dura poco (empanadas, hamburguesitas, panes) y déjalo vacío en lo demás.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function LimitRow({ row, onSaved }: { row: FreshnessRow; onSaved: () => Promise<void> }) {
  const [text, setText] = useState(row.shelf_life_days === null ? '' : String(row.shelf_life_days));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const original = row.shelf_life_days === null ? '' : String(row.shelf_life_days);
  const problem = shelfLifeProblem(text);
  const changed = text.trim() !== original;

  const save = async (): Promise<void> => {
    if (problem || !changed || busy) return;
    setBusy(true);
    const failure = await saveShelfLife(row.item_id, text.trim() === '' ? null : Number(text));
    setBusy(false);
    if (failure) { setError(failure); return; }
    setError(null);
    await onSaved();
  };

  return (
    <tr className={row.level}>
      <td>{row.name}</td>
      <td>{formatQuantity(row.current_stock, row.unit as InventoryUnit)}</td>
      <td>{days(row.oldest_age_days)}</td>
      <td>{row.batches_measured >= 3 ? days(row.avg_rotation_days) : 'sin historial'}</td>
      <td>
        <div className="fresh-limit">
          <input inputMode="numeric" value={text} placeholder="sin límite" aria-label={`Límite de días de ${row.name}`} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setText(event.target.value)} />
          <button className="outline-button" type="button" disabled={!changed || Boolean(problem) || busy} onClick={() => void save()}>Guardar</button>
        </div>
        {changed && <FormProblem message={problem} />}
        {error && <small className="form-problem-inline">{error}</small>}
      </td>
    </tr>
  );
}
