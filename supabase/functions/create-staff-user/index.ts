import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ROLES = ["owner", "manager", "cashier", "waiter", "kitchen", "inventory", "marketing", "auditor"];
const MANAGING_ROLES = ["owner", "manager"];

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type StaffInput = { email: string; password: string; display_name: string; role: string };

const parseInput = (raw: unknown): StaffInput | string => {
  if (!raw || typeof raw !== "object") return "Datos no válidos";
  const body = raw as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
  const role = typeof body.role === "string" ? body.role : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Escribe un correo electrónico válido";
  if (password.length < 6 || password.length > 72) return "La contraseña debe tener entre 6 y 72 caracteres";
  if (displayName.length < 1 || displayName.length > 80) return "El nombre debe tener entre 1 y 80 caracteres";
  if (!ROLES.includes(role)) return "Rol no válido";

  return { email, password, display_name: displayName, role };
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Método no permitido" }, 405);
    }

    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!token) {
      return json({ error: "Debes iniciar sesión" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) {
      return json({ error: "Debes iniciar sesión" }, 401);
    }
    const callerId = userData.user.id;

    const { data: caller, error: callerError } = await admin
      .from("nexora_profiles")
      .select("role")
      .eq("id", callerId)
      .maybeSingle();
    if (callerError || !caller || !MANAGING_ROLES.includes(caller.role)) {
      return json({ error: "No tienes permiso para crear usuarios" }, 403);
    }

    const parsed = parseInput(await req.json().catch(() => null));
    if (typeof parsed === "string") {
      return json({ error: parsed }, 400);
    }
    if (parsed.role === "owner" && caller.role !== "owner") {
      return json({ error: "Solo un propietario puede crear otro propietario" }, 403);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: parsed.email,
      password: parsed.password,
      email_confirm: true,
      user_metadata: { display_name: parsed.display_name },
    });
    if (createError || !created.user) {
      const authError = createError as (Error & { code?: string; status?: number }) | null;
      const code = authError?.code ?? "";
      const lower = (authError?.message ?? "").toLowerCase();
      // Keep the real reason in the function logs: the user only sees a friendly message.
      console.error("create-staff-user: createUser failed", { code, status: authError?.status, message: authError?.message });

      if (code === "email_exists" || code === "user_already_exists" || lower.includes("already")) {
        return json({ error: "Ya existe un usuario con ese correo", code: "email_exists" }, 409);
      }
      if (code === "weak_password" || lower.includes("password")) {
        return json({ error: "La contraseña no cumple las reglas de seguridad. Usa una más larga, con letras y números", code: "weak_password" }, 400);
      }
      if (code === "email_provider_disabled" || lower.includes("provider")) {
        return json({ error: "El acceso con correo está desactivado en Supabase (Authentication, Providers, Email)", code: "email_provider_disabled" }, 500);
      }
      if (lower.includes("database error")) {
        return json({ error: "Supabase no pudo guardar el perfil del nuevo usuario. Revisa el disparador on_nexora_auth_user_created", code: "database_error" }, 500);
      }
      return json({ error: "No pudimos crear el usuario", code: code || "create_failed" }, 500);
    }

    const newUserId = created.user.id;
    const profileValues = { display_name: parsed.display_name, role: parsed.role, updated_at: new Date().toISOString() };
    const { data: updatedRows, error: profileError } = await admin
      .from("nexora_profiles")
      .update(profileValues)
      .eq("id", newUserId)
      .select("id");

    let profileFailure: unknown = profileError;
    if (!profileFailure && (!updatedRows || updatedRows.length === 0)) {
      // The profile row was not there (the signup trigger did not create it): create it so the role is not lost.
      const { error: insertError } = await admin.from("nexora_profiles").insert({ id: newUserId, ...profileValues });
      profileFailure = insertError;
    }
    if (profileFailure) {
      console.error("create-staff-user: profile setup failed", profileFailure);
      await admin.auth.admin.deleteUser(newUserId);
      return json({ error: "No pudimos configurar el perfil del usuario", code: "profile_failed" }, 500);
    }

    return json({ user_id: newUserId, email: parsed.email, role: parsed.role }, 201);
  } catch (cause) {
    console.error("create-staff-user failed", cause);
    return json({ error: "Error interno al crear el usuario", code: "internal_error" }, 500);
  }
});
