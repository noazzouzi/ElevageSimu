// Moteur de production en continu (docs/SPEC-v2.md §4) : simulation jour par jour (session par session)
// d'un élevage qui tourne pendant N jours, valorisation aux prix du serveur (marché HDV importé) avec
// la liquidité du marché, optimiseur de stratégie par mode et comparaison des modes de rentabilité.
//
// Modèle (hypothèses explicites, docs/api/production.md) :
// - enclos = lots : un enclos libre reçoit un lot (≤ 10 montures) à une session ; le lot occupe ses
//   places pendant la durée du lot TYPIQUE du planificateur (`batchProfile('typique')`, economy.ts) au
//   palier choisi, + l'XP au-delà de ce que la Mangeoire en 2e jauge donne pendant la phase d'amour,
//   arrondie au nombre de sessions (on ne pose et ne retire une monture qu'en passant aux enclos) ;
//   le carburant d'un lot ne dépend pas du nombre de montures (research §2.3) ;
// - sessions régulièrement espacées (`sessionsPerDay`, déduites du temps de jeu comme le Plan) ;
//   ordre d'une session (strategy.md règle 13) : accoupler → cloner → sortir (extraire, vendre, briser)
//   → acheter/capturer → mettre en enclos ;
// - naissances : modèle validé `breed()` avec les arbres réels (parents des parents), sexes 50/50 ;
// - captures limitées par le temps de capture (personnages × montures par lancer × combats/heure) et
//   par les places libres ; recette = la moins chère en captures (`cheapestRecipe`) ;
// - ventes plafonnées par la liquidité du marché (part du volume quotidien moyen, 15 % par défaut),
//   stock invendu reporté ; prix d'objets-montures = « HDV mixte » → prix prudent ;
// - un prix inconnu n'est jamais compté 0 : montants en intervalle (`Range`) et statut.
//
// Module pur : aucun React, aucun store, aucun Math.random (mulberry32 à graine, comme programSim).
import { FAMILIES, getSpecies, speciesOfFamily } from '../data'
import { cheapestRecipe, cleanParent, minCaptures, requiredSpecies } from './breedingPath'
import { MAX_PADDOCKS, PADDOCK_SLOTS, TICK_SECONDS } from './constants'
import {
  batchProfile,
  BRISAGE_RISK_NOTE,
  BRISAGE_RUNE,
  brisageValue,
  captureCost,
  decideOptimakina,
  DEFAULT_MOUNTS_PER_CAST,
  FERTILITY_GAUGES,
  gaugePointCost,
  genetonKamasValue,
  makinaCost,
  mountSalePrice,
  socleInvestment,
  xpOverlapPoints,
  type BatchProfile,
  type InitialInvestment,
  type MountPriceContext,
  type NetKind,
  type ProfitStatus,
  type Range,
} from './economy'
import { bestFuel } from './fuel'
import { breed, targetChance } from './genetics'
import { AUTO_MIN_SOLD_24H, DEFAULT_MAX_MARKET_SHARE, genetonValueFromMarket, marketDepth, MOUNT_MARKET_NOTE, TUPLE, type MarketDepth } from './market'
import { marketPrice, type PriceContext } from './pricing'
import { distStat, mulberry32, runSeed, type DistStat } from './programSim'
import { RULESETS, type Ruleset } from './rules'
import type { FamilyId, FuelTier, GaugeId, Species } from './types'
import { mountXpForLevel } from './xp'

// ---------- Modes de rentabilité ----------

/** Mode de production simulé : sortie des montures produites. */
export type ProductionMode = 'extraction' | 'brisage' | 'vente' | 'progression'

export const PRODUCTION_MODE_LABELS: Record<ProductionMode, string> = {
  extraction: 'Extraction',
  brisage: 'Brisage',
  vente: 'Vente de montures',
  progression: 'Progression',
}

/** Modes de rentabilité du profil (SPEC-v2 §4). */
export type ProfitModeId = 'rush-corne' | 'rush-ambre' | 'rush-neurone' | 'brisage-pa' | 'brisage-pm' | 'vente-montures' | 'progression' | 'auto'

export interface ProfitModeDef {
  id: ProfitModeId
  label: string
  /** Libellé court (tableaux). */
  short: string
  /** Mode simulé (null : `auto`, choix du meilleur). */
  mode: ProductionMode | null
  /** Familles évaluées (une pour les rushs et le brisage, les trois pour la vente). */
  families: FamilyId[]
  /** Objet produit (ressource d'extraction ou rune Ga), null sinon. */
  itemId: number | null
  objective: string
  revenue: string
  risk?: string
}

export const PROFIT_MODES: ProfitModeDef[] = [
  {
    id: 'rush-corne',
    label: 'Rush Volkorne (Cornes)',
    short: 'Rush Corne',
    mode: 'extraction',
    families: ['volkorne'],
    itemId: FAMILIES.volkorne.extractionItemId,
    objective: 'Produire le plus de Volkornes possible et les extraire en Cornes de volkorne.',
    revenue: 'Extraction (génération × Corne de volkorne)',
  },
  {
    id: 'rush-ambre',
    label: 'Rush Muldo (Ambres)',
    short: 'Rush Ambre',
    mode: 'extraction',
    families: ['muldo'],
    itemId: FAMILIES.muldo.extractionItemId,
    objective: 'Produire le plus de Muldos possible et les extraire en Ambres de muldo.',
    revenue: 'Extraction (génération × Ambre de muldo)',
  },
  {
    id: 'rush-neurone',
    label: 'Rush Dragodinde (Neurones)',
    short: 'Rush Neurone',
    mode: 'extraction',
    families: ['dragodinde'],
    itemId: FAMILIES.dragodinde.extractionItemId,
    objective: 'Produire le plus de Dragodindes possible et les extraire en Neurones de dragodinde.',
    revenue: 'Extraction (génération × Neurone de dragodinde)',
  },
  {
    id: 'brisage-pa',
    label: 'Brisage Volkorne (Ga Pa)',
    short: 'Brisage PA',
    mode: 'brisage',
    families: ['volkorne'],
    itemId: BRISAGE_RUNE.volkorne,
    objective: 'Capturer des Volkornes, les monter au niveau optimal et les briser (runes Ga Pa).',
    revenue: 'Runes de brisage',
    risk: BRISAGE_RISK_NOTE,
  },
  {
    id: 'brisage-pm',
    label: 'Brisage Muldo (Ga Pme)',
    short: 'Brisage PM',
    mode: 'brisage',
    families: ['muldo'],
    itemId: BRISAGE_RUNE.muldo,
    objective: 'Capturer des Muldos, les monter au niveau optimal et les briser (runes Ga Pme).',
    revenue: 'Runes de brisage',
    risk: BRISAGE_RISK_NOTE,
  },
  {
    id: 'vente-montures',
    label: 'Vente de montures',
    short: 'Vente',
    mode: 'vente',
    families: ['dragodinde', 'muldo', 'volkorne'],
    itemId: null,
    objective: 'Produire les montures que le marché de ce serveur paie le mieux, dans la limite de son volume.',
    revenue: 'Ventes (prix prudent « HDV mixte », plafonnées par le volume)',
    risk: MOUNT_MARKET_NOTE,
  },
  {
    id: 'progression',
    label: 'Progression',
    short: 'Progression',
    mode: 'progression',
    families: ['dragodinde', 'muldo', 'volkorne'],
    itemId: null,
    objective: 'Objectif de génération ou de succès (comportement actuel) : les montures visées sont gardées.',
    revenue: 'Génétons, progression',
  },
  {
    id: 'auto',
    label: 'Automatique',
    short: 'Auto',
    mode: null,
    families: ['dragodinde', 'muldo', 'volkorne'],
    itemId: null,
    objective: 'Le mode le plus rentable par jour pour ce profil (prix et liquidité du serveur).',
    revenue: '—',
  },
]

export function profitMode(id: ProfitModeId): ProfitModeDef | undefined {
  return PROFIT_MODES.find((m) => m.id === id)
}

/** Modes comparés sur la page « Modes de rentabilité ». */
export const COMPARED_MODES: ProfitModeId[] = ['rush-corne', 'rush-ambre', 'rush-neurone', 'brisage-pa', 'brisage-pm', 'vente-montures']

// ---------- Configuration ----------

/** Optimakina : jamais, partout, à partir d'une génération de bébé, ou règle de prix (`decideOptimakina`). */
export type OptimakinaPolicy = 'none' | 'auto' | 'all' | { fromGeneration: number }

/** Clonage des stériles de la chaîne : oui (toutes les générations sous la cible), non, ou jusqu'à une génération. */
export type CloningPolicy = boolean | { maxGeneration: number }

/** Palier de la Mangeoire pendant la fécondation : 'auto' = le moins cher sans allonger le lot d'une session. */
export type XpTierPolicy = FuelTier | 'auto'

export interface PaddockStep {
  /** Jour (1 = premier jour) à partir duquel `paddocks` enclos sont débloqués. */
  day: number
  paddocks: number
}

export interface InitialStockLine {
  speciesId: number
  count: number
  /** État des montures (défaut fertile). */
  state?: 'fertile' | 'feconde' | 'sterile'
  /** Niveau (défaut 1). */
  level?: number
}

/** Prix et marché utilisés pour valoriser la production. */
export interface ProductionPrices {
  /** Contexte de prix (`usePriceContext()` : prix saisis, marché importé du serveur, niveau d'Éleveur). */
  ctx: PriceContext
  /** Prix de montures saisis par le joueur (prioritaires sur le marché pour la vente). */
  mountPrices?: MountPriceContext | null
  /** Taxe d'HDV (défaut 0,02). */
  saleTax?: number
  /** Part du volume quotidien moyen vendable par jour (défaut 0,15 = `ServerEntry.maxMarketShare`). */
  maxMarketShare?: number
  /** Valeur brute d'un généton saisie ; défaut : marché du serveur (boutique d'Eugène Éton), sinon 375 K. */
  genetonValue?: number | null
  /** Compter les génétons dans les revenus (défaut vrai ; valeur signalée « estimation »). */
  includeGenetons?: boolean
  /** Facteur appliqué au prix prudent d'un objet-monture du marché (défaut 0,85 : HDV mixte). */
  mountSaleFactor?: number
  /** Sensibilité : multiplicateur des prix de vente (défaut 1). */
  revenueFactor?: number
  /** Sensibilité : multiplicateur des coûts (défaut 1). */
  costFactor?: number
}

export interface ProductionConfig {
  family: FamilyId
  mode: ProductionMode
  /** Génération extraite / vendue / visée (2 … 10), ou 'auto' (estimation analytique). Ignorée en brisage. */
  targetGeneration?: number | 'auto'
  /** Espèces visées imposées (sinon : la moins chère en captures, ou les mieux payées en vente). */
  targetSpeciesIds?: number[]
  /**
   * Accoupler avant d'extraire (défaut vrai, strategy.md règle 12) : les bébés de la génération visée
   * sont rendus féconds et accouplés entre eux (bébé gratuit), puis extraits. En brisage : accoupler
   * les captures avant de les briser.
   */
  mateBeforeExtract?: boolean
  /** Clonage des stériles de la chaîne (défaut vrai). */
  cloning?: CloningPolicy
  /** Niveau des parents avant accouplement (défaut 40). */
  parentLevel?: number
  /** Niveau de brisage (défaut 53). */
  brisageLevel?: number
  optimakina?: OptimakinaPolicy
  /** Palier des jauges de statistiques (défaut 2). En brisage : palier de la Mangeoire. */
  tier?: FuelTier
  /** Palier de la Mangeoire pendant la fécondation (défaut 'auto'). */
  xpTier?: XpTierPolicy
  /** Enclos débloqués au départ (1 … 6). */
  paddocks: number
  /** Enclos supplémentaires débloqués en cours de route (jalons du métier). */
  paddockSchedule?: PaddockStep[]
  slotsPerPaddock?: number
  /** Passages aux enclos par jour (défaut : d'après `hoursPerDay`, comme le Plan). */
  sessionsPerDay?: number
  /** Temps de jeu par jour (défaut 3 h). */
  hoursPerDay?: number
  /** Heures de capture par jour (défaut : la moitié du temps de jeu). */
  captureHoursPerDay?: number
  /** Personnages qui lancent un filet à chaque combat (défaut 1). */
  characters?: number
  /** Filet (défaut : le meilleur équipable au niveau d'Éleveur). */
  netKind?: NetKind
  mountsPerCast?: number
  /** Combats de capture par heure (défaut 12 : ESTIMATION, 5 min par combat recherche comprise). */
  fightsPerHour?: number
  /** Montures capturées par heure de capture (prioritaire sur personnages × lancer × combats). */
  captureRate?: number
  /** Montures G1 achetées à l'HDV par jour (au lieu de les capturer). */
  buyG1PerDay?: number
  /** Prix d'achat d'une G1 (défaut : prix du marché de l'objet-monture). */
  g1Price?: number | null
  /** Montures possédées au départ. */
  initialStock?: InitialStockLine[]
  /** Niveau d'Éleveur (prix de craft, filet) ; défaut `ctx.jobLevel`, sinon 200. */
  jobLevel?: number
  rules: Ruleset
  prices: ProductionPrices
  /** Durée simulée (jours). */
  horizonDays: number
  /** Montures minimum pour lancer un lot (défaut 6), sauf après 2 sessions d'attente. */
  minBatchFill?: number
  /** Le clone garde son niveau (défaut vrai, comme l'Optimiseur ; inconnu en jeu). */
  cloneKeepsLevel?: boolean
  /** Sensibilité : multiplicateur des durées de lot (défaut 1 ; 1,5 = joueur réel). */
  durationFactor?: number
  kappa?: number
}

export interface NormalizedProductionConfig extends Omit<ProductionConfig, 'targetGeneration' | 'cloning' | 'optimakina' | 'xpTier'> {
  targetGeneration: number
  targetAuto: boolean
  targetSpeciesIds?: number[]
  mateBeforeExtract: boolean
  /** Générations clonées : 0 = aucune. */
  cloneMaxGeneration: number
  cloning: CloningPolicy
  parentLevel: number
  brisageLevel: number
  optimakina: OptimakinaPolicy
  tier: FuelTier
  xpTier: XpTierPolicy
  paddocks: number
  paddockSchedule: PaddockStep[]
  slotsPerPaddock: number
  sessionsPerDay: number
  hoursPerDay: number
  captureHoursPerDay: number
  characters: number
  netKind: NetKind
  mountsPerCast: number
  fightsPerHour: number
  /** Montures capturées par heure (résolu). */
  captureRate: number
  buyG1PerDay: number
  g1Price: number | null
  initialStock: InitialStockLine[]
  jobLevel: number
  horizonDays: number
  minBatchFill: number
  cloneKeepsLevel: boolean
  durationFactor: number
  kappa: number
}

/** Combats de capture par heure (ESTIMATION : 5 min par combat, recherche du groupe et trajet compris). */
export const DEFAULT_FIGHTS_PER_HOUR = 12
/** Part du temps de jeu passée à capturer (le reste : enclos, crafts, ventes). */
export const DEFAULT_CAPTURE_SHARE = 0.5
export const DEFAULT_PARENT_LEVEL = 40
export const DEFAULT_BRISAGE_LEVEL = 53
export const DEFAULT_MIN_BATCH_FILL = 6
/** Facteur prudent appliqué au prix d'un objet-monture du marché (HDV mixte). */
export const DEFAULT_MOUNT_SALE_FACTOR = 0.85
/** Sessions d'attente avant de lancer un lot incomplet. */
export const BATCH_MAX_WAIT_SESSIONS = 2
/** Sessions d'attente d'une féconde « condamnée » sans partenaire avant de la sortir quand même. */
export const CONDEMNED_MAX_WAIT_SESSIONS = 2
/** Sessions d'attente d'une stérile seule avant de la sortir (pas de partenaire de clonage). */
export const STERILE_MAX_WAIT_SESSIONS = 4
/** Stock de montures à vendre gardé (jours de volume vendable) avant d'extraire le surplus. */
export const SALE_STOCK_DAYS = 3
export const MAX_HORIZON_DAYS = 365
/** Montures par combat au plus (taille des groupes : 8 ; ×2 avec un filet multiplicateur). */
export const GROUP_CAP: Record<NetKind, number> = { universel: 8, multiplicateur: 16, renforce: 8, multiplicateur_renforce: 16 }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
const intOr = (v: number | undefined | null, d: number) => (v !== undefined && v !== null && Number.isFinite(v) ? Math.floor(v) : d)
const numOr = (v: number | undefined | null, d: number) => (v !== undefined && v !== null && Number.isFinite(v) ? v : d)

/** Filet le plus avancé équipable à ce niveau d'Éleveur (même règle que l'accueil, advisor.bestNetKind). */
export function netKindForJobLevel(jobLevel: number): NetKind {
  if (jobLevel >= 200) return 'multiplicateur_renforce'
  if (jobLevel >= 150) return 'renforce'
  if (jobLevel >= 100) return 'multiplicateur'
  return 'universel'
}

/**
 * Passages aux enclos par jour selon le temps de jeu : même barème que le calendrier du Plan
 * (advisor.sessionsPerDayFor) : < 1 h → 1 ; 1 à 4 h → 2 ; 4 à 8 h → 3 ; 8 h et plus → 4.
 */
export function sessionsForHours(hoursPerDay: number | undefined): number {
  const h = hoursPerDay ?? 3
  if (!Number.isFinite(h)) return 2
  if (h < 1) return 1
  if (h < 4) return 2
  if (h < 8) return 3
  return 4
}

/** Montures capturées par combat : personnages × montures par lancer, au plus la taille d'un groupe. */
export function capturesPerFight(characters: number, mountsPerCast: number, netKind: NetKind): number {
  return Math.min(GROUP_CAP[netKind], Math.max(1, Math.round(characters)) * Math.max(1, mountsPerCast))
}

function normalizeCloning(c: CloningPolicy | undefined, target: number): number {
  if (c === undefined || c === true) return Math.max(0, target - 1)
  if (c === false) return 0
  return clamp(intOr(c.maxGeneration, 0), 0, 10)
}

function normalizeOpti(o: OptimakinaPolicy | undefined): OptimakinaPolicy {
  if (o === undefined) return 'auto'
  if (o === 'none' || o === 'all' || o === 'auto') return o
  return { fromGeneration: clamp(intOr(o.fromGeneration, 2), 2, 10) }
}

