import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { csvToObjects, decodeCsvBytes, downloadCsv, toCsv } from '@/lib/importParsing';
import { fetchCatalogForRecipes, fetchInventory, type CatalogProduct, type InventoryItem, type RecipeLine } from '@/lib/inventory';
import { RECIPE_HEADERS, buildRecipePlan, parseRecipeRecords, type PlanLine, type RecipePlan, type RecipeRow } from '@/lib/recipeImport';
import { applyRecipePlan, type RecipeImportOutcome } from '@/lib/recipeImportApi';
import { SimilarItemsPanel } from '@/components/inventory/SimilarItemsPanel';
import { findSimilarNames, findUnitDifferences, pendingDecisions, resolveName, type KnownItem, type NameDecision, type NameEntry } from '@/lib/similarItems';
import '@/components/inventory/inventory-import.css';
import '@/components/inventory/menu-import.css';

type RecipeImportDialogProps = { onClose: () => void; onImported: () => void };

const EXAMPLE_ROWS: (string | number)[][] = [
  ['Hamburguesa Doña Carmen', 'Pan hamburguesa', 1, 'unidad', 'estanteria'],
  ['Hamburguesa Doña Carmen', 'Carne res molida', 150, 'g', 'nevera'],
  ['Hamburguesa Doña Carmen', 'Queso mozzarella', 40, 'g', 'nevera'],
  ['Perro Caliente Normal', 'Pan perro', 1, 'unidad', 'estanteria'],
  ['Perro Caliente Normal', 'Salchicha', 1, 'unidad', 'nevera'],
];

