// Accès typé aux données générées (scripts/build-data.mjs → src/data/*.json).
import type { FamilyId, FuelSize, FuelTier, GaugeId, MakinaKind, Species } from '../domain/types'
import gameJson from './game.json'
import pricesJson from './prices-default.json'
import recipesJson from './recipes.json'
import speciesJson from './species.json'
import strategyJson from './strategy.json'

// ---------- Espèces ----------

export interface CaptureZone {
  subarea: string
  area: string
  xRange: [number, number]
  yRange: [number, number]
  nearestZaap: { name: string; coords: [number, number] }
  levels: [number, number]
  monsters: { id: number; name: string; archimonster?: boolean; note?: string }[]
}

export interface FamilyInfo {
  label: string
  plural: string
  clientSpeciesId: number
  dofusdbFamilyId: number
  commonBonus: string
  extractionItemId: number
  extractionItemName: string
  captureZone: CaptureZone | null
}

const speciesData = speciesJson as unknown as { families: Record<FamilyId, FamilyInfo>; species: Species[] }

export const FAMILIES: Record<FamilyId, FamilyInfo> = speciesData.families
export const FAMILY_IDS: FamilyId[] = ['dragodinde', 'muldo', 'volkorne']
export const SPECIES: Species[] = speciesData.species

const speciesById = new Map(SPECIES.map((s) => [s.id, s]))
const crossingIndex = new Map<string, number>()
for (const s of SPECIES) for (const [a, b] of s.crossings) crossingIndex.set(pairKey(a, b), s.id)

function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`
}

export function getSpecies(id: number): Species | undefined {
  return speciesById.get(id)
}

/** Espèce obtenue en croisant a × b (comme nouvelle génération), ou undefined. */
export function crossingChild(a: number, b: number): number | undefined {
  if (a === b) return undefined
  return crossingIndex.get(pairKey(a, b))
}

export function speciesOfFamily(family: FamilyId, opts: { breedableOnly?: boolean } = {}): Species[] {
  return SPECIES.filter((s) => s.family === family && (!opts.breedableOnly || s.breedable))
}

/** Espèces que l'on peut obtenir en croisant `id` avec un partenaire : [{partner, child}]. */
export function childrenOf(id: number): { partner: number; child: number }[] {
  const out: { partner: number; child: number }[] = []
  for (const s of SPECIES)
    for (const [a, b] of s.crossings) {
      if (a === id) out.push({ partner: b, child: s.id })
      else if (b === id) out.push({ partner: a, child: s.id })
    }
  return out
}

/** Valeur d'une statistique au niveau L (calcul entier exact). */
export function statValue(stat: { r1: number; r2: number }, level: number): number {
  const L = Math.max(1, Math.min(200, Math.floor(level)))
  return Math.floor((stat.r1 * Math.min(L, 100) + stat.r2 * Math.max(0, L - 100)) / 100)
}

/** Bonus d'une espèce au niveau L : [{name, value}]. */
export function speciesStatsAt(species: Species, level: number): { name: string; value: number }[] {
  return species.stats.map((s) => ({ name: s.name, value: statValue(s, level) }))
}

// ---------- Recettes ----------

export interface Ingredient {
  id: number
  qty: number
}

export interface IngredientInfo {
  id: number
  name: string
  level: number
  typeId: number
  typeName?: string | null
  npcPrice: number | null
  craftedByEleveur: boolean
  usedIn: number
  isMountResource?: boolean
  source?: {
    kind: 'drop' | 'harvest' | 'other'
    details: string
    job: string | null
    jobLevel: number | null
    bossOnly: boolean
    requiresHunterJobLevel: number | null
    monsters: { name: string; levelMin: number; levelMax: number; dropPct: number; archmonster: boolean; boss: boolean }[]
  }
}

export interface FuelRecipe {
  id: number
  name: string
  level: number
  ingredients: Ingredient[]
  gauge: GaugeId
  tier: FuelTier
  size: FuelSize
  /** Durabilité en 3.5/3.6 (×2 en 3.7). */
  durability: number
  fillCap: number
  xpRatio: number
}

export interface MakinaRecipe {
  id: number
  name: string
  level: number
  ingredients: Ingredient[]
  kind: MakinaKind
  family: FamilyId
  generation: number
  xpRatio: number
  beta37Ingredients?: Ingredient[] | null
}

export interface NetRecipe {
  id: number
  name: string
  level: number
  ingredients: Ingredient[]
  kind: 'universel' | 'multiplicateur' | 'renforce' | 'multiplicateur_renforce'
  family: FamilyId | null
  xpRatio: number
}

const recipesData = recipesJson as unknown as {
  fuels: FuelRecipe[]
  makinas: MakinaRecipe[]
  nets: NetRecipe[]
  ingredients: IngredientInfo[]
}

export const FUELS: FuelRecipe[] = recipesData.fuels
export const MAKINAS: MakinaRecipe[] = recipesData.makinas
export const NETS: NetRecipe[] = recipesData.nets
export const INGREDIENTS: IngredientInfo[] = recipesData.ingredients

const ingredientById = new Map(INGREDIENTS.map((i) => [i.id, i]))
const recipeById = new Map<number, FuelRecipe | MakinaRecipe | NetRecipe>(
  [...FUELS, ...MAKINAS, ...NETS].map((r) => [r.id, r]),
)

export function getIngredient(id: number): IngredientInfo | undefined {
  return ingredientById.get(id)
}

export function getRecipe(id: number): FuelRecipe | MakinaRecipe | NetRecipe | undefined {
  return recipeById.get(id)
}

/** Nom d'un objet connu (ingrédient, carburant, makina, filet, objet-monture). */
export function itemName(id: number): string {
  return ingredientById.get(id)?.name ?? recipeById.get(id)?.name ?? SPECIES.find((s) => s.itemId === id)?.name ?? `Objet #${id}`
}

