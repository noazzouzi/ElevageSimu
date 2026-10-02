// Page « Investissement » (section Économie) : pour un budget (ex. 20 M), plan d'action daté pour être
// rentable le plus vite possible — allocation (métier, stock de départ, palier, mode), courbe de
// trésorerie et point mort, feuille de route, liste de courses du jour 0, plan jour par jour,
// alternatives, sensibilité, risques. Logique : src/domain/investment.ts (calcul dans un Web Worker,
// investment.worker.ts ; repli sur le fil principal). Spécification : docs/SPEC-v2.md §5.
// Adresse : #/investissement?mode=rush-corne&budget=20000000&horizon=60
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { FAMILIES } from '../../data'
import { isoDay } from '../../domain/almanax'
import type { MountPriceContext } from '../../domain/economy'
import {
  BUDGET_PRESETS,
  DEFAULT_INVESTMENT_LEVERS,
  HORIZON_PRESETS,
  INVESTMENT_MODE_IDS,
  LEVER_LABELS,
  MAX_HORIZON_DAYS,
  MIN_HORIZON_DAYS,
  investmentModeLabel,
  investmentShoppingText,
  planInvestmentAsync,
  type AlternativeRow,
  type CashFlowPoint,
  type InvestmentAction,
  type InvestmentActionKind,
  type InvestmentEvaluation,
  type InvestmentInput,
  type InvestmentLevers,
  type InvestmentResult,
  type InvestmentRisk,
  type ProfitBound,
  type RoadmapMilestone,
  type SensitivityRow,
  type ShoppingItem,
} from '../../domain/investment'
import type { InvestmentWorkerMessage, InvestmentWorkerRequest } from '../../domain/investment.worker'
import { frenchDay } from '../../domain/market'
import { PRICE_ORIGIN_LABELS, type PriceOrigin } from '../../domain/pricing'
import type { ProfitModeId } from '../../domain/production'
import { jobLevelFromXp, jobXpForLevel } from '../../domain/xp'
import { formatKamas, formatNumber, formatPercent } from '../../lib/format'
import { journalJobXp, useJournal } from '../../store/journal'
import { usePriceContext, usePrices } from '../../store/prices'
import { profileKey, useActiveProfile, useActiveServer } from '../../store/profiles'
import { useRules, useSettings } from '../../store/settings'
import { Badge, Callout, Card, NumberField, PageHeader, Progress, SelectField, Stat } from '../components'
import { href, useRoute } from '../router'
import './InvestmentPage.css'

// ---------- Préférences (par profil) ----------

interface Prefs {
  budget: number
  horizonDays: number
  mode: ProfitModeId
  reserve: number
  levers: InvestmentLevers
  onlyFamily: boolean
}

const STORAGE_KEY = profileKey('investissement')
const DEFAULT_PREFS: Prefs = { budget: 20_000_000, horizonDays: 60, mode: 'auto', reserve: 2_000_000, levers: DEFAULT_INVESTMENT_LEVERS, onlyFamily: false }
const MAX_BUDGET = 100_000_000_000

const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const isMode = (v: unknown): v is ProfitModeId => typeof v === 'string' && (INVESTMENT_MODE_IDS as string[]).includes(v)

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Record<keyof Prefs, unknown>> | null
    if (!raw || typeof raw !== 'object') return DEFAULT_PREFS
    const levers = { ...DEFAULT_INVESTMENT_LEVERS }
    if (raw.levers && typeof raw.levers === 'object')
      for (const k of Object.keys(levers) as (keyof InvestmentLevers)[]) {
        const v = (raw.levers as Record<string, unknown>)[k]
        if (typeof v === 'boolean') levers[k] = v
      }
    return {
      budget: isNum(raw.budget, 0, MAX_BUDGET) ? raw.budget : DEFAULT_PREFS.budget,
      horizonDays: isNum(raw.horizonDays, MIN_HORIZON_DAYS, MAX_HORIZON_DAYS) ? Math.round(raw.horizonDays) : DEFAULT_PREFS.horizonDays,
      mode: isMode(raw.mode) ? raw.mode : DEFAULT_PREFS.mode,
      reserve: isNum(raw.reserve, 0, MAX_BUDGET) ? raw.reserve : DEFAULT_PREFS.reserve,
      levers,
      onlyFamily: typeof raw.onlyFamily === 'boolean' ? raw.onlyFamily : false,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(p: Prefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    // Stockage indisponible : préférences gardées pour la session seulement.
  }
}

/** Paramètres d'adresse (?mode=, ?budget=, ?horizon=, ?reserve=) appliqués aux préférences. */
function withRouteParams(p: Prefs, params: URLSearchParams): Prefs {
  const out = { ...p }
  const mode = params.get('mode')
  if (isMode(mode)) out.mode = mode
  const budget = Number(params.get('budget'))
  if (params.has('budget') && isNum(budget, 0, MAX_BUDGET)) {
    out.budget = Math.round(budget)
    if (!params.has('reserve')) out.reserve = Math.min(out.reserve, Math.round(out.budget * 0.1))
  }
  const horizon = Number(params.get('horizon'))
  if (params.has('horizon') && isNum(horizon, MIN_HORIZON_DAYS, MAX_HORIZON_DAYS)) out.horizonDays = Math.round(horizon)
  const reserve = Number(params.get('reserve'))
  if (params.has('reserve') && isNum(reserve, 0, MAX_BUDGET)) out.reserve = Math.round(reserve)
  out.reserve = Math.min(out.reserve, out.budget)
  return out
}

// ---------- Formatage ----------

const k = (v: number | null | undefined) => formatKamas(v, true)
const BOUND_PREFIX: Record<ProfitBound, string> = { exact: '', 'borne-haute': '≤ ', 'borne-basse': '≥ ', inconnu: '≈ ' }
const BOUND_HINT: Record<ProfitBound, string> = {
  exact: '',
  'borne-haute': 'un coût n’a pas de prix : bénéfice au plus',
  'borne-basse': 'un revenu n’a pas de prix : bénéfice au moins',
  inconnu: 'des coûts et des revenus n’ont pas de prix : ordre de grandeur seulement',
}

