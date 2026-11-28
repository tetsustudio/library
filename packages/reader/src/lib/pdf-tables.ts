/**
 * Encuentra tablas en una página de PDF por sus columnas alineadas.
 *
 * Se mira el texto y no las líneas porque muchas tablas casi no tienen: filas
 * sombreadas, o sólo un filete abajo del encabezado. Lo que una tabla siempre
 * tiene son celdas cortas que se repiten en las mismas columnas. Las medidas
 * son relativas al cuerpo de cada línea, igual que en `pdf-text.ts`.
 */
import { centerInside, intersects, itemBox, union, type Box } from './pdf-geometry.js'
import type { PdfTextItem } from './pdf-text.js'

/** Hueco, en cuerpos de letra, que separa dos celdas y no dos palabras. */
const CELL_GAP_RATIO = 1.2
/** Tolerancia, en cuerpos de letra, para decir que dos celdas están alineadas. */
const ALIGN_RATIO = 0.8
/** Salto máximo entre filas, en cuerpos de letra, para seguir en la misma tabla. */
const ROW_GAP_RATIO = 4
/** Una celda más larga que esto es un renglón de texto corrido. */
const MAX_CELL_CHARS = 40
/** Palabras a partir de las cuales una celda sin cifras es una frase y no un dato. */
const PHRASE_WORDS = 4
/** Si más que esto de las filas tiene frases, son columnas de texto. */
const MAX_PHRASE_ROW_SHARE = 0.4
/** Con dos columnas una tabla se lee bien como renglones, y es fácil confundirla. */
const MIN_COLUMNS = 3
/** Con menos filas alineadas puede ser casualidad. */
const MIN_TABLE_ROWS = 3
/** Lo que baja la letra por debajo de la línea de base, en cuerpos. */
const DESCENT_RATIO = 0.25

/** Lo que abre un ítem de lista: una viñeta, `1.`, `a)`. */
const LIST_MARKER = new RegExp('^(?:[^\\p{L}\\p{N}]|\\d+(?:\\.\\d+)*[.)]|\\p{L}[.)])$', 'u')
const NUMBER = /^[\d.,]+$/
const ROMAN = /^[ivxlcdm]+\.?$/i
/** Una tabla corta también puede tener números que crecen; un índice es más largo. */
const MIN_INDEX_ROWS = 5

interface Cell {
  x0: number
  x1: number
  chars: number
  text: string
}

interface Row {
  y: number
  fontSize: number
  cells: Cell[]
}

const fontSizeOf = (item: PdfTextItem) =>
  item.height && item.height > 0 ? item.height : Math.abs(item.transform[3] ?? 0) || 12

function buildRows(items: PdfTextItem[]): Row[] {
  const horizontal = items
    .filter(item => item.str?.trim() && !item.transform[1] && !item.transform[2])
    .sort((a, b) => b.transform[5] - a.transform[5])

  const groups: PdfTextItem[][] = []
  for (const item of horizontal) {
    const last = groups[groups.length - 1]
    const sameRow = last && Math.abs(last[0].transform[5] - item.transform[5]) <= fontSizeOf(last[0]) * 0.5
    if (sameRow) last.push(item)
    else groups.push([item])
  }

  return groups.map(group => {
    const fontSize = Math.max(...group.map(fontSizeOf))
    const cells: Cell[] = []
    for (const item of [...group].sort((a, b) => a.transform[4] - b.transform[4])) {
      const x0 = item.transform[4]
      const x1 = x0 + (item.width ?? 0)
      const text = item.str.trim()
      const chars = text.length
      const last = cells[cells.length - 1]
      if (last && x0 - last.x1 <= fontSize * CELL_GAP_RATIO) {
        last.x1 = Math.max(last.x1, x1)
        last.chars += chars
        last.text += ` ${text}`
      } else {
        cells.push({ x0, x1, chars, text })
      }
    }
    // El marcador de una lista no es una columna.
    const content = cells.length > 1 && LIST_MARKER.test(cells[0].text) ? cells.slice(1) : cells
    return { y: group[0].transform[5], fontSize, cells: content }
  })
}

const isProse = (row: Row) => row.cells.some(cell => cell.chars > MAX_CELL_CHARS)
const hasColumns = (row: Row) => row.cells.length >= 2 && !isProse(row)
const isPhrase = (cell: Cell) => cell.text.split(/\s+/).length >= PHRASE_WORDS && !/\d/.test(cell.text)

/** Si el bloque tiene forma de tabla y no de columnas de texto. Ante la duda, es texto. */
function looksLikeTable(rows: Row[]): boolean {
  const columns = rows.map(row => row.cells.length).sort((a, b) => a - b)
  if (columns[Math.floor(columns.length / 2)] < MIN_COLUMNS) return false
  return rows.filter(row => row.cells.some(isPhrase)).length / rows.length <= MAX_PHRASE_ROW_SHARE
}

/** Si al menos dos celdas de la fila caen en columnas de la anterior. */
function alignsWith(row: Row, previous: Row): boolean {
  const tolerance = row.fontSize * ALIGN_RATIO
  const near = (a: number, b: number) => Math.abs(a - b) <= tolerance
  const center = (c: Cell) => (c.x0 + c.x1) / 2
  const matches = row.cells.filter(cell =>
    previous.cells.some(
      other => near(cell.x0, other.x0) || near(cell.x1, other.x1) || near(center(cell), center(other)),
    ),
  )
  return matches.length >= 2
}

