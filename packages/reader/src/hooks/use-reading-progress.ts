'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clampPercent,
  decideInitialPosition,
  getDeviceId,
  readCache,
  writeCache,
  type KeyValueStore,
  type ProgressPosition,
} from '../lib/progress.js'
import type { InitialProgress, ProgressAck, ProgressReason, ReaderProgressEvent } from '../types.js'

export { decideInitialPosition } from '../lib/progress.js'
export type { ProgressPosition, InitialDecision, RemoteProgress, CacheEntry } from '../lib/progress.js'

/**
 * The position engine, one for EPUB and PDF (ported from glimpse, where it
 * talked to /api/progress; here the app persists through `onProgress`).
 *
 *  1. Nothing is queued until the reader says it can measure. In EPUB,
 *     `locations.generate()` runs after the first render, and until it ends
 *     the percent is the chapter's, not the book's.
 *  2. The client clock decides nothing. What is compared is the server
 *     timestamp of our last write against the stored one, plus a dirty flag.
 *  3. A conflict is only asked about when ANOTHER device wrote it and the
 *     difference is real.
 *  4. Closing sends `reason: 'hidden'` without waiting, so the app can use a
 *     keepalive request. What did not go through stays dirty in localStorage
 *     and is pushed the next time the book opens.
 *  5. Without `onProgress` the reader works locally: the cache is the store.
 */

const SYNC_INTERVAL_MS = 15_000

export type ProgressSyncStatus = 'synced' | 'syncing' | 'pending' | 'offline' | 'error'

export interface ProgressConflict {
  local: ProgressPosition & { time: string | null }
  remote: ProgressPosition & { time: string | null }
}

interface Options {
  bookId: string
  initialProgress?: InitialProgress | null
  onProgress?: (event: ReaderProgressEvent) => Promise<ProgressAck | void> | ProgressAck | void
  storagePrefix: string
}

function browserStore(): KeyValueStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

