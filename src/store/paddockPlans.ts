// Plans d'enclos démarrés : étapes du plan de fécondité, heure de démarrage et étape appliquée en
// jeu, pour afficher les heures de changement de jauges et les alarmes (page Enclos, accueil, alarmes
// globales de src/ui/alarms.tsx). La logique (heures absolues, prochain changement, décalage) est dans
// src/domain/paddockAssign.ts ; l'état « en retard / dépassé » dans src/domain/paddockPlanStatus.ts.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { GAUGE_IDS, MAX_PADDOCKS } from '../domain/constants'
import type { FertilityStep } from '../domain/fertility'
import { validateActiveGauges } from '../domain/paddock'
import { acknowledgeStep, nextSwitchOf, planProgress, type NextSwitch, type PlanProgress } from '../domain/paddockAssign'
import { RULESETS } from '../domain/rules'
import type { FuelTier, GaugeId, RulesetId } from '../domain/types'
import { persistOptions } from './persistence'
import { STORE_KEYS } from './profiles'
import { isPlainObject, registerStoreSchema, type Sanitized } from './schema'

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
  /** Palier entretenu par jauge (`FertilityPlan.tiers`) : projection des montures et carburant. Facultatif (anciens plans). */
  tiers?: Partial<Record<GaugeId, FuelTier>>
  /** Niveaux de jauges relevés au démarrage (dialogue « Démarrer ce plan »). */
  levelsAtStart?: Partial<Record<GaugeId, number>>
  /** Alarmes déjà notifiées (`alarmKey`), pour ne pas les répéter (rechargement, changement de page). */
  notified?: string[]
}

export type NewPaddockPlan = Omit<ActivePaddockPlan, 'acknowledgedStepIndex' | 'offsetMs' | 'notified'>

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
  /** Note des alarmes comme notifiées (clés `alarmKey`). */
  markNotified: (paddockId: number, keys: string[]) => void
  replaceAll: (plans: Record<string, ActivePaddockPlan>) => void
}

/** Clé d'une alarme : enclos, étape visée, heure prévue (change si le plan est décalé) et nature. */
export function alarmKey(paddockId: number, next: Pick<NextSwitch, 'index' | 'at'>, kind: AlarmKind): string {
  return `${paddockId}:${next.index}:${next.at}:${kind}`
}

/** `due` = heure du changement atteinte ; `late` = fin de la fenêtre de changement (sérénité) dépassée. */
export type AlarmKind = 'due' | 'late'

/** Garde les clés notifiées qui concernent encore une étape à venir (index ≥ étape validée + 1). */
function pruneNotified(keys: string[] | undefined, ack: number): string[] {
  return (keys ?? []).filter((k) => Number(k.split(':')[1]) > ack)
}

export const usePaddockPlans = create<PaddockPlansStore>()(
  persist(
    (set) => ({
      plans: {},
      start: (plan) =>
        set((s) => ({
          plans: {
            ...s.plans,
            [String(plan.paddockId)]: {
              ...plan,
              steps: plan.steps.map((st) => ({ ...st, consumed: { ...st.consumed } })),
              acknowledgedStepIndex: 0,
              offsetMs: 0,
              notified: [],
            },
          },
        })),
      advance: (paddockId, at) =>
        set((s) => {
          const p = s.plans[String(paddockId)]
          if (!p) return s
          const next = acknowledgeStep(p, at)
          return { plans: { ...s.plans, [String(paddockId)]: { ...p, ...next, notified: pruneNotified(p.notified, next.acknowledgedStepIndex) } } }
        }),
      stop: (paddockId) =>
        set((s) => {
          const next = { ...s.plans }
          delete next[String(paddockId)]
          return { plans: next }
        }),
      markNotified: (paddockId, keys) =>
        set((s) => {
          const p = s.plans[String(paddockId)]
          if (!p || keys.length === 0) return s
          const notified = [...new Set([...(p.notified ?? []), ...keys])].slice(-50)
          return { plans: { ...s.plans, [String(paddockId)]: { ...p, notified } } }
        }),
      replaceAll: (plans) => set({ plans: sanitizePaddockPlans({ plans }).state.plans }),
    }),
    persistOptions<PaddockPlansStore, { plans: Record<string, ActivePaddockPlan> }>({
      name: STORE_KEYS.paddockPlans,
      sanitize: sanitizePaddockPlans,
      partialize: (s) => ({ plans: s.plans }),
    }),
  ),
)

