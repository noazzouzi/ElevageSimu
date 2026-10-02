// Lecture du marché d'un serveur pour l'élevage (export HDV importé) : tableau de bord des prix clés
// avec leurs volumes, « fabriquer ou acheter » pour chaque carburant, makina et filet, marché des
// montures face à la valeur d'extraction (montures séniles probables, montures à vendre plutôt qu'à
// extraire, courbes par génération), comparaison entre serveurs et fraîcheur de l'export.
// Module pur (aucun accès au navigateur ni au store). Spécification : docs/SPEC-v2.md §3 ;
// documentation : docs/api/market.md (« Lecture du marché »).
//
// Règle commune : un prix 0 ou absent n'est jamais compté 0 (null = inconnu, « — » à l'affichage).
import { FAMILIES, FAMILY_IDS, FUELS, MAKINAS, NETS, SPECIES, defaultItemPrice, getRecipe, type FuelRecipe } from '../data'
import { GAUGE_IDS } from './constants'
import { BRISAGE_RUNE, DEFAULT_MOUNTS_PER_CAST, SENILE_PRICE_RATIO, possibleSenile, salesCap, type NetKind } from './economy'
import { fuelDurability } from './fuel'
import {
  DEFAULT_MAX_MARKET_SHARE,
  GENETON_SHOP,
  MARKET_STALE_DAYS,
  PARCHEMIN_ELEVEUR,
  PEPITE,
  RUNE_GA_PA,
  RUNE_GA_PME,
  TOURMALINE,
  TUPLE,
  exportAgeDays,
  frenchDay,
  genetonValueFromMarket,
  marketConfidence,
  marketItemName,
  priceDetail,
  type ConcretePriceStat,
  type MarketSource,
} from './market'
import { craftCost, marketPrice, type PriceContext } from './pricing'
import type { Ruleset } from './rules'
import type { FamilyId, FuelTier, GaugeId, MakinaKind } from './types'
import { craftXp } from './xp'

// ---------- Contexte ----------

/** Ce que la lecture du marché d'un serveur doit connaître. */
export interface InsightContext {
  /** Marché du serveur (`marketSourceOf(snapshot, stat, nom)`). */
  market: MarketSource
  /**
   * Contexte de prix des ingrédients (vos prix > marché > défaut > craft). Défaut : le marché seul
   * (`{overrides: {}, useDefaults: false, market}`). Son `market` est remplacé par `market`.
   */
  ctx?: PriceContext
  rules: Ruleset
  /** Niveau d'Éleveur (peut-on fabriquer ? XP de craft). */
  jobLevel?: number
  /** Taxe de vente à l'HDV (défaut 0,02). */
  saleTax?: number
  /** Part du volume quotidien moyen vendable sans saturer (défaut 0,15 ; réglage du serveur). */
  share?: number
}

interface Resolved {
  market: MarketSource
  ctx: PriceContext
  rules: Ruleset
  jobLevel: number
  tax: number
  share: number
}

function resolve(ic: InsightContext): Resolved {
  const ctx: PriceContext = ic.ctx ? { ...ic.ctx, market: ic.market } : { overrides: {}, useDefaults: false, market: ic.market }
  return {
    market: ic.market,
    ctx: ic.jobLevel !== undefined && ctx.jobLevel === undefined ? { ...ctx, jobLevel: ic.jobLevel } : ctx,
    rules: ic.rules,
    jobLevel: ic.jobLevel ?? ctx.jobLevel ?? 200,
    tax: Math.max(0, Math.min(1, ic.saleTax ?? 0.02)),
    share: Math.max(0, Math.min(1, ic.share ?? DEFAULT_MAX_MARKET_SHARE)),
  }
}

// ---------- Ligne de marché d'un objet ----------

/** Prix et volume d'un objet sur ce serveur. */
export interface MarketLine {
  id: number
  name: string
  /** Prix brut (statistique du serveur) ; null = absent ou sans vente. */
  price: number | null
  /** Statistique réellement utilisée. */
  stat: ConcretePriceStat | null
  /** Prix net de la taxe de vente. */
  net: number | null
  sold24: number
  sold7: number
  sold30: number
  /** Ventes moyennes par jour (30 j). */
  perDayAvg: number
  kamasPerDay: number
  /** Unités vendables par jour sans saturer (`share` du volume moyen). */
  sellablePerDay: number
  confidence: 'high' | 'medium' | 'low' | null
  /** Objet absent de l'export. */
  absent: boolean
}

