// État des enclos : niveaux de jauges saisis par le joueur (heure et version des règles de chaque
// saisie, jauge par jauge) et jauges actives (avec leur historique depuis la plus ancienne saisie, pour
// estimer la consommation depuis : src/domain/projection.ts).
//
// Règles :
//  - changer les jauges actives (`setActive`) ne touche JAMAIS aux heures de saisie des niveaux : une
//    saisie vieille de 5 h reste vieille de 5 h (sinon l'estimation de consommation repartait de zéro) ;
//  - chaque jauge garde sa propre heure de saisie (`gaugeUpdatedAt`) et la version des règles sous
//    laquelle elle a été lue (`gaugeRulesets` : les paliers valent ×2 en 3.7) ;
//  - les champs ajoutés sont facultatifs (anciennes données : heure de saisie = `updatedAt`), donc pas
//    de changement de version du stockage.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { GAUGE_IDS, MAX_PADDOCKS } from '../domain/constants'
import { validateActiveGauges } from '../domain/paddock'
import { RULESETS, gaugeMax, getRuleset } from '../domain/rules'
import type { GaugeId, PaddockState, RulesetId } from '../domain/types'
import { persistOptions } from './persistence'
import { STORE_KEYS, isPlainObject, registerStoreSchema, type Sanitized } from './schema'

/** Jauges actives à partir d'un instant (ms). */
export interface ActiveChange {
  at: number
  active: GaugeId[]
}

/** État persisté d'un enclos : `PaddockState` + horodatages par jauge (champs facultatifs, rétrocompatibles). */
export interface PaddockRecord extends PaddockState {
  /** Heure (ms) de la dernière saisie de chaque jauge (absente de l'objet : jamais saisie). Objet absent : `updatedAt` (anciennes données). */
  gaugeUpdatedAt?: Partial<Record<GaugeId, number>>
  /** Version des règles sous laquelle chaque niveau a été saisi (paliers ×2 en 3.7). Absente : inconnue. */
  gaugeRulesets?: Partial<Record<GaugeId, RulesetId>>
  /** Dernier changement des jauges actives (ms). Indépendant des heures de saisie. */
  activeChangedAt?: number
  /**
   * Jauges actives successives (le plus ancien d'abord), depuis la plus ancienne saisie de niveau : la
   * première entrée donne les jauges actives à cette heure-là. À passer en `activeHistory` de la projection.
   */
  activeHistory?: ActiveChange[]
}

/** Nombre maximal d'entrées gardées dans `activeHistory`. */
export const ACTIVE_HISTORY_MAX = 64

const emptyGauges = (): Record<GaugeId, number> => ({
  baffeur: 0,
  caresseur: 0,
  foudroyeur: 0,
  abreuvoir: 0,
  dragofesse: 0,
  mangeoire: 0,
})

export const initialPaddocks = (): PaddockRecord[] =>
  Array.from({ length: MAX_PADDOCKS }, (_, i) => ({ id: i + 1, gauges: emptyGauges(), active: [], updatedAt: 0 }))

/** Enclos vide (jamais saisi) : valeur par défaut d'un enclos absent du store. */
export const emptyPaddock = (id: number): PaddockRecord => ({ id, gauges: emptyGauges(), active: [], updatedAt: 0 })

/** Heure de saisie d'une jauge (0 = jamais saisie). */
export function gaugeEnteredAt(p: PaddockRecord, g: GaugeId): number {
  if (p.gaugeUpdatedAt) return p.gaugeUpdatedAt[g] ?? 0
  return p.updatedAt ?? 0
}

/**
 * Entrées de la projection (`projectPaddock` / `projectGaugeLevels`) pour cet enclos : heure de saisie de
 * chaque jauge et jauges actives successives. `activeSinceMs` = plus ancienne saisie (0 si aucune).
 */
