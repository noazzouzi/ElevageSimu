// Modes de rentabilité (docs/SPEC-v2.md §4) : définitions des modes, configuration de production d'un
// mode pour un profil, classement des modes, analyse d'un résultat (stratégie retenue et pourquoi,
// sensibilité au prix du produit, liquidité) et ROUTINE QUOTIDIENNE précise (quoi capturer, quelles
// générations accoupler / cloner / extraire / vendre / briser, jauges et palier, carburant à acheter ou à
// fabriquer, quand et combien vendre).
//
// S'appuie sur le moteur de production (production.ts : simulation, optimiseur, comparaison des modes) :
// ce module ne simule rien lui-même. Les résultats sont résumés en `ModeOutcome` (sérialisable, compact)
// pour être gardés d'une visite à l'autre (accueil, plan, conseiller) sans relancer la simulation.
//
// Module pur : aucun React, aucun store. Un prix inconnu n'est jamais compté 0 (montants en `Range`).
import { FAMILIES, getSpecies } from '../data'
import { formatKamas, formatKamasRange, formatNumber, formatPercent } from '../lib/format'
import { NET_KIND_LABELS, unlockedPaddockCount, type NetKind, type ProfitStatus, type Range } from './economy'
import { marketItemName } from './market'
import {
  compareRanked,
  DEFAULT_BRISAGE_LEVEL,
  rankWithTies,
  statisticalTie,
  DEFAULT_PARENT_LEVEL,
  PRODUCTION_COST_LABELS,
  PRODUCTION_REVENUE_LABELS,
  PROFIT_MODES,
  rangeStatus,
  type MarketCheck,
  type ModeComparison,
  type ModeComparisonRow,
  type OptimakinaPolicy,
  type PriceLine,
  type ProductionConfig,
  type ProductionCostCategory,
  type ProductionMode,
  type ProductionPlanInfo,
  type ProductionPrices,
  type ProductionRevenueCategory,
  type ProductionRoutine,
  type ProductionSummary,
  type ProductionWarning,
  type ProfileProductionContext,
  type ProfitModeDef,
  type ProfitModeId,
  type PurchaseCheck,
  type RankedStrategy,
  type SteadyState,
  type StrategyParams,
} from './production'
import type { Ruleset } from './rules'
import type { FamilyId, FuelTier, GaugeId } from './types'

// ---------- Définitions ----------

/** Identifiant d'un mode (réglage `settings.mode` du profil). */
export type ModeId = ProfitModeId

/** Groupe de mode : ce que deviennent les montures produites. */
export type ModeKind = 'rush' | 'brisage' | 'vente' | 'progression' | 'auto'

/** Nature du revenu principal. */
export type ModeRevenueKind = 'ressource' | 'rune' | 'monture' | 'progression' | 'meilleur'

export interface ModeRisk {
  code: string
  tone: 'danger' | 'warn' | 'info'
  /** Libellé court (badge). */
  label: string
  /** Explication (infobulle, détail). */
  text: string
}

export interface ModeDef extends ProfitModeDef {
  kind: ModeKind
  /** Famille unique du mode (rush, brisage), null sinon (vente : meilleure famille ; progression : celle du profil). */
  family: FamilyId | null
  /** Objet produit (ressource d'extraction ou rune Ga), null sinon. */
  resourceItemId: number | null
  resourceName: string | null
  revenueKind: ModeRevenueKind
  /** Présentation en une ou deux phrases. */
  description: string
  /** Risques propres au mode (indépendants des prix). */
  risks: ModeRisk[]
  icon: string
}

/** Ordre d'affichage des modes. */
export const MODE_IDS: ModeId[] = ['auto', 'rush-corne', 'rush-ambre', 'rush-neurone', 'brisage-pa', 'brisage-pm', 'vente-montures', 'progression']

/** Mode d'un profil migré ou nouveau : comportement d'avant les modes (objectif de génération). */
export const DEFAULT_MODE: ModeId = 'progression'

/** Durée simulée pour comparer les modes (jours). */
export const MODE_HORIZON_DAYS = 60

/** Version du modèle de comparaison (clé des hypothèses : un calcul plus ancien est à recalculer). */
export const MODE_MODEL_VERSION = 2

const RISK_BRISAGE: ModeRisk = {
  code: 'brisage-correctif',
  tone: 'warn',
  label: 'Correctif possible',
  text: 'Le brisage des montures peut être corrigé par Ankama (rendements en runes) : ne bâtissez pas tout votre capital dessus.',
}
const RISK_HDV_MIXTE: ModeRisk = {
  code: 'hdv-mixte',
  tone: 'warn',
  label: 'HDV mixte',
  text: 'Prix des objets-montures mélangés (niveaux, fertile/stérile, montures séniles d’avant la 3.5) : prix de vente prudent, à vérifier avant chaque vente.',
}
const RISK_LONG_RAMP: ModeRisk = {
  code: 'montee-longue',
  tone: 'info',
  label: 'Montée longue',
  text: 'Les générations hautes demandent plusieurs semaines avant le régime permanent (et du capital avancé).',
}

const KIND_OF: Record<ModeId, ModeKind> = {
  auto: 'auto',
  'rush-corne': 'rush',
  'rush-ambre': 'rush',
  'rush-neurone': 'rush',
  'brisage-pa': 'brisage',
  'brisage-pm': 'brisage',
  'vente-montures': 'vente',
  progression: 'progression',
}

const ICONS: Record<ModeId, string> = {
  auto: '✨',
  'rush-corne': '🦌',
  'rush-ambre': '🟠',
  'rush-neurone': '🧠',
  'brisage-pa': '🔨',
  'brisage-pm': '🔨',
  'vente-montures': '🏷️',
  progression: '🧬',
}

const DESCRIPTIONS: Record<ModeId, string> = {
  auto: 'Le mode le plus rentable par jour pour ce profil, d’après la dernière comparaison (prix et volume du marché de votre serveur).',
  'rush-corne':
    'Chaque enclos produit des Volkornes de la génération retenue ; elles sont accouplées une fois (bébé gratuit) puis extraites : une Volkorne GN rend N Cornes de volkorne. La Corne est la ressource la plus échangée : le marché absorbe de gros volumes.',
  'rush-ambre': 'Même principe avec les Muldos : une Muldo GN extraite rend N Ambres de muldo. L’Ambre se vend un peu plus cher, sur un marché plus étroit que la Corne.',
  'rush-neurone': 'Même principe avec les Dragodindes (zone de capture collée aux enclos) : une Dragodinde GN extraite rend N Neurones de dragodinde.',
  'brisage-pa': 'Capturer des Volkornes G1, les monter au niveau optimal (Mangeoire seule) puis les briser en runes Ga Pa. Peu de capital, montée en charge rapide, mais dépend d’un correctif possible.',
  'brisage-pm': 'Capturer des Muldos G1, les monter au niveau optimal puis les briser en runes Ga Pme.',
  'vente-montures':
    'Produire les montures que l’HDV de ce serveur paie le mieux (prix prudent × volume), les vendre fertiles dans la limite du volume, extraire le reste.',
  progression: 'Objectif de génération ou de succès (comportement d’avant les modes) : les montures visées sont gardées, les génétons et la progression priment.',
}

const REVENUE_KIND: Record<ModeId, ModeRevenueKind> = {
  auto: 'meilleur',
  'rush-corne': 'ressource',
  'rush-ambre': 'ressource',
  'rush-neurone': 'ressource',
  'brisage-pa': 'rune',
  'brisage-pm': 'rune',
  'vente-montures': 'monture',
  progression: 'progression',
}

/** Modes de rentabilité (définitions du moteur de production complétées). */
export const MODES: ModeDef[] = MODE_IDS.map((id) => {
  const base = PROFIT_MODES.find((m) => m.id === id) as ProfitModeDef
  const kind = KIND_OF[id]
  const family = kind === 'rush' || kind === 'brisage' ? (base.families[0] ?? null) : null
  const risks: ModeRisk[] = []
  if (kind === 'brisage') risks.push(RISK_BRISAGE)
  if (kind === 'vente') risks.push(RISK_HDV_MIXTE)
  return {
    ...base,
    kind,
    family,
    resourceItemId: base.itemId,
    resourceName: base.itemId !== null ? marketItemName(base.itemId) : null,
    revenueKind: REVENUE_KIND[id],
    description: DESCRIPTIONS[id],
    risks,
    icon: ICONS[id],
  }
})

const MODE_BY_ID = new Map(MODES.map((m) => [m.id, m]))

export function isModeId(v: unknown): v is ModeId {
  return typeof v === 'string' && MODE_BY_ID.has(v as ModeId)
}

/** Définition d'un mode (mode inconnu → progression). */
export function modeDef(id: string | null | undefined): ModeDef {
  return MODE_BY_ID.get(id as ModeId) ?? (MODE_BY_ID.get(DEFAULT_MODE) as ModeDef)
}

/** Mode simulé par le moteur de production (null : `auto`). */
export function productionModeOf(id: ModeId): ProductionMode | null {
  return modeDef(id).mode
}

// ---------- Profil → configuration de production ----------

/** Contraintes du profil pour simuler un mode (réglages, prix et marché du serveur). */
export interface ModeProfile {
  jobLevel: number
  hoursPerDay: number
  /** Personnages qui lancent un filet à chaque combat (`settings.accounts`). */
  characters: number
  rules: Ruleset
  /** Prix : `{ctx: usePriceContext(), saleTax, maxMarketShare: server.maxMarketShare, mountPrices, genetonValue}`. */
  prices: ProductionPrices
  /** Enclos débloqués (défaut : d'après le niveau d'Éleveur). */
  paddocks?: number
  /** XP déjà gagnée dans le niveau d'Éleveur (montée naturelle du métier pendant la simulation). */
  jobXp?: number
  /**
   * Enclos figés au niveau actuel (pas de montée naturelle du métier par l'XP d'élevage). Défaut faux :
   * les enclos et filets se débloquent en cours de route, comme « Sans investissement » de l'estimateur.
   */
  fixedPaddocks?: boolean
  sessionsPerDay?: number
  horizonDays?: number
  /** Famille du profil (progression). */
  family?: FamilyId
  /** Réglages de la stratégie conseillée (progression). */
  parentTargetLevel?: number
  preferredTier?: FuelTier
  useOptimakina?: boolean
  goalSpeciesId?: number | null
}

/** Enclos utilisés pour un profil. */
export function profilePaddocks(p: Pick<ModeProfile, 'paddocks' | 'jobLevel'>): number {
  return Math.max(1, Math.min(6, Math.floor(p.paddocks ?? unlockedPaddockCount(p.jobLevel))))
}

/** Contexte de comparaison des modes (`compareModes` / worker `compare`). */
export function modeProfileContext(p: ModeProfile, opts: { modes?: ModeId[]; quick?: boolean; runs?: number; horizonDays?: number; seed?: number } = {}): ProfileProductionContext {
  return {
    rules: p.rules,
    prices: p.prices,
    jobLevel: p.jobLevel,
    paddocks: profilePaddocks(p),
    hoursPerDay: p.hoursPerDay,
    sessionsPerDay: p.sessionsPerDay,
    characters: Math.max(1, Math.round(p.characters || 1)),
    horizonDays: opts.horizonDays ?? p.horizonDays ?? MODE_HORIZON_DAYS,
    // Montée naturelle du métier : enclos (40/80/120/160/200) et filets débloqués par l'XP d'élevage.
    naturalLeveling: !p.fixedPaddocks,
    jobXp: p.jobXp,
    modes: opts.modes?.filter((m) => productionModeOf(m) !== null),
    quick: opts.quick ?? true,
    runs: opts.runs,
    seed: opts.seed,
  }
}

/**
 * Configuration de production d'un mode pour un profil (null pour `auto`, qui désigne un autre mode).
 * Vente : famille `opts.family` (défaut : la famille du profil si elle est évaluée, sinon la première).
 * Progression : famille, niveau des parents, palier et Optimakina des réglages ; génération de la monture
 * visée (sinon automatique). `opts.params` (stratégie retenue) remplace les valeurs par défaut.
 */
