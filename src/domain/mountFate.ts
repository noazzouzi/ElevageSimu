// Sort conseillé d'une monture possédée : garder, accoupler d'abord, cloner, monter en niveau, ou
// la meilleure sortie entre vente, extraction et brisage — et utilitaires de gestion de l'inventaire
// (emplacements, places d'enclos, captures groupées, clonage, extraction).
//
// Grille appliquée dans l'ordre (STRATEGY.mountFateGrid, research/strategy.md §1.4) :
//   1. Garder : féconde (ou à féconder) utile au plan — monture visée, recette, ascendance, porteur.
//   2. Accoupler d'abord : deux fécondes « condamnées » de sexes opposés → bébé gratuit + XP, puis on
//      traite les stériles (M-FREEBABY-01) ; pour deux G10, « dernier G10 × G10 puis sortir » (n° 5).
//   3. Cloner : stérile + autre stérile de même famille et même génération ; même couleur d'abord,
//      jamais deux couleurs inutiles (M-CLONE-01). Une stérile utile isolée est gardée en attente.
//   4. Monter en niveau : si un palier de valeur (relevés de brisage, tranche de prix 100/200) est
//      proche et rapporte plus que le carburant de Mangeoire (C-BREAK-01, n° 8).
//   5. Sinon max(vente, extraction, brisage), nets de taxe (economy.ts → mountValuation).
// Sénile (n° 7) : jamais d'élevage, on valorise (extraction = 1 ressource).
//
// Module pur : la valorisation et le coût d'XP sont fournis par l'appelant (prix des stores).
import { PADDOCK_SLOTS, PADDOCK_UNLOCK_LEVELS, SERENITY_MAX, SERENITY_MIN } from './constants'
import { FAMILIES, PRICES_DEFAULT, childrenOf, getSpecies } from '../data'
import { formatDuration, formatKamas, formatNumber, formatPercent } from '../lib/format'
import { ancestorsOf, cheapestRecipe, cleanParent, requiredSpecies } from './breedingPath'
import type { FateKind, MountState, MountValuation } from './economy'
import { breed, type BreedingParent } from './genetics'
import { capturedMount, effectiveFertility, matingBlockers, mountName, toBreedingParent } from './mounts'
import { serenityBand, type SerenityBand } from './paddock'
import type { Ruleset } from './rules'
import type { FamilyId, Fertility, Gender, Mount, MountLocation, Species } from './types'
import { mountXpBetween } from './xp'

// ---------- Types ----------

export type FateAction = 'garder' | 'accoupler' | 'cloner' | 'monter' | 'vente' | 'extraction' | 'brisage' | 'a-chiffrer'

export const FATE_ACTIONS: FateAction[] = ['garder', 'accoupler', 'cloner', 'monter', 'vente', 'extraction', 'brisage', 'a-chiffrer']

export const FATE_ACTION_LABELS: Record<FateAction, string> = {
  garder: 'Garder',
  accoupler: "Accoupler d'abord",
  cloner: 'Cloner',
  monter: 'Monter en niveau',
  vente: 'Vendre',
  extraction: 'Extraire',
  brisage: 'Briser',
  'a-chiffrer': 'Prix manquants',
}

export type FateConfidence = 'high' | 'medium' | 'low'

/** Sous-ensemble de `MountValuation` (economy.ts) utilisé ici ; `mountValuation` le satisfait. */
export type FateValuation = Pick<MountValuation, 'best' | 'bestKind' | 'complete' | 'confidence' | 'sale' | 'extraction' | 'brisage'>

/** Valorisation d'une espèce à un niveau et un état donnés (en pratique : `mountValuation`). */
export type ValuationFn = (speciesId: number, level: number, opts: { state: MountState; senile: boolean }) => FateValuation

/**
 * Coût (kamas par monture) pour monter une monture de `fromLevel` à `toLevel` (en pratique :
 * `levelingCost(...).costPerMount`). `batchSize` = montures montées ensemble dans l'enclos (1 … 10) :
 * la Mangeoire nourrit tout le lot, le coût par monture est le coût du lot ÷ `batchSize`. Les montures
 * de surplus se montent au palier le moins cher (C-BREAK-01 : Extraits) ; `tier` le précise.
 */
export type LevelCostFn = (
  fromLevel: number,
  toLevel: number,
  mount: Mount,
  batchSize: number,
) => {
  cost: number | null
  complete: boolean
  seconds?: number
  tier?: number
  /** Taille de lot réellement retenue pour ce coût (défaut : `batchSize` si la fonction le prend en compte, sinon 10). */
  batchSize?: number
}

export interface FateContext {
  /** Toutes les montures possédées (la monture évaluée comprise). */
  inventory: Mount[]
  /** Monture visée (réglages), ou null. */
  goalSpeciesId: number | null
  rules: Ruleset
  valuation: ValuationFn
  /** Facultatif : sans lui, la règle « monter en niveau » est ignorée. */
  levelCost?: LevelCostFn
  /** Valeur d'un généton en kamas (bébé gratuit). Sans elle, les génétons ne sont pas valorisés. */
  genetonValue?: number
  /** XP maximale pour qu'un palier de niveau soit « proche » (défaut `DEFAULT_MAX_LEVELING_XP`). */
  maxLevelingXp?: number
  /** Gain minimal, relatif à la valeur actuelle, pour conseiller de monter (défaut 0,10). */
  minLevelingGain?: number
  /**
   * Plan d'accouplement retenu (monture → partenaire), p. ex. `bestDisjointPairs(rankPairs(...))` :
   * une monture prévue au plan n'est jamais conseillée en sortie immédiate ; sa fiche dit
   * « accoupler (plan) » et sa sortie « après l'accouplement », valorisée à l'état stérile.
   */
  plannedPartners?: Map<string, string>
  /** Objectif général (`settings.goal`) : en « profit », sans monture visée, une G1–G2 n'est clonée que si le clone vaut plus. */
  goal?: 'profit' | 'succes' | 'mixte'
}

export type UsefulnessKind = 'objectif' | 'recette' | 'ascendance' | 'porteur' | 'progression' | 'aucune'

export interface Usefulness {
  kind: UsefulnessKind
  useful: boolean
  /** Explication en français. */
  detail: string
  /** Croisements où elle (ou l'espèce qu'elle porte) sert : partenaire → enfant, les plus utiles d'abord. */
  crossings: { partner: number; child: number }[]
  /** Porteur : espèce de haute génération présente parmi ses parents. */
  carried?: number
}

export interface MountFate {
  mountId: string
  action: FateAction
  /** Libellé court (ex. « Monter niv. 53 puis briser »). */
  label: string
  /** Pourquoi (français, phrases complètes). */
  reason: string
  /**
   * Kamas attendus en suivant le conseil (net de taxe) : sortie → montant net ; monter → valeur au
   * palier moins le carburant ; accoupler → valeur de la stérile + ½ bébé gratuit (+ génétons) ;
   * garder / cloner → null (voir `floor`).
   */
  value: number | null
  /** Ce que représente `value`. */
  valueNote: string
  /** Meilleure sortie immédiate (vente/extraction/brisage), nette de taxe : valeur plancher. */
  floor: number | null
  /**
   * Toutes les sorties possibles de `floor` sont chiffrées. Faux : `floor` n'est qu'un minimum (ex. G1
   * niveau 1 : brisage nul, vente sans prix) — à afficher « ≥ » ou « prix à saisir », jamais « ≈ ».
   */
  floorComplete: boolean
  confidence: FateConfidence
  /** Faux si un prix manque (la valeur est alors un minimum, ou inconnue). */
  complete: boolean
  /** Ligne de STRATEGY.mountFateGrid appliquée (1 à 8 ; 0 = cas particulier). */
  rule: number
  /** Partenaire d'accouplement ou de clonage conseillé. */
  partnerId?: string
  /** Niveau visé (action « monter »). */
  targetLevel?: number
  /** Sortie prévue (après l'accouplement ou la montée de niveau, ou immédiate). */
  exit?: FateKind
  usefulness: Usefulness
  /** Conseil complémentaire (ex. prix à saisir pour décider). */
  hint?: string
}

/** Palier d'XP considéré « proche » : ≈ niveau 1 → 53 (39 360 XP, une nuit de Mangeoire au palier 1). */
export const DEFAULT_MAX_LEVELING_XP = 40_000
export const DEFAULT_MIN_LEVELING_GAIN = 0.1

// ---------- Objectif (monture visée) ----------

