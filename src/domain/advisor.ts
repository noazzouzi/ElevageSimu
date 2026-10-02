// Pilotage : « que faire maintenant ? ». Compose les modules du domaine (plans d'enclos, jauges,
// Almanax, accouplements, sort des montures, répartition en enclos, captures, métier, prix) en une
// liste d'actions ordonnées, datées et expliquées, et fournit les briques du plan d'élevage
// (phase P0–P6, captures restantes vers l'objectif, critères de sortie détectés, repères de stratégie).
//
// Sources des règles : research/README.md §2.10, strategy.md §0 (22 règles), §1.4 (sort d'une
// monture), §4 (enclos), §5 (accouplements), §7 (routines), §8 (phases) ; STRATEGY (src/data).
// Module pur : aucun React, aucun accès au store. Les heures sont calculées à partir de `now`.
import { FAMILIES, STRATEGY, getSpecies, itemName, speciesOfFamily, type StrategyPhase } from '../data'
import { formatClock, formatDuration, formatKamas, formatNumber, formatPercent } from '../lib/format'
import { TAKEZA_DATES, almanaxOn, isoDay, upcomingAlmanax, type AlmanaxEffect } from './almanax'
import { capturesByColor, cheapestRecipe, expectedEffort, type EffortEstimate, type EffortOptions, type RecipeNode } from './breedingPath'
import { ABILITY_LABELS, FUEL_TIER_NAMES, GAUGE_LABELS, PADDOCK_SLOTS, PADDOCK_UNLOCK_LEVELS } from './constants'
import {
  NET_KIND_LABELS,
  captureCost,
  fertilityCost,
  fertilitySeconds,
  genetonKamasValue,
  levelingCost,
  makinaCost,
  mountValuation,
  type CaptureCost,
  type FertilityCost,
  type MountPriceContext,
  type MountValuation,
  type NetKind,
} from './economy'
import { fillPlan, type FillPlan } from './fuel'
import { targetChance } from './genetics'
import {
  bestCraftAt,
  jobAlmanaxDays,
  jobMilestones,
  levelingPlan,
  nextPaddockTarget,
  type CraftChoice,
  type JobAlmanaxDay,
  type JobMilestoneDef,
  type LevelingPlan,
} from './job'
import { inventorySummary, recommendFates, unlockedPaddocks, type InventorySummary, type LevelCostFn, type MountFate, type ValuationFn } from './mountFate'
import { effectiveFertility, mountName } from './mounts'
import { canBenefit, gaugeTier, simulatePaddock, validateActiveGauges, type SimEvent, type SimMount } from './paddock'
import { PADDOCK_ROLE_LABELS, assignPaddocks, gaugeSwitch, planProgress, toSimMount, type AssignResult, type PlanSchedule } from './paddockAssign'
import { OPTIMAKINA_SYSTEMATIC_GENERATION, bestDisjointPairs, objectiveFromGoal, rankPairs, type PairSuggestion } from './pairing'
import type { PriceContext } from './pricing'
import type { Ruleset } from './rules'
import type { FamilyId, FuelTier, GaugeId, Mount, PaddockState } from './types'
import { jobXpBetween, jobXpForLevel } from './xp'

// ---------- Types ----------

export type AdviceCategory = 'alarme' | 'almanax' | 'accouplement' | 'clonage' | 'enclos' | 'carburant' | 'capture' | 'vente' | 'metier' | 'prix' | 'objectif'

/** Ordre d'une session (strategy.md règle 13) : sert de départage à priorité égale. */
export const ADVICE_CATEGORIES: AdviceCategory[] = ['objectif', 'alarme', 'carburant', 'almanax', 'accouplement', 'clonage', 'enclos', 'capture', 'vente', 'metier', 'prix']

export const ADVICE_CATEGORY_LABELS: Record<AdviceCategory, string> = {
  alarme: 'Alarme',
  almanax: 'Almanax',
  accouplement: 'Accouplement',
  clonage: 'Clonage',
  enclos: 'Enclos',
  carburant: 'Carburant',
  capture: 'Capture',
  vente: 'Sortie',
  metier: 'Métier',
  prix: 'Prix',
  objectif: 'Objectif',
}

/** 1 = urgent … 5 = idée. */
export type AdvicePriority = 1 | 2 | 3 | 4 | 5

export const PRIORITY_LABELS: Record<AdvicePriority, string> = { 1: 'Urgent', 2: 'Important', 3: 'À faire', 4: 'Utile', 5: 'Idée' }

/** Lien interne : `href(page, params)`. */
export interface AdviceLink {
  page: string
  params?: Record<string, string | number>
  label: string
}

/** Ligne de checklist d'un conseil. */
export interface AdviceItem {
  /** Identifiant stable dans le conseil (pour cocher la ligne). */
  id: string
  text: string
  hint?: string
  link?: AdviceLink
  tone?: 'ok' | 'warn' | 'danger' | 'info'
  /** Déjà fait d'après l'état de l'application (case cochée d'office). */
  done?: boolean
}

/** Action directe que la page peut proposer (bouton « Fait »). */
export type AdviceAction = { kind: 'advance-plan'; paddockId: number; to: GaugeId[] }

export type AdviceHorizon = 'maintenant' | 'heures' | 'aujourdhui' | 'semaine'

export const HORIZONS: AdviceHorizon[] = ['maintenant', 'heures', 'aujourdhui', 'semaine']

export const HORIZON_LABELS: Record<AdviceHorizon, string> = {
  maintenant: 'Maintenant',
  heures: 'Dans les prochaines heures',
  aujourdhui: "Aujourd'hui",
  semaine: 'Cette semaine',
}

export interface Advice {
  /**
   * Identifiant stable tant que la situation ne change pas (il change quand le contenu change :
   * un conseil « fait » ne réapparaît que pour une nouvelle situation).
   */
  id: string
  priority: AdvicePriority
  category: AdviceCategory
  title: string
  /** Pourquoi / comment (phrases complètes, français). */
  detail: string
  /** Heure à laquelle agir (ms), si l'action est minutée. */
  dueAt?: number
  /** `dueAt` est un jour (minuit local) : afficher la date, pas l'heure (Almanax). */
  allDay?: boolean
  /** Fenêtre de changement (jauges de sérénité). */
  window?: { earliest: number; latest: number }
  /** Regroupement imposé (sinon déduit de `dueAt` et de la priorité). */
  horizon?: AdviceHorizon
  link: AdviceLink
  items?: AdviceItem[]
  /** Confiance d'une estimation ('low' = estimation grossière). Absent = calcul direct. */
  confidence?: 'high' | 'medium' | 'low'
  /** Montant associé (kamas) : coût ou valeur. `complete: false` = minimum connu, prix manquants. */
  amount?: { label: string; value: number | null; complete: boolean }
  /** Objets sans prix qui rendent un coût incomplet (lien vers la page Prix). */
  missing?: number[]
  action?: AdviceAction
}

/** Réglages utilisés (sous-ensemble structurel de `useSettings`). */
export interface AdvisorSettings {
  jobLevel: number
  family: FamilyId
  goalSpeciesId: number | null
  goal: 'profit' | 'succes' | 'mixte'
  preferredTier: FuelTier
  xpFiller: boolean
  parentTargetLevel: number
  useOptimakina: boolean
  saleTax: number
  useDefaultPrices: boolean
}

/** Plan d'enclos démarré (structure de `usePaddockPlans().plans[n]`). */
export interface AdvisorPaddockPlan extends PlanSchedule {
  paddockId: number
  tier: FuelTier
  mountIds: string[]
}

export interface AdvisorInput {
  now: number
  settings: AdvisorSettings
  rules: Ruleset
  mounts: Mount[]
  paddocks: PaddockState[]
  paddockPlans: Record<string, AdvisorPaddockPlan>
  priceCtx: PriceContext
  mountPrices: MountPriceContext
  /** Valeur d'un généton saisie (usePrices().genetonValue) ; défaut de la recherche sinon. */
  genetonValue?: number | null
  /** Nombre de prix d'objets saisis par le joueur (onboarding). */
  pricedItems?: number
}

// ---------- Utilitaires ----------

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

const plural = (n: number, one: string, many = `${one}s`) => (Math.abs(n) >= 2 ? many : one)
const nb = (n: number, one: string, many?: string) => `${formatNumber(n)} ${plural(n, one, many)}`
const longDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

/** Empreinte courte et stable d'un texte (identifiants de conseils). */
export function hashKey(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** Minuit local du jour de `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Minuit local d'une date ISO (AAAA-MM-JJ). */
export function isoToMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

/** Jours entiers entre deux dates ISO (b − a). */
export function daysBetween(a: string, b: string): number {
  const n = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return Math.round(Date.UTC(y, m - 1, d) / DAY)
  }
  return n(b) - n(a)
}

/** « lundi 12 octobre ». */
export function formatIsoDay(iso: string): string {
  return longDay.format(isoToMs(iso))
}

/** « dans 25 min », « il y a 2 h 05 ». */
export function relativeTime(at: number, now: number): string {
  const d = at - now
  const s = Math.abs(d) / 1000
  const txt = s < 60 ? "moins d'une minute" : formatDuration(s)
  return d >= 0 ? `dans ${txt}` : `il y a ${txt}`
}

/** Semaine ISO (« 2026-W40 ») d'un instant, pour les checklists hebdomadaires. */
export function isoWeekKey(ms: number): string {
  const d = new Date(ms)
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((date.getTime() - yearStart) / DAY + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

const genOf = (id: number) => getSpecies(id)?.generation ?? 0
const nameOf = (id: number) => getSpecies(id)?.name ?? `#${id}`
const isUsable = (m: Mount) => {
  const f = effectiveFertility(m)
  return f === 'fertile' || f === 'feconde'
}

/** « 3 × Muldo Doré, 2 × Muldo Indigo ». */
function speciesSummary(ms: Mount[], max = 4): string {
  const counts = new Map<number, number>()
  for (const m of ms) counts.set(m.speciesId, (counts.get(m.speciesId) ?? 0) + 1)
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1] || genOf(b[0]) - genOf(a[0])).map(([id, n]) => `${n} × ${nameOf(id)}`)
  return parts.length > max ? `${parts.slice(0, max).join(', ')}…` : parts.join(', ')
}

/** « de Foudroyeur », « d'Abreuvoir ». */
export function deName(name: string): string {
  return /^[aeiouyéèêàâîôûœh]/i.test(name) ? `d'${name}` : `de ${name}`
}

function gaugeList(gs: GaugeId[]): string {
  return gs.map((g) => GAUGE_LABELS[g]).join(' + ')
}

/** Niveaux cumulés des deux parents pour 100 % de génération cible (B = 30 % + 0,15 %/niveau + bonus). */
export function levelSumForCertainty(rules: Ruleset, opts: { optimakina: boolean; takeza: boolean }): number {
  const bonus = (opts.optimakina ? rules.optimakinaBonus : 0) + (opts.takeza ? 0.2 : 0)
  return Math.max(0, Math.ceil((1 - 0.3 - bonus) / 0.0015 - 1e-9))
}

