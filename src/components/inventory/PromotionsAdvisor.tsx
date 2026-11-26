import { useCallback, useEffect, useState } from 'react';
import { Tag } from 'lucide-react';
import { FormProblem } from '@/components/FormProblem';
import { formatCurrency } from '@/lib/format';
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
      <p className="muted">Puntaje = 40 % lo que se va a vencer + 60 % lo que más inventario (en pesos) hay. El descuento nunca baja del costo más 15 % de margen. Al aceptar, la promoción queda registrada; el descuento se aplica a mano al cobrar.</p>
      {error && <FormProblem message={error} />}

      {active.length > 0 && (
        <div className="fresh-table-wrap">
          <table className="fresh-table">
            <thead><tr><th>En promoción</th><th>Descuento</th><th>Precio</th><th>Hasta</th><th /></tr></thead>
            <tbody>
              {active.map((p: Promotion) => (
                <tr key={p.id}>
                  <td>{p.product_name}</td>
                  <td>{p.discount_pct} %</td>
                  <td><strong>{formatCurrency(p.promo_price_cop)}</strong> <small className="muted">(antes {formatCurrency(p.price_cop)})</small></td>
                  <td>{new Date(`${p.ends_on}T12:00:00-05:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' })}</td>
                  <td>{canManage && <button type="button" className="secondary-button" disabled={busy === p.id} onClick={() => void run(p.id, () => endPromotion(p.id))}>Terminar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {suggestions.length === 0 ? (
        <p className="muted">Por ahora no hay nada que pida promoción.</p>
      ) : suggestions.map((s: PromotionSuggestion) => (
        <article key={s.product_id} className="fresh-card watch">
          <header>
            <strong>{s.product_name}</strong>
            <span>{s.score}/100 <small className="muted">(vencer {s.expiry_score} · inventario {s.inventory_score})</small></span>
          </header>
          <p>{s.reason}</p>
          <p>
            Sugerido: <strong>{s.suggested_discount_pct} %</strong> → <strong>{formatCurrency(s.promo_price_cop)}</strong>
            {' '}<small className="muted">(precio {formatCurrency(s.price_cop)}{s.cost_cop !== null && s.cost_known ? `, costo ${formatCurrency(s.cost_cop)}` : ''}; alcanza para {s.portions_possible})</small>
          </p>
          {canManage && (
            <div className="fresh-actions">
              <button type="button" className="primary-button" disabled={busy === s.product_id} onClick={() => void run(s.product_id, () => acceptPromotion(s, 3))}>Activar 3 días</button>
              <button type="button" className="secondary-button" disabled={busy === s.product_id} onClick={() => void run(s.product_id, () => dismissPromotion(s.product_id))}>Ahora no</button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
