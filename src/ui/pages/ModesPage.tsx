// Page « Modes de rentabilité » (section Économie, docs/SPEC-v2.md §4) : comparaison des modes pour le
// profil ouvert (kamas par jour en régime permanent, production face au volume du marché, montée en
// charge, capital immobilisé, risques), calculée par le moteur de production dans un Web Worker
// (progression, annulation ; repli sur le fil principal), puis détail d'un mode : stratégie retenue et
// pourquoi, routine quotidienne précise, revenus et coûts, sensibilité au prix du produit, liquidité.
// « Activer ce mode » règle `settings.mode` (conseiller, accueil, plan) ; les résultats sont enregistrés
// pour le profil (src/store/modeResults.ts) et relus par l'accueil et le plan.
import { useEffect, useMemo, useRef, useState } from 'react'
import { FAMILIES, getSpecies, itemName } from '../../data'
import { frenchDay, PRICE_STAT_SHORT } from '../../domain/market'
import { snapshotFreshness } from '../../domain/marketInsights'
import {
  dailyRoutine,
  liquidityCheck,
  LIQUIDITY_STATUS_LABELS,
  mainRevenueCategory,
  mergedSessions,
  MODE_HORIZON_DAYS,
  modeConfig,
  modeDef,
  modeProfileContext,
  modeSensitivity,
  MODES,
  pluralItemName,
  outcomeFromSummary,
  profilePaddocks,
  rankModes,
  revenueCostBreakdown,
  storeModeResults,
  strategyParamLines,
  strategyWhy,
  type LiquidityStatus,
  type ModeId,
  type ModeOutcome,
  type ModeProfile,
  type ModeRanking,
  type ModeRoutine,
  type StoredModeResults,
} from '../../domain/modes'
import { compareModesAsync, netKindForJobLevel, runProductionAsync, sessionsForHours, strategyLabel, type ModeComparison, type ProductionSummary } from '../../domain/production'
import type { ProductionWorkerMessage, ProductionWorkerRequest } from '../../domain/production.worker'
import { NET_KIND_LABELS } from '../../domain/economy'
import { formatDate, formatKamas, formatKamasRange, formatNumber, formatPercent } from '../../lib/format'
import { useModeResults } from '../../store/modeResults'
import { profileKey, useActiveProfile, useActiveServer } from '../../store/profiles'
import { usePlanProgress } from '../../store/planProgress'
import { useSettings } from '../../store/settings'
import { Badge, Callout, Card, Empty, PageHeader, Progress, SelectField, Stat } from '../components'
import { href, navigate, useRoute } from '../router'
import { useModeContextKey, useModeProfile } from '../useModes'
import { useServerDay } from '../useServerDay'
import './ModesPage.css'

type Precision = 'rapide' | 'fine'
type Engine = 'worker' | 'main'

interface RunProgress {
  done: number
  total: number
  label: string
  engine: Engine
}

const PRECISION_OPTIONS: { value: Precision; label: string }[] = [
  { value: 'rapide', label: 'Rapide (≈ 5 s, grilles réduites)' },
  { value: 'fine', label: 'Fine (≈ 40 s, grilles complètes)' },
]

const UI_KEY = 'modes-ui'

function loadPrecision(): Precision {
  try {
    const raw = localStorage.getItem(profileKey(UI_KEY))
    const v = raw ? (JSON.parse(raw) as { precision?: unknown }).precision : null
    return v === 'fine' ? 'fine' : 'rapide'
  } catch {
    return 'rapide'
  }
}

function savePrecision(p: Precision) {
  try {
    localStorage.setItem(profileKey(UI_KEY), JSON.stringify({ precision: p }))
  } catch {
    // préférence non enregistrée : sans conséquence
  }
}

const SENS_TITLE: Record<ReturnType<typeof mainRevenueCategory>, string> = { ressources: 'de la ressource', runes: 'des runes', montures: 'des montures', genetons: 'des génétons' }

const LIQ_TONE: Record<LiquidityStatus, 'ok' | 'warn' | 'danger' | 'info'> = { ok: 'ok', limite: 'warn', sature: 'danger', inconnu: 'warn' }

const kamas = (v: number | null | undefined) => formatKamas(v ?? null, true)

/** Configuration de la progression (objectif du profil) simulée à côté de la comparaison. */
function progressionConfig(profile: ModeProfile) {
  return modeConfig('progression', profile)
}

function progressionOutcome(summary: ProductionSummary): ModeOutcome {
  const c = summary.config
  const label = strategyLabel('progression', { targetGeneration: summary.plan.targetGeneration, parentLevel: c.parentLevel, optimakina: c.optimakina, tier: c.tier, mateBeforeExtract: true })
  return outcomeFromSummary('progression', summary, label)
}

