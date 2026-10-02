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
import { MARKET_HISTORY_MAX, slugify, type MarketHistoryEntry, type MarketSnapshot } from '../domain/market'
import { freezeWrites, pendingWrites } from '../store/persistence'
import {
  bootProfiles,
  fingerprintOf,
  freeId,
  hashText,
  idsWithData,
  keysWithPrefix,
  migratedKey,
  profileById,
  profilesOnServer,
  rebuildRegistry,
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
  createMemoryStorage,
  normalizeStoreValue,
  parseStoreKey,
  persistedStoreInfo,
  profileKeyPrefix,
  profileStoreKey,
  serverKeyPrefix,
  serverStoreKey,
  type MarketData,
  type MarketHistoryData,
  type PricesData,
  type StorageLike,
} from '../store/schema'
import { clearTabProfile, writeTabProfile } from '../store/tabProfile'
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

/**
 * Sauvegarde d'un profil dont le serveur existe déjà ici AVEC des prix ou un marché : que faire de ceux de
 * la sauvegarde ? 'keep' (défaut) : ceux de ce navigateur sont gardés ; 'replace' : ceux de la sauvegarde
 * les remplacent (prix saisis, marché, historique) ; 'merge' : prix fusionnés clé par clé (ceux de ce
 * navigateur gardés en cas de doublon), marché le plus récent gardé, historiques réunis.
 */
export type ServerDataChoice = 'keep' | 'replace' | 'merge'

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
  /** Sauvegarde d'un profil dont le serveur existe déjà ici avec des données : voir `ServerDataChoice` (défaut 'keep'). */
  serverData?: ServerDataChoice
  /** Stockage cible (défaut : localStorage du navigateur). */
  storage?: StorageLike | null
  /** Recharger l'application après l'import (défaut : vrai ; sans effet hors navigateur). */
  reload?: boolean
  /** Instant de l'import (tests). */
  now?: number
}

export type ImportResult =
  | { ok: true; mode: ImportMode; written: string[]; removed: string[]; warnings: string[]; profileId?: string }
  /**
   * `snapshot` : l'écriture a échoué ET l'état d'avant n'a pas pu être entièrement remis en place (autre
   * onglet qui écrit en même temps…) : copie de toutes les données d'avant l'import, à proposer au
   * téléchargement (`downloadBackup(snapshot)`).
   */
  | { ok: false; error: string; snapshot?: BackupFile }

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

/** Préférences d'affichage connues (une par page) et autres données hors stores, par base de clé. */
const PAGE_PREFS: Record<string, string> = {
  metier: 'Préférences de la page Métier',
  rentabilite: 'Préférences de la page Rentabilité',
  optimiseur: 'Préférences de l’Optimiseur',
  'montures-ui': 'Préférences de la page Montures',
  modes: 'Résultats de la comparaison des modes (recalculables)',
  'modes-ui': 'Préférences de la page Modes',
  investissement: 'Préférences de la page Investissement',
  'mode-plan': 'Plan d’investissement suivi',
  'enclos-notifications': 'Notifications des enclos',
  profiles: 'Profils et serveurs',
  'profiles-corrompu': 'Profils et serveurs (copie illisible)',
  'profiles-precedent': 'Profils et serveurs (copie de secours)',
}

/**
 * Bases de clés de profil dont le contenu se recalcule à la demande (résultats de la comparaison des modes,
 * souvent la plus grosse donnée d'un profil) : supprimables sans perte pour libérer de la place.
 */
export const REGENERABLE_BASES: ReadonlySet<string> = new Set(['modes'])

/** Donnée recalculable (voir `REGENERABLE_BASES`) ? */
export function isRegenerableKey(key: string): boolean {
  const p = parseStoreKey(key)
  return p?.kind === 'profile' && REGENERABLE_BASES.has(p.base)
}

