// Sauvegarde locale des données de l'application : export, import, remise à zéro — de tout (tous les
// profils et serveurs) ou d'un seul profil (avec son serveur).
//
// Toutes les données vivent dans le localStorage du navigateur, sous des clés « elevagesimu:* » :
// registre des profils (« elevagesimu:profiles »), données de profil (« elevagesimu:p:<profil>:<base> »,
// stores et préférences des pages), données de serveur (« elevagesimu:s:<serveur>:prices|market|… »).
// Une sauvegarde est un fichier JSON :
//   { app: 'ElevageSimu', version: 2, exportedAt: ISO, scope?: {kind:'all'} | {kind:'profile',…},
//     stores: { 'elevagesimu:xxx': valeur décodée } }
// Les sauvegardes v1 (avant les profils, clés « elevagesimu:<base> ») restent importables.
//
// Les fonctions de calcul (filtrage des clés, validation, import, remise à zéro, taille) sont pures et
// prennent un stockage en paramètre (`StorageLike`), ce qui permet de les tester avec un faux stockage.
// Seules `downloadBackup`, `readBackupFile`, `reloadApp` et les messages « flash » touchent au navigateur.
// Après un import ou une remise à zéro, l'application est rechargée (`reloadApp`) : c'est le seul moyen
// sûr de relire tous les stores ET les préférences de page déjà chargées en mémoire.
//
// À l'import, chaque store connu est vérifié par src/store/schema.ts : version plus récente que
// l'application → refus (rien n'est écrit) ; version plus ancienne → migration ; état normalisé (entrées
// invalides écartées, valeurs bornées) avec un avertissement par correction.
import { slugify } from '../domain/market'
import { freezeWrites, pendingWrites } from '../store/persistence'
import {
  bootProfiles,
  freeId,
  idsWithData,
  keysWithPrefix,
  migratedKey,
  profileById,
  sanitizeRegistry,
  serverById,
  serverByName,
  type ProfileEntry,
  type ProfilesRegistry,
  type ServerEntry,
} from '../store/profileRegistry'
import {
  PERSISTED_STORES,
  PROFILES_KEY,
  STORAGE_PREFIX,
  normalizeStoreValue,
  parseStoreKey,
  persistedStoreInfo,
  profileKeyPrefix,
  profileStoreKey,
  serverKeyPrefix,
  type StorageLike,
} from '../store/schema'
import { plural } from './format'

export { STORAGE_PREFIX, type StorageLike } from '../store/schema'

export const BACKUP_APP = 'ElevageSimu'
/**
 * Version du format de sauvegarde (à incrémenter si la structure du fichier change).
 * v2 : profils et serveurs (clés préfixées, registre, `scope`). Les fichiers v1 restent lisibles.
 */
export const BACKUP_VERSION = 2

/** Portée d'une sauvegarde : tout, ou un seul profil (avec les données de son serveur). */
export type BackupScope = { kind: 'all' } | { kind: 'profile'; profile: ProfileEntry; server: ServerEntry }

/** Contenu d'un fichier de sauvegarde. */
export interface BackupFile {
  app: typeof BACKUP_APP
  version: number
  /** Date d'export (ISO 8601). */
  exportedAt: string
  /** Portée (absente dans les fichiers v1 = tout). */
  scope?: BackupScope
  /** Valeur JSON décodée de chaque clé « elevagesimu:* ». */
  stores: Record<string, unknown>
  /** Valeurs qui n'étaient pas du JSON valide, copiées telles quelles (rare). */
  raw?: Record<string, string>
}

export type BackupValidation =
  | { ok: true; backup: BackupFile; keys: string[]; warnings: string[] }
  | { ok: false; error: string }

export type ImportMode = 'replace' | 'merge'

export interface ImportOptions {
  /**
   * Tout : 'replace' (défaut) : l'état local devient exactement celui de la sauvegarde (les clés absentes
   * de la sauvegarde sont effacées) ; 'merge' : seules les clés présentes dans la sauvegarde sont écrites
   * (registres des profils fusionnés). Un profil : 'replace' (défaut) remplace les données de ce profil ;
   * 'merge' n'écrit que les clés présentes.
   */
  mode?: ImportMode
  /** Sauvegarde d'un profil : l'importer comme un NOUVEAU profil (copie) au lieu de remplacer celui du même identifiant. */
  asNewProfile?: boolean
  /** Stockage cible (défaut : localStorage du navigateur). */
  storage?: StorageLike | null
  /** Recharger l'application après l'import (défaut : vrai ; sans effet hors navigateur). */
  reload?: boolean
  /** Instant de l'import (tests). */
  now?: number
}

