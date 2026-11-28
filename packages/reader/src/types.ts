import type { ReaderLabels } from './labels.js'

/**
 * A reading position. `locator` is an EPUB CFI for EPUB books and `page:N`
 * for PDF; `percent` goes from 0 to 100.
 */
export interface ReaderPosition {
  locator: string
  percent: number
}

/** The position the app last stored for this book (what `/api/progress` returned in glimpse). */
export interface InitialProgress extends ReaderPosition {
  /** Server timestamp of that write (ISO). Never a client clock. */
  updatedAt?: string | null
  /** Device that wrote it, as sent in `ReaderProgressEvent.deviceId`. */
  deviceId?: string | null
}

export type ProgressReason = 'interval' | 'exit' | 'hidden' | 'conflict'

/** What the reader hands to `onProgress`. */
export interface ReaderProgressEvent extends ReaderPosition {
  bookId: string
  /** Stable id of this browser, kept in localStorage. */
  deviceId: string
  /**
   * Why it is sent. `hidden` fires when the tab is hidden or the page is being
   * unloaded: the reader does not wait for it, so use `fetch(..., { keepalive: true })`
   * or `navigator.sendBeacon` there.
   */
  reason: ProgressReason
}

/** What `onProgress` may resolve to: the server timestamp of the write. */
export interface ProgressAck {
  updatedAt?: string | null
}

/**
 * Optional offline cache. The reader only reads book files from it and keeps
 * its OCR results there; saving books offline is up to the app.
 * `@tetsustudio/reader/idb-storage` has an IndexedDB implementation.
 */
export interface ReaderStorage {
  /** The book file, when it is stored on the device. */
  getFile(bookId: string): Promise<Blob | null>
  /** Small text values (OCR results per page). */
  getText?(key: string): Promise<string | null>
  setText?(key: string, value: string): Promise<void>
}

/** A remote text-to-speech voice offered next to the browser voices. */
export interface ReaderSpeechVoice {
  /** Shown in the voice list. */
  name: string
  /** BCP-47 tag, e.g. `es-AR`. */
  lang: string
  /** Returns the audio for `text`. `wav` is asked when someone waits, `mp3` when prefetching. */
  synthesize(text: string, format: 'mp3' | 'wav'): Promise<Blob>
}

export type ReaderMode = 'light' | 'dark'

export interface ReaderProps {
  /** URL of the book file (same origin or allowed by `connect-src`). */
  src: string
  /** Stable id of the book: keys the progress cache, the offline file and the OCR cache. */
  bookId: string
  title: string
  /** Last stored position. `null` means none stored; leave it out when there is no backend. */
  initialProgress?: InitialProgress | null
  /**
   * Persist the position. Called every 15 s while there are changes, when the
   * user exits, when the tab is hidden, and after a conflict is resolved.
   * Throwing marks the position as pending: it is retried and kept on the
   * device until it goes through.
   */
  onProgress?: (event: ReaderProgressEvent) => Promise<ProgressAck | void> | ProgressAck | void
  /**
   * Translate a passage. Without it the translate feature is hidden. Browsers
   * with the on-device Translator API translate locally first. Throw
   * `TranslateUnconfiguredError` when the service is not set up.
   */
  translate?: (text: string, targetLang: string, sourceLang: string) => Promise<string>
  /** Leave the reader (the back button). Without it the back button is hidden. */
  onExit?: () => void
  /**
   * Chrome color mode. Without it the reader follows the app's tokens (a
   * `.dark` ancestor). Also the default reading theme before the reader saves one.
   */
  mode?: ReaderMode
  /** Where the asset bin copied pdf.js and tesseract files. Default `/reader-assets`. */
  assetBaseUrl?: string
  /** UI strings; missing ones fall back to English. */
  labels?: Partial<ReaderLabels>
  /** Language of the UI, BCP-47 (`es`, `en`). Picks read-aloud voices and the default OCR language. */
  language?: string
  /** Tesseract language code(s) for OCR, e.g. `spa` or `eng+spa`. Default from `language`. */
  ocrLanguage?: string
  /** Offline cache for book files and OCR results. */
  storage?: ReaderStorage
  /** A remote read-aloud voice (EPUB). */
  speechVoice?: ReaderSpeechVoice
  /** Load the extra fonts of the font picker from Google Fonts. Default true. */
  googleFonts?: boolean
  /** Prefix of the localStorage keys (settings, device id, progress cache). Default `tetsu-reader`. */
  storagePrefix?: string
}

export type ReaderFormat = 'pdf' | 'epub'

export interface TocItem {
  label: string
  href?: string
  page?: number
}
