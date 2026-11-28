import { describe, it, expect } from 'vitest'
import { extractParagraphs, findTextSample, groupIntoLines, type PdfTextItem } from '../src/lib/pdf-text.js'

/**
 * El síntoma que motivó esto: el lector tomaba cada oración como un párrafo.
 * La causa era comparar la Y contra umbrales absolutos (28 y 8) que no se
 * relacionan con el cuerpo de la tipografía del documento. Estos tests fijan
 * que el corte sea relativo al documento y no a un par de constantes.
 */

/** Arma un item de pdf.js. `y` crece hacia arriba, como en el PDF. */
function item(str: string, x: number, y: number, fontSize = 10, width?: number): PdfTextItem {
  return {
    str,
    transform: [fontSize, 0, 0, fontSize, x, y],
    height: fontSize,
    width: width ?? str.length * fontSize * 0.5,
  }
}

/** Página de N líneas del mismo párrafo, con interlineado `leading`. */
function paragraphLines(texts: string[], startY: number, leading: number, x = 50) {
  return texts.map((t, i) => item(t, x, startY - i * leading))
}

describe('groupIntoLines', () => {
  it('junta los runs de una misma línea', () => {
    const lines = groupIntoLines([
      item('Hola', 50, 700, 10, 20),
      item('mundo', 75, 700, 10, 25),
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('Hola mundo')
  })

  it('no mete espacio donde el PDF parte una palabra sin hueco', () => {
    const lines = groupIntoLines([
      item('mun', 50, 700, 10, 15),
      item('do', 65, 700, 10, 10),
    ])
    expect(lines[0].text).toBe('mundo')
  })

  it('descarta las líneas vacías', () => {
    const lines = groupIntoLines([item('Texto', 50, 700), item('   ', 50, 680)])
    expect(lines).toHaveLength(1)
  })
})

describe('extractParagraphs', () => {
  it('NO parte un párrafo con interlineado amplio', () => {
    // Esto es lo que rompía: con leading 30 el umbral viejo de 28 abría
    // párrafo en cada línea.
    const out = extractParagraphs(
      paragraphLines(['Primera línea del texto', 'segunda línea del texto', 'tercera línea del texto'], 700, 30)
    )
    expect(out).toBe('Primera línea del texto segunda línea del texto tercera línea del texto')
    expect(out).not.toContain('\n')
  })

  it('SÍ parte cuando el salto se despega de la mediana', () => {
    const out = extractParagraphs([
      ...paragraphLines(['Primera línea', 'segunda línea'], 700, 12),
      // salto de 30 contra una mediana de 12
      item('Arranca otro párrafo', 50, 658),
      item('y sigue acá', 50, 646),
    ])
    const paras = out.split('\n\n')
    expect(paras).toHaveLength(2)
    expect(paras[0]).toBe('Primera línea segunda línea')
    expect(paras[1]).toBe('Arranca otro párrafo y sigue acá')
  })

  it('con cuerpo chico también corta bien', () => {
    // El umbral viejo de 28 nunca se alcanzaba acá: todo quedaba en un bloque.
    const out = extractParagraphs([
      ...paragraphLines(['Uno', 'dos', 'tres'], 700, 6, 50).map(i => ({ ...i, height: 5 })),
      { ...item('Otro párrafo', 50, 667), height: 5 },
    ])
    expect(out.split('\n\n')).toHaveLength(2)
  })

  it('abre párrafo por sangría aunque el salto sea normal', () => {
    const out = extractParagraphs([
      item('Primera línea del párrafo', 50, 700),
      item('sigue la primera', 50, 688),
      item('Este entra con sangría', 62, 676),
    ])
    expect(out.split('\n\n')).toHaveLength(2)
  })

  it('une la palabra cortada con guion', () => {
    const out = extractParagraphs([
      item('procesa-', 50, 700),
      item('miento del texto', 50, 688),
    ])
    expect(out).toBe('procesamiento del texto')
    expect(out).not.toContain('-')
  })

  it('no se come un guion que separa dos palabras', () => {
    const out = extractParagraphs([
      item('teórico-', 50, 700),
      item('Práctico', 50, 688),
    ])
    // La siguiente arranca en mayúscula: no es una palabra partida.
    expect(out).toContain('-')
  })

  it('un salto hacia arriba abre bloque nuevo (columnas)', () => {
    const out = extractParagraphs([
      item('Fin de la columna izquierda', 50, 400),
      item('Arriba de la derecha', 300, 700),
    ])
    expect(out.split('\n\n')).toHaveLength(2)
  })

  it('una página vacía no explota', () => {
    expect(extractParagraphs([])).toBe('')
  })
})

describe('texto impreso dos veces para simular negrita', () => {
  it('une los tramos que se solapan y repiten texto', () => {
    const lines = groupIntoLines([
      item('Este', 117, 33, 11, 20),
      item('Este material', 117, 33, 11, 59),
      item('material es', 140, 33, 11, 49),
      item('es propiedad', 178, 33, 11, 58),
    ])

    expect(lines.map(line => line.text)).toEqual(['Este material es propiedad'])
  })

  it('un renglon repetido entero queda una sola vez', () => {
    const lines = groupIntoLines([
      item('COSTOS Y PRESUPUESTOS', 139, 972, 15, 189),
      item('COSTOS Y PRESUPUESTOS', 139, 972, 15, 189),
    ])

    expect(lines.map(line => line.text)).toEqual(['COSTOS Y PRESUPUESTOS'])
  })

  it('un espacio con ancho falso no se come una celda repetida ni parte palabras', () => {
    const lines = groupIntoLines([
      item('$ 3.700', 100, 500, 10, 35),
      item(' ', 135, 500, 10, 250),
      item('$ 3.700', 150, 500, 10, 35),
      item(' c', 190, 500, 10, 10),
      item('ompra', 200, 500, 10, 25),
    ])

    expect(lines[0].text).toBe('$ 3.700 $ 3.700 compra')
  })

  it('un texto impreso letra por letra no se llena de espacios', () => {
    const lines = groupIntoLines([
      item('P', 100, 500, 10, 6),
      item('Pe', 100.5, 500, 10, 11),
      item('es', 106, 500, 10, 10),
      item('so', 111, 500, 10, 10),
    ])

    expect(lines[0].text).not.toContain(' ')
  })

  it('el kerning, un solape minimo, no separa una palabra', () => {
    const lines = groupIntoLines([item('pala', 100, 500, 10, 20), item('bra', 119.5, 500, 10, 15)])

    expect(lines[0].text).toBe('palabra')
  })

  it('una palabra repetida de verdad, sin solaparse, se queda', () => {
    const lines = groupIntoLines([item('la', 100, 500, 10, 10), item('la', 115, 500, 10, 10)])

    expect(lines[0].text).toBe('la la')
  })

  it('no borra texto real porque el final y el principio coincidan: misma manera', () => {
    const lines = groupIntoLines([item('la misma', 100, 500, 10, 170), item('manera', 119, 500, 10, 60)])

    expect(lines[0].text).toBe('la misma manera')
  })

  it('no se come una celda de una tabla que se pisa: 11 y 12', () => {
    const lines = groupIntoLines([item('10 11', 100, 500, 10, 50), item('12', 146, 500, 10, 12)])

    expect(lines[0].text).toBe('10 1112')
  })

  it('dos tramos que se solapan con texto distinto se conservan', () => {
    const lines = groupIntoLines([item('ab', 100, 500, 10, 20), item('cd', 105, 500, 10, 20)])

    expect(lines[0].text).toBe('abcd')
  })
})

describe('sangria en una pagina con algo mas a la izquierda', () => {
  it('un numero de pagina al margen no parte cada renglon en un parrafo', () => {
    const items = [
      item('12', 50, 780),
      item('Otro motivo por el que se suelen', 129, 700),
      item('realizar mezclas de cafe, es para', 129, 684),
      item('que los precios no se vean afectados.', 129, 668),
    ]

    expect(extractParagraphs(items).split('\n\n')).toEqual([
      '12',
      'Otro motivo por el que se suelen realizar mezclas de cafe, es para que los precios no se vean afectados.',
    ])
  })

  it('la sangria de primera linea sigue abriendo parrafo', () => {
    const items = [
      item('Fin del parrafo anterior.', 100, 700),
      item('Empieza otro parrafo con sangria', 120, 684),
      item('y sigue en el margen de siempre.', 100, 668),
    ]

    expect(extractParagraphs(items).split('\n\n')).toEqual([
      'Fin del parrafo anterior.',
      'Empieza otro parrafo con sangria y sigue en el margen de siempre.',
    ])
  })
})

describe('renglones que no se unen aunque el salto sea normal', () => {
  const wide = (str: string, y: number, x = 100) => item(str, x, y, 10, 400)
  const body = [wide('Un renglon largo de texto corrido', 700), wide('que sigue en el renglon de abajo', 684)]

  it('cada item de una lista va aparte', () => {
    const items = [
      item('• El Circuito de Compras', 120, 668, 10, 390),
      item('• El Circuito de pagos', 120, 652, 10, 390),
      item('1. Definir los circuitos', 100, 636, 10, 400),
      item('a) Revisar los horarios', 100, 620, 10, 400),
    ]

    expect(extractParagraphs([...body, ...items]).split('\n\n')).toEqual([
      'Un renglon largo de texto corrido que sigue en el renglon de abajo',
      '• El Circuito de Compras',
      '• El Circuito de pagos',
      '1. Definir los circuitos',
      'a) Revisar los horarios',
    ])
  })

  it('un renglon de una lista que sigue abajo se une a su item', () => {
    const items = [
      item('• Un item que ocupa mas de un renglon', 120, 668, 10, 390),
      item('y sigue aca abajo', 120, 652, 10, 390),
    ]

    expect(extractParagraphs([...body, ...items]).split('\n\n')[1]).toBe(
      '• Un item que ocupa mas de un renglon y sigue aca abajo',
    )
  })

  it('despues de un renglon corto arranca otro parrafo', () => {
    const items = [
      ...body,
      wide('otro renglon largo que hace de medida', 668),
      item('UserManagement/', 100, 652, 10, 80),
      item('components/', 100, 636, 10, 60),
      item('hooks/', 100, 620, 10, 30),
    ]

    expect(extractParagraphs(items).split('\n\n').slice(1)).toEqual(['components/', 'hooks/'])
  })

  it('un listado de codigo, de ancho fijo, conserva cada linea', () => {
    const code = (str: string, y: number) => item(str, 100, y, 10, str.length * 6)
    const items = [
      code('// Modify the request before sending it to the server', 700),
      code('const token = getToken(request.user.id)', 684),
      code('request.headers.authorization = token;', 668),
      code('return request.send(token, options, retries);', 652),
    ]

    expect(extractParagraphs(items).split('\n\n')).toHaveLength(4)
  })

  it('un renglon de texto que llega al margen y termina en parentesis sigue', () => {
    const items = [
      wide('El proveedor entrega la mercaderia (ver tabla)', 700),
      wide('y el encargado la controla al recibirla en el local.', 684),
    ]

    expect(extractParagraphs(items).split('\n\n')).toHaveLength(1)
  })

  it('un renglon que llega al margen y termina en punto y coma sigue', () => {
    const items = [
      wide('Primero se revisa el peso de cada producto;', 700),
      wide('despues se controla la temperatura de la camara.', 684),
    ]

    expect(extractParagraphs(items).split('\n\n')).toHaveLength(1)
  })

  it('una llave o un comentario cortan aunque lleguen al margen', () => {
    const items = [wide('if (token) {', 700), wide('config.headers = token', 684)]

    expect(extractParagraphs(items).split('\n\n')).toHaveLength(2)
  })

  it('el texto que rodea una figura no se parte a mitad de oracion', () => {
    const narrow = (str: string, y: number) => item(str, 300, y, 10, 200)
    const items = [
      wide('El local tiene una ambientacion muy calida con sillas de', 700),
      wide('madera, mesas del mismo material y una vajilla simple que', 684),
      item('combina con las paredes de color blanco y', 300, 668, 10, 200),
      narrow('los adornos de flores secas que se ven', 652),
      narrow('sobre cada una de las mesas del salon.', 636),
      wide('Otro renglon largo para que el ancho habitual sea el de la pagina', 620),
      wide('y siga siendolo aunque un tramo rodee una imagen de la pagina.', 604),
      wide('Un renglon mas para dejar clara la medida de la pagina completa.', 588),
    ]

    const [first] = extractParagraphs(items).split('\n\n')

    expect(first).toContain('madera, mesas del mismo material y una vajilla simple que combina con las paredes')
    expect(first).toContain('de color blanco y los adornos de flores secas que se ven sobre cada una')
  })

  it('una sangria tras un punto sigue abriendo parrafo aunque empiece en minuscula', () => {
    const items = [wide('Termina una oracion aca.', 700), item('y arranca otra con sangria', 120, 684, 10, 380)]

    expect(extractParagraphs(items).split('\n\n')).toHaveLength(2)
  })

  it('codigo que llega al margen conserva sus lineas', () => {
    const items = [
      wide('seq1 := make(map[int]bool)', 700),
      wide('seq2 := make(map[int]bool)', 684),
      wide("config.headers['Authorization'] = token;", 668),
      wide('}', 652),
    ]

    expect(extractParagraphs(items).split('\n\n')).toHaveLength(4)
  })

  it('imports y comentarios conservan sus lineas aunque lleguen al margen', () => {
    const items = [
      wide("import PrivateRoute from './routes/private';", 700),
      wide("import RoleRoute from './routes/roles';", 684),
      wide('total := calcular(valores)', 668),
      wide('// suma todos los valores', 652),
      wide('resultado sigue aca', 636),
    ]

    expect(extractParagraphs(items).split('\n\n')).toHaveLength(5)
  })

  it('un numero impreso dos veces no se llena de espacios', () => {
    const lines = groupIntoLines([
      item('0', 100, 500, 10, 5),
      item('0', 100.3, 500, 10, 5),
      item(',', 105, 500, 10, 3),
      item(',2', 105.3, 500, 10, 8),
      item('25', 113, 500, 10, 10),
    ])

    expect(lines[0].text).not.toContain(' ')
  })

  it('una vineta de fuente simbolica abre un item de lista', () => {
    const items = [wide('Un renglon de texto corrido', 700), wide('\uf0b7 Primer item de la lista', 684), wide('\uf0fc Segundo item de la lista', 668)]

    expect(extractParagraphs(items).split('\n\n')).toHaveLength(3)
  })

  it('un anio que termina una oracion no es una lista', () => {
    const items = [wide('Y asi fue como llego a Venecia en', 700), wide('1475. Pronto se extendio por toda', 684)]

    expect(extractParagraphs(items).split('\n\n')).toHaveLength(1)
  })

  it('un numero que arranca un renglon sin punto no es una lista', () => {
    const items = [wide('El libro se publico en el anio', 700), wide('1887 con mucho exito y sigue', 684)]

    expect(extractParagraphs(items).split('\n\n')).toHaveLength(1)
  })
})

describe('texto rotado', () => {
  const rotated = (str: string, x: number): PdfTextItem => ({
    str,
    transform: [0, 10, -10, 0, x, 279],
    height: 10,
    width: 160,
  })

  it('cada X es un renglon: no pega el final de uno con el principio del otro', () => {
    const text = extractParagraphs([rotated('empleados de la misma', 524), rotated('manera y sin demoras', 536)])

    expect(text).toBe('empleados de la misma manera y sin demoras')
  })
})

describe('texto rotado y pies', () => {
  it('un renglon rotado al fondo no se mueve como pie', () => {
    const rotated = (str: string, x: number, y: number): PdfTextItem => ({
      str,
      transform: [0, 10, -10, 0, x, y],
      height: 10,
      width: 100,
    })
    const items = [
      item('Un renglon del cuerpo de la pagina', 100, 700),
      item('Otro renglon del cuerpo de la pagina', 100, 684),
      rotated('por lo cual se hace', 500, 40),
      item('Y sigue el cuerpo mas arriba de la hoja', 100, 668),
    ]

    const text = extractParagraphs(items)

    expect(text.indexOf('por lo cual')).toBeLessThan(text.indexOf('Y sigue'))
  })
})

describe('pie de pagina que viene antes en el PDF', () => {
  const body = (str: string, y: number) => item(str, 100, y, 10, 400)

  it('se muestra al final, no entre el encabezado y el cuerpo', () => {
    const items = [
      body('ENCABEZADO DEL LIBRO', 780),
      item('Este material es propiedad del instituto. - 7', 100, 30, 8, 400),
      body('Primer renglon del cuerpo de la pagina', 700),
      body('y segundo renglon del mismo parrafo.', 684),
      body('Tercer renglon que sigue en el mismo bloque', 668),
    ]

    const paragraphs = extractParagraphs(items).split('\n\n')

    expect(paragraphs[paragraphs.length - 1]).toBe('Este material es propiedad del instituto. - 7')
    expect(paragraphs[0]).toBe('ENCABEZADO DEL LIBRO')
  })

  it('el final de una columna no se confunde con un pie', () => {
    const left = [120, 104, 88, 72, 56, 40].map((y, i) => body(`Columna izquierda renglon ${i} con su texto largo`, y))
    const right = [700, 684, 668].map((y, i) => item(`Columna derecha renglon ${i} con su texto`, 600, y, 10, 400))

    const text = extractParagraphs([...left, ...right])

    expect(text.indexOf('Columna izquierda renglon 5')).toBeLessThan(text.indexOf('Columna derecha renglon 0'))
  })

  it('un renglon del cuerpo con otros justo arriba no es un pie', () => {
    const table = [120, 116, 112, 108, 104, 100].map((y, i) => body(`Fila ${i}`, y))
    const items = [
      ...table,
      body('Una oracion larga del cuerpo que sigue', 60),
      body('en el renglon final de la hoja.', 44),
      body('Otro bloque mas arriba de la pagina', 700),
    ]

    const text = extractParagraphs(items)

    expect(text.indexOf('renglon final')).toBeLessThan(text.indexOf('Otro bloque'))
  })

  it('un pie que ya viene al final queda donde esta', () => {
    const items = [body('Un renglon del cuerpo', 700), body('Otro renglon del cuerpo', 684), body('Pie - 7', 30)]

    expect(extractParagraphs(items).split('\n\n').pop()).toBe('Pie - 7')
  })
})

describe('findTextSample', () => {
  const pages: Record<number, string> = { 1: '', 2: '  ', 3: 'Un texto suficiente para detectar el idioma', 4: 'otro' }
  const read = async (page: number) => pages[page] ?? ''

  it('usa la pagina actual si tiene texto', async () => {
    expect(await findTextSample(read, 3, 10)).toBe(pages[3])
  })

  it('una pagina sin texto busca en las siguientes', async () => {
    expect(await findTextSample(read, 1, 10)).toBe(pages[3])
  })

  it('no busca mas alla del final del libro', async () => {
    expect(await findTextSample(read, 1, 2)).toBe('')
  })

  it('se rinde despues de unas paginas', async () => {
    const seen: number[] = []
    const empty = async (page: number) => {
      seen.push(page)
      return ''
    }

    expect(await findTextSample(empty, 1, 500)).toBe('')
    expect(seen.length).toBeLessThanOrEqual(10)
  })
})
