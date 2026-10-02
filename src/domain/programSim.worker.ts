// Web Worker du simulateur de programme (programSim.ts) : les tirages Monte-Carlo tournent hors du
// fil principal pour garder l'interface fluide.
//
// Création côté page (Vite) :
//   new Worker(new URL('../../domain/programSim.worker.ts', import.meta.url), { type: 'module' })
// Protocole : la page envoie `{ type: 'run', requestId, jobs }` ; le worker répond par des messages
// `progress` (limités à ~20 par seconde), un `result` par stratégie, puis `done` (ou `error`).
// Pour annuler, la page termine le worker (`worker.terminate()`) : le calcul est synchrone.
import { runStrategies, type StrategyJob, type StrategyJobResult } from './programSim'

export interface ProgramWorkerRunRequest {
  type: 'run'
  /** Identifiant choisi par la page, renvoyé dans chaque réponse. */
  requestId: number
  jobs: StrategyJob[]
}

export type ProgramWorkerRequest = ProgramWorkerRunRequest

export type ProgramWorkerMessage =
  | { type: 'progress'; requestId: number; done: number; total: number; jobId: string }
  | { type: 'result'; requestId: number; result: StrategyJobResult }
  | { type: 'done'; requestId: number; results: StrategyJobResult[]; durationMs: number }
  | { type: 'error'; requestId: number; message: string }

/** Intervalle minimal entre deux messages de progression (ms). */
export const PROGRESS_INTERVAL_MS = 50

/**
 * Traite une requête et publie les réponses via `post` (fonction pure vis-à-vis de l'environnement :
 * testable sans Worker).
 */
export function handleProgramRequest(req: ProgramWorkerRequest, post: (msg: ProgramWorkerMessage) => void, now: () => number = Date.now): void {
  if (!req || req.type !== 'run' || !Array.isArray(req.jobs)) {
    post({ type: 'error', requestId: req?.requestId ?? -1, message: 'Requête invalide pour le simulateur.' })
    return
  }
  const t0 = now()
  let last = -Infinity
  try {
    const results = runStrategies(req.jobs, {
      onProgress: (done, total, jobId) => {
        const t = now()
        if (done === total || t - last >= PROGRESS_INTERVAL_MS) {
          last = t
          post({ type: 'progress', requestId: req.requestId, done, total, jobId })
        }
      },
      onResult: (result) => post({ type: 'result', requestId: req.requestId, result }),
    })
    post({ type: 'done', requestId: req.requestId, results, durationMs: now() - t0 })
  } catch (e) {
    post({ type: 'error', requestId: req.requestId, message: e instanceof Error ? e.message : String(e) })
  }
}

// Enregistrement dans un vrai contexte de Worker seulement (l'import en test ne fait rien).
interface WorkerScope {
  WorkerGlobalScope?: unknown
  postMessage: (msg: ProgramWorkerMessage) => void
  addEventListener: (type: 'message', listener: (e: MessageEvent<ProgramWorkerRequest>) => void) => void
}

const scope = globalThis as unknown as WorkerScope
if (typeof scope.WorkerGlobalScope !== 'undefined' && typeof scope.addEventListener === 'function') {
  scope.addEventListener('message', (e) => handleProgramRequest(e.data, (msg) => scope.postMessage(msg)))
}
