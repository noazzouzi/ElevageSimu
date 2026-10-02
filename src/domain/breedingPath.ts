// Chemins d'élevage : de quelles captures part-on pour obtenir une espèce, et combien d'efforts
// (accouplements, captures, fécondations, clonages) faut-il en moyenne ?
//
// 1. Recette idéale (`cheapestRecipe`) : pour chaque espèce, le croisement qui minimise le nombre de
//    montures G1 capturées, en supposant que chaque accouplement donne le bébé visé. C'est le calcul
//    « captures minimales » des fichiers research/tree-*.md (Volkorne : 4 / 13 / 31 / 58 ; Muldo :
//    4 / 10 / 22 / 25 / 49… ; Dragodinde : 4 / 10 / 34 / 112).
// 2. Effort attendu (`expectedEffort`) : on pondère la recette par la vraie probabilité d'obtenir chaque
//    bébé, calculée par le modèle de naissance (genetics.ts `breed`) avec des arbres réalistes (chaque
//    parent a pour parents ceux de sa recette ; une G1 capturée n'en a pas). Approximations :
//    - il faut en moyenne 1/P accouplements pour 1 bébé de probabilité P ;
//    - avec clonage, les 2 stériles d'un accouplement en rendent ≈ 1 fertile (½ de chaque parent) ;
//    - le dernier clone de chaque couleur ne resert pas (+½ exemplaire par espèce intermédiaire) ;
//    - les bébés « ratés » ne sont pas réutilisés (option `recycleByproducts` : borne optimiste) ;
//    - pas de contrainte de sexe, de place ni de calendrier (joueur parfait, valeurs moyennes).
import { getSpecies, SPECIES } from '../data'
import { JOB_XP_PER_CAPTURE } from './constants'
import { breed, type BreedingParent } from './genetics'
import { RULESETS, type Ruleset } from './rules'
import type { Species } from './types'

// ---------- Ascendance ----------

function mustSpecies(id: number): Species {
  const s = getSpecies(id)
  if (!s) throw new Error(`Espèce inconnue : ${id}`)
  return s
}

function byGenerationThenName(a: number, b: number): number {
  const sa = mustSpecies(a)
  const sb = mustSpecies(b)
  return sa.generation - sb.generation || sa.name.localeCompare(sb.name, 'fr')
}

/**
 * Toutes les espèces qui apparaissent dans au moins un chemin de croisement menant à `speciesId`
 * (parents, grands-parents… quelle que soit la recette), triées par génération puis par nom.
 * L'espèce elle-même n'est pas incluse.
 */
export function ancestorsOf(speciesId: number): number[] {
  const seen = new Set<number>()
  const stack = mustSpecies(speciesId).crossings.flat()
  while (stack.length) {
    const id = stack.pop() as number
    if (seen.has(id)) continue
    seen.add(id)
    for (const p of mustSpecies(id).crossings.flat()) if (!seen.has(p)) stack.push(p)
  }
  seen.delete(speciesId)
  return [...seen].sort(byGenerationThenName)
}

let childIndex: Map<number, number[]> | null = null
function childrenIndex(): Map<number, number[]> {
  if (childIndex) return childIndex
  const idx = new Map<number, number[]>()
  for (const s of SPECIES)
    for (const pair of s.crossings)
      for (const p of pair) {
        const list = idx.get(p)
        if (list) list.push(s.id)
        else idx.set(p, [s.id])
      }
  childIndex = idx
  return idx
}

/** Toutes les espèces que l'on peut obtenir, directement ou non, à partir de `speciesId`. */
export function descendantsOf(speciesId: number): number[] {
  const parentsToChildren = childrenIndex()
  const seen = new Set<number>()
  const stack = [...(parentsToChildren.get(speciesId) ?? [])]
  while (stack.length) {
    const id = stack.pop() as number
    if (seen.has(id)) continue
    seen.add(id)
    for (const c of parentsToChildren.get(id) ?? []) if (!seen.has(c)) stack.push(c)
  }
  seen.delete(speciesId)
  return [...seen].sort(byGenerationThenName)
}

// ---------- Recette idéale (captures minimales) ----------

/** Un nœud de recette : une monture à obtenir, par capture (G1) ou par un croisement précis. */
export interface RecipeNode {
  speciesId: number
  generation: number
  /** Croisement retenu [gauche, droite], ou null pour une G1 capturée. */
  crossing: [number, number] | null
  /** Recettes des deux parents (même ordre que `crossing`), ou null pour une capture. */
  parents: [RecipeNode, RecipeNode] | null
  /** Montures G1 à capturer pour ce sous-arbre (idéal : chaque accouplement réussit). */
  captures: number
}

