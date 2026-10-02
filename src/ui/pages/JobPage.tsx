// Page « Métier Éleveur » : niveau et XP, quoi crafter maintenant, plan de montée complet (étapes),
// liste de courses, jalons, autres sources d'XP, jours Almanax et repères de la recherche.
// Logique : src/domain/job.ts (+ xp.ts, pricing.ts) ; prix : page Prix.
import { useMemo, useState, type ReactNode } from 'react'
import { FAMILIES, STRATEGY, itemName } from '../../data'
import { serverDayChangeIfNotLocalMidnight } from '../../domain/almanax'
import { GAUGE_IDS, GAUGE_LABELS } from '../../domain/constants'
import {
  JOB_COST_REPORTS,
  JOB_KIND_LABELS,
  JOB_METRIC_LABELS,
  JOB_RECIPE_KINDS,
  captureOption,
  craftOptionsAt,
  jobAlmanaxDays,
  levelingPlan,
  nextPaddockTarget,
  otherXpSources,
  paddocksAt,
  shoppingListText,
  sortCraftOptions,
  type CraftOption,
  type JobMetric,
  type JobOptionKind,
  type JobRecipeKind,
  type LevelingOptions,
  type LevelingPlan,
  type PlanMilestone,
  type PlanSegment,
  type ShoppingLine,
} from '../../domain/job'
import { frenchDay, marketDepth, type MarketSource } from '../../domain/market'
import { marketQuote, type PriceOrigin } from '../../domain/pricing'
import type { GaugeId } from '../../domain/types'
import { craftXp, jobLevelFromXp, jobXpForLevel, MAX_LEVEL } from '../../domain/xp'
import { formatClock, formatDate, formatInDays, formatIsoDay, formatKamas, formatNumber, formatPercent, plural } from '../../lib/format'
import { journalJobXp, useJournal, type JournalJobXp } from '../../store/journal'
import { usePriceContext } from '../../store/prices'
import type { PriceContext } from '../../domain/pricing'
import { useRules, useSettings } from '../../store/settings'
import { profileKey } from '../../store/profiles'
import { Badge, Callout, Card, Empty, NumberField, PageHeader, Progress, SelectField, Stat, Tabs } from '../components'
import { MarketStatusCallouts, marketPriceTitle } from '../MarketStatus'
import { href } from '../router'
import { ConfidenceBadge } from '../species'
import { useServerDay } from '../useServerDay'
import './JobPage.css'

// ---------- Préférences de la page (confort par navigateur) ----------

/**
 * Contexte de prix de la montée du métier : sans `jobLevel`, car un plan de montée fabrique des recettes
 * (et leurs ingrédients intermédiaires) aux niveaux qu'il atteint, pas seulement au niveau actuel. Le
 * marché importé du serveur (export HDV) est gardé : vos prix > marché > défauts.
 */
function useLevelingPriceContext(): PriceContext {
  const base = usePriceContext()
  return useMemo(() => ({ overrides: base.overrides, useDefaults: base.useDefaults, market: base.market }), [base.overrides, base.useDefaults, base.market])
}

type TabId = 'plan' | 'courses' | 'crafts' | 'jalons' | 'xp' | 'almanax' | 'reperes'
type SortKey = 'kamas' | 'ressources' | 'xp'

interface Prefs {
  /** Niveau visé (null = prochain enclos). */
  target: number | null
  /** XP déjà gagnée dans le niveau actuel. */
  startXp: number
  metric: JobMetric
  includeCaptures: boolean
  almanax: boolean
  kinds: JobRecipeKind[]
  gauge: GaugeId | 'auto'
  tab: TabId
  sort: { key: SortKey; dir: 1 | -1 }
}

const STORAGE_KEY = profileKey('metier')
const TAB_IDS: TabId[] = ['plan', 'courses', 'crafts', 'jalons', 'xp', 'almanax', 'reperes']
const DEFAULT_PREFS: Prefs = {
  target: null,
  startXp: 0,
  metric: 'kamas',
  includeCaptures: false,
  almanax: false,
  kinds: [...JOB_RECIPE_KINDS],
  gauge: 'auto',
  tab: 'plan',
  sort: { key: 'ressources', dir: 1 },
}

function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFS
    const p = JSON.parse(raw) as Partial<Prefs>
    const kinds = Array.isArray(p.kinds) ? p.kinds.filter((k): k is JobRecipeKind => JOB_RECIPE_KINDS.includes(k)) : DEFAULT_PREFS.kinds
    return {
      target: typeof p.target === 'number' && Number.isFinite(p.target) ? p.target : null,
      startXp: typeof p.startXp === 'number' && Number.isFinite(p.startXp) ? Math.max(0, p.startXp) : 0,
      metric: p.metric === 'ressources' ? 'ressources' : 'kamas',
      includeCaptures: p.includeCaptures === true,
      almanax: p.almanax === true,
      kinds: kinds.length ? kinds : DEFAULT_PREFS.kinds,
      gauge: p.gauge && (p.gauge === 'auto' || GAUGE_IDS.includes(p.gauge)) ? p.gauge : 'auto',
      tab: p.tab && TAB_IDS.includes(p.tab) ? p.tab : 'plan',
      sort:
        p.sort && ['kamas', 'ressources', 'xp'].includes(p.sort.key) && (p.sort.dir === 1 || p.sort.dir === -1)
          ? p.sort
          : DEFAULT_PREFS.sort,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(p: Prefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    // Stockage indisponible (navigation privée) : les préférences ne sont simplement pas mémorisées.
  }
}

// ---------- Petits composants ----------

const TABS: { id: TabId; label: string }[] = [
  { id: 'plan', label: 'Plan de montée' },
  { id: 'courses', label: 'Liste de courses' },
  { id: 'crafts', label: 'Crafts possibles' },
  { id: 'jalons', label: 'Jalons' },
  { id: 'xp', label: 'Autres sources d’XP' },
  { id: 'almanax', label: 'Almanax' },
  { id: 'reperes', label: 'Repères de la recherche' },
]

const KIND_TONES: Record<JobOptionKind, 'info' | 'gold' | 'accent' | 'ok'> = {
  carburant: 'info',
  makina: 'gold',
  filet: 'accent',
  capture: 'ok',
}

const ORIGIN_LABELS: Record<PriceOrigin, { label: string; tone: 'accent' | 'info' | 'ok' | 'danger' }> = {
  joueur: { label: 'votre prix', tone: 'accent' },
  marche: { label: 'marché', tone: 'info' },
  defaut: { label: 'défaut', tone: 'info' },
  craft: { label: 'craft', tone: 'ok' },
  manquant: { label: 'manquant', tone: 'danger' },
}

const MILESTONE_KIND_LABELS: Record<PlanMilestone['kind'], { label: string; tone: 'accent' | 'info' | 'gold' | 'ok' }> = {
  enclos: { label: 'Enclos', tone: 'accent' },
  carburant: { label: 'Carburants', tone: 'info' },
  filet: { label: 'Filets', tone: 'ok' },
  makina: { label: 'Makina', tone: 'gold' },
}

