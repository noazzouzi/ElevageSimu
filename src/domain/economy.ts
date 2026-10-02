// Économie de l'élevage : valeur des montures (vente, extraction, brisage), génétons, coûts de
// fécondité, d'XP, de capture et de makinas, rentabilité d'un cycle et classement des croisements.
//
// Sources : research/README.md §2.9, research/economy.md §3.3, §5, §6.3, §8, §9.2,
// research/data/prices-default.json (valuation, mounts, genetons), strategy.json → formulas.
// Toute valeur inconnue reste « incomplète » (jamais comptée comme 0) ; les estimations sont signalées.
//
// Principes de valorisation :
// - un prix de vente ne vient que de VOS prix ou d'un relevé par défaut fiable (observé, confiance ≥
//   moyenne, récent) ; un plancher calculé, un relevé ancien ou peu fiable n'est qu'une référence
//   affichée (« à saisir »), jamais un prix de décision ;
// - les prix sont interpolés entre les niveaux 1, 100 et 200 (jamais appliqués sous leur niveau) ;
// - un accouplement est valorisé sur ce qu'il AJOUTE : les parents engagés sont un coût (capture ou
//   valeur actuelle, coût d'opportunité) et leurs stériles un revenu ;
// - un bénéfice dont des coûts ou revenus manquent est un intervalle (borne basse / haute), jamais un
//   montant signé présenté comme certain.
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
import { GAUGE_IDS, GAUGE_LABELS, JOB_XP_PER_CAPTURE, MOUNT_STAT_MAX, PADDOCK_UNLOCK_LEVELS, TICK_SECONDS } from './constants'
import { bestFuel, type BestFuelOpts, type GaugePointCost } from './fuel'
import { breed, type BreedingParent, type BreedingResult } from './genetics'
import {
  DEFAULT_MAX_MARKET_SHARE,
  MOUNT_MARKET_NOTE,
  frenchDay,
  genetonValueFromMarket,
  marketConfidence,
  marketDepth,
  marketItemName,
  snapshotPrice,
  type ConcretePriceStat,
  type GenetonMarketValue,
  type MarketSource,
} from './market'
import { refillAdvice, SOCLE_MIN_SHARE } from './paddockAssign'
import { canCraftRecipe, marketPrice, marketQuote, resolvePrice, type MarketPriceInfo, type PriceContext, type PriceOrigin } from './pricing'
import type { Ruleset } from './rules'
import type { FamilyId, FuelTier, GaugeId, MakinaKind, Species } from './types'
import { mountXpBetween } from './xp'

// ---------- Utilitaires ----------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const uniq = <T>(ids: T[]): T[] => [...new Set(ids)]
const fmtK = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} K`
const fmtN = (n: number) => Math.round(n).toLocaleString('fr-FR')
/** Petite quantité par jour : une décimale sous 10 (« 0,3 »). */
const fmtD = (n: number) => (Math.abs(n) < 10 ? (Math.round(n * 10) / 10).toLocaleString('fr-FR') : fmtN(n))
const pctN = (x: number) => `${Math.round(x * 1000) / 10}`.replace('.', ',') + ' %'

/** Normalise un libellé pour comparer des noms (minuscules, sans accents ni apostrophes typographiques). */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'Oe')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'Ae')
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Intervalle d'un montant : `low`/`high` null = borne inconnue (non bornée de ce côté). */
export interface Range {
  low: number | null
  high: number | null
}

/** Niveau d'Éleveur porté par le contexte de prix (recette hors de portée → prix HDV d'abord). */
function withJobLevel(ctx: PriceContext, jobLevel: number | undefined): PriceContext {
  return jobLevel === undefined || ctx.jobLevel !== undefined ? ctx : { ...ctx, jobLevel }
}

/** Nombre d'enclos débloqués à ce niveau d'Éleveur (1 … 6). */
export function unlockedPaddockCount(jobLevel: number): number {
  return Math.max(1, PADDOCK_UNLOCK_LEVELS.filter((p) => p.level <= jobLevel).length)
}

// ---------- Prix de vente d'une monture ----------

/** Tranche de niveau des prix de montures : niveaux d'ancrage 1, 100 et 200. */
export type MountBand = '1' | '100' | '200'
export const MOUNT_BANDS: MountBand[] = ['1', '100', '200']
export const MOUNT_BAND_LEVEL: Record<MountBand, number> = { '1': 1, '100': 100, '200': 200 }

/** Tranche la plus proche d'un niveau (affichage) ; les prix sont interpolés entre les ancrages. */
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
  /**
   * Marché importé du serveur (export HDV, `usePriceContext().market`) : prix de l'objet-monture,
   * « HDV mixte » (niveaux, états et montures séniles mélangés). Facultatif : absent = ancien
   * comportement. Utilisé par `mountSalePrice` entre vos prix et les défauts de la recherche ; les
   * décisions (`mountValuation`) ne s'en servent que comme plafond de vente (voir `mountValuation`).
   */
  market?: MarketSource | null
}

export type MountState = 'fertile' | 'feconde' | 'sterile'
export type MountPriceOrigin = 'joueur-espece' | 'joueur-generation' | 'marche' | 'defaut-espece' | 'defaut-generation' | 'manquant'

export const MOUNT_PRICE_ORIGIN_LABELS: Record<MountPriceOrigin, string> = {
  'joueur-espece': 'votre prix (couleur)',
  'joueur-generation': 'votre prix (génération)',
  marche: 'HDV du serveur (mixte)',
  'defaut-espece': 'défaut (couleur)',
  'defaut-generation': 'défaut (génération)',
  manquant: 'aucun prix',
}

/** Badge d'un prix d'objet-monture issu de l'export HDV (SPEC-v2 §1, « piège des montures »). */
export const MOUNT_MARKET_BADGE = 'HDV mixte : niveau/sénilité/état non distingués'

/**
 * Prix de l'objet-monture d'une espèce à l'HDV du serveur (export importé). Indication de marché :
 * niveaux, fertile/stérile et montures séniles d'avant la 3.5 sont mélangés (`mixed`).
 */
export interface MountMarketQuote {
  itemId: number
  /** Prix brut (statistique du serveur). */
  price: number
  /** Statistique réellement utilisée. */
  stat: ConcretePriceStat
  exportDate: string
  serverName?: string
  sold24: number
  sold7: number
  sold30: number
  /** Ventes moyennes par jour (30 j). */
  perDayAvg: number
  kamasPerDay: number
  confidence: string
  mixed: true
  /** « HDV mixte : niveau/sénilité/état non distingués ». */
  badge: string
  note: string
}

/** Prix de marché de l'objet-monture (null : pas de marché, objet absent ou sans vente). */
export function mountMarketQuote(speciesId: number, market: MarketSource | null | undefined): MountMarketQuote | null {
  const itemId = getSpecies(speciesId)?.itemId
  if (!itemId || !market) return null
  const q = marketQuote(itemId, market)
  if (!q) return null
  return {
    itemId,
    price: q.price,
    stat: q.info.stat,
    exportDate: q.info.exportDate,
    serverName: q.info.serverName,
    sold24: q.info.sold24,
    sold7: q.info.sold7,
    sold30: q.info.sold30,
    perDayAvg: q.info.perDayAvg,
    kamasPerDay: q.info.kamasPerDay,
    confidence: q.confidence,
    mixed: true,
    badge: MOUNT_MARKET_BADGE,
    note: MOUNT_MARKET_NOTE,
  }
}

/**
 * Génération à partir de laquelle un prix d'objet-monture très bas fait soupçonner des montures
 * séniles (extraction = 1 ressource) dans les ventes : prix < `SENILE_PRICE_RATIO` × valeur
 * d'extraction (G8–G10 « bradées » 24–40 k sur Tylezia, SPEC-v2 §1).
 */
export const SENILE_MIN_GENERATION = 5
export const SENILE_PRICE_RATIO = 0.5

/** Le prix de marché d'un objet-monture fait-il soupçonner des montures séniles ? */
export function possibleSenile(generation: number, marketPriceGross: number | null, extractionGross: number | null): boolean {
  return generation >= SENILE_MIN_GENERATION && marketPriceGross !== null && extractionGross !== null && extractionGross > 0 && marketPriceGross < SENILE_PRICE_RATIO * extractionGross
}

/** Pourquoi un prix par défaut de la recherche n'entre pas dans les décisions automatiques. */
export type DefaultPriceIssue = 'plancher' | 'estimation' | 'peu-fiable' | 'ancien' | 'a-verifier'

export const DEFAULT_PRICE_ISSUE_LABELS: Record<DefaultPriceIssue, string> = {
  plancher: 'plancher calculé, pas un cours',
  estimation: 'estimation sans relevé',
  'peu-fiable': 'relevé peu fiable',
  ancien: 'relevé ancien',
  'a-verifier': 'relevé à vérifier',
}

/**
 * Ancienneté (jours avant le relevé le plus récent de la recherche) au-delà de laquelle un relevé de
 * prix de monture n'entre plus seul dans les décisions (marché de lancement de la 3.5, etc.).
 */
export const MOUNT_PRICE_STALE_DAYS = 120

function parseIsoDay(s: string | null | undefined): number | null {
  const m = /(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(s ?? '')
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 15)
}

/** Date du relevé le plus récent de la recherche : référence (déterministe) de l'ancienneté. */
const DATASET_DATE_MS: number = (() => {
  const dates = [...(PRICES_DEFAULT.asOf.match(/\d{4}-\d{2}-\d{2}/g) ?? []), ...PRICES_DEFAULT.mounts.map((r) => r.date ?? '')]
    .map(parseIsoDay)
    .filter((d): d is number => d !== null)
  return dates.length ? Math.max(...dates) : 0
})()

/**
 * Une ligne de prix par défaut est-elle utilisable pour décider (vendre, accoupler, totaux) ?
 * null = oui (relevé observé ou dérivé, confiance ≥ moyenne, récent) ; sinon la raison. Une ligne
 * marquée `excludeFromDefaults` (pipeline de données) ou « Ne pas utiliser comme défaut » est exclue.
 */
export function defaultPriceIssue(row: DefaultMountPrice): DefaultPriceIssue | null {
  if ((row as DefaultMountPrice & { excludeFromDefaults?: boolean }).excludeFromDefaults || /ne pas utiliser comme defaut/.test(normalizeName(row.notes ?? '')))
    return 'a-verifier'
  if (row.priceType === 'floor-estimate') return 'plancher'
  if (row.priceType !== 'observed' && row.priceType !== 'derived') return 'estimation'
  if (row.confidence === 'low') return 'peu-fiable'
  const d = parseIsoDay(row.date)
  if (d !== null && DATASET_DATE_MS - d > MOUNT_PRICE_STALE_DAYS * 86_400_000) return 'ancien'
  return null
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

/** Lignes applicables à une tranche et un état, de la plus précise à la moins précise. */
function rankRows(rows: DefaultMountPrice[], band: MountBand, state: MountState): DefaultMountPrice[] {
  return rows
    .filter((r) => r.price !== null && (r.level === null || mountBand(r.level) === band) && stateAccepts(r, state))
    .sort(
      (a, b) =>
        Number(state === 'feconde' && rowStateKind(b.state) === 'feconde') - Number(state === 'feconde' && rowStateKind(a.state) === 'feconde') ||
        Number(a.level === null) - Number(b.level === null) ||
        (PRICE_TYPE_RANK[a.priceType] ?? 9) - (PRICE_TYPE_RANK[b.priceType] ?? 9),
    )
}

function pickRow(rows: DefaultMountPrice[], band: MountBand, state: MountState): DefaultMountPrice | undefined {
  return rankRows(rows, band, state)[0]
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
 * défaut. Comme référence de vente, on n'en garde que la revente de base : l'extraction et le
 * brisage sont calculés à part avec VOS prix (sinon double compte à des prix périmés).
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

/** Prix par défaut d'une famille/génération/tranche (ligne générique de la recherche, hors noms ; affichage). */
export function defaultGenerationPrice(family: FamilyId, generation: number, band: MountBand, state: MountState = 'fertile'): DefaultMountPrice | undefined {
  const row = pickRow(
    PRICES_DEFAULT.mounts.filter((r) => r.name === null && r.family === family && r.generation === generation),
    band,
    state,
  )
  return row && adjustFloor(row)
}

/** Prix par défaut propre à une couleur (relevé nominatif), pour une tranche (affichage). */
export function defaultSpeciesPrice(speciesId: number, band: MountBand): DefaultMountPrice | undefined {
  const sp = getSpecies(speciesId)
  if (!sp) return undefined
  return pickRow(
    PRICES_DEFAULT.mounts.filter((r) => r.name !== null && normalizeName(r.name) === normalizeName(sp.name)),
    band,
    'feconde',
  )
}

/** Prix connu à un niveau d'ancrage (1, 100 ou 200). */
export interface MountPriceAnchor {
  level: number
  /** Prix brut (avant taxe). */
  price: number
  origin: MountPriceOrigin
  confidence?: string
  priceType?: PriceType
  row?: DefaultMountPrice
}

/** Prix affiché pour information, jamais utilisé pour décider (plancher, relevé ancien…). */
export interface MountPriceReference {
  /** Montant brut, ou déjà net de taxe si `net` (planchers de la recherche). */
  price: number
  net: boolean
  level: number
  /** `marche` : prix de l'objet-monture à l'HDV du serveur, plafond de vente non compté seul. */
  kind: DefaultPriceIssue | 'niveau-superieur' | 'marche'
  reason: string
  origin: MountPriceOrigin
  row?: DefaultMountPrice
}

/** Libellés courts de toutes les natures de référence (affichage « non comptée »). */
export const REFERENCE_KIND_LABELS: Record<MountPriceReference['kind'], string> = {
  ...DEFAULT_PRICE_ISSUE_LABELS,
  'niveau-superieur': 'niveau supérieur seulement',
  marche: 'HDV mixte, plafond',
}

export interface MountSalePrice {
  /**
   * Prix brut, ou null (à saisir). Origine `marche` sans `cappedFrom` : prix de l'objet-monture à
   * l'HDV (indication « HDV mixte ») — `mountValuation` ne le compte pas seul (plafond de vente).
   */
  price: number | null
  origin: MountPriceOrigin
  /** Tranche la plus proche du niveau (affichage). */
  band: MountBand
  confidence?: string
  priceType?: PriceType
  /** Obsolète : un plancher n'est jamais un prix de vente (il figure dans `references`). Toujours faux. */
  isFloor: boolean
  row?: DefaultMountPrice
  /**
   * exact (niveau d'ancrage), interpolation entre deux ancrages, palier inférieur (aucun ancrage
   * au-dessus), `marche` (prix de l'objet-monture à l'HDV du serveur, tous niveaux confondus).
   */
  method: 'exact' | 'interpolation' | 'palier-inferieur' | 'marche' | 'aucun'
  /** Prix interpolé ou repris d'un niveau inférieur, ou prix de marché mixte : estimation. */
  estimated: boolean
  anchors: MountPriceAnchor[]
  /** Références non utilisées (de la plus proche du niveau à la plus lointaine). */
  references: MountPriceReference[]
  note?: string
  /** Prix de l'objet-monture à l'HDV du serveur (quand `mctx.market` le connaît), quelle que soit l'origine retenue. */
  market?: MountMarketQuote
  /** Plafond de vente prudent (brut) = prix du marché ; vos prix ne sont jamais plafonnés. */
  ceiling?: number
  /** Relevé par défaut de la recherche ramené au prix du marché (plus bas) : prix et origine d'avant. */
  cappedFrom?: { price: number; origin: MountPriceOrigin }
}

function referenceReason(issue: DefaultPriceIssue, r: DefaultMountPrice, price: number): string {
  switch (issue) {
    case 'plancher':
      return `Plancher de la recherche (≈ ${fmtK(price)} net, pas un cours) : saisissez le prix HDV de votre serveur.`
    case 'ancien':
      return `Relevé ${r.date ? `du ${r.date} ` : ''}(${fmtK(price)}) trop ancien pour décider seul : confirmez-le ou saisissez le prix actuel.`
    case 'peu-fiable':
      return `Relevé peu fiable (${fmtK(price)}, confiance basse) : confirmez-le ou saisissez le prix de votre serveur.`
    case 'a-verifier':
      return `Relevé à vérifier (${fmtK(price)}) : la recherche déconseille de l'utiliser par défaut.`
    default:
      return `Estimation sans relevé (${fmtK(price)}) : saisissez le prix de votre serveur.`
  }
}

