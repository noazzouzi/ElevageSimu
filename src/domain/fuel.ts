// Carburants d'enclos : durabilité selon la version du jeu, options d'achat ou de craft, coût d'un
// point de jauge et plan de remplissage qui respecte les plafonds de palier.
//
// Règles (research/README.md §2.8, crafts.md §2.3-2.4 ; confiance haute sauf mention) :
// - Durabilité Minuscule → Gigantesque : 1 000 → 5 000, ×rules.fuelDurabilityFactor (×2 en 3.7).
// - Un carburant de palier t ne se dépose que si la jauge est SOUS le plafond de sa famille
//   (rules.gaugeTierMax[t]) ; nouvelle valeur = min(plafond, v + durabilité). L'excédent est
//   probablement perdu (medium) : le plan de remplissage évite les débordements.
// - Un carburant de palier supérieur peut remplir les paliers du dessous.
// - Coût d'un point = prix / durabilité (÷ nombre de montures éligibles pour le coût par monture).
//   Le palier ne change que la vitesse et le prix au point.
// - Aucun niveau de métier n'est requis pour UTILISER un carburant ; le fabriquer demande le niveau
//   de la recette. Un prix « craft » sans le niveau requis n'est qu'une estimation du prix HDV.
import { FUELS, PRICES_DEFAULT, type FuelRecipe } from '../data'
import { DUST_SHOP_PRICES, FUEL_SIZES, FUEL_TIER_NAMES } from './constants'
import { craftCost, marketPrice, resolvePrice, type CraftCost, type PriceContext, type PriceOrigin, type ResolvedPrice } from './pricing'
import type { Ruleset } from './rules'
import type { FuelSize, FuelTier, GaugeId } from './types'

export const FUEL_TIERS: FuelTier[] = [1, 2, 3, 4]

export const FUEL_SIZE_LABELS: Record<FuelSize, string> = {
  minuscule: 'Minuscule',
  petit: 'Petit',
  normal: 'Normal',
  grand: 'Grand',
  gigantesque: 'Gigantesque',
}

export interface FuelOpts {
  /** Niveau du métier d'Éleveur (pour savoir si l'on peut fabriquer le carburant). */
  jobLevel: number
  rules: Ruleset
}

/** Durabilité effective d'un carburant (points de jauge apportés) selon la version du jeu. */
export function fuelDurability(fuel: Pick<FuelRecipe, 'durability'>, rules: Ruleset): number {
  return fuel.durability * rules.fuelDurabilityFactor
}

/** Plafond de remplissage d'un palier de carburant (Extrait 40 000… ; Élixir = jauge pleine). */
export function tierCap(tier: FuelTier, rules: Ruleset): number {
  return rules.gaugeTierMax[tier]
}

/** Le carburant peut-il être déposé dans une jauge à ce niveau ? (strictement sous le plafond) */
export function canDeposit(gaugeValue: number, fuel: Pick<FuelRecipe, 'tier'>, rules: Ruleset): boolean {
  return gaugeValue < tierCap(fuel.tier, rules)
}

export interface DepositResult {
  value: number
  added: number
  /** Points perdus au-delà du plafond (excédent supposé perdu, confiance moyenne). */
  wasted: number
}

/** Dépose un carburant : null si la jauge a déjà atteint le plafond de son palier. */
export function depositFuel(gaugeValue: number, fuel: Pick<FuelRecipe, 'tier' | 'durability'>, rules: Ruleset): DepositResult | null {
  if (!canDeposit(gaugeValue, fuel, rules)) return null
  const cap = tierCap(fuel.tier, rules)
  const raw = gaugeValue + fuelDurability(fuel, rules)
  const value = Math.min(cap, raw)
  return { value, added: value - gaugeValue, wasted: raw - value }
}

/** Carburants d'une jauge (éventuellement d'un seul palier), triés par palier puis par taille. */
export function fuelsOf(gauge: GaugeId, tier?: FuelTier): FuelRecipe[] {
  return FUELS.filter((f) => f.gauge === gauge && (tier === undefined || f.tier === tier)).sort(
    (a, b) => a.tier - b.tier || FUEL_SIZES.indexOf(a.size) - FUEL_SIZES.indexOf(b.size),
  )
}

export function findFuel(gauge: GaugeId, tier: FuelTier, size: FuelSize): FuelRecipe | undefined {
  return FUELS.find((f) => f.gauge === gauge && f.tier === tier && f.size === size)
}

