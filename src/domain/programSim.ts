// Simulateur Monte-Carlo d'un programme d'élevage complet (« la pyramide ») vers une monture cible.
//
// Portage TypeScript du simulateur de la recherche
// research/raw/strategy-evidence/sim/pyramid_sim.py (résultats : research/strategy.md §6,
// sim/pyramid-results*.json). Politique « pilotée par la demande », à chaque cycle (une session de
// jeu, une demi-journée par défaut) :
//   1. besoin de chaque couleur calculé depuis la cible (besoin / chance de génération cible, en
//      tenant compte du clonage) ;
//   2. accouplement des couples féconds dont la couleur du bébé est en déficit (sexes opposés, arbres
//      « propres » d'abord) ;
//   3. clonage systématique des stériles de même génération (même couleur d'abord) ;
//   4. captures de G1 en déficit, seulement pour remplir les places d'enclos libres ;
//   5. mise en enclos (génération la plus haute d'abord) : une monture est féconde après le temps de
//      fécondation de son lot (+ l'XP au-delà du niveau 40 si les parents doivent être plus hauts).
// Les naissances suivent le modèle validé en jeu (genetics.ts `breed`). Pour chaque couleur, la
// recette est la moins chère en captures (breedingPath.ts `cheapestRecipe`).
//
// Hypothèses (joueur parfait) : aucune session manquée, sexes 50/50, couleurs sauvages toujours
// disponibles, pas d'achat/vente de montures ni de « porteurs », clone qui garde son niveau
// (hypothèse : inconnu en jeu), étable non limitée (avertissement si le pic dépasse sa capacité).
//
// Module pur : aucun React, aucun store, aucun Math.random (générateur mulberry32 à graine).
import { getSpecies, SPECIES } from '../data'
import { cheapestRecipe, requiredSpecies } from './breedingPath'
import { JOB_XP_PER_CAPTURE, PADDOCK_SLOTS, PADDOCK_UNLOCK_LEVELS, TICK_SECONDS } from './constants'
import { captureCost, DEFAULT_SERENITY_POINTS, fertilitySeconds, maintainedTier, makinaCost, type NetKind } from './economy'
import { bestFuel } from './fuel'
import { breed, targetChance } from './genetics'
import type { PriceContext } from './pricing'
import { RULESETS, type Ruleset } from './rules'
import type { FamilyId, FuelTier, GaugeId, Species } from './types'
import { mountXpForLevel } from './xp'

// ---------- Configuration ----------

/** Politique d'Optimakina : jamais, à chaque accouplement, ou pour les bébés de génération ≥ N. */
export type MakinaPolicy = 'none' | 'all' | { fromGeneration: number }

export interface ProgramConfig {
  /** Monture visée (id d'espèce). */
  targetSpeciesId: number
  /** Niveau des parents au moment de l'accouplement (captures et bébés sont montés à ce niveau). */
  parentLevel: number
  /** Niveau par génération de la monture (politique mixte), prioritaire sur `parentLevel`. */
  levelByGeneration?: Partial<Record<number, number>>
  makina: MakinaPolicy
  /** Cloner systématiquement les stériles. */
  cloning: boolean
  /** Enclos utilisés (1 … 6). */
  paddocks: number
  /** Palier de jauge entretenu (1 … 4) : durée de fécondation, débit d'XP, prix au point. */
  tier: FuelTier
  /** Montures par lot (par enclos), 1 … 10 : places = enclos × lot. */
  batchSize: number
  /** Jeu de règles actif (`useRules()`). */
  rules: Ruleset
  /** Durée maximale simulée (jours) : au-delà, le tirage est un échec. */
  maxDays: number
  /** Nombre de tirages Monte-Carlo. */
  runs: number
  /** Sessions de jeu par jour (défaut 2 : une session toutes les 12 h, comme la recherche). */
  sessionsPerDay?: number
  /** Graine du générateur (défaut 1). */
  seed?: number
  /** Le clone garde son niveau (défaut vrai : hypothèse de la recherche, inconnu en jeu). */
  cloneKeepsLevel?: boolean
  /** Points de Baffeur + Caresseur par lot (défaut : DEFAULT_SERENITY_POINTS, estimation). */
  serenityPointsPerBatch?: number
  /** Facteur de poids des croisements du modèle de naissance (défaut 1). */
  kappa?: number
}

export interface NormalizedProgramConfig extends ProgramConfig {
  sessionsPerDay: number
  seed: number
  cloneKeepsLevel: boolean
  serenityPointsPerBatch: number
  kappa: number
}

/** Niveau dont l'XP est « gratuite » en temps (Mangeoire en 2e jauge pendant la phase d'amour). */
export const FREE_XP_LEVEL = 40
/** Points d'endurance, de maturité et d'amour à fournir par lot (3 × 20 000). */
export const STAT_POINTS_PER_BATCH = 60_000
export const DEFAULT_SESSIONS_PER_DAY = 2
export const MAX_RUNS = 1000
export const MAX_DAYS = 2000

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const intOr = (v: number | undefined, d: number) => (Number.isFinite(v) ? Math.floor(v as number) : d)

/** Bornes et valeurs par défaut appliquées à une configuration. */
export function normalizeProgramConfig(cfg: ProgramConfig): NormalizedProgramConfig {
  const makina: MakinaPolicy =
    cfg.makina === 'none' || cfg.makina === 'all' ? cfg.makina : { fromGeneration: clamp(intOr(cfg.makina?.fromGeneration, 2), 2, 10) }
  const tier = clamp(intOr(cfg.tier, 2), 1, 4) as FuelTier
  let levelByGeneration: Partial<Record<number, number>> | undefined
  if (cfg.levelByGeneration) {
    levelByGeneration = {}
    for (const [g, l] of Object.entries(cfg.levelByGeneration)) if (l !== undefined) levelByGeneration[Number(g)] = clamp(intOr(l, 1), 1, 200)
  }
  return {
    ...cfg,
    parentLevel: clamp(intOr(cfg.parentLevel, 1), 1, 200),
    levelByGeneration,
    makina,
    paddocks: clamp(intOr(cfg.paddocks, 1), 1, PADDOCK_UNLOCK_LEVELS.length),
    tier,
    batchSize: clamp(intOr(cfg.batchSize, PADDOCK_SLOTS), 1, PADDOCK_SLOTS),
    rules: cfg.rules ?? RULESETS['3.6'],
    maxDays: clamp(intOr(cfg.maxDays, 365), 1, MAX_DAYS),
    runs: clamp(intOr(cfg.runs, 40), 1, MAX_RUNS),
    sessionsPerDay: clamp(intOr(cfg.sessionsPerDay, DEFAULT_SESSIONS_PER_DAY), 1, 12),
    seed: intOr(cfg.seed, 1) >>> 0,
    cloneKeepsLevel: cfg.cloneKeepsLevel ?? true,
    serenityPointsPerBatch: Math.max(0, cfg.serenityPointsPerBatch ?? DEFAULT_SERENITY_POINTS),
    kappa: cfg.kappa ?? 1,
  }
}

/** Enclos débloqués pour un niveau d'Éleveur (1 / 40 / 80 / 120 / 160 / 200 → 1 … 6). */
export function paddocksForJobLevel(jobLevel: number): number {
  return Math.max(1, PADDOCK_UNLOCK_LEVELS.filter((p) => p.level <= Math.max(1, jobLevel)).length)
}

/** Vrai si l'Optimakina est utilisée pour un bébé de cette génération. */
export function usesOptimakina(policy: MakinaPolicy, generation: number): boolean {
  if (policy === 'none') return false
  if (policy === 'all') return true
  return generation >= policy.fromGeneration
}

/** Libellé FR d'une politique d'Optimakina. */
export function makinaPolicyLabel(policy: MakinaPolicy): string {
  if (policy === 'none') return 'sans makina'
  if (policy === 'all' || policy.fromGeneration <= 2) return 'Optimakina partout'
  return `Optimakina dès la G${policy.fromGeneration}`
}

// ---------- Générateur pseudo-aléatoire ----------