export type ImportResult =
  | { ok: true; mode: ImportMode; written: string[]; removed: string[]; warnings: string[]; profileId?: string }
  | { ok: false; error: string }

/**
 * Stores d'avant les profils (anciennes clés) : leur valeur doit avoir la forme `{ state: {…}, version }`.
 * Pour une clé de la v2 (profil, serveur), utiliser `isKnownStoreKey` / `persistedStoreInfo`.
 */
export const KNOWN_STORES: Record<string, string> = Object.fromEntries(Object.entries(PERSISTED_STORES).map(([k, v]) => [k, v.label]))

/** Version actuelle du schéma de chaque store d'avant les profils (compatibilité ; voir `storeVersion(key)`). */
export const STORE_VERSIONS: Record<string, number> = Object.fromEntries(Object.entries(PERSISTED_STORES).map(([k, v]) => [k, v.version]))

/** La clé est-elle un store persisté (profil, serveur ou ancienne clé) ? */
export function isKnownStoreKey(key: string): boolean {
  return persistedStoreInfo(key) !== undefined
}

/** Préférences d'affichage connues (une par page), par base de clé. */
const PAGE_PREFS: Record<string, string> = {
  metier: 'Préférences de la page Métier',
  rentabilite: 'Préférences de la page Rentabilité',
  optimiseur: 'Préférences de l’Optimiseur',
  'montures-ui': 'Préférences de la page Montures',
  'enclos-notifications': 'Notifications des enclos',
  profiles: 'Profils et serveurs',
  'profiles-corrompu': 'Profils et serveurs (copie illisible)',
}

/** Noms des profils et serveurs (pour les libellés), d'après un registre. */
export interface ScopeNames {
  profiles: Record<string, string>
  servers: Record<string, string>
}

export function scopeNamesOf(reg: ProfilesRegistry | null | undefined): ScopeNames {
  return {
    profiles: Object.fromEntries((reg?.profiles ?? []).map((p) => [p.id, p.name])),
    servers: Object.fromEntries((reg?.servers ?? []).map((x) => [x.id, x.name])),
  }
}

/**
 * Libellé lisible d'une clé de stockage (« Montures (étable…) — profil Principal », « Prix saisis —
 * serveur Tylezia », « Ancienne copie : Réglages »).
 */
export function storeLabel(key: string, names?: ScopeNames): string {
  const p = parseStoreKey(key)
  if (!p) return key
  const base = persistedStoreInfo(key)?.label ?? PAGE_PREFS[p.base] ?? `Préférences (${p.base})`
  if (p.kind === 'profile') return `${base} — profil ${names?.profiles[p.id ?? ''] ?? p.id}`
  if (p.kind === 'server') return `${base} — serveur ${names?.servers[p.id ?? ''] ?? p.id}`
  if (p.kind === 'legacy' && names) return `Ancienne copie : ${base}`
  return base
}

/** La clé appartient-elle à l'application ? */
export function isAppKey(key: string | null | undefined): key is string {
  return typeof key === 'string' && key.startsWith(STORAGE_PREFIX) && key.length > STORAGE_PREFIX.length
}

/** Stockage du navigateur, ou null s'il est indisponible (navigation privée stricte, hors navigateur). */
export function getBrowserStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function resolveStorage(storage: StorageLike | null | undefined): StorageLike | null {
  return storage === undefined ? getBrowserStorage() : storage
}

/** Clés « elevagesimu:* » présentes dans le stockage, triées. */
export function appKeys(storage?: StorageLike | null): string[] {
  const s = resolveStorage(storage)
  if (!s) return []
  const out: string[] = []
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i)
    if (isAppKey(k)) out.push(k)
  }
  return out.sort()
}

/** Valeur décodée d'une clé (ou texte brut si ce n'est pas du JSON). */
function collect(storage: StorageLike | null, keys: Iterable<string>, pending: Record<string, string>): { stores: Record<string, unknown>; raw: Record<string, string> } {
  const stores: Record<string, unknown> = {}
  const raw: Record<string, string> = {}
  for (const key of [...new Set(keys)].sort()) {
    const value = Object.hasOwn(pending, key) ? pending[key] : (storage?.getItem(key) ?? null)
    if (value === null) continue
    try {
      stores[key] = JSON.parse(value) as unknown
    } catch {
      raw[key] = value
    }
  }
  return { stores, raw }
}

