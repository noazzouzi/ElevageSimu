// Estimateur d'investissement (docs/SPEC-v2.md §5) : pour un budget en kamas, cherche l'allocation qui
// maximise le bénéfice net sur l'horizon — monter le métier d'Éleveur (enclos, carburants, filets),
// stock de départ (G1 achetées à l'HDV), palier de jauge et stratégie, mode de rentabilité — sans
// jamais dépasser le budget (dépenses du jour 0 + trésorerie engagée avant que les ventes ne paient),
// puis en tire un plan d'action daté, une feuille de route, la courbe de trésorerie, le point mort, des
// projections à 30/60/90 jours, des allocations alternatives, une sensibilité et les risques.
//
// Modèle (hypothèses explicites, renvoyées dans `assumptions`) :
// - montée du métier : `job.levelingPlan` au critère kamas, aux prix du serveur ; les crafts commencent
//   le jour 0 (jour des achats) au rythme `craftsPerHour` × `craftHoursPerDay` (ESTIMATION) ; un niveau
//   atteint en fin de journée débloque son enclos le lendemain ; l'XP d'Éleveur gagnée en élevant
//   (captures, accouplements : tirage de production) fait aussi monter le niveau ;
// - élevage : `production.runProduction` avec le calendrier d'enclos qui en découle (`paddockSchedule`),
//   prix de craft et filet au niveau visé ;
// - trésorerie : jour 0 = ingrédients du métier + G1 achetées + socle des jauges des enclos ouverts ;
//   socle d'un nouvel enclos payé le jour où il ouvre ; revente des objets fabriqués plafonnée par le
//   volume du marché ; la trésorerie maximale engagée est lue sur le 10e centile des tirages (prudent) ;
// - un prix inconnu n'est jamais compté 0 : `complete` / `missing`, montants connus = bornes.
//
// Module pur : aucun React, aucun store.
import { FAMILIES, FUELS, MAKINAS, NETS, getSpecies, itemName } from '../data'
import { formatKamas, formatNumber } from '../lib/format'
import { FUEL_TIER_UNLOCK_LEVEL, PADDOCK_SLOTS, PADDOCK_UNLOCK_LEVELS } from './constants'
import { BRISAGE_RISK_NOTE } from './economy'
import { jobMilestones, levelingPlan, paddocksAt, recipeCraftCost, type JobRecipe, type LevelingPlan, type PlanSegment } from './job'
import { exportAgeDays, frenchDay, marketDepth, MARKET_STALE_DAYS, MOUNT_MARKET_NOTE } from './market'
import { marketPrice, resolvePrice, type PriceContext } from './pricing'
import {
  COMPARED_MODES,
  normalizeProductionConfig,
  productionPlan,
  productionPriceBook,
  profitMode,
  runProduction,
  simulateProduction,
  strategyLabel,
  type InitialStockLine,
  type PaddockStep,
  type ProductionConfig,
  type ProductionMode,
  type ProductionPrices,
  type ProductionSummary,
  type ProfitModeId,
  type ProgressInfo,
  type StrategyParams,
} from './production'
import type { Ruleset } from './rules'
import type { FamilyId, FuelTier } from './types'
import { jobLevelFromXp, jobXpForLevel } from './xp'

// ---------- Constantes ----------

/** Crafts par heure de craft (ESTIMATION : fabrication en série, achats des ingrédients à l'HDV compris). */
export const DEFAULT_CRAFTS_PER_HOUR = 1500
/** Part du temps de jeu consacrée aux crafts pendant la montée du métier (le reste : captures). */
export const DEFAULT_CRAFT_TIME_SHARE = 0.5
/** Niveaux visés candidats : enclos 40/80/120/160/200 et filet multiplicateur (100). */
export const INVESTMENT_JOB_TARGETS = [40, 80, 100, 120, 160, 200]
/** Jours des projections. */
export const PROJECTION_DAYS = [30, 60, 90]
/** Préréglages de budget (kamas) et d'horizon (jours) de la page. */
export const BUDGET_PRESETS = [5_000_000, 20_000_000, 50_000_000]
export const HORIZON_PRESETS = [30, 60, 90]
/** Durée simulée minimale (projections à 90 jours). */
export const MIN_SIMULATION_DAYS = 90
export const MIN_HORIZON_DAYS = 7
export const MAX_HORIZON_DAYS = 365
/** La montée du métier doit tenir dans cette part de l'horizon (sinon le niveau n'est pas proposé). */
export const MAX_LEVELING_SHARE = 0.5
/** Prix sentinelle d'un objet qu'on s'interdit d'acheter et qu'on ne sait pas fabriquer. */
export const UNAVAILABLE_PRICE = 1e15
/** Tirages de l'évaluation finale (Monte-Carlo) et de la sensibilité. */
export const DEFAULT_INVESTMENT_RUNS = 3
export const SENSITIVITY_RUNS = 2

export interface InvestmentLevers {
  /** Monter le métier d'Éleveur en achetant les ingrédients (enclos, paliers, filets). */
  levelJob: boolean
  /** Acheter des montures G1 à l'HDV (stock de départ + achats quotidiens) en plus des captures. */
  buyG1: boolean
  /** Acheter les carburants à l'HDV quand c'est moins cher (sinon : seulement fabriqués, paliers à portée du métier). */
  buyFuels: boolean
  /** Acheter filets et makinas à l'HDV quand c'est moins cher (sinon : seulement fabriqués). */
  buyGear: boolean
  /** Revendre à l'HDV les objets fabriqués en montant le métier (plafonné par le volume du marché). */
  resellCrafts: boolean
}

export const DEFAULT_INVESTMENT_LEVERS: InvestmentLevers = { levelJob: true, buyG1: true, buyFuels: true, buyGear: true, resellCrafts: true }

export const LEVER_LABELS: Record<keyof InvestmentLevers, { label: string; hint: string }> = {
  levelJob: { label: 'Monter le métier d’Éleveur en achetant les ingrédients', hint: 'Plus d’enclos (40/80/120/160/200), carburants de palier supérieur, filets multiplicateurs.' },
  buyG1: { label: 'Acheter des montures G1 à l’HDV', hint: 'Stock de départ et achats quotidiens en plus des captures (prix de l’objet-monture, plafonnés par son volume).' },
  buyFuels: { label: 'Acheter les carburants à l’HDV', hint: 'Sinon : carburants fabriqués seulement (paliers à portée de votre niveau d’Éleveur).' },
  buyGear: { label: 'Acheter filets et makinas à l’HDV', hint: 'Sinon : fabriqués seulement (Optimakina abandonnée si hors de portée).' },
  resellCrafts: { label: 'Revendre les objets fabriqués en montant le métier', hint: 'Carburants, filets, makinas revendus à l’HDV, au plus la part du volume quotidien réglée pour le serveur.' },
}

/** Modes proposés par l'estimateur (« auto » + modes comparés). */
export const INVESTMENT_MODE_IDS: ProfitModeId[] = ['auto', ...COMPARED_MODES]

// ---------- Entrées ----------

export interface InvestmentProfile {
  /** Niveau d'Éleveur actuel. */
  jobLevel: number
  /** XP déjà gagnée dans ce niveau. */
  jobXp?: number
  hoursPerDay: number
  /** Personnages qui capturent (`settings.accounts`). */
  characters: number
  rules: Ruleset
  /** Famille préférée du profil. */
  family?: FamilyId | null
  /** Mode « auto » : seulement la famille préférée. */
  onlyFamily?: boolean
  sessionsPerDay?: number
  captureHoursPerDay?: number
  fightsPerHour?: number
}

export interface InvestmentOptions {
  /** Crafts par heure (défaut 1 500, ESTIMATION). */
  craftsPerHour?: number
  /** Heures de craft par jour pendant la montée du métier (défaut : la moitié du temps de jeu). */
  craftHoursPerDay?: number
  /** Recherche réduite (tests, aperçu). */
  quick?: boolean
  /** Tirages de l'évaluation finale (défaut 3). */
  runs?: number
  seed?: number
  /** Niveaux visés candidats (défaut `INVESTMENT_JOB_TARGETS`). */
  jobTargets?: number[]
  /** Calculer la sensibilité (défaut vrai). */
  sensitivity?: boolean
}

export interface InvestmentInput {
  /** Budget total (kamas). */
  budget: number
  /** Horizon d'optimisation (jours). */
  horizonDays: number
  mode: ProfitModeId
  profile: InvestmentProfile
  levers?: Partial<InvestmentLevers>
  /** Réserve de sécurité jamais engagée (kamas). */
  safetyReserve?: number
  /** Prix du serveur (contexte avec marché importé, taxe, part du volume vendable, génétons…). */
  prices: ProductionPrices
  /** Date du jour (AAAA-MM-JJ) : ancienneté des prix. */
  today?: string
  options?: InvestmentOptions
}

// ---------- Sorties ----------

export interface ModeFamily {
  modeId: ProfitModeId
  family: FamilyId
  mode: ProductionMode
  label: string
}

export interface InvestmentAllocation {
  id: string
  modeId: ProfitModeId
  modeLabel: string
  family: FamilyId
  mode: ProductionMode
  jobFrom: number
  jobTo: number
  strategy: StrategyParams
  strategyLabel: string
  tier: FuelTier
  /** G1 achetées le jour 0. */
  g1Stock: number
  /** G1 achetées par jour (au plus ; plafonné par le volume de leurs objets). */
  g1PerDay: number
  /** Description courte (« Métier 1 → 120 · Rush Corne G4 · palier 2 »). */
  summary: string
}

export interface ShoppingItem {
  category: 'metier' | 'montures' | 'socle' | 'fonds'
  id: number | null
  name: string
  qty: number | null
  unitPrice: number | null
  total: number | null
  origin: string
  missing: boolean
  /** Ventes du marché (24 h) et moyenne par jour (30 j). */
  sold24: number | null
  perDayAvg: number | null
  /** Quantité ÷ ventes moyennes par jour : jours de volume du serveur. */
  daysOfVolume: number | null
  note?: string
}

export interface CashFlowPoint {
  day: number
  paddocks: number
  /** Achats d'investissement du jour (jour 0, socle d'un nouvel enclos). */
  investment: number
  /** Coûts de production connus (moyenne des tirages). */
  costs: number
  /** Revenus connus (production + revente des crafts). */
  revenue: number
  /** Dont revente des objets fabriqués. */
  resale: number
  net: number
  cumulative: number
  /** Cumul au 10e / 90e centile des tirages de production. */
  cumulativeLow: number
  cumulativeHigh: number
}

export interface LevelDay {
  level: number
  /** Jour où le niveau est atteint (fin de journée ; 0 = jour des achats). */
  day: number
  /** Atteint par les crafts, ou grâce à l'XP d'élevage (captures, accouplements). */
  source: 'craft' | 'elevage'
  kind: 'enclos' | 'carburant' | 'filet' | 'objectif'
  label: string
  /** Enclos débloqués à ce niveau. */
  paddocks: number
}

export interface ResaleLine {
  id: number
  name: string
  qty: number
  unitNet: number
  /** Ventes possibles par jour (part du volume), null = liquidité inconnue (non vendu). */
  perDayCap: number | null
  soldBySimEnd: number
  revenue: number
}

export interface ResaleInfo {
  byDay: number[]
  total: number
  /** Valeur nette si tout était vendu. */
  potential: number
  lines: ResaleLine[]
}

export interface LevelingSummary {
  from: number
  to: number
  cost: number
  complete: boolean
  missing: number[]
  crafts: number
  craftsPerDay: number
  /** Jours de craft (à partir du jour 0). */
  craftDays: number
  segments: PlanSegment[]
  /** Valeur HDV connue des objets fabriqués. */
  productValue: number
  resale: ResaleInfo | null
}

export interface ProjectionPoint {
  day: number
  cumulative: number
  cumulativeLow: number
  roi: number | null
}

