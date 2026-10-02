import { describe, expect, it } from 'vitest'
import { FUELS } from '../data'
import { PADDOCK_SLOTS } from './constants'
import { planFertility, type FertilityStep } from './fertility'
import { findFuel } from './fuel'
import { simulatePaddock } from './paddock'
import { almanaxScheduleFrom } from './fertility'
import { serverDayStart } from './almanax'
import {
  BATCH_SERENITY_WINDOW,
  acknowledgeStep,
  compareTiers,
  allocationAdvice,
  assignPaddocks,
  gaugeSwitch,
  needsFertility,
  nextSwitchOf,
  paddockRole,
  planPaddock,
  planProgress,
  refillAdvice,
  simulateCurrent,
  simulationTimeline,
  stepTimes,
  toFillerSim,
  toSimMount,
  xpSeconds,
  type AssignResult,
  type PlanSchedule,
} from './paddockAssign'
import { pointsValue } from './paddockPlanStatus'
import type { PriceContext } from './pricing'
import type { SimMount } from './paddock'
import { RULESETS } from './rules'
import type { GaugeId, Mount } from './types'

const R36 = RULESETS['3.6']
const R37 = RULESETS['3.7']
const MULDO_DORE = 94
const ARMURE = 88 // Dragodinde en armure : non élevable
const VOLK_PLAIN = 176 // Volkorne Indigo (G1)

let seq = 0
const mk = (over: Partial<Mount> = {}): Mount => ({
  id: `m${++seq}`,
  speciesId: MULDO_DORE,
  gender: seq % 2 ? 'male' : 'femelle',
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
})

const zeroGauges = (): Record<GaugeId, number> => ({ baffeur: 0, caresseur: 0, foudroyeur: 0, abreuvoir: 0, dragofesse: 0, mangeoire: 0 })

/** Contexte de prix complet : chaque carburant coûte sa durabilité (1 K par point). */
const fullCtx: PriceContext = { overrides: Object.fromEntries(FUELS.map((f) => [String(f.id), f.durability])), useDefaults: false }
const emptyCtx: PriceContext = { overrides: {}, useDefaults: false }

/** Vérifie les invariants d'une répartition : ≤ 10 par enclos, aucune monture en double, fenêtre ≤ 2 000. */
function checkInvariants(res: AssignResult, mounts: Mount[]) {
  const seen = new Set<string>()
  for (const a of res.paddocks) {
    expect(a.mountIds.length).toBeLessThanOrEqual(PADDOCK_SLOTS)
    for (const id of a.mountIds) {
      expect(seen.has(id)).toBe(false)
      seen.add(id)
    }
    const core = mounts.filter((m) => a.mountIds.includes(m.id) && !a.fillerIds.includes(m.id))
    if (core.length > 1) {
      const s = core.map((m) => m.serenity)
      expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(BATCH_SERENITY_WINDOW)
    }
  }
  for (const w of res.waiting) expect(seen.has(w.mountId)).toBe(false)
}

describe('montures à rendre fécondes', () => {
  it('exclut fécondes, stériles, séniles et montures spéciales', () => {
    expect(needsFertility(mk())).toBe(true)
    expect(needsFertility(mk({ endurance: 20_000, maturity: 20_000, love: 20_000 }))).toBe(false)
    expect(needsFertility(mk({ fertility: 'sterile' }))).toBe(false)
    expect(needsFertility(mk({ fertility: 'senile' }))).toBe(false)
    expect(needsFertility(mk({ speciesId: ARMURE }))).toBe(false)
  })

  it('voit les stériles « pleines » pour ne pas fausser le plan', () => {
    const s = toSimMount(mk({ fertility: 'sterile', level: 200 }))
    expect([s.endurance, s.maturity, s.love]).toEqual([20_000, 20_000, 20_000])
    expect(s.canGainXp).toBe(false)
  })
})

describe('rôles et conseils de répartition', () => {
  it('associe les jauges de la phase au rôle de l’enclos', () => {
    expect(paddockRole(['foudroyeur', 'abreuvoir'])).toBe('bleu')
    expect(paddockRole(['abreuvoir', 'dragofesse'])).toBe('violet')
    expect(paddockRole(['caresseur', 'foudroyeur'])).toBe('rouge')
    expect(paddockRole(['baffeur', 'dragofesse'])).toBe('vert')
    expect(paddockRole(['caresseur', 'mangeoire'])).toBe('station-caresseur')
    expect(paddockRole(['baffeur'])).toBe('station-baffeur')
    expect(paddockRole(['dragofesse', 'mangeoire'])).toBe('finition')
    expect(paddockRole(['mangeoire'])).toBe('xp')
    expect(paddockRole([])).toBe('vide')
  })

  it('reprend la répartition par nombre d’enclos de la recherche', () => {
    expect(allocationAdvice(3)).toMatch(/station/)
    expect(allocationAdvice(2)).toMatch(/bleu/)
    expect(allocationAdvice(99)).toBe(allocationAdvice(6))
  })
})