/** Prix, volume et quantité vendable d'un objet (jamais 0 pour un prix inconnu). */
export function marketLine(market: MarketSource, id: number, opts: { saleTax?: number; share?: number } = {}): MarketLine {
  const row = market.rows[String(id)]
  const name = marketItemName(id, market.names)
  if (!row)
    return { id, name, price: null, stat: null, net: null, sold24: 0, sold7: 0, sold30: 0, perDayAvg: 0, kamasPerDay: 0, sellablePerDay: 0, confidence: null, absent: true }
  const d = priceDetail(row, market.stat)
  const tax = opts.saleTax ?? 0.02
  const share = opts.share ?? DEFAULT_MAX_MARKET_SHARE
  const perDayAvg = row[TUPLE.sold30] / 30
  return {
    id,
    name,
    price: d?.price ?? null,
    stat: d?.stat ?? null,
    net: d ? d.price * (1 - tax) : null,
    sold24: row[TUPLE.sold24],
    sold7: row[TUPLE.sold7],
    sold30: row[TUPLE.sold30],
    perDayAvg,
    kamasPerDay: row[TUPLE.kamasPerDay],
    sellablePerDay: perDayAvg * share,
    confidence: marketConfidence(row),
    absent: false,
  }
}

// ---------- (a) Prix clés de l'élevage ----------

export interface ExtractionPriceLine extends MarketLine {
  family: FamilyId
  /** Valeur nette d'une génération extraite (= 1 ressource), null si inconnue. */
  perGenerationNet: number | null
}

export interface RunePriceLine extends MarketLine {
  family: FamilyId
  /** Prix par défaut de la recherche (rendements de brisage observés à ce prix). */
  defaultPrice: number | null
  /** Facteur appliqué aux rendements de brisage (prix du serveur ÷ défaut). */
  scale: number | null
}

export interface GenetonShopLine extends MarketLine {
  cost: number
  /** Kamas bruts par généton (prix ÷ coût). */
  perGeneton: number | null
  perGenetonNet: number | null
}

export interface GenetonDashboard {
  /** Lignes de la boutique, du meilleur échange au moins bon (sans prix en dernier). */
  lines: GenetonShopLine[]
  best: GenetonShopLine | null
  /** Valeur brute d'un généton sur ce serveur (null : aucun prix). */
  value: number | null
  net: number | null
}

/** Coût au point d'une jauge à un palier, à l'achat et en fabriquant (5 tailles comparées). */
export interface FuelPointRow {
  gauge: GaugeId
  tier: FuelTier
  /** Carburant le moins cher au point à l'HDV du serveur. */
  buy: { fuel: FuelRecipe; price: number; perPoint: number; sold24: number; perDayAvg: number } | null
  /** Carburant le moins cher au point en fabriquant (ingrédients chiffrés). */
  craft: { fuel: FuelRecipe; cost: number; perPoint: number; complete: boolean; canCraft: boolean } | null
  /** Le moins cher des deux (craft seulement si complet et fabricable à votre niveau). */
  best: 'achat' | 'craft' | null
  /** Coût au point retenu (null : inconnu). */
  bestPerPoint: number | null
}

export interface MakinaPriceRow {
  id: number
  name: string
  family: FamilyId
  kind: MakinaKind
  generation: number
  level: number
  line: MarketLine
  craft: { cost: number; complete: boolean; missing: number[] } | null
  canCraft: boolean
}

export interface NetPriceRow {
  id: number
  name: string
  kind: NetKind
  family: FamilyId | null
  level: number
  line: MarketLine
  craft: { cost: number; complete: boolean; missing: number[] } | null
  /** Coût par monture capturée (prix ÷ montures par lancer). */
  perMount: number | null
  mountsPerCast: number
}

export interface KeyPriceDashboard {
  extraction: ExtractionPriceLine[]
  runes: RunePriceLine[]
  genetons: GenetonDashboard
  /** Pépite (×10 par makina), Parchemin d'Éleveur, Tourmaline. */
  others: MarketLine[]
  fuels: FuelPointRow[]
  makinas: MakinaPriceRow[]
  nets: NetPriceRow[]
}

function craftOf(id: number, ctx: PriceContext): { cost: number; complete: boolean; missing: number[] } | null {
  const c = craftCost(id, ctx)
  if (!c) return null
  return { cost: c.total, complete: c.complete, missing: c.missing }
}

