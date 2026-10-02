// Page « Enclos » : les 6 enclos (débloqués ou non), montures présentes, saisie des jauges, plan de
// fécondité recommandé avec heures absolues, plan démarré (compte à rebours, plan dépassé, fin du plan
// appliquée aux montures), simulation, carburant nécessaire et répartition automatique.
// Niveaux de jauges : toujours les niveaux ESTIMÉS maintenant (vidés depuis la saisie, src/domain/
// projection.ts), comme le conseiller de l'accueil ; la valeur saisie reste affichée à côté.
// Logique : src/domain/paddockAssign.ts (+ fertility.ts, paddock.ts, fuel.ts, projection.ts,
// paddockPlanStatus.ts) ; plans : store paddockPlans ; alarmes globales : src/ui/alarms.tsx.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { itemName } from '../../data'
import { almanaxAt, type AlmanaxEffect } from '../../domain/almanax'
import {
  FUEL_TIER_NAMES,
  GAUGE_EFFECTS,
  GAUGE_IDS,
  GAUGE_LABELS,
  MAX_ACTIVE_GAUGES,
  PADDOCK_SLOTS,
  PADDOCK_UNLOCK_LEVELS,
  SERENITY_MAX,
  SERENITY_MIN,
} from '../../domain/constants'
import { almanaxScheduleFrom, isSerenityGauge, type FertilityPlan, type FertilityStep } from '../../domain/fertility'
import type { FillPlan } from '../../domain/fuel'
import { locationLabel, SERENITY_BAND_MIDPOINT, SERENITY_BANDS, SERENITY_SMILEYS, unlockedPaddocks } from '../../domain/mountFate'
import { effectiveFertility, GENDER_ICONS, mountName } from '../../domain/mounts'
import { canBenefit, gaugeDrainSeconds, gaugeTier, isFecund, serenityBand, simulatePaddock, validateActiveGauges, type SimMount, type SimulateResult } from '../../domain/paddock'
import {
  allocationAdvice,
  assignPaddocks,
  gaugeSwitch,
  needsFertility,
  PADDOCK_ROLE_LABELS,
  paddockRole,
  planPaddock,
  refillAdvice,
  simulationTimeline,
  stepTimes,
  toFillerSim,
  toSimMount,
  xpSeconds,
  type AssignResult,
  type MountMove,
  type PaddockAssignment,
  type RefillAdvice,
  type RefillLine,
  type RefillPlanInput,
  type TimelineEntry,
  compareTiers,
} from '../../domain/paddockAssign'
import { planStatus, planYield, pointsValue, projectedMountPatches, remainingPlanConsumption, type PlanStatus, type PlanYield } from '../../domain/paddockPlanStatus'
import { planActiveHistory, projectMountsFromPlan, projectPaddock, type PaddockProjection } from '../../domain/projection'
import { gaugeMax, type Ruleset } from '../../domain/rules'
import type { FuelTier, GaugeId, Mount } from '../../domain/types'
import { mountLevelFromXp, mountXpForLevel } from '../../domain/xp'
import { capitalize, formatClock, formatDuration, formatKamas, formatNumber } from '../../lib/format'
import { useInventory } from '../../store/inventory'
import { useJournal } from '../../store/journal'
import { nextAlarm, usePaddockPlans, type ActivePaddockPlan } from '../../store/paddockPlans'
import { emptyPaddock, gaugeEnteredAt, levelsFromOtherRuleset, paddockProjectionInput, usePaddocks, type PaddockRecord } from '../../store/paddocks'
import { usePriceContext } from '../../store/prices'
import { useRules, useSettings } from '../../store/settings'
import { NotificationControl, planStatusText, useAdvancePlan, usePlanClock } from '../alarms'
import { GaugeBars, SerenitySmiley, StatusBadge } from '../MountEditor'
import { Badge, Callout, Card, Empty, GaugeChip, NumberField, PageHeader, Progress, Stat, Tabs } from '../components'
import { href, navigate, useRoute } from '../router'
import { ConfidenceBadge, SpeciesName } from '../species'
import './PaddocksPage.css'

type TabId = 'enclos' | 'repartition'
const TIERS: FuelTier[] = [1, 2, 3, 4]

// ---------- Utilitaires ----------

function relative(at: number, now: number): string {
  const d = (at - now) / 1000
  if (Math.abs(d) < 30) return 'maintenant'
  return d > 0 ? `dans ${formatDuration(d)}` : `il y a ${formatDuration(-d)}`
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

const pointsOf = (p: FillPlan | null) => (p?.feasible ? p.reached - p.from : 0)

/** Montant en kamas, « ≥ » quand il est incomplet (borne basse), « — » s'il n'est pas chiffré. */
const kamasText = (value: number | null, complete: boolean) => (value === null ? '—' : `${complete ? '' : '≥ '}${formatKamas(value)}`)

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

/**
 * Saisie rapide de la sérénité d'une monture : 4 smileys (valeur estimée = milieu de la zone) ou valeur
 * exacte lue en jeu.
 */
function SerenityEdit({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const band = serenityBand(value)
  return (
    <span className="pd-ser-edit">
      <span className="pd-ser-btns" role="group" aria-label={`Smiley de ${label}`}>
        {SERENITY_BANDS.map((b) => (
          <button
            key={b}
            type="button"
            className={`mt-smiley ${SERENITY_SMILEYS[b].color} pd-ser-btn`}
            aria-pressed={band === b}
            title={`${SERENITY_SMILEYS[b].label} — met ${formatNumber(SERENITY_BAND_MIDPOINT[b])} (milieu de la zone, estimation)`}
            onClick={() => onChange(SERENITY_BAND_MIDPOINT[b])}
          >
            <span className="mt-smiley-face" aria-hidden>
              {SERENITY_SMILEYS[b].face}
            </span>
            <span className="mt-sr">
              Smiley {SERENITY_SMILEYS[b].color} ({SERENITY_SMILEYS[b].short})
            </span>
          </button>
        ))}
      </span>
      <NumberField label={<span className="mt-sr">Sérénité exacte de {label}</span>} value={value} min={SERENITY_MIN} max={SERENITY_MAX} step={100} width={88} onChange={onChange} />
    </span>
  )
}

/** Sérénité affichée, modifiable en place (enregistrée tout de suite dans l'inventaire). */
function SerenityCell({ m }: { m: Mount }) {
  const update = useInventory((s) => s.update)
  const [open, setOpen] = useState(false)
  return (
    <span className="pd-ser-cell">
      <SerenitySmiley serenity={m.serenity} withValue />
      <button type="button" className="btn small ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Corriger la sérénité lue en jeu">
        {open ? 'Fermer' : '✎'}
        <span className="mt-sr"> sérénité de {mountName(m)}</span>
      </button>
      {open && <SerenityEdit value={m.serenity} label={mountName(m)} onChange={(v) => update(m.id, { serenity: v })} />}
    </span>
  )
}

// ---------- Projection « maintenant » d'un enclos ----------

/** Niveaux saisis bornés au plafond des règles actives (une saisie d'une autre version peut le dépasser). */
function clampedGauges(record: PaddockRecord, rules: Ruleset): Record<GaugeId, number> {
  const max = gaugeMax(rules)
  const out = {} as Record<GaugeId, number>
  for (const g of GAUGE_IDS) out[g] = Math.max(0, Math.min(max, record.gauges[g] ?? 0))
  return out
}

/**
 * Projection de l'enclos à `at` : niveaux vidés depuis leur saisie (heure par jauge, jauges actives
 * successives — celles du plan démarré pendant le plan) et montures (plan rejoué). Null si impossible.
 */
function computeProjection(
  record: PaddockRecord,
  mounts: Mount[],
  plan: ActivePaddockPlan | undefined,
  rules: Ruleset,
  at: number,
  almanaxDoubling: boolean,
): PaddockProjection | null {
  const input = paddockProjectionInput(record)
  let activeHistory = input.activeHistory
  if (plan) {
    const base = plan.startedAt + plan.offsetMs
    activeHistory = [...(input.activeHistory ?? []).filter((h) => h.at < base), ...planActiveHistory(plan)]
  }
  try {
    return projectPaddock({
      state: { gauges: clampedGauges(record, rules), active: record.active },
      activeSinceMs: input.activeSinceMs,
      nowMs: at,
      rules,
      mounts,
      plan: plan ?? null,
      gaugeUpdatedAt: input.gaugeUpdatedAt,
      activeHistory,
      // Doublement Almanax des jauges (non vérifié) : seulement si le réglage est coché.
      almanax: almanaxDoubling ? undefined : false,
    })
  } catch {
    return null
  }
}

/** Niveau « socle » (plus haut bas de palier ≤ niveau) : ce que le planificateur regarde pour décider d'un socle. */
function tierFloorOf(level: number, rules: Ruleset): number {
  let f = 0
  for (const t of [2, 3, 4] as FuelTier[]) if (rules.gaugeTierMax[(t - 1) as FuelTier] <= level) f = rules.gaugeTierMax[(t - 1) as FuelTier]
  return f
}

/**
 * Niveaux estimés à `at` des jauges déjà saisies (sous les règles actives), à enregistrer comme nouvelle
 * référence quand l'état des montures est enregistré (fin ou arrêt de plan, état estimé) : la projection
 * repart alors de montures et de niveaux cohérents.
 */
function rebasedLevels(
  record: PaddockRecord,
  mounts: Mount[],
  plan: ActivePaddockPlan | undefined,
  rules: Ruleset,
  at: number,
  almanaxDoubling: boolean,
): Partial<Record<GaugeId, number>> | null {
  const proj = computeProjection(record, mounts, plan, rules, at, almanaxDoubling)
  if (!proj) return null
  const out: Partial<Record<GaugeId, number>> = {}
  for (const g of GAUGE_IDS) {
    const tag = record.gaugeRulesets?.[g]
    if (gaugeEnteredAt(record, g) > 0 && (tag === undefined || tag === rules.id)) out[g] = Math.round(proj.gauges.levels[g])
  }
  return out
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
  const now = usePlanClock(plans)
  const onAdvance = useAdvancePlan()
  const K = unlockedPaddocks(jobLevel)
  const almanax = almanaxAt(now) // jour de jeu (heure de Paris)
  // Doublement Almanax d'une jauge : non vérifié en jeu, appliqué seulement si le réglage est coché.
  const almanaxDoubling = useSettings((s) => s.almanaxGaugeDoubling)
  const almanaxDoubled = almanaxDoubling ? (almanax?.doubledGauge ?? null) : null

  const occupancy = mounts.filter((m) => m.location.kind === 'enclos').length
  const toFecund = mounts.filter((m) => (m.location.kind === 'etable' || m.location.kind === 'enclos') && needsFertility(m))
  const alarm = nextAlarm(plans)
  const alarmStatus = alarm ? planStatus(plans[String(alarm.paddockId)], now) : null
  const dues = Object.values(plans)
    .map((p) => ({ plan: p, st: planStatus(p, now) }))
    .filter((x) => x.st.state !== 'running' && x.st.state !== 'finished')
    .sort((a, b) => (a.st.progress.next?.at ?? 0) - (b.st.progress.next?.at ?? 0))

  return (
    <div className="pd-page">
      <PageHeader title="Enclos" subtitle="Jauges, placement des montures, plan de fécondité minuté et alarmes de changement." actions={<NotificationControl />} />

      <div className="grid grid-4 pd-summary">
        <Stat
          label="Enclos débloqués"
          value={`${K} / ${PADDOCK_UNLOCK_LEVELS.length}`}
          hint={K < PADDOCK_UNLOCK_LEVELS.length ? `Prochain au niveau ${PADDOCK_UNLOCK_LEVELS[K].level} d'Éleveur (vous : ${jobLevel})` : 'Tous les enclos sont débloqués'}
        />
        <Stat label="Places occupées" value={`${occupancy} / ${K * PADDOCK_SLOTS}`} hint={`${plural(mounts.filter((m) => m.location.kind === 'etable').length)} à l'étable`} />
        <Stat label="À rendre fécondes" value={formatNumber(toFecund.length)} hint={`dont ${toFecund.filter((m) => m.location.kind === 'enclos').length} déjà en enclos`} />
        <Stat
          label="Prochaine alarme"
          value={alarm ? formatClock(alarm.switch.at, now) : '—'}
          hint={
            alarm
              ? alarmStatus?.state === 'stale'
                ? `Enclos ${alarm.paddockId} : plan dépassé, à recalculer`
                : `Enclos ${alarm.paddockId}, ${relative(alarm.switch.at, now)} : ${alarm.switch.text}`
              : 'Aucun plan démarré'
          }
        />
      </div>

      {almanax && <AlmanaxBanner effect={almanax} applied={almanaxDoubling} />}

      {dues.map(({ plan, st }) => {
        const simple = st.state === 'due' || st.state === 'late'
        return (
          <Callout key={plan.paddockId} tone={st.state === 'due' ? 'warn' : 'danger'}>
            <div className="row">
              <strong>
                Enclos {plan.paddockId} — {planStatusText(st, now)}
              </strong>
              {st.state === 'late' && <Badge tone="danger">fenêtre dépassée</Badge>}
              {st.state === 'stale' && <Badge tone="danger">plan dépassé</Badge>}
              <span className="spacer" />
              {simple && (
                <>
                  <button className="btn small primary" onClick={() => onAdvance(plan)}>
                    Fait à l'heure
                  </button>
                  <button className="btn small" onClick={() => onAdvance(plan, Date.now())}>
                    Fait maintenant
                  </button>
                </>
              )}
              {(tab !== 'enclos' || selected !== plan.paddockId) && (
                <a className="btn small ghost" href={href('enclos', { enclos: plan.paddockId })}>
                  Voir l'enclos
                </a>
              )}
            </div>
          </Callout>
        )
      })}

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
              onAdvance={onAdvance}
            />
          )}
        </>
      ) : (
        <AutoAssign
          mounts={mounts}
          unlocked={K}
          rules={rules}
          plans={plans}
          states={paddockStates}
          now={now}
          autoRun={route.params.get('calcul') === '1'}
          keepCurrentDefault={route.params.get('garder') !== '0'}
        />
      )}
    </div>
  )
}

