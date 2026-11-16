// Lista las fotos de public/menu en public/menu/manifest.json.
// Se ejecuta solo antes de `npm run dev` y `npm run build`: para agregar una foto basta con copiarla a public/menu.
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'menu');
mkdirSync(dir, { recursive: true });
const files = readdirSync(dir)
  .filter((file) => /\.(jpe?g|png|webp)$/i.test(file))
  .map((file) => file.normalize('NFC'))
  .sort((a, b) => a.localeCompare(b, 'es'));
writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(files, null, 2)}\n`);
console.log(`menu/manifest.json: ${files.length} fotos`);
