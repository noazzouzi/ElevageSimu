// Métier d'Éleveur : options de craft à un niveau donné, plan de montée niveau par niveau
// (kamas ou ressources), liste de courses, jalons de déblocage, autres sources d'XP, jours Almanax.
// Sources : research/crafts.md §6 (formule d'XP de craft, simulation « taille débloquée »),
// research/strategy.md §3 (plan par palier, pack 1 → 200), research/economy.md §10 (coûts observés),
// research/README.md §2.3 / §2.6 / §2.7 (enclos, filets, XP de capture et d'accouplement).
import { FUELS, GAME, MAKINAS, NETS, itemName } from '../data'
import type { FuelRecipe, Ingredient, MakinaRecipe, NetRecipe } from '../data'
import { FUEL_TIER_NAMES, FUEL_TIER_UNLOCK_LEVEL, JOB_XP_PER_CAPTURE, PADDOCK_UNLOCK_LEVELS } from './constants'
import { craftCost, marketPrice, resolvePrice } from './pricing'
import type { PriceContext, PriceOrigin } from './pricing'
import type { Ruleset } from './rules'
import type { FamilyId, FuelTier, GaugeId } from './types'
import { craftXp, jobLevelFromXp, jobXpForLevel, MAX_LEVEL } from './xp'

// ---------- Types ----------

export type JobRecipe = FuelRecipe | MakinaRecipe | NetRecipe
export type JobRecipeKind = 'carburant' | 'makina' | 'filet'
/** Une option de montée : une recette, ou « filet universel + capture » (option `includeCaptures`). */
export type JobOptionKind = JobRecipeKind | 'capture'
export type JobMetric = 'kamas' | 'ressources'

export const JOB_RECIPE_KINDS: JobRecipeKind[] = ['carburant', 'makina', 'filet']

export const JOB_KIND_LABELS: Record<JobOptionKind, string> = {
  carburant: 'Carburant',
  makina: 'Makina',
  filet: 'Filet',
  capture: 'Filet + capture',
}

export const JOB_METRIC_LABELS: Record<JobMetric, string> = {
  kamas: 'Le moins de kamas',
  ressources: 'Le moins de ressources',
}

/** Identifiant de l'option « Filet de capture universel + capture » (pas une recette du jeu). */
export const CAPTURE_OPTION_ID = -32521
/** Filet de capture universel (niv. 1, ratio d'XP 50 %). */
export const UNIVERSAL_NET_ID = 32521

/**
 * Ensemble « efficace » : recettes à moins de EFFICIENT_FACTOR × le meilleur ratio ressources/XP du
 * niveau. En mode kamas, si aucune recette efficace n'a de coût complet, le plan se replie sur le
 * critère ressources (et le signale) au lieu de choisir une vieille recette chiffrée mais inefficace.
 */
export const EFFICIENT_FACTOR = 2

/**
 * Départage des carburants à efficacité égale (les 6 jauges d'une même taille rapportent la même XP
 * avec le même nombre d'ingrédients) : Mangeoire d'abord (la plus consommée et la mieux chiffrée).
 */
export const GAUGE_PREFERENCE: GaugeId[] = ['mangeoire', 'dragofesse', 'abreuvoir', 'foudroyeur', 'caresseur', 'baffeur']

export interface CraftOption {
  /** Id de la recette (ou CAPTURE_OPTION_ID). */
  id: number
  name: string
  kind: JobOptionKind
  /** Niveau de la recette. */
  level: number
  gauge: GaugeId | null
  tier: FuelTier | null
  /** XP de métier par craft au niveau considéré (bonus Almanax et capture compris). */
  xp: number
  /** XP de craft seule (sans les 30 XP de la capture). */
  craftXp: number
  ingredients: Ingredient[]
  /** Nombre d'ingrédients par craft (Σ quantités). */
  ingredientCount: number
  /** Coût des ingrédients d'un craft : total connu (borne basse si incomplet), null si rien n'est chiffré. */
  cost: number | null
  costComplete: boolean
  /** Ingrédients (ou sous-ingrédients) sans prix. */
  missing: number[]
  /** Kamas par XP (coût complet seulement). */
  kamasPerXp: number | null
  /** Borne basse de kamas par XP quand le coût est incomplet. */
  kamasPerXpMin: number | null
  resourcesPerXp: number
  /** Prix HDV connu de l'objet produit (joueur ou défaut), null sinon. */
  productValue: number | null
  /** Recette bêta 3.7 utilisée (makinas). */
  beta37: boolean
}

