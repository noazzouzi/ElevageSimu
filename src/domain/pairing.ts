// Accouplement : analyse d'un couple, classement des couples possibles de l'étable, plan
// d'appariement (chaque monture une seule fois), conseil d'Optimakina, enregistrement d'une naissance,
// suggestions de clonage et calibration du modèle sur le journal.
//
// Module pur (aucun React, aucun store). S'appuie sur breed() (genetics.ts, modèle de naissance
// validé sur les captures en jeu), matingEconomics() (economy.ts) et les règles d'accouplement de la
// recherche (STRATEGY.matingRules, research/strategy.md §5).
import { getSpecies, STRATEGY } from '../data'
import { formatKamas } from '../lib/format'
import { ancestorsOf, cheapestRecipe, requiredSpecies } from './breedingPath'
import { matingEconomics, type MatingEconomics } from './economy'
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
import type { Ruleset } from './rules'
import type { Ability, FamilyId, Gender, MakinaKind, Mount, Species } from './types'

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

/** Génération cible à partir de laquelle la recherche recommande l'Optimakina systématique (M-OPTI-01). */
export const OPTIMAKINA_SYSTEMATIC_GENERATION = 6

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
  /** C_eff : coût net du couple (obtention + fécondation − valeur résiduelle), pour la règle de prix. */
  coupleCost?: (a: BreedingParent, b: BreedingParent) => number | null
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