/** Coût : montant complet, borne basse « ≥ » si incomplet, ou « coût incomplet » (lien Prix) si rien n'est chiffré. */
function Cost({ value, complete, q }: { value: number | null; complete: boolean; q?: string }) {
  if (complete && value !== null) return <>{formatKamas(value)}</>
  if (value === null || value <= 0)
    return (
      <a className="badge danger" href={href('prix', q ? { q } : { onglet: 'ingredients' })} title="Des ingrédients n'ont pas de prix : saisissez-les sur la page Prix">
        coût incomplet
      </a>
    )
  return <span title="Coût incomplet : borne basse (des ingrédients n'ont pas de prix)">≥ {formatKamas(value)}</span>
}

function kamasPerXp(v: number | null): string {
  if (v === null) return '—'
  return `${formatNumber(v, v < 10 ? 2 : v < 100 ? 1 : 0)} K`
}

function KindBadge({ kind }: { kind: JobOptionKind }) {
  return <Badge tone={KIND_TONES[kind]}>{JOB_KIND_LABELS[kind]}</Badge>
}

function PriceLinks({ ids, max = 4 }: { ids: number[]; max?: number }) {
  if (!ids.length) return null
  return (
    <>
      {ids.slice(0, max).map((id, i) => (
        <span key={id}>
          {i > 0 && ', '}
          <a href={href('prix', { q: itemName(id) })}>{itemName(id)}</a>
        </span>
      ))}
      {ids.length > max && ` et ${ids.length - max} autre${ids.length - max > 1 ? 's' : ''}`}
    </>
  )
}

/** « lundi 12 octobre 2026 » (date de calendrier, indépendante du fuseau du navigateur). */
const formatLongDate = (iso: string) => formatIsoDay(iso, { year: true })

const inDays = formatInDays

// ---------- Page ----------

export default function JobPage() {
  const rules = useRules()
  const jobLevelRaw = useSettings((s) => s.jobLevel)
  const jobLevelUpdatedAt = useSettings((s) => s.jobLevelUpdatedAt)
  const journal = useJournal((s) => s.entries)
  const family = useSettings((s) => s.family)
  const updateSettings = useSettings((s) => s.update)
  const ctx = useLevelingPriceContext()
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const setPrefs = (patch: Partial<Prefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch }
      savePrefs(next)
      return next
    })

  const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(jobLevelRaw || 1)))
  const span = level < MAX_LEVEL ? jobXpForLevel(level + 1) - jobXpForLevel(level) : 0
  const startXp = Math.min(prefs.startXp, Math.max(0, span - 1))
  const xpEntered = jobXpForLevel(level) + startXp
  const xpMax = jobXpForLevel(MAX_LEVEL)
  // XP d'Éleveur enregistrée dans le journal depuis la dernière saisie du niveau : déduite du plan, comme à
  // l'accueil (estimation ; « Passer au niveau … » l'enregistre dans les réglages).
  const journalXp = useMemo(() => journalJobXp(journal, jobLevelUpdatedAt), [journal, jobLevelUpdatedAt])
  const xpNow = Math.min(xpMax, xpEntered + Math.max(0, journalXp.xp))
  const planLevel = Math.max(level, Math.min(MAX_LEVEL, jobLevelFromXp(xpNow)))
  const planStartXp = planLevel >= MAX_LEVEL ? 0 : Math.max(0, xpNow - jobXpForLevel(planLevel))
  const target = prefs.target !== null && prefs.target > planLevel ? Math.min(MAX_LEVEL, prefs.target) : nextPaddockTarget(planLevel)

  const planOpts: LevelingOptions = useMemo(
    () => ({
      rules,
      metric: prefs.metric,
      includeCaptures: prefs.includeCaptures,
      almanaxXpBonus: prefs.almanax ? 0.5 : 0,
      kinds: prefs.kinds,
      fuelGauges: prefs.gauge === 'auto' ? undefined : [prefs.gauge],
      startXp: planStartXp,
      family,
    }),
    [rules, prefs.metric, prefs.includeCaptures, prefs.almanax, prefs.kinds, prefs.gauge, planStartXp, family],
  )
  const plan = useMemo(() => levelingPlan(planLevel, target, ctx, planOpts), [planLevel, target, ctx, planOpts])
  const almanaxPlan = useMemo(
    () => (prefs.almanax || planLevel >= target ? null : levelingPlan(planLevel, target, ctx, { ...planOpts, almanaxXpBonus: 0.5 })),
    [prefs.almanax, planLevel, target, ctx, planOpts],
  )
  const options = useMemo(() => {
    const list = craftOptionsAt(planLevel, ctx, rules, { kinds: prefs.kinds, fuelGauges: planOpts.fuelGauges, almanaxXpBonus: planOpts.almanaxXpBonus })
    if (prefs.includeCaptures) {
      const cap = captureOption(planLevel, ctx, rules, { almanaxXpBonus: planOpts.almanaxXpBonus })
      if (cap) list.push(cap)
    }
    return list
  }, [planLevel, ctx, rules, prefs.kinds, prefs.includeCaptures, planOpts.fuelGauges, planOpts.almanaxXpBonus])
  // Jour de jeu (heure de Paris), mis à jour à minuit : la page ne reste pas figée au jour de son ouverture.
  const today = useServerDay()
  const almanaxDays = useMemo(() => jobAlmanaxDays(today), [today])
  const nextXpDay = almanaxDays.find((d) => d.xpBonus > 0)

  const nextUnlock = plan.milestones.find((m) => m.level > planLevel)
  const atMax = planLevel >= MAX_LEVEL

  return (
    <div className="job-page">
      <PageHeader
        title="Métier Éleveur"
        subtitle="Quoi crafter, combien et pour quel coût pour monter Éleveur au plus vite et au moindre prix — et ce que chaque niveau débloque."
        actions={<Badge tone={rules.id === '3.7' ? 'warn' : 'info'}>Règles {rules.label}</Badge>}
      />
      <MarketStatusCallouts context="coûts de la montée du métier" showSource />

      <div className="grid grid-2">
        <LevelCard
          level={level}
          span={span}
          startXp={startXp}
          target={target}
          customTarget={prefs.target !== null && prefs.target > level}
          estLevel={planLevel}
          xpNow={xpNow}
          xpEntered={xpEntered}
          xpMax={xpMax}
          xpNeeded={plan.xpNeeded}
          nextUnlock={nextUnlock}
          journalXp={journalXp}
          levelSince={jobLevelUpdatedAt}
          onLevel={(v) => {
            updateSettings({ jobLevel: Math.max(1, Math.min(MAX_LEVEL, Math.round(v))) })
            setPrefs({ startXp: 0 })
          }}
          onApplyEstimate={(lvl, xpInLevel) => {
            // Le niveau est daté de maintenant : l'XP du journal déjà comptée ne le sera plus.
            updateSettings({ jobLevel: lvl, jobLevelUpdatedAt: Date.now() })
            setPrefs({ startXp: xpInLevel })
          }}
          onStartXp={(v) => setPrefs({ startXp: Math.max(0, Math.round(v)) })}
          onTarget={(v) => setPrefs({ target: v })}
        />
        <SettingsCard prefs={prefs} setPrefs={setPrefs} nextXpDay={nextXpDay?.date ?? null} />
      </div>

      {atMax ? (
        <Card className="next-step">
          <Callout tone="ok">
            <strong>Niveau 200 atteint.</strong> Les 6 enclos et tous les filets sont débloqués. Les crafts ne servent plus à monter : craftez selon vos besoins
            (carburants, Optimakinas) et visez la rentabilité.
          </Callout>
        </Card>
      ) : (
        <>
          <Summary plan={plan} almanaxPlan={almanaxPlan} almanaxOn={prefs.almanax} nextXpDay={nextXpDay ?? null} />
          <NextStep plan={plan} metric={prefs.metric} />
        </>
      )}

      <Card>
        <Tabs tabs={TABS} value={prefs.tab} onChange={(tab) => setPrefs({ tab })} />
        {prefs.tab === 'plan' && <PlanTab plan={plan} atMax={atMax} />}
        {prefs.tab === 'courses' && <ShoppingTab plan={plan} market={ctx.market ?? null} />}
        {prefs.tab === 'crafts' && (
          <CraftsTab level={level} options={options} chosenId={plan.segments[0]?.recipeId ?? null} sort={prefs.sort} onSort={(sort) => setPrefs({ sort })} metric={prefs.metric} />
        )}
        {prefs.tab === 'jalons' && <MilestonesTab plan={plan} target={target} familyLabel={FAMILIES[family]?.label ?? family} onTarget={(t) => setPrefs({ target: t })} />}
        {prefs.tab === 'xp' && <XpSourcesTab xpNeeded={plan.xpNeeded} target={target} />}
        {prefs.tab === 'almanax' && <AlmanaxTab days={almanaxDays} today={today} plan={plan} almanaxPlan={almanaxPlan} almanaxOn={prefs.almanax} />}
        {prefs.tab === 'reperes' && <ReferenceTab planOpts={planOpts} />}
      </Card>
    </div>
  )
}

