import type { ReaderFormat } from '../types.js'

/**
 * The format of a book from its URL or file name: `.pdf` is PDF, anything
 * else EPUB (glimpse's rule). Query strings and fragments are ignored, so a
 * signed URL works too. Pass `format` to the reader when the URL carries no
 * extension (`/api/books/1/file`).
 */
export function detectFormat(src: string): ReaderFormat {
  const path = (src || '').split(/[?#]/)[0] ?? ''
  return path.toLowerCase().endsWith('.pdf') ? 'pdf' : 'epub'
}