const captureCostMemo = new Map<number, number>()

/**
 * Nombre minimal de montures G1 à capturer pour obtenir 1 exemplaire de l'espèce, si chaque
 * accouplement donne le bébé voulu (sans clonage, sans Reproducteur, sexes ignorés).
 * `Infinity` pour une monture non élevable (spéciales G0).
 */
export function minCaptures(speciesId: number): number {
  const memo = captureCostMemo.get(speciesId)
  if (memo !== undefined) return memo
  const s = mustSpecies(speciesId)
  let cost = Infinity
  if (s.breedable && s.generation === 1 && s.capturable) cost = 1
  else if (s.breedable) for (const [a, b] of s.crossings) cost = Math.min(cost, minCaptures(a) + minCaptures(b))
  captureCostMemo.set(speciesId, cost)
  return cost
}

/** Coût idéal de chaque croisement possible de l'espèce, du moins cher au plus cher. */
export interface CrossingOption {
  crossing: [number, number]
  /** Captures G1 idéales si l'on passe par ce croisement. */
  captures: number
  /** Accouplements idéaux (= captures − 1 : chaque accouplement fusionne deux montures en une). */
  matings: number
  /** Génération du parent le plus haut. */
  maxParentGeneration: number
  /** Vrai pour le(s) croisement(s) au coût minimal. */
  cheapest: boolean
}

export function crossingOptions(speciesId: number): CrossingOption[] {
  const s = mustSpecies(speciesId)
  const opts = s.crossings.map(([a, b]): CrossingOption => {
    const captures = minCaptures(a) + minCaptures(b)
    return {
      crossing: [a, b],
      captures,
      matings: captures - 1,
      maxParentGeneration: Math.max(mustSpecies(a).generation, mustSpecies(b).generation),
      cheapest: false,
    }
  })
  opts.sort(compareOptions)
  const best = opts[0]?.captures ?? Infinity
  for (const o of opts) o.cheapest = o.captures === best
  return opts
}

function compareOptions(x: CrossingOption, y: CrossingOption): number {
  return (
    x.captures - y.captures ||
    x.maxParentGeneration - y.maxParentGeneration ||
    Math.min(...x.crossing) - Math.min(...y.crossing) ||
    Math.max(...x.crossing) - Math.max(...y.crossing)
  )
}

function bestCrossing(speciesId: number): [number, number] | null {
  return crossingOptions(speciesId)[0]?.crossing ?? null
}

function buildNode(speciesId: number, forced?: [number, number]): RecipeNode {
  const s = mustSpecies(speciesId)
  if (s.generation === 1 && s.capturable && !forced) return { speciesId, generation: 1, crossing: null, parents: null, captures: 1 }
  const crossing = forced ?? bestCrossing(speciesId)
  if (!crossing) throw new Error(`${s.name} ne s'obtient ni par capture ni par croisement.`)
  const left = buildNode(crossing[0])
  const right = buildNode(crossing[1])
  return { speciesId, generation: s.generation, crossing, parents: [left, right], captures: left.captures + right.captures }
}

/**
 * Recette la moins chère en captures (idéal : chaque accouplement réussit). Égalités départagées par
 * la génération du parent le plus haut puis par les identifiants (résultat déterministe).
 * Retourne null pour une monture non élevable (Dragodinde en armure, à Plumes).
 */
export function cheapestRecipe(speciesId: number): RecipeNode | null {
  const s = mustSpecies(speciesId)
  if (!s.breedable || !Number.isFinite(minCaptures(speciesId))) return null
  return buildNode(speciesId)
}

/** Recette imposant le croisement du haut (`crossing`), les parents suivant leur recette la moins chère. */
export function recipeFor(speciesId: number, crossing: [number, number]): RecipeNode {
  const s = mustSpecies(speciesId)
  const ok = s.crossings.some(([a, b]) => (a === crossing[0] && b === crossing[1]) || (a === crossing[1] && b === crossing[0]))
  if (!ok) throw new Error(`${s.name} ne s'obtient pas par ce croisement.`)
  return buildNode(speciesId, crossing)
}

/** G1 à capturer pour une recette : id d'espèce G1 → nombre de montures (idéal). */
export function capturesByColor(tree: RecipeNode): Map<number, number> {
  const out = new Map<number, number>()
  const walk = (n: RecipeNode) => {
    if (!n.parents) out.set(n.speciesId, (out.get(n.speciesId) ?? 0) + 1)
    else for (const p of n.parents) walk(p)
  }
  walk(tree)
  return out
}

