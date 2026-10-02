// Projections « maintenant » d'un enclos, partagées par la page Enclos et le conseiller :
// - niveaux de jauges vidés depuis leur saisie (les jauges ne consomment que s'il y a une monture
//   éligible), avec l'état des montures après le même temps ;
// - état des montures d'un plan démarré (sérénité, statistiques, fécondité), en rejouant les étapes
//   validées puis l'étape en cours jusqu'à maintenant.
// Le doublement Almanax suit le calendrier (jour Almanax en heure locale), tick par tick.
// Module pur : aucun React, aucun store.
import { GAUGE_IDS } from './constants'
import { almanaxScheduleFrom, gaugeTiers } from './fertility'
import { isFecund, simulatePaddock, validateActiveGauges, type AlmanaxInput, type SimEvent, type SimMount } from './paddock'
import { toSimMount, type PlanSchedule } from './paddockAssign'
import { getRuleset, type Ruleset } from './rules'
import type { FuelTier, GaugeId, Mount, PaddockState, RulesetId } from './types'

/** Doublement Almanax d'une projection : calendrier (défaut), jamais (`false`), ou calendrier injecté (heure absolue → jauge). */
export type ProjectionAlmanax = boolean | ((ms: number) => GaugeId | null)

const isMount = (m: Mount | SimMount): m is Mount => 'speciesId' in m

/** Montures vues par le simulateur (une `Mount` est convertie avec `toSimMount`). */
export function asSimMounts(mounts: readonly (Mount | SimMount)[]): SimMount[] {
  return mounts.map((m) => (isMount(m) ? toSimMount(m) : { ...m }))
}

function almanaxFrom(startMs: number, almanax: ProjectionAlmanax | undefined): AlmanaxInput {
  if (almanax === false) return null
  return almanaxScheduleFrom(startMs, typeof almanax === 'function' ? almanax : undefined)
}

// ---------- Niveaux de jauges ----------

export interface GaugeProjectionOptions {
  almanax?: ProjectionAlmanax
  /**
   * Heure (ms) de saisie de chaque jauge quand elles diffèrent : la valeur saisie remplace l'estimation
   * à cette heure-là. Les jauges absentes utilisent `activeSinceMs`.
   */
  gaugeUpdatedAt?: Partial<Record<GaugeId, number>>
  /**
   * Jauges actives successives : `[{ at, active }]` (heures en ms). Avant la première entrée (ou sans
   * historique), `state.active`. Voir `planActiveHistory` pour un plan démarré.
   */
  activeHistory?: { at: number; active: GaugeId[] }[]
  /** Au-delà (s, défaut 3 jours), la saisie est trop ancienne : `stale = true` (niveaux simulés quand même). */
  staleAfterSeconds?: number
}

export interface GaugeProjection {
  /** Niveaux estimés à `nowMs`. */
  levels: Record<GaugeId, number>
  /** Montures après le même temps (statistiques et sérénité gagnées dans l'enclos). */
  mounts: SimMount[]
  /** Début de la simulation (ms) : la plus ancienne saisie. */
  fromMs: number
  elapsedSeconds: number
  /** Heure (ms) où une jauge s'est vidée pendant la période. */
  emptiedAt: Partial<Record<GaugeId, number>>
  /** Événements de la simulation, `t` en secondes depuis `fromMs`. */
  events: SimEvent[]
  /** Au moins un niveau diffère de la saisie (estimation à afficher comme telle, « ≈ … estimé »). */
  estimated: boolean
  /** Saisie plus ancienne que `staleAfterSeconds` : à ressaisir depuis le jeu. */
  stale: boolean
}

/**
 * Niveaux de jauges d'un enclos à `nowMs`, en simulant la consommation depuis la saisie
 * (`activeSinceMs`, ou `gaugeUpdatedAt` jauge par jauge) avec les jauges actives (`state.active` ou
 * `activeHistory`) et l'éligibilité réelle des montures (une jauge ne consomme rien si personne n'en
 * profite). Paliers réels (la jauge ralentit en changeant de palier), sans recharge.
 * `mounts` = montures de l'enclos à l'heure de la saisie (`Mount` ou `SimMount`).
 */
