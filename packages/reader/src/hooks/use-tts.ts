'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWakeLock } from './use-wake-lock.js'
import type { ReaderSpeechVoice } from '../types.js'

/**
 * Lectura en voz alta sobre la Web Speech API del sistema.
 *
 * Reemplaza a Kokoro, que era inviable en mobile: el modelo q8 mas los
 * embeddings de voces mas el runtime de onnxruntime-web sumaban del orden de
 * 90 MB antes del primer audio, y en un telefono de gama media generaba mas
 * lento que tiempo real. Ademas arrastraba media configuracion de webpack del
 * proyecto (el parche de import.meta contra Terser) y una dependencia que ni
 * figuraba en package.json.
 *
 * Esto descarga cero bytes, arranca instantaneo y funciona sin conexion.
 * Lo que se pierde es uniformidad: la voz depende del sistema operativo.
 *
 * LIMITES REALES, no teoricos:
 *  - iOS exige que el primer `speak()` salga de un gesto del usuario.
 *  - La lectura se corta al bloquear la pantalla; no hay forma de evitarlo
 *    desde una pagina web.
 *  - Chrome corta las locuciones largas cerca de los 15s: por eso el timer de
 *    resume() de mas abajo, que es el workaround conocido.
 *  - `onboundary` no es confiable en iOS, asi que el resaltado se hace por
 *    oracion y no por palabra.
 *
 * La lectura NO termina cuando se acaba el texto que se le paso: si quien lo
 * usa provee `onRequestMore`, se le pide el tramo siguiente y se sigue sin
 * corte. Es lo que hace que el lector avance de pagina solo en vez de callarse
 * al llegar al final de lo que estaba a la vista.
 */

export type TTSStatus = 'unsupported' | 'idle' | 'speaking' | 'paused'

export interface TTSVoice {
  id: string
  name: string
  lang: string
  isDefault: boolean
}

const VOICE_STORAGE_KEY = 'tetsu-reader-tts-voice'
const RATE_STORAGE_KEY = 'tetsu-reader-tts-rate'

/**
 * Trocea el texto en unidades para leer y resaltar.
 *
 * **El parrafo manda sobre el largo.** Antes esto aplanaba todo a una linea y
 * empaquetaba oraciones hasta llenar 220 caracteres, sin mirar donde terminaba
 * un parrafo: un parrafo corto se juntaba con el principio del siguiente y el
 * resaltado quedaba a caballo entre dos bloques, marcando media idea de cada
 * uno. Un parrafo que entra en el tope es un chunk, y punto.
 *
 * Dentro de un parrafo que NO entra, ahi si se corta por oracion; y una
 * oracion sola mas larga que el tope, por comas y despues a lo bruto.
 */
export function splitIntoChunks(text: string, maxLen = 220): string[] {
  const chunks: string[] = []

  // Los saltos dobles separan parrafos; los simples, no (un <br> adentro de un
  // parrafo no lo parte en dos).
  for (const rawParagraph of text.split(/\n\s*\n/)) {
    const paragraph = rawParagraph.replace(/\s+/g, ' ').trim()
    if (!paragraph) continue

    if (paragraph.length <= maxLen) {
      chunks.push(paragraph)
      continue
    }

    const sentences = paragraph.match(/[^.!?…]+[.!?…]+[\])'"`’”]*|[^.!?…]+$/g) || [paragraph]
    let current = ''

    for (const raw of sentences) {
      const sentence = raw.trim()
      if (!sentence) continue

      if (sentence.length > maxLen) {
        if (current) {
          chunks.push(current)
          current = ''
        }
        let rest = sentence
        while (rest.length > maxLen) {
          const cut = rest.lastIndexOf(',', maxLen)
          const at = cut > maxLen * 0.5 ? cut + 1 : rest.lastIndexOf(' ', maxLen)
          const idx = at > 0 ? at : maxLen
          chunks.push(rest.slice(0, idx).trim())
          rest = rest.slice(idx).trim()
        }
        if (rest) current = rest
        continue
      }

      if ((current + ' ' + sentence).trim().length > maxLen) {
        chunks.push(current)
        current = sentence
      } else {
        current = current ? `${current} ${sentence}` : sentence
      }
    }

    // Lo que quede del parrafo cierra acá: no se arrastra al siguiente.
    if (current) chunks.push(current)
  }

  return chunks
}

