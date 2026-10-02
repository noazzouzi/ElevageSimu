// Simulation des enclos : jauges, tiers, sérénité, endurance, maturité, amour, expérience.
// Modèle (guide DPLN 2026) : toutes les 10 s, chaque jauge active consomme N points selon son tier
// (10/20/30/40) et chaque monture de l'enclos qui peut en profiter gagne N points dans la jauge
// correspondante (×2 avec la capacité adaptée ou le bonus Almanax du jour). Une jauge ne se vide pas
// si aucune monture de l'enclos ne peut en profiter.
import { formatDuration as formatDurationLong } from '../lib/format'
import {
  ABILITY_DOUBLES,
  ENDURANCE_SERENITY_MAX,
  LOVE_SERENITY_MIN,
  MATURITY_SERENITY_RANGE,
  MAX_ACTIVE_GAUGES,
  MOUNT_STAT_MAX,
  SERENITY_MAX,
  SERENITY_MIN,
  TICK_SECONDS,
} from './constants'
import { RULESETS, type Ruleset } from './rules'
import type { Ability, FuelTier, GaugeId, MountGauges } from './types'

const LIVE = RULESETS['3.6']

/** Tier courant d'une jauge (0 = vide). */
export function gaugeTier(value: number, rules: Ruleset = LIVE): FuelTier | 0 {
  const max = rules.gaugeTierMax
  if (value <= 0) return 0
  if (value <= max[1]) return 1
  if (value <= max[2]) return 2
  if (value <= max[3]) return 3
  return 4
}

/** Points consommés par tick pour une jauge à ce niveau (borné par ce qu'il reste). */
export function gaugeRate(value: number, rules: Ruleset = LIVE): number {
  const tier = gaugeTier(value, rules)
  if (tier === 0) return 0
  return Math.min(rules.gaugeRatePerTick[tier], value)
}

/** Secondes nécessaires pour qu'une jauge passe de `from` à `to` (to < from), sans recharge. */
export function gaugeDrainSeconds(from: number, to = 0, rules: Ruleset = LIVE): number {
  let ticks = 0
  let v = Math.min(from, rules.gaugeTierMax[4])
  while (v > to) {
    const tier = gaugeTier(v, rules) as FuelTier
    const floor = Math.max(to, tier === 1 ? 0 : rules.gaugeTierMax[(tier - 1) as FuelTier])
    const rate = rules.gaugeRatePerTick[tier]
    const n = Math.ceil((v - floor) / rate)
    ticks += n
    v -= n * rate
  }
  return ticks * TICK_SECONDS
}

export type SerenityBand = 'endurance' | 'endurance-maturite' | 'amour-maturite' | 'amour'

/** Zone de sérénité (correspond aux smileys en jeu : rouge, bleu, violet, vert). */
export function serenityBand(serenity: number): SerenityBand {
  if (serenity < MATURITY_SERENITY_RANGE[0]) return 'endurance'
  if (serenity < LOVE_SERENITY_MIN) return 'endurance-maturite'
  if (serenity <= MATURITY_SERENITY_RANGE[1]) return 'amour-maturite'
  return 'amour'
}

export const SERENITY_BAND_LABELS: Record<SerenityBand, string> = {
  endurance: 'Endurance (sérénité < -2 000)',
  'endurance-maturite': 'Endurance + Maturité (-2 000 à -1)',
  'amour-maturite': 'Amour + Maturité (0 à 2 000)',
  amour: 'Amour (sérénité > 2 000)',
}

export function isFecund(m: MountGauges): boolean {
  return m.endurance >= MOUNT_STAT_MAX && m.maturity >= MOUNT_STAT_MAX && m.love >= MOUNT_STAT_MAX
}

/** Monture telle que vue par le simulateur. */
export interface SimMount extends MountGauges {
  id: string
  ability: Ability | null
  /** XP gagnée pendant la simulation (accumulée). */
  xpGained?: number
  /** Si vrai, la monture profite de la mangeoire (niveau < 200). */
  canGainXp?: boolean
}

/** Une monture peut-elle profiter de cette jauge maintenant ? */
export function canBenefit(gauge: GaugeId, m: SimMount): boolean {
  switch (gauge) {
    case 'caresseur':
      return m.serenity < SERENITY_MAX
    case 'baffeur':
      return m.serenity > SERENITY_MIN
    case 'foudroyeur':
      return m.serenity <= ENDURANCE_SERENITY_MAX && m.endurance < MOUNT_STAT_MAX
    case 'abreuvoir':
      return (
        m.serenity >= MATURITY_SERENITY_RANGE[0] &&
        m.serenity <= MATURITY_SERENITY_RANGE[1] &&
        m.maturity < MOUNT_STAT_MAX
      )
    case 'dragofesse':
      return m.serenity >= LOVE_SERENITY_MIN && m.love < MOUNT_STAT_MAX
    case 'mangeoire':
      return m.canGainXp !== false
  }
}