export interface CraftOptionsOpts {
  /** Bonus d'XP de métier (0,5 = +50 %, jour Almanax du 22/10). */
  almanaxXpBonus?: number
  /** Types de recettes retenus (défaut : tous). */
  kinds?: JobRecipeKind[]
  /** Jauges de carburant autorisées (défaut : toutes). */
  fuelGauges?: GaugeId[]
}

// ---------- Recettes ----------

interface BookEntry {
  recipe: JobRecipe
  kind: JobRecipeKind
  ingredients: Ingredient[]
  ingredientCount: number
  cost: number | null
  costComplete: boolean
  missing: number[]
  productValue: number | null
  beta37: boolean
}

function kindOf(recipe: JobRecipe): JobRecipeKind {
  if ('gauge' in recipe) return 'carburant'
  if ('generation' in recipe) return 'makina'
  return 'filet'
}

/** Ingrédients d'une recette selon le ruleset (recettes bêta 3.7 des makinas quand elles existent). */
export function recipeIngredients(recipe: JobRecipe, rules: Ruleset): { ingredients: Ingredient[]; beta37: boolean } {
  if (rules.id === '3.7' && 'beta37Ingredients' in recipe && recipe.beta37Ingredients?.length)
    return { ingredients: recipe.beta37Ingredients, beta37: true }
  return { ingredients: recipe.ingredients, beta37: false }
}

/** Coût des ingrédients d'un craft (jamais le prix de l'objet fini : on le fabrique). */
export function recipeCraftCost(recipe: JobRecipe, ctx: PriceContext, rules: Ruleset): { cost: number | null; complete: boolean; missing: number[] } {
  const { ingredients, beta37 } = recipeIngredients(recipe, rules)
  if (!beta37) {
    const c = craftCost(recipe.id, ctx)
    if (c) return { cost: c.complete || c.lines.some((l) => l.subtotal !== null) ? c.total : null, complete: c.complete, missing: c.missing }
  }
  let total = 0
  let known = false
  const missing: number[] = []
  for (const ing of ingredients) {
    const p = resolvePrice(ing.id, ctx)
    if (p.price !== null) {
      total += p.price * ing.qty
      known = true
    }
    if (!p.complete) missing.push(...(p.missing.length ? p.missing : [ing.id]))
  }
  const uniq = [...new Set(missing)]
  return { cost: known || uniq.length === 0 ? total : null, complete: uniq.length === 0, missing: uniq }
}

function buildBook(ctx: PriceContext, rules: Ruleset, opts: CraftOptionsOpts): BookEntry[] {
  const kinds = new Set(opts.kinds ?? JOB_RECIPE_KINDS)
  const gauges = opts.fuelGauges && opts.fuelGauges.length ? new Set(opts.fuelGauges) : null
  const out: BookEntry[] = []
  const recipes: JobRecipe[] = [...FUELS, ...MAKINAS, ...NETS]
  for (const recipe of recipes) {
    const kind = kindOf(recipe)
    if (!kinds.has(kind)) continue
    if (kind === 'carburant' && gauges && !gauges.has((recipe as FuelRecipe).gauge)) continue
    const { ingredients, beta37 } = recipeIngredients(recipe, rules)
    const c = recipeCraftCost(recipe, ctx, rules)
    const market = marketPrice(recipe.id, ctx)
    out.push({
      recipe,
      kind,
      ingredients,
      ingredientCount: ingredients.reduce((s, i) => s + i.qty, 0),
      cost: c.cost,
      costComplete: c.complete,
      missing: c.missing,
      productValue: market.price,
      beta37,
    })
  }
  return out
}

function bonusXp(base: number, bonus: number): number {
  return bonus > 0 ? Math.floor(base * (1 + bonus)) : base
}

function toOption(e: BookEntry, xp: number, base: number): CraftOption {
  const r = e.recipe
  return {
    id: r.id,
    name: r.name,
    kind: e.kind,
    level: r.level,
    gauge: e.kind === 'carburant' ? (r as FuelRecipe).gauge : null,
    tier: e.kind === 'carburant' ? (r as FuelRecipe).tier : null,
    xp,
    craftXp: base,
    ingredients: e.ingredients,
    ingredientCount: e.ingredientCount,
    cost: e.cost,
    costComplete: e.costComplete,
    missing: e.missing,
    kamasPerXp: e.costComplete && e.cost !== null ? e.cost / xp : null,
    kamasPerXpMin: !e.costComplete && e.cost !== null && e.cost > 0 ? e.cost / xp : null,
    resourcesPerXp: e.ingredientCount / xp,
    productValue: e.productValue,
    beta37: e.beta37,
  }
}

