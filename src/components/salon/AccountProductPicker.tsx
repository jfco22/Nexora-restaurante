import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Search, Utensils, X } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { supabase } from '@/lib/supabase';

type PickerProduct = {
  id: string;
  name: string;
  description: string;
  price_cop: number;
  image_url: string | null;
  category: string;
};

type ProductRow = {
  id: string;
  name: string;
  description: string;
  price_cop: number;
  image_url: string | null;
  nexora_categories: { name: string }[] | null;
};

type AccountProductPickerProps = {
  onAddItems: (items: { product_id: string; quantity: number }[]) => Promise<string | null>;
  onClose: () => void;
};

export function AccountProductPicker({ onAddItems, onClose }: AccountProductPickerProps) {
  const [products, setProducts] = useState<PickerProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const loadProducts = async (): Promise<void> => {
      const { data, error } = await supabase
        .from('nexora_products')
        .select('id, name, description, price_cop, image_url, nexora_categories(name)')
        .eq('is_active', true)
        .eq('is_available', true)
        .order('name');
      if (error) {
        setLoadError('No pudimos cargar la carta.');
      } else {
        setProducts(((data ?? []) as ProductRow[]).map((row: ProductRow) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          price_cop: row.price_cop,
          image_url: row.image_url,
          category: row.nexora_categories?.[0]?.name ?? 'Carta',
        })));
      }
      setLoading(false);
    };
    void loadProducts();
  }, []);

  const filteredProducts = useMemo(
    () => products.filter((product: PickerProduct) => product.name.toLowerCase().includes(search.trim().toLowerCase())),
    [products, search],
  );

  const cartCount = Object.values(cart).reduce((total: number, quantity: number) => total + quantity, 0);

  const updateCart = (productId: string, change: number): void => {
    setCart((current: Record<string, number>) => {
      const nextQuantity = (current[productId] ?? 0) + change;
      if (nextQuantity <= 0) {
        const next = { ...current };
        delete next[productId];
        return next;
      }
      return { ...current, [productId]: Math.min(nextQuantity, 100) };
    });
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setSubmitError(null);
    const items = Object.entries(cart).map(([productId, quantity]: [string, number]) => ({ product_id: productId, quantity }));
    const error = await onAddItems(items);
    setBusy(false);
    if (error) setSubmitError(error);
    else onClose();
  };

  return (
    <div className="account-modal-layer" role="dialog" aria-modal="true" aria-label="Agregar productos a la cuenta">
      <div className="account-modal picker-modal">
        <header className="account-header">
          <div>
            <p className="eyebrow">Carta</p>
            <h2>Agregar productos</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}><X size={17} /></button>
        </header>

        <label className="search-field picker-search">
          <Search size={16} />
          <input aria-label="Buscar producto" value={search} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)} placeholder="Buscar producto" />
        </label>

        <div className="picker-body">
          {loading && <p className="account-empty">Cargando carta...</p>}
          {!loading && loadError && <p className="auth-feedback error" role="alert">{loadError}</p>}
          {!loading && !loadError && filteredProducts.length === 0 && <p className="account-empty">No hay productos que coincidan.</p>}
          <div className="picker-grid">
            {filteredProducts.map((product: PickerProduct) => {
              const quantity = cart[product.id] ?? 0;
              return (
                <article key={product.id} className={`picker-card ${quantity > 0 ? 'selected' : ''}`}>
                  {product.image_url ? <img src={product.image_url} alt={product.name} /> : <div className="picker-placeholder"><Utensils size={22} /></div>}
                  <div className="picker-card-info">
                    <span className="product-category">{product.category}</span>
                    <h3>{product.name}</h3>
                    <p>{product.description}</p>
                    <div className="picker-card-bottom">
                      <strong>{formatCurrency(product.price_cop)}</strong>
                      {quantity === 0 ? (
                        <button className="add-button" type="button" onClick={() => updateCart(product.id, 1)}><Plus size={14} /> Agregar</button>
                      ) : (
                        <div className="quantity-control">
                          <button type="button" aria-label={`Quitar uno de ${product.name}`} onClick={() => updateCart(product.id, -1)}><Minus size={13} /></button>
                          <b>{quantity}</b>
                          <button type="button" aria-label={`Agregar uno de ${product.name}`} onClick={() => updateCart(product.id, 1)}><Plus size={13} /></button>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <footer className="account-footer picker-footer">
          {submitError && <p className="auth-feedback error" role="alert">{submitError}</p>}
          <button className="primary-button full-width" type="button" disabled={busy || cartCount === 0} onClick={() => void submit()}>
            {busy ? 'Agregando...' : `Agregar a la cuenta (${cartCount})`}
          </button>
        </footer>
      </div>
    </div>
  );
}
