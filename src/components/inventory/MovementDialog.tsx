import { useState } from 'react';
import { X } from 'lucide-react';
import '@/components/salon/account.css';
import {
  formatQuantity,
  movementLabels,
  registerInventoryMovement,
  type InventoryItem,
  type MovementKind,
} from '@/lib/inventory';
import { formatCurrency } from '@/lib/format';

const kindOptions: { value: MovementKind; hint: string }[] = [
  { value: 'purchase', hint: 'Suma al stock y actualiza el costo unitario.' },
  { value: 'waste', hint: 'Resta lo que se dañó, caducó o se botó.' },
  { value: 'adjustment', hint: 'Corrige el stock después de contar. Usa un valor negativo para restar.' },
];

type MovementDialogProps = {
  item: InventoryItem;
  onRegistered: () => Promise<void>;
  onClose: () => void;
};

export function MovementDialog({ item, onRegistered, onClose }: MovementDialogProps) {
  const [kind, setKind] = useState<MovementKind>('purchase');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState(String(item.unit_cost_cop));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedQuantity = Number(quantity);
  const quantityValid = quantity.trim() !== '' && Number.isFinite(parsedQuantity) && parsedQuantity !== 0 && Math.abs(parsedQuantity) <= 1000000
    && (kind === 'adjustment' || parsedQuantity > 0);
  const parsedCost = Number(unitCost);
  const costValid = kind !== 'purchase' || (unitCost.trim() !== '' && Number.isInteger(parsedCost) && parsedCost >= 0);
  const canSubmit = quantityValid && costValid && !busy;

  const effect = quantityValid
    ? kind === 'waste' ? -parsedQuantity : parsedQuantity
    : 0;
  const stockAfter = item.current_stock + effect;
  const hint = kindOptions.find((option) => option.value === kind)?.hint ?? '';

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const failure = await registerInventoryMovement(
      item.id,
      kind,
      parsedQuantity,
      kind === 'purchase' ? parsedCost : null,
      note.trim() || null,
    );
    if (failure) {
      setError(failure);
      setBusy(false);
      return;
    }
    await onRegistered();
  };

  return (
    <div className="account-modal-layer" role="dialog" aria-modal="true" aria-label={`Registrar movimiento de ${item.name}`}>
      <form className="account-modal inventory-modal" onSubmit={(event: React.FormEvent<HTMLFormElement>) => void submit(event)}>
        <header className="account-header">
          <div>
            <p className="eyebrow">Registrar</p>
            <h2>{item.name}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}><X size={17} /></button>
        </header>

        <div className="inventory-form">
          <div className="payment-methods" role="group" aria-label="Tipo de movimiento">
            {kindOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={kind === option.value}
                className={kind === option.value ? 'selected' : ''}
                onClick={() => setKind(option.value)}
              >
                <span>{movementLabels[option.value]}</span>
              </button>
            ))}
          </div>
          <p className="payment-hint">{hint}</p>

          <div className="inventory-form-row">
            <label>
              Cantidad ({item.unit})
              <input type="number" inputMode="decimal" step="any" value={quantity} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuantity(event.target.value)} />
            </label>
            {kind === 'purchase' && (
              <label>
                Costo por {item.unit}
                <input type="number" inputMode="numeric" min={0} step={1} value={unitCost} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setUnitCost(event.target.value)} />
              </label>
            )}
          </div>

          <label>
            Nota (opcional)
            <input value={note} maxLength={200} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNote(event.target.value)} placeholder="Ej. Proveedor del martes" />
          </label>

          <div className="inventory-preview">
            <span>Stock actual {formatQuantity(item.current_stock, item.unit)}</span>
            <strong>Quedará en {formatQuantity(stockAfter, item.unit)}</strong>
            {kind === 'purchase' && quantityValid && costValid && (
              <small>Costo de esta compra {formatCurrency(Math.round(parsedQuantity * parsedCost))}</small>
            )}
          </div>
        </div>

        {error && <p className="auth-feedback error" role="alert">{error}</p>}

        <div className="inventory-form-footer">
          <button className="primary-button full-width" type="submit" disabled={!canSubmit}>
            {busy ? 'Registrando...' : 'Registrar movimiento'}
          </button>
        </div>
      </form>
    </div>
  );
}
