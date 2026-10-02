import { describe, expect, it } from 'vitest'
import { getSpecies, SPECIES } from '../data'
import {
  ancestorsOf,
  capturesByColor,
  cheapestRecipe,
  cleanParent,
  crossingChance,
  crossingOptions,
  descendantsOf,
  expectedEffort,
  matingsCount,
  minCaptures,
  parentsNeeded,
  recipeFor,
  requiredSpecies,
} from './breedingPath'
import { targetChance } from './genetics'
import { RULESETS } from './rules'
import type { FamilyId } from './types'

const id = (name: string): number => {
  const s = SPECIES.find((x) => x.name === name)
  if (!s) throw new Error(`introuvable : ${name}`)
  return s.id
}
const ofFamilyGen = (family: FamilyId, generation: number) => SPECIES.filter((s) => s.family === family && s.generation === generation)
const R36 = RULESETS['3.6']

describe('ascendance', () => {
  it('Volkorne Roux : 3 bicolores G2 et les 4 couleurs capturables', () => {
    const anc = ancestorsOf(id('Volkorne Roux'))
    expect(anc).toHaveLength(7)
    for (const n of ['Volkorne Pourpre', 'Volkorne Orchidée', 'Volkorne Indigo', 'Volkorne Ébène', 'Volkorne Pourpre et Orchidée', 'Volkorne Pourpre et Indigo', 'Volkorne Pourpre et Ébène'])
      expect(anc).toContain(id(n))
    // triés par génération croissante
    expect(getSpecies(anc[0])!.generation).toBe(1)
    expect(getSpecies(anc[anc.length - 1])!.generation).toBe(2)
  })

  it("une G1 capturée n'a pas d'ascendant ; une G10 descend des G1 de sa famille", () => {
    expect(ancestorsOf(id('Muldo Doré'))).toEqual([])
    const anc = ancestorsOf(id('Muldo Corail et Doré'))
    for (const g1 of ofFamilyGen('muldo', 1)) expect(anc).toContain(g1.id)
    expect(anc.every((a) => getSpecies(a)!.family === 'muldo')).toBe(true)
  })

  it('descendants : une G1 mène jusqu’aux G10, une G10 ne mène à rien', () => {
    const d = descendantsOf(id('Dragodinde Rousse'))
    expect(d).toContain(id('Dragodinde Émeraude'))
    expect(d.some((x) => getSpecies(x)!.generation === 10)).toBe(true)
    expect(descendantsOf(id('Dragodinde Amande et Émeraude'))).toEqual([])
  })
})

