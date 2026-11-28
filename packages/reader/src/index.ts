export { Reader, PdfReader, EpubReader, type AutoReaderProps } from './reader.js'
export { DEFAULT_LABELS, format, formatRelativeTime, type ReaderLabels, type ReaderLabelKey } from './labels.js'
export { TranslateUnconfiguredError } from './lib/translate.js'
export { DEFAULT_ASSET_BASE_URL, resolveAssetUrls, type ReaderAssetUrls } from './lib/assets.js'
export { detectFormat } from './lib/format.js'
export {
  decideInitialPosition,
  pageFromLocator,
  pageLocator,
  pagePercent,
  parseCacheEntry,
  serializeCacheEntry,
  type CacheEntry,
  type InitialDecision,
  type RemoteProgress,
} from './lib/progress.js'
export { tesseractWorkerOptions, type OcrPaths } from './lib/ocr.js'
export type {
  InitialProgress,
  ProgressAck,
  ProgressReason,
  ReaderFormat,
  ReaderMode,
  ReaderPosition,
  ReaderProgressEvent,
  ReaderProps,
  ReaderSpeechVoice,
  ReaderStorage,
  TocItem,
} from './types.js'