describe('assignPaddocks', () => {
  const base = { rules: R36, tier: 2 as const, withXp: true }

  it('pose un lot bleu complet dans le premier enclos', () => {
    const mounts = Array.from({ length: 10 }, (_, i) => mk({ serenity: -1_800 + i * 150 }))
    const res = assignPaddocks(mounts, { ...base, paddocksAvailable: 1 })
    checkInvariants(res, mounts)
    expect(res.paddocks).toHaveLength(1)
    const a = res.paddocks[0]
    expect(a.role).toBe('bleu')
    expect([...a.firstGauges].sort()).toEqual(['abreuvoir', 'foudroyeur'])
    expect(a.eligible.foudroyeur).toBe(10)
    expect(a.eligible.abreuvoir).toBe(10)
    expect(a.mountIds).toHaveLength(10)
    expect(a.plan?.warnings).toEqual([])
    expect(Object.keys(a.plan!.fecundAt)).toHaveLength(10)
    expect(res.moves).toHaveLength(10)
    expect(res.moves.every((mv) => mv.to.kind === 'enclos' && mv.to.paddock === 1)).toBe(true)
    expect(res.waiting).toHaveLength(0)
  })

  it('respecte 10 places et la fenêtre de 2 000, le reste attend en lots suivants', () => {
    const mounts = Array.from({ length: 27 }, (_, i) => mk({ serenity: -5_000 + i * 370 }))
    const res = assignPaddocks(mounts, { ...base, paddocksAvailable: 2 })
    checkInvariants(res, mounts)
    expect(res.paddocks).toHaveLength(2)
    const placed = res.paddocks.reduce((s, a) => s + a.mountIds.length, 0)
    expect(placed + res.waiting.length).toBe(27)
    expect(res.waiting.length).toBeGreaterThan(0)
    expect(res.waitingBatches[0].index).toBe(1)
    for (const b of res.waitingBatches) {
      expect(b.mountIds.length).toBeLessThanOrEqual(PADDOCK_SLOTS)
      expect(b.serenityRange[1] - b.serenityRange[0]).toBeLessThanOrEqual(BATCH_SERENITY_WINDOW)
    }
    expect(res.suggestions.some((s) => s.includes('attendent'))).toBe(true)
  })

  it('ne met jamais ensemble des sérénités opposées', () => {
    const mounts = [...Array.from({ length: 5 }, () => mk({ serenity: -4_500 })), ...Array.from({ length: 5 }, () => mk({ serenity: 4_500 }))]
    const res = assignPaddocks(mounts, { ...base, paddocksAvailable: 2 })
    checkInvariants(res, mounts)
    expect(res.paddocks.map((a) => a.role).sort()).toEqual(['rouge', 'vert'])
  })

  it('fusionne les petits lots du même côté de 0 qui partagent une jauge (rouge + bleu via le Foudroyeur)', () => {
    const mounts = [...[-2_600, -2_500, -2_400].map((s) => mk({ serenity: s })), ...[-1_500, -1_200, -1_000].map((s) => mk({ serenity: s }))]
    const res = assignPaddocks(mounts, { ...base, paddocksAvailable: 2 })
    checkInvariants(res, mounts)
    const used = res.paddocks.filter((a) => a.mountIds.length > 0)
    expect(used).toHaveLength(1)
    expect(used[0].mountIds).toHaveLength(6)
    expect(used[0].warnings.some((w) => w.includes('/10'))).toBe(true)
    expect(res.paddocks.find((a) => a.mountIds.length === 0)?.role).toBe('vide')
  })

  it('ne fusionne à travers 0 (bleu + violet via l’Abreuvoir) que s’il manque des enclos', () => {
    const mounts = [...[-500, -400, -300, -200].map((s) => mk({ serenity: s })), ...[100, 200, 300, 400].map((s) => mk({ serenity: s }))]
    const two = assignPaddocks(mounts, { ...base, paddocksAvailable: 2 })
    checkInvariants(two, mounts)
    expect(two.paddocks.map((a) => a.role).sort()).toEqual(['bleu', 'violet'])
    const one = assignPaddocks(mounts, { ...base, paddocksAvailable: 1 })
    checkInvariants(one, mounts)
    expect(one.paddocks[0].mountIds).toHaveLength(8)
    expect(one.paddocks[0].firstGauges).toContain('abreuvoir')
    expect(one.waiting).toHaveLength(0)
    // Le plan du lot qui chevauche 0 va jusqu'au bout.
    expect(Object.keys(one.paddocks[0].plan!.fecundAt)).toHaveLength(8)
    expect(one.paddocks[0].plan!.warnings).toEqual([])
  })

  it('laisse en place les montures déjà en enclos et les complète depuis l’étable', () => {
    const inside = [-1_500, -1_400, -1_300].map((s) => mk({ serenity: s, location: { kind: 'enclos', paddock: 2 } }))
    const stable = [-1_200, -1_000, -900, -800, -700, -600, -500, 3_000].map((s) => mk({ serenity: s }))
    const mounts = [...inside, ...stable]
    const res = assignPaddocks(mounts, { ...base, paddocksAvailable: 2 })
    checkInvariants(res, mounts)
    const p2 = res.paddocks.find((a) => a.paddockId === 2)!
    expect(p2.keptIds.sort()).toEqual(inside.map((m) => m.id).sort())
    expect(p2.mountIds).toHaveLength(10)
    expect(res.moves.some((mv) => inside.some((m) => m.id === mv.mountId))).toBe(false)
    // La monture à 3 000 (hors fenêtre) va dans l'autre enclos.
    const p1 = res.paddocks.find((a) => a.paddockId === 1)!
    expect(p1.mountIds).toEqual([stable[7].id])
  })

  it('sort fécondes, stériles et montures d’enclos verrouillés vers l’étable', () => {
    const fec = mk({ level: 60, endurance: 20_000, maturity: 20_000, love: 20_000, location: { kind: 'enclos', paddock: 1 } })
    const ster = mk({ fertility: 'sterile', level: 80, location: { kind: 'enclos', paddock: 1 } })
    const locked = mk({ fertility: 'sterile', level: 80, location: { kind: 'enclos', paddock: 4 } })
    const res = assignPaddocks([fec, ster, locked], { ...base, paddocksAvailable: 2 })
    const byId = new Map(res.moves.map((mv) => [mv.mountId, mv]))
    expect(byId.get(fec.id)?.to).toEqual({ kind: 'etable' })
    expect(byId.get(fec.id)?.reason).toMatch(/étable/)
    expect(byId.get(ster.id)?.reason).toMatch(/Stérile/)
    expect(byId.get(locked.id)?.reason).toMatch(/niveau 120/)
    expect(res.suggestions.some((s) => s.includes('Aucune monture à rendre féconde'))).toBe(true)
  })

  it('complète les places libres avec des montures à monter (Mangeoire)', () => {
    const lot = [100, 300, 500, 700, 900, 1_100].map((s) => mk({ serenity: s }))
    // Fécondes sans partenaire (toutes mâles) : elles attendent, autant qu'elles montent en niveau.
    const parents = Array.from({ length: 6 }, (_, i) => mk({ level: 1 + i, gender: 'male', endurance: 20_000, maturity: 20_000, love: 20_000 }))
    const mounts = [...lot, ...parents]
    const res = assignPaddocks(mounts, { ...base, paddocksAvailable: 1, levelTarget: 40 })
    checkInvariants(res, mounts)
    const a = res.paddocks[0]
    expect(a.role).toBe('violet')
    expect(a.plan!.steps.some((s) => s.gauges.includes('mangeoire'))).toBe(true)
    expect(a.fillerIds).toHaveLength(4)
    // Les plus bas niveaux d'abord.
    expect(a.fillerIds).toEqual(parents.slice(0, 4).map((m) => m.id))
    expect(a.mountIds).toHaveLength(10)
    // Les compléments gagnent de l'XP pendant le plan.
    const xp = a.plan!.mounts.find((m) => m.id === parents[0].id)?.xpGained ?? 0
    expect(xp).toBeGreaterThan(0)
  })

  it('une féconde qui a un partenaire s’accouple d’abord : pas de complément XP (intégration)', () => {
    const lot = [100, 300, 500].map((s) => mk({ serenity: s }))
    const male = mk({ level: 32, gender: 'male', endurance: 20_000, maturity: 20_000, love: 20_000 })
    const female = mk({ level: 50, gender: 'femelle', endurance: 20_000, maturity: 20_000, love: 20_000 })
    const lonely = mk({ level: 10, gender: 'male', speciesId: VOLK_PLAIN, endurance: 20_000, maturity: 20_000, love: 20_000 })
    const res = assignPaddocks([...lot, male, female, lonely], { ...base, paddocksAvailable: 1, levelTarget: 40 })
    const fillers = res.paddocks.flatMap((p) => p.fillerIds)
    // Le mâle niv. 32 a une partenaire féconde (même famille) : le plan d'accouplement le prend tout de suite.
    expect(fillers).not.toContain(male.id)
    // La Volkorne seule de sa famille attend : elle peut monter en niveau.
    expect(fillers).toContain(lonely.id)
  })

  it('sans Mangeoire en complément, ne pose pas de compléments XP', () => {
    const lot = [100, 300, 500].map((s) => mk({ serenity: s }))
    const parents = [mk({ level: 1, endurance: 20_000, maturity: 20_000, love: 20_000 })]
    const res = assignPaddocks([...lot, ...parents], { ...base, withXp: false, paddocksAvailable: 1 })
    expect(res.paddocks[0].fillerIds).toEqual([])
  })

  it('transforme un enclos sans lot en enclos Mangeoire', () => {
    const lot = Array.from({ length: 10 }, (_, i) => mk({ serenity: -1_500 + i * 100 }))
    const sellers = [mk({ fertility: 'sterile', level: 30 }), mk({ fertility: 'sterile', level: 50 })]
    const res = assignPaddocks([...lot, ...sellers], { ...base, paddocksAvailable: 2, xpTargets: { [sellers[0].id]: 100, [sellers[1].id]: 100 } })
    const xp = res.paddocks.find((a) => a.role === 'xp')!
    expect(xp.fillerIds.sort()).toEqual(sellers.map((m) => m.id).sort())
    expect(xp.firstGauges).toEqual(['mangeoire'])
    expect(xp.totalSeconds).toBe(xpSeconds(30, 100, { tier: 2, rules: R36 }))
  })

  it('préfère placer un lot dans l’enclos où ses montures sont déjà', () => {
    const mounts = Array.from({ length: 4 }, (_, i) => mk({ serenity: 500 + i * 10, location: { kind: 'enclos', paddock: 3 } }))
    const res = assignPaddocks(mounts, { ...base, paddocksAvailable: 3, keepCurrent: false })
    expect(res.paddocks.find((a) => a.paddockId === 3)!.mountIds).toHaveLength(4)
    expect(res.moves).toHaveLength(0)
  })
})