export default function ModesPage() {
  const route = useRoute()
  const profile = useModeProfile()
  const contextKey = useModeContextKey(profile)
  const activeProfile = useActiveProfile()
  const server = useActiveServer()
  const stored = useModeResults((s) => s.results)
  const save = useModeResults((s) => s.save)
  const activeModeId = useSettings((s) => s.mode)
  const update = useSettings((s) => s.update)
  const market = profile.prices.ctx.market ?? null
  const [precision, setPrecisionState] = useState<Precision>(loadPrecision)
  const setPrecision = (p: Precision) => {
    setPrecisionState(p)
    savePrecision(p)
  }

  // ---- Calcul (Web Worker, repli sur le fil principal)
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
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
    const quick = precision === 'rapide'
    const context = modeProfileContext(profile, { quick, runs: quick ? 3 : 4 })
    const progCfg = progressionConfig(profile)
    const serverId = server.id
    setError(null)
    setSaveFailed(false)
    setProgress({ done: 0, total: 1, label: 'Préparation', engine: 'worker' })
    const finish = (cmp: ModeComparison, prog: ProductionSummary | null) => {
      if (requestRef.current !== requestId) return
      const extra = prog ? [progressionOutcome(prog)] : []
      const rec = storeModeResults(cmp, profile, { computedAt: Date.now(), quick, serverId, extra })
      setSaveFailed(!save(rec))
      setProgress(null)
    }
    const fail = (message: string) => {
      if (requestRef.current !== requestId) return
      setError(message)
      setProgress(null)
    }
    const fallback = () => {
      setProgress({ done: 0, total: 1, label: 'Préparation', engine: 'main' })
      const stop = () => requestRef.current !== requestId
      compareModesAsync(context, { onProgress: (p) => !stop() && setProgress({ ...p, engine: 'main' }), shouldStop: stop })
        .then(async (cmp) => {
          if (!cmp) return
          const prog = progCfg ? await runProductionAsync(progCfg, { runs: 3, shouldStop: stop }).catch(() => null) : null
          finish(cmp, prog)
        })
        .catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
    }
    let worker: Worker | null = null
    try {
      if (typeof Worker !== 'undefined') worker = new Worker(new URL('../../domain/production.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      worker = null
    }
    if (!worker) {
      fallback()
      return
    }
    workerRef.current = worker
    let comparison: ModeComparison | null = null
    worker.onmessage = (e: MessageEvent<ProductionWorkerMessage>) => {
      const msg = e.data
      if (msg.requestId !== requestId) return
      if (msg.type === 'progress') setProgress({ done: msg.done, total: msg.total, label: msg.label, engine: 'worker' })
      else if (msg.type === 'comparison') {
        comparison = msg.result
        if (progCfg) {
          setProgress({ done: 0, total: 3, label: 'Progression (objectif du profil)', engine: 'worker' })
          worker?.postMessage({ type: 'simulate', requestId, config: progCfg, runs: 3 } satisfies ProductionWorkerRequest)
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
    worker.onerror = (ev) => {
      // Worker non pris en charge (module workers, CSP…) : on recommence sur le fil principal.
      ev.preventDefault()
      stopWorker()
      if (requestRef.current === requestId) fallback()
    }
    worker.postMessage({ type: 'compare', requestId, context } satisfies ProductionWorkerRequest)
  }

  const cancel = () => {
    requestRef.current += 1
    stopWorker()
    setProgress(null)
  }

  // Premier passage sans résultat enregistré : calcul automatique (≈ 5 s).
  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoStarted.current || stored) return
    // Minuterie annulée au démontage (double montage du mode strict) : un seul calcul démarre.
    const t = window.setTimeout(() => {
      autoStarted.current = true
      run()
    }, 0)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ranking = useMemo(() => (stored ? rankModes(stored.outcomes) : null), [stored])
  const stale = !!stored && stored.contextKey !== contextKey
  const paramMode = route.params.get('mode')
  const best = stored?.bestModeId ?? null
  const selectedId: ModeId =
    paramMode && MODES.some((m) => m.id === paramMode) ? (paramMode as ModeId) : activeModeId !== 'auto' ? activeModeId : (best ?? 'rush-corne')
  const select = (id: ModeId) => navigate('modes', { mode: id })

  const today = useServerDay()
  const freshness = market ? snapshotFreshness(market.exportDate, today) : null
  const paddocks = profilePaddocks(profile)
  const sessions = sessionsForHours(profile.hoursPerDay)
  const net = netKindForJobLevel(profile.jobLevel)

  return (
    <div className="modes-page">
      <PageHeader
        title="Modes de rentabilité"
        subtitle={
          <>
            Profil <strong>{activeProfile.name}</strong> — serveur <strong>{server.name || 'sans nom'}</strong> ·{' '}
            {market ? (
              <>
                prix HDV du <strong>{frenchDay(market.exportDate)}</strong> ({market.stat === 'auto' ? 'statistique auto' : PRICE_STAT_SHORT[market.stat]})
              </>
            ) : (
              <span className="md-warn-text">aucun export HDV importé (prix par défaut de la recherche)</span>
            )}
          </>
        }
        actions={
          progress ? (
            <button className="btn small" onClick={cancel}>
              Annuler le calcul
            </button>
          ) : (
            <button className="btn small primary" onClick={run}>
              {stored ? 'Recalculer' : 'Calculer'}
            </button>
          )
        }
      />

      {!market && (
        <Callout tone="warn">
          Aucun export HDV n’est importé pour <strong>{server.name || 'ce serveur'}</strong> : les modes sont chiffrés avec les prix par défaut de la recherche
          (datés, autre serveur) et <strong>sans plafond de liquidité</strong>. Importez l’export de votre serveur dans{' '}
          <a href={href('prix', { onglet: 'hdv' })}>Prix › Marché HDV</a> pour des montants fiables.
        </Callout>
      )}
      {freshness && freshness.level !== 'frais' && <Callout tone={freshness.tone === 'danger' ? 'danger' : 'warn'}>{freshness.message}</Callout>}

      <Card
        title="Hypothèses du profil"
        actions={
          <a className="btn small ghost" href={href('reglages')}>
            Modifier les réglages
          </a>
        }
      >
        <div className="md-assumptions">
          <Stat label="Niveau d’Éleveur" value={`niv. ${profile.jobLevel}`} hint={`${paddocks} enclos de 10 places`} />
          <Stat label="Temps de jeu" value={`${formatNumber(profile.hoursPerDay, 1)} h/jour`} hint={`${sessions} passage${sessions > 1 ? 's' : ''} aux enclos par jour`} />
          <Stat label="Captures" value={`${profile.characters} personnage${profile.characters > 1 ? 's' : ''}`} hint={NET_KIND_LABELS[net]} />
          <Stat label="Ventes" value={`≤ ${formatPercent(profile.prices.maxMarketShare ?? 0.15, 0)} du volume`} hint={`taxe ${formatPercent(profile.prices.saleTax ?? 0.02, 1)}`} />
          <Stat label="Durée simulée" value={`${MODE_HORIZON_DAYS} jours`} hint={`règles ${profile.rules.label}`} />
          <SelectField<Precision> label="Précision du calcul" value={precision} onChange={setPrecision} options={PRECISION_OPTIONS} />
        </div>
        <p className="muted md-note">
          Chaque mode est optimisé (génération, niveau des parents, Optimakina, palier, accoupler avant d’extraire ; brisage : niveau et palier) par simulation session
          par session, puis classé par bénéfice net par jour en régime permanent. Joueur parfait : comptez ×1,5 sur les durées pour un joueur réel.
        </p>
      </Card>

      {progress && (
        <Card>
          <div className="md-progress">
            <span>
              Calcul en cours : <strong>{progress.label}</strong> — {formatPercent(progress.total > 0 ? progress.done / progress.total : 0, 0)}
            </span>
            <span className="muted">{progress.engine === 'worker' ? 'en arrière-plan (Web Worker)' : 'sur la page (Web Workers indisponibles)'}</span>
            <Progress value={progress.done} max={Math.max(1, progress.total)} />
            <button className="btn small" onClick={cancel}>
              Annuler
            </button>
          </div>
        </Card>
      )}
      {error && <Callout tone="danger">Calcul impossible : {error}</Callout>}
      {saveFailed && <Callout tone="warn">Résultats calculés mais non enregistrés (stockage plein ou indisponible) : l’accueil et le plan ne pourront pas les reprendre.</Callout>}

      {stored && ranking ? (
        <>
          {stale && (
            <Callout tone="warn">
              Résultats calculés le {formatDate(stored.computedAt)} avec d’autres hypothèses (niveau {stored.context.jobLevel}, {stored.context.paddocks} enclos,{' '}
              {formatNumber(stored.context.hoursPerDay, 1)} h/jour, {stored.context.marketDate ? `prix du ${frenchDay(stored.context.marketDate)}` : 'sans export HDV'}) :{' '}
              <button className="btn small" onClick={run} disabled={!!progress}>
                Recalculer
              </button>
            </Callout>
          )}
          <BestBanner stored={stored} ranking={ranking.rows} activeModeId={activeModeId} onActivate={(id) => update({ mode: id })} />
          <ComparisonTable rows={ranking.rows} selected={selectedId} activeModeId={activeModeId} onSelect={select} stored={stored} />
          <ModeDetail
            id={selectedId}
            stored={stored}
            ranking={ranking.rows}
            activeModeId={activeModeId}
            onActivate={(id) => update({ mode: id })}
            profile={profile}
          />
        </>
      ) : (
        !progress && (
          <Card>
            <Empty>
              <p>Aucune comparaison calculée pour ce profil.</p>
              <button className="btn primary" onClick={run}>
                Comparer les modes (≈ 5 s)
              </button>
            </Empty>
          </Card>
        )
      )}
    </div>
  )
}

// ---------- Meilleur mode (« auto ») ----------

function BestBanner({ stored, ranking, activeModeId, onActivate }: { stored: StoredModeResults; ranking: ModeRanking[]; activeModeId: ModeId; onActivate: (id: ModeId) => void }) {
  const best = ranking.find((r) => r.modeId === stored.bestModeId)
  const active = modeDef(activeModeId)
  return (
    <div className="md-best">
      <div>
        <span className="md-best-label">Mode actif du profil</span>
        <strong>
          {active.icon} {active.label}
        </strong>
        {activeModeId === 'auto' && best && <span className="muted"> → {best.def.label}</span>}
      </div>
      <div>
        <span className="md-best-label">Le plus rentable par jour</span>
        {best ? (
          <strong>
            {best.def.icon} {best.def.label}
            {best.family && best.def.families.length > 1 ? ` (${FAMILIES[best.family]?.plural ?? best.family})` : ''} — {formatKamasRange(best.net, true)}/jour
          </strong>
        ) : (
          <span className="muted">aucun mode au coût chiffré (prix manquants)</span>
        )}
      </div>
      <div className="row">
        {activeModeId !== 'auto' && (
          <button className="btn small" onClick={() => onActivate('auto')} title="Suivre automatiquement le mode le plus rentable de la dernière comparaison">
            Mode automatique
          </button>
        )}
        <span className="muted md-best-date">calculé le {formatDate(stored.computedAt)}{stored.quick ? ' (précision rapide)' : ' (précision fine)'}</span>
      </div>
    </div>
  )
}

// ---------- Tableau comparatif ----------

function productCell(r: ModeRanking) {
  if (!r.available) return <span className="muted">—</span>
  const per = r.def.kind === 'brisage' ? r.outcome.strategy?.brokenPerDay : null
  return (
    <>
      {r.producedPerDay !== null ? (
        <strong>
          {formatNumber(r.producedPerDay, r.producedPerDay < 10 ? 1 : 0)} {r.productName && r.def.kind !== 'vente' ? pluralItemName(r.productName, r.producedPerDay) : r.productName}
        </strong>
      ) : (
        <span className="muted">—</span>
      )}
      {per ? <small className="md-cell-sub">{formatNumber(per, 1)} montures brisées</small> : null}
      {r.def.kind === 'vente' && r.outcome.strategy ? <small className="md-cell-sub">{formatNumber(r.outcome.strategy.mountsSoldPerDay, 1)} montures vendues</small> : null}
      <small className="md-cell-sub">
        {r.shareOfMarket !== null && r.marketPerDay !== null
          ? `${formatPercent(r.shareOfMarket, 1)} des ${formatNumber(r.marketPerDay, r.marketPerDay < 10 ? 1 : 0)} ventes/j`
          : r.capPerDay === null && r.producedPerDay
            ? 'volume inconnu'
            : ''}
      </small>
    </>
  )
}

function ComparisonTable({
  rows,
  selected,
  activeModeId,
  onSelect,
  stored,
}: {
  rows: ModeRanking[]
  selected: ModeId
  activeModeId: ModeId
  onSelect: (id: ModeId) => void
  stored: StoredModeResults
}) {
  const shown = rows.filter((r) => r.modeId !== 'auto')
  const hasProgression = shown.some((r) => r.modeId === 'progression')
  return (
    <Card title="Comparaison des modes" actions={<span className="muted">régime permanent, par jour</span>}>
      <div className="table-wrap">
        <table className="table md-table">
          <thead>
            <tr>
              <th>Mode</th>
              <th className="num">Bénéfice net / jour</th>
              <th>Production / jour face au marché</th>
              <th className="num">Montée en charge</th>
              <th className="num">Capital immobilisé</th>
              <th className="num">Point mort</th>
              <th>Risques</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const isActive = activeModeId === r.modeId || (activeModeId === 'auto' && stored.bestModeId === r.modeId)
              return (
                <tr key={r.modeId} className={`${selected === r.modeId ? 'selected' : ''}${r.available ? '' : ' unavailable'}`} onClick={() => onSelect(r.modeId)}>
                  <td>
                    <button type="button" className="md-mode-btn" onClick={() => onSelect(r.modeId)} aria-pressed={selected === r.modeId}>
                      <span aria-hidden>{r.def.icon}</span> {r.def.label}
                    </button>
                    {r.family && r.def.families.length > 1 && r.def.kind === 'vente' && <small className="md-cell-sub">{FAMILIES[r.family]?.plural ?? r.family}</small>}
                    <span className="md-badges">
                      {r.rank !== null && <Badge tone={r.best ? 'gold' : undefined}>{r.best ? '1er' : `${r.rank}e`}</Badge>}
                      {isActive && <Badge tone="accent">actif</Badge>}
                    </span>
                    {r.outcome.strategy && <small className="md-cell-sub md-strategy">{r.outcome.strategy.label}</small>}
                  </td>
                  <td className="num">
                    {r.available ? (
                      <>
                        <strong className={r.netMean < 0 ? 'neg' : undefined}>{r.scoreBasis === 'quantite' ? `${formatKamasRange(r.net, true)}` : formatKamasRange(r.net, true)}</strong>
                        {r.scoreBasis === 'quantite' && <small className="md-cell-sub">prix du produit inconnu</small>}
                        {r.outcome.digest && Math.abs(r.outcome.digest.steady.netPerDay.max - r.outcome.digest.steady.netPerDay.min) > 1 && (
                          <small className="md-cell-sub">
                            {kamas(r.outcome.digest.steady.netPerDay.min)} à {kamas(r.outcome.digest.steady.netPerDay.max)}
                          </small>
                        )}
                      </>
                    ) : (
                      <span className="muted">{r.outcome.reason ?? 'indisponible'}</span>
                    )}
                  </td>
                  <td>{productCell(r)}</td>
                  <td className="num">{r.available ? (r.rampUpDays !== null ? `${formatNumber(r.rampUpDays)} j` : '> durée') : '—'}</td>
                  <td className="num">{r.capital !== null ? kamas(r.capital) : '—'}</td>
                  <td className="num">{r.available ? (r.breakEvenDay !== null ? `jour ${formatNumber(r.breakEvenDay)}` : `> ${MODE_HORIZON_DAYS} j`) : '—'}</td>
                  <td>
                    <span className="md-risks">
                      {r.risks.length === 0 && <span className="muted">—</span>}
                      {r.risks.map((x) => (
                        <Badge key={x.code} tone={x.tone === 'danger' ? 'danger' : x.tone === 'warn' ? 'warn' : 'info'} title={x.text}>
                          {x.label}
                        </Badge>
                      ))}
                    </span>
                  </td>
                </tr>
              )
            })}
            {!hasProgression && (
              <tr className={selected === 'progression' ? 'selected' : undefined} onClick={() => onSelect('progression')}>
                <td>
                  <button type="button" className="md-mode-btn" onClick={() => onSelect('progression')}>
                    <span aria-hidden>{modeDef('progression').icon}</span> {modeDef('progression').label}
                  </button>
                  {activeModeId === 'progression' && <Badge tone="accent">actif</Badge>}
                </td>
                <td colSpan={6} className="muted">
                  Objectif de génération du Plan d’élevage (non chiffré ici).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {stored.notes.length > 0 && (
        <ul className="md-notes muted">
          {stored.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <p className="muted md-note">
        Bénéfice net = revenus (ressources, runes ou montures vendues dans la limite du volume, génétons) − coûts (filets, carburant au prix du serveur, Mangeoire,
        Optimakinas). Capital immobilisé = socle des jauges + trésorerie avancée avant que la production ne paie. Un prix inconnu n’est jamais compté 0 : montant
        « ≥ » ou « inconnu ».
      </p>
    </Card>
  )
}

// ---------- Détail d'un mode ----------

function ModeDetail({
  id,
  stored,
  ranking,
  activeModeId,
  onActivate,
  profile,
}: {
  id: ModeId
  stored: StoredModeResults
  ranking: ModeRanking[]
  activeModeId: ModeId
  onActivate: (id: ModeId) => void
  profile: ModeProfile
}) {
  const def = modeDef(id)
  const row = ranking.find((r) => r.modeId === id)
  const o = row?.outcome ?? null
  const isActive = activeModeId === id
  const routine = useMemo(() => (o && o.strategy && o.digest ? dailyRoutine(id, o, { characters: profile.characters, maxMarketShare: profile.prices.maxMarketShare }) : null), [id, o, profile.characters, profile.prices.maxMarketShare])
  const actions = (
    <>
      {isActive ? (
        <Badge tone="accent">mode actif</Badge>
      ) : (
        <button className="btn small primary" onClick={() => onActivate(id)}>
          Activer ce mode
        </button>
      )}
      <a className="btn small" href={href('investissement', { mode: id })}>
        Estimer un investissement
      </a>
    </>
  )
  const title = (
    <h2>
      <span aria-hidden>{def.icon}</span> {def.label}
    </h2>
  )
  if (id === 'auto') {
    const best = ranking.find((r) => r.modeId === stored.bestModeId)
    return (
      <Card title={title} actions={actions} className="md-detail">
        <p>{def.description}</p>
        {best ? (
          <p>
            Aujourd’hui : <a href={href('modes', { mode: best.modeId })}>{best.def.label}</a> ({formatKamasRange(best.net, true)}/jour). Le mode suivi change si une nouvelle
            comparaison en désigne un autre.
          </p>
        ) : (
          <Callout tone="warn">Aucun mode au coût chiffré : saisissez les prix manquants ou importez l’export HDV.</Callout>
        )}
      </Card>
    )
  }
  if (!o || !o.strategy || !o.digest) {
    return (
      <Card title={title} actions={actions} className="md-detail">
        <p>{def.description}</p>
        {id === 'progression' ? (
          <p className="muted">
            Ce mode suit votre objectif de génération : voir le <a href={href('plan')}>Plan d’élevage</a> et l’<a href={href('optimiseur')}>Optimiseur</a>.
          </p>
        ) : (
          <Callout tone="warn">{o?.reason ?? 'Pas encore calculé pour ce profil.'}</Callout>
        )}
      </Card>
    )
  }
  const s = o.strategy
  const d = o.digest
  const st = d.steady
  const why = strategyWhy(o)
  const params = strategyParamLines(o)
  const sens = modeSensitivity(o)
  const liq = liquidityCheck(o, profile.prices.maxMarketShare ?? 0.15)
  const breakdown = revenueCostBreakdown(o)
  const missing = d.missing
  return (
    <Card title={title} actions={actions} className="md-detail">
      <p>{def.description}</p>
      {def.risk && <Callout tone="warn">{def.risk}</Callout>}
      {!s.complete && (
        <Callout tone="warn">
          Des prix manquent : les montants sont des minimums. À chiffrer :{' '}
          {missing.slice(0, 6).map((m, i) => (
            <span key={m}>
              {i > 0 && ', '}
              <a href={href('prix', { q: itemName(m) })}>{itemName(m)}</a>
            </span>
          ))}
          {missing.length > 6 ? '…' : ''}
        </Callout>
      )}
      <div className="grid grid-4 md-kpis">
        <Stat
          label="Bénéfice net / jour"
          value={formatKamasRange(st.net, true)}
          tone={st.netPerDay.mean < 0 ? 'neg' : 'pos'}
          hint={Math.abs(st.netPerDay.max - st.netPerDay.min) > 1 ? `${kamas(st.netPerDay.min)} à ${kamas(st.netPerDay.max)} selon les tirages (${d.runs})` : `régime permanent (jours ${st.fromDay}–${st.toDay})`}
        />
        <Stat label="Revenus / coûts par jour" value={`${kamas(st.revenueKnown)} / ${kamas(st.costKnown)}`} hint={`statut : ${st.status === 'exact' ? 'exact' : st.status}`} />
        <Stat
          label="Montée en charge"
          value={s.rampUpDays !== null ? `${formatNumber(s.rampUpDays)} jours` : `> ${d.config.horizonDays} jours`}
          hint={d.firstTargetDay !== null && def.kind !== 'brisage' ? `1re G${d.config.targetGeneration} vers le jour ${formatNumber(d.firstTargetDay)}` : '90 % du régime permanent'}
        />
        <Stat
          label="Capital immobilisé"
          value={kamas(d.capital.total)}
          hint={`socle des jauges ${kamas(d.capital.socleLow)} + trésorerie ${kamas(d.capital.peakCashNeed)}${d.capital.breakEvenDay !== null ? ` · point mort jour ${d.capital.breakEvenDay}` : ''}`}
        />
      </div>
      <CumulativeChart values={d.cumulativeByDay} />

      <div className="grid grid-2 md-sections">
        <section>
          <h3>Stratégie retenue</h3>
          <p className="md-strategy-label">{s.label}</p>
          <dl className="md-params">
            {params.map((p) => (
              <div key={p.label}>
                <dt>{p.label}</dt>
                <dd>{p.value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3>Pourquoi</h3>
          <ul className="md-why">
            {why.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          {o.alternatives.length > 0 && (
            <div className="table-wrap">
              <table className="table md-alts">
                <thead>
                  <tr>
                    <th>Autres stratégies</th>
                    <th className="num">Net / jour</th>
                    <th className="num">Montée</th>
                    <th className="num">Capital</th>
                  </tr>
                </thead>
                <tbody>
                  {o.alternatives.slice(0, 4).map((a) => (
                    <tr key={a.id}>
                      <td>{a.label}</td>
                      <td className="num">{formatKamasRange(a.net, true)}</td>
                      <td className="num">{a.rampUpDays !== null ? `${formatNumber(a.rampUpDays)} j` : '—'}</td>
                      <td className="num">{kamas(a.capital)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {o.variants.length > 0 && (
            <p className="muted md-note">
              Par famille :{' '}
              {o.variants.map((v, i) => (
                <span key={v.family}>
                  {i > 0 && ' · '}
                  {FAMILIES[v.family]?.plural ?? v.family} {v.strategy ? `${formatKamasRange(v.strategy.net, true)}/jour (G${v.strategy.targetGeneration})` : 'indisponible'}
                </span>
              ))}
            </p>
          )}
        </section>
      </div>

      {routine && <RoutineView routine={routine} modeId={id} />}

      <div className="grid grid-2 md-sections">
        <section>
          <h3>Revenus et coûts par jour</h3>
          <table className="table md-breakdown">
            <tbody>
              {breakdown.revenue.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="num pos">+ {kamas(r.value)}</td>
                </tr>
              ))}
              {breakdown.cost.map((c) => (
                <tr key={c.key}>
                  <td>{c.label}</td>
                  <td className="num neg">− {kamas(c.value)}</td>
                </tr>
              ))}
              <tr className="md-total">
                <td>Bénéfice net</td>
                <td className="num">{formatKamasRange(st.net, true)}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section>
          <h3>Sensibilité au prix {SENS_TITLE[mainRevenueCategory(o)]}</h3>
          <table className="table md-sens">
            <thead>
              <tr>
                <th>Prix</th>
                <th className="num">Bénéfice net / jour</th>
                <th className="num">Écart</th>
              </tr>
            </thead>
            <tbody>
              {sens[0] && (
                <tr>
                  <td>{sens[0].label}</td>
                  <td className="num">{formatKamasRange(sens[0].net, true)}</td>
                  <td className="num neg">{kamas(sens[0].delta)}</td>
                </tr>
              )}
              <tr className="md-total">
                <td>Prix actuels</td>
                <td className="num">{formatKamasRange(st.net, true)}</td>
                <td className="num">—</td>
              </tr>
              {sens[1] && (
                <tr>
                  <td>{sens[1].label}</td>
                  <td className="num">{formatKamasRange(sens[1].net, true)}</td>
                  <td className="num pos">+{kamas(sens[1].delta)}</td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="muted md-note">À stratégie et quantités vendues inchangées (plafond de volume).</p>
        </section>
      </div>

      <section className="md-liquidity">
        <h3>Liquidité du marché</h3>
        {liq.length === 0 ? (
          <p className="muted">Rien à vendre à l’HDV dans ce mode (hors génétons).</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th className="num">Produit / jour</th>
                  <th className="num">Vendu / jour</th>
                  <th className="num">Plafond / jour</th>
                  <th className="num">Ventes du marché / jour</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {liq.slice(0, 8).map((l) => (
                  <tr key={`${l.kind}-${l.itemId}-${l.speciesId ?? ''}`}>
                    <td>{l.speciesId ? <a href={href('genetique', { id: l.speciesId })}>{getSpecies(l.speciesId)?.name ?? l.name}</a> : l.name}</td>
                    <td className="num">{formatNumber(l.producedPerDay, l.producedPerDay < 10 ? 1 : 0)}</td>
                    <td className="num">{formatNumber(l.soldPerDay, l.soldPerDay < 10 ? 1 : 0)}</td>
                    <td className="num">{l.capPerDay !== null ? formatNumber(l.capPerDay, l.capPerDay < 10 ? 1 : 0) : '?'}</td>
                    <td className="num">{l.marketPerDay !== null ? formatNumber(l.marketPerDay, l.marketPerDay < 10 ? 1 : 0) : '?'}</td>
                    <td>
                      <Badge tone={LIQ_TONE[l.status]} title={l.text}>
                        {LIQUIDITY_STATUS_LABELS[l.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted md-note">
          Plafond = {formatPercent(profile.prices.maxMarketShare ?? 0.15, 0)} des ventes quotidiennes moyennes (30 jours) de l’objet sur votre serveur (réglage du serveur) ; le
          reste est reporté au lendemain.
        </p>
      </section>

      {d.warnings.length > 0 && (
        <ul className="md-warnings">
          {d.warnings.slice(0, 6).map((w) => (
            <li key={`${w.code}-${w.text}`} className={w.tone}>
              {w.text}
            </li>
          ))}
        </ul>
      )}
      <details className="md-assumptions-list">
        <summary>Hypothèses et prix utilisés</summary>
        <ul>
          {d.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Prix</th>
                <th>Unité</th>
                <th className="num">Valeur</th>
                <th>Origine</th>
              </tr>
            </thead>
            <tbody>
              {d.prices.map((l) => (
                <tr key={l.key}>
                  <td>{l.itemId !== null ? <a href={href('prix', { q: itemName(l.itemId) })}>{l.label}</a> : l.label}</td>
                  <td>{l.unit}</td>
                  <td className="num">{l.value === null ? 'inconnu' : `${l.bound === 'min' ? '≥ ' : l.bound === 'max' ? '≤ ' : ''}${formatKamas(l.value)}`}</td>
                  <td>
                    {l.origin}
                    {l.estimated ? ' (estimation)' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  )
}

// ---------- Routine ----------

function RoutineView({ routine, modeId }: { routine: ModeRoutine; modeId: ModeId }) {
  const checked = usePlanProgress((s) => s.checked)
  const toggle = usePlanProgress((s) => s.toggle)
  const day = useServerDay()
  const key = (session: string, item: string) => `routine:${day}:mode-${modeId}-${session}:${item}`
  const sessions = mergedSessions(routine)
  return (
    <section className="md-routine">
      <h3>Routine quotidienne (régime permanent)</h3>
      <p className="muted md-note">
        {routine.summary}. Ordre d’un passage : accoupler → cloner → sortir (extraire, vendre, briser) → capturer → mettre en enclos. Les cases cochées sont enregistrées
        pour aujourd’hui.
      </p>
      <div className={`md-sessions grid grid-${Math.min(3, sessions.length + 1)}`}>
        {sessions.map((s) => (
          <div key={s.id} className="md-session">
            <h4>{s.label}</h4>
            <ul>
              {s.items.map((it) => {
                const k = key(s.id, it.id)
                return (
                  <li key={it.id} className={checked[k] !== undefined ? 'done' : undefined}>
                    <label>
                      <input type="checkbox" checked={checked[k] !== undefined} onChange={() => toggle(k)} aria-label={`Fait : ${it.text}`} />
                      <span>{it.text}</span>
                    </label>
                    {it.hint && <small>{it.hint}</small>}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        <div className="md-session daily">
          <h4>Une fois par jour</h4>
          <ul>
            {routine.daily.map((it) => {
              const k = key('jour', it.id)
              return (
                <li key={it.id} className={`${checked[k] !== undefined ? 'done' : ''}${it.tone ? ` ${it.tone}` : ''}`}>
                  <label>
                    <input type="checkbox" checked={checked[k] !== undefined} onChange={() => toggle(k)} aria-label={`Fait : ${it.text}`} />
                    <span>{it.text}</span>
                  </label>
                  {it.kamas && it.kamas.value !== null && (
                    <small className="md-amount">
                      {it.kamas.label} : {it.kamas.complete ? '' : '≥ '}
                      {formatKamas(it.kamas.value, true)}
                    </small>
                  )}
                  {it.hint && <small>{it.hint}</small>}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
      {routine.notes.length > 0 && (
        <ul className="md-notes muted">
          {routine.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------- Courbe de trésorerie ----------

/** Cumul connu moyen jour après jour (SVG fait main) : montée en charge et point mort. */
function CumulativeChart({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const W = 600
  const H = 120
  const pad = 4
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const span = max - min || 1
  const x = (i: number) => pad + (i / (values.length - 1)) * (W - 2 * pad)
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - 2 * pad)
  const path = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = values[values.length - 1]
  return (
    <figure className="md-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cumul du bénéfice sur ${values.length} jours : ${formatKamas(last, true)} à la fin`} preserveAspectRatio="none">
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="md-chart-zero" />
        <path d={path} className="md-chart-line" />
      </svg>
      <figcaption className="muted">
        Cumul du bénéfice jour après jour (socle non compris) : {kamas(Math.min(...values))} au plus bas, {kamas(last)} au jour {values.length}.
      </figcaption>
    </figure>
  )
}
