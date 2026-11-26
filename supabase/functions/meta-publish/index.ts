import { createClient } from "npm:@supabase/supabase-js@2";

/*
  Conexión con Meta (Facebook e Instagram) para el módulo de marketing.
  Acciones (POST con { action, ... }):
  - status:     dice si hay conexión y si el permiso sigue funcionando.
  - connect:    recibe App ID, clave secreta de la app y un token de usuario; lo cambia por un permiso de larga duración,
                busca la página de Facebook y el Instagram vinculado y guarda SOLO el permiso de la página.
  - disconnect: borra la conexión.
  - publish:    publica una pieza APROBADA (post o story) en Instagram y/o Facebook.
  El permiso de la página nunca sale de esta función hacia el navegador.
*/

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GRAPH = `https://graph.facebook.com/${Deno.env.get("META_GRAPH_VERSION") || "v25.0"}`;
const BUCKET = "marketing-pieces";
const MANAGERS = ["owner", "manager"];
const MARKETERS = ["owner", "manager", "marketing"];

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

class MetaError extends Error {
  constructor(message: string, public code?: number, public sub?: number) { super(message); }
}

const explain = (code: number | undefined, message: string): string => {
  if (code === 190) return "El permiso de Meta venció o fue revocado. Ve a Marketing > Conexión con Meta y vuelve a conectar.";
  if (code === 10 || (code !== undefined && code >= 200 && code < 300)) return `Falta un permiso en Meta (${message}). Vuelve a conectar y acepta todos los permisos.`;
  if (code === 4 || code === 17 || code === 32 || code === 613) return "Meta pidió esperar por exceso de solicitudes. Intenta de nuevo en unos minutos.";
  return `Meta respondió: ${message}`;
};

