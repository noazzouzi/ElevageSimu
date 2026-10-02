import { describe, expect, it } from 'vitest'
import { FUELS, INGREDIENTS, STRATEGY } from '../data'
import {
  CAPTURE_OPTION_ID,
  bestCraftAt,
  captureJobXp,
  captureOption,
  craftOptionsAt,
  jobAlmanaxDays,
  jobMilestones,
  levelingPlan,
  matingJobXp,
  nextPaddockTarget,
  otherXpSources,
  paddocksAt,
  recipeIngredients,
  shoppingListText,
  sortCraftOptions,
} from './job'
import type { PriceContext } from './pricing'
import { getRuleset } from './rules'
import { jobXpBetween } from './xp'

const R36 = getRuleset('3.6')
const R35 = getRuleset('3.5')
const R37 = getRuleset('3.7')
const NO_PRICES: PriceContext = { overrides: {}, useDefaults: false }
const DEFAULTS: PriceContext = { overrides: {}, useDefaults: true }

/** Tous les ingrédients à 100 K, sauf ceux des carburants d'Abreuvoir à 1 K. */
function cheapAbreuvoirPrices(): PriceContext {
  const overrides: Record<string, number> = {}
  for (const i of INGREDIENTS) overrides[String(i.id)] = 100
  for (const f of FUELS) if (f.gauge === 'abreuvoir') for (const ing of f.ingredients) overrides[String(ing.id)] = 1
  return { overrides, useDefaults: false }
}

describe('craftOptionsAt', () => {
  it('niveau 1 : seul le Filet de capture universel (10 XP, 20 ressources)', () => {
    const opts = craftOptionsAt(1, NO_PRICES, R36)
    expect(opts).toHaveLength(1)
    expect(opts[0]).toMatchObject({ id: 32521, kind: 'filet', xp: 10, ingredientCount: 20, costComplete: false, kamasPerXp: null })
    expect(opts[0].resourcesPerXp).toBe(2)
  })

  it('niveau 30 : recettes de niveau ≤ 30 avec XP > 0, Extraits (25) en tête à 15 XP', () => {
    const opts = craftOptionsAt(30, NO_PRICES, R36)
    expect(opts.every((o) => o.level <= 30 && o.xp > 0)).toBe(true)
    expect(opts.some((o) => o.kind === 'makina')).toBe(true)
    expect(opts[0].level).toBe(25)
    expect(opts[0].xp).toBe(15) // floor(25 / (1 + 0,1·5^1,1))
    expect(opts[0].ingredientCount).toBe(2)
  })

  it('exclut les recettes à plus de 100 niveaux sous le métier (XP nulle)', () => {
    const opts = craftOptionsAt(110, NO_PRICES, R36)
    expect(opts.some((o) => o.level === 5)).toBe(false)
    expect(opts.some((o) => o.level === 1)).toBe(false) // filet universel : 110 − 1 > 100
    expect(opts.some((o) => o.level === 15)).toBe(false) // floor(15 / 16) = 0
    expect(opts.some((o) => o.level === 25)).toBe(true)
  })

  it('coût par craft et kamas/XP quand les prix sont complets', () => {
    const ctx = cheapAbreuvoirPrices()
    const opts = craftOptionsAt(45, ctx, R36)
    const gig = opts.find((o) => o.name === "Gigantesque Extrait d'Abreuvoir")
    expect(gig).toBeDefined()
    expect(gig?.costComplete).toBe(true)
    expect(gig?.cost).toBe(2)
    expect(gig?.kamasPerXp).toBeCloseTo(2 / 45)
    const sorted = sortCraftOptions(opts, 'kamas')
    expect(sorted[0].gauge).toBe('abreuvoir')
    expect(sorted[0].level).toBe(45)
  })

  it('coût incomplet : jamais 0, borne basse et ingrédients manquants', () => {
    const opts = craftOptionsAt(30, NO_PRICES, R36)
    for (const o of opts) {
      expect(o.costComplete).toBe(false)
      expect(o.kamasPerXp).toBeNull()
      expect(o.missing.length).toBeGreaterThan(0)
    }
  })

  it('bonus Almanax +50 % : L × 1,5 XP au niveau de la recette', () => {
    const opts = craftOptionsAt(45, NO_PRICES, R36, { almanaxXpBonus: 0.5, kinds: ['carburant'] })
    expect(opts[0].xp).toBe(67) // floor(45 × 1,5)
    expect(opts[0].craftXp).toBe(45)
  })

  it('3.7 : recettes bêta des makinas, carburants inchangés', () => {
    const live = craftOptionsAt(40, NO_PRICES, R36, { kinds: ['makina'] })
    const beta = craftOptionsAt(40, NO_PRICES, R37, { kinds: ['makina'] })
    const k36 = live.find((o) => o.id === 33342)
    const k37 = beta.find((o) => o.id === 33342)
    expect(k36?.beta37).toBe(false)
    expect(k37?.beta37).toBe(true)
    expect(k37?.ingredients).toHaveLength(4)
    const fuel = FUELS[0]
    expect(recipeIngredients(fuel, R37)).toEqual({ ingredients: fuel.ingredients, beta37: false })
  })

  it('option capture : craft du filet + 30 XP de capture', () => {
    const cap = captureOption(1, NO_PRICES, R36)
    expect(cap).toMatchObject({ id: CAPTURE_OPTION_ID, kind: 'capture', xp: 40, craftXp: 10, ingredientCount: 20 })
    expect(captureOption(150, NO_PRICES, R36)?.xp).toBe(30) // le filet ne rapporte plus d'XP
  })
})

