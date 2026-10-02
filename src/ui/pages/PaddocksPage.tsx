// Page « Enclos » : les 6 enclos (débloqués ou non), montures présentes, saisie des jauges, plan de
// fécondité recommandé avec heures absolues, plan démarré (compte à rebours, alarmes, notifications),
// simulation avec les jauges saisies, carburant nécessaire et répartition automatique.
// Logique : src/domain/paddockAssign.ts (+ fertility.ts, paddock.ts, fuel.ts) ; plans : store paddockPlans.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { itemName } from '../../data'
import { almanaxOn, isoDay, type AlmanaxEffect } from '../../domain/almanax'
import { FUEL_TIER_NAMES, GAUGE_EFFECTS, GAUGE_IDS, GAUGE_LABELS, MAX_ACTIVE_GAUGES, PADDOCK_SLOTS, PADDOCK_UNLOCK_LEVELS } from '../../domain/constants'
import type { FertilityPlan, FertilityStep } from '../../domain/fertility'
import { locationLabel, SERENITY_BANDS, SERENITY_SMILEYS, unlockedPaddocks } from '../../domain/mountFate'
import { effectiveFertility, GENDER_ICONS, mountName } from '../../domain/mounts'
import { canBenefit, gaugeDrainSeconds, gaugeTier, serenityBand, validateActiveGauges, type SimulateResult } from '../../domain/paddock'
import {
  allocationAdvice,
  assignPaddocks,
  gaugeSwitch,
  needsFertility,
  PADDOCK_ROLE_LABELS,
  paddockRole,
  planPaddock,
  refillAdvice,
  simulateCurrent,
  simulationTimeline,
  stepTimes,
  toFillerSim,
  toSimMount,
  xpSeconds,
  type AssignResult,
  type RefillAdvice,
  type TimelineEntry,
} from '../../domain/paddockAssign'
import { gaugeMax, type Ruleset } from '../../domain/rules'
import type { FuelTier, GaugeId, Mount, PaddockState } from '../../domain/types'
import { mountLevelFromXp, mountXpForLevel } from '../../domain/xp'
import { formatClock, formatDuration, formatKamas, formatNumber } from '../../lib/format'
import { useInventory } from '../../store/inventory'
import { currentStep, nextAlarm, usePaddockPlans, type ActivePaddockPlan } from '../../store/paddockPlans'
import { usePaddocks } from '../../store/paddocks'
import { usePriceContext } from '../../store/prices'
import { useRules, useSettings } from '../../store/settings'
import { GaugeBars, SerenitySmiley, StatusBadge } from '../MountEditor'
import { Badge, Callout, Card, Empty, GaugeChip, PageHeader, Progress, Stat, Tabs } from '../components'
import { href, navigate, useRoute } from '../router'
import { ConfidenceBadge, SpeciesName } from '../species'
import './PaddocksPage.css'

type TabId = 'enclos' | 'repartition'
const TIERS: FuelTier[] = [1, 2, 3, 4]
const NOTIF_KEY = 'elevagesimu:enclos-notifications'
const SHORT_STEP_SECONDS = 600

// ---------- Utilitaires ----------

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

function relative(at: number, now: number): string {
  const d = (at - now) / 1000
  if (Math.abs(d) < 30) return 'maintenant'
  return d > 0 ? `dans ${formatDuration(d)}` : `il y a ${formatDuration(-d)}`
}

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // stockage indisponible : réglage non mémorisé
  }
}

/** Heure de nuit (23 h – 7 h) : une jauge de sérénité ne doit pas tourner sans surveillance. */
function overlapsNight(startAt: number, endAt: number): boolean {
  for (let t = startAt; t <= endAt; t += 15 * 60_000) {
    const h = new Date(t).getHours()
    if (h >= 23 || h < 7) return true
  }
  const h = new Date(endAt).getHours()
  return h >= 23 || h < 7
}

const inPaddock = (m: Mount, p: number) => m.location.kind === 'enclos' && m.location.paddock === p

function MountLabel({ m }: { m: Mount }) {
  return (
    <span className="pd-mount-label">
      <SpeciesName id={m.speciesId} />
      <span className="muted" title={m.gender === 'male' ? 'Mâle' : 'Femelle'}>
        {GENDER_ICONS[m.gender]}
      </span>
      {m.name?.trim() && <small>« {m.name.trim()} »</small>}
    </span>
  )
}

/** Horloge qui avance toutes les 15 s, et pile à l'heure des prochains changements. */
function useNow(wakeAt: number[]): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [])
  const upcoming = wakeAt.filter((t) => t > now)
  const nextWake = upcoming.length ? Math.min(...upcoming) : null
  useEffect(() => {
    if (nextWake === null) return
    const delay = Math.min(2_147_000_000, Math.max(0, nextWake - Date.now() + 250))
    const id = window.setTimeout(() => setNow(Date.now()), delay)
    return () => window.clearTimeout(id)
  }, [nextWake])
  return now
}

type NotifState = NotificationPermission | 'unsupported'

function useNotifications() {
  const supported = typeof window !== 'undefined' && 'Notification' in window
  const [permission, setPermission] = useState<NotifState>(() => (supported ? Notification.permission : 'unsupported'))
  const [enabled, setEnabledState] = useState(() => readLocal(NOTIF_KEY) === '1')
  const setEnabled = (v: boolean) => {
    setEnabledState(v)
    writeLocal(NOTIF_KEY, v ? '1' : '0')
  }
  const request = async () => {
    if (!supported) return
    const p = await Notification.requestPermission()
    setPermission(p)
    if (p === 'granted') setEnabled(true)
  }
  const notify = (title: string, body: string, tag: string) => {
    if (!supported || permission !== 'granted' || !enabled) return
    try {
      new Notification(title, { body, tag })
    } catch {
      // certains navigateurs (mobile) refusent le constructeur hors service worker
    }
  }
  return { supported, permission, enabled: enabled && permission === 'granted', setEnabled, request, notify }
}

// ---------- Page ----------