function optionsFromBook(book: BookEntry[], jobLevel: number, bonus: number): CraftOption[] {
  const J = clampLevel(jobLevel)
  const out: CraftOption[] = []
  for (const e of book) {
    if (e.recipe.level > J) continue
    const base = craftXp(e.recipe.level, J, e.recipe.xpRatio)
    if (base <= 0) continue
    out.push(toOption(e, bonusXp(base, bonus), base))
  }
  return out
}

function gaugeRank(o: CraftOption): number {
  return o.gauge ? GAUGE_PREFERENCE.indexOf(o.gauge) : 0
}

/**
 * Toutes les recettes craftables au niveau de métier `jobLevel` (niveau de recette ≤ niveau et XP > 0) :
 * XP par craft (`craftXp(L, J, ratio)`), nombre d'ingrédients, coût par craft (complet ou non),
 * kamas par XP et ressources par XP. Triées par ressources/XP croissantes.
 */
export function craftOptionsAt(jobLevel: number, ctx: PriceContext, rules: Ruleset, opts: CraftOptionsOpts = {}): CraftOption[] {
  return sortCraftOptions(optionsFromBook(buildBook(ctx, rules, opts), jobLevel, opts.almanaxXpBonus ?? 0), 'ressources')
}

/**
 * Trie des options : `kamas` → coûts complets d'abord (kamas/XP croissants), puis les autres par
 * ressources/XP ; `ressources` → ressources/XP croissantes, puis coût connu le plus bas.
 */
export function sortCraftOptions(options: CraftOption[], metric: JobMetric): CraftOption[] {
  const byResources = (a: CraftOption, b: CraftOption) =>
    a.resourcesPerXp - b.resourcesPerXp ||
    Number(b.costComplete) - Number(a.costComplete) ||
    (a.kamasPerXp ?? Infinity) - (b.kamasPerXp ?? Infinity) ||
    b.level - a.level ||
    gaugeRank(a) - gaugeRank(b) ||
    a.id - b.id
  const byKamas = (a: CraftOption, b: CraftOption) => {
    const ka = a.kamasPerXp
    const kb = b.kamasPerXp
    if (ka !== null && kb !== null) return ka - kb || byResources(a, b)
    if (ka !== null) return -1
    if (kb !== null) return 1
    return byResources(a, b)
  }
  return [...options].sort(metric === 'kamas' ? byKamas : byResources)
}

// ---------- Capture (filet universel + capture) ----------

/**
 * Option « crafter un Filet de capture universel puis capturer une monture avec » : XP du craft du filet
 * (ratio 50 %) + 30 XP de capture. Le combat n'est pas compté (temps de jeu à prévoir).
 */
export function captureOption(jobLevel: number, ctx: PriceContext, rules: Ruleset, opts: { almanaxXpBonus?: number } = {}): CraftOption | null {
  const net = NETS.find((n) => n.id === UNIVERSAL_NET_ID)
  if (!net) return null
  const J = clampLevel(jobLevel)
  const base = craftXp(net.level, J, net.xpRatio)
  const c = recipeCraftCost(net, ctx, rules)
  const ingredientCount = net.ingredients.reduce((s, i) => s + i.qty, 0)
  const xp = bonusXp(base, opts.almanaxXpBonus ?? 0) + JOB_XP_PER_CAPTURE
  return {
    id: CAPTURE_OPTION_ID,
    name: `${net.name} + capture`,
    kind: 'capture',
    level: net.level,
    gauge: null,
    tier: null,
    xp,
    craftXp: base,
    ingredients: net.ingredients,
    ingredientCount,
    cost: c.cost,
    costComplete: c.complete,
    missing: c.missing,
    kamasPerXp: c.complete && c.cost !== null ? c.cost / xp : null,
    kamasPerXpMin: !c.complete && c.cost !== null && c.cost > 0 ? c.cost / xp : null,
    resourcesPerXp: ingredientCount / xp,
    productValue: null,
    beta37: false,
  }
}

// ---------- Choix de la meilleure recette ----------

