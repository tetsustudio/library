/** Reader preferences kept in localStorage, shared by the PDF and EPUB readers. */
export interface ReaderSettings {
  fontFamily?: string
  fontSize?: number
  lineHeight?: string
  theme?: string
  customColors?: { bg: string; text: string }
  textAlign?: 'left' | 'right' | 'justify'
  marginSize?: 'compact' | 'normal' | 'wide'
  zoomScale?: number
  translationEnabled?: boolean
  translationTargetLang?: string
}

export type PdfViewMode = 'page' | 'text' | 'ocr'

export const settingsKey = (prefix: string) => `${prefix}-settings`
export const viewModeKey = (prefix: string, bookId: string) => `${prefix}:viewmode:${bookId}`

export function readSettings(prefix: string): ReaderSettings | null {
  try {
    const raw = localStorage.getItem(settingsKey(prefix))
    if (!raw) return null
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? (value as ReaderSettings) : null
  } catch {
    return null
  }
}

/** Merges into what is stored, so the PDF reader keeps the EPUB-only keys and the other way round. */
export function writeSettings(prefix: string, settings: ReaderSettings): void {
  try {
    localStorage.setItem(settingsKey(prefix), JSON.stringify({ ...readSettings(prefix), ...settings }))
  } catch {
    // Private mode or a full quota: the settings just do not persist.
  }
}

export function readViewMode(prefix: string, bookId: string): PdfViewMode | null {
  try {
    const value = localStorage.getItem(viewModeKey(prefix, bookId))
    return value === 'page' || value === 'text' || value === 'ocr' ? value : null
  } catch {
    return null
  }
}

export function writeViewMode(prefix: string, bookId: string, mode: PdfViewMode): void {
  try {
    localStorage.setItem(viewModeKey(prefix, bookId), mode)
  } catch {
    // ignore
  }
}
