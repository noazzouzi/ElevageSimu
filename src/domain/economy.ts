// Économie de l'élevage : valeur des montures (vente, extraction, brisage), génétons, coûts de
// fécondité, d'XP, de capture et de makinas, rentabilité d'un cycle et classement des croisements.
//
// Sources : research/README.md §2.9, research/economy.md §3.3, §5, §6.3, §8, §9.2,
// research/data/prices-default.json (valuation, mounts, genetons), strategy.json → formulas.
// Toute valeur inconnue reste « incomplète » (jamais comptée comme 0) ; les estimations sont signalées.
import {
  FAMILIES,
  FUELS,
  INGREDIENTS,
  MAKINAS,
  NETS,
  PRICES_DEFAULT,
  defaultItemPrice,
  findMakina,
  getSpecies,
  itemName,
  speciesOfFamily,
  type DefaultMountPrice,
  type MakinaRecipe,
  type NetRecipe,
  type PriceType,
} from '../data'
import { GAUGE_LABELS, JOB_XP_PER_CAPTURE, MOUNT_STAT_MAX, TICK_SECONDS } from './constants'
import { bestFuel, type GaugePointCost } from './fuel'
import { breed, type BreedingParent, type BreedingResult } from './genetics'
import { marketPrice, resolvePrice, type PriceContext, type PriceOrigin } from './pricing'
import type { Ruleset } from './rules'
import type { FamilyId, FuelTier, GaugeId, MakinaKind } from './types'
import { mountXpBetween } from './xp'

// ---------- Utilitaires ----------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const uniq = (ids: number[]) => [...new Set(ids)]

/** Normalise un libellé pour comparer des noms (minuscules, sans accents ni apostrophes typographiques). */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'Oe')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'Ae')
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// ---------- Prix de vente d'une monture ----------

/** Tranche de niveau des prix de montures (niv. 1, 100 ou 200, la plus proche). */
export type MountBand = '1' | '100' | '200'
export const MOUNT_BANDS: MountBand[] = ['1', '100', '200']

export function mountBand(level: number): MountBand {
  const L = clamp(Math.floor(level || 1), 1, 200)
  const d1 = L - 1
  const d100 = Math.abs(L - 100)
  const d200 = 200 - L
  if (d1 <= d100) return '1'
  if (d100 <= d200) return '100'
  return '200'
}

/** Prix de montures saisis par le joueur (store usePrices) + réglage des prix par défaut. */
export interface MountPriceContext {
  /** Clé `${speciesId}|${band}`. */
  mountOverrides: Record<string, number>
  /** Clé `${family}|${generation}|${band}`. */
  generationOverrides: Record<string, number>
  useDefaults: boolean
}

export type MountState = 'fertile' | 'feconde' | 'sterile'
export type MountPriceOrigin = 'joueur-espece' | 'joueur-generation' | 'defaut-espece' | 'defaut-generation' | 'manquant'

export const MOUNT_PRICE_ORIGIN_LABELS: Record<MountPriceOrigin, string> = {
  'joueur-espece': 'votre prix (couleur)',
  'joueur-generation': 'votre prix (génération)',
  'defaut-espece': 'défaut (couleur)',
  'defaut-generation': 'défaut (génération)',
  manquant: 'aucun prix',
}

export interface MountSalePrice {
  price: number | null
  origin: MountPriceOrigin
  band: MountBand
  confidence?: string
  priceType?: PriceType
  /** Plancher de valorisation calculé par la recherche (pas un cours ; déjà net de taxe). */
  isFloor: boolean
  row?: DefaultMountPrice
}

const PRICE_TYPE_RANK: Record<string, number> = { observed: 0, derived: 1, estimate: 2, 'floor-estimate': 3, 'non-tradable': 4 }

function rowStateKind(state: string | null): 'fertile' | 'feconde' | 'sterile' | 'any' {
  const s = normalizeName(state ?? '')
  if (s.startsWith('feconde')) return 'feconde'
  if (s.startsWith('fertile')) return 'fertile'
  if (s.startsWith('sterile ou') || s === '' || s.startsWith('inconnu')) return 'any'
  if (s.startsWith('sterile')) return 'sterile'
  return 'any'
}

function stateAccepts(row: DefaultMountPrice, state: MountState): boolean {
  const k = rowStateKind(row.state)
  if (k === 'any') return true
  if (state === 'feconde') return true
  if (state === 'sterile') return k === 'sterile'
  return k === 'fertile'
}

function pickRow(rows: DefaultMountPrice[], band: MountBand, state: MountState): DefaultMountPrice | undefined {
  return rows
    .filter((r) => r.price !== null && (r.level === null || mountBand(r.level) === band) && stateAccepts(r, state))
    .sort(
      (a, b) =>
        Number(state === 'feconde' && rowStateKind(b.state) === 'feconde') - Number(state === 'feconde' && rowStateKind(a.state) === 'feconde') ||
        Number(a.level === null) - Number(b.level === null) ||
        (PRICE_TYPE_RANK[a.priceType] ?? 9) - (PRICE_TYPE_RANK[b.priceType] ?? 9),
    )[0]
}

/**
 * Revente de base d'une tranche (sans relevé) : plancher G1 de la famille, où ni l'extraction ni le
 * brisage ne dominent (12 250 / 49 000 / 147 000, déjà nets de taxe).
 */
function baseResale(family: FamilyId, band: MountBand): number | null {
  const row = pickRow(
    PRICES_DEFAULT.mounts.filter((r) => r.name === null && r.family === family && r.generation === 1 && r.priceType === 'floor-estimate'),
    band,
    'sterile',
  )
  return row?.price ?? null
}

/**
 * Les planchers de la recherche valent max(extraction, brisage, revente de base) aux prix par
 * défaut. Comme vente, on n'en garde que la revente de base : l'extraction et le brisage sont
 * calculés à part avec VOS prix (sinon double compte à des prix périmés).
 */
function adjustFloor(row: DefaultMountPrice): DefaultMountPrice {
  if (row.priceType !== 'floor-estimate' || !row.family || row.price === null) return row
  const base = baseResale(row.family, mountBand(row.level ?? 1))
  if (base === null || base === row.price) return row
  return {
    ...row,
    price: base,
    notes: `Revente de base (sans relevé, nette de taxe). Le plancher de la recherche (${row.price} K) inclut l'extraction et le brisage, comptés à part avec vos prix.`,
  }
}

/** Prix par défaut d'une famille/génération/tranche (ligne générique de la recherche, hors noms). */
export function defaultGenerationPrice(family: FamilyId, generation: number, band: MountBand, state: MountState = 'fertile'): DefaultMountPrice | undefined {
  const row = pickRow(
    PRICES_DEFAULT.mounts.filter((r) => r.name === null && r.family === family && r.generation === generation),
    band,
    state,
  )
  return row && adjustFloor(row)
}

/** Prix par défaut propre à une couleur (relevé nominatif), pour une tranche. */
export function defaultSpeciesPrice(speciesId: number, band: MountBand): DefaultMountPrice | undefined {
  const sp = getSpecies(speciesId)
  if (!sp) return undefined
  return pickRow(
    PRICES_DEFAULT.mounts.filter((r) => r.name !== null && normalizeName(r.name) === normalizeName(sp.name)),
    band,
    'feconde',
  )
}

/**
 * Prix de vente (brut, avant taxe) d'une monture : votre prix par couleur > votre prix par
 * génération > défaut par nom exact > défaut par famille/génération/tranche de niveau.
 * Les lignes « floor-estimate » sont des planchers calculés, pas des cours (signalées).
 */