export function paddockProjectionInput(p: PaddockRecord): {
  activeSinceMs: number
  gaugeUpdatedAt: Partial<Record<GaugeId, number>>
  activeHistory: ActiveChange[] | undefined
} {
  const gaugeUpdatedAt: Partial<Record<GaugeId, number>> = {}
  for (const g of GAUGE_IDS) {
    const at = gaugeEnteredAt(p, g)
    if (at > 0) gaugeUpdatedAt[g] = at
  }
  const stamps = Object.values(gaugeUpdatedAt).filter((x): x is number => typeof x === 'number' && x > 0)
  return {
    activeSinceMs: stamps.length ? Math.min(...stamps) : 0,
    gaugeUpdatedAt,
    activeHistory: p.activeHistory && p.activeHistory.length > 0 ? p.activeHistory : undefined,
  }
}

/**
 * Jauges non vides saisies sous une autre version des règles que `rulesetId` (paliers différents :
 * niveaux « à vérifier »). Une jauge sans version connue (anciennes données) n'est pas signalée.
 */
export function levelsFromOtherRuleset(p: PaddockRecord, rulesetId: RulesetId): { gauge: GaugeId; rulesetId: RulesetId }[] {
  const out: { gauge: GaugeId; rulesetId: RulesetId }[] = []
  for (const g of GAUGE_IDS) {
    const id = p.gaugeRulesets?.[g]
    if (id && id !== rulesetId && (p.gauges[g] ?? 0) > 0) out.push({ gauge: g, rulesetId: id })
  }
  return out
}

/** Niveau converti d'une version des règles à une autre (même proportion du plafond, arrondi à l'unité). */
export function convertGaugeLevel(value: number, from: RulesetId, to: RulesetId): number {
  const a = gaugeMax(getRuleset(from))
  const b = gaugeMax(getRuleset(to))
  return Math.max(0, Math.min(b, Math.round((value * b) / a)))
}

/** Historique élagué : entrées depuis `since` (ms), plus la dernière antérieure (jauges actives à `since`). */
export function pruneActiveHistory(history: ActiveChange[], since: number): ActiveChange[] {
  const sorted = [...history].sort((a, b) => a.at - b.at)
  let first = 0
  for (let i = 0; i < sorted.length; i++) if (sorted[i].at <= since) first = i
  return sorted.slice(first).slice(-ACTIVE_HISTORY_MAX)
}

export interface GaugeEntryOptions {
  /** Version des règles de la saisie (bornes : plafond du palier 4 de cette version). */
  rulesetId?: RulesetId
  /** Heure de la saisie (défaut : maintenant). */
  at?: number
}

interface PaddockStore {
  paddocks: PaddockRecord[]
  /** Saisie du niveau d'une jauge (borné à 0 … plafond de la version des règles) : date cette jauge seulement. */
  setGauge: (paddock: number, gauge: GaugeId, value: number, opts?: GaugeEntryOptions) => void
  /** Saisie de plusieurs jauges en une écriture (ex. au démarrage d'un plan). */
  setGauges: (paddock: number, levels: Partial<Record<GaugeId, number>>, opts?: GaugeEntryOptions) => void
  /**
   * Jauges actives (heure du changement : défaut maintenant). Ne modifie ni les niveaux ni leurs heures
   * de saisie ; ajoute le changement à `activeHistory`.
   */
  setActive: (paddock: number, active: GaugeId[], at?: number) => void
  /** Convertit les niveaux saisis sous une autre version des règles (×2 / ÷2) ; garde leurs heures de saisie. */
  convertLevels: (paddock: number, to: RulesetId) => void
  replaceAll: (p: PaddockState[]) => void
}

const clampLevel = (value: number, rulesetId: RulesetId | undefined) => {
  const max = rulesetId ? gaugeMax(getRuleset(rulesetId)) : Infinity
  return Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : 0
}

