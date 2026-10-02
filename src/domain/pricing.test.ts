import { describe, expect, it } from 'vitest'
import { FUELS, findMakina, getRecipe } from '../data'
import { bestFuel } from './fuel'
import { RULESETS } from './rules'
import { PRICE_CONFLICT_RATIO, canCraftRecipe, craftCost, marketPrice, resolvePrice, type PriceContext } from './pricing'

const EXTRAIT_MANGEOIRE = 33331 // recette niv. 25 : Truite (1844) + Œil de Pikdoa (6841) ; défaut 1 000
const TRUITE = 1844
const OEIL = 6841
const R36 = RULESETS['3.6']
const defaults: PriceContext = { overrides: {}, useDefaults: true }

describe('résolution des prix', () => {
  it('joueur > défaut > craft ; un craft complet moins cher que le défaut est retenu', () => {
    expect(marketPrice(EXTRAIT_MANGEOIRE, defaults)).toMatchObject({ price: 1_000, origin: 'defaut' })
    expect(resolvePrice(EXTRAIT_MANGEOIRE, { overrides: { [EXTRAIT_MANGEOIRE]: 1_200 }, useDefaults: true })).toMatchObject({ price: 1_200, origin: 'joueur' })
    const cheap = resolvePrice(EXTRAIT_MANGEOIRE, { overrides: { [TRUITE]: 100, [OEIL]: 200 }, useDefaults: true })
    expect(cheap).toMatchObject({ price: 300, origin: 'craft', complete: true })
    expect(cheap.conflict).toBeUndefined()
  })

  it('ECO-11 : un défaut (autre serveur) nettement sous VOS ingrédients est gardé mais signalé', () => {
    const ctx: PriceContext = { overrides: { [TRUITE]: 600, [OEIL]: 2_400 }, useDefaults: true }
    expect(craftCost(EXTRAIT_MANGEOIRE, ctx)?.total).toBe(3_000)
    const r = resolvePrice(EXTRAIT_MANGEOIRE, ctx)
    expect(r).toMatchObject({ price: 1_000, origin: 'defaut' })
    expect(r.conflict).toMatchObject({ defaultPrice: 1_000, craftCost: 3_000, ratio: 3 })
    expect(r.conflict?.message).toContain('saisissez le prix HDV')
    // Écart faible, ou ingrédients tous par défaut : pas d'alerte.
    const small = resolvePrice(EXTRAIT_MANGEOIRE, { overrides: { [TRUITE]: 600, [OEIL]: 800 }, useDefaults: true })
    expect(1_400 / 1_000).toBeLessThan(PRICE_CONFLICT_RATIO)
    expect(small).toMatchObject({ price: 1_000, origin: 'defaut' })
    expect(small.conflict).toBeUndefined()
    expect(resolvePrice(EXTRAIT_MANGEOIRE, defaults).conflict).toBeUndefined()
  })

  it('ECO-12 : recette hors de portée du métier → prix HDV d’abord, le craft n’est qu’une estimation', () => {
    expect(getRecipe(EXTRAIT_MANGEOIRE)?.level).toBe(25)
    expect(canCraftRecipe(EXTRAIT_MANGEOIRE, { jobLevel: 1 })).toBe(false)
    expect(canCraftRecipe(EXTRAIT_MANGEOIRE, { jobLevel: 25 })).toBe(true)
    expect(canCraftRecipe(EXTRAIT_MANGEOIRE, {})).toBe(true)
    // Craft moins cher que le défaut, mais non fabricable au niveau 1 : on paie le prix HDV.
    const ctx: PriceContext = { overrides: { [TRUITE]: 100, [OEIL]: 200 }, useDefaults: true }
    expect(resolvePrice(EXTRAIT_MANGEOIRE, { ...ctx, jobLevel: 1 })).toMatchObject({ price: 1_000, origin: 'defaut', craftLocked: 25 })
    expect(resolvePrice(EXTRAIT_MANGEOIRE, { ...ctx, jobLevel: 30 })).toMatchObject({ price: 300, origin: 'craft' })
    // Sans prix HDV : coût des ingrédients signalé (estimation du prix HDV).
    const noMarket = resolvePrice(EXTRAIT_MANGEOIRE, { overrides: { [TRUITE]: 100, [OEIL]: 200 }, useDefaults: false, jobLevel: 1 })
    expect(noMarket).toMatchObject({ price: 300, origin: 'craft', complete: true, craftLocked: 25 })
  })

  it('ECO-12 : au niveau 1, la Mangeoire T1 est payée au prix HDV (1 000), aussi avec craftableOnly', () => {
    const ctx: PriceContext = { ...defaults, jobLevel: 1 }
    const b = bestFuel('mangeoire', 1, ctx, { jobLevel: 1, rules: R36 })
    expect(b.fuel?.fuel.id).toBe(EXTRAIT_MANGEOIRE)
    expect(b.fuel?.unitPrice).toBe(1_000)
    expect(b.origin).toBe('defaut')
    const c = bestFuel('mangeoire', 1, ctx, { jobLevel: 1, rules: R36, craftableOnly: true })
    expect(c.fuel?.unitPrice).toBe(1_000)
    expect(c.estimated).toBe(false)
  })

  it('makina hors de portée : prix HDV saisi retenu même si le craft paraît moins cher', () => {
    const g2 = findMakina('optimakina', 'muldo', 2)!
    const ings = Object.fromEntries((getRecipe(g2.id)?.ingredients ?? []).map((i) => [String(i.id), 1]))
    const ctx: PriceContext = { overrides: { ...ings, [g2.id]: 50_000 }, useDefaults: false, jobLevel: 1 }
    expect(resolvePrice(g2.id, ctx)).toMatchObject({ price: 50_000, origin: 'joueur' })
    const withoutMarket = resolvePrice(g2.id, { ...ctx, overrides: ings })
    expect(withoutMarket.origin).toBe('craft')
    expect(withoutMarket.craftLocked).toBe(g2.level)
  })

  it('un ingrédient sans prix rend le craft incomplet (jamais 0)', () => {
    const f = FUELS.find((x) => x.id === EXTRAIT_MANGEOIRE)!
    const r = resolvePrice(f.id, { overrides: { [TRUITE]: 100 }, useDefaults: false })
    expect(r).toMatchObject({ price: 100, origin: 'craft', complete: false })
    expect(r.missing).toEqual([OEIL])
  })
})