export function mountSalePrice(
  speciesId: number,
  level: number,
  mctx: MountPriceContext,
  opts: { state?: MountState } = {},
): MountSalePrice {
  const band = mountBand(level)
  const sp = getSpecies(speciesId)
  const state = opts.state ?? 'fertile'
  const none: MountSalePrice = { price: null, origin: 'manquant', band, isFloor: false }
  if (!sp) return none
  const own = mctx.mountOverrides[`${speciesId}|${band}`]
  if (own !== undefined && Number.isFinite(own)) return { price: own, origin: 'joueur-espece', band, isFloor: false, confidence: 'joueur' }
  const gen = mctx.generationOverrides[`${sp.family}|${sp.generation}|${band}`]
  if (gen !== undefined && Number.isFinite(gen)) return { price: gen, origin: 'joueur-generation', band, isFloor: false, confidence: 'joueur' }
  if (!mctx.useDefaults) return none
  const byNameRaw = pickRow(
    PRICES_DEFAULT.mounts.filter((r) => r.name !== null && normalizeName(r.name) === normalizeName(sp.name)),
    band,
    state,
  )
  const byName = byNameRaw && adjustFloor(byNameRaw)
  if (byName)
    return {
      price: byName.price,
      origin: 'defaut-espece',
      band,
      confidence: byName.confidence,
      priceType: byName.priceType,
      isFloor: byName.priceType === 'floor-estimate',
      row: byName,
    }
  const byGen = defaultGenerationPrice(sp.family, sp.generation, band, state)
  if (byGen)
    return {
      price: byGen.price,
      origin: 'defaut-generation',
      band,
      confidence: byGen.confidence,
      priceType: byGen.priceType,
      isFloor: byGen.priceType === 'floor-estimate',
      row: byGen,
    }
  return none
}

// ---------- Extraction ----------

export interface ExtractionValue {
  /** Ressources obtenues (= génération ; G1 = 0 ; sénile = 1). */
  qty: number
  possible: boolean
  itemId: number
  itemName: string
  unitPrice: number | null
  /** Valeur brute (avant taxe). */
  value: number | null
  complete: boolean
  origin: PriceOrigin
  confidence?: string
}

/** Valeur d'extraction : quantité × prix de la ressource de la famille (Neurone, Ambre, Corne). */
export function extractionValue(speciesId: number, ctx: PriceContext, opts: { senile?: boolean } = {}): ExtractionValue {
  const sp = getSpecies(speciesId)
  const family = sp?.family ?? 'muldo'
  const info = FAMILIES[family]
  const qty = !sp || !sp.breedable ? 0 : opts.senile ? 1 : sp.extractionQty
  const p = marketPrice(info.extractionItemId, ctx)
  return {
    qty,
    possible: qty > 0,
    itemId: info.extractionItemId,
    itemName: info.extractionItemName,
    unitPrice: p.price,
    value: qty === 0 ? 0 : p.price === null ? null : qty * p.price,
    complete: qty === 0 || p.price !== null,
    origin: p.origin,
    confidence: p.confidence,
  }
}

// ---------- Brisage ----------

interface BrisageData {
  defaultValuePerMountByLevel: Record<string, Record<string, number> | null>
  defaultConfidence?: string
  possibleAsOf?: string
}

/** Rune Ga principale du brisage : Muldo → Ga PM (1558), Volkorne → Ga PA (1557) (economy.md §5.2). */
export const BRISAGE_RUNE: Record<FamilyId, number | null> = { muldo: 1558, volkorne: 1557, dragodinde: null }

/** Niveau à partir duquel des runes Ga tombent (≈ 35, témoignages [S11], basse). */
export const BRISAGE_MIN_LEVEL = 35

export const BRISAGE_RISK_NOTE =
  'Brisage possible en 3.5/3.6 mais annoncé impossible par Ankama en 2025 : risque de correctif. Valeurs = rendements observés (relevés communautaires).'

export interface BrisageValue {
  /** Valeur brute des runes par monture (avant taxe), ou null. */
  value: number | null
  possible: boolean
  method: 'releve' | 'interpolation' | 'extrapolation' | 'indisponible'
  confidence: string
  runeItemId: number | null
  /** Facteur appliqué si le prix de la rune Ga diffère du défaut. */
  scale: number
  complete: boolean
  note: string
}

/**
 * Valeur de brisage d'une monture (runes) selon les rendements observés de la recherche
 * (valuation.brisage.defaultValuePerMountByLevel, interpolés entre niv. 45 / 53 / 100 / 200), mise
 * à l'échelle du prix de la rune Ga si vous l'avez saisi. Aucune donnée pour les Dragodindes.
 */
export function brisageValue(family: FamilyId, level: number, ctx?: PriceContext): BrisageValue {
  const data = PRICES_DEFAULT.valuation.brisage as BrisageData | undefined
  const anchorsRaw = data?.defaultValuePerMountByLevel?.[FAMILIES[family].label] ?? null
  const rune = BRISAGE_RUNE[family]
  if (!anchorsRaw || rune === null)
    return {
      value: null,
      possible: false,
      method: 'indisponible',
      confidence: 'low',
      runeItemId: rune,
      scale: 1,
      complete: true,
      note: `Aucun relevé de brisage pour les ${FAMILIES[family].plural}.`,
    }
  const anchors = Object.entries(anchorsRaw)
    .map(([l, v]) => [Number(l), v] as [number, number])
    .sort((a, b) => a[0] - b[0])
  const L = clamp(Math.floor(level || 1), 1, 200)
  let base: number
  let method: BrisageValue['method'] = 'interpolation'
  if (L < BRISAGE_MIN_LEVEL) {
    base = 0
    method = 'extrapolation'
  } else if (L < anchors[0][0]) {
    base = (anchors[0][1] * (L - BRISAGE_MIN_LEVEL)) / (anchors[0][0] - BRISAGE_MIN_LEVEL)
    method = 'extrapolation'
  } else {
    const hi = anchors.findIndex(([al]) => al >= L)
    if (hi === -1) base = anchors[anchors.length - 1][1]
    else if (anchors[hi][0] === L) {
      base = anchors[hi][1]
      method = 'releve'
    } else {
      const [l0, v0] = anchors[hi - 1]
      const [l1, v1] = anchors[hi]
      base = v0 + ((v1 - v0) * (L - l0)) / (l1 - l0)
    }
  }
  let scale = 1
  let complete = true
  let note = method === 'extrapolation' ? `Extrapolé sous le niveau ${anchors[0][0]} (runes Ga dès ≈ niv. ${BRISAGE_MIN_LEVEL}).` : method === 'interpolation' ? 'Interpolé entre les relevés.' : 'Relevé.'
  if (ctx) {
    const def = defaultItemPrice(rune)?.price ?? null
    const cur = marketPrice(rune, ctx).price
    if (cur === null || def === null) {
      complete = false
      note += ` Prix de la ${itemName(rune)} manquant.`
    } else if (cur !== def) {
      scale = cur / def
      note += ` Mis à l'échelle du prix de la ${itemName(rune)} (${Math.round(scale * 100)} % du défaut).`
    }
  }
  return {
    value: complete ? base * scale : null,
    possible: true,
    method,
    confidence: data?.defaultConfidence ?? 'low',
    runeItemId: rune,
    scale,
    complete,
    note,
  }
}

// ---------- Valorisation d'une monture ----------

export type FateKind = 'vente' | 'extraction' | 'brisage'

export const FATE_LABELS: Record<FateKind, string> = { vente: 'Vente', extraction: 'Extraction', brisage: 'Brisage' }

export interface FateValue {
  kind: FateKind
  possible: boolean
  /** Montant brut (avant taxe). */
  gross: number | null
  /** Montant net de la taxe d'HDV. */
  net: number | null
  complete: boolean
  confidence?: string
  origin: string
  note?: string
}

export interface MountValuation {
  speciesId: number
  level: number
  sale: FateValue
  extraction: FateValue
  brisage: FateValue
  /** Meilleure valeur nette connue (borne basse si incomplet). */
  best: number | null
  bestKind: FateKind | null
  confidence: string
  /** Toutes les options possibles sont chiffrées. */
  complete: boolean
  salePrice: MountSalePrice
}

export interface ValuationOptions {
  ctx: PriceContext
  mountPrices: MountPriceContext
  /** Taxe d'HDV (0,02 = 2 %). */
  saleTax: number
  state?: MountState
  senile?: boolean
}