/** Générateur mulberry32 : nombres dans [0, 1), reproductibles pour une graine donnée. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Graine du tirage n° `index` (mélange de type splitmix : tirages indépendants). */
export function runSeed(base: number, index: number): number {
  let h = ((base >>> 0) ^ 0x9e3779b9) + Math.imul(index + 1, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return (h ^ (h >>> 16)) >>> 0
}

// ---------- Plan (recettes retenues) ----------

/** Une étape de la chaîne de croisements retenue (recette la moins chère en captures). */
export interface ProgramStep {
  speciesId: number
  generation: number
  /** Croisement [a, b], ou null pour une G1 capturée. */
  crossing: [number, number] | null
  /** Niveaux des deux parents (politique de niveau), null pour une capture. */
  parentLevels: [number, number] | null
  optimakina: boolean
  /** Chance de génération cible B utilisée pour le calcul du besoin (1 pour une capture). */
  targetChance: number
}

interface Plan {
  target: number
  family: FamilyId
  best: Map<number, [number, number]>
  needed: Set<number>
  /** Espèces croisées, génération décroissante. */
  order: number[]
  /** G1 à capturer. */
  g1: number[]
  chance: Map<number, number>
  steps: ProgramStep[]
}

function mustSpecies(id: number): Species {
  const s = getSpecies(id)
  if (!s) throw new Error(`Espèce inconnue : ${id}`)
  return s
}

const gen = (id: number) => mustSpecies(id).generation

function levelOf(cfg: Pick<ProgramConfig, 'parentLevel' | 'levelByGeneration'>, id: number): number {
  return cfg.levelByGeneration?.[gen(id)] ?? cfg.parentLevel
}

function makinaKey(p: MakinaPolicy): string {
  return p === 'none' || p === 'all' ? p : `g${p.fromGeneration}`
}

const planCache = new Map<string, Plan>()

function getPlan(cfg: NormalizedProgramConfig): Plan {
  const key = [cfg.targetSpeciesId, cfg.parentLevel, JSON.stringify(cfg.levelByGeneration ?? {}), makinaKey(cfg.makina), cfg.rules.id, cfg.rules.optimakinaBonus].join('|')
  const cached = planCache.get(key)
  if (cached) return cached
  const target = mustSpecies(cfg.targetSpeciesId)
  const tree = cheapestRecipe(target.id)
  if (!tree) throw new Error(`${target.name} n'est pas élevable (monture spéciale).`)
  const best = new Map<number, [number, number]>()
  const needed = new Set<number>()
  const steps: ProgramStep[] = []
  const chance = new Map<number, number>()
  for (const r of requiredSpecies(tree)) {
    needed.add(r.speciesId)
    if (r.crossing) {
      const [a, b] = r.crossing
      best.set(r.speciesId, [a, b])
      const opti = usesOptimakina(cfg.makina, r.generation)
      const la = levelOf(cfg, a)
      const lb = levelOf(cfg, b)
      const p = targetChance(la, lb, { makina: opti ? 'optimakina' : null, rules: cfg.rules })
      chance.set(r.speciesId, p)
      steps.push({ speciesId: r.speciesId, generation: r.generation, crossing: [a, b], parentLevels: [la, lb], optimakina: opti, targetChance: p })
    } else {
      steps.push({ speciesId: r.speciesId, generation: r.generation, crossing: null, parentLevels: null, optimakina: false, targetChance: 1 })
    }
  }
  const order = [...best.keys()].sort((x, y) => gen(y) - gen(x) || x - y)
  const g1 = [...needed].filter((id) => !best.has(id)).sort((x, y) => x - y)
  const plan: Plan = { target: target.id, family: target.family, best, needed, order, g1, chance, steps }
  if (planCache.size > 200) planCache.clear()
  planCache.set(key, plan)
  return plan
}

/** Chaîne de croisements utilisée par le simulateur (de la cible vers les captures). */
export function programPlan(cfg: ProgramConfig): ProgramStep[] {
  return getPlan(normalizeProgramConfig(cfg)).steps
}

// ---------- Distribution des naissances (mémorisée) ----------

interface SimMount {
  id: number
  /** 0 = mâle, 1 = femelle. */
  sex: 0 | 1
  parents: number[]
  level: number
  /** Cycles restants avant d'être féconde (enclos). */
  remaining: number
}

interface DistItem {
  id: number
  p: number
  genetons: number
}

interface Dist {
  items: DistItem[]
  makinaGeneration: number
}

const distCache = new Map<string, Dist>()

function parentsKey(m: SimMount): string {
  return m.parents.length < 2 ? m.parents.join(',') : `${Math.min(m.parents[0], m.parents[1])},${Math.max(m.parents[0], m.parents[1])}`
}

function distribution(a: SimMount, b: SimMount, opti: boolean, rules: Ruleset, kappa: number): Dist {
  const key = `${rules.id}|${rules.optimakinaBonus}|${kappa}|${a.id}:${parentsKey(a)}:${a.level}|${b.id}:${parentsKey(b)}:${b.level}|${opti ? 1 : 0}`
  const hit = distCache.get(key)
  if (hit) return hit
  const r = breed(
    { speciesId: a.id, level: a.level, parents: a.parents },
    { speciesId: b.id, level: b.level, parents: b.parents },
    { makina: opti ? 'optimakina' : null, rules, kappa },
  )
  const d: Dist = { items: r.outcomes.map((o) => ({ id: o.speciesId, p: o.probability, genetons: o.genetons })), makinaGeneration: r.makinaGenerationRequired }
  if (distCache.size > 50_000) distCache.clear()
  distCache.set(key, d)
  return d
}

// ---------- Un tirage ----------

export const FUEL_GAUGES: GaugeId[] = ['foudroyeur', 'abreuvoir', 'dragofesse', 'baffeur', 'caresseur', 'mangeoire']

/** Résultat d'un tirage (un programme complet jusqu'à la première naissance de la cible). */
export interface ProgramRun {
  seed: number
  success: boolean
  captures: number
  /** Captures par couleur G1 (id d'espèce → nombre). */
  capturesByColor: Record<number, number>
  matings: number
  /** Accouplements qui ont donné le bébé visé par la recette. */
  successes: number
  /** Montures rendues fécondes (= passages en enclos). */
  fecundations: number
  clones: number
  optimakinas: number
  /** Optimakinas utilisées par génération de makina requise (≥ génération cible de l'accouplement). */
  makinasByGeneration: Record<number, number>
  /** Sessions de jeu (cycles) jusqu'à la naissance de la cible. */
  cycles: number
  days: number
  genetons: number
  jobXpMatings: number
  jobXpCaptures: number
  jobXp: number
  /** Points de carburant consommés par jauge (consommation partagée par le lot). */
  fuelPoints: Record<GaugeId, number>
  /** Endurance + maturité + amour + sérénité. */
  statFuelPoints: number
  /** Mangeoire (toute l'XP donnée, y compris jusqu'au niveau 40). */
  xpFuelPoints: number
  totalFuelPoints: number
  /** XP gagnée par les montures (somme sur toutes les montures). */
  mountXp: number
  /** Montures de couleurs inutiles écartées (vente, extraction). */
  surplusMounts: number
  sterileLeft: number
  /** Ressources d'extraction des stériles restantes (= somme des générations). */
  extractResources: number
  /** Blocages de sexes résolus par une capture/production supplémentaire. */
  deadlocks: number
  /** Pic de montures hors enclos (étable + inventaire) : féconde, en attente, stériles. */
  peakHeld: number
}

function emptyFuel(): Record<GaugeId, number> {
  return { baffeur: 0, caresseur: 0, foudroyeur: 0, abreuvoir: 0, dragofesse: 0, mangeoire: 0 }
}

function addTo(m: Map<number, number>, k: number, v: number) {
  m.set(k, (m.get(k) ?? 0) + v)
}

function countIds(...lists: SimMount[][]): Map<number, number> {
  const c = new Map<number, number>()
  for (const l of lists) for (const m of l) addTo(c, m.id, 1)
  return c
}

/** Premier candidat du sexe voulu, en préférant un arbre « propre » (aucun parent de génération ≥ cible). */
function pickParent(list: SimMount[] | undefined, sex: 0 | 1, targetGen: number): number {
  if (!list) return -1
  let first = -1
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (m.sex !== sex) continue
    if (m.parents.every((p) => gen(p) < targetGen)) return i
    if (first < 0) first = i
  }
  return first
}