export function modeConfig(mode: ModeId, p: ModeProfile, opts: { family?: FamilyId; params?: StrategyParams } = {}): ProductionConfig | null {
  const def = modeDef(mode)
  if (!def.mode) return null
  const family: FamilyId =
    def.family ?? (opts.family && def.families.includes(opts.family) ? opts.family : p.family && def.families.includes(p.family) ? p.family : (def.families[0] ?? 'muldo'))
  const cfg: ProductionConfig = {
    family,
    mode: def.mode,
    targetGeneration: 'auto',
    paddocks: profilePaddocks(p),
    hoursPerDay: p.hoursPerDay,
    sessionsPerDay: p.sessionsPerDay,
    characters: Math.max(1, Math.round(p.characters || 1)),
    jobLevel: p.jobLevel,
    rules: p.rules,
    prices: p.prices,
    horizonDays: p.horizonDays ?? MODE_HORIZON_DAYS,
  }
  if (def.mode === 'progression') {
    const goal = p.goalSpeciesId !== null && p.goalSpeciesId !== undefined ? getSpecies(p.goalSpeciesId) : undefined
    if (goal && goal.family === family && goal.breedable && goal.generation >= 2) cfg.targetSpeciesIds = [goal.id]
    if (p.parentTargetLevel) cfg.parentLevel = p.parentTargetLevel
    if (p.preferredTier) cfg.tier = p.preferredTier
    if (p.useOptimakina !== undefined) cfg.optimakina = p.useOptimakina ? 'auto' : 'none'
  }
  const params = opts.params ?? {}
  for (const [k, v] of Object.entries(params)) if (v !== undefined) (cfg as unknown as Record<string, unknown>)[k] = v
  return cfg
}

/**
 * Stratégie par défaut d'un mode tant que la comparaison n'a pas été calculée (repères de Tylezia,
 * docs/api/production.md) : rushs et vente G6, parents niveau 40, Optimakina selon la règle de prix,
 * palier 2, accoupler avant d'extraire ; brisage au niveau 80, palier 1.
 */
export function defaultModeParams(mode: ModeId): StrategyParams {
  const kind = modeDef(mode).kind
  if (kind === 'brisage') return { brisageLevel: 80, parentLevel: 80, tier: 1, mateBeforeExtract: false }
  return { targetGeneration: 6, parentLevel: DEFAULT_PARENT_LEVEL, optimakina: 'auto', tier: 2, mateBeforeExtract: true, cloning: true }
}

/**
 * Clé des hypothèses d'un calcul (niveau, enclos, temps de jeu, personnages, règles, marché et instant de
 * son import, prix saisis par le joueur, prix par défaut, taxe, part du marché) : un résultat enregistré
 * avec une autre clé est « à recalculer ».
 */
/** JSON à clés triées (empreinte stable d'un objet de prix, quel que soit l'ordre d'insertion). */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object')
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  return JSON.stringify(v ?? null)
}

/** Empreinte FNV-1a 32 bits (hexadécimal) d'un texte. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * Empreinte des PRIX d'un calcul : prix saisis par le joueur (objets, montures par couleur et par
 * génération), « utiliser les prix par défaut », instant de l'import du marché (un nouvel import du même
 * jour) et liquidité connue. Une saisie sur la page Prix rend les résultats enregistrés « à recalculer ».
 */
export function modePriceFingerprint(prices: ProductionPrices): string {
  const ctx = prices.ctx
  const mp = prices.mountPrices
  const m = ctx.market
  return fnv1a(
    stableJson([
      ctx.overrides ?? {},
      ctx.useDefaults !== false,
      mp ? [mp.mountOverrides ?? {}, mp.generationOverrides ?? {}, mp.useDefaults !== false] : null,
      m ? [m.importedAt ?? null, m.volumeUnknown === true, m.originServer ?? null] : null,
    ]),
  )
}

export function modeContextKey(p: ModeProfile, extra: { serverId?: string; quick?: boolean } = {}): string {
  const m = p.prices.ctx.market
  return JSON.stringify([
    // Version du modèle (régime stabilisé, montée naturelle du métier, ventes « HDV mixte » à part) :
    // un calcul enregistré avant ces corrections est à recalculer.
    MODE_MODEL_VERSION,
    p.fixedPaddocks ? 'enclos-figes' : 'montee-naturelle',
    p.prices.trustMixedMountPrices ? 'hdv-mixte-compte' : 'hdv-mixte-a-part',
    p.jobLevel,
    profilePaddocks(p),
    p.hoursPerDay,
    Math.max(1, Math.round(p.characters || 1)),
    p.rules.id,
    m ? `${m.serverName ?? ''}|${m.exportDate}|${m.stat}` : null,
    p.prices.saleTax ?? 0.02,
    p.prices.maxMarketShare ?? 0.15,
    p.prices.genetonValue ?? null,
    extra.serverId ?? null,
    // Prix de montures du joueur : ils décident des espèces vendues (et rendent une vente non spéculative).
    p.prices.mountPrices ? JSON.stringify([p.prices.mountPrices.mountOverrides ?? {}, p.prices.mountPrices.generationOverrides ?? {}]) : null,
    // Prix saisis des objets (Corne, carburants, makinas…), défauts de la recherche, import du marché.
    modePriceFingerprint(p.prices),
    // Génétons exclus (option « sans génétons » de la page Modes) : ajouté seulement dans ce cas, pour ne pas
    // périmer les calculs enregistrés avec les génétons.
    ...(p.prices.includeGenetons === false ? ['sans-genetons'] : []),
  ])
}

// ---------- Résultats compacts (sérialisables) ----------

/** Ce qu'il faut garder d'un `ProductionSummary` pour afficher un mode et sa routine (≈ 5–10 Ko). */
export interface ModeDigest {
  family: FamilyId
  mode: ProductionMode
  config: {
    targetGeneration: number
    parentLevel: number
    brisageLevel: number
    tier: FuelTier
    mateBeforeExtract: boolean
    optimakina: OptimakinaPolicy
    paddocks: number
    sessionsPerDay: number
    hoursPerDay: number
    characters: number
    netKind: NetKind
    mountsPerCast: number
    captureRate: number
    captureHoursPerDay: number
    horizonDays: number
    rulesId: string
    /** Montures au départ de la simulation (0 = élevage vide ; absent des anciens résultats). */
    initialStockCount?: number
  }
  runs: number
  cycleHours: number
  captureCapacityPerDay: number
  batch: ProductionSummary['batch']
  steady: SteadyState
  rampUpDays: number | null
  firstTargetDay: number | null
  /** Premier jour (moyenne des tirages) où la production vend ou brise quelque chose (absent des anciens résultats). */
  firstSaleDay?: number | null
  capital: { socleLow: number; socleHigh: number | null; peakCashNeed: number; total: number; breakEvenDay: number | null }
  market: MarketCheck[]
  /** Achats au marché face au volume du serveur (absent des résultats enregistrés avant la revue UX2). */
  purchases?: PurchaseCheck[]
  routine: ProductionRoutine
  plan: Pick<ProductionPlanInfo, 'targetGeneration' | 'targets' | 'steps' | 'captureShares' | 'optimakina'>
  prices: PriceLine[]
  complete: boolean
  missing: number[]
  estimated: boolean
  warnings: ProductionWarning[]
  assumptions: string[]
  /** Bénéfice net connu moyen par jour (courbe de montée en charge). */
  netByDay: number[]
  /** Cumul connu moyen par jour. */
  cumulativeByDay: number[]
  /** Vente chiffrée au prix « HDV mixte » (sans prix du joueur) : projection spéculative. */
  speculative: boolean
  /** Enclos débloqués en cours de route (montée naturelle du métier, jalons). */
  paddockSchedule: { day: number; paddocks: number }[]
}

/** Résume un résultat de simulation pour l'affichage et la routine. */
export function digestSummary(s: ProductionSummary): ModeDigest {
  const c = s.config
  return {
    family: c.family,
    mode: c.mode,
    config: {
      targetGeneration: s.plan.targetGeneration,
      parentLevel: c.parentLevel,
      brisageLevel: c.brisageLevel,
      tier: c.tier,
      mateBeforeExtract: c.mateBeforeExtract,
      optimakina: c.optimakina,
      paddocks: c.paddocks,
      sessionsPerDay: s.sessionsPerDay,
      hoursPerDay: c.hoursPerDay,
      characters: c.characters,
      netKind: c.netKind,
      mountsPerCast: c.mountsPerCast,
      captureRate: c.captureRate,
      captureHoursPerDay: c.captureHoursPerDay,
      horizonDays: s.horizonDays,
      rulesId: c.rulesId,
      initialStockCount: c.initialStockCount,
    },
    runs: s.runs,
    cycleHours: s.cycleHours,
    captureCapacityPerDay: s.captureCapacityPerDay,
    batch: s.batch,
    steady: s.steady,
    rampUpDays: s.rampUpDays,
    firstTargetDay: s.firstTargetDay ? s.firstTargetDay.mean : null,
    firstSaleDay: s.daily.find((x) => x.resourcesSold + x.mountsSold + x.broken >= 0.5)?.day ?? null,
    capital: { socleLow: s.capital.socleLow, socleHigh: s.capital.socleHigh, peakCashNeed: s.capital.peakCashNeed, total: s.capital.total, breakEvenDay: s.capital.breakEvenDay },
    market: s.market,
    purchases: s.purchases,
    routine: s.routine,
    plan: { targetGeneration: s.plan.targetGeneration, targets: s.plan.targets, steps: s.plan.steps, captureShares: s.plan.captureShares, optimakina: s.plan.optimakina },
    prices: s.prices,
    complete: s.complete,
    missing: s.missing,
    estimated: s.estimated,
    warnings: s.warnings,
    assumptions: s.assumptions,
    netByDay: s.daily.map((d) => Math.round(d.net.mean)),
    cumulativeByDay: s.daily.map((d) => Math.round(d.cumulative.mean)),
    speculative: s.speculative,
    paddockSchedule: c.paddockSchedule ?? [],
  }
}

/** Stratégie classée, sans son résumé complet. */
export type ModeStrategy = Omit<RankedStrategy, 'summary'>

function liteStrategy(r: RankedStrategy): ModeStrategy {
  const { summary: _s, ...rest } = r
  void _s
  return rest
}

/** Résultat d'un mode pour un profil (meilleure stratégie, alternatives, routine) : sérialisable. */
export interface ModeOutcome {
  modeId: ModeId
  family: FamilyId | null
  available: boolean
  reason?: string
  strategy: ModeStrategy | null
  /** Stratégies suivantes du classement (sans résumé). */
  alternatives: ModeStrategy[]
  /** Vente : meilleure stratégie par famille. */
  variants: { family: FamilyId; strategy: ModeStrategy | null }[]
  digest: ModeDigest | null
  evaluated: number
  notes: string[]
}

/** Résultat d'un mode depuis une ligne de `compareModes`. */
export function outcomeFromRow(row: ModeComparisonRow): ModeOutcome {
  const best = row.best
  const summary = best?.summary ?? row.optimization?.strategies.find((s) => s.id === best?.id)?.summary ?? null
  return {
    modeId: row.modeId,
    family: row.family,
    available: row.available,
    reason: row.reason,
    strategy: best ? liteStrategy(best) : null,
    alternatives: (row.optimization?.strategies ?? []).filter((s) => s.id !== best?.id).slice(0, 4).map(liteStrategy),
    variants: row.variants.map((v) => ({ family: v.family, strategy: v.best ? liteStrategy(v.best) : null })),
    digest: summary ? digestSummary(summary) : null,
    evaluated: row.optimization?.evaluated ?? 0,
    notes: row.optimization?.notes ?? [],
  }
}

export function outcomesFromComparison(cmp: ModeComparison): ModeOutcome[] {
  return cmp.rows.map(outcomeFromRow)
}

