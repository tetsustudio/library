import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..')
const bin = join(pkg, 'bin/reader-assets.mjs')
const scratch = mkdtempSync(join(tmpdir(), 'tetsu-reader-assets-'))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('tetsu-reader-assets', () => {
  it('copies the pdf.js and tesseract runtime files', () => {
    const dest = join(scratch, 'public/reader-assets')
    const out = execFileSync(process.execPath, [bin, dest, '--lang', 'eng,spa'], { cwd: pkg, encoding: 'utf8' })

    for (const file of [
      'pdfjs/pdf.worker.min.mjs',
      'pdfjs/wasm',
      'pdfjs/standard_fonts',
      'pdfjs/cmaps',
      'pdfjs/iccs',
      'tesseract/worker.min.js',
      'tesseract/lang/eng.traineddata.gz',
    ]) {
      expect(existsSync(join(dest, file)), file).toBe(true)
    }
    expect(readdirSync(join(dest, 'pdfjs/cmaps')).length).toBeGreaterThan(100)
    expect(readdirSync(join(dest, 'tesseract/core')).sort()).toEqual([
      'tesseract-core-lstm.wasm.js',
      'tesseract-core-relaxedsimd-lstm.wasm.js',
      'tesseract-core-simd-lstm.wasm.js',
    ])
    // spa is not a dev dependency here: it is reported, not fatal.
    expect(existsSync(join(dest, 'tesseract/lang/spa.traineddata.gz'))).toBe(false)
    expect(out).toContain('skipped tesseract/lang/spa (install @tesseract.js-data/spa)')
  })

  it('defaults to public/reader-assets under the current directory', () => {
    const app = join(scratch, 'app')
    mkdirSync(app)
    // The app has no node_modules of its own: packages resolve from the reader package.
    execFileSync(process.execPath, [bin, '--lang', 'eng'], { cwd: app, encoding: 'utf8' })
    expect(existsSync(join(app, 'public/reader-assets/pdfjs/pdf.worker.min.mjs'))).toBe(true)
  })

  it('prints usage', () => {
    expect(execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' })).toContain('Usage: tetsu-reader-assets')
  })
})