export interface GoalPlan {
  goalId: number
  goalName: string
  family: FamilyId
  generation: number
  /** Espèces de la recette la moins chère en captures (objectif compris). */
  recipe: Set<number>
  /** Toutes les espèces d'un chemin de croisement vers l'objectif (objectif exclu) — `ancestorsOf`. */
  ancestors: Set<number>
}

const planCache = new Map<number, GoalPlan | null>()

/** Plan de l'objectif (recette + ascendance), mémorisé ; null sans objectif élevable. */
export function goalPlan(goalSpeciesId: number | null | undefined): GoalPlan | null {
  if (goalSpeciesId === null || goalSpeciesId === undefined) return null
  const cached = planCache.get(goalSpeciesId)
  if (cached !== undefined) return cached
  const s = getSpecies(goalSpeciesId)
  let plan: GoalPlan | null = null
  if (s && s.breedable) {
    const tree = cheapestRecipe(s.id)
    plan = {
      goalId: s.id,
      goalName: s.name,
      family: s.family,
      generation: s.generation,
      recipe: new Set(tree ? requiredSpecies(tree).map((r) => r.speciesId) : [s.id]),
      ancestors: new Set(ancestorsOf(s.id)),
    }
  }
  planCache.set(goalSpeciesId, plan)
  return plan
}

function inPlan(id: number, plan: GoalPlan): boolean {
  return id === plan.goalId || plan.recipe.has(id) || plan.ancestors.has(id)
}

const spName = (id: number) => getSpecies(id)?.name ?? `#${id}`
const spGen = (id: number) => getSpecies(id)?.generation ?? 0

/**
 * À quoi sert cette monture ? Avec un objectif de la même famille : monture visée, recette la plus
 * courte, autre chemin (ascendance), ou porteur (un parent de génération supérieure utile au plan,
 * M-CARRIER-01). Sans objectif (ou autre famille) : utile tant qu'elle peut donner une génération
 * supérieure (G1 à G9).
 */
export function mountUsefulness(m: Mount, plan: GoalPlan | null): Usefulness {
  const sp = getSpecies(m.speciesId)
  if (!sp) return { kind: 'aucune', useful: false, detail: 'Espèce inconnue.', crossings: [] }
  if (!sp.breedable)
    return { kind: 'aucune', useful: false, detail: 'Monture spéciale (génération 0) : ni accouplement, ni clonage, ni extraction.', crossings: [] }
  if (plan && sp.family === plan.family) {
    if (sp.id === plan.goalId) return { kind: 'objectif', useful: true, detail: `C'est votre monture visée (${plan.goalName}).`, crossings: [] }
    const useful = (c: { partner: number; child: number }) => inPlan(c.child, plan)
    const score = (c: { partner: number; child: number }) =>
      (c.child === plan.goalId ? 4 : 0) + (plan.recipe.has(c.child) ? 2 : 0) + (plan.recipe.has(c.partner) ? 1 : 0)
    const order = (a: { partner: number; child: number }, b: { partner: number; child: number }) =>
      score(b) - score(a) || spGen(a.child) - spGen(b.child) || a.child - b.child
    // Porteuse d'abord (M-CARRIER-01) : son arbre détourne la génération cible de ses croisements
    // « standard » ; ses vrais croisements utiles sont ceux de l'espèce portée.
    const carried = m.parents
      .slice(0, 2)
      .filter((p) => {
        const ps = getSpecies(p)
        return !!ps && ps.family === sp.family && ps.generation > sp.generation && inPlan(p, plan) && p !== plan.goalId
      })
      .sort((x, y) => spGen(y) - spGen(x))[0]
    if (carried !== undefined) {
      const viaCarrier = childrenOf(carried).filter(useful).sort(order)
      if (viaCarrier.length)
        return {
          kind: 'porteur',
          useful: true,
          detail: `Porteuse : un de ses parents est ${spName(carried)} (G${spGen(carried)}). Croisée avec la bonne partenaire, elle vise la même génération qu'un croisement de ${spName(carried)} (M-CARRIER-01).`,
          crossings: viaCarrier,
          carried,
        }
    }
    const crossings = childrenOf(sp.id).filter(useful).sort(order)
    if (plan.recipe.has(sp.id))
      return { kind: 'recette', useful: true, detail: `Fait partie de la recette la plus courte vers ${plan.goalName}.`, crossings }
    if (plan.ancestors.has(sp.id))
      return { kind: 'ascendance', useful: true, detail: `Sert à un autre chemin de croisement vers ${plan.goalName}.`, crossings }
    return { kind: 'aucune', useful: false, detail: `Ne sert à aucun chemin de croisement vers ${plan.goalName}.`, crossings: [] }
  }
  const next = childrenOf(sp.id).filter((c) => spGen(c.child) > sp.generation)
  if (sp.generation >= 10)
    return { kind: 'aucune', useful: false, detail: 'G10 : génération maximale, elle ne rapporte plus de génétons.', crossings: [] }
  if (next.length === 0)
    return {
      kind: 'aucune',
      useful: false,
      detail: 'Impasse : aucune espèce de génération supérieure ne s’obtient à partir de cette couleur ; elle ne peut plus progresser.',
      crossings: [],
    }
  return {
    kind: 'progression',
    useful: true,
    detail: plan
      ? `Hors de la famille de votre objectif (${FAMILIES[plan.family].plural}) : gardée comme parent possible.`
      : 'Aucune monture visée : gardée comme parent possible (définissez un objectif dans les Réglages pour un tri plus fin).',
    crossings: next.sort((a, b) => spGen(a.child) - spGen(b.child) || a.child - b.child),
  }
}

// ---------- État de valorisation ----------

/** État de prix d'une monture (economy.ts) : sénile = stérile + extraction d'une seule ressource. */
export function fateState(m: Mount): { state: MountState; senile: boolean } {
  const f = effectiveFertility(m)
  if (f === 'senile') return { state: 'sterile', senile: true }
  return { state: f, senile: false }
}

function mapConfidence(c: string | undefined | null): FateConfidence {
  const l = (c ?? '').toLowerCase()
  if (l === 'joueur' || l.startsWith('high')) return 'high'
  if (l.startsWith('medium')) return 'medium'
  return 'low'
}

function minConfidence(...cs: FateConfidence[]): FateConfidence {
  if (cs.includes('low')) return 'low'
  if (cs.includes('medium')) return 'medium'
  return 'high'
}

const KIND_LABEL: Record<FateKind, string> = { vente: 'Vente', extraction: 'Extraction', brisage: 'Brisage' }
const THEN_LABEL: Record<FateKind, string> = { vente: 'vendre', extraction: 'extraire', brisage: 'briser' }

function optionsSummary(v: FateValuation): string {
  const parts = [v.sale, v.extraction, v.brisage].map((f) => {
    if (!f.possible) return `${KIND_LABEL[f.kind]} : impossible`
    if (f.net === null) return `${KIND_LABEL[f.kind]} : prix manquant`
    return `${KIND_LABEL[f.kind]} ≈ ${formatKamas(f.net)}`
  })
  return `${parts.join(' · ')} (nets de taxe).`
}

// ---------- Recommandation ----------

interface Entry {
  m: Mount
  sp: Species | undefined
  eff: Fertility
  use: Usefulness
}

/** Sort conseillé pour une seule monture (cohérent avec `recommendFates` sur le même inventaire). */
export function recommendFate(mount: Mount, ctx: FateContext): MountFate {
  const inventory = ctx.inventory.some((m) => m.id === mount.id) ? ctx.inventory.map((m) => (m.id === mount.id ? mount : m)) : [...ctx.inventory, mount]
  return recommendFates({ ...ctx, inventory }).get(mount.id) as MountFate
}

/** En objectif « profit » sans monture visée : génération à partir de laquelle on clone sans comparer (une capture ne la remplace pas). */
export const PROFIT_CLONE_MIN_GENERATION = 3

/**
 * Sort conseillé de chaque monture de l'inventaire (clé = id). Les partenaires d'accouplement et de
 * clonage sont appariés sans doublon : deux montures conseillées ensemble se désignent l'une l'autre.
 */
