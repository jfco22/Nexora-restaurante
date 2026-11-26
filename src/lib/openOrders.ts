import { supabase } from '@/lib/supabase';
import { userFacingError } from '@/lib/tableAccount';

export type OpenOrder = {
  id: string; order_number: number; status: string; payment_status: string; total_cop: number; order_type: string;
  source: string; guest_name: string | null; created_at: string;
  nexora_tables: { name: string } | null;
  nexora_order_items: { product_name: string; quantity: number }[] | null;
};

export const statusLabels: Record<string, string> = {
  pending_payment: 'Esperando que caja apruebe el pago',
  submitted: 'En cocina (recibido)',
  accepted: 'En preparación',
  ready: 'Listo para entregar',
  completed: 'Entregado, falta cobrar',
};

/** Un pedido lleva "mucho" tiempo si pasó más de 12 horas: casi seguro quedó olvidado o es de prueba. */
export const STALE_HOURS = 12;
export const ageHours = (iso: string): number => (Date.now() - new Date(iso).getTime()) / 3_600_000;
export const ageLabel = (iso: string): string => {
  const h = ageHours(iso);
  if (h < 1) return `hace ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `hace ${Math.round(h)} h`;
  return `hace ${Math.round(h / 24)} días`;
};

/**
 * Los mismos pedidos que cuentan las dos tarjetas del inicio: los que siguen en curso
 * (no borrador, cancelado ni entregado) y los que están sin pagar.
 */
export async function fetchOpenOrders(): Promise<{ data: OpenOrder[]; error: string | null }> {
  const { data, error } = await supabase
    .from('nexora_orders')
    .select('id, order_number, status, payment_status, total_cop, order_type, source, guest_name, created_at, nexora_tables(name), nexora_order_items(product_name, quantity)')
    .not('status', 'in', '(draft,cancelled)')
    .or('status.neq.completed,payment_status.in.(unpaid,pending)')
    .order('created_at');
  if (error) return { data: [], error: userFacingError(error) };
  return { data: ((data ?? []) as unknown as OpenOrder[]).filter((o: OpenOrder) => o.status !== 'completed' || o.payment_status === 'unpaid' || o.payment_status === 'pending'), error: null };
}

export async function cancelStuckOrder(id: string): Promise<string | null> {
  const { error } = await supabase.rpc('cancel_nexora_stuck_order', { order_id_input: id });
  if (!error) return null;
  return error.code === 'PGRST202' ? 'Falta correr el SQL 18 en Supabase.' : userFacingError(error);
}