export interface InvestmentEvaluation {
  allocation: InvestmentAllocation
  simDays: number
  horizonDays: number
  /** Dépenses du jour 0 (ingrédients, G1, socle des enclos ouverts). */
  day0: number
  /** Toutes les dépenses d'investissement sont chiffrées (sinon `day0`, `socleTotal` : bornes basses « ≥ »). */
  day0Complete: boolean
  /** Trésorerie maximale engagée (10e centile) : jour 0 + fonds de roulement. */
  peakOutlay: number
  /** Fonds de roulement = trésorerie engagée au-delà du jour 0. */
  workingCapital: number
  feasible: boolean
  profitAtHorizon: number
  profitAtHorizonLow: number
  projections: ProjectionPoint[]
  breakEvenDay: number | null
  /** Point mort extrapolé au-delà de la durée simulée (régime permanent). */
  breakEvenEstimated: boolean
  steadyNetPerDay: number
  steadyNetP10: number
  steadyNetP90: number
  roi: number | null
  leveling: LevelingSummary | null
  levelDays: LevelDay[]
  initialPaddocks: number
  schedule: PaddockStep[]
  g1StockLines: { speciesId: number; name: string; count: number; unitPrice: number | null }[]
  g1StockCost: number
  /** Socle des jauges payé à l'ouverture de chaque enclos (jour, montant). */
  socle: { day: number; amount: number }[]
  socleTotal: number
  cashflow: CashFlowPoint[]
  summary: ProductionSummary
  complete: boolean
  missing: number[]
  /**
   * Nature des montants : `exact` ; `borne-haute` (un coût manque : bénéfice ≤) ; `borne-basse` (un
   * revenu manque : bénéfice ≥) ; `inconnu` (les deux). Jamais un prix inconnu compté 0.
   */
  profitStatus: ProfitBound
}

export type ProfitBound = 'exact' | 'borne-haute' | 'borne-basse' | 'inconnu'

export interface AlternativeRow {
  id: string
  label: string
  description: string
  chosen: boolean
  allocation: InvestmentAllocation
  day0: number
  peakOutlay: number
  feasible: boolean
  profitAtHorizon: number
  profitStatus: ProfitBound
  breakEvenDay: number | null
  breakEvenEstimated: boolean
  steadyNetPerDay: number
  roi: number | null
}

export interface SensitivityRow {
  id: string
  label: string
  profitAtHorizon: number
  delta: number
  breakEvenDay: number | null
  breakEvenEstimated: boolean
  steadyNetPerDay: number
  peakOutlay: number
  feasible: boolean
}

export type InvestmentActionKind = 'achat' | 'craft' | 'enclos' | 'production' | 'vente' | 'jalon' | 'reserve'

export interface InvestmentAction {
  day: number
  toDay?: number
  kind: InvestmentActionKind
  title: string
  details: string[]
  /** Montant (négatif = dépense), null si sans objet. */
  kamas: number | null
}

export type RoadmapKind = 'depart' | 'metier' | 'enclos' | 'premiere-cible' | 'premiere-vente' | 'regime' | 'point-mort' | 'horizon'

export interface RoadmapMilestone {
  day: number
  kind: RoadmapKind
  label: string
  detail?: string
  estimated?: boolean
}

export interface InvestmentRisk {
  code: string
  tone: 'danger' | 'warn' | 'info'
  text: string
}

export interface InvestmentResult {
  budget: number
  reserve: number
  /** Budget engageable = budget − réserve. */
  available: number
  horizonDays: number
  simDays: number
  modeId: ProfitModeId
  levers: InvestmentLevers
  /** Un plan tient dans le budget. */
  feasible: boolean
  /** Plan retenu (si `feasible` faux : le plan rentable le moins gourmand, hors budget). */
  plan: InvestmentEvaluation | null
  alternatives: AlternativeRow[]
  sensitivity: SensitivityRow[]
  shopping: ShoppingItem[]
  actions: InvestmentAction[]
  roadmap: RoadmapMilestone[]
  risks: InvestmentRisk[]
  assumptions: string[]
  /** Budget minimum utile (plan rentable sur l'horizon le moins gourmand + réserve), arrondi à 100 000. */
  minimumBudget: number | null
  /** Budget engageable non utilisé par le plan. */
  unusedBudget: number
  notes: string[]
  /** Simulations lancées. */
  evaluated: number
  marketDate: string | null
  marketServer: string | null
  craftsPerDay: number
}

// ---------- Utilitaires ----------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const numOr = (v: number | undefined | null, d: number) => (v !== undefined && v !== null && Number.isFinite(v) ? v : d)
const fmtK = (v: number) => formatKamas(v, true)
const fmtN = (v: number, digits = 0) => formatNumber(v, digits)
const roundUp = (v: number, step: number) => Math.ceil(v / step) * step

/** Modes simulés pour un mode de rentabilité (« auto » : tous les modes comparés). */
export function investmentModeFamilies(modeId: ProfitModeId, opts: { family?: FamilyId | null; onlyFamily?: boolean } = {}): ModeFamily[] {
  const ids = modeId === 'auto' ? COMPARED_MODES : [modeId]
  const out: ModeFamily[] = []
  for (const id of ids) {
    const def = profitMode(id)
    if (!def || !def.mode) continue
    for (const f of def.families) {
      if (modeId === 'auto' && opts.onlyFamily && opts.family && f !== opts.family) continue
      out.push({ modeId: id, family: f, mode: def.mode, label: def.families.length > 1 ? `${def.short} (${FAMILIES[f].plural})` : def.short })
    }
  }
  return out
}

interface Norm {
  budget: number
  reserve: number
  available: number
  horizon: number
  simDays: number
  modeId: ProfitModeId
  cur: number
  startXp: number
  hoursPerDay: number
  characters: number
  rules: Ruleset
  family: FamilyId | null
  onlyFamily: boolean
  sessionsPerDay?: number
  captureHoursPerDay?: number
  fightsPerHour?: number
  levers: InvestmentLevers
  prices: ProductionPrices
  ctx: PriceContext
  saleTax: number
  share: number
  today: string | null
  craftsPerHour: number
  craftHoursPerDay: number
  craftsPerDay: number
  quick: boolean
  runs: number
  seed: number
  targets: number[]
  sensitivity: boolean
}

function normalize(input: InvestmentInput): Norm {
  const p = input.profile
  const budget = Math.max(0, numOr(input.budget, 0))
  const reserve = clamp(numOr(input.safetyReserve, 0), 0, budget)
  const horizon = clamp(Math.round(numOr(input.horizonDays, 60)), MIN_HORIZON_DAYS, MAX_HORIZON_DAYS)
  const cur = clamp(Math.floor(numOr(p.jobLevel, 1)), 1, 200)
  const hoursPerDay = clamp(numOr(p.hoursPerDay, 3), 0.25, 24)
  const o = input.options ?? {}
  const craftsPerHour = clamp(numOr(o.craftsPerHour, DEFAULT_CRAFTS_PER_HOUR), 1, 100_000)
  const craftHoursPerDay = clamp(numOr(o.craftHoursPerDay, hoursPerDay * DEFAULT_CRAFT_TIME_SHARE), 0.1, 24)
  const levers: InvestmentLevers = { ...DEFAULT_INVESTMENT_LEVERS, ...input.levers }
  const targets = [...new Set((o.jobTargets ?? INVESTMENT_JOB_TARGETS).map((t) => clamp(Math.floor(t), 1, 200)))].filter((t) => t > cur).sort((a, b) => a - b)
  return {
    budget,
    reserve,
    available: Math.max(0, budget - reserve),
    horizon,
    simDays: Math.max(horizon, MIN_SIMULATION_DAYS),
    modeId: input.mode,
    cur,
    startXp: Math.max(0, numOr(p.jobXp, 0)),
    hoursPerDay,
    characters: clamp(Math.floor(numOr(p.characters, 1)), 1, 8),
    rules: p.rules,
    family: p.family ?? null,
    onlyFamily: !!p.onlyFamily,
    sessionsPerDay: p.sessionsPerDay,
    captureHoursPerDay: p.captureHoursPerDay,
    fightsPerHour: p.fightsPerHour,
    levers,
    prices: input.prices,
    ctx: input.prices.ctx,
    saleTax: clamp(numOr(input.prices.saleTax, 0.02), 0, 1),
    share: clamp(numOr(input.prices.maxMarketShare, 0.15), 0, 1),
    today: input.today ?? null,
    craftsPerHour,
    craftHoursPerDay,
    craftsPerDay: Math.max(1, Math.floor(craftsPerHour * craftHoursPerDay)),
    quick: !!o.quick,
    runs: clamp(Math.floor(numOr(o.runs, DEFAULT_INVESTMENT_RUNS)), 1, 20),
    seed: Math.floor(numOr(o.seed, 1)),
    targets: levers.levelJob ? targets : [],
    sensitivity: o.sensitivity ?? true,
  }
}

// ---------- Prix selon les leviers ----------

/**
 * Contexte de prix au niveau visé : `jobLevel` = niveau visé ; si l'achat des carburants (ou des
 * filets/makinas) est interdit, chaque recette à portée est chiffrée au coût de ses ingrédients et les
 * autres deviennent indisponibles (prix sentinelle, jamais retenus).
 */
export function investmentPriceContext(base: PriceContext, target: number, levers: Pick<InvestmentLevers, 'buyFuels' | 'buyGear'>, rules: Ruleset): PriceContext {
  if (levers.buyFuels && levers.buyGear) return { ...base, jobLevel: target }
  const overrides = { ...base.overrides }
  const craftOnly = (recipes: JobRecipe[]) => {
    for (const r of recipes) {
      if (r.level > target) {
        overrides[String(r.id)] = UNAVAILABLE_PRICE
        continue
      }
      const c = recipeCraftCost(r, base, rules)
      if (c.complete && c.cost !== null) overrides[String(r.id)] = c.cost
    }
  }
  if (!levers.buyFuels) craftOnly(FUELS)
  if (!levers.buyGear) {
    craftOnly(NETS)
    craftOnly(MAKINAS.filter((m) => m.kind === 'optimakina'))
  }
  return { ...base, jobLevel: target, overrides }
}

/** Paliers de jauge utilisables : tous si l'achat est permis, sinon ceux dont un carburant est fabricable. */
export function allowedTiers(target: number, buyFuels: boolean): FuelTier[] {
  if (buyFuels) return [1, 2, 3, 4]
  const out = ([1, 2, 3, 4] as FuelTier[]).filter((t) => FUELS.some((f) => f.tier === t && f.level <= target))
  return out
}

// ---------- Montée du métier ----------

interface LevelingInfo {
  plan: LevelingPlan
  cost: number
  complete: boolean
  missing: number[]
  crafts: number
  /** (crafts cumulés, XP cumulée) à chaque niveau atteint. */
  curve: [number, number][]
}

function levelingInfo(n: Norm, target: number): LevelingInfo | null {
  if (target <= n.cur) return null
  const plan = levelingPlan(n.cur, target, n.ctx, { rules: n.rules, metric: 'kamas', startXp: n.startXp })
  if (plan.blockedAt !== null) return null
  const curve: [number, number][] = [[0, 0], ...plan.progress.map((p) => [p.crafts, p.xp] as [number, number])]
  return {
    plan,
    cost: plan.totals.cost,
    complete: plan.totals.costComplete,
    missing: plan.toPrice.length ? plan.toPrice : plan.shopping.filter((l) => l.missing).map((l) => l.id),
    crafts: plan.totals.crafts,
    curve,
  }
}

function xpAtCrafts(curve: [number, number][], c: number): number {
  if (c <= 0) return 0
  for (let i = 1; i < curve.length; i++) {
    const [c1, x1] = curve[i]
    if (c <= c1) {
      const [c0, x0] = curve[i - 1]
      return c1 > c0 ? x0 + ((x1 - x0) * (c - c0)) / (c1 - c0) : x1
    }
  }
  return curve[curve.length - 1][1]
}

/** Jours de craft (à partir du jour 0). */
export function craftDaysFor(crafts: number, craftsPerDay: number): number {
  return crafts > 0 ? Math.ceil(crafts / Math.max(1, craftsPerDay)) : 0
}

/** Crafts de chaque segment répartis par jour de craft. */
export function craftsByDay(segments: PlanSegment[], craftsPerDay: number): { day: number; segment: PlanSegment; crafts: number }[] {
  const out: { day: number; segment: PlanSegment; crafts: number }[] = []
  const cpd = Math.max(1, craftsPerDay)
  let c = 0
  for (const seg of segments) {
    const start = c
    const end = c + seg.crafts
    for (let d = Math.floor(start / cpd); d * cpd < end; d++) {
      const q = Math.min(end, (d + 1) * cpd) - Math.max(start, d * cpd)
      if (q > 0) out.push({ day: d, segment: seg, crafts: q })
    }
    c = end
  }
  return out
}

