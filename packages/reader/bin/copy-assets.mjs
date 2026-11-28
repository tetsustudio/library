// Copies the files the reader loads at runtime into the app's public dir.
//
// Nothing of this may come from a CDN: a cross-origin worker needs extra CSP
// entries (glimpse's CSP blocked it once), and reading offline would break.
// Everything is served from the app's own origin.
//
//   pdfjs/pdf.worker.min.mjs  the legacy build: the modern one uses
//                             Promise.withResolvers(), missing before Safari 17.4
//   pdfjs/wasm/               image decoders (JBIG2: scanned PDFs, the ones OCR reads)
//   pdfjs/standard_fonts/     the 14 standard fonts when a PDF does not embed them
//   pdfjs/cmaps/              CJK encodings
//   pdfjs/iccs/               color profiles
//   tesseract/worker.min.js   tesseract.js worker (optional peer)
//   tesseract/core/           tesseract-core LSTM wasm builds (plain, simd, relaxed simd)
//   tesseract/lang/           <lang>.traineddata.gz from @tesseract.js-data/<lang>
import { cp, mkdir, rm, readdir, access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Directory of an installed package, looked up from the app first and then from this package. */
export function packageDir(name, fromDirs) {
  for (const from of fromDirs) {
    const require = createRequire(join(from, 'noop.js'))
    try {
      return dirname(require.resolve(`${name}/package.json`))
    } catch {
      try {
        let dir = dirname(require.resolve(name))
        while (dir !== dirname(dir)) {
          if (dir.endsWith(join('node_modules', name))) return dir
          dir = dirname(dir)
        }
      } catch {
        // try the next base
      }
    }
  }
  return null
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * @param {{ dest: string, langs?: string[], cwd?: string, log?: (msg: string) => void }} options
 * @returns {Promise<{ dest: string, copied: string[], skipped: string[] }>}
 */
export async function copyReaderAssets({ dest, langs = ['eng', 'spa'], cwd = process.cwd(), log = console.log }) {
  const out = resolve(cwd, dest)
  const bases = [cwd, here]
  const copied = []
  const skipped = []

  const pdfjs = packageDir('pdfjs-dist', bases)
  if (!pdfjs) throw new Error('pdfjs-dist is not installed. Install the peer dependency: npm i pdfjs-dist@6.2.108')

  await rm(join(out, 'pdfjs'), { recursive: true, force: true })
  await mkdir(join(out, 'pdfjs'), { recursive: true })
  await cp(join(pdfjs, 'legacy/build/pdf.worker.min.mjs'), join(out, 'pdfjs/pdf.worker.min.mjs'))
  copied.push('pdfjs/pdf.worker.min.mjs')
  for (const dir of ['wasm', 'standard_fonts', 'cmaps', 'iccs']) {
    await cp(join(pdfjs, dir), join(out, 'pdfjs', dir), { recursive: true })
    copied.push(`pdfjs/${dir}/`)
  }

  const tesseract = packageDir('tesseract.js', bases)
  if (!tesseract) {
    skipped.push('tesseract (tesseract.js not installed: OCR stays off)')
  } else {
    await rm(join(out, 'tesseract'), { recursive: true, force: true })
    await mkdir(join(out, 'tesseract/core'), { recursive: true })
    await mkdir(join(out, 'tesseract/lang'), { recursive: true })
    await cp(join(tesseract, 'dist/worker.min.js'), join(out, 'tesseract/worker.min.js'))
    copied.push('tesseract/worker.min.js')

    const core = packageDir('tesseract.js-core', [tesseract, ...bases])
    if (!core) throw new Error('tesseract.js-core was not found next to tesseract.js')
    for (const file of await readdir(core)) {
      // The reader runs tesseract in LSTM-only mode (its default): only these are loaded.
      if (/^tesseract-core(-simd|-relaxedsimd)?-lstm\.wasm\.js$/.test(file)) {
        await cp(join(core, file), join(out, 'tesseract/core', file))
        copied.push(`tesseract/core/${file}`)
      }
    }

    for (const lang of langs) {
      const data = packageDir(`@tesseract.js-data/${lang}`, bases)
      const file = data && join(data, '4.0.0_best_int', `${lang}.traineddata.gz`)
      if (!file || !(await exists(file))) {
        skipped.push(`tesseract/lang/${lang} (install @tesseract.js-data/${lang})`)
        continue
      }
      await cp(file, join(out, 'tesseract/lang', `${lang}.traineddata.gz`))
      copied.push(`tesseract/lang/${lang}.traineddata.gz`)
    }
  }

  log(`reader assets: ${out}`)
  for (const s of skipped) log(`  skipped ${s}`)
  return { dest: out, copied, skipped }
}
