// Plan d'élevage : objectif (monture visée ou rentabilité maximale), phase P0–P6 avec checklists
// persistées, chemin vers l'objectif (recette, captures par couleur, effort attendu), calendrier
// estimé (simulation rapide), stratégie conseillée, routines, Almanax à exploiter, erreurs à éviter.
import { useEffect, useMemo, useState } from 'react'
import { FAMILIES, GAME, STRATEGY, getSpecies, itemName, type StrategyPhase } from '../../data'
import {
  bestNetKind,
  capturesPerFight,
  captureStatus,
  captureSpotText,
  checklistKey,
  currentPhase,
  daysBetween,
  estimatedJobLevel,
  evaluateCriterion,
  formatIsoDay,
  goalProgramConfig,
  goalStatus,
  isoWeekKey,
  remainingProgram,
  resolveRuleRefs,
  sessionsPerDayFor,
  strategyHighlights,
  withGoalSimulation,
  type GoalStatus,
} from '../../domain/advisor'
import { almanaxOn, serverDay, upcomingAlmanax } from '../../domain/almanax'
import { requiredSpecies } from '../../domain/breedingPath'
import { GAUGE_LABELS, PADDOCK_UNLOCK_LEVELS } from '../../domain/constants'
import { NET_KIND_LABELS, batchProfile, crossingRanking, genetonKamasValue, type CrossingRank, type MountPriceContext } from '../../domain/economy'
import { jobAlmanaxDays } from '../../domain/job'
import { unlockedPaddocks } from '../../domain/mountFate'
import { effectiveFertility } from '../../domain/mounts'
import { OPTIMAKINA_SYSTEMATIC_GENERATION } from '../../domain/pairing'
import type { PriceContext } from '../../domain/pricing'
import { estimateProgramCost, type ProgramSummary } from '../../domain/programSim'
import type { Ruleset } from '../../domain/rules'
import type { FamilyId, FuelTier, Mount } from '../../domain/types'
import { formatDuration, formatKamas, formatKamasRange, formatNumber, formatPercent } from '../../lib/format'
import { useInventory } from '../../store/inventory'
import { journalJobXp, useJournal } from '../../store/journal'
import { usePlanProgress } from '../../store/planProgress'
import { usePriceContext, usePrices } from '../../store/prices'
import { useRules, useSettings, type Goal } from '../../store/settings'
import { Badge, Callout, Card, Empty, PageHeader, Progress, SelectField, Stat, Tabs } from '../components'
import { navigate, href, useRoute } from '../router'
import { ConfidenceBadge, SpeciesName, SpeciesPicker } from '../species'
import { useGoalSimulation, type GoalSimulationStatus } from '../useGoalSimulation'
import './PlanPage.css'

type TabId = 'chemin' | 'phase' | 'strategie' | 'routines' | 'erreurs'

const TABS: { id: TabId; label: string }[] = [
  { id: 'chemin', label: 'Chemin & calendrier' },
  { id: 'phase', label: 'Phase & checklist' },
  { id: 'strategie', label: 'Stratégie' },
  { id: 'routines', label: 'Routines & Almanax' },
  { id: 'erreurs', label: 'Erreurs à éviter' },
]

const GOAL_OPTIONS: { value: Goal; label: string }[] = [
  { value: 'profit', label: 'Kamas (rentabilité)' },
  { value: 'succes', label: 'Succès de générations' },
  { value: 'mixte', label: 'Les deux' },
]

interface PlanSettings {
  jobLevel: number
  family: FamilyId
  goalSpeciesId: number | null
  goal: Goal
  preferredTier: FuelTier
  xpFiller: boolean
  parentTargetLevel: number
  useOptimakina: boolean
  saleTax: number
  useDefaultPrices: boolean
  accounts: number
  hoursPerDay: number
}

/** Simulation Monte-Carlo de l'objectif (partagée avec l'accueil). */
interface SimState {
  summary: ProgramSummary | null
  status: GoalSimulationStatus
  progress: number
  error: string | null
}

function usePlanSettings(): PlanSettings {
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
  const accounts = useSettings((s) => s.accounts)
  const hoursPerDay = useSettings((s) => s.hoursPerDay)
  return useMemo(
    () => ({ jobLevel, family, goalSpeciesId, goal, preferredTier, xpFiller, parentTargetLevel, useOptimakina, saleTax, useDefaultPrices, accounts, hoursPerDay }),
    [jobLevel, family, goalSpeciesId, goal, preferredTier, xpFiller, parentTargetLevel, useOptimakina, saleTax, useDefaultPrices, accounts, hoursPerDay],
  )
}

