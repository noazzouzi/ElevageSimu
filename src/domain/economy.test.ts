import { describe, expect, it } from 'vitest'
import { FUELS, NETS, findMakina } from '../data'
import {
  BRISAGE_RUNE,
  brisageValue,
  buildPriceExport,
  captureCost,
  crossingRanking,
  cycleProfit,
  extractionValue,
  fertilityCost,
  fertilitySeconds,
  findItemIdByName,
  genetonKamasValue,
  levelingCost,
  makinaCost,
  matingEconomics,
  mountBand,
  mountSalePrice,
  mountValuation,
  parseBulkPrices,
  parseKamas,
  parsePriceExport,
  priceCoverage,
  type CycleConfig,
  type MountPriceContext,
} from './economy'
import { findFuel } from './fuel'
import { breed } from './genetics'
import type { PriceContext } from './pricing'
import { RULESETS } from './rules'

const R36 = RULESETS['3.6']
const DORE = 94
const INDIGO = 92
const DORE_INDIGO = 108 // G2
const AMBRE = 17864
const GA_PM = 1558
const OPTI_G2 = findMakina('optimakina', 'muldo', 2)!.id
const UNIVERSEL = NETS.find((n) => n.kind === 'universel')!.id

/** Tous les Gigantesques Extraits à 5 000 K (1 K par point), plus les objets d'un cycle Muldo G1 × G1. */
const fullOverrides = (): Record<string, number> => {
  const o: Record<string, number> = {}
  for (const f of FUELS) if (f.tier === 1 && f.size === 'gigantesque') o[f.id] = 5_000
  o[OPTI_G2] = 13_000
  o[UNIVERSEL] = 1_000
  o[AMBRE] = 20_000
  o[GA_PM] = 18_000
  return o
}
const fullCtx = (): PriceContext => ({ overrides: fullOverrides(), useDefaults: false })
const mprices: MountPriceContext = {
  mountOverrides: {},
  generationOverrides: { 'muldo|1|1': 10_000, 'muldo|2|1': 30_000 },
  useDefaults: false,
}
const noMountPrices: MountPriceContext = { mountOverrides: {}, generationOverrides: {}, useDefaults: false }
const defaultsMount: MountPriceContext = { mountOverrides: {}, generationOverrides: {}, useDefaults: true }
const defaultsCtx: PriceContext = { overrides: {}, useDefaults: true }

describe('prix de vente des montures', () => {
  it('tranche de niveau la plus proche', () => {
    expect([1, 40, 50, 51, 53, 150, 151, 200].map(mountBand)).toEqual(['1', '1', '1', '100', '100', '100', '200', '200'])
  })

  it('priorité : votre prix couleur > votre prix génération > défaut', () => {
    const m: MountPriceContext = {
      mountOverrides: { [`${DORE_INDIGO}|100`]: 99_000 },
      generationOverrides: { 'muldo|2|100': 70_000, 'muldo|2|1': 30_000 },
      useDefaults: true,
    }
    expect(mountSalePrice(DORE_INDIGO, 90, m)).toMatchObject({ price: 99_000, origin: 'joueur-espece', band: '100' })
    expect(mountSalePrice(DORE_INDIGO, 1, m)).toMatchObject({ price: 30_000, origin: 'joueur-generation' })
    expect(mountSalePrice(110, 100, m)).toMatchObject({ price: 70_000, origin: 'joueur-generation' })
  })

  it('défaut par nom exact (Muldo Doré niv. 100 ≈ 50 000, relevé) puis par génération (plancher signalé)', () => {
    expect(mountSalePrice(DORE, 100, defaultsMount)).toMatchObject({ price: 50_000, origin: 'defaut-espece', priceType: 'observed', isFloor: false })
    const floor = mountSalePrice(DORE, 1, defaultsMount)
    expect(floor).toMatchObject({ origin: 'defaut-generation', priceType: 'floor-estimate', isFloor: true, price: 12_250 })
  })

  it('état : une Dragodinde G1 fertile vaut le relevé de capture, une stérile le plancher', () => {
    const amande = 20 // Dragodinde Amande, G1 capturable
    const fertile = mountSalePrice(amande, 1, defaultsMount)
    const sterile = mountSalePrice(amande, 1, defaultsMount, { state: 'sterile' })
    expect(fertile.price).toBe(12_500)
    expect(fertile.priceType).toBe('observed')
    expect(sterile.price).toBe(12_250)
    expect(sterile.isFloor).toBe(true)
  })

  it('sans prix par défaut ni saisie : manquant', () => {
    expect(mountSalePrice(DORE, 1, noMountPrices)).toMatchObject({ price: null, origin: 'manquant' })
  })
})

