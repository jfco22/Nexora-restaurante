import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';


export type OptionChoice = { id: string; name: string };
export type ProductOption = { product_id: string; picks: number; choices: OptionChoice[] };
export type ProductOptionMap = Record<string, ProductOption>;

/** Una línea del carrito es "productId" o "productId::opcion1,opcion2" cuando el producto pide escoger opciones. */
export function cartKey(productId: string, choiceIds: string[] = []): string {
  return choiceIds.length === 0 ? productId : `${productId}::${choiceIds.join(',')}`;
}

export function parseCartKey(key: string): { productId: string; choiceIds: string[] } {
  const [productId, rest] = key.split('::');
  return { productId, choiceIds: rest ? rest.split(',') : [] };
}

export function cartItems(cart: Record<string, number>): { product_id: string; quantity: number; choices?: string[] }[] {
  return Object.entries(cart).map(([key, quantity]: [string, number]) => {
    const { productId, choiceIds } = parseCartKey(key);
    return choiceIds.length > 0 ? { product_id: productId, quantity, choices: choiceIds } : { product_id: productId, quantity };
  });
}

export function cartQuantityOfProduct(cart: Record<string, number>, productId: string): number {
  return Object.entries(cart).reduce((total: number, [key, quantity]: [string, number]) => total + (parseCartKey(key).productId === productId ? quantity : 0), 0);
}

export function choiceNames(option: ProductOption | undefined, choiceIds: string[]): string {
  if (!option) return '';
  return choiceIds.map((id: string) => option.choices.find((choice: OptionChoice) => choice.id === id)?.name ?? '').filter(Boolean).join(' + ');
}

export async function fetchProductOptions(): Promise<ProductOptionMap> {
  const { data, error } = await supabase.rpc('get_nexora_product_options');
  // Si la migración de opciones aún no está aplicada, la carta sigue funcionando sin opciones.
  if (error || !Array.isArray(data)) return {};
  const map: ProductOptionMap = {};
  for (const option of data as ProductOption[]) map[option.product_id] = option;
  return map;
}

export function useProductOptions(): ProductOptionMap {
  const [options, setOptions] = useState<ProductOptionMap>({});
  useEffect(() => {
    let active = true;
    void fetchProductOptions().then((map: ProductOptionMap) => { if (active) setOptions(map); });
    return () => { active = false; };
  }, []);
  return options;
}