/** Bornes et valeurs par défaut (la génération 'auto' est résolue par `resolveTarget`). */
export function normalizeProductionConfig(cfg: ProductionConfig): NormalizedProductionConfig {
  const fam = FAMILIES[cfg.family]
  if (!fam) throw new Error(`Famille inconnue : ${String(cfg.family)}`)
  if (cfg.mode === 'brisage' && BRISAGE_RUNE[cfg.family] === null) throw new Error(`Le brisage n'est pas possible pour les ${fam.plural}.`)
  const targetSpeciesIds = cfg.targetSpeciesIds?.filter((id) => getSpecies(id)?.family === cfg.family && getSpecies(id)?.breedable && (getSpecies(id)?.generation ?? 0) >= 2)
  // Espèces imposées : la génération visée est la leur (la plus haute).
  const imposed = targetSpeciesIds?.length ? Math.max(...targetSpeciesIds.map((id) => gen(id))) : null
  const rawTarget = imposed ?? cfg.targetGeneration
  const targetAuto = rawTarget === 'auto' || rawTarget === undefined
  const targetGeneration = cfg.mode === 'brisage' ? 1 : targetAuto ? 0 : clamp(intOr(rawTarget as number, 2), 2, 10)
  const hoursPerDay = clamp(numOr(cfg.hoursPerDay, 3), 0.25, 24)
  const jobLevel = clamp(intOr(cfg.jobLevel ?? cfg.prices.ctx.jobLevel, 200), 1, 200)
  const netKind = cfg.netKind ?? netKindForJobLevel(jobLevel)
  const mountsPerCast = Math.max(1, numOr(cfg.mountsPerCast, DEFAULT_MOUNTS_PER_CAST[netKind].value))
  const characters = clamp(intOr(cfg.characters, 1), 1, 8)
  const fightsPerHour = clamp(numOr(cfg.fightsPerHour, DEFAULT_FIGHTS_PER_HOUR), 0, 120)
  const captureRate = Math.max(0, numOr(cfg.captureRate, capturesPerFight(characters, mountsPerCast, netKind) * fightsPerHour))
  const paddocks = clamp(intOr(cfg.paddocks, 1), 1, MAX_PADDOCKS)
  const schedule = (cfg.paddockSchedule ?? [])
    .filter((s) => s && Number.isFinite(s.day) && Number.isFinite(s.paddocks))
    .map((s) => ({ day: Math.max(1, Math.floor(s.day)), paddocks: clamp(Math.floor(s.paddocks), 1, MAX_PADDOCKS) }))
    .sort((a, b) => a.day - b.day)
  const xpTier: XpTierPolicy = cfg.xpTier === undefined || cfg.xpTier === 'auto' ? 'auto' : (clamp(intOr(cfg.xpTier, 1), 1, 4) as FuelTier)
  const n: NormalizedProductionConfig = {
    ...cfg,
    targetGeneration,
    targetAuto: cfg.mode !== 'brisage' && targetAuto,
    targetSpeciesIds: targetSpeciesIds?.length ? targetSpeciesIds : undefined,
    mateBeforeExtract: cfg.mateBeforeExtract ?? true,
    cloning: cfg.cloning ?? true,
    cloneMaxGeneration: 0,
    parentLevel: clamp(intOr(cfg.parentLevel, DEFAULT_PARENT_LEVEL), 1, 200),
    brisageLevel: clamp(intOr(cfg.brisageLevel, DEFAULT_BRISAGE_LEVEL), 1, 200),
    optimakina: normalizeOpti(cfg.optimakina),
    tier: clamp(intOr(cfg.tier, 2), 1, 4) as FuelTier,
    xpTier,
    paddocks,
    paddockSchedule: schedule,
    slotsPerPaddock: clamp(intOr(cfg.slotsPerPaddock, PADDOCK_SLOTS), 1, PADDOCK_SLOTS),
    sessionsPerDay: clamp(intOr(cfg.sessionsPerDay, sessionsForHours(hoursPerDay)), 1, 12),
    hoursPerDay,
    captureHoursPerDay: clamp(numOr(cfg.captureHoursPerDay, hoursPerDay * DEFAULT_CAPTURE_SHARE), 0, 24),
    characters,
    netKind,
    mountsPerCast,
    fightsPerHour,
    captureRate,
    buyG1PerDay: Math.max(0, numOr(cfg.buyG1PerDay, 0)),
    g1Price: cfg.g1Price === undefined || cfg.g1Price === null || !Number.isFinite(cfg.g1Price) ? null : Math.max(0, cfg.g1Price),
    initialStock: (cfg.initialStock ?? []).filter((l) => getSpecies(l.speciesId)?.family === cfg.family && getSpecies(l.speciesId)?.breedable && l.count > 0),
    jobLevel,
    rules: cfg.rules ?? RULESETS['3.6'],
    horizonDays: clamp(intOr(cfg.horizonDays, 60), 1, MAX_HORIZON_DAYS),
    minBatchFill: clamp(intOr(cfg.minBatchFill, DEFAULT_MIN_BATCH_FILL), 1, PADDOCK_SLOTS),
    cloneKeepsLevel: cfg.cloneKeepsLevel ?? true,
    durationFactor: clamp(numOr(cfg.durationFactor, 1), 0.25, 10),
    kappa: numOr(cfg.kappa, 1),
  }
  n.cloneMaxGeneration = normalizeCloning(n.cloning, n.targetGeneration || 10)
  return n
}

// ---------- Livre de prix (résolu une fois par configuration) ----------

/** Prix unitaire utilisé par la valorisation : jamais 0 pour un prix inconnu. */
export interface UnitPrice {
  /** Valeur unitaire (kamas) ; borne si incomplet (`bound`) ; null si inconnue. */
  value: number | null
  complete: boolean
  /** Nature de `value` quand incomplet : borne basse (ingrédients partiels) ou haute (palier supérieur). */
  bound: 'min' | 'max' | null
  /** Estimation de la recherche (indice, défaut). */
  estimated: boolean
  missing: number[]
  origin: string
  itemId: number | null
  label: string
}

export interface FuelUnit extends UnitPrice {
  gauge: GaugeId
  tier: FuelTier
  /** Durabilité du carburant retenu (points par objet), null si inconnu. */
  durability: number | null
  /** Prix d'un objet du carburant retenu. */
  itemPrice: number | null
}

export interface MarketItemInfo {
  itemId: number
  name: string
  /** Prix brut unitaire. */
  price: UnitPrice
  depth: MarketDepth | null
  /** Unités vendables par jour (part du volume moyen, non arrondi) ; null = liquidité inconnue. */
  perDayCap: number | null
}

export interface MountSaleInfo {
  speciesId: number
  name: string
  generation: number
  /** Prix brut prudent (joueur, sinon min des médianes du marché × facteur). */
  price: UnitPrice
  depth: MarketDepth | null
  perDayCap: number | null
  /** Prix bas pour sa génération (< ½ valeur d'extraction dès la G5) : montures séniles probables. */
  senileSuspect: boolean
  /** Prix d'objet-monture du marché : niveau, état et sénilité mélangés. */
  mixed: boolean
}

export interface ProductionPriceBook {
  family: FamilyId
  saleTax: number
  maxMarketShare: number
  revenueFactor: number
  costFactor: number
  batch: BatchProfile
  /** Palier de Mangeoire retenu pendant la fécondation. */
  xpTier: FuelTier
  capture: UnitPrice
  /** Carburant au point des jauges de fécondité (palier entretenu). */
  fuel: Partial<Record<GaugeId, FuelUnit>>
  /** Mangeoire pendant la fécondation (palier `xpTier`). */
  xpFecond: FuelUnit
  /** Mangeoire des lots de montée (brisage, palier `tier`). */
  xpLevel: FuelUnit
  /** Optimakina par génération de makina (index 2 … 10). */
  makina: (UnitPrice | null)[]
  resource: MarketItemInfo
  rune: (MarketItemInfo & { valuePerMount: UnitPrice; unitsPerMount: number | null }) | null
  geneton: UnitPrice
  /**
   * Génétons convertibles par jour : volume vendable du meilleur objet de la boutique (parchemin) ×
   * son coût en génétons ; null = liquidité inconnue. Le surplus reste en réserve (non compté).
   */
  genetonCap: number | null
  /** Prix d'achat d'une G1 (par espèce). */
  g1Buy: (speciesId: number) => UnitPrice
  mountSale: (speciesId: number) => MountSaleInfo
}

function unit(raw: number | null, complete: boolean, label: string, extra: Partial<UnitPrice> = {}): UnitPrice {
  // Un coût incomplet à 0 (aucun ingrédient chiffré) est inconnu, pas gratuit.
  const value = !complete && raw === 0 ? null : raw
  return {
    value,
    complete: complete && value !== null,
    bound: complete && value !== null ? null : value !== null ? 'min' : null,
    estimated: false,
    missing: [],
    origin: complete ? 'connu' : 'manquant',
    itemId: null,
    label,
    ...extra,
  }
}

function fuelUnit(gauge: GaugeId, tier: FuelTier, pc: ReturnType<typeof bestFuel>): FuelUnit {
  const opt = pc.fuel ?? pc.toPrice
  return {
    value: pc.value,
    complete: pc.complete,
    bound: pc.complete ? null : pc.bound,
    estimated: pc.estimated,
    missing: pc.complete ? [] : pc.missing,
    origin: pc.origin,
    itemId: opt?.fuel.id ?? null,
    label: opt?.fuel.name ?? `Carburant (${gauge})`,
    gauge,
    tier,
    durability: pc.fuel?.durability ?? null,
    itemPrice: pc.fuel?.unitPrice ?? null,
  }
}

/** Prix prudent d'un objet-monture au marché : min(médiane 30 j, médiane 24 h si ≥ 5 ventes) × facteur. */
export function conservativeMountMarketPrice(market: PriceContext['market'], speciesId: number, factor = DEFAULT_MOUNT_SALE_FACTOR): { price: number; depth: MarketDepth | null } | null {
  const itemId = getSpecies(speciesId)?.itemId
  const row = itemId && market ? market.rows[String(itemId)] : undefined
  if (!itemId || !row) return null
  const vals: number[] = []
  if (row[TUPLE.median30] > 0) vals.push(row[TUPLE.median30])
  if (row[TUPLE.median24] > 0 && row[TUPLE.sold24] >= AUTO_MIN_SOLD_24H) vals.push(row[TUPLE.median24])
  if (!vals.length && row[TUPLE.mean30] > 0) vals.push(row[TUPLE.mean30])
  if (!vals.length) return null
  return { price: Math.min(...vals) * factor, depth: marketDepth(market, itemId) }
}

const bookCache = new WeakMap<object, Map<string, ProductionPriceBook>>()

/** Livre de prix d'une configuration (mémorisé par contexte de prix). */
export function productionPriceBook(cfg: NormalizedProductionConfig): ProductionPriceBook {
  const p = cfg.prices
  const key = [
    cfg.family,
    cfg.mode,
    cfg.tier,
    cfg.xpTier,
    cfg.rules.id,
    cfg.jobLevel,
    cfg.netKind,
    cfg.mountsPerCast,
    cfg.brisageLevel,
    cfg.parentLevel,
    cfg.sessionsPerDay,
    cfg.durationFactor,
    cfg.g1Price,
    p.saleTax,
    p.maxMarketShare,
    p.genetonValue,
    p.includeGenetons,
    p.mountSaleFactor,
    p.revenueFactor,
    p.costFactor,
  ].join('|')
  let byKey = bookCache.get(p.ctx)
  if (!byKey) {
    byKey = new Map()
    bookCache.set(p.ctx, byKey)
  }
  const fullKey = p.mountPrices ? `${key}|mp:${JSON.stringify(p.mountPrices)}` : key
  const hit = byKey.get(fullKey)
  if (hit) return hit
  const book = buildPriceBook(cfg)
  if (byKey.size > 400) byKey.clear()
  byKey.set(fullKey, book)
  return book
}

function buildPriceBook(cfg: NormalizedProductionConfig): ProductionPriceBook {
  const p = cfg.prices
  const rules = cfg.rules
  const ctx: PriceContext = p.ctx.jobLevel === undefined ? { ...p.ctx, jobLevel: cfg.jobLevel } : p.ctx
  const fopts = { jobLevel: cfg.jobLevel, rules }
  const saleTax = clamp(numOr(p.saleTax, 0.02), 0, 1)
  const share = clamp(numOr(p.maxMarketShare, DEFAULT_MAX_MARKET_SHARE), 0, 1)
  const batch = batchProfile('typique', cfg.tier, rules)
  const fuel: Partial<Record<GaugeId, FuelUnit>> = {}
  for (const g of FERTILITY_GAUGES) {
    const t = batch.tiers[g] ?? cfg.tier
    fuel[g] = fuelUnit(g, t, gaugePointCost(g, t, ctx, fopts))
  }
  const xpTier = resolveXpTier(cfg, batch, ctx)
  const xpFecond = fuelUnit('mangeoire', xpTier, bestFuel('mangeoire', xpTier, ctx, fopts))
  const xpLevel = fuelUnit('mangeoire', cfg.tier, bestFuel('mangeoire', cfg.tier, ctx, fopts))
  const cc = captureCost(cfg.family, cfg.netKind, ctx, { mountsPerCast: cfg.mountsPerCast, jobLevel: cfg.jobLevel })
  const capture = unit(cc.perMount, cc.complete, cc.net?.name ?? 'Filet de capture', { origin: cc.origin, missing: cc.complete ? [] : cc.missing, itemId: cc.net?.id ?? null })
  const makina: (UnitPrice | null)[] = []
  for (let g = 0; g <= 10; g++) {
    if (g < 2) {
      makina.push(null)
      continue
    }
    const mc = makinaCost('optimakina', cfg.family, g, ctx, rules)
    makina.push(
      unit(mc.price, mc.complete, mc.makina?.name ?? `Optimakina G${g}`, {
        origin: mc.origin,
        missing: mc.complete ? [] : mc.missing.length ? mc.missing : mc.makina ? [mc.makina.id] : [],
        itemId: mc.makina?.id ?? null,
      }),
    )
  }
  const fam = FAMILIES[cfg.family]
  const marketItem = (itemId: number, name: string): MarketItemInfo => {
    const mp = marketPrice(itemId, ctx)
    const depth = marketDepth(ctx.market, itemId)
    return {
      itemId,
      name,
      price: unit(mp.price, mp.price !== null, name, { origin: mp.origin, missing: mp.price === null ? [itemId] : [], itemId, estimated: mp.origin === 'defaut' }),
      depth,
      perDayCap: depth ? depth.perDayAvg * share : null,
    }
  }
  const resource = marketItem(fam.extractionItemId, fam.extractionItemName)
  const runeId = BRISAGE_RUNE[cfg.family]
  let rune: ProductionPriceBook['rune'] = null
  if (runeId !== null) {
    const base = marketItem(runeId, `Rune Ga ${cfg.family === 'volkorne' ? 'Pa' : 'Pme'}`)
    const bv = brisageValue(cfg.family, cfg.brisageLevel, ctx)
    const valuePerMount = unit(bv.value, bv.complete && bv.value !== null, `Brisage niv. ${cfg.brisageLevel}`, {
      estimated: true,
      origin: bv.method,
      missing: bv.complete ? [] : [runeId],
      itemId: runeId,
    })
    const rp = base.price.value
    rune = { ...base, valuePerMount, unitsPerMount: bv.value !== null && rp !== null && rp > 0 ? bv.value / rp : null }
  }
  const tax = saleTax
  let geneton: UnitPrice
  const gmk = genetonValueFromMarket(ctx.market, tax)
  const gdepth = gmk ? marketDepth(ctx.market, gmk.best.id) : null
  const genetonCap = gmk && gdepth ? gdepth.perDayAvg * share * gmk.best.cost : null
  if (p.includeGenetons === false) geneton = unit(0, true, 'Génétons (non comptés)', { origin: 'exclu' })
  else if (p.genetonValue !== undefined && p.genetonValue !== null && Number.isFinite(p.genetonValue))
    geneton = unit(Math.max(0, p.genetonValue) * (1 - tax), true, 'Généton (votre valeur)', { origin: 'joueur' })
  else {
    const gm = gmk
    if (gm) geneton = unit(gm.net, true, `Généton (${gm.best.name})`, { origin: 'marche', estimated: true, itemId: gm.best.id })
    else {
      const d = genetonKamasValue()
      geneton = unit(d.value * (1 - tax), true, 'Généton (défaut de la recherche)', { origin: 'defaut', estimated: true })
    }
  }
  const saleFactor = clamp(numOr(p.mountSaleFactor, DEFAULT_MOUNT_SALE_FACTOR), 0, 2)
  const saleCache = new Map<number, MountSaleInfo>()
  const mountSale = (speciesId: number): MountSaleInfo => {
    const hit = saleCache.get(speciesId)
    if (hit) return hit
    const sp = getSpecies(speciesId)
    const name = sp?.name ?? `#${speciesId}`
    const gen = sp?.generation ?? 0
    let info: MountSaleInfo
    const own = p.mountPrices ? mountSalePrice(speciesId, 1, p.mountPrices, { state: 'fertile' }) : null
    const ownPrice = own && own.price !== null && (own.origin === 'joueur-espece' || own.origin === 'joueur-generation') ? own.price : null
    const mk = conservativeMountMarketPrice(ctx.market, speciesId, saleFactor)
    const depth = sp?.itemId ? marketDepth(ctx.market, sp.itemId) : null
    const perDayCap = depth ? depth.perDayAvg * share : null
    if (ownPrice !== null) info = { speciesId, name, generation: gen, price: unit(ownPrice, true, name, { origin: 'joueur', itemId: sp?.itemId ?? null }), depth, perDayCap, senileSuspect: false, mixed: false }
    else {
      const extractGross = resource.price.value === null ? null : gen * resource.price.value
      const senile = mk !== null && gen >= 5 && extractGross !== null && extractGross > 0 && mk.price / saleFactor < 0.5 * extractGross
      info = {
        speciesId,
        name,
        generation: gen,
        price: unit(mk?.price ?? null, mk !== null, name, { origin: mk ? 'marche' : 'manquant', itemId: sp?.itemId ?? null, missing: mk ? [] : sp?.itemId ? [sp.itemId] : [] }),
        depth,
        perDayCap,
        senileSuspect: senile,
        mixed: true,
      }
    }
    saleCache.set(speciesId, info)
    return info
  }
  const buyCache = new Map<number, UnitPrice>()
  const g1Buy = (speciesId: number): UnitPrice => {
    const hit = buyCache.get(speciesId)
    if (hit) return hit
    const sp = getSpecies(speciesId)
    let u: UnitPrice
    if (cfg.g1Price !== null) u = unit(cfg.g1Price, true, `${sp?.name ?? 'G1'} (prix saisi)`, { origin: 'joueur' })
    else {
      // Achat : le prix le plus HAUT des statistiques (prudent pour un coût).
      const row = sp?.itemId && ctx.market ? ctx.market.rows[String(sp.itemId)] : undefined
      const vals = row ? [row[TUPLE.median30], row[TUPLE.sold24] >= AUTO_MIN_SOLD_24H ? row[TUPLE.median24] : 0].filter((v) => v > 0) : []
      const v = vals.length ? Math.max(...vals) : null
      u = unit(v, v !== null, sp?.name ?? 'G1', { origin: v !== null ? 'marche' : 'manquant', itemId: sp?.itemId ?? null, missing: v === null && sp?.itemId ? [sp.itemId] : [] })
    }
    buyCache.set(speciesId, u)
    return u
  }
  return {
    family: cfg.family,
    saleTax,
    maxMarketShare: share,
    revenueFactor: Math.max(0, numOr(p.revenueFactor, 1)),
    costFactor: Math.max(0, numOr(p.costFactor, 1)),
    batch,
    xpTier,
    capture,
    fuel,
    xpFecond,
    xpLevel,
    makina,
    resource,
    rune,
    geneton,
    genetonCap,
    g1Buy,
    mountSale,
  }
}

/** XP « gratuite » en temps : Mangeoire en 2e jauge pendant la phase d'amour du lot. */
function freeXpPoints(batch: BatchProfile, tier: FuelTier, xpTier: FuelTier, rules: Ruleset): number {
  return xpOverlapPoints(tier, xpTier, rules, batch.points.dragofesse ?? 20_000)
}

/** Durée (s) d'un lot de fécondation qui doit donner `xpNeeded` points d'XP avec la Mangeoire au palier `xpTier`. */
function fecondSeconds(batch: BatchProfile, tier: FuelTier, xpTier: FuelTier, rules: Ruleset, xpNeeded: number): number {
  const free = freeXpPoints(batch, tier, xpTier, rules)
  const rate = rules.gaugeRatePerTick[xpTier] / TICK_SECONDS
  return batch.seconds + Math.max(0, xpNeeded - free) / rate
}

