// Prix du marché importés (export CSV de l'HDV) du serveur du profil ouvert, et historique des imports.
// Clés : « elevagesimu:s:<serveur>:market » (instantané compact courant) et « …:market-history »
// (métadonnées et prix clés des imports précédents). Logique pure : src/domain/market.ts ;
// normalisation : src/store/schema.ts (sanitizeMarketState, sanitizeMarketHistoryState).
// Documentation : docs/api/market.md.
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  MARKET_HISTORY_MAX,
  genetonValueFromMarket,
  historyEntryOf,
  marketSourceOf,
  mergeSnapshots,
  sanitizeSnapshot,
  slugify,
  type GenetonMarketValue,
  type MarketHistoryEntry,
  type MarketSnapshot,
  type MarketSource,
} from '../domain/market'
import { persistOptions, safeWriteText, syncAcrossTabs, tryWriteText, writeBlockReason } from './persistence'
import { ACTIVE_SERVER_ID, STORE_KEYS, activeServer, useProfiles } from './profiles'
import { isPlainObject, sanitizeMarketHistoryState, sanitizeMarketState, serverStoreKey, storeVersion, type MarketData, type MarketHistoryData } from './schema'

interface MarketStore extends MarketData {
  /** Remplace l'instantané du serveur ouvert. */
  replace: (snapshot: MarketSnapshot) => void
  /** Supprime les prix du marché du serveur ouvert. */
  clear: () => void
}

export const useMarket = create<MarketStore>()(
  persist(
    (set) => ({
      snapshot: null,
      replace: (snapshot) => set({ snapshot }),
      clear: () => set({ snapshot: null }),
    }),
    persistOptions<MarketStore, MarketData>({ name: STORE_KEYS.market, sanitize: sanitizeMarketState, partialize: (s) => ({ snapshot: s.snapshot }) }),
  ),
)
syncAcrossTabs(useMarket)

interface MarketHistoryStore extends MarketHistoryData {
  record: (entry: MarketHistoryEntry) => void
  clear: () => void
}

const pushEntry = (entries: MarketHistoryEntry[], e: MarketHistoryEntry) => [...entries.filter((x) => x.importedAt !== e.importedAt), e].sort((a, b) => a.importedAt - b.importedAt).slice(-MARKET_HISTORY_MAX)

export const useMarketHistory = create<MarketHistoryStore>()(
  persist(
    (set) => ({
      entries: [],
      record: (entry) => set((s) => ({ entries: pushEntry(s.entries, entry) })),
      clear: () => set({ entries: [] }),
    }),
    persistOptions<MarketHistoryStore, MarketHistoryData>({ name: STORE_KEYS['market-history'], sanitize: sanitizeMarketHistoryState, partialize: (s) => ({ entries: s.entries }) }),
  ),
)
syncAcrossTabs(useMarketHistory)

// ---------- Écriture pour n'importe quel serveur ----------

function readState(key: string): unknown {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown
    return isPlainObject(v) ? v.state : undefined
  } catch {
    return undefined
  }
}

export type MarketWriteResult = { ok: true } | { ok: false; error: string }

const WRITE_ERRORS: Record<'gel' | 'bloque' | 'quota' | 'indisponible', string> = {
  quota:
    'Enregistrement impossible (stockage plein) : prix du marché inchangés. Libérez de la place (Réglages › Données : résultats recalculables des modes, ancienne copie, marché d’un autre serveur, journal ancien) puis réessayez.',
  bloque:
    'Les prix du marché enregistrés pour ce serveur viennent d’une version plus récente d’ElevageSimu (ou sont illisibles) : ils sont conservés tels quels. Rechargez la page avant d’importer.',
  gel: 'L’application se recharge : réessayez après le rechargement.',
  indisponible: 'Stockage du navigateur indisponible (navigation privée ?) : prix du marché inchangés.',
}

/** Instantané du marché enregistré pour un serveur (n'importe lequel), ou null. */
export function serverMarketSnapshot(serverId: string): MarketSnapshot | null {
  if (serverId === ACTIVE_SERVER_ID) return useMarket.getState().snapshot
  return sanitizeMarketState(readState(serverStoreKey(serverId, 'market'))).state.snapshot
}

// ---- Annulation du dernier import (MKT-12) : instantané précédent gardé dans sessionStorage (propre à
// l'onglet, hors quota du localStorage et hors sauvegardes ; repli en mémoire), valable tant que le marché
// du serveur est encore celui de cet import.

export const MARKET_UNDO_PREFIX = 'elevagesimu-market-undo:'

export interface MarketUndo {
  serverId: string
  /** Prix du marché d'avant l'import (null : le serveur n'en avait pas). */
  previous: MarketSnapshot | null
  /** `importedAt` de l'instantané importé (l'annulation n'est possible que s'il est toujours en place). */
  appliedImportedAt: number
  /** Instant de l'import. */
  at: number
}

const undoMemory = new Map<string, MarketUndo>()
const undoListeners = new Set<() => void>()

function session(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null
  } catch {
    return null
  }
}