export function findMakina(kind: MakinaKind, family: FamilyId, generation: number): MakinaRecipe | undefined {
  return MAKINAS.find((m) => m.kind === kind && m.family === family && m.generation === generation)
}

// ---------- Règles et tables de jeu ----------

export interface AlmanaxBonus {
  month: string
  date: string
  effect: string
  gauge?: string
  ability?: string
  meryde?: string
}

export interface AlmanaxDay {
  date: string
  name: string
  effect: string
  use?: string
}

interface GameData {
  liveClientVersion: string
  betaClientVersion: string
  /** XP cumulée pour atteindre le niveau L (index L−1). */
  mountXpTable: number[]
  jobXpTable: number[]
  almanaxBreedingBonuses: AlmanaxBonus[]
  almanaxCalendar: AlmanaxDay[]
  genetonShop: unknown[]
  nets: unknown[]
  naturalAbilityOdds37: Record<string, number>
  changes37: { status: string; changes: unknown[] }
  timeline: unknown[]
}

export const GAME = gameJson as unknown as GameData

// ---------- Prix par défaut ----------

export type PriceType = 'observed' | 'derived' | 'floor-estimate' | 'estimate' | 'non-tradable'

export interface DefaultItemPrice {
  id: number | null
  name: string
  category: string | null
  price: number | null
  range: [number, number] | null
  priceType: PriceType
  confidence: string
  date: string | null
  source: string | null
  notes: string | null
}

export interface DefaultMountPrice {
  family: FamilyId | null
  generation: number | null
  name: string | null
  level: number | null
  state: string | null
  price: number | null
  range: [number, number] | null
  priceType: PriceType
  confidence: string
  date: string | null
  source: string | null
  notes: string | null
}

export interface PricesDefault {
  asOf: string
  server: string
  notes: string[]
  priceTypeLegend: Record<string, string>
  sources: Record<string, string>
  marketFees: { hdvListingTaxPct: number; priceChangeFeePct: number; notes: string }
  items: DefaultItemPrice[]
  mounts: DefaultMountPrice[]
  genetons: { kamasPerGeneton: number; range: [number, number]; basis: string; confidence: string; shop: unknown[] }
  poussiere: { kamasPerPoussiere: number; range: [number, number]; confidence: string; shop: unknown[] }
  // Structure riche (brisage, extraction, coûts par point…) : voir research/data/prices-default.json.
  valuation: Record<string, unknown>
  coverage: Record<string, unknown>
}

export const PRICES_DEFAULT = pricesJson as unknown as PricesDefault

const defaultItemPriceById = new Map(
  PRICES_DEFAULT.items.filter((i) => i.id !== null && i.price !== null).map((i) => [i.id as number, i]),
)

export function defaultItemPrice(id: number): DefaultItemPrice | undefined {
  return defaultItemPriceById.get(id)
}

// ---------- Stratégie ----------

export type Condition =
  | { field: string; op: 'lt' | 'le' | 'gt' | 'ge' | 'eq' | 'between' | 'in'; value: unknown }
  | { all: Condition[] }
  | { any: Condition[] }

export interface StrategyRule {
  id: string
  priority?: number
  title: string
  when?: Condition
  then: string
  rationale?: string
  example?: string
  confidence?: string
}

export interface StrategyPhase {
  id: string
  title: string
  jobLevelRange: [number, number]
  paddocks?: number
  goals: string[]
  actions: string[]
  exitCriteria: string[]
}

export interface StrategyData {
  phases: StrategyPhase[]
  paddockRules: StrategyRule[]
  paddockAllocationByCount: Record<string, string>
  matingRules: StrategyRule[]
  captureRules: StrategyRule[]
  mountFateGrid: { order: number; if: string; do: string; label: string }[]
  formulas: Record<string, string>
  dailyRoutine: Record<string, unknown>
  jobLevelingPlan: { from: number; to: number; xpNeeded: number; recipes: string[]; unlocks?: string[]; alternatives?: string }[]
  jobLevelingNotes: Record<string, unknown>
  commonMistakes: { id: string; mistake: string; consequence: string; fix: string }[]
  simulation: { keyFindings: string[]; caveats: string[] }
  toolsReview: unknown[]
  sources: unknown[]
}

export const STRATEGY = strategyJson as unknown as StrategyData
