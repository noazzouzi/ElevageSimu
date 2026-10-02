// Tests du moteur de production (production.ts) et de son worker.
import tylezia from '../data/market/tylezia-2026-10-02.json'
import { FAMILIES, getSpecies, SPECIES } from '../data'
import { bestNetKind, sessionsPerDayFor } from './advisor'
import { buildSnapshot, marketSourceOf, parseHdvCsv, sanitizeSnapshot, type MarketSource } from './market'
import type { PriceContext } from './pricing'
import {
  AUTO_TARGET_GENERATIONS,
  capturesPerFight,
  compareModes,
  compareRanked,
  conservativeMountMarketPrice,
  defaultGrid,
  netKindForJobLevel,
  normalizeProductionConfig,
  optimizeMode,
  optimizeModeAsync,
  productionPlan,
  PROFIT_MODES,
  rangeStatus,
  runProduction,
  runProductionAsync,
  sessionsForHours,
  simulateProduction,
  statisticalTie,
  rankWithTies,
  REFINE_SEED_OFFSET,
  MAX_EXTENDED_DAYS,
  productionPriceBook as productionPriceBookFor,
  steadyWindowStart,
  strategyLabel,
  type ProductionConfig,
  type ProductionRun,
} from './production'
import { handleProductionRequest, type ProductionWorkerMessage } from './production.worker'
import { expectedEffort } from './breedingPath'
import { runProgram } from './programSim'
import { RULESETS } from './rules'
import { formatNumber } from '../lib/format'

const rules = RULESETS['3.6']
const tyleziaMarket: MarketSource = marketSourceOf(sanitizeSnapshot(tylezia).snapshot!, 'auto', 'Tylezia')
const tyleziaCtx: PriceContext = { overrides: {}, useDefaults: true, market: tyleziaMarket, jobLevel: 120 }

/** Extrait réel de l'export HDV de Tylezia (02/10/2026) : ressources, runes, filet, parchemins. */
const CSV_FIXTURE = [
  'gid;nom;niveau;type;categorie;vendus_24h;vendus_7j;vendus_30j;median_30j;moyen_30j;median_24h;kamas_par_jour',
  '1557;Rune Ga Pa;100;Rune de forgemagie;Ressource;10673;85651;310552;29534;29646;28598;305728092',
  '1558;Rune Ga Pme;95;Rune de forgemagie;Ressource;10429;75498;239222;21460;21898;21509;171123470',
  '19975;Corne de volkorne;60;Os;Ressource;10744;38301;127342;30205;32111;26497;128212170',
  '17864;Ambre de muldo;60;Ressource diverse;Ressource;2410;18645;72027;33823;33930;31285;81205640',
  '33515;Neurone de dragodinde;60;Ressource diverse;Ressource;2203;17611;67939;26056;28517;28987;59007286',
  '809;Petit Parchemin de Chance;1;Parchemin de caractéristique;Consommable;1503;12301;45497;5393;5323;5079;8178844',
  '32521;Filet de capture universel;1;Filet de capture;Consommables de combat;1187;20520;78731;1305;1317;1399;3424798',
].join('\n')

function fixtureMarket(edit?: (csv: string) => string): MarketSource {
  const parsed = parseHdvCsv(edit ? edit(CSV_FIXTURE) : CSV_FIXTURE)
  return marketSourceOf(buildSnapshot(parsed, { serverName: 'Tylezia', exportDate: '2026-10-02' }), 'auto', 'Tylezia')
}

/** Prix du préréglage de Tylezia + un marché réduit (liquidité de la Corne modifiable). */
function ctxWith(market: MarketSource, overrides: Record<string, number> = {}): PriceContext {
  // Carburants, makinas, filets : prix du préréglage ; ressources : marché donné.
  const rows = { ...tyleziaMarket.rows, ...market.rows }
  return { overrides, useDefaults: true, market: { ...tyleziaMarket, rows }, jobLevel: 120 }
}

function base(over: Partial<ProductionConfig> = {}): ProductionConfig {
  return {
    family: 'volkorne',
    mode: 'extraction',
    targetGeneration: 3,
    paddocks: 2,
    hoursPerDay: 3,
    characters: 1,
    jobLevel: 120,
    rules,
    prices: { ctx: tyleziaCtx },
    horizonDays: 30,
    tier: 2,
    ...over,
  }
}

function conserved(run: ProductionRun): void {
  const l = run.ledger
  const inflow = l.initial + l.captured + l.bought + l.born
  const outflow = l.extracted + l.broken + l.sold + l.kept + l.discarded + l.cloneLost + l.remaining
  expect(outflow).toBe(inflow)
  const invTotal = Object.values(run.inventory).reduce((s, o) => s + Object.values(o).reduce((a, b) => a + b, 0), 0)
  expect(invTotal).toBe(l.remaining)
}

describe('réglages du moteur de production', () => {
  it('reprend le barème des sessions et des filets du Plan et de l’accueil', () => {
    for (const h of [0.5, 1, 3, 4, 6, 8, 12, 24]) expect(sessionsForHours(h)).toBe(sessionsPerDayFor(h))
    for (const j of [1, 99, 100, 149, 150, 199, 200]) expect(netKindForJobLevel(j)).toBe(bestNetKind(j))
  })

  it('plafonne les captures par combat à la taille d’un groupe', () => {
    expect(capturesPerFight(1, 1, 'universel')).toBe(1)
    expect(capturesPerFight(4, 2, 'multiplicateur')).toBe(8)
    expect(capturesPerFight(4, 6, 'renforce')).toBe(8)
    expect(capturesPerFight(8, 12, 'multiplicateur_renforce')).toBe(16)
  })

  it('normalise une configuration (valeurs par défaut, bornes)', () => {
    const n = normalizeProductionConfig({ ...base(), targetGeneration: 42, paddocks: 9, parentLevel: undefined, tier: undefined, mateBeforeExtract: undefined })
    expect(n.targetGeneration).toBe(10)
    expect(n.paddocks).toBe(6)
    expect(n.parentLevel).toBe(40)
    expect(n.tier).toBe(2)
    expect(n.mateBeforeExtract).toBe(true)
    expect(n.cloneMaxGeneration).toBe(9)
    expect(n.sessionsPerDay).toBe(2)
    expect(n.netKind).toBe('multiplicateur')
    expect(n.captureRate).toBe(2 * 12)
    expect(() => normalizeProductionConfig({ ...base(), family: 'dragodinde', mode: 'brisage' })).toThrow(/brisage/i)
  })

  it('liste les modes de rentabilité de la spécification', () => {
    expect(PROFIT_MODES.map((m) => m.id)).toEqual(['rush-corne', 'rush-ambre', 'rush-neurone', 'brisage-pa', 'brisage-pm', 'vente-montures', 'progression', 'auto'])
    expect(PROFIT_MODES.find((m) => m.id === 'rush-corne')?.itemId).toBe(FAMILIES.volkorne.extractionItemId)
  })
})

