// Jour de jeu courant (AAAA-MM-JJ, heure de Paris) qui se met à jour tout seul : à minuit (heure du
// serveur), au retour sur l'onglet et quand la fenêtre reprend le focus (après une mise en veille, un
// minuteur peut avoir pris du retard). À utiliser à la place d'un `useMemo(() => isoDay(Date.now()), [])`
// figé au montage de la page.
import { useEffect, useState } from 'react'
import { nextServerDayStart, serverDay } from '../domain/almanax'

/** Délai maximal d'un setTimeout (≈ 24,8 jours). */
const MAX_DELAY = 2 ** 31 - 1

export function useServerDay(): string {
  const [day, setDay] = useState(() => serverDay(Date.now()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer)
      const now = Date.now()
      // +1 s : on se réveille juste après minuit, jamais juste avant.
      timer = setTimeout(refresh, Math.min(MAX_DELAY, Math.max(1_000, nextServerDayStart(now) - now + 1_000)))
    }
    const refresh = () => {
      setDay(serverDay(Date.now()))
      schedule()
    }
    const onVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') refresh()
    }
    schedule()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])
  return day
}
