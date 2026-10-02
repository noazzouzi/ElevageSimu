// @vitest-environment jsdom
// Test de fumée de l'interface : chaque page s'affiche sans erreur (état vide et étable remplie),
// avec son titre ; l'application route vers les pages chargées à la demande.
import { act, cleanup, render, screen, within } from '@testing-library/react'
import type { ComponentType } from 'react'
import App from '../../App'
import { useInventory } from '../../store/inventory'
import { useJournal } from '../../store/journal'
import { usePaddockPlans } from '../../store/paddockPlans'
import { initialPaddocks, usePaddocks } from '../../store/paddocks'
import { usePrices } from '../../store/prices'
import { DEFAULT_SETTINGS, useSettings, type Settings } from '../../store/settings'
import type { Mount } from '../../domain/types'
import BreedingPage from './BreedingPage'
import GeneticsPage from './GeneticsPage'
import GuidePage from './GuidePage'
import HomePage from './HomePage'
import InvestmentPage from './InvestmentPage'
import JobPage from './JobPage'
import ModesPage from './ModesPage'
import MountsPage from './MountsPage'
import OptimizerPage from './OptimizerPage'
import PaddocksPage from './PaddocksPage'
import PlanPage from './PlanPage'
import PricesPage from './PricesPage'
import ProfitPage from './ProfitPage'
import { PAGES } from './registry'
import SettingsPage from './SettingsPage'

/** id de route → composant et titre (h1) attendu. */
const CASES: { id: string; Page: ComponentType; title: string }[] = [
  { id: 'accueil', Page: HomePage, title: 'Que faire maintenant ?' },
  { id: 'plan', Page: PlanPage, title: "Plan d'élevage" },
  { id: 'enclos', Page: PaddocksPage, title: 'Enclos' },
  { id: 'montures', Page: MountsPage, title: 'Mes montures' },
  { id: 'accouplement', Page: BreedingPage, title: 'Accouplement' },
  { id: 'genetique', Page: GeneticsPage, title: 'Génétique' },
  { id: 'optimiseur', Page: OptimizerPage, title: 'Optimiseur de stratégie' },
  { id: 'rentabilite', Page: ProfitPage, title: 'Rentabilité' },
  { id: 'modes', Page: ModesPage, title: 'Modes de rentabilité' },
  { id: 'investissement', Page: InvestmentPage, title: 'Investissement' },
  { id: 'metier', Page: JobPage, title: 'Métier Éleveur' },
  { id: 'prix', Page: PricesPage, title: 'Prix' },
  { id: 'guide', Page: GuidePage, title: 'Guide & règles' },
  { id: 'reglages', Page: SettingsPage, title: 'Réglages' },
]

// Muldos (ids client) : G1 Doré 94, Indigo 92, Ébène 91, Orchidée 90, Pourpre 93 ; G2 Indigo et
// Pourpre 102, Ébène et Orchidée 107, Ébène et Pourpre 103, Indigo et Orchidée 106, Doré et Ébène 110 ;
// G3 Amande 96, Roux 95 ; G4 Doré et Amande 121.
const NOW = Date.now()
let seq = 0
function mount(speciesId: number, gender: Mount['gender'], patch: Partial<Mount> = {}): Mount {
  return {
    id: `t-${++seq}`,
    speciesId,
    gender,
    level: 40,
    ability: null,
    fertility: 'feconde',
    parents: [],
    serenity: 0,
    endurance: 20_000,
    maturity: 20_000,
    love: 20_000,
    location: { kind: 'etable' },
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  }
}

const STABLE: Mount[] = [
  mount(102, 'male', { parents: [92, 93] }),
  mount(107, 'femelle', { parents: [90, 91] }),
  mount(103, 'male', { parents: [91, 93] }),
  mount(106, 'femelle', { parents: [90, 92] }),
  mount(94, 'male'),
  mount(92, 'femelle'),
  mount(110, 'male', { fertility: 'sterile', parents: [91, 94] }),
  mount(110, 'femelle', { fertility: 'sterile', parents: [91, 94] }),
  mount(96, 'male', { fertility: 'fertile', endurance: 3_000, maturity: 0, love: 0, serenity: -1_500, parents: [102, 107], level: 12 }),
  mount(95, 'femelle', { fertility: 'fertile', endurance: 0, maturity: 5_000, love: 2_000, serenity: 2_500, parents: [101, 105], level: 1, location: { kind: 'enclos', paddock: 1 } }),
  mount(93, 'male', { fertility: 'fertile', endurance: 0, maturity: 0, love: 0, serenity: -4_000, level: 100, location: { kind: 'enclos', paddock: 2 } }),
  mount(90, 'femelle', { fertility: 'senile', level: 150, location: { kind: 'inventaire' } }),
]

