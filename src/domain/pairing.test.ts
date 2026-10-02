import { describe, expect, it } from 'vitest'
import {
  adviseOptimakina,
  analyzePair,
  bestDisjointPairs,
  goalContext,
  goalRelevance,
  matingCalibration,
  rankPairs,
  recordMating,
  sterileClonePairs,
  targetBreakdown,
  type PairingOptions,
} from './pairing'
import { breed, type BreedingParent } from './genetics'
import { RULESETS } from './rules'
import type { Gender, Mount } from './types'

// Dragodindes (ids client) : G1 Amande 20, Dorée 18, Rousse 10 ; G2 Amande et Dorée 33, Dorée et Rousse 46,
// Amande et Rousse 38 ; G3 Ébène 3, Indigo 17 ; G4 Ébène et Indigo 51 ; G5 Orchidée 22, Pourpre 19 ;
// G6 Indigo et Pourpre 65, Orchidée et Pourpre 76 ; G9 Émeraude 21 ; G10 Émeraude et Rousse 57.
const AMANDE = 20
const DOREE = 18
const ROUSSE = 10
const AMANDE_DOREE = 33
const EBENE = 3
const ORCHIDEE = 22
const POURPRE = 19
const ORCHIDEE_POURPRE = 76
const EMERAUDE = 21
const EMERAUDE_ROUSSE = 57

const R36 = RULESETS['3.6']
const pct = (p: number) => Math.round(p * 10_000) / 100

const parent = (speciesId: number, level = 40, parents: number[] = []): BreedingParent => ({ speciesId, level, parents })

const base: PairingOptions = { rules: R36, objective: 'progression', makinaPolicy: 'jamais' }

let seq = 0
function mount(speciesId: number, gender: Gender, patch: Partial<Mount> = {}): Mount {
  seq++
  return {
    id: `t${seq}`,
    speciesId,
    gender,
    level: 40,
    ability: null,
    fertility: 'fertile',
    parents: [],
    location: { kind: 'etable' },
    serenity: 0,
    endurance: 20_000,
    maturity: 20_000,
    love: 20_000,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  }
}

describe('targetBreakdown — B = 30 % + 0,15 %/niveau + Optimakina + Takeza', () => {
  it('niveaux 40 + 40 : 42 %', () => {
    const b = targetBreakdown(40, 40, { rules: R36 })
    expect(b.base).toBe(0.3)
    expect(b.levelSum).toBe(80)
    expect(b.levels).toBe(0.12)
    expect(b.total).toBe(0.42)
    expect(b.capped).toBe(false)
  })

  it('Optimakina (+10 % en 3.6, +20 % en 3.7) et Takeza (+20 %)', () => {
    expect(targetBreakdown(40, 40, { rules: R36, makina: 'optimakina' }).total).toBe(0.52)
    expect(targetBreakdown(40, 40, { rules: RULESETS['3.7'], makina: 'optimakina' }).total).toBe(0.62)
    expect(targetBreakdown(40, 40, { rules: R36, takeza: true }).takeza).toBe(0.2)
    expect(targetBreakdown(40, 40, { rules: R36, takeza: true }).total).toBe(0.62)
  })

  it('plafond à 100 % (seuil 400 niveaux avec Optimakina en 3.6)', () => {
    const b = targetBreakdown(200, 200, { rules: R36, makina: 'optimakina', takeza: true })
    expect(b.raw).toBe(1.2)
    expect(b.total).toBe(1)
    expect(b.capped).toBe(true)
    expect(targetBreakdown(200, 200, { rules: R36, makina: 'optimakina' }).total).toBe(1)
    expect(targetBreakdown(200, 199, { rules: R36, makina: 'optimakina' }).total).toBeLessThan(1)
  })

  it('aucune autre issue : 100 % quel que soit le niveau', () => {
    const r = breed(parent(AMANDE, 1), parent(AMANDE, 1))
    const b = targetBreakdown(1, 1, { rules: R36 }, r)
    expect(b.noAlternative).toBe(true)
    expect(b.total).toBe(1)
  })
})