/** Valeur d'une monture : max(vente, extraction, brisage), chaque terme net de la taxe d'HDV. */
export function mountValuation(speciesId: number, level: number, opts: ValuationOptions): MountValuation {
  const sp = getSpecies(speciesId)
  const tax = clamp(opts.saleTax, 0, 1)
  const salePrice = mountSalePrice(speciesId, level, opts.mountPrices, { state: opts.state })
  // Les planchers de la recherche sont déjà nets de taxe.
  const saleNet = salePrice.price === null ? null : salePrice.isFloor ? salePrice.price : salePrice.price * (1 - tax)
  const sale: FateValue = {
    kind: 'vente',
    possible: true,
    gross: salePrice.price,
    net: saleNet,
    complete: salePrice.price !== null,
    confidence: salePrice.confidence,
    origin: MOUNT_PRICE_ORIGIN_LABELS[salePrice.origin],
    note: salePrice.isFloor ? 'Revente de base estimée (pas un cours), déjà nette de taxe.' : undefined,
  }
  const ex = extractionValue(speciesId, opts.ctx, { senile: opts.senile })
  const extraction: FateValue = {
    kind: 'extraction',
    possible: ex.possible,
    gross: ex.possible ? ex.value : null,
    net: ex.possible && ex.value !== null ? ex.value * (1 - tax) : null,
    complete: ex.complete,
    confidence: ex.origin === 'joueur' ? 'joueur' : ex.confidence,
    origin: ex.possible ? `${ex.qty} × ${ex.itemName}` : 'génération 1 : rien à extraire',
  }
  const br = sp ? brisageValue(sp.family, level, opts.ctx) : null
  const brisage: FateValue = {
    kind: 'brisage',
    possible: !!br?.possible,
    gross: br?.possible ? br.value : null,
    net: br?.possible && br.value !== null ? br.value * (1 - tax) : null,
    complete: br ? br.complete : true,
    confidence: br?.confidence,
    origin: br?.possible ? 'rendements observés' : 'indisponible',
    note: br?.note,
  }
  // Ordre de préférence à valeur égale : extraction, brisage, puis vente (un plancher n'est pas un cours).
  const fates = [extraction, brisage, sale].filter((f) => f.possible && f.net !== null)
  let best: FateValue | null = null
  for (const f of fates) if (!best || (f.net as number) > (best.net as number) + 1e-9) best = f
  return {
    speciesId,
    level,
    sale,
    extraction,
    brisage,
    best: best?.net ?? null,
    bestKind: best?.kind ?? null,
    confidence: best?.confidence ?? 'low',
    complete: [sale, extraction, brisage].every((f) => !f.possible || f.complete),
    salePrice,
  }
}

// ---------- Génétons ----------

export interface GenetonValue {
  value: number
  range: [number, number]
  origin: 'joueur' | 'defaut'
  confidence: string
  basis: string
}

/** Valeur d'un généton en kamas : votre valeur, sinon 375 K (Puissant Parchemin ≈ 60 000 / 160). */
export function genetonKamasValue(override?: number | null): GenetonValue {
  const g = PRICES_DEFAULT.genetons
  if (override !== null && override !== undefined && Number.isFinite(override) && override >= 0)
    return { value: override, range: g.range, origin: 'joueur', confidence: 'joueur', basis: 'Valeur saisie.' }
  return { value: g.kamasPerGeneton, range: g.range, origin: 'defaut', confidence: g.confidence, basis: g.basis }
}

// ---------- Coûts d'enclos : fécondité et XP ----------

/**
 * Points de Baffeur + Caresseur par lot, par défaut : moyenne du planificateur de fécondité
 * (fertility.ts) pour une sérénité de départ uniforme sur [−5 000 ; 5 000] (pas de 500) ≈ 3 200.
 * ESTIMATION : la distribution réelle de la sérénité initiale est inconnue (research §4 n° 9).
 */
export const DEFAULT_SERENITY_POINTS = 3_200

export const FERTILITY_GAUGES: GaugeId[] = ['foudroyeur', 'abreuvoir', 'dragofesse', 'baffeur', 'caresseur']

/**
 * Durée pour rendre un lot fécond au palier donné (approximation calée sur le planificateur) :
 * endurance + maturité ensemble, puis sérénité, puis amour ⇒ (40 000 + ½ sérénité) / débit.
 */
export function fertilitySeconds(tier: FuelTier, rules: Ruleset, serenityPoints = DEFAULT_SERENITY_POINTS): number {
  return ((2 * MOUNT_STAT_MAX + 0.5 * Math.max(0, serenityPoints)) / rules.gaugeRatePerTick[tier]) * TICK_SECONDS
}

/** Points de Mangeoire consommés pendant la phase d'amour (Mangeoire en 2e jauge). */
export function xpOverlapPoints(tier: FuelTier, xpTier: FuelTier, rules: Ruleset): number {
  return (MOUNT_STAT_MAX * rules.gaugeRatePerTick[xpTier]) / rules.gaugeRatePerTick[tier]
}

export interface GaugeCostLine {
  gauge: GaugeId
  /** Points de jauge consommés pour tout le lot. */
  pointsPerBatch: number
  pointCost: GaugePointCost
  /** Coût pour le lot (borne basse si incomplet ; null si inconnu ou borne haute seulement). */
  costPerBatch: number | null
  complete: boolean
}

export interface FertilityCostInput {
  tier: FuelTier
  /** Montures éligibles par lot (1 … 10). */
  batchSize: number
  /**
   * Déplacement de sérénité que subit chaque monture du lot (= points consommés par Baffeur +
   * Caresseur pour tout le lot, car toutes bougent ensemble). Défaut : DEFAULT_SERENITY_POINTS.
   */
  serenityPointsPerMount?: number
  ctx: PriceContext
  rules: Ruleset
  jobLevel?: number
  craftableOnly?: boolean
}

export interface FertilityCost {
  lines: GaugeCostLine[]
  /** Coût du lot (somme connue ; borne basse si incomplet). */
  perBatch: number | null
  perMount: number | null
  complete: boolean
  missing: number[]
  batchSize: number
  serenityPoints: number
  secondsPerBatch: number
}

function lineCost(points: number, pc: GaugePointCost): number | null {
  if (pc.value === null || pc.bound === 'max') return null
  return points * pc.value
}

/**
 * Coût de fécondité : 20 000 points de Foudroyeur, d'Abreuvoir et de Dragofesse par lot, plus la
 * sérénité (moitié Baffeur, moitié Caresseur). La consommation ne dépend pas du nombre de montures
 * (research §2.3) : le coût par monture est divisé par la taille du lot.
 */
export function fertilityCost(input: FertilityCostInput): FertilityCost {
  const batchSize = clamp(Math.floor(input.batchSize || 1), 1, 10)
  const ser = Math.max(0, input.serenityPointsPerMount ?? DEFAULT_SERENITY_POINTS)
  const fopts = { jobLevel: input.jobLevel ?? 1, rules: input.rules, craftableOnly: input.craftableOnly }
  const points: Record<string, number> = {
    foudroyeur: MOUNT_STAT_MAX,
    abreuvoir: MOUNT_STAT_MAX,
    dragofesse: MOUNT_STAT_MAX,
    baffeur: ser / 2,
    caresseur: ser / 2,
  }
  const lines: GaugeCostLine[] = FERTILITY_GAUGES.filter((g) => points[g] > 0).map((g) => {
    const pc = bestFuel(g, input.tier, input.ctx, fopts)
    return { gauge: g, pointsPerBatch: points[g], pointCost: pc, costPerBatch: lineCost(points[g], pc), complete: pc.complete }
  })
  const complete = lines.every((l) => l.complete)
  const known = lines.reduce((s, l) => s + (l.costPerBatch ?? 0), 0)
  const perBatch = complete || known > 0 ? known : null
  return {
    lines,
    perBatch,
    perMount: perBatch === null ? null : perBatch / batchSize,
    complete,
    missing: uniq(lines.flatMap((l) => (l.complete ? [] : l.pointCost.missing))),
    batchSize,
    serenityPoints: ser,
    secondsPerBatch: fertilitySeconds(input.tier, input.rules, ser),
  }
}

export interface LevelingInput {
  tier: FuelTier
  batchSize: number
  /** Capacité Sage : XP ×2 (moitié moins de carburant et de temps). */
  sage?: boolean
  ctx: PriceContext
  rules: Ruleset
  jobLevel?: number
  craftableOnly?: boolean
}

export interface LevelingCost {
  xpPerMount: number
  /** Points de Mangeoire consommés pour le lot. */
  pointsPerBatch: number
  pointCost: GaugePointCost
  costPerBatch: number | null
  costPerMount: number | null
  complete: boolean
  missing: number[]
  /** Durée à palier constant (×½ avec Sage). */
  secondsPerBatch: number
}

