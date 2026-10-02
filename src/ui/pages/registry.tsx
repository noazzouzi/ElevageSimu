// Registre des pages de l'application (navigation latérale).
import type { ComponentType } from 'react'
import HomePage from './HomePage'
import PlanPage from './PlanPage'
import PaddocksPage from './PaddocksPage'
import MountsPage from './MountsPage'
import BreedingPage from './BreedingPage'
import GeneticsPage from './GeneticsPage'
import OptimizerPage from './OptimizerPage'
import ProfitPage from './ProfitPage'
import JobPage from './JobPage'
import PricesPage from './PricesPage'
import GuidePage from './GuidePage'
import SettingsPage from './SettingsPage'

export interface PageDef {
  id: string
  title: string
  icon: string
  section: 'Piloter' | 'Simuler' | 'Économie' | 'Aide'
  description: string
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
  { id: 'metier', title: 'Métier Éleveur', icon: '🛠️', section: 'Économie', description: 'XP, crafts et coûts.', component: JobPage },
  { id: 'prix', title: 'Prix', icon: '🏷️', section: 'Économie', description: 'Prix HDV et ressources.', component: PricesPage },
  { id: 'guide', title: 'Guide & règles', icon: '📖', section: 'Aide', description: 'Mécaniques de l\'élevage 3.5+.', component: GuidePage },
  { id: 'reglages', title: 'Réglages', icon: '⚙️', section: 'Aide', description: 'Profil, sauvegarde, import/export.', component: SettingsPage },
]
