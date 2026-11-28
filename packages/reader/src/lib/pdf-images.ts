/**
 * Imágenes del PDF para el modo texto (el que se lee como un EPUB).
 *
 * `getTextContent()` sólo trae texto, así que ese modo perdía las imágenes.
 * pdf.js no expone "las imágenes de la página" con su posición, pero sí el
 * operator list: la secuencia de operaciones de dibujo. Una imagen se pinta
 * sobre el cuadrado unitario transformado por la matriz vigente (CTM), así que
 * siguiendo save/restore/transform se obtiene su caja en el espacio del PDF.
 * El recorte del pixel lo hace el lector renderizando la página; acá queda
 * sólo la geometría, que es lo que se puede testear sin un PDF real.
 */

import { centerInside, containsText, intersects, itemBox, union, type Box } from './pdf-geometry.js'
import { findGridBoxes, findTableBoxes } from './pdf-tables.js'
import type { PdfTextItem } from './pdf-text.js'

export type { Box }

export type Matrix = [number, number, number, number, number, number]

/** Los códigos de `pdfjsLib.OPS` que importan acá. */
export interface ImageOps {
  save: number
  restore: number
  transform: number
  paintFormXObjectBegin: number
  paintFormXObjectEnd: number
  paintImageXObject: number
  paintInlineImageXObject: number
  paintImageXObjectRepeat: number
  constructPath: number
  endPath: number
  clip: number
  eoClip: number
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** m1 × m2 con la convención de PDF: aplica m2 y después m1. */
function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m2[0] * m1[0] + m2[1] * m1[2],
    m2[0] * m1[1] + m2[1] * m1[3],
    m2[2] * m1[0] + m2[3] * m1[2],
    m2[2] * m1[1] + m2[3] * m1[3],
    m2[4] * m1[0] + m2[5] * m1[2] + m1[4],
    m2[4] * m1[1] + m2[5] * m1[3] + m1[5],
  ]
}

function transformedBox(m: Matrix, x0: number, y0: number, x1: number, y1: number): Box {
  const points = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ])
  const xs = points.map(p => p[0])
  const ys = points.map(p => p[1])
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

/** Un vector de números: pdf.js 6 pasa las matrices de los forms como `Float32Array`. */
function numbers(value: unknown, length: number): number[] | null {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return null
  const list = Array.from(value as unknown as ArrayLike<number>)
  return list.length === length && list.every(n => typeof n === 'number') ? list : null
}

const toMatrix = (value: unknown) => numbers(value, 6) as Matrix | null

function intersection(a: Box, b: Box): Box | null {
  const box = {
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  }
  return box.x0 <= box.x1 && box.y0 <= box.y1 ? box : null
}

interface DrawState {
  ctm: Matrix
  /** El recorte vigente, si hay. Un trazo puede dibujarse afuera de la hoja y quedar cortado. */
  clip: Box | null
}

/** La caja de una ruta: desde pdf.js 5 viene como `[operacion, [ruta], [minX, minY, maxX, maxY]]`. */
function pathBox(args: unknown[], ctm: Matrix): Box | null {
  const bounds = args[2] as ArrayLike<number> | null | undefined
  if (!bounds || bounds.length !== 4) return null
  const [x0, y0, x1, y1] = Array.from(bounds)
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null
  return transformedBox(ctm, x0, y0, x1, y1)
}

/** Un recorte sólo achica el anterior; si no se tocan, no queda nada visible. */
function withClip(state: DrawState, box: Box): DrawState {
  if (!state.clip) return { ...state, clip: box }
  return { ...state, clip: intersection(state.clip, box) ?? { ...box, x1: box.x0, y1: box.y0 } }
}

