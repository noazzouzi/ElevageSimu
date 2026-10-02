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

export function setProfileServer(r: ProfilesRegistry, id: string, serverId: string): RegistryResult {
  if (!profileById(r, id)) return err('Profil introuvable.')
  if (!serverById(r, serverId)) return err('Serveur introuvable.')
  return { ok: true, registry: { ...r, profiles: r.profiles.map((p) => (p.id === id ? { ...p, serverId } : p)) }, id }
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
    return { ok: false, error: isQuota(e) ? 'Espace de stockage du navigateur insuffisant pour dupliquer ce profil (allégez le journal ou supprimez un profil).' : 'Écriture impossible dans le stockage du navigateur.' }
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

/** Contenu d'un profil dans le stockage (pour les listes de profils). */
export function profileDataSummary(storage: StorageLike, id: string): { mounts: number | null; journal: number | null; jobLevel: number | null; bytes: number } {
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
  let bytes = 0
  for (const k of keysWithPrefix(storage, profileKeyPrefix(id))) bytes += 2 * (k.length + (storage.getItem(k)?.length ?? 0))
  return {
    mounts: inv && Array.isArray(inv.mounts) ? inv.mounts.length : null,
    journal: journal && Array.isArray(journal.entries) ? journal.entries.length : null,
    jobLevel: settings && finite(settings.jobLevel) ? settings.jobLevel : null,
    bytes,
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

export type MigrationResult =
  | { ok: true; registry: ProfilesRegistry; copied: string[]; moved: string[] }
  | { ok: false; error: string }

/**
 * Première ouverture de la v2 : les anciennes clés deviennent le profil « Principal » sur un serveur nommé
 * d'après les anciens réglages (« Mon serveur » sinon) ; les anciens prix vont à ce serveur. Les anciennes
 * clés sont COPIÉES (gardées telles quelles comme sauvegarde, à supprimer plus tard dans les Réglages).
 * Faute de place pour une copie, la clé est déplacée (sa valeur n'existe alors qu'une fois). Idempotent :
 * une clé déjà migrée n'est pas réécrite. Le registre est écrit en dernier ; si une écriture échoue
 * malgré tout, tout est annulé (clés déplacées remises en place) et `ok: false`.
 */
export function migrateLegacyStorage(storage: StorageLike, now: number): MigrationResult {
  const keys = legacyKeys(storage)
  const registry = defaultRegistry(now, legacyServerName(storage))
  const serverId = registry.servers[0].id
  const copied: string[] = []
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
      } catch (e) {
        if (!isQuota(e)) throw e
        // Plus de place pour une copie : on déplace (libère l'ancienne clé, puis écrit la nouvelle).
        storage.removeItem(k)
        movedValues.set(k, value)
        moved.push(k)
        storage.setItem(target, value)
        written.push(target)
      }
    }
    const writeRegistry = () => {
      registry.legacy = { migratedAt: now, keys: copied.concat(moved).sort(), moved: [...moved].sort(), removedAt: 0 }
      if (!keys.length) delete registry.legacy
      storage.setItem(PROFILES_KEY, JSON.stringify(registry))
    }
    try {
      writeRegistry()
    } catch (e) {
      if (!isQuota(e)) throw e
      // Plus de place pour le registre : les anciennes clés déjà copiées deviennent des déplacements
      // (leur copie existe), une à une, jusqu'à ce que le registre tienne.
      let saved = false
      while (!saved && copied.length) {
        const k = copied.shift() as string
        const v = storage.getItem(k)
        if (v !== null) {
          movedValues.set(k, v)
          storage.removeItem(k)
        }
        moved.push(k)
        try {
          writeRegistry()
          saved = true
        } catch (e2) {
          if (!isQuota(e2)) throw e2
        }
      }
      if (!saved) throw e
    }
  } catch (e) {
    try {
      rollback()
    } catch {
      // Meilleur effort : les valeurs déplacées sont encore dans `movedValues` pour ce chargement.
    }
    return { ok: false, error: isQuota(e) ? 'Espace de stockage plein : migration vers les profils impossible.' : 'Écriture impossible : migration vers les profils impossible.' }
  }
  return { ok: true, registry, copied, moved }
}

