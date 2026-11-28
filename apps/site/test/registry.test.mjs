import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

const BASE = 'https://library.tetsustudio.com/r/'
const items = readdirSync('public/r').filter((f) => f.endsWith('.json') && f !== 'registry.json')

test('registry ships the 16 basics plus the theme', () => {
  const names = items.map((f) => f.replace('.json', '')).sort()
  assert.equal(names.length, 17)
  for (const n of ['button', 'dialog', 'select', 'table', 'toast', 'tetsu-theme']) assert.ok(names.includes(n), n)
})

test('every ui item embeds its source and only pinned npm deps', () => {
  for (const f of items) {
    const item = JSON.parse(readFileSync(`public/r/${f}`, 'utf8'))
    if (item.type !== 'registry:ui') continue
    assert.ok(item.files[0].content.length > 100, `${f} content`)
    for (const d of item.dependencies ?? []) assert.match(d, /@[\^\d]/, `${f} pins ${d}`)
  }
})

test('sibling dependencies point at items that exist', () => {
  for (const f of items) {
    const item = JSON.parse(readFileSync(`public/r/${f}`, 'utf8'))
    for (const dep of item.registryDependencies ?? []) {
      assert.ok(dep.startsWith(BASE), dep)
      assert.ok(items.includes(dep.slice(BASE.length)), `${f} -> ${dep}`)
    }
  }
})

test('registry sources never import app code beyond sibling ui', () => {
  for (const f of readdirSync('registry/ui')) {
    const src = readFileSync(`registry/ui/${f}`, 'utf8')
    for (const [, spec] of src.matchAll(/from '(@\/[^']+)'/g)) {
      assert.match(spec, /^@\/components\/ui\//, `${f}: ${spec}`)
    }
  }
})
