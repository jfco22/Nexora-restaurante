import { NumberInput } from '@/components/NumberInput';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChefHat, Upload, X } from 'lucide-react';
import { fetchCatalogForRecipes, formatQuantity, type CatalogProduct, type InventoryItem, type RecipeLine } from '@/lib/inventory';
import { cookPreparation, fetchPreparations, parseBatches, portionsFromQuantity, type PortionInfo, type Preparation } from '@/lib/preparations';
import { PreparationImportDialog } from '@/components/inventory/PreparationImportDialog';

/** restricted: rol cocina; solo ve lo que puede cocinar, sin importar ni ver recetas de platos. */
type PreparationsTabProps = { items: InventoryItem[]; onChanged: () => Promise<void>; restricted?: boolean };

const portionsText = (portions: PortionInfo[]): string =>
  portions.length === 0 ? 'Ningún plato usa todavía este insumo en su receta.' : portions.map((info: PortionInfo) => `${info.portions} × ${info.name}`).join(' · ');

export function PreparationsTab({ items, onChanged, restricted = false }: PreparationsTabProps) {
  const [preparations, setPreparations] = useState<Preparation[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [recipeLines, setRecipeLines] = useState<RecipeLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [cooking, setCooking] = useState<Preparation | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const [prepResult, catalog] = await Promise.all([fetchPreparations(), fetchCatalogForRecipes()]);
    setPreparations(prepResult.preparations);
    setProducts(catalog.products);
    setRecipeLines(catalog.recipeLines);
    setError(prepResult.error ?? catalog.error);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const itemById = useMemo(() => new Map(items.map((item: InventoryItem) => [item.id, item])), [items]);
  const sorted = [...preparations].sort((a: Preparation, b: Preparation) =>
    (itemById.get(a.output_item_id)?.name ?? '').localeCompare(itemById.get(b.output_item_id)?.name ?? '', 'es'));

  const afterChange = async (): Promise<void> => {
    await Promise.all([load(), onChanged()]);
  };

  return (
    <section className="inventory-section">
      {restricted ? (
        <p className="inventory-intro">Aquí puedes registrar la tanda de Pico de gallo. Se descuentan los insumos crudos y se suma lo preparado.</p>
      ) : (
      <p className="inventory-intro">
        Una preparación es algo que cocinas por tandas (birria, carne de hamburguesa). Al cocinar, se descuentan los insumos crudos y se suma lo cocinado;
        los platos que usan esa preparación en su receta se agotan cuando se acaba.
      </p>
      )}
      {!restricted && (
        <div className="inventory-toolbar">
          <button className="outline-button" type="button" onClick={() => setImportOpen(true)}><Upload size={16} /> Importar preparaciones</button>
        </div>
      )}

      {error && <p className="auth-feedback error" role="alert">{error}</p>}
      {notice && <p className="auth-feedback success" role="status">{notice}</p>}

      {loaded && sorted.length === 0 && (
        <p className="inventory-empty">Todavía no hay preparaciones. Importa un archivo con la receta de la tanda (Preparación, Rinde, Insumo, Cantidad).</p>
      )}

      {loaded && sorted.length > 0 && (
        <ul className="recipe-list">
          {sorted.map((prep: Preparation) => {
            const output = itemById.get(prep.output_item_id);
            if (!output) return null;
            const outputs = [
              { item_id: prep.output_item_id, quantity: prep.yield_quantity },
              ...prep.extraOutputs,
            ].flatMap((entry) => {
              const item = itemById.get(entry.item_id);
              return item ? [{ item, perBatch: entry.quantity }] : [];
            });
            return (
              <li key={prep.id}>
                <div className="recipe-row preparation-row">
                  <div>
                    <strong>{output.name}</strong>
                    <small>{prep.lines.length} insumos por tanda</small>
                    {outputs.map((entry) => (
                      <small key={entry.item.id}>
                        {entry.item.name}: rinde {formatQuantity(entry.perBatch, entry.item.unit)} por tanda · hay {formatQuantity(entry.item.current_stock, entry.item.unit)}
                        {!restricted && <>{' → '}{portionsText(portionsFromQuantity(entry.item.id, Math.max(entry.item.current_stock, 0), products, recipeLines))}</>}
                      </small>
                    ))}
                  </div>
                  <button className="primary-button" type="button" onClick={() => { setNotice(null); setCooking(prep); }}><ChefHat size={16} /> Cocinar</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {cooking && (
        <CookDialog
          preparation={cooking}
          itemById={itemById}
          products={products}
          recipeLines={recipeLines}
          restricted={restricted}
          onClose={() => setCooking(null)}
          onCooked={async (message: string) => { setCooking(null); setNotice(message); await afterChange(); }}
        />
      )}
      {importOpen && <PreparationImportDialog onClose={() => setImportOpen(false)} onImported={afterChange} />}
    </section>
  );
}

type CookDialogProps = {
  preparation: Preparation;
  itemById: Map<string, InventoryItem>;
  products: CatalogProduct[];
  recipeLines: RecipeLine[];
  restricted: boolean;
  onClose: () => void;
  onCooked: (message: string) => Promise<void>;
};

function CookDialog({ preparation, itemById, products, recipeLines, restricted, onClose, onCooked }: CookDialogProps) {
  const [batchesText, setBatchesText] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const output = itemById.get(preparation.output_item_id);
  const batches = parseBatches(batchesText);

  const rows = preparation.lines.map((line) => {
    const item = itemById.get(line.item_id);
    const needed = batches === null ? 0 : Math.round(line.quantity * batches * 1000) / 1000;
    return { line, item, needed, short: item ? item.current_stock < needed : true };
  });
  const missing = rows.filter((row) => row.short);
  const producedRows = [{ item_id: preparation.output_item_id, quantity: preparation.yield_quantity }, ...preparation.extraOutputs].flatMap((entry) => {
    const item = itemById.get(entry.item_id);
    if (!item) return [];
    const produced = batches === null ? 0 : Math.round(entry.quantity * batches * 1000) / 1000;
    const newStock = item.current_stock + produced;
    return [{ item, produced, newStock, portions: portionsFromQuantity(item.id, Math.max(newStock, 0), products, recipeLines) }];
  });
  const newStock = (output?.current_stock ?? 0) + (producedRows[0]?.produced ?? 0);

  if (!output) return null;

  const submit = async (): Promise<void> => {
    if (batches === null || missing.length > 0) return;
    setBusy(true);
    setError(null);
    const message = await cookPreparation(preparation.id, batches);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    await onCooked(`Listo: se cocinaron ${batches} tanda(s) de ${output.name}. Ahora hay ${formatQuantity(newStock, output.unit)}.`);
  };

  return (
    <div className="account-modal-layer" role="dialog" aria-modal="true" aria-label={`Cocinar ${output.name}`}>
      <div className="account-modal inventory-modal">
        <header className="account-header">
          <div>
            <p className="eyebrow">Cocinar</p>
            <h2>{output.name}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose} disabled={busy}><X size={17} /></button>
        </header>

        <div className="inventory-form">
          <label>
            ¿Cuántas tandas?
            <NumberInput value={batchesText} onChange={setBatchesText} decimals />
          </label>

          <div className="inventory-preview">
            <span>Se descuentan del inventario:</span>
            <ul className="cook-lines">
              {rows.map((row) => (
                <li key={row.line.item_id} className={row.short ? 'cook-short' : ''}>
                  <span>{row.item?.name ?? 'Insumo'}</span>
                  <span>{row.item ? formatQuantity(row.needed, row.item.unit) : '—'} <small>(hay {row.item ? formatQuantity(row.item.current_stock, row.item.unit) : '—'})</small></span>
                </li>
              ))}
            </ul>
          </div>

          <div className="inventory-preview">
            <span>Se suman al inventario</span>
            {producedRows.map((row) => (
              <div key={row.item.id}>
                <strong>{formatQuantity(row.produced, row.item.unit)} de {row.item.name}</strong>
                <small>Quedará en {formatQuantity(row.newStock, row.item.unit)} {!restricted && <> = {portionsText(row.portions)}</>}</small>
              </div>
            ))}
          </div>

          {batches === null && <p className="auth-feedback error" role="alert">Escribe un número de tandas entre 0,5 y 100.</p>}
          {batches !== null && missing.length > 0 && (
            <p className="auth-feedback error" role="alert">
              No alcanza el inventario de: {missing.map((row) => row.item?.name ?? 'insumo').join(', ')}. Registra la compra o el conteo en Insumos, o cocina menos tandas.
            </p>
          )}
          {error && <p className="auth-feedback error" role="alert">{error}</p>}
        </div>

        <div className="inventory-form-footer">
          <button className="primary-button full-width" type="button" onClick={() => void submit()} disabled={busy || batches === null || missing.length > 0}>
            {busy ? 'Cocinando...' : 'Cocinar'}
          </button>
        </div>
      </div>
    </div>
  );
}
