// Sauvegarde locale de toutes les données de l'application : export, import, remise à zéro.
//
// Toutes les données vivent dans le localStorage du navigateur, sous des clés « elevagesimu:* »
// (stores zustand persistés + préférences d'affichage des pages). Une sauvegarde est un fichier JSON :
//   { app: 'ElevageSimu', version: 1, exportedAt: ISO, stores: { 'elevagesimu:xxx': valeur décodée } }
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
import { pendingWrites } from '../store/persistence'
import { plural } from './format'
import { PERSISTED_STORES, normalizeStoreValue } from '../store/schema'

export const BACKUP_APP = 'ElevageSimu'
/** Version du format de sauvegarde (à incrémenter si la structure du fichier change). */
export const BACKUP_VERSION = 1
/** Préfixe de toutes les clés de l'application dans le localStorage. */
export const STORAGE_PREFIX = 'elevagesimu:'

/** Sous-ensemble de l'API Web Storage utilisé ici (localStorage ou faux stockage de test). */
export interface StorageLike {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Contenu d'un fichier de sauvegarde. */
export interface BackupFile {
  app: typeof BACKUP_APP
  version: number
  /** Date d'export (ISO 8601). */
  exportedAt: string
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
   * 'replace' (défaut) : l'état local devient exactement celui de la sauvegarde (les clés absentes
   * de la sauvegarde sont effacées). 'merge' : seules les clés présentes dans la sauvegarde sont écrites.
   */
  mode?: ImportMode
  /** Stockage cible (défaut : localStorage du navigateur). */
  storage?: StorageLike | null
  /** Recharger l'application après l'import (défaut : vrai ; sans effet hors navigateur). */
  reload?: boolean
}

export type ImportResult =
  | { ok: true; mode: ImportMode; written: string[]; removed: string[]; warnings: string[] }
  | { ok: false; error: string }

/** Stores zustand persistés de l'application : leur valeur doit avoir la forme `{ state: {…}, version }`. */
export const KNOWN_STORES: Record<string, string> = Object.fromEntries(Object.entries(PERSISTED_STORES).map(([k, v]) => [k, v.label]))

/** Version actuelle du schéma de chaque store persisté (une sauvegarde plus récente est refusée). */
export const STORE_VERSIONS: Record<string, number> = Object.fromEntries(Object.entries(PERSISTED_STORES).map(([k, v]) => [k, v.version]))

/** Préférences d'affichage connues (une par page). */
const PAGE_PREFS: Record<string, string> = {
  'elevagesimu:metier': 'Préférences de la page Métier',
  'elevagesimu:rentabilite': 'Préférences de la page Rentabilité',
  'elevagesimu:optimiseur': 'Préférences de l’Optimiseur',
  'elevagesimu:montures-ui': 'Préférences de la page Montures',
  'elevagesimu:enclos-notifications': 'Notifications des enclos',
}

/** Libellé lisible d'une clé de stockage. */
export function storeLabel(key: string): string {
  return KNOWN_STORES[key] ?? PAGE_PREFS[key] ?? `Préférences (${key.slice(STORAGE_PREFIX.length) || key})`
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

/**
 * Instantané de toutes les données de l'application. `pending` : valeurs (texte JSON) plus récentes que
 * celles du stockage, à exporter à leur place — les modifications qu'un quota plein a empêché
 * d'enregistrer (`pendingWrites()`), pour qu'une sauvegarde faite à ce moment-là ne les perde pas.
 */
export function exportAll(storage?: StorageLike | null, now: Date = new Date(), pending: Record<string, string> = {}): BackupFile {
  const s = resolveStorage(storage)
  const stores: Record<string, unknown> = {}
  const raw: Record<string, string> = {}
  const keys = new Set([...appKeys(s), ...Object.keys(pending).filter(isAppKey)])
  for (const key of [...keys].sort()) {
    const value = Object.hasOwn(pending, key) ? pending[key] : (s?.getItem(key) ?? null)
    if (value === null) continue
    try {
      stores[key] = JSON.parse(value) as unknown
    } catch {
      raw[key] = value
    }
  }
  const backup: BackupFile = { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), stores }
  if (Object.keys(raw).length) backup.raw = raw
  return backup
}

/** Texte JSON (indenté) d'une sauvegarde. */
export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2)
}