/** Coût et durée pour monter un lot de montures du niveau `fromLevel` au niveau `toLevel` (Mangeoire). */
export function levelingCost(fromLevel: number, toLevel: number, input: LevelingInput): LevelingCost {
  const batchSize = clamp(Math.floor(input.batchSize || 1), 1, 10)
  const xp = mountXpBetween(Math.max(1, fromLevel), Math.max(1, toLevel))
  const points = xp / (input.sage ? 2 : 1)
  const pc = bestFuel('mangeoire', input.tier, input.ctx, { jobLevel: input.jobLevel ?? 1, rules: input.rules, craftableOnly: input.craftableOnly })
  const costPerBatch = points === 0 ? 0 : lineCost(points, pc)
  const complete = points === 0 || pc.complete
  return {
    xpPerMount: xp,
    pointsPerBatch: points,
    pointCost: pc,
    costPerBatch,
    costPerMount: costPerBatch === null ? null : costPerBatch / batchSize,
    complete,
    missing: complete ? [] : pc.missing,
    secondsPerBatch: (points / input.rules.gaugeRatePerTick[input.tier]) * TICK_SECONDS,
  }
}

// ---------- Capture et makinas ----------

export type NetKind = NetRecipe['kind']

export const NET_KIND_LABELS: Record<NetKind, string> = {
  universel: 'Filet universel',
  multiplicateur: 'Filet multiplicateur',
  renforce: 'Filet renforcé',
  multiplicateur_renforce: 'Filet multiplicateur renforcé',
}

/** Montures capturées par lancer, par défaut (research §2.6, economy.md §7). */
export const DEFAULT_MOUNTS_PER_CAST: Record<NetKind, { value: number; confidence: string; note: string }> = {
  universel: { value: 1, confidence: 'high', note: '1 cible.' },
  multiplicateur: { value: 2, confidence: 'high', note: 'Capture + doublon (sexe du doublon non garanti).' },
  renforce: { value: 6, confidence: 'low', note: '≈ 6 Volkornes par combat relevés ([S20]) ; groupes de 5 à 8.' },
  multiplicateur_renforce: { value: 12, confidence: 'low', note: 'ESTIMATION : 2 × le filet renforcé.' },
}

export function findNet(kind: NetKind, family: FamilyId): NetRecipe | undefined {
  return NETS.find((n) => n.kind === kind && (kind === 'universel' ? n.family === null : n.family === family))
}

export interface CaptureCost {
  net: NetRecipe | null
  unitPrice: number | null
  perMount: number | null
  complete: boolean
  origin: PriceOrigin
  missing: number[]
  mountsPerCast: number
  /** Niveau d'Éleveur requis pour équiper ce filet. */
  requiredLevel: number
  canEquip: boolean
  confidence: string
  jobXpPerMount: number
  note: string
}

/** Coût de capture par monture : prix du filet / montures par lancer (drops non déduits). */
export function captureCost(
  family: FamilyId,
  netKind: NetKind,
  ctx: PriceContext,
  opts: { mountsPerCast?: number; jobLevel?: number } = {},
): CaptureCost {
  const net = findNet(netKind, family) ?? null
  const def = DEFAULT_MOUNTS_PER_CAST[netKind]
  const per = Math.max(1, opts.mountsPerCast ?? def.value)
  if (!net)
    return {
      net: null,
      unitPrice: null,
      perMount: null,
      complete: false,
      origin: 'manquant',
      missing: [],
      mountsPerCast: per,
      requiredLevel: 0,
      canEquip: false,
      confidence: 'low',
      jobXpPerMount: JOB_XP_PER_CAPTURE,
      note: 'Filet introuvable.',
    }
  const p = resolvePrice(net.id, ctx)
  return {
    net,
    unitPrice: p.price,
    perMount: p.price === null ? null : p.price / per,
    complete: p.complete && p.price !== null,
    origin: p.origin,
    missing: p.complete ? [] : p.missing.length ? p.missing : [net.id],
    mountsPerCast: per,
    requiredLevel: net.level,
    canEquip: (opts.jobLevel ?? 200) >= net.level,
    confidence: opts.mountsPerCast !== undefined ? 'joueur' : def.confidence,
    jobXpPerMount: JOB_XP_PER_CAPTURE,
    note: `${def.note} La valeur des ressources droppées pendant le combat n'est pas déduite.`,
  }
}

export interface MakinaCost {
  makina: MakinaRecipe | null
  price: number | null
  complete: boolean
  origin: PriceOrigin
  missing: number[]
  /** Recette bêta 3.7 utilisée. */
  beta37: boolean
}

/**
 * Coût d'une makina (prix HDV ou coût des ingrédients ; recette bêta en 3.7 quand elle existe).
 * La génération demandée est bornée à 2 … 10.
 */
export function makinaCost(kind: MakinaKind, family: FamilyId, generation: number, ctx: PriceContext, rules?: Ruleset): MakinaCost {
  const gen = clamp(Math.floor(generation), 2, 10)
  const makina = findMakina(kind, family, gen) ?? null
  if (!makina) return { makina: null, price: null, complete: false, origin: 'manquant', missing: [], beta37: false }
  if (rules?.id === '3.7' && makina.beta37Ingredients?.length) {
    const market = marketPrice(makina.id, ctx)
    if (market.origin === 'joueur') return { makina, price: market.price, complete: true, origin: 'joueur', missing: [], beta37: true }
    let total = 0
    const missing: number[] = []
    for (const ing of makina.beta37Ingredients) {
      const p = resolvePrice(ing.id, ctx)
      if (p.price !== null) total += p.price * ing.qty
      if (!p.complete) missing.push(...(p.missing.length ? p.missing : [ing.id]))
    }
    const complete = missing.length === 0
    if (market.price !== null && (!complete || market.price <= total))
      return { makina, price: market.price, complete: true, origin: market.origin, missing: [], beta37: true }
    return { makina, price: complete || total > 0 ? total : null, complete, origin: 'craft', missing: uniq(missing), beta37: true }
  }
  const p = resolvePrice(makina.id, ctx)
  return {
    makina,
    price: p.price !== null && (p.complete || p.price > 0) ? p.price : null,
    complete: p.complete && p.price !== null,
    origin: p.origin,
    missing: p.complete ? [] : p.missing.length ? p.missing : [makina.id],
    beta37: false,
  }
}

// ---------- Économie d'un accouplement ----------

export interface MatingOutcomeValue {
  speciesId: number
  probability: number
  /** Nombre de bébés attendus de cette espèce (probabilité × bébés). */
  expected: number
  unitValue: number | null
  subtotal: number | null
}

export interface MatingEconomics {
  outcomes: MatingOutcomeValue[]
  /** Valeur attendue des bébés (borne basse si incomplet). */
  expectedBabyValue: number
  babyValueComplete: boolean
  missingSpecies: number[]
  expectedGenetons: number
  genetonsValue: number
  makinaCost: number
  makinaComplete: boolean
  /** Bébés + génétons − makina (borne si incomplet). */
  expectedNet: number
  complete: boolean
}

/**
 * Valeur attendue d'un accouplement : Σ P(bébé) × valeur (bébés au niveau 1), génétons × valeur,
 * moins la makina.
 */
export function matingEconomics(
  result: BreedingResult,
  opts: { valueOf: (speciesId: number, level: number) => number | null; makinaCost?: { price: number | null; complete: boolean } | null; genetonValue: number },
): MatingEconomics {
  const outcomes: MatingOutcomeValue[] = result.outcomes.map((o) => {
    const unit = opts.valueOf(o.speciesId, 1)
    const expected = o.probability * result.babies
    return { speciesId: o.speciesId, probability: o.probability, expected, unitValue: unit, subtotal: unit === null ? null : unit * expected }
  })
  const missingSpecies = outcomes.filter((o) => o.unitValue === null && o.probability > 0).map((o) => o.speciesId)
  const expectedBabyValue = outcomes.reduce((s, o) => s + (o.subtotal ?? 0), 0)
  const genetonsValue = result.expectedGenetons * opts.genetonValue
  const mk = opts.makinaCost ?? null
  const makinaCost = mk?.price ?? 0
  const makinaComplete = !mk || mk.complete
  return {
    outcomes,
    expectedBabyValue,
    babyValueComplete: missingSpecies.length === 0,
    missingSpecies,
    expectedGenetons: result.expectedGenetons,
    genetonsValue,
    makinaCost,
    makinaComplete,
    expectedNet: expectedBabyValue + genetonsValue - makinaCost,
    complete: missingSpecies.length === 0 && makinaComplete,
  }
}

// ---------- Rentabilité d'un cycle ----------

/** Arbre supposé d'une espèce : son premier croisement connu (capturée : aucun parent). */
export function assumedParents(speciesId: number): number[] {
  const sp = getSpecies(speciesId)
  if (!sp || sp.generation <= 1 || !sp.crossings.length) return []
  return [...sp.crossings[0]]
}