/** Coût au point de chaque jauge à chaque palier (palier exact, 5 tailles comparées). */
export function fuelPointCosts(ic: InsightContext): FuelPointRow[] {
  const r = resolve(ic)
  const out: FuelPointRow[] = []
  for (const gauge of GAUGE_IDS)
    for (const tier of [1, 2, 3, 4] as FuelTier[]) {
      const fuels = FUELS.filter((f) => f.gauge === gauge && f.tier === tier)
      let buy: FuelPointRow['buy'] = null
      let craft: FuelPointRow['craft'] = null
      for (const f of fuels) {
        const dur = fuelDurability(f, r.rules)
        const l = marketLine(r.market, f.id, { saleTax: r.tax, share: r.share })
        if (l.price !== null && (!buy || l.price / dur < buy.perPoint)) buy = { fuel: f, price: l.price, perPoint: l.price / dur, sold24: l.sold24, perDayAvg: l.perDayAvg }
        const c = craftOf(f.id, r.ctx)
        if (c && c.complete) {
          const canCraft = r.jobLevel >= f.level
          const cand = { fuel: f, cost: c.cost, perPoint: c.cost / dur, complete: true, canCraft }
          // Préfère un craft à votre portée, puis le moins cher au point.
          if (!craft || (canCraft && !craft.canCraft) || (canCraft === craft.canCraft && cand.perPoint < craft.perPoint)) craft = cand
        }
      }
      const craftOk = craft && craft.canCraft ? craft : null
      const best = buy && craftOk ? (craftOk.perPoint < buy.perPoint ? 'craft' : 'achat') : buy ? 'achat' : craftOk ? 'craft' : null
      out.push({ gauge, tier, buy, craft, best, bestPerPoint: best === 'achat' ? buy!.perPoint : best === 'craft' ? craftOk!.perPoint : null })
    }
  return out
}

/** Tableau de bord des prix clés de l'élevage sur ce serveur, avec leurs volumes. */
export function keyPriceDashboard(ic: InsightContext): KeyPriceDashboard {
  const r = resolve(ic)
  const lineOf = (id: number) => marketLine(r.market, id, { saleTax: r.tax, share: r.share })
  const extraction: ExtractionPriceLine[] = FAMILY_IDS.map((f) => {
    const l = lineOf(FAMILIES[f].extractionItemId)
    return { ...l, name: FAMILIES[f].extractionItemName, family: f, perGenerationNet: l.net }
  })
  const runes: RunePriceLine[] = (['volkorne', 'muldo'] as FamilyId[]).map((f) => {
    const id = BRISAGE_RUNE[f] as number
    const l = lineOf(id)
    const def = defaultItemPrice(id)?.price ?? null
    return { ...l, family: f, defaultPrice: def, scale: l.price !== null && def ? l.price / def : null }
  })
  const g = genetonValueFromMarket(r.market, r.tax)
  const shopLines: GenetonShopLine[] = GENETON_SHOP.map((s) => {
    const l = lineOf(s.id)
    return { ...l, name: s.name, cost: s.cost, perGeneton: l.price === null ? null : l.price / s.cost, perGenetonNet: l.net === null ? null : l.net / s.cost }
  }).sort((a, b) => (b.perGeneton ?? -1) - (a.perGeneton ?? -1) || a.cost - b.cost)
  const best = shopLines[0] && shopLines[0].perGeneton !== null ? shopLines[0] : null
  const others = [PEPITE, PARCHEMIN_ELEVEUR, TOURMALINE].map(lineOf)
  const makinas: MakinaPriceRow[] = [...MAKINAS]
    .sort((a, b) => a.family.localeCompare(b.family) || a.kind.localeCompare(b.kind) || a.generation - b.generation)
    .map((m) => ({ id: m.id, name: m.name, family: m.family, kind: m.kind, generation: m.generation, level: m.level, line: lineOf(m.id), craft: craftOf(m.id, r.ctx), canCraft: r.jobLevel >= m.level }))
  const nets: NetPriceRow[] = NETS.map((n) => {
    const line = lineOf(n.id)
    const per = DEFAULT_MOUNTS_PER_CAST[n.kind].value
    return { id: n.id, name: n.name, kind: n.kind, family: n.family, level: n.level, line, craft: craftOf(n.id, r.ctx), perMount: line.price === null ? null : line.price / per, mountsPerCast: per }
  })
  return {
    extraction,
    runes,
    genetons: { lines: shopLines, best, value: g?.value ?? null, net: g?.net ?? null },
    others,
    fuels: fuelPointCosts(ic),
    makinas,
    nets,
  }
}

