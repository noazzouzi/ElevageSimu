// Planificateur de fécondité : quelles jauges activer, dans quel ordre et pendant combien de temps
// pour rendre féconde une monture (ou un groupe de montures de sérénité proche).
//
// Principes (déduits des règles de sérénité, research/README.md §2.3-2.4) :
// - La maturité ne monte qu'entre -2 000 et 2 000 : on la fait en priorité, couplée à l'endurance
//   (sérénité -2 000…-1) ou à l'amour (0…2 000).
// - L'endurance monte sur toute la plage négative et l'amour sur toute la plage positive : une fois
//   la maturité pleine, on peut pousser la sérénité (Baffeur/Caresseur) sans risque de dépassement.
// - Pour revenir dans la zone de maturité depuis un extrême, on pousse jusqu'à ce que tout le lot
//   (les montures qui ont encore besoin d'une statistique) tienne dans la zone visée ([-2 000, -1] ou
//   [0, 2 000]), centré dans la zone pour laisser autant de marge avant qu'après (alarme). La fenêtre
//   de changement est calculée par simulation sur tout le lot.
// - Paliers par jauge : les jauges de sérénité tournent au palier 1 par défaut (quelques milliers de
//   points par lot : un socle de palier 2 n'y vaut jamais la peine), les autres au palier choisi.
// - Almanax « effet doublé » (non vérifié, medium) : avec l'heure de début du plan, seuls les ticks
//   du jour Almanax sont doublés.
import { almanaxAt, nextServerDayStart, serverDay, serverDayStart } from './almanax'
import { GAUGE_IDS, GAUGE_LABELS, MATURITY_SERENITY_RANGE, MOUNT_STAT_MAX } from './constants'
import { almanaxAtTime, simulatePaddock, type AlmanaxInput, type SimMount } from './paddock'
import { RULESETS, type Ruleset } from './rules'
import type { FuelTier, GaugeId } from './types'

export interface FertilityOptions {
  /** Palier entretenu sur les jauges de statistiques (Foudroyeur, Abreuvoir, Dragofesse) et la Mangeoire. */
  tier: FuelTier
  /**
   * Palier des jauges de sérénité (Baffeur, Caresseur). Défaut : 1 — elles ne consomment que quelques
   * milliers de points par lot : un socle de 40 000 points n'y vaut pas la peine, et une jauge au
   * palier 1 remplie au plus juste s'arrête d'elle-même.
   */
  serenityTier?: FuelTier
  /** Palier imposé jauge par jauge (prioritaire sur `tier` et `serenityTier`, jamais rétrogradé). */
  tierByGauge?: Partial<Record<GaugeId, FuelTier>>
  /** Activer la Mangeoire quand une seule autre jauge est utile. */
  withXp?: boolean
  /**
   * Jauge doublée par l'Almanax. Sans `startMs`, appliquée à tout le plan (ancien comportement) ;
   * avec `startMs`, ignorée au profit du calendrier Almanax.
   */
  almanaxDoubled?: GaugeId | null
  /**
   * Heure absolue (ms) du début du plan : le doublement Almanax ne s'applique alors qu'aux ticks qui
   * tombent un jour Almanax (calendrier `almanaxOn`, heure locale), avant comme après minuit.
   */
  startMs?: number
  /** Appliquer le doublement Almanax (effet non vérifié en jeu). Défaut : oui. */
  applyAlmanax?: boolean
  /** Durée maximale planifiée (défaut : 7 jours). */
  maxSeconds?: number
  rules?: Ruleset
  /**
   * `planPaddock` seulement : durée minimale d'une étape non finale (s, défaut 300). Une étape plus
   * courte est allongée quand c'est sans danger pour le lot (aucune monture ne perd sa zone) ; sinon
   * un avertissement « étape courte » est ajouté. Brancher `settings.checkIntervalMinutes × 60` pour
   * espacer les passages.
   */
  minStepSeconds?: number
  /**
   * `planPaddock` seulement : niveaux actuels des jauges de l'enclos. Une jauge de statistique que le
   * plan consomme peu (< 10 % du socle) et qui est sous le bas du palier tourne au palier inférieur
   * (pas de socle). Défaut : jauges vides.
   */
  gaugeLevels?: Partial<Record<GaugeId, number>>
}

export interface FertilityStep {
  gauges: GaugeId[]
  startSeconds: number
  durationSeconds: number
  /** Explication en français de l'objectif de l'étape. */
  purpose: string
  /** Fenêtre pendant laquelle il faut changer les jauges (pour les étapes de sérénité). */
  switchWindow?: { earliestSeconds: number; latestSeconds: number }
  consumed: Partial<Record<GaugeId, number>>
}

