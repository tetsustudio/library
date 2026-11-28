// Mounted in a DOM (jsdom): the collaborative editor seeds the Y.Doc once
// synced and hands out its API; the markdown editor round-trips markdown; the
// plain-text editor edits the same document through the bridge.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLImageElement', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'DOMParser', 'Text', 'DocumentFragment', 'KeyboardEvent', 'MouseEvent', 'Event', 'CustomEvent', 'InputEvent', 'Window', 'ClipboardEvent', 'DragEvent', 'FocusEvent', 'UIEvent', 'Selection', 'Range']) {
  if (!(key in globalThis) || key === 'window' || key === 'document' || key === 'navigator') {
    Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
  }
}
// Milkdown's timers dispatch Node's CustomEvent on the global event target
// (window in a browser): a Node EventTarget accepts them.
const bus = new EventTarget();
for (const key of ['addEventListener', 'removeEventListener', 'dispatchEvent']) globalThis[key] = bus[key].bind(bus);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const noRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} });
window.Range.prototype.getBoundingClientRect = noRect;
window.Range.prototype.getClientRects = () => [];
window.Element.prototype.scrollIntoView = () => {};

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React;
const Y = await import('yjs');
const { Awareness } = await import('y-protocols/awareness');
const { CollaborativeEditor, MarkdownEditor, PlainTextEditor, createMemoryStorage } = await import('../dist/index.js');
const h = React.createElement;
after(() => window.close());

const until = async (check, ms = 5000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await act(() => new Promise((r) => setTimeout(r, 20)));
  }
};

async function mount(element) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return { container, root, unmount: () => act(async () => root.unmount()) };
}

test('CollaborativeEditor waits for synced, seeds initialMarkdown into the Y.Doc and hands out its API', async (t) => {
  const doc = new Y.Doc();
  // Awareness runs an interval: destroyed even when the test fails, or it never exits.
  const awareness = new Awareness(doc);
  t.after(() => awareness.destroy());
  let api = null;
  const props = { doc, awareness, initialMarkdown: '# Seeded\n\nhello\n', onReady: (a) => (api = a), spellcheck: false, storage: createMemoryStorage() };
  const view = await mount(h(CollaborativeEditor, { ...props, status: 'connecting' }));
  await act(() => new Promise((r) => setTimeout(r, 100)));
  assert.equal(api, null);
  assert.equal(doc.getXmlFragment('prosemirror').length, 0);

  await act(async () => view.root.render(h(CollaborativeEditor, { ...props, status: 'synced' })));
  await until(() => api !== null);
  assert.equal(api.getMarkdown(), '# Seeded\n\nhello\n');
  assert.ok(doc.getXmlFragment('prosemirror').length > 0);
  assert.match(view.container.querySelector('.ProseMirror').innerHTML, /<h1[^>]*>Seeded/);

  // A remote update reaches the editor.
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  other.getXmlFragment('prosemirror').get(1).insert(0, [new Y.XmlText('remote ')]);
  await act(async () => Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc))));
  assert.equal(api.getMarkdown(), '# Seeded\n\nremote hello\n');

  await view.unmount();
  assert.equal(api, null);
});

test('MarkdownEditor reads initialMarkdown and reports changes through onMarkdownChange and its API', async () => {
  let api = null;
  const changes = [];
  const view = await mount(h(MarkdownEditor, { initialMarkdown: 'one\n', onReady: (a) => (api = a), onMarkdownChange: (md) => changes.push(md), spellcheck: false, storage: createMemoryStorage() }));
  await until(() => api !== null);
  assert.equal(api.getMarkdown(), 'one\n');
  await act(async () => api.replace([{ from: 4, to: 4, slice: api.parse('x two').slice(2, 6) }]));
  await until(() => changes.length > 0);
  assert.equal(api.getMarkdown(), 'one two\n');
  assert.equal(changes.at(-1), 'one two\n');
  await view.unmount();
});

test('PlainTextEditor shows the markdown and pushes typing into the visual editor', async () => {
  let api = null;
  const view = await mount(h(MarkdownEditor, { initialMarkdown: '# Notes\n\nfirst\n', onReady: (a) => (api = a), spellcheck: false, storage: createMemoryStorage() }));
  await until(() => api !== null);
  const plain = await mount(h(PlainTextEditor, { bridge: api }));
  const { EditorView } = await import('@codemirror/view');
  const cm = EditorView.findFromDOM(plain.container.querySelector('.cm-editor'));
  assert.equal(cm.state.doc.toString(), '# Notes\n\nfirst\n');
  await act(async () => cm.dispatch({ changes: { from: cm.state.doc.length - 1, insert: ' and more' } }));
  await act(() => new Promise((r) => setTimeout(r, 200)));
  assert.equal(api.getMarkdown(), '# Notes\n\nfirst and more\n');
  await plain.unmount();
  await view.unmount();
});

test('the spellchecker underlines a misspelled word once its dictionary loads from dictionaryBaseUrl', async () => {
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { createSpellcheck } = await import('../dist/index.js');
  const dir = dirname(fileURLToPath(import.meta.resolve('dictionary-es')));
  const urls = [];
  const spellcheck = createSpellcheck({
    storage: createMemoryStorage(),
    dictionaryBaseUrl: '/dicts',
    loadFile: async (url) => (urls.push(url), readFileSync(join(dir, url.split('/').pop()), 'utf8')),
  });
  const view = await mount(h(MarkdownEditor, { initialMarkdown: 'Un dia de sol\n', spellcheck, storage: createMemoryStorage() }));
  await until(() => view.container.querySelector('.ted-spell-error'), 10000);
  assert.deepEqual([...view.container.querySelectorAll('.ted-spell-error')].map((e) => e.textContent), ['dia']);
  assert.deepEqual(urls, ['/dicts/es/index.aff', '/dicts/es/index.dic']);
  // Turning it off clears the underline in the mounted editor.
  await act(async () => spellcheck.setEnabled(false));
  assert.equal(view.container.querySelector('.ted-spell-error'), null);
  await view.unmount();
});
