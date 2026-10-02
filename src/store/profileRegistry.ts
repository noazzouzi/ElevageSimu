// Registre des profils et des serveurs (« elevagesimu:profiles ») : types, normalisation, opérations
// pures (créer, dupliquer, renommer, supprimer, changer de serveur…), migration des données d'avant
// les profils et démarrage. Module pur : il ne lit que le stockage qu'on lui passe (`StorageLike`),
// jamais le navigateur directement — testable avec un faux stockage. Le store zustand et les clés du
// profil actif sont dans src/store/profiles.ts. Spécification : docs/SPEC-v2.md §2, docs/api/profiles.md.
import { DEFAULT_MAX_MARKET_SHARE, PRICE_STATS, slugify, type PriceStat } from '../domain/market'
import {
  GLOBAL_KEYS,
  LEGACY_STORE_KEYS,
  PROFILES_CORRUPT_KEY,
  PROFILES_KEY,
  PROFILES_SHADOW_KEY,
  STORAGE_PREFIX,
  isPlainObject,
  isValidScopeId,
  parseStoreKey,
  profileKeyPrefix,
  profileStoreKey,
  serverKeyPrefix,
  serverStoreKey,
  type StorageLike,
} from './schema'

export const REGISTRY_VERSION = 1
export const DEFAULT_PROFILE_ID = 'principal'
export const DEFAULT_PROFILE_NAME = 'Principal'
export const DEFAULT_SERVER_NAME = 'Mon serveur'
/** Longueur maximale d'un nom de profil ou de serveur. */
export const NAME_MAX = 40

/** Couleurs de repère d'un profil (variables CSS du thème). */
export const PROFILE_COLORS = ['accent', 'gold', 'info', 'ok', 'warn', 'danger'] as const
export type ProfileColor = (typeof PROFILE_COLORS)[number]

export interface ServerEntry {
  id: string
  name: string
  createdAt: number
  /** Statistique de prix des imports HDV de ce serveur (défaut `auto`). */
  priceStat: PriceStat
  /** Part du volume quotidien moyen qu'une production peut vendre (défaut 15 %). */
  maxMarketShare: number
}

export interface ProfileEntry {
  id: string
  name: string
  serverId: string
  createdAt: number
  color?: ProfileColor
  /**
   * Serveur deviné lors d'une reconstruction du registre (registre perdu ou illisible) : à confirmer par le
   * joueur (badge « serveur à vérifier » dans Réglages › Profils ; effacé dès que son serveur est choisi).
   */
  serverToCheck?: true
}

/** Empreinte d'une valeur (longueur + FNV-1a 32 bits) : détecte une modification sans garder de copie. */
export interface LegacyFingerprint {
  len: number
  hash: number
}

/** Copie des données d'avant les profils, gardée après la migration jusqu'à confirmation. */
export interface LegacyCopyInfo {
  migratedAt: number
  /** Anciennes clés reprises dans le profil « Principal ». */
  keys: string[]
  /** Anciennes clés déplacées (et non copiées) faute de place : il n'en reste pas de copie. */
  moved: string[]
  /** Instant où la copie a été supprimée (0 = encore présente). */
  removedAt: number
  /**
   * Empreinte de chaque ancienne clé copiée, au moment de la reprise : une valeur qui ne correspond plus a
   * été réécrite par un onglet resté sur l'ancienne version (`legacyDivergence`). Absent pour une reprise
   * faite avant l'ajout des empreintes.
   */
  fingerprints?: Record<string, LegacyFingerprint>
}

export interface ProfilesRegistry {
  version: number
  /** Profil ouvert au prochain chargement de l'application. */
  activeProfileId: string
  profiles: ProfileEntry[]
  servers: ServerEntry[]
  legacy?: LegacyCopyInfo
}

export type RegistryResult = { ok: true; registry: ProfilesRegistry; id: string } | { ok: false; error: string }

// ---------- Noms et identifiants ----------

const normName = (s: string) => slugify(s)

/** Nom nettoyé (espaces, longueur) ou message d'erreur. */
export function checkName(raw: string, what: 'profil' | 'serveur'): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.replace(/\s+/g, ' ').trim()
  if (!name) return { ok: false, error: `Donnez un nom au ${what}.` }
  if (name.length > NAME_MAX) return { ok: false, error: `Nom trop long (${NAME_MAX} caractères au plus).` }
  return { ok: true, name }
}

/** Identifiant libre dérivé d'un nom (« Tylezia » → « tylezia », « tylezia-2 » si pris). */
export function freeId(name: string, taken: Iterable<string>, fallback: string): string {
  const used = new Set(taken)
  const base = (slugify(name) || fallback).slice(0, 40).replace(/-+$/, '') || fallback
  if (!used.has(base)) return base
  for (let i = 2; ; i++) {
    const id = `${base}-${i}`
    if (!used.has(id)) return id
  }
}

export const serverById = (r: ProfilesRegistry, id: string) => r.servers.find((x) => x.id === id)
export const profileById = (r: ProfilesRegistry, id: string) => r.profiles.find((x) => x.id === id)
export const profilesOnServer = (r: ProfilesRegistry, serverId: string) => r.profiles.filter((p) => p.serverId === serverId)
/** Serveur portant ce nom (casse et accents ignorés). */
export const serverByName = (r: ProfilesRegistry, name: string) => r.servers.find((x) => normName(x.name) === normName(name))

/** Profil actif (le premier si l'identifiant est inconnu). */
export function activeProfileOf(r: ProfilesRegistry): ProfileEntry {
  return profileById(r, r.activeProfileId) ?? r.profiles[0]
}

