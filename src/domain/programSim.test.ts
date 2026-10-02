import { FUELS, MAKINAS, SPECIES } from '../data'
import { cheapestRecipe, requiredSpecies } from './breedingPath'
import { DEFAULT_SERENITY_POINTS } from './economy'
import type { PriceContext } from './pricing'
import {
  compareStrategies,
  distStat,
  estimateProgramCost,
  findPreset,
  makinaPolicyLabel,
  mulberry32,
  normalizeProgramConfig,
  paddocksForJobLevel,
  presetConfig,
  programPlan,
  researchReference,
  runProgram,
  runSeed,
  runStrategies,
  runStrategiesAsync,
  simulateProgram,
  STRATEGY_PRESETS,
  summarizeProgram,
  usesOptimakina,
  type ProgramBase,
  type ProgramConfig,
  type StrategyOutcome,
} from './programSim'
import { handleProgramRequest, type ProgramWorkerMessage } from './programSim.worker'
import { RULESETS } from './rules'
import { mountXpForLevel } from './xp'

const id = (name: string) => {
  const s = SPECIES.find((x) => x.name === name)
  if (!s) throw new Error(name)
  return s.id
}
const genOf = (sid: number) => SPECIES.find((s) => s.id === sid)?.generation ?? 0

const EMERAUDE = id('Dragodinde Émeraude')
const POURPRE = id('Dragodinde Pourpre')
const EBENE = id('Dragodinde Ébène')

/** Configuration de la recherche : 60 places, cycles de 12 h, XP au débit du palier 3 (3 XP/s). */
function base(target: number, more: Partial<ProgramBase> = {}): ProgramBase {
  return { targetSpeciesId: target, paddocks: 6, tier: 3, batchSize: 10, rules: RULESETS['3.6'], maxDays: 1500, runs: 20, seed: 11, ...more }
}
function preset(idp: string, target: number, more: Partial<ProgramBase> = {}): ProgramConfig {
  const p = findPreset(idp)
  if (!p) throw new Error(idp)
  return presetConfig(p, base(target, more))
}
const within = (value: number, expected: number, tol: number) => Math.abs(value - expected) / expected <= tol

