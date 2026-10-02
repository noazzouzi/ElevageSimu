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
import { ancestorsOf, cheapestRecipe, requiredSpecies } from './breedingPath'
import type { FateKind, MountState, MountValuation } from './economy'
import { breed } from './genetics'
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

/** Coût (kamas par monture) pour monter une monture de `fromLevel` à `toLevel` (en pratique : `levelingCost`). */
export type LevelCostFn = (fromLevel: number, toLevel: number, mount: Mount) => { cost: number | null; complete: boolean; seconds?: number }

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
    const crossings = childrenOf(sp.id)
      .filter(useful)
      .sort((a, b) => score(b) - score(a) || spGen(a.child) - spGen(b.child) || a.child - b.child)
    if (plan.recipe.has(sp.id))
      return { kind: 'recette', useful: true, detail: `Fait partie de la recette la plus courte vers ${plan.goalName}.`, crossings }
    if (plan.ancestors.has(sp.id))
      return { kind: 'ascendance', useful: true, detail: `Sert à un autre chemin de croisement vers ${plan.goalName}.`, crossings }
    const carried = m.parents.slice(0, 2).find((p) => {
      const ps = getSpecies(p)
      return !!ps && ps.family === sp.family && ps.generation > sp.generation && inPlan(p, plan) && p !== plan.goalId
    })
    if (carried !== undefined) {
      const viaCarrier = childrenOf(carried)
        .filter(useful)
        .sort((a, b) => score(b) - score(a) || spGen(a.child) - spGen(b.child) || a.child - b.child)
      return {
        kind: 'porteur',
        useful: true,
        detail: `Porteuse : un de ses parents est ${spName(carried)} (G${spGen(carried)}). Croisée avec une autre couleur, elle vise la même génération qu'un croisement de ${spName(carried)}.`,
        crossings: viaCarrier,
        carried,
      }
    }
    return { kind: 'aucune', useful: false, detail: `Ne sert à aucun chemin de croisement vers ${plan.goalName}.`, crossings: [] }
  }
  const next = childrenOf(sp.id).filter((c) => spGen(c.child) > sp.generation)
  if (sp.generation >= 10 || next.length === 0)
    return { kind: 'aucune', useful: false, detail: 'G10 : génération maximale, elle ne rapporte plus de génétons.', crossings: [] }
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
  const out = new Map<string, MountFate>()
  const floorOf = (e: Entry) => {
    const st = fateState(e.m)
    return val(e.m.speciesId, e.m.level, st.state, st.senile).best
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
      out.set(e.m.id, keepFate(e, 1, 'Garder (objectif)', `${e.use.detail} Gardez-en au moins un exemplaire ; les doubles peuvent être vendus une fois le succès validé.`, 'medium', floorOf(e)))
      continue
    }
    if (e.use.useful && (e.eff === 'feconde' || e.eff === 'fertile')) {
      const fecund = e.eff === 'feconde'
      const partnerText = partnerSentence(e, entries)
      const label = fecund ? 'Garder' : 'Garder — à féconder'
      const head = fecund ? 'Féconde et utile au plan.' : 'Fertile et utile au plan : à rendre féconde.'
      const conf: FateConfidence = e.use.kind === 'recette' || e.use.kind === 'porteur' ? 'medium' : e.use.kind === 'progression' ? 'low' : 'medium'
      out.set(e.m.id, keepFate(e, 1, label, `${head} ${e.use.detail}${partnerText ? ` ${partnerText}` : ''}`, conf, floorOf(e)))
      continue
    }
    remaining.push(e)
  }

  // 2. Bébé gratuit : fécondes condamnées de sexes opposés, même famille (M-FREEBABY-01, M-G10OUT-01).
  const condemnedFecund = remaining
    .filter((e) => e.eff === 'feconde')
    .sort((a, b) => (b.sp?.generation ?? 0) - (a.sp?.generation ?? 0) || b.m.level - a.m.level || a.m.id.localeCompare(b.m.id))
  const paired = new Set<string>()
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
    if (!pair) continue
    paired.add(a.m.id)
    paired.add(b.m.id)
    out.set(a.m.id, pair[0])
    out.set(b.m.id, pair[1])
  }

  // 3. Clonage des stériles (même famille, même génération ; M-CLONE-01).
  const steriles = remaining.filter((e) => e.eff === 'sterile' && !out.has(e.m.id))
  const groups = new Map<string, Entry[]>()
  for (const e of steriles) {
    const k = `${e.sp?.family}|${e.sp?.generation}`
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  for (const list of groups.values()) {
    for (const [a, b, kind] of clonePairs(list)) {
      out.set(a.m.id, cloneFate(a, b, kind, floorOf(a)))
      out.set(b.m.id, cloneFate(b, a, kind, floorOf(b)))
    }
  }

  // 4–5. Le reste : stérile utile isolée gardée, sinon monter en niveau, sinon la meilleure sortie.
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
    else if (e.eff === 'feconde')
      intro = `${g10 ? 'G10 féconde' : 'Féconde'} sans usage pour le plan et sans autre féconde condamnée de sexe opposé : banque si elle peut resservir, sinon sortie.`
    else intro = `Fertile sans usage pour le plan${e.use.kind === 'aucune' ? ` (${e.use.detail.replace(/\.$/, '').toLowerCase()})` : ''} : la rendre féconde coûterait du carburant pour rien.`
    if (e.use.kind === 'progression' && e.eff === 'sterile') intro += ' Si vous comptez la cloner plus tard, gardez-la en attendant une stérile de même génération.'
    const current = val(e.m.speciesId, e.m.level, st.state, st.senile)
    const lvl = levelOption(e, st, current, ctx, val)
    if (lvl && 'target' in lvl) {
      out.set(e.m.id, lvl.fate)
      continue
    }
    const fate = realizeFate(e, rule, intro, val)
    if (lvl && 'hint' in lvl) fate.hint = lvl.hint
    out.set(e.m.id, fate)
  }
  return out
}

