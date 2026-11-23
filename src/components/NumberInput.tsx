import { useState } from 'react';
import '@/components/form-problem.css';
import { rawToDisplay, typedToRaw } from '@/lib/numberFormat';

type NumberInputProps = {
  /** Valor sin formato, con punto decimal: "1234.5" */
  value: string;
  onChange: (raw: string) => void;
  /** Permite decimales (con coma). Por defecto solo enteros. */
  decimals?: boolean;
  /** Permite valores negativos (ej. ajustes de inventario). */
  negative?: boolean;
  /** Oculta el aviso de "campo vacío" (para celdas de tabla donde el formulario ya avisa por su cuenta). */
  hideEmptyError?: boolean;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
};

const isEmpty = (raw: string): boolean => raw.trim() === '' || raw.trim() === '-';
const isZero = (raw: string): boolean => raw.trim() !== '' && Number(raw) === 0;

/**
 * Campo numérico con miles colombianos: escribes 1234567 y se ve 1.234.567. Decimales con coma.
 * - Al entrar al campo, si tiene el 0 por defecto, se quita solo para escribir directamente.
 * - Si sales del campo sin escribir nada, explica que hay que diligenciarlo (o escribir 0 si no aplica).
 */
export function NumberInput({ value, onChange, decimals = false, negative = false, hideEmptyError = false, className, placeholder, 'aria-label': ariaLabel }: NumberInputProps) {
  const [leftBlank, setLeftBlank] = useState(false);
  const showError = leftBlank && isEmpty(value) && !hideEmptyError;

  return (
    <>
      <input
        type="text"
        inputMode={decimals ? 'decimal' : 'numeric'}
        autoComplete="off"
        className={className}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={showError || undefined}
        value={rawToDisplay(value)}
        onFocus={() => {
          setLeftBlank(false);
          if (isZero(value)) onChange('');
        }}
        onBlur={() => setLeftBlank(true)}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          setLeftBlank(false);
          onChange(typedToRaw(event.target.value, { decimals, negative }));
        }}
      />
      {showError && <small className="form-problem-inline" role="alert">Este campo no puede quedar vacío: escribe el valor. Si no aplica, escribe 0.</small>}
    </>
  );
}