/** Résultat d'une simulation unique (stratégie imposée, ex. progression) mis au format d'un mode. */
export function outcomeFromSummary(mode: ModeId, s: ProductionSummary, label: string): ModeOutcome {
  const status = rangeStatus(s.steady.net)
  const strategy: ModeStrategy = {
    id: `${mode}:${label}`,
    label,
    params: {
      targetGeneration: s.plan.targetGeneration,
      parentLevel: s.config.parentLevel,
      optimakina: s.config.optimakina,
      tier: s.config.tier,
      mateBeforeExtract: s.config.mateBeforeExtract,
      brisageLevel: s.config.brisageLevel,
    },
    steadyNet: s.steady.netPerDay.mean,
    horizonNet: s.totals.netKnown.mean / Math.max(1, s.horizonDays),
    score: s.steady.netPerDay.mean,
    scoreBasis: 'kamas',
    net: s.steady.net,
    status,
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
    scoreSe: s.steady.netPerDaySe,
    stable: s.steady.stable,
    extendedDays: null,
    speculative: s.speculative,
    genetonShareOfNet: s.steady.genetonShareOfNet,
    tieWithBest: false,
  }
  return { modeId: mode, family: s.config.family, available: true, strategy, alternatives: [], variants: [], digest: digestSummary(s), evaluated: 1, notes: [] }
}

// ---------- Classement des modes ----------

export interface ModeRanking {
  /** Rang (1 = meilleur) parmi les modes disponibles ; null si indisponible. */
  rank: number | null
  modeId: ModeId
  def: ModeDef
  family: FamilyId | null
  outcome: ModeOutcome
  available: boolean
  /** Bénéfice net par jour en régime permanent (intervalle : borne inconnue = null). */
  net: Range
  /** Bénéfice net connu par jour (moyenne, p10, p90 des tirages). */
  netMean: number
  p10: number | null
  p90: number | null
  status: ProfitStatus
  /** Coûts chiffrés : borne basse connue (classement fiable). */
  comparable: boolean
  scoreBasis: 'kamas' | 'quantite'
  /** Produit principal (Corne, rune, monture la plus vendue…). */
  productName: string | null
  producedPerDay: number | null
  soldPerDay: number | null
  marketPerDay: number | null
  capPerDay: number | null
  shareOfMarket: number | null
  saturated: boolean
  rampUpDays: number | null
  capital: number | null
  breakEvenDay: number | null
  risks: ModeRisk[]
  /** Régime réellement permanent sur la fenêtre (sinon badge « non stabilisé »). */
  stable: boolean
  /** Vente au prix « HDV mixte » sans prix du joueur : hors classement, jamais « auto ». */
  speculative: boolean
  /** À égalité statistique avec le meilleur mode (écart dans le bruit des tirages). */
  tieWithBest: boolean
  /** Tirages et erreur type du bénéfice par jour. */
  runs: number
  netSe: number
  /** Part des génétons dans le bénéfice net (régime permanent). */
  genetonShareOfNet: number | null
  /** Valeur nette des génétons par jour (régime permanent, estimation). */
  genetonsPerDay: number
  /** Meilleur mode (« auto »). */
  best: boolean
}

/** Produit principal d'un résultat (ressource, rune, ou monture la plus vendue). */
export function mainMarketCheck(o: ModeOutcome): MarketCheck | null {
  const m = o.digest?.market ?? []
  const kind = o.digest?.mode
  if (kind === 'brisage') return m.find((x) => x.kind === 'rune') ?? null
  if (kind === 'vente') return m.filter((x) => x.kind === 'monture').sort((a, b) => b.soldPerDay - a.soldPerDay)[0] ?? m.find((x) => x.kind === 'ressource') ?? null
  return m.find((x) => x.kind === 'ressource') ?? null
}

/** Risques d'un résultat : ceux du mode + saturation, liquidité inconnue, prix manquants, montée longue… */
export function outcomeRisks(o: ModeOutcome): ModeRisk[] {
  const def = modeDef(o.modeId)
  const out = [...def.risks]
  const add = (r: ModeRisk) => {
    if (!out.some((x) => x.code === r.code)) out.push(r)
  }
  for (const w of o.digest?.warnings ?? []) {
    if (w.code === 'saturation') add({ code: 'saturation', tone: 'danger', label: 'Marché saturé', text: w.text })
    else if (w.code === 'liquidite-inconnue') add({ code: 'liquidite-inconnue', tone: 'warn', label: 'Volume inconnu', text: w.text })
    else if (w.code === 'prix-manquants') add({ code: 'prix-manquants', tone: 'warn', label: 'Prix manquants', text: w.text })
    else if (w.code === 'cible-non-atteinte') add({ code: 'cible-non-atteinte', tone: 'warn', label: 'Cible pas toujours atteinte', text: w.text })
    else if (w.code === 'etable') add({ code: 'etable', tone: 'warn', label: 'Étable pleine', text: w.text })
    else if (w.code === 'etable-saturee') add({ code: 'etable-saturee', tone: 'warn', label: 'Étable saturée', text: w.text })
    else if (w.code === 'genetons') add({ code: 'genetons', tone: 'info', label: 'Génétons estimés', text: w.text })
    else if (w.code === 'speculatif') add({ code: 'speculatif', tone: 'danger', label: 'Spéculatif (HDV mixte)', text: w.text })
    else if (w.code === 'volume-achat' && w.tone === 'warn') add({ code: 'volume-achat', tone: 'warn', label: 'Achats au-delà du volume', text: w.text })
    else if (w.code === 'montee') add({ code: 'non-stabilise', tone: 'warn', label: 'Non stabilisé', text: w.text })
  }
  const ramp = o.strategy?.rampUpDays ?? null
  const stable = o.strategy?.stable ?? o.digest?.steady.stable ?? true
  if (ramp !== null && ramp > 30) add(RISK_LONG_RAMP)
  else if ((ramp === null || !stable) && o.strategy && o.digest?.mode !== 'brisage')
    add({ code: 'non-stabilise', tone: 'warn', label: 'Non stabilisé', text: o.digest?.steady.instability?.length ? `Régime non stabilisé : ${o.digest.steady.instability.join(' ; ')}.` : 'Le régime permanent n’est pas atteint sur la durée simulée : la production change encore.' })
  const gshare = o.strategy?.genetonShareOfNet ?? o.digest?.steady.genetonShareOfNet ?? null
  if (gshare !== null && gshare > 0.25)
    add({ code: 'genetons-part', tone: 'warn', label: `Génétons ${formatNumber(gshare * 100)} % du net`, text: `Les génétons font ${formatNumber(gshare * 100)} % du bénéfice net par jour : valeur estimée (boutique d’Eugène Éton), à vérifier avant d’y engager du capital.` })
  const main = mainMarketCheck(o)
  if (main && !main.saturated && main.capPerDay !== null && main.producedPerDay > 0.7 * main.capPerDay)
    add({ code: 'liquidite-limite', tone: 'warn', label: 'Proche du plafond', text: `${main.name} : la production approche le volume vendable sans saturer le marché (${formatNumber(main.producedPerDay, 1)}/jour pour ${formatNumber(main.capPerDay)}/jour).` })
  return out
}

/**
 * Classe les modes : coûts chiffrés d'abord, puis bénéfice net par jour en régime permanent (ou quantité
 * produite si le prix du produit est inconnu), puis montée en charge la plus courte (`compareRanked`).
 * Modes indisponibles à la fin. `bestModeId` = meilleur mode au coût chiffré et au produit chiffré.
 */
export function rankModes(outcomes: readonly ModeOutcome[]): { rows: ModeRanking[]; bestModeId: ModeId | null } {
  const rows: ModeRanking[] = outcomes.map((o) => {
    const s = o.strategy
    const main = mainMarketCheck(o)
    const dist = o.digest?.steady.netPerDay
    return {
      rank: null,
      modeId: o.modeId,
      def: modeDef(o.modeId),
      family: o.family,
      outcome: o,
      available: o.available && !!s,
      net: s?.net ?? { low: null, high: null },
      netMean: s?.steadyNet ?? 0,
      p10: dist ? dist.p10 : null,
      p90: dist ? dist.p90 : null,
      status: s?.status ?? 'inconnu',
      comparable: s?.comparable ?? false,
      scoreBasis: s?.scoreBasis ?? 'kamas',
      productName: main?.name ?? modeDef(o.modeId).resourceName,
      producedPerDay: main ? main.producedPerDay : null,
      soldPerDay: main ? main.soldPerDay : null,
      marketPerDay: main ? main.marketPerDay : null,
      capPerDay: main ? main.capPerDay : null,
      shareOfMarket: main ? main.shareOfMarket : null,
      saturated: o.digest?.market.some((m) => m.saturated) ?? s?.saturated ?? false,
      rampUpDays: s?.rampUpDays ?? null,
      capital: s ? s.capital : null,
      breakEvenDay: s?.breakEvenDay ?? null,
      risks: outcomeRisks(o),
      stable: s?.stable ?? o.digest?.steady.stable ?? true,
      speculative: isSpeculative(o),
      tieWithBest: false,
      runs: s?.runs ?? o.digest?.runs ?? 0,
      netSe: s?.scoreSe ?? o.digest?.steady.netPerDaySe ?? 0,
      genetonShareOfNet: s?.genetonShareOfNet ?? o.digest?.steady.genetonShareOfNet ?? null,
      genetonsPerDay: o.digest?.steady.revenueByCategory.genetons ?? 0,
      best: false,
    }
  })
  const strat = (r: ModeRanking) => ({ ...(r.outcome.strategy as ModeStrategy), scoreSe: r.netSe, summary: null })
  // Classes : disponibles, puis chiffrés en kamas (le produit sans prix est classé en quantité), puis
  // ventes spéculatives (prix « HDV mixte ») à part ; dans une classe, égalités statistiques départagées
  // par le capital puis la montée (`rankWithTies`).
  const klass = (r: ModeRanking) => (!r.available ? 3 : r.scoreBasis !== 'kamas' ? 2 : r.speculative ? 1 : 0)
  const groups = [0, 1, 2, 3].map((k) => rows.filter((r) => klass(r) === k))
  const ordered = [
    ...groups.slice(0, 3).flatMap((g) => rankWithTies(g, strat, (a, b) => compareRanked(strat(a), strat(b)))),
    ...groups[3].sort((a, b) => MODE_IDS.indexOf(a.modeId) - MODE_IDS.indexOf(b.modeId)),
  ]
  // Ventes spéculatives (prix « HDV mixte ») : affichées, mais hors classement.
  let rank = 0
  for (const r of ordered) if (r.available && !r.speculative) r.rank = ++rank
  const best = ordered.find((r) => r.available && r.comparable && r.scoreBasis === 'kamas' && !r.speculative) ?? null
  if (best) {
    best.best = true
    for (const r of ordered) if (r !== best && klass(r) === 0) r.tieWithBest = statisticalTie(strat(best), strat(r))
  }
  return { rows: ordered, bestModeId: best?.modeId ?? null }
}

/** Vente chiffrée au prix « HDV mixte » sans prix du joueur (projection spéculative). */
export function isSpeculative(o: Pick<ModeOutcome, 'strategy' | 'digest'>): boolean {
  return !!(o.strategy?.speculative ?? o.digest?.speculative)
}

// ---------- Analyse d'un mode ----------

/** Catégorie de revenu dont le prix fait la sensibilité d'un mode. */
export function mainRevenueCategory(o: Pick<ModeOutcome, 'modeId' | 'digest'>): ProductionRevenueCategory {
  const mode = o.digest?.mode ?? modeDef(o.modeId).mode
  if (mode === 'brisage') return 'runes'
  if (mode === 'vente') return 'montures'
  if (mode === 'progression') {
    // Progression : le revenu le plus important (génétons ou surplus extrait).
    const r = o.digest?.steady.revenueByCategory
    return r && (r.ressources ?? 0) > (r.genetons ?? 0) ? 'ressources' : 'genetons'
  }
  return 'ressources'
}

export interface SensitivityPoint {
  /** `prix-<facteur>` (prix du produit principal), `genetons-50`, `sans-genetons`, `prix-montures-50`. */
  id: string
  /** Facteur appliqué au revenu concerné (0,8 = −20 % ; 0 = sans génétons). */
  factor: number
  label: string
  net: Range
  netMean: number
  /** Écart du bénéfice connu par jour. */
  delta: number
}

