// Résolution des prix : prix saisi par le joueur (serveur) > prix du marché importé (export HDV du
// serveur) > prix par défaut sourcé (recherche) > coût des ingrédients.
// Un coût dont un ingrédient n'a pas de prix est signalé « incomplet » (jamais compté comme 0).
//
// Deux garde-fous (research/README.md §2.9 : `min(prix_HDV, Σ ingrédients)`) :
// - le coût des ingrédients ne vaut que si le joueur sait fabriquer l'objet : avec `ctx.jobLevel`, une
//   recette de niveau supérieur n'est pas « fabricable » — son prix HDV prime ; sans prix HDV, le coût
//   des ingrédients n'est qu'une estimation du prix HDV (`craftLocked`) ;
// - un prix par défaut (relevé sur un autre serveur, daté) nettement plus bas qu'un craft complet
//   chiffré avec VOS prix d'ingrédients est gardé, mais signalé (`conflict`) : à vérifier en jeu.
import { defaultItemPrice, getRecipe } from '../data'
import { marketConfidence, priceDetail, TUPLE, type ConcretePriceStat, type MarketSource } from './market'

/** Origine d'un prix : saisi (joueur), marché importé (export HDV du serveur), défaut de la recherche, coût de craft. */
export type PriceOrigin = 'joueur' | 'marche' | 'defaut' | 'craft' | 'manquant'

/** Libellés courts des origines (badges). */
export const PRICE_ORIGIN_LABELS: Record<PriceOrigin, string> = {
  joueur: 'votre prix',
  marche: 'marché',
  defaut: 'défaut',
  craft: 'craft',
  manquant: 'à saisir',
}

export interface PriceContext {
  /** Prix saisis par le joueur (clé = id d'objet). */
  overrides: Record<string, number>
  /** Utiliser les prix par défaut de la recherche (estimations comprises). */
  useDefaults: boolean
  /**
   * Niveau du métier d'Éleveur. Une recette de niveau supérieur ne peut pas être fabriquée : son prix
   * HDV est retenu avant le coût des ingrédients. Absent : toute recette est supposée fabricable.
   */
  jobLevel?: number
  /**
   * Prix du marché du serveur (dernier export HDV importé, statistique du serveur). Utilisé après le
   * prix saisi et avant le défaut de la recherche, que `useDefaults` soit coché ou non (ce sont les prix
   * réels de votre serveur). Absent ou null : ancien comportement.
   */
  market?: MarketSource | null
}

/** Détail d'un prix issu du marché importé (affichage : « marché (02/10) · 2 203 vendus/24 h »). */
export interface MarketPriceInfo {
  /** Date de l'export (AAAA-MM-JJ). */
  exportDate: string
  serverName?: string
  /** Statistique réellement utilisée (repli si la statistique choisie n'a pas de vente). */
  stat: ConcretePriceStat
  sold24: number
  sold7: number
  sold30: number
  /** Ventes moyennes par jour sur 30 jours. */
  perDayAvg: number
  /** Kamas échangés par jour. */
  kamasPerDay: number
}

/** Prix par défaut (autre serveur) nettement plus bas que le craft chiffré avec vos ingrédients. */
export interface PriceConflict {
  defaultPrice: number
  craftCost: number
  /** craftCost / defaultPrice. */
  ratio: number
  message: string
}

export interface ResolvedPrice {
  price: number | null
  origin: PriceOrigin
  /** Faux si le prix est un coût de craft avec des ingrédients sans prix. */
  complete: boolean
  confidence?: string
  missing: number[]
  /**
   * Niveau d'Éleveur requis pour fabriquer l'objet, quand le joueur ne l'a pas (`ctx.jobLevel`).
   * Avec `origin: 'craft'`, le prix n'est qu'une estimation du prix HDV (à saisir).
   */
  craftLocked?: number
  /** Le prix par défaut retenu contredit vos prix d'ingrédients (à vérifier). */
  conflict?: PriceConflict
  /** Prix issu du marché importé (`origin: 'marche'`) : date de l'export, statistique, volume. */
  market?: MarketPriceInfo
}

export interface CostLine {
  id: number
  qty: number
  unit: number | null
  subtotal: number | null
  origin: PriceOrigin
}

export interface CraftCost {
  total: number
  complete: boolean
  missing: number[]
  lines: CostLine[]
}

/** Écart (craft / défaut) à partir duquel un prix par défaut est signalé comme contradictoire. */
export const PRICE_CONFLICT_RATIO = 1.5

