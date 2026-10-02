// Prix saisis par le joueur pour le serveur du profil ouvert (surchargent le marché importé et les
// valeurs par défaut issues de la recherche). Clé : « elevagesimu:s:<serveur>:prices » — partagés par
// tous les profils du même serveur.
// Lecture normalisée (prix invalides retirés, jamais remplacés par 0) : src/store/schema.ts ;
// persistance sûre et synchronisation entre onglets : src/store/persistence.ts.
import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PriceContext } from '../domain/pricing'
import { useMarketSource } from './market'
import { persistOptions, syncAcrossTabs } from './persistence'
import { STORE_KEYS } from './profiles'
import { sanitizePrices, type PricesData } from './schema'
import { useSettings } from './settings'

export type LevelBand = '1' | '100' | '200'

interface PriceStore {
  /** Prix unitaire d'un objet (clé = id DofusDB). */
  items: Record<string, number>
  /** Prix de vente d'une monture (clé = `${speciesId}|${LevelBand}`, id d'espèce numérique). */
  mounts: Record<string, number>
  /** Prix générique par génération (clé = `${family}|${generation}|${LevelBand}`). */
  generations: Record<string, number>
  /** Valeur en kamas d'un généton. */
  genetonValue: number | null
  /** Date (ms) de la dernière mise à jour manuelle. */
  updatedAt: number
  setItem: (id: number | string, price: number | null) => void
  setMount: (speciesId: number, band: LevelBand, price: number | null) => void
  setGeneration: (family: string, generation: number, band: LevelBand, price: number | null) => void
  setGenetonValue: (v: number | null) => void
  replaceAll: (p: Pick<PriceStore, 'items' | 'mounts' | 'generations' | 'genetonValue'>) => void
}

/** Un prix absent, négatif ou non numérique est retiré (« pas de prix »), jamais enregistré comme 0. */
const setOrDelete = (rec: Record<string, number>, k: string, v: number | null) => {
  const next = { ...rec }
  if (v === null || !Number.isFinite(v) || v < 0) delete next[k]
  else next[k] = v
  return next
}

export const usePrices = create<PriceStore>()(
  persist(
    (set) => ({
      items: {},
      mounts: {},
      generations: {},
      genetonValue: null,
      updatedAt: 0,
      setItem: (id, price) => set((s) => ({ items: setOrDelete(s.items, String(id), price), updatedAt: Date.now() })),
      setMount: (speciesId, band, price) =>
        set((s) => ({ mounts: setOrDelete(s.mounts, `${speciesId}|${band}`, price), updatedAt: Date.now() })),
      setGeneration: (family, generation, band, price) =>
        set((s) => ({
          generations: setOrDelete(s.generations, `${family}|${generation}|${band}`, price),
          updatedAt: Date.now(),
        })),
      setGenetonValue: (genetonValue) =>
        set({ genetonValue: genetonValue !== null && Number.isFinite(genetonValue) && genetonValue >= 0 ? genetonValue : null, updatedAt: Date.now() }),
      replaceAll: (p) => set({ ...p, updatedAt: Date.now() }),
    }),
    persistOptions<PriceStore, PricesData>({ name: STORE_KEYS.prices, sanitize: sanitizePrices }),
  ),
)
syncAcrossTabs(usePrices)

/**
 * Contexte de prix courant : prix saisis du serveur + marché importé du serveur (statistique du serveur)
 * + réglage « utiliser les prix par défaut » + niveau d'Éleveur. Ordre de résolution
 * (pricing.marketPrice) : prix saisi > marché > défaut de la recherche > coût de fabrication.
 * Le niveau d'Éleveur (`jobLevel`) fait que le coût des ingrédients d'une recette hors de portée n'est
 * pas pris pour un prix (pricing.resolvePrice : prix HDV d'abord, sinon coût de craft signalé
 * `craftLocked`) — sur toutes les pages, pas seulement Rentabilité et Prix.
 */
export function usePriceContext(): PriceContext {
  const overrides = usePrices((s) => s.items)
  const useDefaults = useSettings((s) => s.useDefaultPrices)
  const jobLevel = useSettings((s) => s.jobLevel)
  const market = useMarketSource()
  return useMemo(() => ({ overrides, useDefaults, jobLevel, market }), [overrides, useDefaults, jobLevel, market])
}