describe('marché importé (export HDV du serveur)', () => {
  // [médiane 30 j, moyenne 30 j, médiane 24 h, vendus 24 h, vendus 7 j, vendus 30 j, kamas/jour]
  const market = {
    rows: {
      [String(EXTRAIT_MANGEOIRE)]: [1296, 1284, 1251, 4093, 25041, 91971, 3973147] as [number, number, number, number, number, number, number],
      [String(TRUITE)]: [17, 18, 28, 39154, 366066, 1554575, 880925] as [number, number, number, number, number, number, number],
      [String(OEIL)]: [0, 0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number, number],
    },
    stat: 'auto' as const,
    exportDate: '2026-10-02',
    serverName: 'Tylezia',
  }

  it('origine « marche » entre le prix saisi et le défaut ; une ligne sans vente n’est pas un prix', () => {
    const ctx: PriceContext = { overrides: {}, useDefaults: true, market }
    expect(marketPrice(EXTRAIT_MANGEOIRE, ctx)).toMatchObject({ price: 1251, origin: 'marche', market: { exportDate: '2026-10-02', stat: 'median24', sold24: 4093 } })
    expect(marketPrice(EXTRAIT_MANGEOIRE, { ...ctx, overrides: { [EXTRAIT_MANGEOIRE]: 900 } }).origin).toBe('joueur')
    // Œil de Pikdoa : présent mais sans vente → défaut de la recherche (850).
    expect(marketPrice(OEIL, ctx)).toMatchObject({ price: 850, origin: 'defaut' })
    expect(marketPrice(OEIL, { ...ctx, useDefaults: false })).toMatchObject({ price: null, origin: 'manquant' })
    // Sans marché : comportement d'avant.
    expect(marketPrice(EXTRAIT_MANGEOIRE, { overrides: {}, useDefaults: true, market: null })).toMatchObject({ price: 1000, origin: 'defaut' })
  })

  it('le moins cher entre le marché et le craft complet (ingrédients au marché ou au défaut)', () => {
    const ctx: PriceContext = { overrides: {}, useDefaults: true, market, jobLevel: 30 }
    // Truite 28 (marché) + Œil 850 (défaut) = 878 < 1 251.
    expect(resolvePrice(EXTRAIT_MANGEOIRE, ctx)).toMatchObject({ price: 878, origin: 'craft', complete: true })
    expect(craftCost(EXTRAIT_MANGEOIRE, ctx)?.lines.map((l) => l.origin)).toEqual(['marche', 'defaut'])
    // Statistique médiane 30 j.
    expect(marketPrice(EXTRAIT_MANGEOIRE, { ...ctx, market: { ...market, stat: 'median30' } }).price).toBe(1296)
  })
})
