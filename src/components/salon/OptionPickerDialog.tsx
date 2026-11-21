import { useState } from 'react';
import { X } from 'lucide-react';
import type { ProductOption } from '@/lib/productOptions';

type OptionPickerDialogProps = {
  productName: string;
  option: ProductOption;
  onConfirm: (choiceIds: string[]) => void;
  onClose: () => void;
};

/** Pide escoger las opciones de un producto (ej. las dos carnes del perro). Se puede repetir la misma opción. */
export function OptionPickerDialog({ productName, option, onConfirm, onClose }: OptionPickerDialogProps) {
  const [selected, setSelected] = useState<(string | null)[]>(Array.from({ length: option.picks }, () => null));
  const complete = selected.every((value: string | null) => value !== null);
  const pick = (slot: number, choiceId: string): void => setSelected((current: (string | null)[]) => current.map((value: string | null, index: number) => (index === slot ? choiceId : value)));

  return (
    <div className="account-modal-layer" role="dialog" aria-modal="true" aria-label={`Escoger opciones de ${productName}`}>
      <div className="account-modal">
        <header className="account-header">
          <div>
            <p className="eyebrow">{productName}</p>
            <h2>{option.picks === 1 ? 'Escoge la carne' : `Escoge ${option.picks} carnes`}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="account-body">
          {selected.map((value: string | null, slot: number) => (
            <div key={slot}>
              {option.picks > 1 && <p className="muted">Carne {slot + 1}</p>}
              <div className="category-tabs">
                {option.choices.map((choice) => (
                  <button key={choice.id} type="button" className={value === choice.id ? 'selected' : ''} onClick={() => pick(slot, choice.id)}>{choice.name}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <footer className="account-footer">
          {!complete && <small className="form-problem-inline">Falta escoger: {selected.map((value: string | null, slot: number) => (value === null ? `carne ${slot + 1}` : null)).filter(Boolean).join(' y ')}.</small>}
          <button className="primary-button full-width" type="button" disabled={!complete} onClick={() => onConfirm(selected as string[])}>Agregar al pedido</button>
        </footer>
      </div>
    </div>
  );
}
