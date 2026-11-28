import { describe, expect, it } from 'vitest'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { boxToViewportRect, findImageBoxes, findPaintedBoxes, planPageReflow } from '../src/lib/pdf-images.js'
import type { PdfTextItem } from '../src/lib/pdf-text.js'

const page = { x0: 0, y0: 0, x1: 600, y1: 800 }

const item = (str: string, x: number, y: number): PdfTextItem => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width: str.length * 5,
  height: 10,
})

const prose = 'Un renglon largo de texto corrido que se tiene que seguir leyendo'

describe('planPageReflow', () => {
  it('una foto con un rotulo se queda y el rotulo sale del texto', () => {
    const photo = { x0: 72, y0: 300, x1: 400, y1: 600 }
    const items = [item('Rotulo', 100, 400), item(prose, 72, 200)]

    const plan = planPageReflow({ imageBoxes: [photo], paintedBoxes: [], items, page })

    expect(plan.figures).toEqual([photo])
    expect(plan.items.map(i => i.str)).toEqual([prose])
  })

  it('un renglon que la figura cortaria se queda en el texto', () => {
    const photo = { x0: 72, y0: 300, x1: 400, y1: 600 }
    const crossing = item(prose, 200, 400)

    const plan = planPageReflow({ imageBoxes: [photo], paintedBoxes: [], items: [crossing], page })

    expect(plan.figures).toEqual([photo])
    expect(plan.items).toEqual([crossing])
  })

  it('un renglon largo apenas cortado tambien se queda en el texto', () => {
    const photo = { x0: 101, y0: 300, x1: 528, y1: 600 }
    const long = { ...item(prose, 70, 400), width: 471 }

    const plan = planPageReflow({ imageBoxes: [photo], paintedBoxes: [], items: [long], page })

    expect(plan.items).toEqual([long])
  })

  it('un rotulo que roza el borde de la figura sale del texto', () => {
    const photo = { x0: 72, y0: 300, x1: 400, y1: 600 }
    const label = item('Rotulo', 372, 400)

    const plan = planPageReflow({ imageBoxes: [photo], paintedBoxes: [], items: [label], page })

    expect(plan.items).toEqual([])
  })

  it('una imagen de fondo con texto encima se descarta y el texto queda', () => {
    const panel = { x0: 72, y0: 300, x1: 400, y1: 400 }
    const items = [320, 340, 360, 380].map(y => item(prose, 72, y))

    const plan = planPageReflow({ imageBoxes: [panel], paintedBoxes: [], items, page })

    expect(plan.figures).toEqual([])
    expect(plan.items).toEqual(items)
  })

  it('una marca de agua grande no se lleva el texto de la pagina', () => {
    const watermark = { x0: 60, y0: 60, x1: 540, y1: 700 }
    const items = [120, 300, 500, 650].map(y => item(prose, 72, y))

    const plan = planPageReflow({ imageBoxes: [watermark], paintedBoxes: [], items, page })

    expect(plan.figures).toEqual([])
    expect(plan.items).toEqual(items)
  })

  it('una tabla pasa a ser figura, sin su texto y con la imagen que tenia adentro', () => {
    const icon = { x0: 150, y0: 660, x1: 230, y1: 700 }
    const items = [
      ...[700, 680, 660].flatMap(y => [item('Fila', 72, y), item('12', 300, y), item('ok', 420, y)]),
      item(prose, 72, 500),
    ]

    const plan = planPageReflow({ imageBoxes: [icon], paintedBoxes: [], items, page })

    expect(plan.figures).toHaveLength(1)
    expect(plan.figures[0]).toMatchObject({ x0: 72, y0: 657.5, y1: 710 })
    expect(plan.items.map(i => i.str)).toEqual([prose])
  })

  it('la tabla crece hasta sus bordes y su titulo pintado adentro', () => {
    const items = [
      item('TITULO', 200, 725),
      ...[700, 680, 660].flatMap(y => [item('Fila', 72, y), item('12', 300, y), item('ok', 420, y)]),
    ]
    const frame = { x0: 60, y0: 650, x1: 450, y1: 740 }

    const plan = planPageReflow({ imageBoxes: [], paintedBoxes: [frame], items, page })

    expect(plan.figures).toEqual([frame])
    expect(plan.items).toEqual([])
  })

  it('un rectangulo que ocupa media pagina no agranda la tabla', () => {
    const items = [700, 680, 660].flatMap(y => [item('Fila', 72, y), item('12', 300, y), item('ok', 420, y)])
    const backdrop = { x0: 0, y0: 200, x1: 600, y1: 790 }

    const plan = planPageReflow({ imageBoxes: [], paintedBoxes: [backdrop], items, page })

    expect(plan.figures[0].x0).toBe(72)
  })

  it('un rectangulo que se pasa mucho de la tabla no la agranda', () => {
    const items = [700, 680, 660].flatMap(y => [item('Fila', 72, y), item('12', 300, y), item('ok', 420, y)])
    const band = { x0: 72, y0: 650, x1: 590, y1: 690 }

    const plan = planPageReflow({ imageBoxes: [], paintedBoxes: [band], items, page })

    expect(plan.figures[0].x1).toBe(430)
  })

  it('dos figuras que se encadenan terminan en una sola', () => {
    const table = (y: number) => [item('Fila', 72, y), item('12', 300, y), item('ok', 420, y)]
    const items = [...[700, 680, 660].flatMap(table), ...[600, 580, 560].flatMap(table)]
    const bridge = [
      ...[655, 625, 595].map(y => ({ x0: 72, y0: y, x1: 430, y1: y + 1 })),
      ...[72, 250, 430].map(x => ({ x0: x, y0: 595, x1: x + 1, y1: 656 })),
    ]

    const plan = planPageReflow({ imageBoxes: [], paintedBoxes: bridge, items, page })

    expect(plan.figures).toHaveLength(1)
  })

  it('un grafico incluye los rotulos numericos de sus ejes', () => {
    const plot = { x0: 72, y0: 300, x1: 400, y1: 500 }
    const axis = ['0', '50', '100', '150'].map((n, i) => item(n, 50, 310 + i * 50))
    const ticks = ['1', '2', '3'].map((n, i) => item(n, 100 + i * 100, 285))

    const plan = planPageReflow({ imageBoxes: [plot], paintedBoxes: [], items: [...axis, ...ticks, item(prose, 72, 100)], page })

    expect(plan.figures).toEqual([{ x0: 50, y0: 285, x1: 400, y1: 500 }])
    expect(plan.items.map(i => i.str)).toEqual([prose])
  })

  it('el titulo vertical de un eje, letras apiladas, entra en el grafico', () => {
    const plot = { x0: 72, y0: 300, x1: 400, y1: 500 }
    const axis = ['0', '50', '100', '150'].map((n, i) => item(n, 50, 310 + i * 50))
    const title = ['C', 'o', 's', 'to', 's'].map((l, i) => item(l, 35, 440 - i * 12))

    const plan = planPageReflow({ imageBoxes: [plot], paintedBoxes: [], items: [...axis, ...title], page })

    expect(plan.figures[0].x0).toBe(35)
    expect(plan.items).toEqual([])
  })

  it('un numero suelto cerca de una foto no agranda el recorte', () => {
    const photo = { x0: 72, y0: 300, x1: 400, y1: 500 }
    const pageNumber = item('7', 200, 285)

    const plan = planPageReflow({ imageBoxes: [photo], paintedBoxes: [], items: [pageNumber], page })

    expect(plan.figures).toEqual([photo])
    expect(plan.items).toEqual([pageNumber])
  })

  it('un rotulo lejos del grafico no lo agranda', () => {
    const plot = { x0: 72, y0: 300, x1: 400, y1: 500 }
    const far = ['1', '2', '3'].map((n, i) => item(n, 100 + i * 100, 100))

    const plan = planPageReflow({ imageBoxes: [plot], paintedBoxes: [], items: far, page })

    expect(plan.figures).toEqual([plot])
  })

  it('dos imagenes casi encimadas salen en un solo recorte', () => {
    const a = { x0: 72, y0: 300, x1: 300, y1: 500 }
    const b = { x0: 100, y0: 320, x1: 320, y1: 520 }

    const plan = planPageReflow({ imageBoxes: [a, b], paintedBoxes: [], items: [], page })

    expect(plan.figures).toEqual([{ x0: 72, y0: 300, x1: 320, y1: 520 }])
  })

  it('dos figuras que apenas se tocan no se funden en un recorte enorme', () => {
    const a = { x0: 72, y0: 500, x1: 300, y1: 700 }
    const b = { x0: 290, y0: 100, x1: 520, y1: 510 }

    const plan = planPageReflow({ imageBoxes: [a, b], paintedBoxes: [], items: [item(prose, 72, 300)], page })

    expect(plan.figures).toEqual([a, b])
    expect(plan.items.map(i => i.str)).toEqual([prose])
  })

  it('palabras cortas cerca de una foto no son rotulos de un eje', () => {
    const photo = { x0: 72, y0: 300, x1: 400, y1: 500 }
    const words = ['En', 'la', 'es', 'el'].map((w, i) => item(w, 100 + i * 60, 285))

    const plan = planPageReflow({ imageBoxes: [photo], paintedBoxes: [], items: words, page })

    expect(plan.figures).toEqual([photo])
    expect(plan.items).toEqual(words)
  })

  it('cada figura lleva como texto alternativo lo que tiene adentro', () => {
    const items = [700, 680, 660].flatMap(y => [item('Fila', 72, y), item('12', 300, y), item('ok', 420, y)])

    const plan = planPageReflow({ imageBoxes: [], paintedBoxes: [], items, page })

    expect(plan.altTexts).toEqual(['Fila 12 ok Fila 12 ok Fila 12 ok'])
  })

  it('el texto alternativo conserva las celdas repetidas y saca las copias exactas', () => {
    const cell = (x: number) => ({ ...item('$0', x, 700), width: 30 })
    const rows = [680, 660].flatMap(y => [item('Fila', 72, y), item('12', 300, y), item('ok', 420, y)])
    const items = [item('Fila', 72, 700), cell(300), cell(315), item('ok', 420, 700), item('ok', 420, 700), ...rows]

    const plan = planPageReflow({ imageBoxes: [], paintedBoxes: [], items, page })

    expect(plan.altTexts[0]).toBe('Fila $0 $0 ok Fila 12 ok Fila 12 ok')
  })

  it('una grilla con pocas filas es una tabla aunque el texto no alcance', () => {
    const lines = [
      ...[600, 580, 560].map(y => ({ x0: 72, y0: y, x1: 500, y1: y + 1 })),
      ...[72, 280, 500].map(x => ({ x0: x, y0: 560, x1: x + 1, y1: 601 })),
    ]
    const items = [item('Fecha', 80, 585), item('Monto', 300, 585), item(prose, 72, 400)]

    const plan = planPageReflow({ imageBoxes: [], paintedBoxes: lines, items, page })

    expect(plan.figures).toEqual([{ x0: 72, y0: 560, x1: 501, y1: 601 }])
    expect(plan.items.map(i => i.str)).toEqual([prose])
  })

  it('un marco alrededor de un texto corrido no es una tabla', () => {
    const lines = [
      ...[300, 500, 700].map(y => ({ x0: 60, y0: y, x1: 540, y1: y + 1 })),
      ...[60, 300, 540].map(x => ({ x0: x, y0: 300, x1: x + 1, y1: 701 })),
    ]
    const items = [650, 600, 550].map(y => item(prose, 72, y))

    const plan = planPageReflow({ imageBoxes: [], paintedBoxes: lines, items, page })

    expect(plan.figures).toEqual([])
    expect(plan.items).toEqual(items)
  })

  it('lineas sueltas sin texto adentro no son una tabla', () => {
    const lines = [
      ...[600, 580, 560].map(y => ({ x0: 72, y0: y, x1: 500, y1: y + 1 })),
      ...[72, 280, 500].map(x => ({ x0: x, y0: 560, x1: x + 1, y1: 601 })),
    ]

    expect(planPageReflow({ imageBoxes: [], paintedBoxes: lines, items: [], page }).figures).toEqual([])
  })

  it('devuelve las figuras de arriba hacia abajo', () => {
    const low = { x0: 72, y0: 100, x1: 300, y1: 200 }
    const high = { x0: 72, y0: 500, x1: 300, y1: 600 }

    const plan = planPageReflow({ imageBoxes: [low, high], paintedBoxes: [], items: [], page })

    expect(plan.figures).toEqual([high, low])
  })

  it('una pagina sin imagenes ni tablas conserva todo su texto', () => {
    const items = [item(prose, 72, 700), item(prose, 72, 680)]

    const plan = planPageReflow({ imageBoxes: [], paintedBoxes: [], items, page })

    expect(plan.figures).toEqual([])
    expect(plan.items).toEqual(items)
  })
})

