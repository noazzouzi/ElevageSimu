// Suivi d'un plan d'enclos démarré, au-delà des heures du plan (paddockAssign.ts) :
// - état du plan à un instant : en cours, changement dû, fenêtre dépassée, plan DÉPASSÉ (changement
//   manqué pendant une poussée de sérénité : la suite ne vaut plus, il faut relever les sérénités et
//   recalculer), fin non validée, terminé ;
// - rendement d'un plan : combien de montures chaque jauge de statistique nourrit réellement, tick par
//   tick (une jauge consomme autant pour 1 ou 10 montures éligibles) ;
// - état à enregistrer dans l'inventaire à la fin (ou à l'arrêt) d'un plan, depuis la projection des
//   montures (projection.ts) : sérénité, statistiques, niveau, rangement à l'étable ;
// - consommation restante d'un plan démarré, et valeur en kamas de points de jauge.
// Module pur : aucun React, aucun store.
import { formatDuration } from '../lib/format'
import { GAUGE_LABELS, MOUNT_MAX_LEVEL, MOUNT_STAT_MAX, PADDOCK_SLOTS } from './constants'
import { almanaxScheduleFrom, gaugeTiers, isSerenityGauge, type FertilityStep } from './fertility'
import type { GaugePointCost } from './fuel'
import { effectiveFertility } from './mounts'
import { canBenefit, isFecund, simulatePaddock, validateActiveGauges, type SimMount } from './paddock'
import { planProgress, stepTimes, type PlanProgress, type PlanSchedule } from './paddockAssign'
import type { Ruleset } from './rules'
import type { FuelTier, GaugeId, Mount } from './types'
import { mountLevelFromXp, mountXpForLevel } from './xp'

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR')

// ---------- État d'un plan démarré ----------

/**
 * - `running` : rien à faire avant le prochain changement ;
 * - `due` : l'heure du prochain changement est passée (le faire) ;
 * - `late` : la fin de la fenêtre de changement (poussée de sérénité) est dépassée, depuis peu ;
 * - `stale` : changement manqué depuis longtemps pendant une poussée de sérénité : les montures ont pu
 *   sortir de la zone visée, la suite du plan ne vaut plus (relever les sérénités, recalculer) ;
 * - `end-overdue` : fin du plan passée depuis plus d'une heure sans validation (tout couper, appliquer au lot) ;
 * - `finished` : toutes les étapes validées.
 */
export type PlanState = 'running' | 'due' | 'late' | 'stale' | 'end-overdue' | 'finished'

/** Retard minimal (ms) après lequel une poussée de sérénité manquée rend le plan dépassé. */
export const STALE_AFTER_MS = 30 * 60_000
/** Fin du plan non validée depuis plus de ce délai (ms) : `end-overdue`. */
export const END_OVERDUE_MS = 60 * 60_000

export interface PlanStatus {
  state: PlanState
  progress: PlanProgress
  /** Retard (ms) sur l'heure prévue du prochain changement (0 s'il n'est pas dû). */
  lateMs: number
  /** L'étape en cours pousse la sérénité (Baffeur ou Caresseur). */
  serenityPush: boolean
  /** Heure (ms) à partir de laquelle le plan est dépassé si le changement n'est pas fait (null : jamais). */
  staleAt: number | null
  /** Explication en français (états `stale` et `end-overdue`). */
  reason: string | null
}

/**
 * État d'un plan démarré à `now`. Un changement en retard n'invalide le plan que pendant une poussée de
 * sérénité (seules Baffeur et Caresseur déplacent la sérénité) : au-delà de la fenêtre de changement
 * + max(30 min, 2 × largeur de la fenêtre) — ou 30 min après l'heure prévue sans fenêtre —, le plan est
 * `stale`. Une étape de statistique en retard ne coûte que du temps (« Fait maintenant » décale la suite).
 */