// ---------- Niveau et objectif ----------

function LevelCard(props: {
  level: number
  span: number
  startXp: number
  target: number
  customTarget: boolean
  /** Niveau estimé maintenant (saisie + journal) : objectifs proposés, enclos débloqués. */
  estLevel: number
  /** XP estimée maintenant (saisie + journal). */
  xpNow: number
  /** XP saisie (niveau + XP dans le niveau), sans le journal. */
  xpEntered: number
  xpMax: number
  xpNeeded: number
  nextUnlock: PlanMilestone | undefined
  journalXp: JournalJobXp
  levelSince: number
  onLevel: (v: number) => void
  onStartXp: (v: number) => void
  onTarget: (v: number | null) => void
  onApplyEstimate: (level: number, xpInLevel: number) => void
}) {
  const { level, estLevel, span, startXp, target, customTarget, xpNow, xpEntered, xpMax, xpNeeded, nextUnlock, journalXp, levelSince } = props
  const withJournal = xpNow > xpEntered
  const nextPaddock = nextPaddockTarget(estLevel)
  const quick = [40, 80, 100, 120, 150, 160, 200].filter((l) => l > estLevel)
  const quickWhy: Record<number, string> = {
    40: '2e enclos',
    80: '3e enclos',
    100: 'filet multiplicateur',
    120: '4e enclos (objectif minimal)',
    150: 'filet renforcé',
    160: '5e enclos',
    200: '6e enclos',
  }
  const targetXp = jobXpForLevel(target)
  const fromXp = jobXpForLevel(level)
  return (
    <Card title="Où en êtes-vous ?">
      <div className="params">
        <NumberField label="Niveau d’Éleveur actuel" value={level} min={1} max={MAX_LEVEL} onChange={props.onLevel} />
        <NumberField
          label="XP déjà gagnée dans ce niveau"
          value={startXp}
          min={0}
          max={Math.max(0, span - 1)}
          suffix={span > 0 ? `/ ${formatNumber(span)}` : undefined}
          onChange={props.onStartXp}
        />
        <TargetField level={estLevel} target={target} onTarget={props.onTarget} />
      </div>
      <JournalEstimate level={level} xpNow={xpEntered} journalXp={journalXp} levelSince={levelSince} onApply={props.onApplyEstimate} />
      <div className="stack" style={{ marginTop: 12 }}>
        <div className="quick-levels" role="group" aria-label="Objectifs rapides">
          {estLevel < MAX_LEVEL && (
            <button type="button" className="btn small" aria-pressed={!customTarget} onClick={() => props.onTarget(null)}>
              Prochain enclos (niv. {nextPaddock})
            </button>
          )}
          {quick.map((l) => (
            <button key={l} type="button" className="btn small" aria-pressed={customTarget && target === l} title={quickWhy[l]} onClick={() => props.onTarget(l)}>
              Niv. {l}
            </button>
          ))}
        </div>
        {level < MAX_LEVEL && (
          <div className="xp-bar">
            <div className="row">
              <span>
                Vers le niveau {target} : {formatNumber(Math.max(0, xpNow - fromXp))} / {formatNumber(targetXp - fromXp)} XP{withJournal ? ' (journal compris)' : ''}
              </span>
              <span className="muted">{formatPercent(targetXp > fromXp ? (xpNow - fromXp) / (targetXp - fromXp) : 1, 0)}</span>
            </div>
            <Progress value={xpNow - fromXp} max={targetXp - fromXp} />
          </div>
        )}
        <div className="xp-bar">
          <div className="row">
            <span>
              Vers le niveau 200 : {formatNumber(xpNow)} / {formatNumber(xpMax)} XP
            </span>
            <span className="muted">{formatPercent(xpNow / xpMax, 1)}</span>
          </div>
          <Progress value={xpNow} max={xpMax} color="var(--gold)" />
        </div>
      </div>
      <div className="kpis" style={{ marginTop: 12 }}>
        <Stat label="Enclos débloqués" value={`${paddocksAt(estLevel)} / 6`} hint={`${paddocksAt(estLevel) * 10} places en enclos${paddocksAt(estLevel) > paddocksAt(level) ? ' (niveau estimé : mettez-le à jour)' : ''}`} />
        <Stat label={`XP restante (niv. ${target})`} value={formatNumber(xpNeeded)} hint={withJournal ? 'XP du journal déduite (estimation)' : 'table 10 × L × (L − 1)'} />
        <Stat
          label="Prochain déblocage"
          value={nextUnlock ? `Niv. ${nextUnlock.level}` : '—'}
          hint={nextUnlock ? `${nextUnlock.label} (${formatNumber(Math.max(0, jobXpForLevel(nextUnlock.level) - xpNow))} XP)` : 'tout est débloqué'}
        />
      </div>
    </Card>
  )
}

/**
 * Niveau estimé d'après le journal : XP d'Éleveur enregistrée (captures, accouplements, crafts) depuis la
 * dernière saisie du niveau, ajoutée au niveau saisi. Plancher (bonus Almanax et XP non journalisée non
 * comptés) : affiché comme estimation, appliqué seulement si le joueur le demande.
 */
