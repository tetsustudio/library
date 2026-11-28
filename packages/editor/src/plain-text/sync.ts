import type { Node, Slice } from '@milkdown/kit/prose/model';
import { Mapping } from '@milkdown/kit/prose/transform';
import { localChangeSpans, structuralMap } from './structural-diff.js';
import { rebaseRemote, type TextChange } from './line-rebase.js';

export interface Replacement {
  from: number;
  to: number;
  slice: Slice;
}

/**
 * What changed from `base` to `next`, carried onto the current document with
 * `mapping` (from `base` to the document), in reverse order so it applies back
 * to front without recomputing positions. A non-empty span maps inward: a
 * remote change right at an edge stays outside and content the user never saw
 * is not deleted. If the remote change swallowed the span, the user's text is
 * inserted anyway: neither side is lost.
 */
export function localReplacements(base: Node, next: Node, mapping: Mapping): Replacement[] {
  return localChangeSpans(base, next)
    .reverse()
    .map((s): Replacement => {
      const slice = next.slice(s.fromB, s.toB);
      if (s.toA === s.fromA) {
        const pos = mapping.map(s.fromA, -1);
        return { from: pos, to: pos, slice };
      }
      const from = mapping.map(s.fromA, 1);
      return { from, to: Math.max(from, mapping.map(s.toA, -1)), slice };
    });
}

/** The document as the visual editor bound to it has it. `onReady` hands one out. */
export interface DocumentBridge {
  getDoc(): Node;
  parse(markdown: string): Node;
  serialize(doc: Node): string;
  /**
   * Applies own replacements in one transaction, in the given order (back to
   * front). Its changes do not come back through `onDocChange`.
   */
  replace(replacements: Replacement[]): void;
  /** Reports every document change that did not come from `replace`. Returns the unsubscribe. */
  onDocChange(listener: (before: Node, after: Node) => void): () => void;
}

/** The plain text the user edits. */
export interface TextBuffer {
  getText(): string;
  /** Applies changes coming from the document without them coming back as local edits. */
  applyRemote(changes: TextChange[]): void;
}

export interface Timer {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

const realTimer: Timer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export interface PlainTextSync {
  /** The user changed the text. Pushed to the document after a pause. */
  localChange(): void;
  /** Pushes what is pending now: on blur, on mode switch, on leave. */
  flush(): void;
  destroy(): void;
}

/**
 * Keeps the plain text and the document in sync both ways while others edit
 * the same document. Local edits are diffed against what the text stood for
 * last time (`base`) and applied as minimal replacements at the equivalent
 * position of the current document; `mapping` carries `base` positions
 * through the remote changes since. Remote changes come into the text with
 * `rebaseRemote`, never over a pending local edit: local first, then remote.
 */
export function createPlainTextSync({
  bridge,
  buffer,
  delayMs,
  timer = realTimer,
  onError,
}: {
  bridge: DocumentBridge;
  buffer: TextBuffer;
  delayMs: number;
  timer?: Timer;
  /** A local change did not apply and the text went back to what the document says. */
  onError?: (error: unknown) => void;
}): PlainTextSync {
  let baseText = buffer.getText();
  let base = bridge.parse(baseText);
  let baseSerialized: string | null = null;
  let mapping = new Mapping([structuralMap(base, bridge.getDoc())]);
  let pending = false;
  let remoteDirty = false;
  let timeout: unknown = null;

  function rebase(text: string) {
    baseText = text;
    base = bridge.parse(text);
    baseSerialized = null;
    mapping = new Mapping([structuralMap(base, bridge.getDoc())]);
  }

  function pullRemote() {
    remoteDirty = false;
    const remote = bridge.serialize(bridge.getDoc());
    baseSerialized ??= bridge.serialize(base);
    if (remote === baseSerialized) return;
    const changes = rebaseRemote(baseSerialized, buffer.getText(), remote);
    if (changes.length > 0) buffer.applyRemote(changes);
    rebase(buffer.getText());
  }

  // When a replacement does not fit, the text goes back to the document: what
  // was typed since the last flush is lost, but a text that no longer matches
  // would make every later flush fail the same way.
  function resync(error: unknown) {
    const remote = bridge.serialize(bridge.getDoc());
    const current = buffer.getText();
    if (remote !== current) buffer.applyRemote(rebaseRemote(current, current, remote));
    rebase(buffer.getText());
    onError?.(error);
  }

  function flush() {
    if (timeout !== null) {
      timer.clear(timeout);
      timeout = null;
    }
    if (!pending) return;
    pending = false;
    const text = buffer.getText();
    if (text !== baseText) {
      const next = bridge.parse(text);
      const replacements = localReplacements(base, next, mapping);
      if (replacements.length > 0) {
        try {
          bridge.replace(replacements);
        } catch (error) {
          resync(error);
          return;
        }
      }
      baseText = text;
      base = next;
      baseSerialized = null;
      mapping = new Mapping([structuralMap(base, bridge.getDoc())]);
    }
    if (remoteDirty) pullRemote();
  }

  const unsubscribe = bridge.onDocChange((before, after) => {
    mapping.appendMap(structuralMap(before, after));
    remoteDirty = true;
    if (!pending) pullRemote();
  });

  return {
    localChange() {
      pending = true;
      if (timeout !== null) timer.clear(timeout);
      timeout = timer.set(() => {
        timeout = null;
        flush();
      }, delayMs);
    },
    flush,
    destroy() {
      if (timeout !== null) timer.clear(timeout);
      timeout = null;
      unsubscribe();
    },
  };
}

export type { TextChange };
