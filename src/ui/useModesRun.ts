// Calcul de la comparaison des modes, indépendant de la page (revue UX2-18) : le Web Worker et sa
// progression vivent ici, au niveau du module, et non dans la page Modes. Quitter la page pendant le
// calcul ne le perd plus : il continue en arrière-plan et ses résultats sont enregistrés pour le profil
// (`useModeResults.save`) quelle que soit la page affichée ; la page Modes ne fait que s'abonner.
import { create } from 'zustand'
import { modeConfig, modeProfileContext, outcomeFromSummary, storeModeResults, type ModeOutcome, type ModeProfile } from '../domain/modes'
import { compareModesAsync, runProductionAsync, strategyLabel, type ModeComparison, type ProductionSummary } from '../domain/production'
import type { ProductionWorkerMessage, ProductionWorkerRequest } from '../domain/production.worker'
import { useModeResults } from '../store/modeResults'
import type { ModesPrecision } from './useModes'

export type ModesRunEngine = 'worker' | 'main'

export interface ModesRunProgress {
  done: number
  total: number
  label: string
  engine: ModesRunEngine
}

/** Tirages des stratégies retenues (graines indépendantes du tri) selon la précision. */
export const MODES_RUNS: Record<ModesPrecision, number> = { rapide: 8, fine: 12 }

interface ModesRunState {
  /** Calcul en cours (null sinon). */
  progress: ModesRunProgress | null
  /** Début du calcul en cours. */
  startedAt: number | null
  precision: ModesPrecision | null
  error: string | null
  /** Résultats calculés mais non enregistrés (stockage plein). */
  saveFailed: boolean
  /** Fin du dernier calcul (enregistré ou non), pour le message « calcul terminé ». */
  finishedAt: number | null
}

export const useModesRun = create<ModesRunState>()(() => ({ progress: null, startedAt: null, precision: null, error: null, saveFailed: false, finishedAt: null }))

let worker: Worker | null = null
let requestSeq = 0

function stopWorker(): void {
  worker?.terminate()
  worker = null
}

/** Configuration de la progression (objectif du profil) simulée à côté de la comparaison. */
function progressionOutcome(summary: ProductionSummary): ModeOutcome {
  const c = summary.config
  const label = strategyLabel('progression', { targetGeneration: summary.plan.targetGeneration, parentLevel: c.parentLevel, optimakina: c.optimakina, tier: c.tier, mateBeforeExtract: true })
  return outcomeFromSummary('progression', summary, label)
}

/**
 * Lance (ou relance) la comparaison des modes du profil ouvert : Web Worker, repli sur le fil principal.
 * Les résultats sont enregistrés à la fin, même si la page Modes a été quittée entre-temps.
 */
export function startModesRun(profile: ModeProfile, opts: { precision: ModesPrecision; serverId: string }): void {
  stopWorker()
  const requestId = ++requestSeq
  const quick = opts.precision === 'rapide'
  const runs = MODES_RUNS[opts.precision]
  const context = modeProfileContext(profile, { quick, runs })
  const progCfg = modeConfig('progression', profile)
  const current = () => requestSeq === requestId
  const set = (patch: Partial<ModesRunState>) => {
    if (current()) useModesRun.setState(patch)
  }
  useModesRun.setState({ progress: { done: 0, total: 1, label: 'Préparation', engine: 'worker' }, startedAt: Date.now(), precision: opts.precision, error: null, saveFailed: false })
  const finish = (cmp: ModeComparison, prog: ProductionSummary | null) => {
    if (!current()) return
    const extra = prog ? [progressionOutcome(prog)] : []
    const rec = storeModeResults(cmp, profile, { computedAt: Date.now(), quick, serverId: opts.serverId, extra })
    const ok = useModeResults.getState().save(rec)
    set({ progress: null, saveFailed: !ok, finishedAt: Date.now(), startedAt: null })
  }
  const fail = (message: string) => set({ error: message, progress: null, startedAt: null })
  const fallback = () => {
    set({ progress: { done: 0, total: 1, label: 'Préparation', engine: 'main' } })
    const stop = () => !current()
    compareModesAsync(context, { onProgress: (p) => !stop() && set({ progress: { ...p, engine: 'main' } }), shouldStop: stop })
      .then(async (cmp) => {
        if (!cmp) return
        const prog = progCfg ? await runProductionAsync(progCfg, { runs, shouldStop: stop }).catch(() => null) : null
        finish(cmp, prog)
      })
      .catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
  }
  let w: Worker | null = null
  try {
    if (typeof Worker !== 'undefined') w = new Worker(new URL('../domain/production.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    w = null
  }
  if (!w) {
    fallback()
    return
  }
  worker = w
  let comparison: ModeComparison | null = null
  w.onmessage = (e: MessageEvent<ProductionWorkerMessage>) => {
    const msg = e.data
    if (msg.requestId !== requestId || !current()) return
    if (msg.type === 'progress') set({ progress: { done: msg.done, total: msg.total, label: msg.label, engine: 'worker' } })
    else if (msg.type === 'comparison') {
      comparison = msg.result
      if (progCfg) {
        set({ progress: { done: 0, total: runs, label: 'Progression (objectif du profil)', engine: 'worker' } })
        w?.postMessage({ type: 'simulate', requestId, config: progCfg, runs } satisfies ProductionWorkerRequest)
      } else {
        stopWorker()
        finish(comparison, null)
      }
    } else if (msg.type === 'summary') {
      stopWorker()
      if (comparison) finish(comparison, msg.summary)
    } else if (msg.type === 'error') {
      stopWorker()
      // La progression est facultative : la comparaison reste valable si elle échoue.
      if (comparison) finish(comparison, null)
      else fail(msg.message)
    }
  }
  w.onerror = (ev) => {
    // Worker non pris en charge (module workers, CSP…) : on recommence sur le fil principal.
    ev.preventDefault()
    stopWorker()
    if (current()) fallback()
  }
  w.postMessage({ type: 'compare', requestId, context } satisfies ProductionWorkerRequest)
}

/** Annule le calcul en cours (bouton « Annuler ») : rien n'est enregistré. */
export function cancelModesRun(): void {
  requestSeq += 1
  stopWorker()
  useModesRun.setState({ progress: null, startedAt: null })
}
