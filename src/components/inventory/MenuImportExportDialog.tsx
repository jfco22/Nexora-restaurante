import { useCallback, useState } from 'react';
import { FileSpreadsheet, Upload, Download, CheckCircle2, AlertTriangle, X, Trash2, Pencil, Save, Plus } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { userFacingError } from '@/lib/tableAccount';
import { csvToObjects, decodeCsvBytes, downloadCsv, parsePriceCop, toCsv } from '@/lib/importParsing';
import '@/components/inventory/menu-import.css';

type MenuRow = {
  category: string;
  name: string;
  description: string;
  price_cop: number;
  image_url: string;
  is_available: boolean;
  _errors: string[];
};

type MenuImportResult = {
  categories_created: number;
  categories_updated: number;
  products_created: number;
  products_updated: number;
  products_skipped: number;
  details: { name: string; reason: string }[];
};

type ExistingProduct = {
  id: string;
  name: string;
  category_name: string;
  description: string;
  price_cop: number;
  image_url: string | null;
  is_available: boolean;
};

type Tab = 'import' | 'manage';

type ParsedMenu = { rows: MenuRow[]; missingColumns: string[] };

const MENU_HEADERS = ['Categoría', 'Nombre', 'Descripción', 'Precio (COP)', 'Imagen URL', 'Disponible'];

const FIELD_MAP: Record<string, keyof MenuRow> = {
  'categoria': 'category', 'categoría': 'category', 'category': 'category',
  'nombre': 'name', 'nombre del producto': 'name', 'producto': 'name',
  'descripcion': 'description', 'descripción': 'description',
  'precio': 'price_cop', 'precio cop': 'price_cop', 'price': 'price_cop', 'precio (cop)': 'price_cop',
  'imagen': 'image_url', 'imagen url': 'image_url', 'url imagen': 'image_url', 'image': 'image_url',
  'disponible': 'is_available', 'available': 'is_available',
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().trim();
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const str = String(value).toLowerCase().trim();
  // An empty cell means "Sí", as the on-screen guide says; otherwise products would be imported hidden from customers.
  return str !== 'no' && str !== 'false' && str !== '0';
}

function validateRow(category: string, name: string, price: number | null): string[] {
  const errors: string[] = [];
  if (!category) errors.push('Falta la categoría');
  if (!name) errors.push('Falta el nombre');
  if (price === null) errors.push('Falta el precio');
  if (price !== null && price <= 0) errors.push('Precio debe ser mayor a 0');
  return errors;
}

function parseWorkbook(workbook: XLSX.WorkBook): ParsedMenu {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { rows: [], missingColumns: [] };
  const sheet = workbook.Sheets[sheetName];
  return parseRawRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }));
}

function parseRawRows(rawRows: Record<string, unknown>[]): ParsedMenu {
  const headerMap = new Map<string, keyof MenuRow>();
  if (rawRows.length > 0) {
    Object.keys(rawRows[0]).forEach((header: string) => {
      const normalized = normalizeHeader(header);
      if (FIELD_MAP[normalized]) headerMap.set(header, FIELD_MAP[normalized]);
    });
  }

  const foundFields = new Set<keyof MenuRow>(headerMap.values());
  const missingColumns: string[] = [];
  if (!foundFields.has('category')) missingColumns.push('Categoría');
  if (!foundFields.has('name')) missingColumns.push('Nombre');
  if (!foundFields.has('price_cop')) missingColumns.push('Precio (COP)');

  const rows = rawRows.map((rawRow: Record<string, unknown>): MenuRow => {
    const mapped: Partial<MenuRow> = { _errors: [] };
    for (const [originalHeader, fieldKey] of headerMap) {
      mapped[fieldKey] = rawRow[originalHeader] as never;
    }

    const category = String(mapped.category ?? '').trim();
    const name = String(mapped.name ?? '').trim();
    const description = String(mapped.description ?? '').trim();
    const price = parsePriceCop(mapped.price_cop);
    const image_url = String(mapped.image_url ?? '').trim();
    const is_available = parseBoolean(mapped.is_available);

    return {
      category,
      name,
      description,
      price_cop: price ?? 0,
      image_url,
      is_available,
      _errors: validateRow(category, name, price),
    };
  });
  return { rows, missingColumns };
}

