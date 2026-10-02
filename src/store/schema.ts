// Schémas des données persistées (localStorage, clés « elevagesimu:* ») : versions, migrations et
// normalisation (« sanitize »). Module pur : aucun accès au navigateur ni à zustand. Il sert à la fois
// à la réhydratation des stores (src/store/persistence.ts) et à l'import d'une sauvegarde
// (src/lib/backup.ts), pour qu'une donnée mal formée (fichier modifié à la main, sauvegarde d'une
// autre version, stockage corrompu) ne puisse jamais faire planter une page.
//
// Règles :
//  - une migration ne jette jamais de donnée : elle complète ou convertit ;
//  - la normalisation remplace une valeur invalide par la valeur par défaut, borne les nombres et
//    écarte une entrée inutilisable (monture sans espèce connue…), en le signalant (`issues`, en
//    français) ; un prix invalide est retiré (« pas de prix »), jamais remplacé par 0.
import { FAMILY_IDS, getSpecies } from '../data'
import { ABILITY_LABELS, MAX_PADDOCKS, MOUNT_MAX_LEVEL, MOUNT_STAT_MAX, SERENITY_MAX, SERENITY_MIN } from '../domain/constants'
import { sanitizeHistory, sanitizeSnapshot, type MarketHistoryEntry, type MarketSnapshot } from '../domain/market'
import type { ProfitModeId } from '../domain/production'
import { RULESETS } from '../domain/rules'
import type { Ability, FamilyId, Fertility, FuelTier, Gender, Mount, MountLocation, RulesetId } from '../domain/types'
import type { JournalEntry } from './journal'

// ---------- Clés de stockage ----------
//
// v2 (profils et serveurs, docs/api/profiles.md) :
//   - registre des profils : « elevagesimu:profiles » ;
//   - données d'un profil  : « elevagesimu:p:<profil>:<base> » (réglages, montures, enclos, plans,
//     avancement, journal, préférences des pages) ;
//   - données d'un serveur : « elevagesimu:s:<serveur>:<base> » (prix saisis, marché importé, historique).
// v1 (avant les profils) : « elevagesimu:<base> » — clés « anciennes », migrées vers le profil
// « Principal » à la première ouverture de la v2 et conservées comme copie de sécurité.
// Les clés du profil actif sont dans src/store/profiles.ts (`STORE_KEYS`, `profileKey`).

/** Préfixe de toutes les clés de l'application dans le localStorage. */
export const STORAGE_PREFIX = 'elevagesimu:'
/** Registre des profils et des serveurs. */
export const PROFILES_KEY = 'elevagesimu:profiles'
/** Copie d'un registre illisible, gardée telle quelle avant reconstruction. */
export const PROFILES_CORRUPT_KEY = 'elevagesimu:profiles-corrompu'
/** Réglage de l'appareil (notifications du navigateur), commun à tous les profils. */
export const NOTIFICATIONS_KEY = 'elevagesimu:enclos-notifications'
/** Clés globales (ni profil ni serveur, jamais migrées). */
export const GLOBAL_KEYS: readonly string[] = [PROFILES_KEY, PROFILES_CORRUPT_KEY, NOTIFICATIONS_KEY]

/** Sous-ensemble de l'API Web Storage utilisé (localStorage ou faux stockage de test). */
export interface StorageLike {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type StoreScope = 'profile' | 'server'

export interface PersistedStoreInfo {
  /** Libellé lisible (français). */
  label: string
  /** Version actuelle du schéma persisté (`version` de persist). */
  version: number
  /** Portée : données d'un profil ou d'un serveur. */
  scope?: StoreScope
}

/**
 * Stores persistés (par « base » de clé) : libellé, version actuelle du schéma et portée. Source unique
 * utilisée par les stores (option `version` de persist) et par la validation des sauvegardes. Incrémenter
 * la version ici ET fournir la migration correspondante à chaque changement de forme.
 */
export const STORE_BASES = {
  settings: { label: 'Réglages', version: 3, scope: 'profile' },
  inventory: { label: 'Montures (étable, enclos, inventaire)', version: 1, scope: 'profile' },
  paddocks: { label: 'Jauges des enclos', version: 1, scope: 'profile' },
  paddockPlans: { label: 'Plans d’enclos en cours', version: 1, scope: 'profile' },
  planProgress: { label: 'Avancement du plan d’élevage', version: 1, scope: 'profile' },
  journal: { label: 'Journal d’élevage', version: 1, scope: 'profile' },
  prices: { label: 'Prix saisis', version: 1, scope: 'server' },
  market: { label: 'Prix du marché (export HDV)', version: 1, scope: 'server' },
  'market-history': { label: 'Historique des imports HDV', version: 1, scope: 'server' },
} as const satisfies Record<string, Required<PersistedStoreInfo>>

export type StoreBase = keyof typeof STORE_BASES

/** Bases de stores qui existaient avant les profils (clés « elevagesimu:<base> »). */
const LEGACY_BASES: StoreBase[] = ['settings', 'inventory', 'paddocks', 'paddockPlans', 'planProgress', 'prices', 'journal']

/** Clés des stores avant les profils (v1). Lecture seule : copie de sécurité après migration. */
export const LEGACY_STORE_KEYS = {
  settings: 'elevagesimu:settings',
  inventory: 'elevagesimu:inventory',
  paddocks: 'elevagesimu:paddocks',
  paddockPlans: 'elevagesimu:paddockPlans',
  planProgress: 'elevagesimu:planProgress',
  prices: 'elevagesimu:prices',
  journal: 'elevagesimu:journal',
} as const

/** Identifiant de profil ou de serveur valide (minuscules, chiffres, tirets ; pas de « : »). */
export function isValidScopeId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(id)
}