/**
 * Palier de Mangeoire 'auto' : le moins cher au point parmi ceux qui ne rallongent pas le lot d'une
 * session (pour des parents à monter du niveau 1 au niveau visé) ; à défaut de prix, le palier choisi.
 */
function resolveXpTier(cfg: NormalizedProductionConfig, batch: BatchProfile, ctx: PriceContext): FuelTier {
  if (cfg.xpTier !== 'auto') return cfg.xpTier
  const rules = cfg.rules
  const xp = mountXpForLevel(cfg.mode === 'brisage' ? cfg.brisageLevel : cfg.parentLevel)
  const cycle = 86_400 / cfg.sessionsPerDay
  const sessions = (t: FuelTier) => Math.max(1, Math.ceil((fecondSeconds(batch, cfg.tier, t, rules, xp) * cfg.durationFactor) / cycle - 1e-9))
  const ref = sessions(cfg.tier)
  let best: FuelTier = cfg.tier
  let bestCost = bestFuel('mangeoire', cfg.tier, ctx, { jobLevel: cfg.jobLevel, rules }).value
  if (bestCost === null) return cfg.tier
  for (let t = 1 as FuelTier; t < cfg.tier; t = (t + 1) as FuelTier) {
    if (sessions(t) > ref) continue
    const pc = bestFuel('mangeoire', t, ctx, { jobLevel: cfg.jobLevel, rules })
    if (pc.complete && pc.value !== null && pc.value < bestCost) {
      best = t
      bestCost = pc.value
    }
  }
  return best
}

// ---------- Plan (recettes, besoins, Optimakina) ----------

const gen = (id: number): number => getSpecies(id)?.generation ?? 0

function mustSpecies(id: number): Species {
  const s = getSpecies(id)
  if (!s) throw new Error(`Espèce inconnue : ${id}`)
  return s
}

/** Une étape de la chaîne retenue (de la cible vers les captures). */
export interface ProductionStep {
  speciesId: number
  generation: number
  crossing: [number, number] | null
  optimakina: boolean
  /** Chance de génération cible B (1 pour une capture). */
  targetChance: number
  /** Besoin relatif (pour une monture visée). */
  weight: number
}

export interface OptimakinaChoice {
  generation: number
  use: boolean
  reason: string
}

/** Plan résolu (sérialisable : utilisé par les pages). */
export interface ProductionPlanInfo {
  family: FamilyId
  mode: ProductionMode
  targetGeneration: number
  targets: number[]
  steps: ProductionStep[]
  /** G1 capturées et leur part. */
  captureShares: { speciesId: number; share: number }[]
  optimakina: OptimakinaChoice[]
  notes: string[]
}

interface Plan {
  info: ProductionPlanInfo
  family: FamilyId
  mode: ProductionMode
  T: number
  targets: number[]
  targetSet: Set<number>
  crossing: Map<number, [number, number]>
  needed: Set<number>
  order: number[]
  g1: number[]
  g1Weight: number[]
  /** Croisements où chaque espèce est parent (génération décroissante). */
  usedIn: Map<number, number[]>
  optiByGen: boolean[]
  /** Chance de génération cible B de chaque croisement. */
  chance: Map<number, number>
  /** Part de chaque parent consommée par un accouplement (½ ou ¾ avec clonage, 1 sans). */
  parentFactor: Map<number, number>
}

function speciesOfGeneration(family: FamilyId, g: number): Species[] {
  return speciesOfFamily(family, { breedableOnly: true }).filter((s) => s.generation === g && Number.isFinite(minCaptures(s.id)))
}

/** Espèce de génération `g` la moins chère en captures (départage : plus petit id). */
export function cheapestOfGeneration(family: FamilyId, g: number): number | null {
  const list = speciesOfGeneration(family, g).sort((a, b) => minCaptures(a.id) - minCaptures(b.id) || a.id - b.id)
  return list[0]?.id ?? null
}

/** Espèces de génération `g` les mieux payées (vente) : prix net × volume vendable par jour. */
function bestSaleSpecies(family: FamilyId, g: number, book: ProductionPriceBook, max = 3): number[] {
  const scored = speciesOfGeneration(family, g)
    .map((s) => ({ s, info: book.mountSale(s.id) }))
    .filter(({ info }) => info.price.value !== null && !info.senileSuspect && (info.perDayCap ?? 0) > 0)
    .map(({ s, info }) => ({ id: s.id, score: (info.price.value as number) * Math.min(info.perDayCap ?? 0, 10) }))
    .sort((a, b) => b.score - a.score || a.id - b.id)
  return scored.slice(0, max).map((x) => x.id)
}

function cloningFactor(cloneMax: number, a: number, b: number): number {
  const ga = gen(a)
  const gb = gen(b)
  const ca = ga <= cloneMax
  const cb = gb <= cloneMax
  if (!ca && !cb) return 1
  return ga === gb ? 0.5 : 0.75
}

function optiForGeneration(policy: OptimakinaPolicy, g: number): boolean {
  if (g < 2 || policy === 'none') return false
  if (policy === 'all') return true
  if (policy === 'auto') return false
  return g >= policy.fromGeneration
}

const planCache = new Map<string, Plan>()

function planKey(cfg: NormalizedProductionConfig): string {
  return [
    cfg.family,
    cfg.mode,
    cfg.targetGeneration,
    (cfg.targetSpeciesIds ?? []).join(','),
    cfg.parentLevel,
    cfg.brisageLevel,
    JSON.stringify(cfg.optimakina),
    cfg.cloneMaxGeneration,
    cfg.rules.id,
    cfg.rules.optimakinaBonus,
    cfg.mode === 'vente' || cfg.optimakina === 'auto' ? productionPriceBookKey(cfg) : '',
  ].join('|')
}

function productionPriceBookKey(cfg: NormalizedProductionConfig): string {
  // Identité du contexte de prix : les décisions de prix (vente, Optimakina auto) en dépendent.
  let id = ctxIds.get(cfg.prices.ctx)
  if (id === undefined) {
    id = ++ctxCounter
    ctxIds.set(cfg.prices.ctx, id)
  }
  return `${id}:${cfg.tier}:${cfg.jobLevel}:${cfg.prices.saleTax ?? ''}:${cfg.prices.maxMarketShare ?? ''}:${cfg.prices.mountSaleFactor ?? ''}`
}
const ctxIds = new WeakMap<object, number>()
let ctxCounter = 0

function buildPlan(cfg: NormalizedProductionConfig, book: ProductionPriceBook): Plan {
  const key = planKey(cfg)
  const hit = planCache.get(key)
  if (hit) return hit
  const family = cfg.family
  const notes: string[] = []
  const T = cfg.targetGeneration
  let targets: number[] = []
  if (cfg.mode !== 'brisage') {
    if (cfg.targetSpeciesIds?.length) targets = [...new Set(cfg.targetSpeciesIds)]
    else if (cfg.mode === 'vente') {
      targets = bestSaleSpecies(family, T, book)
      if (!targets.length) {
        const c = cheapestOfGeneration(family, T)
        if (c !== null) targets = [c]
        notes.push(`Aucune monture G${T} n'a de prix de vente utilisable sur ce marché : la production est extraite.`)
      }
    } else {
      const c = cheapestOfGeneration(family, T)
      if (c !== null) targets = [c]
    }
    if (!targets.length) throw new Error(`Aucune monture élevable de génération ${T} pour cette famille.`)
  }
  const targetSet = new Set(targets)
  const crossing = new Map<number, [number, number]>()
  const needed = new Set<number>()
  for (const t of targets) {
    const tree = cheapestRecipe(t)
    if (!tree) throw new Error(`${mustSpecies(t).name} n'est pas élevable.`)
    for (const r of requiredSpecies(tree)) {
      needed.add(r.speciesId)
      if (r.crossing && !crossing.has(r.speciesId)) crossing.set(r.speciesId, [r.crossing[0], r.crossing[1]])
    }
  }
  let g1: number[]
  if (cfg.mode === 'brisage') {
    g1 = speciesOfFamily(family, { breedableOnly: true })
      .filter((s) => s.generation === 1 && s.capturable)
      .map((s) => s.id)
    for (const id of g1) needed.add(id)
  } else g1 = [...needed].filter((id) => !crossing.has(id)).sort((a, b) => a - b)
  const order = [...crossing.keys()].sort((a, b) => gen(b) - gen(a) || a - b)
  const usedIn = new Map<number, number[]>()
  for (const c of order) {
    for (const p of crossing.get(c) as [number, number]) {
      const l = usedIn.get(p)
      if (l) l.push(c)
      else usedIn.set(p, [c])
    }
  }

  // Optimakina par génération de bébé.
  const optiByGen: boolean[] = Array.from({ length: 12 }, (_, g) => optiForGeneration(cfg.optimakina, g))
  const optiChoices: OptimakinaChoice[] = []
  const lvl = cfg.mode === 'brisage' ? cfg.brisageLevel : cfg.parentLevel
  if (cfg.optimakina === 'auto') {
    const decided = new Set<number>()
    const pairs: [number, number, number][] = order.map((c) => [gen(c), ...(crossing.get(c) as [number, number])])
    if (cfg.mode !== 'brisage' && cfg.mateBeforeExtract) for (const t of targets) pairs.push([gen(t), t, t])
    for (const [g, a, b] of pairs) {
      if (decided.has(g)) continue
      decided.add(g)
      const d = autoOptimakina(cfg, book, a, b, lvl)
      optiByGen[g] = d.use
      optiChoices.push({ generation: g, use: d.use, reason: d.reason })
    }
  } else {
    const gens = new Set(order.map(gen))
    for (const g of [...gens].sort((a, b) => a - b)) optiChoices.push({ generation: g, use: optiByGen[g], reason: optiByGen[g] ? 'Optimakina (politique choisie).' : 'Sans Optimakina (politique choisie).' })
  }

  // Besoin relatif de chaque espèce (comme l'Optimiseur) → parts de captures des G1.
  const need = new Map<number, number>()
  const chance = new Map<number, number>()
  const parentFactor = new Map<number, number>()
  for (const t of targets) need.set(t, (need.get(t) ?? 0) + 1 / targets.length)
  for (const c of order) {
    const [a, b] = crossing.get(c) as [number, number]
    const p = targetChance(lvl, lvl, { makina: optiByGen[gen(c)] ? 'optimakina' : null, rules: cfg.rules })
    chance.set(c, p)
    const f = cloningFactor(cfg.cloneMaxGeneration, a, b)
    parentFactor.set(c, f)
    const n = need.get(c) ?? 0
    if (n <= 0) continue
    const att = n / p
    need.set(a, (need.get(a) ?? 0) + att * f)
    need.set(b, (need.get(b) ?? 0) + att * f)
  }
  let g1Weight = g1.map((id) => (cfg.mode === 'brisage' ? 1 : (need.get(id) ?? 0)))
  const sumW = g1Weight.reduce((s, v) => s + v, 0)
  g1Weight = sumW > 0 ? g1Weight.map((v) => v / sumW) : g1.map(() => 1 / Math.max(1, g1.length))

  const steps: ProductionStep[] = [
    ...order.map((c) => ({
      speciesId: c,
      generation: gen(c),
      crossing: crossing.get(c) as [number, number],
      optimakina: optiByGen[gen(c)],
      targetChance: chance.get(c) ?? 1,
      weight: need.get(c) ?? 0,
    })),
    ...g1.map((id) => ({ speciesId: id, generation: 1, crossing: null, optimakina: false, targetChance: 1, weight: need.get(id) ?? 0 })),
  ]
  if (cfg.mode === 'vente' && targets.length) notes.push(`Montures vendues : ${targets.map((t) => mustSpecies(t).name).join(', ')} (prix prudent, ${MOUNT_MARKET_NOTE.toLowerCase()})`)
  const info: ProductionPlanInfo = {
    family,
    mode: cfg.mode,
    targetGeneration: T,
    targets,
    steps,
    captureShares: g1.map((id, i) => ({ speciesId: id, share: g1Weight[i] })),
    optimakina: optiChoices,
    notes,
  }
  const plan: Plan = { info, family, mode: cfg.mode, T, targets, targetSet, crossing, needed, order, g1, g1Weight, usedIn, optiByGen, chance, parentFactor }
  if (planCache.size > 300) planCache.clear()
  planCache.set(key, plan)
  return plan
}

/** Coût de fécondation d'une monture (lot plein), connu seulement. */
function fecundationCostPerMount(book: ProductionPriceBook, slots: number): number | null {
  let total = 0
  for (const g of FERTILITY_GAUGES) {
    const pts = book.batch.points[g] ?? 0
    if (pts <= 0) continue
    const u = book.fuel[g]
    if (!u || u.value === null || !u.complete) return null
    total += pts * u.value
  }
  return total / Math.max(1, slots)
}

function autoOptimakina(cfg: NormalizedProductionConfig, book: ProductionPriceBook, a: number, b: number, level: number): { use: boolean; reason: string } {
  const pa = cleanParent(a, level)
  const pb = cleanParent(b, level)
  const base = breed(pa, pb, { rules: cfg.rules })
  const withOpti = breed(pa, pb, { rules: cfg.rules, makina: 'optimakina' })
  const mk = book.makina[clamp(base.makinaGenerationRequired, 2, 10)]
  // C_eff ≈ 2 × (fécondation + XP par monture) + valeur d'extraction des deux parents (coût d'opportunité).
  const fec = fecundationCostPerMount(book, cfg.slotsPerPaddock)
  const xpPts = mountXpForLevel(level) / Math.max(1, cfg.slotsPerPaddock)
  const xpCost = level <= 1 ? 0 : book.xpFecond.value !== null && book.xpFecond.complete ? xpPts * book.xpFecond.value : null
  const res = book.resource.price.value
  // Ressources d'extraction d'une monture = sa génération (G1 = 0).
  const qty = (id: number) => (gen(id) >= 2 ? gen(id) : 0)
  const opp = cfg.mode === 'extraction' || cfg.mode === 'vente' ? (res === null ? null : (qty(a) + qty(b)) * res * (1 - book.saleTax)) : 0
  const coupleCost = fec === null || xpCost === null || opp === null ? null : 2 * (fec + xpCost) + opp
  const d = decideOptimakina({ mode: 'auto', base, withOpti, price: mk?.value ?? null, priceComplete: !!mk?.complete, coupleCost })
  return { use: d.use, reason: d.reason }
}

/** Plan de production d'une configuration (recettes, parts de captures, Optimakina). */
export function productionPlan(input: ProductionConfig): ProductionPlanInfo {
  const cfg = resolveTarget(normalizeProductionConfig(input))
  return buildPlan(cfg, productionPriceBook(cfg)).info
}

// ---------- Génération visée 'auto' (tri rapide par simulation) ----------

const autoCache = new Map<string, number>()

/** Générations essayées par la génération visée 'auto'. */
export const AUTO_TARGET_GENERATIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10]

/**
 * Génération visée 'auto' : tri rapide — un tirage par génération (2 … 10) sur la durée demandée
 * (45 jours au plus), avec les autres réglages inchangés ; on garde celle dont le bénéfice net connu
 * par jour en régime permanent est le plus élevé (coûts chiffrés d'abord). L'optimiseur
 * (`optimizeMode`) explore en plus le niveau des parents, l'Optimakina, le palier, etc.
 */
export function autoTargetGeneration(input: ProductionConfig | NormalizedProductionConfig): number {
  const base = 'targetAuto' in input ? input : normalizeProductionConfig(input)
  if (base.mode === 'brisage') return 1
  const horizonDays = Math.min(base.horizonDays, 45)
  const { prices, rules, ...rest } = base
  const key = `${productionPriceBookKey(base)}|${rules.id}|${JSON.stringify({ ...rest, horizonDays, mountPrices: prices.mountPrices ?? null, g: prices.genetonValue ?? null, inc: prices.includeGenetons ?? true })}`
  const hit = autoCache.get(key)
  if (hit !== undefined) return hit
  let best = 2
  let bestKey: [number, number] = [-1, -Infinity]
  for (const T of AUTO_TARGET_GENERATIONS) {
    const cfg: NormalizedProductionConfig = { ...base, horizonDays, targetGeneration: T, targetAuto: false, cloneMaxGeneration: normalizeCloning(base.cloning, T) }
    let net: number
    let comparable: number
    try {
      const book = productionPriceBook(cfg)
      const plan = buildPlan(cfg, book)
      const run = simulateResolved(cfg, book, plan, runSeed(1, T))
      const win = run.days.slice(steadyWindowStart(horizonDays) - 1)
      // Sans prix de la ressource, on compare les ressources produites (le bénéfice connu n'aurait que les génétons).
      net = book.resource.price.value === null && cfg.mode !== 'vente' ? mean(win.map((x) => x.resources)) : mean(win.map((x) => x.netKnown))
      comparable = win.every((x) => x.net.low !== null) ? 1 : 0
    } catch {
      continue
    }
    if (comparable > bestKey[0] || (comparable === bestKey[0] && net > bestKey[1] + 1e-6)) {
      bestKey = [comparable, net]
      best = T
    }
  }
  if (autoCache.size > 200) autoCache.clear()
  autoCache.set(key, best)
  return best
}

function resolveTarget(cfg: NormalizedProductionConfig): NormalizedProductionConfig {
  if (cfg.mode === 'brisage' || !cfg.targetAuto) return cfg
  const T = autoTargetGeneration(cfg)
  return { ...cfg, targetGeneration: T, cloneMaxGeneration: normalizeCloning(cfg.cloning, T) }
}

// ---------- Naissances (mémorisées) ----------

interface DistItem {
  id: number
  p: number
  genetons: number
}

interface Dist {
  items: DistItem[]
  targetGeneration: number
  makinaGeneration: number
  /** Ressources attendues du bébé (Σ p × génération). */
  expectedGen: number
}

/** Caches des naissances par jeu de règles (+ κ) : signature du parent A → (signature B × 2 + makina) → loi. */
const distCaches = new Map<string, Map<number, Map<number, Dist>>>()

/** Signature numérique (espèce, parents triés, niveau) : identifiants d'espèce < 512, niveau ≤ 200. */
function sigOf(sp: number, parents: number[], level: number): number {
  const a = parents[0] ?? 0
  const b = parents[1] ?? 0
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return ((sp * 512 + lo) * 512 + hi) * 256 + level
}

interface SM {
  sp: number
  g: number
  sex: 0 | 1
  parents: number[]
  level: number
  /** 0 = chaîne, 1 = condamnée (accoupler puis sortir), 2 = à briser, 3 = sortie terminale. */
  role: 0 | 1 | 2 | 3
  since: number
  /** Signature (espèce, parents, niveau) pour le cache des naissances. */
  sid: number
  /** Génération la plus haute parmi ses parents (arbre « propre »). */
  pg: number
}

const ROLE_PIPE = 0
const ROLE_CONDEMNED = 1
const ROLE_BREAK = 2
const ROLE_TERMINAL = 3


function distribution(a: SM, b: SM, opti: boolean, rules: Ruleset, kappa: number, caches: Map<number, Map<number, Dist>>): Dist {
  let cache = caches.get(a.sid)
  if (!cache) {
    if (caches.size > 20_000) caches.clear()
    cache = new Map()
    caches.set(a.sid, cache)
  }
  const key = b.sid * 2 + (opti ? 1 : 0)
  const hit = cache.get(key)
  if (hit) return hit
  const r = breed({ speciesId: a.sp, level: a.level, parents: a.parents }, { speciesId: b.sp, level: b.level, parents: b.parents }, { makina: opti ? 'optimakina' : null, rules, kappa })
  const items = r.outcomes.map((o) => ({ id: o.speciesId, p: o.probability, genetons: o.genetons }))
  const d: Dist = { items, targetGeneration: r.targetGeneration, makinaGeneration: r.makinaGenerationRequired, expectedGen: r.outcomes.reduce((s, o) => s + o.probability * o.generation, 0) }
  cache.set(key, d)
  return d
}

