// Lectura y validación del archivo de recetas (Producto, Insumo, Cantidad, Unidad).
// Sin React ni Supabase, para poder probarlo solo.

export type RecipeUnit = 'g' | 'kg' | 'ml' | 'l' | 'unidad';

export type RecipeRow = {
  rowNumber: number;
  product: string;
  item: string;
  quantity: number | null;
  unit: RecipeUnit | null;
  unitText: string;
  errors: string[];
};

export type ParsedRecipes = { rows: RecipeRow[]; missingColumns: string[] };

export type PlanProduct = { id: string; name: string };
export type PlanItem = { id: string; name: string; unit: RecipeUnit };

export type PlanLine = {
  row: RecipeRow;
  productId: string | null;
  itemId: string | null;
  /** Nombre de un insumo que todavía no existe y se va a crear. */
  newItemName: string | null;
  /** Cantidad ya convertida a la unidad del insumo. */
  quantity: number | null;
  errors: string[];
};

export type RecipePlan = {
  lines: PlanLine[];
  newItems: { name: string; unit: RecipeUnit }[];
};

export const RECIPE_HEADERS = ['Producto', 'Insumo', 'Cantidad', 'Unidad'];

const FIELD_BY_HEADER: Record<string, 'product' | 'item' | 'quantity' | 'unit'> = {
  producto: 'product', plato: 'product', nombre: 'product', 'nombre del producto': 'product',
  insumo: 'item', ingrediente: 'item', 'nombre del insumo': 'item',
  cantidad: 'quantity', 'cantidad por plato': 'quantity', 'cantidad por porcion': 'quantity',
  unidad: 'unit', 'unidad de medida': 'unit',
};

