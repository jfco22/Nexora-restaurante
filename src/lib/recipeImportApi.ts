import { supabase } from '@/lib/supabase';
import { userFacingError } from '@/lib/tableAccount';
import type { RecipeLine } from '@/lib/inventory';
import { normalizeName, type PlanLine, type RecipePlan } from '@/lib/recipeImport';

/** Reactiva los insumos archivados que el archivo vuelve a usar (en vez de crear un duplicado con el mismo nombre). */
async function reactivateItems(ids: (string | null)[]): Promise<void> {
  const unique = [...new Set(ids.filter((id: string | null): id is string => Boolean(id)))];
  if (unique.length === 0) return;
  await supabase.from('nexora_inventory_items').update({ is_active: true }).in('id', unique).eq('is_active', false);
}

export type RecipeImportOutcome = {
  ok: boolean;
  message: string | null;
  itemsCreated: number;
  linesSaved: number;
  linesRemoved: number;
  productsTouched: number;
};

/**
 * Guarda las filas válidas del plan: crea los insumos nuevos (stock 0, en la ubicación indicada o en bodega), guarda las líneas de receta
 * y, si `replace` está activo, quita de cada producto los insumos que no vienen en el archivo.
 * Solo se reemplaza una receta cuando todas las filas de ese producto en el archivo son válidas.
 */
export async function applyRecipePlan(plan: RecipePlan, existingLines: RecipeLine[], replace: boolean): Promise<RecipeImportOutcome> {
  const failed = (message: string, partial: Partial<RecipeImportOutcome> = {}): RecipeImportOutcome => ({
    ok: false, message, itemsCreated: 0, linesSaved: 0, linesRemoved: 0, productsTouched: 0, ...partial,
  });
  const valid = plan.lines.filter((line: PlanLine) => line.errors.length === 0 && line.productId !== null && line.quantity !== null);
  if (valid.length === 0) return failed('No hay filas válidas para importar.');

  await reactivateItems(valid.map((line: PlanLine) => line.itemId));

  const newItemIds = new Map<string, string>();
  if (plan.newItems.length > 0) {
    const { data, error } = await supabase
      .from('nexora_inventory_items')
      .insert(plan.newItems.map((item) => ({ name: item.name.trim(), unit: item.unit, storage_location: item.location, min_stock: 0 })))
      .select('id, name');
    if (error) {
      return failed(error.code === '23505'
        ? 'Alguno de los insumos nuevos ya existe con ese nombre (puede estar archivado en Inventario). Reactívalo o cámbiale el nombre en el archivo.'
        : userFacingError(error));
    }
    for (const item of (data ?? []) as { id: string; name: string }[]) newItemIds.set(normalizeName(item.name), item.id);
  }

  const payload: { product_id: string; item_id: string; quantity: number; is_active: boolean }[] = [];
  for (const line of valid) {
    const itemId = line.itemId ?? newItemIds.get(normalizeName(line.row.item));
    if (!itemId || line.productId === null || line.quantity === null) continue;
    payload.push({ product_id: line.productId, item_id: itemId, quantity: line.quantity, is_active: true });
  }
  const itemsCreated = newItemIds.size;

  const { error: upsertError } = await supabase.from('nexora_product_recipes').upsert(payload, { onConflict: 'product_id,item_id' });
  if (upsertError) return failed(userFacingError(upsertError), { itemsCreated });

  let linesRemoved = 0;
  if (replace) {
    const productsWithErrors = new Set(plan.lines.filter((line: PlanLine) => line.errors.length > 0 && line.productId).map((line: PlanLine) => line.productId));
    const keepByProduct = new Map<string, Set<string>>();
    for (const line of payload) {
      if (productsWithErrors.has(line.product_id)) continue;
      const keep = keepByProduct.get(line.product_id) ?? new Set<string>();
      keep.add(line.item_id);
      keepByProduct.set(line.product_id, keep);
    }
    for (const [productId, keep] of keepByProduct) {
      const toRemove = existingLines.filter((line: RecipeLine) => line.product_id === productId && !keep.has(line.item_id)).map((line: RecipeLine) => line.item_id);
      if (toRemove.length === 0) continue;
      const { error } = await supabase.from('nexora_product_recipes').update({ is_active: false }).eq('product_id', productId).in('item_id', toRemove);
      if (error) return failed(userFacingError(error), { itemsCreated, linesSaved: payload.length, linesRemoved });
      linesRemoved += toRemove.length;
    }
  }

  return { ok: true, message: null, itemsCreated, linesSaved: payload.length, linesRemoved, productsTouched: new Set(payload.map((line) => line.product_id)).size };
}
