import { supabase } from '@/lib/supabase';
import { userFacingError } from '@/lib/tableAccount';
import type { CatalogProduct, RecipeLine } from '@/lib/inventory';

export type PreparationLine = { item_id: string; quantity: number };
/** Resultado adicional de la preparación (ej. la carne, además del caldo). */
export type PreparationOutput = { item_id: string; quantity: number };
export type Preparation = {
  id: string;
  output_item_id: string;
  yield_quantity: number;
  lines: PreparationLine[];
  extraOutputs: PreparationOutput[];
};

export async function fetchPreparations(): Promise<{ preparations: Preparation[]; error: string | null }> {
  const { data, error } = await supabase
    .from('nexora_preparations')
    .select('id, output_item_id, yield_quantity, nexora_preparation_lines(item_id, quantity), nexora_preparation_outputs(item_id, quantity)')
    .eq('is_active', true);
  if (error) return { preparations: [], error: 'No pudimos cargar las preparaciones.' };
  const rows = (data ?? []) as unknown as {
    id: string; output_item_id: string; yield_quantity: number | string;
    nexora_preparation_lines: { item_id: string; quantity: number | string }[] | null;
    nexora_preparation_outputs: { item_id: string; quantity: number | string }[] | null;
  }[];
  return {
    preparations: rows.map((row) => ({
      id: row.id,
      output_item_id: row.output_item_id,
      yield_quantity: Number(row.yield_quantity),
      lines: (row.nexora_preparation_lines ?? []).map((line) => ({ item_id: line.item_id, quantity: Number(line.quantity) })),
      extraOutputs: (row.nexora_preparation_outputs ?? []).map((output) => ({ item_id: output.item_id, quantity: Number(output.quantity) })),
    })),
    error: null,
  };
}

/** Cocina `batches` tandas: descuenta los insumos crudos y suma lo cocinado. Devuelve el mensaje de error, o null si salió bien. */
export async function cookPreparation(preparationId: string, batches: number): Promise<string | null> {
  const { error } = await supabase.rpc('cook_nexora_preparation', {
    preparation_id_input: preparationId,
    batches_input: batches,
  });
  return error ? userFacingError(error) : null;
}

export type PortionInfo = { productId: string; name: string; portions: number };

/** Cuántas porciones de cada plato se pueden servir con `quantity` del insumo cocinado. */
export function portionsFromQuantity(
  outputItemId: string,
  quantity: number,
  products: CatalogProduct[],
  recipeLines: RecipeLine[],
): PortionInfo[] {
  const result: PortionInfo[] = [];
  for (const line of recipeLines) {
    if (line.item_id !== outputItemId || line.quantity <= 0) continue;
    const product = products.find((candidate: CatalogProduct) => candidate.id === line.product_id);
    if (!product) continue;
    result.push({ productId: product.id, name: product.name, portions: Math.max(0, Math.floor(quantity / line.quantity + 1e-9)) });
  }
  return result.sort((a: PortionInfo, b: PortionInfo) => a.name.localeCompare(b.name, 'es'));
}

/** Las tandas se piden en pasos de media tanda; el máximo lo fija la base de datos. */
export function parseBatches(value: string): number | null {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? Math.round(parsed * 100) / 100 : null;
}
