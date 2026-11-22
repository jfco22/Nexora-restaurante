import { NumberInput } from '@/components/NumberInput';
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
import { FormProblem } from '@/components/FormProblem';
import { parseDecimalText } from '@/lib/formProblems';

/** Cuántas unidades del insumo hay en 1 kilo (o 1 litro) comprado. null = el insumo se cuenta por unidades. */
const bulkFactor = (unit: InventoryItem['unit']): number | null => (unit === 'g' || unit === 'ml' ? 1000 : unit === 'kg' || unit === 'l' ? 1 : null);
const bulkLabel = (unit: InventoryItem['unit']): string => (unit === 'ml' || unit === 'l' ? 'litros' : 'kilos');
const round4 = (value: number): number => Math.round(value * 10000) / 10000;

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
  const [byWeight, setByWeight] = useState(false);
  const [kilos, setKilos] = useState('');
  const [total, setTotal] = useState('');
  const [perKilo, setPerKilo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const factor = bulkFactor(item.unit);
  const weightMode = byWeight && factor !== null && kind === 'purchase';
  const kilosNumber = parseDecimalText(kilos);
  const totalNumber = parseDecimalText(total);
  // Calculado desde kilos y valor: cantidad en la unidad del insumo y costo por esa unidad (ej. por gramo)
  const weightQuantity = weightMode && kilosNumber > 0 && factor !== null ? round4(kilosNumber * factor) : NaN;
  const weightCost = weightMode && Number.isFinite(weightQuantity) && weightQuantity > 0 && totalNumber >= 0 ? round4(totalNumber / weightQuantity) : NaN;

  const changeKilos = (raw: string): void => {
    setKilos(raw);
    const k = parseDecimalText(raw);
    const pk = parseDecimalText(perKilo);
    if (k > 0 && Number.isFinite(pk)) setTotal(String(Math.round(k * pk)));
    else if (k > 0 && Number.isFinite(totalNumber)) setPerKilo(String(round4(totalNumber / k)));
  };
  const changeTotal = (raw: string): void => {
    setTotal(raw);
    const t = parseDecimalText(raw);
    setPerKilo(kilosNumber > 0 && Number.isFinite(t) ? String(round4(t / kilosNumber)) : '');
  };
  const changePerKilo = (raw: string): void => {
    setPerKilo(raw);
    const pk = parseDecimalText(raw);
    setTotal(kilosNumber > 0 && Number.isFinite(pk) ? String(Math.round(kilosNumber * pk)) : '');
  };

  // Acepta coma o punto como decimal (1,5 o 1.5)
  const parsedQuantity = weightMode ? weightQuantity : Number(quantity.trim().replace(',', '.'));
  const quantityValid = (weightMode || quantity.trim() !== '') && Number.isFinite(parsedQuantity) && parsedQuantity !== 0 && Math.abs(parsedQuantity) <= 1000000
    && (kind === 'adjustment' || parsedQuantity > 0);
  // El costo por unidad admite decimales (ej. $26,8 por gramo); se guarda con 4 decimales
  const parsedCost = weightMode ? weightCost : round4(Number(unitCost.trim().replace(',', '.')));
  const costValid = kind !== 'purchase' || ((weightMode || unitCost.trim() !== '') && Number.isFinite(parsedCost) && parsedCost >= 0);
  const problem = weightMode
    ? (kilos.trim() === '' ? `Escribe cuántos ${bulkLabel(item.unit)} compraste.` : !(kilosNumber > 0) ? `Los ${bulkLabel(item.unit)} deben ser un número mayor que 0 (ej. 2,5).` : total.trim() === '' ? 'Escribe el valor total pagado o el valor por kilo.' : !Number.isFinite(totalNumber) || totalNumber < 0 ? 'El valor debe ser un número igual o mayor que 0.' : null)
    : quantity.trim() === '' ? null
    : !Number.isFinite(parsedQuantity) || parsedQuantity === 0 ? 'La cantidad no es válida.'
    : kind !== 'adjustment' && parsedQuantity < 0 ? 'La cantidad debe ser mayor que cero (para restar usa Conteo/Ajuste).'
    : Math.abs(parsedQuantity) > 1000000 ? 'La cantidad es demasiado grande.'
    : !costValid ? 'Escribe el costo por unidad (un número, puede ser 0).'
    : null;
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

          {kind === 'purchase' && factor !== null && (
            <label className="inventory-check">
              <input type="checkbox" checked={byWeight} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setByWeight(event.target.checked)} />
              Calcular desde {bulkLabel(item.unit)} y valor pagado
            </label>
          )}

          {weightMode ? (
            <>
              <div className="inventory-form-row">
                <label>
                  {bulkLabel(item.unit) === 'litros' ? 'Litros comprados' : 'Kilos comprados'}
                  <NumberInput value={kilos} onChange={changeKilos} decimals />
                </label>
                <label>
                  Valor total pagado
                  <NumberInput value={total} onChange={changeTotal} />
                </label>
                <label>
                  Valor por {bulkLabel(item.unit) === 'litros' ? 'litro' : 'kilo'}
                  <NumberInput value={perKilo} onChange={changePerKilo} decimals />
                </label>
              </div>
              {Number.isFinite(weightQuantity) && Number.isFinite(weightCost) && (
                <p className="payment-hint">
                  Se registran <strong>{formatQuantity(weightQuantity, item.unit)}</strong> a <strong>${weightCost.toLocaleString('es-CO', { maximumFractionDigits: 4 })} por {item.unit}</strong>.
                </p>
              )}
            </>
          ) : (
          <div className="inventory-form-row">
            <label>
              Cantidad ({item.unit})
              <NumberInput value={quantity} onChange={setQuantity} decimals negative={kind === 'adjustment'} />
            </label>
            {kind === 'purchase' && (
              <label>
                Costo por {item.unit}
                <NumberInput value={unitCost} onChange={setUnitCost} decimals />
              </label>
            )}
          </div>
          )}

          <label>
            Nota (opcional)
            <input value={note} maxLength={200} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNote(event.target.value)} placeholder="Ej. Proveedor del martes" />
          </label>

          <div className="inventory-preview">
            <span>Stock actual {formatQuantity(item.current_stock, item.unit)}</span>
            <strong>Quedará en {formatQuantity(stockAfter, item.unit)}</strong>
            {kind === 'purchase' && quantityValid && costValid && (
              <small>Costo de esta compra {formatCurrency(Math.round(parsedQuantity * parsedCost))}{item.unit !== 'unidad' && parsedCost > 0 ? ` · $${parsedCost.toLocaleString('es-CO', { maximumFractionDigits: 4 })} por ${item.unit}` : ''}</small>
            )}
          </div>
        </div>

        <FormProblem message={problem} />
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