/** Recorre el operator list siguiendo la matriz y el recorte, y avisa cada operación de dibujo. */
function walkOperators(
  fnArray: number[],
  argsArray: unknown[][],
  ops: ImageOps,
  onDraw: (fn: number, args: unknown[], state: DrawState) => void,
) {
  const stack: DrawState[] = []
  let state: DrawState = { ctm: IDENTITY, clip: null }
  // `W n` llega como una operación de recorte seguida de la ruta que recorta.
  let clipPending = false

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    const args = argsArray[i] ?? []

    if (fn === ops.save) {
      stack.push(state)
    } else if (fn === ops.restore) {
      state = stack.pop() ?? { ctm: IDENTITY, clip: null }
    } else if (fn === ops.transform) {
      const matrix = toMatrix(args)
      if (matrix) state = { ...state, ctm: multiply(state.ctm, matrix) }
    } else if (fn === ops.paintFormXObjectBegin) {
      // El form guarda el estado, aplica su propia matriz y recorta en su BBox.
      stack.push(state)
      const matrix = toMatrix(args[0])
      if (matrix) state = { ...state, ctm: multiply(state.ctm, matrix) }
      const bbox = numbers(args[1], 4)
      if (bbox) state = withClip(state, transformedBox(state.ctm, bbox[0], bbox[1], bbox[2], bbox[3]))
    } else if (fn === ops.paintFormXObjectEnd) {
      state = stack.pop() ?? { ctm: IDENTITY, clip: null }
    } else if (fn === ops.clip || fn === ops.eoClip) {
      clipPending = true
    } else if (fn === ops.constructPath && args[0] === ops.endPath) {
      const box = pathBox(args, state.ctm)
      if (clipPending && box) state = withClip(state, box)
      clipPending = false
    } else {
      onDraw(fn, args, state)
      // `W f`: la misma ruta pinta y recorta, y lo que recorta vale desde la próxima.
      if (fn === ops.constructPath) {
        const box = clipPending ? pathBox(args, state.ctm) : null
        if (box) state = withClip(state, box)
        clipPending = false
      }
    }
  }
}

/** Recorre el operator list y devuelve la caja de cada imagen pintada. */
export function findImageBoxes(fnArray: number[], argsArray: unknown[][], ops: ImageOps): Box[] {
  const paints = new Set([ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageXObjectRepeat])
  const boxes: Box[] = []
  walkOperators(fnArray, argsArray, ops, (fn, _args, { ctm, clip }) => {
    if (!paints.has(fn)) return
    // Un gráfico puede ser una imagen enorme de la que el recorte deja ver un pedazo.
    const box = transformedBox(ctm, 0, 0, 1, 1)
    const visible = clip ? intersection(box, clip) : box
    if (visible) boxes.push(visible)
  })
  return boxes
}

/** La caja de cada trazo o relleno vectorial, cortada en su recorte. */
export function findPaintedBoxes(fnArray: number[], argsArray: unknown[][], ops: ImageOps): Box[] {
  const boxes: Box[] = []
  walkOperators(fnArray, argsArray, ops, (fn, args, { ctm, clip }) => {
    if (fn !== ops.constructPath) return
    const box = pathBox(args, ctm)
    const visible = box && (clip ? intersection(box, clip) : box)
    if (visible) boxes.push(visible)
  })
  return boxes
}

/**
 * Tamaño mínimo, en fracción del lado de la página, para no ser un adorno. El
 * alto admite menos que el ancho porque una tabla puede ser ancha y baja; los
 * filetes, que también llegan como imágenes, miden un punto de alto.
 */
const MIN_WIDTH_RATIO = 0.08
const MIN_HEIGHT_RATIO = 0.03
/** Fracción del área de la página a partir de la cual es un fondo. */
const BACKGROUND_AREA_RATIO = 0.8

const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0)

/**
 * Se queda con las imágenes que vale la pena mostrar entre párrafos: sin
 * iconos ni viñetas, sin el fondo de página completa cuando hay texto encima
 * (mostrarlo duplicaría la página entera), sin repetidas, y de arriba abajo.
 */
export function selectReflowImages(boxes: Box[], page: Box, pageHasText: boolean): Box[] {
  const pageW = page.x1 - page.x0
  const pageH = page.y1 - page.y0
  const pageArea = area(page)
  const seen = new Set<string>()
  const out: Box[] = []

  for (const raw of boxes) {
    const b: Box = {
      x0: Math.max(raw.x0, page.x0),
      y0: Math.max(raw.y0, page.y0),
      x1: Math.min(raw.x1, page.x1),
      y1: Math.min(raw.y1, page.y1),
    }
    const w = b.x1 - b.x0
    const h = b.y1 - b.y0
    if (w < pageW * MIN_WIDTH_RATIO || h < pageH * MIN_HEIGHT_RATIO) continue
    if (pageHasText && area(b) >= pageArea * BACKGROUND_AREA_RATIO) continue
    const key = [b.x0, b.y0, b.x1, b.y1].map(n => Math.round(n)).join(',')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(b)
  }

  return out.sort((a, b) => b.y1 - a.y1)
}

/**
 * Cuánto, en puntos, puede una tabla pasarse de su texto para alcanzar su marco o
 * su título. Un rectángulo que se pasa más que esto es decoración de la página.
 */