describe('générateur et configuration', () => {
  it('mulberry32 est reproductible et reste dans [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const xs = Array.from({ length: 1000 }, () => a())
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()))
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length
    expect(mean).toBeGreaterThan(0.45)
    expect(mean).toBeLessThan(0.55)
    expect(mulberry32(43)()).not.toBe(mulberry32(42)())
  })

  it('runSeed donne des graines distinctes par tirage', () => {
    const seeds = new Set(Array.from({ length: 500 }, (_, i) => runSeed(1, i)))
    expect(seeds.size).toBe(500)
    expect(runSeed(1, 0)).toBe(runSeed(1, 0))
  })

  it('normalise et borne la configuration', () => {
    const c = normalizeProgramConfig({ ...base(EMERAUDE), paddocks: 9, batchSize: 0, parentLevel: 500, makina: { fromGeneration: 1 }, cloning: true, runs: 0, maxDays: -3 })
    expect(c.paddocks).toBe(6)
    expect(c.batchSize).toBe(1)
    expect(c.parentLevel).toBe(200)
    expect(c.makina).toEqual({ fromGeneration: 2 })
    expect(c.runs).toBe(1)
    expect(c.maxDays).toBe(1)
    expect(c.sessionsPerDay).toBe(2)
    expect(c.cloneKeepsLevel).toBe(true)
    expect(c.serenityPointsPerBatch).toBe(DEFAULT_SERENITY_POINTS)
  })

  it('enclos débloqués selon le niveau d\'Éleveur', () => {
    expect(paddocksForJobLevel(1)).toBe(1)
    expect(paddocksForJobLevel(39)).toBe(1)
    expect(paddocksForJobLevel(40)).toBe(2)
    expect(paddocksForJobLevel(119)).toBe(3)
    expect(paddocksForJobLevel(120)).toBe(4)
    expect(paddocksForJobLevel(200)).toBe(6)
  })

  it('politique d\'Optimakina', () => {
    expect(usesOptimakina('none', 9)).toBe(false)
    expect(usesOptimakina('all', 2)).toBe(true)
    expect(usesOptimakina({ fromGeneration: 6 }, 5)).toBe(false)
    expect(usesOptimakina({ fromGeneration: 6 }, 6)).toBe(true)
    expect(makinaPolicyLabel({ fromGeneration: 6 })).toBe('Optimakina dès la G6')
    expect(makinaPolicyLabel('none')).toBe('sans makina')
  })

  it('distStat interpolé (moteur de production) : avec 3 tirages, p10 ≠ min et p90 ≠ médiane ; n et écart-type exposés', () => {
    const d = distStat([100, 200, 400], { interpolate: true })
    expect(d.p10).toBeCloseTo(120, 10) // 100 + 0,2 × (200 − 100)
    expect(d.p90).toBeCloseTo(360, 10) // 200 + 0,8 × (400 − 200)
    expect(d.n).toBe(3)
    expect(d.sd).toBeCloseTo(Math.sqrt(((100 - 700 / 3) ** 2 + (200 - 700 / 3) ** 2 + (400 - 700 / 3) ** 2) / 2), 10)
    // Ancienne convention avec 3 valeurs : p10 = min, p90 = médiane (la moyenne 233 sortait de la bande).
    const old = distStat([100, 200, 400])
    expect(old.p10).toBe(100)
    expect(old.p90).toBe(200)
    expect(distStat([7], { interpolate: true })).toMatchObject({ p10: 7, p90: 7, n: 1, sd: 0 })
  })

  it('distStat suit la convention de la recherche (v[floor(0,1·(n−1))])', () => {
    const d = distStat([5, 1, 4, 2, 3, 10, 7, 6, 9, 8])
    expect(d.mean).toBe(5.5)
    expect(d.p10).toBe(1)
    expect(d.p90).toBe(9)
    expect(d.min).toBe(1)
    expect(d.max).toBe(10)
  })
})

describe('plan (recettes retenues)', () => {
  it('suit la recette la moins chère en captures et la chance de génération cible du ruleset', () => {
    const steps = programPlan(preset('n40', EMERAUDE))
    const req = requiredSpecies(cheapestRecipe(EMERAUDE) as NonNullable<ReturnType<typeof cheapestRecipe>>)
    expect(steps.map((s) => s.speciesId).sort()).toEqual(req.map((r) => r.speciesId).sort())
    expect(steps[0].speciesId).toBe(EMERAUDE)
    const crossed = steps.filter((s) => s.crossing)
    expect(crossed.every((s) => s.targetChance === 0.42 && !s.optimakina)).toBe(true)
    expect(steps.filter((s) => !s.crossing).every((s) => s.generation === 1)).toBe(true)
    const opti = programPlan(preset('n40-opti-g6', EMERAUDE))
    expect(opti.filter((s) => s.crossing && s.generation >= 6).every((s) => s.optimakina && s.targetChance === 0.52)).toBe(true)
    expect(opti.filter((s) => s.crossing && s.generation < 6).every((s) => !s.optimakina)).toBe(true)
    // 3.7 : Optimakina +20 %.
    const v37 = programPlan(preset('n40-opti', EMERAUDE, { rules: RULESETS['3.7'] }))
    expect(v37.filter((s) => s.crossing).every((s) => s.targetChance === 0.62)).toBe(true)
  })

  it('politique mixte : niveau selon la génération du parent', () => {
    const steps = programPlan(preset('mixte', EMERAUDE))
    for (const s of steps.filter((x) => x.crossing)) {
      const [a, b] = s.crossing as [number, number]
      const lv = (g: number) => (g <= 4 ? 40 : g <= 6 ? 60 : 100)
      expect(s.parentLevels).toEqual([lv(genOf(a)), lv(genOf(b))])
    }
  })

  it('refuse une monture non élevable', () => {
    const special = SPECIES.find((s) => !s.breedable)
    expect(special).toBeDefined()
    expect(() => simulateProgram(preset('n40', special?.id ?? 0), 1)).toThrow()
  })
})