/** Plus proche jour Takeza à partir d'aujourd'hui (inclus), avec l'écart en jours. */
export function nextTakeza(todayIso: string): { date: string; days: number } | null {
  const date = TAKEZA_DATES.find((d) => d >= todayIso)
  return date ? { date, days: daysBetween(todayIso, date) } : null
}

// ---------- Prix manquants ----------

export interface MissingPrice {
  id: number
  name: string
  /** Ce que ce prix débloque (« fécondation au palier 2 », « filets »…). */
  uses: string[]
  weight: number
}

class MissingCollector {
  private map = new Map<number, { uses: Set<string>; weight: number }>()
  add(ids: readonly number[] | undefined, use: string, weight: number) {
    for (const id of ids ?? []) {
      const e = this.map.get(id)
      if (e) {
        e.uses.add(use)
        e.weight += weight
      } else this.map.set(id, { uses: new Set([use]), weight })
    }
  }
  merge(list: MissingPrice[]) {
    for (const m of list) for (const u of m.uses) this.add([m.id], u, m.weight / Math.max(1, m.uses.length))
  }
  list(): MissingPrice[] {
    return [...this.map.entries()]
      .map(([id, e]) => ({ id, name: itemName(id), uses: [...e.uses], weight: e.weight }))
      .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name, 'fr'))
  }
}

// ---------- Captures ----------

export interface CaptureSpot {
  subarea: string
  area: string
  x: [number, number]
  y: [number, number]
  zaap: string
  zaapCoords: [number, number]
  confidence: 'high' | 'medium' | 'low'
  note?: string
}

/**
 * Zone de capture conseillée. Dragodindes : zone principale de la recherche (strategy.md §2.1,
 * DofusDB + DPLN, confiance haute : Territoire des dragodindes sauvages, seule zone de la Dorée) ;
 * Muldos et Volkornes : zone des données (`FAMILIES[f].captureZone`).
 */
export function captureSpot(family: FamilyId): CaptureSpot | null {
  if (family === 'dragodinde')
    return {
      subarea: 'Territoire des dragodindes sauvages',
      area: 'Montagne des Koalaks',
      x: [-23, -11],
      y: [-2, 9],
      zaap: 'Village des Éleveurs',
      zaapCoords: [-16, 1],
      confidence: 'high',
      note: 'anneau autour du Village des Éleveurs (le zaap des enclos) ; seule zone de la Dorée',
    }
  const z = FAMILIES[family]?.captureZone
  if (!z) return null
  return { subarea: z.subarea, area: z.area, x: z.xRange, y: z.yRange, zaap: z.nearestZaap.name, zaapCoords: z.nearestZaap.coords, confidence: 'high' }
}

/** « Bassin des Muldos (Baie de Sufokia), x 16 → 22, y 18 → 23 ; zaap Rivage sufokien [10,22] ». */
export function captureSpotText(spot: CaptureSpot): string {
  return `${spot.subarea} (${spot.area}), x ${spot.x[0]} → ${spot.x[1]}, y ${spot.y[0]} → ${spot.y[1]} ; zaap ${spot.zaap} [${spot.zaapCoords.join(',')}]`
}

/** Meilleur filet équipable au niveau d'Éleveur (strategy.md §2.4 : passer au suivant dès que possible). */
export function bestNetKind(jobLevel: number): NetKind {
  if (jobLevel >= 200) return 'multiplicateur_renforce'
  if (jobLevel >= 150) return 'renforce'
  if (jobLevel >= 100) return 'multiplicateur'
  return 'universel'
}

export interface CaptureStatus {
  family: FamilyId
  netKind: NetKind
  cost: CaptureCost
  spot: CaptureSpot | null
}

export function captureStatus(family: FamilyId, jobLevel: number, ctx: PriceContext): CaptureStatus {
  const netKind = bestNetKind(jobLevel)
  return { family, netKind, cost: captureCost(family, netKind, ctx, { jobLevel }), spot: captureSpot(family) }
}

/** Besoin de captures d'une couleur G1 pour l'objectif. */
export interface CaptureNeed {
  speciesId: number
  /** G1 de la recette idéale (1 exemplaire, chaque accouplement réussi). */
  idealTotal: number
  /** Part de la recette idéale que vos montures ne couvrent pas encore. */
  idealRemaining: number
  /** Captures attendues restantes avec la stratégie (arrondi supérieur ; 0 si couvert). */
  expected: number
  ownedMales: number
  ownedFemales: number
  /** Répartition conseillée des captures attendues pour équilibrer les sexes. */
  males: number
  females: number
}

/**
 * Captures restantes par couleur pour l'objectif. On parcourt la recette idéale depuis la cible :
 * une monture possédée (fertile ou féconde) de l'espèce d'un nœud couvre tout son sous-arbre ; les
 * G1 non couvertes restent à capturer. Les captures attendues (`effort.capturesByColor`, stratégie
 * réelle : chances, clonage) sont réparties au prorata de la part non couverte (ESTIMATION).
 */
export function captureNeeds(tree: RecipeNode, mounts: Mount[], effort: EffortEstimate | null): CaptureNeed[] {
  const usable = mounts.filter(isUsable)
  const pool = new Map<number, number>()
  for (const m of usable) pool.set(m.speciesId, (pool.get(m.speciesId) ?? 0) + 1)
  const remaining = new Map<number, number>()
  const walk = (n: RecipeNode) => {
    const have = pool.get(n.speciesId) ?? 0
    if (have > 0) {
      pool.set(n.speciesId, have - 1)
      return
    }
    if (n.parents) {
      walk(n.parents[0])
      walk(n.parents[1])
      return
    }
    remaining.set(n.speciesId, (remaining.get(n.speciesId) ?? 0) + 1)
  }
  walk(tree)
  const out: CaptureNeed[] = []
  for (const [id, total] of capturesByColor(tree)) {
    const idealRemaining = remaining.get(id) ?? 0
    const expTotal = effort?.capturesByColor.get(id) ?? total
    const expected = total > 0 && idealRemaining > 0 ? Math.max(idealRemaining, Math.ceil((expTotal * idealRemaining) / total - 1e-9)) : 0
    const ownedMales = usable.filter((m) => m.speciesId === id && m.gender === 'male').length
    const ownedFemales = usable.filter((m) => m.speciesId === id && m.gender === 'femelle').length
    const deficit = ownedFemales - ownedMales
    const males = Math.max(0, Math.min(expected, Math.round((expected + deficit) / 2)))
    out.push({ speciesId: id, idealTotal: total, idealRemaining, expected, ownedMales, ownedFemales, males, females: expected - males })
  }
  return out.sort((a, b) => b.expected - a.expected || a.speciesId - b.speciesId)
}

// ---------- Objectif ----------

export interface StrategyOptions {
  parentLevel: number
  useOptimakina: boolean
  rules: Ruleset
}

/** Options d'effort de la stratégie conseillée : parents au niveau visé, Optimakina dès la G6, clonage. */
export function strategyEffortOptions(o: StrategyOptions): EffortOptions {
  return {
    parentLevel: Math.max(1, Math.min(200, Math.round(o.parentLevel))),
    makina: o.useOptimakina ? 'optimakina' : 'none',
    optimakinaFromGeneration: OPTIMAKINA_SYSTEMATIC_GENERATION,
    rules: o.rules,
    cloning: true,
  }
}

export interface GoalStatus {
  speciesId: number
  name: string
  family: FamilyId
  generation: number
  /** Montures de l'espèce visée possédées (tout statut). */
  owned: number
  reached: boolean
  tree: RecipeNode | null
  effort: EffortEstimate | null
  captures: CaptureNeed[]
  /** Captures attendues restantes (somme). */
  capturesRemaining: number
  error?: string
}