const MAX_FRAME_REACH_X = 20
const MAX_FRAME_REACH_Y = 30
/** Cuánto puede separarse un trazo de la tabla, en puntos, y seguir siendo suyo. */
const TABLE_FRAME_MARGIN = 2
/** Fracción de la imagen tapada por texto a partir de la cual es un fondo. */
const BACKGROUND_TEXT_COVERAGE = 0.25
/**
 * Caracteres encima a partir de los cuales ya no son rótulos. Una marca de agua
 * es tan grande que la cobertura no la delata. Si esto se equivoca con un
 * diagrama, se pierde su dibujo; al revés se perdería el texto de la página.
 */
const BACKGROUND_TEXT_CHARS = 200

/** Agranda la tabla hasta los bordes y sombreados que la tocan: el título, el marco. */
function growToFrame(table: Box, painted: Box[]): Box {
  const frames = painted.filter(
    b =>
      table.x0 - b.x0 <= MAX_FRAME_REACH_X &&
      b.x1 - table.x1 <= MAX_FRAME_REACH_X &&
      table.y0 - b.y0 <= MAX_FRAME_REACH_Y &&
      b.y1 - table.y1 <= MAX_FRAME_REACH_Y,
  )
  let grown = table
  for (let changed = true; changed; ) {
    changed = false
    for (const frame of frames) {
      const next = union(grown, frame)
      if (intersects(grown, frame, TABLE_FRAME_MARGIN) && area(next) > area(grown)) {
        grown = next
        changed = true
      }
    }
  }
  return grown
}

function mergeOverlapping(boxes: Box[]): Box[] {
  const out: Box[] = []
  for (const box of boxes) {
    let merged = box
    for (let i = out.length - 1; i >= 0; i--) {
      if (intersects(out[i], merged)) {
        merged = union(out[i], merged)
        out.splice(i, 1)
        i = out.length // Al crecer puede tocar a las que ya pasó.
      }
    }
    out.push(merged)
  }
  return out
}

/** Distancia máxima, en puntos, entre una imagen y los rótulos de sus ejes. */
const MAX_LABEL_REACH = 40
/** Con menos rótulos cerca puede ser un número de página o de nota. */
const MIN_AXIS_LABELS = 3
/** Un rótulo de eje: sólo cifras. Con letras sería texto del libro: "En", "la". */
const AXIS_LABEL = /^[.,%$\s-]*\d[\d.,%$\s-]*$/

/** Letras a partir de las cuales una pila en la misma X es un título escrito en vertical. */
const MIN_STACKED_LETTERS = 4

/** Las letras de un título vertical: cortas, y muchas una arriba de otra en la misma X. */
function stackedLetters(items: PdfTextItem[]): PdfTextItem[] {
  const short = items.filter(item => /^\S{1,2}$/.test(item.str.trim()))
  const atX = (item: PdfTextItem) => Math.round(item.transform[4])
  return short.filter(item => short.filter(other => atX(other) === atX(item)).length >= MIN_STACKED_LETTERS)
}

/** Agranda un gráfico hasta los rótulos de sus ejes, que van como texto alrededor de la imagen. */
function growToAxisLabels(image: Box, items: PdfTextItem[]): Box {
  const reach = {
    x0: image.x0 - MAX_LABEL_REACH,
    y0: image.y0 - MAX_LABEL_REACH,
    x1: image.x1 + MAX_LABEL_REACH,
    y1: image.y1 + MAX_LABEL_REACH,
  }
  const near = (list: PdfTextItem[]) =>
    list.map(itemBox).filter(box => centerInside(box, reach) && !centerInside(box, image))
  const labels = near(items.filter(item => AXIS_LABEL.test(item.str.trim())))
  // Sin rótulos no es un gráfico: unas letras apiladas solas no agrandan una foto.
  if (labels.length < MIN_AXIS_LABELS) return image
  return [...labels, ...near(stackedLetters(items))].reduce(union, image)
}

/** Fracción de la figura más chica que tiene que cubrir la otra para que sean una sola. */
const MIN_FIGURE_OVERLAP = 0.3

function sameFigure(a: Box, b: Box): boolean {
  const width = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const height = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  if (width <= 0 || height <= 0) return false
  return width * height >= Math.min(area(a), area(b)) * MIN_FIGURE_OVERLAP
}

/** Une sólo figuras casi encimadas: si apenas se tocan, juntarlas se traga lo que hay entre ellas. */
function mergeDuplicates(boxes: Box[]): Box[] {
  const out: Box[] = []
  for (const box of boxes) {
    let merged = box
    for (let i = out.length - 1; i >= 0; i--) {
      if (sameFigure(out[i], merged)) {
        merged = union(out[i], merged)
        out.splice(i, 1)
        i = out.length // Al crecer puede alcanzar a las que ya pasó.
      }
    }
    out.push(merged)
  }
  return out
}