/**
 * El modo texto ya se rompio una vez por usar un metodo que pdf.js saco, sin que
 * ningun test lo notara. Esto corre el pdf.js de verdad sobre un PDF armado en
 * memoria: si una actualizacion cambia lo que usamos, falla aca.
 */
describe('contra el pdf.js real', () => {
  const PNG_1X1 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

  async function openPage() {
    const doc = await PDFDocument.create()
    const pdfPage = doc.addPage([612, 792])
    const image = await doc.embedPng(Buffer.from(PNG_1X1, 'base64'))
    pdfPage.drawImage(image, { x: 72, y: 400, width: 200, height: 100 })
    pdfPage.drawRectangle({ x: 72, y: 200, width: 300, height: 50, color: rgb(0.8, 0.8, 0.8) })
    pdfPage.drawText('Hola', { x: 72, y: 100, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) })
    const data = await doc.save()

    const task = (pdfjs as any).getDocument({ data, verbosity: 0, disableFontFace: true })
    return (await task.promise).getPage(1)
  }

  it('encuentra la caja de una imagen y la de un rectangulo pintado', async () => {
    const pdfPage = await openPage()
    const ops = await pdfPage.getOperatorList()

    const round = (b: { x0: number; y0: number; x1: number; y1: number }) =>
      [b.x0, b.y0, b.x1, b.y1].map(Math.round)

    expect(findImageBoxes(ops.fnArray, ops.argsArray, (pdfjs as any).OPS).map(round)).toEqual([[72, 400, 272, 500]])
    expect(findPaintedBoxes(ops.fnArray, ops.argsArray, (pdfjs as any).OPS).map(round)).toContainEqual([72, 200, 372, 250])
  })

  it('aplica la matriz de un form XObject, como una planilla pegada', async () => {
    const source = await PDFDocument.create()
    const sourcePage = source.addPage([400, 400])
    sourcePage.drawRectangle({ x: 100, y: 100, width: 200, height: 40, color: rgb(0.8, 0.8, 0.8) })
    const doc = await PDFDocument.create()
    const form = await doc.embedPage(sourcePage, undefined, [0.5, 0, 0, 0.5, 0, 0])
    doc.addPage([612, 792]).drawPage(form, { x: 50, y: 300 })
    const data = await doc.save()

    const task = (pdfjs as any).getDocument({ data, verbosity: 0, disableFontFace: true })
    const pdfPage = await (await task.promise).getPage(1)
    const ops = await pdfPage.getOperatorList()
    const boxes = findPaintedBoxes(ops.fnArray, ops.argsArray, (pdfjs as any).OPS)

    expect(boxes.map(b => [b.x0, b.y0, b.x1, b.y1].map(Math.round))).toContainEqual([100, 350, 200, 370])
  })

  it('el viewport expone la matriz con la que se recorta', async () => {
    const pdfPage = await openPage()
    const viewport = pdfPage.getViewport({ scale: 2 })

    const rect = boxToViewportRect({ x0: 72, y0: 400, x1: 272, y1: 500 }, viewport.transform)

    expect(rect).toEqual({ left: 144, top: 584, width: 400, height: 200 })
  })

  it('el texto llega con la forma que espera la deteccion', async () => {
    const pdfPage = await openPage()
    const { items } = await pdfPage.getTextContent()
    const hola = items.find((i: any) => i.str === 'Hola') as any

    expect(hola.transform[4]).toBeCloseTo(72)
    expect(hola.transform[5]).toBeCloseTo(100)
    expect(hola.width).toBeGreaterThan(0)
  })
})