export interface CraftChoice {
  option: CraftOption
  /** Mode kamas impossible (aucune recette efficace chiffrée) : choix au critère ressources. */
  fallback: boolean
  /** Ingrédients à chiffrer : recettes efficaces sans prix qui pourraient être moins chères. */
  toPrice: number[]
}

function chooseFrom(options: CraftOption[], metric: JobMetric): CraftChoice | null {
  if (!options.length) return null
  const byRes = sortCraftOptions(options, 'ressources')
  const bestRes = byRes[0]
  if (metric === 'ressources') return { option: bestRes, fallback: false, toPrice: bestRes.costComplete ? [] : bestRes.missing.slice(0, 12) }
  const threshold = bestRes.resourcesPerXp * EFFICIENT_FACTOR + 1e-12
  const efficient = byRes.filter((o) => o.resourcesPerXp <= threshold)
  const efficientPriced = efficient.some((o) => o.kamasPerXp !== null)
  if (!efficientPriced) {
    const ids = new Set<number>()
    for (const o of efficient.slice(0, 6)) for (const m of o.missing) ids.add(m)
    return { option: bestRes, fallback: true, toPrice: [...ids].slice(0, 12) }
  }
  const best = sortCraftOptions(options, 'kamas')[0]
  const ids = new Set<number>()
  for (const o of efficient)
    if (o.kamasPerXp === null && (o.kamasPerXpMin ?? 0) < (best.kamasPerXp ?? Infinity)) for (const m of o.missing) ids.add(m)
  return { option: best, fallback: false, toPrice: [...ids].slice(0, 12) }
}

/** Meilleure option au niveau `jobLevel` pour la métrique (repli « ressources » signalé en mode kamas). */
export function bestCraftAt(
  jobLevel: number,
  ctx: PriceContext,
  rules: Ruleset,
  metric: JobMetric,
  opts: CraftOptionsOpts & { includeCaptures?: boolean } = {},
): CraftChoice | null {
  const options = optionsFromBook(buildBook(ctx, rules, opts), jobLevel, opts.almanaxXpBonus ?? 0)
  if (opts.includeCaptures) {
    const cap = captureOption(jobLevel, ctx, rules, opts)
    if (cap) options.push(cap)
  }
  return chooseFrom(options, metric)
}

// ---------- Jalons ----------

export type MilestoneKind = 'enclos' | 'carburant' | 'filet' | 'makina'

export interface JobMilestoneDef {
  level: number
  kind: MilestoneKind
  label: string
  detail: string
}

const NET_KIND_TEXT: Record<NetRecipe['kind'], { label: string; detail: string }> = {
  universel: { label: 'Filet de capture universel', detail: '1 monture ciblée' },
  multiplicateur: { label: 'Filets multiplicateurs', detail: '1 monture ciblée, dupliquée (×2, sexe du doublon non garanti)' },
  renforce: { label: 'Filets renforcés', detail: 'zone : cercle de rayon 3' },
  multiplicateur_renforce: { label: 'Filets multiplicateurs renforcés', detail: 'zone + ×2' },
}

/**
 * Jalons du métier : enclos (40/80/120/160/200), paliers de carburant (5/55/105/155), filets
 * (100/150/200) et, si `family` est donnée, l'Optimakina de chaque génération pour cette famille.
 * Triés par niveau.
 */
export function jobMilestones(opts: { family?: FamilyId } = {}): JobMilestoneDef[] {
  const out: JobMilestoneDef[] = []
  PADDOCK_UNLOCK_LEVELS.forEach((p, i) => {
    if (p.level <= 1) return
    out.push({ level: p.level, kind: 'enclos', label: `${i + 1}e enclos`, detail: `${p.name} ${p.coords} : ${(i + 1) * 10} places en enclos` })
  })
  for (const tier of [1, 2, 3, 4] as FuelTier[]) {
    const level = FUEL_TIER_UNLOCK_LEVEL[tier]
    const cap = tier === 4 ? 'sans plafond' : `jusqu'au palier ${tier}`
    out.push({ level, kind: 'carburant', label: `${FUEL_TIER_NAMES[tier]}s (palier ${tier})`, detail: `Carburants de palier ${tier} craftables (remplissage ${cap})` })
  }
  const netLevels = new Map<string, number>()
  for (const n of NETS) if (n.kind !== 'universel') netLevels.set(n.kind, Math.min(netLevels.get(n.kind) ?? Infinity, n.level))
  for (const [kind, level] of netLevels) {
    const t = NET_KIND_TEXT[kind as NetRecipe['kind']]
    out.push({ level, kind: 'filet', label: t.label, detail: `${t.detail} ; craft et équipement` })
  }
  if (opts.family) {
    for (const m of MAKINAS)
      if (m.kind === 'optimakina' && m.family === opts.family)
        out.push({ level: m.level, kind: 'makina', label: `Optimakina G${m.generation}`, detail: m.name })
  }
  const kindOrder: Record<MilestoneKind, number> = { enclos: 0, filet: 1, carburant: 2, makina: 3 }
  return out.sort((a, b) => a.level - b.level || kindOrder[a.kind] - kindOrder[b.kind])
}

