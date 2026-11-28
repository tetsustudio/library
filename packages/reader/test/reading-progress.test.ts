import { describe, it, expect } from 'vitest'
import { decideInitialPosition } from '../src/lib/progress.js'

/**
 * La decision de con que posicion abrir un libro. Es la regla que mas se
 * equivocaba antes de la fase 2, y la que produce el sintoma que se sentia
 * como "la sincronizacion esta rara".
 */

const DEVICE = 'este-dispositivo'
const OTRO = 'otro-dispositivo'

const cache = (over: Partial<Parameters<typeof decideInitialPosition>[0] & object> = {}) => ({
  cfi: 'epubcfi(/6/4!/4/2/2)',
  percent: 30,
  serverAt: '2026-08-20T10:00:00.000Z',
  dirty: false,
  device: DEVICE,
  ...over,
}) as any

const remote = (over: Partial<Parameters<typeof decideInitialPosition>[1] & object> = {}) => ({
  cfi: 'epubcfi(/6/8!/4/2/2)',
  percent: 55,
  time: '2026-08-20T11:00:00.000Z',
  deviceId: OTRO,
  ...over,
}) as any

describe('decideInitialPosition', () => {
  it('sin cache ni remoto, arranca de cero', () => {
    const d = decideInitialPosition(null, null, DEVICE)
    expect(d.kind).toBe('keep-local')
    if (d.kind === 'keep-local') {
      expect(d.position.percent).toBe(0)
      expect(d.push).toBe(false)
    }
  })

  it('con cache y sin remoto, sube lo local', () => {
    const d = decideInitialPosition(cache(), null, DEVICE)
    expect(d.kind).toBe('keep-local')
    if (d.kind === 'keep-local') expect(d.push).toBe(true)
  })

  it('sin cache, usa lo remoto', () => {
    const d = decideInitialPosition(null, remote(), DEVICE)
    expect(d.kind).toBe('use-remote')
    if (d.kind === 'use-remote') expect(d.position.percent).toBe(55)
  })

  it('remoto mas nuevo y nada sin mandar: se alinea sin preguntar', () => {
    const d = decideInitialPosition(cache({ dirty: false }), remote(), DEVICE)
    expect(d.kind).toBe('use-remote')
  })

  it('remoto mas viejo: se queda con lo local y lo empuja', () => {
    const d = decideInitialPosition(
      cache({ serverAt: '2026-08-20T12:00:00.000Z', dirty: true }),
      remote({ time: '2026-08-20T11:00:00.000Z' }),
      DEVICE
    )
    expect(d.kind).toBe('keep-local')
    if (d.kind === 'keep-local') expect(d.push).toBe(true)
  })

  it('otro dispositivo avanzo mientras teniamos cambios sin mandar: pregunta', () => {
    const d = decideInitialPosition(cache({ dirty: true }), remote(), DEVICE)
    expect(d.kind).toBe('conflict')
    if (d.kind === 'conflict') {
      expect(d.local.percent).toBe(30)
      expect(d.remote.percent).toBe(55)
    }
  })

  it('NO pregunta si el avance remoto lo escribio este mismo dispositivo', () => {
    const d = decideInitialPosition(cache({ dirty: true }), remote({ deviceId: DEVICE }), DEVICE)
    expect(d.kind).not.toBe('conflict')
  })

  it('NO pregunta por diferencias chicas: menos de 5% es la misma sesion', () => {
    const d = decideInitialPosition(
      cache({ dirty: true, percent: 52 }),
      remote({ percent: 55 }),
      DEVICE
    )
    expect(d.kind).not.toBe('conflict')
  })

  it('NO pregunta si no habia nada sin mandar, aunque cambie mucho', () => {
    const d = decideInitialPosition(cache({ dirty: false, percent: 5 }), remote({ percent: 90 }), DEVICE)
    expect(d.kind).toBe('use-remote')
  })

  it('el reloj del cliente no participa: compara sellos del servidor', () => {
    // cached.serverAt es lo que confirmo la base, no la hora del dispositivo.
    // Un dispositivo con el reloj adelantado no puede ganar por eso solo.
    const d = decideInitialPosition(
      cache({ serverAt: '2026-08-20T10:00:00.000Z', dirty: false }),
      remote({ time: '2026-08-20T10:00:01.000Z' }),
      DEVICE
    )
    expect(d.kind).toBe('use-remote')
  })

  it('cache sin sello de servidor todavia: lo remoto gana si no hay nada sin mandar', () => {
    const d = decideInitialPosition(cache({ serverAt: null, dirty: false }), remote(), DEVICE)
    expect(d.kind).toBe('use-remote')
  })
})