// ---------- Une simulation ----------

/** Quantités et montants d'une journée simulée. */
export interface ProductionDay {
  day: number
  paddocks: number
  captures: number
  bought: number
  /** Montures mises en fécondation. */
  fecundations: number
  /** Montures mises en montée de niveau (brisage). */
  levelings: number
  batches: number
  matings: number
  /** Accouplements de montures condamnées (« accoupler avant d'extraire »). */
  condemnedMatings: number
  optimakinas: number
  births: number
  /** Naissances par génération (index = génération). */
  birthsByGeneration: number[]
  /** Naissances de la génération visée ou plus. */
  targetBirths: number
  clones: number
  extracted: number
  /** Ressources d'extraction produites. */
  resources: number
  resourcesSold: number
  resourceStock: number
  broken: number
  /** Runes produites (équivalent rune Ga). */
  runes: number
  runesSold: number
  runeStock: number
  /** Montures mises en vente. */
  forSale: number
  mountsSold: number
  saleStock: number
  kept: number
  discarded: number
  /** Fécondes sorties de l'étable pleine (surplus). */
  released: number
  genetons: number
  /** Génétons convertis (parchemins vendus, plafonnés par le volume). */
  genetonsSold: number
  genetonStock: number
  jobXp: number
  /** Points de jauge consommés (fécondation) par jauge. */
  fuelPoints: Record<GaugeId, number>
  /** Points de Mangeoire des lots de montée (brisage). */
  levelXpPoints: number
  /** Optimakinas par génération de makina (index 2 … 10). */
  makinas: number[]
  /** Montures vendues par espèce. */
  soldBySpecies: Record<number, number>
  /** Montures hors enclos en fin de journée (étable). */
  held: number
  /** Taux d'occupation des places d'enclos (moyenne des sessions). */
  occupancy: number
  cost: Range
  revenue: Range
  net: Range
  /** Montants connus (bornes basses des coûts et revenus connus). */
  costKnown: number
  revenueKnown: number
  netKnown: number
  cumulativeKnown: number
  cumulative: Range
  costByCategory: Record<ProductionCostCategory, number>
  revenueByCategory: Record<ProductionRevenueCategory, number>
}

export type ProductionCostCategory = 'capture' | 'achat' | 'carburant' | 'xp' | 'makina'
export type ProductionRevenueCategory = 'ressources' | 'runes' | 'montures' | 'genetons'

export const PRODUCTION_COST_LABELS: Record<ProductionCostCategory, string> = {
  capture: 'Filets de capture',
  achat: 'Achats de G1',
  carburant: 'Carburant (fécondation)',
  xp: 'Mangeoire (XP)',
  makina: 'Optimakinas',
}

export const PRODUCTION_REVENUE_LABELS: Record<ProductionRevenueCategory, string> = {
  ressources: "Ressources d'extraction",
  runes: 'Runes de brisage',
  montures: 'Ventes de montures',
  genetons: 'Génétons',
}

/** Bilan des montures (conservation : entrées = sorties + stock). */
export interface MountLedger {
  initial: number
  captured: number
  bought: number
  born: number
  extracted: number
  broken: number
  sold: number
  kept: number
  discarded: number
  /** Montures « perdues » au clonage (2 stériles → 1 fertile). */
  cloneLost: number
  /** Montures encore présentes en fin de simulation (enclos, étable, stock à vendre). */
  remaining: number
}

/** Compteurs du régime permanent (routine quotidienne), sommés sur la fenêtre. */
export interface RoutineAcc {
  days: number
  forSale: Map<number, number>
  captures: Map<number, number>
  matings: Map<number, number>
  condemned: number
  clones: Map<number, number>
  extracted: Map<number, number>
  sold: Map<number, number>
  broken: number
  batches: number
}

export interface ProductionRun {
  seed: number
  days: ProductionDay[]
  ledger: MountLedger
  /** Jour de la première naissance de la génération visée (null si jamais). */
  firstTargetDay: number | null
  /** Pic de montures hors enclos. */
  peakHeld: number
  /** L'étable a débordé (captures arrêtées). */
  stableOverflow: boolean
  /** Fécondes restées sans partenaire en fin de simulation. */
  waitingFecund: number
  /** Montures présentes en fin de simulation, par file et par espèce. */
  inventory: { waiting: Record<number, number>; paddocks: Record<number, number>; fecund: Record<number, number>; condemned: Record<number, number>; sterile: Record<number, number>; forSale: Record<number, number> }
  routine: RoutineAcc
}

const emptyFuel = (): Record<GaugeId, number> => ({ baffeur: 0, caresseur: 0, foudroyeur: 0, abreuvoir: 0, dragofesse: 0, mangeoire: 0 })

function emptyDay(day: number, paddocks: number): ProductionDay {
  const zr = (): Range => ({ low: 0, high: 0 })
  return {
    day,
    paddocks,
    captures: 0,
    bought: 0,
    fecundations: 0,
    levelings: 0,
    batches: 0,
    matings: 0,
    condemnedMatings: 0,
    optimakinas: 0,
    births: 0,
    birthsByGeneration: Array.from({ length: 11 }, () => 0),
    targetBirths: 0,
    clones: 0,
    extracted: 0,
    resources: 0,
    resourcesSold: 0,
    resourceStock: 0,
    broken: 0,
    runes: 0,
    runesSold: 0,
    runeStock: 0,
    forSale: 0,
    mountsSold: 0,
    saleStock: 0,
    kept: 0,
    discarded: 0,
    released: 0,
    genetons: 0,
    genetonsSold: 0,
    genetonStock: 0,
    jobXp: 0,
    fuelPoints: emptyFuel(),
    levelXpPoints: 0,
    makinas: Array.from({ length: 11 }, () => 0),
    soldBySpecies: {},
    held: 0,
    occupancy: 0,
    cost: zr(),
    revenue: zr(),
    net: zr(),
    costKnown: 0,
    revenueKnown: 0,
    netKnown: 0,
    cumulativeKnown: 0,
    cumulative: zr(),
    costByCategory: { capture: 0, achat: 0, carburant: 0, xp: 0, makina: 0 },
    revenueByCategory: { ressources: 0, runes: 0, montures: 0, genetons: 0 },
  }
}

interface Paddock {
  /** 0 = libre, 1 = fécondation, 2 = montée de niveau. */
  kind: 0 | 1 | 2
  mounts: SM[]
  remaining: number
  active: boolean
}

function addTo(m: Map<number, number>, k: number, v: number) {
  m.set(k, (m.get(k) ?? 0) + v)
}

/** Vente plafonnée : `allowance` = report (≤ 1 unité) + plafond du jour ; renvoie [vendu, report]. */
function sellCapped(stock: number, cap: number | null, carry: number): [number, number] {
  if (stock <= 0) return [0, cap === null ? 0 : Math.min(1, carry + cap)]
  if (cap === null) return [stock, 0]
  const allowance = carry + cap
  const sold = Math.min(stock, Math.floor(allowance + 1e-9))
  return [sold, Math.min(1, allowance - sold)]
}

/** Simule un élevage en production continue pendant `horizonDays` jours (un tirage). */
export function simulateProduction(input: ProductionConfig, seed: number): ProductionRun {
  const cfg = resolveTarget(normalizeProductionConfig(input))
  const book = productionPriceBook(cfg)
  const plan = buildPlan(cfg, book)
  return simulateResolved(cfg, book, plan, seed)
}

