'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from './ui/button.js'
import {
  ArrowLeft, Settings, Menu, BookOpen,
  Minus, Plus, Type, Loader2, ChevronRight,
  FileText, Eye, ScanText, Maximize2, Minimize2, Check, Languages
} from 'lucide-react'

import { useReaderContext, useTranslation } from '../context.js'
import { format, formatRelativeTime } from '../labels.js'
import { SyncStatusIndicator } from './ui/sync-status-indicator.js'
import {
  targetLanguageOptions,
  detectLanguage,
} from '../lib/translate.js'
import { useBookTranslator } from '../hooks/use-book-translator.js'
import { useGoogleFonts, GOOGLE_FONTS } from '../hooks/use-google-fonts.js'
import { readSettings, writeSettings, readViewMode, writeViewMode } from '../lib/settings.js'
import { loadBookSource } from '../lib/book-source.js'
import type { ReaderProps, TocItem } from '../types.js'


import { useReadingProgress } from '../hooks/use-reading-progress.js'
import { pageFromLocator as pageFromCfi, pageLocator, pagePercent } from '../lib/progress.js'
import { extractParagraphs, extractParagraphBlocks, findTextSample } from '../lib/pdf-text.js'
import { boxToViewportRect, findImageBoxes, findPaintedBoxes, planPageReflow, imageInsertionIndex, type PageReflowPlan } from '../lib/pdf-images.js'
import { recognizePage, releaseOcrWorker } from '../lib/ocr.js'

export type PdfReaderProps = ReaderProps


// Lazy PDF Page component to render pages
function PdfPage({ pdfDoc, pageNumber, scale, currentPage }: { pdfDoc: any; pageNumber: number; scale: number; currentPage: number }) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [hasLoaded, setHasLoaded] = useState(false)

  const shouldLoad = pageNumber === currentPage || pageNumber === currentPage + 1
  const isVisible = shouldLoad || hasLoaded

  useEffect(() => {
    if (!isVisible || !canvasRef.current || !pdfDoc) return

    let isCancelled = false

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber)
        if (isCancelled) return

        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas) return
        
        canvas.width = viewport.width
        canvas.height = viewport.height

        const context = canvas.getContext('2d')
        if (!context) return

        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise

        if (!isCancelled) {
          setHasLoaded(true)
        }
      } catch (err) {
        console.error('Error rendering PDF page:', err)
      }
    }

    renderPage()

    return () => {
      isCancelled = true
    }
  }, [isVisible, pdfDoc, pageNumber, scale])

  return (
    <div 
      ref={containerRef} 
      data-page-number={pageNumber}
      className="pdf-page-wrapper flex justify-center my-4 bg-muted/10 border border-border/30 rounded-xl overflow-hidden min-h-[450px]"
    >
      {isVisible ? (
        <canvas ref={canvasRef} className="max-w-full h-auto" />
      ) : (
        <div className="flex flex-col items-center justify-center w-[500px] h-[700px] text-muted-foreground text-xs gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
          <span>{format(t('preparingPage'), { page: pageNumber })}</span>
        </div>
      )}
    </div>
  )
}

interface ReflowImage {
  src: string
  alt: string
  /** Índice del párrafo antes del cual va la imagen. */
  before: number
  /** Ancho en px CSS a escala 1, para no agrandar imágenes chicas. */
  width: number
}

/** Escala a la que se renderiza la página para recortar sus imágenes. */
const IMAGE_RENDER_SCALE = 2

const reflowPlans = new WeakMap<object, Map<number, Promise<PageReflowPlan>>>()

/**
 * Qué de la página va como figura y qué como párrafo (ver src/lib/pdf-images.ts).
 * Se calcula una vez por página porque lo consumen el texto y las figuras, y
 * tienen que coincidir. Si falla, la página queda con todo su texto y sin figuras.
 */
function getReflowPlan(pdfDoc: any, pageNumber: number): Promise<PageReflowPlan> {
  let plans = reflowPlans.get(pdfDoc)
  if (!plans) {
    plans = new Map()
    reflowPlans.set(pdfDoc, plans)
  }
  let plan = plans.get(pageNumber)
  if (!plan) {
    plan = (async () => {
      const page = await pdfDoc.getPage(pageNumber)
      const { items } = await page.getTextContent()
      try {
        const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
        const { fnArray, argsArray } = await page.getOperatorList()
        const [x0, y0, x1, y1] = page.view
        return planPageReflow({
          imageBoxes: findImageBoxes(fnArray, argsArray, pdfjsLib.OPS),
          paintedBoxes: findPaintedBoxes(fnArray, argsArray, pdfjsLib.OPS),
          items,
          page: { x0, y0, x1, y1 },
        })
      } catch (e) {
        console.error('Error planning PDF page figures:', e)
        return { figures: [], altTexts: [], items }
      }
    })()
    plans.set(pageNumber, plan)
  }
  return plan
}

/**
 * Las figuras de una página para el modo texto: imágenes y tablas. Los pixeles
 * salen de renderizar la página una vez y recortar cada caja. Sin figuras no se
 * renderiza nada.
 */
