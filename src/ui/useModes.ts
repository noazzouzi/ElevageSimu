// Hooks des modes de rentabilité : contraintes du profil ouvert (réglages, prix et marché du serveur),
// clé des hypothèses et mode actif résolu (stratégie de la dernière comparaison enregistrée).
// Utilisés par la page Modes, l'accueil et le plan.
import { useMemo } from 'react'
import { modeContextKey, resolveActiveMode, type ActiveMode, type ModeProfile, type RoutineProfile } from '../domain/modes'
import { useModeResults } from '../store/modeResults'
import { usePriceContext, usePrices } from '../store/prices'
import { useActiveServer } from '../store/profiles'
import { useRules, useSettings } from '../store/settings'

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
      },
    }),
    [jobLevel, hoursPerDay, accounts, rules, family, parentTargetLevel, preferredTier, useOptimakina, goalSpeciesId, ctx, saleTax, maxMarketShare, genetonValue, mountOverrides, generationOverrides, useDefaults],
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
  const profile = useModeProfile()
  const contextKey = useModeContextKey(profile)
  const characters = routine?.characters
  const freeSlots = routine?.freeSlots
  const share = routine?.maxMarketShare ?? profile.prices.maxMarketShare
  return useMemo(
    () => resolveActiveMode(requested, results, { contextKey, family, routine: { characters: characters ?? profile.characters, freeSlots, maxMarketShare: share } }),
    [requested, results, contextKey, family, characters, freeSlots, share, profile.characters],
  )
}
