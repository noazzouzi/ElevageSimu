// Modèle de naissance (accouplement) du système d'élevage 3.5+.
//
// Reconstitué par la recherche (research/mechanics.md §1.2, implémentation de référence
// research/raw/mechanics-evidence/breeding_model_reference.py). Il reproduit à 0,01 % près les
// pourcentages affichés en jeu sur les captures du guide DPLN.
//
// 1. Arbre d'un parent X = X (poids de position 10) + ses 2 parents (poids 6 chacun).
// 2. Poids brut d'un membre = position × geneticWeight (client) ; les doublons s'additionnent ;
//    chaque arbre est normalisé à 1.
// 3. Masse naturelle : chaque membre reçoit son poids normalisé ; chaque paire (a de A, b de B, a ≠ b)
//    qui a un croisement c ajoute pA(a)·pB(b)·κ à c.
// 4. Génération cible G = génération max des issues possibles ; B = min(1, 0,30 + 0,0015·(niv A + niv B)
//    + Optimakina + Takeza). Les issues de génération G se partagent B au prorata de leur masse
//    naturelle, les autres se partagent 1 − B.
import { crossingChild, getSpecies } from '../data'
import { ANIMAKINA_ODDS } from './constants'
import { RULESETS, type Ruleset } from './rules'
import type { Ability, FamilyId, MakinaKind, Species } from './types'

export const POSITION_WEIGHT_SELF = 10
export const POSITION_WEIGHT_PARENT = 6
export const TARGET_BASE = 0.3
export const TARGET_PER_LEVEL = 0.0015
export const TAKEZA_BONUS = 0.2

/** Un parent tel que le voit le moteur : son espèce, son niveau et l'espèce de ses propres parents. */
export interface BreedingParent {
  speciesId: number
  level: number
  /** Espèces des parents de ce parent (0 à 2 ids). Vide pour une monture capturée. */
  parents: number[]
  ability?: Ability | null
}

export interface BreedingOptions {
  makina?: MakinaKind | null
  /** Jour Takeza (Almanax) : +20 % de génération cible. */
  takeza?: boolean
  rules?: Ruleset
  /** Facteur de poids des croisements (non validé pour les enfants monocolores ; défaut 1). */
  kappa?: number
  /** 'exact' : P(cible) = B (validé) ; 'max' : max(B, part naturelle) (hypothèse alternative). */
  targetMode?: 'exact' | 'max'
}

export interface BreedingOutcome {
  speciesId: number
  generation: number
  probability: number
  isTarget: boolean
  /** Génétons gagnés si ce bébé naît (somme des deux parents si naissance « record »). */
  genetons: number
}

export interface BreedingResult {
  family: FamilyId
  targetGeneration: number
  /** Probabilité totale d'obtenir la génération cible (B). */
  targetChance: number
  targetSpecies: number[]
  outcomes: BreedingOutcome[]
  /** Génération la plus haute présente dans les deux arbres (parents + leurs parents). */
  maxTreeGeneration: number
  /** Vrai si la génération cible dépasse tout l'arbre : seule condition pour gagner des génétons. */
  recordPossible: boolean
  /** Génétons si le bébé est de la génération cible et « record ». */
  genetonsIfRecord: number
  expectedGenetons: number
  /** Nombre de bébés (2 si un parent est Reproducteur). */
  babies: number
  /** XP de métier d'Éleveur rapportée par l'accouplement. */
  jobXp: number
  /** Génération minimale de la makina utilisable. */
  makinaGenerationRequired: number
  /** Capacités possibles du bébé (Animakina / Kromakina / 3.7 sans makina). */
  abilityOdds: Partial<Record<Ability, number>>
  warnings: string[]
}

/** Probabilité d'obtenir la génération cible (B), avant cas particulier « aucune autre issue ». */
export function targetChance(levelA: number, levelB: number, opts: BreedingOptions = {}): number {
  const rules = opts.rules ?? RULESETS['3.6']
  const opti = opts.makina === 'optimakina' ? rules.optimakinaBonus : 0
  const takeza = opts.takeza ? TAKEZA_BONUS : 0
  // Calcul en points de base entiers pour éviter les erreurs d'arrondi (0,3 + 0,6 + 0,1 = 1 exactement).
  const bp =
    Math.round(TARGET_BASE * 10_000) +
    Math.round(TARGET_PER_LEVEL * 10_000) * (clampLevel(levelA) + clampLevel(levelB)) +
    Math.round(opti * 10_000) +
    Math.round(takeza * 10_000)
  return Math.min(10_000, bp) / 10_000
}

function clampLevel(l: number): number {
  return Math.max(1, Math.min(200, Math.floor(l || 1)))
}

function mustSpecies(id: number): Species {
  const s = getSpecies(id)
  if (!s) throw new Error(`Espèce inconnue : ${id}`)
  return s
}

/** Poids normalisés de l'arbre d'un parent (lui-même + ses parents). */
export function treeWeights(p: BreedingParent): Map<number, number> {
  const w = new Map<number, number>()
  const add = (id: number, pos: number) => w.set(id, (w.get(id) ?? 0) + pos * mustSpecies(id).geneticWeight)
  add(p.speciesId, POSITION_WEIGHT_SELF)
  for (const id of p.parents.slice(0, 2)) add(id, POSITION_WEIGHT_PARENT)
  let total = 0
  for (const v of w.values()) total += v
  for (const [k, v] of w) w.set(k, v / total)
  return w
}

