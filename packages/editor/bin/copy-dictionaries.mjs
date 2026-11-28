#!/usr/bin/env node
// Usage: tetsu-editor-dictionaries [destDir]   (default: public/editor-dictionaries)
// Copies the Hunspell dictionaries the spellchecker loads into the app's public
// folder: <destDir>/<language>/index.aff, index.dic and the dictionary license.
// Run it from the app's root, e.g. in "postinstall".
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// language folder -> npm package (dependencies of @tetsustudio/editor)
const DICTIONARIES = [
  { language: 'es', pkg: 'dictionary-es' },
  { language: 'es-ar', pkg: 'dictionary-es-ar' },
  { language: 'en', pkg: 'dictionary-en' },
];

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: tetsu-editor-dictionaries [destDir]   (default: public/editor-dictionaries)');
  process.exit(0);
}
const dest = resolve(args[0] ?? 'public/editor-dictionaries');

let failed = 0;
for (const { language, pkg } of DICTIONARIES) {
  let sourceDir;
  try {
    // The packages export only index.js; their files sit next to it.
    sourceDir = dirname(fileURLToPath(import.meta.resolve(pkg)));
  } catch {
    console.error(`[tetsu-editor] ${pkg} not found, skipping ${language}`);
    failed++;
    continue;
  }
  const target = join(dest, language);
  mkdirSync(target, { recursive: true });
  for (const file of ['index.aff', 'index.dic', 'license']) {
    const from = join(sourceDir, file);
    if (existsSync(from)) copyFileSync(from, join(target, file === 'license' ? 'LICENSE' : file));
  }
  console.log(`[tetsu-editor] ${language} -> ${target}`);
}
process.exit(failed === DICTIONARIES.length ? 1 : 0);
