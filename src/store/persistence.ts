// Persistance sûre des stores zustand dans le localStorage :
//  - `persistOptions(...)` : options de `persist` communes à tous les stores (stockage sûr, migration
//    qui ne jette jamais de donnée, normalisation à la lecture via src/store/schema.ts) ;
//  - stockage sûr : une écriture refusée par le navigateur (quota plein, stockage indisponible) ne lève
//    plus d'exception au milieu d'une action ; elle est signalée (`useStorageHealth`, bandeau en haut de
//    chaque page) et réessayée au prochain enregistrement réussi ;
//  - données d'une version plus récente de l'application ou illisibles : elles sont gardées telles
//    quelles (écriture bloquée pour cette clé) au lieu d'être écrasées par les valeurs par défaut ;
//  - `syncAcrossTabs(store)` : quand un autre onglet modifie une donnée, ce store la relit (événement
//    « storage »), pour que deux onglets ouverts ne s'écrasent plus mutuellement.
import { create, type StoreApi } from 'zustand'
import type { PersistOptions, PersistStorage, StorageValue } from 'zustand/middleware'
import { isPlainObject, persistedStoreInfo, type Sanitized } from './schema'

// ---------- État de santé du stockage (non persisté) ----------

/**
 * - `ecriture` : l'enregistrement a échoué (quota plein…) : les modifications sont visibles mais pas enregistrées ;
 * - `version` : données écrites par une version plus récente de l'application : conservées, non modifiées ici ;
 * - `illisible` : données corrompues : conservées telles quelles, non modifiées ici ;
 * - `corrige` : données corrigées au chargement (entrées invalides écartées, valeurs bornées) ;
 * - `migration` : profils non activés (reprise des données d'avant les profils impossible, stockage plein) ;
 * - `divergence` : la copie des données d'avant les profils a été modifiée après la reprise (onglet resté
 *   ouvert sur l'ancienne version) : à reprendre ou ignorer dans Réglages › Profils ;
 * - `onglet` : le profil ouvert a changé dans un autre onglet alors que des modifications ne sont pas
 *   enregistrées ici : sauvegarde puis rechargement.
 */
export type StorageIssueKind = 'ecriture' | 'version' | 'illisible' | 'corrige' | 'migration' | 'divergence' | 'onglet'

export interface StorageIssue {
  key: string
  kind: StorageIssueKind
  /** Libellé lisible des données concernées. */
  label: string
  /** Explication en français, prête à afficher. */
  message: string
  /** Échec dû au quota du navigateur (kind = 'ecriture'). */
  quota?: boolean
  at: number
}

interface StorageHealthStore {
  issues: StorageIssue[]
  /** Masque un message d'information (`corrige`). */
  dismiss: (key: string, kind: StorageIssueKind) => void
}

export const useStorageHealth = create<StorageHealthStore>()((set) => ({
  issues: [],
  dismiss: (key, kind) => set((s) => ({ issues: s.issues.filter((i) => !(i.key === key && i.kind === kind)) })),
}))

const labelOf = (key: string) => persistedStoreInfo(key)?.label ?? (key === 'elevagesimu:profiles' ? 'Profils et serveurs' : key)

function report(issue: Omit<StorageIssue, 'at' | 'label'>) {
  // Même problème déjà signalé : pas de nouvel affichage (évite un rendu à chaque écriture en échec).
  if (useStorageHealth.getState().issues.some((i) => i.key === issue.key && i.kind === issue.kind && i.message === issue.message)) return
  const full: StorageIssue = { ...issue, label: labelOf(issue.key), at: Date.now() }
  useStorageHealth.setState((s) => ({ issues: [...s.issues.filter((i) => !(i.key === issue.key && i.kind === issue.kind)), full] }))
}

/** Signale un problème de stockage (bandeau en haut des pages), pour les données hors stores zustand. */
export function reportStorageIssue(issue: Omit<StorageIssue, 'at' | 'label'> & { label?: string }): void {
  const { label, ...rest } = issue
  if (useStorageHealth.getState().issues.some((i) => i.key === rest.key && i.kind === rest.kind && i.message === rest.message)) return
  const full: StorageIssue = { ...rest, label: label ?? labelOf(rest.key), at: Date.now() }
  useStorageHealth.setState((s) => ({ issues: [...s.issues.filter((i) => !(i.key === rest.key && i.kind === rest.kind)), full] }))
}

