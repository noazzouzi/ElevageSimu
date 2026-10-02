// Résultats de la dernière comparaison des modes de rentabilité, propres au profil ouvert
// (« elevagesimu:p:<profil>:modes », préférence de page : suit le profil et sa sauvegarde).
// Écrits par la page Modes de rentabilité, lus par l'accueil, le plan et le conseiller (stratégie du mode
// actif, routine du jour, bénéfice attendu) sans relancer la simulation (≈ 15 s).
// Donnée de confort : illisible ou d'une autre version → ignorée (recalcul proposé), jamais bloquante.
import { create } from 'zustand'
import { sanitizePinnedModePlan, sanitizeStoredModeResults, type PinnedModePlan, type StoredModeResults } from '../domain/modes'
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

// ---------- Plan d'investissement suivi (« Suivre ce plan », revue UX2-04) ----------

/** Base de la clé du plan suivi (préférence du profil, non recalculable : choix du joueur). */
export const MODE_PLAN_BASE = 'mode-plan'

function planKey(): string {
  return profileKey(MODE_PLAN_BASE)
}

/** Plan d'investissement suivi par le profil ouvert (null : aucun ou illisible). */
export function loadModePlan(): PinnedModePlan | null {
  try {
    const raw = storage()?.getItem(planKey())
    return raw ? sanitizePinnedModePlan(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

interface ModePlanStore {
  plan: PinnedModePlan | null
  /** Suit ce plan (enregistré) ; false si l'écriture a échoué (plan gardé pour cette visite). */
  pin: (p: PinnedModePlan) => boolean
  /** Ne plus suivre de plan : la stratégie revient à celle de la comparaison des modes. */
  unpin: () => void
}

export const useModePlan = create<ModePlanStore>()((set) => ({
  plan: loadModePlan(),
  pin: (p) => {
    set({ plan: p })
    // Sans son résultat si le stockage refuse (la stratégie seule suffit au conseiller).
    return safeWriteText(planKey(), JSON.stringify(p, (_k, v: unknown) => (typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v))) || safeWriteText(planKey(), JSON.stringify({ ...p, outcome: null }))
  },
  unpin: () => {
    try {
      storage()?.removeItem(planKey())
    } catch {
      // stockage indisponible : rien à effacer
    }
    set({ plan: null })
  },
}))

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function')
  window.addEventListener('storage', (e) => {
    if (e.key === planKey()) useModePlan.setState({ plan: loadModePlan() })
  })
