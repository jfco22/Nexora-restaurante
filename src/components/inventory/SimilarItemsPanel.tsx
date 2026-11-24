import { AlertTriangle } from 'lucide-react';
import type { NameDecision, SimilarHit, UnitDifference } from '@/lib/similarItems';

type SimilarItemsPanelProps = {
  hits: SimilarHit[];
  decisions: Record<string, NameDecision>;
  onDecide: (key: string, decision: NameDecision) => void;
  unitDifferences: UnitDifference[];
  /** Si se pasa, el cambio de unidad exige decidir (Excel de inventario sobrescribe la unidad). */
  unitDecisions?: Record<string, 'apply' | 'skip'>;
  onUnitDecide?: (key: string, decision: 'apply' | 'skip') => void;
  disabled?: boolean;
};

const unitLabel = (unit: string): string => (unit === 'unidad' ? 'unidades' : unit);

export function SimilarItemsPanel({ hits, decisions, onDecide, unitDifferences, unitDecisions, onUnitDecide, disabled }: SimilarItemsPanelProps) {
  if (hits.length === 0 && unitDifferences.length === 0) return null;
  return (
    <div className="similar-panel">
      {hits.length > 0 && (
        <>
          <h3><AlertTriangle size={16} /> Insumos que se parecen a otros que ya tienes</h3>
          <p className="muted">Decide en cada uno si es el mismo insumo (así no se duplica y se mantiene su stock) o si es distinto y se crea nuevo.</p>
          {hits.map((hit: SimilarHit) => (
            <fieldset key={hit.key} className={`similar-item ${decisions[hit.key] === undefined ? 'pending' : 'done'}`} disabled={disabled}>
              <legend>
                «{hit.name}»{hit.unit ? ` (${unitLabel(hit.unit)})` : ''} <small>filas {hit.rows.slice(0, 6).join(', ')}{hit.rows.length > 6 ? '…' : ''}</small>
              </legend>
              {hit.candidates.map((candidate) => (
                <label key={candidate.item.id} className="similar-option">
                  <input type="radio" name={`similar-${hit.key}`} checked={decisions[hit.key] === candidate.item.id} onChange={() => onDecide(hit.key, candidate.item.id)} />
                  <span>
                    Es el mismo: usar «{candidate.item.name}» ({unitLabel(candidate.item.unit)}){candidate.item.archived ? ' · archivado, se reactiva' : ''}
                    {candidate.unitDiffers && <em className="similar-unit-warning"> · ojo: el archivo lo trae en {unitLabel(hit.unit ?? '')} y el insumo está en {unitLabel(candidate.item.unit)}</em>}
                  </span>
                </label>
              ))}
              <label className="similar-option">
                <input type="radio" name={`similar-${hit.key}`} checked={decisions[hit.key] === 'new'} onChange={() => onDecide(hit.key, 'new')} />
                <span>Es distinto, crear «{hit.name}» como insumo nuevo</span>
              </label>
            </fieldset>
          ))}
        </>
      )}

      {unitDifferences.length > 0 && (
        <>
          <h3><AlertTriangle size={16} /> Cambios de unidad</h3>
          <ul className="similar-units">
            {unitDifferences.map((diff: UnitDifference) => (
              <li key={diff.key}>
                <strong>{diff.item.name}</strong>: el insumo está en {unitLabel(diff.item.unit)} y el archivo lo trae en {unitLabel(diff.fileUnit)}.
                {unitDecisions && onUnitDecide ? (
                  <span className="similar-unit-choice">
                    <label><input type="radio" name={`unit-${diff.key}`} checked={unitDecisions[diff.key] === 'skip'} onChange={() => onUnitDecide(diff.key, 'skip')} disabled={disabled} /> Dejarlo como está (omitir esta fila)</label>
                    <label><input type="radio" name={`unit-${diff.key}`} checked={unitDecisions[diff.key] === 'apply'} onChange={() => onUnitDecide(diff.key, 'apply')} disabled={disabled} /> Cambiar la unidad a {unitLabel(diff.fileUnit)} (el stock del archivo se toma en esa unidad)</label>
                  </span>
                ) : diff.convertible ? (
                  <span className="muted"> Se convierte solo a {unitLabel(diff.item.unit)}.</span>
                ) : (
                  <span className="similar-unit-warning"> No se pueden convertir: esas filas se omiten. Corrige la unidad en el archivo o usa la del insumo.</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