describe('plan de production', () => {
  it('suit la recette la moins chère et répartit les captures selon le besoin', () => {
    const plan = productionPlan(base({ targetGeneration: 3 }))
    expect(plan.targetGeneration).toBe(3)
    expect(plan.targets).toHaveLength(1)
    expect(getSpecies(plan.targets[0])?.generation).toBe(3)
    const shares = plan.captureShares.reduce((s, c) => s + c.share, 0)
    expect(shares).toBeCloseTo(1, 6)
    // Une couleur G1 présente dans deux croisements est capturée deux fois plus.
    const max = Math.max(...plan.captureShares.map((c) => c.share))
    const min = Math.min(...plan.captureShares.map((c) => c.share))
    expect(max / min).toBeGreaterThan(1.5)
  })

  it('résout la génération visée « auto » par un tri rapide, ou d’après les espèces imposées', () => {
    const auto = productionPlan(base({ targetGeneration: 'auto', paddocks: 2, horizonDays: 20 }))
    expect(AUTO_TARGET_GENERATIONS).toContain(auto.targetGeneration)
    const imposed = productionPlan(base({ targetGeneration: 'auto', targetSpeciesIds: [186] }))
    expect(imposed.targetGeneration).toBe(7)
    expect(imposed.targets).toEqual([186])
    expect(normalizeProductionConfig(base({ mode: 'brisage' })).targetGeneration).toBe(1)
  })

  it('décide l’Optimakina par génération avec la règle de prix (C_eff × Δ / p)', () => {
    const plan = productionPlan(base({ targetGeneration: 6, optimakina: 'auto' }))
    const g2 = plan.optimakina.find((o) => o.generation === 2)
    // G1 × G1 : les parents ne valent rien à l'extraction, l'Optimakina G2 (≈ 5 500 K) dépasse le seuil.
    expect(g2?.use).toBe(false)
    expect(g2?.reason).toMatch(/seuil/)
    const g6 = plan.optimakina.find((o) => o.generation === 6)
    expect(g6?.use).toBe(true)
    expect(productionPlan(base({ targetGeneration: 6, optimakina: 'none' })).optimakina.every((o) => !o.use)).toBe(true)
  })

  it('choisit en vente les montures les mieux payées (prix prudent « HDV mixte »)', () => {
    const plan = productionPlan(base({ mode: 'vente', targetGeneration: 4, family: 'volkorne' }))
    expect(plan.targets.length).toBeGreaterThan(0)
    expect(plan.targets.every((t) => getSpecies(t)?.generation === 4)).toBe(true)
    const p = conservativeMountMarketPrice(tyleziaMarket, plan.targets[0])
    expect(p?.price).toBeGreaterThan(0)
    // Prix prudent : min(médiane 30 j, médiane 24 h) × 0,85.
    const row = tyleziaMarket.rows[String(getSpecies(plan.targets[0])?.itemId)]
    expect(p?.price).toBeLessThanOrEqual(row[0] * 0.85 + 1e-6)
  })
})

describe('simulation', () => {
  it('est reproductible pour une graine donnée', () => {
    const a = simulateProduction(base(), 7)
    const b = simulateProduction(base(), 7)
    const c = simulateProduction(base(), 8)
    expect(a.days.map((d) => d.netKnown)).toEqual(b.days.map((d) => d.netKnown))
    expect(a.days.map((d) => d.births)).not.toEqual(c.days.map((d) => d.births))
  })

  it('conserve les montures (entrées = sorties + stock) dans tous les modes', () => {
    conserved(simulateProduction(base({ mateBeforeExtract: true }), 1))
    conserved(simulateProduction(base({ mateBeforeExtract: false, cloning: { maxGeneration: 1 } }), 2))
    conserved(simulateProduction(base({ targetGeneration: 5, paddocks: 3 }), 3))
    conserved(simulateProduction(base({ mode: 'vente', targetGeneration: 2 }), 4))
    conserved(simulateProduction(base({ mode: 'progression', targetGeneration: 4 }), 5))
    conserved(simulateProduction(base({ mode: 'brisage', mateBeforeExtract: false }), 6))
    conserved(simulateProduction(base({ mode: 'brisage', mateBeforeExtract: true, family: 'muldo' }), 7))
    conserved(
      simulateProduction(
        base({
          buyG1PerDay: 6,
          g1Price: 20_000,
          initialStock: [
            { speciesId: 176, count: 4 },
            { speciesId: 196, count: 3, state: 'feconde', level: 40 },
            { speciesId: 196, count: 3, state: 'sterile' },
          ],
        }),
        8,
      ),
    )
  })

  it('respecte le temps de capture et ne capture que pour remplir les places libres', () => {
    const run = simulateProduction(base({ targetGeneration: 2, paddocks: 6, captureRate: 4, captureHoursPerDay: 1 }), 1)
    for (const d of run.days) expect(d.captures).toBeLessThanOrEqual(4 + 1)
    const total = run.days.reduce((s, d) => s + d.captures, 0)
    expect(total).toBeGreaterThan(30 * 3)
    // Chaque capture rapporte 30 XP d'Éleveur.
    expect(run.days[0].jobXp).toBeGreaterThanOrEqual(30 * run.days[0].captures)
  })

  it('débloque des enclos en cours de route (jalons du métier)', () => {
    const run = simulateProduction(base({ targetGeneration: 2, paddocks: 1, paddockSchedule: [{ day: 11, paddocks: 3 }], horizonDays: 20 }), 1)
    expect(run.days[5].paddocks).toBe(1)
    expect(run.days[15].paddocks).toBe(3)
    const before = run.days.slice(3, 10).reduce((s, d) => s + d.fecundations, 0)
    const after = run.days.slice(13, 20).reduce((s, d) => s + d.fecundations, 0)
    expect(after).toBeGreaterThan(2 * before)
    // Un lot occupe ses places : jamais plus de fécondations par jour que de places × sessions.
    for (const d of run.days) expect(d.fecundations).toBeLessThanOrEqual(d.paddocks * 10 * 2)
  })

  it('accouple les montures condamnées avant de les extraire (bébé gratuit)', () => {
    const withMbe = runProduction(base({ targetGeneration: 4, mateBeforeExtract: true }), { runs: 2 })
    const without = runProduction(base({ targetGeneration: 4, mateBeforeExtract: false }), { runs: 2 })
    expect(withMbe.steady.condemnedMatingsPerDay).toBeGreaterThan(0)
    expect(without.steady.condemnedMatingsPerDay).toBe(0)
    expect(without.routine.condemnedMatingsPerDay).toBe(0)
  })

  it('suit le modèle de naissance : à G2 sans makina, ≈ B = 42 % des accouplements G1 × G1 (parents niv. 40)', () => {
    const s = runProduction(base({ targetGeneration: 2, optimakina: 'none', mateBeforeExtract: false, paddocks: 6, horizonDays: 60 }), { runs: 3 })
    const births = s.totals.births
    const g2 = s.daily.reduce((sum, d) => sum + d.targetBirths, 0)
    expect(g2 / births).toBeGreaterThan(0.38)
    expect(g2 / births).toBeLessThan(0.46)
    // Extraction : 2 Cornes par G2.
    expect(s.totals.resources).toBeCloseTo(2 * g2, 6)
  })
})