/** Supprime les données recalculables de TOUS les profils ; renvoie les clés effacées. */
export function removeRegenerableData(storage?: StorageLike | null): string[] {
  const s = resolveStorage(storage)
  if (!s) return []
  const keys = appKeys(s).filter(isRegenerableKey)
  for (const k of keys) s.removeItem(k)
  return keys
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
  // Texte d'origine des données (avant normalisation), retrouvé par `importAll(backup)` : empreintes.
  const source = originalStores(data)
  if (source) SOURCE_TEXT.set(backup, source)
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

/** Valeurs actuelles de toutes les clés de l'application. */
function snapshotApp(storage: StorageLike): Map<string, string> {
  const snapshot = new Map<string, string>()
  for (const k of appKeys(storage)) {
    const v = storage.getItem(k)
    if (v !== null) snapshot.set(k, v)
  }
  return snapshot
}

/**
 * Écrit tout ou rien : en cas d'échec (quota), l'état précédent des clés de l'application est restauré.
 * Ordre d'écriture qui limite l'occupation maximale : suppressions d'abord, puis les écritures qui
 * réduisent la place occupée, enfin celles qui l'augmentent le plus.
 */
function writeAll(storage: StorageLike, plan: WritePlan): { ok: true } | { ok: false; error: string; snapshot?: BackupFile } {
  const snapshot = snapshotApp(storage)
  const growth = ([k, val]: [string, string]) => val.length - (snapshot.has(k) ? (snapshot.get(k) as string).length : -k.length)
  const entries = [...plan.entries].sort((a, b) => growth(a) - growth(b))
  try {
    for (const k of plan.removed) storage.removeItem(k)
    for (const [k, val] of entries) storage.setItem(k, val)
  } catch (e) {
    if (!restoreSnapshot(storage, snapshot))
      return {
        ok: false,
        error:
          'Import interrompu : certaines de vos données n’ont pas pu être remises en place (un autre onglet d’ElevageSimu écrit-il en même temps ?). Téléchargez tout de suite la copie de vos données d’avant l’import (bouton ci-dessous), fermez les autres onglets, puis rechargez la page.',
        snapshot: exportAll(createMemoryStorage(snapshot)),
      }
    const quota = e instanceof Error && /quota/i.test(`${e.name} ${e.message}`)
    return {
      ok: false,
      error: quota
        ? 'Espace de stockage du navigateur insuffisant : import annulé, vos données n’ont pas changé. Libérez de la place (Réglages › Données : résultats recalculables des modes, journal ancien, ancienne copie) puis réessayez.'
        : 'Écriture impossible dans le stockage du navigateur : import annulé, vos données n’ont pas changé.',
    }
  }
  return { ok: true }
}

/**
 * Remet les clés de l'application dans l'état `snapshot`, quel que soit l'ordre des écritures faites
 * avant : (1) efface les clés absentes de l'instantané, (2) efface chaque clé dont la valeur a changé,
 * (3) réécrit leurs valeurs d'origine. Après (1) et (2), le stockage ne contient qu'un sous-ensemble de
 * l'état d'origine (qui tenait) : (3) ne peut pas dépasser le quota, sauf écriture concurrente d'un autre
 * onglet. Réessaie tant qu'il progresse ; vrai si tout est remis en place.
 */
function restoreSnapshot(storage: StorageLike, snapshot: Map<string, string>): boolean {
  try {
    for (const k of appKeys(storage)) if (!snapshot.has(k)) storage.removeItem(k)
  } catch {
    // Continuer : l'étape suivante libère aussi de la place.
  }
  let todo: string[] = []
  for (const [k, v] of snapshot) {
    let current: string | null = null
    try {
      current = storage.getItem(k)
    } catch {
      current = null
    }
    if (current === v) continue
    try {
      storage.removeItem(k)
    } catch {
      // Sera réessayée ci-dessous.
    }
    todo.push(k)
  }
  let progress = true
  while (todo.length && progress) {
    progress = false
    const left: string[] = []
    for (const k of todo) {
      try {
        storage.setItem(k, snapshot.get(k) as string)
        progress = true
      } catch {
        left.push(k)
      }
    }
    todo = left
  }
  return todo.length === 0
}

// ---------- Fusion des données d'un serveur ----------

/** Valeur `{state, version}` d'un store connu, normalisée (null si illisible ou d'une version plus récente). */
function readStoreText(key: string, text: string | null): { state: Record<string, unknown>; version: number } | null {
  if (text === null) return null
  try {
    const r = normalizeStoreValue(key, JSON.parse(text))
    return r.ok ? r.value : null
  } catch {
    return null
  }
}

/**
 * Prix saisis fusionnés clé par clé (objets, montures, générations) : `prefer` l'emporte en cas de doublon ;
 * valeur du généton de `prefer`, sinon de l'autre. Un prix absent n'est jamais compté comme 0.
 */
export function mergePriceStates(local: PricesData, incoming: PricesData, prefer: 'local' | 'incoming'): PricesData {
  const pick = <T>(a: Record<string, T>, b: Record<string, T>) => (prefer === 'local' ? { ...b, ...a } : { ...a, ...b })
  return {
    items: pick(local.items, incoming.items),
    mounts: pick(local.mounts, incoming.mounts),
    generations: pick(local.generations, incoming.generations),
    genetonValue: prefer === 'local' ? (local.genetonValue ?? incoming.genetonValue) : (incoming.genetonValue ?? local.genetonValue),
    updatedAt: Math.max(local.updatedAt || 0, incoming.updatedAt || 0),
  }
}

/** Instantané du marché le plus récent (date d'export, puis date d'import). */
export function newerMarketSnapshot(a: MarketSnapshot | null, b: MarketSnapshot | null): MarketSnapshot | null {
  if (!a) return b
  if (!b) return a
  if (a.exportDate !== b.exportDate) return a.exportDate > b.exportDate ? a : b
  return a.importedAt >= b.importedAt ? a : b
}

/** Historiques des imports réunis (un import par date d'import), plus récent en dernier. */
export function mergeMarketHistories(a: MarketHistoryEntry[], b: MarketHistoryEntry[]): MarketHistoryEntry[] {
  const byTime = new Map<number, MarketHistoryEntry>()
  for (const e of [...b, ...a]) byTime.set(e.importedAt, e)
  return [...byTime.values()].sort((x, y) => x.importedAt - y.importedAt).slice(-MARKET_HISTORY_MAX)
}

/**
 * Fusion d'une donnée de serveur (prix saisis, marché, historique) : texte à écrire, ou null pour garder
 * la valeur locale telle quelle (illisible ou d'une version plus récente : jamais écrasée par une fusion).
 */
function mergeServerValue(key: string, localText: string | null, incomingText: string, prefer: 'local' | 'incoming'): string | null {
  if (localText === null) return incomingText
  const local = readStoreText(key, localText)
  const incoming = readStoreText(key, incomingText)
  if (!local || !incoming) return null
  let state: Record<string, unknown>
  switch (persistedStoreInfo(key)?.base) {
    case 'prices':
      state = mergePriceStates(local.state as unknown as PricesData, incoming.state as unknown as PricesData, prefer) as unknown as Record<string, unknown>
      break
    case 'market':
      state = { snapshot: newerMarketSnapshot((local.state as unknown as MarketData).snapshot, (incoming.state as unknown as MarketData).snapshot) }
      break
    case 'market-history':
      state = { entries: mergeMarketHistories((local.state as unknown as MarketHistoryData).entries, (incoming.state as unknown as MarketHistoryData).entries) }
      break
    default:
      return prefer === 'local' ? localText : incomingText
  }
  return JSON.stringify({ state, version: local.version })
}

// ---------- Contenu des données d'un serveur ----------

/** Ce que contiennent les données d'un serveur (aperçu d'un import). */
export interface ServerDataSummary {
  /** Prix saisis (objets, montures, générations). */
  prices: number
  /** Valeur du généton saisie. */
  geneton: boolean
  /** Date de l'export HDV du marché importé (AAAA-MM-JJ), ou null sans marché. */
  marketExportDate: string | null
  /** Objets avec un prix dans le marché importé. */
  marketItems: number
  /** Imports HDV dans l'historique. */
  history: number
  /** Une donnée est illisible (ou d'une version plus récente) : à ne jamais écraser sans le dire. */
  unreadable: boolean
}

/** Aucune donnée (prix, marché, historique) ? */
export function isServerDataEmpty(d: ServerDataSummary): boolean {
  return !d.unreadable && d.prices === 0 && !d.geneton && d.marketExportDate === null && d.history === 0
}

function summarizeServerData(read: (base: 'prices' | 'market' | 'market-history') => { present: boolean; value: { state: Record<string, unknown> } | null }): ServerDataSummary {
  const out: ServerDataSummary = { prices: 0, geneton: false, marketExportDate: null, marketItems: 0, history: 0, unreadable: false }
  const prices = read('prices')
  if (prices.present && !prices.value) out.unreadable = true
  if (prices.value) {
    const st = prices.value.state
    out.prices = countOf(st.items) + countOf(st.mounts) + countOf(st.generations)
    out.geneton = typeof st.genetonValue === 'number'
  }
  const market = read('market')
  if (market.present && !market.value) out.unreadable = true
  const snap = market.value && isPlainObject(market.value.state.snapshot) ? market.value.state.snapshot : null
  if (snap) {
    out.marketExportDate = typeof snap.exportDate === 'string' ? snap.exportDate : '?'
    out.marketItems = countOf(snap.rows)
  }
  const history = read('market-history')
  if (history.present && !history.value) out.unreadable = true
  if (history.value) out.history = countOf(history.value.state.entries)
  return out
}

/** Données d'un serveur dans un stockage. */
export function serverDataSummary(storage: StorageLike, serverId: string): ServerDataSummary {
  return summarizeServerData((base) => {
    const key = serverStoreKey(serverId, base)
    const text = storage.getItem(key)
    return { present: text !== null, value: readStoreText(key, text) }
  })
}

/** Données du serveur contenues dans la sauvegarde d'un profil. */
function backupServerData(backup: BackupFile, serverId: string): ServerDataSummary {
  return summarizeServerData((base) => {
    const key = serverStoreKey(serverId, base)
    if (Object.hasOwn(backup.raw ?? {}, key)) return { present: true, value: null }
    if (!Object.hasOwn(backup.stores, key)) return { present: false, value: null }
    const r = normalizeStoreValue(key, backup.stores[key])
    return { present: true, value: r.ok ? r.value : null }
  })
}

/** Que devient le serveur d'une sauvegarde de profil à l'import (voir `planProfileServer`). */
export interface ProfileServerPlan {
  /**
   * 'create' : serveur ajouté ici avec les données du fichier ; 'existing' : serveur déjà présent ici (même
   * nom) ; 'adopt' : serveur d'ici de même identifiant, vide et sans autre profil, repris sous le nom et les
   * options de la sauvegarde.
   */
  action: 'create' | 'existing' | 'adopt'
  /** Serveur après l'import (identifiant d'ici). */
  server: ServerEntry
  /** Serveur d'ici concerné ('existing', 'adopt'), tel qu'il est avant l'import. */
  local: ServerEntry | null
  /** Données de ce serveur ici (null pour 'create'). */
  localData: ServerDataSummary | null
  /** Données du serveur dans la sauvegarde. */
  backupData: ServerDataSummary
  /** Les deux côtés ont des prix ou un marché : un choix `ServerDataChoice` s'applique (défaut 'keep'). */
  needsChoice: boolean
  /** Autres profils d'ici sur ce serveur (ils partagent ses prix). */
  sharedWith: string[]
  /** Serveur d'ici de même identifiant mais d'un autre nom : la sauvegarde n'y est PAS rattachée ('create'). */
  idConflict: ServerEntry | null
}

/**
 * Serveur d'une sauvegarde de profil face aux serveurs d'ici : même nom (casse et accents ignorés) → ce
 * serveur ; même identifiant mais autre nom → serveur distinct (jamais de rattachement silencieux), sauf si
 * le serveur d'ici est vide et sans autre profil (cas d'un navigateur neuf : « Mon serveur » est repris
 * sous le nom de la sauvegarde) ; sinon → nouveau serveur.
 */
export function planProfileServer(backup: BackupFile, storage: StorageLike, opts: { asNewProfile?: boolean; registry?: ProfilesRegistry | null } = {}): ProfileServerPlan | null {
  const scope = backup.scope
  if (scope?.kind !== 'profile') return null
  const reg = opts.registry ?? readRegistry(storage)
  const backupData = backupServerData(backup, scope.server.id)
  const replaced = !opts.asNewProfile && reg && profileById(reg, scope.profile.id) ? scope.profile.id : null
  const others = (sid: string) => (reg ? profilesOnServer(reg, sid).filter((p) => p.id !== replaced).map((p) => p.name) : [])
  const taken = idsWithData(storage)
  const newId = () => freeId(scope.server.name, [...(reg?.servers.map((x) => x.id) ?? []), ...taken.servers], 'serveur')
  const sameName = reg ? serverByName(reg, scope.server.name) : undefined
  if (sameName) {
    const localData = serverDataSummary(storage, sameName.id)
    return {
      action: 'existing',
      server: sameName,
      local: sameName,
      localData,
      backupData,
      needsChoice: !isServerDataEmpty(localData) && !isServerDataEmpty(backupData),
      sharedWith: others(sameName.id),
      idConflict: null,
    }
  }
  const sameId = reg ? serverById(reg, scope.server.id) : undefined
  if (sameId) {
    const localData = serverDataSummary(storage, sameId.id)
    if (isServerDataEmpty(localData) && others(sameId.id).length === 0)
      return { action: 'adopt', server: { ...scope.server, id: sameId.id }, local: sameId, localData, backupData, needsChoice: false, sharedWith: [], idConflict: null }
    return { action: 'create', server: { ...scope.server, id: newId() }, local: null, localData: null, backupData, needsChoice: false, sharedWith: [], idConflict: sameId }
  }
  const id = taken.servers.has(scope.server.id) ? newId() : scope.server.id
  return { action: 'create', server: { ...scope.server, id }, local: null, localData: null, backupData, needsChoice: false, sharedWith: [], idConflict: null }
}

/** Profils et serveurs d'un registre ajoutés à un autre (ceux d'ici gardés tels quels). */
function addMissingToRegistry(local: ProfilesRegistry, incoming: ProfilesRegistry): ProfilesRegistry {
  return {
    ...local,
    servers: [...local.servers, ...incoming.servers.filter((x) => !serverById(local, x.id))],
    profiles: [...local.profiles, ...incoming.profiles.filter((p) => !profileById(local, p.id))],
  }
}

/**
 * Restaure une sauvegarde (texte JSON, objet décodé ou `BackupFile`) dans le stockage, après validation.
 *  - sauvegarde complète (v1 ou v2) : 'replace' = l'état local devient celui du fichier (une sauvegarde v1
 *    sera migrée vers le profil « Principal » au rechargement) ; 'merge' = clés du fichier écrites,
 *    registres fusionnés, et une sauvegarde v1 est versée dans le profil actif (ses prix saisis fusionnés,
 *    clé par clé, avec ceux du serveur de ce profil) ;
 *  - registre du fichier illisible (sauvegarde v2) : reconstruit d'après les données du fichier ;
 *  - sauvegarde d'un profil : voir `importProfileBackup`.
 * En cas d'échec d'écriture (quota dépassé…), l'état précédent est restauré et une erreur est renvoyée.
 * Recharge ensuite l'application (option `reload`, vraie par défaut) pour relire tous les stores ; les
 * avertissements de l'import sont repris dans le message affiché au retour.
 */
export function importAll(input: unknown, opts: ImportOptions = {}): ImportResult {
  const mode: ImportMode = opts.mode ?? 'replace'
  const storage = resolveStorage(opts.storage)
  if (!storage) return { ok: false, error: 'Stockage du navigateur indisponible (navigation privée ?) : import impossible.' }
  const v = typeof input === 'string' ? parseBackup(input) : validateBackup(input)
  if (!v.ok) return v
  if (v.backup.scope?.kind === 'profile') return importProfileBackup(v.backup, { ...opts, storage, mode })

  const now = opts.now ?? Date.now()
  const warnings = [...v.warnings]
  let entries: [string, string][] = [
    ...Object.entries(v.backup.stores).map(([k, val]): [string, string] => [k, JSON.stringify(val)]),
    ...Object.entries(v.backup.raw ?? {}),
  ]
  const localRegistry = readRegistry(storage)
  const incomingRegistry = v.backup.stores[PROFILES_KEY] as ProfilesRegistry | undefined
  // Registre du fichier illisible (sauvegarde v2) : reconstruit d'après ses données (et sa copie de secours).
  const rebuilt =
    !incomingRegistry && v.backup.version >= 2 && entries.some(([k]) => parseStoreKey(k)?.kind === 'profile') ? rebuildRegistry(createMemoryStorage(entries), now) : null
  if (rebuilt) {
    const n = rebuilt.registry.profiles.length
    warnings.push(`Registre des profils reconstruit d’après les données du fichier : ${plural(n, 'profil')} (noms et serveurs à vérifier dans Réglages › Profils).`)
  }
  if (mode === 'merge' && localRegistry) {
    if (incomingRegistry) entries = entries.map(([k, val]): [string, string] => (k === PROFILES_KEY ? [k, JSON.stringify(mergeRegistries(localRegistry, incomingRegistry))] : [k, val]))
    else {
      if (rebuilt) entries.push([PROFILES_KEY, JSON.stringify(addMissingToRegistry(localRegistry, rebuilt.registry))])
      // Sauvegarde d'avant les profils : versée dans le profil actif et son serveur.
      const active = profileById(localRegistry, localRegistry.activeProfileId) ?? localRegistry.profiles[0]
      const activeServer = serverById(localRegistry, active.serverId)
      let moved = 0
      let pricesMerged = false
      let pricesKept = false
      const mapped: [string, string][] = []
      for (const [k, val] of entries) {
        const target = parseStoreKey(k)?.kind === 'legacy' ? migratedKey(k, active.id, active.serverId) : null
        if (!target) {
          mapped.push([k, val])
          continue
        }
        moved++
        if (persistedStoreInfo(target)?.base === 'prices') {
          // Prix du SERVEUR (partagés par ses profils) : fusionnés clé par clé, jamais remplacés en bloc.
          const local = storage.getItem(target)
          const merged = mergeServerValue(target, local, val, 'incoming')
          if (merged === null) pricesKept = true
          else {
            if (local !== null) pricesMerged = true
            mapped.push([target, merged])
          }
          continue
        }
        mapped.push([target, val])
      }
      entries = mapped
      if (moved) {
        const shared = profilesOnServer(localRegistry, active.serverId).map((p) => `« ${p.name} »`)
        const serverName = activeServer?.name ?? active.serverId
        warnings.push(`Sauvegarde d’avant les profils : ${plural(moved, 'donnée versée', 'données versées')} dans le profil « ${active.name} ».`)
        if (pricesMerged)
          warnings.push(
            `Ses prix saisis sont ajoutés à ceux du serveur « ${serverName} » (ceux du fichier l’emportent en cas de doublon ; vos autres prix sont gardés), partagés par ${plural(shared.length, 'profil')} : ${shared.join(', ')}.`,
          )
        if (pricesKept) warnings.push(`Prix saisis du serveur « ${serverName} » illisibles ou d’une version plus récente ici : gardés tels quels, ceux du fichier ne sont pas importés.`)
      }
    }
  } else if (rebuilt) entries.push([PROFILES_KEY, JSON.stringify(rebuilt.registry)])
  entries = resyncLegacyFingerprints(entries, originalStores(input), incomingRegistry)
  const incoming = new Set(entries.map(([k]) => k))
  const removed = mode === 'replace' ? appKeys(storage).filter((k) => !incoming.has(k)) : []
  const w = writeAll(storage, { entries, removed })
  if (!w.ok) return w
  if (opts.reload ?? true) {
    freezeWrites()
    // Tout remplacé : l'onglet ouvre le profil actif du fichier ; fusion : il garde son profil.
    if (mode === 'replace') clearTabProfile()
    reloadApp(
      [`Sauvegarde importée : ${entries.length} élément${entries.length > 1 ? 's' : ''} restauré${entries.length > 1 ? 's' : ''}.`, ...warnings.slice(v.warnings.length)].join(' '),
    )
  }
  return { ok: true, mode, written: [...incoming].sort(), removed, warnings }
}

/** Sauvegarde validée → texte d'origine de ses données (le fichier avant normalisation). */
const SOURCE_TEXT = new WeakMap<object, Record<string, string>>()

/**
 * Texte d'origine de chaque donnée du fichier (avant normalisation), pour comparer les empreintes : celui
 * du fichier lu par `validateBackup` quand on importe la sauvegarde qu'elle a renvoyée (Réglages).
 */
function originalStores(input: unknown): Record<string, string> | null {
  if (typeof input === 'object' && input !== null && SOURCE_TEXT.has(input)) return SOURCE_TEXT.get(input) ?? null
  let data = input
  if (typeof input === 'string')
    try {
      data = JSON.parse(input)
    } catch {
      return null
    }
  if (!isPlainObject(data) || !isPlainObject(data.stores)) return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(data.stores)) out[k] = JSON.stringify(v)
  if (isPlainObject(data.raw)) for (const [k, v] of Object.entries(data.raw)) if (typeof v === 'string') out[k] = v
  return out
}