/** Jour courant (se met à jour à minuit si la page reste ouverte). */
function useToday(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/** « 3 tirages », « 1 passage ». */
const nb = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${Math.abs(n) >= 2 ? many : one}`

const phaseRange = (p: StrategyPhase) =>
  p.jobLevelRange[0] === p.jobLevelRange[1] ? `niv. ${p.jobLevelRange[0]}` : `niv. ${p.jobLevelRange[0]}–${p.jobLevelRange[1]}`

export default function PlanPage() {
  const route = useRoute()
  const param = route.params.get('onglet')
  const tab: TabId = TABS.some((t) => t.id === param) ? (param as TabId) : 'chemin'
  const settings = usePlanSettings()
  const update = useSettings((s) => s.update)
  const rules = useRules()
  const mounts = useInventory((s) => s.mounts)
  const ctx = usePriceContext()
  const mountOverrides = usePrices((s) => s.mounts)
  const generationOverrides = usePrices((s) => s.generations)
  const genetonOverride = usePrices((s) => s.genetonValue)
  const mountPrices: MountPriceContext = useMemo(
    () => ({ mountOverrides, generationOverrides, useDefaults: settings.useDefaultPrices }),
    [mountOverrides, generationOverrides, settings.useDefaultPrices],
  )
  const genetonValue = genetonKamasValue(genetonOverride).value
  const now = useToday()
  // XP du journal depuis la dernière saisie du niveau : niveau estimé (plancher) pour la phase.
  const jobLevelUpdatedAt = useSettings((s) => s.jobLevelUpdatedAt)
  const journal = useJournal((s) => s.entries)
  const xpGained = useMemo(() => journalJobXp(journal, jobLevelUpdatedAt).xp, [journal, jobLevelUpdatedAt])
  const jobLevel = estimatedJobLevel(settings.jobLevel, xpGained)
  const phase = currentPhase(jobLevel, mounts)
  const unlocked = unlockedPaddocks(settings.jobLevel)
  const base = useMemo(() => {
    if (settings.goalSpeciesId === null) return { goal: null, error: null }
    try {
      return { goal: goalStatus(settings.goalSpeciesId, mounts, { parentLevel: settings.parentTargetLevel, useOptimakina: settings.useOptimakina, rules }), error: null }
    } catch (e) {
      return { goal: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [settings.goalSpeciesId, settings.parentTargetLevel, settings.useOptimakina, mounts, rules])
  // Simulation Monte-Carlo de la stratégie (partagée avec l'accueil) : chiffres de référence et captures calibrées.
  const simConfig = useMemo(() => (base.goal?.tree ? goalProgramConfig(settings, rules) : null), [base.goal, settings, rules])
  const sim = useGoalSimulation(simConfig)
  const goal = useMemo(() => withGoalSimulation(base.goal, mounts, sim.summary, rules), [base.goal, mounts, sim.summary, rules])

  return (
    <div className="pl-page">
      <PageHeader
        title="Plan d'élevage"
        subtitle="Votre objectif, la phase en cours, le chemin à suivre, la durée estimée et les routines qui vous y mènent le plus vite."
        actions={
          <a className="btn small primary" href={href('accueil')}>
            Que faire maintenant ?
          </a>
        }
      />
      {base.error && (
        <Callout tone="warn">
          <strong>Section indisponible : objectif et captures.</strong> Le calcul a échoué ({base.error}) ; les autres onglets restent valables. Vérifiez vos montures et vos
          réglages, ou téléchargez une sauvegarde depuis les <a href={href('reglages')}>réglages</a> pour signaler le problème.
        </Callout>
      )}
      <div className="grid grid-2 pl-top">
        <GoalCard settings={settings} update={update} goal={goal} mounts={mounts} />
        <PhaseCard phase={phase} jobLevel={jobLevel} savedLevel={settings.jobLevel} mounts={mounts} />
      </div>
      <Tabs<TabId> tabs={TABS} value={tab} onChange={(t) => navigate('plan', { onglet: t })} />
      {tab === 'chemin' &&
        (goal ? (
          <PathTab goal={goal} settings={settings} rules={rules} mounts={mounts} ctx={ctx} unlocked={unlocked} genetonValue={genetonValue} now={now} sim={sim} />
        ) : (
          <ProfitTab
            settings={settings}
            rules={rules}
            ctx={ctx}
            mountPrices={mountPrices}
            genetonValue={genetonValue}
            mounts={mounts}
            onPick={(id) => update({ goalSpeciesId: id })}
          />
        ))}
      {tab === 'phase' && <PhaseTab phase={phase} jobLevel={jobLevel} mounts={mounts} />}
      {tab === 'strategie' && <StrategyTab settings={settings} rules={rules} unlocked={unlocked} estimatedLevel={jobLevel} />}
      {tab === 'routines' && <RoutinesTab now={now} settings={settings} />}
      {tab === 'erreurs' && <MistakesTab />}
    </div>
  )
}

// ---------- Objectif ----------

function GoalCard({
  settings,
  update,
  goal,
  mounts,
}: {
  settings: PlanSettings
  update: (patch: Partial<PlanSettings>) => void
  goal: GoalStatus | null
  mounts: Mount[]
}) {
  const [localMode, setMode] = useState<'monture' | 'rentabilite'>(settings.goalSpeciesId !== null || settings.goal !== 'profit' ? 'monture' : 'rentabilite')
  // Une monture visée (choisie ici ou via « Viser ») impose le mode « monture précise ».
  const mode = settings.goalSpeciesId !== null ? 'monture' : localMode
  const choose = (m: 'monture' | 'rentabilite') => {
    setMode(m)
    if (m === 'rentabilite') update({ goalSpeciesId: null, goal: 'profit' })
  }
  const owned = goal ? mounts.filter((m) => m.speciesId === goal.speciesId) : []
  return (
    <Card title="Objectif">
      <div className="pl-modes" role="radiogroup" aria-label="Type d'objectif">
        <label className={`pl-mode${mode === 'monture' ? ' active' : ''}`}>
          <input type="radio" name="pl-mode" checked={mode === 'monture'} onChange={() => choose('monture')} />
          <span>
            <strong>Une monture précise</strong>
            <small>succès d'une génération, couleur à revendre</small>
          </span>
        </label>
        <label className={`pl-mode${mode === 'rentabilite' ? ' active' : ''}`}>
          <input type="radio" name="pl-mode" checked={mode === 'rentabilite'} onChange={() => choose('rentabilite')} />
          <span>
            <strong>Rentabilité maximale</strong>
            <small>les croisements qui rapportent le plus</small>
          </span>
        </label>
      </div>
      {mode === 'monture' ? (
        <SpeciesPicker
          label="Monture visée"
          value={settings.goalSpeciesId}
          family={settings.family}
          onFamilyChange={(f) => update({ family: f })}
          onChange={(id) => {
            const sp = id !== null ? getSpecies(id) : undefined
            update(sp ? { goalSpeciesId: id, family: sp.family } : { goalSpeciesId: null })
          }}
        />
      ) : (
        <p className="muted">
          Aucune monture imposée : l'onglet « Chemin » classe les croisements des {FAMILIES[settings.family]?.plural ?? settings.family} par marge attendue avec vos prix.
          Changez la famille dans les <a href={href('reglages')}>réglages</a>.
        </p>
      )}
      <div className="row pl-goal-row">
        <SelectField<Goal> label="Priorité" value={settings.goal} onChange={(g) => update({ goal: g })} options={GOAL_OPTIONS} />
        {goal && (
          <div className="pl-goal-summary">
            <SpeciesName id={goal.speciesId} />
            {goal.reached ? (
              <Badge tone="ok">atteint ({owned.length})</Badge>
            ) : goal.captureBasis === 'simulation' ? (
              <Badge
                tone="info"
                title="Estimation : simulation Monte-Carlo de votre stratégie, ramenée à ce que vos montures couvrent déjà (une tentative peut rater, il en faut alors d'autres)"
              >
                ≈ {formatNumber(goal.capturesRemaining)} captures restantes
              </Badge>
            ) : (
              <Badge tone="warn" title="Borne haute du modèle analytique (bébés hors cible jamais réutilisés), en attendant la simulation">
                jusqu’à ≈ {formatNumber(goal.capturesRemaining)} captures restantes
              </Badge>
            )}
            <a href={href('genetique', { id: goal.speciesId })}>Arbre génétique →</a>
          </div>
        )}
      </div>
    </Card>
  )
}

// ---------- Phase ----------

function PhaseCard({ phase, jobLevel, savedLevel, mounts }: { phase: StrategyPhase; jobLevel: number; savedLevel: number; mounts: Mount[] }) {
  const checked = usePlanProgress((s) => s.checked)
  const idx = STRATEGY.phases.findIndex((p) => p.id === phase.id)
  const criteria = phase.exitCriteria.map((c, i) => {
    const auto = evaluateCriterion(c, { jobLevel, mounts })
    return auto ?? checked[checklistKey('phase', phase.id, 'exit', i)] !== undefined
  })
  const met = criteria.filter(Boolean).length
  return (
    <Card title="Phase en cours" actions={<a href={href('plan', { onglet: 'phase' })}>Checklist →</a>}>
      <ol className="pl-stepper" aria-label="Phases du plan">
        {STRATEGY.phases.map((p, i) => (
          <li key={p.id} className={i === idx ? 'current' : i < idx ? 'past' : undefined} title={`${p.id} — ${p.title} (${phaseRange(p)})`}>
            <span>{p.id}</span>
          </li>
        ))}
      </ol>
      <h3 className="pl-phase-title">
        {phase.id} — {phase.title}
      </h3>
      <p className="muted pl-phase-meta">
        Éleveur {phaseRange(phase)} · vous : niveau {jobLevel}
        {jobLevel > savedLevel ? ` (estimé d'après le journal ; saisi : ${savedLevel})` : ''} · {phase.paddocks ?? 1} enclos conseillé{(phase.paddocks ?? 1) > 1 ? 's' : ''}
      </p>
      <div className="pl-exit">
        <span>
          Critères de sortie : <strong>{met}</strong> / {criteria.length}
        </span>
        <Progress value={met} max={Math.max(1, criteria.length)} />
      </div>
      <ul className="pl-goal-list">
        {phase.goals.map((g) => (
          <li key={g}>{g}</li>
        ))}
      </ul>
    </Card>
  )
}

