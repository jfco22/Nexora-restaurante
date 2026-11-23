import { useCallback, useEffect, useRef, useState } from 'react';
import { listSales, type OfflineSale } from '@/lib/offline/salesStore';
import { syncOfflineSalesNow } from '@/lib/offline/sendSale';
import type { SyncSummary } from '@/lib/offline/syncSales';

const PROBE_EVERY_MS = 15000;
const PROBE_TIMEOUT_MS = 4000;

/**
 * ¿Hay internet de verdad? navigator.onLine solo dice si hay Wi‑Fi, no si el Wi‑Fi tiene internet,
 * así que además se pregunta al servidor cada 15 segundos. Cualquier respuesta (aunque sea un error HTTP) cuenta como conexión.
 */
export function useConnectivity(): boolean {
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    let active = true;
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

    const probe = async (): Promise<void> => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (active) setOnline(false);
        return;
      }
      if (!url || !key) return;
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        await fetch(`${url}/auth/v1/health`, { method: 'GET', headers: { apikey: key }, cache: 'no-store', signal: controller.signal });
        if (active) setOnline(true);
      } catch {
        if (active) setOnline(false);
      } finally {
        window.clearTimeout(timer);
      }
    };

    const onChange = (): void => { void probe(); };
    window.addEventListener('online', onChange);
    window.addEventListener('offline', onChange);
    void probe();
    const interval = window.setInterval(onChange, PROBE_EVERY_MS);
    return () => {
      active = false;
      window.removeEventListener('online', onChange);
      window.removeEventListener('offline', onChange);
      window.clearInterval(interval);
    };
  }, []);

  return online;
}

export type OfflineSalesState = {
  sales: OfflineSale[];
  syncing: boolean;
  lastSummary: SyncSummary | null;
  refresh: () => void;
  syncNow: () => Promise<void>;
};

/** Ventas guardadas en este equipo y la subida automática cuando vuelve el internet. */
export function useOfflineSales(enabled: boolean, online: boolean): OfflineSalesState {
  const [sales, setSales] = useState<OfflineSale[]>(() => listSales());
  const [syncing, setSyncing] = useState(false);
  const [lastSummary, setLastSummary] = useState<SyncSummary | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback((): void => setSales(listSales()), []);

  const syncNow = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    if (listSales().every((sale: OfflineSale) => sale.status !== 'pending')) {
      refresh();
      return;
    }
    setSyncing(true);
    const summary = await syncOfflineSalesNow(() => { if (mounted.current) refresh(); });
    if (!mounted.current) return;
    setSyncing(false);
    setLastSummary(summary);
    refresh();
  }, [enabled, refresh]);

  // Sube solo al volver el internet y reintenta cada 30 s mientras queden ventas pendientes.
  const pendingCount = sales.filter((sale: OfflineSale) => sale.status === 'pending').length;
  useEffect(() => {
    if (!enabled || !online || pendingCount === 0) return;
    void syncNow();
    const interval = window.setInterval(() => { void syncNow(); }, 30000);
    return () => window.clearInterval(interval);
  }, [enabled, online, pendingCount, syncNow]);

  return { sales, syncing, lastSummary, refresh, syncNow };
}
