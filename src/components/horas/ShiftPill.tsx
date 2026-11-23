import { useEffect, useState } from 'react';
import '@/components/horas/hours.css';
import { formatMinutes } from '@/lib/workTime';
import type { WorkTracking } from '@/lib/useWorkTracking';

/** Estado del turno en el menú lateral: cuánto llevas hoy y desde qué equipo. */
export function ShiftPill({ tracking, isManager }: { tracking: WorkTracking; isManager: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  if (tracking.status === 'counting' && tracking.startedAt) {
    const minutes = Math.max(0, Math.floor((now - new Date(tracking.startedAt).getTime()) / 60000));
    const since = new Date(tracking.startedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    return (
      <div className="shift-pill" role="status">
        <span className="pulse" />
        <div><strong>Turno en curso · {formatMinutes(minutes)}</strong>Desde las {since}{tracking.deviceName ? ` · ${tracking.deviceName}` : ''}</div>
      </div>
    );
  }
  if (tracking.status === 'not_authorized' && isManager) {
    return (
      <div className="shift-pill off" role="status">
        <span className="pulse" />
        <div><strong>Tus horas no se cuentan aquí</strong>Este equipo no está asignado al restaurante.</div>
      </div>
    );
  }
  return null;
}