function signedK(v: number): string {
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${k(Math.abs(v))}`
}

function dayLabel(day: number | null, estimated = false, simDays?: number): string {
  if (day === null) return simDays ? `au-delà de ${simDays} j` : 'non atteint'
  return `${estimated ? '≈ ' : ''}jour ${day}${estimated ? ' (extrapolé)' : ''}`
}

/** Valeur d'axe compacte : 12 M, 350 k, −2 M. */
function axisK(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `${formatNumber(v / 1e9, 1)} Md`
  if (a >= 1e6) return `${formatNumber(v / 1e6, a >= 1e7 ? 0 : 1)} M`
  if (a >= 1e3) return `${formatNumber(v / 1e3, 0)} k`
  return formatNumber(v, 0)
}

function niceStep(range: number, ticks: number): number {
  const raw = Math.max(1, range) / Math.max(1, ticks)
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow
}

function useElementWidth<T extends HTMLElement>(fallback: number): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(Math.round(el.getBoundingClientRect().width) || fallback)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(Math.round(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fallback])
  return [ref, width]
}

// ---------- Page ----------

type Engine = 'worker' | 'main'

interface RunState {
  done: number
  total: number
  label: string
  engine: Engine
}

interface Outcome {
  key: string
  result: InvestmentResult
  engine: Engine
  durationMs: number
}

export default function InvestmentPage() {
  const route = useRoute()
  const routeKey = route.params.toString()
  const [prefs, setPrefsState] = useState<Prefs>(() => withRouteParams(loadPrefs(), route.params))
  const setPrefs = (patch: Partial<Prefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch }
      next.reserve = Math.min(next.reserve, next.budget)
      savePrefs(next)
      return next
    })
  // Paramètres d'adresse reçus pendant que la page est ouverte (lien depuis Modes, Accueil…).
  const [appliedRoute, setAppliedRoute] = useState(routeKey)
  if (appliedRoute !== routeKey) {
    setAppliedRoute(routeKey)
    setPrefsState((p) => withRouteParams(p, new URLSearchParams(routeKey)))
  }

  const settings = useSettings()
  const rules = useRules()
  const ctx = usePriceContext()
  const server = useActiveServer()
  const profile = useActiveProfile()
  const genetonValue = usePrices((s) => s.genetonValue)
  const mountOverrides = usePrices((s) => s.mounts)
  const generationOverrides = usePrices((s) => s.generations)
  const journal = useJournal((s) => s.entries)
  const journalXp = useMemo(() => journalJobXp(journal, settings.jobLevelUpdatedAt), [journal, settings.jobLevelUpdatedAt])
  const jobXpAbs = jobXpForLevel(settings.jobLevel) + journalXp.xp
  const jobLevel = Math.min(200, Math.max(settings.jobLevel, jobLevelFromXp(jobXpAbs)))
  const jobXpInLevel = Math.max(0, jobXpAbs - jobXpForLevel(jobLevel))

  const input: InvestmentInput = useMemo(() => {
    const mountPrices: MountPriceContext = { mountOverrides, generationOverrides, useDefaults: settings.useDefaultPrices, market: ctx.market }
    return {
      budget: prefs.budget,
      horizonDays: prefs.horizonDays,
      mode: prefs.mode,
      profile: {
        jobLevel,
        jobXp: jobXpInLevel,
        hoursPerDay: settings.hoursPerDay,
        characters: settings.accounts,
        rules,
        family: settings.family,
        onlyFamily: prefs.onlyFamily,
      },
      levers: prefs.levers,
      safetyReserve: Math.min(prefs.reserve, prefs.budget),
      prices: {
        ctx: { ...ctx, jobLevel },
        mountPrices,
        saleTax: settings.saleTax,
        maxMarketShare: server.maxMarketShare,
        genetonValue,
      },
      today: isoDay(Date.now()),
    }
  }, [prefs, jobLevel, jobXpInLevel, settings.hoursPerDay, settings.accounts, settings.family, settings.useDefaultPrices, settings.saleTax, rules, ctx, server.maxMarketShare, genetonValue, mountOverrides, generationOverrides])

  // Clé des entrées (le marché est résumé par sa date et sa taille).
  const inputKey = useMemo(
    () =>
      JSON.stringify({
        ...input,
        profile: { ...input.profile, rules: input.profile.rules.id },
        prices: {
          ...input.prices,
          ctx: { ...input.prices.ctx, market: input.prices.ctx.market ? [input.prices.ctx.market.exportDate, input.prices.ctx.market.stat, Object.keys(input.prices.ctx.market.rows).length] : null },
          mountPrices: input.prices.mountPrices ? { ...input.prices.mountPrices, market: null } : null,
        },
        today: null,
      }),
    [input],
  )

  // ---- Calcul (Web Worker, repli sur le fil principal)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [running, setRunning] = useState<RunState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const requestRef = useRef(0)

  const stopWorker = () => {
    workerRef.current?.terminate()
    workerRef.current = null
  }

  useEffect(
    () => () => {
      requestRef.current += 1
      workerRef.current?.terminate()
      workerRef.current = null
    },
    [],
  )

  const run = () => {
    stopWorker()
    const requestId = ++requestRef.current
    const key = inputKey
    const req = input
    const started = Date.now()
    setError(null)
    setRunning({ done: 0, total: 1, label: 'Préparation', engine: 'worker' })
    const finish = (result: InvestmentResult, engine: Engine, durationMs: number) => {
      if (requestRef.current !== requestId) return
      setOutcome({ key, result, engine, durationMs })
      setRunning(null)
    }
    const fail = (message: string) => {
      if (requestRef.current !== requestId) return
      setError(message)
      setRunning(null)
    }
    const fallback = () => {
      setRunning({ done: 0, total: 1, label: 'Préparation', engine: 'main' })
      planInvestmentAsync(req, {
        onProgress: (p) => {
          if (requestRef.current === requestId) setRunning({ done: p.done, total: p.total, label: p.label, engine: 'main' })
        },
        shouldStop: () => requestRef.current !== requestId,
      })
        .then((res) => {
          if (res) finish(res, 'main', Date.now() - started)
        })
        .catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
    }
    let worker: Worker | null = null
    try {
      if (typeof Worker !== 'undefined') worker = new Worker(new URL('../../domain/investment.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      worker = null
    }
    if (!worker) {
      fallback()
      return
    }
    workerRef.current = worker
    worker.onmessage = (e: MessageEvent<InvestmentWorkerMessage>) => {
      const msg = e.data
      if (msg.requestId !== requestId) return
      if (msg.type === 'progress') setRunning({ done: msg.done, total: msg.total, label: msg.label, engine: 'worker' })
      else if (msg.type === 'result') {
        stopWorker()
        finish(msg.result, 'worker', msg.durationMs)
      } else {
        stopWorker()
        fail(msg.message)
      }
    }
    worker.onerror = (ev) => {
      // Worker non pris en charge (module workers, CSP…) : on recommence sur le fil principal.
      ev.preventDefault()
      stopWorker()
      if (requestRef.current === requestId) fallback()
    }
    const msg: InvestmentWorkerRequest = { type: 'plan', requestId, input: req }
    worker.postMessage(msg)
  }

  const cancel = () => {
    requestRef.current += 1
    stopWorker()
    setRunning(null)
  }

  // Calcul automatique à l'ouverture et quand l'adresse change (seulement avec un Web Worker : le calcul
  // ne bloque jamais la page ; sans Worker, bouton « Calculer »).
  const autoKey = useRef<string | null>(null)
  useEffect(() => {
    if (typeof Worker === 'undefined' || autoKey.current === routeKey) return
    autoKey.current = routeKey
    run()
    return () => {
      // Démontage (ou double montage du mode strict) : calcul annulé, relancé au prochain montage.
      autoKey.current = null
      requestRef.current += 1
      workerRef.current?.terminate()
      workerRef.current = null
    }
    // `run` lit les entrées courantes : relancé seulement à l'ouverture et quand l'adresse change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey])

  const result = outcome?.result ?? null
  const stale = outcome !== null && outcome.key !== inputKey
  const market = ctx.market ?? null
  const fam = FAMILIES[settings.family]

  return (
    <div className="investment-page">
      <PageHeader
        title="Investissement"
        subtitle="Indiquez un budget (ex. 20 M de kamas) : plan d’action daté pour être rentable le plus vite possible, feuille de route, retour sur investissement et bénéfice par jour, avec les prix de votre serveur."
      />

      <Card title="Votre investissement">
        <div className="inv-inputs">
          <div className="inv-field-group">
            <NumberField label="Budget" value={prefs.budget} min={0} max={MAX_BUDGET} step={100_000} suffix="K" width={150} onChange={(v) => setPrefs({ budget: v })} />
            <small className="muted">= {formatKamas(prefs.budget)}</small>
            <div className="row inv-presets" role="group" aria-label="Budgets proposés">
              {BUDGET_PRESETS.map((b) => (
                <button key={b} type="button" className={`btn small${prefs.budget === b ? ' primary' : ''}`} aria-pressed={prefs.budget === b} onClick={() => setPrefs({ budget: b, reserve: Math.round(b * 0.1) })}>
                  {formatNumber(b / 1e6)} M
                </button>
              ))}
            </div>
          </div>
          <div className="inv-field-group">
            <NumberField label="Horizon" value={prefs.horizonDays} min={MIN_HORIZON_DAYS} max={MAX_HORIZON_DAYS} suffix="jours" width={90} onChange={(v) => setPrefs({ horizonDays: v })} />
            <div className="row inv-presets" role="group" aria-label="Horizons proposés">
              {HORIZON_PRESETS.map((h) => (
                <button key={h} type="button" className={`btn small${prefs.horizonDays === h ? ' primary' : ''}`} aria-pressed={prefs.horizonDays === h} onClick={() => setPrefs({ horizonDays: h })}>
                  {h} j
                </button>
              ))}
            </div>
          </div>
          <div className="inv-field-group">
            <SelectField<ProfitModeId> label="Mode de rentabilité" value={prefs.mode} options={INVESTMENT_MODE_IDS.map((id) => ({ value: id, label: investmentModeLabel(id) }))} onChange={(mode) => setPrefs({ mode })} />
            {prefs.mode === 'auto' && (
              <label className="inv-check">
                <input type="checkbox" checked={prefs.onlyFamily} onChange={(e) => setPrefs({ onlyFamily: e.target.checked })} />
                Seulement les {fam.plural} (famille du profil)
              </label>
            )}
          </div>
          <div className="inv-field-group">
            <NumberField label="Réserve de sécurité" value={prefs.reserve} min={0} max={prefs.budget} step={100_000} suffix="K" width={150} onChange={(v) => setPrefs({ reserve: v })} />
            <small className="muted">
              {prefs.budget > 0 ? `${formatPercent(prefs.reserve / prefs.budget, 0)} du budget, jamais engagée` : 'jamais engagée'} · engageable : {k(Math.max(0, prefs.budget - prefs.reserve))}
            </small>
          </div>
        </div>

        <fieldset className="inv-levers">
          <legend>Leviers autorisés</legend>
          {(Object.keys(LEVER_LABELS) as (keyof InvestmentLevers)[]).map((id) => (
            <label key={id} className="inv-check">
              <input type="checkbox" checked={prefs.levers[id]} onChange={(e) => setPrefs({ levers: { ...prefs.levers, [id]: e.target.checked } })} />
              <span>
                {LEVER_LABELS[id].label}
                <small className="muted"> — {LEVER_LABELS[id].hint}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <p className="muted inv-profile">
          Profil « {profile.name} » sur {server.name} : Éleveur niveau {jobLevel}
          {jobLevel !== settings.jobLevel ? ` (estimé : ${settings.jobLevel} saisi + XP du journal)` : ''}, {formatNumber(settings.hoursPerDay, 1)} h de jeu par jour, {settings.accounts}{' '}
          personnage{settings.accounts > 1 ? 's' : ''} pour les captures, règles {rules.id}. <a href={href('reglages')}>Modifier dans les Réglages</a>.
        </p>
        {market ? (
          <p className="muted">
            Prix : HDV de {market.serverName ?? server.name} du {frenchDay(market.exportDate)} ({formatNumber(Object.keys(market.rows).length)} objets), taxe {formatPercent(settings.saleTax, 1)}, ventes plafonnées à{' '}
            {formatPercent(server.maxMarketShare, 0)} du volume quotidien. <a href={href('prix', { onglet: 'hdv' })}>Mettre à jour</a>
          </p>
        ) : (
          <Callout tone="warn">
            Aucun export HDV importé pour {server.name} : les estimations utilisent les prix par défaut de la recherche (autres serveurs, datés) et ignorent le volume du marché.{' '}
            <a href={href('prix', { onglet: 'hdv' })}>Importer les prix de votre serveur</a>.
          </Callout>
        )}

        <div className="row inv-run">
          {running ? (
            <>
              <div className="inv-progress">
                <Progress value={running.done} max={running.total} />
                <small className="muted" role="status">
                  {running.label} — {formatNumber((100 * running.done) / Math.max(1, running.total))} % ({running.engine === 'worker' ? 'calcul en arrière-plan' : 'calcul sur la page'})
                </small>
              </div>
              <button type="button" className="btn" onClick={cancel}>
                Annuler
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn primary" onClick={run} disabled={prefs.budget <= 0}>
                {outcome ? 'Recalculer le plan' : 'Calculer le plan'}
              </button>
              {stale && <Badge tone="warn">Paramètres modifiés : recalculez</Badge>}
              {outcome && !stale && (
                <small className="muted">
                  Calculé en {formatNumber(outcome.durationMs / 1000, 1)} s ({outcome.engine === 'worker' ? 'Web Worker' : 'fil principal'}), {formatNumber(outcome.result.evaluated)} simulations.
                </small>
              )}
            </>
          )}
        </div>
        {error && <Callout tone="danger">Calcul impossible : {error}</Callout>}
      </Card>

      {result && result.plan && <Results result={result} plan={result.plan} stale={stale} />}
    </div>
  )
}

// ---------- Résultats ----------

function Results({ result, plan, stale }: { result: InvestmentResult; plan: InvestmentEvaluation; stale: boolean }) {
  const a = plan.allocation
  const pre = BOUND_PREFIX[plan.profitStatus]
  const roiAt = (d: number) => plan.projections.find((p) => p.day === d)
  return (
    <div className={`inv-results${stale ? ' stale' : ''}`}>
      {!result.feasible ? (
        <Callout tone="danger">
          <strong>{result.notes[0]}</strong>
          {result.minimumBudget !== null && (
            <>
              {' '}
              <a href={href('investissement', { budget: result.minimumBudget, mode: result.modeId, horizon: result.horizonDays })}>Calculer avec {k(result.minimumBudget)}</a>. Le plan ci-dessous est le
              plan rentable le moins gourmand.
            </>
          )}
        </Callout>
      ) : (
        <Callout tone="ok">
          <strong>Plan retenu :</strong> {a.summary}. Trésorerie maximale engagée {k(plan.peakOutlay)} sur {k(result.available)} engageables (réserve de {k(result.reserve)} intacte).
        </Callout>
      )}
      {plan.profitStatus !== 'exact' && <Callout tone="warn">Montants incomplets : {BOUND_HINT[plan.profitStatus]}. {plan.missing.length} prix à renseigner (page Prix) ; un prix inconnu n’est jamais compté 0.</Callout>}

      <div className="grid kpis inv-kpis">
        <Stat label="Point mort (retour sur investissement)" value={plan.breakEvenDay === null ? `> ${plan.simDays} j` : `${plan.breakEvenEstimated ? '≈ ' : ''}Jour ${plan.breakEvenDay}`} hint={plan.breakEvenEstimated ? 'extrapolé au rythme du régime permanent' : 'cumul redevenu positif pour de bon'} />
        <Stat
          label="Bénéfice net par jour"
          value={`${pre}${k(plan.steadyNetPerDay)}`}
          tone={plan.steadyNetPerDay >= 0 ? 'pos' : 'neg'}
          hint={`régime permanent (8 tirages sur 10 : ${k(plan.steadyNetP10)} à ${k(plan.steadyNetP90)})`}
        />
        <Stat label={`Bénéfice à ${result.horizonDays} jours`} value={`${pre}${k(plan.profitAtHorizon)}`} tone={plan.profitAtHorizon >= 0 ? 'pos' : 'neg'} hint={`investissement déduit · ROI ${plan.roi === null ? '—' : formatPercent(plan.roi, 0)}`} />
        <Stat label="Dépense du jour 0" value={`${plan.day0Complete ? '' : '≥ '}${k(plan.day0)}`} hint={plan.day0Complete ? 'ingrédients, montures, socle des jauges' : 'des prix manquent : borne basse'} />
        <Stat label="Trésorerie maximale engagée" value={`${plan.day0Complete ? '' : '≥ '}${k(plan.peakOutlay)}`} hint={`sur ${k(result.available)} engageables · fonds de roulement ${k(plan.workingCapital)}`} />
        {[30, 60, 90].map((d) => {
          const p = roiAt(d)
          return <Stat key={d} label={`ROI à ${d} jours`} value={p && p.roi !== null ? `${pre}${formatPercent(p.roi, 0)}` : '—'} tone={p && p.cumulative >= 0 ? 'pos' : 'neg'} hint={p ? `cumul ${signedK(p.cumulative)}` : undefined} />
        })}
      </div>

      <Card title="Allocation du budget">
        <AllocationSummary plan={plan} result={result} />
      </Card>

      <Card title="Trésorerie : investissement puis bénéfices">
        <CashFlowChart plan={plan} horizon={result.horizonDays} />
        <CashFlowTable plan={plan} horizon={result.horizonDays} />
      </Card>

      <Card title="Feuille de route">
        <Roadmap items={result.roadmap} />
      </Card>

      <Card title="Courses du jour 0">
        <ShoppingTable items={result.shopping} marketDate={result.marketDate} />
      </Card>

      <Card title="Plan d’action jour par jour">
        <ActionPlan actions={result.actions} />
      </Card>

      <Card title="Autres allocations">
        <AlternativesTable rows={result.alternatives} horizon={result.horizonDays} simDays={plan.simDays} />
      </Card>

      {result.sensitivity.length > 0 && (
        <Card title="Sensibilité">
          <SensitivityTable rows={result.sensitivity} horizon={result.horizonDays} available={result.available} simDays={plan.simDays} />
        </Card>
      )}

      <Card title="Risques et hypothèses">
        <Risks risks={result.risks} />
        {result.notes.length > (result.feasible ? 0 : 1) && (
          <ul className="inv-notes">
            {result.notes.slice(result.feasible ? 0 : 1).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        <details className="inv-details">
          <summary>Hypothèses du calcul ({result.assumptions.length})</summary>
          <ul>
            {result.assumptions.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </details>
      </Card>
    </div>
  )
}

function AllocationSummary({ plan, result }: { plan: InvestmentEvaluation; result: InvestmentResult }) {
  const a = plan.allocation
  const lv = plan.leveling
  const rs = lv?.resale ?? null
  const rows: { label: string; value: ReactNode; detail?: ReactNode }[] = [
    {
      label: 'Métier d’Éleveur',
      value: lv ? `niveau ${lv.from} → ${lv.to}` : `niveau ${a.jobFrom} (pas de montée)`,
      detail: lv ? (
        <>
          {k(lv.cost)} d’ingrédients, {formatNumber(lv.crafts)} crafts en {lv.craftDays} jour{lv.craftDays > 1 ? 's' : ''} ({formatNumber(lv.craftsPerDay)}/jour)
          {rs && rs.total > 0 ? ` · revente des objets fabriqués ≈ ${k(rs.total)}` : ''}
        </>
      ) : (
        'Les enclos suivants se débloquent avec l’XP d’élevage (captures, accouplements).'
      ),
    },
    {
      label: 'Enclos',
      value: `${plan.initialPaddocks} au départ${plan.schedule.length ? ` → ${plan.schedule[plan.schedule.length - 1].paddocks}` : ''}`,
      detail: plan.schedule.length ? plan.schedule.map((s) => `${s.paddocks} dès le jour ${s.day}`).join(' · ') : undefined,
    },
    { label: 'Mode', value: a.modeLabel, detail: <a href={href('modes')}>Comparer les modes</a> },
    {
      label: 'Stratégie',
      value: a.strategyLabel,
      detail:
        plan.summary.capital.socle && !plan.summary.capital.socle.complete
          ? `Socle des jauges au palier ${a.tier} : ≥ ${k(plan.socleTotal)} (prix manquants ; reste dans les jauges)`
          : plan.socleTotal > 0
            ? `Socle des jauges au palier ${a.tier} : ${k(plan.socleTotal)} au total (reste dans les jauges)`
            : `Palier ${a.tier} : pas de socle à remplir`,
    },
    {
      label: 'Montures G1 achetées',
      value: a.g1Stock || a.g1PerDay ? `${a.g1Stock} au départ${a.g1PerDay ? `, jusqu’à ${a.g1PerDay}/jour` : ''}` : 'aucune (captures seulement)',
      detail: a.g1Stock ? `${k(plan.g1StockCost)} le jour 0` : undefined,
    },
    { label: 'Réserve', value: k(result.reserve), detail: result.unusedBudget > 0 ? `${k(result.unusedBudget)} du budget engageable non utilisés par ce plan` : undefined },
  ]
  return (
    <dl className="inv-alloc">
      {rows.map((r) => (
        <div key={r.label}>
          <dt>{r.label}</dt>
          <dd>
            <strong>{r.value}</strong>
            {r.detail && <small className="muted">{r.detail}</small>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

// ---------- Courbe de trésorerie (SVG) ----------

function CashFlowChart({ plan, horizon }: { plan: InvestmentEvaluation; horizon: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>(640)
  const [hover, setHover] = useState<number | null>(null)
  const pts = plan.cashflow
  const S = pts.length - 1
  const W = Math.max(300, width)
  const H = 280
  const m = { l: 56, r: 18, t: 18, b: 30 }
  const lo = Math.min(0, ...pts.map((p) => Math.min(p.cumulativeLow, p.cumulative)))
  const hi = Math.max(0, ...pts.map((p) => Math.max(p.cumulativeHigh, p.cumulative)))
  const step = niceStep(hi - lo, 5)
  const yMin = Math.floor(lo / step) * step
  const yMax = Math.ceil(hi / step) * step || step
  const x = (d: number) => m.l + (d / Math.max(1, S)) * (W - m.l - m.r)
  const y = (v: number) => m.t + ((yMax - v) / Math.max(1, yMax - yMin)) * (H - m.t - m.b)
  const yTicks: number[] = []
  for (let v = yMin; v <= yMax + step / 2; v += step) yTicks.push(v)
  const xTicks = [0, ...[30, 60, 90, 120, 180, 270, 365].filter((d) => d <= S)]
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join('')
  const band =
    pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.cumulativeHigh).toFixed(1)}`).join('') +
    [...pts]
      .reverse()
      .map((p) => `L${x(p.day).toFixed(1)},${y(p.cumulativeLow).toFixed(1)}`)
      .join('') +
    'Z'
  const be = plan.breakEvenDay !== null && !plan.breakEvenEstimated ? plan.breakEvenDay : null
  const last = pts[S]
  const hp = hover !== null ? pts[hover] : null
  const dayFromX = (px: number) => Math.max(0, Math.min(S, Math.round(((px - m.l) / Math.max(1, W - m.l - m.r)) * S)))
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect()
    setHover(dayFromX(e.clientX - rect.left))
  }
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const cur = hover ?? Math.min(horizon, S)
      setHover(Math.max(0, Math.min(S, cur + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 7 : 1))))
    } else if (e.key === 'Escape') setHover(null)
  }
  const flip = hp ? x(hp.day) > W - 280 : false
  const tipStyle = hp ? { left: flip ? x(hp.day) - 12 : x(hp.day) + 12, top: 8, transform: flip ? 'translateX(-100%)' : undefined } : undefined
  return (
    <figure className="inv-chart">
      <figcaption>
        <strong>Cumul de trésorerie</strong> <small className="muted">kamas · jour 0 = achats · bande : 8 tirages sur 10</small>
      </figcaption>
      <div ref={ref} className="inv-chart-box">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          tabIndex={0}
          aria-label={`Cumul de trésorerie : ${k(pts[0].cumulative)} le jour 0, ${be !== null ? `point mort le jour ${be}, ` : ''}${k(last.cumulative)} le jour ${S}. Flèches gauche et droite pour parcourir les jours.`}
          onKeyDown={onKey}
          onFocus={() => setHover((h) => h ?? Math.min(horizon, S))}
          onBlur={() => setHover(null)}
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'inv-zero' : 'inv-grid'} />
              <text x={m.l - 6} y={y(v) + 4} className="inv-axis" textAnchor="end">
                {axisK(v)}
              </text>
            </g>
          ))}
          {xTicks.map((d) => (
            <text key={d} x={x(d)} y={H - 8} className="inv-axis" textAnchor={d === 0 ? 'start' : 'middle'}>
              {d === 0 ? 'J0' : `J${d}`}
            </text>
          ))}
          {horizon < S && (
            <g>
              <line x1={x(horizon)} x2={x(horizon)} y1={m.t} y2={H - m.b} className="inv-marker" />
              <text x={x(horizon) + 4} y={m.t + 10} className="inv-axis">
                horizon
              </text>
            </g>
          )}
          <path d={band} className="inv-band" />
          <path d={line} className="inv-line" />
          {be !== null && (
            <g>
              <line x1={x(be)} x2={x(be)} y1={m.t} y2={H - m.b} className="inv-be-line" />
              <circle cx={x(be)} cy={y(pts[be].cumulative)} r={5} className="inv-be-dot" />
              <text x={x(be) > W - 140 ? x(be) - 6 : x(be) + 6} y={y(yMin) - 6} className="inv-be-label" textAnchor={x(be) > W - 140 ? 'end' : 'start'}>
                Point mort J{be}
              </text>
            </g>
          )}
          <circle cx={x(S)} cy={y(last.cumulative)} r={4} className="inv-end-dot" />
          <text x={x(S) - 6} y={y(last.cumulative) - 8} className="inv-end-label" textAnchor="end">
            {axisK(last.cumulative)}
          </text>
          {hp && (
            <g pointerEvents="none">
              <line x1={x(hp.day)} x2={x(hp.day)} y1={m.t} y2={H - m.b} className="inv-cross" />
              <circle cx={x(hp.day)} cy={y(hp.cumulative)} r={4} className="inv-hover-dot" />
            </g>
          )}
          <rect x={m.l} y={m.t} width={Math.max(0, W - m.l - m.r)} height={H - m.t - m.b} className="inv-hit" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
        {hp && (
          <div className="inv-tip" style={tipStyle} aria-hidden="true">
            <strong>{signedK(hp.cumulative)}</strong>
            <span>cumul au jour {hp.day}</span>
            <span>
              8/10 : {k(hp.cumulativeLow)} à {k(hp.cumulativeHigh)}
            </span>
            <span>net du jour {signedK(hp.net)}</span>
            {hp.investment > 0 && <span>achats {k(hp.investment)}</span>}
            {hp.resale > 0 && <span>dont revente des crafts {k(hp.resale)}</span>}
            <span>{hp.paddocks} enclos</span>
          </div>
        )}
      </div>
    </figure>
  )
}