/** État d'un plan à l'instant `now` : étape appliquée, étape prévue, prochain changement, retard. */
export function currentStep(plan: ActivePaddockPlan, now: number = Date.now()): PlanProgress {
  return planProgress(plan, now)
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

export interface PendingAlarm {
  paddockId: number
  kind: AlarmKind
  key: string
  next: NextSwitch
}

/**
 * Alarmes à notifier à `now` (changement dû, ou fenêtre de sérénité dépassée) et pas encore notifiées
 * (`plan.notified`). Une seule par plan : la fenêtre dépassée remplace le changement dû.
 */
export function pendingAlarms(plans: Record<string, ActivePaddockPlan>, now: number): PendingAlarm[] {
  const out: PendingAlarm[] = []
  for (const p of Object.values(plans)) {
    const next = nextSwitchOf(p)
    if (!next || now < next.at) continue
    const notified = new Set(p.notified ?? [])
    const late = next.latest !== null && now > next.latest
    const kind: AlarmKind = late ? 'late' : 'due'
    const key = alarmKey(p.paddockId, next, kind)
    if (notified.has(key)) continue
    // Fenêtre dépassée alors que le changement dû n'avait pas été notifié (application fermée) : une seule alarme.
    out.push({ paddockId: p.paddockId, kind, key, next })
  }
  return out.sort((a, b) => a.next.at - b.next.at)
}

/** Prochaine heure (ms) où une alarme deviendra à notifier (changement ou fin de fenêtre), ou null. */
export function nextAlarmWake(plans: Record<string, ActivePaddockPlan>, now: number): number | null {
  let best: number | null = null
  for (const p of Object.values(plans)) {
    const next = nextSwitchOf(p)
    if (!next) continue
    for (const t of [next.at, next.latest !== null ? next.latest + 1 : null]) if (t !== null && t > now && (best === null || t < best)) best = t
  }
  return best
}

// ---------- Lecture normalisée (données persistées, sauvegarde importée) ----------

// Fonctions (hissées) et non constantes : la réhydratation appelle la normalisation pendant `create()`.
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}
function isGauge(v: unknown): v is GaugeId {
  return typeof v === 'string' && (GAUGE_IDS as string[]).includes(v)
}
function isTier(v: unknown): v is FuelTier {
  return v === 1 || v === 2 || v === 3 || v === 4
}

function gaugeNumbers(v: unknown): Partial<Record<GaugeId, number>> {
  const out: Partial<Record<GaugeId, number>> = {}
  if (isPlainObject(v)) for (const [g, x] of Object.entries(v)) if (isGauge(g) && isNum(x)) out[g] = x
  return out
}

function sanitizeStep(v: unknown): FertilityStep | null {
  if (!isPlainObject(v) || !Array.isArray(v.gauges) || !v.gauges.every(isGauge) || validateActiveGauges(v.gauges) !== null) return null
  if (!isNum(v.startSeconds) || v.startSeconds < 0 || !isNum(v.durationSeconds) || v.durationSeconds < 0) return null
  const step: FertilityStep = {
    gauges: [...v.gauges],
    startSeconds: v.startSeconds,
    durationSeconds: v.durationSeconds,
    purpose: typeof v.purpose === 'string' ? v.purpose : '',
    consumed: gaugeNumbers(v.consumed),
  }
  const w = v.switchWindow
  if (isPlainObject(w) && isNum(w.earliestSeconds) && isNum(w.latestSeconds)) step.switchWindow = { earliestSeconds: w.earliestSeconds, latestSeconds: w.latestSeconds }
  return step
}