/**
 * Empreintes des anciennes clés (copie d'avant les profils) après un import complet : la normalisation de
 * la sauvegarde peut réécrire leur valeur (champ ajouté par une migration…). Une ancienne clé à jour dans le
 * fichier (sa valeur d'origine correspond à l'empreinte du registre du fichier) reçoit l'empreinte de la
 * valeur réellement écrite : sinon l'alerte « Données modifiées par l'ancienne version » se lèverait à tort
 * après chaque restauration. Une clé déjà divergente dans le fichier (modifiée après la reprise, ou
 * déplacée puis réécrite) garde son empreinte : l'alerte reste justifiée.
 */
function resyncLegacyFingerprints(entries: [string, string][], original: Record<string, string> | null, incomingRegistry: ProfilesRegistry | undefined): [string, string][] {
  const ri = entries.findIndex(([k]) => k === PROFILES_KEY)
  if (ri < 0) return entries
  let reg: ProfilesRegistry
  try {
    reg = JSON.parse(entries[ri][1]) as ProfilesRegistry
  } catch {
    return entries
  }
  const l = reg.legacy
  if (!l || l.removedAt) return entries
  const fileLegacy = incomingRegistry?.legacy
  const fingerprints = { ...l.fingerprints }
  const known = new Set(l.keys)
  const moved = new Set(l.moved)
  let changed = false
  for (const [k, val] of entries) {
    if (parseStoreKey(k)?.kind !== 'legacy') continue
    if (fileLegacy?.moved.includes(k)) continue
    const fp = fileLegacy?.fingerprints?.[k]
    const text = original?.[k]
    if (fp && (text === undefined || fp.len !== text.length || fp.hash !== hashText(text))) continue
    fingerprints[k] = fingerprintOf(val)
    known.add(k)
    moved.delete(k)
    changed = true
  }
  if (!changed) return entries
  const next: ProfilesRegistry = { ...reg, legacy: { ...l, keys: [...known].sort(), moved: [...moved].sort(), fingerprints } }
  return entries.map(([k, v], i): [string, string] => (i === ri ? [k, JSON.stringify(next)] : [k, v]))
}