describe('extraction et brisage', () => {
  const ctx: PriceContext = { overrides: { [AMBRE]: 20_000, [GA_PM]: 18_000 }, useDefaults: false }

  it('extraction = génération × prix de la ressource ; G1 = rien ; sénile = 1', () => {
    expect(extractionValue(DORE_INDIGO, ctx)).toMatchObject({ qty: 2, value: 40_000, complete: true, possible: true })
    expect(extractionValue(DORE, ctx)).toMatchObject({ qty: 0, value: 0, possible: false })
    expect(extractionValue(DORE_INDIGO, ctx, { senile: true }).qty).toBe(1)
    expect(extractionValue(DORE_INDIGO, { overrides: {}, useDefaults: false })).toMatchObject({ value: null, complete: false })
  })

  it('brisage : relevés, interpolation, extrapolation, mise à l’échelle de la rune', () => {
    expect(brisageValue('muldo', 53)).toMatchObject({ value: 12_000, method: 'releve' })
    expect(brisageValue('volkorne', 100).value).toBe(30_000)
    expect(brisageValue('muldo', 40)).toMatchObject({ value: 4_500, method: 'extrapolation' })
    expect(brisageValue('muldo', 20).value).toBe(0)
    expect(brisageValue('muldo', 150).value).toBe(37_500)
    expect(brisageValue('muldo', 53, { overrides: { [GA_PM]: 9_000 }, useDefaults: false }).value).toBe(6_000)
    expect(brisageValue('muldo', 53, { overrides: {}, useDefaults: false })).toMatchObject({ value: null, complete: false })
    expect(brisageValue('dragodinde', 100)).toMatchObject({ value: null, possible: false })
    expect(BRISAGE_RUNE.volkorne).toBe(1557)
  })
})