function sanitizePlan(v: unknown, key: string): ActivePaddockPlan | null {
  if (!isPlainObject(v)) return null
  const id = v.paddockId
  if (!isNum(id) || !Number.isInteger(id) || id < 1 || id > MAX_PADDOCKS || String(id) !== key) return null
  if (!isNum(v.startedAt) || !Array.isArray(v.steps)) return null
  const steps = v.steps.map(sanitizeStep)
  if (steps.some((s) => s === null)) return null
  const okSteps = steps as FertilityStep[]
  const fecundAt: Record<string, number> = {}
  if (isPlainObject(v.fecundAt)) for (const [m, t] of Object.entries(v.fecundAt)) if (isNum(t)) fecundAt[m] = t
  const ack = isNum(v.acknowledgedStepIndex) ? Math.max(0, Math.min(okSteps.length, Math.round(v.acknowledgedStepIndex))) : 0
  const plan: ActivePaddockPlan = {
    paddockId: id,
    startedAt: v.startedAt,
    tier: isTier(v.tier) ? v.tier : 2,
    withXp: v.withXp === true,
    rulesetId: typeof v.rulesetId === 'string' && Object.hasOwn(RULESETS, v.rulesetId) ? (v.rulesetId as RulesetId) : '3.6',
    almanaxDoubled: isGauge(v.almanaxDoubled) ? v.almanaxDoubled : null,
    mountIds: Array.isArray(v.mountIds) ? v.mountIds.filter((x): x is string => typeof x === 'string') : [],
    steps: okSteps,
    totalSeconds: isNum(v.totalSeconds) ? v.totalSeconds : okSteps.reduce((s, st) => Math.max(s, st.startSeconds + st.durationSeconds), 0),
    fecundAt,
    acknowledgedStepIndex: ack,
    offsetMs: isNum(v.offsetMs) ? v.offsetMs : 0,
  }
  if (isPlainObject(v.tiers)) {
    const tiers: Partial<Record<GaugeId, FuelTier>> = {}
    for (const [g, t] of Object.entries(v.tiers)) if (isGauge(g) && isTier(t)) tiers[g] = t
    plan.tiers = tiers
  }
  if (isPlainObject(v.levelsAtStart)) plan.levelsAtStart = gaugeNumbers(v.levelsAtStart)
  if (Array.isArray(v.notified)) plan.notified = v.notified.filter((x): x is string => typeof x === 'string').slice(-50)
  return plan
}

/** Normalise les plans persistés : un plan illisible est écarté (et signalé), jamais un plantage de page. */
export function sanitizePaddockPlans(raw: unknown): Sanitized<{ plans: Record<string, ActivePaddockPlan> }> {
  const issues: string[] = []
  const plans: Record<string, ActivePaddockPlan> = {}
  const src = isPlainObject(raw) && isPlainObject(raw.plans) ? raw.plans : null
  if (isPlainObject(raw) && raw.plans !== undefined && !src) issues.push('plans d’enclos illisibles écartés')
  let dropped = 0
  for (const [k, v] of Object.entries(src ?? {})) {
    const p = sanitizePlan(v, k)
    if (p) plans[k] = p
    else dropped++
  }
  if (dropped > 0) issues.push(`${dropped} plan${dropped > 1 ? 's' : ''} d’enclos illisible${dropped > 1 ? 's' : ''} écarté${dropped > 1 ? 's' : ''}`)
  return { state: { plans }, issues }
}

// Import d'une sauvegarde : même normalisation qu'au chargement (schema.normalizeStoreValue).
registerStoreSchema('paddockPlans', { sanitize: (raw) => sanitizePaddockPlans(raw) as unknown as Sanitized<Record<string, unknown>> })