export function RecipeImportDialog({ onClose, onImported }: RecipeImportDialogProps) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [existingLines, setExistingLines] = useState<RecipeLine[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RecipeImportOutcome | null>(null);
  const [decisions, setDecisions] = useState<Record<string, NameDecision>>({});

  const loadReference = useCallback(async (): Promise<void> => {
    const [catalog, inventory] = await Promise.all([fetchCatalogForRecipes(), fetchInventory()]);
    setProducts(catalog.products);
    setExistingLines(catalog.recipeLines);
    setItems([...inventory.items, ...inventory.archivedItems]);
    setLoadError(catalog.error ?? inventory.error);
  }, []);

  useEffect(() => {
    void loadReference();
  }, [loadReference]);

  const known: KnownItem[] = useMemo(
    () => items.map((item: InventoryItem) => ({ id: item.id, name: item.name, unit: item.unit, archived: !item.is_active })),
    [items],
  );
  const entries: NameEntry[] = useMemo(
    () => rows.filter((row: RecipeRow) => row.item !== '').map((row: RecipeRow) => ({ name: row.item, unit: row.unit, rowNumber: row.rowNumber })),
    [rows],
  );
  const hits = useMemo(() => findSimilarNames(entries, known), [entries, known]);
  const unitDifferences = useMemo(
    () => findUnitDifferences(entries.map((entry: NameEntry) => ({ ...entry, name: resolveName(entry.name, decisions, known) })), known),
    [entries, decisions, known],
  );
  const pending = pendingDecisions(hits, decisions);
  const effectiveRows = useMemo(
    () => rows.map((row: RecipeRow) => ({ ...row, item: resolveName(row.item, decisions, known) })),
    [rows, decisions, known],
  );

  const plan: RecipePlan = useMemo(
    () => buildRecipePlan(effectiveRows, products, items.map((item: InventoryItem) => ({ id: item.id, name: item.name, unit: item.unit }))),
    [effectiveRows, products, items],
  );
  const validLines = plan.lines.filter((line: PlanLine) => line.errors.length === 0);
  const errorLines = plan.lines.length - validLines.length;
  const productsInFile = new Set(validLines.map((line: PlanLine) => line.productId)).size;
  const productsWithRecipe = new Set(existingLines.map((line: RecipeLine) => line.product_id));
  const willReplace = new Set(validLines.filter((line: PlanLine) => line.productId && productsWithRecipe.has(line.productId)).map((line: PlanLine) => line.productId)).size;

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setOutcome(null);
    setDecisions({});
    const reader = new FileReader();
    reader.onload = (loadEvent: ProgressEvent<FileReader>) => {
      try {
        const buffer = loadEvent.target?.result as ArrayBuffer;
        let records: Record<string, unknown>[];
        if (/\.(csv|txt)$/i.test(file.name)) {
          records = csvToObjects(decodeCsvBytes(buffer));
        } else {
          const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ''];
          records = sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }) : [];
        }
        const parsed = parseRecipeRecords(records);
        if (parsed.missingColumns.length > 0) {
          setParseError(`Faltan columnas: ${parsed.missingColumns.join(', ')}. El archivo necesita Producto, Insumo y Cantidad (Unidad es opcional).`);
          setRows([]);
          return;
        }
        if (parsed.rows.length === 0) {
          setParseError('El archivo no tiene filas con datos.');
          setRows([]);
          return;
        }
        setRows(parsed.rows);
      } catch {
        setParseError('No pudimos leer el archivo. Usa un CSV o un Excel (.xlsx).');
        setRows([]);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleImport = async (): Promise<void> => {
    setBusy(true);
    const result = await applyRecipePlan(plan, existingLines, replace);
    setBusy(false);
    setOutcome(result);
    if (result.ok || result.linesSaved > 0 || result.itemsCreated > 0) {
      onImported();
      void loadReference();
    }
  };

  const downloadTemplate = (): void => downloadCsv('plantilla-recetas.csv', toCsv(RECIPE_HEADERS, EXAMPLE_ROWS));

  const exportCurrent = (): void => {
    const productName = new Map(products.map((product: CatalogProduct) => [product.id, product.name]));
    const itemById = new Map(items.map((item: InventoryItem) => [item.id, item]));
    const data = existingLines
      .map((line: RecipeLine): (string | number)[] | null => {
        const product = productName.get(line.product_id);
        const item = itemById.get(line.item_id);
        return product && item ? [product, item.name, line.quantity, item.unit] : null;
      })
      .filter((line): line is (string | number)[] => line !== null);
    downloadCsv('recetas-actuales.csv', toCsv(RECIPE_HEADERS, data));
  };

  return (
    <div className="team-dialog-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <section className="team-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="recipe-import-title" onClick={(event: React.MouseEvent<HTMLElement>) => event.stopPropagation()}>
        <div className="team-dialog-heading">
          <div>
            <p className="eyebrow">Inventario</p>
            <h2 id="recipe-import-title">Importar recetas</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose} disabled={busy}><X size={17} /></button>
        </div>

        <div className="import-actions-row">
          <button className="outline-button" type="button" onClick={downloadTemplate}><Download size={16} /> Plantilla CSV</button>
          <button className="outline-button" type="button" onClick={exportCurrent} disabled={existingLines.length === 0}><Download size={16} /> Exportar recetas actuales</button>
        </div>

        <div className="import-guide">
          <h3>Una fila por cada insumo de cada plato</h3>
          <table className="import-guide-table">
            <thead><tr><th>Columna</th><th>Obligatorio</th><th>Qué poner</th></tr></thead>
            <tbody>
              <tr><td>Producto</td><td className="required">Sí</td><td>El nombre del plato, igual que en la carta</td></tr>
              <tr><td>Insumo</td><td className="required">Sí</td><td>El nombre del insumo en Inventario</td></tr>
              <tr><td>Cantidad</td><td className="required">Sí</td><td>Cuánto lleva un plato (número; decimales con coma o punto)</td></tr>
              <tr><td>Ubicación</td><td>No</td><td>nevera, estanteria o bodega. Solo se usa al crear un insumo nuevo; si no la pones, queda en bodega</td></tr>
              <tr><td>Unidad</td><td>No</td><td>g, kg, ml, l o unidad. Si el insumo está en otra unidad compatible, se convierte (150 g = 0,15 kg). Si el insumo no existe, con la unidad se crea en la bodega con stock 0</td></tr>
            </tbody>
          </table>
          <p className="muted">Mayúsculas y tildes no importan al buscar nombres. Una fila repite el producto tantas veces como insumos tenga.</p>
        </div>

        {loadError && <p className="auth-feedback error" role="alert">{loadError}</p>}

        <div className="import-file-area">
          <label className="import-file-label">
            <input type="file" accept=".csv,.txt,.xls,.xlsx" onChange={handleFile} disabled={busy} />
            <FileSpreadsheet size={20} />
            <span>{fileName ?? 'Selecciona un archivo .csv o .xlsx'}</span>
          </label>
        </div>

        {parseError && <p className="auth-feedback error" role="alert">{parseError}</p>}

        {outcome && (
          <div className="import-result">
            <div className="import-result-summary">
              {outcome.linesSaved > 0 && <span className="import-stat created"><CheckCircle2 size={16} /> {outcome.linesSaved} líneas guardadas en {outcome.productsTouched} productos</span>}
              {outcome.itemsCreated > 0 && <span className="import-stat created"><CheckCircle2 size={16} /> {outcome.itemsCreated} insumos nuevos (stock 0)</span>}
              {outcome.linesRemoved > 0 && <span className="import-stat updated"><CheckCircle2 size={16} /> {outcome.linesRemoved} insumos quitados de recetas</span>}
              {!outcome.ok && <span className="import-stat skipped"><AlertTriangle size={16} /> {outcome.message}</span>}
            </div>
            {outcome.ok && outcome.itemsCreated > 0 && <p className="muted">Los insumos nuevos quedan con stock 0: registra su compra o conteo en Inventario, o esos platos saldrán agotados.</p>}
          </div>
        )}

        {rows.length > 0 && !outcome && (
          <div className="import-preview">
            <h3>Vista previa ({rows.length} filas)</h3>
            <p className="muted">
              {validLines.length} listas para importar en {productsInFile} productos{errorLines > 0 ? `, ${errorLines} con errores (se omiten)` : ''}.
              {plan.newItems.length > 0 ? ` Se crearán ${plan.newItems.length} insumos nuevos con stock 0.` : ''}
            </p>
            <SimilarItemsPanel
              hits={hits}
              decisions={decisions}
              onDecide={(key: string, decision: NameDecision) => setDecisions((current: Record<string, NameDecision>) => ({ ...current, [key]: decision }))}
              unitDifferences={unitDifferences}
              disabled={busy}
            />
            <label className="import-check">
              <input type="checkbox" checked={replace} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setReplace(event.target.checked)} disabled={busy} />
              <span>Quitar de cada plato los insumos que no estén en el archivo{willReplace > 0 ? ` (${willReplace} platos ya tienen receta)` : ''}</span>
            </label>
            <div className="import-preview-scroll">
              <table className="import-preview-table">
                <thead><tr><th>Producto</th><th>Insumo</th><th>Cantidad</th><th>Estado</th></tr></thead>
                <tbody>
                  {plan.lines.map((line: PlanLine) => (
                    <tr key={line.row.rowNumber} className={line.errors.length > 0 ? 'row-error' : 'row-ok'}>
                      <td>{line.row.product || '—'}</td>
                      <td>{line.row.item || '—'}{line.newItemName ? ' (nuevo)' : ''}</td>
                      <td>{line.quantity ?? line.row.quantity ?? '—'}{line.row.unit ? ` ${line.row.unit}` : ''}</td>
                      <td>{line.errors.length > 0 ? <span className="row-status-error">Fila {line.row.rowNumber}: {line.errors.join('; ')}</span> : <span className="row-status-ok">OK</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="team-dialog-actions">
          <button className="outline-button" type="button" onClick={onClose} disabled={busy}>Cerrar</button>
          {validLines.length > 0 && !outcome && (
            <button className="primary-button" type="button" onClick={() => void handleImport()} disabled={busy || pending > 0} title={pending > 0 ? `Decide primero los ${pending} insumos parecidos` : undefined}>
              <Upload size={16} />{busy ? 'Importando...' : pending > 0 ? `Decide ${pending} insumos parecidos` : `Importar ${validLines.length} líneas`}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
