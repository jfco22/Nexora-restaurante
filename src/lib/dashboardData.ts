import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchInventory, type InventoryItem } from '@/lib/inventory';

export type DashboardData = {
  salesToday: number;
  paymentsToday: number;
  pendingToCollect: number;
  pendingCount: number;
  salesMonth: number;
  byMethod: { method: string; total: number }[];
  days: { label: string; total: number }[];
  openOrders: number;
  occupiedTables: number;
  totalTables: number;
  lowStock: number;
};

export const methodLabels: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', bre_b: 'Bre-B' };

const startOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const dayKey = (date: Date): string => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/** Cifras reales del día: ventas cobradas, pendiente por cobrar, mesas, cocina e insumos en alerta. Sin pagos, todo es 0. */
export async function fetchDashboardData(): Promise<DashboardData | null> {
  const today = startOfDay(new Date());
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - 6);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const since = weekStart < monthStart ? weekStart : monthStart;

  const [payments, unpaid, open, tables, inventory] = await Promise.all([
    supabase.from('nexora_payments').select('amount_cop, method, created_at').eq('status', 'paid').gte('created_at', since.toISOString()),
    supabase.from('nexora_orders').select('total_cop').in('payment_status', ['unpaid', 'pending']).not('status', 'in', '(draft,cancelled)'),
    supabase.from('nexora_orders').select('id', { count: 'exact', head: true }).not('status', 'in', '(draft,cancelled,completed)'),
    supabase.from('nexora_tables').select('status').eq('is_active', true),
    fetchInventory(),
  ]);
  if (payments.error || unpaid.error || open.error || tables.error) return null;

  const rows = (payments.data ?? []) as { amount_cop: number; method: string; created_at: string }[];
  const todayKey = dayKey(today);
  const methodTotals = new Map<string, number>();
  const dayTotals = new Map<string, number>();
  let salesToday = 0;
  let paymentsToday = 0;
  let salesMonth = 0;
  for (const row of rows) {
    const date = new Date(row.created_at);
    const key = dayKey(date);
    dayTotals.set(key, (dayTotals.get(key) ?? 0) + row.amount_cop);
    if (date >= monthStart) salesMonth += row.amount_cop;
    if (key === todayKey) {
      salesToday += row.amount_cop;
      paymentsToday += 1;
      methodTotals.set(row.method, (methodTotals.get(row.method) ?? 0) + row.amount_cop);
    }
  }

  const days = Array.from({ length: 7 }, (_: unknown, index: number) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return { label: date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }), total: dayTotals.get(dayKey(date)) ?? 0 };
  });

  const tableRows = (tables.data ?? []) as { status: string }[];
  return {
    salesToday,
    paymentsToday,
    pendingCount: (unpaid.data ?? []).length,
    pendingToCollect: ((unpaid.data ?? []) as { total_cop: number }[]).reduce((sum: number, order) => sum + order.total_cop, 0),
    salesMonth,
    byMethod: [...methodTotals.entries()].map(([method, total]: [string, number]) => ({ method, total })).sort((a, b) => b.total - a.total),
    days,
    openOrders: open.count ?? 0,
    occupiedTables: tableRows.filter((table) => table.status === 'occupied').length,
    totalTables: tableRows.length,
    lowStock: inventory.items.filter((item: InventoryItem) => item.current_stock <= item.min_stock).length,
  };
}

export function useDashboardData(): { data: DashboardData | null; loaded: boolean; reload: () => void } {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback((): void => {
    void fetchDashboardData().then((result: DashboardData | null) => { setData(result); setLoaded(true); });
  }, []);
  useEffect(reload, [reload]);
  return { data, loaded, reload };
}
