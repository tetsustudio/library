/**
 * Ubicar un fragmento de texto adentro del documento del libro.
 *
 * Antes esto lo hacia `window.find`, que resalta usando la **seleccion del
 * navegador**. De ahi salian dos problemas que no se pueden arreglar sin
 * cambiar de mecanismo:
 *
 *  1. Un click en cualquier lado colapsa la seleccion. La lectura seguia y el
 *     resaltado desaparecia, que es exactamente lo que se ve al tocar la
 *     pantalla mientras escucha.
 *  2. La seleccion solo se puede pintar con `::selection`, que acepta cuatro
 *     propiedades y ninguna es `border-radius` ni `padding`.
 *
 * Lo que hace este modulo es la parte pura: aplanar el texto del documento a
 * una sola cadena normalizada, con un mapa de vuelta a (nodo, offset), y
 * buscar el fragmento ahi. Envolverlo en spans es la parte que necesita DOM y
 * vive en el lector.
 *
 * La normalizacion importa: `splitIntoChunks` entrega el texto con los
 * espacios colapsados (`\s+` -> ' '), pero en el DOM el mismo texto viene con
 * saltos de linea y sangrias del HTML del EPUB. Sin normalizar las dos puntas,
 * un fragmento que cruza un salto de linea no se encuentra nunca.
 */

/** A que (nodo, offset) del documento corresponde cada caracter normalizado. */
export interface CharPosition {
  /** Indice dentro del arreglo de textos que se paso a `buildSearchIndex`. */
  node: number
  offset: number
}

export interface SearchIndex {
  /** Todo el texto, con los espacios colapsados. */
  normalized: string
  /** Una entrada por caracter de `normalized`. */
  positions: CharPosition[]
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char)
}

/**
 * Aplana los textos a una cadena normalizada y guarda de donde salio cada
 * caracter. Los espacios repetidos colapsan a uno solo; el que sobrevive es el
 * primero, asi que el mapa siempre apunta a una posicion real del documento.
 */
export function buildSearchIndex(texts: string[]): SearchIndex {
  let normalized = ''
  const positions: CharPosition[] = []
  let lastWasSpace = true // arranca en true para comerse el espacio inicial

  texts.forEach((text, node) => {
    for (let offset = 0; offset < text.length; offset++) {
      const char = text[offset]

      if (isWhitespace(char)) {
        if (lastWasSpace) continue
        normalized += ' '
        positions.push({ node, offset })
        lastWasSpace = true
        continue
      }

      normalized += char
      positions.push({ node, offset })
      lastWasSpace = false
    }
  })

  return { normalized, positions }
}

/** El fragmento, normalizado igual que el indice. */
export function normalizeChunk(chunk: string): string {
  return chunk.replace(/\s+/g, ' ').trim()
}

export interface ChunkLocation {
  /** Indices dentro de `normalized`; `end` es exclusivo. */
  start: number
  end: number
}

/**
 * Busca el fragmento desde `fromChar` hacia adelante.
 *
 * Hacia adelante y sin volver al principio: un fragmento repetido — "—Sí.", un
 * nombre — aparece muchas veces en un capitulo, y buscar siempre desde cero
 * resalta la primera aparicion en vez de la que se esta leyendo. Si no lo
 * encuentra hacia adelante, recien ahi reintenta desde el principio, que es el
 * caso de haber pasado a un capitulo nuevo.
 */
export function locateChunk(
  index: SearchIndex,
  chunk: string,
  fromChar = 0
): ChunkLocation | null {
  const needle = normalizeChunk(chunk)
  if (!needle) return null

  let start = index.normalized.indexOf(needle, Math.max(0, fromChar))
  if (start === -1 && fromChar > 0) start = index.normalized.indexOf(needle)
  if (start === -1) return null

  return { start, end: start + needle.length }
}

export interface NodeSlice {
  node: number
  start: number
  /** Exclusivo. */
  end: number
}

/**
 * Parte una ubicacion en un tramo por nodo de texto.
 *
 * Hace falta porque un fragmento hablado casi siempre cruza etiquetas — una
 * cursiva, un enlace, el corte de un parrafo — y no se puede envolver de una
 * sola vez: `Range.surroundContents` tira error apenas el rango cruza un
 * limite de elemento. Se envuelve tramo por tramo.
 */
export function sliceByNode(index: SearchIndex, location: ChunkLocation): NodeSlice[] {
  const slices: NodeSlice[] = []

  for (let i = location.start; i < location.end && i < index.positions.length; i++) {
    const { node, offset } = index.positions[i]
    const last = slices[slices.length - 1]

    // Se extiende aun si hay un hueco, siempre que sea el mismo nodo: lo que
    // quedo en el medio es espacio en blanco que la normalizacion colapso.
    // Cortar ahi partiria el resaltado en dos spans con un agujero visible.
    if (last && last.node === node && offset >= last.end) {
      last.end = offset + 1
      continue
    }

    slices.push({ node, start: offset, end: offset + 1 })
  }

  return slices
}

/**
 * Que hacer con la vista cuando se resalta un tramo nuevo.
 *
 * Vive aca, separado del lector, porque es la regla que mas veces se
 * rompio y no se puede probar con un EPUB de verdad. Las tres decisiones
 * posibles son excluyentes y el orden importa.
 */
export type HighlightScrollDecision = 'quieto' | 'mover' | 'demasiado-lejos'

export interface HighlightBox {
  /** Donde empieza el tramo, en px desde el borde de arriba de la ventana. */
  top: number
  /** Donde termina. Puede ser muy distinto de `top` en un parrafo largo. */
  bottom: number
  /** Alto de la ventana. */
  viewport: number
}

export interface HighlightScrollLimits {
  /** Pasado esto, el tramo se considera fuera de la zona comoda de lectura. */
  bottomLimit: number
  /** Donde aterriza el arranque del tramo cuando se mueve la vista. */
  targetTop: number
  /** Mas lejos que esto es casi seguro una coincidencia equivocada. */
  maxJumpViewports: number
}

/**
 * **La vista solo se mueve hacia adelante.** Nunca para atras, por ningun
 * motivo: si el tramo quedo arriba, o lo dejaste vos scrolleando a mano, o es
 * el primero de la lectura, y en los dos casos moverse seria ir en contra de
 * lo que la persona esta leyendo.
 *
 * Los dos limites miran puntos distintos del tramo y hacen falta los dos:
 *
 * - `bottomLimit` mira donde TERMINA. Es el disparador: si el final todavia
 *   entra comodo en pantalla, no hay nada que corregir.
 * - `targetTop` mira donde EMPIEZA, que es el punto que efectivamente se
 *   scrollea. Con un parrafo largo los dos no coinciden — el final puede
 *   estar por debajo del limite mientras el arranque ya esta por encima del
 *   objetivo — y mover en ese caso baja el arranque hasta el objetivo, o sea
 *   scrollea para atras. Ese fue el bug que volvio dos veces.
 */
export function decideHighlightScroll(
  box: HighlightBox,
  limits: HighlightScrollLimits
): HighlightScrollDecision {
  const { top, bottom, viewport } = box

  // Todavia entra comodo: no se toca.
  if (bottom <= viewport * limits.bottomLimit) return 'quieto'

  // Mover lo llevaria hacia abajo desde donde ya esta: seria ir para atras.
  if (top <= viewport * limits.targetTop) return 'quieto'

  if (Math.abs(top) > viewport * limits.maxJumpViewports) return 'demasiado-lejos'

  return 'mover'
}
