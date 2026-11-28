import { DEFAULT_STORAGE_PREFIX, localStorageAdapter, readJsonList, type EditorStorage } from '../storage.js';
import { SPELLCHECK_LANGUAGES, type SpellcheckLanguage, type SpellcheckPreferences } from './settings.js';

/** The part of an nspell instance the editor uses. */
export interface SpellChecker {
  correct(word: string): boolean;
  suggest(word: string): string[];
  add(word: string): unknown;
  remove(word: string): unknown;
}

export interface SpellcheckOptions {
  /** Where settings and ignored words live. Default: `localStorage`. */
  storage?: EditorStorage;
  /** Prefix of every storage key. Default: `tetsu-editor`. */
  storagePrefix?: string;
  /**
   * Public URL of the dictionaries folder, the one `tetsu-editor-dictionaries`
   * fills: `<base>/<language>/index.aff` and `index.dic`. Default: `/editor-dictionaries`.
   */
  dictionaryBaseUrl?: string;
  /** Language before the user picks one. Default: `es`. */
  defaultLanguage?: SpellcheckLanguage;
  /** Loads a dictionary file. Default: `fetch(url).then(r => r.text())`. */
  loadFile?: (url: string) => Promise<string>;
  /** Builds the checker. Default: `nspell`, imported on first use. */
  createChecker?: (aff: string, dic: string) => SpellChecker | Promise<SpellChecker>;
}

/**
 * One spellchecker shared by every editor and the settings panel that use it:
 * settings, ignored words, the dictionary cache and the change notifications
 * that make a running editor recheck as soon as a setting changes.
 */
export interface SpellcheckController {
  getSettings(): SpellcheckPreferences;
  setEnabled(enabled: boolean): void;
  setLanguage(language: SpellcheckLanguage): void;
  setAutoAccent(autoAccent: boolean): void;
  getIgnoredWords(language: SpellcheckLanguage): string[];
  /** Ignores a word from now on, also in the dictionary already loaded. */
  addPersonalWord(language: SpellcheckLanguage, word: string): void;
  removePersonalWord(language: SpellcheckLanguage, word: string): void;
  /** Loads (once per language) the dictionary, with the ignored words added. */
  load(language: SpellcheckLanguage): Promise<SpellChecker>;
  /** The dictionary when it already finished loading. */
  getCached(language: SpellcheckLanguage): SpellChecker | null;
  dictionaryUrls(language: SpellcheckLanguage): { aff: string; dic: string };
  /** Called after any setting or ignored-word change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

async function defaultLoadFile(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load spellcheck dictionary file: ${url}`);
  return response.text();
}

async function defaultCreateChecker(aff: string, dic: string): Promise<SpellChecker> {
  const { default: nspell } = await import('nspell');
  return nspell(aff, dic);
}

export function createSpellcheck(options: SpellcheckOptions = {}): SpellcheckController {
  const storage = options.storage ?? localStorageAdapter;
  const prefix = options.storagePrefix ?? DEFAULT_STORAGE_PREFIX;
  const base = (options.dictionaryBaseUrl ?? '/editor-dictionaries').replace(/\/+$/, '');
  const defaultLanguage = options.defaultLanguage ?? 'es';
  const loadFile = options.loadFile ?? defaultLoadFile;
  const createChecker = options.createChecker ?? defaultCreateChecker;

  const keys = {
    enabled: `${prefix}-spellcheck-enabled`,
    language: `${prefix}-spellcheck-language`,
    autoAccent: `${prefix}-spellcheck-auto-accent`,
    ignored: (language: SpellcheckLanguage) => `${prefix}-spellcheck-ignored-${language}`,
  };

  const loading = new Map<SpellcheckLanguage, Promise<SpellChecker>>();
  const cached = new Map<SpellcheckLanguage, SpellChecker>();
  // In-memory pub/sub: the browser `storage` event only fires in other tabs.
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  const controller: SpellcheckController = {
    getSettings() {
      const stored = storage.get(keys.language);
      const language = SPELLCHECK_LANGUAGES.includes(stored as SpellcheckLanguage) ? (stored as SpellcheckLanguage) : defaultLanguage;
      return {
        enabled: storage.get(keys.enabled) !== 'false',
        language,
        autoAccent: storage.get(keys.autoAccent) === 'true',
      };
    },
    setEnabled(enabled) {
      storage.set(keys.enabled, String(enabled));
      notify();
    },
    setLanguage(language) {
      storage.set(keys.language, language);
      notify();
    },
    setAutoAccent(autoAccent) {
      storage.set(keys.autoAccent, String(autoAccent));
      notify();
    },
    getIgnoredWords(language) {
      return readJsonList(storage, keys.ignored(language));
    },
    // The checker's own word list is the single source of truth while it runs:
    // correct()/suggest() respect the change with no second list to sync.
    addPersonalWord(language, word) {
      const words = controller.getIgnoredWords(language);
      if (!words.includes(word)) storage.set(keys.ignored(language), JSON.stringify([...words, word]));
      cached.get(language)?.add(word);
      notify();
    },
    removePersonalWord(language, word) {
      storage.set(keys.ignored(language), JSON.stringify(controller.getIgnoredWords(language).filter((w) => w !== word)));
      cached.get(language)?.remove(word);
      notify();
    },
    // Memoized per language: StrictMode and several mounted editors share one
    // in-flight download (about 1 MB) instead of each starting its own.
    load(language) {
      const existing = loading.get(language);
      if (existing) return existing;
      const promise = (async () => {
        const { aff, dic } = controller.dictionaryUrls(language);
        const [affText, dicText] = await Promise.all([loadFile(aff), loadFile(dic)]);
        const checker = await createChecker(affText, dicText);
        for (const word of controller.getIgnoredWords(language)) checker.add(word);
        cached.set(language, checker);
        return checker;
      })();
      // A failed download can be retried the next time.
      promise.catch(() => loading.delete(language));
      loading.set(language, promise);
      return promise;
    },
    getCached(language) {
      return cached.get(language) ?? null;
    },
    dictionaryUrls(language) {
      return { aff: `${base}/${language}/index.aff`, dic: `${base}/${language}/index.dic` };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return controller;
}

const shared = new WeakMap<EditorStorage, Map<string, SpellcheckController>>();

/**
 * The controller for these options, shared with every other caller that passes
 * the same storage, prefix and dictionary URL. That is how the editor and a
 * separate `SpellcheckSettings` panel talk to each other without wiring.
 */
export function getSpellcheck(options: Pick<SpellcheckOptions, 'storage' | 'storagePrefix' | 'dictionaryBaseUrl'> = {}): SpellcheckController {
  const storage = options.storage ?? localStorageAdapter;
  const key = `${options.storagePrefix ?? DEFAULT_STORAGE_PREFIX}|${options.dictionaryBaseUrl ?? ''}`;
  let byKey = shared.get(storage);
  if (!byKey) shared.set(storage, (byKey = new Map()));
  let controller = byKey.get(key);
  if (!controller) byKey.set(key, (controller = createSpellcheck({ ...options, storage })));
  return controller;
}
