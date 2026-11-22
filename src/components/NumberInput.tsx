import { rawToDisplay, typedToRaw } from '@/lib/numberFormat';

type NumberInputProps = {
  /** Valor sin formato, con punto decimal: "1234.5" */
  value: string;
  onChange: (raw: string) => void;
  /** Permite decimales (con coma). Por defecto solo enteros. */
  decimals?: boolean;
  /** Permite valores negativos (ej. ajustes de inventario). */
  negative?: boolean;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
};

/** Campo numérico con miles colombianos: escribes 1234567 y se ve 1.234.567. Decimales con coma. */
export function NumberInput({ value, onChange, decimals = false, negative = false, className, placeholder, 'aria-label': ariaLabel }: NumberInputProps) {
  return (
    <input
      type="text"
      inputMode={decimals ? 'decimal' : 'numeric'}
      autoComplete="off"
      className={className}
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={rawToDisplay(value)}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(typedToRaw(event.target.value, { decimals, negative }))}
    />
  );
}
