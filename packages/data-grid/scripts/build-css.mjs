// Ships dist/styles.css: Glide Data Grid's own CSS followed by the package's
// plain CSS (tds- classes that read @tetsustudio/tokens variables), so consumers
// need neither Tailwind nor a second import.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// Glide's index.css is a list of relative @imports: inline them so the shipped
// file stands alone.
const inline = (file) =>
  readFileSync(file, 'utf8').replace(/@import\s+["']([^"']+)["'];?/g, (_, rel) => inline(resolve(dirname(file), rel)));
const glide = inline(require.resolve('@glideapps/glide-data-grid/dist/index.css'));
const own = readFileSync(fileURLToPath(new URL('../src/styles/data-grid.css', import.meta.url)), 'utf8');
mkdirSync(fileURLToPath(new URL('../dist', import.meta.url)), { recursive: true });
writeFileSync(
  fileURLToPath(new URL('../dist/styles.css', import.meta.url)),
  `/* @glideapps/glide-data-grid (MIT) */\n${glide}\n/* @tetsustudio/data-grid */\n${own}`,
);
