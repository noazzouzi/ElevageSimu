// Profils (un élevage = un compte sur un serveur) et serveurs (une économie : prix saisis et marché
// importé). Le profil actif est résolu de façon SYNCHRONE au chargement de ce module, avant la création
// des stores : ses clés (`STORE_KEYS`, `profileKey`, `serverKey`) sont fixes pendant toute la vie de la
// page ; changer de profil enregistre le registre puis recharge l'application.
// Chaque onglet garde son profil (sessionStorage, src/store/tabProfile.ts) : `registry.activeProfileId`
// n'est que le profil ouvert par défaut dans un nouvel onglet.
//
// Logique pure (registre, migration, démarrage) : src/store/profileRegistry.ts ; clés : src/store/schema.ts.
// Documentation : docs/api/profiles.md.
import { create } from 'zustand'
import { type PriceStat } from '../domain/market'
import { appendFlash, reloadApp, storeLabel } from '../lib/backup'
import { plural } from '../lib/format'
import { pendingWrites, freezeWrites, reportStorageIssue, safeWriteText, tryWriteText, useStorageHealth } from './persistence'
import {
  DEFAULT_PROFILE_ID,
  acknowledgeLegacyKeys,
  activeProfileOf,
  addProfile,
  addServer,
  bootProfiles,
  copyProfileData,
  idsWithData,
  legacyDivergence,
  migratedKey,
  profileById,
  removeLegacyCopy as removeLegacyKeys,
  removeProfile,
  removeProfileData,
  removeServer,
  removeServerData,
  renameProfile,
  renameServer,
  resolveOpenProfile,
  sanitizeRegistry,
  serverById,
  setActiveProfile,
  setProfileColor,
  setProfileServer,
  setServerOptions,
  type BootMode,
  type BootResult,
  type ProfileColor,
  type ProfileEntry,
  type ProfilesRegistry,
  type RegistryResult,
  type ServerEntry,
} from './profileRegistry'
import {
  GLOBAL_KEYS,
  LEGACY_STORE_KEYS,
  PROFILES_KEY,
  PROFILES_SHADOW_KEY,
  STORAGE_PREFIX,
  parseStoreKey,
  profileKeyPrefix,
  profileStoreKey,
  serverKeyPrefix,
  serverStoreKey,
  storeKeysFor,
  type StorageLike,
  type StoreBase,
} from './schema'
import { clearTabProfile, readTabProfile, writeTabProfile } from './tabProfile'

export type { BootMode, ProfileColor, ProfileEntry, ProfilesRegistry, ServerEntry } from './profileRegistry'

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

// ---------- Démarrage (synchrone) ----------

const boot: BootResult = bootProfiles(browserStorage(), Date.now())
for (const issue of boot.issues) reportStorageIssue({ key: PROFILES_KEY, kind: issue.kind, message: issue.message, label: 'Profils et serveurs' })

// Profil de CET onglet (s'il existe encore), sinon le profil par défaut du registre.
const opened = boot.mode === 'profiles' ? resolveOpenProfile(boot.registry, readTabProfile()) : { profile: activeProfileOf(boot.registry), missing: null }
const activeAtBoot = opened.profile
if (boot.mode === 'profiles') writeTabProfile(activeAtBoot.id)
if (opened.missing) appendFlash(`Le profil de cet onglet a été supprimé : « ${activeAtBoot.name} » ouvert.`)
if (boot.migrated)
  appendFlash(
    'Vos données ont été reprises dans le profil « Principal ». Fermez ou rechargez les autres onglets ElevageSimu encore ouverts sur l’ancienne version : ce qu’ils enregistreraient désormais ne serait plus repris.',
  )

/** Profil ouvert dans cette page (fixe jusqu'au prochain chargement). */
export const ACTIVE_PROFILE_ID: string = activeAtBoot.id
/** Serveur du profil ouvert (fixe jusqu'au prochain chargement). */
export const ACTIVE_SERVER_ID: string = activeAtBoot.serverId
/** Mode de fonctionnement du stockage des profils (voir `BootMode`). */
export const PROFILE_MODE: BootMode = boot.mode
/** Les anciennes données viennent d'être reprises dans le profil « Principal » (premier chargement de la v2). */
export const MIGRATED_AT_BOOT: boolean = boot.migrated