/** Prochain niveau qui débloque un enclos (ou 200). */
export function nextPaddockTarget(level: number): number {
  const next = PADDOCK_UNLOCK_LEVELS.find((p) => p.level > level)
  return next ? next.level : MAX_LEVEL
}

/** Nombre d'enclos débloqués au niveau de métier donné. */
export function paddocksAt(level: number): number {
  return PADDOCK_UNLOCK_LEVELS.filter((p) => p.level <= level).length
}

// ---------- Plan de montée ----------

export interface LevelingOptions extends CraftOptionsOpts {
  rules: Ruleset
  metric: JobMetric
  /** Considérer « filet universel + capture » (30 XP de capture en plus du craft). */
  includeCaptures?: boolean
  /** XP déjà gagnée dans le niveau de départ. */
  startXp?: number
  /** Famille pour les jalons d'Optimakina. */
  family?: FamilyId
}

export interface PlanSegment {
  fromLevel: number
  toLevel: number
  recipeId: number
  recipeName: string
  kind: JobOptionKind
  recipeLevel: number
  gauge: GaugeId | null
  /** Ingrédients d'un craft (×crafts pour l'étape). */
  ingredients: Ingredient[]
  crafts: number
  /** Captures (option filet + capture). */
  captures: number
  xp: number
  /** XP par craft au début et à la fin du segment. */
  xpPerCraftStart: number
  xpPerCraftEnd: number
  resources: number
  /** Coût connu du segment (borne basse si incomplet). */
  cost: number
  complete: boolean
  /** Choisi au critère ressources faute de prix (mode kamas). */
  fallback: boolean
  toPrice: number[]
}

export interface ShoppingLine {
  id: number
  name: string
  qty: number
  unit: number | null
  subtotal: number | null
  origin: PriceOrigin
  /** Confiance du prix par défaut (origine « defaut »). */
  confidence?: string
  missing: boolean
}

/** Cumuls du plan au moment où un niveau est atteint. */
export interface LevelProgress {
  level: number
  crafts: number
  resources: number
  cost: number
  costComplete: boolean
  xp: number
}

export interface PlanMilestone extends JobMilestoneDef {
  status: 'acquis' | 'plan' | 'au-dela'
  /** Cumuls au moment où le jalon est atteint (statut « plan »). */
  crafts: number | null
  cost: number | null
  costComplete: boolean
  resources: number | null
  xp: number | null
}

export interface LevelingTotals {
  crafts: number
  captures: number
  xp: number
  resources: number
  cost: number
  costComplete: boolean
  /** Valeur HDV connue des objets produits (carburants, makinas, filets). */
  productValue: number
  /** Crafts dont l'objet produit n'a pas de prix HDV connu. */
  productsUnpriced: number
}

export interface LevelingPlan {
  fromLevel: number
  toLevel: number
  metric: JobMetric
  xpNeeded: number
  segments: PlanSegment[]
  totals: LevelingTotals
  shopping: ShoppingLine[]
  milestones: PlanMilestone[]
  /** Cumuls à chaque niveau atteint (fromLevel + 1 … niveau atteint). */
  progress: LevelProgress[]
  /** Niveaux joués en repli « ressources » (mode kamas). */
  fallbackLevels: number
  /** Ingrédients à chiffrer pour fiabiliser le plan (union des segments). */
  toPrice: number[]
  /** Niveau où aucune recette ne rapporte d'XP avec les filtres choisis (plan interrompu). */
  blockedAt: number | null
  reachedLevel: number
}

function clampLevel(level: number): number {
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number.isFinite(level) ? level : 1)))
}

