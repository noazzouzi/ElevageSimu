// Journal des événements d'élevage (captures, accouplements, clonages, extractions, ventes, crafts).
// Sert aux statistiques réelles (taux observés, revenus, coûts) et à l'historique.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { newId } from './inventory'

export type JournalEvent =
  | { kind: 'capture'; speciesId: number; count: number; netItemId?: number | null }
  | {
      kind: 'accouplement'
      parentA: number
      parentB: number
      /** Espèces obtenues (1 ou 2 bébés). */
      babies: number[]
      targetGeneration: number
      targetChance: number
      makina: string | null
      genetons: number
      jobXp: number
    }
  | { kind: 'clonage'; speciesA: number; speciesB: number; kept: number }
  | { kind: 'extraction'; speciesId: number; quantity: number; resourceItemId: number }
  | { kind: 'vente'; label: string; amount: number }
  | { kind: 'achat'; label: string; amount: number }
  | { kind: 'craft'; itemId: number; count: number; jobXp: number }
  | { kind: 'note'; text: string }

export type JournalEntry = JournalEvent & { id: string; at: number }

interface JournalStore {
  entries: JournalEntry[]
  log: (e: JournalEvent, at?: number) => void
  remove: (id: string) => void
  clear: () => void
  replaceAll: (entries: JournalEntry[]) => void
}

export const useJournal = create<JournalStore>()(
  persist(
    (set) => ({
      entries: [],
      log: (e, at) => set((s) => ({ entries: [...s.entries, { ...e, id: newId('j'), at: at ?? Date.now() }] })),
      remove: (id) => set((s) => ({ entries: s.entries.filter((x) => x.id !== id) })),
      clear: () => set({ entries: [] }),
      replaceAll: (entries) => set({ entries }),
    }),
    { name: 'elevagesimu:journal', version: 1 },
  ),
)
