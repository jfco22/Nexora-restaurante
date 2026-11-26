import { supabase } from '@/lib/supabase';
import { userFacingError } from '@/lib/tableAccount';

export type PromotionSuggestion = {
  item_id: string; name: string; unit: string; current_stock: number; stock_value_cop: number; cost_known: boolean;
  expiry_score: number; inventory_score: number; score: number; at_risk_qty: number; reason: string; used_in: string[];
};

export type Promotion = {
  id: string; item_id: string; name: string; unit: string; current_stock: number; starts_on: string; ends_on: string;
  status: string; reason: string | null; is_current: boolean; used_in: string[];
};

const MISSING = 'Falta activar las promociones en la base de datos (SQL 15).';
const isMissing = (code: string | undefined): boolean => code === 'PGRST202' || code === '42883';
const n = (v: unknown): number => Number(v ?? 0);

export async function fetchPromotionSuggestions(): Promise<{ data: PromotionSuggestion[]; error: string | null }> {
  const { data, error } = await supabase.rpc('nexora_promotion_suggestions', { max_results: 8, expiry_weight: 0.4 });
  if (error) return { data: [], error: isMissing(error.code) ? MISSING : userFacingError(error) };
  return {
    data: ((data ?? []) as PromotionSuggestion[]).map((r: PromotionSuggestion) => ({
      ...r, current_stock: n(r.current_stock), stock_value_cop: n(r.stock_value_cop), expiry_score: n(r.expiry_score),
      inventory_score: n(r.inventory_score), score: n(r.score), at_risk_qty: n(r.at_risk_qty), used_in: r.used_in ?? [],
    })),
    error: null,
  };
}

export async function fetchPromotions(): Promise<{ data: Promotion[]; error: string | null }> {
  const { data, error } = await supabase.rpc('list_nexora_promotions');
  if (error) return { data: [], error: isMissing(error.code) ? MISSING : userFacingError(error) };
  return { data: ((data ?? []) as Promotion[]).map((r: Promotion) => ({ ...r, current_stock: n(r.current_stock), used_in: r.used_in ?? [] })), error: null };
}

export async function acceptPromotion(s: PromotionSuggestion, days: number): Promise<string | null> {
  const { error } = await supabase.rpc('accept_nexora_promotion', { item_id_input: s.item_id, days_input: days, reason_input: s.reason, score_input: s.score });
  return error ? userFacingError(error) : null;
}

export async function dismissPromotion(itemId: string): Promise<string | null> {
  const { error } = await supabase.rpc('dismiss_nexora_promotion', { item_id_input: itemId });
  return error ? userFacingError(error) : null;
}

export async function endPromotion(id: string): Promise<string | null> {
  const { error } = await supabase.rpc('end_nexora_promotion', { promotion_id_input: id });
  return error ? userFacingError(error) : null;
}