describe('un tirage', () => {
  it('est reproductible pour une graine donnée et varie entre graines', () => {
    const cfg = preset('n40', POURPRE)
    expect(simulateProgram(cfg, 5)).toEqual(simulateProgram(cfg, 5))
    const runs = Array.from({ length: 6 }, (_, i) => simulateProgram(cfg, runSeed(3, i)).matings)
    expect(new Set(runs).size).toBeGreaterThan(1)
  })

  it('respecte les invariants comptables', () => {
    const cfg = preset('n40-opti', POURPRE)
    for (let i = 0; i < 8; i++) {
      const r = simulateProgram(cfg, runSeed(7, i))
      expect(r.success).toBe(true)
      // Chaque parent a été rendu fécond une fois : au moins 2 fécondations par accouplement.
      expect(r.fecundations).toBeGreaterThanOrEqual(2 * r.matings)
      // Un clone consomme 2 stériles, un accouplement en produit 2.
      expect(r.clones).toBeLessThanOrEqual(r.matings)
      expect(r.optimakinas).toBe(r.matings)
      expect(Object.values(r.makinasByGeneration).reduce((s, v) => s + v, 0)).toBe(r.optimakinas)
      expect(Object.keys(r.makinasByGeneration).every((g) => Number(g) >= 2)).toBe(true)
      expect(Object.values(r.capturesByColor).reduce((s, v) => s + v, 0)).toBe(r.captures)
      expect(Object.keys(r.capturesByColor).every((c) => genOf(Number(c)) === 1)).toBe(true)
      expect(r.successes).toBeLessThanOrEqual(r.matings)
      expect(r.jobXpCaptures).toBe(30 * r.captures)
      expect(r.jobXp).toBe(r.jobXpMatings + r.jobXpCaptures)
      expect(r.days).toBe(r.cycles / 2)
      // Carburant de fécondité : 20 000 points par lot de 10 et par stat, sérénité partagée.
      expect(r.fuelPoints.foudroyeur).toBeCloseTo(r.fecundations * 2000, 6)
      expect(r.fuelPoints.baffeur).toBeCloseTo((r.fecundations * DEFAULT_SERENITY_POINTS) / 20, 6)
      expect(r.totalFuelPoints).toBeCloseTo(r.statFuelPoints + r.xpFuelPoints, 6)
      // XP jusqu'au niveau 40 pour chaque nouvelle monture (captures + bébés), clones exclus.
      expect(r.mountXp).toBe((r.captures + r.matings) * mountXpForLevel(40))
      expect(r.fuelPoints.mangeoire).toBeCloseTo(r.mountXp / 10, 6)
    }
  })

  it('sans XP au niveau 1, et sans makina : aucune Optimakina ni Mangeoire', () => {
    const r = simulateProgram(preset('n1', POURPRE), 9)
    expect(r.optimakinas).toBe(0)
    expect(r.fuelPoints.mangeoire).toBe(0)
    expect(r.mountXp).toBe(0)
  })

  it('une G1 se capture simplement', () => {
    const g1 = SPECIES.find((s) => s.family === 'dragodinde' && s.generation === 1 && s.capturable)
    const r = simulateProgram(preset('n40', g1?.id ?? 0), 1)
    expect(r).toMatchObject({ success: true, captures: 1, matings: 0, cycles: 0, jobXp: 30 })
  })

  it('échoue si la durée maximale est trop courte', () => {
    const r = simulateProgram(preset('n40', EMERAUDE, { maxDays: 3 }), 1)
    expect(r.success).toBe(false)
    expect(r.cycles).toBe(6)
    expect(r.days).toBe(3)
  })

  it('cadence : plus de sessions par jour = palier lent sur plusieurs cycles', () => {
    // Palier 1 : ≈ 11 h 33 par lot → 1 cycle de 12 h, mais 2 cycles de 8 h.
    expect(summarizeProgram(preset('n40', EBENE, { tier: 1 }), []).fecundationCycles).toBe(1)
    expect(summarizeProgram(preset('n40', EBENE, { tier: 1, sessionsPerDay: 3 }), []).fecundationCycles).toBe(2)
    expect(summarizeProgram(preset('n40', EBENE, { tier: 2, sessionsPerDay: 3 }), []).fecundationCycles).toBe(1)
  })
})

