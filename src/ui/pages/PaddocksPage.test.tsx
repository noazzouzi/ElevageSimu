// @vitest-environment jsdom
// Page Enclos : niveaux estimés (F8), démarrage avec relevé des jauges (ux F3), plan non applicable
// (F3), fin de plan appliquée au lot (F4, ux F2), plan dépassé (ux F6), coûts (F15), répartition
// (ux F18, ux F21).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectiveFertility } from '../../domain/mounts'
import { planPaddock, toSimMount } from '../../domain/paddockAssign'
import { RULESETS } from '../../domain/rules'
import type { GaugeId, Mount } from '../../domain/types'
import { useInventory } from '../../store/inventory'
import { useJournal } from '../../store/journal'
import { usePaddockPlans, type NewPaddockPlan } from '../../store/paddockPlans'
import { initialPaddocks, usePaddocks } from '../../store/paddocks'
import { usePrices } from '../../store/prices'
import { DEFAULT_SETTINGS, useSettings } from '../../store/settings'
import PaddocksPage from './PaddocksPage'

const HOUR = 3_600_000
let seq = 0
const mk = (serenity: number, paddock: number | null, over: Partial<Mount> = {}): Mount => ({
  id: `e${++seq}`,
  speciesId: 94,
  gender: seq % 2 ? 'male' : 'femelle',
  level: 1,
  ability: null,
  fertility: 'fertile',
  parents: [],
  serenity,
  endurance: 0,
  maturity: 0,
  love: 0,
  location: paddock === null ? { kind: 'etable' } : { kind: 'enclos', paddock },
  createdAt: 0,
  updatedAt: 0,
  ...over,
})
const blueLot = (paddock: number | null = 1) => Array.from({ length: 10 }, (_, i) => mk(-1_900 + i * 200, paddock))

function reset(mounts: Mount[]) {
  window.localStorage.clear()
  useSettings.setState({ ...DEFAULT_SETTINGS, jobLevel: 60, preferredTier: 2, xpFiller: false })
  useInventory.setState({ mounts })
  useJournal.setState({ entries: [] })
  usePaddocks.setState({ paddocks: initialPaddocks() })
  usePaddockPlans.setState({ plans: {} })
  usePrices.setState({ items: {}, mounts: {}, generations: {}, genetonValue: null, updatedAt: 0 })
}

function startedPlan(mounts: Mount[], patch: Partial<NewPaddockPlan> = {}): NewPaddockPlan {
  const p = planPaddock(mounts.map(toSimMount), { tier: 2, rules: RULESETS['3.6'] })
  return {
    paddockId: 1,
    startedAt: Date.now(),
    tier: 2,
    withXp: false,
    rulesetId: '3.6',
    almanaxDoubled: null,
    mountIds: mounts.map((m) => m.id),
    steps: p.steps,
    totalSeconds: p.totalSeconds,
    fecundAt: p.fecundAt,
    tiers: p.tiers,
    ...patch,
  }
}

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})
beforeEach(() => window.history.replaceState(null, '', '#/enclos?enclos=1'))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '#/')
})

describe('Enclos — niveaux estimés (F8, F7)', () => {
  it('niveaux saisis il y a 5 h : la jauge et le carburant montrent le niveau estimé, pas la saisie', () => {
    reset(blueLot())
    const t = Date.now() - 5 * HOUR
    const levels: Partial<Record<GaugeId, number>> = { foudroyeur: 15_000, abreuvoir: 15_000 }
    usePaddocks.getState().setActive(1, ['foudroyeur', 'abreuvoir'], t - 1)
    usePaddocks.getState().setGauges(1, levels, { rulesetId: '3.6', at: t })
    render(<PaddocksPage />)
    const row = screen.getByLabelText('Foudroyeur active').closest('.pd-gauge-row') as HTMLElement
    expect(within(row).getByText(/≈ 0 estimé maintenant/)).toBeTruthy()
    expect(row.textContent).toMatch(/Saisi .*il y a 5 h/)
    const fuel = document.querySelector('.pd-fuel-table') as HTMLElement
    const foud = [...fuel.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes('Foudroyeur')) as HTMLElement
    expect(foud.querySelector('td[data-label^="Dans la jauge"]')?.textContent).toBe('≈ 0')
    // Les montures ont progressé : proposition d'enregistrer l'état estimé.
    expect(screen.getByText(/Les jauges actives ont fait progresser 10 montures/)).toBeTruthy()
  })
})

