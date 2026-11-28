/**
 * Where the runtime assets live once `tetsu-reader-assets` copied them into the
 * app's public directory. Everything is served from the app's own origin: a
 * CDN would need extra CSP entries and would not work offline.
 *
 *   <base>/pdfjs/        pdf.js legacy worker, wasm/, standard_fonts/, cmaps/, iccs/
 *   <base>/tesseract/    worker.min.js, core/ (tesseract-core*.wasm.js), lang/ (<lang>.traineddata.gz)
 */
export const DEFAULT_ASSET_BASE_URL = '/reader-assets'

export interface ReaderAssetUrls {
  pdfWorker: string
  pdfCMaps: string
  pdfStandardFonts: string
  pdfWasm: string
  pdfIccs: string
  tesseractWorker: string
  tesseractCore: string
  tesseractLang: string
}

export function resolveAssetUrls(base: string = DEFAULT_ASSET_BASE_URL): ReaderAssetUrls {
  const root = (base || DEFAULT_ASSET_BASE_URL).replace(/\/+$/, '')
  return {
    pdfWorker: `${root}/pdfjs/pdf.worker.min.mjs`,
    pdfCMaps: `${root}/pdfjs/cmaps/`,
    pdfStandardFonts: `${root}/pdfjs/standard_fonts/`,
    pdfWasm: `${root}/pdfjs/wasm/`,
    pdfIccs: `${root}/pdfjs/iccs/`,
    tesseractWorker: `${root}/tesseract/worker.min.js`,
    tesseractCore: `${root}/tesseract/core`,
    tesseractLang: `${root}/tesseract/lang`,
  }
}
