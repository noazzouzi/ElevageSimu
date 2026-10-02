// Simulation Monte-Carlo de la stratégie conseillée vers l'objectif (programSim), partagée par le Plan
// d'élevage et l'accueil : un seul calcul par configuration (`programConfigKey`), gardé en mémoire tant
// que l'application est ouverte, exécuté par tranches (`runStrategiesAsync`) pour ne pas figer la page.
// Les captures conseillées en sont tirées (advisor.withGoalSimulation) ; sans elle, l'accueil annonce le
// modèle analytique comme une borne haute.
import { useEffect, useSyncExternalStore } from 'react'
import { programConfigKey } from '../domain/advisor'
import { runStrategiesAsync, type ProgramConfig, type ProgramSummary } from '../domain/programSim'

export type GoalSimulationStatus = 'idle' | 'running' | 'done' | 'error'

interface Entry {
  status: Exclude<GoalSimulationStatus, 'idle'>
  progress: number
  summary: ProgramSummary | null
  error: string | null
}

/** Résultats gardés (les plus récents) : quelques objectifs ou réglages suffisent. */
const MAX_ENTRIES = 12
const cache = new Map<string, Entry>()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function put(key: string, entry: Entry) {
  cache.delete(key)
  cache.set(key, entry)
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  emit()
}

/** Lance la simulation de `cfg` si elle n'est ni en cours ni déjà faite (une erreur est retentée). */
export function ensureGoalSimulation(cfg: ProgramConfig): void {
  const key = programConfigKey(cfg)
  const hit = cache.get(key)
  if (hit && hit.status !== 'error') return
  put(key, { status: 'running', progress: 0, summary: null, error: null })
  runStrategiesAsync([{ id: 'objectif', label: 'Stratégie conseillée', config: cfg }], {
    onProgress: (done, total) => {
      const cur = cache.get(key)
      if (cur?.status === 'running') put(key, { ...cur, progress: total > 0 ? done / total : 0 })
    },
  })
    .then((res) => {
      if (res && res[0]) put(key, { status: 'done', progress: 1, summary: res[0].summary, error: null })
      else put(key, { status: 'error', progress: 0, summary: null, error: 'simulation interrompue' })
    })
    .catch((e: unknown) => put(key, { status: 'error', progress: 0, summary: null, error: e instanceof Error ? e.message : String(e) }))
}

/** Résultat déjà calculé pour `cfg` (sans lancer de calcul). */
export function cachedGoalSimulation(cfg: ProgramConfig | null): ProgramSummary | null {
  return cfg ? (cache.get(programConfigKey(cfg))?.summary ?? null) : null
}

/**
 * Simulation de la configuration `cfg` (null = aucune) : lancée au besoin, partagée entre les pages.
 * `summary` reste null pendant le calcul (≈ 0,1 à 0,3 s pour 24 tirages).
 */
export function useGoalSimulation(cfg: ProgramConfig | null): { summary: ProgramSummary | null; status: GoalSimulationStatus; progress: number; error: string | null } {
  const key = cfg ? programConfigKey(cfg) : null
  const entry = useSyncExternalStore(subscribe, () => (key ? cache.get(key) : undefined))
  // La clé résume toute la configuration : la relancer à chaque nouvel objet `cfg` serait inutile.
  useEffect(() => {
    if (cfg) ensureGoalSimulation(cfg)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (!entry) return { summary: null, status: cfg ? 'running' : 'idle', progress: 0, error: null }
  return { summary: entry.summary, status: entry.status, progress: entry.progress, error: entry.error }
}