describe('valorisation', () => {
  it('chiffre une production de Cornes aux prix de Tylezia (complet, non saturé)', () => {
    const s = runProduction(base({ targetGeneration: 4, paddocks: 4, horizonDays: 40 }), { runs: 2 })
    expect(s.complete).toBe(true)
    expect(s.steady.status).toBe('exact')
    expect(s.steady.resourcesPerDay).toBeGreaterThan(10)
    expect(s.steady.revenueByCategory.ressources).toBeGreaterThan(0)
    expect(s.steady.costByCategory.carburant).toBeGreaterThan(0)
    expect(s.steady.netPerDay.mean).toBeGreaterThan(0)
    const corne = s.market.find((m) => m.kind === 'ressource')
    expect(corne?.itemId).toBe(19975)
    expect(corne?.saturated).toBe(false)
    expect(corne?.capPerDay).toBeCloseTo((127342 / 30) * 0.15, 3)
    // Revenu = Cornes vendues × prix (médiane 24 h, ≥ 5 ventes) × (1 − taxe) + génétons.
    const d = s.daily[s.daily.length - 1]
    expect(d.resourcesSold).toBeGreaterThan(0)
    // Routine : carburant par jauge avec le nombre d'objets.
    expect(s.routine.fuel.find((f) => f.gauge === 'foudroyeur')?.itemsPerDay).toBeGreaterThan(0)
    expect(s.routine.capturesPerDay.length).toBeGreaterThan(0)
    expect(s.assumptions.length).toBeGreaterThan(3)
  })

  it('plafonne les ventes par la liquidité du marché et reporte le stock', () => {
    const tiny = fixtureMarket((csv) => csv.replace('19975;Corne de volkorne;60;Os;Ressource;10744;38301;127342;', '19975;Corne de volkorne;60;Os;Ressource;10;100;300;'))
    const s = runProduction(base({ targetGeneration: 3, paddocks: 3, prices: { ctx: ctxWith(tiny) } }), { runs: 1 })
    const cap = (300 / 30) * 0.15
    const sold = s.totals.resourcesSold
    expect(sold).toBeLessThanOrEqual(Math.ceil(cap * 30) + 1)
    expect(s.totals.resources).toBeGreaterThan(sold)
    const corne = s.market.find((m) => m.kind === 'ressource')
    expect(corne?.saturated).toBe(true)
    expect(corne?.endStock).toBeGreaterThan(0)
    expect(s.warnings.some((w) => w.code === 'saturation')).toBe(true)
  })

  it('ne compte jamais un prix inconnu comme 0 (bornes et prix à saisir)', () => {
    const ctx: PriceContext = { overrides: {}, useDefaults: false, market: null }
    const s = runProduction(base({ prices: { ctx, includeGenetons: false } }), { runs: 1 })
    expect(s.complete).toBe(false)
    expect(s.missing).toContain(19975)
    expect(s.steady.net.low).toBeNull()
    expect(s.steady.net.high).toBeNull()
    expect(s.steady.status).toBe('inconnu')
    expect(s.steady.revenueKnown).toBe(0)
    const corne = s.prices.find((p) => p.key === 'ressource')
    expect(corne?.value).toBeNull()
    expect(s.warnings.some((w) => w.code === 'prix-manquants')).toBe(true)
    expect(s.warnings.some((w) => w.code === 'liquidite-inconnue')).toBe(true)
    // Un coût partiel reste une borne basse : jamais présenté comme exact.
    expect(rangeStatus({ low: 10, high: null })).toBe('borne-basse')
    expect(rangeStatus({ low: null, high: 10 })).toBe('borne-haute')
  })

  it('plafonne les génétons par le volume du parchemin et les exclut sur demande', () => {
    const s = runProduction(base({ targetGeneration: 4, paddocks: 3 }), { runs: 1 })
    expect(s.totals.genetons).toBeGreaterThan(0)
    expect(s.steady.revenueByCategory.genetons).toBeGreaterThan(0)
    const none = runProduction(base({ targetGeneration: 4, paddocks: 3, prices: { ctx: tyleziaCtx, includeGenetons: false } }), { runs: 1 })
    expect(none.steady.revenueByCategory.genetons).toBe(0)
  })

  it('compte le socle des paliers ≥ 2 comme capital, pas comme coût', () => {
    const t2 = runProduction(base({ tier: 2 }), { runs: 1 })
    const t1 = runProduction(base({ tier: 1, xpTier: 1 }), { runs: 1 })
    expect(t2.capital.socleLow).toBeGreaterThan(0)
    expect(t1.capital.socleLow).toBe(0)
    expect(t2.capital.total).toBeGreaterThanOrEqual(t2.capital.socleLow)
  })

  it('sensibilité : les facteurs de prix et de durée changent le bénéfice', () => {
    const ref = runProduction(base({ targetGeneration: 3 }), { runs: 1 })
    const cheap = runProduction(base({ targetGeneration: 3, prices: { ctx: tyleziaCtx, revenueFactor: 0.8 } }), { runs: 1 })
    const slow = runProduction(base({ targetGeneration: 3, durationFactor: 1.5 }), { runs: 1 })
    expect(cheap.steady.revenueKnown).toBeCloseTo(ref.steady.revenueKnown * 0.8, -2)
    expect(slow.batch.sessions).toBeGreaterThanOrEqual(ref.batch.sessions)
  })
})

