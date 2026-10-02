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
//   volume du marché ; la trésorerie maximale engagée est lue sur le bas de la bande des tirages (min sous 10 tirages : prudent) ;
// - un prix inconnu n'est jamais compté 0 : `complete` / `missing`, montants connus = bornes.
//
// Module pur : aucun React, aucun store.
import { FAMILIES, FUELS, MAKINAS, NETS, getRecipe, getSpecies, itemName } from '../data'
import { formatKamas, formatNumber } from '../lib/format'
import { FUEL_TIER_UNLOCK_LEVEL, PADDOCK_SLOTS, PADDOCK_UNLOCK_LEVELS } from './constants'
import { BRISAGE_RISK_NOTE } from './economy'
import { jobMilestones, levelingPlan, paddocksAt, recipeCraftCost, type JobRecipe, type LevelingPlan, type PlanSegment } from './job'
import { exportAgeDays, marketDepth, marketOriginMismatch, marketWhere, MARKET_OLD_DAYS, MARKET_STALE_DAYS, MOUNT_MARKET_NOTE } from './market'
import { marketPrice, resolvePrice, type PriceContext } from './pricing'
import {
  bandLabel,
  bandOf,
  COMPARED_MODES,
  DEFAULT_CAPTURE_SHARE,
  DEFAULT_MOUNT_SALE_FACTOR,
  sessionsForHours,
  normalizeProductionConfig,
  productionPlan,
  productionPriceBook,
  profitMode,
  runProduction,
  simulateProduction,
  strategyLabel,
  type CaptureHoursStep,
  type InitialStockLine,
  type JobLevelStep,
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
import type { FamilyId, FuelTier, Mount } from './types'
import { effectiveFertility } from './mounts'
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
/** Temps d'un passage aux enclos (h, ESTIMATION) : pris sur le temps de capture pendant les jours de craft. */
export const SESSION_HOURS = 0.25
/** Deux plans dont les bénéfices à l'horizon diffèrent de moins de 5 % (ou du bruit des tirages) sont à égalité. */
export const PROFIT_TIE_SHARE = 0.05

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
  /**
   * Compter les prix « HDV mixte » des objets-montures comme fiables (défaut faux) : sinon une vente de
   * montures chiffrée au prix du marché est spéculative et jamais retenue en mode automatique.
   */
  countMixedMountPrices: boolean
}

export const DEFAULT_INVESTMENT_LEVERS: InvestmentLevers = { levelJob: true, buyG1: true, buyFuels: true, buyGear: true, resellCrafts: true, countMixedMountPrices: false }

export const LEVER_LABELS: Record<keyof InvestmentLevers, { label: string; hint: string }> = {
  levelJob: { label: 'Monter le métier d’Éleveur en achetant les ingrédients', hint: 'Plus d’enclos (40/80/120/160/200), carburants de palier supérieur, filets multiplicateurs.' },
  buyG1: { label: 'Acheter des montures G1 à l’HDV', hint: 'Stock de départ et achats quotidiens en plus des captures (prix de l’objet-monture, plafonnés par son volume).' },
  buyFuels: { label: 'Acheter les carburants à l’HDV', hint: 'Sinon : carburants fabriqués seulement (paliers à portée de votre niveau d’Éleveur).' },
  buyGear: { label: 'Acheter filets et makinas à l’HDV', hint: 'Sinon : fabriqués seulement (Optimakina abandonnée si hors de portée).' },
  resellCrafts: { label: 'Revendre les objets fabriqués en montant le métier', hint: 'Carburants, filets, makinas revendus à l’HDV, au plus la part du volume quotidien réglée pour le serveur.' },
  countMixedMountPrices: {
    label: 'Compter les prix « HDV mixte » des montures',
    hint: 'Sinon, une vente de montures chiffrée au prix de l’objet-monture du marché (niveaux, états et séniles mélangés) est spéculative : jamais retenue en mode automatique. Saisissez plutôt le prix d’un bébé niveau 1 fécond (page Prix).',
  },
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
  /**
   * Montures déjà possédées (« Partir de mon étable actuelle », revue UX2-16 ; `stockFromInventory`) :
   * stock de départ de la production, en plus des G1 achetées (filtré par famille).
   */
  initialStock?: InitialStockLine[]
}

/**
 * Étable actuelle → stock de départ de la production (`InitialStockLine` par espèce, état et niveau).
 * Les séniles (ni accouplement ni clonage) et les espèces non reproductibles sont ignorées.
 */
