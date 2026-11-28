// The plain-text sync engine (ported from forge with its tests): local typing
// reaches the document as minimal replacements, remote edits come back into
// the user's text without rewriting how they wrote it, and nothing is lost.
import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from '@milkdown/kit/prose/model'
import { Transform } from '@milkdown/kit/prose/transform'
import { structuralRange as rangoEstructural, localChangeSpans as tramosCambioLocal } from '../dist/plain-text/structural-diff.js'
import { rebaseRemote } from '../dist/plain-text/line-rebase.js'
import { createPlainTextSync } from '../dist/plain-text/sync.js'


// The test below keeps forge's original shapes (desde/hasta/insertar, ...):
// these adapters translate to the package's English API.
const rebaseRemoteEs = (base, user, remote) => rebaseRemote(base, user, remote).map((c) => ({ desde: c.from, hasta: c.to, insertar: c.insert }))
function crearSincronizador({ puente, buffer, demoraMs, temporizador, alFallar }) {
  const sync = createPlainTextSync({
    bridge: {
      getDoc: () => puente.documento(),
      parse: (md) => puente.parsear(md),
      serialize: (doc) => puente.serializar(doc),
      replace: (list) => puente.reemplazar(list.map((r) => ({ desde: r.from, hasta: r.to, slice: r.slice }))),
      onDocChange: (listener) => puente.alCambiarDocumento(listener),
    },
    buffer: {
      getText: () => buffer.texto(),
      applyRemote: (changes) => buffer.aplicarRemoto(changes.map((c) => ({ desde: c.from, hasta: c.to, insertar: c.insert }))),
    },
    delayMs: demoraMs,
    timer: { set: temporizador.poner, clear: temporizador.quitar },
    onError: alFallar,
  })
  return { cambioLocal: () => sync.localChange(), vaciar: () => sync.flush(), destruir: () => sync.destroy() }
}
const rangoEs = (a, b) => {
  const r = rangoEstructural(a, b)
  return r && { desde: r.from, hastaA: r.toA, hastaB: r.toB }
}

// Un markdown de juguete con lo que importa para el algoritmo: un serializador
// que escribe distinto de lo que se tipeó (`*` -> `-`, `*` suelto -> `\*`),
// un attr que cambia con el texto (`id` del título) y una marca.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    // Como en Milkdown, una lista es UN bloque con los ítems adentro.
    list: { group: 'block', content: 'item+' },
    item: { content: 'inline*' },
    heading: { group: 'block', content: 'inline*', attrs: { id: { default: '' } } },
    text: { group: 'inline' },
  },
  marks: { strong: {} },
})

function parseInline(texto) {
  const nodos = []
  let plano = ''
  const cerrarPlano = () => {
    if (plano) nodos.push(schema.text(plano))
    plano = ''
  }
  for (let i = 0; i < texto.length; ) {
    if (texto.startsWith('\\*', i)) {
      plano += '*'
      i += 2
      continue
    }
    if (texto.startsWith('**', i)) {
      const fin = texto.indexOf('**', i + 2)
      if (fin > i + 2) {
        cerrarPlano()
        nodos.push(schema.text(texto.slice(i + 2, fin), [schema.marks.strong.create()]))
        i = fin + 2
        continue
      }
    }
    plano += texto[i]
    i++
  }
  cerrarPlano()
  return nodos
}

