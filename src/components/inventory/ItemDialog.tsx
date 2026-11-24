import { NumberInput } from '@/components/NumberInput';
import { FormProblem } from '@/components/FormProblem';
import { useRef, useState } from 'react';
import { AlertTriangle, Archive, ArchiveRestore, X } from 'lucide-react';
import '@/components/salon/account.css';
import '@/components/inventory/inventory-import.css';
import { findSimilarNames, normalizeKey, type KnownItem, type SimilarHit } from '@/lib/similarItems';
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
  /** Todos los insumos (activos y archivados) para avisar si el nombre se parece a uno existente. */
  knownItems?: KnownItem[];
  onSaved: () => Promise<void>;
  onClose: () => void;
};

const units = Object.keys(unitLabels) as InventoryUnit[];
const locations = Object.keys(storageLabels) as StorageLocation[];

export function ItemDialog({ item, knownItems = [], onSaved, onClose }: ItemDialogProps) {
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState<InventoryUnit>(item?.unit ?? 'unidad');
  const [location, setLocation] = useState<StorageLocation>(item?.storage_location ?? 'bodega');
  const [minStock, setMinStock] = useState(String(item?.min_stock ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<SimilarHit | null>(null);
  const confirmedKey = useRef<string | null>(null);

  const parsedMin = Number(minStock);
  const nameValid = name.trim().length >= 1 && name.trim().length <= 80;
  const minValid = minStock.trim() !== '' && Number.isFinite(parsedMin) && parsedMin >= 0 && parsedMin <= 1000000;
  const canSubmit = nameValid && minValid && !busy;
  const problem = !nameValid ? (name.trim() === '' ? 'Escribe el nombre del insumo (ej. Queso mozzarella).' : 'El nombre es demasiado largo (máximo 80 letras).')
    : !minValid ? (minStock.trim() === '' ? 'Escribe el stock mínimo para alertar (usa 0 si no quieres alerta).' : 'El stock mínimo debe ser un número igual o mayor que 0.')
    : null;

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

  const useExisting = async (candidate: KnownItem): Promise<void> => {
    setBusy(true);
    setError(null);
    if (candidate.archived) {
      const failure = await setInventoryItemActive(candidate.id, true);
      if (failure) {
        setError(failure);
        setBusy(false);
        return;
      }
    }
    await onSaved();
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);

    // Nombre nuevo (o cambiado): revisa que no sea igual ni parecido a un insumo que ya existe.
    const key = normalizeKey(name);
    if (!item || key !== normalizeKey(item.name)) {
      const others = knownItems.filter((known: KnownItem) => known.id !== item?.id);
      const exact = others.find((known: KnownItem) => normalizeKey(known.name) === key);
      if (exact) {
        setSimilar({ key, name: name.trim(), unit, rows: [1], candidates: [{ item: exact, score: 1, unitDiffers: exact.unit !== unit }] });
        return;
      }
      if (confirmedKey.current !== key) {
        const hit = findSimilarNames([{ name, unit, rowNumber: 1 }], others)[0];
        if (hit) {
          setSimilar(hit);
          return;
        }
      }
    }
    setSimilar(null);
    setBusy(true);
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
            <input value={name} maxLength={80} onChange={(event: React.ChangeEvent<HTMLInputElement>) => { setName(event.target.value); setSimilar(null); }} placeholder="Ej. Queso mozzarella" />
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
            <NumberInput value={minStock} onChange={setMinStock} decimals />
          </label>
        </div>

        {similar && (
          <div className="similar-panel" role="alert">
            <h3><AlertTriangle size={16} /> {similar.candidates[0]?.score === 1 && normalizeKey(similar.candidates[0].item.name) === similar.key ? 'Este insumo ya existe' : 'Ya tienes insumos parecidos'}</h3>
            {similar.candidates.map((candidate) => (
              <label key={candidate.item.id} className="similar-option">
                <span>
                  «{candidate.item.name}» ({candidate.item.unit === 'unidad' ? 'unidades' : candidate.item.unit}){candidate.item.archived ? ' · archivado' : ''}
                  {candidate.unitDiffers && <em className="similar-unit-warning"> · unidad distinta a la que elegiste</em>}
                </span>
                <button className="outline-button" type="button" disabled={busy} onClick={() => void useExisting(candidate.item)}>
                  {candidate.item.archived ? 'Es el mismo: reactivarlo' : 'Es el mismo: usar ese'}
                </button>
              </label>
            ))}
            {normalizeKey(similar.candidates[0]?.item.name ?? '') !== similar.key && (
              <button className="primary-button" type="submit" disabled={busy} onClick={() => { confirmedKey.current = similar.key; }}>
                Es distinto: crear «{similar.name}» de todas formas
              </button>
            )}
          </div>
        )}

        <FormProblem message={problem} />
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
