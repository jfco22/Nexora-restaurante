import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase no está configurado para esta aplicación.');
}

/** Se calcula ANTES de crear el cliente, porque este borra el enlace de la dirección al leerlo. */
const openedUrl = typeof window === 'undefined' ? '' : `${window.location.hash}${window.location.search}`;
export const OPENED_FROM_RECOVERY_LINK = /type=recovery/.test(openedUrl);
export const RECOVERY_LINK_PROBLEM = /error_code=otp_expired|error=access_denied/.test(openedUrl);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
