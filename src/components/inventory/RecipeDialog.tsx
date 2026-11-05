import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import '@/components/salon/account.css';
import {
  deactivateRecipeLine,
  formatQuantity,
  saveRecipeLine,
  type CatalogProduct,
  type InventoryItem,
  type RecipeLine,
} from '@/lib/inventory';

type RecipeDialogProps = {
  product: CatalogProduct;
  items: InventoryItem[];
  lines: RecipeLine[];
  onChanged: () => Promise<void>;
  onClose: () => void;
};

export function RecipeDialog({ product, items, lines, onChanged, onClose }: RecipeDialogProps) {
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedItem = items.find((item: InventoryItem) => item.id === itemId);
  const parsedQuantity = Number(quantity);
  const quantityValid = quantity.trim() !== '' && Number.isFinite(parsedQuantity) && parsedQuantity > 0 && parsedQuantity <= 1000000;
  const canAdd = Boolean(selectedItem) && quantityValid && !busy;

  const addLine = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canAdd || !selectedItem) return;
    setBusy(true);
    setError(null);
    const failure = await saveRecipeLine(product.id, selectedItem.id, parsedQuantity);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setQuantity('');
    await onChanged();
  };

  const removeLine = async (line: RecipeLine): Promise<void> => {
    setBusy(true);
    setError(null);
    const failure = await deactivateRecipeLine(line.product_id, line.item_id);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    await onChanged();
  };

  return (
    <div className="account-modal-layer" role="dialog" aria-modal="true" aria-label={`Receta de ${product.name}`}>
      <div className="account-modal inventory-modal">
        <header className="account-header">
          <div>
            <p className="eyebrow">Receta</p>
            <h2>{product.name}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}><X size={17} /></button>
        </header>

        <div className="inventory-form">
          {lines.length === 0 && <p className="inventory-empty">Este plato no descuenta insumos todavía.</p>}

          {lines.length > 0 && (
            <ul className="recipe-lines">
              {lines.map((line: RecipeLine) => {
                const item = items.find((candidate: InventoryItem) => candidate.id === line.item_id);
                return (
                  <li key={line.item_id}>
                    <div>
                      <strong>{item?.name ?? 'Insumo desactivado'}</strong>
                      <small>{item ? formatQuantity(line.quantity, item.unit) : ''} por plato</small>
                    </div>
                    <button className="icon-button" type="button" aria-label={`Quitar ${item?.name ?? 'insumo'}`} disabled={busy} onClick={() => void removeLine(line)}>
                      <Trash2 size={15} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {items.length === 0 ? (
            <p className="inventory-empty">Primero crea insumos en la pestaña Insumos.</p>
          ) : (
            <form className="recipe-add" onSubmit={(event: React.FormEvent<HTMLFormElement>) => void addLine(event)}>
              <p className="recipe-add-title">Agregar o actualizar un insumo</p>
              <div className="inventory-form-row">
                <label>
                  Insumo
                  <select value={itemId} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setItemId(event.target.value)}>
                    {items.map((item: InventoryItem) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label>
                  Cantidad {selectedItem ? `(${selectedItem.unit})` : ''}
                  <input type="number" inputMode="decimal" min={0} step="any" value={quantity} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuantity(event.target.value)} />
                </label>
              </div>
              <button className="outline-button full-width" type="submit" disabled={!canAdd}>
                {busy ? 'Guardando...' : 'Guardar en la receta'}
              </button>
            </form>
          )}

          {error && <p className="auth-feedback error" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  );
}
