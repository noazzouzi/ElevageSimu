// Registre des pages de l'application (navigation latérale).
// La page d'accueil est chargée tout de suite ; les autres sont découpées en fichiers chargés à la
// première visite (React.lazy + <Suspense> dans App.tsx) pour alléger le démarrage.
import { lazy, type ComponentType } from 'react'
import HomePage from './HomePage'

const PlanPage = lazy(() => import('./PlanPage'))
const PaddocksPage = lazy(() => import('./PaddocksPage'))
const MountsPage = lazy(() => import('./MountsPage'))
const BreedingPage = lazy(() => import('./BreedingPage'))
const GeneticsPage = lazy(() => import('./GeneticsPage'))
const OptimizerPage = lazy(() => import('./OptimizerPage'))
const ProfitPage = lazy(() => import('./ProfitPage'))
const ModesPage = lazy(() => import('./ModesPage'))
const InvestmentPage = lazy(() => import('./InvestmentPage'))
const JobPage = lazy(() => import('./JobPage'))
const PricesPage = lazy(() => import('./PricesPage'))
const GuidePage = lazy(() => import('./GuidePage'))
const SettingsPage = lazy(() => import('./SettingsPage'))

export interface PageDef {
  id: string
  title: string
  icon: string
  section: 'Piloter' | 'Simuler' | 'Économie' | 'Aide'
  description: string
  /** Composant de la page (éventuellement chargé à la demande : à rendre sous <Suspense>). */
  component: ComponentType
}

export const PAGES: PageDef[] = [
  { id: 'accueil', title: 'Que faire maintenant ?', icon: '🏠', section: 'Piloter', description: 'Les prochaines actions, minutées.', component: HomePage },
  { id: 'plan', title: 'Plan d\'élevage', icon: '🗺️', section: 'Piloter', description: 'Objectif, étapes et calendrier.', component: PlanPage },
  { id: 'enclos', title: 'Enclos', icon: '🌾', section: 'Piloter', description: 'Jauges, placement et minuteurs.', component: PaddocksPage },
  { id: 'montures', title: 'Mes montures', icon: '🐎', section: 'Piloter', description: 'Étable, enclos et inventaire.', component: MountsPage },
  { id: 'accouplement', title: 'Accouplement', icon: '🥚', section: 'Simuler', description: 'Probabilités, génétons, makinas.', component: BreedingPage },
  { id: 'genetique', title: 'Génétique', icon: '🧬', section: 'Simuler', description: 'Arbres et croisements.', component: GeneticsPage },
  { id: 'optimiseur', title: 'Optimiseur', icon: '📈', section: 'Simuler', description: 'Comparer les stratégies.', component: OptimizerPage },
  { id: 'rentabilite', title: 'Rentabilité', icon: '💰', section: 'Économie', description: 'Coûts, revenus, bénéfice.', component: ProfitPage },
  { id: 'modes', title: 'Modes de rentabilité', icon: '🎯', section: 'Économie', description: 'Rush Volkorne, Muldo, Dragodinde, brisage, ventes.', component: ModesPage },
  { id: 'investissement', title: 'Investissement', icon: '💼', section: 'Économie', description: 'Budget, plan d’action, retour sur investissement.', component: InvestmentPage },
  { id: 'metier', title: 'Métier Éleveur', icon: '🛠️', section: 'Économie', description: 'XP, crafts et coûts.', component: JobPage },
  { id: 'prix', title: 'Prix', icon: '🏷️', section: 'Économie', description: 'Prix HDV et ressources.', component: PricesPage },
  { id: 'guide', title: 'Guide & règles', icon: '📖', section: 'Aide', description: 'Mécaniques de l\'élevage 3.5+.', component: GuidePage },
  { id: 'reglages', title: 'Réglages', icon: '⚙️', section: 'Aide', description: 'Profils et serveurs, réglages, sauvegarde.', component: SettingsPage },
]