describe('validation contre la simulation de la recherche (strategy.md §6.2)', () => {
  // Tolérance stochastique : 20 tirages (la recherche en utilise 40) et quelques écarts de détail
  // (sérénité 3 200 au lieu de 3 000 points, ordre des tirages). Écarts mesurés à 40 tirages : ≤ 12 %.
  const TOL = 0.25
  it.each([
    ['n1', 638, 3394],
    ['n40', 188, 821],
    ['n40-opti', 111, 378],
    ['n40-opti-g6', 150, 591],
  ])('Dragodinde Émeraude (G9), %s ≈ %i captures / %i accouplements', (p, captures, matings) => {
    const s = runProgram(preset(p, EMERAUDE))
    expect(s.successRate).toBe(1)
    expect(within(s.metrics.captures.mean, captures, TOL)).toBe(true)
    expect(within(s.metrics.matings.mean, matings, TOL)).toBe(true)
    const r = researchReference(EMERAUDE, p, RULESETS['3.6'])
    expect(r?.captures).toBe(captures)
    expect(within(s.metrics.fecundations.mean, r?.fecundations ?? 0, TOL)).toBe(true)
    expect(within(s.metrics.cycles.mean, r?.halfDays ?? 0, 0.3)).toBe(true)
  })

  it('Muldo Corail et Volkorne Jade (G9), niveau 40 avec et sans Optimakina', () => {
    for (const [name, p, c, m] of [
      ['Muldo Corail', 'n40', 183, 617],
      ['Muldo Corail', 'n40-opti', 108, 267],
      ['Volkorne Jade', 'n40', 198, 775],
      ['Volkorne Jade', 'n40-opti', 106, 347],
    ] as const) {
      const s = runProgram(preset(p, id(name)))
      expect(within(s.metrics.captures.mean, c, TOL)).toBe(true)
      expect(within(s.metrics.matings.mean, m, TOL)).toBe(true)
    }
  })

  it('sans clonage, la pyramide explose (niveau 1)', () => {
    const noClone = (target: number) => runProgram({ ...base(target), parentLevel: 1, makina: 'none', cloning: false })
    expect(within(noClone(EBENE).metrics.captures.mean, 76, TOL)).toBe(true)
    const pourpre = noClone(POURPRE)
    expect(within(pourpre.metrics.captures.mean, 735, TOL)).toBe(true)
    expect(within(pourpre.metrics.matings.mean, 604, TOL)).toBe(true)
    const withClone = runProgram(preset('n1', POURPRE))
    expect(pourpre.metrics.captures.mean).toBeGreaterThan(5 * withClone.metrics.captures.mean)
  })

  it('reproduit les enseignements : niveau 40 ≪ niveau 1, Optimakina ≪ sans, niveau 100 plus lent', () => {
    const n1 = runProgram(preset('n1', EMERAUDE, { runs: 10 }))
    const n40 = runProgram(preset('n40', EMERAUDE, { runs: 10 }))
    const opti = runProgram(preset('n40-opti', EMERAUDE, { runs: 10 }))
    const n100 = runProgram(preset('n100-opti', EMERAUDE, { runs: 10 }))
    expect(n40.metrics.captures.mean * 2).toBeLessThan(n1.metrics.captures.mean)
    expect(n40.metrics.matings.mean * 2).toBeLessThan(n1.metrics.matings.mean)
    expect(opti.metrics.matings.mean).toBeLessThan(0.65 * n40.metrics.matings.mean)
    expect(n100.metrics.captures.mean).toBeLessThan(opti.metrics.captures.mean)
    expect(n100.metrics.days.mean).toBeGreaterThan(opti.metrics.days.mean)
  })

  it('moins d\'enclos = plus de jours ; 3.7 (Optimakina +20 %) = moins d\'accouplements', () => {
    const six = runProgram(preset('n40', EMERAUDE, { runs: 10 }))
    const two = runProgram(preset('n40', EMERAUDE, { runs: 10, paddocks: 2 }))
    expect(two.metrics.days.mean).toBeGreaterThan(six.metrics.days.mean)
    expect(two.slots).toBe(20)
    const o36 = runProgram(preset('n40-opti', EMERAUDE, { runs: 10 }))
    const o37 = runProgram(preset('n40-opti', EMERAUDE, { runs: 10, rules: RULESETS['3.7'] }))
    expect(o37.metrics.matings.mean).toBeLessThan(o36.metrics.matings.mean)
    // Génétons ≈ ×2 en 3.7 par accouplement « record ».
    expect(o37.metrics.genetons.mean / o37.metrics.matings.mean).toBeGreaterThan(1.5 * (o36.metrics.genetons.mean / o36.metrics.matings.mean))
  })
})

