import { describe, expect, it } from 'vitest'
import { getSpecies } from '../data'
import { breed, chanceOf, targetChance } from './genetics'
import { RULESETS } from './rules'

const byName = (id: number) => getSpecies(id)!.name
const pct = (p: number) => Math.round(p * 10_000) / 100

// Captures d'écran en jeu du guide DPLN (research/raw/mechanics-evidence/screenshots).
describe('modèle de naissance — exemples en jeu', () => {
  it('EX1 : Dragodinde Pourpre niv. 200 × Émeraude niv. 1 (parents Ivoire et Turquoise / Ivoire et Pourpre)', () => {
    const r = breed({ speciesId: 19, level: 200, parents: [] }, { speciesId: 21, level: 1, parents: [66, 68] })
    expect(r.targetGeneration).toBe(10)
    const got = Object.fromEntries(r.outcomes.map((o) => [byName(o.speciesId), pct(o.probability)]))
    expect(got).toEqual({
      'Dragodinde Émeraude et Pourpre': 60.15,
      'Dragodinde Pourpre': 19.92,
      'Dragodinde Émeraude': 15.73,
      'Dragodinde Ivoire et Turquoise': 2.1,
      'Dragodinde Ivoire et Pourpre': 2.1,
    })
    expect(r.recordPossible).toBe(true)
    expect(r.outcomes[0].genetons).toBe(265)
    expect(r.makinaGenerationRequired).toBe(10)
  })

  it('EX1 avec Optimakina : 70,15 % de génération cible', () => {
    const r = breed({ speciesId: 19, level: 200, parents: [] }, { speciesId: 21, level: 1, parents: [66, 68] }, { makina: 'optimakina' })
    expect(pct(r.targetChance)).toBe(70.15)
    expect(pct(chanceOf(r, 21))).toBe(11.78)
  })

  it('EX2 : Muldo Doré et Indigo × Muldo Pourpre (parents Pourpre + Corail) — cible G10 partagée', () => {
    const r = breed({ speciesId: 108, level: 1, parents: [94, 92] }, { speciesId: 93, level: 1, parents: [93, 298] })
    expect(r.targetGeneration).toBe(10)
    const got = Object.fromEntries(r.outcomes.map((o) => [byName(o.speciesId), pct(o.probability)]))
    expect(got['Muldo Corail et Doré']).toBe(15.15)
    expect(got['Muldo Corail et Indigo']).toBe(15.15)
    expect(got['Muldo Pourpre']).toBe(23.15)
    expect(got['Muldo Doré']).toBe(10.58)
    expect(got['Muldo Indigo et Pourpre']).toBe(9.77)
    expect(got['Muldo Corail']).toBe(1.93)
    expect(r.genetonsIfRecord).toBe(3)
  })

  it('EX3 : Ivoire et Turquoise × Ivoire et Pourpre (niveaux cumulés 144) → Émeraude 51,6 %', () => {
    const r = breed({ speciesId: 66, level: 72, parents: [66, 68] }, { speciesId: 68, level: 72, parents: [] })
    expect(r.targetGeneration).toBe(9)
    expect(pct(chanceOf(r, 21))).toBe(51.6)
    expect(pct(chanceOf(r, 68))).toBe(30.8)
    expect(pct(chanceOf(r, 66))).toBe(17.6)
    expect(r.outcomes.find((o) => o.speciesId === 21)?.genetons).toBe(240)
  })

  it('EX4 : génération cible égale au maximum des arbres → pas de génétons', () => {
    const r = breed({ speciesId: 66, level: 136, parents: [66, 68] }, { speciesId: 19, level: 136, parents: [] })
    expect(r.targetGeneration).toBe(8)
    expect(pct(chanceOf(r, 66))).toBe(51.49)
    expect(pct(chanceOf(r, 19))).toBe(29.2)
    expect(pct(chanceOf(r, 68))).toBe(19.31)
    expect(r.recordPossible).toBe(false)
    expect(r.expectedGenetons).toBe(0)
  })
})

describe('règles annexes', () => {
  it('somme des probabilités = 1', () => {
    const r = breed({ speciesId: 93, level: 50, parents: [] }, { speciesId: 94, level: 10, parents: [] })
    expect(r.outcomes.reduce((s, o) => s + o.probability, 0)).toBeCloseTo(1, 10)
  })

  it('bonus de génération cible : 0,15 % par niveau, Optimakina, Takeza, plafond 100 %', () => {
    expect(targetChance(1, 1)).toBeCloseTo(0.303)
    expect(targetChance(200, 200)).toBeCloseTo(0.9)
    expect(targetChance(200, 200, { makina: 'optimakina' })).toBe(1)
    expect(targetChance(40, 40, { makina: 'optimakina', rules: RULESETS['3.7'] })).toBeCloseTo(0.62)
    expect(targetChance(1, 1, { takeza: true })).toBeCloseTo(0.503)
  })

  it('même espèce sans croisement : 100 % la même couleur', () => {
    const r = breed({ speciesId: 93, level: 1, parents: [] }, { speciesId: 93, level: 1, parents: [] })
    expect(r.outcomes).toHaveLength(1)
    expect(r.outcomes[0].probability).toBe(1)
    expect(r.recordPossible).toBe(false)
  })

  it("XP d'Éleveur : 30 × (gén A + gén B) en 3.6, 10 en 3.5, ×2 avec Reproducteur", () => {
    const a = { speciesId: 108, level: 1, parents: [94, 92] }
    const b = { speciesId: 93, level: 1, parents: [] }
    expect(breed(a, b).jobXp).toBe(90)
    expect(breed(a, b, { rules: RULESETS['3.5'] }).jobXp).toBe(30)
    expect(breed({ ...a, ability: 'reproducteur' }, b).jobXp).toBe(180)
  })

  it('refuse deux familles différentes', () => {
    expect(() => breed({ speciesId: 19, level: 1, parents: [] }, { speciesId: 93, level: 1, parents: [] })).toThrow()
  })
})