describe('brisage et vente', () => {
  it('brisage : capture, montée au niveau visé, puis runes Ga (risque signalé)', () => {
    const s = runProduction(base({ mode: 'brisage', brisageLevel: 53, mateBeforeExtract: false, tier: 1, paddocks: 3 }), { runs: 1 })
    expect(s.totals.matings).toBe(0)
    expect(s.totals.broken).toBeGreaterThan(0)
    expect(s.steady.revenueByCategory.runes).toBeGreaterThan(0)
    expect(s.steady.levelingsPerDay).toBeGreaterThan(0)
    expect(s.warnings.some((w) => w.code === 'brisage-risque')).toBe(true)
    expect(s.market[0].kind).toBe('rune')
    const mated = runProduction(base({ mode: 'brisage', brisageLevel: 53, mateBeforeExtract: true, tier: 1, paddocks: 3 }), { runs: 1 })
    expect(mated.totals.matings).toBeGreaterThan(0)
  })

  it('vente : ventes plafonnées par le volume de chaque monture, prix « HDV mixte » signalé', () => {
    const s = runProduction(base({ mode: 'vente', targetGeneration: 4, paddocks: 3, horizonDays: 40 }), { runs: 1 })
    expect(s.totals.mountsSold).toBeGreaterThan(0)
    // Report de quota ≤ 1 unité sur la fenêtre du régime permanent.
    for (const m of s.market.filter((x) => x.kind === 'monture')) if (m.capPerDay !== null) expect(m.soldPerDay).toBeLessThanOrEqual(m.capPerDay + 1 / s.steady.days + 1e-9)
    expect(s.warnings.some((w) => w.code === 'hdv-mixte')).toBe(true)
  })
})

describe('optimiseur et comparaison des modes', () => {
  it('classe les stratégies d’une grille par bénéfice par jour (coûts chiffrés d’abord)', () => {
    const res = optimizeMode('extraction', base({ paddocks: 2, horizonDays: 30 }), {
      grid: { targetGeneration: [2, 4], tier: [1, 2], mateBeforeExtract: [true], optimakina: ['auto'], parentLevel: [40] },
      runs: 2,
      keep: 2,
    })
    expect(res.evaluated).toBe(4)
    expect(res.strategies).toHaveLength(4)
    // Ordre du score, sauf égalité statistique (écart < 2 erreurs types) départagée par le capital.
    for (let i = 1; i < res.strategies.length; i++) {
      const [a, b] = [res.strategies[i - 1], res.strategies[i]]
      if (compareRanked(a, b) > 0) {
        expect(statisticalTie(a, b) || statisticalTie(res.strategies[0], b)).toBe(true)
        expect(a.capital).toBeLessThanOrEqual(b.capital + 1)
      }
    }
    expect(res.best?.id).toBe(res.strategies[0].id)
    expect(res.best?.runs).toBe(2)
    expect(res.best?.summary).not.toBeNull()
    expect(res.best?.label).toMatch(/^G[24] · parents niv\. 40/)
    // Au palier 1, un lot prend 2 sessions sur 2 par jour : deux fois moins de fécondations.
    expect(res.strategies[0].params.tier).toBe(2)
  })

  it('sans prix du produit, classe par quantité produite et ne désigne pas de mode', () => {
    const ctx: PriceContext = { overrides: {}, useDefaults: false, market: null }
    const res = optimizeMode('extraction', base({ prices: { ctx }, horizonDays: 20 }), { grid: { targetGeneration: [2, 3], tier: [2], parentLevel: [40], mateBeforeExtract: [false] }, runs: 1 })
    expect(res.strategies.every((s) => s.scoreBasis === 'quantite')).toBe(true)
    expect(res.strategies[0].resourcesPerDay).toBeGreaterThanOrEqual(res.strategies[1].resourcesPerDay)
    expect(res.notes.join(' ')).toMatch(/quantité produite/)
  })

  it('grilles par défaut et libellés', () => {
    expect(defaultGrid('extraction').targetGeneration).toEqual(AUTO_TARGET_GENERATIONS)
    expect(defaultGrid('brisage', { quick: true }).mateBeforeExtract).toEqual([false])
    expect(defaultGrid('vente').mateBeforeExtract).toEqual([true])
    expect(strategyLabel('brisage', { brisageLevel: 80, tier: 1, mateBeforeExtract: false })).toBe('Brisage niv. 80 · palier 1 · sans accouplement')
    expect(strategyLabel('extraction', { targetGeneration: 6, parentLevel: 40, optimakina: 'none', tier: 2, mateBeforeExtract: true, cloning: true })).toBe(
      'G6 · parents niv. 40 · sans Optimakina · palier 2 · accoupler avant d’extraire',
    )
  })

  it('compare les modes d’un profil et désigne le plus rentable', () => {
    const res = compareModes({
      rules,
      prices: { ctx: tyleziaCtx },
      jobLevel: 120,
      paddocks: 2,
      hoursPerDay: 3,
      characters: 1,
      horizonDays: 25,
      runs: 1,
      modes: ['rush-corne', 'brisage-pa', 'brisage-pm'],
      grid: { extraction: { targetGeneration: [2, 3], tier: [2], mateBeforeExtract: [false], parentLevel: [40] }, brisage: { brisageLevel: [53], tier: [1], mateBeforeExtract: [false] } },
    })
    expect(res.rows.map((r) => r.modeId)).toEqual(['rush-corne', 'brisage-pa', 'brisage-pm'])
    expect(res.rows.every((r) => r.available && r.best)).toBe(true)
    expect(res.rows[1].family).toBe('volkorne')
    expect(res.rows[2].family).toBe('muldo')
    const best = [...res.rows].sort((a, b) => (b.best?.steadyNet ?? 0) - (a.best?.steadyNet ?? 0))[0]
    expect(res.bestMode).toBe(best.modeId)
  })

  it('version asynchrone identique et arrêtable', async () => {
    const opts = { grid: { targetGeneration: [2, 3], tier: [2 as const], mateBeforeExtract: [true], parentLevel: [40], optimakina: ['none' as const] }, runs: 1 }
    const sync = optimizeMode('extraction', base({ horizonDays: 20 }), opts)
    const asyncRes = await optimizeModeAsync('extraction', base({ horizonDays: 20 }), { ...opts, sliceMs: 0 })
    expect(asyncRes?.strategies.map((s) => [s.id, Math.round(s.steadyNet)])).toEqual(sync.strategies.map((s) => [s.id, Math.round(s.steadyNet)]))
    expect(await optimizeModeAsync('extraction', base({ horizonDays: 20 }), { ...opts, shouldStop: () => true })).toBeNull()
    const sim = await runProductionAsync(base({ horizonDays: 15 }), { runs: 2, sliceMs: 0 })
    expect(sim?.runs).toBe(2)
  })
})

