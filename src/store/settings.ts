// Réglages du joueur (persistés dans le navigateur, propres au profil ouvert).
// Type, valeurs par défaut, migration et normalisation : src/store/schema.ts (pur, partagé avec l'import
// de sauvegarde). Persistance sûre et synchronisation entre onglets : src/store/persistence.ts.
// Clé : « elevagesimu:p:<profil>:settings » (src/store/profiles.ts).
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getRuleset } from '../domain/rules'
import { persistOptions, syncAcrossTabs } from './persistence'
import { ACTIVE_SERVER_ID, STORE_KEYS, activeServer, useProfiles } from './profiles'
import { DEFAULT_SETTINGS, migrateSettings, sanitizeSettings, type Settings } from './schema'
// Synchronisation entre onglets des autres stores persistés (enclos, plans, avancement).
import './sync'

export { DEFAULT_SETTINGS, SETTINGS_BOUNDS, type Goal, type Settings } from './schema'

interface SettingsStore extends Settings {
  /**
   * Modifie des réglages ; changer `jobLevel` met à jour `jobLevelUpdatedAt` (sauf s'il est fourni).
   * `server` (libellé) renomme le serveur du profil ouvert (registre des profils) ; refusé si le nom est
   * déjà pris : le libellé reste alors celui du serveur.
   */
  update: (patch: Partial<Settings>) => void
  /** Revient aux valeurs par défaut (le niveau d'Éleveur 1 est daté de maintenant). */
  reset: () => void
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (input) => {
        let patch = input
        if (input.server !== undefined) {
          const { server, ...rest } = input
          patch = rest
          const name = server.trim()
          if (name && name !== activeServer().name) useProfiles.getState().renameServer(ACTIVE_SERVER_ID, name)
          patch = { ...patch, server: activeServer().name }
        }
        set((s) => {
          if (patch.jobLevel === undefined || patch.jobLevel === s.jobLevel || patch.jobLevelUpdatedAt !== undefined) return patch
          return { ...patch, jobLevelUpdatedAt: Date.now() }
        })
      },
      reset: () => set({ ...DEFAULT_SETTINGS, server: activeServer().name, jobLevelUpdatedAt: Date.now() }),
    }),
    persistOptions<SettingsStore, Settings>({
      name: STORE_KEYS.settings,
      migrate: (state, from) => migrateSettings(state, from),
      sanitize: (state) => sanitizeSettings(state),
    }),
  ),
)
syncAcrossTabs(useSettings)

/**
 * `settings.server` est un libellé dérivé du serveur du profil ouvert (compatibilité : anciennes pages,
 * export des prix). Recopié au chargement et à chaque renommage du serveur.
 */
function syncServerLabel() {
  const name = activeServer()?.name ?? ''
  if (useSettings.getState().server !== name) useSettings.setState({ server: name })
}
syncServerLabel()
useProfiles.subscribe((s, prev) => {
  if (s.registry !== prev.registry) syncServerLabel()
})

/** Règles du jeu actives. */
export function useRules() {
  const id = useSettings((s) => s.ruleset)
  return getRuleset(id)
}