function saveUndo(u: MarketUndo): void {
  undoMemory.set(u.serverId, u)
  try {
    session()?.setItem(MARKET_UNDO_PREFIX + u.serverId, JSON.stringify(u))
  } catch {
    // sessionStorage plein ou indisponible : annulation gardée en mémoire (jusqu'au rechargement).
  }
  for (const f of undoListeners) f()
}

function dropUndo(serverId: string): void {
  undoMemory.delete(serverId)
  try {
    session()?.removeItem(MARKET_UNDO_PREFIX + serverId)
  } catch {
    // rien
  }
  for (const f of undoListeners) f()
}

function readUndo(serverId: string): MarketUndo | null {
  const mem = undoMemory.get(serverId)
  if (mem) return mem
  try {
    const raw = session()?.getItem(MARKET_UNDO_PREFIX + serverId)
    if (!raw) return null
    const v = JSON.parse(raw) as unknown
    if (!isPlainObject(v) || typeof v.appliedImportedAt !== 'number' || typeof v.at !== 'number') return null
    const previous = v.previous === null ? null : sanitizeSnapshot(v.previous).snapshot
    if (v.previous !== null && !previous) return null
    const u: MarketUndo = { serverId, previous, appliedImportedAt: v.appliedImportedAt, at: v.at }
    undoMemory.set(serverId, u)
    return u
  } catch {
    return null
  }
}

/** Annulation possible du dernier import de ce serveur (son marché est encore celui de l'import), sinon null. */
export function marketUndoFor(serverId: string): MarketUndo | null {
  const u = readUndo(serverId)
  if (!u) return null
  const current = serverMarketSnapshot(serverId)
  return current && current.importedAt === u.appliedImportedAt ? u : null
}

/** Annulation possible du dernier import du serveur ouvert (réactive : import, annulation, marché changé). */
export function useMarketUndo(serverId: string = ACTIVE_SERVER_ID): MarketUndo | null {
  const snapshot = useMarket((st) => st.snapshot)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const f = () => setTick((n) => n + 1)
    undoListeners.add(f)
    return () => {
      undoListeners.delete(f)
    }
  }, [])
  return useMemo(() => (tick >= 0 && (snapshot || serverId !== ACTIVE_SERVER_ID) ? marketUndoFor(serverId) : null), [serverId, snapshot, tick])
}

/** Écrit l'instantané d'un serveur (tout ou rien) et met à jour les stores du serveur ouvert. */
function writeMarket(serverId: string, snapshot: MarketSnapshot): MarketWriteResult {
  const marketKey = serverId === ACTIVE_SERVER_ID ? STORE_KEYS.market : serverStoreKey(serverId, 'market')
  if (writeBlockReason(marketKey)) return { ok: false, error: WRITE_ERRORS.bloque }
  const saved = tryWriteText(marketKey, JSON.stringify({ state: { snapshot }, version: storeVersion(marketKey) ?? 1 }))
  if (!saved.ok) return { ok: false, error: WRITE_ERRORS[saved.reason] }
  // Même texte que celui déjà enregistré : persist le réécrit sans place supplémentaire.
  if (serverId === ACTIVE_SERVER_ID) useMarket.getState().replace(snapshot)
  return { ok: true }
}

function historyOf(serverId: string): MarketHistoryEntry[] {
  return serverId === ACTIVE_SERVER_ID ? useMarketHistory.getState().entries : sanitizeMarketHistoryState(readState(serverStoreKey(serverId, 'market-history'))).state.entries
}

function writeHistory(serverId: string, entries: MarketHistoryEntry[]): void {
  if (serverId === ACTIVE_SERVER_ID) {
    useMarketHistory.setState({ entries })
    return
  }
  const historyKey = serverStoreKey(serverId, 'market-history')
  safeWriteText(historyKey, JSON.stringify({ state: { entries }, version: storeVersion(historyKey) ?? 1 }))
}

/**
 * Remplace les prix du marché d'un serveur (et ajoute l'import à son historique). L'instantané est d'abord
 * ENREGISTRÉ (sans alerte en cas d'échec) : si le stockage le refuse (quota…), rien ne change et une
 * erreur est renvoyée — jamais de « succès » avec un marché non enregistré. Serveur du profil ouvert :
 * stores mis à jour ensuite (pages à jour aussitôt) ; autre serveur : écriture directe de ses clés.
 * L'instantané remplacé est gardé pour `undoMarketImport` (cet onglet).
 */
export function applyMarketSnapshot(serverId: string, snapshot: MarketSnapshot): MarketWriteResult {
  const previous = serverMarketSnapshot(serverId)
  const r = writeMarket(serverId, snapshot)
  if (!r.ok) return r
  writeHistory(serverId, pushEntry(historyOf(serverId), historyEntryOf(snapshot)))
  saveUndo({ serverId, previous, appliedImportedAt: snapshot.importedAt, at: Date.now() })
  return { ok: true }
}

/**
 * Complète les prix du marché d'un serveur par un export (souvent partiel) : les objets du fichier
 * remplacent les anciens, les autres gardent leur prix précédent (`mergeSnapshots`). Annulable.
 */
