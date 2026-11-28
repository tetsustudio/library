'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from './ui/button.js'
import {
  ArrowLeft, Settings, Settings2, Menu, BookOpen,
  Minus, Plus, Type, Loader2, ChevronRight,
  Maximize2, Minimize2, Check, MoreVertical, Search, X, Languages
} from 'lucide-react'
import { searchBook, MIN_QUERY_LENGTH, type BookSearchHit } from '../lib/book-search.js'
import { useReaderContext, useTranslation } from '../context.js'
import { format, formatRelativeTime } from '../labels.js'
import { SyncStatusIndicator } from './ui/sync-status-indicator.js'
import { TTSPlayer } from './tts-player.js'
import {
  buildSearchIndex,
  locateChunk,
  sliceByNode,
  decideHighlightScroll,
} from '../lib/text-highlight.js'
import {
  targetLanguageOptions,
  normalizeLanguageCode,
  detectLanguage,
} from '../lib/translate.js'
import { useBookTranslator } from '../hooks/use-book-translator.js'
import { useGoogleFonts, injectGoogleFonts, GOOGLE_FONTS } from '../hooks/use-google-fonts.js'
import { readSettings, writeSettings } from '../lib/settings.js'
import { loadBookSource } from '../lib/book-source.js'
import type { ReaderProps, TocItem } from '../types.js'


import { useReadingProgress } from '../hooks/use-reading-progress.js'

/**
 * Va a una posicion guardada. El `cfi` puede ser un CFI real, un
 * `percent:NN` (fallback de cuando no habia locations) o vacio. Los prefijos
 * `status:` ya no se guardan, pero pueden seguir vivos en caches viejas.
 */
function displayAt(rendition: any, book: any, cfi: string | null | undefined) {
  try {
    let target = cfi || ''
    if (target.startsWith('status:leido|')) target = target.substring('status:leido|'.length)
    if (target.startsWith('status:')) target = ''

    if (!target) {
      rendition.display()
      return
    }

    if (target.startsWith('percent:')) {
      const value = parseFloat(target.replace('percent:', ''))
      const generated = book?.locations?.cfiFromPercentage(value / 100)
      if (generated) rendition.display(generated)
      else rendition.display()
      return
    }

    rendition.display(target)
  } catch (err) {
    console.error('No se pudo ir a la posicion guardada:', err)
    rendition.display()
  }
}

export type EpubReaderProps = ReaderProps

/** La clase del resaltado del TTS dentro del iframe del libro. */
const TTS_HIGHLIGHT_CLASS = 'glimpse-tts-highlight'

/** Etiquetas que separan parrafos al leer en voz alta. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'LI', 'UL', 'OL',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'TD', 'TH', 'PRE', 'FIGCAPTION', 'BR',
])

/**
 * El texto de un fragmento del DOM, con los limites de parrafo marcados.
 *
 * `Range.toString()` no sirve para esto: concatena los nodos de texto sin
 * separar nada, asi que el final de un parrafo queda pegado al principio del
 * siguiente. El troceado del TTS corta por parrafo, y sin estos saltos no
 * tiene donde cortar — un parrafo corto se juntaba con el de al lado y el
 * resaltado quedaba a caballo entre los dos.
 */