describe('objectif (monture visée)', () => {
  it('recette et ascendance de l’Ébène', () => {
    const g = goalContext(EBENE)
    expect(g).not.toBeNull()
    expect(g?.recipe.has(AMANDE_DOREE)).toBe(true)
    expect(g?.recipe.has(DOREE)).toBe(true)
    expect(goalRelevance(EBENE, g)).toBe(3)
    expect(goalRelevance(AMANDE_DOREE, g)).toBe(2)
    expect(goalRelevance(ORCHIDEE_POURPRE, g)).toBe(0.5)
    expect(goalRelevance(ORCHIDEE_POURPRE, null)).toBe(1)
    expect(goalContext(null)).toBeNull()
  })
})

describe('analyzePair', () => {
  it('Amande × Dorée (G1, niv. 40) : cible Amande et Dorée à 42 %, 2 génétons', () => {
    const an = analyzePair(parent(AMANDE), parent(DOREE), base)
    expect(an.result.targetGeneration).toBe(2)
    expect(an.result.targetSpecies).toEqual([AMANDE_DOREE])
    expect(an.result.targetChance).toBe(0.42)
    expect(an.result.genetonsIfRecord).toBe(2)
    expect(an.makina).toBeNull()
    // Progression : seule l'issue nouvelle (G2) compte, pondérée par sa génération.
    expect(an.progress).toBeCloseTo(0.42 * 2, 10)
    expect(an.score).toBe(an.progress)
    expect(an.reasons.some((r) => r.startsWith('Arbres propres'))).toBe(true)
    expect(an.warnings.some((w) => w.startsWith('Niveau des parents'))).toBe(false)
  })

  it('objectif Ébène : la G2 de la recette compte double et le couple est « utile »', () => {
    const an = analyzePair(parent(AMANDE), parent(DOREE), { ...base, goalSpeciesId: EBENE })
    expect(an.goalRelevant).toBe(true)
    expect(an.goalChance).toBe(0)
    expect(an.progress).toBeCloseTo(0.42 * 2 * 2, 10)
    expect(an.reasons.some((r) => r.includes('Ébène'))).toBe(true)
  })

  it('arbre « sale » (recherche, M-CLEAN-01) : Orchidée × Pourpre aux parents G6 → 36,7 %, 0 généton', () => {
    const dirty = analyzePair(parent(ORCHIDEE, 40, [46, 51]), parent(POURPRE, 40, [65, ORCHIDEE_POURPRE]), base)
    expect(pct(dirty.result.outcomes.find((o) => o.speciesId === ORCHIDEE_POURPRE)!.probability)).toBe(36.7)
    expect(dirty.result.recordPossible).toBe(false)
    expect(dirty.result.expectedGenetons).toBe(0)
    expect(dirty.warnings.some((w) => w.startsWith('Arbres propres'))).toBe(true)
    // Avec une Pourpre « standard » : 42 % et 30 génétons ; meilleur score de progression.
    const clean = analyzePair(parent(ORCHIDEE, 40, [46, 51]), parent(POURPRE, 40, [38, 51]), base)
    expect(clean.result.targetChance).toBe(0.42)
    expect(clean.result.genetonsIfRecord).toBe(30)
    expect(clean.score).toBeGreaterThan(dirty.score)
  })

  it('porteur (M-CARRIER-01) : Dorée (parents Dorée + Émeraude) × Rousse → Émeraude et Rousse G10 à 42 %', () => {
    const an = analyzePair(parent(DOREE, 40, [DOREE, EMERAUDE]), parent(ROUSSE), base)
    expect(an.result.targetGeneration).toBe(10)
    expect(an.result.outcomes.find((o) => o.speciesId === EMERAUDE_ROUSSE)?.probability).toBeCloseTo(0.42, 10)
    expect(pct(an.result.outcomes.find((o) => o.speciesId === EMERAUDE)!.probability)).toBeCloseTo(15.4, 0)
    expect(an.result.genetonsIfRecord).toBe(2)
    expect(an.reasons.some((r) => r.startsWith('Porteurs'))).toBe(true)
  })

  it('parents niveau 1 : conseil de montée (M-LEVEL-01)', () => {
    const an = analyzePair(parent(AMANDE, 1), parent(DOREE, 1), base)
    const w = an.warnings.find((x) => x.startsWith('Niveau des parents'))
    expect(w).toBeDefined()
    expect(w).toContain('11,7 %')
  })

  it('objectif génétons : score = génétons attendus', () => {
    const an = analyzePair(parent(AMANDE), parent(DOREE), { ...base, objective: 'genetons' })
    expect(an.score).toBeCloseTo(0.42 * 2, 10)
  })

  it('objectif kamas : valeur attendue = bébés + génétons − makina (matingEconomics)', () => {
    const mountValue = (id: number) => (id === AMANDE_DOREE ? 100_000 : 10_000)
    const an = analyzePair(parent(AMANDE), parent(DOREE), { ...base, objective: 'profit', mountValue, genetonValue: 375 })
    const expected = 0.42 * 100_000 + 0.58 * 10_000 + 0.42 * 2 * 375
    expect(an.expectedValue).toBeCloseTo(expected, 6)
    expect(an.score).toBeCloseTo(expected, 6)
    expect(an.valueComplete).toBe(true)
  })

  it('sans fonction de valeur : aucune valeur attendue (pas de NaN)', () => {
    const an = analyzePair(parent(AMANDE), parent(DOREE), { ...base, objective: 'profit', genetonValue: 375 })
    expect(an.economics).toBeNull()
    expect(an.expectedValue).toBeUndefined()
    expect(an.valueComplete).toBe(false)
    // Repli : génétons × valeur − makina.
    expect(an.score).toBeCloseTo(0.42 * 2 * 375, 6)
  })

  it('valeur inconnue d’un bébé : valeur incomplète (jamais comptée comme complète)', () => {
    const an = analyzePair(parent(AMANDE), parent(DOREE), { ...base, objective: 'profit', mountValue: (id) => (id === AMANDE ? null : 5_000) })
    expect(an.valueComplete).toBe(false)
    expect(an.economics?.missingSpecies).toContain(AMANDE)
  })

  it('makina imposée (simulateur) : Kromakina → Caméléone, pas de bonus de cible', () => {
    const an = analyzePair(parent(AMANDE), parent(DOREE), { ...base, forcedMakina: 'kromakina' })
    expect(an.makina).toBe('kromakina')
    expect(an.result.targetChance).toBe(0.42)
    expect(an.result.abilityOdds).toEqual({ cameleone: 1 })
  })

  it('3.7 bêta : Optimakina +20 %', () => {
    const an = analyzePair(parent(AMANDE), parent(DOREE), { ...base, rules: RULESETS['3.7'], makinaPolicy: 'optimakina' })
    expect(an.makina).toBe('optimakina')
    expect(an.result.targetChance).toBe(0.62)
  })
})