/** Proposition de découpage d'un lot hétérogène (voir `splitLot`). */
export interface LotSplit {
  /** Montures à garder ensemble : meilleure fenêtre de sérénité ≤ 2 000 d'un seul côté de 0, compléments compris. */
  keep: string[]
  /** Montures à sortir (vers un autre enclos ou l'étable). */
  out: string[]
  /** Lots compatibles proposés (fenêtres ≤ 2 000, un seul côté de 0) ; le premier est gardé. */
  groups: string[][]
}

export interface FertilityPlan {
  steps: FertilityStep[]
  totalSeconds: number
  fecundAt: Record<string, number>
  consumed: Record<GaugeId, number>
  warnings: string[]
  mounts: SimMount[]
  /** Palier supposé entretenu sur chaque jauge (à reprendre tel quel dans `refillAdvice`). */
  tiers: Record<GaugeId, FuelTier>
  /**
   * Toutes les montures sont fécondes à la fin du plan. Faux = plan inapplicable (lot trop hétérogène) :
   * ne pas proposer de le démarrer, proposer `split`.
   */
  converges: boolean
  /** Informations (choix de palier, étapes allongées…), sans gravité. */
  notes: string[]
  /** `planPaddock` : découpage proposé quand le lot est trop large (> 2 000) ou ne converge pas. */
  split?: LotSplit | null
}

type Decision = { gauges: GaugeId[]; purpose: string; pushTarget?: number }

const SER_TARGET_NEG = -1_000
const SER_TARGET_POS = 1_000
/** Largeur maximale d'un lot en sérénité (E-GROUP-01). */
const LOT_WINDOW = 2_000
const ZERO = (): Record<GaugeId, number> => ({ baffeur: 0, caresseur: 0, foudroyeur: 0, abreuvoir: 0, dragofesse: 0, mangeoire: 0 })

export const isSerenityGauge = (g: GaugeId): boolean => g === 'baffeur' || g === 'caresseur'

/** Avertissement d'un lot qui ne tient jamais en entier dans la zone visée (`width` = écart de sérénité du lot). */
export function wideLotWarning(width: number): string {
  const w = Math.round(width).toLocaleString('fr-FR')
  return width > LOT_WINDOW
    ? `Lot trop large (écart de sérénité ${w} > 2 000) : il ne tient jamais en entier dans la zone de maturité, scindez-le.`
    : `Lot à la limite (écart de sérénité ${w}) : il ne tient pas en entier dans la zone de maturité visée — pas de fenêtre de changement, certaines montures demandent une étape de plus (un lot plus serré irait plus vite).`
}

/** Palier entretenu sur chaque jauge : `tierByGauge`, sinon `serenityTier` (défaut 1) pour Baffeur/Caresseur, sinon `tier`. */
export function gaugeTiers(opts: Pick<FertilityOptions, 'tier' | 'serenityTier' | 'tierByGauge'>): Record<GaugeId, FuelTier> {
  const out = {} as Record<GaugeId, FuelTier>
  for (const g of GAUGE_IDS) out[g] = opts.tierByGauge?.[g] ?? (isSerenityGauge(g) ? (opts.serenityTier ?? 1) : opts.tier)
  return out
}

/**
 * Calendrier Almanax vu depuis le début d'un plan : `tSeconds` (secondes depuis `startMs`) → jauge
 * doublée ce jour-là, ou null. Le jour Almanax est le **jour de jeu** (heure de Paris, `serverDay`),
 * quel que soit le fuseau du navigateur. `calendar` permet d'injecter un autre calendrier (supposé
 * constant sur un jour de jeu).
 */
export function almanaxScheduleFrom(startMs: number, calendar?: (ms: number) => GaugeId | null): (tSeconds: number) => GaugeId | null {
  const cal = calendar ?? ((ms: number) => almanaxAt(ms)?.doubledGauge ?? null)
  let from = Infinity
  let to = -Infinity
  let value: GaugeId | null = null
  return (t) => {
    const ms = startMs + t * 1000
    if (ms < from || ms >= to) {
      from = serverDayStart(serverDay(ms))
      to = nextServerDayStart(ms)
      value = cal(ms)
    }
    return value
  }
}

