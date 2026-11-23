import { listSales, removeSale, updateSale, type OfflineSale } from '@/lib/offline/salesStore';

export type SendOutcome =
  | { kind: 'ok' }
  /** No es culpa de la venta: sin internet, sesión vencida o falta aplicar una migración. Se reintenta más tarde. */
  | { kind: 'retry'; message: string }
  /** La base de datos rechazó la venta. Hay que revisarla a mano. */
  | { kind: 'rejected'; message: string };

export type SyncSummary = { synced: number; failed: number; waiting: number; stopped: boolean };

type ErrorInfo = { code?: string; message?: string; status?: number };

/** Decide si un error se puede reintentar o si la venta fue rechazada. Función pura, con pruebas. */
export function classifySyncError(error: ErrorInfo): SendOutcome {
  const code = error.code ?? '';
  const message = error.message ?? '';
  const status = error.status;

  if (/failed to fetch|networkerror|load failed|network request failed|fetch failed|timeout|timed out/i.test(message) || status === 0 || (status !== undefined && status >= 500)) {
    return { kind: 'retry', message: 'Sin conexión con el servidor. Se reintenta solo cuando vuelva el internet.' };
  }
  if (code === 'PGRST301' || status === 401 || /jwt/i.test(message)) {
    return { kind: 'retry', message: 'Tu sesión venció. Cierra sesión y vuelve a entrar con internet; las ventas siguen guardadas en este equipo.' };
  }
  if (code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(message)) {
    return { kind: 'retry', message: 'Falta aplicar la actualización de ventas sin internet en Supabase (migración 20261123000000). Las ventas siguen guardadas aquí.' };
  }
  if (code === '42501') {
    return { kind: 'retry', message: 'Tu usuario no tiene permiso para sincronizar. Entra con una cuenta del equipo; las ventas siguen guardadas aquí.' };
  }
  return { kind: 'rejected', message: message || 'La base de datos rechazó esta venta.' };
}

let running = false;

/**
 * Sube las ventas pendientes de la más antigua a la más reciente.
 * - Éxito: la venta se borra del equipo (libera memoria).
 * - Sin internet o sesión: se detiene y deja todo guardado.
 * - Rechazada: se marca como fallida y sigue con las demás, sin bloquearlas.
 */
export async function syncPendingSales(send: (sale: OfflineSale) => Promise<SendOutcome>, onProgress?: () => void): Promise<SyncSummary> {
  const summary: SyncSummary = { synced: 0, failed: 0, waiting: 0, stopped: false };
  if (running) return summary;
  running = true;
  try {
    for (const sale of listSales().filter((item: OfflineSale) => item.status === 'pending')) {
      const outcome = await send(sale);
      if (outcome.kind === 'ok') {
        removeSale(sale.clientId);
        summary.synced += 1;
      } else if (outcome.kind === 'rejected') {
        updateSale(sale.clientId, { status: 'failed', message: outcome.message, attempts: sale.attempts + 1 });
        summary.failed += 1;
      } else {
        updateSale(sale.clientId, { message: outcome.message, attempts: sale.attempts + 1 });
        summary.stopped = true;
        break;
      }
      onProgress?.();
    }
  } finally {
    running = false;
  }
  summary.waiting = listSales().filter((item: OfflineSale) => item.status === 'pending').length;
  return summary;
}