/**
 * Instantané de toutes les données de l'application (tous les profils et serveurs, registre compris).
 * `pending` : valeurs (texte JSON) plus récentes que celles du stockage, à exporter à leur place — les
 * modifications qu'un quota plein a empêché d'enregistrer (`pendingWrites()`), pour qu'une sauvegarde
 * faite à ce moment-là ne les perde pas.
 */
export function exportAll(storage?: StorageLike | null, now: Date = new Date(), pending: Record<string, string> = {}): BackupFile {
  const s = resolveStorage(storage)
  const { stores, raw } = collect(s, [...appKeys(s), ...Object.keys(pending).filter(isAppKey)], pending)
  const backup: BackupFile = { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), scope: { kind: 'all' }, stores }
  if (Object.keys(raw).length) backup.raw = raw
  return backup
}

/** Registre des profils lu (et normalisé) dans un stockage, ou null. */
export function readRegistry(storage: StorageLike | null | undefined): ProfilesRegistry | null {
  const s = resolveStorage(storage)
  if (!s) return null
  try {
    return sanitizeRegistry(JSON.parse(s.getItem(PROFILES_KEY) ?? 'null')).registry
  } catch {
    return null
  }
}

/**
 * Sauvegarde d'UN profil : ses données (« p:<profil>: », préférences des pages comprises) et celles de son
 * serveur (prix saisis, marché importé, historique), avec la description du profil et du serveur.
 * null si le profil est introuvable.
 */
export function exportProfile(profileId: string, storage?: StorageLike | null, now: Date = new Date(), pending: Record<string, string> = {}): BackupFile | null {
  const s = resolveStorage(storage)
  const reg = readRegistry(s)
  const profile = reg ? profileById(reg, profileId) : undefined
  const server = profile && reg ? serverById(reg, profile.serverId) : undefined
  if (!profile || !server) return null
  const prefixes = [profileKeyPrefix(profile.id), serverKeyPrefix(server.id)]
  const keys = [...appKeys(s), ...Object.keys(pending)].filter((k) => prefixes.some((p) => k.startsWith(p)))
  const { stores, raw } = collect(s, keys, pending)
  const backup: BackupFile = { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), scope: { kind: 'profile', profile, server }, stores }
  if (Object.keys(raw).length) backup.raw = raw
  return backup
}

/** Texte JSON (indenté) d'une sauvegarde. */
export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2)
}

/**
 * Nom de fichier proposé : « elevagesimu-sauvegarde-2026-10-02-14h05.json » (heure locale), ou
 * « elevagesimu-profil-principal-2026-10-02-14h05.json » pour un profil.
 */
export function backupFileName(date: Date = new Date(), profileName?: string): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const what = profileName ? `profil-${slugify(profileName) || 'profil'}` : 'sauvegarde'
  return `elevagesimu-${what}-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}h${p(date.getMinutes())}.json`
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** Portée d'une sauvegarde v2, normalisée (null si illisible). */
function sanitizeScope(raw: unknown): BackupScope | null | 'invalid' {
  if (raw === undefined) return null
  if (!isPlainObject(raw)) return 'invalid'
  if (raw.kind === 'all') return { kind: 'all' }
  if (raw.kind !== 'profile') return 'invalid'
  const r = sanitizeRegistry({ version: 1, activeProfileId: isPlainObject(raw.profile) ? raw.profile.id : '', profiles: [raw.profile], servers: [raw.server] })
  const profile = r.registry?.profiles[0]
  const server = profile && r.registry ? serverById(r.registry, profile.serverId) : undefined
  if (!profile || !server || !isPlainObject(raw.server) || raw.server.id !== server.id) return 'invalid'
  return { kind: 'profile', profile, server }
}