/**
 * Clés localStorage des stores du profil ouvert (« elevagesimu:p:<profil>:<base> ») et de son serveur
 * (« elevagesimu:s:<serveur>:prices|market|market-history »). En mode `legacy` (migration impossible),
 * les anciennes clés.
 */
export const STORE_KEYS: Record<StoreBase, string> =
  boot.mode === 'legacy' ? { ...storeKeysFor(ACTIVE_PROFILE_ID, ACTIVE_SERVER_ID), ...LEGACY_STORE_KEYS } : storeKeysFor(ACTIVE_PROFILE_ID, ACTIVE_SERVER_ID)

/**
 * Clé d'une préférence de page (ou de toute donnée) propre au profil ouvert :
 * `profileKey('montures-ui')` → « elevagesimu:p:<profil>:montures-ui ». À utiliser par toute page qui
 * enregistre ses préférences dans le localStorage (elles suivent ainsi le profil, et sa sauvegarde).
 */
export function profileKey(base: string): string {
  return boot.mode === 'legacy' ? `${STORAGE_PREFIX}${base}` : profileStoreKey(ACTIVE_PROFILE_ID, base)
}

/** Clé d'une donnée propre au serveur du profil ouvert (« elevagesimu:s:<serveur>:<base> »). */
export function serverKey(base: string): string {
  return serverStoreKey(ACTIVE_SERVER_ID, base)
}

/**
 * Des modifications du profil ouvert (ou de son serveur) n'ont pas pu être enregistrées (quota plein) :
 * elles seraient perdues en ouvrant un autre profil ou en changeant de serveur (rechargement).
 */
export function hasPendingForActive(): boolean {
  const own = new Set<string>(Object.values(STORE_KEYS))
  const prefixes = [profileKeyPrefix(ACTIVE_PROFILE_ID), serverKeyPrefix(ACTIVE_SERVER_ID)]
  return Object.keys(pendingWrites()).some((k) => own.has(k) || prefixes.some((p) => k.startsWith(p)))
}

/** Message du refus `code: 'pending'` (changement de profil ou de serveur avec des modifications non enregistrées). */
export const PENDING_SWITCH_ERROR =
  'Des modifications de ce profil ne sont pas enregistrées (stockage plein) : elles seront perdues si l’application se recharge sur un autre profil ou serveur.'

// ---------- Copie des données d'avant les profils modifiée après la reprise ----------

/** Clé (fictive) de l'alerte « données modifiées par l'ancienne version ». */
const DIVERGENCE_ISSUE_KEY = 'elevagesimu:ancienne-copie'

/** Signale (ou retire) l'alerte des anciennes clés réécrites après la reprise. */
function checkLegacyDivergence(ls: StorageLike, registry: ProfilesRegistry): void {
  const diverged = legacyDivergence(ls, registry)
  if (!diverged.length) {
    useStorageHealth.getState().dismiss(DIVERGENCE_ISSUE_KEY, 'divergence')
    return
  }
  const n = diverged.length
  reportStorageIssue({
    key: DIVERGENCE_ISSUE_KEY,
    kind: 'divergence',
    label: 'Données d’avant les profils',
    message: `${plural(n, 'donnée')} de la copie d’avant les profils ${n > 1 ? 'ont été modifiées' : 'a été modifiée'} après la reprise dans le profil « Principal » (onglet resté ouvert sur l’ancienne version d’ElevageSimu ?) : ${diverged.map((k) => storeLabel(k)).join(', ')}. Ces changements ne sont pas dans vos profils : reprenez-les ou ignorez-les dans Réglages › Profils, et fermez les onglets restés sur l’ancienne version.`,
  })
}

// ---------- Store ----------

/**
 * Résultat d'une action. `code: 'pending'` : refus parce que des modifications ne sont pas enregistrées
 * (quota) et seraient perdues au rechargement ; l'interface propose une sauvegarde puis réessaie avec
 * `{force: true}` (src/ui/confirmPending.ts).
 */
export type ActionResult = { ok: true; id?: string; message?: string } | { ok: false; error: string; code?: 'pending' }

/** Option des actions qui rechargent l'application : passer outre les modifications non enregistrées. */
export interface ForceOption {
  force?: boolean
}