/** Clé d'une donnée de profil : « elevagesimu:p:<profil>:<base> ». */
export function profileStoreKey(profileId: string, base: string): string {
  return `${STORAGE_PREFIX}p:${profileId}:${base}`
}

/** Clé d'une donnée de serveur : « elevagesimu:s:<serveur>:<base> ». */
export function serverStoreKey(serverId: string, base: string): string {
  return `${STORAGE_PREFIX}s:${serverId}:${base}`
}

/** Préfixe de toutes les clés d'un profil (ou d'un serveur). */
export function profileKeyPrefix(profileId: string): string {
  return `${STORAGE_PREFIX}p:${profileId}:`
}
export function serverKeyPrefix(serverId: string): string {
  return `${STORAGE_PREFIX}s:${serverId}:`
}

/** Clés de tous les stores pour un profil et son serveur. */
export function storeKeysFor(profileId: string, serverId: string): Record<StoreBase, string> {
  const out = {} as Record<StoreBase, string>
  for (const [base, info] of Object.entries(STORE_BASES) as [StoreBase, PersistedStoreInfo][])
    out[base] = info.scope === 'server' ? serverStoreKey(serverId, base) : profileStoreKey(profileId, base)
  return out
}

export interface ParsedStoreKey {
  /** profil, serveur, clé globale, ou clé d'avant les profils. */
  kind: 'profile' | 'server' | 'global' | 'legacy'
  /** Identifiant du profil ou du serveur. */
  id?: string
  /** Base de la clé (« inventory », « montures-ui »…). */
  base: string
}

/** Analyse une clé de l'application (null si ce n'est pas une clé « elevagesimu:… » reconnue). */
export function parseStoreKey(key: string): ParsedStoreKey | null {
  if (typeof key !== 'string' || !key.startsWith(STORAGE_PREFIX) || key.length <= STORAGE_PREFIX.length) return null
  if (GLOBAL_KEYS.includes(key)) return { kind: 'global', base: key.slice(STORAGE_PREFIX.length) }
  const rest = key.slice(STORAGE_PREFIX.length)
  const scoped = /^([ps]):([^:]+):([^:]+)$/.exec(rest)
  if (scoped) return isValidScopeId(scoped[2]) ? { kind: scoped[1] === 'p' ? 'profile' : 'server', id: scoped[2], base: scoped[3] } : null
  if (rest.includes(':')) return null
  return { kind: 'legacy', base: rest }
}

/**
 * Store persisté correspondant à une clé, quelle que soit sa forme (profil, serveur ou ancienne clé) ;
 * undefined si ce n'est pas un store (préférences de page, clé inconnue, base dans la mauvaise portée).
 */
export function persistedStoreInfo(key: string): (PersistedStoreInfo & { base: StoreBase }) | undefined {
  const p = parseStoreKey(key)
  if (!p || !Object.hasOwn(STORE_BASES, p.base)) return undefined
  const base = p.base as StoreBase
  const info: PersistedStoreInfo = STORE_BASES[base]
  if (p.kind === 'legacy' ? !LEGACY_BASES.includes(base) : p.kind !== info.scope) return undefined
  return { ...info, base }
}

/**
 * Stores d'avant les profils, par clé (compatibilité : sauvegardes v1). Pour une clé de la v2, utiliser
 * `persistedStoreInfo(key)`.
 */