/**
 * Que hacer con el tramo que devolvio `onRequestMore`.
 *
 * Separado del hook porque es la regla que puede colgar la app: si el lector
 * ya no puede avanzar, `getVisibleText()` devuelve lo mismo una y otra vez y
 * sin este corte la lectura queda en loop sobre la ultima pagina del libro.
 */
export type NextBatch =
  | { kind: 'continue'; chunks: string[] }
  | { kind: 'finish' }

export function decideNextBatch(previous: string | null, next: string | null): NextBatch {
  const text = (next || '').trim()
  if (!text) return { kind: 'finish' }
  if (previous !== null && text === previous.trim()) return { kind: 'finish' }

  const chunks = splitIntoChunks(text)
  if (!chunks.length) return { kind: 'finish' }
  return { kind: 'continue', chunks }
}

/**
 * A remote voice (the app's `speechVoice` adapter; glimpse offered voz's
 * rioplatense voice through /api/tts), offered next to the browser voices.
 * Unlike the browser voices it needs a connection: each chunk goes through
 * `synthesize` and comes back as audio for an `<audio>`.
 */
export const VOZ_VOICE_ID = 'server:voice'

export function serverVoiceEntry(voice: { name: string; lang: string }): TTSVoice {
  return { id: VOZ_VOICE_ID, name: voice.name, lang: voice.lang, isDefault: false }
}

/** A few ms of silence, played inside the user's gesture so iOS lets the element play later. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAA'

/** The browser voices plus the server one: first when it speaks the UI language, last otherwise. */
export function buildVoiceList(browser: TTSVoice[], server: TTSVoice | null, language: string): TTSVoice[] {
  if (!server) return browser
  return server.lang.toLowerCase().startsWith(language) ? [server, ...browser] : [...browser, server]
}

/**
 * Which voice to use once the list changes. The saved one wins as soon as it
 * is offered: the voz voice arrives after the browser ones (it needs a fetch),
 * and without this the reader would stick to the default browser voice.
 * Without a saved voice the default stays what it was: the first browser voice
 * of the interface language.
 */
export function pickVoiceId(
  voices: TTSVoice[],
  current: string,
  saved: string | null,
  language: string
): string {
  const offered = (id: string | null) => !!id && voices.some(v => v.id === id)
  if (offered(saved)) return saved as string
  if (offered(current)) return current
  const browser = voices.filter(v => v.id !== VOZ_VOICE_ID)
  const prefix = language
  const preferred = browser.find(v => v.lang.toLowerCase().startsWith(prefix))
  return preferred?.id || browser[0]?.id || voices[0]?.id || ''
}

/**
 * wav when someone is waiting for the chunk (first audio ~350 ms), mp3 when
 * it is fetched ahead while the previous one plays (~2 s, but 10x smaller).
 */