/** Ancrage (prix utilisable) d'une tranche, ou la meilleure référence non utilisable. */
function bandAnchor(sp: Species, band: MountBand, state: MountState, mctx: MountPriceContext): { anchor: MountPriceAnchor | null; reference: MountPriceReference | null } {
  const level = MOUNT_BAND_LEVEL[band]
  const own = mctx.mountOverrides[`${sp.id}|${band}`]
  if (own !== undefined && Number.isFinite(own)) return { anchor: { level, price: own, origin: 'joueur-espece', confidence: 'joueur' }, reference: null }
  const gen = mctx.generationOverrides[`${sp.family}|${sp.generation}|${band}`]
  if (gen !== undefined && Number.isFinite(gen)) return { anchor: { level, price: gen, origin: 'joueur-generation', confidence: 'joueur' }, reference: null }
  if (!mctx.useDefaults) return { anchor: null, reference: null }
  let reference: MountPriceReference | null = null
  const groups: [MountPriceOrigin, DefaultMountPrice[]][] = [
    ['defaut-espece', PRICES_DEFAULT.mounts.filter((r) => r.name !== null && normalizeName(r.name) === normalizeName(sp.name))],
    ['defaut-generation', PRICES_DEFAULT.mounts.filter((r) => r.name === null && r.family === sp.family && r.generation === sp.generation)],
  ]
  for (const [origin, rows] of groups)
    for (const r of rankRows(rows, band, state)) {
      const issue = defaultPriceIssue(r)
      if (!issue) return { anchor: { level, price: r.price as number, origin, confidence: r.confidence, priceType: r.priceType, row: r }, reference }
      if (!reference) {
        const shown = adjustFloor(r)
        const price = shown.price as number
        reference = { price, net: issue === 'plancher', level: r.level ?? level, kind: issue, reason: referenceReason(issue, r, price), origin, row: shown }
      }
    }
  return { anchor: null, reference }
}

/**
 * Prix de vente (brut, avant taxe) d'une monture à un niveau : ancrages aux niveaux 1, 100 et 200
 * (votre prix par couleur > votre prix par génération > relevé par défaut fiable par nom > par
 * génération), interpolés linéairement entre deux ancrages ; au-dessus du dernier ancrage, prix du
 * palier inférieur (estimation prudente) ; jamais un prix d'un niveau supérieur appliqué en dessous.
 * Planchers calculés, relevés anciens ou peu fiables : `references` seulement (prix null, « à saisir »).
 *
 * Avec `mctx.market` (export HDV du serveur), le prix de l'objet-monture s'intercale entre vos prix et
 * les défauts de la recherche (origine `marche`, `market` = date, statistique, volume) :
 *  - vos prix (couleur ou génération) priment et ne sont jamais plafonnés ;
 *  - un relevé par défaut plus cher que le marché est ramené au prix du marché (`cappedFrom`) ;
 *  - sans autre prix, le prix du marché est renvoyé (`method: 'marche'`, estimation « HDV mixte ») —
 *    `mountValuation` ne le compte alors que comme plafond de vente.
 */
export function mountSalePrice(speciesId: number, level: number, mctx: MountPriceContext, opts: { state?: MountState } = {}): MountSalePrice {
  const base = mountSalePriceBase(speciesId, level, mctx, opts)
  const mq = mountMarketQuote(speciesId, mctx.market)
  if (!mq) return base
  const withMarket = { ...base, market: mq, ceiling: mq.price }
  if (base.origin === 'joueur-espece' || base.origin === 'joueur-generation') return withMarket
  const where = `l’HDV${mq.serverName ? ` de ${mq.serverName}` : ''} du ${frenchDay(mq.exportDate)}`
  if (base.price !== null) {
    if (mq.price >= base.price) return withMarket
    return {
      ...withMarket,
      price: mq.price,
      origin: 'marche',
      confidence: mq.confidence,
      estimated: true,
      cappedFrom: { price: base.price, origin: base.origin },
      note: `Relevé par défaut (${fmtK(base.price)}) ramené au prix de l’objet-monture à ${where} (${fmtK(mq.price)}, ${MOUNT_MARKET_BADGE}) : plafond de vente prudent.`,
    }
  }
  return {
    ...withMarket,
    price: mq.price,
    origin: 'marche',
    confidence: mq.confidence,
    priceType: undefined,
    row: undefined,
    method: 'marche',
    estimated: true,
    note: `Prix de l’objet-monture à ${where} : ${fmtK(mq.price)} (${fmtN(mq.sold24)} vendus/24 h, ≈ ${fmtD(mq.perDayAvg)}/jour) — ${MOUNT_MARKET_BADGE}. Plafond de vente, pas un prix de décision : saisissez le prix d’une monture du niveau et de l’état voulus.`,
  }
}

function mountSalePriceBase(speciesId: number, level: number, mctx: MountPriceContext, opts: { state?: MountState }): MountSalePrice {
  const band = mountBand(level)
  const L = clamp(Math.floor(level || 1), 1, 200)
  const sp = getSpecies(speciesId)
  const state = opts.state ?? 'fertile'
  if (!sp) return { price: null, origin: 'manquant', band, isFloor: false, method: 'aucun', estimated: false, anchors: [], references: [] }
  const anchors: MountPriceAnchor[] = []
  const references: MountPriceReference[] = []
  for (const b of MOUNT_BANDS) {
    const { anchor, reference } = bandAnchor(sp, b, state, mctx)
    if (anchor) anchors.push(anchor)
    else if (reference) references.push(reference)
  }
  const exact = anchors.find((a) => a.level === L)
  const lo = [...anchors].reverse().find((a) => a.level < L)
  const hi = anchors.find((a) => a.level > L)
  const sortRefs = () => references.sort((a, b) => Math.abs(a.level - L) - Math.abs(b.level - L))
  const pack = (a: MountPriceAnchor, price: number, method: MountSalePrice['method'], note?: string, confidence = a.confidence): MountSalePrice => ({
    price,
    origin: a.origin,
    band,
    confidence,
    priceType: a.priceType,
    isFloor: false,
    row: a.row,
    method,
    estimated: method !== 'exact',
    anchors,
    references: sortRefs(),
    note,
  })
  if (exact) return pack(exact, exact.price, 'exact')
  if (lo && hi) {
    const price = lo.price + ((hi.price - lo.price) * (L - lo.level)) / (hi.level - lo.level)
    const confidence = lo.confidence !== 'joueur' ? lo.confidence : hi.confidence
    return pack(lo, price, 'interpolation', `Interpolé entre le niveau ${lo.level} (${fmtK(lo.price)}) et le niveau ${hi.level} (${fmtK(hi.price)}).`, confidence)
  }
  if (lo) return pack(lo, lo.price, 'palier-inferieur', `Prix du niveau ${lo.level} (${fmtK(lo.price)}) appliqué au niveau ${L}, faute de prix au-dessus : estimation prudente.`)
  if (hi)
    references.push({
      price: hi.price,
      net: false,
      level: hi.level,
      kind: 'niveau-superieur',
      reason: `Prix connu au niveau ${hi.level} seulement (${fmtK(hi.price)}) : jamais appliqué en dessous — saisissez aussi un prix au niveau ${hi.level === 100 ? 1 : 100}.`,
      origin: hi.origin,
      row: hi.row,
    })
  return { price: null, origin: 'manquant', band, isFloor: false, method: 'aucun', estimated: false, anchors, references: sortRefs() }
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
  /** Prix issu du marché importé (origine `marche`) : date de l'export, statistique, volume. */
  market?: MarketPriceInfo
}

/**
 * Valeur d'extraction : quantité × prix de la ressource de la famille (Neurone, Ambre, Corne). Le prix
 * suit `pricing.marketPrice` : votre prix > marché importé du serveur (`ctx.market`) > défaut.
 */
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
    market: p.market,
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
  /** Prix brut de la rune Ga retenu (avec un contexte de prix ; null = inconnu). */
  runePrice?: number | null
  /** Origine du prix de la rune (votre prix, marché du serveur, défaut). */
  runeOrigin?: PriceOrigin
  /** Rune chiffrée au marché importé : date de l'export, statistique, volume. */
  runeMarket?: MarketPriceInfo
}

/**
 * Valeur de brisage d'une monture (runes) selon les rendements observés de la recherche
 * (valuation.brisage.defaultValuePerMountByLevel, interpolés entre niv. 45 / 53 / 100 / 200), mise
 * à l'échelle du prix de la rune Ga (Ga Pa 1557, Ga Pme 1558) : votre prix, sinon celui du marché
 * importé du serveur (`ctx.market`), sinon le défaut. Aucune donnée pour les Dragodindes.
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
  let runeInfo: Pick<BrisageValue, 'runePrice' | 'runeOrigin' | 'runeMarket'> = {}
  if (ctx) {
    const def = defaultItemPrice(rune)?.price ?? null
    const p = marketPrice(rune, ctx)
    const cur = p.price
    runeInfo = { runePrice: cur, runeOrigin: p.origin, runeMarket: p.market }
    const name = marketItemName(rune, ctx.market?.names)
    if (cur === null || def === null) {
      complete = false
      note += ` Prix de la ${name} manquant.`
    } else if (cur !== def) {
      scale = cur / def
      note += ` Mis à l'échelle du prix de la ${name}${p.origin === 'marche' && p.market ? ` (HDV du ${frenchDay(p.market.exportDate)})` : ''} : ${Math.round(scale * 100)} % du défaut.`
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
    ...runeInfo,
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
  /** Vente : prix interpolé ou repris d'un niveau inférieur (estimation). */
  estimated?: boolean
  /** Vente sans prix utilisable : référence affichée (plancher, relevé ancien…), nette de taxe, jamais comptée. */
  reference?: { net: number; kind: MountPriceReference['kind']; reason: string }
  /** Vente : plafond prudent (net de taxe) = prix de l'objet-monture à l'HDV du serveur. */
  ceiling?: number
  /** Vente : prix de l'objet-monture à l'HDV du serveur (« HDV mixte »). */
  market?: MountMarketQuote
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
  /** La meilleure option repose sur une estimation (prix interpolé). */
  estimated: boolean
  salePrice: MountSalePrice
  /**
   * Borne haute de la meilleure valeur nette : `best` si tout est chiffré ; avec une vente seulement
   * plafonnée par le marché (HDV mixte) et les autres options chiffrées, max(best, plafond) ; sinon null.
   */
  bestHigh?: number | null
  /** Prix de marché de l'objet-monture très bas (montures séniles probables) : avertissement à afficher. */
  marketWarning?: string
}

export interface ValuationOptions {
  ctx: PriceContext
  mountPrices: MountPriceContext
  /** Taxe d'HDV (0,02 = 2 %). */
  saleTax: number
  state?: MountState
  senile?: boolean
}

/**
 * Valeur d'une monture : max(vente, extraction, brisage), chaque terme net de la taxe d'HDV. Une vente
 * sans prix utilisable (plancher, relevé ancien) est « à saisir » : la valeur connue est alors une
 * borne basse (`complete: false`) et la référence est seulement affichée (`sale.reference`).
 *
 * Marché du serveur (`mountPrices.market`) : le prix de l'objet-monture (« HDV mixte ») n'est qu'un
 * PLAFOND DE VENTE prudent pour les décisions :
 *  - il ramène un relevé par défaut plus cher à son niveau (vente comptée au prix du marché) ;
 *  - seul (aucun de vos prix ni relevé fiable), il n'est PAS compté : vente « à saisir », référence
 *    affichée (`kind: 'marche'`), `sale.ceiling` et `bestHigh` = borne haute de la valeur ;
 *  - vos prix ne sont jamais plafonnés ;
 *  - un prix de marché < ½ × valeur d'extraction dès la G5 signale des montures séniles probables
 *    (`marketWarning`) : jamais une opportunité d'achat pour extraire.
 */