describe('bestCraftAt', () => {
  it('mode kamas sans prix : repli sur les ressources, signalé, avec les ingrédients à chiffrer', () => {
    const c = bestCraftAt(60, NO_PRICES, R36, 'kamas')
    expect(c?.fallback).toBe(true)
    expect(c?.option.level).toBe(55)
    expect(c?.toPrice.length).toBeGreaterThan(0)
  })

  it('mode kamas : ignore une vieille recette chiffrée mais inefficace', () => {
    // Prix par défaut : seul l'Extrait de Mangeoire (niv. 25) a un coût complet.
    const c = bestCraftAt(100, DEFAULTS, R36, 'kamas')
    expect(c?.option.level).toBe(95)
    expect(c?.fallback).toBe(true)
    const at30 = bestCraftAt(30, DEFAULTS, R36, 'kamas')
    expect(at30?.option.name).toBe('Extrait de Mangeoire')
    expect(at30?.fallback).toBe(false)
  })
})

describe('levelingPlan', () => {
  it('1 → 200 au critère ressources : ≈ 398 000 XP, ≈ 7 000 crafts, ≈ 23 500 ressources (recherche)', () => {
    const p = levelingPlan(1, 200, NO_PRICES, { rules: R36, metric: 'ressources' })
    expect(p.xpNeeded).toBe(398_000)
    expect(p.xpNeeded).toBe(jobXpBetween(1, 200))
    expect(p.totals.xp).toBeGreaterThanOrEqual(398_000)
    expect(p.totals.xp).toBeLessThan(398_000 + 195)
    expect(p.totals.crafts).toBeGreaterThan(6_900)
    expect(p.totals.crafts).toBeLessThan(7_100)
    expect(Math.abs(p.totals.resources - 23_535) / 23_535).toBeLessThan(0.02)
    expect(p.reachedLevel).toBe(200)
    expect(p.blockedAt).toBeNull()
    // Stratégie « taille qui vient d'être débloquée » : 26 filets puis ≈ 764 Minuscules Extraits.
    expect(p.segments[0]).toMatchObject({ fromLevel: 1, toLevel: 5, recipeId: 32521, crafts: 26 })
    expect(p.segments[1]).toMatchObject({ fromLevel: 5, toLevel: 15, recipeLevel: 5 })
    expect(Math.abs(p.segments[1].crafts - 764)).toBeLessThanOrEqual(10)
    // Une recette par taille de carburant : 20 tailles + le filet.
    expect(p.segments).toHaveLength(21)
  })

  it('cumuls par palier conformes au plan de la recherche (strategy.md §3.2, ± 3 %)', () => {
    for (const step of STRATEGY.jobLevelingPlan as unknown as { to: number; craftsCumulative: number; resourcesCumulative: number }[]) {
      const p = levelingPlan(1, step.to, NO_PRICES, { rules: R36, metric: 'ressources' })
      expect(Math.abs(p.totals.crafts - step.craftsCumulative) / step.craftsCumulative).toBeLessThan(0.03)
      expect(Math.abs(p.totals.resources - step.resourcesCumulative) / step.resourcesCumulative).toBeLessThan(0.03)
    }
  })

  it('mode kamas sans aucun prix : mêmes recettes qu’en ressources, chaque niveau signalé', () => {
    const r = levelingPlan(1, 200, NO_PRICES, { rules: R36, metric: 'ressources' })
    const k = levelingPlan(1, 200, NO_PRICES, { rules: R36, metric: 'kamas' })
    expect(k.totals.crafts).toBe(r.totals.crafts)
    expect(k.fallbackLevels).toBe(199)
    expect(k.segments.every((s) => s.fallback && !s.complete)).toBe(true)
    expect(k.totals.costComplete).toBe(false)
    expect(k.totals.cost).toBe(0)
    expect(k.toPrice.length).toBeGreaterThan(0)
    expect(k.shopping.every((l) => l.missing && l.subtotal === null)).toBe(true)
  })

  it('mode kamas avec prix complets : recettes les moins chères, coût complet = liste de courses', () => {
    const ctx = cheapAbreuvoirPrices()
    const p = levelingPlan(5, 200, ctx, { rules: R36, metric: 'kamas' })
    expect(p.fallbackLevels).toBe(0)
    expect(p.totals.costComplete).toBe(true)
    const fuelSegs = p.segments.filter((s) => s.kind === 'carburant')
    expect(fuelSegs.length).toBeGreaterThan(0)
    expect(fuelSegs.every((s) => s.gauge === 'abreuvoir')).toBe(true)
    const shopSum = p.shopping.reduce((s, l) => s + (l.subtotal ?? 0), 0)
    expect(shopSum).toBeCloseTo(p.totals.cost)
    expect(p.shopping.reduce((s, l) => s + l.qty, 0)).toBe(p.totals.resources)
    expect(p.shopping.every((l) => !l.missing)).toBe(true)
    // Ressources : même nombre que le plan « ressources » restreint à l'Abreuvoir.
    const r = levelingPlan(5, 200, ctx, { rules: R36, metric: 'ressources', fuelGauges: ['abreuvoir'] })
    expect(p.totals.cost).toBeLessThanOrEqual(r.totals.cost + 1e-9)
  })

  it('le bonus Almanax +50 % réduit le nombre de crafts d’environ un tiers', () => {
    const base = levelingPlan(15, 200, NO_PRICES, { rules: R36, metric: 'ressources' })
    const almanax = levelingPlan(15, 200, NO_PRICES, { rules: R36, metric: 'ressources', almanaxXpBonus: 0.5 })
    const ratio = almanax.totals.crafts / base.totals.crafts
    expect(ratio).toBeGreaterThan(0.6)
    expect(ratio).toBeLessThan(0.72)
  })

  it('captures : filet universel + capture au début, moins de crafts', () => {
    const p = levelingPlan(1, 40, NO_PRICES, { rules: R36, metric: 'ressources', includeCaptures: true })
    expect(p.segments[0].kind).toBe('capture')
    expect(p.totals.captures).toBeGreaterThan(0)
    const without = levelingPlan(1, 40, NO_PRICES, { rules: R36, metric: 'ressources' })
    expect(p.totals.crafts).toBeLessThan(without.totals.crafts)
    expect(p.totals.resources).toBeLessThan(without.totals.resources)
  })

  it('XP déjà gagnée dans le niveau et bornes', () => {
    const a = levelingPlan(40, 41, NO_PRICES, { rules: R36, metric: 'ressources' })
    const b = levelingPlan(40, 41, NO_PRICES, { rules: R36, metric: 'ressources', startXp: 500 })
    expect(a.xpNeeded).toBe(800)
    expect(b.xpNeeded).toBe(300)
    expect(b.totals.crafts).toBeLessThan(a.totals.crafts)
    const empty = levelingPlan(120, 80, NO_PRICES, { rules: R36, metric: 'kamas' })
    expect(empty.segments).toHaveLength(0)
    expect(empty.totals.crafts).toBe(0)
    expect(empty.xpNeeded).toBe(0)
  })

  it('plan interrompu si aucune recette ne rapporte d’XP avec les filtres', () => {
    const p = levelingPlan(1, 20, NO_PRICES, { rules: R36, metric: 'ressources', kinds: ['carburant'] })
    expect(p.blockedAt).toBe(1)
    expect(p.segments).toHaveLength(0)
  })

  it('jalons : acquis, dans le plan (avec cumuls), au-delà', () => {
    const p = levelingPlan(50, 130, NO_PRICES, { rules: R36, metric: 'ressources', family: 'muldo' })
    const find = (level: number, kind: string) => p.milestones.find((m) => m.level === level && m.kind === kind)
    expect(find(40, 'enclos')?.status).toBe('acquis')
    expect(find(55, 'carburant')?.status).toBe('plan')
    expect(find(55, 'carburant')?.crafts).toBeGreaterThan(0)
    expect(find(120, 'enclos')?.status).toBe('plan')
    expect(find(120, 'enclos')!.crafts!).toBeGreaterThan(find(80, 'enclos')!.crafts!)
    expect(find(160, 'enclos')?.status).toBe('au-dela')
    expect(p.milestones.some((m) => m.kind === 'makina')).toBe(true)
  })

  it('3.7 : carburants inchangés, même total au critère ressources', () => {
    const a = levelingPlan(1, 200, NO_PRICES, { rules: R36, metric: 'ressources' })
    const b = levelingPlan(1, 200, NO_PRICES, { rules: R37, metric: 'ressources' })
    expect(b.totals.crafts).toBe(a.totals.crafts)
  })

  it('cumuls par niveau (progress) : un point par niveau atteint, croissants, dernier = totaux', () => {
    const p = levelingPlan(20, 60, NO_PRICES, { rules: R36, metric: 'ressources' })
    expect(p.progress.map((x) => x.level)).toEqual(Array.from({ length: 40 }, (_, i) => 21 + i))
    for (let i = 1; i < p.progress.length; i++) expect(p.progress[i].crafts).toBeGreaterThan(p.progress[i - 1].crafts)
    expect(p.progress[p.progress.length - 1].crafts).toBe(p.totals.crafts)
    expect(p.segments[0].ingredients.length).toBeGreaterThan(0)
  })

  it('liste de courses en texte', () => {
    const p = levelingPlan(1, 5, NO_PRICES, { rules: R36, metric: 'ressources' })
    expect(shoppingListText(p.shopping)).toContain('× 260')
  })
})

