import { MonitorOff } from 'lucide-react';
import '@/components/horas/hours.css';

type DeviceGateProps = { onRetry: () => void; onSignOut: () => void };

/** Pantalla que bloquea el acceso del personal desde equipos que no están asignados al restaurante. */
export function DeviceGate({ onRetry, onSignOut }: DeviceGateProps) {
  return (
    <main className="device-gate">
      <section className="device-gate-card" role="alert">
        <MonitorOff size={36} />
        <h1>Este equipo no está autorizado</h1>
        <p>Para trabajar en Nexora debes entrar desde la tablet o el computador asignados al restaurante. Desde aquí no se puede registrar tu turno ni usar el sistema.</p>
        <p>Si estás en el restaurante, pídele al propietario o a un gerente que asigne este equipo en <strong>Horas → Equipos autorizados</strong>.</p>
        <div className="device-gate-actions">
          <button className="outline-button" type="button" onClick={onRetry}>Volver a verificar</button>
          <button className="primary-button" type="button" onClick={onSignOut}>Cerrar sesión</button>
        </div>
      </section>
    </main>
  );
}
