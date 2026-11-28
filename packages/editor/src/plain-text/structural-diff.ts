import { Mark, type Fragment, type Node } from '@milkdown/kit/prose/model';
import { StepMap, Transform } from '@milkdown/kit/prose/transform';
import { diffSequences } from './line-rebase.js';

export interface ChangeRange {
  /** Where the documents start to differ, the same in both. */
  from: number;
  /** End of the changed range in the old document. */
  toA: number;
  /** End of the changed range in the new document. */
  toB: number;
}

// A non-text inline node takes one position, like a character.
const INLINE_PLACEHOLDER = '￼';

function inlineContent(textblock: Node): string {
  let out = '';
  textblock.forEach((child) => {
    out += child.isText ? (child.text ?? '') : INLINE_PLACEHOLDER;
  });
  return out;
}

// Compares only what defines positions: node type, text and tree shape. Marks
// and attrs change no sizes, and comparing them makes two documents with the
// same text differ everywhere (a heading's `id`, a bold split differently).
function structuralStart(a: Fragment, b: Fragment, pos: number): number | null {
  for (let i = 0; ; i++) {
    if (i === a.childCount || i === b.childCount) return a.childCount === b.childCount ? null : pos;
    const childA = a.child(i);
    const childB = b.child(i);
    if (childA === childB) {
      pos += childA.nodeSize;
      continue;
    }
    if (childA.type.name !== childB.type.name) return pos;
    if (childA.isTextblock) {
      const textA = inlineContent(childA);
      const textB = inlineContent(childB);
      if (textA !== textB) {
        let j = 0;
        while (j < textA.length && j < textB.length && textA[j] === textB[j]) j++;
        return pos + 1 + j;
      }
    } else if (!childA.isLeaf) {
      const inside = structuralStart(childA.content, childB.content, pos + 1);
      if (inside !== null) return inside;
    }
    pos += childA.nodeSize;
  }
}

function structuralEnd(a: Fragment, b: Fragment, posA: number, posB: number): { a: number; b: number } | null {
  for (let iA = a.childCount, iB = b.childCount; ; ) {
    if (iA === 0 || iB === 0) return iA === iB ? null : { a: posA, b: posB };
    const childA = a.child(--iA);
    const childB = b.child(--iB);
    if (childA === childB) {
      posA -= childA.nodeSize;
      posB -= childB.nodeSize;
      continue;
    }
    if (childA.type.name !== childB.type.name) return { a: posA, b: posB };
    if (childA.isTextblock) {
      const textA = inlineContent(childA);
      const textB = inlineContent(childB);
      if (textA !== textB) {
        let k = 0;
        while (k < textA.length && k < textB.length && textA[textA.length - 1 - k] === textB[textB.length - 1 - k]) k++;
        return { a: posA - 1 - k, b: posB - 1 - k };
      }
    } else if (!childA.isLeaf) {
      const inside = structuralEnd(childA.content, childB.content, posA - 1, posB - 1);
      if (inside) return inside;
    }
    posA -= childA.nodeSize;
    posB -= childB.nodeSize;
  }
}

// When the change repeats its neighbor ("aa" -> "aaa"), start and end are
// computed separately and cross. The end moves so the range is well formed.
function fixCrossing(from: number, toA: number, toB: number): ChangeRange {
  const overlap = from - Math.min(toA, toB);
  if (overlap > 0) {
    toA += overlap;
    toB += overlap;
  }
  return { from, toA, toB };
}

/** The range that differs between two documents, ignoring marks and attrs. */
export function structuralRange(a: Node, b: Node): ChangeRange | null {
  const from = structuralStart(a.content, b.content, 0);
  if (from === null) return null;
  const end = structuralEnd(a.content, b.content, a.content.size, b.content.size);
  if (!end) return null;
  return fixCrossing(from, end.a, end.b);
}

