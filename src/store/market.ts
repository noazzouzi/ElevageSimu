// Prix du marché importés (export CSV de l'HDV) du serveur du profil ouvert, et historique des imports.
// Clés : « elevagesimu:s:<serveur>:market » (instantané compact courant) et « …:market-history »
// (métadonnées et prix clés des imports précédents). Logique pure : src/domain/market.ts ;
// normalisation : src/store/schema.ts (sanitizeMarketState, sanitizeMarketHistoryState).
// Documentation : docs/api/market.md.
import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  MARKET_HISTORY_MAX,
  genetonValueFromMarket,
  historyEntryOf,
  marketSourceOf,
  sanitizeSnapshot,
  slugify,
  type GenetonMarketValue,
  type MarketHistoryEntry,
  type MarketSnapshot,
  type MarketSource,
} from '../domain/market'
import { persistOptions, safeWriteText, syncAcrossTabs } from './persistence'
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

/**
 * Remplace les prix du marché d'un serveur (et ajoute l'import à son historique). Serveur du profil
 * ouvert : via les stores (pages à jour aussitôt) ; autre serveur : écriture directe de ses clés.
 */
export function applyMarketSnapshot(serverId: string, snapshot: MarketSnapshot): MarketWriteResult {
  const entry = historyEntryOf(snapshot)
  if (serverId === ACTIVE_SERVER_ID) {
    useMarket.getState().replace(snapshot)
    useMarketHistory.getState().record(entry)
    return { ok: true }
  }
  const marketKey = serverStoreKey(serverId, 'market')
  const historyKey = serverStoreKey(serverId, 'market-history')
  const history = sanitizeMarketHistoryState(readState(historyKey)).state
  const okMarket = safeWriteText(marketKey, JSON.stringify({ state: { snapshot }, version: storeVersion(marketKey) ?? 1 }))
  if (!okMarket) return { ok: false, error: 'Enregistrement impossible (stockage plein ?) : prix du marché inchangés.' }
  safeWriteText(historyKey, JSON.stringify({ state: { entries: pushEntry(history.entries, entry) }, version: storeVersion(historyKey) ?? 1 }))
  return { ok: true }
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
