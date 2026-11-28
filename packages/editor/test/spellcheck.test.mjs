// Spellcheck: tokenizer, ranking, and the controller over the storage adapter
// (settings, ignored words, dictionary loading from dictionaryBaseUrl).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accentOnlyFixes, rankSuggestions, tokenizeText, trailingWord } from '../dist/spellcheck/tokenize.js';
import { createSpellcheck, getSpellcheck } from '../dist/spellcheck/controller.js';
import { createMemoryStorage } from '../dist/storage.js';
import { buildSpellcheckDecorations } from '../dist/plugins/spellcheck.js';
import { getMarkdownCodec } from '../dist/server.js';

test('tokenizeText splits on digits and punctuation, keeps accents, inner apostrophes and hyphens', () => {
  assert.deepEqual(
    tokenizeText('Él comió 3 pañuelos, rock-and-roll y don’t.').map((t) => t.text),
    ['Él', 'comió', 'pañuelos', 'rock-and-roll', 'y', 'don’t'],
  );
  const [first] = tokenizeText('  hola');
  assert.deepEqual(first, { text: 'hola', start: 2, end: 6 });
  assert.deepEqual(tokenizeText('123 !!'), []);
});

test('accent-only fixes rank first and trailingWord reads the finished word', () => {
  assert.deepEqual(accentOnlyFixes('dia', ['ria', 'día', 'diag']), ['día']);
  assert.deepEqual(rankSuggestions('dia', ['ria', 'diag', 'dial', 'día']), ['día', 'ria', 'diag', 'dial']);
  assert.equal(trailingWord('el dia'), 'dia');
  assert.equal(trailingWord('fin.'), null);
});

test('settings default to enabled, es and no auto-accent, and persist under the prefix', () => {
  const storage = createMemoryStorage();
  const spell = createSpellcheck({ storage, storagePrefix: 'forge' });
  assert.deepEqual(spell.getSettings(), { enabled: true, language: 'es', autoAccent: false });
  let notified = 0;
  const off = spell.subscribe(() => notified++);
  spell.setEnabled(false);
  spell.setLanguage('en');
  spell.setAutoAccent(true);
  assert.equal(notified, 3);
  off();
  spell.setEnabled(true);
  assert.equal(notified, 3);
  assert.equal(storage.get('forge-spellcheck-language'), 'en');
  assert.equal(storage.get('forge-spellcheck-auto-accent'), 'true');
  assert.deepEqual(createSpellcheck({ storage, storagePrefix: 'forge' }).getSettings(), { enabled: true, language: 'en', autoAccent: true });
});

test('an unknown stored language falls back to the default language', () => {
  const storage = createMemoryStorage({ 'tetsu-editor-spellcheck-language': 'klingon' });
  assert.equal(createSpellcheck({ storage, defaultLanguage: 'en' }).getSettings().language, 'en');
});

test('ignored words are stored per language, once, and survive corrupt storage', () => {
  const storage = createMemoryStorage({ 'tetsu-editor-spellcheck-ignored-en': '{not json' });
  const spell = createSpellcheck({ storage });
  assert.deepEqual(spell.getIgnoredWords('en'), []);
  spell.addPersonalWord('es', 'Tetsu');
  spell.addPersonalWord('es', 'Tetsu');
  spell.addPersonalWord('es', 'Milkdown');
  assert.deepEqual(spell.getIgnoredWords('es'), ['Tetsu', 'Milkdown']);
  assert.deepEqual(spell.getIgnoredWords('es-ar'), []);
  spell.removePersonalWord('es', 'Tetsu');
  assert.deepEqual(JSON.parse(storage.get('tetsu-editor-spellcheck-ignored-es')), ['Milkdown']);
});

test('load() fetches <dictionaryBaseUrl>/<lang>/index.{aff,dic} once and replays ignored words', async () => {
  const storage = createMemoryStorage();
  const urls = [];
  const added = [];
  const checker = { correct: () => true, suggest: () => [], add: (w) => added.push(w), remove: () => {} };
  const spell = createSpellcheck({
    storage,
    dictionaryBaseUrl: 'https://cdn.example/dicts/',
    loadFile: async (url) => (urls.push(url), url),
    createChecker: (aff, dic) => (assert.ok(aff.endsWith('.aff') && dic.endsWith('.dic')), checker),
  });
  spell.addPersonalWord('es-ar', 'chabón');
  assert.equal(spell.getCached('es-ar'), null);
  const [a, b] = await Promise.all([spell.load('es-ar'), spell.load('es-ar')]);
  assert.equal(a, b);
  assert.deepEqual(urls, ['https://cdn.example/dicts/es-ar/index.aff', 'https://cdn.example/dicts/es-ar/index.dic']);
  assert.deepEqual(added, ['chabón']);
  assert.equal(spell.getCached('es-ar'), checker);
  spell.addPersonalWord('es-ar', 'boludo');
  assert.deepEqual(added, ['chabón', 'boludo']);
});

test('a failed dictionary load can be retried', async () => {
  let attempts = 0;
  const spell = createSpellcheck({
    storage: createMemoryStorage(),
    loadFile: async () => {
      attempts++;
      if (attempts <= 2) throw new Error('404');
      return '';
    },
    createChecker: () => ({ correct: () => true, suggest: () => [], add() {}, remove() {} }),
  });
  await assert.rejects(spell.load('en'));
  await spell.load('en');
  assert.ok(attempts >= 3);
});

test('getSpellcheck shares one controller per storage, prefix and URL', () => {
  const storage = createMemoryStorage();
  assert.equal(getSpellcheck({ storage }), getSpellcheck({ storage }));
  assert.notEqual(getSpellcheck({ storage }), getSpellcheck({ storage, storagePrefix: 'other' }));
});

test('the shipped Spanish dictionary flags "dia" and ranks "día" first; decorations skip code', async () => {
  const dir = dirname(fileURLToPath(import.meta.resolve('dictionary-es')));
  const spell = createSpellcheck({ storage: createMemoryStorage(), loadFile: async (url) => readFileSync(join(dir, url.split('/').pop()), 'utf8') });
  const checker = await spell.load('es');
  assert.equal(checker.correct('día'), true);
  assert.equal(checker.correct('dia'), false);
  assert.equal(rankSuggestions('dia', checker.suggest('dia'))[0], 'día');

  const codec = await getMarkdownCodec();
  const doc = codec.parse('Un dia `dia`\n\n```\ndia\n```\n');
  const found = buildSpellcheckDecorations(doc, checker).find();
  assert.equal(found.length, 1);
  assert.equal(doc.textBetween(found[0].from, found[0].to), 'dia');
});
