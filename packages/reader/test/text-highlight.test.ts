import { describe, it, expect } from 'vitest'
import {
  buildSearchIndex,
  normalizeChunk,
  locateChunk,
  sliceByNode,
  decideHighlightScroll,
} from '../src/lib/text-highlight.js'

/**
 * Ubicar el fragmento que se está leyendo dentro del documento del libro.
 *
 * El caso que importa: el texto del EPUB viene con los saltos de línea y las
 * sangrías del HTML, y el fragmento que entrega el TTS ya tiene los espacios
 * colapsados. Sin normalizar las dos puntas, cualquier fragmento que cruce un
 * salto de línea no se encuentra nunca — y son casi todos.
 */

describe('buildSearchIndex', () => {
  it('colapsa los espacios y recuerda de dónde salió cada carácter', () => {
    const { normalized, positions } = buildSearchIndex(['Hola\n   mundo'])
    expect(normalized).toBe('Hola mundo')
    expect(positions).toHaveLength(normalized.length)
    // La 'm' está en el offset 8 del texto original.
    expect(positions[5]).toEqual({ node: 0, offset: 8 })
  })

  it('el espacio que sobrevive es el primero, o sea una posición real', () => {
    const { positions } = buildSearchIndex(['a \n\t b'])
    expect(positions[1]).toEqual({ node: 0, offset: 1 })
  })

  it('se come el espacio del principio', () => {
    expect(buildSearchIndex(['\n    Capítulo uno']).normalized).toBe('Capítulo uno')
  })

  it('varios nodos se concatenan sin inventar espacios entre ellos', () => {
    // Es un <em> en el medio: "muy" queda pegado como en el render.
    expect(buildSearchIndex(['un texto ', 'muy', ' largo']).normalized).toBe('un texto muy largo')
  })

  it('el salto entre nodos sí colapsa si los dos tienen espacio', () => {
    expect(buildSearchIndex(['fin de línea \n', '  siguiente']).normalized).toBe(
      'fin de línea siguiente'
    )
  })
})

describe('normalizeChunk', () => {
  it('deja el fragmento como lo entrega splitIntoChunks', () => {
    expect(normalizeChunk('  Hola\n  mundo.  ')).toBe('Hola mundo.')
  })
})

describe('locateChunk', () => {
  const index = buildSearchIndex(['—Sí —dijo—.\n  No lo sé.\n  —Sí —repitió.'])

  it('encuentra el fragmento', () => {
    const loc = locateChunk(index, 'No lo sé.')
    expect(loc).not.toBeNull()
    expect(index.normalized.slice(loc!.start, loc!.end)).toBe('No lo sé.')
  })

  it('busca hacia adelante: un fragmento repetido no vuelve al principio', () => {
    const primero = locateChunk(index, '—Sí')!
    const segundo = locateChunk(index, '—Sí', primero.end)!
    expect(segundo.start).toBeGreaterThan(primero.start)
  })

  it('si no está hacia adelante, reintenta desde el principio', () => {
    // Es lo que pasa al pasar a un capítulo nuevo: el cursor quedó al final.
    const loc = locateChunk(index, 'No lo sé.', 9999)
    expect(loc).not.toBeNull()
  })

  it('lo que no está, no está', () => {
    expect(locateChunk(index, 'esto no aparece')).toBeNull()
    expect(locateChunk(index, '   ')).toBeNull()
  })

  it('encuentra aunque el fragmento cruce un salto de línea del HTML', () => {
    const conSaltos = buildSearchIndex(['El viento\n        sopló fuerte.'])
    expect(locateChunk(conSaltos, 'El viento sopló fuerte.')).not.toBeNull()
  })
})

describe('sliceByNode', () => {
  it('un fragmento que cruza etiquetas se parte por nodo', () => {
    // <p>un texto <em>muy</em> largo</p>
    const index = buildSearchIndex(['un texto ', 'muy', ' largo'])
    const loc = locateChunk(index, 'texto muy largo')!
    const slices = sliceByNode(index, loc)

    expect(slices.map(s => s.node)).toEqual([0, 1, 2])
    expect(slices[0]).toEqual({ node: 0, start: 3, end: 9 })
    expect(slices[1]).toEqual({ node: 1, start: 0, end: 3 })
    expect(slices[2]).toEqual({ node: 2, start: 0, end: 6 })
  })

  it('dentro de un nodo queda un solo tramo, aunque haya espacio colapsado', () => {
    // Si se cortara en cada hueco, el resaltado quedaría partido con agujeros.
    const index = buildSearchIndex(['El viento\n        sopló'])
    const loc = locateChunk(index, 'El viento sopló')!
    const slices = sliceByNode(index, loc)

    expect(slices).toHaveLength(1)
    expect(slices[0]).toEqual({ node: 0, start: 0, end: 23 })
  })

  it('sin coincidencia no hay tramos', () => {
    const index = buildSearchIndex(['hola'])
    expect(sliceByNode(index, { start: 0, end: 0 })).toEqual([])
  })
})

describe('decideHighlightScroll', () => {
  const limites = { bottomLimit: 0.75, targetTop: 0.45, maxJumpViewports: 3 }
  const viewport = 1000

  it('no mueve nada si el tramo todavia entra comodo', () => {
    expect(decideHighlightScroll({ top: 500, bottom: 700, viewport }, limites)).toBe('quieto')
  })

  it('mueve cuando el tramo se fue para abajo', () => {
    expect(decideHighlightScroll({ top: 800, bottom: 900, viewport }, limites)).toBe('mover')
  })

  // El bug que volvio dos veces: parrafo largo que arranca arriba del objetivo
  // y termina abajo del limite. Mover lo bajaria hasta el 45%, o sea para atras.
  it('no mueve un parrafo largo que ya arranca arriba del objetivo', () => {
    expect(decideHighlightScroll({ top: 100, bottom: 900, viewport }, limites)).toBe('quieto')
  })

  it('no mueve al arrancar la lectura, con el tramo en el borde de arriba', () => {
    expect(decideHighlightScroll({ top: 0, bottom: 800, viewport }, limites)).toBe('quieto')
  })

  it('no mueve un tramo que quedo por encima de la pantalla', () => {
    expect(decideHighlightScroll({ top: -400, bottom: 900, viewport }, limites)).toBe('quieto')
  })

  it('justo en el objetivo se queda quieto, no fuerza un movimiento de cero', () => {
    expect(decideHighlightScroll({ top: 450, bottom: 900, viewport }, limites)).toBe('quieto')
  })

  it('un pixel abajo del objetivo ya es un movimiento hacia adelante', () => {
    expect(decideHighlightScroll({ top: 451, bottom: 900, viewport }, limites)).toBe('mover')
  })

  it('avisa en vez de saltar cuando la coincidencia quedo lejisimos', () => {
    expect(decideHighlightScroll({ top: 3500, bottom: 3700, viewport }, limites)).toBe(
      'demasiado-lejos'
    )
  })

  // Nunca puede devolver 'mover' si eso implica subir la pagina.
  it('jamas manda mover cuando el resultado seria un scroll para atras', () => {
    for (let top = -2000; top <= 2000; top += 10) {
      for (let alto = 50; alto <= 1500; alto += 50) {
        const decision = decideHighlightScroll({ top, bottom: top + alto, viewport }, limites)
        if (decision === 'mover') {
          // Mover deja el arranque en viewport * targetTop. Que sea un avance
          // significa que hoy esta MAS ABAJO que eso.
          expect(top).toBeGreaterThan(viewport * limites.targetTop)
        }
      }
    }
  })
})