function clearIssues(key: string, kinds?: StorageIssueKind[]) {
  const { issues } = useStorageHealth.getState()
  if (!issues.some((i) => i.key === key && (!kinds || kinds.includes(i.kind)))) return
  useStorageHealth.setState({ issues: issues.filter((i) => !(i.key === key && (!kinds || kinds.includes(i.kind)))) })
}

// ---------- Stockage sûr ----------

/** Clés dont l'écriture est bloquée pour préserver la donnée stockée (version plus récente ou illisible). */
const blocked = new Map<string, 'version' | 'illisible'>()
/** Dernière valeur (sérialisée) qui n'a pas pu être écrite, par clé. */
const pending = new Map<string, string>()
/** Clés dont l'écriture est suspendue (application d'une modification venue d'un autre onglet). */
const suppressed = new Set<string>()
/** Plus aucune écriture (rechargement imminent : changement ou suppression de profil, import). */
let frozen = false

/**
 * Bloque toute écriture des stores jusqu'au rechargement de la page : à appeler juste avant
 * `window.location.reload()` quand les clés du profil actif vont changer ou être effacées (sinon un
 * store pourrait réécrire les données d'un profil supprimé).
 */
export function freezeWrites(): void {
  frozen = true
}

/** Écritures bloquées par `freezeWrites` ? */
export function writesFrozen(): boolean {
  return frozen
}

function localStorageOrNull(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

function isQuotaError(e: unknown): boolean {
  return e instanceof Error && /quota/i.test(`${e.name} ${e.message}`)
}

function block(key: string, reason: 'version' | 'illisible', detail?: { from: number; current: number }) {
  blocked.set(key, reason)
  const label = labelOf(key)
  report({
    key,
    kind: reason,
    message:
      reason === 'version'
        ? `Les données « ${label} » ont été enregistrées par une version plus récente d’ElevageSimu${detail ? ` (format v${detail.from}, cette page lit jusqu’à v${detail.current})` : ''}. Elles sont conservées telles quelles et ne seront pas modifiées ici : rechargez la page pour obtenir la dernière version. D’ici là, vos changements sur ces données ne sont pas enregistrés.`
        : `Les données « ${label} » enregistrées dans ce navigateur sont illisibles (stockage corrompu ou modifié à la main). Elles sont conservées telles quelles : exportez une sauvegarde (elle les contient) avant de repartir de zéro pour ces données. D’ici là, vos changements sur ces données ne sont pas enregistrés.`,
  })
}

/** Réessaie les écritures en échec ; renvoie vrai si plus rien n'est en attente. */
export function retryPendingWrites(): boolean {
  if (frozen) return pending.size === 0
  const ls = localStorageOrNull()
  if (!ls) return pending.size === 0
  for (const [key, text] of pending) {
    if (blocked.has(key)) continue
    try {
      ls.setItem(key, text)
      pending.delete(key)
      clearIssues(key, ['ecriture'])
    } catch (e) {
      reportWriteFailure(key, e)
    }
  }
  return pending.size === 0
}

function reportWriteFailure(key: string, e: unknown) {
  const quota = isQuotaError(e)
  const label = labelOf(key)
  report({
    key,
    kind: 'ecriture',
    quota,
    message: quota
      ? `Enregistrement impossible : l’espace de stockage du navigateur est plein. Vos dernières modifications (« ${label} ») sont visibles mais ne sont PAS enregistrées : elles seront perdues à la fermeture de la page. Téléchargez une sauvegarde maintenant (elle les contient), puis libérez de la place (Réglages › Données : d’abord les résultats recalculables des modes, puis le journal ancien).`
      : `Enregistrement impossible dans ce navigateur (« ${label} » ; stockage indisponible ou bloqué, par exemple en navigation privée) : vos dernières modifications sont visibles mais ne sont PAS enregistrées et seront perdues à la fermeture de la page.`,
  })
}

/** Valeurs non enregistrées (échec d'écriture), à inclure dans une sauvegarde : clé → texte JSON. */
export function pendingWrites(): Record<string, string> {
  return Object.fromEntries(pending)
}

/** Raison du blocage des écritures d'une clé, ou null. */
export function writeBlockReason(key: string): 'version' | 'illisible' | null {
  return blocked.get(key) ?? null
}

/** Stockage JSON de persist qui ne lève jamais d'exception (lecture, écriture, suppression). */
export const safeStorage: PersistStorage<unknown> = {
  getItem(name) {
    const ls = localStorageOrNull()
    if (!ls) return null
    let raw: string | null
    try {
      raw = ls.getItem(name)
    } catch {
      return null
    }
    if (raw === null) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = undefined
    }
    if (!isPlainObject(parsed) || !isPlainObject(parsed.state) || (parsed.version !== undefined && typeof parsed.version !== 'number')) {
      block(name, 'illisible')
      return null
    }
    return parsed as unknown as StorageValue<unknown>
  },
  setItem(name, value) {
    if (frozen || blocked.has(name) || suppressed.has(name)) return
    const ls = localStorageOrNull()
    if (!ls && typeof window === 'undefined') return // hors navigateur (tests en Node)
    let text: string
    try {
      text = JSON.stringify(value)
    } catch (e) {
      reportWriteFailure(name, e)
      return
    }
    if (!ls) {
      // Navigateur sans stockage (navigation privée stricte, cookies bloqués) : rien ne sera gardé,
      // mais une sauvegarde téléchargée contiendra l'état actuel.
      pending.set(name, text)
      reportWriteFailure(name, new Error('Stockage du navigateur indisponible'))
      return
    }
    try {
      ls.setItem(name, text)
    } catch (e) {
      pending.set(name, text)
      reportWriteFailure(name, e)
      return
    }
    if (pending.delete(name)) clearIssues(name, ['ecriture'])
    // Un enregistrement vient de réussir (de la place a pu se libérer) : on réessaie les autres.
    if (pending.size) retryPendingWrites()
  },
  removeItem(name) {
    pending.delete(name)
    try {
      localStorageOrNull()?.removeItem(name)
    } catch {
      // Rien à faire : la clé sera réécrite au prochain enregistrement.
    }
  },
}

