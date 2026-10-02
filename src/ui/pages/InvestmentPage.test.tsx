// @vitest-environment jsdom
// Investissement : préremplissage depuis l'adresse (?mode=, ?budget=, ?horizon=), préférences par
// profil, calcul (repli sans Web Worker) et affichage du plan avec les prix de Tylezia.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import tylezia from '../../data/market/tylezia-2026-10-02.json'
import { sanitizeSnapshot } from '../../domain/market'
import { useInventory } from '../../store/inventory'
import { useJournal } from '../../store/journal'
import { useMarket } from '../../store/market'
import { usePrices } from '../../store/prices'
import { profileKey } from '../../store/profiles'
import { DEFAULT_SETTINGS, useSettings } from '../../store/settings'
import InvestmentPage from './InvestmentPage'

const KEY = profileKey('investissement')

function reset() {
  window.localStorage.clear()
  useSettings.setState({ ...DEFAULT_SETTINGS, jobLevel: 1, family: 'muldo', hoursPerDay: 3, accounts: 1 })
  useInventory.setState({ mounts: [] })
  useJournal.setState({ entries: [] })
  usePrices.setState({ items: {}, mounts: {}, generations: {}, genetonValue: null, updatedAt: 0 })
  useMarket.setState({ snapshot: sanitizeSnapshot(tylezia).snapshot })
}

const field = (name: RegExp) => screen.getByRole('spinbutton', { name }) as HTMLInputElement

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})
beforeEach(reset)
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '#/')
})

describe('Investissement', () => {
  it('reprend mode, budget et horizon de l’adresse ; garde les préférences du profil', () => {
    window.history.replaceState(null, '', '#/investissement?mode=rush-ambre&budget=5000000&horizon=30')
    render(<InvestmentPage />)
    expect(field(/^Budget/).value).toBe('5000000')
    expect(field(/^Horizon/).value).toBe('30')
    expect((screen.getByLabelText('Mode de rentabilité') as HTMLSelectElement).value).toBe('rush-ambre')
    // Réserve ramenée à 10 % du budget de l'adresse au plus.
    expect(Number(field(/^Réserve/).value)).toBeLessThanOrEqual(500_000)
    // Préréglage : 50 M → réserve 10 %, enregistré pour le profil.
    fireEvent.click(screen.getByRole('button', { name: '50 M' }))
    expect(field(/^Budget/).value).toBe('50000000')
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as { budget?: number; reserve?: number; mode?: string }
    expect(stored).toMatchObject({ budget: 50_000_000, reserve: 5_000_000, mode: 'rush-ambre' })
    expect(screen.getByText(/HDV de .* du 02\/10\/2026/)).toBeTruthy()
  })

  it('calcule le plan (sans Worker : sur la page) et l’affiche dans le budget', async () => {
    window.history.replaceState(null, '', '#/investissement?mode=rush-ambre&budget=3000000&horizon=30')
    render(<InvestmentPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Calculer le plan' }))
    expect(await screen.findByText('Point mort (retour sur investissement)', {}, { timeout: 60_000 })).toBeTruthy()
    expect(screen.getByText(/Plan retenu :/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Courses du jour 0' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Plan d’action jour par jour' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Autres allocations' })).toBeTruthy()
    expect(screen.getByRole('img', { name: /Cumul de trésorerie/ })).toBeTruthy()
    expect(screen.getAllByText(/dans le budget/).length).toBeGreaterThan(0)
    // Une modification des entrées signale un résultat périmé.
    fireEvent.click(screen.getByRole('button', { name: '60 j' }))
    expect(screen.getByText('Paramètres modifiés : recalculez')).toBeTruthy()
  }, 90_000)
})