// ---------- Normalisation ----------

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function sanitizeServer(raw: unknown): ServerEntry | null {
  if (!isPlainObject(raw) || !isValidScopeId(raw.id)) return null
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, NAME_MAX) : `Serveur ${raw.id}`
  const share = finite(raw.maxMarketShare) ? Math.min(1, Math.max(0.01, raw.maxMarketShare)) : DEFAULT_MAX_MARKET_SHARE
  return {
    id: raw.id,
    name,
    createdAt: finite(raw.createdAt) ? raw.createdAt : 0,
    priceStat: (PRICE_STATS as unknown[]).includes(raw.priceStat) ? (raw.priceStat as PriceStat) : 'auto',
    maxMarketShare: share,
  }
}

/**
 * Registre normalisé. `registry: null` si la donnée est inutilisable (pas un objet, aucun profil) ;
 * `newer` si elle vient d'une version plus récente de l'application (à ne pas réécrire).
 */
export function sanitizeRegistry(raw: unknown): { registry: ProfilesRegistry | null; issues: string[]; newer: boolean } {
  if (!isPlainObject(raw)) return { registry: null, issues: ['registre des profils illisible'], newer: false }
  const version = finite(raw.version) && Number.isInteger(raw.version) && raw.version >= 1 ? raw.version : null
  if (version === null) return { registry: null, issues: ['registre des profils sans version'], newer: false }
  const newer = version > REGISTRY_VERSION
  const issues: string[] = []
  const servers: ServerEntry[] = []
  for (const s of Array.isArray(raw.servers) ? raw.servers : []) {
    const v = sanitizeServer(s)
    if (!v || servers.some((x) => x.id === v.id)) issues.push('serveur illisible ou en double ignoré')
    else servers.push(v)
  }
  const profiles: ProfileEntry[] = []
  for (const p of Array.isArray(raw.profiles) ? raw.profiles : []) {
    if (!isPlainObject(p) || !isValidScopeId(p.id) || profiles.some((x) => x.id === p.id)) {
      issues.push('profil illisible ou en double ignoré')
      continue
    }
    let serverId = isValidScopeId(p.serverId) ? p.serverId : null
    if (serverId === null) {
      serverId = servers[0]?.id ?? freeId(DEFAULT_SERVER_NAME, [], 'serveur')
      issues.push(`serveur du profil « ${String(p.name ?? p.id)} » illisible : rattaché à un autre serveur`)
    }
    if (!servers.some((x) => x.id === serverId)) {
      // Données du serveur peut-être présentes (clés « s:<id>: ») : on recrée son entrée.
      servers.push({ id: serverId, name: `Serveur ${serverId}`, createdAt: 0, priceStat: 'auto', maxMarketShare: DEFAULT_MAX_MARKET_SHARE })
      issues.push(`serveur « ${serverId} » recréé`)
    }
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, NAME_MAX) : `Profil ${p.id}`
    const entry: ProfileEntry = { id: p.id, name, serverId, createdAt: finite(p.createdAt) ? p.createdAt : 0 }
    if ((PROFILE_COLORS as readonly unknown[]).includes(p.color)) entry.color = p.color as ProfileColor
    if (p.serverToCheck === true) entry.serverToCheck = true
    profiles.push(entry)
  }
  if (!profiles.length) return { registry: null, issues: [...issues, 'aucun profil lisible'], newer }
  const activeProfileId = typeof raw.activeProfileId === 'string' && profiles.some((p) => p.id === raw.activeProfileId) ? raw.activeProfileId : profiles[0].id
  if (activeProfileId !== raw.activeProfileId) issues.push('profil actif inconnu : premier profil utilisé')
  const registry: ProfilesRegistry = { version: newer ? version : REGISTRY_VERSION, activeProfileId, profiles, servers }
  const l = raw.legacy
  if (isPlainObject(l) && finite(l.migratedAt)) {
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.startsWith(STORAGE_PREFIX)) : [])
    registry.legacy = { migratedAt: l.migratedAt, keys: strs(l.keys), moved: strs(l.moved), removedAt: finite(l.removedAt) ? l.removedAt : 0 }
    if (isPlainObject(l.fingerprints)) {
      const fingerprints: Record<string, LegacyFingerprint> = {}
      for (const [k, v] of Object.entries(l.fingerprints))
        if (k.startsWith(STORAGE_PREFIX) && isPlainObject(v) && finite(v.len) && finite(v.hash)) fingerprints[k] = { len: v.len, hash: v.hash }
      registry.legacy.fingerprints = fingerprints
    }
  }
  return { registry, issues, newer }
}

// ---------- Opérations pures ----------

const err = (error: string): RegistryResult => ({ ok: false, error })

export function addServer(r: ProfilesRegistry, input: { name: string; priceStat?: PriceStat; id?: string; now?: number; taken?: Iterable<string> }): RegistryResult {
  const n = checkName(input.name, 'serveur')
  if (!n.ok) return err(n.error)
  if (serverByName(r, n.name)) return err(`Le serveur « ${n.name} » existe déjà.`)
  const id = input.id && isValidScopeId(input.id) && !serverById(r, input.id) ? input.id : freeId(n.name, [...r.servers.map((s) => s.id), ...(input.taken ?? [])], 'serveur')
  const server: ServerEntry = { id, name: n.name, createdAt: input.now ?? Date.now(), priceStat: input.priceStat ?? 'auto', maxMarketShare: DEFAULT_MAX_MARKET_SHARE }
  return { ok: true, registry: { ...r, servers: [...r.servers, server] }, id }
}

