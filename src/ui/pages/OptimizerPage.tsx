// Page « Optimiseur » : simule des programmes d'élevage complets (captures → fécondations →
// accouplements → clonages) jusqu'à une monture cible et compare des stratégies (niveau des parents,
// Optimakina, clonage) : temps, ressources, coût estimé, recommandation.
// Logique : src/domain/programSim.ts (portage du simulateur de la recherche), exécuté dans un Web
// Worker (programSim.worker.ts) avec repli sur le fil principal.
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { FAMILIES, STRATEGY, getSpecies, itemName } from '../../data'
import { minCaptures } from '../../domain/breedingPath'
import { goalStatus, sessionsPerDayFor } from '../../domain/advisor'
import { FUEL_TIER_NAMES } from '../../domain/constants'
import { NET_KIND_LABELS, batchProfile, findNet, type NetKind } from '../../domain/economy'
import {
  FUEL_GAUGES,
  MAX_DAYS,
  PROGRAM_COST_LABELS,
  STRATEGY_PRESETS,
  compareStrategies,
  estimateProgramCost,
  makinaPolicyLabel,
  paddocksForJobLevel,
  presetConfig,
  researchReference,
  runStrategiesAsync,
  type MakinaPolicy,
  type ProgramBase,
  type ProgramConfig,
  type ProgramCost,
  type ProgramCostLine,
  type Recommendation,
  type StrategyJob,
  type StrategyJobResult,
  type StrategyOutcome,
} from '../../domain/programSim'
import type { ProgramWorkerMessage, ProgramWorkerRequest } from '../../domain/programSim.worker'
import type { Ruleset } from '../../domain/rules'
import type { FamilyId, FuelTier } from '../../domain/types'
import { jobLevelFromXp, jobXpForLevel } from '../../domain/xp'
import { formatDuration, formatKamas, formatNumber, formatPercent } from '../../lib/format'
import { useInventory } from '../../store/inventory'
import { useGenetonValue, usePriceContext } from '../../store/prices'
import { useRules, useSettings } from '../../store/settings'
import { profileKey } from '../../store/profiles'
import { Badge, Callout, Card, Empty, GaugeChip, NumberField, PageHeader, Progress, SelectField, Stat, Tabs } from '../components'
import { MarketStatusCallouts } from '../MarketStatus'
import { href } from '../router'
import { ConfidenceBadge, GenBadge, SpeciesName, SpeciesPicker } from '../species'
import './OptimizerPage.css'

// ---------- Paramètres de la page ----------

type MakinaMode = 'none' | 'all' | 'from'

interface CustomStrategy {
  enabled: boolean
  parentLevel: number
  makinaMode: MakinaMode
  fromGeneration: number
  cloning: boolean
}

interface Params {
  targetId: number | null
  family: FamilyId
  paddocks: number
  runs: number
  tier: FuelTier
  batchSize: number
  sessionsPerDay: number
  maxDays: number
  netKind: NetKind
  selected: string[]
  custom: CustomStrategy
  cloneKeepsLevel: boolean
  seed: number
}

type Engine = 'worker' | 'main'

interface RunRecord {
  key: string
  results: StrategyJobResult[]
  engine: Engine
  durationMs: number
  finishedAt: number
}

interface RunProgress {
  done: number
  total: number
  jobId: string
  engine: Engine
}

const STORAGE_KEY = profileKey('optimiseur')
const TIERS: FuelTier[] = [1, 2, 3, 4]
const NET_KINDS: NetKind[] = ['universel', 'multiplicateur', 'renforce', 'multiplicateur_renforce']
const RUN_OPTIONS = [
  { value: 10, label: '10 (rapide)' },
  { value: 20, label: '20' },
  { value: 40, label: '40 (comme la recherche)' },
  { value: 100, label: '100 (précis, plus lent)' },
]
const CUSTOM_ID = 'perso'

/** Dernière simulation, gardée en mémoire le temps de la session (navigation entre pages). */
let lastRun: RunRecord | null = null

/**
 * Champs issus des Réglages (enclos débloqués, palier, objectif, niveau des parents, Optimakina) : ils
 * suivent les Réglages en direct ; seule une modification faite sur cette page est mémorisée comme écart.
 */
interface SettingsOverrides {
  targetId?: number | null
  paddocks?: number
  tier?: FuelTier
  parentLevel?: number
  makinaMode?: MakinaMode
}

type PageFields = Omit<Params, 'targetId' | 'paddocks' | 'tier' | 'custom'> & { custom: Pick<CustomStrategy, 'enabled' | 'fromGeneration' | 'cloning'> }

interface StoredV2 {
  v: 2
  page: Partial<PageFields>
  overrides: SettingsOverrides
}

const OVERRIDE_LABELS: Record<keyof SettingsOverrides, string> = {
  targetId: 'Monture cible',
  paddocks: 'Enclos utilisés',
  tier: 'Palier de jauge',
  parentLevel: 'Niveau des parents (stratégie personnalisée)',
  makinaMode: 'Optimakina (stratégie personnalisée)',
}

function loadStored(): StoredV2 {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const o = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { v: 2, page: {}, overrides: {} }
    if (o.v === 2) return { v: 2, page: (o.page as Partial<PageFields>) ?? {}, overrides: (o.overrides as SettingsOverrides) ?? {} }
    // Ancien format (copie complète, réglages figés compris) : seuls les champs propres à la page sont repris.
    const old = o as Partial<Params>
    const page: Partial<PageFields> = {}
    for (const k of ['family', 'runs', 'batchSize', 'sessionsPerDay', 'maxDays', 'netKind', 'selected', 'cloneKeepsLevel', 'seed'] as const)
      if (old[k] !== undefined) (page as Record<string, unknown>)[k] = old[k]
    if (old.custom) page.custom = { enabled: !!old.custom.enabled, fromGeneration: old.custom.fromGeneration ?? 6, cloning: old.custom.cloning ?? true }
    return { v: 2, page, overrides: {} }
  } catch {
    return { v: 2, page: {}, overrides: {} }
  }
}

function saveStored(s: StoredV2) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // Stockage indisponible (navigation privée) : les paramètres ne sont simplement pas mémorisés.
  }
}

/** Écart entre un lot idéal (hypothèse du simulateur) et un lot typique du planificateur d'enclos. */
function batchGap(tier: FuelTier, rules: Ruleset): { fuel: number; time: number; idealSeconds: number; typicalSeconds: number } {
  const ideal = batchProfile('ideal', tier, rules)
  const typical = batchProfile('typique', tier, rules)
  const sum = (p: typeof ideal) => Object.values(p.points).reduce((a: number, b) => a + (b ?? 0), 0)
  return { fuel: sum(typical) / sum(ideal) - 1, time: typical.seconds / ideal.seconds - 1, idealSeconds: ideal.seconds, typicalSeconds: typical.seconds }
}

function BatchAssumption({ tier, rules }: { tier: FuelTier; rules: Ruleset }) {
  const g = batchGap(tier, rules)
  return (
    <Callout>
      <strong>Hypothèse de lot idéal</strong> : le simulateur compte 20 000 points par statistique et la fécondité la plus rapide (≈ {formatDuration(g.idealSeconds)} au palier {tier}). Un lot réel du planificateur d'enclos
      consomme ≈ +{formatPercent(g.fuel, 0)} de carburant et dure ≈ +{formatPercent(g.time, 0)} (≈ {formatDuration(g.typicalSeconds)}) : coûts de carburant et durées sont des <strong>minimums</strong>. Le socle des paliers ≥ 2
      (investissement initial qui reste dans les jauges) n'est pas compté — voir <a href={href('rentabilite')}>Rentabilité</a>.
    </Callout>
  )
}

