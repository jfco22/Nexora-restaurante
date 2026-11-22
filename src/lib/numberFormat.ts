/**
 * Campos numéricos con formato colombiano: miles con punto (1.234.567) y decimales con coma (1.234,5).
 * El valor que guarda el formulario ("raw") siempre usa punto decimal y no tiene separador de miles: "1234567.5".
 */

type TypedOptions = { decimals: boolean; negative: boolean };

/** Convierte lo que escribe la persona en el valor "raw". Acepta "1.234,5", "1234,5" y, si hay decimales, "1.5". */
export function typedToRaw(text: string, { decimals, negative }: TypedOptions): string {
  let clean = text.replace(/[\s$]/g, '');
  const isNegative = negative && clean.startsWith('-');
  clean = clean.replace(/-/g, '');

  let integerPart: string;
  let decimalPart: string | null = null;

  const lastComma = clean.lastIndexOf(',');
  if (lastComma >= 0) {
    integerPart = clean.slice(0, lastComma).replace(/[.,]/g, '');
    decimalPart = clean.slice(lastComma + 1).replace(/[.,]/g, '');
  } else {
    const dots = (clean.match(/\./g) ?? []).length;
    const lastDot = clean.lastIndexOf('.');
    const afterDot = lastDot >= 0 ? clean.slice(lastDot + 1) : '';
    // Un solo punto con 1-2 decimales (o recién tecleado) se entiende como decimal: "1.5" o "2."
    if (decimals && dots === 1 && afterDot.length !== 3) {
      integerPart = clean.slice(0, lastDot);
      decimalPart = afterDot;
    } else {
      integerPart = clean.replace(/\./g, '');
    }
  }

  integerPart = integerPart.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (!decimals) decimalPart = null;
  const decimalDigits = decimalPart === null ? null : decimalPart.replace(/\D/g, '').slice(0, 3);
  const sign = isNegative ? '-' : '';
  if (decimalDigits !== null) return `${sign}${integerPart || '0'}.${decimalDigits}`;
  return integerPart === '' ? (isNegative ? '-' : '') : `${sign}${integerPart}`;
}

/** Convierte el valor "raw" en el texto que se ve en el campo (con puntos de miles y coma decimal). */
export function rawToDisplay(raw: string): string {
  if (raw === '' || raw === '-') return raw;
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [integerPart, decimalPart] = unsigned.split('.');
  const grouped = (integerPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped}${decimalPart !== undefined ? `,${decimalPart}` : ''}`;
}
