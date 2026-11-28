'use client'

import type { ReactNode } from 'react'
import { ReaderProvider, useMemoReaderContext } from './context.js'
import { PdfReaderView } from './components/pdf-reader.js'
import { EpubReaderView } from './components/epub-reader.js'
import { detectFormat } from './lib/format.js'
import type { ReaderFormat, ReaderProps } from './types.js'

/**
 * Wraps a reader view: the context with the adapters and labels, and the
 * `.trd-root` element every class of styles.css is scoped to.
 */
function ReaderShell({ props, children }: { props: ReaderProps; children: ReactNode }) {
  const context = useMemoReaderContext(props)
  return (
    <ReaderProvider value={context}>
      <div className={props.mode === 'dark' ? 'trd-root dark' : 'trd-root'} data-reader-mode={props.mode ?? 'inherit'}>
        {children}
      </div>
    </ReaderProvider>
  )
}

/** PDF reader: page view, adjustable text view and OCR view. */
export function PdfReader(props: ReaderProps) {
  return (
    <ReaderShell props={props}>
      <PdfReaderView {...props} />
    </ReaderShell>
  )
}

/** EPUB reader: continuous scroll, search, read aloud. */
export function EpubReader(props: ReaderProps) {
  return (
    <ReaderShell props={props}>
      <EpubReaderView {...props} />
    </ReaderShell>
  )
}

export interface AutoReaderProps extends ReaderProps {
  /** Skip detection. Otherwise it comes from the file extension of `src` (default EPUB). */
  format?: ReaderFormat
}

/** Picks `PdfReader` or `EpubReader` by `format`, or by the extension of `src`. */
export function Reader({ format, ...props }: AutoReaderProps) {
  const kind = format ?? detectFormat(props.src)
  return kind === 'pdf' ? <PdfReader {...props} /> : <EpubReader {...props} />
}