/**
 * Jour Almanax « effet doublé » : une jauge constante (toute la simulation), ou une fonction du temps
 * (secondes depuis le début de la simulation, au début du tick) pour ne doubler que les ticks qui
 * tombent le jour Almanax (voir `almanaxScheduleFrom` dans fertility.ts).
 */
export type AlmanaxInput = GaugeId | null | ((tSeconds: number) => GaugeId | null)

/** Jauge doublée par l'Almanax à l'instant `tSeconds` de la simulation. */
export function almanaxAtTime(input: AlmanaxInput | undefined, tSeconds: number): GaugeId | null {
  if (typeof input === 'function') return input(tSeconds)
  return input ?? null
}

/** Multiplicateur de gain pour une monture (capacité + Almanax). */
export function gainMultiplier(gauge: GaugeId, ability: Ability | null, almanaxDoubled: GaugeId | null): number {
  let k = 1
  if (ability && ABILITY_DOUBLES[ability] === gauge) k *= 2
  if (almanaxDoubled === gauge) k *= 2
  return k
}

/** Vérifie qu'une combinaison de jauges actives est autorisée. */
export function validateActiveGauges(active: GaugeId[]): string | null {
  if (active.length > MAX_ACTIVE_GAUGES) return `Au plus ${MAX_ACTIVE_GAUGES} jauges actives.`
  if (new Set(active).size !== active.length) return 'Jauge en double.'
  if (active.includes('baffeur') && active.includes('caresseur'))
    return 'Baffeur et Caresseur ne peuvent pas être actifs en même temps.'
  return null
}

export type SimEvent =
  | { t: number; kind: 'gauge-tier'; gauge: GaugeId; tier: FuelTier | 0 }
  | { t: number; kind: 'gauge-empty'; gauge: GaugeId }
  | { t: number; kind: 'stat-max'; mountId: string; stat: 'endurance' | 'maturity' | 'love' }
  | { t: number; kind: 'band'; mountId: string; band: SerenityBand }
  | { t: number; kind: 'fecund'; mountId: string }
  | { t: number; kind: 'idle' }

export interface SimulateInput {
  gauges: Record<GaugeId, number>
  active: GaugeId[]
  mounts: SimMount[]
  /**
   * Jauge dont l'effet est doublé par l'Almanax : constante, ou fonction du temps de simulation
   * (secondes au début du tick) pour un doublement limité au jour Almanax.
   */
  almanaxDoubled?: AlmanaxInput
  /**
   * Tier maintenu par le joueur (recharges régulières) : la jauge agit toujours à ce tier et la
   * consommation est comptabilisée sans vider la jauge. Sinon la jauge se vide normalement.
   */
  maintainTier?: Partial<Record<GaugeId, FuelTier>>
  /** Durée maximale simulée (s). */
  maxSeconds: number
  /** Arrêter dès que toutes les montures sont fécondes. */
  stopWhenAllFecund?: boolean
  /** Arrêter dès qu'aucune jauge active ne profite à personne (défaut : vrai). */
  stopWhenIdle?: boolean
  /** Arrêter dès qu'une monture change de zone de sérénité (utile pour planifier une alarme). */
  stopOnBandChange?: boolean
  /** Condition d'arrêt personnalisée, évaluée après chaque tick. */
  stopWhen?: (mounts: SimMount[], seconds: number) => boolean
  /** Règles du jeu (paliers de jauge). Défaut : 3.6. */
  rules?: Ruleset
}

export interface SimulateResult {
  seconds: number
  gauges: Record<GaugeId, number>
  mounts: SimMount[]
  /** Points de carburant consommés par jauge. */
  consumed: Record<GaugeId, number>
  events: SimEvent[]
  /** Instant (s) où chaque monture est devenue féconde. */
  fecundAt: Record<string, number>
}

const ZERO_GAUGES = (): Record<GaugeId, number> => ({
  baffeur: 0,
  caresseur: 0,
  foudroyeur: 0,
  abreuvoir: 0,
  dragofesse: 0,
  mangeoire: 0,
})