function parsear(markdown) {
  const lineas = markdown.replace(/\n$/, '').split('\n')
  const bloques = []
  let items = []
  const cerrarLista = () => {
    if (items.length) bloques.push(schema.nodes.list.create(null, items))
    items = []
  }
  for (const linea of lineas) {
    let m
    if ((m = /^[-*] (.*)$/.exec(linea))) {
      items.push(schema.nodes.item.create(null, parseInline(m[1])))
      continue
    }
    cerrarLista()
    if ((m = /^# (.*)$/.exec(linea))) bloques.push(schema.nodes.heading.create({ id: m[1].toLowerCase() }, parseInline(m[1])))
    else bloques.push(schema.nodes.paragraph.create(null, parseInline(linea)))
  }
  cerrarLista()
  return schema.nodes.doc.create(null, bloques)
}

function serializar(doc) {
  const lineas = []
  const inline = (bloque) => {
    let salida = ''
    bloque.forEach((n) => {
      const texto = n.text.replace(/\*/g, '\\*')
      salida += n.marks.length ? `**${texto}**` : texto
    })
    return salida
  }
  doc.forEach((bloque) => {
    if (bloque.type.name === 'heading') lineas.push(`# ${inline(bloque)}`)
    else if (bloque.type.name === 'list') bloque.forEach((item) => lineas.push(`- ${inline(item)}`))
    else lineas.push(inline(bloque))
  })
  return `${lineas.join('\n')}\n`
}

function aplicarCambios(texto, cambios, cursor) {
  for (const c of [...cambios].sort((x, y) => y.desde - x.desde)) {
    texto = texto.slice(0, c.desde) + c.insertar + texto.slice(c.hasta)
    if (cursor > c.desde) cursor = cursor >= c.hasta ? cursor + c.insertar.length - (c.hasta - c.desde) : c.desde + c.insertar.length
  }
  return { texto, cursor }
}

// El documento "vivo" y el texto del usuario, como los ven el editor visual
// ligado a Yjs y CodeMirror.
function escenario(markdownInicial, { textoInicial } = {}) {
  let vivo = parsear(markdownInicial)
  const escuchas = new Set()
  const reemplazos = []
  let fallarReemplazo = false
  const puente = {
    documento: () => vivo,
    parsear,
    serializar,
    reemplazar(lista) {
      if (fallarReemplazo) throw new Error('no entra')
      const tr = new Transform(vivo)
      for (const r of lista) {
        reemplazos.push(r)
        tr.replace(r.desde, r.hasta, r.slice)
      }
      vivo = tr.doc
    },
    alCambiarDocumento(escucha) {
      escuchas.add(escucha)
      return () => escuchas.delete(escucha)
    },
  }
  const estado = { texto: textoInicial ?? serializar(vivo), cursor: 0 }
  const buffer = {
    texto: () => estado.texto,
    aplicarRemoto(cambios) {
      Object.assign(estado, aplicarCambios(estado.texto, cambios, estado.cursor))
    },
  }
  const errores = []
  const sync = crearSincronizador({
    puente,
    buffer,
    demoraMs: 1_000_000,
    temporizador: { poner: () => 1, quitar: () => {} },
    alFallar: (e) => errores.push(e),
  })
  return {
    sync,
    estado,
    reemplazos,
    errores,
    vivo: () => vivo,
    fallar: () => {
      fallarReemplazo = true
    },
    // El usuario escribe: reemplaza `buscar` por `poner` en su texto.
    tipear(buscar, poner) {
      const i = estado.texto.indexOf(buscar)
      assert.notEqual(i, -1, `no está "${buscar}" en ${JSON.stringify(estado.texto)}`)
      estado.texto = estado.texto.slice(0, i) + poner + estado.texto.slice(i + buscar.length)
      estado.cursor = i + poner.length
      sync.cambioLocal()
    },
    // Otro cliente edita el documento: el mismo markdown, con otro texto.
    remoto(editar) {
      const antes = vivo
      vivo = editar(vivo)
      for (const escucha of escuchas) escucha(antes, vivo)
    },
  }
}

function insertarTextoEn(doc, buscar, poner) {
  let pos = null
  doc.descendants((n, p) => {
    if (pos === null && n.isText && n.text.includes(buscar)) pos = p + n.text.indexOf(buscar) + buscar.length
  })
  assert.notEqual(pos, null)
  return new Transform(doc).insert(pos, schema.text(poner)).doc
}

test('rebaseRemote applies the remote change and keeps how the user wrote the rest', () => {
  const base = '- uno\n- dos\nhola\n'
  const usuario = '* uno\n* dos\nhola\n'
  const remoto = '- uno\n- dos\nhola mundo\n'
  const r = aplicarCambios(usuario, rebaseRemoteEs(base, usuario, remoto), 0)
  assert.equal(r.texto, '* uno\n* dos\nhola mundo\n')
})

test('rebaseRemote normalizes only the line the remote touched', () => {
  const base = '- uno\n- dos\n'
  const usuario = '* uno\n* dos\n'
  const remoto = '- uno\n- dos!\n'
  const r = aplicarCambios(usuario, rebaseRemoteEs(base, usuario, remoto), 0)
  assert.equal(r.texto, '* uno\n- dos!\n')
})

test('rebaseRemote keeps a text without final newline when lines are added and removed', () => {
  assert.equal(aplicarCambios('a\nb', rebaseRemoteEs('a\nb\n', 'a\nb', 'a\nb\nc\n'), 0).texto, 'a\nb\nc')
  assert.equal(aplicarCambios('a\nb', rebaseRemoteEs('a\nb\n', 'a\nb', 'a\n'), 0).texto, 'a')
  assert.equal(aplicarCambios('a\nb', rebaseRemoteEs('a\nb\n', 'a\nb', 'x\na\nb\n'), 0).texto, 'x\na\nb')
})

test('rebaseRemote does nothing when the remote did not change the text', () => {
  assert.equal(rebaseRemoteEs('a\n', '* a', 'a\n').length, 0)
})

test('the structural diff ignores attrs and marks; the local diff falls back to the full comparison when only a mark changed', () => {
  const a = parsear('# Hola\nresto\n')
  const b = parsear('# Hola!\nresto\n')
  // El id del título cambió, pero el rango es sólo la letra nueva.
  assert.deepEqual({ ...rangoEs(a, b) }, { desde: 5, hastaA: 5, hastaB: 6 })
  const conMarca = parsear('**resto**\n')
  const sinMarca = parsear('resto\n')
  assert.equal(rangoEstructural(sinMarca, conMarca), null)
  assert.equal(tramosCambioLocal(sinMarca, conMarca).length, 1)
})

test('typing in plain text reaches the document as a minimal replacement', () => {
  const e = escenario('# Notas\nprimer párrafo\nsegundo\n')
  e.tipear('primer', 'el primer')
  e.sync.vaciar()
  assert.equal(serializar(e.vivo()), '# Notas\nel primer párrafo\nsegundo\n')
  assert.equal(e.reemplazos.length, 1)
  const { desde, hasta, slice } = e.reemplazos[0]
  assert.equal(hasta - desde, 0)
  assert.equal(slice.content.textBetween(0, slice.content.size), 'el ')
})

test('a remote change during pending typing: both land and the text keeps the "*" the user typed', () => {
  const e = escenario('- item\nuno\ndos\n', { textoInicial: '* item\nuno\ndos\n' })
  e.tipear('dos', 'dos y tres')
  e.remoto((doc) => insertarTextoEn(doc, 'uno', ' remoto'))
  // Con tipeo pendiente el remoto no toca el texto todavía.
  assert.equal(e.estado.texto, '* item\nuno\ndos y tres\n')
  e.sync.vaciar()
  assert.equal(serializar(e.vivo()), '- item\nuno remoto\ndos y tres\n')
  assert.equal(e.estado.texto, '* item\nuno remoto\ndos y tres\n')
})

test('two people in the same paragraph: both edits are kept', () => {
  const e = escenario('hola mundo\n')
  e.tipear('mundo', 'mundo cruel')
  e.remoto((doc) => new Transform(doc).insert(1, schema.text('ay, ')).doc)
  e.sync.vaciar()
  assert.equal(serializar(e.vivo()), 'ay, hola mundo cruel\n')
  assert.equal(e.estado.texto, 'ay, hola mundo cruel\n')
})

test('two separate local edits do not erase what someone else wrote between them', () => {
  const e = escenario('uno\ndos\ntres\n')
  e.tipear('uno', 'uno A')
  e.tipear('tres', 'tres B')
  e.remoto((doc) => insertarTextoEn(doc, 'dos', ' remoto'))
  e.sync.vaciar()
  assert.equal(serializar(e.vivo()), 'uno A\ndos remoto\ntres B\n')
  assert.equal(e.reemplazos.length, 2)
})

test('two edited list items do not erase what someone else wrote in the item between them', () => {
  const e = escenario('- uno\n- dos\n- tres\n')
  e.tipear('uno', 'uno A')
  e.tipear('tres', 'tres B')
  e.remoto((doc) => insertarTextoEn(doc, 'dos', ' remoto'))
  e.sync.vaciar()
  assert.equal(serializar(e.vivo()), '- uno A\n- dos remoto\n- tres B\n')
})

test('closing a mark over untouched text marks all of it', () => {
  const e = escenario('hola\n')
  e.tipear('hola', '**a b c')
  e.sync.vaciar()
  e.tipear('**a b c', '**a b c**')
  e.sync.vaciar()
  assert.equal(serializar(e.vivo()), '**a b c**\n')
})

test('a remote change with no pending typing enters the text and the caret shifts with it', () => {
  const e = escenario('uno\ndos\n')
  e.estado.cursor = e.estado.texto.indexOf('dos') + 3
  e.remoto((doc) => insertarTextoEn(doc, 'uno', ' más'))
  assert.equal(e.estado.texto, 'uno más\ndos\n')
  assert.equal(e.estado.cursor, e.estado.texto.indexOf('dos') + 3)
})

test('half-typed markdown is not rewritten into what the serializer would write', () => {
  const e = escenario('hola\n')
  e.tipear('hola', 'hola **neg')
  e.sync.vaciar()
  // El documento tiene asteriscos literales; el serializador los escaparía.
  assert.equal(serializar(e.vivo()), 'hola \\*\\*neg\n')
  assert.equal(e.estado.texto, 'hola **neg\n')
  e.tipear('**neg', '**negrita**')
  e.sync.vaciar()
  assert.equal(serializar(e.vivo()), 'hola **negrita**\n')
  assert.equal(e.estado.texto, 'hola **negrita**\n')
})

test('when a replacement does not fit, the text returns to the document and the error is reported', () => {
  const e = escenario('uno\n')
  e.fallar()
  e.tipear('uno', 'uno dos')
  e.sync.vaciar()
  assert.equal(e.errores.length, 1)
  assert.equal(e.estado.texto, 'uno\n')
})

// Ediciones al azar de los dos lados, intercaladas con envíos. Sólo se
// insertan palabras en bordes de palabra, así ninguna parte a otra y se puede
// comprobar que no se perdió ninguna. Del lado local nunca al principio de una
// línea: eso cambia el tipo del bloque (`# x` deja de ser título), y un cambio
// de tipo reemplaza el bloque entero, con lo que otro haya escrito adentro en
// ese momento. El editor visual sobre Yjs hace lo mismo.
test('fuzz: with interleaved local and remote edits nothing is lost and text and document match', () => {
  for (let semilla = 1; semilla <= 300; semilla++) {
    // mulberry32: determinístico por semilla.
    let s = semilla
    const azar = (n) => {
      s = (s + 0x6d2b79f5) | 0
      let t = Math.imul(s ^ (s >>> 15), 1 | s)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return (((t ^ (t >>> 14)) >>> 0) % n)
    }
    const e = escenario('# Título\n- uno dos\nalgo de texto\notra línea\n', {
      textoInicial: '# Título\n* uno dos\nalgo de texto\notra línea\n',
    })
    const palabras = []
    const letras = 'abcdefghijklmnopqrstuvwxyz'
    const palabraNueva = () => Array.from({ length: 7 }, () => letras[azar(26)]).join('')
    for (let paso = 0; paso < 30; paso++) {
      const accion = azar(10)
      if (accion < 4) {
        const t = e.estado.texto
        const bordes = []
        for (let i = 1; i <= t.length; i++) if (t[i - 1] === ' ' || (t[i - 1] === '\n' && i === t.length)) bordes.push(i)
        const i = bordes[azar(bordes.length)]
        const palabra = `${palabraNueva()} `
        palabras.push(palabra.trim())
        e.estado.texto = t.slice(0, i) + palabra + t.slice(i)
        e.sync.cambioLocal()
        // En la app el envío sale a los ~120 ms de la última tecla: lo
        // pendiente suele ser una o pocas ediciones, no decenas dispersas.
        if (azar(3) === 0) e.sync.vaciar()
      } else if (accion < 8) {
        const doc = e.vivo()
        const posiciones = []
        doc.descendants((n, p) => {
          if (n.isTextblock) posiciones.push(p + 1)
          if (n.isText) for (let k = 1; k <= n.text.length; k++) if (n.text[k - 1] === ' ') posiciones.push(p + k)
        })
        const pos = posiciones[azar(posiciones.length)]
        const palabra = `${palabraNueva()} `
        palabras.push(palabra.trim())
        e.remoto((d) => new Transform(d).insert(pos, schema.text(palabra)).doc)
      } else if (accion < 9) {
        const palabra = palabraNueva()
        palabras.push(palabra)
        e.remoto((d) => new Transform(d).insert(d.content.size, schema.nodes.paragraph.create(null, schema.text(palabra))).doc)
      } else {
        e.sync.vaciar()
      }
    }
    e.sync.vaciar()
    const final = serializar(e.vivo())
    assert.equal(serializar(parsear(e.estado.texto)), final, `semilla ${semilla}`)
    for (const palabra of palabras) assert.ok(final.includes(palabra), `semilla ${semilla}: falta ${palabra} en ${final}`)
    assert.equal(e.errores.length, 0, `semilla ${semilla}`)
  }
})