/** Simule un programme complet (un tirage) avec la graine donnée. */
export function simulateProgram(input: ProgramConfig, seed: number): ProgramRun {
  const cfg = normalizeProgramConfig(input)
  const plan = getPlan(cfg)
  const rules = cfg.rules
  const rng = mulberry32(seed)
  const sexOf = (): 0 | 1 => (rng() < 0.5 ? 0 : 1)
  const b = cfg.batchSize
  const slots = cfg.paddocks * b
  const cycleSeconds = 86_400 / cfg.sessionsPerDay
  const maxCycles = Math.max(1, Math.round(cfg.maxDays * cfg.sessionsPerDay))
  const fecundCycles = Math.max(1, Math.ceil(fertilitySeconds(cfg.tier, rules, cfg.serenityPointsPerBatch) / cycleSeconds - 1e-9))
  const xpPerSecond = rules.gaugeRatePerTick[cfg.tier] / TICK_SECONDS
  const freeXp = mountXpForLevel(FREE_XP_LEVEL)

  const run: ProgramRun = {
    seed,
    success: false,
    captures: 0,
    capturesByColor: {},
    matings: 0,
    successes: 0,
    fecundations: 0,
    clones: 0,
    optimakinas: 0,
    makinasByGeneration: {},
    cycles: 0,
    days: 0,
    genetons: 0,
    jobXpMatings: 0,
    jobXpCaptures: 0,
    jobXp: 0,
    fuelPoints: emptyFuel(),
    statFuelPoints: 0,
    xpFuelPoints: 0,
    totalFuelPoints: 0,
    mountXp: 0,
    surplusMounts: 0,
    sterileLeft: 0,
    extractResources: 0,
    deadlocks: 0,
    peakHeld: 0,
  }

  // Cible G1 : une capture suffit.
  if (gen(plan.target) <= 1) {
    run.success = true
    run.captures = 1
    run.capturesByColor[plan.target] = 1
    run.jobXpCaptures = JOB_XP_PER_CAPTURE
    run.jobXp = JOB_XP_PER_CAPTURE
    run.peakHeld = 1
    return run
  }

  const newMount = (id: number, sex: 0 | 1, parents: number[], levelOk: boolean): SimMount => {
    const L = levelOf(cfg, id)
    let extraCycles = 0
    if (!levelOk) {
      const xp = mountXpForLevel(L)
      run.mountXp += xp
      run.fuelPoints.mangeoire += xp / b
      extraCycles = Math.max(0, xp - freeXp) / xpPerSecond / cycleSeconds
    }
    return { id, sex, parents, level: L, remaining: fecundCycles + extraCycles }
  }

  let raw: SimMount[] = []
  let raising: SimMount[] = []
  let fecund: SimMount[] = []
  let sterile: SimMount[] = []
  const extraNeed = new Map<number, number>()
  let got = false
  let matingGenSum = 0
  // Montures hors enclos : en attente, fécondes, et stériles gardées pour le clonage (sans clonage,
  // elles sont vendues ou extraites aussitôt).
  const held = () => raw.length + fecund.length + (cfg.cloning ? sterile.length : 0)
  const statPerRaise = STAT_POINTS_PER_BATCH / 3 / b
  const serenityPerRaise = cfg.serenityPointsPerBatch / 2 / b

  for (let cyc = 1; cyc <= maxCycles; cyc++) {
    // ---- 1. Besoin de chaque couleur (fertiles = en attente + en enclos + fécondes)
    const have = countIds(raw, raising, fecund)
    const need = new Map<number, number>([[plan.target, 1]])
    for (const [c, v] of extraNeed) addTo(need, c, v)
    const attemptsWanted = new Map<number, number>()
    for (const c of plan.order) {
      const deficit = Math.max(0, (need.get(c) ?? 0) - (have.get(c) ?? 0))
      const att = deficit / (plan.chance.get(c) ?? 1)
      attemptsWanted.set(c, deficit > 0 ? Math.ceil(att - 1e-9) : 0)
      const [pa, pb] = plan.best.get(c) as [number, number]
      // Avec clonage, chaque tentative rend ≈ 1 parent fertile (2 stériles → 1 clone).
      const f = cfg.cloning ? (gen(pa) === gen(pb) ? 0.5 : 0.75) : 1
      addTo(need, pa, att * f)
      addTo(need, pb, att * f)
    }

    // ---- 2. Accouplements des fécondes
    let mated = 0
    const pool = new Map<number, SimMount[]>()
    for (const m of fecund) {
      const l = pool.get(m.id)
      if (l) l.push(m)
      else pool.set(m.id, [m])
    }
    const used = new Set<SimMount>()
    for (const c of plan.order) {
      let k = attemptsWanted.get(c) ?? 0
      const [a, bb] = plan.best.get(c) as [number, number]
      const gc = gen(c)
      while (k > 0) {
        const la = pool.get(a)
        const lb = pool.get(bb)
        let ia = -1
        let ib = -1
        for (const sa of [0, 1] as const) {
          const xa = pickParent(la, sa, gc)
          const xb = pickParent(lb, sa === 0 ? 1 : 0, gc)
          if (xa >= 0 && xb >= 0) {
            ia = xa
            ib = xb
            break
          }
        }
        if (ia < 0 || !la || !lb) break
        const ma = la.splice(ia, 1)[0]
        const mb = lb.splice(ib, 1)[0]
        used.add(ma)
        used.add(mb)
        const opti = usesOptimakina(cfg.makina, gc)
        const d = distribution(ma, mb, opti, rules, cfg.kappa)
        const r = rng()
        let acc = 0
        let baby = d.items[d.items.length - 1]
        for (const it of d.items) {
          acc += it.p
          if (r <= acc) {
            baby = it
            break
          }
        }
        run.matings += 1
        matingGenSum += gen(ma.id) + gen(mb.id)
        if (opti) {
          run.optimakinas += 1
          run.makinasByGeneration[d.makinaGeneration] = (run.makinasByGeneration[d.makinaGeneration] ?? 0) + 1
        }
        run.genetons += baby.genetons
        if (baby.id === c) run.successes += 1
        for (const pc of [a, bb]) {
          const e = extraNeed.get(pc) ?? 0
          if (e > 0) extraNeed.set(pc, e - 1)
        }
        if (baby.id === plan.target) got = true
        raw.push(newMount(baby.id, sexOf(), [ma.id, mb.id], false))
        sterile.push(ma, mb)
        mated += 1
        k -= 1
      }
      if (got) break
    }
    if (used.size) fecund = fecund.filter((m) => !used.has(m))
    if (got) {
      run.cycles = cyc
      run.success = true
      run.peakHeld = Math.max(run.peakHeld, held())
      break
    }

    // ---- 3. Clonage (même génération ; même couleur d'abord, puis couleurs utiles mélangées)
    if (cfg.cloning) {
      const byGen = new Map<number, SimMount[]>()
      for (const m of sterile) {
        const g = gen(m.id)
        const l = byGen.get(g)
        if (l) l.push(m)
        else byGen.set(g, [m])
      }
      sterile = []
      const cloneOf = (x: SimMount, y: SimMount) => {
        const keep = rng() < 0.5 ? x : y
        run.clones += 1
        raw.push(newMount(keep.id, keep.sex, keep.parents, cfg.cloneKeepsLevel))
      }
      for (const list of byGen.values()) {
        const useful = list.filter((m) => plan.needed.has(m.id))
        const useless = list.filter((m) => !plan.needed.has(m.id))
        const byColor = new Map<number, SimMount[]>()
        for (const m of useful) {
          const l = byColor.get(m.id)
          if (l) l.push(m)
          else byColor.set(m.id, [m])
        }
        const leftovers: SimMount[] = []
        for (const ms of byColor.values()) {
          while (ms.length >= 2) cloneOf(ms.pop() as SimMount, ms.pop() as SimMount)
          leftovers.push(...ms)
        }
        while (leftovers.length >= 2) cloneOf(leftovers.pop() as SimMount, leftovers.pop() as SimMount)
        if (leftovers.length && useless.length) cloneOf(leftovers.pop() as SimMount, useless.pop() as SimMount)
        sterile.push(...leftovers, ...useless)
      }
    }

    // ---- 4. Écarter les bébés de couleurs inutiles (vente / extraction) pour libérer les places
    const before = raw.length
    raw = raw.filter((m) => plan.needed.has(m.id))
    run.surplusMounts += before - raw.length

    // ---- 5. Captures : G1 en déficit, au plus les places libres
    const have2 = countIds(raw, raising, fecund)
    const free = slots - raising.length - raw.length
    let captured = 0
    if (free > 0) {
      const deficits: [number, number][] = []
      for (const c of plan.g1) {
        const d = (need.get(c) ?? 0) - (have2.get(c) ?? 0)
        if (d > 0) deficits.push([c, d])
      }
      const tot = deficits.reduce((s, [, v]) => s + v, 0)
      if (tot > 0) {
        const budget = Math.min(free, Math.ceil(tot))
        const alloc = new Map<number, number>(deficits.map(([c, v]) => [c, Math.floor((budget * v) / tot)]))
        let rest = budget - [...alloc.values()].reduce((s, v) => s + v, 0)
        for (const [c] of [...deficits].sort((x, y) => y[1] - x[1])) {
          if (rest <= 0) break
          addTo(alloc, c, 1)
          rest -= 1
        }
        for (const [c, n] of alloc) {
          for (let i = 0; i < n; i++) raw.push(newMount(c, sexOf(), [], false))
          if (n > 0) run.capturesByColor[c] = (run.capturesByColor[c] ?? 0) + n
          captured += n
        }
      }
    }
    run.captures += captured

    // Blocage de sexes : on demande un exemplaire de plus de chaque parent de la recette la plus haute.
    if (mated === 0 && raising.length === 0 && captured === 0 && raw.length === 0) {
      run.deadlocks += 1
      for (const c of plan.order)
        if ((attemptsWanted.get(c) ?? 0) > 0) {
          const [pa, pb] = plan.best.get(c) as [number, number]
          addTo(extraNeed, pa, 1)
          addTo(extraNeed, pb, 1)
          break
        }
    }

    // ---- 6. Mise en enclos : places libres, génération la plus haute d'abord
    const free2 = slots - raising.length
    if (free2 > 0 && raw.length) {
      raw.sort((x, y) => gen(y.id) - gen(x.id))
      const moved = raw.splice(0, free2)
      for (const m of moved) {
        raising.push(m)
        run.fecundations += 1
        run.fuelPoints.foudroyeur += statPerRaise
        run.fuelPoints.abreuvoir += statPerRaise
        run.fuelPoints.dragofesse += statPerRaise
        run.fuelPoints.baffeur += serenityPerRaise
        run.fuelPoints.caresseur += serenityPerRaise
      }
    }
    const still: SimMount[] = []
    for (const m of raising) {
      m.remaining -= 1
      if (m.remaining <= 1e-9) fecund.push(m)
      else still.push(m)
    }
    raising = still
    run.peakHeld = Math.max(run.peakHeld, held())
  }

  if (!got) run.cycles = maxCycles
  run.days = run.cycles / cfg.sessionsPerDay
  run.sterileLeft = sterile.length
  run.extractResources = sterile.reduce((s, m) => s + gen(m.id), 0)
  run.jobXpMatings = rules.matingXpPerGeneration * matingGenSum
  run.jobXpCaptures = JOB_XP_PER_CAPTURE * run.captures
  run.jobXp = run.jobXpMatings + run.jobXpCaptures
  run.xpFuelPoints = run.fuelPoints.mangeoire
  run.statFuelPoints = FUEL_GAUGES.filter((g) => g !== 'mangeoire').reduce((s, g) => s + run.fuelPoints[g], 0)
  run.totalFuelPoints = run.statFuelPoints + run.xpFuelPoints
  return run
}

