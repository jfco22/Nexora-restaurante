import { useState } from 'react';
import { ArchiveRestore, Pencil, Plus, Truck } from 'lucide-react';
import {
  formatQuantity,
  storageLabels,
  stockStatus,
  type InventoryItem,
  type StockStatus,
  type StorageLocation,
} from '@/lib/inventory';
import { ItemDialog } from '@/components/inventory/ItemDialog';
import { MovementDialog } from '@/components/inventory/MovementDialog';

const storageOrder: StorageLocation[] = ['nevera', 'estanteria', 'bodega'];

const statusCopy: Record<StockStatus, { label: string; className: string }> = {
  negative: { label: 'Faltante', className: 'negative' },
  empty: { label: 'Agotado', className: 'negative' },
  low: { label: 'Bajo mínimo', className: 'low' },
  ok: { label: 'En stock', className: 'ok' },
};

type InventoryStockTabProps = {
  items: InventoryItem[];
  archivedItems: InventoryItem[];
  usedToday: Map<string, number>;
  onChanged: () => Promise<void>;
};

export function InventoryStockTab({ items, archivedItems, usedToday, onChanged }: InventoryStockTabProps) {
  const [itemDialog, setItemDialog] = useState<InventoryItem | 'new' | null>(null);
  const [movementItem, setMovementItem] = useState<InventoryItem | null>(null);

  return (
    <section className="inventory-section">
      <div className="inventory-toolbar">
        <button className="primary-button" type="button" onClick={() => setItemDialog('new')}>
          <Plus size={16} /> Nuevo insumo
        </button>
      </div>

      {items.length === 0 && (
        <p className="inventory-empty">Aún no tienes insumos. Agrega los que usas en la cocina para empezar a controlar el stock.</p>
      )}

      {storageOrder.map((location: StorageLocation) => {
        const group = items.filter((item: InventoryItem) => item.storage_location === location);
        if (group.length === 0) return null;
        return (
          <div className="inventory-group" key={location}>
            <h2>{storageLabels[location]} <span>{group.length}</span></h2>
            <ul className="inventory-list">
              {group.map((item: InventoryItem) => {
                const status = statusCopy[stockStatus(item)];
                const used = usedToday.get(item.id) ?? 0;
                return (
                  <li className="inventory-row" key={item.id}>
                    <div className="inventory-name">
                      <strong>{item.name}</strong>
                      <small>Mínimo {formatQuantity(item.min_stock, item.unit)}</small>
                    </div>
                    <div className="inventory-stock">
                      <strong>{formatQuantity(item.current_stock, item.unit)}</strong>
                      <small>Usado hoy {formatQuantity(used, item.unit)}</small>
                    </div>
                    <span className={`inventory-status ${status.className}`}>{status.label}</span>
                    <div className="inventory-actions">
                      <button className="outline-button" type="button" onClick={() => setMovementItem(item)}>
                        <Truck size={15} /> Registrar
                      </button>
                      <button className="icon-button" type="button" aria-label={`Editar ${item.name}`} onClick={() => setItemDialog(item)}>
                        <Pencil size={15} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {archivedItems.length > 0 && (
        <div className="inventory-group archived">
          <h2>Desactivados <span>{archivedItems.length}</span></h2>
          <ul className="inventory-list">
            {archivedItems.map((item: InventoryItem) => (
              <li className="inventory-row" key={item.id}>
                <div className="inventory-name">
                  <strong>{item.name}</strong>
                  <small>{storageLabels[item.storage_location]}</small>
                </div>
                <div className="inventory-actions">
                  <button className="outline-button" type="button" onClick={() => setItemDialog(item)}>
                    <ArchiveRestore size={15} /> Reactivar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {itemDialog && (
        <ItemDialog
          item={itemDialog === 'new' ? null : itemDialog}
          onSaved={async () => {
            setItemDialog(null);
            await onChanged();
          }}
          onClose={() => setItemDialog(null)}
        />
      )}

      {movementItem && (
        <MovementDialog
          item={movementItem}
          onRegistered={async () => {
            setMovementItem(null);
            await onChanged();
          }}
          onClose={() => setMovementItem(null)}
        />
      )}
    </section>
  );
}
