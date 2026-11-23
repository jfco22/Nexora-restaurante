/**
 * Copia local de lo último que la app pudo cargar (carta, opciones, caja, perfil),
 * para poder seguir trabajando cuando se cae el internet.
 * Todo está en try/catch: si el navegador bloquea el almacenamiento, la app sigue funcionando sin copia.
 */
const PREFIX = 'nexora.cache.';

export function writeCache<T>(key: string, value: T, storage: Pick<Storage, 'setItem'> | null = defaultStorage()): void {
  try {
    storage?.setItem(PREFIX + key, JSON.stringify({ savedAt: new Date().toISOString(), value }));
  } catch {
    /* sin almacenamiento disponible: no pasa nada */
  }
}

export function readCache<T>(key: string, storage: Pick<Storage, 'getItem'> | null = defaultStorage()): { value: T; savedAt: string } | null {
  try {
    const raw = storage?.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: unknown; value?: unknown };
    if (typeof parsed.savedAt !== 'string' || parsed.value === undefined) return null;
    return { value: parsed.value as T, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