/**
 * Plan de montée du niveau `fromLevel` au niveau `toLevel`, simulé niveau par niveau : à chaque niveau,
 * la meilleure option pour la métrique (kamas/XP ou ressources/XP) est craftée jusqu'au niveau suivant.
 * En mode kamas, sans recette efficace chiffrée, repli sur le minimum de ressources par XP (signalé).
 * Renvoie les segments (même recette sur plusieurs niveaux), les totaux, la liste de courses agrégée
 * et les jalons.
 */
export function levelingPlan(fromLevel: number, toLevel: number, ctx: PriceContext, opts: LevelingOptions): LevelingPlan {
  const from = clampLevel(fromLevel)
  const to = Math.max(from, clampLevel(toLevel))
  const bonus = Math.max(0, opts.almanaxXpBonus ?? 0)
  const book = buildBook(ctx, opts.rules, opts)
  const levelSpan = jobXpForLevel(Math.min(MAX_LEVEL, from + 1)) - jobXpForLevel(from)
  let xp = jobXpForLevel(from) + Math.max(0, Math.min(Math.floor(opts.startXp ?? 0), Math.max(0, levelSpan - 1)))
  const startXp = xp
  const targetXp = jobXpForLevel(to)

  const segments: PlanSegment[] = []
  const qty = new Map<number, number>()
  const reachedAt = new Map<number, { crafts: number; cost: number; complete: boolean; resources: number; xp: number }>()
  const totals: LevelingTotals = { crafts: 0, captures: 0, xp: 0, resources: 0, cost: 0, costComplete: true, productValue: 0, productsUnpriced: 0 }
  let fallbackLevels = 0
  let blockedAt: number | null = null
  const toPrice = new Set<number>()

  while (xp < targetXp) {
    const level = jobLevelFromXp(xp)
    const options = optionsFromBook(book, level, bonus)
    if (opts.includeCaptures) {
      const cap = captureOption(level, ctx, opts.rules, { almanaxXpBonus: bonus })
      if (cap) options.push(cap)
    }
    const choice = chooseFrom(options, opts.metric)
    if (!choice) {
      blockedAt = level
      break
    }
    const o = choice.option
    const nextXp = Math.min(jobXpForLevel(level + 1), targetXp)
    const n = Math.ceil((nextXp - xp) / o.xp)
    xp += n * o.xp
    const reached = Math.min(to, jobLevelFromXp(xp))
    const segCost = (o.cost ?? 0) * n
    const complete = o.costComplete && o.cost !== null
    if (choice.fallback) fallbackLevels += 1
    for (const id of choice.toPrice) toPrice.add(id)
    for (const ing of o.ingredients) qty.set(ing.id, (qty.get(ing.id) ?? 0) + ing.qty * n)

    totals.crafts += n
    totals.xp += n * o.xp
    totals.resources += n * o.ingredientCount
    totals.cost += segCost
    totals.costComplete &&= complete
    if (o.kind === 'capture') totals.captures += n
    else if (o.productValue !== null) totals.productValue += o.productValue * n
    else totals.productsUnpriced += n

    const last = segments[segments.length - 1]
    if (last && last.recipeId === o.id && last.fallback === choice.fallback) {
      last.toLevel = reached
      last.crafts += n
      last.captures += o.kind === 'capture' ? n : 0
      last.xp += n * o.xp
      last.xpPerCraftEnd = o.xp
      last.resources += n * o.ingredientCount
      last.cost += segCost
      last.complete &&= complete
      for (const id of choice.toPrice) if (!last.toPrice.includes(id)) last.toPrice.push(id)
    } else {
      segments.push({
        fromLevel: level,
        toLevel: reached,
        recipeId: o.id,
        recipeName: o.name,
        kind: o.kind,
        recipeLevel: o.level,
        gauge: o.gauge,
        ingredients: o.ingredients,
        crafts: n,
        captures: o.kind === 'capture' ? n : 0,
        xp: n * o.xp,
        xpPerCraftStart: o.xp,
        xpPerCraftEnd: o.xp,
        resources: n * o.ingredientCount,
        cost: segCost,
        complete,
        fallback: choice.fallback,
        toPrice: [...choice.toPrice],
      })
    }
    for (let l = level + 1; l <= reached; l++)
      if (!reachedAt.has(l)) reachedAt.set(l, { crafts: totals.crafts, cost: totals.cost, complete: totals.costComplete, resources: totals.resources, xp: totals.xp })
  }

  const shopping: ShoppingLine[] = [...qty.entries()]
    .map(([id, q]) => {
      const p = resolvePrice(id, ctx)
      return {
        id,
        name: itemName(id),
        qty: q,
        unit: p.price,
        subtotal: p.price === null ? null : p.price * q,
        origin: p.origin,
        confidence: p.confidence,
        missing: !p.complete || p.price === null,
      }
    })
    .sort((a, b) => Number(a.missing) - Number(b.missing) || (b.subtotal ?? 0) - (a.subtotal ?? 0) || b.qty - a.qty || a.name.localeCompare(b.name, 'fr'))

  const reachedLevel = jobLevelFromXp(Math.min(xp, jobXpForLevel(MAX_LEVEL)))
  const milestones: PlanMilestone[] = jobMilestones({ family: opts.family }).map((m) => {
    const at = reachedAt.get(m.level)
    if (m.level <= from) return { ...m, status: 'acquis', crafts: null, cost: null, costComplete: true, resources: null, xp: null }
    if (at && m.level <= to)
      return { ...m, status: 'plan', crafts: at.crafts, cost: at.cost, costComplete: at.complete, resources: at.resources, xp: at.xp }
    return { ...m, status: 'au-dela', crafts: null, cost: null, costComplete: true, resources: null, xp: null }
  })

  return {
    fromLevel: from,
    toLevel: to,
    metric: opts.metric,
    xpNeeded: Math.max(0, targetXp - startXp),
    segments,
    totals,
    shopping,
    milestones,
    progress: [...reachedAt.entries()].map(([level, a]) => ({ level, crafts: a.crafts, resources: a.resources, cost: a.cost, costComplete: a.complete, xp: a.xp })),
    fallbackLevels,
    toPrice: [...toPrice],
    blockedAt,
    reachedLevel: Math.min(to, reachedLevel),
  }
}