/** Nombre d'accouplements de la recette idéale (nœuds internes de l'arbre). */
export function matingsCount(tree: RecipeNode): number {
  return tree.parents ? 1 + matingsCount(tree.parents[0]) + matingsCount(tree.parents[1]) : 0
}

export interface RequiredSpecies {
  speciesId: number
  generation: number
  /** Exemplaires nécessaires dans la recette idéale (cible comprise, captures comprises). */
  count: number
  /** Croisement retenu pour cette espèce dans la recette, null pour une capture. */
  crossing: [number, number] | null
}

/** Toutes les espèces qu'une recette fait passer par l'étable, de la cible vers les captures. */
export function requiredSpecies(tree: RecipeNode): RequiredSpecies[] {
  const out = new Map<number, RequiredSpecies>()
  const walk = (n: RecipeNode) => {
    const cur = out.get(n.speciesId)
    if (cur) cur.count += 1
    else out.set(n.speciesId, { speciesId: n.speciesId, generation: n.generation, count: 1, crossing: n.crossing })
    if (n.parents) for (const p of n.parents) walk(p)
  }
  walk(tree)
  return [...out.values()].sort((x, y) => y.generation - x.generation || byGenerationThenName(x.speciesId, y.speciesId))
}

// ---------- Chance d'un croisement ----------

export interface CrossingChanceOptions {
  parentLevel: number
  makina: 'none' | 'optimakina'
  rules?: Ruleset
  takeza?: boolean
}

export interface CrossingChance {
  /** P(bébé = l'espèce visée) pour un accouplement de ce croisement. */
  chance: number
  /** Chance de génération cible B. */
  targetChance: number
  /** Autres issues de la génération cible qui se partagent B. */
  sharedWith: number[]
  /** Génétons si le bébé est de la génération cible (naissance « record »), 0 sinon. */
  genetonsIfRecord: number
  /** XP d'Éleveur de l'accouplement. */
  jobXp: number
}

/** Monture « propre » de l'espèce : ses parents sont ceux de sa recette la moins chère (aucun si G1). */
export function cleanParent(speciesId: number, level: number): BreedingParent {
  const s = mustSpecies(speciesId)
  const c = s.generation === 1 && s.capturable ? null : bestCrossing(speciesId)
  return { speciesId, level, parents: c ? [c[0], c[1]] : [] }
}

/**
 * Chance d'obtenir `childId` en accouplant deux montures « propres » des espèces de `crossing`
 * (modèle de naissance validé en jeu ; arbres réalistes = recettes les moins chères).
 */
export function crossingChance(childId: number, crossing: [number, number], opts: CrossingChanceOptions): CrossingChance {
  const rules = opts.rules ?? RULESETS['3.6']
  const r = breed(cleanParent(crossing[0], opts.parentLevel), cleanParent(crossing[1], opts.parentLevel), {
    makina: opts.makina === 'optimakina' ? 'optimakina' : null,
    takeza: opts.takeza,
    rules,
  })
  return {
    chance: r.outcomes.find((o) => o.speciesId === childId)?.probability ?? 0,
    targetChance: r.targetChance,
    sharedWith: r.targetSpecies.filter((t) => t !== childId),
    genetonsIfRecord: r.genetonsIfRecord,
    jobXp: r.jobXp,
  }
}

// ---------- Effort attendu ----------

export interface EffortOptions {
  /** Niveau de tous les parents au moment de l'accouplement (captures comprises). */
  parentLevel: number
  makina: 'none' | 'optimakina'
  /** Avec Optimakina : ne l'utiliser que pour les bébés de cette génération ou plus (défaut 2 = partout). */
  optimakinaFromGeneration?: number
  rules?: Ruleset
  /** Cloner systématiquement les stériles (≈ 1 parent récupéré par accouplement). */
  cloning: boolean
  /** Jour Takeza (Almanax) pour tous les accouplements : +20 % de génération cible. */
  takeza?: boolean
  /**
   * Réutiliser les bébés hors cible d'une espèce utile plus bas dans la recette (défaut : false).
   * Borne optimiste : combinée au clonage, elle fait tendre les captures vers ~1 car elle ignore les
   * sexes, les délais et les arbres « sales ». À n'utiliser que pour comparer.
   */
  recycleByproducts?: boolean
  /** Recette à évaluer (défaut : `cheapestRecipe`). */
  recipe?: RecipeNode
}

