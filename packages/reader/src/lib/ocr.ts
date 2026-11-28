import { extractParagraphs } from './pdf-text.js'
import type { ReaderStorage } from '../types.js'

/**
 * OCR de páginas de PDF.
 *
 * Lo que había antes llamaba a `recognize(canvas, lang)` — la API de un solo
 * tiro de tesseract.js — una vez por página. Eso levanta un worker nuevo y
 * vuelve a bajar los datos del idioma **cada vez**: la segunda página costaba
 * lo mismo que la primera. Acá el worker se crea una vez y se reutiliza, que
 * es de lejos el cambio que más se siente.
 *
 * Las otras tres cosas que suma:
 *
 *  - **No hace OCR si la página ya tiene texto.** Muchos PDF "escaneados" son
 *    híbridos: traen capa de texto en parte de las páginas. Cuando la hay, es
 *    gratis y sale perfecto.
 *  - **Renderiza a ~300 DPI.** Se renderizaba a `scale: 2.0`; como el PDF está
 *    en puntos (72/pulgada) eso son 144 DPI, por debajo de lo que Tesseract
 *    quiere. Con techo, porque en mobile la memoria es finita.
 *  - **Cachea en el `storage` del lector** (IndexedDB con `idb-storage`). El
 *    caché era un `useRef`, así que salir del libro y volver hacía pagar todo de nuevo.
 */

const TARGET_DPI = 300
const PDF_POINTS_PER_INCH = 72
const MAX_CANVAS_PIXELS = 4096 * 4096
/** Debajo de esto la capa de texto es basura y conviene el OCR igual. */
const MIN_CHARS_FOR_TEXT_LAYER = 40

type Worker = { recognize: (img: any) => Promise<{ data: { text: string } }>; terminate: () => Promise<any> }

/**
 * Where tesseract.js loads its files from. In glimpse `createWorker(lang)` was
 * called without them, so tesseract.js fell back to its defaults:
 * worker.min.js, the wasm core and the language data from cdn.jsdelivr.net,
 * which glimpse's CSP (script-src / connect-src) does not allow. The reader
 * always passes these, pointing at the app's own origin (copied there by
 * `tetsu-reader-assets`).
 */
export interface OcrPaths {
  workerPath: string
  corePath: string
  langPath: string
}

/** The options handed to `createWorker`: same-origin paths, no blob worker, no CDN. */
export function tesseractWorkerOptions(paths: OcrPaths) {
  return {
    workerPath: paths.workerPath,
    corePath: paths.corePath,
    langPath: paths.langPath,
    // The worker script comes straight from the app's origin, so `worker-src 'self'` is enough.
    workerBlobURL: false,
    gzip: true,
  }
}

let workerPromise: Promise<Worker> | null = null
let workerKey: string | null = null

async function getWorker(lang: string, paths: OcrPaths): Promise<Worker> {
  const key = `${lang}|${paths.workerPath}|${paths.corePath}|${paths.langPath}`
  // Cambiar de idioma implica otros datos: se descarta el worker anterior.
  if (workerPromise && workerKey !== key) {
    const previous = workerPromise
    workerPromise = null
    previous.then(w => w.terminate()).catch(() => {})
  }

  if (!workerPromise) {
    workerKey = key
    workerPromise = import('tesseract.js').then((mod: any) => {
      const createWorker = mod.createWorker ?? mod.default?.createWorker
      return createWorker(lang, undefined, tesseractWorkerOptions(paths)) as Promise<Worker>
    })
    workerPromise.catch(() => {
      if (workerKey === key) {
        workerPromise = null
        workerKey = null
      }
    })
  }

  return workerPromise
}

/** Libera el worker. Se llama al salir del lector. */
export async function releaseOcrWorker(): Promise<void> {
  const current = workerPromise
  workerPromise = null
  workerKey = null
  if (current) {
    try {
      const worker = await current
      await worker.terminate()
    } catch {
      // Si nunca llegó a crearse no hay nada que liberar.
    }
  }
}

export function ocrCacheKey(bookId: string, pageNumber: number, lang: string) {
  return `ocr:${bookId}:${lang}:${pageNumber}`
}

export async function readOcrCache(
  storage: ReaderStorage | undefined,
  bookId: string,
  pageNumber: number,
  lang: string
): Promise<string | null> {
  if (!storage?.getText) return null
  try {
    return (await storage.getText(ocrCacheKey(bookId, pageNumber, lang))) ?? null
  } catch {
    return null
  }
}

async function writeOcrCache(storage: ReaderStorage | undefined, bookId: string, pageNumber: number, lang: string, text: string) {
  if (!storage?.setText) return
  try {
    await storage.setText(ocrCacheKey(bookId, pageNumber, lang), text)
  } catch {
    // Sin caché el OCR sigue funcionando, sólo que más lento.
  }
}

/** Escala para acercarse a TARGET_DPI sin pasarse del techo de memoria. */
function pickScale(page: any): number {
  const ideal = TARGET_DPI / PDF_POINTS_PER_INCH
  const base = page.getViewport({ scale: 1 })
  const pixels = base.width * base.height * ideal * ideal
  if (pixels <= MAX_CANVAS_PIXELS) return ideal
  return Math.max(2, ideal * Math.sqrt(MAX_CANVAS_PIXELS / pixels))
}

export interface OcrResult {
  text: string
  /** De dónde salió: la capa de texto del PDF, el OCR, o el caché. */
  source: 'cache' | 'text-layer' | 'ocr'
}

export interface RecognizeOptions {
  /** Tesseract language code(s), e.g. `eng` or `spa+eng`. */
  lang: string
  paths: OcrPaths
  storage?: ReaderStorage
  signal?: { cancelled: boolean }
}

export async function recognizePage(
  pdfDoc: any,
  bookId: string,
  pageNumber: number,
  { lang, paths, storage, signal }: RecognizeOptions
): Promise<OcrResult> {
  const cached = await readOcrCache(storage, bookId, pageNumber, lang)
  if (cached) return { text: cached, source: 'cache' }

  const page = await pdfDoc.getPage(pageNumber)

  // Si la página ya trae texto, no hay nada que reconocer.
  try {
    const content = await page.getTextContent()
    const asText = extractParagraphs(content.items ?? [])
    if (asText.replace(/\s/g, '').length >= MIN_CHARS_FOR_TEXT_LAYER) {
      await writeOcrCache(storage, bookId, pageNumber, lang, asText)
      return { text: asText, source: 'text-layer' }
    }
  } catch {
    // Sin capa de texto utilizable: se sigue con el OCR.
  }

  if (signal?.cancelled) return { text: '', source: 'ocr' }

  const viewport = page.getViewport({ scale: pickScale(page) })
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo crear el contexto del canvas')

  canvas.width = viewport.width
  canvas.height = viewport.height

  // Fondo blanco: los PDF con transparencia quedan sobre negro y Tesseract
  // no reconoce nada.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvasContext: context, viewport }).promise
  if (signal?.cancelled) return { text: '', source: 'ocr' }

  const worker = await getWorker(lang, paths)
  const { data } = await worker.recognize(canvas)

  // El canvas puede pesar decenas de MB; en mobile conviene soltarlo ya.
  canvas.width = 0
  canvas.height = 0

  const text = data.text ?? ''
  if (text.trim()) await writeOcrCache(storage, bookId, pageNumber, lang, text)

  return { text, source: 'ocr' }
}
