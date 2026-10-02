// Répartition automatique des montures dans les enclos, conseils de recharge de carburant,
// chronologie d'une simulation et suivi d'un plan d'enclos démarré (horaires absolus).
//
// Règles appliquées (research/README.md §2.3-2.4, strategy.md §4, STRATEGY.paddockRules) :
// - 10 places par enclos ; une jauge consomme autant avec 1 ou 10 montures éligibles : on vise
//   10 montures éligibles par jauge active (E-FULL-01, high).
// - Lots homogènes : sérénités dans une fenêtre de 2 000 au plus (E-GROUP-01, high).
// - Groupes de sérénité : bleu = Foudroyeur + Abreuvoir, violet = Dragofesse + Abreuvoir,
//   rouge = Foudroyeur + Caresseur, vert = Dragofesse + Baffeur, « station de sérénité » =
//   Caresseur ou Baffeur (+ Mangeoire) pour les traversées de 0 (E-GAUGE-*, high).
// - Répartition selon le nombre d'enclos : STRATEGY.paddockAllocationByCount (medium).
// - Mangeoire en 2e jauge : les places libres d'un lot se complètent avec des montures à monter en
//   niveau (E-XP-01) ; un enclos sans lot peut servir de « Mangeoire » (revente, brisage, parents).
// - Recharge : carburant le moins cher au point, chaque palier rempli avec la famille minimale qui
//   le permet (E-FUEL-CHEAPEST, fuel.ts) ; jauges de sérénité au plus juste + alarme (E-SER-*).
// Module pur : aucun React, aucun accès au store.
import { STRATEGY, getSpecies } from '../data'
import { FUEL_TIER_NAMES, GAUGE_IDS, GAUGE_LABELS, MOUNT_MAX_LEVEL, MOUNT_STAT_MAX, PADDOCK_SLOTS, PADDOCK_UNLOCK_LEVELS, TICK_SECONDS } from './constants'
import { decideGauges, planFertility, type FertilityOptions, type FertilityPlan, type FertilityStep } from './fertility'
import { bestFuel, fillPlan, type FillPlan, type GaugePointCost } from './fuel'
import { SERENITY_SMILEYS } from './mountFate'
import { effectiveFertility } from './mounts'
import { canBenefit, formatDuration, gainMultiplier, isFecund, simulatePaddock, type SimMount, type SimulateResult } from './paddock'
import type { PriceContext } from './pricing'
import { RULESETS, type Ruleset } from './rules'
import type { FuelTier, GaugeId, Mount, MountLocation, PaddockState } from './types'
import { mountXpBetween } from './xp'

/** Largeur maximale d'un lot en sérénité (E-GROUP-01). */
export const BATCH_SERENITY_WINDOW = 2_000
/** Niveau visé par défaut pour les parents (E-XP-01 ; réglage `parentTargetLevel`). */
export const DEFAULT_LEVEL_TARGET = 40

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR')
const sortedKey = (gs: GaugeId[]) => [...gs].sort().join('+')

// ---------- Rôles d'enclos ----------

export type PaddockRole =
  | 'bleu'
  | 'violet'
  | 'rouge'
  | 'vert'
  | 'station-caresseur'
  | 'station-baffeur'
  | 'finition'
  | 'xp'
  | 'vide'

export const PADDOCK_ROLE_LABELS: Record<PaddockRole, string> = {
  bleu: 'Groupe bleu :( — Foudroyeur + Abreuvoir',
  violet: 'Groupe violet :) — Dragofesse + Abreuvoir',
  rouge: 'Groupe rouge :C — Foudroyeur + Caresseur',
  vert: 'Groupe vert :D — Dragofesse + Baffeur',
  'station-caresseur': 'Station de sérénité — Caresseur',
  'station-baffeur': 'Station de sérénité — Baffeur',
  finition: 'Finition — dernière statistique',
  xp: 'Mangeoire — montée en niveau',
  vide: 'Libre',
}

/** Rôle d'un enclos d'après les jauges de sa phase en cours. */
export function paddockRole(gauges: GaugeId[]): PaddockRole {
  const has = (g: GaugeId) => gauges.includes(g)
  if (gauges.length === 0) return 'vide'
  if (has('foudroyeur') && has('abreuvoir')) return 'bleu'
  if (has('abreuvoir') && has('dragofesse')) return 'violet'
  if (has('caresseur') && has('foudroyeur')) return 'rouge'
  if (has('baffeur') && has('dragofesse')) return 'vert'
  if (has('caresseur')) return 'station-caresseur'
  if (has('baffeur')) return 'station-baffeur'
  if (gauges.every((g) => g === 'mangeoire')) return 'xp'
  return 'finition'
}

/** Organisation conseillée par la recherche pour ce nombre d'enclos (texte), ou null. */
export function allocationAdvice(paddocks: number): string | null {
  const n = Math.max(1, Math.min(PADDOCK_UNLOCK_LEVELS.length, Math.floor(paddocks)))
  return STRATEGY.paddockAllocationByCount?.[String(n)] ?? null
}

// ---------- Montures vues par le simulateur ----------

/** Monture à rendre féconde : fertile (pas encore féconde), ni stérile ni sénile, espèce élevable. */
export function needsFertility(m: Mount): boolean {
  if (effectiveFertility(m) !== 'fertile') return false
  return getSpecies(m.speciesId)?.breedable ?? true
}

/**
 * Monture du simulateur. Les stériles et séniles sont vues « pleines » (E/M/A au maximum) : elles
 * ne deviendront jamais fécondes et ne doivent pas fausser le plan ; elles gagnent seulement l'XP.
 */
export function toSimMount(m: Mount): SimMount {
  const f = effectiveFertility(m)
  const done = f === 'sterile' || f === 'senile'
  return {
    id: m.id,
    ability: m.ability,
    serenity: m.serenity,
    endurance: done ? MOUNT_STAT_MAX : m.endurance,
    maturity: done ? MOUNT_STAT_MAX : m.maturity,
    love: done ? MOUNT_STAT_MAX : m.love,
    canGainXp: m.level < MOUNT_MAX_LEVEL,
  }
}

/** Complément XP : monture « pleine » pour le planificateur de fécondité, qui profite de la Mangeoire. */
export function toFillerSim(m: Mount): SimMount {
  return { ...toSimMount(m), endurance: MOUNT_STAT_MAX, maturity: MOUNT_STAT_MAX, love: MOUNT_STAT_MAX }
}

/** Secondes de Mangeoire (entretenue au palier) pour passer du niveau `from` au niveau `to`. */
export function xpSeconds(
  from: number,
  to: number,
  opts: { tier: FuelTier; rules: Ruleset; ability?: Mount['ability']; almanaxDoubled?: GaugeId | null },
): number {
  const xp = mountXpBetween(from, to)
  if (xp <= 0) return 0
  const perTick = opts.rules.gaugeRatePerTick[opts.tier] * gainMultiplier('mangeoire', opts.ability ?? null, opts.almanaxDoubled ?? null)
  return Math.ceil(xp / perTick) * TICK_SECONDS
}

// ---------- Plan d'un lot sans micro-étapes ----------

const zeroGauges = (): Record<GaugeId, number> => ({ baffeur: 0, caresseur: 0, foudroyeur: 0, abreuvoir: 0, dragofesse: 0, mangeoire: 0 })

/** Marge de sérénité gardée pour une monture qui a encore besoin de maturité (comme le planificateur). */
const MATURITY_SAFE = 1_000