// ---------- Agrégation ----------

export interface DistStat {
  mean: number
  /**
   * 10e centile. Convention de la recherche (défaut) : v[floor(0,1·(n−1))] ; avec `interpolate` :
   * interpolation linéaire entre les deux valeurs encadrantes (ne colle plus au minimum pour n = 3).
   */
  p10: number
  p90: number
  min: number
  max: number
  /** Nombre de valeurs (tirages). */
  n?: number
  /** Écart-type de l'échantillon (n − 1 ; 0 pour une seule valeur). */
  sd?: number
}

/** Quantile q (0…1) d'une liste triée, par interpolation linéaire. */
export function quantileSorted(sorted: readonly number[], q: number): number {
  const n = sorted.length
  if (!n) return 0
  const pos = Math.min(1, Math.max(0, q)) * (n - 1)
  const lo = Math.floor(pos)
  const hi = Math.min(n - 1, lo + 1)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** Écart-type d'échantillon (n − 1) ; 0 pour moins de deux valeurs. */
export function sampleSd(values: readonly number[]): number {
  const n = values.length
  if (n < 2) return 0
  const m = values.reduce((s, x) => s + x, 0) / n
  return Math.sqrt(values.reduce((s, x) => s + (x - m) * (x - m), 0) / (n - 1))
}

export function distStat(values: number[], opts: { interpolate?: boolean } = {}): DistStat {
  if (!values.length) return { mean: 0, p10: 0, p90: 0, min: 0, max: 0, n: 0, sd: 0 }
  const v = [...values].sort((x, y) => x - y)
  const n = v.length
  return {
    mean: v.reduce((s, x) => s + x, 0) / n,
    p10: opts.interpolate ? quantileSorted(v, 0.1) : v[Math.floor(0.1 * (n - 1))],
    p90: opts.interpolate ? quantileSorted(v, 0.9) : v[Math.floor(0.9 * (n - 1))],
    min: v[0],
    max: v[n - 1],
    n,
    sd: sampleSd(v),
  }
}

export const SUMMARY_METRICS = [
  'captures',
  'matings',
  'successes',
  'fecundations',
  'clones',
  'optimakinas',
  'cycles',
  'days',
  'genetons',
  'jobXp',
  'jobXpMatings',
  'jobXpCaptures',
  'statFuelPoints',
  'xpFuelPoints',
  'totalFuelPoints',
  'mountXp',
  'surplusMounts',
  'sterileLeft',
  'extractResources',
  'deadlocks',
  'peakHeld',
] as const

export type SummaryMetric = (typeof SUMMARY_METRICS)[number]

export interface ProgramSummary {
  config: NormalizedProgramConfig
  runs: number
  /** Part des tirages qui obtiennent la cible avant `maxDays`. */
  successRate: number
  metrics: Record<SummaryMetric, DistStat>
  fuelPoints: Record<GaugeId, DistStat>
  /** Optimakinas moyennes par génération de makina. */
  makinasByGeneration: { generation: number; mean: number }[]
  /** Captures moyennes par couleur G1. */
  capturesByColor: { speciesId: number; mean: number }[]
  steps: ProgramStep[]
  family: FamilyId
  slots: number
  cycleHours: number
  /** Cycles nécessaires pour rendre un lot fécond au palier choisi. */
  fecundationCycles: number
}

/** Agrège des tirages (moyenne, p10, p90). */
export function summarizeProgram(input: ProgramConfig, runs: ProgramRun[]): ProgramSummary {
  const cfg = normalizeProgramConfig(input)
  const plan = getPlan(cfg)
  const metrics = {} as Record<SummaryMetric, DistStat>
  for (const k of SUMMARY_METRICS) metrics[k] = distStat(runs.map((r) => r[k]))
  const fuelPoints = {} as Record<GaugeId, DistStat>
  for (const g of FUEL_GAUGES) fuelPoints[g] = distStat(runs.map((r) => r.fuelPoints[g]))
  const n = Math.max(1, runs.length)
  const sumBy = (pick: (r: ProgramRun) => Record<number, number>) => {
    const acc = new Map<number, number>()
    for (const r of runs) for (const [k, v] of Object.entries(pick(r))) addTo(acc, Number(k), v)
    return acc
  }
  const makinas = [...sumBy((r) => r.makinasByGeneration)].map(([generation, s]) => ({ generation, mean: s / n })).sort((x, y) => x.generation - y.generation)
  const colors = [...sumBy((r) => r.capturesByColor)].map(([speciesId, s]) => ({ speciesId, mean: s / n })).sort((x, y) => y.mean - x.mean || x.speciesId - y.speciesId)
  const cycleSeconds = 86_400 / cfg.sessionsPerDay
  return {
    config: cfg,
    runs: runs.length,
    successRate: runs.length ? runs.filter((r) => r.success).length / runs.length : 0,
    metrics,
    fuelPoints,
    makinasByGeneration: makinas,
    capturesByColor: colors,
    steps: plan.steps,
    family: plan.family,
    slots: cfg.paddocks * cfg.batchSize,
    cycleHours: 24 / cfg.sessionsPerDay,
    fecundationCycles: Math.max(1, Math.ceil(fertilitySeconds(cfg.tier, cfg.rules, cfg.serenityPointsPerBatch) / cycleSeconds - 1e-9)),
  }
}

export interface RunOptions {
  /** Appelé après chaque tirage (terminés, total). */
  onProgress?: (done: number, total: number) => void
}

/** Lance `config.runs` tirages (synchrone) et les agrège. */
export function runProgram(config: ProgramConfig, opts: RunOptions = {}): ProgramSummary {
  const cfg = normalizeProgramConfig(config)
  const runs: ProgramRun[] = []
  for (let i = 0; i < cfg.runs; i++) {
    runs.push(simulateProgram(cfg, runSeed(cfg.seed, i)))
    opts.onProgress?.(i + 1, cfg.runs)
  }
  return summarizeProgram(cfg, runs)
}

// ---------- Plusieurs stratégies (worker ou fil principal) ----------

export interface StrategyJob {
  id: string
  label: string
  config: ProgramConfig
}

export interface StrategyJobResult {
  id: string
  label: string
  summary: ProgramSummary
}

export interface StrategiesRunOptions {
  /** Progression globale (tirages terminés sur le total de toutes les stratégies). */
  onProgress?: (done: number, total: number, jobId: string) => void
  onResult?: (result: StrategyJobResult) => void
}

function totalRuns(jobs: StrategyJob[]): number {
  return jobs.reduce((s, j) => s + normalizeProgramConfig(j.config).runs, 0)
}

/** Simule plusieurs stratégies à la suite (synchrone : utilisé par le Web Worker). */
export function runStrategies(jobs: StrategyJob[], opts: StrategiesRunOptions = {}): StrategyJobResult[] {
  const total = totalRuns(jobs)
  let done = 0
  const out: StrategyJobResult[] = []
  for (const job of jobs) {
    const summary = runProgram(job.config, { onProgress: () => opts.onProgress?.(++done, total, job.id) })
    const res = { id: job.id, label: job.label, summary }
    out.push(res)
    opts.onResult?.(res)
  }
  return out
}

/**
 * Même chose, en rendant la main entre deux paquets de tirages (repli sur le fil principal quand les
 * Web Workers sont indisponibles). Retourne null si `shouldStop()` devient vrai.
 */
export async function runStrategiesAsync(
  jobs: StrategyJob[],
  opts: StrategiesRunOptions & { shouldStop?: () => boolean; sliceMs?: number } = {},
): Promise<StrategyJobResult[] | null> {
  const total = totalRuns(jobs)
  const slice = opts.sliceMs ?? 40
  let done = 0
  const out: StrategyJobResult[] = []
  let last = Date.now()
  for (const job of jobs) {
    const cfg = normalizeProgramConfig(job.config)
    const runs: ProgramRun[] = []
    for (let i = 0; i < cfg.runs; i++) {
      if (opts.shouldStop?.()) return null
      runs.push(simulateProgram(cfg, runSeed(cfg.seed, i)))
      opts.onProgress?.(++done, total, job.id)
      if (Date.now() - last > slice) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        last = Date.now()
      }
    }
    const res = { id: job.id, label: job.label, summary: summarizeProgram(cfg, runs) }
    out.push(res)
    opts.onResult?.(res)
  }
  return out
}