export interface ChangeSpan {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

// Attrs the editor derives from something else, which can differ between the
// live document and a freshly parsed one with nobody changing them. Same rule
// as Milkdown's own diff (`@milkdown/plugin-diff`).
const DERIVED_ATTRS: Record<string, string[]> = { heading: ['id'] };

function sameAttrs(a: Node, b: Node): boolean {
  const ignore = DERIVED_ATTRS[a.type.name] ?? [];
  for (const key of Object.keys({ ...a.attrs, ...b.attrs })) {
    if (ignore.includes(key)) continue;
    if (JSON.stringify(a.attrs[key]) !== JSON.stringify(b.attrs[key])) return false;
  }
  return true;
}

function equal(a: Node, b: Node): boolean {
  if (a === b) return true;
  if (a.type !== b.type || !sameAttrs(a, b)) return false;
  if (a.isText) return a.text === b.text && Mark.sameSet(a.marks, b.marks);
  if (!Mark.sameSet(a.marks, b.marks) || a.childCount !== b.childCount) return false;
  for (let i = 0; i < a.childCount; i++) if (!equal(a.child(i), b.child(i))) return false;
  return true;
}

function children(node: Node): Node[] {
  const list: Node[] = [];
  node.forEach((child) => list.push(child));
  return list;
}

function fullRange(a: Fragment, b: Fragment): ChangeRange | null {
  const from = a.findDiffStart(b);
  if (from === null) return null;
  const end = a.findDiffEnd(b);
  if (!end) return null;
  return fixCrossing(from, end.a, end.b);
}

// A textblock's change word by word, so two separate edits in one paragraph do
// not take what lies between them. When that does not reach the new textblock
// (a mark changed over untouched text, like closing a `*`), the full content range.
function inlineSpans(a: Node, b: Node, startA: number, startB: number, out: ChangeSpan[]) {
  const textA = inlineContent(a);
  const textB = inlineContent(b);
  if (textA !== textB) {
    const wordsA = textA.match(/\s+|\S+/g) ?? [];
    const wordsB = textB.match(/\s+|\S+/g) ?? [];
    const offsetsA = [0];
    for (const w of wordsA) offsetsA.push(offsetsA[offsetsA.length - 1]! + w.length);
    const offsetsB = [0];
    for (const w of wordsB) offsetsB.push(offsetsB[offsetsB.length - 1]! + w.length);
    const spans = diffSequences(wordsA, wordsB).map((s) => ({
      fromA: offsetsA[s.aFrom]!,
      toA: offsetsA[s.aTo]!,
      fromB: offsetsB[s.bFrom]!,
      toB: offsetsB[s.bTo]!,
    }));
    // With the textblock as root, positions are already those of its content.
    const result = new Transform(a);
    for (const s of [...spans].reverse()) result.replace(s.fromA, s.toA, b.slice(s.fromB, s.toB));
    if (equal(result.doc, b)) {
      for (const s of spans) out.push({ fromA: startA + s.fromA, toA: startA + s.toA, fromB: startB + s.fromB, toB: startB + s.toB });
      return;
    }
  }
  const range = fullRange(a.content, b.content);
  if (range) out.push({ fromA: startA + range.from, toA: startA + range.toA, fromB: startB + range.from, toB: startB + range.toB });
}

// The children of two nodes of the same type: equal ones align; in each run
// of different ones, same-type children pair one to one and are compared
// inside. So a list (one block) with two edited items is not replaced whole.
function childSpans(a: Node, b: Node, startA: number, startB: number, out: ChangeSpan[]) {
  const childrenA = children(a);
  const childrenB = children(b);
  const posA = [startA];
  for (const c of childrenA) posA.push(posA[posA.length - 1]! + c.nodeSize);
  const posB = [startB];
  for (const c of childrenB) posB.push(posB[posB.length - 1]! + c.nodeSize);

  const pair = (i: number, j: number) => {
    const nA = childrenA[i]!;
    const nB = childrenB[j]!;
    if (equal(nA, nB)) return;
    if (!sameAttrs(nA, nB) || nA.isLeaf) out.push({ fromA: posA[i]!, toA: posA[i + 1]!, fromB: posB[j]!, toB: posB[j + 1]! });
    else if (nA.isTextblock) inlineSpans(nA, nB, posA[i]! + 1, posB[j]! + 1, out);
    else childSpans(nA, nB, posA[i]! + 1, posB[j]! + 1, out);
  };

  const key = (n: Node) => JSON.stringify(n.toJSON());
  const type = (n: Node) => n.type.name;
  for (const s of diffSequences(childrenA.map(key), childrenB.map(key))) {
    let i = s.aFrom;
    let j = s.bFrom;
    const byType = diffSequences(childrenA.slice(s.aFrom, s.aTo).map(type), childrenB.slice(s.bFrom, s.bTo).map(type));
    for (const u of byType) {
      for (; i < s.aFrom + u.aFrom; i++, j++) pair(i, j);
      out.push({ fromA: posA[s.aFrom + u.aFrom]!, toA: posA[s.aFrom + u.aTo]!, fromB: posB[s.bFrom + u.bFrom]!, toB: posB[s.bFrom + u.bTo]! });
      i = s.aFrom + u.aTo;
      j = s.bFrom + u.bTo;
    }
    for (; i < s.aTo; i++, j++) pair(i, j);
  }
}

/**
 * The spans that changed between what the plain text stood for and what it
 * stands for now, in order. Several rather than one: with edits in several
 * places before a flush, a single range would also cover the middle and erase
 * whatever someone else wrote there. If applying them to `before` does not
 * give `after`, ProseMirror's full diff is used, always right if wider.
 */
export function localChangeSpans(before: Node, after: Node): ChangeSpan[] {
  const spans: ChangeSpan[] = [];
  childSpans(before, after, 0, 0, spans);
  const result = new Transform(before);
  for (const s of [...spans].reverse()) result.replace(s.fromA, s.toA, after.slice(s.fromB, s.toB));
  if (equal(result.doc, after)) return spans;
  const range = fullRange(before.content, after.content);
  return range ? [{ fromA: range.from, toA: range.toA, fromB: range.from, toB: range.toB }] : [];
}

/** How positions of `a` shift to land in `b`. */
export function structuralMap(a: Node, b: Node): StepMap {
  const range = structuralRange(a, b);
  if (!range) return StepMap.empty;
  return new StepMap([range.from, range.toA - range.from, range.toB - range.from]);
}
