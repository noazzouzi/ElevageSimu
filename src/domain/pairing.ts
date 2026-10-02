// Accouplement : analyse d'un couple, classement des couples possibles de l'étable, plan
// d'appariement (chaque monture une seule fois), conseil d'Optimakina, enregistrement d'une naissance,
// suggestions de clonage et calibration du modèle sur le journal.
//
// Module pur (aucun React, aucun store). S'appuie sur breed() (genetics.ts, modèle de naissance
// validé sur les captures en jeu), matingEconomics() (economy.ts) et les règles d'accouplement de la
// recherche (STRATEGY.matingRules, research/strategy.md §5).
import { getSpecies, STRATEGY } from '../data'
import { formatKamas } from '../lib/format'
import { ancestorsOf, cheapestRecipe, expectedEffort, requiredSpecies } from './breedingPath'
import { PADDOCK_SLOTS } from './constants'
import {
  OPTIMAKINA_GOAL_STEP_GENERATION,
  OPTIMAKINA_HEURISTIC_GENERATION,
  optimakinaHeuristicUse,
  captureCost,
  fertilityCost,
  levelingCost,
  matingEconomics,
  mountValuation,
  type FateKind,
  type MatingEconomics,
  type MountPriceContext,
  type MountState,
  type MountValuation,
  type NetKind,
} from './economy'
import {
  breed,
  parentGenetons,
  TAKEZA_BONUS,
  TARGET_BASE,
  TARGET_PER_LEVEL,
  type BreedingOptions,
  type BreedingParent,
  type BreedingResult,
} from './genetics'
import { babyMount, cloningBlockers, effectiveFertility, matingBlockers, mountName, toBreedingParent } from './mounts'
import { cloneTreeKind, pairForCloning } from './mountFate'
import type { PriceContext } from './pricing'
import type { Ruleset } from './rules'
import type { Ability, FamilyId, FuelTier, Gender, MakinaKind, Mount, Species } from './types'

// ---------- Constantes et libellés ----------

export type PairingObjective = 'progression' | 'genetons' | 'profit'
export type MakinaPolicy = 'auto' | 'jamais' | 'optimakina'

export const OBJECTIVE_LABELS: Record<PairingObjective, string> = {
  progression: 'Progression (générations, objectif)',
  genetons: 'Génétons',
  profit: 'Kamas (valeur attendue)',
}

export const MAKINA_POLICY_LABELS: Record<MakinaPolicy, string> = {
  auto: 'Automatique (règle de prix)',
  jamais: 'Jamais',
  optimakina: 'Toujours une Optimakina',
}

export const MAKINA_LABELS: Record<MakinaKind, string> = {
  optimakina: 'Optimakina',
  animakina: 'Animakina',
  kromakina: 'Kromakina',
}

/**
 * Génération cible à partir de laquelle la recherche recommande l'Optimakina systématique (M-OPTI-01).
 * Source unique : `economy.OPTIMAKINA_HEURISTIC_GENERATION` (même règle en Rentabilité).
 */
export const OPTIMAKINA_SYSTEMATIC_GENERATION = OPTIMAKINA_HEURISTIC_GENERATION

/**
 * Étapes de l'objectif G4–G5 : Optimakina « à défaut de prix » seulement (phase P2 de la recherche :
 * « Optimakina sur G4–G5 seulement si son prix < seuil ») ; jamais en G2–G3 sans prix.
 */
export { OPTIMAKINA_GOAL_STEP_GENERATION }

/**
 * Takeza (+20 % de génération cible, M-TAKEZA-01 « accouplements à fort enjeu ») : seuil commun à
 * l'Accouplement et à l'Accueil. La recherche ne donne pas de génération : on reprend celle de
 * l'Optimakina systématique (là où une tentative ratée coûte cher).
 */
export const TAKEZA_PRIORITY_GENERATION = OPTIMAKINA_SYSTEMATIC_GENERATION

/** Tentatives minimales avant de viser une génération haute (M-STACK-01). */
export const STACK_MIN_ATTEMPTS = 3

/** Génération cible à partir de laquelle M-STACK-01 est vérifiée sur les couples de l'objectif. */
export const STACK_MIN_GENERATION = 5

/** Niveaux cumulés visés pour un couple (2 × ~40, M-LEVEL-01). */
export const RECOMMENDED_LEVEL_SUM = 80

/** Naissances minimales avant de juger la calibration du modèle. */
export const CALIBRATION_MIN_BIRTHS = 10

/** Objectif d'accouplement par défaut selon l'objectif général des réglages. */
export function objectiveFromGoal(goal: string | null | undefined): PairingObjective {
  return goal === 'profit' ? 'profit' : 'progression'
}

function ruleTitle(id: string): string {
  return STRATEGY.matingRules.find((r) => r.id === id)?.title ?? id
}

function sp(id: number): Species | undefined {
  return getSpecies(id)
}

function nameOf(id: number): string {
  return sp(id)?.name ?? `#${id}`
}

function genOf(id: number): number {
  return sp(id)?.generation ?? 0
}

function clampLevel(l: number): number {
  return Math.max(1, Math.min(200, Math.floor(l || 1)))
}

// Formateur unique (rankPairs peut produire des milliers de textes ; même rendu que formatPercent(p, 1)).
const pctFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 0 })
const pct = (p: number) => (Number.isFinite(p) ? `${pctFormat.format(p * 100)} %` : '—')
const formatNumberFr = (n: number) => pctFormat.format(n)

/** « l'Optimakina », « l'Animakina », « la Kromakina ». */
export function theMakina(kind: MakinaKind): string {
  return kind === 'kromakina' ? 'la Kromakina' : `l'${MAKINA_LABELS[kind]}`
}

// ---------- Décomposition de la chance de génération cible (B) ----------

export interface TargetBreakdown {
  /** 30 % de base. */
  base: number
  /** Niveaux cumulés (bornés à 1 … 200 chacun). */
  levelSum: number
  /** 0,15 % par niveau cumulé. */
  levels: number
  /** Bonus d'Optimakina (0 sans). */
  optimakina: number
  /** Bonus Takeza (0 sans). */
  takeza: number
  /** Somme avant plafond. */
  raw: number
  /** B réellement appliqué (plafonné à 100 % ; 100 % si aucune autre issue). */
  total: number
  /** La somme dépasse 100 % : une partie du bonus est perdue. */
  capped: boolean
  /** Aucune issue hors génération cible : B = 100 % quels que soient les bonus. */
  noAlternative: boolean
}

/**
 * B = min(1, 30 % + 0,15 % × (niv. A + niv. B) + Optimakina + Takeza), détaillé terme à terme.
 * Avec `result`, `total` reprend la valeur du moteur (100 % si aucune autre issue).
 */
export function targetBreakdown(
  levelA: number,
  levelB: number,
  opts: { makina?: MakinaKind | null; takeza?: boolean; rules: Ruleset },
  result?: BreedingResult,
): TargetBreakdown {
  const levelSum = clampLevel(levelA) + clampLevel(levelB)
  // Points de base entiers, comme targetChance(), pour éviter les erreurs d'arrondi.
  const levelsBp = Math.round(TARGET_PER_LEVEL * 10_000) * levelSum
  const optiBp = opts.makina === 'optimakina' ? Math.round(opts.rules.optimakinaBonus * 10_000) : 0
  const takezaBp = opts.takeza ? Math.round(TAKEZA_BONUS * 10_000) : 0
  const rawBp = Math.round(TARGET_BASE * 10_000) + levelsBp + optiBp + takezaBp
  const noAlternative = !!result && result.targetSpecies.length > 0 && !result.outcomes.some((o) => !o.isTarget)
  return {
    base: TARGET_BASE,
    levelSum,
    levels: levelsBp / 10_000,
    optimakina: optiBp / 10_000,
    takeza: takezaBp / 10_000,
    raw: rawBp / 10_000,
    total: result ? result.targetChance : Math.min(10_000, rawBp) / 10_000,
    capped: rawBp > 10_000,
    noAlternative,
  }
}

// ---------- Objectif (monture visée) ----------

export interface GoalContext {
  goalId: number
  family: FamilyId
  /** Espèces de la recette la moins chère (cible comprise). */
  recipe: Set<number>
  /** Toutes les espèces d'un chemin possible vers la cible. */
  ancestors: Set<number>
}

const goalCache = new Map<number, GoalContext | null>()