/** Doublement Almanax à appliquer à une simulation qui démarre `offsetSeconds` après le début du plan. */
export function planAlmanax(opts: Pick<FertilityOptions, 'almanaxDoubled' | 'startMs' | 'applyAlmanax'>, offsetSeconds = 0): AlmanaxInput {
  if (opts.applyAlmanax === false) return null
  if (opts.startMs !== undefined) {
    const f = almanaxScheduleFrom(opts.startMs)
    return (t) => f(offsetSeconds + t)
  }
  return opts.almanaxDoubled ?? null
}

/** Cibles de sérénité formatées une fois (decideGauges est appelé à chaque tick pour chaque monture). */
const fmtTarget = (n: number) => n.toLocaleString('fr-FR')
const TARGET_TEXT: Record<number, string> = { [SER_TARGET_NEG]: fmtTarget(SER_TARGET_NEG), [SER_TARGET_POS]: fmtTarget(SER_TARGET_POS) }
const targetText = (n: number) => TARGET_TEXT[n] ?? fmtTarget(n)

/** Décide la paire de jauges pour une monture selon ses besoins et sa sérénité. */
export function decideGauges(m: SimMount, withXp: boolean): Decision | null {
  const needE = m.endurance < MOUNT_STAT_MAX
  const needM = m.maturity < MOUNT_STAT_MAX
  const needA = m.love < MOUNT_STAT_MAX
  const s = m.serenity
  const filler = (g: GaugeId[]): GaugeId[] => (withXp && g.length < 2 ? [...g, 'mangeoire'] : g)
  if (!needE && !needM && !needA) return null

  if (needM) {
    if (s < MATURITY_SERENITY_RANGE[0]) {
      const target = needE || !needA ? SER_TARGET_NEG : SER_TARGET_POS
      return {
        gauges: needE ? ['caresseur', 'foudroyeur'] : filler(['caresseur']),
        purpose: `Remonter la sérénité vers ${targetText(target)} (zone de maturité)${needE ? " tout en montant l'endurance" : ''}`,
        pushTarget: target,
      }
    }
    if (s > MATURITY_SERENITY_RANGE[1]) {
      const target = needA || !needE ? SER_TARGET_POS : SER_TARGET_NEG
      return {
        gauges: needA ? ['baffeur', 'dragofesse'] : filler(['baffeur']),
        purpose: `Baisser la sérénité vers ${targetText(target)} (zone de maturité)${needA ? " tout en montant l'amour" : ''}`,
        pushTarget: target,
      }
    }
    if (s < 0) {
      if (needE) return { gauges: ['foudroyeur', 'abreuvoir'], purpose: 'Monter endurance + maturité' }
      if (needA)
        return {
          gauges: ['caresseur', 'abreuvoir'],
          purpose: `Monter la maturité en remontant la sérénité vers ${targetText(SER_TARGET_POS)} (pour l'amour)`,
          pushTarget: SER_TARGET_POS,
        }
      return { gauges: filler(['abreuvoir']), purpose: 'Monter la maturité' }
    }
    if (needA) return { gauges: ['abreuvoir', 'dragofesse'], purpose: 'Monter maturité + amour' }
    if (needE)
      return {
        gauges: ['baffeur', 'abreuvoir'],
        purpose: `Monter la maturité en baissant la sérénité vers ${targetText(SER_TARGET_NEG)} (pour l'endurance)`,
        pushTarget: SER_TARGET_NEG,
      }
    return { gauges: filler(['abreuvoir']), purpose: 'Monter la maturité' }
  }

  // Maturité pleine : endurance et/ou amour, dépassement de sérénité sans conséquence.
  if (s < 0) {
    if (needE) return { gauges: filler(['foudroyeur']), purpose: "Monter l'endurance" }
    return { gauges: ['caresseur', 'dragofesse'], purpose: "Passer en sérénité positive et monter l'amour" }
  }
  if (needA) return { gauges: filler(['dragofesse']), purpose: "Monter l'amour" }
  return { gauges: ['baffeur', 'foudroyeur'], purpose: "Passer en sérénité négative et monter l'endurance" }
}

/** Clé d'un ensemble de jauges (ordre indifférent) ; chemin rapide pour 1 ou 2 jauges (appelée à chaque tick). */
const key = (g: GaugeId[]): string => {
  if (g.length === 0) return ''
  if (g.length === 1) return g[0]
  if (g.length === 2) return g[0] < g[1] ? `${g[0]}+${g[1]}` : `${g[1]}+${g[0]}`
  return [...g].sort().join('+')
}