function usePdfPageImages(pdfDoc: any, pageNumber: number, enabled: boolean): ReflowImage[] {
  const [images, setImages] = useState<ReflowImage[]>([])

  useEffect(() => {
    if (!enabled || !pdfDoc) return
    let cancelled = false
    const urls: string[] = []

    const load = async () => {
      try {
        const { figures: boxes, altTexts, items } = await getReflowPlan(pdfDoc, pageNumber)
        if (cancelled || boxes.length === 0) return

        const page = await pdfDoc.getPage(pageNumber)
        const blocks = extractParagraphBlocks(items as any[])
        const viewport = page.getViewport({ scale: IMAGE_RENDER_SCALE })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const context = canvas.getContext('2d')
        if (!context) return
        await page.render({ canvasContext: context, viewport }).promise
        if (cancelled) return

        const tops = blocks.map(b => b.top)
        const result: ReflowImage[] = []
        for (let index = 0; index < boxes.length; index++) {
          const box = boxes[index]
          const rect = boxToViewportRect(box, viewport.transform)
          const left = Math.max(0, Math.floor(rect.left))
          const top = Math.max(0, Math.floor(rect.top))
          const width = Math.min(canvas.width - left, Math.ceil(rect.width))
          const height = Math.min(canvas.height - top, Math.ceil(rect.height))
          if (width <= 0 || height <= 0) continue

          const crop = document.createElement('canvas')
          crop.width = width
          crop.height = height
          crop.getContext('2d')?.drawImage(canvas, left, top, width, height, 0, 0, width, height)
          const blob = await new Promise<Blob | null>(resolve => crop.toBlob(resolve, 'image/jpeg', 0.88))
          if (cancelled) return
          if (!blob) continue
          const url = URL.createObjectURL(blob)
          urls.push(url)
          result.push({ src: url, alt: altTexts[index] ?? '', before: imageInsertionIndex(tops, box.y1), width: width / IMAGE_RENDER_SCALE * (4 / 3) })
        }
        if (!cancelled) setImages(result)
      } catch (e) {
        console.error('Error extracting PDF page images:', e)
      }
    }

    load()
    return () => {
      cancelled = true
      urls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [enabled, pdfDoc, pageNumber])

  return images
}

interface PdfTextPageProps {
  pdfDoc: any
  pageNumber: number
  language: string
  textCache: React.MutableRefObject<Record<number, string>>
  extractPageText: (pdf: any, pageNum: number) => Promise<string>
  currentPage: number
  translationEnabled: boolean
  translationTargetLang: string
  translateText: (text: string) => Promise<string>
  translatedCache: React.MutableRefObject<Record<string, string>>
}

function PdfTextPage({
  pdfDoc,
  pageNumber,
  language,
  textCache,
  extractPageText,
  currentPage,
  translationEnabled,
  translationTargetLang,
  translateText,
  translatedCache
}: PdfTextPageProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState<string>(textCache.current[pageNumber] || '')
  const [isLoading, setIsLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(!!textCache.current[pageNumber])
  const [displayText, setDisplayText] = useState(text)
  const [isTranslating, setIsTranslating] = useState(false)

  const shouldLoad = pageNumber === currentPage || pageNumber === currentPage + 1
  const isVisible = shouldLoad || hasLoaded

  useEffect(() => {
    if (!isVisible || !pdfDoc) return

    if (textCache.current[pageNumber]) {
      setText(textCache.current[pageNumber])
      setHasLoaded(true)
      return
    }

    let isCancelled = false
    const loadText = async () => {
      setIsLoading(true)
      try {
        const extracted = await extractPageText(pdfDoc, pageNumber)
        if (!isCancelled) {
          textCache.current[pageNumber] = extracted
          setText(extracted)
          setHasLoaded(true)
        }
      } catch (e) {
        console.error(e)
        if (!isCancelled) {
          setText(t('errorExtractingText'))
          setHasLoaded(true)
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    loadText()

    return () => {
      isCancelled = true
    }
  }, [isVisible, pdfDoc, pageNumber, extractPageText, language, textCache])

  // Traduce esta pagina cuando ya tiene texto y la traduccion esta prendida.
  // Cachea por pagina + idioma destino: al volver a esta pagina, o si ya se
  // tradujo a ese idioma antes, no vuelve a llamar al traductor.
  useEffect(() => {
    if (!translationEnabled || !text) {
      setDisplayText(text)
      return
    }
    const cacheKey = `${pageNumber}:${translationTargetLang}`
    const cached = translatedCache.current[cacheKey]
    if (cached) {
      setDisplayText(cached)
      return
    }
    let isCancelled = false
    setIsTranslating(true)
    translateText(text).then((translated) => {
      if (isCancelled) return
      translatedCache.current[cacheKey] = translated
      setDisplayText(translated)
      setIsTranslating(false)
    })
    return () => { isCancelled = true }
  }, [text, translationEnabled, translationTargetLang, pageNumber, translateText, translatedCache])

  const images = usePdfPageImages(pdfDoc, pageNumber, isVisible && hasLoaded)

  const renderImage = (image: ReflowImage, key: string) => (
    <figure key={key} className="my-[1.5em] flex justify-center select-none">
      <img
        src={image.src}
        alt={image.alt}
        decoding="async"
        style={{ width: `${Math.round(image.width)}px` }}
        className="h-auto max-w-full rounded-sm"
      />
    </figure>
  )

  const renderParagraphs = () => {
    if (!displayText && images.length === 0) return null
    const paragraphs = displayText ? displayText.split(/\n\s*\n/) : []
    const out: React.ReactNode[] = []
    paragraphs.forEach((para, i) => {
      images.forEach((image, k) => { if (image.before === i) out.push(renderImage(image, `img-${k}`)) })
      out.push(
        <p key={i} className="mb-[1.25em] last:mb-0 whitespace-pre-wrap">
          {para.split('\n').map((line, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {line}
            </span>
          ))}
        </p>
      )
    })
    // Las que van despues del ultimo parrafo (o en una pagina sin texto).
    images.forEach((image, k) => { if (image.before >= paragraphs.length) out.push(renderImage(image, `img-${k}`)) })
    return out
  }

  return (
    <div
      ref={containerRef}
      data-page-number={pageNumber}
      className="pdf-text-page-wrapper w-full py-6 select-text min-h-[150px]"
    >
      {/* Page separator */}
      <div className="flex items-center justify-between text-[10px] tracking-wider text-muted-foreground uppercase font-semibold mb-6 select-none opacity-40">
        <span className="h-px bg-border/20 flex-1 mr-4"></span>
        <span>{format(t('pageSeparator'), { page: pageNumber })}</span>
        <span className="h-px bg-border/20 flex-1 ml-4"></span>
      </div>

      {isVisible ? (
        isLoading || isTranslating ? (
          <div className="flex items-center justify-center py-8 gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-brand" />
            <span>
              {isLoading
                ? (t('extractingText'))
                : (t('translating'))}
            </span>
          </div>
        ) : (
          <div className="paragraph-container">
            {renderParagraphs()}
          </div>
        )
      ) : null}
    </div>
  )
}

interface PdfOcrPageProps {
  pdfDoc: any
  pageNumber: number
  language: string
  bookId: string
  ocrCache: React.MutableRefObject<Record<number, string>>
  currentPage: number
  translationEnabled: boolean
  translationTargetLang: string
  translateText: (text: string) => Promise<string>
  translatedCache: React.MutableRefObject<Record<string, string>>
}

function PdfOcrPage({
  pdfDoc,
  pageNumber,
  language,
  bookId,
  ocrCache,
  currentPage,
  translationEnabled,
  translationTargetLang,
  translateText,
  translatedCache
}: PdfOcrPageProps) {
  const { t } = useTranslation()
  const { storage, ocrLanguage, assets } = useReaderContext()
  const containerRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState<string>(ocrCache.current[pageNumber] || '')
  const [isLoading, setIsLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(!!ocrCache.current[pageNumber])
  const [displayText, setDisplayText] = useState(text)
  const [isTranslating, setIsTranslating] = useState(false)

  // STRICTLY only load the current page for OCR
  const shouldLoad = pageNumber === currentPage
  const isVisible = shouldLoad || hasLoaded

  useEffect(() => {
    if (!isVisible || !pdfDoc) return

    if (ocrCache.current[pageNumber]) {
      setText(ocrCache.current[pageNumber])
      setHasLoaded(true)
      return
    }

    const signal = { cancelled: false }
    const run = async () => {
      setIsLoading(true)
      try {
        // recognizePage reutiliza un worker unico, mira primero si la pagina ya
        // trae capa de texto, y cachea en IndexedDB. Ver src/lib/ocr.ts.
        const { text: recognized } = await recognizePage(pdfDoc, bookId, pageNumber, {
          lang: ocrLanguage,
          paths: { workerPath: assets.tesseractWorker, corePath: assets.tesseractCore, langPath: assets.tesseractLang },
          storage,
          signal,
        })
        if (signal.cancelled) return
        ocrCache.current[pageNumber] = recognized
        setText(recognized)
        setHasLoaded(true)
      } catch (err) {
        console.error('OCR Error:', err)
        if (!signal.cancelled) {
          setText(t('ocrError'))
          setHasLoaded(true)
        }
      } finally {
        if (!signal.cancelled) setIsLoading(false)
      }
    }

    run()

    return () => {
      signal.cancelled = true
    }
  }, [isVisible, pdfDoc, pageNumber, language, bookId, ocrCache, ocrLanguage, assets, storage])

  // Mismo criterio que PdfTextPage: traducir por pagina + idioma, con cache.
  useEffect(() => {
    if (!translationEnabled || !text) {
      setDisplayText(text)
      return
    }
    const cacheKey = `${pageNumber}:${translationTargetLang}`
    const cached = translatedCache.current[cacheKey]
    if (cached) {
      setDisplayText(cached)
      return
    }
    let isCancelled = false
    setIsTranslating(true)
    translateText(text).then((translated) => {
      if (isCancelled) return
      translatedCache.current[cacheKey] = translated
      setDisplayText(translated)
      setIsTranslating(false)
    })
    return () => { isCancelled = true }
  }, [text, translationEnabled, translationTargetLang, pageNumber, translateText, translatedCache])

  const renderParagraphs = () => {
    if (!displayText) return null
    return displayText.split(/\n\s*\n/).map((para, i) => (
      <p key={i} className="mb-[1.25em] last:mb-0 whitespace-pre-wrap">
        {para.split('\n').map((line, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {line}
          </span>
        ))}
      </p>
    ))
  }

  return (
    <div
      ref={containerRef}
      data-page-number={pageNumber}
      className="pdf-ocr-page-wrapper w-full py-6 select-text min-h-[150px]"
    >
      {/* Page separator */}
      <div className="flex items-center justify-between text-[10px] tracking-wider text-muted-foreground uppercase font-semibold mb-6 select-none opacity-40">
        <span className="h-px bg-border/20 flex-1 mr-4"></span>
        <span>{format(t('ocrPageSeparator'), { page: pageNumber })}</span>
        <span className="h-px bg-border/20 flex-1 ml-4"></span>
      </div>

      {isVisible ? (
        isLoading || isTranslating ? (
          <div className="flex items-center justify-center py-8 gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-brand" />
            <span>
              {isLoading
                ? (t('processingOcr'))
                : (t('translating'))}
            </span>
          </div>
        ) : (
          <div className="paragraph-container">
            {renderParagraphs()}
          </div>
        )
      ) : null}
    </div>
  )
}

export const PdfReaderView = ({ src: initialUrl, bookId, title: bookTitle, initialProgress, onProgress, onExit, mode }: PdfReaderProps) => {
  const { t, language, labels } = useTranslation()
  const { storage, translate: translateAdapter, assets, storagePrefix, googleFonts } = useReaderContext()
  const labelsRef = useRef(labels)
  labelsRef.current = labels
  const [pdfUrl, setPdfUrl] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [showControls, setShowControls] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showToc, setShowToc] = useState(false)
  const [showTranslate, setShowTranslate] = useState(false)
  const [toc, setToc] = useState<TocItem[]>([])
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pdfDocument, setPdfDocument] = useState<any>(null)
  const {
    syncStatus,
    lastSyncedTime,
    conflict,
    resolveConflict,
    initial: initialPosition,
    initialResolved,
    report: reportPosition,
    setLocationsReady,
    flush: flushProgress,
  } = useReadingProgress({ bookId, initialProgress, onProgress, storagePrefix })

  // La UI del conflicto ya estaba escrita con estos nombres.
  const syncConflict = conflict ? { local: conflict.local, db: conflict.remote } : null
  
  // Custom Reader Settings
  const [viewMode, setViewMode] = useState<'page' | 'text' | 'ocr'>('page') // 'page' (common page), 'text' (reflowable text), 'ocr' (scanned OCR)
  const [fontFamily, setFontFamily] = useState('font-serif')
  const [fontSize, setFontSize] = useState(16) // in px
  const [lineHeight, setLineHeight] = useState('1.5')
  const [theme, setTheme] = useState<string>(mode === 'light' ? 'light' : 'dark') // 'light', 'dark', 'eink', 'custom'
  const [textAlign, setTextAlign] = useState<'left' | 'right' | 'justify'>('justify')
  const [customColors, setCustomColors] = useState({ bg: '#090909', text: '#ffffff' })
  const [marginSize, setMarginSize] = useState<'compact' | 'normal' | 'wide'>('normal')
  const [blackStatusBar, setBlackStatusBar] = useState(true)
  const [zoomScale, setZoomScale] = useState(1.3)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Traduccion en vivo del contenido (no del archivo, ver CLAUDE.md). Solo
  // tiene texto real para traducir en las vistas 'text' y 'ocr': la vista
  // 'page' es un canvas, no hay nodos de texto que reemplazar.
  const [translationEnabled, setTranslationEnabled] = useState(false)
  const [translationTargetLang, setTranslationTargetLang] = useState('en')
  const [translationSourceLang, setTranslationSourceLang] = useState<string | null>(null)
  const translator = useBookTranslator(translationEnabled && !!translateAdapter, translationSourceLang, translationTargetLang, translateAdapter)
  const translatedTextCache = useRef<Record<string, string>>({})
  const translatedOcrCache = useRef<Record<string, string>>({})


  // Lock screen orientation to portrait on Android when reader mounts, unlock on unmount (if not in standalone mode)
  useEffect(() => {
    const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
    if (isAndroid && typeof window !== 'undefined' && window.screen && window.screen.orientation) {
      try {
        (window.screen.orientation as any).lock('portrait').catch((err: any) => {
          console.warn('Failed to lock screen orientation to portrait:', err);
        });
      } catch (e) {
        console.warn('Failed to lock screen orientation:', e);
      }
    }

    return () => {
      if (isAndroid && typeof window !== 'undefined' && window.screen && window.screen.orientation) {
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
        if (!isStandalone) {
          try {
            (window.screen.orientation as any).unlock();
          } catch (e) {
            console.warn('Failed to unlock screen orientation:', e);
          }
        }
      }
    }
  }, []);

  // Force lock screen orientation to portrait when entering fullscreen (since Chrome ignores system locks in fullscreen)
  useEffect(() => {
    const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
    if (!isAndroid || typeof window === 'undefined' || !window.screen || !window.screen.orientation) return;

    if (blackStatusBar) {
      try {
        (window.screen.orientation as any).lock('portrait').catch((err: any) => {
          console.warn('Failed to lock screen orientation in fullscreen:', err);
        });
      } catch (e) {
        console.warn('Failed to lock screen orientation:', e);
      }
    } else {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
      if (!isStandalone) {
        try {
          (window.screen.orientation as any).unlock();
        } catch (e) {
          console.warn('Failed to unlock screen orientation:', e);
        }
      }
    }
  }, [blackStatusBar]);

  // El lector abre en pantalla completa por defecto, pero la Fullscreen API
  // exige un gesto del usuario: el intento en el mount funciona en algunos
  // navegadores (Chrome conserva la activacion de la navegacion que trajo
  // hasta aca) y si no, el primer toque en el lector la dispara igual.
  useEffect(() => {
    if (typeof document === 'undefined' || !blackStatusBar) return

    const tryFullscreen = () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {})
      }
    }

    tryFullscreen()
    document.addEventListener('pointerdown', tryFullscreen, { once: true })
    return () => document.removeEventListener('pointerdown', tryFullscreen)
  }, [blackStatusBar]);

  // Caches for text content
  const textCache = useRef<Record<number, string>>({})
  const ocrCache = useRef<Record<number, string>>({})
  
  const [fileError, setFileError] = useState(false)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const lastPageRef = useRef<number>(1)
  const isInitialLoadRef = useRef(true)
  const isResizingRef = useRef(false)
  useGoogleFonts(googleFonts)

  // Load cached settings on mount
  useEffect(() => {
    try {
      const p = readSettings(storagePrefix)
      if (p) {
        if (p.fontFamily) setFontFamily(p.fontFamily)
        if (p.fontSize) setFontSize(p.fontSize)
        if (p.lineHeight) setLineHeight(p.lineHeight)
        if (p.theme) setTheme(p.theme)
        if (p.customColors) setCustomColors(p.customColors)
        if (p.textAlign) setTextAlign(p.textAlign)
        if (p.marginSize) setMarginSize(p.marginSize)
        // blackStatusBar no se restaura: el lector siempre abre en pantalla
        // completa, aunque la ultima sesion se haya cerrado sin ella.
        if (p.zoomScale !== undefined) setZoomScale(p.zoomScale)
        if (p.translationEnabled !== undefined) setTranslationEnabled(p.translationEnabled)
        if (p.translationTargetLang) setTranslationTargetLang(p.translationTargetLang)
      }
      
      const cachedViewMode = readViewMode(storagePrefix, bookId)
      if (cachedViewMode) setViewMode(cachedViewMode)
    } catch (e) { console.error('Failed to load settings', e) }
    settingsLoadedRef.current = true
  }, [bookId, storagePrefix])

  // Save settings on change (after the saved ones were read, or the defaults would overwrite them)
  const settingsLoadedRef = useRef(false)
  useEffect(() => {
    if (!settingsLoadedRef.current) return
    writeSettings(storagePrefix, {
      fontFamily, fontSize, lineHeight, theme, customColors, textAlign, marginSize, zoomScale,
      translationEnabled, translationTargetLang
    })
  }, [fontFamily, fontSize, lineHeight, theme, customColors, textAlign, marginSize, zoomScale,
      translationEnabled, translationTargetLang, storagePrefix])

  // Save viewMode setting on change
  useEffect(() => {
    if (!settingsLoadedRef.current) return
    writeViewMode(storagePrefix, bookId, viewMode)
  }, [viewMode, bookId, storagePrefix])

  // Sync theme-color meta tag based on active theme
  useEffect(() => {
    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }

    let color = '#333333'
    if (blackStatusBar) {
      color = '#000000'
    } else {
      if (theme === 'light' || theme === 'eink') color = '#ffffff'
      if (theme === 'custom') color = customColors.bg
    }
    meta.setAttribute('content', color)

    return () => {
      const defaultMeta = document.querySelector('meta[name="theme-color"]')
      if (defaultMeta) {
        defaultMeta.setAttribute('content', '#090909')
      }
    }
  }, [theme, customColors, blackStatusBar])

  // Synchronize fullscreen state and scroll page back into view to preserve reading position
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = !!document.fullscreenElement
      setBlackStatusBar(isFullscreen)

      isResizingRef.current = true

      // Re-align scroll container to the active page after layout transition finishes
      setTimeout(() => {
        if (!scrollContainerRef.current) return
        const selector = viewMode === 'page'
          ? `[data-page-number="${currentPage}"]`
          : viewMode === 'text'
            ? `.pdf-text-page-wrapper[data-page-number="${currentPage}"]`
            : `.pdf-ocr-page-wrapper[data-page-number="${currentPage}"]`

        const el = scrollContainerRef.current.querySelector(selector)
        if (el) {
          el.scrollIntoView({ block: 'start' })
        }
        
        setTimeout(() => {
          isResizingRef.current = false
        }, 50)
      }, 150)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)

    const handleResize = () => {
      isResizingRef.current = true
      setTimeout(() => {
        isResizingRef.current = false
      }, 300)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      window.removeEventListener('resize', handleResize)
    }
  }, [viewMode, currentPage])

  const handleResolveConflict = (useDb: boolean) => {
    const chosen = resolveConflict(useDb)
    if (!chosen) return

    const page = Math.min(Math.max(1, pageFromCfi(chosen.cfi)), numPages || 1)
    setCurrentPage(page)
    lastPageRef.current = page

    if (viewMode === 'page') {
      setTimeout(() => {
        const el = scrollContainerRef.current?.querySelector(`[data-page-number="${page}"]`)
        el?.scrollIntoView({ block: 'start' })
      }, 50)
    }
  }

  // 1. Resolve PDF source: the offline copy when storage has one, else `src`
  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setFileError(false)
    loadBookSource({ bookId, src: initialUrl, storage }).then(result => {
      if (cancelled) {
        if (result.kind === 'url' && result.revoke) URL.revokeObjectURL(result.url)
        return
      }
      if (result.kind === 'missing') {
        setFileError(true)
        setIsLoading(false)
        return
      }
      setPdfUrl(result.url)
    })
    return () => { cancelled = true }
  }, [bookId, initialUrl, storage])

  // 2. Extract PDF Text helper function
  const extractPageText = async (pdf: any, pageNum: number) => {
    try {
      const { items } = await getReflowPlan(pdf, pageNum)
      // El armado de parrafos vive en src/lib/pdf-text.ts, aparte, porque es
      // logica pura y es la que hay que poder testear sin un PDF real.
      return extractParagraphs(items as any[])
    } catch (e) {
      console.error('Error extracting page text:', e)
      return labelsRef.current.errorExtractingText
    }
  }

  /**
   * Traduce parrafo por parrafo (no la pagina entera de una) para no perder
   * los saltos de parrafo que ya armo `extractParagraphs`.
   */
  const translatePageText = useCallback(async (fullText: string): Promise<string> => {
    const paragraphs = fullText.split(/\n\s*\n/)
    const translated: string[] = []
    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) {
        translated.push(paragraph)
        continue
      }
      translated.push(await translator.translate(paragraph))
    }
    return translated.join('\n\n')
  }, [translator.translate])

  /** Idioma de origen: el PDF no lo declara, asi que se detecta de una muestra. */
  const ensureTranslationSourceLang = useCallback(async (): Promise<string> => {
    if (translationSourceLang) return translationSourceLang
    let sample = textCache.current[currentPage] || ocrCache.current[currentPage] || ''
    if (!sample && pdfDocument) {
      sample = await findTextSample(page => extractPageText(pdfDocument, page), currentPage, pdfDocument.numPages)
    }
    const detected = await detectLanguage(sample)
    // Sin texto no se sabe: se usa ingles por ahora, sin fijarlo para el resto de la sesion.
    if (!sample.trim()) return detected || 'en'
    const resolved = detected || 'en'
    setTranslationSourceLang(resolved)
    return resolved
  }, [translationSourceLang, currentPage, pdfDocument])

  const handleToggleTranslation = useCallback(async () => {
    if (!translationEnabled) await ensureTranslationSourceLang()
    setTranslationEnabled((v) => !v)
  }, [translationEnabled, ensureTranslationSourceLang])

  // Si la traduccion ya venia prendida de una sesion anterior, resuelve el
  // idioma de origen apenas el documento esta listo.
  useEffect(() => {
    if (translationEnabled && !translationSourceLang && pdfDocument) {
      ensureTranslationSourceLang()
    }
  }, [translationEnabled, translationSourceLang, pdfDocument, ensureTranslationSourceLang])

  // 3. Load PDF via pdfjs-dist when URL is resolved
  useEffect(() => {
    if (!pdfUrl) return

    const loadPdf = async () => {
      try {
        // El build legacy: el moderno usa Promise.withResolvers(), que no
        // existe antes de Safari 17.4. Ver scripts/copy-assets.mjs.
        const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
        // Del propio origen, no de cdnjs: la CSP no permite un worker
        // cross-origin, y asi el lector de PDF tambien anda sin conexion.
        // El archivo lo copia scripts/copy-assets.mjs desde pdfjs-dist.
        pdfjsLib.GlobalWorkerOptions.workerSrc = assets.pdfWorker
        
        const loadingTask = pdfjsLib.getDocument({
          url: pdfUrl,
          // El lector baja el archivo entero, como siempre: con tramos sueltos
          // el libro no queda en la cache del browser para seguir sin conexion.
          disableRange: true,
          cMapUrl: assets.pdfCMaps,
          cMapPacked: true,
          standardFontDataUrl: assets.pdfStandardFonts,
          wasmUrl: assets.pdfWasm,
          iccUrl: assets.pdfIccs,
        })
        const pdf = await loadingTask.promise
        setPdfDocument(pdf)
        setNumPages(pdf.numPages)

        // Parse Table of Contents / Outline if available
        try {
          const outline = await pdf.getOutline()
          if (outline && outline.length > 0) {
            const items = await Promise.all(outline.map(async (item: any) => {
              let pageNum = null
              if (item.dest) {
                try {
                  const destRef = typeof item.dest === 'string' ? JSON.parse(item.dest) : item.dest
                  // destRef[0] contains reference node, pdf.getPageIndex resolves it to 0-indexed page index
                  const pageIdx = await pdf.getPageIndex(destRef[0])
                  pageNum = pageIdx + 1
                } catch {}
              }
              return {
                label: item.title || labelsRef.current.untitledChapter,
                page: pageNum
              }
            }))
            setToc(items.filter(i => i.page !== null) as TocItem[])
          }
        } catch (tocErr) {
          console.warn('El PDF no trae indice o no se pudo leer:', tocErr)
        }

        // El posicionado inicial se hace en un efecto propio, cuando ya
        // sabemos cuantas paginas tiene el PDF y el hook resolvio la posicion.

      } catch (err) {
        console.error('Error loading PDF:', err)
        setIsLoading(false)
      }
    }

    loadPdf()

    return () => {
      if (pdfUrl.startsWith('blob:')) {
        URL.revokeObjectURL(pdfUrl)
      }
    }
  }, [pdfUrl, bookId, assets])

  // El worker de Tesseract vive entre paginas a proposito, asi que hay que
  // soltarlo explicitamente al salir del lector.
  useEffect(() => {
    return () => {
      releaseOcrWorker()
    }
  }, [])

  // Posicionado inicial. Espera a saber cuantas paginas tiene el PDF y a que el
  // hook resuelva la posicion (cache vs base). Hasta que las dos cosas esten,
  // no se habilita el guardado: sin numPages el porcentaje no se puede calcular.
  useEffect(() => {
    if (numPages === 0 || !initialResolved) return

    const page = Math.min(Math.max(1, pageFromCfi(initialPosition?.cfi)), numPages)
    setCurrentPage(page)
    lastPageRef.current = page
    setIsLoading(false)
    setLocationsReady(true)

    const timer = setTimeout(() => {
      isInitialLoadRef.current = false
    }, 800)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, initialResolved])

  // 4. Save progress on page index change (Text View) or scroll index changes (Page View)
  const saveProgress = useCallback((page: number) => {
    if (isInitialLoadRef.current || numPages === 0) return

    lastPageRef.current = page
    reportPosition(pageLocator(page), pagePercent(page, numPages))
  }, [numPages, reportPosition])

  // Scroll to active page on initial load
  useEffect(() => {
    if (!isLoading && currentPage > 1 && scrollContainerRef.current) {
      const timer = setTimeout(() => {
        const selector = viewMode === 'page'
          ? `[data-page-number="${currentPage}"]`
          : viewMode === 'text'
            ? `.pdf-text-page-wrapper[data-page-number="${currentPage}"]`
            : `.pdf-ocr-page-wrapper[data-page-number="${currentPage}"]`
            
        const el = scrollContainerRef.current?.querySelector(selector)
        if (el) {
          el.scrollIntoView({ block: 'start' })
        }
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [isLoading])

  // Scroll to active page when switching view modes
  useEffect(() => {
    if (isLoading || !scrollContainerRef.current) return
    // La vista nueva tiene otra altura y el scroll queda donde estaba, en otra
    // pagina. Hasta volver a la actual, ese scroll no cuenta como lectura: si no,
    // la pagina y el progreso guardado saltan a cualquier lado.
    isResizingRef.current = true
    const scrollToCurrent = () => {
      const selector = viewMode === 'page'
        ? `[data-page-number="${currentPage}"]`
        : viewMode === 'text'
          ? `.pdf-text-page-wrapper[data-page-number="${currentPage}"]`
          : `.pdf-ocr-page-wrapper[data-page-number="${currentPage}"]`
      // Instantaneo: el contenedor es scroll-smooth y si no recorre paginas vacias.
      scrollContainerRef.current?.querySelector(selector)?.scrollIntoView({ block: 'start', behavior: 'instant' })
    }
    scrollToCurrent()
    let release: ReturnType<typeof setTimeout>
    const timer = setTimeout(() => {
      scrollToCurrent()
      release = setTimeout(() => {
        isResizingRef.current = false
      }, 50)
    }, 150)
    return () => {
      clearTimeout(timer)
      clearTimeout(release)
      isResizingRef.current = false
    }
  }, [viewMode, isLoading])

  // Intersection observer scroll listener for Page/Text/OCR View
  const handleScroll = () => {
    if (!scrollContainerRef.current || isLoading || isResizingRef.current) return
    const container = scrollContainerRef.current
    const scrollTop = container.scrollTop
    const containerHeight = container.clientHeight
    
    const selector = viewMode === 'page' 
      ? '.pdf-page-wrapper' 
      : viewMode === 'text'
        ? '.pdf-text-page-wrapper'
        : '.pdf-ocr-page-wrapper'
        
    const pageElements = container.querySelectorAll(selector)
    
    let activePage = 1
    let maxVisibleHeight = 0

    pageElements.forEach((el: any) => {
      const elTop = el.offsetTop - container.offsetTop
      const elHeight = el.offsetHeight
      
      const visibleTop = Math.max(scrollTop, elTop)
      const visibleBottom = Math.min(scrollTop + containerHeight, elTop + elHeight)
      const visibleHeight = Math.max(0, visibleBottom - visibleTop)

      if (visibleHeight > maxVisibleHeight) {
        maxVisibleHeight = visibleHeight
        activePage = parseInt(el.dataset.pageNumber) || 1
      }
    })

    if (activePage !== currentPage && activePage > 0) {
      setCurrentPage(activePage)
      saveProgress(activePage)
    }
  }

  // Click navigation (mirroring EpubReader left/right zones)
  const handleContainerClick = (e: React.MouseEvent) => {
    const width = window.innerWidth
    const x = e.clientX

    if (x < width * 0.2) {
      // Go Prev Page
      if (currentPage > 1) {
        const prevPage = currentPage - 1
        setCurrentPage(prevPage)
        saveProgress(prevPage)
        
        const selector = viewMode === 'page'
          ? `[data-page-number="${prevPage}"]`
          : viewMode === 'text'
            ? `.pdf-text-page-wrapper[data-page-number="${prevPage}"]`
            : `.pdf-ocr-page-wrapper[data-page-number="${prevPage}"]`
            
        setTimeout(() => {
          const el = scrollContainerRef.current?.querySelector(selector)
          el?.scrollIntoView({ block: 'start' })
        }, 30)
      }
    } else if (x > width * 0.8) {
      // Go Next Page
      if (currentPage < numPages) {
        const nextPage = currentPage + 1
        setCurrentPage(nextPage)
        saveProgress(nextPage)
        
        const selector = viewMode === 'page'
          ? `[data-page-number="${nextPage}"]`
          : viewMode === 'text'
            ? `.pdf-text-page-wrapper[data-page-number="${nextPage}"]`
            : `.pdf-ocr-page-wrapper[data-page-number="${nextPage}"]`
            
        setTimeout(() => {
          const el = scrollContainerRef.current?.querySelector(selector)
          el?.scrollIntoView({ block: 'start' })
        }, 30)
      }
    } else {
      // Center: toggle panels
      setShowControls(prev => !prev)
      setShowSettings(false)
      setShowToc(false)
      setShowTranslate(false)
    }
  }

  const jumpToPage = (pageNum: number) => {
    setCurrentPage(pageNum)
    saveProgress(pageNum)
    setShowToc(false)
    
    setTimeout(() => {
      const selector = viewMode === 'page' 
        ? `[data-page-number="${pageNum}"]` 
        : viewMode === 'text'
          ? `.pdf-text-page-wrapper[data-page-number="${pageNum}"]`
          : `.pdf-ocr-page-wrapper[data-page-number="${pageNum}"]`
          
      const el = scrollContainerRef.current?.querySelector(selector)
      el?.scrollIntoView({ block: 'start' })
    }, 50)
  }

  // Style configurations
  const getWrapperThemeClass = () => {
    if (theme === 'light') return 'bg-white text-slate-900 border-slate-200'
    if (theme === 'eink') return 'bg-white text-black border border-black'
    if (theme === 'custom') return ''
    return 'bg-[#333333] text-[#e0e0e0] border-zinc-700'
  }

  const getCustomStyle = () => {
    if (theme === 'custom') {
      return { backgroundColor: customColors.bg, color: customColors.text }
    }
    return undefined
  }

  const getCustomHeaderStyle = () => {
    if (theme === 'custom') {
      return { 
        backgroundColor: `${customColors.bg}e6`, 
        color: customColors.text, 
        borderColor: `${customColors.text}20` 
      }
    }
    return undefined
  }

  const getContainerClassName = () => {
    if (marginSize === 'compact') return 'w-full max-w-none px-4 pb-20 transition-all duration-300 select-text'
    if (marginSize === 'wide') return 'w-full max-w-xl mx-auto px-8 pb-20 transition-all duration-300 select-text'
    return 'w-full max-w-2xl mx-auto px-6 pb-20 transition-all duration-300 select-text'
  }

  const getFontStack = () => {
    let fontStack = fontFamily
    if (fontFamily === 'font-serif') fontStack = 'Noto Serif, Georgia, serif'
    else if (fontFamily === 'font-sans') fontStack = 'system-ui, -apple-system, sans-serif'
    else if (fontFamily === 'font-mono') fontStack = 'monospace, Courier New'
    return fontStack
  }

  const progressPercent = numPages > 0 ? (currentPage / numPages) * 100 : 0

  if (fileError) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background text-slate-200 p-6">
        <div className="max-w-md text-center space-y-4 bg-card p-8 rounded-2xl border border-border animate-in fade-in zoom-in-95 duration-200">
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-foreground">{t('bookNotAvailable')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('bookNotAvailableDesc')}
          </p>
          {onExit && (
            <button type="button" onClick={onExit} className="inline-block mt-4 px-6 py-2 bg-primary hover:opacity-90 text-primary-foreground font-medium text-sm rounded-full transition-opacity">
              {t('back')}
            </button>
          )}
        </div>
      </div>
    )
  }

  const translationStatusMessage = (() => {
    if (!translationEnabled) return null
    if (!translationSourceLang) return t('translateDetecting')
    if (translationSourceLang === translationTargetLang) return t('translateSameLanguage')
    if (translator.status === 'checking') return t('translateStatusChecking')
    if (translator.status === 'downloading') return `${t('translateStatusDownloading')} ${translator.progress}%`
    if (translator.status === 'ready') return t('translateStatusReady')
    if (translator.status === 'unavailable') return t('translateStatusUnavailable')
    if (translator.status === 'unconfigured') return t('translateStatusUnconfigured')
    if (translator.status === 'error') return t('translateStatusError')
    return null
  })()

  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden transition-colors duration-300 ${getWrapperThemeClass()}`}
      style={getCustomStyle()}
    >
      {/* Floating Header */}
      <div 
        className={`absolute left-0 right-0 top-0 z-30 flex h-[calc(4rem+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)] items-center justify-between border-b px-4 transition-transform duration-300 backdrop-blur-md ${
          theme === 'light' || theme === 'eink' 
            ? 'border-slate-200 bg-white/95 text-slate-900' 
            : 'border-zinc-700 bg-[#333333]/90 text-[#e0e0e0]'
        } ${showControls ? 'translate-y-0' : '-translate-y-full'}`}
        style={getCustomHeaderStyle()}
      >
        <div className="flex items-center gap-3">
          {onExit && (
          <Button 
            variant="ghost" 
            className="h-9 w-9 p-0 hover:bg-slate-800/20"
            aria-label={t('back')}
            title={t('back')}
            onClick={async () => {
              if (syncStatus === 'pending') {
                setToastMessage(t('savingPosition'))
                await flushProgress('exit')
                setToastMessage(t('positionSaved'))
                setTimeout(() => onExit(), 600)
              } else {
                onExit()
              }
            }}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          )}
          <div className="max-w-[150px] sm:max-w-md flex flex-col justify-center">
            <h2 className="truncate text-sm font-semibold">{bookTitle}</h2>
            <SyncStatusIndicator syncStatus={syncStatus} lastSyncedTime={lastSyncedTime} positionText={`${t('page')} ${currentPage} (${numPages > 0 ? Math.round((currentPage / numPages) * 100) : 0}%)`} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Toggle: Page vs Text vs OCR */}
          <Button 
            onClick={() => {
              setViewMode(prev => {
                if (prev === 'page') return 'text'
                if (prev === 'text') return 'ocr'
                return 'page'
              })
              setShowSettings(false)
            }}
            variant="ghost" 
            className="h-9 w-9 p-0 hover:bg-slate-800/20"
            title={
              viewMode === 'page' 
                ? t('viewModeText') 
                : viewMode === 'text' 
                  ? t('viewModeOcr') 
                  : t('viewModePage')
            }
          >
            {viewMode === 'page' && <FileText className="h-5 w-5" />}
            {viewMode === 'text' && <ScanText className="h-5 w-5" />}
            {viewMode === 'ocr' && <Eye className="h-5 w-5" />}
          </Button>

          <Button 
            onClick={() => { setShowToc(!showToc); if (showSettings) setShowSettings(false); }}
            variant="ghost" 
            className="h-9 w-9 p-0 hover:bg-slate-800/20"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <Button
            onClick={() => {
              const val = !blackStatusBar
              setBlackStatusBar(val)
              if (val) {
                if (document.documentElement.requestFullscreen) {
                  document.documentElement.requestFullscreen().catch(err => console.warn(err))
                }
              } else {
                if (document.fullscreenElement && document.exitFullscreen) {
                  document.exitFullscreen().catch(err => console.warn(err))
                }
              }
            }}
            variant="ghost"
            className="h-9 w-9 p-0 hover:bg-slate-800/20"
            title={blackStatusBar ? (t('exitFullscreen')) : (t('fullscreen'))}
          >
            {blackStatusBar ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </Button>
          
          <Button
            onClick={() => { setShowSettings(!showSettings); }}
            variant="ghost"
            className={`h-9 w-9 p-0 hover:bg-slate-800/20 ${showSettings ? 'bg-brand/20 text-brand' : ''}`}
          >
            <Settings className="h-5 w-5" />
          </Button>

          {translateAdapter && (
          <Button
            onClick={() => { setShowTranslate(!showTranslate); setShowSettings(false); setShowToc(false); }}
            variant="ghost"
            title={t('translateMenuLabel')}
            className={`h-9 w-9 p-0 hover:bg-slate-800/20 ${showTranslate ? 'bg-brand/20 text-brand' : ''}`}
          >
            <Languages className="h-5 w-5" />
          </Button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div 
        onClick={handleContainerClick}
        className="flex-1 w-full cursor-pointer overflow-hidden relative flex justify-center h-full"
      >
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/85 z-20">
            <Loader2 className="h-10 w-10 animate-spin text-brand" />
            <p className="mt-4 text-sm text-slate-400 font-medium">{t('preparingPdf')}</p>
          </div>
        )}

        <div 
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-full w-full overflow-y-auto pb-20 scroll-smooth no-scrollbar"
          style={{ scrollbarWidth: 'none', paddingTop: 'calc(5rem + env(safe-area-inset-top, 0px))' }}
        >
          {viewMode === 'page' && (
            <div className="max-w-4xl mx-auto flex flex-col items-center px-2">
              {pdfDocument && Array.from({ length: numPages }, (_, i) => (
                <PdfPage 
                  key={i + 1} 
                  pdfDoc={pdfDocument} 
                  pageNumber={i + 1} 
                  scale={zoomScale} 
                  currentPage={currentPage}
                />
              ))}
            </div>
          )}

          {viewMode === 'text' && (
            <div 
              className={getContainerClassName()}
              style={{
                fontFamily: getFontStack(),
                fontSize: `${fontSize}px`,
                lineHeight: lineHeight,
                fontWeight: theme === 'eink' ? '600' : 'normal',
                textAlign: textAlign,
              }}
            >
              {pdfDocument && Array.from({ length: numPages }, (_, i) => (
                <PdfTextPage
                  key={i + 1}
                  pdfDoc={pdfDocument}
                  pageNumber={i + 1}
                  language={language}
                  textCache={textCache}
                  extractPageText={extractPageText}
                  currentPage={currentPage}
                  translationEnabled={translationEnabled}
                  translationTargetLang={translationTargetLang}
                  translateText={translatePageText}
                  translatedCache={translatedTextCache}
                />
              ))}
            </div>
          )}

          {viewMode === 'ocr' && (
            <div 
              className={getContainerClassName()}
              style={{
                fontFamily: getFontStack(),
                fontSize: `${fontSize}px`,
                lineHeight: lineHeight,
                fontWeight: theme === 'eink' ? '600' : 'normal',
                textAlign: textAlign,
              }}
            >
              {pdfDocument && Array.from({ length: numPages }, (_, i) => (
                <PdfOcrPage
                  key={i + 1}
                  pdfDoc={pdfDocument}
                  pageNumber={i + 1}
                  language={language}
                  bookId={bookId}
                  ocrCache={ocrCache}
                  currentPage={currentPage}
                  translationEnabled={translationEnabled}
                  translationTargetLang={translationTargetLang}
                  translateText={translatePageText}
                  translatedCache={translatedOcrCache}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Floating Footer Progress Bar */}
      <div 
        className={`absolute bottom-0 left-0 right-0 z-30 flex h-10 items-center justify-between px-6 border-t text-xs backdrop-blur-md transition-transform duration-300 ${
          theme === 'light' || theme === 'eink' 
            ? 'border-slate-200 bg-white/95 text-slate-600' 
            : 'border-zinc-700 bg-[#333333]/90 text-[#e0e0e0]'
        } ${showControls ? 'translate-y-0' : 'translate-y-full'}`}
        style={getCustomHeaderStyle()}
      >
        <span>{t('page')} {currentPage} {t('of')} {numPages}</span>
        <div className="mx-4 h-1.5 flex-1 rounded-full bg-slate-800/50">
          <div 
            className="h-full rounded-full bg-brand transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="font-semibold">{Math.round(progressPercent)}%</span>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div 
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className={`absolute bottom-12 right-4 z-45 w-80 rounded-2xl border p-5 transition-all duration-300 ${
            theme === 'light' || theme === 'eink' ? 'border-slate-200 bg-white text-slate-900' : 'border-zinc-700 bg-[#252525] text-slate-100'
          }`}
          style={theme === 'custom' && customColors ? { backgroundColor: customColors.bg, color: customColors.text, borderColor: `${customColors.text}30` } : undefined}
        >
          <h3 className="mb-4 text-sm font-semibold flex items-center gap-1.5">
            <Type className="h-4 w-4 opacity-60" />
            {t('readingSettings')}
          </h3>

          <div className="space-y-4 text-xs">
            {/* Theme Selector */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">{t('themeLabel')}</label>
              <div className="grid grid-cols-4 gap-2">
                {(['light', 'dark', 'eink', 'custom'] as const).map((thm) => (
                  <button
                    key={thm}
                    onClick={() => setTheme(thm)}
                    className={`h-8 rounded-lg border font-medium text-[10px] capitalize flex items-center justify-center ${
                      thm === 'light' ? 'bg-white text-black border-slate-300' :
                      thm === 'dark' ? 'bg-[#333333] text-white border-zinc-700' :
                      thm === 'eink' ? 'bg-white text-black font-bold border-black border-2' :
                      'border-dashed border-current bg-transparent'
                    } ${theme === thm ? 'ring-2 ring-brand ring-offset-1 ring-offset-background' : ''}`}
                  >
                    {thm === 'light' ? t('themeLight') :
                     thm === 'dark' ? t('themeDark') :
                     thm === 'eink' ? t('themeEink') :
                     t('themeCustom')}
                  </button>
                ))}
              </div>
              
              {theme === 'custom' && (
                <div className="flex items-center gap-4 mt-2 bg-black/20 p-2 rounded border border-border/50">
                  <div className="flex flex-col gap-1 flex-1">
                    <label className="text-[10px] text-slate-400">{t('backgroundColor')}</label>
                    <input type="color" value={customColors.bg} onChange={(e) => setCustomColors(p => ({ ...p, bg: e.target.value }))} className="w-full h-8 rounded cursor-pointer" />
                  </div>
                  <div className="flex flex-col gap-1 flex-1">
                    <label className="text-[10px] text-slate-400">{t('textColor')}</label>
                    <input type="color" value={customColors.text} onChange={(e) => setCustomColors(p => ({ ...p, text: e.target.value }))} className="w-full h-8 rounded cursor-pointer" />
                  </div>
                </div>
              )}
            </div>

            {/* Page Zoom (Only applicable to page mode) */}
            {viewMode === 'page' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                    {t('zoomLabel')}
                  </label>
                  <span className="font-semibold">{Math.round(zoomScale * 100)}%</span>
                </div>
                <div className="flex items-center gap-3">
                  <Button 
                    onClick={() => setZoomScale(prev => Math.max(0.8, Math.round((prev - 0.1) * 10) / 10))}
                    variant="outline" className="h-8 w-8 p-0 bg-transparent border-slate-500/40 text-current hover:bg-slate-800/20 hover:text-current"
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <div className="flex-1 h-1 bg-slate-800/50 rounded-full overflow-hidden relative">
                    <input 
                      type="range" min="0.8" max="2.5" step="0.1"
                      value={zoomScale} onChange={(e) => setZoomScale(parseFloat(e.target.value))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="h-full bg-brand pointer-events-none" style={{ width: `${((zoomScale - 0.8) / 1.7) * 100}%` }} />
                  </div>
                  <Button 
                    onClick={() => setZoomScale(prev => Math.min(2.5, Math.round((prev + 0.1) * 10) / 10))}
                    variant="outline" className="h-8 w-8 p-0 bg-transparent border-slate-500/40 text-current hover:bg-slate-800/20 hover:text-current"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}

            {/* Typography / Spacing / Margins (Only applicable to text/ocr mode) */}
            {viewMode !== 'page' && (
              <>
                {/* Font Family */}
                <div className="space-y-2 opacity-100 transition-opacity">
                  <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                    {t('fontFamilyLabel')}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'font-serif', label: 'Serif', family: 'Noto Serif, Georgia, serif' },
                      { id: 'font-sans', label: 'Sans', family: 'system-ui, -apple-system, sans-serif' },
                      { id: 'font-mono', label: 'Mono', family: 'monospace, Courier New' }
                    ].map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setFontFamily(f.id)}
                        className={`h-8 rounded-lg border text-center transition-colors ${
                          theme === 'dark' || theme === 'custom'
                            ? 'border-zinc-700 hover:bg-zinc-700 bg-[#2a2a2a]' 
                            : 'border-slate-200 hover:bg-slate-100 bg-slate-50'
                        } ${fontFamily === f.id ? 'border-brand bg-brand/10 text-brand' : ''}`}
                        style={{ fontFamily: f.family }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 relative">
                    <select 
                      value={fontFamily} 
                      onChange={(e) => setFontFamily(e.target.value)}
                      className={`w-full h-8 rounded-lg border pl-2 pr-8 text-xs appearance-none outline-none cursor-pointer ${
                        theme === 'dark' || theme === 'custom' ? 'bg-[#2a2a2a] border-zinc-700 text-[#e0e0e0]' : 'bg-white border-slate-200 text-slate-900'
                      }`}
                      style={{ fontFamily: fontFamily.startsWith('font-') ? 'inherit' : fontFamily }}
                    >
                      <option value="" disabled>{t('moreFonts')}</option>
                      {GOOGLE_FONTS.map(font => (
                        <option key={font} value={font} style={{ fontFamily: font }}>
                          {font}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
                      <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                        <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Font Size */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                      {t('textSizeLabel')}
                    </label>
                    <span className="font-semibold">{fontSize}px</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button 
                      onClick={() => setFontSize(prev => Math.max(12, prev - 1))}
                      variant="outline" className="h-8 w-8 p-0 bg-transparent border-slate-500/40 text-current hover:bg-slate-800/20 hover:text-current"
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <div className="flex-1 h-1 bg-slate-800/50 rounded-full overflow-hidden relative">
                      <input 
                        type="range" min="12" max="40" 
                        value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div className="h-full bg-brand pointer-events-none" style={{ width: `${((fontSize - 12) / 28) * 100}%` }} />
                    </div>
                    <Button 
                      onClick={() => setFontSize(prev => Math.min(40, prev + 1))}
                      variant="outline" className="h-8 w-8 p-0 bg-transparent border-slate-500/40 text-current hover:bg-slate-800/20 hover:text-current"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* Line Spacing */}
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                    {t('lineSpacingLabel')}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: '1.2', label: t('lineSpacingNarrow') },
                      { value: '1.5', label: t('lineSpacingNormal') },
                      { value: '1.8', label: t('lineSpacingWide') }
                    ].map((l) => (
                      <button
                        key={l.value}
                        onClick={() => setLineHeight(l.value)}
                        className={`h-8 rounded-lg border text-center transition-colors ${
                          theme === 'dark' || theme === 'custom'
                            ? 'border-zinc-700 hover:bg-zinc-700 bg-[#2a2a2a]' 
                            : 'border-slate-200 hover:bg-slate-100 bg-slate-50'
                        } ${lineHeight === l.value ? 'border-brand bg-brand/10 text-brand' : ''}`}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Text Alignment */}
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                    {t('alignmentLabel')}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'left', label: t('alignmentLeft') },
                      { value: 'justify', label: t('alignmentJustify') },
                      { value: 'right', label: t('alignmentRight') }
                    ].map((a) => (
                      <button
                        key={a.value}
                        onClick={() => setTextAlign(a.value as any)}
                        className={`h-8 rounded-lg border text-center transition-colors text-[10px] font-medium ${
                          theme === 'dark' || theme === 'custom'
                            ? 'border-zinc-700 hover:bg-zinc-700 bg-[#2a2a2a]' 
                            : 'border-slate-200 hover:bg-slate-100 bg-slate-50'
                        } ${textAlign === a.value ? 'border-brand bg-brand/10 text-brand' : ''}`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Margins */}
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                    {t('marginsLabel')}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'compact', label: t('marginsNarrow') },
                      { value: 'normal', label: t('marginsNormal') },
                      { value: 'wide', label: t('marginsWide') }
                    ].map((m) => (
                      <button
                        key={m.value}
                        onClick={() => setMarginSize(m.value as any)}
                        className={`h-8 rounded-lg border text-center transition-colors text-[10px] font-medium ${
                          theme === 'dark' || theme === 'custom'
                            ? 'border-zinc-700 hover:bg-zinc-700 bg-[#2a2a2a]'
                            : 'border-slate-200 hover:bg-slate-100 bg-slate-50'
                        } ${marginSize === m.value ? 'border-brand bg-brand/10 text-brand' : ''}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}



          </div>
        </div>
      )}

      {/* Translate Panel */}
      {showTranslate && translateAdapter && (
        <div
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className={`absolute bottom-12 right-4 z-45 w-80 rounded-2xl border p-5 transition-all duration-300 ${
            theme === 'light' || theme === 'eink' ? 'border-slate-200 bg-white text-slate-900' : 'border-zinc-700 bg-[#252525] text-slate-100'
          }`}
          style={theme === 'custom' && customColors ? { backgroundColor: customColors.bg, color: customColors.text, borderColor: `${customColors.text}30` } : undefined}
        >
          <h3 className="mb-4 text-sm font-semibold flex items-center gap-1.5">
            <Languages className="h-4 w-4 opacity-60" />
            {t('translateTitle')}
          </h3>

          <div className="space-y-4 text-xs">
            {viewMode === 'page' && (
              <p className="text-[11px] text-amber-500">{t('translatePageModeOnly')}</p>
            )}

            <button
              onClick={handleToggleTranslation}
              className={`w-full h-9 rounded-lg border font-medium flex items-center justify-center gap-2 transition-colors ${
                translationEnabled
                  ? 'border-brand bg-brand/10 text-brand'
                  : theme === 'dark' || theme === 'custom'
                    ? 'border-zinc-700 hover:bg-zinc-700 bg-[#2a2a2a]'
                    : 'border-slate-200 hover:bg-slate-100 bg-slate-50'
              }`}
            >
              {translationEnabled && <Check className="h-3.5 w-3.5" />}
              {t('translateToggleLabel')}
            </button>

            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                {t('translateTargetLabel')}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {targetLanguageOptions(translationSourceLang).map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => setTranslationTargetLang(lang.code)}
                    className={`h-8 rounded-lg border text-center transition-colors text-[10px] font-medium ${
                      theme === 'dark' || theme === 'custom'
                        ? 'border-zinc-700 hover:bg-zinc-700 bg-[#2a2a2a]'
                        : 'border-slate-200 hover:bg-slate-100 bg-slate-50'
                    } ${translationTargetLang === lang.code ? 'border-brand bg-brand/10 text-brand' : ''}`}
                  >
                    {lang.name}
                  </button>
                ))}
              </div>
            </div>

            {translationStatusMessage && (
              <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
                {(translator.status === 'checking' || translator.status === 'downloading') && (
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                )}
                {translationStatusMessage}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Table of Contents Drawer */}
      {showToc && (
        <div className={`absolute bottom-0 right-0 top-0 z-50 w-72 transition-all duration-300 border-l ${
          theme === 'dark' || theme === 'custom' ? 'border-zinc-700 bg-[#252525] text-[#e0e0e0]' : 'border-slate-200 bg-white text-slate-900'
        }`}>
          <div className="flex h-16 items-center justify-between px-5 border-b border-border/10">
            <h3 className="font-semibold text-sm flex items-center gap-1.5">
              <BookOpen className="h-4 w-4 opacity-60" />
              {t('tocTitle')}
            </h3>
            <Button 
              onClick={() => setShowToc(false)}
              variant="ghost" 
              className="h-8 w-8 p-0 hover:bg-slate-800/20"
            >
              <ArrowLeft className="h-4 w-4 rotate-180" />
            </Button>
          </div>

          <div className="h-[calc(100vh-4rem)] overflow-y-auto p-4 space-y-1.5">
            {toc.length === 0 ? (
              // If PDF outline is missing, provide direct links to pages (bookmarks) every 10 pages for quick jumping
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground block mb-2 px-1">{t('documentSections')}</span>
                {Array.from({ length: Math.ceil(numPages / 10) }, (_, i) => {
                  const pageNum = i * 10 + 1
                  return (
                    <button
                      key={pageNum}
                      onClick={() => jumpToPage(pageNum)}
                      className={`flex w-full items-center justify-between rounded-lg p-2 text-left text-xs transition-colors hover:bg-slate-800/20 ${
                        currentPage >= pageNum && currentPage < pageNum + 10
                          ? 'bg-brand/10 text-brand font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <span>{t('page')} {pageNum}</span>
                      <ChevronRight className="h-3 w-3 text-slate-500" />
                    </button>
                  )
                })}
                {numPages % 10 !== 1 && (
                  <button
                    onClick={() => jumpToPage(numPages)}
                    className={`flex w-full items-center justify-between rounded-lg p-2 text-left text-xs transition-colors hover:bg-slate-800/20 ${
                      currentPage === numPages
                        ? 'bg-brand/10 text-brand font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span>{t('lastPage')} ({numPages})</span>
                    <ChevronRight className="h-3 w-3 text-slate-500" />
                  </button>
                )}
              </div>
            ) : (
              toc.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => jumpToPage(item.page!)}
                  className={`flex w-full items-center justify-between rounded-lg p-2.5 text-left text-xs transition-colors hover:bg-slate-800/20 ${
                    currentPage === item.page
                      ? 'bg-brand/10 text-brand font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="truncate pr-2">{item.label}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[9px] opacity-70">p. {item.page}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}



      {/* Position Sync Conflict Modal */}
      {syncConflict && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-popover border border-border rounded-2xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200 text-foreground" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-lg text-foreground mb-2 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              {t('syncPositionTitle')}
            </h3>
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              {t('syncPositionDesc')}
            </p>

            <div className="space-y-3 mb-6">
              {/* Local Position Card */}
              <div className="p-4 rounded-xl border border-zinc-800 bg-[#252525] flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">{t('positionOnDevice')}</span>
                <div className="flex justify-between items-baseline mt-1">
                  <span className="text-lg font-bold text-slate-100">
                    {t('page')} {parseInt(syncConflict.local.cfi.replace('page:', '')) || 1} ({Math.round(syncConflict.local.percent)}%)
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {formatRelativeTime(labels, syncConflict.local.time)} ({new Date(syncConflict.local.time || new Date()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                  </span>
                </div>
              </div>

              {/* Cloud Position Card */}
              <div className="p-4 rounded-xl border border-zinc-800 bg-[#252525] flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-brand">{t('cloudPosition')}</span>
                <div className="flex justify-between items-baseline mt-1">
                  <span className="text-lg font-bold text-brand">
                    {t('page')} {parseInt(syncConflict.db.cfi.replace('page:', '')) || 1} ({Math.round(syncConflict.db.percent)}%)
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {formatRelativeTime(labels, syncConflict.db.time)} ({new Date(syncConflict.db.time || new Date()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <Button
                onClick={() => handleResolveConflict(false)}
                variant="outline"
                className="h-10 px-4 rounded-xl text-xs font-semibold border-zinc-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                {t('stayHere')}
              </Button>
              <Button
                onClick={() => handleResolveConflict(true)}
                className="h-10 px-4 rounded-full text-xs font-semibold bg-primary hover:opacity-90 text-primary-foreground"
              >
                {t('goToCloud')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] rounded-full bg-foreground text-background px-4 py-2.5 text-xs font-semibold animate-in slide-in-from-bottom-4 duration-300 flex items-center gap-2">
          <Check className="h-4 w-4" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  )
}
