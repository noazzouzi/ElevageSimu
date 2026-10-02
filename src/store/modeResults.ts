// Résultats de la dernière comparaison des modes de rentabilité, propres au profil ouvert
// (« elevagesimu:p:<profil>:modes », préférence de page : suit le profil et sa sauvegarde).
// Écrits par la page Modes de rentabilité, lus par l'accueil, le plan et le conseiller (stratégie du mode
// actif, routine du jour, bénéfice attendu) sans relancer la simulation (≈ 5 s).
// Donnée de confort : illisible ou d'une autre version → ignorée (recalcul proposé), jamais bloquante.
import { create } from 'zustand'
import { sanitizeStoredModeResults, type StoredModeResults } from '../domain/modes'
import { safeWriteText } from './persistence'
import { profileKey } from './profiles'

/** Base de la clé (préférence de page du profil). */
export const MODE_RESULTS_BASE = 'modes'

function storageKey(): string {
  return profileKey(MODE_RESULTS_BASE)
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Lit les résultats enregistrés du profil ouvert (null : absents ou illisibles). */
export function loadModeResults(): StoredModeResults | null {
  try {
    const raw = storage()?.getItem(storageKey())
    return raw ? sanitizeStoredModeResults(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

/** JSON compact : nombres non entiers à 6 chiffres significatifs (≈ −30 % de place). */
export function compactModeResultsJson(r: StoredModeResults): string {
  return JSON.stringify(r, (_k, v: unknown) => (typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v))
}

interface ModeResultsStore {
  results: StoredModeResults | null
  /** Enregistre (et publie) les résultats ; false si l'écriture a échoué (résultats gardés en mémoire). */
  save: (r: StoredModeResults) => boolean
  clear: () => void
}

export const useModeResults = create<ModeResultsStore>()((set) => ({
  results: loadModeResults(),
  save: (r) => {
    set({ results: r })
    return safeWriteText(storageKey(), compactModeResultsJson(r))
  },
  clear: () => {
    try {
      storage()?.removeItem(storageKey())
    } catch {
      // stockage indisponible : rien à effacer
    }
    set({ results: null })
  },
}))

// Plusieurs onglets : un calcul fait ailleurs est repris ici.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function')
  window.addEventListener('storage', (e) => {
    if (e.key === storageKey()) useModeResults.setState({ results: loadModeResults() })
  })
