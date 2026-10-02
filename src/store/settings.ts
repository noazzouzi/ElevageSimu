// Réglages du joueur (persistés dans le navigateur).
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getRuleset } from '../domain/rules'
import type { FamilyId, FuelTier, RulesetId } from '../domain/types'

export type Goal = 'profit' | 'succes' | 'mixte'

export interface Settings {
  /** Version des règles du jeu (3.6 = live). */
  ruleset: RulesetId
  /** Niveau du métier d'Éleveur (1 … 200). */
  jobLevel: number
  /** Famille travaillée en priorité. */
  family: FamilyId
  /** Monture visée (id d'espèce) pour le plan d'élevage, ou null. */
  goalSpeciesId: number | null
  /** Utiliser les prix par défaut issus de la recherche quand aucun prix n'est saisi. */
  useDefaultPrices: boolean
  /** Serveur de jeu (pour se souvenir des prix). */
  server: string
  /** Objectif principal : kamas, succès de générations, ou les deux. */
  goal: Goal
  /** Tier de jauge que le joueur accepte d'entretenir (1 = économique … 4 = rapide). */
  preferredTier: FuelTier
  /** Activer la Mangeoire en complément quand c'est possible. */
  xpFiller: boolean
  /** Nombre de personnages pour les captures (multicompte). */
  accounts: number
  /** Heures de jeu disponibles par jour (pour les plannings). */
  hoursPerDay: number
  /** Intervalle minimum (min) entre deux passages devant les enclos. */
  checkIntervalMinutes: number
  /** Niveau visé pour les parents avant accouplement (recherche : ~40 est le meilleur compromis). */
  parentTargetLevel: number
  /** Utiliser une Optimakina dès que la génération cible le justifie. */
  useOptimakina: boolean
  /** Taux de taxe HDV appliqué aux ventes (ex. 0.02). */
  saleTax: number
}

export const DEFAULT_SETTINGS: Settings = {
  ruleset: '3.6',
  jobLevel: 1,
  family: 'muldo',
  goalSpeciesId: null,
  useDefaultPrices: true,
  server: '',
  goal: 'profit',
  preferredTier: 2,
  xpFiller: true,
  accounts: 1,
  hoursPerDay: 3,
  checkIntervalMinutes: 60,
  parentTargetLevel: 40,
  useOptimakina: true,
  saleTax: 0.02,
}

interface SettingsStore extends Settings {
  update: (patch: Partial<Settings>) => void
  reset: () => void
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set(patch),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    { name: 'elevagesimu:settings', version: 2, migrate: (state) => ({ ...DEFAULT_SETTINGS, ...(state as Partial<Settings>) }) },
  ),
)

/** Règles du jeu actives. */
export function useRules() {
  const id = useSettings((s) => s.ruleset)
  return getRuleset(id)
}
