import { supabase } from '@/lib/supabase';
import { userFacingError } from '@/lib/tableAccount';

export type StorageLocation = 'nevera' | 'estanteria' | 'bodega';
export type InventoryUnit = 'g' | 'kg' | 'ml' | 'l' | 'unidad';
export type MovementKind = 'purchase' | 'waste' | 'adjustment';

export type InventoryItem = {
  id: string;
  name: string;
  unit: InventoryUnit;
  storage_location: StorageLocation;
  min_stock: number;
  current_stock: number;
  unit_cost_cop: number;
  is_active: boolean;
};

export type InventoryItemInput = {
  name: string;
  unit: InventoryUnit;
  storage_location: StorageLocation;
  min_stock: number;
};

export type CatalogProduct = { id: string; name: string; category: string };

export type RecipeLine = { product_id: string; item_id: string; quantity: number };

export type InventorySnapshot = {
  items: InventoryItem[];
  archivedItems: InventoryItem[];
  usedToday: Map<string, number>;
  error: string | null;
};

export const storageLabels: Record<StorageLocation, string> = {
  nevera: 'Nevera',
  estanteria: 'Estantería',
  bodega: 'Bodega',
};

export const unitLabels: Record<InventoryUnit, string> = {
  g: 'gramos',
  kg: 'kilos',
  ml: 'mililitros',
  l: 'litros',
  unidad: 'unidades',
};

export const movementLabels: Record<MovementKind, string> = {
  purchase: 'Compra',
  waste: 'Merma',
  adjustment: 'Ajuste por conteo',
};

export type StockStatus = 'negative' | 'empty' | 'low' | 'ok';

export function stockStatus(item: InventoryItem): StockStatus {
  if (item.current_stock < 0) return 'negative';
  if (item.current_stock === 0) return 'empty';
  if (item.current_stock <= item.min_stock) return 'low';
  return 'ok';
}

export const formatQuantity = (value: number, unit: InventoryUnit): string =>
  `${value.toLocaleString('es-CO', { maximumFractionDigits: 3 })} ${unit}`;

export function suggestedPurchase(item: InventoryItem): number {
  return Math.max(item.min_stock * 2 - item.current_stock, 0);
}

export async function fetchInventory(): Promise<InventorySnapshot> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [itemsResult, usageResult] = await Promise.all([
    supabase
      .from('nexora_inventory_items')
      .select('id, name, unit, storage_location, min_stock, current_stock, unit_cost_cop, is_active')
      .order('name'),
    supabase
      .from('nexora_inventory_movements')
      .select('item_id, quantity')
      .eq('kind', 'consumption')
      .gte('created_at', startOfToday.toISOString()),
  ]);

  if (itemsResult.error || usageResult.error) {
    return { items: [], archivedItems: [], usedToday: new Map(), error: 'No pudimos cargar el inventario.' };
  }

  const usedToday = new Map<string, number>();
  for (const movement of (usageResult.data ?? []) as { item_id: string; quantity: number }[]) {
    usedToday.set(movement.item_id, (usedToday.get(movement.item_id) ?? 0) - movement.quantity);
  }

  const allItems = (itemsResult.data ?? []) as InventoryItem[];
  return {
    items: allItems.filter((item: InventoryItem) => item.is_active),
    archivedItems: allItems.filter((item: InventoryItem) => !item.is_active),
    usedToday,
    error: null,
  };
}

export async function setInventoryItemActive(itemId: string, active: boolean): Promise<string | null> {
  const { error } = await supabase.from('nexora_inventory_items').update({ is_active: active }).eq('id', itemId);
  return error ? userFacingError(error) : null;
}

export async function saveInventoryItem(itemId: string | null, input: InventoryItemInput): Promise<string | null> {
  const payload = {
    name: input.name.trim(),
    unit: input.unit,
    storage_location: input.storage_location,
    min_stock: input.min_stock,
  };
  const { error } = itemId
    ? await supabase.from('nexora_inventory_items').update(payload).eq('id', itemId)
    : await supabase.from('nexora_inventory_items').insert(payload);
  if (!error) return null;
  return error.code === '23505' ? 'Ya existe un insumo con ese nombre.' : userFacingError(error);
}

export async function registerInventoryMovement(
  itemId: string,
  kind: MovementKind,
  quantity: number,
  unitCost: number | null,
  note: string | null,
): Promise<string | null> {
  const { error } = await supabase.rpc('register_nexora_inventory_movement', {
    item_id_input: itemId,
    kind_input: kind,
    quantity_input: quantity,
    unit_cost_input: unitCost,
    note_input: note,
  });
  return error ? userFacingError(error) : null;
}

export async function fetchCatalogForRecipes(): Promise<{
  products: CatalogProduct[];
  recipeLines: RecipeLine[];
  error: string | null;
}> {
  const [productsResult, categoriesResult, linesResult] = await Promise.all([
    supabase.from('nexora_products').select('id, name, category_id').eq('is_active', true).order('name'),
    supabase.from('nexora_categories').select('id, name'),
    supabase.from('nexora_product_recipes').select('product_id, item_id, quantity').eq('is_active', true),
  ]);

  if (productsResult.error || categoriesResult.error || linesResult.error) {
    return { products: [], recipeLines: [], error: 'No pudimos cargar la carta y las recetas.' };
  }

  const categoryNames = new Map<string, string>(
    (categoriesResult.data ?? []).map((category: { id: string; name: string }) => [category.id, category.name]),
  );
  const products: CatalogProduct[] = (productsResult.data ?? []).map((product: { id: string; name: string; category_id: string }) => ({
    id: product.id,
    name: product.name,
    category: categoryNames.get(product.category_id) ?? 'Carta',
  }));

  return { products, recipeLines: (linesResult.data ?? []) as RecipeLine[], error: null };
}

export async function saveRecipeLine(productId: string, itemId: string, quantity: number): Promise<string | null> {
  const { error } = await supabase
    .from('nexora_product_recipes')
    .upsert({ product_id: productId, item_id: itemId, quantity, is_active: true }, { onConflict: 'product_id,item_id' });
  return error ? userFacingError(error) : null;
}

export async function deactivateRecipeLine(productId: string, itemId: string): Promise<string | null> {
  const { error } = await supabase
    .from('nexora_product_recipes')
    .update({ is_active: false })
    .eq('product_id', productId)
    .eq('item_id', itemId);
  return error ? userFacingError(error) : null;
}