export const PERSISTED_STORES: Record<string, PersistedStoreInfo> = Object.fromEntries(
  LEGACY_BASES.map((b) => [LEGACY_STORE_KEYS[b as keyof typeof LEGACY_STORE_KEYS], { label: STORE_BASES[b].label, version: STORE_BASES[b].version, scope: STORE_BASES[b].scope }]),
)

/** Version actuelle d'un store persisté (undefined si la clé n'est pas un store connu). */
export function storeVersion(key: string): number | undefined {
  return persistedStoreInfo(key)?.version
}

/** Résultat d'une normalisation : état utilisable + problèmes corrigés (phrases courtes en français). */
export interface Sanitized<T> {
  state: T
  issues: string[]
}

// ---------- Utilitaires ----------

export function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Nombre fini borné (arrondi si `int`), ou undefined si `v` n'est pas un nombre fini. */
function bounded(v: unknown, min: number, max: number, int = false): number | undefined {
  if (!isFiniteNumber(v)) return undefined
  const x = Math.min(max, Math.max(min, v))
  return int ? Math.round(x) : x
}

const s = (n: number, one: string, many: string) => `${n} ${n >= 2 ? many : one}`

let idSeq = 0
/** Identifiant de remplacement pour une entrée sans identifiant (ou en double). */
function freshId(prefix: string): string {
  idSeq = (idSeq + 1) % 1_000_000
  return `${prefix}-r${Date.now().toString(36)}-${idSeq.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

// ---------- Réglages ----------

export type Goal = 'profit' | 'succes' | 'mixte'

/**
 * Mode de rentabilité du profil (docs/SPEC-v2.md §4, src/domain/modes.ts) : oriente le conseiller, l'accueil
 * et le plan. `progression` = comportement d'avant les modes (objectif de génération) : valeur des profils
 * migrés et nouveaux. Même liste que `ProfitModeId` (production.ts), vérifiée à la compilation.
 */
export type ProfileMode = ProfitModeId

/** Modes acceptés (objet typé : un mode ajouté à `ProfitModeId` sans être listé ici ne compile pas). */
const PROFILE_MODE_SET: Record<ProfileMode, true> = {
  auto: true,
  'rush-corne': true,
  'rush-ambre': true,
  'rush-neurone': true,
  'brisage-pa': true,
  'brisage-pm': true,
  'vente-montures': true,
  progression: true,
}
export const PROFILE_MODES = Object.keys(PROFILE_MODE_SET) as ProfileMode[]

export interface Settings {
  /** Version des règles du jeu (3.6 = live). */
  ruleset: RulesetId
  /** Niveau du métier d'Éleveur (1 … 200). */
  jobLevel: number
  /**
   * Instant (ms) où `jobLevel` a été saisi pour la dernière fois (0 = depuis toujours : tout le journal
   * compte). L'XP d'Éleveur enregistrée dans le journal après cet instant (`journalJobXp`) permet
   * d'estimer le niveau actuel sans double compte. Mis à jour automatiquement par `update({jobLevel})`.
   */
  jobLevelUpdatedAt: number
  /** Famille travaillée en priorité. */
  family: FamilyId
  /** Monture visée (id d'espèce) pour le plan d'élevage, ou null. */
  goalSpeciesId: number | null
  /** Utiliser les prix par défaut issus de la recherche quand aucun prix n'est saisi. */
  useDefaultPrices: boolean
  /** Serveur de jeu (pour se souvenir des prix). */
  server: string
  /** Objectif principal : kamas, succès de générations, ou les deux. */
  goal: Goal
  /** Tier de jauge que le joueur accepte d'entretenir (1 = économique … 4 = rapide). */
  preferredTier: FuelTier
  /** Activer la Mangeoire en complément quand c'est possible. */
  xpFiller: boolean
  /** Nombre de personnages qui lancent un filet à chaque combat de capture (un filet par personnage et par combat). */
  accounts: number
  /** Heures de jeu disponibles par jour (estimations de calendrier : sessions, jours réels). */
  hoursPerDay: number
  /** Intervalle minimum (min) entre deux passages devant les enclos = durée minimale visée d'une étape de plan d'enclos. */
  checkIntervalMinutes: number
  /** Niveau visé pour les parents avant accouplement (recherche : ~40 est le meilleur compromis). */
  parentTargetLevel: number
  /** Utiliser une Optimakina dès que la génération cible le justifie. */
  useOptimakina: boolean
  /** Taux de taxe HDV appliqué aux ventes (ex. 0.02). */
  saleTax: number
  /**
   * Appliquer aux plans d'enclos le doublement Almanax d'une jauge (« effet doublé », non vérifié en jeu,
   * research §4.12) : seulement les ticks du jour Almanax (heure de Paris). Désactivé par défaut : les
   * poussées de sérénité sont alors calculées au rythme normal.
   */
  almanaxGaugeDoubling: boolean
  /**
   * Mode de rentabilité suivi par les conseils (`auto`, `rush-corne`, `rush-ambre`, `rush-neurone`,
   * `brisage-pa`, `brisage-pm`, `vente-montures`, `progression`). Ajouté sans changement de version :
   * champ absent (profil migré, ancienne sauvegarde) → `progression`, le comportement d'avant les modes.
   */
  mode: ProfileMode
}

export const DEFAULT_SETTINGS: Settings = {
  ruleset: '3.6',
  jobLevel: 1,
  jobLevelUpdatedAt: 0,
  family: 'muldo',
  goalSpeciesId: null,
  useDefaultPrices: true,
  server: '',
  goal: 'profit',
  preferredTier: 2,
  xpFiller: true,
  accounts: 1,
  hoursPerDay: 3,
  checkIntervalMinutes: 60,
  parentTargetLevel: 40,
  useOptimakina: true,
  saleTax: 0.02,
  almanaxGaugeDoubling: false,
  mode: 'progression',
}

/** Bornes des réglages numériques (mêmes bornes que les champs de la page Réglages). */
export const SETTINGS_BOUNDS = {
  jobLevel: { min: 1, max: 200, int: true },
  accounts: { min: 1, max: 8, int: true },
  hoursPerDay: { min: 0.5, max: 24, int: false },
  checkIntervalMinutes: { min: 5, max: 1440, int: true },
  parentTargetLevel: { min: 1, max: MOUNT_MAX_LEVEL, int: true },
  saleTax: { min: 0, max: 0.2, int: false },
} as const

const GOALS: Goal[] = ['profit', 'succes', 'mixte']
const TIERS: FuelTier[] = [1, 2, 3, 4]

const SETTING_LABELS: Partial<Record<keyof Settings, string>> = {
  ruleset: 'version des règles',
  jobLevel: 'niveau d’Éleveur',
  family: 'famille',
  goalSpeciesId: 'monture visée',
  goal: 'objectif',
  preferredTier: 'palier préféré',
  accounts: 'personnages',
  hoursPerDay: 'temps de jeu',
  checkIntervalMinutes: 'passage aux enclos',
  parentTargetLevel: 'niveau visé des parents',
  saleTax: 'taxe HDV',
  jobLevelUpdatedAt: 'date du niveau d’Éleveur',
  mode: 'mode de rentabilité',
}

/**
 * Migration des réglages depuis une version antérieure (jamais de perte) :
 *  - v0/v1 → v2 : champs manquants complétés par les valeurs par défaut (fait par `sanitizeSettings`) ;
 *  - v2 → v3 : `jobLevelUpdatedAt` ajouté. Un niveau déjà saisi (> 1) est daté de la migration, pour ne
 *    pas lui ajouter l'XP d'un journal qu'il inclut peut-être déjà ; un niveau 1 compte tout le journal.
 *  - `mode` (modes de rentabilité, v2) : ajouté sans changement de version, comme `almanaxGaugeDoubling` :
 *    absent → `progression` (comportement d'avant les modes) par `sanitizeSettings`, valeur inconnue
 *    corrigée et signalée.
 */
export function migrateSettings(raw: unknown, fromVersion: number, now: number = Date.now()): unknown {
  if (!isPlainObject(raw)) return raw
  const next: Record<string, unknown> = { ...raw }
  if (fromVersion < 3 && !isFiniteNumber(next.jobLevelUpdatedAt)) next.jobLevelUpdatedAt = isFiniteNumber(next.jobLevel) && next.jobLevel > 1 ? now : 0
  return next
}

/**
 * Réglages complets et valides : chaque champ inconnu, absent ou invalide prend la valeur par défaut,
 * les nombres sont bornés. Les champs ajoutés plus tard à `DEFAULT_SETTINGS` sont conservés tant que leur
 * type correspond à celui de la valeur par défaut.
 */
export function sanitizeSettings(raw: unknown, now: number = Date.now()): Sanitized<Settings> {
  const src = isPlainObject(raw) ? raw : {}
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  const fixed = new Set<string>()
  const special = new Set<string>(['ruleset', 'family', 'goal', 'preferredTier', 'goalSpeciesId', 'jobLevelUpdatedAt', 'mode', ...Object.keys(SETTINGS_BOUNDS)])
  // 1. Champs simples (booléens, texte, et tout champ ajouté plus tard) : même type que la valeur par défaut.
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (special.has(k) || !(k in src)) continue
    if (typeof src[k] === typeof DEFAULT_SETTINGS[k]) out[k] = src[k]
    else fixed.add(k)
  }
  // 2. Énumérations.
  const oneOf = (k: keyof Settings, ok: (v: unknown) => boolean) => {
    if (!(k in src)) return
    if (ok(src[k])) out[k] = src[k]
    else fixed.add(k)
  }
  oneOf('ruleset', (v) => typeof v === 'string' && Object.hasOwn(RULESETS, v))
  oneOf('family', (v) => typeof v === 'string' && (FAMILY_IDS as string[]).includes(v))
  oneOf('goal', (v) => typeof v === 'string' && (GOALS as string[]).includes(v))
  oneOf('preferredTier', (v) => typeof v === 'number' && (TIERS as number[]).includes(v))
  oneOf('goalSpeciesId', (v) => v === null || (typeof v === 'number' && Number.isInteger(v) && getSpecies(v) !== undefined))
  oneOf('mode', (v) => typeof v === 'string' && Object.hasOwn(PROFILE_MODE_SET, v))
  // 3. Nombres bornés.
  for (const [k, b] of Object.entries(SETTINGS_BOUNDS)) {
    if (!(k in src)) continue
    const v = bounded(src[k], b.min, b.max, b.int)
    if (v === undefined) fixed.add(k)
    else {
      if (v !== src[k]) fixed.add(k)
      out[k] = v
    }
  }
  // 4. Date du niveau d'Éleveur (voir migrateSettings).
  const stamp = src.jobLevelUpdatedAt
  if (isFiniteNumber(stamp) && stamp >= 0) out.jobLevelUpdatedAt = stamp
  else {
    if ('jobLevelUpdatedAt' in src) fixed.add('jobLevelUpdatedAt')
    out.jobLevelUpdatedAt = (out.jobLevel as number) > 1 ? now : 0
  }
  if (typeof out.server === 'string' && out.server.length > 40) out.server = out.server.slice(0, 40)
  const issues: string[] = []
  if (fixed.size) {
    const names = [...fixed].map((k) => SETTING_LABELS[k as keyof Settings] ?? k)
    issues.push(`${s(fixed.size, 'réglage invalide corrigé', 'réglages invalides corrigés')} (${names.join(', ')}) : valeur par défaut ou ramenée dans les bornes`)
  }
  return { state: out as unknown as Settings, issues }
}

// ---------- Montures ----------

const GENDERS: Gender[] = ['male', 'femelle']
const FERTILITIES: Fertility[] = ['fertile', 'feconde', 'sterile', 'senile']
const ABILITIES = Object.keys(ABILITY_LABELS) as Ability[]

function speciesIdList(v: unknown, max: number): number[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && getSpecies(x) !== undefined).slice(0, max)
}

function sanitizeLocation(v: unknown): MountLocation | undefined {
  if (!isPlainObject(v)) return undefined
  if (v.kind === 'etable' || v.kind === 'inventaire') return { kind: v.kind }
  if (v.kind === 'enclos' && typeof v.paddock === 'number' && Number.isInteger(v.paddock) && v.paddock >= 1 && v.paddock <= MAX_PADDOCKS)
    return { kind: 'enclos', paddock: v.paddock }
  return undefined
}

/**
 * Monture utilisable, ou null si elle est inutilisable (pas un objet, espèce inconnue). Les champs
 * invalides prennent une valeur neutre (`fixed` = vrai) : sexe ♂, niveau 1, fertile, étable, jauges 0.
 * Les champs supplémentaires inconnus sont conservés tels quels.
 */
export function sanitizeMount(raw: unknown): { mount: Mount; fixed: boolean } | null {
  if (!isPlainObject(raw)) return null
  const speciesId = typeof raw.speciesId === 'string' && /^\d+$/.test(raw.speciesId) ? Number(raw.speciesId) : raw.speciesId
  if (typeof speciesId !== 'number' || !Number.isInteger(speciesId) || getSpecies(speciesId) === undefined) return null
  let fixed = false
  const pick = <T>(value: T | undefined, fallback: T, present: boolean): T => {
    if (value === undefined) {
      if (present) fixed = true
      return fallback
    }
    return value
  }
  const id = typeof raw.id === 'string' && raw.id ? raw.id : typeof raw.id === 'number' && Number.isFinite(raw.id) ? String(raw.id) : undefined
  if (id === undefined) fixed = true
  const gender = pick(GENDERS.includes(raw.gender as Gender) ? (raw.gender as Gender) : undefined, 'male', true)
  const level = pick(bounded(raw.level, 1, MOUNT_MAX_LEVEL, true), 1, true)
  if (isFiniteNumber(raw.level) && raw.level !== level) fixed = true
  const stat = (k: 'endurance' | 'maturity' | 'love') => {
    const v = bounded(raw[k], 0, MOUNT_STAT_MAX)
    if (v === undefined ? k in raw : v !== raw[k]) fixed = true
    return v ?? 0
  }
  const serenityValue = bounded(raw.serenity, SERENITY_MIN, SERENITY_MAX)
  if (serenityValue === undefined ? 'serenity' in raw : serenityValue !== raw.serenity) fixed = true
  const parents = speciesIdList(raw.parents, 2)
  if (parents === undefined || (Array.isArray(raw.parents) && parents.length !== raw.parents.length)) fixed = true
  const mount: Mount = {
    ...(raw as Partial<Mount>),
    id: id ?? freshId('m'),
    speciesId,
    gender,
    level,
    ability: raw.ability === null || raw.ability === undefined ? null : ABILITIES.includes(raw.ability as Ability) ? (raw.ability as Ability) : pick<Ability | null>(undefined, null, true),
    fertility: pick(FERTILITIES.includes(raw.fertility as Fertility) ? (raw.fertility as Fertility) : undefined, 'fertile', true),
    parents: parents ?? [],
    location: pick(sanitizeLocation(raw.location), { kind: 'etable' }, true),
    serenity: serenityValue ?? 0,
    endurance: stat('endurance'),
    maturity: stat('maturity'),
    love: stat('love'),
    createdAt: isFiniteNumber(raw.createdAt) ? raw.createdAt : 0,
    updatedAt: isFiniteNumber(raw.updatedAt) ? raw.updatedAt : 0,
  }
  if (mount.xp !== undefined && !(isFiniteNumber(mount.xp) && mount.xp >= 0)) {
    delete mount.xp
    fixed = true
  }
  if (mount.grandparents !== undefined) {
    const gp = speciesIdList(mount.grandparents, 4)
    if (gp === undefined) {
      delete mount.grandparents
      fixed = true
    } else mount.grandparents = gp
  }
  for (const k of ['name', 'notes'] as const)
    if (mount[k] !== undefined && typeof mount[k] !== 'string') {
      delete mount[k]
      fixed = true
    }
  return { mount, fixed }
}

/** État persisté de l'inventaire, normalisé (montures inutilisables écartées, identifiants uniques). */
export function sanitizeInventory(raw: unknown): Sanitized<{ mounts: Mount[] }> {
  const src = isPlainObject(raw) ? raw.mounts : undefined
  const list: unknown[] = Array.isArray(src) ? src : isPlainObject(src) ? Object.values(src) : []
  const issues: string[] = []
  if (src !== undefined && !Array.isArray(src)) issues.push(isPlainObject(src) ? 'liste des montures convertie (objet au lieu d’une liste)' : 'liste des montures illisible')
  const mounts: Mount[] = []
  const seen = new Set<string>()
  let dropped = 0
  let fixed = 0
  for (const x of list) {
    const r = sanitizeMount(x)
    if (!r) {
      dropped++
      continue
    }
    let m = r.mount
    if (seen.has(m.id)) {
      m = { ...m, id: freshId('m') }
      r.fixed = true
    }
    seen.add(m.id)
    if (r.fixed) fixed++
    mounts.push(m)
  }
  if (dropped) issues.push(`${s(dropped, 'monture inutilisable ignorée', 'montures inutilisables ignorées')} (espèce inconnue ou donnée illisible)`)
  if (fixed) issues.push(`${s(fixed, 'monture corrigée', 'montures corrigées')} (champs invalides remplacés par une valeur neutre : vérifiez-les)`)
  return { state: { mounts }, issues }
}

// ---------- Prix ----------

export interface PricesData {
  items: Record<string, number>
  mounts: Record<string, number>
  generations: Record<string, number>
  genetonValue: number | null
  updatedAt: number
}

function priceRecord(v: unknown): { rec: Record<string, number>; dropped: number } {
  const rec: Record<string, number> = {}
  let dropped = 0
  if (!isPlainObject(v)) return { rec, dropped: v === undefined ? 0 : 1 }
  for (const [k, p] of Object.entries(v)) {
    if (isFiniteNumber(p) && p >= 0) rec[k] = p
    else dropped++
  }
  return { rec, dropped }
}

/** Prix saisis, normalisés : un prix invalide (négatif, non numérique) est retiré, jamais remplacé par 0. */
export function sanitizePrices(raw: unknown): Sanitized<PricesData> {
  const src = isPlainObject(raw) ? raw : {}
  const items = priceRecord(src.items)
  const mounts = priceRecord(src.mounts)
  const generations = priceRecord(src.generations)
  let dropped = items.dropped + mounts.dropped + generations.dropped
  let genetonValue: number | null = null
  if (isFiniteNumber(src.genetonValue) && src.genetonValue >= 0) genetonValue = src.genetonValue
  else if (src.genetonValue !== undefined && src.genetonValue !== null) dropped++
  const issues = dropped ? [`${s(dropped, 'prix invalide retiré', 'prix invalides retirés')} (à ressaisir)`] : []
  return {
    state: { items: items.rec, mounts: mounts.rec, generations: generations.rec, genetonValue, updatedAt: isFiniteNumber(src.updatedAt) ? src.updatedAt : 0 },
    issues,
  }
}

// ---------- Journal ----------

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isNum = isFiniteNumber
const isStr = (v: unknown): v is string => typeof v === 'string'

/** Champs obligatoires de chaque type d'entrée du journal. */
const JOURNAL_FIELDS: Record<JournalEntry['kind'], Record<string, (v: unknown) => boolean>> = {
  capture: { speciesId: isInt, count: (v) => isNum(v) && v >= 0 },
  accouplement: {
    parentA: isInt,
    parentB: isInt,
    babies: (v) => Array.isArray(v) && v.every(isInt),
    targetGeneration: isNum,
    targetChance: isNum,
    genetons: isNum,
    jobXp: isNum,
  },
  clonage: { speciesA: isInt, speciesB: isInt, kept: isInt },
  extraction: { speciesId: isInt, quantity: isNum, resourceItemId: isInt },
  vente: { label: isStr, amount: isNum },
  achat: { label: isStr, amount: isNum },
  craft: { itemId: isInt, count: isNum, jobXp: isNum },
  note: { text: isStr },
}

/** Journal normalisé : les entrées illisibles (type inconnu, champ obligatoire invalide) sont écartées. */
export function sanitizeJournal(raw: unknown): Sanitized<{ entries: JournalEntry[] }> {
  const src = isPlainObject(raw) ? raw.entries : undefined
  const list: unknown[] = Array.isArray(src) ? src : []
  const issues: string[] = []
  if (src !== undefined && !Array.isArray(src)) issues.push('journal illisible')
  const entries: JournalEntry[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const x of list) {
    if (!isPlainObject(x) || typeof x.kind !== 'string' || !(x.kind in JOURNAL_FIELDS) || !isNum(x.at)) {
      dropped++
      continue
    }
    const fields = JOURNAL_FIELDS[x.kind as JournalEntry['kind']]
    if (!Object.entries(fields).every(([k, ok]) => ok(x[k]))) {
      dropped++
      continue
    }
    const e: Record<string, unknown> = { ...x }
    if (x.kind === 'accouplement' && e.makina !== null && typeof e.makina !== 'string') e.makina = null
    if (x.kind === 'capture' && e.netItemId !== undefined && e.netItemId !== null && !isInt(e.netItemId)) e.netItemId = null
    let id = typeof x.id === 'string' && x.id ? x.id : freshId('j')
    if (seen.has(id)) id = freshId('j')
    seen.add(id)
    e.id = id
    entries.push(e as unknown as JournalEntry)
  }
  if (dropped) issues.push(`${s(dropped, 'entrée illisible ignorée', 'entrées illisibles ignorées')}`)
  return { state: { entries }, issues }
}

// ---------- Marché (export HDV, par serveur) ----------

export interface MarketData {
  /** Instantané courant des prix du marché du serveur (null = aucun import). */
  snapshot: MarketSnapshot | null
}

/** Marché normalisé : lignes invalides retirées (jamais remplacées par 0) ; instantané illisible → aucun. */
export function sanitizeMarketState(raw: unknown): Sanitized<MarketData> {
  const src = isPlainObject(raw) ? raw.snapshot : undefined
  if (src === undefined || src === null) return { state: { snapshot: null }, issues: [] }
  const r = sanitizeSnapshot(src)
  if (!r.snapshot) return { state: { snapshot: null }, issues: ['instantané de marché illisible ignoré (réimportez l’export HDV)'] }
  return { state: { snapshot: r.snapshot }, issues: r.issues }
}

export interface MarketHistoryData {
  entries: MarketHistoryEntry[]
}

/** Historique des imports normalisé (entrées illisibles retirées). */
export function sanitizeMarketHistoryState(raw: unknown): Sanitized<MarketHistoryData> {
  const r = sanitizeHistory(raw)
  return { state: { entries: r.entries }, issues: r.dropped ? [`${s(r.dropped, 'entrée d’historique illisible ignorée', 'entrées d’historique illisibles ignorées')}`] : [] }
}

// ---------- Registre ----------

/** Migration (jamais de perte) et normalisation propres à un store ; absentes = état gardé tel quel. */
export interface StoreSchema {
  migrate?: (raw: unknown, fromVersion: number) => unknown
  sanitize?: (raw: unknown) => Sanitized<Record<string, unknown>>
}

const asRecord = <T>(f: (raw: unknown) => Sanitized<T>) => (raw: unknown) => f(raw) as unknown as Sanitized<Record<string, unknown>>

/** Schémas connus, par base de clé (les autres stores ne sont que vérifiés dans leur forme `{state, version}`). */
export const STORE_SCHEMAS: Record<string, StoreSchema> = {
  settings: { migrate: (raw, from) => migrateSettings(raw, from), sanitize: asRecord((raw) => sanitizeSettings(raw)) },
  inventory: { sanitize: sanitizeInventory },
  prices: { sanitize: asRecord(sanitizePrices) },
  journal: { sanitize: sanitizeJournal },
  market: { sanitize: asRecord(sanitizeMarketState) },
  'market-history': { sanitize: asRecord(sanitizeMarketHistoryState) },
}

/**
 * Déclare la normalisation d'un store défini ailleurs (enclos, plans d'enclos, avancement du plan :
 * leurs sanitizers vivent avec le store, qui importe ce module) pour que l'import d'une sauvegarde
 * (`normalizeStoreValue`) l'applique aussi. Appelé par le module du store à son chargement, avec la
 * base (« paddocks ») ou une clé de ce store (profil actif ou ancienne clé).
 */
export function registerStoreSchema(keyOrBase: string, schema: StoreSchema): void {
  const base = keyOrBase.startsWith(STORAGE_PREFIX) ? (parseStoreKey(keyOrBase)?.base ?? keyOrBase) : keyOrBase
  STORE_SCHEMAS[base] = schema
}

export type StoreValueCheck =
  | { ok: true; value: { state: Record<string, unknown>; version: number }; issues: string[] }
  | { ok: false; error: string }

/**
 * Valeur persistée `{state, version}` d'un store connu (n'importe quel profil ou serveur, ou ancienne
 * clé), amenée à la version actuelle (migration) puis normalisée. Refuse une version plus récente que
 * celle de l'application (elle ne saurait pas la lire sans perte) et une structure inattendue.
 */
export function normalizeStoreValue(key: string, value: unknown): StoreValueCheck {
  const info = persistedStoreInfo(key)
  const label = info?.label ?? key
  if (!isPlainObject(value) || !isPlainObject(value.state)) return { ok: false, error: `Données « ${label} » invalides (structure inattendue).` }
  if (value.version !== undefined && (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 0))
    return { ok: false, error: `Données « ${label} » invalides (version non numérique).` }
  const current = info?.version ?? 0
  const from = typeof value.version === 'number' ? value.version : current
  if (info && from > current)
    return {
      ok: false,
      error: `Données « ${label} » créées par une version plus récente de l’application (format v${from}, cette version lit jusqu’à v${current}) : mettez-la à jour (rechargez la page) avant d’importer.`,
    }
  const schema = info ? STORE_SCHEMAS[info.base] : undefined
  if (!schema) {
    // Store sans migration déclarée : une version plus ancienne est reprise telle quelle (migration
    // identité), sinon persist l'ignorerait au chargement.
    const issues = info && from < current ? [`format v${from} repris tel quel dans le format v${current}`] : []
    return { ok: true, value: { state: value.state, version: info ? current : from }, issues }
  }
  let state: unknown = value.state
  if (from < current && schema.migrate) state = schema.migrate(state, from)
  if (!schema.sanitize) return { ok: true, value: { state: isPlainObject(state) ? state : {}, version: current }, issues: [] }
  const r = schema.sanitize(state)
  return { ok: true, value: { state: r.state, version: current }, issues: r.issues }
}
