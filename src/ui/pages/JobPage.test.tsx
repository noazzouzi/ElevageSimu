// @vitest-environment jsdom
// Page Métier : l'XP d'Éleveur notée au journal depuis la saisie du niveau est déduite du plan, comme à
// l'accueil (« XP restante » identique sur les deux pages).
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { jobStatus } from '../../domain/advisor'
import { jobXpForLevel } from '../../domain/xp'
import { RULESETS } from '../../domain/rules'
import { journalJobXp, useJournal } from '../../store/journal'
import { usePrices } from '../../store/prices'
import { DEFAULT_SETTINGS, useSettings } from '../../store/settings'
import JobPage from './JobPage'

const LEVEL_AT = Date.now() - 3_600_000

beforeEach(() => {
  try {
    localStorage.clear()
  } catch {
    // stockage indisponible : préférences par défaut
  }
  useSettings.setState({ ...DEFAULT_SETTINGS, jobLevel: 40, jobLevelUpdatedAt: LEVEL_AT })
  usePrices.setState({ items: {}, mounts: {}, generations: {}, genetonValue: null, updatedAt: 0 })
  // 24 captures (720 XP) et 3 accouplements G2 (60 XP chacun) après la saisie du niveau.
  useJournal.setState({
    entries: [
      { id: 'j1', at: LEVEL_AT + 1_000, kind: 'capture', speciesId: 94, count: 24 },
      ...[2, 3, 4].map((k) => ({
        id: `j${k}`,
        at: LEVEL_AT + 2_000 * k,
        kind: 'accouplement' as const,
        parentA: 94,
        parentB: 92,
        babies: [108],
        targetGeneration: 2,
        targetChance: 0.4,
        makina: null,
        genetons: 2,
        jobXp: 60,
      })),
    ],
  })
})

afterEach(() => cleanup())

describe('Métier : XP du journal (intégration)', () => {
  it('« XP restante » déduit l’XP du journal, comme l’accueil', () => {
    const xp = journalJobXp(useJournal.getState().entries, LEVEL_AT).xp
    expect(xp).toBe(900)
    const expected = jobXpForLevel(80) - jobXpForLevel(40) - xp
    // Même valeur que le conseil « Métier » de l'accueil.
    const home = jobStatus(40, { overrides: {}, useDefaults: true }, RULESETS['3.6'], { todayIso: '2026-10-02', withPlan: false, xpGained: xp })
    expect(home.xpToNext).toBe(expected)
    render(<JobPage />)
    const stat = screen.getByText('XP restante (niv. 80)').closest('.stat')
    expect(stat?.textContent?.replace(/\s/g, '')).toContain(String(expected))
    expect(stat?.textContent).toContain('XP du journal déduite')
  })
})