/** Contexte d'objectif (recette et ascendance), mémorisé ; null sans objectif valable. */
export function goalContext(goalSpeciesId: number | null | undefined): GoalContext | null {
  if (goalSpeciesId === null || goalSpeciesId === undefined) return null
  if (goalCache.has(goalSpeciesId)) return goalCache.get(goalSpeciesId) ?? null
  const s = sp(goalSpeciesId)
  let ctx: GoalContext | null = null
  if (s && s.breedable) {
    const tree = cheapestRecipe(s.id)
    ctx = {
      goalId: s.id,
      family: s.family,
      recipe: new Set(tree ? requiredSpecies(tree).map((r) => r.speciesId) : [s.id]),
      ancestors: new Set(ancestorsOf(s.id)),
    }
  }
  goalCache.set(goalSpeciesId, ctx)
  return ctx
}

/** Poids d'une espèce pour l'objectif : 3 = objectif, 2 = recette, 1,5 = autre ascendance, 0,5 = hors objectif, 1 sans objectif. */
export function goalRelevance(speciesId: number, goal: GoalContext | null): number {
  if (!goal) return 1
  const s = sp(speciesId)
  if (!s || s.family !== goal.family) return 1
  if (speciesId === goal.goalId) return 3
  if (goal.recipe.has(speciesId)) return 2
  if (goal.ancestors.has(speciesId)) return 1.5
  return 0.5
}

function isGoalRelevant(speciesId: number, goal: GoalContext | null): boolean {
  return !!goal && (speciesId === goal.goalId || goal.recipe.has(speciesId) || goal.ancestors.has(speciesId))
}

// ---------- Options et résultats ----------

export interface MakinaPrice {
  price: number | null
  /** Faux si un ingrédient n'a pas de prix (le prix est alors une borne basse). */
  complete: boolean
}

export interface PairingOptions {
  rules: Ruleset
  objective: PairingObjective
  goalSpeciesId?: number | null
  makinaPolicy: MakinaPolicy
  /** Jour Takeza : +20 % de génération cible. */
  takeza?: boolean
  /**
   * Valeur nette (kamas) d'une monture fertile de cette espèce à ce niveau ; null si inconnue.
   * (Nommée `mountValue` et non `valueOf` : ce nom existe sur tout objet via Object.prototype.)
   */
  mountValue?: (speciesId: number, level: number) => number | null
  /** Prix d'une makina (economy.makinaCost) ; null si introuvable. */
  makinaCost?: (kind: MakinaKind, family: FamilyId, generation: number) => MakinaPrice | null
  /** Valeur d'un généton en kamas (economy.genetonKamasValue). Sans elle, les génétons valent 0 kamas. */
  genetonValue?: number
  /**
   * C_eff : coût net d'une tentative pour ce couple (remplacement des deux parents − valeur résiduelle
   * des stériles), pour la règle de prix de l'Optimakina. `complete: false` = borne haute (une sortie
   * des stériles n'est pas chiffrée). Voir `economyCoupleCost`.
   */
  coupleCost?: (a: BreedingParent, b: BreedingParent) => CoupleCostValue
  /** Poids des croisements à enfant monocolore (non validé ; défaut 1). */
  kappa?: number
  /** 'exact' (validé) ou 'max' (hypothèse alternative) — voir genetics.ts. */
  targetMode?: 'exact' | 'max'
  /** Simulateur : impose la makina (null = aucune) au lieu de la politique. */
  forcedMakina?: MakinaKind | null
  /** rankPairs : inclure aussi les montures fertiles (pas encore fécondes) pour anticiper. */
  includeFertile?: boolean
}

export type MakinaBasis = 'regle-prix' | 'heuristique' | 'reglage' | 'jamais' | 'inutile'

/**
 * Valeur d'une réussite retenue pour la règle de prix : C_eff / p (règle M-OPTI-01), écart de valeur
 * entre un bébé de la génération cible et une autre issue (bébés + génétons), ou écart de génétons.
 */
export type SuccessBasis = 'c-eff' | 'valeur-bebes' | 'genetons'

export const SUCCESS_BASIS_LABELS: Record<SuccessBasis, string> = {
  'c-eff': 'C_eff × Δ / p',
  'valeur-bebes': 'Δ × (valeur d’un bébé cible − valeur d’une autre issue)',
  genetons: 'Δ × écart de génétons × valeur du généton',
}

/** C_eff d'un couple : montant (borne haute si `complete` est faux), ou null si inconnu. */
export type CoupleCostValue = number | { value: number; complete: boolean } | null

function normalizeCoupleCost(c: CoupleCostValue | undefined): { value: number; complete: boolean } | null {
  if (c === null || c === undefined) return null
  if (typeof c === 'number') return Number.isFinite(c) ? { value: c, complete: true } : null
  return Number.isFinite(c.value) ? c : null
}

export interface MakinaAdvice {
  use: boolean
  kind: 'optimakina'
  /** Génération minimale de la makina (= génération cible, au moins 2). */
  generation: number
  price: number | null
  priceComplete: boolean
  /** Hausse effective de la chance de cible (min(1, B + Δ) − B). */
  gain: number
  /** p : chance de génération cible sans makina. */
  baseChance: number
  /** Valeur (kamas) d'une naissance cible au lieu d'une autre issue : C_eff / p, ou écart de valeur attendue. */
  successValue: number | null
  /** Critère de `successValue` (null si aucune valeur n'est calculable). */
  successBasis: SuccessBasis | null
  /** C_eff du couple (si fourni), et s'il est complet (sinon : borne haute). */
  coupleCost: number | null
  coupleCostComplete: boolean
  /** Prix maximal rentable = gain × valeur d'une réussite (= C_eff × Δ / p). */
  threshold: number | null
  /** Le seuil est une borne haute (C_eff incomplet) : seul un refus est certain. */
  thresholdIsUpperBound: boolean
  basis: MakinaBasis
  reason: string
}

export interface PairAnalysis {
  /** Résultat avec la makina retenue. */
  result: BreedingResult
  /** Résultat sans makina. */
  base: BreedingResult
  /** Résultat avec Optimakina (null si elle ne change rien). */
  withOptimakina: BreedingResult | null
  /** Makina retenue (politique ou choix imposé). */
  makina: MakinaKind | null
  makinaAdvice: MakinaAdvice
  /** Prix de la makina retenue (null si aucune ou prix introuvable). */
  makinaPrice: MakinaPrice | null
  /** Score selon l'objectif (points de progression, génétons ou kamas). */
  score: number
  /** Points de progression : Σ P(bébé nouveau) × génération × pertinence pour l'objectif. */
  progress: number
  /** Valeur attendue détaillée (si `mountValue` est fourni). */
  economics: MatingEconomics | null
  /** Bébés + génétons − makina, en kamas (si `mountValue` est fourni ; borne si incomplet). */
  expectedValue?: number
  valueComplete: boolean
  /** P(bébé = objectif) par bébé. */
  goalChance: number
  /** La génération cible contient l'objectif ou une étape de son chemin. */
  goalRelevant: boolean
  /**
   * Espèces utiles à l'objectif (recette, autre chemin, ou portées dans l'arbre) qu'un croisement hors
   * objectif consommerait (vide sinon).
   */
  consumesGoalParents: number[]
  /**
   * Coût d'opportunité (mêmes unités que `progress`) retiré du score en progression : Σ pertinence ×
   * génération des parents consommés hors objectif.
   */
  opportunityCost: number
  reasons: string[]
  warnings: string[]
}

export interface PairSuggestion extends PairAnalysis {
  key: string
  /** Le mâle. */
  a: Mount
  /** La femelle. */
  b: Mount
  /** Les deux montures sont fécondes (sinon : prévision avec includeFertile). */
  ready: boolean
  /**
   * Couple hors objectif qui consomme une monture utile à l'objectif alors que sa partenaire du plan
   * est en préparation (fertile) : attendre plutôt que `partnerId` soit féconde.
   */
  waitFor: { mountId: string; partnerId: string; targetSpecies: number[] }[]
  /**
   * Couples de cette paire d'espèces possibles avec les montures fertiles ou fécondes (M-STACK-01),
   * calculé pour les couples de l'objectif à partir de la cible G5 ; null sinon.
   */
  stackAttempts: number | null
}

// ---------- Optimakina ----------

function breedOpts(opts: PairingOptions): BreedingOptions {
  return { rules: opts.rules, takeza: opts.takeza, kappa: opts.kappa, targetMode: opts.targetMode }
}

