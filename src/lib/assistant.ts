import { supabase } from '@/lib/supabase';
import { userFacingError } from '@/lib/tableAccount';
import type { FreshnessLevel } from '@/lib/freshness';

export type Insight = {
  item_id: string; name: string; unit: string; current_stock: number; oldest_age_days: number | null;
  limit_days: number | null; limit_source: string | null; daily_use: number; at_risk_qty: number;
  level: FreshnessLevel; reason: string | null; used_in: string[]; waste_events: number;
};

export type PurchaseForecast = {
  item_id: string; name: string; unit: string; current_stock: number; need_qty: number; days_of_cover: number | null;
  suggest_buy: number; horizon_used: number; history_days: number; confidence: 'baja' | 'media' | 'alta';
};

export type SalesForecast = { day: string; expected_cop: number; low_cop: number; high_cop: number; days_used: number };

const MISSING = 'Falta activar el asistente en la base de datos (SQL 14).';
const isMissing = (code: string | undefined): boolean => code === 'PGRST202' || code === '42883';

type Result<T> = { data: T; error: string | null; missing: boolean };

async function call<T>(name: string, params: Record<string, unknown> | undefined, empty: T): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(name, params);
  if (error) return { data: empty, error: isMissing(error.code) ? MISSING : userFacingError(error), missing: isMissing(error.code) };
  return { data: (data ?? empty) as T, error: null, missing: false };
}

const num = (value: unknown): number => Number(value ?? 0);

export async function fetchInsights(): Promise<Result<Insight[]>> {
  const result = await call<Insight[]>('nexora_assistant_insights', undefined, []);
  return { ...result, data: result.data.map((row: Insight) => ({ ...row, current_stock: num(row.current_stock), daily_use: num(row.daily_use), at_risk_qty: num(row.at_risk_qty) })) };
}

export async function fetchPurchaseForecast(horizon: number): Promise<Result<PurchaseForecast[]>> {
  const result = await call<PurchaseForecast[]>('nexora_purchase_forecast', { horizon_days: horizon }, []);
  return {
    ...result,
    data: result.data.map((row: PurchaseForecast) => ({ ...row, current_stock: num(row.current_stock), need_qty: num(row.need_qty), suggest_buy: num(row.suggest_buy), days_of_cover: row.days_of_cover === null ? null : num(row.days_of_cover) })),
  };
}

export async function fetchSalesForecast(): Promise<Result<SalesForecast[]>> {
  const result = await call<SalesForecast[]>('nexora_sales_forecast', { days_ahead: 7 }, []);
  return { ...result, data: result.data.map((row: SalesForecast) => ({ ...row, expected_cop: num(row.expected_cop), low_cop: num(row.low_cop), high_cop: num(row.high_cop) })) };
}

export async function sendFeedback(itemId: string, kind: 'handled' | 'false_alarm'): Promise<string | null> {
  const { error } = await supabase.rpc('record_nexora_assistant_feedback', { item_id_input: itemId, kind_input: kind });
  return error ? userFacingError(error) : null;
}