// ---------- Stratégies prédéfinies ----------

export interface StrategyPreset {
  id: string
  /** Libellé court (tableaux, graphiques). */
  label: string
  /** Pourquoi cette stratégie (affichage). */
  description: string
  parentLevel: number
  levelByGeneration?: Partial<Record<number, number>>
  makina: MakinaPolicy
  cloning: boolean
  /** Cochée par défaut dans la comparaison. */
  defaultSelected: boolean
  warning?: string
}

/** Politique mixte de la recherche (run_grid2.py : niveau selon la génération du parent). */
export const MIXED_LEVELS: Partial<Record<number, number>> = { 1: 40, 2: 40, 3: 40, 4: 40, 5: 60, 6: 60, 7: 100, 8: 100, 9: 100 }

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: 'n1',
    label: 'Niv. 1 sans makina',
    description: 'Accouplements dès que les montures sont fécondes, sans XP ni makina. Le moins de carburant de Mangeoire, mais B = 30 % seulement : beaucoup de captures et d\'accouplements.',
    parentLevel: 1,
    makina: 'none',
    cloning: true,
    defaultSelected: true,
  },
  {
    id: 'n40',
    label: 'Niv. 40 sans makina',
    description: 'Parents montés au niveau 40 avec la Mangeoire en 2e jauge pendant la fécondation (gratuit en temps) : B = 42 %. Référence de la recherche.',
    parentLevel: 40,
    makina: 'none',
    cloning: true,
    defaultSelected: true,
  },
  {
    id: 'n40-opti-g6',
    label: 'Niv. 40 + Optimakina dès G6',
    description: 'Optimakina seulement pour les bébés de génération ≥ 6, là où les parents coûtent cher (« systématique dès la G6 », strategy.md §5.3). Peu de makinas, gain notable.',
    parentLevel: 40,
    makina: { fromGeneration: 6 },
    cloning: true,
    defaultSelected: true,
  },
  {
    id: 'n40-opti',
    label: 'Niv. 40 + Optimakina partout',
    description: 'Une Optimakina à chaque accouplement : −40 à −65 % de captures, accouplements et carburant selon la recherche, au prix d\'une makina par accouplement.',
    parentLevel: 40,
    makina: 'all',
    cloning: true,
    defaultSelected: true,
  },
  {
    id: 'n100-opti',
    label: 'Niv. 100 + Optimakina partout',
    description: 'B = 70 % : le moins de captures, mais l\'XP (172 668 par monture) immobilise les places d\'enclos et coûte beaucoup de Mangeoire.',
    parentLevel: 100,
    makina: 'all',
    cloning: true,
    defaultSelected: true,
  },
  {
    id: 'mixte',
    label: 'Niv. 40/60/100 + Opti dès G8',
    description: 'Politique mixte de la recherche : parents G1-G4 au niveau 40, G5-G6 au niveau 60, G7-G9 au niveau 100 ; Optimakina pour les bébés G8 et plus.',
    parentLevel: 40,
    levelByGeneration: MIXED_LEVELS,
    makina: { fromGeneration: 8 },
    cloning: true,
    defaultSelected: false,
  },
  {
    id: 'sans-clonage',
    label: 'Niv. 40 sans clonage',
    description: 'Pour mesurer l\'effet du clonage : chaque accouplement consomme définitivement ses deux parents.',
    parentLevel: 40,
    makina: 'none',
    cloning: false,
    defaultSelected: false,
    warning: 'Sans clonage, la pyramide explose dès la G7 (×80 à ×100 de captures) : la simulation s\'arrête à la durée maximale.',
  },
]

export function findPreset(id: string): StrategyPreset | undefined {
  return STRATEGY_PRESETS.find((p) => p.id === id)
}

export type ProgramBase = Omit<ProgramConfig, 'parentLevel' | 'levelByGeneration' | 'makina' | 'cloning'>

/** Configuration complète d'une stratégie prédéfinie. */
export function presetConfig(preset: Pick<StrategyPreset, 'parentLevel' | 'levelByGeneration' | 'makina' | 'cloning'>, base: ProgramBase): ProgramConfig {
  return { ...base, parentLevel: preset.parentLevel, levelByGeneration: preset.levelByGeneration, makina: preset.makina, cloning: preset.cloning }
}

// ---------- Références de la recherche (Python, 40 tirages, 60 places, cycles de 12 h) ----------

export interface ResearchReference {
  speciesName: string
  presetId: string
  /** Jeu de règles de la référence ('3.6' couvre aussi 3.5 : même bonus d'Optimakina). */
  rules: '3.6' | '3.7'
  captures: number
  matings: number
  fecundations?: number
  optimakinas?: number
  /** Carburant en millions de points (stats + XP au-delà du niveau 40, définition de la recherche). */
  fuelMillions?: number
  halfDays?: number
  genetons?: number
}