describe('agrégation et exécution', () => {
  it('runProgram agrège les tirages (moyenne, p10 ≤ moyenne ≤ p90 en général)', () => {
    const progress: number[] = []
    const s = runProgram(preset('n40', POURPRE, { runs: 12 }), { onProgress: (d) => progress.push(d) })
    expect(progress).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect(s.runs).toBe(12)
    expect(s.metrics.captures.p10).toBeLessThanOrEqual(s.metrics.captures.p90)
    expect(s.metrics.captures.min).toBeLessThanOrEqual(s.metrics.captures.mean)
    expect(s.capturesByColor.reduce((t, c) => t + c.mean, 0)).toBeCloseTo(s.metrics.captures.mean, 6)
    expect(s.family).toBe('dragodinde')
    expect(s.cycleHours).toBe(12)
  })

  it('runStrategiesAsync donne les mêmes résultats que runStrategies et peut s\'arrêter', async () => {
    const jobs = [
      { id: 'a', label: 'A', config: preset('n40', EBENE, { runs: 5 }) },
      { id: 'b', label: 'B', config: preset('n40-opti', EBENE, { runs: 5 }) },
    ]
    const sync = runStrategies(jobs)
    const progress: number[] = []
    const asyncRes = await runStrategiesAsync(jobs, { onProgress: (d, t) => progress.push(d / t) })
    expect(asyncRes?.map((r) => r.summary.metrics)).toEqual(sync.map((r) => r.summary.metrics))
    expect(progress[progress.length - 1]).toBe(1)
    expect(await runStrategiesAsync(jobs, { shouldStop: () => true })).toBeNull()
  })
})

describe('Web Worker (protocole)', () => {
  it('publie progression, résultats puis fin', () => {
    const msgs: ProgramWorkerMessage[] = []
    let t = 0
    handleProgramRequest(
      { type: 'run', requestId: 7, jobs: [{ id: 'x', label: 'X', config: preset('n40', EBENE, { runs: 4 }) }] },
      (m) => msgs.push(m),
      () => (t += 100),
    )
    expect(msgs.every((m) => m.requestId === 7)).toBe(true)
    expect(msgs.filter((m) => m.type === 'progress').length).toBe(4)
    const result = msgs.find((m) => m.type === 'result')
    expect(result?.type === 'result' && result.result.id).toBe('x')
    const done = msgs[msgs.length - 1]
    expect(done.type).toBe('done')
    if (done.type === 'done') expect(done.results[0].summary.runs).toBe(4)
  })

  it('signale les erreurs', () => {
    const msgs: ProgramWorkerMessage[] = []
    handleProgramRequest({ type: 'run', requestId: 1, jobs: [{ id: 'z', label: 'Z', config: preset('n40', 999_999) }] }, (m) => msgs.push(m))
    expect(msgs[msgs.length - 1].type).toBe('error')
  })
})