describe('planPaddock', () => {
  const sim = (id: string, over: Partial<SimMount> = {}): SimMount => ({ id, ability: null, serenity: 0, endurance: 0, maturity: 0, love: 0, canGainXp: true, ...over })
  const opts = { tier: 2 as const, withXp: true, rules: R36 }

  it('traverse 0 d’un seul tenant au lieu d’alterner toutes les minutes', () => {
    const lot = Array.from({ length: 7 }, (_, i) => sim(`b${i}`, { serenity: -1_800 + i * 200 }))
    const base = planFertility(lot, opts)
    const plan = planPaddock(lot, opts)
    expect(Object.keys(plan.fecundAt)).toHaveLength(7)
    expect(plan.steps.map((s) => [...s.gauges].sort().join('+'))).toEqual(['abreuvoir+foudroyeur', 'caresseur+dragofesse', 'dragofesse+mangeoire'])
    expect(plan.steps.every((s) => s.durationSeconds >= 300)).toBe(true)
    expect(plan.steps.length).toBeLessThan(base.steps.length)
    expect(plan.totalSeconds).toBeLessThanOrEqual(base.totalSeconds)
    // Étapes contiguës, consommation cohérente.
    for (let i = 1; i < plan.steps.length; i++) expect(plan.steps[i].startSeconds).toBe(plan.steps[i - 1].startSeconds + plan.steps[i - 1].durationSeconds)
    expect(plan.totalSeconds).toBe(plan.steps.reduce((s, x) => s + x.durationSeconds, 0))
    const sum = plan.steps.reduce((s, x) => s + (x.consumed.dragofesse ?? 0), 0)
    expect(plan.consumed.dragofesse).toBe(sum)
  })

  it('termine un lot qui chevauche 0 (le plan de base tourne en boucle)', () => {
    const lot = Array.from({ length: 10 }, (_, i) => sim(`x${i}`, { serenity: -900 + i * 200 }))
    expect(Object.keys(planFertility(lot, opts).fecundAt).length).toBeLessThan(10)
    const plan = planPaddock(lot, opts)
    expect(Object.keys(plan.fecundAt)).toHaveLength(10)
    expect(plan.warnings).toEqual([])
    expect(plan.mounts.every((m) => m.endurance === 20_000 && m.maturity === 20_000 && m.love === 20_000)).toBe(true)
  })

  it('finit sur place la statistique d’un côté avant de traverser (lot hétérogène)', () => {
    const lot: SimMount[] = [
      sim('a', { serenity: 2_957, love: 5_730, ability: 'precoce' }),
      sim('b', { serenity: 3_341, endurance: 4_794, love: 5_444 }),
      sim('c', { serenity: 3_180 }),
      sim('d', { serenity: 2_022, endurance: 19_664, love: 10_468 }),
      sim('e', { serenity: 3_076, maturity: 2_290 }),
      sim('f', { serenity: 1_836, endurance: 8_106 }),
      sim('g', { serenity: 1_974 }),
      sim('h', { serenity: 1_980, maturity: 6_878 }),
      sim('i', { serenity: 2_588 }),
    ]
    const plan = planPaddock(lot, opts)
    expect(Object.keys(plan.fecundAt)).toHaveLength(lot.length)
    expect(plan.steps.length).toBeLessThan(25)
  })

  it('ne change rien quand le plan de base est déjà propre (fenêtres de changement conservées)', () => {
    const lot = Array.from({ length: 6 }, (_, i) => sim(`r${i}`, { serenity: -5_000 + i * 330 }))
    const a = planPaddock(lot, opts)
    const b = planFertility(lot, opts)
    expect(a.steps).toEqual(b.steps)
    expect([a.totalSeconds, a.fecundAt, a.consumed, a.tiers, a.converges]).toEqual([b.totalSeconds, b.fecundAt, b.consumed, b.tiers, b.converges])
    expect(a.steps.some((s) => s.switchWindow)).toBe(true)
  })
})

describe('xpSeconds', () => {
  it('compte les ticks de Mangeoire jusqu’au niveau visé (Sage ×2)', () => {
    expect(xpSeconds(1, 40, { tier: 2, rules: R36 })).toBe(Math.ceil(20_437 / 20) * 10)
    expect(xpSeconds(1, 40, { tier: 2, rules: R36, ability: 'sage' })).toBe(Math.ceil(20_437 / 40) * 10)
    expect(xpSeconds(40, 40, { tier: 2, rules: R36 })).toBe(0)
  })
})