export default function PaddocksPage() {
  const route = useRoute()
  const tab: TabId = route.params.get('onglet') === 'repartition' ? 'repartition' : 'enclos'
  const selected = Math.max(1, Math.min(PADDOCK_UNLOCK_LEVELS.length, Number(route.params.get('enclos')) || 1))

  const rules = useRules()
  const jobLevel = useSettings((s) => s.jobLevel)
  const mounts = useInventory((s) => s.mounts)
  const paddockStates = usePaddocks((s) => s.paddocks)
  const plans = usePaddockPlans((s) => s.plans)
  const advance = usePaddockPlans((s) => s.advance)
  const setActive = usePaddocks((s) => s.setActive)

  const wakeAt = useMemo(
    () =>
      Object.values(plans).flatMap((p) => {
        const pr = currentStep(p, 0)
        return pr.next ? [pr.next.at, ...(pr.next.latest ? [pr.next.latest] : [])] : []
      }),
    [plans],
  )
  const now = useNow(wakeAt)
  const notif = useNotifications()
  const K = unlockedPaddocks(jobLevel)
  const almanax = almanaxOn(isoDay(now))
  const almanaxDoubled = almanax?.doubledGauge ?? null

  // Notifications : une seule par changement dû.
  const notified = useRef(new Set<string>())
  useEffect(() => {
    for (const p of Object.values(plans)) {
      const pr = currentStep(p, now)
      if (!pr.next || !pr.due) continue
      const key = `${p.paddockId}:${pr.next.index}:${pr.next.at}`
      if (notified.current.has(key)) continue
      notified.current.add(key)
      notif.notify(`ElevageSimu — Enclos ${p.paddockId}`, `À ${formatClock(pr.next.at, now)} : ${capitalize(pr.next.text)}.`, `enclos-${p.paddockId}`)
    }
  }, [plans, now, notif])

  const occupancy = mounts.filter((m) => m.location.kind === 'enclos').length
  const toFecund = mounts.filter((m) => (m.location.kind === 'etable' || m.location.kind === 'enclos') && needsFertility(m))
  const alarm = nextAlarm(plans)
  const dues = Object.values(plans)
    .map((p) => ({ plan: p, progress: currentStep(p, now) }))
    .filter((x) => x.progress.due)
    .sort((a, b) => (a.progress.next?.at ?? 0) - (b.progress.next?.at ?? 0))

  const doAdvance = (p: ActivePaddockPlan, at?: number) => {
    const pr = currentStep(p, now)
    advance(p.paddockId, at)
    if (pr.next && validateActiveGauges(pr.next.to) === null) setActive(p.paddockId, pr.next.to)
  }

  return (
    <div className="pd-page">
      <PageHeader
        title="Enclos"
        subtitle="Jauges, placement des montures, plan de fécondité minuté et alarmes de changement."
        actions={<NotificationControl notif={notif} />}
      />

      <div className="grid grid-4 pd-summary">
        <Stat
          label="Enclos débloqués"
          value={`${K} / ${PADDOCK_UNLOCK_LEVELS.length}`}
          hint={K < PADDOCK_UNLOCK_LEVELS.length ? `Prochain au niveau ${PADDOCK_UNLOCK_LEVELS[K].level} d'Éleveur (vous : ${jobLevel})` : 'Tous les enclos sont débloqués'}
        />
        <Stat label="Places occupées" value={`${occupancy} / ${K * PADDOCK_SLOTS}`} hint={`${mounts.filter((m) => m.location.kind === 'etable').length} monture(s) à l'étable`} />
        <Stat
          label="À rendre fécondes"
          value={formatNumber(toFecund.length)}
          hint={`dont ${toFecund.filter((m) => m.location.kind === 'enclos').length} déjà en enclos`}
        />
        <Stat
          label="Prochaine alarme"
          value={alarm ? formatClock(alarm.switch.at, now) : '—'}
          hint={alarm ? `Enclos ${alarm.paddockId}, ${relative(alarm.switch.at, now)} : ${alarm.switch.text}` : 'Aucun plan démarré'}
        />
      </div>

      {almanax && <AlmanaxBanner effect={almanax} />}

      {dues.map(({ plan, progress }) => (
        <Callout key={plan.paddockId} tone={progress.late ? 'danger' : 'warn'}>
          <div className="row">
            <strong>
              Enclos {plan.paddockId} — à {formatClock(progress.next!.at, now)} : {capitalize(progress.next!.text)}.
            </strong>
            {progress.late && <Badge tone="danger">fenêtre dépassée</Badge>}
            <span className="spacer" />
            <button className="btn small primary" onClick={() => doAdvance(plan)}>
              Fait à l'heure
            </button>
            <button className="btn small" onClick={() => doAdvance(plan, Date.now())}>
              Fait maintenant
            </button>
            {(tab !== 'enclos' || selected !== plan.paddockId) && (
              <a className="btn small ghost" href={href('enclos', { enclos: plan.paddockId })}>
                Voir l'enclos
              </a>
            )}
          </div>
        </Callout>
      ))}

      <Tabs<TabId>
        tabs={[
          { id: 'enclos', label: 'Mes enclos' },
          { id: 'repartition', label: 'Répartition automatique' },
        ]}
        value={tab}
        onChange={(t) => navigate('enclos', t === 'enclos' ? { enclos: selected } : { onglet: t })}
      />

      {tab === 'enclos' ? (
        <>
          <PaddockGrid selected={selected} unlocked={K} mounts={mounts} states={paddockStates} plans={plans} now={now} />
          {mounts.length === 0 && (
            <Callout>
              Aucune monture enregistrée. Ajoutez vos montures (et leur emplacement) dans <a href={href('montures')}>Mes montures</a> pour obtenir les plans
              de fécondité et la répartition automatique.
            </Callout>
          )}
          {selected > K ? (
            <LockedPaddock id={selected} jobLevel={jobLevel} count={mounts.filter((m) => inPaddock(m, selected)).length} />
          ) : (
            <PaddockDetail
              key={selected}
              id={selected}
              mounts={mounts.filter((m) => inPaddock(m, selected))}
              state={paddockStates.find((p) => p.id === selected)}
              plan={plans[String(selected)]}
              now={now}
              rules={rules}
              almanaxDoubled={almanaxDoubled}
              onAdvance={doAdvance}
            />
          )}
        </>
      ) : (
        <AutoAssign mounts={mounts} unlocked={K} rules={rules} almanaxDoubled={almanaxDoubled} plans={plans} now={now} />
      )}
    </div>
  )
}

// ---------- En-tête : notifications, Almanax ----------

function NotificationControl({ notif }: { notif: ReturnType<typeof useNotifications> }) {
  if (!notif.supported) return <Badge>Notifications non prises en charge</Badge>
  if (notif.permission === 'denied')
    return (
      <Badge tone="warn" title="Autorisez les notifications pour ce site dans les réglages du navigateur.">
        Notifications bloquées par le navigateur
      </Badge>
    )
  if (notif.permission !== 'granted')
    return (
      <button className="btn" onClick={() => void notif.request()} title="Prévenir à l'heure de chaque changement de jauges (page ouverte)">
        🔔 Activer les notifications
      </button>
    )
  return (
    <label className="row pd-notif">
      <input type="checkbox" checked={notif.enabled} onChange={(e) => notif.setEnabled(e.target.checked)} />
      🔔 Notifications des changements
      {notif.enabled && (
        <button className="btn small ghost" onClick={() => notif.notify('ElevageSimu', 'Les alarmes des enclos fonctionnent.', 'test')}>
          Tester
        </button>
      )}
    </label>
  )
}

function AlmanaxBanner({ effect }: { effect: AlmanaxEffect }) {
  return (
    <Callout tone="ok">
      <strong>Almanax du jour — {effect.name}</strong> : {effect.effect}.{' '}
      {effect.doubledGauge && (
        <>
          Le gain de <GaugeChip gauge={effect.doubledGauge} /> est doublé (modélisé ×2 à consommation égale, effet exact non vérifié) : les plans ci-dessous en
          tiennent compte.
        </>
      )}
    </Callout>
  )
}

// ---------- Grille des 6 enclos ----------

function PaddockGrid({
  selected,
  unlocked,
  mounts,
  states,
  plans,
  now,
}: {
  selected: number
  unlocked: number
  mounts: Mount[]
  states: PaddockState[]
  plans: Record<string, ActivePaddockPlan>
  now: number
}) {
  return (
    <div className="pd-grid" role="list">
      {PADDOCK_UNLOCK_LEVELS.map((info, i) => {
        const id = i + 1
        const locked = id > unlocked
        const inside = mounts.filter((m) => inPaddock(m, id))
        const state = states.find((s) => s.id === id)
        const plan = plans[String(id)]
        const progress = plan ? currentStep(plan, now) : null
        const fecund = inside.filter((m) => effectiveFertility(m) === 'feconde').length
        const bands = SERENITY_BANDS.map((b) => ({ b, n: inside.filter((m) => needsFertility(m) && serenityBand(m.serenity) === b).length })).filter((x) => x.n > 0)
        return (
          <a
            key={id}
            role="listitem"
            href={href('enclos', { enclos: id })}
            className={`pd-card${id === selected ? ' selected' : ''}${locked ? ' locked' : ''}${progress?.due ? ' due' : ''}`}
            aria-current={id === selected ? 'true' : undefined}
          >
            <div className="pd-card-head">
              <strong>Enclos {id}</strong>
              <span className="pd-coords">{info.coords}</span>
            </div>
            <small className="muted">{info.name}</small>
            {locked ? (
              <div className="pd-card-locked">🔒 Éleveur niveau {info.level} requis</div>
            ) : (
              <>
                <div className="pd-card-occ">
                  <span>
                    {inside.length}/{PADDOCK_SLOTS}
                  </span>
                  <Progress value={inside.length} max={PADDOCK_SLOTS} />
                </div>
                <div className="pd-card-bands">
                  {bands.map(({ b, n }) => (
                    <span key={b} className={`mt-smiley ${SERENITY_SMILEYS[b].color}`} title={`${n} à rendre fécondes — ${SERENITY_SMILEYS[b].label}`}>
                      <span className="mt-smiley-face">{SERENITY_SMILEYS[b].face}</span>
                      <span className="mt-smiley-value">×{n}</span>
                    </span>
                  ))}
                  {fecund > 0 && <Badge tone="ok">{fecund} féconde{fecund > 1 ? 's' : ''}</Badge>}
                </div>
                <div className="pd-card-gauges">
                  {state && state.active.length > 0 ? state.active.map((g) => <GaugeChip key={g} gauge={g} />) : <small className="muted">Aucune jauge active</small>}
                </div>
                <div className="pd-card-plan">
                  {progress ? (
                    progress.finished ? (
                      <Badge tone="ok">Plan terminé</Badge>
                    ) : progress.next ? (
                      <span className={progress.due ? 'pd-due-text' : ''}>
                        ⏰ {formatClock(progress.next.at, now)} <small>({relative(progress.next.at, now)})</small>
                      </span>
                    ) : null
                  ) : (
                    <small className="muted">Aucun plan démarré</small>
                  )}
                </div>
              </>
            )}
          </a>
        )
      })}
    </div>
  )
}