/** Écart de valeur (bébés + génétons) entre une naissance de la génération cible et une autre issue. */
function outcomeSuccessValue(base: BreedingResult, opts: PairingOptions): number | null {
  const mountValue = opts.mountValue
  if (!mountValue) return null
  const gv = opts.genetonValue ?? 0
  let vt = 0
  let pt = 0
  let vo = 0
  let po = 0
  for (const o of base.outcomes) {
    const v = mountValue(o.speciesId, 1)
    if (v === null) return null
    const total = v + o.genetons * gv
    if (o.isTarget) {
      vt += o.probability * total
      pt += o.probability
    } else {
      vo += o.probability * total
      po += o.probability
    }
  }
  if (pt <= 0 || po <= 0) return null
  return base.babies * (vt / pt - vo / po)
}

/** Écart de génétons (en kamas) entre une naissance cible et une autre issue. */
function genetonSuccessValue(base: BreedingResult, opts: PairingOptions): number | null {
  if (opts.genetonValue === undefined) return null
  let gt = 0
  let pt = 0
  let go = 0
  let po = 0
  for (const o of base.outcomes) {
    if (o.isTarget) {
      gt += o.probability * o.genetons
      pt += o.probability
    } else {
      go += o.probability * o.genetons
      po += o.probability
    }
  }
  if (pt <= 0 || po <= 0) return null
  return base.babies * (gt / pt - go / po) * opts.genetonValue
}

/**
 * Conseil d'Optimakina (research/README.md §2.9, strategy.md §5.3, règle M-OPTI-01) :
 * - règle de prix, **toujours appliquée quand le prix et la valeur d'une réussite sont connus** :
 *   rentable si prix < C_eff × Δ / p (= gain × valeur d'une réussite). Sans C_eff : écart de génétons
 *   (objectif génétons) ou écart de valeur des bébés (sinon) ; le critère est noté dans `successBasis`.
 *   C_eff incomplet (borne haute) : seul le refus est certain ;
 * - règle indécidable (prix ou valeur inconnus, coût incomplet) : heuristique de la recherche —
 *   Optimakina dès la cible G6 (« systématique dès la G6 ») ; sur une étape G4–G5 de l'objectif
 *   (phase P2) ; jamais sur une cible G2–G3 sans prix.
 */
export function adviseOptimakina(
  base: BreedingResult,
  withOpti: BreedingResult | null,
  opts: PairingOptions,
  ctx: { goalRelevant: boolean; coupleCost?: CoupleCostValue },
): MakinaAdvice {
  const generation = base.makinaGenerationRequired
  const gain = withOpti ? Math.max(0, withOpti.targetChance - base.targetChance) : 0
  const priceInfo = opts.makinaCost?.('optimakina', base.family, generation) ?? null
  const price = priceInfo?.price ?? null
  const priceComplete = !!priceInfo && priceInfo.price !== null && priceInfo.complete
  const p = base.targetChance
  const cc = normalizeCoupleCost(ctx.coupleCost)
  let successValue: number | null = null
  let successBasis: SuccessBasis | null = null
  if (cc && p > 0) {
    successValue = Math.max(0, cc.value) / p
    successBasis = 'c-eff'
  } else if (opts.objective === 'genetons') {
    successValue = genetonSuccessValue(base, opts)
    successBasis = successValue === null ? null : 'genetons'
  } else {
    successValue = outcomeSuccessValue(base, opts)
    successBasis = successValue === null ? null : 'valeur-bebes'
  }
  const threshold = successValue !== null && gain > 0 ? successValue * gain : null
  const thresholdIsUpperBound = successBasis === 'c-eff' && !!cc && !cc.complete
  const common = {
    kind: 'optimakina' as const,
    generation,
    price,
    priceComplete,
    gain,
    baseChance: p,
    successValue,
    successBasis,
    coupleCost: cc ? Math.max(0, cc.value) : null,
    coupleCostComplete: !!cc && cc.complete,
    threshold,
    thresholdIsUpperBound,
  }

  if (gain <= 1e-9)
    return {
      ...common,
      use: false,
      basis: 'inutile',
      reason:
        base.targetChance >= 1 && base.outcomes.some((o) => !o.isTarget)
          ? 'Optimakina inutile : la génération cible est déjà à 100 %.'
          : 'Optimakina inutile : aucune autre issue possible, la génération cible est certaine.',
    }
  if (opts.makinaPolicy === 'jamais') return { ...common, use: false, basis: 'jamais', reason: 'Optimakina désactivée (politique « jamais »).' }
  if (opts.makinaPolicy === 'optimakina')
    return { ...common, use: true, basis: 'reglage', reason: `Optimakina à chaque accouplement (politique choisie) : +${pct(gain)} de génération cible.` }

  const t = base.targetGeneration
  const formula = successBasis ? SUCCESS_BASIS_LABELS[successBasis] : ''
  const ceffNote = successBasis === 'c-eff' && cc ? ` ; C_eff ${thresholdIsUpperBound ? '≤ ' : ''}${formatKamas(Math.max(0, cc.value))}` : ''
  const heuristic = (why: string): MakinaAdvice => {
    if (t >= OPTIMAKINA_SYSTEMATIC_GENERATION)
      return {
        ...common,
        use: true,
        basis: 'heuristique',
        reason: `Optimakina conseillée : ${why}cible G${t}${ctx.goalRelevant ? ', étape de votre objectif' : ''} — la recherche la recommande dès la cible G${OPTIMAKINA_SYSTEMATIC_GENERATION} (−40 à −65 % d'accouplements et de captures sur une chaîne G9). +${pct(gain)} de cible.`,
      }
    if (optimakinaHeuristicUse(t, ctx.goalRelevant))
      return {
        ...common,
        use: true,
        basis: 'heuristique',
        reason: `Optimakina conseillée à défaut de prix : ${why}cible G${t}, étape de votre objectif — la recherche la réserve aux étapes G4–G5 dont le prix reste sous le seuil ; saisissez son prix pour trancher. +${pct(gain)} de cible.`,
      }
    return {
      ...common,
      use: false,
      basis: 'heuristique',
      reason: `Pas d'Optimakina : ${why}cible G${t}${ctx.goalRelevant ? ', étape de votre objectif mais de génération basse' : ' sans enjeu particulier'} — sans prix sous le seuil, la recherche la réserve aux cibles G${OPTIMAKINA_SYSTEMATIC_GENERATION} et plus${ctx.goalRelevant ? ' (G4–G5 pour les étapes de l’objectif)' : ''}.`,
    }
  }

  if (threshold !== null && price !== null) {
    if (priceComplete && !thresholdIsUpperBound)
      return price < threshold
        ? { ...common, use: true, basis: 'regle-prix', reason: `Optimakina rentable : prix ${formatKamas(price)} < seuil ${formatKamas(threshold)} (${formula}${ceffNote} ; +${pct(gain)} de cible).` }
        : { ...common, use: false, basis: 'regle-prix', reason: `Optimakina non rentable ici : prix ${formatKamas(price)} ≥ seuil ${formatKamas(threshold)} (${formula}${ceffNote}).` }
    if (price >= threshold)
      return {
        ...common,
        use: false,
        basis: 'regle-prix',
        reason: priceComplete
          ? `Optimakina non rentable ici : prix ${formatKamas(price)} ≥ seuil maximal ${formatKamas(threshold)} (${formula}${ceffNote} ; une sortie des stériles n'est pas chiffrée, le vrai seuil est plus bas).`
          : `Optimakina non rentable ici : la partie connue de son coût (≥ ${formatKamas(price)}) dépasse déjà le seuil ${formatKamas(threshold)} (${formula}${ceffNote}).`,
      }
    return heuristic(
      priceComplete
        ? `seuil seulement borné (≤ ${formatKamas(threshold)}, une sortie des stériles n'est pas chiffrée), `
        : 'coût de l’Optimakina incomplet (règle de prix indécidable), ',
    )
  }
  return heuristic(
    price === null
      ? 'prix de l’Optimakina inconnu, '
      : threshold === null
        ? 'valeur d’une réussite inconnue (coût du couple ou prix des bébés à saisir), '
        : '',
  )
}

// ---------- C_eff : coût net d'une tentative (règle de prix de l'Optimakina) ----------

export interface CoupleCostConfig {
  /** Prix des objets (`usePriceContext()`). */
  ctx: PriceContext
  mountPrices: MountPriceContext
  /** Taxe d'HDV (0,02 = 2 %). */
  saleTax: number
  rules: Ruleset
  jobLevel: number
  /** Palier de carburant de fécondité et d'XP (en pratique `settings.preferredTier`). */
  tier: FuelTier
  /** Filet de capture des G1 (défaut : universel). */
  netKind?: NetKind
}