function JournalEstimate({
  level,
  xpNow,
  journalXp,
  levelSince,
  onApply,
}: {
  level: number
  xpNow: number
  journalXp: JournalJobXp
  levelSince: number
  onApply: (level: number, xpInLevel: number) => void
}) {
  if (journalXp.xp <= 0 || level >= MAX_LEVEL) return null
  const total = Math.min(jobXpForLevel(MAX_LEVEL), xpNow + journalXp.xp)
  const estLevel = Math.min(MAX_LEVEL, jobLevelFromXp(total))
  const xpInLevel = estLevel >= MAX_LEVEL ? 0 : total - jobXpForLevel(estLevel)
  const parts = [
    journalXp.captures ? plural(journalXp.captures, 'capture') : null,
    journalXp.matings ? plural(journalXp.matings, 'accouplement') : null,
    journalXp.crafts ? plural(journalXp.crafts, 'craft') : null,
  ].filter(Boolean)
  return (
    <Callout>
      <strong>Journal :</strong> +{formatNumber(journalXp.xp)} XP d’Éleveur enregistrés {levelSince > 0 ? `depuis la saisie du niveau (${formatDate(levelSince)})` : 'depuis le début du journal'}
      {parts.length ? ` (${parts.join(', ')})` : ''}. Niveau estimé : <strong>{estLevel}</strong>
      {estLevel < MAX_LEVEL && <> (+{formatNumber(xpInLevel)} XP dans le niveau)</>} <Badge tone="warn">estimation</Badge> Le plan ci-dessous en tient déjà compte,
      comme l’accueil.
      <div className="row" style={{ marginTop: 6 }}>
        <button type="button" className="btn small" onClick={() => onApply(estLevel, xpInLevel)}>
          {estLevel > level ? `Passer au niveau ${estLevel}` : 'Ajouter cette XP au niveau actuel'}
        </button>
        <small className="muted">Vérifiez en jeu : les bonus Almanax et l’XP non notée dans le journal ne sont pas comptés.</small>
      </div>
    </Callout>
  )
}

/**
 * Champ « Niveau visé » à brouillon local : on peut taper 150 chiffre par chiffre sans que la valeur
 * soit ramenée au prochain enclos pendant la saisie. Validé dès que la valeur est un niveau > actuel.
 */
function TargetField({ level, target, onTarget }: { level: number; target: number; onTarget: (v: number | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (raw: string) => {
    const v = Math.round(Number(raw))
    if (raw !== '' && Number.isFinite(v) && v > level && v <= MAX_LEVEL) onTarget(v)
  }
  return (
    <label className="field">
      Niveau visé
      <input
        type="number"
        min={Math.min(MAX_LEVEL, level + 1)}
        max={MAX_LEVEL}
        value={draft ?? String(target)}
        style={{ width: 110 }}
        onChange={(e) => {
          setDraft(e.target.value)
          commit(e.target.value)
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setDraft(null)
        }}
      />
    </label>
  )
}

// ---------- Réglages du plan ----------

function SettingsCard({ prefs, setPrefs, nextXpDay }: { prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void; nextXpDay: string | null }) {
  const toggleKind = (k: JobRecipeKind) => {
    const has = prefs.kinds.includes(k)
    if (has && prefs.kinds.length === 1) return
    setPrefs({ kinds: has ? prefs.kinds.filter((x) => x !== k) : [...prefs.kinds, k] })
  }
  return (
    <Card title="Comment voulez-vous monter ?">
      <div className="params">
        <SelectField<JobMetric>
          label="Priorité"
          value={prefs.metric}
          onChange={(metric) => setPrefs({ metric })}
          options={[
            { value: 'kamas', label: JOB_METRIC_LABELS.kamas },
            { value: 'ressources', label: JOB_METRIC_LABELS.ressources },
          ]}
        />
        <SelectField<GaugeId | 'auto'>
          label="Jauge des carburants"
          value={prefs.gauge}
          onChange={(gauge) => setPrefs({ gauge })}
          options={[{ value: 'auto', label: 'Automatique (la moins chère connue)' }, ...GAUGE_IDS.map((g) => ({ value: g, label: GAUGE_LABELS[g] }))]}
        />
        <div className="wide stack" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            Recettes autorisées
          </span>
          <div className="checks">
            {JOB_RECIPE_KINDS.map((k) => (
              <label key={k} className="check">
                <input type="checkbox" checked={prefs.kinds.includes(k)} disabled={prefs.kinds.includes(k) && prefs.kinds.length === 1} onChange={() => toggleKind(k)} />
                {k === 'carburant' ? 'Carburants' : k === 'makina' ? 'Makinas' : 'Filets'}
              </label>
            ))}
          </div>
          <div className="checks">
            <label className="check">
              <input type="checkbox" checked={prefs.includeCaptures} onChange={(e) => setPrefs({ includeCaptures: e.target.checked })} />
              Utiliser les captures (filet universel crafté puis lancé : +30 XP)
            </label>
            <label className="check">
              <input type="checkbox" checked={prefs.almanax} onChange={(e) => setPrefs({ almanax: e.target.checked })} />
              Crafter un jour à +50 % d’XP{nextXpDay ? ` (prochain : ${formatLongDate(nextXpDay)})` : ''}
            </label>
          </div>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 10, fontSize: '0.85rem' }}>
        <strong>Pourquoi ?</strong> {prefs.metric === 'kamas'
          ? 'Le plan choisit à chaque niveau la recette la moins chère par point d’XP, avec vos prix. Si aucune recette efficace n’a de prix complet, il prend celle qui demande le moins de ressources et le signale.'
          : 'Le plan choisit à chaque niveau la recette qui demande le moins de ressources par point d’XP : en pratique la taille de carburant qui vient d’être débloquée (une nouvelle tous les 10 niveaux).'}{' '}
        La jauge ne change pas l’XP : prenez celle dont vos enclos ont besoin (≈ 24 % Foudroyeur, Abreuvoir, Dragofesse et Mangeoire, ≈ 2 % Baffeur et Caresseur pendant la montée).
      </p>
    </Card>
  )
}

// ---------- Synthèse ----------

function Summary({
  plan,
  almanaxPlan,
  almanaxOn,
  nextXpDay,
}: {
  plan: LevelingPlan
  almanaxPlan: LevelingPlan | null
  almanaxOn: boolean
  nextXpDay: { date: string; daysUntil: number; name: string } | null
}) {
  const t = plan.totals
  const missing = plan.shopping.filter((l) => l.missing)
  const levels = Math.max(1, plan.toLevel - plan.fromLevel)
  return (
    <Card title={`Monter du niveau ${plan.fromLevel} au niveau ${plan.toLevel}`}>
      <div className="kpis">
        <Stat label="Crafts" value={formatNumber(t.crafts)} hint={t.captures ? `dont ${plural(t.captures, 'capture', 'captures')}` : plural(plan.segments.length, 'étape', 'étapes')} />
        <Stat label="Ressources à réunir" value={formatNumber(t.resources)} hint={plural(plan.shopping.length, 'ingrédient différent', 'ingrédients différents')} />
        <Stat label="Coût des ingrédients" value={<Cost value={t.cost} complete={t.costComplete} />} hint={t.costComplete ? 'prix complets' : `${plural(missing.length, 'ingrédient', 'ingrédients')} sans prix : borne basse`} />
        <Stat label="XP gagnée" value={formatNumber(t.xp)} hint={`besoin : ${formatNumber(plan.xpNeeded)} XP`} />
        <Stat
          label="Valeur HDV des objets produits"
          value={t.productValue > 0 ? `${t.productsUnpriced ? '≥ ' : ''}${formatKamas(t.productValue, true)}` : '—'}
          hint={t.productsUnpriced ? `${plural(t.productsUnpriced, 'craft', 'crafts')} sans prix HDV connu` : 'carburants réutilisables ou revendables'}
        />
      </div>
      {plan.blockedAt !== null && (
        <Callout tone="danger">
          <strong>Plan interrompu au niveau {plan.blockedAt}</strong> : aucune recette autorisée ne rapporte d’XP à ce niveau. Avant le niveau 5, seul le Filet de capture
          universel est craftable : cochez « Filets » ou « Utiliser les captures ».
        </Callout>
      )}
      {!t.costComplete && t.crafts > 0 && (
        <Callout tone="warn">
          <strong>Coût incomplet</strong> : {plural(missing.length, 'ingrédient n’a', 'ingrédients n’ont')} pas de prix (jamais compté comme 0) ; le total est une borne
          basse. À chiffrer en priorité : <PriceLinks ids={missing.slice(0, 6).map((l) => l.id)} max={6} />. <a href={href('prix', { onglet: 'ingredients' })}>Compléter les prix</a>
        </Callout>
      )}
      {plan.metric === 'kamas' && plan.fallbackLevels > 0 && (
        <Callout>
          <strong>Repli « ressources » sur {plural(plan.fallbackLevels, 'niveau', 'niveaux')} sur {formatNumber(levels)}</strong> : aucune recette efficace n’y a de prix complet,
          le plan prend celle qui demande le moins de ressources par XP (marquée « repli » dans le plan). Chiffrez les ingrédients signalés pour un vrai calcul en kamas.
        </Callout>
      )}
      {almanaxOn && (
        <Callout>
          Bonus +50 % appliqué à l’XP de craft (arrondi à l’entier inférieur), pas aux 30 XP de capture : hypothèse à vérifier en jeu (l’interface de craft affiche l’XP gagnée).
        </Callout>
      )}
      {!almanaxOn && almanaxPlan && almanaxPlan.totals.crafts < t.crafts && nextXpDay && (
        <Callout tone="ok">
          <strong>Astuce Almanax</strong> : le {formatLongDate(nextXpDay.date)} ({inDays(nextXpDay.daysUntil)}, {nextXpDay.name}), le même objectif demanderait{' '}
          {formatNumber(almanaxPlan.totals.crafts)} crafts au lieu de {formatNumber(t.crafts)} (−{formatPercent(1 - almanaxPlan.totals.crafts / t.crafts, 0)}), soit{' '}
          {formatNumber(t.resources - almanaxPlan.totals.resources)} ressources de moins.
        </Callout>
      )}
    </Card>
  )
}

