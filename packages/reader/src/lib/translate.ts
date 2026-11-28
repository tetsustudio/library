/**
 * Traduccion del contenido del libro.
 *
 * Primero se intenta con las APIs on-device del navegador (`Translator` /
 * `LanguageDetector`, Chrome y Edge de escritorio): corren en el dispositivo,
 * sin mandar el texto del libro a ningun servidor. Hoy esas APIs no existen
 * en Chrome para Android, asi que en el celular se cae al adapter `translate`
 * de la app.
 *
 * Las APIs on-device son experimentales y no estan en los tipos de TS
 * todavia, asi que se accede a traves de `window` como `any` (mismo criterio
 * que el resto del proyecto para lo no tipado, ver ESLINT.md).
 */

/** Pocos idiomas a proposito: es lo que "basico" pide, no una lista exhaustiva. */
export interface TranslateLanguage {
  code: string
  name: string
}

export const SUPPORTED_TRANSLATE_LANGUAGES: TranslateLanguage[] = [
  { code: 'es', name: 'Español' },
  { code: 'en', name: 'English' },
  { code: 'pt', name: 'Português' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
]

export function isTranslationSupported(): boolean {
  return typeof window !== 'undefined' && 'Translator' in window
}

export function isLanguageDetectionSupported(): boolean {
  return typeof window !== 'undefined' && 'LanguageDetector' in window
}

/**
 * Un tag BCP-47 (`es-AR`, `pt-BR`, `en-US`) a la subetiqueta base de dos
 * letras que usan tanto nuestra lista como las APIs de traduccion.
 */
export function normalizeLanguageCode(lang: string | null | undefined): string | null {
  if (!lang) return null
  const base = lang.trim().toLowerCase().split(/[-_]/)[0]
  return base || null
}

/** Los idiomas de destino que tiene sentido ofrecer para un idioma de origen dado. */
export function targetLanguageOptions(sourceLang: string | null): TranslateLanguage[] {
  const normalizedSource = normalizeLanguageCode(sourceLang)
  return SUPPORTED_TRANSLATE_LANGUAGES.filter((l) => l.code !== normalizedSource)
}

export type TranslatorAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

export interface BookTranslator {
  translate(text: string): Promise<string>
  destroy?(): void
}

/**
 * Idioma de una muestra de texto. Se usa solo cuando el libro no trae el
 * idioma en su metadata (PDF no lo tiene; EPUB casi siempre si).
 */
export async function detectLanguage(sample: string): Promise<string | null> {
  if (!isLanguageDetectionSupported()) return null
  const trimmed = sample.trim()
  if (!trimmed) return null

  try {
    const DetectorCtor = (window as any).LanguageDetector
    const availability = await DetectorCtor.availability()
    if (availability === 'unavailable') return null

    const detector = await DetectorCtor.create()
    try {
      const results = await detector.detect(trimmed.slice(0, 500))
      const best = results?.[0]
      if (!best || best.confidence < 0.5) return null
      return normalizeLanguageCode(best.detectedLanguage)
    } finally {
      detector.destroy?.()
    }
  } catch (e) {
    console.warn('No se pudo detectar el idioma del libro', e)
    return null
  }
}

/**
 * Crea un traductor para un par de idiomas, o `null` si el navegador no
 * soporta la API o el par no tiene modelo disponible. `onProgress` recibe un
 * numero de 0 a 100 mientras se descarga el modelo la primera vez.
 */
export async function createBookTranslator(
  sourceLanguage: string,
  targetLanguage: string,
  onProgress?: (percent: number) => void
): Promise<BookTranslator | null> {
  if (!isTranslationSupported()) return null
  if (sourceLanguage === targetLanguage) return null

  try {
    const TranslatorCtor = (window as any).Translator
    const availability: TranslatorAvailability = await TranslatorCtor.availability({
      sourceLanguage,
      targetLanguage,
    })
    if (availability === 'unavailable') return null

    return await TranslatorCtor.create({
      sourceLanguage,
      targetLanguage,
      monitor(m: EventTarget) {
        m.addEventListener('downloadprogress', ((e: Event) => {
          const loaded = (e as unknown as { loaded: number }).loaded
          onProgress?.(Math.round(loaded * 100))
        }) as EventListener)
      },
    })
  } catch (e) {
    console.warn('No se pudo crear el traductor', e)
    return null
  }
}

/** Throw it from the `translate` adapter when the translation service is not set up. */
export class TranslateUnconfiguredError extends Error {}

export type TranslateAdapter = (text: string, targetLang: string, sourceLang: string) => Promise<string>

/**
 * Translator for browsers without the on-device API (today, all of Chrome
 * Android): it calls the app's `translate` adapter (glimpse used
 * `/api/translate`, a LibreTranslate of its own).
 */
export function createAdapterTranslator(adapter: TranslateAdapter, sourceLanguage: string, targetLanguage: string): BookTranslator {
  return {
    async translate(text: string): Promise<string> {
      const translated = await adapter(text, targetLanguage, sourceLanguage)
      return typeof translated === 'string' ? translated : text
    },
  }
}
