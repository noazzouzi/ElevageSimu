// Stores des enclos et des plans d'enclos : heures de saisie par jauge (F7), version des règles des
// niveaux (R9), alarmes notifiées une seule fois (R6), lecture normalisée.
import { beforeEach, describe, expect, it } from 'vitest'
import { projectGaugeLevels } from '../domain/projection'
import { RULESETS } from '../domain/rules'
import type { Mount } from '../domain/types'
import { alarmKey, pendingAlarms, sanitizePaddockPlans, usePaddockPlans, type NewPaddockPlan } from './paddockPlans'
import { convertGaugeLevel, initialPaddocks, levelsFromOtherRuleset, paddockProjectionInput, sanitizePaddocks, usePaddocks } from './paddocks'

const HOUR = 3_600_000
const T0 = new Date(2026, 8, 15, 8, 0).getTime()
const R36 = RULESETS['3.6']

const p1 = () => usePaddocks.getState().paddocks.find((p) => p.id === 1)!

const mk = (i: number): Mount => ({
  id: `m${i}`,
  speciesId: 94,
  gender: i % 2 ? 'male' : 'femelle',
  level: 1,
  ability: null,
  fertility: 'fertile',
  parents: [],
  location: { kind: 'enclos', paddock: 1 },
  serenity: -1_000,
  endurance: 0,
  maturity: 0,
  love: 0,
  createdAt: 0,
  updatedAt: 0,
})

beforeEach(() => {
  usePaddocks.setState({ paddocks: initialPaddocks() })
  usePaddockPlans.setState({ plans: {} })
})

describe('usePaddocks — heures de saisie (F7)', () => {
  it('changer les jauges actives ne rajeunit pas les niveaux saisis', () => {
    const { setGauge, setActive } = usePaddocks.getState()
    setGauge(1, 'foudroyeur', 15_000, { rulesetId: '3.6', at: T0 })
    setGauge(1, 'abreuvoir', 15_000, { rulesetId: '3.6', at: T0 })
    setActive(1, ['foudroyeur', 'abreuvoir'], T0)
    const before = { updatedAt: p1().updatedAt, stamps: { ...p1().gaugeUpdatedAt } }
    setActive(1, ['abreuvoir', 'mangeoire'], T0 + 5 * HOUR)
    setActive(1, ['foudroyeur', 'abreuvoir'], T0 + 5 * HOUR)
    expect(p1().updatedAt).toBe(before.updatedAt)
    expect(p1().gaugeUpdatedAt).toEqual(before.stamps)
    expect(p1().activeChangedAt).toBe(T0 + 5 * HOUR)
  })

  it('saisir une jauge ne date que cette jauge', () => {
    const { setGauge } = usePaddocks.getState()
    setGauge(1, 'foudroyeur', 10_000, { rulesetId: '3.6', at: T0 })
    setGauge(1, 'abreuvoir', 20_000, { rulesetId: '3.6', at: T0 + HOUR })
    expect(p1().gaugeUpdatedAt).toEqual({ foudroyeur: T0, abreuvoir: T0 + HOUR })
    expect(p1().updatedAt).toBe(T0 + HOUR)
  })

  it('niveaux saisis il y a 5 h puis jauges basculées : la projection voit toujours Foudroyeur vide', () => {
    const { setGauge, setActive } = usePaddocks.getState()
    setActive(1, ['foudroyeur', 'abreuvoir'], T0 - HOUR)
    setGauge(1, 'foudroyeur', 15_000, { rulesetId: '3.6', at: T0 })
    setGauge(1, 'abreuvoir', 15_000, { rulesetId: '3.6', at: T0 })
    const now = T0 + 5 * HOUR
    setActive(1, ['foudroyeur', 'mangeoire'], now - 60_000)
    setActive(1, ['foudroyeur', 'abreuvoir'], now)
    const input = paddockProjectionInput(p1())
    expect(input.activeSinceMs).toBe(T0)
    const proj = projectGaugeLevels(p1(), input.activeSinceMs, now, R36, Array.from({ length: 10 }, (_, i) => mk(i)), {
      gaugeUpdatedAt: input.gaugeUpdatedAt,
      activeHistory: input.activeHistory,
      almanax: false,
    })
    expect(proj.levels.foudroyeur).toBe(0)
    expect(proj.emptiedAt.foudroyeur).toBe(T0 + 15_000_000)
  })

  it('historique des jauges actives : élagué depuis la plus ancienne saisie, avec les jauges actives à cette heure-là', () => {
    const { setGauge, setActive } = usePaddocks.getState()
    setActive(1, ['caresseur'], T0 - 3 * HOUR)
    setActive(1, ['foudroyeur'], T0 - 2 * HOUR)
    setGauge(1, 'foudroyeur', 1_000, { rulesetId: '3.6', at: T0 })
    setActive(1, ['abreuvoir'], T0 + HOUR)
    expect(p1().activeHistory).toEqual([
      { at: T0 - 2 * HOUR, active: ['foudroyeur'] },
      { at: T0 + HOUR, active: ['abreuvoir'] },
    ])
  })
})

