import { CircleCheck } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import {
  formatQuantity,
  storageLabels,
  stockStatus,
  suggestedPurchase,
  type InventoryItem,
} from '@/lib/inventory';

type ShoppingTabProps = { items: InventoryItem[] };

export function ShoppingTab({ items }: ShoppingTabProps) {
  const toBuy = items
    .filter((item: InventoryItem) => stockStatus(item) !== 'ok')
    .map((item: InventoryItem) => ({ item, quantity: suggestedPurchase(item) }))
    .filter((entry) => entry.quantity > 0)
    .sort((first, second) => first.item.current_stock - second.item.current_stock);

  const estimatedCost = toBuy.reduce(
    (total: number, entry) => total + Math.round(entry.quantity * entry.item.unit_cost_cop),
    0,
  );

  if (toBuy.length === 0) {
    return (
      <section className="inventory-section">
        <div className="inventory-all-set">
          <CircleCheck size={22} />
          <p>No necesitas comprar nada por ahora. Todos los insumos están sobre el mínimo.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="inventory-section">
      <div className="shopping-summary">
        <div>
          <span>Insumos por reponer</span>
          <strong>{toBuy.length}</strong>
        </div>
        <div>
          <span>Costo estimado</span>
          <strong>{formatCurrency(estimatedCost)}</strong>
        </div>
      </div>
      <p className="inventory-intro">La cantidad sugerida lleva el stock al doble del mínimo.</p>

      <ul className="shopping-list">
        {toBuy.map(({ item, quantity }) => (
          <li key={item.id}>
            <div>
              <strong>{item.name}</strong>
              <small>{storageLabels[item.storage_location]} · queda {formatQuantity(item.current_stock, item.unit)}</small>
            </div>
            <div className="shopping-amount">
              <strong>{formatQuantity(quantity, item.unit)}</strong>
              <small>{formatCurrency(Math.round(quantity * item.unit_cost_cop))}</small>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