describe('refillAdvice', () => {
  it('remplit juste ce que le plan consomme au palier 1', () => {
    const adv = refillAdvice({ gauges: zeroGauges() }, { consumed: { abreuvoir: 20_000 } }, { ctx: fullCtx, rules: R36, jobLevel: 200, tier: 1 })
    expect(adv.lines).toHaveLength(1)
    const l = adv.lines[0]
    expect(l.gauge).toBe('abreuvoir')
    expect(l.refillCount).toBe(0)
    expect(l.added).toBeGreaterThanOrEqual(20_000)
    expect(l.items.reduce((s, it) => s + it.count * it.durability, 0)).toBe(l.added)
    expect(l.complete).toBe(true)
    expect(adv.cost).toBe(l.added) // 1 K par point
  })

  it('pose le socle du palier 2 puis prévoit les recharges', () => {
    const adv = refillAdvice({ gauges: zeroGauges() }, { consumed: { dragofesse: 60_000 } }, { ctx: fullCtx, rules: R36, jobLevel: 200, tier: 2 })
    const l = adv.lines[0]
    expect(l.base?.reached).toBe(40_000)
    expect(l.initial?.reached).toBe(70_000)
    // Socle (reste dans la jauge) séparé de ce que le plan consomme : 1 K par point.
    expect(adv.baseCost).toBe(40_000)
    expect(adv.runCost).toBe(60_000)
    expect(adv.cost).toBe(100_000)
    expect(l.refillCount).toBe(1)
    expect([l.refillFrom, l.refillTo]).toEqual([40_000, 70_000])
    expect(l.added).toBe(100_000)
    expect(l.leftover).toBe(40_000)
    expect(l.notes.some((n) => n.includes('40'))).toBe(true)
  })

  it('reste en fin de plan découpé par palier : le socle vaut le prix au point du palier inférieur (intégration)', () => {
    // Palier 1 : 1 K/pt, palier 2 : 2 K/pt, palier 3 : 3 K/pt…
    const tiered: PriceContext = { overrides: Object.fromEntries(FUELS.map((f) => [String(f.id), f.durability * f.tier])), useDefaults: false }
    const adv = refillAdvice({ gauges: zeroGauges() }, { consumed: { abreuvoir: 20_000 } }, { ctx: tiered, rules: R36, jobLevel: 200, tier: 2 })
    const l = adv.lines[0]
    expect(l.leftover).toBe(40_000 + (l.added - 60_000))
    expect(l.leftoverByTier.reduce((s, x) => s + x.points, 0)).toBe(l.leftover)
    const t1 = l.leftoverByTier.find((x) => x.tier === 1)
    expect(t1?.points).toBe(40_000)
    expect(t1?.pointCost.value).toBe(1)
    const value = pointsValue(l.leftoverByTier.map((x) => ({ points: x.points, pointCost: x.pointCost })))
    // Jamais plus que ce qui a été acheté (avant : 40 000 points de socle comptés à 2 K = 80 000 K).
    expect(value.complete).toBe(true)
    expect(value.value).toBeLessThanOrEqual(adv.cost as number)
    expect(value.value).toBe(40_000 + 2 * (l.leftover - 40_000))
  })

  it('n’achète rien si la jauge suffit déjà', () => {
    const g = { ...zeroGauges(), foudroyeur: 65_000 }
    const adv = refillAdvice({ gauges: g }, { consumed: { foudroyeur: 20_000 } }, { ctx: fullCtx, rules: R36, jobLevel: 1, tier: 2 })
    expect(adv.lines[0].initial).toBeNull()
    expect(adv.lines[0].items).toEqual([])
    expect(adv.cost).toBe(0)
  })

  it('signale un coût incomplet au lieu de compter 0', () => {
    const adv = refillAdvice({ gauges: zeroGauges() }, { consumed: { caresseur: 3_000 } }, { ctx: emptyCtx, rules: R36, jobLevel: 1, tier: 1 })
    expect(adv.complete).toBe(false)
    expect(adv.cost).toBeNull()
    expect(adv.missing.length).toBeGreaterThan(0)
    expect(adv.lines[0].notes.some((n) => n.includes('alarme'))).toBe(true)
  })

  it('suit les paliers du jeu de règles (3.7 : 80 000 / 140 000)', () => {
    const adv = refillAdvice({ gauges: zeroGauges() }, { consumed: { abreuvoir: 100_000 } }, { ctx: fullCtx, rules: R37, jobLevel: 200, tier: 2 })
    expect([adv.lines[0].refillFrom, adv.lines[0].refillTo]).toEqual([80_000, 140_000])
  })
})

describe('simulation et chronologie', () => {
  it('signale la statistique au maximum puis l’arrêt de l’enclos', () => {
    const m = mk({ id: 'x1', serenity: 0, maturity: 19_000 })
    const res = simulateCurrent({ gauges: { ...zeroGauges(), abreuvoir: 5_000 }, active: ['abreuvoir'] }, [m], { rules: R36 })
    expect(res.seconds).toBe(1_000)
    const tl = simulationTimeline(res, () => 'Doré', R36)
    expect(tl.map((e) => e.kind)).toEqual(['stat-max', 'idle'])
    expect(tl[0].text).toContain('Maturité au maximum')
    expect(tl[0].text).toContain('Doré')
    expect(tl[0].t).toBe(1_000)
  })

  it('signale la jauge vide et regroupe les montures d’un même instant', () => {
    const ms = [mk({ id: 'a' }), mk({ id: 'b' })]
    const res = simulateCurrent({ gauges: { ...zeroGauges(), abreuvoir: 500 }, active: ['abreuvoir'] }, ms, { rules: R36 })
    const tl = simulationTimeline(res, (id) => id.toUpperCase(), R36)
    const empty = tl.find((e) => e.kind === 'gauge-empty')
    expect(empty?.gauge).toBe('abreuvoir')
    expect(empty?.t).toBe(500)
    const fec = simulateCurrent(
      { gauges: { ...zeroGauges(), dragofesse: 5_000 }, active: ['dragofesse'] },
      ms.map((m) => ({ ...m, endurance: 20_000, maturity: 20_000, love: 19_990 })),
      { rules: R36 },
    )
    const entry = simulationTimeline(fec, (id) => id.toUpperCase(), R36).find((e) => e.kind === 'fecund')
    expect(entry?.text).toBe('Fécondes : A, B.')
  })
})