/** Revente des objets fabriqués : vendus à partir du lendemain, au plus `share` × ventes moyennes par jour. */
export function resaleSchedule(
  segments: PlanSegment[],
  craftsPerDay: number,
  days: number,
  opts: { ctx: PriceContext; saleTax: number; share: number; revenueFactor?: number },
): ResaleInfo {
  const byDay = Array.from({ length: days + 1 }, () => 0)
  const produced = new Map<number, number[]>()
  for (const { day, segment, crafts } of craftsByDay(segments, craftsPerDay)) {
    if (segment.kind === 'capture') continue
    let arr = produced.get(segment.recipeId)
    if (!arr) {
      arr = Array.from({ length: days + 1 }, () => 0)
      produced.set(segment.recipeId, arr)
    }
    arr[Math.min(days, day)] += crafts
  }
  const rf = Math.max(0, numOr(opts.revenueFactor, 1))
  const lines: ResaleLine[] = []
  let total = 0
  let potential = 0
  for (const [id, arr] of produced) {
    const qty = arr.reduce((s, x) => s + x, 0)
    const mp = marketPrice(id, opts.ctx)
    const priced = mp.price !== null && mp.price > 0 && (mp.origin === 'marche' || mp.origin === 'joueur')
    const unitNet = priced ? (mp.price as number) * (1 - opts.saleTax) * rf : 0
    const depth = marketDepth(opts.ctx.market, id)
    const cap = depth && depth.perDayAvg > 0 ? depth.perDayAvg * opts.share : null
    potential += qty * unitNet
    let sold = 0
    let revenue = 0
    if (priced && cap !== null) {
      let stock = 0
      let carry = 0
      for (let d = 0; d <= days; d++) {
        // Ventes du jour (stock des jours précédents), puis production du jour.
        const allowance = carry + cap
        const s = Math.min(stock, Math.floor(allowance + 1e-9))
        carry = Math.min(1, allowance - s)
        stock -= s
        sold += s
        byDay[d] += s * unitNet
        revenue += s * unitNet
        stock += arr[d]
      }
    }
    total += revenue
    lines.push({ id, name: itemName(id), qty, unitNet, perDayCap: priced ? cap : null, soldBySimEnd: sold, revenue })
  }
  lines.sort((a, b) => b.qty * b.unitNet - a.qty * a.unitNet)
  return { byDay, total, potential, lines }
}

// ---------- Calendrier du métier et des enclos ----------

interface Timeline {
  initialPaddocks: number
  schedule: PaddockStep[]
  levelDays: LevelDay[]
  /** Niveau en fin de journée (index 0 … days). */
  levels: number[]
}

/**
 * Niveau atteint chaque jour (crafts à partir du jour 0 + XP d'élevage du tirage de production) et
 * calendrier des enclos : un niveau atteint en fin de journée débloque son enclos le lendemain.
 */
export function jobTimeline(opts: {
  from: number
  startXp?: number
  target: number
  curve: [number, number][] | null
  crafts: number
  craftsPerDay: number
  /** XP d'élevage gagnée chaque jour de production (index 1 … days ; index 0 ignoré). */
  naturalXp: number[]
  days: number
}): Timeline {
  const startAbs = jobXpForLevel(opts.from) + Math.max(0, opts.startXp ?? 0)
  const craftXp = (d: number) => (opts.curve ? xpAtCrafts(opts.curve, Math.min(opts.crafts, (d + 1) * Math.max(1, opts.craftsPerDay))) : 0)
  const levels: number[] = []
  let nat = 0
  for (let d = 0; d <= opts.days; d++) {
    if (d >= 1) nat += Math.max(0, opts.naturalXp[d] ?? 0)
    levels.push(Math.min(200, Math.max(opts.from, jobLevelFromXp(startAbs + craftXp(d) + nat))))
  }
  const initialPaddocks = Math.max(1, paddocksAt(levels[0]))
  const schedule: PaddockStep[] = []
  for (let k = 2; k <= opts.days; k++) {
    const now = paddocksAt(levels[k - 1])
    const before = paddocksAt(levels[k - 2])
    if (now > before) schedule.push({ day: k, paddocks: now })
  }
  const defs = jobMilestones().filter((m) => m.kind !== 'makina' && m.level > opts.from)
  const levelDays: LevelDay[] = []
  const seen = new Set<number>()
  const sourceOf = (level: number, d: number): LevelDay['source'] => (startAbs + craftXp(d) >= jobXpForLevel(level) ? 'craft' : 'elevage')
  for (let d = 0; d <= opts.days; d++) {
    const prev = d === 0 ? opts.from : levels[d - 1]
    if (levels[d] <= prev) continue
    for (const m of defs) {
      if (m.level > prev && m.level <= levels[d] && !seen.has(m.level * 10 + kindRank(m.kind))) {
        seen.add(m.level * 10 + kindRank(m.kind))
        levelDays.push({ level: m.level, day: d, source: sourceOf(m.level, d), kind: m.kind as LevelDay['kind'], label: m.label, paddocks: paddocksAt(m.level) })
      }
    }
    if (opts.target > opts.from && opts.target > prev && opts.target <= levels[d] && !defs.some((m) => m.level === opts.target))
      levelDays.push({ level: opts.target, day: d, source: sourceOf(opts.target, d), kind: 'objectif', label: `Niveau ${opts.target} (objectif)`, paddocks: paddocksAt(opts.target) })
  }
  levelDays.sort((a, b) => a.day - b.day || a.level - b.level)
  return { initialPaddocks, schedule, levelDays, levels }
}

function kindRank(k: string): number {
  return k === 'enclos' ? 0 : k === 'filet' ? 1 : k === 'carburant' ? 2 : 3
}

// ---------- Trésorerie ----------

interface CashExtras {
  /** Dépenses fixes du jour 0 (ingrédients du métier, G1). */
  day0Fixed: number
  /** Socle des jauges : (jour, montant). */
  socle: { day: number; amount: number }[]
  resale: number[] | null
}

interface CashResult {
  points: CashFlowPoint[]
  day0: number
  peakOutlay: number
  breakEvenDay: number | null
  breakEvenEstimated: boolean
}

/** Courbe de trésorerie (jour 0 … durée simulée) d'un résumé de production et des achats d'investissement. */
export function cashFlowOf(summary: ProductionSummary, extras: CashExtras): CashResult {
  const S = summary.daily.length
  const inv = Array.from({ length: S + 1 }, () => 0)
  inv[0] += extras.day0Fixed
  for (const s of extras.socle) inv[clamp(Math.round(s.day), 0, S)] += s.amount
  const points: CashFlowPoint[] = []
  let invCum = 0
  let resaleCum = 0
  let cum = 0
  // Dans une journée, les dépenses (achats, filets, carburant) précèdent les ventes du soir : la
  // trésorerie engagée compte le creux avant les ventes du jour (10e centile).
  let preSalesMin = 0
  for (let d = 0; d <= S; d++) {
    const ds = d >= 1 ? summary.daily[d - 1] : null
    const resale = extras.resale?.[d] ?? 0
    invCum += inv[d]
    resaleCum += resale
    const costs = ds?.costKnown ?? 0
    const revenue = (ds?.revenueKnown ?? 0) + resale
    const net = revenue - costs - inv[d]
    cum += net
    const base = resaleCum - invCum
    const prevLow = d > 0 ? points[d - 1].cumulativeLow : 0
    preSalesMin = Math.min(preSalesMin, prevLow - inv[d] - costs)
    points.push({
      day: d,
      paddocks: ds?.paddocks ?? summary.config.paddocks,
      investment: inv[d],
      costs,
      revenue,
      resale,
      net,
      cumulative: cum,
      cumulativeLow: base + (ds?.cumulative.p10 ?? 0),
      cumulativeHigh: base + (ds?.cumulative.p90 ?? 0),
    })
  }
  const peakOutlay = Math.max(0, -preSalesMin, ...points.map((p) => -Math.min(p.cumulative, p.cumulativeLow)))
  let breakEvenDay: number | null = null
  for (let d = 1; d <= S; d++) {
    if (points[d].cumulative >= 0 && points.slice(d).every((p) => p.cumulative >= 0)) {
      breakEvenDay = d
      break
    }
  }
  let breakEvenEstimated = false
  if (breakEvenDay === null) {
    const last = points[S].cumulative
    const steady = summary.steady.netPerDay.mean
    if (last < 0 && steady > 0) {
      const extra = Math.ceil(-last / steady)
      if (S + extra <= 3 * MAX_HORIZON_DAYS) {
        breakEvenDay = S + extra
        breakEvenEstimated = true
      }
    }
  }
  return { points, day0: inv[0], peakOutlay, breakEvenDay, breakEvenEstimated }
}

// ---------- Recherche ----------

interface Setting {
  key: string
  mf: ModeFamily
  target: number
  ctx: PriceContext
  leveling: LevelingInfo | null
  tiers: FuelTier[]
  naturalXp: number[]
  timeline: Timeline
}

interface G1Plan {
  stock: InitialStockLine[]
  perDay: number
}

const NO_G1: G1Plan = { stock: [], perDay: 0 }

interface Variation {
  id: string
  label: string
  revenueFactor?: number
  costFactor?: number
  durationFactor?: number
  shareFactor?: number
  resale?: boolean
}

const BASE_VARIATION: Variation = { id: 'base', label: 'Plan retenu' }

interface Candidate {
  key: string
  setting: Setting
  params: StrategyParams
  g1: G1Plan
}

interface Scored {
  cand: Candidate
  eval: InvestmentEvaluation
}

function defaultParams(mode: ProductionMode, tiers: FuelTier[]): StrategyParams {
  const tier = pickTier(tiers, mode === 'brisage' ? 1 : 2)
  if (mode === 'brisage') return { brisageLevel: 53, parentLevel: 53, tier, mateBeforeExtract: false }
  return { targetGeneration: 4, parentLevel: 40, optimakina: 'auto', tier, mateBeforeExtract: true, cloning: true }
}

function pickTier(tiers: FuelTier[], wanted: FuelTier): FuelTier {
  if (!tiers.length) return 1
  if (tiers.includes(wanted)) return wanted
  return tiers.reduce((best, t) => (Math.abs(t - wanted) < Math.abs(best - wanted) ? t : best), tiers[0])
}

function mainGrid(mode: ProductionMode, tiers: FuelTier[], quick: boolean): StrategyParams[] {
  if (mode === 'brisage') {
    const levels = quick ? [53] : [45, 53, 60, 80]
    const ts = tiers.filter((t) => t <= 2)
    const useTiers = ts.length ? ts : [pickTier(tiers, 1)]
    return levels.flatMap((brisageLevel) => useTiers.map((tier) => ({ brisageLevel, parentLevel: brisageLevel, tier, mateBeforeExtract: false })))
  }
  const gens = quick ? [2, 4, 6] : [2, 3, 4, 5, 6, 8, 10]
  const tier = pickTier(tiers, 2)
  return gens.map((targetGeneration) => ({ targetGeneration, parentLevel: 40, optimakina: 'auto' as const, tier, mateBeforeExtract: true, cloning: true }))
}

function tierVariants(params: StrategyParams, tiers: FuelTier[], mode: ProductionMode): StrategyParams[] {
  if (mode === 'brisage') return []
  return ([1, 3] as FuelTier[]).filter((t) => tiers.includes(t) && t !== params.tier).map((tier) => ({ ...params, tier }))
}

function paramsKey(p: StrategyParams): string {
  return JSON.stringify([p.targetGeneration ?? null, p.brisageLevel ?? null, p.tier ?? null, p.optimakina ?? null, p.parentLevel ?? null, p.mateBeforeExtract ?? null])
}

function modeLabel(mf: ModeFamily): string {
  return mf.label
}

function allocationOf(c: Candidate, n: Norm): InvestmentAllocation {
  const s = c.setting
  const stratLabel = strategyLabel(s.mf.mode, c.params)
  const g1Stock = c.g1.stock.reduce((t, l) => t + l.count, 0)
  const parts = [s.target > n.cur ? `Métier ${n.cur} → ${s.target}` : `Métier niv. ${n.cur} (sans montée)`, modeLabel(s.mf), stratLabel]
  if (g1Stock || c.g1.perDay) parts.push(`G1 achetées (${g1Stock} au départ${c.g1.perDay ? `, ≤ ${c.g1.perDay}/jour` : ''})`)
  return {
    id: c.key,
    modeId: s.mf.modeId,
    modeLabel: modeLabel(s.mf),
    family: s.mf.family,
    mode: s.mf.mode,
    jobFrom: n.cur,
    jobTo: Math.max(n.cur, s.target),
    strategy: c.params,
    strategyLabel: stratLabel,
    tier: (c.params.tier ?? 2) as FuelTier,
    g1Stock,
    g1PerDay: c.g1.perDay,
    summary: parts.join(' · '),
  }
}