describe('Enclos — démarrer un plan (ux F3)', () => {
  it('le dialogue indique quoi déposer, enregistre les niveaux lus et les paliers du plan', async () => {
    reset(blueLot())
    render(<PaddocksPage />)
    fireEvent.click(screen.getByRole('button', { name: /Démarrer ce plan/ }))
    const panel = screen.getByRole('region', { name: 'Démarrer le plan' })
    expect(within(panel).getAllByText(/^\d+ ×$/).length).toBeGreaterThan(0)
    await act(async () => {
      fireEvent.click(within(panel).getByRole('button', { name: /Jauges remplies/ }))
    })
    const plan = usePaddockPlans.getState().plans['1']
    expect(plan).toBeTruthy()
    expect(plan.tiers?.foudroyeur).toBe(2)
    const p1 = usePaddocks.getState().paddocks[0]
    const firstGauges = plan.steps[0].gauges
    expect(p1.active).toEqual(firstGauges)
    for (const g of firstGauges) {
      expect(p1.gauges[g]).toBeGreaterThan(0)
      expect(p1.gaugeUpdatedAt?.[g]).toBe(plan.startedAt)
      expect(p1.gaugeRulesets?.[g]).toBe('3.6')
    }
  })

  it('libellés de coût : « Acheté pour le plan (hors socle) » et « Consommé par le plan » ; 5 places vides → pas de « rendement maximal »', () => {
    reset([...blueLot().slice(0, 5), ...Array.from({ length: 5 }, () => mk(-1_000, 1, { fertility: 'sterile' }))])
    render(<PaddocksPage />)
    expect(screen.getByText('Acheté pour le plan (hors socle)')).toBeTruthy()
    expect(screen.getByText('Consommé par le plan')).toBeTruthy()
    expect(screen.queryByText(/rendement maximal/)).toBeNull()
    expect(screen.getAllByText(/Foudroyeur : \d+ étapes? à 5\/10 montures/).length).toBeGreaterThan(0)
  })
})

describe('Enclos — paliers et Almanax (F2, F10, F1, F12)', () => {
  it('« Comparer les paliers » liste les paliers 1 à 4 (durée, carburant, socle) et permet d’en choisir un', () => {
    reset(blueLot())
    render(<PaddocksPage />)
    const details = screen.getByText(/Comparer les paliers 1 à 4/).closest('details')!
    act(() => {
      details.open = true
      fireEvent(details, new Event('toggle'))
    })
    for (const t of [1, 3, 4]) expect(within(details).getByRole('button', { name: `Choisir le palier ${t}` })).toBeTruthy()
    expect(within(details).getByText('actuel')).toBeTruthy()
    fireEvent.click(within(details).getByRole('button', { name: 'Choisir le palier 1' }))
    expect(useSettings.getState().preferredTier).toBe(1)
  })

  it('prix par défaut : borne haute affichée à part, jamais comptée dans le coût de la ligne', () => {
    reset(blueLot())
    render(<PaddocksPage />)
    expect(screen.getAllByText(/\(borne haute\)/).length).toBeGreaterThan(0)
  })

  it('jour Almanax du Caresseur (heure de Paris) : bandeau « au rythme normal » tant que le réglage est décoché', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 10, 10))
    reset(blueLot())
    render(<PaddocksPage />)
    expect(screen.getByText(/au rythme normal/)).toBeTruthy()
    cleanup()
    useSettings.setState({ almanaxGaugeDoubling: true })
    render(<PaddocksPage />)
    expect(screen.getByText(/est compté doublé/)).toBeTruthy()
  })
})