/**
 * Écrit un texte sous une clé SANS signaler d'échec (pas de bandeau) : pour une écriture que l'appelant
 * annule et explique lui-même en cas d'échec (import du marché…). Refusée si les écritures sont gelées
 * (`freezeWrites`) ou si la clé est bloquée (donnée d'une version plus récente ou illisible, à préserver).
 */
export function tryWriteText(key: string, text: string): { ok: true } | { ok: false; reason: 'gel' | 'bloque' | 'quota' | 'indisponible' } {
  if (frozen) return { ok: false, reason: 'gel' }
  if (blocked.has(key)) return { ok: false, reason: 'bloque' }
  const ls = localStorageOrNull()
  if (!ls) return { ok: false, reason: 'indisponible' }
  try {
    ls.setItem(key, text)
  } catch (e) {
    return { ok: false, reason: isQuotaError(e) ? 'quota' : 'indisponible' }
  }
  if (pending.delete(key)) clearIssues(key, ['ecriture'])
  return { ok: true }
}

/**
 * Écrit un texte sous une clé hors store zustand (registre des profils, données d'un autre serveur…) sans
 * lever d'exception : échec signalé (bandeau) et renvoyé (false). Rien n'est écrit si les écritures
 * sont bloquées (`freezeWrites`).
 */
export function safeWriteText(key: string, text: string): boolean {
  if (frozen) return false
  const ls = localStorageOrNull()
  if (!ls) return false
  try {
    ls.setItem(key, text)
  } catch (e) {
    reportWriteFailure(key, e)
    return false
  }
  clearIssues(key, ['ecriture'])
  return true
}

// ---------- Options de persist ----------

export interface PersistConfig<S, P> {
  /** Clé localStorage du store (`STORE_KEYS.xxx` de src/store/profiles.ts : profil ou serveur actif), base déclarée dans STORE_BASES (schema.ts). */
  name: string
  /** Version actuelle du schéma (défaut : celle de STORE_BASES pour cette clé). */
  version?: number
  /** Conversion depuis une version antérieure (jamais appelée pour une version plus récente). Défaut : identité. */
  migrate?: (state: unknown, fromVersion: number) => unknown
  /** Normalisation de l'état lu (après migration) : ne doit pas lever ; renvoie l'état à fusionner et les corrections. */
  sanitize: (state: unknown) => Sanitized<P>
  /** Partie de l'état à enregistrer (défaut : tout l'état, actions exclues par JSON). */
  partialize?: (state: S) => P
}

