import type { ReaderStorage } from '../types.js'

export type BookSource =
  | { kind: 'url'; url: string; revoke: boolean }
  | { kind: 'missing' }

/**
 * Which file to open: the offline copy when `storage` has one, else `src`.
 * A `src` that answers 404 to a HEAD request is a missing book; any other
 * failure of that check still tries `src` (the check is only a courtesy).
 */
export async function loadBookSource({
  bookId,
  src,
  storage,
  fetchImpl = typeof fetch === 'function' ? fetch : undefined,
}: {
  bookId: string
  src: string
  storage?: ReaderStorage
  fetchImpl?: typeof fetch
}): Promise<BookSource> {
  try {
    const blob = storage ? await storage.getFile(bookId) : null
    if (blob) return { kind: 'url', url: URL.createObjectURL(blob), revoke: true }
  } catch (err) {
    console.warn('Could not read the offline copy of the book', err)
  }

  if (!src) return { kind: 'missing' }
  if (src.startsWith('blob:') || src.startsWith('data:') || !fetchImpl) return { kind: 'url', url: src, revoke: false }

  try {
    const res = await fetchImpl(src, { method: 'HEAD' })
    if (res.status === 404) return { kind: 'missing' }
  } catch (err) {
    console.warn('Could not check the book file with HEAD, opening it anyway', err)
  }
  return { kind: 'url', url: src, revoke: false }
}