/** Prix des makinas par génération (une série par famille et type ; null = sans prix). */
export function makinaPriceCurves(rows: MakinaPriceRow[]): { family: FamilyId; kind: MakinaKind; points: { generation: number; price: number | null; craft: number | null; sold30: number }[] }[] {
  const keys = new Map<string, { family: FamilyId; kind: MakinaKind; points: { generation: number; price: number | null; craft: number | null; sold30: number }[] }>()
  for (const m of rows) {
    const k = `${m.family}|${m.kind}`
    if (!keys.has(k)) keys.set(k, { family: m.family, kind: m.kind, points: [] })
    keys.get(k)!.points.push({ generation: m.generation, price: m.line.price, craft: m.craft && m.craft.complete ? m.craft.cost : null, sold30: m.line.sold30 })
  }
  for (const v of keys.values()) v.points.sort((a, b) => a.generation - b.generation)
  return [...keys.values()]
}

// ---------- (b) Fabriquer ou acheter ----------

export type CraftKind = 'carburant' | 'makina' | 'filet'

export const CRAFT_KIND_LABELS: Record<CraftKind, string> = { carburant: 'Carburant', makina: 'Makina', filet: 'Filet' }

export interface CraftVsBuyRow {
  id: number
  name: string
  kind: CraftKind
  /** Niveau de recette (Éleveur). */
  level: number
  /** Vous pouvez la fabriquer (niveau d'Éleveur). */
  canCraft: boolean
  gauge?: GaugeId
  tier?: FuelTier
  family?: FamilyId | null
  generation?: number
  makinaKind?: MakinaKind
  /** Prix et volume de l'objet fabriqué à l'HDV du serveur. */
  buy: MarketLine
  /** Coût des ingrédients (vos prix > marché > défaut) ; borne basse si incomplet. */
  craft: { cost: number; complete: boolean; missing: number[] } | null
  /** Le moins cher sur ce serveur (« inconnu » si l'un des deux manque). */
  cheaper: 'craft' | 'achat' | 'egal' | 'inconnu'
  /** Économie en fabriquant au lieu d'acheter (achat − craft), null si inconnue. */
  saving: number | null
  /** Marge en fabriquant pour revendre : prix net de taxe − craft (null si inconnue). */
  margin: number | null
  /** Marge ÷ coût du craft. */
  marginPct: number | null
  /** Objets revendables par jour sans saturer (`share` du volume moyen). */
  sellablePerDay: number
  /**
   * Crafts par jour que le marché des ingrédients fournit sans saturer (min sur les ingrédients
   * présents dans l'export ; null : aucun ingrédient dans l'export).
   */
  ingredientCapPerDay: number | null
  /** Bénéfice possible par jour en fabriquant pour revendre (marge × min(revendables, ingrédients)), si marge > 0. */
  profitPerDay: number | null
  /** XP d'Éleveur d'un craft à votre niveau (0 si hors de portée ou trop facile). */
  xp: number
}

/** Rapport « égal » : écart relatif sous lequel achat et craft sont jugés équivalents. */
export const CRAFT_EQUAL_TOLERANCE = 0.02

/**
 * Fabriquer ou acheter, pour chaque carburant, makina et filet : prix de l'HDV du serveur contre coût des
 * ingrédients, marge en fabriquant pour revendre et bénéfice journalier plafonné par la liquidité (objet
 * fabriqué et ingrédients). Trié : marge journalière décroissante, puis économie.
 */
