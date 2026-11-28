'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createBookTranslator,
  createAdapterTranslator,
  isTranslationSupported,
  TranslateUnconfiguredError,
  type BookTranslator,
  type TranslateAdapter,
} from '../lib/translate.js'

export type BookTranslatorStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'unavailable'
  | 'unconfigured'
  | 'error'

/**
 * Ciclo de vida del traductor para un par de idiomas.
 *
 * Primero intenta el `Translator` on-device del navegador. Si el navegador no
 * lo tiene (hoy, todo Chrome Android), cae al respaldo remoto de
 * adapter `translate` de la app y prueba con un texto chico si ese respaldo esta
 * configurado y responde antes de darlo por bueno.
 *
 * Se re-crea solo cuando cambia el par de idiomas o se apaga/prende la
 * traduccion, no en cada traduccion individual: crear el traductor on-device
 * es lo que puede implicar bajar el modelo.
 */
export function useBookTranslator(
  enabled: boolean,
  sourceLang: string | null,
  targetLang: string | null,
  adapter?: TranslateAdapter
) {
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter
  const [status, setStatus] = useState<BookTranslatorStatus>('idle')
  const [progress, setProgress] = useState(0)
  const translatorRef = useRef<BookTranslator | null>(null)

  useEffect(() => {
    translatorRef.current = null

    if (!enabled || !targetLang) {
      setStatus('idle')
      return
    }
    if (!sourceLang || sourceLang === targetLang) {
      // Sin idioma de origen todavia (se esta detectando) o ya coincide con
      // el destino: no hay nada que traducir.
      setStatus('idle')
      return
    }

    let cancelled = false
    setStatus('checking')
    setProgress(0)

    const setup = async () => {
      if (isTranslationSupported()) {
        const translator = await createBookTranslator(sourceLang, targetLang, (percent) => {
          if (!cancelled) {
            setStatus('downloading')
            setProgress(percent)
          }
        })
        if (translator) return translator
        // El navegador tiene la API pero no ese par de idiomas: no tiene
        // sentido probar el respaldo remoto, el resultado va a ser el mismo
        // problema (o peor, sin el modelo local).
        if (!cancelled) setStatus('unavailable')
        return null
      }

      // Sin la API on-device: el adapter `translate` de la app. Se prueba con un
      // texto chico para no marcar "listo" un servicio que en realidad no responde.
      const current = adapterRef.current
      if (!current) {
        if (!cancelled) setStatus('unconfigured')
        return null
      }
      const remote = createAdapterTranslator(current, sourceLang, targetLang)
      try {
        await remote.translate('Hello')
        return remote
      } catch (e) {
        if (!cancelled) setStatus(e instanceof TranslateUnconfiguredError ? 'unconfigured' : 'error')
        return null
      }
    }

    setup()
      .then((translator) => {
        if (cancelled) {
          translator?.destroy?.()
          return
        }
        if (translator) {
          translatorRef.current = translator
          setStatus('ready')
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
      translatorRef.current?.destroy?.()
      translatorRef.current = null
    }
  }, [enabled, sourceLang, targetLang])

  const translate = useCallback(async (text: string): Promise<string> => {
    const translator = translatorRef.current
    if (!translator) return text
    try {
      return await translator.translate(text)
    } catch (e) {
      console.warn('Fallo al traducir un fragmento, se deja el original', e)
      return text
    }
  }, [])

  return { status, progress, translate }
}