export function mergeMarketSnapshot(serverId: string, incoming: MarketSnapshot): MarketWriteResult & { snapshot?: MarketSnapshot } {
  const current = serverMarketSnapshot(serverId)
  const merged = current ? mergeSnapshots(current, incoming, { importedAt: incoming.importedAt }) : incoming
  const r = applyMarketSnapshot(serverId, merged)
  return r.ok ? { ok: true, snapshot: merged } : r
}

/**
 * Annule le dernier import d'un serveur : rétablit l'instantané précédent (ou aucun) et retire l'import
 * de l'historique. Refusé si le marché a changé depuis (autre import, suppression) ou si l'écriture échoue.
 */
export function undoMarketImport(serverId: string): MarketWriteResult & { restored?: MarketSnapshot | null } {
  const u = marketUndoFor(serverId)
  if (!u) return { ok: false, error: 'Rien à annuler : les prix du marché ont changé depuis cet import (ou l’onglet a été fermé).' }
  const r = u.previous ? writeMarket(serverId, u.previous) : clearServerMarket(serverId)
  if (!r.ok) return r
  writeHistory(
    serverId,
    historyOf(serverId).filter((e) => e.importedAt !== u.appliedImportedAt),
  )
  dropUndo(serverId)
  return { ok: true, restored: u.previous }
}

/** Supprime les prix du marché d'un serveur (l'historique des imports est gardé). */
export function clearServerMarket(serverId: string): MarketWriteResult {
  if (serverId === ACTIVE_SERVER_ID) {
    useMarket.getState().clear()
    return { ok: true }
  }
  try {
    window.localStorage.removeItem(serverStoreKey(serverId, 'market'))
    return { ok: true }
  } catch {
    return { ok: false, error: 'Stockage indisponible.' }
  }
}

/** Historique des imports d'un serveur (n'importe lequel). */
export function serverMarketHistory(serverId: string): MarketHistoryEntry[] {
  if (serverId === ACTIVE_SERVER_ID) return useMarketHistory.getState().entries
  return sanitizeMarketHistoryState(readState(serverStoreKey(serverId, 'market-history'))).state.entries
}

// ---------- Préréglages ----------

export interface MarketPreset {
  id: string
  /** Serveur de l'export. */
  serverName: string
  exportDate: string
  /** « Charger les prix de Tylezia du 02/10/2026 ». */
  label: string
  /** Charge l'instantané (fichier JSON chargé à la demande). */
  load: () => Promise<MarketSnapshot>
}

async function loadPresetJson(importer: () => Promise<{ default: unknown }>, label: string): Promise<MarketSnapshot> {
  const m = await importer()
  const r = sanitizeSnapshot(m.default)
  if (!r.snapshot) throw new Error(`Préréglage « ${label} » illisible.`)
  return { ...r.snapshot, importedAt: Date.now(), source: `Préréglage : ${label}` }
}

/** Instantanés versionnés avec l'application (src/data/market/*.json, générés par scripts/import-hdv-csv.mjs). */
export const MARKET_PRESETS: MarketPreset[] = [
  {
    id: 'tylezia-2026-10-02',
    serverName: 'Tylezia',
    exportDate: '2026-10-02',
    label: 'Charger les prix de Tylezia du 02/10/2026',
    load: () => loadPresetJson(() => import('../data/market/tylezia-2026-10-02.json'), 'Tylezia, export HDV du 02/10/2026'),
  },
]

/** Préréglage du serveur de ce nom (casse et accents ignorés), ou undefined. */
export function presetForServer(name: string): MarketPreset | undefined {
  const n = slugify(name)
  return MARKET_PRESETS.find((p) => slugify(p.serverName) === n)
}

// ---------- Lecture ----------

/** Source de prix du marché du serveur ouvert (statistique du serveur), ou null sans import. */
export function useMarketSource(): MarketSource | null {
  const snapshot = useMarket((s) => s.snapshot)
  const stat = useProfiles((s) => s.registry.servers.find((x) => x.id === ACTIVE_SERVER_ID)?.priceStat ?? 'auto')
  const name = useProfiles((s) => s.registry.servers.find((x) => x.id === ACTIVE_SERVER_ID)?.name ?? '')
  return useMemo(() => (snapshot ? marketSourceOf(snapshot, stat, name || snapshot.serverName) : null), [snapshot, stat, name])
}

/** Source de prix du marché du serveur ouvert, hors React. */
export function marketSource(): MarketSource | null {
  const snapshot = useMarket.getState().snapshot
  if (!snapshot) return null
  const server = activeServer()
  return marketSourceOf(snapshot, server?.priceStat ?? 'auto', server?.name || snapshot.serverName)
}

/** Valeur du généton d'après le marché du serveur ouvert (null sans import ni prix de la boutique). */
export function useMarketGeneton(saleTax: number): GenetonMarketValue | null {
  const source = useMarketSource()
  return useMemo(() => (source ? genetonValueFromMarket(source, saleTax) : null), [source, saleTax])
}
