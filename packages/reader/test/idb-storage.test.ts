import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { createIdbStorage } from '../src/idb-storage.js'

describe('createIdbStorage', () => {
  it('stores texts and files by key', async () => {
    const storage = createIdbStorage({ dbName: 'reader-test' })
    expect(await storage.getText('ocr:b1:eng:1')).toBeNull()
    await storage.setText('ocr:b1:eng:1', 'hello')
    expect(await storage.getText('ocr:b1:eng:1')).toBe('hello')

    expect(await storage.getFile('b1')).toBeNull()
    await storage.putFile('b1', new Blob(['epub bytes']))
    const file = await storage.getFile('b1')
    expect(file).toBeInstanceOf(Blob)
    expect(await file!.text()).toBe('epub bytes')
    expect(await storage.listFiles()).toEqual(['b1'])
    await storage.deleteFile('b1')
    expect(await storage.getFile('b1')).toBeNull()
  })
})
