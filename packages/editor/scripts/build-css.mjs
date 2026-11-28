// Ships dist/styles.css: ProseMirror's and the gap cursor's base CSS followed
// by the package's plain CSS (ted- classes that read @tetsustudio/tokens
// variables), so consumers need neither Tailwind nor a second import.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// @milkdown/kit's CSS files are `@import`s of @milkdown/prose's: inline them
// so the shipped file stands alone.
const read = (specifier) =>
  readFileSync(fileURLToPath(import.meta.resolve(specifier)), 'utf8').replace(/@import\s+['"]([^'"]+)['"];?/g, (_, inner) => read(inner));
const prosemirror = read('@milkdown/kit/prose/view/style/prosemirror.css');
const gapcursor = read('@milkdown/kit/prose/gapcursor/style/gapcursor.css');
const own = readFileSync(fileURLToPath(new URL('../src/styles/editor.css', import.meta.url)), 'utf8');
mkdirSync(fileURLToPath(new URL('../dist', import.meta.url)), { recursive: true });
writeFileSync(
  fileURLToPath(new URL('../dist/styles.css', import.meta.url)),
  `/* prosemirror-view (MIT) */\n${prosemirror}\n/* prosemirror-gapcursor (MIT) */\n${gapcursor}\n/* @tetsustudio/editor */\n${own}`,
);
