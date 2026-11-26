import { supabase } from '@/lib/supabase';
import { userFacingError } from '@/lib/tableAccount';

export type FreshnessLevel = 'alert' | 'watch' | 'ok';

export type FreshnessRow = {
  item_id: string;
  name: string;
  unit: string;
  storage_location: string;
  current_stock: number;
  shelf_life_days: number | null;
  oldest_age_days: number | null;
  oldest_since: string | null;
  avg_rotation_days: number | null;
  batches_measured: number;
  level: FreshnessLevel;
  reason: string | null;
  used_in: string[];
};

const MISSING = 'Falta activar las alertas de frescura en la base de datos (SQL 13). Pídele a quien administra Supabase que lo corra.';

export async function fetchFreshness(): Promise<{ rows: FreshnessRow[]; error: string | null }> {
  const { data, error } = await supabase.rpc('nexora_stock_freshness');
  if (error) {
    // Función aún no creada en la base de datos.
    if (error.code === 'PGRST202' || error.code === '42883') return { rows: [], error: MISSING };
    return { rows: [], error: userFacingError(error) };
  }
  return { rows: ((data ?? []) as FreshnessRow[]).map((row: FreshnessRow) => ({ ...row, current_stock: Number(row.current_stock) })), error: null };
}

export async function saveShelfLife(itemId: string, days: number | null): Promise<string | null> {
  const { error } = await supabase.from('nexora_inventory_items').update({ shelf_life_days: days }).eq('id', itemId);
  return error ? userFacingError(error) : null;
}

/** Texto del límite para validar: vacío = sin límite; si no, entero de 1 a 365. */
export function shelfLifeProblem(text: string): string | null {
  const value = text.trim();
  if (value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 365) return 'Escribe los días como número entero entre 1 y 365 (o déjalo vacío si no tiene límite).';
  return null;
}