describe('usePaddocks — version des règles des niveaux (R9)', () => {
  it('borne la saisie au plafond de la version des règles et la marque', () => {
    usePaddocks.getState().setGauge(1, 'mangeoire', 150_000, { rulesetId: '3.6', at: T0 })
    expect(p1().gauges.mangeoire).toBe(100_000)
    expect(p1().gaugeRulesets?.mangeoire).toBe('3.6')
  })

  it('signale les niveaux saisis sous une autre version et les convertit (×2), heures de saisie gardées', () => {
    usePaddocks.getState().setGauge(1, 'mangeoire', 150_000, { rulesetId: '3.7', at: T0 })
    usePaddocks.getState().setGauge(1, 'abreuvoir', 0, { rulesetId: '3.7', at: T0 })
    expect(levelsFromOtherRuleset(p1(), '3.6')).toEqual([{ gauge: 'mangeoire', rulesetId: '3.7' }])
    expect(levelsFromOtherRuleset(p1(), '3.7')).toEqual([])
    usePaddocks.getState().convertLevels(1, '3.6')
    expect(p1().gauges.mangeoire).toBe(75_000)
    expect(p1().gaugeRulesets?.mangeoire).toBe('3.6')
    expect(p1().gaugeUpdatedAt?.mangeoire).toBe(T0)
    expect(levelsFromOtherRuleset(p1(), '3.6')).toEqual([])
    expect(convertGaugeLevel(100_000, '3.6', '3.7')).toBe(200_000)
  })

  it('setGauges : plusieurs jauges en une saisie (démarrage d’un plan)', () => {
    usePaddocks.getState().setGauges(1, { foudroyeur: 40_000, abreuvoir: 52_000 }, { rulesetId: '3.6', at: T0 })
    expect(p1().gauges.foudroyeur).toBe(40_000)
    expect(p1().gauges.abreuvoir).toBe(52_000)
    expect(p1().gaugeUpdatedAt).toEqual({ foudroyeur: T0, abreuvoir: T0 })
  })
})

describe('lecture normalisée', () => {
  it('enclos : anciennes données gardées, valeurs invalides corrigées, 6 enclos', () => {
    const r = sanitizePaddocks({
      paddocks: [
        { id: 1, gauges: { foudroyeur: 12_000 }, active: ['foudroyeur'], updatedAt: T0 },
        { id: 2, gauges: { abreuvoir: -5 }, active: ['baffeur', 'caresseur'], updatedAt: 'x' },
        { id: 9, gauges: {} },
        'n’importe quoi',
      ],
    })
    expect(r.state.paddocks).toHaveLength(6)
    expect(r.state.paddocks[0]).toMatchObject({ id: 1, active: ['foudroyeur'], updatedAt: T0 })
    expect(r.state.paddocks[0].gauges.foudroyeur).toBe(12_000)
    expect(r.state.paddocks[1]).toMatchObject({ id: 2, active: [], updatedAt: 0 })
    expect(r.state.paddocks[1].gauges.abreuvoir).toBe(0)
    expect(r.issues.length).toBeGreaterThan(0)
    expect(sanitizePaddocks(null).state.paddocks).toHaveLength(6)
  })

  it('plans : un plan illisible est écarté, les autres gardés', () => {
    const good = { paddockId: 1, startedAt: T0, tier: 2, withXp: false, rulesetId: '3.6', almanaxDoubled: null, mountIds: ['a'], steps: [{ gauges: ['foudroyeur'], startSeconds: 0, durationSeconds: 60, purpose: 'x', consumed: { foudroyeur: 120 } }], totalSeconds: 60, fecundAt: {}, acknowledgedStepIndex: 0, offsetMs: 0 }
    const r = sanitizePaddockPlans({ plans: { '1': good, '2': { paddockId: 2, steps: 'x' }, '3': { ...good, paddockId: 4 } } })
    expect(Object.keys(r.state.plans)).toEqual(['1'])
    expect(r.issues[0]).toMatch(/2 plans/)
  })
})

describe('usePaddockPlans — alarmes notifiées une seule fois (R6)', () => {
  const plan: NewPaddockPlan = {
    paddockId: 1,
    startedAt: T0,
    tier: 2,
    withXp: false,
    rulesetId: '3.6',
    almanaxDoubled: null,
    mountIds: [],
    steps: [
      { gauges: ['baffeur', 'dragofesse'], startSeconds: 0, durationSeconds: 1_200, purpose: 'a', consumed: {}, switchWindow: { earliestSeconds: 600, latestSeconds: 1_200 } },
      { gauges: ['abreuvoir'], startSeconds: 1_200, durationSeconds: 600, purpose: 'b', consumed: {} },
    ],
    totalSeconds: 1_800,
    fecundAt: {},
  }

  it('changement dû → une alarme ; notée → plus rien ; fenêtre dépassée → une autre ; validée → la suivante', () => {
    usePaddockPlans.getState().start(plan)
    const plans = () => usePaddockPlans.getState().plans
    expect(pendingAlarms(plans(), T0 + 60_000)).toEqual([])
    const due = pendingAlarms(plans(), T0 + 1_200_000)
    expect(due).toHaveLength(1)
    expect(due[0].kind).toBe('due')
    usePaddockPlans.getState().markNotified(1, [due[0].key])
    expect(pendingAlarms(plans(), T0 + 1_200_000)).toEqual([])
    const late = pendingAlarms(plans(), T0 + 1_300_000)
    expect(late.map((a) => a.kind)).toEqual(['late'])
    usePaddockPlans.getState().markNotified(1, [late[0].key])
    usePaddockPlans.getState().advance(1)
    expect(plans()['1'].notified).toEqual([])
    const end = pendingAlarms(plans(), T0 + 1_800_000)
    expect(end).toHaveLength(1)
    expect(end[0].key).toBe(alarmKey(1, { index: 2, at: T0 + 1_800_000 }, 'due'))
  })

  it('le plan démarré garde ses paliers par jauge et les niveaux relevés au démarrage', () => {
    usePaddockPlans.getState().start({ ...plan, tiers: { baffeur: 1, dragofesse: 2 }, levelsAtStart: { dragofesse: 40_000 } })
    expect(usePaddockPlans.getState().plans['1'].tiers).toEqual({ baffeur: 1, dragofesse: 2 })
    expect(usePaddockPlans.getState().plans['1'].levelsAtStart).toEqual({ dragofesse: 40_000 })
  })
})
