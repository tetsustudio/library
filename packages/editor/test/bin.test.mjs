// tetsu-editor-dictionaries copies every dictionary (with its license) into
// the app's public folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/copy-dictionaries.mjs', import.meta.url));

test('copies aff, dic and LICENSE for es, es-ar and en into the given folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ted-dicts-'));
  try {
    const out = execFileSync(process.execPath, [bin, join(dir, 'public/dicts')], { encoding: 'utf8' });
    for (const lang of ['es', 'es-ar', 'en']) {
      for (const file of ['index.aff', 'index.dic', 'LICENSE']) {
        const path = join(dir, 'public/dicts', lang, file);
        assert.ok(existsSync(path), path);
        assert.ok(statSync(path).size > 0, path);
      }
      assert.match(out, new RegExp(`${lang} ->`));
    }
    assert.match(readFileSync(join(dir, 'public/dicts/es/LICENSE'), 'utf8'), /MPL|GPL|LGPL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('defaults to public/editor-dictionaries under the current directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ted-dicts-'));
  try {
    execFileSync(process.execPath, [bin], { cwd: dir, encoding: 'utf8' });
    assert.ok(existsSync(join(dir, 'public/editor-dictionaries/en/index.dic')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--help prints the usage and copies nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ted-dicts-'));
  try {
    assert.match(execFileSync(process.execPath, [bin, '--help'], { cwd: dir, encoding: 'utf8' }), /Usage: tetsu-editor-dictionaries/);
    assert.equal(existsSync(join(dir, 'public')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
