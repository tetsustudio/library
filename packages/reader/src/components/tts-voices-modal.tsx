'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Play, Check } from 'lucide-react'
import { useTranslation } from '../context.js'
import { VOZ_VOICE_ID, type TTSVoice } from '../hooks/use-tts.js'

interface TTSVoicesModalProps {
  isOpen: boolean
  onClose: () => void
  voices: TTSVoice[]
  voiceId: string
  rate: number
  onSelectVoice: (id: string) => void
  onChangeRate: (rate: number) => void
  onPreview: (id: string) => void
}

export const TTSVoicesModal = ({
  isOpen,
  onClose,
  voices,
  voiceId,
  rate,
  onSelectVoice,
  onChangeRate,
  onPreview,
}: TTSVoicesModalProps) => {
  const { t } = useTranslation()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!isOpen || !mounted) return null

  const hasVoz = voices.some(v => v.id === VOZ_VOICE_ID)

  return createPortal(
    <div className="trd-root">
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">

        <div className="flex shrink-0 items-center justify-between border-b border-border p-4">
          <h2 className="text-lg font-bold text-foreground">
            {t('voiceAndSpeed')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('close')}
            className="text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="shrink-0 border-b border-border p-4">
          <label htmlFor="tts-rate" className="mb-2 block text-sm font-semibold text-foreground">
            {t('speed')}: {rate.toFixed(1)}x
          </label>
          <input
            id="tts-rate"
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={rate}
            onChange={e => onChangeRate(parseFloat(e.target.value))}
            className="w-full accent-brand"
          />
        </div>

        <div className="flex flex-col gap-1 overflow-y-auto p-2">
          {voices.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">
              {t('noVoices')}
            </p>
          )}

          {voices.map(voice => {
            const active = voice.id === voiceId
            return (
              <div
                key={voice.id}
                className={`flex items-center justify-between gap-2 rounded-lg border p-3 transition-colors ${
                  active
                    ? 'border-brand/40 bg-brand/10'
                    : 'border-transparent hover:bg-muted'
                }`}
              >
                <button
                  onClick={() => onSelectVoice(voice.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
                >
                  {active
                    ? <Check className="h-4 w-4 shrink-0 text-brand" />
                    : <span className="h-4 w-4 shrink-0" />}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {voice.name}
                    </span>
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      {voice.lang}
                      {voice.id === VOZ_VOICE_ID && (t('needsConnection'))}
                    </span>
                  </span>
                </button>

                <button
                  onClick={() => onPreview(voice.id)}
                  title={t('playSample')}
                  aria-label={t('playSample')}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <Play className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>

        <div className="shrink-0 border-t border-border p-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t('voicesNote')}
            {hasVoz &&
              (t('serverVoiceNote'))}
          </p>
        </div>
      </div>
    </div>
    </div>,
    document.body
  )
}
