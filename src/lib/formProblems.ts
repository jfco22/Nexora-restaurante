/**
 * Mensajes de validación para los formularios: dicen QUÉ está mal y CÓMO corregirlo.
 * Cada función devuelve null cuando el valor es correcto. Si un botón está desactivado,
 * el formulario debe mostrar el mensaje correspondiente (componente FormProblem).
 */

/** Convierte "1,5" o "1.5" en número. Devuelve NaN si no es un número. */
export function parseDecimalText(text: string): number {
  const clean = text.trim().replace(',', '.');
  return clean === '' ? NaN : Number(clean);
}

export function wholeAmountProblem(text: string, what: string, options: { min?: number; max?: number; example?: string } = {}): string | null {
  const { min = 0, max, example = '50000' } = options;
  if (text.trim() === '') return `Escribe ${what}${min === 0 ? ' (usa 0 si no hay)' : ''}.`;
  const value = Number(text.trim());
  if (!Number.isFinite(value)) return `${capital(what)} debe ser solo números, sin puntos, comas ni letras. Ej. ${example}.`;
  if (!Number.isInteger(value)) return `${capital(what)} va en pesos enteros, sin decimales. Ej. ${example}.`;
  if (value < min) return min === 0 ? `${capital(what)} no puede ser negativo.` : `${capital(what)} debe ser mayor que ${min - 1}.`;
  if (max !== undefined && value > max) return `${capital(what)} no puede superar ${max.toLocaleString('es-CO')}.`;
  return null;
}

export function quantityProblem(text: string, what: string, options: { allowNegative?: boolean; max?: number } = {}): string | null {
  const { allowNegative = false, max = 1000000 } = options;
  if (text.trim() === '') return `Escribe ${what}.`;
  const value = parseDecimalText(text);
  if (!Number.isFinite(value)) return `${capital(what)} debe ser un número (puedes usar coma o punto para decimales, ej. 1,5).`;
  if (value === 0) return `${capital(what)} no puede ser 0.`;
  if (value < 0 && !allowNegative) return `${capital(what)} debe ser mayor que cero.`;
  if (Math.abs(value) > max) return `${capital(what)} es demasiado grande (máximo ${max.toLocaleString('es-CO')}).`;
  return null;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