export function stockFromInventory(mounts: readonly Mount[]): InitialStockLine[] {
  const acc = new Map<string, InitialStockLine>()
  for (const m of mounts) {
    const sp = getSpecies(m.speciesId)
    const f = effectiveFertility(m)
    if (!sp?.breedable || f === 'senile') continue
    const level = Math.max(1, Math.min(200, Math.round(m.level || 1)))
    const k = `${m.speciesId}|${f}|${level}`
    const cur = acc.get(k)
    if (cur) cur.count += 1
    else acc.set(k, { speciesId: m.speciesId, count: 1, state: f, level })
  }
  return [...acc.values()]
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
  /**
   * Objet à fabriquer (origine `craft`) : ingrédients de la recette pour la quantité de la ligne (revue
   * UX2-10 : « à fabriquer » sans ses ingrédients n'était pas une liste de courses).
   */
  ingredients?: { id: number; name: string; qty: number; unitPrice: number | null; origin: string }[]
  /** Niveau d'Éleveur de la recette, si l'objet est à fabriquer. */
  craftLevel?: number
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
  /**
   * Bande du cumul : 10e / 90e centiles des tirages de production à partir de 10 tirages, sinon min–max
   * des tirages (`InvestmentEvaluation.bandLabel`).
   */
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
  /** Trésorerie maximale engagée (bas de la bande des tirages) : jour 0 + fonds de roulement. */
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
  /** Bande du bénéfice par jour en régime permanent (même convention que `bandLabel`). */
  steadyNetP10: number
  steadyNetP90: number
  /** Tirages de l'évaluation et libellé de la bande (« min–max des 3 tirages », « 8 tirages sur 10 »). */
  runs: number
  bandLabel: string
  /** Erreur type du bénéfice à l'horizon (écart-type entre tirages ÷ √tirages). */
  profitSe: number
  /** Régime réellement permanent (`SteadyState.stable`). */
  stable: boolean
  /** Vente chiffrée au prix « HDV mixte » sans prix du joueur : jamais retenue en mode automatique. */
  speculative: boolean
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
  speculative: boolean
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
  /**
   * Scénario qui change la chronologie (durées, rythme des crafts) et dont l'écart avec la référence tient
   * dans le bruit des tirages (`profitTie` : sous 5 % ou sous 2 erreurs types) : mêmes graines, mais les
   * lots décalés font diverger les tirages — pas un effet démontré du scénario.
   */
  withinNoise: boolean
}

/** Pire scénario de la sensibilité (prix −20 %, durées × 1,5, liquidité ÷ 2, sans génétons, prix des montures −50 %). */
export interface WorstCase {
  id: string
  label: string
  /** Cumul moyen par jour (jour 0 … durée simulée) de ce scénario. */
  cumulative: number[]
  profitAtHorizon: number
  /** Cumul au jour 60 (null si la simulation est plus courte). */
  at60: number | null
  breakEvenDay: number | null
  breakEvenEstimated: boolean
  /** Tirages du scénario (mêmes graines que la référence de la sensibilité). */
  runs: number
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
  /** Pire scénario de la sensibilité (courbe affichée à côté du plan retenu), null sans sensibilité. */
  worstCase: WorstCase | null
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
  /** Montures possédées (stock de départ, toutes familles). */
  initialStock: InitialStockLine[]
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
    initialStock: (p.initialStock ?? []).filter((l) => l && Number.isFinite(l.count) && l.count > 0 && !!getSpecies(l.speciesId)),
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
  /** Libellé de la bande (`cumulativeLow` / `cumulativeHigh`) : « min–max des N tirages » sous 10 tirages. */
  bandLabel: string
}

/**
 * Courbe de trésorerie (jour 0 … durée simulée) d'un résumé de production et des achats d'investissement.
 * Bande : 10e–90e centiles des tirages à partir de 10 tirages, sinon min–max (avec 3 tirages, un
 * « 10e centile » ne serait que le minimum et le « 90e » la médiane : la moyenne sortirait de la bande).
 */
export function cashFlowOf(summary: ProductionSummary, extras: CashExtras): CashResult {
  const S = summary.daily.length
  const runs = summary.runs
  const inv = Array.from({ length: S + 1 }, () => 0)
  inv[0] += extras.day0Fixed
  for (const s of extras.socle) inv[clamp(Math.round(s.day), 0, S)] += s.amount
  const points: CashFlowPoint[] = []
  let invCum = 0
  let resaleCum = 0
  let cum = 0
  // Dans une journée, les dépenses (achats, filets, carburant) précèdent les ventes du soir : la
  // trésorerie engagée compte le creux avant les ventes du jour (bas de la bande).
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
      cumulativeLow: base + (ds ? bandOf(ds.cumulative, runs).low : 0),
      cumulativeHigh: base + (ds ? bandOf(ds.cumulative, runs).high : 0),
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
  return { points, day0: inv[0], peakOutlay, breakEvenDay, breakEvenEstimated, bandLabel: bandLabel(runs) }
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
  /** Achats quotidiens autorisés (places que les captures ne remplissent pas), 0 = stock de départ seulement. */
  perDay: number
  /** Achats possibles par jour d'après le volume des objets-montures (null = liquidité inconnue). */
  perDayCap: number | null
}

const NO_G1: G1Plan = { stock: [], perDay: 0, perDayCap: null }

interface Variation {
  id: string
  label: string
  revenueFactor?: number
  costFactor?: number
  durationFactor?: number
  shareFactor?: number
  resale?: boolean
  /** Génétons comptés (défaut : oui). */
  includeGenetons?: boolean
  /** Facteur du prix de vente des montures (« HDV mixte »). */
  mountSaleFactor?: number
  /** Facteur du rythme de craft (0,5 = deux fois plus lent). */
  craftFactor?: number
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
  // Achats quotidiens réellement possibles : plafond du volume des objets-montures.
  const g1PerDay = g1DailyCap(c.g1)
  const parts = [s.target > n.cur ? `Métier ${n.cur} → ${s.target}` : `Métier niv. ${n.cur} (sans montée)`, modeLabel(s.mf), stratLabel]
  if (g1Stock || g1PerDay) parts.push(`G1 achetées (${g1Stock} au départ${g1PerDay ? `, ≤ ${fmtN(g1PerDay, g1PerDay < 10 ? 1 : 0)}/jour` : ''})`)
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
    g1PerDay,
    summary: parts.join(' · '),
  }
}

/** Achats quotidiens de G1 possibles : demande du plan plafonnée par le volume des objets-montures. */
function g1DailyCap(g1: G1Plan): number {
  if (!g1.perDay) return 0
  return g1.perDayCap === null ? g1.perDay : Math.min(g1.perDay, g1.perDayCap)
}