/** Obtention d'une monture fertile niv. 1 : capture (G1), valeur actuelle (prix de décision) ou production estimée. */
export type AcquisitionMethod = 'capture' | 'valeur' | 'production'

export const ACQUISITION_METHOD_LABELS: Record<AcquisitionMethod, string> = {
  capture: 'capture',
  valeur: 'valeur actuelle',
  production: 'production estimée (recette, clonage)',
}

export interface ParentCost {
  speciesId: number
  level: number
  /** Monture fertile niv. 1 : capture (G1), sinon min(valeur actuelle, production estimée) ; null si inconnue. */
  acquisition: number | null
  acquisitionMethod: AcquisitionMethod | null
  /** XP du niveau 1 au niveau du parent (Mangeoire, lot de 10). */
  leveling: number | null
  /** Fécondation (lot typique de 10). */
  fertility: number | null
  /** Coût de remplacement = obtention + XP + fécondation (null si un poste manque). */
  replacement: number | null
  /** Valeur résiduelle de la stérile : max(vente, extraction, brisage, ½ × (clone − refécondation)) ; borne basse si incomplète. */
  residual: number | null
  residualComplete: boolean
  residualKind: FateKind | 'clone' | null
  /** Remplacement − valeur résiduelle (borne haute si la valeur résiduelle est incomplète). */
  net: number | null
  /** Postes non chiffrés (français). */
  missing: string[]
}

export interface CoupleCostBreakdown {
  /** C_eff (borne haute si `complete` est faux), ou null si un coût de remplacement manque. */
  value: number | null
  complete: boolean
  parents: [ParentCost, ParentCost]
  missing: string[]
}

export interface CoupleCostModel {
  /** À passer en `PairingOptions.coupleCost`. */
  cost: (a: BreedingParent, b: BreedingParent) => CoupleCostValue
  breakdown: (a: BreedingParent, b: BreedingParent) => CoupleCostBreakdown
  parent: (p: BreedingParent) => ParentCost
}

/**
 * C_eff de la règle de prix de l'Optimakina (M-OPTI-01) à partir des prix de l'économie : pour chaque
 * parent, coût de remplacement (G1 capturable : capture ; sinon min(valeur actuelle, production
 * estimée par `expectedEffort` sans makina, avec clonage) ; + XP du niveau 1 au niveau du parent +
 * fécondation, lot typique de 10) moins la valeur résiduelle de la stérile (max des sorties nettes et
 * de ½ clone − refécondation, comme `sterileValue`). Un coût de remplacement inconnu → null ; une
 * sortie de stérile non chiffrée → C_eff borne haute (`complete: false`). Mémorisé.
 */
export function economyCoupleCost(cfg: CoupleCostConfig): CoupleCostModel {
  const ctx: PriceContext = { ...cfg.ctx, jobLevel: cfg.jobLevel }
  const netKind: NetKind = cfg.netKind ?? 'universel'
  const fert = fertilityCost({ tier: cfg.tier, batchSize: PADDOCK_SLOTS, ctx, rules: cfg.rules, jobLevel: cfg.jobLevel, model: 'typique' })
  const fertPer = fert.complete ? fert.perMount : null
  const valCache = new Map<string, MountValuation>()
  const val = (id: number, level: number, state: MountState) => {
    const k = `${id}|${level}|${state}`
    let v = valCache.get(k)
    if (!v) {
      v = mountValuation(id, level, { ctx, mountPrices: cfg.mountPrices, saleTax: cfg.saleTax, state })
      valCache.set(k, v)
    }
    return v
  }
  const lvlCache = new Map<string, number | null>()
  const lvl = (level: number, sage: boolean) => {
    const k = `${level}|${sage ? 1 : 0}`
    if (!lvlCache.has(k)) {
      const c = levelingCost(1, level, { tier: cfg.tier, batchSize: PADDOCK_SLOTS, sage, ctx, rules: cfg.rules, jobLevel: cfg.jobLevel })
      lvlCache.set(k, c.complete ? c.costPerMount : null)
    }
    return lvlCache.get(k) ?? null
  }
  const capCache = new Map<FamilyId, number | null>()
  const cap = (family: FamilyId) => {
    if (!capCache.has(family)) {
      const c = captureCost(family, netKind, ctx, { jobLevel: cfg.jobLevel })
      capCache.set(family, c.complete ? c.perMount : null)
    }
    return capCache.get(family) ?? null
  }
  const prodCache = new Map<string, number | null>()
  /** Production d'une monture fertile niv. 1 (parents de la recette au niveau `level`). */
  const production = (id: number, level: number): number | null => {
    const k = `${id}|${level}`
    if (prodCache.has(k)) return prodCache.get(k) ?? null
    let out: number | null = null
    const s = sp(id)
    const c = s ? cap(s.family) : null
    const l = lvl(level, false)
    if (s && c !== null && l !== null && fertPer !== null) {
      try {
        const e = expectedEffort(id, { parentLevel: level, makina: 'none', rules: cfg.rules, cloning: true })
        const intermediates = e.nodes.filter((n) => n.crossing !== null && n.speciesId !== id).reduce((sum, n) => sum + n.needed, 0)
        out = e.captures * c + (e.captures + intermediates) * l + e.fecundations * fertPer
      } catch {
        out = null
      }
    }
    prodCache.set(k, out)
    return out
  }
  const parentCache = new Map<string, ParentCost>()
  const parent = (p: BreedingParent): ParentCost => {
    const level = clampLevel(p.level)
    const sage = p.ability === 'sage'
    const k = `${p.speciesId}|${level}|${sage ? 1 : 0}`
    const hit = parentCache.get(k)
    if (hit) return hit
    const s = sp(p.speciesId)
    const missing: string[] = []
    let acquisition: number | null = null
    let acquisitionMethod: AcquisitionMethod | null = null
    if (s && s.generation === 1 && s.capturable) {
      acquisition = cap(s.family)
      acquisitionMethod = acquisition === null ? null : 'capture'
      if (acquisition === null) missing.push('prix du filet de capture')
    } else if (s) {
      const v = val(s.id, 1, 'fertile')
      const market = v.complete && v.best !== null ? v.best : null
      const prod = production(s.id, level)
      if (market !== null && (prod === null || market <= prod)) {
        acquisition = market
        acquisitionMethod = 'valeur'
      } else if (prod !== null) {
        acquisition = prod
        acquisitionMethod = 'production'
      } else missing.push(`prix de ${s.name} (ou des carburants et filets pour la produire)`)
    }
    const leveling = lvl(level, sage)
    if (leveling === null) missing.push('prix de la Mangeoire')
    if (fertPer === null) missing.push('prix des carburants de fécondité')
    const replacement = acquisition !== null && leveling !== null && fertPer !== null ? acquisition + leveling + fertPer : null
    // Valeur résiduelle de la stérile (comme economy.sterileValue, clone valorisé à son coût d'obtention).
    const direct = s ? val(s.id, level, 'sterile') : null
    const clone = acquisition !== null && fert.perMountHigh !== null ? 0.5 * Math.max(0, acquisition - (fert.complete ? (fert.perMount as number) : fert.perMountHigh)) : null
    let residual: number | null = null
    let residualKind: ParentCost['residualKind'] = null
    if (direct && direct.best !== null) {
      residual = direct.best
      residualKind = direct.bestKind
    }
    if (clone !== null && (residual === null || clone > residual + 1e-9)) {
      residual = clone
      residualKind = 'clone'
    }
    const residualComplete = !!direct && direct.complete
    if (direct && !direct.complete) missing.push(`prix de vente d'une ${s?.name ?? 'monture'} stérile (valeur résiduelle : borne basse)`)
    const net = replacement !== null ? replacement - (residual ?? 0) : null
    const out: ParentCost = { speciesId: p.speciesId, level, acquisition, acquisitionMethod, leveling, fertility: fertPer, replacement, residual, residualComplete, residualKind, net, missing }
    parentCache.set(k, out)
    return out
  }
  const breakdown = (a: BreedingParent, b: BreedingParent): CoupleCostBreakdown => {
    const pa = parent(a)
    const pb = parent(b)
    const value = pa.net !== null && pb.net !== null ? pa.net + pb.net : null
    return { value, complete: value !== null && pa.residualComplete && pb.residualComplete, parents: [pa, pb], missing: [...new Set([...pa.missing, ...pb.missing])] }
  }
  return {
    cost: (a, b) => {
      const bd = breakdown(a, b)
      return bd.value === null ? null : { value: bd.value, complete: bd.complete }
    },
    breakdown,
    parent,
  }
}

