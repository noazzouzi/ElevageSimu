import { describe, expect, it } from 'vitest'
import {
  bestFuel,
  canDeposit,
  costPerGaugePoint,
  depositFuel,
  dustOption,
  fillPlan,
  findFuel,
  fuelDurability,
  fuelOptions,
  fuelsOf,
} from './fuel'
import type { PriceContext } from './pricing'
import { RULESETS } from './rules'

const R36 = RULESETS['3.6']
const R37 = RULESETS['3.7']
const opts = { jobLevel: 200, rules: R36 }
const id = (gauge: Parameters<typeof findFuel>[0], tier: 1 | 2 | 3 | 4, size: Parameters<typeof findFuel>[2]) => findFuel(gauge, tier, size)!.id
/** Contexte sans prix par défaut : seuls les prix saisis comptent (tests déterministes). */
const ctxOf = (overrides: Record<number, number>): PriceContext => ({
  overrides: Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, v])),
  useDefaults: false,
})

describe('durabilité et plafonds', () => {
  it('applique le facteur de durabilité du ruleset (×2 en 3.7)', () => {
    const gig = findFuel('mangeoire', 1, 'gigantesque')!
    expect(fuelDurability(gig, R36)).toBe(5000)
    expect(fuelDurability(gig, R37)).toBe(10000)
  })

  it('un Extrait ne se dépose que sous 40 000 ; l’excédent est perdu', () => {
    const gig = findFuel('foudroyeur', 1, 'gigantesque')!
    expect(canDeposit(39_999, gig, R36)).toBe(true)
    expect(canDeposit(40_000, gig, R36)).toBe(false)
    expect(depositFuel(38_000, gig, R36)).toEqual({ value: 40_000, added: 2_000, wasted: 3_000 })
    expect(depositFuel(40_000, gig, R36)).toBeNull()
  })

  it('un Élixir remplit jusqu’au maximum de la jauge (100 000 en 3.6, 200 000 en 3.7)', () => {
    const elx = findFuel('mangeoire', 4, 'gigantesque')!
    expect(depositFuel(97_000, elx, R36)).toEqual({ value: 100_000, added: 3_000, wasted: 2_000 })
    expect(depositFuel(100_000, elx, R36)).toBeNull()
    expect(depositFuel(97_000, elx, R37)?.value).toBe(107_000)
  })

  it('120 carburants : 5 tailles × 4 paliers par jauge', () => {
    expect(fuelsOf('dragofesse')).toHaveLength(20)
    expect(fuelsOf('dragofesse', 2).map((f) => f.size)).toEqual(['minuscule', 'petit', 'normal', 'grand', 'gigantesque'])
  })
})

