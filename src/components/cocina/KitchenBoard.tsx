import { useEffect, useState } from 'react';
import { CheckCircle2, ChefHat, Circle, Flame, PackageCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import './kitchen-board.css';

export type KitchenTicket = {
  id: string;
  order_number: number;
  status: string;
  order_type: string;
  source: string;
  total_cop: number;
  created_at: string;
  ready_at: string | null;
  guest_name: string | null;
  table_name: string | null;
  payment_status: string;
  items: { product_name: string; quantity: number }[] | null;
};

const statusLabels: Record<string, string> = { submitted: 'Por validar', accepted: 'Preparando', ready: 'Listo' };
const statusOrder: string[] = ['submitted', 'accepted', 'ready'];

const actionLabels: Record<string, string> = { submitted: 'Aceptar pedido', accepted: 'Marcar listo', ready: 'Entregar pedido' };

const elapsedMinutes = (iso: string): number => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));

const ticketSteps = (ticket: KitchenTicket): { label: string; done: boolean }[] => {
  const reached = (status: string): boolean => statusOrder.indexOf(ticket.status) >= statusOrder.indexOf(status);
  return [
    { label: 'Pago aprobado', done: ticket.payment_status === 'paid' },
    { label: 'Aceptado por cocina', done: reached('accepted') },
    { label: 'Preparado', done: reached('ready') },
    { label: 'Entregado', done: false },
  ];
};

export function KitchenBoard() {
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const loadTickets = async (): Promise<void> => {
    const { data, error } = await supabase.from('nexora_kitchen_tickets').select('*');
    if (error) {
      setMessage('No pudimos cargar los tickets de cocina.');
      return;
    }
    setTickets((data ?? []) as KitchenTicket[]);
  };

  useEffect(() => { void loadTickets(); }, []);

  const advance = async (ticket: KitchenTicket): Promise<void> => {
    setMessage(null);
    const { error } = await supabase.rpc('advance_nexora_order_status', { order_id_input: ticket.id });
    if (error) {
      setMessage('No pudimos actualizar el pedido.');
      return;
    }
    await loadTickets();
  };

  const grouped = statusOrder.map((status: string) => ({ status, items: tickets.filter((ticket: KitchenTicket) => ticket.status === status) }));

  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operación</p>
          <h1>Cocina</h1>
          <p className="muted">Valida cada pedido pagado, prepáralo y entrégalo. Los pasos se marcan al avanzar.</p>
        </div>
      </div>
      {message && <p className="salon-message" role="status">{message}</p>}
      <div className="kitchen-columns">
        {grouped.map((column: { status: string; items: KitchenTicket[] }) => (
          <section key={column.status} className="kitchen-column">
            <div className="kitchen-column-header">
              <span className={`kitchen-status-dot ${column.status}`} />
              <h2>{statusLabels[column.status]}</h2>
              <b>{column.items.length}</b>
            </div>
            {column.items.length === 0
              ? <p className="kitchen-empty">Sin tickets</p>
              : column.items.map((ticket: KitchenTicket) => <KitchenTicketCard key={ticket.id} ticket={ticket} onAdvance={advance} />)}
          </section>
        ))}
      </div>
    </div>
  );
}

function KitchenTicketCard({ ticket, onAdvance }: { ticket: KitchenTicket; onAdvance: (ticket: KitchenTicket) => Promise<void> }) {
  const minutes = elapsedMinutes(ticket.created_at);
  const steps = ticketSteps(ticket);
  return (
    <article className={`kitchen-ticket ${ticket.status}`}>
      <div className="kitchen-ticket-top">
        <strong>#{ticket.order_number}</strong>
        <span className={`kitchen-pill ${ticket.status}`}>{statusLabels[ticket.status]}</span>
      </div>
      <div className="kitchen-ticket-meta">
        <span>{ticket.table_name ?? ticket.guest_name ?? 'Para llevar'}</span>
        <span className={minutes > 15 ? 'kitchen-delayed' : ''}>{minutes} min</span>
      </div>
      <ul className="kitchen-items">
        {(ticket.items ?? []).map((item: { product_name: string; quantity: number }, index: number) => (
          <li key={index}><b>{item.quantity}×</b> {item.product_name}</li>
        ))}
      </ul>
      <ol className="kitchen-steps" aria-label="Pasos del pedido">
        {steps.map((step: { label: string; done: boolean }) => (
          <li key={step.label} className={step.done ? 'done' : ''}>
            {step.done ? <CheckCircle2 size={14} /> : <Circle size={14} />}
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
      <button className="kitchen-action-button" type="button" onClick={() => void onAdvance(ticket)}>
        {ticket.status === 'submitted' ? <ChefHat size={14} /> : ticket.status === 'accepted' ? <Flame size={14} /> : <PackageCheck size={14} />}
        {actionLabels[ticket.status]}
      </button>
    </article>
  );
}