describe('changements de jauges et plan démarré', () => {
  it('décrit le changement à faire en jeu', () => {
    const s = gaugeSwitch(['caresseur', 'mangeoire'], ['dragofesse', 'mangeoire'])
    expect(s.off).toEqual(['caresseur'])
    expect(s.on).toEqual(['dragofesse'])
    expect(s.keep).toEqual(['mangeoire'])
    expect(s.text).toBe('désactiver Caresseur, activer Dragofesse, garder Mangeoire')
    expect(gaugeSwitch(['abreuvoir'], ['abreuvoir']).text).toBe('aucun changement')
  })

  const steps: FertilityStep[] = [
    { gauges: ['foudroyeur', 'abreuvoir'], startSeconds: 0, durationSeconds: 3_600, purpose: 'E + M', consumed: {} },
    {
      gauges: ['caresseur', 'mangeoire'],
      startSeconds: 3_600,
      durationSeconds: 1_800,
      purpose: 'Sérénité',
      switchWindow: { earliestSeconds: 5_000, latestSeconds: 5_600 },
      consumed: {},
    },
    { gauges: ['dragofesse', 'mangeoire'], startSeconds: 5_400, durationSeconds: 3_600, purpose: 'Amour', consumed: {} },
  ]
  const T0 = 1_000_000
  const plan: PlanSchedule = { startedAt: T0, steps, totalSeconds: 9_000, acknowledgedStepIndex: 0 }

  it('donne les heures absolues et le prochain changement', () => {
    expect(stepTimes(plan)[1]).toEqual({ startAt: T0 + 3_600_000, endAt: T0 + 5_400_000 })
    const next = nextSwitchOf(plan)!
    expect(next.index).toBe(1)
    expect(next.at).toBe(T0 + 3_600_000)
    expect(next.text).toBe('désactiver Foudroyeur et Abreuvoir, activer Caresseur et Mangeoire')
    expect(next.earliest).toBeNull()
    const p = planProgress(plan, T0 + 3_700_000)
    expect(p.due).toBe(true)
    expect(p.scheduledIndex).toBe(1)
    expect(p.index).toBe(0)
    expect(planProgress(plan, T0 + 60_000).due).toBe(false)
  })

  it('décale la suite du plan quand le changement est fait en retard', () => {
    const late = acknowledgeStep(plan, T0 + 3_600_000 + 600_000)
    expect(late).toEqual({ acknowledgedStepIndex: 1, offsetMs: 600_000 })
    const p1: PlanSchedule = { ...plan, ...late }
    const next = nextSwitchOf(p1)!
    expect(next.at).toBe(T0 + 600_000 + 5_400_000)
    expect(next.earliest).toBe(T0 + 600_000 + 5_000_000)
    expect(next.latest).toBe(T0 + 600_000 + 5_600_000)
    expect(planProgress(p1, T0 + 600_000 + 5_700_000).late).toBe(true)
    // Validation « à l'heure » : pas de décalage.
    expect(acknowledgeStep(plan)).toEqual({ acknowledgedStepIndex: 1, offsetMs: 0 })
  })

  it('annonce la fin du plan puis s’arrête', () => {
    const last: PlanSchedule = { ...plan, acknowledgedStepIndex: 2 }
    const next = nextSwitchOf(last)!
    expect(next.final).toBe(true)
    expect(next.at).toBe(T0 + 9_000_000)
    expect(next.text).toContain('plan terminé')
    const done: PlanSchedule = { ...plan, acknowledgedStepIndex: 3 }
    expect(nextSwitchOf(done)).toBeNull()
    const p = planProgress(done, T0)
    expect(p.finished).toBe(true)
    expect(p.fraction).toBe(1)
  })
})

// ---------- Correctifs de la revue (moteur d'enclos) ----------

const defaults: PriceContext = { overrides: {}, useDefaults: true }
const simOf = (id: string, over: Partial<SimMount> = {}): SimMount => ({ id, ability: null, serenity: 0, endurance: 0, maturity: 0, love: 0, canGainXp: true, ...over })
const lotOf = (sers: number[], over: Partial<SimMount> = {}) => sers.map((s, i) => simOf(`l${i}`, { serenity: s, ...over }))
const keyOf = (s: FertilityStep) => [...s.gauges].sort().join('+')
/** Rejoue un plan étape par étape (paliers du plan) : état des montures au début de chaque étape et à la fin. */
function replay(lot: SimMount[], plan: ReturnType<typeof planPaddock>, almanax: ((t: number) => GaugeId | null) | null = null) {
  let cur = lot.map((m) => ({ ...m }))
  const states: SimMount[][] = []
  for (const st of plan.steps) {
    states.push(cur)
    const maintainTier = Object.fromEntries(st.gauges.map((g) => [g, plan.tiers[g]]))
    const alm = almanax ? (t: number) => almanax(st.startSeconds + t) : null
    cur = simulatePaddock({ gauges: zeroGauges(), active: st.gauges, mounts: cur, maintainTier, almanaxDoubled: alm, rules: R36, maxSeconds: st.durationSeconds, stopWhenIdle: false }).mounts
  }
  return { states, end: cur }
}
const fecund = (m: SimMount) => m.endurance >= 20_000 && m.maturity >= 20_000 && m.love >= 20_000
let rseed = 4242
const rnd = () => {
  rseed = (rseed * 16807) % 2147483647
  return rseed / 2147483647
}

describe('F1 — conseils de carburant : bonne famille, coût incomplet signalé', () => {
  it('Dragofesse + Mangeoire au palier 2 (prix par défaut) : incomplet, aucun Élixir, borne haute séparée', () => {
    const adv = refillAdvice({ gauges: zeroGauges() }, { consumed: { dragofesse: 20_000, mangeoire: 20_000 } }, { ctx: defaults, rules: R36, jobLevel: 40, tier: 2 })
    expect(adv.complete).toBe(false)
    const drago = adv.lines.find((l) => l.gauge === 'dragofesse')!
    expect(drago.complete).toBe(false)
    expect(drago.items.every((it) => !it.name.includes('Élixir'))).toBe(true)
    expect(drago.items.some((it) => !it.complete)).toBe(true)
    expect(drago.upperBound).not.toBeNull()
    expect(drago.cost === null || drago.cost < (drago.upperBound ?? 0)).toBe(true)
  })

  it('Baffeur et Dragofesse consommés 4 800 (palier 2, niveau 40) : jamais 1 800 000 K comptés comme sûrs', () => {
    for (const g of ['baffeur', 'dragofesse'] as const) {
      const adv = refillAdvice({ gauges: zeroGauges() }, { consumed: { [g]: 4_800 } }, { ctx: defaults, rules: R36, jobLevel: 40, tier: 2 })
      expect(adv.complete).toBe(false)
      expect(adv.cost === null || adv.cost < 1_800_000).toBe(true)
      expect(adv.lines[0].items.every((it) => !it.name.includes('Élixir'))).toBe(true)
    }
  })

  it('complément de Caresseur au palier 2 (40 000 → 40 060) : un Philtre, pas une Potion', () => {
    const adv = refillAdvice(
      { gauges: { ...zeroGauges(), caresseur: 40_000 } },
      { consumed: { caresseur: 60 } },
      { ctx: defaults, rules: R36, jobLevel: 200, tier: 2, serenityTier: 2 },
    )
    const l = adv.lines[0]
    expect(l.tier).toBe(2)
    expect(l.items).toHaveLength(1)
    expect(l.items[0].fuelId).toBe(findFuel('caresseur', 2, 'minuscule')!.id)
  })
})

