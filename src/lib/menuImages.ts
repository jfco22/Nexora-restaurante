// Fotos del menú: viven en public/menu y se llaman igual que el producto ("Hamburguesa La Jornalera.jpg").
// Pensado para usarse sin React ni Supabase, así se puede probar solo.

export const MENU_IMAGE_DIR = '/menu/';
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/** Nombre de archivo que corresponde a un producto. Lo único que cambia es "/" -> "-", porque "/" no sirve en nombres de archivo. */
export function menuImageFileName(productName: string): string {
  return `${productName.normalize('NFC').trim().replace(/[\\/]/g, '-').replace(/\s+/g, ' ')}.jpg`;
}

export function menuImageUrl(fileName: string): string {
  return `${MENU_IMAGE_DIR}${encodeURIComponent(fileName.normalize('NFC'))}`;
}

function hasImageExtension(value: string): boolean {
  const lower = value.toLowerCase();
  return IMAGE_EXTENSIONS.some((extension: string) => lower.endsWith(extension));
}

/**
 * Decide qué dirección de foto guardar para un producto:
 * - una dirección completa (https://...) o que empieza con "/" se respeta tal cual;
 * - un nombre de archivo suelto ("chorizo.jpg") se busca en public/menu;
 * - si la celda está vacía, se busca la foto que se llama igual que el producto.
 * Devuelve '' cuando no hay foto.
 */
export function resolveMenuImage(value: string, productName: string, available: ReadonlySet<string>): string {
  const typed = value.trim();
  if (/^(https?:)?\/\//i.test(typed) || typed.startsWith('/') || typed.startsWith('data:')) return typed;
  if (typed !== '') {
    const withExtension = hasImageExtension(typed) ? typed : `${typed}.jpg`;
    return available.has(withExtension.normalize('NFC')) ? menuImageUrl(withExtension) : '';
  }
  const automatic = menuImageFileName(productName);
  return available.has(automatic) ? menuImageUrl(automatic) : '';
}

/** Lee la lista de fotos disponibles. Si no se puede leer, devuelve una lista vacía y el importador sigue sin fotos automáticas. */
export async function loadMenuImageList(): Promise<Set<string>> {
  try {
    const response = await fetch(`${MENU_IMAGE_DIR}manifest.json`, { cache: 'no-cache' });
    if (!response.ok) return new Set();
    const data: unknown = await response.json();
    return Array.isArray(data) ? new Set(data.filter((item): item is string => typeof item === 'string').map((item: string) => item.normalize('NFC'))) : new Set();
  } catch {
    return new Set();
  }
}