/** Libellé court d'une famille de carburant : « Extrait », « Philtre »… */
export function fuelTierName(tier: FuelTier): string {
  return FUEL_TIER_NAMES[tier]
}

export interface FuelOption {
  fuel: FuelRecipe
  gauge: GaugeId
  tier: FuelTier
  size: FuelSize
  /** Durabilité selon les règles actives. */
  durability: number
  /** Plafond de dépôt (règles actives). */
  cap: number
  /** Prix unitaire retenu (joueur > défaut > craft ; borne basse si incomplet). */
  unitPrice: number | null
  complete: boolean
  origin: PriceOrigin
  confidence?: string
  missing: number[]
  /** Prix unitaire / durabilité (kamas par point de jauge). */
  costPerPoint: number | null
  /** Prix HDV connu (joueur ou défaut). */
  market: ResolvedPrice
  /** Coût des ingrédients (null si recette inconnue). */
  craft: CraftCost | null
  /** Niveau d'Éleveur requis pour fabriquer. */
  craftLevel: number
  canCraft: boolean
  /** Le prix retenu est un coût de craft alors que le joueur ne peut pas fabriquer l'objet. */
  craftPriceOnly: boolean
}

export function fuelOption(fuel: FuelRecipe, ctx: PriceContext, opts: FuelOpts): FuelOption {
  // Niveau d'Éleveur du joueur (ECO-12) : une recette hors de portée prend le prix HDV s'il existe ;
  // sinon son coût de craft reste affiché, signalé `craftPriceOnly`.
  const resolved = resolvePrice(fuel.id, ctx.jobLevel === undefined ? { ...ctx, jobLevel: opts.jobLevel } : ctx)
  const durability = fuelDurability(fuel, opts.rules)
  const unitPrice = resolved.price
  const canCraft = opts.jobLevel >= fuel.level
  return {
    fuel,
    gauge: fuel.gauge,
    tier: fuel.tier,
    size: fuel.size,
    durability,
    cap: tierCap(fuel.tier, opts.rules),
    unitPrice,
    complete: resolved.complete && unitPrice !== null,
    origin: resolved.origin,
    confidence: resolved.confidence,
    missing: resolved.missing,
    costPerPoint: unitPrice === null ? null : unitPrice / durability,
    market: marketPrice(fuel.id, ctx),
    craft: craftCost(fuel.id, ctx),
    craftLevel: fuel.level,
    canCraft,
    craftPriceOnly: resolved.origin === 'craft' && !canCraft,
  }
}

/** Les 5 tailles d'une jauge et d'un palier, avec prix, durabilité et coût au point. */
export function fuelOptions(gauge: GaugeId, tier: FuelTier, ctx: PriceContext, opts: FuelOpts): FuelOption[] {
  return fuelsOf(gauge, tier).map((f) => fuelOption(f, ctx, opts))
}

export type PointCostOrigin = PriceOrigin | 'estimation'

export interface GaugePointCost {
  gauge: GaugeId
  tier: FuelTier
  /**
   * Kamas par point de jauge. Complet : valeur selon les prix. Incomplet : voir `bound` —
   * borne basse (coût partiel des ingrédients connus), borne haute (seul un carburant de palier
   * supérieur est chiffré) ou null si rien n'est chiffré.
   */
  value: number | null
  complete: boolean
  /** Nature de `value` quand le coût est incomplet. */
  bound: 'min' | 'max' | null
  /** Carburant retenu (le moins cher au point), ou meilleur candidat à chiffrer si rien n'est chiffré. */
  fuel: FuelOption | null
  /** Carburant du palier demandé dont il faut saisir le prix (si incomplet). */
  toPrice: FuelOption | null
  origin: PointCostOrigin
  confidence?: string
  /** Vrai si la valeur vient des coûts au point par défaut de la recherche (Mangeoire seulement). */
  estimated: boolean
  missing: number[]
  note?: string
  /** Toutes les options considérées (paliers ≥ palier demandé, sauf exactTier). */
  options: FuelOption[]
}

export interface BestFuelOpts extends FuelOpts {
  /** Ne considérer que le palier demandé (sinon : tout carburant de palier ≥, qui remplit aussi ce palier). */
  exactTier?: boolean
  /** Exclure les prix « craft » des carburants que le joueur ne peut pas fabriquer. */
  craftableOnly?: boolean
}