export function renameServer(r: ProfilesRegistry, id: string, name: string): RegistryResult {
  if (!serverById(r, id)) return err('Serveur introuvable.')
  const n = checkName(name, 'serveur')
  if (!n.ok) return err(n.error)
  const other = serverByName(r, n.name)
  if (other && other.id !== id) return err(`Le serveur « ${n.name} » existe déjà.`)
  return { ok: true, registry: { ...r, servers: r.servers.map((s) => (s.id === id ? { ...s, name: n.name } : s)) }, id }
}

export function setServerOptions(r: ProfilesRegistry, id: string, opts: { priceStat?: PriceStat; maxMarketShare?: number }): RegistryResult {
  if (!serverById(r, id)) return err('Serveur introuvable.')
  if (opts.priceStat !== undefined && !PRICE_STATS.includes(opts.priceStat)) return err('Statistique de prix inconnue.')
  if (opts.maxMarketShare !== undefined && !(finite(opts.maxMarketShare) && opts.maxMarketShare > 0 && opts.maxMarketShare <= 1)) return err('Part du marché invalide (entre 1 et 100 %).')
  return { ok: true, registry: { ...r, servers: r.servers.map((s) => (s.id === id ? { ...s, ...opts } : s)) }, id }
}

/** Supprime un serveur inutilisé (refus s'il porte encore un profil). */
export function removeServer(r: ProfilesRegistry, id: string): RegistryResult {
  const s = serverById(r, id)
  if (!s) return err('Serveur introuvable.')
  const users = profilesOnServer(r, id)
  if (users.length) return err(`Le serveur « ${s.name} » est utilisé par ${users.map((p) => `« ${p.name} »`).join(', ')} : changez d’abord leur serveur.`)
  return { ok: true, registry: { ...r, servers: r.servers.filter((x) => x.id !== id) }, id }
}

export function addProfile(r: ProfilesRegistry, input: { name: string; serverId: string; color?: ProfileColor; id?: string; now?: number; taken?: Iterable<string> }): RegistryResult {
  const n = checkName(input.name, 'profil')
  if (!n.ok) return err(n.error)
  if (r.profiles.some((p) => normName(p.name) === normName(n.name))) return err(`Le profil « ${n.name} » existe déjà.`)
  if (!serverById(r, input.serverId)) return err('Serveur introuvable.')
  const id = input.id && isValidScopeId(input.id) && !profileById(r, input.id) ? input.id : freeId(n.name, [...r.profiles.map((p) => p.id), ...(input.taken ?? [])], 'profil')
  const profile: ProfileEntry = { id, name: n.name, serverId: input.serverId, createdAt: input.now ?? Date.now() }
  if (input.color) profile.color = input.color
  return { ok: true, registry: { ...r, profiles: [...r.profiles, profile] }, id }
}

export function renameProfile(r: ProfilesRegistry, id: string, name: string): RegistryResult {
  if (!profileById(r, id)) return err('Profil introuvable.')
  const n = checkName(name, 'profil')
  if (!n.ok) return err(n.error)
  if (r.profiles.some((p) => p.id !== id && normName(p.name) === normName(n.name))) return err(`Le profil « ${n.name} » existe déjà.`)
  return { ok: true, registry: { ...r, profiles: r.profiles.map((p) => (p.id === id ? { ...p, name: n.name } : p)) }, id }
}

/** Change le serveur d'un profil (le même serveur confirme un serveur deviné : `serverToCheck` effacé). */
export function setProfileServer(r: ProfilesRegistry, id: string, serverId: string): RegistryResult {
  if (!profileById(r, id)) return err('Profil introuvable.')
  if (!serverById(r, serverId)) return err('Serveur introuvable.')
  const move = (p: ProfileEntry): ProfileEntry => {
    const next: ProfileEntry = { ...p, serverId }
    delete next.serverToCheck
    return next
  }
  return { ok: true, registry: { ...r, profiles: r.profiles.map((p) => (p.id === id ? move(p) : p)) }, id }
}

export function setProfileColor(r: ProfilesRegistry, id: string, color: ProfileColor | null): RegistryResult {
  if (!profileById(r, id)) return err('Profil introuvable.')
  return {
    ok: true,
    registry: {
      ...r,
      profiles: r.profiles.map((p) => {
        if (p.id !== id) return p
        const next = { ...p }
        if (color) next.color = color
        else delete next.color
        return next
      }),
    },
    id,
  }
}

/** Retire un profil du registre (refus pour le dernier) ; le profil actif passe au premier restant. */
export function removeProfile(r: ProfilesRegistry, id: string): RegistryResult {
  if (!profileById(r, id)) return err('Profil introuvable.')
  if (r.profiles.length <= 1) return err('Impossible de supprimer le dernier profil : créez-en un autre d’abord.')
  const profiles = r.profiles.filter((p) => p.id !== id)
  return { ok: true, registry: { ...r, profiles, activeProfileId: r.activeProfileId === id ? profiles[0].id : r.activeProfileId }, id }
}

export function setActiveProfile(r: ProfilesRegistry, id: string): RegistryResult {
  if (!profileById(r, id)) return err('Profil introuvable.')
  return { ok: true, registry: { ...r, activeProfileId: id }, id }
}

// ---------- Données d'un profil ou d'un serveur dans le stockage ----------

/** Clés du stockage commençant par `prefix`, triées. */
export function keysWithPrefix(storage: StorageLike, prefix: string): string[] {
  const out: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k && k.startsWith(prefix)) out.push(k)
  }
  return out.sort()
}

/** Identifiants de profils et de serveurs qui ont des données dans le stockage. */
export function idsWithData(storage: StorageLike): { profiles: Set<string>; servers: Set<string> } {
  const profiles = new Set<string>()
  const servers = new Set<string>()
  for (const k of keysWithPrefix(storage, STORAGE_PREFIX)) {
    const p = parseStoreKey(k)
    if (p?.kind === 'profile' && p.id) profiles.add(p.id)
    if (p?.kind === 'server' && p.id) servers.add(p.id)
  }
  return { profiles, servers }
}

