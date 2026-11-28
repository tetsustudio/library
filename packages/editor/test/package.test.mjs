// The published shape: 'use client' banners, shipped CSS, labels, server
// rendering, and no app or Next coupling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultLabels, esLabels, resolveLabels } from '../dist/labels.js';
import { createMemoryStorage } from '../dist/storage.js';

const dist = new URL('../dist/', import.meta.url).pathname;
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test("component entry files keep their 'use client' banner", () => {
  for (const f of ['index.js', 'components/CollaborativeEditor.js', 'components/MarkdownEditor.js', 'components/EditorShell.js', 'components/EditorToolbar.js', 'components/SearchBar.js', 'components/ImageLightbox.js', 'components/SpellcheckSettings.js', 'plain-text/PlainTextEditor.js']) {
    assert.match(readFileSync(join(dist, f), 'utf8'), /^['"]use client['"];/, f);
  }
  assert.doesNotMatch(readFileSync(join(dist, 'server.js'), 'utf8'), /use client/);
});

test('no next/*, process.env, import.meta.env or app imports; relative imports carry .js', () => {
  const allowed = new Set([...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)]);
  for (const f of files(dist).filter((p) => p.endsWith('.js'))) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /process\.env/, f);
    assert.doesNotMatch(src, /import\.meta\.env/, f);
    for (const [, spec] of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      assert.ok(!spec.startsWith('next/') && !spec.startsWith('@/'), `${f}: ${spec}`);
      if (spec.startsWith('.')) {
        assert.match(spec, /\.js$/, `${f}: ${spec}`);
        continue;
      }
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      assert.ok(allowed.has(name), `${f}: ${spec} is not a declared dependency`);
    }
  }
});

test('styles.css ships ProseMirror base CSS and token-driven ted- classes', () => {
  const css = readFileSync(join(dist, 'styles.css'), 'utf8');
  assert.match(css, /\.ProseMirror\s*\{/);
  assert.match(css, /\.ProseMirror-gapcursor/);
  assert.match(css, /\.ted-editor\b/);
  assert.match(css, /var\(--brand/);
  assert.match(css, /var\(--foreground/);
  assert.doesNotMatch(css, /@tailwind|@apply/);
});

test('esLabels translates every label; overrides merge over English defaults', () => {
  assert.deepEqual(Object.keys(esLabels).sort(), Object.keys(defaultLabels).sort());
  assert.equal(esLabels.searchCount(2, 5), '2 de 5');
  assert.equal(defaultLabels.searchCount(2, 5), '2 of 5');
  const merged = resolveLabels({ bold: 'Fett' });
  assert.equal(merged.bold, 'Fett');
  assert.equal(merged.italic, 'Italic');
});

test('SpellcheckSettings renders on the server with Spanish labels and stored settings', async () => {
  const { SpellcheckSettings } = await import('../dist/components/SpellcheckSettings.js');
  const storage = createMemoryStorage({ 'tetsu-editor-spellcheck-ignored-es': '["Tetsu"]' });
  assert.equal(renderToStaticMarkup(h(SpellcheckSettings, { open: false, onClose() {}, storage })), '');
  const html = renderToStaticMarkup(h(SpellcheckSettings, { open: true, onClose() {}, storage, labels: esLabels }));
  assert.match(html, /Ortografía/);
  assert.match(html, /Español \(Latinoamérica\)/);
  assert.match(html, /role="switch"/);
});

test('EditorToolbar shows the image button only with an uploadImage adapter', async () => {
  const { EditorToolbar } = await import('../dist/components/EditorToolbar.js');
  const without = renderToStaticMarkup(h(EditorToolbar, { getEditor: () => undefined }));
  assert.match(without, /aria-label="Bold"/);
  assert.doesNotMatch(without, /Insert image/);
  const withUpload = renderToStaticMarkup(h(EditorToolbar, { getEditor: () => undefined, uploadImage: async () => ({ url: '' }), labels: esLabels, onOpenOutline() {} }));
  assert.match(withUpload, /aria-label="Insertar imagen"/);
  assert.match(withUpload, /aria-label="Índice"/);
});

test('MarkdownEditor and CollaborativeEditor render their frame on the server', async () => {
  const Y = await import('yjs');
  const { Awareness } = await import('y-protocols/awareness');
  const { MarkdownEditor, CollaborativeEditor } = await import('../dist/index.js');
  const local = renderToStaticMarkup(h(MarkdownEditor, { initialMarkdown: '# Hi', storage: createMemoryStorage() }));
  assert.match(local, /class="ted-editor"/);
  assert.match(local, /class="ted-toolbar"/);
  const doc = new Y.Doc();
  // Awareness runs an interval: destroyed below or the test never exits.
  const awareness = new Awareness(doc);
  const collab = renderToStaticMarkup(h(CollaborativeEditor, { doc, awareness, status: 'connecting', selfScroll: true, toolbar: false, storage: createMemoryStorage() }));
  awareness.destroy();
  doc.destroy();
  assert.match(collab, /ted-editor--self-scroll/);
  assert.doesNotMatch(collab, /ted-toolbar/);
});