/** Vérifie qu'un objet est bien une sauvegarde ElevageSimu importable (et la normalise). */
export function validateBackup(data: unknown): BackupValidation {
  if (!isPlainObject(data)) return { ok: false, error: 'Ce fichier n’est pas une sauvegarde ElevageSimu (objet JSON attendu).' }
  if (data.app !== BACKUP_APP) {
    const found = typeof data.app === 'string' ? `« ${data.app} »` : 'absent'
    return { ok: false, error: `Ce fichier ne vient pas d’ElevageSimu (champ « app » ${found}).` }
  }
  const version = data.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    return { ok: false, error: 'Numéro de version de la sauvegarde manquant ou invalide.' }
  if (version > BACKUP_VERSION)
    return {
      ok: false,
      error: `Cette sauvegarde vient d’une version plus récente de l’application (format v${version}, cette version lit jusqu’à v${BACKUP_VERSION}). Mettez l’application à jour (rechargez la page) avant d’importer.`,
    }
  if (!isPlainObject(data.stores)) return { ok: false, error: 'La sauvegarde ne contient pas de section « stores » valide.' }
  if (data.raw !== undefined && !isPlainObject(data.raw)) return { ok: false, error: 'Section « raw » invalide dans la sauvegarde.' }
  const scope = sanitizeScope(data.scope)
  if (scope === 'invalid') return { ok: false, error: 'Portée de la sauvegarde illisible (profil ou serveur invalide).' }
  const profileScope = scope?.kind === 'profile' ? scope : null
  /** Une sauvegarde de profil ne contient que les clés de ce profil et de son serveur. */
  const inScope = (key: string) => !profileScope || key.startsWith(profileKeyPrefix(profileScope.profile.id)) || key.startsWith(serverKeyPrefix(profileScope.server.id))

  const warnings: string[] = []
  const stores: Record<string, unknown> = {}
  const raw: Record<string, string> = {}
  let foreign = 0
  for (const [key, value] of Object.entries(data.stores)) {
    if (!isAppKey(key) || !inScope(key)) {
      foreign++
      continue
    }
    if (key === PROFILES_KEY) {
      if (profileScope) {
        foreign++
        continue
      }
      const r = sanitizeRegistry(value)
      if (r.newer) return { ok: false, error: 'Profils créés par une version plus récente de l’application : mettez-la à jour (rechargez la page) avant d’importer. Import annulé, rien n’a été modifié.' }
      if (!r.registry) {
        warnings.push('Registre des profils illisible ignoré : les profils seront reconstruits d’après les données.')
        continue
      }
      for (const issue of r.issues) warnings.push(`Profils et serveurs : ${issue}.`)
      stores[key] = r.registry
      continue
    }
    if (isKnownStoreKey(key)) {
      // Forme, version (une version plus récente est refusée), migration et normalisation.
      const checked = normalizeStoreValue(key, value)
      if (!checked.ok) return { ok: false, error: `${checked.error} Import annulé, rien n’a été modifié.` }
      for (const issue of checked.issues) warnings.push(`${storeLabel(key)} : ${issue}.`)
      stores[key] = checked.value
      continue
    }
    stores[key] = value
  }
  if (isPlainObject(data.raw))
    for (const [key, value] of Object.entries(data.raw)) {
      if (!isAppKey(key) || key in stores || !inScope(key)) {
        foreign++
        continue
      }
      if (typeof value !== 'string') return { ok: false, error: `Valeur brute invalide pour « ${key} » dans la sauvegarde.` }
      if (isKnownStoreKey(key)) return { ok: false, error: `Données « ${storeLabel(key)} » illisibles dans la sauvegarde : import annulé.` }
      if (key === PROFILES_KEY) {
        warnings.push('Registre des profils illisible ignoré : les profils seront reconstruits d’après les données.')
        continue
      }
      raw[key] = value
    }
  if (foreign > 0) warnings.unshift(`${foreign} donnée${foreign > 1 ? 's' : ''} étrangère${foreign > 1 ? 's' : ''} à l’application ignorée${foreign > 1 ? 's' : ''}.`)

  let exportedAt = typeof data.exportedAt === 'string' ? data.exportedAt : ''
  if (!exportedAt || Number.isNaN(Date.parse(exportedAt))) {
    warnings.push('Date d’export absente ou illisible.')
    exportedAt = ''
  }
  const keys = [...Object.keys(stores), ...Object.keys(raw)].sort()
  if (keys.length === 0 && !profileScope) warnings.push('La sauvegarde est vide : en mode « remplacer », toutes vos données actuelles seraient effacées.')
  const backup: BackupFile = { app: BACKUP_APP, version, exportedAt, stores }
  if (scope) backup.scope = scope
  if (Object.keys(raw).length) backup.raw = raw
  return { ok: true, backup, keys, warnings }
}