export type SterileFate = 'meilleur' | 'cloner'

export interface CycleConfig {
  family: FamilyId
  parentA: number
  parentB: number
  /** Espèces des parents de chaque parent ; défaut : assumedParents. */
  treeA?: number[]
  treeB?: number[]
  /** Nombre de couples accouplés. */
  pairs: number
  /** Niveau visé des parents au moment de l'accouplement. */
  parentLevel: number
  /** Niveau de départ des parents (défaut 1). */
  parentStartLevel?: number
  /** Palier entretenu sur les jauges de fécondité. */
  tier: FuelTier
  /** Palier de la Mangeoire (défaut : tier). */
  xpTier?: FuelTier
  /** Montures par enclos (1 … 10). */
  batchSize: number
  /** Enclos utilisés en parallèle (défaut 1). */
  paddocks?: number
  optimakina: boolean
  takeza?: boolean
  /** Compter le coût des filets pour les parents de génération 1 capturables. */
  includeCapture: boolean
  netKind?: NetKind
  mountsPerCast?: number
  saleTax: number
  serenityPointsPerMount?: number
  sterileFate?: SterileFate
  /** Mangeoire en 2e jauge pendant la phase d'amour (défaut true). */
  xpDuringFertility?: boolean
  sage?: boolean
  ctx: PriceContext
  mountPrices: MountPriceContext
  rules: Ruleset
  jobLevel: number
  genetonValue: number
}

export type CostCategory = 'fecondite' | 'xp' | 'makina' | 'capture'

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  fecondite: 'Fécondité (carburants)',
  xp: 'XP des parents (Mangeoire)',
  makina: 'Makinas',
  capture: 'Captures (filets)',
}

export interface MaterialLine {
  key: string
  category: CostCategory
  label: string
  gauge?: GaugeId
  /** Objet à acheter ou fabriquer (null : estimation au point sans objet précis). */
  itemId: number | null
  itemName: string
  /** Quantité (objets entiers, ou points si unit = 'point'). */
  qty: number
  unit: 'objet' | 'point'
  /** Points de jauge couverts (carburants). */
  points?: number
  unitPrice: number | null
  /** Sous-total (borne basse si incomplet ; null si inconnu). */
  subtotal: number | null
  complete: boolean
  estimated: boolean
  origin: string
  confidence?: string
  missing: number[]
  note?: string
  /** Objet dont il faut saisir le prix pour compléter la ligne. */
  toPrice?: { id: number; name: string }
  /** Coût avec un carburant de palier supérieur (borne haute, non comptée dans le total). */
  upperBound?: number | null
}

export interface RevenueLine {
  key: string
  kind: 'bebe' | 'sterile' | 'genetons'
  speciesId?: number
  label: string
  /** Quantité attendue (bébés, stériles ou génétons). */
  qty: number
  probability?: number
  unitValue: number | null
  subtotal: number | null
  complete: boolean
  fate?: FateKind | 'clone' | null
  confidence?: string
  note?: string
}

export interface CategoryTotal {
  value: number
  complete: boolean
}

export interface CycleResult {
  breed: BreedingResult
  mounts: number
  batches: number
  rounds: number
  materials: MaterialLine[]
  costByCategory: Record<CostCategory, CategoryTotal>
  /** Somme des coûts connus (borne basse si incomplet). */
  totalCost: number
  costComplete: boolean
  revenue: RevenueLine[]
  totalRevenue: number
  revenueComplete: boolean
  profit: number
  profitPerPair: number
  complete: boolean
  seconds: { fertility: number; leveling: number; perRound: number; total: number }
  kamasPerHour: number | null
  /** Bénéfice / coût. */
  roi: number | null
  expectedTargetBabies: number
  costPerTargetBaby: number | null
  jobXp: number
  missingItems: number[]
  missingSpecies: number[]
  assumptions: string[]
  warnings: string[]
}

function sumCat(lines: MaterialLine[], cat: CostCategory): CategoryTotal {
  const ls = lines.filter((l) => l.category === cat)
  return { value: ls.reduce((s, l) => s + (l.subtotal ?? 0), 0), complete: ls.every((l) => l.complete) }
}

function fuelLine(key: string, category: CostCategory, gauge: GaugeId, points: number, pc: GaugePointCost): MaterialLine {
  const label = `${GAUGE_LABELS[gauge]} — ${Math.round(points).toLocaleString('fr-FR')} pts`
  if (pc.estimated || !pc.fuel) {
    return {
      key,
      category,
      label,
      gauge,
      itemId: null,
      itemName: `Carburant de ${GAUGE_LABELS[gauge]} (coût au point estimé)`,
      qty: points,
      unit: 'point',
      points,
      unitPrice: pc.value,
      subtotal: pc.value === null ? null : pc.value * points,
      complete: pc.complete,
      estimated: pc.estimated,
      origin: pc.origin,
      confidence: pc.confidence,
      missing: pc.missing,
      note: pc.note,
      toPrice: !pc.complete && pc.toPrice ? { id: pc.toPrice.fuel.id, name: pc.toPrice.fuel.name } : undefined,
    }
  }
  const qty = Math.ceil(points / pc.fuel.durability - 1e-9)
  const upper = pc.bound === 'max'
  const unit = pc.fuel.unitPrice
  const toPrice = pc.complete ? undefined : pc.toPrice ?? pc.fuel
  return {
    toPrice: toPrice ? { id: toPrice.fuel.id, name: toPrice.fuel.name } : undefined,
    upperBound: upper && unit !== null ? unit * qty : undefined,
    key,
    category,
    label,
    gauge,
    itemId: pc.fuel.fuel.id,
    itemName: pc.fuel.fuel.name,
    qty,
    unit: 'objet',
    points,
    unitPrice: unit,
    subtotal: upper || unit === null || (!pc.complete && unit <= 0) ? null : unit * qty,
    complete: pc.complete,
    estimated: false,
    origin: pc.origin,
    confidence: pc.confidence,
    missing: pc.missing,
    note: pc.note,
  }
}

/**
 * Rentabilité d'un cycle de production : coûts matériels (carburants par jauge, makinas, filets),
 * durée, revenus attendus (bébés, stériles, génétons), bénéfice, kamas/heure et ROI.
 */
