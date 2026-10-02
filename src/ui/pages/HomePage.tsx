// Accueil « Que faire maintenant ? » : les actions du moment, minutées et expliquées (src/domain/advisor.ts),
// avec les indicateurs clés de l'élevage, l'Almanax du jour et le suivi « fait ».
import { useEffect, useMemo, useState } from 'react'
import { FAMILIES, getSpecies, itemName } from '../../data'
import {
  ADVICE_CATEGORY_LABELS,
  PRIORITY_LABELS,
  adviseNow,
  analyzeState,
  checklistKey,
  daysBetween,
  formatIsoDay,
  groupAdvice,
  relativeTime,
  startOfDay,
  type Advice,
  type AdviceCategory,
  type AdviceHorizon,
  type AdvisorAnalysis,
  type AdvisorSettings,
} from '../../domain/advisor'
import { almanaxOn, isoDay, upcomingAlmanax } from '../../domain/almanax'
import { PADDOCK_SLOTS } from '../../domain/constants'
import type { MountPriceContext } from '../../domain/economy'
import { validateActiveGauges } from '../../domain/paddock'
import { formatClock, formatKamas, formatNumber } from '../../lib/format'
import { useInventory } from '../../store/inventory'
import { nextAlarm, usePaddockPlans } from '../../store/paddockPlans'
import { usePaddocks } from '../../store/paddocks'
import { PLAN_PROGRESS_RETENTION_MS, usePlanProgress } from '../../store/planProgress'
import { usePriceContext, usePrices } from '../../store/prices'
import { useRules, useSettings } from '../../store/settings'
import { Badge, Card, Empty, PageHeader, Progress, Stat } from '../components'
import { href } from '../router'
import './HomePage.css'

const REFRESH_MS = 30_000

const CATEGORY_ICONS: Record<AdviceCategory, string> = {
  alarme: '⏰',
  almanax: '📅',
  accouplement: '🥚',
  clonage: '🧬',
  enclos: '🌾',
  carburant: '⛽',
  capture: '🕸️',
  vente: '💰',
  metier: '🛠️',
  prix: '🏷️',
  objectif: '🎯',
}

const HORIZON_HINTS: Record<AdviceHorizon, string> = {
  maintenant: 'à faire tout de suite ou dans le quart d’heure',
  heures: 'minuté dans les 6 prochaines heures',
  aujourdhui: 'dans la journée',
  semaine: 'à planifier',
}

const dayDistance = (d: number) => (d <= 0 ? "aujourd'hui" : d === 1 ? 'demain' : `dans ${d} jours`)

const longDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const hhmm = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

/** Heure courante, rafraîchie toutes les 30 s et au retour sur l'onglet. */
function useNow(intervalMs = REFRESH_MS): [number, () => void] {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const id = window.setInterval(tick, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])
  return [now, () => setNow(Date.now())]
}

/** Entrées de l'aide construites depuis les stores (valeurs stables entre deux rendus). */
function useAdvisorStores() {
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
  const settings: AdvisorSettings = useMemo(
    () => ({ jobLevel, family, goalSpeciesId, goal, preferredTier, xpFiller, parentTargetLevel, useOptimakina, saleTax, useDefaultPrices }),
    [jobLevel, family, goalSpeciesId, goal, preferredTier, xpFiller, parentTargetLevel, useOptimakina, saleTax, useDefaultPrices],
  )
  const rules = useRules()
  const mounts = useInventory((s) => s.mounts)
  const paddocks = usePaddocks((s) => s.paddocks)
  const paddockPlans = usePaddockPlans((s) => s.plans)
  const priceCtx = usePriceContext()
  const mountOverrides = usePrices((s) => s.mounts)
  const generationOverrides = usePrices((s) => s.generations)
  const genetonValue = usePrices((s) => s.genetonValue)
  const pricedItems = Object.keys(usePrices((s) => s.items)).length
  const mountPrices: MountPriceContext = useMemo(() => ({ mountOverrides, generationOverrides, useDefaults: useDefaultPrices }), [mountOverrides, generationOverrides, useDefaultPrices])
  return { settings, rules, mounts, paddocks, paddockPlans, priceCtx, mountPrices, genetonValue, pricedItems }
}