/** Où en est l'objectif : recette, effort attendu (stratégie réelle) et captures restantes par couleur. */
export function goalStatus(goalId: number, mounts: Mount[], opts: StrategyOptions): GoalStatus | null {
  const s = getSpecies(goalId)
  if (!s) return null
  const owned = mounts.filter((m) => m.speciesId === goalId).length
  const tree = s.breedable ? cheapestRecipe(goalId) : null
  let effort: EffortEstimate | null = null
  let error: string | undefined
  if (!tree) error = `${s.name} ne s'obtient pas par élevage.`
  else
    try {
      effort = expectedEffort(goalId, strategyEffortOptions(opts))
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  const captures = tree && owned === 0 ? captureNeeds(tree, mounts, effort) : []
  return {
    speciesId: goalId,
    name: s.name,
    family: s.family,
    generation: s.generation,
    owned,
    reached: owned > 0,
    tree,
    effort,
    captures,
    capturesRemaining: captures.reduce((n, c) => n + c.expected, 0),
    error,
  }
}

// ---------- Métier ----------

export interface JobStatus {
  level: number
  /** Prochain niveau qui débloque un enclos (200 au plus). */
  nextPaddockLevel: number
  /** Numéro de l'enclos débloqué à ce niveau. */
  nextPaddockIndex: number
  xpToNext: number
  /** Avancement (0 … 1) entre le dernier enclos débloqué et le suivant. */
  progress: number
  nextMilestone: JobMilestoneDef | null
  plan: LevelingPlan | null
  bestNow: CraftChoice | null
  /** Prochains jours Almanax utiles au métier (≤ 30 jours). */
  almanax: JobAlmanaxDay[]
}

export function jobStatus(jobLevel: number, ctx: PriceContext, rules: Ruleset, opts: { family?: FamilyId; todayIso: string; withPlan?: boolean }): JobStatus {
  const level = Math.max(1, Math.min(200, Math.floor(jobLevel)))
  const next = nextPaddockTarget(level)
  const prev = [...PADDOCK_UNLOCK_LEVELS].reverse().find((p) => p.level <= level)?.level ?? 1
  const nextIndex = Math.max(1, PADDOCK_UNLOCK_LEVELS.findIndex((p) => p.level === next) + 1)
  const span = jobXpForLevel(next) - jobXpForLevel(prev)
  const almanax = jobAlmanaxDays(opts.todayIso).filter((d) => d.daysUntil <= 30)
  const todayBonus = almanax.find((d) => d.daysUntil === 0)?.xpBonus ?? 0
  const milestones = jobMilestones({ family: opts.family })
  let plan: LevelingPlan | null = null
  let bestNow: CraftChoice | null = null
  if (level < 200) {
    try {
      bestNow = bestCraftAt(level, ctx, rules, 'kamas', { includeCaptures: true, almanaxXpBonus: todayBonus })
      if (opts.withPlan !== false) plan = levelingPlan(level, next, ctx, { rules, metric: 'kamas', includeCaptures: true, family: opts.family, almanaxXpBonus: todayBonus })
    } catch {
      plan = null
    }
  }
  return {
    level,
    nextPaddockLevel: next,
    nextPaddockIndex: nextIndex,
    xpToNext: level >= 200 ? 0 : jobXpBetween(level, next),
    progress: level >= 200 ? 1 : span > 0 ? Math.max(0, Math.min(1, (jobXpForLevel(level) - jobXpForLevel(prev)) / span)) : 0,
    nextMilestone: milestones.find((m) => m.level > level && m.kind !== 'makina') ?? null,
    plan,
    bestNow,
    almanax,
  }
}

// ---------- Phases du planificateur ----------

/** Phase P0–P6 (STRATEGY.phases) selon le niveau d'Éleveur ; P0 tant que niveau ≤ 1 et moins de 20 montures. */
export function currentPhase(jobLevel: number, mounts: Mount[]): StrategyPhase {
  const phases = STRATEGY.phases
  const byId = (id: string) => phases.find((p) => p.id === id)
  if (jobLevel >= 200) return byId('P6') ?? phases[phases.length - 1]
  if (jobLevel <= 1 && mounts.length < 20) return byId('P0') ?? phases[0]
  return (
    phases.find((p) => p.id !== 'P0' && p.id !== 'P6' && jobLevel >= p.jobLevelRange[0] && jobLevel < p.jobLevelRange[1]) ?? byId('P1') ?? phases[0]
  )
}

/**
 * Évalue automatiquement un critère de sortie de phase (texte de STRATEGY.phases) : niveau
 * d'Éleveur (« Éleveur ≥ 40 »), nombre de G1 (« ≥ 20 G1 capturées »), première monture d'une
 * génération (« première G9 », « au moins une couleur G3 »). `null` = non vérifiable automatiquement.
 */
export function evaluateCriterion(text: string, state: { jobLevel: number; mounts: Mount[] }): boolean | null {
  const lvl = /Éleveur\s*(?:≥|>=|niveau)?\s*(\d+)/i.exec(text)
  if (lvl) return state.jobLevel >= Number(lvl[1])
  const g1 = /≥\s*(\d+)\s*G1/i.exec(text)
  if (g1) return state.mounts.filter((m) => genOf(m.speciesId) === 1).length >= Number(g1[1])
  const first = /(première|premier|au moins une?)\b[^G]*G(\d+)/i.exec(text)
  if (first) {
    const g = Number(first[2])
    return state.mounts.some((m) => genOf(m.speciesId) >= g)
  }
  return null
}

/** Clé d'une case de checklist persistée (planProgress). */
export function checklistKey(scope: string, ...parts: (string | number)[]): string {
  return [scope, ...parts].join(':')
}

// ---------- Repères de stratégie ----------

export interface StrategyHighlight {
  id: 'niveau' | 'optimakina' | 'clonage' | 'palier' | 'enclos' | 'session'
  title: string
  text: string
  why: string
  confidence: 'high' | 'medium' | 'low'
}

/** Résumé chiffré de la stratégie conseillée (règles du ruleset actif et réglages du joueur). */
export function strategyHighlights(settings: Pick<AdvisorSettings, 'parentTargetLevel' | 'useOptimakina' | 'preferredTier' | 'jobLevel'>, rules: Ruleset): StrategyHighlight[] {
  const L = Math.max(1, Math.min(200, Math.round(settings.parentTargetLevel)))
  const p1 = targetChance(1, 1, { rules })
  const pL = targetChance(L, L, { rules })
  const p40 = targetChance(40, 40, { rules })
  const pOpti = targetChance(L, L, { rules, makina: 'optimakina' })
  const delta = rules.optimakinaBonus
  const unlocked = unlockedPaddocks(settings.jobLevel)
  const tier = settings.preferredTier
  const alloc = STRATEGY.paddockAllocationByCount?.[String(unlocked)]
  return [
    {
      id: 'niveau',
      title: `Parents au niveau ~40 (vous visez ${L})`,
      text: `Chance de génération cible d'un couple : ${formatPercent(p1)} au niveau 1, ${formatPercent(p40)} au niveau 40${L !== 40 ? `, ${formatPercent(pL)} au niveau ${L}` : ''}. Mangeoire en 2e jauge pendant la fécondation : le niveau 40 est presque gratuit en temps.`,
      why: "+0,15 % par niveau et par parent ; au-delà de 40, l'XP coûte beaucoup plus cher (niveau 100 = 8,4 × l'XP du niveau 40 pour 2,5 × le bonus) et immobilise les places d'enclos.",
      confidence: 'medium',
    },
    {
      id: 'optimakina',
      title: settings.useOptimakina ? `Optimakina : règle de prix, systématique dès la G${OPTIMAKINA_SYSTEMATIC_GENERATION}` : 'Optimakina désactivée dans vos réglages',
      text: `+${formatPercent(delta, 0)} de génération cible (règles ${rules.id}) : ${formatPercent(pL)} → ${formatPercent(pOpti)} au niveau ${L}. Rentable si son prix < C_eff × ${formatNumber(delta, 2)} / p, soit moins de ${formatPercent(delta / pL, 0)} de la valeur nette du couple à p = ${formatPercent(pL, 0)}.`,
      why: "Avec Optimakina partout, la simulation divise par 2 environ captures, accouplements et carburant d'une G9 ; limitée aux cibles ≥ G6, elle économise 20 à 48 % pour quelques dizaines de makinas.",
      confidence: 'medium',
    },
    {
      id: 'clonage',
      title: 'Cloner systématiquement les stériles',
      text: `Deux stériles de même génération → une fertile (l'une des deux au hasard), à refaire féconder${rules.cloneKeepsSerenity ? ' (sérénité conservée en 3.7)' : ''}. Même couleur d'abord ; jamais deux couleurs inutiles.`,
      why: 'Sans clonage, la pyramide de captures explose dès la G7 (× 80 à × 100) ; avec, une G9 demande ≈ 100 à 200 captures au niveau 40.',
      confidence: 'high',
    },
    {
      id: 'palier',
      title: `Palier : nuit au palier 1, journée au palier ${Math.max(2, Math.min(3, tier))}`,
      text: `Lot complet (≈ 2 phases + traversée de 0) : ≈ ${formatDuration(fertilitySeconds(1, rules))} au palier 1, ≈ ${formatDuration(fertilitySeconds(tier, rules))} au palier ${tier} (votre réglage). Palier 4 seulement en étant présent.`,
      why: 'Le palier ne change que la vitesse et le prix au point : les Extraits sont en général les moins chers, les Élixirs les plus chers.',
      confidence: 'high',
    },
    {
      id: 'enclos',
      title: `${unlocked} ${plural(unlocked, 'enclos', 'enclos')} : organisation conseillée`,
      text: alloc ?? 'Lots de 10 montures groupées par sérénité (fenêtre de 2 000 au plus).',
      why: "Une jauge consomme autant avec 1 ou 10 montures éligibles : visez 10 montures qui en profitent par jauge active. Objectif minimal du métier : niveau 120 (4 enclos).",
      confidence: 'medium',
    },
    {
      id: 'session',
      title: "Ordre d'une session",
      text: '1) accouplements (depuis l’étable, par génération croissante), 2) clonages, 3) captures, 4) extractions, 5) rangement.',
      why: "Évite de consommer une monture dont une action suivante a besoin et limite les erreurs d'appariement.",
      confidence: 'medium',
    },
  ]
}

/**
 * Remplace les identifiants de règles (E-FULL-01, « matingRules M-OPTI-01 »…) par leur titre, pour
 * les textes de STRATEGY affichés tels quels (erreurs fréquentes, actions des phases).
 */
export function resolveRuleRefs(text: string): string {
  const rules = [...STRATEGY.paddockRules, ...STRATEGY.matingRules, ...STRATEGY.captureRules]
  return text.replace(/(?:\b(?:mating|paddock|capture)Rules\s+)?\b([EMC]-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/g, (whole: string, id: string) => {
    const r = rules.find((x) => x.id === id)
    return r ? `règle « ${r.title} »` : whole
  })
}

// ---------- Analyse (calculs lourds, indépendants de l'heure) ----------

export interface AdvisorAnalysis {
  /** Jour (ISO) de l'analyse : Almanax, Takeza. */
  day: string
  almanax: AlmanaxEffect | null
  unlocked: number
  summary: InventorySummary
  fates: Map<string, MountFate>
  /** Plan d'accouplement (couples disjoints). */
  pairs: PairSuggestion[]
  /** Couples possibles examinés. */
  pairCandidates: number
  assignment: AssignResult | null
  /** Places d'enclos libres après la répartition conseillée. */
  freeSlots: number
  goal: GoalStatus | null
  capture: CaptureStatus
  job: JobStatus
  fertility: FertilityCost
  genetonValue: number
  /** Génétons attendus du plan d'accouplement. */
  expectedGenetons: number
  /** XP d'Éleveur du plan d'accouplement. */
  matingJobXp: number
  missingPrices: MissingPrice[]
  /** Montures dont aucune sortie n'est chiffrée. */
  unpricedMounts: number
}

/** Fonctions économiques communes (valorisations mises en cache). */
function economyKit(input: Pick<AdvisorInput, 'priceCtx' | 'mountPrices' | 'settings' | 'rules'>) {
  const { priceCtx: ctx, mountPrices, settings, rules } = input
  const cache = new Map<string, MountValuation>()
  const valuationOf = (id: number, level: number, state: 'fertile' | 'feconde' | 'sterile', senile: boolean) => {
    const k = `${id}|${level}|${state}|${senile ? 1 : 0}`
    let v = cache.get(k)
    if (!v) {
      v = mountValuation(id, level, { ctx, mountPrices, saleTax: settings.saleTax, state, senile })
      cache.set(k, v)
    }
    return v
  }
  const valuation: ValuationFn = (id, level, o) => valuationOf(id, level, o.state, o.senile)
  const levelCost: LevelCostFn = (from, to, m) => {
    const c = levelingCost(from, to, { tier: settings.preferredTier, batchSize: PADDOCK_SLOTS, sage: m.ability === 'sage', ctx, rules, jobLevel: settings.jobLevel })
    return { cost: c.costPerMount, complete: c.complete, seconds: c.secondsPerBatch }
  }
  const mountValue = (id: number, level: number) => valuationOf(id, level, 'fertile', false).best
  return { valuation, levelCost, mountValue }
}

/**
 * Calculs lourds de l'aide (sort des montures, plan d'accouplement, répartition en enclos, objectif,
 * métier, prix manquants). Ne dépend de `now` que par le jour (Almanax) : la page le mémorise et
 * rappelle `adviseNow` toutes les 30 s avec le même résultat.
 */
export function analyzeState(input: AdvisorInput): AdvisorAnalysis {
  const { settings, rules, mounts, priceCtx: ctx } = input
  const day = isoDay(input.now)
  const almanax = almanaxOn(day)
  const unlocked = unlockedPaddocks(settings.jobLevel)
  const summary = inventorySummary(mounts)
  const genetonValue = genetonKamasValue(input.genetonValue ?? null).value
  const kit = economyKit(input)
  const missing = new MissingCollector()

  let fates = new Map<string, MountFate>()
  if (mounts.length)
    try {
      fates = recommendFates({ inventory: mounts, goalSpeciesId: settings.goalSpeciesId, rules, valuation: kit.valuation, levelCost: kit.levelCost, genetonValue })
    } catch {
      fates = new Map()
    }

  let pairs: PairSuggestion[] = []
  let pairCandidates = 0
  if (summary.byStatus.feconde >= 2)
    try {
      const ranked = rankPairs(mounts, {
        rules,
        objective: objectiveFromGoal(settings.goal),
        goalSpeciesId: settings.goalSpeciesId,
        makinaPolicy: settings.useOptimakina ? 'auto' : 'jamais',
        takeza: !!almanax?.takeza,
        mountValue: kit.mountValue,
        makinaCost: (kind, family, gen) => makinaCost(kind, family, gen, ctx, rules),
        genetonValue,
      })
      pairCandidates = ranked.length
      pairs = bestDisjointPairs(ranked)
    } catch {
      pairs = []
    }

  const xpTargets: Record<string, number> = {}
  for (const f of fates.values()) if (f.action === 'monter' && f.targetLevel) xpTargets[f.mountId] = f.targetLevel
  let assignment: AssignResult | null = null
  if (mounts.length)
    try {
      assignment = assignPaddocks(mounts, {
        paddocksAvailable: unlocked,
        rules,
        tier: settings.preferredTier,
        withXp: settings.xpFiller,
        almanaxDoubled: almanax?.doubledGauge ?? null,
        levelTarget: settings.parentTargetLevel,
        xpTargets,
        keepCurrent: true,
      })
    } catch {
      assignment = null
    }
  const used = assignment
    ? assignment.paddocks.reduce((n, p) => n + p.mountIds.length, 0)
    : mounts.filter((m) => m.location.kind === 'enclos' && m.location.paddock <= unlocked).length
  const freeSlots = Math.max(0, unlocked * PADDOCK_SLOTS - used)

  const goal =
    settings.goalSpeciesId !== null
      ? goalStatus(settings.goalSpeciesId, mounts, { parentLevel: settings.parentTargetLevel, useOptimakina: settings.useOptimakina, rules })
      : null
  const capture = captureStatus(goal?.family ?? settings.family, settings.jobLevel, ctx)
  const job = jobStatus(settings.jobLevel, ctx, rules, { family: settings.family, todayIso: day })
  const fertility = fertilityCost({ tier: settings.preferredTier, batchSize: PADDOCK_SLOTS, ctx, rules, jobLevel: settings.jobLevel })

  missing.add(fertility.complete ? [] : fertility.missing, `fécondation au palier ${settings.preferredTier}`, 3)
  const lvl = levelingCost(1, settings.parentTargetLevel, { tier: settings.preferredTier, batchSize: PADDOCK_SLOTS, ctx, rules, jobLevel: settings.jobLevel })
  missing.add(lvl.complete ? [] : lvl.missing, `XP des parents (Mangeoire, niveau ${settings.parentTargetLevel})`, 2)
  missing.add(capture.cost.complete ? [] : capture.cost.missing, 'filets de capture', 2)
  for (const p of pairs)
    if (p.makina === 'optimakina' && p.makinaPrice && !p.makinaPrice.complete) {
      const fam = getSpecies(p.a.speciesId)?.family
      if (fam) missing.add(makinaCost('optimakina', fam, p.makinaAdvice.generation, ctx, rules).missing, `Optimakina G${p.makinaAdvice.generation}`, 2)
    }
  if (job.plan && !job.plan.totals.costComplete) missing.add(job.plan.toPrice, 'montée du métier', 1)

  let unpricedMounts = 0
  for (const f of fates.values()) if (f.action === 'a-chiffrer') unpricedMounts++

  return {
    day,
    almanax,
    unlocked,
    summary,
    fates,
    pairs,
    pairCandidates,
    assignment,
    freeSlots,
    goal,
    capture,
    job,
    fertility,
    genetonValue,
    expectedGenetons: pairs.reduce((n, p) => n + p.result.expectedGenetons * p.result.babies, 0),
    matingJobXp: pairs.reduce((n, p) => n + p.result.jobXp, 0),
    missingPrices: missing.list(),
    unpricedMounts,
  }
}

// ---------- Générateurs de conseils ----------

interface Ctx {
  input: AdvisorInput
  a: AdvisorAnalysis
  now: number
  byId: Map<string, Mount>
  missing: MissingCollector
}

function onboardingAdvice({ input }: Ctx): Advice[] {
  const s = input.settings
  const fam = FAMILIES[s.family]
  const goalName = s.goalSpeciesId !== null ? nameOf(s.goalSpeciesId) : null
  const spot = captureSpot(s.family)
  if (input.mounts.length === 0)
    return [
      {
        id: 'onboarding:premiers-pas',
        priority: 1,
        category: 'objectif',
        title: 'Premiers pas : préparez votre élevage',
        detail:
          "Les conseils se calculent à partir de votre niveau d'Éleveur, de votre objectif, de vos montures et de vos prix. Quatre étapes suffisent ; tout reste enregistré dans ce navigateur.",
        link: { page: 'montures', params: { captures: 1 }, label: 'Enregistrer des captures' },
        items: [
          {
            id: 'niveau',
            text: `Indiquer votre niveau d'Éleveur (actuellement ${s.jobLevel}) et la version du jeu`,
            hint: "Il fixe le nombre d'enclos (1 / 40 / 80 / 120 / 160 / 200) et les recettes disponibles.",
            link: { page: 'reglages', label: 'Réglages' },
            done: s.jobLevel > 1,
          },
          {
            id: 'objectif',
            text: goalName ? `Objectif : ${goalName}` : 'Choisir la monture visée, ou « rentabilité maximale »',
            hint: `Famille actuelle : ${fam?.plural ?? s.family}. Muldo (PM) et Volkorne (PA) se revendent et se brisent mieux ; Dragodinde pour ses succès (zone collée aux enclos).`,
            link: { page: 'plan', label: "Plan d'élevage" },
            done: s.goalSpeciesId !== null,
          },
          {
            id: 'captures',
            text: `Capturer vos premières montures : au moins 20 G1 de ${fam?.plural ?? s.family}, sexes équilibrés par couleur`,
            hint: spot ? `Où : ${captureSpotText(spot)}. 30 XP d'Éleveur par capture.` : "30 XP d'Éleveur par capture.",
            link: { page: 'montures', params: { captures: 1 }, label: 'Saisir les captures' },
          },
          {
            id: 'prix',
            text: 'Saisir quelques prix HDV (carburants, filets, makinas)',
            hint: 'Sans prix, les coûts restent « incomplets » : ils ne sont jamais comptés comme nuls.',
            link: { page: 'prix', label: 'Prix' },
            done: (input.pricedItems ?? 0) > 0,
          },
        ],
      },
    ]
  if (s.jobLevel <= 1 && s.goalSpeciesId === null)
    return [
      {
        id: 'onboarding:profil',
        priority: 2,
        category: 'objectif',
        title: 'Complétez votre profil',
        detail: "Votre niveau d'Éleveur est encore à 1 et aucune monture n'est visée : les enclos, les recettes et le plan en dépendent.",
        link: { page: 'reglages', label: 'Réglages' },
        items: [
          { id: 'niveau', text: "Indiquer votre niveau d'Éleveur", link: { page: 'reglages', label: 'Réglages' } },
          { id: 'objectif', text: 'Choisir une monture visée ou « rentabilité maximale »', link: { page: 'plan', label: "Plan d'élevage" } },
        ],
      },
    ]
  return []
}

function goalAdvice({ input, a }: Ctx): Advice[] {
  const s = input.settings
  const out: Advice[] = []
  if (a.goal?.reached)
    out.push({
      id: `objectif:atteint:${a.goal.speciesId}`,
      priority: 2,
      category: 'objectif',
      title: `Objectif atteint : ${a.goal.name} !`,
      detail: `Vous possédez ${nb(a.goal.owned, 'exemplaire')} de ${a.goal.name}. Choisissez la prochaine monture visée (génération suivante, autre couleur pour les succès) ou passez en « rentabilité maximale ».`,
      link: { page: 'plan', label: 'Choisir le prochain objectif' },
    })
  else if (a.goal?.error)
    out.push({
      id: `objectif:erreur:${a.goal.speciesId}`,
      priority: 3,
      category: 'objectif',
      title: `Objectif à revoir : ${a.goal.name}`,
      detail: a.goal.error,
      link: { page: 'plan', label: "Plan d'élevage" },
    })
  else if (s.goalSpeciesId === null && s.goal !== 'profit' && input.mounts.length > 0)
    out.push({
      id: 'objectif:choisir',
      priority: 3,
      category: 'objectif',
      title: 'Choisir une monture visée',
      detail:
        "Votre objectif est « succès de générations » : sans monture visée, les accouplements sont classés sans direction. Le plan d'élevage calcule alors la recette, les captures par couleur et la durée.",
      link: { page: 'plan', label: "Plan d'élevage" },
    })
  return out
}

function alarmAdvice({ input, a, now }: Ctx): Advice[] {
  const out: Advice[] = []
  for (const plan of Object.values(input.paddockPlans)) {
    if (plan.paddockId > a.unlocked) continue
    const N = plan.paddockId
    const pr = planProgress(plan, now)
    if (pr.finished) {
      const inside = input.mounts.filter((m) => m.location.kind === 'enclos' && m.location.paddock === N)
      out.push({
        id: `plan-fini:${N}:${plan.startedAt}`,
        priority: inside.length ? 2 : 4,
        category: 'enclos',
        title: `Enclos ${N} : plan terminé`,
        detail: inside.length
          ? `Le lot est fécond : sortez les fécondes vers l'étable (accouplement depuis l'étable), puis lancez un nouveau lot. ${nb(inside.length, 'monture')} encore dans l'enclos.`
          : "Le plan est terminé : arrêtez-le dans la page Enclos et lancez un nouveau lot.",
        link: { page: 'enclos', params: { enclos: N }, label: `Voir l'enclos ${N}` },
      })
      continue
    }
    const next = pr.next
    if (!next) continue
    const ms = next.at - now
    const clock = formatClock(next.at, now)
    const serenity = next.from.some((g) => g === 'baffeur' || g === 'caresseur')
    const priority: AdvicePriority = pr.due || ms <= 30 * MIN ? 1 : ms <= 3 * HOUR ? 2 : 3
    const parts: string[] = []
    if (pr.due)
      parts.push(
        pr.late && next.latest !== null
          ? `En retard : prévu à ${clock}, la fenêtre s'est fermée à ${formatClock(next.latest, now)} — des montures risquent de sortir de leur zone de sérénité. Faites-le tout de suite.`
          : `Prévu à ${clock} (${relativeTime(next.at, now)}).`,
      )
    else parts.push(`Prévu à ${clock} (${relativeTime(next.at, now)}).`)
    if (next.earliest !== null && next.latest !== null) parts.push(`Fenêtre de changement : ${formatClock(next.earliest, now)} → ${formatClock(next.latest, now)}.`)
    if (serenity) parts.push("Une jauge de sérénité continue de pousser toutes les montures jusqu'à ±5 000 : coupez-la à l'heure (à distance).")
    const purpose = plan.steps[next.index]?.purpose
    if (next.final) parts.push("Fin du plan : les montures sont fécondes, sortez-les vers l'étable pour les accoupler.")
    else if (purpose) parts.push(`Étape suivante : ${purpose.charAt(0).toLowerCase()}${purpose.slice(1)}.`)
    const items: AdviceItem[] = [
      ...next.from.filter((g) => !next.to.includes(g)).map((g) => ({ id: `off-${g}`, text: `Désactiver ${GAUGE_LABELS[g]}` })),
      ...next.to.filter((g) => !next.from.includes(g)).map((g) => ({ id: `on-${g}`, text: `Activer ${GAUGE_LABELS[g]}` })),
    ]
    if (next.final) items.push({ id: 'sortir', text: "Sortir les fécondes vers l'étable" })
    out.push({
      id: `alarme:${N}:${plan.startedAt}:${next.index}`,
      priority,
      category: 'alarme',
      title: pr.due ? `Enclos ${N} : ${next.text}` : `Enclos ${N} à ${clock} : ${next.text}`,
      detail: parts.join(' '),
      dueAt: next.at,
      window: next.earliest !== null && next.latest !== null ? { earliest: next.earliest, latest: next.latest } : undefined,
      link: { page: 'enclos', params: { enclos: N }, label: `Voir l'enclos ${N}` },
      items,
      action: { kind: 'advance-plan', paddockId: N, to: next.to },
    })
  }
  return out
}

/** Points de jauge « utiles » d'un remplissage : quel carburant, combien, coût. */
function fillItems(plan: FillPlan): AdviceItem[] {
  return plan.items.map((it) => ({
    id: `fuel-${it.option.fuel.id}`,
    text: `${it.count} × ${it.option.fuel.name}`,
    hint: [
      it.option.complete && it.option.unitPrice !== null
        ? `${formatKamas(it.option.unitPrice)} pièce`
        : it.option.unitPrice !== null && it.option.unitPrice > 0
          ? `≥ ${formatKamas(it.option.unitPrice)} pièce (prix incomplet)`
          : 'prix inconnu',
      it.option.canCraft ? `fabricable (niv. ${it.option.craftLevel})` : `craft niv. ${it.option.craftLevel}`,
    ].join(' · '),
    tone: it.option.complete ? undefined : 'warn',
  }))
}

function gaugeAdvice({ input, a, now, missing }: Ctx): Advice[] {
  const out: Advice[] = []
  const { rules, settings, priceCtx: ctx } = input
  const fuelOpts = { jobLevel: settings.jobLevel, rules }
  const doubled = a.almanax?.doubledGauge ?? null
  for (const p of input.paddocks) {
    if (p.id > a.unlocked || p.active.length === 0) continue
    if (validateActiveGauges(p.active) !== null) continue
    const N = p.id
    const inside = input.mounts.filter((m) => m.location.kind === 'enclos' && m.location.paddock === N)
    const link: AdviceLink = { page: 'enclos', params: { enclos: N }, label: `Voir l'enclos ${N}` }
    const elapsedS = p.updatedAt > 0 ? Math.max(0, (now - p.updatedAt) / 1000) : 0
    if (elapsedS > 3 * 86_400) {
      out.push({
        id: `jauges-anciennes:${N}:${p.updatedAt}`,
        priority: 3,
        category: 'enclos',
        title: `Enclos ${N} : mettez à jour les niveaux de jauges`,
        detail: `Saisis ${relativeTime(p.updatedAt, now)} : trop ancien pour prévoir les recharges. Recopiez les valeurs affichées en jeu.`,
        link,
      })
      continue
    }
    const plan = input.paddockPlans[String(N)]
    const planRunning = plan && plan.acknowledgedStepIndex < plan.steps.length ? plan : null
    // Sans plan démarré, la répartition conseillée peut changer les jauges de l'enclos : on ne
    // conseille pas de recharger une jauge qu'elle propose de désactiver (voir le conseil « Placer »).
    const planned = planRunning ? null : a.assignment?.paddocks.find((x) => x.paddockId === N && x.plan && x.firstGauges.length)
    const refTier: FuelTier = planRunning?.tier ?? settings.preferredTier
    const sims: SimMount[] = inside.map(toSimMount)
    let current = { ...p.gauges }
    let mountsNow = sims
    let pastEvents: SimEvent[] = []
    if (elapsedS >= 10) {
      const r = simulatePaddock({ gauges: { ...p.gauges }, active: p.active, mounts: sims, almanaxDoubled: doubled, maxSeconds: elapsedS, rules })
      current = r.gauges
      mountsNow = r.mounts
      pastEvents = r.events
    }
    let horizonS = 12 * 3600
    if (planRunning) {
      const pr = planProgress(planRunning, now)
      if (pr.next) horizonS = Math.max(0, Math.min(horizonS, (pr.next.at - now) / 1000))
    }
    const future = horizonS >= 10 ? simulatePaddock({ gauges: { ...current }, active: p.active, mounts: mountsNow, almanaxDoubled: doubled, maxSeconds: horizonS, rules }).events : []
    const basis = p.updatedAt > 0 ? `estimation d'après les niveaux saisis à ${formatClock(p.updatedAt, now)} et les montures de l'enclos` : "estimation d'après les niveaux saisis"
    for (const g of p.active) {
      const eligible = mountsNow.filter((m) => canBenefit(g, m)).length
      const level = current[g] ?? 0
      const serenityGauge = g === 'baffeur' || g === 'caresseur'
      const G = GAUGE_LABELS[g]
      if (eligible === 0 && level > 0) {
        out.push({
          id: `jauge-inutile:${N}:${g}:${p.updatedAt}`,
          priority: inside.length ? 2 : 3,
          category: 'enclos',
          title: `Enclos ${N} : ${G} ne sert à aucune monture`,
          detail: inside.length
            ? `Aucune monture de l'enclos ne peut en profiter (statistique pleine ou sérénité hors de la zone de la jauge) : elle ne consomme rien mais rien n'avance. Désactivez-la ou changez de lot (${basis}).`
            : `L'enclos est vide : désactivez ${G} ou posez un lot.`,
          link,
          confidence: 'medium',
        })
        continue
      }
      if (eligible === 0 || (planned && !planned.firstGauges.includes(g))) continue
      const tierNow = gaugeTier(level, rules)
      if (level <= 0) {
        const emptied = pastEvents.find((e) => e.kind === 'gauge-empty' && e.gauge === g)
        const since = emptied && p.updatedAt > 0 ? p.updatedAt + emptied.t * 1000 : null
        const refill = serenityGauge ? null : fillPlan(g, 0, rules.gaugeTierMax[refTier], ctx, fuelOpts)
        if (refill) missing.add(refill.complete ? [] : refill.missing, `recharge ${deName(G)}`, 2)
        out.push({
          id: `jauge-vide:${N}:${g}:${p.updatedAt}`,
          priority: 1,
          category: 'carburant',
          title: `Enclos ${N} : ${G} est vide`,
          detail: `${since ? `Vide depuis ≈ ${formatClock(since, now)}` : 'Jauge vide'} (${basis}) : ${eligible > 1 ? `${formatNumber(eligible)} montures n'avancent` : "1 monture n'avance"} plus sur cette statistique. ${
            serenityGauge ? 'Jauge de sérénité : ne la rechargez que du nécessaire, avec une alarme.' : `Rechargez au palier ${refTier} (${FUEL_TIER_NAMES[refTier]}s).`
          }`,
          link,
          items: refill ? fillItems(refill) : undefined,
          amount: refill ? { label: 'Recharge', value: refill.cost, complete: refill.complete } : undefined,
          missing: refill && !refill.complete ? refill.missing : undefined,
          confidence: 'medium',
        })
        continue
      }
      // Événement à venir : passage sous le palier du plan (si un plan tourne) ou jauge vide.
      const drop = future.find(
        (e) =>
          (e.kind === 'gauge-empty' && e.gauge === g) ||
          (planRunning !== null && e.kind === 'gauge-tier' && e.gauge === g && e.tier < refTier && tierNow >= refTier),
      )
      const belowPlanTier = planRunning !== null && tierNow < refTier
      if (!drop && !belowPlanTier) continue
      const at = drop ? now + drop.t * 1000 : now
      const isEmpty = drop?.kind === 'gauge-empty'
      const from = isEmpty || refTier === 1 ? 0 : rules.gaugeTierMax[(refTier - 1) as FuelTier]
      const refill = serenityGauge ? null : fillPlan(g, belowPlanTier ? level : from, rules.gaugeTierMax[refTier], ctx, fuelOpts)
      if (refill) missing.add(refill.complete ? [] : refill.missing, `recharge ${deName(G)}`, 1)
      const ms = at - now
      const priority: AdvicePriority = belowPlanTier || ms <= HOUR ? 2 : ms <= 6 * HOUR ? 3 : 4
      const clock = formatClock(at, now)
      const title = belowPlanTier
        ? `Enclos ${N} : rechargez ${G} (palier ${tierNow || 0} au lieu de ${refTier})`
        : isEmpty
          ? `Enclos ${N} : ${G} vide vers ${clock}`
          : `Enclos ${N} : rechargez ${G} avant ${clock}`
      const why = belowPlanTier
        ? `Les heures du plan supposent le palier ${refTier} entretenu : sous ce palier, la jauge tourne moins vite et le plan prend du retard.`
        : isEmpty
          ? `À ce rythme, la jauge sera vide ${relativeTime(at, now)} : les montures cesseront d'avancer.`
          : `Elle passera sous le palier ${refTier} ${relativeTime(at, now)} : les heures du plan supposent ce palier entretenu.`
      out.push({
        id: `recharge:${N}:${g}:${p.updatedAt}:${isEmpty ? 'vide' : 'palier'}`,
        priority,
        category: 'carburant',
        title,
        detail: `${why} ${eligible < PADDOCK_SLOTS ? `Rendement : ${eligible}/${PADDOCK_SLOTS} montures en profitent (complétez l'enclos). ` : ''}${
          serenityGauge ? 'Jauge de sérénité : remplissez-la au plus juste, avec une alarme. ' : ''
        }(${basis}.)`,
        dueAt: belowPlanTier ? undefined : at,
        link,
        items: refill ? fillItems(refill) : undefined,
        amount: refill ? { label: 'Recharge', value: refill.cost, complete: refill.complete } : undefined,
        missing: refill && !refill.complete ? refill.missing : undefined,
        confidence: 'medium',
      })
    }
  }
  return out
}

function almanaxAdvice({ input, a, now }: Ctx): Advice[] {
  const out: Advice[] = []
  const todayIso = a.day
  const today = a.almanax
  const fecund = input.mounts.filter((m) => effectiveFertility(m) === 'feconde')
  const pairsLink: AdviceLink = { page: 'accouplement', params: { onglet: 'couples' }, label: 'Plan d’accouplement' }
  if (today?.takeza) {
    const certain = levelSumForCertainty(input.rules, { optimakina: true, takeza: true })
    out.push({
      id: `almanax:${todayIso}:takeza`,
      priority: 1,
      category: 'almanax',
      title: "Aujourd'hui, Takeza : +20 % de génération cible",
      detail: `Le bonus s'ajoute à tous les accouplements du jour. Faites aujourd'hui vos tentatives de plus haute génération ; avec une Optimakina, ${formatNumber(certain)} niveaux cumulés suffisent pour 100 % (règles ${input.rules.id}).`,
      link: pairsLink,
      items: [
        { id: 'couples', text: `${nb(a.pairs.length, 'couple')} au plan d'accouplement (${nb(fecund.length, 'féconde')})`, link: pairsLink },
        { id: 'fecondes', text: 'Rendre fécondes au plus vite les montures de haute génération (palier 3–4 si vous êtes présent)', link: { page: 'enclos', label: 'Enclos' } },
      ],
      confidence: 'high',
    })
  }
  if (today?.doubledGauge) {
    const g = today.doubledGauge
    const candidates = input.mounts.filter((m) => (m.location.kind === 'enclos' || m.location.kind === 'etable') && canBenefit(g, toSimMount(m)))
    out.push({
      id: `almanax:${todayIso}:jauge-${g}`,
      priority: 2,
      category: 'almanax',
      title: `Aujourd'hui : ${GAUGE_LABELS[g]} à effet doublé`,
      detail: `Les gains de cette jauge sont doublés aujourd'hui (consommation supposée inchangée ; effet exact non confirmé). Programmez la phase correspondante dans vos enclos : un carburant de palier bas suffit à aller deux fois plus vite.`,
      link: { page: 'enclos', params: { onglet: 'repartition' }, label: 'Répartition des enclos' },
      items: [{ id: 'candidates', text: `${nb(candidates.length, 'monture')} peuvent en profiter maintenant (étable et enclos)` }],
      confidence: 'low',
    })
  }
  if (today?.babyAbility) {
    const label = ABILITY_LABELS[today.babyAbility]
    out.push({
      id: `almanax:${todayIso}:bebes-${today.babyAbility}`,
      priority: 2,
      category: 'almanax',
      title: `Aujourd'hui : bébés ${label}`,
      detail: `Tous les bébés nés aujourd'hui ont la capacité ${label} : faites les accouplements dont vous gardez ou vendez les bébés${today.babyAbility === 'sage' ? ' (Sage = XP × 2, idéal pour la revente au niveau 200)' : ''}. La capacité est perdue au clonage.`,
      link: pairsLink,
      items: [{ id: 'couples', text: `${nb(a.pairs.length, 'couple')} prêt${a.pairs.length > 1 ? 's' : ''} à accoupler` }],
      confidence: 'high',
    })
  }
  for (const e of upcomingAlmanax(now, 14)) {
    if (e.date === todayIso) continue
    const days = daysBetween(todayIso, e.date)
    const when = `${formatIsoDay(e.date)} (dans ${nb(days, 'jour')})`
    const dueAt = isoToMs(e.date)
    if (e.takeza) {
      const usable = input.mounts.filter(isUsable)
      const maxGen = usable.reduce((g, m) => Math.max(g, genOf(m.speciesId)), 0)
      // Que des G1 : ce sont elles qu'il faut préparer (couples G1 × G1 → G2), pas « aucune monture ».
      const minGen = maxGen >= 2 ? Math.max(2, maxGen - 1) : 1
      const high = usable.filter((m) => genOf(m.speciesId) >= minGen)
      const fecHigh = high.filter((m) => effectiveFertility(m) === 'feconde').length
      const prepItems: AdviceItem[] = high.length
        ? [
            { id: 'fecondes', text: `${nb(fecHigh, 'féconde')} de G${minGen} ou plus déjà prête${fecHigh > 1 ? 's' : ''}`, done: fecHigh > 0 && fecHigh === high.length },
            {
              id: 'fertiles',
              text: `${nb(high.length - fecHigh, 'fertile')} de G${minGen} ou plus à rendre ${plural(high.length - fecHigh, 'féconde')} d'ici là`,
              link: { page: 'enclos', params: { onglet: 'repartition' }, label: 'Enclos' },
              done: high.length - fecHigh === 0,
            },
          ]
        : [{ id: 'aucune', text: 'Aucune monture fertile pour le moment : capturez et préparez vos premiers lots pour en profiter' }]
      out.push({
        id: `almanax:${e.date}:takeza-prep`,
        priority: days <= 3 ? 2 : 3,
        category: 'almanax',
        title: `Takeza ${when} : préparez vos couples`,
        detail: `Ce jour-là, +20 % de génération cible sur tous les accouplements. Préparez un maximum de couples féconds de haute génération : un lot demande ≈ ${formatDuration(fertilitySeconds(input.settings.preferredTier, input.rules))} au palier ${input.settings.preferredTier}. Gardez pour ce jour les couples dont la cible est ≥ G6.`,
        dueAt,
        allDay: true,
        horizon: days <= 3 ? 'aujourdhui' : 'semaine',
        link: pairsLink,
        items: prepItems,
        confidence: 'high',
      })
    } else if (days <= 7 && e.doubledGauge) {
      out.push({
        id: `almanax:${e.date}:jauge-${e.doubledGauge}`,
        priority: 4,
        category: 'almanax',
        title: `${GAUGE_LABELS[e.doubledGauge]} doublé ${when}`,
        detail: `Préparez des lots qui auront besoin de ${GAUGE_LABELS[e.doubledGauge]} ce jour-là (effet exact non confirmé).`,
        dueAt,
        allDay: true,
        horizon: 'semaine',
        link: { page: 'enclos', label: 'Enclos' },
        confidence: 'low',
      })
    } else if (days <= 7 && e.babyAbility) {
      out.push({
        id: `almanax:${e.date}:bebes-${e.babyAbility}`,
        priority: 4,
        category: 'almanax',
        title: `Bébés ${ABILITY_LABELS[e.babyAbility]} ${when}`,
        detail: `Gardez des couples féconds pour ce jour si vous voulez des bébés ${ABILITY_LABELS[e.babyAbility]} (à garder ou à vendre).`,
        dueAt,
        allDay: true,
        horizon: 'semaine',
        link: pairsLink,
        confidence: 'high',
      })
    }
  }
  return out
}

function pairText(p: PairSuggestion): string {
  const ga = genOf(p.a.speciesId)
  const gb = genOf(p.b.speciesId)
  const targets = p.result.targetSpecies.map(nameOf).join(' ou ')
  return `♂ ${mountName(p.a)} (G${ga}, niv. ${p.a.level}) × ♀ ${mountName(p.b)} (G${gb}, niv. ${p.b.level}) → ${targets} : ${formatPercent(p.result.targetChance, 0)} de G${p.result.targetGeneration}`
}

function matingAdvice({ input, a, byId }: Ctx): Advice[] {
  const out: Advice[] = []
  const takeza = nextTakeza(a.day)
  const inPlan = new Set(a.pairs.flatMap((p) => [p.a.id, p.b.id]))
  if (a.pairs.length) {
    const sorted = [...a.pairs].sort((x, y) => x.result.targetGeneration - y.result.targetGeneration || y.score - x.score)
    const items: AdviceItem[] = []
    if (takeza && takeza.days > 0 && takeza.days <= 3 && sorted.some((p) => p.result.targetGeneration >= 6))
      items.push({
        id: 'takeza',
        text: `Takeza dans ${nb(takeza.days, 'jour')} : gardez pour ce jour les couples dont la cible est ≥ G6 (+20 %)`,
        tone: 'info',
      })
    if (a.summary.fecundInPaddock > 0)
      items.push({
        id: 'sortir',
        text: `Sortir d'abord ${nb(a.summary.fecundInPaddock, 'féconde')} des enclos vers l'étable (on n'accouple que depuis l'étable)`,
        tone: 'warn',
        link: { page: 'montures', params: { statut: 'feconde' }, label: 'Fécondes' },
      })
    for (const p of sorted) {
      const hints: string[] = []
      if (p.makina === 'optimakina')
        hints.push(
          `Optimakina G${p.makinaAdvice.generation} conseillée${p.makinaPrice?.price !== null && p.makinaPrice ? ` (${formatKamas(p.makinaPrice.price)}${p.makinaPrice.complete ? '' : ', minimum'})` : ' (prix inconnu)'}`,
        )
      else if (p.makinaAdvice.gain > 0) hints.push('sans makina')
      const g = p.result.expectedGenetons * p.result.babies
      if (g > 0) hints.push(`≈ ${formatNumber(g, 1)} ${plural(g, 'généton')} ${plural(g, 'attendu')}`)
      if (p.result.jobXp > 0) hints.push(`${formatNumber(p.result.jobXp)} XP d'Éleveur`)
      const stable = [p.a, p.b].filter((m) => m.location.kind !== 'etable')
      if (stable.length) hints.push(`à mettre dans l'étable : ${stable.map(mountName).join(', ')}`)
      items.push({ id: p.key, text: pairText(p), hint: hints.join(' · '), tone: stable.length ? 'warn' : undefined })
    }
    const idle = input.mounts.filter((m) => effectiveFertility(m) === 'feconde' && !inPlan.has(m.id) && a.fates.get(m.id)?.action !== 'accoupler')
    if (idle.length)
      items.push({
        id: 'seules',
        text: `${nb(idle.length, 'féconde')} sans partenaire utile : gardez-les en attente (ou capturez le sexe opposé)`,
        hint: speciesSummary(idle),
      })
    const opti = sorted.filter((p) => p.makina === 'optimakina').length
    out.push({
      id: `accouplement:${hashKey(a.pairs.map((p) => p.key).sort().join(','))}`,
      priority: 2,
      category: 'accouplement',
      title: `Accoupler ${nb(a.pairs.length, 'couple')} ${plural(a.pairs.length, 'fécond')}`,
      detail: `Plan d'appariement pour l'objectif « ${objectiveLabel(input.settings.goal)} » : chaque monture n'est utilisée qu'une fois, sur ${nb(a.pairCandidates, 'couple')} possible${a.pairCandidates > 1 ? 's' : ''}. Accouplez depuis l'étable, par génération croissante, puis clonez les stériles. ${
        opti ? `Optimakina sur ${nb(opti, 'couple')} : prix < C_eff × Δ / p, ou cible ≥ G${OPTIMAKINA_SYSTEMATIC_GENERATION} quand les prix manquent.` : ''
      }`.trim(),
      link: { page: 'accouplement', params: { onglet: 'couples' }, label: 'Plan d’accouplement' },
      items,
      amount: a.expectedGenetons > 0 ? { label: 'Génétons attendus', value: a.expectedGenetons * a.genetonValue, complete: true } : undefined,
    })
  }
  // Fécondes « condamnées » hors plan : accoupler entre elles avant de sortir (M-FREEBABY-01).
  const seen = new Set<string>()
  const free: AdviceItem[] = []
  for (const f of a.fates.values()) {
    if (f.action !== 'accoupler' || !f.partnerId) continue
    const key = [f.mountId, f.partnerId].sort().join('|')
    if (seen.has(key) || inPlan.has(f.mountId) || inPlan.has(f.partnerId)) continue
    seen.add(key)
    const m = byId.get(f.mountId)
    const partner = byId.get(f.partnerId)
    if (!m || !partner) continue
    free.push({ id: key, text: `${mountName(m)} × ${mountName(partner)}, puis sortir les stériles`, hint: f.valueNote })
  }
  if (free.length)
    out.push({
      id: `accoupler-avant:${hashKey([...seen].sort().join(','))}`,
      priority: 2,
      category: 'accouplement',
      title: `Accoupler avant de sortir : ${nb(free.length, 'couple')}`,
      detail:
        "Fécondes hors plan de sexes opposés : accouplez-les entre elles (bébé gratuit + XP d'Éleveur) avant de les vendre ou de les extraire. L'extraction rend autant de ressources, féconde ou stérile.",
      link: { page: 'montures', params: { sort: 'accoupler' }, label: 'Voir ces montures' },
      items: free,
    })
  return out
}

function objectiveLabel(goal: AdvisorSettings['goal']): string {
  return goal === 'profit' ? 'kamas' : goal === 'succes' ? 'succès de générations' : 'kamas et succès'
}

function fateAdvice({ input, a, byId }: Ctx): Advice[] {
  const out: Advice[] = []
  const fates = [...a.fates.values()]
  // Clonage
  const seen = new Set<string>()
  const clones: AdviceItem[] = []
  for (const f of fates) {
    if (f.action !== 'cloner' || !f.partnerId) continue
    const key = [f.mountId, f.partnerId].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const m = byId.get(f.mountId)
    const p = byId.get(f.partnerId)
    if (!m || !p) continue
    const same = m.speciesId === p.speciesId
    clones.push({
      id: key,
      text: `${mountName(m)} + ${mountName(p)} (G${genOf(m.speciesId)})`,
      hint: same ? 'même couleur : résultat certain' : "couleurs différentes : l'une des deux est gardée (50/50)",
    })
  }
  if (clones.length)
    out.push({
      id: `clonage:${hashKey([...seen].sort().join(','))}`,
      priority: 2,
      category: 'clonage',
      title: `Cloner ${nb(clones.length, 'paire')} de stériles`,
      detail: `Deux montures de même génération donnent une fertile (l'une des deux au hasard), jauges remises à 0, capacité perdue, sérénité ${
        input.rules.cloneKeepsSerenity ? 'conservée' : 'réinitialisée'
      }. Sans clonage, les captures explosent dès la G7 ; le clone sera à refaire féconder.`,
      link: { page: 'montures', params: { sort: 'cloner' }, label: 'Voir les stériles à cloner' },
      items: clones,
      confidence: 'high',
    })
  // Sorties
  const exits = fates.filter((f) => f.action === 'vente' || f.action === 'extraction' || f.action === 'brisage')
  if (exits.length) {
    const counts = { vente: 0, extraction: 0, brisage: 0 }
    for (const f of exits) counts[f.action as 'vente' | 'extraction' | 'brisage']++
    const main = (Object.entries(counts) as ['vente' | 'extraction' | 'brisage', number][]).sort((x, y) => y[1] - x[1])[0][0]
    const parts = [
      counts.extraction ? `${counts.extraction} à extraire` : '',
      counts.vente ? `${counts.vente} à vendre` : '',
      counts.brisage ? `${counts.brisage} à briser` : '',
    ].filter(Boolean)
    const sorted = [...exits].sort((x, y) => (y.value ?? -1) - (x.value ?? -1))
    const total = sorted.reduce((n, f) => n + (f.value ?? 0), 0)
    const complete = sorted.every((f) => f.complete && f.value !== null)
    const lowConf = sorted.some((f) => f.confidence === 'low')
    out.push({
      id: `sortie:${hashKey(sorted.map((f) => `${f.mountId}:${f.action}`).join(','))}`,
      priority: 3,
      category: 'vente',
      title: `Sortir ${nb(exits.length, 'monture')} (${parts.join(', ')})`,
      detail:
        "Montures sans usage pour votre plan : meilleure sortie nette de taxe entre vente, extraction et brisage, avec vos prix. Avant d'extraire deux fécondes, accouplez-les (bébé gratuit).",
      link: { page: 'montures', params: { sort: main }, label: 'Voir les montures à sortir' },
      items: sorted.slice(0, 12).map((f) => {
        const m = byId.get(f.mountId)
        return {
          id: f.mountId,
          text: `${m ? mountName(m) : f.mountId}${m ? ` (G${genOf(m.speciesId)}, niv. ${m.level})` : ''} — ${f.label}`,
          hint: f.value !== null ? `${formatKamas(f.value)}${f.complete ? '' : ' (minimum)'}` : 'valeur inconnue',
        }
      }),
      amount: { label: 'Valeur nette', value: complete || total > 0 ? total : null, complete },
      confidence: lowConf ? 'low' : 'medium',
    })
  }
  const levelUp = fates.filter((f) => f.action === 'monter')
  if (levelUp.length)
    out.push({
      id: `monter:${hashKey(levelUp.map((f) => `${f.mountId}:${f.targetLevel}`).join(','))}`,
      priority: 4,
      category: 'enclos',
      title: `Monter ${nb(levelUp.length, 'monture')} en niveau avant de les sortir`,
      detail: 'Un palier de valeur proche (brisage, tranche de prix 100/200) rapporte plus que le carburant de Mangeoire nécessaire. Placez-les en complément XP dans les enclos.',
      link: { page: 'montures', params: { sort: 'monter' }, label: 'Voir ces montures' },
      items: levelUp.slice(0, 10).map((f) => {
        const m = byId.get(f.mountId)
        return { id: f.mountId, text: `${m ? mountName(m) : f.mountId} → niveau ${f.targetLevel ?? '?'}`, hint: f.label }
      }),
      confidence: 'low',
    })
  return out
}

function placementAdvice({ input, a, byId }: Ctx): Advice[] {
  const res = a.assignment
  if (!res) return []
  // Les montures à accoupler maintenant restent dans l'étable (l'accouplement passe avant le placement).
  const mating = new Set(a.pairs.flatMap((p) => [p.a.id, p.b.id]))
  for (const f of a.fates.values()) if (f.action === 'accoupler' && f.partnerId) mating.add(f.mountId)
  const items: AdviceItem[] = []
  let added = 0
  let starts = 0
  for (const pa of res.paddocks) {
    const plan = input.paddockPlans[String(pa.paddockId)]
    const running = !!plan && plan.acknowledgedStepIndex < plan.steps.length
    const addMs = pa.addedIds.filter((id) => !mating.has(id)).map((id) => byId.get(id)).filter((m): m is Mount => !!m)
    const current = input.paddocks.find((p) => p.id === pa.paddockId)?.active ?? []
    const sw = pa.firstGauges.length ? gaugeSwitch(current, pa.firstGauges) : null
    const gauges = sw && (sw.on.length || sw.off.length) ? sw.text : ''
    const role = PADDOCK_ROLE_LABELS[pa.role].split(' — ')[0]
    if (addMs.length) {
      added += addMs.length
      items.push({
        id: `enclos-${pa.paddockId}`,
        text: `Enclos ${pa.paddockId} : poser ${nb(addMs.length, 'monture')}${gauges ? `, puis ${gauges}` : ''}`,
        hint: [role, speciesSummary(addMs), pa.totalSeconds > 0 ? `fécondes en ≈ ${formatDuration(pa.totalSeconds)}` : '', running ? 'un plan tourne déjà : relancez-le après' : '']
          .filter(Boolean)
          .join(' · '),
        link: { page: 'enclos', params: { enclos: pa.paddockId }, label: `Enclos ${pa.paddockId}` },
      })
    } else if (pa.plan && !running && pa.mountIds.length) {
      starts++
      items.push({
        id: `demarrer-${pa.paddockId}`,
        text: `Enclos ${pa.paddockId} : démarrer le plan${gauges ? ` (${gauges})` : pa.firstGauges.length ? ` (${gaugeList(pa.firstGauges)})` : ''}`,
        hint: `${role} · ${nb(pa.mountIds.length, 'monture')} en place ; le plan donne les heures de changement et les alarmes`,
        link: { page: 'enclos', params: { enclos: pa.paddockId }, label: `Enclos ${pa.paddockId}` },
      })
    }
  }
  const outs = res.moves.filter((m) => m.to.kind !== 'enclos')
  if (outs.length) {
    const ms = outs.map((m) => byId.get(m.mountId)).filter((m): m is Mount => !!m)
    items.push({ id: 'sorties', text: `Sortir ${nb(outs.length, 'monture')} des enclos vers l'étable`, hint: speciesSummary(ms) })
  }
  if (res.stats.waiting > 0)
    items.push({ id: 'attente', text: `${nb(res.stats.waiting, 'monture')} attendent une place (lot suivant)`, hint: `${nb(res.waitingBatches.length, 'lot')} en attente` })
  if (!added && !starts && !outs.length) return []
  return [
    {
      id: `enclos:${hashKey(items.map((i) => `${i.id}:${i.text}`).join('|'))}`,
      priority: 2,
      category: 'enclos',
      title: added ? `Placer ${nb(added, 'monture')} en enclos` : starts ? `Démarrer le plan de ${nb(starts, 'enclos', 'enclos')}` : `Sortir ${nb(outs.length, 'monture')} des enclos`,
      detail:
        "Répartition automatique : lots de sérénité ≤ 2 000, 10 montures éligibles par jauge active (une jauge consomme autant avec 1 ou 10 montures), Mangeoire en complément. Poser ou retirer une monture est la seule action impossible à distance ; démarrez ensuite le plan dans la page Enclos pour avoir les alarmes.",
      link: { page: 'enclos', params: { onglet: 'repartition' }, label: 'Répartition automatique' },
      items,
    },
  ]
}

function captureAdvice({ input, a }: Ctx): Advice[] {
  if (input.mounts.length === 0) return []
  const s = input.settings
  const items: AdviceItem[] = []
  const goal = a.goal
  const cap = a.capture
  const family = cap.family
  const famInfo = FAMILIES[family]
  let total = 0
  if (goal && !goal.reached && goal.captures.length) {
    for (const c of goal.captures) {
      if (c.expected <= 0) continue
      total += c.expected
      const sexes = [c.females ? `${c.females} ♀` : '', c.males ? `${c.males} ♂` : ''].filter(Boolean).join(', ')
      items.push({
        id: `g1-${c.speciesId}`,
        text: `${nameOf(c.speciesId)} : ${formatNumber(c.expected)}${sexes ? ` (${sexes})` : ''}`,
        hint: `recette idéale : encore ${c.idealRemaining} sur ${c.idealTotal} ; vous en avez ${c.ownedMales} ♂ / ${c.ownedFemales} ♀`,
      })
    }
  }
  if (!goal) {
    const owned = new Set(input.mounts.map((m) => m.speciesId))
    const missingColors = speciesOfFamily(family).filter((sp) => sp.capturable && sp.generation === 1 && !owned.has(sp.id))
    if (missingColors.length)
      items.push({
        id: 'succes',
        text: `Succès de capture : il vous manque ${missingColors.map((sp) => sp.name).join(', ')}`,
        hint: 'une monture de chaque couleur G1 suffit (≈ 10 minutes)',
      })
  }
  const waiting = a.assignment?.stats.waiting ?? 0
  if (a.freeSlots > 0 && waiting === 0)
    items.push({
      id: 'places',
      text: `${nb(a.freeSlots, 'place')} ${plural(a.freeSlots, 'libre')} en enclos : capturez de quoi les remplir`,
      hint: 'le rendement d’une jauge = montures éligibles / 10',
    })
  if (!items.length) return []
  if (cap.spot) items.push({ id: 'zone', text: `Où : ${captureSpotText(cap.spot)}`, hint: cap.spot.note })
  const c = cap.cost
  if (c.net)
    items.push({
      id: 'filet',
      text: `Filet : ${c.net.name} (${NET_KIND_LABELS[cap.netKind].toLowerCase()}, ${formatNumber(c.mountsPerCast)} par lancer)`,
      hint: `${c.perMount !== null ? `${formatKamas(c.perMount)} par monture${c.complete ? '' : ' (minimum)'}` : 'coût incomplet'}${
        s.jobLevel < 100 ? ' · filet multiplicateur au niveau 100 (≈ ÷ 4 le coût par monture)' : ''
      }`,
      tone: c.complete ? undefined : 'warn',
    })
  const title = goal && total > 0 ? `Capturer ${formatNumber(total)} ${famInfo?.plural ?? family} pour ${goal.name}` : `Capturer des ${famInfo?.plural ?? family}`
  return [
    {
      id: `capture:${a.day}:${hashKey(items.map((i) => i.text).join('|'))}`,
      priority: a.freeSlots >= PADDOCK_SLOTS && waiting === 0 ? 2 : 3,
      category: 'capture',
      title,
      detail:
        goal && total > 0
          ? `Captures restantes estimées avec votre stratégie (parents niveau ${s.parentTargetLevel}, ${s.useOptimakina ? `Optimakina dès la G${OPTIMAKINA_SYSTEMATIC_GENERATION}` : 'sans makina'}, clonage) : besoin moyen de l'effort attendu, au prorata de ce que vos montures couvrent déjà. Capturez le sexe en déficit d'abord ; 30 XP d'Éleveur par capture.`
          : "Gardez les enclos pleins : l'élevage ne s'auto-alimente pas (un bébé par couple). Capturez le sexe en déficit d'abord ; 30 XP d'Éleveur par capture.",
      link: { page: 'montures', params: { captures: 1 }, label: 'Saisir les captures' },
      items,
      amount: c.perMount !== null && total > 0 ? { label: 'Filets', value: c.perMount * total, complete: c.complete } : undefined,
      missing: c.complete ? undefined : c.missing,
      confidence: goal && total > 0 ? 'medium' : undefined,
    },
  ]
}

function jobAdvice({ a }: Ctx): Advice[] {
  const j = a.job
  if (j.level >= 200) return []
  const items: AdviceItem[] = []
  const best = j.bestNow?.option
  if (best)
    items.push({
      id: 'craft',
      text: `Crafter ${best.name}${best.kind === 'capture' ? '' : ` (niv. ${best.level})`} : ${formatNumber(best.xp)} XP par ${best.kind === 'capture' ? 'capture' : 'craft'}`,
      hint: best.cost !== null ? `${formatKamas(best.cost)} par craft${best.costComplete ? '' : ' (minimum)'}${j.bestNow?.fallback ? ' · choisi au minimum de ressources (prix manquants)' : ''}` : 'coût incomplet',
      tone: best.costComplete ? undefined : 'warn',
    })
  if (j.plan)
    items.push({
      id: 'plan',
      text: `≈ ${formatNumber(j.plan.totals.crafts)} crafts${j.plan.totals.captures ? ` et ${formatNumber(j.plan.totals.captures)} captures` : ''} jusqu'au niveau ${j.nextPaddockLevel}`,
      hint: `${j.plan.totals.cost > 0 || j.plan.totals.costComplete ? `≈ ${formatKamas(j.plan.totals.cost)}${j.plan.totals.costComplete ? '' : ' (minimum, prix manquants)'}` : 'coût incomplet'}`,
    })
  if (j.nextMilestone) items.push({ id: 'jalon', text: `Prochain jalon : ${j.nextMilestone.label} au niveau ${j.nextMilestone.level}`, hint: j.nextMilestone.detail })
  if (a.matingJobXp > 0) items.push({ id: 'accouplements', text: `Les accouplements prévus rapportent ${formatNumber(a.matingJobXp)} XP d'Éleveur` })
  for (const d of j.almanax.filter((x) => x.xpBonus > 0 || x.ingredientSaving > 0 || x.doubleCraftChance > 0).slice(0, 2))
    items.push({
      id: `almanax-${d.date}`,
      text: `${d.daysUntil === 0 ? "Aujourd'hui" : formatIsoDay(d.date)} : ${d.effect}`,
      hint: d.use ?? undefined,
      tone: d.daysUntil <= 7 ? 'info' : undefined,
    })
  const bonusSoon = j.almanax.find((d) => d.xpBonus > 0 && d.daysUntil <= 7)
  const missing = j.plan && !j.plan.totals.costComplete ? j.plan.toPrice : []
  return [
    {
      id: `metier:${j.level}`,
      priority: j.level < 120 ? 3 : 4,
      category: 'metier',
      title: `Métier : ${formatNumber(j.xpToNext)} XP jusqu'au niveau ${j.nextPaddockLevel} (${j.nextPaddockIndex}e enclos)`,
      detail: `Objectif minimal : niveau 120 (4 enclos). Une recette rapporte son niveau en XP quand on a le même niveau, puis chute vite : craftez la dernière taille débloquée.${
        bonusSoon ? ` ${bonusSoon.daysUntil === 0 ? "Aujourd'hui" : `Le ${formatIsoDay(bonusSoon.date)}`} : ${bonusSoon.effect} — gardez-y vos gros crafts.` : ''
      }`,
      link: { page: 'metier', label: 'Plan de montée du métier' },
      items,
      amount: j.plan ? { label: `Jusqu'au niveau ${j.nextPaddockLevel}`, value: j.plan.totals.cost > 0 || j.plan.totals.costComplete ? j.plan.totals.cost : null, complete: j.plan.totals.costComplete } : undefined,
      missing: missing.length ? missing : undefined,
    },
  ]
}

function priceAdvice({ input, a, missing }: Ctx): Advice[] {
  const out: Advice[] = []
  if (!input.settings.useDefaultPrices && (input.pricedItems ?? 0) === 0 && input.mounts.length > 0)
    out.push({
      id: 'prix:aucun',
      priority: 3,
      category: 'prix',
      title: 'Aucun prix disponible',
      detail: "Les prix par défaut sont désactivés et vous n'avez saisi aucun prix : coûts et rentabilités sont tous incomplets. Activez les prix par défaut (réglages) ou saisissez vos prix HDV.",
      link: { page: 'prix', label: 'Saisir des prix' },
    })
  const list = missing.list().slice(0, 6)
  const items: AdviceItem[] = list.map((m) => ({ id: `item-${m.id}`, text: m.name, hint: `sert à : ${m.uses.join(', ')}`, link: { page: 'prix', params: { q: m.name }, label: 'Saisir' } }))
  if (a.unpricedMounts > 0)
    items.push({ id: 'montures', text: `${nb(a.unpricedMounts, 'monture')} sans aucun prix de sortie`, link: { page: 'prix', params: { onglet: 'montures' }, label: 'Prix des montures' } })
  if (items.length)
    out.push({
      id: `prix:${hashKey(items.map((i) => i.id).join(','))}`,
      priority: 4,
      category: 'prix',
      title: `Saisir ${nb(items.length, 'prix', 'prix')} qui bloquent vos estimations`,
      detail: "Ces objets n'ont aucun prix (ni saisi, ni par défaut) : les coûts qui en dépendent sont affichés comme un minimum, jamais comptés à 0.",
      link: { page: 'prix', label: 'Page Prix' },
      items,
      missing: list.map((m) => m.id),
    })
  return out
}

// ---------- Assemblage ----------

/** Tri : priorité, puis heure (les actions minutées d'abord), puis ordre d'une session. */
export function sortAdvice(list: Advice[]): Advice[] {
  const cat = (c: AdviceCategory) => ADVICE_CATEGORIES.indexOf(c)
  return [...list].sort(
    (x, y) =>
      x.priority - y.priority ||
      (x.dueAt ?? Number.POSITIVE_INFINITY) - (y.dueAt ?? Number.POSITIVE_INFINITY) ||
      cat(x.category) - cat(y.category) ||
      x.id.localeCompare(y.id),
  )
}

/**
 * Liste ordonnée des actions à faire à l'instant `input.now` : alarmes des plans d'enclos, jauges
 * vides ou à recharger, Almanax, accouplements, clonages, sorties, placement en enclos, captures,
 * métier, prix manquants, premiers pas et objectif. `analysis` (calculs lourds) est recalculée si
 * absente.
 */
export function adviseNow(input: AdvisorInput, analysis: AdvisorAnalysis = analyzeState(input)): Advice[] {
  const missing = new MissingCollector()
  missing.merge(analysis.missingPrices)
  const ctx: Ctx = { input, a: analysis, now: input.now, byId: new Map(input.mounts.map((m) => [m.id, m])), missing }
  const list = [
    ...onboardingAdvice(ctx),
    ...alarmAdvice(ctx),
    ...gaugeAdvice(ctx),
    ...almanaxAdvice(ctx),
    ...matingAdvice(ctx),
    ...fateAdvice(ctx),
    ...placementAdvice(ctx),
    ...captureAdvice(ctx),
    ...jobAdvice(ctx),
    ...goalAdvice(ctx),
  ]
  // Les prix en dernier : les recharges de carburant y ajoutent leurs objets manquants.
  list.push(...priceAdvice(ctx))
  return sortAdvice(list)
}

/** Groupe d'affichage d'un conseil : maintenant, prochaines heures, aujourd'hui, cette semaine. */
export function adviceHorizon(a: Advice, now: number): AdviceHorizon {
  if (a.horizon) return a.horizon
  if (a.dueAt !== undefined) {
    const d = a.dueAt - now
    if (d <= 15 * MIN) return 'maintenant'
    if (d <= 6 * HOUR) return 'heures'
    if (a.dueAt < startOfDay(now) + DAY) return 'aujourdhui'
    return 'semaine'
  }
  return a.priority <= 2 ? 'maintenant' : a.priority === 3 ? 'aujourdhui' : 'semaine'
}

export function groupAdvice(list: Advice[], now: number): { horizon: AdviceHorizon; label: string; advice: Advice[] }[] {
  return HORIZONS.map((h) => ({ horizon: h, label: HORIZON_LABELS[h], advice: list.filter((a) => adviceHorizon(a, now) === h) })).filter((g) => g.advice.length > 0)
}

/** Prochaine action minutée (pour un compte à rebours), ou null. */
export function nextTimedAdvice(list: Advice[], now: number): Advice | null {
  let best: Advice | null = null
  for (const a of list) if (a.dueAt !== undefined && a.dueAt >= now - HOUR && (!best || a.dueAt < (best.dueAt as number))) best = a
  return best
}