/**
 * Sensibilité du bénéfice par jour au prix du produit principal (Corne, Ambre, Neurone, rune, monture),
 * à stratégie et quantités vendues inchangées (plafond de volume) : bénéfice + (facteur − 1) × revenu de
 * ce produit. Puis : **génétons ÷ 2** et **sans génétons** (valeur estimée, liés au compte) pour tous
 * les modes, et **prix des montures −50 %** pour la vente (prix « HDV mixte »). Bornes inconnues gardées
 * inconnues.
 */
export function modeSensitivity(o: ModeOutcome, factors: readonly number[] = [0.8, 1.2]): SensitivityPoint[] {
  const d = o.digest
  if (!d || !o.strategy) return []
  const cat = mainRevenueCategory(o)
  const point = (id: string, label: string, f: number, rev: number): SensitivityPoint => {
    const delta = (f - 1) * rev
    const shift = (v: number | null) => (v === null ? null : v + delta)
    return { id, factor: f, label, net: { low: shift(d.steady.net.low), high: shift(d.steady.net.high) }, netMean: d.steady.netPerDay.mean + delta, delta }
  }
  const out = factors.map((f) => point(`prix-${f}`, `${f >= 1 ? '+' : '−'}${formatNumber(Math.abs(f - 1) * 100)} %`, f, d.steady.revenueByCategory[cat] ?? 0))
  const gen = d.steady.revenueByCategory.genetons ?? 0
  if (gen > 0 && cat !== 'genetons') {
    out.push(point('genetons-50', 'Génétons ÷ 2', 0.5, gen))
    out.push(point('sans-genetons', 'Sans génétons', 0, gen))
  }
  const mounts = d.steady.revenueByCategory.montures ?? 0
  if (mounts > 0) out.push(point('prix-montures-50', 'Prix des montures −50 %', 0.5, mounts))
  return out
}

export type LiquidityStatus = 'ok' | 'limite' | 'sature' | 'inconnu'

export interface LiquidityLine {
  kind: MarketCheck['kind']
  name: string
  itemId: number
  speciesId?: number
  producedPerDay: number
  soldPerDay: number
  capPerDay: number | null
  marketPerDay: number | null
  shareOfMarket: number | null
  endStock: number
  status: LiquidityStatus
  text: string
}

export const LIQUIDITY_STATUS_LABELS: Record<LiquidityStatus, string> = { ok: 'absorbé', limite: 'proche du plafond', sature: 'saturé', inconnu: 'volume inconnu' }

/** Vérification du volume du marché pour chaque produit vendu (régime permanent). */
export function liquidityCheck(o: ModeOutcome, share = 0.15): LiquidityLine[] {
  return (o.digest?.market ?? [])
    .filter((m) => m.producedPerDay > 0 || m.soldPerDay > 0)
    .map((m) => {
      const status: LiquidityStatus = m.capPerDay === null ? 'inconnu' : m.saturated ? 'sature' : m.producedPerDay > 0.7 * m.capPerDay ? 'limite' : 'ok'
      const pct = Math.round(share * 100)
      const text =
        status === 'inconnu'
          ? `${m.name} : aucun volume connu (importez l’export HDV du serveur) — ventes non plafonnées.`
          : status === 'sature'
            ? `${m.name} : ${formatNumber(m.producedPerDay, 1)} produits/jour pour ${formatNumber(m.capPerDay ?? 0)} vendables (${pct} % de ${formatNumber(m.marketPerDay ?? 0)} ventes/jour) : le stock grossit (≈ ${formatNumber(m.endStock)} en fin de période).`
            : `${m.name} : ${formatNumber(m.producedPerDay, 1)}/jour = ${m.shareOfMarket !== null ? formatPercent(m.shareOfMarket, 1) : '?'} du marché (${formatNumber(m.marketPerDay ?? 0)} ventes/jour, plafond ${formatNumber(m.capPerDay ?? 0)}/jour).`
      return {
        kind: m.kind,
        name: m.name,
        itemId: m.itemId,
        speciesId: m.speciesId,
        producedPerDay: m.producedPerDay,
        soldPerDay: m.soldPerDay,
        capPerDay: m.capPerDay,
        marketPerDay: m.marketPerDay,
        shareOfMarket: m.shareOfMarket,
        endStock: m.endStock,
        status,
        text,
      }
    })
}

const kamas = (v: number) => formatKamas(v, true)
/** « 1 stratégie simulée », « 42 stratégies simulées ». */
const s2n = (n: number, one: string, many: string) => `${formatNumber(n)} ${Math.abs(n) >= 2 ? many : one}`

/** Paramètres d'une stratégie, en clair (liste « paramètre : valeur »). */
export function strategyParamLines(o: ModeOutcome): { label: string; value: string }[] {
  const d = o.digest
  const s = o.strategy
  if (!s) return []
  const p = s.params
  const mode = d?.mode ?? modeDef(o.modeId).mode
  const out: { label: string; value: string }[] = []
  if (o.family) out.push({ label: 'Famille', value: FAMILIES[o.family]?.plural ?? o.family })
  if (mode === 'brisage') {
    out.push({ label: 'Niveau de brisage', value: `niveau ${p.brisageLevel ?? DEFAULT_BRISAGE_LEVEL}` })
    out.push({ label: 'Palier de la Mangeoire', value: `palier ${p.tier ?? 2}` })
    out.push({ label: 'Accoupler avant de briser', value: p.mateBeforeExtract ? 'oui' : 'non' })
  } else {
    out.push({ label: mode === 'vente' ? 'Génération vendue' : mode === 'progression' ? 'Génération visée' : 'Génération extraite', value: `G${s.targetGeneration}` })
    const targets = d?.plan.targets ?? []
    if (targets.length) out.push({ label: targets.length > 1 ? 'Espèces produites' : 'Espèce produite', value: targets.map((t) => getSpecies(t)?.name ?? `#${t}`).join(', ') })
    out.push({ label: 'Niveau des parents', value: `niveau ${p.parentLevel ?? DEFAULT_PARENT_LEVEL}` })
    out.push({ label: 'Optimakina', value: optimakinaText(p.optimakina, d) })
    out.push({ label: 'Palier des jauges', value: `palier ${p.tier ?? 2}${d ? ` (Mangeoire palier ${d.batch.xpTier})` : ''}` })
    if (mode !== 'progression') out.push({ label: 'Accoupler avant d’extraire', value: p.mateBeforeExtract === false ? 'non (extraction directe)' : 'oui (bébé gratuit)' })
    out.push({ label: 'Clonage', value: p.cloning === false ? 'non' : 'oui (générations sous la cible)' })
  }
  if (d) {
    out.push({ label: 'Enclos', value: paddocksText(d) })
    out.push({ label: 'Passages aux enclos', value: `${d.config.sessionsPerDay} par jour (toutes les ${formatNumber(d.cycleHours)} h)` })
  }
  return out
}

/** Enclos débloqués en cours de route par l'XP d'élevage (après le départ), par ordre de jour. */
function paddockUnlocks(d: ModeDigest): { day: number; paddocks: number }[] {
  let n = d.config.paddocks
  const out: { day: number; paddocks: number }[] = []
  for (const s of [...(d.paddockSchedule ?? [])].sort((a, b) => a.day - b.day))
    if (s.paddocks > n) {
      out.push(s)
      n = s.paddocks
    }
  return out
}

/** « 3 × 10 places au départ, puis 4 (jour 23), 5 (jour 70) par l'XP d'élevage » : la routine du régime en tient compte. */
function paddocksText(d: ModeDigest): string {
  const steps = paddockUnlocks(d)
  if (!steps.length) return `${d.config.paddocks} × 10 places`
  return `${d.config.paddocks} × 10 places au départ, puis ${steps.map((x) => `${x.paddocks} (jour ${formatNumber(x.day)})`).join(', ')} par l’XP d’élevage`
}

function optimakinaText(o: OptimakinaPolicy | undefined, d: ModeDigest | null): string {
  const used = d?.plan.optimakina.filter((c) => c.use).map((c) => c.generation).sort((a, b) => a - b) ?? []
  const gens = used.length ? ` (bébés G${Math.min(...used)}${used.length > 1 ? `–G${Math.max(...used)}` : ''})` : ''
  if (o === undefined || o === 'auto') return `règle de prix${used.length ? gens : ' (aucune utile)'}`
  if (o === 'none') return 'jamais'
  if (o === 'all') return `partout${gens}`
  return `dès la G${o.fromGeneration}`
}

/**
 * Pourquoi cette stratégie : écart avec les suivantes du classement, palier (lot dans une session),
 * Optimakina, accouplement avant extraction, liquidité. Phrases complètes en français.
 */
export function strategyWhy(o: ModeOutcome): string[] {
  const s = o.strategy
  const d = o.digest
  if (!s) return [o.reason ?? 'Aucune stratégie simulable avec ces contraintes.']
  const out: string[] = []
  const mode = d?.mode ?? modeDef(o.modeId).mode
  const alt = o.alternatives.filter((a) => a.comparable === s.comparable)
  if (s.scoreBasis === 'quantite')
    out.push(`Prix du produit inconnu : stratégie retenue pour sa production (${formatNumber(mode === 'brisage' ? s.brokenPerDay : s.resourcesPerDay, 1)}/jour). Importez l’export HDV du serveur pour un classement en kamas.`)
  else if (alt.length) {
    const next = alt[0]
    const gap = s.steadyNet - next.steadyNet
    out.push(
      `Retenue parmi ${s2n(o.evaluated, 'stratégie simulée', 'stratégies simulées')} : ${kamas(s.steadyNet)}/jour en régime permanent, ${gap >= 0 ? `${kamas(gap)} de plus que` : `${kamas(-gap)} de moins que`} la suivante (${next.label} : ${kamas(next.steadyNet)}/jour${next.rampUpDays !== null ? `, montée ${formatNumber(next.rampUpDays)} j` : ''}).`,
    )
  } else out.push(`${kamas(s.steadyNet)}/jour en régime permanent (${s2n(o.evaluated, 'stratégie simulée', 'stratégies simulées')}).`)
  if (d) {
    const sessions = d.batch.sessions
    const lot = Math.round(d.batch.seconds / 60)
    if (mode !== 'brisage')
      out.push(
        `Palier ${d.batch.tier} : un lot de fécondation dure ≈ ${formatNumber(lot / 60, 1)} h et occupe ${sessions} session${sessions > 1 ? 's' : ''} sur ${d.config.sessionsPerDay} par jour${sessions === 1 ? ' : chaque enclos reçoit un lot à chaque passage' : ''}. Un palier plus haut coûte plus cher sans aller plus vite si le lot tient déjà dans une session.`,
      )
    const opti = d.plan.optimakina.filter((c) => c.use).sort((a, b) => a.generation - b.generation)
    if (mode !== 'brisage' && opti.length) {
      const top = opti[opti.length - 1]
      out.push(`Optimakina pour les bébés G${opti[0].generation}${opti.length > 1 ? ` à G${top.generation}` : ''} : ${top.reason.replace(/\.$/, '')} (G${top.generation}).`)
    }
    if ((mode === 'extraction' || mode === 'vente') && s.params.mateBeforeExtract !== false)
      out.push('Accoupler avant d’extraire : une monture rend autant de ressources féconde ou stérile ; l’accouplement donne un bébé gratuit (et des génétons) avant l’extraction.')
    if (mode === 'brisage') out.push(`Niveau ${s.params.brisageLevel ?? DEFAULT_BRISAGE_LEVEL} : meilleur compromis entre runes par monture et temps de Mangeoire par lot (palier ${s.params.tier ?? 1}).`)
    const main = mainMarketCheck(o)
    if (main && main.capPerDay !== null)
      out.push(
        main.saturated
          ? `Attention : ${main.name} dépasse le volume vendable (${formatNumber(main.producedPerDay, 1)}/jour pour ${formatNumber(main.capPerDay)}/jour) — l’invendu est reporté.`
          : `${main.name} : ${formatNumber(main.producedPerDay, 1)}/jour, ${main.shareOfMarket !== null ? formatPercent(main.shareOfMarket, 1) : '?'} des ventes du marché : le volume suit.`,
      )
    if (s.rampUpDays !== null && s.rampUpDays > 20) out.push(`Montée en charge longue (${formatNumber(s.rampUpDays)} jours) et capital avancé ≈ ${kamas(s.capital)} : comparez avec une génération plus basse si vous voulez un retour plus rapide.`)
  }
  out.push(...genetonWhy(o))
  return out
}