export function recommendFates(ctx: FateContext): Map<string, MountFate> {
  const plan = goalPlan(ctx.goalSpeciesId)
  const cache = new Map<string, FateValuation>()
  const val = (speciesId: number, level: number, state: MountState, senile: boolean): FateValuation => {
    const key = `${speciesId}|${level}|${state}|${senile ? 1 : 0}`
    let v = cache.get(key)
    if (!v) {
      v = ctx.valuation(speciesId, level, { state, senile })
      cache.set(key, v)
    }
    return v
  }
  const entries: Entry[] = ctx.inventory.map((m) => ({ m, sp: getSpecies(m.speciesId), eff: effectiveFertility(m), use: mountUsefulness(m, plan) }))
  const byId = new Map(entries.map((e) => [e.m.id, e]))
  const out = new Map<string, MountFate>()
  const floorOf = (e: Entry): FloorValue => {
    const st = fateState(e.m)
    const v = val(e.m.speciesId, e.m.level, st.state, st.senile)
    return { value: v.best, complete: v.complete && v.best !== null }
  }
  // Plan d'accouplement retenu par l'appelant : couples valides (deux montures élevables, non stériles).
  const canBreed = (e: Entry | undefined): e is Entry => !!e && !!e.sp?.breedable && (e.eff === 'feconde' || e.eff === 'fertile')
  const planned = new Map<string, Entry>()
  for (const [id, pid] of ctx.plannedPartners ?? []) {
    const e = byId.get(id)
    const p = byId.get(pid)
    if (id !== pid && canBreed(e) && canBreed(p)) planned.set(id, p)
  }
  const plannedNote = (e: Entry) => {
    const p = planned.get(e.m.id)
    return p ? ` Prévue au plan d'accouplement avec ${mountWithSex(p.m)}.` : ''
  }

  const remaining: Entry[] = []
  for (const e of entries) {
    if (!e.sp) {
      out.set(e.m.id, {
        mountId: e.m.id,
        action: 'garder',
        label: 'Garder',
        reason: "Espèce inconnue des données : impossible de conseiller un sort. Vérifiez la couleur de la monture.",
        value: null,
        valueNote: '',
        floor: null,
        floorComplete: false,
        confidence: 'low',
        complete: false,
        rule: 0,
        usefulness: e.use,
      })
      continue
    }
    if (e.eff === 'senile') {
      out.set(
        e.m.id,
        realizeFate(e, 7, 'Monture sénile (d’avant la 3.5) : ni accouplement ni clonage ; à équiper, monter pour la revente, ou extraire (1 ressource).', val),
      )
      continue
    }
    if (!e.sp.breedable) {
      out.set(e.m.id, realizeFate(e, 0, `${e.use.detail} À équiper ou à vendre.`, val))
      continue
    }
    if (e.use.kind === 'objectif') {
      const f = keepFate(e, 1, 'Garder (objectif)', `${e.use.detail} Gardez-en au moins un exemplaire ; les doubles peuvent être vendus une fois le succès validé.${plannedNote(e)}`, 'medium', floorOf(e))
      if (planned.has(e.m.id)) f.partnerId = planned.get(e.m.id)?.m.id
      out.set(e.m.id, f)
      continue
    }
    if (e.use.useful && (e.eff === 'feconde' || e.eff === 'fertile')) {
      const fecund = e.eff === 'feconde'
      const partnerText = planned.has(e.m.id) ? plannedNote(e).trim() : partnerSentence(e, entries, ctx.rules)
      const label = fecund ? 'Garder' : 'Garder — à féconder'
      const head = fecund ? 'Féconde et utile au plan.' : 'Fertile et utile au plan : à rendre féconde.'
      const conf: FateConfidence = e.use.kind === 'recette' || e.use.kind === 'porteur' ? 'medium' : e.use.kind === 'progression' ? 'low' : 'medium'
      const f = keepFate(e, 1, label, `${head} ${e.use.detail}${partnerText ? ` ${partnerText}` : ''}`, conf, floorOf(e))
      if (planned.has(e.m.id)) f.partnerId = planned.get(e.m.id)?.m.id
      out.set(e.m.id, f)
      continue
    }
    const partner = planned.get(e.m.id)
    if (partner) {
      // Prévue au plan : jamais de sortie immédiate ; la sortie vient après l'accouplement (stérile).
      out.set(e.m.id, plannedFate(e, partner, val))
      continue
    }
    remaining.push(e)
  }

  // 2. Bébé gratuit : fécondes condamnées de sexes opposés, même famille (M-FREEBABY-01, M-G10OUT-01).
  const condemnedFecund = remaining
    .filter((e) => e.eff === 'feconde')
    .sort((a, b) => (b.sp?.generation ?? 0) - (a.sp?.generation ?? 0) || b.m.level - a.m.level || a.m.id.localeCompare(b.m.id))
  const paired = new Set<string>()
  const sellRather = new Map<string, Entry>()
  for (const a of condemnedFecund) {
    if (paired.has(a.m.id)) continue
    const candidates = condemnedFecund
      .filter((b) => b !== a && !paired.has(b.m.id) && matingBlockers(a.m, b.m).length === 0)
      .sort(
        (x, y) =>
          Number(y.sp?.generation === a.sp?.generation) - Number(x.sp?.generation === a.sp?.generation) ||
          (y.sp?.generation ?? 0) - (x.sp?.generation ?? 0) ||
          y.m.level - x.m.level ||
          x.m.id.localeCompare(y.m.id),
      )
    const b = candidates[0]
    if (!b) continue
    const pair = matePair(a, b, ctx, val)
    if (!pair) {
      sellRather.set(a.m.id, b)
      if (!sellRather.has(b.m.id)) sellRather.set(b.m.id, a)
      continue
    }
    paired.add(a.m.id)
    paired.add(b.m.id)
    out.set(a.m.id, pair[0])
    out.set(b.m.id, pair[1])
  }

  // 3. Clonage des stériles (même famille, même génération ; M-CLONE-01).
  const profitNoGoal = ctx.goal === 'profit'
  const cloneRejected = new Map<string, string>()
  const cloneCheck = (a: Entry, b: Entry): { ok: boolean; text: string } | null => {
    // Objectif « profit » sans monture visée (ou autre famille) : une G1–G2 se recapture, on ne la clone
    // que si le clone (fertile) vaut plus que les deux stériles (research §2.9).
    if (!profitNoGoal || a.use.kind !== 'progression' || b.use.kind !== 'progression') return null
    if ((a.sp?.generation ?? 0) >= PROFIT_CLONE_MIN_GENERATION) return null
    const ca = val(a.m.speciesId, 1, 'fertile', false)
    const cb = val(b.m.speciesId, 1, 'fertile', false)
    const sa = val(a.m.speciesId, a.m.level, 'sterile', false)
    const sb = val(b.m.speciesId, b.m.level, 'sterile', false)
    const known = [ca, cb, sa, sb].every((v) => v.complete && v.best !== null)
    if (!known)
      return {
        ok: false,
        text: `Cloner avec ${mountName(b.m)} ne se justifie en objectif « profit » que si le clone fertile vaut plus que les deux stériles : prix incomplets, comparaison impossible (saisissez les prix de ces montures).`,
      }
    const clone = ((ca.best as number) + (cb.best as number)) / 2
    const pair = (sa.best as number) + (sb.best as number)
    const text = `Clone fertile ≈ ${formatKamas(clone)} contre ≈ ${formatKamas(pair)} pour les deux stériles (nets de taxe).`
    return { ok: clone > pair + 1e-9, text }
  }
  const steriles = remaining.filter((e) => e.eff === 'sterile' && !out.has(e.m.id))
  const groups = new Map<string, Entry[]>()
  for (const e of steriles) {
    const k = `${e.sp?.family}|${e.sp?.generation}`
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  for (const list of groups.values()) {
    for (const cp of clonePairs(list)) {
      const check = cloneCheck(cp.a, cp.b)
      if (check && !check.ok) {
        cloneRejected.set(cp.a.m.id, check.text)
        cloneRejected.set(cp.b.m.id, check.text.replace(mountName(cp.b.m), mountName(cp.a.m)))
        continue
      }
      out.set(cp.a.m.id, cloneFate(cp.a, cp.b, cp, floorOf(cp.a), check?.text))
      out.set(cp.b.m.id, cloneFate(cp.b, cp.a, cp, floorOf(cp.b), check?.text))
    }
  }

  // 4–5. Le reste : stérile utile isolée gardée, sinon monter en niveau, sinon la meilleure sortie.
  const exits: ExitCandidate[] = []
  for (const e of remaining) {
    if (out.has(e.m.id)) continue
    const sp = e.sp as Species
    if (e.eff === 'sterile' && e.use.useful && e.use.kind !== 'progression') {
      out.set(
        e.m.id,
        keepFate(
          e,
          3,
          'Garder — en attente de clonage',
          `Stérile utile au plan (${e.use.detail.replace(/\.$/, '')}) mais sans partenaire de clonage : gardez-la jusqu'à obtenir une autre stérile ${FAMILIES[sp.family].label} G${sp.generation} (même couleur de préférence) pour la cloner.`,
          'medium',
          floorOf(e),
        ),
      )
      continue
    }
    const st = fateState(e.m)
    const g10 = sp.generation >= 10
    const rule = g10 ? 5 : e.eff === 'sterile' ? 4 : 6
    let intro: string
    if (e.eff === 'sterile') intro = g10 ? 'G10 stérile sans usage : à sortir de la chaîne.' : `Stérile sans usage${e.use.kind === 'aucune' ? ` (${e.use.detail.replace(/\.$/, '').toLowerCase()})` : ''} et sans partenaire de clonage utile.`
    else if (e.eff === 'feconde') {
      const other = sellRather.get(e.m.id)
      intro = other
        ? `${g10 ? 'G10 féconde' : 'Féconde'} sans usage pour le plan : selon vos prix, la vendre féconde rapporte plus que l'accoupler avec ${mountName(other.m)} puis sortir les stériles (bébé et génétons compris).`
        : `${g10 ? 'G10 féconde' : 'Féconde'} sans usage pour le plan et sans autre féconde condamnée de sexe opposé : banque si elle peut resservir, sinon sortie.`
    } else intro = `Fertile sans usage pour le plan${e.use.kind === 'aucune' ? ` (${e.use.detail.replace(/\.$/, '').toLowerCase()})` : ''} : la rendre féconde coûterait du carburant pour rien.`
    if (e.use.kind === 'progression' && e.eff === 'sterile' && !cloneRejected.has(e.m.id)) intro += ' Si vous comptez la cloner plus tard, gardez-la en attendant une stérile de même génération.'
    const rejected = cloneRejected.get(e.m.id)
    if (rejected) intro = `${intro.replace(' et sans partenaire de clonage utile.', '.')} ${rejected}`
    exits.push({ e, st, rule, intro, current: val(e.m.speciesId, e.m.level, st.state, st.senile) })
  }
  const leveling = planLeveling(exits, ctx, val)
  for (const x of exits) {
    const lv = leveling.get(x.e.m.id)
    if (lv && 'fate' in lv) {
      out.set(x.e.m.id, lv.fate)
      continue
    }
    const fate = realizeFate(x.e, x.rule, x.intro, val)
    if (lv && 'hint' in lv) fate.hint = lv.hint
    out.set(x.e.m.id, fate)
  }
  return out
}

interface ExitCandidate {
  e: Entry
  st: { state: MountState; senile: boolean }
  rule: number
  intro: string
  current: FateValuation
}

/** Fiche d'une monture sans usage prévue au plan d'accouplement : accoupler, puis sortie de la stérile. */
function plannedFate(e: Entry, partner: Entry, val: (id: number, l: number, s: MountState, sen: boolean) => FateValuation): MountFate {
  const st = fateState(e.m)
  const now = val(e.m.speciesId, e.m.level, st.state, st.senile)
  const after = val(e.m.speciesId, e.m.level, 'sterile', false)
  const thenKind = after.bestKind ?? undefined
  const then = thenKind
    ? `${THEN_LABEL[thenKind]} la stérile (${after.complete ? '≈' : '≥'} ${formatKamas(after.best)} net${after.complete ? '' : ', prix incomplets : minimum'})`
    : 'saisissez les prix pour choisir entre vente, extraction et brisage de la stérile'
  return {
    mountId: e.m.id,
    action: 'accoupler',
    label: thenKind ? `Accoupler (plan) puis ${THEN_LABEL[thenKind]}` : 'Accoupler (plan)',
    reason: `Prévue dans le plan d'accouplement avec ${mountWithSex(partner.m)} : accouplez-les d'abord (bébé + XP d'Éleveur), les deux dans l'étable. Après l'accouplement : ${then}, ou clonez-la si une stérile de même génération se présente. Ne la sortez pas avant.`,
    value: after.best,
    valueNote: "stérile après l'accouplement (hors bébé)",
    floor: now.best,
    floorComplete: now.complete && now.best !== null,
    confidence: mapConfidence(after.confidence),
    complete: after.complete && after.best !== null,
    rule: 2,
    partnerId: partner.m.id,
    exit: thenKind,
    usefulness: e.use,
  }
}

/** Valeur plancher d'une monture et son état (minimum si une sortie possible n'a pas de prix). */
interface FloorValue {
  value: number | null
  complete: boolean
}

function keepFate(e: Entry, rule: number, label: string, reason: string, confidence: FateConfidence, floor: FloorValue): MountFate {
  return {
    mountId: e.m.id,
    action: 'garder',
    label,
    reason,
    value: null,
    valueNote: floor.value === null ? 'à garder' : 'à garder (valeur de sortie actuelle : plancher)',
    floor: floor.value,
    floorComplete: floor.complete,
    confidence,
    complete: true,
    rule,
    usefulness: e.use,
  }
}

const oppositeGender = (g: Gender): Gender => (g === 'male' ? 'femelle' : 'male')

/** « Muldo Pourpre (♂) », ou « Pépite (♂, Muldo Pourpre) » quand la monture porte un nom propre. */
function mountWithSex(m: Mount): string {
  const sex = m.gender === 'male' ? '♂' : '♀'
  const name = mountName(m)
  const sp = spName(m.speciesId)
  return name === sp ? `${name} (${sex})` : `${name} (${sex}, ${sp})`
}

/**
 * Partenaire disponible pour le croisement le plus utile (phrase), ou ce qui manque. Chaque croisement
 * proposé est vérifié avec le modèle de naissance sur l'arbre réel de la monture : si son arbre
 * détourne la génération cible (arbre ≥ cible, porteuse), on retient le croisement dont la cible est
 * bien l'enfant visé, sinon on le dit.
 */
function partnerSentence(e: Entry, entries: Entry[], rules: Ruleset): string {
  if (!e.use.crossings.length) return ''
  const want = oppositeGender(e.m.gender)
  const sexe = want === 'male' ? 'mâle' : 'femelle'
  const self = toBreedingParent(e.m)
  const partnerFor = (speciesId: number) =>
    entries
      .filter((x) => x.m.id !== e.m.id && x.m.speciesId === speciesId && x.m.gender === want && (x.eff === 'feconde' || x.eff === 'fertile'))
      .sort((x, y) => Number(y.eff === 'feconde') - Number(x.eff === 'feconde') || y.m.level - x.m.level || x.m.id.localeCompare(y.m.id))[0]
  const check = (c: { partner: number; child: number }) => {
    const partner = partnerFor(c.partner)
    let pb: BreedingParent
    try {
      pb = partner ? toBreedingParent(partner.m) : cleanParent(c.partner, e.m.level)
    } catch {
      return null
    }
    try {
      const r = breed(self, pb, { rules })
      return { c, partner, r, ok: r.targetSpecies.includes(c.child) }
    } catch {
      return null
    }
  }
  const checks = e.use.crossings.slice(0, 12).map(check)
  const chosen = checks.find((x) => x?.ok) ?? null
  const cross = e.use.kind === 'porteur' && e.use.carried !== undefined ? `porteuse de ${spName(e.use.carried)}` : spName(e.m.speciesId)
  if (!chosen) {
    const first = checks.find((x) => x !== null)
    if (!first) return ''
    const c = first.c
    const pChild = first.r.outcomes.find((o) => o.speciesId === c.child)?.probability ?? 0
    return `Arbre ≥ cible : son arbre contient une G${first.r.maxTreeGeneration}, qui détourne ses croisements. Avec ${spName(c.partner)}, la génération cible devient G${first.r.targetGeneration} (${first.r.targetSpecies.map(spName).join(', ')}) et ${spName(c.child)} ne sort qu'à ${formatPercent(pChild)}${first.r.recordPossible ? '' : ', sans généton'}. Préférez une monture de cette couleur à l'arbre propre pour ce croisement.`
  }
  const { c, partner, r } = chosen
  const pChild = r.outcomes.find((o) => o.speciesId === c.child)?.probability ?? 0
  const head = `Croisement visé : ${cross} × ${spName(c.partner)} → ${spName(c.child)} (G${spGen(c.child)}, ${formatPercent(pChild)} par bébé${partner ? '' : ' avec une partenaire à l’arbre propre'}).`
  if (!partner) return `${head} Aucune ${spName(c.partner)} ${sexe} fertile dans vos montures : à capturer ou à produire.`
  return `${head} Partenaire : ${mountName(partner.m)} (${partner.eff === 'feconde' ? 'féconde' : 'fertile'}, niv. ${partner.m.level}).`
}

/** Fiches « accoupler d'abord » pour deux fécondes condamnées, ou null si vendre fécondes rapporte plus. */
function matePair(a: Entry, b: Entry, ctx: FateContext, val: (id: number, l: number, s: MountState, sen: boolean) => FateValuation): [MountFate, MountFate] | null {
  let result
  try {
    result = breed(toBreedingParent(a.m), toBreedingParent(b.m), { rules: ctx.rules })
  } catch {
    return null
  }
  let babyValue = 0
  let babyComplete = true
  for (const o of result.outcomes) {
    const v = val(o.speciesId, 1, 'fertile', false)
    if (v.best === null) babyComplete = false
    else babyValue += o.probability * v.best
    if (!v.complete) babyComplete = false
  }
  babyValue *= result.babies
  const genetonKamas = ctx.genetonValue !== undefined ? result.expectedGenetons * ctx.genetonValue : 0
  const bonus = babyValue + genetonKamas
  const afterA = val(a.m.speciesId, a.m.level, 'sterile', false)
  const afterB = val(b.m.speciesId, b.m.level, 'sterile', false)
  const nowA = val(a.m.speciesId, a.m.level, 'feconde', false)
  const nowB = val(b.m.speciesId, b.m.level, 'feconde', false)
  const allComplete = babyComplete && afterA.complete && afterB.complete && nowA.complete && nowB.complete
  // Vendre les fécondes plutôt que les accoupler (M-FREEBABY-01) : seulement sur des prix de décision
  // fiables (les vôtres, ou un relevé de confiance moyenne ou haute), jamais sur un relevé peu fiable.
  const trusted = (v: FateValuation) => v.complete && v.best !== null && mapConfidence(v.confidence) !== 'low'
  if (
    allComplete &&
    trusted(nowA) &&
    trusted(nowB) &&
    nowA.best !== null &&
    nowB.best !== null &&
    afterA.best !== null &&
    afterB.best !== null &&
    nowA.best + nowB.best > afterA.best + afterB.best + bonus
  )
    return null
  const top = result.outcomes[0]
  const g10 = (a.sp?.generation ?? 0) >= 10 && (b.sp?.generation ?? 0) >= 10
  const rule = g10 ? 5 : 2
  const make = (self: Entry, other: Entry, after: FateValuation): MountFate => {
    const value = after.best === null ? null : after.best + bonus / 2
    const thenKind = after.bestKind ?? undefined
    const fecundNow = val(self.m.speciesId, self.m.level, 'feconde', false)
    const babyText = babyComplete ? `≈ ${formatKamas(babyValue)}` : `≥ ${formatKamas(babyValue)} (prix incomplets)`
    const parts = [
      g10
        ? `Dernier accouplement G10 × G10 avant de sortir ces montures (M-G10OUT-01).`
        : `Féconde sans usage pour le plan, comme ${mountName(other.m)} : accouplez-les entre elles avant de les sortir (bébé gratuit + XP d'Éleveur).`,
      `Partenaire : ${mountName(other.m)} (${other.m.gender === 'male' ? '♂' : '♀'}, niv. ${other.m.level}). Placez les deux montures dans l'étable.`,
      top ? `Bébé le plus probable : ${spName(top.speciesId)} (${formatPercent(top.probability)}) ; valeur attendue du bébé ${babyText}.` : '',
      result.expectedGenetons > 0 ? `Génétons attendus : ${formatNumber(result.expectedGenetons, 1)}${ctx.genetonValue !== undefined ? ` (≈ ${formatKamas(genetonKamas)})` : ''}.` : '',
      `+${formatNumber(result.jobXp)} XP d'Éleveur.`,
      thenKind ? `Ensuite : ${THEN_LABEL[thenKind]} la stérile (≈ ${formatKamas(after.best)} net).` : 'Ensuite : saisissez les prix pour choisir entre vente, extraction et brisage.',
    ]
    return {
      mountId: self.m.id,
      action: 'accoupler',
      label: g10 ? 'Dernier G10 × G10 puis sortir' : "Accoupler d'abord",
      reason: parts.filter(Boolean).join(' '),
      value,
      valueNote: 'stérile ensuite + ½ bébé gratuit (et génétons)',
      floor: fecundNow.best,
      floorComplete: fecundNow.complete && fecundNow.best !== null,
      confidence: minConfidence('high', babyComplete ? mapConfidence(after.confidence) : 'low'),
      complete: babyComplete && after.complete,
      rule,
      partnerId: other.m.id,
      exit: thenKind,
      usefulness: self.use,
    }
  }
  return [make(a, b, afterA), make(b, a, afterB)]
}

type CloneKind = 'meme-couleur' | 'deux-utiles' | 'utile-inutile'

interface ClonePlanItem {
  a: Entry
  b: Entry
  kind: CloneKind
  sameGender: boolean
  sameTree: boolean
}

function clonePlanItem(a: Entry, b: Entry, kind: CloneKind): ClonePlanItem {
  return { a, b, kind, sameGender: a.m.gender === b.m.gender, sameTree: cloneTreeKind(a.m) === cloneTreeKind(b.m) }
}

/**
 * Paires de clonage d'un groupe (même famille + génération) : même couleur (même sexe et même arbre
 * d'abord, `pairForCloning`), puis deux couleurs utiles, puis utile + inutile ; jamais deux inutiles.
 */
function clonePairs(list: Entry[]): ClonePlanItem[] {
  const useful = list.filter((e) => e.use.useful)
  const useless = list.filter((e) => !e.use.useful)
  const pairs: ClonePlanItem[] = []
  const bySpecies = new Map<number, Entry[]>()
  for (const e of useful) bySpecies.set(e.m.speciesId, [...(bySpecies.get(e.m.speciesId) ?? []), e])
  const leftovers: Entry[] = []
  for (const same of [...bySpecies.values()].sort((x, y) => x[0].m.speciesId - y[0].m.speciesId)) {
    const r = pairForCloning(same, (e) => e.m)
    for (const [a, b] of r.pairs) pairs.push(clonePlanItem(a, b, 'meme-couleur'))
    leftovers.push(...r.leftovers)
  }
  // Plan d'abord : les couleurs de la recette sont appariées en priorité.
  const rank = (e: Entry) => (e.use.kind === 'recette' ? 0 : e.use.kind === 'porteur' ? 1 : e.use.kind === 'ascendance' ? 2 : 3)
  leftovers.sort((x, y) => rank(x) - rank(y) || x.m.speciesId - y.m.speciesId)
  let i = 0
  for (; i + 1 < leftovers.length; i += 2) pairs.push(clonePlanItem(leftovers[i], leftovers[i + 1], 'deux-utiles'))
  if (i < leftovers.length && useless.length > 0) {
    const sacrifice = [...useless].sort((x, y) => x.m.level - y.m.level || x.m.id.localeCompare(y.m.id))[0]
    pairs.push(clonePlanItem(leftovers[i], sacrifice, 'utile-inutile'))
  }
  return pairs
}

function cloneFate(self: Entry, other: Entry, cp: ClonePlanItem, floor: FloorValue, comparison?: string): MountFate {
  const otherName = `${mountName(other.m)}${other.m.speciesId !== self.m.speciesId && mountName(other.m) !== spName(other.m.speciesId) ? ` (${spName(other.m.speciesId)})` : ''}`
  const kind = cp.kind
  let reason: string
  let confidence: FateConfidence = 'high'
  const treeKinds = [cloneTreeKind(self.m), cloneTreeKind(other.m)]
  const treeLoss = !cp.sameTree && treeKinds.some((k) => k !== 'ordinaire')
  const lottery = `sexe et généalogie : ceux de la monture gardée (50/50)${treeLoss ? `, l'arbre ${treeKinds.includes('porteur') ? 'porteur' : 'propre'} n'est gardé qu'une fois sur deux` : ''}`
  if (kind === 'meme-couleur') {
    if (cp.sameGender && cp.sameTree)
      reason = `Stérile : clonez-la avec ${otherName}, même couleur, même sexe et même arbre — résultat certain : une ${spName(self.m.speciesId)} ${self.m.gender === 'male' ? 'mâle' : 'femelle'} fertile.`
    else {
      reason = `Stérile : clonez-la avec ${otherName}, de la même couleur — couleur certaine (une ${spName(self.m.speciesId)} fertile) ; ${lottery}.`
      if (treeLoss) confidence = 'medium'
    }
  } else if (kind === 'deux-utiles')
    reason = `Stérile : clonez-la avec ${otherName}, de même génération. Les deux couleurs servent au plan : le clone (l'une des deux, 50/50, avec son sexe et sa généalogie) sera utile quel que soit le tirage.`
  else if (self.use.useful) {
    reason = `Stérile utile sans partenaire de même couleur : clonez-la avec ${otherName}, inutile au plan — 50 % de garder cette couleur (avec son sexe et sa généalogie). Préférez une stérile de même couleur si vous en obtenez une.`
    confidence = 'medium'
  } else {
    reason = `Stérile sans usage : elle sert de partenaire de clonage à ${otherName}, utile au plan (50 % de garder la couleur utile ; sinon le clone fertile pourra être vendu ou extrait).`
    confidence = 'medium'
  }
  if (comparison) reason += ` ${comparison}`
  reason += ' Le clone repart fertile, jauges à 0, sans capacité.'
  return {
    mountId: self.m.id,
    action: 'cloner',
    label: kind === 'utile-inutile' ? 'Cloner (50 %)' : 'Cloner',
    reason,
    value: null,
    valueNote: 'le clone (fertile) repart dans le plan',
    floor: floor.value,
    floorComplete: floor.complete,
    confidence,
    complete: true,
    rule: 3,
    partnerId: other.m.id,
    usefulness: self.use,
  }
}

// ---------- Clonage : appariement (M-CLONE-01) ----------

/** Arbre d'une monture pour le clonage (le clone garde la généalogie de la monture conservée, 50/50). */
export type CloneTreeKind = 'porteur' | 'propre' | 'ordinaire'

/** Porteuse (un parent de génération supérieure), arbre propre (parents = un croisement de son espèce) ou ordinaire. */
export function cloneTreeKind(m: Pick<Mount, 'speciesId' | 'parents'>): CloneTreeKind {
  const s = getSpecies(m.speciesId)
  const parents = m.parents.slice(0, 2)
  if (!s || parents.length === 0) return 'ordinaire'
  if (parents.some((p) => spGen(p) > s.generation)) return 'porteur'
  if (parents.length === 2 && s.crossings.some((c) => (c[0] === parents[0] && c[1] === parents[1]) || (c[0] === parents[1] && c[1] === parents[0]))) return 'propre'
  return 'ordinaire'
}

/**
 * Appariement de stériles pour le clonage (research §2.6 : le clone garde la couleur, le sexe, le nom
 * et la généalogie de la monture conservée au hasard ; M-CLONE-01 « même sexe si l'on a besoin d'un
 * sexe précis ») : d'abord même sexe et même arbre (résultat certain), puis deux arbres précieux de
 * même catégorie (porteuses, arbres propres), puis deux arbres ordinaires de sexes différents, et en
 * dernier recours le reste — une porteuse ou un arbre propre n'est apparié à un autre arbre que s'il
 * n'existe aucune autre possibilité. Ordre d'entrée conservé dans chaque étape.
 */
export function pairForCloning<T>(items: T[], mountOf: (t: T) => Pick<Mount, 'speciesId' | 'parents' | 'gender'>): { pairs: [T, T][]; leftovers: T[] } {
  let pool = [...items]
  const pairs: [T, T][] = []
  const passes: ((t: T) => string | null)[] = [
    (t) => `${mountOf(t).gender}|${cloneTreeKind(mountOf(t))}`,
    (t) => {
      const k = cloneTreeKind(mountOf(t))
      return k === 'ordinaire' ? null : k
    },
    (t) => (cloneTreeKind(mountOf(t)) === 'ordinaire' ? 'ordinaire' : null),
    () => 'tout',
  ]
  for (const keyOf of passes) {
    const groups = new Map<string, T[]>()
    for (const t of pool) {
      const k = keyOf(t)
      if (k !== null) groups.set(k, [...(groups.get(k) ?? []), t])
    }
    const used = new Set<T>()
    for (const g of groups.values())
      for (let i = 0; i + 1 < g.length; i += 2) {
        pairs.push([g[i], g[i + 1]])
        used.add(g[i])
        used.add(g[i + 1])
      }
    pool = pool.filter((t) => !used.has(t))
  }
  return { pairs, leftovers: pool }
}

/** Meilleure sortie (vente, extraction, brisage) — ou « prix manquants ». */
function realizeFate(e: Entry, rule: number, intro: string, val: (id: number, l: number, s: MountState, sen: boolean) => FateValuation): MountFate {
  const st = fateState(e.m)
  const v = val(e.m.speciesId, e.m.level, st.state, st.senile)
  if (v.best === null || v.bestKind === null)
    return {
      mountId: e.m.id,
      action: 'a-chiffrer',
      label: 'Prix manquants',
      reason: `${intro} Aucune sortie n'est chiffrée : saisissez le prix de cette monture ou de la ressource d'extraction. ${optionsSummary(v)}`,
      value: null,
      valueNote: 'coût incomplet',
      floor: null,
      floorComplete: false,
      confidence: 'low',
      complete: false,
      rule,
      usefulness: e.use,
    }
  const kind = v.bestKind
  const best = kind === 'vente' ? v.sale : kind === 'extraction' ? v.extraction : v.brisage
  const notes = [
    intro,
    `Meilleure sortie : ${KIND_LABEL[kind].toLowerCase()} — ${optionsSummary(v)}`,
    best.note && kind !== 'extraction' ? best.note : '',
    !v.complete ? 'Une option n’a pas de prix : la comparaison est incomplète.' : '',
  ]
  return {
    mountId: e.m.id,
    action: kind,
    label: FATE_ACTION_LABELS[kind],
    reason: notes.filter(Boolean).join(' '),
    value: v.best,
    valueNote: 'net de taxe',
    floor: v.best,
    floorComplete: v.complete && v.best !== null,
    confidence: mapConfidence(v.confidence),
    complete: v.complete,
    rule: e.eff === 'senile' ? 7 : rule,
    exit: kind,
    usefulness: e.use,
  }
}

interface LevelTarget {
  level: number
  kind: 'brisage' | 'vente'
}

/** Niveaux de valeur : relevés de brisage de la famille (45, 53, 100, 200…) et tranches de prix 100 / 200. */
export function levelTargets(family: FamilyId): LevelTarget[] {
  const data = PRICES_DEFAULT.valuation.brisage as { defaultValuePerMountByLevel?: Record<string, Record<string, number> | null> } | undefined
  const anchors = data?.defaultValuePerMountByLevel?.[FAMILIES[family].label]
  const out: LevelTarget[] = anchors ? Object.keys(anchors).map((l) => ({ level: Number(l), kind: 'brisage' as const })) : []
  out.push({ level: 100, kind: 'vente' }, { level: 200, kind: 'vente' })
  return out.filter((t) => Number.isFinite(t.level)).sort((a, b) => a.level - b.level || a.kind.localeCompare(b.kind))
}

type LevelResult = { target: number; fate: MountFate } | { hint: string } | null

/**
 * Meilleur palier de valeur à atteindre pour une monture sans usage, si le gain net de carburant le
 * justifie, avec `batchSize` montures montées ensemble (la Mangeoire nourrit tout le lot).
 */
function levelOption(
  e: Entry,
  st: { state: MountState; senile: boolean },
  current: FateValuation,
  ctx: FateContext,
  val: (id: number, l: number, s: MountState, sen: boolean) => FateValuation,
  batchSize: number,
  onlyTarget?: number,
): LevelResult {
  if (!ctx.levelCost || !e.sp) return null
  const L = e.m.level
  const maxXp = ctx.maxLevelingXp ?? DEFAULT_MAX_LEVELING_XP
  const minGain = ctx.minLevelingGain ?? DEFAULT_MIN_LEVELING_GAIN
  let best: { t: LevelTarget; net: number; cost: number; gain: number; seconds?: number; tier?: number; lot: number; conf: FateConfidence; xp: number } | null = null
  let hint: string | undefined
  for (const t of levelTargets(e.sp.family)) {
    if (t.level <= L) continue
    if (onlyTarget !== undefined && t.level !== onlyTarget) continue
    const xp = mountXpBetween(L, t.level)
    if (xp > maxXp) continue
    const v = val(e.m.speciesId, t.level, st.state, st.senile)
    const opt = t.kind === 'brisage' ? v.brisage : v.sale
    if (!opt.possible || opt.net === null || !opt.complete) continue
    if (current.best === null || opt.net <= current.best) continue
    const c = ctx.levelCost(L, t.level, e.m, batchSize)
    if (c.cost === null || !c.complete) {
      hint ??= `Monter au niveau ${t.level} pourrait rapporter ≈ ${formatKamas(opt.net)} (${t.kind === 'brisage' ? 'brisage' : 'vente'}), mais le coût de l'XP est inconnu : saisissez le prix des carburants de Mangeoire.`
      continue
    }
    const gain = opt.net - c.cost - current.best
    if (gain <= 0 || gain < minGain * current.best) continue
    // Taille de lot réellement utilisée par l'appelant (une ancienne fonction à 3 paramètres chiffre un lot de 10).
    const lot = c.batchSize ?? (ctx.levelCost.length >= 4 ? batchSize : PADDOCK_SLOTS)
    if (!best || gain > best.gain) best = { t, net: opt.net, cost: c.cost, gain, seconds: c.seconds, tier: c.tier, lot, conf: mapConfidence(opt.confidence), xp }
  }
  if (!best) return hint ? { hint } : null
  const thenKind: FateKind = best.t.kind
  const lot =
    best.lot > 1
      ? `si vous montez ${best.lot} montures ensemble (la Mangeoire nourrit tout l'enclos ; coût du lot ÷ ${best.lot})`
      : "pour cette monture seule dans l'enclos"
  const tierText = best.tier ? `palier ${best.tier}, ` : ''
  const sure = current.complete
  const reason = [
    `Monture sans usage pour le plan, proche d'un palier de valeur : montez-la du niveau ${L} au niveau ${best.t.level} (${formatNumber(best.xp)} XP, ≈ ${formatKamas(best.cost)} de Mangeoire par monture ${lot}${best.seconds ? ` ; ${tierText}≈ ${formatDuration(best.seconds)} pour le lot` : ''}), puis ${THEN_LABEL[thenKind]}-la.`,
    sure
      ? `≈ ${formatKamas(best.net)} net au niveau ${best.t.level} contre ${formatKamas(current.best)} aujourd'hui : +${formatKamas(best.gain)} après carburant.`
      : `≈ ${formatKamas(best.net)} net au niveau ${best.t.level} contre au moins ${formatKamas(current.best)} aujourd'hui (une sortie actuelle n'est pas chiffrée) : au plus +${formatKamas(best.gain)} après carburant — saisissez son prix pour confirmer.`,
    thenKind === 'brisage' ? 'Rendements de brisage observés (estimation) : risque de correctif du brisage.' : '',
  ]
  return {
    target: best.t.level,
    fate: {
      mountId: e.m.id,
      action: 'monter',
      label: `Monter niv. ${best.t.level} puis ${THEN_LABEL[thenKind]}`,
      reason: reason.filter(Boolean).join(' '),
      value: best.net - best.cost,
      valueNote: `valeur au niveau ${best.t.level} moins le carburant (lot de ${best.lot})`,
      floor: current.best,
      floorComplete: current.complete && current.best !== null,
      confidence: minConfidence(best.conf, thenKind === 'brisage' ? 'low' : 'medium'),
      complete: sure,
      rule: thenKind === 'brisage' && e.sp.generation === 1 && e.sp.family !== 'dragodinde' ? 8 : 4,
      targetLevel: best.t.level,
      exit: thenKind,
      usefulness: e.use,
    },
  }
}

/**
 * Règle « monter en niveau » sur l'ensemble des candidates : le coût de Mangeoire par monture dépend
 * du nombre de montures montées ensemble. On regroupe par (famille, palier visé), on recalcule avec
 * lot = min(10, taille du groupe) jusqu'à stabilité ; une monture qui ne rapporte plus dans son groupe
 * est réévaluée seule (lot de 1).
 */
function planLeveling(
  exits: ExitCandidate[],
  ctx: FateContext,
  val: (id: number, l: number, s: MountState, sen: boolean) => FateValuation,
): Map<string, { fate: MountFate } | { hint: string }> {
  const out = new Map<string, { fate: MountFate } | { hint: string }>()
  if (!ctx.levelCost) return out
  type Cand = { x: ExitCandidate; target: number; key: string; fate?: MountFate }
  let active: Cand[] = []
  for (const x of exits) {
    const r = levelOption(x.e, x.st, x.current, ctx, val, PADDOCK_SLOTS)
    if (r && 'target' in r) active.push({ x, target: r.target, key: `${x.e.sp?.family}|${r.target}` })
    else if (r && 'hint' in r) out.set(x.e.m.id, { hint: r.hint })
  }
  const dropped: Cand[] = []
  for (;;) {
    const counts = new Map<string, number>()
    for (const c of active) counts.set(c.key, (counts.get(c.key) ?? 0) + 1)
    const next: Cand[] = []
    for (const c of active) {
      const n = Math.min(PADDOCK_SLOTS, counts.get(c.key) ?? 1)
      const r = levelOption(c.x.e, c.x.st, c.x.current, ctx, val, n, c.target)
      if (r && 'target' in r) next.push({ ...c, fate: r.fate })
      else dropped.push(c)
    }
    const stable = next.length === active.length
    active = next
    if (stable) break
  }
  for (const c of active) if (c.fate) out.set(c.x.e.m.id, { fate: c.fate })
  for (const c of dropped) {
    const r = levelOption(c.x.e, c.x.st, c.x.current, ctx, val, 1)
    if (r && 'target' in r) out.set(c.x.e.m.id, { fate: r.fate })
    else if (r && 'hint' in r) out.set(c.x.e.m.id, { hint: r.hint })
  }
  return out
}

// ---------- Inventaire : emplacements et places ----------

/** Smileys de sérénité du jeu : rouge :C, bleu :(, violet :), vert :D. */
export const SERENITY_SMILEYS: Record<SerenityBand, { color: 'rouge' | 'bleu' | 'violet' | 'vert'; face: string; label: string; short: string }> = {
  endurance: { color: 'rouge', face: ':C', label: 'Rouge :C — endurance seule (< −2 000)', short: 'Endurance' },
  'endurance-maturite': { color: 'bleu', face: ':(', label: 'Bleu :( — endurance + maturité (−2 000 à −1)', short: 'Endurance + Maturité' },
  'amour-maturite': { color: 'violet', face: ':)', label: 'Violet :) — maturité + amour (0 à 2 000)', short: 'Maturité + Amour' },
  amour: { color: 'vert', face: ':D', label: 'Vert :D — amour seul (> 2 000)', short: 'Amour' },
}

export const SERENITY_BANDS: SerenityBand[] = ['endurance', 'endurance-maturite', 'amour-maturite', 'amour']

/** Valeur représentative d'une zone (quand on ne connaît que le smiley) : milieu de la zone. ESTIMATION. */
export const SERENITY_BAND_MIDPOINT: Record<SerenityBand, number> = {
  endurance: -3_500,
  'endurance-maturite': -1_000,
  'amour-maturite': 1_000,
  amour: 3_500,
}

export function serenitySmiley(serenity: number) {
  const band = serenityBand(serenity)
  return { band, ...SERENITY_SMILEYS[band] }
}

export type LocationKey = 'etable' | 'inventaire' | `enclos-${number}`

export function locationKey(loc: MountLocation): LocationKey {
  return loc.kind === 'enclos' ? `enclos-${loc.paddock}` : loc.kind
}

export function parseLocationKey(key: string): MountLocation | null {
  if (key === 'etable' || key === 'inventaire') return { kind: key }
  const m = /^enclos-(\d+)$/.exec(key)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= PADDOCK_UNLOCK_LEVELS.length ? { kind: 'enclos', paddock: n } : null
}

export function locationLabel(loc: MountLocation): string {
  if (loc.kind === 'enclos') return `Enclos ${loc.paddock}`
  return loc.kind === 'etable' ? 'Étable' : 'Inventaire'
}

/** Nombre d'enclos débloqués par le niveau d'Éleveur (1, 40, 80, 120, 160, 200). */
export function unlockedPaddocks(jobLevel: number): number {
  return Math.max(1, PADDOCK_UNLOCK_LEVELS.filter((p) => p.level <= jobLevel).length)
}

/** Montures par enclos (1 … 6). */
export function paddockOccupancy(mounts: Mount[]): Map<number, number> {
  const occ = new Map<number, number>()
  for (let i = 1; i <= PADDOCK_UNLOCK_LEVELS.length; i++) occ.set(i, 0)
  for (const m of mounts) if (m.location.kind === 'enclos') occ.set(m.location.paddock, (occ.get(m.location.paddock) ?? 0) + 1)
  return occ
}

/**
 * Raisons empêchant de déplacer `ids` vers `dest` (vide = possible) : enclos non débloqué, plus de
 * 10 montures dans un enclos, étable pleine.
 */
export function moveBlockers(mounts: Mount[], ids: string[], dest: MountLocation, opts: { jobLevel: number; stableSlots: number }): string[] {
  const moving = new Set(ids)
  const count = mounts.filter((m) => moving.has(m.id)).length
  if (count === 0) return ['Aucune monture sélectionnée.']
  const out: string[] = []
  if (dest.kind === 'enclos') {
    const unlock = PADDOCK_UNLOCK_LEVELS[dest.paddock - 1]
    if (!unlock) return [`L'enclos ${dest.paddock} n'existe pas.`]
    if (dest.paddock > unlockedPaddocks(opts.jobLevel)) out.push(`L'enclos ${dest.paddock} n'est pas débloqué (Éleveur niveau ${unlock.level} requis).`)
    const staying = mounts.filter((m) => !moving.has(m.id) && m.location.kind === 'enclos' && m.location.paddock === dest.paddock).length
    const free = PADDOCK_SLOTS - staying
    if (count > free)
      out.push(`L'enclos ${dest.paddock} n'a que ${Math.max(0, free)} place${free > 1 ? 's' : ''} libre${free > 1 ? 's' : ''} pour ${count} monture${count > 1 ? 's' : ''} (${PADDOCK_SLOTS} places par enclos).`)
  } else if (dest.kind === 'etable') {
    const staying = mounts.filter((m) => !moving.has(m.id) && m.location.kind === 'etable').length
    if (staying + count > opts.stableSlots) out.push(`L'étable est limitée à ${opts.stableSlots} montures (${staying} déjà présentes).`)
  }
  return out
}

// ---------- Captures groupées ----------

export interface CaptureLine {
  speciesId: number | null
  males: number
  females: number
}

/** Raisons empêchant d'enregistrer des captures (vide = possible). */
export function captureBlockers(lines: CaptureLine[]): string[] {
  const out: string[] = []
  let total = 0
  lines.forEach((l, i) => {
    const n = i + 1
    const males = Math.floor(l.males)
    const females = Math.floor(l.females)
    if (!Number.isFinite(males) || !Number.isFinite(females) || males < 0 || females < 0) out.push(`Ligne ${n} : nombres de mâles et de femelles invalides.`)
    const count = Math.max(0, males) + Math.max(0, females)
    if (l.speciesId === null) {
      if (count > 0) out.push(`Ligne ${n} : choisissez la couleur capturée.`)
      return
    }
    const s = getSpecies(l.speciesId)
    if (!s || !s.capturable || s.generation !== 1) out.push(`Ligne ${n} : seules les montures G1 sauvages se capturent.`)
    if (count === 0) out.push(`Ligne ${n} : indiquez au moins une monture (mâle ou femelle).`)
    if (count > 500) out.push(`Ligne ${n} : ${count} montures, c'est plus que l'étable ne peut contenir.`)
    total += count
  })
  if (total === 0 && out.length === 0) out.push('Ajoutez au moins une capture.')
  return out
}

/** Une monture à créer pour une session de capture : ligne, sexe et rang dans la ligne (ordre de `capturedMounts`). */
export interface CaptureSlot {
  line: number
  speciesId: number
  gender: Gender
  /** Rang parmi les montures de même ligne et de même sexe (0, 1, …). */
  index: number
  /** Clé stable (`ligne|sexe|rang`) pour une sérénité saisie monture par monture. */
  key: string
}

/** Montures d'une session de capture, dans l'ordre de création (par ligne : les mâles, puis les femelles). */
export function captureSlots(lines: CaptureLine[]): CaptureSlot[] {
  const out: CaptureSlot[] = []
  lines.forEach((l, line) => {
    if (l.speciesId === null) return
    for (const [gender, n] of [
      ['male', l.males],
      ['femelle', l.females],
    ] as const)
      for (let index = 0; index < Math.max(0, Math.floor(n)); index++) out.push({ line, speciesId: l.speciesId, gender, index, key: `${line}|${gender}|${index}` })
  })
  return out
}

/**
 * Montures à créer pour une session de capture (G1, niveau 1, jauges à 0). Sérénité : celle de chaque
 * monture si `serenities` la donne (même ordre que `captureSlots`, null = inconnue), sinon la valeur
 * commune `serenity` (0 par défaut).
 */
export function capturedMounts(
  lines: CaptureLine[],
  opts: { serenity?: number; serenities?: (number | null | undefined)[]; location?: MountLocation } = {},
): Omit<Mount, 'id' | 'createdAt' | 'updatedAt'>[] {
  const common = clampInt(opts.serenity ?? 0, SERENITY_MIN, SERENITY_MAX)
  const loc = opts.location ?? { kind: 'etable' }
  return captureSlots(lines).map((slot, i) => {
    const own = opts.serenities?.[i]
    const serenity = own === null || own === undefined || !Number.isFinite(own) ? common : clampInt(own, SERENITY_MIN, SERENITY_MAX)
    return capturedMount(slot.speciesId, slot.gender, serenity, loc)
  })
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : 0)))
}