/** Décode et valide le texte d'un fichier de sauvegarde. */
export function parseBackup(text: string): BackupValidation {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Fichier illisible : ce n’est pas du JSON valide.' }
  }
  return validateBackup(data)
}

/**
 * Fusion de registres (import « fusionner » d'une sauvegarde complète) : profils et serveurs de la
 * sauvegarde ajoutés ou mis à jour (même identifiant), ceux d'ici gardés ; le profil actif d'ici reste actif.
 */
export function mergeRegistries(local: ProfilesRegistry, incoming: ProfilesRegistry): ProfilesRegistry {
  const servers = [...local.servers.filter((s) => !serverById(incoming, s.id)), ...incoming.servers]
  const profiles = [...local.profiles.filter((p) => !profileById(incoming, p.id)), ...incoming.profiles]
  const out: ProfilesRegistry = { ...local, servers, profiles }
  if (!profileById(out, out.activeProfileId)) out.activeProfileId = profiles[0].id
  return out
}

type WritePlan = { entries: [string, string][]; removed: string[] }

/** Écrit tout ou rien : en cas d'échec (quota), l'état précédent des clés de l'application est restauré. */
function writeAll(storage: StorageLike, plan: WritePlan): { ok: true } | { ok: false; error: string } {
  const existing = appKeys(storage)
  const snapshot = new Map(existing.map((k) => [k, storage.getItem(k)]))
  try {
    for (const k of plan.removed) storage.removeItem(k)
    for (const [k, val] of plan.entries) storage.setItem(k, val)
  } catch (e) {
    restoreSnapshot(storage, snapshot)
    const quota = e instanceof Error && /quota/i.test(`${e.name} ${e.message}`)
    return {
      ok: false,
      error: quota
        ? 'Espace de stockage du navigateur insuffisant : import annulé, vos données n’ont pas changé.'
        : 'Écriture impossible dans le stockage du navigateur : import annulé, vos données n’ont pas changé.',
    }
  }
  return { ok: true }
}

/**
 * Restaure une sauvegarde (texte JSON, objet décodé ou `BackupFile`) dans le stockage, après validation.
 *  - sauvegarde complète (v1 ou v2) : 'replace' = l'état local devient celui du fichier (une sauvegarde v1
 *    sera migrée vers le profil « Principal » au rechargement) ; 'merge' = clés du fichier écrites,
 *    registres fusionnés, et une sauvegarde v1 est versée dans le profil actif (et son serveur) ;
 *  - sauvegarde d'un profil : voir `importProfileBackup`.
 * En cas d'échec d'écriture (quota dépassé…), l'état précédent est restauré et une erreur est renvoyée.
 * Recharge ensuite l'application (option `reload`, vraie par défaut) pour relire tous les stores.
 */
export function importAll(input: unknown, opts: ImportOptions = {}): ImportResult {
  const mode: ImportMode = opts.mode ?? 'replace'
  const storage = resolveStorage(opts.storage)
  if (!storage) return { ok: false, error: 'Stockage du navigateur indisponible (navigation privée ?) : import impossible.' }
  const v = typeof input === 'string' ? parseBackup(input) : validateBackup(input)
  if (!v.ok) return v
  if (v.backup.scope?.kind === 'profile') return importProfileBackup(v.backup, { ...opts, storage, mode })

  const warnings = [...v.warnings]
  let entries: [string, string][] = [
    ...Object.entries(v.backup.stores).map(([k, val]): [string, string] => [k, JSON.stringify(val)]),
    ...Object.entries(v.backup.raw ?? {}),
  ]
  const localRegistry = readRegistry(storage)
  if (mode === 'merge' && localRegistry) {
    const incomingRegistry = v.backup.stores[PROFILES_KEY] as ProfilesRegistry | undefined
    if (incomingRegistry) entries = entries.map(([k, val]): [string, string] => (k === PROFILES_KEY ? [k, JSON.stringify(mergeRegistries(localRegistry, incomingRegistry))] : [k, val]))
    else {
      // Sauvegarde d'avant les profils : versée dans le profil actif et son serveur.
      const active = profileById(localRegistry, localRegistry.activeProfileId) ?? localRegistry.profiles[0]
      let moved = 0
      entries = entries.map(([k, val]): [string, string] => {
        const target = parseStoreKey(k)?.kind === 'legacy' ? migratedKey(k, active.id, active.serverId) : null
        if (!target) return [k, val]
        moved++
        return [target, val]
      })
      if (moved) warnings.push(`Sauvegarde d’avant les profils : ${plural(moved, 'donnée versée', 'données versées')} dans le profil « ${active.name} ».`)
    }
  }
  const incoming = new Set(entries.map(([k]) => k))
  const removed = mode === 'replace' ? appKeys(storage).filter((k) => !incoming.has(k)) : []
  const w = writeAll(storage, { entries, removed })
  if (!w.ok) return w
  if (opts.reload ?? true) {
    freezeWrites()
    reloadApp(`Sauvegarde importée : ${entries.length} élément${entries.length > 1 ? 's' : ''} restauré${entries.length > 1 ? 's' : ''}.`)
  }
  return { ok: true, mode, written: [...incoming].sort(), removed, warnings }
}