const ref = (speciesName: string, presetId: string, captures: number, matings: number, more: Partial<ResearchReference> = {}): ResearchReference => ({
  speciesName,
  presetId,
  rules: '3.6',
  captures,
  matings,
  ...more,
})

/** Valeurs de research/strategy.md §6.2 (pyramid-results.json et pyramid-results-v2.json). */
export const RESEARCH_REFERENCES: ResearchReference[] = [
  ref('Dragodinde Ébène', 'n1', 20, 32),
  ref('Dragodinde Ébène', 'n40', 13, 14),
  ref('Dragodinde Ébène', 'n40-opti', 13, 13),
  ref('Dragodinde Ébène', 'n100-opti', 10, 9),
  ref('Dragodinde Pourpre', 'n1', 83, 170),
  ref('Dragodinde Pourpre', 'n40', 38, 78),
  ref('Dragodinde Pourpre', 'n40-opti', 28, 53),
  ref('Dragodinde Pourpre', 'n100-opti', 19, 32),
  ref('Dragodinde Turquoise', 'n1', 184, 726),
  ref('Dragodinde Turquoise', 'n40', 99, 278),
  ref('Dragodinde Turquoise', 'n40-opti', 66, 165),
  ref('Dragodinde Turquoise', 'n100-opti', 34, 88),
  ref('Dragodinde Émeraude', 'n1', 638, 3394, { fecundations: 7393, optimakinas: 0, fuelMillions: 46.6, halfDays: 139, genetons: 5260 }),
  ref('Dragodinde Émeraude', 'n40', 188, 821, { fecundations: 1813, optimakinas: 0, fuelMillions: 11.4, halfDays: 56, genetons: 2991 }),
  ref('Dragodinde Émeraude', 'n40-opti-g6', 150, 591, { fecundations: 1318, optimakinas: 65, fuelMillions: 8.3, halfDays: 49, genetons: 2399 }),
  ref('Dragodinde Émeraude', 'n40-opti', 111, 378, { fecundations: 855, optimakinas: 378, fuelMillions: 5.4, halfDays: 40, genetons: 2198 }),
  ref('Dragodinde Émeraude', 'mixte', 134, 514, { fecundations: 1148, optimakinas: 10, fuelMillions: 7.7, halfDays: 71, genetons: 2233 }),
  ref('Dragodinde Émeraude', 'n100-opti', 64, 217),
  ref('Dragodinde Émeraude', 'n40-opti-g6', 117, 426, { rules: '3.7', fecundations: 958, optimakinas: 44, fuelMillions: 6.0, halfDays: 47, genetons: 2034 }),
  ref('Dragodinde Amande et Émeraude', 'n40', 247, 1130, { fecundations: 2487, optimakinas: 0, fuelMillions: 15.7, halfDays: 58, genetons: 4093 }),
  ref('Dragodinde Amande et Émeraude', 'n40-opti', 137, 471, { fecundations: 1064, optimakinas: 471, fuelMillions: 6.7, halfDays: 48, genetons: 3169 }),
  ref('Muldo Prune', 'n1', 184, 714),
  ref('Muldo Prune', 'n40', 104, 259),
  ref('Muldo Prune', 'n40-opti', 63, 135),
  ref('Muldo Prune', 'n100-opti', 49, 85),
  ref('Muldo Corail', 'n40', 183, 617, { fecundations: 1382, optimakinas: 0, fuelMillions: 8.7, halfDays: 41, genetons: 2081 }),
  ref('Muldo Corail', 'n40-opti', 108, 267, { fecundations: 624, optimakinas: 267, fuelMillions: 3.9, halfDays: 36, genetons: 1586 }),
  ref('Muldo Corail et Doré', 'n40', 228, 818, { fecundations: 1818, optimakinas: 0, fuelMillions: 11.5, halfDays: 47, genetons: 3346 }),
  ref('Muldo Corail et Doré', 'n40-opti', 119, 322, { fecundations: 744, optimakinas: 322, fuelMillions: 4.7, halfDays: 39, genetons: 2269 }),
  ref('Volkorne Doré', 'n1', 204, 921),
  ref('Volkorne Doré', 'n40', 101, 328),
  ref('Volkorne Doré', 'n40-opti', 76, 238),
  ref('Volkorne Doré', 'n100-opti', 58, 140),
  ref('Volkorne Jade', 'n40', 198, 775, { fecundations: 1722, optimakinas: 0, fuelMillions: 10.9, halfDays: 46, genetons: 2021 }),
  ref('Volkorne Jade', 'n40-opti', 106, 347, { fecundations: 784, optimakinas: 347, fuelMillions: 4.9, halfDays: 52, genetons: 1507 }),
  ref('Volkorne Jade et Pourpre', 'n40', 281, 1208, { fecundations: 2659, optimakinas: 0, fuelMillions: 16.8, halfDays: 57, genetons: 3493 }),
  ref('Volkorne Jade et Pourpre', 'n40-opti', 124, 417, { fecundations: 940, optimakinas: 417, fuelMillions: 5.9, halfDays: 46, genetons: 2216 }),
]

/** Référence de la recherche pour une cible et une stratégie prédéfinie (règles 3.5/3.6 ou 3.7). */
export function researchReference(speciesId: number, presetId: string, rules: Ruleset): ResearchReference | undefined {
  const name = getSpecies(speciesId)?.name
  const want = rules.optimakinaBonus >= 0.2 ? '3.7' : '3.6'
  return RESEARCH_REFERENCES.find((r) => r.speciesName === name && r.presetId === presetId && r.rules === want)
}

/** Espèces ayant au moins une référence de la recherche (ids). */
export function researchReferenceSpecies(): number[] {
  const names = new Set(RESEARCH_REFERENCES.map((r) => r.speciesName))
  return SPECIES.filter((s) => names.has(s.name)).map((s) => s.id)
}

// ---------- Coût en kamas ----------

export type ProgramCostCategory = 'carburant' | 'makina' | 'capture'

export const PROGRAM_COST_LABELS: Record<ProgramCostCategory, string> = {
  carburant: 'Carburants',
  makina: 'Optimakinas',
  capture: 'Filets de capture',
}

export interface ProgramCostLine {
  key: string
  category: ProgramCostCategory
  label: string
  gauge?: GaugeId
  generation?: number
  /** Quantité moyenne (points de jauge, makinas ou montures capturées). */
  quantity: number
  unit: 'points' | 'makinas' | 'montures'
  /** Prix unitaire (kamas par point, par makina, par monture) ; borne si incomplet. */
  unitCost: number | null
  /** Coût moyen de la ligne ; null si inconnu. */
  cost: number | null
  complete: boolean
  /** Nature de `unitCost`/`cost` quand incomplet : borne basse (ingrédients partiels) ou haute (palier supérieur). */
  bound: 'min' | 'max' | null
  /** Valeur venant d'une estimation de la recherche (Mangeoire par défaut). */
  estimated: boolean
  /** Objets dont il faut saisir le prix. */
  missing: number[]
  /** Objet retenu (carburant, makina, filet) pour l'affichage. */
  itemId: number | null
  note?: string
}

export interface ProgramCostOptions {
  ctx: PriceContext
  rules: Ruleset
  /** Palier de jauge entretenu (prix au point). */
  tier: FuelTier
  jobLevel: number
  netKind?: NetKind
  mountsPerCast?: number
  /** Kamas par généton (valeur des génétons gagnés en route). */
  genetonValue?: number | null
  craftableOnly?: boolean
}

export interface ProgramCost {
  lines: ProgramCostLine[]
  byCategory: Record<ProgramCostCategory, { cost: number; complete: boolean }>
  /** Somme des coûts connus : coût exact si `complete`, sinon borne basse. */
  total: number
  complete: boolean
  /** Une partie du coût vient d'une estimation de la recherche. */
  estimated: boolean
  missing: number[]
  /** Coût hors makinas (pour la règle de l'Optimakina). */
  nonMakinaCost: number
  nonMakinaComplete: boolean
  makinaCost: number
  makinaComplete: boolean
  /** Valeur des génétons gagnés en route (null si la valeur d'un généton n'est pas fournie). */
  genetonsValue: number | null
}

