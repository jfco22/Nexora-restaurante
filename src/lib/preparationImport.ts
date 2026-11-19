// Lectura y validación del archivo de preparaciones (tandas).
// Columnas: Preparación, Rinde, Unidad rinde, Insumo, Cantidad, Unidad, Ubicación.
// Sin React ni Supabase, para poder probarlo solo.
import {
  buildRecipePlan, convertQuantity, normalizeName, parseLocation, parseQuantity, parseUnit,
  type PlanItem, type PlanLine, type RecipeLocation, type RecipeRow, type RecipeUnit,
} from '@/lib/recipeImport';

export const PREPARATION_HEADERS = ['Preparación', 'Rinde', 'Unidad rinde', 'Tipo', 'Insumo', 'Cantidad', 'Unidad', 'Ubicación'];

type Field = 'name' | 'yield' | 'yieldUnit' | 'kind' | 'item' | 'quantity' | 'unit' | 'location';

const FIELD_BY_HEADER: Record<string, Field> = {
  preparacion: 'name', 'nombre de la preparacion': 'name', tanda: 'name',
  rinde: 'yield', rendimiento: 'yield', 'rinde por tanda': 'yield',
  'unidad rinde': 'yieldUnit', 'unidad del rendimiento': 'yieldUnit', 'unidad de rinde': 'yieldUnit',
  tipo: 'kind', 'tipo de fila': 'kind',
  insumo: 'item', ingrediente: 'item',
  cantidad: 'quantity', 'cantidad por tanda': 'quantity',
  unidad: 'unit', 'unidad del insumo': 'unit',
  ubicacion: 'location', almacenamiento: 'location',
};

export type PreparationSpec = {
  name: string;
  yieldQuantity: number | null;
  yieldUnit: RecipeUnit | null;
  errors: string[];
};

/** Fila "resultado": un producto adicional que sale de la misma tanda (ej. la carne, además del caldo). */
export type ExtraOutputRow = {
  rowNumber: number;
  preparation: string;
  item: string;
  quantity: number | null;
  unit: RecipeUnit | null;
  location: RecipeLocation | null;
  errors: string[];
};

export type ParsedPreparations = { rows: RecipeRow[]; extras: ExtraOutputRow[]; specs: PreparationSpec[]; missingColumns: string[] };

const isResultKind = (value: string): boolean => ['resultado', 'sale', 'produce', 'rinde', 'salida'].includes(normalizeName(value));