// ---------- Analyse d'un couple ----------

/**
 * Espèce utile à l'objectif que ce parent apporte : la sienne (recette ou autre chemin, objectif exclu)
 * ou celle qu'il porte dans son arbre (porteur : parent de génération supérieure utile au plan). Une G1
 * capturable sans arbre précieux n'en est pas une : une capture la remplace.
 */
function goalAsset(p: BreedingParent, goal: GoalContext, opts: { includeCapturable?: boolean } = {}): number | null {
  const self = sp(p.speciesId)
  if (!self || self.family !== goal.family) return null
  const carried = p.parents
    .slice(0, 2)
    .filter((id) => id !== goal.goalId && genOf(id) > self.generation && (goal.recipe.has(id) || goal.ancestors.has(id)))
    .sort((x, y) => genOf(y) - genOf(x))[0]
  if (carried !== undefined) return carried
  if (self.generation === 1 && self.capturable && !opts.includeCapturable) return null
  if (p.speciesId !== goal.goalId && (goal.recipe.has(p.speciesId) || goal.ancestors.has(p.speciesId))) return p.speciesId
  return null
}

/** Points de progression : bébés nouveaux (absents des deux arbres) × génération × pertinence. */
function progressPoints(a: BreedingParent, b: BreedingParent, result: BreedingResult, goal: GoalContext | null): number {
  const tree = new Set([a.speciesId, b.speciesId, ...a.parents.slice(0, 2), ...b.parents.slice(0, 2)])
  let s = 0
  for (const o of result.outcomes) {
    if (tree.has(o.speciesId)) continue
    s += o.probability * o.generation * goalRelevance(o.speciesId, goal)
  }
  return s * result.babies
}

const DIRTY_TREE_WARNING_PREFIX = 'Un arbre contient déjà la génération cible'

function pairNotes(
  a: BreedingParent,
  b: BreedingParent,
  an: { result: BreedingResult; base: BreedingResult; makina: MakinaKind | null; makinaAdvice: MakinaAdvice; goalChance: number; goalRelevant: boolean },
  opts: PairingOptions,
  goal: GoalContext | null,
): { reasons: string[]; warnings: string[] } {
  const { result, makina } = an
  const reasons: string[] = []
  const warnings: string[] = []
  const t = result.targetGeneration
  const targets = result.targetSpecies.map(nameOf).join(', ')

  if (goal && an.goalChance > 0) reasons.push(`Objectif ${nameOf(goal.goalId)} : ${pct(an.goalChance)} par bébé.`)
  else if (goal && an.goalRelevant) reasons.push(`Étape du chemin vers ${nameOf(goal.goalId)} : ${targets}.`)

  if (result.recordPossible)
    reasons.push(`${ruleTitle('M-CLEAN-01')} : naissance « record » possible, ${result.genetonsIfRecord} génétons si le bébé est de la génération cible.`)
  else
    warnings.push(
      `${ruleTitle('M-CLEAN-01')} : un arbre contient déjà une G${result.maxTreeGeneration} (≥ cible G${t}) — bonus de cible partagé avec l'arbre et aucun généton. À éviter si une autre partenaire existe.`,
    )

  if (t === 10)
    for (const x of [a, b]) {
      const sx = sp(x.speciesId)
      const carried = x.parents.slice(0, 2).find((id) => genOf(id) === 9)
      if (sx && sx.generation < 9 && carried !== undefined)
        reasons.push(`${ruleTitle('M-CARRIER-01')} : ${sx.name} porte ${nameOf(carried)} (G9) dans son arbre → cible G10 sans sacrifier de G9.`)
    }

  if (genOf(a.speciesId) === 10 && genOf(b.speciesId) === 10)
    reasons.push(`${ruleTitle('M-G10OUT-01')} : dernier accouplement G10 × G10 (${pct(result.targetChance)} de G10), puis vendre ou extraire.`)

  const levelSum = clampLevel(a.level) + clampLevel(b.level)
  if (levelSum < RECOMMENDED_LEVEL_SUM && result.targetChance < 1) {
    const plus = Math.min(1 - result.targetChance, TARGET_PER_LEVEL * (RECOMMENDED_LEVEL_SUM - levelSum))
    if (plus > 0)
      warnings.push(
        `${ruleTitle('M-LEVEL-01')} : ${levelSum} niveaux cumulés ; amener chaque parent vers le niveau 40 (Mangeoire en 2e jauge) ajouterait +${pct(plus)} de cible.`,
      )
  }

  if (makina === 'optimakina') {
    reasons.push(`${ruleTitle('M-MAKGEN-01')} : Optimakina de génération ≥ G${result.makinaGenerationRequired} (une G${result.makinaGenerationRequired} suffit).`)
    if (result.targetChance >= 1 && an.base.targetChance < 1) reasons.push(`${ruleTitle('M-100PCT')} : 100 % de génération cible avec l'Optimakina.`)
  } else if (makina === 'animakina') {
    if (opts.rules.animakina === 'capacite') warnings.push(`${ruleTitle('M-ANIMA-36')} : ${STRATEGY.matingRules.find((r) => r.id === 'M-ANIMA-36')?.then ?? ''}`)
    else reasons.push(`${ruleTitle('M-ANIMA-37')} : choisissez le sexe du bébé (utile si ce sexe manque dans l'étable).`)
  } else if (makina === 'kromakina') {
    reasons.push(`${ruleTitle('M-KROMA-01')} : Caméléone 100 %, à réserver aux montures vendues comme apparat.`)
  }
  if (makina && makina !== 'optimakina' && an.makinaAdvice.use)
    warnings.push(`Une seule makina par accouplement : ${theMakina(makina)} remplace l'Optimakina conseillée (+${pct(an.makinaAdvice.gain)} de cible perdus).`)

  if (opts.takeza) reasons.push(`${ruleTitle('M-TAKEZA-01')} : +${pct(TAKEZA_BONUS)} de génération cible aujourd'hui.`)

  if (opts.objective === 'genetons' && opts.rules.id === '3.6' && result.genetonsIfRecord >= 240)
    warnings.push(`${ruleTitle('M-GENETON-01')} : le barème 3.7 (bêta) double environ les génétons ; si la 3.7 est imminente, reporter ce gros accouplement.`)

  for (const w of result.warnings) if (!w.startsWith(DIRTY_TREE_WARNING_PREFIX)) warnings.push(w)
  return { reasons, warnings }
}

/**
 * Analyse complète d'un couple (parents vus par le moteur) : résultat sans makina, avec Optimakina,
 * conseil de makina, résultat retenu, score selon l'objectif, valeur attendue, raisons et avertissements.
 * Lève une erreur si les deux montures ne peuvent pas s'accoupler (familles différentes, spéciale).
 */
