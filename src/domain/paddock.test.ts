import { describe, expect, it } from 'vitest'
import { gaugeDrainSeconds, gaugeRate, gaugeTier, serenityBand, simulatePaddock, validateActiveGauges, type SimMount } from './paddock'
import { decideGauges, planFertility } from './fertility'

const mount = (over: Partial<SimMount> = {}): SimMount => ({
  id: 'm1',
  ability: null,
  serenity: 0,
  endurance: 0,
  maturity: 0,
  love: 0,
  ...over,
})

describe('jauges', () => {
  it('détermine le tier selon le remplissage', () => {
    expect(gaugeTier(0)).toBe(0)
    expect(gaugeTier(40_000)).toBe(1)
    expect(gaugeTier(40_001)).toBe(2)
    expect(gaugeTier(70_001)).toBe(3)
    expect(gaugeTier(90_001)).toBe(4)
    expect(gaugeRate(100_000)).toBe(40)
    expect(gaugeRate(5)).toBe(5)
  })

  // Le guide annonce 11 h 06 / 4 h 09 / 1 h 51 / 42 min (17 h 48, somme de valeurs tronquées) ;
  // le calcul exact donne 15 000 s (4 h 10) pour le tier 2 et 64 160 s (≈ 17 h 49) pour une vidange continue de 100 000 à 0.
  it('reproduit les durées de vidange du guide (≈ 17 h 48 au total)', () => {
    expect(gaugeDrainSeconds(40_000)).toBe(40_000) // 11 h 06 min 40 s
    expect(gaugeDrainSeconds(70_000, 40_000)).toBe(15_000) // ≈ 4 h 09 min
    expect(gaugeDrainSeconds(90_000, 70_000)).toBe(6_670) // ≈ 1 h 51 min
    expect(gaugeDrainSeconds(100_000, 90_000)).toBe(2_500) // ≈ 42 min
    const total = gaugeDrainSeconds(100_000)
    expect(Math.floor(total / 3600)).toBe(17)
    expect(total).toBe(64_160)
  })

  it('interdit Baffeur + Caresseur et plus de 2 jauges', () => {
    expect(validateActiveGauges(['baffeur', 'caresseur'])).not.toBeNull()
    expect(validateActiveGauges(['abreuvoir', 'dragofesse', 'mangeoire'])).not.toBeNull()
    expect(validateActiveGauges(['abreuvoir', 'dragofesse'])).toBeNull()
  })

  it('classe la sérénité en zones', () => {
    expect(serenityBand(-2_001)).toBe('endurance')
    expect(serenityBand(-2_000)).toBe('endurance-maturite')
    expect(serenityBand(-1)).toBe('endurance-maturite')
    expect(serenityBand(0)).toBe('amour-maturite')
    expect(serenityBand(2_000)).toBe('amour-maturite')
    expect(serenityBand(2_001)).toBe('amour')
  })
})

describe('simulatePaddock', () => {
  it('chaque monture gagne autant que la jauge consomme, une seule fois pour tout l\'enclos', () => {
    const mounts = Array.from({ length: 10 }, (_, i) => mount({ id: `m${i}`, serenity: 500 }))
    const res = simulatePaddock({
      gauges: { baffeur: 0, caresseur: 0, foudroyeur: 0, abreuvoir: 0, dragofesse: 100_000, mangeoire: 0 },
      active: ['dragofesse'],
      mounts,
      maxSeconds: 600,
    })
    expect(res.consumed.dragofesse).toBe(60 * 40)
    for (const m of res.mounts) expect(m.love).toBe(60 * 40)
  })

  it("la capacité Amoureuse double l'amour mais pas la consommation", () => {
    const res = simulatePaddock({
      gauges: { baffeur: 0, caresseur: 0, foudroyeur: 0, abreuvoir: 0, dragofesse: 100_000, mangeoire: 0 },
      active: ['dragofesse'],
      mounts: [mount({ ability: 'amoureuse', serenity: 10 })],
      maxSeconds: 100,
    })
    expect(res.consumed.dragofesse).toBe(400)
    expect(res.mounts[0].love).toBe(800)
  })

  it("une jauge ne se vide pas si personne n'en profite", () => {
    const res = simulatePaddock({
      gauges: { baffeur: 0, caresseur: 0, foudroyeur: 50_000, abreuvoir: 0, dragofesse: 0, mangeoire: 0 },
      active: ['foudroyeur'],
      mounts: [mount({ serenity: 100 })],
      maxSeconds: 3600,
    })
    expect(res.consumed.foudroyeur).toBe(0)
    expect(res.gauges.foudroyeur).toBe(50_000)
    expect(res.events.some((e) => e.kind === 'idle')).toBe(true)
  })

  it('la maturité ne monte pas hors de -2 000…2 000', () => {
    const res = simulatePaddock({
      gauges: { baffeur: 0, caresseur: 0, foudroyeur: 0, abreuvoir: 100_000, dragofesse: 0, mangeoire: 0 },
      active: ['abreuvoir'],
      mounts: [mount({ id: 'a', serenity: 2_500 }), mount({ id: 'b', serenity: -2_000 })],
      maxSeconds: 100,
    })
    expect(res.mounts[0].maturity).toBe(0)
    expect(res.mounts[1].maturity).toBe(400)
  })
})

describe('planFertility', () => {
  it('mène une monture neutre à la fécondité au tier 4 en ≈ 2 h 47', () => {
    const plan = planFertility([mount({ serenity: 500 })], { tier: 4 })
    expect(plan.warnings).toEqual([])
    expect(plan.fecundAt.m1).toBeDefined()
    // maturité + amour en parallèle (5 000 s) puis baffeur pour passer < 0 puis endurance (5 000 s)
    expect(plan.steps[0].gauges.sort()).toEqual(['abreuvoir', 'dragofesse'])
    expect(plan.totalSeconds).toBeGreaterThan(10_000)
    expect(plan.totalSeconds).toBeLessThan(10_300)
    const m = plan.mounts[0]
    expect([m.endurance, m.maturity, m.love]).toEqual([20_000, 20_000, 20_000])
  })

  it('remonte d\'abord une sérénité très basse en visant la zone de maturité', () => {
    const d = decideGauges(mount({ serenity: -4_000 }), false)
    expect(d?.gauges).toEqual(['caresseur', 'foudroyeur'])
    const plan = planFertility([mount({ serenity: -4_000 })], { tier: 2 })
    expect(plan.fecundAt.m1).toBeDefined()
    expect(plan.steps[0].switchWindow).toBeDefined()
  })

  it('fonctionne pour un groupe de 10 montures de sérénités voisines', () => {
    const group = Array.from({ length: 10 }, (_, i) => mount({ id: `g${i}`, serenity: -1_500 + i * 100 }))
    const plan = planFertility(group, { tier: 3, withXp: true })
    expect(Object.keys(plan.fecundAt)).toHaveLength(10)
  })
})