function isQuota(e: unknown): boolean {
  return e instanceof Error && /quota/i.test(`${e.name} ${e.message}`)
}

export type CopyResult = { ok: true; copied: string[] } | { ok: false; error: string }

/**
 * Copie toutes les données d'un profil vers un autre identifiant (duplication). Tout ou rien : en cas
 * d'échec (espace plein), les copies déjà écrites sont retirées.
 */
export function copyProfileData(storage: StorageLike, fromId: string, toId: string): CopyResult {
  const written: string[] = []
  try {
    for (const k of keysWithPrefix(storage, profileKeyPrefix(fromId))) {
      const value = storage.getItem(k)
      if (value === null) continue
      const target = profileStoreKey(toId, k.slice(profileKeyPrefix(fromId).length))
      storage.setItem(target, value)
      written.push(target)
    }
  } catch (e) {
    for (const k of written) storage.removeItem(k)
    return { ok: false, error: isQuota(e) ? 'Espace de stockage du navigateur insuffisant pour dupliquer ce profil : libérez de la place (Réglages › Données : résultats recalculables des modes, journal ancien) ou supprimez un profil.' : 'Écriture impossible dans le stockage du navigateur.' }
  }
  return { ok: true, copied: written }
}

/** Efface toutes les données d'un profil ; renvoie les clés effacées. */
export function removeProfileData(storage: StorageLike, id: string): string[] {
  const keys = keysWithPrefix(storage, profileKeyPrefix(id))
  for (const k of keys) storage.removeItem(k)
  return keys
}

/** Efface toutes les données d'un serveur (prix, marché, historique) ; renvoie les clés effacées. */
export function removeServerData(storage: StorageLike, id: string): string[] {
  const keys = keysWithPrefix(storage, serverKeyPrefix(id))
  for (const k of keys) storage.removeItem(k)
  return keys
}

/**
 * Contenu d'un profil dans le stockage (pour les listes de profils). `chars` : place occupée, en caractères
 * (clés + valeurs), l'unité du quota du localStorage (voir `storageUsage`, src/lib/backup.ts).
 */
export function profileDataSummary(storage: StorageLike, id: string): { mounts: number | null; journal: number | null; jobLevel: number | null; chars: number } {
  const read = (base: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(storage.getItem(profileStoreKey(id, base)) ?? 'null') as unknown
      return isPlainObject(v) && isPlainObject(v.state) ? v.state : null
    } catch {
      return null
    }
  }
  const inv = read('inventory')
  const journal = read('journal')
  const settings = read('settings')
  let chars = 0
  for (const k of keysWithPrefix(storage, profileKeyPrefix(id))) chars += k.length + (storage.getItem(k)?.length ?? 0)
  return {
    mounts: inv && Array.isArray(inv.mounts) ? inv.mounts.length : null,
    journal: journal && Array.isArray(journal.entries) ? journal.entries.length : null,
    jobLevel: settings && finite(settings.jobLevel) ? settings.jobLevel : null,
    chars,
  }
}

/** Dernier import HDV d'un serveur (métadonnées seulement), ou null. */
export function serverMarketMeta(storage: StorageLike, serverId: string): { exportDate: string; importedAt: number; source: string; useful: number; serverName: string } | null {
  try {
    const v = JSON.parse(storage.getItem(serverStoreKey(serverId, 'market')) ?? 'null') as unknown
    const snap = isPlainObject(v) && isPlainObject(v.state) && isPlainObject(v.state.snapshot) ? v.state.snapshot : null
    if (!snap) return null
    const stats = isPlainObject(snap.stats) ? snap.stats : {}
    return {
      exportDate: typeof snap.exportDate === 'string' ? snap.exportDate : '',
      importedAt: finite(snap.importedAt) ? snap.importedAt : 0,
      source: typeof snap.source === 'string' ? snap.source : '',
      useful: finite(stats.useful) ? stats.useful : isPlainObject(snap.rows) ? Object.keys(snap.rows).length : 0,
      serverName: typeof snap.serverName === 'string' ? snap.serverName : '',
    }
  } catch {
    return null
  }
}

// ---------- Migration des données d'avant les profils ----------

/** Anciennes clés (« elevagesimu:<base> ») présentes dans le stockage, hors clés globales. */
export function legacyKeys(storage: StorageLike): string[] {
  return keysWithPrefix(storage, STORAGE_PREFIX).filter((k) => parseStoreKey(k)?.kind === 'legacy' && !GLOBAL_KEYS.includes(k))
}

/** Nom du serveur noté dans les anciens réglages (« Mon serveur » sinon). */
export function legacyServerName(storage: StorageLike): string {
  try {
    const v = JSON.parse(storage.getItem(LEGACY_STORE_KEYS.settings) ?? 'null') as unknown
    const name = isPlainObject(v) && isPlainObject(v.state) && typeof v.state.server === 'string' ? v.state.server.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : ''
    return name || DEFAULT_SERVER_NAME
  } catch {
    return DEFAULT_SERVER_NAME
  }
}

/** Nouvelle clé d'une ancienne clé : prix → serveur ; tout le reste → profil. */
export function migratedKey(legacyKey: string, profileId: string, serverId: string): string | null {
  const p = parseStoreKey(legacyKey)
  if (!p || p.kind !== 'legacy') return null
  return p.base === 'prices' ? serverStoreKey(serverId, 'prices') : profileStoreKey(profileId, p.base)
}