/** Étape qui pousse la sérénité (Caresseur ou Baffeur). */
const isCrossing = (s: FertilityStep) => s.gauges.includes('caresseur') || s.gauges.includes('baffeur')
/** Traversée de 0 « libre » : Caresseur ou Baffeur sans cible de sérénité (pas de fenêtre de changement). */
const isFreeCrossing = (s: FertilityStep) => !s.switchWindow && isCrossing(s)
/** En dessous, une poussée de sérénité qui revient plus loin est une alternance à corriger. */
const PING_PONG_SECONDS = 120

/**
 * Plan de fécondité d'un lot : `planFertility`, puis correction des traversées de 0 « libres »
 * (Caresseur + Dragofesse, Baffeur + Foudroyeur). Le planificateur suit la phase majoritaire et
 * alterne alors toutes les une ou deux minutes à mesure que les montures traversent une à une, ce
 * qui est inapplicable en jeu (et peut tourner en boucle quand le lot chevauche 0). Ici, la poussée
 * continue jusqu'à ce que plus aucune monture n'en ait besoin, sans sortir de la zone de maturité
 * (±1 000) une monture qui en a encore besoin, puis la planification reprend. Même forme de
 * résultat que `planFertility`.
 */
export function planPaddock(input: SimMount[], opts: FertilityOptions): FertilityPlan {
  const rules = opts.rules ?? RULESETS['3.6']
  const maxSeconds = opts.maxSeconds ?? 7 * 86_400
  const withXp = opts.withXp ?? false
  const almanax = opts.almanaxDoubled ?? null
  let mounts: SimMount[] = input.map((m) => ({ ...m }))
  const steps: FertilityStep[] = []
  const consumed = zeroGauges()
  const fecundAt: Record<string, number> = {}
  const warnings: string[] = []
  let t = 0

  const addStep = (step: FertilityStep) => {
    steps.push(step)
    for (const [g, v] of Object.entries(step.consumed)) consumed[g as GaugeId] += v ?? 0
  }
  const addFecund = (offset: number, map: Record<string, number>) => {
    for (const [id, at] of Object.entries(map)) if (fecundAt[id] === undefined) fecundAt[id] = offset + at
  }
  const run = (gauges: GaugeId[], seconds: number, stopWhen?: (ms: SimMount[]) => boolean) => {
    const maintainTier: Partial<Record<GaugeId, FuelTier>> = {}
    for (const g of gauges) maintainTier[g] = opts.tier
    return simulatePaddock({ gauges: zeroGauges(), active: gauges, mounts, almanaxDoubled: almanax, maintainTier, rules, maxSeconds: seconds, stopWhen })
  }
  /** Reprend tel quel le plan `p` (démarré à `t0`) à partir de l'étape `from` (état courant = début de cette étape). */
  const shifted = (st: FertilityStep, t0: number): FertilityStep => ({
    ...st,
    startSeconds: t0 + st.startSeconds,
    consumed: { ...st.consumed },
    switchWindow: st.switchWindow && { earliestSeconds: t0 + st.switchWindow.earliestSeconds, latestSeconds: t0 + st.switchWindow.latestSeconds },
  })
  const appendRest = (p: FertilityPlan, t0: number, from: number) => {
    for (const st of p.steps.slice(from)) addStep(shifted(st, t0))
    addFecund(t0, p.fecundAt)
    for (const w of p.warnings) if (!w.startsWith('Certaines montures')) warnings.push(w)
    mounts = p.mounts
    t = t0 + p.totalSeconds
  }

  for (let guard = 0; guard < 40 && t < maxSeconds; guard++) {
    const t0 = t
    const p = planFertility(mounts, { ...opts, maxSeconds: maxSeconds - t })
    // Traversée qui revient plus loin : libre, ou très courte (alternance entre deux poussées).
    const k = p.steps.findIndex(
      (st, i) =>
        (isFreeCrossing(st) || (isCrossing(st) && st.durationSeconds < PING_PONG_SECONDS)) &&
        p.steps.slice(i + 1).some((x) => sortedKey(x.gauges) === sortedKey(st.gauges)),
    )
    if (k < 0) {
      appendRest(p, t0, 0)
      break
    }
    // Rejouer les étapes qui précèdent la traversée (simulation déterministe) pour retrouver l'état du lot.
    for (const st of p.steps.slice(0, k)) {
      const res = run(st.gauges, st.durationSeconds)
      addStep({ ...shifted(st, t0), durationSeconds: res.seconds, consumed: Object.fromEntries(st.gauges.map((g) => [g, res.consumed[g]])) })
      addFecund(t, res.fecundAt)
      t += res.seconds
      mounts = res.mounts
    }
    const cross = p.steps[k]
    const push: GaugeId = cross.gauges.includes('caresseur') ? 'caresseur' : 'baffeur'
    const up = push === 'caresseur'
    const delta = rules.gaugeRatePerTick[opts.tier] * gainMultiplier(push, null, almanax)
    const needsPush = (m: SimMount) => decideGauges(m, withXp)?.gauges.includes(push) ?? false
    // Monture qui perdrait sa progression si on poussait le lot maintenant : elle a encore besoin de
    // maturité au bord de la zone (±1 000), ou de la statistique de son côté de 0 (endurance < 0 pour
    // une poussée vers le haut, amour ≥ 0 vers le bas). Renvoie la jauge qui la termine sur place.
    const blocker = (m: SimMount): GaugeId | null => {
      if (isFecund(m) || needsPush(m)) return null
      const next = up ? m.serenity + delta : m.serenity - delta
      if (m.maturity < MOUNT_STAT_MAX && Math.abs(m.serenity) <= MATURITY_SAFE && Math.abs(next) > MATURITY_SAFE) return 'abreuvoir'
      if (up && m.endurance < MOUNT_STAT_MAX && m.serenity < 0) return 'foudroyeur'
      if (!up && m.love < MOUNT_STAT_MAX && m.serenity >= 0) return 'dragofesse'
      return null
    }
    const blockers = new Map<GaugeId, number>()
    for (const m of mounts) {
      const g = blocker(m)
      if (g) blockers.set(g, (blockers.get(g) ?? 0) + 1)
    }
    if (blockers.size > 0) {
      // Finir d'abord sur place ce que la traversée ferait perdre, puis traverser (tour suivant).
      const ranked = [...blockers.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g)
      const gauges: GaugeId[] = ranked.slice(0, 2)
      if (gauges.length === 1 && withXp) gauges.push('mangeoire')
      const res = run(gauges, maxSeconds - t, (ms) => !ms.some((m) => {
        const g = blocker(m)
        return g !== null && gauges.includes(g)
      }))
      if (res.seconds === 0) {
        appendRest(p, t0, k)
        break
      }
      addStep({
        gauges,
        startSeconds: t,
        durationSeconds: res.seconds,
        purpose: `Finir ${ranked
          .slice(0, 2)
          .map((g) => (g === 'abreuvoir' ? 'la maturité' : g === 'foudroyeur' ? "l'endurance" : "l'amour"))
          .join(' et ')} avant de traverser 0 (${GAUGE_LABELS[push]} ensuite)`,
        consumed: Object.fromEntries(gauges.map((g) => [g, res.consumed[g]])),
      })
      addFecund(t, res.fecundAt)
      t += res.seconds
      mounts = res.mounts
      continue
    }
    const res = run(cross.gauges, maxSeconds - t, (ms) => !ms.some(needsPush) || ms.some((m) => blocker(m) === 'abreuvoir'))
    if (res.seconds === 0) {
      appendRest(p, t0, k)
      break
    }
    addStep({
      gauges: cross.gauges,
      startSeconds: t,
      durationSeconds: res.seconds,
      purpose: `${cross.purpose} (jusqu'à ce que tout le lot ait traversé)`,
      consumed: Object.fromEntries(cross.gauges.map((g) => [g, res.consumed[g]])),
    })
    addFecund(t, res.fecundAt)
    t += res.seconds
    mounts = res.mounts
  }

  const merged: FertilityStep[] = []
  for (const st of steps) {
    const last = merged[merged.length - 1]
    if (last && sortedKey(last.gauges) === sortedKey(st.gauges) && last.purpose === st.purpose && !last.switchWindow && !st.switchWindow) {
      last.durationSeconds += st.durationSeconds
      for (const [g, v] of Object.entries(st.consumed)) last.consumed[g as GaugeId] = (last.consumed[g as GaugeId] ?? 0) + (v ?? 0)
    } else merged.push({ ...st, consumed: { ...st.consumed } })
  }
  if (mounts.some((m) => fecundAt[m.id] === undefined)) warnings.push('Certaines montures ne sont pas fécondes à la fin du plan.')
  return { steps: merged, totalSeconds: t, fecundAt, consumed, warnings: [...new Set(warnings)], mounts }
}