export function planStatus(s: PlanSchedule, now: number): PlanStatus {
  const progress = planProgress(s, now)
  const next = progress.next
  const cur = progress.step
  const serenityPush = cur ? cur.gauges.some(isSerenityGauge) : false
  if (progress.finished || !next) return { state: 'finished', progress, lateMs: 0, serenityPush: false, staleAt: null, reason: null }
  const lateMs = Math.max(0, now - next.at)
  if (next.final) {
    const overdueAt = next.at + END_OVERDUE_MS
    if (now > overdueAt)
      return {
        state: 'end-overdue',
        progress,
        lateMs,
        serenityPush,
        staleAt: null,
        reason: `Fin du plan prévue il y a ${formatDuration(lateMs / 1000, { long: true })}, non validée : coupez toutes les jauges et enregistrez l'état du lot.`,
      }
    return { state: progress.late ? 'late' : progress.due ? 'due' : 'running', progress, lateMs, serenityPush, staleAt: null, reason: null }
  }
  let staleAt: number | null = null
  if (serenityPush) {
    if (next.latest !== null && next.earliest !== null) staleAt = next.latest + Math.max(STALE_AFTER_MS, 2 * (next.latest - next.earliest))
    else staleAt = next.at + STALE_AFTER_MS
  }
  if (staleAt !== null && now > staleAt) {
    const g = cur!.gauges.filter(isSerenityGauge).map((x) => GAUGE_LABELS[x]).join(' et ')
    return {
      state: 'stale',
      progress,
      lateMs,
      serenityPush,
      staleAt,
      reason: `Changement prévu il y a ${formatDuration(lateMs / 1000, { long: true })}, non fait pendant une poussée de sérénité (${g}) : si la jauge a continué de tourner, des montures sont sorties de la zone visée et la suite du plan ne vaut plus.`,
    }
  }
  return { state: progress.late ? 'late' : progress.due ? 'due' : 'running', progress, lateMs, serenityPush, staleAt, reason: null }
}

// ---------- Rendement (montures nourries par jauge) ----------

/** Jauges de statistiques (la fécondité) : le rendement « maximal » ne concerne qu'elles. */
export const STAT_GAUGES: GaugeId[] = ['foudroyeur', 'abreuvoir', 'dragofesse']

export interface GaugeYield {
  gauge: GaugeId
  /** Points consommés (ticks où au moins une monture en profite). */
  consumed: number
  /** Montures nourries en moyenne, pondérée par la consommation (0 … 10). */
  averageFed: number
  /** `averageFed / 10` : part du carburant qui nourrit une monture. */
  yield: number
  /** Points qui nourrissent des places vides (ou des montures qui n'en ont plus besoin) : `consumed × (1 − yield)`. */
  lostPoints: number
  /** Étapes où la jauge nourrit moins de 10 montures : index d'étape, nombre minimal et maximal nourri. */
  partialSteps: { stepIndex: number; minFed: number; maxFed: number }[]
}

export interface PlanYield {
  byGauge: Partial<Record<GaugeId, GaugeYield>>
  /** Chaque jauge de statistique nourrit 10 montures à chaque tick où elle consomme. */
  full: boolean
  /** Résumé des pertes, une phrase par jauge de statistique (vide si `full`). */
  warnings: string[]
}

export interface YieldPlanInput {
  steps: FertilityStep[]
  /** Palier par jauge du plan ; à défaut `tier` (sérénité au palier 1). */
  tiers?: Partial<Record<GaugeId, FuelTier>>
  tier?: FuelTier
}

/**
 * Rejoue un plan tick par tick (jauges entretenues aux paliers du plan, chaque étape sur sa durée) et
 * compte, pour chaque jauge, les montures qui en profitent : une jauge consomme autant pour 1 ou
 * 10 montures éligibles, donc chaque place vide (ou monture déjà pleine) est du carburant perdu.
 * `mounts` = montures du lot au début du plan (compléments XP compris, vus « pleins »).
 */
