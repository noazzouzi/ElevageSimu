// Hooks des modes de rentabilité : contraintes du profil ouvert (réglages, prix et marché du serveur),
// clé des hypothèses et mode actif résolu (stratégie de la dernière comparaison enregistrée).
// Utilisés par la page Modes, l'accueil et le plan.
import { useMemo, useSyncExternalStore } from 'react'
import { modeContextKey, resolveActiveMode, type ActiveMode, type ModeProfile, type RoutineProfile } from '../domain/modes'
import { useModeResults, useModePlan } from '../store/modeResults'
import { usePriceContext, usePrices } from '../store/prices'
import { profileKey, useActiveServer } from '../store/profiles'
import { useRules, useSettings } from '../store/settings'

// ---- Préférences de la page Modes (profil ouvert) : précision du calcul, prix « HDV mixte » comptés.

export type ModesPrecision = 'rapide' | 'fine'

export interface ModesUiPrefs {
  precision: ModesPrecision
  /** Compter les prix « HDV mixte » des objets-montures (vente classée avec les autres modes). */
  trustMixed: boolean
  /** Compter les génétons (valeur estimée des parchemins revendus) dans le bénéfice ; faux = « sans génétons ». */
  includeGenetons: boolean
}

export const MODES_UI_KEY = 'modes-ui'

const prefListeners = new Set<() => void>()
let prefCache: { raw: string | null; value: ModesUiPrefs } | null = null

/** Préférences de la page Modes (lecture tolérante : défaut si absentes ou illisibles). */
export function loadModesUiPrefs(): ModesUiPrefs {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(profileKey(MODES_UI_KEY))
  } catch {
    raw = null
  }
  if (prefCache && prefCache.raw === raw) return prefCache.value
  let value: ModesUiPrefs = { precision: 'rapide', trustMixed: false, includeGenetons: true }
  try {
    const v = raw ? (JSON.parse(raw) as Partial<ModesUiPrefs>) : null
    value = { precision: v?.precision === 'fine' ? 'fine' : 'rapide', trustMixed: v?.trustMixed === true, includeGenetons: v?.includeGenetons !== false }
  } catch {
    // préférence illisible : valeurs par défaut
  }
  prefCache = { raw, value }
  return value
}

/** Enregistre une partie des préférences (fusion) et prévient les composants abonnés. */
export function saveModesUiPrefs(patch: Partial<ModesUiPrefs>): void {
  const next = { ...loadModesUiPrefs(), ...patch }
  try {
    localStorage.setItem(profileKey(MODES_UI_KEY), JSON.stringify(next))
  } catch {
    // préférence non enregistrée : gardée en mémoire pour cette visite
    prefCache = { raw: prefCache?.raw ?? null, value: next }
  }
  for (const f of prefListeners) f()
}

function subscribePrefs(f: () => void): () => void {
  prefListeners.add(f)
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === profileKey(MODES_UI_KEY)) f()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    prefListeners.delete(f)
    window.removeEventListener('storage', onStorage)
  }
}

/** Préférences de la page Modes (réactives). */
export function useModesUiPrefs(): ModesUiPrefs {
  return useSyncExternalStore(subscribePrefs, loadModesUiPrefs, loadModesUiPrefs)
}

/** Contraintes du profil ouvert pour simuler les modes (valeurs stables entre deux rendus). */
export function useModeProfile(): ModeProfile {
  const jobLevel = useSettings((s) => s.jobLevel)
  const hoursPerDay = useSettings((s) => s.hoursPerDay)
  const accounts = useSettings((s) => s.accounts)
  const saleTax = useSettings((s) => s.saleTax)
  const family = useSettings((s) => s.family)
  const parentTargetLevel = useSettings((s) => s.parentTargetLevel)
  const preferredTier = useSettings((s) => s.preferredTier)
  const useOptimakina = useSettings((s) => s.useOptimakina)
  const goalSpeciesId = useSettings((s) => s.goalSpeciesId)
  const useDefaults = useSettings((s) => s.useDefaultPrices)
  const rules = useRules()
  const ctx = usePriceContext()
  const mountOverrides = usePrices((s) => s.mounts)
  const generationOverrides = usePrices((s) => s.generations)
  const genetonValue = usePrices((s) => s.genetonValue)
  const maxMarketShare = useActiveServer().maxMarketShare
  const { trustMixed, includeGenetons } = useModesUiPrefs()
  return useMemo(
    () => ({
      jobLevel,
      hoursPerDay,
      characters: accounts,
      rules,
      family,
      parentTargetLevel,
      preferredTier,
      useOptimakina,
      goalSpeciesId,
      prices: {
        ctx,
        saleTax,
        maxMarketShare,
        genetonValue,
        mountPrices: { mountOverrides, generationOverrides, useDefaults, market: ctx.market },
        trustMixedMountPrices: trustMixed,
        ...(includeGenetons ? {} : { includeGenetons: false }),
      },
    }),
    [jobLevel, hoursPerDay, accounts, rules, family, parentTargetLevel, preferredTier, useOptimakina, goalSpeciesId, ctx, saleTax, maxMarketShare, genetonValue, mountOverrides, generationOverrides, useDefaults, trustMixed, includeGenetons],
  )
}

/** Clé des hypothèses actuelles (un calcul enregistré avec une autre clé est « à recalculer »). */
export function useModeContextKey(profile: ModeProfile): string {
  const serverId = useActiveServer().id
  return useMemo(() => modeContextKey(profile, { serverId }), [profile, serverId])
}

/**
 * Mode actif du profil, résolu avec les résultats enregistrés (`auto` → meilleur mode calculé) ;
 * `routine` : contraintes du jour (places libres, personnages) pour la routine.
 */
export function useActiveMode(routine?: RoutineProfile): ActiveMode {
  const requested = useSettings((s) => s.mode)
  const family = useSettings((s) => s.family)
  const results = useModeResults((s) => s.results)
  const pinned = useModePlan((s) => s.plan)
  const profile = useModeProfile()
  const contextKey = useModeContextKey(profile)
  const characters = routine?.characters
  const freeSlots = routine?.freeSlots
  const share = routine?.maxMarketShare ?? profile.prices.maxMarketShare
  return useMemo(
    () => resolveActiveMode(requested, results, { contextKey, family, pinned, routine: { characters: characters ?? profile.characters, freeSlots, maxMarketShare: share } }),
    [requested, results, contextKey, family, pinned, characters, freeSlots, share, profile.characters],
  )
}
