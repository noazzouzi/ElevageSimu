// @vitest-environment jsdom
// Réhydratation des stores d'enclos depuis le localStorage : la normalisation est appelée pendant la
// création du store (pas de « données illisibles » pour des données valides), champs ajoutés gardés.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const T0 = new Date(2026, 8, 15, 8, 0).getTime()

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('réhydratation des enclos et des plans', () => {
  it('relit les niveaux, heures par jauge, versions des règles et historique des jauges actives', async () => {
    const paddocks = [
      {
        id: 1,
        gauges: { baffeur: 0, caresseur: 0, foudroyeur: 15_000, abreuvoir: 15_000, dragofesse: 0, mangeoire: 0 },
        active: ['foudroyeur', 'abreuvoir'],
        updatedAt: T0,
        gaugeUpdatedAt: { foudroyeur: T0, abreuvoir: T0 },
        gaugeRulesets: { foudroyeur: '3.6', abreuvoir: '3.6' },
        activeHistory: [{ at: 0, active: ['foudroyeur', 'abreuvoir'] }],
      },
    ]
    localStorage.setItem('elevagesimu:paddocks', JSON.stringify({ state: { paddocks }, version: 1 }))
    const plan = {
      paddockId: 1,
      startedAt: T0,
      tier: 2,
      withXp: true,
      rulesetId: '3.6',
      almanaxDoubled: null,
      mountIds: ['a'],
      steps: [{ gauges: ['foudroyeur', 'abreuvoir'], startSeconds: 0, durationSeconds: 600, purpose: 'x', consumed: { foudroyeur: 1_200 } }],
      totalSeconds: 600,
      fecundAt: { a: 600 },
      acknowledgedStepIndex: 0,
      offsetMs: 0,
      tiers: { foudroyeur: 2 },
      notified: ['1:1:123:due'],
    }
    localStorage.setItem('elevagesimu:paddockPlans', JSON.stringify({ state: { plans: { '1': plan } }, version: 1 }))
    const { usePaddocks } = await import('./paddocks')
    const { usePaddockPlans } = await import('./paddockPlans')
    const { useStorageHealth } = await import('./persistence')
    expect(useStorageHealth.getState().issues).toEqual([])
    const p1 = usePaddocks.getState().paddocks[0]
    expect(p1.gauges.foudroyeur).toBe(15_000)
    expect(p1.gaugeUpdatedAt).toEqual({ foudroyeur: T0, abreuvoir: T0 })
    expect(p1.gaugeRulesets).toEqual({ foudroyeur: '3.6', abreuvoir: '3.6' })
    expect(p1.activeHistory).toHaveLength(1)
    expect(usePaddocks.getState().paddocks).toHaveLength(6)
    expect(usePaddockPlans.getState().plans['1'].tiers).toEqual({ foudroyeur: 2 })
    expect(usePaddockPlans.getState().plans['1'].notified).toEqual(['1:1:123:due'])
  })

  it('anciennes données (avant les heures par jauge) relues telles quelles ; plan mal formé écarté et signalé', async () => {
    localStorage.setItem('elevagesimu:paddocks', JSON.stringify({ state: { paddocks: [{ id: 2, gauges: { mangeoire: 30_000 }, active: ['mangeoire'], updatedAt: T0 }] }, version: 1 }))
    localStorage.setItem('elevagesimu:paddockPlans', JSON.stringify({ state: { plans: { '3': { paddockId: 3, steps: 'cassé' } } }, version: 1 }))
    const { usePaddocks, paddockProjectionInput } = await import('./paddocks')
    const { usePaddockPlans } = await import('./paddockPlans')
    const { useStorageHealth } = await import('./persistence')
    const p2 = usePaddocks.getState().paddocks[1]
    expect(p2.gauges.mangeoire).toBe(30_000)
    expect(paddockProjectionInput(p2).gaugeUpdatedAt.mangeoire).toBe(T0)
    expect(usePaddockPlans.getState().plans).toEqual({})
    const issues = useStorageHealth.getState().issues
    expect(issues.map((i) => i.kind)).toEqual(['corrige'])
    expect(issues[0].message).toMatch(/plan d’enclos illisible écarté/)
  })
})
