// Web Worker de l'estimateur d'investissement (investment.ts) : la recherche d'allocation lance quelques
// centaines de simulations de production (≈ 1 à 6 s), hors du fil principal.
//
// Création côté page (Vite) :
//   new Worker(new URL('../../domain/investment.worker.ts', import.meta.url), { type: 'module' })
// Protocole : la page envoie `{ type: 'plan', requestId, input }` ; le worker répond par des messages
// `progress` (au plus ~20 par seconde), puis `result` (ou `error`). Pour annuler : `worker.terminate()`.
// Sans Web Worker : `planInvestmentAsync` (investment.ts).
import { planInvestment, type InvestmentInput, type InvestmentResult } from './investment'
import type { ProgressInfo } from './production'

export type InvestmentWorkerRequest = { type: 'plan'; requestId: number; input: InvestmentInput }

export type InvestmentWorkerMessage =
  | { type: 'progress'; requestId: number; done: number; total: number; label: string }
  | { type: 'result'; requestId: number; result: InvestmentResult; durationMs: number }
  | { type: 'error'; requestId: number; message: string }

/** Intervalle minimal entre deux messages de progression (ms). */
export const INVESTMENT_PROGRESS_INTERVAL_MS = 50

/** Traite une requête et publie les réponses via `post` (testable sans Worker). */
export function handleInvestmentRequest(req: InvestmentWorkerRequest, post: (msg: InvestmentWorkerMessage) => void, now: () => number = Date.now): void {
  const requestId = req && typeof req.requestId === 'number' ? req.requestId : -1
  const t0 = now()
  let last = -Infinity
  const onProgress = (p: ProgressInfo) => {
    const t = now()
    if (p.done >= p.total || t - last >= INVESTMENT_PROGRESS_INTERVAL_MS) {
      last = t
      post({ type: 'progress', requestId, done: p.done, total: p.total, label: p.label })
    }
  }
  try {
    if (!req || typeof req !== 'object' || req.type !== 'plan' || !req.input) throw new Error('Requête invalide pour l’estimateur d’investissement.')
    const result = planInvestment(req.input, { onProgress })
    post({ type: 'result', requestId, result, durationMs: now() - t0 })
  } catch (e) {
    post({ type: 'error', requestId, message: e instanceof Error ? e.message : String(e) })
  }
}

// Enregistrement dans un vrai contexte de Worker seulement (l'import en test ne fait rien).
interface WorkerScope {
  WorkerGlobalScope?: unknown
  postMessage: (msg: InvestmentWorkerMessage) => void
  addEventListener: (type: 'message', listener: (e: MessageEvent<InvestmentWorkerRequest>) => void) => void
}

const scope = globalThis as unknown as WorkerScope
if (typeof scope.WorkerGlobalScope !== 'undefined' && typeof scope.addEventListener === 'function') {
  scope.addEventListener('message', (e) => handleInvestmentRequest(e.data, (msg) => scope.postMessage(msg)))
}