function simulateResolved(cfg: NormalizedProductionConfig, book: ProductionPriceBook, plan: Plan, seed: number): ProductionRun {
  const rules = cfg.rules
  const rng = mulberry32(seed)
  const sexOf = (): 0 | 1 => (rng() < 0.5 ? 0 : 1)
  const S = cfg.sessionsPerDay
  const slots = cfg.slotsPerPaddock
  const cycleSeconds = 86_400 / S
  const mode = cfg.mode
  const T = plan.T
  const mBE = cfg.mateBeforeExtract
  const batch = book.batch
  const xpTier = book.xpTier
  const fecLevel = mode === 'brisage' ? cfg.brisageLevel : cfg.parentLevel
  const xpTarget = mountXpForLevel(fecLevel)
  const brisageXp = mountXpForLevel(cfg.brisageLevel)
  const levelRate = rules.gaugeRatePerTick[cfg.tier] / TICK_SECONDS
  const stableCap = rules.stableSlots

  // Montures à vendre (vente) : espèces avec un prix et un volume.
  const salable = new Set<number>()
  if (mode === 'vente') {
    const res = book.resource.price.value
    for (const s of speciesOfFamily(cfg.family, { breedableOnly: true })) {
      const info = book.mountSale(s.id)
      const price = info.price.value
      // Vendue seulement si le prix prudent dépasse la valeur d'extraction (génération × ressource).
      if (price !== null && !info.senileSuspect && (info.perDayCap ?? 1) > 0 && (res === null || price > (s.generation >= 2 ? s.generation : 0) * res)) salable.add(s.id)
    }
  }

  const ledger: MountLedger = { initial: 0, captured: 0, bought: 0, born: 0, extracted: 0, broken: 0, sold: 0, kept: 0, discarded: 0, cloneLost: 0, remaining: 0 }
  const routine: RoutineAcc = { days: 0, forSale: new Map(), captures: new Map(), matings: new Map(), condemned: 0, clones: new Map(), extracted: new Map(), sold: new Map(), broken: 0, batches: 0 }
  const windowStart = steadyWindowStart(cfg.horizonDays)

  let rawFecund: SM[] = []
  let rawLevel: SM[] = []
  const fecund = new Map<number, SM[]>()
  let fecundCount = 0
  let condemned: SM[] = []
  let sterilePool: SM[] = []
  const saleStock = new Map<number, number>()
  let saleStockTotal = 0
  const raisingCount = new Map<number, number>()
  const paddocks: Paddock[] = []
  let resourceStock = 0
  let runeStock = 0
  let genetonStock = 0
  let genCarry = 0
  let resCarry = 0
  let runeCarry = 0
  const saleCarry = new Map<number, number>()
  let capCarry = 0
  let buyCarry = 0
  let k = 0
  let d: ProductionDay = emptyDay(1, cfg.paddocks)
  const days: ProductionDay[] = []
  let firstTargetDay: number | null = null
  let peakHeld = 0
  let stableOverflow = false
  let inWindow = false

  const held = () => rawFecund.length + rawLevel.length + fecundCount + condemned.length + sterilePool.length + saleStockTotal

  const ckey = `${rules.id}|${rules.optimakinaBonus}|${cfg.kappa}`
  let dcache = distCaches.get(ckey)
  if (!dcache) {
    dcache = new Map()
    distCaches.set(ckey, dcache)
  }
  const dc = dcache
  const mk = (sp: number, sex: 0 | 1, parents: number[], level: number, role: SM['role']): SM => {
    let pg = 0
    for (const p of parents) pg = Math.max(pg, gen(p))
    return { sp, g: gen(sp), sex, parents, pg, level, role, since: k, sid: sigOf(sp, parents, level) }
  }
  const setLevel = (m: SM, level: number) => {
    if (m.level === level) return
    m.level = level
    m.sid = sigOf(m.sp, m.parents, level)
  }

  const pushFecund = (m: SM) => {
    m.since = k
    if (m.role === ROLE_CONDEMNED) {
      condemned.push(m)
      return
    }
    const l = fecund.get(m.sp)
    if (l) l.push(m)
    else fecund.set(m.sp, [m])
    fecundCount += 1
  }

  // ----- Sorties -----
  const extract = (m: SM) => {
    if (m.g >= 2) {
      d.extracted += 1
      d.resources += m.g
      resourceStock += m.g
      ledger.extracted += 1
      if (inWindow) addTo(routine.extracted, m.g, 1)
    } else {
      d.discarded += 1
      ledger.discarded += 1
    }
  }
  const breakMount = () => {
    d.broken += 1
    ledger.broken += 1
    if (inWindow) routine.broken += 1
    const u = book.rune?.unitsPerMount
    if (u !== null && u !== undefined) {
      d.runes += u
      runeStock += u
    }
  }
  const toSale = (m: SM) => {
    d.forSale += 1
    if (inWindow) addTo(routine.forSale, m.sp, 1)
    saleStock.set(m.sp, (saleStock.get(m.sp) ?? 0) + 1)
    saleStockTotal += 1
  }
  /** Sortie d'une monture qui ne sert plus à la chaîne. */
  const finalize = (m: SM) => {
    if (mode === 'brisage') {
      if (m.level >= cfg.brisageLevel) breakMount()
      else {
        m.role = ROLE_BREAK
        m.since = k
        rawLevel.push(m)
      }
      return
    }
    if (mode === 'vente' && salable.has(m.sp) && m.role !== ROLE_TERMINAL) return toSale(m)
    if (mode === 'progression' && plan.targetSet.has(m.sp)) {
      d.kept += 1
      ledger.kept += 1
      return
    }
    extract(m)
  }
  /** Bébé ou clone fertile : chaîne, condamné, ou sortie. */
  const route = (m: SM, fromCondemned: boolean) => {
    if (mode === 'brisage') {
      m.role = ROLE_BREAK
      if (m.level >= cfg.brisageLevel) breakMount()
      else {
        m.since = k
        rawLevel.push(m)
      }
      return
    }
    const terminal = plan.targetSet.has(m.sp) || (m.g >= T && !plan.needed.has(m.sp))
    if (terminal) {
      if (fromCondemned) {
        m.role = ROLE_TERMINAL
        if (mode === 'vente' && salable.has(m.sp)) return toSale(m)
        return finalize(m)
      }
      if (mode === 'vente' && salable.has(m.sp)) return toSale(m)
      if (mode === 'progression') return finalize(m)
      if (mBE) {
        m.role = ROLE_CONDEMNED
        m.since = k
        rawFecund.push(m)
        return
      }
      return finalize(m)
    }
    if (plan.needed.has(m.sp)) {
      m.role = ROLE_PIPE
      m.since = k
      rawFecund.push(m)
      return
    }
    // Surplus : bébé hors recette.
    if (mode === 'vente' && salable.has(m.sp)) return toSale(m)
    extract(m)
  }

  // ----- Stock de départ -----
  for (const line of cfg.initialStock) {
    const sp = mustSpecies(line.speciesId)
    const parents = sp.generation <= 1 ? [] : cleanParent(sp.id, 1).parents
    for (let i = 0; i < Math.floor(line.count); i++) {
      ledger.initial += 1
      const m = mk(sp.id, sexOf(), parents, clamp(intOr(line.level, 1), 1, 200), ROLE_PIPE)
      const state = line.state ?? 'fertile'
      if (state === 'sterile') {
        sterilePool.push(m)
        continue
      }
      if (mode === 'brisage') {
        if (state === 'feconde' && mBE) {
          m.role = ROLE_CONDEMNED
          pushFecund(m)
        } else route(m, false)
        continue
      }
      const terminal = plan.targetSet.has(m.sp) || (m.g >= T && !plan.needed.has(m.sp))
      if (state === 'feconde' && (plan.needed.has(m.sp) || (terminal && mBE))) {
        m.role = terminal ? ROLE_CONDEMNED : ROLE_PIPE
        pushFecund(m)
      } else route(m, false)
    }
  }

  // ----- Accouplements -----
  const pickParent = (list: SM[] | undefined, sex: 0 | 1, targetGen: number): number => {
    if (!list) return -1
    let first = -1
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      if (m.sex !== sex) continue
      if (m.pg < targetGen) return i
      if (first < 0) first = i
    }
    return first
  }
  const sample = (dist: Dist): DistItem => {
    const r = rng()
    let acc = 0
    for (const it of dist.items) {
      acc += it.p
      if (r <= acc) return it
    }
    return dist.items[dist.items.length - 1]
  }
  const newSteriles: SM[] = []
  const doMate = (ma: SM, mb: SM, opti: boolean, isCondemned: boolean) => {
    let dist = distribution(ma, mb, false, rules, cfg.kappa, dc)
    const useOpti = mode !== 'brisage' && (opti || (isCondemned && plan.optiByGen[dist.targetGeneration]))
    if (useOpti && dist.targetGeneration >= 2) dist = distribution(ma, mb, true, rules, cfg.kappa, dc)
    const baby = sample(dist)
    d.matings += 1
    if (isCondemned) d.condemnedMatings += 1
    if (useOpti && dist.targetGeneration >= 2) {
      d.optimakinas += 1
      d.makinas[clamp(dist.makinaGeneration, 2, 10)] += 1
    }
    d.genetons += baby.genetons
    genetonStock += baby.genetons
    d.jobXp += rules.matingXpPerGeneration * (ma.g + mb.g)
    const bg = gen(baby.id)
    d.births += 1
    d.birthsByGeneration[bg] += 1
    ledger.born += 1
    if (bg >= T && mode !== 'brisage') {
      d.targetBirths += 1
      if (firstTargetDay === null) firstTargetDay = d.day
    }
    if (inWindow && isCondemned) routine.condemned += 1
    ma.role = isCondemned ? ROLE_TERMINAL : ROLE_PIPE
    mb.role = isCondemned ? ROLE_TERMINAL : ROLE_PIPE
    ma.since = k
    mb.since = k
    newSteriles.push(ma, mb)
    route(mk(baby.id, sexOf(), [ma.sp, mb.sp], 1, ROLE_PIPE), isCondemned)
  }

  /** Montures de la chaîne par espèce : en attente d'enclos, en enclos, fécondes. */
  const pipelineCounts = (): Map<number, number> => {
    const have = new Map<number, number>()
    for (const m of rawFecund) if (m.role === ROLE_PIPE) addTo(have, m.sp, 1)
    for (const [sp, v] of raisingCount) if (v > 0) addTo(have, sp, v)
    for (const [sp, l] of fecund) if (l.length) addTo(have, sp, l.length)
    return have
  }

  /**
   * Accouplements de la recette, pilotés par le besoin (comme l'Optimiseur) : besoin de la cible = places
   * d'enclos (jamais limitant), propagé par B et le clonage ; un croisement ne s'accouple que si son
   * bébé manque (fertiles en attente + en enclos + fécondes) ; génération la plus haute d'abord, et à
   * génération égale, le croisement le plus en retard sur son besoin (parent partagé réparti).
   */
  const mateRecipes = () => {
    if (!plan.order.length) return
    const have = pipelineCounts()
    const capacity = paddocks.filter((p) => p.active).length * slots
    const need = new Map<number, number>()
    for (const t of plan.targets) need.set(t, Math.max(1, capacity) / plan.targets.length)
    const wanted = new Map<number, number>()
    for (const c of plan.order) {
      const deficit = Math.max(0, (need.get(c) ?? 0) - (plan.targetSet.has(c) ? 0 : (have.get(c) ?? 0)))
      const att = deficit / (plan.chance.get(c) ?? 1)
      wanted.set(c, att)
      const [a, b] = plan.crossing.get(c) as [number, number]
      const f = plan.parentFactor.get(c) ?? 1
      addTo(need, a, att * f)
      addTo(need, b, att * f)
    }
    const initial = new Map(wanted)
    // Réserve : parents attendus par un croisement plus haut dont le partenaire sort bientôt d'enclos.
    const reserves = new Map<string, number>()
    const reserve = (x: number, gc: number): number => {
      const rk = `${x}|${gc}`
      const hit = reserves.get(rk)
      if (hit !== undefined) return hit
      let r = 0
      for (const up of plan.usedIn.get(x) ?? []) {
        if (gen(up) <= gc) continue
        const [ua, ub] = plan.crossing.get(up) as [number, number]
        r += raisingCount.get(ua === x ? ub : ua) ?? 0
      }
      reserves.set(rk, r)
      return r
    }
    const pairFor = (c: number): [number, number] | null => {
      const [a, b] = plan.crossing.get(c) as [number, number]
      const la = fecund.get(a)
      const lb = fecund.get(b)
      if (!la?.length || !lb?.length) return null
      const gc = gen(c)
      if (la.length <= reserve(a, gc) || lb.length <= reserve(b, gc)) return null
      // Sexes : on consomme de préférence le sexe en surnombre de chaque espèce (évite qu'un sexe s'accumule).
      const surplusMale = (l: SM[]) => l.reduce((n, m) => n + (m.sex === 0 ? 1 : -1), 0)
      const first: 0 | 1 = surplusMale(la) - surplusMale(lb) >= 0 ? 0 : 1
      for (const sa of [first, first === 0 ? 1 : 0] as const) {
        const xa = pickParent(la, sa, gc)
        const xb = pickParent(lb, sa === 0 ? 1 : 0, gc)
        if (xa >= 0 && xb >= 0) return [xa, xb]
      }
      return null
    }
    let i = 0
    while (i < plan.order.length) {
      const g = gen(plan.order[i])
      let j = i
      while (j < plan.order.length && gen(plan.order[j]) === g) j++
      const group = plan.order.slice(i, j)
      for (;;) {
        let best = -1
        let bestScore = -Infinity
        let bestPair: [number, number] | null = null
        for (const c of group) {
          const w = wanted.get(c) ?? 0
          if (w <= 1e-9) continue
          const pr = pairFor(c)
          if (!pr) continue
          const score = w / Math.max(1e-9, initial.get(c) ?? 1)
          if (score > bestScore) {
            bestScore = score
            best = c
            bestPair = pr
          }
        }
        if (best < 0 || !bestPair) break
        const [a, b] = plan.crossing.get(best) as [number, number]
        const ma = (fecund.get(a) as SM[]).splice(bestPair[0], 1)[0]
        const mb = (fecund.get(b) as SM[]).splice(bestPair[1], 1)[0]
        fecundCount -= 2
        wanted.set(best, (wanted.get(best) ?? 0) - 1)
        if (inWindow) addTo(routine.matings, best, 1)
        doMate(ma, mb, plan.optiByGen[g], false)
      }
      i = j
    }
  }

  /**
   * Étable pleine : le joueur sort les fécondes les plus en surplus par rapport au besoin de la recette
   * (extraction dès la G2, sinon relâchée) pour libérer de la place.
   */
  const relieveStable = () => {
    const excess = held() - (stableCap - slots)
    if (excess <= 0) return
    const have = pipelineCounts()
    const weight = new Map(plan.info.steps.map((st) => [st.speciesId, Math.max(1e-6, st.weight)]))
    for (let n = 0; n < excess; n++) {
      let worst = -1
      let worstRatio = -Infinity
      for (const [sp, l] of fecund) {
        if (!l.length) continue
        const r = (have.get(sp) ?? 0) / (weight.get(sp) ?? 1e-6)
        if (r > worstRatio) {
          worstRatio = r
          worst = sp
        }
      }
      if (worst < 0) break
      const m = (fecund.get(worst) as SM[]).pop() as SM
      fecundCount -= 1
      addTo(have, worst, -1)
      m.role = ROLE_TERMINAL
      finalize(m)
      d.released += 1
    }
  }

  const mateCondemned = () => {
    if (condemned.length < 2) return
    // Groupes par signature (espèce + parents) et par sexe.
    const groups = new Map<number, { m: SM[]; f: SM[]; rep: SM }>()
    for (const m of condemned) {
      const key = m.sid
      let g = groups.get(key)
      if (!g) {
        g = { m: [], f: [], rep: m }
        groups.set(key, g)
      }
      ;(m.sex === 0 ? g.m : g.f).push(m)
    }
    const list = [...groups.values()]
    const pairs: { a: (typeof list)[number]; b: (typeof list)[number]; v: number }[] = []
    for (const ga of list)
      for (const gb of list) {
        if (!ga.m.length || !gb.f.length) continue
        const dist = distribution(ga.rep, gb.rep, false, rules, cfg.kappa, dc)
        pairs.push({ a: ga, b: gb, v: mode === 'brisage' ? 1 : dist.expectedGen })
      }
    pairs.sort((x, y) => y.v - x.v)
    const used = new Set<SM>()
    for (const p of pairs) {
      while (p.a.m.length && p.b.f.length) {
        const ma = p.a.m.pop() as SM
        const mb = p.b.f.pop() as SM
        used.add(ma)
        used.add(mb)
        doMate(ma, mb, false, true)
      }
    }
    if (used.size) condemned = condemned.filter((m) => !used.has(m))
    // Sans partenaire depuis trop longtemps : sortie directe (l'extraction rend la même chose).
    const keep: SM[] = []
    for (const m of condemned) {
      if (k - m.since >= CONDEMNED_MAX_WAIT_SESSIONS) {
        m.role = ROLE_TERMINAL
        finalize(m)
      } else keep.push(m)
    }
    condemned = keep
  }

  // ----- Clonage et sortie des stériles -----
  const cloneAndDispose = () => {
    const all = sterilePool.concat(newSteriles)
    newSteriles.length = 0
    sterilePool = []
    const byGen = new Map<number, SM[]>()
    for (const m of all) {
      if (m.role === ROLE_TERMINAL || mode === 'brisage') {
        finalize(m)
        continue
      }
      if (m.g > cfg.cloneMaxGeneration || m.g >= T) {
        // Stérile de la chaîne non clonée : extraction (G ≥ 2) ou relâchée (G1).
        finalize({ ...m, role: ROLE_TERMINAL })
        continue
      }
      const l = byGen.get(m.g)
      if (l) l.push(m)
      else byGen.set(m.g, [m])
    }
    const cloneOf = (x: SM, y: SM) => {
      const keep = rng() < 0.5 ? x : y
      d.clones += 1
      ledger.cloneLost += 1
      if (inWindow) addTo(routine.clones, keep.g, 1)
      const c = mk(keep.sp, keep.sex, keep.parents, cfg.cloneKeepsLevel ? keep.level : 1, ROLE_PIPE)
      if (plan.needed.has(c.sp)) {
        c.since = k
        rawFecund.push(c)
      } else finalize({ ...c, role: ROLE_TERMINAL })
    }
    for (const list of byGen.values()) {
      const useful = list.filter((m) => plan.needed.has(m.sp))
      const useless = list.filter((m) => !plan.needed.has(m.sp))
      const byColor = new Map<number, SM[]>()
      for (const m of useful) {
        const l = byColor.get(m.sp)
        if (l) l.push(m)
        else byColor.set(m.sp, [m])
      }
      const leftovers: SM[] = []
      for (const ms of byColor.values()) {
        while (ms.length >= 2) cloneOf(ms.pop() as SM, ms.pop() as SM)
        leftovers.push(...ms)
      }
      // Couleurs utiles différentes : seulement les stériles qui attendent déjà (sinon on garde la paire pour sa couleur).
      leftovers.sort((x, y) => x.since - y.since)
      while (leftovers.length >= 2 && k - leftovers[0].since >= 1) cloneOf(leftovers.shift() as SM, leftovers.shift() as SM)
      while (leftovers.length && useless.length) cloneOf(leftovers.shift() as SM, useless.pop() as SM)
      for (const m of leftovers) {
        if (k - m.since >= STERILE_MAX_WAIT_SESSIONS) finalize({ ...m, role: ROLE_TERMINAL })
        else sterilePool.push(m)
      }
      for (const m of useless) finalize({ ...m, role: ROLE_TERMINAL })
    }
  }

  // ----- Captures et achats -----
  const boughtBySpecies = new Map<number, number>()
  const pipelineG1Counts = (): number[] => {
    const idx = new Map(plan.g1.map((id, i) => [id, i]))
    const c = plan.g1.map(() => 0)
    const add = (m: SM) => {
      const i = idx.get(m.sp)
      if (i !== undefined && m.role !== ROLE_CONDEMNED) c[i] += 1
    }
    for (const m of rawFecund) add(m)
    for (const m of rawLevel) add(m)
    for (const id of plan.g1) {
      const i = idx.get(id) as number
      c[i] += (fecund.get(id)?.length ?? 0) + (raisingCount.get(id) ?? 0)
    }
    return c
  }
  /** Mâles − femelles de chaque couleur G1 dans la chaîne (en attente, en enclos, fécondes). */
  const g1SexBalance = (): Map<number, number> => {
    const bal = new Map<number, number>()
    const add = (m: SM) => {
      if (m.g === 1 && m.role !== ROLE_CONDEMNED) addTo(bal, m.sp, m.sex === 0 ? 1 : -1)
    }
    for (const m of rawFecund) add(m)
    for (const m of rawLevel) add(m)
    for (const p of paddocks) for (const m of p.mounts) add(m)
    for (const id of plan.g1) for (const m of fecund.get(id) ?? []) add(m)
    return bal
  }
  const acquire = (n: number, how: 'capture' | 'achat') => {
    if (n <= 0 || !plan.g1.length) return
    const have = pipelineG1Counts()
    const sexBal = g1SexBalance()
    const total = have.reduce((s, v) => s + v, 0) + n
    for (let i = 0; i < n; i++) {
      let bi = 0
      let bv = -Infinity
      for (let j = 0; j < plan.g1.length; j++) {
        const deficit = plan.g1Weight[j] * total - have[j]
        if (deficit > bv + 1e-9) {
          bv = deficit
          bi = j
        }
      }
      have[bi] += 1
      const sp = plan.g1[bi]
      // Le sexe en déficit de la couleur (conseil de la recherche) ; à égalité, au hasard.
      const bal = sexBal.get(sp) ?? 0
      const sex: 0 | 1 = mode === 'brisage' && !mBE ? sexOf() : bal > 0 ? 1 : bal < 0 ? 0 : sexOf()
      addTo(sexBal, sp, sex === 0 ? 1 : -1)
      const m = mk(sp, sex, [], 1, ROLE_PIPE)
      if (how === 'capture') {
        d.captures += 1
        ledger.captured += 1
        d.jobXp += 30
        if (inWindow) addTo(routine.captures, sp, 1)
      } else {
        d.bought += 1
        ledger.bought += 1
        addTo(boughtBySpecies, sp, 1)
      }
      if (mode === 'brisage') {
        if (mBE) {
          m.role = ROLE_CONDEMNED
          rawFecund.push(m)
        } else {
          m.role = ROLE_BREAK
          rawLevel.push(m)
        }
      } else rawFecund.push(m)
    }
  }
  // ----- Mise en enclos -----
  const placeBatches = () => {
    if (!paddocks.some((p) => p.active && p.kind === 0)) return
    if (rawFecund.length > 1) rawFecund.sort((x, y) => y.g - x.g || y.level - x.level || x.since - y.since)
    if (rawLevel.length > 1) rawLevel.sort((x, y) => y.level - x.level)
    for (const p of paddocks) {
      if (!p.active || p.kind !== 0) continue
      if (rawFecund.length) {
        const take = Math.min(slots, rawFecund.length)
        const oldest = rawFecund.reduce((mn, m) => Math.min(mn, m.since), Infinity)
        if (take < cfg.minBatchFill && k - oldest < BATCH_MAX_WAIT_SESSIONS) continue
        const ms = rawFecund.splice(0, take)
        let needXp = 0
        for (const m of ms) needXp = Math.max(needXp, xpTarget - mountXpForLevel(m.level))
        needXp = Math.max(0, needXp)
        const seconds = fecondSeconds(batch, cfg.tier, xpTier, rules, needXp) * cfg.durationFactor
        p.kind = 1
        p.mounts = ms
        p.remaining = Math.max(1, Math.ceil(seconds / cycleSeconds - 1e-9))
        for (const g of FERTILITY_GAUGES) d.fuelPoints[g] += batch.points[g] ?? 0
        d.fuelPoints.mangeoire += needXp
        d.fecundations += ms.length
        d.batches += 1
        if (inWindow) routine.batches += 1
        for (const m of ms) addTo(raisingCount, m.sp, 1)
        continue
      }
      if (rawLevel.length) {
        const take = Math.min(slots, rawLevel.length)
        const oldest = rawLevel.reduce((mn, m) => Math.min(mn, m.since), Infinity)
        if (take < cfg.minBatchFill && k - oldest < BATCH_MAX_WAIT_SESSIONS) continue
        const ms = rawLevel.splice(0, take)
        let needXp = 0
        for (const m of ms) needXp = Math.max(needXp, brisageXp - mountXpForLevel(m.level))
        needXp = Math.max(0, needXp)
        p.kind = 2
        p.mounts = ms
        p.remaining = Math.max(1, Math.ceil(((needXp / levelRate) * cfg.durationFactor) / cycleSeconds - 1e-9))
        d.levelXpPoints += needXp
        d.levelings += ms.length
        d.batches += 1
        if (inWindow) routine.batches += 1
      }
    }
  }

  const tickPaddocks = () => {
    let used = 0
    let capacity = 0
    for (const p of paddocks) {
      if (p.active) capacity += slots
      if (p.kind === 0) continue
      used += p.mounts.length
      p.remaining -= 1
      if (p.remaining > 0) continue
      const ms = p.mounts
      const kind = p.kind
      p.kind = 0
      p.mounts = []
      for (const m of ms) {
        if (kind === 1) {
          addTo(raisingCount, m.sp, -1)
          setLevel(m, Math.max(m.level, fecLevel))
          pushFecund(m)
        } else {
          breakMount()
        }
      }
    }
    return capacity > 0 ? used / capacity : 0
  }

  const paddocksAt = (day: number): number => {
    let n = cfg.paddocks
    for (const s of cfg.paddockSchedule) if (s.day <= day) n = Math.max(n, s.paddocks)
    return n
  }

  const capPerSession = (cfg.captureRate * cfg.captureHoursPerDay) / S
  // Achats de G1 : au plus la part du volume quotidien de leurs objets-montures (si connue).
  const g1Caps = plan.g1.map((id) => book.mountSale(id).perDayCap)
  const buyCap = g1Caps.length && g1Caps.every((c) => c !== null) ? g1Caps.reduce((a, c) => a + (c ?? 0), 0) : Infinity
  const buyPerSession = Math.min(cfg.buyG1PerDay, buyCap) / S
  let cumKnown = 0
  let cumLow: number | null = 0
  let cumHigh: number | null = 0

  for (let day = 1; day <= cfg.horizonDays; day++) {
    const nPad = paddocksAt(day)
    while (paddocks.length < nPad) paddocks.push({ kind: 0, mounts: [], remaining: 0, active: true })
    for (let i = 0; i < paddocks.length; i++) paddocks[i].active = i < nPad
    d = emptyDay(day, nPad)
    inWindow = day >= windowStart
    if (inWindow) routine.days += 1
    let occ = 0
    for (let s = 0; s < S; s++) {
      k += 1
      mateRecipes()
      mateCondemned()
      cloneAndDispose()
      relieveStable()
      // Achats puis captures : remplir les enclos libres.
      const freePaddocks = paddocks.filter((p) => p.active && p.kind === 0).length
      let room = freePaddocks * slots - rawFecund.length - rawLevel.length
      const stableRoom = stableCap - held()
      if (stableRoom <= 0) stableOverflow = true
      room = Math.max(0, Math.min(room, stableRoom))
      if (buyPerSession > 0) {
        buyCarry = Math.min(buyCarry + buyPerSession, buyPerSession + 1)
        const nb = Math.min(room, Math.floor(buyCarry + 1e-9))
        buyCarry -= nb
        acquire(nb, 'achat')
        room -= nb
      }
      capCarry = Math.min(capCarry + capPerSession, capPerSession + 1)
      const nc = Math.min(room, Math.floor(capCarry + 1e-9))
      capCarry -= nc
      acquire(nc, 'capture')
      placeBatches()
      occ += tickPaddocks()
      peakHeld = Math.max(peakHeld, held())
    }
    d.occupancy = occ / S
    // Ventes de fin de journée (liquidité).
    ;[d.resourcesSold, resCarry] = sellCapped(resourceStock, book.resource.perDayCap, resCarry)
    resourceStock -= d.resourcesSold
    if (book.rune) {
      ;[d.runesSold, runeCarry] = sellCapped(runeStock, book.rune.perDayCap, runeCarry)
      runeStock -= d.runesSold
    }
    if (saleStockTotal > 0 || saleCarry.size) {
      for (const [sp, n] of Array.from(saleStock)) {
        const info = book.mountSale(sp)
        const [sold, carry] = sellCapped(n, info.perDayCap, saleCarry.get(sp) ?? 0)
        saleCarry.set(sp, carry)
        let left = n - sold
        if (sold > 0) {
          d.mountsSold += sold
          d.soldBySpecies[sp] = (d.soldBySpecies[sp] ?? 0) + sold
          ledger.sold += sold
          if (inWindow) addTo(routine.sold, sp, sold)
        }
        // Surplus au-delà de quelques jours de volume : extraction.
        const maxStock = info.perDayCap === null ? Infinity : Math.max(1, Math.ceil(SALE_STOCK_DAYS * info.perDayCap))
        while (left > maxStock) {
          left -= 1
          extract(mk(sp, 0, [], 1, ROLE_TERMINAL))
        }
        saleStockTotal -= n - left
        if (left > 0) saleStock.set(sp, left)
        else saleStock.delete(sp)
      }
      // Ressources extraites du surplus : vendues le lendemain.
    }
    ;[d.genetonsSold, genCarry] = sellCapped(genetonStock, book.genetonCap, genCarry)
    genetonStock -= d.genetonsSold
    d.genetonStock = genetonStock
    d.resourceStock = resourceStock
    d.runeStock = runeStock
    d.saleStock = saleStockTotal
    d.held = held()
    valueDay(d, book, boughtBySpecies)
    boughtBySpecies.clear()
    cumKnown += d.netKnown
    cumLow = cumLow === null || d.net.low === null ? null : cumLow + d.net.low
    cumHigh = cumHigh === null || d.net.high === null ? null : cumHigh + d.net.high
    d.cumulativeKnown = cumKnown
    d.cumulative = { low: cumLow, high: cumHigh }
    days.push(d)
  }

  // Inventaire final (conservation).
  let inPaddocks = 0
  for (const p of paddocks) inPaddocks += p.mounts.length
  ledger.remaining = inPaddocks + held()
  const count = (ms: SM[]) => {
    const o: Record<number, number> = {}
    for (const m of ms) o[m.sp] = (o[m.sp] ?? 0) + 1
    return o
  }
  const inventory = {
    waiting: count(rawFecund.concat(rawLevel)),
    paddocks: count(paddocks.flatMap((p) => p.mounts)),
    fecund: count([...fecund.values()].flat()),
    condemned: count(condemned),
    sterile: count(sterilePool),
    forSale: Object.fromEntries(saleStock),
  }
  return { seed, days, ledger, firstTargetDay, peakHeld, stableOverflow, waitingFecund: fecundCount + condemned.length, inventory, routine }
}

/** Premier jour de la fenêtre du régime permanent : le dernier tiers (au moins 7 jours). */
export function steadyWindowStart(horizonDays: number): number {
  const len = Math.min(horizonDays, Math.max(7, Math.floor(horizonDays / 3)))
  return horizonDays - len + 1
}

// ---------- Valorisation ----------

interface Acc {
  costLow: number
  costHigh: number | null
  revLow: number
  revHigh: number | null
  costKnown: number
  revKnown: number
}