function configFor(n: Norm, s: Setting, timeline: Timeline, params: StrategyParams, g1: G1Plan, days: number, v: Variation = BASE_VARIATION): ProductionConfig {
  return {
    family: s.mf.family,
    mode: s.mf.mode,
    ...params,
    paddocks: timeline.initialPaddocks,
    paddockSchedule: timeline.schedule,
    hoursPerDay: n.hoursPerDay,
    sessionsPerDay: n.sessionsPerDay,
    captureHoursPerDay: n.captureHoursPerDay,
    fightsPerHour: n.fightsPerHour,
    characters: n.characters,
    jobLevel: Math.max(n.cur, s.target),
    rules: n.rules,
    prices: {
      ...n.prices,
      ctx: s.ctx,
      revenueFactor: (n.prices.revenueFactor ?? 1) * (v.revenueFactor ?? 1),
      costFactor: (n.prices.costFactor ?? 1) * (v.costFactor ?? 1),
      maxMarketShare: n.share * (v.shareFactor ?? 1),
    },
    horizonDays: days,
    buyG1PerDay: g1.perDay,
    initialStock: g1.stock,
    durationFactor: v.durationFactor ?? 1,
  }
}

/** G1 achetées : stock de départ pour remplir les enclos ouverts au jour 1 + achats quotidiens. */
function g1PlanFor(n: Norm, s: Setting, params: StrategyParams): G1Plan {
  const cfg = configFor(n, s, s.timeline, params, NO_G1, n.horizon)
  const info = productionPlan(cfg)
  const norm = normalizeProductionConfig(cfg)
  const slots = s.timeline.initialPaddocks * norm.slotsPerPaddock
  const shares = info.captureShares.filter((x) => x.share > 0)
  const total = shares.reduce((t, x) => t + x.share, 0) || 1
  const stock: InitialStockLine[] = []
  for (const sh of shares) {
    const sp = getSpecies(sh.speciesId)
    const depth = sp?.itemId ? marketDepth(s.ctx.market, sp.itemId) : null
    // Au plus une journée de ventes du serveur par couleur (sinon le prix monte).
    const cap = depth ? Math.max(0, Math.floor(depth.perDayAvg)) : 0
    const count = Math.min(cap, Math.round((slots * sh.share) / total))
    if (count > 0) stock.push({ speciesId: sh.speciesId, count })
  }
  const capacity = norm.captureRate * norm.captureHoursPerDay
  return { stock, perDay: Math.max(1, Math.ceil(capacity)) }
}

function evaluate(n: Norm, s: Setting, params: StrategyParams, g1: G1Plan, days: number, runs: number, v: Variation = BASE_VARIATION): InvestmentEvaluation {
  const craftsPerDay = Math.max(1, Math.floor(n.craftsPerDay / (v.durationFactor ?? 1)))
  const timeline =
    v.durationFactor && v.durationFactor !== 1
      ? jobTimeline({
          from: n.cur,
          startXp: n.startXp,
          target: s.target,
          curve: s.leveling?.curve ?? null,
          crafts: s.leveling?.crafts ?? 0,
          craftsPerDay,
          naturalXp: s.naturalXp.map((x) => x / (v.durationFactor ?? 1)),
          days: Math.max(days, s.naturalXp.length - 1),
        })
      : s.timeline
  const cfg = configFor(n, s, timeline, params, g1, days, v)
  const summary = runProduction(cfg, { runs, seed: n.seed })
  const costFactor = (n.prices.costFactor ?? 1) * (v.costFactor ?? 1)
  // G1 du stock de départ (prix d'achat prudent du livre de prix).
  const book = productionPriceBook(normalizeProductionConfig(cfg))
  let g1StockCost = 0
  let g1Complete = true
  const g1StockLines = g1.stock.map((l) => {
    const u = book.g1Buy(l.speciesId)
    if (u.value === null || !u.complete) g1Complete = false
    g1StockCost += (u.value ?? 0) * l.count * costFactor
    return { speciesId: l.speciesId, name: getSpecies(l.speciesId)?.name ?? `#${l.speciesId}`, count: l.count, unitPrice: u.value === null ? null : u.value * costFactor }
  })
  const levelingCost = (s.leveling?.cost ?? 0) * costFactor
  // Socle : réparti par enclos, payé à l'ouverture de chaque enclos.
  const maxPad = Math.max(timeline.initialPaddocks, ...timeline.schedule.filter((x) => x.day <= days).map((x) => x.paddocks))
  const soclePer = maxPad > 0 ? summary.capital.socleLow / Math.max(maxPad, summary.capital.socle?.paddocks ?? maxPad) : 0
  const socle: { day: number; amount: number }[] = []
  if (soclePer > 0) {
    socle.push({ day: 0, amount: soclePer * timeline.initialPaddocks })
    let prev = timeline.initialPaddocks
    for (const st of timeline.schedule) {
      if (st.day > days || st.paddocks <= prev) continue
      socle.push({ day: st.day, amount: soclePer * (st.paddocks - prev) })
      prev = st.paddocks
    }
  }
  const socleTotal = socle.reduce((t, x) => t + x.amount, 0)
  const resale =
    s.leveling && n.levers.resellCrafts && v.resale !== false
      ? resaleSchedule(s.leveling.plan.segments, craftsPerDay, days, { ctx: n.ctx, saleTax: n.saleTax, share: n.share * (v.shareFactor ?? 1), revenueFactor: (n.prices.revenueFactor ?? 1) * (v.revenueFactor ?? 1) })
      : null
  const cash = cashFlowOf(summary, { day0Fixed: levelingCost + g1StockCost, socle, resale: resale?.byDay ?? null })
  const H = Math.min(n.horizon, days)
  const at = (d: number) => cash.points[Math.min(d, cash.points.length - 1)]
  const roiOf = (v2: number) => (cash.peakOutlay > 0 ? v2 / cash.peakOutlay : null)
  const projections: ProjectionPoint[] = [...new Set([...PROJECTION_DAYS, n.horizon])]
    .filter((d) => d <= days)
    .sort((a, b) => a - b)
    .map((d) => ({ day: d, cumulative: at(d).cumulative, cumulativeLow: at(d).cumulativeLow, roi: roiOf(at(d).cumulative) }))
  const socleComplete = summary.capital.socle ? summary.capital.socle.complete : true
  const levelingComplete = s.leveling ? s.leveling.complete : true
  const missing = [...new Set([...summary.missing, ...(s.leveling && !s.leveling.complete ? s.leveling.missing : []), ...(summary.capital.socle && !summary.capital.socle.complete ? summary.capital.socle.missing : [])])]
  const costsMissing = !levelingComplete || !socleComplete || !g1Complete || summary.prices.some((l) => l.kind === 'cout' && !l.complete)
  const revenueMissing = summary.prices.some((l) => l.kind === 'revenu' && !l.complete && (l.key !== 'geneton' || summary.totals.genetons > 0))
  const profitStatus: ProfitBound = costsMissing && revenueMissing ? 'inconnu' : costsMissing ? 'borne-haute' : revenueMissing ? 'borne-basse' : 'exact'
  const allocation = allocationOf({ key: '', setting: s, params, g1 }, n)
  allocation.id = `${s.key}|${paramsKey(params)}|${g1.stock.length ? 'g1' : '-'}`
  return {
    allocation,
    simDays: days,
    horizonDays: n.horizon,
    day0: cash.day0,
    day0Complete: levelingComplete && socleComplete && g1Complete,
    peakOutlay: cash.peakOutlay,
    workingCapital: Math.max(0, cash.peakOutlay - cash.day0),
    feasible: cash.peakOutlay <= n.available + 0.5,
    profitAtHorizon: at(H).cumulative,
    profitAtHorizonLow: at(H).cumulativeLow,
    projections,
    breakEvenDay: cash.breakEvenDay,
    breakEvenEstimated: cash.breakEvenEstimated,
    steadyNetPerDay: summary.steady.netPerDay.mean,
    steadyNetP10: summary.steady.netPerDay.p10,
    steadyNetP90: summary.steady.netPerDay.p90,
    roi: roiOf(at(H).cumulative),
    leveling: s.leveling
      ? {
          from: n.cur,
          to: s.target,
          cost: levelingCost,
          complete: s.leveling.complete,
          missing: s.leveling.missing,
          crafts: s.leveling.crafts,
          craftsPerDay,
          craftDays: craftDaysFor(s.leveling.crafts, craftsPerDay),
          segments: s.leveling.plan.segments,
          productValue: s.leveling.plan.totals.productValue,
          resale,
        }
      : null,
    levelDays: timeline.levelDays.filter((l) => l.day <= days),
    initialPaddocks: timeline.initialPaddocks,
    schedule: timeline.schedule.filter((x) => x.day <= days),
    g1StockLines,
    g1StockCost,
    socle,
    socleTotal,
    cashflow: cash.points,
    summary,
    complete: summary.complete && levelingComplete && socleComplete && g1Complete,
    missing,
    profitStatus,
  }
}

/** Classement : dans le budget d'abord, puis bénéfice à l'horizon, puis point mort le plus tôt. */
function better(a: InvestmentEvaluation, b: InvestmentEvaluation): number {
  if (a.feasible !== b.feasible) return a.feasible ? -1 : 1
  // Un coût non chiffré rend le bénéfice incertain (borne haute) : ces plans passent après les autres.
  const ca = a.profitStatus === 'exact' || a.profitStatus === 'borne-basse'
  const cb = b.profitStatus === 'exact' || b.profitStatus === 'borne-basse'
  if (ca !== cb) return ca ? -1 : 1
  if (Math.abs(b.profitAtHorizon - a.profitAtHorizon) > 1) return b.profitAtHorizon - a.profitAtHorizon
  return (a.breakEvenDay ?? Infinity) - (b.breakEvenDay ?? Infinity)
}

/** Utilise un objet indisponible (prix sentinelle) : stratégie impossible avec ces leviers. */
function usesUnavailable(e: InvestmentEvaluation): boolean {
  const limit = UNAVAILABLE_PRICE / 1e5
  return e.summary.prices.some((l) => l.value !== null && l.value >= limit) || e.summary.totals.costKnown >= limit
}

// ---------- Plan ----------

