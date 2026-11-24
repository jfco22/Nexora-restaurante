import { supabase } from '@/lib/supabase';
import { userFacingError } from '@/lib/tableAccount';
import { shiftDate } from '@/lib/workTime';

export type SaleItem = { name: string; quantity: number; unit_price_cop: number; line_total_cop: number };
export type SaleRecord = {
  payment_id: string;
  paid_at: string;
  order_id: string;
  order_number: number;
  order_type: 'salon' | 'takeaway' | 'delivery';
  table_name: string | null;
  guest_name: string | null;
  method: 'cash' | 'card' | 'bre_b';
  amount_cop: number;
  reference: string | null;
  cashier_name: string;
  was_offline: boolean;
  items: SaleItem[];
};

export type PurchaseRecord = {
  id: string; created_at: string; item_name: string; unit: string; quantity: number;
  unit_cost_cop: number | null; total_cop: number; note: string | null; created_by_name: string;
};

export const expenseCategories = {
  servicios: 'Servicios (luz, agua, gas, internet)',
  arriendo: 'Arriendo',
  transporte: 'Transporte y domicilios',
  mantenimiento: 'Mantenimiento y reparaciones',
  impuestos: 'Impuestos y permisos',
  publicidad: 'Publicidad',
  insumos_varios: 'Insumos varios (aseo, desechables)',
  otros: 'Otros',
} as const;
export type ExpenseCategory = keyof typeof expenseCategories;

export const expenseMethodLabels = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', otro: 'Otro' } as const;
export type ExpenseMethod = keyof typeof expenseMethodLabels;

export type ExpenseRecord = {
  id: string; spent_on: string; category: ExpenseCategory; description: string; supplier: string | null; amount_cop: number;
  method: ExpenseMethod; created_at: string; created_by_name: string; voided_at: string | null; void_reason: string | null;
};

export type ReportSummary = {
  sales_total: number; payments_count: number; orders_count: number;
  by_method: { method: string; total: number; count: number }[];
  by_day: { day: string; total: number; count: number }[];
  top_products: { name: string; quantity: number; total: number }[];
  purchases_total: number; expenses_total: number; work_paid_total: number; result: number;
  expenses_by_category: { category: ExpenseCategory; total: number }[];
};

export const orderTypeLabels: Record<string, string> = { salon: 'Salón', takeaway: 'Para llevar', delivery: 'Domicilio' };

type Result<T> = { data: T; error: string | null };

async function call<T>(name: string, params: Record<string, unknown>, empty: T): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(name, params);
  if (error) return { data: empty, error: userFacingError(error) };
  return { data: (data ?? empty) as T, error: null };
}

export const fetchSales = (from: string, to: string): Promise<Result<SaleRecord[]>> => call('list_nexora_sales', { range_from: from, range_to: to }, []);
export const fetchPurchases = (from: string, to: string): Promise<Result<PurchaseRecord[]>> => call('list_nexora_purchases', { range_from: from, range_to: to }, []);
export const fetchExpenses = (from: string, to: string): Promise<Result<ExpenseRecord[]>> => call('list_nexora_expenses', { range_from: from, range_to: to }, []);
export const fetchSummary = (from: string, to: string): Promise<Result<ReportSummary | null>> => call<ReportSummary | null>('nexora_report_summary', { range_from: from, range_to: to }, null);

export async function createExpense(input: { spentOn: string; category: ExpenseCategory; description: string; amount: number; method: ExpenseMethod; supplier: string }): Promise<string | null> {
  const { error } = await supabase.rpc('create_nexora_expense', {
    spent_on_input: input.spentOn, category_input: input.category, description_input: input.description,
    amount_input: input.amount, method_input: input.method, supplier_input: input.supplier || null,
  });
  return error ? userFacingError(error) : null;
}

export async function voidExpense(id: string, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('void_nexora_expense', { expense_id_input: id, reason_input: reason });
  return error ? userFacingError(error) : null;
}

/** Último día del mes de una fecha AAAA-MM-DD. */
export function endOfMonth(ymd: string): string {
  const [year, month] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** Suma el valor por clave de día (hora de Colombia) para agrupar listas. */
export const dayOf = (iso: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(iso));

export const clockTime = (iso: string): string => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
export const longDay = (ymd: string): string => new Date(`${ymd}T12:00:00-05:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' });
export const monthLabel = (ym: string): string => new Date(`${ym}-15T12:00:00-05:00`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'America/Bogota' });
export { shiftDate };
