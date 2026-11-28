/**
 * Where the editor keeps per-device preferences: spellcheck settings, ignored
 * words and collapsed headings. None of it is document content, so it never
 * goes into the Y.Doc. The default reads and writes `window.localStorage`.
 */
export interface EditorStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** `window.localStorage`, silent when there is no window or storage is blocked or full. */
export const localStorageAdapter: EditorStorage = {
  get(key) {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Blocked or full: the preference lives in memory until the next load.
    }
  },
};

/** An in-memory storage, for tests and server rendering. */
export function createMemoryStorage(initial: Record<string, string> = {}): EditorStorage {
  const values = new Map(Object.entries(initial));
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
  };
}

/** Prefix for every storage key the editor writes. */
export const DEFAULT_STORAGE_PREFIX = 'tetsu-editor';

export function readJsonList(storage: EditorStorage, key: string): string[] {
  try {
    const raw = storage.get(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
