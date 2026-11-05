import { useCallback, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { fetchCatalogForRecipes, type CatalogProduct, type InventoryItem, type RecipeLine } from '@/lib/inventory';
import { RecipeDialog } from '@/components/inventory/RecipeDialog';

type RecipesTabProps = { items: InventoryItem[] };

export function RecipesTab({ items }: RecipesTabProps) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [recipeLines, setRecipeLines] = useState<RecipeLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);

  const loadCatalog = useCallback(async (): Promise<void> => {
    const result = await fetchCatalogForRecipes();
    setProducts(result.products);
    setRecipeLines(result.recipeLines);
    setError(result.error);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const categories = Array.from(new Set(products.map((product: CatalogProduct) => product.category)));
  const withoutRecipe = products.filter((product: CatalogProduct) => !recipeLines.some((line: RecipeLine) => line.product_id === product.id)).length;

  return (
    <section className="inventory-section">
      <p className="inventory-intro">
        Cada plato descuenta sus insumos al enviarse a cocina. {withoutRecipe > 0 ? `${withoutRecipe} platos todavía no tienen receta.` : 'Todos los platos tienen receta.'}
      </p>

      {error && <p className="auth-feedback error" role="alert">{error}</p>}

      {loaded && categories.map((category: string) => (
        <div className="inventory-group" key={category}>
          <h2>{category}</h2>
          <ul className="recipe-list">
            {products.filter((product: CatalogProduct) => product.category === category).map((product: CatalogProduct) => {
              const lines = recipeLines.filter((line: RecipeLine) => line.product_id === product.id);
              return (
                <li key={product.id}>
                  <button className="recipe-row" type="button" onClick={() => setEditingProduct(product)}>
                    <div>
                      <strong>{product.name}</strong>
                      <small className={lines.length === 0 ? 'recipe-missing' : ''}>
                        {lines.length === 0 ? 'Sin receta' : `${lines.length} insumos`}
                      </small>
                    </div>
                    <ChevronRight size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {loaded && products.length === 0 && !error && (
        <p className="inventory-empty">No hay platos activos en la carta.</p>
      )}

      {editingProduct && (
        <RecipeDialog
          product={editingProduct}
          items={items}
          lines={recipeLines.filter((line: RecipeLine) => line.product_id === editingProduct.id)}
          onChanged={loadCatalog}
          onClose={() => setEditingProduct(null)}
        />
      )}
    </section>
  );
}