describe('F6 — recharge = consommation − points utilisables', () => {
  const mangeoire = (cur: number, consumed: number, tier: 1 | 2) =>
    refillAdvice({ gauges: { ...zeroGauges(), mangeoire: cur } }, { consumed: { mangeoire: consumed } }, { ctx: fullCtx, rules: R36, jobLevel: 200, tier }).lines[0]

  it('15 000 dans la jauge, 20 000 consommés au palier 1 : ≈ 5 000 à ajouter', () => {
    const l = mangeoire(15_000, 20_000, 1)
    expect(l.added).toBeGreaterThanOrEqual(5_000)
    expect(l.added).toBeLessThan(6_000)
    expect(l.leftover).toBeLessThan(1_000)
  })

  it('50 000 au palier 2 : ≈ 10 000 à ajouter (les 10 000 utilisables comptent)', () => {
    const l = mangeoire(50_000, 20_000, 2)
    expect(l.base).toBeNull()
    expect(l.added).toBe(10_000)
  })

  it('15 000 au palier 2 : socle 25 000 puis 20 000 (inchangé)', () => {
    const l = mangeoire(15_000, 20_000, 2)
    expect(pointsOfPlan(l.base)).toBe(25_000)
    expect(l.added).toBe(45_000)
  })
})
const pointsOfPlan = (p: { reached: number; from: number } | null) => (p ? p.reached - p.from : 0)

describe('F2 — palier par jauge : sérénité au palier 1, socle seulement s’il vaut la peine', () => {
  const near = lotOf([-50, -30, -10, 0, 10, 30, 50])

  it('lot proche de 0 au palier 2 : Baffeur/Caresseur au palier 1, sans socle, dépôt ajusté à la consommation', () => {
    const plan = planPaddock(near, { tier: 2, withXp: true, rules: R36 })
    expect(plan.tiers.baffeur).toBe(1)
    expect(plan.tiers.caresseur).toBe(1)
    expect(plan.tiers.dragofesse).toBe(2)
    // Étapes de sérénité à 10 points par tick : points consommés = secondes.
    for (const st of plan.steps) for (const g of ['baffeur', 'caresseur'] as const) if (st.consumed[g]) expect(st.consumed[g]).toBe(st.durationSeconds)
    const adv = refillAdvice({ gauges: zeroGauges() }, plan, { ctx: fullCtx, rules: R36, jobLevel: 200, tier: 2 })
    for (const g of ['baffeur', 'caresseur'] as const) {
      const l = adv.lines.find((x) => x.gauge === g)!
      expect(l.base).toBeNull()
      expect(l.tier).toBe(1)
      expect(l.added).toBeGreaterThanOrEqual(l.consumed)
      expect(l.added).toBeLessThan(l.consumed + 1_000)
    }
  })

  it('une jauge de statistique peu consommée tourne au palier 1 (pas de socle), sauf jauge déjà au-dessus ou palier imposé', () => {
    const lot = lotOf([-1_000, -900, -800, -700, -600, -500], { endurance: 19_500 })
    const plan = planPaddock(lot, { tier: 2, withXp: true, rules: R36 })
    expect(plan.tiers.foudroyeur).toBe(1)
    expect(plan.notes.some((n) => n.startsWith('Foudroyeur au palier 1'))).toBe(true)
    expect(planPaddock(lot, { tier: 2, withXp: true, rules: R36, gaugeLevels: { foudroyeur: 50_000 } }).tiers.foudroyeur).toBe(2)
    expect(planPaddock(lot, { tier: 2, withXp: true, rules: R36, tierByGauge: { foudroyeur: 2 } }).tiers.foudroyeur).toBe(2)
    // Même règle dans les conseils de recharge sans paliers de plan.
    const adv = refillAdvice({ gauges: zeroGauges() }, { consumed: { foudroyeur: 800 } }, { ctx: fullCtx, rules: R36, jobLevel: 200, tier: 2 })
    expect(adv.lines[0].tier).toBe(1)
    expect(adv.lines[0].base).toBeNull()
  })

  it('compareTiers : durée et carburant (socle compris) pour les paliers 1 à 4', () => {
    const lot = lotOf([-1_800, -1_600, -1_400, -1_200, -1_000, -800, -600, -400, -200, -100])
    const rows = compareTiers(lot, { tier: 2, withXp: true, rules: R36 }, { ctx: fullCtx, rules: R36, jobLevel: 200, gauges: zeroGauges() })
    expect(rows.map((r) => r.tier)).toEqual([1, 2, 3, 4])
    expect(rows[3].plan.totalSeconds).toBeLessThan(rows[0].plan.totalSeconds)
    expect(rows[0].refill.baseCost).toBe(0)
    expect(rows[3].refill.baseCost ?? 0).toBeGreaterThan(rows[1].refill.baseCost ?? 0)
  })
})

describe('F3 — lots hétérogènes : convergence et découpage', () => {
  const sers = [-4_999, 4_208, -2_108, -2_894, 2_294, 327, -1_707, 2_521, 2_551, 429]

  it('captures aléatoires dans l’enclos 1 (keepCurrent) : le lot est scindé, chaque enclos ≤ 2 000', () => {
    const mounts = sers.map((s) => mk({ serenity: s, location: { kind: 'enclos', paddock: 1 } }))
    const res = assignPaddocks(mounts, { rules: R36, tier: 2, withXp: true, paddocksAvailable: 2 })
    checkInvariants(res, mounts)
    expect(res.moves.length).toBeGreaterThan(0)
    for (const a of res.paddocks) if (a.serenityRange) expect(a.serenityRange[1] - a.serenityRange[0]).toBeLessThanOrEqual(BATCH_SERENITY_WINDOW)
    const p1 = res.paddocks[0]
    expect(p1.rationale.some((r) => r.startsWith('Lot scindé'))).toBe(true)
    expect(p1.plan?.converges).toBe(true)
  })

  it('planPaddock d’un lot > 2 000 propose un découpage en fenêtres ≤ 2 000 d’un seul côté de 0', () => {
    const lot = lotOf(sers)
    const plan = planPaddock(lot, { tier: 2, withXp: true, rules: R36 })
    expect(plan.split).toBeTruthy()
    const byId = new Map(lot.map((m) => [m.id, m]))
    for (const g of plan.split!.groups) {
      const s = g.map((id) => byId.get(id)!.serenity)
      expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(BATCH_SERENITY_WINDOW)
      expect(s.every((x) => x < 0) || s.every((x) => x >= 0)).toBe(true)
    }
    expect([...plan.split!.keep, ...plan.split!.out].sort()).toEqual(lot.map((m) => m.id).sort())
    expect(plan.warnings.some((w) => w.startsWith('Lot trop large') && w.includes('Scindez-le'))).toBe(true)
  })

  it('plan qui ne finit pas : converges = false, avertissement « non applicable » et découpage', () => {
    const plan = planPaddock(lotOf([-50, -30, -10, 0, 10, 30, 50]), { tier: 2, withXp: true, rules: R36, maxSeconds: 3_600 })
    expect(plan.converges).toBe(false)
    expect(plan.warnings.some((w) => w.startsWith('Plan non applicable'))).toBe(true)
    expect(plan.split).toBeTruthy()
    // planFertility signale aussi un lot qui tourne en boucle.
    const straddle = lotOf([-900, -700, -500, -300, -100, 100, 300, 500, 700, 900])
    expect(planFertility(straddle, { tier: 2, withXp: true, rules: R36 }).converges).toBe(false)
    expect(planPaddock(straddle, { tier: 2, withXp: true, rules: R36 }).converges).toBe(true)
  })
})

