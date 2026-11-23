import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { readCache, writeCache } from '@/lib/offline/cache';
import { clearDeviceToken, getDeviceToken, saveDeviceToken } from '@/lib/workTime';
import { beatWorkSession, checkDevice, endWorkSession } from '@/lib/workTimeApi';

export type TrackingStatus =
  | 'idle'            // sin sesión
  | 'checking'        // verificando el equipo
  | 'counting'        // equipo autorizado: las horas se están contando
  | 'not_authorized'  // este equipo no está asignado al restaurante
  | 'unavailable';    // falta la migración: no hay control de horas

export type WorkTracking = {
  status: TrackingStatus;
  deviceName: string | null;
  startedAt: string | null;
  /** Vuelve a verificar el equipo (después de asignarlo o quitarlo). */
  recheck: () => void;
  /** Guarda el código del equipo recién asignado en este navegador. */
  authorizeThisDevice: (token: string) => boolean;
  /** Quita la autorización de este navegador. */
  forgetThisDevice: () => void;
  /** Cierra el turno (llamar justo antes de cerrar sesión). */
  finish: () => Promise<void>;
};

const BEAT_EVERY_MS = 60000;

/** Cuenta las horas solo si este equipo está autorizado: envía una señal cada minuto mientras la app está abierta. */
export function useWorkTracking(session: Session | null): WorkTracking {
  const userId = session?.user.id ?? null;
  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const missedRef = useRef(false);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!userId) {
      setStatus('idle');
      setDeviceName(null);
      setStartedAt(null);
      return;
    }
    let active = true;
    let timer: number | undefined;
    missedRef.current = false;
    stoppedRef.current = false;
    setStatus('checking');

    const beat = async (token: string): Promise<void> => {
      if (stoppedRef.current) return;
      // Si la señal anterior falló pero la app siguió abierta, el servidor puede extender el turno (solo se cayó el internet).
      const result = await beatWorkSession(token, missedRef.current);
      if (!active) return;
      if (result.kind === 'counting') {
        missedRef.current = false;
        setStatus('counting');
        setDeviceName(result.deviceName);
        setStartedAt(result.startedAt);
      } else if (result.kind === 'denied') {
        writeCache('work-device-ok', false);
        setStatus('not_authorized');
        setStartedAt(null);
      } else {
        missedRef.current = true;
      }
    };

    const start = async (): Promise<void> => {
      const token = getDeviceToken();
      const check = await checkDevice(token);
      if (!active) return;
      if (check.status === 'unavailable') { setStatus('unavailable'); return; }
      if (check.status === 'none' || !token) {
        writeCache('work-device-ok', false);
        setStatus('not_authorized');
        return;
      }
      if (check.status === 'unknown') {
        // Sin internet: confiamos en la última verificación de este equipo.
        const cached = readCache<boolean>('work-device-ok');
        if (!cached?.value) { setStatus('not_authorized'); return; }
        missedRef.current = true;
        setStatus('counting');
      } else {
        writeCache('work-device-ok', true);
        setDeviceName(check.device.device_name);
      }
      await beat(token);
      if (!active) return;
      timer = window.setInterval(() => { void beat(token); }, BEAT_EVERY_MS);
    };

    const onWake = (): void => {
      const token = getDeviceToken();
      if (token && document.visibilityState !== 'hidden') void beat(token);
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);
    void start();

    return () => {
      active = false;
      if (timer !== undefined) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [userId, version]);

  const recheck = useCallback((): void => setVersion((value: number) => value + 1), []);
  const authorizeThisDevice = useCallback((token: string): boolean => {
    const saved = saveDeviceToken(token);
    if (saved) setVersion((value: number) => value + 1);
    return saved;
  }, []);
  const forgetThisDevice = useCallback((): void => {
    clearDeviceToken();
    writeCache('work-device-ok', false);
    setVersion((value: number) => value + 1);
  }, []);
  const finish = useCallback(async (): Promise<void> => {
    stoppedRef.current = true; // evita que una señal en camino vuelva a abrir el turno
    await endWorkSession();
  }, []);

  return { status, deviceName, startedAt, recheck, authorizeThisDevice, forgetThisDevice, finish };
}
