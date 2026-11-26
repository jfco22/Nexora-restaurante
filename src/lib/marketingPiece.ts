/** Dibuja la pieza gráfica (post 1080x1350 o story 1080x1920) con canvas, sin servicios externos. */

export type PieceInput = { kind: 'post' | 'story'; headline: string; product: string; price: number; promo: number; validTo: string; photo?: HTMLImageElement | null };

const money = (v: number): string => `$${v.toLocaleString('es-CO')}`;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawPiece(canvas: HTMLCanvasElement, piece: PieceInput): void {
  const width = 1080;
  const height = piece.kind === 'story' ? 1920 : 1350;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#2b1810';
  ctx.fillRect(0, 0, width, height);

  // Zona de foto (o color liso si no hay foto)
  const photoH = piece.kind === 'story' ? 900 : 470;
  if (piece.photo && piece.photo.width > 0) {
    const scale = Math.max(width / piece.photo.width, photoH / piece.photo.height);
    const w = piece.photo.width * scale;
    const h = piece.photo.height * scale;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, width, photoH); ctx.clip();
    ctx.drawImage(piece.photo, (width - w) / 2, (photoH - h) / 2, w, h);
    ctx.restore();
  } else {
    const grad = ctx.createLinearGradient(0, 0, width, photoH);
    grad.addColorStop(0, '#d9593b'); grad.addColorStop(1, '#f0a04b');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, width, photoH);
  }

  // Cinta de oferta
  ctx.fillStyle = '#d9593b';
  ctx.fillRect(0, photoH - 70, width, 140);
  ctx.fillStyle = '#fff';
  ctx.font = '800 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`AHORRA ${money(piece.price - piece.promo)}`, width / 2, photoH + 18);

  // Nombre del plato
  ctx.fillStyle = '#fff4e6';
  ctx.font = '800 84px system-ui, sans-serif';
  const nameLines = wrap(ctx, piece.product.toUpperCase(), width - 160).slice(0, 3);
  let y = photoH + 200;
  for (const line of nameLines) { ctx.fillText(line, width / 2, y); y += 96; }

  // Precio anterior y promocional
  y += 20;
  ctx.fillStyle = '#d6b9a4';
  ctx.font = '600 54px system-ui, sans-serif';
  const oldText = money(piece.price);
  ctx.fillText(oldText, width / 2, y);
  const oldW = ctx.measureText(oldText).width;
  ctx.fillRect(width / 2 - oldW / 2, y - 20, oldW, 5);
  y += 150;
  ctx.fillStyle = '#ffd166';
  ctx.font = '900 150px system-ui, sans-serif';
  ctx.fillText(money(piece.promo), width / 2, y);

  // Vigencia y marca
  y += 90;
  ctx.fillStyle = '#fff4e6';
  ctx.font = '500 33px system-ui, sans-serif';
  const until = new Date(`${piece.validTo}T12:00:00-05:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'America/Bogota' });
  ctx.fillText(`Válido hasta el ${until} o hasta agotar existencias`, width / 2, y);
  ctx.font = '800 46px system-ui, sans-serif';
  ctx.fillStyle = '#f0a04b';
  ctx.fillText('El Taita · Iza, Boyacá', width / 2, height - 70);
}
