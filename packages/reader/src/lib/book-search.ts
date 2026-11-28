/**
 * Buscar texto en todo el libro.
 *
 * epubjs solo sabe buscar dentro de una seccion **ya cargada**
 * (`section.find()` necesita `section.document`), asi que buscar en el libro
 * entero es cargar cada seccion, buscar, y descargarla. Es caro y por eso hay
 * tope de resultados, corte por cancelacion y aviso de progreso: en un libro de
 * 600 secciones, sin nada de eso, la pestaña se congela sin decir por que.
 *
 * Se descarga cada seccion apenas se termina de buscar en ella. Sin el
 * `unload()`, buscar en un libro grande deja el libro entero en memoria.
 */

export interface BookSearchHit {
  /** CFI exacto de la coincidencia: es lo que se le pasa a `rendition.display`. */
  cfi: string
  /** El texto alrededor, como lo arma epubjs. */
  excerpt: string
  /** Titulo de la seccion, para agrupar visualmente. */
  section: string
}

export interface BookSearchOptions {
  /** Tope de resultados. Mas que esto no se lee, se refina la busqueda. */
  limit?: number
  /** Para cortar cuando el usuario cierra el panel o escribe otra cosa. */
  signal?: { cancelled: boolean }
  onProgress?: (done: number, total: number) => void
}

/** Menos de esto devuelve medio libro y no sirve de nada. */
export const MIN_QUERY_LENGTH = 3

export async function searchBook(
  book: any,
  query: string,
  options: BookSearchOptions = {}
): Promise<BookSearchHit[]> {
  const term = query.trim()
  if (term.length < MIN_QUERY_LENGTH) return []

  const { limit = 80, signal, onProgress } = options
  const items: any[] = book?.spine?.spineItems ?? []
  const hits: BookSearchHit[] = []

  // El indice, para poder decir en que capitulo cayo cada resultado. Los href
  // del indice llevan fragmento y los del spine no, asi que se compara por
  // archivo.
  const labels = new Map<string, string>()
  try {
    const navigation = await book.loaded.navigation
    for (const entry of navigation?.toc ?? []) {
      const file = String(entry.href ?? '').split('#')[0]
      if (file && !labels.has(file)) labels.set(file, String(entry.label ?? '').trim())
    }
  } catch {
    // Sin indice se muestra el resultado sin titulo de seccion.
  }

  for (let i = 0; i < items.length; i++) {
    if (signal?.cancelled || hits.length >= limit) break

    const item = items[i]
    try {
      await item.load(book.load.bind(book))
      const found: { cfi: string; excerpt: string }[] = item.find(term) ?? []
      const section = labels.get(item.href) ?? ''

      for (const match of found) {
        hits.push({ cfi: match.cfi, excerpt: match.excerpt.trim(), section })
        if (hits.length >= limit) break
      }
    } catch (error) {
      // Una seccion que no carga no puede tumbar la busqueda entera.
      console.warn('Busqueda: no se pudo leer una seccion', item?.href, error)
    } finally {
      // Sin esto, buscar en un libro grande lo deja entero en memoria.
      try {
        item.unload()
      } catch {
        // Ya descargada.
      }
    }

    onProgress?.(i + 1, items.length)
  }

  return hits
}
