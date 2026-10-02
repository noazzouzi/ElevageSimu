// Plans d'enclos démarrés : étapes du plan de fécondité, heure de démarrage et étape appliquée en
// jeu, pour afficher les heures de changement de jauges et les alarmes (page Enclos, accueil).
// La logique (heures absolues, prochain changement, décalage) est dans src/domain/paddockAssign.ts.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FertilityStep } from '../domain/fertility'
import { acknowledgeStep, nextSwitchOf, planProgress, type NextSwitch, type PlanProgress } from '../domain/paddockAssign'
import type { FuelTier, GaugeId, RulesetId } from '../domain/types'

/** Plan actif d'un enclos (sérialisable). */
export interface ActivePaddockPlan {
  paddockId: number
  /** Instant (ms) où la première étape a été appliquée en jeu. */
  startedAt: number
  tier: FuelTier
  withXp: boolean
  rulesetId: RulesetId
  almanaxDoubled: GaugeId | null
  /** Montures du lot (ids d'inventaire). */
  mountIds: string[]
  steps: FertilityStep[]
  totalSeconds: number
  /** Secondes après le démarrage où chaque monture devient féconde. */
  fecundAt: Record<string, number>
  /** Étape appliquée en jeu (0 au démarrage ; steps.length = plan terminé). */
  acknowledgedStepIndex: number
  /** Décalage cumulé (ms) quand un changement a été fait en avance ou en retard. */
  offsetMs: number
}

export type NewPaddockPlan = Omit<ActivePaddockPlan, 'acknowledgedStepIndex' | 'offsetMs'>

interface PaddockPlansStore {
  /** Clé = numéro d'enclos (1 … 6). */
  plans: Record<string, ActivePaddockPlan>
  /** Démarre (ou remplace) le plan d'un enclos : la première étape est supposée appliquée. */
  start: (plan: NewPaddockPlan) => void
  /**
   * Valide le changement de jauges suivant. `at` = heure réelle du changement (décale la suite du
   * plan) ; sans `at`, le changement est supposé fait à l'heure prévue.
   */
  advance: (paddockId: number, at?: number) => void
  stop: (paddockId: number) => void
  replaceAll: (plans: Record<string, ActivePaddockPlan>) => void
}

export const usePaddockPlans = create<PaddockPlansStore>()(
  persist(
    (set) => ({
      plans: {},
      start: (plan) =>
        set((s) => ({
          plans: {
            ...s.plans,
            [String(plan.paddockId)]: { ...plan, steps: plan.steps.map((st) => ({ ...st, consumed: { ...st.consumed } })), acknowledgedStepIndex: 0, offsetMs: 0 },
          },
        })),
      advance: (paddockId, at) =>
        set((s) => {
          const p = s.plans[String(paddockId)]
          if (!p) return s
          return { plans: { ...s.plans, [String(paddockId)]: { ...p, ...acknowledgeStep(p, at) } } }
        }),
      stop: (paddockId) =>
        set((s) => {
          const next = { ...s.plans }
          delete next[String(paddockId)]
          return { plans: next }
        }),
      replaceAll: (plans) => set({ plans }),
    }),
    { name: 'elevagesimu:paddockPlans', version: 1 },
  ),
)

/** État d'un plan à l'instant `now` : étape appliquée, étape prévue, prochain changement, retard. */
export function currentStep(plan: ActivePaddockPlan, now: number = Date.now()): PlanProgress {
  return planProgress(plan, now)
}

/** Heure (ms) du prochain changement de jauges (fin du plan comprise), ou null si terminé. */
export function nextSwitchAt(plan: ActivePaddockPlan): number | null {
  return nextSwitchOf(plan)?.at ?? null
}

/** Prochain changement détaillé (jauges à couper/activer, fenêtre de sérénité). */
export function nextSwitch(plan: ActivePaddockPlan): NextSwitch | null {
  return nextSwitchOf(plan)
}

/** Prochaine alarme parmi tous les plans actifs (la plus proche), ou null. */
export function nextAlarm(plans: Record<string, ActivePaddockPlan>): { paddockId: number; switch: NextSwitch } | null {
  let best: { paddockId: number; switch: NextSwitch } | null = null
  for (const p of Object.values(plans)) {
    const sw = nextSwitchOf(p)
    if (sw && (!best || sw.at < best.switch.at)) best = { paddockId: p.paddockId, switch: sw }
  }
  return best
}