function customMakina(c: CustomStrategy): MakinaPolicy {
  if (c.makinaMode === 'none') return 'none'
  if (c.makinaMode === 'all') return 'all'
  return { fromGeneration: c.fromGeneration }
}

function customLabel(c: CustomStrategy): string {
  return `Ma stratégie (niv. ${c.parentLevel}, ${makinaPolicyLabel(customMakina(c))}${c.cloning ? '' : ', sans clonage'})`
}

function validTarget(id: number | null): number | null {
  if (id === null) return null
  const s = getSpecies(id)
  return s && s.breedable ? s.id : null
}

function levelPolicyLabel(cfg: Pick<ProgramConfig, 'parentLevel' | 'levelByGeneration'>, long = false): string {
  if (!cfg.levelByGeneration) return `niv. ${cfg.parentLevel}`
  const levels = [...new Set(Object.values(cfg.levelByGeneration))].filter((l): l is number => l !== undefined).sort((a, b) => a - b)
  return `niv. ${levels.join('/')}${long ? ' selon la génération' : ''}`
}

const fmtDays = (d: number) => formatNumber(d, 1)
const fmtInt = (n: number) => formatNumber(n, 0)
const fmtMillions = (n: number) => `${formatNumber(n / 1e6, 2)} M`

// ---------- Utilitaires d'affichage ----------

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

/** Barre horizontale : extrémité arrondie de 4 px, base carrée. */
function barPath(y: number, w: number, h: number): string {
  if (w <= 0.5) return ''
  const r = Math.min(4, w, h / 2)
  return `M0,${y}H${w - r}A${r},${r} 0 0 1 ${w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${w - r},${y + h}H0Z`
}

interface BarRow {
  id: string
  label: string
  mean: number
  p10?: number
  p90?: number
  /** « ≥ » pour une borne basse (coût incomplet). */
  prefix?: string
  best?: boolean
}

