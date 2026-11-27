#!/usr/bin/env node
// Usage: tetsu-validate-theme <theme.css> <style-id>
// Exits 1 and lists the problems when the theme breaks the token contract.
import { readFileSync } from 'node:fs'
import { parseThemeCss, validateTheme } from '../dist/index.js'

const [file, styleId] = process.argv.slice(2)
if (!file || !styleId) {
  console.error('Usage: tetsu-validate-theme <theme.css> <style-id>')
  process.exit(2)
}
const problems = validateTheme(parseThemeCss(readFileSync(file, 'utf8'), styleId))
if (problems.length === 0) {
  console.log(`${styleId}: theme OK`)
} else {
  for (const p of problems) console.error(`${styleId} (${p.mode}): ${p.message}`)
  process.exit(1)
}