export function craftVsBuy(ic: InsightContext, opts: { kinds?: CraftKind[] } = {}): CraftVsBuyRow[] {
  const r = resolve(ic)
  const kinds = new Set(opts.kinds ?? (['carburant', 'makina', 'filet'] as CraftKind[]))
  const items: { id: number; name: string; level: number; xpRatio: number; kind: CraftKind; extra: Partial<CraftVsBuyRow> }[] = []
  if (kinds.has('carburant')) for (const f of FUELS) items.push({ id: f.id, name: f.name, level: f.level, xpRatio: f.xpRatio, kind: 'carburant', extra: { gauge: f.gauge, tier: f.tier } })
  if (kinds.has('makina'))
    for (const m of MAKINAS) items.push({ id: m.id, name: m.name, level: m.level, xpRatio: m.xpRatio, kind: 'makina', extra: { family: m.family, generation: m.generation, makinaKind: m.kind } })
  if (kinds.has('filet')) for (const n of NETS) items.push({ id: n.id, name: n.name, level: n.level, xpRatio: n.xpRatio, kind: 'filet', extra: { family: n.family } })
  const rows: CraftVsBuyRow[] = items.map((it) => {
    const buy = marketLine(r.market, it.id, { saleTax: r.tax, share: r.share })
    const craft = craftOf(it.id, r.ctx)
    const canCraft = r.jobLevel >= it.level
    let cheaper: CraftVsBuyRow['cheaper'] = 'inconnu'
    let saving: number | null = null
    if (buy.price !== null && craft?.complete) {
      saving = buy.price - craft.cost
      cheaper = Math.abs(saving) <= CRAFT_EQUAL_TOLERANCE * Math.max(buy.price, craft.cost) ? 'egal' : saving > 0 ? 'craft' : 'achat'
    } else if (buy.price !== null && craft && !craft.complete && craft.cost >= buy.price) {
      // Les ingrédients connus coûtent déjà plus que l'objet : acheter est moins cher.
      cheaper = 'achat'
    }
    const margin = buy.net !== null && craft?.complete ? buy.net - craft.cost : null
    // Ingrédients : crafts par jour que leur marché fournit sans saturer.
    const recipe = getRecipe(it.id)
    let ingredientCap: number | null = null
    for (const ing of recipe?.ingredients ?? []) {
      const cap = salesCap(ing.id, r.market, r.share)
      if (!cap) continue
      const crafts = cap.perDay / ing.qty
      ingredientCap = ingredientCap === null ? crafts : Math.min(ingredientCap, crafts)
    }
    const volume = ingredientCap === null ? buy.sellablePerDay : Math.min(buy.sellablePerDay, ingredientCap)
    return {
      id: it.id,
      name: it.name,
      kind: it.kind,
      level: it.level,
      canCraft,
      ...it.extra,
      buy,
      craft,
      cheaper,
      saving,
      margin,
      marginPct: margin !== null && craft && craft.cost > 0 ? margin / craft.cost : null,
      sellablePerDay: buy.sellablePerDay,
      ingredientCapPerDay: ingredientCap,
      profitPerDay: margin !== null && margin > 0 ? margin * volume : null,
      xp: canCraft ? craftXp(it.level, r.jobLevel, it.xpRatio) : 0,
    }
  })
  return rows.sort((a, b) => (b.profitPerDay ?? -1) - (a.profitPerDay ?? -1) || (b.saving ?? -Infinity) - (a.saving ?? -Infinity) || a.id - b.id)
}

export interface CraftVsBuySummary {
  total: number
  /** Fabriquer est moins cher (ingrédients au prix du serveur). */
  craftCheaper: number
  buyCheaper: number
  equal: number
  unknown: number
  /** Crafts à votre portée, rentables à revendre, triés par bénéfice journalier. */
  profitable: CraftVsBuyRow[]
  /** Somme des 5 meilleurs bénéfices journaliers (ordre de grandeur, liquidité comprise). */
  topProfitPerDay: number
}

export function craftVsBuySummary(rows: CraftVsBuyRow[]): CraftVsBuySummary {
  const profitable = rows.filter((r) => r.canCraft && r.profitPerDay !== null && r.profitPerDay > 0).sort((a, b) => (b.profitPerDay ?? 0) - (a.profitPerDay ?? 0))
  return {
    total: rows.length,
    craftCheaper: rows.filter((r) => r.cheaper === 'craft').length,
    buyCheaper: rows.filter((r) => r.cheaper === 'achat').length,
    equal: rows.filter((r) => r.cheaper === 'egal').length,
    unknown: rows.filter((r) => r.cheaper === 'inconnu').length,
    profitable,
    topProfitPerDay: profitable.slice(0, 5).reduce((s, r) => s + (r.profitPerDay ?? 0), 0),
  }
}

// ---------- (c) Marché des montures ----------

export interface MountMarketRow {
  speciesId: number
  name: string
  family: FamilyId
  generation: number
  itemId: number
  /** Prix de l'objet-monture (HDV mixte : niveaux, états et séniles mélangés). */
  line: MarketLine
  /** Extraction (génération × ressource de la famille, prix du serveur). */
  extraction: { qty: number; unitPrice: number | null; gross: number | null; net: number | null }
  /** Vente nette − extraction nette (null si inconnu). */
  premium: number | null
  /** Prix ÷ valeur d'extraction brute. */
  ratio: number | null
  /** Se vend plus cher (net) que son extraction. */
  sellAboveExtraction: boolean
  /** G5+ vendue sous la moitié de sa valeur d'extraction : ventes probablement tirées par des séniles. */
  possibleSenile: boolean
  /** Montures vendables par jour sans saturer. */
  sellablePerDay: number
  /** Gain par jour à vendre plutôt qu'extraire, plafonné par la liquidité. */
  extraPerDay: number | null
}

