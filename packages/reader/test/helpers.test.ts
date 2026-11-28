import { describe, it, expect } from 'vitest'
import {
  getDeviceId,
  pageFromLocator,
  pageLocator,
  pagePercent,
  parseCacheEntry,
  progressCacheKey,
  readCache,
  serializeCacheEntry,
  writeCache,
  type CacheEntry,
  type KeyValueStore,
} from '../src/lib/progress.js'
import { resolveAssetUrls, DEFAULT_ASSET_BASE_URL } from '../src/lib/assets.js'
import { detectFormat } from '../src/lib/format.js'
import { DEFAULT_LABELS, format, formatRelativeTime } from '../src/labels.js'
import { tesseractWorkerOptions } from '../src/lib/ocr.js'
import { buildReaderContext, defaultOcrLanguage } from '../src/context.js'

const memory = (): KeyValueStore & { map: Map<string, string> } => {
  const map = new Map<string, string>()
  return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: k => void map.delete(k) }
}

describe('PDF locators', () => {
  it('maps pages to page:N and back', () => {
    expect(pageLocator(12)).toBe('page:12')
    expect(pageFromLocator('page:12')).toBe(12)
  })

  it('opens on page 1 for anything that is not a page locator', () => {
    expect(pageFromLocator(null)).toBe(1)
    expect(pageFromLocator('')).toBe(1)
    expect(pageFromLocator('epubcfi(/6/4!/4/2)')).toBe(1)
    expect(pageFromLocator('page:abc')).toBe(1)
  })

  it('computes and clamps the percent read', () => {
    expect(pagePercent(5, 20)).toBe(25)
    expect(pagePercent(30, 20)).toBe(100)
    expect(pagePercent(1, 0)).toBe(0)
  })
})

describe('progress cache', () => {
  const entry: CacheEntry = { cfi: 'page:3', percent: 30, serverAt: '2026-11-01T10:00:00.000Z', dirty: true, device: 'd1' }

  it('round-trips an entry', () => {
    expect(parseCacheEntry(serializeCacheEntry(entry))).toEqual(entry)
  })

  it('rejects junk and fills missing fields safely', () => {
    expect(parseCacheEntry(null)).toBeNull()
    expect(parseCacheEntry('not json')).toBeNull()
    expect(parseCacheEntry('42')).toBeNull()
    expect(parseCacheEntry('{"cfi":"page:2","percent":250}')).toEqual({ cfi: 'page:2', percent: 100, serverAt: null, dirty: false, device: '' })
  })

  it('stores under the prefix and book id', () => {
    const store = memory()
    writeCache(store, 'app', 'book-1', entry)
    expect([...store.map.keys()]).toEqual([progressCacheKey('app', 'book-1')])
    expect(progressCacheKey('app', 'book-1')).toBe('app:progress:book-1')
    expect(readCache(store, 'app', 'book-1')).toEqual(entry)
    expect(readCache(store, 'app', 'book-2')).toBeNull()
  })

  it('keeps one device id per prefix', () => {
    const store = memory()
    let n = 0
    const make = () => `id-${++n}`
    expect(getDeviceId(store, 'app', make)).toBe('id-1')
    expect(getDeviceId(store, 'app', make)).toBe('id-1')
    expect(getDeviceId(store, 'other', make)).toBe('id-2')
  })
})

describe('asset URLs', () => {
  it('defaults to /reader-assets', () => {
    expect(DEFAULT_ASSET_BASE_URL).toBe('/reader-assets')
    expect(resolveAssetUrls()).toEqual({
      pdfWorker: '/reader-assets/pdfjs/pdf.worker.min.mjs',
      pdfCMaps: '/reader-assets/pdfjs/cmaps/',
      pdfStandardFonts: '/reader-assets/pdfjs/standard_fonts/',
      pdfWasm: '/reader-assets/pdfjs/wasm/',
      pdfIccs: '/reader-assets/pdfjs/iccs/',
      tesseractWorker: '/reader-assets/tesseract/worker.min.js',
      tesseractCore: '/reader-assets/tesseract/core',
      tesseractLang: '/reader-assets/tesseract/lang',
    })
  })

  it('accepts a base with a trailing slash', () => {
    expect(resolveAssetUrls('/static/reader/').pdfWorker).toBe('/static/reader/pdfjs/pdf.worker.min.mjs')
  })

  it('never points tesseract at a CDN', () => {
    const urls = resolveAssetUrls()
    const options = tesseractWorkerOptions({ workerPath: urls.tesseractWorker, corePath: urls.tesseractCore, langPath: urls.tesseractLang })
    expect(options).toEqual({
      workerPath: '/reader-assets/tesseract/worker.min.js',
      corePath: '/reader-assets/tesseract/core',
      langPath: '/reader-assets/tesseract/lang',
      workerBlobURL: false,
      gzip: true,
    })
    expect(JSON.stringify(options)).not.toMatch(/jsdelivr|unpkg|https?:/)
  })
})

describe('detectFormat', () => {
  it('is pdf only for .pdf, ignoring query and hash', () => {
    expect(detectFormat('/books/a.PDF')).toBe('pdf')
    expect(detectFormat('https://x.test/b.pdf?sig=1#p2')).toBe('pdf')
    expect(detectFormat('/books/a.epub')).toBe('epub')
    expect(detectFormat('/api/books/1/file')).toBe('epub')
  })
})

describe('labels', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(format('Page {page} of {total}', { page: 3 })).toBe('Page 3 of {total}')
  })

  it('formats relative times with the labels', () => {
    const now = new Date('2026-11-27T12:00:00Z')
    expect(formatRelativeTime(DEFAULT_LABELS, null, now)).toBe('Unknown')
    expect(formatRelativeTime(DEFAULT_LABELS, '2026-11-27T11:59:40Z', now)).toBe('Less than a minute ago')
    expect(formatRelativeTime(DEFAULT_LABELS, '2026-11-27T11:15:00Z', now)).toBe('45 min ago')
    expect(formatRelativeTime({ ...DEFAULT_LABELS, timeHoursAgo: 'hace {n} h' }, '2026-11-27T09:00:00Z', now)).toBe('hace 3 h')
    expect(formatRelativeTime(DEFAULT_LABELS, '2026-11-25T12:00:00Z', now)).toBe('2 day(s) ago')
  })

  it('merges partial labels over the English defaults', () => {
    const ctx = buildReaderContext({ labels: { back: 'Volver' }, language: 'es-AR' })
    expect(ctx.t('back')).toBe('Volver')
    expect(ctx.t('tocTitle')).toBe('Table of Contents')
    expect(ctx.language).toBe('es')
    expect(ctx.ocrLanguage).toBe('spa')
    expect(buildReaderContext({}).ocrLanguage).toBe('eng')
    expect(buildReaderContext({ language: 'es', ocrLanguage: 'spa+eng' }).ocrLanguage).toBe('spa+eng')
    expect(defaultOcrLanguage('en')).toBe('eng')
  })
})