interface PointCostDefault {
  value: number
  confidence: string
  basis: string
  source: string
  range?: [number, number]
}

/** Coût au point par défaut de la recherche (Mangeoire uniquement), mis à l'échelle de la durabilité. */
export function defaultMangeoirePointCost(tier: FuelTier, rules: Ruleset): (PointCostDefault & { scaled: number }) | null {
  const table = PRICES_DEFAULT.valuation.fuelCostPerGaugePointDefaults as Record<string, PointCostDefault | string> | undefined
  const row = table?.[`T${tier}`]
  if (!row || typeof row === 'string' || typeof row.value !== 'number') return null
  return { ...row, scaled: row.value / rules.fuelDurabilityFactor }
}

const byCostPerPoint = (a: FuelOption, b: FuelOption) =>
  (a.costPerPoint ?? Infinity) - (b.costPerPoint ?? Infinity) || b.durability - a.durability

/** Carburant du palier à chiffrer en priorité : borne basse la plus faible, sinon le plus durable. */
function priceCandidate(options: FuelOption[]): FuelOption | null {
  const partial = options.filter((o) => o.costPerPoint !== null && o.costPerPoint > 0).sort(byCostPerPoint)
  return partial[0] ?? [...options].sort((a, b) => b.durability - a.durability)[0] ?? null
}

const missingOf = (o: FuelOption | null): number[] => (o ? [...new Set(o.missing.length ? o.missing : [o.fuel.id])] : [])

/**
 * Carburant le moins cher au point pour entretenir une jauge à un palier donné.
 * Un palier t accepte tout carburant de palier ≥ t (il remplit aussi les paliers inférieurs) ; le
 * coût n'est « complet » que si au moins un carburant du palier t est chiffré (sinon un carburant
 * de palier supérieur donne seulement une borne haute).
 * Sans prix au palier t : repli sur les coûts au point par défaut de la recherche pour la seule
 * Mangeoire (« estimation ») ; sinon coût incomplet.
 */
export function bestFuel(gauge: GaugeId, tier: FuelTier, ctx: PriceContext, opts: BestFuelOpts): GaugePointCost {
  const tiers = opts.exactTier ? [tier] : FUEL_TIERS.filter((t) => t >= tier)
  const options = tiers.flatMap((t) => fuelOptions(gauge, t, ctx, opts))
  const usable = options.filter((o) => !(opts.craftableOnly && o.craftPriceOnly))
  const exact = usable.filter((o) => o.tier === tier)
  const complete = usable.filter((o) => o.complete && o.costPerPoint !== null).sort(byCostPerPoint)
  const best = complete[0] ?? null
  const base = { gauge, tier, options }

  if (best && complete.some((o) => o.tier === tier)) {
    const cheaperUnknown = exact.some((o) => !o.complete && (o.costPerPoint ?? 0) < (best.costPerPoint ?? 0))
    return {
      ...base,
      value: best.costPerPoint,
      complete: true,
      bound: null,
      fuel: best,
      toPrice: null,
      origin: best.origin,
      confidence: best.confidence,
      estimated: false,
      missing: [],
      note: cheaperUnknown ? "D'autres carburants de ce palier, non chiffrés, pourraient être moins chers." : undefined,
    }
  }

  if (gauge === 'mangeoire' && ctx.useDefaults) {
    const d = defaultMangeoirePointCost(tier, opts.rules)
    if (d && !(best && (best.costPerPoint ?? Infinity) < d.scaled)) {
      return {
        ...base,
        value: d.scaled,
        complete: true,
        bound: null,
        fuel: null,
        toPrice: priceCandidate(exact),
        origin: 'estimation',
        confidence: d.confidence,
        estimated: true,
        missing: [],
        note: `Estimation de la recherche (${d.basis})${opts.rules.fuelDurabilityFactor !== 1 ? `, divisée par ${opts.rules.fuelDurabilityFactor} (durabilité ×${opts.rules.fuelDurabilityFactor})` : ''}.`,
      }
    }
    if (best) {
      return {
        ...base,
        value: best.costPerPoint,
        complete: true,
        bound: null,
        fuel: best,
        toPrice: priceCandidate(exact),
        origin: best.origin,
        confidence: best.confidence,
        estimated: false,
        missing: [],
        note: 'Carburant de palier supérieur, moins cher que l’estimation de la recherche pour ce palier.',
      }
    }
  }

  const candidate = priceCandidate(exact.length ? exact : usable)
  if (best) {
    return {
      ...base,
      value: best.costPerPoint,
      complete: false,
      bound: 'max',
      fuel: best,
      toPrice: candidate,
      origin: best.origin,
      confidence: best.confidence,
      estimated: false,
      missing: missingOf(candidate),
      note: `Aucun ${FUEL_TIER_NAMES[tier]} chiffré : coût calculé avec « ${best.fuel.name} » (palier supérieur, sans doute surestimé).`,
    }
  }
  const lower = candidate?.costPerPoint ?? null
  return {
    ...base,
    value: lower !== null && lower > 0 ? lower : null,
    complete: false,
    bound: lower !== null && lower > 0 ? 'min' : null,
    fuel: candidate,
    toPrice: candidate,
    origin: 'manquant',
    estimated: false,
    missing: missingOf(candidate),
    note: lower ? 'Coût incomplet : valeur minimale, il manque des prix d’ingrédients.' : 'Aucun prix connu pour ces carburants.',
  }
}