/**
 * Restaure la sauvegarde d'UN profil sans toucher aux autres :
 *  - profil : même identifiant (remplacé : 'replace' efface d'abord ses données absentes du fichier), ou
 *    nouveau profil (copie) si `asNewProfile` ; un nom déjà pris reçoit un suffixe « (2) » ; le profil
 *    importé devient le profil actif ;
 *  - serveur : s'il existe déjà ici (même identifiant ou même nom), ses prix et son marché sont GARDÉS
 *    (avertissement) ; sinon il est créé avec les données du fichier.
 */
export function importProfileBackup(backup: BackupFile, opts: ImportOptions & { storage: StorageLike }): ImportResult {
  const storage = opts.storage
  const mode: ImportMode = opts.mode ?? 'replace'
  const scope = backup.scope
  if (scope?.kind !== 'profile') return { ok: false, error: 'Ce n’est pas la sauvegarde d’un profil.' }
  const now = opts.now ?? Date.now()
  const warnings: string[] = []
  // Registre local (créé, et anciennes données migrées, s'il n'existe pas encore).
  let reg = readRegistry(storage) ?? bootProfiles(storage, now).registry
  const taken = idsWithData(storage)

  // Serveur.
  let serverId = scope.server.id
  let writeServerData = false
  const sameId = serverById(reg, scope.server.id)
  const sameName = serverByName(reg, scope.server.name)
  if (sameId) {
    if (Object.keys(backup.stores).some((k) => k.startsWith(serverKeyPrefix(scope.server.id)))) warnings.push(`Serveur « ${sameId.name} » déjà présent : ses prix et son marché actuels sont gardés.`)
  } else if (sameName) {
    serverId = sameName.id
    warnings.push(`Serveur « ${sameName.name} » déjà présent : le profil y est rattaché, ses prix et son marché actuels sont gardés.`)
  } else {
    if (taken.servers.has(serverId)) serverId = freeId(scope.server.name, [...reg.servers.map((x) => x.id), ...taken.servers], 'serveur')
    reg = { ...reg, servers: [...reg.servers, { ...scope.server, id: serverId }] }
    writeServerData = true
  }

  // Profil.
  let profileId = scope.profile.id
  let name = scope.profile.name
  const existing = profileById(reg, profileId)
  if (opts.asNewProfile || (!existing && taken.profiles.has(profileId))) {
    profileId = freeId(name, [...reg.profiles.map((p) => p.id), ...taken.profiles], 'profil')
  }
  const nameTaken = (n: string) => reg.profiles.some((p) => p.id !== profileId && slugify(p.name) === slugify(n))
  if (nameTaken(name)) {
    let i = 2
    while (nameTaken(`${scope.profile.name} (${i})`)) i++
    name = `${scope.profile.name} (${i})`.slice(0, 40)
  }
  const entry: ProfileEntry = { ...scope.profile, id: profileId, name, serverId }
  reg = { ...reg, profiles: [...reg.profiles.filter((p) => p.id !== profileId), entry], activeProfileId: profileId }

  const entries: [string, string][] = []
  const pPrefix = profileKeyPrefix(scope.profile.id)
  const sPrefix = serverKeyPrefix(scope.server.id)
  const all: [string, string][] = [...Object.entries(backup.stores).map(([k, val]): [string, string] => [k, JSON.stringify(val)]), ...Object.entries(backup.raw ?? {})]
  for (const [k, val] of all) {
    if (k.startsWith(pPrefix)) entries.push([profileStoreKey(profileId, k.slice(pPrefix.length)), val])
    else if (k.startsWith(sPrefix) && writeServerData) entries.push([`${serverKeyPrefix(serverId)}${k.slice(sPrefix.length)}`, val])
  }
  entries.push([PROFILES_KEY, JSON.stringify(reg)])
  const incoming = new Set(entries.map(([k]) => k))
  const removed = mode === 'replace' ? keysWithPrefix(storage, profileKeyPrefix(profileId)).filter((k) => !incoming.has(k)) : []
  const w = writeAll(storage, { entries, removed })
  if (!w.ok) return w
  if (opts.reload ?? true) {
    freezeWrites()
    reloadApp(`Profil « ${name} » importé et ouvert.`)
  }
  return { ok: true, mode, written: [...incoming].sort(), removed, warnings, profileId }
}