/** Registre neuf : un profil « Principal » sur un serveur. */
export function defaultRegistry(now: number, serverName = DEFAULT_SERVER_NAME): ProfilesRegistry {
  const serverId = freeId(serverName, [], 'serveur')
  return {
    version: REGISTRY_VERSION,
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: [{ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, serverId, createdAt: now }],
    servers: [{ id: serverId, name: serverName, createdAt: now, priceStat: 'auto', maxMarketShare: DEFAULT_MAX_MARKET_SHARE }],
  }
}

/** Hachage FNV-1a 32 bits d'un texte (unités UTF-16). */
export function hashText(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Empreinte d'une valeur stockée. */
export function fingerprintOf(value: string): LegacyFingerprint {
  return { len: value.length, hash: hashText(value) }
}

/** Registre existant complété d'un profil « Principal » (et de son serveur, d'après les anciens réglages). */
function registryWithPrincipal(storage: StorageLike, base: ProfilesRegistry, now: number): ProfilesRegistry {
  if (profileById(base, DEFAULT_PROFILE_ID)) return { ...base, profiles: [...base.profiles], servers: [...base.servers] }
  const serverName = legacyServerName(storage)
  let reg: ProfilesRegistry = { ...base, profiles: [...base.profiles], servers: [...base.servers] }
  let server = serverByName(reg, serverName)
  if (!server) {
    const id = freeId(serverName, [...reg.servers.map((s) => s.id), ...idsWithData(storage).servers], 'serveur')
    server = { id, name: serverName, createdAt: now, priceStat: 'auto', maxMarketShare: DEFAULT_MAX_MARKET_SHARE }
    reg = { ...reg, servers: [...reg.servers, server] }
  }
  let name = DEFAULT_PROFILE_NAME
  for (let i = 2; reg.profiles.some((p) => normName(p.name) === normName(name)); i++) name = `${DEFAULT_PROFILE_NAME} (${i})`
  return { ...reg, profiles: [...reg.profiles, { id: DEFAULT_PROFILE_ID, name, serverId: server.id, createdAt: now }] }
}

export type MigrationResult =
  | { ok: true; registry: ProfilesRegistry; copied: string[]; moved: string[] }
  | { ok: false; error: string }

/**
 * Première ouverture de la v2 : les anciennes clés deviennent le profil « Principal » sur un serveur nommé
 * d'après les anciens réglages (« Mon serveur » sinon) ; les anciens prix vont à ce serveur. Les anciennes
 * clés sont COPIÉES (gardées telles quelles comme sauvegarde, à supprimer plus tard dans les Réglages), avec
 * leur empreinte (`LegacyCopyInfo.fingerprints`, pour repérer une écriture ultérieure d'un onglet resté sur
 * l'ancienne version). Faute de place pour une copie, la clé est déplacée (sa valeur n'existe alors qu'une
 * fois) ; si même un déplacement ne tient pas (la nouvelle clé est plus longue), des copies déjà faites
 * deviennent des déplacements pour libérer de la place (idem pour le registre, écrit en dernier).
 * Idempotente : une clé déjà migrée n'est pas réécrite. Si une écriture échoue malgré tout, tout est
 * annulé (clés déplacées remises en place) et `ok: false`.
 * `base` : registre existant à compléter (registre reconstruit) au lieu d'un registre neuf.
 */
export function migrateLegacyStorage(storage: StorageLike, now: number, base?: ProfilesRegistry): MigrationResult {
  const keys = legacyKeys(storage)
  const registry = base ? registryWithPrincipal(storage, base, now) : defaultRegistry(now, legacyServerName(storage))
  const serverId = (profileById(registry, DEFAULT_PROFILE_ID) ?? registry.profiles[0]).serverId
  /** Anciennes clés gardées (copiées, ou déjà reprises lors d'une migration précédente). */
  const copied: string[] = []
  /** Anciennes clés copiées PAR CETTE migration (valeur identique à la nouvelle clé) : convertibles en déplacements. */
  const ownCopies: string[] = []
  const moved: string[] = []
  const written: string[] = []
  const movedValues = new Map<string, string>()
  const rollback = () => {
    for (const k of written) storage.removeItem(k)
    for (const k of moved) {
      // Valeur gardée en mémoire au moment du déplacement : on la remet à sa place.
      const v = movedValues.get(k)
      if (v !== undefined) storage.setItem(k, v)
    }
  }
  /** Libère de la place : une copie faite ici devient un déplacement (sa copie existe). false s'il n'y en a plus. */
  const convertOneCopy = (): boolean => {
    const k = ownCopies.shift()
    if (k === undefined) return false
    copied.splice(copied.indexOf(k), 1)
    const v = storage.getItem(k)
    if (v !== null) {
      movedValues.set(k, v)
      storage.removeItem(k)
    }
    moved.push(k)
    return true
  }
  /** Écrit ; en cas de quota, convertit des copies en déplacements jusqu'à ce que l'écriture tienne. */
  const writeFreeing = (write: () => void) => {
    for (;;) {
      try {
        write()
        return
      } catch (e) {
        if (!isQuota(e) || !convertOneCopy()) throw e
      }
    }
  }
  try {
    for (const k of keys) {
      const target = migratedKey(k, DEFAULT_PROFILE_ID, serverId)
      const value = storage.getItem(k)
      if (!target || value === null) continue
      if (storage.getItem(target) !== null) {
        copied.push(k)
        continue
      }
      try {
        storage.setItem(target, value)
        written.push(target)
        copied.push(k)
        ownCopies.push(k)
      } catch (e) {
        if (!isQuota(e)) throw e
        // Plus de place pour une copie : on déplace (libère l'ancienne clé, puis écrit la nouvelle).
        storage.removeItem(k)
        movedValues.set(k, value)
        moved.push(k)
        writeFreeing(() => storage.setItem(target, value))
        written.push(target)
      }
    }
    const writeRegistry = () => {
      const fingerprints: Record<string, LegacyFingerprint> = {}
      for (const k of copied) {
        const v = storage.getItem(k)
        if (v !== null) fingerprints[k] = fingerprintOf(v)
      }
      registry.legacy = { migratedAt: now, keys: copied.concat(moved).sort(), moved: [...moved].sort(), removedAt: 0, fingerprints }
      if (!keys.length) delete registry.legacy
      storage.setItem(PROFILES_KEY, JSON.stringify(registry))
    }
    writeFreeing(writeRegistry)
  } catch (e) {
    try {
      rollback()
    } catch {
      // Meilleur effort : les valeurs déplacées sont encore dans `movedValues` pour ce chargement.
    }
    return { ok: false, error: isQuota(e) ? 'Espace de stockage plein : migration vers les profils impossible.' : 'Écriture impossible : migration vers les profils impossible.' }
  }
  writeShadow(storage, JSON.stringify(registry))
  return { ok: true, registry, copied, moved }
}

/**
 * Anciennes clés modifiées APRÈS la reprise dans le profil « Principal » (onglet resté ouvert sur
 * l'ancienne version) : valeur qui ne correspond plus à son empreinte, clé déplacée puis réécrite, ou
 * ancienne clé apparue depuis. Vide si la copie a été supprimée ou s'il n'y a pas eu de reprise.
 */
export function legacyDivergence(storage: StorageLike, registry: ProfilesRegistry): string[] {
  const l = registry.legacy
  if (!l || l.removedAt) return []
  const known = new Set(l.keys)
  const moved = new Set(l.moved)
  const out: string[] = []
  for (const k of legacyKeys(storage)) {
    const v = storage.getItem(k)
    if (v === null) continue
    if (!known.has(k) || moved.has(k)) {
      out.push(k)
      continue
    }
    const f = l.fingerprints?.[k]
    if (f && (f.len !== v.length || f.hash !== hashText(v))) out.push(k)
  }
  return out
}

/**
 * Registre où les anciennes clés `keys` sont tenues pour à jour (valeur actuelle = nouvelle empreinte) :
 * après « Reprendre ces changements » ou « Ignorer ».
 */
export function acknowledgeLegacyKeys(storage: StorageLike, registry: ProfilesRegistry, keys: string[]): ProfilesRegistry {
  const l = registry.legacy
  if (!l) return registry
  const fingerprints: Record<string, LegacyFingerprint> = { ...l.fingerprints }
  const known = new Set(l.keys)
  const moved = new Set(l.moved)
  for (const k of keys) {
    const v = storage.getItem(k)
    if (v === null) continue
    fingerprints[k] = fingerprintOf(v)
    known.add(k)
    moved.delete(k)
  }
  return { ...registry, legacy: { ...l, keys: [...known].sort(), moved: [...moved].sort(), fingerprints } }
}

// ---------- Reconstruction d'un registre perdu ou illisible ----------

function writeShadow(storage: StorageLike, text: string): void {
  try {
    if (storage.getItem(PROFILES_SHADOW_KEY) !== text) storage.setItem(PROFILES_SHADOW_KEY, text)
  } catch {
    // Copie de secours facultative (stockage plein) : rien à faire.
  }
}

/** Registre lu « au mieux » (version manquante tolérée) ; null s'il est inutilisable ou plus récent. */
function lenientRegistry(raw: string | null | undefined): ProfilesRegistry | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isPlainObject(parsed)) return null
  const version = finite(parsed.version) && Number.isInteger(parsed.version) && parsed.version >= 1 ? parsed.version : REGISTRY_VERSION
  if (version > REGISTRY_VERSION) return null
  return sanitizeRegistry({ ...parsed, version }).registry
}

