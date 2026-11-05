import { useState } from 'react';
import { Archive, ArchiveRestore, X } from 'lucide-react';
import '@/components/salon/account.css';
import {
  saveInventoryItem,
  setInventoryItemActive,
  storageLabels,
  unitLabels,
  type InventoryItem,
  type InventoryUnit,
  type StorageLocation,
} from '@/lib/inventory';

type ItemDialogProps = {
  item: InventoryItem | null;
  onSaved: () => Promise<void>;
  onClose: () => void;
};

const units = Object.keys(unitLabels) as InventoryUnit[];
const locations = Object.keys(storageLabels) as StorageLocation[];

export function ItemDialog({ item, onSaved, onClose }: ItemDialogProps) {
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState<InventoryUnit>(item?.unit ?? 'unidad');
  const [location, setLocation] = useState<StorageLocation>(item?.storage_location ?? 'bodega');
  const [minStock, setMinStock] = useState(String(item?.min_stock ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedMin = Number(minStock);
  const nameValid = name.trim().length >= 1 && name.trim().length <= 80;
  const minValid = minStock.trim() !== '' && Number.isFinite(parsedMin) && parsedMin >= 0 && parsedMin <= 1000000;
  const canSubmit = nameValid && minValid && !busy;

  const toggleActive = async (): Promise<void> => {
    if (!item) return;
    setBusy(true);
    setError(null);
    const failure = await setInventoryItemActive(item.id, !item.is_active);
    if (failure) {
      setError(failure);
      setBusy(false);
      return;
    }
    await onSaved();
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const failure = await saveInventoryItem(item?.id ?? null, {
      name,
      unit,
      storage_location: location,
      min_stock: parsedMin,
    });
    if (failure) {
      setError(failure);
      setBusy(false);
      return;
    }
    await onSaved();
  };

  return (
    <div className="account-modal-layer" role="dialog" aria-modal="true" aria-label={item ? 'Editar insumo' : 'Nuevo insumo'}>
      <form className="account-modal inventory-modal" onSubmit={(event: React.FormEvent<HTMLFormElement>) => void submit(event)}>
        <header className="account-header">
          <div>
            <p className="eyebrow">Inventario</p>
            <h2>{item ? 'Editar insumo' : 'Nuevo insumo'}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}><X size={17} /></button>
        </header>

        <div className="inventory-form">
          <label>
            Nombre
            <input value={name} maxLength={80} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)} placeholder="Ej. Queso mozzarella" />
          </label>

          <div className="inventory-form-row">
            <label>
              Unidad
              <select value={unit} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setUnit(event.target.value as InventoryUnit)}>
                {units.map((option) => <option key={option} value={option}>{unitLabels[option]}</option>)}
              </select>
            </label>
            <label>
              Ubicación
              <select value={location} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setLocation(event.target.value as StorageLocation)}>
                {locations.map((option) => <option key={option} value={option}>{storageLabels[option]}</option>)}
              </select>
            </label>
          </div>

          <label>
            Stock mínimo para alertar
            <input type="number" inputMode="decimal" min={0} step="any" value={minStock} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setMinStock(event.target.value)} />
          </label>
        </div>

        {error && <p className="auth-feedback error" role="alert">{error}</p>}

        <div className="inventory-form-footer">
          <button className="primary-button full-width" type="submit" disabled={!canSubmit}>
            {busy ? 'Guardando...' : 'Guardar insumo'}
          </button>
          {item && (
            <button className="outline-button full-width" type="button" disabled={busy} onClick={() => void toggleActive()}>
              {item.is_active ? <><Archive size={15} /> Desactivar insumo</> : <><ArchiveRestore size={15} /> Reactivar insumo</>}
            </button>
          )}
          {item?.is_active && (
            <p className="inventory-empty">Al desactivarlo deja de aparecer en el inventario, pero su historial de compras y consumos se conserva.</p>
          )}
        </div>
      </form>
    </div>
  );
}