export function analyzePair(a: BreedingParent, b: BreedingParent, opts: PairingOptions, goal: GoalContext | null = goalContext(opts.goalSpeciesId)): PairAnalysis {
  const bo = breedOpts(opts)
  const base = breed(a, b, bo)
  const canOpti = base.targetChance < 1 && base.outcomes.some((o) => !o.isTarget)
  const withOptimakina = canOpti ? breed(a, b, { ...bo, makina: 'optimakina' }) : null
  const goalRelevant = base.targetSpecies.some((id) => isGoalRelevant(id, goal))
  const coupleCost = opts.coupleCost ? opts.coupleCost(a, b) : null
  const makinaAdvice = adviseOptimakina(base, withOptimakina, opts, { goalRelevant, coupleCost })

  const makina: MakinaKind | null = opts.forcedMakina !== undefined ? opts.forcedMakina : makinaAdvice.use ? 'optimakina' : null
  const result =
    makina === null ? base : makina === 'optimakina' ? (withOptimakina ?? breed(a, b, { ...bo, makina })) : breed(a, b, { ...bo, makina })
  const makinaPrice = makina ? (opts.makinaCost?.(makina, result.family, result.makinaGenerationRequired) ?? null) : null

  const goalChance = goal ? (result.outcomes.find((o) => o.speciesId === goal.goalId)?.probability ?? 0) : 0
  const progress = progressPoints(a, b, result, goal)

  // Parent utile à l'objectif consommé par un croisement hors objectif (il manquera à sa recette).
  const consumesGoalParents: number[] = []
  let opportunityCost = 0
  if (goal && !goalRelevant && goalChance === 0)
    for (const x of [a, b]) {
      const asset = goalAsset(x, goal)
      if (asset === null) continue
      consumesGoalParents.push(asset)
      opportunityCost += goalRelevance(asset, goal) * genOf(asset)
    }

  let economics: MatingEconomics | null = null
  if (opts.mountValue)
    economics = matingEconomics(result, {
      valueOf: opts.mountValue,
      makinaCost: makina ? (makinaPrice ?? { price: null, complete: false }) : null,
      genetonValue: opts.genetonValue ?? 0,
    })
  const makinaKnown = !makina || (makinaPrice !== null && makinaPrice.price !== null && makinaPrice.complete)
  const valueComplete = economics ? economics.complete : false

  let score: number
  if (opts.objective === 'progression') score = progress - opportunityCost
  else if (opts.objective === 'genetons') score = result.expectedGenetons
  else if (economics) score = economics.expectedNet
  else score = result.expectedGenetons * (opts.genetonValue ?? 0) - (makinaPrice?.price ?? 0)

  const an = { result, base, makina, makinaAdvice, goalChance, goalRelevant }
  const { reasons, warnings } = pairNotes(a, b, an, opts, goal)
  if (makina && !makinaKnown)
    warnings.push(`Coût de ${theMakina(makina)} G${result.makinaGenerationRequired} incomplet : saisissez son prix (ou celui de ses ingrédients) dans la page Prix.`)
  if (goal && consumesGoalParents.length)
    warnings.push(
      `Consomme ${consumesGoalParents.map(nameOf).join(' et ')}, utile${consumesGoalParents.length > 1 ? 's' : ''} à votre objectif ${nameOf(goal.goalId)}, sur un croisement hors objectif : gardez-${consumesGoalParents.length > 1 ? 'les' : 'la'} pour ${consumesGoalParents.length > 1 ? 'leurs croisements' : 'son croisement'} du plan${opts.objective === 'progression' ? ` (score réduit de ${formatNumberFr(opportunityCost)} pts)` : ''}.`,
    )

  return {
    result,
    base,
    withOptimakina,
    makina,
    makinaAdvice,
    makinaPrice,
    score,
    progress,
    economics,
    expectedValue: economics ? economics.expectedNet : undefined,
    valueComplete,
    goalChance,
    goalRelevant,
    consumesGoalParents,
    opportunityCost,
    reasons,
    warnings,
  }
}

// ---------- Classement des couples de l'étable ----------

function locationLabel(m: Mount): string {
  return m.location.kind === 'enclos' ? `enclos ${m.location.paddock}` : m.location.kind === 'inventaire' ? 'inventaire' : 'étable'
}

function parentKey(m: Mount): string {
  return `${m.speciesId}:${m.parents.slice(0, 2).join(',')}:${clampLevel(m.level)}:${m.ability === 'reproducteur' ? 'R' : ''}`
}

/** Raisons bloquantes hors fécondité (familles, sexes, spéciales). */
function hardBlockers(a: Mount, b: Mount): string[] {
  const sa = sp(a.speciesId)
  const sb = sp(b.speciesId)
  if (!sa || !sb) return ['Espèce inconnue.']
  const out: string[] = []
  if (a.id === b.id) out.push('Il faut deux montures différentes.')
  if (sa.family !== sb.family) out.push('Familles différentes.')
  if (a.gender === b.gender) out.push('Il faut un mâle et une femelle.')
  if (!sa.breedable || !sb.breedable) out.push('Monture spéciale non élevable.')
  for (const m of [a, b]) if (effectiveFertility(m) === 'sterile' || effectiveFertility(m) === 'senile') out.push(`${mountName(m)} ne peut plus s'accoupler.`)
  return out
}

/**
 * Tous les couples mâle × femelle féconds de même famille (matingBlockers vide), analysés et triés
 * par score décroissant (puis chance de cible, génération cible). Avec `includeFertile`, les montures
 * fertiles sont incluses (prévision, `ready = false`).
 */
export function rankPairs(mounts: Mount[], opts: PairingOptions): PairSuggestion[] {
  const goal = goalContext(opts.goalSpeciesId)
  const eligible = mounts.filter((m) => {
    const f = effectiveFertility(m)
    return f === 'feconde' || (opts.includeFertile === true && f === 'fertile')
  })
  const males = eligible.filter((m) => m.gender === 'male')
  const females = eligible.filter((m) => m.gender === 'femelle')
  const cache = new Map<string, PairAnalysis | null>()
  const analyze = (m: Mount, f: Mount): PairAnalysis | null => {
    const ck = `${parentKey(m)}|${parentKey(f)}`
    let an = cache.get(ck)
    if (an === undefined) {
      try {
        an = analyzePair(toBreedingParent(m), toBreedingParent(f), opts, goal)
      } catch {
        an = null
      }
      cache.set(ck, an)
    }
    return an
  }
  // Montures encore utilisables comme parents (fertiles ou fécondes), par espèce et par sexe (M-STACK-01).
  const breeders = new Map<string, number>()
  const pending: Mount[] = []
  for (const m of mounts) {
    const f = effectiveFertility(m)
    if (f !== 'feconde' && f !== 'fertile') continue
    breeders.set(`${m.speciesId}|${m.gender}`, (breeders.get(`${m.speciesId}|${m.gender}`) ?? 0) + 1)
    if (f === 'fertile') pending.push(m)
  }
  const count = (speciesId: number, g: Gender) => breeders.get(`${speciesId}|${g}`) ?? 0
  const attemptsFor = (x: number, y: number) =>
    x === y ? Math.min(count(x, 'male'), count(x, 'femelle')) : Math.min(count(x, 'male'), count(y, 'femelle')) + Math.min(count(x, 'femelle'), count(y, 'male'))

  const out: PairSuggestion[] = []
  for (const m of males)
    for (const f of females) {
      const ready = effectiveFertility(m) === 'feconde' && effectiveFertility(f) === 'feconde'
      const blockers = ready ? matingBlockers(m, f) : hardBlockers(m, f)
      if (blockers.length) continue
      const an = analyze(m, f)
      if (!an) continue
      const warnings = [...an.warnings]
      for (const x of [m, f]) {
        if (x.location.kind !== 'etable')
          warnings.push(`${ruleTitle('M-STABLE-01')} : déplacer ${mountName(x)} (${locationLabel(x)}) dans l'étable avant d'accoupler.`)
        if (effectiveFertility(x) !== 'feconde') warnings.push(`${mountName(x)} n'est pas encore féconde : couple à préparer.`)
      }

      // Partenaire de l'objectif encore en préparation : attendre plutôt que consommer la monture utile
      // (une G1 capturable aussi : sa fécondation, elle, ne se recapture pas).
      const waitFor: PairSuggestion['waitFor'] = []
      let score = an.score
      if (goal && !an.goalRelevant && an.goalChance === 0)
        for (const x of [m, f]) {
          if (goalAsset(toBreedingParent(x), goal, { includeCapturable: true }) === null) continue
          const other = x === m ? f : m
          const candidates = pending
            .filter((p) => p.id !== x.id && p.id !== other.id && p.gender !== x.gender && hardBlockers(x, p).length === 0)
            .map((p) => ({ p, an: x.gender === 'male' ? analyze(x, p) : analyze(p, x) }))
            .filter((c): c is { p: Mount; an: PairAnalysis } => !!c.an && (c.an.goalRelevant || c.an.goalChance > 0))
            .sort((u, v) => v.an.goalChance - u.an.goalChance || v.an.progress - u.an.progress || totalGauges(v.p) - totalGauges(u.p))
          const best = candidates[0]
          if (!best) continue
          waitFor.push({ mountId: x.id, partnerId: best.p.id, targetSpecies: best.an.result.targetSpecies })
          // Progression : toujours attendre ; génétons ou kamas : si le couple de l'objectif rapporte au moins autant.
          if (opts.objective === 'progression' || best.an.score >= score) score = Math.min(score, 0)
          warnings.push(
            `Attendez plutôt que ${mountName(best.p)} soit féconde : ${mountName(x)} × ${mountName(best.p)} vise ${best.an.result.targetSpecies.map(nameOf).join(', ')} (G${best.an.result.targetGeneration}), une étape de votre objectif.`,
          )
        }

      // Accumuler avant de tenter (M-STACK-01) : couples de l'objectif à partir de la cible G5.
      let stackAttempts: number | null = null
      if (goal && (an.goalRelevant || an.goalChance > 0) && an.result.targetGeneration >= STACK_MIN_GENERATION) {
        stackAttempts = attemptsFor(m.speciesId, f.speciesId)
        if (stackAttempts < STACK_MIN_ATTEMPTS) {
          const p = an.goalChance > 0 ? an.goalChance : an.result.targetChance
          warnings.push(
            `${ruleTitle('M-STACK-01')} : produisez d'abord des parents pour au moins ${STACK_MIN_ATTEMPTS} tentatives (${stackAttempts} couple${stackAttempts > 1 ? 's' : ''} ${nameOf(m.speciesId)} × ${nameOf(f.speciesId)} possible${stackAttempts > 1 ? 's' : ''} avec vos montures fertiles ou fécondes) : une tentative à ${pct(p)} échoue ${pct(1 - p)} du temps.`,
          )
        }
      }
      out.push({ ...an, score, key: `${m.id}|${f.id}`, a: m, b: f, ready, reasons: [...an.reasons], warnings, waitFor, stackAttempts })
    }
  return out.sort(
    (x, y) =>
      y.score - x.score ||
      y.result.targetChance - x.result.targetChance ||
      y.result.targetGeneration - x.result.targetGeneration ||
      x.key.localeCompare(y.key),
  )
}

