#!/usr/bin/env node
// Usage: tetsu-reader-assets [destDir] [--lang eng,spa]
// Copies pdf.js and tesseract runtime files into destDir (default public/reader-assets).
// Run it from the app's root, usually as a postinstall script.
import { copyReaderAssets } from './copy-assets.mjs'

const args = process.argv.slice(2)
let dest = 'public/reader-assets'
let langs = ['eng', 'spa']
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--help' || arg === '-h') {
    console.log('Usage: tetsu-reader-assets [destDir] [--lang eng,spa]')
    process.exit(0)
  } else if (arg === '--lang') {
    langs = (args[++i] ?? '').split(',').map((l) => l.trim()).filter(Boolean)
  } else if (arg.startsWith('--lang=')) {
    langs = arg.slice('--lang='.length).split(',').map((l) => l.trim()).filter(Boolean)
  } else {
    dest = arg
  }
}

try {
  await copyReaderAssets({ dest, langs })
} catch (err) {
  console.error(`tetsu-reader-assets: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