/** Marché des montures du serveur : prix (HDV mixte) et volume par espèce, face à la valeur d'extraction. */
export function mountMarket(ic: InsightContext, family?: FamilyId): MountMarketRow[] {
  const r = resolve(ic)
  const resource = new Map<FamilyId, number | null>(FAMILY_IDS.map((f) => [f, marketPrice(FAMILIES[f].extractionItemId, r.ctx).price]))
  return SPECIES.filter((s) => s.breedable && s.itemId && (!family || s.family === family)).map((s) => {
    const line = marketLine(r.market, s.itemId as number, { saleTax: r.tax, share: r.share })
    const unit = resource.get(s.family) ?? null
    const qty = s.extractionQty
    const gross = qty === 0 ? 0 : unit === null ? null : qty * unit
    const net = gross === null ? null : gross * (1 - r.tax)
    const premium = line.net !== null && net !== null ? line.net - net : null
    return {
      speciesId: s.id,
      name: s.name,
      family: s.family,
      generation: s.generation,
      itemId: s.itemId as number,
      line,
      extraction: { qty, unitPrice: unit, gross, net },
      premium,
      ratio: line.price !== null && gross !== null && gross > 0 ? line.price / gross : null,
      sellAboveExtraction: premium !== null && premium > 0,
      possibleSenile: possibleSenile(s.generation, line.price, gross),
      sellablePerDay: line.sellablePerDay,
      extraPerDay: premium !== null && premium > 0 ? premium * line.sellablePerDay : null,
    }
  })
}

/**
 * Montures qui se vendent plus cher que leur extraction (G2+, hors séniles probables), triées par gain
 * journalier plafonné par la liquidité. La G1 (non extractible) n'y figure pas.
 */
export function sellRatherThanExtract(rows: MountMarketRow[], opts: { minConfidence?: 'low' | 'medium' | 'high' } = {}): MountMarketRow[] {
  const rank = { low: 0, medium: 1, high: 2 }
  const min = rank[opts.minConfidence ?? 'low']
  return rows
    .filter((r) => r.generation >= 2 && r.sellAboveExtraction && !r.possibleSenile && r.line.confidence !== null && rank[r.line.confidence] >= min)
    .sort((a, b) => (b.extraPerDay ?? 0) - (a.extraPerDay ?? 0) || (b.premium ?? 0) - (a.premium ?? 0))
}