/** Libellé du serveur noté dans les réglages d'un profil (« » si absent). */
function settingsServerLabel(storage: StorageLike, profileId: string): string {
  try {
    const v = JSON.parse(storage.getItem(profileStoreKey(profileId, 'settings')) ?? 'null') as unknown
    return isPlainObject(v) && isPlainObject(v.state) && typeof v.state.server === 'string' ? v.state.server.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : ''
  } catch {
    return ''
  }
}

export interface RebuildResult {
  registry: ProfilesRegistry
  /** Profils rattachés à un serveur deviné (marqués `serverToCheck`). */
  toCheck: string[]
  /** Noms, serveurs et options repris d'une copie (registre illisible lu au mieux, ou copie de secours). */
  recovered: boolean
}

/**
 * Registre reconstruit (registre perdu ou illisible) : d'abord d'après le registre illisible lu au mieux
 * (`corruptRaw`) ou la copie de secours (« elevagesimu:profiles-precedent ») — noms, serveurs, couleurs,
 * options des serveurs, copie d'avant les profils —, puis complété des profils (« p:<id>: ») et serveurs
 * (« s:<id>: ») trouvés seulement dans les données. Un profil sans entrée est rattaché au serveur noté dans
 * ses réglages ; sinon au seul serveur qui a des données, ou au premier par ordre alphabétique, et marqué
 * « serveur à vérifier » s'il y avait plusieurs serveurs possibles. null si aucun profil n'est trouvé.
 */