async function graph(method: "GET" | "POST", path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const query = new URLSearchParams(params);
  const response = method === "GET"
    ? await fetch(`${GRAPH}${path}?${query}`)
    : await fetch(`${GRAPH}${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: query });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const err = body.error as { message?: string; code?: number; error_subcode?: number } | undefined;
  if (!response.ok || err) {
    const message = err?.message ?? `código ${response.status}`;
    throw new MetaError(explain(err?.code, message), err?.code, err?.error_subcode);
  }
  return body;
}

const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

type Connection = { page_id: string; page_name: string | null; ig_user_id: string | null; ig_username: string | null; page_token: string; connected_at: string };
type Result = { ok: boolean; id?: string; permalink?: string; error?: string };

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!token) return json({ error: "Debes iniciar sesión" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Debes iniciar sesión" }, 401);
    const { data: caller } = await admin.from("nexora_profiles").select("role").eq("id", userData.user.id).maybeSingle();
    const role: string = caller?.role ?? "";
    if (!MARKETERS.includes(role)) return json({ error: "No tienes permiso para usar el marketing" }, 403);

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const action = typeof body?.action === "string" ? body.action : "";

    const loadConnection = async (): Promise<Connection | null> => {
      const { data } = await admin.from("nexora_meta_connection").select("*").eq("id", 1).maybeSingle();
      return (data as Connection | null) ?? null;
    };

    if (action === "status") {
      const conn = await loadConnection();
      if (!conn) return json({ connected: false });
      try {
        await graph("GET", `/${conn.page_id}`, { fields: "name", access_token: conn.page_token });
        return json({ connected: true, healthy: true, page_name: conn.page_name, ig_username: conn.ig_username, has_instagram: Boolean(conn.ig_user_id), connected_at: conn.connected_at });
      } catch (e) {
        return json({ connected: true, healthy: false, problem: (e as Error).message, page_name: conn.page_name, ig_username: conn.ig_username, has_instagram: Boolean(conn.ig_user_id), connected_at: conn.connected_at });
      }
    }

    if (action === "disconnect") {
      if (!MANAGERS.includes(role)) return json({ error: "Solo el propietario o el gerente puede desconectar Meta" }, 403);
      await admin.from("nexora_meta_connection").delete().eq("id", 1);
      return json({ connected: false });
    }

    if (action === "connect") {
      if (!MANAGERS.includes(role)) return json({ error: "Solo el propietario o el gerente puede conectar Meta" }, 403);
      const appId = String(body?.app_id ?? "").trim();
      const appSecret = String(body?.app_secret ?? "").trim();
      const userToken = String(body?.user_token ?? "").trim();
      const wantedPage = String(body?.page_id ?? "").trim();
      if (!appId || !appSecret || !userToken) return json({ error: "Faltan el ID de la app, la clave secreta o el token." }, 400);
      try {
        const longLived = await graph("GET", "/oauth/access_token", { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: userToken });
        const accounts = await graph("GET", "/me/accounts", {
          fields: "id,name,access_token,instagram_business_account{id,username}", limit: "50", access_token: String(longLived.access_token),
        });
        const pages = (accounts.data ?? []) as { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[];
        if (pages.length === 0) {
          return json({ error: "Meta no devolvió ninguna página. Revisa que al generar el token marcaste todas las páginas y los permisos pages_show_list y business_management." }, 400);
        }
        let page = pages.find((p) => p.id === wantedPage);
        if (!page && pages.length === 1) page = pages[0];
        if (!page) {
          return json({ needs_choice: true, pages: pages.map((p) => ({ id: p.id, name: p.name, has_instagram: Boolean(p.instagram_business_account) })) });
        }
        await admin.from("nexora_meta_connection").upsert({
          id: 1, page_id: page.id, page_name: page.name, page_token: page.access_token,
          ig_user_id: page.instagram_business_account?.id ?? null, ig_username: page.instagram_business_account?.username ?? null,
          connected_at: new Date().toISOString(), connected_by: userData.user.id,
        });
        return json({ connected: true, page_name: page.name, ig_username: page.instagram_business_account?.username ?? null, has_instagram: Boolean(page.instagram_business_account) });
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    }

    if (action === "publish") {
      const conn = await loadConnection();
      if (!conn) return json({ error: "Meta no está conectado. Conéctalo en Marketing > Conexión con Meta." }, 400);
      const postId = String(body?.post_id ?? "");
      const targets = ((body?.targets ?? []) as unknown[]).filter((t): t is "instagram" | "facebook" => t === "instagram" || t === "facebook");
      const imageB64 = String(body?.image_base64 ?? "");
      if (!postId || targets.length === 0 || !imageB64) return json({ error: "Faltan datos para publicar." }, 400);
      if (targets.includes("instagram") && !conn.ig_user_id) return json({ error: "La página conectada no tiene Instagram vinculado." }, 400);
      if (imageB64.length > 9_000_000) return json({ error: "La imagen es demasiado grande." }, 400);
      const bytes = base64ToBytes(imageB64);
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return json({ error: "La imagen debe ser JPEG." }, 400);

      const { data: post } = await admin.from("nexora_marketing_posts").select("*").eq("id", postId).maybeSingle();
      if (!post) return json({ error: "La publicación no existe." }, 404);
      if (post.status !== "approved") return json({ error: "Solo se puede publicar una pieza aprobada." }, 400);
      if (post.kind === "post" && String(post.caption).length > 2200) return json({ error: "El texto supera los 2.200 caracteres que permite Instagram." }, 400);

      const staleBefore = new Date(Date.now() - 2 * 60_000).toISOString();
      const { data: locked } = await admin.from("nexora_marketing_posts")
        .update({ publishing_since: new Date().toISOString() })
        .eq("id", postId).eq("status", "approved").or(`publishing_since.is.null,publishing_since.lt.${staleBefore}`).select("id");
      if (!locked || locked.length === 0) return json({ error: "Esta pieza ya se está publicando. Espera un momento." }, 409);

      try {
        const path = `${postId}-${Date.now()}.jpg`;
        const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: true });
        if (uploadError) throw new MetaError(`No se pudo guardar la imagen (${uploadError.message}). ¿Corriste el SQL 17?`);
        const imageUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

        const results: Record<string, Result> = { ...((post.publish_results ?? {}) as Record<string, Result>) };
        const caption = String(post.caption);

        for (const target of targets) {
          if (results[target]?.ok) continue;
          try {
            if (target === "instagram") {
              const params: Record<string, string> = { image_url: imageUrl, access_token: conn.page_token };
              if (post.kind === "story") params.media_type = "STORIES"; else params.caption = caption;
              const container = await graph("POST", `/${conn.ig_user_id}/media`, params);
              for (let i = 0; i < 10; i++) {
                const st = await graph("GET", `/${container.id}`, { fields: "status_code", access_token: conn.page_token });
                if (st.status_code === "FINISHED") break;
                if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new MetaError("Instagram no pudo procesar la imagen.");
                await new Promise((r) => setTimeout(r, 1000));
              }
              const published = await graph("POST", `/${conn.ig_user_id}/media_publish`, { creation_id: String(container.id), access_token: conn.page_token });
              let permalink: string | undefined;
              try { permalink = String((await graph("GET", `/${published.id}`, { fields: "permalink", access_token: conn.page_token })).permalink); } catch { /* el enlace es opcional */ }
              results.instagram = { ok: true, id: String(published.id), permalink };
            } else if (post.kind === "story") {
              const photo = await graph("POST", `/${conn.page_id}/photos`, { url: imageUrl, published: "false", access_token: conn.page_token });
              const story = await graph("POST", `/${conn.page_id}/photo_stories`, { photo_id: String(photo.id), access_token: conn.page_token });
              results.facebook = { ok: true, id: String(story.post_id ?? photo.id) };
            } else {
              const photo = await graph("POST", `/${conn.page_id}/photos`, { url: imageUrl, caption, published: "true", access_token: conn.page_token });
              results.facebook = { ok: true, id: String(photo.post_id ?? photo.id) };
            }
          } catch (e) {
            results[target] = { ok: false, error: (e as Error).message };
          }
        }

        const allOk = targets.every((t) => results[t]?.ok);
        const errors = targets.filter((t) => !results[t]?.ok).map((t) => `${t === "instagram" ? "Instagram" : "Facebook"}: ${results[t]?.error}`);
        await admin.from("nexora_marketing_posts").update({
          publish_results: results, publish_error: errors.length ? errors.join(" | ") : null, image_url: imageUrl,
          publishing_since: null, ...(allOk ? { status: "published", published_at: new Date().toISOString(), channels: targets } : {}),
        }).eq("id", postId);
        return json({ ok: allOk, results, error: errors.length ? errors.join(" | ") : null });
      } catch (e) {
        await admin.from("nexora_marketing_posts").update({ publishing_since: null, publish_error: (e as Error).message }).eq("id", postId);
        return json({ ok: false, error: (e as Error).message }, 400);
      }
    }

    return json({ error: "Acción no válida" }, 400);
  } catch (e) {
    return json({ error: `Error inesperado: ${(e as Error).message}` }, 500);
  }
});
