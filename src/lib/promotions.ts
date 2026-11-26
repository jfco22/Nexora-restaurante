import { supabase } from '@/lib/supabase';
import { userFacingError } from '@/lib/tableAccount';

export type PromotionSuggestion = {
  product_id: string; product_name: string; price_cop: number; cost_cop: number | null; portions_possible: number;
  expiry_score: number; inventory_score: number; score: number; suggested_discount_pct: number; promo_price_cop: number;
  cost_known: boolean; expiry_item: string | null; inventory_item: string | null; reason: string;
};

export type Promotion = {
  id: string; product_id: string; product_name: string; price_cop: number; discount_pct: number; promo_price_cop: number;
  starts_on: string; ends_on: string; status: string; reason: string | null; is_current: boolean;
};

const MISSING = 'Falta activar las promociones en la base de datos (SQL 15).';
const isMissing = (code: string | undefined): boolean => code === 'PGRST202' || code === '42883';
const n = (v: unknown): number => Number(v ?? 0);

export async function fetchPromotionSuggestions(): Promise<{ data: PromotionSuggestion[]; error: string | null }> {
  const { data, error } = await supabase.rpc('nexora_promotion_suggestions', { max_results: 8, expiry_weight: 0.4 });
  if (error) return { data: [], error: isMissing(error.code) ? MISSING : userFacingError(error) };
  return {
    data: ((data ?? []) as PromotionSuggestion[]).map((r: PromotionSuggestion) => ({
      ...r, price_cop: n(r.price_cop), cost_cop: r.cost_cop === null ? null : n(r.cost_cop), portions_possible: n(r.portions_possible),
      expiry_score: n(r.expiry_score), inventory_score: n(r.inventory_score), score: n(r.score),
      suggested_discount_pct: n(r.suggested_discount_pct), promo_price_cop: n(r.promo_price_cop),
    })),
    error: null,
  };
}

export async function fetchPromotions(): Promise<{ data: Promotion[]; error: string | null }> {
  const { data, error } = await supabase.rpc('list_nexora_promotions');
  if (error) return { data: [], error: isMissing(error.code) ? MISSING : userFacingError(error) };
  return {
    data: ((data ?? []) as Promotion[]).map((r: Promotion) => ({ ...r, price_cop: n(r.price_cop), discount_pct: n(r.discount_pct), promo_price_cop: n(r.promo_price_cop) })),
    error: null,
  };
}

export async function acceptPromotion(s: PromotionSuggestion, days: number): Promise<string | null> {
  const { error } = await supabase.rpc('accept_nexora_promotion', {
    product_id_input: s.product_id, discount_input: s.suggested_discount_pct, days_input: days, reason_input: s.reason, score_input: s.score,
  });
  return error ? userFacingError(error) : null;
}

export async function dismissPromotion(productId: string): Promise<string | null> {
  const { error } = await supabase.rpc('dismiss_nexora_promotion', { product_id_input: productId });
  return error ? userFacingError(error) : null;
}

export async function endPromotion(id: string): Promise<string | null> {
  const { error } = await supabase.rpc('end_nexora_promotion', { promotion_id_input: id });
  return error ? userFacingError(error) : null;
}