export function projectGaugeLevels(
  state: Pick<PaddockState, 'gauges' | 'active'>,
  activeSinceMs: number,
  nowMs: number,
  rules: Ruleset,
  mounts: readonly (Mount | SimMount)[],
  opts: GaugeProjectionOptions = {},
): GaugeProjection {
  const entered = {} as Record<GaugeId, number>
  for (const g of GAUGE_IDS) entered[g] = Math.max(0, state.gauges[g] ?? 0)
  const stamp = (g: GaugeId) => opts.gaugeUpdatedAt?.[g] ?? activeSinceMs
  const valid = GAUGE_IDS.map(stamp).filter((x) => x > 0)
  const fromMs = valid.length ? Math.min(...valid) : nowMs
  let sims = asSimMounts(mounts)
  const levels = { ...entered }
  const events: SimEvent[] = []
  const emptiedAt: Partial<Record<GaugeId, number>> = {}
  const elapsedSeconds = Math.max(0, (nowMs - fromMs) / 1000)
  const history = [...(opts.activeHistory ?? [])].sort((a, b) => a.at - b.at)
  const activeAt = (ms: number): GaugeId[] => {
    let a = state.active
    for (const h of history) if (h.at <= ms) a = h.active
    return a
  }
  // Instants où quelque chose change : saisie d'une jauge, changement de jauges actives.
  const cuts = new Set<number>([nowMs])
  for (const g of GAUGE_IDS) if (stamp(g) > fromMs && stamp(g) < nowMs) cuts.add(stamp(g))
  for (const h of history) if (h.at > fromMs && h.at < nowMs) cuts.add(h.at)
  let t = fromMs
  for (const end of [...cuts].sort((a, b) => a - b)) {
    if (end <= t) continue
    const seconds = Math.floor((end - t) / 10_000) * 10
    const active = activeAt(t)
    if (seconds >= 10 && active.length > 0 && validateActiveGauges(active) === null) {
      const res = simulatePaddock({ gauges: { ...levels }, active, mounts: sims, almanaxDoubled: almanaxFrom(t, opts.almanax), maxSeconds: seconds, rules })
      const offset = (t - fromMs) / 1000
      for (const e of res.events) {
        events.push({ ...e, t: e.t + offset })
        if (e.kind === 'gauge-empty' && emptiedAt[e.gauge] === undefined) emptiedAt[e.gauge] = t + e.t * 1000
      }
      Object.assign(levels, res.gauges)
      sims = res.mounts
    }
    t = end
    for (const g of GAUGE_IDS) if (stamp(g) === end) levels[g] = entered[g]
  }
  return {
    levels,
    mounts: sims,
    fromMs,
    elapsedSeconds,
    emptiedAt,
    events,
    estimated: GAUGE_IDS.some((g) => levels[g] !== entered[g]),
    stale: elapsedSeconds > (opts.staleAfterSeconds ?? 3 * 86_400),
  }
}

// ---------- Montures d'un plan démarré ----------

/** Ce que la projection lit d'un plan démarré (un `ActivePaddockPlan` du store convient). */
export interface ReplayablePlan extends PlanSchedule {
  tier: FuelTier
  /** Paliers par jauge du plan (`FertilityPlan.tiers`) ; à défaut `tier`, sérénité au palier 1. */
  tiers?: Partial<Record<GaugeId, FuelTier>>
  rulesetId?: RulesetId
  mountIds: string[]
}

export interface PlanProjectionOptions {
  /** Défaut : règles du plan (`rulesetId`). */
  rules?: Ruleset
  almanax?: ProjectionAlmanax
  /**
   * Prolonger l'étape en cours au-delà de sa fin prévue tant qu'elle n'est pas validée (les jauges
   * restent actives en jeu). Défaut : non — on suppose le changement fait à l'heure.
   */
  continueCurrentStep?: boolean
}

export interface PlanProjection {
  /** Montures du plan présentes dans `mounts`, projetées à `nowMs`. */
  mounts: SimMount[]
  byId: Record<string, SimMount>
  /** Montures du plan fécondes à `nowMs` (projection). */
  fecundIds: string[]
  /** Étape en cours (index validé ; `steps.length` = plan terminé). */
  stepIndex: number
  /** Secondes depuis le début du plan (décalage compris), bornées à 0. */
  elapsedSeconds: number
  finished: boolean
  /** Montures du plan absentes de `mounts` (supprimées de l'inventaire) : ignorées. */
  missingIds: string[]
}

/**
 * État estimé des montures d'un plan démarré à `nowMs` : les étapes validées puis l'étape en cours
 * sont rejouées jusqu'à `nowMs` (jauges entretenues aux paliers du plan, Almanax du calendrier),
 * chacune au plus sa durée prévue (sauf l'étape en cours avec `continueCurrentStep`). Suppose que les statistiques enregistrées
 * dans l'inventaire datent d'avant le démarrage du plan.
 */