function fragmentToText(node: Node): string {
  const parts: string[] = []

  const walk = (current: Node) => {
    if (current.nodeType === Node.TEXT_NODE) {
      parts.push(current.nodeValue ?? '')
      return
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return

    const element = current as Element
    const tag = element.tagName
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return

    const isBlock = BLOCK_TAGS.has(tag)
    if (isBlock) parts.push('\n\n')
    element.childNodes.forEach(walk)
    if (isBlock) parts.push('\n\n')
  }

  node.childNodes.forEach(walk)

  // Los saltos triples o mas colapsan a uno doble: un <div><p> anidado mete
  // dos marcas seguidas y no son dos parrafos.
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim()
}

/** Cuanto texto se pide por vez al continuar la lectura. Suficiente para
 *  varios parrafos, poco como para no adelantarse media pantalla del libro. */
const READ_AHEAD_CHARS = 1_200

/**
 * El texto que sigue a un elemento, en bloques enteros.
 *
 * Esto es lo que reemplaza a llamar `rendition.next()` en cada tanda, y es el
 * cambio de fondo: antes habia **dos cosas moviendo el scroll** —el avance de
 * pagina y el resaltado— y se peleaban. El avance saltaba una pantalla entera,
 * el resaltado corregia, y entre las dos la posicion terminaba en cualquier
 * lado.
 *
 * Ahora la lectura no pasa de pagina: pide el texto que sigue y deja que el
 * scroll lo arrastre el propio resaltado, parrafo a parrafo. `next()` queda
 * solo para cuando se acabo la seccion.
 *
 * Se devuelven bloques completos porque el troceado corta por parrafo: entregar
 * medio parrafo lo partiria al medio.
 */
function textAfterElement(doc: Document, from: Element | null, budget = READ_AHEAD_CHARS): string {
  if (!doc.body) return ''

  const blocks = Array.from(doc.body.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, h5, h6, pre'))
  if (blocks.length === 0) return ''

  // Desde el bloque siguiente al que contiene el ultimo resaltado. Sin
  // referencia, desde el principio.
  let startAt = 0
  if (from) {
    const containing = blocks.findIndex((block) => block.contains(from))
    startAt = containing === -1 ? 0 : containing + 1
  }

  const parts: string[] = []
  let total = 0
  for (let i = startAt; i < blocks.length && total < budget; i++) {
    const text = (blocks[i].textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    parts.push(text)
    total += text.length
  }

  return parts.join('\n\n')
}

/**
 * Cuantas pantallas de distancia se consideran un salto imposible.
 *
 * Si el tramo a resaltar cae mas lejos que esto, casi seguro es una
 * coincidencia equivocada (un fragmento repetido, o la busqueda que volvio al
 * principio del capitulo). Y en modo continuo scrollear hasta ahi **mueve la
 * posicion de lectura de verdad**: el manager carga las secciones vecinas, la
 * posicion se guarda, y el libro salta varios capitulos. Ante la duda se
 * resalta igual pero no se mueve la vista.
 */
const MAX_HIGHLIGHT_JUMP_VIEWPORTS = 3

/**
 * Lleva el resaltado al centro de la pantalla, si se fue para abajo.
 *
 * **La vista solo se mueve hacia adelante.** La version anterior tambien
 * corregia cuando el tramo quedaba muy arriba —tapado por la barra flotante—
 * y eso, al arrancar la lectura, era un scroll para atras en el momento exacto
 * en que apretas play: el primer tramo esta arriba de todo por definicion. El
 * comentario decia "nunca por estar demasiado arriba" y el codigo hacia
 * justamente eso.
 *
 * Consecuencia asumida: si scrolleas a mano y dejas el tramo por encima de la
 * pantalla, la vista no vuelve sola a buscarlo. Es lo correcto — moviste vos.
 */
/** Abajo de esto se considera que se fue de la zona comoda de lectura. */
const HIGHLIGHT_BOTTOM_LIMIT = 0.75

/**
 * Donde aterriza el arranque del tramo cuando hay que moverlo.
 *
 * Lo usa el guard de "nunca para atras" Y el `scroll-margin-top` del CSS que
 * se inyecta en el libro. Tienen que ser el mismo numero: si el CSS dijera
 * 45vh y el guard comparara contra otra cosa, el guard dejaria pasar scrolls
 * que terminan yendo para atras. Por eso sale de aca y no esta escrito dos
 * veces.
 */
const HIGHLIGHT_TARGET_TOP = 0.45

/**
 * El elemento que scrollea de verdad.
 *
 * El lector se monta con `renderTo(..., { height: '100%' })`, asi que el que
 * scrollea es el contenedor del manager continuo y no la ventana. Se busca
 * subiendo desde el iframe en vez de guardarse una referencia porque el
 * manager arma y rearma esa caja por su cuenta.
 */
function scrollingAncestor(from: HTMLElement | null): HTMLElement | null {
  let el = from?.parentElement ?? null
  while (el) {
    const overflowY = el.ownerDocument.defaultView?.getComputedStyle(el).overflowY ?? ''
    if (/(auto|scroll|overlay)/.test(overflowY) && el.scrollHeight > el.clientHeight) return el
    el = el.parentElement
  }
  return null
}

/**
 * **Se scrollea un solo elemento, a mano.**
 *
 * Antes esto era `scrollIntoView` sobre el span resaltado, que vive adentro del
 * iframe del libro. `scrollIntoView` mueve TODOS los ancestros scrolleables
 * hasta dejar el elemento a la vista: el documento del iframe, el contenedor
 * del manager y la ventana. Con `behavior: 'smooth'` cada uno anima por su
 * lado, y eso se ve como el scroll moviendose, frenando y despues acomodandose
 * un poco mas abajo. Era un solo pedido y dos scrolleadores.
 *
 * Calcular el desplazamiento y aplicarlo sobre el contenedor deja una sola
 * animacion, y de paso saca del medio la semantica de `scroll-margin`, que
 * adentro del iframe se interpretaba en unidades del capitulo.
 */
function scrollHighlightIntoView(doc: Document, first: HTMLElement, last: HTMLElement) {
  const frame = doc.defaultView?.frameElement as HTMLElement | null
  const scroller = scrollingAncestor(frame)
  if (!scroller) return

  const frameTop = frame ? frame.getBoundingClientRect().top : 0
  const scrollerTop = scroller.getBoundingClientRect().top

  // Todo relativo a la caja que scrollea, no a la ventana: son cosas distintas
  // apenas el lector no ocupa la pantalla entera.
  const top = frameTop + first.getBoundingClientRect().top - scrollerTop
  const bottom = frameTop + last.getBoundingClientRect().bottom - scrollerTop
  const viewport = scroller.clientHeight

  // La decision vive en decideHighlightScroll, testeada. Aca solo se miden las
  // cajas y se ejecuta: es la parte que necesita un libro de verdad y por eso
  // es la que no se puede probar.
  const decision = decideHighlightScroll(
    { top, bottom, viewport },
    {
      bottomLimit: HIGHLIGHT_BOTTOM_LIMIT,
      targetTop: HIGHLIGHT_TARGET_TOP,
      maxJumpViewports: MAX_HIGHLIGHT_JUMP_VIEWPORTS,
    }
  )

  if (decision === 'demasiado-lejos') {
    console.warn('TTS: el tramo a resaltar quedo demasiado lejos, no se mueve la vista')
    return
  }
  if (decision !== 'mover') return

  // `mover` ya garantiza que esto es positivo: la funcion no lo devuelve si el
  // tramo esta arriba del objetivo. La vista solo va hacia adelante.
  scroller.scrollBy({ top: top - viewport * HIGHLIGHT_TARGET_TOP, behavior: 'smooth' })
}

/**
 * Los documentos montados, con el de la seccion que se esta viendo primero.
 *
 * **`getContents()[0]` no es la seccion visible.** El manager continuo tiene
 * varias secciones montadas a la vez (la de antes, la actual, la de despues) y
 * devuelve todas en el orden en que las monto: el indice 0 suele ser la
 * ANTERIOR. Mientras el texto a leer salia de `contents[0]` eso no se notaba
 * —se leia y se resaltaba en el mismo documento equivocado— pero desde que el
 * texto sale del rango visible por CFI, resaltar en `[0]` significa buscar el
 * fragmento en un capitulo que no es el que suena.
 */
function orderedContents(rendition: any): any[] {
  const raw = rendition?.getContents?.() ?? []
  const list: any[] = (Array.isArray(raw) ? raw : [raw]).filter(Boolean)
  if (list.length <= 1) return list

  const index = rendition?.currentLocation?.()?.start?.index
  if (typeof index !== 'number') return list

  return [
    ...list.filter((contents) => contents?.sectionIndex === index),
    ...list.filter((contents) => contents?.sectionIndex !== index),
  ]
}

/** Los nodos de texto del capitulo, en orden de lectura. */
function collectTextNodes(doc: Document): Text[] {
  if (!doc.body) return []

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT
      const tag = node.parentElement?.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const nodes: Text[] = []
  let current = walker.nextNode()
  while (current) {
    nodes.push(current as Text)
    current = walker.nextNode()
  }
  return nodes
}

/**
 * Saca los spans del resaltado y vuelve a pegar los nodos de texto.
 *
 * El `normalize()` no es opcional: envolver parte el nodo de texto en tres, y
 * sin volver a unirlos el documento acumula fragmentos con cada oracion leida.
 */
function removeHighlight(doc: Document) {
  doc.querySelectorAll('.' + TTS_HIGHLIGHT_CLASS).forEach(span => {
    const parent = span.parentNode
    if (!parent) return
    while (span.firstChild) parent.insertBefore(span.firstChild, span)
    parent.removeChild(span)
  })
  doc.body?.normalize()
}

export const EpubReaderView = ({ src: initialUrl, bookId, title: bookTitle, initialProgress, onProgress, onExit, mode }: EpubReaderProps) => {
  const { t, language, labels } = useTranslation()
  const { storage, translate: translateAdapter, storagePrefix, googleFonts } = useReaderContext()
  const labelsRef = useRef(labels)
  labelsRef.current = labels
  const googleFontsRef = useRef(googleFonts)
  googleFontsRef.current = googleFonts
  const [bookUrl, setBookUrl] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [showControls, setShowControls] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showToc, setShowToc] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showVoices, setShowVoices] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showTranslate, setShowTranslate] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [toc, setToc] = useState<TocItem[]>([])

  const [fileError, setFileError] = useState(false)

  // Custom Reader Settings
  const [fontFamily, setFontFamily] = useState('font-serif')
  const [fontSize, setFontSize] = useState(16) // in px
  const [lineHeight, setLineHeight] = useState('1.5')
  const [theme, setTheme] = useState<string>(mode === 'light' ? 'light' : 'dark') // 'light', 'dark', 'eink', 'custom'
  const [textAlign, setTextAlign] = useState<'left' | 'right' | 'justify'>('justify')
  const [customColors, setCustomColors] = useState({ bg: '#090909', text: '#ffffff' })
  const [marginSize, setMarginSize] = useState<'compact' | 'normal' | 'wide'>('normal')
  const [blackStatusBar, setBlackStatusBar] = useState(true)

  // Traduccion en vivo del contenido (no del archivo, ver CLAUDE.md).
  const [translationEnabled, setTranslationEnabled] = useState(false)
  const [translationTargetLang, setTranslationTargetLang] = useState('en')
  const [translationSourceLang, setTranslationSourceLang] = useState<string | null>(null)
  const translator = useBookTranslator(translationEnabled && !!translateAdapter, translationSourceLang, translationTargetLang, translateAdapter)
  const translatorRef = useRef(translator)
  translatorRef.current = translator
  // Texto original de cada nodo traducido, para poder restaurarlo si se apaga
  // la traduccion sin tener que re-renderizar la seccion entera.
  const originalTextRef = useRef<WeakMap<Text, string>>(new WeakMap())

  const readerContainerRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<any>(null)
  const renditionRef = useRef<any>(null)
  const isResizingRef = useRef(false)
  /**
   * El ancho de la ventana la ultima vez que se rearmo el layout.
   *
   * El lector va en `flow: 'scrolled'`: el texto fluye en una sola columna, asi
   * que **donde corta cada linea depende del ancho y de nada mas**. Un cambio
   * de alto no obliga a rearmar nada.
   */
  const viewportWidthRef = useRef(0)
  useGoogleFonts(googleFonts)

  const [renditionReady, setRenditionReady] = useState(false)

  const {
    percent: progressPercent,
    setPercent: setProgressPercent,
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
  const [activeImageSrc, setActiveImageSrc] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)


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

  const injectStyles = useCallback((doc: Document) => {
    if (!doc) return

    // 1. Disable all stylesheets belonging to the book
    try {
      const styleSheets = doc.styleSheets
      if (styleSheets) {
        for (let i = 0; i < styleSheets.length; i++) {
          const sheet = styleSheets[i]
          if (sheet.ownerNode && (sheet.ownerNode as HTMLElement).id === 'glimpse-reader-styles') {
            continue
          }
          if (sheet.ownerNode && (sheet.ownerNode as HTMLElement).id === 'google-fonts-iframe') {
            continue
          }
          sheet.disabled = true
        }
      }
    } catch (err) {
      console.warn('Failed to disable book stylesheets', err)
    }

    // 2. Remove styling elements from the DOM to be thorough
    try {
      const links = doc.querySelectorAll('link[rel="stylesheet"]')
      links.forEach((link) => {
        if (link.id !== 'google-fonts-iframe') {
          link.remove()
        }
      })
      const styles = doc.querySelectorAll('style')
      styles.forEach((style) => {
        if (style.id !== 'glimpse-reader-styles') {
          style.remove()
        }
      })
    } catch (err) {
      console.warn('Failed to remove book styling elements', err)
    }

    // 3. Insert or update our custom reader stylesheet
    let styleEl = doc.getElementById('glimpse-reader-styles') as HTMLStyleElement
    if (!styleEl) {
      styleEl = doc.createElement('style')
      styleEl.id = 'glimpse-reader-styles'
      const target = doc.head || doc.getElementsByTagName('head')[0] || doc.documentElement
      if (target) {
        target.appendChild(styleEl)
      }
    }

    let bg = '#ffffff'
    let text = '#0f172a'
    let headingColor = '#0f172a'
    if (theme === 'dark') {
      bg = '#333333'
      text = '#e0e0e0'
      headingColor = '#ffffff'
    } else if (theme === 'eink') {
      bg = '#ffffff'
      text = '#000000'
      headingColor = '#000000'
    } else if (theme === 'custom') {
      bg = customColors.bg
      text = customColors.text
      headingColor = customColors.text
    }

    let fontStack = fontFamily
    if (fontFamily === 'font-serif') fontStack = 'Noto Serif, Georgia, serif'
    else if (fontFamily === 'font-sans') fontStack = 'system-ui, -apple-system, sans-serif'
    else if (fontFamily === 'font-mono') fontStack = 'monospace, Courier New'
    else fontStack = fontFamily

    const isEink = theme === 'eink'
    const fontWeight = isEink ? '600' : 'normal'
    const linkColor = theme === 'custom' ? customColors.text : (theme === 'dark' ? '#e0e0e0' : (theme === 'eink' ? '#000000' : '#0f172a'))

    // Suave: lo justo para ver por donde va sin competir con el texto. En
    // e-ink el color no sirve — la pantalla es gris — asi que va un gris.
    const highlightColor = isEink ? 'rgba(0, 0, 0, 0.14)' : 'rgba(42, 157, 143, 0.22)'

    let sidePadding = '1.5rem'
    if (marginSize === 'compact') sidePadding = '0.5rem'
    else if (marginSize === 'wide') sidePadding = '3rem'

    // OJO: esto es un template literal. Un backtick adentro del CSS —aunque
    // sea en un comentario— corta la cadena y el archivo deja de compilar con
    // un error que apunta a cualquier lado. Ya paso tres veces: nada de
    // backticks de acá para abajo.
    styleEl.textContent = `
      *, *:before, *:after {
        background-color: ${bg} !important;
        background: ${bg} !important;
        color: ${text} !important;
      }
      ::selection {
        background: rgba(42, 157, 143, 0.4) !important;
        color: inherit !important;
      }
      /* El resaltado de la lectura en voz alta. Va como span propio y no como
         ::selection por dos razones: un click colapsa la seleccion y apagaba
         el resaltado con la voz todavia hablando, y ::selection acepta cuatro
         propiedades, ninguna de ellas border-radius.
         El !important es para ganarle al selector universal de arriba, que
         pisa el fondo de todo; la clase tiene mas especificidad, asi que gana.
         box-decoration-break: clone redondea cada renglon por separado cuando
         el fragmento ocupa mas de una linea. */
      .${TTS_HIGHLIGHT_CLASS} {
        background-color: ${highlightColor} !important;
        border-radius: 0.35em !important;
        padding: 0.08em 0.2em !important;
        margin: 0 -0.2em !important;
        -webkit-box-decoration-break: clone !important;
        box-decoration-break: clone !important;
        transition: background-color 200ms ease !important;
        /* **Nada de vh, vw ni % de viewport en este CSS.** Se inyecta DENTRO
           del iframe del libro, y en modo scrolled epubjs le da al iframe el
           alto completo del capitulo (expand() -> contents.textHeight()), asi
           que 1vh aca es 1% del capitulo, no de la pantalla. El
           scroll-margin-top de 45vh que estaba aca eran 45% del CAPITULO: en
           uno largo, varias pantallas de margen, y scrollIntoView scrolleaba
           todo eso para atras para dejarlo libre. Ese era el scroll para atras
           del TTS, y por eso no aparecia mirando el guard en JS: el guard mide
           en px de ventana y el efecto pasaba en unidades del capitulo.
           Ya no hay ningun scroll-margin: scrollHighlightIntoView calcula el
           desplazamiento y lo aplica sobre el contenedor que scrollea. */
      }
      h1, h1 *, h2, h2 *, h3, h3 *, h4, h4 *, h5, h5 *, h6, h6 * {
        color: ${headingColor} !important;
        background-color: transparent !important;
        background: transparent !important;
      }
      a[href], a[href] * {
        color: ${linkColor} !important;
      }
      body {
        padding: calc(4.5rem + env(safe-area-inset-top, 0px)) ${sidePadding} 2.5rem ${sidePadding} !important;
      }
      body, p, span, div, li, a, blockquote, pre, code, td, th {
        font-family: ${fontStack} !important;
        font-size: ${fontSize}px !important;
        line-height: ${lineHeight} !important;
        font-weight: ${fontWeight} !important;
        text-align: ${textAlign} !important;
      }
      html, body {
        -ms-overflow-style: none !important;
        scrollbar-width: none !important;
      }
      html::-webkit-scrollbar, body::-webkit-scrollbar {
        display: none !important;
      }
      img {
        max-width: 100% !important;
        /* En px por lo mismo que el scroll-margin: aca 70vh serian 70% del
           CAPITULO, o sea ningun tope real en uno largo. */
        max-height: ${Math.round(window.innerHeight * 0.7)}px !important;
        object-fit: contain !important;
        height: auto !important;
        display: block !important;
        margin: 1.5rem auto !important;
        cursor: zoom-in !important;
        border-radius: 6px !important;
      }
    `
  }, [theme, fontFamily, fontSize, lineHeight, textAlign, customColors, marginSize])

  // Load cached settings on mount
  const settingsLoadedRef = useRef(false)
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
        if (p.translationEnabled !== undefined) setTranslationEnabled(p.translationEnabled)
        if (p.translationTargetLang) setTranslationTargetLang(p.translationTargetLang)
        // blackStatusBar no se restaura: el lector siempre abre en pantalla
        // completa, aunque la ultima sesion se haya cerrado sin ella.
      }
    } catch (e) { console.error('Failed to load settings', e) }
    settingsLoadedRef.current = true
  }, [storagePrefix])

  // Save settings on change (after the saved ones were read, or the defaults would overwrite them)
  useEffect(() => {
    if (!settingsLoadedRef.current) return
    writeSettings(storagePrefix, {
      fontFamily, fontSize, lineHeight, theme, customColors, textAlign, marginSize,
      translationEnabled, translationTargetLang
    })
  }, [fontFamily, fontSize, lineHeight, theme, customColors, textAlign, marginSize,
      translationEnabled, translationTargetLang, storagePrefix])


  // Inject theme styles into the main document to color EpubJS outer wrappers and iframes
  useEffect(() => {
    let styleEl = document.getElementById('glimpse-main-reader-styles') as HTMLStyleElement
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = 'glimpse-main-reader-styles'
      document.head.appendChild(styleEl)
    }

    let bg = '#ffffff'
    if (theme === 'dark') {
      bg = '#333333'
    } else if (theme === 'eink') {
      bg = '#ffffff'
    } else if (theme === 'custom') {
      bg = customColors.bg
    }

    styleEl.textContent = `
      body,
      .epubjs-epub,
      .epubjs-section,
      #reader-rendering-area,
      #reader-rendering-area iframe, 
      #reader-rendering-area div {
        background-color: ${bg} !important;
        background: ${bg} !important;
      }
    `
    
    return () => {
      const el = document.getElementById('glimpse-main-reader-styles')
      if (el) el.remove()
    }
  }, [theme, customColors])



  // Dynamic theme-color based on active theme
  useEffect(() => {
    // 1. Blending theme-color meta tag
    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }

    let color = '#333333' // default dark
    if (blackStatusBar) {
      color = '#000000'
    } else {
      if (theme === 'light' || theme === 'eink') color = '#ffffff'
      if (theme === 'custom') color = customColors.bg
    }
    meta.setAttribute('content', color)

    return () => {
      // Restore default theme-color
      const defaultMeta = document.querySelector('meta[name="theme-color"]')
      if (defaultMeta) {
        defaultMeta.setAttribute('content', '#090909')
      }
    }
  }, [theme, customColors, blackStatusBar])

  // Synchronize fullscreen state and handle rendition resize to avoid shifting reading position
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = !!document.fullscreenElement
      setBlackStatusBar(isFullscreen)
      
      isResizingRef.current = true
      
      // Delay resize slightly to let browser fullscreen transition finish
      if (renditionRef.current) {
        setTimeout(() => {
          try {
            const currentLoc = renditionRef.current.currentLocation()
            const cfi = currentLoc?.start?.cfi
            
            renditionRef.current.resize()
            
            if (cfi) {
              renditionRef.current.display(cfi)
            }

            // Pantalla completa esconde la barra de estado: cambia el alto de
            // la ventana, y con el el tope en px de las imagenes.
            applyReaderStylesRef.current()
          } catch (e) {
            console.warn('Failed to resize rendition on fullscreen change:', e)
          } finally {
            setTimeout(() => { isResizingRef.current = false }, 100)
          }
        }, 150)
      } else {
        isResizingRef.current = false
      }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])



  const handleResolveConflict = (useDb: boolean) => {
    const chosen = resolveConflict(useDb)
    if (chosen && renditionRef.current) {
      displayAt(renditionRef.current, bookRef.current, chosen.cfi)
    }
  }

  // 1. Resolve the book source: the offline copy when storage has one, else `src`
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
      setBookUrl(result.url)
    })
    return () => { cancelled = true }
  }, [bookId, initialUrl, storage])

  // Refs para que el hook de contenido de epubjs (que se registra una sola
  // vez) siempre lea el valor mas reciente, en vez de quedarse con el que
  // habia cuando se creo la rendition.
  const translationEnabledRef = useRef(translationEnabled)
  translationEnabledRef.current = translationEnabled

  /**
   * Traduce, nodo de texto por nodo de texto, el capitulo que epubjs acaba
   * de montar. Se llama tanto desde el hook de contenido (capitulos nuevos)
   * como al prender la traduccion (capitulos que ya estaban montados).
   *
   * Nodo por nodo y no el capitulo entero de una: preserva el marcado
   * (negrita, cursiva, links) porque nunca se toca el DOM, solo `nodeValue`.
   */
  const translateDocument = useCallback(async (doc: Document) => {
    const nodes = collectTextNodes(doc)
    for (const node of nodes) {
      if (!translationEnabledRef.current) return
      if (translatorRef.current.status !== 'ready') return
      if (originalTextRef.current.has(node)) continue
      const original = node.nodeValue ?? ''
      if (!original.trim()) continue
      const translated = await translatorRef.current.translate(original)
      // El nodo pudo cambiar (o el capitulo desmontarse) mientras se esperaba.
      if (node.nodeValue === original) {
        originalTextRef.current.set(node, original)
        node.nodeValue = translated
      }
    }
  }, [])

  /** Idioma de origen: el que declara el EPUB, o detectado como respaldo. */
  const ensureTranslationSourceLang = useCallback(async (): Promise<string> => {
    if (translationSourceLang) return translationSourceLang
    const metadataLang = normalizeLanguageCode(bookRef.current?.package?.metadata?.language)
    if (metadataLang) {
      setTranslationSourceLang(metadataLang)
      return metadataLang
    }
    const doc = orderedContents(renditionRef.current)[0]?.document as Document | undefined
    const sample = doc?.body?.textContent || ''
    const detected = await detectLanguage(sample)
    const resolved = detected || 'en'
    setTranslationSourceLang(resolved)
    return resolved
  }, [translationSourceLang])

  const handleToggleTranslation = useCallback(async () => {
    if (!translationEnabled) await ensureTranslationSourceLang()
    setTranslationEnabled((v) => !v)
  }, [translationEnabled, ensureTranslationSourceLang])

  // Si la traduccion ya venia prendida de una sesion anterior, resuelve el
  // idioma de origen apenas el libro esta listo, sin esperar a que el
  // usuario vuelva a tocar el interruptor.
  useEffect(() => {
    if (translationEnabled && !translationSourceLang && renditionReady) {
      ensureTranslationSourceLang()
    }
  }, [translationEnabled, translationSourceLang, renditionReady, ensureTranslationSourceLang])

  // Traduce lo que ya estaba montado cuando se prende la traduccion, cambia
  // el idioma de destino, o el traductor termina de descargarse.
  useEffect(() => {
    if (!translationEnabled || translator.status !== 'ready') return
    orderedContents(renditionRef.current).forEach((c: any) => {
      if (c?.document) translateDocument(c.document)
    })
  }, [translationEnabled, translationTargetLang, translator.status, translateDocument])

  // Al apagar la traduccion, restaura el texto original en lo que siga
  // montado. Lo que ya se desmonto no hace falta: epubjs lo vuelve a armar
  // desde el archivo original la proxima vez.
  useEffect(() => {
    if (translationEnabled) return
    orderedContents(renditionRef.current).forEach((c: any) => {
      const doc = c?.document as Document | undefined
      if (!doc) return
      collectTextNodes(doc).forEach((node) => {
        const original = originalTextRef.current.get(node)
        if (original !== undefined) {
          node.nodeValue = original
          originalTextRef.current.delete(node)
        }
      })
    })
  }, [translationEnabled])

  // 2. Initialize Epub.js when url is resolved. epubjs is imported here, on
  // the client, so the module never runs during server rendering.
  useEffect(() => {
    if (!bookUrl || !readerContainerRef.current) return
    const container = readerContainerRef.current
    let disposed = false
    let teardown: (() => void) | null = null

    import('epubjs').then((mod: any) => {
      if (disposed) return
      const ePub = mod.default ?? mod
      teardown = setupRendition(ePub, container)
    }).catch((err: unknown) => {
      console.error('Could not load epubjs:', err)
      if (!disposed) setIsLoading(false)
    })

    return () => {
      disposed = true
      teardown?.()
      if (bookUrl.startsWith('blob:')) {
        URL.revokeObjectURL(bookUrl)
      }
    }
  }, [bookUrl])

  function setupRendition(ePub: any, container: HTMLElement): () => void {
    const book = ePub(bookUrl, { openAs: 'epub' })
    bookRef.current = book

    const rendition = book.renderTo(container, {
      width: '100%',
      height: '100%',
      flow: 'scrolled', // Continuous vertical scroll
      manager: 'continuous',
      // El EPUB es un archivo que subio un usuario y se renderiza en un iframe
      // same-origin: con allow-scripts, un script adentro del libro corre en el
      // origen de Glimpse y puede hablar con Supabase con la sesion del lector.
      // false es el default de epubjs; nada de este componente necesita lo otro.
      allowScriptedContent: false
    })
    renditionRef.current = rendition

    // Setup initial themes
    registerReaderThemes(rendition)
    applyReaderStyles()

    // Hook into iframe to load google fonts and apply settings dynamically from refs
    rendition.hooks.content.register((contents: any) => {
      const doc = contents.document
      if (doc) {
        injectStyles(doc)
        
        // Inject Google Fonts link in iframe if not present
        if (googleFontsRef.current) injectGoogleFonts(doc, 'google-fonts-iframe')

        // Attach click listener to images for viewing
        const images = doc.querySelectorAll('img')
        images.forEach((img: HTMLImageElement) => {
          img.addEventListener('click', (e) => {
            e.stopPropagation()
            setActiveImageSrc(img.src)
          })
        })

        // Si la traduccion esta prendida, este capitulo recien montado se
        // traduce ya: epubjs precarga el siguiente antes de que se vea, asi
        // que para cuando el scroll llega esta traducido.
        translateDocument(doc)
      }
    })

    // Listen to clicks on the iframe
    rendition.on('click', (e: any) => {
      const width = renditionRef.current?.manager?.container?.clientWidth || window.innerWidth
      const x = e.clientX || e.changedTouches?.[0]?.clientX || 0
      if (x < width * 0.2) {
        rendition.prev()
      } else if (x > width * 0.8) {
        rendition.next()
      } else {
        setShowControls(prev => !prev)
        setShowSettings(false)
        setShowToc(false)
        setShowTranslate(false)
      }
    })

    // Load book data. El posicionado NO va aca: espera a que el hook resuelva
    // cual es la posicion buena, en el efecto de mas abajo.
    book.ready.then(async () => {
      const navigation = await book.loaded.navigation
      if (navigation && navigation.toc) {
        const items = navigation.toc.map((item: any) => ({
          label: item.label ? item.label.trim() : labelsRef.current.untitledChapter,
          href: item.href
        }))
        setToc(items)
      }
      setRenditionReady(true)
    })

    // Listen to page/relocate events
    let lastSectionIndex: number | null = null
    rendition.on('relocated', (location: any) => {
      if (isResizingRef.current) return
      if (!location || !location.start) return

      // Al cambiar de seccion el documento es otro y el cursor del resaltado
      // ya no significa nada: dejarlo alto hace que `locateChunk` no encuentre
      // nada hacia adelante y reintente desde el principio, que es de donde
      // salian los resaltados en el lugar equivocado.
      const sectionIndex = location.start.index
      if (typeof sectionIndex === 'number' && sectionIndex !== lastSectionIndex) {
        lastSectionIndex = sectionIndex
        highlightCursorRef.current = 0
      }

      const cfi = location.start.cfi
      const bookLocs = (book as any).locations
      const bookSpine = (book as any).spine
      const epubPercent = location.start.percentage

      let percent = 0
      if (bookLocs && bookLocs.total > 0 && typeof epubPercent === 'number' && !isNaN(epubPercent)) {
        percent = epubPercent * 100
      } else if (bookSpine && bookSpine.length > 0 && typeof location.start.index === 'number') {
        percent = (location.start.index / bookSpine.length) * 100
      }

      // El hook ignora esto hasta que las locations existan, que es cuando el
      // porcentaje pasa a ser el del libro y no el del capitulo.
      reportPosition(cfi, percent)
    })

    // Listen to window resize to recalculate columns/sizes
    const handleWindowResize = () => {
      // **Un resize que solo cambia el alto se ignora.**
      //
      // En Android, scrollear esconde la barra de direcciones y eso dispara un
      // `resize` con el mismo ancho. Rearmar ahi significaba llamar a
      // `display(cfi)` con el CFI capturado en ese instante: en medio del
      // scroll suave del TTS, o sea a mitad de camino. La vista volvia ahi.
      //
      // Ese era el scroll para atras. No estaba en scrollHighlightIntoView por
      // mas que se lo mirara tres veces: el TTS scrollea hacia adelante, el
      // scroll esconde la barra, la barra dispara el resize, y el resize
      // deshace el scroll. Se corregia solo, contra si mismo.
      const width = window.innerWidth
      if (width === viewportWidthRef.current) return
      viewportWidthRef.current = width

      try {
        if (renditionRef.current) {
          isResizingRef.current = true
          const currentLoc = renditionRef.current.currentLocation()
          const cfi = currentLoc?.start?.cfi
          
          renditionRef.current.resize()
          
          if (cfi) {
            renditionRef.current.display(cfi)
          }

          // Rotar el telefono cambia el ancho, y hay estilos que dependen del
          // alto de la pantalla en px — el tope de las imagenes. Sin esto,
          // quedaban con el tope calculado para la orientacion anterior hasta
          // que tocaras alguna preferencia de lectura.
          applyReaderStylesRef.current()

          setTimeout(() => { isResizingRef.current = false }, 100)
        }
      } catch (err) {
        console.warn('Failed to resize EpubReader on window resize:', err)
        isResizingRef.current = false
      }
    }
    // Se siembra con el ancho de ahora: si arrancara en 0, el primer resize de
    // solo alto —esconder la barra de Android al primer scroll— pasaria el
    // filtro una vez.
    viewportWidthRef.current = window.innerWidth
    window.addEventListener('resize', handleWindowResize)

    // El guardado al ocultar la pestaña y al desmontar los hace
    // useReadingProgress (onProgress con reason 'hidden').

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleWindowResize)
      setRenditionReady(false)

      if (renditionRef.current) {
        renditionRef.current.destroy()
      }
      if (bookRef.current) {
        bookRef.current.destroy()
      }
    }
  }



  // Posicionado inicial. Espera dos cosas: que el libro este parseado y que el
  // hook haya decidido cual es la posicion buena (cache vs base). Las locations
  // se generan despues, y hasta que terminan NO se habilita el guardado: es la
  // ventana en la que el porcentaje era el del capitulo y se guardaba mal.
  useEffect(() => {
    if (!renditionReady || !initialResolved) return

    const rendition = renditionRef.current
    const book = bookRef.current
    if (!rendition || !book) return

    let cancelled = false
    const target = initialPosition?.cfi || ''

    const show = () => {
      if (cancelled) return
      displayAt(rendition, book, target)
      setIsLoading(false)
    }

    const afterLocations = () => {
      if (cancelled) return
      setLocationsReady(true)
      const loc = rendition.currentLocation() as any
      const pct = loc?.start?.percentage
      if (typeof pct === 'number' && !isNaN(pct)) {
        setProgressPercent(Math.min(100, Math.max(0, pct * 100)))
      }
    }

    // Un `percent:` viejo necesita las locations para traducirse a un CFI, asi
    // que en ese caso hay que generarlas antes de mostrar.
    if (target.startsWith('percent:')) {
      book.locations.generate(1024).then(() => {
        show()
        afterLocations()
      }).catch((err: any) => {
        console.error('Error generating locations:', err)
        show()
        if (!cancelled) setLocationsReady(true)
      })
    } else {
      show()
      book.locations.generate(1024).then(afterLocations).catch((err: any) => {
        console.error('Error generating locations:', err)
        // Aun sin locations conviene poder guardar: mejor un porcentaje
        // aproximado que perder la posicion del todo.
        if (!cancelled) setLocationsReady(true)
      })
    }

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renditionReady, initialResolved])

  // Register theme values inside epubjs iframe
  const registerReaderThemes = (rendition: any) => {
    rendition.themes.register('light', {
      body: { background: '#ffffff !important', color: '#0f172a !important' },
      p: { color: '#0f172a !important' },
      h1: { color: '#0f172a !important' },
      h2: { color: '#0f172a !important' },
      h3: { color: '#0f172a !important' }
    })
    rendition.themes.register('dark', {
      body: { background: '#333333 !important', color: '#e0e0e0 !important' },
      p: { color: '#e0e0e0 !important' },
      h1: { color: '#ffffff !important' },
      h2: { color: '#ffffff !important' },
      h3: { color: '#ffffff !important' }
    })
    rendition.themes.register('eink', {
      body: { background: '#ffffff !important', color: '#000000 !important' },
      p: { color: '#000000 !important' },
      h1: { color: '#000000 !important' }
    })
  }

  // Update styles inside the rendering iframe
  const applyReaderStyles = () => {
    const rendition = renditionRef.current
    if (!rendition) return

    let bg = '#ffffff'
    let text = '#0f172a'
    if (theme === 'dark') {
      bg = '#333333'
      text = '#e0e0e0'
    } else if (theme === 'eink') {
      bg = '#ffffff'
      text = '#000000'
    } else if (theme === 'custom') {
      bg = customColors.bg
      text = customColors.text
    }

    if (theme === 'custom') {
      // Delete existing custom theme to allow registering with new colors
      if (rendition.themes._themes && rendition.themes._themes['custom']) {
        delete rendition.themes._themes['custom']
      }
      rendition.themes.register('custom', {
        body: { background: `${customColors.bg} !important`, color: `${customColors.text} !important` },
        p: { color: `${customColors.text} !important` },
        h1: { color: `${customColors.text} !important` },
        h2: { color: `${customColors.text} !important` },
        h3: { color: `${customColors.text} !important` }
      })
    }

    // Apply active theme
    rendition.themes.select(theme)

    // Setup base styles (Font sizes, font families, line-heights)
    let fontStack = fontFamily
    if (fontFamily === 'font-serif') fontStack = 'Noto Serif, Georgia, serif'
    else if (fontFamily === 'font-sans') fontStack = 'system-ui, -apple-system, sans-serif'
    else if (fontFamily === 'font-mono') fontStack = 'monospace, Courier New'

    const isEink = theme === 'eink'

    let sidePadding = '1.5rem'
    if (marginSize === 'compact') sidePadding = '0.5rem'
    else if (marginSize === 'wide') sidePadding = '3rem'

    rendition.themes.default({
      body: {
        'background-color': `${bg} !important`,
        'background': `${bg} !important`,
        'color': `${text} !important`,
        'font-family': `${fontStack} !important`,
        'font-size': `${fontSize}px !important`,
        'line-height': `${lineHeight} !important`,
        'padding': `calc(4.5rem + env(safe-area-inset-top, 0px)) ${sidePadding} 2.5rem ${sidePadding} !important`,
        'font-weight': isEink ? '600 !important' : 'normal !important',
        'text-align': `${textAlign} !important`
      },
      p: {
        'color': `${text} !important`,
        'font-weight': isEink ? '600 !important' : 'normal !important',
        'text-align': `${textAlign} !important`
      }
    })

    // Force style application directly inside the loaded iframes to prevent any unsynced theme bugs
    try {
      const contents = rendition.getContents()
      if (contents && contents.length > 0) {
        contents.forEach((content: any) => {
          const doc = content.document
          if (doc) {
            injectStyles(doc)
          }
        })
      }
    } catch (err) {
      console.warn('Failed to apply themes directly to iframe contents', err)
    }

    try {
      rendition.resize()
    } catch (resizeErr) {
      console.warn('Failed to resize rendition', resizeErr)
    }
  }

  /**
   * La version mas nueva de applyReaderStyles, para quien la necesite desde un
   * efecto que corre una sola vez.
   *
   * `applyReaderStyles` se rearma en cada render y cierra sobre el tema, la
   * tipografia y los margenes de ESE render. El efecto que registra el resize
   * se monta una sola vez, asi que se quedaria con la version del primer
   * render: llamar a esa al rotar el telefono aplicaria el tema y la
   * tipografia de cuando se abrio el libro, pisando todo lo que hubieras
   * cambiado desde entonces.
   */
  const applyReaderStylesRef = useRef(applyReaderStyles)
  applyReaderStylesRef.current = applyReaderStyles

  // Monitor styles changes
  useEffect(() => {
    applyReaderStyles()
  }, [fontFamily, fontSize, lineHeight, theme, customColors, textAlign, isLoading, injectStyles, marginSize])

  // Navigate to target chapter
  /**
   * Ir a una entrada del indice.
   *
   * El `display(href)` pelado no alcanza, y este es el motivo: epubjs resuelve
   * el destino con `spine.get()`, que **descarta el fragmento**
   * (`href.split("#")[0]`) porque el spine se indexa por archivo. En los EPUB
   * donde varios capitulos comparten un mismo XHTML y se separan por anclas,
   * todas las entradas terminan en el mismo lugar: el principio del archivo.
   *
   * No es un caso raro. En el alice-es.epub que viene con la app son 283 de
   * 283 entradas con fragmento, y las seis primeras apuntan al mismo archivo.
   *
   * Asi que despues de montar el archivo hay que ubicar el ancla a mano.
   */
  // ---------------------------------------------------------- buscar
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<BookSearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchProgress, setSearchProgress] = useState(0)
  const searchSignalRef = useRef<{ cancelled: boolean } | null>(null)

  const runSearch = useCallback(async () => {
    const book = bookRef.current
    if (!book) return
    if (searchQuery.trim().length < MIN_QUERY_LENGTH) return

    // Una busqueda en curso se cancela: cargar y descargar secciones es lo
    // caro, y dos recorridos a la vez sobre el mismo libro se pisan.
    if (searchSignalRef.current) searchSignalRef.current.cancelled = true
    const signal = { cancelled: false }
    searchSignalRef.current = signal

    setSearching(true)
    setSearchProgress(0)
    try {
      const hits = await searchBook(book, searchQuery, {
        signal,
        onProgress: (done, total) => {
          if (!signal.cancelled) setSearchProgress(total ? Math.round((done / total) * 100) : 0)
        },
      })
      if (!signal.cancelled) setSearchHits(hits)
    } finally {
      if (!signal.cancelled) setSearching(false)
    }
  }, [searchQuery])

  const closeSearch = useCallback(() => {
    if (searchSignalRef.current) searchSignalRef.current.cancelled = true
    setShowSearch(false)
    setSearching(false)
    setSearchHits(null)
    setSearchQuery('')
  }, [])

  const jumpToHit = useCallback(async (cfi: string) => {
    closeSearch()
    try {
      await renditionRef.current?.display(cfi)
    } catch (e) {
      console.warn('No se pudo abrir el resultado de la busqueda:', e)
    }
  }, [closeSearch])

  // Cerrar el menu al tocar afuera. Sin esto, en un telefono queda abierto
  // tapando el texto hasta que se acierta el boton otra vez.
  useEffect(() => {
    if (!showMenu) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setShowMenu(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [showMenu])

  const jumpToChapter = useCallback(async (href: string) => {
    const rendition = renditionRef.current
    if (!rendition) return

    setShowToc(false)

    const hashAt = href.indexOf('#')
    const file = hashAt === -1 ? href : href.slice(0, hashAt)
    const hash = hashAt === -1 ? '' : href.slice(hashAt + 1)

    try {
      await rendition.display(file || href)
    } catch (e) {
      console.warn('No se pudo abrir la seccion del indice:', href, e)
      return
    }

    if (!hash) return

    // El contenido recien montado todavia no esta medido en el mismo tick.
    await new Promise(resolve => setTimeout(resolve, 60))

    // En todos los documentos montados y no solo en el primero: el manager
    // continuo tiene varias secciones a la vez y `getContents()[0]` suele ser
    // la anterior, no la que se acaba de mostrar.
    let target: Element | null = null
    for (const contents of orderedContents(rendition)) {
      const doc: Document | undefined = contents?.document
      if (!doc) continue
      try {
        // `name` ademas de `id`: los EPUB viejos usan <a name="..."> para las
        // anclas, que es lo que genera la conversion desde HTML de Gutenberg.
        target = doc.getElementById(hash) ?? doc.querySelector(`[name="${CSS.escape(hash)}"]`)
      } catch {
        target = doc.getElementById(hash)
      }
      if (target) break
    }

    // scrollIntoView desde adentro del iframe arrastra tambien al contenedor
    // del manager continuo, que es el que scrollea de verdad.
    target?.scrollIntoView({ block: 'start' })
  }, [])

  const handleContainerClick = (e: React.MouseEvent) => {
    const width = window.innerWidth
    const x = e.clientX
    if (x < width * 0.2 && renditionRef.current) {
      renditionRef.current.prev()
    } else if (x > width * 0.8 && renditionRef.current) {
      renditionRef.current.next()
    } else {
      setShowControls(prev => !prev)
      setShowSettings(false)
      setShowTranslate(false)
    }
  }
  // Theme-specific wrapper CSS configurations
  const getWrapperThemeClass = () => {
    if (theme === 'light') return 'bg-white text-slate-900'
    if (theme === 'eink') return 'bg-white text-black border border-black'
    if (theme === 'custom') return ''
    return 'bg-[#333333] text-[#e0e0e0]'
  }

  const getContainerClassName = () => {
    if (marginSize === 'compact') return 'h-full w-full max-w-none px-0'
    if (marginSize === 'wide') return 'h-full w-full max-w-2xl mx-auto px-0'
    return 'h-full w-full max-w-4xl mx-auto px-0'
  }

  // NOTA: estos hooks van ANTES del `if (fileError)` de mas abajo, y no es
  // cosmetico. Estaban despues, o sea que en el render de "libro no
  // disponible" no se ejecutaban: React exige el mismo orden de hooks en
  // todos los renders, asi que en cuanto fileError cambiaba de valor el
  // componente se rompia. Solo pasaba en el camino de error, por eso no
  // se noto.
  // ------------------------------------------------------------------- TTS
  //
  // El lector va en `flow: 'scrolled'` con manager continuo: no hay "paginas",
  // hay un scroll largo. Por eso la lectura en voz alta necesita dos cosas que
  // antes no tenia: pedir el tramo siguiente cuando se acaba lo que esta a la
  // vista, y arrastrar el scroll detras del resaltado.

  /** Hasta donde se resalto en el capitulo actual, en caracteres. */
  const highlightCursorRef = useRef(0)
  /** El ultimo span resaltado. Es desde donde se pide el texto que sigue. */
  const lastHighlightRef = useRef<HTMLElement | null>(null)

  /** El texto que entra en el viewport, segun la ubicacion actual de epubjs. */
  const getVisibleText = useCallback(async (): Promise<string> => {
    const rendition = renditionRef.current
    const book = bookRef.current
    if (!rendition) return ''

    const loc = rendition.currentLocation()
    if (loc?.start?.cfi && loc?.end?.cfi && book) {
      try {
        const startCfi = loc.start.cfi.replace('epubcfi(', '').replace(')', '')
        const endCfi = loc.end.cfi.replace('epubcfi(', '').replace(')', '')
        const bangIndex = startCfi.indexOf('!')

        if (bangIndex !== -1) {
          const base = startCfi.substring(0, bangIndex + 1)
          const startPath = startCfi.substring(bangIndex + 1)
          const endPath = endCfi.substring(endCfi.indexOf('!') + 1)
          const range = await book.getRange(`epubcfi(${base},${startPath},${endPath})`)
          // cloneContents y no toString(): hace falta el arbol para saber
          // donde termina cada parrafo.
          const text = range ? fragmentToText(range.cloneContents()) : ''
          if (text) return text
        }
      } catch (e) {
        console.warn('TTS: no se pudo armar el rango desde el CFI', e)
      }
    }

    // Sin rango utilizable no se devuelve el capitulo entero, que es lo que
    // hacia antes: leer un capitulo completo mientras la vista muestra una
    // pantalla hace que el resaltado se aleje cada vez mas del texto visible,
    // y como resaltar arrastra el scroll, termina en un salto de posicion de
    // varias secciones. Mejor no leer que leer de cualquier lado.
    return ''
  }, [])

  /**
   * Que leer al empezar. Si hay seleccion del usuario, eso; si no, lo visible.
   *
   * Ahora la seleccion es siempre del usuario: el resaltado de la lectura se
   * hace con spans y no la toca. Mientras se hacia con `window.find`, cada
   * tramo dejaba una seleccion propia y al segundo play se leia el ultimo
   * fragmento resaltado en vez de la pagina.
   */
  const getTextToRead = useCallback(async (): Promise<string> => {
    // La seleccion puede estar en cualquiera de las secciones montadas, no
    // solo en la primera del arreglo.
    for (const contents of orderedContents(renditionRef.current)) {
      const selected = contents?.window?.getSelection()?.toString().trim()
      if (selected) return selected
    }
    return getVisibleText()
  }, [getVisibleText])

  /** Avanza el scroll y devuelve lo nuevo que quedo a la vista. */
  const getMoreTextToRead = useCallback(async (): Promise<string | null> => {
    const rendition = renditionRef.current
    if (!rendition) return null

    // Primero, seguir donde quedo el resaltado DENTRO de la seccion actual.
    // Esto es lo que evita el salto de pagina en cada tanda: el scroll lo
    // arrastra el resaltado, parrafo a parrafo, en vez de pegar un salto de
    // una pantalla y despues corregirlo.
    const doc: Document | undefined = orderedContents(rendition)[0]?.document
    if (doc) {
      const anchor = lastHighlightRef.current
      // La referencia tiene que seguir en el documento: si la seccion se
      // remonto, el span viejo quedo huerfano y no ubica nada.
      const usable = anchor && doc.contains(anchor) ? anchor : null
      const ahead = textAfterElement(doc, usable)
      if (ahead) return ahead
    }

    // Se acabo la seccion: recien ahora se pasa a la siguiente.
    await rendition.next()
    // epubjs resuelve `next()` antes de que el contenido nuevo este medido.
    await new Promise(resolve => setTimeout(resolve, 150))
    lastHighlightRef.current = null
    highlightCursorRef.current = 0

    return getVisibleText()
  }, [getVisibleText])

  /**
   * Resalta el tramo que se esta leyendo y arrastra el scroll hasta el.
   *
   * Antes esto era `window.find`, que resalta con la **seleccion del
   * navegador**. Dos cosas que de ahi no se podian arreglar:
   *
   *  - Un click en cualquier lado colapsa la seleccion. La voz seguia leyendo
   *    y el resaltado desaparecia, que es lo que pasaba al tocar la pantalla.
   *  - La seleccion solo se pinta con `::selection`, que acepta cuatro
   *    propiedades y ninguna es `border-radius`.
   *
   * Ahora el tramo se envuelve en spans propios. La busqueda —aplanar el
   * documento a texto normalizado y ubicar el fragmento ahi— es logica pura y
   * vive en src/lib/text-highlight.ts, con tests.
   */
  const highlightSpokenText = useCallback((text: string | null) => {
    const documents = orderedContents(renditionRef.current)
      .map((contents) => contents?.document as Document | undefined)
      .filter((doc): doc is Document => Boolean(doc?.body))

    if (documents.length === 0) return

    // Se limpia en TODOS los documentos montados: si el anterior quedo con un
    // resaltado y el siguiente tramo cae en otra seccion, sin esto quedan dos
    // marcados a la vez.
    documents.forEach(removeHighlight)

    if (!text) {
      highlightCursorRef.current = 0
      return
    }

    // Se prueba primero la seccion visible; las otras montadas son el respaldo
    // por si la ubicacion actual quedo un paso atras.
    let doc: Document | undefined
    let nodes: Text[] = []
    let index = buildSearchIndex([])
    let location: ReturnType<typeof locateChunk> = null

    for (let i = 0; i < documents.length; i++) {
      const candidate = documents[i]
      const candidateNodes = collectTextNodes(candidate)
      const candidateIndex = buildSearchIndex(candidateNodes.map(node => node.nodeValue || ''))
      // El cursor solo vale para la seccion actual: en otra no significa nada.
      const found = locateChunk(candidateIndex, text, i === 0 ? highlightCursorRef.current : 0)
      if (!found) continue

      doc = candidate
      nodes = candidateNodes
      index = candidateIndex
      location = found
      if (i > 0) highlightCursorRef.current = 0
      break
    }

    if (!doc || !location) return
    highlightCursorRef.current = location.end

    let first: HTMLElement | null = null
    let last: HTMLElement | null = null

    // Un tramo por nodo: el fragmento casi siempre cruza etiquetas y
    // `surroundContents` falla apenas el rango cruza un limite de elemento.
    for (const slice of sliceByNode(index, location)) {
      const node = nodes[slice.node]
      if (!node?.nodeValue) continue

      try {
        const range = doc.createRange()
        range.setStart(node, Math.min(slice.start, node.nodeValue.length))
        range.setEnd(node, Math.min(slice.end, node.nodeValue.length))

        const span = doc.createElement('span')
        span.className = TTS_HIGHLIGHT_CLASS
        range.surroundContents(span)
        if (!first) first = span
        last = span
      } catch (e) {
        // Un tramo que no se puede envolver se saltea: mejor resaltar de menos
        // que romper el DOM del libro.
        console.warn('TTS: no se pudo resaltar un tramo', e)
      }
    }

    lastHighlightRef.current = last ?? first
    if (first) scrollHighlightIntoView(doc, first, last ?? first)
  }, [])


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
      style={theme === 'custom' ? { backgroundColor: customColors.bg, color: customColors.text } : undefined}
    >
      
      {/* Floating Header */}
      <div 
        className={`absolute left-0 right-0 top-0 z-30 flex h-[calc(4rem+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)] items-center justify-between border-b px-4 transition-transform duration-300 backdrop-blur-md ${
          theme === 'light' || theme === 'eink' ? 'border-slate-200 bg-white/95 text-slate-900' : 'border-zinc-700 bg-[#333333]/90 text-[#e0e0e0]'
        } ${showControls ? 'translate-y-0' : '-translate-y-full'}`}
        style={theme === 'custom' ? { backgroundColor: `${customColors.bg}e6`, color: customColors.text, borderColor: `${customColors.text}20` } : undefined}
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
          <div className="max-w-[200px] sm:max-w-md flex flex-col justify-center">
            <h2 className="truncate text-sm font-semibold">{bookTitle}</h2>
            <SyncStatusIndicator syncStatus={syncStatus} lastSyncedTime={lastSyncedTime} positionText={`${Math.round(progressPercent)}%`} />
          </div>
        </div>

        {/* Solo escuchar queda afuera: es lo unico que se toca CON el libro
            abierto y leyendo. El resto vive en el menu — seis iconos en la
            barra de un telefono no entran, y sumar el buscador eran siete. */}
        <div className="flex items-center gap-1 md:gap-2">
          <div>
            <TTSPlayer
              getTextToRead={getTextToRead}
              getMoreTextToRead={getMoreTextToRead}
              onTextChange={highlightSpokenText}
              showVoicesButton={false}
              voicesOpen={showVoices}
              onVoicesOpenChange={setShowVoices}
            />
          </div>

          <div className="relative" ref={menuRef}>
            <Button
              onClick={() => setShowMenu(!showMenu)}
              variant="ghost"
              aria-haspopup="menu"
              aria-expanded={showMenu}
              title={t('moreOptions')}
              aria-label={t('moreOptions')}
              className={`h-9 w-9 p-0 hover:bg-slate-800/20 ${showMenu ? 'bg-slate-800/20' : ''}`}
            >
              <MoreVertical className="h-5 w-5" />
            </Button>

            {showMenu && (
              <div
                role="menu"
                className={`absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl border ${
                  theme === 'light' || theme === 'eink'
                    ? 'border-slate-200 bg-white text-slate-900'
                    : 'border-zinc-700 bg-[#2a2a2a] text-[#e0e0e0]'
                }`}
                style={theme === 'custom' ? { backgroundColor: customColors.bg, color: customColors.text, borderColor: `${customColors.text}20` } : undefined}
              >
                {[
                  {
                    icon: Search,
                    label: t('searchTheBook'),
                    onClick: () => { setShowSearch(true); setShowToc(false); setShowSettings(false) },
                  },
                  {
                    icon: Menu,
                    label: t('contents'),
                    onClick: () => { setShowToc(true); setShowSettings(false) },
                  },
                  {
                    icon: Settings2,
                    label: t('voiceAndSpeed'),
                    onClick: () => setShowVoices(true),
                  },
                  {
                    icon: blackStatusBar ? Minimize2 : Maximize2,
                    label: blackStatusBar
                      ? (t('exitFullscreen'))
                      : (t('fullscreen')),
                    onClick: () => {
                      const val = !blackStatusBar
                      setBlackStatusBar(val)
                      if (val) {
                        document.documentElement.requestFullscreen?.().catch(err => console.warn(err))
                      } else if (document.fullscreenElement) {
                        document.exitFullscreen?.().catch(err => console.warn(err))
                      }
                    },
                  },
                  {
                    icon: Settings,
                    label: t('typeAndTheme'),
                    onClick: () => { setShowSettings(true); setShowToc(false) },
                  },
                  ...(translateAdapter ? [{
                    icon: Languages,
                    label: t('translateMenuLabel'),
                    onClick: () => { setShowTranslate(true); setShowToc(false); setShowSettings(false) },
                  }] : []),
                ].map(({ icon: Icon, label, onClick }) => (
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    onClick={() => { setShowMenu(false); onClick() }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-slate-800/20"
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Epub Rendering Container */}
      <div 
        onClick={handleContainerClick}
        className="flex-1 w-full cursor-pointer overflow-hidden relative flex justify-center"
      >
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-20">
            <Loader2 className="h-10 w-10 animate-spin text-brand" />
            <p className="mt-4 text-sm text-slate-400 font-medium">{t('loadingBook')}</p>
          </div>
        )}
        <div ref={readerContainerRef} id="reader-rendering-area" className={getContainerClassName()} />
      </div>

      {/* Floating Footer Progress Bar */}
      <div 
        className={`absolute bottom-0 left-0 right-0 z-30 flex h-10 items-center justify-between px-6 border-t text-xs backdrop-blur-md transition-transform duration-300 ${
          theme === 'light' || theme === 'eink' ? 'border-slate-200 bg-white/95 text-slate-600' : 'border-zinc-700 bg-[#333333]/90 text-[#e0e0e0]'
        } ${showControls ? 'translate-y-0' : 'translate-y-full'}`}
        style={theme === 'custom' ? { backgroundColor: `${customColors.bg}e6`, color: customColors.text, borderColor: `${customColors.text}20` } : undefined}
      >
        <span>{t('progressLabel')}</span>
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
          style={theme === 'custom' ? { backgroundColor: customColors.bg, color: customColors.text, borderColor: `${customColors.text}30` } : undefined}
        >
          <h3 className="mb-4 text-sm font-semibold flex items-center gap-1.5">
            <Type className="h-4 w-4 opacity-60" />
            {t('readingSettings')}
          </h3>

          <div className="space-y-4 text-xs">
            {/* Theme selector */}
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

            {/* Font family */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">{t('fontFamilyLabel')}</label>
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

            {/* Font size */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">{t('textSizeLabel')}</label>
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

            {/* Line spacing */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">{t('lineSpacingLabel')}</label>
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
              <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">{t('alignmentLabel')}</label>
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
              <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">{t('marginsLabel')}</label>
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
          style={theme === 'custom' ? { backgroundColor: customColors.bg, color: customColors.text, borderColor: `${customColors.text}30` } : undefined}
        >
          <h3 className="mb-4 text-sm font-semibold flex items-center gap-1.5">
            <Languages className="h-4 w-4 opacity-60" />
            {t('translateTitle')}
          </h3>

          <div className="space-y-4 text-xs">
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
              <p className="text-xs text-slate-500 p-4 text-center">{t('noChapters')}</p>
            ) : (
              toc.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => jumpToChapter(item.href!)}
                  className={`flex w-full items-center justify-between rounded-lg p-2.5 text-left text-xs transition-colors hover:bg-slate-800/20 ${
                    theme === 'dark' || theme === 'custom' ? 'text-slate-300' : 'text-slate-700'
                  }`}
                >
                  <span className="truncate pr-2">{item.label}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                </button>
              ))
            )}
          </div>
        </div>
      )}


      {/* Buscar en el libro. Panel propio y no una barra flotante: los
          resultados son una lista con contexto, y hay que poder leerlos. */}
      {showSearch && (
        <div className="fixed inset-0 z-40 flex flex-col bg-black/60 backdrop-blur-sm" onClick={closeSearch}>
          <div
            onClick={(e) => e.stopPropagation()}
            className={`mx-auto flex h-full w-full max-w-2xl flex-col border-x ${
              theme === 'light' || theme === 'eink'
                ? 'border-slate-200 bg-white text-slate-900'
                : 'border-zinc-700 bg-[#1c1c1c] text-[#e0e0e0]'
            }`}
            style={theme === 'custom' ? { backgroundColor: customColors.bg, color: customColors.text } : undefined}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-current/10 p-4 pt-[calc(1rem+env(safe-area-inset-top,0px))]">
              <Search className="h-4 w-4 shrink-0 opacity-60" />
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runSearch()
                  if (e.key === 'Escape') closeSearch()
                }}
                placeholder={t('searchPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-50"
              />
              <button
                type="button"
                onClick={() => void runSearch()}
                disabled={searching || searchQuery.trim().length < MIN_QUERY_LENGTH}
                className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand/90 disabled:opacity-40"
              >
                {t('search')}
              </button>
              <button
                type="button"
                onClick={closeSearch}
                aria-label={t('close')}
                className="shrink-0 rounded-full p-1.5 opacity-60 transition-opacity hover:opacity-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {searching ? (
                <div className="flex flex-col items-center gap-3 p-10 text-center text-xs opacity-70">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {/* Se muestra el avance porque buscar carga el libro seccion
                      por seccion: en uno grande, sin esto parece colgado. */}
                  <span>{t('searching')} {searchProgress}%</span>
                </div>
              ) : searchHits === null ? (
                <p className="p-10 text-center text-xs opacity-70">
                  {format(t('searchHint'), { min: MIN_QUERY_LENGTH })}
                </p>
              ) : searchHits.length === 0 ? (
                <p className="p-10 text-center text-xs opacity-70">
                  {t('noResults')}
                </p>
              ) : (
                <>
                  <p className="px-3 py-2 text-[11px] uppercase tracking-wider opacity-50">
                    {searchHits.length} {t('results')}
                  </p>
                  {searchHits.map((hit, idx) => (
                    <button
                      key={`${hit.cfi}:${idx}`}
                      onClick={() => void jumpToHit(hit.cfi)}
                      className="flex w-full flex-col gap-1 rounded-lg p-3 text-left transition-colors hover:bg-slate-800/20"
                    >
                      {hit.section && (
                        <span className="text-[11px] font-medium text-brand">{hit.section}</span>
                      )}
                      <span className="text-xs leading-relaxed opacity-80">{hit.excerpt}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
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
                  <span className="text-lg font-bold text-slate-100">{Math.round(syncConflict.local.percent)}%</span>
                  <span className="text-[10px] text-slate-400">
                    {formatRelativeTime(labels, syncConflict.local.time)} ({new Date(syncConflict.local.time || new Date()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                  </span>
                </div>
              </div>

              {/* Cloud Position Card */}
              <div className="p-4 rounded-xl border border-zinc-800 bg-[#252525] flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-brand">{t('cloudPosition')}</span>
                <div className="flex justify-between items-baseline mt-1">
                  <span className="text-lg font-bold text-brand">{Math.round(syncConflict.db.percent)}%</span>
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

      {/* Fullscreen Image Viewer Modal */}
      {activeImageSrc && (
        <div 
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setActiveImageSrc(null)}
        >
          <button 
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            onClick={() => setActiveImageSrc(null)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          
          <img 
            src={activeImageSrc} 
            alt="EPUB Image View" 
            className="max-w-full max-h-[90vh] object-contain rounded-lg animate-in zoom-in-95 duration-200 select-none cursor-zoom-out"
            onClick={(e) => { e.stopPropagation(); setActiveImageSrc(null); }}
          />
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
