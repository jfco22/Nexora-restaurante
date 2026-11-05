import { useCallback, useEffect, useState } from 'react';
import { ShoppingBasket, Boxes, Soup, Upload } from 'lucide-react';
import { fetchInventory, type InventoryItem } from '@/lib/inventory';
import { InventoryStockTab } from '@/components/inventory/InventoryStockTab';
import { RecipesTab } from '@/components/inventory/RecipesTab';
import { ShoppingTab } from '@/components/inventory/ShoppingTab';
import '@/components/inventory/inventory.css';
import '@/components/inventory/inventory-import.css';

type InventoryTab = 'stock' | 'recipes' | 'shopping';

const tabs: { value: InventoryTab; label: string; icon: React.ReactNode }[] = [
  { value: 'stock', label: 'Insumos', icon: <Boxes size={16} /> },
  { value: 'recipes', label: 'Recetas', icon: <Soup size={16} /> },
  { value: 'shopping', label: 'Por comprar', icon: <ShoppingBasket size={16} /> },
];

export function InventoryView({ onImport }: { onImport: () => void }) {
  const [tab, setTab] = useState<InventoryTab>('stock');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [archivedItems, setArchivedItems] = useState<InventoryItem[]>([]);
  const [usedToday, setUsedToday] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadInventory = useCallback(async (): Promise<void> => {
    const result = await fetchInventory();
    setItems(result.items);
    setArchivedItems(result.archivedItems);
    setUsedToday(result.usedToday);
    setError(result.error);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  const lowCount = items.filter((item: InventoryItem) => item.current_stock <= item.min_stock).length;

  return (
    <div className="page-wrap inventory-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operación</p>
          <h1>Inventario</h1>
          <p className="muted">
            {lowCount > 0 ? `${lowCount} insumos están en o bajo el mínimo.` : 'Todo el inventario está sobre el mínimo.'}
          </p>
        </div>
        <button className="primary-button" type="button" onClick={onImport}><Upload size={16} /> Importar Excel</button>
      </div>

      <div className="inventory-tabs" role="tablist" aria-label="Secciones de inventario">
        {tabs.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={tab === option.value}
            className={tab === option.value ? 'selected' : ''}
            onClick={() => setTab(option.value)}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        ))}
      </div>

      {error && <p className="auth-feedback error" role="alert">{error}</p>}

      {loaded && tab === 'stock' && (
        <InventoryStockTab items={items} archivedItems={archivedItems} usedToday={usedToday} onChanged={loadInventory} />
      )}
      {loaded && tab === 'recipes' && <RecipesTab items={items} />}
      {loaded && tab === 'shopping' && <ShoppingTab items={items} />}
    </div>
  );
}
