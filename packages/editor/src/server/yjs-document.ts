import * as Y from 'yjs';
import { initProseMirrorDoc, updateYFragment } from 'y-prosemirror';
import type { Node } from '@milkdown/kit/prose/model';
import { Mapping, Transform } from '@milkdown/kit/prose/transform';
import { structuralMap } from '../plain-text/structural-diff.js';
import { localReplacements } from '../plain-text/sync.js';
import type { MarkdownCodec } from './headless-markdown.js';

/** The Y.XmlFragment name @milkdown/plugin-collab binds the document to. */
export const COLLAB_FRAGMENT = 'prosemirror';

export type InvalidEditReason = 'empty' | 'not_found' | 'ambiguous';

export class InvalidEditError extends Error {
  constructor(
    message: string,
    readonly reason: InvalidEditReason,
    readonly count = 0,
  ) {
    super(message);
    this.name = 'InvalidEditError';
  }
}

/** A Y.Doc from a log of stored updates. */
export function docFromUpdates(updates: Uint8Array[]): Y.Doc {
  const ydoc = new Y.Doc();
  ydoc.transact(() => {
    for (const update of updates) Y.applyUpdate(ydoc, update);
  });
  return ydoc;
}

// An empty fragment (new document) gives a `doc` with no children, which the
// schema rejects and the serializer cannot write. The editor fills it with an
// empty paragraph; so does this.
function liveDocument(ydoc: Y.Doc, codec: MarkdownCodec) {
  const fragment = ydoc.getXmlFragment(COLLAB_FRAGMENT);
  const { doc, meta } = initProseMirrorDoc(fragment, codec.schema);
  const filled = doc.childCount === 0 ? codec.schema.topNodeType.createAndFill() : null;
  return { fragment, doc: filled ?? doc, meta };
}

/** The document and its markdown. */
export function readDocument(ydoc: Y.Doc, codec: MarkdownCodec): { doc: Node; markdown: string } {
  const { doc } = liveDocument(ydoc, codec);
  return { doc, markdown: codec.serialize(doc) };
}

/**
 * Writes `markdown` into the document only when it has no text yet, the same
 * rule the editor's first-open seeding uses (so a server write never hides
 * imported content). Returns whether it seeded. Two concurrent seeds duplicate
 * the content, as between two devices (known, not destructive).
 */
export function seedIfEmpty(ydoc: Y.Doc, codec: MarkdownCodec, markdown: string): boolean {
  if (!markdown.trim()) return false;
  const { fragment, doc, meta } = liveDocument(ydoc, codec);
  if (doc.textContent.length > 0) return false;
  const seeded = codec.parse(markdown);
  ydoc.transact(() => updateYFragment(ydoc, fragment, seeded, meta));
  return true;
}

/**
 * Changes the document's markdown and applies it as a minimal change (the same
 * spans plain-text mode sends), so untouched content stays identical in the
 * CRDT and merges with concurrent edits. `change` gets the current markdown and
 * returns the new one. Build the update to store with
 * `Y.encodeStateAsUpdate(ydoc, stateVectorBefore)`.
 */
export function applyMarkdown(ydoc: Y.Doc, codec: MarkdownCodec, change: (markdown: string) => string): { changed: boolean; markdown: string } {
  const { fragment, doc: live, meta } = liveDocument(ydoc, codec);
  const baseText = codec.serialize(live);
  const nextText = change(baseText);
  if (nextText === baseText) return { changed: false, markdown: baseText };
  const base = codec.parse(baseText);
  const next = codec.parse(nextText);
  const mapping = new Mapping([structuralMap(base, live)]);
  const tr = new Transform(live);
  for (const r of localReplacements(base, next, mapping)) tr.replace(r.from, r.to, r.slice);
  if (!tr.docChanged) return { changed: false, markdown: baseText };
  ydoc.transact(() => updateYFragment(ydoc, fragment, tr.doc, meta));
  return { changed: true, markdown: codec.serialize(tr.doc) };
}

/**
 * Replaces `search` with `replacement`. `search` must appear exactly once unless
 * `all`. Throws `InvalidEditError` with `reason` `empty`, `not_found` or `ambiguous`.
 */
export function replaceText(text: string, search: string, replacement: string, all = false): string {
  if (!search) throw new InvalidEditError('The text to replace cannot be empty.', 'empty');
  const count = text.split(search).length - 1;
  if (count === 0) throw new InvalidEditError('The text to replace was not found in the document.', 'not_found');
  if (count > 1 && !all) throw new InvalidEditError(`The text to replace appears ${count} times.`, 'ambiguous', count);
  return all ? text.split(search).join(replacement) : text.replace(search, () => replacement);
}

/** Appends a markdown block at the end, separated by one blank line. */
export function appendMarkdown(text: string, addition: string): string {
  const body = text.replace(/\s+$/, '');
  const extra = addition.replace(/^\s*\n/, '').replace(/\s+$/, '');
  if (!extra) return text;
  return body ? `${body}\n\n${extra}\n` : `${extra}\n`;
}