/** Nom de fichier proposé : « elevagesimu-sauvegarde-2026-10-02-14h05.json » (heure locale). */
export function backupFileName(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `elevagesimu-sauvegarde-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}h${p(date.getMinutes())}.json`
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
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

  const warnings: string[] = []
  const stores: Record<string, unknown> = {}
  const raw: Record<string, string> = {}
  let foreign = 0
  for (const [key, value] of Object.entries(data.stores)) {
    if (!isAppKey(key)) {
      foreign++
      continue
    }
    if (key in KNOWN_STORES) {
      // Forme, version (une version plus récente est refusée), migration et normalisation.
      const checked = normalizeStoreValue(key, value)
      if (!checked.ok) return { ok: false, error: `${checked.error} Import annulé, rien n’a été modifié.` }
      for (const issue of checked.issues) warnings.push(`${KNOWN_STORES[key]} : ${issue}.`)
      stores[key] = checked.value
      continue
    }
    stores[key] = value
  }
  if (isPlainObject(data.raw))
    for (const [key, value] of Object.entries(data.raw)) {
      if (!isAppKey(key) || key in stores) {
        foreign++
        continue
      }
      if (typeof value !== 'string') return { ok: false, error: `Valeur brute invalide pour « ${key} » dans la sauvegarde.` }
      if (key in KNOWN_STORES) return { ok: false, error: `Données « ${KNOWN_STORES[key]} » illisibles dans la sauvegarde : import annulé.` }
      raw[key] = value
    }
  if (foreign > 0) warnings.unshift(`${foreign} donnée${foreign > 1 ? 's' : ''} étrangère${foreign > 1 ? 's' : ''} à l’application ignorée${foreign > 1 ? 's' : ''}.`)

  let exportedAt = typeof data.exportedAt === 'string' ? data.exportedAt : ''
  if (!exportedAt || Number.isNaN(Date.parse(exportedAt))) {
    warnings.push('Date d’export absente ou illisible.')
    exportedAt = ''
  }
  const keys = [...Object.keys(stores), ...Object.keys(raw)].sort()
  if (keys.length === 0) warnings.push('La sauvegarde est vide : en mode « remplacer », toutes vos données actuelles seraient effacées.')
  const backup: BackupFile = { app: BACKUP_APP, version, exportedAt, stores }
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
 * Restaure une sauvegarde (texte JSON, objet décodé ou `BackupFile`) dans le stockage, après validation.
 * En cas d'échec d'écriture (quota dépassé…), l'état précédent est restauré et une erreur est renvoyée.
 * Recharge ensuite l'application (option `reload`, vraie par défaut) pour relire tous les stores.
 */
export function importAll(input: unknown, opts: ImportOptions = {}): ImportResult {
  const mode: ImportMode = opts.mode ?? 'replace'
  const storage = resolveStorage(opts.storage)
  if (!storage) return { ok: false, error: 'Stockage du navigateur indisponible (navigation privée ?) : import impossible.' }
  const v = typeof input === 'string' ? parseBackup(input) : validateBackup(input)
  if (!v.ok) return v

  const entries: [string, string][] = [
    ...Object.entries(v.backup.stores).map(([k, val]): [string, string] => [k, JSON.stringify(val)]),
    ...Object.entries(v.backup.raw ?? {}),
  ]
  const incoming = new Set(entries.map(([k]) => k))
  const existing = appKeys(storage)
  const snapshot = new Map(existing.map((k) => [k, storage.getItem(k)]))
  const removed = mode === 'replace' ? existing.filter((k) => !incoming.has(k)) : []
  try {
    for (const k of removed) storage.removeItem(k)
    for (const [k, val] of entries) storage.setItem(k, val)
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
  if (opts.reload ?? true) reloadApp(`Sauvegarde importée : ${entries.length} élément${entries.length > 1 ? 's' : ''} restauré${entries.length > 1 ? 's' : ''}.`)
  return { ok: true, mode, written: [...incoming].sort(), removed, warnings: v.warnings }
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
  if (opts.reload ?? true) reloadApp('Toutes les données de l’application ont été effacées.')
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
  const entries = appKeys(s).map((key) => ({ key, label: storeLabel(key), bytes: 2 * (key.length + (s.getItem(key)?.length ?? 0)) }))
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
  for (const key of [...Object.keys(backup.stores), ...Object.keys(backup.raw ?? {})].sort()) {
    const st = stateOf(backup.stores[key])
    let detail: string | null = null
    if (st)
      switch (key) {
        case 'elevagesimu:inventory':
          detail = plural(countOf(st.mounts), 'monture', 'montures')
          break
        case 'elevagesimu:journal':
          detail = plural(countOf(st.entries), 'entrée', 'entrées')
          break
        case 'elevagesimu:prices': {
          const parts = [plural(countOf(st.items), 'prix d’objet', 'prix d’objets'), plural(countOf(st.mounts) + countOf(st.generations), 'prix de monture', 'prix de montures')]
          if (typeof st.genetonValue === 'number') parts.push('valeur du généton')
          detail = parts.join(', ')
          break
        }
        case 'elevagesimu:paddockPlans':
          detail = plural(countOf(st.plans), 'plan en cours', 'plans en cours')
          break
        case 'elevagesimu:paddocks':
          detail = plural(countOf(st.paddocks), 'enclos', 'enclos')
          break
        case 'elevagesimu:planProgress':
          detail = [plural(countOf(st.checked), 'case cochée', 'cases cochées'), plural(countOf(st.done), 'conseil fait', 'conseils faits')].join(', ')
          break
        case 'elevagesimu:settings': {
          const parts: string[] = []
          if (typeof st.ruleset === 'string') parts.push(`règles ${st.ruleset}`)
          if (typeof st.jobLevel === 'number') parts.push(`Éleveur niv. ${st.jobLevel}`)
          if (typeof st.server === 'string' && st.server.trim()) parts.push(`serveur ${st.server.trim()}`)
          detail = parts.length ? parts.join(', ') : null
          break
        }
      }
    lines.push({ key, label: storeLabel(key), detail })
  }
  return lines
}

// ---------- Navigateur ----------

/**
 * Télécharge une sauvegarde (défaut : instantané actuel, modifications non enregistrées comprises —
 * voir `exportAll`). Renvoie le nom du fichier.
 */
export function downloadBackup(backup: BackupFile = exportAll(undefined, new Date(), pendingWrites()), date: Date = new Date()): string {
  const name = backupFileName(date)
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
