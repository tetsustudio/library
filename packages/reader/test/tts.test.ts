import { describe, it, expect } from 'vitest'
import { splitIntoChunks, decideNextBatch, buildVoiceList, pickVoiceId, vozFormat, serverVoiceEntry, VOZ_VOICE_ID } from '../src/hooks/use-tts.js'

/**
 * Los motores de Web Speech tienen tope de largo por locucion, y ademas cada
 * trozo es la unidad que se resalta mientras se lee. Cortar mal es texto que
 * no se escucha.
 */
describe('splitIntoChunks', () => {
  it('texto vacio no produce nada', () => {
    expect(splitIntoChunks('')).toEqual([])
    expect(splitIntoChunks('   ')).toEqual([])
  })

  it('corta por oracion y junta las cortas', () => {
    const chunks = splitIntoChunks('Hola. Que tal. Todo bien.', 220)
    expect(chunks).toEqual(['Hola. Que tal. Todo bien.'])
  })

  it('no pierde texto', () => {
    const text = 'Primera oracion larga para probar. Segunda oracion. ' + 'palabra '.repeat(80)
    const chunks = splitIntoChunks(text, 100)
    const rejoined = chunks.join(' ').replace(/\s+/g, ' ').trim()
    expect(rejoined).toBe(text.replace(/\s+/g, ' ').trim())
  })

  it('respeta el tope de largo', () => {
    const text = 'palabra '.repeat(200)
    for (const chunk of splitIntoChunks(text, 100)) {
      expect(chunk.length).toBeLessThanOrEqual(100)
    }
  })

  it('parte una oracion sola mas larga que el tope', () => {
    const chunks = splitIntoChunks('a'.repeat(500), 100)
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('entiende signos de cierre en castellano', () => {
    const chunks = splitIntoChunks('¿Como estas? ¡Muy bien! Gracias.', 220)
    expect(chunks.join(' ')).toContain('¿Como estas?')
  })

  it('normaliza los saltos de linea de adentro de un parrafo', () => {
    expect(splitIntoChunks('Hola\n   mundo.', 220)).toEqual(['Hola mundo.'])
  })

  it('un salto doble separa parrafos y NO se juntan', () => {
    // Antes esto daba ['Hola mundo.']: se aplanaba todo y se empaquetaba por
    // largo, asi que el resaltado quedaba a caballo entre dos parrafos
    // marcando media idea de cada uno.
    expect(splitIntoChunks('Hola.\n\nMundo.', 220)).toEqual(['Hola.', 'Mundo.'])
  })

  it('cada parrafo corto es su propio trozo, aunque entren varios juntos', () => {
    const chunks = splitIntoChunks('Uno.\n\nDos.\n\nTres.', 220)
    expect(chunks).toEqual(['Uno.', 'Dos.', 'Tres.'])
  })

  it('un parrafo largo si se corta por oracion, pero no invade al siguiente', () => {
    const largo = 'Una oracion. Otra oracion. Una tercera.'
    const chunks = splitIntoChunks(`${largo}\n\nParrafo corto.`, 20)
    // El ultimo trozo es exactamente el parrafo corto, no una mezcla.
    expect(chunks[chunks.length - 1]).toBe('Parrafo corto.')
  })

  it('los parrafos vacios no producen trozos', () => {
    expect(splitIntoChunks('Uno.\n\n\n\n   \n\nDos.', 220)).toEqual(['Uno.', 'Dos.'])
  })
})

/**
 * Cuando se acaba lo que estaba a la vista, el lector pide el tramo siguiente
 * y la lectura sigue. Lo que se prueba aca es el corte: en el final del libro
 * `next()` no mueve nada y el tramo "nuevo" es identico al anterior. Sin la
 * comparacion, eso es un loop infinito leyendo la ultima pagina.
 */
describe('decideNextBatch', () => {
  it('sin texto nuevo, termina', () => {
    expect(decideNextBatch('lo anterior', null).kind).toBe('finish')
    expect(decideNextBatch('lo anterior', '').kind).toBe('finish')
    expect(decideNextBatch('lo anterior', '   \n  ').kind).toBe('finish')
  })

  it('el mismo texto otra vez es el final del libro, no un tramo nuevo', () => {
    expect(decideNextBatch('Ultima pagina.', 'Ultima pagina.').kind).toBe('finish')
  })

  it('ignora el espaciado al comparar: epubjs no lo devuelve igual dos veces', () => {
    expect(decideNextBatch('Ultima pagina.', '  Ultima pagina.  ').kind).toBe('finish')
  })

  it('texto distinto continua, ya troceado', () => {
    const decision = decideNextBatch('Pagina uno.', 'Pagina dos. Pagina tres.')
    expect(decision.kind).toBe('continue')
    if (decision.kind === 'continue') {
      expect(decision.chunks.join(' ')).toContain('Pagina dos')
      expect(decision.chunks.length).toBeGreaterThan(0)
    }
  })

  it('el primer tramo no tiene anterior contra que comparar', () => {
    expect(decideNextBatch(null, 'Arranca aca.').kind).toBe('continue')
  })
})

describe('buildVoiceList', () => {
  const browser = [
    { id: 'b-en', name: 'English', lang: 'en-US', isDefault: true },
    { id: 'b-es', name: 'Español', lang: 'es-ES', isDefault: false },
  ]

  const voz = serverVoiceEntry({ name: 'Rioplatense (voz)', lang: 'es-AR' })

  it('leaves the browser voices alone when there is no server voice', () => {
    expect(buildVoiceList(browser, null, 'es')).toEqual(browser)
  })

  it('puts the server voice first when it speaks the UI language', () => {
    const list = buildVoiceList(browser, voz, 'es')
    expect(list[0]).toEqual({ id: VOZ_VOICE_ID, name: 'Rioplatense (voz)', lang: 'es-AR', isDefault: false })
    expect(list.slice(1)).toEqual(browser)
  })

  it('puts it last in English, and offers it even without browser voices', () => {
    expect(buildVoiceList(browser, voz, 'en').at(-1)?.id).toBe(VOZ_VOICE_ID)
    expect(buildVoiceList([], voz, 'en').map(v => v.id)).toEqual([VOZ_VOICE_ID])
  })
})

describe('pickVoiceId', () => {
  const list = [
    { id: 'b-en', name: 'English', lang: 'en-US', isDefault: true },
    { id: 'b-es', name: 'Español', lang: 'es-ES', isDefault: false },
  ]
  const withVoz = [{ id: VOZ_VOICE_ID, name: 'Rioplatense (voz)', lang: 'es-AR', isDefault: false }, ...list]

  it('keeps the current voice while it is still offered', () => {
    expect(pickVoiceId(withVoz, VOZ_VOICE_ID, 'uninstalled', 'es')).toBe(VOZ_VOICE_ID)
  })

  it('restores the saved voice, the voz one included, once it shows up', () => {
    expect(pickVoiceId(list, 'b-es', VOZ_VOICE_ID, 'es')).toBe('b-es')
    expect(pickVoiceId(withVoz, 'b-es', VOZ_VOICE_ID, 'es')).toBe(VOZ_VOICE_ID)
  })

  it('without a saved voice, keeps the old default: the first browser voice of the language', () => {
    expect(pickVoiceId(withVoz, '', null, 'es')).toBe('b-es')
    expect(pickVoiceId(withVoz, '', null, 'en')).toBe('b-en')
  })

  it('falls back to voz when the browser has no voices', () => {
    expect(pickVoiceId([withVoz[0]], '', null, 'es')).toBe(VOZ_VOICE_ID)
    expect(pickVoiceId([], '', null, 'es')).toBe('')
  })
})

describe('vozFormat', () => {
  it('uses wav when the listener is waiting and mp3 when prefetching', () => {
    expect(vozFormat(false)).toBe('wav')
    expect(vozFormat(true)).toBe('mp3')
  })
})