const SERENITY: string[] = ['baffeur', 'caresseur']

describe('coût en kamas', () => {
  const summary = runProgram(preset('n40-opti', POURPRE, { runs: 6, tier: 2 }))

  it('prix manquants : coût incomplet, jamais compté comme 0', () => {
    const ctx: PriceContext = { overrides: {}, useDefaults: false }
    const c = estimateProgramCost(summary, { ctx, rules: RULESETS['3.6'], tier: 2, jobLevel: 1 })
    expect(c.complete).toBe(false)
    expect(c.missing.length).toBeGreaterThan(0)
    expect(c.lines.some((l) => l.cost === null)).toBe(true)
    expect(c.lines.filter((l) => l.category === 'carburant').map((l) => l.gauge).sort()).toEqual(['abreuvoir', 'baffeur', 'caresseur', 'dragofesse', 'foudroyeur', 'mangeoire'])
  })

  it('prix complets : carburant × coût au point + makinas + filets', () => {
    const overrides: Record<string, number> = {}
    // Jauges de statistiques au palier 2, sérénité (Baffeur, Caresseur) au palier 1 comme la page Enclos : 2 K par point.
    for (const f of FUELS.filter((x) => x.tier === 2 || (x.tier === 1 && SERENITY.includes(x.gauge)))) overrides[f.id] = f.durability * 2
    for (const m of MAKINAS.filter((x) => x.kind === 'optimakina' && x.family === 'dragodinde')) overrides[m.id] = 10_000
    overrides[32521] = 500 // Filet de capture universel
    const ctx: PriceContext = { overrides, useDefaults: false }
    const c = estimateProgramCost(summary, { ctx, rules: RULESETS['3.6'], tier: 2, jobLevel: 1, genetonValue: 375 })
    expect(c.complete).toBe(true)
    expect(c.missing).toEqual([])
    const m = summary.metrics
    expect(c.byCategory.carburant.cost).toBeCloseTo(2 * m.totalFuelPoints.mean, 3)
    expect(c.byCategory.makina.cost).toBeCloseTo(10_000 * m.optimakinas.mean, 3)
    expect(c.byCategory.capture.cost).toBeCloseTo(500 * m.captures.mean, 3)
    expect(c.total).toBeCloseTo(2 * m.totalFuelPoints.mean + 10_000 * m.optimakinas.mean + 500 * m.captures.mean, 3)
    expect(c.nonMakinaCost).toBeCloseTo(c.total - c.makinaCost, 6)
    expect(c.genetonsValue).toBeCloseTo(375 * m.genetons.mean, 6)
    // Sérénité chiffrée au palier 1 (intégration : même convention que la page Enclos et Rentabilité).
    const baffeur = c.lines.find((l) => l.gauge === 'baffeur')
    expect(FUELS.find((f) => f.id === baffeur?.itemId)?.tier).toBe(1)
    // 3.7 : durabilité ×2 → coût au point divisé par 2.
    const c37 = estimateProgramCost(summary, { ctx, rules: RULESETS['3.7'], tier: 2, jobLevel: 1 })
    expect(c37.byCategory.carburant.cost).toBeCloseTo(m.totalFuelPoints.mean, 3)
  })
})

