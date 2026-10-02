// Réglages du conseiller (sous-ensemble de `useSettings`), mémorisés champ par champ : la même référence
// tant qu'aucun de ces réglages ne change. Partagé par l'accueil et Mes montures pour que les sorts des
// montures soient calculés avec exactement les mêmes entrées (revue UX2-05).
import { useMemo } from 'react'
import type { AdvisorSettings } from '../domain/advisor'
import { useSettings } from '../store/settings'

export function useAdvisorSettings(): AdvisorSettings {
  const jobLevel = useSettings((s) => s.jobLevel)
  const family = useSettings((s) => s.family)
  const goalSpeciesId = useSettings((s) => s.goalSpeciesId)
  const goal = useSettings((s) => s.goal)
  const preferredTier = useSettings((s) => s.preferredTier)
  const xpFiller = useSettings((s) => s.xpFiller)
  const parentTargetLevel = useSettings((s) => s.parentTargetLevel)
  const useOptimakina = useSettings((s) => s.useOptimakina)
  const saleTax = useSettings((s) => s.saleTax)
  const useDefaultPrices = useSettings((s) => s.useDefaultPrices)
  const accounts = useSettings((s) => s.accounts)
  const hoursPerDay = useSettings((s) => s.hoursPerDay)
  const checkIntervalMinutes = useSettings((s) => s.checkIntervalMinutes)
  const almanaxGaugeDoubling = useSettings((s) => s.almanaxGaugeDoubling)
  return useMemo(
    () => ({ jobLevel, family, goalSpeciesId, goal, preferredTier, xpFiller, parentTargetLevel, useOptimakina, saleTax, useDefaultPrices, accounts, hoursPerDay, checkIntervalMinutes, almanaxGaugeDoubling }),
    [jobLevel, family, goalSpeciesId, goal, preferredTier, xpFiller, parentTargetLevel, useOptimakina, saleTax, useDefaultPrices, accounts, hoursPerDay, checkIntervalMinutes, almanaxGaugeDoubling],
  )
}