/** La monture a-t-elle encore besoin d'une statistique ? (compléments XP et stériles : non) */
const needsStats = (m: SimMount, withXp: boolean) => decideGauges(m, withXp) !== null

/** Décision majoritaire pour un groupe (les montures fécondes sont ignorées). */
function decideGroup(mounts: SimMount[], withXp: boolean): Decision | null {
  const counts = new Map<string, { d: Decision; n: number }>()
  for (const m of mounts) {
    const d = decideGauges(m, withXp)
    if (!d) continue
    const k = key(d.gauges)
    const e = counts.get(k)
    if (e) e.n++
    else counts.set(k, { d, n: 1 })
  }
  let best: { d: Decision; n: number } | null = null
  for (const e of counts.values()) if (!best || e.n > best.n) best = e
  return best?.d ?? null
}

/** Zone visée par une poussée : [-2 000, -1] (cible négative) ou [0, 2 000]. */
function zoneOf(target: number): [number, number] {
  return target < 0 ? [MATURITY_SERENITY_RANGE[0], -1] : [0, MATURITY_SERENITY_RANGE[1]]
}

/**
 * Montures jugées pour une poussée vers la zone de maturité : celles qui ont encore besoin de maturité
 * (elles doivent tenir dans la zone) ; à défaut, celles qui ont encore besoin d'une statistique. Les
 * compléments XP et les stériles (vus pleins) n'entrent jamais en compte.
 */
function zoneMounts(ms: SimMount[], withXp: boolean): SimMount[] {
  const needing = ms.filter((m) => needsStats(m, withXp))
  const maturity = needing.filter((m) => m.maturity < MOUNT_STAT_MAX)
  return maturity.length > 0 ? maturity : needing
}

/**
 * Poussée de sérénité terminée ? La poussée continue tant que la dernière monture jugée
 * (`zoneMounts`) n'est pas entrée dans la zone ; ensuite elle s'arrête dès que le lot est centré
 * dans la zone (autant de marge des deux côtés pour l'alarme), que la dernière atteint la cible
 * (±1 000) ou que la première sortirait de la zone au tick suivant. Lot plus large que la zone :
 * arrêt dès l'entrée de la dernière (pas de fenêtre, voir `wideLotWarning`).
 */
function pushDone(d: Decision, ms: SimMount[], withXp: boolean, step: number): boolean {
  let lo = Infinity
  let hi = -Infinity
  for (const m of zoneMounts(ms, withXp)) {
    lo = Math.min(lo, m.serenity)
    hi = Math.max(hi, m.serenity)
  }
  if (lo === Infinity) return true
  const target = d.pushTarget!
  const [zlo, zhi] = zoneOf(target)
  if (d.gauges.includes('caresseur')) {
    if (lo < zlo) return false
    return lo >= target || lo - zlo >= zhi - hi || hi + step > zhi
  }
  if (hi > zhi) return false
  return hi <= target || zhi - hi >= lo - zlo || lo - step < zlo
}

/**
 * Fenêtre de changement d'une poussée, par simulation de tout le lot depuis le début de l'étape (mêmes
 * jauges, paliers et Almanax) : au plus tôt au premier tick où toutes les montures jugées
 * (`zoneMounts`) sont dans la zone, au plus tard au dernier tick avant que la première n'en sorte (la
 * poussée continuant après la fin prévue). `inside = false` : aucun tick n'a tout le lot dans
 * la zone.
 */
function simulatedWindow(
  d: Decision,
  start: SimMount[],
  sim: { maintain: Partial<Record<GaugeId, FuelTier>>; almanax: AlmanaxInput; rules: Ruleset; withXp: boolean },
  duration: number,
): { inside: boolean; window: { earliest: number; latest: number } | null } {
  const [zlo, zhi] = zoneOf(d.pushTarget!)
  const allInside = (ms: SimMount[]) => {
    const judged = zoneMounts(ms, sim.withXp)
    return judged.length > 0 && judged.every((m) => m.serenity >= zlo && m.serenity <= zhi)
  }
  let earliest: number | null = allInside(start) ? 0 : null
  let latest: number | null = earliest
  simulatePaddock({
    gauges: ZERO(),
    active: d.gauges,
    mounts: start,
    almanaxDoubled: sim.almanax,
    maintainTier: sim.maintain,
    rules: sim.rules,
    maxSeconds: duration + 6_000,
    stopWhen: (ms, secs) => {
      if (allInside(ms)) {
        if (earliest === null) earliest = secs
        latest = secs
        return false
      }
      return earliest !== null || secs >= duration
    },
  })
  if (earliest === null || latest === null) return { inside: false, window: null }
  return { inside: true, window: earliest <= duration && latest >= duration ? { earliest, latest } : null }
}