/** Alias explicite : coût d'un point de jauge entretenue au palier donné. */
export function costPerGaugePoint(gauge: GaugeId, tier: FuelTier, ctx: PriceContext, opts: BestFuelOpts): GaugePointCost {
  return bestFuel(gauge, tier, ctx, opts)
}

// ---------- Plan de remplissage ----------

export interface FillStep {
  option: FuelOption
  count: number
  /** Niveau de jauge avant le premier dépôt et après le dernier. */
  from: number
  to: number
  wasted: number
}

export interface FillPlanItem {
  option: FuelOption
  count: number
  subtotal: number | null
}

export interface FillPlan {
  gauge: GaugeId
  from: number
  to: number
  /** Niveau atteint (≥ to si faisable). */
  reached: number
  /** Dépôts dans l'ordre (les petits paliers d'abord). */
  steps: FillStep[]
  items: FillPlanItem[]
  count: number
  /** Coût total (borne basse si incomplet ; null si rien n'est chiffré). */
  cost: number | null
  complete: boolean
  /** Points perdus au-delà des plafonds. */
  waste: number
  /** Points au-delà de l'objectif (restent dans la jauge, non perdus). */
  overshoot: number
  feasible: boolean
  /** Objets à chiffrer (ingrédients manquants, ou le carburant lui-même). */
  missing: number[]
  /**
   * Plan incomplet seulement : même remplissage avec des carburants entièrement chiffrés, quitte à
   * prendre une famille supérieure (souvent un Élixir estimé). Son coût est une BORNE HAUTE du coût
   * réel (on peut toujours acheter ces carburants) — à afficher comme telle, jamais comme le coût.
   * null si aucun plan chiffré n'existe ou si le plan est complet.
   */
  upperBound: FillPlan | null
}

/** Famille minimale pour déposer à ce niveau : plus petit palier dont le plafond est au-dessus du niveau. */
export function sliceTier(level: number, rules: Ruleset): FuelTier {
  for (const t of FUEL_TIERS) if (level < rules.gaugeTierMax[t]) return t
  return 4
}

/**
 * Vecteur de coût comparé dans l'ordre : [objets non chiffrés, kamas des objets chiffrés, gaspillage,
 * dépassement de l'objectif, nombre d'objets, coût partiel connu des objets non chiffrés].
 */
type CostVec = [number, number, number, number, number, number]

function lessThan(a: CostVec, b: CostVec): boolean {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] < b[i]
  }
  return false
}

const isPriced = (o: FuelOption) => o.complete && o.unitPrice !== null

