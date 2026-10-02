// Journal des événements d'élevage (captures, accouplements, clonages, extractions, ventes, crafts).
// Sert aux statistiques réelles (taux observés, revenus, coûts), à l'historique et à l'estimation du
// niveau d'Éleveur (`journalJobXp` : XP gagnée depuis la dernière saisie du niveau).
// Lecture normalisée : src/store/schema.ts ; persistance sûre et synchronisation : src/store/persistence.ts.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { JOB_XP_PER_CAPTURE } from '../domain/constants'
import { newId } from './inventory'
import { persistOptions, syncAcrossTabs } from './persistence'
import { STORE_KEYS } from './profiles'
import { sanitizeJournal } from './schema'

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
  /** Supprime les entrées antérieures à `before` (ms) ; renvoie le nombre d'entrées supprimées. */
  removeBefore: (before: number) => number
  clear: () => void
  replaceAll: (entries: JournalEntry[]) => void
}

export const useJournal = create<JournalStore>()(
  persist(
    (set, get) => ({
      entries: [],
      log: (e, at) => set((s) => ({ entries: [...s.entries, { ...e, id: newId('j'), at: at ?? Date.now() }] })),
      remove: (id) => set((s) => ({ entries: s.entries.filter((x) => x.id !== id) })),
      removeBefore: (before) => {
        const kept = get().entries.filter((x) => x.at >= before)
        const removed = get().entries.length - kept.length
        if (removed > 0) set({ entries: kept })
        return removed
      },
      clear: () => set({ entries: [] }),
      replaceAll: (entries) => set({ entries }),
    }),
    persistOptions<JournalStore, { entries: JournalEntry[] }>({ name: STORE_KEYS.journal, sanitize: sanitizeJournal }),
  ),
)
syncAcrossTabs(useJournal)

export interface JournalJobXp {
  /** XP d'Éleveur enregistrée (captures × 30, accouplements, crafts). */
  xp: number
  /** Entrées prises en compte. */
  entries: number
  captures: number
  matings: number
  crafts: number
}

/**
 * XP d'Éleveur enregistrée dans le journal strictement après `since` (ms) — typiquement
 * `settings.jobLevelUpdatedAt`, pour estimer le niveau actuel sans compter deux fois l'XP déjà incluse
 * dans le niveau saisi. Captures : 30 XP par monture capturée (`JOB_XP_PER_CAPTURE`) ; accouplements et
 * crafts : XP enregistrée avec l'entrée. Les bonus Almanax non enregistrés ne sont pas comptés : c'est
 * une estimation (plancher).
 */
export function journalJobXp(entries: readonly JournalEntry[], since: number): JournalJobXp {
  const out: JournalJobXp = { xp: 0, entries: 0, captures: 0, matings: 0, crafts: 0 }
  for (const e of entries) {
    if (!(e.at > since)) continue
    let xp = 0
    if (e.kind === 'capture') {
      xp = Math.max(0, e.count) * JOB_XP_PER_CAPTURE
      out.captures += Math.max(0, e.count)
    } else if (e.kind === 'accouplement') {
      xp = e.jobXp
      out.matings++
    } else if (e.kind === 'craft') {
      xp = e.jobXp
      out.crafts += e.count
    } else continue
    if (!Number.isFinite(xp) || xp <= 0) continue
    out.xp += xp
    out.entries++
  }
  return out
}