/**
 * Calendriers de la montée du métier pour le moteur : niveau d'Éleveur du jour (le filet équipé suit
 * le niveau atteint la veille au soir) et temps de capture pendant les jours de craft (temps de jeu −
 * crafts − passages aux enclos, ESTIMATION `SESSION_HOURS` par passage).
 */
function levelingSchedules(n: Norm, timeline: Timeline, craftDays: number): { jobLevelSchedule: JobLevelStep[]; captureHoursSchedule: CaptureHoursStep[] } {
  const jobLevelSchedule: JobLevelStep[] = []
  for (let day = 1; day < timeline.levels.length; day++) {
    const lvl = timeline.levels[day - 1]
    if (!jobLevelSchedule.length || jobLevelSchedule[jobLevelSchedule.length - 1].jobLevel !== lvl) jobLevelSchedule.push({ day, jobLevel: lvl })
  }
  const captureHoursSchedule: CaptureHoursStep[] = []
  // Jours de craft : jours 0 … craftDays − 1 ; le jour de production d chevauche les crafts si d ≤ craftDays − 1.
  if (craftDays > 1) {
    const sessions = n.sessionsPerDay ?? sessionsForHours(n.hoursPerDay)
    const normal = n.captureHoursPerDay ?? n.hoursPerDay * DEFAULT_CAPTURE_SHARE
    const during = Math.max(0, Math.min(normal, n.hoursPerDay - n.craftHoursPerDay - sessions * SESSION_HOURS))
    captureHoursSchedule.push({ day: 1, hours: during }, { day: craftDays, hours: normal })
  }
  return { jobLevelSchedule, captureHoursSchedule }
}

function configFor(n: Norm, s: Setting, timeline: Timeline, params: StrategyParams, g1: G1Plan, days: number, v: Variation = BASE_VARIATION, craftDays = 0): ProductionConfig {
  const sched = levelingSchedules(n, timeline, craftDays)
  return {
    family: s.mf.family,
    mode: s.mf.mode,
    ...params,
    paddocks: timeline.initialPaddocks,
    paddockSchedule: timeline.schedule,
    jobLevelSchedule: sched.jobLevelSchedule,
    captureHoursSchedule: sched.captureHoursSchedule,
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
      includeGenetons: v.includeGenetons ?? n.prices.includeGenetons,
      mountSaleFactor: (n.prices.mountSaleFactor ?? DEFAULT_MOUNT_SALE_FACTOR) * (v.mountSaleFactor ?? 1),
      trustMixedMountPrices: n.levers.countMixedMountPrices || n.prices.trustMixedMountPrices === true,
    },
    horizonDays: days,
    buyG1PerDay: g1.perDay,
    initialStock: [...n.initialStock, ...g1.stock],
    durationFactor: v.durationFactor ?? 1,
  }
}

/**
 * G1 achetées : stock de départ pour remplir les enclos ouverts au jour 1 + achats quotidiens SEULEMENT
 * pour les places que les captures ne peuvent pas remplir (besoin de places d'un tirage témoin aux
 * captures illimitées − capacité de capture du jour) ; le plus souvent 0 : le stock de départ suffit.
 */
function g1PlanFor(n: Norm, s: Setting, params: StrategyParams, craftDays = 0): G1Plan {
  const cfg = configFor(n, s, s.timeline, params, NO_G1, n.horizon, BASE_VARIATION, craftDays)
  const info = productionPlan(cfg)
  const norm = normalizeProductionConfig(cfg)
  // Places à remplir par des achats : celles que vos montures de la famille n'occupent pas déjà.
  const owned = n.initialStock.filter((l) => getSpecies(l.speciesId)?.family === s.mf.family).reduce((t, l) => t + l.count, 0)
  const slots = Math.max(0, s.timeline.initialPaddocks * norm.slotsPerPaddock - owned)
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
  // Besoin de places par jour (captures illimitées) face à la capacité de capture du jour (tirage normal).
  const unlimited = simulateProduction({ ...cfg, initialStock: stock, captureRate: 1e5, captureHoursPerDay: 1, captureHoursSchedule: [] }, n.seed)
  const normal = simulateProduction({ ...cfg, initialStock: stock }, n.seed)
  let short = 0
  let count = 0
  for (let i = 1; i < unlimited.days.length; i++) {
    short += Math.max(0, unlimited.days[i].captures - (normal.days[i]?.captureCapacity ?? 0))
    count += 1
  }
  const perDay = count ? Math.max(0, Math.ceil(short / count - 1e-9)) : 0
  const book = productionPriceBook(norm)
  const caps = info.captureShares.map((x) => book.mountSale(x.speciesId).perDayCap)
  const perDayCap = caps.length && caps.every((c) => c !== null) ? caps.reduce((a, c) => a + (c ?? 0), 0) : null
  return { stock, perDay, perDayCap }
}

/** Variante qui décale les lots ou les crafts (les tirages ne suivent plus ceux de la référence). */
function changesChronology(v: Variation): boolean {
  return (v.durationFactor !== undefined && v.durationFactor !== 1) || (v.craftFactor !== undefined && v.craftFactor !== 1)
}

