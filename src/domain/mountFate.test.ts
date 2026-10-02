import { describe, expect, it } from 'vitest'
import { mountValuation, type FateValue, type MountPriceContext, type MountState } from './economy'
import {
  captureBlockers,
  capturedMounts,
  captureSlots,
  clonePatch,
  extractionQuantity,
  goalPlan,
  inventorySummary,
  levelTargets,
  locationKey,
  moveBlockers,
  mountUsefulness,
  pairForCloning,
  parseLocationKey,
  recommendFate,
  recommendFates,
  serenitySmiley,
  unlockedPaddocks,
  type FateContext,
  type FateValuation,
  type LevelCostFn,
  type ValuationFn,
} from './mountFate'
import type { PriceContext } from './pricing'
import { RULESETS } from './rules'
import type { Mount } from './types'

const R36 = RULESETS['3.6']
const R37 = RULESETS['3.7']

// Muldos
const ORCHIDEE = 90
const INDIGO = 92
const POURPRE = 93
const DORE = 94
const ROUX = 95 // G3
const DORE_INDIGO = 108 // G2 = Doré × Indigo
const EBENE_INDIGO = 109 // G2
const ROUX_DORE = 115 // G4 = Doré × Roux
const MULDO_G5_ANY = 96 // Amande (G3) — extraction 3
// Volkorne / Dragodinde
const VOLK_INDIGO = 176
const DRAGO_AMANDE_EMERAUDE = 35 // G10
const DRAGO_PLUMES = 89 // spéciale G0

