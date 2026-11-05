import { useCallback, useState } from 'react';
import { FileSpreadsheet, Upload, Download, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';

type ImportRow = {
  name: string;
  unit: string;
  storage_location: string;
  current_stock: number;
  min_stock: number;
  unit_cost_cop: number;
  purchase_quantity: number | null;
  _errors: string[];
};

type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  details: { name: string; reason: string }[];
};

const VALID_UNITS = ['g', 'kg', 'ml', 'l', 'unidad'];
const VALID_STORAGES = ['nevera', 'estanteria', 'bodega'];

const UNIT_ALIASES: Record<string, string> = {
  gramos: 'g', gramo: 'g', 'g': 'g', gr: 'g',
  kilos: 'kg', kilo: 'kg', 'kg': 'kg',
  mililitros: 'ml', mililitro: 'ml', 'ml': 'ml',
  litros: 'l', litro: 'l', 'l': 'l',
  unidades: 'unidad', unidad: 'unidad', u: 'unidad', un: 'unidad', und: 'unidad',
};

const STORAGE_ALIASES: Record<string, string> = {
  nevera: 'nevera', refrigerador: 'nevera',
  estanteria: 'estanteria', estante: 'estanteria', estantería: 'estanteria',
  bodega: 'bodega', almacen: 'bodega', almacén: 'bodega',
};

const FIELD_MAP: Record<string, keyof ImportRow> = {
  'nombre': 'name', 'nombre del insumo': 'name', 'producto': 'name', 'insumo': 'name',
  'unidad': 'unit', 'unidad de medida': 'unit',
  'ubicacion': 'storage_location', 'ubicación': 'storage_location', 'almacenamiento': 'storage_location', 'storage': 'storage_location',
  'stock': 'current_stock', 'stock actual': 'current_stock', 'cantidad': 'current_stock', 'existencia': 'current_stock', 'stock 31-oct': 'current_stock',
  'stock minimo': 'min_stock', 'stock mínimo': 'min_stock', 'minimo': 'min_stock', 'mínimo': 'min_stock',
  'costo': 'unit_cost_cop', 'costo unitario': 'unit_cost_cop', 'costo cop': 'unit_cost_cop', 'precio': 'unit_cost_cop',
  'compra': 'purchase_quantity', 'cantidad comprada': 'purchase_quantity', 'purchase': 'purchase_quantity',
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().trim();
}

function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

function resolveUnit(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  if (UNIT_ALIASES[lower]) return UNIT_ALIASES[lower];
  return null;
}

function resolveStorage(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  if (STORAGE_ALIASES[lower]) return STORAGE_ALIASES[lower];
  return null;
}

function parseWorkbook(workbook: XLSX.WorkBook): ImportRow[] {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const headerMap = new Map<string, keyof ImportRow>();
  if (rawRows.length > 0) {
    Object.keys(rawRows[0]).forEach((header: string) => {
      const normalized = normalizeHeader(header);
      if (FIELD_MAP[normalized]) headerMap.set(header, FIELD_MAP[normalized]);
    });
  }

  return rawRows.map((rawRow: Record<string, unknown>): ImportRow => {
    const mapped: Partial<ImportRow> = { _errors: [] };
    for (const [originalHeader, fieldKey] of headerMap) {
      mapped[fieldKey] = rawRow[originalHeader] as never;
    }

    const name = String(mapped.name ?? '').trim();
    const rawUnit = String(mapped.unit ?? '').trim();
    const rawStorage = String(mapped.storage_location ?? '').trim();
    const currentStock = parseNumeric(mapped.current_stock);
    const minStock = parseNumeric(mapped.min_stock);
    const unitCost = parseNumeric(mapped.unit_cost_cop);
    const purchaseQty = parseNumeric(mapped.purchase_quantity);

    const errors: string[] = [];
    if (!name) errors.push('Falta el nombre');
    const unit = resolveUnit(rawUnit);
    if (!unit) errors.push('Unidad no válida');
    const storage = resolveStorage(rawStorage);
    if (!storage) errors.push('Ubicación no válida');
    if (currentStock === null) errors.push('Falta el stock actual');
    if (currentStock !== null && currentStock < 0) errors.push('Stock negativo');

    return {
      name,
      unit: unit ?? rawUnit,
      storage_location: storage ?? rawStorage,
      current_stock: currentStock ?? 0,
      min_stock: minStock ?? 0,
      unit_cost_cop: unitCost ?? 0,
      purchase_quantity: purchaseQty,
      _errors: errors,
    };
  });
}