describe('options et coût au point', () => {
  it('coût au point = prix / durabilité ; craft possible selon le niveau', () => {
    const ctx = ctxOf({ [id('mangeoire', 1, 'normal')]: 900 })
    const opt = fuelOptions('mangeoire', 1, ctx, { jobLevel: 30, rules: R36 })
    expect(opt).toHaveLength(5)
    const normal = opt.find((o) => o.size === 'normal')!
    expect(normal.costPerPoint).toBeCloseTo(0.3, 10)
    expect(normal.complete).toBe(true)
    expect(normal.origin).toBe('joueur')
    expect(normal.canCraft).toBe(true) // recette niv. 25
    expect(opt.find((o) => o.size === 'grand')!.canCraft).toBe(false) // niv. 35
    expect(opt.find((o) => o.size === 'petit')!.complete).toBe(false)
  })

  it('choisit le moins cher au point, palier supérieur compris', () => {
    const ctx = ctxOf({
      [id('abreuvoir', 1, 'minuscule')]: 1000, // 1 K/pt
      [id('abreuvoir', 1, 'gigantesque')]: 2000, // 0,4 K/pt
      [id('abreuvoir', 2, 'gigantesque')]: 1000, // 0,2 K/pt
    })
    const best = bestFuel('abreuvoir', 1, ctx, opts)
    expect(best.complete).toBe(true)
    expect(best.fuel?.fuel.id).toBe(id('abreuvoir', 2, 'gigantesque'))
    expect(best.value).toBeCloseTo(0.2, 10)
    const exact = bestFuel('abreuvoir', 1, ctx, { ...opts, exactTier: true })
    expect(exact.value).toBeCloseTo(0.4, 10)
    // Le palier 2 n'accepte pas d'Extrait.
    expect(costPerGaugePoint('abreuvoir', 2, ctx, opts).value).toBeCloseTo(0.2, 10)
  })

  it('3.7 : à prix égal, le coût au point est divisé par deux', () => {
    const ctx = ctxOf({ [id('abreuvoir', 1, 'gigantesque')]: 2000 })
    expect(bestFuel('abreuvoir', 1, ctx, { jobLevel: 1, rules: R37 }).value).toBeCloseTo(0.2, 10)
  })

  it('un seul carburant de palier supérieur chiffré : borne haute, coût incomplet', () => {
    const ctx = ctxOf({ [id('dragofesse', 4, 'gigantesque')]: 200_000 })
    const r = bestFuel('dragofesse', 1, ctx, opts)
    expect(r.complete).toBe(false)
    expect(r.bound).toBe('max')
    expect(r.value).toBe(40)
    expect(r.toPrice?.tier).toBe(1)
    expect(r.missing.length).toBeGreaterThan(0)
  })

  it('rien de chiffré : incomplet, jamais 0', () => {
    const r = bestFuel('foudroyeur', 1, ctxOf({}), opts)
    expect(r.complete).toBe(false)
    expect(r.value).toBeNull()
    expect(r.fuel).not.toBeNull()
    expect(r.missing.length).toBeGreaterThan(0)
  })

  it('repli sur les coûts au point de la recherche pour la Mangeoire seulement', () => {
    const ctx: PriceContext = { overrides: {}, useDefaults: true }
    const m4 = bestFuel('mangeoire', 4, ctx, opts)
    expect(m4.estimated).toBe(true)
    expect(m4.origin).toBe('estimation')
    expect(m4.value).toBe(40)
    expect(bestFuel('mangeoire', 4, ctx, { jobLevel: 1, rules: R37 }).value).toBe(20)
    // Sans prix par défaut, aucune estimation.
    expect(bestFuel('mangeoire', 4, ctxOf({}), opts).estimated).toBe(false)
    // Jauge de fécondité : pas d'estimation de repli.
    expect(bestFuel('foudroyeur', 1, ctx, opts).estimated).toBe(false)
  })

  it('prix par défaut : Extrait de Mangeoire ≈ 0,32 K/pt (craft Truite + Œil de Pikdoa moins cher que l’HDV)', () => {
    const r = bestFuel('mangeoire', 1, { overrides: {}, useDefaults: true }, opts)
    expect(r.complete).toBe(true)
    expect(r.fuel?.fuel.name).toBe('Extrait de Mangeoire')
    expect(r.value).toBeCloseTo(950 / 3000, 6)
  })

  it('craftableOnly écarte un prix « craft » hors de portée du métier', () => {
    const gig = findFuel('caresseur', 1, 'gigantesque')!
    const ctx = ctxOf(Object.fromEntries(gig.ingredients.map((i) => [i.id, 100])))
    const low = { jobLevel: 10, rules: R36 }
    const r = bestFuel('caresseur', 1, ctx, low)
    expect(r.fuel?.fuel.id).toBe(gig.id)
    expect(r.fuel?.craftPriceOnly).toBe(true)
    expect(bestFuel('caresseur', 1, ctx, { ...low, craftableOnly: true }).complete).toBe(false)
  })
})