/** Dijkstra lexicographique de `start` à `goal` ; `allowed(t)` = carburants autorisés dans la tranche de famille t. */
function searchFill(
  gauge: GaugeId,
  start: number,
  goal: number,
  allowed: (t: FuelTier) => FuelOption[],
  rules: Ruleset,
): FillPlan | null {
  const dist = new Map<number, CostVec>([[start, [0, 0, 0, 0, 0, 0]]])
  const prev = new Map<number, { from: number; option: FuelOption; wasted: number }>()
  const done = new Set<number>()
  let reached: number | null = null
  for (let guard = 0; guard < 10_000; guard++) {
    let v: number | null = null
    for (const [k, d] of dist) if (!done.has(k) && (v === null || lessThan(d, dist.get(v)!))) v = k
    if (v === null) break
    done.add(v)
    if (v >= goal) {
      reached = v
      break
    }
    const dv = dist.get(v)!
    for (const o of allowed(sliceTier(v, rules))) {
      const r = depositFuel(v, o.fuel, rules)
      if (!r || r.added <= 0) continue
      const priced = isPriced(o)
      const nd: CostVec = [
        dv[0] + (priced ? 0 : 1),
        dv[1] + (priced ? o.unitPrice! : 0),
        dv[2] + r.wasted,
        dv[3] + (r.value >= goal ? r.value - goal : 0),
        dv[4] + 1,
        dv[5] + (priced ? 0 : (o.unitPrice ?? 0)),
      ]
      const cur = dist.get(r.value)
      if (!done.has(r.value) && (!cur || lessThan(nd, cur))) {
        dist.set(r.value, nd)
        prev.set(r.value, { from: v, option: o, wasted: r.wasted })
      }
    }
  }
  if (reached === null) return null

  const path: { from: number; to: number; option: FuelOption; wasted: number }[] = []
  for (let v = reached; v !== start; ) {
    const p = prev.get(v)!
    path.push({ from: p.from, to: v, option: p.option, wasted: p.wasted })
    v = p.from
  }
  path.reverse()

  const steps: FillStep[] = []
  for (const d of path) {
    const last = steps[steps.length - 1]
    if (last && last.option.fuel.id === d.option.fuel.id) {
      last.count++
      last.to = d.to
      last.wasted += d.wasted
    } else steps.push({ option: d.option, count: 1, from: d.from, to: d.to, wasted: d.wasted })
  }
  const agg = new Map<number, FillPlanItem>()
  for (const s of steps) {
    const it = agg.get(s.option.fuel.id)
    if (it) it.count += s.count
    else agg.set(s.option.fuel.id, { option: s.option, count: s.count, subtotal: null })
  }
  const items = [...agg.values()]
  let cost = 0
  let complete = true
  const missing: number[] = []
  for (const it of items) {
    it.subtotal = it.option.unitPrice === null ? null : it.option.unitPrice * it.count
    cost += it.subtotal ?? 0
    if (!isPriced(it.option)) {
      complete = false
      missing.push(...(it.option.missing.length ? it.option.missing : [it.option.fuel.id]))
    }
  }
  return {
    gauge,
    from: start,
    to: goal,
    reached,
    steps,
    items,
    count: items.reduce((s, i) => s + i.count, 0),
    cost: complete || cost > 0 ? cost : null,
    complete,
    waste: steps.reduce((s, x) => s + x.wasted, 0),
    overshoot: reached - goal,
    feasible: true,
    missing: [...new Set(missing)],
    upperBound: null,
  }
}

/**
 * Plan de dépôts pour faire passer une jauge de `from` à `to`. Chaque dépôt respecte le plafond de
 * sa famille (un Extrait ne se dépose que sous 40 000…), et chaque tranche est remplie avec la
 * FAMILLE MINIMALE qui le permet (Extrait sous le plafond du palier 1, Philtre jusqu'au palier 2…).
 * Une famille supérieure n'est prise dans une tranche que si elle est chiffrée et pas plus chère au
 * point qu'un carburant chiffré de la famille de la tranche (à défaut, d'une famille inférieure) —
 * jamais parce qu'elle serait la seule chiffrée. Si la famille de la tranche n'est pas chiffrée, le plan la garde (« prix à saisir »,
 * `complete: false`, coût = borne basse) et `upperBound` donne le plan chiffré de famille supérieure
 * (borne haute).
 * Critères, dans l'ordre : objets chiffrés d'abord, kamas, gaspillage, dépassement de l'objectif,
 * nombre d'objets, puis coût partiel connu (simple départage).
 * `craftableOnly` : un prix « craft » d'un carburant que le joueur ne sait pas fabriquer compte comme
 * non chiffré.
 */
