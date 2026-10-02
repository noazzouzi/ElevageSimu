// Profils (un élevage = un compte sur un serveur) et serveurs (une économie : prix saisis et marché
// importé). Le profil actif est résolu de façon SYNCHRONE au chargement de ce module, avant la création
// des stores : ses clés (`STORE_KEYS`, `profileKey`, `serverKey`) sont fixes pendant toute la vie de la
// page ; changer de profil enregistre le registre puis recharge l'application.
//
// Logique pure (registre, migration, démarrage) : src/store/profileRegistry.ts ; clés : src/store/schema.ts.
// Documentation : docs/api/profiles.md.
import { create } from 'zustand'
import { type PriceStat } from '../domain/market'
import { reloadApp } from '../lib/backup'
import { pendingWrites, freezeWrites, reportStorageIssue, safeWriteText } from './persistence'
import {
  activeProfileOf,
  addProfile,
  addServer,
  bootProfiles,
  copyProfileData,
  idsWithData,
  profileById,
  removeLegacyCopy as removeLegacyKeys,
  removeProfile,
  removeProfileData,
  removeServer,
  removeServerData,
  renameProfile,
  renameServer,
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
import { LEGACY_STORE_KEYS, PROFILES_KEY, STORAGE_PREFIX, profileStoreKey, serverStoreKey, storeKeysFor, type StorageLike, type StoreBase } from './schema'

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

const activeAtBoot = activeProfileOf(boot.registry)

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

// ---------- Store ----------

export type ActionResult = { ok: true; id?: string; message?: string } | { ok: false; error: string }

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
  setProfileServer: (id: string, serverId: string) => ActionResult
  setProfileColor: (id: string, color: ProfileColor | null) => ActionResult
  /** Supprime un profil et ses données (le profil ouvert : bascule sur un autre et recharge). */
  deleteProfile: (id: string) => ActionResult
  createServer: (name: string, opts?: { priceStat?: PriceStat }) => ActionResult
  renameServer: (id: string, name: string) => ActionResult
  setServerOptions: (id: string, opts: { priceStat?: PriceStat; maxMarketShare?: number }) => ActionResult
  /** Supprime un serveur sans profil, avec ses prix et son marché. */
  deleteServer: (id: string) => ActionResult
  /** Ouvre un autre profil (enregistre le registre puis recharge l'application ; `flash` : message affiché après). */
  switchProfile: (id: string, flash?: string) => ActionResult
  /** Supprime la copie des données d'avant les profils. */
  removeLegacyCopy: () => ActionResult
}

const READ_ONLY_REASONS: Partial<Record<BootMode, string>> = {
  legacy: 'Migration vers les profils impossible (stockage plein) : libérez de la place puis rechargez la page.',
  memory: 'Stockage du navigateur indisponible : les profils ne peuvent pas être enregistrés.',
}

const reload = (flash?: string) => reloadApp(flash)

export const useProfiles = create<ProfilesStore>()((set, get) => {
  /** Enregistre un nouveau registre (écriture sûre) puis l'applique ; erreur si l'écriture échoue. */
  const commit = (r: RegistryResult, message?: string): ActionResult => {
    if (!r.ok) return r
    const st = get()
    if (st.readOnly) return { ok: false, error: st.readOnlyReason ?? 'Profils en lecture seule.' }
    if (st.mode === 'profiles' && !safeWriteText(PROFILES_KEY, JSON.stringify(r.registry)))
      return { ok: false, error: 'Enregistrement impossible (stockage plein ou indisponible) : rien n’a changé.' }
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
    setProfileServer: (id, serverId) => {
      const r = commit(setProfileServer(get().registry, id, serverId))
      if (r.ok && id === ACTIVE_PROFILE_ID && serverId !== ACTIVE_SERVER_ID) {
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
      if (id === ACTIVE_PROFILE_ID) freezeWrites()
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
    switchProfile: (id, flash) => {
      if (id === ACTIVE_PROFILE_ID) return { ok: true, id }
      const r = commit(setActiveProfile(get().registry, id))
      if (!r.ok) return r
      freezeWrites()
      reload(flash ?? `Profil « ${profileById(get().registry, id)?.name ?? id} » ouvert.`)
      return r
    },
    removeLegacyCopy: () => {
      const ls = storage()
      const reg = get().registry
      if (!ls) return { ok: false, error: 'Stockage indisponible.' }
      if (get().mode !== 'profiles') return { ok: false, error: 'Les anciennes données sont encore utilisées (mode ancien format) : impossible de les supprimer.' }
      const removed = removeLegacyKeys(ls)
      const next: ProfilesRegistry = reg.legacy ? { ...reg, legacy: { ...reg.legacy, removedAt: Date.now() } } : reg
      const c = commit({ ok: true, registry: next, id: ACTIVE_PROFILE_ID })
      return c.ok ? { ok: true, message: `${removed.length} ancienne(s) donnée(s) supprimée(s).` } : c
    },
  }
})

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
    if (e.key !== PROFILES_KEY && e.key !== null) return
    const ls = browserStorage()
    if (!ls || useProfiles.getState().mode !== 'profiles') return
    let parsed: unknown
    try {
      parsed = JSON.parse(ls.getItem(PROFILES_KEY) ?? 'null')
    } catch {
      return
    }
    const s = sanitizeRegistry(parsed)
    if (!s.registry) return
    useProfiles.setState({ registry: s.registry, readOnly: s.newer || useProfiles.getState().readOnly })
    if (!profileById(s.registry, ACTIVE_PROFILE_ID)) {
      // Le profil ouvert ici a été supprimé dans un autre onglet : on ne réécrit plus ses données.
      freezeWrites()
      reload('Ce profil a été supprimé dans un autre onglet : le profil actif a été ouvert.')
    }
  })
}