// ---------- Répartition automatique ----------

export interface AssignOptions {
  /** Enclos débloqués (niveau d'Éleveur → PADDOCK_UNLOCK_LEVELS). */
  paddocksAvailable: number
  rules: Ruleset
  /** Palier entretenu sur les jauges du plan. */
  tier: FuelTier
  /** Mangeoire en 2e jauge quand une seule autre jauge sert. */
  withXp?: boolean
  almanaxDoubled?: GaugeId | null
  /** Compléter les places libres avec des montures à monter en niveau (défaut : oui). */
  includeLeveling?: boolean
  /** Niveau visé pour les montures fertiles/fécondes (défaut 40). */
  levelTarget?: number
  /** Niveaux visés explicites par monture (ex. sort « monter » : revente, brisage). Prioritaires. */
  xpTargets?: Record<string, number>
  /** Laisser en place les montures déjà en enclos qui ont encore besoin de leurs jauges (défaut : oui). */
  keepCurrent?: boolean
  /** Considérer aussi les montures de l'inventaire du personnage (défaut : non). */
  includeInventory?: boolean
  /** Durée maximale planifiée par lot (défaut : 7 jours). */
  maxPlanSeconds?: number
}

export interface PaddockAssignment {
  paddockId: number
  role: PaddockRole
  /** Composition finale (montures à rendre fécondes + compléments XP). */
  mountIds: string[]
  /** Déjà dans cet enclos et qui y restent. */
  keptIds: string[]
  /** À poser dans cet enclos. */
  addedIds: string[]
  /** Compléments XP (Mangeoire seulement). */
  fillerIds: string[]
  /** Plan de fécondité du lot (null si aucune monture à rendre féconde). */
  plan: FertilityPlan | null
  /** Jauges à activer en premier. */
  firstGauges: GaugeId[]
  /** Montures éligibles à chaque jauge de la première phase. */
  eligible: Partial<Record<GaugeId, number>>
  serenityRange: [number, number] | null
  /** Durée jusqu'à la fécondité de tout le lot (ou jusqu'au niveau visé pour un enclos Mangeoire). */
  totalSeconds: number
  rationale: string[]
  warnings: string[]
}

export interface MountMove {
  mountId: string
  from: MountLocation
  to: MountLocation
  reason: string
}

export interface WaitingBatch {
  /** Numéro du lot suivant (1 = le prochain à poser). */
  index: number
  mountIds: string[]
  serenityRange: [number, number]
  role: PaddockRole
  firstGauges: GaugeId[]
}

export interface WaitingMount {
  mountId: string
  batch: number
  reason: string
}

export interface AssignResult {
  /** Un élément par enclos débloqué (rôle « vide » s'il reste libre). */
  paddocks: PaddockAssignment[]
  /** Déplacements à faire en jeu (sur une carte d'enclos). */
  moves: MountMove[]
  /** Montures à rendre fécondes sans place libre, rangées par lot suivant. */
  waiting: WaitingMount[]
  waitingBatches: WaitingBatch[]
  suggestions: string[]
  allocationAdvice: string | null
  stats: { paddocks: number; slots: number; fertility: number; placed: number; waiting: number; fillers: number }
}

interface Cand {
  m: Mount
  sim: SimMount
  /** Jauges de la phase dont la monture a besoin maintenant. */
  gauges: GaugeId[]
  key: string
  /** Points de statistiques encore à gagner (E + M + A). */
  points: number
}

interface Batch {
  members: Cand[]
}

function toCand(m: Mount): Cand {
  const sim = toSimMount(m)
  const gauges = decideGauges(sim, false)?.gauges ?? []
  return {
    m,
    sim,
    gauges,
    key: sortedKey(gauges),
    points: 3 * MOUNT_STAT_MAX - Math.min(MOUNT_STAT_MAX, m.endurance) - Math.min(MOUNT_STAT_MAX, m.maturity) - Math.min(MOUNT_STAT_MAX, m.love),
  }
}

function range(cs: Cand[]): [number, number] | null {
  if (cs.length === 0) return null
  let lo = Infinity
  let hi = -Infinity
  for (const c of cs) {
    lo = Math.min(lo, c.m.serenity)
    hi = Math.max(hi, c.m.serenity)
  }
  return [lo, hi]
}

function spreadWith(cs: Cand[], extra?: Cand): number {
  const r = range(extra ? [...cs, extra] : cs)
  return r ? r[1] - r[0] : 0
}

/** Phase majoritaire d'un lot (même règle que le planificateur : la plus fréquente, puis la première). */
function majority(cs: Cand[]): { gauges: GaugeId[]; key: string } {
  const counts = new Map<string, { gauges: GaugeId[]; n: number }>()
  for (const c of [...cs].sort((a, b) => a.m.serenity - b.m.serenity)) {
    if (c.gauges.length === 0) continue
    const e = counts.get(c.key)
    if (e) e.n++
    else counts.set(c.key, { gauges: c.gauges, n: 1 })
  }
  let best: { gauges: GaugeId[]; n: number; key: string } | null = null
  for (const [key, e] of counts) if (!best || e.n > best.n) best = { ...e, key }
  return best ? { gauges: best.gauges, key: best.key } : { gauges: [], key: '' }
}

const shares = (a: GaugeId[], b: GaugeId[]) => a.some((g) => b.includes(g))

/** Côté de 0 d'une monture (0 = indifférent : il ne lui manque que la maturité). */
function sideOf(c: Cand): -1 | 0 | 1 {
  if (c.m.endurance >= MOUNT_STAT_MAX && c.m.love >= MOUNT_STAT_MAX) return 0
  return c.m.serenity < 0 ? -1 : 1
}

/**
 * La monture peut-elle rejoindre ce lot (place libre, fenêtre ≤ 2 000, au moins une jauge commune) ?
 * Sans `crossZero`, le lot reste d'un seul côté de 0 : un lot qui chevauche 0 se scinde après la
 * maturité (une moitié doit monter, l'autre descendre) et dure à peu près deux fois plus longtemps.
 */
function fits(members: Cand[], c: Cand, crossZero = false): boolean {
  if (members.length >= PADDOCK_SLOTS) return false
  if (spreadWith(members, c) > BATCH_SERENITY_WINDOW) return false
  if (members.length === 0) return true
  if (!crossZero) {
    const side = sideOf(c)
    if (side !== 0 && members.some((x) => sideOf(x) === -side)) return false
  }
  return shares(majority(members).gauges, c.gauges)
}

/** Fenêtres de sérénité ≤ 2 000, 10 montures au plus, depuis la plus basse (glouton optimal en 1D). */
function windows(cs: Cand[]): Cand[][] {
  const sorted = [...cs].sort((a, b) => a.m.serenity - b.m.serenity)
  const out: Cand[][] = []
  let i = 0
  while (i < sorted.length) {
    const s0 = sorted[i].m.serenity
    const batch: Cand[] = []
    while (i < sorted.length && batch.length < PADDOCK_SLOTS && sorted[i].m.serenity - s0 <= BATCH_SERENITY_WINDOW) batch.push(sorted[i++])
    out.push(batch)
  }
  return out
}