describe('conseil d’Optimakina', () => {
  const cheap = () => ({ price: 20_000, complete: true })
  const dear = () => ({ price: 30_000, complete: true })

  it('politiques « jamais » et « toujours »', () => {
    expect(analyzePair(parent(AMANDE), parent(DOREE), base).makina).toBeNull()
    const always = analyzePair(parent(AMANDE), parent(DOREE), { ...base, makinaPolicy: 'optimakina' })
    expect(always.makina).toBe('optimakina')
    expect(always.result.targetChance).toBe(0.52)
    expect(always.makinaAdvice.basis).toBe('reglage')
  })

  it('règle de la recherche : prix < C_eff × Δ / p', () => {
    // C_eff = 100 000, p = 0,42, Δ = 0,10 → seuil ≈ 23 810.
    const opts: PairingOptions = { ...base, objective: 'profit', makinaPolicy: 'auto', coupleCost: () => 100_000 }
    const yes = analyzePair(parent(AMANDE), parent(DOREE), { ...opts, makinaCost: cheap })
    expect(yes.makinaAdvice.threshold).toBeCloseTo((100_000 * 0.1) / 0.42, 6)
    expect(yes.makinaAdvice.basis).toBe('regle-prix')
    expect(yes.makina).toBe('optimakina')
    expect(yes.result.targetChance).toBe(0.52)
    const no = analyzePair(parent(AMANDE), parent(DOREE), { ...opts, makinaCost: dear })
    expect(no.makina).toBeNull()
    expect(no.makinaAdvice.basis).toBe('regle-prix')
  })

  it('sans C_eff : seuil = gain × écart de valeur entre une naissance cible et une autre issue', () => {
    const mountValue = (id: number) => (id === AMANDE_DOREE ? 400_000 : 10_000)
    const r = analyzePair(parent(AMANDE), parent(DOREE), { ...base, objective: 'profit', makinaPolicy: 'auto', mountValue, makinaCost: cheap })
    // Écart = 400 000 − 10 000 = 390 000 ; gain 0,10 → seuil 39 000 > 20 000.
    expect(r.makinaAdvice.successValue).toBeCloseTo(390_000, 6)
    expect(r.makinaAdvice.threshold).toBeCloseTo(39_000, 6)
    expect(r.makina).toBe('optimakina')
    // Le surcroît de valeur attendue (0,1 × 390 000) dépasse bien le prix payé.
    const without = analyzePair(parent(AMANDE), parent(DOREE), { ...base, objective: 'profit', mountValue })
    expect(r.expectedValue! - without.expectedValue!).toBeCloseTo(39_000 - 20_000, 4)
  })

  it('coût incomplet : décidé seulement si la partie connue dépasse déjà le seuil', () => {
    const opts: PairingOptions = { ...base, objective: 'profit', makinaPolicy: 'auto', coupleCost: () => 100_000 }
    const over = analyzePair(parent(AMANDE), parent(DOREE), { ...opts, makinaCost: () => ({ price: 50_000, complete: false }) })
    expect(over.makina).toBeNull()
    expect(over.makinaAdvice.basis).toBe('regle-prix')
    const unknown = analyzePair(parent(AMANDE), parent(DOREE), { ...opts, makinaCost: () => ({ price: 5_000, complete: false }) })
    expect(unknown.makinaAdvice.basis).toBe('heuristique')
    // Cible G2 sans objectif : pas d'Optimakina par défaut.
    expect(unknown.makina).toBeNull()
  })

  it('progression : Optimakina dès la cible G6 (M-OPTI-01), sinon seulement si l’objectif en dépend', () => {
    const opts: PairingOptions = { ...base, makinaPolicy: 'auto' }
    const g6 = analyzePair(parent(ORCHIDEE, 40, [46, 51]), parent(POURPRE, 40, [38, 51]), opts)
    expect(g6.result.targetGeneration).toBe(6)
    expect(g6.makina).toBe('optimakina')
    expect(g6.makinaAdvice.basis).toBe('heuristique')
    expect(analyzePair(parent(AMANDE), parent(DOREE), opts).makina).toBeNull()
    expect(analyzePair(parent(AMANDE), parent(DOREE), { ...opts, goalSpeciesId: EBENE }).makina).toBe('optimakina')
  })

  it('inutile quand la cible est déjà certaine', () => {
    const a = breed(parent(AMANDE, 200), parent(DOREE, 200), { takeza: true })
    expect(a.targetChance).toBe(1)
    const adv = adviseOptimakina(a, null, { ...base, makinaPolicy: 'optimakina' }, { goalRelevant: true })
    expect(adv.use).toBe(false)
    expect(adv.basis).toBe('inutile')
    const same = analyzePair(parent(AMANDE), parent(AMANDE), { ...base, makinaPolicy: 'optimakina' })
    expect(same.makina).toBeNull()
    expect(same.makinaAdvice.basis).toBe('inutile')
  })

  it('génétons : seuil = gain × génétons de la naissance record × valeur du généton', () => {
    const r = analyzePair(parent(ORCHIDEE, 40, [46, 51]), parent(POURPRE, 40, [38, 51]), {
      ...base,
      objective: 'genetons',
      makinaPolicy: 'auto',
      genetonValue: 375,
      makinaCost: () => ({ price: 1_000, complete: true }),
    })
    expect(r.makinaAdvice.successValue).toBeCloseTo(30 * 375, 6)
    expect(r.makinaAdvice.threshold).toBeCloseTo(0.1 * 30 * 375, 6)
    expect(r.makina).toBe('optimakina')
  })
})