/** Effort attendu pour une espèce de la recette (agrégé sur toutes ses occurrences). */
export interface NodeEffort {
  speciesId: number
  generation: number
  crossing: [number, number] | null
  /** Exemplaires demandés par les étages supérieurs (avant recyclage, reliquat de clonage compris). */
  demand: number
  /** Exemplaires couverts par des bébés « ratés » d'accouplements supérieurs. */
  recycled: number
  /** Exemplaires à produire (accouplements) ou à capturer (G1). */
  needed: number
  /** P(bébé = cette espèce) pour un accouplement de sa recette ; 1 pour une capture. */
  chance: number
  /** Chance de génération cible B de cet accouplement. */
  targetChance: number
  /** Autres issues de la génération cible qui se partagent B (« cible partagée »). */
  sharedWith: number[]
  /** Accouplements attendus (needed / chance). */
  matings: number
  /** Optimakina utilisée pour cet accouplement. */
  optimakina: boolean
  /** Génétons attendus par accouplement (modèle : naissance « record » seulement). */
  genetonsPerMating: number
  /** XP d'Éleveur par accouplement. */
  jobXpPerMating: number
}

export interface EffortEstimate {
  speciesId: number
  /** Captures G1 attendues (somme de `capturesByColor`). */
  captures: number
  capturesByColor: Map<number, number>
  matings: number
  /** Montures à rendre fécondes (= 2 par accouplement : chaque parent l'a été une fois). */
  fecundations: number
  clonings: number
  optimakinas: number
  genetons: number
  jobXp: { matings: number; captures: number; total: number }
  /** Recette idéale correspondante (chaque accouplement réussit), pour comparaison. */
  ideal: { captures: number; matings: number }
  /** Détail par espèce, de la cible vers les captures. */
  nodes: NodeEffort[]
  /** Hypothèses de calcul, en français, pour l'affichage. */
  assumptions: string[]
}

/** Fraction de chaque parent réellement consommée par un accouplement. */
export function parentConsumption(cloning: boolean): number {
  // Sans clonage : les 2 parents deviennent stériles et sont perdus pour l'élevage.
  // Avec clonage : 2 stériles (de cet accouplement, ou de même couleur d'un autre) → 1 fertile au
  // hasard, soit ½ de chaque parent récupéré en moyenne.
  return cloning ? 0.5 : 1
}

/**
 * Exemplaires d'une espèce intermédiaire à prévoir pour `attempts` accouplements qui l'utilisent :
 * `f × attempts`, plus, avec clonage, le reliquat `1 − f` (le dernier clone d'une couleur ne
 * resert pas : le premier accouplement demande des parents entiers). À clonage et P = 1, on retrouve
 * exactement la recette idéale.
 */
export function parentsNeeded(attempts: number, cloning: boolean): number {
  if (attempts <= 0) return 0
  const f = parentConsumption(cloning)
  return f * attempts + (1 - f)
}

/**
 * Effort moyen pour obtenir 1 exemplaire de `speciesId` en suivant une recette (par défaut la moins
 * chère en captures). Calcul déterministe en espérance, de la cible vers les captures :
 * besoin(cible) = 1 ; pour chaque espèce, accouplements = besoin / P(bébé) ; besoin d'un parent =
 * `parentsNeeded(accouplements qui l'utilisent)` ; les bébés hors cible d'une espèce utile plus bas
 * réduisent son besoin si `recycleByproducts`. Les captures sont le besoin restant en G1.
 */