/** Regroupe les lots incomplets compatibles (jauge commune, fenêtre ≤ 2 000) pour viser 10 éligibles. */
function mergeSmall(batches: Batch[], crossZero: boolean): Batch[] {
  let current = batches.filter((b) => b.members.length > 0)
  for (let guard = 0; guard < 200; guard++) {
    let changed = false
    current.sort((a, b) => b.members.length - a.members.length || avgSerenity(a) - avgSerenity(b))
    for (const target of current) {
      if (target.members.length >= PADDOCK_SLOTS) continue
      for (const donor of current) {
        if (donor === target || donor.members.length === 0 || donor.members.length > target.members.length) continue
        if (donor.members.length >= PADDOCK_SLOTS) continue
        const center = avgSerenity(target)
        const order = [...donor.members].sort((a, b) => Math.abs(a.m.serenity - center) - Math.abs(b.m.serenity - center))
        for (const c of order) {
          if (target.members.length >= PADDOCK_SLOTS) break
          if (!fits(target.members, c, crossZero)) continue
          target.members.push(c)
          donor.members = donor.members.filter((x) => x !== c)
          changed = true
        }
      }
    }
    current = current.filter((b) => b.members.length > 0)
    if (!changed) break
  }
  return current
}

function avgSerenity(b: Batch): number {
  return b.members.length ? b.members.reduce((s, c) => s + c.m.serenity, 0) / b.members.length : 0
}

function avgPoints(b: Batch): number {
  return b.members.length ? b.members.reduce((s, c) => s + c.points, 0) / b.members.length : 0
}

function inPaddock(m: Mount, p?: number): boolean {
  return m.location.kind === 'enclos' && (p === undefined || m.location.paddock === p)
}

const sameLocation = (a: MountLocation, b: MountLocation) =>
  a.kind === b.kind && (a.kind !== 'enclos' || (b.kind === 'enclos' && a.paddock === b.paddock))

/** Niveau visé pour une monture (null = pas besoin d'XP). */
function xpTargetOf(m: Mount, opts: AssignOptions): number | null {
  const explicit = opts.xpTargets?.[m.id]
  if (explicit !== undefined) return explicit > m.level ? Math.min(MOUNT_MAX_LEVEL, explicit) : null
  const f = effectiveFertility(m)
  if (f !== 'fertile' && f !== 'feconde') return null
  const target = opts.levelTarget ?? DEFAULT_LEVEL_TARGET
  return m.level < target ? target : null
}

/**
 * Répartit les montures dans les enclos débloqués : lots de 10 au plus, fenêtre de sérénité ≤ 2 000,
 * phases de même jauge ensemble ; lots incomplets fusionnés s'ils partagent une jauge ; places libres
 * complétées par des montures à monter en niveau (Mangeoire). Renvoie la composition de chaque enclos
 * avec son plan de fécondité, les déplacements, la file d'attente (lots suivants) et des conseils.
 */