function addCost(acc: Acc, qty: number, u: UnitPrice | null | undefined, factor: number): number {
  if (qty <= 0) return 0
  if (!u || u.value === null) {
    acc.costHigh = null
    return 0
  }
  const v = qty * u.value * factor
  if (u.complete) {
    acc.costLow += v
    acc.costKnown += v
    if (acc.costHigh !== null) acc.costHigh += v
    return v
  }
  if (u.bound === 'max') {
    if (acc.costHigh !== null) acc.costHigh += v
    return 0
  }
  // Borne basse (ingrédients partiels).
  acc.costLow += v
  acc.costKnown += v
  acc.costHigh = null
  return v
}

function addRevenue(acc: Acc, qty: number, grossUnit: UnitPrice | null | undefined, netFactor: number): number {
  if (qty <= 0) return 0
  if (!grossUnit || grossUnit.value === null || !grossUnit.complete) {
    acc.revHigh = null
    return 0
  }
  const v = qty * grossUnit.value * netFactor
  acc.revLow += v
  acc.revKnown += v
  if (acc.revHigh !== null) acc.revHigh += v
  return v
}

function valueDay(d: ProductionDay, book: ProductionPriceBook, bought: Map<number, number>): void {
  const acc: Acc = { costLow: 0, costHigh: 0, revLow: 0, revHigh: 0, costKnown: 0, revKnown: 0 }
  const cf = book.costFactor
  const rf = book.revenueFactor
  const net = (1 - book.saleTax) * rf
  d.costByCategory.capture = addCost(acc, d.captures, book.capture, cf)
  for (const [sp, n] of bought) d.costByCategory.achat += addCost(acc, n, book.g1Buy(sp), cf)
  for (const g of FERTILITY_GAUGES) d.costByCategory.carburant += addCost(acc, d.fuelPoints[g], book.fuel[g], cf)
  d.costByCategory.xp = addCost(acc, d.fuelPoints.mangeoire, book.xpFecond, cf) + addCost(acc, d.levelXpPoints, book.xpLevel, cf)
  for (let g = 2; g <= 10; g++) d.costByCategory.makina += addCost(acc, d.makinas[g], book.makina[g], cf)
  d.revenueByCategory.ressources = addRevenue(acc, d.resourcesSold, book.resource.price, net)
  if (book.rune) d.revenueByCategory.runes = addRevenue(acc, d.runesSold, book.rune.price, net)
  for (const [sp, n] of Object.entries(d.soldBySpecies)) d.revenueByCategory.montures += addRevenue(acc, n, book.mountSale(Number(sp)).price, net)
  // Génétons : valeur déjà nette de taxe (parchemins revendus), sans plafond de liquidité.
  d.revenueByCategory.genetons = addRevenue(acc, d.genetonsSold, book.geneton, rf)
  d.cost = { low: acc.costLow, high: acc.costHigh }
  d.revenue = { low: acc.revLow, high: acc.revHigh }
  d.net = { low: acc.costHigh === null ? null : acc.revLow - acc.costHigh, high: acc.revHigh === null ? null : acc.revHigh - acc.costLow }
  d.costKnown = acc.costKnown
  d.revenueKnown = acc.revKnown
  d.netKnown = acc.revKnown - acc.costKnown
}

/** Statut d'affichage d'un montant borné (même convention qu'economy : « ≥ », « ≤ », intervalle). */
export function rangeStatus(r: Range): ProfitStatus {
  if (r.low !== null && r.high !== null) return Math.abs(r.high - r.low) < 0.5 ? 'exact' : 'intervalle'
  if (r.high !== null) return 'borne-haute'
  if (r.low !== null) return 'borne-basse'
  return 'inconnu'
}

// ---------- Monte-Carlo : agrégation ----------

export interface ProductionDailyStat {
  day: number
  paddocks: number
  /** Bénéfice net connu du jour (moyenne, p10, p90 des tirages). */
  net: { mean: number; p10: number; p90: number }
  /** Bornes moyennes du bénéfice du jour (null : borne inconnue). */
  netRange: Range
  cumulative: { mean: number; p10: number; p90: number }
  cumulativeRange: Range
  costKnown: number
  revenueKnown: number
  captures: number
  bought: number
  fecundations: number
  matings: number
  births: number
  targetBirths: number
  extracted: number
  resources: number
  resourcesSold: number
  resourceStock: number
  broken: number
  mountsSold: number
  genetons: number
  held: number
  occupancy: number
}

export interface SteadyState {
  fromDay: number
  toDay: number
  days: number
  /** Bénéfice net connu par jour (distribution des tirages). */
  netPerDay: DistStat
  /** Bénéfice par jour en intervalle (moyenne des bornes). */
  net: Range
  revenue: Range
  cost: Range
  status: ProfitStatus
  revenueKnown: number
  costKnown: number
  costByCategory: Record<ProductionCostCategory, number>
  revenueByCategory: Record<ProductionRevenueCategory, number>
  capturesPerDay: number
  boughtPerDay: number
  fecundationsPerDay: number
  levelingsPerDay: number
  batchesPerDay: number
  matingsPerDay: number
  condemnedMatingsPerDay: number
  optimakinasPerDay: number
  birthsPerDay: number
  targetBirthsPerDay: number
  clonesPerDay: number
  extractedPerDay: number
  resourcesPerDay: number
  resourcesSoldPerDay: number
  brokenPerDay: number
  runesPerDay: number
  runesSoldPerDay: number
  forSalePerDay: number
  mountsSoldPerDay: number
  keptPerDay: number
  genetonsPerDay: number
  jobXpPerDay: number
  occupancy: number
}

export interface MarketCheck {
  kind: 'ressource' | 'rune' | 'monture'
  itemId: number
  /** Monture vendue (kind 'monture'). */
  speciesId?: number
  name: string
  /** Unités produites / vendues par jour (régime permanent). */
  producedPerDay: number
  soldPerDay: number
  /** Plafond de vente par jour (part du volume), null = liquidité inconnue. */
  capPerDay: number | null
  /** Ventes moyennes du marché par jour (30 j). */
  marketPerDay: number | null
  /** Production ÷ ventes du marché. */
  shareOfMarket: number | null
  /** La production dépasse ce que le marché absorbe (stock qui grossit). */
  saturated: boolean
  /** Stock invendu en fin de simulation (moyenne). */
  endStock: number
}

export interface ProductionCapital {
  /** Socle des paliers ≥ 2 (investissement unique : il reste dans les jauges). */
  socle: InitialInvestment | null
  socleLow: number
  socleHigh: number | null
  /** Trésorerie à avancer avant que la production ne paie (−min du cumul connu, moyenne des tirages). */
  peakCashNeed: number
  /** Capital immobilisé = socle + trésorerie. */
  total: number
  /** Premier jour où le cumul (socle compris) redevient positif ; null si jamais sur la durée. */
  breakEvenDay: number | null
}

export interface ProductionRoutine {
  capturesPerDay: { speciesId: number; perDay: number }[]
  matingsPerDay: { speciesId: number; crossing: [number, number] | null; perDay: number }[]
  condemnedMatingsPerDay: number
  clonesPerDay: { generation: number; perDay: number }[]
  extractedPerDay: { generation: number; perDay: number }[]
  soldPerDay: { speciesId: number; perDay: number }[]
  brokenPerDay: number
  batchesPerDay: number
  fuel: { gauge: GaugeId; tier: FuelTier; pointsPerDay: number; fuelId: number | null; fuelName: string; durability: number | null; itemsPerDay: number | null; costPerDay: number | null; complete: boolean }[]
}

export interface PriceLine {
  key: string
  kind: 'cout' | 'revenu'
  label: string
  unit: string
  value: number | null
  complete: boolean
  bound: 'min' | 'max' | null
  estimated: boolean
  origin: string
  itemId: number | null
  missing: number[]
}

export interface ProductionWarning {
  code: string
  tone: 'warn' | 'info'
  text: string
}

/** Configuration renvoyée avec le résumé (sans le contexte de prix, volumineux). */
export type ProductionConfigEcho = Omit<NormalizedProductionConfig, 'prices' | 'rules' | 'initialStock'> & { rulesId: string; initialStockCount: number }

export interface ProductionSummary {
  config: ProductionConfigEcho
  plan: ProductionPlanInfo
  runs: number
  seed: number
  horizonDays: number
  sessionsPerDay: number
  cycleHours: number
  /** Captures possibles par jour (temps de capture). */
  captureCapacityPerDay: number
  batch: { tier: FuelTier; xpTier: FuelTier; seconds: number; sessions: number; points: Partial<Record<GaugeId, number>> }
  daily: ProductionDailyStat[]
  steady: SteadyState
  /** Jours avant d'atteindre 90 % du régime permanent (moyenne glissante sur 7 jours), null si jamais. */
  rampUpDays: number | null
  firstTargetDay: DistStat | null
  capital: ProductionCapital
  totals: {
    netKnown: DistStat
    revenueKnown: number
    costKnown: number
    captures: number
    bought: number
    matings: number
    births: number
    extracted: number
    resources: number
    resourcesSold: number
    broken: number
    mountsSold: number
    genetons: number
    jobXp: number
  }
  market: MarketCheck[]
  routine: ProductionRoutine
  prices: PriceLine[]
  /** Tous les prix utilisés sont connus. */
  complete: boolean
  missing: number[]
  estimated: boolean
  peakHeld: number
  stableOverflow: boolean
  /** Bilan des montures du premier tirage (conservation). */
  ledger: MountLedger
  warnings: ProductionWarning[]
  assumptions: string[]
}

export interface RunProductionOptions {
  runs?: number
  seed?: number
  onProgress?: (done: number, total: number) => void
}

export const DEFAULT_PRODUCTION_RUNS = 4
export const MAX_PRODUCTION_RUNS = 200

const meanOrNull = (xs: (number | null)[]) => (xs.some((x) => x === null) ? null : mean(xs as number[]))

/** Lance `runs` tirages et les agrège (synchrone). */
export function runProduction(input: ProductionConfig, opts: RunProductionOptions = {}): ProductionSummary {
  const cfg = resolveTarget(normalizeProductionConfig(input))
  const book = productionPriceBook(cfg)
  const plan = buildPlan(cfg, book)
  const n = clamp(intOr(opts.runs, DEFAULT_PRODUCTION_RUNS), 1, MAX_PRODUCTION_RUNS)
  const seed = intOr(opts.seed, 1) >>> 0
  const runs: ProductionRun[] = []
  for (let i = 0; i < n; i++) {
    runs.push(simulateResolved(cfg, book, plan, runSeed(seed, i)))
    opts.onProgress?.(i + 1, n)
  }
  return summarizeResolved(cfg, book, plan, runs, seed)
}

/** Agrège des tirages déjà simulés (même configuration). */
export function summarizeProduction(input: ProductionConfig, runs: ProductionRun[], seed = 1): ProductionSummary {
  const cfg = resolveTarget(normalizeProductionConfig(input))
  const book = productionPriceBook(cfg)
  return summarizeResolved(cfg, book, buildPlan(cfg, book), runs, seed)
}

function priceLines(book: ProductionPriceBook, cfg: NormalizedProductionConfig, plan: Plan, used: { makinaGens: number[]; buy: boolean; sale: number[]; xpLevel: boolean; xpFecond: boolean }): PriceLine[] {
  const line = (key: string, kind: PriceLine['kind'], u: UnitPrice, unitLabel: string): PriceLine => ({
    key,
    kind,
    label: u.label,
    unit: unitLabel,
    value: u.value,
    complete: u.complete,
    bound: u.bound,
    estimated: u.estimated,
    origin: u.origin,
    itemId: u.itemId,
    missing: u.missing,
  })
  const out: PriceLine[] = [line('capture', 'cout', book.capture, 'monture')]
  if (used.buy) for (const id of plan.g1) out.push(line(`achat:${id}`, 'cout', book.g1Buy(id), 'monture'))
  if (cfg.mode !== 'brisage' || cfg.mateBeforeExtract)
    for (const g of FERTILITY_GAUGES) {
      const u = book.fuel[g]
      if (u && (book.batch.points[g] ?? 0) > 0) out.push(line(`fuel:${g}`, 'cout', u, `point (${g}, palier ${u.tier})`))
    }
  if (used.xpFecond) out.push(line('xp:fecond', 'cout', book.xpFecond, `point (mangeoire, palier ${book.xpFecond.tier})`))
  if (used.xpLevel) out.push(line('xp:level', 'cout', book.xpLevel, `point (mangeoire, palier ${book.xpLevel.tier})`))
  for (const g of used.makinaGens) {
    const u = book.makina[g]
    if (u) out.push(line(`makina:${g}`, 'cout', u, 'makina'))
  }
  if (cfg.mode !== 'brisage') out.push(line('ressource', 'revenu', book.resource.price, 'ressource'))
  if (cfg.mode === 'brisage' && book.rune) {
    out.push(line('rune', 'revenu', book.rune.price, 'rune'))
    out.push(line('brisage', 'revenu', book.rune.valuePerMount, 'monture brisée'))
  }
  for (const sp of used.sale) out.push(line(`vente:${sp}`, 'revenu', book.mountSale(sp).price, 'monture'))
  out.push(line('geneton', 'revenu', book.geneton, 'généton (net)'))
  return out
}

