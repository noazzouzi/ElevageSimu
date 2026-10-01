// État des enclos : niveaux de jauges saisis par le joueur et jauges actives.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { MAX_PADDOCKS } from '../domain/constants'
import type { GaugeId, PaddockState } from '../domain/types'

const emptyGauges = (): Record<GaugeId, number> => ({
  baffeur: 0,
  caresseur: 0,
  foudroyeur: 0,
  abreuvoir: 0,
  dragofesse: 0,
  mangeoire: 0,
})

export const initialPaddocks = (): PaddockState[] =>
  Array.from({ length: MAX_PADDOCKS }, (_, i) => ({ id: i + 1, gauges: emptyGauges(), active: [], updatedAt: 0 }))

interface PaddockStore {
  paddocks: PaddockState[]
  setGauge: (paddock: number, gauge: GaugeId, value: number) => void
  setActive: (paddock: number, active: GaugeId[]) => void
  replaceAll: (p: PaddockState[]) => void
}

export const usePaddocks = create<PaddockStore>()(
  persist(
    (set) => ({
      paddocks: initialPaddocks(),
      setGauge: (paddock, gauge, value) =>
        set((s) => ({
          paddocks: s.paddocks.map((p) =>
            p.id === paddock ? { ...p, gauges: { ...p.gauges, [gauge]: value }, updatedAt: Date.now() } : p,
          ),
        })),
      setActive: (paddock, active) =>
        set((s) => ({ paddocks: s.paddocks.map((p) => (p.id === paddock ? { ...p, active, updatedAt: Date.now() } : p)) })),
      replaceAll: (paddocks) => set({ paddocks }),
    }),
    { name: 'elevagesimu:paddocks', version: 1 },
  ),
)
