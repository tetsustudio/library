'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { DEFAULT_LABELS, type ReaderLabelKey, type ReaderLabels } from './labels.js'
import { resolveAssetUrls, type ReaderAssetUrls } from './lib/assets.js'
import type { ReaderProps } from './types.js'

export interface ReaderContextValue {
  labels: ReaderLabels
  t: (key: ReaderLabelKey) => string
  /** Two-letter base of the UI language: `es`, `en`… */
  language: string
  assets: ReaderAssetUrls
  ocrLanguage: string
  storage: ReaderProps['storage']
  translate: ReaderProps['translate']
  speechVoice: ReaderProps['speechVoice']
  googleFonts: boolean
  storagePrefix: string
}

/** Tesseract code for a UI language, as glimpse did (`es` → `spa`, anything else → `eng`). */
export function defaultOcrLanguage(language: string): string {
  return language === 'es' ? 'spa' : 'eng'
}

export function buildReaderContext(props: Partial<ReaderProps>): ReaderContextValue {
  const labels = { ...DEFAULT_LABELS, ...props.labels }
  const language = (props.language || 'en').trim().toLowerCase().split(/[-_]/)[0] || 'en'
  return {
    labels,
    t: (key) => labels[key],
    language,
    assets: resolveAssetUrls(props.assetBaseUrl),
    ocrLanguage: props.ocrLanguage || defaultOcrLanguage(language),
    storage: props.storage,
    translate: props.translate,
    speechVoice: props.speechVoice,
    googleFonts: props.googleFonts ?? true,
    storagePrefix: props.storagePrefix || 'tetsu-reader',
  }
}

const ReaderContext = createContext<ReaderContextValue>(buildReaderContext({}))

export function ReaderProvider({ value, children }: { value: ReaderContextValue; children: ReactNode }) {
  return <ReaderContext.Provider value={value}>{children}</ReaderContext.Provider>
}

export function useReaderContext(): ReaderContextValue {
  return useContext(ReaderContext)
}

/** Same shape as glimpse's `useTranslation()`, so the ported components read the same. */
export function useTranslation() {
  const { t, language, labels } = useReaderContext()
  return { t, language, labels }
}

export function useMemoReaderContext(props: Partial<ReaderProps>): ReaderContextValue {
  return useMemo(
    () => buildReaderContext(props),
    // Adapters are usually inline functions; the context only needs the latest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.labels, props.language, props.assetBaseUrl, props.ocrLanguage, props.storage, props.translate, props.speechVoice, props.googleFonts, props.storagePrefix]
  )
}