/**
 * El texto de una figura, de arriba abajo y de izquierda a derecha. Sólo saca las
 * copias en la misma posición: dos celdas que se pisan pueden decir lo mismo.
 */
function altText(items: PdfTextItem[]): string {
  const seen = new Set<string>()
  return [...items]
    .sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])
    .filter(item => {
      const key = `${item.str}@${Math.round(item.transform[4])},${Math.round(item.transform[5])}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(item => item.str.trim())
    .filter(Boolean)
    .join(' ')
}

export interface PageReflowInput {
  imageBoxes: Box[]
  paintedBoxes: Box[]
  items: PdfTextItem[]
  page: Box
}

export interface PageReflowPlan {
  /** Lo que se muestra recortado de la página: imágenes y tablas, de arriba abajo. */
  figures: Box[]
  /** El texto que tiene impreso cada figura, en el mismo orden, para lectores de pantalla. */
  altTexts: string[]
  /** El texto que queda para armar los párrafos, sin lo que ya muestra una figura. */
  items: PdfTextItem[]
}

/**
 * Decide qué de la página se muestra como figura y qué como texto, para que
 * nada aparezca dos veces. El recorte sale de un render de la página, así que
 * lleva impreso el texto que tenga encima:
 *
 * - Una tabla va como figura: en párrafos sus celdas no se entienden.
 * - Una imagen con rótulos también, y el rótulo deja de ser párrafo.
 * - Una imagen con mucho texto encima es un fondo: se descarta y el texto se lee.
 */
export function planPageReflow({ imageBoxes, paintedBoxes, items, page }: PageReflowInput): PageReflowPlan {
  const tables = mergeOverlapping([
    ...findTableBoxes(items).map(table => growToFrame(table, paintedBoxes)),
    ...findGridBoxes(paintedBoxes, items),
  ])
  const hasText = items.some(item => item.str?.trim())
  const free = items.filter(item => !tables.some(table => containsText(table, item)))

  const images = selectReflowImages(imageBoxes, page, hasText).filter(image => {
    if (tables.some(table => centerInside(image, table))) return false
    const above = free.filter(item => centerInside(itemBox(item), image))
    const covered = above.reduce((sum, item) => sum + area(itemBox(item)), 0)
    const chars = above.reduce((sum, item) => sum + item.str.trim().length, 0)
    return covered < area(image) * BACKGROUND_TEXT_COVERAGE && chars < BACKGROUND_TEXT_CHARS
  })

  const figures = mergeDuplicates([...tables, ...images.map(image => growToAxisLabels(image, free))]).sort(
    (a, b) => b.y1 - a.y1,
  )
  return {
    figures,
    altTexts: figures.map(figure => altText(items.filter(item => containsText(figure, item)))),
    // Un renglón que el recorte cortaría se queda en el texto: mejor verlo dos veces que perderlo.
    items: items.filter(item => !figures.some(figure => containsText(figure, item))),
  }
}

/**
 * Pasa una caja del espacio del PDF a pixeles del canvas, con `viewport.transform`.
 * Se aplica a mano porque pdf.js 6 sacó `convertToViewportRectangle`.
 */
export function boxToViewportRect(
  box: Box,
  transform: Matrix,
): { left: number; top: number; width: number; height: number } {
  const [a, b, c, d, e, f] = transform
  const x0 = a * box.x0 + c * box.y0 + e
  const y0 = b * box.x0 + d * box.y0 + f
  const x1 = a * box.x1 + c * box.y1 + e
  const y1 = b * box.x1 + d * box.y1 + f
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  }
}

/**
 * Antes de qué párrafo va una imagen: la posición que deja la menor cantidad de
 * párrafos del lado equivocado, y ante un empate la última. El orden del PDF no
 * siempre es el visual, y un pie de página o un párrafo tardío no pueden moverla
 * solos. Pensado para una sola columna.
 */
export function imageInsertionIndex(paragraphTops: number[], imageTop: number): number {
  let misplaced = paragraphTops.filter(top => top > imageTop).length
  let best = 0
  let fewest = misplaced
  paragraphTops.forEach((top, i) => {
    misplaced += top > imageTop ? -1 : 1
    if (misplaced <= fewest) {
      fewest = misplaced
      best = i + 1
    }
  })
  return best
}
