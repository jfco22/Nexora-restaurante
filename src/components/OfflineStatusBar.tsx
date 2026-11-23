import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import '@/components/offline.css';
import { formatCurrency } from '@/lib/format';
import { methodLabel, type OfflineSale } from '@/lib/offline/salesStore';

type OfflineStatusBarProps = {
  online: boolean;
  sales: OfflineSale[];
  syncing: boolean;
  onSync: () => void;
  onDiscard: (clientId: string) => void;
};

const timeOf = (iso: string): string => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

export function OfflineStatusBar({ online, sales, syncing, onSync, onDiscard }: OfflineStatusBarProps) {
  const pending = sales.filter((sale: OfflineSale) => sale.status === 'pending');
  const failed = sales.filter((sale: OfflineSale) => sale.status === 'failed');
  if (online && sales.length === 0) return null;

  const pendingTotal = pending.reduce((sum: number, sale: OfflineSale) => sum + sale.total, 0);
  const retryReason = pending.find((sale: OfflineSale) => sale.message)?.message ?? null;

  const discard = (sale: OfflineSale): void => {
    const ok = window.confirm(`¿Descartar la venta de ${formatCurrency(sale.total)} de las ${timeOf(sale.occurredAt)}? Se borra de este equipo y no se registrará en el sistema.`);
    if (ok) onDiscard(sale.clientId);
  };

  return (
    <section className="offline-bar" aria-live="polite">
      {!online && (
        <div className="offline-row offline">
          <CloudOff size={17} />
          <div>
            <strong>Sin internet</strong>
            <span>Puedes seguir cobrando en Carta con efectivo o tarjeta: las ventas se guardan en este equipo y suben solas cuando vuelva la señal. Salón, Cocina e Inventario necesitan internet.</span>
          </div>
        </div>
      )}
      {pending.length > 0 && (
        <div className="offline-row pending">
          <RefreshCw size={17} className={syncing ? 'spin' : ''} />
          <div>
            <strong>{pending.length} {pending.length === 1 ? 'venta guardada' : 'ventas guardadas'} en este equipo · {formatCurrency(pendingTotal)}</strong>
            <span>{syncing ? 'Subiendo al sistema…' : online ? 'Subirán solas en unos segundos.' : 'Esperando que vuelva el internet.'}</span>
            {online && retryReason && !syncing && <span className="offline-reason">{retryReason}</span>}
          </div>
          {online && <button className="outline-button" type="button" disabled={syncing} onClick={onSync}>{syncing ? 'Subiendo…' : 'Subir ahora'}</button>}
        </div>
      )}
      {failed.map((sale: OfflineSale) => (
        <div className="offline-row failed" key={sale.clientId}>
          <TriangleAlert size={17} />
          <div>
            <strong>No se pudo registrar la venta de {formatCurrency(sale.total)} ({methodLabel[sale.method]}, {timeOf(sale.occurredAt)})</strong>
            <span>{sale.message ?? 'La base de datos la rechazó.'} Corrige la causa (por ejemplo, reactiva el producto) y vuelve a registrarla en Carta, o descártala.</span>
          </div>
          <button className="outline-button" type="button" onClick={() => discard(sale)}>Descartar</button>
        </div>
      ))}
    </section>
  );
}