export default function HomePage() {
  const [now, refresh] = useNow()
  const st = useAdvisorStores()
  const { settings, rules, mounts, paddocks, paddockPlans, priceCtx, mountPrices, genetonValue, pricedItems } = st
  const advance = usePaddockPlans((s) => s.advance)
  const setActive = usePaddocks((s) => s.setActive)
  const done = usePlanProgress((s) => s.done)
  const markDone = usePlanProgress((s) => s.markDone)
  const undoDone = usePlanProgress((s) => s.undoDone)
  const prune = usePlanProgress((s) => s.prune)

  useEffect(() => {
    prune(Date.now() - PLAN_PROGRESS_RETENTION_MS)
  }, [prune])

  // Calculs lourds : une fois par jour et à chaque changement de données (pas toutes les 30 s).
  const dayAnchor = startOfDay(now) + 12 * 3_600_000
  const analysis = useMemo(
    () => analyzeState({ now: dayAnchor, settings, rules, mounts, paddocks: [], paddockPlans: {}, priceCtx, mountPrices, genetonValue }),
    [dayAnchor, settings, rules, mounts, priceCtx, mountPrices, genetonValue],
  )
  const advice = useMemo(
    () => adviseNow({ now, settings, rules, mounts, paddocks, paddockPlans, priceCtx, mountPrices, genetonValue, pricedItems }, analysis),
    [now, settings, rules, mounts, paddocks, paddockPlans, priceCtx, mountPrices, genetonValue, pricedItems, analysis],
  )
  const visible = advice.filter((a) => done[a.id] === undefined)
  const doneList = advice.filter((a) => done[a.id] !== undefined)
  const groups = groupAdvice(visible, now)
  const onboarding = mounts.length === 0 ? visible.find((a) => a.id === 'onboarding:premiers-pas') : undefined
  const alarm = nextAlarm(Object.fromEntries(Object.entries(paddockPlans).filter(([, p]) => p.paddockId <= analysis.unlocked)))

  const advancePlan = (paddockId: number, to: GaugeTarget, at?: number) => {
    advance(paddockId, at)
    if (validateActiveGauges(to) === null) setActive(paddockId, to)
  }

  return (
    <div className="hp-page">
      <PageHeader
        title="Que faire maintenant ?"
        subtitle={
          <>
            <span className="hp-date">{longDate.format(now)}</span> · <strong>{hhmm.format(now)}</strong>
            <span className="muted"> — actualisé toutes les 30 s</span>
          </>
        }
        actions={
          <>
            <button className="btn small" onClick={refresh} title="Recalculer les heures maintenant">
              Actualiser
            </button>
            <a className="btn small" href={href('plan')}>
              Plan d'élevage
            </a>
          </>
        }
      />

      <AlmanaxStrip now={now} analysis={analysis} />

      {onboarding ? <OnboardingCard advice={onboarding} /> : <Kpis analysis={analysis} now={now} alarm={alarm} settings={settings} />}

      {groups.length === 0 && !onboarding && (
        <Card>
          <Empty>
            <p>
              <strong>Rien d'urgent pour l'instant.</strong>
            </p>
            <p>
              {alarm
                ? `Prochaine alarme à ${formatClock(alarm.switch.at, now)} (enclos ${alarm.paddockId}, ${relativeTime(alarm.switch.at, now)}).`
                : 'Aucun plan d’enclos minuté : démarrez un plan dans la page Enclos pour recevoir les heures de changement.'}
            </p>
            <a className="btn small" href={href('enclos')}>
              Voir les enclos
            </a>
          </Empty>
        </Card>
      )}

      {groups.map((g) => {
        const list = g.advice.filter((a) => a !== onboarding)
        if (!list.length) return null
        return (
          <section key={g.horizon} className={`hp-group ${g.horizon}`} aria-labelledby={`hp-${g.horizon}`}>
            <div className="hp-group-head">
              <h2 id={`hp-${g.horizon}`}>{g.label}</h2>
              <Badge tone={g.horizon === 'maintenant' ? 'danger' : g.horizon === 'heures' ? 'warn' : undefined}>{list.length}</Badge>
              <span className="muted hp-group-hint">{HORIZON_HINTS[g.horizon]}</span>
            </div>
            <div className="hp-list">
              {list.map((a) => (
                <AdviceCard key={a.id} advice={a} now={now} onDone={() => markDone(a.id)} onAdvance={advancePlan} />
              ))}
            </div>
          </section>
        )
      })}

      {doneList.length > 0 && (
        <details className="hp-done card">
          <summary>
            Fait récemment <Badge tone="ok">{doneList.length}</Badge>
          </summary>
          <ul>
            {doneList.map((a) => (
              <li key={a.id}>
                <span className="hp-done-title">
                  {CATEGORY_ICONS[a.category]} {a.title}
                </span>
                <span className="muted">fait {relativeTime(done[a.id], now)}</span>
                <button className="btn small ghost" onClick={() => undoDone(a.id)}>
                  Annuler
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="muted hp-footnote">
        Ordre conseillé d'une session : accouplements, clonages, captures, extractions, rangement. Les heures viennent des plans démarrés dans la page{' '}
        <a href={href('enclos')}>Enclos</a> et des niveaux de jauges saisis ; les montants utilisent vos prix (page <a href={href('prix')}>Prix</a>) et les prix par
        défaut datés de la recherche. Un prix manquant n'est jamais compté comme nul : le coût est alors marqué « incomplet ». Règles du jeu {rules.label}.
      </p>
    </div>
  )
}

// ---------- Almanax ----------

function AlmanaxStrip({ now, analysis }: { now: number; analysis: AdvisorAnalysis }) {
  const today = almanaxOn(isoDay(now))
  const todayIso = isoDay(now)
  const upcoming = [
    ...upcomingAlmanax(now, 31)
      .filter((e) => e.date !== todayIso)
      .map((e) => ({ date: e.date, label: e.name, effect: e.effect, takeza: e.takeza })),
    ...analysis.job.almanax.filter((d) => d.daysUntil > 0 && d.xpBonus > 0).map((d) => ({ date: d.date, label: d.name, effect: d.effect, takeza: false })),
  ]
    .sort((x, y) => x.date.localeCompare(y.date))
    .slice(0, 3)
  return (
    <div className={`hp-almanax${today ? ' active' : ''}`}>
      <div className="hp-almanax-today">
        <span className="hp-almanax-label">Almanax du jour</span>
        {today ? (
          <strong>
            {today.name} : {today.effect}
          </strong>
        ) : (
          <span className="muted">aucun bonus d'élevage aujourd'hui</span>
        )}
      </div>
      {upcoming.length > 0 && (
        <ul className="hp-almanax-next" aria-label="Prochains bonus">
          {upcoming.map((e) => (
            <li key={`${e.date}-${e.label}`}>
              <span className={`badge ${e.takeza ? 'gold' : 'info'}`}>{formatIsoDay(e.date)}</span> {e.label} — {e.effect}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- Indicateurs ----------

function Kpis({
  analysis,
  now,
  alarm,
  settings,
}: {
  analysis: AdvisorAnalysis
  now: number
  alarm: ReturnType<typeof nextAlarm>
  settings: AdvisorSettings
}) {
  const s = analysis.summary
  const unlocked = analysis.unlocked
  let occupiedPaddocks = 0
  let places = 0
  for (const [id, n] of s.paddock)
    if (id <= unlocked) {
      places += n
      if (n > 0) occupiedPaddocks++
    }
  const j = analysis.job
  const genetonKamas = analysis.expectedGenetons * analysis.genetonValue
  const status = [
    s.byStatus.fertile ? `${s.byStatus.fertile} fertile${s.byStatus.fertile > 1 ? 's' : ''}` : '',
    s.byStatus.feconde ? `${s.byStatus.feconde} féconde${s.byStatus.feconde > 1 ? 's' : ''}` : '',
    s.byStatus.sterile ? `${s.byStatus.sterile} stérile${s.byStatus.sterile > 1 ? 's' : ''}` : '',
    s.byStatus.senile ? `${s.byStatus.senile} sénile${s.byStatus.senile > 1 ? 's' : ''}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const goal = settings.goalSpeciesId !== null ? getSpecies(settings.goalSpeciesId) : undefined
  return (
    <div className="hp-kpis grid grid-3">
      <a className="hp-kpi" href={href('montures')}>
        <Stat label="Montures" value={formatNumber(s.total)} hint={status || 'aucune'} />
      </a>
      <a className="hp-kpi" href={href('accouplement', { onglet: 'couples' })}>
        <Stat
          label="Fécondes prêtes"
          value={formatNumber(s.byStatus.feconde)}
          hint={`${analysis.pairs.length} couple${analysis.pairs.length > 1 ? 's' : ''} au plan${s.fecundInPaddock ? ` · ${s.fecundInPaddock} en enclos à sortir` : ''}`}
        />
      </a>
      <a className="hp-kpi" href={href('enclos')}>
        <Stat
          label="Enclos occupés / débloqués"
          value={`${occupiedPaddocks} / ${unlocked}`}
          hint={`${places} / ${unlocked * PADDOCK_SLOTS} places${analysis.freeSlots ? ` · ${analysis.freeSlots} libre${analysis.freeSlots > 1 ? 's' : ''} après répartition` : ''}`}
        />
      </a>
      <a className={`hp-kpi${alarm && alarm.switch.at <= now ? ' due' : ''}`} href={href('enclos', alarm ? { enclos: alarm.paddockId } : undefined)}>
        <Stat
          label="Prochaine alarme"
          value={alarm ? formatClock(alarm.switch.at, now) : '—'}
          hint={alarm ? `${relativeTime(alarm.switch.at, now)} · enclos ${alarm.paddockId} : ${alarm.switch.text}` : 'aucun plan d’enclos démarré'}
        />
      </a>
      <a className="hp-kpi" href={href('accouplement', { onglet: 'couples' })}>
        <Stat
          label="Génétons attendus"
          value={formatNumber(analysis.expectedGenetons, analysis.expectedGenetons < 10 ? 1 : 0)}
          hint={
            <>
              ≈ {formatKamas(genetonKamas, true)} au plan actuel ({formatKamas(analysis.genetonValue)} / généton) <span className="badge warn">estimation</span>
            </>
          }
        />
      </a>
      <a className="hp-kpi" href={href('metier')}>
        <Stat
          label="Niveau d'Éleveur"
          value={j.level >= 200 ? 'niv. 200' : `niv. ${j.level} → ${j.nextPaddockLevel}`}
          hint={
            <span className="hp-job">
              <Progress value={j.progress} max={1} />
              <span>{j.level >= 200 ? 'tous les enclos sont débloqués' : `${formatNumber(j.xpToNext)} XP avant le ${j.nextPaddockIndex}e enclos`}</span>
            </span>
          }
        />
      </a>
      {goal && (
        <p className="hp-goal muted">
          Objectif : <a href={href('plan')}>{goal.name}</a> (G{goal.generation})
          {analysis.goal?.reached ? ' — atteint !' : analysis.goal && analysis.goal.capturesRemaining > 0 ? ` — ≈ ${formatNumber(analysis.goal.capturesRemaining)} captures restantes (estimation)` : ''} · famille{' '}
          {FAMILIES[settings.family]?.label ?? settings.family}
        </p>
      )}
    </div>
  )
}

// ---------- Premiers pas ----------

function OnboardingCard({ advice }: { advice: Advice }) {
  const checked = usePlanProgress((s) => s.checked)
  const toggle = usePlanProgress((s) => s.toggle)
  return (
    <Card className="hp-onboarding" title={<h2>Bienvenue dans ElevageSimu</h2>}>
      <p>{advice.detail}</p>
      <ol className="steps">
        {(advice.items ?? []).map((it) => {
          const key = checklistKey('item', advice.id, it.id)
          const isDone = it.done || checked[key] !== undefined
          return (
            <li key={it.id} className={isDone ? 'done' : undefined}>
              <div className="row hp-onboarding-step">
                <label className="hp-check">
                  <input type="checkbox" checked={isDone} disabled={it.done} onChange={() => toggle(key)} aria-label={`Fait : ${it.text}`} />
                  <strong>{it.text}</strong>
                </label>
                <span className="spacer" />
                {it.link && (
                  <a className="btn small" href={href(it.link.page, it.link.params)}>
                    {it.link.label}
                  </a>
                )}
              </div>
              {it.hint && <small>{it.hint}</small>}
            </li>
          )
        })}
      </ol>
      <div className="row">
        <a className="btn primary" href={href('montures', { captures: 1 })}>
          Enregistrer mes premières captures
        </a>
        <a className="btn" href={href('guide')}>
          Lire le guide des règles
        </a>
      </div>
    </Card>
  )
}

// ---------- Carte d'un conseil ----------

type GaugeTarget = NonNullable<Advice['action']>['to']

function AdviceCard({
  advice: a,
  now,
  onDone,
  onAdvance,
}: {
  advice: Advice
  now: number
  onDone: () => void
  onAdvance: (paddockId: number, to: GaugeTarget, at?: number) => void
}) {
  const checked = usePlanProgress((s) => s.checked)
  const toggle = usePlanProgress((s) => s.toggle)
  const late = a.dueAt !== undefined && !a.allDay && a.dueAt <= now
  const priceLink = a.missing?.length ? href('prix', { q: itemName(a.missing[0]) }) : href('prix')
  return (
    <article className={`hp-advice p${a.priority}${late ? ' late' : ''}`}>
      <div className="hp-advice-head">
        <span className={`hp-cat ${a.category}`}>
          <span aria-hidden>{CATEGORY_ICONS[a.category]}</span> {ADVICE_CATEGORY_LABELS[a.category]}
        </span>
        {a.priority <= 2 && <Badge tone={a.priority === 1 ? 'danger' : 'warn'}>{PRIORITY_LABELS[a.priority]}</Badge>}
        {a.dueAt !== undefined &&
          (a.allDay ? (
            <span className="hp-due">
              <strong>{formatIsoDay(isoDay(a.dueAt))}</strong> · {dayDistance(daysBetween(isoDay(now), isoDay(a.dueAt)))}
            </span>
          ) : (
            <span className={`hp-due${late ? ' late' : ''}`} title={new Date(a.dueAt).toLocaleString('fr-FR')}>
              <strong>{formatClock(a.dueAt, now)}</strong> · {relativeTime(a.dueAt, now)}
            </span>
          ))}
        <span className="spacer" />
        {a.confidence && a.confidence !== 'high' && (
          <Badge tone={a.confidence === 'low' ? 'warn' : 'info'} title="Valeur estimée : hypothèses détaillées dans le texte">
            {a.confidence === 'low' ? 'estimation grossière' : 'estimation'}
          </Badge>
        )}
      </div>
      <h3>{a.title}</h3>
      <p className="hp-why">{a.detail}</p>
      {a.window && (
        <p className="hp-window">
          Fenêtre de changement : <strong>{formatClock(a.window.earliest, now)}</strong> → <strong>{formatClock(a.window.latest, now)}</strong>
        </p>
      )}
      {a.items && a.items.length > 0 && (
        <ul className="hp-items">
          {a.items.map((it) => {
            const key = checklistKey('item', a.id, it.id)
            const isDone = it.done || checked[key] !== undefined
            return (
              <li key={it.id} className={`${isDone ? 'done' : ''}${it.tone ? ` ${it.tone}` : ''}`}>
                <label className="hp-check">
                  <input type="checkbox" checked={isDone} disabled={it.done} onChange={() => toggle(key)} aria-label={`Fait : ${it.text}`} />
                  <span>{it.text}</span>
                </label>
                {it.link && (
                  <a className="hp-item-link" href={href(it.link.page, it.link.params)}>
                    {it.link.label} →
                  </a>
                )}
                {it.hint && <small className="hp-item-hint">{it.hint}</small>}
              </li>
            )
          })}
        </ul>
      )}
      {a.amount && (
        <div className="hp-amount">
          <span className="muted">{a.amount.label} :</span>{' '}
          <strong>{a.amount.value === null ? '—' : `${a.amount.complete ? '' : '≥ '}${formatKamas(a.amount.value)}`}</strong>
          {!a.amount.complete && (
            <a className="badge warn" href={priceLink} title="Des prix manquent : saisissez-les sur la page Prix">
              coût incomplet
            </a>
          )}
        </div>
      )}
      {!a.amount && a.missing && a.missing.length > 0 && (
        <div className="hp-amount">
          <a className="badge warn" href={priceLink}>
            coût incomplet
          </a>
        </div>
      )}
      <div className="hp-actions">
        <a className="btn small primary" href={href(a.link.page, a.link.params)}>
          {a.link.label} →
        </a>
        {a.action?.kind === 'advance-plan' ? (
          <>
            {late && (
              <button className="btn small" onClick={() => onAdvance(a.action!.paddockId, a.action!.to)} title="Le changement a été fait à l'heure prévue">
                ✓ Fait à l'heure
              </button>
            )}
            <button className="btn small" onClick={() => onAdvance(a.action!.paddockId, a.action!.to, Date.now())} title="Le changement vient d'être fait : la suite du plan est décalée d'autant">
              {late ? '✓ Fait maintenant' : '✓ Fait maintenant (en avance)'}
            </button>
          </>
        ) : (
          <button className="btn small" onClick={onDone} title="Masquer jusqu'à ce que la situation change">
            ✓ Fait
          </button>
        )}
      </div>
    </article>
  )
}