function LockedPaddock({ id, jobLevel, count }: { id: number; jobLevel: number; count: number }) {
  const info = PADDOCK_UNLOCK_LEVELS[id - 1]
  return (
    <Card title={`Enclos ${id} — ${info.name}`}>
      <Empty>
        🔒 Cet enclos ({info.coords}, Village des Éleveurs) se débloque au <strong>niveau {info.level}</strong> du métier d'Éleveur. Vous êtes niveau {jobLevel}.
        <br />
        <a href={href('metier')}>Voir la montée du métier</a> · <a href={href('reglages')}>Modifier mon niveau</a>
      </Empty>
      {count > 0 && (
        <Callout tone="warn">
          {count} monture{count > 1 ? 's sont enregistrées' : ' est enregistrée'} dans cet enclos verrouillé : vérifiez leur emplacement dans{' '}
          <a href={href('montures', { lieu: `enclos-${id}` })}>Mes montures</a>.
        </Callout>
      )}
    </Card>
  )
}

// ---------- Détail d'un enclos ----------

interface Recommended {
  plan: FertilityPlan | null
  fertileIds: string[]
}

function PaddockDetail({
  id,
  mounts,
  state,
  plan,
  now,
  rules,
  almanaxDoubled,
  onAdvance,
}: {
  id: number
  mounts: Mount[]
  state: PaddockState | undefined
  plan: ActivePaddockPlan | undefined
  now: number
  rules: Ruleset
  almanaxDoubled: GaugeId | null
  onAdvance: (p: ActivePaddockPlan, at?: number) => void
}) {
  const tier = useSettings((s) => s.preferredTier)
  const withXp = useSettings((s) => s.xpFiller)
  const parentTarget = useSettings((s) => s.parentTargetLevel)
  const updateSettings = useSettings((s) => s.update)
  const paddockState: PaddockState = state ?? { id, gauges: { baffeur: 0, caresseur: 0, foudroyeur: 0, abreuvoir: 0, dragofesse: 0, mangeoire: 0 }, active: [], updatedAt: 0 }
  const info = PADDOCK_UNLOCK_LEVELS[id - 1]

  const recommended: Recommended = useMemo(() => {
    const fertile = mounts.filter(needsFertility)
    if (fertile.length === 0) return { plan: null, fertileIds: [] }
    const others = mounts.filter((m) => !needsFertility(m))
    const p = planPaddock([...fertile.map(toSimMount), ...others.map(toFillerSim)], { tier, withXp, almanaxDoubled, rules })
    return { plan: p, fertileIds: fertile.map((m) => m.id) }
  }, [mounts, tier, withXp, almanaxDoubled, rules])

  // Heure de référence du plan recommandé (« si vous démarrez maintenant »), figée à la minute.
  const planStart = Math.floor(now / 60_000) * 60_000

  const fecundEta = (m: Mount): number | null => {
    if (plan && plan.mountIds.includes(m.id) && plan.fecundAt[m.id] !== undefined) return plan.startedAt + plan.offsetMs + plan.fecundAt[m.id] * 1000
    const s = recommended.plan?.fecundAt[m.id]
    return s === undefined ? null : planStart + s * 1000
  }
  const endLevel = (m: Mount): number | null => {
    const sim = recommended.plan?.mounts.find((x) => x.id === m.id)
    if (!sim || !sim.xpGained) return null
    return mountLevelFromXp(mountXpForLevel(m.level) + sim.xpGained)
  }

  return (
    <div className="stack pd-detail">
      <Card
        title={
          <div className="row">
            <h2>
              Enclos {id} — {info.name}
            </h2>
            <span className="pd-coords">{info.coords}</span>
            <Badge tone={mounts.length >= PADDOCK_SLOTS ? 'ok' : mounts.length > 0 ? 'info' : undefined}>
              {mounts.length}/{PADDOCK_SLOTS} places
            </Badge>
          </div>
        }
        actions={
          <a className="btn small" href={href('montures', { lieu: `enclos-${id}` })}>
            Gérer dans Mes montures
          </a>
        }
      >
        {mounts.length === 0 ? (
          <Empty>
            Aucune monture dans cet enclos. Utilisez la <a href={href('enclos', { onglet: 'repartition' })}>répartition automatique</a> ou changez
            l'emplacement de vos montures dans <a href={href('montures')}>Mes montures</a>.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Monture</th>
                  <th>Sérénité</th>
                  <th>E / M / A</th>
                  <th className="num">Niveau</th>
                  <th>Statut</th>
                  <th>Féconde vers</th>
                </tr>
              </thead>
              <tbody>
                {[...mounts]
                  .sort((a, b) => a.serenity - b.serenity)
                  .map((m) => {
                    const f = effectiveFertility(m)
                    const eta = f === 'fertile' ? fecundEta(m) : null
                    const lvl = endLevel(m)
                    return (
                      <tr key={m.id}>
                        <td>
                          <a href={href('montures', { id: m.id })} className="pd-plain-link" title="Modifier la monture">
                            <MountLabel m={m} />
                          </a>
                        </td>
                        <td>
                          <SerenitySmiley serenity={m.serenity} withValue />
                        </td>
                        <td>
                          <GaugeBars mount={m} />
                        </td>
                        <td className="num">
                          {m.level}
                          {lvl !== null && lvl > m.level && <small className="muted"> → {lvl}</small>}
                        </td>
                        <td>
                          <StatusBadge status={f} />
                        </td>
                        <td>
                          {f === 'feconde' ? (
                            <span className="muted">déjà féconde — à sortir vers l'étable</span>
                          ) : f !== 'fertile' ? (
                            <span className="muted">—</span>
                          ) : eta !== null ? (
                            <span title={relative(eta, now)}>
                              {formatClock(eta, now)} <small className="muted">({relative(eta, now)})</small>
                            </span>
                          ) : (
                            <span className="muted">au-delà du plan</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted pd-note">
          « Féconde vers » : d'après le plan démarré, sinon d'après le plan recommandé s'il était démarré maintenant. Poser ou retirer une monture demande d'être sur
          une carte d'enclos en jeu ; tout le reste (jauges, carburant, accouplement depuis l'étable) se fait à distance.
        </p>
      </Card>

      <GaugeEditor paddock={paddockState} mounts={mounts} rules={rules} now={now} />

      {plan ? (
        <ActivePlanCard plan={plan} mounts={mounts} now={now} onAdvance={onAdvance} />
      ) : (
        <RecommendedPlanCard
          id={id}
          mounts={mounts}
          recommended={recommended}
          paddock={paddockState}
          planStart={planStart}
          now={now}
          tier={tier}
          withXp={withXp}
          parentTarget={parentTarget}
          rules={rules}
          almanaxDoubled={almanaxDoubled}
          onTier={(t) => updateSettings({ preferredTier: t })}
          onWithXp={(v) => updateSettings({ xpFiller: v })}
        />
      )}

      <FuelCard paddock={paddockState} plan={plan} recommended={recommended.plan} fertileCount={plan ? plan.mountIds.length : recommended.fertileIds.length} rules={rules} tier={plan ? plan.tier : tier} />

      <SimulationCard paddock={paddockState} mounts={mounts} rules={rules} almanaxDoubled={almanaxDoubled} now={now} />
    </div>
  )
}

// ---------- Saisie des jauges ----------

function GaugeEditor({ paddock, mounts, rules, now }: { paddock: PaddockState; mounts: Mount[]; rules: Ruleset; now: number }) {
  const setGauge = usePaddocks((s) => s.setGauge)
  const setActive = usePaddocks((s) => s.setActive)
  const max = gaugeMax(rules)
  const error = validateActiveGauges(paddock.active)
  const sims = useMemo(() => mounts.map(toSimMount), [mounts])

  const toggle = (g: GaugeId, on: boolean) => {
    let next = on ? [...paddock.active.filter((x) => x !== g), g] : paddock.active.filter((x) => x !== g)
    if (on && g === 'baffeur') next = next.filter((x) => x !== 'caresseur')
    if (on && g === 'caresseur') next = next.filter((x) => x !== 'baffeur')
    if (next.length > MAX_ACTIVE_GAUGES) next = next.slice(next.length - MAX_ACTIVE_GAUGES)
    setActive(paddock.id, next)
  }

  return (
    <Card
      title="Jauges de l'enclos"
      actions={
        paddock.updatedAt > 0 ? (
          <small className="muted" title="Les niveaux saisis ne baissent pas tout seuls : ressaisissez-les en passant devant l'enclos.">
            Saisi {formatClock(paddock.updatedAt, now)} ({relative(paddock.updatedAt, now)})
          </small>
        ) : (
          <small className="muted">Saisissez les niveaux lus en jeu</small>
        )
      }
    >
      <p className="muted pd-note">
        Au plus {MAX_ACTIVE_GAUGES} jauges actives ; Baffeur et Caresseur s'excluent. Une jauge consomme autant avec 1 ou 10 montures éligibles : visez 10 montures
        éligibles par jauge active. Paliers ({rules.label}) : {TIERS.map((t) => `${t} ≤ ${formatNumber(rules.gaugeTierMax[t])}`).join(' · ')}.
      </p>
      <div className="pd-gauges">
        {GAUGE_IDS.map((g) => {
          const v = paddock.gauges[g] ?? 0
          const t = gaugeTier(v, rules)
          const active = paddock.active.includes(g)
          const eligible = sims.filter((s) => canBenefit(g, s)).length
          const drain = t === 0 ? 0 : gaugeDrainSeconds(v, 0, rules)
          const nextTier = t > 1 ? gaugeDrainSeconds(v, rules.gaugeTierMax[(t - 1) as FuelTier], rules) : null
          return (
            <div key={g} className={`pd-gauge-row${active ? ' active' : ''}`}>
              <label className="pd-gauge-toggle" title={active ? 'Désactiver' : 'Activer'}>
                <input type="checkbox" checked={active} onChange={(e) => toggle(g, e.target.checked)} aria-label={`${GAUGE_LABELS[g]} active`} />
                <GaugeChip gauge={g} />
              </label>
              <div className="pd-gauge-main">
                <div className="row pd-gauge-line">
                  <input
                    type="number"
                    min={0}
                    max={max}
                    step={1000}
                    value={v}
                    aria-label={`Niveau de la jauge ${GAUGE_LABELS[g]}`}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (Number.isFinite(n)) setGauge(paddock.id, g, Math.max(0, Math.min(max, Math.round(n))))
                    }}
                  />
                  <span className="muted">/ {formatNumber(max)}</span>
                  {t === 0 ? <Badge>vide</Badge> : <Badge tone="info">Palier {t} · {FUEL_TIER_NAMES[t]} · {rules.gaugeRatePerTick[t]} pts / 10 s</Badge>}
                  <Badge tone={eligible >= PADDOCK_SLOTS ? 'ok' : active && eligible < PADDOCK_SLOTS ? 'warn' : undefined} title={GAUGE_EFFECTS[g]}>
                    {eligible}/{PADDOCK_SLOTS} éligibles
                  </Badge>
                </div>
                <Progress value={v} max={max} color={`var(--g-${g})`} />
                <small className="muted">
                  {t === 0
                    ? 'Jauge vide.'
                    : `Vide dans ${formatDuration(drain)} si une monture en profite${nextTier !== null ? ` · palier ${t - 1} dans ${formatDuration(nextTier)}` : ''}${active && eligible === 0 ? ' — aucune monture éligible : elle ne consomme rien.' : '.'}`}
                </small>
              </div>
              <div className="pd-tier-btns" role="group" aria-label={`Niveaux rapides ${GAUGE_LABELS[g]}`}>
                <button className="btn small" onClick={() => setGauge(paddock.id, g, 0)} title="Jauge vide">
                  0
                </button>
                {TIERS.map((tt) => (
                  <button key={tt} className="btn small" onClick={() => setGauge(paddock.id, g, rules.gaugeTierMax[tt])} title={`Plafond du palier ${tt} (${FUEL_TIER_NAMES[tt]})`}>
                    P{tt} max
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {error && <Callout tone="danger">{error}</Callout>}
    </Card>
  )
}

// ---------- Étapes (communes au plan recommandé et au plan démarré) ----------

function StepList({
  steps,
  times,
  now,
  initialGauges,
  ackIndex,
}: {
  steps: FertilityStep[]
  times: { startAt: number; endAt: number }[]
  now: number
  initialGauges: GaugeId[]
  ackIndex?: number
}) {
  if (steps.length === 0) return null
  const end = times[times.length - 1].endAt
  return (
    <ol className="steps pd-steps">
      {steps.map((s, i) => {
        const { startAt, endAt } = times[i]
        const prev = i === 0 ? initialGauges : steps[i - 1].gauges
        const sw = gaugeSwitch(prev, s.gauges)
        const serenity = s.gauges.includes('baffeur') || s.gauges.includes('caresseur')
        const done = ackIndex !== undefined && i < ackIndex
        const current = ackIndex !== undefined ? i === ackIndex : now >= startAt && now < endAt
        const due = ackIndex !== undefined && i === ackIndex + 1 && now >= startAt
        return (
          <li key={i} className={`${done ? 'done' : ''}${current ? ' pd-current' : ''}${due ? ' pd-due' : ''}`}>
            <div className="row pd-step-head">
              <span className="pd-time">
                {formatClock(startAt, now)} → {formatClock(endAt, now)}
              </span>
              <span className="muted">{formatDuration(s.durationSeconds)}</span>
              {s.gauges.map((g) => (
                <GaugeChip key={g} gauge={g} />
              ))}
              {current && <Badge tone="accent">en cours</Badge>}
              {due && <Badge tone="danger">à faire maintenant</Badge>}
              {s.durationSeconds < SHORT_STEP_SECONDS && <Badge tone="warn" title="Étape très courte : restez devant l'écran ou regroupez avec l'étape suivante.">étape courte</Badge>}
            </div>
            <div>{s.purpose}</div>
            {(sw.on.length > 0 || sw.off.length > 0) && (
              <div className="pd-switch">
                {i === 0 && ackIndex === undefined ? 'Pour démarrer' : `À ${formatClock(startAt, now)}`} : {sw.text}.
              </div>
            )}
            {s.switchWindow && (
              <div className="pd-window">
                ⏰ Passer à l'étape suivante entre <strong>{formatClock(times[i].startAt - s.startSeconds * 1000 + s.switchWindow.earliestSeconds * 1000, now)}</strong> et{' '}
                <strong>{formatClock(times[i].startAt - s.startSeconds * 1000 + s.switchWindow.latestSeconds * 1000, now)}</strong> (au plus tôt quand toutes les
                montures sont dans la zone visée, au plus tard avant que la première n'en sorte). Mettez une alarme.
              </div>
            )}
            {serenity && overlapsNight(startAt, endAt) && (
              <div className="pd-night">🌙 Jauge de sérénité active la nuit : décalez le démarrage, ou passez au palier 1 pour une nuit sans changement de zone.</div>
            )}
          </li>
        )
      })}
      <li className="pd-end">
        <div className="row pd-step-head">
          <span className="pd-time">{formatClock(end, now)}</span>
          <Badge tone="ok">fin du plan</Badge>
        </div>
        <div>
          {capitalize(gaugeSwitch(steps[steps.length - 1].gauges, []).text)}, puis sortez les fécondes vers l'étable (accouplement possible à distance depuis
          l'étable).
        </div>
      </li>
    </ol>
  )
}

// ---------- Plan recommandé ----------

function RecommendedPlanCard({
  id,
  mounts,
  recommended,
  paddock,
  planStart,
  now,
  tier,
  withXp,
  parentTarget,
  rules,
  almanaxDoubled,
  onTier,
  onWithXp,
}: {
  id: number
  mounts: Mount[]
  recommended: Recommended
  paddock: PaddockState
  planStart: number
  now: number
  tier: FuelTier
  withXp: boolean
  parentTarget: number
  rules: Ruleset
  almanaxDoubled: GaugeId | null
  onTier: (t: FuelTier) => void
  onWithXp: (v: boolean) => void
}) {
  const start = usePaddockPlans((s) => s.start)
  const setActive = usePaddocks((s) => s.setActive)
  const plan = recommended.plan
  const times = useMemo(() => (plan ? stepTimes({ startedAt: planStart, steps: plan.steps, totalSeconds: plan.totalSeconds, acknowledgedStepIndex: 0 }) : []), [plan, planStart])
  const fertileCount = recommended.fertileIds.length
  const others = mounts.filter((m) => !needsFertility(m) && m.level < 200)

  const controls = (
    <div className="row pd-controls">
      <label className="field">
        Palier entretenu
        <select value={tier} onChange={(e) => onTier(Number(e.target.value) as FuelTier)}>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              Palier {t} — {FUEL_TIER_NAMES[t]} ({rules.gaugeRatePerTick[t]} pts / 10 s){t === 1 ? ' · nuit' : t === 2 ? ' · journée' : t === 4 ? ' · rush' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="row pd-check">
        <input type="checkbox" checked={withXp} onChange={(e) => onWithXp(e.target.checked)} />
        Mangeoire en 2e jauge quand une seule autre sert
      </label>
    </div>
  )

  if (!plan) {
    return (
      <Card title="Plan recommandé">
        {controls}
        {others.length > 0 ? (
          <>
            <p>
              Aucune monture à rendre féconde ici. Avec la <GaugeChip gauge="mangeoire" /> seule au palier {tier}, voici le temps pour atteindre le niveau visé (
              {parentTarget}, réglage « niveau des parents ») :
            </p>
            <ul className="pd-xp-list">
              {others.map((m) => (
                <li key={m.id}>
                  <MountLabel m={m} /> — niveau {m.level} :{' '}
                  {m.level >= parentTarget ? (
                    <span className="muted">niveau visé atteint</span>
                  ) : (
                    <>
                      {formatDuration(xpSeconds(m.level, parentTarget, { tier, rules, ability: m.ability, almanaxDoubled }))}
                      {m.ability === 'sage' && <Badge tone="gold">Sage ×2</Badge>}
                    </>
                  )}
                </li>
              ))}
            </ul>
            {others.length < PADDOCK_SLOTS && (
              <Callout tone="warn">
                {others.length}/{PADDOCK_SLOTS} montures : la Mangeoire consomme autant qu'avec 10 montures, {PADDOCK_SLOTS - others.length} place
                {PADDOCK_SLOTS - others.length > 1 ? 's' : ''} perdue{PADDOCK_SLOTS - others.length > 1 ? 's' : ''}.
              </Callout>
            )}
          </>
        ) : (
          <Empty>Posez des montures fertiles dans cet enclos pour obtenir un plan de fécondité minuté.</Empty>
        )}
      </Card>
    )
  }

  const end = planStart + plan.totalSeconds * 1000
  const first = plan.steps[0]?.gauges ?? []
  const startNow = () => {
    start({
      paddockId: id,
      startedAt: Date.now(),
      tier,
      withXp,
      rulesetId: rules.id,
      almanaxDoubled,
      mountIds: mounts.map((m) => m.id),
      steps: plan.steps,
      totalSeconds: plan.totalSeconds,
      fecundAt: plan.fecundAt,
    })
    if (validateActiveGauges(first) === null) setActive(id, first)
  }

  return (
    <Card
      title="Plan recommandé"
      actions={
        <button className="btn primary" onClick={startNow} disabled={plan.steps.length === 0}>
          ▶ Démarrer ce plan
        </button>
      }
    >
      {controls}
      <div className="grid grid-4 pd-plan-stats">
        <Stat label="Durée totale" value={formatDuration(plan.totalSeconds)} hint={`${plan.steps.length} étape${plan.steps.length > 1 ? 's' : ''}`} />
        <Stat label="Lot féconde vers" value={formatClock(end, now)} hint="si vous démarrez maintenant" />
        <Stat
          label="Montures à féconder"
          value={`${fertileCount}/${PADDOCK_SLOTS}`}
          tone={fertileCount < PADDOCK_SLOTS ? 'neg' : 'pos'}
          hint={fertileCount < PADDOCK_SLOTS ? `${Math.round(100 - fertileCount * 10)} % du carburant des jauges de stats ne sert à personne` : 'rendement maximal'}
        />
        <Stat label="Palier" value={`${tier} · ${FUEL_TIER_NAMES[tier]}`} hint={`${rules.gaugeRatePerTick[tier]} points par tick, recharges régulières`} />
      </div>
      {plan.warnings.map((w) => (
        <Callout key={w} tone="warn">
          {w}
          {w.startsWith('Certaines montures') && (
            <>
              {' '}
              Lot trop hétérogène (smileys ou besoins différents) : scindez-le avec la <a href={href('enclos', { onglet: 'repartition' })}>répartition automatique</a>.
            </>
          )}
        </Callout>
      ))}
      <p className="muted pd-note">
        Pourquoi : la maturité ne monte qu'entre −2 000 et 2 000, on la fait d'abord avec l'endurance (bleu) ou l'amour (violet), puis on traverse 0 avec Baffeur ou
        Caresseur pour la dernière statistique. Heures calculées depuis maintenant ; activez d'abord en jeu {first.map((g) => GAUGE_LABELS[g]).join(' + ')} puis
        cliquez sur « Démarrer ce plan ».
      </p>
      <StepList steps={plan.steps} times={times} now={now} initialGauges={paddock.active} />
    </Card>
  )
}

// ---------- Plan démarré ----------

function ActivePlanCard({ plan, mounts, now, onAdvance }: { plan: ActivePaddockPlan; mounts: Mount[]; now: number; onAdvance: (p: ActivePaddockPlan, at?: number) => void }) {
  const stop = usePaddockPlans((s) => s.stop)
  const progress = currentStep(plan, now)
  const times = useMemo(() => stepTimes(plan), [plan])
  const end = plan.startedAt + plan.offsetMs + plan.totalSeconds * 1000
  const next = progress.next
  const ids = new Set(mounts.map((m) => m.id))
  const changed = plan.mountIds.some((x) => !ids.has(x)) || mounts.some((m) => needsFertility(m) && !plan.mountIds.includes(m.id))
  const rules = useRules()

  return (
    <Card
      title="Plan en cours"
      actions={
        <button
          className="btn small danger"
          onClick={() => {
            if (window.confirm(`Arrêter le plan de l'enclos ${plan.paddockId} ?`)) stop(plan.paddockId)
          }}
        >
          Arrêter le plan
        </button>
      }
    >
      <div className="row pd-plan-meta">
        <span>
          Démarré {formatClock(plan.startedAt, now)} · palier {plan.tier} ({FUEL_TIER_NAMES[plan.tier]}) · fin prévue <strong>{formatClock(end, now)}</strong>
        </span>
        {plan.offsetMs !== 0 && (
          <Badge tone="info">
            {plan.offsetMs > 0 ? 'décalé de +' : 'avancé de '}
            {formatDuration(Math.abs(plan.offsetMs) / 1000)}
          </Badge>
        )}
        {plan.rulesetId !== rules.id && <Badge tone="warn">calculé en {plan.rulesetId}</Badge>}
      </div>
      <Progress value={progress.fraction} max={1} />
      {changed && (
        <Callout tone="warn">
          Le lot a changé depuis le démarrage (montures ajoutées ou retirées) : arrêtez ce plan et démarrez le plan recommandé recalculé.
        </Callout>
      )}
      {progress.finished ? (
        <Callout tone="ok">
          Plan terminé : désactivez les jauges et sortez les fécondes vers l'étable pour les accoupler (<a href={href('accouplement')}>Accouplement</a>).
        </Callout>
      ) : (
        next && (
          <div className={`pd-next${progress.due ? ' due' : ''}${progress.late ? ' late' : ''}`}>
            <div className="pd-next-head">
              <span className="pd-countdown">{progress.due ? "C'est l'heure !" : relative(next.at, now)}</span>
              <span>
                {next.final ? 'Fin du plan' : `Étape ${next.index + 1}/${plan.steps.length}`} à <strong>{formatClock(next.at, now)}</strong>
              </span>
            </div>
            <div className="pd-next-text">
              À {formatClock(next.at, now)} : {capitalize(next.text)}.
            </div>
            {next.earliest !== null && next.latest !== null && (
              <div className="pd-window">
                Fenêtre de changement : entre {formatClock(next.earliest, now)} et {formatClock(next.latest, now)}
                {progress.late && <strong> — dépassée : des montures sortent de la zone visée, changez tout de suite.</strong>}
              </div>
            )}
            <div className="row">
              <button className="btn primary" onClick={() => onAdvance(plan)}>
                ✓ Fait à l'heure prévue
              </button>
              <button className="btn" onClick={() => onAdvance(plan, Date.now())} title="Décale la suite du plan sur l'heure réelle">
                ✓ Fait maintenant ({formatClock(now, now)})
              </button>
            </div>
          </div>
        )
      )}
      <StepList steps={plan.steps} times={times} now={now} initialGauges={[]} ackIndex={progress.index} />
    </Card>
  )
}

// ---------- Carburant ----------

function FuelCard({
  paddock,
  plan,
  recommended,
  fertileCount,
  rules,
  tier,
}: {
  paddock: PaddockState
  plan: ActivePaddockPlan | undefined
  recommended: FertilityPlan | null
  fertileCount: number
  rules: Ruleset
  tier: FuelTier
}) {
  const ctx = usePriceContext()
  const jobLevel = useSettings((s) => s.jobLevel)
  const consumed = useMemo(() => {
    if (plan) {
      const out: Partial<Record<GaugeId, number>> = {}
      for (const s of plan.steps.slice(plan.acknowledgedStepIndex)) for (const [g, v] of Object.entries(s.consumed)) out[g as GaugeId] = (out[g as GaugeId] ?? 0) + (v ?? 0)
      return out
    }
    return recommended?.consumed ?? null
  }, [plan, recommended])
  const advice: RefillAdvice | null = useMemo(
    () => (consumed ? refillAdvice({ gauges: paddock.gauges }, { consumed }, { ctx, rules, jobLevel, tier }) : null),
    [consumed, paddock.gauges, ctx, rules, jobLevel, tier],
  )
  if (!advice || advice.lines.length === 0)
    return (
      <Card title="Carburant pour ce plan">
        <Empty>Pas de plan de fécondité : rien à prévoir.</Empty>
      </Card>
    )
  const runIncomplete = !advice.complete
  return (
    <Card
      title={plan ? 'Carburant pour la suite du plan' : 'Carburant pour ce plan'}
      actions={advice.complete ? <Badge tone="ok">prix complets</Badge> : <Badge tone="warn">coût incomplet</Badge>}
    >
      <div className="grid grid-3 pd-fuel-stats">
        <Stat
          label="Consommé par le plan"
          value={advice.runCost === null ? '—' : `${runIncomplete ? '≥ ' : ''}${formatKamas(advice.runCost)}`}
          hint={fertileCount > 0 && advice.runCost !== null ? `${runIncomplete ? '≥ ' : '≈ '}${formatKamas(advice.runCost / fertileCount)} par monture fécondée` : undefined}
        />
        <Stat
          label="Socle du palier (une fois)"
          value={advice.baseCost === null ? '—' : `${runIncomplete && advice.baseCost > 0 ? '≥ ' : ''}${formatKamas(advice.baseCost)}`}
          hint="points sous le palier, qui restent dans la jauge"
        />
        <Stat label="Total à acheter / fabriquer" value={advice.cost === null ? '—' : `${runIncomplete ? '≥ ' : ''}${formatKamas(advice.cost)}`} hint={`palier ${tier} entretenu`} />
      </div>
      {runIncomplete && (
        <Callout tone="warn">
          <strong>Coût incomplet</strong> : des prix manquent (jamais comptés comme 0), les montants sont des minimums.{' '}
          {advice.missing.slice(0, 6).map((id, i) => (
            <span key={id}>
              {i > 0 && ', '}
              <a href={href('prix', { q: itemName(id) })}>{itemName(id)}</a>
            </span>
          ))}
          {advice.missing.length > 6 && ` et ${advice.missing.length - 6} autre(s)`} — <a href={href('prix', { onglet: 'carburants' })}>saisir les prix</a>.
        </Callout>
      )}
      <div className="table-wrap">
        <table className="table pd-fuel-table">
          <thead>
            <tr>
              <th>Jauge</th>
              <th className="num">Consommé</th>
              <th className="num">Dans la jauge</th>
              <th>À acheter ou fabriquer</th>
              <th className="num">Coût</th>
            </tr>
          </thead>
          <tbody>
            {advice.lines.map((l) => (
              <tr key={l.gauge}>
                <td>
                  <GaugeChip gauge={l.gauge} />
                  <div className="pd-cost-point">
                    {l.pointCost.value !== null ? (
                      <small className="muted">
                        {l.pointCost.bound === 'max' ? '≤ ' : l.pointCost.bound === 'min' ? '≥ ' : ''}
                        {formatNumber(l.pointCost.value, 2)} K/pt
                      </small>
                    ) : (
                      <small className="muted">prix au point inconnu</small>
                    )}
                    {(l.pointCost.estimated || l.pointCost.origin === 'defaut') && <ConfidenceBadge level={l.pointCost.confidence ?? 'low'} />}
                  </div>
                </td>
                <td className="num">{formatNumber(l.consumed)}</td>
                <td className="num">{formatNumber(l.current)}</td>
                <td>
                  {l.items.length === 0 ? (
                    <span className="muted">rien : la jauge suffit</span>
                  ) : (
                    <ul className="pd-items">
                      {l.items.map((it) => (
                        <li key={it.fuelId}>
                          <strong>{it.count} ×</strong> {it.name}{' '}
                          {it.unitPrice === null || !it.complete ? (
                            <a className="badge warn" href={href('prix', { q: it.name })}>
                              prix à saisir
                            </a>
                          ) : (
                            <small className="muted">({formatKamas(it.unitPrice)} l'unité)</small>
                          )}{' '}
                          {it.canCraft ? <Badge tone="ok">fabricable</Badge> : <small className="muted">craft niv. {it.craftLevel}</small>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {l.notes.map((n) => (
                    <small key={n} className="muted pd-fuel-note">
                      {n}
                    </small>
                  ))}
                </td>
                <td className="num">
                  {l.cost === null ? <Badge tone="warn">incomplet</Badge> : `${l.complete ? '' : '≥ '}${formatKamas(l.cost)}`}
                  {l.baseCost !== null && l.baseCost > 0 && (
                    <small className="muted pd-fuel-note">dont socle {formatKamas(l.baseCost)}</small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted pd-note">
        Carburant le moins cher au point pour chaque tranche, en remplissant chaque palier avec la famille minimale qui le permet et sans débordement (l'excédent au-delà
        du plafond est probablement perdu). Utiliser un carburant ne demande aucun niveau de métier.
      </p>
    </Card>
  )
}

// ---------- Simulation ----------

function SimulationCard({ paddock, mounts, rules, almanaxDoubled, now }: { paddock: PaddockState; mounts: Mount[]; rules: Ruleset; almanaxDoubled: GaugeId | null; now: number }) {
  const [sim, setSim] = useState<{ at: number; res: SimulateResult; timeline: TimelineEntry[] } | null>(null)
  const error = validateActiveGauges(paddock.active)
  const names = useMemo(() => new Map(mounts.map((m) => [m.id, mountName(m)])), [mounts])
  const run = () => {
    const res = simulateCurrent(paddock, mounts, { rules, almanaxDoubled, maxSeconds: 86_400 })
    setSim({ at: Date.now(), res, timeline: simulationTimeline(res, (id) => names.get(id) ?? id, rules) })
  }
  const canRun = mounts.length > 0 && paddock.active.length > 0 && !error
  return (
    <Card
      title="Simuler avec mes jauges actuelles"
      actions={
        <button className="btn" onClick={run} disabled={!canRun}>
          ▶ Simuler 24 h
        </button>
      }
    >
      <p className="muted pd-note">
        Tick par tick (10 s) avec les niveaux saisis et les jauges actives, <strong>sans recharge</strong>, pendant 24 h ou jusqu'à ce qu'aucune jauge active ne serve
        plus. Montre quand une jauge change de palier ou se vide, quand une statistique est pleine, quand une monture change de smiley ou devient féconde.
      </p>
      {!canRun && (
        <Callout>
          {mounts.length === 0
            ? 'Aucune monture dans cet enclos.'
            : error
              ? error
              : 'Activez au moins une jauge (et saisissez son niveau) pour simuler.'}
        </Callout>
      )}
      {sim && <SimulationResult sim={sim} now={now} mountsCount={mounts.length} />}
    </Card>
  )
}

function SimulationResult({ sim, now, mountsCount }: { sim: { at: number; res: SimulateResult; timeline: TimelineEntry[] }; now: number; mountsCount: number }) {
  const { res, timeline, at } = sim
  const idle = timeline.some((e) => e.kind === 'idle')
  const fecund = Object.values(res.fecundAt).filter((t) => t > 0).length
  const consumed = (Object.entries(res.consumed) as [GaugeId, number][]).filter(([, v]) => v > 0)
  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat label="Durée simulée" value={formatDuration(res.seconds)} hint={idle ? `arrêt à ${formatClock(at + res.seconds * 1000, now)} : plus rien ne sert` : 'limite de 24 h'} />
        <Stat label="Fécondes pendant la simulation" value={`${fecund}/${mountsCount}`} />
        {consumed.map(([g, v]) => (
          <Stat key={g} label={`${GAUGE_LABELS[g]} consommé`} value={formatNumber(v)} hint={`reste ${formatNumber(res.gauges[g])} points`} />
        ))}
      </div>
      {timeline.length === 0 ? (
        <Empty>Aucun événement en 24 h.</Empty>
      ) : (
        <ol className="pd-timeline">
          {timeline.map((e, i) => (
            <li key={i} className={`pd-tl-${e.tone}`}>
              <span className="pd-time">{formatClock(at + e.t * 1000, now)}</span>
              <small className="muted">+{formatDuration(e.t)}</small>
              {e.gauge && <GaugeChip gauge={e.gauge} />}
              <span>{e.text}</span>
            </li>
          ))}
        </ol>
      )}
      <small className="muted">Simulation lancée à {formatClock(at, now)} ; relancez-la après avoir modifié les jauges ou les montures.</small>
    </div>
  )
}

// ---------- Répartition automatique ----------

function AutoAssign({
  mounts,
  unlocked,
  rules,
  almanaxDoubled,
  plans,
  now,
}: {
  mounts: Mount[]
  unlocked: number
  rules: Ruleset
  almanaxDoubled: GaugeId | null
  plans: Record<string, ActivePaddockPlan>
  now: number
}) {
  const tier = useSettings((s) => s.preferredTier)
  const withXp = useSettings((s) => s.xpFiller)
  const levelTarget = useSettings((s) => s.parentTargetLevel)
  const updateSettings = useSettings((s) => s.update)
  const update = useInventory((s) => s.update)
  const [keepCurrent, setKeepCurrent] = useState(true)
  const [includeLeveling, setIncludeLeveling] = useState(true)
  const [includeInventory, setIncludeInventory] = useState(false)
  const [result, setResult] = useState<{ res: AssignResult; source: Mount[]; at: number } | null>(null)
  const [applied, setApplied] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string[]>([])
  const byId = useMemo(() => new Map(mounts.map((m) => [m.id, m])), [mounts])

  const compute = () => {
    const res = assignPaddocks(mounts, { paddocksAvailable: unlocked, rules, tier, withXp, almanaxDoubled, includeLeveling, levelTarget, keepCurrent, includeInventory })
    setResult({ res, source: mounts, at: Date.now() })
    setApplied(null)
    setApplyError([])
  }

  const apply = () => {
    if (!result) return
    const final = new Map(mounts.map((m) => [m.id, m.location]))
    for (const mv of result.res.moves) final.set(mv.mountId, mv.to)
    const errors: string[] = []
    const perPaddock = new Map<number, number>()
    let stable = 0
    for (const loc of final.values()) {
      if (loc.kind === 'enclos') perPaddock.set(loc.paddock, (perPaddock.get(loc.paddock) ?? 0) + 1)
      if (loc.kind === 'etable') stable++
    }
    for (const [p, n] of perPaddock) {
      if (n > PADDOCK_SLOTS) errors.push(`L'enclos ${p} aurait ${n} montures (${PADDOCK_SLOTS} places).`)
      if (p > unlocked && result.res.moves.some((mv) => mv.to.kind === 'enclos' && mv.to.paddock === p)) errors.push(`L'enclos ${p} n'est pas débloqué.`)
    }
    if (stable > rules.stableSlots) errors.push(`L'étable aurait ${stable} montures (limite ${rules.stableSlots}).`)
    if (errors.length) {
      setApplyError(errors)
      return
    }
    for (const mv of result.res.moves) update(mv.mountId, { location: mv.to })
    setApplied(`${result.res.moves.length} déplacement${result.res.moves.length > 1 ? 's enregistrés' : ' enregistré'}.`)
    setResult(null)
  }

  const stale = result !== null && result.source !== mounts
  const res = result?.res
  const advice = allocationAdvice(unlocked)
  const changedPlans = res
    ? res.paddocks.filter((a) => {
        const p = plans[String(a.paddockId)]
        return p && (a.addedIds.length > 0 || res.moves.some((mv) => mv.from.kind === 'enclos' && mv.from.paddock === a.paddockId))
      })
    : []

  return (
    <div className="stack">
      <Card title="Répartition automatique des montures">
        <p>
          Forme des lots de {PADDOCK_SLOTS} montures au plus dont les sérénités tiennent dans une fenêtre de 2 000, regroupés par phase (bleu = Foudroyeur + Abreuvoir,
          violet = Dragofesse + Abreuvoir, rouge/vert = poussée de sérénité), fusionne les petits lots qui partagent une jauge pour viser 10 montures éligibles par jauge
          active, et complète les places libres avec des montures à monter en niveau (Mangeoire).
        </p>
        {advice && (
          <Callout>
            <strong>
              Organisation conseillée pour {unlocked} enclos (recherche, confiance moyenne) :
            </strong>{' '}
            {advice}
          </Callout>
        )}
        <div className="row pd-controls">
          <label className="field">
            Palier entretenu
            <select value={tier} onChange={(e) => updateSettings({ preferredTier: Number(e.target.value) as FuelTier })}>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  Palier {t} — {FUEL_TIER_NAMES[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="row pd-check">
            <input type="checkbox" checked={withXp} onChange={(e) => updateSettings({ xpFiller: e.target.checked })} />
            Mangeoire en 2e jauge
          </label>
          <label className="row pd-check">
            <input type="checkbox" checked={includeLeveling} onChange={(e) => setIncludeLeveling(e.target.checked)} />
            Compléter avec des montures à monter (niveau &lt; {levelTarget})
          </label>
          <label className="row pd-check">
            <input type="checkbox" checked={keepCurrent} onChange={(e) => setKeepCurrent(e.target.checked)} />
            Laisser en place les lots déjà en enclos
          </label>
          <label className="row pd-check">
            <input type="checkbox" checked={includeInventory} onChange={(e) => setIncludeInventory(e.target.checked)} />
            Inclure l'inventaire du personnage
          </label>
          <span className="spacer" />
          <button className="btn primary" onClick={compute} disabled={mounts.length === 0}>
            Calculer la répartition
          </button>
        </div>
        {mounts.length === 0 && (
          <Empty>
            Aucune monture enregistrée : ajoutez-les dans <a href={href('montures')}>Mes montures</a>.
          </Empty>
        )}
        {applied && (
          <Callout tone="ok">
            {applied} En jeu : allez sur une carte d'enclos du Village des Éleveurs ({PADDOCK_UNLOCK_LEVELS.slice(0, unlocked).map((p) => p.coords).join(', ')}) pour poser et
            retirer les montures, puis démarrez le plan de chaque enclos dans l'onglet « Mes enclos ».
          </Callout>
        )}
      </Card>

      {res && (
        <>
          {stale && <Callout tone="warn">Vos montures ont changé depuis le calcul : recalculez avant d'appliquer.</Callout>}
          <div className="grid grid-4">
            <Stat label="À rendre fécondes" value={formatNumber(res.stats.fertility)} />
            <Stat label="Placées dans un lot" value={formatNumber(res.stats.placed)} hint={`${res.stats.slots} places dans ${res.stats.paddocks} enclos`} />
            <Stat label="En attente" value={formatNumber(res.stats.waiting)} hint={`${res.waitingBatches.length} lot(s) suivant(s)`} />
            <Stat label="Compléments XP" value={formatNumber(res.stats.fillers)} hint="Mangeoire" />
          </div>

          <div className="grid grid-2">
            {res.paddocks.map((a) => {
              const end = a.totalSeconds > 0 ? result!.at + a.totalSeconds * 1000 : null
              return (
                <Card
                  key={a.paddockId}
                  className="pd-assign"
                  title={
                    <div className="stack" style={{ gap: 2 }}>
                      <h3>
                        Enclos {a.paddockId} — {PADDOCK_ROLE_LABELS[a.role]}
                      </h3>
                      <small className="muted">
                        {a.mountIds.length}/{PADDOCK_SLOTS} places · {a.keptIds.length} déjà là · {a.addedIds.length} à poser
                      </small>
                    </div>
                  }
                  actions={a.firstGauges.map((g) => (
                    <GaugeChip key={g} gauge={g} />
                  ))}
                >
                  {a.mountIds.length === 0 ? (
                    <Empty>Enclos libre.</Empty>
                  ) : (
                    <ul className="pd-assign-list">
                      {a.mountIds.map((mid) => {
                        const m = byId.get(mid)
                        if (!m) return null
                        return (
                          <li key={mid}>
                            <SerenitySmiley serenity={m.serenity} withValue />
                            {a.fillerIds.includes(mid) ? (
                              <Badge tone="gold">XP niv. {m.level}</Badge>
                            ) : a.keptIds.includes(mid) ? (
                              <Badge>déjà là</Badge>
                            ) : (
                              <Badge tone="accent">à poser</Badge>
                            )}
                            <MountLabel m={m} />
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {end !== null && (
                    <p>
                      <strong>{a.role === 'xp' ? 'Niveau visé atteint' : 'Lot fécond'}</strong> en {formatDuration(a.totalSeconds)} (vers {formatClock(end, now)} si démarré au
                      calcul).
                    </p>
                  )}
                  <ul className="pd-reasons">
                    {a.rationale.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  {a.warnings.map((w) => (
                    <Callout key={w} tone="warn">
                      {w}
                    </Callout>
                  ))}
                </Card>
              )
            })}
          </div>

          <Card title={`Déplacements à faire en jeu (${res.moves.length})`}>
            {res.moves.length === 0 ? (
              <Empty>Aucun déplacement : vos enclos sont déjà bien répartis.</Empty>
            ) : (
              <>
                <Callout tone="warn">
                  Poser ou retirer une monture d'un enclos demande d'être sur une carte d'enclos (Village des Éleveurs). Faites tous les déplacements en un seul passage,
                  puis appliquez-les ici pour garder l'application à jour.
                </Callout>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Monture</th>
                        <th>De</th>
                        <th>Vers</th>
                        <th>Pourquoi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {res.moves.map((mv) => {
                        const m = byId.get(mv.mountId)
                        return (
                          <tr key={mv.mountId}>
                            <td>{m ? <MountLabel m={m} /> : mv.mountId}</td>
                            <td>{locationLabel(mv.from)}</td>
                            <td>
                              <strong>{locationLabel(mv.to)}</strong>
                            </td>
                            <td>
                              <small>{mv.reason}</small>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {changedPlans.length > 0 && (
                  <Callout tone="warn">
                    Plans démarrés touchés par ces déplacements : {changedPlans.map((a) => `enclos ${a.paddockId}`).join(', ')}. Arrêtez-les et démarrez les plans recalculés.
                  </Callout>
                )}
                {applyError.map((e) => (
                  <Callout key={e} tone="danger">
                    {e}
                  </Callout>
                ))}
                <div className="row">
                  <button className="btn primary" onClick={apply} disabled={stale}>
                    Appliquer les {res.moves.length} déplacement{res.moves.length > 1 ? 's' : ''}
                  </button>
                  <small className="muted">Met à jour l'emplacement des montures dans l'application (rien n'est fait en jeu à votre place).</small>
                </div>
              </>
            )}
          </Card>

          {res.waitingBatches.length > 0 && (
            <Card title={`File d'attente (${res.waiting.length} montures)`}>
              <p className="muted pd-note">Lots déjà formés, dans l'ordre de passage : gardez-les à l'étable et posez le suivant dès qu'un enclos devient fécond.</p>
              <ol className="pd-waiting">
                {res.waitingBatches.map((b) => (
                  <li key={b.index}>
                    <div className="row">
                      <strong>Lot suivant n° {b.index}</strong>
                      <span>{PADDOCK_ROLE_LABELS[b.role]}</span>
                      <small className="muted">
                        sérénité {formatNumber(b.serenityRange[0])} à {formatNumber(b.serenityRange[1])} · {b.mountIds.length} monture{b.mountIds.length > 1 ? 's' : ''}
                      </small>
                    </div>
                    <div className="pd-waiting-mounts">
                      {b.mountIds.map((mid) => {
                        const m = byId.get(mid)
                        return m ? (
                          <span key={mid} className="pd-chip">
                            <SerenitySmiley serenity={m.serenity} /> {mountName(m)}
                          </span>
                        ) : null
                      })}
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {res.suggestions.length > 0 && (
            <Card title="Conseils">
              <ul className="pd-reasons">
                {res.suggestions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <SuggestionLinks paddocks={res.paddocks.map((a) => paddockRole(a.firstGauges))} />
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function SuggestionLinks({ paddocks }: { paddocks: string[] }): ReactNode {
  const empty = paddocks.filter((r) => r === 'vide').length
  return (
    <div className="row">
      {empty > 0 && (
        <a className="btn small" href={href('montures', { captures: 1 })}>
          Enregistrer des captures
        </a>
      )}
      <a className="btn small" href={href('accouplement')}>
        Accoupler les fécondes
      </a>
      <a className="btn small" href={href('rentabilite')}>
        Coût d'un cycle
      </a>
    </div>
  )
}
