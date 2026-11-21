import { Search } from 'lucide-react';

/** Texto en minúsculas y sin tildes, para que "limon" encuentre "Limón". */
export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function matchesSearch(name: string, query: string): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const target = normalizeSearch(name);
  return words.every((word: string) => target.includes(word));
}

type InventorySearchProps = { value: string; onChange: (value: string) => void; placeholder: string };

export function InventorySearch({ value, onChange, placeholder }: InventorySearchProps) {
  return (
    <label className="search-field inventory-search">
      <Search size={15} />
      <input type="search" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
