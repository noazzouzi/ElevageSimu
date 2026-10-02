// Avancement du plan d'élevage : cases cochées des checklists (phase, objectif, routines, lignes de
// conseils) et conseils de l'accueil marqués « fait », avec leur horodatage.
// Les clés des cases sont construites avec `checklistKey(scope, …)` (src/domain/advisor.ts) :
//   phase:P2:actions:3, objectif:94:captures, routine:2026-10-02:matin:1, semaine:2026-W40:2,
//   item:<id du conseil>:<id de la ligne>.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { persistOptions, syncAcrossTabs } from './persistence'
import { STORE_KEYS } from './profiles'
import { isPlainObject, registerStoreSchema, type Sanitized } from './schema'

/** Durée de conservation des conseils « faits » et des cases de routine (au-delà : purgés). */
export const PLAN_PROGRESS_RETENTION_MS = 30 * 86_400_000

interface PlanProgressState {
  /** Cases cochées : clé → instant (ms) où elle a été cochée. */
  checked: Record<string, number>
  /** Conseils marqués « fait » : id du conseil → instant (ms). */
  done: Record<string, number>
}

interface PlanProgressStore extends PlanProgressState {
  /** Coche ou décoche une case. */
  setChecked: (key: string, value: boolean, at?: number) => void
  toggle: (key: string, at?: number) => void
  /** Marque un conseil comme fait (il disparaît de la liste jusqu'à ce que la situation change). */
  markDone: (id: string, at?: number) => void
  /** Annule « fait ». */
  undoDone: (id: string) => void
  /** Décoche toutes les cases dont la clé commence par `prefix` (ex. « phase:P2: »). */
  clearPrefix: (prefix: string) => void
  /** Supprime les conseils faits et les cases de routine/lignes de conseil plus anciens que `before`. */
  prune: (before: number) => void
  replaceAll: (s: PlanProgressState) => void
}

const EPHEMERAL = /^(routine|semaine|item):/

export const usePlanProgress = create<PlanProgressStore>()(
  persist(
    (set) => ({
      checked: {},
      done: {},
      setChecked: (key, value, at) =>
        set((s) => {
          const checked = { ...s.checked }
          if (value) checked[key] = at ?? Date.now()
          else delete checked[key]
          return { checked }
        }),
      toggle: (key, at) =>
        set((s) => {
          const checked = { ...s.checked }
          if (checked[key] !== undefined) delete checked[key]
          else checked[key] = at ?? Date.now()
          return { checked }
        }),
      markDone: (id, at) => set((s) => ({ done: { ...s.done, [id]: at ?? Date.now() } })),
      undoDone: (id) =>
        set((s) => {
          const done = { ...s.done }
          delete done[id]
          return { done }
        }),
      clearPrefix: (prefix) => set((s) => ({ checked: Object.fromEntries(Object.entries(s.checked).filter(([k]) => !k.startsWith(prefix))) })),
      prune: (before) =>
        set((s) => ({
          done: Object.fromEntries(Object.entries(s.done).filter(([, t]) => t >= before)),
          checked: Object.fromEntries(Object.entries(s.checked).filter(([k, t]) => !EPHEMERAL.test(k) || t >= before)),
        })),
      replaceAll: (p) => set({ checked: { ...p.checked }, done: { ...p.done } }),
    }),
    persistOptions<PlanProgressStore, PlanProgressState>({
      name: STORE_KEYS.planProgress,
      sanitize: sanitizePlanProgress,
      partialize: (s) => ({ checked: s.checked, done: s.done }),
    }),
  ),
)
syncAcrossTabs(usePlanProgress)

/**
 * Normalisation de l'avancement lu (stockage, autre onglet, sauvegarde) : seules les entrées
 * « clé → instant (ms) » valides sont gardées ; jamais d'exception (R3/R4).
 */
export function sanitizePlanProgress(raw: unknown): Sanitized<PlanProgressState> {
  const issues: string[] = []
  const clean = (v: unknown, label: string): Record<string, number> => {
    if (v === undefined) return {}
    if (!isPlainObject(v)) {
      issues.push(`${label} illisibles écartés`)
      return {}
    }
    const out: Record<string, number> = {}
    let dropped = 0
    for (const [k, t] of Object.entries(v)) {
      if (typeof t === 'number' && Number.isFinite(t) && t >= 0) out[k] = t
      else dropped++
    }
    if (dropped) issues.push(`${dropped} ${label} invalide${dropped > 1 ? 's' : ''} écarté${dropped > 1 ? 's' : ''}`)
    return out
  }
  const src = isPlainObject(raw) ? raw : {}
  return { state: { checked: clean(src.checked, 'cases cochées'), done: clean(src.done, 'conseils faits') }, issues }
}

/** La case `key` est-elle cochée ? */
export function isChecked(state: Pick<PlanProgressState, 'checked'>, key: string): boolean {
  return state.checked[key] !== undefined
}

// Import d'une sauvegarde : même normalisation qu'au chargement (schema.normalizeStoreValue).
registerStoreSchema('planProgress', { sanitize: (raw) => sanitizePlanProgress(raw) as unknown as Sanitized<Record<string, unknown>> })
