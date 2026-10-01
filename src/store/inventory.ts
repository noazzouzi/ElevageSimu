// Inventaire des montures du joueur (étable, enclos, inventaire).
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Mount } from '../domain/types'

export type NewMount = Omit<Mount, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }

interface InventoryStore {
  mounts: Mount[]
  add: (m: NewMount) => string
  addMany: (ms: NewMount[]) => string[]
  update: (id: string, patch: Partial<Mount>) => void
  remove: (id: string) => void
  replaceAll: (ms: Mount[]) => void
}

let counter = 0
export function newId(prefix = 'm'): string {
  counter = (counter + 1) % 1_000_000
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

export const useInventory = create<InventoryStore>()(
  persist(
    (set) => ({
      mounts: [],
      add: (m) => {
        const now = Date.now()
        const id = m.id ?? newId()
        set((s) => ({ mounts: [...s.mounts, { ...m, id, createdAt: now, updatedAt: now }] }))
        return id
      },
      addMany: (ms) => {
        const now = Date.now()
        const created = ms.map((m) => ({ ...m, id: m.id ?? newId(), createdAt: now, updatedAt: now }))
        set((s) => ({ mounts: [...s.mounts, ...created] }))
        return created.map((m) => m.id)
      },
      update: (id, patch) =>
        set((s) => ({ mounts: s.mounts.map((m) => (m.id === id ? { ...m, ...patch, id, updatedAt: Date.now() } : m)) })),
      remove: (id) => set((s) => ({ mounts: s.mounts.filter((m) => m.id !== id) })),
      replaceAll: (ms) => set({ mounts: ms }),
    }),
    { name: 'elevagesimu:inventory', version: 1 },
  ),
)
