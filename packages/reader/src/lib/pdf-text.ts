/**
 * Reconstruye párrafos a partir de los items de texto de pdf.js.
 *
 * La versión anterior comparaba la Y de dos items consecutivos contra dos
 * umbrales absolutos (28 y 8 unidades de PDF). Como esos números no se
 * relacionan con el cuerpo de la tipografía del documento, en un PDF con
 * interlineado amplio el salto normal *entre líneas del mismo párrafo* ya
 * superaba 28 y cada línea se convertía en un párrafo; en uno de cuerpo chico
 * nunca lo superaba y todo quedaba en un solo bloque. No hay un par de números
 * que ande para todos los PDF, y por eso esto no se arreglaba moviendo el 28.
 *
 * Lo que hace ahora, en dos pasadas:
 *
 *  1. Agrupa items en líneas usando la altura de la fuente del propio item
 *     como tolerancia, no una constante.
 *  2. Calcula la mediana del salto entre líneas *de esa página* y abre párrafo
 *     sólo cuando el salto se despega de esa mediana, o cuando la línea entra
 *     con sangría.
 *
 * Todo relativo al documento: es lo que lo hace funcionar en PDFs distintos.
 */

export interface PdfTextItem {
  str: string
  /** [a, b, c, d, e, f] — e es la X y f la Y en el espacio del PDF. */
  transform: number[]
  height?: number
  width?: number
}

interface Line {
  /** Y de la línea (en PDF crece hacia arriba). */
  y: number
  /** X donde arranca, para detectar sangría. */
  x: number
  /** X donde termina el último run, para decidir si hace falta un espacio. */
  endX: number
  fontSize: number
  text: string
  /** Texto a 90°: ahí la Y no dice en qué altura de la hoja está el renglón. */
  rotated?: boolean
}

