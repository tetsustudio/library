'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Square, Pause, Settings2 } from 'lucide-react'
import { Button } from './ui/button.js'
import { useTTS } from '../hooks/use-tts.js'
import { useReaderContext, useTranslation } from '../context.js'
import { TTSVoicesModal } from './tts-voices-modal.js'

/**
 * Los controles viven en la barra del lector, que tiene tema propio (claro,
 * oscuro, e-ink o custom). Por eso NO pueden usar los tokens de la app:
 * `border-input` + `bg-background` dibujaban tres cajas con el fondo del
 * dashboard al lado de los iconos sin borde del resto de la barra.
 *
 * Se usa el mismo `Button variant="ghost"` que los demas controles del lector
 * y el color lo hereda del contenedor.
 */
const CONTROL_CLASS = 'h-9 w-9 p-0 hover:bg-slate-800/20'

interface TTSPlayerProps {
  textToRead?: string
  getTextToRead?: () => string | Promise<string>
  onTextChange?: (text: string | null) => void
  /**
   * Que leer cuando se acaba lo que estaba a la vista. Devolver null termina.
   * Es lo que hace que el lector avance solo en vez de cortar al final de la
   * pagina.
   */
  getMoreTextToRead?: () => Promise<string | null> | string | null
  /** Sobreescribe el estilo de los botones si el contenedor no es la barra. */
  buttonClassName?: string
  /**
   * El boton de voz y velocidad. Se apaga cuando esa entrada vive en el menu
   * del lector: la barra no tiene lugar para siete iconos en un telefono.
   */
  showVoicesButton?: boolean
  /** Controlado desde afuera cuando la entrada esta en el menu. */
  voicesOpen?: boolean
  onVoicesOpenChange?: (open: boolean) => void
}

export function TTSPlayer({
  textToRead,
  getTextToRead,
  onTextChange,
  getMoreTextToRead,
  buttonClassName = CONTROL_CLASS,
  showVoicesButton = true,
  voicesOpen,
  onVoicesOpenChange,
}: TTSPlayerProps) {
  const { t, language } = useTranslation()
  const { speechVoice } = useReaderContext()

  const moreRef = useRef(getMoreTextToRead)
  moreRef.current = getMoreTextToRead
  const requestMore = useCallback(() => moreRef.current?.() ?? null, [])

  const tts = useTTS(language, { onRequestMore: requestMore, speechVoice })
  // Controlado o no, segun quien tenga el boton. Sin esto, mover la entrada al
  // menu del lector obligaria a duplicar el modal.
  const [internalOpen, setInternalOpen] = useState(false)
  const showModal = voicesOpen ?? internalOpen
  const setShowModal = onVoicesOpenChange ?? setInternalOpen

  // Por ref: quien nos usa pasa `onTextChange` como funcion inline, asi que
  // como dependencia el efecto corria en CADA render y volvia a resaltar el
  // mismo texto. Con window.find eso movia el resaltado al siguiente match y
  // saltaba por el capitulo solo.
  const onTextChangeRef = useRef(onTextChange)
  onTextChangeRef.current = onTextChange

  useEffect(() => {
    onTextChangeRef.current?.(tts.currentText)
  }, [tts.currentText])

  // Without Web Speech and without the server's voz voice there is nothing to
  // offer, and a button that does nothing is worse than no button.
  if (!tts.supported) return null

  const handlePlay = async () => {
    if (tts.status === 'speaking') {
      tts.pause()
      return
    }
    if (tts.status === 'paused') {
      tts.resume()
      return
    }

    let text = textToRead
    if (getTextToRead) text = await getTextToRead()
    if (text) tts.speak(text)
  }

  const title =
    tts.status === 'speaking'
      ? t('pause')
      : tts.status === 'paused'
        ? t('resume')
        : t('readAloud')

  return (
    <>
      <div className="flex items-center gap-1 md:gap-3">
        <Button
          variant="ghost"
          onClick={handlePlay}
          title={title}
          aria-label={title}
          className={buttonClassName}
        >
          {tts.status === 'speaking'
            ? <Pause className="h-5 w-5 text-brand" />
            : <Play className={`h-5 w-5 ${tts.status === 'paused' ? 'text-brand' : ''}`} />}
        </Button>

        {(tts.status === 'speaking' || tts.status === 'paused') && (
          <Button
            variant="ghost"
            onClick={tts.stop}
            title={t('stop')}
            aria-label={t('stop')}
            className={buttonClassName}
          >
            <Square className="h-5 w-5" />
          </Button>
        )}

        {showVoicesButton && (
          <Button
            variant="ghost"
            onClick={() => setShowModal(true)}
            title={t('voiceAndSpeed')}
            aria-label={t('voiceAndSpeed')}
            className={buttonClassName}
          >
            <Settings2 className="h-5 w-5" />
          </Button>
        )}
      </div>

      {showModal && (
        <TTSVoicesModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          voices={tts.voices}
          voiceId={tts.voiceId}
          rate={tts.rate}
          onSelectVoice={tts.selectVoice}
          onChangeRate={tts.changeRate}
          onPreview={tts.previewVoice}
        />
      )}
    </>
  )
}