describe('rankPairs', () => {
  it('ne garde que les couples mâle × femelle féconds de même famille, triés par score', () => {
    const m = mount(AMANDE, 'male')
    const fDoree = mount(DOREE, 'femelle')
    const fRousse = mount(ROUSSE, 'femelle', { level: 1 })
    const fAmande = mount(AMANDE, 'femelle')
    const fSterile = mount(DOREE, 'femelle', { fertility: 'sterile' })
    const fFertile = mount(ROUSSE, 'femelle', { love: 0 })
    const otherMale = mount(DOREE, 'male')
    const muldo = mount(93, 'femelle')
    const list = rankPairs([m, fDoree, fRousse, fAmande, fSterile, fFertile, otherMale, muldo], base)
    const keys = list.map((s) => `${s.a.speciesId}x${s.b.speciesId}`)
    expect(list.every((s) => s.a.gender === 'male' && s.b.gender === 'femelle' && s.ready)).toBe(true)
    expect(list.some((s) => s.b.id === fSterile.id || s.b.id === fFertile.id || s.b.id === muldo.id)).toBe(false)
    expect(keys).toContain(`${AMANDE}x${DOREE}`)
    expect(keys).toContain(`${DOREE}x${ROUSSE}`)
    // Tri : score décroissant ; un couple de même couleur (aucune issue nouvelle) termine à 0.
    for (let i = 1; i < list.length; i++) expect(list[i - 1].score).toBeGreaterThanOrEqual(list[i].score)
    expect(list.find((s) => s.a.id === m.id && s.b.id === fAmande.id)?.score).toBe(0)
  })

  it('prévision : montures fertiles incluses avec ready = false', () => {
    const m = mount(AMANDE, 'male')
    const f = mount(DOREE, 'femelle', { love: 0 })
    expect(rankPairs([m, f], base)).toHaveLength(0)
    const list = rankPairs([m, f], { ...base, includeFertile: true })
    expect(list).toHaveLength(1)
    expect(list[0].ready).toBe(false)
    expect(list[0].warnings.some((w) => w.includes('pas encore féconde'))).toBe(true)
  })

  it('monture hors de l’étable : avertissement M-STABLE-01', () => {
    const m = mount(AMANDE, 'male', { location: { kind: 'enclos', paddock: 2 } })
    const f = mount(DOREE, 'femelle')
    const [s] = rankPairs([m, f], base)
    expect(s.warnings.some((w) => w.startsWith("Accoupler depuis l'étable") && w.includes('enclos 2'))).toBe(true)
  })
})