/**
 * Registre reconstruit à partir des clés présentes (registre illisible) : un profil par identifiant
 * « p:<id>: » trouvé, un serveur par « s:<id>: », rattachés d'après le serveur noté dans les réglages.
 */
export function rebuildRegistry(storage: StorageLike, now: number): ProfilesRegistry | null {
  const { profiles, servers } = idsWithData(storage)
  if (!profiles.size) return null
  const reg: ProfilesRegistry = { version: REGISTRY_VERSION, activeProfileId: [...profiles][0], profiles: [], servers: [] }
  for (const id of [...servers].sort()) reg.servers.push({ id, name: `Serveur ${id}`, createdAt: now, priceStat: 'auto', maxMarketShare: DEFAULT_MAX_MARKET_SHARE })
  for (const id of [...profiles].sort()) {
    let label = ''
    try {
      const v = JSON.parse(storage.getItem(profileStoreKey(id, 'settings')) ?? 'null') as unknown
      if (isPlainObject(v) && isPlainObject(v.state) && typeof v.state.server === 'string') label = v.state.server.trim()
    } catch {
      label = ''
    }
    let server = label ? reg.servers.find((s) => s.id === slugify(label) || normName(s.name) === normName(label)) : undefined
    if (server && label && server.name.startsWith('Serveur ')) server.name = label.slice(0, NAME_MAX)
    if (!server) server = reg.servers[0]
    if (!server) {
      const sid = freeId(label || DEFAULT_SERVER_NAME, [], 'serveur')
      server = { id: sid, name: (label || DEFAULT_SERVER_NAME).slice(0, NAME_MAX), createdAt: now, priceStat: 'auto', maxMarketShare: DEFAULT_MAX_MARKET_SHARE }
      reg.servers.push(server)
    }
    reg.profiles.push({ id, name: id === DEFAULT_PROFILE_ID ? DEFAULT_PROFILE_NAME : `Profil ${id}`, serverId: server.id, createdAt: now })
  }
  if (profiles.has(DEFAULT_PROFILE_ID)) reg.activeProfileId = DEFAULT_PROFILE_ID
  return reg
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
  /** Problèmes à signaler (français). */
  issues: { kind: 'corrige' | 'version' | 'ecriture'; message: string }[]
}

/**
 * Registre au démarrage de l'application (synchrone, avant la création des stores) :
 * registre présent → lu et normalisé (réécrit s'il a été corrigé) ; illisible → copie gardée
 * (« elevagesimu:profiles-corrompu ») et registre reconstruit d'après les clés ; absent → migration des
 * anciennes clés, ou registre neuf (profil « Principal » sur « Mon serveur »).
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
      storage.setItem(PROFILES_KEY, JSON.stringify(reg))
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
      }
      return { registry: s.registry, mode: 'profiles', readOnly: false, migrated: false, issues }
    }
    // Illisible : copie de sécurité puis reconstruction d'après les clés présentes.
    try {
      if (storage.getItem(PROFILES_CORRUPT_KEY) === null) storage.setItem(PROFILES_CORRUPT_KEY, raw)
    } catch {
      // La reconstruction ne détruit rien : on continue sans copie.
    }
    const rebuilt = rebuildRegistry(storage, now)
    if (rebuilt) {
      const ok = write(rebuilt)
      return {
        registry: rebuilt,
        mode: 'profiles',
        readOnly: false,
        migrated: false,
        issues: [
          {
            kind: ok ? 'corrige' : 'ecriture',
            message: `Le registre des profils était illisible : ${rebuilt.profiles.length} profil(s) reconstruit(s) d’après les données présentes (noms à vérifier dans les Réglages). L’original est gardé dans la sauvegarde (« profiles-corrompu »).`,
          },
        ],
      }
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
      issues: [{ kind: 'ecriture', message: `${m.error} Vos données restent lisibles (ancien format), mais les profils sont désactivés : téléchargez une sauvegarde puis libérez de la place (Réglages › Données).` }],
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
