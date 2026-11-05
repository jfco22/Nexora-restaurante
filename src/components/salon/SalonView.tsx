import { useEffect, useState } from 'react';
import { Plus, Utensils } from 'lucide-react';
import { TableAccountPanel } from '@/components/salon/TableAccountPanel';
import { supabase } from '@/lib/supabase';
import { fetchOpenTableAccount } from '@/lib/tableAccount';

type TableStatus = 'Libre' | 'Ocupada' | 'Reservada' | 'Fuera de servicio';
type FilterOption = 'Todas' | 'Ocupada' | 'Libre' | 'Reservada';

type SalonTable = {
  id: string;
  name: string;
  seats: number;
  status: TableStatus;
};

const statusMap: Record<string, TableStatus> = {
  free: 'Libre',
  occupied: 'Ocupada',
  reserved: 'Reservada',
  out_of_service: 'Fuera de servicio',
};

const statusClassMap: Record<TableStatus, string> = {
  Libre: 'libre',
  Ocupada: 'ocupada',
  Reservada: 'reservada',
  'Fuera de servicio': 'fuera-de-servicio',
};

export function SalonView() {
  const [salonTables, setSalonTables] = useState<SalonTable[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<FilterOption>('Todas');
  const [message, setMessage] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<SalonTable | null>(null);

  const loadTables = async (): Promise<void> => {
    const { data, error } = await supabase
      .from('nexora_tables')
      .select('id, name, seats, status')
      .eq('is_active', true)
      .order('name');
    setLoaded(true);
    if (error) {
      setMessage('No pudimos cargar las mesas guardadas.');
      return;
    }
    setSalonTables((data ?? []).map((table: { id: string; name: string; seats: number; status: string }) => ({
      id: table.id,
      name: table.name,
      seats: table.seats,
      status: statusMap[table.status] ?? 'Fuera de servicio',
    })));
  };

  useEffect(() => { void loadTables(); }, []);

  const openTable = async (table: SalonTable): Promise<void> => {
    setMessage(null);
    const { error } = await supabase.rpc('open_nexora_table_order', { table_id_input: table.id });
    await loadTables();
    if (error) {
      setMessage('La mesa no está disponible o ya tiene una cuenta abierta.');
      return;
    }
    setSelectedTable(table);
  };

  const handleTableAction = async (table: SalonTable): Promise<void> => {
    if (table.status === 'Libre') {
      void openTable(table);
      return;
    }
    if (table.status === 'Ocupada') {
      const result = await fetchOpenTableAccount(table.id);
      if (result.error || !result.account) {
        setMessage(null);
        const { error } = await supabase.rpc('release_nexora_orphaned_table', { table_id_input: table.id });
        if (error) {
          setMessage('No se pudo liberar la mesa. Revisa tus permisos.');
          return;
        }
        setMessage(`La mesa ${table.name} no tenía una cuenta activa y fue liberada.`);
        await loadTables();
        return;
      }
      setSelectedTable(table);
    }
  };

  const handleQuickOpen = (): void => {
    const firstFree = salonTables.find((table: SalonTable) => table.status === 'Libre');
    if (!firstFree) {
      setMessage('No hay mesas libres en este momento.');
      return;
    }
    void openTable(firstFree);
  };

  const closePanel = (): void => {
    setSelectedTable(null);
    void loadTables();
  };

  const visibleTables = salonTables.filter((table: SalonTable) => filter === 'Todas' || table.status === filter);
  const countByStatus = (status: TableStatus): number => salonTables.filter((table: SalonTable) => table.status === status).length;

  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operación</p>
          <h1>Salón</h1>
          <p className="muted">Gestiona tus mesas y cuentas en tiempo real.</p>
        </div>
        <button className="primary-button" type="button" onClick={handleQuickOpen}><Plus size={17} /> Abrir cuenta</button>
      </div>
      {message && <p className="salon-message" role="status">{message}</p>}
      <div className="salon-summary">
        <span><i className="table-dot occupied" /> {countByStatus('Ocupada')} ocupadas</span>
        <span><i className="table-dot available" /> {countByStatus('Libre')} libres</span>
        <span><i className="table-dot reserved" /> {countByStatus('Reservada')} reservadas</span>
        <div className="filter-tabs">
          {(['Todas', 'Ocupada', 'Libre', 'Reservada'] as const).map((item: FilterOption) => (
            <button key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)} type="button">{item}</button>
          ))}
        </div>
      </div>
      {!loaded && <p className="account-empty">Cargando mesas...</p>}
      {loaded && salonTables.length === 0 && <p className="account-empty">Aún no hay mesas configuradas.</p>}
      <section className="tables-grid">
        {visibleTables.map((table: SalonTable) => <TableCard key={table.id} table={table} onAction={handleTableAction} />)}
      </section>
      {selectedTable && (
        <TableAccountPanel
          tableId={selectedTable.id}
          tableName={selectedTable.name}
          onClose={closePanel}
          onChanged={() => void loadTables()}
        />
      )}
    </div>
  );
}

function TableCard({ table, onAction }: { table: SalonTable; onAction: (table: SalonTable) => void }) {
  const statusClass = statusClassMap[table.status];
  const actionLabel = table.status === 'Libre' ? 'Abrir cuenta' : table.status === 'Ocupada' ? 'Ver cuenta' : null;
  return (
    <article className={`table-card ${statusClass}`}>
      <div className="table-card-top"><span className={`status-pill ${statusClass}`}>{table.status}</span></div>
      <div className="table-shape"><Utensils size={22} /></div>
      <h3>{table.name}</h3>
      <p>{table.seats} puestos</p>
      {actionLabel
        ? <button className="table-open-button" type="button" onClick={() => onAction(table)}>{actionLabel}</button>
        : <span className="table-empty">{table.status === 'Reservada' ? 'Sin cuenta abierta' : 'No disponible'}</span>}
    </article>
  );
}
