// @vitest-environment jsdom
// Filet d'erreur par page (R4) : actions de récupération (sauvegarde, réglages) dans le filet, et nouvel
// essai d'affichage quand l'adresse change (autre onglet, autre enclos…) au lieu de garder l'erreur.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ui/alarms', () => ({ PlanAlarms: () => null, DueSwitchBanner: () => null }))
vi.mock('./ui/pages/registry', async () => {
  const { useRoute } = await import('./ui/router')
  function Fragile() {
    const route = useRoute()
    if (route.params.get('casse') === '1') throw new Error('panne simulée')
    return <h1>Page fragile</h1>
  }
  return {
    PAGES: [{ id: 'fragile', title: 'Fragile', icon: '!', section: 'Piloter', description: '', component: Fragile }],
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '#/')
})

describe('PageBoundary', () => {
  it('propose de télécharger une sauvegarde, puis réaffiche la page quand l’adresse change', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    window.history.replaceState(null, '', '#/fragile?casse=1')
    const { default: App } = await import('./App')
    render(<App />)
    expect(await screen.findByText(/Cette page a rencontré une erreur/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Télécharger une sauvegarde' })).toBeTruthy()
    await act(async () => {
      window.history.replaceState(null, '', '#/fragile?casse=0')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(await screen.findByRole('heading', { name: 'Page fragile' })).toBeTruthy()
  })
})
