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

export const userFacingError = (error: { code: string; message: string }): string =>
  error.code === 'P0001' ? error.message : 'No pudimos completar la acción. Revisa la cuenta e inténtalo de nuevo.';
