// Web Worker du moteur de production (production.ts) : simulations, optimisation d'un mode et
// comparaison des modes tournent hors du fil principal (une grille complète prend quelques secondes).
//
// Création côté page (Vite) :
//   new Worker(new URL('../../domain/production.worker.ts', import.meta.url), { type: 'module' })
// Protocole : la page envoie une requête `simulate` | `optimize` | `compare` avec un `requestId` ; le
// worker répond par des messages `progress` (au plus ~20 par seconde), puis `summary` | `optimization` |
// `comparison` (ou `error`). Pour annuler, la page termine le worker (`worker.terminate()`).
// Sans Web Worker : `runProductionAsync`, `optimizeModeAsync`, `compareModesAsync` (production.ts).
import {
  compareModes,
  optimizeMode,
  runProduction,
  type ModeComparison,
  type ModeOptimization,
  type OptimizeOptions,
  type ProductionConfig,
  type ProductionMode,
  type ProductionSummary,
  type ProfileProductionContext,
  type ProgressInfo,
} from './production'

export type ProductionWorkerRequest =
  | { type: 'simulate'; requestId: number; config: ProductionConfig; runs?: number; seed?: number }
  | { type: 'optimize'; requestId: number; mode: ProductionMode; base: ProductionConfig; options?: OptimizeOptions }
  | { type: 'compare'; requestId: number; context: ProfileProductionContext }

export type ProductionWorkerMessage =
  | { type: 'progress'; requestId: number; done: number; total: number; label: string }
  | { type: 'summary'; requestId: number; summary: ProductionSummary; durationMs: number }
  | { type: 'optimization'; requestId: number; result: ModeOptimization; durationMs: number }
  | { type: 'comparison'; requestId: number; result: ModeComparison; durationMs: number }
  | { type: 'error'; requestId: number; message: string }

/** Intervalle minimal entre deux messages de progression (ms). */
export const PRODUCTION_PROGRESS_INTERVAL_MS = 50

/**
 * Traite une requête et publie les réponses via `post` (pur vis-à-vis de l'environnement : testable
 * sans Worker).
 */
export function handleProductionRequest(req: ProductionWorkerRequest, post: (msg: ProductionWorkerMessage) => void, now: () => number = Date.now): void {
  const requestId = req && typeof req.requestId === 'number' ? req.requestId : -1
  const t0 = now()
  let last = -Infinity
  const onProgress = (p: ProgressInfo) => {
    const t = now()
    if (p.done >= p.total || t - last >= PRODUCTION_PROGRESS_INTERVAL_MS) {
      last = t
      post({ type: 'progress', requestId, done: p.done, total: p.total, label: p.label })
    }
  }
  try {
    if (!req || typeof req !== 'object') throw new Error('Requête invalide pour le moteur de production.')
    if (req.type === 'simulate') {
      if (!req.config) throw new Error('Configuration de production manquante.')
      const summary = runProduction(req.config, { runs: req.runs, seed: req.seed, onProgress: (done, total) => onProgress({ done, total, label: 'Simulation' }) })
      post({ type: 'summary', requestId, summary, durationMs: now() - t0 })
      return
    }
    if (req.type === 'optimize') {
      if (!req.base || !req.mode) throw new Error('Mode ou configuration manquants.')
      const result = optimizeMode(req.mode, req.base, { ...req.options, onProgress })
      post({ type: 'optimization', requestId, result, durationMs: now() - t0 })
      return
    }
    if (req.type === 'compare') {
      if (!req.context) throw new Error('Contexte du profil manquant.')
      const result = compareModes(req.context, { onProgress })
      post({ type: 'comparison', requestId, result, durationMs: now() - t0 })
      return
    }
    throw new Error('Requête invalide pour le moteur de production.')
  } catch (e) {
    post({ type: 'error', requestId, message: e instanceof Error ? e.message : String(e) })
  }
}

// Enregistrement dans un vrai contexte de Worker seulement (l'import en test ne fait rien).
interface WorkerScope {
  WorkerGlobalScope?: unknown
  postMessage: (msg: ProductionWorkerMessage) => void
  addEventListener: (type: 'message', listener: (e: MessageEvent<ProductionWorkerRequest>) => void) => void
}

const scope = globalThis as unknown as WorkerScope
if (typeof scope.WorkerGlobalScope !== 'undefined' && typeof scope.addEventListener === 'function') {
  scope.addEventListener('message', (e) => handleProductionRequest(e.data, (msg) => scope.postMessage(msg)))
}
