// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// pdf.js and epubjs are loaded with dynamic import() by the readers; jsdom has
// no canvas or iframes worth rendering, so both are replaced by small fakes.
const fakePdf = {
  numPages: 3,
  getOutline: async () => [],
  getPage: async () => ({
    view: [0, 0, 600, 800],
    getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, 1, 0, 0] }),
    render: () => ({ promise: Promise.resolve() }),
    getTextContent: async () => ({ items: [] }),
    getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
  }),
}
const getDocument = vi.fn(() => ({ promise: Promise.resolve(fakePdf) }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {}, getDocument, OPS: {} }))

vi.mock('epubjs', () => {
  const rendition = {
    hooks: { content: { register: () => {} } },
    on: () => {},
    themes: { register: () => {}, select: () => {}, default: () => {}, _themes: {} },
    getContents: () => [],
    resize: () => {},
    destroy: () => {},
    display: () => Promise.resolve(),
    currentLocation: () => null,
    prev: () => {},
    next: () => Promise.resolve(),
  }
  const book = {
    renderTo: () => rendition,
    ready: Promise.resolve(),
    loaded: { navigation: Promise.resolve({ toc: [] }) },
    locations: { generate: () => Promise.resolve(), total: 0 },
    destroy: () => {},
  }
  return { default: () => book }
})

import { EpubReader, PdfReader, Reader } from '../src/index.js'

beforeEach(() => {
  getDocument.mockClear()
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // jsdom has no layout: the readers scroll pages into view.
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(document.documentElement, 'requestFullscreen', { value: () => Promise.resolve(), configurable: true })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const base = { src: '/books/demo.pdf', bookId: 'demo', title: 'Demo book', googleFonts: false }

describe('PdfReader adapters', () => {
  it('calls onExit from the back button', async () => {
    const onExit = vi.fn()
    render(<PdfReader {...base} onExit={onExit} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('hides the back button without onExit', () => {
    render(<PdfReader {...base} />)
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('hides translation without a translate adapter and shows it with one', () => {
    const { unmount } = render(<PdfReader {...base} />)
    expect(screen.queryByTitle('Translate')).toBeNull()
    unmount()
    render(<PdfReader {...base} translate={async (text) => text} />)
    expect(screen.getByTitle('Translate')).toBeTruthy()
  })

  it('uses the labels it is given', async () => {
    render(<PdfReader {...base} onExit={() => {}} labels={{ back: 'Volver' }} />)
    expect(await screen.findByRole('button', { name: 'Volver' })).toBeTruthy()
  })

  it('loads pdf.js files from assetBaseUrl', async () => {
    render(<PdfReader {...base} assetBaseUrl="/static/reader" />)
    await waitFor(() => expect(getDocument).toHaveBeenCalled())
    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({
      url: '/books/demo.pdf',
      cMapUrl: '/static/reader/pdfjs/cmaps/',
      standardFontDataUrl: '/static/reader/pdfjs/standard_fonts/',
      wasmUrl: '/static/reader/pdfjs/wasm/',
    }))
  })

  it('opens the offline copy from storage instead of src', async () => {
    const storage = { getFile: vi.fn(async () => new Blob(['%PDF'])) }
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:offline-copy')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    render(<PdfReader {...base} storage={storage} />)
    await waitFor(() => expect(getDocument).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'blob:offline-copy' })))
    expect(storage.getFile).toHaveBeenCalledWith('demo')
  })

  it('shows the missing-book screen on a 404 and exits from it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    const onExit = vi.fn()
    render(<PdfReader {...base} onExit={onExit} />)
    expect(await screen.findByText('Book not available')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onExit).toHaveBeenCalled()
  })
})

describe('EpubReader adapters', () => {
  const epub = { ...base, src: '/books/demo.epub' }

  it('calls onExit from the back button', async () => {
    const onExit = vi.fn()
    render(<EpubReader {...epub} onExit={onExit} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('lists translation in the menu only with a translate adapter', async () => {
    const { unmount } = render(<EpubReader {...epub} />)
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    expect(screen.queryByRole('menuitem', { name: 'Translate' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Contents' })).toBeTruthy()
    unmount()
    render(<EpubReader {...epub} translate={async (text) => text} />)
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    expect(screen.getByRole('menuitem', { name: 'Translate' })).toBeTruthy()
  })
})

describe('Reader', () => {
  it('picks the PDF reader for .pdf and the EPUB reader otherwise', () => {
    const { unmount } = render(<Reader {...base} />)
    expect(screen.getByTitle('Adjustable Text View')).toBeTruthy() // PDF view-mode toggle
    unmount()
    render(<Reader {...base} src="/books/demo.epub" />)
    expect(screen.getByRole('button', { name: 'More options' })).toBeTruthy()
  })

  it('honors an explicit format', () => {
    render(<Reader {...base} src="/api/books/1/file" format="pdf" />)
    expect(screen.getByTitle('Adjustable Text View')).toBeTruthy()
  })

  it('scopes everything under .trd-root and applies the dark mode', () => {
    const { container } = render(<Reader {...base} mode="dark" />)
    const root = container.firstElementChild!
    expect(root.className).toBe('trd-root dark')
  })
})