describe('recette idéale (captures minimales, research/tree-*.md)', () => {
  it('Volkornes : 4 (G3), 13 (Prune, Émeraude), 31 (Doré), 58 (gemmes G9)', () => {
    for (const s of ofFamilyGen('volkorne', 3)) expect(minCaptures(s.id)).toBe(4)
    expect(minCaptures(id('Volkorne Prune'))).toBe(13)
    expect(minCaptures(id('Volkorne Émeraude'))).toBe(13)
    expect(minCaptures(id('Volkorne Doré'))).toBe(31)
    for (const s of ofFamilyGen('volkorne', 9)) expect(minCaptures(s.id)).toBe(58)
  })

  it('Muldos : tableau §6 de tree-muldo.md (4/4/10/10/22/25/49/52/52/55 ; G10 de 50 à 107)', () => {
    const expected: Record<string, number> = {
      'Muldo Roux': 4,
      'Muldo Amande': 4,
      'Muldo Ivoire': 10,
      'Muldo Turquoise': 10,
      'Muldo Prune': 22,
      'Muldo Émeraude': 25,
      'Muldo Corail': 49,
      'Muldo Azur': 52,
      'Muldo Aigue-marine': 52,
      'Muldo Ambre': 55,
    }
    for (const [n, v] of Object.entries(expected)) expect(minCaptures(id(n)), n).toBe(v)
    const g10 = ofFamilyGen('muldo', 10).map((s) => minCaptures(s.id))
    expect(Math.min(...g10)).toBe(50)
    expect(Math.max(...g10)).toBe(107)
    expect(minCaptures(id('Muldo Corail et Doré'))).toBe(50)
    expect(minCaptures(id('Muldo Ambre et Azur'))).toBe(107)
  })

  it('Dragodindes : 4 / 10 / 34 / 112, G10 de 113 à 224 (Prune et Émeraude)', () => {
    expect(minCaptures(id('Dragodinde Ébène'))).toBe(4)
    expect(minCaptures(id('Dragodinde Pourpre'))).toBe(10)
    expect(minCaptures(id('Dragodinde Ivoire'))).toBe(34)
    expect(minCaptures(id('Dragodinde Émeraude'))).toBe(112)
    const g10 = ofFamilyGen('dragodinde', 10).map((s) => minCaptures(s.id))
    expect(Math.min(...g10)).toBe(113)
    expect(Math.max(...g10)).toBe(224)
    expect(minCaptures(id('Dragodinde Prune et Émeraude'))).toBe(224)
  })

  it('arbre : G1 = capture, captures par couleur, accouplements = captures − 1', () => {
    const tree = cheapestRecipe(id('Volkorne Doré'))!
    expect(tree.crossing).not.toBeNull()
    expect(tree.captures).toBe(31)
    expect(matingsCount(tree)).toBe(30)
    const byColor = capturesByColor(tree)
    expect([...byColor.values()].reduce((a, b) => a + b, 0)).toBe(31)
    for (const g1 of byColor.keys()) expect(getSpecies(g1)!.generation).toBe(1)
    const leaf = cheapestRecipe(id('Volkorne Pourpre'))!
    expect(leaf).toEqual({ speciesId: id('Volkorne Pourpre'), generation: 1, crossing: null, parents: null, captures: 1 })
  })

  it('Volkorne Prune : la recette retenue est l’une des moins chères (13), « Amande et Roux » + un autre bicolore', () => {
    const opts = crossingOptions(id('Volkorne Prune'))
    expect(opts).toHaveLength(12)
    expect(opts.filter((o) => o.cheapest)).toHaveLength(8)
    expect(opts[opts.length - 1].captures).toBe(16)
    const tree = cheapestRecipe(id('Volkorne Prune'))!
    expect(tree.crossing).toContain(id('Volkorne Amande et Roux'))
  })

  it('recette imposée et espèces requises', () => {
    const tree = recipeFor(id('Volkorne Jade'), [id('Volkorne Doré et Roux'), id('Volkorne Doré et Prune')])
    expect(tree.captures).toBe(79)
    const req = requiredSpecies(tree)
    expect(req[0]).toMatchObject({ speciesId: id('Volkorne Jade'), count: 1 })
    expect(req.find((r) => r.speciesId === id('Volkorne Doré'))?.count).toBe(2)
    const g1 = req.filter((r) => r.generation === 1).reduce((s, r) => s + r.count, 0)
    expect(g1).toBe(79)
    expect(() => recipeFor(id('Volkorne Jade'), [id('Volkorne Pourpre'), id('Volkorne Indigo')])).toThrow()
  })

  it('montures spéciales non élevables : pas de recette', () => {
    expect(cheapestRecipe(id('Dragodinde en armure'))).toBeNull()
    expect(minCaptures(id('Dragodinde à Plumes'))).toBe(Infinity)
  })
})