export interface CreateProfileInput {
  name: string
  /** Serveur existant… */
  serverId?: string
  /** … ou nom d'un nouveau serveur à créer. */
  newServerName?: string
  /** Copier les données (montures, réglages, journal…) de ce profil. */
  duplicateFrom?: string
  color?: ProfileColor
}

interface ProfilesStore {
  registry: ProfilesRegistry
  mode: BootMode
  /** Gestion des profils impossible (registre d'une version plus récente, ou mode `legacy`). */
  readOnly: boolean
  /** Raison du blocage (à afficher), ou null. */
  readOnlyReason: string | null
  createProfile: (input: CreateProfileInput) => ActionResult
  /** Copie d'un profil (toutes ses données), sur le même serveur ; nom par défaut « <nom> (copie) ». */
  duplicateProfile: (id: string, name?: string) => ActionResult
  renameProfile: (id: string, name: string) => ActionResult
  /** Change le serveur d'un profil (profil ouvert : recharge ; refus `pending` sans `force`). */
  setProfileServer: (id: string, serverId: string, opts?: ForceOption) => ActionResult
  setProfileColor: (id: string, color: ProfileColor | null) => ActionResult
  /** Supprime un profil et ses données (le profil ouvert : bascule sur un autre et recharge). */
  deleteProfile: (id: string) => ActionResult
  createServer: (name: string, opts?: { priceStat?: PriceStat }) => ActionResult
  renameServer: (id: string, name: string) => ActionResult
  setServerOptions: (id: string, opts: { priceStat?: PriceStat; maxMarketShare?: number }) => ActionResult
  /** Supprime un serveur sans profil, avec ses prix et son marché. */
  deleteServer: (id: string) => ActionResult
  /**
   * Ouvre un autre profil dans cet onglet (enregistre le registre et le choix de l'onglet puis recharge ;
   * `flash` : message affiché après). Refus `code: 'pending'` si des modifications ne sont pas enregistrées,
   * sauf avec `{force: true}`.
   */
  switchProfile: (id: string, flash?: string, opts?: ForceOption) => ActionResult
  /**
   * Supprime la copie des données d'avant les profils (registre enregistré d'abord, clés effacées ensuite).
   * Refusé si une ancienne clé a été modifiée après la reprise (`legacyDivergence`), sauf avec `{force: true}`.
   */
  removeLegacyCopy: (opts?: ForceOption) => ActionResult
  /** Reprend dans le profil « Principal » les anciennes clés modifiées après la reprise (remplace ses données correspondantes), puis recharge. */
  adoptLegacyChanges: (keys: string[]) => ActionResult
  /** Ignore les modifications des anciennes clés (elles redeviennent supprimables). */
  ignoreLegacyChanges: (keys: string[]) => ActionResult
}

const READ_ONLY_REASONS: Partial<Record<BootMode, string>> = {
  legacy: 'Migration vers les profils impossible (stockage plein) : libérez de la place puis rechargez la page.',
  memory: 'Stockage du navigateur indisponible : les profils ne peuvent pas être enregistrés.',
}

const reload = (flash?: string) => reloadApp(flash)

/**
 * Le profil ouvert ici a changé dans un autre onglet (supprimé, ou rattaché à un autre serveur) : plus
 * aucune écriture, puis rechargement — sauf si des modifications ne sont pas enregistrées : alerte avec
 * sauvegarde proposée (elle les contient), rechargement laissé au joueur.
 */
function leaveStaleProfile(message: string, pendingMessage: string, opts: { clearTab?: boolean } = {}) {
  freezeWrites()
  if (hasPendingForActive()) {
    reportStorageIssue({ key: PROFILES_KEY, kind: 'onglet', label: 'Profils et serveurs', message: pendingMessage })
    return
  }
  if (opts.clearTab) clearTabProfile()
  reload(message)
}