export function rebuildRegistry(storage: StorageLike, now: number, corruptRaw?: string | null): RebuildResult | null {
  const data = idsWithData(storage)
  const hints = [lenientRegistry(corruptRaw), lenientRegistry(storage.getItem(PROFILES_SHADOW_KEY))].filter((r): r is ProfilesRegistry => r !== null)
  const base = hints[0]
  if (!data.profiles.size && !base) return null
  const reg: ProfilesRegistry = base
    ? { ...base, profiles: base.profiles.map((p) => ({ ...p })), servers: base.servers.map((s) => ({ ...s })) }
    : { version: REGISTRY_VERSION, activeProfileId: '', profiles: [], servers: [] }
  const uniqueProfileName = (name: string) => {
    let n = name.slice(0, NAME_MAX)
    for (let i = 2; reg.profiles.some((p) => normName(p.name) === normName(n)); i++) n = `${name} (${i})`.slice(0, NAME_MAX)
    return n
  }
  // Profils (avec données) connus seulement de l'autre copie.
  for (const h of hints.slice(1))
    for (const p of h.profiles) {
      if (!data.profiles.has(p.id) || profileById(reg, p.id)) continue
      const hs = serverById(h, p.serverId)
      let server = serverById(reg, p.serverId) ?? (hs ? serverByName(reg, hs.name) : undefined)
      if (!server && hs) {
        server = { ...hs }
        reg.servers.push(server)
      }
      if (server) reg.profiles.push({ ...p, name: uniqueProfileName(p.name), serverId: server.id })
    }
  // Serveurs qui n'existent que par leurs données.
  for (const id of [...data.servers].sort())
    if (!serverById(reg, id)) reg.servers.push({ id, name: `Serveur ${id}`, createdAt: now, priceStat: 'auto', maxMarketShare: DEFAULT_MAX_MARKET_SHARE })
  // Profils qui n'existent que par leurs données.
  const toCheck: string[] = []
  for (const id of [...data.profiles].sort()) {
    if (profileById(reg, id)) continue
    const label = settingsServerLabel(storage, id)
    let server = label ? reg.servers.find((s) => s.id === slugify(label) || normName(s.name) === normName(label)) : undefined
    if (server && server.name === `Serveur ${server.id}`) server.name = label
    let guessed = false
    if (!server && reg.servers.length) {
      const withData = reg.servers.filter((s) => data.servers.has(s.id))
      server = withData.length === 1 ? withData[0] : [...reg.servers].sort((a, b) => a.id.localeCompare(b.id))[0]
      guessed = reg.servers.length > 1
    }
    if (!server) {
      const name = label || DEFAULT_SERVER_NAME
      server = { id: freeId(name, [], 'serveur'), name, createdAt: now, priceStat: 'auto', maxMarketShare: DEFAULT_MAX_MARKET_SHARE }
      reg.servers.push(server)
    }
    const entry: ProfileEntry = { id, name: uniqueProfileName(id === DEFAULT_PROFILE_ID ? DEFAULT_PROFILE_NAME : `Profil ${id}`), serverId: server.id, createdAt: now }
    if (guessed) {
      entry.serverToCheck = true
      toCheck.push(id)
    }
    reg.profiles.push(entry)
  }
  if (!reg.profiles.length) return null
  if (!profileById(reg, reg.activeProfileId)) reg.activeProfileId = profileById(reg, DEFAULT_PROFILE_ID) ? DEFAULT_PROFILE_ID : reg.profiles[0].id
  // Copie d'avant les profils encore présente, sans trace dans une copie du registre : on la signale.
  const old = legacyKeys(storage)
  if (!reg.legacy && old.length && profileById(reg, DEFAULT_PROFILE_ID) && keysWithPrefix(storage, profileKeyPrefix(DEFAULT_PROFILE_ID)).length)
    reg.legacy = { migratedAt: now, keys: old, moved: [], removedAt: 0 }
  return { registry: reg, toCheck, recovered: base !== undefined }
}

// ---------- Démarrage ----------

/**
 * - `profiles` : fonctionnement normal (registre lu ou créé et enregistré) ;
 * - `legacy` : migration impossible (espace plein) — l'application lit les anciennes clés ;
 * - `memory` : pas de stockage (navigation privée stricte, hors navigateur) — rien n'est enregistré.
 */
export type BootMode = 'profiles' | 'legacy' | 'memory'

export interface BootResult {
  registry: ProfilesRegistry
  mode: BootMode
  /** Registre d'une version plus récente : lu au mieux, jamais réécrit (gestion des profils bloquée). */
  readOnly: boolean
  /** Migration des anciennes données faite à ce démarrage. */
  migrated: boolean
  /** Problèmes à signaler (français) ; `migration` : profils non activés faute de place. */
  issues: { kind: 'corrige' | 'version' | 'ecriture' | 'migration'; message: string }[]
}

/** Message d'une reconstruction du registre (un seul par sorte : un même bandeau ne garde qu'un message). */
function rebuildIssues(r: RebuildResult, why: 'illisible' | 'absent', written: boolean): BootResult['issues'] {
  const n = r.registry.profiles.length
  const from = r.recovered ? 'd’après la copie de secours du registre et les données présentes' : 'd’après les données présentes (noms à vérifier dans les Réglages)'
  const parts = [`Le registre des profils était ${why} : ${n} profil${n > 1 ? 's' : ''} reconstruit${n > 1 ? 's' : ''} ${from}.`]
  if (why === 'illisible') parts.push('L’original est gardé dans la sauvegarde (« profiles-corrompu »).')
  if (r.toCheck.length) {
    const names = r.toCheck.map((id) => {
      const p = profileById(r.registry, id)
      const s = p ? serverById(r.registry, p.serverId) : undefined
      return `« ${p?.name ?? id} » → ${s?.name ?? '?'}`
    })
    parts.push(`Serveur deviné pour ${names.join(', ')} : vérifiez-le dans Réglages › Profils (badge « serveur à vérifier »).`)
  }
  if (!written) parts.push('Le registre reconstruit n’a pas pu être enregistré (stockage plein ?).')
  return [{ kind: written ? 'corrige' : 'ecriture', message: parts.join(' ') }]
}