/** « Monter l'amour » + « Finir l'amour… » → « Monter l'amour, puis finir l'amour… ». */
export function joinPurposes(a: string, b: string): string {
  if (a === b || a.includes(b)) return a
  return `${a}, puis ${b.charAt(0).toLowerCase()}${b.slice(1)}`
}

/** Fusionne les étapes consécutives qui gardent les mêmes jauges (sans fenêtre de changement). */
export function mergeSteps(steps: FertilityStep[]): FertilityStep[] {
  const merged: FertilityStep[] = []
  for (const s of steps) {
    const last = merged[merged.length - 1]
    if (last && key(last.gauges) === key(s.gauges) && !last.switchWindow && !s.switchWindow) {
      last.durationSeconds += s.durationSeconds
      last.purpose = joinPurposes(last.purpose, s.purpose)
      for (const [g, v] of Object.entries(s.consumed)) last.consumed[g as GaugeId] = (last.consumed[g as GaugeId] ?? 0) + (v ?? 0)
    } else merged.push({ ...s, consumed: { ...s.consumed } })
  }
  return merged
}

/** Construit le plan de fécondité complet d'un groupe de montures placées dans le même enclos. */
export function planFertility(input: SimMount[], opts: FertilityOptions): FertilityPlan {
  const maxSeconds = opts.maxSeconds ?? 7 * 86_400
  const withXp = opts.withXp ?? false
  const rules = opts.rules ?? RULESETS['3.6']
  const tiers = gaugeTiers(opts)
  let mounts = input.map((m) => ({ ...m }))
  const steps: FertilityStep[] = []
  const warnings: string[] = []
  const consumed = ZERO()
  const fecundAt: Record<string, number> = {}
  let t = 0

  for (let guard = 0; guard < 40 && t < maxSeconds; guard++) {
    const d = decideGroup(mounts, withXp)
    if (!d) break
    const k = key(d.gauges)
    const maintain: Partial<Record<GaugeId, FuelTier>> = {}
    for (const g of d.gauges) maintain[g] = tiers[g]
    const almanax = planAlmanax(opts, t)
    const push = d.gauges.find(isSerenityGauge)
    // Pas de sérénité du tick suivant (Almanax en vigueur à cet instant).
    const stepAt = (secs: number) => (push ? rules.gaugeRatePerTick[tiers[push]] * (almanaxAtTime(almanax, secs) === push ? 2 : 1) : 0)
    const start = mounts
    const res = simulatePaddock({
      gauges: ZERO(),
      active: d.gauges,
      mounts,
      almanaxDoubled: almanax,
      maintainTier: maintain,
      rules,
      maxSeconds: maxSeconds - t,
      stopWhen: (ms, secs) => {
        const nd = decideGroup(ms, withXp)
        if (!nd) return true
        if (d.pushTarget !== undefined) {
          if (pushDone(d, ms, withXp, stepAt(secs))) return true
          // Poussée en cours : on ignore l'entrée dans la zone avant la fin de la poussée.
          if (nd.pushTarget === undefined) return false
        }
        return key(nd.gauges) !== k
      },
    })
    if (res.seconds === 0) {
      warnings.push(`Aucune progression possible avec ${d.gauges.map((g) => GAUGE_LABELS[g]).join(' + ')}.`)
      break
    }
    const stepConsumed: Partial<Record<GaugeId, number>> = {}
    for (const g of d.gauges) {
      stepConsumed[g] = res.consumed[g]
      consumed[g] += res.consumed[g]
    }
    const step: FertilityStep = {
      gauges: d.gauges,
      startSeconds: t,
      durationSeconds: res.seconds,
      purpose: d.purpose,
      consumed: stepConsumed,
    }
    if (d.pushTarget !== undefined) {
      const w = simulatedWindow(d, start, { maintain, almanax, rules, withXp }, res.seconds)
      if (w.window) step.switchWindow = { earliestSeconds: t + w.window.earliest, latestSeconds: t + w.window.latest }
      else if (!w.inside) {
        const judged = zoneMounts(start, withXp).map((m) => m.serenity)
        warnings.push(wideLotWarning(judged.length ? Math.max(...judged) - Math.min(...judged) : 0))
      }
    }
    for (const [id, at] of Object.entries(res.fecundAt)) if (fecundAt[id] === undefined) fecundAt[id] = t + at
    steps.push(step)
    t += res.seconds
    mounts = res.mounts
  }
  const converges = mounts.every((m) => fecundAt[m.id] !== undefined)
  if (!converges) warnings.push('Certaines montures ne sont pas fécondes à la fin du plan.')
  return { steps: mergeSteps(steps), totalSeconds: t, fecundAt, consumed, warnings: [...new Set(warnings)], mounts, tiers, converges, notes: [] }
}