describe('valorisation d’une monture', () => {
  const ctx: PriceContext = { overrides: { [AMBRE]: 20_000, [GA_PM]: 18_000 }, useDefaults: false }

  it('max(vente, extraction, brisage), chaque terme net de la taxe', () => {
    const high: MountPriceContext = { ...noMountPrices, mountOverrides: { [`${DORE_INDIGO}|100`]: 100_000 } }
    const v = mountValuation(DORE_INDIGO, 100, { ctx, mountPrices: high, saleTax: 0.02 })
    expect(v.sale.net).toBeCloseTo(98_000, 6)
    expect(v.extraction.net).toBeCloseTo(39_200, 6)
    expect(v.brisage.net).toBeCloseTo(29_400, 6)
    expect(v.best).toBeCloseTo(98_000, 6)
    expect(v.bestKind).toBe('vente')
    expect(v.complete).toBe(true)

    const low: MountPriceContext = { ...noMountPrices, mountOverrides: { [`${DORE_INDIGO}|100`]: 10_000 } }
    const w = mountValuation(DORE_INDIGO, 100, { ctx, mountPrices: low, saleTax: 0.02 })
    expect(w.bestKind).toBe('extraction')
    expect(w.best).toBeCloseTo(39_200, 6)
  })

  it('un plancher de la recherche est déjà net de taxe', () => {
    const v = mountValuation(DORE, 1, { ctx: defaultsCtx, mountPrices: defaultsMount, saleTax: 0.02 })
    expect(v.sale.net).toBe(12_250)
  })

  it('plancher G2 : seule la revente de base compte comme vente, l’extraction suit VOTRE prix d’Ambre', () => {
    expect(mountSalePrice(DORE_INDIGO, 1, defaultsMount).price).toBe(12_250)
    const v = mountValuation(DORE_INDIGO, 1, { ctx: defaultsCtx, mountPrices: defaultsMount, saleTax: 0.02 })
    expect(v.bestKind).toBe('extraction')
    expect(v.best).toBeCloseTo(35_280, 6)
    const cheapAmbre = mountValuation(DORE_INDIGO, 1, { ctx: { overrides: { [AMBRE]: 5_000 }, useDefaults: true }, mountPrices: defaultsMount, saleTax: 0.02 })
    expect(cheapAmbre.bestKind).toBe('vente')
    expect(cheapAmbre.best).toBe(12_250)
  })

  it('incomplet si une option possible n’est pas chiffrée (la meilleure connue reste une borne basse)', () => {
    const v = mountValuation(DORE_INDIGO, 100, { ctx: { overrides: { [AMBRE]: 20_000 }, useDefaults: false }, mountPrices: noMountPrices, saleTax: 0 })
    expect(v.best).toBe(40_000)
    expect(v.complete).toBe(false)
  })

  it('génétons : 375 K par défaut, votre valeur sinon', () => {
    expect(genetonKamasValue()).toMatchObject({ value: 375, origin: 'defaut', range: [125, 725] })
    expect(genetonKamasValue(500)).toMatchObject({ value: 500, origin: 'joueur' })
  })
})

describe('coûts d’enclos', () => {
  it('fécondité : 60 000 points + sérénité par lot, divisés par la taille du lot', () => {
    const f = fertilityCost({ tier: 1, batchSize: 10, serenityPointsPerMount: 4_000, ctx: fullCtx(), rules: R36 })
    expect(f.complete).toBe(true)
    expect(f.lines.map((l) => [l.gauge, l.pointsPerBatch])).toEqual([
      ['foudroyeur', 20_000],
      ['abreuvoir', 20_000],
      ['dragofesse', 20_000],
      ['baffeur', 2_000],
      ['caresseur', 2_000],
    ])
    expect(f.perBatch).toBe(64_000)
    expect(f.perMount).toBe(6_400)
    expect(f.secondsPerBatch).toBe(42_000)
    expect(fertilityCost({ tier: 1, batchSize: 5, serenityPointsPerMount: 4_000, ctx: fullCtx(), rules: R36 }).perMount).toBe(12_800)
  })

  it('fécondité incomplète si une jauge n’est pas chiffrée (jamais 0)', () => {
    const o = fullOverrides()
    delete o[findFuel('dragofesse', 1, 'gigantesque')!.id]
    const f = fertilityCost({ tier: 1, batchSize: 10, serenityPointsPerMount: 4_000, ctx: { overrides: o, useDefaults: false }, rules: R36 })
    expect(f.complete).toBe(false)
    expect(f.perBatch).toBe(44_000) // somme connue = borne basse
    expect(f.missing.length).toBeGreaterThan(0)
    // Un palier 2 n'accepte pas les Extraits : rien n'est chiffré.
    expect(fertilityCost({ tier: 2, batchSize: 10, ctx: fullCtx(), rules: R36 }).complete).toBe(false)
  })

  it('durée de fécondité calée sur le planificateur (≈ 11 h 33 au palier 1, moitié au palier 2)', () => {
    expect(fertilitySeconds(1, R36, 3_200) / 3600).toBeCloseTo(11.56, 2)
    expect(fertilitySeconds(2, R36, 3_200)).toBe(fertilitySeconds(1, R36, 3_200) / 2)
  })

  it('XP : niveau 1 → 40 = 20 437 XP ; Sage divise carburant et temps par deux', () => {
    const l = levelingCost(1, 40, { tier: 1, batchSize: 10, ctx: fullCtx(), rules: R36 })
    expect(l.xpPerMount).toBe(20_437)
    expect(l.costPerBatch).toBe(20_437)
    expect(l.costPerMount).toBeCloseTo(2_043.7, 6)
    expect(l.secondsPerBatch).toBe(20_437)
    const s = levelingCost(1, 40, { tier: 1, batchSize: 10, sage: true, ctx: fullCtx(), rules: R36 })
    expect(s.costPerBatch).toBeCloseTo(10_218.5, 6)
    expect(s.secondsPerBatch).toBeCloseTo(10_218.5, 6)
    expect(levelingCost(40, 40, { tier: 1, batchSize: 10, ctx: { overrides: {}, useDefaults: false }, rules: R36 })).toMatchObject({ costPerBatch: 0, complete: true })
  })

  it('capture : prix du filet / montures par lancer ; niveau requis pour l’équiper', () => {
    const u = captureCost('muldo', 'universel', fullCtx())
    expect(u).toMatchObject({ unitPrice: 1_000, perMount: 1_000, complete: true, mountsPerCast: 1, jobXpPerMount: 30 })
    const multi = NETS.find((n) => n.kind === 'multiplicateur' && n.family === 'muldo')!
    const m = captureCost('muldo', 'multiplicateur', { overrides: { [multi.id]: 4_000 }, useDefaults: false }, { jobLevel: 50 })
    expect(m).toMatchObject({ perMount: 2_000, canEquip: false, requiredLevel: 100 })
  })

  it('makina : prix saisi, sinon coût incomplet ; génération bornée à 2', () => {
    expect(makinaCost('optimakina', 'muldo', 2, fullCtx())).toMatchObject({ price: 13_000, complete: true })
    expect(makinaCost('optimakina', 'muldo', 1, fullCtx()).makina?.generation).toBe(2)
    const none = makinaCost('optimakina', 'muldo', 5, { overrides: {}, useDefaults: false })
    expect(none.complete).toBe(false)
    expect(none.missing.length).toBeGreaterThan(0)
  })
})