/** Profil à ouvrir dans un onglet : celui choisi dans l'onglet s'il existe encore, sinon le profil par défaut du registre. */
export function resolveOpenProfile(r: ProfilesRegistry, preferred: string | null | undefined): { profile: ProfileEntry; missing: string | null } {
  const fallback = activeProfileOf(r)
  if (!preferred || preferred === fallback.id) return { profile: fallback, missing: null }
  const p = profileById(r, preferred)
  return p ? { profile: p, missing: null } : { profile: fallback, missing: preferred }
}

/**
 * Registre au démarrage de l'application (synchrone, avant la création des stores) :
 * registre présent → lu et normalisé (réécrit s'il a été corrigé ; copie de secours tenue à jour) ;
 * illisible → copie gardée (« elevagesimu:profiles-corrompu ») et registre reconstruit (`rebuildRegistry`) ;
 * absent mais des profils (ou une copie de secours) présents → reconstruit aussi, au lieu de les ignorer ;
 * absent sinon → migration des anciennes clés, ou registre neuf (profil « Principal » sur « Mon serveur »).
 */
export function bootProfiles(storage: StorageLike | null, now: number): BootResult {
  if (!storage) return { registry: defaultRegistry(now), mode: 'memory', readOnly: false, migrated: false, issues: [] }
  let raw: string | null = null
  try {
    raw = storage.getItem(PROFILES_KEY)
  } catch {
    return { registry: defaultRegistry(now), mode: 'memory', readOnly: false, migrated: false, issues: [] }
  }
  const write = (reg: ProfilesRegistry): boolean => {
    try {
      const text = JSON.stringify(reg)
      storage.setItem(PROFILES_KEY, text)
      writeShadow(storage, text)
      return true
    } catch {
      return false
    }
  }
  if (raw !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = undefined
    }
    const s = sanitizeRegistry(parsed)
    if (s.registry && s.newer)
      return {
        registry: s.registry,
        mode: 'profiles',
        readOnly: true,
        migrated: false,
        issues: [{ kind: 'version', message: 'Les profils ont été enregistrés par une version plus récente d’ElevageSimu : ils sont lus au mieux et ne peuvent pas être modifiés ici. Rechargez la page pour obtenir la dernière version.' }],
      }
    if (s.registry) {
      const issues: BootResult['issues'] = []
      if (s.issues.length) {
        issues.push({ kind: 'corrige', message: `Registre des profils corrigé au chargement : ${s.issues.join(' ; ')}.` })
        if (!write(s.registry)) issues.push({ kind: 'ecriture', message: 'Le registre des profils corrigé n’a pas pu être enregistré (stockage plein ?).' })
      } else writeShadow(storage, raw)
      return { registry: s.registry, mode: 'profiles', readOnly: false, migrated: false, issues }
    }
    // Illisible : copie de sécurité puis reconstruction (copie de secours, données présentes).
    try {
      if (storage.getItem(PROFILES_CORRUPT_KEY) === null) storage.setItem(PROFILES_CORRUPT_KEY, raw)
    } catch {
      // La reconstruction ne détruit rien : on continue sans copie.
    }
    const rebuilt = rebuildRegistry(storage, now, raw)
    if (rebuilt) return { registry: rebuilt.registry, mode: 'profiles', readOnly: false, migrated: false, issues: rebuildIssues(rebuilt, 'illisible', write(rebuilt.registry)) }
  } else {
    // Registre absent alors que des profils existent (registre effacé, import d'une sauvegarde au registre
    // illisible…) : on les reconstruit au lieu de repartir d'un registre neuf qui les rendrait invisibles.
    const rebuilt = rebuildRegistry(storage, now)
    if (rebuilt) {
      let registry = rebuilt.registry
      let migrated = false
      // Anciennes données jamais reprises (le profil « Principal » n'a aucune donnée) : reprise maintenant.
      if (legacyKeys(storage).length && keysWithPrefix(storage, profileKeyPrefix(DEFAULT_PROFILE_ID)).length === 0) {
        const m = migrateLegacyStorage(storage, now, registry)
        if (m.ok) {
          registry = m.registry
          migrated = true
        }
      }
      const ok = migrated || write(registry)
      return { registry, mode: 'profiles', readOnly: false, migrated, issues: rebuildIssues({ ...rebuilt, registry }, 'absent', ok) }
    }
  }
  if (legacyKeys(storage).length) {
    const m = migrateLegacyStorage(storage, now)
    if (m.ok) return { registry: m.registry, mode: 'profiles', readOnly: false, migrated: true, issues: [] }
    return {
      registry: defaultRegistry(now, legacyServerName(storage)),
      mode: 'legacy',
      readOnly: true,
      migrated: false,
      issues: [
        {
          kind: 'migration',
          message: `${m.error} Vos données restent lisibles et modifiables (ancien format), mais les profils sont désactivés : téléchargez une sauvegarde, libérez de la place (Réglages › Données), puis rechargez la page.`,
        },
      ],
    }
  }
  const reg = defaultRegistry(now)
  if (!write(reg)) return { registry: reg, mode: 'memory', readOnly: false, migrated: false, issues: [{ kind: 'ecriture', message: 'Stockage du navigateur indisponible ou plein : vos profils ne sont pas enregistrés.' }] }
  return { registry: reg, mode: 'profiles', readOnly: false, migrated: false, issues: [] }
}

/** Supprime la copie des anciennes données (après migration), renvoie les clés effacées. */
export function removeLegacyCopy(storage: StorageLike): string[] {
  const keys = legacyKeys(storage)
  for (const k of keys) storage.removeItem(k)
  return keys
}
