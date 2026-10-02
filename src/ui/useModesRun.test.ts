// @vitest-environment jsdom
// Revue UX2-18 : le calcul des modes appartient au module (pas à la page) — il continue quand la page Modes
// est quittée et ses résultats sont enregistrés à la fin, sans composant monté.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModeComparison, ProductionSummary } from '../domain/production'

const pending: { resolve: (c: ModeComparison) => void }[] = []
vi.mock('../domain/production', async (orig) => {
  const real = await orig<typeof import('../domain/production')>()
  return {
    ...real,
    compareModesAsync: () => new Promise<ModeComparison>((resolve) => pending.push({ resolve })),
    runProductionAsync: () => Promise.resolve(null as unknown as ProductionSummary),
  }
})

const { startModesRun, cancelModesRun, useModesRun } = await import('./useModesRun')
const { useModeResults } = await import('../store/modeResults')
const { RULESETS } = await import('../domain/rules')

const profile = { jobLevel: 120, hoursPerDay: 3, characters: 1, rules: RULESETS['3.6'], prices: { ctx: { overrides: {}, useDefaults: true } }, family: 'volkorne' as const }
const empty: ModeComparison = { rows: [], bestMode: null, horizonDays: 60, notes: ['calcul de test'] }
const flush = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  cancelModesRun()
  pending.length = 0
  useModeResults.setState({ results: null })
})

describe('calcul des modes hors de la page (UX2-18)', () => {
  it('termine et enregistre les résultats sans page montée (repli sans Web Worker)', async () => {
    expect(typeof Worker).toBe('undefined')
    startModesRun(profile, { precision: 'rapide', serverId: 'tylezia' })
    expect(useModesRun.getState().progress).not.toBeNull()
    // Aucune page n'est montée : le calcul continue quand même.
    pending[0].resolve(empty)
    await flush()
    await flush()
    expect(useModesRun.getState().progress).toBeNull()
    expect(useModeResults.getState().results?.notes).toEqual(['calcul de test'])
    expect(useModesRun.getState().finishedAt).not.toBeNull()
  })

  it('annuler : rien n’est enregistré', async () => {
    startModesRun(profile, { precision: 'rapide', serverId: 'tylezia' })
    cancelModesRun()
    pending[0].resolve(empty)
    await flush()
    await flush()
    expect(useModeResults.getState().results).toBeNull()
    expect(useModesRun.getState().progress).toBeNull()
  })
})
