/**
 * The pure half of the position engine (see hooks/use-reading-progress.ts):
 * the local cache format and the rule that decides where a book opens. Kept
 * apart so it can be tested without a browser.
 */

/** Below this difference two positions are the same reading, not a conflict. */
export const CONFLICT_MIN_DIFF_PERCENT = 5

export interface ProgressPosition {
  cfi: string
  percent: number
}

export interface CacheEntry {
  cfi: string
  percent: number
  /** Server timestamp of the last confirmed write. Not a local clock. */
  serverAt: string | null
  /** There are local changes the server has not confirmed yet. */
  dirty: boolean
  device: string
}

export interface RemoteProgress {
  cfi: string
  percent: number
  time: string | null
  deviceId: string | null
}

export type InitialDecision =
  | { kind: 'use-remote'; position: ProgressPosition; time: string | null }
  | { kind: 'keep-local'; position: ProgressPosition; push: boolean }
  | { kind: 'conflict'; local: ProgressPosition & { time: string | null }; remote: ProgressPosition & { time: string | null } }

/** Minimal Storage surface, so tests can pass a Map-backed fake. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/** PDF positions are `page:N`. Anything else opens on page 1. */
export function pageFromLocator(locator: string | null | undefined): number {
  if (!locator || !locator.startsWith('page:')) return 1
  return parseInt(locator.slice('page:'.length), 10) || 1
}

export function pageLocator(page: number): string {
  return `page:${page}`
}

/** Percent read when `page` of `numPages` is on screen. */
export function pagePercent(page: number, numPages: number): number {
  if (numPages <= 0) return 0
  return clampPercent((page / numPages) * 100)
}

export function progressCacheKey(prefix: string, bookId: string): string {
  return `${prefix}:progress:${bookId}`
}

export function serializeCacheEntry(entry: CacheEntry): string {
  return JSON.stringify(entry)
}

/** Parses a cache entry, or null when it is missing or not one. */
export function parseCacheEntry(raw: string | null): CacheEntry | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<CacheEntry> | null
    if (!value || typeof value !== 'object') return null
    return {
      cfi: typeof value.cfi === 'string' ? value.cfi : '',
      percent: clampPercent(typeof value.percent === 'number' ? value.percent : 0),
      serverAt: typeof value.serverAt === 'string' ? value.serverAt : null,
      dirty: value.dirty === true,
      device: typeof value.device === 'string' ? value.device : '',
    }
  } catch {
    return null
  }
}

export function readCache(store: KeyValueStore, prefix: string, bookId: string): CacheEntry | null {
  try {
    return parseCacheEntry(store.getItem(progressCacheKey(prefix, bookId)))
  } catch {
    return null
  }
}

export function writeCache(store: KeyValueStore, prefix: string, bookId: string, entry: CacheEntry): void {
  try {
    store.setItem(progressCacheKey(prefix, bookId), serializeCacheEntry(entry))
  } catch {
    // Without the cache the reader still works; it just cannot resume offline.
  }
}

export function getDeviceId(store: KeyValueStore, prefix: string, makeId: () => string = () => crypto.randomUUID()): string {
  const key = `${prefix}-device-id`
  try {
    let id = store.getItem(key)
    if (!id) {
      id = makeId()
      store.setItem(key, id)
    }
    return id
  } catch {
    return 'unknown-device'
  }
}

/**
 * Decides which position to open the book with. Pure on purpose: it is the
 * rule that used to go wrong, and the one worth testing without a browser.
 *
 * The times it compares are ALWAYS server timestamps, never client clocks:
 * `cached.serverAt` is the timestamp of the last write the server confirmed
 * from this device.
 */
export function decideInitialPosition(
  cached: CacheEntry | null,
  remote: RemoteProgress | null,
  deviceId: string
): InitialDecision {
  if (!remote) {
    if (!cached) return { kind: 'keep-local', position: { cfi: '', percent: 0 }, push: false }
    // Nothing remote but something local: it has to be pushed.
    return { kind: 'keep-local', position: { cfi: cached.cfi, percent: cached.percent }, push: true }
  }

  const remotePos = { cfi: remote.cfi, percent: remote.percent }

  if (!cached) {
    return { kind: 'use-remote', position: remotePos, time: remote.time }
  }

  const remoteIsNewer =
    !!remote.time &&
    (!cached.serverAt || new Date(remote.time).getTime() > new Date(cached.serverAt).getTime())
  const otherDevice = !!remote.deviceId && remote.deviceId !== deviceId
  const diverged =
    remote.cfi !== cached.cfi &&
    Math.abs(remote.percent - cached.percent) >= CONFLICT_MIN_DIFF_PERCENT

  // Only a conflict when ANOTHER device moved on while we had unsent work, and
  // the difference shows.
  if (remoteIsNewer && otherDevice && cached.dirty && diverged) {
    return {
      kind: 'conflict',
      local: { cfi: cached.cfi, percent: cached.percent, time: cached.serverAt },
      remote: { ...remotePos, time: remote.time },
    }
  }

  if (remoteIsNewer && !cached.dirty) {
    return { kind: 'use-remote', position: remotePos, time: remote.time }
  }

  return {
    kind: 'keep-local',
    position: { cfi: cached.cfi, percent: cached.percent },
    push: cached.dirty,
  }
}