export function assignPaddocks(mounts: Mount[], opts: AssignOptions): AssignResult {
  const K = Math.max(1, Math.min(PADDOCK_UNLOCK_LEVELS.length, Math.floor(opts.paddocksAvailable)))
  const keepCurrent = opts.keepCurrent ?? true
  const includeLeveling = opts.includeLeveling ?? true
  const withXp = opts.withXp ?? false
  const usable = (m: Mount) => m.location.kind === 'etable' || m.location.kind === 'enclos' || (opts.includeInventory === true && m.location.kind === 'inventaire')
  const pool = mounts.filter(usable)

  const fertility = pool.filter(needsFertility).map(toCand)
  const seeds = new Map<number, Batch>()
  for (let p = 1; p <= K; p++) seeds.set(p, { members: [] })
  let free: Cand[] = []
  for (const c of fertility) {
    const loc = c.m.location
    if (keepCurrent && loc.kind === 'enclos' && loc.paddock <= K) seeds.get(loc.paddock)!.members.push(c)
    else free.push(c)
  }

  // 1. Compléter les enclos déjà occupés avec des montures compatibles.
  const seeded = [...seeds.entries()].filter(([, b]) => b.members.length > 0).sort((a, b) => b[1].members.length - a[1].members.length)
  for (const [, seed] of seeded) {
    if (spreadWith(seed.members) > BATCH_SERENITY_WINDOW) continue
    const maj = majority(seed.members)
    const r = range(seed.members)!
    const center = (r[0] + r[1]) / 2
    const order = [...free].sort(
      (a, b) => (a.key === maj.key ? 0 : 1) - (b.key === maj.key ? 0 : 1) || Math.abs(a.m.serenity - center) - Math.abs(b.m.serenity - center),
    )
    for (const c of order) {
      if (seed.members.length >= PADDOCK_SLOTS) break
      if (!fits(seed.members, c)) continue
      seed.members.push(c)
      free = free.filter((x) => x !== c)
    }
  }

  // 2. Former les lots restants : même phase, fenêtre de 2 000, 10 au plus ; puis fusion des incomplets.
  const byKey = new Map<string, Cand[]>()
  for (const c of free) byKey.set(c.key, [...(byKey.get(c.key) ?? []), c])
  let batches: Batch[] = []
  for (const cs of byKey.values()) for (const w of windows(cs)) batches.push({ members: w })
  // Fusion du même côté de 0 d'abord ; à travers 0 seulement s'il manque des enclos (plus lent, moins cher).
  batches = mergeSmall(batches, false)
  const freeCount = [...seeds.values()].filter((b) => b.members.length === 0).length
  if (batches.length > freeCount) batches = mergeSmall(batches, true)
  // Lots pleins d'abord (rendement), puis les plus proches de la fécondité (rotation rapide).
  batches.sort((a, b) => b.members.length - a.members.length || avgPoints(a) - avgPoints(b) || avgSerenity(a) - avgSerenity(b))

  // 3. Placer les lots dans les enclos libres (de préférence là où leurs montures sont déjà).
  const finalBatch = new Map<number, Batch>()
  for (const [p, b] of seeds) if (b.members.length > 0) finalBatch.set(p, b)
  const waitingBatchesRaw: Batch[] = []
  for (const b of batches) {
    const freePaddocks = [...seeds.keys()].filter((p) => !finalBatch.has(p))
    if (freePaddocks.length === 0) {
      waitingBatchesRaw.push(b)
      continue
    }
    let best = freePaddocks[0]
    let bestOverlap = -1
    for (const p of freePaddocks) {
      const overlap = b.members.filter((c) => inPaddock(c.m, p)).length
      if (overlap > bestOverlap) {
        best = p
        bestOverlap = overlap
      }
    }
    finalBatch.set(best, b)
  }

  // 4. Plans, compléments XP et enclos Mangeoire.
  const assigned = new Set<string>()
  for (const b of finalBatch.values()) for (const c of b.members) assigned.add(c.m.id)
  const levelers = pool
    .filter((m) => !needsFertility(m) && m.level < MOUNT_MAX_LEVEL && xpTargetOf(m, opts) !== null)
    .sort((a, b) => a.level - b.level)
  const usedFillers = new Set<string>()
  const pickFillers = (p: number, n: number): Mount[] => {
    if (n <= 0) return []
    const order = [...levelers.filter((m) => inPaddock(m, p)), ...levelers.filter((m) => !inPaddock(m, p))]
    const out: Mount[] = []
    for (const m of order) {
      if (out.length >= n) break
      if (usedFillers.has(m.id)) continue
      // Une monture déjà dans un autre enclos débloqué y reste (pas de déplacement entre enclos pour l'XP).
      if (inPaddock(m) && !inPaddock(m, p) && m.location.kind === 'enclos' && m.location.paddock <= K) continue
      usedFillers.add(m.id)
      out.push(m)
    }
    return out
  }
  const planOpts = { tier: opts.tier, withXp, almanaxDoubled: opts.almanaxDoubled ?? null, rules: opts.rules, maxSeconds: opts.maxPlanSeconds }

  const paddocks: PaddockAssignment[] = []
  const placedAt = new Map<string, { paddock: number; reason: string }>()
  for (let p = 1; p <= K; p++) {
    const b = finalBatch.get(p)
    const members = b?.members ?? []
    const rationale: string[] = []
    const warnings: string[] = []
    let plan: FertilityPlan | null = null
    let fillers: Mount[] = []
    let firstGauges: GaugeId[] = []
    let totalSeconds = 0
    const r = range(members)
    if (members.length > 0) {
      plan = planPaddock(members.map((c) => c.sim), planOpts)
      const usesXp = plan.steps.some((s) => s.gauges.includes('mangeoire'))
      if (includeLeveling && usesXp) {
        fillers = pickFillers(p, PADDOCK_SLOTS - members.length)
        if (fillers.length > 0) plan = planPaddock([...members.map((c) => c.sim), ...fillers.map(toFillerSim)], planOpts)
      }
      firstGauges = plan.steps[0]?.gauges ?? majority(members).gauges
      totalSeconds = plan.totalSeconds
      const role = paddockRole(firstGauges)
      rationale.push(`${PADDOCK_ROLE_LABELS[role]} : phase « ${plan.steps[0]?.purpose ?? 'aucune'} ».`)
      if (r) {
        const width = r[1] - r[0]
        if (width > BATCH_SERENITY_WINDOW)
          warnings.push(`Sérénités de ${fmt(r[0])} à ${fmt(r[1])} (écart ${fmt(width)} > 2 000) : le lot ne restera pas groupé, scindez-le.`)
        else rationale.push(`Sérénité de ${fmt(r[0])} à ${fmt(r[1])} (écart ${fmt(width)} ≤ 2 000) : le lot traverse les zones ensemble.`)
      }
      for (const g of firstGauges) {
        if (g === 'mangeoire') continue
        const n = members.filter((c) => canBenefit(g, c.sim)).length
        if (n >= PADDOCK_SLOTS) rationale.push(`${GAUGE_LABELS[g]} : ${n}/${PADDOCK_SLOTS} montures éligibles, rendement maximal du carburant.`)
        else
          warnings.push(
            `${GAUGE_LABELS[g]} : ${n}/${PADDOCK_SLOTS} montures éligibles — ${Math.round(100 - (n / PADDOCK_SLOTS) * 100)} % du carburant de cette jauge ne profite à personne.`,
          )
      }
      rationale.push(
        `Palier ${opts.tier} (${FUEL_TIER_NAMES[opts.tier]}) entretenu : ${plan.steps.length} étape${plan.steps.length > 1 ? 's' : ''}, tout le lot féconde en ${formatDuration(plan.totalSeconds)}.`,
      )
      for (const w of plan.warnings) warnings.push(w)
      const kept = members.filter((c) => inPaddock(c.m, p)).length
      if (kept > 0 && kept < members.length) rationale.push(`${kept} déjà dans l'enclos, ${members.length - kept} à poser depuis l'étable.`)
      if (fillers.length > 0)
        rationale.push(
          `${fillers.length} place${fillers.length > 1 ? 's' : ''} complétée${fillers.length > 1 ? 's' : ''} par des montures à monter en niveau : elles gagnent l'XP pendant les phases avec Mangeoire, sans gêner le lot.`,
        )
    } else if (includeLeveling) {
      fillers = pickFillers(p, PADDOCK_SLOTS)
      if (fillers.length > 0) {
        firstGauges = ['mangeoire']
        totalSeconds = Math.max(
          ...fillers.map((m) => xpSeconds(m.level, xpTargetOf(m, opts) ?? m.level, { tier: opts.tier, rules: opts.rules, ability: m.ability, almanaxDoubled: opts.almanaxDoubled })),
        )
        rationale.push(`Aucun lot à rendre féconde pour cet enclos : Mangeoire seule pour monter ${fillers.length} monture${fillers.length > 1 ? 's' : ''} (parents vers le niveau visé, revente ou brisage).`)
        rationale.push(`Palier ${opts.tier} : la dernière atteint son niveau visé en ${formatDuration(totalSeconds)}.`)
        if (fillers.length < PADDOCK_SLOTS)
          warnings.push(`Mangeoire : ${fillers.length}/${PADDOCK_SLOTS} montures — ${Math.round(100 - (fillers.length / PADDOCK_SLOTS) * 100)} % du carburant ne profite à personne.`)
      }
    }
    const role = paddockRole(firstGauges)
    const ids = [...members.map((c) => c.m.id), ...fillers.map((m) => m.id)]
    const eligible: Partial<Record<GaugeId, number>> = {}
    for (const g of firstGauges) {
      const sims = [...members.map((c) => c.sim), ...fillers.map(toFillerSim)]
      eligible[g] = sims.filter((s) => canBenefit(g, s)).length
    }
    for (const c of members)
      placedAt.set(c.m.id, { paddock: p, reason: `${PADDOCK_ROLE_LABELS[role]}${r ? ` (sérénité ${fmt(r[0])} à ${fmt(r[1])})` : ''}` })
    for (const m of fillers)
      placedAt.set(m.id, { paddock: p, reason: `Complément XP (Mangeoire) jusqu'au niveau ${xpTargetOf(m, opts)}` })
    paddocks.push({
      paddockId: p,
      role,
      mountIds: ids,
      keptIds: ids.filter((id) => {
        const m = pool.find((x) => x.id === id)
        return m !== undefined && inPaddock(m, p)
      }),
      addedIds: ids.filter((id) => {
        const m = pool.find((x) => x.id === id)
        return m !== undefined && !inPaddock(m, p)
      }),
      fillerIds: fillers.map((m) => m.id),
      plan,
      firstGauges,
      eligible,
      serenityRange: r,
      totalSeconds,
      rationale,
      warnings,
    })
  }

  // 5. Déplacements : entrées, sorties (fécondes, stériles, enclos verrouillés, attente).
  const moves: MountMove[] = []
  const waitingIds = new Set(waitingBatchesRaw.flatMap((b) => b.members.map((c) => c.m.id)))
  for (const m of pool) {
    const target = placedAt.get(m.id)
    if (target) {
      const to: MountLocation = { kind: 'enclos', paddock: target.paddock }
      if (!sameLocation(m.location, to)) moves.push({ mountId: m.id, from: m.location, to, reason: target.reason })
      continue
    }
    if (m.location.kind !== 'enclos') continue
    const p = m.location.paddock
    const f = effectiveFertility(m)
    let reason: string
    if (p > K) reason = `Enclos ${p} non débloqué (Éleveur niveau ${PADDOCK_UNLOCK_LEVELS[p - 1]?.level ?? '?'} requis).`
    else if (waitingIds.has(m.id)) reason = "En attente d'un enclos libre (lot suivant) : à garder à l'étable."
    else if (f === 'feconde') reason = "Féconde : l'accouplement se fait depuis l'étable (les deux parents doivent y être)."
    else if (f === 'sterile') reason = "Stérile : n'a plus besoin des jauges de fécondité (clonage, vente, extraction ou brisage)."
    else if (f === 'senile') reason = 'Sénile : ni accouplement ni clonage, à ranger (extraction ou vente).'
    else reason = "Pas de lot compatible dans cet enclos : à ranger à l'étable."
    moves.push({ mountId: m.id, from: m.location, to: { kind: 'etable' }, reason })
  }

  // 6. File d'attente : lots suivants dans l'ordre de passage.
  const waitingBatches: WaitingBatch[] = waitingBatchesRaw.map((b, i) => {
    const maj = majority(b.members)
    return {
      index: i + 1,
      mountIds: b.members.map((c) => c.m.id),
      serenityRange: range(b.members) ?? [0, 0],
      role: paddockRole(maj.gauges),
      firstGauges: maj.gauges,
    }
  })
  const waiting: WaitingMount[] = waitingBatches.flatMap((b) =>
    b.mountIds.map((id) => ({
      mountId: id,
      batch: b.index,
      reason: `Lot suivant n° ${b.index} (${PADDOCK_ROLE_LABELS[b.role]}, sérénité ${fmt(b.serenityRange[0])} à ${fmt(b.serenityRange[1])}) : attendre qu'un enclos se libère.`,
    })),
  )

  // 7. Conseils.
  const suggestions: string[] = []
  const advice = allocationAdvice(K)
  const placed = paddocks.reduce((s, a) => s + a.mountIds.length - a.fillerIds.length, 0)
  const fillerCount = paddocks.reduce((s, a) => s + a.fillerIds.length, 0)
  if (fertility.length === 0)
    suggestions.push("Aucune monture à rendre féconde : capturez des G1 ou faites vos accouplements et clonages pour remplir les enclos.")
  if (waiting.length > 0)
    suggestions.push(
      `${waiting.length} monture${waiting.length > 1 ? 's attendent' : ' attend'} une place (${waitingBatches.length} lot${waitingBatches.length > 1 ? 's' : ''} déjà formé${waitingBatches.length > 1 ? 's' : ''}) : laissez-les à l'étable et posez le lot suivant dès qu'un enclos est fécond.${K < PADDOCK_UNLOCK_LEVELS.length ? ` Le prochain enclos se débloque au niveau ${PADDOCK_UNLOCK_LEVELS[K].level} d'Éleveur.` : ''}`,
    )
  for (const a of paddocks) {
    const core = a.mountIds.length - a.fillerIds.length
    if (core > 0 && a.mountIds.length < PADDOCK_SLOTS && a.serenityRange) {
      const lo = Math.max(-5_000, a.serenityRange[1] - BATCH_SERENITY_WINDOW)
      const hi = Math.min(5_000, a.serenityRange[0] + BATCH_SERENITY_WINDOW)
      suggestions.push(
        `Enclos ${a.paddockId} : ${a.mountIds.length}/${PADDOCK_SLOTS} places utilisées — complétez avec des montures de sérénité entre ${fmt(lo)} et ${fmt(hi)} (captures, bébés, clones)${withXp ? '' : ' ou activez la Mangeoire en complément pour y mettre des montures à monter'}.`,
      )
    }
    if (a.role === 'vide')
      suggestions.push(`Enclos ${a.paddockId} libre : capturez une dizaine de montures (même smiley de sérénité) ou utilisez-le en Mangeoire pour monter des montures à revendre.`)
  }
  if (opts.almanaxDoubled)
    suggestions.push(`Almanax du jour : le gain de ${GAUGE_LABELS[opts.almanaxDoubled]} est doublé (effet exact non vérifié) — programmez cette phase dans tous les enclos aujourd'hui.`)
  if (paddocks.some((a) => a.firstGauges.includes('caresseur') || a.firstGauges.includes('baffeur')))
    suggestions.push('Station de sérénité : mettez une alarme, Baffeur et Caresseur continuent de pousser les montures déjà arrivées (jamais actifs la nuit).')

  return {
    paddocks,
    moves,
    waiting,
    waitingBatches,
    suggestions,
    allocationAdvice: advice,
    stats: { paddocks: K, slots: K * PADDOCK_SLOTS, fertility: fertility.length, placed, waiting: waiting.length, fillers: fillerCount },
  }
}