/** Point d'une courbe de prix par génération (espèces d'une famille et d'une génération). */
export interface GenerationPoint {
  family: FamilyId
  generation: number
  /** Espèces de la génération. */
  species: number
  /** Espèces avec un prix. */
  priced: number
  min: number | null
  /** Médiane des prix des espèces (HDV mixte). */
  median: number | null
  max: number | null
  /** Ventes sur 30 jours (toutes espèces de la génération). */
  sold30: number
  perDayAvg: number
  /** Valeur d'extraction brute d'une monture de cette génération. */
  extractionGross: number | null
  /** Espèces signalées « sénile probable ». */
  senileSuspects: number
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Courbes de prix par génération (une par famille), à partir de `mountMarket`. */
export function generationCurves(rows: MountMarketRow[]): Partial<Record<FamilyId, GenerationPoint[]>> {
  const out: Partial<Record<FamilyId, GenerationPoint[]>> = {}
  for (const f of FAMILY_IDS) {
    const fam = rows.filter((r) => r.family === f)
    if (!fam.length) continue
    const gens = [...new Set(fam.map((r) => r.generation))].sort((a, b) => a - b)
    out[f] = gens.map((g) => {
      const rs = fam.filter((r) => r.generation === g)
      const prices = rs.map((r) => r.line.price).filter((p): p is number => p !== null)
      return {
        family: f,
        generation: g,
        species: rs.length,
        priced: prices.length,
        min: prices.length ? Math.min(...prices) : null,
        median: median(prices),
        max: prices.length ? Math.max(...prices) : null,
        sold30: rs.reduce((s, r) => s + r.line.sold30, 0),
        perDayAvg: rs.reduce((s, r) => s + r.line.perDayAvg, 0),
        extractionGross: rs[0]?.extraction.gross ?? null,
        senileSuspects: rs.filter((r) => r.possibleSenile).length,
      }
    })
  }
  return out
}

// ---------- (d) Comparaison entre serveurs ----------

/** Marché d'un serveur à comparer. */
export interface ServerMarket {
  serverId: string
  serverName: string
  market: MarketSource
}

/** Objets comparés d'un serveur à l'autre, par groupe. */
export const COMPARE_ITEMS: { id: number; group: string }[] = [
  ...FAMILY_IDS.map((f) => ({ id: FAMILIES[f].extractionItemId, group: 'Ressources d’extraction' })),
  { id: RUNE_GA_PA, group: 'Runes de brisage' },
  { id: RUNE_GA_PME, group: 'Runes de brisage' },
  ...GENETON_SHOP.filter((g) => g.cost === 160).map((g) => ({ id: g.id, group: 'Boutique de génétons' })),
  { id: TOURMALINE, group: 'Boutique de génétons' },
  { id: PEPITE, group: 'Makinas' },
  { id: PARCHEMIN_ELEVEUR, group: 'Divers' },
  ...NETS.filter((n) => n.kind === 'universel').map((n) => ({ id: n.id, group: 'Filets' })),
  ...GAUGE_IDS.flatMap((g) => FUELS.filter((f) => f.gauge === g && f.size === 'gigantesque' && f.tier <= 2).map((f) => ({ id: f.id, group: 'Carburants (Gigantesques)' }))),
]

export interface ServerCompareCell {
  price: number | null
  sold24: number
  perDayAvg: number
}

export interface ServerCompareRow {
  id: number
  name: string
  group: string
  cells: ServerCompareCell[]
  /** Index du serveur le moins cher / le plus cher (null : moins de 2 prix). */
  cheapest: number | null
  priciest: number | null
  /** Écart relatif max ÷ min − 1. */
  spread: number | null
}

export interface ServerComparison {
  servers: { serverId: string; serverName: string; exportDate: string; ageDays: number | null }[]
  rows: ServerCompareRow[]
  /** Valeur brute d'un généton sur chaque serveur. */
  genetonValue: (number | null)[]
  warnings: string[]
}

/** Écart (jours) entre les exports au-delà duquel la comparaison est signalée. */
export const COMPARE_DATE_GAP_DAYS = 7

/**
 * Comparaison des objets clés entre serveurs (≥ 2 marchés), avec le moins cher et le plus cher de
 * chaque objet. null avec moins de 2 serveurs.
 */
export function compareServers(servers: ServerMarket[], opts: { ids?: { id: number; group: string }[]; today?: string; saleTax?: number } = {}): ServerComparison | null {
  if (servers.length < 2) return null
  const items = opts.ids ?? COMPARE_ITEMS
  const rows: ServerCompareRow[] = items.map(({ id, group }) => {
    const cells = servers.map((s) => {
      const l = marketLine(s.market, id)
      return { price: l.price, sold24: l.sold24, perDayAvg: l.perDayAvg }
    })
    const priced = cells.map((c, i) => [c.price, i] as const).filter((x): x is readonly [number, number] => x[0] !== null)
    let cheapest: number | null = null
    let priciest: number | null = null
    let spread: number | null = null
    if (priced.length >= 2) {
      const lo = priced.reduce((a, b) => (b[0] < a[0] ? b : a))
      const hi = priced.reduce((a, b) => (b[0] > a[0] ? b : a))
      cheapest = lo[1]
      priciest = hi[1]
      spread = lo[0] > 0 ? hi[0] / lo[0] - 1 : null
    }
    const names = servers.map((s) => s.market.names).find((n) => n && n[String(id)])
    return { id, name: marketItemName(id, names), group, cells, cheapest, priciest, spread }
  })
  const warnings: string[] = []
  const dates = servers.map((s) => s.market.exportDate)
  const ages = dates.map((d) => (opts.today ? exportAgeDays(d, opts.today) : null))
  const valid = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  if (valid.length >= 2) {
    const gap = exportAgeDays(valid[0], valid[valid.length - 1])
    if (gap !== null && gap > COMPARE_DATE_GAP_DAYS) warnings.push(`Exports de dates éloignées (${gap} jours entre le ${frenchDay(valid[0])} et le ${frenchDay(valid[valid.length - 1])}) : les écarts mêlent serveur et période.`)
  }
  servers.forEach((s, i) => {
    const a = ages[i]
    if (a !== null && a > MARKET_STALE_DAYS) warnings.push(`${s.serverName} : export du ${frenchDay(s.market.exportDate)} (il y a ${a} jours), prix à rafraîchir.`)
  })
  return {
    servers: servers.map((s, i) => ({ serverId: s.serverId, serverName: s.serverName, exportDate: s.market.exportDate, ageDays: ages[i] })),
    rows,
    genetonValue: servers.map((s) => genetonValueFromMarket(s.market, opts.saleTax ?? 0.02)?.value ?? null),
    warnings,
  }
}

// ---------- (e) Fraîcheur de l'export ----------

/** Au-delà de ce nombre de jours, l'export est jugé périmé (au-delà de `MARKET_STALE_DAYS` : à rafraîchir). */
export const MARKET_OLD_DAYS = 30

export type FreshnessLevel = 'frais' | 'a-rafraichir' | 'perime' | 'inconnu'

export interface Freshness {
  exportDate: string
  ageDays: number | null
  level: FreshnessLevel
  tone: 'ok' | 'warn' | 'danger'
  message: string
}

/** Fraîcheur d'un export HDV (date de l'export → aujourd'hui, AAAA-MM-JJ). */
export function snapshotFreshness(exportDate: string, todayIso: string): Freshness {
  const age = exportAgeDays(exportDate, todayIso)
  const when = frenchDay(exportDate)
  if (age === null) return { exportDate, ageDays: null, level: 'inconnu', tone: 'warn', message: 'Date de l’export inconnue : vérifiez que les prix sont récents.' }
  if (age < 0) return { exportDate, ageDays: age, level: 'inconnu', tone: 'warn', message: `Export daté du ${when}, dans le futur : vérifiez la date saisie à l’import.` }
  const ago = age === 0 ? 'aujourd’hui' : age === 1 ? 'hier' : `il y a ${age} jours`
  if (age <= MARKET_STALE_DAYS) return { exportDate, ageDays: age, level: 'frais', tone: 'ok', message: `Export du ${when} (${ago}).` }
  if (age <= MARKET_OLD_DAYS)
    return { exportDate, ageDays: age, level: 'a-rafraichir', tone: 'warn', message: `Export du ${when} (${ago}) : prix à rafraîchir (plus de ${MARKET_STALE_DAYS} jours), importez un export récent.` }
  return { exportDate, ageDays: age, level: 'perime', tone: 'danger', message: `Export du ${when} (${ago}) : prix périmés (plus de ${MARKET_OLD_DAYS} jours) — les calculs de rentabilité peuvent être faux, importez un export récent.` }
}

// ---------- Tout le tableau de bord ----------

export interface MarketInsights {
  freshness: Freshness | null
  keyPrices: KeyPriceDashboard
  craft: CraftVsBuyRow[]
  craftSummary: CraftVsBuySummary
  mounts: MountMarketRow[]
  sellRatherThanExtract: MountMarketRow[]
  curves: Partial<Record<FamilyId, GenerationPoint[]>>
  /** Montures G5+ dont le prix fait soupçonner des séniles. */
  senileSuspects: MountMarketRow[]
  /** Rappels (plafond de vente des montures, liquidité). */
  notes: string[]
}

/** Lecture complète du marché d'un serveur (tableau de bord, craft, montures, fraîcheur). */
export function marketInsights(ic: InsightContext, opts: { today?: string } = {}): MarketInsights {
  const r = resolve(ic)
  const mounts = mountMarket(ic)
  const craft = craftVsBuy(ic)
  return {
    freshness: opts.today ? snapshotFreshness(ic.market.exportDate, opts.today) : null,
    keyPrices: keyPriceDashboard(ic),
    craft,
    craftSummary: craftVsBuySummary(craft),
    mounts,
    sellRatherThanExtract: sellRatherThanExtract(mounts),
    curves: generationCurves(mounts),
    senileSuspects: mounts.filter((m) => m.possibleSenile),
    notes: [
      `Montures : le prix d’un objet-monture mélange niveaux, états et montures séniles (HDV mixte) ; les calculs ne s’en servent que comme plafond de vente. Sénile probable : G5+ vendue sous ${Math.round(SENILE_PRICE_RATIO * 100)} % de sa valeur d’extraction.`,
      `Liquidité : quantités vendables = ${Math.round(r.share * 100)} % du volume quotidien moyen (30 jours) ; au-delà, le prix baisse.`,
      `Taxe de vente comptée : ${Math.round(r.tax * 1000) / 10} %.`,
    ],
  }
}