describe('F5 / F9 / F14 — poussées vers la zone de maturité et fenêtres de changement', () => {
  const green = lotOf([2_500, 2_700, 2_900, 3_100, 3_300, 3_500, 3_700, 3_900, 4_100, 4_500])
  const forced = { tier: 2 as const, withXp: true, rules: R36, tierByGauge: { baffeur: 2 as const, caresseur: 2 as const } }

  it('vert 2 500…4 500 : la poussée s’arrête quand tout le lot tient dans [0, 2 000] (1 250 s), plus de lot à cheval sur 0', () => {
    const plan = planPaddock(green, forced)
    expect(plan.steps[0].durationSeconds).toBe(1_250)
    expect(plan.steps[0].switchWindow).toEqual({ earliestSeconds: 1_250, latestSeconds: 1_250 })
    const { states, end } = replay(green, plan)
    expect(states[1].every((m) => m.serenity >= 0 && m.serenity <= 2_000)).toBe(true)
    expect(plan.totalSeconds).toBeLessThan(7 * 3_600)
    expect(end.every(fecund)).toBe(true)
  })

  it('lot vert étroit (écart 400) : poussée jusqu’au centre de la zone (≈ +1 000), fenêtre des deux côtés', () => {
    const lot = lotOf([2_500, 2_600, 2_700, 2_800, 2_900])
    const plan = planPaddock(lot, forced)
    const { states } = replay(lot, plan)
    const s = states[1].map((m) => m.serenity)
    expect(Math.min(...s)).toBeGreaterThanOrEqual(700)
    expect(Math.max(...s)).toBeLessThanOrEqual(1_300)
    const w = plan.steps[0].switchWindow!
    expect(w.earliestSeconds).toBeLessThan(plan.steps[0].durationSeconds)
    expect(w.latestSeconds).toBeGreaterThan(plan.steps[0].durationSeconds)
  })

  it('lots rouges et verts de 1 000 à 1 990 de large : aucune première poussée ne finit à cheval sur 0, fenêtres justes à chaque tick', () => {
    // La zone [-2 000, -1] fait 1 999 de large et la sérénité bouge par pas de 10 : au-delà de ≈ 1 990,
    // un lot rouge ne tient pas forcément en entier dans la zone (avertissement « Lot à la limite »).
    for (let k = 0; k < 16; k++) {
      const w = 1_000 + Math.round(rnd() * 990)
      const lo = 2_100 + Math.round(rnd() * (2_900 - w))
      const sign = k % 2 ? 1 : -1
      const lot = Array.from({ length: 10 }, (_, i) => simOf(`k${i}`, { serenity: sign * (lo + Math.round((i * w) / 9)) }))
      const plan = planPaddock(lot, { tier: 2, withXp: true, rules: R36 })
      expect(plan.converges).toBe(true)
      const { states, end } = replay(lot, plan)
      const after = states[1] ?? end
      expect(after.every((m) => m.serenity < 0) || after.every((m) => m.serenity >= 0)).toBe(true)
      expect(end.every(fecund)).toBe(true)
      plan.steps.forEach((st, i) => {
        if (!st.switchWindow) return
        const zone = /vers -/.test(st.purpose) ? [-2_000, -1] : [0, 2_000]
        const judged = new Set(states[i].filter((m) => m.maturity < 20_000).map((m) => m.id))
        const maintainTier = Object.fromEntries(st.gauges.map((g) => [g, plan.tiers[g]]))
        simulatePaddock({
          gauges: zeroGauges(),
          active: st.gauges,
          mounts: states[i],
          maintainTier,
          rules: R36,
          maxSeconds: st.switchWindow.latestSeconds - st.startSeconds,
          stopWhenIdle: false,
          stopWhen: (ms, secs) => {
            if (st.startSeconds + secs >= st.switchWindow!.earliestSeconds)
              for (const m of ms) if (judged.has(m.id) && m.maturity < 20_000) expect(m.serenity >= zone[0] && m.serenity <= zone[1]).toBe(true)
            return false
          },
        })
      })
    }
  })

  it('les compléments XP et les stériles ne rallongent pas la poussée (lot rouge + 3 stériles à −5 000)', () => {
    const lot = lotOf([-3_400, -3_300, -3_200, -3_100, -3_000, -2_900, -2_800])
    const fillers = [1, 2, 3].map((i) => toFillerSim(mk({ id: `f${i}`, serenity: -5_000, fertility: 'sterile', level: 20 })))
    const alone = planPaddock(lot, { tier: 2, withXp: true, rules: R36 })
    const withFillers = planPaddock([...lot, ...fillers], { tier: 2, withXp: true, rules: R36 })
    expect(withFillers.steps[0].durationSeconds).toBe(alone.steps[0].durationSeconds)
    expect(withFillers.steps[0].purpose).toBe(alone.steps[0].purpose)
    expect(withFillers.totalSeconds).toBe(alone.totalSeconds)
  })
})

