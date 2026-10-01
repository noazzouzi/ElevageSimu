// Registre des pages de l'application (navigation latérale).
import type { ComponentType } from 'react'
import { Placeholder } from './Placeholder'

export interface PageDef {
  id: string
  title: string
  icon: string
  section: 'Piloter' | 'Simuler' | 'Économie' | 'Aide'
  description: string
  component: ComponentType
}

const ph = (title: string) => () => <Placeholder title={title} />

export const PAGES: PageDef[] = [
  { id: 'accueil', title: 'Que faire maintenant ?', icon: '🏠', section: 'Piloter', description: 'Les prochaines actions, minutées.', component: ph('Que faire maintenant ?') },
  { id: 'plan', title: "Plan d'élevage", icon: '🗺️', section: 'Piloter', description: 'Objectif, étapes et calendrier.', component: ph("Plan d'élevage") },
  { id: 'enclos', title: 'Enclos', icon: '🌾', section: 'Piloter', description: 'Jauges, placement et minuteurs.', component: ph('Enclos') },
  { id: 'montures', title: 'Mes montures', icon: '🐎', section: 'Piloter', description: 'Étable, enclos et inventaire.', component: ph('Mes montures') },
  { id: 'accouplement', title: 'Accouplement', icon: '🥚', section: 'Simuler', description: 'Probabilités, génétons, makinas.', component: ph('Accouplement') },
  { id: 'genetique', title: 'Génétique', icon: '🧬', section: 'Simuler', description: 'Arbres et croisements.', component: ph('Génétique') },
  { id: 'optimiseur', title: 'Optimiseur', icon: '📈', section: 'Simuler', description: 'Comparer les stratégies.', component: ph('Optimiseur') },
  { id: 'rentabilite', title: 'Rentabilité', icon: '💰', section: 'Économie', description: 'Coûts, revenus, bénéfice.', component: ph('Rentabilité') },
  { id: 'metier', title: 'Métier Éleveur', icon: '🛠️', section: 'Économie', description: 'XP, crafts et coûts.', component: ph('Métier Éleveur') },
  { id: 'prix', title: 'Prix', icon: '🏷️', section: 'Économie', description: 'Prix HDV et ressources.', component: ph('Prix') },
  { id: 'guide', title: 'Guide & règles', icon: '📖', section: 'Aide', description: "Mécaniques de l'élevage 3.5+.", component: ph('Guide & règles') },
  { id: 'reglages', title: 'Réglages', icon: '⚙️', section: 'Aide', description: 'Profil, sauvegarde, import/export.', component: ph('Réglages') },
]