/** Texte de la liste de courses (copier-coller : « Nom × quantité »). */
export function shoppingListText(lines: ShoppingLine[]): string {
  return lines.map((l) => `${l.name} × ${l.qty}`).join('\n')
}

// ---------- Autres sources d'XP ----------

/** XP de métier pour `count` montures capturées (30 par monture). */
export function captureJobXp(count: number): number {
  return Math.max(0, Math.floor(count)) * JOB_XP_PER_CAPTURE
}

/** XP de métier d'un accouplement : k × (G_A + G_B) × bébés (k = 30 en 3.6/3.7, 10 en 3.5). */
export function matingJobXp(genA: number, genB: number, rules: Ruleset, babies = 1): number {
  return rules.matingXpPerGeneration * (Math.max(0, genA) + Math.max(0, genB)) * Math.max(0, babies)
}

export interface XpEquivalent {
  id: string
  label: string
  /** XP par action. */
  xpEach: number
  /** Nombre d'actions pour couvrir l'XP demandée. */
  count: number
  note: string
  confidence: 'high' | 'medium' | 'low'
}

/**
 * Équivalents des autres sources d'XP pour couvrir `xpNeeded` : captures (30/monture) et accouplements
 * (`rules.matingXpPerGeneration × (G_A + G_B)`) pour quelques couples types.
 */
export function otherXpSources(xpNeeded: number, rules: Ruleset, pairs: [number, number][] = [[1, 1], [4, 4], [6, 6], [9, 9]]): XpEquivalent[] {
  const need = Math.max(0, xpNeeded)
  const out: XpEquivalent[] = [
    {
      id: 'capture',
      label: 'Capture d’une monture sauvage',
      xpEach: JOB_XP_PER_CAPTURE,
      count: Math.ceil(need / JOB_XP_PER_CAPTURE),
      note: 'Filet consommé au lancer, capture à 100 % si le combat est gagné. XP du doublon d’un filet multiplicateur : non vérifiée.',
      confidence: 'high',
    },
  ]
  for (const [a, b] of pairs) {
    const each = matingJobXp(a, b, rules)
    if (each <= 0) continue
    out.push({
      id: `accouplement-${a}-${b}`,
      label: `Accouplement G${a} × G${b}`,
      xpEach: each,
      count: Math.ceil(need / each),
      note: `${rules.matingXpPerGeneration} XP par génération et par parent (règles ${rules.id}) ; ×2 avec un parent Reproducteur (2 bébés).`,
      confidence: 'high',
    })
  }
  return out
}

// ---------- Almanax ----------

