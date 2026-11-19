import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { csvToObjects, decodeCsvBytes, downloadCsv, toCsv } from '@/lib/importParsing';
import { fetchInventory, type InventoryItem } from '@/lib/inventory';
import { fetchPreparations, type Preparation } from '@/lib/preparations';
import { PREPARATION_HEADERS, buildPreparationPlan, parsePreparationRecords, type ParsedPreparations, type PlannedPreparation } from '@/lib/preparationImport';
import { applyPreparationPlan, type PreparationImportOutcome } from '@/lib/preparationImportApi';
import { storageLabels } from '@/lib/inventory';
import '@/components/inventory/inventory-import.css';
import '@/components/inventory/menu-import.css';

type Props = { onClose: () => void; onImported: () => Promise<void> };

const EXAMPLE_ROWS: (string | number)[][] = [
  ['Carne de hamburguesa', 3000, 'g', 'Carne de res molida', 3000, 'g', 'nevera'],
  ['Carne de hamburguesa', '', '', 'Sal', 30, 'g', 'estanteria'],
  ['Carne de hamburguesa', '', '', 'Pimienta', 6, 'g', 'estanteria'],
];

export function PreparationImportDialog({ onClose, onImported }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [existing, setExisting] = useState<Preparation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedPreparations | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PreparationImportOutcome | null>(null);

  const loadReference = useCallback(async (): Promise<void> => {
    const [inventory, preps] = await Promise.all([fetchInventory(), fetchPreparations()]);
    setItems(inventory.items);
    setExisting(preps.preparations);
    setLoadError(inventory.error ?? preps.error);
  }, []);

  useEffect(() => {
    void loadReference();
  }, [loadReference]);

  const plan = useMemo(
    () => (parsed ? buildPreparationPlan(parsed, items.map((item: InventoryItem) => ({ id: item.id, name: item.name, unit: item.unit }))) : null),
    [parsed, items],
  );

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setOutcome(null);
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
        const result = parsePreparationRecords(records);
        if (result.missingColumns.length > 0) {
          setParseError(`Faltan columnas: ${result.missingColumns.join(', ')}. El archivo necesita Preparación, Rinde, Insumo y Cantidad.`);
          setParsed(null);
          return;
        }
        if (result.rows.length === 0) {
          setParseError('El archivo no tiene filas con datos.');
          setParsed(null);
          return;
        }
        setParsed(result);
      } catch {
        setParseError('No pudimos leer el archivo. Usa un CSV o un Excel (.xlsx).');
        setParsed(null);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleImport = async (): Promise<void> => {
    if (!plan) return;
    setBusy(true);
    const result = await applyPreparationPlan(plan);
    setBusy(false);
    setOutcome(result);
    if (result.ok || result.preparationsSaved > 0 || result.itemsCreated > 0) {
      await onImported();
      void loadReference();
    }
  };

  const downloadTemplate = (): void => downloadCsv('plantilla-preparaciones.csv', toCsv(PREPARATION_HEADERS, EXAMPLE_ROWS));

  const exportCurrent = (): void => {
    const itemById = new Map(items.map((item: InventoryItem) => [item.id, item]));
    const data: (string | number)[][] = [];
    for (const prep of existing) {
      const output = itemById.get(prep.output_item_id);
      if (!output) continue;
      prep.lines.forEach((line, index: number) => {
        const item = itemById.get(line.item_id);
        if (!item) return;
        data.push([output.name, index === 0 ? prep.yield_quantity : '', index === 0 ? output.unit : '', item.name, line.quantity, item.unit, item.storage_location]);
      });
    }
    downloadCsv('preparaciones-actuales.csv', toCsv(PREPARATION_HEADERS, data));
  };

  const validRows = plan ? plan.lines.filter((line) => plan.preparations.some((prep: PlannedPreparation) => prep.lines.includes(line))).length : 0;

  return (
    <div className="team-dialog-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <section className="team-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="prep-import-title" onClick={(event: React.MouseEvent<HTMLElement>) => event.stopPropagation()}>
        <div className="team-dialog-heading">
          <div>
            <p className="eyebrow">Inventario</p>
            <h2 id="prep-import-title">Importar preparaciones</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose} disabled={busy}><X size={17} /></button>
        </div>

        <div className="import-actions-row">
          <button className="outline-button" type="button" onClick={downloadTemplate}><Download size={16} /> Plantilla CSV</button>
          <button className="outline-button" type="button" onClick={exportCurrent} disabled={existing.length === 0}><Download size={16} /> Exportar preparaciones actuales</button>
        </div>

        <div className="import-guide">
          <h3>Una fila por cada insumo de la tanda</h3>
          <table className="import-guide-table">
            <thead><tr><th>Columna</th><th>Obligatorio</th><th>Qué poner</th></tr></thead>
            <tbody>
              <tr><td>Preparación</td><td className="required">Sí</td><td>Lo que sale de la olla, por ejemplo "Birria cocida". Se crea como insumo con ese nombre</td></tr>
              <tr><td>Rinde</td><td className="required">Sí</td><td>Cuánto sale en total de UNA tanda (en la primera fila de cada preparación)</td></tr>
              <tr><td>Unidad rinde</td><td>Si es nueva</td><td>g, kg, ml, l o unidad. Necesaria para crear el insumo resultado</td></tr>
              <tr><td>Insumo</td><td className="required">Sí</td><td>El insumo crudo que gasta la tanda</td></tr>
              <tr><td>Cantidad</td><td className="required">Sí</td><td>Cuánto se gasta en la tanda completa</td></tr>
              <tr><td>Unidad</td><td>No</td><td>g, kg, ml, l o unidad (se convierte si hace falta; con ella se crea el insumo si no existe)</td></tr>
              <tr><td>Ubicación</td><td>No</td><td>nevera, estanteria o bodega, solo para insumos nuevos</td></tr>
            </tbody>
          </table>
          <p className="muted">Después, en la receta de cada plato, usa la preparación como insumo (por ejemplo, Birriamen 140 gr gasta 140 g de Birria cocida). Una preparación se importa completa o no se importa.</p>
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
              {outcome.preparationsSaved > 0 && <span className="import-stat created"><CheckCircle2 size={16} /> {outcome.preparationsSaved} preparaciones guardadas</span>}
              {outcome.itemsCreated > 0 && <span className="import-stat created"><CheckCircle2 size={16} /> {outcome.itemsCreated} insumos nuevos (stock 0)</span>}
              {!outcome.ok && <span className="import-stat skipped"><AlertTriangle size={16} /> {outcome.message}</span>}
            </div>
          </div>
        )}

        {plan && !outcome && (
          <div className="import-preview">
            <h3>Vista previa</h3>
            <p className="muted">
              {plan.preparations.length} preparaciones listas ({validRows} filas){plan.rejected.length > 0 ? `, ${plan.rejected.length} con problemas (se omiten)` : ''}.
              {plan.newItems.length + plan.preparations.filter((prep: PlannedPreparation) => prep.newOutput).length > 0
                ? ` Se crearán ${plan.newItems.length + plan.preparations.filter((prep: PlannedPreparation) => prep.newOutput).length} insumos nuevos con stock 0.` : ''}
            </p>
            {plan.rejected.map((entry) => (
              <p key={entry.name} className="auth-feedback error" role="alert"><strong>{entry.name}:</strong> {entry.reasons.join(' ')}</p>
            ))}
            <div className="import-preview-scroll">
              <table className="import-preview-table">
                <thead><tr><th>Preparación</th><th>Rinde por tanda</th><th>Insumos</th></tr></thead>
                <tbody>
                  {plan.preparations.map((prep: PlannedPreparation) => (
                    <tr key={prep.name} className="row-ok">
                      <td>{prep.name}{prep.newOutput ? ' (nuevo)' : ''}</td>
                      <td>{prep.yieldQuantity.toLocaleString('es-CO')} {prep.newOutput?.unit ?? items.find((item: InventoryItem) => item.id === prep.outputItemId)?.unit ?? ''}</td>
                      <td>
                        {prep.lines.map((line) => `${line.row.item}${line.newItemName ? ' (nuevo)' : ''} ${line.quantity ?? ''}`).join(' · ')}
                        {prep.lines.some((line) => line.newItemName) ? ` — ubicaciones nuevas: ${Array.from(new Set(prep.lines.filter((line) => line.newItemName).map((line) => storageLabels[line.row.location ?? 'bodega']))).join(', ')}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="team-dialog-actions">
          <button className="outline-button" type="button" onClick={onClose} disabled={busy}>Cerrar</button>
          {plan && plan.preparations.length > 0 && !outcome && (
            <button className="primary-button" type="button" onClick={() => void handleImport()} disabled={busy}>
              <Upload size={16} />{busy ? 'Importando...' : `Importar ${plan.preparations.length} preparaciones`}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