describe('cohérence avec l’Optimiseur (programSim)', () => {
  it('même ordre de grandeur que l’Optimiseur et le modèle analytique (Volkorne Doré, G7)', () => {
    const cfg = { paddocks: 6, tier: 3 as const, rules, sessionsPerDay: 2 }
    const prog = runProgram({ ...cfg, targetSpeciesId: 186, parentLevel: 40, makina: 'all', cloning: true, batchSize: 10, maxDays: 200, runs: 6, seed: 1 })
    const prod = runProduction(
      base({ ...cfg, targetSpeciesIds: [186], targetGeneration: 7, parentLevel: 40, optimakina: 'all', horizonDays: 60, mateBeforeExtract: false, captureRate: 100, captureHoursPerDay: 5 }),
      { runs: 3 },
    )
    // Toutes les places sont utilisées dès le départ : la première G7 arrive au plus aussi tard que le
    // programme de l'Optimiseur (qui ne vise qu'un exemplaire), et pas dix fois plus tôt.
    const first = prod.firstTargetDay?.mean ?? Infinity
    const days = prog.metrics.days.mean
    expect(first).toBeLessThanOrEqual(days * 1.2)
    expect(first).toBeGreaterThan(days * 0.15)
    // En régime permanent, chaque G7 coûte moins d'accouplements que la borne haute analytique (sans
    // recyclage des bébés ratés ni reliquat de clonage), et au moins un accouplement par génération.
    const perTarget = prod.steady.matingsPerDay / prod.steady.targetBirthsPerDay
    const upper = expectedEffort(186, { parentLevel: 40, makina: 'optimakina', cloning: true, rules }).matings
    expect(perTarget).toBeLessThan(upper)
    expect(perTarget).toBeGreaterThan(6)
  })

  it('la fenêtre du régime permanent est le dernier tiers (7 jours au moins)', () => {
    expect(steadyWindowStart(60)).toBe(41)
    expect(steadyWindowStart(10)).toBe(4)
    expect(steadyWindowStart(5)).toBe(1)
  })
})

describe('Web Worker (handleProductionRequest)', () => {
  it('répond à une simulation avec progression et résumé', () => {
    const msgs: ProductionWorkerMessage[] = []
    let t = 0
    handleProductionRequest({ type: 'simulate', requestId: 3, config: base({ horizonDays: 10 }), runs: 2 }, (m) => msgs.push(m), () => (t += 100))
    expect(msgs.filter((m) => m.type === 'progress').length).toBeGreaterThan(0)
    const last = msgs[msgs.length - 1]
    expect(last.type).toBe('summary')
    if (last.type === 'summary') {
      expect(last.requestId).toBe(3)
      expect(last.summary.runs).toBe(2)
      // Le résumé ne transporte pas le contexte de prix (volumineux).
      expect(JSON.stringify(last.summary)).not.toContain('"rows"')
    }
  })

  it('signale une requête invalide', () => {
    const msgs: ProductionWorkerMessage[] = []
    handleProductionRequest({ type: 'nope', requestId: 9 } as never, (m) => msgs.push(m))
    expect(msgs).toEqual([{ type: 'error', requestId: 9, message: expect.stringMatching(/invalide/) }])
    handleProductionRequest({ type: 'optimize', requestId: 10, mode: 'brisage', base: base({ family: 'dragodinde' }), options: { grid: { brisageLevel: [53], tier: [1] } } }, (m) => msgs.push(m))
    const res = msgs[msgs.length - 1]
    expect(res.type).toBe('optimization')
    if (res.type === 'optimization') {
      expect(res.result.best).toBeNull()
      expect(res.result.notes[0]).toMatch(/brisage/i)
    }
  })
})

// ---------- Revue économique v2 (ECO-V2-01 … 11) : chaque test reproduit un défaut corrigé ----------

/** Profil de la revue : Tylezia, niveau 120, 4 enclos, 3 h, 1 personnage, parents 40, Opti auto, palier 2. */
function lvl120(over: Partial<ProductionConfig> = {}): ProductionConfig {
  return base({ paddocks: 4, targetGeneration: 10, parentLevel: 40, optimakina: 'auto', tier: 2, mateBeforeExtract: true, horizonDays: 60, ...over })
}