/** Graphique en barres horizontales (SVG fait main) : moyenne + intervalle p10–p90. */
function BarChart({ title, unit, rows, format, note }: { title: string; unit: string; rows: BarRow[]; format: (v: number) => string; note?: ReactNode }) {
  const [ref, width] = useElementWidth<HTMLDivElement>(360)
  const W = Math.max(220, width)
  const valueRoom = 92
  const rowH = 42
  const barH = 14
  const max = Math.max(1e-9, ...rows.map((r) => Math.max(r.mean, r.p90 ?? 0)))
  const x = (v: number) => (Math.max(0, v) / max) * (W - valueRoom)
  const H = rows.length * rowH
  return (
    <figure className="opt-chart">
      <figcaption>
        <strong>{title}</strong> <small className="muted">{unit}</small>
      </figcaption>
      <div ref={ref} className="opt-chart-box">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} : ${rows.map((r) => `${r.label} ${r.prefix ?? ''}${format(r.mean)}`).join(' ; ')}`}>
          <line x1={0.5} x2={0.5} y1={18} y2={H - 4} className="opt-axis" />
          {rows.map((r, i) => {
            const y0 = i * rowH
            const by = y0 + 20
            const w = x(r.mean)
            const hasRange = r.p10 !== undefined && r.p90 !== undefined && r.p90 > r.p10
            const end = Math.max(w, hasRange ? x(r.p90 as number) : 0)
            const mid = by + barH / 2
            return (
              <g key={r.id}>
                <title>
                  {`${r.label} : ${r.prefix ?? ''}${format(r.mean)} ${unit}${hasRange ? ` (8 tirages sur 10 entre ${format(r.p10 as number)} et ${format(r.p90 as number)})` : ''}`}
                </title>
                <rect x={0} y={y0} width={W} height={rowH} className="opt-hit" />
                <text x={0} y={y0 + 13} className="opt-chart-label">
                  {r.best ? '★ ' : ''}
                  {r.label}
                </text>
                <path d={barPath(by, w, barH)} className={`opt-bar${r.best ? ' best' : ''}`} />
                {hasRange && (
                  <g className="opt-whisker">
                    <line x1={x(r.p10 as number)} x2={x(r.p90 as number)} y1={mid} y2={mid} />
                    <line x1={x(r.p10 as number)} x2={x(r.p10 as number)} y1={by + 3} y2={by + barH - 3} />
                    <line x1={x(r.p90 as number)} x2={x(r.p90 as number)} y1={by + 3} y2={by + barH - 3} />
                  </g>
                )}
                <text x={end + 6} y={by + barH - 2} className="opt-chart-value">
                  {r.prefix ?? ''}
                  {format(r.mean)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      {note && <small className="muted">{note}</small>}
    </figure>
  )
}

/** Moyenne en gras + intervalle p10–p90. */
function Cell({ mean, p10, p90, format = fmtInt, star }: { mean: number; p10?: number; p90?: number; format?: (v: number) => string; star?: string }) {
  return (
    <td className="num">
      <strong>{format(mean)}</strong>
      {star && (
        <span className="opt-star" title={star}>
          {' '}
          ★
        </span>
      )}
      {p10 !== undefined && p90 !== undefined && p90 !== p10 && (
        <div className="opt-range">
          {format(p10)} – {format(p90)}
        </div>
      )}
    </td>
  )
}

function MissingLinks({ ids, max = 10 }: { ids: number[]; max?: number }) {
  if (!ids.length) return null
  const shown = ids.slice(0, max)
  return (
    <span>
      {shown.map((id, i) => (
        <span key={id}>
          {i > 0 && ', '}
          <a href={href('prix', { q: itemName(id) })}>{itemName(id)}</a>
        </span>
      ))}
      {ids.length > max && ` et ${ids.length - max} autre(s)`}
    </span>
  )
}

function CostCell({ cost }: { cost: ProgramCost | null }) {
  if (!cost) return <td className="num muted">—</td>
  return (
    <td className="num">
      <strong>{cost.complete ? formatKamas(cost.total, true) : cost.total > 0 ? `≥ ${formatKamas(cost.total, true)}` : '—'}</strong>
      <div className="opt-range">
        {!cost.complete ? (
          <a href={href('prix', { onglet: 'carburants' })} className="badge danger" title="Il manque des prix : le total ne compte que les montants connus.">
            coût incomplet
          </a>
        ) : cost.estimated ? (
          <Badge tone="warn" title="Une partie du coût vient d'une estimation de la recherche (Mangeoire).">
            estimation
          </Badge>
        ) : (
          <Badge tone="ok">vos prix</Badge>
        )}
      </div>
    </td>
  )
}

const TONE: Record<Recommendation['tone'], 'ok' | 'warn' | undefined> = { ok: 'ok', info: undefined, warn: 'warn' }

// ---------- Page ----------

export default function OptimizerPage() {
  const goalSpeciesId = useSettings((s) => s.goalSpeciesId)
  const settingsFamily = useSettings((s) => s.family)
  const jobLevel = useSettings((s) => s.jobLevel)
  const preferredTier = useSettings((s) => s.preferredTier)
  const parentTargetLevel = useSettings((s) => s.parentTargetLevel)
  const useOptimakina = useSettings((s) => s.useOptimakina)
  const hoursPerDay = useSettings((s) => s.hoursPerDay)
  const mounts = useInventory((s) => s.mounts)
  const updateSettings = useSettings((s) => s.update)
  const rules = useRules()
  const ctx = usePriceContext()
  // Valeur du généton du profil (votre valeur, sinon marché du serveur, sinon défaut), NETTE de la taxe
  // de revente du parchemin — la même que Plan, Accueil, Modes et Rentabilité.
  const geneton = useGenetonValue()
  const genetonValue = geneton.net

  // Réglages en direct + écarts saisis ici + champs propres à la page (aucune copie figée des réglages).
  const live = useMemo(
    () => ({
      targetId: validTarget(goalSpeciesId),
      paddocks: paddocksForJobLevel(jobLevel),
      tier: preferredTier,
      parentLevel: parentTargetLevel,
      makinaMode: (useOptimakina ? 'from' : 'none') as MakinaMode,
      // Passages aux enclos par jour : temps de jeu des Réglages (comme le calendrier du Plan).
      sessionsPerDay: sessionsPerDayFor(hoursPerDay),
    }),
    [goalSpeciesId, jobLevel, preferredTier, parentTargetLevel, useOptimakina, hoursPerDay],
  )
  const [stored, setStored] = useState<StoredV2>(() => loadStored())
  const params = useMemo<Params>(() => {
    const o = stored.overrides
    const page = stored.page
    const targetId = o.targetId !== undefined ? validTarget(o.targetId) : live.targetId
    const targetFamily = targetId !== null ? getSpecies(targetId)?.family : undefined
    return {
      targetId,
      family: page.family ?? targetFamily ?? settingsFamily,
      paddocks: o.paddocks ?? live.paddocks,
      runs: page.runs ?? 20,
      tier: o.tier ?? live.tier,
      batchSize: page.batchSize ?? 10,
      sessionsPerDay: page.sessionsPerDay ?? live.sessionsPerDay,
      maxDays: page.maxDays ?? 365,
      netKind: page.netKind && NET_KINDS.includes(page.netKind) ? page.netKind : 'universel',
      selected: Array.isArray(page.selected) ? page.selected : STRATEGY_PRESETS.filter((p) => p.defaultSelected).map((p) => p.id),
      custom: {
        enabled: page.custom?.enabled ?? false,
        fromGeneration: page.custom?.fromGeneration ?? 6,
        cloning: page.custom?.cloning ?? true,
        parentLevel: o.parentLevel ?? live.parentLevel,
        makinaMode: o.makinaMode ?? live.makinaMode,
      },
      cloneKeepsLevel: page.cloneKeepsLevel ?? true,
      seed: page.seed ?? 1,
    }
  }, [stored, live, settingsFamily])
  const update = (fn: (s: StoredV2) => StoredV2) =>
    setStored((s) => {
      const next = fn(s)
      saveStored(next)
      return next
    })
  const setOverride = (o: SettingsOverrides, k: keyof SettingsOverrides, v: SettingsOverrides[keyof SettingsOverrides]) => {
    if (v === live[k]) delete o[k]
    else (o as Record<string, unknown>)[k] = v
  }
  const set = (patch: Partial<Params>) =>
    update((s) => {
      const overrides = { ...s.overrides }
      const page: Partial<PageFields> = { ...s.page }
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'targetId' || k === 'paddocks' || k === 'tier') setOverride(overrides, k, v as SettingsOverrides[typeof k])
        else if (k !== 'custom') (page as Record<string, unknown>)[k] = v
      }
      if (patch.targetId !== undefined && patch.targetId !== null) page.family = getSpecies(patch.targetId)?.family ?? page.family
      return { v: 2, page, overrides }
    })
  const setCustom = (patch: Partial<CustomStrategy>) =>
    update((s) => {
      const overrides = { ...s.overrides }
      const custom = { enabled: params.custom.enabled, fromGeneration: params.custom.fromGeneration, cloning: params.custom.cloning, ...s.page.custom }
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'parentLevel' || k === 'makinaMode') setOverride(overrides, k, v as SettingsOverrides[typeof k])
        else (custom as Record<string, unknown>)[k] = v
      }
      return { v: 2, page: { ...s.page, custom }, overrides }
    })
  const resetOverride = (k: keyof SettingsOverrides) =>
    update((s) => {
      const overrides = { ...s.overrides }
      delete overrides[k]
      return { ...s, overrides }
    })
  const activeOverrides = (Object.keys(stored.overrides) as (keyof SettingsOverrides)[]).filter((k) => stored.overrides[k] !== undefined && stored.overrides[k] !== live[k])
  const overrideValue = (k: keyof SettingsOverrides, v: SettingsOverrides[keyof SettingsOverrides]): string =>
    k === 'targetId' ? (v === null || v === undefined ? 'aucune' : (getSpecies(v as number)?.name ?? '?')) : k === 'tier' ? `palier ${v}` : k === 'makinaMode' ? (v === 'none' ? 'aucune' : v === 'all' ? 'à chaque accouplement' : 'dès une génération') : String(v)

  const target = params.targetId !== null ? getSpecies(params.targetId) : undefined
  const unlocked = paddocksForJobLevel(jobLevel)

  // ---- Stratégies à simuler
  const jobs: StrategyJob[] = useMemo(() => {
    if (!target) return []
    const base: ProgramBase = {
      targetSpeciesId: target.id,
      paddocks: params.paddocks,
      tier: params.tier,
      batchSize: params.batchSize,
      rules,
      maxDays: params.maxDays,
      runs: params.runs,
      sessionsPerDay: params.sessionsPerDay,
      seed: params.seed,
      cloneKeepsLevel: params.cloneKeepsLevel,
    }
    const list: StrategyJob[] = STRATEGY_PRESETS.filter((p) => params.selected.includes(p.id)).map((p) => ({ id: p.id, label: p.label, config: presetConfig(p, base) }))
    if (params.custom.enabled)
      list.push({
        id: CUSTOM_ID,
        label: customLabel(params.custom),
        config: { ...base, parentLevel: params.custom.parentLevel, makina: customMakina(params.custom), cloning: params.custom.cloning },
      })
    return list
  }, [target, params, rules])
  const jobsKey = useMemo(() => JSON.stringify(jobs.map((j) => [j.id, j.label, { ...j.config, rules: j.config.rules.id }])), [jobs])
  const totalRuns = jobs.length * params.runs

  // ---- Exécution (Web Worker, repli sur le fil principal)
  const [record, setRecord] = useState<RunRecord | null>(lastRun)
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const requestRef = useRef(0)

  useEffect(
    () => () => {
      requestRef.current += 1
      workerRef.current?.terminate()
      workerRef.current = null
    },
    [],
  )

  const stopWorker = () => {
    workerRef.current?.terminate()
    workerRef.current = null
  }

  const run = () => {
    if (!jobs.length) return
    stopWorker()
    const requestId = ++requestRef.current
    const key = jobsKey
    const started = Date.now()
    setError(null)
    setProgress({ done: 0, total: totalRuns, jobId: jobs[0].id, engine: 'worker' })
    const finish = (results: StrategyJobResult[], engine: Engine, durationMs: number) => {
      if (requestRef.current !== requestId) return
      const rec: RunRecord = { key, results, engine, durationMs, finishedAt: Date.now() }
      lastRun = rec
      setRecord(rec)
      setProgress(null)
      setSelectedId(null)
    }
    const fallback = () => {
      setProgress({ done: 0, total: totalRuns, jobId: jobs[0].id, engine: 'main' })
      runStrategiesAsync(jobs, {
        onProgress: (done, total, jobId) => {
          if (requestRef.current === requestId) setProgress({ done, total, jobId, engine: 'main' })
        },
        shouldStop: () => requestRef.current !== requestId,
      })
        .then((res) => {
          if (res) finish(res, 'main', Date.now() - started)
        })
        .catch((e: unknown) => {
          if (requestRef.current !== requestId) return
          setError(e instanceof Error ? e.message : String(e))
          setProgress(null)
        })
    }
    let worker: Worker | null = null
    try {
      if (typeof Worker !== 'undefined') worker = new Worker(new URL('../../domain/programSim.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      worker = null
    }
    if (!worker) {
      fallback()
      return
    }
    workerRef.current = worker
    worker.onmessage = (e: MessageEvent<ProgramWorkerMessage>) => {
      const msg = e.data
      if (msg.requestId !== requestId) return
      if (msg.type === 'progress') setProgress({ done: msg.done, total: msg.total, jobId: msg.jobId, engine: 'worker' })
      else if (msg.type === 'done') {
        stopWorker()
        finish(msg.results, 'worker', msg.durationMs)
      } else if (msg.type === 'error') {
        stopWorker()
        setError(msg.message)
        setProgress(null)
      }
    }
    worker.onerror = (ev) => {
      // Worker non pris en charge (module workers, CSP…) : on recommence sur le fil principal.
      ev.preventDefault()
      stopWorker()
      if (requestRef.current === requestId) fallback()
    }
    const req: ProgramWorkerRequest = { type: 'run', requestId, jobs }
    worker.postMessage(req)
  }

  const cancel = () => {
    requestRef.current += 1
    stopWorker()
    setProgress(null)
  }

  // ---- Résultats, coûts et recommandation (recalculés quand les prix changent)
  const outcomes: StrategyOutcome[] = useMemo(
    () =>
      (record?.results ?? []).map((r) => ({
        ...r,
        cost: estimateProgramCost(r.summary, { ctx, rules: r.summary.config.rules, tier: r.summary.config.tier, jobLevel, netKind: params.netKind, genetonValue }),
      })),
    [record, ctx, jobLevel, params.netKind, genetonValue],
  )
  const comparison = useMemo(() => (outcomes.length ? compareStrategies(outcomes) : null), [outcomes])
  const stale = record !== null && record.key !== jobsKey
  const selected = outcomes.find((o) => o.id === selectedId) ?? outcomes.find((o) => o.id === (comparison?.cheapest ?? comparison?.fastest)) ?? outcomes[0]

  const [applied, setApplied] = useState<string | null>(null)
  const apply = (o: StrategyOutcome) => {
    const cfg = o.summary.config
    updateSettings({ parentTargetLevel: cfg.parentLevel, useOptimakina: cfg.makina !== 'none', preferredTier: cfg.tier })
    // Les réglages reprennent ces valeurs : les écarts correspondants n'ont plus lieu d'être.
    update((st) => {
      const overrides = { ...st.overrides }
      delete overrides.tier
      delete overrides.parentLevel
      delete overrides.makinaMode
      return { ...st, overrides }
    })
    setApplied(
      `Réglages mis à jour : parents visés au niveau ${cfg.parentLevel}${cfg.levelByGeneration ? ' (niveau de base ; montez les hautes générations selon la stratégie)' : ''}, Optimakina ${cfg.makina === 'none' ? 'désactivée' : 'activée'}, palier ${cfg.tier} (${FUEL_TIER_NAMES[cfg.tier]}).`,
    )
  }

  // Part du programme restant depuis l'étable du joueur (le simulateur part de zéro, ux F9).
  const stableShare = useMemo(() => {
    if (!target || mounts.length === 0) return null
    try {
      return goalStatus(target.id, mounts, { parentLevel: params.custom.parentLevel, useOptimakina: params.custom.makinaMode !== 'none', rules })?.remainingShare ?? null
    } catch {
      return null
    }
  }, [target, mounts, params.custom.parentLevel, params.custom.makinaMode, rules])

  const running = progress !== null
  const runningLabel = progress ? (jobs.find((j) => j.id === progress.jobId)?.label ?? progress.jobId) : ''
  const comparable = params.paddocks === 6 && params.batchSize === 10 && params.sessionsPerDay === 2

  return (
    <>
      <PageHeader
        title="Optimiseur de stratégie"
        subtitle="Simulez un programme complet (captures → fécondations → accouplements → clonages) jusqu'à votre monture cible, puis comparez les stratégies : durée, ressources et coût."
        actions={<Badge tone="info">Règles {rules.label}</Badge>}
      />
      <MarketStatusCallouts context="coûts" showSource />

      <div className="opt-layout">
        <Card title="1. Objectif et moyens">
          <div className="grid grid-2">
            <div className="stack">
              <SpeciesPicker
                value={params.targetId}
                onChange={(v) => set({ targetId: validTarget(v) })}
                family={params.family}
                onFamilyChange={(f) => set({ family: f })}
                label="Monture cible"
              />
              {target ? (
                <div className="opt-target">
                  <SpeciesName id={target.id} />
                  <small className="muted">
                    Recette idéale : {fmtInt(minCaptures(target.id))} capture{minCaptures(target.id) > 1 ? 's' : ''} si chaque accouplement réussissait. Le simulateur ajoute le hasard des naissances, les sexes et
                    les places d'enclos.
                  </small>
                  {stableShare !== null && stableShare < 0.995 && (
                    <small className="muted">
                      <strong>Le simulateur part de zéro (étable vide).</strong> Vos montures couvrent déjà une partie du programme : il en reste ≈{' '}
                      {formatPercent(stableShare, 0)} (modèle analytique) — comptez environ cette part des durées et ressources ci-dessous. Le{' '}
                      <a href={href('plan')}>Plan d'élevage</a> applique ce prorata à votre objectif.
                    </small>
                  )}
                  <div className="row">
                    {target.id !== goalSpeciesId ? (
                      <button
                        className="btn small"
                        onClick={() => {
                          updateSettings({ goalSpeciesId: target.id })
                          resetOverride('targetId')
                        }}
                      >
                        Définir comme objectif du plan
                      </button>
                    ) : (
                      <Badge tone="accent">Objectif du plan</Badge>
                    )}
                    <a className="btn small ghost" href={href('genetique', { id: target.id })}>
                      Voir l'arbre
                    </a>
                  </div>
                  {target.generation === 1 && <Callout>Une G1 se capture directement : rien à optimiser. Choisissez une génération plus haute.</Callout>}
                </div>
              ) : (
                <Callout>Choisissez la monture que vous voulez obtenir (par défaut : l'objectif défini dans les réglages).</Callout>
              )}
            </div>
            <div className="opt-fields">
              <NumberField label="Enclos utilisés" value={params.paddocks} min={1} max={6} onChange={(v) => set({ paddocks: v })} suffix={`× ${params.batchSize} places`} />
              <NumberField label="Montures par lot (par enclos)" value={params.batchSize} min={1} max={10} onChange={(v) => set({ batchSize: v })} />
              <SelectField
                label="Palier de jauge entretenu"
                value={params.tier}
                onChange={(v) => set({ tier: v })}
                options={TIERS.map((t) => ({ value: t, label: `Palier ${t} — ${FUEL_TIER_NAMES[t]}` }))}
              />
              <NumberField label="Sessions de jeu par jour" value={params.sessionsPerDay} min={1} max={6} onChange={(v) => set({ sessionsPerDay: v })} suffix={`(cycle de ${formatNumber(24 / params.sessionsPerDay, 1)} h)`} />
              <SelectField label="Tirages Monte-Carlo" value={params.runs} onChange={(v) => set({ runs: v })} options={RUN_OPTIONS} />
              <NumberField label="Durée maximale simulée" value={params.maxDays} min={30} max={MAX_DAYS} step={30} onChange={(v) => set({ maxDays: v })} suffix="jours" />
              <SelectField
                label="Filet de capture"
                value={params.netKind}
                onChange={(v) => set({ netKind: v })}
                options={NET_KINDS.map((k) => ({ value: k, label: `${NET_KIND_LABELS[k]} (niv. ${findNet(k, params.family)?.level ?? '?'})` }))}
              />
            </div>
          </div>
          <p className="muted opt-hint">
            Votre niveau d'Éleveur ({jobLevel}) débloque {unlocked} enclos{params.paddocks > unlocked ? ` : vous en simulez ${params.paddocks}, pensez à monter le métier` : params.paddocks < unlocked ? ` : vous n'en simulez que ${params.paddocks}` : ''}. Le palier fixe le prix au point du
            carburant, la vitesse d'XP au-delà du niveau 40 et, si les sessions sont rapprochées, le nombre de cycles pour rendre un lot fécond.
          </p>
          {activeOverrides.length > 0 ? (
            <div className="opt-overrides" role="status">
              <strong>Différent de vos réglages :</strong>
              <ul>
                {activeOverrides.map((k) => (
                  <li key={k}>
                    {OVERRIDE_LABELS[k]} : {overrideValue(k, stored.overrides[k])} <span className="muted">(réglages : {overrideValue(k, live[k])})</span>{' '}
                    <button className="btn small ghost" onClick={() => resetOverride(k)}>
                      Revenir à mes réglages
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <small className="muted">Cible, enclos, palier, niveau des parents et Optimakina suivent vos <a href={href('reglages')}>Réglages</a> tant que vous ne les changez pas ici.</small>
          )}
          <details className="opt-advanced">
            <summary>Hypothèses avancées</summary>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <label className="opt-check">
                <input type="checkbox" checked={params.cloneKeepsLevel} onChange={(e) => set({ cloneKeepsLevel: e.target.checked })} />
                Le clone garde son niveau <ConfidenceBadge level="low" />
              </label>
              <NumberField label="Graine du tirage" value={params.seed} min={0} max={999_999} onChange={(v) => set({ seed: v })} />
            </div>
            <small className="muted">
              Niveau conservé au clonage : inconnu en jeu (research §4 n° 10). Sans cette hypothèse, chaque clone doit regagner son XP. La graine rend les résultats reproductibles.
            </small>
          </details>
        </Card>

        <Card title="2. Stratégies à comparer">
          <p className="muted">
            Cochez les stratégies à simuler. Chaque stratégie suit la même politique « pilotée par la demande » que la recherche : accoupler les couleurs en déficit, cloner les stériles, capturer pour remplir les
            places libres.
          </p>
          <div className="opt-presets">
            {STRATEGY_PRESETS.map((p) => {
              const checked = params.selected.includes(p.id)
              const ref = target ? researchReference(target.id, p.id, rules) : undefined
              return (
                <label key={p.id} className={`opt-preset${checked ? ' selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => set({ selected: e.target.checked ? [...params.selected, p.id] : params.selected.filter((x) => x !== p.id) })}
                  />
                  <div className="stack" style={{ gap: 4 }}>
                    <strong>{p.label}</strong>
                    <small className="muted">{p.description}</small>
                    <div className="row" style={{ gap: 4 }}>
                      <Badge>{levelPolicyLabel(p)}</Badge>
                      <Badge tone={p.makina === 'none' ? undefined : 'gold'}>{makinaPolicyLabel(p.makina)}</Badge>
                      <Badge tone={p.cloning ? 'ok' : 'danger'}>{p.cloning ? 'clonage' : 'sans clonage'}</Badge>
                    </div>
                    {ref && (
                      <small className="muted" title="Simulation Python de la recherche : 40 tirages, 60 places, cycles de 12 h.">
                        Recherche : {fmtInt(ref.captures)} captures · {fmtInt(ref.matings)} accouplements{ref.halfDays ? ` · ${fmtInt(ref.halfDays / 2)} j` : ''}
                      </small>
                    )}
                    {p.warning && <small className="opt-warn">⚠ {p.warning}</small>}
                  </div>
                </label>
              )
            })}
            <div className={`opt-preset custom${params.custom.enabled ? ' selected' : ''}`}>
              <label className="opt-check">
                <input type="checkbox" checked={params.custom.enabled} onChange={(e) => setCustom({ enabled: e.target.checked })} />
                <strong>Stratégie personnalisée</strong>
              </label>
              <small className="muted">Préremplie avec vos réglages (parents niv. {parentTargetLevel}, Optimakina {useOptimakina ? 'activée' : 'désactivée'}).</small>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <NumberField label="Niveau des parents" value={params.custom.parentLevel} min={1} max={200} onChange={(v) => setCustom({ parentLevel: v })} width={80} />
                <SelectField<MakinaMode>
                  label="Optimakina"
                  value={params.custom.makinaMode}
                  onChange={(v) => setCustom({ makinaMode: v })}
                  options={[
                    { value: 'none', label: 'Aucune' },
                    { value: 'all', label: 'À chaque accouplement' },
                    { value: 'from', label: 'Dès une génération' },
                  ]}
                />
                {params.custom.makinaMode === 'from' && (
                  <NumberField label="Génération du bébé ≥" value={params.custom.fromGeneration} min={2} max={10} onChange={(v) => setCustom({ fromGeneration: v })} width={70} />
                )}
              </div>
              <label className="opt-check">
                <input type="checkbox" checked={params.custom.cloning} onChange={(e) => setCustom({ cloning: e.target.checked })} />
                Clonage systématique des stériles
              </label>
            </div>
          </div>

          <div className="opt-run">
            <button className="btn primary" disabled={!jobs.length || running} onClick={run}>
              ▶ Lancer la simulation
            </button>
            <span className="muted">
              {jobs.length ? `${jobs.length} stratégie${jobs.length > 1 ? 's' : ''} × ${params.runs} tirages = ${fmtInt(totalRuns)} programmes simulés` : target ? 'Cochez au moins une stratégie.' : 'Choisissez une monture cible.'}
            </span>
          </div>
          {progress && (
            <div className="opt-progress" aria-live="polite">
              <Progress value={progress.done} max={progress.total} />
              <div className="row">
                <span>
                  {fmtInt(progress.done)} / {fmtInt(progress.total)} tirages — {runningLabel}
                </span>
                <span className="muted">{progress.engine === 'worker' ? 'calcul en arrière-plan (Web Worker)' : 'calcul sur la page (Web Workers indisponibles)'}</span>
                <span className="spacer" />
                <button className="btn small" onClick={cancel}>
                  Annuler
                </button>
              </div>
            </div>
          )}
          {error && (
            <Callout tone="danger">
              <strong>La simulation a échoué</strong> : {error}
            </Callout>
          )}
        </Card>

        {!record || !comparison || !selected ? (
          <Card>
            <Empty>
              {running ? 'Simulation en cours…' : 'Aucun résultat pour l\'instant : choisissez une cible, cochez des stratégies et lancez la simulation.'}
            </Empty>
          </Card>
        ) : (
          <>
            {stale && (
              <Callout tone="warn">
                Les paramètres ont changé depuis la dernière simulation (cible, moyens, stratégies ou règles) : les résultats ci-dessous correspondent à l'ancienne configuration.{' '}
                <button className="btn small" onClick={run} disabled={running || !jobs.length}>
                  Relancer
                </button>
              </Callout>
            )}

            <Card
              title="3. Recommandation"
              actions={
                <small className="muted">
                  {record.engine === 'worker' ? 'Web Worker' : 'fil principal'} · {formatNumber(record.durationMs / 1000, 1)} s
                </small>
              }
            >
              <p className="muted">
                Cible : <SpeciesName id={record.results[0]?.summary.config.targetSpeciesId ?? 0} /> — {record.results[0]?.summary.slots ?? 0} places, cycles de{' '}
                {formatNumber(record.results[0]?.summary.cycleHours ?? 12, 1)} h, {record.results[0]?.summary.runs ?? 0} tirages par stratégie.
              </p>
              {comparison.messages.map((m) => (
                <Callout key={m.title} tone={TONE[m.tone]}>
                  <strong>{m.title}</strong>
                  <div>{m.text}</div>
                </Callout>
              ))}
              <Callout>
                <strong>Rappel de la recherche</strong> : le clonage est indispensable ; viser le niveau ~40 est « gratuit » en temps ; l'Optimakina est rentable si son prix est inférieur à C × Δ / p (coût net
                du couple × gain de chance / chance actuelle), d'où l'intérêt de la réserver aux hautes générations quand les makinas basses sont chères.
              </Callout>
            </Card>

            <Card title="4. Résultats par stratégie">
              <p className="muted">
                Moyennes sur les tirages ; en petit, l'intervalle où tombent 8 tirages sur 10 (p10 – p90). ★ = meilleure valeur. Durées d'un joueur parfait : comptez ×1,5 à 2 en réel.
              </p>
              <div className="table-wrap">
                <table className="table opt-table">
                  <thead>
                    <tr>
                      <th>Stratégie</th>
                      <th className="num">Réussite</th>
                      <th className="num">Captures</th>
                      <th className="num">Accouple&shy;ments</th>
                      <th className="num">Fécon&shy;dations</th>
                      <th className="num">Clonages</th>
                      <th className="num">Durée (j)</th>
                      <th className="num">Carburant (points)</th>
                      <th className="num">Optimakinas</th>
                      <th className="num">Génétons</th>
                      <th className="num">Coût estimé</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {outcomes.map((o) => {
                      const m = o.summary.metrics
                      const ref = researchReference(o.summary.config.targetSpeciesId, o.id, o.summary.config.rules)
                      return (
                        <tr key={o.id} className={o.id === selected.id ? 'opt-row-selected' : undefined}>
                          <td>
                            <button className="opt-link" onClick={() => setSelectedId(o.id)} title="Voir le détail">
                              {o.label}
                            </button>
                            {ref && (
                              <div className="opt-range" title={`Simulation Python de la recherche (40 tirages, 60 places, cycles de 12 h)${comparable ? '' : ' : vos moyens diffèrent'}.`}>
                                Recherche{comparable ? '' : ' (60 places)'} : {fmtInt(ref.captures)} C · {fmtInt(ref.matings)} Acc{ref.halfDays ? ` · ${fmtInt(ref.halfDays / 2)} j` : ''}
                              </div>
                            )}
                          </td>
                          <td className="num">{o.summary.successRate >= 1 ? <Badge tone="ok">100 %</Badge> : <Badge tone="warn">{formatPercent(o.summary.successRate, 0)}</Badge>}</td>
                          <Cell mean={m.captures.mean} p10={m.captures.p10} p90={m.captures.p90} star={comparison.fewestCaptures === o.id ? 'Le moins de captures' : undefined} />
                          <Cell mean={m.matings.mean} p10={m.matings.p10} p90={m.matings.p90} />
                          <Cell mean={m.fecundations.mean} p10={m.fecundations.p10} p90={m.fecundations.p90} />
                          <Cell mean={m.clones.mean} />
                          <Cell mean={m.days.mean} p10={m.days.p10} p90={m.days.p90} format={fmtDays} star={comparison.fastest === o.id ? 'La plus rapide' : undefined} />
                          <Cell mean={m.totalFuelPoints.mean} p10={m.totalFuelPoints.p10} p90={m.totalFuelPoints.p90} format={fmtMillions} star={comparison.leastFuel === o.id ? 'Le moins de carburant' : undefined} />
                          <Cell mean={m.optimakinas.mean} />
                          <Cell mean={m.genetons.mean} />
                          <CostCell cost={o.cost} />
                          <td>
                            <button className="btn small" onClick={() => apply(o)} title="Reporter niveau des parents, Optimakina et palier dans les réglages">
                              Appliquer
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {applied && <Callout tone="ok">{applied}</Callout>}
              {comparison.cheapest && <small className="muted">Coût le plus bas : {outcomes.find((o) => o.id === comparison.cheapest)?.label}.</small>}
            </Card>

            <Card title="5. Graphiques">
              <div className="opt-charts">
                <BarChart
                  title="Durée jusqu'à la cible"
                  unit="jours (joueur parfait)"
                  format={fmtDays}
                  rows={outcomes.map((o) => ({ id: o.id, label: o.label, mean: o.summary.metrics.days.mean, p10: o.summary.metrics.days.p10, p90: o.summary.metrics.days.p90, best: comparison.fastest === o.id }))}
                  note="Trait fin : 8 tirages sur 10 (p10 – p90)."
                />
                <BarChart
                  title="Captures"
                  unit="montures G1"
                  format={fmtInt}
                  rows={outcomes.map((o) => ({ id: o.id, label: o.label, mean: o.summary.metrics.captures.mean, p10: o.summary.metrics.captures.p10, p90: o.summary.metrics.captures.p90, best: comparison.fewestCaptures === o.id }))}
                />
                <BarChart
                  title="Carburant"
                  unit="millions de points de jauge"
                  format={(v) => formatNumber(v / 1e6, 2)}
                  rows={outcomes.map((o) => ({ id: o.id, label: o.label, mean: o.summary.metrics.totalFuelPoints.mean, p10: o.summary.metrics.totalFuelPoints.p10, p90: o.summary.metrics.totalFuelPoints.p90, best: comparison.leastFuel === o.id }))}
                />
                {outcomes.some((o) => o.cost && o.cost.total > 0) && (
                  <BarChart
                    title="Coût estimé"
                    unit="kamas"
                    format={(v) => formatKamas(v, true)}
                    rows={outcomes.map((o) => ({ id: o.id, label: o.label, mean: o.cost?.total ?? 0, prefix: o.cost && !o.cost.complete ? '≥ ' : '', best: comparison.cheapest === o.id }))}
                    note={outcomes.some((o) => o.cost && !o.cost.complete) ? '« ≥ » : coût incomplet (borne basse), des prix manquent.' : undefined}
                  />
                )}
              </div>
            </Card>

            <StrategyDetail outcome={selected} onApply={() => apply(selected)} jobLevel={jobLevel} genetonValue={genetonValue} />
          </>
        )}

        <Caveats params={params} stableSlots={rules.stableSlots} rulesId={rules.id} />
      </div>
    </>
  )
}

// ---------- Détail d'une stratégie ----------

type DetailTab = 'cout' | 'carburant' | 'captures' | 'makinas' | 'chaine'

function StrategyDetail({ outcome, onApply, jobLevel, genetonValue }: { outcome: StrategyOutcome; onApply: () => void; jobLevel: number; genetonValue: number }) {
  const [tab, setTab] = useState<DetailTab>('cout')
  const s = outcome.summary
  const m = s.metrics
  const cfg = s.config
  const xpFrom = jobXpForLevel(jobLevel)
  const levelAfter = jobLevelFromXp(xpFrom + m.jobXp.mean)
  const zone = FAMILIES[s.family].captureZone
  return (
    <Card title={`Détail : ${outcome.label}`} actions={<button className="btn primary small" onClick={onApply}>Appliquer cette stratégie</button>}>
      <p className="muted">
        {levelPolicyLabel(cfg, true)}, {makinaPolicyLabel(cfg.makina)}, {cfg.cloning ? 'clonage systématique' : 'sans clonage'} · {s.slots} places · palier {cfg.tier} ({FUEL_TIER_NAMES[cfg.tier]}) · {cfg.sessionsPerDay} sessions par
        jour · règles {cfg.rules.id}. « Appliquer » reporte le niveau des parents, l'Optimakina et le palier dans vos réglages (plan, accouplements).
      </p>
      <div className="grid grid-4 opt-stats">
        <Stat label="Durée (joueur parfait)" value={`${fmtDays(m.days.mean)} j`} hint={`≈ ${fmtInt(m.days.mean * 1.5)} à ${fmtInt(m.days.mean * 2)} j en réel · ${fmtInt(m.cycles.mean)} sessions`} />
        <Stat label="XP d'Éleveur" value={fmtInt(m.jobXp.mean)} hint={`niv. ${jobLevel} → ${levelAfter} (accouplements ${fmtInt(m.jobXpMatings.mean)} + captures ${fmtInt(m.jobXpCaptures.mean)})`} />
        <Stat label="Génétons gagnés en route" value={fmtInt(m.genetons.mean)} hint={`≈ ${formatKamas(m.genetons.mean * genetonValue, true)} net de taxe (${formatKamas(genetonValue)} / généton net)`} />
        <Stat
          label="Pic de montures hors enclos"
          value={fmtInt(m.peakHeld.mean)}
          tone={m.peakHeld.mean > cfg.rules.stableSlots ? 'neg' : undefined}
          hint={m.peakHeld.mean > cfg.rules.stableSlots ? `Au-delà des ${cfg.rules.stableSlots} places d'étable : utilisez l'inventaire.` : `Étable : ${cfg.rules.stableSlots} places.`}
        />
        <Stat label="Accouplements réussis" value={formatPercent(m.matings.mean > 0 ? m.successes.mean / m.matings.mean : 0, 0)} hint="bébé de la couleur visée par la recette" />
        <Stat label="Montures écartées" value={fmtInt(m.surplusMounts.mean)} hint="bébés de couleurs inutiles : vente ou extraction" />
        <Stat label="Stériles restantes" value={fmtInt(m.sterileLeft.mean)} hint={`${fmtInt(m.extractResources.mean)} ressources d'extraction (${FAMILIES[s.family].extractionItemName})`} />
        <Stat label="Fécondation d'un lot" value={`${s.fecundationCycles} cycle${s.fecundationCycles > 1 ? 's' : ''}`} hint={`cycle de ${formatNumber(s.cycleHours, 1)} h au palier ${cfg.tier}`} />
      </div>

      <div className="divider" />
      <Tabs<DetailTab>
        tabs={[
          { id: 'cout', label: 'Coût' },
          { id: 'carburant', label: 'Carburant par jauge' },
          { id: 'captures', label: 'Captures' },
          { id: 'makinas', label: 'Makinas' },
          { id: 'chaine', label: 'Chaîne de croisements' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'cout' && (
        <>
          <BatchAssumption tier={cfg.tier} rules={cfg.rules} />
          <CostDetail cost={outcome.cost} />
        </>
      )}

      {tab === 'carburant' && (
        <>
          <p className="muted">
            Points consommés par les jauges (la consommation d'une jauge est la même pour 1 ou 10 montures : un lot de {cfg.batchSize} se partage 20 000 points par statistique, plus ≈ {fmtInt(cfg.serenityPointsPerBatch)} points
            de sérénité — lot idéal, minimum : un lot réel en consomme ≈ +{formatPercent(batchGap(cfg.tier, cfg.rules).fuel, 0)}). La Mangeoire compte toute l'XP donnée (niv. {cfg.parentLevel}{cfg.levelByGeneration ? ' et plus' : ''}), clones exclus si le niveau est conservé.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Jauge</th>
                  <th className="num">Points (moyenne)</th>
                  <th className="num">p10 – p90</th>
                  <th>Part</th>
                </tr>
              </thead>
              <tbody>
                {FUEL_GAUGES.map((g) => {
                  const d = s.fuelPoints[g]
                  return (
                    <tr key={g}>
                      <td>
                        <GaugeChip gauge={g} />
                      </td>
                      <td className="num">{fmtInt(d.mean)}</td>
                      <td className="num muted">
                        {fmtInt(d.p10)} – {fmtInt(d.p90)}
                      </td>
                      <td style={{ minWidth: 120 }}>
                        <Progress value={d.mean} max={m.totalFuelPoints.mean} />
                      </td>
                    </tr>
                  )
                })}
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td className="num">
                    <strong>{fmtInt(m.totalFuelPoints.mean)}</strong>
                  </td>
                  <td className="num muted">
                    {fmtInt(m.totalFuelPoints.p10)} – {fmtInt(m.totalFuelPoints.p90)}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'captures' && (
        <>
          <p className="muted">
            Montures G1 capturées en moyenne, par couleur ({fmtInt(m.captures.mean)} au total, 8 tirages sur 10 entre {fmtInt(m.captures.p10)} et {fmtInt(m.captures.p90)}). Le simulateur capture au fil de l'eau, pour remplir les
            places libres.
            {zone ? ` Zone : ${zone.subarea} (${zone.area}), zaap le plus proche : ${zone.nearestZaap.name}.` : ''}
          </p>
          {s.capturesByColor.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Couleur</th>
                    <th className="num">Captures (moyenne)</th>
                    <th>Part</th>
                  </tr>
                </thead>
                <tbody>
                  {s.capturesByColor.map((c) => (
                    <tr key={c.speciesId}>
                      <td>
                        <SpeciesName id={c.speciesId} />
                      </td>
                      <td className="num">{formatNumber(c.mean, 1)}</td>
                      <td style={{ minWidth: 120 }}>
                        <Progress value={c.mean} max={m.captures.mean} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Aucune capture.</Empty>
          )}
        </>
      )}

      {tab === 'makinas' && (
        <>
          <p className="muted">
            Une Optimakina par accouplement concerné, de génération ≥ génération cible de l'accouplement (+{formatPercent(cfg.rules.optimakinaBonus, 0)} de chance de génération cible en {cfg.rules.id}).
          </p>
          {s.makinasByGeneration.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Génération</th>
                    <th className="num">Optimakinas (moyenne)</th>
                    <th className="num">Prix unitaire</th>
                    <th className="num">Coût</th>
                  </tr>
                </thead>
                <tbody>
                  {s.makinasByGeneration.map((g) => {
                    const line = outcome.cost?.lines.find((l) => l.key === `makina:${g.generation}`)
                    return (
                      <tr key={g.generation}>
                        <td>
                          <GenBadge generation={g.generation} /> {line?.label}
                        </td>
                        <td className="num">{formatNumber(g.mean, 1)}</td>
                        <td className="num">{line ? <LineUnit line={line} /> : '—'}</td>
                        <td className="num">{line ? <LineCost line={line} /> : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Cette stratégie n'utilise pas de makina.</Empty>
          )}
        </>
      )}

      {tab === 'chaine' && (
        <>
          <p className="muted">
            Recette la moins chère en captures pour chaque couleur (comme la recherche). B = chance de génération cible du croisement avec des parents « propres » au niveau prévu.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Monture</th>
                  <th>Obtention</th>
                  <th className="num">Niveaux</th>
                  <th className="num">B</th>
                  <th>Makina</th>
                </tr>
              </thead>
              <tbody>
                {s.steps.map((st) => (
                  <tr key={st.speciesId}>
                    <td>
                      <SpeciesName id={st.speciesId} />
                    </td>
                    <td>
                      {st.crossing ? (
                        <span className="opt-cross">
                          {getSpecies(st.crossing[0])?.name} × {getSpecies(st.crossing[1])?.name}
                        </span>
                      ) : (
                        <span className="muted">capture</span>
                      )}
                    </td>
                    <td className="num">{st.parentLevels ? `${st.parentLevels[0]} + ${st.parentLevels[1]}` : '—'}</td>
                    <td className="num">{st.crossing ? formatPercent(st.targetChance, 0) : '—'}</td>
                    <td>{st.optimakina ? <Badge tone="gold">Optimakina</Badge> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}

function LineUnit({ line }: { line: ProgramCostLine }) {
  if (line.unitCost === null) return <span className="muted">?</span>
  const v = line.unit === 'points' ? `${formatNumber(line.unitCost, 2)} K/pt` : formatKamas(line.unitCost)
  return <span>{line.bound === 'max' ? `≤ ${v}` : line.bound === 'min' ? `≥ ${v}` : v}</span>
}

function LineCost({ line }: { line: ProgramCostLine }) {
  if (line.cost === null) return <span className="muted">?</span>
  const v = formatKamas(line.cost, true)
  return <span>{line.bound === 'max' ? `≤ ${v}` : line.bound === 'min' ? `≥ ${v}` : v}</span>
}

function LineStatus({ line }: { line: ProgramCostLine }) {
  if (line.complete)
    return line.estimated ? (
      <Badge tone="warn" title={line.note}>
        estimation
      </Badge>
    ) : (
      <Badge tone="ok">complet</Badge>
    )
  return (
    <span className="stack" style={{ gap: 2 }}>
      <Badge tone="danger" title={line.note}>
        {line.bound === 'max' ? 'borne haute' : 'coût incomplet'}
      </Badge>
      {line.missing.length > 0 && (
        <small>
          Prix à saisir : <MissingLinks ids={line.missing} max={3} />
        </small>
      )}
    </span>
  )
}

function CostDetail({ cost }: { cost: ProgramCost | null }) {
  if (!cost) return <Empty>Coût non calculé.</Empty>
  const tabFor = (l: ProgramCostLine) => (l.category === 'carburant' ? 'carburants' : l.category === 'makina' ? 'makinas' : 'filets')
  return (
    <>
      <p className="muted">
        Coût moyen du programme : points de chaque jauge × coût au point du carburant le moins cher (page Prix), Optimakinas par génération, filets de capture. Non déduits : le temps de jeu, la revente des surplus et des
        stériles (voir Rentabilité), les génétons.
      </p>
      {!cost.complete && (
        <Callout tone="warn">
          <strong>Coût incomplet</strong> : il manque des prix, le total ne compte que les montants connus (borne basse, jamais 0 pour un prix inconnu). À chiffrer : <MissingLinks ids={cost.missing} />.
        </Callout>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Poste</th>
              <th className="num">Quantité</th>
              <th className="num">Prix unitaire</th>
              <th className="num">Coût</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            {cost.lines.map((l) => (
              <tr key={l.key}>
                <td>
                  {l.gauge ? <GaugeChip gauge={l.gauge} /> : l.generation ? <GenBadge generation={l.generation} /> : null}{' '}
                  {l.category === 'carburant' ? (
                    <a href={href('prix', { onglet: tabFor(l) })} className="muted">
                      {l.itemId !== null ? itemName(l.itemId) : 'carburant'}
                    </a>
                  ) : (
                    <a href={href('prix', { onglet: tabFor(l), q: l.label })}>{l.label}</a>
                  )}
                </td>
                <td className="num">
                  {l.unit === 'points' ? fmtInt(l.quantity) : formatNumber(l.quantity, 1)} {l.unit}
                </td>
                <td className="num">
                  <LineUnit line={l} />
                </td>
                <td className="num">
                  <LineCost line={l} />
                </td>
                <td>
                  <LineStatus line={l} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {(['carburant', 'makina', 'capture'] as const).map((c) =>
              cost.lines.some((l) => l.category === c) ? (
                <tr key={c}>
                  <td colSpan={3}>{PROGRAM_COST_LABELS[c]}</td>
                  <td className="num">
                    {cost.byCategory[c].complete ? '' : '≥ '}
                    {formatKamas(cost.byCategory[c].cost, true)}
                  </td>
                  <td>{cost.byCategory[c].complete ? <Badge tone="ok">complet</Badge> : <Badge tone="danger">incomplet</Badge>}</td>
                </tr>
              ) : null,
            )}
            <tr>
              <td colSpan={3}>
                <strong>Total</strong>
              </td>
              <td className="num">
                <strong>
                  {cost.complete ? '' : '≥ '}
                  {formatKamas(cost.total, true)}
                </strong>
              </td>
              <td>{cost.estimated && <Badge tone="warn">dont estimation</Badge>}</td>
            </tr>
            {cost.genetonsValue !== null && (
              <tr>
                <td colSpan={3} className="muted">
                  Valeur des génétons gagnés en route (nette de taxe, non déduite)
                </td>
                <td className="num muted">{formatKamas(cost.genetonsValue, true)}</td>
                <td>
                  <ConfidenceBadge level="medium" />
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </>
  )
}

// ---------- Hypothèses et limites ----------

function Caveats({ params, stableSlots, rulesId }: { params: Params; stableSlots: number; rulesId: string }) {
  return (
    <Card title="Comment lire ces résultats">
      <div className="grid grid-2">
        <div>
          <h3>Hypothèses du simulateur</h3>
          <ul className="opt-list">
            <li>
              <strong>Joueur parfait</strong> : {params.sessionsPerDay} session{params.sessionsPerDay > 1 ? 's' : ''} par jour sans retard, une session = un cycle de {formatNumber(24 / params.sessionsPerDay, 1)} h. Comptez{' '}
              <strong>×1,5 à 2</strong> sur les durées pour un vrai joueur.
            </li>
            <li>Sexes 50/50 pour les bébés et les captures ; couleurs sauvages toujours disponibles ; ni achat ni vente de montures, pas de « porteurs ».</li>
            <li>Chances de naissance : modèle validé sur les captures en jeu ; recette la moins chère en captures pour chaque couleur ; parents à arbre « propre » choisis en priorité.</li>
            <li>
              Fécondation : 60 000 points de statistiques + ≈ 3 200 de sérénité par lot <ConfidenceBadge level="low" /> (sérénité de départ inconnue) ; lots complets supposés (un lot incomplet coûte autant).
            </li>
            <li>XP : jusqu'au niveau 40 pendant la phase d'amour (Mangeoire en 2e jauge : gratuit en temps, pas en carburant) ; au-delà, au débit du palier, en immobilisant la place d'enclos.</li>
            <li>Clonage : stériles de même génération, même couleur d'abord ; le clone doit être refécondé{params.cloneKeepsLevel ? ' et garde son niveau (hypothèse)' : ' et regagne son XP'}.</li>
            <li>
              Étable non limitée dans le calcul : le pic de montures hors enclos est affiché (capacité {stableSlots} en {rulesId}).
            </li>
          </ul>
        </div>
        <div>
          <h3>
            Enseignements de la recherche <ConfidenceBadge level="medium" />
          </h3>
          <ul className="opt-list">
            {STRATEGY.simulation.keyFindings.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
          <h3>Fidélité à la recherche</h3>
          <p className="muted">
            Portage du simulateur Monte-Carlo de la recherche (pyramid_sim.py). À 60 places et 40 tirages, Dragodinde Émeraude : 596 / 3 184 (niv. 1), 199 / 842 (niv. 40) et 112 / 387 (niv. 40 + Optimakina partout)
            captures / accouplements, contre 638 / 3 394, 188 / 821 et 111 / 378 pour la recherche. Différences voulues : sérénité 3 200 points par lot (au lieu de 3 000), Mangeoire comptée dès le niveau 1 (coût réel),
            palier, lot et cadence réglables.
          </p>
        </div>
      </div>
    </Card>
  )
}