/** Bénéfice par jour d'une stratégie sans ses génétons (part du net × net). */
function netWithoutGenetons(x: Pick<ModeStrategy, 'steadyNet' | 'genetonShareOfNet'>): number {
  return x.steadyNet * (1 - (x.genetonShareOfNet ?? 0))
}

/**
 * Poids des génétons dans le choix (revue UX2-07) : leur part du bénéfice net, et la stratégie qui serait
 * retenue sans eux (classement des stratégies évaluées sur « bénéfice − génétons ») si elle change.
 */
export function genetonWhy(o: ModeOutcome): string[] {
  const s = o.strategy
  if (!s || s.scoreBasis !== 'kamas') return []
  const share = s.genetonShareOfNet ?? o.digest?.steady.genetonShareOfNet ?? null
  if (share === null || share < 0.1 || s.steadyNet <= 0) return []
  const out = [
    `Génétons : ≈ ${kamas(s.steadyNet * share)}/jour, soit ${formatNumber(share * 100)} % du bénéfice net — valeur estimée (Puissants Parchemins revendus, liés au compte selon DPLN) : sans eux, ≈ ${kamas(netWithoutGenetons(s))}/jour.`,
  ]
  const pool = [s, ...o.alternatives].filter((x) => x.comparable === s.comparable && x.scoreBasis === 'kamas')
  const best = [...pool].sort((a, b) => netWithoutGenetons(b) - netWithoutGenetons(a))[0]
  if (best && best.id !== s.id && netWithoutGenetons(best) > netWithoutGenetons(s))
    out.push(
      `Sans les génétons, ${best.label} serait retenue (≈ ${kamas(netWithoutGenetons(best))}/jour${best.rampUpDays !== null ? `, montée ${formatNumber(best.rampUpDays)} j` : ''}, capital ${kamas(best.capital)}) : ${
        share > 0.25 ? 'le choix de cette stratégie repose sur leur valeur estimée.' : 'à comparer si vous ne comptez pas les revendre.'
      }`,
    )
  return out
}

/** Revenus et coûts par jour en régime permanent (catégories non nulles). */
export function revenueCostBreakdown(o: ModeOutcome): { revenue: { key: ProductionRevenueCategory; label: string; value: number }[]; cost: { key: ProductionCostCategory; label: string; value: number }[] } {
  const d = o.digest
  if (!d) return { revenue: [], cost: [] }
  const revenue = (Object.keys(PRODUCTION_REVENUE_LABELS) as ProductionRevenueCategory[])
    .map((key) => ({ key, label: PRODUCTION_REVENUE_LABELS[key], value: d.steady.revenueByCategory[key] ?? 0 }))
    .filter((x) => x.value > 0.5)
  const cost = (Object.keys(PRODUCTION_COST_LABELS) as ProductionCostCategory[])
    .map((key) => ({ key, label: PRODUCTION_COST_LABELS[key], value: d.steady.costByCategory[key] ?? 0 }))
    .filter((x) => x.value > 0.5)
  return { revenue, cost }
}

// ---------- Routine quotidienne ----------

export type RoutineKind = 'accouplement' | 'clonage' | 'extraction' | 'vente' | 'brisage' | 'capture' | 'enclos' | 'carburant' | 'makina' | 'genetons' | 'note'

export interface RoutineItem {
  /** Identifiant stable (case à cocher). */
  id: string
  kind: RoutineKind
  text: string
  hint?: string
  /** Quantité par jour (régime permanent). */
  perDay?: number
  /** Montant associé (coût ou revenu par jour). `complete: false` = minimum connu. */
  kamas?: { label: string; value: number | null; complete: boolean }
  tone?: 'ok' | 'warn' | 'info'
}

export interface RoutineSession {
  id: string
  /** « Matin », « Soir »… */
  label: string
  items: RoutineItem[]
}

export interface ModeRoutine {
  modeId: ModeId
  label: string
  strategyLabel: string
  sessionsPerDay: number
  /** Une checklist par passage aux enclos (ordre d'une session : accoupler → cloner → sortir → capturer → enclos). */
  sessions: RoutineSession[]
  /** Une fois par jour : ventes (plafond de liquidité), achats et crafts de carburant, Optimakinas, génétons. */
  daily: RoutineItem[]
  /** Résumé d'une ligne (accueil). */
  summary: string
  /** Indicateurs clés par jour. */
  headline: {
    captures: number
    matings: number
    clones: number
    extracted: number
    resources: number
    broken: number
    sold: number
    net: Range
    netMean: number
    status: ProfitStatus
  }
  notes: string[]
}

/** Contraintes du jour pour la routine. */
export interface RoutineProfile {
  /** Personnages qui lancent un filet à chaque combat. */
  characters?: number
  /** Places d'enclos libres aujourd'hui (captures du jour), si connues. */
  freeSlots?: number | null
  /** Passages aux enclos par jour (défaut : ceux de la simulation). */
  sessionsPerDay?: number
  /** Part du volume quotidien vendable (défaut 0,15). */
  maxMarketShare?: number
}

const SESSION_LABELS: Record<number, string[]> = {
  1: ['Passage du jour'],
  2: ['Matin', 'Soir'],
  3: ['Matin', 'Après-midi', 'Soir'],
  4: ['Matin', 'Midi', 'Après-midi', 'Soir'],
}

function sessionLabels(n: number): string[] {
  return SESSION_LABELS[n] ?? Array.from({ length: n }, (_, i) => `Passage ${i + 1}`)
}

const spName = (id: number) => getSpecies(id)?.name ?? `#${id}`
const spGen = (id: number) => getSpecies(id)?.generation ?? 0
/** Quantité « ≈ 3,4 » (une décimale sous 10, entier au-delà). */
const qty = (n: number) => formatNumber(n, n < 10 ? 1 : 0)
const s2 = (n: number, one: string, many = `${one}s`) => `${qty(n)} ${Math.abs(n) >= 2 ? many : one}`

/** « Corne de volkorne » → « Cornes de volkorne » (n ≥ 2) : accord du premier mot d'un nom d'objet. */
export function pluralItemName(name: string, n: number): string {
  if (Math.abs(n) < 2) return name
  const i = name.indexOf(' ')
  const head = i < 0 ? name : name.slice(0, i)
  const tail = i < 0 ? '' : name.slice(i)
  return /[sxz]$/i.test(head) ? name : `${head}s${tail}`
}

const ORIGIN_VERB: Record<string, string> = {
  craft: 'à fabriquer',
  marche: 'à acheter à l’HDV',
  joueur: 'à votre prix',
  defaut: 'prix par défaut (à vérifier)',
  manquant: 'prix à saisir',
}

function priceLine(d: ModeDigest, key: string): PriceLine | undefined {
  return d.prices.find((l) => l.key === key)
}

function originText(l: PriceLine | undefined): string {
  if (!l) return ''
  return ORIGIN_VERB[l.origin] ?? l.origin
}

function byGeneration(list: { generation: number; perDay: number }[], min = 0.05): string {
  const shown = list.filter((x) => x.perDay >= min)
  const rest = list.length - shown.length
  return `${shown.map((x) => `G${x.generation} ≈ ${qty(x.perDay)}`).join(', ')}${rest > 0 ? `${shown.length ? ', ' : ''}autres < ${qty(min)}` : ''}`
}

/**
 * Routine quotidienne précise d'un mode (régime permanent de la stratégie retenue), découpée par passage
 * aux enclos : accouplements par génération (et croisements principaux), Optimakinas, accouplements
 * « avant d'extraire », clonages par génération, extractions / ventes / brisages, captures par couleur
 * (selon les places libres et les personnages), lots et jauges ; puis une fois par jour : vente des
 * ressources dans la limite du volume du marché, carburant à acheter ou à fabriquer (prix du serveur),
 * Optimakinas, génétons, bénéfice attendu.
 */
