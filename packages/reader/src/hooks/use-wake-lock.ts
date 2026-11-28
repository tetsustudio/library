import { useEffect, useRef } from 'react'

/**
 * Mantiene la pantalla prendida mientras dure algo.
 *
 * Existe para el TTS: leyendo en voz alta nadie toca la pantalla, y el
 * teléfono la apaga a los 30 segundos. En una PWA instalada eso además suele
 * frenar la voz, así que no es solo que se ponga negra.
 *
 * Dos cosas que el API obliga a manejar y no son obvias:
 *
 *  - **El sistema suelta el lock solo.** Basta con que la pestaña pase a
 *    segundo plano — otra app, apagar la pantalla a mano, cambiar de pestaña —
 *    y el lock se libera sin avisar. Por eso hay que volver a pedirlo cuando
 *    la página vuelve a estar visible, o al volver de atender una llamada la
 *    lectura sigue con la pantalla apagándose de nuevo.
 *  - **`request()` rechaza si el documento no está visible**, y eso no es un
 *    error que valga la pena mostrar: es el caso normal de pedirlo mientras la
 *    pantalla ya se apagó. Se ignora y lo reintenta el listener de visibilidad.
 *
 * Sin soporte —Safari en iOS lo tiene recién desde la 16.4, y no está en
 * ningún navegador viejo— no hace nada. No hay fallback razonable: los trucos
 * de mantener un video invisible reproduciéndose gastan batería y algunos
 * navegadores ya los bloquean.
 */
export function useWakeLock(activo: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!activo) return
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    let cancelado = false

    const pedir = async () => {
      if (cancelado || document.visibilityState !== 'visible') return
      if (sentinelRef.current && !sentinelRef.current.released) return
      try {
        sentinelRef.current = await navigator.wakeLock.request('screen')
      } catch {
        // Rechaza si el documento no está visible o si el sistema lo niega
        // (ahorro de batería). El listener de abajo lo reintenta.
      }
    }

    const alVolver = () => {
      if (document.visibilityState === 'visible') void pedir()
    }

    void pedir()
    document.addEventListener('visibilitychange', alVolver)

    return () => {
      cancelado = true
      document.removeEventListener('visibilitychange', alVolver)
      // El release puede rechazar si el sentinel ya se solto solo.
      void sentinelRef.current?.release().catch(() => {})
      sentinelRef.current = null
    }
  }, [activo])
}
