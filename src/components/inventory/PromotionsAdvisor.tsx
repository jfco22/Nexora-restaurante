import { useCallback, useEffect, useState } from 'react';
import { Tag } from 'lucide-react';
import { FormProblem } from '@/components/FormProblem';
import { formatQuantity, type InventoryUnit } from '@/lib/inventory';
import {
  acceptPromotion, dismissPromotion, endPromotion, fetchPromotions, fetchPromotionSuggestions,
  type Promotion, type PromotionSuggestion,
} from '@/lib/promotions';

export function PromotionsAdvisor({ canManage }: { canManage: boolean }) {
  const [suggestions, setSuggestions] = useState<PromotionSuggestion[]>([]);
  const [active, setActive] = useState<Promotion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([fetchPromotionSuggestions(), fetchPromotions()]);
    setSuggestions(s.data);
    setActive(p.data.filter((x: Promotion) => x.is_current));
    setError(s.error ?? p.error);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, action: () => Promise<string | null>) => {
    setBusy(key);
    const problem = await action();
    setBusy(null);
    if (problem) setError(problem); else await load();
  };

  return (
    <section className="fresh-section">
      <h3><Tag size={16} /> Promociones que deberían existir</h3>
      <p className="muted">Puntaje = 40 % lo que se va a vencer + 60 % lo que más inventario (en pesos) hay. Sugiere qué insumo hay que mover; los platos que lo llevan son los que conviene promocionar.</p>
      {error && <FormProblem message={error} />}

      {active.length > 0 && (
        <div className="fresh-table-wrap">
          <table className="fresh-table">
            <thead><tr><th>Promoviendo</th><th>Hay</th><th>Platos</th><th>Hasta</th><th /></tr></thead>
            <tbody>
              {active.map((p: Promotion) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td>{formatQuantity(p.current_stock, p.unit as InventoryUnit)}</td>
                  <td>{p.used_in.length > 0 ? p.used_in.join(', ') : '—'}</td>
                  <td>{new Date(`${p.ends_on}T12:00:00-05:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' })}</td>
                  <td>{canManage && <button type="button" className="secondary-button" disabled={busy === p.id} onClick={() => void run(p.id, () => endPromotion(p.id))}>Terminar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {suggestions.length === 0 ? (
        <p className="muted">Por ahora ningún insumo pide promoción.</p>
      ) : suggestions.map((s: PromotionSuggestion) => (
        <article key={s.item_id} className="fresh-card watch">
          <header>
            <strong>{s.name}</strong>
            <span>{s.score}/100 <small className="muted">(vencer {s.expiry_score} · inventario {s.inventory_score})</small></span>
          </header>
          <p>{s.reason}</p>
          <p className="muted">
            Hay {formatQuantity(s.current_stock, s.unit as InventoryUnit)}
            {s.at_risk_qty > 0 ? `; podrían sobrar ~${formatQuantity(s.at_risk_qty, s.unit as InventoryUnit)}` : ''}.
            {s.used_in.length > 0 ? ` Promociona: ${s.used_in.join(', ')}.` : ''}
          </p>
          {canManage && (
            <div className="fresh-actions">
              <button type="button" className="primary-button" disabled={busy === s.item_id} onClick={() => void run(s.item_id, () => acceptPromotion(s, 3))}>Activar 3 días</button>
              <button type="button" className="secondary-button" disabled={busy === s.item_id} onClick={() => void run(s.item_id, () => dismissPromotion(s.item_id))}>Ahora no</button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
