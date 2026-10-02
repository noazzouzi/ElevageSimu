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
import { TAKEZA_DATES, almanaxOn, serverDay, serverDayStart, upcomingAlmanax, type AlmanaxEffect } from './almanax'
import { capturesByColor, cheapestRecipe, cleanParent, expectedEffort, type EffortEstimate, type EffortOptions, type RecipeNode } from './breedingPath'
import { ABILITY_LABELS, FUEL_TIER_NAMES, GAUGE_IDS, GAUGE_LABELS, PADDOCK_SLOTS, PADDOCK_UNLOCK_LEVELS, TICK_SECONDS } from './constants'
import {
  NET_KIND_LABELS,
  captureCost,
  fertilityCost,
  batchProfile,
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
import { breed, targetChance } from './genetics'
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
import { effectiveFertility, mountName, toBreedingParent } from './mounts'
import { canBenefit, gaugeTier, simulatePaddock, validateActiveGauges, type SimMount } from './paddock'
import { PADDOCK_ROLE_LABELS, assignPaddocks, gaugeSwitch, toSimMount, type AssignResult, type PlanSchedule } from './paddockAssign'
import { planStatus, remainingPlanConsumption } from './paddockPlanStatus'
import {
  OPTIMAKINA_GOAL_STEP_GENERATION,
  OPTIMAKINA_SYSTEMATIC_GENERATION,
  STACK_MIN_ATTEMPTS,
  TAKEZA_PRIORITY_GENERATION,
  bestDisjointPairs,
  economyCoupleCost,
  objectiveFromGoal,
  rankPairs,
  type PairSuggestion,
} from './pairing'
import type { PriceContext } from './pricing'
import type { ProgramConfig, ProgramSummary } from './programSim'
import { planActiveHistory, projectMountsFromPlan, projectPaddock } from './projection'
import { gaugeMax, type Ruleset } from './rules'
import type { FamilyId, FuelTier, GaugeId, Mount, PaddockState, RulesetId } from './types'
import { jobLevelFromXp, jobXpForLevel } from './xp'

// ---------- Types ----------

export type AdviceCategory = 'alarme' | 'almanax' | 'accouplement' | 'clonage' | 'enclos' | 'carburant' | 'capture' | 'vente' | 'metier' | 'prix' | 'objectif' | 'erreur'

/** Ordre d'une session (strategy.md règle 13) : sert de départage à priorité égale. */
export const ADVICE_CATEGORIES: AdviceCategory[] = ['erreur', 'objectif', 'alarme', 'carburant', 'almanax', 'accouplement', 'clonage', 'enclos', 'capture', 'vente', 'metier', 'prix']

export const ADVICE_CATEGORY_LABELS: Record<AdviceCategory, string> = {
  erreur: 'Section indisponible',
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
  /** Personnages qui lancent un filet à chaque combat de capture (défaut 1). */
  accounts?: number
  /** Heures de jeu par jour (défaut 3) : passages aux enclos par jour du calendrier (`sessionsPerDayFor`). */
  hoursPerDay?: number
  /** Passage aux enclos toutes les N minutes (défaut 60) : durée minimale d'une étape de plan d'enclos. */
  checkIntervalMinutes?: number
  /** Doublement Almanax des jauges (non vérifié) appliqué aux plans et projections d'enclos (défaut : non). */
  almanaxGaugeDoubling?: boolean
}

/** Plan d'enclos démarré (structure de `usePaddockPlans().plans[n]`). */
export interface AdvisorPaddockPlan extends PlanSchedule {
  paddockId: number
  tier: FuelTier
  mountIds: string[]
  /** Paliers par jauge du plan (`FertilityPlan.tiers`) : projection des montures. */
  tiers?: Partial<Record<GaugeId, FuelTier>>
  rulesetId?: RulesetId
}

/** Enclos saisi (structure de `usePaddocks().paddocks[n]`) : heures de saisie par jauge et jauges actives successives. */
export interface AdvisorPaddock extends PaddockState {
  gaugeUpdatedAt?: Partial<Record<GaugeId, number>>
  activeHistory?: { at: number; active: GaugeId[] }[]
  /** Version des règles sous laquelle chaque niveau a été saisi (`usePaddocks().setGauge`). */
  gaugeRulesets?: Partial<Record<GaugeId, RulesetId>>
}

/** XP d'Éleveur enregistrée dans le journal depuis la dernière saisie du niveau (`journalJobXp(entries, settings.jobLevelUpdatedAt)`). */
export interface AdvisorJournalXp {
  xp: number
  captures?: number
  matings?: number
  crafts?: number
}

export interface AdvisorInput {
  now: number
  settings: AdvisorSettings
  rules: Ruleset
  mounts: Mount[]
  paddocks: AdvisorPaddock[]
  paddockPlans: Record<string, AdvisorPaddockPlan>
  priceCtx: PriceContext
  mountPrices: MountPriceContext
  /** Valeur d'un généton saisie (usePrices().genetonValue) ; défaut de la recherche sinon. */
  genetonValue?: number | null
  /** Nombre de prix d'objets saisis par le joueur (onboarding). */
  pricedItems?: number
  /** XP d'Éleveur du journal depuis la saisie du niveau : niveau estimé, XP jusqu'au prochain enclos. */
  journalXp?: AdvisorJournalXp | null
  /**
   * Simulation Monte-Carlo du programme vers l'objectif (`runProgram(goalProgramConfig(...))`), si elle
   * est disponible : les captures conseillées en sont tirées (calibrées), sinon le modèle analytique
   * (borne haute) est utilisé et annoncé comme tel.
   */
  goalSim?: ProgramSummary | null
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

/**
 * Durée d'un lot de fécondité typique (moyenne du planificateur d'enclos, `economy.batchProfile('typique')`) :
 * même hypothèse que la Rentabilité et la page Enclos, plutôt que le minimum théorique (`fertilitySeconds`).
 */
export function typicalBatchSeconds(tier: FuelTier, rules: Ruleset): number {
  return batchProfile('typique', tier, rules).seconds
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

/** Message lisible d'une exception (section de conseils indisponible). */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
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
 * Zone de capture conseillée : zone des données (`FAMILIES[f].captureZone`, strategy.md §2.1, DofusDB +
 * DPLN, confiance haute) pour toutes les familles, notes des monstres comprises (Dorée : uniquement ici).
 */
export function captureSpot(family: FamilyId): CaptureSpot | null {
  // Une seule source pour toutes les familles : la zone de capture des données (comme le Guide), avec
  // les notes par monstre (ex. « Dragodinde dorée sauvage : uniquement ici ») (R14).
  const z = FAMILIES[family]?.captureZone
  if (!z) return null
  const notes = z.monsters.filter((m) => m.note).map((m) => `${m.name} : ${m.note}`)
  const archi = z.monsters.filter((m) => m.archimonster).map((m) => m.name)
  if (archi.length) notes.push(`archimonstres : ${archi.join(', ')}`)
  return {
    subarea: z.subarea,
    area: z.area,
    x: z.xRange,
    y: z.yRange,
    zaap: z.nearestZaap.name,
    zaapCoords: z.nearestZaap.coords,
    confidence: 'high',
    ...(notes.length ? { note: notes.join(' ; ') } : {}),
  }
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

/** Montures capturées par combat : chaque personnage lance son filet (`settings.accounts`), × montures par lancer. */
export function capturesPerFight(accounts: number | undefined, mountsPerCast: number): number {
  const a = Number.isFinite(accounts) ? Math.max(1, Math.round(accounts as number)) : 1
  return a * Math.max(1, Math.round(mountsPerCast) || 1)
}

/**
 * Arrondi « au plus fort reste » : des entiers dont la somme est l'arrondi de la somme des valeurs,
 * chacun à moins de 1 de sa valeur. Évite qu'une série d'arrondis supérieurs gonfle le total (408
 * captures « restantes » pour un effort de 405,6).
 */
export function largestRemainder(values: readonly number[]): number[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0))
  const total = Math.round(clean.reduce((a, b) => a + b, 0) + 1e-9)
  const out = clean.map((v) => Math.floor(v + 1e-9))
  let rest = total - out.reduce((a, b) => a + b, 0)
  const order = clean.map((v, i) => ({ i, frac: v - Math.floor(v + 1e-9) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const o of order) {
    if (rest <= 0) break
    out[o.i]++
    rest--
  }
  return out
}

/** Effectifs de vos montures retenus pour une recette (sexes et porteuses pris en compte). */
export interface RecipeSupply {
  /** Exemplaires utilisables par espèce de la recette. */
  counts: Map<number, number>
  /** Monture → espèce de la recette qu'elle tient (une porteuse tient l'espèce qu'elle porte). */
  roles: Map<string, number>
  /** Explications (porteuses comptées, montures sans partenaire de sexe opposé), en français. */
  notes: string[]
}

/**
 * Montures possédées (fertiles ou fécondes) utiles à une recette :
 * - une **porteuse** (un parent de génération supérieure présent dans la recette, M-CARRIER-01) tient
 *   l'espèce qu'elle porte quand `breed()` confirme que, avec la partenaire du croisement de la recette,
 *   la génération cible est bien l'enfant visé (sinon elle compte pour sa propre espèce) ;
 * - **sexes** : pour un croisement x × y dont les deux espèces ne servent qu'à ce croisement, seuls les
 *   couples ♂/♀ possibles comptent pleinement ; si les montures restantes des deux couleurs sont du même
 *   sexe (deux mâles, par exemple), une seule couleur est comptée — il faudra produire l'autre avec le
 *   bon sexe.
 * Les effectifs servent d'`owned` à `expectedEffort` (couverture de la demande attendue, pas du
 * sous-arbre avec certitude).
 */
export function ownedRecipeSupply(tree: RecipeNode, mounts: readonly Mount[], opts: { rules?: Ruleset } = {}): RecipeSupply {
  const goalId = tree.speciesId
  const family = getSpecies(goalId)?.family
  const crossings = new Map<number, [number, number]>()
  const uses = new Map<number, { partner: number; child: number }[]>()
  const addUse = (x: number, use: { partner: number; child: number }) => uses.set(x, [...(uses.get(x) ?? []), use])
  const walk = (n: RecipeNode) => {
    if (!n.crossing || !n.parents || crossings.has(n.speciesId)) return
    const [x, y] = n.crossing
    crossings.set(n.speciesId, [x, y])
    addUse(x, { partner: y, child: n.speciesId })
    if (y !== x) addUse(y, { partner: x, child: n.speciesId })
    walk(n.parents[0])
    walk(n.parents[1])
  }
  walk(tree)
  const roles = new Map<string, number>()
  const notes: string[] = []
  const bySpecies = new Map<number, { male: number; femelle: number }>()
  for (const m of mounts) {
    if (!isUsable(m) || m.speciesId === goalId) continue
    const sp = getSpecies(m.speciesId)
    if (!sp || sp.family !== family) continue
    let role: number | null = null
    const carried = m.parents
      .slice(0, 2)
      .filter((p) => p !== goalId && uses.has(p) && genOf(p) > sp.generation)
      .sort((x, y) => genOf(y) - genOf(x))
    for (const x of carried) {
      for (const u of uses.get(x) ?? []) {
        try {
          const r = breed(toBreedingParent(m), cleanParent(u.partner, m.level), { rules: opts.rules })
          if (r.targetSpecies.includes(u.child)) {
            role = x
            notes.push(`${mountName(m)} (porteuse de ${nameOf(x)}) compte comme ${nameOf(x)} : avec ${nameOf(u.partner)}, elle vise ${nameOf(u.child)} (porteurs).`)
            break
          }
        } catch {
          // croisement impossible avec cet arbre : la monture compte pour sa propre espèce
        }
      }
      if (role !== null) break
    }
    if (role === null && uses.has(m.speciesId)) role = m.speciesId
    if (role === null) continue
    roles.set(m.id, role)
    const e = bySpecies.get(role) ?? { male: 0, femelle: 0 }
    e[m.gender]++
    bySpecies.set(role, e)
  }
  const counts = new Map<number, number>()
  for (const [id, e] of bySpecies) counts.set(id, e.male + e.femelle)
  for (const [x, y] of crossings.values()) {
    if (x === y || (uses.get(x)?.length ?? 0) !== 1 || (uses.get(y)?.length ?? 0) !== 1) continue
    const ex = bySpecies.get(x)
    const ey = bySpecies.get(y)
    if (!ex || !ey) continue
    const matched = Math.min(ex.male, ey.femelle) + Math.min(ex.femelle, ey.male)
    const lx = ex.male + ex.femelle - matched
    const ly = ey.male + ey.femelle - matched
    if (lx <= 0 || ly <= 0) continue
    const keepX = lx >= ly
    const drop = keepX ? y : x
    const dropped = keepX ? ly : lx
    counts.set(drop, matched)
    const sex = (keepX ? ey.male : ex.male) > matched ? 'mâle' : 'femelle'
    notes.push(
      `${nb(dropped, 'monture')} ${nameOf(drop)} sans partenaire de sexe opposé parmi vos ${nameOf(keepX ? x : y)} (${plural(dropped, sex, `${sex}s`)} des deux côtés) : une seule couleur compte, il faudra produire l'autre avec le bon sexe.`,
    )
  }
  return { counts, roles, notes }
}

/** Besoin de captures d'une couleur G1 pour l'objectif. */
export interface CaptureNeed {
  speciesId: number
  /** G1 de la recette idéale (1 exemplaire, chaque accouplement réussi). */
  idealTotal: number
  /** Part de la recette idéale que vos montures ne couvrent pas encore (si chaque accouplement réussit). */
  idealRemaining: number
  /** Captures attendues restantes (entier, arrondi au plus fort reste : Σ = arrondi du total). */
  expected: number
  /** Même valeur, non arrondie. */
  expectedRaw: number
  ownedMales: number
  ownedFemales: number
  /** Répartition conseillée des captures attendues pour équilibrer les sexes. */
  males: number
  females: number
}

export interface CaptureNeedsOptions {
  /** Effort depuis zéro (modèle analytique) : base de la calibration par la simulation. */
  full?: EffortEstimate | null
  /** Simulation Monte-Carlo du même programme : captures = restant analytique × (simulé / analytique depuis zéro), couleur par couleur. */
  sim?: ProgramSummary | null
  /** Effectifs possédés ajustés (sexes, porteuses) ; défaut : `ownedRecipeSupply(tree, mounts)`. */
  supply?: Map<number, number>
  rules?: Ruleset
}

/**
 * Captures restantes par couleur pour l'objectif.
 * - `idealRemaining` : recette idéale parcourue depuis la cible, une monture utile (sexes et porteuses
 *   comptés, `ownedRecipeSupply`) couvre son sous-arbre ; c'est le minimum si tout réussit.
 * - `expected` : effort attendu restant (`remaining`, `expectedEffort` avec vos montures en `owned` :
 *   un accouplement peut rater, un exemplaire du haut ne couvre pas tout son sous-arbre), calibré par
 *   la simulation Monte-Carlo si elle est fournie (sinon : modèle analytique = borne haute prudente),
 *   arrondi au plus fort reste. ESTIMATION.
 */
export function captureNeeds(tree: RecipeNode, mounts: readonly Mount[], remaining: EffortEstimate | null, opts: CaptureNeedsOptions = {}): CaptureNeed[] {
  const usable = mounts.filter(isUsable)
  const pool = new Map(opts.supply ?? ownedRecipeSupply(tree, mounts, { rules: opts.rules }).counts)
  const uncovered = new Map<number, number>()
  const walk = (n: RecipeNode) => {
    const have = pool.get(n.speciesId) ?? 0
    if (have > 0 && n.speciesId !== tree.speciesId) {
      pool.set(n.speciesId, have - 1)
      return
    }
    if (n.parents) {
      walk(n.parents[0])
      walk(n.parents[1])
      return
    }
    uncovered.set(n.speciesId, (uncovered.get(n.speciesId) ?? 0) + 1)
  }
  walk(tree)
  const ideal = [...capturesByColor(tree)]
  const simColors = opts.sim ? new Map(opts.sim.capturesByColor.map((c) => [c.speciesId, c.mean])) : null
  const fullTotal = opts.full?.captures ?? 0
  const simTotal = opts.sim?.metrics.captures.mean ?? 0
  const raw = ideal.map(([id]) => {
    if (!remaining) return uncovered.get(id) ?? 0
    let v = remaining.capturesByColor.get(id) ?? 0
    if (simColors && opts.full) {
      const f = opts.full.capturesByColor.get(id) ?? 0
      const sc = simColors.get(id)
      v *= f > 0 && sc !== undefined ? sc / f : fullTotal > 0 ? simTotal / fullTotal : 1
    }
    return v
  })
  const rounded = largestRemainder(raw)
  const out: CaptureNeed[] = ideal.map(([id, total], i) => {
    const expected = rounded[i]
    const ownedMales = usable.filter((m) => m.speciesId === id && m.gender === 'male').length
    const ownedFemales = usable.filter((m) => m.speciesId === id && m.gender === 'femelle').length
    const deficit = ownedFemales - ownedMales
    const males = Math.max(0, Math.min(expected, Math.round((expected + deficit) / 2)))
    return { speciesId: id, idealTotal: total, idealRemaining: uncovered.get(id) ?? 0, expected, expectedRaw: raw[i], ownedMales, ownedFemales, males, females: expected - males }
  })
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
  /** Effort attendu depuis zéro (modèle analytique : captures = borne haute prudente, voir genetics.md). */
  effort: EffortEstimate | null
  /** Effort attendu restant avec vos montures (modèle analytique, `owned`). */
  remaining: EffortEstimate | null
  /** Vos montures retenues pour la recette (sexes, porteuses). */
  supply: RecipeSupply | null
  captures: CaptureNeed[]
  /** Captures attendues restantes (somme des `expected`). */
  capturesRemaining: number
  /** Origine des captures conseillées : simulation Monte-Carlo (calibrée) ou modèle analytique (borne haute). */
  captureBasis: 'simulation' | 'analytique'
  /** Simulation appliquée (même objectif), ou null. */
  sim: ProgramSummary | null
  /** Part du programme qui reste (accouplements restants ÷ accouplements depuis zéro, modèle analytique), 0 … 1. */
  remainingShare: number
  error?: string
}

/** La simulation porte-t-elle sur cet objectif (et a-t-elle abouti au moins une fois) ? */
function simFor(goalId: number, sim: ProgramSummary | null | undefined): ProgramSummary | null {
  return sim && sim.config.targetSpeciesId === goalId && sim.runs > 0 && sim.successRate > 0 && sim.capturesByColor.length > 0 ? sim : null
}

/**
 * Où en est l'objectif : recette, effort attendu depuis zéro et restant avec vos montures (sexes et
 * porteuses compris, couverture probabiliste), captures restantes par couleur — calibrées par la
 * simulation Monte-Carlo `sim` si elle est fournie, sinon modèle analytique (borne haute).
 */
export function goalStatus(goalId: number, mounts: readonly Mount[], opts: StrategyOptions & { sim?: ProgramSummary | null }): GoalStatus | null {
  const s = getSpecies(goalId)
  if (!s) return null
  const owned = mounts.filter((m) => m.speciesId === goalId).length
  const tree = s.breedable ? cheapestRecipe(goalId) : null
  let effort: EffortEstimate | null = null
  let remaining: EffortEstimate | null = null
  let supply: RecipeSupply | null = null
  let error: string | undefined
  if (!tree) error = `${s.name} ne s'obtient pas par élevage.`
  else
    try {
      const eo = strategyEffortOptions(opts)
      effort = expectedEffort(goalId, eo)
      supply = ownedRecipeSupply(tree, mounts, { rules: opts.rules })
      remaining = supply.counts.size ? expectedEffort(goalId, { ...eo, owned: supply.counts }) : effort
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  const base: GoalStatus = {
    speciesId: goalId,
    name: s.name,
    family: s.family,
    generation: s.generation,
    owned,
    reached: owned > 0,
    tree,
    effort,
    remaining,
    supply,
    captures: [],
    capturesRemaining: 0,
    captureBasis: 'analytique',
    sim: null,
    remainingShare: owned > 0 ? 0 : effort && remaining && effort.matings > 0 ? Math.max(0, Math.min(1, remaining.matings / effort.matings)) : 1,
    error,
  }
  return withGoalSimulation(base, mounts, opts.sim ?? null, opts.rules)
}

/**
 * Applique (ou retire) la simulation Monte-Carlo à un état d'objectif déjà calculé : captures par
 * couleur recalculées (calibrées si `sim` porte sur cet objectif). Léger : à appeler quand la
 * simulation arrive, sans refaire l'analyse.
 */
export function withGoalSimulation(goal: GoalStatus, mounts: readonly Mount[], sim: ProgramSummary | null | undefined, rules?: Ruleset): GoalStatus
export function withGoalSimulation(goal: GoalStatus | null, mounts: readonly Mount[], sim: ProgramSummary | null | undefined, rules?: Ruleset): GoalStatus | null
export function withGoalSimulation(goal: GoalStatus | null, mounts: readonly Mount[], sim: ProgramSummary | null | undefined, rules?: Ruleset): GoalStatus | null {
  if (!goal) return null
  const used = simFor(goal.speciesId, sim)
  if (!goal.tree || goal.reached || goal.error) return { ...goal, captures: [], capturesRemaining: 0, sim: used, captureBasis: used ? 'simulation' : 'analytique' }
  const captures = captureNeeds(goal.tree, mounts, goal.remaining, { full: goal.effort, sim: used, supply: goal.supply?.counts, rules })
  return {
    ...goal,
    captures,
    capturesRemaining: captures.reduce((n, c) => n + c.expected, 0),
    captureBasis: used ? 'simulation' : 'analytique',
    sim: used,
  }
}

// ---------- Calendrier (simulation du programme) ----------

/**
 * Passages aux enclos par jour selon le temps de jeu (`settings.hoursPerDay`), pour la simulation du
 * calendrier (une session = un cycle) : moins d'1 h → 1 ; 1 à 4 h → 2 (matin et soir, valeur de la
 * recherche) ; 4 à 8 h → 3 ; 8 h et plus → 4. Hypothèse documentée (ESTIMATION) : les jauges tournent
 * 24 h sur 24, seul le nombre de passages limite le rythme.
 */
export function sessionsPerDayFor(hoursPerDay: number | undefined): number {
  const h = hoursPerDay ?? 3
  if (!Number.isFinite(h)) return 2
  if (h < 1) return 1
  if (h < 4) return 2
  if (h < 8) return 3
  return 4
}

/** Configuration de la simulation Monte-Carlo de la stratégie conseillée vers l'objectif (Plan, Accueil). */
export function goalProgramConfig(
  settings: Pick<AdvisorSettings, 'goalSpeciesId' | 'parentTargetLevel' | 'useOptimakina' | 'preferredTier' | 'jobLevel' | 'hoursPerDay'>,
  rules: Ruleset,
  opts: { runs?: number } = {},
): ProgramConfig | null {
  if (settings.goalSpeciesId === null) return null
  const sp = getSpecies(settings.goalSpeciesId)
  if (!sp || !sp.breedable || !cheapestRecipe(sp.id)) return null
  return {
    targetSpeciesId: sp.id,
    parentLevel: Math.max(1, Math.min(200, Math.round(settings.parentTargetLevel))),
    makina: settings.useOptimakina ? { fromGeneration: OPTIMAKINA_SYSTEMATIC_GENERATION } : 'none',
    cloning: true,
    paddocks: unlockedPaddocks(settings.jobLevel),
    tier: settings.preferredTier,
    batchSize: PADDOCK_SLOTS,
    rules,
    maxDays: 730,
    runs: opts.runs ?? 24,
    seed: 1,
    sessionsPerDay: sessionsPerDayFor(settings.hoursPerDay),
  }
}

/** Empreinte d'une configuration de simulation (cache partagé entre le Plan et l'Accueil). */
export function programConfigKey(cfg: ProgramConfig): string {
  return JSON.stringify([cfg.targetSpeciesId, cfg.parentLevel, cfg.levelByGeneration ?? null, cfg.makina, cfg.cloning, cfg.paddocks, cfg.tier, cfg.batchSize, cfg.rules.id, cfg.maxDays, cfg.runs, cfg.seed ?? 1, cfg.sessionsPerDay ?? 2])
}

/** Ce qui reste du programme depuis votre étable (calendrier du Plan). */
export interface RemainingProgram {
  /** Part restante du programme (accouplements analytiques restants ÷ depuis zéro). */
  share: number
  /** Captures restantes conseillées (`goal.capturesRemaining`). */
  captures: number
  /** Accouplements restants : simulation × part restante (ou modèle analytique sans simulation). */
  matings: number
  /** Jours restants en jeu optimal : simulation × part restante, au moins un cycle de fécondation s'il reste des accouplements ; null sans simulation. */
  days: { mean: number; p10: number; p90: number } | null
  basis: 'simulation' | 'analytique'
}

/**
 * Programme restant depuis l'étable actuelle. La simulation part de zéro (elle ne connaît pas vos
 * montures) : ses durées et accouplements sont ramenés à la part du programme qui reste d'après le
 * modèle analytique (`goal.remainingShare`). ESTIMATION : à afficher comme telle.
 */
export function remainingProgram(goal: GoalStatus, sim?: ProgramSummary | null): RemainingProgram | null {
  if (!goal.effort || !goal.remaining) return null
  const used = simFor(goal.speciesId, sim ?? goal.sim)
  const share = goal.reached ? 0 : goal.remainingShare
  if (!used) return { share, captures: goal.capturesRemaining, matings: goal.reached ? 0 : goal.remaining.matings, days: null, basis: 'analytique' }
  const d = used.metrics.days
  const floor = share > 0 ? used.fecundationCycles / Math.max(1, used.config.sessionsPerDay) : 0
  const scale = (v: number) => (share > 0 ? Math.max(floor, v * share) : 0)
  return {
    share,
    captures: goal.capturesRemaining,
    matings: used.metrics.matings.mean * share,
    days: { mean: scale(d.mean), p10: scale(d.p10), p90: scale(d.p90) },
    basis: 'simulation',
  }
}

// ---------- Métier ----------

export interface JobStatus {
  /** Niveau saisi (réglages). */
  level: number
  /** Niveau estimé = niveau saisi + XP du journal depuis la saisie (plancher : bonus Almanax non comptés). */
  estimatedLevel: number
  /** XP d'Éleveur enregistrée dans le journal depuis la saisie du niveau (0 sans journal). */
  xpGained: number
  /** Prochain niveau qui débloque un enclos (200 au plus), depuis le niveau estimé. */
  nextPaddockLevel: number
  /** Numéro de l'enclos débloqué à ce niveau. */
  nextPaddockIndex: number
  /** XP restante jusqu'au prochain enclos (XP du journal déduite). */
  xpToNext: number
  /** Avancement (0 … 1) entre le dernier enclos débloqué et le suivant. */
  progress: number
  /** Le niveau estimé débloque un enclos que le niveau saisi ne débloque pas : mettre à jour les réglages. */
  paddockUnlockedSinceEntry: boolean
  nextMilestone: JobMilestoneDef | null
  plan: LevelingPlan | null
  bestNow: CraftChoice | null
  /** Prochains jours Almanax utiles au métier (≤ 30 jours). */
  almanax: JobAlmanaxDay[]
  /** Plan de montée ou meilleur craft impossible à calculer (message), sinon absent. */
  error?: string
}

/**
 * Niveau d'Éleveur estimé : niveau saisi + XP du journal depuis la saisie (`journalJobXp`). Plancher :
 * les bonus Almanax non enregistrés ne sont pas comptés ; jamais en dessous du niveau saisi.
 */
export function estimatedJobLevel(jobLevel: number, xpGained: number | undefined): number {
  const level = Math.max(1, Math.min(200, Math.floor(jobLevel)))
  const xp = Math.max(0, Number.isFinite(xpGained) ? (xpGained as number) : 0)
  return Math.max(level, Math.min(200, jobLevelFromXp(jobXpForLevel(level) + xp)))
}

/**
 * Où en est le métier : prochain enclos, XP restante, plan de montée. `xpGained` = XP d'Éleveur du
 * journal depuis la dernière saisie du niveau (`journalJobXp(entries, settings.jobLevelUpdatedAt).xp`) :
 * elle est déduite de l'XP restante et donne le niveau estimé.
 */
export function jobStatus(
  jobLevel: number,
  ctx: PriceContext,
  rules: Ruleset,
  opts: { family?: FamilyId; todayIso: string; withPlan?: boolean; xpGained?: number },
): JobStatus {
  const level = Math.max(1, Math.min(200, Math.floor(jobLevel)))
  const xpGained = Math.max(0, Math.floor(Number.isFinite(opts.xpGained) ? (opts.xpGained as number) : 0))
  const totalXp = jobXpForLevel(level) + xpGained
  const estimatedLevel = estimatedJobLevel(level, xpGained)
  const next = nextPaddockTarget(estimatedLevel)
  const prev = [...PADDOCK_UNLOCK_LEVELS].reverse().find((p) => p.level <= estimatedLevel)?.level ?? 1
  const nextIndex = Math.max(1, PADDOCK_UNLOCK_LEVELS.findIndex((p) => p.level === next) + 1)
  const span = jobXpForLevel(next) - jobXpForLevel(prev)
  const almanax = jobAlmanaxDays(opts.todayIso).filter((d) => d.daysUntil <= 30)
  const todayBonus = almanax.find((d) => d.daysUntil === 0)?.xpBonus ?? 0
  const milestones = jobMilestones({ family: opts.family })
  const startXp = Math.max(0, totalXp - jobXpForLevel(estimatedLevel))
  let plan: LevelingPlan | null = null
  let bestNow: CraftChoice | null = null
  let error: string | undefined
  if (estimatedLevel < 200) {
    try {
      bestNow = bestCraftAt(estimatedLevel, ctx, rules, 'kamas', { includeCaptures: true, almanaxXpBonus: todayBonus })
      if (opts.withPlan !== false)
        plan = levelingPlan(estimatedLevel, next, ctx, { rules, metric: 'kamas', includeCaptures: true, family: opts.family, almanaxXpBonus: todayBonus, startXp })
    } catch (e) {
      // Section signalée (`error`, puis « section indisponible » à l'accueil), jamais avalée en silence.
      error = errorMessage(e)
      plan = null
    }
  }
  return {
    level,
    estimatedLevel,
    xpGained,
    nextPaddockLevel: next,
    nextPaddockIndex: nextIndex,
    xpToNext: estimatedLevel >= 200 ? 0 : Math.max(0, jobXpForLevel(next) - totalXp),
    progress: estimatedLevel >= 200 ? 1 : span > 0 ? Math.max(0, Math.min(1, (totalXp - jobXpForLevel(prev)) / span)) : 0,
    paddockUnlockedSinceEntry: unlockedPaddocks(estimatedLevel) > unlockedPaddocks(level),
    nextMilestone: milestones.find((m) => m.level > estimatedLevel && m.kind !== 'makina') ?? null,
    plan,
    bestNow,
    almanax,
    error,
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
      text: `Lot complet (≈ 2 phases + traversée de 0) : ≈ ${formatDuration(typicalBatchSeconds(1, rules))} au palier 1, ≈ ${formatDuration(typicalBatchSeconds(tier, rules))} au palier ${tier} (votre réglage) pour un lot typique du planificateur d'enclos (minimum théorique ≈ ${formatDuration(fertilitySeconds(tier, rules))}). Palier 4 seulement en étant présent.`,
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

/** Section de conseils (calcul de l'analyse ou générateur de `adviseNow`). */
export type AdvisorSection =
  | 'summary'
  | 'pairs'
  | 'fates'
  | 'assignment'
  | 'goal'
  | 'job'
  | 'costs'
  | 'onboarding'
  | 'alarms'
  | 'gauges'
  | 'almanax'
  | 'mating'
  | 'exits'
  | 'placement'
  | 'captures'
  | 'prices'

export const ADVISOR_SECTION_LABELS: Record<AdvisorSection, string> = {
  summary: 'résumé de l’étable',
  pairs: 'plan d’accouplement',
  fates: 'sort des montures',
  assignment: 'répartition en enclos',
  goal: 'objectif et captures',
  job: 'métier (plan de montée)',
  costs: 'coûts (fécondation, XP, filets)',
  onboarding: 'premiers pas',
  alarms: 'alarmes des plans d’enclos',
  gauges: 'jauges et carburant',
  almanax: 'Almanax',
  mating: 'conseils d’accouplement',
  exits: 'clonages et sorties',
  placement: 'placement en enclos',
  captures: 'captures',
  prices: 'prix manquants',
}

/** Section qui n'a pas pu être calculée : affichée « section indisponible », jamais masquée en silence. */
export interface AdvisorSectionError {
  section: AdvisorSection
  label: string
  message: string
}

/** Monture utile à l'objectif dont la partenaire du plan est encore en préparation (fertile). */
export interface WaitingPartner {
  mountId: string
  partnerId: string
  /** Espèces visées par le couple de l'objectif. */
  targetSpecies: number[]
}

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
  /** Montures de l'objectif mises de côté : attendre que leur partenaire soit féconde (`PairSuggestion.waitFor`). */
  waiting: WaitingPartner[]
  assignment: AssignResult | null
  /** Places d'enclos libres après la répartition conseillée. */
  freeSlots: number
  goal: GoalStatus | null
  capture: CaptureStatus
  job: JobStatus
  fertility: FertilityCost | null
  genetonValue: number
  /** Génétons attendus du plan d'accouplement (Σ `result.expectedGenetons`, bébés compris). */
  expectedGenetons: number
  /** XP d'Éleveur du plan d'accouplement. */
  matingJobXp: number
  missingPrices: MissingPrice[]
  /** Montures dont aucune sortie n'est chiffrée. */
  unpricedMounts: number
  /** Sections qui n'ont pas pu être calculées (message), à afficher. */
  errors: AdvisorSectionError[]
}

/** Fonctions économiques communes (valorisations mises en cache, C_eff de la règle de prix). */
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
  // Montée de niveau des montures de surplus : coût du lot réel (montures montées ensemble, fourni par
  // recommendFates), au palier de Mangeoire le moins cher entre le palier 1 (Extraits, C-BREAK-01) et
  // le palier préféré — même calcul que la page Montures.
  const levelCost: LevelCostFn = (from, to, m, batchSize) => {
    const tiers: FuelTier[] = settings.preferredTier === 1 ? [1] : [1, settings.preferredTier]
    let best: ReturnType<LevelCostFn> | null = null
    for (const tier of tiers) {
      const c = levelingCost(from, to, { tier, batchSize, sage: m.ability === 'sage', ctx, rules, jobLevel: settings.jobLevel })
      const option = { cost: c.costPerMount, complete: c.complete, seconds: c.secondsPerBatch, tier, batchSize }
      if (!best || (option.complete && option.cost !== null && (!best.complete || best.cost === null || option.cost < best.cost))) best = option
    }
    return best ?? { cost: null, complete: false }
  }
  const mountValue = (id: number, level: number) => valuationOf(id, level, 'fertile', false).best
  // C_eff (règle de prix de l'Optimakina, M-OPTI-01) : mêmes paramètres que la page Accouplement.
  const coupleCost = economyCoupleCost({ ctx, mountPrices, saleTax: settings.saleTax, rules, jobLevel: settings.jobLevel, tier: settings.preferredTier })
  return { valuation, levelCost, mountValue, coupleCost }
}

function emptySummary(total: number): InventorySummary {
  return {
    total,
    byFamily: { dragodinde: 0, muldo: 0, volkorne: 0 },
    byStatus: { fertile: 0, feconde: 0, sterile: 0, senile: 0 },
    byGeneration: new Map(),
    fecundPairs: 0,
    fecundInPaddock: 0,
    paddock: new Map(),
    stable: 0,
    inventory: 0,
  }
}

/** Montures de l'objectif écartées du plan faute de partenaire prête (`waitFor` des couples classés). */
function collectWaiting(ranked: PairSuggestion[], plan: PairSuggestion[]): WaitingPartner[] {
  const inPlan = new Set(plan.flatMap((p) => [p.a.id, p.b.id]))
  const out = new Map<string, WaitingPartner>()
  for (const p of ranked)
    for (const w of p.waitFor)
      if (!inPlan.has(w.mountId) && !inPlan.has(w.partnerId) && !out.has(w.mountId)) out.set(w.mountId, { mountId: w.mountId, partnerId: w.partnerId, targetSpecies: w.targetSpecies })
  return [...out.values()]
}

/**
 * Calculs lourds de l'aide (plan d'accouplement, sort des montures, répartition en enclos, objectif,
 * métier, prix manquants). Ne dépend de `now` que par le jour (Almanax) : la page le mémorise
 * (`analyzeStateCached`) et rappelle `adviseNow` toutes les 30 s avec le même résultat. Une section qui
 * échoue est notée dans `errors` (et affichée), les autres restent calculées.
 */
export function analyzeState(input: AdvisorInput): AdvisorAnalysis {
  const { settings, rules, mounts, priceCtx: ctx } = input
  const errors: AdvisorSectionError[] = []
  const fail = (section: AdvisorSection, e: unknown) => {
    console.error('[conseiller]', section, e)
    errors.push({ section, label: ADVISOR_SECTION_LABELS[section], message: errorMessage(e) })
  }
  const day = serverDay(input.now) // jour de jeu (Paris) : Almanax, Takeza
  const almanax = almanaxOn(day)
  const unlocked = unlockedPaddocks(settings.jobLevel)
  let summary: InventorySummary
  try {
    summary = inventorySummary(mounts)
  } catch (e) {
    fail('summary', e)
    summary = emptySummary(mounts.length)
  }
  const genetonValue = genetonKamasValue(input.genetonValue ?? null).value
  const kit = economyKit(input)
  const missing = new MissingCollector()

  // 1. Plan d'accouplement d'abord : le sort des montures en dépend (une monture prévue au plan
  //    n'est jamais conseillée en sortie avant l'accouplement).
  let pairs: PairSuggestion[] = []
  let pairCandidates = 0
  let waiting: WaitingPartner[] = []
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
        coupleCost: kit.coupleCost.cost,
      })
      pairCandidates = ranked.length
      pairs = bestDisjointPairs(ranked)
      waiting = collectWaiting(ranked, pairs)
    } catch (e) {
      fail('pairs', e)
    }

  // 2. Sort des montures, avec le plan retenu (« Accoupler (plan) puis … »).
  const plannedPartners = new Map<string, string>()
  for (const p of pairs) {
    plannedPartners.set(p.a.id, p.b.id)
    plannedPartners.set(p.b.id, p.a.id)
  }
  let fates = new Map<string, MountFate>()
  if (mounts.length)
    try {
      fates = recommendFates({
        inventory: mounts,
        goalSpeciesId: settings.goalSpeciesId,
        rules,
        valuation: kit.valuation,
        levelCost: kit.levelCost,
        genetonValue,
        plannedPartners,
        goal: settings.goal,
      })
    } catch (e) {
      fail('fates', e)
    }

  // 3. Répartition en enclos (mêmes options que la page Enclos).
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
        almanaxDoubled: settings.almanaxGaugeDoubling ? (almanax?.doubledGauge ?? null) : null,
        startMs: input.now,
        applyAlmanax: !!settings.almanaxGaugeDoubling,
        levelTarget: settings.parentTargetLevel,
        xpTargets,
        keepCurrent: true,
        minStepSeconds: Math.max(5, settings.checkIntervalMinutes ?? 60) * 60,
      })
    } catch (e) {
      fail('assignment', e)
    }
  const used = assignment
    ? assignment.paddocks.reduce((n, p) => n + p.mountIds.length, 0)
    : mounts.filter((m) => m.location.kind === 'enclos' && m.location.paddock <= unlocked).length
  const freeSlots = Math.max(0, unlocked * PADDOCK_SLOTS - used)

  // 4. Objectif (effort restant avec vos montures ; la simulation est appliquée par `adviseNow`).
  let goal: GoalStatus | null = null
  if (settings.goalSpeciesId !== null)
    try {
      goal = goalStatus(settings.goalSpeciesId, mounts, { parentLevel: settings.parentTargetLevel, useOptimakina: settings.useOptimakina, rules })
      if (goal?.error && goal.tree) fail('goal', goal.error)
    } catch (e) {
      fail('goal', e)
    }
  const capture = captureStatus(goal?.family ?? settings.family, settings.jobLevel, ctx)
  const job = jobStatus(settings.jobLevel, ctx, rules, { family: settings.family, todayIso: day, xpGained: input.journalXp?.xp })
  if (job.error) fail('job', job.error)
  let fertility: FertilityCost | null = null
  try {
    fertility = fertilityCost({ tier: settings.preferredTier, batchSize: PADDOCK_SLOTS, ctx, rules, jobLevel: settings.jobLevel })
    missing.add(fertility.complete ? [] : fertility.missing, `fécondation au palier ${settings.preferredTier}`, 3)
    const lvl = levelingCost(1, settings.parentTargetLevel, { tier: settings.preferredTier, batchSize: PADDOCK_SLOTS, ctx, rules, jobLevel: settings.jobLevel })
    missing.add(lvl.complete ? [] : lvl.missing, `XP des parents (Mangeoire, niveau ${settings.parentTargetLevel})`, 2)
  } catch (e) {
    fail('costs', e)
  }
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
    waiting,
    assignment,
    freeSlots,
    goal,
    capture,
    job,
    fertility,
    genetonValue,
    // `result.expectedGenetons` compte déjà les bébés (genetics.ts) : jamais × babies une 2e fois.
    expectedGenetons: pairs.reduce((n, p) => n + p.result.expectedGenetons, 0),
    matingJobXp: pairs.reduce((n, p) => n + p.result.jobXp, 0),
    missingPrices: missing.list(),
    unpricedMounts,
    errors,
  }
}