/**
 * Restaure la sauvegarde d'UN profil sans toucher aux autres :
 *  - profil : même identifiant (remplacé : 'replace' efface d'abord ses données absentes du fichier), ou
 *    nouveau profil (copie) si `asNewProfile` ; un nom déjà pris reçoit un suffixe « (2) » ; le profil
 *    importé devient le profil actif (et celui de cet onglet) ;
 *  - serveur (`planProfileServer`) : créé avec les données du fichier s'il n'existe pas ici ; s'il existe
 *    (même nom) sans prix ni marché, ceux du fichier y sont écrits ; s'il en a, `serverData` décide
 *    ('keep' par défaut, 'replace' ou 'merge') ; même identifiant mais autre nom → serveur distinct (ou
 *    serveur vide d'ici repris sous le nom du fichier).
 * Les avertissements sont renvoyés ET repris dans le message affiché après le rechargement.
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
  const plan = planProfileServer(backup, storage, { asNewProfile: opts.asNewProfile, registry: reg })
  if (!plan) return { ok: false, error: 'Ce n’est pas la sauvegarde d’un profil.' }

  // Serveur.
  const serverId = plan.server.id
  const backupHasData = !isServerDataEmpty(plan.backupData)
  /** Données du serveur : écrites telles quelles, fusionnées, ou gardées (rien n'est écrit). */
  let serverWrite: ServerDataChoice = 'replace'
  const shared = plan.sharedWith.length ? `, partagés aussi par ${plan.sharedWith.map((n) => `« ${n} »`).join(', ')}` : ''
  if (plan.action === 'create') {
    reg = { ...reg, servers: [...reg.servers, plan.server] }
    if (plan.idConflict)
      warnings.push(
        `Le serveur « ${scope.server.name} » de la sauvegarde a le même identifiant que « ${plan.idConflict.name} » ici, mais pas le même nom : il est ajouté comme un serveur distinct. S’il s’agit du même serveur, rattachez-y vos profils puis supprimez l’autre (Réglages › Profils).`,
      )
  } else if (plan.action === 'adopt') {
    reg = { ...reg, servers: reg.servers.map((x) => (x.id === serverId ? plan.server : x)) }
    if (plan.local && slugify(plan.local.name) !== slugify(plan.server.name))
      warnings.push(`Serveur « ${plan.local.name} » (vide, sans autre profil) renommé « ${plan.server.name} » d’après la sauvegarde.`)
  } else if (plan.needsChoice) {
    serverWrite = opts.serverData ?? 'keep'
    if (serverWrite === 'keep') warnings.push(`Serveur « ${plan.server.name} » déjà présent avec ses propres prix : ceux de ce navigateur sont gardés (ceux de la sauvegarde ne sont pas importés).`)
    if (serverWrite === 'replace') warnings.push(`Serveur « ${plan.server.name} » : prix et marché remplacés par ceux de la sauvegarde${shared}.`)
    if (serverWrite === 'merge')
      warnings.push(`Serveur « ${plan.server.name} » : prix de la sauvegarde ajoutés à ceux de ce navigateur (ceux de ce navigateur gardés en cas de doublon), marché le plus récent gardé${shared}.`)
  } else if (plan.localData && !isServerDataEmpty(plan.localData)) serverWrite = 'keep'
  if (backupHasData && serverWrite === 'replace' && (plan.action !== 'existing' || !plan.needsChoice))
    warnings.push(`Prix et marché du serveur « ${plan.server.name} » repris de la sauvegarde.`)

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
  delete entry.serverToCheck
  reg = { ...reg, profiles: [...reg.profiles.filter((p) => p.id !== profileId), entry], activeProfileId: profileId }

  const entries: [string, string][] = []
  const removed: string[] = []
  const pPrefix = profileKeyPrefix(scope.profile.id)
  const sPrefix = serverKeyPrefix(scope.server.id)
  const targetServerPrefix = serverKeyPrefix(serverId)
  const all: [string, string][] = [...Object.entries(backup.stores).map(([k, val]): [string, string] => [k, JSON.stringify(val)]), ...Object.entries(backup.raw ?? {})]
  for (const [k, val] of all) {
    if (k.startsWith(pPrefix)) entries.push([profileStoreKey(profileId, k.slice(pPrefix.length)), val])
    else if (k.startsWith(sPrefix) && serverWrite !== 'keep') {
      const target = `${targetServerPrefix}${k.slice(sPrefix.length)}`
      if (serverWrite === 'replace') entries.push([target, val])
      else {
        const merged = mergeServerValue(target, storage.getItem(target), val, 'local')
        if (merged !== null) entries.push([target, merged])
      }
    }
  }
  entries.push([PROFILES_KEY, JSON.stringify(reg)])
  const incoming = new Set(entries.map(([k]) => k))
  if (mode === 'replace') removed.push(...keysWithPrefix(storage, profileKeyPrefix(profileId)).filter((k) => !incoming.has(k)))
  // Serveur remplacé : son état devient celui de la sauvegarde (clés absentes du fichier effacées).
  if (serverWrite === 'replace' && plan.action !== 'create' && backupHasData) removed.push(...keysWithPrefix(storage, targetServerPrefix).filter((k) => !incoming.has(k)))
  const w = writeAll(storage, { entries, removed })
  if (!w.ok) return w
  if (opts.reload ?? true) {
    freezeWrites()
    writeTabProfile(profileId)
    reloadApp([`Profil « ${name} » importé et ouvert.`, ...warnings].join(' '))
  }
  return { ok: true, mode, written: [...incoming].sort(), removed, warnings, profileId }
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
    clearTabProfile()
    reloadApp('Toutes les données de l’application ont été effacées.')
  }
  return removed
}