export function dailyRoutine(mode: ModeId, outcome: ModeOutcome, profile: RoutineProfile = {}): ModeRoutine | null {
  const d = outcome.digest
  const s = outcome.strategy
  if (!d || !s) return null
  const def = modeDef(mode)
  const fam = FAMILIES[d.family]
  const famPlural = fam?.plural ?? d.family
  const n = Math.max(1, Math.round(profile.sessionsPerDay ?? d.config.sessionsPerDay))
  const r = d.routine
  const st = d.steady
  const per = (x: number) => x / n
  const sessionItems: RoutineItem[] = []
  const notes: string[] = []

  // 1. Accouplements de la chaîne (génération la plus haute d'abord).
  const matingByGen = new Map<number, number>()
  for (const m of r.matingsPerDay) matingByGen.set(spGen(m.speciesId), (matingByGen.get(spGen(m.speciesId)) ?? 0) + m.perDay)
  const matings = [...matingByGen.values()].reduce((a, b) => a + b, 0)
  if (matings > 0.01) {
    const gens = [...matingByGen.entries()].sort((a, b) => b[0] - a[0]).map(([g, v]) => ({ generation: g, perDay: per(v) }))
    const top = [...r.matingsPerDay]
      .sort((a, b) => b.perDay - a.perDay)
      .slice(0, 4)
      .map((m) => (m.crossing ? `${spName(m.crossing[0])} × ${spName(m.crossing[1])} → ${spName(m.speciesId)}` : spName(m.speciesId)))
    const optiGens = d.plan.optimakina.filter((c) => c.use).map((c) => c.generation)
    const opti = st.optimakinasPerDay > 0.01 ? ` ; dont ≈ ${qty(per(st.optimakinasPerDay))} avec Optimakina (bébés G${Math.min(...optiGens)}+)` : ''
    sessionItems.push({
      id: 'accoupler',
      kind: 'accouplement',
      text: `Accoupler ≈ ${s2(per(matings), 'couple')} ${Math.abs(per(matings)) >= 2 ? 'féconds' : 'fécond'} depuis l’étable, génération la plus haute d’abord : ${byGeneration(gens)}${opti}`,
      hint: `Croisements les plus fréquents : ${top.join(' ; ')}. Parents au niveau ${s.params.parentLevel ?? DEFAULT_PARENT_LEVEL}. On n’accouple que les croisements dont le bébé manque à la chaîne.`,
      perDay: matings,
    })
  }
  if (r.condemnedMatingsPerDay > 0.01)
    sessionItems.push({
      id: 'accoupler-avant',
      kind: 'accouplement',
      text: `Accoupler avant ${d.mode === 'vente' ? 'd’extraire les invendables' : 'd’extraire'} : ≈ ${s2(per(r.condemnedMatingsPerDay), 'couple')} de montures G${d.config.targetGeneration} fécondes (sexes opposés), puis sortir les stériles`,
      hint: 'Bébé gratuit + génétons + XP d’Éleveur ; l’extraction rend autant de ressources féconde ou stérile. Sans partenaire après 2 passages : extraire telle quelle.',
      perDay: r.condemnedMatingsPerDay,
    })

  // 2. Clonages.
  const clones = r.clonesPerDay.reduce((a, b) => a + b.perDay, 0)
  if (clones > 0.01)
    sessionItems.push({
      id: 'cloner',
      kind: 'clonage',
      text: `Cloner ≈ ${s2(per(clones), 'paire')} de stériles de même génération : ${byGeneration(r.clonesPerDay.map((c) => ({ generation: c.generation, perDay: per(c.perDay) })))}`,
      hint: 'Même couleur d’abord, puis une couleur utile à la chaîne ; le clone (fertile) retourne en fécondation. Une stérile seule attend au plus 4 passages, puis sort.',
      perDay: clones,
    })

  // 3. Sorties : extraction, vente, brisage.
  const extracted = r.extractedPerDay.reduce((a, b) => a + b.perDay, 0)
  const resName = d.mode === 'brisage' ? null : (fam?.extractionItemName ?? def.resourceName ?? 'ressources')
  if (extracted > 0.01)
    sessionItems.push({
      id: 'extraire',
      kind: 'extraction',
      text: `Extraire ≈ ${s2(per(extracted), 'monture')} : ${byGeneration(r.extractedPerDay.map((x) => ({ generation: x.generation, perDay: per(x.perDay) })))} → ≈ ${qty(per(st.resourcesPerDay))} ${resName ? pluralItemName(resName, per(st.resourcesPerDay)) : 'ressources'}`,
      hint: `Une monture GN rend N ${resName ? pluralItemName(resName, 2) : 'ressources'} (G1 : rien). ${d.mode === 'vente' ? 'Invendables et surplus au-delà de 3 jours de volume.' : `Génération visée G${d.config.targetGeneration} et surplus de génération ≥ 2 ; les G1 en trop sont relâchées.`}`,
      perDay: extracted,
    })
  if (r.soldPerDay.length) {
    const sold = r.soldPerDay.reduce((a, b) => a + b.perDay, 0)
    const lines = r.soldPerDay.filter((x) => per(x.perDay) >= 0.05).slice(0, 4).map((x) => {
      const check = d.market.find((m) => m.kind === 'monture' && m.speciesId === x.speciesId)
      return `${spName(x.speciesId)} ≈ ${qty(per(x.perDay))}${check?.capPerDay !== null && check?.capPerDay !== undefined ? ` (plafond ${qty(check.capPerDay)}/jour)` : ''}`
    })
    sessionItems.push({
      id: 'vendre-montures',
      kind: 'vente',
      text: `Mettre en vente ≈ ${s2(per(sold), 'monture')} fertile${per(sold) >= 2 ? 's' : ''} : ${lines.join(', ')}`,
      hint: 'Prix prudent « HDV mixte » (niveau, état et séniles mélangés) : vérifiez le prix des montures comparables avant de vendre ; jamais en dessous de leur valeur d’extraction.',
      perDay: sold,
      tone: 'info',
    })
  }
  if (r.brokenPerDay > 0.01) {
    const runeLine = priceLine(d, 'rune')
    sessionItems.push({
      id: 'briser',
      kind: 'brisage',
      text: `Briser ≈ ${s2(per(r.brokenPerDay), 'monture')} arrivée${per(r.brokenPerDay) >= 2 ? 's' : ''} au niveau ${s.params.brisageLevel ?? DEFAULT_BRISAGE_LEVEL} → ≈ ${qty(per(st.runesPerDay))} ${runeLine ? pluralItemName(runeLine.label, per(st.runesPerDay)) : 'runes'}`,
      hint: 'Brisage au niveau visé (rendements observés) ; le brisage peut être corrigé par Ankama.',
      perDay: r.brokenPerDay,
      tone: 'warn',
    })
  }

  // 4. Captures (couleurs et sexes, combats) : au premier passage, les places libres du jour si connues.
  const captures = r.capturesPerDay.reduce((a, b) => a + b.perDay, 0)
  const chars = Math.max(1, Math.round(profile.characters ?? d.config.characters))
  const perFight = chars * Math.max(1, d.config.mountsPerCast)
  const shares = captures > 0 ? r.capturesPerDay.map((c) => ({ id: c.speciesId, share: c.perDay / captures })) : d.plan.captureShares.map((c) => ({ id: c.speciesId, share: c.share }))
  const colours = shares
    .filter((x) => x.share > 0.02)
    .slice(0, 6)
    .map((x) => `${spName(x.id)} ${formatPercent(x.share, 0)}`)
    .join(', ')
  const today = profile.freeSlots !== undefined && profile.freeSlots !== null ? Math.max(0, Math.round(profile.freeSlots)) : null
  const captureItem = (first: boolean): RoutineItem | null => {
    const count = first && today !== null ? today : per(captures)
    if (count <= 0.01 && captures <= 0.01) return null
    const text =
      first && today !== null
        ? `Capturer ${formatNumber(today)} ${famPlural} G1 aujourd’hui (places libres) — régime permanent ≈ ${qty(captures)}/jour`
        : `Capturer ≈ ${qty(per(captures))} ${famPlural} G1 (≈ ${qty(captures)}/jour)`
    return {
      id: 'capturer',
      kind: 'capture',
      text: `${text} : ${colours || 'couleurs de la recette'}`,
      hint: `Sexe en déficit de chaque couleur d’abord. ≈ ${s2(Math.max(1, Math.ceil(count / perFight)), 'combat')} (${chars} personnage${chars > 1 ? 's' : ''} × ${formatNumber(d.config.mountsPerCast)} par lancer, ${NET_KIND_LABELS[d.config.netKind].toLowerCase()}). Capacité ≈ ${formatNumber(d.captureCapacityPerDay)} captures/jour : seulement pour remplir les places libres.`,
      perDay: captures,
    }
  }

  // 5. Enclos : lots, jauges, palier.
  if (r.batchesPerDay > 0.01) {
    const gauges = r.fuel.filter((f) => f.gauge !== 'mangeoire').map((f) => `${gaugeName(f.gauge)} palier ${f.tier}`)
    const xp = r.fuel.find((f) => f.gauge === 'mangeoire')
    const lot = d.batch.seconds / 3600
    sessionItems.push({
      id: 'enclos',
      kind: 'enclos',
      text:
        d.mode === 'brisage' && !s.params.mateBeforeExtract
          ? `Poser ≈ ${s2(per(r.batchesPerDay), 'lot')} de 10 captures en montée de niveau : Mangeoire seule au palier ${s.params.tier ?? 1} jusqu’au niveau ${s.params.brisageLevel ?? DEFAULT_BRISAGE_LEVEL}`
          : `Poser ≈ ${s2(per(r.batchesPerDay), 'lot')} de 10 montures (génération la plus haute d’abord) : ${gauges.join(', ')}${xp ? `, Mangeoire palier ${xp.tier} en complément` : ''}`,
      hint:
        d.mode === 'brisage' && !s.params.mateBeforeExtract
          ? 'Un enclos = un lot ; le carburant de Mangeoire ne dépend pas du nombre de montures : remplissez les 10 places.'
          : `Lot typique ≈ ${formatNumber(lot, 1)} h au palier ${d.batch.tier} (${d.batch.sessions} passage${d.batch.sessions > 1 ? 's' : ''}) ; sérénité au palier 1 ; démarrez le plan de l’enclos pour les alarmes. Lot lancé dès 6 montures (sinon attendre au plus 2 passages).`,
      perDay: r.batchesPerDay,
    })
  }

  // ---- Une fois par jour ----
  const daily: RoutineItem[] = []
  const share = profile.maxMarketShare ?? 0.15
  // Ventes de ressources / runes dans la limite du volume.
  for (const m of d.market.filter((x) => x.kind !== 'monture' && x.producedPerDay > 0.01)) {
    const line = priceLine(d, m.kind === 'rune' ? 'rune' : 'ressource')
    const price = line?.value ?? null
    // Revenu net de taxe de la simulation (ressources ou runes vendues), jamais un prix inconnu compté 0.
    const net = price !== null ? (m.kind === 'rune' ? st.revenueByCategory.runes : st.revenueByCategory.ressources) : null
    const cap = m.capPerDay
    daily.push({
      id: `vendre-${m.itemId}`,
      kind: 'vente',
      text:
        cap !== null
          ? `Vendre ≈ ${qty(m.soldPerDay)} ${pluralItemName(m.name, m.soldPerDay)} par jour, jamais plus de ${formatNumber(cap)} (${formatNumber(share * 100)} % des ${formatNumber(m.marketPerDay ?? 0)} ventes quotidiennes)`
          : `Vendre ≈ ${qty(m.soldPerDay)} ${pluralItemName(m.name, m.soldPerDay)} par jour (volume du marché inconnu : importez l’export HDV)`,
      hint: `${price !== null ? `≈ ${formatKamas(price)} l’unité (${line?.origin === 'marche' ? 'marché du serveur' : originText(line)})` : 'prix inconnu'} ; vendez en fin de journée par lots de 10 ou 100, le reste attend le lendemain.${m.saturated ? ' La production dépasse ce que le marché absorbe : le stock grossit.' : ''}`,
      perDay: m.soldPerDay,
      kamas: { label: 'Revenu net de taxe', value: net, complete: price !== null && (line?.complete ?? false) },
      tone: m.saturated ? 'warn' : cap === null ? 'warn' : undefined,
    })
  }
  // Carburant : par jauge, quantité par jour et par semaine, acheter ou fabriquer.
  for (const f of r.fuel) {
    if (f.pointsPerDay <= 0) continue
    const line = priceLine(d, f.gauge === 'mangeoire' ? (d.mode === 'brisage' && !s.params.mateBeforeExtract ? 'xp:level' : 'xp:fecond') : `fuel:${f.gauge}`)
    const unit = f.costPerDay !== null && f.itemsPerDay ? f.costPerDay / f.itemsPerDay : null
    const thinFuel = d.warnings.filter((w) => w.code === 'volume-achat' && w.text.startsWith(f.fuelName))
    daily.push({
      id: `carburant-${f.gauge}-${f.tier}`,
      kind: 'carburant',
      text:
        f.itemsPerDay !== null
          ? `${f.fuelName} : ≈ ${qty(f.itemsPerDay)} par jour (≈ ${formatNumber(Math.ceil(f.itemsPerDay * 7))} par semaine) — ${originText(line) || 'prix inconnu'}`
          : `${gaugeName(f.gauge)} palier ${f.tier} : ≈ ${formatNumber(f.pointsPerDay)} points par jour — carburant à chiffrer`,
      hint: `${gaugeName(f.gauge)} palier ${f.tier}, ${formatNumber(f.pointsPerDay)} points/jour${f.durability ? ` (${formatNumber(f.durability)} par objet)` : ''}${unit !== null ? ` · ≈ ${formatKamas(unit)} l’objet` : ''}${thinFuel.length ? ` · ${thinFuel.map((w) => w.text).join(' ')}` : ''}`,
      perDay: f.itemsPerDay ?? undefined,
      kamas: { label: 'Coût par jour', value: f.costPerDay, complete: f.complete && f.costPerDay !== null },
      tone: f.complete && !thinFuel.length ? undefined : 'warn',
    })
  }
  if (st.optimakinasPerDay > 0.01) {
    const gens = d.plan.optimakina.filter((c) => c.use).map((c) => c.generation)
    const lines = gens
      .map((g) => priceLine(d, `makina:${g}`))
      .filter((l): l is PriceLine => !!l)
      .slice(0, 3)
      .map((l) => `G${l.key.split(':')[1]} ${l.value !== null ? kamas(l.value) : '?'} (${originText(l)})`)
    // Liquidité à l'achat : Optimakinas du marché au-delà de la part vendable de leur volume (à fabriquer).
    const thin = d.warnings.filter((w) => w.code === 'volume-achat' && /Optimakina/.test(w.text))
    daily.push({
      id: 'optimakinas',
      kind: 'makina',
      text: `Optimakinas : ≈ ${qty(st.optimakinasPerDay)} par jour (bébés G${Math.min(...gens)} à G${Math.max(...gens)})${thin.length ? ' — en partie à fabriquer (volume de l’HDV insuffisant)' : ''}`,
      hint: [lines.length ? `Prix : ${lines.join(', ')}${gens.length > 3 ? '…' : ''}` : '', ...thin.map((w) => w.text)].filter(Boolean).join(' ') || undefined,
      perDay: st.optimakinasPerDay,
      kamas: { label: 'Coût par jour', value: st.costByCategory.makina, complete: d.complete },
      tone: thin.length ? 'warn' : undefined,
    })
  }
  if (st.costByCategory.capture > 0.5) {
    const cap = priceLine(d, 'capture')
    daily.push({
      id: 'filets',
      kind: 'capture',
      text: `${cap?.label ?? 'Filets'} : ≈ ${qty(st.capturesPerDay / Math.max(1, d.config.mountsPerCast))} par jour`,
      hint: cap?.value !== null && cap?.value !== undefined ? `≈ ${formatKamas(cap.value)} par monture capturée (${originText(cap)})` : undefined,
      kamas: { label: 'Coût par jour', value: st.costByCategory.capture, complete: cap?.complete ?? false },
    })
  }
  if (st.genetonsPerDay > 0.5) {
    const gl = priceLine(d, 'geneton')
    daily.push({
      id: 'genetons',
      kind: 'genetons',
      text: `Génétons : ≈ ${formatNumber(st.genetonsPerDay)} par jour à échanger chez Eugène Éton (meilleur parchemin) puis revendre`,
      hint: `${gl?.label ?? 'Valeur estimée'} ; au-delà du volume du parchemin, le surplus reste en réserve (non compté).`,
      kamas: { label: 'Valeur nette par jour (estimation)', value: st.revenueByCategory.genetons, complete: true },
      tone: 'info',
    })
  }
  daily.push({
    id: 'bilan',
    kind: 'note',
    text: `Bénéfice net attendu : ${formatKamasRange(st.net, true)} par jour en régime permanent${Math.abs(st.netPerDay.max - st.netPerDay.min) > 1 ? ` (${kamas(st.netPerDay.min)} à ${kamas(st.netPerDay.max)} selon les tirages)` : ''}`,
    hint: `Revenus ${formatKamasRange(st.revenue, true)} − coûts ${formatKamasRange(st.cost, true)} ; joueur parfait (compter ×1,5 sur les durées en réel).`,
    kamas: { label: 'Bénéfice net par jour', value: st.net.low, complete: st.net.low !== null && st.net.high !== null && Math.abs(st.net.high - st.net.low) < 0.5 },
    tone: 'ok',
  })

  // Répartition par passage : les mêmes gestes à chaque passage (quantités ÷ passages).
  const labels = sessionLabels(n)
  // Ordre d'une session (règle 13) : accoupler → cloner → sortir → capturer → mettre en enclos.
  const enclosIdx = sessionItems.findIndex((it) => it.kind === 'enclos')
  const sessions: RoutineSession[] = labels.map((label, i) => {
    const cap = captureItem(i === 0)
    const items = [...sessionItems]
    if (cap) items.splice(enclosIdx >= 0 ? enclosIdx : items.length, 0, cap)
    return { id: `s${i + 1}`, label, items }
  })
  if (n > 1 && profile.freeSlots !== undefined && profile.freeSlots !== null)
    notes.push('Les places libres d’aujourd’hui sont à remplir au premier passage ; aux suivants, capturez de quoi remplir les lots qui sortent.')
  if (!d.complete) notes.push('Des prix manquent : les montants sont des minimums (« ≥ ») — renseignez-les sur la page Prix ou importez l’export HDV.')
  notes.push('Quantités moyennes du régime permanent (simulation) : un jour réel varie autour (naissances aléatoires, sexes 50/50).')

  const resources = st.resourcesPerDay
  const parts = [
    captures > 0.01 ? `≈ ${qty(captures)} captures` : '',
    matings > 0.01 ? `≈ ${qty(matings)} accouplements` : '',
    clones > 0.01 ? `≈ ${qty(clones)} clonages` : '',
    extracted > 0.01 ? `≈ ${qty(extracted)} extractions (≈ ${qty(resources)} ${resName ? pluralItemName(resName, resources) : 'ressources'})` : '',
    r.brokenPerDay > 0.01 ? `≈ ${qty(r.brokenPerDay)} brisages` : '',
    st.mountsSoldPerDay > 0.01 ? `≈ ${qty(st.mountsSoldPerDay)} montures vendues` : '',
  ].filter(Boolean)
  return {
    modeId: mode,
    label: def.label,
    strategyLabel: s.label,
    sessionsPerDay: n,
    sessions,
    daily,
    summary: `${parts.join(', ')} par jour`,
    headline: {
      captures,
      matings,
      clones,
      extracted,
      resources,
      broken: r.brokenPerDay,
      sold: st.mountsSoldPerDay,
      net: st.net,
      netMean: st.netPerDay.mean,
      status: st.status,
    },
    notes,
  }
}