function evaluate(n: Norm, s: Setting, params: StrategyParams, g1: G1Plan, days: number, runs: number, v: Variation = BASE_VARIATION): InvestmentEvaluation {
  const craftsPerDay = Math.max(1, Math.floor((n.craftsPerDay * (v.craftFactor ?? 1)) / (v.durationFactor ?? 1)))
  const timeline =
    (v.durationFactor && v.durationFactor !== 1) || (v.craftFactor && v.craftFactor !== 1)
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
  const craftDays = s.leveling ? craftDaysFor(s.leveling.crafts, craftsPerDay) : 0
  const cfg = configFor(n, s, timeline, params, g1, days, v, craftDays)
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
  const steadyBand = bandOf(summary.steady.netPerDay, summary.runs)
  const hDay = summary.daily[Math.min(H, summary.daily.length) - 1]
  const profitSe = summary.runs > 1 && hDay ? hDay.cumulative.sd / Math.sqrt(summary.runs) : 0
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
    steadyNetP10: steadyBand.low,
    steadyNetP90: steadyBand.high,
    runs: summary.runs,
    bandLabel: cash.bandLabel,
    profitSe,
    stable: summary.steady.stable,
    speculative: summary.speculative,
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
          craftDays,
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

/** Tri des candidats : dans le budget d'abord, puis bénéfice à l'horizon, puis point mort le plus tôt. */
function better(a: InvestmentEvaluation, b: InvestmentEvaluation): number {
  if (a.feasible !== b.feasible) return a.feasible ? -1 : 1
  // Un coût non chiffré rend le bénéfice incertain (borne haute) : ces plans passent après les autres.
  const ca = a.profitStatus === 'exact' || a.profitStatus === 'borne-basse'
  const cb = b.profitStatus === 'exact' || b.profitStatus === 'borne-basse'
  if (ca !== cb) return ca ? -1 : 1
  if (Math.abs(b.profitAtHorizon - a.profitAtHorizon) > 1) return b.profitAtHorizon - a.profitAtHorizon
  return (a.breakEvenDay ?? Infinity) - (b.breakEvenDay ?? Infinity)
}

/**
 * Bénéfices à égalité : écart sous 5 % du meilleur, ou sous 2 erreurs types combinées des tirages
 * (le hasard des naissances ne doit pas faire engager plus de trésorerie).
 */
export function profitTie(a: Pick<InvestmentEvaluation, 'profitAtHorizon' | 'profitSe'>, b: Pick<InvestmentEvaluation, 'profitAtHorizon' | 'profitSe'>): boolean {
  const gap = Math.abs(a.profitAtHorizon - b.profitAtHorizon)
  const top = Math.max(Math.abs(a.profitAtHorizon), Math.abs(b.profitAtHorizon))
  return gap <= Math.max(PROFIT_TIE_SHARE * top, 2 * Math.sqrt(a.profitSe ** 2 + b.profitSe ** 2))
}

/**
 * Plan recommandé parmi des évaluations classées par `better` : le premier, sauf si un autre lui est à
 * égalité de bénéfice (`profitTie`, même catégorie : dans le budget, coûts chiffrés) — alors celui qui
 * engage le moins de trésorerie, puis le point mort le plus tôt.
 */
export function pickRecommended<T extends { eval: InvestmentEvaluation }>(ranked: readonly T[]): T | null {
  const top = ranked[0]
  if (!top) return null
  const known = (e: InvestmentEvaluation) => e.profitStatus === 'exact' || e.profitStatus === 'borne-basse'
  const tied = ranked.filter((x) => x.eval.feasible === top.eval.feasible && known(x.eval) === known(top.eval) && profitTie(x.eval, top.eval))
  tied.sort((a, b) => a.eval.peakOutlay - b.eval.peakOutlay || (a.eval.breakEvenDay ?? Infinity) - (b.eval.breakEvenDay ?? Infinity) || b.eval.profitAtHorizon - a.eval.profitAtHorizon)
  return tied[0] ?? top
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
  /** Niveaux visés écartés faute de prix (coût de la montée inconnu) : ingrédients sans prix. */
  const unpriced: { level: number; missing: number }[] = []
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
      if (n.levers.levelJob) unpriced.push({ level: t, missing: lv.missing.length })
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
    const probe = simulateProduction(configFor(n, probeSetting, t0, defaultParams(mf.mode, tiers), NO_G1, n.simDays, BASE_VARIATION, leveling ? craftDaysFor(leveling.crafts, n.craftsPerDay) : 0), n.seed)
    evaluated += 1
    const naturalXp = [0, ...probe.days.map((d) => d.jobXp)]
    const setting: Setting = { ...probeSetting, naturalXp, timeline: jobTimeline({ ...craftOnly, naturalXp }) }
    settings.set(key, setting)
    return setting
  }

  const all: Scored[] = []
  // Mode « auto » : une vente de montures chiffrée au prix « HDV mixte » (sans prix du joueur) est
  // spéculative — jamais retenue ni préférée tant qu'un autre plan existe (levier `countMixedMountPrices`).
  const excludeSpeculative = n.modeId === 'auto' && !n.levers.countMixedMountPrices
  const eligible = (e: InvestmentEvaluation) => !(excludeSpeculative && e.speculative)
  const craftDaysOf = (s: Setting) => (s.leveling ? craftDaysFor(s.leveling.crafts, n.craftsPerDay) : 0)
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
          const v = (sc.eval.feasible ? sc.eval.profitAtHorizon : sc.eval.profitAtHorizon - 1e15) - (eligible(sc.eval) ? 0 : 1e16)
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
          const g1 = g1PlanFor(n, s, top.cand.params, craftDaysOf(s))
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
  const pool = [...bestBySetting.values(), ...g1BySetting.values()].sort((a, b) => Number(!eligible(a.eval)) - Number(!eligible(b.eval)) || better(a.eval, b.eval))
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
  const ranked = [...finals.entries()].sort((a, b) => Number(!eligible(a[1])) - Number(!eligible(b[1])) || better(a[1], b[1]))
  const feasibleAll = ranked.filter(([, e]) => e.feasible)
  // Spéculatif : écarté du choix s'il reste un plan fiable dans le budget.
  const feasibleRanked = feasibleAll.some(([, e]) => eligible(e)) ? feasibleAll.filter(([, e]) => eligible(e)) : feasibleAll
  // Budget minimum utile : plan rentable sur l'horizon le moins gourmand (évaluation finale).
  const profitableAll = [...finals.values()].filter((e) => e.profitAtHorizon > 0)
  const profitable = (profitableAll.some(eligible) ? profitableAll.filter(eligible) : profitableAll).map((e) => e.peakOutlay)
  const minOutlay = profitable.length ? Math.min(...profitable) : null
  const minimumBudget = minOutlay === null ? null : roundUp(minOutlay * 1.05 + n.reserve, 100_000)
  let chosenKey: string
  let feasible = true
  if (feasibleRanked.length) {
    // Bénéfices à égalité (5 % ou bruit des tirages) : le plan qui engage le moins de trésorerie.
    const rec = pickRecommended(feasibleRanked.map(([key, e]) => ({ key, eval: e })))
    chosenKey = (rec ?? { key: feasibleRanked[0][0] }).key
  } else {
    feasible = false
    // Hors budget : le plan rentable le moins gourmand (référence pour le budget minimum).
    const byOutlay = [...finals.entries()].filter(([, e]) => e.profitAtHorizon > 0).sort((a, b) => Number(!eligible(a[1])) - Number(!eligible(b[1])) || a[1].peakOutlay - b[1].peakOutlay)
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
      speculative: e.speculative,
    })
  }
  pushAlt(
    'retenu',
    chosenKey,
    feasible ? 'Recommandé' : 'Plan minimal',
    feasible
      ? 'Le meilleur bénéfice sur l’horizon dans le budget ; à bénéfice comparable (écart sous 5 % ou dans le bruit des tirages), celui qui engage le moins de trésorerie, puis le point mort le plus tôt.'
      : 'Le plan rentable le moins gourmand (hors budget).',
  )
  for (const nm of named) {
    const l = NAMED_LABELS[nm.id]
    pushAlt(nm.id, nm.cand.key, nm.id === 'autre-mode' ? `Autre mode : ${nm.cand.setting.mf.label}` : l.label, l.description)
  }
  for (const [key] of ranked) if (alternatives.length < 4) pushAlt('variante', key, 'Variante', 'Autre allocation proche du meilleur bénéfice.')

  // Sensibilité.
  const sensitivity: SensitivityRow[] = []
  let worstCase: WorstCase | null = null
  if (n.sensitivity) {
    label.value = 'Sensibilité'
    const variations: Variation[] = [
      { id: 'prix-bas', label: 'Prix de vente −20 %', revenueFactor: 0.8 },
      { id: 'prix-haut', label: 'Prix de vente +20 %', revenueFactor: 1.2 },
      { id: 'couts', label: 'Coûts +20 % (ingrédients, carburant, montures)', costFactor: 1.2 },
      { id: 'duree', label: 'Durées réelles × 1,5 (lots et crafts)', durationFactor: 1.5 },
      { id: 'liquidite', label: 'Liquidité ÷ 2 (part du volume vendable)', shareFactor: 0.5 },
    ]
    if (plan.summary.totals.genetons > 0) variations.push({ id: 'sans-genetons', label: 'Sans génétons (valeur estimée, liés au compte)', includeGenetons: false })
    if (plan.summary.steady.revenueByCategory.montures > 0 || plan.summary.totals.mountsSold > 0)
      variations.push({ id: 'prix-montures', label: 'Prix des montures −50 % (« HDV mixte »)', mountSaleFactor: 0.5 })
    if (plan.leveling && plan.leveling.crafts > 0) variations.push({ id: 'crafts', label: 'Crafts deux fois plus lents (montée du métier)', craftFactor: 0.5 })
    if (plan.leveling?.resale && plan.leveling.resale.total > 0) variations.push({ id: 'sans-revente', label: 'Sans revente des objets fabriqués', resale: false })
    // Pire scénario : le plus bas de ces scénarios défavorables (courbe affichée à côté du plan).
    const WORST_IDS = new Set(['prix-bas', 'duree', 'liquidite', 'sans-genetons', 'prix-montures'])
    // Mêmes graines pour la référence et les variantes : l'écart vient de la variante, pas du hasard.
    let refProfit = plan.profitAtHorizon
    let refEval: InvestmentEvaluation | null = null
    for (const v of [{ ...BASE_VARIATION, id: 'reference', label: `Référence (mêmes ${SENSITIVITY_RUNS} tirages)` }, ...variations]) {
      try {
        const e = evaluate(n, chosenCand.setting, chosenCand.params, chosenCand.g1, n.simDays, SENSITIVITY_RUNS, v)
        evaluated += SENSITIVITY_RUNS
        if (v.id === 'reference') {
          refProfit = e.profitAtHorizon
          refEval = e
        }
        if (WORST_IDS.has(v.id) && (!worstCase || e.profitAtHorizon < worstCase.profitAtHorizon))
          worstCase = {
            id: v.id,
            label: v.label,
            cumulative: e.cashflow.map((pt) => pt.cumulative),
            profitAtHorizon: e.profitAtHorizon,
            at60: e.cashflow.length > 60 ? e.cashflow[60].cumulative : null,
            breakEvenDay: e.breakEvenDay,
            breakEvenEstimated: e.breakEvenEstimated,
            runs: SENSITIVITY_RUNS,
          }
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
          // Mêmes graines : un scénario de prix, de coûts ou de liquidité garde la chronologie de la référence
          // (écart = effet du scénario) ; durées ou crafts décalent les lots, et les tirages ne se correspondent
          // plus : l'écart se compare alors au bruit des tirages.
          withinNoise: v.id !== 'reference' && refEval !== null && changesChronology(v) && profitTie(refEval, e),
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
    worstCase,
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
  else if (result.unusedBudget > Math.max(1_000_000, 0.2 * n.available)) {
    // Montée du métier écartée faute de prix : on ne sait pas si le budget restant améliorerait le bénéfice
    // (revue UX2-09 : « n'améliore pas » contredisait « Niveau 40 écarté : ingrédients sans prix »).
    if (unpriced.length) {
      const most = Math.max(...unpriced.map((u) => u.missing))
      const text = `Montée du métier non chiffrée (niveaux ${unpriced.map((u) => u.level).join(', ')} : jusqu’à ${most} ingrédient${most > 1 ? 's' : ''} sans prix) : l’usage des ${fmtK(result.unusedBudget)} restants est inconnu — importez l’export HDV de ${market?.serverName ?? 'votre serveur'} (Prix › Marché HDV) pour chiffrer la montée du métier.`
      result.notes.push(text)
      result.risks.unshift({ code: 'prix-manquants-metier', tone: 'warn', text })
    } else
      result.notes.push(
        `${fmtK(result.unusedBudget)} du budget restent disponibles : les investir n’améliore pas le bénéfice sur ${n.horizon} jours (limites : enclos et niveau du métier, temps de jeu, volume du marché).`,
      )
  }
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

/** Ingrédients d'une recette pour `qty` objets fabriqués (prix et origine de chaque ingrédient). */
function craftIngredients(id: number, qty: number, ctx: PriceContext): { level: number; ingredients: NonNullable<ShoppingItem['ingredients']> } | null {
  const recipe = getRecipe(id)
  if (!recipe || !recipe.ingredients.length) return null
  return {
    level: recipe.level,
    ingredients: recipe.ingredients.map((ing) => {
      const p = resolvePrice(ing.id, ctx)
      return { id: ing.id, name: itemName(ing.id), qty: ing.qty * qty, unitPrice: p.price, origin: p.origin }
    }),
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
      const craft = rp.origin === 'craft' ? craftIngredients(id, qty, { ...n.ctx, jobLevel: plan.allocation.jobTo }) : null
      const hdv = craft ? marketPrice(id, n.ctx) : null
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
        note: `Socle de ${plan.initialPaddocks} enclos (palier ${plan.allocation.tier}) : reste dans les jauges.${
          craft
            ? ` À fabriquer (recette niv. ${craft.level}${craft.level > plan.allocation.jobFrom ? `, après la montée du métier — sinon à l’HDV${hdv?.price !== null && hdv?.price !== undefined ? ` ≈ ${fmtK(hdv.price)} l’unité` : ''}` : ''}) : ingrédients ci-dessous.`
            : ''
        }`,
        ...(craft ? { ingredients: craft.ingredients, craftLevel: craft.level } : {}),
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
      note: 'Trésorerie maximale engagée après le jour 0 (bas de la bande des tirages).',
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
  // Jalons du métier : les enclos ouverts le même jour forment une seule action (le socle de ce jour-là
  // n'est compté qu'une fois).
  const enclosByDay = new Map<number, LevelDay[]>()
  for (const ld of plan.levelDays) if (ld.kind === 'enclos') enclosByDay.set(ld.day, [...(enclosByDay.get(ld.day) ?? []), ld])
  for (const [day, lds] of enclosByDay) {
    const usable = day + 1
    const socleDay = plan.socle.filter((x) => x.day === usable).reduce((t, x) => t + x.amount, 0)
    const levels = lds.map((l) => l.level)
    const pads = lds.map((l) => `${l.paddocks}e`)
    const and = (xs: (string | number)[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} et ${xs[xs.length - 1]}` : String(xs[0]))
    const sources = new Set(lds.map((l) => l.source))
    out.push({
      day,
      kind: 'enclos',
      title: `Niveau${levels.length > 1 ? 'x' : ''} ${and(levels)} atteint${levels.length > 1 ? 's' : ''} → ${and(pads)} enclos (utilisable${pads.length > 1 ? 's' : ''} dès le jour ${usable})`,
      details: [
        sources.size > 1 ? 'Grâce aux crafts de la montée du métier et à l’XP d’élevage.' : sources.has('craft') ? 'Grâce aux crafts de la montée du métier.' : 'Grâce à l’XP d’élevage (captures, accouplements).',
        ...(socleDay > 0 ? [`Remplir ${lds.length > 1 ? 'leur' : 'son'} socle (palier ${a.tier}) : ≈ ${fmtK(socleDay)}.`] : []),
      ],
      kamas: socleDay > 0 ? -socleDay : null,
    })
  }
  for (const ld of plan.levelDays) {
    if (ld.kind === 'enclos') continue
    if (ld.source === 'elevage' && ld.kind !== 'carburant')
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
  // Capacité de la semaine 1 (filet et temps de capture du moment : montée du métier, jours de craft).
  const capacityFirst = first.length ? first.reduce((t, x) => t + x.captureCapacity, 0) / first.length : s.captureCapacityPerDay
  out.push({
    day: 1,
    kind: 'production',
    title: `Lancer l’élevage : ${a.modeLabel}, ${plan.initialPaddocks} enclos au départ`,
    details: [
      `Stratégie : ${a.strategyLabel}.`,
      `Semaine 1 : ≈ ${fmtN(capFirst, 1)} captures/jour (capacité ≈ ${fmtN(capacityFirst, 0)}/jour) pour remplir les enclos ; lots de ${PADDOCK_SLOTS} montures au palier ${a.tier}.`,
      ...(s.plan.captureShares.length ? [`Couleurs à capturer : ${s.plan.captureShares.map((c) => `${speciesName(c.speciesId)} ${Math.round(c.share * 100)} %`).join(', ')}.`] : []),
    ],
    kamas: null,
  })
  if (a.g1PerDay > 0 && s.totals.bought > 0)
    out.push({
      day: 1,
      toDay: plan.simDays,
      kind: 'achat',
      title: `Acheter jusqu’à ${fmtN(a.g1PerDay, a.g1PerDay < 10 ? 1 : 0)} G1 par jour à l’HDV (≈ ${fmtN(s.totals.bought / plan.simDays, 1)}/jour en moyenne)`,
      details: [
        'Capturez d’abord : n’achetez que pour les places libres que les captures du passage ne remplissent pas, au plus la part du volume quotidien des objets-montures.',
        `Régime permanent : ≈ ${fmtN(s.steady.boughtPerDay, 1)} G1/jour, ≈ ${fmtK(s.steady.costByCategory.achat)}/jour.`,
      ],
      kamas: null,
    })
  const ftd = s.firstTargetDay ? Math.max(1, Math.round(s.firstTargetDay.mean)) : null
  if (ftd !== null && a.mode !== 'brisage')
  {
    const fb = s.firstTargetDay ? bandOf(s.firstTargetDay, plan.runs) : null
    const lo = Math.round(fb?.low ?? ftd)
    const hi = Math.round(fb?.high ?? ftd)
    out.push({ day: ftd, kind: 'jalon', title: `Premier bébé G${s.plan.targetGeneration} (génération visée)`, details: [lo !== hi ? `Moyenne des tirages (${plan.runs >= 10 ? '8 sur 10' : `${plan.runs} tirages`} entre le jour ${lo} et le jour ${hi}).` : 'Moyenne des tirages.'], kamas: null })
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
      details: [plan.runs >= 10 ? `8 tirages sur 10 au-dessus de ${fmtK(h.cumulativeLow)}.` : `Entre ${fmtK(h.cumulativeLow)} et ${fmtK(h.cumulativeHigh)} selon les tirages (${plan.bandLabel}).`],
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
    const when = `Prix de l’${marketWhere(market)}`
    if (age !== null && age > MARKET_OLD_DAYS)
      out.push({ code: 'prix-dates', tone: 'danger', text: `${when} (il y a ${age} jours) : prix périmés (plus de ${MARKET_OLD_DAYS} jours) — le plan, le point mort et le bénéfice par jour peuvent être faux. Réimportez un export récent avant d’investir.` })
    else if (age !== null && age > MARKET_STALE_DAYS) out.push({ code: 'prix-dates', tone: 'warn', text: `${when} (il y a ${age} jours) : les prix ont pu changer, réimportez un export récent.` })
    else out.push({ code: 'prix-dates', tone: 'info', text: `${when}${age !== null ? ` (${age === 0 ? 'aujourd’hui' : `il y a ${age} jour${age > 1 ? 's' : ''}`})` : ''} : un plan sur ${n.horizon} jours suppose des prix stables.` })
  }
  if (market) {
    const origin = marketOriginMismatch(market)
    if (origin) out.push({ code: 'prix-autre-serveur', tone: 'warn', text: `Prix de l’HDV de ${origin} chargés pour ${market.serverName} : chaque serveur a son économie, importez l’export de votre serveur.` })
    if (market.volumeUnknown) out.push({ code: 'liquidite-inconnue', tone: 'warn', text: 'Export HDV sans colonnes de ventes (vendus_24h/7j/30j) : liquidité inconnue, les ventes ne sont pas plafonnées par le volume du serveur.' })
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
  if (plan.speculative)
    out.push({
      code: 'speculatif',
      tone: 'danger',
      text: `Projection spéculative : les montures vendues sont chiffrées au prix « HDV mixte » de leur objet (niveaux, états et séniles mélangés), pas au prix d’un bébé niveau 1 fécond. Saisissez ce prix (page Prix) avant d’engager le budget${n.modeId === 'auto' ? '' : ' ; le mode automatique ne retient jamais ce plan'}.`,
    })
  if (s.totals.bought > 0 || a.g1Stock > 0) out.push({ code: 'senile', tone: 'warn', text: 'Montures achetées à l’HDV : vérifiez qu’elles ne sont pas séniles (d’avant la 3.5 : ni accouplement ni clonage).' })
  // Génétons : rapportés au bénéfice net (ce qui disparaîtrait si leur valeur s'effondrait).
  const gShare = s.steady.genetonShareOfNet
  if (gShare !== null && gShare > 0.2) {
    const sans = sensitivity.find((x) => x.id === 'sans-genetons')
    out.push({
      code: 'genetons',
      tone: gShare > 0.4 ? 'warn' : 'info',
      text: `Les génétons font ${fmtN(gShare * 100)} % du bénéfice net par jour en régime permanent (valeur estimée d’après les Puissants Parchemins d’Eugène Éton, liés au compte : revente des parchemins)${sans ? ` ; sans eux : ${fmtK(sans.profitAtHorizon)} à ${n.horizon} jours` : ''}.`,
    })
  }
  if (!plan.stable)
    out.push({
      code: 'non-stabilise',
      tone: 'warn',
      text: `Régime non stabilisé à la fin des ${plan.simDays} jours simulés : ${s.steady.instability.join(' ; ')}. Le bénéfice par jour affiché n’est pas celui du long terme.`,
    })
  // Temps de jeu.
  const slow = sensitivity.find((x) => x.id === 'duree')
  out.push({
    code: 'temps',
    tone: 'info',
    text: `Joueur parfait supposé (${fmtN(n.hoursPerDay, 1)} h/jour, ${s.sessionsPerDay} passages aux enclos, aucune session manquée)${slow ? ` ; avec des durées × 1,5 : ${fmtK(slow.profitAtHorizon)} à ${n.horizon} jours${slow.breakEvenDay !== null ? `, point mort jour ${slow.breakEvenDay}${slow.breakEvenEstimated ? ' (extrapolé)' : ''}` : ''}` : ''}.`,
  })
  if (!plan.complete) out.push({ code: 'prix-manquants', tone: 'warn', text: `${plan.missing.length} prix manquant(s) : montants « ≥ » / « ≤ », jamais comptés 0. Renseignez-les (page Prix).` })
  for (const w of s.warnings)
    if (['etable', 'etable-saturee', 'cible-non-atteinte', 'liquidite-inconnue', 'achat-limite', 'volume-achat'].includes(w.code) && !out.some((o) => o.text === w.text)) out.push({ code: w.code, tone: w.tone, text: w.text })
  return out
}

function assumptionsOf(plan: InvestmentEvaluation, n: Norm): string[] {
  const out = [
    `Crafts : ${fmtN(n.craftsPerHour)} par heure (ESTIMATION : fabrication en série et achats des ingrédients compris), ${fmtN(n.craftHoursPerDay, 1)} h de craft par jour pendant la montée du métier, soit ${fmtN(n.craftsPerDay)} crafts/jour ; les crafts commencent le jour 0.`,
    `Pendant les jours de craft, le temps de capture est ce qui reste du temps de jeu après les crafts et les passages aux enclos (${fmtN(SESSION_HOURS * 60)} min par passage, ESTIMATION).`,
    'Un niveau d’Éleveur atteint en fin de journée débloque son enclos et son filet le lendemain ; l’XP d’élevage (captures, accouplements) d’un tirage témoin fait aussi monter le niveau.',
    `Filet du jour selon le niveau atteint ; prix de craft (carburants, makinas) du niveau visé (${plan.allocation.jobTo}) dès le jour 1 : le métier monte en quelques jours.`,
    'Socle des jauges (paliers ≥ 2) acheté à l’ouverture de chaque enclos et compté dans l’investissement à rembourser (il reste dans les jauges).',
    `Trésorerie maximale engagée lue sur le bas de la bande des tirages (${plan.bandLabel} : prudent), dépenses de chaque jour payées avant ses ventes ; le budget n’est jamais dépassé : jour 0 + fonds de roulement ≤ budget − réserve.`,
    `Projections : ${plan.simDays} jours simulés ; régime permanent = moyenne du dernier tiers.`,
  ]
  if (n.levers.resellCrafts && plan.leveling) out.push(`Objets fabriqués revendus à partir du lendemain, au plus ${Math.round(n.share * 100)} % des ventes quotidiennes moyennes de chaque objet, taxe ${fmtN(n.saleTax * 100, 1)} % déduite.`)
  if (!n.levers.buyFuels) out.push('Carburants fabriqués seulement : coût des ingrédients ; temps de craft et XP de ces crafts non comptés.')
  if (!n.levers.buyGear) out.push('Filets et makinas fabriqués seulement : une Optimakina hors de portée du métier n’est pas utilisée.')
  const owned = n.initialStock.filter((l) => getSpecies(l.speciesId)?.family === plan.allocation.family).reduce((t, l) => t + l.count, 0)
  out.push(
    n.initialStock.length
      ? `Étable actuelle prise en compte : ${fmtN(owned)} monture${owned > 1 ? 's' : ''} de la famille du plan (${FAMILIES[plan.allocation.family]?.plural ?? plan.allocation.family}) au départ, avec leur génération, leur état et leur niveau.`
      : 'Étable actuelle non prise en compte : le plan part d’un élevage vide (premières ventes et point mort plus tôt si vous avez déjà des montures).',
  )
  return [...out, ...plan.summary.assumptions]
}

/** Trésorerie engagée sous laquelle un ROI en % n'a pas de sens (« non significatif »). */
export const ROI_MIN_OUTLAY = 500_000

/**
 * ROI affichable (revue UX2-09) : faux si la trésorerie engagée est infime face au budget (< 1 % du budget
 * ou < 500 000 K) — « ROI 10 546 % » sur ≈ 93 k engagés ne dit rien du budget.
 */
export function roiIsSignificant(peakOutlay: number, budget: number): boolean {
  return peakOutlay >= ROI_MIN_OUTLAY && peakOutlay >= 0.01 * budget
}

/** Texte de la liste de courses (copier-coller : « Nom × quantité »). */
export function investmentShoppingText(items: ShoppingItem[]): string {
  return items
    .filter((i) => i.qty !== null && i.id !== null)
    .map((i) =>
      i.ingredients?.length
        ? `${i.name} × ${i.qty} (à fabriquer : ${i.ingredients.map((g) => `${g.name} × ${formatNumber(Math.ceil(g.qty - 1e-9))}`).join(', ')})`
        : `${i.name} × ${i.qty}`,
    )
    .join('\n')
}

/** Libellé d'un mode d'investissement. */
export function investmentModeLabel(id: ProfitModeId): string {
  return id === 'auto' ? 'Automatique (le plus rentable)' : (profitMode(id)?.label ?? id)
}

/** Niveaux d'enclos (pour les pages). */
export const PADDOCK_LEVELS = PADDOCK_UNLOCK_LEVELS.map((p) => p.level)