/**
 * Coût moyen en kamas d'un programme simulé : points de chaque jauge × coût au point du palier
 * entretenu (`bestFuel` ; jauges de sérénité au palier 1, `maintainedTier`), Optimakinas par génération (`makinaCost`), filets (`captureCost`). Un prix manquant
 * n'est jamais compté comme 0 : la ligne est incomplète et le total devient une borne basse.
 */
export function estimateProgramCost(summary: ProgramSummary, opts: ProgramCostOptions): ProgramCost {
  const lines: ProgramCostLine[] = []
  const fopts = { jobLevel: opts.jobLevel, rules: opts.rules, craftableOnly: opts.craftableOnly }
  for (const g of FUEL_GAUGES) {
    const points = summary.fuelPoints[g].mean
    if (points <= 0) continue
    // Même palier que la page Enclos et Rentabilité : Baffeur et Caresseur entretenus au palier 1.
    const pc = bestFuel(g, maintainedTier(g, Number.POSITIVE_INFINITY, opts.tier, opts.rules), opts.ctx, fopts)
    const usable = pc.value !== null
    lines.push({
      key: `fuel:${g}`,
      category: 'carburant',
      label: g,
      gauge: g,
      quantity: points,
      unit: 'points',
      unitCost: pc.value,
      cost: usable ? points * (pc.value as number) : null,
      complete: pc.complete,
      bound: pc.complete ? null : pc.bound,
      estimated: pc.estimated,
      missing: pc.complete ? [] : pc.missing,
      itemId: pc.fuel?.fuel.id ?? pc.toPrice?.fuel.id ?? null,
      note: pc.note,
    })
  }
  for (const { generation, mean } of summary.makinasByGeneration) {
    if (mean <= 0) continue
    const mc = makinaCost('optimakina', summary.family, generation, opts.ctx, opts.rules)
    lines.push({
      key: `makina:${generation}`,
      category: 'makina',
      label: mc.makina?.name ?? `Optimakina G${generation}`,
      generation,
      quantity: mean,
      unit: 'makinas',
      unitCost: mc.price,
      cost: mc.price === null ? null : mc.price * mean,
      complete: mc.complete,
      bound: mc.complete ? null : mc.price !== null ? 'min' : null,
      estimated: false,
      missing: mc.complete ? [] : mc.missing.length ? mc.missing : mc.makina ? [mc.makina.id] : [],
      itemId: mc.makina?.id ?? null,
    })
  }
  const captures = summary.metrics.captures.mean
  if (captures > 0) {
    const cc = captureCost(summary.family, opts.netKind ?? 'universel', opts.ctx, { mountsPerCast: opts.mountsPerCast, jobLevel: opts.jobLevel })
    lines.push({
      key: 'capture',
      category: 'capture',
      label: cc.net?.name ?? 'Filet de capture',
      quantity: captures,
      unit: 'montures',
      unitCost: cc.perMount,
      cost: cc.perMount === null ? null : cc.perMount * captures,
      complete: cc.complete,
      bound: cc.complete ? null : cc.perMount !== null ? 'min' : null,
      estimated: false,
      missing: cc.complete ? [] : cc.missing,
      itemId: cc.net?.id ?? null,
      note: cc.canEquip ? cc.note : `Niveau d'Éleveur ${cc.requiredLevel} requis pour équiper ce filet. ${cc.note}`,
    })
  }
  // Une ligne bornée par le haut (« ≤ ») n'entre pas dans la borne basse du total.
  const counted = (l: ProgramCostLine) => l.cost !== null && l.bound !== 'max'
  const byCategory: Record<ProgramCostCategory, { cost: number; complete: boolean }> = {
    carburant: { cost: 0, complete: true },
    makina: { cost: 0, complete: true },
    capture: { cost: 0, complete: true },
  }
  for (const l of lines) {
    if (counted(l)) byCategory[l.category].cost += l.cost as number
    if (!l.complete) byCategory[l.category].complete = false
  }
  const total = byCategory.carburant.cost + byCategory.makina.cost + byCategory.capture.cost
  const genetons = summary.metrics.genetons.mean
  return {
    lines,
    byCategory,
    total,
    complete: lines.every((l) => l.complete),
    estimated: lines.some((l) => l.estimated),
    missing: [...new Set(lines.flatMap((l) => l.missing))],
    nonMakinaCost: byCategory.carburant.cost + byCategory.capture.cost,
    nonMakinaComplete: byCategory.carburant.complete && byCategory.capture.complete,
    makinaCost: byCategory.makina.cost,
    makinaComplete: byCategory.makina.complete,
    genetonsValue: opts.genetonValue === null || opts.genetonValue === undefined ? null : genetons * opts.genetonValue,
  }
}

// ---------- Comparaison et recommandation ----------

export interface StrategyOutcome {
  id: string
  label: string
  summary: ProgramSummary
  cost: ProgramCost | null
}

export interface MakinaTradeoff {
  strategyId: string
  referenceId: string
  makinas: number
  capturesSaved: number
  matingsSaved: number
  fuelPointsSaved: number
  daysSaved: number
  /** Économie hors makinas (kamas), si les deux coûts hors makinas sont complets. */
  savings: number | null
  /** Prix moyen d'Optimakina en dessous duquel la stratégie est rentable. */
  breakEvenPrice: number | null
  /** Prix moyen d'une Optimakina avec les prix actuels (si complet). */
  averageMakinaPrice: number | null
  /** Rentable avec les prix actuels (null si indéterminé). */
  worthIt: boolean | null
}

export interface Recommendation {
  tone: 'ok' | 'info' | 'warn'
  title: string
  text: string
}

export interface StrategyComparison {
  /** Stratégies qui atteignent la cible dans ≥ 90 % des tirages. */
  reliable: string[]
  fastest: string | null
  /** Moins chère, si elle est certaine malgré les coûts incomplets ; sinon null. */
  cheapest: string | null
  /** Vrai si tous les coûts sont complets. */
  costComparable: boolean
  fewestCaptures: string | null
  leastFuel: string | null
  tradeoffs: MakinaTradeoff[]
  messages: Recommendation[]
}

export const RELIABLE_SUCCESS_RATE = 0.9

const fmtInt = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n))
const fmtDec = (n: number, d = 1) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d }).format(n)
const fmtK = (n: number) => `${fmtInt(n)} K`

function sameLevels(a: NormalizedProgramConfig, b: NormalizedProgramConfig): boolean {
  return a.parentLevel === b.parentLevel && JSON.stringify(a.levelByGeneration ?? {}) === JSON.stringify(b.levelByGeneration ?? {})
}

function minBy<T>(list: T[], f: (x: T) => number): T | null {
  let best: T | null = null
  let bv = Infinity
  for (const x of list) {
    const v = f(x)
    if (v < bv) {
      bv = v
      best = x
    }
  }
  return best
}

/**
 * Compare des stratégies simulées : la plus rapide, la moins chère (si les prix permettent de
 * conclure), la plus sobre en captures et en carburant, et le bilan de chaque politique d'Optimakina
 * face à la même stratégie sans makina (prix d'équilibre = économie hors makinas / makinas).
 */
