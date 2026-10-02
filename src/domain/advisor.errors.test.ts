// Section du conseiller qui échoue : elle est signalée (« Section indisponible »), jamais masquée comme
// si la réponse était « rien à faire » (revue R13). Fichier séparé : vi.mock remplace pairing pour tout
// le fichier.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FUELS } from '../data'
import { adviseNow, analyzeState, type AdvisorInput } from './advisor'
import { RULESETS } from './rules'
import type { GaugeId, Mount } from './types'

vi.mock('./pairing', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./pairing')>()
  return {
    ...orig,
    rankPairs: () => {
      throw new Error('panne simulée du classement des couples')
    },
  }
})

const NOW = new Date(2026, 9, 2, 9, 0, 0).getTime()
let seq = 0
const fecund = (speciesId: number, gender: Mount['gender']): Mount => ({
  id: `e${++seq}`,
  speciesId,
  gender,
  level: 1,
  ability: null,
  fertility: 'fertile',
  parents: [],
  location: { kind: 'etable' },
  serenity: 0,
  endurance: 20_000,
  maturity: 20_000,
  love: 20_000,
  createdAt: 0,
  updatedAt: 0,
})
const zero = (): Record<GaugeId, number> => ({ baffeur: 0, caresseur: 0, foudroyeur: 0, abreuvoir: 0, dragofesse: 0, mangeoire: 0 })

const input: AdvisorInput = {
  now: NOW,
  rules: RULESETS['3.6'],
  mounts: [fecund(94, 'male'), fecund(92, 'femelle')],
  paddocks: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, gauges: zero(), active: [], updatedAt: 0 })),
  paddockPlans: {},
  priceCtx: { overrides: Object.fromEntries(FUELS.map((f) => [String(f.id), f.durability])), useDefaults: true },
  mountPrices: { mountOverrides: {}, generationOverrides: {}, useDefaults: true },
  settings: {
    jobLevel: 10,
    family: 'muldo',
    goalSpeciesId: null,
    goal: 'succes',
    preferredTier: 2,
    xpFiller: true,
    parentTargetLevel: 40,
    useOptimakina: true,
    saleTax: 0.02,
    useDefaultPrices: true,
  },
}

describe('section du conseiller indisponible (R13)', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  beforeAll(() => spy.mockClear())
  afterAll(() => spy.mockRestore())

  it('le plan d’accouplement en panne est noté et affiché, les autres sections restent calculées', () => {
    const a = analyzeState(input)
    expect(a.errors.map((e) => e.section)).toContain('pairs')
    expect(a.errors.find((e) => e.section === 'pairs')?.message).toContain('panne simulée')
    expect(a.pairs).toEqual([])
    // Le reste de l'analyse est là (sort des montures, métier).
    expect(a.fates.size).toBe(2)
    expect(a.job.level).toBe(10)
    expect(spy).toHaveBeenCalled()
    const list = adviseNow(input, a)
    const warn = list.find((x) => x.category === 'erreur')
    expect(warn?.title).toBe('Section indisponible : plan d’accouplement')
    expect(warn?.detail).toContain('panne simulée')
    expect(warn?.priority).toBe(2)
    expect(list.some((x) => x.category === 'metier')).toBe(true)
  })
})