// ---------- Conseils de recharge ----------

export interface RefillOptions {
  ctx: PriceContext
  rules: Ruleset
  jobLevel: number
  /** Palier entretenu. */
  tier: FuelTier
  /** Exclure les prix « craft » des carburants que le joueur ne sait pas fabriquer. */
  craftableOnly?: boolean
}

export interface RefillItem {
  fuelId: number
  name: string
  count: number
  unitPrice: number | null
  subtotal: number | null
  complete: boolean
  canCraft: boolean
  craftLevel: number
  durability: number
}

export interface RefillLine {
  gauge: GaugeId
  current: number
  /** Points que le plan consomme sur cette jauge. */
  consumed: number
  /** Points à ajouter au total (socle + dépôt initial + recharges). */
  added: number
  /**
   * Socle (paliers ≥ 2) : remonter la jauge jusqu'au bas du palier pour qu'elle tourne à ce palier.
   * Ces points ne sont pas consommés par le plan : ils restent dans la jauge (investissement unique).
   */
  base: FillPlan | null
  /** Dépôt à faire maintenant pour le plan, au-dessus du socle (null si la jauge suffit). */
  initial: FillPlan | null
  /** Recharges ultérieures, chacune du bas au haut du palier. */
  refillCount: number
  refillFrom: number
  refillTo: number
  /** Une recharge complète du palier (null si aucune). */
  refillPlan: FillPlan | null
  /** Dernière recharge partielle (null si aucune). */
  lastRefillPlan: FillPlan | null
  /** Tous les carburants à acheter ou fabriquer (socle compris). */
  items: RefillItem[]
  /** Coût total, socle compris (borne basse si incomplet ; null si rien n'est chiffré). */
  cost: number | null
  /** Coût du socle seul (0 sans socle). */
  baseCost: number | null
  /** Coût de ce que le plan consomme (dépôt initial + recharges). */
  runCost: number | null
  complete: boolean
  missing: number[]
  /** Points qui resteront dans la jauge à la fin du plan (réutilisables). */
  leftover: number
  /** Coût au point du carburant le moins cher du palier (bestFuel). */
  pointCost: GaugePointCost
  notes: string[]
}

export interface RefillAdvice {
  lines: RefillLine[]
  /** Total (borne basse si incomplet ; null si rien n'est chiffré). */
  cost: number | null
  baseCost: number | null
  runCost: number | null
  complete: boolean
  missing: number[]
}

interface CostSum {
  items: Map<number, RefillItem>
  cost: number
  complete: boolean
  missing: number[]
}

function sumPlans(parts: [FillPlan | null, number][]): CostSum {
  const items = new Map<number, RefillItem>()
  let complete = true
  const missing: number[] = []
  for (const [plan, times] of parts) {
    if (!plan || times <= 0) continue
    if (!plan.complete || !plan.feasible) complete = false
    missing.push(...plan.missing)
    for (const it of plan.items) {
      const o = it.option
      const e = items.get(o.fuel.id)
      if (e) e.count += it.count * times
      else
        items.set(o.fuel.id, {
          fuelId: o.fuel.id,
          name: o.fuel.name,
          count: it.count * times,
          unitPrice: o.unitPrice,
          subtotal: null,
          complete: o.complete,
          canCraft: o.canCraft,
          craftLevel: o.craftLevel,
          durability: o.durability,
        })
    }
  }
  let cost = 0
  for (const it of items.values()) {
    it.subtotal = it.unitPrice === null ? null : it.unitPrice * it.count
    cost += it.subtotal ?? 0
  }
  return { items, cost, complete, missing }
}

/** Montant affichable : exact si complet, borne basse si incomplet mais partiellement chiffré, sinon null. */
const shownCost = (c: { cost: number; complete: boolean }, empty: boolean) => (c.complete || c.cost > 0 ? c.cost : empty ? 0 : null)

const pointsOf = (p: FillPlan | null) => (p?.feasible ? p.reached - p.from : 0)

