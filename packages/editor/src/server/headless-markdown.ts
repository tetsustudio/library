import { Clock, Container, Ctx } from '@milkdown/kit/ctx';
import {
  commands,
  config,
  editorState,
  editorViewCtx,
  init,
  keymap,
  parser,
  parserCtx,
  ParserReady,
  pasteRule,
  schema,
  schemaCtx,
  serializer,
  serializerCtx,
  SerializerReady,
  type Editor,
} from '@milkdown/kit/core';
import type { Node, Schema } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { configureImageAttrs } from '../plugins/image-attrs.js';
import { configureListSpread } from '../plugins/list-spread.js';

/** Markdown in and out with exactly the schema the visual editor uses. */
export interface MarkdownCodec {
  schema: Schema;
  parse(markdown: string): Node;
  serialize(doc: Node): string;
}

// Milkdown's timers use the global addEventListener/dispatchEvent, which is
// `window` in a browser and missing in Node. A private bus is enough: only
// Milkdown listens and dispatches on it.
function ensureEventBus() {
  if (typeof globalThis.addEventListener === 'function') return;
  const bus = new EventTarget();
  Object.assign(globalThis, {
    addEventListener: bus.addEventListener.bind(bus),
    removeEventListener: bus.removeEventListener.bind(bus),
    dispatchEvent: bus.dispatchEvent.bind(bus),
  });
}

/** Builds a new codec. Most callers want the shared `getMarkdownCodec()`. */
export async function createMarkdownCodec(): Promise<MarkdownCodec> {
  ensureEventBus();
  const ctx = new Ctx(new Container(), new Clock());
  // Milkdown's internal editor plugins minus `editorView`, the only one that
  // needs a DOM. The visual editor's other plugins (handle, collapse...) are
  // view-only and do not change the schema; one that did would have to be
  // added here too, or the server would write nodes the editor cannot read.
  const plugins = [
    schema,
    parser,
    serializer,
    commands,
    keymap,
    pasteRule,
    editorState,
    init({} as Editor),
    config(async (c) => {
      configureListSpread(c);
      configureImageAttrs(c);
    }),
    ...commonmark,
    ...gfm,
  ];
  // The paragraph serializer looks at the last child of the editor's document.
  ctx.inject(editorViewCtx, { state: { doc: null } } as unknown as EditorView);
  const runs = plugins.map((plugin) => plugin(ctx.produce()));
  for (const run of runs) void run?.();
  await Promise.all([ctx.wait(ParserReady), ctx.wait(SerializerReady)]);

  const parseMarkdown = ctx.get(parserCtx);
  const serializeMarkdown = ctx.get(serializerCtx);
  return {
    schema: ctx.get(schemaCtx),
    parse: (markdown) => parseMarkdown(markdown),
    serialize: (doc) => {
      ctx.set(editorViewCtx, { state: { doc } } as unknown as EditorView);
      return serializeMarkdown(doc);
    },
  };
}

let instance: Promise<MarkdownCodec> | null = null;

/** The shared codec, built once per process (a failed build is retried next call). */
export function getMarkdownCodec(): Promise<MarkdownCodec> {
  instance ??= createMarkdownCodec().catch((error) => {
    instance = null;
    throw error;
  });
  return instance;
}