export function planYield(plan: YieldPlanInput, mounts: readonly SimMount[], opts: { rules: Ruleset; startMs?: number; almanax?: boolean }): PlanYield {
  const tiers = { ...gaugeTiers({ tier: plan.tier ?? 2 }), ...plan.tiers }
  const acc = new Map<GaugeId, { consumed: number; fed: number; partial: Map<number, { min: number; max: number }> }>()
  let sims: SimMount[] = mounts.map((m) => ({ ...m }))
  plan.steps.forEach((st, i) => {
    const maxSeconds = Math.floor(st.durationSeconds / 10) * 10
    if (maxSeconds < 10 || st.gauges.length === 0 || validateActiveGauges(st.gauges) !== null) return
    const count = (state: readonly SimMount[]) => {
      for (const g of st.gauges) {
        const who = state.filter((m) => canBenefit(g, m)).length
        if (who === 0) continue
        const rate = opts.rules.gaugeRatePerTick[tiers[g]]
        const a = acc.get(g) ?? { consumed: 0, fed: 0, partial: new Map() }
        a.consumed += rate
        a.fed += rate * Math.min(who, PADDOCK_SLOTS)
        if (who < PADDOCK_SLOTS) {
          const p = a.partial.get(i)
          a.partial.set(i, p ? { min: Math.min(p.min, who), max: Math.max(p.max, who) } : { min: who, max: who })
        }
        acc.set(g, a)
      }
    }
    count(sims) // premier tick de l'étape
    const maintainTier: Partial<Record<GaugeId, FuelTier>> = {}
    for (const g of st.gauges) maintainTier[g] = tiers[g]
    sims = simulatePaddock({
      gauges: { baffeur: 0, caresseur: 0, foudroyeur: 0, abreuvoir: 0, dragofesse: 0, mangeoire: 0 },
      active: st.gauges,
      mounts: sims,
      maintainTier,
      almanaxDoubled: opts.startMs !== undefined && opts.almanax !== false ? almanaxScheduleFrom(opts.startMs + st.startSeconds * 1000) : null,
      maxSeconds,
      rules: opts.rules,
      // Après chaque tick : éligibilité du tick suivant (état de début de tick).
      stopWhen: (state, t) => {
        if (t < maxSeconds) count(state)
        return false
      },
    }).mounts
  })
  const byGauge: Partial<Record<GaugeId, GaugeYield>> = {}
  const warnings: string[] = []
  let full = true
  for (const [g, a] of acc) {
    const averageFed = a.consumed > 0 ? a.fed / a.consumed : 0
    const y: GaugeYield = {
      gauge: g,
      consumed: a.consumed,
      averageFed,
      yield: averageFed / PADDOCK_SLOTS,
      lostPoints: a.consumed - a.fed / PADDOCK_SLOTS,
      partialSteps: [...a.partial].map(([stepIndex, p]) => ({ stepIndex, minFed: p.min, maxFed: p.max })).sort((x, z) => x.stepIndex - z.stepIndex),
    }
    byGauge[g] = y
    if (!STAT_GAUGES.includes(g) || y.partialSteps.length === 0) continue
    full = false
    const lo = Math.min(...y.partialSteps.map((p) => p.minFed))
    const hi = Math.max(...y.partialSteps.map((p) => p.maxFed))
    const n = y.partialSteps.length
    warnings.push(
      `${GAUGE_LABELS[g]} : ${n} étape${n > 1 ? 's' : ''} à ${lo === hi ? lo : `${lo} à ${hi}`}/${PADDOCK_SLOTS} montures, ≈ ${fmt(y.lostPoints)} points pour des places vides ou des montures déjà pleines (rendement ${Math.round(y.yield * 100)} %).`,
    )
  }
  return { byGauge, full, warnings }
}

// ---------- État à enregistrer dans l'inventaire ----------

export interface MountPatchOptions {
  /** Ranger à l'étable les montures fécondes après le plan (elles ont été sorties en jeu). */
  fecundToStable?: boolean
  /** Sérénités relevées en jeu (id → valeur) : remplacent la sérénité projetée. */
  serenity?: Record<string, number>
  /** Ne pas écrire les statistiques E/M/A (seulement sérénité et niveau). */
  keepStats?: boolean
}

/**
 * Modifications à enregistrer dans l'inventaire depuis l'état projeté des montures d'un plan
 * (`projectMountsFromPlan(...).byId`) : sérénité, endurance/maturité/amour (jamais en baisse, pas pour
 * une stérile ou une sénile), niveau gagné à la Mangeoire (à partir du début du niveau enregistré,
 * prudent), étable pour les fécondes si demandé. Ne renvoie que les montures modifiées.
 */