function summarizeResolved(cfg: NormalizedProductionConfig, book: ProductionPriceBook, plan: Plan, runs: ProductionRun[], seed: number): ProductionSummary {
  const H = cfg.horizonDays
  const n = Math.max(1, runs.length)
  const from = steadyWindowStart(H)
  const winDays = H - from + 1
  // ----- Séries journalières -----
  const daily: ProductionDailyStat[] = []
  for (let i = 0; i < H; i++) {
    const ds = runs.map((r) => r.days[i])
    const nk = distStat(ds.map((x) => x.netKnown))
    const ck = distStat(ds.map((x) => x.cumulativeKnown))
    const m = (f: (x: ProductionDay) => number) => mean(ds.map(f))
    daily.push({
      day: i + 1,
      paddocks: ds[0]?.paddocks ?? cfg.paddocks,
      net: { mean: nk.mean, p10: nk.p10, p90: nk.p90 },
      netRange: { low: meanOrNull(ds.map((x) => x.net.low)), high: meanOrNull(ds.map((x) => x.net.high)) },
      cumulative: { mean: ck.mean, p10: ck.p10, p90: ck.p90 },
      cumulativeRange: { low: meanOrNull(ds.map((x) => x.cumulative.low)), high: meanOrNull(ds.map((x) => x.cumulative.high)) },
      costKnown: m((x) => x.costKnown),
      revenueKnown: m((x) => x.revenueKnown),
      captures: m((x) => x.captures),
      bought: m((x) => x.bought),
      fecundations: m((x) => x.fecundations),
      matings: m((x) => x.matings),
      births: m((x) => x.births),
      targetBirths: m((x) => x.targetBirths),
      extracted: m((x) => x.extracted),
      resources: m((x) => x.resources),
      resourcesSold: m((x) => x.resourcesSold),
      resourceStock: m((x) => x.resourceStock),
      broken: m((x) => x.broken),
      mountsSold: m((x) => x.mountsSold),
      genetons: m((x) => x.genetons),
      held: m((x) => x.held),
      occupancy: m((x) => x.occupancy),
    })
  }
  // ----- Régime permanent -----
  const win = (r: ProductionRun) => r.days.slice(from - 1)
  const perRun = (f: (x: ProductionDay) => number) => mean(runs.map((r) => mean(win(r).map(f))))
  const perRunRange = (f: (x: ProductionDay) => number | null) => meanOrNull(runs.map((r) => meanOrNull(win(r).map(f))))
  const costCat = { capture: 0, achat: 0, carburant: 0, xp: 0, makina: 0 } as Record<ProductionCostCategory, number>
  const revCat = { ressources: 0, runes: 0, montures: 0, genetons: 0 } as Record<ProductionRevenueCategory, number>
  for (const c of Object.keys(costCat) as ProductionCostCategory[]) costCat[c] = perRun((x) => x.costByCategory[c])
  for (const c of Object.keys(revCat) as ProductionRevenueCategory[]) revCat[c] = perRun((x) => x.revenueByCategory[c])
  const netR: Range = { low: perRunRange((x) => x.net.low), high: perRunRange((x) => x.net.high) }
  const steady: SteadyState = {
    fromDay: from,
    toDay: H,
    days: winDays,
    netPerDay: distStat(runs.map((r) => mean(win(r).map((x) => x.netKnown)))),
    net: netR,
    revenue: { low: perRunRange((x) => x.revenue.low), high: perRunRange((x) => x.revenue.high) },
    cost: { low: perRunRange((x) => x.cost.low), high: perRunRange((x) => x.cost.high) },
    status: rangeStatus(netR),
    revenueKnown: perRun((x) => x.revenueKnown),
    costKnown: perRun((x) => x.costKnown),
    costByCategory: costCat,
    revenueByCategory: revCat,
    capturesPerDay: perRun((x) => x.captures),
    boughtPerDay: perRun((x) => x.bought),
    fecundationsPerDay: perRun((x) => x.fecundations),
    levelingsPerDay: perRun((x) => x.levelings),
    batchesPerDay: perRun((x) => x.batches),
    matingsPerDay: perRun((x) => x.matings),
    condemnedMatingsPerDay: perRun((x) => x.condemnedMatings),
    optimakinasPerDay: perRun((x) => x.optimakinas),
    birthsPerDay: perRun((x) => x.births),
    targetBirthsPerDay: perRun((x) => x.targetBirths),
    clonesPerDay: perRun((x) => x.clones),
    extractedPerDay: perRun((x) => x.extracted),
    resourcesPerDay: perRun((x) => x.resources),
    resourcesSoldPerDay: perRun((x) => x.resourcesSold),
    brokenPerDay: perRun((x) => x.broken),
    runesPerDay: perRun((x) => x.runes),
    runesSoldPerDay: perRun((x) => x.runesSold),
    forSalePerDay: perRun((x) => x.forSale),
    mountsSoldPerDay: perRun((x) => x.mountsSold),
    keptPerDay: perRun((x) => x.kept),
    genetonsPerDay: perRun((x) => x.genetons),
    jobXpPerDay: perRun((x) => x.jobXp),
    occupancy: perRun((x) => x.occupancy),
  }
  // ----- Montée en charge -----
  let rampUpDays: number | null = null
  const target = steady.netPerDay.mean
  if (target > 0) {
    for (let i = 0; i < H; i++) {
      const lo = Math.max(0, i - 6)
      const avg = mean(daily.slice(lo, i + 1).map((x) => x.net.mean))
      if (i >= Math.min(6, H - 1) && avg >= 0.9 * target) {
        rampUpDays = i + 1
        break
      }
    }
  }
  const firstDays = runs.map((r) => r.firstTargetDay).filter((x): x is number => x !== null)
  // ----- Capital -----
  let socle: InitialInvestment | null = null
  if (cfg.tier > 1 || book.xpTier > 1) {
    try {
      const consumed: Partial<Record<GaugeId, number>> = {}
      const tiers: Partial<Record<GaugeId, FuelTier>> = {}
      if (cfg.mode !== 'brisage' || cfg.mateBeforeExtract) {
        for (const g of FERTILITY_GAUGES) {
          consumed[g] = book.batch.points[g] ?? 0
          tiers[g] = book.batch.tiers[g] ?? cfg.tier
        }
        if (cfg.parentLevel > 1 || cfg.mode === 'brisage') {
          consumed.mangeoire = mountXpForLevel(cfg.mode === 'brisage' ? cfg.brisageLevel : cfg.parentLevel)
          tiers.mangeoire = book.xpTier
        }
      } else {
        consumed.mangeoire = mountXpForLevel(cfg.brisageLevel)
        tiers.mangeoire = cfg.tier
      }
      const maxPad = Math.max(cfg.paddocks, ...cfg.paddockSchedule.map((s) => s.paddocks))
      socle = socleInvestment(consumed, tiers, maxPad, { ctx: cfg.prices.ctx, rules: cfg.rules, jobLevel: cfg.jobLevel, tier: cfg.tier })
    } catch {
      socle = null
    }
  }
  const socleLow = socle ? socle.low * book.costFactor : 0
  const socleHigh = socle ? (socle.high === null ? null : socle.high * book.costFactor) : 0
  const peakCashNeed = mean(runs.map((r) => Math.max(0, -Math.min(0, ...r.days.map((x) => x.cumulativeKnown)))))
  let breakEvenDay: number | null = null
  for (const dstat of daily)
    if (dstat.cumulative.mean - socleLow >= 0 && dstat.day > 1) {
      // Premier jour où le cumul couvre le socle et reste positif ensuite.
      const after = daily.slice(dstat.day - 1)
      if (after.every((x) => x.cumulative.mean - socleLow >= 0)) {
        breakEvenDay = dstat.day
        break
      }
    }
  const capital: ProductionCapital = { socle, socleLow, socleHigh, peakCashNeed, total: socleLow + peakCashNeed, breakEvenDay }
  // ----- Totaux -----
  const tot = (f: (x: ProductionDay) => number) => mean(runs.map((r) => r.days.reduce((s, x) => s + f(x), 0)))
  const totals = {
    netKnown: distStat(runs.map((r) => r.days.reduce((s, x) => s + x.netKnown, 0))),
    revenueKnown: tot((x) => x.revenueKnown),
    costKnown: tot((x) => x.costKnown),
    captures: tot((x) => x.captures),
    bought: tot((x) => x.bought),
    matings: tot((x) => x.matings),
    births: tot((x) => x.births),
    extracted: tot((x) => x.extracted),
    resources: tot((x) => x.resources),
    resourcesSold: tot((x) => x.resourcesSold),
    broken: tot((x) => x.broken),
    mountsSold: tot((x) => x.mountsSold),
    genetons: tot((x) => x.genetons),
    jobXp: tot((x) => x.jobXp),
  }
  // ----- Marché -----
  const market: MarketCheck[] = []
  const endMean = (f: (x: ProductionDay) => number) => mean(runs.map((r) => f(r.days[r.days.length - 1])))
  const check = (kind: MarketCheck['kind'], info: MarketItemInfo, produced: number, sold: number, endStock: number): MarketCheck => {
    const marketPerDay = info.depth ? info.depth.perDayAvg : null
    return {
      kind,
      itemId: info.itemId,
      name: info.name,
      producedPerDay: produced,
      soldPerDay: sold,
      capPerDay: info.perDayCap,
      marketPerDay,
      shareOfMarket: marketPerDay && marketPerDay > 0 ? produced / marketPerDay : null,
      saturated: info.perDayCap !== null && produced > info.perDayCap * 1.02 + 0.05,
      endStock,
    }
  }
  if (cfg.mode !== 'brisage' && (steady.resourcesPerDay > 0 || totals.resources > 0))
    market.push(check('ressource', book.resource, steady.resourcesPerDay, steady.resourcesSoldPerDay, endMean((x) => x.resourceStock)))
  if (cfg.mode === 'brisage' && book.rune) market.push(check('rune', book.rune, steady.runesPerDay, steady.runesSoldPerDay, endMean((x) => x.runeStock)))
  // ----- Routine (régime permanent) -----
  const rdays = Math.max(1, mean(runs.map((r) => r.routine.days)))
  const perDayMap = (pick: (r: ProductionRun) => Map<number, number>) => {
    const acc = new Map<number, number>()
    for (const r of runs) for (const [k2, v] of pick(r)) addTo(acc, k2, v)
    return [...acc].map(([k2, v]) => [k2, v / n / rdays] as [number, number]).filter(([, v]) => v > 0)
  }
  const soldMap = perDayMap((r) => r.routine.sold)
  const soldBy = new Map(soldMap)
  const saleChecks: MarketCheck[] = []
  for (const [sp, produced] of perDayMap((r) => r.routine.forSale)) {
    const info = book.mountSale(sp)
    const sold = soldBy.get(sp) ?? 0
    saleChecks.push({
      kind: 'monture',
      itemId: getSpecies(sp)?.itemId ?? 0,
      speciesId: sp,
      name: info.name,
      producedPerDay: produced,
      soldPerDay: sold,
      capPerDay: info.perDayCap,
      marketPerDay: info.depth ? info.depth.perDayAvg : null,
      shareOfMarket: info.depth && info.depth.perDayAvg > 0 ? produced / info.depth.perDayAvg : null,
      saturated: info.perDayCap !== null && produced > info.perDayCap * 1.02 + 0.01,
      endStock: mean(runs.map((r) => r.inventory.forSale[sp] ?? 0)),
    })
  }
  // Les montures qui rapportent le plus d'abord (12 au plus).
  const saleValue = (c: MarketCheck) => c.soldPerDay * (book.mountSale(c.speciesId ?? 0).price.value ?? 0)
  saleChecks.sort((a, b) => saleValue(b) - saleValue(a))
  market.push(...saleChecks.slice(0, 12))
  const fuel: ProductionRoutine['fuel'] = []
  const gaugePts = (g: GaugeId) => perRun((x) => x.fuelPoints[g])
  for (const g of [...FERTILITY_GAUGES, 'mangeoire' as GaugeId]) {
    const pts = gaugePts(g)
    if (pts <= 0) continue
    const u = g === 'mangeoire' ? book.xpFecond : book.fuel[g]
    if (!u) continue
    fuel.push({
      gauge: g,
      tier: u.tier,
      pointsPerDay: pts,
      fuelId: u.itemId,
      fuelName: u.label,
      durability: u.durability,
      itemsPerDay: u.durability ? pts / u.durability : null,
      costPerDay: u.value === null || u.bound === 'max' ? null : pts * u.value * book.costFactor,
      complete: u.complete,
    })
  }
  const lvlPts = perRun((x) => x.levelXpPoints)
  if (lvlPts > 0)
    fuel.push({
      gauge: 'mangeoire',
      tier: book.xpLevel.tier,
      pointsPerDay: lvlPts,
      fuelId: book.xpLevel.itemId,
      fuelName: book.xpLevel.label,
      durability: book.xpLevel.durability,
      itemsPerDay: book.xpLevel.durability ? lvlPts / book.xpLevel.durability : null,
      costPerDay: book.xpLevel.value === null || book.xpLevel.bound === 'max' ? null : lvlPts * book.xpLevel.value * book.costFactor,
      complete: book.xpLevel.complete,
    })
  const routine: ProductionRoutine = {
    capturesPerDay: perDayMap((r) => r.routine.captures)
      .map(([speciesId, perDay]) => ({ speciesId, perDay }))
      .sort((a, b) => b.perDay - a.perDay),
    matingsPerDay: perDayMap((r) => r.routine.matings)
      .map(([speciesId, perDay]) => ({ speciesId, crossing: plan.crossing.get(speciesId) ?? null, perDay }))
      .sort((a, b) => gen(b.speciesId) - gen(a.speciesId) || b.perDay - a.perDay),
    condemnedMatingsPerDay: mean(runs.map((r) => r.routine.condemned)) / rdays,
    clonesPerDay: perDayMap((r) => r.routine.clones)
      .map(([generation, perDay]) => ({ generation, perDay }))
      .sort((a, b) => a.generation - b.generation),
    extractedPerDay: perDayMap((r) => r.routine.extracted)
      .map(([generation, perDay]) => ({ generation, perDay }))
      .sort((a, b) => b.generation - a.generation),
    soldPerDay: soldMap.map(([speciesId, perDay]) => ({ speciesId, perDay })).sort((a, b) => b.perDay - a.perDay),
    brokenPerDay: mean(runs.map((r) => r.routine.broken)) / rdays,
    batchesPerDay: mean(runs.map((r) => r.routine.batches)) / rdays,
    fuel,
  }
  // ----- Prix utilisés -----
  const makinaGens: number[] = []
  for (let g = 2; g <= 10; g++) if (runs.some((r) => r.days.some((x) => x.makinas[g] > 0))) makinaGens.push(g)
  const saleSpecies = [...new Set(runs.flatMap((r) => r.days.flatMap((x) => Object.keys(x.soldBySpecies).map(Number))))]
  const prices = priceLines(book, cfg, plan, {
    makinaGens,
    buy: totals.bought > 0,
    sale: saleSpecies,
    xpLevel: runs.some((r) => r.days.some((x) => x.levelXpPoints > 0)),
    xpFecond: runs.some((r) => r.days.some((x) => x.fuelPoints.mangeoire > 0)),
  })
  const usedLines = prices.filter((l) => l.key !== 'geneton' || totals.genetons > 0)
  const missing = [...new Set(usedLines.flatMap((l) => (l.complete ? [] : l.missing.length ? l.missing : l.itemId !== null ? [l.itemId] : [])))]
  const complete = usedLines.every((l) => l.complete)
  const estimated = usedLines.some((l) => l.estimated)
  // ----- Avertissements -----
  const warnings: ProductionWarning[] = []
  const fmt = (x: number) => Math.round(x).toLocaleString('fr-FR')
  for (const mc of market) {
    if (mc.saturated)
      warnings.push({
        code: 'saturation',
        tone: 'warn',
        text: `${mc.name} : la production (${fmt(mc.producedPerDay)}/jour) dépasse ce que le marché absorbe (${mc.capPerDay === null ? '?' : fmt(mc.capPerDay)}/jour = ${Math.round(book.maxMarketShare * 100)} % de ${mc.marketPerDay === null ? '?' : fmt(mc.marketPerDay)} ventes/jour) : le stock invendu grossit (≈ ${fmt(mc.endStock)} en fin de période).`,
      })
    if (mc.capPerDay === null && mc.producedPerDay > 0)
      warnings.push({ code: 'liquidite-inconnue', tone: 'warn', text: `${mc.name} : volume du marché inconnu (aucun export HDV importé) — les ventes ne sont pas plafonnées.` })
  }
  if (!complete) warnings.push({ code: 'prix-manquants', tone: 'warn', text: `${missing.length} prix manquant${missing.length > 1 ? 's' : ''} : les montants sont des bornes (« ≥ », « ≤ ») et jamais comptés 0. Renseignez-les (page Prix) ou importez l'export HDV du serveur.` })
  if (cfg.mode === 'brisage') warnings.push({ code: 'brisage-risque', tone: 'warn', text: BRISAGE_RISK_NOTE })
  if (cfg.mode === 'vente') warnings.push({ code: 'hdv-mixte', tone: 'info', text: `${MOUNT_MARKET_NOTE} Prix prudent : min des médianes × ${clamp(numOr(cfg.prices.mountSaleFactor, DEFAULT_MOUNT_SALE_FACTOR), 0, 2)}, seulement pour les bébés fertiles.` })
  if (totals.bought > 0) warnings.push({ code: 'achat-senile', tone: 'warn', text: "Montures achetées à l'HDV : vérifiez qu'elles ne sont pas séniles (d'avant la 3.5 : ni accouplement ni clonage)." })
  if (cfg.buyG1PerDay > 0 && totals.bought < 0.9 * cfg.buyG1PerDay * H)
    warnings.push({ code: 'achat-limite', tone: 'info', text: `Achats de G1 limités (${fmt(totals.bought / H)}/jour au lieu de ${fmt(cfg.buyG1PerDay)}) : volume du marché des objets-montures (${Math.round(book.maxMarketShare * 100)} %) ou places d'enclos libres.` })
  if (runs.some((r) => r.stableOverflow)) warnings.push({ code: 'etable', tone: 'warn', text: `Étable pleine (${cfg.rules.stableSlots} places) : les captures ont été suspendues ; prévoyez de stocker en banque ou de vendre plus vite.` })
  if (totals.genetons > 0 && book.geneton.estimated) warnings.push({ code: 'genetons', tone: 'info', text: `Génétons comptés à ${fmt(book.geneton.value ?? 0)} K net (${book.geneton.label}) : valeur estimée, liés au compte selon DPLN (revente des parchemins).` })
  if (cfg.mode !== 'brisage' && firstDays.length < runs.length)
    warnings.push({ code: 'cible-non-atteinte', tone: 'warn', text: `La génération visée (G${plan.T}) n'est pas atteinte dans ${runs.length - firstDays.length} tirage(s) sur ${runs.length} en ${H} jours : allongez la durée ou visez plus bas.` })
  else if (rampUpDays === null && steady.netPerDay.mean > 0 && cfg.mode !== 'brisage')
    warnings.push({ code: 'montee', tone: 'info', text: 'Le régime permanent n’est pas stabilisé sur la durée simulée (la production augmente encore).' })
  for (const note of plan.info.notes) warnings.push({ code: 'plan', tone: 'info', text: note })
  // ----- Hypothèses -----
  const cycleHours = 24 / cfg.sessionsPerDay
  const sessionsFecond = Math.max(1, Math.ceil((fecondSeconds(book.batch, cfg.tier, book.xpTier, cfg.rules, mountXpForLevel(cfg.mode === 'brisage' ? cfg.brisageLevel : cfg.parentLevel)) * cfg.durationFactor) / (86_400 / cfg.sessionsPerDay) - 1e-9))
  const capPerDay = cfg.captureRate * cfg.captureHoursPerDay
  const assumptions = [
    `Lot typique du planificateur au palier ${cfg.tier} (${fmt(book.batch.seconds / 60)} min de fécondation, ${fmt((book.batch.points.foudroyeur ?? 0) + (book.batch.points.abreuvoir ?? 0) + (book.batch.points.dragofesse ?? 0))} points de statistiques par lot) ; carburant compté par lot, quel que soit le nombre de montures.`,
    `${cfg.sessionsPerDay} passage${cfg.sessionsPerDay > 1 ? 's' : ''} aux enclos par jour (toutes les ${fmt(cycleHours)} h) : un lot de fécondation occupe ses places ${sessionsFecond} session${sessionsFecond > 1 ? 's' : ''}.`,
    `Captures : ${fmt(capPerDay)} montures/jour au plus (${cfg.characters} personnage${cfg.characters > 1 ? 's' : ''} × ${cfg.mountsPerCast} par lancer, ${cfg.fightsPerHour} combats/h — ESTIMATION —, ${cfg.captureHoursPerDay.toLocaleString('fr-FR')} h de capture/jour), seulement pour remplir les places libres.`,
    `Ventes plafonnées à ${Math.round(book.maxMarketShare * 100)} % du volume moyen du marché par jour ; invendus reportés au lendemain ; taxe ${Math.round(book.saleTax * 1000) / 10} %.`,
    'Sexes 50/50, naissances selon le modèle validé (arbres réels), joueur parfait (aucune session manquée) : compter ×1,5 sur les durées pour un joueur réel.',
    cfg.cloneKeepsLevel ? 'Le clone garde son niveau (inconnu en jeu, hypothèse de l’Optimiseur).' : 'Le clone repart au niveau 1.',
  ]
  if (cfg.mode === 'brisage') assumptions.push(`Brisage au niveau ${cfg.brisageLevel} : rendements observés (relevés communautaires) mis à l'échelle du prix de la rune Ga du serveur.`)
  if (cfg.mode === 'vente') assumptions.push('Seuls les bébés fertiles sont vendus ; le surplus au-delà de 3 jours de volume vendable est extrait.')
  if (cfg.mateBeforeExtract && cfg.mode !== 'progression') assumptions.push('« Accoupler avant d’extraire » : les montures de la génération visée sont fécondées et accouplées entre elles une fois (bébé gratuit), puis extraites.')
  const { prices: _p, rules: _r, initialStock: _i, ...rest } = cfg
  void _p
  void _r
  return {
    config: { ...rest, rulesId: cfg.rules.id, initialStockCount: _i.reduce((s, l) => s + l.count, 0) },
    plan: plan.info,
    runs: runs.length,
    seed,
    horizonDays: H,
    sessionsPerDay: cfg.sessionsPerDay,
    cycleHours,
    captureCapacityPerDay: capPerDay,
    batch: { tier: cfg.tier, xpTier: book.xpTier, seconds: book.batch.seconds, sessions: sessionsFecond, points: book.batch.points },
    daily,
    steady,
    rampUpDays,
    firstTargetDay: firstDays.length ? distStat(firstDays) : null,
    capital,
    totals,
    market,
    routine,
    prices,
    complete,
    missing,
    estimated,
    peakHeld: Math.max(...runs.map((r) => r.peakHeld)),
    stableOverflow: runs.some((r) => r.stableOverflow),
    ledger: runs[0]?.ledger ?? { initial: 0, captured: 0, bought: 0, born: 0, extracted: 0, broken: 0, sold: 0, kept: 0, discarded: 0, cloneLost: 0, remaining: 0 },
    warnings,
    assumptions,
  }
}

// ---------- Optimiseur ----------

/** Paramètres explorés par l'optimiseur. */
export interface StrategyParams {
  targetGeneration?: number
  parentLevel?: number
  optimakina?: OptimakinaPolicy
  tier?: FuelTier
  mateBeforeExtract?: boolean
  cloning?: CloningPolicy
  brisageLevel?: number
  targetSpeciesIds?: number[]
}

export interface OptimizeGrid {
  targetGeneration?: number[]
  parentLevel?: number[]
  optimakina?: OptimakinaPolicy[]
  tier?: FuelTier[]
  mateBeforeExtract?: boolean[]
  cloning?: CloningPolicy[]
  brisageLevel?: number[]
}

export interface OptimizeOptions {
  grid?: OptimizeGrid
  /** Grille réduite (comparaison rapide des modes). */
  quick?: boolean
  /** Tirages des meilleures stratégies (défaut 4). */
  runs?: number
  /** Tirages du premier tri (défaut 1). */
  screenRuns?: number
  /** Stratégies recalculées avec `runs` tirages (défaut 5). */
  keep?: number
  /** Résumés complets gardés (défaut 3 ; les autres : indicateurs seulement). */
  keepSummaries?: number
  horizonDays?: number
  seed?: number
  /**
   * Critère de classement : bénéfice net par jour en régime permanent (`steady`, défaut : page Modes)
   * ou moyen sur toute la durée, montée en charge comprise (`horizon` : estimateur d'investissement).
   */
  rankBy?: 'steady' | 'horizon'
}

export interface RankedStrategy {
  id: string
  label: string
  params: StrategyParams
  /** Bénéfice net connu par jour en régime permanent (moyenne des tirages). */
  steadyNet: number
  /** Bénéfice net connu moyen par jour sur toute la durée (montée en charge comprise). */
  horizonNet: number
  /** Valeur classée (`steadyNet` ou `horizonNet` selon `rankBy`, ou quantité produite si le produit n'a pas de prix). */
  score: number
  /** `kamas` ; `quantite` quand le prix du produit (ressource, rune) est inconnu : classement par production. */
  scoreBasis: 'kamas' | 'quantite'
  net: Range
  status: ProfitStatus
  /** Coûts entièrement chiffrés : la borne basse du bénéfice est connue (classement fiable). */
  comparable: boolean
  complete: boolean
  missing: number[]
  rampUpDays: number | null
  breakEvenDay: number | null
  capital: number
  resourcesPerDay: number
  brokenPerDay: number
  mountsSoldPerDay: number
  saturated: boolean
  targetGeneration: number
  runs: number
  summary: ProductionSummary | null
}

export interface ModeOptimization {
  mode: ProductionMode
  family: FamilyId
  strategies: RankedStrategy[]
  best: RankedStrategy | null
  evaluated: number
  notes: string[]
}

export interface ProgressInfo {
  done: number
  total: number
  label: string
}