export function projectMountsFromPlan(plan: ReplayablePlan, mounts: readonly Mount[], nowMs: number, opts: PlanProjectionOptions = {}): PlanProjection {
  const rules = opts.rules ?? getRuleset(plan.rulesetId)
  const tiers = { ...gaugeTiers({ tier: plan.tier }), ...plan.tiers }
  const base = plan.startedAt + (plan.offsetMs ?? 0)
  const elapsedSeconds = Math.max(0, (nowMs - base) / 1000)
  const byInventory = new Map(mounts.map((m) => [m.id, m]))
  const present = plan.mountIds.filter((id) => byInventory.has(id))
  let sims = present.map((id) => toSimMount(byInventory.get(id)!))
  const ack = Math.max(0, Math.min(plan.acknowledgedStepIndex, plan.steps.length))
  for (let i = 0; i < plan.steps.length && i <= ack; i++) {
    const st = plan.steps[i]
    // Jusqu'à `nowMs` seulement (une projection peut viser une heure passée) ; l'étape en cours peut
    // se prolonger au-delà de sa fin prévue (`continueCurrentStep`).
    const sinceStart = Math.max(0, elapsedSeconds - st.startSeconds)
    let seconds = i === ack && opts.continueCurrentStep ? sinceStart : Math.min(st.durationSeconds, sinceStart)
    seconds = Math.floor(seconds / 10) * 10
    if (seconds < 10 || st.gauges.length === 0 || validateActiveGauges(st.gauges) !== null) continue
    const maintainTier: Partial<Record<GaugeId, FuelTier>> = {}
    for (const g of st.gauges) maintainTier[g] = tiers[g]
    sims = simulatePaddock({
      gauges: { baffeur: 0, caresseur: 0, foudroyeur: 0, abreuvoir: 0, dragofesse: 0, mangeoire: 0 },
      active: st.gauges,
      mounts: sims,
      maintainTier,
      almanaxDoubled: almanaxFrom(base + st.startSeconds * 1000, opts.almanax),
      maxSeconds: seconds,
      rules,
    }).mounts
  }
  const byId: Record<string, SimMount> = {}
  for (const m of sims) byId[m.id] = m
  return {
    mounts: sims,
    byId,
    fecundIds: sims.filter(isFecund).map((m) => m.id),
    stepIndex: ack,
    elapsedSeconds,
    finished: ack >= plan.steps.length,
    missingIds: plan.mountIds.filter((id) => !byInventory.has(id)),
  }
}

/**
 * Jauges actives prévues par un plan démarré, étape par étape (heures absolues, décalage compris) :
 * à passer en `activeHistory` de `projectGaugeLevels`. Étapes validées seulement ; plan terminé →
 * tout coupé à la fin.
 */
export function planActiveHistory(plan: PlanSchedule): { at: number; active: GaugeId[] }[] {
  const base = plan.startedAt + (plan.offsetMs ?? 0)
  const ack = Math.max(0, Math.min(plan.acknowledgedStepIndex, plan.steps.length))
  const out = plan.steps.slice(0, Math.min(ack + 1, plan.steps.length)).map((st) => ({ at: base + st.startSeconds * 1000, active: st.gauges }))
  if (ack >= plan.steps.length && plan.steps.length > 0) out.push({ at: base + plan.totalSeconds * 1000, active: [] })
  return out
}

export interface PaddockProjection {
  /** Niveaux de jauges estimés (voir `projectGaugeLevels`). */
  gauges: GaugeProjection
  /** Montures estimées à `nowMs` : plan rejoué s'il y a un plan démarré, sinon simulation des jauges saisies. */
  mounts: SimMount[]
  /** Projection du plan démarré (null sans plan). */
  plan: PlanProjection | null
}

/**
 * Projection complète d'un enclos à `nowMs` : jauges vidées depuis la saisie (avec, s'il y a un plan
 * démarré, les jauges actives prévues par le plan et les montures telles qu'elles étaient à l'heure
 * de la saisie), et montures (plan rejoué, sinon simulation des jauges saisies).
 */
export function projectPaddock(args: {
  state: Pick<PaddockState, 'gauges' | 'active'>
  activeSinceMs: number
  nowMs: number
  rules: Ruleset
  mounts: readonly Mount[]
  plan?: ReplayablePlan | null
  gaugeUpdatedAt?: Partial<Record<GaugeId, number>>
  activeHistory?: { at: number; active: GaugeId[] }[]
  almanax?: ProjectionAlmanax
}): PaddockProjection {
  const { state, activeSinceMs, nowMs, rules, mounts, plan } = args
  const inPlan = plan ? new Set(plan.mountIds) : null
  const stamps = [activeSinceMs, ...Object.values(args.gaugeUpdatedAt ?? {})].filter((x): x is number => typeof x === 'number' && x > 0)
  const fromMs = stamps.length ? Math.min(...stamps) : nowMs
  let atEntry: SimMount[] = asSimMounts(mounts)
  if (plan) {
    const projected = projectMountsFromPlan(plan, mounts, fromMs, { rules, almanax: args.almanax }).byId
    atEntry = atEntry.map((m) => projected[m.id] ?? m)
  }
  const gauges = projectGaugeLevels(state, activeSinceMs, nowMs, rules, atEntry, {
    almanax: args.almanax,
    gaugeUpdatedAt: args.gaugeUpdatedAt,
    activeHistory: args.activeHistory ?? (plan ? planActiveHistory(plan) : undefined),
  })
  const planProj = plan ? projectMountsFromPlan(plan, mounts, nowMs, { rules, almanax: args.almanax }) : null
  const now = planProj ? gauges.mounts.map((m) => (inPlan?.has(m.id) ? (planProj.byId[m.id] ?? m) : m)) : gauges.mounts
  return { gauges, mounts: now, plan: planProj }
}
