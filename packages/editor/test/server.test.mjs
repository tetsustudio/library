// @tetsustudio/editor/server: the editor's schema without a DOM, markdown
// round trips, and the Y.Doc helpers server code uses to read and write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import {
  COLLAB_FRAGMENT,
  InvalidEditError,
  appendMarkdown,
  applyMarkdown,
  docFromUpdates,
  getMarkdownCodec,
  readDocument,
  replaceText,
  seedIfEmpty,
} from '../dist/server.js';

const SAMPLE = `# Title

Some **bold**, *italic*, \`code\` and a [link](https://example.com).

- one
- two
  - nested

1. first
2. second

- [ ] todo
- [x] done

> quoted

![no title](https://example.com/a.png)

| a | b |
| - | - |
| 1 | 2 |

\`\`\`js
const x = 1
\`\`\`
`;

test('runs without a DOM', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
});

test('the codec parses and serializes markdown and the round trip is stable', async () => {
  const codec = await getMarkdownCodec();
  assert.equal(await getMarkdownCodec(), codec);
  const doc = codec.parse(SAMPLE);
  const types = new Set();
  doc.descendants((n) => void types.add(n.type.name));
  for (const t of ['heading', 'paragraph', 'bullet_list', 'ordered_list', 'list_item', 'blockquote', 'image', 'table', 'code_block']) {
    assert.ok(types.has(t), `missing ${t}`);
  }
  const once = codec.serialize(doc);
  assert.equal(codec.serialize(codec.parse(once)), once);
  for (const fragment of ['# Title', '**bold**', '*italic*', '`code`', '[link](https://example.com)', '* [ ] todo', '* [x] done', '> quoted', '![no title](https://example.com/a.png)', '```js']) {
    assert.ok(once.includes(fragment), `missing ${fragment} in\n${once}`);
  }
  // Tight lists stay tight, an image without title gets no "" title.
  assert.doesNotMatch(once, /- one\n\n- two/);
  assert.doesNotMatch(once, /a\.png ""/);
});

test('seedIfEmpty writes only into an empty document', async () => {
  const codec = await getMarkdownCodec();
  const ydoc = new Y.Doc();
  assert.equal(readDocument(ydoc, codec).markdown.trim(), '');
  assert.equal(seedIfEmpty(ydoc, codec, '# Hello\n\nworld\n'), true);
  assert.equal(seedIfEmpty(ydoc, codec, '# Other\n'), false);
  assert.equal(readDocument(ydoc, codec).markdown, '# Hello\n\nworld\n');
  assert.ok(ydoc.getXmlFragment(COLLAB_FRAGMENT).length > 0);
});

test('applyMarkdown applies a minimal change that merges with a concurrent edit', async () => {
  const codec = await getMarkdownCodec();
  const a = new Y.Doc();
  seedIfEmpty(a, codec, 'first paragraph\n\nsecond paragraph\n');
  const b = docFromUpdates([Y.encodeStateAsUpdate(a)]);
  assert.equal(readDocument(b, codec).markdown, 'first paragraph\n\nsecond paragraph\n');

  const before = Y.encodeStateVector(a);
  const result = applyMarkdown(a, codec, (md) => md.replace('first', 'the first'));
  assert.deepEqual(result, { changed: true, markdown: 'the first paragraph\n\nsecond paragraph\n' });
  applyMarkdown(b, codec, (md) => md.replace('second paragraph', 'second paragraph, edited'));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, before));
  assert.equal(readDocument(a, codec).markdown, 'the first paragraph\n\nsecond paragraph, edited\n');
  assert.equal(readDocument(b, codec).markdown, readDocument(a, codec).markdown);
  assert.deepEqual(applyMarkdown(a, codec, (md) => md).changed, false);
});

test('replaceText and appendMarkdown', () => {
  assert.equal(replaceText('a b a', 'b', 'c'), 'a c a');
  assert.equal(replaceText('a b a', 'a', 'x', true), 'x b x');
  assert.equal(replaceText('cost $1', '$1', '$&'), 'cost $&');
  assert.throws(() => replaceText('a', '', 'x'), (e) => e instanceof InvalidEditError && e.reason === 'empty');
  assert.throws(() => replaceText('a', 'z', 'x'), (e) => e instanceof InvalidEditError && e.reason === 'not_found');
  assert.throws(() => replaceText('a a', 'a', 'x'), (e) => e instanceof InvalidEditError && e.reason === 'ambiguous' && e.count === 2);
  assert.equal(appendMarkdown('# T\n\n', '\nmore  \n'), '# T\n\nmore\n');
  assert.equal(appendMarkdown('', 'x'), 'x\n');
  assert.equal(appendMarkdown('keep', '   '), 'keep');
});

test('the server entry pulls in no React and no DOM-only module', () => {
  const seen = new Set();
  const visit = (url) => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const src = readFileSync(url, 'utf8');
    for (const [, spec] of src.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
      if (spec.startsWith('.')) visit(new URL(spec, url));
      else assert.ok(!/^(react|react-dom|@milkdown\/react|@codemirror|codemirror|@milkdown\/kit\/component)/.test(spec), `${url.pathname}: ${spec}`);
    }
  };
  visit(new URL('../dist/server.js', import.meta.url));
  assert.ok(seen.size > 3);
});