function withEntries(p: PaddockRecord, levels: Partial<Record<GaugeId, number>>, opts: GaugeEntryOptions = {}): PaddockRecord {
  const at = opts.at ?? Date.now()
  const gauges = { ...p.gauges }
  const gaugeUpdatedAt = { ...p.gaugeUpdatedAt }
  const gaugeRulesets = { ...p.gaugeRulesets }
  // Anciennes données (sans heure par jauge) : les jauges non ressaisies gardent l'heure de saisie commune.
  if (p.gaugeUpdatedAt === undefined && p.updatedAt > 0) for (const g of GAUGE_IDS) gaugeUpdatedAt[g] = p.updatedAt
  for (const [g, v] of Object.entries(levels) as [GaugeId, number][]) {
    if (!GAUGE_IDS.includes(g) || typeof v !== 'number') continue
    gauges[g] = clampLevel(v, opts.rulesetId)
    gaugeUpdatedAt[g] = at
    if (opts.rulesetId) gaugeRulesets[g] = opts.rulesetId
    else delete gaugeRulesets[g]
  }
  const stamps = Object.values(gaugeUpdatedAt).filter((x): x is number => typeof x === 'number' && x > 0)
  const oldest = stamps.length ? Math.min(...stamps) : at
  return {
    ...p,
    gauges,
    gaugeUpdatedAt,
    gaugeRulesets,
    updatedAt: Math.max(p.updatedAt ?? 0, at),
    ...(p.activeHistory ? { activeHistory: pruneActiveHistory(p.activeHistory, oldest) } : {}),
  }
}

function withActive(p: PaddockRecord, active: GaugeId[], at: number): PaddockRecord {
  const stamps = GAUGE_IDS.map((g) => gaugeEnteredAt(p, g)).filter((x) => x > 0)
  const oldest = stamps.length ? Math.min(...stamps) : at
  // Premier changement enregistré : les jauges actives jusque-là valent depuis toujours.
  const history: ActiveChange[] = p.activeHistory && p.activeHistory.length > 0 ? [...p.activeHistory] : [{ at: 0, active: [...p.active] }]
  history.push({ at, active: [...active] })
  return { ...p, active: [...active], activeChangedAt: at, activeHistory: pruneActiveHistory(history, oldest) }
}

const editPaddock = (paddocks: PaddockRecord[], id: number, edit: (p: PaddockRecord) => PaddockRecord): PaddockRecord[] => {
  const exists = paddocks.some((p) => p.id === id)
  const list = exists ? paddocks : [...paddocks, emptyPaddock(id)].sort((a, b) => a.id - b.id)
  return list.map((p) => (p.id === id ? edit(p) : p))
}

export const usePaddocks = create<PaddockStore>()(
  persist(
    (set) => ({
      paddocks: initialPaddocks(),
      setGauge: (paddock, gauge, value, opts) => set((s) => ({ paddocks: editPaddock(s.paddocks, paddock, (p) => withEntries(p, { [gauge]: value }, opts)) })),
      setGauges: (paddock, levels, opts) => set((s) => ({ paddocks: editPaddock(s.paddocks, paddock, (p) => withEntries(p, levels, opts)) })),
      setActive: (paddock, active, at) => set((s) => ({ paddocks: editPaddock(s.paddocks, paddock, (p) => withActive(p, active, at ?? Date.now())) })),
      convertLevels: (paddock, to) =>
        set((s) => ({
          paddocks: editPaddock(s.paddocks, paddock, (p) => {
            const gauges = { ...p.gauges }
            const gaugeRulesets = { ...p.gaugeRulesets }
            for (const g of GAUGE_IDS) {
              const from = gaugeRulesets[g]
              if (!from || from === to) continue
              gauges[g] = convertGaugeLevel(gauges[g] ?? 0, from, to)
              gaugeRulesets[g] = to
            }
            return { ...p, gauges, gaugeRulesets }
          }),
        })),
      replaceAll: (paddocks) => set({ paddocks: sanitizePaddocks({ paddocks }).state.paddocks }),
    }),
    persistOptions<PaddockStore, { paddocks: PaddockRecord[] }>({
      name: STORE_KEYS.paddocks,
      sanitize: sanitizePaddocks,
      partialize: (s) => ({ paddocks: s.paddocks }),
    }),
  ),
)

// ---------- Lecture normalisée (données persistées, sauvegarde importée) ----------