// ---------- Cache de l'analyse (accueil) ----------

interface AnalysisCacheEntry {
  input: AdvisorInput
  day: string
  value: AdvisorAnalysis
}

let analysisCache: AnalysisCacheEntry | null = null
const analysisCounters = { computed: 0, hits: 0 }

function shallowEqual(a: object | null | undefined, b: object | null | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const ka = Object.keys(a) as (keyof typeof a)[]
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.is(a[k], (b as typeof a)[k]))
}

/** Les entrées de l'analyse sont-elles les mêmes (références des données des stores, jour) ? */
function sameAnalysisInput(x: AdvisorInput, y: AdvisorInput): boolean {
  return (
    x.rules === y.rules &&
    x.mounts === y.mounts &&
    shallowEqual(x.settings, y.settings) &&
    shallowEqual(x.priceCtx, y.priceCtx) &&
    shallowEqual(x.mountPrices, y.mountPrices) &&
    Object.is(x.genetonValue ?? null, y.genetonValue ?? null) &&
    Object.is(x.journalXp?.xp ?? 0, y.journalXp?.xp ?? 0)
  )
}

/**
 * `analyzeState` mémorisé (dernier résultat) : le même objet est rendu tant que le jour et les données
 * (mêmes références de stores : montures, réglages, prix, règles) n'ont pas changé. L'accueil ne refait
 * donc pas ≈ 0,5 s de calcul à chaque visite. Les plans d'enclos et niveaux de jauges n'entrent pas dans
 * l'analyse (ils sont lus par `adviseNow`).
 */