describe('ECO-V2-01 : régime permanent, étable saturée, raffinement indépendant, égalités statistiques', () => {
  it('Rush Corne G10 sur 60 jours : la fenêtre est encore la montée en charge (régime non stabilisé, avertissement « montee »)', () => {
    const s = runProduction(lvl120(), { runs: 3, seed: 1 })
    expect(s.steady.stable).toBe(false)
    expect(s.steady.instability.length).toBeGreaterThan(0)
    expect(s.rampUpDays).toBeNull()
    expect(s.warnings.map((w) => w.code)).toContain('montee')
    // Un régime établi (G4, 120 jours) reste stable.
    const g4 = runProduction(lvl120({ targetGeneration: 4, horizonDays: 120 }), { runs: 3, seed: 1 })
    expect(g4.steady.stable).toBe(true)
    expect(g4.rampUpDays).not.toBeNull()
    expect(g4.warnings.map((w) => w.code)).not.toContain('montee')
  })

  it('G10 sur 180 jours : l’étable déborde (fécondes sorties) → avertissement « etable-saturee »', () => {
    const s = runProduction(lvl120({ horizonDays: 180 }), { runs: 2, seed: 1 })
    expect(s.steady.releasedPerDay).toBeGreaterThan(0)
    expect(s.stableOverflow).toBe(false) // l'ancien avertissement « etable » ne se déclenchait pas
    const w = s.warnings.find((x) => x.code === 'etable-saturee')
    expect(w?.text).toMatch(/Étable saturée/)
  })

  it('le raffinement utilise d’autres graines que le tri, et réévalue plus longtemps une stratégie instable', () => {
    const res = optimizeMode('extraction', lvl120(), { grid: { targetGeneration: [4, 10], tier: [2], parentLevel: [40], optimakina: ['auto'], mateBeforeExtract: [true] }, runs: 3, keep: 2, seed: 5 })
    const g10 = res.strategies.find((x) => x.targetGeneration === 10)!
    const g4 = res.strategies.find((x) => x.targetGeneration === 4)!
    expect(g10.runs).toBe(3)
    expect(g10.summary?.seed ?? res.best?.summary?.seed).not.toBe(5)
    expect(res.best?.summary?.seed).toBe(5 + REFINE_SEED_OFFSET)
    // G10 : pas de régime en 60 jours → réévaluée sur 180 jours, classée sur ce régime-là.
    expect(g10.extendedDays).toBe(MAX_EXTENDED_DAYS)
    expect(g4.scoreSe).toBeGreaterThan(0)
    expect(res.notes.join(' ')).toMatch(/réévaluées sur une durée plus longue/)
  })

  it('choix de la génération stable d’une graine à l’autre (ou égalité déclarée)', () => {
    const grid = { targetGeneration: [4, 6, 8, 10], tier: [2 as const], parentLevel: [40], optimakina: ['auto' as const], mateBeforeExtract: [true] }
    const bests = [1, 2, 3, 4].map((seed) => optimizeMode('extraction', lvl120(), { grid, runs: 8, keep: 3, seed }))
    const gens = bests.map((r) => r.best!.targetGeneration)
    const majority = [...new Set(gens)].sort((a, b) => gens.filter((g) => g === b).length - gens.filter((g) => g === a).length)[0]
    for (const r of bests) {
      if (r.best!.targetGeneration === majority) continue
      // Sinon, la génération majoritaire est à égalité statistique avec la première.
      expect(r.strategies.find((x) => x.targetGeneration === majority)?.tieWithBest).toBe(true)
    }
    // Jamais G10 (montée en charge prise pour un régime : ancien défaut).
    expect(gens).not.toContain(10)
  })

  it('égalité statistique : départagée par le capital, puis la montée', () => {
    const mk = (score: number, se: number, capital: number) => ({ comparable: true, scoreBasis: 'kamas' as const, score, scoreSe: se, capital, rampUpDays: 20 })
    expect(statisticalTie(mk(1000, 30, 0), mk(950, 30, 0))).toBe(true) // 50 < 2 × √(30² + 30²) ≈ 85
    expect(statisticalTie(mk(1000, 10, 0), mk(950, 10, 0))).toBe(false)
    const ranked = rankWithTies([mk(1000, 30, 5e6), mk(950, 30, 1e6), mk(600, 30, 0)], (x) => x, (a, b) => b.score - a.score)
    expect(ranked.map((x) => x.capital)).toEqual([1e6, 5e6, 0])
  })

  it('génération « auto » : plusieurs tirages et règle de stabilité (jamais la G10 d’une montée en charge)', () => {
    const t = productionPlan(lvl120({ targetGeneration: 'auto' })).targetGeneration
    expect(t).toBeLessThan(10)
  })
})

describe('ECO-V2-02 / 11 : vente de montures « HDV mixte »', () => {
  const venteBase = (over: Partial<ProductionConfig> = {}) => base({ mode: 'vente', family: 'volkorne', targetGeneration: 4, paddocks: 1, jobLevel: 1, horizonDays: 40, prices: { ctx: { ...tyleziaCtx, jobLevel: 1 } }, ...over })

  it('prix de décision plafonné à la valeur d’extraction + 50 % ; vente au prix du marché = spéculative', () => {
    const cfg = normalizeProductionConfig(venteBase())
    const plan = productionPlan(venteBase())
    const s = runProduction(venteBase(), { runs: 1 })
    expect(s.speculative).toBe(true)
    expect(s.warnings.map((w) => w.code)).toContain('speculatif')
    const corne = s.prices.find((l) => l.key === 'ressource')!.value as number
    for (const sp of plan.targets) {
      const info = productionPriceBookFor(cfg).mountSale(sp)
      expect(info.speculative).toBe(true)
      expect(info.decisionPrice!).toBeLessThanOrEqual(4 * corne * 1.5 + 1e-6)
    }
  })

  it('compareModes (niveau 1 et 120) : jamais « Vente de montures » en mode automatique, ligne spéculative', () => {
    for (const jobLevel of [1, 120]) {
      const res = compareModes({
        rules,
        prices: { ctx: { ...tyleziaCtx, jobLevel }, mountPrices: { mountOverrides: {}, generationOverrides: {}, useDefaults: true, market: tyleziaMarket } },
        jobLevel,
        paddocks: jobLevel === 1 ? 1 : 4,
        hoursPerDay: 3,
        characters: 1,
        horizonDays: 40,
        runs: 2,
        naturalLeveling: false,
        modes: ['rush-corne', 'vente-montures'],
        grid: { extraction: { targetGeneration: [2, 4], tier: [2], mateBeforeExtract: [true], parentLevel: [40] }, vente: { targetGeneration: [4], tier: [2], mateBeforeExtract: [true], parentLevel: [40] } },
      })
      const vente = res.rows.find((r) => r.modeId === 'vente-montures')!
      expect(vente.speculative).toBe(true)
      expect(res.bestMode).toBe('rush-corne')
    }
  })

  it('avec le prix du joueur (bébé niv. 1 fécond), la vente n’est plus spéculative', () => {
    const plan = productionPlan(venteBase())
    const mountOverrides = Object.fromEntries(plan.targets.map((t) => [`${t}|1`, 150_000]))
    const s = runProduction(venteBase({ prices: { ctx: { ...tyleziaCtx, jobLevel: 1 }, mountPrices: { mountOverrides, generationOverrides: {}, useDefaults: true, market: tyleziaMarket } } }), { runs: 1 })
    expect(s.speculative).toBe(false)
    expect(s.steady.mountsSoldPerDay).toBeGreaterThan(0)
  })

  it('ECO-V2-11 : même contexte de prix, prix de montures modifiés → espèces vendues recalculées (cache du plan)', () => {
    const ctx = { ...tyleziaCtx, jobLevel: 1 }
    const mp = { mountOverrides: {} as Record<string, number>, generationOverrides: {}, useDefaults: true, market: tyleziaMarket }
    const before = productionPlan(venteBase({ prices: { ctx, mountPrices: mp } })).targets
    // Le joueur saisit un prix très bas pour les espèces retenues : elles ne doivent plus être visées.
    const low = Object.fromEntries(before.map((t) => [`${t}|1`, 1_000]))
    const after = productionPlan(venteBase({ prices: { ctx, mountPrices: { ...mp, mountOverrides: low } } })).targets
    expect(after).not.toEqual(before)
    for (const t of before) expect(after).not.toContain(t)
  })
})

