// Inventaire des montures du joueur (étable, enclos, inventaire).
// Lecture normalisée (montures inutilisables écartées et signalées) : src/store/schema.ts ;
// persistance sûre et synchronisation entre onglets : src/store/persistence.ts.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Mount } from '../domain/types'
import { persistOptions, syncAcrossTabs } from './persistence'
import { STORE_KEYS, sanitizeInventory } from './schema'

export type NewMount = Omit<Mount, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }

interface InventoryStore {
  mounts: Mount[]
  add: (m: NewMount) => string
  addMany: (ms: NewMount[]) => string[]
  update: (id: string, patch: Partial<Mount>) => void
  /** Même modification pour plusieurs montures, en une seule écriture (action groupée). */
  updateMany: (ids: string[], patch: Partial<Mount>) => void
  /** Modification propre à chaque monture (id → modification), en une seule écriture. */
  patchMany: (patches: Record<string, Partial<Mount>>) => void
  remove: (id: string) => void
  /** Retire plusieurs montures en une seule écriture (action groupée). */
  removeMany: (ids: string[]) => void
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
      updateMany: (ids, patch) => {
        const wanted = new Set(ids)
        const now = Date.now()
        set((s) => ({ mounts: s.mounts.map((m) => (wanted.has(m.id) ? { ...m, ...patch, id: m.id, updatedAt: now } : m)) }))
      },
      patchMany: (patches) => {
        const now = Date.now()
        set((s) => ({ mounts: s.mounts.map((m) => (Object.hasOwn(patches, m.id) ? { ...m, ...patches[m.id], id: m.id, updatedAt: now } : m)) }))
      },
      remove: (id) => set((s) => ({ mounts: s.mounts.filter((m) => m.id !== id) })),
      removeMany: (ids) => {
        const gone = new Set(ids)
        set((s) => ({ mounts: s.mounts.filter((m) => !gone.has(m.id)) }))
      },
      replaceAll: (ms) => set({ mounts: ms }),
    }),
    persistOptions<InventoryStore, { mounts: Mount[] }>({ name: STORE_KEYS.inventory, sanitize: sanitizeInventory }),
  ),
)
syncAcrossTabs(useInventory)
