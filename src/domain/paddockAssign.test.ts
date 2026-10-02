import { describe, expect, it } from 'vitest'
import { FUELS } from '../data'
import { PADDOCK_SLOTS } from './constants'
import { planFertility, type FertilityStep } from './fertility'
import {
  BATCH_SERENITY_WINDOW,
  acknowledgeStep,
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
  toSimMount,
  xpSeconds,
  type AssignResult,
  type PlanSchedule,
} from './paddockAssign'
import type { PriceContext } from './pricing'
import type { SimMount } from './paddock'
import { RULESETS } from './rules'
import type { GaugeId, Mount } from './types'

const R36 = RULESETS['3.6']
const R37 = RULESETS['3.7']
const MULDO_DORE = 94
const ARMURE = 88 // Dragodinde en armure : non élevable

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
    const parents = Array.from({ length: 6 }, (_, i) => mk({ level: 1 + i, endurance: 20_000, maturity: 20_000, love: 20_000 }))
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
    expect(planPaddock(lot, opts)).toEqual(planFertility(lot, opts))
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