// ---------- Clonage et extraction ----------

/**
 * Modifications de la monture conservée après un clonage : fertile, endurance/maturité/amour à 0,
 * capacité perdue ; sérénité remise à 0 (3.5/3.6 : « réinitialisée », valeur exacte non tranchée)
 * ou conservée (3.7). Couleur, sexe, nom, généalogie et niveau (non confirmé) sont gardés.
 */
export function clonePatch(kept: Mount, rules: Ruleset): Pick<Mount, 'fertility' | 'endurance' | 'maturity' | 'love' | 'serenity' | 'ability'> {
  return {
    fertility: 'fertile',
    endurance: 0,
    maturity: 0,
    love: 0,
    serenity: rules.cloneKeepsSerenity ? kept.serenity : 0,
    ability: null,
  }
}

/** Ressources obtenues à l'extraction : génération (G1 = 0), sénile = 1, spéciale = 0. */
export function extractionQuantity(m: Mount): number {
  const s = getSpecies(m.speciesId)
  if (!s || !s.breedable) return 0
  if (m.fertility === 'senile') return 1
  return s.extractionQty
}

/** Ressource d'extraction de la famille (Neurone, Ambre, Corne). */
export function extractionResource(m: Mount): { itemId: number; name: string } | null {
  const s = getSpecies(m.speciesId)
  if (!s) return null
  const f = FAMILIES[s.family]
  return { itemId: f.extractionItemId, name: f.extractionItemName }
}