export function parsePreparationRecords(records: Record<string, unknown>[]): ParsedPreparations {
  if (records.length === 0) return { rows: [], extras: [], specs: [], missingColumns: [] };
  const fieldByColumn = new Map<string, Field>();
  for (const column of Object.keys(records[0] ?? {})) {
    const field = FIELD_BY_HEADER[normalizeName(column)];
    if (field) fieldByColumn.set(column, field);
  }
  const found = new Set(fieldByColumn.values());
  const labels: Record<string, string> = { name: 'Preparación', yield: 'Rinde', item: 'Insumo', quantity: 'Cantidad' };
  const missingColumns = Object.keys(labels).filter((field) => !found.has(field as Field)).map((field) => labels[field] ?? field);
  if (missingColumns.length > 0) return { rows: [], extras: [], specs: [], missingColumns };

  const rows: RecipeRow[] = [];
  const extras: ExtraOutputRow[] = [];
  const specs = new Map<string, PreparationSpec>();
  records.forEach((record: Record<string, unknown>, index: number) => {
    const values: Partial<Record<Field, unknown>> = {};
    for (const [column, field] of fieldByColumn) values[field] = record[column];
    const name = String(values.name ?? '').trim();
    const item = String(values.item ?? '').trim();
    if (name === '' && item === '' && String(values.quantity ?? '').trim() === '') return;

    const errors: string[] = [];
    if (name === '') errors.push('Falta el nombre de la preparación');
    if (item === '') errors.push('Falta el insumo');
    const quantity = parseQuantity(values.quantity);
    if (quantity === null) errors.push(String(values.quantity ?? '').trim() === '' ? 'Falta la cantidad' : 'La cantidad no es un número');
    else if (quantity <= 0) errors.push('La cantidad debe ser mayor que cero');
    const unitText = String(values.unit ?? '').trim();
    const unit = unitText === '' ? null : parseUnit(unitText);
    if (unitText !== '' && unit === null) errors.push(`Unidad no reconocida: "${unitText}" (usa g, kg, ml, l o unidad)`);
    const locationText = String(values.location ?? '').trim();
    const location = locationText === '' ? null : parseLocation(locationText);
    if (locationText !== '' && location === null) errors.push(`Ubicación no reconocida: "${locationText}" (usa nevera, estanteria o bodega)`);

    if (isResultKind(String(values.kind ?? ''))) {
      extras.push({ rowNumber: index + 2, preparation: name, item, quantity, unit, location, errors });
      return;
    }

    // Rendimiento: se toma de la primera fila de la preparación; las demás deben coincidir si lo repiten.
    const yieldText = String(values.yield ?? '').trim();
    const yieldUnitText = String(values.yieldUnit ?? '').trim();
    if (name !== '') {
      const key = normalizeName(name);
      const parsedYield = parseQuantity(values.yield);
      const parsedYieldUnit = yieldUnitText === '' ? null : parseUnit(yieldUnitText);
      const spec = specs.get(key);
      if (!spec) {
        const specErrors: string[] = [];
        if (parsedYield === null || parsedYield <= 0) specErrors.push('Falta cuánto rinde la tanda (columna Rinde)');
        if (yieldUnitText !== '' && parsedYieldUnit === null) specErrors.push(`Unidad de rendimiento no reconocida: "${yieldUnitText}"`);
        specs.set(key, { name, yieldQuantity: parsedYield, yieldUnit: parsedYieldUnit, errors: specErrors });
      } else {
        if (yieldText !== '' && parsedYield !== null && spec.yieldQuantity !== null && parsedYield !== spec.yieldQuantity) {
          spec.errors.push(`"${name}" tiene dos rendimientos distintos (${spec.yieldQuantity} y ${parsedYield})`);
        }
        if (spec.yieldUnit === null && parsedYieldUnit !== null) spec.yieldUnit = parsedYieldUnit;
      }
    }
    rows.push({ rowNumber: index + 2, product: name, item, quantity, unit, unitText, location, errors });
  });
  return { rows, extras, specs: Array.from(specs.values()), missingColumns: [] };
}

export type PlannedPreparation = {
  name: string;
  /** Insumo resultado que ya existe, o null si hay que crearlo. */
  outputItemId: string | null;
  newOutput: { name: string; unit: RecipeUnit; location: RecipeLocation } | null;
  /** Rendimiento por tanda en la unidad del insumo resultado. */
  yieldQuantity: number;
  lines: PlanLine[];
  /** Resultados adicionales de la misma tanda (ej. la carne). */
  extraOutputs: PlannedExtraOutput[];
};

export type PlannedExtraOutput = {
  name: string;
  itemId: string | null;
  newItem: { name: string; unit: RecipeUnit; location: RecipeLocation } | null;
  /** Cantidad por tanda en la unidad del insumo. */
  quantity: number;
};

export type PreparationPlan = {
  lines: PlanLine[];
  preparations: PlannedPreparation[];
  /** Mensajes por preparación que no se puede importar (aparecen en la vista previa). */
  rejected: { name: string; reasons: string[] }[];
  newItems: { name: string; unit: RecipeUnit; location: RecipeLocation }[];
};

