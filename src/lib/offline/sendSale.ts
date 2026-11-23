import { supabase } from '@/lib/supabase';
import type { OfflineSale } from '@/lib/offline/salesStore';
import { classifySyncError, syncPendingSales, type SendOutcome, type SyncSummary } from '@/lib/offline/syncSales';

/** Envía una venta a la base. La función de Supabase es idempotente: reintentar no la duplica. */
export async function sendOfflineSale(sale: OfflineSale): Promise<SendOutcome> {
  try {
    // Renueva la sesión si venció mientras no había internet.
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      return { kind: 'retry', message: 'No hay sesión iniciada. Entra con internet; las ventas siguen guardadas en este equipo.' };
    }
    const { error, status } = await supabase.rpc('sync_nexora_offline_sale', {
      client_id_input: sale.clientId,
      items: sale.items,
      method_input: sale.method,
      occurred_at_input: sale.occurredAt,
      guest_name_input: null,
    });
    if (!error) return { kind: 'ok' };
    return classifySyncError({ code: error.code, message: error.message, status });
  } catch (error) {
    return classifySyncError({ message: error instanceof Error ? error.message : 'Failed to fetch', status: 0 });
  }
}

export function syncOfflineSalesNow(onProgress?: () => void): Promise<SyncSummary> {
  return syncPendingSales(sendOfflineSale, onProgress);
}
