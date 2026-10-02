// Prix saisis par le joueur (surchargent les valeurs par défaut issues de la recherche).
import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PriceContext } from '../domain/pricing'
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

const setOrDelete = (rec: Record<string, number>, k: string, v: number | null) => {
  const next = { ...rec }
  if (v === null || Number.isNaN(v)) delete next[k]
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
      setGenetonValue: (genetonValue) => set({ genetonValue, updatedAt: Date.now() }),
      replaceAll: (p) => set({ ...p, updatedAt: Date.now() }),
    }),
    { name: 'elevagesimu:prices', version: 1 },
  ),
)

/** Contexte de prix courant (prix saisis + réglage « utiliser les prix par défaut »). */
export function usePriceContext(): PriceContext {
  const overrides = usePrices((s) => s.items)
  const useDefaults = useSettings((s) => s.useDefaultPrices)
  return useMemo(() => ({ overrides, useDefaults }), [overrides, useDefaults])
}