/** Cruza el archivo con los insumos existentes. Una preparación solo se importa completa: si una fila falla, se omite toda. */
export function buildPreparationPlan(parsed: ParsedPreparations, items: PlanItem[]): PreparationPlan {
  const base = buildRecipePlan(parsed.rows, parsed.specs.map((spec: PreparationSpec) => ({ id: normalizeName(spec.name), name: spec.name })), items);
  const itemByName = new Map(items.map((item: PlanItem) => [normalizeName(item.name), item]));

  // Una preparación no puede gastar su propio resultado.
  for (const line of base.lines) {
    if (line.row.item !== '' && normalizeName(line.row.item) === normalizeName(line.row.product)) {
      line.errors.push('Una preparación no puede gastar su propio resultado');
      line.quantity = null;
      line.newItemName = null;
    }
  }

  const preparations: PlannedPreparation[] = [];
  const rejected: { name: string; reasons: string[] }[] = [];
  const usedNewItems = new Set<string>();

  for (const spec of parsed.specs) {
    const key = normalizeName(spec.name);
    const lines = base.lines.filter((line: PlanLine) => normalizeName(line.row.product) === key);
    const reasons = [...spec.errors];
    const badLines = lines.filter((line: PlanLine) => line.errors.length > 0);
    for (const line of badLines.slice(0, 3)) reasons.push(`Fila ${line.row.rowNumber}: ${line.errors.join('; ')}`);
    if (badLines.length > 0) reasons.push('Una preparación solo se importa completa: corrige esas filas.');

    const extraOutputs: PlannedExtraOutput[] = [];
    for (const extra of parsed.extras.filter((candidate: ExtraOutputRow) => normalizeName(candidate.preparation) === key)) {
      const problems = [...extra.errors];
      const extraKey = normalizeName(extra.item);
      const found = itemByName.get(extraKey);
      let amount = extra.quantity;
      let newItem: PlannedExtraOutput['newItem'] = null;
      if (extraKey === key) problems.push('El resultado adicional no puede llamarse igual que la preparación');
      if (lines.some((line: PlanLine) => normalizeName(line.row.item) === extraKey)) problems.push('Un resultado no puede ser también un insumo gastado en la misma preparación');
      if (extra.item !== '' && amount !== null && amount > 0) {
        if (found) {
          if (extra.unit) {
            amount = convertQuantity(amount, extra.unit, found.unit);
            if (amount === null) problems.push(`"${extra.item}" está en ${found.unit} y la fila en ${extra.unit}: no se pueden convertir`);
          }
        } else if (extra.unit) {
          newItem = { name: extra.item, unit: extra.unit, location: extra.location ?? 'nevera' };
        } else {
          problems.push(`"${extra.item}" no existe como insumo: agrega la unidad para crearlo`);
        }
      }
      if (problems.length > 0) reasons.push(`Fila ${extra.rowNumber} (resultado): ${problems.join('; ')}`);
      else if (amount !== null) extraOutputs.push({ name: extra.item, itemId: found?.id ?? null, newItem, quantity: amount });
    }

    const existingOutput = itemByName.get(key);
    let yieldQuantity = spec.yieldQuantity;
    let newOutput: PlannedPreparation['newOutput'] = null;
    if (existingOutput) {
      if (spec.yieldUnit && yieldQuantity !== null) {
        yieldQuantity = convertQuantity(yieldQuantity, spec.yieldUnit, existingOutput.unit);
        if (yieldQuantity === null) reasons.push(`"${spec.name}" está en ${existingOutput.unit} y el rendimiento en ${spec.yieldUnit}: no se pueden convertir`);
      }
    } else if (spec.yieldUnit) {
      newOutput = { name: spec.name, unit: spec.yieldUnit, location: 'nevera' };
    } else {
      reasons.push(`"${spec.name}" no existe como insumo: agrega la columna "Unidad rinde" (g, ml, unidad...) para crearlo`);
    }

    if (reasons.length > 0 || yieldQuantity === null) {
      rejected.push({ name: spec.name, reasons: reasons.length > 0 ? reasons : ['Rendimiento no válido'] });
      continue;
    }
    for (const line of lines) if (line.newItemName) usedNewItems.add(normalizeName(line.newItemName));
    preparations.push({ name: spec.name, outputItemId: existingOutput?.id ?? null, newOutput, yieldQuantity, lines, extraOutputs });
  }

  const newItems = base.newItems.filter((item) => usedNewItems.has(normalizeName(item.name)));
  // Un resultado extra que también se pide como insumo nuevo en otra preparación se crea una sola vez (lo dedupe la API).
  return { lines: base.lines, preparations, rejected, newItems };
}
