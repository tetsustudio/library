import { describe, it, expect } from 'vitest'
import { boxToViewportRect, findImageBoxes, findPaintedBoxes, selectReflowImages, imageInsertionIndex, type ImageOps } from '../src/lib/pdf-images.js'
import { extractParagraphBlocks, type PdfTextItem } from '../src/lib/pdf-text.js'

/**
 * El modo texto del PDF tiraba las imagenes: solo leia getTextContent().
 * Ahora las cajas salen del operator list de pdf.js y se ubican entre los
 * parrafos por su altura en la pagina. Todo eso es logica pura y se fija aca.
 */

const OPS: ImageOps = {
  save: 1,
  restore: 2,
  transform: 3,
  paintFormXObjectBegin: 4,
  paintFormXObjectEnd: 5,
  paintImageXObject: 6,
  paintInlineImageXObject: 7,
  paintImageXObjectRepeat: 8,
  constructPath: 9,
  endPath: 10,
  clip: 11,
  eoClip: 12,
}

describe('findImageBoxes', () => {
  it('lleva el cuadrado unitario de la imagen al espacio de la pagina con la CTM', () => {
    const boxes = findImageBoxes(
      [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
      [[], [200, 0, 0, 100, 50, 300], ['img1'], []],
      OPS,
    )
    expect(boxes).toEqual([{ x0: 50, y0: 300, x1: 250, y1: 400 }])
  })

  it('restore vuelve a la CTM anterior', () => {
    const boxes = findImageBoxes(
      [OPS.save, OPS.transform, OPS.restore, OPS.transform, OPS.paintImageXObject],
      [[], [999, 0, 0, 999, 0, 0], [], [100, 0, 0, 100, 10, 20], ['img']],
      OPS,
    )
    expect(boxes).toEqual([{ x0: 10, y0: 20, x1: 110, y1: 120 }])
  })

  it('aplica la matriz de un form XObject y la descarta al cerrarlo', () => {
    const boxes = findImageBoxes(
      [OPS.paintFormXObjectBegin, OPS.transform, OPS.paintImageXObject, OPS.paintFormXObjectEnd, OPS.paintInlineImageXObject],
      [[[1, 0, 0, 1, 100, 100], null], [50, 0, 0, 50, 0, 0], ['a'], [], [{}]],
      OPS,
    )
    expect(boxes[0]).toEqual({ x0: 100, y0: 100, x1: 150, y1: 150 })
    // Fuera del form la CTM vuelve a la identidad: cuadrado de 1x1.
    expect(boxes[1]).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 })
  })

  it('normaliza imagenes espejadas (escala negativa)', () => {
    const boxes = findImageBoxes(
      [OPS.transform, OPS.paintImageXObject],
      [[100, 0, 0, -100, 0, 500], ['img']],
      OPS,
    )
    expect(boxes).toEqual([{ x0: 0, y0: 400, x1: 100, y1: 500 }])
  })
})

describe('findImageBoxes con recorte', () => {
  const clipTo = (x0: number, y0: number, x1: number, y1: number) => [OPS.endPath, [[]], [x0, y0, x1, y1]]

  it('una imagen enorme recortada mide lo que se ve', () => {
    const fn = [OPS.clip, OPS.constructPath, OPS.transform, OPS.paintImageXObject]
    const args = [[], clipTo(100, 100, 300, 200), [683, 0, 0, 689, 117, 124], []]

    expect(findImageBoxes(fn, args, OPS)).toEqual([{ x0: 117, y0: 124, x1: 300, y1: 200 }])
  })

  it('una imagen que queda fuera del recorte no cuenta', () => {
    const fn = [OPS.clip, OPS.constructPath, OPS.transform, OPS.paintImageXObject]
    const args = [[], clipTo(0, 0, 50, 50), [100, 0, 0, 100, 200, 200], []]

    expect(findImageBoxes(fn, args, OPS)).toEqual([])
  })
})

describe('findPaintedBoxes', () => {
  const FILL = 99
  const path = (x0: number, y0: number, x1: number, y1: number, op = FILL) => [op, [[]], [x0, y0, x1, y1]]

  it('lleva la caja del trazo al espacio de la pagina y omite los que solo recortan', () => {
    const fn = [OPS.transform, OPS.constructPath, OPS.constructPath]
    const args = [[1, 0, 0, 1, 10, 20], path(0, 0, 100, 5), path(0, 0, 50, 50, OPS.endPath)]

    expect(findPaintedBoxes(fn, args, OPS)).toEqual([{ x0: 10, y0: 20, x1: 110, y1: 25 }])
  })

  it('un trazo se corta en el recorte vigente, y el recorte termina en restore', () => {
    const fn = [OPS.save, OPS.clip, OPS.constructPath, OPS.constructPath, OPS.restore, OPS.constructPath]
    const args = [[], [], path(0, 0, 100, 100, OPS.endPath), path(50, 50, 900, 60), [], path(50, 50, 900, 60)]

    expect(findPaintedBoxes(fn, args, OPS)).toEqual([
      { x0: 50, y0: 50, x1: 100, y1: 60 },
      { x0: 50, y0: 50, x1: 900, y1: 60 },
    ])
  })

  it('un recorte que tambien pinta (W f) no le recorta a la ruta siguiente equivocada', () => {
    const fn = [OPS.clip, OPS.constructPath, OPS.constructPath, OPS.constructPath]
    const args = [[], path(0, 0, 100, 100), path(0, 0, 10, 10, OPS.endPath), path(50, 50, 90, 90)]

    expect(findPaintedBoxes(fn, args, OPS)).toEqual([
      { x0: 0, y0: 0, x1: 100, y1: 100 },
      { x0: 50, y0: 50, x1: 90, y1: 90 },
    ])
  })

  it('un trazo que queda entero fuera del recorte no se pinta', () => {
    const fn = [OPS.eoClip, OPS.constructPath, OPS.constructPath]
    const args = [[], path(0, 0, 100, 100, OPS.endPath), path(200, 200, 300, 300)]

    expect(findPaintedBoxes(fn, args, OPS)).toEqual([])
  })
})