const fmtK = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} K`

/** Prix du marché importé pour un objet (null : absent de l'export ou sans vente). */
export function marketQuote(id: number, market: MarketSource | null | undefined): { price: number; confidence: string; info: MarketPriceInfo } | null {
  const row = market?.rows[String(id)]
  if (!market || !row) return null
  const d = priceDetail(row, market.stat)
  if (!d) return null
  return {
    price: d.price,
    confidence: marketConfidence(row),
    info: {
      exportDate: market.exportDate,
      serverName: market.serverName,
      stat: d.stat,
      sold24: row[TUPLE.sold24],
      sold7: row[TUPLE.sold7],
      sold30: row[TUPLE.sold30],
      perDayAvg: row[TUPLE.sold30] / 30,
      kamasPerDay: row[TUPLE.kamasPerDay],
    },
  }
}

/**
 * Prix « HDV » connu d'un objet, sans passer par le craft : prix saisi > marché importé (`ctx.market`) >
 * défaut de la recherche (si `useDefaults`).
 */
export function marketPrice(id: number, ctx: PriceContext): ResolvedPrice {
  const user = ctx.overrides[String(id)]
  if (user !== undefined && Number.isFinite(user)) return { price: user, origin: 'joueur', complete: true, missing: [] }
  const m = marketQuote(id, ctx.market)
  if (m) return { price: m.price, origin: 'marche', complete: true, confidence: m.confidence, missing: [], market: m.info }
  if (ctx.useDefaults) {
    const d = defaultItemPrice(id)
    if (d && d.price !== null) return { price: d.price, origin: 'defaut', complete: true, confidence: d.confidence, missing: [] }
  }
  return { price: null, origin: 'manquant', complete: false, missing: [id] }
}

/** Le joueur peut-il fabriquer cette recette ? (vrai sans recette ou sans niveau connu) */
export function canCraftRecipe(id: number, ctx: Pick<PriceContext, 'jobLevel'>): boolean {
  const recipe = getRecipe(id)
  return !recipe || ctx.jobLevel === undefined || ctx.jobLevel >= recipe.level
}

/** Coût de fabrication d'une recette (carburant, makina, filet) à partir des prix des ingrédients. */
export function craftCost(recipeId: number, ctx: PriceContext, depth = 0): CraftCost | null {
  const recipe = getRecipe(recipeId)
  if (!recipe) return null
  const lines: CostLine[] = []
  const missing: number[] = []
  let total = 0
  for (const ing of recipe.ingredients) {
    const p = resolvePrice(ing.id, ctx, depth + 1)
    const subtotal = p.price === null ? null : p.price * ing.qty
    if (subtotal !== null) total += subtotal
    if (!p.complete) missing.push(...(p.missing.length ? p.missing : [ing.id]))
    lines.push({ id: ing.id, qty: ing.qty, unit: p.price, subtotal, origin: p.origin })
  }
  return { total, complete: missing.length === 0, missing: [...new Set(missing)], lines }
}

/**
 * Prix retenu pour un objet : le moins cher entre le prix marché connu et le coût de craft complet
 * (si le joueur sait fabriquer l'objet). Sans prix marché, le coût de craft (éventuellement incomplet)
 * est utilisé — signalé `craftLocked` si le joueur ne peut pas le fabriquer.
 */
export function resolvePrice(id: number, ctx: PriceContext, depth = 0): ResolvedPrice {
  const market = marketPrice(id, ctx)
  if (market.origin === 'joueur') return market
  const craft = depth < 3 ? craftCost(id, ctx, depth) : null
  if (!craft) return market
  const recipe = getRecipe(id)
  const locked = recipe && ctx.jobLevel !== undefined && ctx.jobLevel < recipe.level ? recipe.level : undefined
  if (locked !== undefined) {
    // Hors de portée du métier : on paie le prix HDV ; le craft n'en est qu'une estimation.
    if (market.price !== null) return { ...market, craftLocked: locked }
    return { price: craft.total, origin: 'craft', complete: craft.complete, missing: craft.complete ? [] : craft.missing, craftLocked: locked }
  }
  if (market.price !== null && (!craft.complete || market.price <= craft.total)) {
    // Ingrédients chiffrés aux prix de VOTRE serveur (saisis ou marché importé).
    const ownIngredients = craft.lines.some((l) => l.origin === 'joueur' || l.origin === 'marche')
    if (market.origin === 'defaut' && craft.complete && ownIngredients && craft.total >= PRICE_CONFLICT_RATIO * market.price && market.price > 0)
      return {
        ...market,
        conflict: {
          defaultPrice: market.price,
          craftCost: craft.total,
          ratio: craft.total / market.price,
          message: `Prix par défaut ${fmtK(market.price)} < vos ingrédients ${fmtK(craft.total)} : saisissez le prix HDV de votre serveur.`,
        },
      }
    return market
  }
  if (craft.complete) return { price: craft.total, origin: 'craft', complete: true, missing: [] }
  return { price: craft.total, origin: 'craft', complete: false, missing: craft.missing }
}

/** Prix net de vente après taxe d'HDV. */
export function netSale(price: number, taxRate = 0.02): number {
  return price * (1 - taxRate)
}