/** Grille par défaut d'un mode (`quick` : grille réduite pour la comparaison des modes). */
export function defaultGrid(mode: ProductionMode, opts: { quick?: boolean } = {}): OptimizeGrid {
  if (mode === 'brisage')
    return opts.quick
      ? { brisageLevel: [45, 53, 60, 80], tier: [1, 2, 3], mateBeforeExtract: [false] }
      : { brisageLevel: [45, 53, 60, 80, 100], tier: [1, 2, 3], mateBeforeExtract: [false, true] }
  // Vente : les bébés visés sont vendus, « accoupler avant d'extraire » ne touche que les invendables.
  const mbe = mode === 'vente' || mode === 'progression' ? [true] : [true, false]
  if (opts.quick) return { targetGeneration: [2, 3, 4, 5, 6, 8, 10], parentLevel: [40], optimakina: ['auto'], tier: [1, 2, 3], mateBeforeExtract: mbe, cloning: [true] }
  return { targetGeneration: [2, 3, 4, 5, 6, 7, 8, 9, 10], parentLevel: [1, 40], optimakina: ['none', 'auto'], tier: [1, 2, 3], mateBeforeExtract: mbe, cloning: [true] }
}

function cartesian(grid: OptimizeGrid, mode: ProductionMode): StrategyParams[] {
  const out: StrategyParams[] = []
  if (mode === 'brisage') {
    for (const brisageLevel of grid.brisageLevel ?? [DEFAULT_BRISAGE_LEVEL])
      for (const tier of grid.tier ?? [2])
        for (const mateBeforeExtract of grid.mateBeforeExtract ?? [false]) out.push({ brisageLevel, tier, mateBeforeExtract, parentLevel: brisageLevel })
    return out
  }
  for (const targetGeneration of grid.targetGeneration ?? [2, 3, 4, 5, 6])
    for (const parentLevel of grid.parentLevel ?? [DEFAULT_PARENT_LEVEL])
      for (const optimakina of grid.optimakina ?? ['auto'])
        for (const tier of grid.tier ?? [2])
          for (const mateBeforeExtract of grid.mateBeforeExtract ?? [true])
            for (const cloning of grid.cloning ?? [true]) out.push({ targetGeneration, parentLevel, optimakina, tier, mateBeforeExtract, cloning })
  return out
}

function optiLabel(o: OptimakinaPolicy | undefined): string {
  if (o === undefined || o === 'auto') return 'Optimakina auto'
  if (o === 'none') return 'sans Optimakina'
  if (o === 'all') return 'Optimakina partout'
  return `Optimakina dès la G${o.fromGeneration}`
}

/** Libellé FR d'une stratégie. */
export function strategyLabel(mode: ProductionMode, p: StrategyParams): string {
  if (mode === 'brisage')
    return [`Brisage niv. ${p.brisageLevel ?? DEFAULT_BRISAGE_LEVEL}`, `palier ${p.tier ?? 2}`, p.mateBeforeExtract ? 'accoupler avant de briser' : 'sans accouplement'].join(' · ')
  const parts = [`G${p.targetGeneration ?? '?'}`, `parents niv. ${p.parentLevel ?? DEFAULT_PARENT_LEVEL}`, optiLabel(p.optimakina), `palier ${p.tier ?? 2}`]
  if (mode !== 'progression') parts.push(p.mateBeforeExtract === false ? 'extraction directe' : mode === 'vente' ? 'accoupler les invendables avant extraction' : 'accoupler avant d’extraire')
  if (p.cloning === false) parts.push('sans clonage')
  else if (typeof p.cloning === 'object') parts.push(`clonage jusqu’à G${p.cloning.maxGeneration}`)
  return parts.join(' · ')
}

function strategyId(p: StrategyParams): string {
  return JSON.stringify([p.targetGeneration ?? null, p.parentLevel ?? null, p.optimakina ?? null, p.tier ?? null, p.mateBeforeExtract ?? null, p.cloning ?? null, p.brisageLevel ?? null])
}

function rankStrategy(mode: ProductionMode, params: StrategyParams, s: ProductionSummary, keepSummary: boolean, rankBy: OptimizeOptions['rankBy'] = 'steady'): RankedStrategy {
  const horizonNet = s.totals.netKnown.mean / Math.max(1, s.horizonDays)
  // Sans prix du produit, le bénéfice connu ne compterait que les coûts : on classe par production.
  const productKey = mode === 'brisage' ? 'rune' : 'ressource'
  const productPriced = mode === 'vente' || mode === 'progression' || s.prices.some((l) => l.key === productKey && l.complete)
  const quantity = mode === 'brisage' ? s.steady.brokenPerDay : s.steady.resourcesPerDay
  return {
    id: strategyId(params),
    label: strategyLabel(mode, params),
    params,
    steadyNet: s.steady.netPerDay.mean,
    horizonNet,
    score: !productPriced ? quantity : rankBy === 'horizon' ? horizonNet : s.steady.netPerDay.mean,
    scoreBasis: productPriced ? 'kamas' : 'quantite',
    net: s.steady.net,
    status: s.steady.status,
    comparable: s.steady.net.low !== null,
    complete: s.complete,
    missing: s.missing,
    rampUpDays: s.rampUpDays,
    breakEvenDay: s.capital.breakEvenDay,
    capital: s.capital.total,
    resourcesPerDay: s.steady.resourcesPerDay,
    brokenPerDay: s.steady.brokenPerDay,
    mountsSoldPerDay: s.steady.mountsSoldPerDay,
    saturated: s.market.some((m) => m.saturated),
    targetGeneration: s.plan.targetGeneration,
    runs: s.runs,
    summary: keepSummary ? s : null,
  }
}

/** Classement : stratégies au coût chiffré d'abord, puis bénéfice connu par jour (`score`), puis montée en charge la plus courte. */
export function compareRanked(a: RankedStrategy, b: RankedStrategy): number {
  if (a.comparable !== b.comparable) return a.comparable ? -1 : 1
  if (Math.abs(b.score - a.score) > 1e-6) return b.score - a.score
  return (a.rampUpDays ?? Infinity) - (b.rampUpDays ?? Infinity)
}

function optimizeTotal(mode: ProductionMode, opts: OptimizeOptions): number {
  const pts = cartesian(opts.grid ?? defaultGrid(mode, { quick: opts.quick }), mode).length
  const screen = Math.max(1, intOr(opts.screenRuns, 1))
  const runs = Math.max(1, intOr(opts.runs, DEFAULT_PRODUCTION_RUNS))
  const keep = Math.min(pts, Math.max(0, intOr(opts.keep, 5)))
  return pts * screen + (runs > screen ? keep * runs : 0)
}

function* optimizeGen(mode: ProductionMode, base: ProductionConfig, opts: OptimizeOptions, label: string, offset: number, total: number): Generator<ProgressInfo, ModeOptimization, void> {
  const grid = opts.grid ?? defaultGrid(mode, { quick: opts.quick })
  const points = cartesian(grid, mode)
  const screenRuns = Math.max(1, intOr(opts.screenRuns, 1))
  const runs = Math.max(1, intOr(opts.runs, DEFAULT_PRODUCTION_RUNS))
  const keep = Math.min(points.length, Math.max(0, intOr(opts.keep, 5)))
  const keepSummaries = Math.max(0, intOr(opts.keepSummaries, 3))
  const horizonDays = intOr(opts.horizonDays, base.horizonDays || 60)
  const seed = intOr(opts.seed, 1)
  const planned = optimizeTotal(mode, opts)
  const notes: string[] = []
  let done = 0
  // Progression bornée à la part prévue de ce mode (le raffinement peut demander quelques calculs de plus).
  const progress = (): ProgressInfo => ({ done: offset + Math.min(done, Math.max(0, planned - 1)), total, label })
  const results: { params: StrategyParams; summary: ProductionSummary }[] = []
  for (const params of points) {
    const cfg: ProductionConfig = { ...base, mode, horizonDays, ...params }
    try {
      results.push({ params, summary: runProduction(cfg, { runs: screenRuns, seed }) })
    } catch (e) {
      notes.push(`${strategyLabel(mode, params)} : ${e instanceof Error ? e.message : String(e)}`)
    }
    done += screenRuns
    yield progress()
  }
  let ranked = results.map((r) => rankStrategy(mode, r.params, r.summary, false, opts.rankBy))
  const summaries = new Map(results.map((r) => [strategyId(r.params), r.summary]))
  ranked.sort(compareRanked)
  if (runs > screenRuns && keep > 0) {
    // Raffinement : les `keep` premières sont recalculées avec `runs` tirages ; on recommence tant qu'une
    // stratégie d'un seul tirage remonte dans le haut du classement (au plus 3 × keep recalculs).
    const refined = new Set<string>()
    let budget = 3 * keep
    for (;;) {
      const todo = ranked.slice(0, keep).filter((r) => !refined.has(r.id))
      if (!todo.length || budget <= 0) break
      for (const t of todo) {
        if (budget <= 0) break
        budget -= 1
        refined.add(t.id)
        const summary = runProduction({ ...base, mode, horizonDays, ...t.params }, { runs, seed })
        summaries.set(t.id, summary)
        const k2 = ranked.findIndex((x) => x.id === t.id)
        ranked[k2] = rankStrategy(mode, t.params, summary, false, opts.rankBy)
        done += runs
        yield progress()
      }
      ranked.sort(compareRanked)
    }
  }
  ranked = ranked.map((r, i) => (i < keepSummaries ? { ...r, summary: summaries.get(r.id) ?? null } : r))
  if (results.some((r) => !r.summary.complete))
    notes.push('Des prix manquent : les montants sont des bornes (« ≥ », « ≤ ») ; les stratégies dont un coût n’est pas chiffré sont classées après les autres.')
  if (ranked.some((r) => r.scoreBasis === 'quantite')) notes.push('Prix du produit inconnu : stratégies classées par quantité produite par jour (importez l’export HDV du serveur).')
  done = planned
  yield { done: offset + planned, total, label }
  return { mode, family: base.family, strategies: ranked, best: ranked[0] ?? null, evaluated: results.length, notes }
}

function drain<T>(gen: Generator<ProgressInfo, T, void>, onProgress?: (p: ProgressInfo) => void): T {
  for (;;) {
    const r = gen.next()
    if (r.done) return r.value
    onProgress?.(r.value)
  }
}

async function drainAsync<T>(gen: Generator<ProgressInfo, T, void>, opts: { onProgress?: (p: ProgressInfo) => void; shouldStop?: () => boolean; sliceMs?: number }): Promise<T | null> {
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

/**
 * Optimise un mode : évalue une grille (génération visée, niveau des parents, Optimakina, palier,
 * « accoupler avant d'extraire », clonage ; brisage : niveau, palier) avec `screenRuns` tirages, puis
 * recalcule les `keep` meilleures avec `runs` tirages. Classement par bénéfice net connu par jour en
 * régime permanent (coûts chiffrés d'abord), puis montée en charge.
 */
export function optimizeMode(mode: ProductionMode, base: ProductionConfig, opts: OptimizeOptions & { onProgress?: (p: ProgressInfo) => void } = {}): ModeOptimization {
  const total = optimizeTotal(mode, opts)
  return drain(optimizeGen(mode, base, opts, PRODUCTION_MODE_LABELS[mode], 0, total), opts.onProgress)
}

/** Même chose en rendant la main au navigateur (repli sans Web Worker) ; null si arrêté. */
export function optimizeModeAsync(
  mode: ProductionMode,
  base: ProductionConfig,
  opts: OptimizeOptions & { onProgress?: (p: ProgressInfo) => void; shouldStop?: () => boolean; sliceMs?: number } = {},
): Promise<ModeOptimization | null> {
  const total = optimizeTotal(mode, opts)
  return drainAsync(optimizeGen(mode, base, opts, PRODUCTION_MODE_LABELS[mode], 0, total), opts)
}

// ---------- Comparaison des modes (page « Modes de rentabilité ») ----------

/** Contraintes du profil pour comparer les modes. */
export interface ProfileProductionContext {
  rules: Ruleset
  prices: ProductionPrices
  jobLevel: number
  /** Enclos débloqués (défaut : d'après le niveau d'Éleveur). */
  paddocks?: number
  paddockSchedule?: PaddockStep[]
  hoursPerDay: number
  sessionsPerDay?: number
  captureHoursPerDay?: number
  /** Personnages pour les captures (`settings.accounts`). */
  characters: number
  netKind?: NetKind
  mountsPerCast?: number
  fightsPerHour?: number
  buyG1PerDay?: number
  initialStock?: InitialStockLine[]
  horizonDays?: number
  runs?: number
  /** Modes à comparer (défaut `COMPARED_MODES`). */
  modes?: ProfitModeId[]
  /** Grilles réduites (défaut vrai). */
  quick?: boolean
  grid?: Partial<Record<ProductionMode, OptimizeGrid>>
  seed?: number
}

export interface ModeComparisonRow {
  modeId: ProfitModeId
  def: ProfitModeDef
  /** Famille retenue (meilleure famille pour la vente). */
  family: FamilyId | null
  best: RankedStrategy | null
  optimization: ModeOptimization | null
  /** Vente : meilleure stratégie par famille. */
  variants: { family: FamilyId; best: RankedStrategy | null }[]
  available: boolean
  reason?: string
}

export interface ModeComparison {
  rows: ModeComparisonRow[]
  /** Mode le plus rentable par jour (« auto »), parmi les stratégies au coût chiffré. */
  bestMode: ProfitModeId | null
  horizonDays: number
  notes: string[]
}

/** Configuration de base d'un mode pour un profil. */
export function baseConfigFor(ctx: ProfileProductionContext, family: FamilyId, mode: ProductionMode): ProductionConfig {
  return {
    family,
    mode,
    paddocks: ctx.paddocks ?? Math.max(1, unlockedPaddocks(ctx.jobLevel)),
    paddockSchedule: ctx.paddockSchedule,
    hoursPerDay: ctx.hoursPerDay,
    sessionsPerDay: ctx.sessionsPerDay,
    captureHoursPerDay: ctx.captureHoursPerDay,
    characters: ctx.characters,
    netKind: ctx.netKind,
    mountsPerCast: ctx.mountsPerCast,
    fightsPerHour: ctx.fightsPerHour,
    buyG1PerDay: ctx.buyG1PerDay,
    initialStock: ctx.initialStock?.filter((l) => getSpecies(l.speciesId)?.family === family),
    jobLevel: ctx.jobLevel,
    rules: ctx.rules,
    prices: ctx.prices,
    horizonDays: ctx.horizonDays ?? 60,
  }
}

function unlockedPaddocks(jobLevel: number): number {
  return [1, 40, 80, 120, 160, 200].filter((l) => l <= Math.max(1, jobLevel)).length
}

interface CompareJob {
  modeId: ProfitModeId
  family: FamilyId
  mode: ProductionMode
  opts: OptimizeOptions
}

function compareJobs(ctx: ProfileProductionContext): CompareJob[] {
  const ids = ctx.modes ?? COMPARED_MODES
  const jobs: CompareJob[] = []
  for (const id of ids) {
    const def = profitMode(id)
    if (!def || !def.mode) continue
    const mode = def.mode
    const quick = ctx.quick ?? true
    const opts: OptimizeOptions = { quick, grid: ctx.grid?.[mode], runs: ctx.runs ?? 3, keep: 3, keepSummaries: 1, horizonDays: ctx.horizonDays ?? 60, seed: ctx.seed }
    for (const family of def.families) {
      if (mode === 'brisage' && BRISAGE_RUNE[family] === null) continue
      jobs.push({ modeId: id, family, mode, opts })
    }
  }
  return jobs
}

function* compareGen(ctx: ProfileProductionContext): Generator<ProgressInfo, ModeComparison, void> {
  const jobs = compareJobs(ctx)
  const total = jobs.reduce((s, j) => s + optimizeTotal(j.mode, j.opts), 0)
  let offset = 0
  const results = new Map<string, ModeOptimization>()
  for (const j of jobs) {
    const def = profitMode(j.modeId) as ProfitModeDef
    const label = def.families.length > 1 ? `${def.short} (${FAMILIES[j.family].plural})` : def.short
    const res = yield* optimizeGen(j.mode, baseConfigFor(ctx, j.family, j.mode), j.opts, label, offset, total)
    offset += optimizeTotal(j.mode, j.opts)
    results.set(`${j.modeId}|${j.family}`, res)
  }
  const rows: ModeComparisonRow[] = []
  for (const id of ctx.modes ?? COMPARED_MODES) {
    const def = profitMode(id)
    if (!def || !def.mode) continue
    const variants = def.families
      .map((f) => ({ family: f, opt: results.get(`${id}|${f}`) ?? null }))
      .filter((v) => v.opt)
      .map((v) => ({ family: v.family, best: v.opt?.best ?? null, opt: v.opt as ModeOptimization }))
    const sorted = [...variants].filter((v) => v.best).sort((a, b) => compareRanked(a.best as RankedStrategy, b.best as RankedStrategy))
    const top = sorted[0] ?? null
    rows.push({
      modeId: id,
      def,
      family: top?.family ?? def.families[0] ?? null,
      best: top?.best ?? null,
      optimization: top?.opt ?? null,
      variants: def.families.length > 1 ? variants.map((v) => ({ family: v.family, best: v.best })) : [],
      available: !!top?.best,
      reason: top?.best ? undefined : variants.length ? 'Aucune stratégie simulable avec ces contraintes.' : 'Mode indisponible pour cette famille.',
    })
  }
  const candidates = rows.filter((r) => r.best && r.best.comparable && r.best.scoreBasis === 'kamas')
  candidates.sort((a, b) => compareRanked(a.best as RankedStrategy, b.best as RankedStrategy))
  const notes: string[] = []
  if (rows.some((r) => r.best && !r.best.comparable)) notes.push('Certains modes ont des coûts non chiffrés : ils ne peuvent pas être départagés avec certitude (bénéfice « ≤ »).')
  return { rows, bestMode: candidates[0]?.modeId ?? null, horizonDays: ctx.horizonDays ?? 60, notes }
}

/** Meilleure stratégie de chaque mode pour un profil (synchrone : Web Worker ou tests). */
export function compareModes(ctx: ProfileProductionContext, opts: { onProgress?: (p: ProgressInfo) => void } = {}): ModeComparison {
  return drain(compareGen(ctx), opts.onProgress)
}

/** Même chose en rendant la main au navigateur (repli sans Web Worker) ; null si arrêté. */
export function compareModesAsync(ctx: ProfileProductionContext, opts: { onProgress?: (p: ProgressInfo) => void; shouldStop?: () => boolean; sliceMs?: number } = {}): Promise<ModeComparison | null> {
  return drainAsync(compareGen(ctx), opts)
}

/** Simulation d'une configuration en rendant la main au navigateur ; null si arrêtée. */
export async function runProductionAsync(input: ProductionConfig, opts: RunProductionOptions & { shouldStop?: () => boolean; sliceMs?: number } = {}): Promise<ProductionSummary | null> {
  const cfg = resolveTarget(normalizeProductionConfig(input))
  const book = productionPriceBook(cfg)
  const plan = buildPlan(cfg, book)
  const n = clamp(intOr(opts.runs, DEFAULT_PRODUCTION_RUNS), 1, MAX_PRODUCTION_RUNS)
  const seed = intOr(opts.seed, 1) >>> 0
  const runs: ProductionRun[] = []
  let last = Date.now()
  for (let i = 0; i < n; i++) {
    if (opts.shouldStop?.()) return null
    runs.push(simulateResolved(cfg, book, plan, runSeed(seed, i)))
    opts.onProgress?.(i + 1, n)
    if (Date.now() - last > (opts.sliceMs ?? 40)) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      last = Date.now()
    }
  }
  return summarizeResolved(cfg, book, plan, runs, seed)
}