describe('effort attendu', () => {
  it('G2 depuis deux captures : 1/B accouplements, 2/B captures sans clonage', () => {
    const B = targetChance(40, 40)
    const e = expectedEffort(id('Muldo Doré et Pourpre'), { parentLevel: 40, makina: 'none', cloning: false, rules: R36 })
    expect(e.matings).toBeCloseTo(1 / B, 6)
    expect(e.captures).toBeCloseTo(2 / B, 6)
    expect(e.fecundations).toBeCloseTo(2 / B, 6)
    expect(e.clonings).toBe(0)
    expect(e.nodes[0]).toMatchObject({ chance: B, targetChance: B, sharedWith: [] })
  })

  it('clonage : ½ parent consommé par accouplement + le dernier clone ne resert pas', () => {
    expect(parentsNeeded(0, true)).toBe(0)
    expect(parentsNeeded(1, true)).toBe(1)
    expect(parentsNeeded(4, true)).toBe(2.5)
    expect(parentsNeeded(4, false)).toBe(4)
    const B = targetChance(40, 40)
    const e = expectedEffort(id('Muldo Doré et Pourpre'), { parentLevel: 40, makina: 'none', cloning: true, rules: R36 })
    expect(e.captures).toBeCloseTo(2 * (0.5 / B + 0.5), 6)
    expect(e.clonings).toBeCloseTo(1 / B, 6)
  })

  it('cible certaine (niv. 200 + Optimakina + Takeza) : on retrouve exactement la recette idéale', () => {
    const tree = cheapestRecipe(id('Volkorne Doré'))!
    const e = expectedEffort(id('Volkorne Doré'), { parentLevel: 200, makina: 'optimakina', takeza: true, cloning: false, rules: R36 })
    expect(e.captures).toBeCloseTo(tree.captures, 9)
    expect(e.matings).toBeCloseTo(matingsCount(tree), 9)
    for (const [g1, n] of capturesByColor(tree)) expect(e.capturesByColor.get(g1)).toBeCloseTo(n, 9)
    // Avec clonage, un parent partagé (Pourpre dans Pourpre et Orchidée × Pourpre et Indigo) coûte ½ de moins.
    const roux = expectedEffort(id('Volkorne Roux'), { parentLevel: 200, makina: 'optimakina', takeza: true, cloning: true, rules: R36 })
    expect(roux.captures).toBeCloseTo(3.5, 9)
  })

  it('plus de niveau, l’Optimakina, la 3.7 et le clonage réduisent l’effort', () => {
    const t = id('Dragodinde Émeraude')
    const base = { makina: 'none' as const, cloning: true, rules: R36 }
    const l1 = expectedEffort(t, { ...base, parentLevel: 1 })
    const l40 = expectedEffort(t, { ...base, parentLevel: 40 })
    const opti = expectedEffort(t, { ...base, parentLevel: 40, makina: 'optimakina' })
    const opti37 = expectedEffort(t, { ...base, parentLevel: 40, makina: 'optimakina', rules: RULESETS['3.7'] })
    const noClone = expectedEffort(t, { ...base, parentLevel: 40, cloning: false })
    expect(l40.captures).toBeLessThan(l1.captures)
    expect(opti.matings).toBeLessThan(l40.matings)
    expect(opti37.matings).toBeLessThan(opti.matings)
    expect(noClone.captures).toBeGreaterThan(10 * l40.captures)
    expect(opti.optimakinas).toBeCloseTo(opti.matings, 9)
    expect(opti.ideal).toEqual({ captures: 112, matings: 111 })
  })

  it('Optimakina à partir d’une génération : seuls ces accouplements en consomment', () => {
    const e = expectedEffort(id('Muldo Corail'), { parentLevel: 40, makina: 'optimakina', optimakinaFromGeneration: 6, cloning: true, rules: R36 })
    const expected = e.nodes.filter((n) => n.generation >= 6).reduce((s, n) => s + n.matings, 0)
    expect(e.optimakinas).toBeCloseTo(expected, 9)
    expect(e.optimakinas).toBeLessThan(e.matings)
    expect(e.nodes.filter((n) => n.generation < 6 && n.crossing).every((n) => !n.optimakina)).toBe(true)
  })

  it('cohérence interne : captures = Σ couleurs, fécondations = 2 × accouplements, génétons et XP positifs', () => {
    const e = expectedEffort(id('Volkorne Jade'), { parentLevel: 40, makina: 'none', cloning: true, rules: R36 })
    const sum = [...e.capturesByColor.values()].reduce((a, b) => a + b, 0)
    expect(e.captures).toBeCloseTo(sum, 9)
    expect(e.fecundations).toBeCloseTo(2 * e.matings, 9)
    expect(e.genetons).toBeGreaterThan(0)
    expect(e.jobXp.captures).toBeCloseTo(30 * e.captures, 6)
    expect(e.jobXp.total).toBeCloseTo(e.jobXp.matings + e.jobXp.captures, 6)
    expect(e.nodes[0].speciesId).toBe(id('Volkorne Jade'))
    expect(e.nodes.every((n, i) => i === 0 || n.generation <= e.nodes[i - 1].generation)).toBe(true)
    expect(e.assumptions.length).toBeGreaterThan(3)
  })

  it('recyclage des bébés ratés : borne optimiste, toujours ≤ sans recyclage', () => {
    const t = id('Muldo Prune')
    const opts = { parentLevel: 40, makina: 'none' as const, cloning: true, rules: R36 }
    const norec = expectedEffort(t, opts)
    const rec = expectedEffort(t, { ...opts, recycleByproducts: true })
    expect(rec.captures).toBeLessThan(norec.captures)
    expect(rec.matings).toBeLessThanOrEqual(norec.matings)
    expect(rec.nodes.some((n) => n.recycled > 0)).toBe(true)
  })

  // Ordres de grandeur de la simulation Monte-Carlo (research/strategy.md §6.2, 60 places, clonage).
  // Le modèle en espérance n'a ni sexes, ni places, ni arrondis : on vérifie un facteur ≤ 2,5 là où il
  // est censé coller (voir docs/api/genetics.md pour les écarts documentés).
  it('ordres de grandeur : niveau 40 + clonage + Optimakina partout ≈ simulation (×0,4 à ×2,5)', () => {
    const sim: [string, number, number][] = [
      ['Dragodinde Pourpre', 28, 53],
      ['Dragodinde Turquoise', 66, 165],
      ['Dragodinde Émeraude', 111, 378],
      ['Muldo Prune', 63, 135],
      ['Volkorne Doré', 76, 238],
      ['Muldo Corail', 108, 267],
      ['Volkorne Jade', 106, 347],
      ['Muldo Corail et Doré', 119, 322],
    ]
    for (const [n, c, acc] of sim) {
      const e = expectedEffort(id(n), { parentLevel: 40, makina: 'optimakina', cloning: true, rules: R36 })
      expect(e.captures / c, `${n} captures`).toBeGreaterThan(0.4)
      expect(e.captures / c, `${n} captures`).toBeLessThan(2.5)
      expect(e.matings / acc, `${n} accouplements`).toBeGreaterThan(0.4)
      expect(e.matings / acc, `${n} accouplements`).toBeLessThan(2.5)
    }
  })

  it('ordres de grandeur : niveau 40 + clonage sans makina, accouplements ≈ simulation (×0,5 à ×2)', () => {
    const sim: [string, number][] = [
      ['Dragodinde Pourpre', 78],
      ['Dragodinde Turquoise', 278],
      ['Dragodinde Émeraude', 821],
      ['Muldo Prune', 259],
      ['Volkorne Doré', 328],
      ['Muldo Corail', 617],
      ['Volkorne Jade', 775],
    ]
    for (const [n, acc] of sim) {
      const e = expectedEffort(id(n), { parentLevel: 40, makina: 'none', cloning: true, rules: R36 })
      expect(e.matings / acc, n).toBeGreaterThan(0.5)
      expect(e.matings / acc, n).toBeLessThan(2)
    }
  })

  it('refuse une recette qui ne correspond pas à l’espèce', () => {
    const tree = cheapestRecipe(id('Volkorne Roux'))!
    expect(() => expectedEffort(id('Volkorne Amande'), { parentLevel: 40, makina: 'none', cloning: true, recipe: tree })).toThrow()
    expect(() => expectedEffort(id('Dragodinde en armure'), { parentLevel: 40, makina: 'none', cloning: true })).toThrow()
  })
})