function makeEmptyRow(): MenuRow {
  return { category: '', name: '', description: '', price_cop: 0, image_url: '', is_available: true, _errors: validateRow('', '', null) };
}

type MenuImportExportDialogProps = { onClose: () => void; onImported: () => void };

export function MenuImportExportDialog({ onClose, onImported }: MenuImportExportDialogProps) {
  const [tab, setTab] = useState<Tab>('import');
  const [rows, setRows] = useState<MenuRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MenuImportResult | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<MenuRow | null>(null);

  const [products, setProducts] = useState<ExistingProduct[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editProduct, setEditProduct] = useState<ExistingProduct | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const validRows = rows.filter((row: MenuRow) => row._errors.length === 0);
  const errorRows = rows.filter((row: MenuRow) => row._errors.length > 0);

  const loadProducts = useCallback(async (): Promise<void> => {
    const [productsResult, categoriesResult] = await Promise.all([
      supabase.from('nexora_products').select('id, name, description, price_cop, image_url, is_available, category_id').eq('is_active', true).order('name'),
      supabase.from('nexora_categories').select('id, name').eq('is_active', true).order('sort_order'),
    ]);

    setProductsLoaded(true);
    if (productsResult.error || categoriesResult.error) {
      setProductError('No pudimos cargar los productos.');
      return;
    }

    const categoryNames = new Map<string, string>(
      (categoriesResult.data ?? []).map((c: { id: string; name: string }) => [c.id, c.name]),
    );

    setProducts((productsResult.data ?? []).map((p: { id: string; name: string; description: string; price_cop: number; image_url: string | null; is_available: boolean; category_id: string }): ExistingProduct => ({
      id: p.id,
      name: p.name,
      category_name: categoryNames.get(p.category_id) ?? '',
      description: p.description,
      price_cop: p.price_cop,
      image_url: p.image_url,
      is_available: p.is_available,
    })));
  }, []);

  const switchTab = (next: Tab): void => {
    if (busy) return;
    setTab(next);
    if (next === 'manage' && !productsLoaded) void loadProducts();
  };

  const handleFile = useCallback((event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setResult(null);
    setServerError(null);
    setFileName(file.name);

    const isCsv = /\.(csv|txt)$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>): void => {
      try {
        const data = e.target?.result as ArrayBuffer;
        // CSV and text files use our own reader: it keeps accents, accepts "," or ";" as separator and reads prices like "15.000".
        const parsed: ParsedMenu = isCsv
          ? parseRawRows(csvToObjects(decodeCsvBytes(data)))
          : parseWorkbook(XLSX.read(data, { type: 'array' }));
        if (parsed.rows.length === 0) {
          setParseError('El archivo no tiene filas con datos.');
          setRows([]);
          return;
        }
        if (parsed.missingColumns.length > 0) {
          setParseError(`No encontramos estas columnas en la primera fila: ${parsed.missingColumns.join(', ')}. Revisa los nombres o descarga la plantilla.`);
          setRows([]);
          return;
        }
        setRows(parsed.rows);
      } catch {
        setParseError('No pudimos leer el archivo. Asegúrate de que sea un archivo válido (.xls, .xlsx, .csv o .txt).');
        setRows([]);
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleImport = async (): Promise<void> => {
    if (validRows.length === 0) return;
    setBusy(true);
    setServerError(null);

    const categories = Array.from(new Set(validRows.map((r: MenuRow) => r.category))).map((catName, index) => ({
      name: catName,
      description: '',
      sort_order: index,
    }));

    const productsPayload = validRows.map((row: MenuRow) => ({
      category: row.category,
      name: row.name,
      description: row.description,
      price_cop: row.price_cop,
      image_url: row.image_url,
      is_available: row.is_available,
    }));

    const { data, error } = await supabase.rpc('import_nexora_menu', {
      payload: { categories, products: productsPayload },
    });

    setBusy(false);

    if (error || !data || !Array.isArray(data) || data.length === 0) {
      setServerError('No pudimos importar el menú. Revisa tus permisos e inténtalo de nuevo.');
      return;
    }

    const res = data[0] as MenuImportResult;
    setResult(res);
    onImported();
  };

  const handleExport = async (format: 'xlsx' | 'csv'): Promise<void> => {
    setBusy(true);
    setServerError(null);

    const [productsResult, categoriesResult] = await Promise.all([
      supabase.from('nexora_products').select('id, name, description, price_cop, image_url, is_available, category_id').eq('is_active', true).order('name'),
      supabase.from('nexora_categories').select('id, name').eq('is_active', true).order('sort_order'),
    ]);

    setBusy(false);

    if (productsResult.error || categoriesResult.error) {
      setServerError('No pudimos exportar el menú.');
      return;
    }

    const categoryNames = new Map<string, string>(
      (categoriesResult.data ?? []).map((c: { id: string; name: string }) => [c.id, c.name]),
    );

    const exportRows = (productsResult.data ?? []).map((p: { name: string; description: string; price_cop: number; image_url: string | null; is_available: boolean; category_id: string }) => ({
      'Categoría': categoryNames.get(p.category_id) ?? '',
      'Nombre': p.name,
      'Descripción': p.description,
      'Precio (COP)': p.price_cop,
      'Imagen URL': p.image_url ?? '',
      'Disponible': p.is_available ? 'Sí' : 'No',
    }));

    if (format === 'csv') {
      downloadCsv('nexora-menu.csv', toCsv(MENU_HEADERS, exportRows.map((row) => MENU_HEADERS.map((header: string) => row[header as keyof typeof row]))));
      return;
    }

    const ws = XLSX.utils.json_to_sheet(exportRows.length > 0 ? exportRows : [{ 'Categoría': '', 'Nombre': '', 'Descripción': '', 'Precio (COP)': '', 'Imagen URL': '', 'Disponible': '' }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Menú');
    XLSX.writeFile(wb, 'nexora-menu.xlsx');
  };

  const handleDownloadTemplate = (format: 'xlsx' | 'csv'): void => {
    const templateRows = [
      { 'Categoría': 'Entradas', 'Nombre': 'Nachos Supremos', 'Descripción': 'Totopos con queso, guacamole y pico de gallo', 'Precio (COP)': 18000, 'Imagen URL': '', 'Disponible': 'Sí' },
      { 'Categoría': 'Hamburguesas', 'Nombre': 'Birria Burger', 'Descripción': 'Hamburguesa de birria con queso y consomé', 'Precio (COP)': 28000, 'Imagen URL': '', 'Disponible': 'Sí' },
      { 'Categoría': 'Bebidas', 'Nombre': 'Coca-Cola 250ml', 'Descripción': 'Lata de 250ml', 'Precio (COP)': 5000, 'Imagen URL': '', 'Disponible': 'Sí' },
    ];
    if (format === 'csv') {
      downloadCsv('plantilla-menu-nexora.csv', toCsv(MENU_HEADERS, templateRows.map((row) => MENU_HEADERS.map((header: string) => row[header as keyof typeof row]))));
      return;
    }
    const ws = XLSX.utils.json_to_sheet(templateRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Menú');
    XLSX.writeFile(wb, 'plantilla-menu-nexora.xlsx');
  };

  // CRUD on import rows
  const startEditRow = (index: number): void => {
    setEditingIndex(index);
    setEditDraft({ ...rows[index] });
  };

  const cancelEditRow = (): void => {
    setEditingIndex(null);
    setEditDraft(null);
  };

  const saveEditRow = (): void => {
    if (editingIndex === null || !editDraft) return;
    const price = editDraft.price_cop;
    const updated: MenuRow = {
      ...editDraft,
      _errors: validateRow(editDraft.category.trim(), editDraft.name.trim(), price > 0 ? price : null),
    };
    setRows((current) => current.map((row, i) => (i === editingIndex ? updated : row)));
    setEditingIndex(null);
    setEditDraft(null);
  };

  const deleteRow = (index: number): void => {
    setRows((current) => current.filter((_, i) => i !== index));
  };

  const addRow = (): void => {
    setRows((current) => [...current, makeEmptyRow()]);
    setEditingIndex(rows.length);
    setEditDraft(makeEmptyRow());
  };

  // CRUD on existing products
  const saveProduct = async (): Promise<void> => {
    if (!editingProductId || !editProduct) return;
    setBusy(true);
    setProductError(null);

    const { data: catData } = await supabase
      .from('nexora_categories')
      .select('id')
      .ilike('name', editProduct.category_name)
      .limit(1)
      .maybeSingle();

    let categoryId = catData?.id;
    if (!categoryId) {
      const { data: newCat } = await supabase
        .from('nexora_categories')
        .insert({ name: editProduct.category_name.trim(), sort_order: 0 })
        .select('id')
        .single();
      categoryId = newCat?.id;
    }

    if (!categoryId) {
      setProductError('No pudimos encontrar o crear la categoría.');
      setBusy(false);
      return;
    }

    const { error } = await supabase
      .from('nexora_products')
      .update({
        name: editProduct.name.trim(),
        description: editProduct.description.trim(),
        price_cop: editProduct.price_cop,
        image_url: editProduct.image_url?.trim() || null,
        is_available: editProduct.is_available,
        category_id: categoryId,
      })
      .eq('id', editingProductId);

    setBusy(false);
    if (error) {
      setProductError(userFacingError(error));
      return;
    }

    setEditingProductId(null);
    setEditProduct(null);
    void loadProducts();
    onImported();
  };

  const deleteProduct = async (productId: string): Promise<void> => {
    setBusy(true);
    setProductError(null);
    const { error } = await supabase
      .from('nexora_products')
      .update({ is_active: false })
      .eq('id', productId);

    setBusy(false);
    setDeleteConfirmId(null);
    if (error) {
      setProductError(userFacingError(error));
      return;
    }
    void loadProducts();
    onImported();
  };

  return (
    <div className="team-dialog-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <section className="team-dialog import-dialog menu-crud-dialog" role="dialog" aria-modal="true" aria-labelledby="menu-import-title" onClick={(event: React.MouseEvent<HTMLElement>) => event.stopPropagation()}>
        <div className="team-dialog-heading">
          <div>
            <p className="eyebrow">Carta</p>
            <h2 id="menu-import-title">Gestión de menú</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose} disabled={busy}><X size={17} /></button>
        </div>

        <div className="inventory-tabs" role="tablist" aria-label="Secciones de menú">
          <button type="button" role="tab" aria-selected={tab === 'import'} className={tab === 'import' ? 'selected' : ''} onClick={() => switchTab('import')}>
            <Upload size={16} /><span>Importar</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'manage'} className={tab === 'manage' ? 'selected' : ''} onClick={() => switchTab('manage')}>
            <FileSpreadsheet size={16} /><span>Administrar productos</span>
          </button>
        </div>

        {tab === 'import' && (
          <>
            <div className="import-actions-row">
              <button className="outline-button" type="button" onClick={() => void handleExport('xlsx')} disabled={busy}>
                <Download size={16} /> Exportar menú (Excel)
              </button>
              <button className="outline-button" type="button" onClick={() => void handleExport('csv')} disabled={busy}>
                <Download size={16} /> Exportar menú (CSV)
              </button>
              <button className="outline-button" type="button" onClick={() => handleDownloadTemplate('xlsx')}>
                <FileSpreadsheet size={16} /> Plantilla Excel
              </button>
              <button className="outline-button" type="button" onClick={() => handleDownloadTemplate('csv')}>
                <FileSpreadsheet size={16} /> Plantilla CSV
              </button>
            </div>

            <div className="import-guide">
              <h3>Campos del archivo</h3>
              <table className="import-guide-table">
                <thead><tr><th>Columna</th><th>Obligatorio</th><th>Valores aceptados</th></tr></thead>
                <tbody>
                  <tr><td>Categoría</td><td className="required">Sí</td><td>Texto (ej. Entradas, Hamburguesas)</td></tr>
                  <tr><td>Nombre</td><td className="required">Sí</td><td>Texto del producto</td></tr>
                  <tr><td>Descripción</td><td>No</td><td>Texto breve del plato</td></tr>
                  <tr><td>Precio (COP)</td><td className="required">Sí</td><td>Número en pesos, por ejemplo 15000 o 15.000 (mayor a 0)</td></tr>
                  <tr><td>Imagen URL</td><td>No</td><td>Dirección web de la foto</td></tr>
                  <tr><td>Disponible</td><td>No</td><td>Sí / No (vacío = Sí)</td></tr>
                </tbody>
              </table>
              <p className="muted">Formatos aceptados: .xls, .xlsx, .csv, .txt. En CSV puedes separar las columnas con coma o punto y coma. Si un producto ya existe por nombre, se actualiza. Las categorías se crean automáticamente.</p>
              <a className="import-guide-link" href="/docs/guia-menu.html" target="_blank" rel="noopener">Ver guía completa en PDF</a>
            </div>

            <div className="import-file-area">
              <label className="import-file-label">
                <input type="file" accept=".xls,.xlsx,.csv,.txt" onChange={(event) => handleFile(event)} disabled={busy} />
                <FileSpreadsheet size={20} />
                <span>{fileName ?? 'Selecciona un archivo .xls, .xlsx, .csv o .txt'}</span>
              </label>
            </div>

            {parseError && <p className="auth-feedback error" role="alert">{parseError}</p>}
            {serverError && <p className="auth-feedback error" role="alert">{serverError}</p>}

            {result && (
              <div className="import-result">
                <div className="import-result-summary">
                  {result.categories_created > 0 && <span className="import-stat created"><CheckCircle2 size={16} /> {result.categories_created} categorías creadas</span>}
                  {result.categories_updated > 0 && <span className="import-stat updated"><CheckCircle2 size={16} /> {result.categories_updated} categorías actualizadas</span>}
                  {result.products_created > 0 && <span className="import-stat created"><CheckCircle2 size={16} /> {result.products_created} productos creados</span>}
                  {result.products_updated > 0 && <span className="import-stat updated"><CheckCircle2 size={16} /> {result.products_updated} productos actualizados</span>}
                  {result.products_skipped > 0 && <span className="import-stat skipped"><AlertTriangle size={16} /> {result.products_skipped} omitidos</span>}
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
                <div className="import-preview-header">
                  <div>
                    <h3>Vista previa ({rows.length} filas)</h3>
                    <p className="muted">{validRows.length} listas para importar{errorRows.length > 0 ? `, ${errorRows.length} con errores` : ''}.</p>
                  </div>
                  <button className="outline-button" type="button" onClick={addRow} disabled={busy}><Plus size={15} /> Agregar fila</button>
                </div>
                <div className="import-preview-scroll">
                  <table className="import-preview-table">
                    <thead>
                      <tr><th>Categoría</th><th>Nombre</th><th>Precio</th><th>Disponible</th><th>Estado</th><th></th></tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={index} className={row._errors.length > 0 ? 'row-error' : 'row-ok'}>
                          {editingIndex === index && editDraft ? (
                            <>
                              <td><input className="crud-input" value={editDraft.category} onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })} /></td>
                              <td><input className="crud-input" value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} /></td>
                              <td><input className="crud-input" type="number" value={editDraft.price_cop} onChange={(e) => setEditDraft({ ...editDraft, price_cop: parseInt(e.target.value) || 0 })} /></td>
                              <td><select className="crud-input" value={editDraft.is_available ? 'si' : 'no'} onChange={(e) => setEditDraft({ ...editDraft, is_available: e.target.value === 'si' })}><option value="si">Sí</option><option value="no">No</option></select></td>
                              <td colSpan={2}>
                                <div className="crud-row-actions">
                                  <button className="icon-button small" type="button" onClick={saveEditRow} aria-label="Guardar"><Save size={14} /></button>
                                  <button className="icon-button small" type="button" onClick={cancelEditRow} aria-label="Cancelar"><X size={14} /></button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td>{row.category || '—'}</td>
                              <td>{row.name || '—'}</td>
                              <td>{row.price_cop > 0 ? `$${row.price_cop.toLocaleString('es-CO')}` : '—'}</td>
                              <td>{row.is_available ? 'Sí' : 'No'}</td>
                              <td>{row._errors.length > 0 ? <span className="row-status-error">{row._errors.join(', ')}</span> : <span className="row-status-ok">OK</span>}</td>
                              <td>
                                <div className="crud-row-actions">
                                  <button className="icon-button small" type="button" onClick={() => startEditRow(index)} aria-label="Editar"><Pencil size={13} /></button>
                                  <button className="icon-button small" type="button" onClick={() => deleteRow(index)} aria-label="Eliminar"><Trash2 size={13} /></button>
                                </div>
                              </td>
                            </>
                          )}
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
                  <Upload size={16} />{busy ? 'Importando...' : `Importar ${validRows.length} productos`}
                </button>
              )}
            </div>
          </>
        )}

        {tab === 'manage' && (
          <>
            {productError && <p className="auth-feedback error" role="alert">{productError}</p>}
            {!productsLoaded && <p className="account-empty">Cargando productos...</p>}
            {productsLoaded && products.length === 0 && <p className="account-empty">No hay productos activos en el menú.</p>}

            {productsLoaded && products.length > 0 && (
              <div className="import-preview">
                <div className="import-preview-header">
                  <h3>Productos del menú ({products.length})</h3>
                  <button className="outline-button" type="button" onClick={() => void loadProducts()} disabled={busy}>Actualizar</button>
                </div>
                <div className="import-preview-scroll">
                  <table className="import-preview-table">
                    <thead>
                      <tr><th>Categoría</th><th>Nombre</th><th>Precio</th><th>Disponible</th><th></th></tr>
                    </thead>
                    <tbody>
                      {products.map((product) => (
                        <tr key={product.id}>
                          {editingProductId === product.id && editProduct ? (
                            <>
                              <td><input className="crud-input" value={editProduct.category_name} onChange={(e) => setEditProduct({ ...editProduct, category_name: e.target.value })} /></td>
                              <td><input className="crud-input" value={editProduct.name} onChange={(e) => setEditProduct({ ...editProduct, name: e.target.value })} /></td>
                              <td><input className="crud-input" type="number" value={editProduct.price_cop} onChange={(e) => setEditProduct({ ...editProduct, price_cop: parseInt(e.target.value) || 0 })} /></td>
                              <td><select className="crud-input" value={editProduct.is_available ? 'si' : 'no'} onChange={(e) => setEditProduct({ ...editProduct, is_available: e.target.value === 'si' })}><option value="si">Sí</option><option value="no">No</option></select></td>
                              <td>
                                <div className="crud-row-actions">
                                  <button className="icon-button small" type="button" onClick={() => void saveProduct()} disabled={busy} aria-label="Guardar"><Save size={14} /></button>
                                  <button className="icon-button small" type="button" onClick={() => { setEditingProductId(null); setEditProduct(null); }} disabled={busy} aria-label="Cancelar"><X size={14} /></button>
                                </div>
                              </td>
                            </>
                          ) : deleteConfirmId === product.id ? (
                            <>
                              <td colSpan={3} className="delete-confirm-cell">¿Eliminar "{product.name}" del menú?</td>
                              <td />
                              <td>
                                <div className="crud-row-actions">
                                  <button className="icon-button small" type="button" onClick={() => void deleteProduct(product.id)} disabled={busy} aria-label="Confirmar"><CheckCircle2 size={14} /></button>
                                  <button className="icon-button small" type="button" onClick={() => setDeleteConfirmId(null)} disabled={busy} aria-label="Cancelar"><X size={14} /></button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td>{product.category_name || '—'}</td>
                              <td>{product.name}</td>
                              <td>${product.price_cop.toLocaleString('es-CO')}</td>
                              <td>{product.is_available ? 'Sí' : 'No'}</td>
                              <td>
                                <div className="crud-row-actions">
                                  <button className="icon-button small" type="button" onClick={() => { setEditingProductId(product.id); setEditProduct({ ...product }); }} disabled={busy} aria-label="Editar"><Pencil size={13} /></button>
                                  <button className="icon-button small" type="button" onClick={() => setDeleteConfirmId(product.id)} disabled={busy} aria-label="Eliminar"><Trash2 size={13} /></button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="team-dialog-actions">
              <button className="outline-button" type="button" onClick={onClose} disabled={busy}>Cerrar</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