/**
 * Place occupée, en CARACTÈRES (longueur de la clé + longueur de la valeur) : l'unité du quota du
 * localStorage dans Chrome, Edge et Firefox (≈ 5,2 millions de caractères par site, quels que soient les
 * caractères). Safari compte des octets UTF-16 : sa limite vaut environ moitié moins de caractères
 * (`storageQuotaChars`).
 */
export interface StorageUsage {
  /** Total des données de l'application (caractères). */
  totalChars: number
  entries: { key: string; label: string; chars: number; regenerable: boolean }[]
}

/** Place occupée par chaque clé de l'application (triée de la plus grosse à la plus petite). */
export function storageUsage(storage?: StorageLike | null): StorageUsage {
  const s = resolveStorage(storage)
  if (!s) return { totalChars: 0, entries: [] }
  const reg = readRegistry(s)
  const names = reg ? scopeNamesOf(reg) : undefined
  const entries = appKeys(s).map((key) => ({ key, label: storeLabel(key, names), chars: key.length + (s.getItem(key)?.length ?? 0), regenerable: isRegenerableKey(key) }))
  entries.sort((a, b) => b.chars - a.chars || a.key.localeCompare(b.key))
  return { totalChars: entries.reduce((t, e) => t + e.chars, 0), entries }
}

