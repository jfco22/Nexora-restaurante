import { supabase } from '@/lib/supabase';

export type PaymentMethod = 'cash' | 'card' | 'bre_b';
export type PaymentState = 'pending' | 'paid';

export type AccountLine = {
  id: string;
  product_name: string;
  quantity: number;
  unit_price_cop: number;
  line_total_cop: number;
};

export type AccountPayment = {
  id: string;
  method: PaymentMethod;
  status: PaymentState;
  amount_cop: number;
  reference: string | null;
};

export type TableAccount = {
  id: string;
  order_number: number;
  status: string;
  total_cop: number;
  lines: AccountLine[];
  payments: AccountPayment[];
};

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  bre_b: 'Bre-B',
};

const openAccountStatuses = ['draft', 'submitted', 'accepted', 'ready', 'completed'];

type AccountRow = {
  id: string;
  order_number: number;
  status: string;
  total_cop: number;
  nexora_order_items: AccountLine[] | null;
  nexora_payments: AccountPayment[] | null;
};

export async function fetchOpenTableAccount(tableId: string): Promise<{ account: TableAccount | null; error: string | null }> {
  const { data, error } = await supabase
    .from('nexora_orders')
    .select('id, order_number, status, total_cop, nexora_order_items(id, product_name, quantity, unit_price_cop, line_total_cop), nexora_payments(id, method, status, amount_cop, reference)')
    .eq('table_id', tableId)
    .in('status', openAccountStatuses)
    .neq('payment_status', 'paid')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { account: null, error: 'No pudimos cargar la cuenta de esta mesa.' };
  if (!data) return { account: null, error: null };

  const row = data as AccountRow;
  return {
    account: {
      id: row.id,
      order_number: row.order_number,
      status: row.status,
      total_cop: row.total_cop,
      lines: row.nexora_order_items ?? [],
      payments: row.nexora_payments ?? [],
    },
    error: null,
  };
}

/**
 * Traduce un error de Supabase a un mensaje que dice qué pasó y cómo corregirlo.
 * P0001 son mensajes que escribimos nosotros en las funciones SQL y se muestran tal cual.
 */
export const userFacingError = (error: { code?: string; message?: string }): string => {
  const code = error.code ?? '';
  const message = error.message ?? '';
  if (code === 'P0001') return message;
  console.error('Error de Supabase', { code, message });
  if (code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'Tu rol no tiene permiso para hacer esto. Pídele a un propietario o gerente que lo haga o que te cambie el rol en Equipo.';
  }
  if (code === '23505') return 'Ya existe un registro con ese nombre. Búscalo en la lista (puede estar en "Desactivados") y reactívalo, o usa otro nombre.';
  if (code === '23503') return 'Este registro está en uso (recetas, pedidos o historial) y no se puede borrar o cambiar así. Desactívalo en vez de borrarlo.';
  if (code === '23514' || code === '22003') return 'Un número está fuera del rango permitido (negativo, demasiado grande o con demasiados decimales). Revisa las cantidades y los precios.';
  if (code === '22P02') return 'Uno de los valores no tiene el formato correcto (por ejemplo, texto en un campo de números). Revisa lo que escribiste.';
  if (code === '42883' || code === 'PGRST202' || code === '42P01' || code === 'PGRST205' || code === '42703' || /does not exist|could not find the function/i.test(message)) {
    return 'Falta aplicar una actualización de la base de datos (migración SQL) en Supabase. No es un error tuyo: avisa a quien administra el sistema y dile el código ' + (code || 'sin código') + '.';
  }
  if (code === 'PGRST301' || /jwt/i.test(message)) return 'Tu sesión venció. Cierra sesión y vuelve a entrar.';
  if (/failed to fetch|networkerror|load failed/i.test(message)) return 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
  return `No pudimos completar la acción${code ? ` (código ${code})` : ''}. Revisa los datos e inténtalo de nuevo; si sigue igual, avisa al administrador con ese código.`;
};