// ---------- Découpage d'un lot hétérogène ----------

/** Côté de 0 d'une monture : 0 = indifférent (il ne lui manque que la maturité, ou rien). */
export function serenitySide(m: Pick<SimMount, 'serenity' | 'endurance' | 'love'>): -1 | 0 | 1 {
  if (m.endurance >= MOUNT_STAT_MAX && m.love >= MOUNT_STAT_MAX) return 0
  return m.serenity < 0 ? -1 : 1
}

export interface WindowAccessors<T> {
  serenity: (x: T) => number
  side: (x: T) => -1 | 0 | 1
  /** Phase (jauges) de la monture : à taille égale, on garde le plus de montures de la phase majoritaire. */
  key?: (x: T) => string
  /** Montures à garder en priorité (ex. déjà dans l'enclos). */
  preferred?: (x: T) => boolean
}

/**
 * Meilleure fenêtre de sérénité : le plus grand sous-ensemble (≤ `maxCount`) de largeur ≤ `width`,
 * d'un seul côté de 0 ; à taille égale, le plus de montures préférées, puis de la phase majoritaire,
 * puis la fenêtre la plus étroite.
 */
export function bestSerenityWindow<T>(items: T[], f: WindowAccessors<T>, width = LOT_WINDOW, maxCount = 10): T[] {
  const sorted = [...items].sort((a, b) => f.serenity(a) - f.serenity(b))
  let best: T[] = []
  let bestScore: number[] = []
  const better = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]
    return false
  }
  for (let i = 0; i < sorted.length; i++) {
    const s0 = f.serenity(sorted[i])
    const win = sorted.filter((x) => f.serenity(x) >= s0 && f.serenity(x) - s0 <= width)
    for (const side of [-1, 1] as const) {
      let sub = win.filter((x) => f.side(x) !== -side)
      if (sub.length > maxCount) {
        sub = [...sub]
          .sort((a, b) => Number(f.preferred?.(b) ?? false) - Number(f.preferred?.(a) ?? false) || f.serenity(a) - f.serenity(b))
          .slice(0, maxCount)
      }
      if (sub.length === 0) continue
      const keys = new Map<string, number>()
      for (const x of sub) {
        const k = f.key?.(x) ?? ''
        keys.set(k, (keys.get(k) ?? 0) + 1)
      }
      const span = Math.max(...sub.map(f.serenity)) - Math.min(...sub.map(f.serenity))
      const score = [sub.length, sub.filter((x) => f.preferred?.(x) ?? false).length, Math.max(...keys.values()), -span]
      if (best.length === 0 || better(score, bestScore)) {
        best = sub
        bestScore = score
      }
    }
  }
  return best
}

/**
 * Découpe un lot hétérogène en lots compatibles (fenêtres de sérénité ≤ 2 000 d'un seul côté de 0) :
 * `keep` = le plus grand (avec les compléments XP et stériles, qui ne gênent pas), `out` = le reste.
 */
export function splitLot(mounts: SimMount[], withXp = false, maxCount = 10): LotSplit {
  const needing = mounts.filter((m) => needsStats(m, withXp))
  const others = mounts.filter((m) => !needsStats(m, withXp))
  const acc: WindowAccessors<SimMount> = {
    serenity: (m) => m.serenity,
    side: serenitySide,
    key: (m) => key(decideGauges(m, false)?.gauges ?? []),
  }
  const groups: SimMount[][] = []
  let rest = needing
  while (rest.length > 0) {
    const g = bestSerenityWindow(rest, acc, LOT_WINDOW, maxCount)
    if (g.length === 0) break
    groups.push(g)
    rest = rest.filter((m) => !g.includes(m))
  }
  const keepSet = new Set([...(groups[0] ?? []), ...others].map((m) => m.id))
  return {
    keep: mounts.filter((m) => keepSet.has(m.id)).map((m) => m.id),
    out: mounts.filter((m) => !keepSet.has(m.id)).map((m) => m.id),
    groups: groups.map((g) => g.map((m) => m.id)),
  }
}