function resetStores(settings: Partial<Settings> = {}, mounts: Mount[] = []) {
  window.localStorage.clear()
  window.sessionStorage.clear()
  useSettings.setState({ ...DEFAULT_SETTINGS, ...settings })
  useInventory.setState({ mounts })
  useJournal.setState({ entries: [] })
  usePaddocks.setState({ paddocks: initialPaddocks() })
  usePaddockPlans.setState({ plans: {} })
  usePrices.setState({ items: {}, mounts: {}, generations: {}, genetonValue: null, updatedAt: 0 })
}

function goTo(hash: string) {
  window.history.replaceState(null, '', hash)
}

beforeAll(() => {
  // jsdom n'implémente pas le défilement : les pages l'appellent pour les ancres (#/guide?s=…).
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
  goTo('#/')
})

describe('pages (test de fumée)', () => {
  it('couvre toutes les pages du registre', () => {
    expect(CASES.map((c) => c.id).sort()).toEqual(PAGES.map((p) => p.id).sort())
  })

  describe.each([
    { label: 'état vide', settings: {}, mounts: [] as Mount[] },
    { label: 'étable remplie, niveau 60, objectif G4', settings: { jobLevel: 60, goalSpeciesId: 121 }, mounts: STABLE },
    { label: 'règles 3.7, niveau 200, Dragodindes, sans prix par défaut', settings: { ruleset: '3.7' as const, jobLevel: 200, family: 'dragodinde' as const, goal: 'succes' as const, preferredTier: 4 as const, useDefaultPrices: false }, mounts: STABLE },
  ])('$label', ({ settings, mounts }) => {
    beforeEach(() => resetStores(settings, mounts))

    it.each(CASES)('$id s’affiche avec son titre', ({ id, Page, title }) => {
      goTo(`#/${id}`)
      expect(() => render(<Page />)).not.toThrow()
      expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy()
    })
  })

  it('suit les paramètres d’adresse des autres pages', () => {
    resetStores({ jobLevel: 60 }, STABLE)
    const links: [string, ComponentType, string][] = [
      ['#/accouplement?a=102&b=107', BreedingPage, 'Accouplement'],
      ['#/accouplement?onglet=couples', BreedingPage, 'Accouplement'],
      ['#/genetique?id=121', GeneticsPage, 'Génétique'],
      ['#/genetique?famille=volkorne', GeneticsPage, 'Génétique'],
      ['#/enclos?onglet=repartition', PaddocksPage, 'Enclos'],
      ['#/enclos?enclos=2', PaddocksPage, 'Enclos'],
      ['#/montures?statut=feconde', MountsPage, 'Mes montures'],
      ['#/montures?captures=1', MountsPage, 'Mes montures'],
      ['#/plan?onglet=routines', PlanPage, "Plan d'élevage"],
      ['#/prix?q=Avoine', PricesPage, 'Prix'],
      ['#/prix?onglet=carburants', PricesPage, 'Prix'],
      ['#/guide?s=almanax', GuidePage, 'Guide & règles'],
    ]
    for (const [hash, Page, title] of links) {
      goTo(hash)
      const { unmount } = render(<Page />)
      expect(screen.getByRole('heading', { level: 1, name: title }), hash).toBeTruthy()
      unmount()
    }
  })

  it('l’application charge à la demande la page de l’adresse, et revient à l’accueil sinon', async () => {
    resetStores({ jobLevel: 60 }, STABLE)
    goTo('#/genetique')
    render(<App />)
    const main = screen.getByRole('main')
    expect(await within(main).findByRole('heading', { level: 1, name: 'Génétique' })).toBeTruthy()

    await act(async () => {
      window.location.hash = '#/page-inconnue'
    })
    expect(await within(main).findByRole('heading', { level: 1, name: 'Que faire maintenant ?' })).toBeTruthy()

    // Chaque lien de la navigation pointe vers une page du registre.
    const nav = screen.getAllByRole('navigation').flatMap((n) => within(n).getAllByRole('link'))
    expect(nav.map((a) => a.getAttribute('href'))).toEqual(PAGES.map((p) => `#/${p.id}`))
  })
})