function CashFlowTable({ plan, horizon }: { plan: InvestmentEvaluation; horizon: number }) {
  const pts = plan.cashflow
  const S = pts.length - 1
  const days = new Set<number>([0, 1, ...[7, 14, 21, 30, 45, 60, 75, 90, 120, 150, 180, 270, 365].filter((d) => d <= S), horizon, S])
  if (plan.breakEvenDay !== null && plan.breakEvenDay <= S) days.add(plan.breakEvenDay)
  for (const s of plan.schedule) if (s.day <= S) days.add(s.day)
  const rows: CashFlowPoint[] = [...days].filter((d) => d <= S).sort((a, b) => a - b).map((d) => pts[d])
  return (
    <details className="inv-details">
      <summary>Voir les données (tableau)</summary>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Jour</th>
              <th className="num">Enclos</th>
              <th className="num">Achats</th>
              <th className="num">Coûts</th>
              <th className="num">Revenus</th>
              <th className="num">Net du jour</th>
              <th className="num">Cumul</th>
              <th className="num">Cumul (8/10 ≥)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.day}>
                <td>
                  J{p.day}
                  {p.day === plan.breakEvenDay && !plan.breakEvenEstimated ? ' · point mort' : ''}
                  {p.day === horizon ? ' · horizon' : ''}
                </td>
                <td className="num">{p.paddocks}</td>
                <td className="num">{p.investment ? k(p.investment) : '—'}</td>
                <td className="num">{k(p.costs)}</td>
                <td className="num">
                  {k(p.revenue)}
                  {p.resale > 0 && <small className="muted"> (revente {k(p.resale)})</small>}
                </td>
                <td className="num">{signedK(p.net)}</td>
                <td className="num">{signedK(p.cumulative)}</td>
                <td className="num">{signedK(p.cumulativeLow)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

// ---------- Feuille de route ----------

const ROADMAP_ICONS: Record<RoadmapMilestone['kind'], string> = {
  depart: '🛒',
  metier: '🛠️',
  enclos: '🌾',
  'premiere-cible': '🥚',
  'premiere-vente': '💰',
  regime: '⚙️',
  'point-mort': '🎯',
  horizon: '🏁',
}

function Roadmap({ items }: { items: RoadmapMilestone[] }) {
  const max = Math.max(1, ...items.map((i) => i.day))
  // Repères proches (moins de 4 % de la durée) empilés sous la ligne.
  const placed = items.map((it) => ({ it, pos: (it.day / max) * 100, level: 0 }))
  placed.forEach((p, i) => {
    const taken = new Set(placed.slice(0, i).filter((q) => Math.abs(q.pos - p.pos) < 4).map((q) => q.level))
    while (taken.has(p.level)) p.level++
  })
  const levels = Math.max(0, ...placed.map((p) => p.level)) + 1
  return (
    <div className="inv-roadmap">
      <div className="inv-track" aria-hidden="true" style={{ height: `${levels * 26 + 4}px` }}>
        {placed.map(({ it, pos, level }, i) => (
          <span key={`${it.kind}-${i}`} className={`inv-dot ${it.kind}`} style={{ left: `${pos}%`, top: `${level * 26}px` }} title={`J${it.day} · ${it.label}`}>
            {i + 1}
          </span>
        ))}
      </div>
      <ol className="inv-milestones">
        {items.map((it, i) => (
          <li key={`${it.kind}-${i}`}>
            <span className="inv-num">{i + 1}</span>
            <Badge tone={it.kind === 'point-mort' ? 'ok' : it.kind === 'horizon' ? 'gold' : 'accent'}>
              {it.estimated ? '≈ ' : ''}J{it.day}
            </Badge>
            <span>
              {ROADMAP_ICONS[it.kind]} <strong>{it.label}</strong>
              {it.detail && <small className="muted"> — {it.detail}</small>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ---------- Courses du jour 0 ----------

const CATEGORY_LABELS: Record<ShoppingItem['category'], string> = {
  metier: 'Ingrédients du métier',
  montures: 'Montures G1',
  socle: 'Socle des jauges',
  fonds: 'Fonds de roulement',
}

function originText(it: ShoppingItem, exportDate: string | null): string {
  if (it.origin === 'marche') return `marché${exportDate ? ` (${frenchDay(exportDate).slice(0, 5)})` : ''}${it.sold24 !== null ? ` · ${formatNumber(it.sold24)} vendus/24 h` : ''}`
  if (it.origin === 'craft') return 'à fabriquer (coût des ingrédients)'
  if (it.origin in PRICE_ORIGIN_LABELS) return PRICE_ORIGIN_LABELS[it.origin as PriceOrigin]
  return it.origin === 'calcul' ? 'calcul' : it.origin
}

function ShoppingTable({ items, marketDate }: { items: ShoppingItem[]; marketDate: string | null }) {
  const [showAll, setShowAll] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const groups = (['metier', 'montures', 'socle', 'fonds'] as const).map((c) => ({ c, list: items.filter((i) => i.category === c) })).filter((g) => g.list.length)
  const total = items.reduce((t, i) => t + (i.total ?? 0), 0)
  const missing = items.filter((i) => i.missing)
  const copy = () => {
    const text = investmentShoppingText(items)
    const done = (ok: boolean) => setCopied(ok ? 'Liste copiée.' : 'Copie impossible : sélectionnez le tableau.')
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(false))
    else done(false)
  }
  if (!items.length) return <p className="muted">Rien à acheter le jour 0 : captures et carburant au fil des jours.</p>
  return (
    <>
      <div className="row">
        <span>
          Total engagé : <strong>{missing.length ? '≥ ' : ''}{k(total)}</strong> {missing.length > 0 && <Badge tone="warn">{missing.length} prix à saisir</Badge>}
        </span>
        <span className="spacer" />
        <button type="button" className="btn small" onClick={copy}>
          Copier la liste (Nom × quantité)
        </button>
        {copied && (
          <small className="muted" role="status">
            {copied}
          </small>
        )}
      </div>
      <div className="table-wrap">
        <table className="table inv-shop">
          <thead>
            <tr>
              <th>Objet</th>
              <th className="num">Quantité</th>
              <th className="num">Prix unitaire</th>
              <th className="num">Total</th>
              <th>Prix</th>
              <th className="num">Volume</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ c, list }) => {
              const shown = c === 'metier' && !showAll ? list.slice(0, 12) : list
              const sub = list.reduce((t, i) => t + (i.total ?? 0), 0)
              return [
                <tr key={`h-${c}`} className="inv-group">
                  <td colSpan={3}>
                    {CATEGORY_LABELS[c]} ({list.length})
                  </td>
                  <td className="num">{k(sub)}</td>
                  <td colSpan={2} />
                </tr>,
                ...shown.map((it, i) => (
                  <tr key={`${c}-${it.id ?? 'x'}-${i}`}>
                    <td>
                      {it.missing && it.id !== null ? <a href={href('prix', { q: it.name })}>{it.name}</a> : it.name}
                      {it.note && <small className="muted inv-note">{it.note}</small>}
                    </td>
                    <td className="num">{it.qty === null ? '—' : formatNumber(it.qty)}</td>
                    <td className="num">{it.unitPrice === null ? (it.qty === null ? '—' : 'à saisir') : formatKamas(it.unitPrice)}</td>
                    <td className="num">{it.total === null ? 'inconnu' : k(it.total)}</td>
                    <td>{originText(it, marketDate)}</td>
                    <td className="num">
                      {it.daysOfVolume === null ? '—' : it.daysOfVolume > 1 ? <Badge tone="warn">{formatNumber(it.daysOfVolume, 1)} j de ventes</Badge> : `${formatNumber(it.daysOfVolume * 100, 0)} % d’un jour`}
                    </td>
                  </tr>
                )),
                ...(c === 'metier' && list.length > 12
                  ? [
                      <tr key="more">
                        <td colSpan={6}>
                          <button type="button" className="btn small ghost" onClick={() => setShowAll((v) => !v)}>
                            {showAll ? 'Réduire la liste' : `Afficher les ${list.length} ingrédients`}
                          </button>
                        </td>
                      </tr>,
                    ]
                  : []),
              ]
            })}
          </tbody>
        </table>
      </div>
      <small className="muted">
        Volume : quantité ÷ ventes moyennes par jour du serveur ; au-delà d’une journée, étalez les achats ou attendez-vous à payer plus cher.
      </small>
    </>
  )
}

// ---------- Plan d'action ----------

const ACTION_LABELS: Record<InvestmentActionKind, { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'gold' | 'accent' }> = {
  achat: { label: 'Achat', tone: 'warn' },
  reserve: { label: 'Trésorerie', tone: 'gold' },
  craft: { label: 'Craft', tone: 'info' },
  enclos: { label: 'Enclos', tone: 'accent' },
  production: { label: 'Élevage', tone: 'accent' },
  vente: { label: 'Vente', tone: 'ok' },
  jalon: { label: 'Jalon', tone: 'gold' },
}

function ActionPlan({ actions }: { actions: InvestmentAction[] }) {
  const groups: { key: string; title: string; items: InvestmentAction[] }[] = []
  for (const a of actions) {
    const key = a.toDay !== undefined ? `${a.day}-${a.toDay}` : `${a.day}`
    const title = a.toDay !== undefined ? `Jours ${a.day} à ${a.toDay}` : `Jour ${a.day}`
    const g = groups.find((x) => x.key === key)
    if (g) g.items.push(a)
    else groups.push({ key, title, items: [a] })
  }
  return (
    <ol className="inv-actions">
      {groups.map((g) => (
        <li key={g.key}>
          <h3>{g.title}</h3>
          <ul>
            {g.items.map((a, i) => (
              <li key={i} className="inv-action">
                <div className="row">
                  <Badge tone={ACTION_LABELS[a.kind].tone}>{ACTION_LABELS[a.kind].label}</Badge>
                  <strong>{a.title}</strong>
                  {a.kamas !== null && <span className={`inv-amount ${a.kamas < 0 ? 'neg' : 'pos'}`}>{signedK(a.kamas)}</span>}
                </div>
                {a.details.length > 0 && (
                  <ul className="inv-action-details">
                    {a.details.map((d, j) => (
                      <li key={j}>{d}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}

// ---------- Alternatives et sensibilité ----------

function AlternativesTable({ rows, horizon, simDays }: { rows: AlternativeRow[]; horizon: number; simDays: number }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Allocation</th>
            <th className="num">Jour 0</th>
            <th className="num">Trésorerie max</th>
            <th className="num">Bénéfice à {horizon} j</th>
            <th className="num">Point mort</th>
            <th className="num">Bénéfice / jour</th>
            <th className="num">ROI</th>
            <th>Budget</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.allocation.id} className={r.chosen ? 'inv-chosen' : undefined}>
              <td>
                <strong>
                  {r.chosen ? '★ ' : ''}
                  {r.label}
                </strong>
                <small className="muted inv-note">{r.allocation.summary}</small>
              </td>
              <td className="num">{k(r.day0)}</td>
              <td className="num">{k(r.peakOutlay)}</td>
              <td className="num">
                {BOUND_PREFIX[r.profitStatus]}
                {signedK(r.profitAtHorizon)}
              </td>
              <td className="num">{dayLabel(r.breakEvenDay, r.breakEvenEstimated, simDays)}</td>
              <td className="num">{k(r.steadyNetPerDay)}</td>
              <td className="num">{r.roi === null ? '—' : formatPercent(r.roi, 0)}</td>
              <td>{r.feasible ? <Badge tone="ok">dans le budget</Badge> : <Badge tone="danger">hors budget</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SensitivityTable({ rows, horizon, available, simDays }: { rows: SensitivityRow[]; horizon: number; available: number; simDays: number }) {
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Scénario</th>
              <th className="num">Bénéfice à {horizon} j</th>
              <th className="num">Écart</th>
              <th className="num">Point mort</th>
              <th className="num">Bénéfice / jour</th>
              <th className="num">Trésorerie max</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.id === 'reference' ? 'inv-chosen' : undefined}>
                <td>{r.label}</td>
                <td className="num">{signedK(r.profitAtHorizon)}</td>
                <td className={`num ${r.delta < 0 ? 'inv-neg' : r.delta > 0 ? 'inv-pos' : ''}`}>{r.id === 'reference' ? '—' : signedK(r.delta)}</td>
                <td className="num">{dayLabel(r.breakEvenDay, r.breakEvenEstimated, simDays)}</td>
                <td className="num">{k(r.steadyNetPerDay)}</td>
                <td className="num">
                  {k(r.peakOutlay)} {r.peakOutlay > available + 1 && <Badge tone="danger">dépasse</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small className="muted">Même allocation, mêmes tirages que la référence : l’écart vient du scénario seul. Prix de vente = ressources, runes, montures et génétons.</small>
    </>
  )
}

function Risks({ risks }: { risks: InvestmentRisk[] }) {
  return (
    <div className="inv-risks">
      {risks.map((r) =>
        r.tone === 'info' ? (
          <Callout key={r.code + r.text}>{r.text}</Callout>
        ) : (
          <Callout key={r.code + r.text} tone={r.tone}>
            {r.text}
          </Callout>
        ),
      )}
    </div>
  )
}
