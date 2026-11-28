// Headless entry: no DOM, no React. The editor's schema, markdown codec and
// Y.Doc helpers for server code (an API or MCP tool that reads or writes a
// collaborative document).
export { createMarkdownCodec, getMarkdownCodec, type MarkdownCodec } from './server/headless-markdown.js';
export {
  COLLAB_FRAGMENT,
  InvalidEditError,
  appendMarkdown,
  applyMarkdown,
  docFromUpdates,
  readDocument,
  replaceText,
  seedIfEmpty,
  type InvalidEditReason,
} from './server/yjs-document.js';
export { configureImageAttrs } from './plugins/image-attrs.js';
export { configureListSpread } from './plugins/list-spread.js';
export { localChangeSpans, structuralMap, structuralRange, type ChangeRange, type ChangeSpan } from './plain-text/structural-diff.js';
export { localReplacements, type Replacement } from './plain-text/sync.js';
export { slugify } from './lib/slugify.js';
export { isSafeUrl } from './lib/safe-url.js';