export function cycleProfit(cfg: CycleConfig): CycleResult {
  const rules = cfg.rules
  const pairs = Math.max(1, Math.floor(cfg.pairs || 1))
  const batchSize = clamp(Math.floor(cfg.batchSize || 10), 1, 10)
  const paddocks = clamp(Math.floor(cfg.paddocks ?? 1), 1, 6)
  const startLevel = clamp(Math.floor(cfg.parentStartLevel ?? 1), 1, 200)
  const parentLevel = clamp(Math.floor(cfg.parentLevel || 1), startLevel, 200)
  const xpTier = cfg.xpTier ?? cfg.tier
  const tax = clamp(cfg.saleTax, 0, 1)
  const warnings: string[] = []
  const assumptions: string[] = []

  const sa = getSpecies(cfg.parentA)
  const sb = getSpecies(cfg.parentB)
  if (!sa || !sb) throw new Error('Espèce de parent inconnue.')
  const treeA = cfg.treeA ?? assumedParents(cfg.parentA)
  const treeB = cfg.treeB ?? assumedParents(cfg.parentB)
  const pa: BreedingParent = { speciesId: cfg.parentA, level: parentLevel, parents: treeA }
  const pb: BreedingParent = { speciesId: cfg.parentB, level: parentLevel, parents: treeB }
  const noMakina = breed(pa, pb, { rules, takeza: cfg.takeza })
  const useOpti = cfg.optimakina && noMakina.targetChance < 1 && noMakina.outcomes.some((o) => !o.isTarget)
  const result = useOpti ? breed(pa, pb, { rules, takeza: cfg.takeza, makina: 'optimakina' }) : noMakina
  if (cfg.optimakina && !useOpti) assumptions.push('Optimakina inutile : la génération cible est déjà certaine (100 %).')

  const mounts = 2 * pairs
  const batches = Math.ceil(mounts / batchSize)
  const rounds = Math.ceil(batches / paddocks)
  const materials: MaterialLine[] = []

  // Fécondité.
  const fert = fertilityCost({ tier: cfg.tier, batchSize, serenityPointsPerMount: cfg.serenityPointsPerMount, ctx: cfg.ctx, rules, jobLevel: cfg.jobLevel })
  for (const l of fert.lines) materials.push(fuelLine(`fert-${l.gauge}`, 'fecondite', l.gauge, l.pointsPerBatch * batches, l.pointCost))

  // XP des parents.
  const lvl = levelingCost(startLevel, parentLevel, { tier: xpTier, batchSize, sage: cfg.sage, ctx: cfg.ctx, rules, jobLevel: cfg.jobLevel })
  if (lvl.pointsPerBatch > 0) materials.push(fuelLine('xp-mangeoire', 'xp', 'mangeoire', lvl.pointsPerBatch * batches, lvl.pointCost))

  // Makinas.
  if (useOpti) {
    const mk = makinaCost('optimakina', cfg.family, result.makinaGenerationRequired, cfg.ctx, rules)
    materials.push({
      key: 'makina',
      category: 'makina',
      label: `Optimakina G${result.makinaGenerationRequired} × ${pairs}`,
      itemId: mk.makina?.id ?? null,
      itemName: mk.makina?.name ?? `Optimakina G${result.makinaGenerationRequired}`,
      qty: pairs,
      unit: 'objet',
      unitPrice: mk.price,
      subtotal: mk.price === null ? null : mk.price * pairs,
      complete: mk.complete,
      estimated: false,
      origin: mk.origin,
      missing: mk.missing,
      note: mk.beta37 ? 'Recette bêta 3.7.' : undefined,
    })
  }

  // Captures (parents G1 capturables).
  const netKind = cfg.netKind ?? 'universel'
  if (cfg.includeCapture) {
    const capturable = [sa, sb].filter((s) => s.generation === 1 && s.capturable)
    if (capturable.length) {
      const cc = captureCost(cfg.family, netKind, cfg.ctx, { mountsPerCast: cfg.mountsPerCast, jobLevel: cfg.jobLevel })
      const toCapture = capturable.length * pairs
      const casts = Math.ceil(toCapture / cc.mountsPerCast)
      materials.push({
        key: 'capture',
        category: 'capture',
        label: `${toCapture} capture(s), ${cc.mountsPerCast} monture(s) par lancer`,
        itemId: cc.net?.id ?? null,
        itemName: cc.net?.name ?? NET_KIND_LABELS[netKind],
        qty: casts,
        unit: 'objet',
        unitPrice: cc.unitPrice,
        subtotal: cc.unitPrice === null ? null : cc.unitPrice * casts,
        complete: cc.complete,
        estimated: cc.confidence === 'low',
        origin: cc.origin,
        confidence: cc.confidence,
        missing: cc.missing,
        note: cc.note,
      })
      if (!cc.canEquip) warnings.push(`${cc.net?.name ?? 'Ce filet'} demande le niveau ${cc.requiredLevel} d'Éleveur pour être équipé.`)
    }
    if ([sa, sb].some((s) => s.generation > 1)) assumptions.push('Parents de génération ≥ 2 supposés déjà possédés : leur valeur n’est pas comptée comme coût.')
  } else assumptions.push('Parents supposés déjà possédés : ni capture ni valeur des parents comptées comme coût.')

  // Revenus.
  const vopts = { ctx: cfg.ctx, mountPrices: cfg.mountPrices, saleTax: tax }
  const cache = new Map<string, MountValuation>()
  const val = (id: number, level: number, state: MountState) => {
    const k = `${id}|${level}|${state}`
    let v = cache.get(k)
    if (!v) {
      v = mountValuation(id, level, { ...vopts, state })
      cache.set(k, v)
    }
    return v
  }
  const revenue: RevenueLine[] = []
  for (const o of result.outcomes) {
    const v = val(o.speciesId, 1, 'fertile')
    const qty = pairs * result.babies * o.probability
    revenue.push({
      key: `bebe-${o.speciesId}`,
      kind: 'bebe',
      speciesId: o.speciesId,
      label: getSpecies(o.speciesId)?.name ?? `#${o.speciesId}`,
      qty,
      probability: o.probability,
      unitValue: v.best,
      subtotal: v.best === null ? null : v.best * qty,
      complete: v.best !== null && v.complete,
      fate: v.bestKind,
      confidence: v.confidence,
      note: o.isTarget ? 'Génération cible' : undefined,
    })
  }
  const fate = cfg.sterileFate ?? 'meilleur'
  for (const s of sa.id === sb.id ? [sa] : [sa, sb]) {
    const qty = sa.id === sb.id ? 2 * pairs : pairs
    if (fate === 'cloner') {
      const sale = mountSalePrice(s.id, 1, cfg.mountPrices, { state: 'fertile' })
      const unit = sale.price === null ? null : (0.5 * sale.price * (sale.isFloor ? 1 : 1 - tax))
      revenue.push({
        key: `sterile-${s.id}`,
        kind: 'sterile',
        speciesId: s.id,
        label: `${s.name} stérile (gardée pour cloner)`,
        qty,
        unitValue: unit,
        subtotal: unit === null ? null : unit * qty,
        complete: unit !== null,
        fate: 'clone',
        confidence: 'low',
        note: '2 stériles de même génération → 1 clone fertile : ½ valeur d’une monture fertile niv. 1 (niveau conservé inconnu).',
      })
    } else {
      const v = val(s.id, parentLevel, 'sterile')
      revenue.push({
        key: `sterile-${s.id}`,
        kind: 'sterile',
        speciesId: s.id,
        label: `${s.name} stérile niv. ${parentLevel}`,
        qty,
        unitValue: v.best,
        subtotal: v.best === null ? null : v.best * qty,
        complete: v.best !== null && v.complete,
        fate: v.bestKind,
        confidence: v.confidence,
      })
    }
  }
  const expectedGenetons = pairs * result.expectedGenetons
  if (expectedGenetons > 0)
    revenue.push({
      key: 'genetons',
      kind: 'genetons',
      label: 'Génétons',
      qty: expectedGenetons,
      unitValue: cfg.genetonValue,
      subtotal: expectedGenetons * cfg.genetonValue,
      complete: true,
      confidence: 'medium',
      note: 'Liés au compte : valeur via les parchemins d’Eugène Éton revendus.',
    })

  // Totaux.
  const costByCategory: Record<CostCategory, CategoryTotal> = {
    fecondite: sumCat(materials, 'fecondite'),
    xp: sumCat(materials, 'xp'),
    makina: sumCat(materials, 'makina'),
    capture: sumCat(materials, 'capture'),
  }
  const totalCost = materials.reduce((s, l) => s + (l.subtotal ?? 0), 0)
  const costComplete = materials.every((l) => l.complete)
  const totalRevenue = revenue.reduce((s, l) => s + (l.subtotal ?? 0), 0)
  const revenueComplete = revenue.every((l) => l.complete)
  const profit = totalRevenue - totalCost
  const complete = costComplete && revenueComplete

  // Durées.
  const fertSec = fert.secondsPerBatch
  const overlap = cfg.xpDuringFertility === false ? 0 : xpOverlapPoints(cfg.tier, xpTier, rules)
  const extraXpPoints = Math.max(0, lvl.pointsPerBatch - overlap)
  const levelSec = (extraXpPoints / rules.gaugeRatePerTick[xpTier]) * TICK_SECONDS
  const perRound = fertSec + levelSec
  const total = perRound * rounds
  const hours = total / 3600

  const targetBabies = pairs * result.babies * result.targetChance
  const missingItems = uniq(materials.flatMap((l) => (l.complete ? [] : l.missing)))
  const missingSpecies = uniq(revenue.filter((l) => !l.complete && l.speciesId !== undefined && l.unitValue === null).map((l) => l.speciesId as number))

  // Hypothèses.
  assumptions.unshift(
    `Règles du jeu : ${rules.label}.`,
    `${mounts} montures en ${batches} lot(s) de ${batchSize} au plus, ${paddocks} enclos en parallèle (${rounds} tour(s)). La consommation d'une jauge ne dépend pas du nombre de montures : un lot incomplet coûte autant qu'un lot plein.`,
    `Fécondité : 20 000 points de Foudroyeur, d'Abreuvoir et de Dragofesse par lot, palier ${cfg.tier} entretenu, carburant le moins cher au point parmi les paliers ≥ ${cfg.tier}.`,
    `Sérénité : ${Math.round(fert.serenityPoints).toLocaleString('fr-FR')} points par lot, moitié Baffeur, moitié Caresseur${cfg.serenityPointsPerMount === undefined ? ' (ESTIMATION : sérénité de départ uniforme sur [−5 000 ; 5 000], moyenne du planificateur)' : ''}.`,
    `XP : parents du niveau ${startLevel} au niveau ${parentLevel} (${lvl.xpPerMount.toLocaleString('fr-FR')} XP chacun) avec la Mangeoire au palier ${xpTier}${cfg.sage ? ', capacité Sage (×2)' : ''}${overlap > 0 ? ` ; ≈ ${Math.round(overlap).toLocaleString('fr-FR')} points gagnés pendant la phase d'amour (Mangeoire en 2e jauge)` : ''}.`,
    `Durée par tour ≈ (40 000 + ½ sérénité) / débit du palier, plus l'XP restante ; captures, déplacements et ventes non comptés.`,
    cfg.treeA || cfg.treeB
      ? 'Arbres des parents saisis.'
      : 'Arbres des parents supposés « propres » (issus de leur premier croisement connu ; G1 capturées sans parents).',
    `Bébés valorisés au niveau 1 au meilleur de vente / extraction / brisage, nets de la taxe d'HDV de ${Math.round(tax * 1000) / 10} %.`,
    fate === 'cloner'
      ? 'Stériles gardées pour le clonage : ½ valeur d’une monture fertile de la même espèce par stérile (ESTIMATION).'
      : `Stériles valorisées au niveau ${parentLevel} au meilleur de vente / extraction / brisage, nettes de taxe.`,
    `Génétons valorisés à ${Math.round(cfg.genetonValue).toLocaleString('fr-FR')} K pièce.`,
    'Sexe des bébés et des captures supposé 50/50 ; capacités (Reproducteur, Sage…) non valorisées.',
  )
  if (useOpti) assumptions.push(`Une Optimakina G${result.makinaGenerationRequired} par accouplement (+${Math.round(rules.optimakinaBonus * 100)} points de génération cible).`)
  if (cfg.takeza) assumptions.push('Accouplements le jour Takeza (+20 % de génération cible).')
  if (!costComplete) warnings.push('Coût incomplet : des prix de carburants, makinas ou filets manquent (voir la page Prix).')
  if (!revenueComplete) warnings.push('Revenu incomplet : des prix de montures ou de ressources manquent.')
  for (const w of result.warnings) warnings.push(w)
  if (rules.id === '3.7') warnings.push('Règles 3.7 bêta : valeurs susceptibles de changer.')

  return {
    breed: result,
    mounts,
    batches,
    rounds,
    materials,
    costByCategory,
    totalCost,
    costComplete,
    revenue,
    totalRevenue,
    revenueComplete,
    profit,
    profitPerPair: profit / pairs,
    complete,
    seconds: { fertility: fertSec, leveling: levelSec, perRound, total },
    kamasPerHour: hours > 0 ? profit / hours : null,
    roi: totalCost > 0 ? profit / totalCost : null,
    expectedTargetBabies: targetBabies,
    costPerTargetBaby: targetBabies > 0 ? totalCost / targetBabies : null,
    jobXp: pairs * result.jobXp,
    missingItems,
    missingSpecies,
    assumptions,
    warnings,
  }
}