export function vozFormat(prefetch: boolean): 'mp3' | 'wav' {
  return prefetch ? 'mp3' : 'wav'
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export interface TTSOptions {
  /**
   * Se llama cuando se agotaron los chunks. Devolver texto continua la lectura
   * sin corte; devolver null o vacio la termina.
   */
  onRequestMore?: () => Promise<string | null> | string | null
  /** A remote voice offered next to the browser ones. */
  speechVoice?: ReaderSpeechVoice
}

export function useTTS(language: string = 'en', options: TTSOptions = {}) {
  const [status, setStatus] = useState<TTSStatus>('idle')
  const [browserVoices, setBrowserVoices] = useState<TTSVoice[]>([])
  const speechVoiceRef = useRef(options.speechVoice)
  speechVoiceRef.current = options.speechVoice
  const serverName = options.speechVoice?.name
  const serverLang = options.speechVoice?.lang
  const serverVoice = useMemo(
    () => (serverName && serverLang ? serverVoiceEntry({ name: serverName, lang: serverLang }) : null),
    [serverName, serverLang]
  )
  const vozAvailable = !!serverVoice
  const [voiceId, setVoiceId] = useState<string>('')
  const [rate, setRate] = useState<number>(1)
  const [currentText, setCurrentText] = useState<string | null>(null)

  // Leyendo en voz alta nadie toca la pantalla, y el telefono la apaga sola.
  // En pausa tambien se sostiene: la pausa es para volver enseguida, y perder
  // la pantalla ahi obliga a desbloquear el telefono para seguir escuchando.
  useWakeLock(status === 'speaking' || status === 'paused')

  const chunksRef = useRef<string[]>([])
  const indexRef = useRef(0)
  const cancelledRef = useRef(false)
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null)
  /** Ultimo tramo que se empezo a leer, para detectar que ya no hay mas. */
  const lastBatchRef = useRef<string | null>(null)
  /** Engine of the current reading, fixed at speak(): switching voices applies to the next one. */
  const engineRef = useRef<'browser' | 'voz'>('browser')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  /** voz audio per chunk text, as object URLs: the playing chunk and the prefetched next one. */
  const vozCacheRef = useRef(new Map<string, Promise<string>>())
  /** Bumped on every speak/stop so late voz responses of an old reading are dropped. */
  const generationRef = useRef(0)

  // Por ref y no por dependencia: `onRequestMore` se redefine en cada render
  // de quien nos usa, y como dependencia reconstruiria speakChunk en medio de
  // la locucion.
  const onRequestMoreRef = useRef(options.onRequestMore)
  useEffect(() => {
    onRequestMoreRef.current = options.onRequestMore
  })

  const browserSpeech = typeof window !== 'undefined' && 'speechSynthesis' in window
  const supported = browserSpeech || vozAvailable

  const voices = useMemo(
    () => buildVoiceList(browserVoices, serverVoice, language),
    [browserVoices, serverVoice, language]
  )

  // ------------------------------------------------------------- voces

  useEffect(() => {
    if (!supported) setStatus('unsupported')
    else setStatus(s => (s === 'unsupported' ? 'idle' : s))
  }, [supported])

  useEffect(() => {
    const savedRate = parseFloat(readStorage(RATE_STORAGE_KEY) || '1')
    if (!isNaN(savedRate) && savedRate >= 0.5 && savedRate <= 2) setRate(savedRate)
  }, [])

  useEffect(() => {
    if (!browserSpeech) return

    const load = () => {
      const list = window.speechSynthesis.getVoices()
      if (!list.length) return

      const mapped: TTSVoice[] = list.map(v => ({
        id: v.voiceURI,
        name: v.name,
        lang: v.lang,
        isDefault: v.default,
      }))

      // Primero las del idioma de la interfaz: son las que el lector quiere.
      const prefix = language
      mapped.sort((a, b) => {
        const aMatch = a.lang.toLowerCase().startsWith(prefix) ? 0 : 1
        const bMatch = b.lang.toLowerCase().startsWith(prefix) ? 0 : 1
        if (aMatch !== bMatch) return aMatch - bMatch
        return a.name.localeCompare(b.name)
      })

      setBrowserVoices(mapped)
    }

    load()
    // En Chrome la lista llega asincrona y la primera llamada devuelve vacio.
    window.speechSynthesis.addEventListener('voiceschanged', load)

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load)
    }
  }, [browserSpeech, language])

  useEffect(() => {
    setVoiceId(current => pickVoiceId(voices, current, readStorage(VOICE_STORAGE_KEY), language))
  }, [voices, language])

  // ---------------------------------------------------------- reproduccion

  const stopKeepAlive = useCallback(() => {
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current)
      keepAliveRef.current = null
    }
  }, [])

  const fetchVozAudio = useCallback((text: string, prefetch: boolean) => {
    const cache = vozCacheRef.current
    let audio = cache.get(text)
    if (!audio) {
      const voice = speechVoiceRef.current
      audio = voice
        ? voice.synthesize(text, vozFormat(prefetch)).then(blob => URL.createObjectURL(blob))
        : Promise.reject(new Error('No server voice configured'))
      audio.catch(() => cache.delete(text))
      cache.set(text, audio)
    }
    return audio
  }, [])

  const forgetVozAudio = useCallback((text: string) => {
    const audio = vozCacheRef.current.get(text)
    if (!audio) return
    vozCacheRef.current.delete(text)
    audio.then(url => URL.revokeObjectURL(url)).catch(() => {})
  }, [])

  /** Silences both engines and drops the voz audio of the reading being stopped. */
  const haltPlayback = useCallback(() => {
    if (browserSpeech) window.speechSynthesis.cancel()
    const audio = audioRef.current
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.onplaying = null
      audio.pause()
    }
    for (const text of Array.from(vozCacheRef.current.keys())) forgetVozAudio(text)
  }, [browserSpeech, forgetVozAudio])

  const stop = useCallback(() => {
    if (!supported) return
    cancelledRef.current = true
    generationRef.current++
    stopKeepAlive()
    haltPlayback()
    chunksRef.current = []
    indexRef.current = 0
    lastBatchRef.current = null
    setCurrentText(null)
    setStatus('idle')
  }, [supported, stopKeepAlive, haltPlayback])

  const speakChunk = useCallback(
    (i: number) => {
      if (!supported || cancelledRef.current) return
      const finish = () => {
        stopKeepAlive()
        lastBatchRef.current = null
        setCurrentText(null)
        setStatus('idle')
      }
      const fail = (err: unknown) => {
        console.error('Error de sintesis de voz:', err)
        stopKeepAlive()
        setStatus('idle')
        setCurrentText(null)
      }

      const chunk = chunksRef.current[i]
      if (!chunk) {
        // Se acabo el tramo. Antes de callarse, se pide el siguiente.
        const request = onRequestMoreRef.current
        if (!request) {
          finish()
          return
        }

        void (async () => {
          let next: string | null = null
          try {
            next = await request()
          } catch (err) {
            console.error('Error al pedir el tramo siguiente para leer:', err)
          }
          if (cancelledRef.current) return

          const decision = decideNextBatch(lastBatchRef.current, next)
          if (decision.kind === 'finish') {
            finish()
            return
          }

          lastBatchRef.current = (next || '').trim()
          chunksRef.current = decision.chunks
          indexRef.current = 0
          speakChunk(0)
        })()
        return
      }

      if (engineRef.current === 'voz') {
        const generation = generationRef.current
        const stale = () => cancelledRef.current || generation !== generationRef.current
        const audio = audioRef.current ?? (audioRef.current = new Audio())
        const next = chunksRef.current[i + 1]

        fetchVozAudio(chunk, false)
          .then(url => {
            if (stale()) return
            // Fetched while this one plays, so the next chunk starts without a gap.
            if (next) fetchVozAudio(next, true).catch(() => {})
            audio.onplaying = () => {
              if (stale()) return
              setCurrentText(chunk)
              setStatus('speaking')
            }
            audio.onended = () => {
              if (stale()) return
              forgetVozAudio(chunk)
              indexRef.current = i + 1
              speakChunk(i + 1)
            }
            audio.onerror = () => {
              if (!stale()) fail(audio.error)
            }
            audio.src = url
            audio.defaultPlaybackRate = rate
            audio.playbackRate = rate
            return audio.play()
          })
          .catch(err => {
            if (!stale()) fail(err)
          })
        return
      }

      if (!browserSpeech) return
      const utterance = new SpeechSynthesisUtterance(chunk)
      const voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === voiceId)
      if (voice) {
        utterance.voice = voice
        utterance.lang = voice.lang
      }
      utterance.rate = rate

      utterance.onstart = () => {
        setCurrentText(chunk)
        setStatus('speaking')
      }
      utterance.onend = () => {
        if (cancelledRef.current) return
        indexRef.current = i + 1
        speakChunk(i + 1)
      }
      utterance.onerror = event => {
        // 'interrupted' y 'canceled' son lo que pasa cuando frenamos nosotros.
        if (event.error === 'interrupted' || event.error === 'canceled') return
        fail(event.error)
      }

      window.speechSynthesis.speak(utterance)
    },
    [supported, browserSpeech, voiceId, rate, stopKeepAlive, fetchVozAudio, forgetVozAudio]
  )

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return

      haltPlayback()
      generationRef.current++
      cancelledRef.current = false
      engineRef.current = voiceId === VOZ_VOICE_ID || !browserSpeech ? 'voz' : 'browser'
      chunksRef.current = splitIntoChunks(text)
      indexRef.current = 0
      lastBatchRef.current = text.trim()

      if (!chunksRef.current.length) return

      stopKeepAlive()
      if (engineRef.current === 'voz') {
        // iOS only lets an element play if it first played inside a gesture,
        // and the real audio arrives after a fetch: unlock it now.
        const audio = audioRef.current ?? (audioRef.current = new Audio())
        audio.src = SILENT_WAV
        audio.play().catch(() => {})
      } else {
        // Workaround conocido de Chrome: sin esto corta cerca de los 15s.
        keepAliveRef.current = setInterval(() => {
          if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
            window.speechSynthesis.resume()
          }
        }, 10000)
      }

      speakChunk(0)
    },
    [supported, browserSpeech, voiceId, speakChunk, stopKeepAlive, haltPlayback]
  )

  const pause = useCallback(() => {
    if (!supported) return
    if (engineRef.current === 'voz') audioRef.current?.pause()
    else window.speechSynthesis.pause()
    setStatus('paused')
  }, [supported])

  const resume = useCallback(() => {
    if (!supported) return
    if (engineRef.current === 'voz') audioRef.current?.play().catch(() => {})
    else window.speechSynthesis.resume()
    setStatus('speaking')
  }, [supported])

  // The voz audio takes a speed change at once; a browser utterance only from the next chunk.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.defaultPlaybackRate = rate
    audio.playbackRate = rate
  }, [rate])

  const selectVoice = useCallback((id: string) => {
    setVoiceId(id)
    try {
      localStorage.setItem(VOICE_STORAGE_KEY, id)
    } catch {}
  }, [])

  const changeRate = useCallback((value: number) => {
    const clamped = Math.min(2, Math.max(0.5, value))
    setRate(clamped)
    try {
      localStorage.setItem(RATE_STORAGE_KEY, String(clamped))
    } catch {}
  }, [])

  const previewVoice = useCallback(
    (id: string) => {
      if (!supported) return
      const sample =
        language === 'es'
          ? 'Esta es una muestra de la voz seleccionada.'
          : 'This is a sample of the selected voice.'

      if (id === VOZ_VOICE_ID) {
        const voice = speechVoiceRef.current
        if (!voice) return
        voice.synthesize(sample, vozFormat(false))
          .then(async blob => {
            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)
            audio.playbackRate = rate
            audio.onended = () => URL.revokeObjectURL(url)
            await audio.play()
          })
          .catch(err => console.error('Error al escuchar la muestra de voz:', err))
        return
      }

      if (!browserSpeech) return
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(sample)
      const voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === id)
      if (voice) {
        utterance.voice = voice
        utterance.lang = voice.lang
      }
      utterance.rate = rate
      window.speechSynthesis.speak(utterance)
    },
    [supported, browserSpeech, language, rate]
  )

  // Si el componente se va, la voz tiene que irse con el.
  useEffect(() => {
    const cache = vozCacheRef.current
    return () => {
      cancelledRef.current = true
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
      audioRef.current?.pause()
      cache.forEach(audio => audio.then(url => URL.revokeObjectURL(url)).catch(() => {}))
      cache.clear()
      if (keepAliveRef.current) clearInterval(keepAliveRef.current)
    }
  }, [])

  return {
    supported,
    status,
    voices,
    voiceId,
    rate,
    currentText,
    speak,
    stop,
    pause,
    resume,
    selectVoice,
    changeRate,
    previewVoice,
  }
}