/** Distribution naturelle (avant le bonus de génération cible). */
export function naturalDistribution(a: BreedingParent, b: BreedingParent, kappa = 1): Map<number, number> {
  const pa = treeWeights(a)
  const pb = treeWeights(b)
  const W = new Map<number, number>()
  const add = (id: number, v: number) => W.set(id, (W.get(id) ?? 0) + v)
  for (const [k, v] of pa) add(k, v)
  for (const [k, v] of pb) add(k, v)
  for (const [x, px] of pa)
    for (const [y, py] of pb) {
      if (x === y) continue
      const c = crossingChild(x, y)
      if (c !== undefined) add(c, px * py * kappa)
    }
  let total = 0
  for (const v of W.values()) total += v
  for (const [k, v] of W) W.set(k, v / total)
  return W
}

/** Génétons rapportés par un parent selon le ruleset. */
export function parentGenetons(speciesId: number, rules: Ruleset): number {
  return mustSpecies(speciesId).genetons[rules.id] ?? 0
}

/** Simule un accouplement : distribution des bébés, génétons, XP, makina requise. */
export function breed(a: BreedingParent, b: BreedingParent, opts: BreedingOptions = {}): BreedingResult {
  const rules = opts.rules ?? RULESETS['3.6']
  const sa = mustSpecies(a.speciesId)
  const sb = mustSpecies(b.speciesId)
  const warnings: string[] = []
  if (sa.family !== sb.family) throw new Error('Les deux montures doivent être de la même famille.')
  if (!sa.breedable || !sb.breedable) throw new Error("Une monture spéciale (génération 0) ne peut pas s'accoupler.")

  const D = naturalDistribution(a, b, opts.kappa ?? 1)
  let targetGeneration = 0
  for (const id of D.keys()) targetGeneration = Math.max(targetGeneration, mustSpecies(id).generation)
  const T: [number, number][] = []
  const O: [number, number][] = []
  for (const [id, v] of D) (mustSpecies(id).generation === targetGeneration ? T : O).push([id, v])
  const sumT = T.reduce((s, [, v]) => s + v, 0)
  const sumO = O.reduce((s, [, v]) => s + v, 0)
  let B = targetChance(a.level, b.level, { ...opts, rules })
  if (O.length === 0) B = 1
  if (opts.targetMode === 'max') B = Math.max(B, sumT)

  const treeIds = [a.speciesId, b.speciesId, ...a.parents.slice(0, 2), ...b.parents.slice(0, 2)]
  const maxTreeGeneration = Math.max(...treeIds.map((id) => mustSpecies(id).generation))
  const genetonsIfRecord = parentGenetons(a.speciesId, rules) + parentGenetons(b.speciesId, rules)
  const babies = a.ability === 'reproducteur' || b.ability === 'reproducteur' ? 2 : 1

  const outcomes: BreedingOutcome[] = []
  for (const [id, v] of T) {
    const gen = mustSpecies(id).generation
    outcomes.push({ speciesId: id, generation: gen, probability: (B * v) / sumT, isTarget: true, genetons: gen > maxTreeGeneration ? genetonsIfRecord : 0 })
  }
  if (sumO > 0)
    for (const [id, v] of O) {
      const gen = mustSpecies(id).generation
      outcomes.push({ speciesId: id, generation: gen, probability: ((1 - B) * v) / sumO, isTarget: false, genetons: gen > maxTreeGeneration ? genetonsIfRecord : 0 })
    }
  outcomes.sort((x, y) => y.probability - x.probability || x.speciesId - y.speciesId)

  const expectedGenetons = babies * outcomes.reduce((s, o) => s + o.probability * o.genetons, 0)
  const jobXp = rules.matingXpPerGeneration * (sa.generation + sb.generation) * babies

  let abilityOdds: Partial<Record<Ability, number>> = {}
  if (opts.makina === 'kromakina') abilityOdds = { cameleone: 1 }
  else if (opts.makina === 'animakina') {
    if (rules.animakina === 'capacite') abilityOdds = { ...ANIMAKINA_ODDS }
    else warnings.push("En 3.7, l'Animakina permet de choisir le sexe du bébé au lieu d'une capacité.")
  }
  if (rules.naturalAbilityOdds && opts.makina !== 'kromakina' && !(opts.makina === 'animakina' && rules.animakina === 'capacite'))
    abilityOdds = { ...rules.naturalAbilityOdds }
  if (babies === 2) warnings.push('Capacité Reproducteur : 2 bébés (tirages supposés indépendants, génétons supposés comptés par bébé).')
  if (maxTreeGeneration >= targetGeneration)
    warnings.push("Un arbre contient déjà la génération cible ou plus : aucun généton possible et bonus de cible partagé.")

  return {
    family: sa.family,
    targetGeneration,
    targetChance: T.length ? B : 0,
    targetSpecies: T.map(([id]) => id),
    outcomes,
    maxTreeGeneration,
    recordPossible: targetGeneration > maxTreeGeneration,
    genetonsIfRecord: targetGeneration > maxTreeGeneration ? genetonsIfRecord : 0,
    expectedGenetons,
    babies,
    jobXp,
    makinaGenerationRequired: Math.max(2, targetGeneration),
    abilityOdds,
    warnings,
  }
}

/** Probabilité d'obtenir une espèce précise lors d'un accouplement. */
export function chanceOf(result: BreedingResult, speciesId: number): number {
  return result.outcomes.find((o) => o.speciesId === speciesId)?.probability ?? 0
}

/** Couples (espèces) qui produisent `childId` comme nouvelle génération. */
export function crossingsFor(childId: number): [number, number][] {
  return mustSpecies(childId).crossings
}