/** Cuánto se puede despegar un item de la línea antes de ser otra línea. */
const SAME_LINE_RATIO = 0.5
/** Hueco horizontal, en fracción del cuerpo, que implica un espacio. */
const SPACE_GAP_RATIO = 0.2
/** Cuánto tiene que superar el salto a la mediana para abrir párrafo. */
const PARAGRAPH_GAP_RATIO = 1.5
/** Diferencia aceptada, en cuerpos, entre lo que mide la repetición y lo que se pisa. */
const REPEAT_TOLERANCE_RATIO = 0.5
/** Menos que esto puede coincidir por casualidad. */
const MIN_REPEATED_CHARS = 2
/** Solape, en cuerpos, a partir del cual dos tramos ya no son kerning. */
const OVERLAP_GAP_RATIO = 0.3
/** Un renglón que sólo puede ser código: abre o cierra un bloque, o es un comentario. */
const CODE_LINE = /[{}(]\s*$|^\s*(?:\/\/|\/\*|#\s)/
/** Un comentario, que va en su propio renglón aunque el anterior no parezca código. */
const CODE_COMMENT = /^\s*(?:\/\/|\/\*)/
/** Un final que también aparece en texto corrido: sólo cuenta si el renglón no llega al margen. */
const CODE_LINE_END = /[;)]\s*$/
/** Lo que casi nunca tiene un renglón de texto: una asignación, corchetes, `nombre(`. */
const CODE_TOKEN = /[=<>[\]{}|&]|\w\(|^\s*(?:import|export|from|package|return)\s/
/** Fracción del ancho de los renglones más largos a partir de la cual uno llegó al margen. */
const FULL_LINE_RATIO = 0.9
/** Lo que cierra una oración, con su comilla o paréntesis si los lleva. */
const SENTENCE_END = /[.:;!?]["”»)]?\s*$/
/** Diferencia, en cuerpos, para decir que dos renglones terminan en el mismo margen derecho. */
const SAME_RIGHT_EDGE_RATIO = 1.5
/** Salto respecto de la mediana a partir del cual un renglón está separado del cuerpo. */
const STRAY_GAP_RATIO = 3
/** Fracción inferior de la altura ocupada en la que vive un pie de página. */
const FOOTER_ZONE_RATIO = 0.12
/** Fracción del ancho habitual por debajo de la cual un renglón termina su párrafo. */
const SHORT_LINE_RATIO = 0.6
/** Lo que abre un ítem de lista: una viñeta, `1.`, `a)`, seguidos de un espacio. */
const LIST_ITEM = new RegExp('^\\s*(?:[•·▪►◦‣*–\\uf000-\\uf0ff-]|\\d{1,3}(?:\\.\\d+)*[.)]|\\p{L}\\))\\s', 'u')
/** Sangría mínima, en fracción del cuerpo, para abrir párrafo. */
const INDENT_RATIO = 0.8

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Cuántos caracteres de `next` repiten el final de la línea, si es la segunda
 * impresión de un texto simulando negrita. No alcanza con que el texto coincida
 * ("misma" y "manera" comparten "ma"): lo que coincide tiene que medir lo mismo
 * que lo que el tramo pisa. Una sola letra sólo cuenta si es el tramo entero.
 */
function repeatedPrefix(text: string, next: string, overlap: number, nextWidth: number, fontSize: number): number {
  const end = text.trimEnd()
  const charWidth = nextWidth / Math.max(1, next.length)
  const tolerance = fontSize * REPEAT_TOLERANCE_RATIO
  for (let length = Math.min(end.length, next.length); length > 0; length--) {
    if (!end.endsWith(next.slice(0, length))) continue
    if (length < MIN_REPEATED_CHARS && length < next.length) continue
    if (Math.abs(length * charWidth - overlap) <= tolerance) return length
  }
  return 0
}

/**
 * Si un tramo que pisa lo anterior es otra palabra y no kerning: queda entero
 * encima. Un solape parcial puede ser texto impreso de a una letra, o una cifra.
 */
function isSeparateRun(last: Line, overlap: number, width: number): boolean {
  return overlap > last.fontSize * OVERLAP_GAP_RATIO && overlap >= width
}

export function groupIntoLines(items: PdfTextItem[]): Line[] {
  const lines: Line[] = []

  for (const item of items) {
    const str = item.str ?? ''
    const transform = item.transform ?? []
    const x = transform[4] ?? 0
    const y = transform[5] ?? 0
    // `height` es lo que reporta pdf.js; si viene en cero se cae a la escala
    // vertical de la matriz, que es el cuerpo efectivo.
    const fontSize = item.height && item.height > 0 ? item.height : Math.abs(transform[3] ?? 0) || 12
    const width = item.width ?? 0

    const last = lines[lines.length - 1]
    // En texto a 90° todos los renglones comparten la Y: los separa la X.
    const rotated = Math.abs(transform[1] ?? 0) > Math.abs(transform[0] ?? 0)
    const sameLine =
      last &&
      Math.abs(y - last.y) <= Math.max(1, last.fontSize * SAME_LINE_RATIO) &&
      (!rotated || Math.abs(x - last.x) <= last.fontSize * SAME_LINE_RATIO)

    if (sameLine) {
      const gap = x - last.endX
      // Algunos PDF imprimen el texto dos veces, corrido, para simular negrita. Si
      // el tramo arranca encima de lo ya escrito y repite su final, es esa copia.
      const repeated =
        gap < -last.fontSize * SPACE_GAP_RATIO ? repeatedPrefix(last.text, str, -gap, width, last.fontSize) : 0
      if (repeated > 0) {
        last.text = last.text.trimEnd() + str.slice(repeated)
        last.endX = Math.max(last.endX, x + width)
        last.fontSize = Math.max(last.fontSize, fontSize)
        continue
      }

      // pdf.js parte una línea en varios runs y no siempre incluye el espacio:
      // se decide por el hueco horizontal, no por el contenido.
      const needsSpace =
        (gap > last.fontSize * SPACE_GAP_RATIO || isSeparateRun(last, -gap, width)) &&
        !last.text.endsWith(' ') &&
        !str.startsWith(' ')
      last.text += (needsSpace ? ' ' : '') + str
      // Sin máximo: Word emite espacios con anchos falsos, y arrastrar esa medida haría
      // parecer solapados a los tramos siguientes.
      last.endX = x + width
      last.fontSize = Math.max(last.fontSize, fontSize)
      continue
    }

    if (!str.trim()) continue
    lines.push({ y, x, endX: x + width, fontSize, text: str, rotated })
  }

  return lines.filter(line => line.text.trim().length > 0)
}

/**
 * Une la palabra cortada con guion al final de línea. Sin esto el TTS lee las
 * dos mitades por separado y la búsqueda no encuentra la palabra.
 */
function joinLine(acc: string, next: string): string {
  const trimmed = acc.trimEnd()
  const continuesLowercase = /^[a-záéíóúñü]/.test(next.trimStart())
  if (/[a-záéíóúñüA-ZÁÉÍÓÚÑÜ]-$/.test(trimmed) && continuesLowercase) {
    return trimmed.slice(0, -1) + next.trimStart()
  }
  return `${trimmed} ${next.trimStart()}`
}

/** Un párrafo y la Y de su borde superior, para ubicar imágenes entre párrafos. */
export interface ParagraphBlock {
  text: string
  /** Borde superior de la primera línea (en PDF la Y crece hacia arriba). */
  top: number
}

/**
 * Lleva al final los pies de página que el PDF trae antes que el cuerpo: renglones
 * al fondo de la hoja, despegados de lo anterior, tras los que el texto vuelve a
 * subir. El último renglón de una columna no se despega, y por eso no cuenta.
 */
function moveStrayFooters(lines: Line[]): Line[] {
  const gaps = lines.slice(1).map((line, i) => lines[i].y - line.y).filter(gap => gap > 0)
  const medianGap = median(gaps)
  // Sin un interlineado que medir, o con texto rotado, nada dice que un renglón esté despegado.
  if (medianGap === 0 || lines.some(line => line.rotated)) return lines
  const ys = lines.map(line => line.y)
  const bottom = Math.min(...ys)
  const footerTop = bottom + (Math.max(...ys) - bottom) * FOOTER_ZONE_RATIO
  const isStray = (line: Line, i: number) => {
    const next = lines[i + 1]
    if (!next || line.y > footerTop || next.y <= line.y) return false
    // Despegado de todo lo que tiene arriba en la hoja, no sólo del renglón anterior
    // en el archivo: un renglón del cuerpo siempre tiene otro cerca.
    const above = ys.filter(y => y > line.y)
    if (above.length === 0) return false
    const margin = Math.max(medianGap * STRAY_GAP_RATIO, line.fontSize * STRAY_GAP_RATIO)
    return Math.min(...above) - line.y > margin
  }
  const stray = lines.filter(isStray)
  return stray.length === 0 ? lines : [...lines.filter(line => !stray.includes(line)), ...stray]
}

function linesToBlocks(rawLines: Line[]): ParagraphBlock[] {
  if (rawLines.length === 0) return []
  const lines = moveStrayFooters(rawLines)

  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y
    if (gap > 0) gaps.push(gap)
  }
  const medianGap = median(gaps)
  const widths = lines.map(l => l.endX - l.x).sort((a, b) => a - b)
  const usualWidth = median(widths)
  const fullWidth = widths[Math.floor(widths.length * 0.9)]

  const blocks: ParagraphBlock[] = []
  const topOf = (line: Line) => line.y + line.fontSize
  let current = lines[0].text
  let currentTop = topOf(lines[0])

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const gap = lines[i - 1].y - line.y

    // Un salto que se despega de la mediana de la página es un párrafo nuevo.
    const bigGap = medianGap > 0 && gap > medianGap * PARAGRAPH_GAP_RATIO
    const previous = lines[i - 1]
    // Minúscula tras un renglón sin cierre: la oración sigue, aunque un dibujo mueva el margen.
    const continues = /^[a-záéíóúñü]/.test(line.text.trimStart()) && !SENTENCE_END.test(previous.text)
    // La sangría de primera línea también es párrafo nuevo, aunque el salto sea normal.
    // Se compara con el renglón anterior: contra el margen de toda la página, un número
    // de página más a la izquierda convertía cada renglón en un párrafo.
    const indented = !continues && line.x > previous.x + line.fontSize * INDENT_RATIO
    // Un salto hacia arriba significa columna nueva o un bloque aparte.
    const wentUp = gap < 0
    const listItem = LIST_ITEM.test(line.text)
    // Un renglón mucho más corto que los demás no llegó al final porque se terminó,
    // salvo que el de abajo termine en el mismo margen: es texto rodeando una figura.
    const previousWidth = previous.endX - previous.x
    const sameRightEdge = Math.abs(previous.endX - line.endX) <= line.fontSize * SAME_RIGHT_EDGE_RATIO
    const afterShortLine =
      usualWidth > 0 && previousWidth < usualWidth * SHORT_LINE_RATIO && !(continues && sameRightEdge)

    const code =
      CODE_LINE.test(previous.text) ||
      CODE_COMMENT.test(line.text) ||
      (CODE_LINE_END.test(previous.text) &&
        (CODE_TOKEN.test(previous.text) || previousWidth < fullWidth * FULL_LINE_RATIO))

    if (bigGap || indented || wentUp || listItem || afterShortLine || code) {
      blocks.push({ text: current.trim(), top: currentTop })
      current = line.text
      currentTop = topOf(line)
    } else {
      current = joinLine(current, line.text)
    }
  }

  blocks.push({ text: current.trim(), top: currentTop })
  return blocks.filter(b => b.text.length > 0)
}

export function linesToParagraphs(lines: Line[]): string[] {
  return linesToBlocks(lines).map(b => b.text)
}

export function extractParagraphs(items: PdfTextItem[]): string {
  return linesToParagraphs(groupIntoLines(items)).join('\n\n')
}

/**
 * Los mismos párrafos que `extractParagraphs`, en el mismo orden y cantidad,
 * con su altura en la página. El índice coincide con el del texto armado.
 */
export function extractParagraphBlocks(items: PdfTextItem[]): ParagraphBlock[] {
  return linesToBlocks(groupIntoLines(items))
}

/** Páginas que se miran buscando texto antes de rendirse. */
const SAMPLE_MAX_PAGES = 10

/**
 * Un texto para detectar el idioma, desde `from` en adelante: esa página puede no
 * tener texto, porque es una tapa o porque todo está en figuras. Vacío si no hay.
 */
export async function findTextSample(
  readPage: (page: number) => Promise<string>,
  from: number,
  totalPages: number,
): Promise<string> {
  const last = Math.min(totalPages, from + SAMPLE_MAX_PAGES - 1)
  for (let page = from; page <= last; page++) {
    const text = await readPage(page)
    if (text.trim()) return text
  }
  return ''
}