/**
 * Quel carburant acheter ou fabriquer, et combien, pour mener un plan à son terme en entretenant le
 * palier : socle (paliers ≥ 2 : remonter la jauge au bas du palier, points qui restent dans la
 * jauge), dépôt initial (juste ce que le plan consomme, au plus le plafond du palier), puis
 * recharges du bas au haut du palier. Utilise `fillPlan` (le moins cher au point, sans
 * débordement) ; un prix manquant rend le coût incomplet (jamais compté 0).
 */
export function refillAdvice(
  state: Pick<PaddockState, 'gauges'>,
  plan: { consumed: Partial<Record<GaugeId, number>> },
  opts: RefillOptions,
): RefillAdvice {
  const T = opts.tier
  const cap = opts.rules.gaugeTierMax[T]
  const floor = T > 1 ? opts.rules.gaugeTierMax[(T - 1) as FuelTier] : 0
  const span = cap - floor
  const fuelOpts = { jobLevel: opts.jobLevel, rules: opts.rules, craftableOnly: opts.craftableOnly }
  const lines: RefillLine[] = []
  for (const g of GAUGE_IDS) {
    const consumed = Math.max(0, Math.round(plan.consumed[g] ?? 0))
    if (consumed <= 0) continue
    const current = Math.max(0, state.gauges[g] ?? 0)
    const serenityGauge = g === 'baffeur' || g === 'caresseur'
    const notes: string[] = []
    // Points du palier disponibles sans rien ajouter (au-dessus du bas du palier).
    let level = current
    let usable = Math.max(0, level - floor)
    let base: FillPlan | null = null
    let initial: FillPlan | null = null
    if (usable < consumed && level < cap) {
      if (level < floor) {
        base = fillPlan(g, level, floor, opts.ctx, fuelOpts)
        if (base.feasible) level = base.reached
      }
      const target = Math.min(cap, Math.max(level, floor) + consumed)
      if (level < target) {
        initial = fillPlan(g, level, target, opts.ctx, fuelOpts)
        if (initial.feasible) level = initial.reached
      }
      usable = Math.max(0, level - floor)
    }
    const remaining = Math.max(0, consumed - usable)
    const refillCount = span > 0 ? Math.ceil(remaining / span) : 0
    const fullRefills = Math.max(0, refillCount - 1)
    const lastPoints = refillCount > 0 ? remaining - fullRefills * span : 0
    const refillPlan = fullRefills > 0 ? fillPlan(g, floor, cap, opts.ctx, fuelOpts) : null
    const lastRefillPlan = lastPoints > 0 ? fillPlan(g, floor, floor + lastPoints, opts.ctx, fuelOpts) : null
    const all = sumPlans([
      [base, 1],
      [initial, 1],
      [refillPlan, fullRefills],
      [lastRefillPlan, 1],
    ])
    const baseSum = sumPlans([[base, 1]])
    const runSum = sumPlans([
      [initial, 1],
      [refillPlan, fullRefills],
      [lastRefillPlan, 1],
    ])
    const added = pointsOf(base) + pointsOf(initial) + fullRefills * span + pointsOf(lastRefillPlan)
    const leftover = Math.max(0, current + added - consumed)
    if (current > cap) notes.push(`Jauge au-dessus du palier ${T} : elle tourne plus vite (palier supérieur) jusqu'à redescendre à ${fmt(cap)}.`)
    if (base)
      notes.push(
        `Socle : sous ${fmt(floor)}, la jauge tourne au palier inférieur. Les ${fmt(pointsOf(base))} points du socle restent dans la jauge après le plan (à faire une seule fois).`,
      )
    if (refillCount > 0) notes.push(`Rechargez quand la jauge passe sous ${fmt(floor)} (bas du palier ${T}) : ${refillCount} recharge${refillCount > 1 ? 's' : ''}.`)
    if (serenityGauge)
      notes.push(
        T === 1 && current === 0
          ? 'Jauge de sérénité remplie au plus juste : elle s’arrête d’elle-même, gardez quand même une alarme.'
          : 'Jauge de sérénité : mettez une alarme et coupez-la à distance à l’heure prévue (elle continue de pousser les montures arrivées).',
      )
    lines.push({
      gauge: g,
      current,
      consumed,
      added,
      base,
      initial,
      refillCount,
      refillFrom: floor,
      refillTo: cap,
      refillPlan,
      lastRefillPlan,
      items: [...all.items.values()],
      cost: shownCost(all, all.items.size === 0),
      baseCost: shownCost(baseSum, baseSum.items.size === 0),
      runCost: shownCost(runSum, runSum.items.size === 0),
      complete: all.complete,
      missing: [...new Set(all.missing)],
      leftover,
      pointCost: bestFuel(g, T, opts.ctx, fuelOpts),
      notes,
    })
  }
  const total = (pick: (l: RefillLine) => number | null) => {
    const complete = lines.every((l) => l.complete)
    const sum = lines.reduce((s, l) => s + (pick(l) ?? 0), 0)
    return complete || sum > 0 ? sum : null
  }
  return {
    lines,
    cost: lines.length === 0 ? 0 : total((l) => l.cost),
    baseCost: lines.length === 0 ? 0 : total((l) => l.baseCost),
    runCost: lines.length === 0 ? 0 : total((l) => l.runCost),
    complete: lines.every((l) => l.complete),
    missing: [...new Set(lines.flatMap((l) => l.missing))],
  }
}

// ---------- Simulation à partir des jauges saisies ----------

export interface CurrentSimOptions {
  rules: Ruleset
  almanaxDoubled?: GaugeId | null
  /** Défaut : 24 h. */
  maxSeconds?: number
}

/**
 * Simule l'enclos tel qu'il est (niveaux de jauges saisis, jauges actives, sans recharge) pendant
 * 24 h ou jusqu'à ce qu'aucune jauge active ne serve plus. Jauges actives invalides → erreur.
 */
export function simulateCurrent(state: Pick<PaddockState, 'gauges' | 'active'>, mounts: Mount[], opts: CurrentSimOptions): SimulateResult {
  return simulatePaddock({
    gauges: { ...state.gauges },
    active: state.active,
    mounts: mounts.map(toSimMount),
    almanaxDoubled: opts.almanaxDoubled ?? null,
    maxSeconds: opts.maxSeconds ?? 86_400,
    stopWhenIdle: true,
    rules: opts.rules,
  })
}

export type TimelineTone = 'info' | 'ok' | 'warn' | 'danger'

export interface TimelineEntry {
  /** Secondes depuis le début de la simulation. */
  t: number
  kind: 'gauge-tier' | 'gauge-empty' | 'stat-max' | 'band' | 'fecund' | 'idle'
  text: string
  tone: TimelineTone
  gauge?: GaugeId
  mountIds: string[]
}

const STAT_LABELS = { endurance: 'Endurance', maturity: 'Maturité', love: 'Amour' } as const

