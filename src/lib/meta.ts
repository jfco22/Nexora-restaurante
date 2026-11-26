import { supabase } from '@/lib/supabase';

const URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-publish`;

export type MetaStatus = {
  connected: boolean; healthy?: boolean; problem?: string; page_name?: string | null; ig_username?: string | null;
  has_instagram?: boolean; connected_at?: string;
};
export type MetaPage = { id: string; name: string; has_instagram: boolean };
export type PublishResult = { ok: boolean; id?: string; permalink?: string; error?: string };
export type MetaReply<T> = { data: T | null; error: string | null };

async function call<T>(payload: Record<string, unknown>): Promise<MetaReply<T>> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) return { data: null, error: 'Tu sesión venció. Cierra sesión y vuelve a entrar.' };
    const response = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!response.ok) {
      if (body?.error) return { data: null, error: body.error };
      if (response.status === 404) return { data: null, error: 'Falta publicar la función meta-publish en Supabase (Edge Functions).' };
      return { data: null, error: `El servidor respondió con un error (código ${response.status}).` };
    }
    return { data: body, error: null };
  } catch {
    return { data: null, error: 'No pudimos comunicarnos con la función meta-publish. Revisa la conexión y que esté publicada en Supabase.' };
  }
}

export const fetchMetaStatus = (): Promise<MetaReply<MetaStatus>> => call<MetaStatus>({ action: 'status' });
export const disconnectMeta = (): Promise<MetaReply<MetaStatus>> => call<MetaStatus>({ action: 'disconnect' });
export const connectMeta = (appId: string, appSecret: string, userToken: string, pageId?: string):
  Promise<MetaReply<MetaStatus & { needs_choice?: boolean; pages?: MetaPage[] }>> =>
  call({ action: 'connect', app_id: appId, app_secret: appSecret, user_token: userToken, page_id: pageId });
export const publishToMeta = (postId: string, targets: ('instagram' | 'facebook')[], imageBase64: string):
  Promise<MetaReply<{ ok: boolean; results: Record<string, PublishResult>; error: string | null }>> =>
  call({ action: 'publish', post_id: postId, targets, image_base64: imageBase64 });
