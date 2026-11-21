import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Search, Utensils, X } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { cartItems, cartKey, cartQuantityOfProduct, choiceNames, parseCartKey, useProductOptions } from '@/lib/productOptions';
import { OptionPickerDialog } from '@/components/salon/OptionPickerDialog';

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
  onAddItems: (items: { product_id: string; quantity: number; choices?: string[] }[]) => Promise<string | null>;
  onClose: () => void;
};

export function AccountProductPicker({ onAddItems, onClose }: AccountProductPickerProps) {
  const [products, setProducts] = useState<PickerProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const options = useProductOptions();
  const [picking, setPicking] = useState<PickerProduct | null>(null);
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

  const updateProduct = (product: PickerProduct, change: number): void => {
    if (options[product.id]) {
      if (change > 0) {
        setPicking(product);
      } else {
        const lastKey = Object.keys(cart).filter((key: string) => parseCartKey(key).productId === product.id).pop();
        if (lastKey) updateCart(lastKey, change);
      }
      return;
    }
    updateCart(product.id, change);
  };

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
    const items = cartItems(cart);
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
              const quantity = cartQuantityOfProduct(cart, product.id);
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
                        <button className="add-button" type="button" onClick={() => updateProduct(product, 1)}><Plus size={14} /> Agregar</button>
                      ) : (
                        <div className="quantity-control">
                          <button type="button" aria-label={`Quitar uno de ${product.name}`} onClick={() => updateProduct(product, -1)}><Minus size={13} /></button>
                          <b>{quantity}</b>
                          <button type="button" aria-label={`Agregar uno de ${product.name}`} onClick={() => updateProduct(product, 1)}><Plus size={13} /></button>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        {Object.keys(cart).some((key: string) => parseCartKey(key).choiceIds.length > 0) && (
          <ul className="account-empty">
            {Object.entries(cart).filter(([key]: [string, number]) => parseCartKey(key).choiceIds.length > 0).map(([key, quantity]: [string, number]) => {
              const { productId, choiceIds } = parseCartKey(key);
              const product = products.find((item: PickerProduct) => item.id === productId);
              return <li key={key}>{quantity} × {product?.name} ({choiceNames(options[productId], choiceIds)})</li>;
            })}
          </ul>
        )}
        {picking && options[picking.id] && <OptionPickerDialog productName={picking.name} option={options[picking.id]} onClose={() => setPicking(null)} onConfirm={(choiceIds: string[]) => { updateCart(cartKey(picking.id, choiceIds), 1); setPicking(null); }} />}
        <footer className="account-footer picker-footer">
          {submitError && <p className="auth-feedback error" role="alert">{submitError}</p>}
          {cartCount === 0 && <small className="form-problem-inline">Pulsa Agregar en los productos que quieres añadir a la cuenta.</small>}
          <button className="primary-button full-width" type="button" disabled={busy || cartCount === 0} onClick={() => void submit()}>
            {busy ? 'Agregando...' : `Agregar a la cuenta (${cartCount})`}
          </button>
        </footer>
      </div>
    </div>
  );
}