export interface JobAlmanaxDay {
  /** Prochaine date (ISO AAAA-MM-JJ). */
  date: string
  name: string
  effect: string
  use: string | null
  daysUntil: number
  /** Bonus d'XP de métier (0,5 = +50 %), 0 sinon. */
  xpBonus: number
  /** Le bonus ne vise que les Éleveurs. */
  breederOnly: boolean
  ingredientSaving: number
  doubleCraftChance: number
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}

function isJobRelated(effect: string): boolean {
  return /XP\s+(Éleveurs|tous métiers)|ingrédients|double craft/i.test(effect)
}

/**
 * Prochains jours Almanax utiles au métier (XP de métier, économie d'ingrédients, double craft), à partir
 * de `todayIso` (inclus). Dates annuelles fixes (GAME.almanaxCalendar, DofusDB) projetées sur l'année
 * suivante si besoin. Triés par date.
 */
export function jobAlmanaxDays(todayIso: string): JobAlmanaxDay[] {
  const today = dayNumber(todayIso)
  const year = Number(todayIso.slice(0, 4))
  const seen = new Map<string, JobAlmanaxDay>()
  for (const e of GAME.almanaxCalendar) {
    if (!isJobRelated(e.effect)) continue
    const mmdd = e.date.slice(5)
    if (seen.has(mmdd)) continue
    let date = `${year}-${mmdd}`
    if (dayNumber(date) < today) date = `${year + 1}-${mmdd}`
    const xpMatch = /\+(\d+)\s*%\s*XP/i.exec(e.effect)
    const saving = /(\d+)\s*%\s*d.ingrédients/i.exec(e.effect)
    const dbl = /(\d+)\s*%.*double craft/i.exec(e.effect)
    seen.set(mmdd, {
      date,
      name: e.name,
      effect: e.effect,
      use: e.use ?? null,
      daysUntil: dayNumber(date) - today,
      xpBonus: xpMatch ? Number(xpMatch[1]) / 100 : 0,
      breederOnly: /Éleveurs/i.test(e.effect),
      ingredientSaving: saving ? Number(saving[1]) / 100 : 0,
      doubleCraftChance: dbl ? Number(dbl[1]) / 100 : 0,
    })
  }
  return [...seen.values()].sort((a, b) => a.daysUntil - b.daysUntil)
}

// ---------- Repères de la recherche ----------

export interface JobCostReport {
  range: string
  value: string
  date: string
  source: string
  confidence: 'medium' | 'low'
  note: string
}

/** Coûts de montée rapportés par la communauté (research/economy.md §10) : témoignages, pas des calculs. */
export const JOB_COST_REPORTS: JobCostReport[] = [
  {
    range: '1 → 195',
    value: '≈ 30 M',
    date: 'début mars 2026',
    source: 'Scripts05, « Aventure élevage EP.1 » (YouTube)',
    confidence: 'low',
    note: 'Projection en pleine spéculation de lancement, pas un bilan.',
  },
  {
    range: '1 → 200',
    value: '≈ 7 M (bêta) / ≈ 70 M (après la sortie)',
    date: 'avril 2026',
    source: 'Messages de forum relayés par Solomonk-e (Salar)',
    confidence: 'low',
    note: 'Deux joueurs, deux moments du marché : l’écart montre la volatilité des prix.',
  },
  {
    range: '40 → 80',
    value: '> 10 M de crafts',
    date: 'mars-avril 2026',
    source: 'Forum, relayé par Solomonk-e',
    confidence: 'low',
    note: '« contre 1 à 2 M pour la plupart des métiers ».',
  },
  {
    range: '14 → 125',
    value: '≈ 13 M de ressources (valeur HDV)',
    date: '01/05/2026',
    source: 'HumaGo, « Up des premiers niveaux de mon métier éleveur » (YouTube)',
    confidence: 'medium',
    note: 'Ressources droppées par son équipe ; carburants produits estimés à ≈ 15-16 M (pendant un bonus d’XP de métier).',
  },
  {
    range: '1 → 200',
    value: '> 23 000 ressources',
    date: '01/03/2026',
    source: 'Tenmalexis, « Le pack pour monter Éleveur 200 » (YouTube) ; dafous',
    confidence: 'medium',
    note: 'Pack vérifié par la recherche : 26 filets + 6 996 carburants ≈ 398 380 XP (1 Petit Philtre de plus au passage 74 → 75).',
  },
]