/** Chronologie lisible (FR) d'une simulation : événements regroupés par instant et par nature. */
export function simulationTimeline(res: SimulateResult, nameOf: (id: string) => string, rules: Ruleset): TimelineEntry[] {
  const groups = new Map<string, TimelineEntry>()
  const order: string[] = []
  for (const e of res.events) {
    let key: string
    let entry: TimelineEntry
    switch (e.kind) {
      case 'gauge-tier':
        key = `${e.t}|tier|${e.gauge}`
        entry = {
          t: e.t,
          kind: 'gauge-tier',
          gauge: e.gauge,
          mountIds: [],
          tone: 'info',
          text: e.tier === 0 ? `${GAUGE_LABELS[e.gauge]} vide.` : `${GAUGE_LABELS[e.gauge]} passe au palier ${e.tier} (${FUEL_TIER_NAMES[e.tier]}) : ${rules.gaugeRatePerTick[e.tier]} points par tick de 10 s.`,
        }
        break
      case 'gauge-empty':
        key = `${e.t}|empty|${e.gauge}`
        entry = { t: e.t, kind: 'gauge-empty', gauge: e.gauge, mountIds: [], tone: 'warn', text: `${GAUGE_LABELS[e.gauge]} est vide : rechargez-la si le lot en a encore besoin.` }
        break
      case 'stat-max':
        key = `${e.t}|stat|${e.stat}`
        entry = { t: e.t, kind: 'stat-max', mountIds: [e.mountId], tone: 'ok', text: `${STAT_LABELS[e.stat]} au maximum (20 000)` }
        break
      case 'band':
        key = `${e.t}|band|${e.band}`
        entry = { t: e.t, kind: 'band', mountIds: [e.mountId], tone: 'info', text: `Passe en zone ${SERENITY_SMILEYS[e.band].label}` }
        break
      case 'fecund':
        key = `${e.t}|fecund`
        entry = { t: e.t, kind: 'fecund', mountIds: [e.mountId], tone: 'ok', text: 'Féconde' }
        break
      case 'idle':
        key = `${e.t}|idle`
        entry = {
          t: e.t,
          kind: 'idle',
          mountIds: [],
          tone: 'danger',
          text: "Plus aucune jauge active ne profite à une monture : l'enclos est à l'arrêt, changez de jauges.",
        }
        break
    }
    const prev = groups.get(key)
    if (prev) prev.mountIds.push(...entry.mountIds)
    else {
      groups.set(key, entry)
      order.push(key)
    }
  }
  return order.map((k) => {
    const e = groups.get(k)!
    if (e.mountIds.length === 0) return e
    const names = e.mountIds.map(nameOf)
    const label = e.kind === 'fecund' ? (names.length > 1 ? 'Fécondes' : 'Féconde') : e.text
    return { ...e, text: `${label} : ${names.join(', ')}.` }
  })
}

// ---------- Changement de jauges et suivi d'un plan démarré ----------

export interface GaugeSwitch {
  off: GaugeId[]
  on: GaugeId[]
  keep: GaugeId[]
  /** « désactiver Caresseur, activer Abreuvoir » (minuscule initiale). */
  text: string
}

/** Ce qu'il faut faire en jeu pour passer des jauges `from` aux jauges `to`. */
export function gaugeSwitch(from: GaugeId[], to: GaugeId[]): GaugeSwitch {
  const off = from.filter((g) => !to.includes(g))
  const on = to.filter((g) => !from.includes(g))
  const keep = from.filter((g) => to.includes(g))
  const parts: string[] = []
  if (off.length) parts.push(`désactiver ${off.map((g) => GAUGE_LABELS[g]).join(' et ')}`)
  if (on.length) parts.push(`activer ${on.map((g) => GAUGE_LABELS[g]).join(' et ')}`)
  if (keep.length && (off.length || on.length)) parts.push(`garder ${keep.map((g) => GAUGE_LABELS[g]).join(' et ')}`)
  return { off, on, keep, text: parts.length ? parts.join(', ') : 'aucun changement' }
}

/** Plan démarré, sous forme sérialisable (voir src/store/paddockPlans.ts). */
export interface PlanSchedule {
  /** Instant (ms) où la première étape a été appliquée en jeu. */
  startedAt: number
  /** Décalage (ms) cumulé quand un changement a été fait en avance ou en retard. */
  offsetMs?: number
  steps: FertilityStep[]
  totalSeconds: number
  /** Index de l'étape appliquée en jeu (0 au démarrage ; steps.length = plan terminé). */
  acknowledgedStepIndex: number
}

export interface NextSwitch {
  /** Étape vers laquelle basculer (steps.length = fin du plan : tout couper). */
  index: number
  /** Heure prévue (ms). */
  at: number
  /** Fenêtre de changement des étapes de sérénité (ms), sinon null. */
  earliest: number | null
  latest: number | null
  from: GaugeId[]
  to: GaugeId[]
  text: string
  final: boolean
}

/** Heures absolues (ms) de début et de fin de chaque étape. */
export function stepTimes(s: PlanSchedule): { startAt: number; endAt: number }[] {
  const base = s.startedAt + (s.offsetMs ?? 0)
  return s.steps.map((st) => ({ startAt: base + st.startSeconds * 1000, endAt: base + (st.startSeconds + st.durationSeconds) * 1000 }))
}

/** Prochain changement de jauges à faire (null si le plan est terminé ou vide). */
export function nextSwitchOf(s: PlanSchedule): NextSwitch | null {
  const ack = s.acknowledgedStepIndex
  if (ack < 0 || ack >= s.steps.length) return null
  const base = s.startedAt + (s.offsetMs ?? 0)
  const cur = s.steps[ack]
  const next = s.steps[ack + 1]
  const at = base + (next ? next.startSeconds : cur.startSeconds + cur.durationSeconds) * 1000
  const to = next?.gauges ?? []
  const w = cur.switchWindow
  const sw = gaugeSwitch(cur.gauges, to)
  return {
    index: ack + 1,
    at,
    earliest: w ? base + w.earliestSeconds * 1000 : null,
    latest: w ? base + w.latestSeconds * 1000 : null,
    from: cur.gauges,
    to,
    text: next ? sw.text : `${sw.text} — plan terminé, sortez les fécondes vers l'étable`,
    final: !next,
  }
}

export interface PlanProgress {
  /** Étape appliquée en jeu (index), ou steps.length si terminé. */
  index: number
  step: FertilityStep | null
  startAt: number | null
  endAt: number | null
  /** Étape où le plan devrait être d'après l'horloge (ignore les validations). */
  scheduledIndex: number
  next: NextSwitch | null
  /** Le prochain changement est dû (heure prévue passée). */
  due: boolean
  /** La fin de la fenêtre de changement (sérénité) est dépassée : risque de sortir de la zone. */
  late: boolean
  msToNext: number | null
  finished: boolean
  /** Avancement (0 … 1) du plan complet. */
  fraction: number
}

/** État d'un plan démarré à l'instant `now`. */
export function planProgress(s: PlanSchedule, now: number): PlanProgress {
  const times = stepTimes(s)
  const finished = s.acknowledgedStepIndex >= s.steps.length
  const index = Math.min(s.acknowledgedStepIndex, s.steps.length)
  let scheduledIndex = s.steps.length
  for (let i = 0; i < times.length; i++)
    if (now < times[i].endAt) {
      scheduledIndex = i
      break
    }
  const next = nextSwitchOf(s)
  const base = s.startedAt + (s.offsetMs ?? 0)
  const total = s.totalSeconds * 1000
  return {
    index,
    step: s.steps[index] ?? null,
    startAt: times[index]?.startAt ?? null,
    endAt: times[index]?.endAt ?? null,
    scheduledIndex,
    next,
    due: next !== null && now >= next.at,
    late: next !== null && next.latest !== null && now > next.latest,
    msToNext: next ? next.at - now : null,
    finished,
    fraction: finished ? 1 : total > 0 ? Math.max(0, Math.min(1, (now - base) / total)) : 0,
  }
}

/** Validation d'une étape : nouvelle valeur d'index et de décalage (heure réelle facultative). */
export function acknowledgeStep(s: PlanSchedule, at?: number): { acknowledgedStepIndex: number; offsetMs: number } {
  const next = nextSwitchOf(s)
  const offset = s.offsetMs ?? 0
  if (!next) return { acknowledgedStepIndex: s.acknowledgedStepIndex, offsetMs: offset }
  return { acknowledgedStepIndex: next.index, offsetMs: at === undefined ? offset : offset + (at - next.at) }
}