function restoreSnapshot(storage: StorageLike, snapshot: Map<string, string | null>) {
  try {
    for (const k of appKeys(storage)) if (!snapshot.has(k)) storage.removeItem(k)
    for (const [k, val] of snapshot) if (val !== null) storage.setItem(k, val)
  } catch {
    // Meilleur effort : si même la restauration échoue, il n'y a plus rien à faire ici.
  }
}

/**
 * Efface toutes les données de l'application (clés « elevagesimu:* » uniquement ; les autres clés du
 * navigateur ne sont pas touchées). `keep` : clés à conserver. Renvoie les clés effacées.
 */
export function resetAll(opts: { storage?: StorageLike | null; keep?: string[]; reload?: boolean } = {}): string[] {
  const storage = resolveStorage(opts.storage)
  if (!storage) return []
  const keep = new Set(opts.keep ?? [])
  const removed = appKeys(storage).filter((k) => !keep.has(k))
  for (const k of removed) storage.removeItem(k)
  if (opts.reload ?? true) {
    freezeWrites()
    reloadApp('Toutes les données de l’application ont été effacées.')
  }
  return removed
}

export interface StorageUsage {
  /** Taille approximative (octets, encodage UTF-16 du navigateur) des données de l'application. */
  totalBytes: number
  entries: { key: string; label: string; bytes: number }[]
}

/** Place occupée par chaque clé de l'application (triée de la plus grosse à la plus petite). */
export function storageUsage(storage?: StorageLike | null): StorageUsage {
  const s = resolveStorage(storage)
  if (!s) return { totalBytes: 0, entries: [] }
  const reg = readRegistry(s)
  const names = reg ? scopeNamesOf(reg) : undefined
  const entries = appKeys(s).map((key) => ({ key, label: storeLabel(key, names), bytes: 2 * (key.length + (s.getItem(key)?.length ?? 0)) }))
  entries.sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key))
  return { totalBytes: entries.reduce((t, e) => t + e.bytes, 0), entries }
}

/** Quota habituel du localStorage (≈ 5 Mo par site dans les navigateurs courants). */
export const TYPICAL_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024

export interface BackupSummaryLine {
  key: string
  label: string
  /** Détail lisible (« 42 montures »…), ou null. */
  detail: string | null
}

function stateOf(v: unknown): Record<string, unknown> | null {
  return isPlainObject(v) && isPlainObject(v.state) ? v.state : null
}

function countOf(x: unknown): number {
  if (Array.isArray(x)) return x.length
  if (isPlainObject(x)) return Object.keys(x).length
  return 0
}

