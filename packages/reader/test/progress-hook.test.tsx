// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useReadingProgress } from '../src/hooks/use-reading-progress.js'
import { progressCacheKey } from '../src/lib/progress.js'

const PREFIX = 'test-reader'

beforeEach(() => localStorage.clear())

describe('useReadingProgress', () => {
  it('sends the position through onProgress with the exit reason and marks it synced', async () => {
    const onProgress = vi.fn(async () => ({ updatedAt: '2026-11-27T10:00:00.000Z' }))
    const { result } = renderHook(() => useReadingProgress({ bookId: 'b1', initialProgress: null, onProgress, storagePrefix: PREFIX }))
    await waitFor(() => expect(result.current.initialResolved).toBe(true))

    act(() => {
      result.current.setLocationsReady(true)
      result.current.report('page:3', 30)
    })
    expect(result.current.syncStatus).toBe('pending')
    await act(() => result.current.flush('exit'))

    expect(onProgress).toHaveBeenCalledWith({ bookId: 'b1', locator: 'page:3', percent: 30, deviceId: expect.any(String), reason: 'exit' })
    expect(result.current.syncStatus).toBe('synced')
    expect(JSON.parse(localStorage.getItem(progressCacheKey(PREFIX, 'b1'))!)).toMatchObject({ cfi: 'page:3', dirty: false, serverAt: '2026-11-27T10:00:00.000Z' })
  })

  it('ignores positions until the reader can measure', async () => {
    const onProgress = vi.fn()
    const { result } = renderHook(() => useReadingProgress({ bookId: 'b1', onProgress, storagePrefix: PREFIX }))
    act(() => result.current.report('page:9', 90))
    await act(() => result.current.flush('exit'))
    expect(onProgress).not.toHaveBeenCalled()
    expect(localStorage.getItem(progressCacheKey(PREFIX, 'b1'))).toBeNull()
  })

  it('keeps a failed write dirty on the device and reports the error', async () => {
    const onProgress = vi.fn(async () => { throw new Error('down') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useReadingProgress({ bookId: 'b1', onProgress, storagePrefix: PREFIX }))
    act(() => {
      result.current.setLocationsReady(true)
      result.current.report('page:4', 40)
    })
    await act(() => result.current.flush('exit'))
    expect(result.current.syncStatus).toBe('error')
    expect(JSON.parse(localStorage.getItem(progressCacheKey(PREFIX, 'b1'))!)).toMatchObject({ cfi: 'page:4', dirty: true })
  })

  it('opens at the stored position when the device has none', async () => {
    const { result } = renderHook(() =>
      useReadingProgress({ bookId: 'b1', initialProgress: { locator: 'page:7', percent: 70, updatedAt: '2026-11-27T09:00:00Z' }, onProgress: vi.fn(), storagePrefix: PREFIX })
    )
    await waitFor(() => expect(result.current.initialResolved).toBe(true))
    expect(result.current.initial).toEqual({ cfi: 'page:7', percent: 70 })
    expect(result.current.conflict).toBeNull()
  })

  it('asks when another device moved on while this one had unsent work', async () => {
    localStorage.setItem(progressCacheKey(PREFIX, 'b1'), JSON.stringify({ cfi: 'page:2', percent: 20, serverAt: '2026-11-27T08:00:00Z', dirty: true, device: 'me' }))
    const { result } = renderHook(() =>
      useReadingProgress({
        bookId: 'b1',
        initialProgress: { locator: 'page:8', percent: 80, updatedAt: '2026-11-27T09:00:00Z', deviceId: 'phone' },
        onProgress: vi.fn(),
        storagePrefix: PREFIX,
      })
    )
    await waitFor(() => expect(result.current.conflict).not.toBeNull())
    let chosen: unknown
    act(() => { chosen = result.current.resolveConflict(true) })
    expect(chosen).toEqual({ cfi: 'page:8', percent: 80 })
  })

  it('hands pending work over without waiting when the reader unmounts', async () => {
    const onProgress = vi.fn()
    const { result, unmount } = renderHook(() => useReadingProgress({ bookId: 'b1', onProgress, storagePrefix: PREFIX }))
    act(() => {
      result.current.setLocationsReady(true)
      result.current.report('page:5', 50)
    })
    unmount()
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ locator: 'page:5', reason: 'hidden' }))
  })

  it('works without a backend: the device cache is the store', async () => {
    const { result } = renderHook(() => useReadingProgress({ bookId: 'b1', storagePrefix: PREFIX }))
    act(() => {
      result.current.setLocationsReady(true)
      result.current.report('page:6', 60)
    })
    await act(() => result.current.flush('exit'))
    expect(result.current.syncStatus).toBe('synced')
    expect(JSON.parse(localStorage.getItem(progressCacheKey(PREFIX, 'b1'))!)).toMatchObject({ cfi: 'page:6', dirty: false })
  })
})