export function analyzeStateCached(input: AdvisorInput): AdvisorAnalysis {
  const day = serverDay(input.now)
  if (analysisCache && analysisCache.day === day && sameAnalysisInput(analysisCache.input, input)) {
    analysisCounters.hits++
    return analysisCache.value
  }
  analysisCounters.computed++
  const value = analyzeState(input)
  analysisCache = { input, day, value }
  return value
}

/** Compteurs du cache (tests, diagnostic) : analyses calculées et réutilisées. */
export function analysisCacheStats(): { computed: number; hits: number } {
  return { ...analysisCounters }
}

/** Vide le cache de l'analyse (tests). */
export function clearAnalysisCache(): void {
  analysisCache = null
  analysisCounters.computed = 0
  analysisCounters.hits = 0
}

// ---------- Générateurs de conseils ----------

interface Ctx {
  input: AdvisorInput
  a: AdvisorAnalysis
  now: number
  byId: Map<string, Mount>
  missing: MissingCollector
  /** Objectif avec la simulation Monte-Carlo appliquée (`withGoalSimulation`), ou celui de l'analyse. */
  goal: GoalStatus | null
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

function goalAdvice({ input, goal }: Ctx): Advice[] {
  const s = input.settings
  const out: Advice[] = []
  if (goal?.reached)
    out.push({
      id: `objectif:atteint:${goal.speciesId}`,
      priority: 2,
      category: 'objectif',
      title: `Objectif atteint : ${goal.name} !`,
      detail: `Vous possédez ${nb(goal.owned, 'exemplaire')} de ${goal.name}. Choisissez la prochaine monture visée (génération suivante, autre couleur pour les succès) ou passez en « rentabilité maximale ».`,
      link: { page: 'plan', label: 'Choisir le prochain objectif' },
    })
  else if (goal?.error)
    out.push({
      id: `objectif:erreur:${goal.speciesId}`,
      priority: 3,
      category: 'objectif',
      title: `Objectif à revoir : ${goal.name}`,
      detail: goal.error,
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
    const st = planStatus(plan, now)
    const pr = st.progress
    const link: AdviceLink = { page: 'enclos', params: { enclos: N }, label: `Voir l'enclos ${N}` }
    if (st.state === 'finished' || st.state === 'end-overdue') {
      // Plan terminé : l'inventaire ne sait pas que le lot est fécond (rien n'est écrit tant que le
      // joueur n'a pas « appliqué au lot ») — on ne propose ni « démarrer » ni recharge pour cet enclos.
      let fecund = 0
      try {
        fecund = projectMountsFromPlan(plan, input.mounts, now, { rules: input.rules, almanax: input.settings.almanaxGaugeDoubling ? undefined : false }).fecundIds.length
      } catch {
        fecund = 0
      }
      const total = plan.mountIds.filter((id) => input.mounts.some((m) => m.id === id)).length
      const inside = input.mounts.filter((m) => m.location.kind === 'enclos' && m.location.paddock === N).length
      out.push({
        id: `plan-fini:${N}:${plan.startedAt}`,
        priority: total || inside ? 2 : 4,
        category: 'enclos',
        title: total ? `Enclos ${N} : plan terminé — appliquez-le au lot` : `Enclos ${N} : plan terminé`,
        detail: [
          st.state === 'end-overdue' ? `${st.reason ?? 'Fin du plan non validée.'}` : '',
          total
            ? `≈ ${nb(fecund, 'féconde')} sur ${nb(total, 'monture')} d'après le plan (estimation). Dans la page Enclos, « Appliquer au lot » enregistre leur état (E/M/A, sérénité, niveau gagné) et range les fécondes à l'étable ; le plan d'accouplement les prendra alors en compte. Arrêtez ensuite le plan et lancez un nouveau lot.`
            : inside
              ? `Le lot est fécond : sortez les fécondes vers l'étable (accouplement depuis l'étable), arrêtez le plan dans la page Enclos, puis lancez un nouveau lot. ${nb(inside, 'monture')} encore dans l'enclos.`
              : "Le plan est terminé : arrêtez-le dans la page Enclos et lancez un nouveau lot.",
        ]
          .filter(Boolean)
          .join(' '),
        link: { page: 'enclos', params: { enclos: N }, label: total ? 'Appliquer au lot' : `Voir l'enclos ${N}` },
        items: total
          ? [
              { id: 'couper', text: 'Couper toutes les jauges de l’enclos' },
              { id: 'appliquer', text: `Appliquer au lot (${nb(total, 'monture')})`, link: { page: 'enclos', params: { enclos: N }, label: 'Enclos' } },
            ]
          : undefined,
        confidence: 'medium',
      })
      continue
    }
    const next = pr.next
    if (!next) continue
    const clock = formatClock(next.at, now)
    if (st.state === 'stale') {
      // Plan dépassé : la suite ne vaut plus (des montures ont pu sortir de leur zone) — jamais « faites-le
      // tout de suite » ni « Fait » : relever les sérénités et recalculer.
      const n = plan.mountIds.length
      out.push({
        id: `plan-depasse:${N}:${plan.startedAt}:${next.index}`,
        priority: 1,
        category: 'alarme',
        title: `Enclos ${N} : plan dépassé — relevez les sérénités et recalculez`,
        detail: `${st.reason ?? `Changement prévu à ${clock}, non fait.`} Coupez la jauge de sérénité, relevez les smileys (ou sérénités) des ${nb(n, 'monture')} dans la page Enclos, puis « Recalculer depuis l'état actuel » : un nouveau plan repart de leur état réel.`,
        dueAt: next.at,
        horizon: 'maintenant',
        link: { page: 'enclos', params: { enclos: N }, label: 'Relever et recalculer' },
        items: [
          { id: 'couper', text: 'Couper la jauge de sérénité (Baffeur ou Caresseur)' },
          { id: 'relever', text: `Relever la sérénité des ${nb(n, 'monture')}` },
          { id: 'recalculer', text: 'Recalculer le plan depuis l’état actuel', link },
        ],
      })
      continue
    }
    const ms = next.at - now
    const serenity = next.from.some((g) => g === 'baffeur' || g === 'caresseur')
    const priority: AdvicePriority = pr.due || ms <= 30 * MIN ? 1 : ms <= 3 * HOUR ? 2 : 3
    const parts: string[] = []
    if (pr.due)
      parts.push(
        pr.late && next.latest !== null
          ? `En retard : prévu à ${clock}, la fenêtre s'est fermée à ${formatClock(next.latest, now)} — des montures risquent de sortir de leur zone de sérénité. Faites-le tout de suite${
              st.staleAt !== null ? ` (au-delà de ${formatClock(st.staleAt, now)}, le plan sera dépassé : il faudra relever les sérénités et recalculer)` : ''
            }.`
          : `Prévu à ${clock} (${relativeTime(next.at, now)}).`,
      )
    else parts.push(`Prévu à ${clock} (${relativeTime(next.at, now)}).`)
    if (next.earliest !== null && next.latest !== null) parts.push(`Fenêtre de changement : ${formatClock(next.earliest, now)} → ${formatClock(next.latest, now)}.`)
    if (serenity) parts.push("Une jauge de sérénité continue de pousser toutes les montures jusqu'à ±5 000 : coupez-la à l'heure (à distance).")
    const purpose = plan.steps[next.index]?.purpose
    if (next.final) parts.push("Fin du plan : les montures sont fécondes ; coupez les jauges, puis « Appliquer au lot » (page Enclos) pour les enregistrer fécondes et les ranger à l'étable.")
    else if (purpose) parts.push(`Étape suivante : ${purpose.charAt(0).toLowerCase()}${purpose.slice(1)}.`)
    const items: AdviceItem[] = [
      ...next.from.filter((g) => !next.to.includes(g)).map((g) => ({ id: `off-${g}`, text: `Désactiver ${GAUGE_LABELS[g]}` })),
      ...next.to.filter((g) => !next.from.includes(g)).map((g) => ({ id: `on-${g}`, text: `Activer ${GAUGE_LABELS[g]}` })),
    ]
    if (next.final) items.push({ id: 'appliquer', text: 'Enregistrer le lot fécond (« Appliquer au lot », page Enclos)', link: { ...link, label: 'Appliquer au lot' } })
    out.push({
      id: `alarme:${N}:${plan.startedAt}:${next.index}`,
      priority,
      category: 'alarme',
      title: pr.due ? `Enclos ${N} : ${next.text}` : `Enclos ${N} à ${clock} : ${next.text}`,
      detail: parts.join(' '),
      dueAt: next.at,
      window: next.earliest !== null && next.latest !== null ? { earliest: next.earliest, latest: next.latest } : undefined,
      link,
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

/** Retard (s) en dessous duquel passer sous le palier du plan ne justifie pas une recharge (≈ un quart d'heure). */
const NEGLIGIBLE_DELAY_S = 15 * 60

function gaugeAdvice({ input, a, now, missing }: Ctx): Advice[] {
  const out: Advice[] = []
  const { rules, settings, priceCtx: ctx } = input
  const fuelOpts = { jobLevel: settings.jobLevel, rules }
  // Doublement Almanax (non vérifié) : seulement si le réglage est coché, comme la page Enclos.
  const doubling = !!settings.almanaxGaugeDoubling
  const doubled = doubling ? (a.almanax?.doubledGauge ?? null) : null
  const max = gaugeMax(rules)
  for (const p of input.paddocks) {
    if (p.id > a.unlocked || p.active.length === 0) continue
    if (validateActiveGauges(p.active) !== null) continue
    const N = p.id
    const plan = input.paddockPlans[String(N)] ?? null
    // Plan terminé (ou fin non validée) : le conseil « Appliquer au lot » couvre l'enclos (tout couper) ;
    // ni recharge ni « jauge vide » pour un lot déjà fécond.
    if (plan) {
      const state = planStatus(plan, now).state
      if (state === 'finished' || state === 'end-overdue') continue
    }
    const planRunning = plan
    const inside = input.mounts.filter((m) => m.location.kind === 'enclos' && m.location.paddock === N)
    const link: AdviceLink = { page: 'enclos', params: { enclos: N }, label: `Voir l'enclos ${N}` }
    // Heures de saisie jauge par jauge (une jauge non ressaisie n'est pas « rajeunie »), comme la page Enclos.
    const gaugeUpdatedAt: Partial<Record<GaugeId, number>> = {}
    for (const g of GAUGE_IDS) {
      const t = p.gaugeUpdatedAt?.[g]
      const at = typeof t === 'number' && t > 0 ? t : p.updatedAt
      if (at > 0) gaugeUpdatedAt[g] = at
    }
    const activeStamps = p.active.map((g) => gaugeUpdatedAt[g] ?? 0).filter((t) => t > 0)
    const oldest = activeStamps.length ? Math.min(...activeStamps) : 0
    if (oldest > 0 && now - oldest > 3 * DAY) {
      out.push({
        id: `jauges-anciennes:${N}:${oldest}`,
        priority: 3,
        category: 'enclos',
        title: `Enclos ${N} : mettez à jour les niveaux de jauges`,
        detail: `Saisis ${relativeTime(oldest, now)} : trop ancien pour prévoir les recharges. Recopiez les valeurs affichées en jeu.`,
        link,
      })
      continue
    }
    // Niveaux saisis sous une autre version des règles (plafonds différents) : ni recharge ni « jauge
    // vide » tant qu'ils ne sont pas convertis ou ressaisis (même règle que la page Enclos, R9).
    const otherRuleset = GAUGE_IDS.filter((g) => {
      const tag = p.gaugeRulesets?.[g]
      return tag !== undefined && tag !== rules.id && (p.gauges[g] ?? 0) > 0
    })
    if (otherRuleset.length) {
      out.push({
        id: `jauges-version:${N}:${rules.id}`,
        priority: 3,
        category: 'enclos',
        title: `Enclos ${N} : niveaux de jauges à vérifier`,
        detail: `${otherRuleset.map((g) => GAUGE_LABELS[g]).join(', ')} : saisi${otherRuleset.length > 1 ? 's' : ''} sous les règles ${p.gaugeRulesets?.[otherRuleset[0]]}, vous êtes en ${rules.id} (plafonds différents). Convertissez ou ressaisissez les niveaux dans la page Enclos pour obtenir les recharges.`,
        link,
      })
      continue
    }
    // Sans plan démarré, la répartition conseillée peut changer les jauges de l'enclos : on ne
    // conseille pas de recharger une jauge qu'elle propose de désactiver (voir le conseil « Placer »).
    const planned = planRunning ? null : a.assignment?.paddocks.find((x) => x.paddockId === N && x.plan && x.firstGauges.length)
    const refTier: FuelTier = planRunning?.tier ?? settings.preferredTier
    // Projection « maintenant » partagée avec la page Enclos (projection.ts) : jauges vidées depuis leur
    // saisie (jauges actives successives — celles du plan démarré pendant le plan) et montures (plan rejoué).
    const stamps = Object.values(gaugeUpdatedAt).filter((t): t is number => typeof t === 'number' && t > 0)
    let activeHistory = p.activeHistory && p.activeHistory.length ? p.activeHistory : undefined
    if (planRunning) {
      const base = planRunning.startedAt + (planRunning.offsetMs ?? 0)
      activeHistory = [...(activeHistory ?? []).filter((h) => h.at < base), ...planActiveHistory(planRunning)]
    }
    const levels: Record<GaugeId, number> = { ...p.gauges }
    for (const g of GAUGE_IDS) levels[g] = Math.max(0, Math.min(max, p.gauges[g] ?? 0))
    const proj = projectPaddock({
      state: { gauges: levels, active: p.active },
      activeSinceMs: stamps.length ? Math.min(...stamps) : 0,
      nowMs: now,
      rules,
      mounts: inside,
      plan: planRunning,
      gaugeUpdatedAt,
      activeHistory,
      almanax: doubling ? undefined : false,
    })
    const current = proj.gauges.levels
    const mountsNow: SimMount[] = proj.mounts
    let horizonS = 12 * 3600
    if (planRunning) {
      const pr = planStatus(planRunning, now).progress
      if (pr.next) horizonS = Math.max(0, Math.min(horizonS, (pr.next.at - now) / 1000))
    }
    const future = horizonS >= 10 ? simulatePaddock({ gauges: { ...current }, active: p.active, mounts: mountsNow, almanaxDoubled: doubled, maxSeconds: horizonS, rules }).events : []
    // Plan démarré : étape en cours (ses jauges sont voulues, même sans monture éligible à l'instant :
    // traversée de 0, ou changement déjà annoncé par l'alarme) et ce qu'il lui reste à consommer, jauge
    // par jauge — les recharges se dimensionnent sur ce besoin, comme le carburant de la page Enclos.
    const planStep = planRunning ? (planRunning.steps[Math.min(planRunning.acknowledgedStepIndex, planRunning.steps.length - 1)] ?? null) : null
    const planNeed = planRunning ? remainingPlanConsumption(planRunning, now).consumed : null
    const lastEntry = stamps.length ? Math.max(...stamps) : p.updatedAt
    const basis = lastEntry > 0 ? `estimation d'après les niveaux saisis (dernière saisie à ${formatClock(lastEntry, now)}) et les montures de l'enclos` : "estimation d'après les niveaux saisis"
    for (const g of p.active) {
      const eligible = mountsNow.filter((m) => canBenefit(g, m)).length
      const level = current[g] ?? 0
      const serenityGauge = g === 'baffeur' || g === 'caresseur'
      const G = GAUGE_LABELS[g]
      if (eligible === 0 && level > 0) {
        // Jauge de l'étape en cours du plan : voulue (les montures y arrivent en traversant 0, ou l'alarme
        // de changement dit déjà de la couper) — ne pas contredire le plan.
        if (planStep?.gauges.includes(g)) continue
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
      // Plan démarré : ce que le plan doit encore consommer sur cette jauge (0 : rien à recharger, le
      // changement ou la fin du plan la coupera).
      const need = planNeed ? Math.max(0, Math.round(planNeed[g] ?? 0)) : null
      if (need !== null && need <= 0) continue
      // Palier de cette jauge : celui du plan (paliers par jauge : sérénité au palier 1, socle évité
      // pour une petite consommation), comme la page Enclos ; sinon le palier préféré (sérénité : 1).
      const gTier: FuelTier = planRunning?.tiers?.[g] ?? planned?.plan?.tiers?.[g] ?? (serenityGauge ? 1 : refTier)
      const tierNow = gaugeTier(level, rules)
      const gFloor = gTier === 1 ? 0 : rules.gaugeTierMax[(gTier - 1) as FuelTier]
      const gCap = rules.gaugeTierMax[gTier]
      if (level <= 0) {
        const since = proj.gauges.emptiedAt[g] ?? null
        // Plan démarré : socle + ce qui reste à consommer (pas tout le palier).
        const refill = serenityGauge ? null : fillPlan(g, 0, need !== null ? Math.min(gCap, gFloor + need) : gCap, ctx, fuelOpts)
        if (refill) missing.add(refill.complete ? [] : refill.missing, `recharge ${deName(G)}`, 2)
        out.push({
          id: `jauge-vide:${N}:${g}:${p.updatedAt}`,
          priority: 1,
          category: 'carburant',
          title: `Enclos ${N} : ${G} est vide`,
          detail: `${since ? `Vide depuis ≈ ${formatClock(since, now)}` : 'Jauge vide'} (${basis}) : ${eligible > 1 ? `${formatNumber(eligible)} montures n'avancent` : "1 monture n'avance"} plus sur cette statistique. ${
            serenityGauge ? 'Jauge de sérénité : ne la rechargez que du nécessaire, avec une alarme.' : `Rechargez au palier ${gTier} (${FUEL_TIER_NAMES[gTier]}s).`
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
          (planRunning !== null && e.kind === 'gauge-tier' && e.gauge === g && e.tier < gTier && tierNow >= gTier),
      )
      const belowPlanTier = planRunning !== null && tierNow < gTier
      if (!drop && !belowPlanTier) continue
      const at = drop ? now + drop.t * 1000 : now
      const isEmpty = drop?.kind === 'gauge-empty'
      const from = isEmpty || gTier === 1 ? 0 : gFloor
      // Plan démarré : points qui manqueront au palier du plan (besoin restant − points utilisables).
      const shortfall = need !== null ? Math.max(0, need - Math.max(0, level - gFloor)) : null
      if (shortfall !== null && shortfall <= 0) continue
      if (shortfall !== null && !isEmpty && gTier > 1) {
        // Passer sous le palier ne fait que ralentir : un retard de quelques minutes ne vaut pas une recharge.
        const lowTier = Math.max(1, Math.min(tierNow || 1, gTier - 1)) as FuelTier
        const lostSeconds = shortfall * TICK_SECONDS * (1 / rules.gaugeRatePerTick[lowTier] - 1 / rules.gaugeRatePerTick[gTier])
        if (lostSeconds < NEGLIGIBLE_DELAY_S) continue
      }
      const target = shortfall !== null ? Math.min(gCap, (belowPlanTier ? Math.max(level, gFloor) : from) + shortfall) : gCap
      const refill = serenityGauge ? null : fillPlan(g, belowPlanTier ? level : from, target, ctx, fuelOpts)
      if (refill) missing.add(refill.complete ? [] : refill.missing, `recharge ${deName(G)}`, 1)
      const ms = at - now
      const priority: AdvicePriority = belowPlanTier || ms <= HOUR ? 2 : ms <= 6 * HOUR ? 3 : 4
      const clock = formatClock(at, now)
      const title = belowPlanTier
        ? `Enclos ${N} : rechargez ${G} (palier ${tierNow || 0} au lieu de ${gTier})`
        : isEmpty
          ? `Enclos ${N} : ${G} vide vers ${clock}`
          : `Enclos ${N} : rechargez ${G} avant ${clock}`
      const why = belowPlanTier
        ? `Les heures du plan supposent le palier ${gTier} entretenu : sous ce palier, la jauge tourne moins vite et le plan prend du retard.`
        : isEmpty
          ? `À ce rythme, la jauge sera vide ${relativeTime(at, now)} : les montures cesseront d'avancer.`
          : `Elle passera sous le palier ${gTier} ${relativeTime(at, now)} : les heures du plan supposent ce palier entretenu.`
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
    const dueAt = serverDayStart(e.date) // début du jour de jeu (minuit à Paris)
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
        detail: `Ce jour-là, +20 % de génération cible sur tous les accouplements. Préparez un maximum de couples féconds de haute génération : ${takezaPrepTiming(a, input, dueAt, now)} Gardez pour ce jour les couples dont la cible est ≥ G${TAKEZA_PRIORITY_GENERATION}.`,
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

/**
 * Préparation du Takeza : durée du plus long lot planifié par la répartition (sinon un lot typique du
 * planificateur au palier préféré) et heure limite de démarrage pour que le lot soit fécond au début
 * du jour Takeza (minuit à Paris).
 */
function takezaPrepTiming(a: AdvisorAnalysis, input: AdvisorInput, dayStart: number, now: number): string {
  const tier = input.settings.preferredTier
  const planned = (a.assignment?.paddocks ?? []).filter((p) => p.plan && p.plan.converges !== false && p.totalSeconds > 0).map((p) => p.totalSeconds)
  const seconds = planned.length ? Math.max(...planned) : typicalBatchSeconds(tier, input.rules)
  const basis = planned.length ? `votre plus long lot planifié demande ≈ ${formatDuration(seconds)}` : `un lot typique demande ≈ ${formatDuration(seconds)} au palier ${tier}`
  const latest = dayStart - seconds * 1000
  return latest > now
    ? `${basis} : pour qu'il soit fécond au début du jour Takeza, démarrez-le au plus tard ${formatClock(latest, now)}.`
    : `${basis} : démarrez vos lots dès que possible.`
}

function pairText(p: PairSuggestion): string {
  const ga = genOf(p.a.speciesId)
  const gb = genOf(p.b.speciesId)
  const targets = p.result.targetSpecies.map(nameOf).join(' ou ')
  return `♂ ${mountName(p.a)} (G${ga}, niv. ${p.a.level}) × ♀ ${mountName(p.b)} (G${gb}, niv. ${p.b.level}) → ${targets} : ${formatPercent(p.result.targetChance, 0)} de G${p.result.targetGeneration}`
}

const THEN_VERB: Record<'vente' | 'extraction' | 'brisage', string> = { vente: 'vendre', extraction: 'extraire', brisage: 'briser' }

/**
 * Conseil d'Optimakina d'un couple, en clair : même décision que la page Accouplement
 * (`pairing.adviseOptimakina` : règle de prix dès que le prix et C_eff sont connus, sinon heuristique de
 * la recherche — systématique dès la G6, étape G4–G5 de l'objectif, jamais G2–G3 sans prix).
 */
function makinaHint(p: PairSuggestion): string | null {
  const ad = p.makinaAdvice
  const price = p.makinaPrice?.price ?? ad.price
  const complete = p.makinaPrice?.complete ?? ad.priceComplete
  const priceTxt = price !== null && price !== undefined ? `${formatKamas(price)}${complete ? '' : ', minimum'}` : 'prix inconnu'
  const seuil = ad.threshold !== null ? `${ad.thresholdIsUpperBound ? 'maximal ' : ''}${formatKamas(ad.threshold)}` : null
  if (p.makina === 'optimakina') {
    if (ad.basis === 'regle-prix' && seuil) return `Optimakina G${ad.generation} conseillée (${priceTxt} < seuil ${seuil} = C_eff × Δ / p)`
    const why = ad.generation >= OPTIMAKINA_SYSTEMATIC_GENERATION ? `systématique dès la G${OPTIMAKINA_SYSTEMATIC_GENERATION}` : `étape G${OPTIMAKINA_GOAL_STEP_GENERATION}–G5 de l'objectif`
    return `Optimakina G${ad.generation} conseillée (${priceTxt} ; ${why}, faute de prix décisif)`
  }
  if (ad.gain <= 0) return null
  if (ad.basis === 'jamais') return 'sans makina (désactivée dans vos réglages)'
  if (ad.basis === 'regle-prix' && seuil) return `sans makina (Optimakina ${priceTxt} ≥ seuil ${seuil})`
  return `sans makina (cible G${ad.generation}, prix ou C_eff non décisifs : la recherche la réserve aux cibles ≥ G${OPTIMAKINA_SYSTEMATIC_GENERATION})`
}

function matingAdvice({ input, a, byId }: Ctx): Advice[] {
  const out: Advice[] = []
  const takeza = nextTakeza(a.day)
  const inPlan = new Set(a.pairs.flatMap((p) => [p.a.id, p.b.id]))
  // Montures de l'objectif dont la partenaire est encore fertile : attendre plutôt que les consommer ailleurs.
  const waitItems: AdviceItem[] = []
  for (const w of a.waiting) {
    const m = byId.get(w.mountId)
    const partner = byId.get(w.partnerId)
    if (!m || !partner) continue
    waitItems.push({
      id: `attendre-${w.mountId}`,
      text: `Attendre que ${mountName(partner)} soit féconde, puis ${mountName(m)} × ${mountName(partner)} → ${w.targetSpecies.map(nameOf).join(' ou ') || 'étape de l’objectif'}`,
      hint: `${mountName(m)} sert à votre objectif : ne l'accouplez pas sur un autre croisement ; rendez ${mountName(partner)} féconde en priorité.`,
      tone: 'info',
      link: { page: 'enclos', params: { onglet: 'repartition' }, label: 'Enclos' },
    })
  }
  if (a.pairs.length) {
    const sorted = [...a.pairs].sort((x, y) => x.result.targetGeneration - y.result.targetGeneration || y.score - x.score)
    const items: AdviceItem[] = []
    if (takeza && takeza.days > 0 && takeza.days <= 3 && sorted.some((p) => p.result.targetGeneration >= TAKEZA_PRIORITY_GENERATION))
      items.push({
        id: 'takeza',
        text: `Takeza dans ${nb(takeza.days, 'jour')} : gardez pour ce jour les couples dont la cible est ≥ G${TAKEZA_PRIORITY_GENERATION} (+20 %)`,
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
      let tone: AdviceItem['tone']
      const mk = makinaHint(p)
      if (mk) hints.push(mk)
      // `result.expectedGenetons` compte déjà les bébés (Reproducteur compris).
      const g = p.result.expectedGenetons
      if (g > 0) hints.push(`≈ ${formatNumber(g, 1)} ${plural(g, 'généton')} ${plural(g, 'attendu')}`)
      if (p.result.jobXp > 0) hints.push(`${formatNumber(p.result.jobXp)} XP d'Éleveur`)
      const stable = [p.a, p.b].filter((m) => m.location.kind !== 'etable')
      if (stable.length) {
        hints.push(`à mettre dans l'étable : ${stable.map(mountName).join(', ')}`)
        tone = 'warn'
      }
      // M-STACK-01 : une seule tentative d'une haute génération de l'objectif échoue souvent.
      if (p.stackAttempts !== null && p.stackAttempts < STACK_MIN_ATTEMPTS) {
        const chance = p.goalChance > 0 ? p.goalChance : p.result.targetChance
        hints.push(
          `${resolveRuleRefs('M-STACK-01')} : ${nb(p.stackAttempts, 'tentative')} ${plural(p.stackAttempts, 'possible')} avec vos montures, une tentative à ${formatPercent(chance, 0)} échoue ${formatPercent(1 - chance, 0)} du temps — produisez d'abord des parents pour au moins ${STACK_MIN_ATTEMPTS} tentatives (simple avertissement)`,
        )
        tone = 'warn'
      }
      if (p.consumesGoalParents.length) {
        hints.push(`consomme ${p.consumesGoalParents.map(nameOf).join(' et ')}, utile à votre objectif, sur un croisement hors objectif`)
        tone = 'warn'
      }
      // Ensuite : la sortie de chaque stérile (sort « Accoupler (plan) puis … »), jamais avant l'accouplement.
      const after: string[] = []
      for (const m of [p.a, p.b]) {
        const f = a.fates.get(m.id)
        if (f?.action === 'accoupler' && f.exit) after.push(`${THEN_VERB[f.exit]} ${mountName(m)} stérile${f.value !== null ? ` (${f.complete ? '≈' : '≥'} ${formatKamas(f.value)}${f.complete ? '' : ', minimum'})` : ''}`)
      }
      if (after.length) hints.push(`ensuite : ${after.join(' ; ')}`)
      items.push({ id: p.key, text: pairText(p), hint: hints.join(' · '), tone })
    }
    items.push(...waitItems)
    const idle = input.mounts.filter((m) => effectiveFertility(m) === 'feconde' && !inPlan.has(m.id) && a.fates.get(m.id)?.action !== 'accoupler' && !a.waiting.some((w) => w.mountId === m.id))
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
      detail: `Plan d'appariement pour l'objectif « ${objectiveLabel(input.settings.goal)} » : chaque monture n'est utilisée qu'une fois, sur ${nb(a.pairCandidates, 'couple')} possible${a.pairCandidates > 1 ? 's' : ''}. Accouplez depuis l'étable, par génération croissante, puis clonez ou sortez les stériles (indiqué « ensuite »). ${
        opti
          ? `Optimakina sur ${nb(opti, 'couple')} : règle de prix (prix < C_eff × Δ / p) dès que le prix et le coût du couple sont connus ; sinon systématique dès la cible G${OPTIMAKINA_SYSTEMATIC_GENERATION} (G${OPTIMAKINA_GOAL_STEP_GENERATION}–G5 pour les étapes de l'objectif).`
          : ''
      }`.trim(),
      link: { page: 'accouplement', params: { onglet: 'couples' }, label: 'Plan d’accouplement' },
      items,
      amount: a.expectedGenetons > 0 ? { label: 'Génétons attendus (net de taxe, estimation)', value: a.expectedGenetons * a.genetonValue * (1 - Math.max(0, Math.min(1, input.settings.saleTax))), complete: true } : undefined,
    })
  } else if (waitItems.length)
    out.push({
      id: `attendre:${hashKey(a.waiting.map((w) => `${w.mountId}|${w.partnerId}`).join(','))}`,
      priority: 3,
      category: 'accouplement',
      title: `Attendre ${nb(waitItems.length, 'partenaire')} de l'objectif avant d'accoupler`,
      detail:
        "Ces montures servent à votre objectif et leur partenaire du plan est encore en préparation (fertile) : un croisement hors objectif les consommerait. Rendez la partenaire féconde en priorité, puis accouplez-les ensemble.",
      link: { page: 'accouplement', params: { onglet: 'couples' }, label: 'Plan d’accouplement' },
      items: waitItems,
    })
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
  // Sorties immédiates : jamais une monture prévue au plan d'accouplement (son sort est « Accoupler (plan)
  // puis … », la sortie de la stérile est indiquée « ensuite » dans le conseil d'accouplement).
  const planned = new Set(a.pairs.flatMap((p) => [p.a.id, p.b.id]))
  const exits = fates.filter((f) => (f.action === 'vente' || f.action === 'extraction' || f.action === 'brisage') && !planned.has(f.mountId))
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
      detail:
        'Un palier de valeur proche (brisage, tranche de prix 100/200) rapporte plus que le carburant de Mangeoire nécessaire, calculé pour le lot réel (montures montées ensemble) au palier le moins cher. Placez-les ensemble en complément XP dans les enclos.',
      link: { page: 'montures', params: { sort: 'monter' }, label: 'Voir ces montures' },
      items: levelUp.slice(0, 10).map((f) => {
        const m = byId.get(f.mountId)
        const batch = /si vous montez \d+ montures ensemble|pour cette monture seule dans l'enclos/.exec(f.reason)?.[0]
        return {
          id: f.mountId,
          text: `${m ? mountName(m) : f.mountId} → niveau ${f.targetLevel ?? '?'}`,
          hint: [f.label, f.value !== null ? `≈ ${formatKamas(f.value)}${f.complete ? '' : ' (au plus)'} net` : '', batch ?? ''].filter(Boolean).join(' · '),
        }
      }),
      confidence: 'low',
    })
  return out
}

function placementAdvice({ input, a, byId, now }: Ctx): Advice[] {
  const res = a.assignment
  if (!res) return []
  // Les montures à accoupler maintenant restent dans l'étable (l'accouplement passe avant le placement).
  const mating = new Set(a.pairs.flatMap((p) => [p.a.id, p.b.id]))
  for (const f of a.fates.values()) if (f.action === 'accoupler' && f.partnerId) mating.add(f.mountId)
  const items: AdviceItem[] = []
  let added = 0
  let starts = 0
  for (const pa of res.paddocks) {
    // Un plan démarré (en cours, terminé ou dépassé) occupe l'enclos : jamais « démarrer le plan » à côté de
    // « plan terminé » — le plan terminé s'applique au lot d'abord (conseil « Appliquer au lot »).
    const plan = input.paddockPlans[String(pa.paddockId)]
    const planState = plan ? planStatus(plan, now).state : null
    const finished = planState === 'finished' || planState === 'end-overdue'
    const running = !!plan && !finished
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
        hint: [
          role,
          speciesSummary(addMs),
          pa.totalSeconds > 0 ? `fécondes en ≈ ${formatDuration(pa.totalSeconds)}` : '',
          running ? 'un plan tourne déjà : relancez-le après' : finished ? 'appliquez d’abord le plan terminé au lot' : '',
        ]
          .filter(Boolean)
          .join(' · '),
        link: { page: 'enclos', params: { enclos: pa.paddockId }, label: `Enclos ${pa.paddockId}` },
      })
    } else if (pa.plan && !plan && pa.plan.converges !== false && pa.mountIds.length) {
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

function captureAdvice({ input, a, goal }: Ctx): Advice[] {
  if (input.mounts.length === 0) return []
  const s = input.settings
  const items: AdviceItem[] = []
  const cap = a.capture
  const family = cap.family
  const famInfo = FAMILIES[family]
  const simulated = goal?.captureBasis === 'simulation'
  let total = 0
  if (goal && !goal.reached && goal.captures.length) {
    for (const c of goal.captures) {
      if (c.expected <= 0) continue
      total += c.expected
      const sexes = [c.males ? `${c.males} ♂` : '', c.females ? `${c.females} ♀` : ''].filter(Boolean).join(', ')
      items.push({
        id: `g1-${c.speciesId}`,
        text: `${nameOf(c.speciesId)} : ${simulated ? '≈ ' : 'jusqu’à ≈ '}${formatNumber(c.expected)}${sexes ? ` (${sexes})` : ''}`,
        hint: `recette idéale : encore ${c.idealRemaining} sur ${c.idealTotal} ; vous en avez ${c.ownedMales} ♂ / ${c.ownedFemales} ♀`,
      })
    }
    for (const [i, note] of (goal.supply?.notes ?? []).slice(0, 3).entries()) items.push({ id: `stock-${i}`, text: note, tone: 'info' })
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
  const c = cap.cost
  // Combats : chaque personnage du combat lance son filet (réglage « personnages pour les captures »).
  const perFight = capturesPerFight(s.accounts, c.mountsPerCast)
  const toCatch = total > 0 ? total : a.freeSlots > 0 && waiting === 0 ? a.freeSlots : 0
  if (toCatch > 0)
    items.push({
      id: 'combats',
      text: `≈ ${nb(Math.ceil(toCatch / perFight), 'combat')} de capture pour ${nb(toCatch, 'monture')}`,
      hint: `${nb(Math.max(1, Math.round(s.accounts ?? 1)), 'personnage')} × ${nb(c.mountsPerCast, 'monture')} par lancer = ${nb(perFight, 'capture')} par combat (réglage « Personnages pour les captures »)`,
    })
  if (cap.spot) items.push({ id: 'zone', text: `Où : ${captureSpotText(cap.spot)}`, hint: cap.spot.note })
  if (c.net)
    items.push({
      id: 'filet',
      text: `Filet : ${c.net.name} (${NET_KIND_LABELS[cap.netKind].toLowerCase()}, ${formatNumber(c.mountsPerCast)} par lancer)`,
      hint: `${c.perMount !== null ? `${formatKamas(c.perMount)} par monture${c.complete ? '' : ' (minimum)'}` : 'coût incomplet'}${
        s.jobLevel < 100 ? ' · filet multiplicateur au niveau 100 (≈ ÷ 4 le coût par monture)' : ''
      }`,
      tone: c.complete ? undefined : 'warn',
    })
  const famName = famInfo?.plural ?? family
  const title = goal && total > 0 ? `Capturer ${simulated ? '≈ ' : 'jusqu’à ≈ '}${formatNumber(total)} ${famName} pour ${goal.name}` : `Capturer des ${famName}`
  const strategy = `parents niveau ${s.parentTargetLevel}, ${s.useOptimakina ? `Optimakina dès la G${OPTIMAKINA_SYSTEMATIC_GENERATION}` : 'sans makina'}, clonage`
  return [
    {
      id: `capture:${a.day}:${hashKey(items.map((i) => i.text).join('|'))}`,
      priority: a.freeSlots >= PADDOCK_SLOTS && waiting === 0 ? 2 : 3,
      category: 'capture',
      title,
      detail:
        goal && total > 0
          ? simulated
            ? `Captures restantes estimées pour votre stratégie (${strategy}) : simulation Monte-Carlo du programme (${nb(goal.sim?.runs ?? 0, 'tirage')}, sexes, places et bébés hors cible réutilisés), ramenée à ce que vos montures couvrent déjà (une tentative peut rater : une monture du haut de l'arbre ne couvre pas tout son sous-arbre). Capturez le sexe en déficit d'abord ; 30 XP d'Éleveur par capture.`
            : `Borne haute (modèle analytique, ${strategy}) : il suppose que les bébés hors cible ne sont jamais réutilisés ; la simulation du Plan d'élevage donne en général 1,5 à 2,5 fois moins de captures (ouvrez le Plan pour la calculer). Vos montures couvrent déjà une partie de la demande attendue. Capturez le sexe en déficit d'abord ; 30 XP d'Éleveur par capture.`
          : "Gardez les enclos pleins : l'élevage ne s'auto-alimente pas (un bébé par couple). Capturez le sexe en déficit d'abord ; 30 XP d'Éleveur par capture.",
      link: goal && total > 0 && !simulated ? { page: 'plan', label: 'Calculer la simulation (Plan)' } : { page: 'montures', params: { captures: 1 }, label: 'Saisir les captures' },
      items,
      amount: c.perMount !== null && total > 0 ? { label: simulated ? 'Filets (estimation)' : 'Filets (borne haute)', value: c.perMount * total, complete: c.complete } : undefined,
      missing: c.complete ? undefined : c.missing,
      confidence: goal && total > 0 ? (simulated ? 'medium' : 'low') : undefined,
    },
  ]
}

function jobAdvice({ a }: Ctx): Advice[] {
  const j = a.job
  const out: Advice[] = []
  // XP du journal depuis la dernière saisie du niveau : niveau estimé (plancher, bonus Almanax non comptés).
  if (j.estimatedLevel > j.level)
    out.push({
      id: `metier:niveau-estime:${j.level}:${j.estimatedLevel}`,
      priority: j.paddockUnlockedSinceEntry ? 2 : 4,
      category: 'metier',
      title: j.paddockUnlockedSinceEntry
        ? `Niveau d'Éleveur ≈ ${j.estimatedLevel} : un nouvel enclos est probablement débloqué`
        : `Niveau d'Éleveur estimé : ${j.estimatedLevel} (saisi : ${j.level})`,
      detail: `Le journal compte ${formatNumber(j.xpGained)} XP d'Éleveur depuis votre dernière saisie du niveau (captures, accouplements, crafts ; bonus Almanax non comptés : c'est un minimum). Vérifiez votre niveau en jeu et mettez-le à jour dans les réglages${
        j.paddockUnlockedSinceEntry ? ' : les enclos, la répartition et les plans en dépendent' : ''
      }.`,
      link: { page: 'reglages', label: 'Mettre à jour le niveau' },
      confidence: 'medium',
    })
  if (j.estimatedLevel >= 200) return out
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
      hint: `${j.plan.totals.cost > 0 || j.plan.totals.costComplete ? `${j.plan.totals.costComplete ? '≈' : '≥'} ${formatKamas(j.plan.totals.cost)}${j.plan.totals.costComplete ? '' : ' (minimum, prix manquants)'}` : 'coût incomplet'}`,
    })
  if (j.xpGained > 0) items.push({ id: 'journal', text: `${formatNumber(j.xpGained)} XP déjà gagnée d'après le journal depuis votre dernière saisie du niveau (déduite)` })
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
  out.push({
    id: `metier:${j.estimatedLevel}`,
    priority: j.estimatedLevel < 120 ? 3 : 4,
    category: 'metier',
    title: `Métier : ${formatNumber(j.xpToNext)} XP jusqu'au niveau ${j.nextPaddockLevel} (${j.nextPaddockIndex}e enclos)`,
    detail: `Objectif minimal : niveau 120 (4 enclos). Une recette rapporte son niveau en XP quand on a le même niveau, puis chute vite : craftez la dernière taille débloquée.${
      bonusSoon ? ` ${bonusSoon.daysUntil === 0 ? "Aujourd'hui" : `Le ${formatIsoDay(bonusSoon.date)}`} : ${bonusSoon.effect} — gardez-y vos gros crafts.` : ''
    }`,
    link: { page: 'metier', label: 'Plan de montée du métier' },
    items,
    amount: j.plan ? { label: `Jusqu'au niveau ${j.nextPaddockLevel}`, value: j.plan.totals.cost > 0 || j.plan.totals.costComplete ? j.plan.totals.cost : null, complete: j.plan.totals.costComplete } : undefined,
    missing: missing.length ? missing : undefined,
  })
  return out
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

/** Conseil visible quand une section n'a pas pu être calculée (au lieu de la faire disparaître). */
function sectionErrorAdvice(e: AdvisorSectionError): Advice {
  return {
    id: `indisponible:${e.section}:${hashKey(e.message)}`,
    priority: 2,
    category: 'erreur',
    title: `Section indisponible : ${e.label}`,
    detail: `Cette partie des conseils n'a pas pu être calculée (${e.message}). Les autres conseils restent valables, mais celle-ci manque : ce n'est pas « rien à faire ». Vérifiez les données concernées (montures, prix, réglages) ou téléchargez une sauvegarde pour signaler le problème.`,
    link: { page: 'reglages', label: 'Sauvegarde et réglages' },
    items: [{ id: 'message', text: e.message, tone: 'warn' }],
    confidence: 'low',
  }
}

/**
 * Liste ordonnée des actions à faire à l'instant `input.now` : alarmes des plans d'enclos, jauges
 * vides ou à recharger, Almanax, accouplements, clonages, sorties, placement en enclos, captures,
 * métier, prix manquants, premiers pas et objectif. `analysis` (calculs lourds) est recalculée si
 * absente. Une section qui échoue (analyse ou générateur) donne un conseil « Section indisponible ».
 */
export function adviseNow(input: AdvisorInput, analysis: AdvisorAnalysis = analyzeState(input)): Advice[] {
  const missing = new MissingCollector()
  missing.merge(analysis.missingPrices)
  const errors: AdvisorSectionError[] = [...analysis.errors]
  let goal = analysis.goal
  try {
    goal = withGoalSimulation(analysis.goal, input.mounts, input.goalSim, input.rules)
  } catch (e) {
    errors.push({ section: 'goal', label: ADVISOR_SECTION_LABELS.goal, message: errorMessage(e) })
  }
  const ctx: Ctx = { input, a: analysis, now: input.now, byId: new Map(input.mounts.map((m) => [m.id, m])), missing, goal }
  const list: Advice[] = []
  const run = (section: AdvisorSection, gen: (c: Ctx) => Advice[]) => {
    try {
      list.push(...gen(ctx))
    } catch (e) {
      console.error('[conseiller]', section, e)
      errors.push({ section, label: ADVISOR_SECTION_LABELS[section], message: errorMessage(e) })
    }
  }
  run('onboarding', onboardingAdvice)
  run('alarms', alarmAdvice)
  run('gauges', gaugeAdvice)
  run('almanax', almanaxAdvice)
  run('mating', matingAdvice)
  run('exits', fateAdvice)
  run('placement', placementAdvice)
  run('captures', captureAdvice)
  run('job', jobAdvice)
  run('goal', goalAdvice)
  // Les prix en dernier : les recharges de carburant y ajoutent leurs objets manquants.
  run('prices', priceAdvice)
  const seen = new Set<string>()
  for (const e of errors) {
    if (seen.has(e.section)) continue
    seen.add(e.section)
    list.push(sectionErrorAdvice(e))
  }
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