export function projectedMountPatches(projected: Record<string, SimMount>, mounts: readonly Mount[], opts: MountPatchOptions = {}): Record<string, Partial<Mount>> {
  const out: Record<string, Partial<Mount>> = {}
  for (const m of mounts) {
    const sim = projected[m.id]
    if (!sim) continue
    const patch: Partial<Mount> = {}
    const serenity = Math.round(opts.serenity?.[m.id] ?? sim.serenity)
    if (serenity !== m.serenity) patch.serenity = serenity
    const f = effectiveFertility(m)
    if (!opts.keepStats && f === 'fertile') {
      for (const k of ['endurance', 'maturity', 'love'] as const) {
        const v = Math.min(MOUNT_STAT_MAX, Math.max(m[k], Math.round(sim[k])))
        if (v !== m[k]) patch[k] = v
      }
    }
    if ((sim.xpGained ?? 0) > 0 && m.level < MOUNT_MAX_LEVEL) {
      const level = Math.min(MOUNT_MAX_LEVEL, mountLevelFromXp(mountXpForLevel(m.level) + (sim.xpGained ?? 0)))
      if (level > m.level) patch.level = level
    }
    const after = { ...m, ...patch }
    if (opts.fecundToStable && m.fertility === 'fertile' && isFecund(after) && m.location.kind === 'enclos') patch.location = { kind: 'etable' }
    if (Object.keys(patch).length > 0) out[m.id] = patch
  }
  return out
}

// ---------- Consommation restante, valeur des points ----------

/**
 * Ce qu'il reste à consommer d'un plan démarré à `now` : étapes à partir de l'étape validée, l'étape en
 * cours au prorata du temps qui lui reste (d'après l'heure prévue). Pour `refillAdvice(state, {consumed, steps, tiers})`.
 */
export function remainingPlanConsumption(s: PlanSchedule, now: number): { consumed: Partial<Record<GaugeId, number>>; steps: FertilityStep[] } {
  const ack = Math.max(0, Math.min(s.acknowledgedStepIndex, s.steps.length))
  const times = stepTimes(s)
  const steps = s.steps.slice(ack).map((st, k) => {
    if (k > 0) return st
    const { startAt } = times[ack]
    const dur = st.durationSeconds * 1000
    const left = dur > 0 ? Math.max(0, Math.min(1, 1 - (now - startAt) / dur)) : 0
    const consumed: Partial<Record<GaugeId, number>> = {}
    for (const [g, v] of Object.entries(st.consumed) as [GaugeId, number][]) consumed[g] = Math.round((v ?? 0) * left)
    return { ...st, consumed }
  })
  const consumed: Partial<Record<GaugeId, number>> = {}
  for (const st of steps) for (const [g, v] of Object.entries(st.consumed) as [GaugeId, number][]) consumed[g] = (consumed[g] ?? 0) + (v ?? 0)
  return { consumed, steps }
}

/** Montant en kamas : exact si `complete`, sinon borne basse (« ≥ ») ; null si rien n'est chiffré. */
export interface KamasValue {
  value: number | null
  complete: boolean
}

/**
 * Valeur de points de jauge au coût au point du carburant retenu (`RefillLine.pointCost`) : Σ points ×
 * kamas/point. Un coût au point inconnu ou seulement borné par le haut n'est jamais compté comme 0 :
 * le total devient une borne basse (`complete = false`), ou null si rien n'est chiffré.
 */
export function pointsValue(lines: readonly { points: number; pointCost: Pick<GaugePointCost, 'value' | 'complete' | 'bound'> }[]): KamasValue {
  let sum = 0
  let complete = true
  let known = false
  for (const { points, pointCost } of lines) {
    if (points <= 0) continue
    if (pointCost.complete && pointCost.value !== null) {
      sum += points * pointCost.value
      known = true
    } else {
      complete = false
      if (pointCost.bound === 'min' && pointCost.value !== null) {
        sum += points * pointCost.value
        known = true
      }
    }
  }
  return { value: complete ? sum : known ? sum : null, complete }
}
