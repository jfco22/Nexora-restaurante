// Detecta insumos "parecidos" a los que ya existen (ej. "Tomate" y "Tomate de guiso", "Champiñon" y "Champiñones")
// y cambios de unidad, para no duplicar insumos al importar. Sin React ni Supabase, para poder probarlo solo.

export type KnownItem = { id: string; name: string; unit: string; archived?: boolean };
export type NameEntry = { name: string; unit: string | null; rowNumber: number };

export type SimilarCandidate = { item: KnownItem; score: number; unitDiffers: boolean };
export type SimilarHit = {
  /** Clave normalizada del nombre del archivo; se usa para guardar la decisión. */
  key: string;
  name: string;
  unit: string | null;
  rows: number[];
  candidates: SimilarCandidate[];
};

export type UnitDifference = {
  key: string;
  name: string;
  item: KnownItem;
  fileUnit: string;
  /** true si se puede convertir (g↔kg, ml↔l): en recetas se convierte solo. */
  convertible: boolean;
  rows: number[];
};

/** 'new' = es distinto, crear nuevo; cualquier otro valor = id del insumo existente que se usará. */
export type NameDecision = 'new' | string;

const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'en', 'con', 'y', 'para', 'al']);

export function normalizeKey(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function tokens(value: string): string[] {
  return normalizeKey(value)
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .split(' ')
    .filter((token: string) => token !== '' && !STOPWORDS.has(token));
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (i === a.length && i === b.length) return true;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/** Dos palabras son "la misma" si son iguales, singular/plural, o difieren en una letra (palabras de 5+ letras). */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 4 && (long === `${short}s` || long === `${short}es`)) return true;
  return short.length >= 5 && editDistanceAtMostOne(a, b);
}

/** 0 a 1: qué tan parecidos son dos nombres. 1 = mismas palabras (en cualquier orden). */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const used = new Set<number>();
  let matched = 0;
  for (const word of ta) {
    const at = tb.findIndex((other: string, index: number) => !used.has(index) && sameWord(word, other));
    if (at >= 0) { used.add(at); matched += 1; }
  }
  if (matched === 0) return 0;
  const union = ta.length + tb.length - matched;
  const jaccard = matched / union;
  const containment = matched / Math.min(ta.length, tb.length);
  if (jaccard === 1) return 1;
  // Uno contiene al otro ("Tomate" dentro de "Tomate de guiso").
  if (containment === 1) return Math.max(0.8, jaccard);
  return jaccard >= 0.6 ? jaccard : 0;
}

const FAMILY: Record<string, string> = { g: 'mass', kg: 'mass', ml: 'volume', l: 'volume', unidad: 'count' };
export const unitsConvertible = (a: string, b: string): boolean => a === b || (FAMILY[a] !== undefined && FAMILY[a] === FAMILY[b]);

type Group = { key: string; name: string; unit: string | null; rows: number[] };

function groupEntries(entries: NameEntry[]): Group[] {
  const groups = new Map<string, Group>();
  for (const entry of entries) {
    const name = entry.name.trim();
    if (name === '') continue;
    const key = normalizeKey(name);
    const group = groups.get(key);
    if (!group) groups.set(key, { key, name, unit: entry.unit, rows: [entry.rowNumber] });
    else {
      group.rows.push(entry.rowNumber);
      if (group.unit === null && entry.unit) group.unit = entry.unit;
    }
  }
  return Array.from(groups.values());
}

/** Nombres del archivo que no existen tal cual pero se parecen a insumos existentes (activos o archivados). */
export function findSimilarNames(entries: NameEntry[], items: KnownItem[], limit = 3): SimilarHit[] {
  const exact = new Set(items.map((item: KnownItem) => normalizeKey(item.name)));
  const hits: SimilarHit[] = [];
  for (const group of groupEntries(entries)) {
    if (exact.has(group.key)) continue;
    const candidates = items
      .map((item: KnownItem): SimilarCandidate => ({ item, score: nameSimilarity(group.name, item.name), unitDiffers: group.unit !== null && group.unit !== item.unit }))
      .filter((candidate: SimilarCandidate) => candidate.score > 0)
      .sort((x: SimilarCandidate, y: SimilarCandidate) => y.score - x.score || Number(Boolean(x.item.archived)) - Number(Boolean(y.item.archived)))
      .slice(0, limit);
    if (candidates.length > 0) hits.push({ key: group.key, name: group.name, unit: group.unit, rows: group.rows, candidates });
  }
  return hits;
}

/** Nombres que SÍ existen tal cual pero el archivo los trae en otra unidad. */
export function findUnitDifferences(entries: NameEntry[], items: KnownItem[]): UnitDifference[] {
  const byKey = new Map(items.map((item: KnownItem) => [normalizeKey(item.name), item]));
  const result: UnitDifference[] = [];
  for (const group of groupEntries(entries)) {
    const item = byKey.get(group.key);
    if (!item || group.unit === null || group.unit === item.unit) continue;
    result.push({ key: group.key, name: group.name, item, fileUnit: group.unit, convertible: unitsConvertible(group.unit, item.unit), rows: group.rows });
  }
  return result;
}

/** Nombre que se usará para cada nombre del archivo según lo decidido (solo cambia los marcados "es el mismo"). */
export function resolveName(name: string, decisions: Record<string, NameDecision>, items: KnownItem[]): string {
  const decision = decisions[normalizeKey(name)];
  if (!decision || decision === 'new') return name;
  return items.find((item: KnownItem) => item.id === decision)?.name ?? name;
}

/** Cuántos nombres parecidos faltan por decidir. */
export function pendingDecisions(hits: SimilarHit[], decisions: Record<string, NameDecision>): number {
  return hits.filter((hit: SimilarHit) => decisions[hit.key] === undefined).length;
}