describe('plan de remplissage', () => {
  it('0 → 100 000 avec les Gigantesques : 8 Extraits, 6 Philtres, 4 Potions, 2 Élixirs, sans perte', () => {
    const ctx = ctxOf({
      [id('mangeoire', 1, 'gigantesque')]: 100,
      [id('mangeoire', 2, 'gigantesque')]: 1_000,
      [id('mangeoire', 3, 'gigantesque')]: 2_000,
      [id('mangeoire', 4, 'gigantesque')]: 10_000,
    })
    const p = fillPlan('mangeoire', 0, 100_000, ctx, opts)
    expect(p.feasible).toBe(true)
    expect(p.complete).toBe(true)
    expect(p.steps.map((s) => [s.option.tier, s.count])).toEqual([
      [1, 8],
      [2, 6],
      [3, 4],
      [4, 2],
    ])
    expect(p.waste).toBe(0)
    expect(p.cost).toBe(8 * 100 + 6 * 1_000 + 4 * 2_000 + 2 * 10_000)
    expect(p.reached).toBe(100_000)
  })

  it('un palier supérieur bon marché remplit aussi les tranches basses', () => {
    const ctx = ctxOf({ [id('abreuvoir', 1, 'gigantesque')]: 5_000, [id('abreuvoir', 4, 'gigantesque')]: 1_000 })
    const p = fillPlan('abreuvoir', 0, 100_000, ctx, opts)
    expect(p.items).toHaveLength(1)
    expect(p.items[0].option.tier).toBe(4)
    expect(p.count).toBe(20)
    expect(p.cost).toBe(20_000)
  })

  it('respecte les plafonds et la famille minimale de chaque tranche ; Élixir seul chiffré = borne haute', () => {
    const ctx = ctxOf({ [id('abreuvoir', 1, 'gigantesque')]: 100, [id('abreuvoir', 4, 'gigantesque')]: 1_000 })
    const p = fillPlan('abreuvoir', 0, 100_000, ctx, opts)
    // L'Élixir (0,2 K/pt) est plus cher au point que l'Extrait chiffré (0,02 K/pt) : il ne remplace pas
    // les Philtres et Potions non chiffrés (« prix à saisir »), il ne sert qu'à la borne haute.
    expect(p.steps.map((s) => [s.option.tier, s.count, s.to])).toEqual([
      [1, 8, 40_000],
      [2, 6, 70_000],
      [3, 4, 90_000],
      [4, 2, 100_000],
    ])
    expect(p.complete).toBe(false)
    expect(p.cost).toBe(800 + 2_000) // borne basse : seuls les objets chiffrés
    expect(p.missing.length).toBeGreaterThan(0)
    expect(p.upperBound?.complete).toBe(true)
    expect(p.upperBound?.steps.map((s) => [s.option.tier, s.count, s.to])).toEqual([
      [1, 8, 40_000],
      [4, 12, 100_000],
    ])
    expect(p.upperBound?.cost).toBe(800 + 12_000)
  })

  it('évite le gaspillage quand c’est moins cher, sinon le chiffre', () => {
    const gig = id('foudroyeur', 1, 'gigantesque')
    const min = id('foudroyeur', 1, 'minuscule')
    const cheapMin = fillPlan('foudroyeur', 38_000, 40_000, ctxOf({ [gig]: 1_000, [min]: 300 }), opts)
    expect(cheapMin.steps.map((s) => [s.option.size, s.count])).toEqual([['minuscule', 2]])
    expect(cheapMin.waste).toBe(0)
    const dearMin = fillPlan('foudroyeur', 38_000, 40_000, ctxOf({ [gig]: 1_000, [min]: 900 }), opts)
    expect(dearMin.steps.map((s) => [s.option.size, s.count])).toEqual([['gigantesque', 1]])
    expect(dearMin.waste).toBe(3_000)
  })

  it('l’objectif peut être dépassé sans perte (overshoot) ; from ≥ to = plan vide', () => {
    // Philtre (0,2 K/pt) moins cher au point que l'Extrait chiffré (0,4 K/pt) : il remplit aussi la tranche du palier 1.
    const ctx = ctxOf({ [id('mangeoire', 1, 'gigantesque')]: 2_000, [id('mangeoire', 2, 'gigantesque')]: 1_000 })
    const p = fillPlan('mangeoire', 0, 12_000, ctx, opts)
    expect(p.count).toBe(3)
    expect(p.overshoot).toBe(3_000)
    expect(p.waste).toBe(0)
    expect(fillPlan('mangeoire', 50_000, 40_000, ctx, opts).count).toBe(0)
  })

  it('3.7 : paliers 80 000 / 140 000 et durabilité ×2', () => {
    const ctx = ctxOf({ [id('mangeoire', 1, 'gigantesque')]: 100 })
    const p = fillPlan('mangeoire', 0, 80_000, ctx, { jobLevel: 200, rules: R37 })
    expect(p.count).toBe(8)
    expect(p.complete).toBe(true)
    expect(fillPlan('mangeoire', 0, 90_000, ctx, { jobLevel: 200, rules: R37 }).complete).toBe(false)
  })

  it('sans prix : plan faisable mais incomplet, coût inconnu', () => {
    const p = fillPlan('baffeur', 0, 40_000, ctxOf({}), opts)
    expect(p.feasible).toBe(true)
    expect(p.complete).toBe(false)
    expect(p.cost).toBeNull()
    expect(p.missing.length).toBeGreaterThan(0)
  })
})