function totalGauges(m: Mount): number {
  return m.endurance + m.maturity + m.love
}

// ---------- Plan d'appariement ----------

function unorderedKey(x: string, y: string): string {
  return x < y ? `${x}|${y}` : `${y}|${x}`
}

/**
 * Ensemble de couples disjoints (chaque monture une seule fois) de score total élevé : glouton par
 * score décroissant, puis échanges de partenaires entre deux couples tant que la somme augmente.
 * Seuls les couples de score > `minScore` (défaut 0) sont retenus. Résultat trié par score.
 */
export function bestDisjointPairs<T extends { a: { id: string }; b: { id: string }; score: number }>(suggestions: T[], opts: { minScore?: number } = {}): T[] {
  const min = opts.minScore ?? 0
  const sorted = suggestions.filter((s) => s.score > min && s.a.id !== s.b.id).sort((x, y) => y.score - x.score)
  const byKey = new Map<string, T>()
  for (const s of sorted) {
    const k = unorderedKey(s.a.id, s.b.id)
    const prev = byKey.get(k)
    if (!prev || prev.score < s.score) byKey.set(k, s)
  }
  const used = new Set<string>()
  const chosen: T[] = []
  for (const s of sorted) {
    if (used.has(s.a.id) || used.has(s.b.id)) continue
    chosen.push(s)
    used.add(s.a.id)
    used.add(s.b.id)
  }
  // Amélioration locale (2-échange) : (p.a, p.b) + (q.a, q.b) → (p.a, q.b) + (q.a, p.b) ou (p.a, q.a) + (p.b, q.b).
  let improved = true
  for (let guard = 0; improved && guard < 100; guard++) {
    improved = false
    for (let i = 0; i < chosen.length; i++)
      for (let j = i + 1; j < chosen.length; j++) {
        const p = chosen[i]
        const q = chosen[j]
        const options: [T | undefined, T | undefined][] = [
          [byKey.get(unorderedKey(p.a.id, q.b.id)), byKey.get(unorderedKey(q.a.id, p.b.id))],
          [byKey.get(unorderedKey(p.a.id, q.a.id)), byKey.get(unorderedKey(p.b.id, q.b.id))],
        ]
        for (const [x, y] of options)
          if (x && y && x.score + y.score > p.score + q.score + 1e-9) {
            chosen[i] = x
            chosen[j] = y
            improved = true
            break
          }
      }
  }
  return chosen.sort((x, y) => y.score - x.score)
}

// ---------- Enregistrement d'une naissance ----------

export interface BabyChoice {
  speciesId: number
  gender: Gender
  ability?: Ability | null
  /** Sérénité de naissance si connue (aléatoire en jeu ; défaut 0). */
  serenity?: number
  name?: string
}

/** Entrée de journal « accouplement » (même forme que le store journal, sans `kind`). */
export interface MatingLog {
  parentA: number
  parentB: number
  babies: number[]
  targetGeneration: number
  targetChance: number
  makina: string | null
  genetons: number
  jobXp: number
}

export type NewBabyMount = Omit<Mount, 'id' | 'createdAt' | 'updatedAt'>

export interface MatingRecord {
  /** Résultat du modèle pour ce couple (null si l'accouplement est impossible). */
  result: BreedingResult | null
  /** Bébés à ajouter à l'étable. */
  babies: NewBabyMount[]
  /** Parents devenus stériles. */
  parentUpdates: { id: string; patch: Pick<Mount, 'fertility'> }[]
  log: MatingLog | null
  genetons: number
  jobXp: number
  /** Bébés de la génération cible. */
  targetBirths: number
  /** Erreurs bloquantes (rien ne doit être enregistré). */
  errors: string[]
  /** Points à vérifier (l'enregistrement reste possible). */
  warnings: string[]
}

/**
 * Prépare l'enregistrement d'un accouplement réel : bébés (babyMount, niveau 1, étable), parents
 * stériles, génétons (par bébé « record », Reproducteur compris), XP d'Éleveur et entrée de journal.
 * Ne modifie rien : la page applique `babies`, `parentUpdates` et `log`.
 */
export function recordMating(
  a: Mount,
  b: Mount,
  babies: BabyChoice[],
  opts: { rules: Ruleset; makina?: MakinaKind | null; takeza?: boolean; kappa?: number; targetMode?: 'exact' | 'max' },
): MatingRecord {
  const empty: MatingRecord = { result: null, babies: [], parentUpdates: [], log: null, genetons: 0, jobXp: 0, targetBirths: 0, errors: [], warnings: [] }
  const errors = hardBlockers(a, b)
  if (babies.length < 1) errors.push('Indiquez au moins un bébé.')
  if (babies.length > 2) errors.push('Un accouplement donne au plus 2 bébés (Reproducteur).')
  const sa = sp(a.speciesId)
  for (const c of babies) {
    const s = sp(c.speciesId)
    if (!s) errors.push(`Espèce de bébé inconnue (#${c.speciesId}).`)
    else if (sa && s.family !== sa.family) errors.push(`${s.name} n'est pas de la famille des parents.`)
    else if (!s.breedable) errors.push(`${s.name} ne peut pas naître d'un accouplement.`)
  }
  if (errors.length) return { ...empty, errors }

  let result: BreedingResult
  try {
    result = breed(toBreedingParent(a), toBreedingParent(b), { rules: opts.rules, makina: opts.makina ?? null, takeza: opts.takeza, kappa: opts.kappa, targetMode: opts.targetMode })
  } catch (e) {
    return { ...empty, errors: [e instanceof Error ? e.message : String(e)] }
  }

  const warnings: string[] = []
  for (const m of [a, b]) {
    const f = effectiveFertility(m)
    if (f !== 'feconde') warnings.push(`${mountName(m)} n'est pas notée féconde dans l'application (${f}) : vérifiez ses jauges.`)
  }
  if (babies.length !== result.babies)
    warnings.push(
      result.babies === 2
        ? 'Un parent est Reproducteur : le modèle attend 2 bébés.'
        : 'Aucun parent n’est Reproducteur : le modèle attend 1 seul bébé.',
    )
  for (const c of babies)
    if (!result.outcomes.some((o) => o.speciesId === c.speciesId))
      warnings.push(`${nameOf(c.speciesId)} n'est pas une issue prévue par le modèle : notez-le, cela aide à valider le modèle.`)

  const record = parentGenetons(a.speciesId, opts.rules) + parentGenetons(b.speciesId, opts.rules)
  let genetons = 0
  let targetBirths = 0
  for (const c of babies) {
    const g = genOf(c.speciesId)
    if (g > result.maxTreeGeneration) genetons += record
    if (g === result.targetGeneration) targetBirths++
  }
  const jobXp = opts.rules.matingXpPerGeneration * (genOf(a.speciesId) + genOf(b.speciesId)) * babies.length

  const newBabies: NewBabyMount[] = babies.map((c) => {
    const m: NewBabyMount = { ...babyMount(c.speciesId, c.gender, a, b, Math.max(-5000, Math.min(5000, Math.round(c.serenity ?? 0)))), ability: c.ability ?? null }
    if (c.name?.trim()) m.name = c.name.trim()
    return m
  })

  return {
    result,
    babies: newBabies,
    parentUpdates: [
      { id: a.id, patch: { fertility: 'sterile' } },
      { id: b.id, patch: { fertility: 'sterile' } },
    ],
    log: {
      parentA: a.speciesId,
      parentB: b.speciesId,
      babies: babies.map((c) => c.speciesId),
      targetGeneration: result.targetGeneration,
      targetChance: result.targetChance,
      makina: opts.makina ?? null,
      genetons,
      jobXp,
    },
    genetons,
    jobXp,
    targetBirths,
    errors: [],
    warnings,
  }
}

