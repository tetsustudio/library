import { openDB, type IDBPDatabase } from 'idb'
import type { ReaderStorage } from './types.js'

/**
 * IndexedDB implementation of `ReaderStorage`, kept out of the main entry so
 * the reader itself does not depend on `idb` (an optional peer dependency).
 *
 * Two stores: `files` (book blobs by bookId) and `texts` (OCR results).
 * `putFile`/`deleteFile` are for the app's "save offline" action.
 */
export interface IdbReaderStorage extends ReaderStorage {
  getText(key: string): Promise<string | null>
  setText(key: string, value: string): Promise<void>
  putFile(bookId: string, file: Blob): Promise<void>
  deleteFile(bookId: string): Promise<void>
  listFiles(): Promise<string[]>
}

export interface IdbStorageOptions {
  /** Database name. Default `tetsu-reader`. */
  dbName?: string
}

const FILES = 'files'
const TEXTS = 'texts'

export function createIdbStorage({ dbName = 'tetsu-reader' }: IdbStorageOptions = {}): IdbReaderStorage {
  let db: Promise<IDBPDatabase> | null = null
  const open = () => {
    if (!db) {
      db = openDB(dbName, 1, {
        upgrade(database) {
          if (!database.objectStoreNames.contains(FILES)) database.createObjectStore(FILES)
          if (!database.objectStoreNames.contains(TEXTS)) database.createObjectStore(TEXTS)
        },
      })
      db.catch(() => {
        db = null
      })
    }
    return db
  }

  return {
    async getFile(bookId) {
      const value = await (await open()).get(FILES, bookId)
      return value instanceof Blob ? value : null
    },
    async putFile(bookId, file) {
      await (await open()).put(FILES, file, bookId)
    },
    async deleteFile(bookId) {
      await (await open()).delete(FILES, bookId)
    },
    async listFiles() {
      return (await (await open()).getAllKeys(FILES)).map(String)
    },
    async getText(key) {
      const value = await (await open()).get(TEXTS, key)
      return typeof value === 'string' ? value : null
    },
    async setText(key, value) {
      await (await open()).put(TEXTS, value, key)
    },
  }
}
