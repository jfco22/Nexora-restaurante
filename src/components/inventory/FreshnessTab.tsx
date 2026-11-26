import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Megaphone } from 'lucide-react';
import { FormProblem } from '@/components/FormProblem';
import { fetchFreshness, saveShelfLife, shelfLifeProblem, type FreshnessRow } from '@/lib/freshness';
import { formatQuantity, type InventoryUnit } from '@/lib/inventory';
import '@/components/inventory/freshness.css';

const days = (value: number | null): string => (value === null ? '—' : `${Number.isInteger(Number(value)) ? Number(value) : Number(value).toFixed(1)} d`);

/** Insumos que se están quedando guardados más de lo normal, para actuar antes de que se dañen. */
export function FreshnessTab() {
  const [rows, setRows] = useState<FreshnessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const result = await fetchFreshness();
    setRows(result.rows);
    setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const alerts = useMemo(() => rows.filter((row: FreshnessRow) => row.level === 'alert'), [rows]);
  const watch = useMemo(() => rows.filter((row: FreshnessRow) => row.level === 'watch'), [rows]);

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

          {[...alerts, ...watch].map((row: FreshnessRow) => (
            <article key={row.item_id} className={`fresh-card ${row.level}`}>
              <div className="fresh-card-top">
                <strong>{row.level === 'alert' ? <AlertTriangle size={16} /> : <Clock size={16} />} {row.name}</strong>
                <span>Hay {formatQuantity(row.current_stock, row.unit as InventoryUnit)}</span>
              </div>
              <p>{row.reason}</p>
              {row.used_in.length > 0 && (
                <p className="fresh-promo"><Megaphone size={14} /> Para moverlo: promoción en {row.used_in.join(', ')}.</p>
              )}
            </article>
          ))}

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