/** Simule un enclos tick par tick (10 s). */
export function simulatePaddock(input: SimulateInput): SimulateResult {
  const err = validateActiveGauges(input.active)
  if (err) throw new Error(err)
  const rules = input.rules ?? LIVE
  const stopWhenIdle = input.stopWhenIdle ?? true
  // Niveaux bornés au plafond des règles actives (une saisie faite sous une autre version peut le
  // dépasser) : même borne que `gaugeDrainSeconds`, pour que l'Enclos et l'Accueil concordent (R9).
  const gauges = { ...ZERO_GAUGES(), ...input.gauges }
  const cap = rules.gaugeTierMax[4]
  for (const g of Object.keys(gauges) as GaugeId[]) gauges[g] = Math.max(0, Math.min(cap, Number.isFinite(gauges[g]) ? gauges[g] : 0))
  const mounts = input.mounts.map((m) => ({ ...m, xpGained: m.xpGained ?? 0 }))
  const consumed = ZERO_GAUGES()
  const events: SimEvent[] = []
  const fecundAt: Record<string, number> = {}
  const bands = new Map(mounts.map((m) => [m.id, serenityBand(m.serenity)]))
  const tiers = new Map(input.active.map((g) => [g, gaugeTier(gauges[g], rules)]))
  for (const m of mounts) if (isFecund(m)) fecundAt[m.id] = 0

  const maxTicks = Math.floor(input.maxSeconds / TICK_SECONDS)
  let tick = 0
  for (; tick < maxTicks; tick++) {
    const t = (tick + 1) * TICK_SECONDS
    const almanax = almanaxAtTime(input.almanaxDoubled, tick * TICK_SECONDS)
    // Gains calculés sur l'état en début de tick, pour toutes les jauges actives.
    const gains: { gauge: GaugeId; rate: number; who: SimMount[] }[] = []
    for (const g of input.active) {
      const maintained = input.maintainTier?.[g]
      const rate = maintained ? rules.gaugeRatePerTick[maintained] : gaugeRate(gauges[g], rules)
      if (rate <= 0) continue
      const who = mounts.filter((m) => canBenefit(g, m))
      if (who.length === 0) continue
      gains.push({ gauge: g, rate, who })
    }
    if (gains.length === 0) {
      if (stopWhenIdle) {
        events.push({ t: tick * TICK_SECONDS, kind: 'idle' })
        break
      }
      continue
    }
    for (const { gauge, rate, who } of gains) {
      consumed[gauge] += rate
      if (!input.maintainTier?.[gauge]) gauges[gauge] = Math.max(0, gauges[gauge] - rate)
      for (const m of who) {
        const amount = rate * gainMultiplier(gauge, m.ability, almanax)
        applyGain(gauge, m, amount, t, events)
      }
    }
    // Événements de tier de jauge.
    for (const g of input.active) {
      if (input.maintainTier?.[g]) continue
      const tier = gaugeTier(gauges[g], rules)
      if (tier !== tiers.get(g)) {
        tiers.set(g, tier)
        events.push(tier === 0 ? { t, kind: 'gauge-empty', gauge: g } : { t, kind: 'gauge-tier', gauge: g, tier })
      }
    }
    let bandChanged = false
    for (const m of mounts) {
      const b = serenityBand(m.serenity)
      if (b !== bands.get(m.id)) {
        bands.set(m.id, b)
        events.push({ t, kind: 'band', mountId: m.id, band: b })
        bandChanged = true
      }
      if (fecundAt[m.id] === undefined && isFecund(m)) {
        fecundAt[m.id] = t
        events.push({ t, kind: 'fecund', mountId: m.id })
      }
    }
    if (input.stopWhenAllFecund && mounts.every((m) => fecundAt[m.id] !== undefined)) {
      tick++
      break
    }
    if (input.stopOnBandChange && bandChanged) {
      tick++
      break
    }
    if (input.stopWhen?.(mounts, t)) {
      tick++
      break
    }
  }
  return { seconds: tick * TICK_SECONDS, gauges, mounts, consumed, events, fecundAt }
}

function applyGain(gauge: GaugeId, m: SimMount, amount: number, t: number, events: SimEvent[]) {
  switch (gauge) {
    case 'caresseur':
      m.serenity = Math.min(SERENITY_MAX, m.serenity + amount)
      return
    case 'baffeur':
      m.serenity = Math.max(SERENITY_MIN, m.serenity - amount)
      return
    case 'foudroyeur':
      m.endurance = Math.min(MOUNT_STAT_MAX, m.endurance + amount)
      if (m.endurance >= MOUNT_STAT_MAX) events.push({ t, kind: 'stat-max', mountId: m.id, stat: 'endurance' })
      return
    case 'abreuvoir':
      m.maturity = Math.min(MOUNT_STAT_MAX, m.maturity + amount)
      if (m.maturity >= MOUNT_STAT_MAX) events.push({ t, kind: 'stat-max', mountId: m.id, stat: 'maturity' })
      return
    case 'dragofesse':
      m.love = Math.min(MOUNT_STAT_MAX, m.love + amount)
      if (m.love >= MOUNT_STAT_MAX) events.push({ t, kind: 'stat-max', mountId: m.id, stat: 'love' })
      return
    case 'mangeoire':
      m.xpGained = (m.xpGained ?? 0) + amount
      return
  }
}

/** Formate une durée en secondes, ex. « 4 h 09 min ». */
export function formatDuration(seconds: number): string {
  // Helper unique (lib/format) : format long « 4 h 09 min », « 1 j 2 h 05 min » (R14).
  return formatDurationLong(seconds, { long: true })
}