// ---------- En-tête : Almanax ----------

function AlmanaxBanner({ effect, applied }: { effect: AlmanaxEffect; applied: boolean }) {
  return (
    <Callout tone={effect.doubledGauge && !applied ? 'warn' : 'ok'}>
      <strong>Almanax du jour — {effect.name}</strong> : {effect.effect}.{' '}
      {effect.doubledGauge &&
        (applied ? (
          <>
            Le gain de <GaugeChip gauge={effect.doubledGauge} /> est compté doublé (modélisé ×2 à consommation égale, effet exact non vérifié) : les plans
            ci-dessous en tiennent compte pour les heures qui tombent ce jour de jeu (heure de Paris).{' '}
            <a href={href('reglages', { s: 'rythme' })}>Réglage</a>
          </>
        ) : (
          <>
            Effet sur <GaugeChip gauge={effect.doubledGauge} /> non vérifié : les plans ci-dessous le calculent <strong>au rythme normal</strong>. Si la
            jauge pousse plus vite en jeu, vérifiez la sérénité plus tôt, ou cochez « Appliquer le doublement Almanax » dans les{' '}
            <a href={href('reglages', { s: 'rythme' })}>Réglages</a>.
          </>
        ))}
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
  states: PaddockRecord[]
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
        const st = plan ? planStatus(plan, now) : null
        const fecund = inside.filter((m) => effectiveFertility(m) === 'feconde').length
        const bands = SERENITY_BANDS.map((b) => ({ b, n: inside.filter((m) => needsFertility(m) && serenityBand(m.serenity) === b).length })).filter((x) => x.n > 0)
        const due = st !== null && st.state !== 'running' && st.state !== 'finished'
        return (
          <a
            key={id}
            role="listitem"
            href={href('enclos', { enclos: id })}
            className={`pd-card${id === selected ? ' selected' : ''}${locked ? ' locked' : ''}${due ? ' due' : ''}`}
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
                  {st ? (
                    st.state === 'finished' || st.state === 'end-overdue' ? (
                      <Badge tone="ok" title="Plan terminé : enregistrez l'état du lot (« Appliquer au lot »)">
                        Plan terminé
                      </Badge>
                    ) : st.state === 'stale' ? (
                      <Badge tone="danger" title="Changement manqué pendant une poussée de sérénité : relevez les sérénités et recalculez">
                        Plan dépassé
                      </Badge>
                    ) : st.progress.next ? (
                      <span className={due ? 'pd-due-text' : ''}>
                        ⏰ {formatClock(st.progress.next.at, now)} <small>({relative(st.progress.next.at, now)})</small>
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
  sims: SimMount[]
  /** Heure de référence des Almanax du plan (arrondie au quart d'heure). */
  startMs: number
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
  state: PaddockRecord | undefined
  plan: ActivePaddockPlan | undefined
  now: number
  rules: Ruleset
  almanaxDoubled: GaugeId | null
  onAdvance: (p: ActivePaddockPlan, at?: number) => void
}) {
  const tier = useSettings((s) => s.preferredTier)
  const withXp = useSettings((s) => s.xpFiller)
  const parentTarget = useSettings((s) => s.parentTargetLevel)
  const checkInterval = useSettings((s) => s.checkIntervalMinutes)
  const jobLevel = useSettings((s) => s.jobLevel)
  const almanaxDoubling = useSettings((s) => s.almanaxGaugeDoubling)
  const updateSettings = useSettings((s) => s.update)
  const ctx = usePriceContext()
  const record: PaddockRecord = useMemo(() => state ?? emptyPaddock(id), [state, id])
  const info = PADDOCK_UNLOCK_LEVELS[id - 1]
  const minStepSeconds = Math.max(0, checkInterval) * 60

  // Projection à la minute : niveaux estimés maintenant, montures du plan démarré.
  const minute = Math.floor(now / 60_000) * 60_000
  const projection = useMemo(() => computeProjection(record, mounts, plan, rules, minute, almanaxDoubling), [record, mounts, plan, rules, minute, almanaxDoubling])
  const levels = useMemo(() => {
    const out = {} as Record<GaugeId, number>
    const src = projection?.gauges.levels ?? clampedGauges(record, rules)
    for (const g of GAUGE_IDS) out[g] = Math.max(0, Math.round(src[g] ?? 0))
    return out
  }, [projection, record, rules])
  const projectedById = useMemo(() => new Map((projection?.mounts ?? []).map((m) => [m.id, m])), [projection])
  const mismatch = levelsFromOtherRuleset(record, rules.id)

  // Plan recommandé : recalculé seulement quand ce qui compte change (niveaux réduits au bas de palier
  // atteint, heure au quart d'heure pour l'Almanax).
  const floorsKey = GAUGE_IDS.map((g) => tierFloorOf(levels[g], rules)).join(',')
  const startMs = Math.floor(now / 900_000) * 900_000
  const recommended: Recommended = useMemo(() => {
    const fertile = mounts.filter(needsFertility)
    if (plan || fertile.length === 0) return { plan: null, fertileIds: fertile.map((m) => m.id), sims: [], startMs }
    const others = mounts.filter((m) => !needsFertility(m))
    const sims = [...fertile.map(toSimMount), ...others.map(toFillerSim)]
    const floors = floorsKey.split(',').map(Number)
    const gaugeLevels: Partial<Record<GaugeId, number>> = {}
    GAUGE_IDS.forEach((g, i) => (gaugeLevels[g] = floors[i]))
    const p = planPaddock(sims, { tier, withXp, rules, startMs, minStepSeconds, gaugeLevels, applyAlmanax: almanaxDoubling })
    return { plan: p, fertileIds: fertile.map((m) => m.id), sims, startMs }
  }, [mounts, plan, tier, withXp, rules, startMs, minStepSeconds, floorsKey, almanaxDoubling])

  const planYieldInfo: PlanYield | null = useMemo(
    () =>
      recommended.plan && recommended.plan.converges
        ? planYield(recommended.plan, recommended.sims, { rules, startMs: recommended.startMs, almanax: almanaxDoubling })
        : null,
    [recommended, rules, almanaxDoubling],
  )

  // Carburant : suite du plan démarré, ou plan recommandé applicable.
  const fuelInput: RefillPlanInput | null = useMemo(() => {
    if (plan) {
      const r = remainingPlanConsumption(plan, minute)
      return { consumed: r.consumed, steps: r.steps, tiers: plan.tiers }
    }
    return recommended.plan?.converges ? recommended.plan : null
  }, [plan, recommended, minute])
  const advice: RefillAdvice | null = useMemo(
    () => (fuelInput && mismatch.length === 0 ? refillAdvice({ gauges: levels }, fuelInput, { ctx, rules, jobLevel, tier: plan ? plan.tier : tier }) : null),
    [fuelInput, mismatch.length, levels, ctx, rules, jobLevel, plan, tier],
  )

  // Heure de référence du plan recommandé (« si vous démarrez maintenant »), figée à la minute.
  const planStart = minute
  const fecundEta = (m: Mount): number | null => {
    if (plan && plan.mountIds.includes(m.id) && plan.fecundAt[m.id] !== undefined) return plan.startedAt + plan.offsetMs + plan.fecundAt[m.id] * 1000
    if (!recommended.plan?.converges) return null
    const s = recommended.plan.fecundAt[m.id]
    return s === undefined ? null : planStart + s * 1000
  }
  const endLevel = (m: Mount): number | null => {
    const sim = recommended.plan?.mounts.find((x) => x.id === m.id)
    if (!sim || !sim.xpGained) return null
    return mountLevelFromXp(mountXpForLevel(m.level) + sim.xpGained)
  }
  const fecundCount = plan
    ? plan.mountIds.filter((mid) => plan.fecundAt[mid] !== undefined && mounts.some((m) => m.id === mid && needsFertility(m))).length
    : recommended.plan
      ? recommended.fertileIds.filter((mid) => recommended.plan!.fecundAt[mid] !== undefined).length
      : 0
  const levelsAt = projection?.gauges.estimated ? minute : null

  return (
    <div className="stack pd-detail">
      {plan && <ActivePlanCard plan={plan} mounts={mounts} now={now} rules={rules} minStepSeconds={minStepSeconds} onAdvance={onAdvance} />}

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
            <table className="table pd-mount-table">
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
                    const sim = plan && plan.mountIds.includes(m.id) ? projectedById.get(m.id) : undefined
                    const serDiff = sim ? Math.round(sim.serenity) - m.serenity : 0
                    const statsDiff = sim && f === 'fertile' && (Math.round(sim.endurance) !== m.endurance || Math.round(sim.maturity) !== m.maturity || Math.round(sim.love) !== m.love)
                    return (
                      <tr key={m.id}>
                        <td>
                          <a href={href('montures', { id: m.id })} className="pd-plain-link" title="Modifier la monture">
                            <MountLabel m={m} />
                          </a>
                        </td>
                        <td>
                          <SerenityCell m={m} />
                          {sim && serDiff !== 0 && (
                            <small className="muted pd-estimate" title="Estimation d'après le plan démarré (heures prévues)">
                              ≈ {formatNumber(Math.round(sim.serenity))} estimé
                            </small>
                          )}
                        </td>
                        <td>
                          <GaugeBars mount={m} />
                          {statsDiff && sim && (
                            <span className="pd-estimate" title="Estimation d'après le plan démarré (heures prévues)">
                              <GaugeBars mount={{ endurance: Math.round(sim.endurance), maturity: Math.round(sim.maturity), love: Math.round(sim.love) }} />
                              <small className="muted">estimé maintenant</small>
                            </span>
                          )}
                        </td>
                        <td className="num">
                          {m.level}
                          {lvl !== null && lvl > m.level && <small className="muted"> → {lvl}</small>}
                        </td>
                        <td>
                          <StatusBadge status={f} />
                          {f === 'fertile' && sim && isFecund(sim) && (
                            <Badge tone="ok" title="D'après le plan démarré : enregistrez l'état du lot à la fin du plan">
                              féconde (estimé)
                            </Badge>
                          )}
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
                            <span className="muted">{!plan && recommended.plan && !recommended.plan.converges ? 'plan non applicable' : 'au-delà du plan'}</span>
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
          « Féconde vers » : d'après le plan démarré, sinon d'après le plan recommandé s'il était démarré maintenant. ✎ corrige la sérénité lue en jeu (smiley ou valeur
          exacte). Poser ou retirer une monture demande d'être sur une carte d'enclos en jeu ; tout le reste (jauges, carburant, accouplement depuis l'étable) se fait
          à distance.
        </p>
      </Card>

      {!plan && projection && <ProjectedStateCallout id={id} record={record} mounts={mounts} projection={projection} rules={rules} now={now} />}

      {!plan && (
        <RecommendedPlanCard
          id={id}
          mounts={mounts}
          recommended={recommended}
          yieldInfo={planYieldInfo}
          paddock={record}
          advice={advice}
          levels={levels}
          planStart={planStart}
          now={now}
          tier={tier}
          withXp={withXp}
          parentTarget={parentTarget}
          minStepSeconds={minStepSeconds}
          rules={rules}
          almanaxDoubled={almanaxDoubled}
          onTier={(t) => updateSettings({ preferredTier: t })}
          onWithXp={(v) => updateSettings({ xpFiller: v })}
        />
      )}

      <GaugeEditor paddock={record} mounts={mounts} rules={rules} now={now} levels={levels} projection={projection} />

      <FuelCard
        advice={advice}
        running={plan !== undefined}
        notApplicable={!plan && recommended.plan !== null && !recommended.plan.converges}
        mismatch={mismatch.length > 0}
        paddockId={id}
        fecundCount={fecundCount}
        levelsAt={levelsAt}
        planStartAt={plan ? plan.startedAt + plan.offsetMs : recommended.plan ? planStart : null}
        now={now}
        rules={rules}
      />

      <SimulationCard paddock={record} levels={levels} mounts={mounts} projected={projection?.mounts ?? null} rules={rules} now={now} />
    </div>
  )
}

/**
 * Sans plan démarré : les jauges actives ont fait progresser les montures depuis la saisie des niveaux
 * (estimation). Le plan recommandé part des statistiques enregistrées : proposer de les relever en jeu
 * ou d'enregistrer l'état estimé (montures et niveaux, nouvelle référence de la projection).
 */
function ProjectedStateCallout({ id, record, mounts, projection, rules, now }: { id: number; record: PaddockRecord; mounts: Mount[]; projection: PaddockProjection; rules: Ruleset; now: number }) {
  const patchMany = useInventory((s) => s.patchMany)
  const setGauges = usePaddocks((s) => s.setGauges)
  const almanaxDoubling = useSettings((s) => s.almanaxGaugeDoubling)
  if (!projection.gauges.estimated) return null
  const byId = Object.fromEntries(projection.mounts.map((m) => [m.id, m]))
  const patches = projectedMountPatches(byId, mounts)
  const n = Object.keys(patches).length
  if (n === 0) return null
  const save = () => {
    const t = Date.now()
    const base = rebasedLevels(record, mounts, undefined, rules, t, almanaxDoubling)
    if (base && Object.keys(base).length > 0) setGauges(id, base, { rulesetId: rules.id, at: t })
    patchMany(patches)
  }
  return (
    <Callout tone="warn">
      <strong>
        Les jauges actives ont fait progresser {n} monture{n > 1 ? 's' : ''} depuis la saisie des niveaux ({formatClock(projection.gauges.fromMs, now)})
      </strong>{' '}
      — estimation (sérénité, endurance, maturité, amour, niveau). Le plan recommandé ci-dessous part des valeurs enregistrées : relevez-les en jeu (✎), ou
      enregistrez l'état estimé.
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn small" onClick={save}>
          Enregistrer l'état estimé (montures et niveaux de jauges)
        </button>
      </div>
    </Callout>
  )
}

// ---------- Saisie des jauges ----------

function GaugeEditor({
  paddock,
  mounts,
  rules,
  now,
  levels,
  projection,
}: {
  paddock: PaddockRecord
  mounts: Mount[]
  rules: Ruleset
  now: number
  levels: Record<GaugeId, number>
  projection: PaddockProjection | null
}) {
  const setGauge = usePaddocks((s) => s.setGauge)
  const setActive = usePaddocks((s) => s.setActive)
  const convertLevels = usePaddocks((s) => s.convertLevels)
  const max = gaugeMax(rules)
  const error = validateActiveGauges(paddock.active)
  const sims = useMemo(() => projection?.mounts ?? mounts.map(toSimMount), [projection, mounts])
  const mismatch = levelsFromOtherRuleset(paddock, rules.id)
  const lastEntry = Math.max(0, ...GAUGE_IDS.map((g) => gaugeEnteredAt(paddock, g)))

  const toggle = (g: GaugeId, on: boolean) => {
    let next = on ? [...paddock.active.filter((x) => x !== g), g] : paddock.active.filter((x) => x !== g)
    if (on && g === 'baffeur') next = next.filter((x) => x !== 'caresseur')
    if (on && g === 'caresseur') next = next.filter((x) => x !== 'baffeur')
    if (next.length > MAX_ACTIVE_GAUGES) next = next.slice(next.length - MAX_ACTIVE_GAUGES)
    setActive(paddock.id, next)
  }
  const enter = (g: GaugeId, v: number) => setGauge(paddock.id, g, v, { rulesetId: rules.id })

  return (
    <Card
      title="Jauges de l'enclos"
      actions={
        lastEntry > 0 ? (
          <small className="muted" title="Les niveaux affichés « ≈ estimé » sont simulés depuis votre saisie : ressaisissez la valeur lue en jeu quand vous passez devant l'enclos.">
            Dernière saisie {formatClock(lastEntry, now)} ({relative(lastEntry, now)})
          </small>
        ) : (
          <small className="muted">Saisissez les niveaux lus en jeu</small>
        )
      }
    >
      <p className="muted pd-note">
        Au plus {MAX_ACTIVE_GAUGES} jauges actives ; Baffeur et Caresseur s'excluent. Une jauge consomme autant avec 1 ou 10 montures éligibles : visez 10 montures
        éligibles par jauge active. Paliers ({rules.label}) : {TIERS.map((t) => `${t} ≤ ${formatNumber(rules.gaugeTierMax[t])}`).join(' · ')}. Le niveau
        « ≈ estimé » est simulé depuis votre saisie (consommation des montures éligibles, sans recharge) : c'est lui que suivent le carburant, la simulation et
        l'accueil.
      </p>
      {mismatch.length > 0 && (
        <Callout tone="warn">
          <strong>Niveaux à vérifier</strong> : {mismatch.map((x) => `${GAUGE_LABELS[x.gauge]} (saisi en ${x.rulesetId})`).join(', ')}. Les paliers ne sont pas les
          mêmes en {rules.id} (plafond {formatNumber(max)}) : convertissez-les (même proportion du plafond) ou ressaisissez les valeurs lues en jeu. Le carburant
          n'est pas calculé tant qu'ils ne sont pas vérifiés.
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn small" onClick={() => convertLevels(paddock.id, rules.id)}>
              Convertir en {rules.id}
            </button>
          </div>
        </Callout>
      )}
      <div className="pd-gauges">
        {GAUGE_IDS.map((g) => {
          const entered = paddock.gauges[g] ?? 0
          const v = levels[g]
          const estimated = projection !== null && Math.abs(v - Math.min(max, entered)) >= 1
          const t = gaugeTier(v, rules)
          const active = paddock.active.includes(g)
          const eligible = sims.filter((s) => canBenefit(g, s)).length
          const drain = t === 0 ? 0 : gaugeDrainSeconds(v, 0, rules)
          const nextTier = t > 1 ? gaugeDrainSeconds(v, rules.gaugeTierMax[(t - 1) as FuelTier], rules) : null
          const enteredAt = gaugeEnteredAt(paddock, g)
          const emptied = projection?.gauges.emptiedAt[g]
          return (
            <div key={g} className={`pd-gauge-row${active ? ' active' : ''}`}>
              <label className="pd-gauge-toggle" title={active ? 'Désactiver' : 'Activer'}>
                <input type="checkbox" checked={active} onChange={(e) => toggle(g, e.target.checked)} aria-label={`${GAUGE_LABELS[g]} active`} />
                <GaugeChip gauge={g} />
              </label>
              <div className="pd-gauge-main">
                <div className="row pd-gauge-line">
                  <NumberField label={<span className="mt-sr">Niveau de la jauge {GAUGE_LABELS[g]}</span>} value={entered} min={0} max={max} step={1000} width={110} onChange={(n) => enter(g, n)} />
                  <span className="muted">/ {formatNumber(max)}</span>
                  {estimated && (
                    <Badge tone="info" title={`Estimé à ${formatClock(now, now)} depuis la saisie (sans recharge)`}>
                      ≈ {formatNumber(v)} estimé maintenant
                    </Badge>
                  )}
                  {t === 0 ? <Badge>vide</Badge> : <Badge tone="info">Palier {t} · {FUEL_TIER_NAMES[t]} · {rules.gaugeRatePerTick[t]} pts / 10 s</Badge>}
                  <Badge tone={eligible >= PADDOCK_SLOTS ? 'ok' : active && eligible < PADDOCK_SLOTS ? 'warn' : undefined} title={GAUGE_EFFECTS[g]}>
                    {eligible}/{PADDOCK_SLOTS} éligibles
                  </Badge>
                </div>
                <Progress value={v} max={max} color={`var(--g-${g})`} />
                <small className="muted">
                  {enteredAt > 0 ? `Saisi ${formatClock(enteredAt, now)} (${relative(enteredAt, now)})` : 'Jamais saisi'}
                  {' · '}
                  {t === 0
                    ? emptied !== undefined
                      ? `vide depuis ≈ ${formatClock(emptied, now)} (estimé).`
                      : 'jauge vide.'
                    : `${estimated ? 'estimée vide' : 'vide'} dans ${formatDuration(drain)} si une monture en profite${nextTier !== null ? ` · palier ${t - 1} dans ${formatDuration(nextTier)}` : ''}${active && eligible === 0 ? ' — aucune monture éligible : elle ne consomme rien.' : '.'}`}
                </small>
              </div>
              <div className="pd-tier-btns" role="group" aria-label={`Niveaux rapides ${GAUGE_LABELS[g]}`}>
                <button className="btn small" onClick={() => enter(g, 0)} title="Jauge vide">
                  0
                </button>
                {TIERS.map((tt) => (
                  <button key={tt} className="btn small" onClick={() => enter(g, rules.gaugeTierMax[tt])} title={`Plafond du palier ${tt} (${FUEL_TIER_NAMES[tt]})`}>
                    P{tt} max
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {projection?.gauges.stale && (
        <Callout tone="warn">Saisie de plus de 3 jours : les niveaux estimés ne sont plus fiables, ressaisissez les valeurs lues en jeu.</Callout>
      )}
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
  minStepSeconds,
}: {
  steps: FertilityStep[]
  times: { startAt: number; endAt: number }[]
  now: number
  initialGauges: GaugeId[]
  ackIndex?: number
  minStepSeconds: number
}) {
  if (steps.length === 0) return null
  const end = times[times.length - 1].endAt
  const shortLimit = Math.max(minStepSeconds, 60)
  return (
    <ol className="steps pd-steps">
      {steps.map((s, i) => {
        const { startAt, endAt } = times[i]
        const prev = i === 0 ? initialGauges : steps[i - 1].gauges
        const sw = gaugeSwitch(prev, s.gauges)
        const serenity = s.gauges.some(isSerenityGauge)
        const done = ackIndex !== undefined && i < ackIndex
        const current = ackIndex !== undefined ? i === ackIndex : now >= startAt && now < endAt
        const due = ackIndex !== undefined && i === ackIndex + 1 && now >= startAt
        const last = i === steps.length - 1
        return (
          <li key={i} className={`${done ? 'done' : ''}${current ? ' pd-current' : ''}${due ? ' pd-due' : ''}`}>
            <div className="row pd-step-head">
              {/* Étape validée : ses heures prévues ont pu être décalées par « Fait maintenant » (décalage du plan
                  entier) — on n'affiche pas d'heures qui n'ont pas eu lieu. */}
              <span className="pd-time">{done ? '✓ fait' : `${formatClock(startAt, now)} → ${formatClock(endAt, now)}`}</span>
              <span className="muted">{formatDuration(s.durationSeconds)}</span>
              {s.gauges.map((g) => (
                <GaugeChip key={g} gauge={g} />
              ))}
              {current && <Badge tone="accent">en cours</Badge>}
              {due && <Badge tone="danger">à faire maintenant</Badge>}
              {!last && s.durationSeconds < shortLimit && (
                <Badge tone="warn" title={`Plus courte que votre passage aux enclos (toutes les ${formatDuration(minStepSeconds)}, Réglages) : alarme indispensable.`}>
                  étape courte
                </Badge>
              )}
            </div>
            <div>{s.purpose}</div>
            {(sw.on.length > 0 || sw.off.length > 0) && (
              <div className="pd-switch">
                {done ? 'Fait' : i === 0 && ackIndex === undefined ? 'Pour démarrer' : `À ${formatClock(startAt, now)}`} : {sw.text}.
              </div>
            )}
            {s.switchWindow && !done && (
              <div className="pd-window">
                ⏰ Passer à l'étape suivante entre <strong>{formatClock(times[i].startAt - s.startSeconds * 1000 + s.switchWindow.earliestSeconds * 1000, now)}</strong> et{' '}
                <strong>{formatClock(times[i].startAt - s.startSeconds * 1000 + s.switchWindow.latestSeconds * 1000, now)}</strong> (au plus tôt quand toutes les
                montures sont dans la zone visée, au plus tard avant que la première n'en sorte). Mettez une alarme.
              </div>
            )}
            {serenity && !done && overlapsNight(startAt, endAt) && (
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
          l'étable) et enregistrez l'état du lot ici (« Appliquer au lot »).
        </div>
      </li>
    </ol>
  )
}

// ---------- Plan recommandé ----------

/** Montant de carburant d'une option de palier : exact, borne basse (« ≥ ») avec borne haute, ou à chiffrer. */
function refillCostText(cost: number | null, complete: boolean, upper: number | null): string {
  if (cost === null) return upper !== null ? `≤ ${formatKamas(upper)} (prix à saisir)` : 'prix à saisir'
  if (complete) return formatKamas(cost)
  return `≥ ${formatKamas(cost)}${upper !== null ? ` · ≤ ${formatKamas(upper)}` : ''}`
}

/**
 * Comparaison des paliers 1 à 4 pour ce lot (`compareTiers`) : durée, carburant à acheter (socle compris)
 * et socle seul, pour choisir le palier en connaissance de cause. Calculée à l'ouverture seulement.
 */
function TierComparison({
  sims,
  levels,
  rules,
  withXp,
  startMs,
  minStepSeconds,
  current,
  fertileCount,
  onTier,
}: {
  sims: SimMount[]
  levels: Record<GaugeId, number>
  rules: Ruleset
  withXp: boolean
  startMs: number
  minStepSeconds: number
  current: FuelTier
  fertileCount: number
  onTier: (t: FuelTier) => void
}) {
  const [open, setOpen] = useState(false)
  const ctx = usePriceContext()
  const jobLevel = useSettings((s) => s.jobLevel)
  const almanaxDoubling = useSettings((s) => s.almanaxGaugeDoubling)
  const rows = useMemo(() => {
    if (!open || sims.length === 0) return null
    try {
      return compareTiers(
        sims,
        { tier: current, withXp, rules, startMs, minStepSeconds, gaugeLevels: levels, applyAlmanax: almanaxDoubling },
        { ctx, rules, jobLevel, gauges: levels },
      )
    } catch {
      return null
    }
  }, [open, sims, current, withXp, rules, startMs, minStepSeconds, levels, almanaxDoubling, ctx, jobLevel])
  return (
    <details className="pd-tiers" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Comparer les paliers 1 à 4 (durée, carburant, socle)</summary>
      {open && !rows && <p className="muted">Comparaison impossible pour ce lot.</p>}
      {rows && (
        <>
          <table className="table pd-stack">
            <thead>
              <tr>
                <th scope="col">Palier</th>
                <th scope="col" className="num">
                  Durée
                </th>
                <th scope="col" className="num">
                  Fécondes
                </th>
                <th scope="col" className="num">
                  Carburant à acheter
                </th>
                <th scope="col" className="num">
                  dont socle (reste dans la jauge)
                </th>
                <th scope="col">
                  <span className="mt-sr">Choisir</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ tier: t, plan: p, refill: r }) => {
                const fecund = Object.keys(p.fecundAt).length
                return (
                  <tr key={t} aria-current={t === current ? 'true' : undefined}>
                    <td data-label="Palier">
                      <strong>
                        {t} · {FUEL_TIER_NAMES[t]}
                      </strong>{' '}
                      {t === current && <Badge tone="info">actuel</Badge>}
                    </td>
                    <td className="num" data-label="Durée">
                      {p.converges ? formatDuration(p.totalSeconds) : <span className="muted">non applicable</span>}
                    </td>
                    <td className="num" data-label="Fécondes">
                      {fecund}/{fertileCount}
                    </td>
                    <td className="num" data-label="Carburant à acheter">
                      {p.converges ? refillCostText(r.cost, r.complete, r.upperBound) : '—'}
                    </td>
                    <td className="num" data-label="dont socle">
                      {p.converges ? (r.baseCost === null ? (r.lines.some((l) => l.base) ? 'prix à saisir' : '—') : r.complete ? formatKamas(r.baseCost) : `≥ ${formatKamas(r.baseCost)}`) : '—'}
                    </td>
                    <td data-label="">
                      {t !== current && p.converges && (
                        <button className="btn small" onClick={() => onTier(t)}>
                          Choisir le palier {t}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="muted pd-note">
            Même nombre de points à verser quel que soit le palier : un palier plus haut va plus vite mais coûte plus cher au point et demande un socle
            (acheté une fois, il reste dans la jauge). Les jauges de sérénité restent au palier 1 quand le socle ne vaut pas la peine. « ≥ » : des prix
            manquent (montant connu seulement) ; « ≤ » : borne haute avec les carburants déjà chiffrés.
          </p>
        </>
      )}
    </details>
  )
}


function RecommendedPlanCard({
  id,
  mounts,
  recommended,
  yieldInfo,
  paddock,
  advice,
  levels,
  planStart,
  now,
  tier,
  withXp,
  parentTarget,
  minStepSeconds,
  rules,
  almanaxDoubled,
  onTier,
  onWithXp,
}: {
  id: number
  mounts: Mount[]
  recommended: Recommended
  yieldInfo: PlanYield | null
  paddock: PaddockRecord
  advice: RefillAdvice | null
  levels: Record<GaugeId, number>
  planStart: number
  now: number
  tier: FuelTier
  withXp: boolean
  parentTarget: number
  minStepSeconds: number
  rules: Ruleset
  almanaxDoubled: GaugeId | null
  onTier: (t: FuelTier) => void
  onWithXp: (v: boolean) => void
}) {
  const [starting, setStarting] = useState(false)
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
      <small className="muted">
        Étapes d'au moins {formatDuration(minStepSeconds)} quand c'est sans danger (<a href={href('reglages', { s: 'rythme' })}>passage aux enclos</a>).
      </small>
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
  const splitGroups = plan.split && plan.split.groups.length > 1 ? plan.split : null
  const yieldHint = yieldInfo
    ? yieldInfo.full
      ? 'rendement maximal : chaque jauge de statistique nourrit 10 montures'
      : yieldInfo.warnings.join(' ')
    : undefined

  return (
    <Card
      title="Plan recommandé"
      actions={
        plan.converges ? (
          <button className="btn primary" onClick={() => setStarting(true)} disabled={plan.steps.length === 0 || starting} aria-expanded={starting}>
            ▶ Démarrer ce plan…
          </button>
        ) : (
          <Badge tone="danger" title="Le lot ne devient pas fécond avec ce plan : scindez-le d'abord.">
            Plan non applicable
          </Badge>
        )
      }
    >
      {controls}
      {plan.converges ? (
        <div className="grid grid-4 pd-plan-stats">
          <Stat label="Durée totale" value={formatDuration(plan.totalSeconds)} hint={`${plan.steps.length} étape${plan.steps.length > 1 ? 's' : ''}`} />
          <Stat label="Lot féconde vers" value={formatClock(end, now)} hint="si vous démarrez maintenant" />
          <Stat label="Montures à féconder" value={`${fertileCount}/${PADDOCK_SLOTS}`} tone={yieldInfo && !yieldInfo.full ? 'neg' : 'pos'} hint={yieldHint} />
          <Stat
            label="Paliers"
            value={`${tier} · ${FUEL_TIER_NAMES[tier]}`}
            hint={`jauges de statistiques ; sérénité au palier ${plan.tiers.baffeur === plan.tiers.caresseur ? plan.tiers.baffeur : `${plan.tiers.baffeur}/${plan.tiers.caresseur}`}`}
          />
        </div>
      ) : (
        <Callout tone="danger">
          <strong>Plan non applicable</strong> : avec ce lot, {plural(plan.mounts.filter((m) => plan.fecundAt[m.id] === undefined).length)} ne deviennent pas
          fécondes ({plan.steps.length} étapes, {formatDuration(plan.totalSeconds)}). Pas d'heure de fécondité ni de carburant à prévoir : scindez d'abord le lot.
        </Callout>
      )}
      {splitGroups && <SplitProposal split={splitGroups} mounts={mounts} converges={plan.converges} />}
      {plan.warnings.map((w) => (
        <Callout key={w} tone="warn">
          {w}
        </Callout>
      ))}
      {plan.notes.length > 0 && (
        <ul className="pd-reasons muted">
          {plan.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {plan.converges && (
        <TierComparison
          sims={recommended.sims}
          levels={levels}
          rules={rules}
          withXp={withXp}
          startMs={planStart}
          minStepSeconds={minStepSeconds}
          current={tier}
          fertileCount={fertileCount}
          onTier={onTier}
        />
      )}
      {starting && plan.converges && (
        <StartPlanPanel
          id={id}
          mounts={mounts}
          plan={plan}
          advice={advice}
          levels={levels}
          tier={tier}
          withXp={withXp}
          rules={rules}
          almanaxDoubled={almanaxDoubled}
          wide={splitGroups !== null}
          onCancel={() => setStarting(false)}
        />
      )}
      {plan.converges && (
        <p className="muted pd-note">
          Pourquoi : la maturité ne monte qu'entre −2 000 et 2 000, on la fait d'abord avec l'endurance (bleu) ou l'amour (violet), puis on traverse 0 avec Baffeur ou
          Caresseur pour la dernière statistique. Heures calculées depuis maintenant ; « Démarrer ce plan » indique ce qu'il faut déposer dans chaque jauge, puis
          enregistre les niveaux lus en jeu et le départ du plan ({first.map((g) => GAUGE_LABELS[g]).join(' + ')} actives).
        </p>
      )}
      <StepList steps={plan.steps} times={times} now={now} initialGauges={paddock.active} minStepSeconds={minStepSeconds} />
    </Card>
  )
}

/** Proposition de découpage d'un lot trop large ou qui ne converge pas (F3). */
function SplitProposal({ split, mounts, converges }: { split: NonNullable<FertilityPlan['split']>; mounts: Mount[]; converges: boolean }) {
  const updateMany = useInventory((s) => s.updateMany)
  const byId = new Map(mounts.map((m) => [m.id, m]))
  const range = (ids: string[]) => {
    const s = ids.map((x) => byId.get(x)?.serenity).filter((v): v is number => v !== undefined)
    return s.length ? `${formatNumber(Math.min(...s))} à ${formatNumber(Math.max(...s))}` : '—'
  }
  return (
    <div className={`callout ${converges ? 'warn' : 'danger'}`}>
      <strong>{converges ? 'Lot trop large : scindez-le pour aller bien plus vite' : 'Scinder ce lot'}</strong> — {split.groups.length} lots de sérénité ≤ 2 000 d'un
      seul côté de 0 :
      <ol className="pd-split">
        {split.groups.map((g, i) => (
          <li key={i}>
            <strong>{i === 0 ? 'À garder ici' : `Lot ${i + 1} : vers un autre enclos (ou l'étable en attendant)`}</strong>{' '}
            <small className="muted">sérénité {range(g)}</small>
            <div className="pd-waiting-mounts">
              {g.map((mid) => {
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
      <div className="row">
        <a className="btn small primary" href={href('enclos', { onglet: 'repartition', calcul: 1, garder: 0 })}>
          Répartir automatiquement (scinder)
        </a>
        {split.out.length > 0 && (
          <button
            className="btn small"
            onClick={() => {
              if (window.confirm(`Enregistrer ${plural(split.out.length)} à l'étable ? Faites-le d'abord en jeu (carte d'enclos).`)) updateMany(split.out, { location: { kind: 'etable' } })
            }}
          >
            J'ai sorti les {split.out.length} autres vers l'étable
          </button>
        )}
      </div>
    </div>
  )
}

/** Dépôt initial d'une jauge pour démarrer : objets du socle et du premier dépôt, niveau visé. */
function depositOf(line: RefillLine, rules: Ruleset): { target: number; items: { name: string; count: number }[] } {
  const cap = rules.gaugeTierMax[line.tier]
  const target = line.current >= cap ? line.current : Math.min(cap, line.current + pointsOf(line.base) + pointsOf(line.initial))
  const map = new Map<number, { name: string; count: number }>()
  for (const p of [line.base, line.initial])
    if (p?.feasible)
      for (const it of p.items) {
        const e = map.get(it.option.fuel.id)
        if (e) e.count += it.count
        else map.set(it.option.fuel.id, { name: it.option.fuel.name, count: it.count })
      }
  return { target, items: [...map.values()] }
}

/**
 * Démarrage d'un plan (ux F3) : ce qu'il faut déposer dans chaque jauge utilisée, niveau lu en jeu
 * (pré-rempli avec le niveau visé), puis enregistrement des niveaux, du plan et des jauges actives.
 */
function StartPlanPanel({
  id,
  mounts,
  plan,
  advice,
  levels,
  tier,
  withXp,
  rules,
  almanaxDoubled,
  wide,
  onCancel,
}: {
  id: number
  mounts: Mount[]
  plan: FertilityPlan
  advice: RefillAdvice | null
  levels: Record<GaugeId, number>
  tier: FuelTier
  withXp: boolean
  rules: Ruleset
  almanaxDoubled: GaugeId | null
  wide: boolean
  onCancel: () => void
}) {
  const start = usePaddockPlans((s) => s.start)
  const setGauges = usePaddocks((s) => s.setGauges)
  const setActive = usePaddocks((s) => s.setActive)
  const first = plan.steps[0]?.gauges ?? []
  const lines = advice?.lines ?? []
  const rows = lines.map((l) => ({ line: l, ...depositOf(l, rules) }))
  const [entered, setEntered] = useState<Partial<Record<GaugeId, number>>>(() => Object.fromEntries(rows.map((r) => [r.line.gauge, r.target])))
  const max = gaugeMax(rules)

  const confirm = () => {
    const t = Date.now()
    const recorded: Partial<Record<GaugeId, number>> = {}
    for (const r of rows) recorded[r.line.gauge] = entered[r.line.gauge] ?? r.target
    if (Object.keys(recorded).length) setGauges(id, recorded, { rulesetId: rules.id, at: t })
    start({
      paddockId: id,
      startedAt: t,
      tier,
      withXp,
      rulesetId: rules.id,
      almanaxDoubled,
      mountIds: mounts.map((m) => m.id),
      steps: plan.steps,
      totalSeconds: plan.totalSeconds,
      fecundAt: plan.fecundAt,
      tiers: plan.tiers,
      levelsAtStart: recorded,
    })
    if (validateActiveGauges(first) === null) setActive(id, first, t)
  }

  return (
    <div className="pd-start" role="region" aria-label="Démarrer le plan">
      <h3>Avant de démarrer : remplir les jauges</h3>
      <p className="muted pd-note">
        Déposez en jeu ce qui est indiqué, lisez le niveau affiché par chaque jauge et corrigez-le ici si besoin : il sert aux alarmes « jauge vide », aux recharges et
        à l'accueil. Activez ensuite en jeu {first.map((g) => GAUGE_LABELS[g]).join(' + ') || '—'}, puis démarrez.
      </p>
      {wide && <Callout tone="warn">Lot trop large : ce plan est long. Scinder le lot (proposition ci-dessus) irait bien plus vite.</Callout>}
      {rows.length === 0 ? (
        <Callout>Aucune jauge à remplir : les niveaux actuels suffisent.</Callout>
      ) : (
        <div className="table-wrap">
          <table className="table pd-start-table pd-stack">
            <thead>
              <tr>
                <th>Jauge</th>
                <th className="num">Niveau estimé</th>
                <th>À déposer</th>
                <th>Niveau lu en jeu</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ line, target, items }) => {
                const g = line.gauge
                const v = entered[g] ?? target
                const floor = line.tier > 1 ? rules.gaugeTierMax[(line.tier - 1) as FuelTier] : 0
                const usedFirst = first.includes(g)
                return (
                  <tr key={g}>
                    <td data-label="Jauge">
                      <GaugeChip gauge={g} /> <small className="muted">palier {line.tier}</small>
                    </td>
                    <td className="num" data-label="Niveau estimé">
                      {formatNumber(levels[g] ?? line.current)}
                    </td>
                    <td data-label="À déposer">
                      {items.length === 0 ? (
                        <span className="muted">rien : la jauge suffit pour l'instant</span>
                      ) : (
                        <ul className="pd-items">
                          {items.map((it) => (
                            <li key={it.name}>
                              <strong>{it.count} ×</strong> {it.name}
                            </li>
                          ))}
                        </ul>
                      )}
                      <small className="muted">
                        → niveau visé ≈ {formatNumber(target)}
                        {line.refillCount > 0 ? ` ; puis ${line.refillCount} recharge${line.refillCount > 1 ? 's' : ''} sous ${formatNumber(line.refillFrom)}` : ''}
                      </small>
                    </td>
                    <td data-label="Niveau lu en jeu">
                      <NumberField label={<span className="mt-sr">Niveau lu en jeu, {GAUGE_LABELS[g]}</span>} value={v} min={0} max={max} step={1000} onChange={(n) => setEntered((e) => ({ ...e, [g]: n }))} />
                      {usedFirst && line.tier > 1 && v < floor && (
                        <small className="pd-warn-text">
                          Sous {formatNumber(floor)} : la jauge tournera au palier inférieur, les heures du plan seront fausses.
                        </small>
                      )}
                      {usedFirst && v <= 0 && <small className="pd-warn-text">Jauge vide : la première étape ne démarrera pas.</small>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {advice && !advice.complete && (
        <small className="muted">Prix incomplets : les quantités sont justes, le coût est dans la carte « Carburant » (minimum, jamais 0 pour un prix manquant).</small>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={confirm}>
          Jauges remplies et actives en jeu — démarrer maintenant
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </div>
  )
}

// ---------- Plan démarré ----------

type ApplyMode = 'finish' | 'stop' | 'stale'

function ActivePlanCard({
  plan,
  mounts,
  now,
  rules,
  minStepSeconds,
  onAdvance,
}: {
  plan: ActivePaddockPlan
  mounts: Mount[]
  now: number
  rules: Ruleset
  minStepSeconds: number
  onAdvance: (p: ActivePaddockPlan, at?: number) => void
}) {
  const [stopping, setStopping] = useState(false)
  const st: PlanStatus = planStatus(plan, now)
  const progress = st.progress
  const times = useMemo(() => stepTimes(plan), [plan])
  const end = plan.startedAt + plan.offsetMs + plan.totalSeconds * 1000
  const next = progress.next
  const ids = new Set(mounts.map((m) => m.id))
  const changed = plan.mountIds.some((x) => !ids.has(x)) || mounts.some((m) => needsFertility(m) && !plan.mountIds.includes(m.id))
  const ended = st.state === 'finished' || st.state === 'end-overdue'
  const mode: ApplyMode | null = ended ? 'finish' : st.state === 'stale' ? 'stale' : stopping ? 'stop' : null

  return (
    <Card
      title={st.state === 'stale' ? 'Plan en cours — dépassé' : ended ? 'Plan en cours — terminé' : 'Plan en cours'}
      actions={
        !ended && st.state !== 'stale' ? (
          <button className="btn small danger" onClick={() => setStopping((s) => !s)} aria-expanded={stopping}>
            {stopping ? 'Ne pas arrêter' : 'Arrêter le plan…'}
          </button>
        ) : null
      }
    >
      <div className="row pd-plan-meta">
        <span>
          Enclos {plan.paddockId} · démarré {formatClock(plan.startedAt, now)} · palier {plan.tier} ({FUEL_TIER_NAMES[plan.tier]}) · fin prévue{' '}
          <strong>{formatClock(end, now)}</strong>
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
      {changed && !ended && (
        <Callout tone="warn">Le lot a changé depuis le démarrage (montures ajoutées ou retirées) : arrêtez ce plan (en enregistrant l'état estimé) et démarrez le plan recalculé.</Callout>
      )}
      {st.state === 'stale' && (
        <Callout tone="danger">
          <strong>Plan dépassé.</strong> {st.reason} Coupez en jeu les jauges de sérénité, relevez le smiley (ou la sérénité) de chaque monture ci-dessous, puis
          recalculez depuis l'état actuel.
        </Callout>
      )}
      {st.state === 'end-overdue' && <Callout tone="warn">{st.reason}</Callout>}
      {st.state === 'finished' && <Callout tone="ok">Plan terminé : coupez les jauges, sortez les fécondes vers l'étable et enregistrez l'état du lot.</Callout>}
      {mode === null && next && (
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
              {progress.late && (
                <strong>
                  {' '}
                  — dépassée : des montures sortent de la zone visée, changez au plus vite
                  {st.staleAt !== null ? ` (après ${formatClock(st.staleAt, now)}, le plan sera à recalculer)` : ''}.
                </strong>
              )}
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
      )}
      {mode !== null && <ApplyStatePanel key={mode} mode={mode} plan={plan} mounts={mounts} now={now} rules={rules} onCancel={mode === 'stop' ? () => setStopping(false) : undefined} />}
      <details className="pd-steps-details" open={mode === null}>
        <summary>Étapes du plan ({plan.steps.length})</summary>
        <StepList steps={plan.steps} times={times} now={now} initialGauges={[]} ackIndex={progress.index} minStepSeconds={minStepSeconds} />
      </details>
    </Card>
  )
}

/**
 * Enregistrer dans l'inventaire l'état estimé des montures d'un plan (F4, ux F2, ux F6) :
 *  - `finish` : plan terminé → sérénité, statistiques (fécondes), niveau ; fécondes rangées à l'étable ;
 *  - `stop` : arrêt en cours de plan → état estimé à cette heure ;
 *  - `stale` : plan dépassé → statistiques estimées (prudentes) et sérénités relevées en jeu, puis recalcul.
 * Le plan est ensuite arrêté (le plan recommandé repart de l'état enregistré) et une note est ajoutée au journal.
 */
function ApplyStatePanel({ mode, plan, mounts, now, rules, onCancel }: { mode: ApplyMode; plan: ActivePaddockPlan; mounts: Mount[]; now: number; rules: Ruleset; onCancel?: () => void }) {
  const stop = usePaddockPlans((s) => s.stop)
  const patchMany = useInventory((s) => s.patchMany)
  const setActive = usePaddocks((s) => s.setActive)
  const setGauges = usePaddocks((s) => s.setGauges)
  const paddockRecord = usePaddocks((s) => s.paddocks.find((p) => p.id === plan.paddockId))
  const active = paddockRecord?.active ?? []
  const log = useJournal((s) => s.log)
  const almanaxDoubling = useSettings((s) => s.almanaxGaugeDoubling)
  const almanaxOpt = almanaxDoubling ? undefined : false
  const [toStable, setToStable] = useState(true)
  const end = plan.startedAt + plan.offsetMs + plan.totalSeconds * 1000
  const inPlan = useMemo(() => mounts.filter((m) => plan.mountIds.includes(m.id)), [mounts, plan.mountIds])

  // Projection figée à l'ouverture du panneau (les valeurs ne bougent pas pendant la saisie).
  const [at] = useState(() => (mode === 'finish' ? Math.max(now, end) : now))
  const projected = useMemo(() => {
    const replay = mode === 'finish' ? { ...plan, acknowledgedStepIndex: plan.steps.length } : plan
    return projectMountsFromPlan(replay, inPlan, mode === 'finish' ? Math.min(at, end) : at, { rules, almanax: almanaxOpt })
  }, [mode, plan, inPlan, at, end, rules, almanaxOpt])
  // Plan dépassé : sérénité pré-remplie en supposant que les jauges sont restées actives jusqu'à ce
  // qu'elles se vident (niveaux saisis au démarrage, sans recharge), sinon jusqu'à maintenant (à corriger en jeu).
  const continued = useMemo(() => {
    if (mode !== 'stale') return null
    const byLevels = paddockRecord ? computeProjection(paddockRecord, inPlan, plan, rules, at, almanaxDoubling) : null
    if (byLevels && byLevels.gauges.mounts.length > 0) return Object.fromEntries(byLevels.gauges.mounts.map((m) => [m.id, m]))
    return projectMountsFromPlan(plan, inPlan, at, { rules, continueCurrentStep: true, almanax: almanaxOpt }).byId
  }, [mode, paddockRecord, plan, inPlan, at, rules, almanaxDoubling, almanaxOpt])
  const [serenity, setSerenity] = useState<Record<string, number>>(() => {
    const src = continued ?? projected.byId
    return Object.fromEntries(inPlan.map((m) => [m.id, Math.round(src[m.id]?.serenity ?? m.serenity)]))
  })
  const patches = projectedMountPatches(projected.byId, inPlan, { serenity, fecundToStable: mode === 'finish' && toStable })
  const after = inPlan.map((m) => ({ before: m, after: { ...m, ...patches[m.id] } }))
  const fecundAfter = after.filter((x) => x.before.fertility === 'fertile' && isFecund(x.after)).length

  const apply = (withPatches: boolean) => {
    if (withPatches) {
      // Nouvelle référence des niveaux de jauges (estimés maintenant, avec le plan) : sans elle, la
      // projection rejouerait la consommation depuis le démarrage avec les montures déjà mises à jour.
      // oxlint-disable-next-line react/purity -- gestionnaire de clic, pas le rendu
      const t = Date.now()
      const base = paddockRecord ? rebasedLevels(paddockRecord, mounts, plan, rules, t, almanaxDoubling) : null
      if (base && Object.keys(base).length > 0) setGauges(plan.paddockId, base, { rulesetId: rules.id, at: t })
      if (Object.keys(patches).length > 0) patchMany(patches)
    }
    if (mode === 'finish') setActive(plan.paddockId, [])
    if (mode === 'stale') setActive(plan.paddockId, active.filter((g) => !isSerenityGauge(g)))
    stop(plan.paddockId)
    log({
      kind: 'note',
      text: withPatches
        ? `Enclos ${plan.paddockId} : plan ${mode === 'finish' ? 'terminé' : mode === 'stale' ? 'dépassé, recalculé' : 'arrêté'} — état estimé enregistré pour ${plural(Object.keys(patches).length)} (${fecundAfter} féconde${fecundAfter > 1 ? 's' : ''}).`
        : `Enclos ${plan.paddockId} : plan ${mode === 'finish' ? 'clos' : 'arrêté'} sans modifier les montures.`,
    })
  }

  const title =
    mode === 'finish'
      ? 'Appliquer au lot'
      : mode === 'stale'
        ? 'Relever les sérénités et recalculer'
        : "Arrêter le plan : enregistrer l'état estimé des montures ?"
  return (
    <div className="pd-apply" role="region" aria-label={title}>
      <h3>{title}</h3>
      <p className="muted pd-note">
        {mode === 'finish'
          ? `État estimé à la fin du plan (${formatClock(Math.min(at, end), now)}), d'après les étapes validées et les paliers entretenus : vérifiez en jeu, corrigez une sérénité si besoin.`
          : mode === 'stale'
            ? "Endurance, maturité et amour : estimés au plus prudent (étapes aux heures prévues). Sérénité : estimée en supposant que les jauges sont restées actives jusqu'à se vider (niveaux saisis, sans recharge) — relevez le smiley de chaque monture en jeu et corrigez-la ici."
            : `État estimé maintenant (${formatClock(at, now)}), d'après les étapes validées : vérifiez en jeu, corrigez une sérénité si besoin.`}
      </p>
      {inPlan.length === 0 ? (
        <Callout>Les montures de ce plan ne sont plus dans cet enclos : rien à enregistrer.</Callout>
      ) : (
        <div className="table-wrap">
          <table className="table pd-apply-table pd-stack">
            <thead>
              <tr>
                <th>Monture</th>
                <th>Sérénité</th>
                <th>E / M / A</th>
                <th className="num">Niveau</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {after.map(({ before, after: a }) => (
                <tr key={before.id}>
                  <td data-label="Monture">
                    <MountLabel m={before} />
                  </td>
                  <td data-label="Sérénité">
                    <SerenityEdit value={serenity[before.id] ?? before.serenity} label={mountName(before)} onChange={(v) => setSerenity((s) => ({ ...s, [before.id]: v }))} />
                    <small className="muted pd-fuel-note">enregistrée : {formatNumber(before.serenity)}</small>
                  </td>
                  <td data-label="E / M / A">
                    <GaugeBars mount={a} />
                  </td>
                  <td className="num" data-label="Niveau">
                    {before.level}
                    {a.level > before.level && <strong> → {a.level}</strong>}
                  </td>
                  <td data-label="Statut">
                    <StatusBadge status={effectiveFertility(a)} />
                    {a.location.kind !== before.location.kind && <small className="muted"> → étable</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mode === 'finish' && (
        <label className="row pd-check">
          <input type="checkbox" checked={toStable} onChange={(e) => setToStable(e.target.checked)} />
          Ranger les fécondes à l'étable (sorties de l'enclos en jeu)
        </label>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={() => apply(true)} disabled={inPlan.length === 0}>
          {mode === 'finish'
            ? `Appliquer au lot (${fecundAfter} féconde${fecundAfter > 1 ? 's' : ''}) et clore le plan`
            : mode === 'stale'
              ? 'Enregistrer et recalculer depuis l’état actuel'
              : 'Enregistrer l’état estimé et arrêter'}
        </button>
        <button
          className="btn"
          onClick={() => {
            if (window.confirm(`Arrêter le plan de l'enclos ${plan.paddockId} sans modifier les montures ?`)) apply(false)
          }}
        >
          {mode === 'finish' ? 'Clore sans modifier les montures' : 'Arrêter sans modifier les montures'}
        </button>
        {onCancel && (
          <button className="btn ghost" onClick={onCancel}>
            Annuler
          </button>
        )}
      </div>
    </div>
  )
}

const plural = (n: number) => `${n} monture${n > 1 ? 's' : ''}`

// ---------- Carburant ----------

function FuelCard({
  advice,
  running,
  notApplicable,
  mismatch,
  paddockId,
  fecundCount,
  levelsAt,
  planStartAt,
  now,
  rules,
}: {
  advice: RefillAdvice | null
  running: boolean
  notApplicable: boolean
  mismatch: boolean
  paddockId: number
  fecundCount: number
  levelsAt: number | null
  /** Début du plan (décalage compris) : heures de coupure des jauges de sérénité (`RefillLine.cutoffs`). */
  planStartAt: number | null
  now: number
  rules: Ruleset
}) {
  const convertLevels = usePaddocks((s) => s.convertLevels)
  const title = running ? 'Carburant pour la suite du plan' : 'Carburant pour ce plan'
  if (mismatch)
    return (
      <Card title={title}>
        <Callout tone="warn">
          Niveaux de jauges saisis sous une autre version des règles : convertissez-les ou ressaisissez-les (carte « Jauges de l'enclos ») pour obtenir le carburant à
          prévoir.
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn small" onClick={() => convertLevels(paddockId, rules.id)}>
              Convertir en {rules.id}
            </button>
          </div>
        </Callout>
      </Card>
    )
  if (notApplicable)
    return (
      <Card title={title}>
        <Empty>Plan non applicable (lot à scinder) : rien à acheter tant que le lot n'est pas scindé.</Empty>
      </Card>
    )
  if (!advice || advice.lines.length === 0)
    return (
      <Card title={title}>
        <Empty>{running ? 'Plus rien à consommer d’ici la fin du plan.' : 'Pas de plan de fécondité : rien à prévoir.'}</Empty>
      </Card>
    )
  const consumedValue = pointsValue(advice.lines.map((l) => ({ points: l.consumed, pointCost: l.pointCost })))
  // Reste valorisé tranche par tranche : le socle vaut le prix au point du carburant de palier inférieur.
  const leftoverValue = pointsValue(advice.lines.flatMap((l) => l.leftoverByTier.map((x) => ({ points: x.points, pointCost: x.pointCost }))))
  const tiers = [...new Set(advice.lines.map((l) => l.tier))].sort()
  return (
    <Card title={title} actions={advice.complete && consumedValue.complete ? <Badge tone="ok">prix complets</Badge> : <Badge tone="warn">coût incomplet</Badge>}>
      <div className="grid grid-3 pd-fuel-stats">
        <Stat label="Acheté pour le plan (hors socle)" value={kamasText(advice.runCost, advice.complete)} hint="dépôt initial + recharges (tailles de carburant : un reste possible)" />
        <Stat label="Socle du palier (une fois)" value={kamasText(advice.baseCost, advice.complete || advice.baseCost === 0)} hint="points sous le palier, qui restent dans la jauge" />
        <Stat label="Total à acheter / fabriquer" value={kamasText(advice.cost, advice.complete)} hint={`palier${tiers.length > 1 ? 's' : ''} ${tiers.join('/')} entretenu${tiers.length > 1 ? 's' : ''}`} />
        <Stat
          label={running ? 'Consommé d’ici la fin' : 'Consommé par le plan'}
          value={kamasText(consumedValue.value, consumedValue.complete)}
          hint={
            fecundCount > 0 && consumedValue.value !== null
              ? `${consumedValue.complete ? '≈ ' : '≥ '}${formatKamas(consumedValue.value / fecundCount)} par monture fécondée (${fecundCount})`
              : 'points consommés × coût au point'
          }
        />
        <Stat label="Reste dans les jauges à la fin" value={kamasText(leftoverValue.value, leftoverValue.complete)} hint="socle compris (au prix du palier inférieur), réutilisable au plan suivant" />
      </div>
      {!advice.complete && (
        <Callout tone="warn">
          <strong>Coût incomplet</strong> : des prix manquent (jamais comptés comme 0), les montants sont des minimums
          {advice.upperBound !== null ? ` (au plus ${formatKamas(advice.upperBound)} avec des carburants déjà chiffrés)` : ''}.{' '}
          {advice.missing.slice(0, 6).map((mid, i) => (
            <span key={mid}>
              {i > 0 && ', '}
              <a href={href('prix', { q: itemName(mid) })}>{itemName(mid)}</a>
            </span>
          ))}
          {advice.missing.length > 6 && ` et ${advice.missing.length - 6} autre(s)`} — <a href={href('prix', { onglet: 'carburants' })}>saisir les prix</a>.
        </Callout>
      )}
      {advice.complete && !consumedValue.complete && (
        <Callout tone="warn">
          Rien à acheter, mais le coût au point est inconnu pour{' '}
          {advice.lines
            .filter((l) => !l.pointCost.complete)
            .map((l) => GAUGE_LABELS[l.gauge])
            .join(', ')}{' '}
          : la valeur consommée est un minimum (jamais 0 pour un prix manquant) — <a href={href('prix', { onglet: 'carburants' })}>saisir les prix</a>.
        </Callout>
      )}
      <div className="table-wrap pd-fuel-wrap">
        <table className="table pd-fuel-table pd-stack">
          <thead>
            <tr>
              <th>Jauge</th>
              <th className="num">Consommé</th>
              <th className="num">Dans la jauge{levelsAt !== null ? ` (≈ ${formatClock(levelsAt, now)})` : ''}</th>
              <th>À acheter ou fabriquer</th>
              <th className="num">Coût</th>
            </tr>
          </thead>
          <tbody>
            {advice.lines.map((l) => (
              <tr key={l.gauge}>
                <td data-label="Jauge">
                  <GaugeChip gauge={l.gauge} /> <small className="muted">palier {l.tier}</small>
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
                <td className="num" data-label="Consommé">
                  {formatNumber(l.consumed)}
                </td>
                <td className="num" data-label={levelsAt !== null ? 'Dans la jauge (estimé)' : 'Dans la jauge'}>
                  {levelsAt !== null ? '≈ ' : ''}
                  {formatNumber(l.current)}
                </td>
                <td data-label="À acheter ou fabriquer">
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
                  {planStartAt !== null && l.cutoffs.length > 0 && !l.stopsByItself && (
                    <small className="pd-fuel-note">
                      ⏰ Coupez {GAUGE_LABELS[l.gauge]} à{' '}
                      {l.cutoffs.map((c, i) => (
                        <span key={c.stepIndex}>
                          {i > 0 && (i === l.cutoffs.length - 1 ? ' puis à ' : ', ')}
                          <strong>{formatClock(planStartAt + c.atSeconds * 1000, now)}</strong> (fin de l'étape {c.stepIndex + 1})
                        </span>
                      ))}
                      {l.cutoffs.length > 1 ? ', et réactivez-la aux étapes suivantes qui l’utilisent' : ''} : la jauge continue de pousser la sérénité tant qu'elle
                      contient des points.
                    </small>
                  )}
                  {l.notes.length > 0 && (
                    <details className="pd-fuel-notes">
                      <summary>Consignes ({l.notes.length})</summary>
                      {l.notes.map((n) => (
                        <small key={n} className="muted pd-fuel-note">
                          {n}
                        </small>
                      ))}
                    </details>
                  )}
                </td>
                <td className="num" data-label="Coût">
                  {l.cost === null ? <Badge tone="warn">incomplet</Badge> : `${l.complete ? '' : '≥ '}${formatKamas(l.cost)}`}
                  {!l.complete && l.upperBound !== null && (
                    <small className="muted pd-fuel-note" title="Avec des carburants déjà chiffrés (souvent de famille supérieure, prix estimé) : jamais compté dans les totaux.">
                      ≤ {formatKamas(l.upperBound)} (borne haute)
                    </small>
                  )}
                  {l.baseCost !== null && l.baseCost > 0 && <small className="muted pd-fuel-note">dont socle {formatKamas(l.baseCost)}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted pd-note">
        Carburant le moins cher au point pour chaque tranche, en remplissant chaque palier avec la famille minimale qui le permet et sans débordement (l'excédent au-delà
        du plafond est probablement perdu). « Consommé » = points réellement consommés × coût au point ; « Acheté » compte des carburants entiers (le reste demeure
        dans la jauge). {levelsAt !== null ? 'Niveaux actuels estimés depuis votre saisie (sans recharge). ' : ''}Utiliser un carburant ne demande aucun niveau de
        métier.
      </p>
    </Card>
  )
}

// ---------- Simulation ----------

interface SimRun {
  at: number
  res: SimulateResult
  timeline: TimelineEntry[]
  count: number
}

function SimulationCard({
  paddock,
  levels,
  mounts,
  projected,
  rules,
  now,
}: {
  paddock: PaddockRecord
  levels: Record<GaugeId, number>
  mounts: Mount[]
  projected: SimMount[] | null
  rules: Ruleset
  now: number
}) {
  const [sim, setSim] = useState<SimRun | null>(null)
  const almanaxDoubling = useSettings((s) => s.almanaxGaugeDoubling)
  const error = validateActiveGauges(paddock.active)
  const names = useMemo(() => new Map(mounts.map((m) => [m.id, mountName(m)])), [mounts])
  const run = () => {
    const at = Date.now()
    const sims = projected && projected.length > 0 ? projected : mounts.map(toSimMount)
    const res = simulatePaddock({ gauges: { ...levels }, active: paddock.active, mounts: sims, almanaxDoubled: almanaxDoubling ? almanaxScheduleFrom(at) : null, maxSeconds: 86_400, stopWhenIdle: true, rules })
    setSim({ at, res, timeline: simulationTimeline(res, (id) => names.get(id) ?? id, rules), count: sims.length })
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
        Tick par tick (10 s) à partir des niveaux <strong>estimés maintenant</strong> et des jauges actives, <strong>sans recharge</strong>, pendant 24 h ou jusqu'à ce
        qu'aucune jauge active ne serve plus. Montre quand une jauge change de palier ou se vide, quand une statistique est pleine, quand une monture change de smiley
        ou devient féconde.
      </p>
      {!canRun && (
        <Callout>{mounts.length === 0 ? 'Aucune monture dans cet enclos.' : error ? error : 'Activez au moins une jauge (et saisissez son niveau) pour simuler.'}</Callout>
      )}
      {sim && <SimulationResult sim={sim} now={now} />}
    </Card>
  )
}

function SimulationResult({ sim, now }: { sim: SimRun; now: number }) {
  const { res, timeline, at } = sim
  const idle = timeline.some((e) => e.kind === 'idle')
  const fecund = Object.values(res.fecundAt).filter((t) => t > 0).length
  const consumed = (Object.entries(res.consumed) as [GaugeId, number][]).filter(([, v]) => v > 0)
  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat label="Durée simulée" value={formatDuration(res.seconds)} hint={idle ? `arrêt à ${formatClock(at + res.seconds * 1000, now)} : plus rien ne sert` : 'limite de 24 h'} />
        <Stat label="Fécondes pendant la simulation" value={`${fecund}/${sim.count}`} />
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

/** Déplacements enregistrés : liste à cocher en jeu, regroupée par destination (ux F21). */
interface AppliedMoves {
  moves: MountMove[]
  /** Enclos dont le lot change (plan à démarrer). */
  newBatches: PaddockAssignment[]
  at: number
}

function AutoAssign({
  mounts,
  unlocked,
  rules,
  plans,
  states,
  now,
  autoRun,
  keepCurrentDefault,
}: {
  mounts: Mount[]
  unlocked: number
  rules: Ruleset
  plans: Record<string, ActivePaddockPlan>
  states: PaddockRecord[]
  now: number
  autoRun: boolean
  keepCurrentDefault: boolean
}) {
  const tier = useSettings((s) => s.preferredTier)
  const withXp = useSettings((s) => s.xpFiller)
  const levelTarget = useSettings((s) => s.parentTargetLevel)
  const checkInterval = useSettings((s) => s.checkIntervalMinutes)
  const almanaxDoubling = useSettings((s) => s.almanaxGaugeDoubling)
  const updateSettings = useSettings((s) => s.update)
  const update = useInventory((s) => s.update)
  const [keepCurrent, setKeepCurrent] = useState(keepCurrentDefault)
  const [includeLeveling, setIncludeLeveling] = useState(true)
  const [includeInventory, setIncludeInventory] = useState(false)
  const [result, setResult] = useState<{ res: AssignResult; source: Mount[]; at: number } | null>(null)
  const [applied, setApplied] = useState<AppliedMoves | null>(null)
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [applyError, setApplyError] = useState<string[]>([])
  const byId = useMemo(() => new Map(mounts.map((m) => [m.id, m])), [mounts])

  const compute = (keep = keepCurrent) => {
    const at = Date.now()
    // Niveaux de jauges estimés maintenant, enclos par enclos (socle utile ou non).
    const paddockGauges: Record<number, Partial<Record<GaugeId, number>>> = {}
    for (let id = 1; id <= unlocked; id++) {
      const rec = states.find((p) => p.id === id) ?? emptyPaddock(id)
      const proj = computeProjection(
        rec,
        mounts.filter((m) => inPaddock(m, id)),
        plans[String(id)],
        rules,
        at,
        almanaxDoubling,
      )
      paddockGauges[id] = proj ? proj.gauges.levels : clampedGauges(rec, rules)
    }
    const res = assignPaddocks(mounts, {
      paddocksAvailable: unlocked,
      rules,
      tier,
      withXp,
      startMs: at,
      applyAlmanax: almanaxDoubling,
      includeLeveling,
      levelTarget,
      keepCurrent: keep,
      includeInventory,
      minStepSeconds: Math.max(0, checkInterval) * 60,
      paddockGauges,
    })
    setResult({ res, source: mounts, at })
    setApplied(null)
    setApplyError([])
  }

  // Lien « Répartir automatiquement (scinder) » : calcul immédiat à l'ouverture de l'onglet, une seule
  // fois (pas à chaque modification des montures) — d'où les dépendances vides.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (autoRun && mounts.length > 0) compute(keepCurrentDefault)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    // Enclos dont le lot change (montures posées ou retirées) et qui ont un plan de fécondité à démarrer.
    const moved = result.res.moves
    const newBatches = result.res.paddocks.filter(
      (a) =>
        a.plan !== null &&
        a.role !== 'vide' &&
        a.role !== 'xp' &&
        (a.addedIds.length > 0 || moved.some((mv) => mv.from.kind === 'enclos' && mv.from.paddock === a.paddockId)),
    )
    setApplied({ moves: result.res.moves, newBatches, at: Date.now() })
    setDone({})
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
  const problems = res ? res.paddocks.filter((a) => a.warnings.length > 0 || (a.plan !== null && !a.plan.converges)) : []

  return (
    <div className="stack">
      <Card title="Répartition automatique des montures">
        <p>
          Forme des lots de {PADDOCK_SLOTS} montures au plus dont les sérénités tiennent dans une fenêtre de 2 000, regroupés par phase (bleu = Foudroyeur + Abreuvoir,
          violet = Dragofesse + Abreuvoir, rouge/vert = poussée de sérénité), fusionne les petits lots qui partagent une jauge pour viser 10 montures éligibles par jauge
          active, et complète les places libres avec des montures à monter en niveau (Mangeoire).
        </p>
        {advice &&
          (res ? (
            <details className="pd-research">
              <summary>Pourquoi ce n'est pas l'organisation type ?</summary>
              <p className="muted pd-note">
                Régime établi (recherche, confiance moyenne), quand les lots arrivent déjà centrés en sérénité : {advice} Aujourd'hui, la répartition ci-dessous suit
                les sérénités réelles de vos montures (smileys différents → jauges différentes) ; elle rejoint l'organisation type une fois les lots centrés.
              </p>
            </details>
          ) : (
            <Callout>
              <strong>Régime établi, pour référence ({unlocked} enclos, recherche, confiance moyenne) :</strong> {advice} La répartition calculée suit les sérénités de vos
              montures et peut être différente au début.
            </Callout>
          ))}
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
            Laisser en place les lots déjà en enclos (un lot trop large est quand même scindé)
          </label>
          <label className="row pd-check">
            <input type="checkbox" checked={includeInventory} onChange={(e) => setIncludeInventory(e.target.checked)} />
            Inclure l'inventaire du personnage
          </label>
          <span className="spacer" />
          <button className="btn primary" onClick={() => compute()} disabled={mounts.length === 0}>
            Calculer la répartition
          </button>
        </div>
        {mounts.length === 0 && (
          <Empty>
            Aucune monture enregistrée : ajoutez-les dans <a href={href('montures')}>Mes montures</a>.
          </Empty>
        )}
      </Card>

      {applied && <AppliedChecklist applied={applied} byId={byId} unlocked={unlocked} done={done} onToggle={(mid, v) => setDone((d) => ({ ...d, [mid]: v }))} />}

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
              const end = a.totalSeconds > 0 && (a.plan?.converges ?? true) ? result!.at + a.totalSeconds * 1000 : null
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
                  {a.plan && !a.plan.converges && <Callout tone="danger">Plan non applicable pour ce lot : il ne devient pas fécond tel quel (voir ci-dessous).</Callout>}
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
              problems.length > 0 ? (
                <Callout tone="warn">
                  Aucun déplacement proposé, mais {problems.map((a) => `l'enclos ${a.paddockId}`).join(', ')} pose{problems.length > 1 ? 'nt' : ''} problème (avertissements
                  ci-dessus).{' '}
                  {keepCurrent ? (
                    <>
                      Décochez « Laisser en place » et recalculez pour tout répartir :{' '}
                      <button
                        className="btn small"
                        onClick={() => {
                          setKeepCurrent(false)
                          compute(false)
                        }}
                      >
                        Recalculer sans laisser en place
                      </button>
                    </>
                  ) : (
                    'Capturez ou déplacez des montures pour former des lots plus serrés.'
                  )}
                </Callout>
              ) : (
                <Empty>Aucun déplacement : vos enclos sont déjà bien répartis.</Empty>
              )
            ) : (
              <>
                <Callout tone="warn">
                  Poser ou retirer une monture d'un enclos demande d'être sur une carte d'enclos (Village des Éleveurs). Faites tous les déplacements en jeu en un seul
                  passage, puis enregistrez-les ici (la liste reste affichée pour cocher au fur et à mesure). Une sérénité fausse ? Corrigez-la avec ✎ puis recalculez.
                </Callout>
                <div className="table-wrap">
                  <table className="table pd-moves-table pd-stack">
                    <thead>
                      <tr>
                        <th>Monture</th>
                        <th>Sérénité</th>
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
                            <td data-label="Monture">{m ? <MountLabel m={m} /> : mv.mountId}</td>
                            <td data-label="Sérénité">{m ? <SerenityCell m={m} /> : '—'}</td>
                            <td data-label="De">{locationLabel(mv.from)}</td>
                            <td data-label="Vers">
                              <strong>{locationLabel(mv.to)}</strong>
                            </td>
                            <td data-label="Pourquoi">
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
                    Plans démarrés touchés par ces déplacements : {changedPlans.map((a) => `enclos ${a.paddockId}`).join(', ')}. Arrêtez-les (en enregistrant l'état
                    estimé) et démarrez les plans recalculés.
                  </Callout>
                )}
                {applyError.map((e) => (
                  <Callout key={e} tone="danger">
                    {e}
                  </Callout>
                ))}
                <div className="row">
                  <button className="btn primary" onClick={apply} disabled={stale}>
                    Enregistrer les {res.moves.length} déplacement{res.moves.length > 1 ? 's' : ''}
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

/** Après l'enregistrement : déplacements à cocher en jeu, par destination, et liens pour démarrer les plans. */
function AppliedChecklist({
  applied,
  byId,
  unlocked,
  done,
  onToggle,
}: {
  applied: AppliedMoves
  byId: Map<string, Mount>
  unlocked: number
  done: Record<string, boolean>
  onToggle: (mountId: string, v: boolean) => void
}) {
  const groups = new Map<string, MountMove[]>()
  for (const mv of applied.moves) {
    const key = locationLabel(mv.to)
    groups.set(key, [...(groups.get(key) ?? []), mv])
  }
  const checked = applied.moves.filter((mv) => done[mv.mountId]).length
  return (
    <Card title={`Déplacements enregistrés (${checked}/${applied.moves.length} faits en jeu)`}>
      <Callout tone="ok">
        {applied.moves.length} déplacement{applied.moves.length > 1 ? 's enregistrés' : ' enregistré'} dans l'application. Faites-les en jeu si ce n'est pas déjà fait
        (cartes d'enclos du Village des Éleveurs : {PADDOCK_UNLOCK_LEVELS.slice(0, unlocked).map((p) => p.coords).join(', ')}) en cochant au fur et à mesure, puis
        démarrez le plan de chaque enclos dont le lot change.
      </Callout>
      {[...groups].map(([dest, moves]) => (
        <div key={dest} className="pd-checklist-group">
          <h3>Vers {dest}</h3>
          <ul className="pd-checklist">
            {moves.map((mv) => {
              const m = byId.get(mv.mountId)
              return (
                <li key={mv.mountId}>
                  <label className="row pd-check">
                    <input type="checkbox" checked={done[mv.mountId] ?? false} onChange={(e) => onToggle(mv.mountId, e.target.checked)} />
                    {m ? <SerenitySmiley serenity={m.serenity} withValue /> : null}
                    {m ? <MountLabel m={m} /> : mv.mountId}
                    <small className="muted">depuis {locationLabel(mv.from)}</small>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      {applied.newBatches.length > 0 && (
        <div className="row">
          {applied.newBatches.map((a) => (
            <a key={a.paddockId} className="btn primary small" href={href('enclos', { enclos: a.paddockId })}>
              Ouvrir l'enclos {a.paddockId} et démarrer le plan
            </a>
          ))}
        </div>
      )}
    </Card>
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