// Fonctions (hissées) et non constantes : la réhydratation appelle la normalisation pendant `create()`.
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}
function isGauge(v: unknown): v is GaugeId {
  return typeof v === 'string' && (GAUGE_IDS as string[]).includes(v)
}
function isRuleset(v: unknown): v is RulesetId {
  return typeof v === 'string' && Object.hasOwn(RULESETS, v)
}

function sanitizeActive(v: unknown): GaugeId[] | null {
  if (!Array.isArray(v)) return null
  const list = v.filter(isGauge)
  if (list.length !== v.length || validateActiveGauges(list) !== null) return null
  return list
}

/**
 * Normalise l'état persisté des enclos : 6 enclos, niveaux finis ≥ 0, jauges actives valides, horodatages
 * finis. Ne lève jamais ; une valeur invalide est remplacée par la valeur par défaut et signalée.
 */
export function sanitizePaddocks(raw: unknown): Sanitized<{ paddocks: PaddockRecord[] }> {
  const issues: string[] = []
  const list = isPlainObject(raw) && Array.isArray(raw.paddocks) ? raw.paddocks : null
  if (isPlainObject(raw) && raw.paddocks !== undefined && !list) issues.push('enclos illisibles remis à zéro')
  const byId = new Map<number, PaddockRecord>()
  let fixed = 0
  for (const x of list ?? []) {
    if (!isPlainObject(x) || !isNum(x.id) || !Number.isInteger(x.id) || x.id < 1 || x.id > MAX_PADDOCKS || byId.has(x.id)) {
      fixed++
      continue
    }
    let bad = false
    const gauges = emptyGauges()
    const rawGauges = isPlainObject(x.gauges) ? x.gauges : {}
    for (const g of GAUGE_IDS) {
      const v = rawGauges[g]
      if (v === undefined) continue
      if (isNum(v) && v >= 0) gauges[g] = v
      else bad = true
    }
    const active = sanitizeActive(x.active)
    if (active === null && x.active !== undefined) bad = true
    const p: PaddockRecord = { id: x.id, gauges, active: active ?? [], updatedAt: isNum(x.updatedAt) && x.updatedAt >= 0 ? x.updatedAt : 0 }
    if (isPlainObject(x.gaugeUpdatedAt)) {
      const stamps: Partial<Record<GaugeId, number>> = {}
      for (const [g, v] of Object.entries(x.gaugeUpdatedAt)) if (isGauge(g) && isNum(v) && v > 0) stamps[g] = v
      p.gaugeUpdatedAt = stamps
    }
    if (isPlainObject(x.gaugeRulesets)) {
      const tags: Partial<Record<GaugeId, RulesetId>> = {}
      for (const [g, v] of Object.entries(x.gaugeRulesets)) if (isGauge(g) && isRuleset(v)) tags[g] = v
      p.gaugeRulesets = tags
    }
    if (isNum(x.activeChangedAt) && x.activeChangedAt > 0) p.activeChangedAt = x.activeChangedAt
    if (Array.isArray(x.activeHistory)) {
      const history: ActiveChange[] = []
      for (const h of x.activeHistory) {
        const a = isPlainObject(h) ? sanitizeActive(h.active) : null
        if (isPlainObject(h) && isNum(h.at) && h.at >= 0 && a) history.push({ at: h.at, active: a })
      }
      p.activeHistory = history.sort((a, b) => a.at - b.at).slice(-ACTIVE_HISTORY_MAX)
    }
    if (bad) fixed++
    byId.set(x.id, p)
  }
  if (fixed > 0) issues.push(`${fixed} enclos corrigé${fixed > 1 ? 's' : ''} (valeurs invalides)`)
  return { state: { paddocks: Array.from({ length: MAX_PADDOCKS }, (_, i) => byId.get(i + 1) ?? emptyPaddock(i + 1)) }, issues }
}

// Import d'une sauvegarde : même normalisation qu'au chargement (schema.normalizeStoreValue).
registerStoreSchema(STORE_KEYS.paddocks, { sanitize: (raw) => sanitizePaddocks(raw) as unknown as Sanitized<Record<string, unknown>> })