function boxOf(rows: Row[]): Box {
  const cells = rows.flatMap(row => row.cells)
  const bottom = rows[rows.length - 1]
  return {
    x0: Math.min(...cells.map(c => c.x0)),
    y0: bottom.y - bottom.fontSize * DESCENT_RATIO,
    x1: Math.max(...cells.map(c => c.x1)),
    y1: rows[0].y + rows[0].fontSize,
  }
}

/** Títulos con un solo número al final, y esos números siempre crecen: un índice. */
function looksLikeIndex(rows: Row[]): boolean {
  if (rows.length < MIN_INDEX_ROWS) return false
  const pages: number[] = []
  for (const { cells } of rows) {
    const last = cells[cells.length - 1].text
    // El número o el romano de capítulo, adelante, también es parte de un índice.
    const [first, ...others] = cells.slice(0, -1)
    const chapter = first && (NUMBER.test(first.text) || ROMAN.test(first.text))
    const titles = chapter ? others : cells.slice(0, -1)
    if (!NUMBER.test(last) || titles.length === 0 || titles.some(cell => NUMBER.test(cell.text))) return false
    pages.push(Number(last.replace(/[.,]/g, '')))
  }
  const grows = pages[pages.length - 1] > pages[0]
  return grows && pages.every((page, i) => i === 0 || page >= pages[i - 1])
}

/** Las cajas de las tablas de una página, de arriba hacia abajo. */
export function findTableBoxes(items: PdfTextItem[]): Box[] {
  const tables: Box[] = []
  let table: Row[] = []
  let columnRows = 0
  let lastColumnRow: Row | null = null
  // Una fila de una sola celda: es parte de la tabla sólo si la tabla sigue.
  let pending: Row | null = null

  const close = () => {
    const withColumns = table.filter(hasColumns)
    if (columnRows >= MIN_TABLE_ROWS && looksLikeTable(withColumns) && !looksLikeIndex(withColumns)) {
      tables.push(boxOf(table))
    }
    table = []
    columnRows = 0
    lastColumnRow = null
    pending = null
  }

  for (const row of buildRows(items)) {
    const last: Row | undefined = pending ?? table[table.length - 1]
    const near = last !== undefined && last.y - row.y <= row.fontSize * ROW_GAP_RATIO

    if (hasColumns(row)) {
      if (!near || !lastColumnRow || !alignsWith(row, lastColumnRow)) close()
      if (pending) table.push(pending)
      pending = null
      table.push(row)
      columnRows++
      lastColumnRow = row
    } else if (table.length > 0 && near && !pending && !isProse(row)) {
      pending = row
    } else {
      close()
    }
  }
  close()

  return tables
}

/** Grosor máximo, en puntos, de un trazo que cuenta como línea de una grilla. */
const MAX_LINE_THICKNESS = 3
/** Largo mínimo de esa línea: lo que mide menos es un adorno o una marca de lista. */
const MIN_LINE_LENGTH = 8
/** Separación, en puntos, con la que dos líneas siguen siendo de la misma grilla. */
const LINE_TOUCH_MARGIN = 2
/** Mínimo de filas y de columnas delimitadas: con menos es un recuadro. */
const MIN_GRID_LINES = 3
/** Si una grilla encierra más renglones largos que esto, es un marco de texto. */
const MAX_GRID_PROSE_SHARE = 0.3

/**
 * Tablas por sus líneas, para las que tienen muy pocas filas para que se note la
 * alineación. Un recuadro alrededor de un texto también son líneas que se cruzan:
 * por eso exige celdas y mira que lo de adentro no sea texto corrido.
 */
export function findGridBoxes(painted: Box[], items: PdfTextItem[]): Box[] {
  const lines = painted.filter(({ x0, y0, x1, y1 }) => {
    const width = x1 - x0
    const height = y1 - y0
    return (
      (height <= MAX_LINE_THICKNESS && width >= MIN_LINE_LENGTH) ||
      (width <= MAX_LINE_THICKNESS && height >= MIN_LINE_LENGTH)
    )
  })

  const clusters: { box: Box; lines: Box[] }[] = []
  for (const line of lines) {
    const touching = clusters.filter(c => intersects(c.box, line, LINE_TOUCH_MARGIN))
    const merged = {
      box: touching.reduce((box, c) => union(box, c.box), line),
      lines: [line, ...touching.flatMap(c => c.lines)],
    }
    touching.forEach(c => clusters.splice(clusters.indexOf(c), 1))
    clusters.push(merged)
  }

  const distinct = (values: number[]) => new Set(values.map(Math.round)).size

  return clusters
    .filter(({ box, lines: own }) => {
      const horizontal = own.filter(l => l.y1 - l.y0 <= MAX_LINE_THICKNESS).map(l => l.y0)
      const vertical = own.filter(l => l.x1 - l.x0 <= MAX_LINE_THICKNESS).map(l => l.x0)
      if (distinct(horizontal) < MIN_GRID_LINES || distinct(vertical) < MIN_GRID_LINES) return false

      const rows = buildRows(items.filter(item => centerInside(itemBox(item), box)))
      if (rows.length === 0) return false
      return rows.filter(isProse).length / rows.length <= MAX_GRID_PROSE_SHARE
    })
    .map(cluster => cluster.box)
}