type InventoryImportDialogProps = { onClose: () => void; onImported: () => void };

export function InventoryImportDialog({ onClose, onImported }: InventoryImportDialogProps) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const validRows = rows.filter((row: ImportRow) => row._errors.length === 0);
  const errorRows = rows.filter((row: ImportRow) => row._errors.length > 0);

  const handleFile = useCallback((event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setResult(null);
    setServerError(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>): void => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const parsed = parseWorkbook(workbook);
        if (parsed.length === 0) {
          setParseError('El archivo no tiene filas con datos o las columnas no coinciden con el formato esperado.');
          setRows([]);
          return;
        }
        setRows(parsed);
      } catch {
        setParseError('No pudimos leer el archivo. Asegúrate de que sea un Excel válido (.xls o .xlsx).');
        setRows([]);
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleImport = async (): Promise<void> => {
    if (validRows.length === 0) return;
    setBusy(true);
    setServerError(null);

    const items = validRows.map((row: ImportRow) => ({
      name: row.name,
      unit: row.unit,
      storage_location: row.storage_location,
      current_stock: row.current_stock,
      min_stock: row.min_stock,
      unit_cost_cop: row.unit_cost_cop,
      purchase_quantity: row.purchase_quantity,
    }));

    const { data, error } = await supabase.rpc('import_nexora_inventory', { payload: { items } });

    setBusy(false);

    if (error || !data || !Array.isArray(data) || data.length === 0) {
      setServerError('No pudimos importar el inventario. Revisa tus permisos e inténtalo de nuevo.');
      return;
    }

    const res = data[0] as ImportResult;
    setResult(res);
    if (res.skipped === 0 || (res.created + res.updated) > 0) {
      onImported();
    }
  };

  return (
    <div className="team-dialog-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <section className="team-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title" onClick={(event: React.MouseEvent<HTMLElement>) => event.stopPropagation()}>
        <div className="team-dialog-heading">
          <div>
            <p className="eyebrow">Inventario</p>
            <h2 id="import-title">Importar desde Excel</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose} disabled={busy}><X size={17} /></button>
        </div>

        <div className="import-actions-row">
          <button className="outline-button" type="button" onClick={() => {
            const templateRows = [
              { 'Nombre': 'Carne res molida', 'Unidad': 'kg', 'Ubicación': 'nevera', 'Stock actual': 10, 'Stock mínimo': 2, 'Costo unitario (COP)': 18000, 'Cantidad comprada': '' },
              { 'Nombre': 'Pan hamburguesa', 'Unidad': 'unidad', 'Ubicación': 'estanteria', 'Stock actual': 24, 'Stock mínimo': 10, 'Costo unitario (COP)': 800, 'Cantidad comprada': '' },
              { 'Nombre': 'Coca-Cola 250ml', 'Unidad': 'unidad', 'Ubicación': 'bodega', 'Stock actual': 25, 'Stock mínimo': 12, 'Costo unitario (COP)': 1500, 'Cantidad comprada': 24 },
            ];
            const ws = XLSX.utils.json_to_sheet(templateRows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
            XLSX.writeFile(wb, 'plantilla-inventario-nexora.xlsx');
          }}><Download size={16} /> Descargar plantilla</button>
        </div>

        <div className="import-guide">
          <h3>Campos del archivo</h3>
          <table className="import-guide-table">
            <thead>
              <tr><th>Columna</th><th>Obligatorio</th><th>Valores aceptados</th></tr>
            </thead>
            <tbody>
              <tr><td>Nombre</td><td className="required">Sí</td><td>Texto del insumo</td></tr>
              <tr><td>Unidad</td><td className="required">Sí</td><td>g, kg, ml, l, unidad</td></tr>
              <tr><td>Ubicación</td><td className="required">Sí</td><td>nevera, estanteria, bodega</td></tr>
              <tr><td>Stock actual</td><td className="required">Sí</td><td>Número (conteo físico)</td></tr>
              <tr><td>Stock mínimo</td><td>No</td><td>Número (0 si está vacío)</td></tr>
              <tr><td>Costo unitario (COP)</td><td>No</td><td>Número en pesos (0 si está vacío)</td></tr>
              <tr><td>Cantidad comprada</td><td>No</td><td>Número (registra una compra)</td></tr>
            </tbody>
          </table>
          <p className="muted">Si un insumo ya existe por nombre, se actualiza. Si no existe, se crea. El stock se ajusta al valor del archivo y queda registrado en el historial.</p>
          <a className="import-guide-link" href="/docs/guia-inventario.html" target="_blank" rel="noopener">Ver guía completa en PDF</a>
        </div>

        <div className="import-file-area">
          <label className="import-file-label">
            <input type="file" accept=".xls,.xlsx,.csv" onChange={(event) => handleFile(event)} disabled={busy} />
            <FileSpreadsheet size={20} />
            <span>{fileName ?? 'Selecciona un archivo .xls o .xlsx'}</span>
          </label>
        </div>

        {parseError && <p className="auth-feedback error" role="alert">{parseError}</p>}
        {serverError && <p className="auth-feedback error" role="alert">{serverError}</p>}

        {result && (
          <div className="import-result">
            <div className="import-result-summary">
              <span className="import-stat created"><CheckCircle2 size={16} /> {result.created} creados</span>
              <span className="import-stat updated"><CheckCircle2 size={16} /> {result.updated} actualizados</span>
              {result.skipped > 0 && <span className="import-stat skipped"><AlertTriangle size={16} /> {result.skipped} omitidos</span>}
            </div>
            {result.details.length > 0 && (
              <ul className="import-error-list">
                {result.details.map((detail, index) => <li key={index}><strong>{detail.name || 'Sin nombre'}:</strong> {detail.reason}</li>)}
              </ul>
            )}
          </div>
        )}

        {rows.length > 0 && !result && (
          <div className="import-preview">
            <h3>Vista previa ({rows.length} filas)</h3>
            <p className="muted">{validRows.length} listas para importar{errorRows.length > 0 ? `, ${errorRows.length} con errores` : ''}.</p>
            <div className="import-preview-scroll">
              <table className="import-preview-table">
                <thead>
                  <tr><th>Nombre</th><th>Unidad</th><th>Ubicación</th><th>Stock</th><th>Mín</th><th>Costo</th><th>Estado</th></tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index} className={row._errors.length > 0 ? 'row-error' : 'row-ok'}>
                      <td>{row.name || '—'}</td>
                      <td>{row.unit}</td>
                      <td>{row.storage_location}</td>
                      <td>{row.current_stock}</td>
                      <td>{row.min_stock}</td>
                      <td>{row.unit_cost_cop > 0 ? `$${row.unit_cost_cop.toLocaleString('es-CO')}` : '—'}</td>
                      <td>{row._errors.length > 0 ? <span className="row-status-error">{row._errors.join(', ')}</span> : <span className="row-status-ok">OK</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="team-dialog-actions">
          <button className="outline-button" type="button" onClick={onClose} disabled={busy}>Cerrar</button>
          {validRows.length > 0 && !result && (
            <button className="primary-button" type="button" onClick={() => void handleImport()} disabled={busy}>
              <Upload size={16} />{busy ? 'Importando...' : `Importar ${validRows.length} insumos`}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