describe('plan de remplissage : famille minimale par tranche (prix par défaut)', () => {
  const defaults: PriceContext = { overrides: {}, useDefaults: true }
  const low = { jobLevel: 1, rules: R36 }

  it('Baffeur 0 → 20 : un Minuscule Extrait « prix à saisir », jamais l’Élixir estimé (borne haute seulement)', () => {
    const p = fillPlan('baffeur', 0, 20, defaults, low)
    expect(p.items.map((it) => it.option.fuel.id)).toEqual([id('baffeur', 1, 'minuscule')])
    expect(p.items[0].count).toBe(1)
    expect(p.complete).toBe(false)
    expect(p.missing.length).toBeGreaterThan(0)
    expect(p.cost === null || p.cost < 200_000).toBe(true)
    // Le seul carburant chiffré (Gigantesque Élixir, estimation) donne la borne haute.
    expect(p.upperBound?.complete).toBe(true)
    expect(p.upperBound?.items[0].option.tier).toBe(4)
    expect(p.upperBound?.cost).toBe(200_000)
  })

  it('Dragofesse 0 → 20 000 et 0 → 70 000 : Extraits puis Philtres, aucun Élixir', () => {
    const a = fillPlan('dragofesse', 0, 20_000, defaults, low)
    expect(a.items.every((it) => it.option.tier === 1)).toBe(true)
    expect(a.complete).toBe(false)
    const b = fillPlan('dragofesse', 0, 70_000, defaults, low)
    expect(b.steps.every((s) => (s.to <= 40_000 ? s.option.tier === 1 : s.option.tier === 2))).toBe(true)
    expect(b.items.some((it) => it.option.tier > 2)).toBe(false)
    expect(b.upperBound?.cost).toBe(14 * 200_000)
  })

  it('un prix saisi sur la bonne famille est retenu et rend le plan complet', () => {
    const min = id('baffeur', 1, 'minuscule')
    const p = fillPlan('baffeur', 0, 20, { overrides: { [min]: 900 }, useDefaults: true }, low)
    expect(p.items.map((it) => it.option.fuel.id)).toEqual([min])
    expect(p.complete).toBe(true)
    expect(p.cost).toBe(900)
    expect(p.upperBound).toBeNull()
  })

  it('complément 40 000 → 40 060 : un Philtre, jamais une Potion de palier supérieur', () => {
    const p = fillPlan('caresseur', 40_000, 40_060, defaults, low)
    expect(p.items).toHaveLength(1)
    expect(p.items[0].option.tier).toBe(2)
  })

  it('une famille supérieure chiffrée moins chère au point qu’un carburant chiffré de la tranche reste retenue', () => {
    const ctx = ctxOf({ [id('mangeoire', 2, 'gigantesque')]: 16_000, [id('mangeoire', 3, 'grand')]: 8_000 }) // 3,2 contre 2 K/pt
    const p = fillPlan('mangeoire', 40_000, 70_000, ctx, opts)
    expect(p.complete).toBe(true)
    expect(p.items.every((it) => it.option.tier === 3)).toBe(true)
  })

  it('craftableOnly : un prix de craft hors de portée compte comme non chiffré (le carburant reste proposé)', () => {
    const gig = findFuel('caresseur', 1, 'gigantesque')!
    const ctx = ctxOf(Object.fromEntries(gig.ingredients.map((i) => [i.id, 100])))
    const p = fillPlan('caresseur', 0, 5_000, ctx, { jobLevel: 10, rules: R36, craftableOnly: true })
    expect(p.feasible).toBe(true)
    expect(p.complete).toBe(false)
    expect(fillPlan('caresseur', 0, 5_000, ctx, { jobLevel: 10, rules: R36 }).complete).toBe(true)
  })
})

describe('poussière d’élevage (héritage)', () => {
  it('Gigantesque Extrait = 50 poussières, 100 points par poussière', () => {
    const d = dustOption('mangeoire', 1, R36)!
    expect(d.dustCost).toBe(50)
    expect(d.pointsPerDust).toBe(100)
    expect(d.legacy).toBe(true)
    expect(dustOption('mangeoire', 4, R36)!.dustCost).toBe(3200)
  })
})

describe('ECO-12 — recette hors de portée du métier', () => {
  it('niveau 1 : l’Extrait de Mangeoire (recette niv. 25) prend le prix HDV, pas le coût des ingrédients ; niveau 60 : le craft', () => {
    const defaults: PriceContext = { overrides: {}, useDefaults: true }
    const ex = findFuel('mangeoire', 1, 'normal')!
    const low = fuelOptions('mangeoire', 1, defaults, { jobLevel: 1, rules: R36 }).find((o) => o.fuel.id === ex.id)!
    expect(low.canCraft).toBe(false)
    expect(low.origin).toBe('defaut')
    expect(low.craftPriceOnly).toBe(false)
    const high = fuelOptions('mangeoire', 1, defaults, { jobLevel: 60, rules: R36 }).find((o) => o.fuel.id === ex.id)!
    expect(high.canCraft).toBe(true)
    expect(high.origin).toBe('craft')
    expect(high.unitPrice!).toBeLessThan(low.unitPrice!)
  })
})