describe('bestDisjointPairs', () => {
  const s = (a: string, b: string, score: number) => ({ a: { id: a }, b: { id: b }, score })

  it('chaque monture une seule fois, et échange de partenaires si la somme augmente', () => {
    // Glouton seul : m1-f1 (10) + m2-f2 (0,5) = 10,5 ; optimum : m1-f2 (9) + m2-f1 (9) = 18.
    const plan = bestDisjointPairs([s('m1', 'f1', 10), s('m1', 'f2', 9), s('m2', 'f1', 9), s('m2', 'f2', 0.5)])
    expect(plan.map((p) => `${p.a.id}-${p.b.id}`).sort()).toEqual(['m1-f2', 'm2-f1'])
    const ids = plan.flatMap((p) => [p.a.id, p.b.id])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('ignore les couples de score nul (ou sous minScore)', () => {
    expect(bestDisjointPairs([s('m1', 'f1', 0), s('m2', 'f2', 3)])).toHaveLength(1)
    expect(bestDisjointPairs([s('m1', 'f1', 2), s('m2', 'f2', 3)], { minScore: 2.5 })).toHaveLength(1)
  })

  it('sur un vrai inventaire : plan disjoint', () => {
    const males = [mount(AMANDE, 'male'), mount(DOREE, 'male')]
    const females = [mount(DOREE, 'femelle'), mount(ROUSSE, 'femelle'), mount(AMANDE, 'femelle')]
    const plan = bestDisjointPairs(rankPairs([...males, ...females], base))
    expect(plan).toHaveLength(2)
    const ids = plan.flatMap((p) => [p.a.id, p.b.id])
    expect(new Set(ids).size).toBe(4)
  })
})

describe('recordMating', () => {
  it('bébé de la génération cible : étable, parents stériles, génétons et XP', () => {
    const a = mount(AMANDE, 'male')
    const b = mount(DOREE, 'femelle')
    const rec = recordMating(a, b, [{ speciesId: AMANDE_DOREE, gender: 'femelle', serenity: 1200 }], { rules: R36 })
    expect(rec.errors).toEqual([])
    expect(rec.babies).toHaveLength(1)
    expect(rec.babies[0]).toMatchObject({ speciesId: AMANDE_DOREE, gender: 'femelle', level: 1, fertility: 'fertile', parents: [AMANDE, DOREE], serenity: 1200 })
    expect(rec.babies[0].location).toEqual({ kind: 'etable' })
    expect(rec.parentUpdates).toEqual([
      { id: a.id, patch: { fertility: 'sterile' } },
      { id: b.id, patch: { fertility: 'sterile' } },
    ])
    expect(rec.genetons).toBe(2)
    expect(rec.jobXp).toBe(30 * (1 + 1))
    expect(rec.targetBirths).toBe(1)
    expect(rec.log).toMatchObject({ parentA: AMANDE, parentB: DOREE, babies: [AMANDE_DOREE], targetGeneration: 2, targetChance: 0.42, makina: null, genetons: 2, jobXp: 60 })
  })

  it('bébé hors cible : 0 généton ; Optimakina notée dans le journal', () => {
    const rec = recordMating(mount(AMANDE, 'male'), mount(DOREE, 'femelle'), [{ speciesId: AMANDE, gender: 'male' }], { rules: R36, makina: 'optimakina' })
    expect(rec.genetons).toBe(0)
    expect(rec.targetBirths).toBe(0)
    expect(rec.log?.targetChance).toBe(0.52)
    expect(rec.log?.makina).toBe('optimakina')
  })

  it('Reproducteur : 2 bébés attendus, XP × 2', () => {
    const a = mount(AMANDE, 'male', { ability: 'reproducteur' })
    const b = mount(DOREE, 'femelle')
    const one = recordMating(a, b, [{ speciesId: AMANDE_DOREE, gender: 'male' }], { rules: R36 })
    expect(one.warnings.some((w) => w.includes('2 bébés'))).toBe(true)
    const two = recordMating(
      a,
      b,
      [
        { speciesId: AMANDE_DOREE, gender: 'male' },
        { speciesId: DOREE, gender: 'femelle' },
      ],
      { rules: R36 },
    )
    expect(two.babies).toHaveLength(2)
    expect(two.jobXp).toBe(120)
    expect(two.genetons).toBe(2)
    expect(two.targetBirths).toBe(1)
  })

  it('erreurs bloquantes et avertissements', () => {
    const a = mount(AMANDE, 'male')
    expect(recordMating(a, mount(DOREE, 'male'), [{ speciesId: AMANDE_DOREE, gender: 'male' }], { rules: R36 }).errors.length).toBeGreaterThan(0)
    expect(recordMating(a, mount(DOREE, 'femelle'), [], { rules: R36 }).errors).toContain('Indiquez au moins un bébé.')
    expect(recordMating(a, mount(DOREE, 'femelle'), [{ speciesId: 93, gender: 'male' }], { rules: R36 }).errors.length).toBe(1)
    const odd = recordMating(a, mount(DOREE, 'femelle', { love: 0 }), [{ speciesId: EBENE, gender: 'male' }], { rules: R36 })
    expect(odd.errors).toEqual([])
    expect(odd.warnings.some((w) => w.includes("n'est pas une issue prévue"))).toBe(true)
    expect(odd.warnings.some((w) => w.includes('pas notée féconde'))).toBe(true)
  })
})

describe('sterileClonePairs (M-CLONE-01)', () => {
  it('même couleur d’abord, puis couleurs différentes de même génération', () => {
    const st = (id: number) => mount(id, 'male', { fertility: 'sterile' })
    const a1 = st(AMANDE)
    const a2 = st(AMANDE)
    const d = st(DOREE)
    const r = st(ROUSSE)
    const lone = st(AMANDE_DOREE)
    const fecund = mount(DOREE, 'femelle')
    const pairs = sterileClonePairs([a1, a2, d, r, lone, fecund])
    expect(pairs).toHaveLength(2)
    expect(pairs.find((p) => p.sameSpecies)).toMatchObject({ a: a1, b: a2, generation: 1 })
    const mixed = pairs.find((p) => !p.sameSpecies)
    expect([mixed?.a.id, mixed?.b.id].sort()).toEqual([d.id, r.id].sort())
    expect(sterileClonePairs([a1, a2, d, r], { involving: [d.id] })).toHaveLength(1)
  })
})

describe('matingCalibration', () => {
  it('observé vs attendu (Σ B par bébé), génétons et XP', () => {
    const entries = [
      { babies: [AMANDE_DOREE], targetGeneration: 2, targetChance: 0.42, genetons: 2, jobXp: 60 },
      { babies: [AMANDE], targetGeneration: 2, targetChance: 0.42, genetons: 0, jobXp: 60 },
      { babies: [AMANDE_DOREE, DOREE], targetGeneration: 2, targetChance: 0.5, genetons: 2, jobXp: 120 },
    ]
    const c = matingCalibration(entries)
    expect(c.matings).toBe(3)
    expect(c.births).toBe(4)
    expect(c.successes).toBe(2)
    expect(c.expected).toBeCloseTo(0.42 + 0.42 + 0.5 + 0.5, 10)
    expect(c.genetons).toBe(4)
    expect(c.jobXp).toBe(240)
    expect(c.verdict).toBe('insuffisant')
    expect(c.byGeneration).toHaveLength(1)
    expect(c.byChance.map((b) => b.key)).toEqual(['40-50', '50-60'])
  })

  it('verdict : conforme dans ±2 écarts-types, sinon au-dessus / en-dessous', () => {
    const many = (hits: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ babies: [i < hits ? AMANDE_DOREE : AMANDE], targetGeneration: 2, targetChance: 0.5, genetons: 0, jobXp: 0 }))
    expect(matingCalibration(many(10, 20)).verdict).toBe('conforme')
    expect(matingCalibration(many(19, 20)).verdict).toBe('au-dessus')
    expect(matingCalibration(many(1, 20)).verdict).toBe('en-dessous')
    expect(matingCalibration([]).verdict).toBe('insuffisant')
  })
})