function* investmentGen(input: InvestmentInput): Generator<ProgressInfo, InvestmentResult, void> {
  const n = normalize(input)
  const notes: string[] = []
  let evaluated = 0
  let done = 0
  let total = 1
  const label = { value: 'Préparation' }
  const tick = (k = 1): ProgressInfo => {
    done += k
    if (done >= total) total = done + 1
    return { done, total, label: label.value }
  }

  const mfs = investmentModeFamilies(n.modeId, { family: n.family, onlyFamily: n.onlyFamily })
  if (!mfs.length) throw new Error('Mode de rentabilité inconnu ou sans famille.')

  // Montée du métier : coût de chaque niveau visé.
  label.value = 'Montée du métier'
  const levelings = new Map<number, LevelingInfo | null>()
  const affordable: number[] = [n.cur]
  for (const t of n.targets) {
    const lv = levelingInfo(n, t)
    levelings.set(t, lv)
    if (!lv) {
      notes.push(`Niveau ${t} : aucun craft possible pour l’atteindre avec ces prix (plan interrompu).`)
      continue
    }
    const days = craftDaysFor(lv.crafts, n.craftsPerDay)
    if (!lv.complete) {
      notes.push(`Niveau ${t} écarté : ${lv.missing.length} ingrédient(s) sans prix, coût de la montée inconnu (≥ ${fmtK(lv.cost)}) — renseignez-les (page Prix) ou importez l’export HDV.`)
      continue
    }
    if (lv.cost > n.available) continue
    if (days > n.horizon * MAX_LEVELING_SHARE) {
      notes.push(`Niveau ${t} écarté : ${fmtN(lv.crafts)} crafts ≈ ${days} jours de craft à ${fmtN(n.craftsPerDay)} crafts/jour, plus de la moitié de l’horizon.`)
      continue
    }
    affordable.push(t)
  }
  const maxAffordable = affordable[affordable.length - 1]
  const tooExpensive = n.targets.filter((t) => !affordable.includes(t) && levelings.get(t))
  if (tooExpensive.length && n.levers.levelJob) {
    const t = tooExpensive[0]
    const lv = levelings.get(t)
    if (lv && lv.cost > n.available) notes.push(`Métier : le niveau ${t} coûte ${fmtK(lv.cost)} d’ingrédients, au-delà du budget engageable (${fmtK(n.available)}).`)
  }
  // Estimation du nombre de simulations (barre de progression).
  {
    const screen = mfs.length > 2 ? mfs.length * new Set([n.cur, maxAffordable]).size * (1 + mainGrid(mfs[0].mode, [1, 2, 3, 4], true).length) : 0
    const kept0 = Math.min(2, mfs.length)
    const perSetting = 1 + mainGrid('extraction', [1, 2, 3, 4], n.quick).length + (n.quick ? 0 : 4) + (n.levers.buyG1 ? 1 : 0)
    const finals = 7 * n.runs
    const sens = n.sensitivity ? 7 * SENSITIVITY_RUNS : 0
    total = 2 + screen + kept0 * affordable.length * perSetting + finals + sens
  }
  yield tick()

  // Réglages (mode × niveau visé) : contexte de prix, calendrier, XP d'élevage d'un tirage témoin.
  const settings = new Map<string, Setting>()
  const settingFor = (mf: ModeFamily, target: number): Setting => {
    const key = `${mf.modeId}|${mf.family}|${target}`
    const hit = settings.get(key)
    if (hit) return hit
    const level = Math.max(n.cur, target)
    let tiers = allowedTiers(level, n.levers.buyFuels)
    let buyFuels = n.levers.buyFuels
    if (!tiers.length) {
      // Aucun carburant fabricable à ce niveau : achat à l'HDV malgré le levier (signalé).
      tiers = [1, 2, 3, 4]
      buyFuels = true
      if (!notes.some((x) => x.startsWith('Carburants')))
        notes.push(`Carburants : aucun n’est fabricable au niveau ${level} (niveau ${FUEL_TIER_UNLOCK_LEVEL[1]} requis) — achetés à l’HDV tant que le métier n’y est pas.`)
    }
    const ctx = investmentPriceContext(n.ctx, level, { buyFuels, buyGear: n.levers.buyGear }, n.rules)
    const leveling = target > n.cur ? (levelings.get(target) ?? null) : null
    const craftOnly = { from: n.cur, startXp: n.startXp, target, curve: leveling?.curve ?? null, crafts: leveling?.crafts ?? 0, craftsPerDay: n.craftsPerDay, days: n.simDays }
    const t0 = jobTimeline({ ...craftOnly, naturalXp: [] })
    const probeSetting: Setting = { key, mf, target, ctx, leveling, tiers, naturalXp: [], timeline: t0 }
    // Tirage témoin : XP d'Éleveur gagnée en élevant (captures, accouplements), sans les enclos qu'elle débloque (prudent).
    const probe = simulateProduction(configFor(n, probeSetting, t0, defaultParams(mf.mode, tiers), NO_G1, n.simDays), n.seed)
    evaluated += 1
    const naturalXp = [0, ...probe.days.map((d) => d.jobXp)]
    const setting: Setting = { ...probeSetting, naturalXp, timeline: jobTimeline({ ...craftOnly, naturalXp }) }
    settings.set(key, setting)
    return setting
  }

  const all: Scored[] = []
  const quickEval = (s: Setting, params: StrategyParams, g1: G1Plan): Scored | null => {
    const cand: Candidate = { key: `${s.key}|${paramsKey(params)}|${g1.stock.length ? 'g1' : '-'}`, setting: s, params, g1 }
    try {
      const ev = evaluate(n, s, params, g1, n.horizon, 1)
      evaluated += 1
      if (usesUnavailable(ev)) return null
      const sc = { cand, eval: ev }
      all.push(sc)
      return sc
    } catch (e) {
      notes.push(`${s.mf.label}, ${strategyLabel(s.mf.mode, params)} : ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  // Tri des modes (« auto ») : chaque mode au niveau actuel et au niveau le plus haut abordable.
  let kept = mfs
  if (mfs.length > 2) {
    label.value = 'Tri des modes'
    const screenTargets = [...new Set([n.cur, maxAffordable])]
    const best = new Map<string, number>()
    for (const mf of mfs) {
      for (const t of screenTargets) {
        const s = settingFor(mf, t)
        yield tick()
        for (const params of mainGrid(mf.mode, s.tiers, true)) {
          const sc = quickEval(s, params, NO_G1)
          yield tick()
          if (!sc) continue
          const k = `${mf.modeId}|${mf.family}`
          const v = sc.eval.feasible ? sc.eval.profitAtHorizon : sc.eval.profitAtHorizon - 1e15
          best.set(k, Math.max(best.get(k) ?? -Infinity, v))
        }
      }
    }
    kept = [...mfs].sort((a, b) => (best.get(`${b.modeId}|${b.family}`) ?? -Infinity) - (best.get(`${a.modeId}|${a.family}`) ?? -Infinity)).slice(0, 2)
  }

  // Recherche complète : modes retenus × niveaux visés abordables.
  const bestBySetting = new Map<string, Scored>()
  const g1BySetting = new Map<string, Scored>()
  for (const mf of kept) {
    for (const t of affordable) {
      const s = settingFor(mf, t)
      label.value = `${mf.label} · métier ${t > n.cur ? `${n.cur} → ${t}` : `niv. ${n.cur}`}`
      yield tick()
      const scored: Scored[] = []
      for (const params of mainGrid(mf.mode, s.tiers, n.quick)) {
        const sc = quickEval(s, params, NO_G1)
        yield tick()
        if (sc) scored.push(sc)
      }
      scored.sort((a, b) => better(a.eval, b.eval))
      if (!n.quick)
        for (const top of scored.slice(0, 2)) {
          for (const params of tierVariants(top.cand.params, s.tiers, mf.mode)) {
            const sc = quickEval(s, params, NO_G1)
            yield tick()
            if (sc) scored.push(sc)
          }
        }
      scored.sort((a, b) => better(a.eval, b.eval))
      const top = scored[0]
      if (!top) continue
      bestBySetting.set(s.key, top)
      if (n.levers.buyG1 && (t === n.cur || !n.quick)) {
        try {
          const g1 = g1PlanFor(n, s, top.cand.params)
          const sc = quickEval(s, top.cand.params, g1)
          yield tick()
          if (sc) g1BySetting.set(s.key, sc)
        } catch (e) {
          notes.push(`Achat de G1 : ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  }

  if (!all.length) throw new Error('Aucune stratégie simulable avec ces contraintes.')

  // Finalistes : meilleurs candidats + allocations nommées, réévalués (Monte-Carlo, durée complète).
  label.value = 'Évaluation finale'
  const pool = [...bestBySetting.values(), ...g1BySetting.values()].sort((a, b) => better(a.eval, b.eval))
  const finalsIn = new Map<string, Candidate>()
  for (const sc of pool.slice(0, 3)) finalsIn.set(sc.cand.key, sc.cand)
  const lead = pool[0]
  const leadMf = lead.cand.setting.mf
  const sameMf = (sc: Scored) => sc.cand.setting.mf.modeId === leadMf.modeId && sc.cand.setting.mf.family === leadMf.family
  const named: { id: string; cand: Candidate }[] = []
  const metier = [...bestBySetting.values()].filter(sameMf).sort((a, b) => b.cand.setting.target - a.cand.setting.target || better(a.eval, b.eval))
  const metierPick = metier.find((x) => x.eval.feasible) ?? metier[0]
  if (metierPick && metierPick.cand.setting.target > n.cur) named.push({ id: 'metier', cand: metierPick.cand })
  const stock = [...g1BySetting.values()].filter((x) => sameMf(x) && x.cand.setting.target === n.cur)[0]
  if (stock) named.push({ id: 'stock', cand: stock.cand })
  const minimal = [...bestBySetting.values()].filter((x) => sameMf(x) && x.cand.setting.target === n.cur)[0]
  if (minimal) named.push({ id: 'minimal', cand: minimal.cand })
  if (kept.length > 1) {
    const other = pool.find((x) => !sameMf(x))
    if (other) named.push({ id: 'autre-mode', cand: other.cand })
  }
  for (const nm of named) finalsIn.set(nm.cand.key, nm.cand)
  // Le plan rentable le moins gourmand : budget minimum utile (et plan proposé si rien ne tient dans le budget).
  const cheapest = all.filter((x) => x.eval.profitAtHorizon > 0).sort((a, b) => a.eval.peakOutlay - b.eval.peakOutlay)[0]
  if (cheapest) finalsIn.set(cheapest.cand.key, cheapest.cand)
  const finals = new Map<string, InvestmentEvaluation>()
  for (const cand of finalsIn.values()) {
    const ev = evaluate(n, cand.setting, cand.params, cand.g1, n.simDays, n.runs)
    evaluated += n.runs
    finals.set(cand.key, ev)
    yield tick(n.runs)
  }
  const ranked = [...finals.entries()].sort((a, b) => better(a[1], b[1]))
  const feasibleRanked = ranked.filter(([, e]) => e.feasible)
  // Budget minimum utile : plan rentable sur l'horizon le moins gourmand (évaluation finale).
  const profitable = [...finals.values()].filter((e) => e.profitAtHorizon > 0).map((e) => e.peakOutlay)
  const minOutlay = profitable.length ? Math.min(...profitable) : null
  const minimumBudget = minOutlay === null ? null : roundUp(minOutlay * 1.05 + n.reserve, 100_000)
  let chosenKey: string
  let feasible = true
  if (feasibleRanked.length) chosenKey = feasibleRanked[0][0]
  else {
    feasible = false
    // Hors budget : le plan rentable le moins gourmand (référence pour le budget minimum).
    const byOutlay = [...finals.entries()].filter(([, e]) => e.profitAtHorizon > 0).sort((a, b) => a[1].peakOutlay - b[1].peakOutlay)
    chosenKey = (byOutlay[0] ?? ranked[0])[0]
  }
  const plan = finals.get(chosenKey) as InvestmentEvaluation
  const chosenCand = finalsIn.get(chosenKey) as Candidate

  // Alternatives.
  const NAMED_LABELS: Record<string, { label: string; description: string }> = {
    metier: { label: 'Tout dans le métier', description: 'Monter le métier au plus haut niveau abordable, sans acheter de montures.' },
    stock: { label: 'Stock de montures', description: 'Pas de montée du métier : G1 achetées à l’HDV au départ et chaque jour en plus des captures.' },
    minimal: { label: 'Sans investissement', description: 'Niveau actuel, captures seulement : le plan de référence.' },
    'autre-mode': { label: 'Autre mode', description: 'Meilleure allocation du deuxième mode le plus rentable.' },
  }
  const alternatives: AlternativeRow[] = []
  const pushAlt = (id: string, key: string, labelText: string, description: string) => {
    const e = finals.get(key)
    if (!e) return
    const existing = alternatives.find((a) => a.allocation.id === e.allocation.id)
    if (existing) {
      if (id !== 'variante' && !existing.label.includes(labelText)) existing.label += ` · ${labelText}`
      return
    }
    alternatives.push({
      id,
      label: labelText,
      description,
      chosen: key === chosenKey,
      allocation: e.allocation,
      day0: e.day0,
      peakOutlay: e.peakOutlay,
      feasible: e.feasible,
      profitAtHorizon: e.profitAtHorizon,
      profitStatus: e.profitStatus,
      breakEvenDay: e.breakEvenDay,
      breakEvenEstimated: e.breakEvenEstimated,
      steadyNetPerDay: e.steadyNetPerDay,
      roi: e.roi,
    })
  }
  pushAlt('retenu', chosenKey, feasible ? 'Recommandé (équilibré)' : 'Plan minimal', feasible ? 'Le meilleur bénéfice sur l’horizon dans le budget.' : 'Le plan rentable le moins gourmand (hors budget).')
  for (const nm of named) {
    const l = NAMED_LABELS[nm.id]
    pushAlt(nm.id, nm.cand.key, nm.id === 'autre-mode' ? `Autre mode : ${nm.cand.setting.mf.label}` : l.label, l.description)
  }
  for (const [key] of ranked) if (alternatives.length < 4) pushAlt('variante', key, 'Variante', 'Autre allocation proche du meilleur bénéfice.')

  // Sensibilité.
  const sensitivity: SensitivityRow[] = []
  if (n.sensitivity) {
    label.value = 'Sensibilité'
    const variations: Variation[] = [
      { id: 'prix-bas', label: 'Prix de vente −20 %', revenueFactor: 0.8 },
      { id: 'prix-haut', label: 'Prix de vente +20 %', revenueFactor: 1.2 },
      { id: 'couts', label: 'Coûts +20 % (ingrédients, carburant, montures)', costFactor: 1.2 },
      { id: 'duree', label: 'Durées réelles × 1,5 (lots et crafts)', durationFactor: 1.5 },
      { id: 'liquidite', label: 'Liquidité ÷ 2 (part du volume vendable)', shareFactor: 0.5 },
    ]
    if (plan.leveling?.resale && plan.leveling.resale.total > 0) variations.push({ id: 'sans-revente', label: 'Sans revente des objets fabriqués', resale: false })
    // Mêmes graines pour la référence et les variantes : l'écart vient de la variante, pas du hasard.
    let refProfit = plan.profitAtHorizon
    for (const v of [{ ...BASE_VARIATION, id: 'reference', label: `Référence (mêmes ${SENSITIVITY_RUNS} tirages)` }, ...variations]) {
      try {
        const e = evaluate(n, chosenCand.setting, chosenCand.params, chosenCand.g1, n.simDays, SENSITIVITY_RUNS, v)
        evaluated += SENSITIVITY_RUNS
        if (v.id === 'reference') refProfit = e.profitAtHorizon
        sensitivity.push({
          id: v.id,
          label: v.label,
          profitAtHorizon: e.profitAtHorizon,
          delta: e.profitAtHorizon - refProfit,
          breakEvenDay: e.breakEvenDay,
          breakEvenEstimated: e.breakEvenEstimated,
          steadyNetPerDay: e.steadyNetPerDay,
          peakOutlay: e.peakOutlay,
          feasible: e.feasible,
        })
      } catch (e) {
        notes.push(`Sensibilité « ${v.label} » : ${e instanceof Error ? e.message : String(e)}`)
      }
      yield tick(SENSITIVITY_RUNS)
    }
  }

  const market = n.ctx.market ?? null
  const result: InvestmentResult = {
    budget: n.budget,
    reserve: n.reserve,
    available: n.available,
    horizonDays: n.horizon,
    simDays: n.simDays,
    modeId: n.modeId,
    levers: n.levers,
    feasible,
    plan,
    alternatives,
    sensitivity,
    shopping: shoppingOf(plan, n),
    actions: actionsOf(plan, n),
    roadmap: roadmapOf(plan, n),
    risks: risksOf(plan, n, sensitivity),
    assumptions: assumptionsOf(plan, n),
    minimumBudget,
    unusedBudget: Math.max(0, n.available - plan.peakOutlay),
    notes: [...new Set(notes)],
    evaluated,
    marketDate: market?.exportDate ?? null,
    marketServer: market?.serverName ?? null,
    craftsPerDay: n.craftsPerDay,
  }
  if (!feasible)
    result.notes.unshift(
      minimumBudget !== null
        ? `Budget insuffisant : aucun plan ne tient dans ${fmtK(n.available)} engageables (budget − réserve). Minimum utile ≈ ${fmtK(minimumBudget)} (réserve comprise).`
        : `Budget insuffisant et aucun plan rentable sur ${n.horizon} jours avec ces contraintes.`,
    )
  else if (result.unusedBudget > Math.max(1_000_000, 0.2 * n.available))
    result.notes.push(
      `${fmtK(result.unusedBudget)} du budget restent disponibles : les investir n’améliore pas le bénéfice sur ${n.horizon} jours (limites : enclos et niveau du métier, temps de jeu, volume du marché).`,
    )
  label.value = 'Terminé'
  yield { done: total, total, label: label.value }
  return result
}

function drain<T>(gen: Generator<ProgressInfo, T, void>, onProgress?: (p: ProgressInfo) => void): T {
  for (;;) {
    const r = gen.next()
    if (r.done) return r.value
    onProgress?.(r.value)
  }
}

/**
 * Plan d'investissement (synchrone : Web Worker ou tests). Lève une erreur si le mode est inconnu ou
 * si aucune stratégie n'est simulable.
 */
export function planInvestment(input: InvestmentInput, opts: { onProgress?: (p: ProgressInfo) => void } = {}): InvestmentResult {
  return drain(investmentGen(input), opts.onProgress)
}

/** Même chose en rendant la main au navigateur (repli sans Web Worker) ; null si arrêté. */
export async function planInvestmentAsync(
  input: InvestmentInput,
  opts: { onProgress?: (p: ProgressInfo) => void; shouldStop?: () => boolean; sliceMs?: number } = {},
): Promise<InvestmentResult | null> {
  const gen = investmentGen(input)
  const slice = opts.sliceMs ?? 40
  let last = Date.now()
  for (;;) {
    if (opts.shouldStop?.()) return null
    const r = gen.next()
    if (r.done) return r.value
    opts.onProgress?.(r.value)
    if (Date.now() - last > slice) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      last = Date.now()
    }
  }
}

// ---------- Liste de courses, plan d'action, feuille de route, risques ----------

function depthInfo(ctx: PriceContext, id: number | null, qty: number | null): Pick<ShoppingItem, 'sold24' | 'perDayAvg' | 'daysOfVolume'> {
  const d = id !== null ? marketDepth(ctx.market, id) : null
  return {
    sold24: d ? d.sold24 : null,
    perDayAvg: d ? d.perDayAvg : null,
    daysOfVolume: d && qty !== null && d.perDayAvg > 0 ? qty / d.perDayAvg : null,
  }
}

function shoppingOf(plan: InvestmentEvaluation, n: Norm): ShoppingItem[] {
  const out: ShoppingItem[] = []
  const cf = n.prices.costFactor ?? 1
  if (plan.leveling) {
    // Liste de courses du plan de montée (ingrédients agrégés).
    const lv = levelingInfoFromSegments(plan, n)
    for (const l of lv)
      out.push({
        category: 'metier',
        id: l.id,
        name: l.name,
        qty: l.qty,
        unitPrice: l.unit === null ? null : l.unit * cf,
        total: l.subtotal === null ? null : l.subtotal * cf,
        origin: l.origin,
        missing: l.missing,
        ...depthInfo(n.ctx, l.id, l.qty),
      })
  }
  for (const g of plan.g1StockLines) {
    const sp = getSpecies(g.speciesId)
    out.push({
      category: 'montures',
      id: sp?.itemId ?? null,
      name: g.name,
      qty: g.count,
      unitPrice: g.unitPrice,
      total: g.unitPrice === null ? null : g.unitPrice * g.count,
      origin: g.unitPrice === null ? 'manquant' : 'marche',
      missing: g.unitPrice === null,
      ...depthInfo(n.ctx, sp?.itemId ?? null, g.count),
      note: 'Prix d’achat prudent (la plus haute des médianes) ; vérifier qu’elles ne sont pas séniles.',
    })
  }
  const socle = plan.summary.capital.socle
  if (socle && socle.paddocks > 0 && plan.socleTotal > 0) {
    const ratio = plan.initialPaddocks / socle.paddocks
    const items = new Map<number, { name: string; count: number; unit: number | null; complete: boolean }>()
    for (const line of socle.lines)
      for (const it of line.items) {
        const cur = items.get(it.fuelId) ?? { name: it.name, count: 0, unit: it.unitPrice, complete: it.complete }
        cur.count += it.count * ratio
        cur.complete &&= it.complete
        items.set(it.fuelId, cur)
      }
    for (const [id, it] of items) {
      const qty = Math.ceil(it.count - 1e-9)
      const rp = resolvePrice(id, { ...n.ctx, jobLevel: plan.allocation.jobTo })
      out.push({
        category: 'socle',
        id,
        name: it.name,
        qty,
        unitPrice: it.unit === null ? null : it.unit * cf,
        total: it.unit === null ? null : it.unit * qty * cf,
        origin: rp.origin,
        missing: !it.complete || it.unit === null,
        ...depthInfo(n.ctx, id, qty),
        note: `Socle de ${plan.initialPaddocks} enclos (palier ${plan.allocation.tier}) : reste dans les jauges.`,
      })
    }
  }
  if (plan.workingCapital > 0)
    out.push({
      category: 'fonds',
      id: null,
      name: 'Fonds de roulement (carburant, filets, makinas avant que les ventes ne paient)',
      qty: null,
      unitPrice: null,
      total: plan.workingCapital,
      origin: 'calcul',
      missing: false,
      sold24: null,
      perDayAvg: null,
      daysOfVolume: null,
      note: 'Trésorerie maximale engagée après le jour 0 (10e centile des tirages).',
    })
  return out
}

/** Liste de courses du plan de montée retenu (recalculée : le plan n'est pas transporté en entier). */
function levelingInfoFromSegments(plan: InvestmentEvaluation, n: Norm): { id: number; name: string; qty: number; unit: number | null; subtotal: number | null; origin: string; missing: boolean }[] {
  const qty = new Map<number, number>()
  for (const seg of plan.leveling?.segments ?? []) for (const ing of seg.ingredients) qty.set(ing.id, (qty.get(ing.id) ?? 0) + ing.qty * seg.crafts)
  return [...qty.entries()]
    .map(([id, q]) => {
      const p = resolvePrice(id, n.ctx)
      return { id, name: itemName(id), qty: q, unit: p.price, subtotal: p.price === null ? null : p.price * q, origin: p.origin, missing: !p.complete || p.price === null }
    })
    .sort((a, b) => Number(a.missing) - Number(b.missing) || (b.subtotal ?? 0) - (a.subtotal ?? 0) || b.qty - a.qty || a.name.localeCompare(b.name, 'fr'))
}

/** Premier jour de vente du produit du mode (ressources, montures, brisage) ; null si aucun. */
function firstProductSale(plan: InvestmentEvaluation): { day: number; what: string; revenue: number } | null {
  const a = plan.allocation
  const fam = FAMILIES[a.family]
  for (const d of plan.summary.daily) {
    if (a.mode === 'brisage' && d.broken > 0) return { day: d.day, what: 'runes de brisage', revenue: d.revenueKnown }
    if (a.mode === 'vente' && d.mountsSold > 0) return { day: d.day, what: 'montures', revenue: d.revenueKnown }
    if (d.resourcesSold > 0) return { day: d.day, what: fam.extractionItemName, revenue: d.revenueKnown }
  }
  return null
}

const ACTION_ORDER: Record<InvestmentActionKind, number> = { achat: 0, reserve: 1, craft: 2, enclos: 3, production: 4, vente: 5, jalon: 6 }

function speciesName(id: number): string {
  return getSpecies(id)?.name ?? `#${id}`
}

function routineDetails(plan: InvestmentEvaluation, n: Norm): string[] {
  const s = plan.summary
  const r = s.routine
  const st = s.steady
  const fam = FAMILIES[plan.allocation.family]
  const out: string[] = []
  if (r.capturesPerDay.length)
    out.push(`Capturer ≈ ${fmtN(st.capturesPerDay, 1)} montures/jour : ${r.capturesPerDay.slice(0, 4).map((c) => `${speciesName(c.speciesId)} ${fmtN(c.perDay, 1)}`).join(', ')}.`)
  if (st.boughtPerDay > 0.05) out.push(`Acheter ≈ ${fmtN(st.boughtPerDay, 1)} G1/jour à l’HDV.`)
  if (st.batchesPerDay > 0) out.push(`${fmtN(st.batchesPerDay, 1)} lot${st.batchesPerDay >= 2 ? 's' : ''} d’enclos par jour (palier ${plan.allocation.tier}, ${s.sessionsPerDay} passages/jour).`)
  if (r.matingsPerDay.length)
    out.push(
      `Accoupler ≈ ${fmtN(st.matingsPerDay - st.condemnedMatingsPerDay, 1)}/jour selon la recette : ${r.matingsPerDay
        .slice(0, 3)
        .map((m) => `${speciesName(m.speciesId)} ${fmtN(m.perDay, 1)}`)
        .join(', ')}${st.optimakinasPerDay > 0.05 ? ` ; Optimakinas ≈ ${fmtN(st.optimakinasPerDay, 1)}/jour` : ''}.`,
    )
  if (r.condemnedMatingsPerDay > 0.05) out.push(`Accoupler avant d’extraire ≈ ${fmtN(r.condemnedMatingsPerDay, 1)}/jour (bébé gratuit).`)
  if (r.clonesPerDay.length) out.push(`Cloner les stériles ≈ ${fmtN(r.clonesPerDay.reduce((t, c) => t + c.perDay, 0), 1)}/jour.`)
  if (r.extractedPerDay.length)
    out.push(
      `Extraire ≈ ${fmtN(st.extractedPerDay, 1)} montures/jour (${r.extractedPerDay
        .slice(0, 3)
        .map((e) => `G${e.generation} ${fmtN(e.perDay, 1)}`)
        .join(', ')}) → ≈ ${fmtN(st.resourcesPerDay, 1)} ${fam.extractionItemName}/jour, vendues ≈ ${fmtN(st.resourcesSoldPerDay, 1)}/jour.`,
    )
  if (r.brokenPerDay > 0.05) out.push(`Briser ≈ ${fmtN(r.brokenPerDay, 1)} montures/jour (runes vendues ≈ ${fmtN(st.runesSoldPerDay, 1)}/jour).`)
  if (r.soldPerDay.length) out.push(`Vendre ≈ ${fmtN(st.mountsSoldPerDay, 1)} montures/jour : ${r.soldPerDay.slice(0, 4).map((x) => `${speciesName(x.speciesId)} ${fmtN(x.perDay, 1)}`).join(', ')}.`)
  for (const f of r.fuel) {
    if (!f.itemsPerDay) continue
    const how = f.fuelId !== null ? sourcingOf(f.fuelId, n, plan.allocation.jobTo) : 'acheter'
    out.push(`Carburant : ${f.fuelName} × ${fmtN(f.itemsPerDay, 1)}/jour (${f.gauge}, palier ${f.tier}${f.costPerDay !== null ? `, ≈ ${fmtK(f.costPerDay)}/jour` : ''}) — ${how}.`)
  }
  if (st.genetonsPerDay > 0.05) out.push(`Génétons ≈ ${fmtN(st.genetonsPerDay, 1)}/jour (échangés en parchemins revendus).`)
  return out
}

function sourcingOf(id: number, n: Norm, jobLevel: number): string {
  if (!n.levers.buyFuels) return 'fabriquer'
  const rp = resolvePrice(id, { ...n.ctx, jobLevel })
  return rp.origin === 'craft' ? 'fabriquer (moins cher que l’HDV)' : 'acheter à l’HDV'
}

function actionsOf(plan: InvestmentEvaluation, n: Norm): InvestmentAction[] {
  const a = plan.allocation
  const s = plan.summary
  const out: InvestmentAction[] = []
  // Jour 0 : achats.
  if (plan.leveling) {
    const lines = levelingInfoFromSegments(plan, n)
    out.push({
      day: 0,
      kind: 'achat',
      title: `Acheter les ingrédients pour monter le métier d’Éleveur du niveau ${plan.leveling.from} au niveau ${plan.leveling.to}`,
      details: [
        ...lines.slice(0, 6).map((l) => `${l.name} × ${fmtN(l.qty)}${l.unit !== null ? ` (${fmtN(l.unit)} K/u)` : ' — prix à saisir'}`),
        ...(lines.length > 6 ? [`… et ${lines.length - 6} autres ingrédients (liste de courses complète ci-dessous).`] : []),
      ],
      kamas: -plan.leveling.cost,
    })
  }
  if (plan.g1StockLines.length)
    out.push({
      day: 0,
      kind: 'achat',
      title: `Acheter ${fmtN(a.g1Stock)} montures G1 à l’HDV (stock de départ)`,
      details: [...plan.g1StockLines.map((g) => `${g.name} × ${g.count}${g.unitPrice !== null ? ` (≈ ${fmtN(g.unitPrice)} K/u)` : ''}`), 'Vérifiez qu’elles ne sont pas séniles (d’avant la 3.5 : ni accouplement ni clonage).'],
      kamas: -plan.g1StockCost,
    })
  const socle0 = plan.socle.filter((x) => x.day === 0).reduce((t, x) => t + x.amount, 0)
  if (socle0 > 1)
    out.push({
      day: 0,
      kind: 'achat',
      title: `Remplir le socle des jauges au palier ${a.tier} (${plan.initialPaddocks} enclos)`,
      details: ['Une seule fois par enclos : ces points restent dans les jauges (investissement, pas un coût).'],
      kamas: -socle0,
    })
  out.push({
    day: 0,
    kind: 'reserve',
    title:
      plan.workingCapital >= 1000
        ? `Garder ${fmtK(n.reserve)} de réserve et ${fmtK(plan.workingCapital)} de fonds de roulement`
        : `Garder ${fmtK(n.reserve)} de réserve (pas de fonds de roulement : les ventes couvrent les dépenses dès le départ)`,
    details: [
      `Trésorerie maximale engagée : ${fmtK(plan.peakOutlay)} sur ${fmtK(n.available)} engageables.`,
      'Fonds de roulement : carburant, filets et makinas achetés avant que les ventes ne couvrent les dépenses.',
    ],
    kamas: null,
  })
  // Crafts.
  if (plan.leveling && plan.leveling.crafts > 0) {
    const per = craftsByDay(plan.leveling.segments, plan.leveling.craftsPerDay)
    const days = plan.leveling.craftDays
    const chunk = days <= 8 ? 1 : Math.ceil(days / 8)
    for (let d0 = 0; d0 < days; d0 += chunk) {
      const d1 = Math.min(days - 1, d0 + chunk - 1)
      const items = per.filter((x) => x.day >= d0 && x.day <= d1)
      const crafts = items.reduce((t, x) => t + x.crafts, 0)
      out.push({
        day: d0,
        toDay: d1 > d0 ? d1 : undefined,
        kind: 'craft',
        title: `Fabriquer ${fmtN(crafts)} objets (≈ ${fmtN(crafts / n.craftsPerHour, 1)} h de craft)`,
        details: [
          ...mergeSegments(items).map((x) => `Niv. ${x.segment.fromLevel} → ${x.segment.toLevel} : ${x.segment.recipeName} × ${fmtN(x.crafts)}`),
          ...milestonesLine(plan.levelDays.filter((l) => l.day >= d0 && l.day <= d1 && l.source === 'craft')),
        ],
        kamas: null,
      })
    }
    const rs = plan.leveling.resale
    if (rs && rs.total > 0) {
      const sold = rs.lines.filter((l) => l.soldBySimEnd > 0)
      out.push({
        day: 1,
        toDay: plan.simDays,
        kind: 'vente',
        title: `Revendre les objets fabriqués à l’HDV (≈ ${fmtK(rs.total)} sur ${plan.simDays} jours)`,
        details: [
          ...sold.slice(0, 5).map((l) => `${l.name} : ${fmtN(l.soldBySimEnd)} / ${fmtN(l.qty)} vendus (≤ ${fmtN(l.perDayCap ?? 0, 1)}/jour)`),
          rs.total < rs.potential - 1
            ? `Valeur totale à l’HDV ≈ ${fmtK(rs.potential)} : le reste dépasse le volume du serveur sur la période (gardez-le pour vos enclos ou vendez plus tard).`
            : `Tout est écoulé dans la période, au plus ${Math.round(n.share * 100)} % des ventes quotidiennes de chaque objet.`,
        ],
        kamas: rs.total,
      })
    }
  }
  // Jalons du métier.
  for (const ld of plan.levelDays) {
    if (ld.kind === 'enclos') {
      const usable = ld.day + 1
      const soclePer = plan.socle.filter((x) => x.day === usable).reduce((t, x) => t + x.amount, 0)
      out.push({
        day: ld.day,
        kind: 'enclos',
        title: `Niveau ${ld.level} atteint → ${ld.paddocks}e enclos (utilisable dès le jour ${usable})`,
        details: [
          ld.source === 'craft' ? 'Grâce aux crafts de la montée du métier.' : 'Grâce à l’XP d’élevage (captures, accouplements).',
          ...(soclePer > 0 ? [`Remplir son socle (palier ${a.tier}) : ≈ ${fmtK(soclePer)}.`] : []),
        ],
        kamas: soclePer > 0 ? -soclePer : null,
      })
    } else if (ld.source === 'elevage' && ld.kind !== 'carburant')
      out.push({
        day: ld.day,
        kind: 'jalon',
        title: `Niveau ${ld.level} : ${ld.label}`,
        details: ['Atteint grâce à l’XP d’élevage (captures, accouplements).'],
        kamas: null,
      })
  }
  // Démarrage de l'élevage.
  const first = s.daily.slice(0, 7)
  const capFirst = first.length ? first.reduce((t, x) => t + x.captures, 0) / first.length : 0
  out.push({
    day: 1,
    kind: 'production',
    title: `Lancer l’élevage : ${a.modeLabel}, ${plan.initialPaddocks} enclos au départ`,
    details: [
      `Stratégie : ${a.strategyLabel}.`,
      `Semaine 1 : ≈ ${fmtN(capFirst, 1)} captures/jour (capacité ≈ ${fmtN(s.captureCapacityPerDay, 0)}/jour) pour remplir les enclos ; lots de ${PADDOCK_SLOTS} montures au palier ${a.tier}.`,
      ...(s.plan.captureShares.length ? [`Couleurs à capturer : ${s.plan.captureShares.map((c) => `${speciesName(c.speciesId)} ${Math.round(c.share * 100)} %`).join(', ')}.`] : []),
    ],
    kamas: null,
  })
  if (a.g1PerDay > 0 && s.totals.bought > 0)
    out.push({
      day: 1,
      toDay: plan.simDays,
      kind: 'achat',
      title: `Acheter jusqu’à ${a.g1PerDay} G1 par jour à l’HDV (≈ ${fmtN(s.totals.bought / plan.simDays, 1)}/jour en moyenne)`,
      details: [
        'Seulement pour remplir les places libres que les captures ne remplissent pas ; au plus la part du volume quotidien des objets-montures.',
        `Régime permanent : ≈ ${fmtN(s.steady.boughtPerDay, 1)} G1/jour, ≈ ${fmtK(s.steady.costByCategory.achat)}/jour.`,
      ],
      kamas: null,
    })
  const ftd = s.firstTargetDay ? Math.max(1, Math.round(s.firstTargetDay.mean)) : null
  if (ftd !== null && a.mode !== 'brisage')
  {
    const lo = Math.round(s.firstTargetDay?.p10 ?? ftd)
    const hi = Math.round(s.firstTargetDay?.p90 ?? ftd)
    out.push({ day: ftd, kind: 'jalon', title: `Premier bébé G${s.plan.targetGeneration} (génération visée)`, details: [lo !== hi ? `Moyenne des tirages (8 sur 10 entre le jour ${lo} et le jour ${hi}).` : 'Moyenne des tirages.'], kamas: null })
  }
  const firstSale = firstProductSale(plan)
  if (firstSale)
    out.push({
      day: firstSale.day,
      kind: 'vente',
      title: `Premières ventes : ${firstSale.what}`,
      details: [`≈ ${fmtK(firstSale.revenue)} de revenus de l’élevage ce jour-là (taxe d’HDV déduite, génétons compris).`],
      kamas: firstSale.revenue,
    })
  if (s.rampUpDays !== null)
    out.push({
      day: s.rampUpDays,
      kind: 'production',
      title: `Régime permanent : ≈ ${fmtK(plan.steadyNetPerDay)} de bénéfice net par jour`,
      details: routineDetails(plan, n),
      kamas: null,
    })
  else
    out.push({
      day: Math.max(1, s.steady.fromDay),
      kind: 'production',
      title: `Routine quotidienne (fin de période) : ≈ ${fmtK(plan.steadyNetPerDay)} de bénéfice net par jour`,
      details: routineDetails(plan, n),
      kamas: null,
    })
  if (plan.breakEvenDay !== null && !plan.breakEvenEstimated)
    out.push({ day: plan.breakEvenDay, kind: 'jalon', title: 'Point mort : l’investissement est remboursé', details: ['Le cumul (achats du jour 0, socle, coûts, revenus) redevient positif et le reste.'], kamas: null })
  const h = plan.cashflow[Math.min(n.horizon, plan.cashflow.length - 1)]
  if (h)
    out.push({
      day: n.horizon,
      kind: 'jalon',
      title: `Fin de l’horizon (${n.horizon} jours) : bénéfice cumulé ≈ ${fmtK(h.cumulative)}${plan.roi !== null ? ` (ROI ${fmtN(plan.roi * 100)} %)` : ''}`,
      details: [`8 tirages sur 10 au-dessus de ${fmtK(h.cumulativeLow)}.`],
      kamas: null,
    })
  return out.sort((x, y) => x.day - y.day || ACTION_ORDER[x.kind] - ACTION_ORDER[y.kind])
}

function milestonesLine(levels: LevelDay[]): string[] {
  if (!levels.length) return []
  return [`Niveaux atteints : ${levels.map((l) => `${l.level} (${l.kind === 'enclos' ? `${l.paddocks}e enclos` : l.label})`).join(', ')}.`]
}

function mergeSegments(items: { day: number; segment: PlanSegment; crafts: number }[]): { segment: PlanSegment; crafts: number }[] {
  const out: { segment: PlanSegment; crafts: number }[] = []
  for (const it of items) {
    const last = out[out.length - 1]
    if (last && last.segment === it.segment) last.crafts += it.crafts
    else out.push({ segment: it.segment, crafts: it.crafts })
  }
  return out
}

function roadmapOf(plan: InvestmentEvaluation, n: Norm): RoadmapMilestone[] {
  const a = plan.allocation
  const s = plan.summary
  const out: RoadmapMilestone[] = [{ day: 0, kind: 'depart', label: 'Achats et démarrage', detail: `${fmtK(plan.day0)} dépensés le jour 0` }]
  const lv = plan.leveling
  if (lv) {
    const reach = plan.levelDays.find((l) => l.level >= lv.to)
    out.push({ day: reach ? reach.day : Math.max(0, lv.craftDays - 1), kind: 'metier', label: `Métier niveau ${lv.to}`, detail: `${fmtN(lv.crafts)} crafts en ${lv.craftDays} jour${lv.craftDays > 1 ? 's' : ''}` })
  }
  for (const ld of plan.levelDays.filter((l) => l.kind === 'enclos'))
    out.push({ day: ld.day + 1, kind: 'enclos', label: `${ld.paddocks}e enclos`, detail: `Niveau ${ld.level} (${ld.source === 'craft' ? 'crafts' : 'XP d’élevage'})` })
  if (s.firstTargetDay && a.mode !== 'brisage') out.push({ day: Math.max(1, Math.round(s.firstTargetDay.mean)), kind: 'premiere-cible', label: `Premier G${s.plan.targetGeneration}` })
  const firstSale = firstProductSale(plan)
  if (firstSale) out.push({ day: firstSale.day, kind: 'premiere-vente', label: 'Premières ventes', detail: firstSale.what })
  out.push({ day: s.rampUpDays ?? s.steady.fromDay, kind: 'regime', label: 'Régime permanent', detail: `≈ ${fmtK(plan.steadyNetPerDay)}/jour`, estimated: s.rampUpDays === null })
  if (plan.breakEvenDay !== null) out.push({ day: plan.breakEvenDay, kind: 'point-mort', label: 'Point mort', estimated: plan.breakEvenEstimated, detail: plan.breakEvenEstimated ? 'extrapolé (régime permanent)' : undefined })
  out.push({ day: n.horizon, kind: 'horizon', label: `Horizon ${n.horizon} j`, detail: `${fmtK(plan.profitAtHorizon)} cumulés` })
  const order: Record<RoadmapKind, number> = { depart: 0, metier: 1, enclos: 2, 'premiere-cible': 3, 'premiere-vente': 4, regime: 5, 'point-mort': 6, horizon: 7 }
  return out.sort((x, y) => x.day - y.day || order[x.kind] - order[y.kind])
}

function risksOf(plan: InvestmentEvaluation, n: Norm, sensitivity: SensitivityRow[]): InvestmentRisk[] {
  const out: InvestmentRisk[] = []
  const s = plan.summary
  const a = plan.allocation
  const market = n.ctx.market ?? null
  // Données de prix.
  if (!market) out.push({ code: 'pas-de-marche', tone: 'danger', text: 'Aucun export HDV importé pour ce serveur : prix par défaut de la recherche (autre serveur, datés) et liquidité inconnue. Importez l’export de votre serveur (Prix › Marché HDV).' })
  else {
    const age = n.today ? exportAgeDays(market.exportDate, n.today) : null
    const when = `Prix de l’HDV${market.serverName ? ` de ${market.serverName}` : ''} du ${frenchDay(market.exportDate)}`
    if (age !== null && age > MARKET_STALE_DAYS) out.push({ code: 'prix-dates', tone: 'warn', text: `${when} (il y a ${age} jours) : les prix ont pu changer, réimportez un export récent.` })
    else out.push({ code: 'prix-dates', tone: 'info', text: `${when}${age !== null ? ` (${age === 0 ? 'aujourd’hui' : `il y a ${age} jour${age > 1 ? 's' : ''}`})` : ''} : un plan sur ${n.horizon} jours suppose des prix stables.` })
  }
  // Saturation du marché.
  const satMounts = s.market.filter((mc) => mc.kind === 'monture' && mc.saturated).sort((x, y) => y.producedPerDay - x.producedPerDay)
  if (satMounts.length)
    out.push({
      code: 'saturation-montures',
      tone: 'warn',
      text: `Ventes de montures au-delà du volume du serveur (${Math.round(n.share * 100)} % des ventes quotidiennes) pour ${satMounts.length} espèce${satMounts.length > 1 ? 's' : ''} : ${satMounts
        .slice(0, 3)
        .map((mc) => `${mc.name} ${fmtN(mc.producedPerDay, 1)}/jour pour ${mc.capPerDay === null ? '?' : fmtN(mc.capPerDay, 1)} vendables`)
        .join(', ')} — le surplus est extrait (déjà compté ainsi).`,
    })
  for (const mc of s.market) {
    if (mc.kind === 'monture') continue
    const share = mc.shareOfMarket
    if (mc.saturated)
      out.push({
        code: 'saturation',
        tone: 'warn',
        text: `${mc.name} : la production (${fmtN(mc.producedPerDay, 1)}/jour) dépasse ce que le marché absorbe (${mc.capPerDay === null ? '?' : fmtN(mc.capPerDay, 1)}/jour = ${Math.round(n.share * 100)} % du volume) : stock invendu ≈ ${fmtN(mc.endStock)} en fin de période, le prix baissera.`,
      })
    else if (share !== null)
      out.push({
        code: 'volume',
        tone: share > 0.1 ? 'warn' : 'info',
        text: `${mc.name} : ${fmtN(mc.producedPerDay, 1)}/jour produits = ${fmtN(share * 100, 1)} % des ventes quotidiennes du serveur (${mc.marketPerDay === null ? '?' : fmtN(mc.marketPerDay)}/jour) ; plafond retenu ${Math.round(n.share * 100)} %.`,
      })
  }
  // Ingrédients du métier.
  if (plan.leveling) {
    const heavy = levelingInfoFromSegments(plan, n)
      .map((l) => ({ l, d: marketDepth(market, l.id) }))
      .filter((x) => x.d && x.d.perDayAvg > 0 && x.l.qty > x.d.perDayAvg)
      .sort((x, y) => y.l.qty / (y.d?.perDayAvg ?? 1) - x.l.qty / (x.d?.perDayAvg ?? 1))
    if (heavy.length)
      out.push({
        code: 'ingredients',
        tone: 'warn',
        text: `Achats d’ingrédients au-delà d’une journée de ventes du serveur : ${heavy
          .slice(0, 3)
          .map((x) => `${x.l.name} × ${fmtN(x.l.qty)} (${fmtN(x.l.qty / (x.d?.perDayAvg ?? 1), 1)} j de volume)`)
          .join(', ')} — étalez les achats ou attendez-vous à payer plus cher.`,
      })
    if (!plan.leveling.complete) out.push({ code: 'metier-incomplet', tone: 'warn', text: `Montée du métier : ${plan.leveling.missing.length} ingrédient(s) sans prix — le coût affiché est une borne basse (≥).` })
    const rs = plan.leveling.resale
    if (rs && rs.potential > 0 && rs.total < 0.5 * rs.potential)
      out.push({ code: 'revente', tone: 'info', text: `Revente des objets fabriqués : ≈ ${fmtK(rs.total)} vendus en ${plan.simDays} jours sur ${fmtK(rs.potential)} de valeur (volume du serveur) — le reste n’est pas compté.` })
  }
  if (a.mode === 'brisage') out.push({ code: 'brisage', tone: 'warn', text: BRISAGE_RISK_NOTE })
  if (a.mode === 'vente') out.push({ code: 'hdv-mixte', tone: 'warn', text: `${MOUNT_MARKET_NOTE} Les ventes sont comptées à un prix prudent et plafonnées par le volume.` })
  if (s.totals.bought > 0 || a.g1Stock > 0) out.push({ code: 'senile', tone: 'warn', text: 'Montures achetées à l’HDV : vérifiez qu’elles ne sont pas séniles (d’avant la 3.5 : ni accouplement ni clonage).' })
  const revenue = s.steady.revenueKnown
  if (revenue > 0 && s.steady.revenueByCategory.genetons / revenue > 0.2)
    out.push({ code: 'genetons', tone: 'info', text: `${fmtN((100 * s.steady.revenueByCategory.genetons) / revenue)} % des revenus viennent des génétons (valeur estimée d’après la boutique d’Eugène Éton, liés au compte : revente des parchemins).` })
  // Temps de jeu.
  const slow = sensitivity.find((x) => x.id === 'duree')
  out.push({
    code: 'temps',
    tone: 'info',
    text: `Joueur parfait supposé (${fmtN(n.hoursPerDay, 1)} h/jour, ${s.sessionsPerDay} passages aux enclos, aucune session manquée)${slow ? ` ; avec des durées × 1,5 : ${fmtK(slow.profitAtHorizon)} à ${n.horizon} jours${slow.breakEvenDay !== null ? `, point mort jour ${slow.breakEvenDay}${slow.breakEvenEstimated ? ' (extrapolé)' : ''}` : ''}` : ''}.`,
  })
  if (!plan.complete) out.push({ code: 'prix-manquants', tone: 'warn', text: `${plan.missing.length} prix manquant(s) : montants « ≥ » / « ≤ », jamais comptés 0. Renseignez-les (page Prix).` })
  for (const w of s.warnings) if (['etable', 'cible-non-atteinte', 'liquidite-inconnue', 'achat-limite'].includes(w.code) && !out.some((o) => o.text === w.text)) out.push({ code: w.code, tone: w.tone, text: w.text })
  return out
}

function assumptionsOf(plan: InvestmentEvaluation, n: Norm): string[] {
  const out = [
    `Crafts : ${fmtN(n.craftsPerHour)} par heure (ESTIMATION : fabrication en série et achats des ingrédients compris), ${fmtN(n.craftHoursPerDay, 1)} h de craft par jour pendant la montée du métier, soit ${fmtN(n.craftsPerDay)} crafts/jour ; les crafts commencent le jour 0.`,
    'Un niveau d’Éleveur atteint en fin de journée débloque son enclos le lendemain ; l’XP d’élevage (captures, accouplements) d’un tirage témoin fait aussi monter le niveau.',
    `Pendant toute la simulation, prix de craft et filet du niveau visé (${plan.allocation.jobTo}) ; le métier monte en quelques jours.`,
    'Socle des jauges (paliers ≥ 2) acheté à l’ouverture de chaque enclos et compté dans l’investissement à rembourser (il reste dans les jauges).',
    `Trésorerie maximale engagée lue sur le 10e centile des ${n.runs} tirages (prudent), dépenses de chaque jour payées avant ses ventes ; le budget n’est jamais dépassé : jour 0 + fonds de roulement ≤ budget − réserve.`,
    `Projections : ${plan.simDays} jours simulés ; régime permanent = moyenne du dernier tiers.`,
  ]
  if (n.levers.resellCrafts && plan.leveling) out.push(`Objets fabriqués revendus à partir du lendemain, au plus ${Math.round(n.share * 100)} % des ventes quotidiennes moyennes de chaque objet, taxe ${fmtN(n.saleTax * 100, 1)} % déduite.`)
  if (!n.levers.buyFuels) out.push('Carburants fabriqués seulement : coût des ingrédients ; temps de craft et XP de ces crafts non comptés.')
  if (!n.levers.buyGear) out.push('Filets et makinas fabriqués seulement : une Optimakina hors de portée du métier n’est pas utilisée.')
  return [...out, ...plan.summary.assumptions]
}

/** Texte de la liste de courses (copier-coller : « Nom × quantité »). */
export function investmentShoppingText(items: ShoppingItem[]): string {
  return items
    .filter((i) => i.qty !== null && i.id !== null)
    .map((i) => `${i.name} × ${i.qty}`)
    .join('\n')
}

/** Libellé d'un mode d'investissement. */
export function investmentModeLabel(id: ProfitModeId): string {
  return id === 'auto' ? 'Automatique (le plus rentable)' : (profitMode(id)?.label ?? id)
}

/** Niveaux d'enclos (pour les pages). */
export const PADDOCK_LEVELS = PADDOCK_UNLOCK_LEVELS.map((p) => p.level)