describe('Enclos — plan démarré', () => {
  it('plan terminé : « Appliquer au lot » rend les montures fécondes, les range à l’étable et clôt le plan (F4, ux F2)', async () => {
    const lot = blueLot()
    reset(lot)
    const plan = startedPlan(lot)
    usePaddockPlans.getState().start({ ...plan, startedAt: Date.now() - plan.totalSeconds * 1000 - 60_000 })
    usePaddockPlans.setState((s) => ({ plans: { '1': { ...s.plans['1'], acknowledgedStepIndex: plan.steps.length } } }))
    render(<PaddocksPage />)
    const panel = screen.getByRole('region', { name: 'Appliquer au lot' })
    await act(async () => {
      fireEvent.click(within(panel).getByRole('button', { name: /Appliquer au lot \(10 fécondes\)/ }))
    })
    const mounts = useInventory.getState().mounts
    expect(mounts.every((m) => effectiveFertility(m) === 'feconde')).toBe(true)
    expect(mounts.every((m) => m.location.kind === 'etable')).toBe(true)
    expect(usePaddockPlans.getState().plans['1']).toBeUndefined()
    expect(useJournal.getState().entries.at(-1)).toMatchObject({ kind: 'note' })
  })

  it('changement manqué de 9 h pendant une poussée de sérénité : « plan dépassé », plus de « Fait à l’heure », relevé des sérénités (ux F6)', async () => {
    const lot = blueLot()
    reset(lot)
    const plan = startedPlan(lot)
    const i = plan.steps.findIndex((s) => s.gauges.includes('caresseur') || s.gauges.includes('baffeur'))
    expect(i).toBeGreaterThanOrEqual(0)
    const st = plan.steps[i]
    usePaddockPlans.getState().start({ ...plan, startedAt: Date.now() - (st.startSeconds + st.durationSeconds) * 1000 - 9 * HOUR })
    usePaddockPlans.setState((s) => ({ plans: { '1': { ...s.plans['1'], acknowledgedStepIndex: i } } }))
    render(<PaddocksPage />)
    expect(screen.getAllByText(/plan dépassé/i).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Fait à l'heure/ })).toBeNull()
    const panel = screen.getByRole('region', { name: 'Relever les sérénités et recalculer' })
    const firstRow = within(panel).getAllByRole('row')[1]
    fireEvent.click(within(firstRow).getByRole('button', { name: /Smiley vert/ }))
    await act(async () => {
      fireEvent.click(within(panel).getByRole('button', { name: /Enregistrer et recalculer/ }))
    })
    expect(usePaddockPlans.getState().plans['1']).toBeUndefined()
    expect(useInventory.getState().mounts.some((m) => m.serenity === 3_500)).toBe(true)
    expect(screen.getByText('Plan recommandé')).toBeTruthy()
  })
})

describe('Enclos — plan non applicable (F3)', () => {
  it('pas de « Démarrer » ni d’heure de fécondité pour un lot qui ne converge pas ; découpage proposé', async () => {
    const mod = await import('../../domain/paddockAssign')
    const real = mod.planPaddock
    const spy = vi.spyOn(mod, 'planPaddock').mockImplementation((sims, opts) => {
      const p = real(sims, opts)
      return { ...p, converges: false, split: { keep: sims.slice(0, 5).map((m) => m.id), out: sims.slice(5).map((m) => m.id), groups: [sims.slice(0, 5).map((m) => m.id), sims.slice(5).map((m) => m.id)] } }
    })
    reset(blueLot())
    render(<PaddocksPage />)
    expect(spy).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Démarrer ce plan/ })).toBeNull()
    expect(screen.queryByText('Lot féconde vers')).toBeNull()
    expect(screen.getAllByText('Plan non applicable').length).toBeGreaterThan(0)
    expect(screen.getByText('Scinder ce lot')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Répartir automatiquement \(scinder\)/ }).getAttribute('href')).toBe('#/enclos?onglet=repartition&calcul=1&garder=0')
    expect(screen.getByText(/rien à acheter tant que le lot n'est pas scindé/)).toBeTruthy()
  })
})

describe('Enclos — répartition automatique (ux F18, ux F21)', () => {
  it('organisation type en référence avant le calcul, repliée après ; déplacements enregistrés gardés en liste avec lien de démarrage', async () => {
    reset(blueLot(null))
    window.history.replaceState(null, '', '#/enclos?onglet=repartition')
    render(<PaddocksPage />)
    expect(screen.getByText(/Régime établi, pour référence/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Calculer la répartition' }))
    })
    expect(screen.queryByText(/Régime établi, pour référence/)).toBeNull()
    expect(screen.getByText("Pourquoi ce n'est pas l'organisation type ?")).toBeTruthy()
    const movesTable = document.querySelector('.pd-moves-table') as HTMLElement
    expect(movesTable.querySelector('thead')?.textContent).toMatch(/Sérénité/)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Enregistrer les 10 déplacements/ }))
    })
    expect(screen.getByText(/Déplacements enregistrés \(0\/10 faits en jeu\)/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('checkbox', { checked: false }).find((c) => c.closest('.pd-checklist'))!)
    expect(screen.getByText(/Déplacements enregistrés \(1\/10 faits en jeu\)/)).toBeTruthy()
    expect(screen.getByRole('link', { name: "Ouvrir l'enclos 1 et démarrer le plan" }).getAttribute('href')).toBe('#/enclos?enclos=1')
    expect(useInventory.getState().mounts.every((m) => m.location.kind === 'enclos')).toBe(true)
  })
})