describe('jalons et enclos', () => {
  it('enclos 40/80/120/160/200, carburants 5/55/105/155, filets 100/150/200', () => {
    const m = jobMilestones()
    expect(m.filter((x) => x.kind === 'enclos').map((x) => x.level)).toEqual([40, 80, 120, 160, 200])
    expect(m.filter((x) => x.kind === 'carburant').map((x) => x.level)).toEqual([5, 55, 105, 155])
    expect(m.filter((x) => x.kind === 'filet').map((x) => x.level)).toEqual([100, 150, 200])
    expect(m.some((x) => x.kind === 'makina')).toBe(false)
    const muldo = jobMilestones({ family: 'muldo' }).filter((x) => x.kind === 'makina')
    expect(muldo).toHaveLength(9)
    const levels = m.map((x) => x.level)
    expect(levels).toEqual(m.map((x) => x.level).sort((a, b) => a - b))
  })

  it('prochain enclos et enclos débloqués', () => {
    expect(nextPaddockTarget(1)).toBe(40)
    expect(nextPaddockTarget(40)).toBe(80)
    expect(nextPaddockTarget(199)).toBe(200)
    expect(nextPaddockTarget(200)).toBe(200)
    expect(paddocksAt(1)).toBe(1)
    expect(paddocksAt(120)).toBe(4)
    expect(paddocksAt(200)).toBe(6)
  })
})

