import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import '@/components/equipo/team.css';
import '@/components/finanzas/finance.css';
import { FormProblem } from '@/components/FormProblem';
import { NumberInput } from '@/components/NumberInput';
import { formatCurrency } from '@/lib/format';
import { wholeAmountProblem } from '@/lib/formProblems';
import {
  createExpense, expenseCategories, expenseMethodLabels, fetchExpenses, fetchPurchases, longDay, voidExpense,
  type ExpenseCategory, type ExpenseMethod, type ExpenseRecord, type PurchaseRecord,
} from '@/lib/finance';
import { formatQuantity, type InventoryUnit } from '@/lib/inventory';
import { shiftDate, startOfMonth, startOfWeek, todayBogota } from '@/lib/workTime';

type RangeKey = 'hoy' | 'semana' | 'mes' | 'rango';
type Tab = 'gastos' | 'compras';

const shortDateTime = (iso: string): string => new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });

/** Compras de insumos (vienen del inventario) y gastos del restaurante. Solo propietario y gerente. */
export function PurchasesExpensesView() {
  const today = todayBogota();
  const [tab, setTab] = useState<Tab>('gastos');
  const [range, setRange] = useState<RangeKey>('mes');
  const [customFrom, setCustomFrom] = useState(shiftDate(today, -6));
  const [customTo, setCustomTo] = useState(today);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<ExpenseRecord | null>(null);

  const { from, to } = useMemo((): { from: string; to: string } => {
    if (range === 'hoy') return { from: today, to: today };
    if (range === 'semana') return { from: startOfWeek(today), to: today };
    if (range === 'mes') return { from: startOfMonth(today), to: today };
    return { from: customFrom, to: customTo };
  }, [range, today, customFrom, customTo]);
  const rangeProblem = !from || !to ? 'Elige la fecha inicial y la final.' : to < from ? 'La fecha final no puede ser anterior a la inicial.' : null;

  const load = useCallback(async (): Promise<void> => {
    if (rangeProblem) { setPurchases([]); setExpenses([]); setLoading(false); return; }
    setLoading(true);
    const [p, e] = await Promise.all([fetchPurchases(from, to), fetchExpenses(from, to)]);
    setPurchases(p.data);
    setExpenses(e.data);
    setError(p.error ?? e.error);
    setLoading(false);
  }, [from, to, rangeProblem]);

  useEffect(() => { void load(); }, [load]);

  const purchasesTotal = purchases.reduce((sum: number, row: PurchaseRecord) => sum + Number(row.total_cop), 0);
  const activeExpenses = expenses.filter((row: ExpenseRecord) => !row.voided_at);
  const expensesTotal = activeExpenses.reduce((sum: number, row: ExpenseRecord) => sum + row.amount_cop, 0);
  const byCategory = useMemo(() => {
    const totals = new Map<ExpenseCategory, number>();
    for (const row of activeExpenses) totals.set(row.category, (totals.get(row.category) ?? 0) + row.amount_cop);
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [activeExpenses]);

  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administración</p>
          <h1>Compras y gastos</h1>
          <p className="muted">Lo que compras para cocinar (insumos) y lo que pagas para operar (servicios, arriendo, transporte...).</p>
        </div>
      </div>

      <div className="fin-controls">
        {(['hoy', 'semana', 'mes', 'rango'] as RangeKey[]).map((key: RangeKey) => (
          <button key={key} className={`chip ${range === key ? 'active' : ''}`} type="button" onClick={() => setRange(key)}>
            {key === 'hoy' ? 'Hoy' : key === 'semana' ? 'Esta semana' : key === 'mes' ? 'Este mes' : 'Entre fechas'}
          </button>
        ))}
        {range === 'rango' && (
          <>
            <input type="date" value={customFrom} max={today} aria-label="Desde" onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCustomFrom(event.target.value)} />
            <input type="date" value={customTo} max={today} aria-label="Hasta" onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCustomTo(event.target.value)} />
          </>
        )}
      </div>
      <FormProblem message={rangeProblem} />
      {notice && <p className="auth-feedback success" role="status">{notice}</p>}
      {error && <p className="auth-feedback error" role="alert">{error}</p>}

      <div className="fin-cards">
        <div className="fin-card"><span>Compras de insumos</span><strong>{formatCurrency(purchasesTotal)}</strong><small>{purchases.length} compras</small></div>
        <div className="fin-card"><span>Gastos</span><strong>{formatCurrency(expensesTotal)}</strong><small>{activeExpenses.length} gastos</small></div>
        <div className="fin-card"><span>Total salido</span><strong>{formatCurrency(purchasesTotal + expensesTotal)}</strong><small>compras + gastos</small></div>
      </div>

      <div className="fin-controls">
        <button className={`chip ${tab === 'gastos' ? 'active' : ''}`} type="button" onClick={() => setTab('gastos')}>Gastos</button>
        <button className={`chip ${tab === 'compras' ? 'active' : ''}`} type="button" onClick={() => setTab('compras')}>Compras de insumos</button>
      </div>

      {loading && <p className="muted">Cargando...</p>}

      {tab === 'gastos' && (
        <>
          <ExpenseForm onSaved={async () => { setNotice('Gasto registrado.'); await load(); }} />
          {byCategory.length > 0 && (
            <section className="panel" style={{ marginTop: 16 }}>
              <h2>Gastos por categoría</h2>
              <table className="fin-table">
                <tbody>
                  {byCategory.map(([category, total]) => (
                    <tr key={category}>
                      <td>{expenseCategories[category]}</td>
                      <td style={{ width: '35%' }}><div className="fin-bar"><i style={{ width: `${expensesTotal > 0 ? Math.round((total / expensesTotal) * 100) : 0}%` }} /></div></td>
                      <td className="num">{formatCurrency(total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <section className="panel" style={{ marginTop: 16 }}>
            <h2>Gastos del período</h2>
            {!loading && expenses.length === 0 && <p className="muted">No hay gastos en estas fechas.</p>}
            {expenses.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="fin-table">
                  <thead><tr><th>Fecha</th><th>Categoría</th><th>Detalle</th><th>Pago</th><th className="num">Valor</th><th></th></tr></thead>
                  <tbody>
                    {expenses.map((row: ExpenseRecord) => (
                      <tr key={row.id} className={row.voided_at ? 'voided' : ''}>
                        <td>{longDay(row.spent_on)}</td>
                        <td>{expenseCategories[row.category]}</td>
                        <td>{row.description}{row.supplier ? ` · ${row.supplier}` : ''}{row.voided_at ? ` (anulado: ${row.void_reason ?? ''})` : ''}<br /><small className="muted">Registró {row.created_by_name}</small></td>
                        <td>{expenseMethodLabels[row.method]}</td>
                        <td className="num">{formatCurrency(row.amount_cop)}</td>
                        <td>{!row.voided_at && <button className="outline-button" type="button" onClick={() => setVoiding(row)}>Anular</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {tab === 'compras' && (
        <section className="panel">
          <h2>Compras de insumos</h2>
          <p className="fin-note">Estas compras salen del Inventario: cuando registras una compra de un insumo (con su costo) queda aquí. Para registrar una nueva, ve a Inventario, toca el insumo y usa "Registrar movimiento".</p>
          {!loading && purchases.length === 0 && <p className="muted">No hay compras de insumos en estas fechas.</p>}
          {purchases.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="fin-table">
                <thead><tr><th>Fecha</th><th>Insumo</th><th className="num">Cantidad</th><th className="num">Costo unitario</th><th className="num">Total</th><th>Registró</th></tr></thead>
                <tbody>
                  {purchases.map((row: PurchaseRecord) => (
                    <tr key={row.id}>
                      <td>{shortDateTime(row.created_at)}</td>
                      <td>{row.item_name}{row.note ? <><br /><small className="muted">{row.note}</small></> : null}</td>
                      <td className="num">{formatQuantity(Number(row.quantity), row.unit as InventoryUnit)}</td>
                      <td className="num">{row.unit_cost_cop === null ? '—' : formatCurrency(Number(row.unit_cost_cop))}</td>
                      <td className="num">{formatCurrency(Number(row.total_cop))}</td>
                      <td>{row.created_by_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {voiding && <VoidDialog expense={voiding} onClose={() => setVoiding(null)} onDone={async () => { setVoiding(null); setNotice('Gasto anulado.'); await load(); }} />}
    </div>
  );
}

function ExpenseForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const today = todayBogota();
  const [spentOn, setSpentOn] = useState(today);
  const [category, setCategory] = useState<ExpenseCategory>('servicios');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ExpenseMethod>('efectivo');
  const [supplier, setSupplier] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountProblem = wholeAmountProblem(amount, 'el valor del gasto', { min: 1, max: 1000000000, example: '85000' });
  const problem = !spentOn ? 'Elige la fecha del gasto.' : spentOn > today ? 'La fecha del gasto no puede ser futura.'
    : description.trim() === '' ? 'Escribe en qué se gastó (ej. Factura de la luz de noviembre).' : amountProblem;

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    const failure = await createExpense({ spentOn, category, description: description.trim(), amount: Number(amount), method, supplier: supplier.trim() });
    setBusy(false);
    if (failure) { setError(failure); return; }
    setDescription(''); setAmount(''); setSupplier('');
    await onSaved();
  };

  return (
    <section className="panel">
      <h2>Registrar un gasto</h2>
      <form onSubmit={(event: React.FormEvent<HTMLFormElement>) => void submit(event)}>
        <div className="fin-form">
          <label>Fecha<input type="date" value={spentOn} max={today} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSpentOn(event.target.value)} /></label>
          <label>Categoría
            <select value={category} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setCategory(event.target.value as ExpenseCategory)}>
              {(Object.keys(expenseCategories) as ExpenseCategory[]).map((key: ExpenseCategory) => <option key={key} value={key}>{expenseCategories[key]}</option>)}
            </select>
          </label>
          <label>En qué se gastó<input value={description} maxLength={200} placeholder="Ej. Factura de la luz" onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDescription(event.target.value)} /></label>
          <label>Valor (COP)<NumberInput value={amount} onChange={setAmount} hideEmptyError /></label>
          <label>Cómo se pagó
            <select value={method} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setMethod(event.target.value as ExpenseMethod)}>
              {(Object.keys(expenseMethodLabels) as ExpenseMethod[]).map((key: ExpenseMethod) => <option key={key} value={key}>{expenseMethodLabels[key]}</option>)}
            </select>
          </label>
          <label>Proveedor (opcional)<input value={supplier} maxLength={120} placeholder="Ej. EPM" onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSupplier(event.target.value)} /></label>
        </div>
        <div style={{ marginTop: 12 }}><FormProblem message={problem} /></div>
        {error && <p className="auth-feedback error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={Boolean(problem) || busy} style={{ marginTop: 12 }}><Plus size={16} /> {busy ? 'Guardando...' : 'Registrar gasto'}</button>
      </form>
    </section>
  );
}

function VoidDialog({ expense, onClose, onDone }: { expense: ExpenseRecord; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = reason.trim() === '' ? 'Escribe por qué se anula (ej. Se registró dos veces).' : null;

  const submit = async (): Promise<void> => {
    if (problem || busy) return;
    setBusy(true);
    const failure = await voidExpense(expense.id, reason.trim());
    setBusy(false);
    if (failure) { setError(failure); return; }
    await onDone();
  };

  return (
    <div className="team-dialog-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <section className="team-dialog" role="dialog" aria-modal="true" aria-label="Anular gasto" onClick={(event: React.MouseEvent<HTMLElement>) => event.stopPropagation()}>
        <h2>Anular gasto</h2>
        <p className="muted">{expense.description} · {formatCurrency(expense.amount_cop)}. El gasto no se borra: queda marcado como anulado con el motivo.</p>
        <div className="fin-form"><label>Motivo<input value={reason} maxLength={200} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setReason(event.target.value)} /></label></div>
        <FormProblem message={problem} />
        {error && <p className="auth-feedback error" role="alert">{error}</p>}
        <div className="team-dialog-actions">
          <button className="outline-button" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="primary-button" type="button" onClick={() => void submit()} disabled={Boolean(problem) || busy}>{busy ? 'Anulando...' : 'Anular gasto'}</button>
        </div>
      </section>
    </div>
  );
}