let seq = 0
function mk(speciesId: number, over: Partial<Mount> = {}): Mount {
  seq++
  return {
    id: `t${String(seq).padStart(3, '0')}`,
    speciesId,
    gender: 'male',
    level: 1,
    ability: null,
    fertility: 'fertile',
    parents: [],
    location: { kind: 'etable' },
    serenity: 0,
    endurance: 0,
    maturity: 0,
    love: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}
const FECUND = { endurance: 20_000, maturity: 20_000, love: 20_000 }

type Nets = { sale?: number | null; extraction?: number | null; brisage?: number | null; conf?: string }

function fv(kind: FateValue['kind'], net: number | null | undefined): FateValue {
  const possible = net !== undefined
  return { kind, possible, gross: net ?? null, net: possible ? (net as number | null) : null, complete: !possible || net !== null, origin: 'test' }
}

/** Valorisation factice : `fn` donne les montants nets (undefined = option impossible, null = prix manquant). */
function fakeVal(fn: (id: number, level: number, state: MountState, senile: boolean) => Nets): ValuationFn {
  return (id, level, { state, senile }) => {
    const n = fn(id, level, state, senile)
    const sale = fv('vente', n.sale)
    const extraction = fv('extraction', n.extraction)
    const brisage = fv('brisage', n.brisage)
    let best: FateValue | null = null
    for (const f of [extraction, brisage, sale]) if (f.possible && f.net !== null && (!best || f.net > (best.net as number))) best = f
    const v: FateValuation = {
      sale,
      extraction,
      brisage,
      best: best?.net ?? null,
      bestKind: best?.kind ?? null,
      confidence: n.conf ?? 'medium',
      complete: [sale, extraction, brisage].every((f) => !f.possible || f.complete),
    }
    return v
  }
}

const flatVal = fakeVal((_id, _l, state) => ({ sale: state === 'feconde' ? 6_000 : 5_000, extraction: 2_000, brisage: undefined }))

function ctxOf(inventory: Mount[], over: Partial<FateContext> = {}): FateContext {
  return { inventory, goalSpeciesId: DORE_INDIGO, rules: R36, valuation: flatVal, ...over }
}

describe('objectif et utilité', () => {
  it('goalPlan : recette et ascendance de Muldo Doré et Indigo (G2)', () => {
    const plan = goalPlan(DORE_INDIGO)
    expect(plan).not.toBeNull()
    expect([...(plan?.recipe ?? [])].sort()).toEqual([INDIGO, DORE, DORE_INDIGO].sort())
    expect([...(plan?.ancestors ?? [])].sort()).toEqual([INDIGO, DORE].sort())
    expect(goalPlan(DORE_INDIGO)).toBe(plan) // mémorisé
    expect(goalPlan(null)).toBeNull()
    expect(goalPlan(DRAGO_PLUMES)).toBeNull() // spéciale non élevable
  })

  it('mountUsefulness : recette, hors plan, autre famille, G10 sans objectif', () => {
    const plan = goalPlan(DORE_INDIGO)
    const indigo = mountUsefulness(mk(INDIGO), plan)
    expect(indigo.kind).toBe('recette')
    expect(indigo.useful).toBe(true)
    expect(indigo.crossings[0]).toEqual({ partner: DORE, child: DORE_INDIGO })
    expect(mountUsefulness(mk(DORE_INDIGO), plan).kind).toBe('objectif')
    expect(mountUsefulness(mk(POURPRE), plan)).toMatchObject({ kind: 'aucune', useful: false })
    expect(mountUsefulness(mk(VOLK_INDIGO), plan)).toMatchObject({ kind: 'progression', useful: true })
    expect(mountUsefulness(mk(DRAGO_AMANDE_EMERAUDE), null)).toMatchObject({ kind: 'aucune', useful: false })
    expect(mountUsefulness(mk(DRAGO_PLUMES), null).useful).toBe(false)
  })

  it('porteuse : un parent de génération supérieure utile au plan (M-CARRIER-01)', () => {
    const plan = goalPlan(ROUX_DORE)
    expect(plan?.ancestors.has(ROUX)).toBe(true)
    expect(plan?.ancestors.has(EBENE_INDIGO)).toBe(false)
    const carrier = mountUsefulness(mk(EBENE_INDIGO, { parents: [ROUX, EBENE_INDIGO] }), plan)
    expect(carrier.kind).toBe('porteur')
    expect(carrier.carried).toBe(ROUX)
    expect(carrier.crossings.some((c) => c.partner === DORE && c.child === ROUX_DORE)).toBe(true)
    expect(mountUsefulness(mk(EBENE_INDIGO), plan).kind).toBe('aucune')
  })
})

describe('recommendFates — grille de sort', () => {
  it('1. garde une féconde utile et nomme sa partenaire, ou dit ce qui manque', () => {
    const a = mk(INDIGO, { ...FECUND, gender: 'male' })
    const b = mk(DORE, { ...FECUND, gender: 'femelle', name: 'Dorette' })
    const fates = recommendFates(ctxOf([a, b]))
    expect(fates.get(a.id)).toMatchObject({ action: 'garder', rule: 1 })
    expect(fates.get(a.id)?.reason).toContain('Dorette')
    const alone = recommendFates(ctxOf([a])).get(a.id)
    expect(alone?.action).toBe('garder')
    expect(alone?.reason).toContain('à capturer ou à produire')
    const fertile = recommendFates(ctxOf([mk(INDIGO)]))
    expect([...fertile.values()][0].label).toBe('Garder — à féconder')
  })

  it("2. accouple d'abord deux fécondes condamnées de sexes opposés (bébé gratuit)", () => {
    const a = mk(POURPRE, { ...FECUND, gender: 'male' })
    const b = mk(ORCHIDEE, { ...FECUND, gender: 'femelle' })
    const fates = recommendFates(ctxOf([a, b], { genetonValue: 100 }))
    const fa = fates.get(a.id)
    const fb = fates.get(b.id)
    expect(fa).toMatchObject({ action: 'accoupler', rule: 2, partnerId: b.id, exit: 'vente' })
    expect(fb).toMatchObject({ action: 'accoupler', partnerId: a.id })
    // Stérile ensuite (5 000) + ½ × (bébé fertile 5 000 + génétons G1+G1 = 2 × B(0,303) × 100).
    const bonus = 5_000 + 2 * 0.303 * 100
    expect(fa?.value).toBeCloseTo(5_000 + bonus / 2, 6)
    expect(fa?.complete).toBe(true)
    expect(fa?.reason).toContain("Placez les deux montures dans l'étable")
  })

  it("2bis. pas d'accouplement entre deux condamnées de même sexe → sortie (n° 6)", () => {
    const a = mk(POURPRE, { ...FECUND, gender: 'male' })
    const b = mk(ORCHIDEE, { ...FECUND, gender: 'male' })
    const f = recommendFates(ctxOf([a, b])).get(a.id)
    expect(f).toMatchObject({ action: 'vente', rule: 6, value: 6_000 })
  })

  it('2ter. vendre fécondes si cela rapporte plus que le bébé gratuit', () => {
    const val = fakeVal((_id, _l, state) => ({ sale: state === 'feconde' ? 100_000 : 5_000, extraction: 0 }))
    const a = mk(POURPRE, { ...FECUND, gender: 'male' })
    const b = mk(ORCHIDEE, { ...FECUND, gender: 'femelle' })
    const fates = recommendFates(ctxOf([a, b], { valuation: val }))
    expect(fates.get(a.id)).toMatchObject({ action: 'vente', value: 100_000 })
    expect(fates.get(b.id)).toMatchObject({ action: 'vente', value: 100_000 })
  })

  it('2quater. sans objectif, deux G10 fécondes : dernier G10 × G10 puis sortir (n° 5)', () => {
    const a = mk(DRAGO_AMANDE_EMERAUDE, { ...FECUND, gender: 'male', level: 40 })
    const b = mk(DRAGO_AMANDE_EMERAUDE, { ...FECUND, gender: 'femelle', level: 40 })
    const fates = recommendFates(ctxOf([a, b], { goalSpeciesId: null }))
    expect(fates.get(a.id)).toMatchObject({ action: 'accoupler', rule: 5, label: 'Dernier G10 × G10 puis sortir', partnerId: b.id })
  })

  it('3. clonage : même couleur (certain), utile + inutile (50 %), jamais deux inutiles', () => {
    const i1 = mk(INDIGO, { fertility: 'sterile' })
    const i2 = mk(INDIGO, { fertility: 'sterile' })
    const i3 = mk(INDIGO, { fertility: 'sterile' })
    const p1 = mk(POURPRE, { fertility: 'sterile' })
    const p2 = mk(POURPRE, { fertility: 'sterile', level: 5 })
    const fates = recommendFates(ctxOf([i1, i2, i3, p1, p2]))
    expect(fates.get(i1.id)).toMatchObject({ action: 'cloner', partnerId: i2.id, confidence: 'high', rule: 3 })
    expect(fates.get(i2.id)).toMatchObject({ action: 'cloner', partnerId: i1.id })
    // Indigo restante (utile) + la Pourpre de plus bas niveau (inutile) : 50 %.
    expect(fates.get(i3.id)).toMatchObject({ action: 'cloner', label: 'Cloner (50 %)', partnerId: p1.id, confidence: 'medium' })
    expect(fates.get(p1.id)).toMatchObject({ action: 'cloner', partnerId: i3.id })
    // La seconde Pourpre (inutile) ne se clone pas avec une autre inutile.
    expect(fates.get(p2.id)?.action).toBe('vente')
    const twoUseless = recommendFates(ctxOf([mk(POURPRE, { fertility: 'sterile' }), mk(ORCHIDEE, { fertility: 'sterile' })]))
    expect([...twoUseless.values()].every((f) => f.action !== 'cloner')).toBe(true)
  })

  it('3bis. deux couleurs utiles différentes se clonent (résultat utile certain) ; stérile utile isolée gardée', () => {
    const i = mk(INDIGO, { fertility: 'sterile' })
    const d = mk(DORE, { fertility: 'sterile' })
    const fates = recommendFates(ctxOf([i, d]))
    expect(fates.get(i.id)).toMatchObject({ action: 'cloner', partnerId: d.id, confidence: 'high' })
    const lone = recommendFates(ctxOf([mk(INDIGO, { fertility: 'sterile' }), mk(DORE_INDIGO, { fertility: 'sterile' })]))
    const loneIndigo = [...lone.values()].find((f) => f.usefulness.kind === 'recette')
    expect(loneIndigo).toMatchObject({ action: 'garder', rule: 3, label: 'Garder — en attente de clonage' })
  })

  it('4. monter en niveau si un palier proche rapporte plus que le carburant (n° 8)', () => {
    const val = fakeVal((_id, level) => ({
      sale: 2_000,
      extraction: 0,
      brisage: level >= 53 ? 12_000 : level >= 45 ? 9_000 : 0,
      conf: 'low',
    }))
    const cheap: LevelCostFn = (from, to) => ({ cost: (to - from) * 20, complete: true, seconds: 3600 })
    const m = mk(POURPRE, { fertility: 'sterile' })
    const f = recommendFates(ctxOf([m], { valuation: val, levelCost: cheap })).get(m.id)
    expect(f).toMatchObject({ action: 'monter', targetLevel: 53, exit: 'brisage', rule: 8, confidence: 'low' })
    expect(f?.value).toBe(12_000 - 52 * 20)
    expect(f?.floor).toBe(2_000)
    // Trop cher : on vend tel quel.
    const pricey: LevelCostFn = () => ({ cost: 50_000, complete: true })
    expect(recommendFates(ctxOf([m], { valuation: val, levelCost: pricey })).get(m.id)?.action).toBe('vente')
    // Sans coût d'XP fourni : règle ignorée.
    expect(recommendFates(ctxOf([m], { valuation: val })).get(m.id)?.action).toBe('vente')
    // Coût inconnu : sortie + conseil de saisir le prix de la Mangeoire.
    const unknown: LevelCostFn = () => ({ cost: null, complete: false })
    const h = recommendFates(ctxOf([m], { valuation: val, levelCost: unknown })).get(m.id)
    expect(h?.action).toBe('vente')
    expect(h?.hint).toContain('Mangeoire')
    // Palier trop loin (niveau 1 → 100 = 172 668 XP) : ignoré.
    const far = fakeVal((_id, level) => ({ sale: level >= 100 ? 90_000 : 2_000, extraction: 0 }))
    expect(recommendFates(ctxOf([m], { valuation: far, levelCost: cheap })).get(m.id)?.action).toBe('vente')
  })

  it('5. sortie : max(vente, extraction, brisage) ; prix manquants → « à chiffrer »', () => {
    const val = fakeVal(() => ({ sale: 1_000, extraction: 9_000, brisage: 4_000 }))
    const m = mk(MULDO_G5_ANY, { fertility: 'sterile' })
    expect(recommendFates(ctxOf([m], { valuation: val })).get(m.id)).toMatchObject({ action: 'extraction', value: 9_000, rule: 4, complete: true })
    const none = fakeVal(() => ({ sale: null, extraction: null }))
    const f = recommendFates(ctxOf([m], { valuation: none })).get(m.id)
    expect(f).toMatchObject({ action: 'a-chiffrer', value: null, complete: false, valueNote: 'coût incomplet' })
    const partial = fakeVal(() => ({ sale: 3_000, extraction: null }))
    expect(recommendFates(ctxOf([m], { valuation: partial })).get(m.id)).toMatchObject({ action: 'vente', complete: false })
  })

  it('sénile (n° 7) et monture spéciale : jamais élevées, valorisées', () => {
    const s = mk(MULDO_G5_ANY, { fertility: 'senile', ...FECUND })
    const sp = mk(DRAGO_PLUMES)
    const fates = recommendFates(ctxOf([s, sp], { goalSpeciesId: null }))
    expect(fates.get(s.id)?.rule).toBe(7)
    expect(['vente', 'extraction', 'brisage']).toContain(fates.get(s.id)?.action)
    expect(fates.get(sp.id)?.rule).toBe(0)
  })

  it('sans objectif : une fertile G1 est gardée (progression, confiance basse)', () => {
    const m = mk(DORE)
    expect(recommendFates(ctxOf([m], { goalSpeciesId: null })).get(m.id)).toMatchObject({ action: 'garder', confidence: 'low' })
  })

  it('recommendFate est cohérent avec recommendFates', () => {
    const a = mk(POURPRE, { ...FECUND, gender: 'male' })
    const b = mk(ORCHIDEE, { ...FECUND, gender: 'femelle' })
    const c = mk(INDIGO, { fertility: 'sterile' })
    const ctx = ctxOf([a, b, c])
    const all = recommendFates(ctx)
    for (const m of [a, b, c]) expect(recommendFate(m, ctx)).toEqual(all.get(m.id))
    // Monture absente de l'inventaire : évaluée quand même.
    expect(recommendFate(mk(DORE_INDIGO), ctxOf([])).action).toBe('garder')
  })

  it("s'appuie sur mountValuation (economy.ts) avec les prix par défaut", () => {
    const ctx: PriceContext = { overrides: {}, useDefaults: true }
    const mctx: MountPriceContext = { mountOverrides: {}, generationOverrides: {}, useDefaults: true }
    const valuation: ValuationFn = (id, level, o) => mountValuation(id, level, { ctx, mountPrices: mctx, saleTax: 0.02, state: o.state, senile: o.senile })
    const m = mk(EBENE_INDIGO, { fertility: 'sterile', level: 10 })
    const f = recommendFates(ctxOf([m], { valuation })).get(m.id)
    const expected = mountValuation(EBENE_INDIGO, 10, { ctx, mountPrices: mctx, saleTax: 0.02, state: 'sterile' })
    expect(f?.action).toBe(expected.bestKind)
    expect(f?.value).toBe(expected.best)
    // Sénile : 1 seule ressource à l'extraction.
    const old = mk(MULDO_G5_ANY, { fertility: 'senile' })
    const ev = mountValuation(MULDO_G5_ANY, 1, { ctx, mountPrices: mctx, saleTax: 0.02, state: 'sterile', senile: true })
    expect(ev.extraction.origin).toContain('1 ×')
    expect(recommendFates(ctxOf([old], { valuation })).get(old.id)?.floor).toBe(ev.best)
  })
})

describe('inventaire : emplacements, captures, clonage, extraction', () => {
  it('enclos débloqués et emplacements', () => {
    expect(unlockedPaddocks(1)).toBe(1)
    expect(unlockedPaddocks(40)).toBe(2)
    expect(unlockedPaddocks(159)).toBe(4)
    expect(unlockedPaddocks(200)).toBe(6)
    expect(locationKey({ kind: 'enclos', paddock: 3 })).toBe('enclos-3')
    expect(parseLocationKey('enclos-3')).toEqual({ kind: 'enclos', paddock: 3 })
    expect(parseLocationKey('etable')).toEqual({ kind: 'etable' })
    expect(parseLocationKey('enclos-9')).toBeNull()
  })

  it('moveBlockers : enclos verrouillé, 10 places, étable pleine', () => {
    const inPaddock = Array.from({ length: 8 }, () => mk(DORE, { location: { kind: 'enclos', paddock: 1 } }))
    const moving = [mk(DORE), mk(DORE), mk(DORE)]
    const all = [...inPaddock, ...moving]
    const ids = moving.map((m) => m.id)
    expect(moveBlockers(all, ids, { kind: 'enclos', paddock: 1 }, { jobLevel: 1, stableSlots: 250 })[0]).toContain('2 places libres pour 3 montures')
    expect(moveBlockers(all, ids.slice(0, 2), { kind: 'enclos', paddock: 1 }, { jobLevel: 1, stableSlots: 250 })).toEqual([])
    expect(moveBlockers(all, ids, { kind: 'enclos', paddock: 2 }, { jobLevel: 1, stableSlots: 250 })[0]).toContain('niveau 40')
    expect(moveBlockers(all, ids, { kind: 'enclos', paddock: 2 }, { jobLevel: 40, stableSlots: 250 })).toEqual([])
    // Déplacer des montures déjà dans l'enclos ne compte pas deux fois.
    expect(moveBlockers(all, inPaddock.map((m) => m.id), { kind: 'enclos', paddock: 1 }, { jobLevel: 1, stableSlots: 250 })).toEqual([])
    expect(moveBlockers(all, inPaddock.map((m) => m.id), { kind: 'etable' }, { jobLevel: 1, stableSlots: 10 })[0]).toContain('limitée à 10')
    expect(moveBlockers(all, [], { kind: 'inventaire' }, { jobLevel: 1, stableSlots: 250 })).toEqual(['Aucune monture sélectionnée.'])
  })

  it('captures groupées : validation et création (G1, niveau 1, sexes)', () => {
    expect(captureBlockers([{ speciesId: DORE, males: 2, females: 1 }])).toEqual([])
    expect(captureBlockers([{ speciesId: DORE_INDIGO, males: 1, females: 0 }])[0]).toContain('G1')
    expect(captureBlockers([{ speciesId: DORE, males: 0, females: 0 }])[0]).toContain('au moins une')
    expect(captureBlockers([{ speciesId: null, males: 1, females: 0 }])[0]).toContain('couleur')
    expect(captureBlockers([])).toEqual(['Ajoutez au moins une capture.'])
    const ms = capturedMounts([{ speciesId: DORE, males: 2, females: 1 }, { speciesId: INDIGO, males: 0, females: 2 }], { serenity: 12_000, location: { kind: 'enclos', paddock: 1 } })
    expect(ms).toHaveLength(5)
    expect(ms.filter((m) => m.gender === 'male')).toHaveLength(2)
    expect(ms.every((m) => m.level === 1 && m.parents.length === 0 && m.fertility === 'fertile')).toBe(true)
    expect(ms[0].serenity).toBe(5_000) // bornée
    expect(ms[0].location).toEqual({ kind: 'enclos', paddock: 1 })
  })

  it('clonePatch : fertile, jauges à 0, capacité perdue ; sérénité gardée en 3.7 seulement', () => {
    const m = mk(INDIGO, { fertility: 'sterile', serenity: -1_500, ability: 'sage', ...FECUND })
    expect(clonePatch(m, R36)).toEqual({ fertility: 'fertile', endurance: 0, maturity: 0, love: 0, serenity: 0, ability: null })
    expect(clonePatch(m, R37).serenity).toBe(-1_500)
  })

  it('extractionQuantity : génération, G1 = 0, sénile = 1, spéciale = 0', () => {
    expect(extractionQuantity(mk(DORE))).toBe(0)
    expect(extractionQuantity(mk(ROUX_DORE))).toBe(4)
    expect(extractionQuantity(mk(ROUX_DORE, { fertility: 'senile' }))).toBe(1)
    expect(extractionQuantity(mk(DRAGO_PLUMES))).toBe(0)
  })

  it('smileys de sérénité et paliers de niveau', () => {
    expect(serenitySmiley(-3_000)).toMatchObject({ color: 'rouge', face: ':C' })
    expect(serenitySmiley(-1)).toMatchObject({ color: 'bleu', face: ':(' })
    expect(serenitySmiley(0)).toMatchObject({ color: 'violet', face: ':)' })
    expect(serenitySmiley(2_001)).toMatchObject({ color: 'vert', face: ':D' })
    expect(levelTargets('muldo').filter((t) => t.kind === 'brisage').map((t) => t.level)).toEqual([45, 53, 100, 200])
    expect(levelTargets('dragodinde').every((t) => t.kind === 'vente')).toBe(true)
  })

  it('inventorySummary : familles, statuts, couples féconds, places', () => {
    const ms = [
      mk(DORE, { ...FECUND, gender: 'male', location: { kind: 'enclos', paddock: 1 } }),
      mk(INDIGO, { ...FECUND, gender: 'femelle' }),
      mk(INDIGO, { ...FECUND, gender: 'femelle' }),
      mk(VOLK_INDIGO, { fertility: 'sterile', location: { kind: 'inventaire' } }),
    ]
    const s = inventorySummary(ms)
    expect(s.total).toBe(4)
    expect(s.byFamily).toEqual({ dragodinde: 0, muldo: 3, volkorne: 1 })
    expect(s.byStatus.feconde).toBe(3)
    expect(s.byStatus.sterile).toBe(1)
    expect(s.fecundPairs).toBe(1)
    expect(s.fecundInPaddock).toBe(1)
    expect(s.paddock.get(1)).toBe(1)
    expect(s.stable).toBe(2)
    expect(s.inventory).toBe(1)
    expect(s.byGeneration.get(1)).toBe(4)
  })
})

// ---------- Corrections de la revue (groupe C1) ----------

const CORAIL = 298 // Muldo G9
const CORAIL_DORE = 315 // Muldo G10 = Doré × Corail
const DRAGO_AMANDE_EBENE = 34 // Dragodinde G4 sans descendance de génération supérieure

describe('porteuses et arbres (F7)', () => {
  it('porteuse de Corail pour l’objectif Corail et Doré : croisement de l’espèce portée, partenaire trouvée', () => {
    const porteur = mk(DORE, { gender: 'male', parents: [CORAIL, DORE], level: 40 })
    const plainF = mk(DORE, { gender: 'femelle', level: 40 })
    const use = mountUsefulness(porteur, goalPlan(CORAIL_DORE))
    expect(use.kind).toBe('porteur')
    expect(use.carried).toBe(CORAIL)
    const f = recommendFates(ctxOf([porteur, plainF], { goalSpeciesId: CORAIL_DORE })).get(porteur.id)
    expect(f?.action).toBe('garder')
    expect(f?.reason).toContain('porteuse de Muldo Corail × Muldo Doré')
    expect(f?.reason).not.toContain('Aucune Muldo Corail femelle')
    expect(f?.reason).toContain('Partenaire')
  })

  it('arbre ≥ cible : un croisement détourné par l’arbre n’est pas proposé comme s’il était propre', () => {
    // Doré dont un parent est Corail (G9), objectif Corail : ses croisements « Doré × X » visent une G10.
    const m = mk(DORE, { gender: 'male', parents: [CORAIL, DORE], level: 40 })
    const f = recommendFates(ctxOf([m], { goalSpeciesId: CORAIL })).get(m.id)
    expect(f?.reason).toContain('Arbre ≥ cible')
    expect(f?.reason).not.toContain('Croisement visé : Muldo Doré ×')
  })
})

describe('impasse sous la G10 (F11)', () => {
  it('Dragodinde Amande et Ébène (G4) : « impasse », pas « G10 »', () => {
    const u = mountUsefulness(mk(DRAGO_AMANDE_EBENE), null)
    expect(u.useful).toBe(false)
    expect(u.detail).not.toContain('G10')
    expect(u.detail).toContain('Impasse')
    expect(mountUsefulness(mk(DRAGO_AMANDE_EMERAUDE), null).detail).toContain('G10')
  })
})

describe('clonage : sexe et généalogie (F9)', () => {
  it('2 ♂ + 2 ♀ stériles utiles de même couleur : ♂+♂ et ♀+♀, résultat certain', () => {
    const ms = [mk(INDIGO, { fertility: 'sterile', gender: 'male' }), mk(INDIGO, { fertility: 'sterile', gender: 'femelle' }), mk(INDIGO, { fertility: 'sterile', gender: 'male' }), mk(INDIGO, { fertility: 'sterile', gender: 'femelle' })]
    const fates = recommendFates(ctxOf(ms))
    for (const m of ms) {
      const f = fates.get(m.id)
      expect(f?.action).toBe('cloner')
      const partner = ms.find((x) => x.id === f?.partnerId)
      expect(partner?.gender).toBe(m.gender)
      expect(f?.reason).toContain('résultat certain')
    }
  })

  it('sexes différents : « couleur certaine ; sexe et généalogie : 50/50 », jamais « résultat certain »', () => {
    const a = mk(INDIGO, { fertility: 'sterile', gender: 'male' })
    const b = mk(INDIGO, { fertility: 'sterile', gender: 'femelle' })
    const f = recommendFates(ctxOf([a, b])).get(a.id)
    expect(f?.action).toBe('cloner')
    expect(f?.reason).toContain('couleur certaine')
    expect(f?.reason).toContain('50/50')
    expect(f?.reason).not.toContain('résultat certain')
  })

  it('pairForCloning : porteuse gardée à part si deux arbres ordinaires peuvent se cloner ensemble', () => {
    const porteur = mk(DORE, { fertility: 'sterile', gender: 'male', parents: [CORAIL, DORE] })
    const m = mk(DORE, { fertility: 'sterile', gender: 'male' })
    const f = mk(DORE, { fertility: 'sterile', gender: 'femelle' })
    const r = pairForCloning([porteur, m, f], (x) => x)
    expect(r.pairs.map(([x, y]) => [x.id, y.id].sort())).toEqual([[m.id, f.id].sort()])
    expect(r.leftovers).toEqual([porteur])
  })
})

describe('plan d’accouplement transmis (F3) : pas de sortie immédiate pour une monture prévue', () => {
  it('féconde sans usage prévue au plan : « accoupler (plan) », sortie après l’accouplement, valorisée stérile', () => {
    const useful = mk(INDIGO, { ...FECUND, gender: 'male' })
    const off = mk(POURPRE, { ...FECUND, gender: 'femelle' })
    const without = recommendFates(ctxOf([useful, off])).get(off.id)
    expect(['vente', 'extraction', 'brisage']).toContain(without?.action)
    const fates = recommendFates(ctxOf([useful, off], { plannedPartners: new Map([[useful.id, off.id], [off.id, useful.id]]) }))
    const f = fates.get(off.id)
    expect(f?.action).toBe('accoupler')
    expect(f?.partnerId).toBe(useful.id)
    expect(f?.reason).toContain("Après l'accouplement")
    expect(f?.value).toBe(5_000) // valeur stérile (flatVal), pas la valeur féconde (6 000)
    expect(f?.exit).toBe('vente')
    expect(fates.get(useful.id)).toMatchObject({ action: 'garder', partnerId: off.id })
    expect(fates.get(useful.id)?.reason).toContain("Prévue au plan d'accouplement")
  })
})

describe('bébé gratuit : prix de décision seulement (ECO-03)', () => {
  it('fécondes valorisées sur un relevé peu fiable : accoupler quand même (M-FREEBABY-01)', () => {
    const val = fakeVal((_id, _l, state) => ({ sale: state === 'feconde' ? 637_000 : 5_000, extraction: 0, conf: state === 'feconde' ? 'low' : 'medium' }))
    const a = mk(POURPRE, { ...FECUND, gender: 'male' })
    const b = mk(ORCHIDEE, { ...FECUND, gender: 'femelle' })
    const fates = recommendFates(ctxOf([a, b], { valuation: val }))
    expect(fates.get(a.id)?.action).toBe('accoupler')
    expect(fates.get(b.id)?.action).toBe('accoupler')
  })

  it('vendre fécondes (prix fiables) : la raison nomme la partenaire au lieu de dire qu’il n’y en a pas', () => {
    const val = fakeVal((_id, _l, state) => ({ sale: state === 'feconde' ? 100_000 : 5_000, extraction: 0 }))
    const a = mk(POURPRE, { ...FECUND, gender: 'male' })
    const b = mk(ORCHIDEE, { ...FECUND, gender: 'femelle' })
    const f = recommendFates(ctxOf([a, b], { valuation: val })).get(a.id)
    expect(f?.action).toBe('vente')
    expect(f?.reason).not.toContain('sans autre féconde condamnée')
    expect(f?.reason).toContain('rapporte plus que l')
  })
})

describe('monter en niveau : lot réel (ECO-10)', () => {
  const val = fakeVal((_id, level) => ({ sale: 2_000, extraction: 0, brisage: level >= 53 ? 12_000 : 0, conf: 'low' }))
  // Coût du lot de Mangeoire (10 400 K pour 1 → 53) partagé entre les montures montées ensemble.
  const perBatch: LevelCostFn = (from, to, _m, batchSize) => ({ cost: ((to - from) * 200) / batchSize, complete: true, seconds: 3600, tier: 1 })

  it('une monture seule ne paie pas le lot : pas de « monter »', () => {
    const m = mk(POURPRE, { fertility: 'sterile' })
    const f = recommendFates(ctxOf([m], { valuation: val, levelCost: perBatch })).get(m.id)
    expect(f?.action).toBe('vente')
  })

  it('10 montures identiques : « monter », coût par monture du lot de 10', () => {
    const ms = Array.from({ length: 10 }, () => mk(POURPRE, { fertility: 'sterile', gender: 'male' }))
    // Pas de clonage entre montures inutiles : elles restent candidates à la montée.
    const fates = recommendFates(ctxOf(ms, { valuation: val, levelCost: perBatch }))
    for (const m of ms) {
      const f = fates.get(m.id)
      expect(f).toMatchObject({ action: 'monter', targetLevel: 53 })
      expect(f?.value).toBe(12_000 - (52 * 200) / 10)
      expect(f?.reason).toContain('si vous montez 10 montures ensemble')
    }
  })

  it('ancienne fonction de coût à 3 paramètres (lot de 10 fixe) : le texte dit « 10 montures ensemble », jamais « seule »', () => {
    const legacy: LevelCostFn = (from, to) => ({ cost: ((to - from) * 200) / 10, complete: true, seconds: 3600 })
    const m = mk(POURPRE, { fertility: 'sterile' })
    const f = recommendFates(ctxOf([m], { valuation: val, levelCost: legacy })).get(m.id)
    expect(f?.action).toBe('monter')
    expect(f?.reason).toContain('si vous montez 10 montures ensemble')
    expect(f?.reason).not.toContain('seule')
  })

  it('valeur actuelle incomplète : gain présenté comme un maximum, fiche incomplète', () => {
    const partial = fakeVal((_id, level) => ({ sale: level >= 53 ? 2_000 : null, extraction: 0, brisage: level >= 53 ? 12_000 : 0, conf: 'low' }))
    const ms = Array.from({ length: 10 }, () => mk(POURPRE, { fertility: 'sterile' }))
    const f = recommendFates(ctxOf(ms, { valuation: partial, levelCost: perBatch })).get(ms[0].id)
    expect(f?.action).toBe('monter')
    expect(f?.complete).toBe(false)
    expect(f?.reason).toContain('au plus')
  })
})

describe('sans monture visée, objectif « profit » : clonage comparé à la vente (ux F11)', () => {
  const val = fakeVal((_id, _l, state) => ({ sale: state === 'fertile' ? 12_250 : 12_250, extraction: undefined }))
  it('deux G1 stériles : pas de clonage si le clone vaut moins que les deux stériles', () => {
    const a = mk(DORE, { fertility: 'sterile' })
    const b = mk(DORE, { fertility: 'sterile' })
    const fates = recommendFates(ctxOf([a, b], { goalSpeciesId: null, goal: 'profit', valuation: val }))
    expect(fates.get(a.id)?.action).not.toBe('cloner')
    expect(fates.get(a.id)?.reason).toMatch(/Clone fertile ≈ 12\s250\sK contre ≈ 24\s500\sK/)
    // Hors objectif « profit » (ou non précisé) : la grille de la recherche (cloner) s'applique.
    expect(recommendFates(ctxOf([a, b], { goalSpeciesId: null, valuation: val })).get(a.id)?.action).toBe('cloner')
  })

  it('le clonage reste conseillé quand il rapporte plus, ou dès la G3', () => {
    const rich = fakeVal((_id, _l, state) => ({ sale: state === 'fertile' ? 50_000 : 5_000, extraction: undefined }))
    const a = mk(DORE, { fertility: 'sterile' })
    const b = mk(DORE, { fertility: 'sterile' })
    expect(recommendFates(ctxOf([a, b], { goalSpeciesId: null, goal: 'profit', valuation: rich })).get(a.id)?.action).toBe('cloner')
    const g3a = mk(ROUX, { fertility: 'sterile' })
    const g3b = mk(ROUX, { fertility: 'sterile' })
    expect(recommendFates(ctxOf([g3a, g3b], { goalSpeciesId: null, goal: 'profit', valuation: val })).get(g3a.id)?.action).toBe('cloner')
  })
})

describe('captures : sérénité monture par monture (ux F7)', () => {
  it('3 montures capturées avec 3 smileys différents → 3 sérénités différentes ; inconnue → valeur commune', () => {
    const lines = [{ speciesId: DORE, males: 2, females: 1 }]
    const slots = captureSlots(lines)
    expect(slots.map((s) => `${s.gender}${s.index}`)).toEqual(['male0', 'male1', 'femelle0'])
    const ms = capturedMounts(lines, { serenity: 100, serenities: [-3_500, 3_500, 1_000] })
    expect(ms.map((m) => m.serenity)).toEqual([-3_500, 3_500, 1_000])
    expect(ms.map((m) => m.gender)).toEqual(['male', 'male', 'femelle'])
    const partial = capturedMounts(lines, { serenity: 100, serenities: [null, 9_999] })
    expect(partial.map((m) => m.serenity)).toEqual([100, 5_000, 100])
  })
})

describe('valeur plancher incomplète (intégration)', () => {
  // G1 niveau 1 : brisage nul (relevé), vente sans prix → plancher 0 qui n'est qu'un minimum.
  const g1Val = fakeVal(() => ({ sale: null, extraction: undefined, brisage: 0 }))

  it('« garder » : floor 0 mais floorComplete faux quand la vente n’a pas de prix', () => {
    const indigo = mk(INDIGO)
    const f = recommendFates(ctxOf([indigo], { valuation: g1Val })).get(indigo.id)
    expect(f?.action).toBe('garder')
    expect(f?.floor).toBe(0)
    expect(f?.floorComplete).toBe(false)
  })

  it('plancher complet quand toutes les sorties possibles sont chiffrées', () => {
    const indigo = mk(INDIGO)
    const f = recommendFates(ctxOf([indigo])).get(indigo.id)
    expect(f?.floor).toBe(5_000)
    expect(f?.floorComplete).toBe(true)
  })

  it('clonage : le nom du partenaire n’est pas répété quand il n’a pas de nom propre', () => {
    const a = mk(INDIGO, { fertility: 'sterile' })
    const b = mk(DORE, { fertility: 'sterile', gender: 'femelle' })
    const fates = recommendFates(ctxOf([a, b]))
    const f = fates.get(a.id)
    expect(f?.action).toBe('cloner')
    expect(f?.reason).not.toContain('Muldo Doré (Muldo Doré)')
    expect(f?.floorComplete).toBe(true)
  })
})