/**
 * Options de `persist` sûres :
 *  - version plus récente que l'application → donnée gardée telle quelle (écriture bloquée), état
 *    affiché au mieux (normalisé), bandeau d'explication ;
 *  - version plus ancienne → migration (identité par défaut) : jamais de remise à zéro ;
 *  - état lu toujours normalisé (`sanitize`) avant d'être fusionné ; une erreur inattendue bloque
 *    l'écriture au lieu d'écraser la donnée.
 */
export function persistOptions<S, P = Partial<S>>(cfg: PersistConfig<S, P>): PersistOptions<S, P> {
  const version = cfg.version ?? persistedStoreInfo(cfg.name)?.version ?? 0
  const name = cfg.name
  return {
    name,
    version,
    storage: safeStorage as PersistStorage<P>,
    ...(cfg.partialize ? { partialize: cfg.partialize } : {}),
    migrate: (persisted, from) => {
      if (from > version) {
        block(name, 'version', { from, current: version })
        return persisted as P
      }
      try {
        return (cfg.migrate ? cfg.migrate(persisted, from) : persisted) as P
      } catch {
        block(name, 'illisible')
        return undefined as unknown as P
      }
    },
    merge: (persisted, current) => {
      if (persisted === undefined || persisted === null) return current
      try {
        const { state, issues } = cfg.sanitize(persisted)
        if (issues.length)
          report({ key: name, kind: 'corrige', message: `Données « ${labelOf(name)} » corrigées au chargement : ${issues.join(' ; ')}.` })
        else clearIssues(name, ['corrige'])
        return { ...current, ...state }
      } catch {
        block(name, 'illisible')
        return current
      }
    },
    onRehydrateStorage: () => (_state, error) => {
      if (error) block(name, 'illisible')
    },
  }
}

// ---------- Synchronisation entre onglets ----------

interface PersistApi {
  persist: { rehydrate: () => Promise<void> | void; getOptions: () => { name?: string } }
}

interface SyncEntry {
  rehydrate: () => void
  reset: () => void
  touch: () => void
}

const registry = new Map<string, SyncEntry>()
let listening = false

/** Applique une modification venue d'un autre onglet sans la réécrire. */
function applyRemote(key: string, entry: SyncEntry) {
  blocked.delete(key)
  pending.delete(key)
  clearIssues(key, ['ecriture', 'version', 'illisible'])
  suppressed.add(key)
  try {
    const ls = localStorageOrNull()
    let present = false
    try {
      present = ls?.getItem(key) != null
    } catch {
      present = false
    }
    if (present) entry.rehydrate()
    else entry.reset()
  } finally {
    suppressed.delete(key)
  }
}

function onStorage(e: StorageEvent) {
  const ls = localStorageOrNull()
  if (e.storageArea && ls && e.storageArea !== ls) return
  if (e.key === null) {
    for (const [key, entry] of registry) applyRemote(key, entry)
    return
  }
  const entry = registry.get(e.key)
  if (entry) applyRemote(e.key, entry)
}

/**
 * Relit ce store quand un autre onglet modifie sa clé (événement « storage ») ; s'il l'efface, le
 * store revient à son état initial. Un seul écouteur pour toute l'application. Sans effet hors navigateur.
 */
export function syncAcrossTabs<S>(store: StoreApi<S> & PersistApi): void {
  const key = store.persist.getOptions().name
  if (!key) return
  registry.set(key, {
    rehydrate: () => void store.persist.rehydrate(),
    reset: () => store.setState(store.getInitialState(), true),
    touch: () => store.setState({}),
  })
  if (!listening && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', onStorage)
    listening = true
  }
}

/**
 * Lève le blocage d'une clé (données d'une version plus récente ou illisibles) et y enregistre l'état
 * actuel du store : la donnée stockée est alors REMPLACÉE. À proposer après un export de sauvegarde.
 */
export function overwriteBlocked(key: string): void {
  if (!blocked.delete(key)) return
  clearIssues(key, ['version', 'illisible'])
  registry.get(key)?.touch()
}