describe('économie d’un accouplement', () => {
  it('valeur attendue = Σ P × valeur, + génétons, − makina', () => {
    const r = breed({ speciesId: DORE, level: 40, parents: [] }, { speciesId: INDIGO, level: 40, parents: [] }, { makina: 'optimakina' })
    expect(r.targetChance).toBeCloseTo(0.52, 10)
    const e = matingEconomics(r, { valueOf: (id) => (id === DORE_INDIGO ? 40_000 : 10_000), makinaCost: { price: 13_000, complete: true }, genetonValue: 375 })
    expect(e.expectedBabyValue).toBeCloseTo(0.52 * 40_000 + 0.48 * 10_000, 6)
    expect(e.expectedGenetons).toBeCloseTo(1.04, 10)
    expect(e.genetonsValue).toBeCloseTo(390, 6)
    expect(e.expectedNet).toBeCloseTo(25_600 + 390 - 13_000, 6)
    expect(e.complete).toBe(true)
    const partial = matingEconomics(r, { valueOf: (id) => (id === DORE_INDIGO ? null : 10_000), genetonValue: 375 })
    expect(partial.complete).toBe(false)
    expect(partial.missingSpecies).toEqual([DORE_INDIGO])
  })
})

describe('rentabilité d’un cycle', () => {
  const base = (): CycleConfig => ({
    family: 'muldo',
    parentA: DORE,
    parentB: INDIGO,
    pairs: 5,
    parentLevel: 40,
    tier: 1,
    batchSize: 10,
    optimakina: true,
    includeCapture: true,
    saleTax: 0.02,
    ctx: fullCtx(),
    mountPrices: mprices,
    rules: R36,
    jobLevel: 200,
    genetonValue: 375,
  })

  it('Muldo Doré × Indigo, 5 couples, tout chiffré : coûts, revenus et bénéfice attendus', () => {
    const r = cycleProfit(base())
    expect(r.complete).toBe(true)
    expect(r.mounts).toBe(10)
    expect(r.batches).toBe(1)
    const qty = Object.fromEntries(r.materials.map((m) => [m.key, [m.qty, m.subtotal]]))
    expect(qty['fert-foudroyeur']).toEqual([4, 20_000])
    expect(qty['fert-baffeur']).toEqual([1, 5_000]) // 1 600 points → 1 objet entier
    expect(qty['xp-mangeoire']).toEqual([5, 25_000]) // 20 437 points
    expect(qty['makina']).toEqual([5, 65_000])
    expect(qty['capture']).toEqual([10, 10_000])
    expect(r.costByCategory.fecondite.value).toBe(70_000)
    expect(r.totalCost).toBe(170_000)
    // Bébés : 5 × (0,52 × 39 200 + 0,48 × 9 800) ; stériles : 10 × 9 800 ; génétons : 5,2 × 375.
    expect(r.totalRevenue).toBeCloseTo(125_440 + 98_000 + 1_950, 6)
    expect(r.profit).toBeCloseTo(55_390, 6)
    expect(r.roi).toBeCloseTo(55_390 / 170_000, 10)
    expect(r.seconds.fertility).toBe(41_600)
    expect(r.seconds.leveling).toBeCloseTo(437, 6)
    expect(r.kamasPerHour).toBeCloseTo(55_390 / (42_037 / 3600), 6)
    expect(r.expectedTargetBabies).toBeCloseTo(2.6, 10)
    expect(r.jobXp).toBe(5 * 30 * 2)
    expect(r.assumptions.length).toBeGreaterThan(5)
  })

  it('cohérence : totaux = somme des lignes, bénéfice = revenus − coûts, bébés attendus = couples', () => {
    const r = cycleProfit({ ...base(), pairs: 7, batchSize: 8, paddocks: 2 })
    const sumCost = r.materials.reduce((s, m) => s + (m.subtotal ?? 0), 0)
    const sumCat = Object.values(r.costByCategory).reduce((s, c) => s + c.value, 0)
    expect(r.totalCost).toBeCloseTo(sumCost, 6)
    expect(sumCat).toBeCloseTo(sumCost, 6)
    expect(r.profit).toBeCloseTo(r.totalRevenue - r.totalCost, 6)
    const babies = r.revenue.filter((l) => l.kind === 'bebe').reduce((s, l) => s + l.qty, 0)
    expect(babies).toBeCloseTo(7, 10)
    expect(r.batches).toBe(2) // 14 montures en lots de 8
    expect(r.rounds).toBe(1)
    expect(r.materials.find((m) => m.key === 'fert-abreuvoir')!.qty).toBe(8) // 2 lots × 20 000 points
  })

  it('sans Optimakina ni capture : pas de ligne makina ni filet, chance cible 42 %', () => {
    const r = cycleProfit({ ...base(), optimakina: false, includeCapture: false })
    expect(r.materials.some((m) => m.category === 'makina' || m.category === 'capture')).toBe(false)
    expect(r.breed.targetChance).toBeCloseTo(0.42, 10)
  })

  it('stériles gardées pour cloner : ½ valeur d’une monture fertile', () => {
    const r = cycleProfit({ ...base(), sterileFate: 'cloner' })
    const st = r.revenue.find((l) => l.key === `sterile-${DORE}`)!
    expect(st.fate).toBe('clone')
    expect(st.unitValue).toBeCloseTo(0.5 * 10_000 * 0.98, 6)
  })

  it('prix manquants : incomplet, borne basse, objets à chiffrer listés', () => {
    const o = fullOverrides()
    delete o[OPTI_G2]
    const r = cycleProfit({ ...base(), ctx: { overrides: o, useDefaults: false } })
    expect(r.costComplete).toBe(false)
    expect(r.complete).toBe(false)
    expect(r.materials.find((m) => m.key === 'makina')!.subtotal).toBeNull()
    expect(r.missingItems.length).toBeGreaterThan(0)
    expect(r.totalCost).toBe(105_000)
    expect(r.warnings.some((w) => w.includes('incomplet'))).toBe(true)

    const empty = cycleProfit({ ...base(), ctx: { overrides: {}, useDefaults: false }, mountPrices: noMountPrices })
    expect(empty.complete).toBe(false)
    expect(empty.revenueComplete).toBe(false)
    expect(empty.missingSpecies.length).toBeGreaterThan(0)
  })
})