describe('comparaison et recommandation', () => {
  const jobs = ['n1', 'n40', 'n40-opti', 'sans-clonage'].map((p) => ({ id: p, label: findPreset(p)?.label ?? p, config: preset(p, POURPRE, { runs: 8 }) }))
  const results = runStrategies(jobs)

  it('désigne la plus rapide et signale les coûts incomparables', () => {
    const outcomes: StrategyOutcome[] = results.map((r) => ({
      ...r,
      cost: estimateProgramCost(r.summary, { ctx: { overrides: {}, useDefaults: false }, rules: RULESETS['3.6'], tier: 3, jobLevel: 1 }),
    }))
    const cmp = compareStrategies(outcomes)
    const minDays = Math.min(...outcomes.map((o) => o.summary.metrics.days.mean))
    expect(outcomes.find((o) => o.id === cmp.fastest)?.summary.metrics.days.mean).toBe(minDays)
    expect(cmp.costComparable).toBe(false)
    expect(cmp.messages.some((m) => m.title.includes('impossible de départager'))).toBe(true)
    expect(cmp.messages.some((m) => m.title === 'Le clonage est indispensable')).toBe(true)
    expect(cmp.messages.some((m) => m.title.startsWith('Monter les parents'))).toBe(true)
    const t = cmp.tradeoffs.find((x) => x.strategyId === 'n40-opti')
    expect(t?.referenceId).toBe('n40')
    expect(t?.breakEvenPrice).toBeNull()
  })

  it('avec des prix complets : moins chère et prix d\'équilibre de l\'Optimakina', () => {
    const overrides: Record<string, number> = {}
    for (const f of FUELS.filter((x) => x.tier === 3 || (x.tier === 1 && SERENITY.includes(x.gauge)))) overrides[f.id] = f.durability * 3
    for (const m of MAKINAS.filter((x) => x.kind === 'optimakina' && x.family === 'dragodinde')) overrides[m.id] = 1_000
    overrides[32521] = 300
    const ctx: PriceContext = { overrides, useDefaults: false }
    const outcomes: StrategyOutcome[] = results.map((r) => ({ ...r, cost: estimateProgramCost(r.summary, { ctx, rules: RULESETS['3.6'], tier: 3, jobLevel: 1 }) }))
    const cmp = compareStrategies(outcomes)
    expect(cmp.costComparable).toBe(true)
    const totals = outcomes.filter((o) => cmp.reliable.includes(o.id)).map((o) => o.cost?.total ?? Infinity)
    expect(outcomes.find((o) => o.id === cmp.cheapest)?.cost?.total).toBe(Math.min(...totals))
    const t = cmp.tradeoffs.find((x) => x.strategyId === 'n40-opti')
    const n40 = outcomes.find((o) => o.id === 'n40')
    const opti = outcomes.find((o) => o.id === 'n40-opti')
    const expected = Math.max(0, ((n40?.cost?.nonMakinaCost ?? 0) - (opti?.cost?.nonMakinaCost ?? 0)) / (opti?.summary.metrics.optimakinas.mean ?? 1))
    expect(t?.breakEvenPrice).toBeCloseTo(expected, 6)
    expect(t?.averageMakinaPrice).toBeCloseTo(1_000, 6)
    expect(t?.worthIt).toBe(1_000 < expected)
  })
})

describe('stratégies prédéfinies et références', () => {
  it('couvrent les politiques demandées', () => {
    const ids = STRATEGY_PRESETS.map((p) => p.id)
    expect(ids).toEqual(expect.arrayContaining(['n1', 'n40', 'n40-opti', 'n40-opti-g6', 'n100-opti', 'sans-clonage']))
    expect(new Set(ids).size).toBe(ids.length)
    expect(findPreset('sans-clonage')?.cloning).toBe(false)
  })

  it('références de la recherche selon le ruleset', () => {
    expect(researchReference(EMERAUDE, 'n40', RULESETS['3.6'])?.matings).toBe(821)
    expect(researchReference(EMERAUDE, 'n40', RULESETS['3.5'])?.matings).toBe(821)
    expect(researchReference(EMERAUDE, 'n40-opti-g6', RULESETS['3.7'])?.captures).toBe(117)
    expect(researchReference(EMERAUDE, 'n40', RULESETS['3.7'])).toBeUndefined()
  })
})
