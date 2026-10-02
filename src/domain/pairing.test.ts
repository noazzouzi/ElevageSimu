import { describe, expect, it } from 'vitest'
import {
  adviseOptimakina,
  analyzePair,
  bestDisjointPairs,
  economyCoupleCost,
  goalContext,
  goalRelevance,
  matingCalibration,
  rankPairs,
  recordMating,
  sterileClonePairs,
  TAKEZA_PRIORITY_GENERATION,
  targetBreakdown,
  type PairingOptions,
} from './pairing'
import { FUELS, NETS, getSpecies } from '../data'
import { captureCost, fertilityCost, levelingCost, makinaCost, mountValuation, type MountPriceContext } from './economy'
import { breed, type BreedingParent } from './genetics'
import type { PriceContext } from './pricing'
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

  it('progression sans prix : Optimakina dès la cible G6 (M-OPTI-01), jamais en G2–G3 même sur l’objectif', () => {
    const opts: PairingOptions = { ...base, makinaPolicy: 'auto' }
    const g6 = analyzePair(parent(ORCHIDEE, 40, [46, 51]), parent(POURPRE, 40, [38, 51]), opts)
    expect(g6.result.targetGeneration).toBe(6)
    expect(g6.makina).toBe('optimakina')
    expect(g6.makinaAdvice.basis).toBe('heuristique')
    expect(analyzePair(parent(AMANDE), parent(DOREE), opts).makina).toBeNull()
    // Ancien comportement (bogue F1) : une étape G2 de l'objectif recevait une Optimakina sans prix.
    const g2Goal = analyzePair(parent(AMANDE), parent(DOREE), { ...opts, goalSpeciesId: EBENE })
    expect(g2Goal.goalRelevant).toBe(true)
    expect(g2Goal.makina).toBeNull()
    expect(g2Goal.makinaAdvice.reason).toMatch(/^Pas d'Optimakina/)
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

// ---------- Corrections de la revue (groupe C1) ----------

// Muldos : G8 de la recette de Corail (G9) et une G8 hors objectif ; Doré (G1), Corail et Doré (G10).
const M_PRUNE_POURPRE = 146
const M_PRUNE_ROUX = 151
const M_ROUX_EMERAUDE = 161
const M_CORAIL = 298
const M_DORE = 94
const D_INDIGO = 17 // Dragodinde G3

describe('règle de prix de l’Optimakina toujours appliquée quand le prix est connu (F1, F8)', () => {
  const dear = () => ({ price: 2_000_000, complete: true })
  const mountValue = (id: number) => (id === AMANDE_DOREE ? 60_000 : 10_000)

  it('progression, étape G2 de l’objectif, Optimakina à 2 000 000 K : refusée par la règle de prix', () => {
    const opts: PairingOptions = { ...base, makinaPolicy: 'auto', goalSpeciesId: EMERAUDE, makinaCost: dear, mountValue, genetonValue: 375 }
    const an = analyzePair(parent(AMANDE), parent(DOREE), opts)
    expect(an.goalRelevant).toBe(true)
    expect(an.makina).toBeNull()
    expect(an.makinaAdvice.basis).toBe('regle-prix')
    expect(an.makinaAdvice.reason).toMatch(/^Optimakina non rentable/)
    // Même chose avec C_eff fourni (C_eff = 100 000 → seuil ≈ 23 810 K).
    const withCeff = analyzePair(parent(AMANDE), parent(DOREE), { ...opts, coupleCost: () => 100_000 })
    expect(withCeff.makina).toBeNull()
    expect(withCeff.makinaAdvice.basis).toBe('regle-prix')
    expect(withCeff.makinaAdvice.successBasis).toBe('c-eff')
  })

  it('heuristique sans prix : G2–G3 de l’objectif → non ; G4–G5 de l’objectif → oui (à défaut de prix) ; G6 → oui', () => {
    const opts: PairingOptions = { ...base, makinaPolicy: 'auto', goalSpeciesId: EMERAUDE }
    // G3 (Indigo) : Amande et Dorée × Amande et Rousse.
    const g3 = analyzePair(parent(AMANDE_DOREE, 40, [AMANDE, DOREE]), parent(38, 40, [AMANDE, ROUSSE]), opts)
    expect(g3.result.targetSpecies).toContain(D_INDIGO)
    expect(g3.goalRelevant).toBe(true)
    expect(g3.makina).toBeNull()
    // G5 (Orchidée) : Dorée et Rousse × Ébène et Indigo, étape de l'Émeraude.
    const g5 = analyzePair(parent(46, 40, [DOREE, ROUSSE]), parent(51, 40, [EBENE, D_INDIGO]), { ...opts, goalSpeciesId: ORCHIDEE })
    expect(g5.result.targetGeneration).toBe(5)
    expect(g5.makina).toBe('optimakina')
    expect(g5.makinaAdvice.reason).toContain('à défaut de prix')
    // Même étape G5, prix complet au-dessus du seuil : la règle de prix l'emporte.
    const g5Dear = analyzePair(parent(46, 40, [DOREE, ROUSSE]), parent(51, 40, [EBENE, D_INDIGO]), { ...opts, goalSpeciesId: ORCHIDEE, makinaCost: dear, coupleCost: () => 50_000 })
    expect(g5Dear.makina).toBeNull()
    expect(g5Dear.makinaAdvice.basis).toBe('regle-prix')
    // G6 sans prix : heuristique « systématique dès la G6 ».
    const g6 = analyzePair(parent(ORCHIDEE, 40, [46, 51]), parent(POURPRE, 40, [38, 51]), { ...base, makinaPolicy: 'auto' })
    expect(g6.makina).toBe('optimakina')
  })

  it('F8 : sans C_eff, la raison donne le vrai critère (écart de valeur des bébés), pas « C_eff »', () => {
    const mv = (id: number) => (id === AMANDE_DOREE ? 200_000 : 0)
    const r = analyzePair(parent(AMANDE), parent(DOREE), { ...base, objective: 'profit', makinaPolicy: 'auto', mountValue: mv, makinaCost: () => ({ price: 15_000, complete: true }) })
    expect(r.makinaAdvice.successBasis).toBe('valeur-bebes')
    expect(r.makinaAdvice.reason).not.toContain('C_eff')
    expect(r.makinaAdvice.reason).toContain('valeur d’un bébé cible')
    const g = analyzePair(parent(ORCHIDEE, 40, [46, 51]), parent(POURPRE, 40, [38, 51]), {
      ...base,
      objective: 'genetons',
      makinaPolicy: 'auto',
      genetonValue: 375,
      makinaCost: () => ({ price: 1_000, complete: true }),
    })
    expect(g.makinaAdvice.successBasis).toBe('genetons')
    expect(g.makinaAdvice.reason).not.toContain('C_eff')
  })

  it('C_eff incomplet (borne haute) : refus certain au-dessus du seuil, sinon heuristique', () => {
    const opts: PairingOptions = { ...base, objective: 'profit', makinaPolicy: 'auto', coupleCost: () => ({ value: 100_000, complete: false }) }
    const over = analyzePair(parent(AMANDE), parent(DOREE), { ...opts, makinaCost: () => ({ price: 30_000, complete: true }) })
    expect(over.makinaAdvice.thresholdIsUpperBound).toBe(true)
    expect(over.makina).toBeNull()
    expect(over.makinaAdvice.basis).toBe('regle-prix')
    expect(over.makinaAdvice.reason).toContain('seuil maximal')
    const under = analyzePair(parent(AMANDE), parent(DOREE), { ...opts, makinaCost: () => ({ price: 5_000, complete: true }) })
    expect(under.makinaAdvice.basis).toBe('heuristique')
    expect(under.makina).toBeNull() // cible G2 sans objectif
  })
})

describe('economyCoupleCost : C_eff = remplacement − valeur résiduelle des stériles', () => {
  const priced: PriceContext = { overrides: Object.fromEntries([...FUELS.map((f) => [String(f.id), f.durability]), ...NETS.map((n) => [String(n.id), 3_000])]), useDefaults: true }
  const mctx: MountPriceContext = { mountOverrides: {}, generationOverrides: {}, useDefaults: true }
  const cfg = { ctx: priced, mountPrices: mctx, saleTax: 0.02, rules: R36, jobLevel: 200, tier: 2 as const }

  it('G1 capturée : capture + XP jusqu’au niveau + fécondation − stérile ; G2 sans prix : production estimée', () => {
    const model = economyCoupleCost(cfg)
    const ctx = { ...priced, jobLevel: 200 }
    const cap = captureCost('dragodinde', 'universel', ctx, { jobLevel: 200 }).perMount as number
    const lvl = levelingCost(1, 40, { tier: 2, batchSize: 10, ctx, rules: R36, jobLevel: 200 }).costPerMount as number
    const fert = fertilityCost({ tier: 2, batchSize: 10, ctx, rules: R36, jobLevel: 200, model: 'typique' }).perMount as number
    const pa = model.parent(parent(AMANDE))
    expect(pa.acquisitionMethod).toBe('capture')
    expect(pa.replacement).toBeCloseTo(cap + lvl + fert, 6)
    const sterile = mountValuation(AMANDE, 40, { ctx, mountPrices: mctx, saleTax: 0.02, state: 'sterile' })
    // Vente d'une G1 stérile non chiffrée (plancher) : valeur résiduelle = borne basse, C_eff = borne haute.
    expect(pa.residualComplete).toBe(sterile.complete)
    const bd = model.breakdown(parent(AMANDE), parent(DOREE))
    expect(bd.value).toBeCloseTo((pa.net as number) + (model.parent(parent(DOREE)).net as number), 6)
    expect(bd.complete).toBe(false)
    expect(model.cost(parent(AMANDE), parent(DOREE))).toEqual({ value: bd.value, complete: false })
    const g2 = model.parent(parent(AMANDE_DOREE))
    expect(['valeur', 'production']).toContain(g2.acquisitionMethod)
    expect(g2.replacement).toBeGreaterThan(pa.replacement as number)
  })

  it('prix inconnus (aucun prix par défaut) : C_eff null, jamais compté 0', () => {
    const model = economyCoupleCost({ ...cfg, ctx: { overrides: {}, useDefaults: false }, mountPrices: { ...mctx, useDefaults: false } })
    expect(model.cost(parent(AMANDE), parent(DOREE))).toBeNull()
    expect(model.parent(parent(AMANDE)).missing.length).toBeGreaterThan(0)
  })

  it('branché sur analyzePair : le conseil cite C_eff et son montant', () => {
    const model = economyCoupleCost(cfg)
    const ctx = { ...priced, jobLevel: 200 }
    const an = analyzePair(parent(ORCHIDEE, 40, [46, 51]), parent(POURPRE, 40, [38, 51]), {
      ...base,
      makinaPolicy: 'auto',
      coupleCost: model.cost,
      makinaCost: (k, f, g) => makinaCost(k, f, g, ctx, R36),
    })
    expect(an.makinaAdvice.successBasis).toBe('c-eff')
    expect(an.makinaAdvice.coupleCost).not.toBeNull()
  })
})

describe('plan d’accouplement et objectif (F2) : ne pas consommer une monture de la recette hors objectif', () => {
  const corail: PairingOptions = { ...base, goalSpeciesId: M_CORAIL }
  const scenario = () => {
    const topA = mount(M_PRUNE_POURPRE, 'male', { fertility: 'feconde', name: 'TOP-A' })
    const topB = mount(M_PRUNE_ROUX, 'femelle', { endurance: 0, maturity: 0, love: 0, name: 'TOP-B' })
    const off = mount(M_ROUX_EMERAUDE, 'femelle', { fertility: 'feconde', name: 'OFF' })
    return { topA, topB, off }
  }

  it('TOP-A × OFF (hors objectif) n’entre pas dans le plan ; il faut attendre TOP-B', () => {
    const { topA, topB, off } = scenario()
    const ranked = rankPairs([topA, topB, off], corail)
    const bad = ranked.find((p) => p.a.id === topA.id && p.b.id === off.id)
    expect(bad).toBeDefined()
    expect(bad?.consumesGoalParents).toContain(M_PRUNE_POURPRE)
    expect(bad?.score).toBeLessThanOrEqual(0)
    expect(bad?.waitFor).toEqual([{ mountId: topA.id, partnerId: topB.id, targetSpecies: expect.arrayContaining([M_CORAIL]) }])
    expect(bad?.warnings.some((w) => w.includes('Attendez plutôt que TOP-B soit féconde'))).toBe(true)
    expect(bestDisjointPairs(ranked).some((p) => p.a.id === topA.id && p.b.id === off.id)).toBe(false)
    // Une fois TOP-B féconde, TOP-A × TOP-B (52 % de G9 Corail avec Optimakina) est le plan.
    const ready = { ...topB, fertility: 'feconde' as const, endurance: 20_000, maturity: 20_000, love: 20_000 }
    const plan = bestDisjointPairs(rankPairs([topA, ready, off], corail))
    expect(plan.map((p) => `${p.a.id}|${p.b.id}`)).toEqual([`${topA.id}|${topB.id}`])
  })

  it('objectif kamas : le couple hors objectif attend aussi si le couple de l’objectif rapporte au moins autant', () => {
    const { topA, topB, off } = scenario()
    const profit: PairingOptions = { ...corail, objective: 'profit', mountValue: () => 10_000, genetonValue: 375 }
    const ranked = rankPairs([topA, topB, off], profit)
    const bad = ranked.find((p) => p.a.id === topA.id && p.b.id === off.id)
    expect(bad?.waitFor).toHaveLength(1)
    expect(bad?.score).toBe(0)
    expect(bestDisjointPairs(ranked)).toHaveLength(0)
  })

  it('G1 capturable de la recette : consommable hors objectif, sauf si sa partenaire de l’objectif est en préparation', () => {
    // Objectif Dragodinde Amande et Dorée (G2) : Amande ♂ féconde, Rousse ♀ féconde (hors recette), Dorée ♀ fertile.
    const opts: PairingOptions = { ...base, goalSpeciesId: AMANDE_DOREE }
    const amande = mount(AMANDE, 'male', { fertility: 'feconde' })
    const rousse = mount(ROUSSE, 'femelle', { fertility: 'feconde' })
    const alone = rankPairs([amande, rousse], opts)
    expect(alone[0].consumesGoalParents).toEqual([])
    expect(alone[0].score).toBeGreaterThan(0)
    const doree = mount(DOREE, 'femelle', { endurance: 0, maturity: 0, love: 0 })
    const waiting = rankPairs([amande, rousse, doree], opts)[0]
    expect(waiting.waitFor).toEqual([{ mountId: amande.id, partnerId: doree.id, targetSpecies: [AMANDE_DOREE] }])
    expect(waiting.score).toBe(0)
    expect(bestDisjointPairs(rankPairs([amande, rousse, doree], opts))).toHaveLength(0)
  })

  it('M-STACK-01 : un seul couple G8 × G8 de l’objectif est signalé ; trois de chaque ne le sont pas', () => {
    const a = mount(M_PRUNE_POURPRE, 'male', { fertility: 'feconde' })
    const b = mount(M_PRUNE_ROUX, 'femelle', { fertility: 'feconde' })
    const [one] = rankPairs([a, b], corail)
    expect(one.stackAttempts).toBe(1)
    expect(one.warnings.some((w) => w.startsWith('Accumuler avant de tenter'))).toBe(true)
    const males = [a, mount(M_PRUNE_POURPRE, 'male'), mount(M_PRUNE_POURPRE, 'male', { love: 0 })]
    const females = [b, mount(M_PRUNE_ROUX, 'femelle'), mount(M_PRUNE_ROUX, 'femelle')]
    const many = rankPairs([...males, ...females], corail).find((p) => p.a.id === a.id && p.b.id === b.id)
    expect(many?.stackAttempts).toBe(3)
    expect(many?.warnings.some((w) => w.startsWith('Accumuler avant de tenter'))).toBe(false)
    // Couple sans objectif, ou cible basse : pas de vérification.
    expect(rankPairs([mount(AMANDE, 'male'), mount(DOREE, 'femelle')], base)[0].stackAttempts).toBeNull()
  })

  it('porteuse consommée hors objectif : comptée ; une G1 capturable ne l’est pas (une capture la remplace)', () => {
    // Doré porteuse de Corail (G9) × Pourpre (G1) → Corail et Pourpre : hors objectif Corail et Doré.
    const an = analyzePair(parent(M_DORE, 40, [M_CORAIL, M_DORE]), parent(93), { ...base, goalSpeciesId: 315 })
    expect(an.goalRelevant).toBe(false)
    expect(an.consumesGoalParents).toEqual([M_CORAIL])
    expect(an.opportunityCost).toBeCloseTo(2 * 9, 10)
    expect(an.score).toBeLessThan(0)
    // La bonne partenaire (Doré) vise l'objectif : rien de consommé.
    const good = analyzePair(parent(M_DORE, 40, [M_CORAIL, M_DORE]), parent(M_DORE), { ...base, goalSpeciesId: 315 })
    expect(good.goalChance).toBeGreaterThan(0.4)
    expect(good.consumesGoalParents).toEqual([])
  })
})

describe('clonage : sexe et généalogie (F9)', () => {
  const st = (id: number, g: Gender, parents: number[] = []) => mount(id, g, { fertility: 'sterile', parents })

  it('2 ♂ + 2 ♀ stériles de même couleur : ♂+♂ et ♀+♀, résultat certain', () => {
    const m1 = st(AMANDE, 'male')
    const f1 = st(AMANDE, 'femelle')
    const m2 = st(AMANDE, 'male')
    const f2 = st(AMANDE, 'femelle')
    const pairs = sterileClonePairs([m1, f1, m2, f2])
    expect(pairs).toHaveLength(2)
    for (const p of pairs) {
      expect(p.a.gender).toBe(p.b.gender)
      expect(p.certain).toBe(true)
    }
  })

  it('une porteuse n’est pas appariée à un arbre ordinaire s’il existe une autre possibilité', () => {
    const porteur = st(M_DORE, 'male', [M_CORAIL, M_DORE])
    const plainM = st(M_DORE, 'male')
    const plainF = st(M_DORE, 'femelle')
    const pairs = sterileClonePairs([porteur, plainM, plainF])
    expect(pairs).toHaveLength(1)
    expect([pairs[0].a.id, pairs[0].b.id].sort()).toEqual([plainM.id, plainF.id].sort())
    expect(pairs[0].certain).toBe(false)
    expect(pairs[0].sameGender).toBe(false)
  })
})

describe('Takeza (F16)', () => {
  it('seuil commun : cible ≥ G6, comme l’Optimakina systématique', () => {
    expect(TAKEZA_PRIORITY_GENERATION).toBe(6)
    expect(getSpecies(M_CORAIL)?.generation).toBeGreaterThanOrEqual(TAKEZA_PRIORITY_GENERATION)
  })
})
