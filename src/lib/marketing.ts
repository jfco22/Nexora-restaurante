import { supabase } from '@/lib/supabase';
import { userFacingError } from '@/lib/tableAccount';

export type Candidate = {
  promotion_id: string; item_name: string; valid_to: string; score: number; product_id: string; product_name: string;
  price_cop: number; discount_cop: number | null; promo_price_cop: number | null; has_open_post: boolean; note: string | null;
};

export type PostStatus = 'draft' | 'approved' | 'rejected' | 'published';
export type MarketingPost = {
  id: string; kind: 'post' | 'story'; product_id: string; product_name: string; headline: string; caption: string;
  price_original_cop: number; price_promo_cop: number; valid_to: string; status: PostStatus; rejection_reason: string | null;
  created_at: string; approved_at: string | null; published_at: string | null;
  publish_results: Record<string, { ok: boolean; id?: string; permalink?: string; error?: string }> | null; publish_error: string | null;
};

export const statusLabels: Record<PostStatus, string> = { draft: 'Por aprobar', approved: 'Aprobada', rejected: 'Rechazada', published: 'Publicada' };

const MISSING = 'Falta activar el módulo de marketing en la base de datos (SQL 16).';
const isMissing = (code: string | undefined): boolean => code === 'PGRST202' || code === '42883' || code === '42P01';
const n = (v: unknown): number => Number(v ?? 0);

export async function fetchCandidates(): Promise<{ data: Candidate[]; error: string | null }> {
  const { data, error } = await supabase.rpc('nexora_marketing_candidates');
  if (error) return { data: [], error: isMissing(error.code) ? MISSING : userFacingError(error) };
  return {
    data: ((data ?? []) as Candidate[]).map((r: Candidate) => ({
      ...r, score: n(r.score), price_cop: n(r.price_cop),
      discount_cop: r.discount_cop === null ? null : n(r.discount_cop), promo_price_cop: r.promo_price_cop === null ? null : n(r.promo_price_cop),
    })),
    error: null,
  };
}

export async function fetchPosts(): Promise<{ data: MarketingPost[]; error: string | null }> {
  const { data, error } = await supabase.rpc('list_nexora_marketing_posts');
  if (error) return { data: [], error: isMissing(error.code) ? MISSING : userFacingError(error) };
  return { data: ((data ?? []) as MarketingPost[]).map((r: MarketingPost) => ({ ...r, price_original_cop: n(r.price_original_cop), price_promo_cop: n(r.price_promo_cop) })), error: null };
}

async function run(name: string, params: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.rpc(name, params);
  return error ? userFacingError(error) : null;
}

export const createPost = (kind: 'post' | 'story', c: Candidate, headline: string, caption: string): Promise<string | null> =>
  run('create_nexora_marketing_post', {
    kind_input: kind, promotion_id_input: c.promotion_id, product_id_input: c.product_id, headline_input: headline,
    caption_input: caption, price_promo_input: c.promo_price_cop, valid_to_input: c.valid_to,
  });
export const updatePost = (id: string, headline: string, caption: string): Promise<string | null> =>
  run('update_nexora_marketing_post', { post_id_input: id, headline_input: headline, caption_input: caption });
export const reviewPost = (id: string, approve: boolean, reason?: string): Promise<string | null> =>
  run('review_nexora_marketing_post', { post_id_input: id, approve_input: approve, reason_input: reason ?? null });
export const publishPost = (id: string): Promise<string | null> => run('publish_nexora_marketing_post', { post_id_input: id });
export const deletePost = (id: string): Promise<string | null> => run('delete_nexora_marketing_post', { post_id_input: id });
