/**
 * Every string the reader shows. English by default; pass `labels` to the
 * reader to translate some or all of them. `{name}` placeholders are filled by
 * the reader (see `format`).
 */
export const DEFAULT_LABELS = {
  // Header, footer and navigation
  back: 'Back',
  page: 'Page',
  of: 'of',
  progressLabel: 'Progress',
  loadingBook: 'Loading book...',
  preparingPdf: 'Preparing PDF document...',
  preparingPage: 'Preparing page {page}...',
  pageSeparator: 'PAGE {page}',
  ocrPageSeparator: 'PAGE {page} (OCR)',
  moreOptions: 'More options',
  searchTheBook: 'Search the book',
  contents: 'Contents',
  voiceAndSpeed: 'Voice and speed',
  typeAndTheme: 'Type and theme',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  savingPosition: 'Saving position...',
  positionSaved: 'Position saved!',

  // Book not available
  bookNotAvailable: 'Book not available',
  bookNotAvailableDesc: 'The file of this book is no longer available.',

  // Settings
  readingSettings: 'Reading Settings',
  themeLabel: 'Theme',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeEink: 'E-ink',
  themeCustom: 'Custom',
  backgroundColor: 'Background',
  textColor: 'Text',
  zoomLabel: 'Page Zoom',
  fontFamilyLabel: 'Font Family',
  moreFonts: 'More fonts...',
  textSizeLabel: 'Text Size',
  lineSpacingLabel: 'Line Spacing',
  lineSpacingNarrow: 'Narrow',
  lineSpacingNormal: 'Normal',
  lineSpacingWide: 'Wide',
  alignmentLabel: 'Alignment',
  alignmentLeft: 'Left',
  alignmentJustify: 'Justified',
  alignmentRight: 'Right',
  marginsLabel: 'Margins',
  marginsNarrow: 'Narrow',
  marginsNormal: 'Normal',
  marginsWide: 'Wide',

  // PDF view modes and text extraction
  viewModePage: 'Common Page View',
  viewModeText: 'Adjustable Text View',
  viewModeOcr: 'OCR Text View (Scanned)',
  extractingText: 'Extracting text...',
  errorExtractingText: 'Error extracting text.',
  processingOcr: 'Processing OCR...',
  ocrError: 'Error processing page with OCR.',

  // Table of contents
  tocTitle: 'Table of Contents',
  noChapters: 'No chapters found',
  documentSections: 'Document Sections',
  lastPage: 'Last page',
  untitledChapter: 'Untitled',

  // Search (EPUB)
  searchPlaceholder: 'Search the book…',
  search: 'Search',
  searching: 'Searching',
  searchHint: 'Type at least {min} letters and tap Search.',
  noResults: 'No results.',
  results: 'results',
  close: 'Close',

  // Translation
  translateMenuLabel: 'Translate',
  translateTitle: 'Translation',
  translateToggleLabel: 'Translate the book',
  translateTargetLabel: 'Translate to',
  translating: 'Translating...',
  translateStatusChecking: 'Checking availability...',
  translateStatusDownloading: 'Downloading language model...',
  translateStatusReady: 'Translating',
  translateStatusUnavailable: 'This language pair is not available in your browser.',
  translateStatusUnconfigured: 'The translation service is not configured.',
  translateStatusError: 'Translation failed. Try again.',
  translateDetecting: "Detecting the book's language...",
  translateSameLanguage: 'The book is already in this language.',
  translatePageModeOnly: 'Switch to text view to translate this PDF.',

  // Progress sync
  syncing: 'Syncing...',
  unsaved: 'Unsaved',
  offlineLocal: 'Offline (local)',
  syncError: 'Sync error',
  synced: 'Synced',
  syncPositionTitle: 'Sync Position',
  syncPositionDesc:
    'We detected a difference between your local reading position and the cloud. Where would you like to continue?',
  positionOnDevice: 'Position on this device',
  cloudPosition: 'Cloud position',
  stayHere: 'Stay here',
  goToCloud: 'Go to cloud',
  timeUnknown: 'Unknown',
  timeJustNow: 'Less than a minute ago',
  timeMinutesAgo: '{n} min ago',
  timeHoursAgo: '{n} hr ago',
  timeDaysAgo: '{n} day(s) ago',

  // Read aloud
  readAloud: 'Read aloud',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
  speed: 'Speed',
  playSample: 'Play sample',
  needsConnection: ' · needs a connection',
  noVoices: 'No system voices available. On Android you add them from Settings → Accessibility → Text-to-speech.',
  voicesNote:
    'These are your system voices: nothing is downloaded and they work offline. Playback stops when the screen locks.',
  serverVoiceNote: ' The server voice is generated remotely: the text being read is sent there.',
}

export type ReaderLabels = typeof DEFAULT_LABELS
export type ReaderLabelKey = keyof ReaderLabels

/** Fills `{name}` placeholders: `format('Page {page}', { page: 3 })` → `Page 3`. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match
  )
}

/** "5 min ago" style text for a timestamp, with the reader's labels. */
export function formatRelativeTime(
  labels: ReaderLabels,
  dateString: string | null | undefined,
  now: Date = new Date()
): string {
  if (!dateString) return labels.timeUnknown
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return labels.timeUnknown
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  if (diffMins < 1) return labels.timeJustNow
  if (diffMins < 60) return format(labels.timeMinutesAgo, { n: diffMins })
  if (diffHours < 24) return format(labels.timeHoursAgo, { n: diffHours })
  return format(labels.timeDaysAgo, { n: diffDays })
}