describe('autres sources d’XP', () => {
  it('capture 30 XP, accouplement k × (G_A + G_B) selon le ruleset', () => {
    expect(captureJobXp(7)).toBe(210)
    expect(matingJobXp(4, 4, R36)).toBe(240)
    expect(matingJobXp(4, 4, R35)).toBe(80)
    expect(matingJobXp(5, 9, R36)).toBe(420)
    expect(matingJobXp(5, 9, R36, 2)).toBe(840)
  })

  it('équivalents pour une quantité d’XP', () => {
    const eq = otherXpSources(13_500, R36)
    expect(eq[0]).toMatchObject({ id: 'capture', xpEach: 30, count: 450 })
    expect(eq.find((e) => e.id === 'accouplement-4-4')?.count).toBe(57) // ceil(13 500 / 240)
    expect(otherXpSources(13_500, R35).find((e) => e.id === 'accouplement-4-4')?.xpEach).toBe(80)
  })
})

describe('jours Almanax du métier', () => {
  it('22/10 : +50 % XP Éleveurs, puis 01/05, 10/05 et 10/08', () => {
    const days = jobAlmanaxDays('2026-10-02')
    expect(days[0]).toMatchObject({ date: '2026-10-22', xpBonus: 0.5, breederOnly: true, daysUntil: 20 })
    const may1 = days.find((d) => d.date === '2027-05-01')
    expect(may1?.xpBonus).toBe(0.5)
    expect(may1?.breederOnly).toBe(false)
    expect(days.find((d) => d.date === '2027-05-10')?.ingredientSaving).toBe(0.15)
    expect(days.find((d) => d.date === '2027-08-10')?.doubleCraftChance).toBe(0.25)
    // Pas les bonus d'XP de personnage (créatures marines, territoire des dragodindes).
    expect(days.some((d) => /marines|Territoire/.test(d.effect))).toBe(false)
  })

  it('après le 22/10, le prochain est celui de l’année suivante', () => {
    const days = jobAlmanaxDays('2026-10-23')
    const xp = days.find((d) => d.breederOnly && d.xpBonus > 0)
    expect(xp?.date).toBe('2027-10-22')
    expect(jobAlmanaxDays('2026-10-22')[0].daysUntil).toBe(0)
  })
})