export function compareStrategies(outcomes: StrategyOutcome[]): StrategyComparison {
  const messages: Recommendation[] = []
  const reliableList = outcomes.filter((o) => o.summary.successRate >= RELIABLE_SUCCESS_RATE)
  const pool = reliableList.length ? reliableList : outcomes
  const label = (id: string | null | undefined) => `« ${outcomes.find((o) => o.id === id)?.label ?? '?'} »`
  const m = (o: StrategyOutcome) => o.summary.metrics

  const fastest = minBy(pool, (o) => m(o).days.mean)
  const fewestCaptures = minBy(pool, (o) => m(o).captures.mean)
  const leastFuel = minBy(pool, (o) => m(o).totalFuelPoints.mean)

  // Coût : la moins chère parmi les coûts complets, retenue seulement si aucune stratégie au coût
  // incomplet n'a une borne basse inférieure.
  const withCost = pool.filter((o) => o.cost)
  const complete = withCost.filter((o) => o.cost?.complete)
  const costComparable = withCost.length > 0 && complete.length === withCost.length
  const cheapestComplete = minBy(complete, (o) => o.cost?.total ?? Infinity)
  let cheapest: StrategyOutcome | null = null
  if (cheapestComplete) {
    const bound = cheapestComplete.cost?.total ?? Infinity
    if (withCost.every((o) => o.cost?.complete || (o.cost?.total ?? 0) >= bound)) cheapest = cheapestComplete
  }

  if (fastest) {
    const d = m(fastest).days
    messages.push({
      tone: 'ok',
      title: `La plus rapide : ${label(fastest.id)}`,
      text: `≈ ${fmtDec(d.mean)} jours de jeu parfait (8 tirages sur 10 entre ${fmtDec(d.p10)} et ${fmtDec(d.p90)} j), soit ≈ ${fmtInt(d.mean * 1.5)} à ${fmtInt(d.mean * 2)} jours pour un joueur réel.`,
    })
  }
  if (cheapest) {
    messages.push({
      tone: 'ok',
      title: `La moins chère : ${label(cheapest.id)}`,
      text: `≈ ${fmtK(cheapest.cost?.total ?? 0)} de carburants, makinas et filets${cheapest.cost?.estimated ? ' (dont une part estimée)' : ''}.${costComparable ? '' : ' Les autres stratégies ont un coût incomplet, mais leur borne basse est déjà plus élevée.'}`,
    })
  } else if (withCost.length) {
    const missing = new Set(withCost.flatMap((o) => o.cost?.missing ?? []))
    const parts = [
      leastFuel ? `la plus sobre en carburant est ${label(leastFuel.id)} (${fmtDec(m(leastFuel).totalFuelPoints.mean / 1e6, 2)} M de points)` : '',
      fewestCaptures ? `la plus sobre en captures est ${label(fewestCaptures.id)} (${fmtInt(m(fewestCaptures).captures.mean)} captures)` : '',
    ].filter(Boolean)
    messages.push({
      tone: 'warn',
      title: 'Coût en kamas : impossible de départager',
      text: `Il manque ${missing.size} prix (carburants, makinas ou filets) : les coûts affichés sont des bornes basses. Renseignez-les sur la page Prix.${parts.length ? ` En attendant, ${parts.join(' ; ')}.` : ''}`,
    })
  }
  if (fewestCaptures && fewestCaptures.id !== fastest?.id && fewestCaptures.id !== cheapest?.id)
    messages.push({
      tone: 'info',
      title: `Le moins de captures : ${label(fewestCaptures.id)}`,
      text: `${fmtInt(m(fewestCaptures).captures.mean)} captures et ${fmtInt(m(fewestCaptures).matings.mean)} accouplements en moyenne.`,
    })

  // Optimakina : chaque stratégie avec makina face à la même stratégie (niveaux, clonage) sans makina.
  const tradeoffs: MakinaTradeoff[] = []
  for (const o of outcomes) {
    const cfg = o.summary.config
    if (cfg.makina === 'none' || m(o).optimakinas.mean <= 0) continue
    const refO = outcomes.find((r) => r.summary.config.makina === 'none' && r.summary.config.cloning === cfg.cloning && sameLevels(r.summary.config, cfg))
    if (!refO) continue
    const makinas = m(o).optimakinas.mean
    const savings = o.cost && refO.cost && o.cost.nonMakinaComplete && refO.cost.nonMakinaComplete ? refO.cost.nonMakinaCost - o.cost.nonMakinaCost : null
    const breakEvenPrice = savings === null ? null : Math.max(0, savings / makinas)
    const averageMakinaPrice = o.cost?.makinaComplete ? o.cost.makinaCost / makinas : null
    const worthIt = breakEvenPrice !== null && averageMakinaPrice !== null ? averageMakinaPrice < breakEvenPrice : null
    const t: MakinaTradeoff = {
      strategyId: o.id,
      referenceId: refO.id,
      makinas,
      capturesSaved: m(refO).captures.mean - m(o).captures.mean,
      matingsSaved: m(refO).matings.mean - m(o).matings.mean,
      fuelPointsSaved: m(refO).totalFuelPoints.mean - m(o).totalFuelPoints.mean,
      daysSaved: m(refO).days.mean - m(o).days.mean,
      savings,
      breakEvenPrice,
      averageMakinaPrice,
      worthIt,
    }
    tradeoffs.push(t)
    const pct = (saved: number, base: number) => (base > 0 ? `${saved >= 0 ? '−' : '+'}${fmtInt((Math.abs(saved) / base) * 100)} %` : '—')
    let verdict: string
    if (breakEvenPrice === null) verdict = 'Prix des carburants ou des filets incomplets : seuil de rentabilité non calculable.'
    else if (worthIt === null) verdict = `Rentable si une Optimakina coûte en moyenne moins de ${fmtK(breakEvenPrice)} (prix des makinas à renseigner).`
    else
      verdict = `Rentable si une Optimakina coûte en moyenne moins de ${fmtK(breakEvenPrice)} ; avec vos prix (≈ ${fmtK(averageMakinaPrice ?? 0)}), elle ${worthIt ? "l'est" : "ne l'est pas"}.`
    messages.push({
      tone: worthIt === false ? 'warn' : 'info',
      title: `Optimakina : ${label(o.id)} face à ${label(refO.id)}`,
      text: `${fmtInt(makinas)} Optimakinas pour ${pct(t.capturesSaved, m(refO).captures.mean)} de captures, ${pct(t.matingsSaved, m(refO).matings.mean)} d'accouplements, ${pct(t.fuelPointsSaved, m(refO).totalFuelPoints.mean)} de carburant et ${t.daysSaved >= 0 ? `${fmtDec(t.daysSaved)} jour(s) de moins` : `${fmtDec(-t.daysSaved)} jour(s) de plus`}. ${verdict}`,
    })
  }

  // Clonage : stratégie sans clonage face à la même avec clonage.
  for (const o of outcomes) {
    const cfg = o.summary.config
    if (cfg.cloning) continue
    const refO = outcomes.find((r) => r.summary.config.cloning && sameLevels(r.summary.config, cfg) && makinaKey(r.summary.config.makina) === makinaKey(cfg.makina))
    if (!refO) continue
    const ratio = m(refO).captures.mean > 0 ? m(o).captures.mean / m(refO).captures.mean : 0
    messages.push({
      tone: 'warn',
      title: 'Le clonage est indispensable',
      text: `${label(o.id)} demande ×${fmtDec(ratio)} captures par rapport à ${label(refO.id)}${o.summary.successRate < 1 ? ` et n'atteint la cible que dans ${fmtInt(o.summary.successRate * 100)} % des tirages en ${fmtInt(cfg.maxDays)} jours` : ''}.`,
    })
  }

  // Niveau des parents : même politique de makina et de clonage, niveaux différents.
  const n1 = outcomes.find((o) => o.summary.config.parentLevel === 1 && !o.summary.config.levelByGeneration && o.summary.config.makina === 'none' && o.summary.config.cloning)
  const n40 = outcomes.find((o) => o.summary.config.parentLevel === 40 && !o.summary.config.levelByGeneration && o.summary.config.makina === 'none' && o.summary.config.cloning)
  if (n1 && n40 && m(n40).captures.mean > 0 && m(n40).matings.mean > 0)
    messages.push({
      tone: 'info',
      title: 'Monter les parents au niveau 40',
      text: `Captures ÷${fmtDec(m(n1).captures.mean / m(n40).captures.mean)}, accouplements ÷${fmtDec(m(n1).matings.mean / m(n40).matings.mean)} et ${fmtDec(m(n1).days.mean - m(n40).days.mean)} jour(s) de différence : l'XP jusqu'au niveau 40 se gagne pendant la fécondation (Mangeoire en 2e jauge).`,
    })

  for (const o of outcomes)
    if (o.summary.successRate < 1)
      messages.push({
        tone: 'warn',
        title: `${label(o.id)} : cible pas toujours atteinte`,
        text: `Seulement ${fmtInt(o.summary.successRate * 100)} % des tirages obtiennent la cible en ${fmtInt(o.summary.config.maxDays)} jours ; les moyennes de ces tirages sont tronquées à la durée maximale.`,
      })

  return {
    reliable: reliableList.map((o) => o.id),
    fastest: fastest?.id ?? null,
    cheapest: cheapest?.id ?? null,
    costComparable,
    fewestCaptures: fewestCaptures?.id ?? null,
    leastFuel: leastFuel?.id ?? null,
    tradeoffs,
    messages,
  }
}
