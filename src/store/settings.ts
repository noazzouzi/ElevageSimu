// Réglages du joueur (persistés dans le navigateur).
// Type, valeurs par défaut, migration et normalisation : src/store/schema.ts (pur, partagé avec l'import
// de sauvegarde). Persistance sûre et synchronisation entre onglets : src/store/persistence.ts.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getRuleset } from '../domain/rules'
import { persistOptions, syncAcrossTabs } from './persistence'
import { DEFAULT_SETTINGS, STORE_KEYS, migrateSettings, sanitizeSettings, type Settings } from './schema'
// Synchronisation entre onglets des autres stores persistés (enclos, plans, avancement).
import './sync'

export { DEFAULT_SETTINGS, SETTINGS_BOUNDS, type Goal, type Settings } from './schema'

interface SettingsStore extends Settings {
  /** Modifie des réglages ; changer `jobLevel` met à jour `jobLevelUpdatedAt` (sauf s'il est fourni). */
  update: (patch: Partial<Settings>) => void
  /** Revient aux valeurs par défaut (le niveau d'Éleveur 1 est daté de maintenant). */
  reset: () => void
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) =>
        set((s) => {
          if (patch.jobLevel === undefined || patch.jobLevel === s.jobLevel || patch.jobLevelUpdatedAt !== undefined) return patch
          return { ...patch, jobLevelUpdatedAt: Date.now() }
        }),
      reset: () => set({ ...DEFAULT_SETTINGS, jobLevelUpdatedAt: Date.now() }),
    }),
    persistOptions<SettingsStore, Settings>({
      name: STORE_KEYS.settings,
      migrate: (state, from) => migrateSettings(state, from),
      sanitize: (state) => sanitizeSettings(state),
    }),
  ),
)
syncAcrossTabs(useSettings)

/** Règles du jeu actives. */
export function useRules() {
  const id = useSettings((s) => s.ruleset)
  return getRuleset(id)
}