// ---------- Clonage après les accouplements ----------

export interface ClonePair {
  a: Mount
  b: Mount
  family: FamilyId
  generation: number
  /** Même couleur : couleur du clone certaine (sinon 50/50). */
  sameSpecies: boolean
  /** Même sexe : sexe du clone certain (le clone garde le sexe de la monture conservée). */
  sameGender: boolean
  /** Même catégorie d'arbre (porteuse, arbre propre, ordinaire) : généalogie équivalente quel que soit le tirage. */
  sameTree: boolean
  /** Couleur, sexe et arbre identiques : résultat entièrement connu d'avance. */
  certain: boolean
}

/** Texte court d'une paire de clonage (« même couleur, même sexe : résultat certain », « couleur certaine ; sexe et généalogie : 50/50 »…). */
export function clonePairSummary(p: Pick<ClonePair, 'sameSpecies' | 'sameGender' | 'sameTree' | 'certain'>): string {
  if (p.certain) return 'même couleur, même sexe, même arbre : résultat certain'
  if (p.sameSpecies) return 'couleur certaine ; sexe et généalogie : ceux de la monture gardée (50/50)'
  return 'couleurs différentes : couleur, sexe et généalogie de la monture gardée (50/50)'
}

/**
 * Paires de montures stériles clonables (même famille et même génération, M-CLONE-01) : d'abord
 * même couleur (même sexe et même arbre en priorité, `pairForCloning`), puis couleurs différentes.
 * Avec `involving`, seules les paires contenant au moins une de ces montures sont renvoyées.
 */
export function sterileClonePairs(mounts: Mount[], opts: { involving?: string[] } = {}): ClonePair[] {
  const groups = new Map<string, Mount[]>()
  for (const m of mounts) {
    const s = sp(m.speciesId)
    if (!s || !s.breedable || effectiveFertility(m) !== 'sterile') continue
    const k = `${s.family}|${s.generation}`
    groups.set(k, [...(groups.get(k) ?? []), m])
  }
  const focus = opts.involving ? new Set(opts.involving) : null
  const focusFirst = (list: Mount[]) => (focus ? [...list].sort((x, y) => Number(focus.has(y.id)) - Number(focus.has(x.id))) : list)
  const out: ClonePair[] = []
  for (const list of groups.values()) {
    const bySpecies = new Map<number, Mount[]>()
    for (const m of list) bySpecies.set(m.speciesId, [...(bySpecies.get(m.speciesId) ?? []), m])
    const leftovers: Mount[] = []
    for (const same of bySpecies.values()) {
      // Les montures « en vue » d'abord, pour qu'elles trouvent une partenaire.
      const r = pairForCloning(focusFirst(same), (m) => m)
      for (const [a, b] of r.pairs) out.push(clonePair(a, b))
      leftovers.push(...r.leftovers)
    }
    leftovers.sort((x, y) => (focus ? Number(focus.has(y.id)) - Number(focus.has(x.id)) : 0) || x.speciesId - y.speciesId)
    for (const [a, b] of pairForCloning(leftovers, (m) => m).pairs) out.push(clonePair(a, b))
  }
  return out
    .filter((p) => cloningBlockers(p.a, p.b).length === 0)
    .filter((p) => !focus || focus.has(p.a.id) || focus.has(p.b.id))
    .sort((x, y) => y.generation - x.generation || Number(y.sameSpecies) - Number(x.sameSpecies) || Number(y.certain) - Number(x.certain))
}

function clonePair(a: Mount, b: Mount): ClonePair {
  const s = sp(a.speciesId) as Species
  const sameSpecies = a.speciesId === b.speciesId
  const sameGender = a.gender === b.gender
  const sameTree = cloneTreeKind(a) === cloneTreeKind(b)
  return { a, b, family: s.family, generation: s.generation, sameSpecies, sameGender, sameTree, certain: sameSpecies && sameGender && sameTree }
}

// ---------- Calibration du modèle sur le journal ----------

export interface MatingLogLike {
  babies: number[]
  targetGeneration: number
  targetChance: number
  genetons: number
  jobXp: number
}

export interface CalibrationBucket {
  key: string
  label: string
  births: number
  /** Bébés de la génération cible observés. */
  successes: number
  /** Bébés de la génération cible attendus (Σ B par bébé). */
  expected: number
}

export interface MatingCalibration {
  matings: number
  births: number
  successes: number
  expected: number
  /** Écart-type de `successes` sous le modèle (√Σ B(1 − B)). */
  sd: number
  /** (observé − attendu) / écart-type ; null si non calculable. */
  z: number | null
  verdict: 'insuffisant' | 'conforme' | 'au-dessus' | 'en-dessous'
  genetons: number
  jobXp: number
  byGeneration: CalibrationBucket[]
  byChance: CalibrationBucket[]
}

const CHANCE_BUCKETS: { key: string; label: string; lo: number; hi: number }[] = [
  { key: 'lt40', label: '< 40 %', lo: 0, hi: 0.4 },
  { key: '40-50', label: '40 – 50 %', lo: 0.4, hi: 0.5 },
  { key: '50-60', label: '50 – 60 %', lo: 0.5, hi: 0.6 },
  { key: '60-80', label: '60 – 80 %', lo: 0.6, hi: 0.8 },
  { key: '80-100', label: '80 – 99 %', lo: 0.8, hi: 0.9999 },
  { key: '100', label: '100 %', lo: 0.9999, hi: Infinity },
]

/**
 * Compare les naissances réelles du journal au modèle : bébés de la génération cible observés contre
 * Σ B attendu (chaque bébé est un tirage indépendant de probabilité B), par génération cible et par
 * tranche de chance ; totaux de génétons et d'XP.
 */
export function matingCalibration(entries: MatingLogLike[]): MatingCalibration {
  let births = 0
  let successes = 0
  let expected = 0
  let variance = 0
  let genetons = 0
  let jobXp = 0
  const byGen = new Map<number, CalibrationBucket>()
  const byChance = new Map<string, CalibrationBucket>()
  for (const e of entries) {
    genetons += e.genetons || 0
    jobXp += e.jobXp || 0
    const p = Math.max(0, Math.min(1, e.targetChance))
    const bucketDef = CHANCE_BUCKETS.find((b) => p >= b.lo && p < b.hi) ?? CHANCE_BUCKETS[0]
    const gb = byGen.get(e.targetGeneration) ?? { key: `G${e.targetGeneration}`, label: `G${e.targetGeneration}`, births: 0, successes: 0, expected: 0 }
    const cb = byChance.get(bucketDef.key) ?? { key: bucketDef.key, label: bucketDef.label, births: 0, successes: 0, expected: 0 }
    for (const baby of e.babies) {
      const ok = genOf(baby) === e.targetGeneration ? 1 : 0
      births++
      successes += ok
      expected += p
      variance += p * (1 - p)
      for (const b of [gb, cb]) {
        b.births++
        b.successes += ok
        b.expected += p
      }
    }
    byGen.set(e.targetGeneration, gb)
    byChance.set(bucketDef.key, cb)
  }
  const sd = Math.sqrt(variance)
  const z = sd > 0 ? (successes - expected) / sd : null
  const verdict: MatingCalibration['verdict'] =
    births < CALIBRATION_MIN_BIRTHS || z === null ? 'insuffisant' : Math.abs(z) <= 2 ? 'conforme' : z > 0 ? 'au-dessus' : 'en-dessous'
  return {
    matings: entries.length,
    births,
    successes,
    expected,
    sd,
    z,
    verdict,
    genetons,
    jobXp,
    byGeneration: [...byGen.entries()].sort((x, y) => x[0] - y[0]).map(([, b]) => b),
    byChance: CHANCE_BUCKETS.map((d) => byChance.get(d.key)).filter((b): b is CalibrationBucket => !!b && b.births > 0),
  }
}
