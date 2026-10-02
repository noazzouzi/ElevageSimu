// Résolution des prix : prix saisi par le joueur > prix par défaut sourcé > coût des ingrédients.
// Un coût dont un ingrédient n'a pas de prix est signalé « incomplet » (jamais compté comme 0).
import { defaultItemPrice, getRecipe } from '../data'

export type PriceOrigin = 'joueur' | 'defaut' | 'craft' | 'manquant'

export interface PriceContext {
  /** Prix saisis par le joueur (clé = id d'objet). */
  overrides: Record<string, number>
  /** Utiliser les prix par défaut de la recherche (estimations comprises). */
  useDefaults: boolean
}

export interface ResolvedPrice {
  price: number | null
  origin: PriceOrigin
  /** Faux si le prix est un coût de craft avec des ingrédients sans prix. */
  complete: boolean
  confidence?: string
  missing: number[]
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

/** Prix « marché » connu d'un objet (joueur ou défaut), sans passer par le craft. */
export function marketPrice(id: number, ctx: PriceContext): ResolvedPrice {
  const user = ctx.overrides[String(id)]
  if (user !== undefined && Number.isFinite(user)) return { price: user, origin: 'joueur', complete: true, missing: [] }
  if (ctx.useDefaults) {
    const d = defaultItemPrice(id)
    if (d && d.price !== null) return { price: d.price, origin: 'defaut', complete: true, confidence: d.confidence, missing: [] }
  }
  return { price: null, origin: 'manquant', complete: false, missing: [id] }
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
 * Prix retenu pour un objet : le moins cher entre le prix marché connu et le coût de craft complet.
 * Sans prix marché, le coût de craft (éventuellement incomplet) est utilisé.
 */
export function resolvePrice(id: number, ctx: PriceContext, depth = 0): ResolvedPrice {
  const market = marketPrice(id, ctx)
  if (market.origin === 'joueur') return market
  const craft = depth < 3 ? craftCost(id, ctx, depth) : null
  if (!craft) return market
  if (market.price !== null && (!craft.complete || market.price <= craft.total)) return market
  if (craft.complete) return { price: craft.total, origin: 'craft', complete: true, missing: [] }
  return { price: craft.total, origin: 'craft', complete: false, missing: craft.missing }
}

/** Prix net de vente après taxe d'HDV. */
export function netSale(price: number, taxRate = 0.02): number {
  return price * (1 - taxRate)
}
