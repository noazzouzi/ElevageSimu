// @vitest-environment jsdom
// Rentabilité (R2) : les paramètres issus des Réglages suivent les Réglages en direct ; seule une
// modification faite sur la page est mémorisée comme écart ; une seule taxe (celle du calcul).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_SETTINGS, useSettings } from '../../store/settings'
import { useInventory } from '../../store/inventory'
import { usePrices } from '../../store/prices'
import { profileKey } from '../../store/profiles'
import ProfitPage from './ProfitPage'

const KEY = profileKey('rentabilite')

function reset() {
  window.localStorage.clear()
  useSettings.setState({ ...DEFAULT_SETTINGS })
  useInventory.setState({ mounts: [] })
  usePrices.setState({ items: {}, mounts: {}, generations: {}, genetonValue: null, updatedAt: 0 })
}

const input = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})
beforeEach(reset)
afterEach(cleanup)

describe('Rentabilité : paramètres et Réglages', () => {
  it('une ancienne copie figée des réglages est ignorée ; les champs de la page sont gardés', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ saleTaxPct: 2, parentLevel: 40, paddocks: 2, tier: 2, pairs: 7, family: 'muldo' }))
    useSettings.setState({ saleTax: 0.05, parentTargetLevel: 80, jobLevel: 120 })
    render(<ProfitPage />)
    expect(input(/Taxe d’HDV/).value).toBe('5')
    expect(input(/Niveau des parents/).value).toBe('80')
    expect(input(/Enclos en parallèle/).value).toBe('4')
    expect(input(/Couples accouplés/).value).toBe('7')
  })

  it('suit les Réglages en direct, sauf écart saisi ici (avec retour aux réglages)', () => {
    render(<ProfitPage />)
    expect(input(/Taxe d’HDV/).value).toBe('2')
    act(() => useSettings.setState({ saleTax: 0.03, parentTargetLevel: 60 }))
    expect(input(/Taxe d’HDV/).value).toBe('3')
    expect(input(/Niveau des parents/).value).toBe('60')

    fireEvent.change(input(/Taxe d’HDV/), { target: { value: '5' } })
    expect(input(/Taxe d’HDV/).value).toBe('5')
    expect(screen.getByText(/Différent de vos réglages/)).toBeTruthy()
    act(() => useSettings.setState({ saleTax: 0.04 }))
    expect(input(/Taxe d’HDV/).value).toBe('5')
    // L'écart est mémorisé seul (pas de copie des autres réglages).
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as { overrides?: Record<string, unknown> }
    expect(stored.overrides).toEqual({ saleTaxPct: 5 })

    fireEvent.click(screen.getByRole('button', { name: 'Revenir à mes réglages' }))
    expect(input(/Taxe d’HDV/).value).toBe('4')
    expect(screen.queryByText(/Différent de vos réglages/)).toBeNull()
  })

  it('l’onglet Hypothèses affiche la taxe utilisée par le calcul', () => {
    useSettings.setState({ saleTax: 0.05 })
    render(<ProfitPage />)
    fireEvent.change(input(/Taxe d’HDV/), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('tab', { name: /Hypothèses/ }))
    expect(screen.getByText(/Taxe d’HDV retenue dans ces calculs : 3 %/)).toBeTruthy()
    expect(screen.getByText(/différente de vos réglages : 5 %/)).toBeTruthy()
  })

  it('le palier suit les Réglages et l’Optimakina suit la règle de l’Accouplement par défaut', () => {
    useSettings.setState({ preferredTier: 3, useOptimakina: true })
    render(<ProfitPage />)
    expect((screen.getByLabelText(/Palier des jauges de fécondité/) as HTMLSelectElement).value).toBe('3')
    expect((screen.getByLabelText(/^Optimakina/) as HTMLSelectElement).value).toBe('auto')
    act(() => useSettings.setState({ useOptimakina: false }))
    expect((screen.getByLabelText(/^Optimakina/) as HTMLSelectElement).value).toBe('jamais')
  })
})

describe('Rentabilité : montants incomplets jamais présentés comme estimés', () => {
  it('prix par défaut incomplets : bénéfice, kamas/h, ROI et coût net par bébé cible « inconnu », jamais « ≈ »', () => {
    render(<ProfitPage />)
    const stat = (label: string) => screen.getByText(label).closest('.stat') as HTMLElement
    for (const label of ['Bénéfice attendu', 'Kamas par heure', 'Coût net par bébé cible']) expect(stat(label).textContent).toMatch(/inconnu/)
    expect(stat('Coût net par bébé cible').textContent).not.toMatch(/≈/)
  })
})