export const useProfiles = create<ProfilesStore>()((set, get) => {
  /** Enregistre un nouveau registre (écriture sûre) puis l'applique ; erreur si l'écriture échoue. */
  const commit = (r: RegistryResult, message?: string): ActionResult => {
    if (!r.ok) return r
    const st = get()
    if (st.readOnly) return { ok: false, error: st.readOnlyReason ?? 'Profils en lecture seule.' }
    if (st.mode === 'profiles') {
      const text = JSON.stringify(r.registry)
      if (!safeWriteText(PROFILES_KEY, text)) return { ok: false, error: 'Enregistrement impossible (stockage plein ou indisponible) : rien n’a changé.' }
      // Copie de secours (facultative : un échec n'est pas signalé).
      tryWriteText(PROFILES_SHADOW_KEY, text)
    }
    set({ registry: r.registry })
    return { ok: true, id: r.id, message }
  }
  const storage = () => browserStorage()
  const readOnly = boot.readOnly || boot.mode !== 'profiles'
  const readOnlyReason = readOnly ? (READ_ONLY_REASONS[boot.mode] ?? 'Profils enregistrés par une version plus récente d’ElevageSimu : rechargez la page.') : null
  return {
    registry: boot.registry,
    mode: boot.mode,
    readOnly,
    readOnlyReason,

    createProfile: (input) => {
      let reg = get().registry
      let serverId = input.serverId
      const ls = storage()
      const taken = ls ? idsWithData(ls) : { profiles: new Set<string>(), servers: new Set<string>() }
      if (!serverId) {
        if (!input.newServerName) return { ok: false, error: 'Choisissez un serveur.' }
        const s = addServer(reg, { name: input.newServerName, taken: taken.servers })
        if (!s.ok) return s
        reg = s.registry
        serverId = s.id
      }
      const p = addProfile(reg, { name: input.name, serverId, color: input.color, taken: taken.profiles })
      if (!p.ok) return p
      if (input.duplicateFrom) {
        if (!profileById(reg, input.duplicateFrom)) return { ok: false, error: 'Profil à dupliquer introuvable.' }
        if (!ls) return { ok: false, error: 'Stockage indisponible : duplication impossible.' }
        // Les données du profil ouvert peuvent avoir des modifications non enregistrées (quota) : refus.
        if (input.duplicateFrom === ACTIVE_PROFILE_ID && Object.keys(pendingWrites()).some((k) => k.startsWith(profileStoreKey(ACTIVE_PROFILE_ID, ''))))
          return { ok: false, error: 'Des modifications de ce profil ne sont pas enregistrées (stockage plein) : libérez de la place avant de le dupliquer.' }
        const c = copyProfileData(ls, input.duplicateFrom, p.id)
        if (!c.ok) return c
        const r = commit(p)
        if (!r.ok) removeProfileData(ls, p.id)
        return r
      }
      return commit(p)
    },
    duplicateProfile: (id, name) => {
      const src = profileById(get().registry, id)
      if (!src) return { ok: false, error: 'Profil à dupliquer introuvable.' }
      return get().createProfile({ name: name ?? `${src.name} (copie)`.slice(0, 40), serverId: src.serverId, duplicateFrom: id, color: src.color })
    },
    renameProfile: (id, name) => commit(renameProfile(get().registry, id, name)),
    setProfileServer: (id, serverId, opts) => {
      const reloads = id === ACTIVE_PROFILE_ID && serverId !== ACTIVE_SERVER_ID
      if (reloads && !opts?.force && hasPendingForActive()) return { ok: false, code: 'pending', error: PENDING_SWITCH_ERROR }
      const r = commit(setProfileServer(get().registry, id, serverId))
      if (r.ok && reloads) {
        freezeWrites()
        reload('Serveur du profil changé : prix et marché du nouveau serveur chargés.')
      }
      return r
    },
    setProfileColor: (id, color) => commit(setProfileColor(get().registry, id, color)),
    deleteProfile: (id) => {
      const before = get().registry
      const name = profileById(before, id)?.name ?? id
      const r = commit(removeProfile(before, id))
      if (!r.ok) return r
      const ls = storage()
      if (id === ACTIVE_PROFILE_ID) {
        freezeWrites()
        // Cet onglet ouvre ensuite le profil par défaut du registre.
        writeTabProfile(get().registry.activeProfileId)
      }
      if (ls) removeProfileData(ls, id)
      if (id === ACTIVE_PROFILE_ID) reload(`Profil « ${name} » supprimé.`)
      return { ok: true, id, message: `Profil « ${name} » supprimé.` }
    },
    createServer: (name, opts) => {
      const ls = storage()
      return commit(addServer(get().registry, { name, priceStat: opts?.priceStat, taken: ls ? idsWithData(ls).servers : [] }))
    },
    renameServer: (id, name) => commit(renameServer(get().registry, id, name)),
    setServerOptions: (id, opts) => commit(setServerOptions(get().registry, id, opts)),
    deleteServer: (id) => {
      const name = serverById(get().registry, id)?.name ?? id
      const r = commit(removeServer(get().registry, id))
      if (!r.ok) return r
      const ls = storage()
      if (ls) removeServerData(ls, id)
      return { ok: true, id, message: `Serveur « ${name} » supprimé.` }
    },
    switchProfile: (id, flash, opts) => {
      if (id === ACTIVE_PROFILE_ID) return { ok: true, id }
      if (!opts?.force && hasPendingForActive()) return { ok: false, code: 'pending', error: PENDING_SWITCH_ERROR }
      const r = commit(setActiveProfile(get().registry, id))
      if (!r.ok) return r
      writeTabProfile(id)
      freezeWrites()
      reload(flash ?? `Profil « ${profileById(get().registry, id)?.name ?? id} » ouvert.`)
      return r
    },
    removeLegacyCopy: (opts) => {
      const st = get()
      if (st.readOnly) return { ok: false, error: st.readOnlyReason ?? 'Profils en lecture seule.' }
      const ls = storage()
      const reg = st.registry
      if (!ls) return { ok: false, error: 'Stockage indisponible.' }
      if (st.mode !== 'profiles') return { ok: false, error: 'Les anciennes données sont encore utilisées (mode ancien format) : impossible de les supprimer.' }
      const diverged = legacyDivergence(ls, reg)
      if (diverged.length && !opts?.force)
        return {
          ok: false,
          error: `${plural(diverged.length, 'ancienne donnée a', 'anciennes données ont')} été modifiée${diverged.length > 1 ? 's' : ''} après la reprise (onglet resté sur l’ancienne version ?) : reprenez ou ignorez ces changements avant de supprimer l’ancienne copie.`,
        }
      // Registre d'abord : si son enregistrement échoue, les anciennes clés restent en place.
      const next: ProfilesRegistry = reg.legacy ? { ...reg, legacy: { ...reg.legacy, removedAt: Date.now() } } : reg
      const c = commit({ ok: true, registry: next, id: ACTIVE_PROFILE_ID })
      if (!c.ok) return c
      const removed = removeLegacyKeys(ls)
      checkLegacyDivergence(ls, next)
      return { ok: true, message: `${plural(removed.length, 'ancienne donnée supprimée', 'anciennes données supprimées')}.` }
    },
    adoptLegacyChanges: (keys) => {
      const st = get()
      if (st.readOnly) return { ok: false, error: st.readOnlyReason ?? 'Profils en lecture seule.' }
      const ls = storage()
      if (!ls || st.mode !== 'profiles') return { ok: false, error: 'Stockage indisponible.' }
      const principal = profileById(st.registry, DEFAULT_PROFILE_ID)
      if (!principal)
        return { ok: false, error: 'Profil « Principal » introuvable : reprise impossible. Téléchargez une sauvegarde complète : elle contient ces anciennes données.' }
      // Écritures tout ou rien : en cas d'échec, les valeurs précédentes sont remises.
      const previous: [string, string | null][] = []
      try {
        for (const k of keys) {
          const target = migratedKey(k, principal.id, principal.serverId)
          const value = ls.getItem(k)
          if (!target || value === null) continue
          previous.push([target, ls.getItem(target)])
          ls.setItem(target, value)
        }
      } catch {
        for (const [t, v] of previous.reverse())
          try {
            if (v === null) ls.removeItem(t)
            else ls.setItem(t, v)
          } catch {
            // Meilleur effort.
          }
        return { ok: false, error: 'Espace de stockage insuffisant : changements non repris, rien n’a changé. Libérez de la place (Réglages › Données) puis réessayez.' }
      }
      const c = commit({ ok: true, registry: acknowledgeLegacyKeys(ls, st.registry, keys), id: principal.id })
      if (!c.ok) return c
      checkLegacyDivergence(ls, get().registry)
      const message = `${plural(previous.length, 'donnée de l’ancienne version reprise', 'données de l’ancienne version reprises')} dans le profil « ${principal.name} ».`
      // Les stores de cette page ont peut-être ces données en mémoire : rechargement.
      freezeWrites()
      reload(message)
      return { ok: true, message }
    },
    ignoreLegacyChanges: (keys) => {
      const ls = storage()
      if (!ls) return { ok: false, error: 'Stockage indisponible.' }
      const c = commit({ ok: true, registry: acknowledgeLegacyKeys(ls, get().registry, keys), id: ACTIVE_PROFILE_ID })
      if (!c.ok) return c
      checkLegacyDivergence(ls, get().registry)
      return { ok: true, message: 'Changements de l’ancienne version ignorés : l’ancienne copie peut être supprimée.' }
    },
  }
})

