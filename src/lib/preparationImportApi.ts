import { supabase } from '@/lib/supabase';
import { userFacingError } from '@/lib/tableAccount';
import { normalizeName, type PlanLine } from '@/lib/recipeImport';
import type { PlannedExtraOutput, PlannedPreparation, PreparationPlan } from '@/lib/preparationImport';

export type PreparationImportOutcome = {
  ok: boolean;
  message: string | null;
  itemsCreated: number;
  preparationsSaved: number;
};

/**
 * Guarda las preparaciones completas del plan: crea los insumos nuevos (ingredientes y resultado, con stock 0),
 * guarda el rendimiento y reemplaza los insumos de cada preparación por los del archivo.
 */
export async function applyPreparationPlan(plan: PreparationPlan): Promise<PreparationImportOutcome> {
  const failed = (message: string, partial: Partial<PreparationImportOutcome> = {}): PreparationImportOutcome => ({
    ok: false, message, itemsCreated: 0, preparationsSaved: 0, ...partial,
  });
  if (plan.preparations.length === 0) return failed('No hay preparaciones completas para importar.');

  const candidates = [
    ...plan.newItems,
    ...plan.preparations.filter((prep: PlannedPreparation) => prep.newOutput).map((prep: PlannedPreparation) => prep.newOutput as NonNullable<PlannedPreparation['newOutput']>),
    ...plan.preparations.flatMap((prep: PlannedPreparation) => prep.extraOutputs.filter((extra: PlannedExtraOutput) => extra.newItem).map((extra: PlannedExtraOutput) => extra.newItem as NonNullable<PlannedExtraOutput['newItem']>)),
  ];
  const toCreate = candidates.filter((item, index: number) => candidates.findIndex((other) => normalizeName(other.name) === normalizeName(item.name)) === index);
  const itemIds = new Map<string, string>();
  if (toCreate.length > 0) {
    const { data, error } = await supabase
      .from('nexora_inventory_items')
      .insert(toCreate.map((item) => ({ name: item.name.trim(), unit: item.unit, storage_location: item.location, min_stock: 0 })))
      .select('id, name');
    if (error) {
      return failed(error.code === '23505'
        ? 'Alguno de los insumos nuevos ya existe con ese nombre (puede estar archivado en Inventario). Reactívalo o cámbiale el nombre en el archivo.'
        : userFacingError(error));
    }
    for (const item of (data ?? []) as { id: string; name: string }[]) itemIds.set(normalizeName(item.name), item.id);
  }
  const itemsCreated = itemIds.size;

  let saved = 0;
  for (const prep of plan.preparations) {
    const outputId = prep.outputItemId ?? itemIds.get(normalizeName(prep.name));
    if (!outputId) return failed(`No encontramos el insumo "${prep.name}".`, { itemsCreated, preparationsSaved: saved });

    const lines: { item_id: string; quantity: number }[] = [];
    for (const line of prep.lines as PlanLine[]) {
      const itemId = line.itemId ?? itemIds.get(normalizeName(line.row.item));
      if (!itemId || line.quantity === null) return failed(`Falta resolver el insumo "${line.row.item}".`, { itemsCreated, preparationsSaved: saved });
      lines.push({ item_id: itemId, quantity: line.quantity });
    }

    const { data: existing, error: lookupError } = await supabase
      .from('nexora_preparations').select('id').eq('output_item_id', outputId).maybeSingle();
    if (lookupError) return failed(userFacingError(lookupError), { itemsCreated, preparationsSaved: saved });

    let preparationId = (existing as { id: string } | null)?.id ?? null;
    if (preparationId) {
      const { error } = await supabase.from('nexora_preparations').update({ yield_quantity: prep.yieldQuantity, is_active: true }).eq('id', preparationId);
      if (error) return failed(userFacingError(error), { itemsCreated, preparationsSaved: saved });
      const { error: deleteError } = await supabase.from('nexora_preparation_lines').delete().eq('preparation_id', preparationId);
      if (deleteError) return failed(userFacingError(deleteError), { itemsCreated, preparationsSaved: saved });
    } else {
      const { data: created, error } = await supabase
        .from('nexora_preparations').insert({ output_item_id: outputId, yield_quantity: prep.yieldQuantity }).select('id').single();
      if (error) return failed(userFacingError(error), { itemsCreated, preparationsSaved: saved });
      preparationId = (created as { id: string }).id;
    }

    const { error: linesError } = await supabase
      .from('nexora_preparation_lines').insert(lines.map((line) => ({ preparation_id: preparationId, ...line })));
    if (linesError) return failed(userFacingError(linesError), { itemsCreated, preparationsSaved: saved });

    // Resultados adicionales: se reemplazan por los del archivo.
    const outputs: { item_id: string; quantity: number }[] = [];
    for (const extra of prep.extraOutputs) {
      const extraId = extra.itemId ?? itemIds.get(normalizeName(extra.name));
      if (!extraId) return failed(`Falta resolver el resultado "${extra.name}".`, { itemsCreated, preparationsSaved: saved });
      outputs.push({ item_id: extraId, quantity: extra.quantity });
    }
    const { error: clearError } = await supabase.from('nexora_preparation_outputs').delete().eq('preparation_id', preparationId);
    if (clearError) return failed(userFacingError(clearError), { itemsCreated, preparationsSaved: saved });
    if (outputs.length > 0) {
      const { error: outputsError } = await supabase
        .from('nexora_preparation_outputs').insert(outputs.map((output) => ({ preparation_id: preparationId, ...output })));
      if (outputsError) return failed(userFacingError(outputsError), { itemsCreated, preparationsSaved: saved });
    }
    saved += 1;
  }

  return { ok: true, message: null, itemsCreated, preparationsSaved: saved };
}