export interface MakinaAdvice {
  use: boolean
  kind: 'optimakina'
  /** Génération minimale de la makina (= génération cible, au moins 2). */
  generation: number
  price: number | null
  priceComplete: boolean
  /** Hausse effective de la chance de cible (min(1, B + Δ) − B). */
  gain: number
  /** Valeur (kamas) d'une naissance cible au lieu d'une autre issue : C_eff / p, ou écart de valeur attendue. */
  successValue: number | null
  /** Prix maximal rentable = gain × valeur d'une réussite (= C_eff × Δ / p). */
  threshold: number | null
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
 * Conseil d'Optimakina (research/README.md §2.9, strategy.md §5.3) :
 * - règle de prix : rentable si prix < C_eff × Δ / p (= gain × valeur d'une réussite) ;
 * - sinon (prix ou valeurs inconnus, ou objectif « progression » sans C_eff) : Optimakina quand la cible
 *   est G6 ou plus, ou une étape de l'objectif (recommandation « systématique dès la G6 »).
 */
export function adviseOptimakina(
  base: BreedingResult,
  withOpti: BreedingResult | null,
  opts: PairingOptions,
  ctx: { goalRelevant: boolean; coupleCost?: number | null },
): MakinaAdvice {
  const generation = base.makinaGenerationRequired
  const gain = withOpti ? Math.max(0, withOpti.targetChance - base.targetChance) : 0
  const priceInfo = opts.makinaCost?.('optimakina', base.family, generation) ?? null
  const price = priceInfo?.price ?? null
  const priceComplete = !!priceInfo && priceInfo.price !== null && priceInfo.complete
  const p = base.targetChance
  const hasCouple = ctx.coupleCost !== null && ctx.coupleCost !== undefined
  let successValue: number | null = null
  if (hasCouple && p > 0) successValue = (ctx.coupleCost as number) / p
  else if (opts.objective === 'genetons') successValue = genetonSuccessValue(base, opts)
  else successValue = outcomeSuccessValue(base, opts)
  const threshold = successValue !== null && gain > 0 ? successValue * gain : null
  const common = { kind: 'optimakina' as const, generation, price, priceComplete, gain, successValue, threshold }

  if (gain <= 1e-9)
    return {
      ...common,
      use: false,
      basis: 'inutile',
      reason:
        base.targetChance >= 1 && base.outcomes.some((o) => !o.isTarget)
          ? 'Inutile : la génération cible est déjà à 100 %.'
          : 'Inutile : aucune autre issue possible, la génération cible est certaine.',
    }
  if (opts.makinaPolicy === 'jamais') return { ...common, use: false, basis: 'jamais', reason: 'Optimakina désactivée (politique « jamais »).' }
  if (opts.makinaPolicy === 'optimakina')
    return { ...common, use: true, basis: 'reglage', reason: `Optimakina à chaque accouplement (politique choisie) : +${pct(gain)} de génération cible.` }

  const valuable = base.targetGeneration >= OPTIMAKINA_SYSTEMATIC_GENERATION || ctx.goalRelevant
  const heuristic = (why: string): MakinaAdvice =>
    valuable
      ? {
          ...common,
          use: true,
          basis: 'heuristique',
          reason: `${why}Cible G${base.targetGeneration}${ctx.goalRelevant ? ', utile à votre objectif' : ''} : la recherche recommande l'Optimakina dès la cible G${OPTIMAKINA_SYSTEMATIC_GENERATION} et sur les étapes clés (−40 à −65 % d'accouplements et de captures sur une chaîne G9). +${pct(gain)} de cible.`,
        }
      : {
          ...common,
          use: false,
          basis: 'heuristique',
          reason: `${why}Cible G${base.targetGeneration} sans enjeu particulier : pas d'Optimakina, sauf si elle est bon marché.`,
        }

  // En progression, la valeur de revente d'une étape sous-estime ce qu'elle coûte à refaire.
  if (opts.objective === 'progression' && !hasCouple && valuable) return heuristic('')
  if (threshold !== null && price !== null) {
    if (priceComplete)
      return price < threshold
        ? { ...common, use: true, basis: 'regle-prix', reason: `Rentable : prix ${formatKamas(price)} < seuil ${formatKamas(threshold)} (C_eff × Δ / p ; +${pct(gain)} de cible).` }
        : { ...common, use: false, basis: 'regle-prix', reason: `Non rentable : prix ${formatKamas(price)} ≥ seuil ${formatKamas(threshold)} (C_eff × Δ / p).` }
    if (price >= threshold)
      return {
        ...common,
        use: false,
        basis: 'regle-prix',
        reason: `Non rentable : la partie connue du coût (≥ ${formatKamas(price)}) dépasse déjà le seuil ${formatKamas(threshold)}.`,
      }
    return heuristic('Coût de l’Optimakina incomplet : règle de prix indécidable. ')
  }
  return heuristic(price === null ? 'Prix de l’Optimakina inconnu. ' : threshold === null ? 'Valeur des bébés inconnue. ' : '')
}

// ---------- Analyse d'un couple ----------

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
  if (opts.objective === 'progression') score = progress
  else if (opts.objective === 'genetons') score = result.expectedGenetons
  else if (economics) score = economics.expectedNet
  else score = result.expectedGenetons * (opts.genetonValue ?? 0) - (makinaPrice?.price ?? 0)

  const an = { result, base, makina, makinaAdvice, goalChance, goalRelevant }
  const { reasons, warnings } = pairNotes(a, b, an, opts, goal)
  if (makina && !makinaKnown)
    warnings.push(`Coût de ${theMakina(makina)} G${result.makinaGenerationRequired} incomplet : saisissez son prix (ou celui de ses ingrédients) dans la page Prix.`)

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
  const out: PairSuggestion[] = []
  for (const m of males)
    for (const f of females) {
      const ready = effectiveFertility(m) === 'feconde' && effectiveFertility(f) === 'feconde'
      const blockers = ready ? matingBlockers(m, f) : hardBlockers(m, f)
      if (blockers.length) continue
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
      if (!an) continue
      const warnings = [...an.warnings]
      for (const x of [m, f]) {
        if (x.location.kind !== 'etable')
          warnings.push(`${ruleTitle('M-STABLE-01')} : déplacer ${mountName(x)} (${locationLabel(x)}) dans l'étable avant d'accoupler.`)
        if (effectiveFertility(x) !== 'feconde') warnings.push(`${mountName(x)} n'est pas encore féconde : couple à préparer.`)
      }
      out.push({ ...an, key: `${m.id}|${f.id}`, a: m, b: f, ready, reasons: [...an.reasons], warnings })
    }
  return out.sort(
    (x, y) =>
      y.score - x.score ||
      y.result.targetChance - x.result.targetChance ||
      y.result.targetGeneration - x.result.targetGeneration ||
      x.key.localeCompare(y.key),
  )
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
  /** Même couleur : résultat certain (sinon 50/50). */
  sameSpecies: boolean
}

/**
 * Paires de montures stériles clonables (même famille et même génération, M-CLONE-01) : d'abord
 * même couleur, puis couleurs différentes. Avec `involving`, seules les paires contenant au moins une
 * de ces montures sont renvoyées.
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
  const out: ClonePair[] = []
  for (const list of groups.values()) {
    const bySpecies = new Map<number, Mount[]>()
    for (const m of list) bySpecies.set(m.speciesId, [...(bySpecies.get(m.speciesId) ?? []), m])
    const leftovers: Mount[] = []
    for (const same of bySpecies.values()) {
      // Les montures « en vue » d'abord, pour qu'elles trouvent une partenaire.
      const ordered = focus ? [...same].sort((x, y) => Number(focus.has(y.id)) - Number(focus.has(x.id))) : same
      for (let i = 0; i + 1 < ordered.length; i += 2) out.push(clonePair(ordered[i], ordered[i + 1], true))
      if (ordered.length % 2 === 1) leftovers.push(ordered[ordered.length - 1])
    }
    leftovers.sort((x, y) => (focus ? Number(focus.has(y.id)) - Number(focus.has(x.id)) : 0) || x.speciesId - y.speciesId)
    for (let i = 0; i + 1 < leftovers.length; i += 2) out.push(clonePair(leftovers[i], leftovers[i + 1], false))
  }
  return out
    .filter((p) => cloningBlockers(p.a, p.b).length === 0)
    .filter((p) => !focus || focus.has(p.a.id) || focus.has(p.b.id))
    .sort((x, y) => y.generation - x.generation || Number(y.sameSpecies) - Number(x.sameSpecies))
}

function clonePair(a: Mount, b: Mount, sameSpecies: boolean): ClonePair {
  const s = sp(a.speciesId) as Species
  return { a, b, family: s.family, generation: s.generation, sameSpecies }
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
