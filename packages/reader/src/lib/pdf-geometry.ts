/** Geometría en el espacio del PDF, compartida por la detección de imágenes y de tablas. */
import type { PdfTextItem } from './pdf-text.js'

/** Caja en el espacio del PDF: x0 < x1, y0 < y1, la Y crece hacia arriba. */
export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export const intersects = (a: Box, b: Box, margin = 0) =>
  a.x0 - margin <= b.x1 && b.x0 - margin <= a.x1 && a.y0 - margin <= b.y1 && b.y0 - margin <= a.y1

export const union = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
})

export function itemBox(item: PdfTextItem): Box {
  const x0 = item.transform[4]
  const y0 = item.transform[5]
  const height = item.height && item.height > 0 ? item.height : Math.abs(item.transform[3] ?? 0)
  return { x0, y0, x1: x0 + (item.width ?? 0), y1: y0 + height }
}

export function centerInside(inner: Box, outer: Box): boolean {
  const x = (inner.x0 + inner.x1) / 2
  const y = (inner.y0 + inner.y1) / 2
  return x >= outer.x0 && x <= outer.x1 && y >= outer.y0 && y <= outer.y1
}

/** Puntos que un texto puede asomar de la caja sin que el recorte le corte una letra. */
const MAX_TEXT_OVERFLOW = 3

/** Si el texto queda entero dentro de la caja, sin que el borde le corte nada. */
export function containsText(outer: Box, item: PdfTextItem): boolean {
  const box = itemBox(item)
  if (!centerInside(box, outer)) return false
  return box.x0 >= outer.x0 - MAX_TEXT_OVERFLOW && box.x1 <= outer.x1 + MAX_TEXT_OVERFLOW
}