// Copie d'avant les profils modifiée depuis la reprise (onglet resté sur l'ancienne version) : alerte.
{
  const ls = browserStorage()
  if (ls && boot.mode === 'profiles') checkLegacyDivergence(ls, boot.registry)
}

// ---------- Sélecteurs ----------

/** Profil ouvert dans cette page. */
export function useActiveProfile(): ProfileEntry {
  return useProfiles((s) => profileById(s.registry, ACTIVE_PROFILE_ID) ?? activeAtBoot)
}

/** Serveur du profil ouvert. */
export function useActiveServer(): ServerEntry {
  return useProfiles((s) => serverById(s.registry, ACTIVE_SERVER_ID) ?? boot.registry.servers[0])
}

/** Serveur du profil ouvert, hors React. */
export function activeServer(): ServerEntry {
  const reg = useProfiles.getState().registry
  return serverById(reg, ACTIVE_SERVER_ID) ?? boot.registry.servers[0]
}

/** Profil ouvert, hors React. */
export function activeProfile(): ProfileEntry {
  return profileById(useProfiles.getState().registry, ACTIVE_PROFILE_ID) ?? activeAtBoot
}

// ---------- Synchronisation entre onglets ----------

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e: StorageEvent) => {
    const ls = browserStorage()
    if (!ls || useProfiles.getState().mode !== 'profiles') return
    if (e.key !== PROFILES_KEY && e.key !== null) {
      // Ancienne clé réécrite par un onglet resté sur l'ancienne version : alerte tout de suite.
      if (parseStoreKey(e.key)?.kind === 'legacy' && !GLOBAL_KEYS.includes(e.key)) checkLegacyDivergence(ls, useProfiles.getState().registry)
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(ls.getItem(PROFILES_KEY) ?? 'null')
    } catch {
      return
    }
    const s = sanitizeRegistry(parsed)
    if (!s.registry) return
    useProfiles.setState({ registry: s.registry, readOnly: s.newer || useProfiles.getState().readOnly })
    const mine = profileById(s.registry, ACTIVE_PROFILE_ID)
    if (!mine) {
      // Le profil ouvert ici a été supprimé dans un autre onglet : on ne réécrit plus ses données.
      leaveStaleProfile(
        'Ce profil a été supprimé dans un autre onglet : le profil actif a été ouvert.',
        'Ce profil a été supprimé dans un autre onglet. Vos dernières modifications ici ne sont pas enregistrées et ne le seront plus : téléchargez une sauvegarde (elle les contient), puis rechargez la page.',
        { clearTab: true },
      )
      return
    }
    if (mine.serverId !== ACTIVE_SERVER_ID) {
      // Serveur du profil changé ailleurs : cette page lit et écrirait encore les prix de l'ancien serveur.
      const name = serverById(s.registry, mine.serverId)?.name ?? mine.serverId
      leaveStaleProfile(
        `Le serveur de ce profil a été changé dans un autre onglet (« ${name} ») : prix et marché du nouveau serveur chargés.`,
        `Le serveur de ce profil a été changé dans un autre onglet (« ${name} »). Vos dernières modifications ici ne sont pas enregistrées et ne le seront plus : téléchargez une sauvegarde (elle les contient), puis rechargez la page.`,
      )
      return
    }
    checkLegacyDivergence(ls, s.registry)
  })
}