// ---------- Classement des croisements ----------

export interface RankingOptions {
  tier: FuelTier
  xpTier?: FuelTier
  batchSize: number
  parentLevel: number
  parentStartLevel?: number
  optimakina: boolean
  takeza?: boolean
  saleTax: number
  serenityPointsPerMount?: number
  /** Compter la valeur résiduelle des deux parents stériles (défaut true). */
  includeSteriles?: boolean
  ctx: PriceContext
  mountPrices: MountPriceContext
  rules: Ruleset
  jobLevel: number
  genetonValue: number
}

export interface CrossingRank {
  key: string
  child: number
  parentA: number
  parentB: number
  targetGeneration: number
  targetChance: number
  /** Valeur attendue des bébés (borne basse si incomplet). */
  expectedBabyValue: number
  babyComplete: boolean
  expectedGenetons: number
  genetonsValue: number
  sterileValue: number
  sterileComplete: boolean
  /** Fécondité des 2 parents. */
  fertilityCost: number | null
  /** XP des 2 parents. */
  levelingCost: number | null
  makinaCost: number | null
  usesOptimakina: boolean
  costComplete: boolean
  /** Marge attendue par accouplement (valeurs connues). */
  margin: number
  complete: boolean
  jobXp: number
  missingSpecies: number[]
  missingItems: number[]
}

/**
 * Pour chaque croisement de la famille : marge attendue par accouplement =
 * bébés + génétons (+ stériles) − fécondité − XP − makina. Trié par marge décroissante.
 */
export function crossingRanking(family: FamilyId, opts: RankingOptions): CrossingRank[] {
  const rules = opts.rules
  const batchSize = clamp(Math.floor(opts.batchSize || 10), 1, 10)
  const startLevel = clamp(Math.floor(opts.parentStartLevel ?? 1), 1, 200)
  const parentLevel = clamp(Math.floor(opts.parentLevel || 1), startLevel, 200)
  const includeSteriles = opts.includeSteriles ?? true
  const fert = fertilityCost({ tier: opts.tier, batchSize, serenityPointsPerMount: opts.serenityPointsPerMount, ctx: opts.ctx, rules, jobLevel: opts.jobLevel })
  const lvl = levelingCost(startLevel, parentLevel, { tier: opts.xpTier ?? opts.tier, batchSize, ctx: opts.ctx, rules, jobLevel: opts.jobLevel })
  const fertPair = fert.perMount === null ? null : 2 * fert.perMount
  const lvlPair = lvl.costPerMount === null ? null : 2 * lvl.costPerMount
  const vopts = { ctx: opts.ctx, mountPrices: opts.mountPrices, saleTax: opts.saleTax }
  const cache = new Map<string, MountValuation>()
  const val = (id: number, level: number, state: MountState) => {
    const k = `${id}|${level}|${state}`
    let v = cache.get(k)
    if (!v) {
      v = mountValuation(id, level, { ...vopts, state })
      cache.set(k, v)
    }
    return v
  }
  const makinaCache = new Map<number, MakinaCost>()
  const out: CrossingRank[] = []
  for (const child of speciesOfFamily(family, { breedableOnly: true })) {
    for (const [a, b] of child.crossings) {
      const pa: BreedingParent = { speciesId: a, level: parentLevel, parents: assumedParents(a) }
      const pb: BreedingParent = { speciesId: b, level: parentLevel, parents: assumedParents(b) }
      let r: BreedingResult
      try {
        r = breed(pa, pb, { rules, takeza: opts.takeza })
      } catch {
        continue
      }
      const useOpti = opts.optimakina && r.targetChance < 1 && r.outcomes.some((o) => !o.isTarget)
      if (useOpti) r = breed(pa, pb, { rules, takeza: opts.takeza, makina: 'optimakina' })
      let mk: MakinaCost | null = null
      if (useOpti) {
        mk = makinaCache.get(r.makinaGenerationRequired) ?? makinaCost('optimakina', family, r.makinaGenerationRequired, opts.ctx, rules)
        makinaCache.set(r.makinaGenerationRequired, mk)
      }
      const eco = matingEconomics(r, {
        valueOf: (id, level) => {
          const v = val(id, level, 'fertile')
          return v.best
        },
        makinaCost: mk,
        genetonValue: opts.genetonValue,
      })
      const babyComplete = eco.babyValueComplete && r.outcomes.every((o) => val(o.speciesId, 1, 'fertile').complete)
      const sterA = val(a, parentLevel, 'sterile')
      const sterB = val(b, parentLevel, 'sterile')
      const sterileValue = (sterA.best ?? 0) + (sterB.best ?? 0)
      const sterileComplete = sterA.best !== null && sterB.best !== null && sterA.complete && sterB.complete
      const costComplete = fert.complete && lvl.complete && (!mk || mk.complete)
      const margin =
        eco.expectedBabyValue + eco.genetonsValue + (includeSteriles ? sterileValue : 0) - (fertPair ?? 0) - (lvlPair ?? 0) - (mk?.price ?? 0)
      out.push({
        key: `${a}-${b}`,
        child: child.id,
        parentA: a,
        parentB: b,
        targetGeneration: r.targetGeneration,
        targetChance: r.targetChance,
        expectedBabyValue: eco.expectedBabyValue,
        babyComplete,
        expectedGenetons: eco.expectedGenetons,
        genetonsValue: eco.genetonsValue,
        sterileValue,
        sterileComplete,
        fertilityCost: fertPair,
        levelingCost: lvlPair,
        makinaCost: mk ? mk.price : null,
        usesOptimakina: useOpti,
        costComplete,
        margin,
        complete: costComplete && babyComplete && (!includeSteriles || sterileComplete),
        jobXp: r.jobXp,
        missingSpecies: eco.missingSpecies,
        missingItems: uniq([...(fert.complete ? [] : fert.missing), ...(lvl.complete ? [] : lvl.missing), ...(mk && !mk.complete ? mk.missing : [])]),
      })
    }
  }
  return out.sort((x, y) => y.margin - x.margin || x.child - y.child)
}