/** Compara nombres sin importar mayúsculas, tildes ni espacios de más. */
export function normalizeName(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function parseUnit(value: string): RecipeUnit | null {
  const key = normalizeName(value).replace(/\.$/, '');
  if (['g', 'gr', 'grs', 'gramo', 'gramos'].includes(key)) return 'g';
  if (['kg', 'kgs', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(key)) return 'kg';
  if (['ml', 'mililitro', 'mililitros', 'cc'].includes(key)) return 'ml';
  if (['l', 'lt', 'lts', 'litro', 'litros'].includes(key)) return 'l';
  if (['unidad', 'unidades', 'und', 'unid', 'u', 'un'].includes(key)) return 'unidad';
  return null;
}

/** Lee "150", "0,5", "0.25", "1.250,5". La coma o el punto marcan decimales; si hay ambos, el último es el decimal. */
export function parseQuantity(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim().replace(/\s/g, '');
  if (text === '' || !/^\d[\d.,]*$/.test(text)) return null;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  let normalized = text;
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalIsComma = lastComma > lastDot;
    normalized = decimalIsComma ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (lastComma !== -1) {
    normalized = text.replace(/,/g, '.');
  }
  if ((normalized.match(/\./g) ?? []).length > 1) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pasa una cantidad de una unidad a otra de la misma familia (g↔kg, ml↔l). Devuelve null si no son compatibles. */
export function convertQuantity(quantity: number, from: RecipeUnit, to: RecipeUnit): number | null {
  if (from === to) return quantity;
  const factors: Partial<Record<RecipeUnit, Partial<Record<RecipeUnit, number>>>> = {
    g: { kg: 1 / 1000 }, kg: { g: 1000 }, ml: { l: 1 / 1000 }, l: { ml: 1000 },
  };
  const factor = factors[from]?.[to];
  return factor === undefined ? null : Math.round(quantity * factor * 1000) / 1000;
}

export function parseRecipeRecords(records: Record<string, unknown>[]): ParsedRecipes {
  if (records.length === 0) return { rows: [], missingColumns: [] };
  const fieldByColumn = new Map<string, 'product' | 'item' | 'quantity' | 'unit'>();
  for (const column of Object.keys(records[0] ?? {})) {
    const field = FIELD_BY_HEADER[normalizeName(column)];
    if (field) fieldByColumn.set(column, field);
  }
  const found = new Set(fieldByColumn.values());
  const missingColumns = (['product', 'item', 'quantity'] as const)
    .filter((field) => !found.has(field))
    .map((field) => ({ product: 'Producto', item: 'Insumo', quantity: 'Cantidad' })[field]);
  if (missingColumns.length > 0) return { rows: [], missingColumns };

  const rows: RecipeRow[] = [];
  records.forEach((record: Record<string, unknown>, index: number) => {
    const values: Record<string, unknown> = {};
    for (const [column, field] of fieldByColumn) values[field] = record[column];
    const product = String(values.product ?? '').trim();
    const item = String(values.item ?? '').trim();
    const rawQuantity = values.quantity;
    const unitText = String(values.unit ?? '').trim();
    if (product === '' && item === '' && String(rawQuantity ?? '').trim() === '') return;

    const errors: string[] = [];
    if (product === '') errors.push('Falta el producto');
    if (item === '') errors.push('Falta el insumo');
    const quantity = parseQuantity(rawQuantity);
    if (quantity === null) errors.push(String(rawQuantity ?? '').trim() === '' ? 'Falta la cantidad' : 'La cantidad no es un número');
    else if (quantity <= 0) errors.push('La cantidad debe ser mayor que cero');
    const unit = unitText === '' ? null : parseUnit(unitText);
    if (unitText !== '' && unit === null) errors.push(`Unidad no reconocida: "${unitText}" (usa g, kg, ml, l o unidad)`);
    rows.push({ rowNumber: index + 2, product, item, quantity, unit, unitText, errors });
  });
  return { rows, missingColumns: [] };
}

/** Cruza el archivo con los productos y los insumos que ya existen. No toca la base de datos. */
export function buildRecipePlan(rows: RecipeRow[], products: PlanProduct[], items: PlanItem[]): RecipePlan {
  const productByName = new Map(products.map((product: PlanProduct) => [normalizeName(product.name), product]));
  const itemByName = new Map(items.map((item: PlanItem) => [normalizeName(item.name), item]));
  const newItemUnit = new Map<string, { name: string; unit: RecipeUnit }>();
  const seen = new Set<string>();
  const lines: PlanLine[] = [];

  for (const row of rows) {
    const errors = [...row.errors];
    const product = productByName.get(normalizeName(row.product));
    if (row.product !== '' && !product) errors.push('Ese producto no está en la carta (revisa que se llame igual)');

    const itemKey = normalizeName(row.item);
    const existing = itemByName.get(itemKey);
    let quantity: number | null = row.quantity;
    let newItemName: string | null = null;

    if (row.item !== '' && quantity !== null && quantity > 0) {
      if (existing) {
        if (row.unit) {
          quantity = convertQuantity(quantity, row.unit, existing.unit);
          if (quantity === null) errors.push(`El insumo está en ${existing.unit} y la fila en ${row.unit}: no se pueden convertir`);
        }
      } else if (row.unit || newItemUnit.has(itemKey)) {
        const known = newItemUnit.get(itemKey);
        if (!known && row.unit) newItemUnit.set(itemKey, { name: row.item, unit: row.unit });
        else if (known && row.unit) {
          quantity = convertQuantity(quantity, row.unit, known.unit);
          if (quantity === null) errors.push(`Este insumo nuevo aparece con unidades distintas (${known.unit} y ${row.unit})`);
        }
        newItemName = known?.name ?? row.item;
      } else {
        errors.push('El insumo no existe en inventario. Agrega la columna Unidad para crearlo automáticamente, o créalo antes');
      }
    }

    const pairKey = `${normalizeName(row.product)}|${itemKey}`;
    if (row.product !== '' && row.item !== '') {
      if (seen.has(pairKey)) errors.push('Este insumo ya aparece en el mismo producto');
      seen.add(pairKey);
    }

    lines.push({
      row,
      productId: product?.id ?? null,
      itemId: existing?.id ?? null,
      newItemName: errors.length === 0 ? newItemName : null,
      quantity: errors.length === 0 ? quantity : null,
      errors,
    });
  }

  const used = new Set(lines.filter((line: PlanLine) => line.errors.length === 0 && line.newItemName).map((line: PlanLine) => normalizeName(line.newItemName ?? '')));
  const newItems = Array.from(newItemUnit.entries()).filter(([key]) => used.has(key)).map(([, value]) => value);
  return { lines, newItems };
}