function Checklist({ scope, items, auto }: { scope: string; items: string[]; auto?: (text: string) => boolean | null }) {
  const checked = usePlanProgress((s) => s.checked)
  const toggle = usePlanProgress((s) => s.toggle)
  return (
    <ul className="pl-checklist">
      {items.map((text, i) => {
        const key = `${scope}:${i}`
        const detected = auto?.(text) ?? null
        const isChecked = detected === true || checked[key] !== undefined
        return (
          <li key={key} className={isChecked ? 'done' : undefined}>
            <label>
              <input type="checkbox" checked={isChecked} disabled={detected === true} onChange={() => toggle(key)} />
              <span>{text}</span>
            </label>
            {detected === true && <Badge tone="ok">détecté</Badge>}
            {detected === false && (
              <Badge tone="warn" title="Vérifié automatiquement d'après vos réglages et vos montures">
                pas encore
              </Badge>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function PhaseTab({ phase, jobLevel, mounts }: { phase: StrategyPhase; jobLevel: number; mounts: Mount[] }) {
  const clearPrefix = usePlanProgress((s) => s.clearPrefix)
  const auto = (t: string) => evaluateCriterion(t, { jobLevel, mounts })
  return (
    <>
      <Card
        title={`${phase.id} — ${phase.title}`}
        actions={
          <button className="btn small ghost" onClick={() => clearPrefix(`phase:${phase.id}:`)}>
            Tout décocher
          </button>
        }
      >
        <p className="muted">
          Éleveur {phaseRange(phase)}. Cochez au fur et à mesure : l'avancement est enregistré dans ce navigateur. Les critères vérifiables (niveau d'Éleveur, générations
          possédées) se cochent tout seuls.
        </p>
        <div className="grid grid-3 pl-phase-grid">
          <div>
            <h3>Objectifs</h3>
            <Checklist scope={checklistKey('phase', phase.id, 'goals')} items={phase.goals} />
          </div>
          <div>
            <h3>Actions</h3>
            <Checklist scope={checklistKey('phase', phase.id, 'actions')} items={phase.actions.map(resolveRuleRefs)} />
          </div>
          <div>
            <h3>Pour passer à la suite</h3>
            <Checklist scope={checklistKey('phase', phase.id, 'exit')} items={phase.exitCriteria} auto={auto} />
          </div>
        </div>
      </Card>
      <Card title="Toutes les phases">
        <div className="pl-phases">
          {STRATEGY.phases.map((p) => (
            <details key={p.id} open={p.id === phase.id} className={p.id === phase.id ? 'current' : undefined}>
              <summary>
                <strong>
                  {p.id} — {p.title}
                </strong>{' '}
                <span className="muted">({phaseRange(p)})</span> {p.id === phase.id && <Badge tone="accent">en cours</Badge>}
              </summary>
              <div className="pl-phase-body">
                <p>
                  <strong>Objectifs :</strong> {p.goals.join(' ; ')}.
                </p>
                <p>
                  <strong>Sortie de phase :</strong> {p.exitCriteria.join(' ; ')}.
                </p>
              </div>
            </details>
          ))}
        </div>
        <p className="muted pl-note">
          Objectif minimal du métier : niveau 120 (4 enclos). Source : recherche « stratégie » (phases du planificateur, confiance moyenne).
        </p>
      </Card>
    </>
  )
}

// ---------- Chemin vers l'objectif ----------

function PathTab({
  goal,
  settings,
  rules,
  mounts,
  ctx,
  unlocked,
  genetonValue,
  now,
  sim,
}: {
  goal: GoalStatus
  settings: PlanSettings
  rules: Ruleset
  mounts: Mount[]
  ctx: PriceContext
  unlocked: number
  genetonValue: number
  now: number
  sim: SimState
}) {
  const effort = goal.effort
  const required = goal.tree ? requiredSpecies(goal.tree) : []
  const nodes = new Map((effort?.nodes ?? []).map((n) => [n.speciesId, n]))
  const owned = new Map<number, { usable: number; all: number }>()
  for (const m of mounts) {
    const e = owned.get(m.speciesId) ?? { usable: 0, all: 0 }
    e.all++
    const f = effectiveFertility(m)
    if (f === 'fertile' || f === 'feconde') e.usable++
    owned.set(m.speciesId, e)
  }
  const cap = goal.captures
  const checked = usePlanProgress((s) => s.checked)
  const toggle = usePlanProgress((s) => s.toggle)
  const summary = sim.summary && sim.summary.config.targetSpeciesId === goal.speciesId ? sim.summary : null
  const simulated = goal.captureBasis === 'simulation'
  const remaining = goal.remaining
  const m = summary?.metrics
  return (
    <>
      {goal.reached && (
        <Callout tone="ok">
          <strong>Objectif atteint :</strong> vous possédez {goal.owned} × {goal.name}. Choisissez la prochaine monture visée ci-dessus, ou passez en « rentabilité maximale ».
        </Callout>
      )}
      {goal.error && <Callout tone="warn">{goal.error}</Callout>}
      {effort && (
        <Card title={`Effort attendu pour 1 ${goal.name}`} actions={<ConfidenceBadge level={summary ? 'medium' : 'low'} />}>
          <div className="table-wrap">
            <table className="table pl-effort">
              <thead>
                <tr>
                  <th />
                  <th className="num">Simulation (retenue)</th>
                  <th className="num">Modèle analytique (référence)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Captures G1</th>
                  <td className="num">
                    <strong>{m ? `≈ ${formatNumber(m.captures.mean)}` : sim.status === 'error' ? '—' : '…'}</strong>
                  </td>
                  <td className="num">
                    ≈ {formatNumber(effort.captures)} <span className="muted">(borne haute)</span>
                  </td>
                </tr>
                {!goal.reached && (
                  <tr>
                    <th scope="row">dont encore à faire avec vos montures</th>
                    <td className="num">{simulated ? <strong>≈ {formatNumber(goal.capturesRemaining)}</strong> : '…'}</td>
                    <td className="num">≈ {formatNumber(remaining?.captures ?? effort.captures)}</td>
                  </tr>
                )}
                <tr>
                  <th scope="row">Accouplements</th>
                  <td className="num">{m ? `≈ ${formatNumber(m.matings.mean)}` : '…'}</td>
                  <td className="num">
                    ≈ {formatNumber(effort.matings)} <span className="muted">(idéal : {formatNumber(effort.ideal.matings)})</span>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Fécondations</th>
                  <td className="num">{m ? `≈ ${formatNumber(m.fecundations.mean)}` : '…'}</td>
                  <td className="num">≈ {formatNumber(effort.fecundations)}</td>
                </tr>
                <tr>
                  <th scope="row">Clonages</th>
                  <td className="num">{m ? `≈ ${formatNumber(m.clones.mean)}` : '…'}</td>
                  <td className="num">≈ {formatNumber(effort.clonings)}</td>
                </tr>
                <tr>
                  <th scope="row">Optimakinas {settings.useOptimakina ? `(dès la G${OPTIMAKINA_SYSTEMATIC_GENERATION})` : '(désactivées)'}</th>
                  <td className="num">{m ? `≈ ${formatNumber(m.optimakinas.mean)}` : '…'}</td>
                  <td className="num">≈ {formatNumber(effort.optimakinas)}</td>
                </tr>
                <tr>
                  <th scope="row">Génétons en route</th>
                  <td className="num">{m ? `≈ ${formatNumber(m.genetons.mean)}` : '…'}</td>
                  <td className="num">
                    ≈ {formatNumber(effort.genetons)} <span className="muted">(≈ {formatKamas(effort.genetons * genetonValue, true)})</span>
                  </td>
                </tr>
                <tr>
                  <th scope="row">XP d'Éleveur</th>
                  <td className="num">{m ? `≈ ${formatNumber(m.jobXp.mean)}` : '…'}</td>
                  <td className="num">≈ {formatNumber(effort.jobXp.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {sim.status === 'running' && !summary && (
            <div className="pl-sim-progress">
              <span className="muted">Simulation en cours… {formatPercent(sim.progress, 0)}</span>
              <Progress value={sim.progress} max={1} />
            </div>
          )}
          {sim.error && <Callout tone="danger">Simulation impossible : {sim.error}. Les captures affichées sont alors la borne haute du modèle analytique.</Callout>}
          <p className="muted pl-note">
            <strong>Pourquoi deux chiffres ?</strong> Le modèle analytique de la recherche calcule une espérance sans jamais réutiliser les bébés hors cible (≈ 58 % des
            naissances à 42 %) : c'est un <em>majorant prudent</em> des captures (recette idéale : {formatNumber(effort.ideal.captures)} captures si tout réussit). La
            simulation Monte-Carlo ({summary ? nb(summary.runs, 'tirage') : '24 tirages'}) joue le programme session par session — sexes 50/50, {unlocked} enclos de 10
            places, clonage, bébés hors cible remis en jeu : c'est le chiffre retenu pour les conseils (accueil, captures). « Encore à faire » tient compte de vos montures :
            une monture du haut de l'arbre couvre une partie de la demande attendue, pas tout son sous-arbre (une tentative peut rater).
          </p>
          <details className="pl-assumptions">
            <summary>Hypothèses du calcul</summary>
            <ul>
              {effort.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </details>
        </Card>
      )}
      {goal.tree && <TimelineCard goal={goal} settings={settings} rules={rules} unlocked={unlocked} ctx={ctx} genetonValue={genetonValue} now={now} sim={sim} />}
      {required.length > 0 && (
        <Card title="Étapes de la recette (de la cible aux captures)" actions={<a href={href('genetique', { id: goal.speciesId })}>Arbre complet →</a>}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Obtenue</th>
                  <th>Monture</th>
                  <th>Croisement</th>
                  <th className="num">Dans la recette</th>
                  <th className="num">Possédées</th>
                  <th className="num">Chance</th>
                  <th className="num">Accouplements attendus</th>
                </tr>
              </thead>
              <tbody>
                {required.map((r) => {
                  const n = nodes.get(r.speciesId)
                  const o = owned.get(r.speciesId)
                  const key = checklistKey('objectif', goal.speciesId, r.speciesId)
                  const auto = (o?.all ?? 0) > 0
                  return (
                    <tr key={r.speciesId} className={auto || checked[key] !== undefined ? 'pl-row-done' : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          checked={auto || checked[key] !== undefined}
                          disabled={auto}
                          onChange={() => toggle(key)}
                          aria-label={`${getSpecies(r.speciesId)?.name ?? r.speciesId} obtenue`}
                          title={auto ? 'Détecté : vous en possédez' : 'Cochez quand cette étape est franchie'}
                        />
                      </td>
                      <td>
                        <SpeciesName id={r.speciesId} />
                      </td>
                      <td>
                        {r.crossing ? (
                          <a href={href('accouplement', { a: r.crossing[0], b: r.crossing[1] })} title="Simuler ce croisement">
                            {getSpecies(r.crossing[0])?.name} × {getSpecies(r.crossing[1])?.name}
                          </a>
                        ) : (
                          <span className="muted">capture</span>
                        )}
                      </td>
                      <td className="num">{r.count}</td>
                      <td className="num">{o ? `${o.usable}${o.all > o.usable ? ` (+${o.all - o.usable} stér.)` : ''}` : 0}</td>
                      <td className="num">{n && r.crossing ? formatPercent(n.chance, 0) : '—'}</td>
                      <td className="num">
                        {n && r.crossing ? `≈ ${formatNumber(n.matings, 1)}` : '—'}
                        {n?.optimakina && (
                          <Badge tone="info" title="Optimakina utilisée pour ce croisement">
                            Opti
                          </Badge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted pl-note">
            Chance = probabilité du bébé visé avec des parents « propres » au niveau {settings.parentTargetLevel} (modèle de naissance validé en jeu). Accouplements
            attendus = besoin ÷ chance, clonage compris (modèle analytique, depuis zéro). « Obtenue » se coche toute seule quand vous possédez l'espèce ; sinon cochez-la à
            la main (enregistré pour cet objectif).
          </p>
        </Card>
      )}
      {cap.length > 0 && (
        <Card title="Captures par couleur" actions={<a className="btn small" href={href('montures', { captures: 1 })}>Saisir des captures</a>}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Couleur G1</th>
                  <th className="num">Recette idéale</th>
                  <th className="num">Non couvert (si tout réussit)</th>
                  <th className="num">{simulated ? 'Captures attendues (simulation)' : 'Captures attendues (borne haute)'}</th>
                  <th className="num">À capturer ♂ / ♀</th>
                  <th className="num">Possédées ♂ / ♀</th>
                </tr>
              </thead>
              <tbody>
                {cap.map((c) => (
                  <tr key={c.speciesId}>
                    <td>
                      <SpeciesName id={c.speciesId} withGen={false} />
                    </td>
                    <td className="num">{c.idealTotal}</td>
                    <td className="num">{c.idealRemaining}</td>
                    <td className="num">
                      <strong>{c.expected}</strong>
                    </td>
                    <td className="num">
                      {c.males} / {c.females}
                    </td>
                    <td className="num">
                      {c.ownedMales} / {c.ownedFemales}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(goal.supply?.notes.length ?? 0) > 0 && (
            <ul className="pl-supply-notes">
              {goal.supply?.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <CaptureWhere family={goal.family} jobLevel={settings.jobLevel} ctx={ctx} accounts={settings.accounts} total={goal.capturesRemaining} />
          <p className="muted pl-note">
            « Non couvert » : G1 de la recette idéale qu'aucune de vos montures fertiles ou fécondes ne remplace encore, si chaque accouplement réussissait (porteuses et
            sexes compris : deux mâles des deux couleurs d'un même croisement ne comptent qu'une fois). Captures attendues : effort restant avec vos montures (une
            tentative peut rater), {simulated ? 'calibré par la simulation Monte-Carlo' : 'modèle analytique (borne haute, en attendant la simulation)'}, arrondi pour que
            le total ne dépasse pas la somme. Répartition ♂ / ♀ pour équilibrer les sexes de chaque couleur.
          </p>
        </Card>
      )}
    </>
  )
}

function CaptureWhere({ family, jobLevel, ctx, accounts, total }: { family: FamilyId; jobLevel: number; ctx: PriceContext; accounts: number; total: number }) {
  const st = captureStatus(family, jobLevel, ctx)
  const c = st.cost
  const next = jobLevel < 100 ? 'filet multiplicateur au niveau 100' : jobLevel < 150 ? 'filet renforcé au niveau 150' : jobLevel < 200 ? 'multiplicateur renforcé au niveau 200' : ''
  const perFight = capturesPerFight(accounts, c.mountsPerCast)
  return (
    <p className="pl-where">
      <strong>Où :</strong> {st.spot ? captureSpotText(st.spot) : '—'}.{' '}
      <strong>Filet :</strong> {c.net?.name ?? NET_KIND_LABELS[st.netKind]} ({formatNumber(c.mountsPerCast)} par lancer
      {c.perMount !== null ? `, ${c.complete ? '' : '≥ '}${formatKamas(c.perMount)} par monture` : ''})
      {!c.complete && (
        <>
          {' '}
          <a className="badge warn" href={c.missing.length ? href('prix', { q: itemName(c.missing[0]) }) : href('prix', { onglet: 'filets' })}>
            coût incomplet
          </a>
        </>
      )}
      {next ? ` ; ${next}` : ''}. <strong>Combats :</strong> {nb(perFight, 'capture')} par combat ({nb(Math.max(1, Math.round(accounts)), 'personnage')})
      {total > 0 ? `, soit ≈ ${nb(Math.ceil(total / perFight), 'combat')} pour les captures restantes` : ''}. 30 XP d'Éleveur par capture.
    </p>
  )
}

function TimelineCard({
  goal,
  settings,
  rules,
  unlocked,
  ctx,
  genetonValue,
  now,
  sim,
}: {
  goal: GoalStatus
  settings: PlanSettings
  rules: Ruleset
  unlocked: number
  ctx: PriceContext
  genetonValue: number
  now: number
  sim: SimState
}) {
  const summary = sim.summary && sim.summary.config.targetSpeciesId === goal.speciesId ? sim.summary : null
  const cost = useMemo(
    () => (summary ? estimateProgramCost(summary, { ctx, rules, tier: settings.preferredTier, jobLevel: settings.jobLevel, netKind: bestNetKind(settings.jobLevel), genetonValue }) : null),
    [summary, ctx, rules, settings.preferredTier, settings.jobLevel, genetonValue],
  )
  const rest = summary ? remainingProgram(goal, summary) : null
  const days = rest?.days ?? null
  const full = summary?.metrics.days
  const sessions = summary?.config.sessionsPerDay ?? sessionsPerDayFor(settings.hoursPerDay)
  const etaReal = days ? [now + days.mean * 1.5 * 86_400_000, now + days.mean * 2 * 86_400_000] : null
  const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  const share = rest?.share ?? 1
  const restCost = cost && cost.total !== null ? cost.total * share : null
  return (
    <Card
      title="Calendrier estimé (depuis votre étable)"
      actions={
        <span className="row">
          <ConfidenceBadge level="low" />
          <a href={href('optimiseur')}>Comparer les stratégies →</a>
        </span>
      }
    >
      <p className="muted">
        Simulation rapide ({summary?.runs ?? 24} tirages) de votre stratégie : {unlocked} enclos de 10 places, parents au niveau {settings.parentTargetLevel},{' '}
        {settings.useOptimakina ? `Optimakina dès la G${OPTIMAKINA_SYSTEMATIC_GENERATION}` : 'sans makina'}, clonage systématique, palier {settings.preferredTier},{' '}
        {nb(sessions, 'passage')} aux enclos par jour (temps de jeu : {formatNumber(settings.hoursPerDay, 1)} h, réglages). La simulation part de zéro ; la durée restante
        est ramenée à la part du programme qui reste avec vos montures (≈ {formatPercent(share, 0)}, modèle analytique) — estimation.
      </p>
      {sim.error && <Callout tone="danger">Simulation impossible : {sim.error}</Callout>}
      {!summary && !sim.error && (
        <div className="pl-sim-progress">
          <span className="muted">Simulation en cours… {formatPercent(sim.progress, 0)}</span>
          <Progress value={sim.progress} max={1} />
        </div>
      )}
      {summary && days && full && (
        <>
          <div className="grid grid-4 pl-stats">
            <Stat
              label="Reste (jeu optimal)"
              value={goal.reached ? 'atteint' : `≈ ${formatNumber(days.mean, days.mean < 10 ? 1 : 0)} j`}
              hint={`de ${formatNumber(days.p10, 0)} à ${formatNumber(days.p90, 0)} j (p10–p90) · depuis zéro : ≈ ${formatNumber(full.mean, 0)} j`}
            />
            <Stat
              label="Joueur réel (× 1,5 à 2)"
              value={goal.reached ? '—' : `${formatNumber(days.mean * 1.5, 0)}–${formatNumber(days.mean * 2, 0)} j`}
              hint={etaReal && !goal.reached ? `vers le ${dateFmt.format(etaReal[0])} – ${dateFmt.format(etaReal[1])}` : undefined}
            />
            <Stat
              label="Captures restantes"
              value={`≈ ${formatNumber(goal.capturesRemaining)}`}
              hint={`accouplements restants ≈ ${formatNumber(rest?.matings ?? 0)} · depuis zéro : ${formatNumber(summary.metrics.captures.mean)} captures`}
            />
            <Stat
              label="Coût matériel restant"
              value={restCost !== null ? `${cost?.complete ? '≈ ' : '≥ '}${formatKamas(restCost, true)}` : '—'}
              hint={
                cost && !cost.complete ? (
                  <a className="badge warn" href={cost.missing.length ? href('prix', { q: itemName(cost.missing[0]) }) : href('prix')}>
                    coût incomplet
                  </a>
                ) : cost && cost.total !== null ? (
                  `programme complet : ${formatKamas(cost.total, true)} (carburants, Optimakinas, filets)`
                ) : (
                  'carburants, Optimakinas, filets'
                )
              }
            />
          </div>
          {!goal.reached && etaReal && (
            <p className="pl-note">En jeu optimal, l'objectif serait atteint vers le {dateFmt.format(now + days.mean * 86_400_000)} (estimation depuis votre étable).</p>
          )}
          {summary.successRate < 1 && (
            <Callout tone="warn">
              {formatPercent(1 - summary.successRate, 0)} des tirages n'atteignent pas l'objectif en {summary.config.maxDays} jours : plus d'enclos (niveau d'Éleveur),
              l'Optimakina ou une cible intermédiaire raccourcissent beaucoup le programme.
            </Callout>
          )}
          <p className="muted pl-note">
            Le simulateur suppose un joueur parfait ({nb(sessions, 'passage')} par jour sans retard, sexes 50/50, pas d'achats) et des lots idéaux (fécondité ≈{' '}
            {formatDuration(batchProfile('ideal', settings.preferredTier, rules).seconds)} au palier {settings.preferredTier} ; un lot typique du planificateur d'enclos ≈{' '}
            {formatDuration(batchProfile('typique', settings.preferredTier, rules).seconds)}) : durées et carburant sont des minimums. Carburant consommé (programme
            complet) ≈ {formatNumber(summary.metrics.totalFuelPoints.mean / 1e6, 1)} M de points ; génétons gagnés ≈ {formatNumber(summary.metrics.genetons.mean)}.
          </p>
        </>
      )}
    </Card>
  )
}

// ---------- Rentabilité maximale ----------

function ProfitTab({
  settings,
  rules,
  ctx,
  mountPrices,
  genetonValue,
  mounts,
  onPick,
}: {
  settings: PlanSettings
  rules: Ruleset
  ctx: PriceContext
  mountPrices: MountPriceContext
  genetonValue: number
  mounts: Mount[]
  onPick: (speciesId: number) => void
}) {
  const ranking: CrossingRank[] = useMemo(
    () =>
      crossingRanking(settings.family, {
        tier: settings.preferredTier,
        batchSize: 10,
        parentLevel: settings.parentTargetLevel,
        optimakina: settings.useOptimakina,
        saleTax: settings.saleTax,
        ctx,
        mountPrices,
        rules,
        jobLevel: settings.jobLevel,
        genetonValue,
      }),
    [settings.family, settings.preferredTier, settings.parentTargetLevel, settings.useOptimakina, settings.saleTax, settings.jobLevel, ctx, mountPrices, rules, genetonValue],
  )
  const usable = new Set(
    mounts
      .filter((m) => {
        const f = effectiveFertility(m)
        return f === 'fertile' || f === 'feconde'
      })
      .map((m) => m.speciesId),
  )
  const mine = ranking.filter((r) => usable.has(r.parentA) && usable.has(r.parentB)).slice(0, 8)
  const top = ranking.slice(0, 12)
  const breakRule = STRATEGY.captureRules.find((r) => r.id === 'C-BREAK-01')
  return (
    <>
      <Card title="Avec vos montures" actions={<ConfidenceBadge level="low" />}>
        {mine.length === 0 ? (
          <Empty>
            Aucun croisement possible avec vos montures fertiles de cette famille.{' '}
            <a href={href('montures', { captures: 1 })}>Enregistrez vos captures</a> : chaque paire de couleurs G1 donne déjà un croisement G2.
          </Empty>
        ) : (
          <RankingTable rows={mine} onPick={onPick} />
        )}
        <p className="muted pl-note">Croisements dont vous possédez les deux couleurs (fertiles ou fécondes) ; vérifiez les sexes dans la page Accouplement.</p>
      </Card>
      <Card
        title={`Meilleures marges de la famille — ${FAMILIES[settings.family]?.plural ?? settings.family}`}
        actions={
          <span className="row">
            <ConfidenceBadge level="low" />
            <a href={href('rentabilite')}>Rentabilité détaillée →</a>
          </span>
        }
      >
        <p className="muted">
          Marge attendue par accouplement = bébés + génétons + valeur ajoutée aux parents (leurs stériles, meilleure sortie, moins leur valeur actuelle) − fécondation −
          XP des parents (niveau {settings.parentTargetLevel}) − {settings.useOptimakina ? 'Optimakina (règle de prix C_eff × Δ / p, sinon dès la G6)' : 'makina'}. Une
          marge incomplète est un intervalle (« ≤ », « ≥ ») ou « inconnue » : saisissez vos prix pour fiabiliser le classement.
        </p>
        {top.length === 0 ? <Empty>Aucun croisement à classer.</Empty> : <RankingTable rows={top} onPick={onPick} />}
      </Card>
      {breakRule && (
        <Card title="Revenus sans élevage poussé">
          <p>
            <strong>{breakRule.title} :</strong> {breakRule.then}
          </p>
          {breakRule.rationale && <p className="muted">{breakRule.rationale}</p>}
        </Card>
      )}
    </>
  )
}

function RankingTable({ rows, onPick }: { rows: CrossingRank[]; onPick: (speciesId: number) => void }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Croisement</th>
            <th>Bébé visé</th>
            <th className="num">Chance</th>
            <th className="num">Marge / accouplement</th>
            <th className="num">Génétons</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                <a href={href('accouplement', { a: r.parentA, b: r.parentB })}>
                  {getSpecies(r.parentA)?.name} × {getSpecies(r.parentB)?.name}
                </a>
              </td>
              <td>
                <SpeciesName id={r.child} />
              </td>
              <td className="num">{formatPercent(r.targetChance, 0)}</td>
              <td
                className={`num ${r.complete ? (r.margin >= 0 ? 'pl-pos' : 'pl-neg') : r.marginRange.high !== null && r.marginRange.high < 0 ? 'pl-neg' : r.marginRange.low !== null && r.marginRange.low >= 0 ? 'pl-pos' : ''}`}
              >
                {r.complete ? (
                  formatKamas(r.margin, true)
                ) : r.marginRange.low === null && r.marginRange.high === null ? (
                  <>
                    <span className="muted">inconnue</span>{' '}
                    <small className="muted" title="Montants connus seulement (ni un minimum ni un maximum) : sert seulement à trier.">
                      (partie connue {formatKamas(r.margin, true)})
                    </small>
                  </>
                ) : (
                  formatKamasRange(r.marginRange, true)
                )}
                {!r.complete && (
                  <a className="badge warn" href={r.missingItems.length ? href('prix', { q: itemName(r.missingItems[0]) }) : href('prix', { onglet: 'montures' })}>
                    incomplet
                  </a>
                )}
              </td>
              <td className="num">{formatNumber(r.expectedGenetons, 1)}</td>
              <td>
                <button className="btn small ghost" onClick={() => onPick(r.child)} title="En faire la monture visée du plan">
                  Viser
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Stratégie ----------

function StrategyTab({ settings, rules, unlocked, estimatedLevel }: { settings: PlanSettings; rules: Ruleset; unlocked: number; estimatedLevel: number }) {
  const highlights = strategyHighlights(settings, rules)
  const formulas: [string, string][] = [
    ['Chance de génération cible', STRATEGY.formulas.targetChance],
    ['Optimakina rentable si', STRATEGY.formulas.optimakinaWorthIt],
    ['Monter les deux parents de ΔL si', STRATEGY.formulas.levelWorthIt],
    ["Coût attendu d'un bébé de la génération cible", STRATEGY.formulas.expectedCostPerTargetBaby],
    ["Valeur d'une stérile", STRATEGY.formulas.sterileValue],
  ].filter((f): f is [string, string] => typeof f[1] === 'string')
  return (
    <>
      <div className="grid grid-2 pl-highlights">
        {highlights.map((h) => (
          <Card key={h.id} title={<h3>{h.title}</h3>} actions={<ConfidenceBadge level={h.confidence} />}>
            <p>{h.text}</p>
            <p className="muted pl-why">Pourquoi : {h.why}</p>
          </Card>
        ))}
      </div>
      <Card title="Vos réglages appliqués" actions={<a href={href('reglages')}>Modifier →</a>}>
        <ul className="pl-settings">
          <li>
            Règles du jeu : <strong>{rules.label}</strong>
          </li>
          <li>
            Niveau d'Éleveur {settings.jobLevel} : <strong>{unlocked}</strong> enclos ({unlocked < PADDOCK_UNLOCK_LEVELS.length ? `prochain au niveau ${PADDOCK_UNLOCK_LEVELS[unlocked].level}` : 'tous débloqués'})
            {estimatedLevel > settings.jobLevel && (
              <>
                {' '}
                — <strong>≈ niveau {estimatedLevel}</strong> d'après l'XP du journal depuis votre dernière saisie (estimation : <a href={href('reglages')}>mettez à jour le niveau</a>)
              </>
            )}
          </li>
          <li>
            Parents visés : niveau <strong>{settings.parentTargetLevel}</strong> ; Mangeoire en complément : <strong>{settings.xpFiller ? 'oui' : 'non'}</strong>
          </li>
          <li>
            Optimakina : <strong>{settings.useOptimakina ? `oui (règle de prix, dès la G${OPTIMAKINA_SYSTEMATIC_GENERATION} sans prix)` : 'non'}</strong>
          </li>
          <li>
            Palier entretenu : <strong>{settings.preferredTier}</strong> ; taxe HDV : <strong>{formatPercent(settings.saleTax, 1)}</strong>
          </li>
          <li>
            Captures : <strong>{nb(settings.accounts, 'personnage')}</strong> par combat ; temps de jeu : <strong>{formatNumber(settings.hoursPerDay, 1)} h</strong> par jour (
            {nb(sessionsPerDayFor(settings.hoursPerDay), 'passage')} aux enclos dans le calendrier)
          </li>
        </ul>
      </Card>
      <Card title="Formules de décision">
        <dl className="pl-formulas">
          {formulas.map(([label, f]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <code>{f}</code>
              </dd>
            </div>
          ))}
        </dl>
        <p className="muted pl-note">
          C_eff = coût net du couple (obtention + fécondation − valeur résiduelle) ; p = chance actuelle de génération cible ; Δ = bonus de l'Optimakina (+
          {formatPercent(rules.optimakinaBonus, 0)} en {rules.id}).
        </p>
      </Card>
    </>
  )
}

// ---------- Routines et Almanax ----------

interface RoutineSession {
  when: string
  steps: string[]
}

function routineSessions(): RoutineSession[] {
  const raw = (STRATEGY.dailyRoutine as { twoSessions?: unknown }).twoSessions
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is RoutineSession => typeof x === 'object' && x !== null && typeof (x as RoutineSession).when === 'string' && Array.isArray((x as RoutineSession).steps))
}

function weeklyRoutine(): string[] {
  const raw = (STRATEGY.dailyRoutine as { weekly?: unknown }).weekly
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
}

interface CalendarRow {
  date: string
  name: string
  effect: string
  use: string
  kind: 'takeza' | 'jauge' | 'bebes' | 'metier' | 'capture' | 'autre'
}

const KIND_LABELS: Record<CalendarRow['kind'], string> = {
  takeza: 'Génération cible',
  jauge: 'Jauge doublée',
  bebes: 'Capacité offerte',
  metier: 'Métier',
  capture: 'Captures',
  autre: 'Autre',
}

function calendarRows(now: number, days: number): CalendarRow[] {
  const today = serverDay(now) // jour de jeu (Paris), comme upcomingAlmanax
  const rows = new Map<string, CalendarRow>()
  for (const e of upcomingAlmanax(now, days)) {
    const kind: CalendarRow['kind'] = e.takeza ? 'takeza' : e.doubledGauge ? 'jauge' : e.babyAbility ? 'bebes' : 'autre'
    const use = e.takeza
      ? 'Accouplements de plus haute génération : préparez à l’avance un maximum de couples féconds.'
      : e.doubledGauge
        ? `Programmez la phase ${GAUGE_LABELS[e.doubledGauge]} dans tous les enclos (effet exact non confirmé).`
        : e.babyAbility
          ? 'Faites ce jour-là les accouplements dont vous gardez ou vendez les bébés (capacité perdue au clonage).'
          : ''
    rows.set(`${e.date}|${e.name}`, { date: e.date, name: e.name, effect: e.effect, use, kind })
  }
  for (const d of jobAlmanaxDays(today))
    if (d.daysUntil <= days && ![...rows.values()].some((r) => r.date === d.date))
      rows.set(`${d.date}|${d.name}`, { date: d.date, name: d.name, effect: d.effect, use: d.use ?? 'Crafts de montée et de production.', kind: 'metier' })
  for (const c of GAME.almanaxCalendar) {
    if (c.date < today || daysBetween(today, c.date) > days || [...rows.values()].some((r) => r.date === c.date)) continue
    const capture = /captur/i.test(c.use ?? '') || /Territoire|marines/i.test(c.effect)
    rows.set(`${c.date}|${c.name}`, { date: c.date, name: c.name, effect: c.effect, use: c.use ?? '', kind: capture ? 'capture' : 'autre' })
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function RoutinesTab({ now, settings }: { now: number; settings: PlanSettings }) {
  const today = serverDay(now) // jour de jeu (Paris), comme upcomingAlmanax
  const week = isoWeekKey(now)
  const sessions = routineSessions()
  const weekly = weeklyRoutine()
  const rows = calendarRows(now, 90)
  const todayAlmanax = almanaxOn(today)
  return (
    <>
      <Card title="Journée type : deux sessions" actions={<Badge>remise à zéro chaque jour</Badge>}>
        <p className="muted">
          ≈ 15 à 30 minutes par session. Palier {settings.preferredTier} en journée, palier 1 la nuit ; jamais de jauge de sérénité active sans alarme.
          {todayAlmanax ? ` Aujourd'hui : ${todayAlmanax.name} — ${todayAlmanax.effect}.` : ''}
        </p>
        <div className="grid grid-3 pl-routine">
          {sessions.map((s) => (
            <div key={s.when}>
              <h3 className="pl-when">{s.when.charAt(0).toUpperCase() + s.when.slice(1)}</h3>
              <Checklist scope={checklistKey('routine', today, s.when)} items={s.steps.map((x) => x.charAt(0).toUpperCase() + x.slice(1))} />
            </div>
          ))}
        </div>
      </Card>
      <Card title="Chaque semaine" actions={<Badge>semaine {week.slice(-2)}</Badge>}>
        <Checklist scope={checklistKey('semaine', week)} items={weekly.map((x) => x.charAt(0).toUpperCase() + x.slice(1))} />
      </Card>
      <Card title="Almanax à exploiter (90 prochains jours)" actions={<a href={href('guide', { s: 'almanax' })}>Tous les bonus →</a>}>
        {rows.length === 0 ? (
          <Empty>Aucun bonus d'élevage connu dans les 90 prochains jours.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Bonus</th>
                  <th>Comment en profiter</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = daysBetween(today, r.date)
                  return (
                    <tr key={`${r.date}-${r.name}`} className={r.kind === 'takeza' ? 'pl-takeza' : undefined}>
                      <td>
                        <strong>{formatIsoDay(r.date)}</strong>
                        <br />
                        <small>{d === 0 ? "aujourd'hui" : `dans ${d} jour${d > 1 ? 's' : ''}`}</small>
                      </td>
                      <td>
                        <Badge tone={r.kind === 'takeza' ? 'gold' : r.kind === 'metier' ? 'accent' : 'info'}>{KIND_LABELS[r.kind]}</Badge> {r.name} — {r.effect}
                      </td>
                      <td>{r.use}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted pl-note">Source : calendrier Almanax de DofusDB (confiance haute) ; le jour Takeza change chaque année.</p>
      </Card>
    </>
  )
}

// ---------- Erreurs fréquentes ----------

function MistakesTab() {
  return (
    <Card title="Erreurs fréquentes à éviter">
      <div className="pl-mistakes">
        {STRATEGY.commonMistakes.map((m) => (
          <div key={m.id} className="pl-mistake">
            <strong>{m.mistake}</strong>
            <span className="pl-consequence">→ {m.consequence}</span>
            <span className="pl-fix">
              <span className="pl-fix-icon" aria-hidden>
                ✓
              </span>{' '}
              Correctif : {resolveRuleRefs(m.fix)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