/** Limite du localStorage dans Chrome, Edge et Firefox : 5 Mi caractères (clés + valeurs) par site. */
export const TYPICAL_STORAGE_QUOTA_CHARS = 5 * 1024 * 1024
/** Limite (en caractères) des navigateurs WebKit (Safari, tous les navigateurs sur iPhone et iPad), qui comptent 2 octets par caractère. */
export const WEBKIT_STORAGE_QUOTA_CHARS = TYPICAL_STORAGE_QUOTA_CHARS / 2

/**
 * Navigateur WebKit (Safari sur Mac, tout navigateur sur iPhone ou iPad) : quota compté en octets UTF-16,
 * soit moitié moins de caractères. D'après l'identifiant du navigateur (`navigator.userAgent`).
 */
export function isWebKitStorage(userAgent: string): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true
  return /AppleWebKit\//.test(userAgent) && /Safari\//.test(userAgent) && !/(Chrome|Chromium|Edg|OPR|Firefox)\//.test(userAgent)
}

/** Limite du localStorage (caractères) pour ce navigateur (défaut : `navigator.userAgent`). */
export function storageQuotaChars(userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): number {
  return isWebKitStorage(userAgent) ? WEBKIT_STORAGE_QUOTA_CHARS : TYPICAL_STORAGE_QUOTA_CHARS
}

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

/**
 * Ajoute un message à celui qui sera affiché au prochain affichage de l'application (avant le premier
 * rendu : message du chargement en cours ; sinon : après le prochain rechargement).
 */
export function appendFlash(message: string): void {
  try {
    const current = window.sessionStorage.getItem(FLASH_KEY)
    window.sessionStorage.setItem(FLASH_KEY, current ? `${current} ${message}` : message)
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
