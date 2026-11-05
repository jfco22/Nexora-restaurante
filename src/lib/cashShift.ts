import { supabase } from '@/lib/supabase';
import { userFacingError } from '@/lib/tableAccount';

export type CashShiftSummary = {
  shift_id: string;
  opened_at: string;
  opening_cash_cop: number;
  cash_sales_cop: number;
  card_sales_cop: number;
  bre_b_paid_cop: number;
  bre_b_pending_cop: number;
  expected_cash_cop: number;
};

export type CloseShiftResult = { ok: true; expected: number; difference: number } | { ok: false; error: string };

const genericError = 'No pudimos completar la acción. Inténtalo de nuevo.';

export const formatOpenedAt = (iso: string): string =>
  new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

export async function fetchOpenCashShift(): Promise<{ shift: CashShiftSummary | null; error: string | null }> {
  const { data, error } = await supabase.rpc('get_nexora_open_shift_summary');
  if (error) return { shift: null, error: 'No pudimos cargar el estado de la caja.' };

  const row = (data as CashShiftSummary[] | null)?.[0];
  if (!row || typeof row.shift_id !== 'string') return { shift: null, error: null };
  return { shift: row, error: null };
}

export async function openCashShift(openingCash: number): Promise<string | null> {
  const { error } = await supabase.rpc('open_nexora_cash_shift', { opening_cash_input: openingCash });
  return error ? userFacingError(error) : null;
}

export async function closeCashShift(countedCash: number): Promise<CloseShiftResult> {
  const { data, error } = await supabase.rpc('close_nexora_cash_shift', { counted_cash_input: countedCash });
  if (error) return { ok: false, error: userFacingError(error) };

  const row = (data as { expected_cash_cop: number; difference_cop: number }[] | null)?.[0];
  if (!row) return { ok: false, error: genericError };
  return { ok: true, expected: row.expected_cash_cop, difference: row.difference_cop };
}