describe('boxToViewportRect', () => {
  it('pasa la caja a pixeles del canvas, con la Y hacia abajo', () => {
    // Pagina de 612x792 a escala 2: lo que arma pdf.js en viewport.transform.
    const rect = boxToViewportRect({ x0: 72, y0: 271, x1: 310, y1: 395 }, [2, 0, 0, -2, 0, 1584])
    expect(rect).toEqual({ left: 144, top: 794, width: 476, height: 248 })
  })

  it('normaliza una pagina rotada', () => {
    const rect = boxToViewportRect({ x0: 10, y0: 20, x1: 30, y1: 60 }, [0, 2, 2, 0, 0, 0])
    expect(rect).toEqual({ left: 40, top: 20, width: 80, height: 40 })
  })
})

describe('selectReflowImages', () => {
  const page = { x0: 0, y0: 0, x1: 600, y1: 800 }

  it('descarta iconos y adornos chicos', () => {
    const out = selectReflowImages([{ x0: 10, y0: 10, x1: 30, y1: 30 }], page, true)
    expect(out).toEqual([])
  })

  it('conserva una tabla ancha y baja', () => {
    const table = { x0: 72, y0: 387, x1: 523, y1: 427 }
    expect(selectReflowImages([table], page, true)).toEqual([table])
  })

  it('descarta los filetes y las franjas muy bajas aunque sean anchos', () => {
    const rule = { x0: 72, y0: 540, x1: 404, y1: 541 }
    const strip = { x0: 72, y0: 300, x1: 500, y1: 320 }
    expect(selectReflowImages([rule, strip], page, true)).toEqual([])
  })

  it('descarta el fondo de pagina completa cuando la pagina tiene texto', () => {
    const out = selectReflowImages([{ x0: 0, y0: 0, x1: 600, y1: 800 }], page, true)
    expect(out).toEqual([])
  })

  it('conserva la imagen de pagina completa si no hay texto (una lamina)', () => {
    const out = selectReflowImages([{ x0: 0, y0: 0, x1: 600, y1: 800 }], page, false)
    expect(out).toHaveLength(1)
  })

  it('recorta a la pagina, quita duplicados y ordena de arriba hacia abajo', () => {
    const low = { x0: 50, y0: 100, x1: 300, y1: 250 }
    const high = { x0: 50, y0: 500, x1: 300, y1: 900 }
    const out = selectReflowImages([low, high, { ...low }], page, true)
    expect(out).toEqual([{ x0: 50, y0: 500, x1: 300, y1: 800 }, low])
  })
})

describe('imageInsertionIndex', () => {
  it('un pie de pagina que viene antes en el PDF no corre la imagen', () => {
    // Encabezado, pie, y recien despues el cuerpo: el orden del PDF no es el visual.
    expect(imageInsertionIndex([972, 33, 890, 500], 880)).toBe(3)
  })

  it('un parrafo tardio alto en la pagina no manda la imagen al final', () => {
    expect(imageInsertionIndex([800, 700, 600, 500, 400, 300, 900], 550)).toBe(3)
  })

  it('cuenta los parrafos que empiezan por encima de la imagen', () => {
    // Tops de parrafo (Y crece hacia arriba): 700, 500, 300.
    expect(imageInsertionIndex([700, 500, 300], 600)).toBe(1)
    expect(imageInsertionIndex([700, 500, 300], 750)).toBe(0)
    expect(imageInsertionIndex([700, 500, 300], 100)).toBe(3)
  })
})

describe('extractParagraphBlocks', () => {
  function item(str: string, x: number, y: number, fontSize = 10): PdfTextItem {
    return { str, transform: [fontSize, 0, 0, fontSize, x, y], height: fontSize, width: str.length * 5 }
  }

  it('devuelve el mismo texto que extractParagraphs, con la altura de cada parrafo', () => {
    const blocks = extractParagraphBlocks([
      item('Primero', 50, 700),
      item('sigue', 50, 688),
      item('Segundo', 50, 640),
    ])
    expect(blocks.map(b => b.text)).toEqual(['Primero sigue', 'Segundo'])
    expect(blocks.map(b => b.top)).toEqual([710, 650])
  })
})