describe('F10 — Almanax limité au jour Almanax (heure de début du plan)', () => {
  const blue = lotOf([-1_900, -1_700, -1_500, -1_300, -1_100, -900, -700, -500, -300, -100])
  // Heures de jeu (Paris), indépendantes du fuseau de la machine de test.
  const at = (d: number, h: number) => serverDayStart(`2026-09-${String(d).padStart(2, '0')}`) + h * 3_600_000
  const caresseurStep = (p: ReturnType<typeof planPaddock>) => p.steps.find((s) => s.gauges.includes('caresseur'))!

  it('démarré le 10/09 à 23 h (jour du Caresseur) : la traversée après minuit n’est pas doublée', () => {
    const normal = planPaddock(blue, { tier: 2, withXp: true, rules: R36 })
    const late = planPaddock(blue, { tier: 2, withXp: true, rules: R36, startMs: at(10, 23) })
    expect(caresseurStep(late).durationSeconds).toBe(caresseurStep(normal).durationSeconds)
    // L'ancien comportement (doublement sur tout le plan) reste disponible sans heure de début.
    const whole = planPaddock(blue, { tier: 2, withXp: true, rules: R36, almanaxDoubled: 'caresseur' })
    expect(caresseurStep(whole).durationSeconds).toBeLessThan(caresseurStep(normal).durationSeconds)
  })

  it('démarré le 09/09 à 23 h : la traversée du lendemain (jour du Caresseur) est doublée, et le plan rejoué finit fécond', () => {
    const start = at(9, 23)
    const normal = planPaddock(blue, { tier: 2, withXp: true, rules: R36 })
    const plan = planPaddock(blue, { tier: 2, withXp: true, rules: R36, startMs: start })
    expect(caresseurStep(plan).durationSeconds * 2).toBe(caresseurStep(normal).durationSeconds)
    const { end } = replay(blue, plan, almanaxScheduleFrom(start))
    expect(end.every(fecund)).toBe(true)
    expect(planPaddock(blue, { tier: 2, withXp: true, rules: R36, startMs: start, applyAlmanax: false }).totalSeconds).toBe(normal.totalSeconds)
  })
})

describe('F11 / F13 — étapes identiques fusionnées, étapes trop courtes allongées', () => {
  const near = lotOf([-50, -30, -10, 0, 10, 30, 50])
  const green = lotOf([2_500, 2_700, 2_900, 3_100, 3_300, 3_500, 3_700, 3_900, 4_100, 4_500])

  it('jamais deux étapes consécutives avec les mêmes jauges', () => {
    for (const lot of [near, green]) {
      const plan = planPaddock(lot, { tier: 2, withXp: true, rules: R36 })
      for (let i = 1; i < plan.steps.length; i++) expect(keyOf(plan.steps[i])).not.toBe(keyOf(plan.steps[i - 1]))
    }
  })

  it('nextSwitchOf saute les étapes qui gardent les mêmes jauges (jamais « aucun changement » avant la fin)', () => {
    const steps: FertilityStep[] = [
      { gauges: ['dragofesse', 'mangeoire'], startSeconds: 0, durationSeconds: 1_000, purpose: 'Monter l’amour', consumed: {} },
      { gauges: ['mangeoire', 'dragofesse'], startSeconds: 1_000, durationSeconds: 20, purpose: 'Finir l’amour', consumed: {} },
      { gauges: ['baffeur', 'foudroyeur'], startSeconds: 1_020, durationSeconds: 500, purpose: 'Traverser', consumed: {} },
    ]
    const s: PlanSchedule = { startedAt: 0, steps, totalSeconds: 1_520, acknowledgedStepIndex: 0 }
    const next = nextSwitchOf(s)!
    expect(next.index).toBe(2)
    expect(next.at).toBe(1_020_000)
    expect(next.text).not.toBe('aucun changement')
    expect(acknowledgeStep(s).acknowledgedStepIndex).toBe(2)
  })

  it('lot proche de 0 au palier 2 : plus aucune étape de moins de 2 min (5 min par défaut), tout le lot fécond, à peine plus long', () => {
    const raw = planPaddock(near, { tier: 2, withXp: true, rules: R36, minStepSeconds: 0 })
    expect(raw.steps.slice(0, -1).some((s) => s.durationSeconds < 120)).toBe(true)
    const plan = planPaddock(near, { tier: 2, withXp: true, rules: R36 })
    expect(plan.steps.slice(0, -1).every((s) => s.durationSeconds >= 300)).toBe(true)
    expect(plan.converges).toBe(true)
    expect(replay(near, plan).end.every(fecund)).toBe(true)
    expect(plan.totalSeconds - raw.totalSeconds).toBeLessThanOrEqual(10 * 60)
  })

  it('minStepSeconds = 1 h (intervalle de passage) : aucune étape non finale de moins d’une heure, sinon un avertissement', () => {
    for (const lot of [near, green]) {
      const plan = planPaddock(lot, { tier: 2, withXp: true, rules: R36, minStepSeconds: 3_600 })
      const short = plan.steps.slice(0, -1).filter((s) => s.durationSeconds < 3_600)
      expect(short.length === 0 || plan.warnings.length > 0 || plan.notes.some((n) => n.includes('plus courte'))).toBe(true)
      expect(replay(lot, plan).end.every(fecund)).toBe(true)
    }
  })
})

describe('F12 — consignes exactes des jauges de sérénité', () => {
  it('lot rouge au palier 1 : Caresseur sur deux étapes, jamais « s’arrête d’elle-même », heures de coupure', () => {
    const red = lotOf([-3_400, -3_300, -3_200, -3_100, -3_000, -2_900, -2_800])
    const plan = planPaddock(red, { tier: 1, withXp: true, rules: R36 })
    const adv = refillAdvice({ gauges: zeroGauges() }, plan, { ctx: fullCtx, rules: R36, jobLevel: 200, tier: 1 })
    const l = adv.lines.find((x) => x.gauge === 'caresseur')!
    expect(l.stopsByItself).toBe(false)
    expect(l.notes.some((n) => n.includes('au plus juste'))).toBe(false)
    expect(l.cutoffs.length).toBe(plan.steps.filter((s) => (s.consumed.caresseur ?? 0) > 0).length)
    expect(l.cutoffs.length).toBeGreaterThan(1)
  })

  it('une seule étape et un dépôt exact : la jauge s’arrête d’elle-même ; sinon les points de trop sont annoncés', () => {
    const step = (consumed: number): FertilityStep => ({ gauges: ['caresseur', 'mangeoire'], startSeconds: 0, durationSeconds: consumed, purpose: 'x', consumed: { caresseur: consumed } })
    const exact = refillAdvice({ gauges: zeroGauges() }, { consumed: { caresseur: 2_000 }, steps: [step(2_000)] }, { ctx: fullCtx, rules: R36, jobLevel: 200, tier: 2 })
    expect(exact.lines[0].stopsByItself).toBe(true)
    expect(exact.lines[0].notes.some((n) => n.includes('au plus juste'))).toBe(true)
    const over = refillAdvice({ gauges: zeroGauges() }, { consumed: { caresseur: 2_400 }, steps: [step(2_400)] }, { ctx: fullCtx, rules: R36, jobLevel: 200, tier: 2 })
    expect(over.lines[0].stopsByItself).toBe(false)
    expect(over.lines[0].notes.some((n) => n.includes('600 points de trop'))).toBe(true)
    expect(over.lines[0].cutoffs).toEqual([{ stepIndex: 0, atSeconds: 2_400 }])
  })
})