export function fillPlan(gauge: GaugeId, from: number, to: number, ctx: PriceContext, opts: BestFuelOpts): FillPlan {
  const max = opts.rules.gaugeTierMax[4]
  const start = Math.max(0, Math.min(max, Math.floor(from)))
  const goal = Math.max(0, Math.min(max, Math.ceil(to)))
  const options = fuelsOf(gauge).map((f) => {
    const o = fuelOption(f, ctx, opts)
    return opts.craftableOnly && o.craftPriceOnly ? { ...o, complete: false, unitPrice: null, costPerPoint: null, missing: [o.fuel.id] } : o
  })
  const empty: FillPlan = {
    gauge,
    from: start,
    to: goal,
    reached: start,
    steps: [],
    items: [],
    count: 0,
    cost: 0,
    complete: true,
    waste: 0,
    overshoot: 0,
    feasible: true,
    missing: [],
    upperBound: null,
  }
  if (start >= goal) return empty

  // Référence de chaque tranche : coût au point du carburant chiffré le moins cher de la famille de la
  // tranche ; si elle n'a aucun prix, celui des familles inférieures (une famille supérieure moins chère
  // au point qu'une famille inférieure chiffrée est une vraie bonne affaire : les familles inférieures
  // coûtent normalement moins cher au point). Aucune référence = famille supérieure interdite.
  const cheapestOf = (pick: (t: FuelTier) => boolean) => {
    let best: number | undefined
    for (const o of options) if (pick(o.tier) && isPriced(o) && o.costPerPoint !== null && (best === undefined || o.costPerPoint < best)) best = o.costPerPoint
    return best
  }
  const reference = new Map<FuelTier, number>()
  for (const t of FUEL_TIERS) {
    const ref = cheapestOf((x) => x === t) ?? cheapestOf((x) => x < t)
    if (ref !== undefined) reference.set(t, ref)
  }
  const mainAllowed = new Map<FuelTier, FuelOption[]>()
  const upperAllowed = new Map<FuelTier, FuelOption[]>()
  for (const t of FUEL_TIERS) {
    const ref = reference.get(t)
    mainAllowed.set(
      t,
      options.filter((o) => o.tier === t || (o.tier > t && ref !== undefined && isPriced(o) && o.costPerPoint !== null && o.costPerPoint <= ref + 1e-12)),
    )
    upperAllowed.set(
      t,
      options.filter((o) => o.tier >= t && isPriced(o)),
    )
  }
  const main = searchFill(gauge, start, goal, (t) => mainAllowed.get(t)!, opts.rules)
  if (!main) return { ...empty, cost: null, complete: false, feasible: false }
  if (!main.complete) main.upperBound = searchFill(gauge, start, goal, (t) => upperAllowed.get(t)!, opts.rules)
  return main
}

// ---------- Poussière d'élevage (héritage) ----------

export interface DustOption {
  fuel: FuelRecipe
  /** Prix en poussière chez Adèle Vage [-18,1] (Gigantesques uniquement). */
  dustCost: number
  durability: number
  pointsPerDust: number
  /** Valeur estimée d'une poussière en kamas (coût évité ; basse). */
  kamasPerDust: number
  kamasPerDustRange: [number, number]
  /** Coût au point équivalent (kamas) si l'on valorise la poussière à kamasPerDust. */
  costPerPointEquivalent: number
  confidence: string
  legacy: true
  note: string
}

/**
 * Achat d'un Gigantesque contre de la poussière d'élevage chez Adèle Vage. HÉRITAGE : la poussière
 * vient de la conversion des anciens objets (pré-3.5), n'est pas échangeable et n'a plus de source.
 */
export function dustOption(gauge: GaugeId, tier: FuelTier, rules: Ruleset): DustOption | null {
  const fuel = findFuel(gauge, tier, 'gigantesque')
  if (!fuel) return null
  const dustCost = DUST_SHOP_PRICES[tier]
  const durability = fuelDurability(fuel, rules)
  const kamasPerDust = PRICES_DEFAULT.poussiere.kamasPerPoussiere
  return {
    fuel,
    dustCost,
    durability,
    pointsPerDust: durability / dustCost,
    kamasPerDust,
    kamasPerDustRange: PRICES_DEFAULT.poussiere.range,
    costPerPointEquivalent: (dustCost * kamasPerDust) / durability,
    confidence: PRICES_DEFAULT.poussiere.confidence,
    legacy: true,
    note:
      "Héritage pré-3.5 : poussière non échangeable, sans nouvelle source depuis la 3.5. Utile seulement si vous avez un stock." +
      (rules.id === '3.7' ? ' Prix d’Adèle Vage en 3.7 inconnus.' : ''),
  }
}
