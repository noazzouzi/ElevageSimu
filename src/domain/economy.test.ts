import { describe, expect, it } from 'vitest'
import { FUELS, NETS, PRICES_DEFAULT, SPECIES, findMakina } from '../data'
import {
  BRISAGE_RUNE,
  FERTILITY_POINT_COST_HINTS,
  TYPICAL_BATCH,
  batchProfile,
  batchProfileFromPlans,
  brisageValue,
  buildPriceExport,
  captureCost,
  crossingRanking,
  cycleProfit,
  cyclesComparable,
  decideOptimakina,
  optimakinaHeuristicUse,
  defaultPriceIssue,
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
  optimakinaMode,
  parseBulkPrices,
  parseKamas,
  parsePriceExport,
  priceCoverage,
  socleInvestment,
  sterileValue,
  unlockedPaddockCount,
  type CycleConfig,
  type MountPriceContext,
  type MountValuation,
} from './economy'
import { findFuel } from './fuel'
import { breed } from './genetics'
import { planPaddock, refillAdvice } from './paddockAssign'
import type { SimMount } from './paddock'
import type { PriceContext } from './pricing'
import { RULESETS } from './rules'

const R36 = RULESETS['3.6']
const R37 = RULESETS['3.7']
const DORE = 94
const INDIGO = 92
const DORE_INDIGO = 108 // G2
const AMBRE = 17864
const GA_PM = 1558
const OPTI_G2 = findMakina('optimakina', 'muldo', 2)!.id
const UNIVERSEL = NETS.find((n) => n.kind === 'universel')!.id
const byName = (name: string) => SPECIES.find((s) => s.name === name)!.id
const MULDO_AMBRE = byName('Muldo Ambre') // G9
const MULDO_CORAIL = byName('Muldo Corail') // G9
const MULDO_EBENE = byName('Muldo Ébène') // G1

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
/** Tous les Gigantesques à 1 K par point, quel que soit le palier. */
const allTiersOverrides = (): Record<string, number> => {
  const o: Record<string, number> = { ...fullOverrides() }
  for (const f of FUELS) if (f.size === 'gigantesque') o[f.id] = 5_000
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
  it('tranche de niveau la plus proche (affichage)', () => {
    expect([1, 40, 50, 51, 53, 150, 151, 200].map(mountBand)).toEqual(['1', '1', '1', '100', '100', '100', '200', '200'])
  })

  it('priorité aux niveaux d’ancrage : votre prix couleur > votre prix génération > défaut', () => {
    const m: MountPriceContext = {
      mountOverrides: { [`${DORE_INDIGO}|100`]: 99_000 },
      generationOverrides: { 'muldo|2|100': 70_000, 'muldo|2|1': 30_000 },
      useDefaults: true,
    }
    expect(mountSalePrice(DORE_INDIGO, 100, m)).toMatchObject({ price: 99_000, origin: 'joueur-espece', method: 'exact', estimated: false })
    expect(mountSalePrice(DORE_INDIGO, 1, m)).toMatchObject({ price: 30_000, origin: 'joueur-generation', method: 'exact' })
    expect(mountSalePrice(110, 100, m)).toMatchObject({ price: 70_000, origin: 'joueur-generation' })
  })

  it('ECO-05 : prix interpolé entre les niveaux 1, 100 et 200, continu et monotone', () => {
    const m: MountPriceContext = { mountOverrides: {}, generationOverrides: { 'muldo|1|1': 10_000, 'muldo|1|100': 50_000, 'muldo|1|200': 150_000 }, useDefaults: false }
    const p = (L: number) => mountSalePrice(DORE, L, m).price as number
    expect(p(50)).toBeCloseTo(10_000 + (40_000 * 49) / 99, 6)
    expect(Math.abs(p(51) - p(50))).toBeLessThan(500)
    expect(Math.abs(p(151) - p(150))).toBeLessThan(1_100)
    for (let L = 2; L <= 200; L++) expect(p(L)).toBeGreaterThanOrEqual(p(L - 1))
    expect(mountSalePrice(DORE, 60, m)).toMatchObject({ method: 'interpolation', estimated: true })
  })

  it('ECO-05 : jamais un prix de niveau supérieur appliqué en dessous ; au-dessus du dernier ancrage, palier inférieur', () => {
    const only100: MountPriceContext = { mountOverrides: {}, generationOverrides: { 'muldo|1|100': 50_000 }, useDefaults: false }
    const low = mountSalePrice(DORE, 51, only100)
    expect(low.price).toBeNull()
    expect(low.references[0]).toMatchObject({ kind: 'niveau-superieur', price: 50_000, level: 100 })
    expect(mountSalePrice(DORE, 150, only100)).toMatchObject({ price: 50_000, method: 'palier-inferieur', estimated: true })
  })

  it('ECO-02 : un plancher de la recherche n’est jamais un prix de vente (référence « à saisir »)', () => {
    const floor = mountSalePrice(DORE, 1, defaultsMount)
    expect(floor.price).toBeNull()
    expect(floor.origin).toBe('manquant')
    expect(floor.references[0]).toMatchObject({ kind: 'plancher', price: 12_250, net: true })
    // Relevé observé récent (Muldo Doré niv. 100 ≈ 50 000) : utilisable, appliqué au-dessus (palier inférieur).
    expect(mountSalePrice(DORE, 100, defaultsMount)).toMatchObject({ price: 50_000, origin: 'defaut-espece', priceType: 'observed', method: 'exact' })
    expect(mountSalePrice(DORE, 150, defaultsMount)).toMatchObject({ price: 50_000, method: 'palier-inferieur' })
    expect(mountSalePrice(DORE, 60, defaultsMount).price).toBeNull()
  })

  it('ECO-03 : relevés anciens, peu fiables ou « à vérifier » exclus des décisions tant que le joueur ne les confirme pas', () => {
    const issues = Object.fromEntries(PRICES_DEFAULT.mounts.filter((r) => r.priceType === 'observed').map((r) => [`${r.name ?? r.family}|${r.state}|${r.price}`, defaultPriceIssue(r)]))
    expect(issues['dragodinde|féconde|650000']).toBe('a-verifier')
    expect(issues['dragodinde|fertile (capture fraîche)|12500']).toBe('ancien')
    expect(issues['Muldo Aigue-marine|inconnu|15000000']).toBe('peu-fiable')
    expect(issues['Muldo Doré|inconnu|50000']).toBeNull()
    const doree = byName('Dragodinde Dorée') // G1
    for (const L of [1, 100, 200]) {
      const f = mountSalePrice(doree, L, defaultsMount, { state: 'feconde' })
      expect(f.price).toBeNull()
      expect(f.references.some((r) => r.price === 650_000)).toBe(true)
      expect(mountValuation(doree, L, { ctx: defaultsCtx, mountPrices: defaultsMount, saleTax: 0.02, state: 'feconde' }).best ?? 0).toBeLessThan(100_000)
    }
    // Le joueur confirme (saisit le prix) : il redevient un prix de décision.
    const confirmed: MountPriceContext = { ...defaultsMount, generationOverrides: { 'dragodinde|1|1': 12_500 } }
    expect(mountSalePrice(byName('Dragodinde Amande'), 1, confirmed)).toMatchObject({ price: 12_500, origin: 'joueur-generation' })
  })

  it('sans prix par défaut ni saisie : manquant', () => {
    expect(mountSalePrice(DORE, 1, noMountPrices)).toMatchObject({ price: null, origin: 'manquant', references: [] })
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

  it('ECO-02 : le plancher reste une référence affichée, la valeur connue est une borne basse', () => {
    const v = mountValuation(DORE, 1, { ctx: defaultsCtx, mountPrices: defaultsMount, saleTax: 0.02 })
    expect(v.sale.net).toBeNull()
    expect(v.sale.reference).toMatchObject({ net: 12_250, kind: 'plancher' })
    expect(v.complete).toBe(false)
    expect(v.bestKind).not.toBe('vente')
    expect(v.best ?? 0).toBe(0)
  })

  it('G2 avec les défauts : l’extraction suit VOTRE prix d’Ambre, le plancher ne gagne jamais', () => {
    const v = mountValuation(DORE_INDIGO, 1, { ctx: defaultsCtx, mountPrices: defaultsMount, saleTax: 0.02 })
    expect(v.bestKind).toBe('extraction')
    expect(v.best).toBeCloseTo(35_280, 6)
    expect(v.complete).toBe(false)
    const cheapAmbre = mountValuation(DORE_INDIGO, 1, { ctx: { overrides: { [AMBRE]: 5_000 }, useDefaults: true }, mountPrices: defaultsMount, saleTax: 0.02 })
    expect(cheapAmbre.bestKind).toBe('extraction')
    expect(cheapAmbre.best).toBeCloseTo(9_800, 6)
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
  it('fécondité (lot idéal) : 60 000 points + sérénité par lot, divisés par la taille du lot', () => {
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
    expect(f.perBatchHigh).toBe(64_000)
    expect(f.secondsPerBatch).toBe(42_000)
    expect(fertilityCost({ tier: 1, batchSize: 5, serenityPointsPerMount: 4_000, ctx: fullCtx(), rules: R36 }).perMount).toBe(12_800)
  })

  it('fécondité incomplète si une jauge n’est pas chiffrée (jamais 0)', () => {
    const o = fullOverrides()
    delete o[findFuel('dragofesse', 1, 'gigantesque')!.id]
    const f = fertilityCost({ tier: 1, batchSize: 10, serenityPointsPerMount: 4_000, ctx: { overrides: o, useDefaults: false }, rules: R36 })
    expect(f.complete).toBe(false)
    expect(f.perBatch).toBe(44_000) // somme connue = borne basse
    expect(f.perBatchHigh).toBeNull()
    expect(f.missing.length).toBeGreaterThan(0)
    // Un palier 2 n'accepte pas les Extraits : rien n'est chiffré.
    expect(fertilityCost({ tier: 2, batchSize: 10, ctx: fullCtx(), rules: R36 }).complete).toBe(false)
  })

  it('ECO-04 : repli « estimation » signalé pour la Dragofesse T1 (indice de la recherche ≈ 13 K/pt), ÷ 2 en 3.7', () => {
    expect(FERTILITY_POINT_COST_HINTS.dragofesse?.[1]?.value).toBe(13)
    const f = fertilityCost({ tier: 1, batchSize: 10, ctx: defaultsCtx, rules: R36 })
    const d = f.lines.find((l) => l.gauge === 'dragofesse')!
    expect(d.pointCost).toMatchObject({ value: 13, complete: true, estimated: true, origin: 'estimation' })
    expect(d.costPerBatch).toBe(260_000)
    expect(f.estimated).toBe(true)
    expect(f.lines.find((l) => l.gauge === 'foudroyeur')!.complete).toBe(false)
    expect(fertilityCost({ tier: 1, batchSize: 10, ctx: defaultsCtx, rules: R37 }).lines.find((l) => l.gauge === 'dragofesse')!.pointCost.value).toBe(6.5)
    // Sans les prix par défaut : aucune estimation.
    expect(fertilityCost({ tier: 1, batchSize: 10, ctx: { overrides: {}, useDefaults: false }, rules: R36 }).lines.find((l) => l.gauge === 'dragofesse')!.complete).toBe(false)
  })

  it('durée de fécondité idéale (≈ 11 h 33 au palier 1, moitié au palier 2)', () => {
    expect(fertilitySeconds(1, R36, 3_200) / 3600).toBeCloseTo(11.56, 2)
    expect(fertilitySeconds(2, R36, 3_200)).toBe(fertilitySeconds(1, R36, 3_200) / 2)
  })

  it('F8 : lot typique = moyennes du planificateur (sérénité au palier 1), plus long que le lot idéal', () => {
    const t = batchProfile('typique', 2, R36)
    expect(t.points.dragofesse).toBe(TYPICAL_BATCH[2].points.dragofesse)
    expect(t.tiers).toMatchObject({ foudroyeur: 2, abreuvoir: 2, dragofesse: 2, baffeur: 1, caresseur: 1 })
    expect(t.seconds).toBe(TYPICAL_BATCH[2].seconds)
    expect(t.seconds).toBeGreaterThan(1.2 * fertilitySeconds(2, R36))
    const f = fertilityCost({ tier: 2, batchSize: 10, ctx: fullCtx(), rules: R36, model: 'typique' })
    expect(f.lines.find((l) => l.gauge === 'baffeur')!.tier).toBe(1)
    expect(f.secondsPerBatch).toBe(TYPICAL_BATCH[2].seconds)
  })

  it('F8 : les constantes du lot typique restent proches du planificateur d’enclos', () => {
    let s = 7
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0
      return s / 2 ** 32
    }
    let secs = 0
    const acc: Record<string, number> = {}
    const N = 16
    for (let k = 0; k < N; k++) {
      const lo = Math.round((-5000 + rnd() * 8000) / 100) * 100
      const mounts: SimMount[] = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, ability: null, serenity: Math.round((lo + rnd() * 2000) / 100) * 100, endurance: 0, maturity: 0, love: 0, canGainXp: false }))
      const plan = planPaddock(mounts, { tier: 2, rules: R36, withXp: false })
      secs += plan.totalSeconds
      for (const [g, v] of Object.entries(plan.consumed)) acc[g] = (acc[g] ?? 0) + v
    }
    const ref = TYPICAL_BATCH[2]
    expect(secs / N / ref.seconds).toBeGreaterThan(0.85)
    expect(secs / N / ref.seconds).toBeLessThan(1.15)
    for (const g of ['foudroyeur', 'abreuvoir', 'dragofesse'] as const) expect(Math.abs(acc[g] / N - ref.points[g]) / ref.points[g]).toBeLessThan(0.15)
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

  it('ECO-12 : au niveau 1 d’Éleveur, la Mangeoire T1 est payée au prix HDV (1 000), pas au craft (950)', () => {
    const l = levelingCost(1, 40, { tier: 1, batchSize: 10, ctx: defaultsCtx, rules: R36, jobLevel: 1 })
    expect(l.pointCost.fuel?.unitPrice).toBe(1_000)
    expect(l.pointCost.origin).toBe('defaut')
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

  it('ECO-07 : socle des paliers ≥ 2 = jauge vide → bas du palier, par enclos ; identique à la page Enclos', () => {
    const ctx: PriceContext = { overrides: allTiersOverrides(), useDefaults: false }
    const prof = batchProfile('typique', 2, R36)
    const inv = socleInvestment(prof.points, prof.tiers, 2, { ctx, rules: R36, jobLevel: 200, tier: 2 })
    expect(inv.lines.map((l) => [l.gauge, l.pointsPerPaddock, l.paddocks])).toEqual([
      ['foudroyeur', 40_000, 2],
      ['abreuvoir', 40_000, 2],
      ['dragofesse', 40_000, 2],
    ])
    const one = socleInvestment(prof.points, prof.tiers, 1, { ctx, rules: R36, jobLevel: 200, tier: 2 })
    const empty = { baffeur: 0, caresseur: 0, foudroyeur: 0, abreuvoir: 0, dragofesse: 0, mangeoire: 0 }
    const adv = refillAdvice({ gauges: empty }, { consumed: prof.points, tiers: prof.tiers }, { ctx, rules: R36, jobLevel: 200, tier: 2 })
    expect(one.total).toBeCloseTo(adv.baseCost as number, 6)
    expect(inv.total).toBeCloseTo(2 * one.total, 6)
    expect(socleInvestment(batchProfile('typique', 1, R36).points, batchProfile('typique', 1, R36).tiers, 3, { ctx, rules: R36, jobLevel: 200, tier: 1 }).lines).toEqual([])
  })
})

describe('économie d’un accouplement', () => {
  it('valeur attendue = Σ P × valeur, + génétons, − makina ; génétons nets de taxe si demandé', () => {
    const r = breed({ speciesId: DORE, level: 40, parents: [] }, { speciesId: INDIGO, level: 40, parents: [] }, { makina: 'optimakina' })
    expect(r.targetChance).toBeCloseTo(0.52, 10)
    const e = matingEconomics(r, { valueOf: (id) => (id === DORE_INDIGO ? 40_000 : 10_000), makinaCost: { price: 13_000, complete: true }, genetonValue: 375 })
    expect(e.expectedBabyValue).toBeCloseTo(0.52 * 40_000 + 0.48 * 10_000, 6)
    expect(e.expectedGenetons).toBeCloseTo(1.04, 10)
    expect(e.genetonsValue).toBeCloseTo(390, 6)
    expect(e.expectedNet).toBeCloseTo(25_600 + 390 - 13_000, 6)
    expect(e.complete).toBe(true)
    expect(matingEconomics(r, { valueOf: () => 0, genetonValue: 375, saleTax: 0.02 }).genetonsValue).toBeCloseTo(390 * 0.98, 6)
    const partial = matingEconomics(r, { valueOf: (id) => (id === DORE_INDIGO ? null : 10_000), genetonValue: 375 })
    expect(partial.complete).toBe(false)
    expect(partial.missingSpecies).toEqual([DORE_INDIGO])
  })
})

describe('Optimakina : même règle que l’Accouplement', () => {
  const g2 = breed({ speciesId: DORE, level: 40, parents: [] }, { speciesId: INDIGO, level: 40, parents: [] })
  const g2o = breed({ speciesId: DORE, level: 40, parents: [] }, { speciesId: INDIGO, level: 40, parents: [] }, { makina: 'optimakina' })

  it('réglage → mode : true = auto, false = jamais', () => {
    expect(optimakinaMode(true)).toBe('auto')
    expect(optimakinaMode(false)).toBe('jamais')
    expect(optimakinaMode('toujours')).toBe('toujours')
  })

  it('règle de prix C_eff × Δ / p ; prix inconnu → heuristique (G6+ ou objectif)', () => {
    const base = { mode: 'auto' as const, base: g2, withOpti: g2o }
    // seuil = 40 000 × 0,10 / 0,42 ≈ 9 524
    expect(decideOptimakina({ ...base, price: 5_000, priceComplete: true, coupleCost: 40_000 })).toMatchObject({ use: true, basis: 'regle-prix' })
    expect(decideOptimakina({ ...base, price: 13_000, priceComplete: true, coupleCost: 40_000 })).toMatchObject({ use: false, basis: 'regle-prix' })
    expect(decideOptimakina({ ...base, price: 13_000, priceComplete: true, coupleCost: 40_000 }).reason).toMatch(/^Optimakina non rentable/)
    expect(decideOptimakina({ ...base, price: null, priceComplete: false, coupleCost: null })).toMatchObject({ use: false, basis: 'heuristique' })
    // Même heuristique que pairing.adviseOptimakina : jamais en G2–G3 sans prix, même sur l'objectif ;
    // étape G4–G5 de l'objectif : oui (à défaut de prix) ; G6+ : oui.
    expect(decideOptimakina({ ...base, price: null, priceComplete: false, coupleCost: null, goalRelevant: true })).toMatchObject({ use: false, basis: 'heuristique' })
    const g4 = { ...base, base: { ...g2, targetGeneration: 4 } }
    expect(decideOptimakina({ ...g4, price: null, priceComplete: false, coupleCost: null, goalRelevant: true })).toMatchObject({ use: true, basis: 'heuristique' })
    expect(decideOptimakina({ ...g4, price: null, priceComplete: false, coupleCost: null })).toMatchObject({ use: false, basis: 'heuristique' })
    const g6 = { ...base, base: { ...g2, targetGeneration: 6 } }
    expect(decideOptimakina({ ...g6, price: null, priceComplete: false, coupleCost: null })).toMatchObject({ use: true, basis: 'heuristique' })
    for (const t of [2, 3, 4, 5, 6, 7, 9]) for (const goal of [false, true]) expect(optimakinaHeuristicUse(t, goal)).toBe(t >= 6 || (goal && t >= 4))
    expect(decideOptimakina({ ...base, mode: 'toujours', price: null, priceComplete: false, coupleCost: null }).use).toBe(true)
    expect(decideOptimakina({ ...base, mode: 'jamais', price: 1, priceComplete: true, coupleCost: 1e9 }).use).toBe(false)
  })

  it('ECO-08 / F10 : cycle G1 × G1 aux prix par défaut en « auto » : pas d’Optimakina ; classement : G2 sans, G7+ avec', () => {
    const r = cycleProfit({
      family: 'muldo',
      parentA: MULDO_EBENE,
      parentB: DORE,
      pairs: 5,
      parentLevel: 40,
      tier: 2,
      batchSize: 10,
      optimakina: true,
      includeCapture: true,
      saleTax: 0.02,
      ctx: defaultsCtx,
      mountPrices: defaultsMount,
      rules: R36,
      jobLevel: 1,
      genetonValue: 375,
    })
    expect(r.optimakina).toMatchObject({ use: false, mode: 'auto' })
    expect(r.materials.some((m) => m.category === 'makina')).toBe(false)
    expect(r.assumptions).toContain(r.optimakina.reason)
    const rows = crossingRanking('muldo', { tier: 2, batchSize: 10, parentLevel: 40, optimakina: true, saleTax: 0.02, ctx: defaultsCtx, mountPrices: defaultsMount, rules: R36, jobLevel: 1, genetonValue: 375 })
    expect(rows.filter((x) => x.targetGeneration === 2).every((x) => !x.usesOptimakina)).toBe(true)
    expect(rows.filter((x) => x.targetGeneration >= 7 && x.targetChance < 1).every((x) => x.usesOptimakina)).toBe(true)
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
    optimakina: 'toujours',
    includeCapture: true,
    saleTax: 0.02,
    batchModel: 'ideal',
    ctx: fullCtx(),
    mountPrices: mprices,
    rules: R36,
    jobLevel: 200,
    genetonValue: 375,
  })

  it('Muldo Doré × Indigo, 5 couples, tout chiffré (lot idéal) : coûts, revenus et bénéfice attendus', () => {
    const r = cycleProfit(base())
    expect(r.complete).toBe(true)
    expect(r.profitStatus).toBe('exact')
    expect(r.mounts).toBe(10)
    expect(r.batches).toBe(1)
    const qty = Object.fromEntries(r.materials.map((m) => [m.key, [m.qty, m.subtotal]]))
    expect(qty['fert-foudroyeur']).toEqual([4, 20_000])
    expect(qty['fert-baffeur']).toEqual([1, 5_000]) // 1 600 points → 1 objet entier
    expect(qty['xp-mangeoire']).toEqual([5, 25_000]) // 20 437 points
    expect(qty['makina']).toEqual([5, 65_000])
    expect(qty['capture']).toEqual([10, 10_000])
    expect(r.materials.some((m) => m.category === 'parents')).toBe(false) // parents G1 capturés
    expect(r.costByCategory.fecondite.value).toBe(70_000)
    expect(r.totalCost).toBe(170_000)
    expect(r.materialCost).toBe(170_000)
    // Bébés : 5 × (0,52 × 39 200 + 0,48 × 9 800) ; stériles : 10 × 9 800 ; génétons : 5,2 × 375 × 0,98.
    expect(r.totalRevenue).toBeCloseTo(125_440 + 98_000 + 1_911, 6)
    expect(r.profit).toBeCloseTo(55_351, 6)
    expect(r.ranges.profit.low).toBeCloseTo(55_351, 6)
    expect(r.ranges.profit.high).toBeCloseTo(55_351, 6)
    expect(r.roi).toBeCloseTo(55_351 / 170_000, 10)
    expect(r.seconds.fertility).toBe(41_600)
    expect(r.seconds.leveling).toBeCloseTo(437, 6)
    expect(r.kamasPerHour).toBeCloseTo(55_351 / (42_037 / 3600), 6)
    expect(r.expectedTargetBabies).toBeCloseTo(2.6, 10)
    expect(r.jobXp).toBe(5 * 30 * 2)
    expect(r.initial.lines).toEqual([]) // palier 1 : pas de socle
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

  it('sans Optimakina ni capture : pas de makina ni de filet, parents G1 comptés à leur valeur actuelle', () => {
    const r = cycleProfit({ ...base(), optimakina: false, includeCapture: false })
    expect(r.materials.some((m) => m.category === 'makina' || m.category === 'capture')).toBe(false)
    expect(r.breed.targetChance).toBeCloseTo(0.42, 10)
    expect(r.costByCategory.parents.value).toBeCloseTo(10 * 9_800, 6)
  })

  it('ECO-06 : stériles gardées pour cloner = ½ × (clone fertile − refécondation)', () => {
    const r = cycleProfit({ ...base(), sterileFate: 'cloner' })
    const st = r.revenue.find((l) => l.key === `sterile-${DORE}`)!
    expect(st.fate).toBe('clone')
    const refecund = (60_000 + 3_200) / 10 // lot idéal à 1 K/pt
    expect(st.unitValue).toBeCloseTo(0.5 * (9_800 - refecund), 6)
    // G9 aux prix par défaut : bien plus que l'ancien ½ plancher G1 (6 125).
    const ctx: PriceContext = { overrides: allTiersOverrides(), useDefaults: true }
    delete ctx.overrides[AMBRE]
    const val = (id: number, level: number, state: 'fertile' | 'feconde' | 'sterile'): MountValuation => mountValuation(id, level, { ctx, mountPrices: defaultsMount, saleTax: 0.02, state })
    const g9 = sterileValue(MULDO_AMBRE, 40, { low: refecund, high: refecund }, val, 'cloner')
    expect(g9.unit).toBeGreaterThanOrEqual(0.5 * (9 * 18_000 * 0.98 - refecund) - 1e-6)
    const g9cycle = { ...base(), parentA: MULDO_AMBRE, parentB: MULDO_CORAIL, ctx, mountPrices: defaultsMount }
    const best = cycleProfit(g9cycle)
    const clone = cycleProfit({ ...g9cycle, sterileFate: 'cloner' })
    expect(clone.revenue.find((l) => l.kind === 'sterile')!.unitValue).toBeCloseTo(0.5 * (158_760 - refecund), 6)
    // « meilleur » inclut l'option clonage : jamais moins que l'extraction seule.
    expect(best.revenue.find((l) => l.kind === 'sterile')!.unitValue).toBeCloseTo(158_760, 6)
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
    expect(r.ranges.profit.low).toBeNull()
    expect(r.ranges.profit.high).toBeCloseTo(r.profit, 6)
    expect(r.profitStatus).toBe('borne-haute')
    expect(r.warnings.some((w) => w.includes('incomplet'))).toBe(true)

    const empty = cycleProfit({ ...base(), ctx: { overrides: {}, useDefaults: false }, mountPrices: noMountPrices })
    expect(empty.complete).toBe(false)
    expect(empty.revenueComplete).toBe(false)
    expect(empty.missingSpecies.length).toBeGreaterThan(0)
    expect(empty.profitStatus).toBe('inconnu')
  })

  it('ECO-01 : des parents G9 engagés sont un coût ; leur liquidation n’est plus un bénéfice', () => {
    const cfg: CycleConfig = { ...base(), parentA: MULDO_AMBRE, parentB: MULDO_CORAIL, tier: 2, batchModel: 'typique', optimakina: true, ctx: defaultsCtx, mountPrices: defaultsMount, jobLevel: 1 }
    const r = cycleProfit(cfg)
    const steriles = r.revenue.filter((l) => l.kind === 'sterile').reduce((s, l) => s + (l.subtotal ?? 0), 0)
    expect(steriles).toBeCloseTo(10 * 158_760, 0)
    expect(r.costByCategory.parents.value).toBeCloseTo(10 * 158_760, 0)
    const babies = r.revenue.filter((l) => l.kind !== 'sterile').reduce((s, l) => s + (l.subtotal ?? 0), 0)
    expect(r.profit).toBeCloseTo(babies - r.materialCost, 0)
    expect(r.assumptions.some((a) => a.includes('coût d\'opportunité'))).toBe(true)
    // « Hors valeur des parents » : ni coût ni stériles.
    const hors = cycleProfit({ ...cfg, parentValue: 'hors' })
    expect(hors.revenue.some((l) => l.kind === 'sterile')).toBe(false)
    expect(hors.costByCategory.parents.value).toBe(0)
    expect(hors.profit).toBeCloseTo(r.profit, 0)
    // Classement : stériles = valeur de départ ⇒ la marge avec les parents égale la marge sans.
    const opts = { tier: 2 as const, batchSize: 10, parentLevel: 40, optimakina: 'jamais' as const, saleTax: 0.02, ctx: defaultsCtx, mountPrices: defaultsMount, rules: R36, jobLevel: 1, genetonValue: 375 }
    const key = `${MULDO_AMBRE}-${MULDO_CORAIL}`
    const withP = crossingRanking('muldo', opts).find((x) => x.key === key) ?? crossingRanking('muldo', opts).find((x) => x.key === `${MULDO_CORAIL}-${MULDO_AMBRE}`)!
    const without = crossingRanking('muldo', { ...opts, includeSteriles: false }).find((x) => x.key === withP.key)!
    expect(withP.parentDelta).toBeCloseTo(0, 6)
    expect(withP.margin).toBeCloseTo(without.margin, 6)
  })

  it('ECO-02 : le cycle par défaut (Ébène × Doré) n’est pas présenté comme complet : prix de G1 à saisir', () => {
    const r = cycleProfit({ ...base(), parentA: MULDO_EBENE, parentB: DORE, tier: 2, batchModel: 'typique', optimakina: true, ctx: defaultsCtx, mountPrices: defaultsMount, jobLevel: 1 })
    expect(r.revenueComplete).toBe(false)
    expect(r.revenue.some((l) => l.unitValue === 12_250)).toBe(false)
    const g1 = r.revenue.find((l) => l.kind === 'bebe' && l.speciesId === DORE)!
    expect(g1.complete).toBe(false)
    expect(g1.reference?.net).toBe(12_250)
  })

  it('ECO-04 : jauges de fécondité non chiffrées → bénéfice « inconnu » avec la part des points ; variantes non comparables', () => {
    const cfg: CycleConfig = { ...base(), parentA: MULDO_EBENE, parentB: DORE, tier: 2, batchModel: 'typique', optimakina: true, ctx: defaultsCtx, mountPrices: defaultsMount, jobLevel: 1 }
    const r = cycleProfit(cfg)
    expect(r.profitStatus).toBe('inconnu')
    expect(r.unpricedFertility.share).toBeGreaterThan(0.5)
    expect(r.unpricedFertility.gauges).toContain('foudroyeur')
    expect(r.ranges.kamasPerHour.low).toBeNull()
    expect(r.ranges.roi.low).toBeNull()
    const t1 = cycleProfit({ ...cfg, tier: 1, xpTier: 1 })
    const t4 = cycleProfit({ ...cfg, tier: 4, xpTier: 4 })
    expect(cyclesComparable(r, t1)).toBe(false)
    expect(cyclesComparable(r, t4)).toBe(false)
    expect(cyclesComparable(r, cycleProfit({ ...cfg, pairs: 6 }))).toBe(true)
    // Ligne bornée par un palier supérieur : l'objet à acheter reste celui du palier entretenu.
    for (const l of r.materials.filter((m) => m.category === 'fecondite' && m.upperBound !== undefined && m.upperBound !== null && m.itemId !== null))
      expect(FUELS.find((f) => f.id === l.itemId)!.tier).toBe(l.tier)
  })

  it('ECO-05 : bénéfice continu aux niveaux 50/51 et 150/151', () => {
    const m: MountPriceContext = {
      mountOverrides: {},
      generationOverrides: { 'muldo|1|1': 10_000, 'muldo|1|100': 40_000, 'muldo|1|200': 120_000, 'muldo|2|1': 30_000, 'muldo|2|100': 60_000, 'muldo|2|200': 160_000 },
      useDefaults: false,
    }
    const at = (L: number) => cycleProfit({ ...base(), parentLevel: L, mountPrices: m }).profit
    expect(Math.abs(at(51) - at(50))).toBeLessThan(10_000)
    expect(Math.abs(at(151) - at(150))).toBeLessThan(20_000)
  })

  it('F8 / ECO-07 : lot typique par défaut, socle du palier 2 en investissement initial (hors bénéfice récurrent)', () => {
    const ctx: PriceContext = { overrides: allTiersOverrides(), useDefaults: false }
    const r = cycleProfit({ ...base(), tier: 2, batchModel: undefined, ctx, paddocks: 1 })
    expect(r.batch.model).toBe('typique')
    expect(r.materials.find((m) => m.key === 'fert-dragofesse')!.points).toBe(TYPICAL_BATCH[2].points.dragofesse)
    expect(r.seconds.fertility).toBe(TYPICAL_BATCH[2].seconds)
    expect(r.seconds.idealFertility).toBeLessThan(r.seconds.fertility)
    expect(r.initial.lines.map((l) => [l.gauge, l.pointsPerPaddock])).toEqual([
      ['foudroyeur', 40_000],
      ['abreuvoir', 40_000],
      ['dragofesse', 40_000],
      ['mangeoire', 40_000],
    ])
    expect(r.initial.total).toBeGreaterThan(0)
    expect(r.firstCycleCash.low).toBeCloseTo(r.materialCost + r.initial.total, 6)
    expect(r.profit).toBeCloseTo(r.totalRevenue - r.totalCost, 6) // socle hors bénéfice
    expect(r.assumptions.some((a) => a.startsWith('Socle'))).toBe(true)
  })

  it('F8 : un profil « vos lots » (38 180 pts de Dragofesse) remplace les 20 000 du lot idéal', () => {
    const prof = batchProfileFromPlans([{ consumed: { dragofesse: 38_180, abreuvoir: 22_080, baffeur: 4_800, caresseur: 4_000 }, totalSeconds: 32_040, tiers: { dragofesse: 1, abreuvoir: 1, baffeur: 1, caresseur: 1 } }], 1)!
    const r = cycleProfit({ ...base(), batchProfile: prof })
    expect(r.materials.find((m) => m.key === 'fert-dragofesse')!.points).toBe(38_180)
    expect(r.seconds.fertility).toBe(32_040)
    expect(r.batch.model).toBe('mes-lots')
    expect(batchProfileFromPlans([], 1)).toBeNull()
  })

  it('ECO-13 : coût net par bébé cible = (coûts − bébés ratés − stériles) / bébés cibles', () => {
    const r = cycleProfit(base())
    const residual = r.revenue.filter((l) => (l.kind === 'bebe' && !l.target) || l.kind === 'sterile').reduce((s, l) => s + (l.subtotal ?? 0), 0)
    expect(r.netCostPerTargetBaby).toBeCloseTo((r.totalCost - residual) / r.expectedTargetBabies, 6)
    expect(r.costPerTargetBaby).toBeCloseTo(r.materialCost / r.expectedTargetBabies, 6)
    expect(r.netCostComplete).toBe(true)
  })

  it('ECO-14 : génétons nets de taxe, estimation signalée avec sa fourchette', () => {
    const r = cycleProfit(base())
    const g = r.revenue.find((l) => l.kind === 'genetons')!
    expect(g.unitValue).toBeCloseTo(375 * 0.98, 6)
    expect(g.estimated).toBe(true)
    expect(g.note).toContain('125')
    expect(cycleProfit({ ...base(), genetonOrigin: 'joueur' }).revenue.find((l) => l.kind === 'genetons')!.estimated).toBe(false)
  })

  it('ECO-11 : une ligne de carburant au prix par défaut contredit par vos ingrédients est signalée', () => {
    const ctx: PriceContext = { overrides: { 1844: 600, 6841: 2_400 }, useDefaults: true }
    const r = cycleProfit({ ...base(), ctx, tier: 1, xpTier: 1, jobLevel: 200 })
    const xp = r.materials.find((m) => m.key === 'xp-mangeoire')!
    expect(xp.itemId).toBe(33331)
    expect(xp.unitPrice).toBe(1_000)
    expect(xp.conflict).toContain('vos ingrédients 3')
  })

  it('ECO-15 : plus d’enclos que débloqués → avertissement', () => {
    expect(unlockedPaddockCount(1)).toBe(1)
    expect(unlockedPaddockCount(120)).toBe(4)
    const r = cycleProfit({ ...base(), pairs: 30, paddocks: 6, jobLevel: 1 })
    expect(r.unlockedPaddocks).toBe(1)
    expect(r.warnings.some((w) => w.includes('que 1 enclos'))).toBe(true)
    expect(cycleProfit({ ...base(), pairs: 30, paddocks: 1, jobLevel: 1 }).warnings.some((w) => w.includes('enclos débloqué'))).toBe(false)
  })
})

describe('classement des croisements', () => {
  it('tous les croisements Muldo, triés par marge ; marge du Doré × Indigo', () => {
    const rows = crossingRanking('muldo', {
      tier: 1,
      batchSize: 10,
      parentLevel: 40,
      optimakina: 'toujours',
      batchModel: 'ideal',
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
    // 25 088 (bébés) + 382,2 (génétons nets) + 0 (stériles 19 600 − parents 19 600) − 12 640 (fécondité) − 4 087,4 (XP) − 13 000 (makina)
    expect(row.parentDelta).toBeCloseTo(0, 6)
    expect(row.margin).toBeCloseTo(-4_257.2, 6)
    expect(row.marginRange.low).toBeCloseTo(row.margin, 6)
    expect(row.marginRange.high).toBeCloseTo(row.margin, 6)
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