// ---------- Synthèse ----------

export interface InventorySummary {
  total: number
  byFamily: Record<FamilyId, number>
  byStatus: Record<Fertility, number>
  /** Génération → nombre (0 = spéciale). */
  byGeneration: Map<number, number>
  /** Fécondes de sexes opposés appariables (même famille). */
  fecundPairs: number
  /** Fécondes posées en enclos (à retirer vers l'étable avant d'accoupler). */
  fecundInPaddock: number
  paddock: Map<number, number>
  stable: number
  inventory: number
}

export function inventorySummary(mounts: Mount[]): InventorySummary {
  const byFamily: Record<FamilyId, number> = { dragodinde: 0, muldo: 0, volkorne: 0 }
  const byStatus: Record<Fertility, number> = { fertile: 0, feconde: 0, sterile: 0, senile: 0 }
  const byGeneration = new Map<number, number>()
  const fecund: Record<FamilyId, { male: number; femelle: number }> = {
    dragodinde: { male: 0, femelle: 0 },
    muldo: { male: 0, femelle: 0 },
    volkorne: { male: 0, femelle: 0 },
  }
  let fecundInPaddock = 0
  let stable = 0
  let inventory = 0
  for (const m of mounts) {
    const s = getSpecies(m.speciesId)
    const eff = effectiveFertility(m)
    byStatus[eff]++
    if (m.location.kind === 'etable') stable++
    else if (m.location.kind === 'inventaire') inventory++
    if (!s) continue
    byFamily[s.family]++
    byGeneration.set(s.generation, (byGeneration.get(s.generation) ?? 0) + 1)
    if (eff === 'feconde' && s.breedable) {
      fecund[s.family][m.gender]++
      if (m.location.kind === 'enclos') fecundInPaddock++
    }
  }
  const fecundPairs = (Object.keys(fecund) as FamilyId[]).reduce((n, f) => n + Math.min(fecund[f].male, fecund[f].femelle), 0)
  return { total: mounts.length, byFamily, byStatus, byGeneration, fecundPairs, fecundInPaddock, paddock: paddockOccupancy(mounts), stable, inventory }
}