export function expectedEffort(speciesId: number, opts: EffortOptions): EffortEstimate {
  const rules = opts.rules ?? RULESETS['3.6']
  const recycle = opts.recycleByproducts ?? false
  const optiFrom = opts.optimakinaFromGeneration ?? 2
  const tree = opts.recipe ?? cheapestRecipe(speciesId)
  if (!tree) throw new Error(`${mustSpecies(speciesId).name} n'est pas élevable.`)
  if (tree.speciesId !== speciesId) throw new Error('La recette ne correspond pas à cette espèce.')

  // Croisement retenu pour chaque espèce de la recette (identique à chaque occurrence).
  const recipeOf = new Map<number, [number, number] | null>()
  const collect = (n: RecipeNode) => {
    if (!recipeOf.has(n.speciesId)) recipeOf.set(n.speciesId, n.crossing)
    if (n.parents) for (const p of n.parents) collect(p)
  }
  collect(tree)

  // Ordre de traitement : génération décroissante (un parent est toujours d'une génération inférieure).
  const order = [...recipeOf.keys()].sort((a, b) => mustSpecies(b).generation - mustSpecies(a).generation || a - b)
  const processed = new Set<number>()
  // Accouplements (attendus) qui utilisent chaque espèce comme parent.
  const attemptsUsing = new Map<number, number>()
  const supply = new Map<number, number>()
  const add = (m: Map<number, number>, k: number, v: number) => m.set(k, (m.get(k) ?? 0) + v)

  const parentOf = (id: number): BreedingParent => {
    const c = recipeOf.get(id)
    return { speciesId: id, level: opts.parentLevel, parents: c ? [c[0], c[1]] : [] }
  }
  const nodes: NodeEffort[] = []
  const capturesByColorOut = new Map<number, number>()
  let matings = 0
  let clonings = 0
  let optimakinas = 0
  let genetons = 0
  let jobXpMatings = 0

  for (const id of order) {
    const gen = mustSpecies(id).generation
    const d = id === speciesId ? 1 : parentsNeeded(attemptsUsing.get(id) ?? 0, opts.cloning)
    const recycled = Math.min(d, supply.get(id) ?? 0)
    const needed = d - recycled
    processed.add(id)
    const crossing = recipeOf.get(id) ?? null
    if (!crossing) {
      capturesByColorOut.set(id, needed)
      nodes.push({ speciesId: id, generation: gen, crossing: null, demand: d, recycled, needed, chance: 1, targetChance: 1, sharedWith: [], matings: 0, optimakina: false, genetonsPerMating: 0, jobXpPerMating: 0 })
      continue
    }
    const useOpti = opts.makina === 'optimakina' && gen >= optiFrom
    const r = breed(parentOf(crossing[0]), parentOf(crossing[1]), { makina: useOpti ? 'optimakina' : null, takeza: opts.takeza, rules })
    const chance = r.outcomes.find((o) => o.speciesId === id)?.probability ?? 0
    if (chance <= 0) throw new Error(`Probabilité nulle d'obtenir ${mustSpecies(id).name} avec ce croisement.`)
    const m = needed / chance
    matings += m
    if (opts.cloning) clonings += m
    if (useOpti) optimakinas += m
    genetons += m * r.expectedGenetons
    jobXpMatings += m * r.jobXp
    add(attemptsUsing, crossing[0], m)
    add(attemptsUsing, crossing[1], m)
    if (recycle)
      for (const o of r.outcomes)
        if (o.speciesId !== id && recipeOf.has(o.speciesId) && !processed.has(o.speciesId)) add(supply, o.speciesId, m * o.probability)
    nodes.push({
      speciesId: id,
      generation: gen,
      crossing,
      demand: d,
      recycled,
      needed,
      chance,
      targetChance: r.targetChance,
      sharedWith: r.targetSpecies.filter((t) => t !== id),
      matings: m,
      optimakina: useOpti,
      genetonsPerMating: r.expectedGenetons,
      jobXpPerMating: r.jobXp,
    })
  }

  let captures = 0
  for (const v of capturesByColorOut.values()) captures += v
  const jobXpCaptures = captures * JOB_XP_PER_CAPTURE
  const assumptions = [
    `Parents au niveau ${opts.parentLevel}${opts.makina === 'optimakina' ? `, Optimakina ${optiFrom <= 2 ? 'à chaque accouplement' : `dès la G${optiFrom}`}` : ', sans makina'}${opts.takeza ? ', jour Takeza' : ''} (règles ${rules.id}).`,
    'Il faut en moyenne 1 / P accouplements pour obtenir un bébé de probabilité P (P calculée par le modèle de naissance, arbres « propres » : chaque parent issu de sa recette).',
    opts.cloning
      ? 'Clonage systématique : les 2 stériles d\'un accouplement redonnent ≈ 1 parent fertile (½ de chacun), à refaire féconder ; le dernier clone de chaque couleur ne resert pas.'
      : 'Sans clonage : chaque accouplement consomme définitivement ses 2 parents.',
    recycle
      ? 'Les bébés hors cible d\'une couleur utile plus bas dans la recette sont réutilisés (sexe et généalogie supposés convenir).'
      : 'Les bébés hors cible ne sont pas comptés comme parents (vendus, extraits ou clonés) : estimation prudente des captures.',
    'Moyennes d\'un joueur parfait : ni contrainte de sexe (♂/♀), ni places d\'enclos, ni délais ; un vrai élevage demande davantage.',
  ]
  return {
    speciesId,
    captures,
    capturesByColor: capturesByColorOut,
    matings,
    fecundations: 2 * matings,
    clonings,
    optimakinas,
    genetons,
    jobXp: { matings: jobXpMatings, captures: jobXpCaptures, total: jobXpMatings + jobXpCaptures },
    ideal: { captures: tree.captures, matings: matingsCount(tree) },
    nodes,
    assumptions,
  }
}