describe('ECO-V2-03 : captures d’abord, achats seulement pour les places restantes', () => {
  it('capacité de capture suffisante : aucun achat, mêmes captures et même bénéfice qu’à 0 achat', () => {
    const cfg = lvl120({ targetGeneration: 6, paddocks: 6, jobLevel: 200, prices: { ctx: { ...tyleziaCtx, jobLevel: 200 } }, horizonDays: 60 })
    const buy = runProduction({ ...cfg, buyG1PerDay: 216 }, { runs: 2, seed: 1 })
    const none = runProduction({ ...cfg, buyG1PerDay: 0 }, { runs: 2, seed: 1 })
    expect(buy.steady.boughtPerDay).toBeLessThan(0.5)
    expect(buy.steady.capturesPerDay).toBeCloseTo(none.steady.capturesPerDay, 6)
    expect(buy.steady.netPerDay.mean).toBeCloseTo(none.steady.netPerDay.mean, 0)
  })

  it('sans temps de capture : les achats remplissent les places', () => {
    const s = runProduction(base({ targetGeneration: 2, captureHoursPerDay: 0, buyG1PerDay: 40, g1Price: 5_000 }), { runs: 1 })
    expect(s.totals.captures).toBe(0)
    expect(s.totals.bought).toBeGreaterThan(20)
  })
})

