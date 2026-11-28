import { describe, expect, it } from 'vitest'
import { findTableBoxes } from '../src/lib/pdf-tables.js'
import type { PdfTextItem } from '../src/lib/pdf-text.js'

/** Un item a cuerpo 10, con unos 5 puntos de ancho por caracter. */
const item = (str: string, x: number, y: number): PdfTextItem => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width: str.length * 5,
  height: 10,
})

const row = (y: number, ...cells: [string, number][]) => cells.map(([str, x]) => item(str, x, y))

describe('findTableBoxes', () => {
  it('encuentra una tabla sin lineas por sus columnas alineadas', () => {
    const items = [
      ...row(700, ['Ventas fiscal', 72], ['$ 2.100', 300], ['100%', 450]),
      ...row(680, ['Debito', 72], ['$ 850', 300], ['40%', 450]),
      ...row(660, ['Efectivo', 72], ['$ 132', 300], ['6%', 450]),
    ]

    const [table, ...rest] = findTableBoxes(items)

    expect(rest).toEqual([])
    expect(table.x0).toBe(72)
    expect(table.x1).toBe(470)
    expect(table.y0).toBe(657.5) // la linea de base, menos los descendentes
    expect(table.y1).toBe(710)
  })

  it('reconoce columnas alineadas a la derecha', () => {
    const items = [
      ...row(700, ['Harina', 72], ['1.000', 275], ['ok', 420]),
      ...row(680, ['Sal', 72], ['20', 290], ['ok', 420]),
      ...row(660, ['Aceite', 72], ['250', 285], ['ok', 420]),
    ]

    expect(findTableBoxes(items)).toHaveLength(1)
  })

  it('no necesita que las filas vengan en orden de lectura', () => {
    const items = [
      item('A', 72, 660), item('B', 72, 680), item('C', 72, 700),
      item('1', 300, 700), item('2', 300, 680), item('3', 300, 660),
      item('x', 420, 700), item('y', 420, 680), item('z', 420, 660),
    ]

    expect(findTableBoxes(items)).toHaveLength(1)
  })

  it('una fila de una sola celda en el medio no corta la tabla', () => {
    const items = [
      ...row(700, ['Lunes', 72], ['10', 300], ['ok', 420]),
      ...row(680, ['Martes', 72], ['20', 300], ['ok', 420]),
      ...row(660, ['Subtitulo', 72]),
      ...row(640, ['Jueves', 72], ['30', 300], ['ok', 420]),
    ]

    const tables = findTableBoxes(items)

    expect(tables).toHaveLength(1)
    expect(tables[0].y0).toBe(637.5)
  })

  it('dos filas alineadas no alcanzan para ser una tabla', () => {
    const items = [
      ...row(700, ['Autor', 72], ['Pedro', 300], ['ok', 420]),
      ...row(680, ['Editor', 72], ['Maria', 300], ['ok', 420]),
    ]

    expect(findTableBoxes(items)).toEqual([])
  })

  it('un texto corrido no es una tabla', () => {
    const line = 'Palabras de un parrafo corrido que ocupan todo el renglon'
    const items = [item(line, 72, 700), item(line, 72, 680), item(line, 72, 660), item(line, 72, 640)]

    expect(findTableBoxes(items)).toEqual([])
  })

  it('dos columnas de texto corrido no son una tabla', () => {
    const left = 'Texto de la columna izquierda que sigue largo'
    const right = 'Texto de la columna derecha que tambien sigue'
    const items = [700, 680, 660, 640].flatMap(y => row(y, [left, 72], [right, 330]))

    expect(findTableBoxes(items)).toEqual([])
  })

  it('el texto justificado con huecos chicos no se parte en celdas', () => {
    const items = [700, 680, 660].flatMap(y => row(y, ['uno', 72], ['dos', 95], ['tres', 118]))

    expect(findTableBoxes(items)).toEqual([])
  })

  it('separa dos tablas cuando entre ellas hay un parrafo', () => {
    const para = 'Un parrafo largo que separa las dos tablas de esta pagina entera'
    const items = [
      ...[700, 680, 660].flatMap(y => row(y, ['Fila', 72], ['1', 300], ['ok', 420])),
      item(para, 72, 620), item(para, 72, 600), item(para, 72, 580),
      ...[540, 520, 500].flatMap(y => row(y, ['Fila', 72], ['2', 300], ['ok', 420])),
    ]

    expect(findTableBoxes(items)).toHaveLength(2)
  })

  it('una lista con el marcador separado no es una tabla', () => {
    const markers = ['a)', 'b)', 'c)', 'd)']
    const items = markers.flatMap((marker, i) => row(700 - i * 20, [marker, 72], ['Lavado de loza', 100]))

    expect(findTableBoxes(items)).toEqual([])
  })

  it('una lista numerada con vinetas no es una tabla', () => {
    const items = ['1.', '2.', '3.', '•'].flatMap((marker, i) => row(700 - i * 20, [marker, 72], ['Mesadas', 100]))

    expect(findTableBoxes(items)).toEqual([])
  })

  it('dos columnas sin lineas no alcanzan: nombre y valor se leen bien como renglones', () => {
    const items = [
      ...row(700, ['Harina', 72], ['1.000', 300]),
      ...row(680, ['Sal', 72], ['20', 300]),
      ...row(660, ['Aceite', 72], ['250', 300]),
      ...row(640, ['Agua', 72], ['90', 300]),
    ]

    expect(findTableBoxes(items)).toEqual([])
  })

  it('un indice con el capitulo en numero suelto no es una tabla', () => {
    const titles = ['Responsabilidades', 'Cantidad de ventas', 'Costo y beneficio', 'El sumiller', 'Uniformes']
    const items = titles.flatMap((title, i) =>
      row(700 - i * 20, [String(i + 1), 72], [title, 110], [String(15 + i * 10), 500]),
    )

    expect(findTableBoxes(items)).toEqual([])
  })

  it('un indice con el capitulo en romanos no es una tabla', () => {
    const romans = ['I', 'II', 'III', 'IV', 'V']
    const items = romans.flatMap((roman, i) =>
      row(700 - i * 20, [roman, 72], ['Responsabilidades', 110], [String(15 + i * 10), 500]),
    )

    expect(findTableBoxes(items)).toEqual([])
  })

  it('tres columnas angostas de texto corrido no son una tabla', () => {
    const line = 'de un texto que corre angosto'
    const items = [700, 680, 660, 640].flatMap(y => row(y, [line, 72], [line, 250], [line, 430]))

    expect(findTableBoxes(items)).toEqual([])
  })

  it('un indice con la seccion numerada tampoco es una tabla', () => {
    const numbers = ['1.1.', '1.2.', '4.5.', '8.6.', '8.6.1.']
    const items = numbers.flatMap((number, i) =>
      row(700 - i * 20, [number, 72], ['Responsabilidades', 110], [String(15 + i * 10), 500]),
    )

    expect(findTableBoxes(items)).toEqual([])
  })

  it('una tabla con numeros desordenados sigue siendo tabla', () => {
    const items = [
      ...row(700, ['Harina', 72], ['1.000', 300], ['ok', 420]),
      ...row(680, ['Sal', 72], ['20', 300], ['ok', 420]),
      ...row(660, ['Aceite', 72], ['250', 300], ['ok', 420]),
    ]

    expect(findTableBoxes(items)).toHaveLength(1)
  })

  it('ignora el texto rotado', () => {
    const rotated = (y: number): PdfTextItem => ({ str: 'margen', transform: [0, 10, -10, 0, 500, y], width: 30, height: 10 })
    const items = [
      ...[700, 680, 660].map(y => item('Solo texto', 72, y)),
      rotated(700), rotated(680), rotated(660),
    ]

    expect(findTableBoxes(items)).toEqual([])
  })
})
