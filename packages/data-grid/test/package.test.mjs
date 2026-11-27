// The published shape: token theme mapping, server-renderable table/view,
// 'use client' banners kept, shipped CSS, and no app or Next coupling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { themeFromTokens, errorCellTheme, toRgb } from '../dist/theme/tokenTheme.js';
import { DataTable } from '../dist/table/DataTable.js';
import { DataView } from '../dist/view/DataView.js';

const dist = new URL('../dist/', import.meta.url).pathname;
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));

test('themeFromTokens maps tokens to plain rgb Glide colors', () => {
  const theme = themeFromTokens({
    colors: {
      '--background': [255, 255, 255, 1], '--foreground': [0, 0, 0, 1], '--surface': [250, 250, 250, 1],
      '--border': [224, 224, 224, 1], '--brand': [59, 130, 246, 1], '--brand-foreground': [255, 255, 255, 1],
      '--muted-foreground': [115, 115, 115, 1],
    },
    fontSans: 'Inter, sans-serif',
  });
  assert.equal(theme.bgCell, 'rgb(255, 255, 255)');
  assert.equal(theme.bgHeader, 'rgb(250, 250, 250)');
  assert.equal(theme.textDark, 'rgb(0, 0, 0)');
  assert.equal(theme.textMedium, 'rgb(115, 115, 115)');
  assert.equal(theme.borderColor, 'rgb(224, 224, 224)');
  assert.equal(theme.accentColor, 'rgb(59, 130, 246)');
  assert.equal(theme.accentFg, 'rgb(255, 255, 255)');
  assert.equal(theme.accentLight, 'rgba(59, 130, 246, 0.15)');
  assert.equal(theme.fontFamily, 'Inter, sans-serif');
  assert.deepEqual(themeFromTokens({ colors: {} }), {});
});

test('error cells mix the destructive tone into the background', () => {
  assert.deepEqual(errorCellTheme({ colors: { '--background': [255, 255, 255, 1], '--destructive': [239, 68, 68, 1] } }), { bgCell: 'rgb(252, 225, 225)' });
});

test('toRgb reads hex, rgb and oklch', () => {
  assert.deepEqual(toRgb('#f97316'), [249, 115, 22]);
  assert.deepEqual(toRgb('#fff'), [255, 255, 255]);
  assert.deepEqual(toRgb('rgb(1, 2, 3)'), [1, 2, 3]);
  const white = toRgb('oklch(1 0 0)');
  white.forEach((v) => assert.ok(Math.abs(v - 255) <= 1));
  assert.equal(toRgb('nope'), null);
});

test('DataTable renders rows, actions and the empty state on the server', () => {
  const columns = [{ header: 'Nombre', accessor: 'name' }];
  const html = renderToStaticMarkup(h(DataTable, { data: [{ id: 1, name: 'Molino' }], columns, onDelete: () => {} }));
  assert.match(html, /<th[^>]*>Nombre<\/th>/);
  assert.match(html, /<td[^>]*>Molino<\/td>/);
  assert.match(html, /aria-label="Eliminar"/);
  const empty = renderToStaticMarkup(h(DataTable, { data: [], columns, emptyText: 'Sin proveedores' }));
  assert.match(empty, /Sin proveedores/);
});

test('DataView mounts only the active view and marks it', () => {
  const html = renderToStaticMarkup(h(DataView, { view: 'sheet', onViewChange: () => {}, table: h('p', null, 'TABLE'), sheet: h('p', null, 'SHEET') }));
  assert.match(html, /SHEET/);
  assert.doesNotMatch(html, /TABLE/);
  assert.match(html, /aria-checked="true"[^>]*>Planilla</);
});

test("component entry files keep their 'use client' banner", () => {
  for (const f of ['index.js', 'grid/DataGrid.js', 'grid/GridSheet.js', 'table/DataTable.js', 'view/DataView.js', 'theme/useTokenTheme.js']) {
    assert.match(readFileSync(join(dist, f), 'utf8'), /^['"]use client['"];/, f);
  }
});

test('no next/*, import.meta.env or app imports in the output', () => {
  for (const f of files(dist).filter((p) => p.endsWith('.js'))) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /from ['"]next\//, f);
    assert.doesNotMatch(src, /import\.meta\.env/, f);
    const specifiers = [...src.matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const s of specifiers) {
      assert.ok(s.startsWith('.') || ['react', 'react/jsx-runtime', 'react-dom', 'zustand', '@glideapps/glide-data-grid'].includes(s), `${f}: ${s}`);
    }
  }
});

test('styles.css ships Glide CSS and the token-driven classes', () => {
  const css = readFileSync(join(dist, 'styles.css'), 'utf8');
  assert.match(css, /\.gdg-/);
  assert.match(css, /\.tds-grid\b/);
  assert.match(css, /var\(--brand/);
});

test('GridSheet server-renders its frame without touching window', async () => {
  const { renderToString } = await import('react-dom/server');
  const { createGridStore, GridSheet } = await import('../dist/index.js');
  const columns = [{ field: 'name', title: 'Nombre', width: 100, kind: 'text' }];
  const store = createGridStore({
    columns, emptyOptions: {}, rowFromApi: (r) => ({ key: String(r.id), id: r.id, version: r.version, values: r }),
    transport: { fetchAll: async () => ({ rows: [], options: {} }), patch: async () => {}, batch: async () => ({ results: [] }) },
  });
  const html = renderToString(h(GridSheet, { store, scopeId: 1, columns }));
  assert.match(html, /class="tds-grid"/);
  assert.match(html, /Todos los cambios guardados/);
});