// ---------- Prochaine étape ----------

function NextStep({ plan, metric }: { plan: LevelingPlan; metric: JobMetric }) {
  const s = plan.segments[0]
  if (!s) return null
  const after = plan.segments.slice(1, 4)
  const perCraft = s.crafts > 0 ? s.cost / s.crafts : 0
  const ingredients = ingredientsOf(s, plan.shopping)
  let why: ReactNode
  if (s.kind === 'capture')
    why = (
      <>
        Au tout début, un Filet de capture universel crafté puis lancé rapporte plus d’XP par ressource que les Extraits (XP du craft + 30 XP de capture). Prévoyez un combat
        gagné par capture, dans une zone de montures sauvages.
      </>
    )
  else if (s.fallback)
    why = (
      <>
        Aucune recette efficace n’a de prix complet à ce niveau : elle est choisie parce qu’elle demande le moins de ressources par XP. Chiffrez <PriceLinks ids={s.toPrice} /> pour
        comparer les coûts.
      </>
    )
  else if (metric === 'kamas' && s.complete)
    why = <>C’est la recette la moins chère par point d’XP à votre niveau : {kamasPerXp(perCraft / Math.max(1, s.xpPerCraftStart))} par XP au départ.</>
  else why = <>C’est la recette qui demande le moins de ressources par point d’XP à votre niveau.</>
  return (
    <Card title="Prochaine étape" className="next-step">
      <div className="headline">
        Craftez <strong>{formatNumber(s.crafts)} × {s.recipeName}</strong> (recette niv. {s.recipeLevel}) pour passer du niveau {s.fromLevel} au niveau {s.toLevel}.
      </div>
      <p style={{ marginBottom: 6 }}>
        <strong>Pourquoi :</strong> {why} Son XP baisse à mesure que vous montez ({formatNumber(s.xpPerCraftStart)} → {formatNumber(s.xpPerCraftEnd)} XP par craft) : 9 niveaux
        au-dessus d’une recette, elle ne rapporte plus que ≈ 47 % de son XP, d’où le changement de recette tous les 10 niveaux.
      </p>
      <div className="row">
        <span>
          Coût de l’étape : <Cost value={s.cost} complete={s.complete} q={s.toPrice[0] !== undefined ? itemName(s.toPrice[0]) : undefined} />
        </span>
        <span className="muted">· {formatNumber(s.resources)} ressources</span>
        {s.gauge && <span className="muted">· même XP avec la même taille d’une autre jauge</span>}
      </div>
      {ingredients.length > 0 && (
        <ul className="ing-list" aria-label="Ingrédients de l’étape">
          {ingredients.map((l) => (
            <li key={l.id}>
              {l.missing ? <a href={href('prix', { q: l.name })}>{l.name}</a> : <span>{l.name}</span>}
              <span className="qty">× {formatNumber(l.qty)}</span>
            </li>
          ))}
        </ul>
      )}
      {after.length > 0 && (
        <p className="muted" style={{ margin: '10px 0 0', fontSize: '0.88rem' }}>
          Ensuite :{' '}
          {after.map((a, i) => (
            <span key={`${a.recipeId}-${a.fromLevel}`}>
              {i > 0 && ' → '}
              {formatNumber(a.crafts)} × {a.recipeName} (niv. {a.fromLevel} → {a.toLevel})
            </span>
          ))}
          {plan.segments.length > 4 && ' → …'}
        </p>
      )}
    </Card>
  )
}

/** Ingrédients d'une étape (quantités de l'étape seule). */
function ingredientsOf(s: PlanSegment, shopping: ShoppingLine[]): { id: number; name: string; qty: number; missing: boolean }[] {
  return s.ingredients.map((ing) => {
    const line = shopping.find((l) => l.id === ing.id)
    return { id: ing.id, name: itemName(ing.id), qty: ing.qty * s.crafts, missing: line?.missing ?? true }
  })
}

// ---------- Onglet : plan ----------

