'use client'

import { useEffect } from 'react'

/** The extra fonts of the font picker. */
export const GOOGLE_FONTS = [
  'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Oswald',
  'Source Sans Pro', 'Slabo 27px', 'Raleway', 'PT Sans', 'Merriweather',
  'Noto Sans', 'Nunito', 'Concert One', 'Prompt', 'Work Sans',
  'Fira Sans', 'Rubik', 'Mukta', 'PT Serif', 'Inter',
  'Heebo', 'Cabin', 'Bitter', 'Crimson Text', 'Quicksand',
  'Inconsolata', 'Josefin Sans', 'Dosis', 'Libre Baskerville', 'Anton'
]

export const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=' + GOOGLE_FONTS.join('&family=').replace(/ /g, '+') + '&display=swap'

/** Adds the Google Fonts stylesheet to `doc` once (the page, or an EPUB iframe). */
export function injectGoogleFonts(doc: Document, id = 'google-fonts-main-doc') {
  if (doc.getElementById(id)) return
  const head = doc.head || doc.querySelector('head')
  if (!head) return
  const link = doc.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = GOOGLE_FONTS_URL
  head.appendChild(link)
}

/** Loads the picker fonts on the page so the selector can preview them. */
export function useGoogleFonts(enabled: boolean) {
  useEffect(() => {
    if (enabled && typeof document !== 'undefined') injectGoogleFonts(document)
  }, [enabled])
}