// ---------- Saisie des prix : recherche, collage en masse, import/export ----------

let nameIndex: { byName: Map<string, number>; ids: Set<number> } | null = null

/** Index nom normalisé → id de tous les objets connus (ingrédients, recettes, objets de prix). */
function getNameIndex(): { byName: Map<string, number>; ids: Set<number> } {
  if (nameIndex) return nameIndex
  const byName = new Map<string, number>()
  const ids = new Set<number>()
  const add = (id: number | null, name: string) => {
    if (id === null) return
    ids.add(id)
    const k = normalizeName(name)
    if (!byName.has(k)) byName.set(k, id)
  }
  for (const i of INGREDIENTS) add(i.id, i.name)
  for (const r of [...FUELS, ...MAKINAS, ...NETS]) add(r.id, r.name)
  for (const p of PRICES_DEFAULT.items) add(p.id, p.name)
  nameIndex = { byName, ids }
  return nameIndex
}

/** Id d'un objet à partir de son nom exact (casse, accents et apostrophes ignorés). */
export function findItemIdByName(name: string): number | null {
  return getNameIndex().byName.get(normalizeName(name)) ?? null
}

/** Objet connu de l'application (ingrédient, carburant, makina, filet, ressource à prix) ? */
export function isKnownItem(id: number): boolean {
  return getNameIndex().ids.has(id)
}

/**
 * Lit un montant : « 12 000 », « 12.000 », « 12k » (mille), « 1,5 M », « 2 Md », « 950 K » ou
 * « 950 kamas » (symbole des kamas, après une espace). null si illisible.
 */
export function parseKamas(input: string): number | null {
  let s = input.trim().replace(/\s*kamas?$/i, '')
  if (/\sK$/.test(s)) s = s.slice(0, -1)
  s = s.replace(/[\s  ]/g, '').toLowerCase()
  const m = /^(\d+(?:[.,]\d+)*)(md|m|k)?$/.exec(s)
  if (!m) return null
  let num = m[1]
  if (/^\d{1,3}([.,]\d{3})+$/.test(num) && !m[2]) num = num.replace(/[.,]/g, '')
  else if ((num.match(/[.,]/g) ?? []).length > 1) return null
  const n = Number(num.replace(',', '.'))
  if (!Number.isFinite(n)) return null
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'md' ? 1e9 : 1
  return Math.round(n * mult)
}

function resolveItemKey(key: string): number | null {
  const k = key.trim()
  if (/^\d+$/.test(k)) return isKnownItem(Number(k)) ? Number(k) : null
  return findItemIdByName(k)
}

export interface BulkPriceEntry {
  line: number
  raw: string
  id: number
  name: string
  price: number
}

export interface BulkPriceError {
  line: number
  raw: string
  reason: string
}

/**
 * Collage en masse : une ligne par objet, « Nom;Prix » ou « id;prix » (séparateur ; tabulation
 * ou =). Les lignes vides et les commentaires (#) sont ignorés.
 */
export function parseBulkPrices(text: string): { entries: BulkPriceEntry[]; errors: BulkPriceError[] } {
  const entries: BulkPriceEntry[] = []
  const errors: BulkPriceError[] = []
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const raw = rawLine.trim()
    if (!raw || raw.startsWith('#')) return
    const line = i + 1
    const m = /^(.*?)\s*[;\t=]\s*([^;\t=]+?)\s*;?$/.exec(raw)
    if (m) {
      const price = parseKamas(m[2])
      if (price === null) {
        errors.push({ line, raw, reason: `Prix illisible : « ${m[2].trim()} ».` })
        return
      }
      const id = resolveItemKey(m[1])
      if (id === null) {
        errors.push({ line, raw, reason: `Objet inconnu : « ${m[1].trim()} ».` })
        return
      }
      entries.push({ line, raw, id, name: itemName(id), price })
      return
    }
    // Sans séparateur : « Nom 1 200 » — on cherche le plus long nom connu suivi d'un montant lisible.
    const tokens = raw.split(/\s+/)
    for (let k = tokens.length - 1; k >= 1; k--) {
      const id = resolveItemKey(tokens.slice(0, k).join(' '))
      const price = parseKamas(tokens.slice(k).join(' '))
      if (id !== null && price !== null) {
        entries.push({ line, raw, id, name: itemName(id), price })
        return
      }
    }
    errors.push({ line, raw, reason: 'Objet ou prix non reconnu. Format attendu : « Nom;Prix » ou « id;prix ».' })
  })
  return { entries, errors }
}

export interface PriceSnapshot {
  items: Record<string, number>
  mounts: Record<string, number>
  generations: Record<string, number>
  genetonValue: number | null
}

export interface PriceExport extends PriceSnapshot {
  format: 'elevagesimu-prix'
  version: 1
  server: string
  exportedAt: string
}

export function buildPriceExport(snapshot: PriceSnapshot, server: string, now: Date = new Date()): PriceExport {
  return {
    format: 'elevagesimu-prix',
    version: 1,
    server,
    exportedAt: now.toISOString(),
    items: { ...snapshot.items },
    mounts: { ...snapshot.mounts },
    generations: { ...snapshot.generations },
    genetonValue: snapshot.genetonValue,
  }
}

function cleanRecord(v: unknown): Record<string, number> | null {
  if (v === undefined) return {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: Record<string, number> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) return null
    out[k] = x
  }
  return out
}

/** Valide un export de prix (ou un état brut du store). */
export function parsePriceExport(raw: unknown): { ok: true; snapshot: PriceSnapshot; server: string | null } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Fichier invalide : un objet JSON est attendu.' }
  const o = raw as Record<string, unknown>
  const src = o.state && typeof o.state === 'object' ? (o.state as Record<string, unknown>) : o
  const items = cleanRecord(src.items)
  const mounts = cleanRecord(src.mounts)
  const generations = cleanRecord(src.generations)
  if (!items || !mounts || !generations) return { ok: false, error: 'Prix invalides : chaque prix doit être un nombre positif.' }
  const g = src.genetonValue
  if (g !== undefined && g !== null && (typeof g !== 'number' || !Number.isFinite(g) || g < 0))
    return { ok: false, error: 'Valeur de généton invalide.' }
  if (!Object.keys(items).length && !Object.keys(mounts).length && !Object.keys(generations).length && (g === undefined || g === null))
    return { ok: false, error: 'Aucun prix trouvé dans ce fichier.' }
  return {
    ok: true,
    snapshot: { items, mounts, generations, genetonValue: typeof g === 'number' ? g : null },
    server: typeof o.server === 'string' ? o.server : null,
  }
}

// ---------- Couverture des prix ----------

export interface CoverageStat {
  key: 'carburants' | 'makinas' | 'filets' | 'ingredients' | 'extraction'
  label: string
  priced: number
  total: number
}

/** Combien d'objets utilisés par l'application ont un prix complet (saisi, défaut ou craft). */
export function priceCoverage(ctx: PriceContext): CoverageStat[] {
  const count = (ids: number[]) => ids.filter((id) => {
    const p = resolvePrice(id, ctx)
    return p.complete && p.price !== null
  }).length
  const ext = Object.values(FAMILIES).map((f) => f.extractionItemId)
  return [
    { key: 'carburants', label: 'Carburants', priced: count(FUELS.map((f) => f.id)), total: FUELS.length },
    { key: 'makinas', label: 'Makinas', priced: count(MAKINAS.map((m) => m.id)), total: MAKINAS.length },
    { key: 'filets', label: 'Filets', priced: count(NETS.map((n) => n.id)), total: NETS.length },
    { key: 'ingredients', label: 'Ingrédients', priced: count(INGREDIENTS.map((i) => i.id)), total: INGREDIENTS.length },
    { key: 'extraction', label: "Ressources d'extraction", priced: count(ext), total: ext.length },
  ]
}