describe('ECO-V2-05 / 06 / 07 / 09 : génétons, montée du métier, liquidité à l’achat, formats', () => {
  it('génétons : part du bénéfice net exposée, valeur des Puissants Parchemins (échange reconfirmé)', () => {
    const s = runProduction(lvl120({ targetGeneration: 6 }), { runs: 2 })
    expect(s.steady.genetonShareOfNet).not.toBeNull()
    expect(s.steady.genetonShareOfNet!).toBeCloseTo(s.steady.revenueByCategory.genetons / s.steady.netPerDay.mean, 10)
    expect(s.prices.find((l) => l.key === 'geneton')?.label).toMatch(/Puissant Parchemin/)
  })

  it('montée du métier en route : le filet suit le niveau du jour (captures plafonnées par le filet universel avant le niveau 100)', () => {
    const cfg = base({ targetGeneration: 2, paddocks: 1, jobLevel: 160, prices: { ctx: { ...tyleziaCtx, jobLevel: 160 } }, hoursPerDay: 1, horizonDays: 30 })
    const schedule = [
      { day: 1, jobLevel: 1 },
      { day: 8, jobLevel: 100 },
      { day: 11, jobLevel: 160 },
    ]
    const run = simulateProduction({ ...cfg, jobLevelSchedule: schedule }, 1)
    const universel = capturesPerFight(1, 1, 'universel') * 12 * 0.5
    for (const d of run.days.slice(0, 7)) {
      expect(d.netKind).toBe('universel')
      expect(d.captureCapacity).toBeCloseTo(universel, 6)
      expect(d.captures).toBeLessThanOrEqual(universel + 1)
    }
    expect(run.days[8].netKind).toBe('multiplicateur')
    expect(run.days[20].netKind).toBe('renforce')
    // Coût d'une capture : celui du filet du jour.
    const flat = simulateProduction(cfg, 1)
    expect(flat.days[0].netKind).toBe('renforce')
    expect(flat.days[0].captureCapacity).toBeGreaterThan(run.days[0].captureCapacity)
  })

  it('liquidité à l’achat : carburant de l’HDV au-delà de 15 % de son volume écarté (Grand Élixir d’Abreuvoir) ; Optimakinas signalées', () => {
    const s = runProduction(lvl120({ targetGeneration: 6 }), { runs: 1 })
    const abreuvoir = s.routine.fuel.find((f) => f.gauge === 'abreuvoir')
    expect(abreuvoir?.fuelName).not.toBe('Grand Élixir d\'Abreuvoir')
    const w = s.warnings.filter((x) => x.code === 'volume-achat')
    // Revue UX2-02 : sa médiane 30 j (2 872, aucune vente en 24 h, moyenne 9 145) n'est plus retenue — il
    // est chiffré à la moyenne et n'est plus le moins cher, donc plus « écarté » pour sa liquidité.
    expect(w.some((x) => /Grand Élixir d'Abreuvoir/.test(x.text))).toBe(false)
    expect(w.some((x) => /Optimakina .* par jour nécessaires/.test(x.text))).toBe(true)
  })

  it('avertissements de saturation : quantités sous 1 avec deux décimales, jamais « (0/jour) »', () => {
    const s = runProduction(
      base({ mode: 'vente', family: 'muldo', targetGeneration: 10, paddocks: 4, horizonDays: 60, prices: { ctx: tyleziaCtx, trustMixedMountPrices: true } }),
      { runs: 1 },
    )
    const sat = s.warnings.filter((w) => w.code === 'saturation')
    expect(sat.length).toBeGreaterThan(0)
    for (const w of sat) expect(w.text).not.toMatch(/\(0\/jour/)
    for (const mc of s.market.filter((m) => m.saturated && m.producedPerDay < 1)) {
      const t = sat.find((w) => w.text.startsWith(mc.name))!.text
      expect(t).toContain(`(${formatNumber(mc.producedPerDay, 2)}/jour)`)
    }
  })
})

describe('revue « marché » (MKT)', () => {
  it('MKT-05 : export sans colonnes de ventes → Rush Corne vend ce qu’il produit (liquidité inconnue signalée), pas de saturation à 0', () => {
    // Même export, colonnes de volume retirées (seulement gid;nom;median_30j;moyen_30j).
    const csv = ['gid;nom;median_30j;moyen_30j', ...tyleziaCsvPrices()].join('\n')
    const noVolume = marketSourceOf(buildSnapshot(parseHdvCsv(csv), { serverName: 'Tylezia', exportDate: '2026-10-02' }), 'auto', 'Tylezia')
    expect(noVolume.volumeUnknown).toBe(true)
    const s = runProduction(lvl120({ targetGeneration: 4, prices: { ctx: { overrides: {}, useDefaults: true, market: noVolume, jobLevel: 120 }, saleTax: 0.02, maxMarketShare: 0.15 } }), { runs: 1, seed: 1 })
    const corne = s.market.find((m) => m.itemId === 19975)!
    expect(corne.capPerDay).toBeNull()
    expect(corne.saturated).toBe(false)
    expect(corne.soldPerDay).toBeGreaterThan(0)
    expect(s.steady.netPerDay.mean).toBeGreaterThan(0)
    const codes = s.warnings.map((w) => w.code)
    expect(codes).toContain('liquidite-inconnue')
    expect(codes).not.toContain('saturation')
    expect(codes).not.toContain('volume-achat')
    expect(s.warnings.find((w) => w.code === 'liquidite-inconnue')?.text).toMatch(/export HDV sans colonnes de ventes/)
  })
})

/** Lignes « gid;nom;median_30j;moyen_30j » de tout le préréglage de Tylezia (export sans volumes). */
function tyleziaCsvPrices(): string[] {
  return Object.entries(tyleziaMarket.rows).map(([id, t]) => `${id};objet ${id};${t[0]};${t[1]}`)
}

// ---------- Revue « parcours » v2 (UX2) : chaque test reproduit un défaut corrigé ----------

describe('UX2-01 / 02 : prix prudent des montures, achats face au volume du serveur', () => {
  it('UX2-01 : le prix prudent d’un objet-monture ne dépasse jamais la médiane 24 h, même sur peu de ventes (Muldo Azur et Doré)', () => {
    const azur = SPECIES.find((s) => s.itemId === 33286)!
    const p = conservativeMountMarketPrice(tyleziaMarket, azur.id)!
    // 3 ventes à 1 200 000 en 24 h, médiane 30 j 1 640 898 : avant, 1 394 763 (> dernières ventes).
    expect(p.price).toBeLessThanOrEqual(1_200_000 * 0.85 + 1e-6)
    // Partout : ≤ min des statistiques non nulles × 0,85.
    for (const sp of SPECIES) {
      const row = sp.itemId ? tyleziaMarket.rows[String(sp.itemId)] : undefined
      const q = conservativeMountMarketPrice(tyleziaMarket, sp.id)
      if (!row || !q) continue
      const vals = [row[0], row[1], row[2]].filter((v) => v > 0)
      expect(q.price).toBeLessThanOrEqual(Math.min(...vals) * 0.85 + 1e-6)
    }
  })

  it('UX2-02 : Optimakinas achetées au-delà de 15 % du volume du serveur → comptées au prix haut, contrôle d’achat et avertissement', () => {
    const s = runProduction(lvl120({ targetGeneration: 10, horizonDays: 60 }), { runs: 1, seed: 1 })
    const mk = s.purchases.filter((p) => p.kind === 'makina')
    expect(mk.length).toBeGreaterThan(0)
    const over = mk.filter((p) => p.overCap)
    expect(over.length).toBeGreaterThan(0)
    for (const p of over) {
      expect(p.marketPerDay).not.toBeNull()
      expect(p.buyPerDay).toBeGreaterThan(p.capPerDay!)
      expect(p.highPrice!).toBeGreaterThanOrEqual(p.unitPrice!)
      // Recettes G8+ (niv. 151+) hors de portée d'un Éleveur 120.
      if ((p.craftLevel ?? 0) > 120) expect(p.canCraft).toBe(false)
    }
    // Même production sans plafond d'achat (part du volume 100 %) : les unités au-delà ne coûtent plus le prix haut.
    const free = runProduction(lvl120({ targetGeneration: 10, horizonDays: 60, prices: { ctx: tyleziaCtx, maxMarketShare: 1 } }), { runs: 1, seed: 1 })
    expect(free.steady.optimakinasPerDay).toBeCloseTo(s.steady.optimakinasPerDay, 9)
    const surcharge = mk.reduce((t, p) => t + p.overVolumePerDay * ((p.highPrice ?? p.unitPrice ?? 0) - (p.unitPrice ?? 0)), 0)
    expect(surcharge).toBeGreaterThan(0)
    expect(s.steady.costByCategory.makina).toBeGreaterThan(free.steady.costByCategory.makina)
    expect(s.steady.costByCategory.makina - free.steady.costByCategory.makina).toBeCloseTo(surcharge, 0)
    const w = s.warnings.filter((x) => x.code === 'volume-achat' && /Optimakina/.test(x.text))
    expect(w.length).toBeGreaterThan(0)
    expect(w.some((x) => /hors de portée/.test(x.text))).toBe(true)
    // Les carburants achetés figurent aussi dans les contrôles d'achat.
    expect(s.purchases.some((p) => p.kind === 'carburant')).toBe(true)
  })
})