/**
 * Passage de la routine correspondant à une heure de la journée (heure de Paris, 0–24) : les passages sont
 * répartis sur la journée (2 passages : matin avant midi, soir après). Jamais « matin » le soir (revue UX2-03).
 */
export function routineSessionAt(routine: Pick<ModeRoutine, 'sessions'>, hour: number): RoutineSession | null {
  const n = routine.sessions.length
  if (!n) return null
  const h = Number.isFinite(hour) ? Math.min(23.999, Math.max(0, hour)) : 0
  return routine.sessions[Math.min(n - 1, Math.floor(h / (24 / n)))]
}

/**
 * Passages regroupés pour l'affichage : des passages consécutifs aux gestes identiques n'en font qu'un
 * (« Matin et soir », « Après-midi et soir ») ; un premier passage différent (places libres du jour) reste à part.
 */
export function mergedSessions(routine: Pick<ModeRoutine, 'sessions'>): RoutineSession[] {
  const sig = (x: RoutineSession) => x.items.map((i) => `${i.id}|${i.text}`).join('\n')
  const out: { first: RoutineSession; labels: string[]; sig: string }[] = []
  for (const x of routine.sessions) {
    const k = sig(x)
    const last = out[out.length - 1]
    if (last && last.sig === k) last.labels.push(x.label.toLowerCase())
    else out.push({ first: x, labels: [x.label], sig: k })
  }
  return out.map((g) => {
    if (g.labels.length === 1) return g.first
    const all = g.labels.length === routine.sessions.length
    const text = `${g.labels.slice(0, -1).join(', ')} et ${g.labels[g.labels.length - 1]}`
    return { ...g.first, label: all ? `À chaque passage (${text.charAt(0).toLowerCase()}${text.slice(1)})` : text }
  })
}

const GAUGE_NAMES: Record<GaugeId, string> = {
  baffeur: 'Baffeur',
  caresseur: 'Caresseur',
  foudroyeur: 'Foudroyeur',
  abreuvoir: 'Abreuvoir',
  dragofesse: 'Dragofesse',
  mangeoire: 'Mangeoire',
}

function gaugeName(g: GaugeId): string {
  return GAUGE_NAMES[g] ?? g
}

// ---------- Montée en charge (calendrier) ----------

/** Point de départ de la simulation d'un résultat : « depuis un élevage vide » ou « depuis N montures au départ ». */
export function timelineBasis(o: Pick<ModeOutcome, 'digest'> | null | undefined): string {
  const n = o?.digest?.config.initialStockCount ?? 0
  return n > 0 ? `simulation depuis ${formatNumber(n)} monture${n > 1 ? 's' : ''} au départ` : 'simulation depuis un élevage vide'
}

/** Jalon de la montée en charge d'un mode (simulation depuis un élevage vide). */
export interface ModeMilestone {
  id: 'remplir' | 'premiere-cible' | 'premieres-ventes' | 'enclos' | 'regime' | 'point-mort'
  /** Jour de la simulation (1 = premier jour), null si non atteint sur la durée simulée. */
  day: number | null
  text: string
}

/**
 * Calendrier de montée en charge d'un mode (revue UX2-03) : remplir les places, première monture de la
 * génération visée, premières ventes (ou brisages), régime permanent, point mort — jours de la simulation
 * (élevage parti de zéro, joueur parfait). Les quantités de la routine sont celles du régime permanent :
 * ce calendrier dit quand elles s'appliquent.
 */
export function modeTimeline(o: ModeOutcome, opts: { freeSlots?: number | null } = {}): ModeMilestone[] {
  const d = o.digest
  const s = o.strategy
  if (!d || !s) return []
  const out: ModeMilestone[] = []
  const places = opts.freeSlots ?? d.config.paddocks * 10
  const captures = d.routine.capturesPerDay.reduce((t, c) => t + c.perDay, 0)
  if (places > 0) out.push({ id: 'remplir', day: 1, text: `Semaine 1 : remplir ${formatNumber(places)} place${places > 1 ? 's' : ''} d’enclos (capacité ≈ ${formatNumber(d.captureCapacityPerDay)} captures/jour${captures > 0 ? `, ≈ ${qty(captures)}/jour ensuite` : ''})` })
  if (d.mode !== 'brisage') {
    const T = d.config.targetGeneration
    out.push({ id: 'premiere-cible', day: d.firstTargetDay !== null ? Math.max(1, Math.round(d.firstTargetDay)) : null, text: d.firstTargetDay !== null ? `1re G${T} ≈ jour ${formatNumber(Math.max(1, Math.round(d.firstTargetDay)))}` : `1re G${T} : pas sur les ${d.config.horizonDays} jours simulés` })
  }
  const product = mainMarketCheck(o)?.name ?? modeDef(o.modeId).resourceName
  if (d.firstSaleDay !== undefined)
    out.push({
      id: 'premieres-ventes',
      day: d.firstSaleDay,
      text: d.firstSaleDay !== null ? `${d.mode === 'brisage' ? 'Premiers brisages' : `Premières ventes${product ? ` (${product})` : ''}`} ≈ jour ${formatNumber(d.firstSaleDay)}` : 'Premières ventes : pas sur la durée simulée',
    })
  out.push({
    id: 'regime',
    day: s.rampUpDays,
    text: s.rampUpDays !== null ? `Régime permanent (quantités de la routine) ≈ jour ${formatNumber(s.rampUpDays)}` : `Régime permanent : pas stabilisé sur ${formatNumber(s.extendedDays ?? d.config.horizonDays)} jours`,
  })
  out.push({ id: 'point-mort', day: s.breakEvenDay, text: s.breakEvenDay !== null ? `Point mort ≈ jour ${formatNumber(s.breakEvenDay)}` : 'Point mort : pas sur la durée simulée' })
  // Enclos débloqués par l'XP d'élevage : la routine du régime permanent les suppose en service.
  for (const u of paddockUnlocks(d)) out.push({ id: 'enclos', day: u.day, text: `${u.paddocks}e enclos (XP d’élevage) ≈ jour ${formatNumber(u.day)}` })
  // Ordre chronologique (jalons non atteints à la fin).
  return out.map((m, i) => ({ m, i })).sort((a, b) => (a.m.day ?? Infinity) - (b.m.day ?? Infinity) || a.i - b.i).map((x) => x.m)
}

// ---------- Résultats enregistrés et mode actif ----------

/** Résultats de la dernière comparaison, enregistrés pour le profil (accueil, plan, conseiller). */
export interface StoredModeResults {
  version: 1
  computedAt: number
  /** `modeContextKey` des hypothèses du calcul. */
  contextKey: string
  /** Rappel lisible des hypothèses. */
  context: { jobLevel: number; paddocks: number; hoursPerDay: number; characters: number; rulesId: string; marketDate: string | null; serverName: string | null }
  quick: boolean
  bestModeId: ModeId | null
  outcomes: ModeOutcome[]
  notes: string[]
}

export const STORED_MODE_RESULTS_VERSION = 1

