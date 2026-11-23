export type OfflineMethod = 'cash' | 'card';

export type OfflineSaleItem = { product_id: string; quantity: number; choices?: string[] };

/** Línea para mostrar en pantalla qué se vendió (el servidor calcula precios al sincronizar). */
export type OfflineSaleLine = { name: string; quantity: number; unit_price: number };

export type OfflineSale = {
  clientId: string;
  items: OfflineSaleItem[];
  lines: OfflineSaleLine[];
  method: OfflineMethod;
  total: number;
  occurredAt: string;
  status: 'pending' | 'failed';
  /** Por qué falló o por qué todavía no sube. */
  message: string | null;
  attempts: number;
};

export const methodLabel: Record<OfflineMethod, string> = { cash: 'Efectivo', card: 'Tarjeta' };

const KEY = 'nexora.offline.sales.v1';

type StoreLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StoreLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const isSale = (value: unknown): value is OfflineSale => {
  if (typeof value !== 'object' || value === null) return false;
  const sale = value as Record<string, unknown>;
  return typeof sale.clientId === 'string' && Array.isArray(sale.items) && typeof sale.occurredAt === 'string'
    && (sale.method === 'cash' || sale.method === 'card') && typeof sale.total === 'number';
};

/** Ventas guardadas en este equipo, de la más antigua a la más reciente. */
export function listSales(storage: StoreLike | null = defaultStorage()): OfflineSale[] {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSale).sort((a: OfflineSale, b: OfflineSale) => a.occurredAt.localeCompare(b.occurredAt));
  } catch {
    return [];
  }
}

/** Devuelve false si no se pudo guardar (almacenamiento lleno o bloqueado): la caja debe avisarlo, no vender "en el aire". */
export function saveSales(sales: OfflineSale[], storage: StoreLike | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(KEY, JSON.stringify(sales));
    return true;
  } catch {
    return false;
  }
}

export function addSale(sale: OfflineSale, storage: StoreLike | null = defaultStorage()): boolean {
  const current = listSales(storage);
  if (current.some((item: OfflineSale) => item.clientId === sale.clientId)) return true;
  return saveSales([...current, sale], storage);
}

export function updateSale(clientId: string, patch: Partial<OfflineSale>, storage: StoreLike | null = defaultStorage()): void {
  saveSales(listSales(storage).map((sale: OfflineSale) => (sale.clientId === clientId ? { ...sale, ...patch } : sale)), storage);
}

/** Borra la venta del equipo (ya sincronizada o descartada), liberando el espacio. */
export function removeSale(clientId: string, storage: StoreLike | null = defaultStorage()): void {
  saveSales(listSales(storage).filter((sale: OfflineSale) => sale.clientId !== clientId), storage);
}

export function newClientId(): string {
  const cryptoApi = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  // Respaldo para navegadores viejos: UUID v4 con getRandomValues o Math.random.
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte: number) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