describe('chance d’un croisement', () => {
  it('arbres propres : P = B quand la cible est seule de sa génération', () => {
    const roux = id('Volkorne Roux')
    const [a, b] = cheapestRecipe(roux)!.crossing!
    const c = crossingChance(roux, [a, b], { parentLevel: 40, makina: 'optimakina', rules: R36 })
    expect(c.chance).toBeCloseTo(0.52, 9)
    expect(c.targetChance).toBeCloseTo(0.52, 9)
    expect(c.sharedWith).toEqual([])
    expect(c.genetonsIfRecord).toBe(4) // G2 + G2
    expect(c.jobXp).toBe(120) // 30 × (2 + 2)
    expect(cleanParent(a, 40).parents).toHaveLength(2)
    expect(cleanParent(id('Volkorne Pourpre'), 40).parents).toEqual([])
  })

  it('Dragodinde Émeraude (EX3 du guide) : Ivoire et Turquoise × Ivoire et Pourpre, génétons 240', () => {
    const c = crossingChance(id('Dragodinde Émeraude'), [id('Dragodinde Ivoire et Turquoise'), id('Dragodinde Ivoire et Pourpre')], {
      parentLevel: 72,
      makina: 'none',
      rules: R36,
    })
    expect(c.targetChance).toBeCloseTo(0.516, 9)
    expect(c.genetonsIfRecord).toBe(240)
  })
})