export function mountValuation(speciesId: number, level: number, opts: ValuationOptions): MountValuation {
  const sp = getSpecies(speciesId)
  const tax = clamp(opts.saleTax, 0, 1)
  const salePrice = mountSalePrice(speciesId, level, opts.mountPrices, { state: opts.state })
  // Prix de marché seul (aucun autre prix) : plafond, jamais compté comme prix de décision.
  const marketOnly = salePrice.origin === 'marche' && !salePrice.cappedFrom
  const decisionPrice = marketOnly ? null : salePrice.price
  const ceilingNet = salePrice.ceiling === undefined ? undefined : salePrice.ceiling * (1 - tax)
  const marketRef: MountPriceReference | undefined =
    marketOnly && salePrice.price !== null
      ? { price: salePrice.price, net: false, level: clamp(Math.floor(level || 1), 1, 200), kind: 'marche', reason: salePrice.note ?? MOUNT_MARKET_BADGE, origin: 'marche' }
      : undefined
  // Le prix du serveur (HDV mixte) passe avant un plancher ou un relevé ancien de la recherche.
  const ref = decisionPrice === null ? (marketRef ?? salePrice.references[0]) : undefined
  const sale: FateValue = {
    kind: 'vente',
    possible: true,
    gross: decisionPrice,
    net: decisionPrice === null ? null : decisionPrice * (1 - tax),
    complete: decisionPrice !== null,
    confidence: salePrice.confidence,
    origin: MOUNT_PRICE_ORIGIN_LABELS[salePrice.origin],
    note: decisionPrice === null ? (ref?.reason ?? 'Aucun prix de vente : saisissez le prix HDV de cette monture.') : salePrice.note,
    estimated: salePrice.estimated,
    reference: ref ? { net: ref.net ? ref.price : ref.price * (1 - tax), kind: ref.kind, reason: ref.reason } : undefined,
    ceiling: ceilingNet,
    market: salePrice.market,
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
  // Ordre de préférence à valeur égale : extraction, brisage, puis vente.
  const fates = [extraction, brisage, sale].filter((f) => f.possible && f.net !== null)
  let best: FateValue | null = null
  for (const f of fates) if (!best || (f.net as number) > (best.net as number) + 1e-9) best = f
  const complete = [sale, extraction, brisage].every((f) => !f.possible || f.complete)
  // Borne haute : vente plafonnée par le marché, autres options chiffrées.
  let bestHigh: number | null = complete ? (best?.net ?? null) : null
  if (!complete && !sale.complete && ceilingNet !== undefined && [extraction, brisage].every((f) => !f.possible || f.complete))
    bestHigh = Math.max(best?.net ?? 0, ceilingNet)
  // Montures séniles probables : prix de l'objet-monture très bas face à l'extraction (G5+).
  let marketWarning: string | undefined
  const mq = salePrice.market
  if (mq && sp && !opts.senile && possibleSenile(sp.generation, mq.price, ex.value))
    marketWarning = `Prix HDV de l’objet-monture (${fmtK(mq.price)}) sous la moitié de sa valeur d’extraction (${fmtK(ex.value ?? 0)}) : ventes probablement tirées par des montures séniles (extraction = 1 ressource). N’achetez pas ces montures pour les extraire sans vérifier qu’elles ne sont pas séniles.`
  return {
    speciesId,
    level,
    sale,
    extraction,
    brisage,
    best: best?.net ?? null,
    bestKind: best?.kind ?? null,
    confidence: best?.confidence ?? 'low',
    complete,
    estimated: !!best?.estimated,
    salePrice,
    bestHigh,
    marketWarning,
  }
}

// ---------- Génétons ----------

export interface GenetonValue {
  /** Valeur brute d'un généton (kamas, avant la taxe de revente du parchemin). */
  value: number
  range: [number, number]
  /** Votre valeur, marché importé du serveur (boutique d'Eugène Éton), ou défaut de la recherche. */
  origin: 'joueur' | 'marche' | 'defaut'
  confidence: string
  basis: string
  /** Valeur nette de la taxe de vente (si `saleTax` est fourni). */
  net?: number
  /** Origine `marche` : détail de la boutique (meilleur échange, toutes les lignes) et export. */
  market?: GenetonMarketValue & { exportDate: string; serverName?: string }
}

/**
 * Valeur d'un généton en kamas (brute, avant la taxe de revente du parchemin) : votre valeur, sinon
 * celle du marché importé du serveur (`opts.market` : max(prix ÷ coût) sur la boutique d'Eugène Éton —
 * Petits/normaux/Grands/Puissants Parchemins, Tourmaline 130), sinon 375 K (Puissant Parchemin ≈
 * 60 000 / 160). `net` = brute × (1 − `saleTax`) quand la taxe est fournie (les calculs comptent les
 * génétons nets). Pour une production importante, voir `genetonLiquidValue` (volume des parchemins).
 */
export function genetonKamasValue(override?: number | null, opts: { market?: MarketSource | null; saleTax?: number } = {}): GenetonValue {
  const g = PRICES_DEFAULT.genetons
  const tax = opts.saleTax === undefined ? undefined : clamp(opts.saleTax, 0, 1)
  const withNet = (v: GenetonValue): GenetonValue => (tax === undefined ? v : { ...v, net: v.value * (1 - tax) })
  if (override !== null && override !== undefined && Number.isFinite(override) && override >= 0)
    return withNet({ value: override, range: g.range, origin: 'joueur', confidence: 'joueur', basis: 'Valeur saisie.' })
  const m = opts.market ? genetonValueFromMarket(opts.market, tax ?? 0) : null
  if (m && opts.market) {
    const row = opts.market.rows[String(m.best.id)]
    const where = `HDV${opts.market.serverName ? ` de ${opts.market.serverName}` : ''} du ${frenchDay(opts.market.exportDate)}`
    return withNet({
      value: m.value,
      range: g.range,
      origin: 'marche',
      confidence: row ? marketConfidence(row) : 'low',
      basis: `${m.best.name} ${fmtK(m.best.price ?? 0)} ÷ ${m.best.cost} génétons (${where}, ${fmtN(m.best.sold24)} vendus/24 h).`,
      market: { ...m, exportDate: opts.market.exportDate, serverName: opts.market.serverName },
    })
  }
  return withNet({ value: g.kamasPerGeneton, range: g.range, origin: 'defaut', confidence: g.confidence, basis: g.basis })
}

export interface GenetonLiquidLine {
  id: number
  name: string
  cost: number
  /** Prix brut de l'objet de la boutique. */
  price: number
  /** Objets vendables par jour sans saturer (part du volume moyen). */
  sellablePerDay: number
  /** Objets prévus par jour (génétons alloués ÷ coût). */
  units: number
  /** Génétons alloués à cet objet par jour. */
  genetons: number
}

export interface GenetonLiquidValue {
  /** Valeur brute moyenne d'un généton écoulé (kamas). */
  perGeneton: number | null
  /** Valeur nette moyenne (taxe de vente). */
  net: number | null
  /** Génétons écoulés par jour sans saturer (≤ génétons produits). */
  absorbed: number
  /** Génétons produits par jour au-delà de ce que le marché absorbe (non valorisés). */
  surplus: number
  lines: GenetonLiquidLine[]
}

/**
 * Valeur d'une production de génétons compte tenu du volume des parchemins sur ce serveur : les
 * génétons du jour vont d'abord à l'objet le plus rentable (prix ÷ coût), dans la limite de `share`
 * (15 %) de son volume quotidien moyen, puis au suivant… Un généton qui ne trouve pas preneur n'est pas
 * valorisé (`surplus`). null sans marché ni prix de la boutique.
 */
export function genetonLiquidValue(
  market: MarketSource | null | undefined,
  genetonsPerDay: number,
  opts: { share?: number; saleTax?: number } = {},
): GenetonLiquidValue | null {
  const m = market ? genetonValueFromMarket(market, opts.saleTax ?? 0) : null
  if (!m || !market) return null
  const share = opts.share ?? DEFAULT_MAX_MARKET_SHARE
  let left = Math.max(0, genetonsPerDay)
  let kamas = 0
  const lines: GenetonLiquidLine[] = []
  for (const l of m.lines) {
    if (left <= 1e-9 || l.price === null || l.perGeneton === null) break
    const d = marketDepth(market, l.id)
    const sellable = d ? d.perDayAvg * share : 0
    if (sellable <= 0) continue
    const units = Math.min(sellable, left / l.cost)
    const g = units * l.cost
    left -= g
    kamas += units * l.price
    lines.push({ id: l.id, name: l.name, cost: l.cost, price: l.price, sellablePerDay: sellable, units, genetons: g })
  }
  const absorbed = Math.max(0, genetonsPerDay) - left
  const tax = clamp(opts.saleTax ?? 0, 0, 1)
  return {
    perGeneton: absorbed > 0 ? kamas / absorbed : null,
    net: absorbed > 0 ? (kamas / absorbed) * (1 - tax) : null,
    absorbed,
    surplus: left,
    lines,
  }
}

// ---------- Liquidité du marché (ventes prévues vs volume du serveur) ----------

/** Source de marché : un `MarketSource` ou un contexte de prix (`ctx.market`). */
export type MarketLike = MarketSource | Pick<PriceContext, 'market'> | null | undefined

function marketOf(src: MarketLike): MarketSource | null {
  if (!src) return null
  if ('rows' in src) return src
  return src.market ?? null
}

/** Ce que le marché d'un serveur absorbe d'un objet par jour sans saturer. */
export interface SalesCap {
  itemId: number
  name: string
  /** Part du volume quotidien moyen retenue (0,15 = 15 %, réglage `ServerEntry.maxMarketShare`). */
  share: number
  sold24: number
  sold30: number
  /** Ventes moyennes par jour (vendus_30j ÷ 30). */
  perDayAvg: number
  /** Kamas échangés par jour. */
  kamasPerDay: number
  /** Quantité absorbable par jour (fractionnaire : 0,3 = une vente tous les 3 à 4 jours). */
  perDay: number
  /** Unités entières par jour. */
  perDayFloor: number
  /** Kamas absorbables par jour (`share` × kamas échangés). */
  kamasCap: number
  /** Prix du marché (statistique du serveur) ; null = sans vente. */
  price: number | null
}

/**
 * Plafond de ventes d'un objet : `share` (15 % par défaut) du volume quotidien moyen sur 30 jours.
 * null si l'objet est absent de l'export (liquidité inconnue) ou sans marché.
 */
export function salesCap(id: number, src: MarketLike, share = DEFAULT_MAX_MARKET_SHARE): SalesCap | null {
  const market = marketOf(src)
  const d = market ? marketDepth(market, id) : null
  if (!market || !d) return null
  const s = clamp(share, 0, 1)
  return {
    itemId: id,
    name: marketItemName(id, market.names),
    share: s,
    sold24: d.sold24,
    sold30: d.sold30,
    perDayAvg: d.perDayAvg,
    kamasPerDay: d.kamasPerDay,
    perDay: d.perDayAvg * s,
    perDayFloor: Math.floor(d.perDayAvg * s + 1e-9),
    kamasCap: d.kamasPerDay * s,
    price: snapshotPrice(market, id),
  }
}

/** Quantité d'un objet que le marché absorbe par jour (fractionnaire), null = inconnue. */
export function absorbablePerDay(id: number, src: MarketLike, share = DEFAULT_MAX_MARKET_SHARE): number | null {
  return salesCap(id, src, share)?.perDay ?? null
}

export type SaleKind = 'ressource' | 'monture' | 'rune' | 'parchemin' | 'autre'

/** Ventes prévues d'un objet (unités par jour). */
export interface PlannedSale {
  itemId: number
  perDay: number
  kind?: SaleKind
}

export interface LiquidityCheck {
  itemId: number
  name: string
  kind: SaleKind
  /** Unités prévues par jour. */
  perDay: number
  /** Absorbables par jour (null = liquidité inconnue). */
  cap: number | null
  /** Ventes moyennes du marché par jour. */
  marketPerDay: number | null
  share: number
  /** Part du volume quotidien moyen que prendraient ces ventes (null = inconnue). */
  marketShare: number | null
  exceeds: boolean
  /** Message à afficher (dépassement ou liquidité inconnue), sinon null. */
  message: string | null
}

const SALE_KIND_LABELS: Record<SaleKind, string> = { ressource: 'ressource', monture: 'monture', rune: 'rune', parchemin: 'parchemin', autre: 'objet' }

/**
 * Compare des ventes prévues (unités par jour, regroupées par objet) au volume du marché : dépassement
 * quand elles excèdent `share` du volume quotidien moyen. Sans marché : liste vide.
 */
export function checkPlannedSales(sales: PlannedSale[], src: MarketLike, share = DEFAULT_MAX_MARKET_SHARE): LiquidityCheck[] {
  const market = marketOf(src)
  if (!market) return []
  const merged = new Map<number, PlannedSale>()
  for (const s of sales) {
    if (!(s.perDay > 0)) continue
    const prev = merged.get(s.itemId)
    merged.set(s.itemId, { itemId: s.itemId, perDay: (prev?.perDay ?? 0) + s.perDay, kind: prev?.kind ?? s.kind })
  }
  const out: LiquidityCheck[] = []
  for (const s of merged.values()) {
    const cap = salesCap(s.itemId, market, share)
    const kind = s.kind ?? 'autre'
    const name = marketItemName(s.itemId, market.names)
    if (!cap) {
      out.push({ itemId: s.itemId, name, kind, perDay: s.perDay, cap: null, marketPerDay: null, share, marketShare: null, exceeds: false, message: `${name} : absent de l’export HDV, liquidité inconnue (${fmtD(s.perDay)} ${SALE_KIND_LABELS[kind]}s/jour prévues).` })
      continue
    }
    const exceeds = s.perDay > cap.perDay + 1e-9
    out.push({
      itemId: s.itemId,
      name,
      kind,
      perDay: s.perDay,
      cap: cap.perDay,
      marketPerDay: cap.perDayAvg,
      share: cap.share,
      marketShare: cap.perDayAvg > 0 ? s.perDay / cap.perDayAvg : null,
      exceeds,
      message: exceeds
        ? `${name} : ${fmtD(s.perDay)} par jour prévus pour ≈ ${fmtD(cap.perDay)} absorbables (${pctN(cap.share)} des ${fmtD(cap.perDayAvg)} vendus par jour en moyenne sur ce serveur) — le prix baissera ou les ventes s’étaleront.`
        : null,
    })
  }
  return out.sort((a, b) => Number(b.exceeds) - Number(a.exceeds) || (b.marketShare ?? 0) - (a.marketShare ?? 0))
}

/**
 * Ventes qu'entraînent des montures valorisées (bébés, stériles) : ressource d'extraction × génération,
 * objet-monture vendu, runes Ga (équivalent en runes : valeur ÷ prix de la rune). `qty` montures.
 */
function salesOfFate(speciesId: number, fate: FateKind | 'clone' | null | undefined, qty: number, ctx: PriceContext, grossValue: number | null): PlannedSale[] {
  const sp = getSpecies(speciesId)
  if (!sp || qty <= 0) return []
  if (fate === 'extraction') return sp.extractionQty > 0 ? [{ itemId: FAMILIES[sp.family].extractionItemId, perDay: qty * sp.extractionQty, kind: 'ressource' }] : []
  if (fate === 'vente') return sp.itemId ? [{ itemId: sp.itemId, perDay: qty, kind: 'monture' }] : []
  if (fate === 'brisage') {
    const rune = BRISAGE_RUNE[sp.family]
    const price = rune === null ? null : marketPrice(rune, ctx).price
    if (rune === null || price === null || price <= 0 || grossValue === null) return []
    return [{ itemId: rune, perDay: (qty * grossValue) / price, kind: 'rune' }]
  }
  return []
}

/**
 * Génétons produits par jour face à ce que la boutique d'Eugène Éton permet d'écouler sur ce serveur
 * (parchemins et Tourmaline revendus, `share` du volume de chacun, du meilleur échange au moins bon).
 * Une ligne `kind: 'parchemin'` exprimée en génétons (itemId = meilleur échange) ; null sans génétons ni
 * prix de la boutique.
 */
export function genetonLiquidityCheck(genetonsPerDay: number, src: MarketLike, share = DEFAULT_MAX_MARKET_SHARE): LiquidityCheck | null {
  const market = marketOf(src)
  if (!market || !(genetonsPerDay > 0)) return null
  const m = genetonValueFromMarket(market)
  if (!m) return null
  let cap = 0
  let perDayAvg = 0
  for (const l of m.lines) {
    if (l.price === null) continue
    const d = marketDepth(market, l.id)
    if (!d) continue
    cap += d.perDayAvg * share * l.cost
    perDayAvg += d.perDayAvg * l.cost
  }
  const exceeds = genetonsPerDay > cap + 1e-9
  return {
    itemId: m.best.id,
    name: 'Génétons (parchemins de la boutique)',
    kind: 'parchemin',
    perDay: genetonsPerDay,
    cap,
    marketPerDay: perDayAvg,
    share,
    marketShare: perDayAvg > 0 ? genetonsPerDay / perDayAvg : null,
    exceeds,
    message: exceeds
      ? `Génétons : ${fmtD(genetonsPerDay)} par jour pour ≈ ${fmtD(cap)} écoulables en parchemins et Tourmaline sur ce serveur (${pctN(share)} du volume de chaque objet de la boutique) — leur valeur baissera.`
      : null,
  }
}

// ---------- Lot de fécondité : modèle idéal, typique (planificateur) ou vos lots ----------

/**
 * Points de Baffeur + Caresseur par lot, modèle idéal : moyenne du planificateur de fécondité pour une
 * sérénité de départ uniforme sur [−5 000 ; 5 000] ≈ 3 200. ESTIMATION : la distribution réelle de la
 * sérénité initiale est inconnue (research §4 n° 9).
 */
export const DEFAULT_SERENITY_POINTS = 3_200

export const FERTILITY_GAUGES: GaugeId[] = ['foudroyeur', 'abreuvoir', 'dragofesse', 'baffeur', 'caresseur']
const SERENITY_GAUGES: GaugeId[] = ['baffeur', 'caresseur']

/**
 * Durée pour rendre un lot fécond au palier donné, modèle IDÉAL (minimum théorique) : endurance +
 * maturité ensemble, puis sérénité, puis amour ⇒ (40 000 + ½ sérénité) / débit. Un lot réel du
 * planificateur demande ≈ 20 à 35 % de plus (voir `batchProfile('typique', …)`).
 */
export function fertilitySeconds(tier: FuelTier, rules: Ruleset, serenityPoints = DEFAULT_SERENITY_POINTS): number {
  return ((2 * MOUNT_STAT_MAX + 0.5 * Math.max(0, serenityPoints)) / rules.gaugeRatePerTick[tier]) * TICK_SECONDS
}

/** Points de Mangeoire consommés pendant la phase d'amour (Mangeoire en 2e jauge). */
export function xpOverlapPoints(tier: FuelTier, xpTier: FuelTier, rules: Ruleset, lovePoints = MOUNT_STAT_MAX): number {
  return (lovePoints * rules.gaugeRatePerTick[xpTier]) / rules.gaugeRatePerTick[tier]
}

export type BatchModel = 'typique' | 'ideal'

export interface BatchProfile {
  model: BatchModel | 'mes-lots'
  /** Palier choisi (jauges de statistiques). */
  tier: FuelTier
  /** Points consommés par lot et par jauge (la consommation ne dépend pas du nombre de montures). */
  points: Partial<Record<GaugeId, number>>
  /** Palier entretenu par jauge (prix au point, socle) : sérénité au palier 1, comme le planificateur. */
  tiers: Partial<Record<GaugeId, FuelTier>>
  /** Durée pour rendre le lot fécond. */
  seconds: number
  /** Points de Baffeur + Caresseur par lot. */
  serenityPoints: number
  label: string
  note: string
  /** Mode « vos lots » : nombre de lots planifiés. */
  samples?: number
}

export const BATCH_MODEL_LABELS: Record<BatchProfile['model'], string> = {
  typique: 'Lot typique du planificateur',
  ideal: 'Lot idéal, minimum théorique',
  'mes-lots': 'Vos lots, plans des enclos',
}

type FertilityGaugeId = 'foudroyeur' | 'abreuvoir' | 'dragofesse' | 'baffeur' | 'caresseur'

/**
 * Lot TYPIQUE : moyenne du planificateur d'enclos (`planPaddock`, paddockAssign.ts) sur 200 lots de
 * 10 montures fraîches (statistiques à 0) dont la sérénité tient dans une fenêtre de 2 000
 * (E-GROUP-01), bas de fenêtre uniforme sur [−5 000 ; 3 000], règles 3.6 (débits identiques en 3.7),
 * jauges de sérénité au palier 1, étapes de 5 min au moins. Calculé le 2026-10-02 ; le test
 * « lot typique » d'economy.test.ts vérifie qu'il reste proche du planificateur.
 */
export const TYPICAL_BATCH: Record<FuelTier, { seconds: number; points: Record<FertilityGaugeId, number> }> = {
  1: { seconds: 50_080, points: { foudroyeur: 23_000, abreuvoir: 23_800, dragofesse: 22_680, baffeur: 1_700, caresseur: 1_770 } },
  2: { seconds: 26_130, points: { foudroyeur: 23_310, abreuvoir: 23_800, dragofesse: 22_950, baffeur: 1_700, caresseur: 1_770 } },
  3: { seconds: 18_150, points: { foudroyeur: 23_620, abreuvoir: 23_820, dragofesse: 23_240, baffeur: 1_700, caresseur: 1_770 } },
  4: { seconds: 14_160, points: { foudroyeur: 23_910, abreuvoir: 23_810, dragofesse: 23_510, baffeur: 1_700, caresseur: 1_770 } },
}

/**
 * Palier réellement entretenu sur une jauge, même règle que le planificateur : sérénité au palier 1 ;
 * une jauge vide que le lot consomme peu (< `SOCLE_MIN_SHARE` du bas du palier) tourne au palier 1
 * plutôt que d'exiger un socle.
 */
export function maintainedTier(gauge: GaugeId, points: number, tier: FuelTier, rules: Ruleset): FuelTier {
  if (SERENITY_GAUGES.includes(gauge)) return 1
  if (tier > 1 && points < SOCLE_MIN_SHARE * rules.gaugeTierMax[(tier - 1) as FuelTier]) return 1
  return tier
}

/**
 * Profil d'un lot de fécondité. « idéal » : 20 000 points par statistique, sérénité moitié Baffeur,
 * moitié Caresseur, toutes les jauges au palier choisi, durée `fertilitySeconds` (minimum théorique).
 * « typique » : moyennes du planificateur (`TYPICAL_BATCH`), sérénité au palier 1 ; `serenityPoints`
 * remplace la sérénité moyenne (durée ajustée de ½ point par point au débit du palier 1).
 */
export function batchProfile(model: BatchModel, tier: FuelTier, rules: Ruleset, serenityPoints?: number): BatchProfile {
  if (model === 'ideal') {
    const ser = Math.max(0, serenityPoints ?? DEFAULT_SERENITY_POINTS)
    const points: Partial<Record<GaugeId, number>> = { foudroyeur: MOUNT_STAT_MAX, abreuvoir: MOUNT_STAT_MAX, dragofesse: MOUNT_STAT_MAX, baffeur: ser / 2, caresseur: ser / 2 }
    return {
      model,
      tier,
      points,
      tiers: Object.fromEntries(FERTILITY_GAUGES.map((g) => [g, tier])) as Partial<Record<GaugeId, FuelTier>>,
      seconds: fertilitySeconds(tier, rules, ser),
      serenityPoints: ser,
      label: BATCH_MODEL_LABELS.ideal,
      note: `Minimum théorique : 20 000 points par statistique, ${fmtN(ser)} points de sérénité, toutes les jauges au palier ${tier} (aucun dépassement ni attente).`,
    }
  }
  const t = TYPICAL_BATCH[tier]
  const baseSer = t.points.baffeur + t.points.caresseur
  const ser = serenityPoints === undefined ? baseSer : Math.max(0, serenityPoints)
  const k = baseSer > 0 ? ser / baseSer : 0
  const points: Partial<Record<GaugeId, number>> = {
    foudroyeur: t.points.foudroyeur,
    abreuvoir: t.points.abreuvoir,
    dragofesse: t.points.dragofesse,
    baffeur: t.points.baffeur * k,
    caresseur: t.points.caresseur * k,
  }
  const seconds = Math.max(0, t.seconds + ((0.5 * (ser - baseSer)) / rules.gaugeRatePerTick[1]) * TICK_SECONDS)
  return {
    model,
    tier,
    points,
    tiers: Object.fromEntries(FERTILITY_GAUGES.map((g) => [g, maintainedTier(g, points[g] ?? 0, tier, rules)])) as Partial<Record<GaugeId, FuelTier>>,
    seconds,
    serenityPoints: ser,
    label: BATCH_MODEL_LABELS.typique,
    note: `Moyenne du planificateur d'enclos sur des lots de 10 montures de sérénité proche (fenêtre de 2 000) : dépassements, poussées de sérénité et attentes compris (≈ ${Math.round((seconds / fertilitySeconds(tier, rules, ser) - 1) * 100)} % de temps de plus que le lot idéal).`,
  }
}

/** Plan de lot réel (un `FertilityPlan` de `planPaddock`/`assignPaddocks` convient). */
export interface PlannedBatch {
  consumed: Partial<Record<GaugeId, number>>
  totalSeconds: number
  tiers?: Partial<Record<GaugeId, FuelTier>>
}

/**
 * Profil « vos lots » : moyenne des plans de fécondité de vos montures (page Enclos). Ne garde que les
 * jauges de fécondité (la Mangeoire est comptée à part) ; palier par jauge = le plus haut des plans.
 * null sans plan.
 */
export function batchProfileFromPlans(plans: PlannedBatch[], tier: FuelTier): BatchProfile | null {
  const ok = plans.filter((p) => p.totalSeconds > 0)
  if (!ok.length) return null
  const points: Partial<Record<GaugeId, number>> = {}
  const tiers: Partial<Record<GaugeId, FuelTier>> = {}
  for (const g of FERTILITY_GAUGES) {
    const sum = ok.reduce((s, p) => s + Math.max(0, p.consumed[g] ?? 0), 0)
    if (sum > 0) points[g] = sum / ok.length
    const used = ok.map((p) => p.tiers?.[g]).filter((t): t is FuelTier => t !== undefined)
    tiers[g] = used.length ? (Math.max(...used) as FuelTier) : SERENITY_GAUGES.includes(g) ? 1 : tier
  }
  const seconds = ok.reduce((s, p) => s + p.totalSeconds, 0) / ok.length
  return {
    model: 'mes-lots',
    tier,
    points,
    tiers,
    seconds,
    serenityPoints: (points.baffeur ?? 0) + (points.caresseur ?? 0),
    label: BATCH_MODEL_LABELS['mes-lots'],
    note: `Moyenne de ${ok.length} lot${ok.length > 1 ? 's' : ''} planifié${ok.length > 1 ? 's' : ''} avec vos montures (répartition automatique de la page Enclos).`,
    samples: ok.length,
  }
}

// ---------- Coût au point des jauges ----------

export interface PointCostHint {
  /** Kamas par point (règles 3.6 ; ÷ facteur de durabilité en 3.7). */
  value: number
  confidence: string
  basis: string
  source: string
}

/**
 * Indices de coût au point des jauges de fécondité (la recherche n'a de défauts que pour la Mangeoire,
 * README §4.1 n° 2). Seule la Dragofesse au palier 1 a un indice.
 */
export const FERTILITY_POINT_COST_HINTS: Partial<Record<GaugeId, Partial<Record<FuelTier, PointCostHint>>>> = {
  dragofesse: {
    1: {
      value: 13,
      confidence: 'low',
      basis: 'Minuscule Extrait de Dragofesse ≈ 13 000 K (Viande Intangible + Herbe Folle) pour 1 000 points',
      source: 'research/data/prices-default.json → valuation.fuelCostPerGaugePointDefaults.note ; research/README.md §4.1 n° 2',
    },
  },
}

/**
 * Coût d'un point de jauge entretenue à un palier : `bestFuel` (fuel.ts), plus un repli « estimation »
 * signalé pour une jauge de fécondité sans aucun prix quand la recherche donne un indice
 * (`FERTILITY_POINT_COST_HINTS`, prix par défaut activés). Un carburant de palier supérieur chiffré et
 * moins cher au point que l'indice reste préférable.
 */
export function gaugePointCost(gauge: GaugeId, tier: FuelTier, ctx: PriceContext, opts: BestFuelOpts): GaugePointCost {
  const pc = bestFuel(gauge, tier, ctx, opts)
  if (pc.complete || !ctx.useDefaults) return pc
  const hint = FERTILITY_POINT_COST_HINTS[gauge]?.[tier]
  if (!hint) return pc
  const factor = opts.rules.fuelDurabilityFactor
  const scaled = hint.value / factor
  if (pc.bound === 'max' && pc.value !== null && pc.value < scaled)
    return { ...pc, complete: true, bound: null, missing: [], note: `Carburant de palier supérieur (« ${pc.fuel?.fuel.name ?? '?'} »), moins cher au point que l’indice de la recherche pour ce palier.` }
  return {
    ...pc,
    value: scaled,
    complete: true,
    bound: null,
    fuel: null,
    origin: 'estimation',
    confidence: hint.confidence,
    estimated: true,
    missing: [],
    note: `Estimation de la recherche (${hint.basis})${factor !== 1 ? `, divisée par ${factor} (durabilité ×${factor})` : ''} : saisissez vos prix pour le coût réel.`,
  }
}

// ---------- Coûts d'enclos : fécondité et XP ----------

export interface GaugeCostLine {
  gauge: GaugeId
  /** Palier entretenu sur cette jauge. */
  tier: FuelTier
  /** Points de jauge consommés pour tout le lot. */
  pointsPerBatch: number
  pointCost: GaugePointCost
  /** Coût pour le lot (borne basse si incomplet ; null si inconnu ou borne haute seulement). */
  costPerBatch: number | null
  /** Borne haute du coût du lot (= coût si complet ; null si inconnue). */
  upperPerBatch: number | null
  complete: boolean
  estimated: boolean
}

export interface FertilityCostInput {
  tier: FuelTier
  /** Montures éligibles par lot (1 … 10). */
  batchSize: number
  /**
   * Points de sérénité (Baffeur + Caresseur) du lot. Défaut : celui du modèle de lot.
   */
  serenityPointsPerMount?: number
  ctx: PriceContext
  rules: Ruleset
  jobLevel?: number
  craftableOnly?: boolean
  /** Modèle de lot (défaut 'ideal' pour compatibilité ; la page Rentabilité utilise 'typique'). */
  model?: BatchModel
  /** Profil de lot explicite (prioritaire sur `model`), ex. `batchProfileFromPlans`. */
  profile?: BatchProfile
}

export interface FertilityCost {
  lines: GaugeCostLine[]
  /** Coût du lot (somme connue ; borne basse si incomplet). */
  perBatch: number | null
  perMount: number | null
  /** Borne haute du coût du lot (null si une jauge n'a aucune borne). */
  perBatchHigh: number | null
  perMountHigh: number | null
  complete: boolean
  /** Une jauge est chiffrée par une estimation (indice de la recherche). */
  estimated: boolean
  missing: number[]
  batchSize: number
  serenityPoints: number
  secondsPerBatch: number
  profile: BatchProfile
}

function lineCost(points: number, pc: GaugePointCost): number | null {
  if (pc.value === null || pc.bound === 'max') return null
  return points * pc.value
}

function lineUpper(points: number, pc: GaugePointCost): number | null {
  if (pc.value === null) return null
  if (pc.complete || pc.bound === 'max') return points * pc.value
  return null
}

/**
 * Coût de fécondité d'un lot : points de chaque jauge selon le modèle de lot (idéal : 20 000 par
 * statistique + sérénité ; typique : moyennes du planificateur), chaque jauge au palier qu'elle
 * entretient. La consommation ne dépend pas du nombre de montures (research §2.3) : le coût par
 * monture est divisé par la taille du lot.
 */
export function fertilityCost(input: FertilityCostInput): FertilityCost {
  const batchSize = clamp(Math.floor(input.batchSize || 1), 1, 10)
  const ctx = withJobLevel(input.ctx, input.jobLevel)
  const profile = input.profile ?? batchProfile(input.model ?? 'ideal', input.tier, input.rules, input.serenityPointsPerMount)
  const fopts = { jobLevel: input.jobLevel ?? 1, rules: input.rules, craftableOnly: input.craftableOnly }
  const lines: GaugeCostLine[] = FERTILITY_GAUGES.filter((g) => (profile.points[g] ?? 0) > 0).map((g) => {
    const points = profile.points[g] as number
    const tier = profile.tiers[g] ?? input.tier
    const pc = gaugePointCost(g, tier, ctx, fopts)
    return { gauge: g, tier, pointsPerBatch: points, pointCost: pc, costPerBatch: lineCost(points, pc), upperPerBatch: lineUpper(points, pc), complete: pc.complete, estimated: pc.estimated }
  })
  const complete = lines.every((l) => l.complete)
  const known = lines.reduce((s, l) => s + (l.costPerBatch ?? 0), 0)
  const perBatch = complete || known > 0 ? known : null
  const perBatchHigh = lines.every((l) => l.upperPerBatch !== null) ? lines.reduce((s, l) => s + (l.upperPerBatch as number), 0) : null
  return {
    lines,
    perBatch,
    perMount: perBatch === null ? null : perBatch / batchSize,
    perBatchHigh,
    perMountHigh: perBatchHigh === null ? null : perBatchHigh / batchSize,
    complete,
    estimated: lines.some((l) => l.estimated),
    missing: uniq(lines.flatMap((l) => (l.complete ? [] : l.pointCost.missing))),
    batchSize,
    serenityPoints: profile.serenityPoints,
    secondsPerBatch: profile.seconds,
    profile,
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
  /** Borne haute du coût du lot (null si inconnue). */
  costPerBatchHigh: number | null
  complete: boolean
  estimated: boolean
  missing: number[]
  /** Durée à palier constant (×½ avec Sage). */
  secondsPerBatch: number
}

/** Coût et durée pour monter un lot de montures du niveau `fromLevel` au niveau `toLevel` (Mangeoire). */
export function levelingCost(fromLevel: number, toLevel: number, input: LevelingInput): LevelingCost {
  const batchSize = clamp(Math.floor(input.batchSize || 1), 1, 10)
  const xp = mountXpBetween(Math.max(1, fromLevel), Math.max(1, toLevel))
  const points = xp / (input.sage ? 2 : 1)
  const pc = bestFuel('mangeoire', input.tier, withJobLevel(input.ctx, input.jobLevel), { jobLevel: input.jobLevel ?? 1, rules: input.rules, craftableOnly: input.craftableOnly })
  const costPerBatch = points === 0 ? 0 : lineCost(points, pc)
  const complete = points === 0 || pc.complete
  return {
    xpPerMount: xp,
    pointsPerBatch: points,
    pointCost: pc,
    costPerBatch,
    costPerMount: costPerBatch === null ? null : costPerBatch / batchSize,
    costPerBatchHigh: points === 0 ? 0 : lineUpper(points, pc),
    complete,
    estimated: points > 0 && pc.estimated,
    missing: complete ? [] : pc.missing,
    secondsPerBatch: (points / input.rules.gaugeRatePerTick[input.tier]) * TICK_SECONDS,
  }
}

// ---------- Socle des paliers ≥ 2 (investissement initial) ----------

export interface SocleItem {
  fuelId: number
  name: string
  count: number
  unitPrice: number | null
  subtotal: number | null
  complete: boolean
}

export interface SocleLine {
  gauge: GaugeId
  tier: FuelTier
  /** Points du socle par enclos (jauge vide → bas du palier). */
  pointsPerPaddock: number
  paddocks: number
  items: SocleItem[]
  /** Coût pour tous les enclos (borne basse si incomplet ; null si rien n'est chiffré). */
  cost: number | null
  complete: boolean
  /** Coût incomplet : borne haute chiffrée (souvent un Élixir estimé), null si inconnue. */
  upperBound: number | null
  missing: number[]
}

export interface InitialInvestment {
  lines: SocleLine[]
  paddocks: number
  /** Somme connue (borne basse si incomplet). */
  total: number
  complete: boolean
  low: number
  high: number | null
  missing: number[]
}

/**
 * Socle des paliers ≥ 2, une seule fois par enclos utilisé : remonter chaque jauge vide jusqu'au bas
 * du palier qu'elle entretient (sinon elle tourne au palier inférieur). Même calcul que la page Enclos
 * (`refillAdvice`, paddockAssign.ts, sur une jauge vide) ; ces points restent dans la jauge après le
 * cycle : c'est un investissement, pas un coût récurrent.
 */
export function socleInvestment(
  consumed: Partial<Record<GaugeId, number>>,
  tiers: Partial<Record<GaugeId, FuelTier>>,
  paddocks: number,
  opts: { ctx: PriceContext; rules: Ruleset; jobLevel: number; tier: FuelTier },
): InitialInvestment {
  const n = Math.max(0, Math.floor(paddocks))
  const empty = Object.fromEntries(GAUGE_IDS.map((g) => [g, 0])) as Record<GaugeId, number>
  const adv = refillAdvice({ gauges: empty }, { consumed, tiers }, { ctx: withJobLevel(opts.ctx, opts.jobLevel), rules: opts.rules, jobLevel: opts.jobLevel, tier: opts.tier })
  const lines: SocleLine[] = []
  for (const l of adv.lines) {
    const b = l.base
    if (!b || !b.feasible || b.reached <= b.from || n === 0) continue
    const items: SocleItem[] = b.items.map((it) => {
      const count = it.count * n
      const unit = it.option.unitPrice
      return { fuelId: it.option.fuel.id, name: it.option.fuel.name, count, unitPrice: unit, subtotal: unit === null ? null : unit * count, complete: it.option.complete && unit !== null }
    })
    const ub = b.complete ? b.cost : (b.upperBound?.cost ?? null)
    lines.push({
      gauge: l.gauge,
      tier: l.tier,
      pointsPerPaddock: b.reached - b.from,
      paddocks: n,
      items,
      cost: b.cost === null ? null : b.cost * n,
      complete: b.complete,
      upperBound: ub === null ? null : ub * n,
      missing: b.missing,
    })
  }
  const total = lines.reduce((s, l) => s + (l.cost ?? 0), 0)
  const complete = lines.every((l) => l.complete)
  let high: number | null = 0
  for (const l of lines) high = high === null ? null : l.complete ? high + (l.cost ?? 0) : l.upperBound === null ? null : high + l.upperBound
  return { lines, paddocks: n, total, complete, low: total, high, missing: uniq(lines.flatMap((l) => (l.complete ? [] : l.missing))) }
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
  /** Prix de craft d'un filet que vous ne savez pas fabriquer (estimation du prix HDV). */
  craftLocked?: number
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
  const p = resolvePrice(net.id, withJobLevel(ctx, opts.jobLevel))
  const craftLocked = p.origin === 'craft' ? p.craftLocked : undefined
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
    craftLocked,
    note: `${def.note} La valeur des ressources droppées pendant le combat n'est pas déduite.${craftLocked ? ` Prix de craft (niv. ${craftLocked} requis) : saisissez son prix HDV.` : ''}`,
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
  /** Prix de craft d'une makina que vous ne savez pas fabriquer (niveau requis) : estimation du prix HDV. */
  craftLocked?: number
}

/**
 * Coût d'une makina (prix HDV ou coût des ingrédients ; recette bêta en 3.7 quand elle existe). Avec
 * `ctx.jobLevel`, une makina hors de portée du métier est payée au prix HDV (le craft n'est qu'une
 * estimation, `craftLocked`). La génération demandée est bornée à 2 … 10.
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
    const locked = !canCraftRecipe(makina.id, ctx)
    if (market.price !== null && (locked || !complete || market.price <= total))
      return { makina, price: market.price, complete: true, origin: market.origin, missing: [], beta37: true }
    return { makina, price: complete || total > 0 ? total : null, complete, origin: 'craft', missing: uniq(missing), beta37: true, craftLocked: locked ? makina.level : undefined }
  }
  const p = resolvePrice(makina.id, ctx)
  return {
    makina,
    price: p.price !== null && (p.complete || p.price > 0) ? p.price : null,
    complete: p.complete && p.price !== null,
    origin: p.origin,
    missing: p.complete ? [] : p.missing.length ? p.missing : [makina.id],
    beta37: false,
    craftLocked: p.origin === 'craft' ? p.craftLocked : undefined,
  }
}

// ---------- Optimakina : même règle que l'Accouplement ----------

/** auto = règle de prix (C_eff × Δ / p), à défaut heuristique G6+/objectif ; toujours ; jamais. */
export type OptimakinaMode = 'auto' | 'toujours' | 'jamais'

export const OPTIMAKINA_MODE_LABELS: Record<OptimakinaMode, string> = {
  auto: 'Auto (règle de prix, sinon dès la G6, ou G4–G5 sur l’objectif)',
  toujours: 'À chaque accouplement',
  jamais: 'Jamais',
}

/** Cible à partir de laquelle la recherche recommande l'Optimakina systématique (strategy.md §5.3, M-OPTI-01). */
export const OPTIMAKINA_HEURISTIC_GENERATION = 6

/**
 * Étapes de l'objectif G4–G5 : Optimakina « à défaut de prix » seulement (phase P2 de la recherche :
 * « Optimakina sur G4–G5 seulement si son prix < seuil ») ; jamais en G2–G3 sans prix. Constante
 * partagée avec l'Accouplement (`pairing.adviseOptimakina`), pour que les deux règles ne divergent pas.
 */
export const OPTIMAKINA_GOAL_STEP_GENERATION = 4

/**
 * Heuristique de la recherche quand la règle de prix est indécidable (prix ou C_eff inconnus) :
 * Optimakina dès la cible G6 ; sur une étape G4–G5 de l'objectif ; jamais en G2–G3 sans prix.
 * Utilisée par `decideOptimakina` (Rentabilité, classement des croisements) et par
 * `pairing.adviseOptimakina` (Accouplement, Accueil).
 */
export function optimakinaHeuristicUse(targetGeneration: number, goalRelevant: boolean): boolean {
  return targetGeneration >= OPTIMAKINA_HEURISTIC_GENERATION || (goalRelevant && targetGeneration >= OPTIMAKINA_GOAL_STEP_GENERATION)
}

/** Réglage → mode : `true` (réglage « Optimakina ») = 'auto', comme l'Accouplement ; `false` = 'jamais'. */
export function optimakinaMode(v: boolean | OptimakinaMode | undefined): OptimakinaMode {
  if (v === undefined || v === true) return 'auto'
  if (v === false) return 'jamais'
  return v
}

export interface OptimakinaDecision {
  use: boolean
  mode: OptimakinaMode
  basis: 'regle-prix' | 'heuristique' | 'reglage' | 'jamais' | 'inutile'
  /** Hausse effective de la chance de cible. */
  gain: number
  generation: number
  price: number | null
  priceComplete: boolean
  /** C_eff : coût net d'un couple (obtention + fécondation + XP − valeur résiduelle des stériles). */
  coupleCost: number | null
  /** Prix maximal rentable = C_eff × Δ / p. */
  threshold: number | null
  reason: string
}

export interface OptimakinaDecisionInput {
  mode: OptimakinaMode
  /** Résultat sans makina. */
  base: BreedingResult
  /** Résultat avec Optimakina (null si elle ne change rien). */
  withOpti: BreedingResult | null
  price: number | null
  priceComplete: boolean
  coupleCost: number | null
  goalRelevant?: boolean
}

const pctTxt = (x: number) => `${Math.round(x * 1000) / 10} %`.replace('.', ',')

/**
 * Optimakina ou non (research/README.md §2.9 « rentable si prix < C_eff × Δ / p », strategy.md §5.3) —
 * même règle que le conseil de l'Accouplement (pairing.adviseOptimakina avec C_eff) : règle de prix
 * quand le prix et C_eff sont connus (prix incomplet déjà au-dessus du seuil : non) ; sinon heuristique
 * de la recherche : Optimakina dès la cible G6 ou sur une étape de l'objectif.
 */
export function decideOptimakina(input: OptimakinaDecisionInput): OptimakinaDecision {
  const { base, withOpti, mode } = input
  const gain = withOpti ? Math.max(0, withOpti.targetChance - base.targetChance) : 0
  const p = base.targetChance
  const threshold = input.coupleCost !== null && p > 0 && gain > 0 ? (input.coupleCost * gain) / p : null
  const common = { mode, gain, generation: (withOpti ?? base).makinaGenerationRequired, price: input.price, priceComplete: input.priceComplete, coupleCost: input.coupleCost, threshold }
  if (gain <= 1e-9) return { ...common, use: false, basis: 'inutile', reason: 'Optimakina inutile : la génération cible est déjà certaine.' }
  if (mode === 'jamais') return { ...common, use: false, basis: 'jamais', reason: 'Optimakina désactivée (choix « jamais »).' }
  if (mode === 'toujours') return { ...common, use: true, basis: 'reglage', reason: `Optimakina à chaque accouplement (choix « toujours ») : +${pctTxt(gain)} de génération cible.` }
  const heuristic = (why: string): OptimakinaDecision => {
    const t = base.targetGeneration
    const goal = !!input.goalRelevant
    if (!optimakinaHeuristicUse(t, goal))
      return {
        ...common,
        use: false,
        basis: 'heuristique',
        reason: `Pas d’Optimakina : ${why}cible G${t}${goal ? ', étape de votre objectif mais de génération basse' : ' sans enjeu particulier'} — sans prix sous le seuil, la recherche la réserve aux cibles G${OPTIMAKINA_HEURISTIC_GENERATION} et plus${goal ? ` (G${OPTIMAKINA_GOAL_STEP_GENERATION}–G5 pour les étapes de l’objectif)` : ''}.`,
      }
    return t >= OPTIMAKINA_HEURISTIC_GENERATION
      ? {
          ...common,
          use: true,
          basis: 'heuristique',
          reason: `Optimakina conseillée : ${why}cible G${t}${goal ? ', étape de votre objectif' : ''} — la recherche la recommande dès la cible G${OPTIMAKINA_HEURISTIC_GENERATION} (+${pctTxt(gain)} de cible).`,
        }
      : {
          ...common,
          use: true,
          basis: 'heuristique',
          reason: `Optimakina conseillée à défaut de prix : ${why}cible G${t}, étape de votre objectif — la recherche la réserve aux étapes G${OPTIMAKINA_GOAL_STEP_GENERATION}–G5 dont le prix reste sous le seuil ; saisissez son prix pour trancher (+${pctTxt(gain)} de cible).`,
        }
  }
  if (threshold !== null && input.price !== null) {
    if (input.priceComplete)
      return input.price < threshold
        ? { ...common, use: true, basis: 'regle-prix', reason: `Optimakina rentable : prix ${fmtK(input.price)} < seuil ${fmtK(threshold)} (C_eff × Δ / p ; +${pctTxt(gain)} de cible).` }
        : { ...common, use: false, basis: 'regle-prix', reason: `Optimakina non rentable ici : prix ${fmtK(input.price)} ≥ seuil ${fmtK(threshold)} (C_eff × Δ / p).` }
    if (input.price >= threshold)
      return { ...common, use: false, basis: 'regle-prix', reason: `Optimakina non rentable ici : la partie connue de son coût (≥ ${fmtK(input.price)}) dépasse déjà le seuil ${fmtK(threshold)}.` }
    return heuristic('coût de l’Optimakina incomplet (règle de prix indécidable), ')
  }
  return heuristic(input.price === null ? 'prix de l’Optimakina inconnu, ' : 'coût du couple incomplet (règle de prix indécidable), ')
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
  /** Valeur des génétons, nette de la taxe de revente des parchemins si `saleTax` est fourni. */
  genetonsValue: number
  makinaCost: number
  makinaComplete: boolean
  /** Bébés + génétons − makina (borne si incomplet). */
  expectedNet: number
  complete: boolean
}

/**
 * Valeur attendue d'un accouplement : Σ P(bébé) × valeur (bébés au niveau 1), génétons × valeur
 * (× (1 − taxe) : ils se valorisent en parchemins revendus à l'HDV), moins la makina.
 */
export function matingEconomics(
  result: BreedingResult,
  opts: {
    valueOf: (speciesId: number, level: number) => number | null
    makinaCost?: { price: number | null; complete: boolean } | null
    genetonValue: number
    /** Taxe d'HDV appliquée aux génétons (défaut 0 : valeur brute, ancien comportement). */
    saleTax?: number
  },
): MatingEconomics {
  const outcomes: MatingOutcomeValue[] = result.outcomes.map((o) => {
    const unit = opts.valueOf(o.speciesId, 1)
    const expected = o.probability * result.babies
    return { speciesId: o.speciesId, probability: o.probability, expected, unitValue: unit, subtotal: unit === null ? null : unit * expected }
  })
  const missingSpecies = outcomes.filter((o) => o.unitValue === null && o.probability > 0).map((o) => o.speciesId)
  const expectedBabyValue = outcomes.reduce((s, o) => s + (o.subtotal ?? 0), 0)
  const genetonsValue = result.expectedGenetons * opts.genetonValue * (1 - clamp(opts.saleTax ?? 0, 0, 1))
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

// ---------- Parents engagés et stériles ----------

/** Arbre supposé d'une espèce : son premier croisement connu (capturée : aucun parent). */
export function assumedParents(speciesId: number): number[] {
  const sp = getSpecies(speciesId)
  if (!sp || sp.generation <= 1 || !sp.crossings.length) return []
  return [...sp.crossings[0]]
}

type Valuer = (id: number, level: number, state: MountState) => MountValuation

interface Bounded {
  /** Valeur affichée (borne basse si incomplet ; null si inconnue). */
  value: number | null
  low: number
  high: number | null
  complete: boolean
}

const boundedOf = (v: MountValuation): Bounded => ({
  value: v.best,
  low: v.best ?? 0,
  // Vente seulement plafonnée par le marché (HDV mixte) : borne haute connue (`bestHigh`).
  high: v.complete && v.best !== null ? v.best : (v.bestHigh ?? null),
  complete: v.complete && v.best !== null,
})

export interface SterileOption {
  /** Valeur nette par stérile retenue (borne basse si incomplet ; null si inconnue). */
  unit: number | null
  low: number
  high: number | null
  complete: boolean
  fate: FateKind | 'clone' | null
  confidence: string
  estimated: boolean
  /** Valeur directe (vente / extraction / brisage au niveau des parents). */
  direct: MountValuation
  /** Option clonage : ½ × (valeur d'un clone fertile niv. 1 − coût de refécondation). */
  clone: Bounded
  note?: string
}

/**
 * Valeur d'une stérile (strategy.json → formulas.sterileValue) : max(vente, G × ressource, brisage,
 * ½ × (valeur du clone fertile − coût de refécondation)). Deux stériles de même génération donnent un
 * clone fertile (l'une des deux) : chaque stérile vaut la moitié d'un clone. Le clone est valorisé au
 * niveau 1 (niveau conservé au clonage inconnu, research §4 n° 10). `force: 'cloner'` impose le clonage.
 */
export function sterileValue(
  speciesId: number,
  level: number,
  refecund: { low: number; high: number | null },
  val: Valuer,
  force?: 'cloner',
): SterileOption {
  const direct = val(speciesId, level, 'sterile')
  const d = boundedOf(direct)
  const cv = val(speciesId, 1, 'fertile')
  const c = boundedOf(cv)
  const cloneLow = refecund.high === null ? 0 : 0.5 * Math.max(0, c.low - refecund.high)
  const cloneHigh = c.high === null ? null : 0.5 * Math.max(0, c.high - refecund.low)
  const cloneComplete = c.complete && refecund.high !== null && Math.abs(refecund.high - refecund.low) < 1e-6
  const clone: Bounded = { value: refecund.high === null ? null : cloneLow, low: cloneLow, high: cloneHigh, complete: cloneComplete }
  const cloneNote = '2 stériles de même génération → 1 clone fertile : ½ × (valeur du clone niv. 1 − coût de refécondation) par stérile.'
  if (force === 'cloner')
    return { unit: clone.value, low: clone.low, high: clone.high, complete: clone.complete, fate: 'clone', confidence: 'low', estimated: true, direct, clone, note: cloneNote }
  const useClone = clone.value !== null && clone.low > d.low + 1e-9
  const high = d.high === null || clone.high === null ? null : Math.max(d.high, clone.high)
  const low = Math.max(d.low, clone.low)
  return {
    unit: useClone ? clone.value : d.value,
    low,
    high,
    complete: d.complete && clone.complete,
    fate: useClone ? 'clone' : direct.bestKind,
    confidence: useClone ? 'low' : direct.confidence,
    estimated: useClone || direct.estimated,
    direct,
    clone,
    note: useClone ? cloneNote : undefined,
  }
}

// ---------- Rentabilité d'un cycle ----------

export type SterileFate = 'meilleur' | 'cloner'

/** Parents engagés : comptés (capture ou valeur actuelle = coût d'opportunité ; stériles en revenu) ou ignorés. */
export type ParentValueMode = 'opportunite' | 'hors'

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
  /** Palier entretenu sur les jauges de statistiques. */
  tier: FuelTier
  /** Palier de la Mangeoire (défaut : tier). */
  xpTier?: FuelTier
  /** Montures par enclos (1 … 10). */
  batchSize: number
  /** Enclos utilisés en parallèle (défaut 1). */
  paddocks?: number
  /** Optimakina : 'auto' (= true, règle de l'Accouplement), 'toujours', 'jamais' (= false). */
  optimakina: boolean | OptimakinaMode
  takeza?: boolean
  /** Compter le coût des filets pour les parents de génération 1 capturables. */
  includeCapture: boolean
  netKind?: NetKind
  mountsPerCast?: number
  saleTax: number
  /** Points de sérénité par lot (défaut : ceux du modèle de lot). */
  serenityPointsPerMount?: number
  sterileFate?: SterileFate
  /** Mangeoire en 2e jauge pendant la phase d'amour (défaut true). */
  xpDuringFertility?: boolean
  sage?: boolean
  /** Modèle de lot (défaut 'typique' : moyennes du planificateur). */
  batchModel?: BatchModel
  /** Profil de lot explicite (prioritaire), ex. `batchProfileFromPlans` (vos lots). */
  batchProfile?: BatchProfile
  /** Parents engagés (défaut 'opportunite'). */
  parentValue?: ParentValueMode
  /** Origine de la valeur du généton (défaut 'defaut' : estimation de la recherche ; 'marche' : HDV du serveur). */
  genetonOrigin?: 'joueur' | 'marche' | 'defaut'
  /**
   * Part du volume quotidien moyen d'un objet que vos ventes peuvent prendre (défaut 0,15 ; réglage du
   * serveur `maxMarketShare`) : au-delà, avertissement de liquidité (`liquidity`).
   */
  maxMarketShare?: number
  /** Espèces de l'objectif et de son chemin (heuristique Optimakina « étape de l'objectif »). */
  goalPath?: Iterable<number>
  ctx: PriceContext
  mountPrices: MountPriceContext
  rules: Ruleset
  jobLevel: number
  /** Valeur brute d'un généton (avant la taxe de revente du parchemin). */
  genetonValue: number
}

export type CostCategory = 'fecondite' | 'xp' | 'makina' | 'capture' | 'parents'

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  fecondite: 'Fécondité (carburants)',
  xp: 'XP des parents (Mangeoire)',
  makina: 'Makinas',
  capture: 'Captures (filets)',
  parents: 'Parents engagés (valeur actuelle)',
}

/** Catégories payées en kamas (le reste est une valeur engagée, pas une dépense). */
export const CASH_CATEGORIES: CostCategory[] = ['fecondite', 'xp', 'makina', 'capture']

export interface MaterialLine {
  key: string
  category: CostCategory
  label: string
  gauge?: GaugeId
  /** Palier entretenu (carburants). */
  tier?: FuelTier
  speciesId?: number
  /** Objet à acheter ou fabriquer (null : estimation au point sans objet précis). */
  itemId: number | null
  itemName: string
  /** Quantité (objets entiers, montures, ou points si unit = 'point'). */
  qty: number
  unit: 'objet' | 'point' | 'monture'
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
  /** Prix de craft d'un objet que vous ne savez pas fabriquer (niveau requis). */
  craftLocked?: number
  /** Prix par défaut retenu, contredit par vos prix d'ingrédients (message à afficher). */
  conflict?: string
  /** Borne basse du sous-total (≥ 0). */
  low: number
  /** Borne haute du sous-total (null si inconnue). */
  high: number | null
}

export interface RevenueLine {
  key: string
  kind: 'bebe' | 'sterile' | 'genetons'
  speciesId?: number
  label: string
  /** Quantité attendue (bébés, stériles ou génétons). */
  qty: number
  probability?: number
  /** Bébé de la génération cible. */
  target?: boolean
  unitValue: number | null
  subtotal: number | null
  complete: boolean
  fate?: FateKind | 'clone' | null
  confidence?: string
  note?: string
  /** Valeur reposant sur une estimation (prix interpolé, clonage, valeur du généton par défaut). */
  estimated?: boolean
  /**
   * Vente sans prix utilisable : référence affichée (nette, par unité), jamais comptée. `kind: 'marche'` :
   * prix de l'objet-monture à l'HDV du serveur (plafond de vente, « HDV mixte »).
   */
  reference?: { net: number; reason: string; kind?: MountPriceReference['kind'] }
  low: number
  high: number | null
}

export interface CategoryTotal {
  value: number
  complete: boolean
  /** Borne haute (null si inconnue). */
  high: number | null
}

export type ProfitStatus = 'exact' | 'intervalle' | 'borne-haute' | 'borne-basse' | 'inconnu'

export interface UnpricedFertility {
  /** Points de jauge de fécondité sans prix complet (sur tout le cycle). */
  points: number
  totalPoints: number
  /** Part des points non chiffrés (0 … 1). */
  share: number
  /** Points non chiffrés sans aucune borne haute. */
  unboundedPoints: number
  gauges: GaugeId[]
  /** Jauges non chiffrées sans aucune borne haute. */
  unboundedGauges: GaugeId[]
}

export interface CycleResult {
  breed: BreedingResult
  /** Résultat sans makina (comparaison). */
  breedWithout: BreedingResult
  mounts: number
  batches: number
  rounds: number
  /** Enclos demandés, utilisés en parallèle, débloqués au niveau d'Éleveur. */
  paddocks: number
  paddocksUsed: number
  unlockedPaddocks: number
  batch: BatchProfile
  materials: MaterialLine[]
  costByCategory: Record<CostCategory, CategoryTotal>
  /** Somme des coûts connus, parents engagés compris (borne basse si incomplet). */
  totalCost: number
  /** Dépenses en kamas (carburants, makinas, filets), sans les parents engagés. */
  materialCost: number
  costComplete: boolean
  revenue: RevenueLine[]
  totalRevenue: number
  revenueComplete: boolean
  /** Bénéfice sur les montants connus (voir `ranges.profit` et `profitStatus` pour l'afficher). */
  profit: number
  profitPerPair: number
  complete: boolean
  /** Une valeur retenue est une estimation (indice de coût au point, prix interpolé, clonage…). */
  estimated: boolean
  /** Libellés des estimations utilisées. */
  estimates: string[]
  ranges: { cost: Range; revenue: Range; profit: Range; kamasPerHour: Range; roi: Range }
  profitStatus: ProfitStatus
  unpricedFertility: UnpricedFertility
  /** Socle des paliers ≥ 2 : investissement unique (reste dans les jauges), hors bénéfice récurrent. */
  initial: InitialInvestment
  /** Trésorerie du 1er cycle : dépenses + socle. */
  firstCycleCash: Range
  seconds: { fertility: number; leveling: number; perRound: number; total: number; idealFertility: number }
  kamasPerHour: number | null
  /** Bénéfice / coût (parents engagés compris). */
  roi: number | null
  expectedTargetBabies: number
  /** Coût brut (dépenses) par bébé de la génération cible. */
  costPerTargetBaby: number | null
  /** (C_A + C_B + makina − R) / bébés cibles, R = bébés ratés + stériles (strategy.json). */
  netCostPerTargetBaby: number | null
  netCostComplete: boolean
  optimakina: OptimakinaDecision
  parentValue: ParentValueMode
  jobXp: number
  missingItems: number[]
  missingSpecies: number[]
  assumptions: string[]
  warnings: string[]
  /**
   * Ventes qu'entraîne le cycle répété en continu (ressources extraites, montures vendues, runes,
   * parchemins des génétons), par jour, face au volume du marché du serveur (`ctx.market`) ; vide sans
   * marché importé. Les dépassements sont aussi dans `warnings`.
   */
  liquidity: LiquidityCheck[]
}

function sumCat(lines: MaterialLine[], cat: CostCategory): CategoryTotal {
  const ls = lines.filter((l) => l.category === cat)
  let high: number | null = 0
  for (const l of ls) high = high === null || l.high === null ? null : high + l.high
  return { value: ls.reduce((s, l) => s + (l.subtotal ?? 0), 0), complete: ls.every((l) => l.complete), high }
}

function sumRange(lines: { low: number; high: number | null }[]): { low: number; high: number | null } {
  let low = 0
  let high: number | null = 0
  for (const l of lines) {
    low += l.low
    high = high === null || l.high === null ? null : high + l.high
  }
  return { low, high }
}

/** Ligne de carburant : objets entiers du palier entretenu (ou coût au point estimé). */
function fuelLine(key: string, category: CostCategory, gauge: GaugeId, points: number, pc: GaugePointCost): MaterialLine {
  const label = `${GAUGE_LABELS[gauge]} — ${fmtN(points)} pts`
  const toPriceRef = pc.toPrice ? { id: pc.toPrice.fuel.id, name: pc.toPrice.fuel.name } : undefined
  if (pc.estimated || !pc.fuel) {
    const subtotal = pc.value === null ? null : pc.value * points
    const upper = pc.bound === 'max' && subtotal !== null ? subtotal : undefined
    return {
      key,
      category,
      label,
      gauge,
      tier: pc.tier,
      itemId: null,
      itemName: `Carburant de ${GAUGE_LABELS[gauge]} (coût au point ${pc.estimated ? 'estimé' : 'inconnu'})`,
      qty: points,
      unit: 'point',
      points,
      unitPrice: pc.value,
      subtotal: pc.bound === 'max' ? null : subtotal,
      complete: pc.complete,
      estimated: pc.estimated,
      origin: pc.origin,
      confidence: pc.confidence,
      missing: pc.missing,
      note: pc.note,
      toPrice: toPriceRef,
      upperBound: upper,
      low: pc.bound === 'max' ? 0 : (subtotal ?? 0),
      high: pc.complete ? subtotal : (upper ?? null),
    }
  }
  if (pc.bound === 'max') {
    // Seul un carburant de palier supérieur est chiffré : l'objet à acheter reste celui du palier
    // entretenu (prix à saisir) ; le palier supérieur ne donne qu'une borne haute.
    const exact = pc.toPrice ?? pc.fuel
    const qty = Math.ceil(points / exact.durability - 1e-9)
    const upperQty = Math.ceil(points / pc.fuel.durability - 1e-9)
    const upper = pc.fuel.unitPrice === null ? null : pc.fuel.unitPrice * upperQty
    return {
      key,
      category,
      label,
      gauge,
      tier: pc.tier,
      itemId: exact.fuel.id,
      itemName: exact.fuel.name,
      qty,
      unit: 'objet',
      points,
      unitPrice: null,
      subtotal: null,
      complete: false,
      estimated: false,
      origin: 'manquant',
      confidence: pc.confidence,
      missing: pc.missing,
      note: upper !== null ? `Prix à saisir. Au plus ${fmtK(upper)} avec ${upperQty} × « ${pc.fuel.fuel.name} » (palier supérieur, sans doute surestimé).` : pc.note,
      toPrice: { id: exact.fuel.id, name: exact.fuel.name },
      upperBound: upper,
      low: 0,
      high: upper,
    }
  }
  const qty = Math.ceil(points / pc.fuel.durability - 1e-9)
  const unit = pc.fuel.unitPrice
  const subtotal = unit === null || (!pc.complete && unit <= 0) ? null : unit * qty
  // Prix de craft d'un carburant hors de portée du métier : estimation du prix HDV (si chiffré).
  const craftLocked = pc.fuel.craftPriceOnly && pc.complete ? pc.fuel.craftLevel : undefined
  const notes = [pc.note, craftLocked ? `Prix de craft (niv. ${craftLocked} d'Éleveur requis) : vous ne pouvez pas le fabriquer, c'est une estimation du prix HDV — saisissez-le.` : undefined].filter(Boolean)
  return {
    toPrice: pc.complete && !craftLocked ? undefined : (toPriceRef ?? { id: pc.fuel.fuel.id, name: pc.fuel.fuel.name }),
    key,
    category,
    label,
    gauge,
    tier: pc.tier,
    itemId: pc.fuel.fuel.id,
    itemName: pc.fuel.fuel.name,
    qty,
    unit: 'objet',
    points,
    unitPrice: unit,
    subtotal,
    complete: pc.complete,
    estimated: !!craftLocked,
    origin: pc.origin,
    confidence: pc.confidence,
    missing: pc.missing,
    note: notes.length ? notes.join(' ') : undefined,
    craftLocked,
    low: subtotal ?? 0,
    high: pc.complete ? subtotal : null,
  }
}

/** Statut d'affichage d'un bénéfice borné. */
function profitStatusOf(r: Range, unpriced: UnpricedFertility): ProfitStatus {
  if (unpriced.unboundedPoints > 0) return 'inconnu'
  if (r.low !== null && r.high !== null) return Math.abs(r.high - r.low) < 0.5 ? 'exact' : 'intervalle'
  if (r.high !== null) return 'borne-haute'
  if (r.low !== null) return 'borne-basse'
  return 'inconnu'
}

/**
 * Rentabilité d'un cycle de production : dépenses (carburants par jauge, makinas, filets), parents
 * engagés (capture ou valeur actuelle), socle (investissement initial), durée, revenus attendus
 * (bébés, stériles, génétons nets de taxe), bénéfice en intervalle, kamas/heure et ROI.
 */
export function cycleProfit(cfg: CycleConfig): CycleResult {
  const rules = cfg.rules
  const ctx = withJobLevel(cfg.ctx, cfg.jobLevel)
  const pairs = Math.max(1, Math.floor(cfg.pairs || 1))
  const batchSize = clamp(Math.floor(cfg.batchSize || 10), 1, 10)
  const paddocks = clamp(Math.floor(cfg.paddocks ?? 1), 1, 6)
  const unlocked = unlockedPaddockCount(cfg.jobLevel)
  const startLevel = clamp(Math.floor(cfg.parentStartLevel ?? 1), 1, 200)
  const parentLevel = clamp(Math.floor(cfg.parentLevel || 1), startLevel, 200)
  const xpTier = cfg.xpTier ?? cfg.tier
  const tax = clamp(cfg.saleTax, 0, 1)
  const parentMode: ParentValueMode = cfg.parentValue ?? 'opportunite'
  const mode = optimakinaMode(cfg.optimakina)
  const warnings: string[] = []
  const assumptions: string[] = []
  const estimates: string[] = []

  const sa = getSpecies(cfg.parentA)
  const sb = getSpecies(cfg.parentB)
  if (!sa || !sb) throw new Error('Espèce de parent inconnue.')
  const treeA = cfg.treeA ?? assumedParents(cfg.parentA)
  const treeB = cfg.treeB ?? assumedParents(cfg.parentB)
  const pa: BreedingParent = { speciesId: cfg.parentA, level: parentLevel, parents: treeA }
  const pb: BreedingParent = { speciesId: cfg.parentB, level: parentLevel, parents: treeB }
  const noMakina = breed(pa, pb, { rules, takeza: cfg.takeza })
  const canOpti = noMakina.targetChance < 1 && noMakina.outcomes.some((o) => !o.isTarget)
  const withOpti = canOpti ? breed(pa, pb, { rules, takeza: cfg.takeza, makina: 'optimakina' }) : null

  const mounts = 2 * pairs
  const batches = Math.ceil(mounts / batchSize)
  const rounds = Math.ceil(batches / paddocks)
  const paddocksUsed = Math.min(batches, paddocks)
  if (paddocks > unlocked)
    warnings.push(
      `Vous n'avez que ${unlocked} enclos débloqué${unlocked > 1 ? 's' : ''} (Éleveur niveau ${cfg.jobLevel}) : la durée et les kamas/heure supposent ${paddocks} enclos en parallèle.`,
    )

  // Lot de fécondité, XP.
  const profile = cfg.batchProfile ?? batchProfile(cfg.batchModel ?? 'typique', cfg.tier, rules, cfg.serenityPointsPerMount)
  const fert = fertilityCost({ tier: cfg.tier, batchSize, ctx, rules, jobLevel: cfg.jobLevel, profile })
  const lvl = levelingCost(startLevel, parentLevel, { tier: xpTier, batchSize, sage: cfg.sage, ctx, rules, jobLevel: cfg.jobLevel })
  const refecund = { low: fert.perMount ?? 0, high: fert.complete ? fert.perMount : fert.perMountHigh }

  // Valorisations (mémorisées).
  const vopts = { ctx, mountPrices: cfg.mountPrices, saleTax: tax }
  const cache = new Map<string, MountValuation>()
  const val: Valuer = (id, level, state) => {
    const k = `${id}|${level}|${state}`
    let v = cache.get(k)
    if (!v) {
      v = mountValuation(id, level, { ...vopts, state })
      cache.set(k, v)
    }
    return v
  }

  // Parents engagés : capture (G1 capturables, si comptée) ou valeur actuelle (coût d'opportunité).
  const parentEntries: [Species, number][] = sa.id === sb.id ? [[sa, 2 * pairs]] : [[sa, pairs], [sb, pairs]]
  const netKind = cfg.netKind ?? 'universel'
  const cc = parentMode === 'opportunite' && cfg.includeCapture ? captureCost(cfg.family, netKind, ctx, { mountsPerCast: cfg.mountsPerCast, jobLevel: cfg.jobLevel }) : null
  const captured = (s: Species) => !!cc && s.generation === 1 && s.capturable
  const fate = cfg.sterileFate ?? 'meilleur'
  const steriles = parentEntries.map(([s, qty]) => ({ s, qty, v: sterileValue(s.id, parentLevel, refecund, val, fate === 'cloner' ? 'cloner' : undefined) }))
  const starts = parentEntries.map(([s, qty]) => ({ s, qty, captured: captured(s), v: boundedOf(val(s.id, startLevel, 'fertile')), raw: val(s.id, startLevel, 'fertile') }))

  // C_eff par couple (règle de prix de l'Optimakina) : obtention + fécondation + XP − stériles.
  let coupleCost: number | null = null
  {
    const fertPair = fert.complete && fert.perMount !== null ? 2 * fert.perMount : null
    const lvlPair = lvl.complete && lvl.costPerMount !== null ? 2 * lvl.costPerMount : null
    let parts: number | null = fertPair !== null && lvlPair !== null ? fertPair + lvlPair : null
    if (parts !== null && parentMode === 'opportunite') {
      for (const st of starts) {
        const share = st.qty / pairs
        const acq = st.captured ? (cc && cc.complete && cc.perMount !== null ? cc.perMount : null) : st.v.complete ? st.v.value : null
        parts = parts === null || acq === null ? null : parts + share * acq
      }
      for (const st of steriles) {
        const share = st.qty / pairs
        parts = parts === null || !st.v.complete || st.v.unit === null ? null : parts - share * st.v.unit
      }
    }
    coupleCost = parts
  }
  const goalSet = cfg.goalPath ? new Set(cfg.goalPath) : null
  const mk = canOpti && withOpti ? makinaCost('optimakina', cfg.family, withOpti.makinaGenerationRequired, ctx, rules) : null
  const decision = decideOptimakina({
    mode,
    base: noMakina,
    withOpti,
    price: mk?.price ?? null,
    priceComplete: !!mk && mk.complete && mk.price !== null,
    coupleCost,
    goalRelevant: !!goalSet && noMakina.targetSpecies.some((id) => goalSet.has(id)),
  })
  const useOpti = decision.use && withOpti !== null
  const result = useOpti && withOpti ? withOpti : noMakina

  const materials: MaterialLine[] = []

  // Fécondité.
  for (const l of fert.lines) materials.push(fuelLine(`fert-${l.gauge}`, 'fecondite', l.gauge, l.pointsPerBatch * batches, l.pointCost))

  // XP des parents.
  if (lvl.pointsPerBatch > 0) materials.push(fuelLine('xp-mangeoire', 'xp', 'mangeoire', lvl.pointsPerBatch * batches, lvl.pointCost))
  // Prix par défaut contredit par vos ingrédients (pricing.resolvePrice → conflict) : signalé sur la ligne.
  for (const l of materials) {
    if (l.itemId === null || l.origin !== 'defaut') continue
    const c = resolvePrice(l.itemId, ctx).conflict
    if (c) {
      l.conflict = c.message
      l.note = [l.note, c.message].filter(Boolean).join(' ')
    }
  }

  // Makinas.
  if (useOpti && mk) {
    const sub = mk.price === null ? null : mk.price * pairs
    materials.push({
      key: 'makina',
      category: 'makina',
      label: `Optimakina G${result.makinaGenerationRequired} × ${pairs}`,
      itemId: mk.makina?.id ?? null,
      itemName: mk.makina?.name ?? `Optimakina G${result.makinaGenerationRequired}`,
      qty: pairs,
      unit: 'objet',
      unitPrice: mk.price,
      subtotal: sub,
      complete: mk.complete,
      estimated: mk.craftLocked !== undefined && mk.complete,
      origin: mk.origin,
      missing: mk.missing,
      craftLocked: mk.craftLocked,
      note: [mk.beta37 ? 'Recette bêta 3.7.' : '', mk.craftLocked ? `Prix de craft (niv. ${mk.craftLocked} requis) : estimation du prix HDV.` : '', decision.reason].filter(Boolean).join(' '),
      low: sub ?? 0,
      high: mk.complete ? sub : null,
    })
  }

  // Parents : captures et valeur actuelle.
  if (parentMode === 'opportunite') {
    const toCapture = starts.filter((st) => st.captured).reduce((s, st) => s + st.qty, 0)
    if (cc && toCapture > 0) {
      const casts = Math.ceil(toCapture / cc.mountsPerCast)
      const sub = cc.unitPrice === null ? null : cc.unitPrice * casts
      materials.push({
        key: 'capture',
        category: 'capture',
        label: `${toCapture} capture(s), ${cc.mountsPerCast} monture(s) par lancer`,
        itemId: cc.net?.id ?? null,
        itemName: cc.net?.name ?? NET_KIND_LABELS[netKind],
        qty: casts,
        unit: 'objet',
        unitPrice: cc.unitPrice,
        subtotal: sub,
        complete: cc.complete,
        estimated: cc.confidence === 'low' || cc.craftLocked !== undefined,
        origin: cc.origin,
        confidence: cc.confidence,
        missing: cc.missing,
        craftLocked: cc.craftLocked,
        note: cc.note,
        low: sub ?? 0,
        high: cc.complete ? sub : null,
      })
      if (!cc.canEquip) warnings.push(`${cc.net?.name ?? 'Ce filet'} demande le niveau ${cc.requiredLevel} d'Éleveur pour être équipé.`)
    }
    for (const st of starts.filter((x) => !x.captured)) {
      const sub = st.v.value === null ? null : st.v.value * st.qty
      const ref = st.raw.sale.reference
      materials.push({
        key: `parent-${st.s.id}`,
        category: 'parents',
        label: `${st.s.name} fertile niv. ${startLevel} × ${st.qty}`,
        speciesId: st.s.id,
        itemId: null,
        itemName: `${st.s.name} (parent engagé)`,
        qty: st.qty,
        unit: 'monture',
        unitPrice: st.v.value,
        subtotal: sub,
        complete: st.v.complete,
        estimated: true,
        origin: st.raw.bestKind ? `valeur actuelle (${FATE_LABELS[st.raw.bestKind].toLowerCase()})` : 'valeur inconnue',
        confidence: st.raw.confidence,
        missing: [],
        note: `Coût d'opportunité : ce que vos parents vaudraient vendus, extraits ou brisés aujourd'hui (l'accouplement les rend stériles).${st.v.complete ? '' : ` Valeur minimale : ${ref ? ref.reason : 'prix de vente à saisir.'}`}`,
        low: st.v.low * st.qty,
        high: st.v.high === null ? null : st.v.high * st.qty,
      })
    }
  }

  // Revenus.
  const revenue: RevenueLine[] = []
  for (const o of result.outcomes) {
    const v = val(o.speciesId, 1, 'fertile')
    const b = boundedOf(v)
    const qty = pairs * result.babies * o.probability
    revenue.push({
      key: `bebe-${o.speciesId}`,
      kind: 'bebe',
      speciesId: o.speciesId,
      label: getSpecies(o.speciesId)?.name ?? `#${o.speciesId}`,
      qty,
      probability: o.probability,
      target: o.isTarget,
      unitValue: v.best,
      subtotal: v.best === null ? null : v.best * qty,
      complete: b.complete,
      fate: v.bestKind,
      confidence: v.confidence,
      note: o.isTarget ? 'Génération cible' : undefined,
      estimated: v.estimated,
      reference: !b.complete && v.sale.reference ? { net: v.sale.reference.net, reason: v.sale.reference.reason, kind: v.sale.reference.kind } : undefined,
      low: b.low * qty,
      high: b.high === null ? null : b.high * qty,
    })
  }
  if (parentMode === 'opportunite')
    for (const st of steriles) {
      const v = st.v
      const ref = v.direct.sale.reference
      revenue.push({
        key: `sterile-${st.s.id}`,
        kind: 'sterile',
        speciesId: st.s.id,
        label: v.fate === 'clone' ? `${st.s.name} stérile (gardée pour cloner)` : `${st.s.name} stérile niv. ${parentLevel}`,
        qty: st.qty,
        unitValue: v.unit,
        subtotal: v.unit === null ? null : v.unit * st.qty,
        complete: v.complete,
        fate: v.fate,
        confidence: v.confidence,
        note: v.note,
        estimated: v.estimated,
        reference: !v.complete && ref && v.fate !== 'clone' ? { net: ref.net, reason: ref.reason, kind: ref.kind } : undefined,
        low: v.low * st.qty,
        high: v.high === null ? null : v.high * st.qty,
      })
    }
  const expectedGenetons = pairs * result.expectedGenetons
  if (expectedGenetons > 0) {
    const g = PRICES_DEFAULT.genetons
    const unit = cfg.genetonValue * (1 - tax)
    const origin = cfg.genetonOrigin ?? 'defaut'
    const fromDefault = origin === 'defaut'
    revenue.push({
      key: 'genetons',
      kind: 'genetons',
      label: 'Génétons',
      qty: expectedGenetons,
      unitValue: unit,
      subtotal: expectedGenetons * unit,
      complete: true,
      confidence: fromDefault ? g.confidence : origin === 'marche' ? 'medium' : 'joueur',
      estimated: fromDefault,
      note: `Liés au compte : valeur via les parchemins d’Eugène Éton revendus à l’HDV (${fmtK(cfg.genetonValue)} brut, nette de taxe)${fromDefault ? ` — estimation de la recherche, fourchette ${fmtK(g.range[0])} → ${fmtK(g.range[1])}` : origin === 'marche' ? ' — meilleur échange de la boutique au prix du marché du serveur' : ''}.`,
      low: expectedGenetons * unit,
      high: expectedGenetons * unit,
    })
  }

  // Socle (paliers ≥ 2) : une fois par enclos utilisé.
  const socleConsumed: Partial<Record<GaugeId, number>> = { ...profile.points }
  const socleTiers: Partial<Record<GaugeId, FuelTier>> = { ...profile.tiers }
  if (lvl.pointsPerBatch > 0) {
    socleConsumed.mangeoire = lvl.pointsPerBatch
    socleTiers.mangeoire = maintainedTier('mangeoire', lvl.pointsPerBatch, xpTier, rules)
  }
  const initial = socleInvestment(socleConsumed, socleTiers, paddocksUsed, { ctx, rules, jobLevel: cfg.jobLevel, tier: cfg.tier })

  // Totaux et intervalles.
  const costByCategory: Record<CostCategory, CategoryTotal> = {
    fecondite: sumCat(materials, 'fecondite'),
    xp: sumCat(materials, 'xp'),
    makina: sumCat(materials, 'makina'),
    capture: sumCat(materials, 'capture'),
    parents: sumCat(materials, 'parents'),
  }
  const totalCost = materials.reduce((s, l) => s + (l.subtotal ?? 0), 0)
  const cash = materials.filter((l) => CASH_CATEGORIES.includes(l.category))
  const materialCost = cash.reduce((s, l) => s + (l.subtotal ?? 0), 0)
  const costComplete = materials.every((l) => l.complete)
  const totalRevenue = revenue.reduce((s, l) => s + (l.subtotal ?? 0), 0)
  const revenueComplete = revenue.every((l) => l.complete)
  const profit = totalRevenue - totalCost
  const complete = costComplete && revenueComplete
  const costR = sumRange(materials)
  const revR = sumRange(revenue)
  const profitR: Range = { low: costR.high === null ? null : revR.low - costR.high, high: revR.high === null ? null : revR.high - costR.low }
  const cashR = sumRange(cash)
  const firstCycleCash: Range = { low: cashR.low + initial.low, high: cashR.high === null || initial.high === null ? null : cashR.high + initial.high }

  // Jauges de fécondité non chiffrées.
  const fertLines = materials.filter((l) => l.category === 'fecondite')
  const totalPoints = fertLines.reduce((s, l) => s + (l.points ?? 0), 0)
  const unpricedLines = fertLines.filter((l) => !l.complete)
  const unpricedPoints = unpricedLines.reduce((s, l) => s + (l.points ?? 0), 0)
  const unpricedFertility: UnpricedFertility = {
    points: unpricedPoints,
    totalPoints,
    share: totalPoints > 0 ? unpricedPoints / totalPoints : 0,
    unboundedPoints: unpricedLines.filter((l) => l.high === null).reduce((s, l) => s + (l.points ?? 0), 0),
    gauges: unpricedLines.map((l) => l.gauge as GaugeId),
    unboundedGauges: unpricedLines.filter((l) => l.high === null).map((l) => l.gauge as GaugeId),
  }

  // Durées.
  const fertSec = profile.seconds
  const xpRateTier = socleTiers.mangeoire ?? xpTier
  const overlap = cfg.xpDuringFertility === false ? 0 : xpOverlapPoints(cfg.tier, xpRateTier, rules, profile.points.dragofesse ?? MOUNT_STAT_MAX)
  const extraXpPoints = Math.max(0, lvl.pointsPerBatch - overlap)
  const levelSec = (extraXpPoints / rules.gaugeRatePerTick[xpRateTier]) * TICK_SECONDS
  const perRound = fertSec + levelSec
  const total = perRound * rounds
  const hours = total / 3600
  const perHour = (x: number | null) => (x === null || hours <= 0 ? null : x / hours)
  const roiOf = (rev: number | null, cost: number | null) => (rev === null || cost === null || cost <= 0 ? null : rev / cost - 1)
  const ranges = {
    cost: costR,
    revenue: revR,
    profit: profitR,
    kamasPerHour: { low: perHour(profitR.low), high: perHour(profitR.high) },
    roi: { low: roiOf(revR.low, costR.high), high: roiOf(revR.high, costR.low) },
  }

  // Liquidité : ventes du cycle répété en continu face au volume du marché du serveur.
  let liquidity: LiquidityCheck[] = []
  const market = ctx.market ?? null
  if (market && total > 0) {
    const cyclesPerDay = 86_400 / total
    const sales: PlannedSale[] = []
    for (const l of revenue) {
      if (l.speciesId === undefined || (l.kind !== 'bebe' && l.kind !== 'sterile')) continue
      const gross = l.unitValue === null ? null : tax < 1 ? l.unitValue / (1 - tax) : null
      sales.push(...salesOfFate(l.speciesId, l.fate, l.qty * cyclesPerDay, ctx, gross))
    }
    const share = cfg.maxMarketShare ?? DEFAULT_MAX_MARKET_SHARE
    liquidity = checkPlannedSales(sales, market, share)
    const gl = genetonLiquidityCheck(expectedGenetons * cyclesPerDay, market, share)
    if (gl) liquidity.push(gl)
    for (const l of liquidity) if (l.exceeds && l.message) warnings.push(`Liquidité (cycle répété en continu) — ${l.message}`)
  }

  // Coût par bébé cible : brut (dépenses) et net (formule de la recherche).
  const targetBabies = pairs * result.babies * result.targetChance
  const residual = revenue.filter((l) => (l.kind === 'bebe' && !l.target) || l.kind === 'sterile')
  const residualValue = residual.reduce((s, l) => s + (l.subtotal ?? 0), 0)
  const netCostPerTargetBaby = targetBabies > 0 ? (totalCost - residualValue) / targetBabies : null

  // Estimations utilisées.
  for (const l of materials)
    if (l.estimated && l.complete && l.category !== 'parents') estimates.push(`${l.gauge ? GAUGE_LABELS[l.gauge] : l.itemName} : ${l.craftLocked ? `prix de craft (niv. ${l.craftLocked} requis)` : 'coût estimé'}`)
  if (materials.some((l) => l.category === 'parents')) estimates.push('Parents engagés : valeur actuelle (coût d’opportunité)')
  if (revenue.some((l) => l.kind !== 'genetons' && l.estimated)) estimates.push('Prix de montures interpolés ou clonage')
  if (revenue.some((l) => l.kind === 'genetons' && l.estimated)) estimates.push('Valeur du généton (défaut de la recherche)')
  if (profile.model !== 'mes-lots') estimates.push(`${profile.label} (consommation et durée moyennes)`)

  const missingItems = uniq([...materials.flatMap((l) => (l.complete ? [] : l.missing)), ...initial.missing])
  const missingSpecies = uniq(revenue.filter((l) => !l.complete && l.speciesId !== undefined && l.unitValue === null).map((l) => l.speciesId as number))

  // Hypothèses.
  const serNote = cfg.serenityPointsPerMount === undefined && profile.model !== 'mes-lots' ? ' (ESTIMATION : sérénité de départ inconnue, research §4 n° 9)' : ''
  assumptions.unshift(
    `Règles du jeu : ${rules.label}.`,
    `${mounts} montures en ${batches} lot(s) de ${batchSize} au plus, ${paddocks} enclos en parallèle (${rounds} tour(s)). La consommation d'une jauge ne dépend pas du nombre de montures : un lot incomplet coûte autant qu'un lot plein.`,
    `Lot de fécondité : ${profile.label}. ${profile.note}`,
    `Fécondité par lot : ${FERTILITY_GAUGES.filter((g) => (profile.points[g] ?? 0) > 0)
      .map((g) => `${GAUGE_LABELS[g]} ${fmtN(profile.points[g] ?? 0)} pts (palier ${profile.tiers[g] ?? cfg.tier})`)
      .join(', ')}${serNote} ; carburant le moins cher au point parmi les paliers ≥ au palier entretenu.`,
    `XP : parents du niveau ${startLevel} au niveau ${parentLevel} (${fmtN(lvl.xpPerMount)} XP chacun) avec la Mangeoire au palier ${xpRateTier}${cfg.sage ? ', capacité Sage (×2)' : ''}${overlap > 0 ? ` ; ≈ ${fmtN(overlap)} points gagnés pendant la phase d'amour (Mangeoire en 2e jauge)` : ''}.`,
    `Durée par tour ≈ fécondité d'un lot (${profile.label.toLowerCase()}) + XP restante ; captures, déplacements et ventes non comptés.`,
    initial.lines.length
      ? `Socle : ${initial.lines.map((l) => `${GAUGE_LABELS[l.gauge]} ${fmtN(l.pointsPerPaddock)} pts`).join(', ')} par enclos (${paddocksUsed} enclos), à déposer une fois : sous le bas du palier, une jauge tourne au palier inférieur. Ces points restent dans la jauge (investissement initial, hors bénéfice récurrent) ; les durées supposent chaque jauge au-dessus du bas de son palier.`
      : 'Aucun socle : toutes les jauges tournent au palier 1.',
    cfg.treeA || cfg.treeB
      ? 'Arbres des parents saisis.'
      : 'Arbres des parents supposés « propres » (issus de leur premier croisement connu ; G1 capturées sans parents).',
    parentMode === 'hors'
      ? 'Hors valeur des parents : ni capture, ni valeur actuelle des parents, ni revenu de leurs stériles (marge de l’accouplement seule).'
      : `Parents engagés : ${starts.some((s) => s.captured) ? 'G1 capturées au prix du filet' : ''}${starts.some((s) => s.captured) && starts.some((s) => !s.captured) ? ' ; ' : ''}${starts.some((s) => !s.captured) ? `valeur actuelle ${starts.some((s) => s.captured) ? 'des autres parents' : 'des parents'} (niveau ${startLevel}, meilleur de vente / extraction / brisage) comptée comme coût d'opportunité` : ''} ; leurs stériles comptent en revenu.`,
    `Bébés valorisés au niveau 1 au meilleur de vente / extraction / brisage, nets de la taxe d'HDV de ${Math.round(tax * 1000) / 10} %. Un prix de vente ne vient que de vos prix ou d'un relevé fiable (planchers et relevés anciens : « à saisir ») ; il est interpolé entre les niveaux 1, 100 et 200.`,
    parentMode === 'hors'
      ? ''
      : fate === 'cloner'
        ? 'Stériles gardées pour le clonage : ½ × (valeur d’un clone fertile niv. 1 − coût de refécondation) par stérile (ESTIMATION, niveau conservé au clonage inconnu).'
        : `Stériles valorisées au meilleur de vente / extraction / brisage au niveau ${parentLevel}, ou de ½ × (clone fertile − refécondation), nettes de taxe.`,
    `Génétons valorisés à ${fmtK(cfg.genetonValue)} pièce (parchemin revendu), nets de la taxe d'HDV.`,
    'Sexe des bébés et des captures supposé 50/50 ; capacités (Reproducteur, Sage…) non valorisées.',
  )
  assumptions.push(decision.reason)
  if (cfg.takeza) assumptions.push('Accouplements le jour Takeza (+20 % de génération cible).')
  if (!costComplete) warnings.push('Coût incomplet : des prix de carburants, makinas, filets ou montures manquent (voir la page Prix).')
  if (!revenueComplete) warnings.push('Revenu incomplet : des prix de montures ou de ressources manquent.')
  for (const w of result.warnings) warnings.push(w)
  if (rules.id === '3.7') warnings.push('Règles 3.7 bêta : valeurs susceptibles de changer.')

  return {
    breed: result,
    breedWithout: noMakina,
    mounts,
    batches,
    rounds,
    paddocks,
    paddocksUsed,
    unlockedPaddocks: unlocked,
    batch: profile,
    materials,
    costByCategory,
    totalCost,
    materialCost,
    costComplete,
    revenue,
    totalRevenue,
    revenueComplete,
    profit,
    profitPerPair: profit / pairs,
    complete,
    estimated: estimates.length > 0,
    estimates: uniq(estimates),
    ranges,
    profitStatus: profitStatusOf(profitR, unpricedFertility),
    unpricedFertility,
    initial,
    firstCycleCash,
    seconds: { fertility: fertSec, leveling: levelSec, perRound, total, idealFertility: fertilitySeconds(cfg.tier, rules, profile.serenityPoints) },
    kamasPerHour: hours > 0 ? profit / hours : null,
    roi: totalCost > 0 ? profit / totalCost : null,
    expectedTargetBabies: targetBabies,
    costPerTargetBaby: targetBabies > 0 ? materialCost / targetBabies : null,
    netCostPerTargetBaby,
    netCostComplete: costComplete && residual.every((l) => l.complete),
    optimakina: decision,
    parentValue: parentMode,
    jobXp: pairs * result.jobXp,
    missingItems,
    missingSpecies,
    assumptions: assumptions.filter(Boolean),
    warnings,
    liquidity,
  }
}

/**
 * Postes inconnus d'un cycle (lignes de coût ou de revenu incomplètes). Deux variantes ne se comparent
 * que si elles ignorent les mêmes postes : sinon l'écart vient des prix manquants, pas du choix.
 */
export function unpricedSignature(r: Pick<CycleResult, 'materials' | 'revenue'>): string {
  return uniq([...r.materials.filter((l) => !l.complete).map((l) => l.key), ...r.revenue.filter((l) => !l.complete).map((l) => l.key)])
    .sort()
    .join(',')
}

/** Les deux résultats chiffrent-ils les mêmes postes (comparaison honnête) ? */
export function cyclesComparable(a: Pick<CycleResult, 'materials' | 'revenue'>, b: Pick<CycleResult, 'materials' | 'revenue'>): boolean {
  return unpricedSignature(a) === unpricedSignature(b)
}

// ---------- Classement des croisements ----------

export interface RankingOptions {
  tier: FuelTier
  xpTier?: FuelTier
  batchSize: number
  parentLevel: number
  parentStartLevel?: number
  /** 'auto' (= true, règle de l'Accouplement), 'toujours', 'jamais' (= false). */
  optimakina: boolean | OptimakinaMode
  takeza?: boolean
  saleTax: number
  serenityPointsPerMount?: number
  /**
   * Compter la valeur ajoutée des parents : stériles après l'accouplement − valeur des parents avant
   * (défaut true). Faux : marge « hors valeur des parents ».
   */
  includeSteriles?: boolean
  /** Modèle de lot (défaut 'typique'). */
  batchModel?: BatchModel
  batchProfile?: BatchProfile
  /** Espèces de l'objectif et de son chemin (heuristique Optimakina). */
  goalPath?: Iterable<number>
  ctx: PriceContext
  mountPrices: MountPriceContext
  rules: Ruleset
  jobLevel: number
  genetonValue: number
  /** Part du volume quotidien moyen vendable (défaut 0,15 ; réglage du serveur `maxMarketShare`). */
  maxMarketShare?: number
  /**
   * Accouplements par jour pour la vérification de liquidité. Défaut : plein régime = enclos débloqués
   * × ⌊lot ÷ 2⌋ couples par tour, tours de fécondité + XP restante du modèle de lot, en continu.
   */
  matingsPerDay?: number
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
  /** Génétons, nets de la taxe d'HDV. */
  genetonsValue: number
  /** Valeur des 2 parents stériles après l'accouplement (meilleur de vente / extraction / brisage / clonage). */
  sterileValue: number
  sterileComplete: boolean
  /** Valeur des 2 parents avant l'accouplement (fertiles, niveau de départ). */
  parentStartValue: number
  /** Valeur ajoutée aux parents = stériles − valeur de départ (comptée si `includeSteriles`). */
  parentDelta: number
  parentComplete: boolean
  /** Fécondité des 2 parents. */
  fertilityCost: number | null
  /** XP des 2 parents. */
  levelingCost: number | null
  makinaCost: number | null
  usesOptimakina: boolean
  optimakina: OptimakinaDecision
  costComplete: boolean
  /** Marge attendue par accouplement (valeurs connues). */
  margin: number
  /** Intervalle de la marge (bornes inconnues = null). */
  marginRange: Range
  complete: boolean
  /** Une valeur retenue est une estimation. */
  estimated: boolean
  jobXp: number
  missingSpecies: number[]
  missingItems: number[]
  /**
   * Avec un marché importé (`ctx.market`) : ventes qu'entraînerait ce croisement à `matingsPerDay`
   * accouplements par jour (bébés et stériles selon leur meilleur devenir, génétons) face au volume du
   * serveur. Absent sans marché.
   */
  liquidity?: LiquidityCheck[]
  /** Un objet dépasse ce que le marché absorbe à ce rythme. */
  liquidityExceeded?: boolean
  /** Rythme retenu pour `liquidity` (accouplements par jour). */
  matingsPerDay?: number
}

/**
 * Accouplements par jour à plein régime : enclos débloqués × ⌊lot ÷ 2⌋ couples, un tour = fécondité
 * du lot + XP restante après la phase d'amour (même calcul que `cycleProfit`), en continu.
 */
export function fullRateMatingsPerDay(opts: { jobLevel: number; batchSize: number; tier: FuelTier; xpTier?: FuelTier; parentLevel: number; parentStartLevel?: number; profile: BatchProfile; rules: Ruleset }): number {
  const rules = opts.rules
  const batchSize = clamp(Math.floor(opts.batchSize || 10), 1, 10)
  const pairsPerRound = unlockedPaddockCount(opts.jobLevel) * Math.max(1, Math.floor(batchSize / 2))
  const start = clamp(Math.floor(opts.parentStartLevel ?? 1), 1, 200)
  const xp = mountXpBetween(start, clamp(Math.floor(opts.parentLevel || 1), start, 200))
  const xpTier = opts.xpTier ?? opts.tier
  const tierM = maintainedTier('mangeoire', xp, xpTier, rules)
  const overlap = xpOverlapPoints(opts.tier, tierM, rules, opts.profile.points.dragofesse ?? MOUNT_STAT_MAX)
  const levelSec = (Math.max(0, xp - overlap) / rules.gaugeRatePerTick[tierM]) * TICK_SECONDS
  const perRound = opts.profile.seconds + levelSec
  return perRound > 0 ? (pairsPerRound * 86_400) / perRound : 0
}

/**
 * Pour chaque croisement de la famille : marge attendue par accouplement = bébés + génétons (nets) +
 * valeur ajoutée aux parents (stériles − valeur de départ) − fécondité − XP − Optimakina (même règle
 * que l'Accouplement en 'auto'). Trié par marge décroissante.
 */
export function crossingRanking(family: FamilyId, opts: RankingOptions): CrossingRank[] {
  const rules = opts.rules
  const ctx = withJobLevel(opts.ctx, opts.jobLevel)
  const batchSize = clamp(Math.floor(opts.batchSize || 10), 1, 10)
  const startLevel = clamp(Math.floor(opts.parentStartLevel ?? 1), 1, 200)
  const parentLevel = clamp(Math.floor(opts.parentLevel || 1), startLevel, 200)
  const includeSteriles = opts.includeSteriles ?? true
  const mode = optimakinaMode(opts.optimakina)
  const tax = clamp(opts.saleTax, 0, 1)
  const profile = opts.batchProfile ?? batchProfile(opts.batchModel ?? 'typique', opts.tier, rules, opts.serenityPointsPerMount)
  const fert = fertilityCost({ tier: opts.tier, batchSize, ctx, rules, jobLevel: opts.jobLevel, profile })
  const lvl = levelingCost(startLevel, parentLevel, { tier: opts.xpTier ?? opts.tier, batchSize, ctx, rules, jobLevel: opts.jobLevel })
  const fertPair = fert.perMount === null ? null : 2 * fert.perMount
  const fertPairHigh = fert.perMountHigh === null ? null : 2 * fert.perMountHigh
  const lvlPair = lvl.costPerMount === null ? null : 2 * lvl.costPerMount
  const lvlPairHigh = lvl.costPerBatchHigh === null ? null : (2 * lvl.costPerBatchHigh) / batchSize
  const refecund = { low: fert.perMount ?? 0, high: fert.complete ? fert.perMount : fert.perMountHigh }
  const goalSet = opts.goalPath ? new Set(opts.goalPath) : null
  const vopts = { ctx, mountPrices: opts.mountPrices, saleTax: tax }
  const cache = new Map<string, MountValuation>()
  const val: Valuer = (id, level, state) => {
    const k = `${id}|${level}|${state}`
    let v = cache.get(k)
    if (!v) {
      v = mountValuation(id, level, { ...vopts, state })
      cache.set(k, v)
    }
    return v
  }
  const sterCache = new Map<number, SterileOption>()
  const ster = (id: number) => {
    let s = sterCache.get(id)
    if (!s) {
      s = sterileValue(id, parentLevel, refecund, val)
      sterCache.set(id, s)
    }
    return s
  }
  const makinaCache = new Map<number, MakinaCost>()
  const market = ctx.market ?? null
  const share = opts.maxMarketShare ?? DEFAULT_MAX_MARKET_SHARE
  const rate = market
    ? (opts.matingsPerDay ?? fullRateMatingsPerDay({ jobLevel: opts.jobLevel, batchSize, tier: opts.tier, xpTier: opts.xpTier, parentLevel, parentStartLevel: startLevel, profile, rules }))
    : 0
  const out: CrossingRank[] = []
  for (const child of speciesOfFamily(family, { breedableOnly: true })) {
    for (const [a, b] of child.crossings) {
      const pa: BreedingParent = { speciesId: a, level: parentLevel, parents: assumedParents(a) }
      const pb: BreedingParent = { speciesId: b, level: parentLevel, parents: assumedParents(b) }
      let base: BreedingResult
      try {
        base = breed(pa, pb, { rules, takeza: opts.takeza })
      } catch {
        continue
      }
      const canOpti = base.targetChance < 1 && base.outcomes.some((o) => !o.isTarget)
      const withOpti = canOpti ? breed(pa, pb, { rules, takeza: opts.takeza, makina: 'optimakina' }) : null
      // Parents : valeur de départ et stériles.
      const startA = boundedOf(val(a, startLevel, 'fertile'))
      const startB = boundedOf(val(b, startLevel, 'fertile'))
      const sA = ster(a)
      const sB = ster(b)
      const parentStartValue = (startA.value ?? 0) + (startB.value ?? 0)
      const sterileValueSum = (sA.unit ?? 0) + (sB.unit ?? 0)
      const parentDelta = sterileValueSum - parentStartValue
      const sterileComplete = sA.complete && sB.complete && sA.unit !== null && sB.unit !== null
      const parentComplete = sterileComplete && startA.complete && startB.complete
      const deltaLow = startA.high === null || startB.high === null ? null : sA.low + sB.low - startA.high - startB.high
      const deltaHigh = sA.high === null || sB.high === null ? null : sA.high + sB.high - startA.low - startB.low
      // Optimakina.
      let mk: MakinaCost | null = null
      if (withOpti) {
        const g = withOpti.makinaGenerationRequired
        mk = makinaCache.get(g) ?? makinaCost('optimakina', family, g, ctx, rules)
        makinaCache.set(g, mk)
      }
      const coupleCost =
        fert.complete && lvl.complete && fertPair !== null && lvlPair !== null
          ? includeSteriles
            ? parentComplete
              ? fertPair + lvlPair - parentDelta
              : null
            : fertPair + lvlPair
          : null
      const decision = decideOptimakina({
        mode,
        base,
        withOpti,
        price: mk?.price ?? null,
        priceComplete: !!mk && mk.complete && mk.price !== null,
        coupleCost,
        goalRelevant: !!goalSet && base.targetSpecies.some((id) => goalSet.has(id)),
      })
      const useOpti = decision.use && withOpti !== null
      const r = useOpti && withOpti ? withOpti : base
      const usedMk = useOpti ? mk : null
      const eco = matingEconomics(r, { valueOf: (id, level) => val(id, level, 'fertile').best, makinaCost: usedMk, genetonValue: opts.genetonValue, saleTax: tax })
      const babyComplete = eco.babyValueComplete && r.outcomes.every((o) => val(o.speciesId, 1, 'fertile').complete)
      let babyHigh: number | null = 0
      for (const o of r.outcomes) {
        const bv = boundedOf(val(o.speciesId, 1, 'fertile'))
        babyHigh = babyHigh === null || bv.high === null ? null : babyHigh + bv.high * o.probability * r.babies
      }
      const costComplete = fert.complete && lvl.complete && (!usedMk || usedMk.complete)
      const mkLow = usedMk?.price ?? 0
      const mkHigh = !usedMk ? 0 : usedMk.complete ? usedMk.price : null
      const margin = eco.expectedBabyValue + eco.genetonsValue + (includeSteriles ? parentDelta : 0) - (fertPair ?? 0) - (lvlPair ?? 0) - mkLow
      const costHigh = fertPairHigh === null || lvlPairHigh === null || mkHigh === null ? null : fertPairHigh + lvlPairHigh + mkHigh
      const revLow = eco.expectedBabyValue + eco.genetonsValue + (includeSteriles ? (deltaLow ?? Number.NaN) : 0)
      const revHigh = babyHigh === null ? null : babyHigh + eco.genetonsValue + (includeSteriles ? (deltaHigh ?? Number.NaN) : 0)
      const marginRange: Range = {
        low: costHigh === null || Number.isNaN(revLow) ? null : revLow - costHigh,
        high: revHigh === null || Number.isNaN(revHigh) ? null : revHigh - (fertPair ?? 0) - (lvlPair ?? 0) - mkLow,
      }
      // Liquidité à plein régime (marché importé seulement).
      let liquidity: LiquidityCheck[] | undefined
      if (market && rate > 0) {
        const sales: PlannedSale[] = []
        const grossOf = (net: number | null) => (net === null || tax >= 1 ? null : net / (1 - tax))
        for (const o of r.outcomes) {
          const v = val(o.speciesId, 1, 'fertile')
          const gross = v.bestKind === 'brisage' ? grossOf(v.brisage.net) : null
          sales.push(...salesOfFate(o.speciesId, v.bestKind, o.probability * r.babies * rate, ctx, gross))
        }
        if (includeSteriles)
          for (const [id, st] of [[a, sA], [b, sB]] as [number, SterileOption][]) {
            const fate = st.fate === 'clone' ? null : st.fate
            sales.push(...salesOfFate(id, fate, rate, ctx, fate === 'brisage' ? grossOf(st.direct.brisage.net) : null))
          }
        liquidity = checkPlannedSales(sales, market, share)
        const gl = genetonLiquidityCheck(r.expectedGenetons * rate, market, share)
        if (gl) liquidity.push(gl)
      }
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
        sterileValue: sterileValueSum,
        sterileComplete,
        parentStartValue,
        parentDelta,
        parentComplete,
        fertilityCost: fertPair,
        levelingCost: lvlPair,
        makinaCost: usedMk ? usedMk.price : null,
        usesOptimakina: useOpti,
        optimakina: decision,
        costComplete,
        margin,
        marginRange,
        complete: costComplete && babyComplete && (!includeSteriles || parentComplete),
        estimated: fert.estimated || lvl.estimated || r.outcomes.some((o) => val(o.speciesId, 1, 'fertile').estimated) || (includeSteriles && (sA.estimated || sB.estimated)),
        jobXp: r.jobXp,
        missingSpecies: eco.missingSpecies,
        missingItems: uniq([...(fert.complete ? [] : fert.missing), ...(lvl.complete ? [] : lvl.missing), ...(usedMk && !usedMk.complete ? usedMk.missing : [])]),
        ...(liquidity ? { liquidity, liquidityExceeded: liquidity.some((l) => l.exceeds), matingsPerDay: rate } : {}),
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
