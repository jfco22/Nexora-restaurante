/** Textos de las piezas. Se arman con plantillas (sin servicios externos) y siempre se pueden editar antes de aprobar. */

export type CopyInput = { product: string; price: number; promo: number; validTo: string };

const money = (v: number): string => `$${v.toLocaleString('es-CO')}`;
const dayLabel = (iso: string): string =>
  new Date(`${iso}T12:00:00-05:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' });

const hash = (text: string): number => { let h = 0; for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
const pick = <T,>(list: T[], seed: string): T => list[hash(seed) % list.length];

export function buildPostCopy(input: CopyInput): { headline: string; caption: string } {
  const { product, price, promo, validTo } = input;
  const save = price - promo;
  const headline = pick([`${product} en promo`, `Hoy te toca ${product}`, `${product} más barato`], product + validTo);
  const opening = pick([
    `🔥 ${product} a ${money(promo)}.`,
    `¡Antojo aprobado! ${product} a solo ${money(promo)}.`,
    `Hoy en El Taita: ${product} a ${money(promo)}.`,
  ], validTo + product);
  const caption = [
    opening,
    `Antes ${money(price)}, ahora ${money(promo)}: te ahorras ${money(save)}.`,
    `Válido hasta el ${dayLabel(validTo)} o hasta agotar existencias.`,
    '📍 Iza, Boyacá · Restaurante El Taita',
    '',
    '#ElTaita #Iza #Boyacá #ComidaBoyacense #Promo #Antojo',
  ].join('\n');
  return { headline, caption };
}

export function buildStoryCopy(input: CopyInput): { headline: string; caption: string } {
  const { product, price, promo, validTo } = input;
  const headline = `${product} ${money(promo)}`;
  const caption = [`¡Promo! ${product} a ${money(promo)} (antes ${money(price)}).`, `Hasta el ${dayLabel(validTo)}.`, 'Escríbenos o pasa por El Taita, Iza 📍'].join('\n');
  return { headline, caption };
}

/** Respuestas rápidas para comentarios y mensajes sobre una promoción. Se copian y pegan. */
export function quickReplies(input: CopyInput): { question: string; answer: string }[] {
  const { product, promo, validTo } = input;
  return [
    { question: '¿Cuánto cuesta?', answer: `¡Hola! ${product} está en promoción a ${money(promo)} 😊` },
    { question: '¿Hasta cuándo es la promo?', answer: `Está vigente hasta el ${dayLabel(validTo)} o hasta agotar existencias.` },
    { question: '¿Dónde están?', answer: 'Estamos en Iza, Boyacá. ¡Te esperamos en El Taita! 📍' },
    { question: 'Comentario de agradecimiento', answer: '¡Gracias por tu mensaje! Nos alegra que te guste. Te esperamos pronto en El Taita 🧡' },
  ];
}