/** Construit l'enregistrement d'une comparaison. */
export function storeModeResults(cmp: ModeComparison | ModeOutcome[], p: ModeProfile, opts: { computedAt: number; quick: boolean; serverId?: string; extra?: ModeOutcome[] }): StoredModeResults {
  const outcomes = [...(Array.isArray(cmp) ? cmp : outcomesFromComparison(cmp)), ...(opts.extra ?? [])]
  const m = p.prices.ctx.market
  return {
    version: 1,
    computedAt: opts.computedAt,
    contextKey: modeContextKey(p, { serverId: opts.serverId }),
    context: {
      jobLevel: p.jobLevel,
      paddocks: profilePaddocks(p),
      hoursPerDay: p.hoursPerDay,
      characters: Math.max(1, Math.round(p.characters || 1)),
      rulesId: p.rules.id,
      marketDate: m?.exportDate ?? null,
      serverName: m?.serverName ?? null,
    },
    quick: opts.quick,
    bestModeId: rankModes(outcomes.filter((o) => o.modeId !== 'progression')).bestModeId,
    outcomes,
    notes: Array.isArray(cmp) ? [] : cmp.notes,
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Lecture tolérante d'un enregistrement (null si illisible ou d'une autre version). */
export function sanitizeStoredModeResults(raw: unknown): StoredModeResults | null {
  if (!isObj(raw) || raw.version !== STORED_MODE_RESULTS_VERSION) return null
  if (typeof raw.computedAt !== 'number' || typeof raw.contextKey !== 'string' || !Array.isArray(raw.outcomes) || !isObj(raw.context)) return null
  const outcomes = raw.outcomes.filter(
    (o): o is ModeOutcome =>
      isObj(o) &&
      isModeId(o.modeId) &&
      typeof o.available === 'boolean' &&
      (o.strategy === null || (isObj(o.strategy) && typeof o.strategy.steadyNet === 'number' && isObj(o.strategy.params) && isObj(o.strategy.net))) &&
      (o.digest === null || (isObj(o.digest) && isObj(o.digest.steady) && isObj(o.digest.routine) && Array.isArray(o.digest.market) && isObj(o.digest.plan))) &&
      Array.isArray(o.alternatives) &&
      Array.isArray(o.variants),
  )
  return {
    version: 1,
    computedAt: raw.computedAt,
    contextKey: raw.contextKey,
    context: raw.context as StoredModeResults['context'],
    quick: raw.quick === true,
    bestModeId: isModeId(raw.bestModeId) ? raw.bestModeId : null,
    outcomes,
    notes: Array.isArray(raw.notes) ? raw.notes.filter((x): x is string => typeof x === 'string') : [],
  }
}

/** Stratégie appliquée par le conseiller pour le mode actif. */
export interface ModeStrategyParams {
  targetGeneration: number
  parentLevel: number
  brisageLevel: number
  tier: FuelTier
  mateBeforeExtract: boolean
  optimakina: OptimakinaPolicy
  /** Espèces produites (cibles du plan), si connues. */
  targetSpeciesIds: number[]
}

/** Mode actif du profil, résolu pour le conseiller, l'accueil et le plan. */
export interface ActiveMode {
  /** Réglage du profil (peut être `auto`). */
  requested: ModeId
  /** Mode suivi (`auto` → meilleur mode calculé, sinon `progression`). */
  id: ModeId
  def: ModeDef
  kind: Exclude<ModeKind, 'auto'>
  /** Famille travaillée (null : progression → celle des réglages). */
  family: FamilyId | null
  params: ModeStrategyParams
  strategyLabel: string
  /** `calcul` : stratégie de la dernière comparaison ; `defaut` : stratégie par défaut (non calculée). */
  source: 'calcul' | 'defaut'
  computedAt: number | null
  /** Le calcul enregistré a été fait avec d'autres hypothèses (niveau, enclos, prix…). */
  stale: boolean
  outcome: ModeOutcome | null
  routine: ModeRoutine | null
  /** Ressource / rune produite. */
  itemId: number | null
  /** Ventes quotidiennes du produit à ne pas dépasser (part du volume), null si inconnu. */
  sellCapPerDay: number | null
  /** `auto` sans calcul : pourquoi on revient à la progression. */
  note?: string
  /**
   * Le mode travaille une autre famille que celle du profil (`settings.family`) : vos montures de la famille
   * du profil ne servent plus sa stratégie (revue UX2-01). null sinon.
   */
  familySwitch: { from: FamilyId; to: FamilyId } | null
  /** Plan d'investissement suivi (« Suivre ce plan ») : sa stratégie remplace celle de la comparaison. */
  plan: { label: string; pinnedAt: number; budget: number | null; horizonDays: number | null } | null
}

// ---------- Plan d'investissement suivi (« Suivre ce plan ») ----------

/**
 * Stratégie d'un plan d'investissement suivie par le profil (revue UX2-04) : l'accueil, le plan et le
 * conseiller appliquent ces paramètres (et la routine de ce plan) tant que le mode du profil est le sien.
 */
export interface PinnedModePlan {
  version: 1
  modeId: ModeId
  family: FamilyId | null
  params: StrategyParams
  label: string
  source: 'investissement'
  pinnedAt: number
  budget: number | null
  horizonDays: number | null
  /** Résultat du plan (stratégie et routine du régime permanent) ; null si trop volumineux. */
  outcome: ModeOutcome | null
  /** `modeContextKey` du profil au moment du choix (niveau, prix…) : autre clé → plan « à recalculer ». */
  contextKey: string | null
}

const isFamily = (v: unknown): v is FamilyId => typeof v === 'string' && v in FAMILIES

/** Lecture tolérante d'un plan suivi (null si illisible). */
export function sanitizePinnedModePlan(raw: unknown): PinnedModePlan | null {
  if (!isObj(raw) || raw.version !== 1 || !isModeId(raw.modeId) || raw.modeId === 'auto' || raw.modeId === 'progression') return null
  if (!isObj(raw.params) || typeof raw.label !== 'string' || typeof raw.pinnedAt !== 'number') return null
  const params: StrategyParams = {}
  const p = raw.params
  if (typeof p.targetGeneration === 'number') params.targetGeneration = p.targetGeneration
  if (typeof p.parentLevel === 'number') params.parentLevel = p.parentLevel
  if (typeof p.brisageLevel === 'number') params.brisageLevel = p.brisageLevel
  if (typeof p.tier === 'number' && [1, 2, 3, 4].includes(p.tier)) params.tier = p.tier as FuelTier
  if (typeof p.mateBeforeExtract === 'boolean') params.mateBeforeExtract = p.mateBeforeExtract
  if (p.optimakina === 'none' || p.optimakina === 'auto' || p.optimakina === 'all' || (isObj(p.optimakina) && typeof p.optimakina.fromGeneration === 'number'))
    params.optimakina = p.optimakina as OptimakinaPolicy
  const o = raw.outcome
  const outcome =
    isObj(o) && o.modeId === raw.modeId && isObj(o.strategy) && isObj(o.digest) && isObj(o.digest.steady) && isObj(o.digest.routine) && Array.isArray(o.digest.market) && isObj(o.digest.plan)
      ? (o as unknown as ModeOutcome)
      : null
  return {
    version: 1,
    modeId: raw.modeId,
    family: isFamily(raw.family) ? raw.family : null,
    params,
    label: raw.label.slice(0, 300),
    source: 'investissement',
    pinnedAt: raw.pinnedAt,
    budget: typeof raw.budget === 'number' && Number.isFinite(raw.budget) ? raw.budget : null,
    horizonDays: typeof raw.horizonDays === 'number' && Number.isFinite(raw.horizonDays) ? raw.horizonDays : null,
    outcome,
    contextKey: typeof raw.contextKey === 'string' ? raw.contextKey : null,
  }
}

/** Phrase d'avertissement d'un changement de famille (activation d'un mode, bandeau de l'accueil). */
export function familySwitchText(modeLabel: string, from: FamilyId, to: FamilyId, owned: number): string {
  const f = FAMILIES[from]
  const t = FAMILIES[to]
  return `${modeLabel} travaille les ${t?.plural ?? to} : ${owned > 0 ? `vos ${formatNumber(owned)} ${owned >= 2 ? (f?.plural ?? from) : (f?.label ?? from)} ne servent plus la stratégie (captures, accouplements et sorties du mode portent sur les ${t?.plural ?? to})` : `vos captures et conseils passent aux ${t?.plural ?? to}`}.`
}

function strategyParamsOf(mode: ModeId, o: ModeOutcome | null): ModeStrategyParams {
  const p: StrategyParams = o?.strategy?.params ?? defaultModeParams(mode)
  const d = o?.digest
  return {
    targetGeneration: o?.strategy?.targetGeneration ?? p.targetGeneration ?? 6,
    parentLevel: p.parentLevel ?? DEFAULT_PARENT_LEVEL,
    brisageLevel: p.brisageLevel ?? (modeDef(mode).kind === 'brisage' ? 80 : DEFAULT_BRISAGE_LEVEL),
    tier: (p.tier ?? 2) as FuelTier,
    mateBeforeExtract: p.mateBeforeExtract ?? modeDef(mode).kind !== 'brisage',
    optimakina: p.optimakina ?? 'auto',
    targetSpeciesIds: d?.plan.targets ?? p.targetSpeciesIds ?? [],
  }
}

/**
 * Mode suivi par le profil : `auto` devient le meilleur mode de la dernière comparaison (sinon la
 * progression, avec une note) ; la stratégie vient de la comparaison enregistrée (sinon stratégie par
 * défaut, signalée). `contextKey` (hypothèses actuelles) signale un calcul périmé.
 */
export function resolveActiveMode(
  requested: ModeId | string | null | undefined,
  stored: StoredModeResults | null,
  opts: { contextKey?: string; family?: FamilyId; routine?: RoutineProfile; pinned?: PinnedModePlan | null } = {},
): ActiveMode {
  const req: ModeId = isModeId(requested) ? requested : DEFAULT_MODE
  let id: ModeId = req
  let note: string | undefined
  if (req === 'auto') {
    if (stored?.bestModeId) id = stored.bestModeId
    else {
      id = 'progression'
      note = 'Mode automatique : aucune comparaison des modes n’est encore calculée pour ce profil — ouvrez « Modes de rentabilité » pour choisir le plus rentable. En attendant, les conseils suivent votre objectif de progression.'
    }
  }
  const def = modeDef(id)
  // Plan d'investissement suivi : seulement pour son mode, demandé explicitement (pas en « auto »).
  const pinned = opts.pinned && opts.pinned.modeId === id && req === id ? opts.pinned : null
  const computed = stored?.outcomes.find((o) => o.modeId === id && o.strategy && o.digest) ?? null
  const outcome = pinned ? pinned.outcome : computed
  const kind = def.kind === 'auto' ? 'progression' : def.kind
  const family = def.family ?? (kind === 'vente' ? (pinned?.family ?? outcome?.family ?? opts.family ?? null) : null)
  const params = pinned ? { ...strategyParamsOf(id, outcome), ...pinnedParams(pinned) } : strategyParamsOf(id, outcome)
  const itemId = def.resourceItemId ?? (kind === 'vente' && family ? FAMILIES[family].extractionItemId : null)
  const main = outcome ? mainMarketCheck(outcome) : null
  const routine = outcome && kind !== 'progression' ? dailyRoutine(id, outcome, opts.routine) : null
  return {
    requested: req,
    id,
    def,
    kind,
    family,
    params,
    strategyLabel: pinned
      ? `${pinned.label} (plan d’investissement suivi)`
      : (outcome?.strategy?.label ??
        (kind === 'progression' ? 'Objectif du plan d’élevage' : `${def.kind === 'brisage' ? `Brisage niv. ${params.brisageLevel} · palier ${params.tier}` : `G${params.targetGeneration} · parents niv. ${params.parentLevel} · Optimakina auto · palier ${params.tier}`} (par défaut, non calculée)`)),
    source: outcome || pinned ? 'calcul' : 'defaut',
    computedAt: pinned ? pinned.pinnedAt : (stored?.computedAt ?? null),
    stale: pinned
      ? opts.contextKey !== undefined && pinned.contextKey !== null && pinned.contextKey !== opts.contextKey
      : !!stored && opts.contextKey !== undefined && stored.contextKey !== opts.contextKey,
    outcome,
    routine,
    itemId,
    sellCapPerDay: main && main.kind !== 'monture' ? main.capPerDay : null,
    ...(note ? { note } : {}),
    familySwitch: kind !== 'progression' && family && opts.family && family !== opts.family ? { from: opts.family, to: family } : null,
    plan: pinned ? { label: pinned.label, pinnedAt: pinned.pinnedAt, budget: pinned.budget, horizonDays: pinned.horizonDays } : null,
  }
}

/** Paramètres d'un plan suivi au format du conseiller (valeurs absentes : celles de la stratégie). */
function pinnedParams(p: PinnedModePlan): Partial<ModeStrategyParams> {
  const out: Partial<ModeStrategyParams> = {}
  const x = p.params
  if (x.targetGeneration !== undefined) out.targetGeneration = x.targetGeneration
  if (x.parentLevel !== undefined) out.parentLevel = x.parentLevel
  if (x.brisageLevel !== undefined) out.brisageLevel = x.brisageLevel
  if (x.tier !== undefined) out.tier = x.tier
  if (x.mateBeforeExtract !== undefined) out.mateBeforeExtract = x.mateBeforeExtract
  if (x.optimakina !== undefined) out.optimakina = x.optimakina
  return out
}

/** Clé courte d'un mode actif (cache de l'analyse du conseiller). */
export function activeModeKey(m: ActiveMode | null | undefined): string {
  if (!m) return ''
  return JSON.stringify([m.id, m.family, m.params, m.source, m.computedAt, m.plan?.pinnedAt ?? null])
}