function PlanTab({ plan, atMax }: { plan: LevelingPlan; atMax: boolean }) {
  if (atMax || plan.toLevel <= plan.fromLevel) return <Empty>Vous êtes déjà au niveau visé : choisissez un objectif plus haut.</Empty>
  if (!plan.segments.length) return <Empty>Aucune étape : vérifiez les recettes autorisées.</Empty>
  const t = plan.totals
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        Chaque étape enchaîne la même recette jusqu’au niveau indiqué. Les quantités tiennent compte de la baisse d’XP à chaque niveau (formule du client, validée en jeu).
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Niveaux</th>
              <th>Recette à crafter</th>
              <th className="num">Crafts</th>
              <th className="num">XP / craft</th>
              <th className="num">Ressources</th>
              <th className="num">Coût</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {plan.segments.map((s, i) => (
              <tr key={`${s.recipeId}-${s.fromLevel}`}>
                <td className="num">{i + 1}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {s.fromLevel} → {s.toLevel}
                </td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <span>{s.recipeName}</span>
                    <KindBadge kind={s.kind} />
                  </div>
                  <small className="muted">
                    recette niv. {s.recipeLevel}
                    {s.captures > 0 ? ` · ${plural(s.captures, 'capture', 'captures')} (combats à prévoir)` : ''}
                  </small>
                </td>
                <td className="num">{formatNumber(s.crafts)}</td>
                <td className="num">
                  {s.xpPerCraftStart === s.xpPerCraftEnd ? formatNumber(s.xpPerCraftStart) : `${formatNumber(s.xpPerCraftStart)} → ${formatNumber(s.xpPerCraftEnd)}`}
                </td>
                <td className="num">{formatNumber(s.resources)}</td>
                <td className="num">
                  <Cost value={s.cost} complete={s.complete} q={s.toPrice[0] !== undefined ? itemName(s.toPrice[0]) : undefined} />
                </td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    {s.fallback && (
                      <Badge tone="warn" title="Aucune recette efficace n'a de prix complet : choix au critère ressources">
                        repli ressources
                      </Badge>
                    )}
                    {s.complete ? <Badge tone="ok">chiffré</Badge> : <Badge tone="danger">incomplet</Badge>}
                  </div>
                  {s.toPrice.length > 0 && (
                    <small className="muted">
                      À chiffrer : <PriceLinks ids={s.toPrice} max={3} />
                    </small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td>
                {plan.fromLevel} → {plan.reachedLevel}
              </td>
              <td>Total</td>
              <td className="num">{formatNumber(t.crafts)}</td>
              <td className="num">{formatNumber(t.xp)} XP</td>
              <td className="num">{formatNumber(t.resources)}</td>
              <td className="num">
                <Cost value={t.cost} complete={t.costComplete} />
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <small className="muted">
        Repère : de 1 à 200 en craftant toujours la dernière taille débloquée, la recherche compte ≈ 6 993 crafts et ≈ 23 535 ressources (26 filets universels puis les
        carburants ; strategy.md §3.2) ; la simulation de cette page retrouve ces chiffres.
      </small>
    </div>
  )
}

// ---------- Onglet : liste de courses ----------

/** Jours de ventes du serveur (volume moyen sur 30 j) que représente un achat ; null = inconnu. */
function marketDays(id: number, qty: number, market: MarketSource | null): number | null {
  const d = marketDepth(market, id)
  return d && d.perDayAvg > 0 ? qty / d.perDayAvg : null
}

/** Au-delà de ce nombre de jours de ventes du serveur, un achat fait monter le prix (à étaler). */
const BUY_DAYS_WARN = 1

function ShoppingTab({ plan, market }: { plan: LevelingPlan; market: MarketSource | null }) {
  const [copied, setCopied] = useState<'ok' | 'err' | null>(null)
  if (!plan.shopping.length) return <Empty>Rien à acheter : aucun craft n’est prévu pour cet objectif.</Empty>
  const missing = plan.shopping.filter((l) => l.missing)
  const heavy = market ? plan.shopping.filter((l) => (marketDays(l.id, l.qty, market) ?? 0) > BUY_DAYS_WARN) : []
  const known = plan.shopping.reduce((s, l) => s + (l.subtotal ?? 0), 0)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shoppingListText(plan.shopping))
      setCopied('ok')
    } catch {
      setCopied('err')
    }
  }
  return (
    <div className="stack">
      <div className="row">
        <p className="muted" style={{ margin: 0 }}>
          Tous les ingrédients du plan, du niveau {plan.fromLevel} au niveau {plan.reachedLevel}. Les prix viennent de la page Prix : vos prix, sinon le marché du serveur
          {market ? ` (export HDV du ${frenchDay(market.exportDate)})` : ' (aucun export HDV importé)'}, sinon les prix par défaut sourcés.
        </p>
        <span className="spacer" />
        <button type="button" className="btn small" onClick={copy}>
          Copier la liste
        </button>
        {copied === 'ok' && <Badge tone="ok">copiée</Badge>}
        {copied === 'err' && <Badge tone="danger">copie impossible</Badge>}
      </div>
      {missing.length > 0 && (
        <Callout tone="warn">
          {plural(missing.length, 'ingrédient sans prix', 'ingrédients sans prix')} sur {plan.shopping.length} : le total est une borne basse.{' '}
          <a href={href('prix', { onglet: 'ingredients' })}>Saisir les prix des ingrédients</a>
        </Callout>
      )}
      {heavy.length > 0 && (
        <Callout tone="warn">
          {plural(heavy.length, 'ingrédient demande', 'ingrédients demandent')} plus d’une journée de ventes du serveur ({heavy
            .slice(0, 4)
            .map((l) => l.name)
            .join(', ')}
          {heavy.length > 4 ? '…' : ''}) : achetez en plusieurs fois ou attendez-vous à payer plus cher que le prix affiché.
        </Callout>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Ingrédient</th>
              <th className="num">Quantité</th>
              <th className="num">Prix unitaire</th>
              <th className="num">Sous-total</th>
              <th>Origine du prix</th>
              {market && <th className="num">Volume du serveur</th>}
            </tr>
          </thead>
          <tbody>
            {plan.shopping.map((l) => {
              const q = l.origin === 'marche' ? marketQuote(l.id, market) : null
              const depth = market ? marketDepth(market, l.id) : null
              const days = marketDays(l.id, l.qty, market)
              return (
                <tr key={l.id}>
                  <td>{l.missing ? <a href={href('prix', { q: l.name })}>{l.name}</a> : l.name}</td>
                  <td className="num">{formatNumber(l.qty)}</td>
                  <td className="num">{l.unit === null ? '—' : `${l.missing ? '≥ ' : ''}${formatKamas(l.unit)}`}</td>
                  <td className="num">{l.subtotal === null ? <Cost value={null} complete={false} q={l.name} /> : `${l.missing ? '≥ ' : ''}${formatKamas(l.subtotal)}`}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {q ? (
                        <Badge
                          tone="info"
                          title={marketPriceTitle(q.info)}
                        >
                          marché ({frenchDay(q.info.exportDate).slice(0, 5)})
                        </Badge>
                      ) : (
                        <Badge tone={ORIGIN_LABELS[l.origin].tone}>{ORIGIN_LABELS[l.origin].label}</Badge>
                      )}
                      {l.origin === 'defaut' && <ConfidenceBadge level={l.confidence} />}
                    </div>
                  </td>
                  {market && (
                    <td className="num" title={depth ? `${formatNumber(depth.sold24)} vendus en 24 h, ${formatNumber(depth.sold30)} en 30 jours` : 'Absent de l’export HDV'}>
                      {depth ? `${formatNumber(depth.perDayAvg, depth.perDayAvg < 10 ? 1 : 0)}/jour` : '—'}
                      {days !== null && days > BUY_DAYS_WARN && (
                        <>
                          {' '}
                          <Badge tone="warn">≈ {formatNumber(days, days < 10 ? 1 : 0)} j de ventes</Badge>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">{formatNumber(plan.totals.resources)}</td>
              <td />
              <td className="num">
                <Cost value={known} complete={missing.length === 0} />
              </td>
              <td />
              {market && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
      <small className="muted">
        Astuces : achetez hors des pics de demande (×10 au lancement de la 3.5) ; le 10/05 (Loumi) économise 15 % d’ingrédients et le 10/08 (Rigamix) donne 25 % de chances d’un
        second objet.
      </small>
    </div>
  )
}

// ---------- Onglet : crafts possibles ----------

function CraftsTab({
  level,
  options,
  chosenId,
  sort,
  onSort,
  metric,
}: {
  level: number
  options: CraftOption[]
  chosenId: number | null
  sort: { key: SortKey; dir: 1 | -1 }
  onSort: (s: { key: SortKey; dir: 1 | -1 }) => void
  metric: JobMetric
}) {
  const [showAll, setShowAll] = useState(false)
  const sorted = useMemo(() => {
    const base = sort.key === 'xp' ? [...options].sort((a, b) => b.xp - a.xp || a.resourcesPerXp - b.resourcesPerXp) : sortCraftOptions(options, sort.key)
    return sort.dir === 1 ? base : [...base].reverse()
  }, [options, sort])
  if (!options.length) return <Empty>Aucune recette ne rapporte d’XP au niveau {level} avec les recettes autorisées.</Empty>
  const shown = showAll ? sorted : sorted.slice(0, 15)
  const header = (key: SortKey, label: string, title: string) => {
    const active = sort.key === key
    return (
      <th className="num" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button type="button" title={title} onClick={() => onSort({ key, dir: active ? (sort.dir === 1 ? -1 : 1) : 1 })}>
          {label}
          {active ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
        </button>
      </th>
    )
  }
  const priced = options.filter((o) => o.kamasPerXp !== null).length
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        {plural(options.length, 'recette rapporte', 'recettes rapportent')} de l’XP au niveau {level} ({plural(priced, 'avec un coût complet', 'avec un coût complet')}). Triez par
        kamas/XP ou ressources/XP ; la ligne surlignée est celle retenue par le plan ({JOB_METRIC_LABELS[metric].toLowerCase()}).
      </p>
      <div className="table-wrap">
        <table className="table sortable">
          <thead>
            <tr>
              <th>Recette</th>
              <th className="num">Niv.</th>
              {header('xp', 'XP / craft', 'Trier par XP par craft')}
              <th className="num">Ingrédients</th>
              <th className="num">Coût / craft</th>
              {header('kamas', 'Kamas / XP', 'Trier par kamas par point d’XP (coûts complets d’abord)')}
              {header('ressources', 'Ress. / XP', 'Trier par ressources par point d’XP')}
              <th className="num">Prix HDV de l’objet</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.id} className={o.id === chosenId ? 'chosen' : undefined}>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <span>{o.name}</span>
                    <KindBadge kind={o.kind} />
                    {o.beta37 && <Badge tone="warn">recette 3.7</Badge>}
                    {o.id === chosenId && <Badge tone="accent">choix du plan</Badge>}
                  </div>
                  {!o.costComplete && o.missing.length > 0 && (
                    <small className="muted">
                      Sans prix : <PriceLinks ids={o.missing} max={3} />
                    </small>
                  )}
                </td>
                <td className="num">{o.level}</td>
                <td className="num">{formatNumber(o.xp)}</td>
                <td className="num">{formatNumber(o.ingredientCount)}</td>
                <td className="num">
                  <Cost value={o.cost} complete={o.costComplete} q={o.missing[0] !== undefined ? itemName(o.missing[0]) : undefined} />
                </td>
                <td className="num">{o.kamasPerXp !== null ? kamasPerXp(o.kamasPerXp) : o.kamasPerXpMin !== null ? `≥ ${kamasPerXp(o.kamasPerXpMin)}` : '—'}</td>
                <td className="num">{formatNumber(o.resourcesPerXp, 2)}</td>
                <td className="num">{o.productValue !== null ? formatKamas(o.productValue) : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > 15 && (
        <div>
          <button type="button" className="btn small" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Afficher les 15 premières' : `Afficher les ${formatNumber(sorted.length)} recettes`}
          </button>
        </div>
      )}
      <XpDecayTable />
    </div>
  )
}

/** Pourquoi crafter la taille qui vient d'être débloquée : XP d'une recette selon l'écart de niveau. */
function XpDecayTable() {
  const recipes = [45, 95, 145, 195]
  const gaps = [0, 5, 9, 20]
  return (
    <details>
      <summary className="muted" style={{ cursor: 'pointer' }}>
        Pourquoi crafter la taille qui vient d’être débloquée ?
      </summary>
      <p className="muted" style={{ fontSize: '0.88rem', margin: '8px 0' }}>
        XP par craft = ⌊20 × L × ratio / (1 + 0,1 × (J − L)^1,1)⌋, ratio 5 % (50 % pour le filet universel) : une recette de niveau L faite au niveau L rapporte L XP, puis ≈ 47 %
        neuf niveaux plus haut, et 0 au-delà de 100 niveaux (formule du client, validée sur 3 valeurs en jeu).
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Recette</th>
              {gaps.map((g) => (
                <th key={g} className="num">
                  {g === 0 ? 'J = L' : `J = L + ${g}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recipes.map((L) => (
              <tr key={L}>
                <td>niv. {L}</td>
                {gaps.map((g) => (
                  <td key={g} className="num">
                    {L + g <= MAX_LEVEL ? `${formatNumber(craftXp(L, L + g, 5))} XP` : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

// ---------- Onglet : jalons ----------

function MilestonesTab({ plan, target, familyLabel, onTarget }: { plan: LevelingPlan; target: number; familyLabel: string; onTarget: (t: number) => void }) {
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        Ce que débloque chaque niveau : enclos (meilleur niveau d’Éleveur du compte), paliers de carburants, filets et Optimakinas ({familyLabel}, famille des réglages). Les cumuls
        partent de votre niveau actuel et suivent le plan.
      </p>
      <ol className="timeline">
        {plan.milestones.map((m) => (
          <li key={`${m.kind}-${m.level}-${m.label}`} className={m.status}>
            <span className="lvl" aria-label={`Niveau ${m.level}`}>
              {m.level}
            </span>
            <div className="what">
              <div className="title">
                {m.label}
                <Badge tone={MILESTONE_KIND_LABELS[m.kind].tone}>{MILESTONE_KIND_LABELS[m.kind].label}</Badge>
                {m.status === 'acquis' && <Badge tone="ok">débloqué</Badge>}
                {m.status === 'plan' && <Badge tone="accent">dans le plan</Badge>}
              </div>
              <small className="muted">{m.detail}</small>
              {m.status === 'plan' && m.crafts !== null && (
                <small>
                  Atteint après {formatNumber(m.crafts)} crafts · {formatNumber(m.resources ?? 0)} ressources · <Cost value={m.cost} complete={m.costComplete} />
                </small>
              )}
              {m.status === 'au-dela' && (
                <small className="muted">
                  Au-delà de l’objectif (niv. {target}) —{' '}
                  <button type="button" className="btn small ghost" style={{ padding: 0, color: 'var(--accent)' }} onClick={() => onTarget(m.level)}>
                    viser le niveau {m.level}
                  </button>
                </small>
              )}
            </div>
          </li>
        ))}
      </ol>
      <small className="muted">
        Objectif minimal conseillé : niveau 120 (4 enclos, « vrai luxe » selon DPLN), puis 150 pour le filet de zone, 200 pour la production de masse.
      </small>
    </div>
  )
}

// ---------- Onglet : autres sources d'XP ----------

function XpSourcesTab({ xpNeeded, target }: { xpNeeded: number; target: number }) {
  const rules = useRules()
  const sources = useMemo(() => otherXpSources(xpNeeded, rules), [xpNeeded, rules])
  const chainXp = typeof STRATEGY.jobLevelingNotes.chainXp === 'string' ? STRATEGY.jobLevelingNotes.chainXp : null
  if (xpNeeded <= 0) return <Empty>Aucune XP à gagner pour cet objectif.</Empty>
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        Combien d’actions remplaceraient les crafts pour les {formatNumber(xpNeeded)} XP qui vous séparent du niveau {target}. En pratique on cumule : chaque capture et chaque
        accouplement de votre élevage avance aussi le métier.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Source</th>
              <th className="num">XP par action</th>
              <th className="num">Actions nécessaires</th>
              <th>Remarques</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    {s.label}
                    <ConfidenceBadge level={s.confidence} />
                  </div>
                </td>
                <td className="num">{formatNumber(s.xpEach)}</td>
                <td className="num">{formatNumber(s.count)}</td>
                <td>
                  <small className="muted">{s.note}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Callout>
        XP d’accouplement = {rules.matingXpPerGeneration} × (génération A + génération B) × nombre de bébés (règles {rules.id}
        {rules.id === '3.5' ? ' : 10 en 3.5, 30 depuis la 3.6' : ''}). {chainXp ? `${chainXp} ` : ''}Les crafts restent la voie principale vers 120 puis 200.
      </Callout>
      <small className="muted">
        Non comptés : la quête quotidienne « Aller Hue » (1 à 2 niveaux d’Éleveur par jour selon un commentaire, non vérifié) et le bonus saisonnier « +25 % XP tous métiers »
        listé par DofusDB (à vérifier en jeu).
      </small>
    </div>
  )
}

// ---------- Onglet : Almanax ----------

function AlmanaxTab({
  days,
  today,
  plan,
  almanaxPlan,
  almanaxOn,
}: {
  days: ReturnType<typeof jobAlmanaxDays>
  today: string
  plan: LevelingPlan
  almanaxPlan: LevelingPlan | null
  almanaxOn: boolean
}) {
  // Heure locale du changement de jour de jeu, si le navigateur n'est pas à l'heure de Paris (recalculée chaque jour de jeu).
  const changeAt = useMemo(() => serverDayChangeIfNotLocalMidnight(today), [today])
  if (!days.length) return <Empty>Aucun jour Almanax lié au métier dans le calendrier.</Empty>
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        Jours de l’Almanax utiles pour monter le métier (calendrier DofusDB, dates annuelles). Gardez vos ressources pour ces jours-là si vous le pouvez.
        Les dates suivent l’heure des serveurs (Paris).
        {changeAt !== null && <> Chez vous, le jour de jeu change à {formatClock(changeAt, changeAt)}.</>}
      </p>
      <ul className="almanax-list">
        {days.map((d) => {
          const saving = d.ingredientSaving > 0 ? Math.round(plan.totals.resources * d.ingredientSaving) : 0
          return (
            <li key={d.date} className={d.xpBonus > 0 && d.breederOnly ? 'highlight' : undefined}>
              <span className="date">{formatLongDate(d.date)}</span>
              <span className="muted">
                {inDays(d.daysUntil)} · {d.name}
              </span>
              <span>
                <strong>{d.effect}</strong>
                {d.use ? <span className="muted"> — {d.use}</span> : null}
              </span>
              {d.xpBonus > 0 && !almanaxOn && almanaxPlan && plan.totals.crafts > 0 && (
                <small>
                  Votre plan : {formatNumber(almanaxPlan.totals.crafts)} crafts au lieu de {formatNumber(plan.totals.crafts)} (−
                  {formatNumber(plan.totals.resources - almanaxPlan.totals.resources)} ressources).
                </small>
              )}
              {saving > 0 && (
                <small>
                  ≈ {formatNumber(saving)} ressources économisées sur votre plan <Badge tone="warn">estimation</Badge>
                </small>
              )}
              {d.doubleCraftChance > 0 && <small className="muted">Un objet sur quatre en double en moyenne : idéal pour les makinas et carburants chers.</small>}
              {!d.breederOnly && d.xpBonus > 0 && <small className="muted">Bonus valable pour tous les métiers.</small>}
            </li>
          )
        })}
      </ul>
      <small className="muted">
        Les autres jours Almanax d’élevage (Takeza, bébés Sage, jauges doublées…) sont sur la page d’accueil et dans le plan d’élevage.
      </small>
    </div>
  )
}

// ---------- Onglet : repères ----------

interface ResearchStep {
  from: number
  to: number
  xpNeeded: number
  recipes: string[]
  craftsCumulative?: number
  resourcesCumulative?: number
  unlocks?: string[]
  alternatives?: string
}

function ReferenceTab({ planOpts }: { planOpts: LevelingOptions }) {
  const ctx = useLevelingPriceContext()
  const reference = useMemo(
    () => levelingPlan(1, MAX_LEVEL, ctx, { rules: planOpts.rules, metric: 'ressources', family: planOpts.family }),
    [ctx, planOpts.rules, planOpts.family],
  )
  const steps = STRATEGY.jobLevelingPlan as ResearchStep[]
  const at = (lvl: number) => reference.progress.find((p) => p.level === lvl)
  return (
    <div className="stack">
      <h3 style={{ margin: 0 }}>Plan de la recherche (1 → 200, dernière taille débloquée)</h3>
      <p className="muted" style={{ margin: 0 }}>
        Source : research/strategy.md §3.2 (formule du client + table DPLN ; confiance haute pour l’XP). La colonne « cette page » rejoue la même stratégie avec le simulateur.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Palier</th>
              <th className="num">XP à gagner</th>
              <th>Recettes</th>
              <th className="num">Crafts cumulés</th>
              <th className="num">Ressources cumulées</th>
              <th className="num">Cette page</th>
              <th>Débloque</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => {
              const p = at(s.to)
              return (
                <tr key={`${s.from}-${s.to}`}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {s.from} → {s.to}
                  </td>
                  <td className="num">{formatNumber(s.xpNeeded)}</td>
                  <td>
                    <small>{s.recipes.join(', ')}</small>
                    {s.alternatives && <small className="muted">ou {s.alternatives}</small>}
                  </td>
                  <td className="num">{s.craftsCumulative !== undefined ? formatNumber(s.craftsCumulative) : '—'}</td>
                  <td className="num">{s.resourcesCumulative !== undefined ? formatNumber(s.resourcesCumulative) : '—'}</td>
                  <td className="num">{p ? `${formatNumber(p.crafts)} / ${formatNumber(p.resources)}` : '—'}</td>
                  <td>
                    <small>{(s.unlocks ?? []).join(', ')}</small>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <h3 style={{ margin: '8px 0 0' }}>Coûts de montée rapportés par des joueurs</h3>
      <Callout tone="warn">
        <strong>Témoignages communautaires</strong> (research/economy.md §10), sur des serveurs et à des dates différents, en plein marché spéculatif du lancement de la 3.5 : un
        ordre de grandeur, pas un prix. Le coût calculé plus haut utilise vos prix.
      </Callout>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Tranche</th>
              <th>Coût rapporté</th>
              <th>Date</th>
              <th>Source</th>
              <th>Fiabilité</th>
            </tr>
          </thead>
          <tbody>
            {JOB_COST_REPORTS.map((r) => (
              <tr key={`${r.range}-${r.source}`}>
                <td style={{ whiteSpace: 'nowrap' }}>{r.range}</td>
                <td>
                  <strong>{r.value}</strong>
                  <small className="muted">{r.note}</small>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.date}</td>
                <td>
                  <small>{r.source}</small>
                </td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <Badge tone="gold">témoignage</Badge>
                    <ConfidenceBadge level={r.confidence} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