function keepFate(e: Entry, rule: number, label: string, reason: string, confidence: FateConfidence, floor: number | null): MountFate {
  return {
    mountId: e.m.id,
    action: 'garder',
    label,
    reason,
    value: null,
    valueNote: floor === null ? 'à garder' : 'à garder (valeur de sortie actuelle : plancher)',
    floor,
    confidence,
    complete: true,
    rule,
    usefulness: e.use,
  }
}

const oppositeGender = (g: Gender): Gender => (g === 'male' ? 'femelle' : 'male')

/** Partenaire disponible pour le croisement le plus utile (phrase), ou ce qui manque. */
function partnerSentence(e: Entry, entries: Entry[]): string {
  const c = e.use.crossings[0]
  if (!c) return ''
  const want = oppositeGender(e.m.gender)
  const usable = (x: Entry) => x.m.id !== e.m.id && x.m.speciesId === c.partner && x.m.gender === want && (x.eff === 'feconde' || x.eff === 'fertile')
  const partner = entries.filter(usable).sort((x, y) => Number(y.eff === 'feconde') - Number(x.eff === 'feconde') || y.m.level - x.m.level)[0]
  const cross = e.use.kind === 'porteur' && e.use.carried !== undefined ? `porteuse de ${spName(e.use.carried)}` : spName(e.m.speciesId)
  const head = `Croisement visé : ${cross} × ${spName(c.partner)} → ${spName(c.child)} (G${spGen(c.child)}).`
  const sexe = want === 'male' ? 'mâle' : 'femelle'
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
  if (
    allComplete &&
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
      floor: val(self.m.speciesId, self.m.level, 'feconde', false).best,
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

/** Paires de clonage d'un groupe (même famille + génération) : même couleur, puis deux utiles, puis utile + inutile. */
function clonePairs(list: Entry[]): [Entry, Entry, CloneKind][] {
  const useful = list.filter((e) => e.use.useful)
  const useless = list.filter((e) => !e.use.useful)
  const pairs: [Entry, Entry, CloneKind][] = []
  const bySpecies = new Map<number, Entry[]>()
  for (const e of useful) bySpecies.set(e.m.speciesId, [...(bySpecies.get(e.m.speciesId) ?? []), e])
  const leftovers: Entry[] = []
  for (const same of [...bySpecies.values()].sort((x, y) => x[0].m.speciesId - y[0].m.speciesId)) {
    for (let i = 0; i + 1 < same.length; i += 2) pairs.push([same[i], same[i + 1], 'meme-couleur'])
    if (same.length % 2 === 1) leftovers.push(same[same.length - 1])
  }
  // Plan d'abord : les couleurs de la recette sont appariées en priorité.
  const rank = (e: Entry) => (e.use.kind === 'recette' ? 0 : e.use.kind === 'porteur' ? 1 : e.use.kind === 'ascendance' ? 2 : 3)
  leftovers.sort((x, y) => rank(x) - rank(y) || x.m.speciesId - y.m.speciesId)
  let i = 0
  for (; i + 1 < leftovers.length; i += 2) pairs.push([leftovers[i], leftovers[i + 1], 'deux-utiles'])
  if (i < leftovers.length && useless.length > 0) {
    const sacrifice = [...useless].sort((x, y) => x.m.level - y.m.level || x.m.id.localeCompare(y.m.id))[0]
    pairs.push([leftovers[i], sacrifice, 'utile-inutile'])
  }
  return pairs
}

function cloneFate(self: Entry, other: Entry, kind: CloneKind, floor: number | null): MountFate {
  const otherName = `${mountName(other.m)}${other.m.speciesId !== self.m.speciesId ? ` (${spName(other.m.speciesId)})` : ''}`
  let reason: string
  let confidence: FateConfidence = 'high'
  if (kind === 'meme-couleur') reason = `Stérile : clonez-la avec ${otherName}, de la même couleur — résultat certain : une ${spName(self.m.speciesId)} fertile.`
  else if (kind === 'deux-utiles')
    reason = `Stérile : clonez-la avec ${otherName}, de même génération. Les deux couleurs servent au plan : le clone (l'une des deux, 50/50) sera utile quel que soit le tirage.`
  else if (self.use.useful) {
    reason = `Stérile utile sans partenaire de même couleur : clonez-la avec ${otherName}, inutile au plan — 50 % de garder cette couleur. Préférez une stérile de même couleur si vous en obtenez une.`
    confidence = 'medium'
  } else {
    reason = `Stérile sans usage : elle sert de partenaire de clonage à ${otherName}, utile au plan (50 % de garder la couleur utile ; sinon le clone fertile pourra être vendu ou extrait).`
    confidence = 'medium'
  }
  reason += ' Le clone repart fertile, jauges à 0, sans capacité.'
  return {
    mountId: self.m.id,
    action: 'cloner',
    label: kind === 'utile-inutile' ? 'Cloner (50 %)' : 'Cloner',
    reason,
    value: null,
    valueNote: 'le clone (fertile) repart dans le plan',
    floor,
    confidence,
    complete: true,
    rule: 3,
    partnerId: other.m.id,
    usefulness: self.use,
  }
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

function levelOption(
  e: Entry,
  st: { state: MountState; senile: boolean },
  current: FateValuation,
  ctx: FateContext,
  val: (id: number, l: number, s: MountState, sen: boolean) => FateValuation,
): { target: number; fate: MountFate } | { hint: string } | null {
  if (!ctx.levelCost || !e.sp) return null
  const L = e.m.level
  const maxXp = ctx.maxLevelingXp ?? DEFAULT_MAX_LEVELING_XP
  const minGain = ctx.minLevelingGain ?? DEFAULT_MIN_LEVELING_GAIN
  let best: { t: LevelTarget; net: number; cost: number; gain: number; seconds?: number; conf: FateConfidence; xp: number } | null = null
  let hint: string | undefined
  for (const t of levelTargets(e.sp.family)) {
    if (t.level <= L) continue
    const xp = mountXpBetween(L, t.level)
    if (xp > maxXp) continue
    const v = val(e.m.speciesId, t.level, st.state, st.senile)
    const opt = t.kind === 'brisage' ? v.brisage : v.sale
    if (!opt.possible || opt.net === null || !opt.complete) continue
    if (current.best === null || opt.net <= current.best) continue
    const c = ctx.levelCost(L, t.level, e.m)
    if (c.cost === null || !c.complete) {
      hint ??= `Monter au niveau ${t.level} pourrait rapporter ≈ ${formatKamas(opt.net)} (${t.kind === 'brisage' ? 'brisage' : 'vente'}), mais le coût de l'XP est inconnu : saisissez le prix des carburants de Mangeoire.`
      continue
    }
    const gain = opt.net - c.cost - current.best
    if (gain <= 0 || gain < minGain * current.best) continue
    if (!best || gain > best.gain) best = { t, net: opt.net, cost: c.cost, gain, seconds: c.seconds, conf: mapConfidence(opt.confidence), xp }
  }
  if (!best) return hint ? { hint } : null
  const thenKind: FateKind = best.t.kind
  const reason = [
    `Monture sans usage pour le plan, proche d'un palier de valeur : montez-la du niveau ${L} au niveau ${best.t.level} (${formatNumber(best.xp)} XP, ≈ ${formatKamas(best.cost)} de Mangeoire par monture${best.seconds ? `, ≈ ${formatDuration(best.seconds)} pour un lot` : ''}), puis ${THEN_LABEL[thenKind]}-la.`,
    `≈ ${formatKamas(best.net)} net au niveau ${best.t.level} contre ${formatKamas(current.best)} aujourd'hui : +${formatKamas(best.gain)} après carburant.`,
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
      valueNote: `valeur au niveau ${best.t.level} moins le carburant`,
      floor: current.best,
      confidence: minConfidence(best.conf, thenKind === 'brisage' ? 'low' : 'medium'),
      complete: true,
      rule: thenKind === 'brisage' && e.sp.generation === 1 && e.sp.family !== 'dragodinde' ? 8 : 4,
      targetLevel: best.t.level,
      exit: thenKind,
      usefulness: e.use,
    },
  }
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

/** Montures à créer pour une session de capture (G1, niveau 1, jauges à 0, sérénité commune). */
export function capturedMounts(lines: CaptureLine[], opts: { serenity?: number; location?: MountLocation } = {}): Omit<Mount, 'id' | 'createdAt' | 'updatedAt'>[] {
  const serenity = clampInt(opts.serenity ?? 0, SERENITY_MIN, SERENITY_MAX)
  const out: Omit<Mount, 'id' | 'createdAt' | 'updatedAt'>[] = []
  for (const l of lines) {
    if (l.speciesId === null) continue
    const loc = opts.location ?? { kind: 'etable' }
    for (let i = 0; i < Math.max(0, Math.floor(l.males)); i++) out.push(capturedMount(l.speciesId, 'male', serenity, loc))
    for (let i = 0; i < Math.max(0, Math.floor(l.females)); i++) out.push(capturedMount(l.speciesId, 'femelle', serenity, loc))
  }
  return out
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