describe('classement des croisements', () => {
  it('tous les croisements Muldo, triés par marge ; marge du Doré × Indigo', () => {
    const rows = crossingRanking('muldo', {
      tier: 1,
      batchSize: 10,
      parentLevel: 40,
      optimakina: true,
      saleTax: 0.02,
      ctx: fullCtx(),
      mountPrices: mprices,
      rules: R36,
      jobLevel: 200,
      genetonValue: 375,
    })
    expect(rows).toHaveLength(162)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].margin).toBeGreaterThanOrEqual(rows[i].margin)
    const row = rows.find((r) => r.child === DORE_INDIGO)!
    expect(row.complete).toBe(true)
    // 25 088 (bébés) + 390 (génétons) + 19 600 (stériles) − 12 640 (fécondité) − 4 087,4 (XP) − 13 000 (makina)
    expect(row.margin).toBeCloseTo(15_350.6, 6)
    expect(row.targetChance).toBeCloseTo(0.52, 10)
    // Croisement de haute génération sans prix de makina : incomplet.
    expect(rows.find((r) => r.targetGeneration === 10)!.complete).toBe(false)
  })
})

describe('saisie des prix', () => {
  it('lit les montants usuels', () => {
    expect(parseKamas('12 000')).toBe(12_000)
    expect(parseKamas('12.000')).toBe(12_000)
    expect(parseKamas('12k')).toBe(12_000)
    expect(parseKamas('1,5 M')).toBe(1_500_000)
    expect(parseKamas('950 K')).toBe(950)
    expect(parseKamas('950 kamas')).toBe(950)
    expect(parseKamas('2,5')).toBe(3)
    expect(parseKamas('abc')).toBeNull()
  })

  it('collage en masse : « Nom;Prix », « id;prix » et « Nom prix »', () => {
    const truite = findItemIdByName('truite')!
    expect(truite).toBe(1844)
    const { entries, errors } = parseBulkPrices(
      ['# commentaire', 'Truite;120', '1844;150', 'Extrait de Mangeoire 1 000', 'oeil de pikdoa\t850', 'Objet inconnu;5', 'Truite;abc', ''].join('\n'),
    )
    expect(entries.map((e) => [e.id, e.price])).toEqual([
      [1844, 120],
      [1844, 150],
      [33331, 1000],
      [6841, 850],
    ])
    expect(errors.map((e) => e.line)).toEqual([6, 7])
  })

  it('export / import des prix', () => {
    const snap = { items: { '1844': 120 }, mounts: { '94|1': 10_000 }, generations: {}, genetonValue: 400 }
    const exp = buildPriceExport(snap, 'Salar', new Date('2026-10-02T00:00:00Z'))
    const back = parsePriceExport(JSON.parse(JSON.stringify(exp)))
    expect(back).toEqual({ ok: true, snapshot: snap, server: 'Salar' })
    expect(parsePriceExport({ items: { a: -1 } }).ok).toBe(false)
    expect(parsePriceExport([]).ok).toBe(false)
    expect(parsePriceExport({}).ok).toBe(false)
  })

  it('couverture des prix par défaut : 5 carburants, aucune makina', () => {
    const cov = Object.fromEntries(priceCoverage(defaultsCtx).map((c) => [c.key, [c.priced, c.total]]))
    expect(cov.carburants).toEqual([5, 120])
    expect(cov.makinas).toEqual([0, 81])
    expect(cov.extraction).toEqual([3, 3])
  })
})
