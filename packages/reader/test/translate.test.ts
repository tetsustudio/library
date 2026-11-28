import { describe, it, expect } from 'vitest'
import { normalizeLanguageCode, targetLanguageOptions, SUPPORTED_TRANSLATE_LANGUAGES } from '../src/lib/translate.js'

describe('normalizeLanguageCode', () => {
  it('saca la subetiqueta base de un tag BCP-47', () => {
    expect(normalizeLanguageCode('es-AR')).toBe('es')
    expect(normalizeLanguageCode('pt-BR')).toBe('pt')
    expect(normalizeLanguageCode('en-US')).toBe('en')
  })

  it('acepta guion bajo ademas de guion medio', () => {
    expect(normalizeLanguageCode('es_AR')).toBe('es')
  })

  it('un codigo simple queda igual, en minuscula', () => {
    expect(normalizeLanguageCode('ES')).toBe('es')
  })

  it('null, undefined o vacio devuelven null', () => {
    expect(normalizeLanguageCode(null)).toBeNull()
    expect(normalizeLanguageCode(undefined)).toBeNull()
    expect(normalizeLanguageCode('')).toBeNull()
    expect(normalizeLanguageCode('   ')).toBeNull()
  })
})

describe('targetLanguageOptions', () => {
  it('sin idioma de origen, devuelve la lista completa', () => {
    expect(targetLanguageOptions(null)).toHaveLength(SUPPORTED_TRANSLATE_LANGUAGES.length)
  })

  it('saca el idioma de origen de las opciones de destino', () => {
    const options = targetLanguageOptions('es-AR')
    expect(options.some((l) => l.code === 'es')).toBe(false)
    expect(options.length).toBe(SUPPORTED_TRANSLATE_LANGUAGES.length - 1)
  })

  it('un idioma de origen que no esta en la lista no saca nada', () => {
    const options = targetLanguageOptions('ja')
    expect(options).toHaveLength(SUPPORTED_TRANSLATE_LANGUAGES.length)
  })
})