const memoryStore = (): KeyValueStore => {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

export function useReadingProgress({ bookId, initialProgress, onProgress, storagePrefix }: Options) {
  const [percent, setPercent] = useState(0)
  const [syncStatus, setSyncStatus] = useState<ProgressSyncStatus>('synced')
  const [lastSyncedTime, setLastSyncedTime] = useState<Date | null>(null)
  const [conflict, setConflict] = useState<ProgressConflict | null>(null)
  const [initial, setInitial] = useState<ProgressPosition | null>(null)
  const [initialResolved, setInitialResolved] = useState(false)

  const pendingRef = useRef<ProgressPosition | null>(null)
  const serverAtRef = useRef<string | null>(null)
  const locationsReadyRef = useRef(false)
  const storeRef = useRef<KeyValueStore | null>(null)
  if (!storeRef.current) storeRef.current = browserStore() ?? memoryStore()
  const store = storeRef.current
  const deviceIdRef = useRef<string>('')
  if (!deviceIdRef.current && typeof window !== 'undefined') {
    deviceIdRef.current = getDeviceId(store, storagePrefix)
  }

  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress

  /** Persists the position. Returns the server timestamp when the app gives one. */
  const persist = useCallback(
    async (snap: ProgressPosition, reason: ProgressReason): Promise<string | null> => {
      const send = onProgressRef.current
      if (!send) return new Date().toISOString()
      const ack = await send({ bookId, locator: snap.cfi, percent: snap.percent, deviceId: deviceIdRef.current, reason })
      return (ack && ack.updatedAt) || null
    },
    [bookId]
  )

  const flush = useCallback(
    async (reason: ProgressReason = 'interval') => {
      const snap = pendingRef.current
      if (!snap) return
      pendingRef.current = null

      try {
        setSyncStatus('syncing')
        const serverAt = await persist(snap, reason)
        serverAtRef.current = serverAt
        writeCache(store, storagePrefix, bookId, {
          cfi: snap.cfi,
          percent: snap.percent,
          serverAt,
          dirty: false,
          device: deviceIdRef.current,
        })
        setSyncStatus('synced')
        setLastSyncedTime(serverAt ? new Date(serverAt) : new Date())
      } catch (err) {
        console.error('Could not sync the reading position:', err)
        // Restore it only when nothing newer arrived meanwhile.
        if (!pendingRef.current) pendingRef.current = snap
        setSyncStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error')
      }
    },
    [persist, store, storagePrefix, bookId]
  )

  /** Called by the reader on every position change. */
  const report = useCallback(
    (cfi: string, nextPercent: number) => {
      // Rule 1: while the reader cannot measure, nothing is saved.
      if (!locationsReadyRef.current) return

      const clamped = clampPercent(nextPercent)
      setPercent(clamped)
      pendingRef.current = { cfi, percent: clamped }
      writeCache(store, storagePrefix, bookId, {
        cfi,
        percent: clamped,
        serverAt: serverAtRef.current,
        dirty: true,
        device: deviceIdRef.current,
      })
      setSyncStatus('pending')
    },
    [store, storagePrefix, bookId]
  )

  const setLocationsReady = useCallback((ready: boolean) => {
    locationsReadyRef.current = ready
  }, [])

  /** Closing: hand the position over without waiting (the page may be gone). */
  const flushOnUnload = useCallback(() => {
    const snap = pendingRef.current
    if (!snap) return
    const send = onProgressRef.current
    if (!send) {
      pendingRef.current = null
      writeCache(store, storagePrefix, bookId, {
        cfi: snap.cfi,
        percent: snap.percent,
        serverAt: new Date().toISOString(),
        dirty: false,
        device: deviceIdRef.current,
      })
      return
    }
    // The cache stays dirty: if this never arrives, the next open pushes it.
    pendingRef.current = null
    try {
      const result = send({ bookId, locator: snap.cfi, percent: snap.percent, deviceId: deviceIdRef.current, reason: 'hidden' })
      if (result && typeof (result as Promise<unknown>).catch === 'function') (result as Promise<unknown>).catch(() => {})
    } catch {
      // Best effort.
    }
  }, [store, storagePrefix, bookId])

  // ------------------------------------------------ initial resolution

  const initialRef = useRef(initialProgress)
  initialRef.current = initialProgress

  useEffect(() => {
    const cached = readCache(store, storagePrefix, bookId)
    if (cached) {
      serverAtRef.current = cached.serverAt
      setPercent(cached.percent)
      if (cached.serverAt) setLastSyncedTime(new Date(cached.serverAt))
      setInitial({ cfi: cached.cfi, percent: cached.percent })
    }

    const stored = initialRef.current
    const decision = decideInitialPosition(
      cached,
      stored
        ? {
            cfi: stored.locator || '',
            percent: clampPercent(stored.percent || 0),
            time: stored.updatedAt || null,
            deviceId: stored.deviceId || null,
          }
        : null,
      deviceIdRef.current
    )

    if (decision.kind === 'conflict') {
      setConflict({ local: decision.local, remote: decision.remote })
      setInitialResolved(true)
      return
    }

    if (decision.kind === 'use-remote') {
      serverAtRef.current = decision.time
      setPercent(decision.position.percent)
      if (decision.time) setLastSyncedTime(new Date(decision.time))
      writeCache(store, storagePrefix, bookId, {
        cfi: decision.position.cfi,
        percent: decision.position.percent,
        serverAt: decision.time,
        dirty: false,
        device: stored?.deviceId || '',
      })
      setInitial(decision.position)
    } else {
      // Something left unsent from an earlier session: retried on the next tick.
      if (decision.push && onProgressRef.current) pendingRef.current = decision.position
      if (!cached) setInitial(null)
    }
    setInitialResolved(true)
    // The stored progress only matters when the book opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, storagePrefix])

  // ------------------------------------------------ sync loop

  useEffect(() => {
    const interval = setInterval(() => {
      if (pendingRef.current) flush('interval')
    }, SYNC_INTERVAL_MS)

    const onHide = () => {
      if (document.visibilityState === 'hidden') flushOnUnload()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flushOnUnload)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flushOnUnload)
      flushOnUnload()
    }
  }, [flush, flushOnUnload])

  // Connection state shows right away, without waiting for an attempt to fail.
  useEffect(() => {
    const update = () => {
      if (!navigator.onLine) setSyncStatus('offline')
      else setSyncStatus(prev => (prev === 'offline' ? (pendingRef.current ? 'pending' : 'synced') : prev))
    }
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    if (!navigator.onLine) setSyncStatus('offline')
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const resolveConflict = useCallback(
    (useRemote: boolean): ProgressPosition | null => {
      if (!conflict) return null
      setConflict(null)

      if (useRemote) {
        serverAtRef.current = conflict.remote.time
        setPercent(conflict.remote.percent)
        writeCache(store, storagePrefix, bookId, {
          cfi: conflict.remote.cfi,
          percent: conflict.remote.percent,
          serverAt: conflict.remote.time,
          dirty: false,
          device: deviceIdRef.current,
        })
        return { cfi: conflict.remote.cfi, percent: conflict.remote.percent }
      }

      pendingRef.current = { cfi: conflict.local.cfi, percent: conflict.local.percent }
      flush('conflict')
      return null
    },
    [conflict, store, storagePrefix, bookId, flush]
  )

  return {
    percent,
    setPercent,
    syncStatus,
    lastSyncedTime,
    conflict,
    resolveConflict,
    initial,
    initialResolved,
    report,
    setLocationsReady,
    flush,
  }
}