/** Ce que contient une sauvegarde (pour l'aperçu avant import). */
export function summarizeBackup(backup: BackupFile): BackupSummaryLine[] {
  const lines: BackupSummaryLine[] = []
  const reg = isPlainObject(backup.stores[PROFILES_KEY]) ? sanitizeRegistry(backup.stores[PROFILES_KEY]).registry : null
  const names: ScopeNames | undefined =
    backup.scope?.kind === 'profile'
      ? { profiles: { [backup.scope.profile.id]: backup.scope.profile.name }, servers: { [backup.scope.server.id]: backup.scope.server.name } }
      : reg
        ? scopeNamesOf(reg)
        : undefined
  for (const key of [...Object.keys(backup.stores), ...Object.keys(backup.raw ?? {})].sort()) {
    const st = stateOf(backup.stores[key])
    const base = persistedStoreInfo(key)?.base
    let detail: string | null = null
    if (key === PROFILES_KEY && reg) detail = `${plural(reg.profiles.length, 'profil', 'profils')}, ${plural(reg.servers.length, 'serveur', 'serveurs')}`
    if (st)
      switch (base) {
        case 'inventory':
          detail = plural(countOf(st.mounts), 'monture', 'montures')
          break
        case 'journal':
          detail = plural(countOf(st.entries), 'entrée', 'entrées')
          break
        case 'prices': {
          const parts = [plural(countOf(st.items), 'prix d’objet', 'prix d’objets'), plural(countOf(st.mounts) + countOf(st.generations), 'prix de monture', 'prix de montures')]
          if (typeof st.genetonValue === 'number') parts.push('valeur du généton')
          detail = parts.join(', ')
          break
        }
        case 'market': {
          const snap = isPlainObject(st.snapshot) ? st.snapshot : null
          detail = snap ? `${plural(countOf(snap.rows), 'objet', 'objets')}, export du ${typeof snap.exportDate === 'string' ? snap.exportDate.split('-').reverse().join('/') : '?'}` : 'aucun import'
          break
        }
        case 'market-history':
          detail = plural(countOf(st.entries), 'import', 'imports')
          break
        case 'paddockPlans':
          detail = plural(countOf(st.plans), 'plan en cours', 'plans en cours')
          break
        case 'paddocks':
          detail = plural(countOf(st.paddocks), 'enclos', 'enclos')
          break
        case 'planProgress':
          detail = [plural(countOf(st.checked), 'case cochée', 'cases cochées'), plural(countOf(st.done), 'conseil fait', 'conseils faits')].join(', ')
          break
        case 'settings': {
          const parts: string[] = []
          if (typeof st.ruleset === 'string') parts.push(`règles ${st.ruleset}`)
          if (typeof st.jobLevel === 'number') parts.push(`Éleveur niv. ${st.jobLevel}`)
          if (typeof st.server === 'string' && st.server.trim()) parts.push(`serveur ${st.server.trim()}`)
          detail = parts.length ? parts.join(', ') : null
          break
        }
      }
    lines.push({ key, label: storeLabel(key, names), detail })
  }
  return lines
}

// ---------- Navigateur ----------

/**
 * Télécharge une sauvegarde (défaut : instantané actuel de tout, modifications non enregistrées comprises
 * — voir `exportAll`). Renvoie le nom du fichier.
 */
export function downloadBackup(backup: BackupFile = exportAll(undefined, new Date(), pendingWrites()), date: Date = new Date()): string {
  const name = backupFileName(date, backup.scope?.kind === 'profile' ? backup.scope.profile.name : undefined)
  const blob = new Blob([serializeBackup(backup)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
  return name
}

/** Télécharge la sauvegarde d'un profil (modifications non enregistrées comprises) ; null si introuvable. */
export function downloadProfileBackup(profileId: string, date: Date = new Date()): string | null {
  const b = exportProfile(profileId, undefined, date, pendingWrites())
  return b ? downloadBackup(b, date) : null
}

/** Lit et valide un fichier choisi par l'utilisateur. */
export async function readBackupFile(file: Blob): Promise<BackupValidation> {
  try {
    return parseBackup(await file.text())
  } catch {
    return { ok: false, error: 'Impossible de lire ce fichier.' }
  }
}

const FLASH_KEY = 'elevagesimu-flash'

/** Message à afficher après le prochain chargement de la page (sessionStorage, hors sauvegarde). */
export function setFlash(message: string): void {
  try {
    window.sessionStorage.setItem(FLASH_KEY, message)
  } catch {
    // Pas de sessionStorage : le message est simplement perdu.
  }
}

/** Récupère (et efface) le message laissé avant un rechargement. */
export function takeFlash(): string | null {
  try {
    const m = window.sessionStorage.getItem(FLASH_KEY)
    if (m !== null) window.sessionStorage.removeItem(FLASH_KEY)
    return m
  } catch {
    return null
  }
}

/** Recharge l'application pour que tous les stores relisent le stockage (sans effet hors navigateur). */
export function reloadApp(flash?: string): void {
  if (typeof window === 'undefined' || typeof window.location?.reload !== 'function') return
  if (flash) setFlash(flash)
  window.location.reload()
}
