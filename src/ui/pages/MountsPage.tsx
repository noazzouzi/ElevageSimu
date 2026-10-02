// Page « Mes montures » : étable, enclos et inventaire du joueur. Synthèse, captures groupées,
// éditeur de monture, filtres et tri, actions groupées (déplacer, marquer stérile, cloner, extraire,
// vendre, supprimer) et sort conseillé de chaque monture (src/domain/mountFate.ts, grille de
// STRATEGY.mountFateGrid ; valeurs : src/domain/economy.ts).
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FAMILIES, FAMILY_IDS, SPECIES, STRATEGY, getSpecies } from '../../data'
import { ABILITY_LABELS, JOB_XP_PER_CAPTURE, PADDOCK_SLOTS, PADDOCK_UNLOCK_LEVELS, SERENITY_MAX, SERENITY_MIN } from '../../domain/constants'
import { BRISAGE_RISK_NOTE, genetonKamasValue, levelingCost, mountValuation, normalizeName, parseKamas, type MountPriceContext } from '../../domain/economy'
import {
  FATE_ACTION_LABELS,
  FATE_ACTIONS,
  SERENITY_BANDS,
  SERENITY_SMILEYS,
  captureBlockers,
  capturedMounts,
  clonePatch,
  extractionQuantity,
  extractionResource,
  fateState,
  inventorySummary,
  locationKey,
  locationLabel,
  moveBlockers,
  paddockOccupancy,
  parseLocationKey,
  recommendFates,
  unlockedPaddocks,
  type CaptureLine,
  type FateAction,
  type FateValuation,
  type InventorySummary,
  type LevelCostFn,
  type LocationKey,
  type MountFate,
  type UsefulnessKind,
  type ValuationFn,
} from '../../domain/mountFate'
import { cloningBlockers, effectiveFertility, FERTILITY_LABELS, GENDER_ICONS, GENDER_LABELS, mountName } from '../../domain/mounts'
import { serenityBand, type SerenityBand } from '../../domain/paddock'
import { marketPrice } from '../../domain/pricing'
import type { Ruleset } from '../../domain/rules'
import type { FamilyId, Fertility, Mount } from '../../domain/types'
import { formatKamas, formatNumber } from '../../lib/format'
import { useInventory, type NewMount } from '../../store/inventory'
import { useJournal } from '../../store/journal'
import { usePriceContext, usePrices } from '../../store/prices'
import { useRules, useSettings } from '../../store/settings'
import { Badge, Callout, Card, Empty, NumberField, PageHeader, Progress, Stat } from '../components'
import { GaugeBars, Modal, MountEditor, SerenitySmiley, StatusBadge } from '../MountEditor'
import { href, useRoute } from '../router'
import { ConfidenceBadge, GenBadge, SpeciesName } from '../species'
import './MountsPage.css'

// ---------- Constantes d'affichage ----------

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'gold' | 'accent'

const FATE_TONES: Record<FateAction, Tone> = {
  garder: 'ok',
  accoupler: 'accent',
  cloner: 'info',
  monter: 'gold',
  vente: 'warn',
  extraction: 'warn',
  brisage: 'warn',
  'a-chiffrer': 'danger',
}

const USEFULNESS_LABELS: Record<UsefulnessKind, string> = {
  objectif: 'Monture visée',
  recette: 'Recette du plan',
  ascendance: 'Autre chemin du plan',
  porteur: 'Porteuse',
  progression: 'Parent possible',
  aucune: 'Hors plan',
}

const STATUS_ORDER: Record<Fertility, number> = { feconde: 0, fertile: 1, sterile: 2, senile: 3 }
const STATUSES: Fertility[] = ['feconde', 'fertile', 'sterile', 'senile']

type SortKey = 'nom' | 'generation' | 'niveau' | 'statut' | 'serenite' | 'jauges' | 'lieu' | 'sort' | 'valeur'

interface Filters {
  family: FamilyId | 'toutes'
  generation: number
  status: Fertility | 'tous'
  location: LocationKey | 'tous'
  band: SerenityBand | 'toutes'
  fate: FateAction | 'tous'
  q: string
}

interface SortState {
  key: SortKey
  dir: 1 | -1
}

const DEFAULT_FILTERS: Filters = { family: 'toutes', generation: 0, status: 'tous', location: 'tous', band: 'toutes', fate: 'tous', q: '' }
const DEFAULT_SORT: SortState = { key: 'generation', dir: -1 }
const UI_KEY = 'elevagesimu:montures-ui'

function loadUi(): { filters: Filters; sort: SortState } {
  try {
    const raw = window.localStorage.getItem(UI_KEY)
    if (!raw) return { filters: DEFAULT_FILTERS, sort: DEFAULT_SORT }
    const parsed = JSON.parse(raw) as { filters?: Partial<Filters>; sort?: Partial<SortState> }
    return {
      filters: { ...DEFAULT_FILTERS, ...parsed.filters },
      sort: { ...DEFAULT_SORT, ...parsed.sort },
    }
  } catch {
    return { filters: DEFAULT_FILTERS, sort: DEFAULT_SORT }
  }
}

function saveUi(filters: Filters, sort: SortState) {
  try {
    window.localStorage.setItem(UI_KEY, JSON.stringify({ filters, sort }))
  } catch {
    // Stockage indisponible (navigation privée…) : sans conséquence.
  }
}

const CAPTURABLE = SPECIES.filter((s) => s.capturable && s.generation === 1)

function locationOrder(m: Mount): number {
  if (m.location.kind === 'enclos') return m.location.paddock
  return m.location.kind === 'etable' ? 10 : 11
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n > 1 ? many : one}`
}

type Dialog = { kind: 'move' | 'sell' | 'extract' | 'delete' | 'clone'; ids: string[] } | null
type EditorState = { mode: 'new'; initial?: Partial<NewMount> } | { mode: 'edit'; id: string } | null

// ---------- Page ----------

export default function MountsPage() {
  const mounts = useInventory((s) => s.mounts)
  const add = useInventory((s) => s.add)
  const addMany = useInventory((s) => s.addMany)
  const update = useInventory((s) => s.update)
  const remove = useInventory((s) => s.remove)
  const log = useJournal((s) => s.log)
  const goalSpeciesId = useSettings((s) => s.goalSpeciesId)
  const jobLevel = useSettings((s) => s.jobLevel)
  const saleTax = useSettings((s) => s.saleTax)
  const preferredTier = useSettings((s) => s.preferredTier)
  const useDefaultPrices = useSettings((s) => s.useDefaultPrices)
  const preferredFamily = useSettings((s) => s.family)
  const rules = useRules()
  const ctx = usePriceContext()
  const pMounts = usePrices((s) => s.mounts)
  const pGenerations = usePrices((s) => s.generations)
  const genetonOverride = usePrices((s) => s.genetonValue)
  const mctx = useMemo<MountPriceContext>(() => ({ mountOverrides: pMounts, generationOverrides: pGenerations, useDefaults: useDefaultPrices }), [pMounts, pGenerations, useDefaultPrices])
  const genetonValue = genetonKamasValue(genetonOverride).value

  const valuation = useCallback<ValuationFn>(
    (speciesId, level, o) => mountValuation(speciesId, level, { ctx, mountPrices: mctx, saleTax, state: o.state, senile: o.senile }),
    [ctx, mctx, saleTax],
  )
  const levelCost = useCallback<LevelCostFn>(
    (from, to, m) => {
      const c = levelingCost(from, to, { tier: preferredTier, batchSize: 10, sage: m.ability === 'sage', ctx, rules, jobLevel })
      return { cost: c.costPerMount, complete: c.complete, seconds: c.secondsPerBatch }
    },
    [preferredTier, ctx, rules, jobLevel],
  )
  const fates = useMemo(
    () => recommendFates({ inventory: mounts, goalSpeciesId, rules, valuation, levelCost, genetonValue }),
    [mounts, goalSpeciesId, rules, valuation, levelCost, genetonValue],
  )
  const summary = useMemo(() => inventorySummary(mounts), [mounts])
  const byId = useMemo(() => new Map(mounts.map((m) => [m.id, m])), [mounts])

  const [ui] = useState(loadUi)
  const [filters, setFilters] = useState<Filters>(ui.filters)
  const [sort, setSort] = useState<SortState>(ui.sort)
  const [selection, setSelection] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState>(null)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [flash, setFlash] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)

  useEffect(() => saveUi(filters, sort), [filters, sort])
  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 6000)
    return () => window.clearTimeout(t)
  }, [flash])

  // Paramètres d'URL : #/montures?famille=muldo&statut=feconde&lieu=enclos-1&sort=cloner&q=…&ajout=1&captures=1&id=…
  const route = useRoute()
  const routeKey = route.params.toString()
  useEffect(() => {
    const p = new URLSearchParams(routeKey)
    const next: Partial<Filters> = {}
    const fam = p.get('famille')
    if (fam && (FAMILY_IDS as string[]).includes(fam)) next.family = fam as FamilyId
    const st = p.get('statut')
    if (st && (STATUSES as string[]).includes(st)) next.status = st as Fertility
    const lieu = p.get('lieu')
    if (lieu && parseLocationKey(lieu)) next.location = lieu as LocationKey
    const gen = Number(p.get('generation'))
    if (gen >= 1 && gen <= 10) next.generation = gen
    const fate = p.get('sort')
    if (fate && (FATE_ACTIONS as string[]).includes(fate)) next.fate = fate as FateAction
    const q = p.get('q')
    if (q) next.q = q
    if (Object.keys(next).length) setFilters({ ...DEFAULT_FILTERS, ...next })
    if (p.get('ajout') === '1') setEditor({ mode: 'new' })
    if (p.get('captures') === '1') setCaptureOpen(true)
    const id = p.get('id')
    if (id && useInventory.getState().mounts.some((m) => m.id === id)) setEditor({ mode: 'edit', id })
  }, [routeKey])

  const rows = useMemo(() => {
    const q = normalizeName(filters.q)
    const list = mounts.filter((m) => {
      const sp = getSpecies(m.speciesId)
      if (filters.family !== 'toutes' && sp?.family !== filters.family) return false
      if (filters.generation && sp?.generation !== filters.generation) return false
      if (filters.status !== 'tous' && effectiveFertility(m) !== filters.status) return false
      if (filters.location !== 'tous' && locationKey(m.location) !== filters.location) return false
      if (filters.band !== 'toutes' && serenityBand(m.serenity) !== filters.band) return false
      if (filters.fate !== 'tous' && fates.get(m.id)?.action !== filters.fate) return false
      if (q && !normalizeName(`${mountName(m)} ${sp?.name ?? ''} ${m.notes ?? ''}`).includes(q)) return false
      return true
    })
    const name = (m: Mount) => mountName(m)
    const gen = (m: Mount) => getSpecies(m.speciesId)?.generation ?? 0
    const value = (m: Mount) => {
      const f = fates.get(m.id)
      return f?.value ?? f?.floor ?? Number.NEGATIVE_INFINITY
    }
    const cmp: Record<SortKey, (a: Mount, b: Mount) => number> = {
      nom: (a, b) => name(a).localeCompare(name(b), 'fr'),
      generation: (a, b) => gen(a) - gen(b),
      niveau: (a, b) => a.level - b.level,
      statut: (a, b) => STATUS_ORDER[effectiveFertility(b)] - STATUS_ORDER[effectiveFertility(a)],
      serenite: (a, b) => a.serenity - b.serenity,
      jauges: (a, b) => a.endurance + a.maturity + a.love - (b.endurance + b.maturity + b.love),
      lieu: (a, b) => locationOrder(b) - locationOrder(a),
      sort: (a, b) => FATE_ACTIONS.indexOf(fates.get(b.id)?.action ?? 'a-chiffrer') - FATE_ACTIONS.indexOf(fates.get(a.id)?.action ?? 'a-chiffrer'),
      valeur: (a, b) => value(a) - value(b),
    }
    const c = cmp[sort.key] ?? cmp.generation
    return [...list].sort((a, b) => sort.dir * c(a, b) || name(a).localeCompare(name(b), 'fr') || a.id.localeCompare(b.id))
  }, [mounts, filters, sort, fates])

  // Les actions groupées ne portent que sur les montures sélectionnées ET affichées : une monture
  // masquée par les filtres (ex. la conservée d'un clonage sous le filtre « Stérile ») n'est jamais
  // vendue, extraite ou supprimée à l'insu du joueur.
  const selected = useMemo(() => rows.filter((m) => selection.has(m.id)).map((m) => m.id), [selection, rows])
  const allShownSelected = rows.length > 0 && rows.every((m) => selection.has(m.id))
  const someShownSelected = rows.some((m) => selection.has(m.id))

  const toggle = (id: string) =>
    setSelection((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const clearSelection = () => setSelection(new Set())
  const setSortKey = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'nom' || key === 'lieu' ? 1 : -1 }))
  const filtered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS)

  // ----- Actions -----
  const markSterile = (ids: string[]) => {
    let n = 0
    for (const id of ids) {
      const m = byId.get(id)
      if (!m || m.fertility === 'senile' || m.fertility === 'sterile') continue
      update(id, { fertility: 'sterile' })
      n++
    }
    setFlash({ tone: n ? 'ok' : 'warn', text: n ? `${plural(n, 'monture marquée', 'montures marquées')} stérile${n > 1 ? 's' : ''}.` : 'Aucune monture à marquer (déjà stériles ou séniles).' })
  }
  const removeIds = (ids: string[]) => {
    for (const id of ids) remove(id)
    setSelection((s) => {
      const n = new Set(s)
      for (const id of ids) n.delete(id)
      return n
    })
  }

  const editing = editor?.mode === 'edit' ? byId.get(editor.id) ?? null : null
  const fateCounts = useMemo(() => {
    const c = new Map<FateAction, { n: number; value: number; incomplete: number }>()
    for (const f of fates.values()) {
      const e = c.get(f.action) ?? { n: 0, value: 0, incomplete: 0 }
      e.n++
      e.value += f.value ?? 0
      if (!f.complete) e.incomplete++
      c.set(f.action, e)
    }
    return c
  }, [fates])
  const incompleteCount = [...fates.values()].filter((f) => !f.complete).length

  return (
    <div className="mt-page">
      <PageHeader
        title="Mes montures"
        subtitle="Votre étable, vos enclos et votre inventaire — et, pour chaque monture, ce qu'il vaut mieux en faire maintenant."
        actions={
          <>
            <button className="btn" onClick={() => setCaptureOpen(true)}>
              🪤 Ajouter des captures
            </button>
            <button className="btn primary" onClick={() => setEditor({ mode: 'new' })}>
              ＋ Ajouter une monture
            </button>
          </>
        }
      />

      {flash && <Callout tone={flash.tone}>{flash.text}</Callout>}

      {mounts.length === 0 ? (
        <Onboarding onCapture={() => setCaptureOpen(true)} onAdd={() => setEditor({ mode: 'new' })} />
      ) : (
        <>
          <GoalBanner goalSpeciesId={goalSpeciesId} />
          <SummaryCard
            summary={summary}
            fateCounts={fateCounts}
            fates={fates}
            jobLevel={jobLevel}
            rules={rules}
            onFilter={(patch) => setFilters({ ...DEFAULT_FILTERS, ...patch })}
          />
          {incompleteCount > 0 && (
            <Callout tone="warn">
              <strong>Coût incomplet</strong> : {plural(incompleteCount, 'monture a', 'montures ont')} une option de sortie sans prix (valeur affichée = minimum, ou inconnue).{' '}
              <a href={href('prix', { onglet: 'montures' })}>Saisir les prix des montures</a> ou des <a href={href('prix', { onglet: 'ingredients' })}>ressources d'extraction</a>.
            </Callout>
          )}

          <Card
            title={<h2>Montures ({rows.length === mounts.length ? formatNumber(mounts.length) : `${formatNumber(rows.length)} / ${formatNumber(mounts.length)}`})</h2>}
            actions={
              filtered ? (
                <button className="btn small" onClick={() => setFilters(DEFAULT_FILTERS)}>
                  Effacer les filtres
                </button>
              ) : undefined
            }
          >
            <FiltersBar filters={filters} onChange={setFilters} sort={sort} onSort={setSort} />

            {selected.length > 0 && (
              <div className="mt-bulk" role="toolbar" aria-label="Actions sur la sélection">
                <strong>{plural(selected.length, 'sélectionnée', 'sélectionnées')}</strong>
                <button className="btn small" onClick={() => setDialog({ kind: 'move', ids: selected })}>
                  Déplacer…
                </button>
                <button className="btn small" onClick={() => markSterile(selected)}>
                  Marquer stérile
                </button>
                <button
                  className="btn small"
                  disabled={selected.length !== 2}
                  title={selected.length !== 2 ? 'Sélectionnez exactement 2 montures de même famille et même génération.' : 'Enregistrer un clonage'}
                  onClick={() => setDialog({ kind: 'clone', ids: selected })}
                >
                  Cloner…
                </button>
                <button className="btn small" onClick={() => setDialog({ kind: 'extract', ids: selected })}>
                  Extraire…
                </button>
                <button className="btn small" onClick={() => setDialog({ kind: 'sell', ids: selected })}>
                  Vendre…
                </button>
                <button className="btn small danger" onClick={() => setDialog({ kind: 'delete', ids: selected })}>
                  Supprimer…
                </button>
                <span className="spacer" />
                <button className="btn small ghost" onClick={clearSelection}>
                  Tout désélectionner
                </button>
              </div>
            )}

            {rows.length === 0 ? (
              <Empty>
                Aucune monture ne correspond à ces filtres.{' '}
                <button className="btn small" onClick={() => setFilters(DEFAULT_FILTERS)}>
                  Effacer les filtres
                </button>
              </Empty>
            ) : (
              <div className="table-wrap">
                <table className="table mt-table">
                  <thead>
                    <tr>
                      <th className="mt-col-check">
                        <input
                          type="checkbox"
                          aria-label="Tout sélectionner (montures affichées)"
                          checked={allShownSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someShownSelected && !allShownSelected
                          }}
                          onChange={() =>
                            setSelection((s) => {
                              const n = new Set(s)
                              if (allShownSelected) for (const m of rows) n.delete(m.id)
                              else for (const m of rows) n.add(m.id)
                              return n
                            })
                          }
                        />
                      </th>
                      <SortTh label="Monture" k="nom" sort={sort} onSort={setSortKey} />
                      <th>Sexe</th>
                      <SortTh label="Niv." k="niveau" sort={sort} onSort={setSortKey} num />
                      <SortTh label="Statut" k="statut" sort={sort} onSort={setSortKey} />
                      <SortTh label="Sérénité" k="serenite" sort={sort} onSort={setSortKey} />
                      <SortTh label="E / M / A" k="jauges" sort={sort} onSort={setSortKey} className="mt-hide-sm" />
                      <SortTh label="Lieu" k="lieu" sort={sort} onSort={setSortKey} />
                      <th className="mt-hide-sm">Capacité</th>
                      <SortTh label="Sort conseillé" k="sort" sort={sort} onSort={setSortKey} />
                      <th className="num">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      <MountRow
                        key={m.id}
                        m={m}
                        fate={fates.get(m.id)}
                        partner={(() => {
                          const pid = fates.get(m.id)?.partnerId
                          return pid ? byId.get(pid) : undefined
                        })()}
                        selected={selection.has(m.id)}
                        expanded={expanded === m.id}
                        unlocked={unlockedPaddocks(jobLevel)}
                        onToggle={() => toggle(m.id)}
                        onExpand={() => setExpanded((x) => (x === m.id ? null : m.id))}
                        onEdit={() => setEditor({ mode: 'edit', id: m.id })}
                        onMove={() => setDialog({ kind: 'move', ids: [m.id] })}
                        onDelete={() => setDialog({ kind: 'delete', ids: [m.id] })}
                        onClonePair={(pid) => setDialog({ kind: 'clone', ids: [m.id, pid] })}
                        onSelectPair={(pid) => setSelection(new Set([m.id, pid]))}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted mt-help">
              Cliquez sur un sort conseillé pour voir le pourquoi. Grille appliquée dans l'ordre : garder → accoupler d'abord → cloner → monter en niveau → meilleure sortie (vente,
              extraction, brisage), d'après la stratégie de la recherche. {BRISAGE_RISK_NOTE}
            </p>
          </Card>
        </>
      )}

      {editor && (editor.mode === 'new' || editing) && (
        <MountEditor
          mount={editing}
          initial={editor.mode === 'new' ? editor.initial : undefined}
          onCancel={() => setEditor(null)}
          onSave={(data, id) => {
            if (id) update(id, data)
            else add(data)
            setEditor(null)
            setFlash({ tone: 'ok', text: id ? `${mountName({ ...(data as Mount), id })} : modifications enregistrées.` : `${getSpecies(data.speciesId)?.name ?? 'Monture'} ajoutée.` })
          }}
          onDelete={(id) => {
            setEditor(null)
            setDialog({ kind: 'delete', ids: [id] })
          }}
        />
      )}

      {captureOpen && (
        <CaptureDialog
          mounts={mounts}
          jobLevel={jobLevel}
          stableSlots={rules.stableSlots}
          defaultFamily={preferredFamily}
          onClose={() => setCaptureOpen(false)}
          onSave={(lines, location, serenity) => {
            const created = capturedMounts(lines, { serenity, location })
            addMany(created)
            for (const l of lines) {
              const count = Math.max(0, Math.floor(l.males)) + Math.max(0, Math.floor(l.females))
              if (l.speciesId !== null && count > 0) log({ kind: 'capture', speciesId: l.speciesId, count, netItemId: null })
            }
            setCaptureOpen(false)
            setFlash({ tone: 'ok', text: `${plural(created.length, 'capture ajoutée', 'captures ajoutées')} (${locationLabel(location)}) et notée${created.length > 1 ? 's' : ''} au journal — +${formatNumber(created.length * JOB_XP_PER_CAPTURE)} XP d'Éleveur.` })
          }}
        />
      )}

      {dialog?.kind === 'move' && (
        <MoveDialog
          list={dialog.ids.map((id) => byId.get(id)).filter((m): m is Mount => !!m)}
          mounts={mounts}
          jobLevel={jobLevel}
          stableSlots={rules.stableSlots}
          onClose={() => setDialog(null)}
          onConfirm={(loc) => {
            for (const id of dialog.ids) update(id, { location: loc })
            setDialog(null)
            setFlash({ tone: 'ok', text: `${plural(dialog.ids.length, 'monture déplacée', 'montures déplacées')} vers : ${locationLabel(loc)}.` })
          }}
        />
      )}

      {dialog?.kind === 'clone' && (
        <CloneDialog
          list={dialog.ids.map((id) => byId.get(id)).filter((m): m is Mount => !!m)}
          rules={rules}
          onClose={() => setDialog(null)}
          onConfirm={(kept, other) => {
            update(kept.id, clonePatch(kept, rules))
            removeIds([other.id])
            log({ kind: 'clonage', speciesA: kept.speciesId, speciesB: other.speciesId, kept: kept.speciesId })
            setDialog(null)
            setSelection(new Set([kept.id]))
            setFlash({ tone: 'ok', text: `Clonage enregistré : ${mountName(kept)} est fertile (jauges à 0) ; ${mountName(other)} a été retirée.` })
          }}
        />
      )}

      {dialog?.kind === 'extract' && (
        <ExtractDialog
          list={dialog.ids.map((id) => byId.get(id)).filter((m): m is Mount => !!m)}
          fates={fates}
          onClose={() => setDialog(null)}
          onConfirm={(done) => {
            for (const m of done) {
              const res = extractionResource(m)
              if (res) log({ kind: 'extraction', speciesId: m.speciesId, quantity: extractionQuantity(m), resourceItemId: res.itemId })
            }
            removeIds(done.map((m) => m.id))
            setDialog(null)
            setFlash({ tone: 'ok', text: `${plural(done.length, 'extraction enregistrée', 'extractions enregistrées')} au journal.` })
          }}
        />
      )}

      {dialog?.kind === 'sell' && (
        <SellDialog
          list={dialog.ids.map((id) => byId.get(id)).filter((m): m is Mount => !!m)}
          fates={fates}
          valuation={valuation}
          onClose={() => setDialog(null)}
          onConfirm={(amount, label) => {
            log({ kind: 'vente', label, amount })
            removeIds(dialog.ids)
            setDialog(null)
            setFlash({ tone: 'ok', text: `Vente enregistrée au journal : ${formatKamas(amount)}.` })
          }}
        />
      )}

      {dialog?.kind === 'delete' && (
        <DeleteDialog
          list={dialog.ids.map((id) => byId.get(id)).filter((m): m is Mount => !!m)}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            removeIds(dialog.ids)
            setDialog(null)
            setFlash({ tone: 'ok', text: `${plural(dialog.ids.length, 'monture supprimée', 'montures supprimées')}.` })
          }}
        />
      )}
    </div>
  )
}

// ---------- Bandeau objectif ----------

function GoalBanner({ goalSpeciesId }: { goalSpeciesId: number | null }) {
  const goal = goalSpeciesId !== null ? getSpecies(goalSpeciesId) : undefined
  if (!goal)
    return (
      <Callout>
        <strong>Aucune monture visée.</strong> Sans objectif, toute monture capable de donner une génération supérieure est gardée et seules les stériles sont triées.{' '}
        <a href={href('reglages')}>Choisir une monture visée</a> pour un sort conseillé plus précis.
      </Callout>
    )
  return (
    <Callout tone="ok">
      <strong>Objectif :</strong> <SpeciesName id={goal.id} /> — les montures de sa recette et de ses autres chemins de croisement sont gardées ; les autres sont accouplées entre
      elles, clonées ou sorties. <a href={href('genetique', { id: goal.id })}>Voir l'arbre</a> · <a href={href('reglages')}>changer d'objectif</a>
    </Callout>
  )
}

// ---------- Synthèse ----------

function SummaryCard({
  summary,
  fateCounts,
  fates,
  jobLevel,
  rules,
  onFilter,
}: {
  summary: InventorySummary
  fateCounts: Map<FateAction, { n: number; value: number; incomplete: number }>
  fates: Map<string, MountFate>
  jobLevel: number
  rules: Ruleset
  onFilter: (patch: Partial<Filters>) => void
}) {
  const unlocked = unlockedPaddocks(jobLevel)
  const occupied = [...summary.paddock.entries()].filter(([n]) => n <= unlocked).reduce((s, [, v]) => s + v, 0)
  const lockedOccupied = [...summary.paddock.entries()].filter(([n]) => n > unlocked).reduce((s, [, v]) => s + v, 0)
  const capacity = unlocked * PADDOCK_SLOTS
  const floorTotal = [...fates.values()].reduce((s, f) => s + (f.floor ?? 0), 0)
  const floorIncomplete = [...fates.values()].some((f) => f.floor === null || !f.complete)
  const gens = [...summary.byGeneration.entries()].sort((a, b) => a[0] - b[0])
  const cloneN = fateCounts.get('cloner')?.n ?? 0
  return (
    <Card title="Vue d'ensemble">
      <div className="kpis">
        <Stat label="Montures" value={formatNumber(summary.total)} hint={`Étable ${formatNumber(summary.stable)} / ${formatNumber(rules.stableSlots)} · inventaire ${formatNumber(summary.inventory)}`} />
        <Stat
          label="Fécondes prêtes"
          value={formatNumber(summary.byStatus.feconde)}
          tone={summary.byStatus.feconde > 0 ? 'pos' : undefined}
          hint={
            <>
              {plural(summary.fecundPairs, 'couple ♂/♀ possible', 'couples ♂/♀ possibles')}
              {summary.fecundInPaddock > 0 && <> · {formatNumber(summary.fecundInPaddock)} en enclos : à ramener à l'étable</>}
            </>
          }
        />
        <Stat label="Fertiles à féconder" value={formatNumber(summary.byStatus.fertile)} hint="endurance, maturité et amour à 20 000" />
        <Stat label="Stériles" value={formatNumber(summary.byStatus.sterile)} hint={cloneN > 0 ? `${plural(cloneN, 'à cloner')} (paires conseillées)` : 'aucune paire de clonage'} />
        <Stat
          label="Places d'enclos"
          value={`${formatNumber(occupied)} / ${formatNumber(capacity)}`}
          tone={occupied < capacity ? undefined : 'neg'}
          hint={`${plural(unlocked, 'enclos débloqué', 'enclos débloqués')} (Éleveur niv. ${jobLevel})${occupied < capacity ? ` · ${formatNumber(capacity - occupied)} libres` : ''}`}
        />
        <Stat
          label="Valeur de sortie"
          value={`${floorIncomplete ? '≥ ' : ''}${formatKamas(floorTotal, true)}`}
          hint={
            <>
              plancher : meilleure entre vente, extraction et brisage <ConfidenceBadge level="low" />
            </>
          }
        />
      </div>
      {lockedOccupied > 0 && (
        <Callout tone="warn">
          {plural(lockedOccupied, 'monture est placée', 'montures sont placées')} dans un enclos non débloqué à votre niveau d'Éleveur ({jobLevel}). Vérifiez votre niveau dans les{' '}
          <a href={href('reglages')}>Réglages</a> ou déplacez-les.
        </Callout>
      )}
      <div className="divider" />
      <div className="grid grid-2">
        <div className="stack" style={{ gap: 12 }}>
          <div>
            <h3>Par famille</h3>
            <div className="mt-chips">
              {FAMILY_IDS.filter((f) => summary.byFamily[f] > 0).map((f) => (
                <button key={f} className="btn small" onClick={() => onFilter({ family: f })}>
                  {FAMILIES[f].plural} <strong>{formatNumber(summary.byFamily[f])}</strong>
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3>Par génération</h3>
            <div className="mt-chips">
              {gens.map(([g, n]) => (
                <button key={g} className="btn small" onClick={() => onFilter({ generation: g })} disabled={g === 0} title={g === 0 ? 'Montures spéciales' : `Afficher les G${g}`}>
                  {g === 0 ? 'Spéciales' : <GenBadge generation={g} />} {formatNumber(n)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3>Par statut</h3>
            <div className="mt-chips">
              {STATUSES.filter((s) => summary.byStatus[s] > 0).map((s) => (
                <button key={s} className="btn small" onClick={() => onFilter({ status: s })}>
                  <StatusBadge status={s} /> {formatNumber(summary.byStatus[s])}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <h3>Enclos</h3>
          <div className="mt-paddocks">
            {PADDOCK_UNLOCK_LEVELS.map((p, i) => {
              const n = i + 1
              const occ = summary.paddock.get(n) ?? 0
              const locked = n > unlocked
              return (
                <button
                  key={n}
                  className={`mt-paddock btn${locked ? ' locked' : ''}${occ >= PADDOCK_SLOTS ? ' full' : ''}`}
                  style={{ textAlign: 'left', display: 'grid' }}
                  onClick={() => onFilter({ location: `enclos-${n}` })}
                  title={`${p.name} ${p.coords} — afficher les montures de cet enclos`}
                >
                  <span className="mt-paddock-head">
                    <span>Enclos {n}</span>
                    <span>{locked ? `🔒 niv. ${p.level}` : `${occ}/${PADDOCK_SLOTS}`}</span>
                  </span>
                  <Progress value={occ} max={PADDOCK_SLOTS} />
                </button>
              )
            })}
          </div>
          <p className="muted mt-help">
            10 places par enclos ; une jauge consomme autant avec 1 ou 10 montures : remplissez les enclos. <a href={href('enclos')}>Gérer les enclos</a>
          </p>
        </div>
      </div>
      <div className="divider" />
      <h3>Sorts conseillés</h3>
      <div className="mt-chips">
        {FATE_ACTIONS.filter((a) => fateCounts.has(a)).map((a) => {
          const c = fateCounts.get(a) as { n: number; value: number; incomplete: number }
          const exit = a === 'vente' || a === 'extraction' || a === 'brisage' || a === 'monter'
          return (
            <button key={a} className="btn small" onClick={() => onFilter({ fate: a })} title={`Afficher les montures « ${FATE_ACTION_LABELS[a]} »`}>
              <Badge tone={FATE_TONES[a]}>{FATE_ACTION_LABELS[a]}</Badge> {formatNumber(c.n)}
              {exit && c.value > 0 && (
                <span className="muted">
                  {' '}
                  ≈ {c.incomplete ? '≥ ' : ''}
                  {formatKamas(c.value, true)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </Card>
  )
}

// ---------- Filtres ----------

function FiltersBar({ filters, onChange, sort, onSort }: { filters: Filters; onChange: (f: Filters) => void; sort: SortState; onSort: (s: SortState) => void }) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onChange({ ...filters, [k]: v })
  return (
    <div className="mt-toolbar">
      <label className="field mt-search">
        Rechercher
        <input type="search" value={filters.q} placeholder="nom, couleur, note…" onChange={(e) => set('q', e.target.value)} />
      </label>
      <label className="field">
        Famille
        <select value={filters.family} onChange={(e) => set('family', e.target.value as Filters['family'])}>
          <option value="toutes">Toutes</option>
          {FAMILY_IDS.map((f) => (
            <option key={f} value={f}>
              {FAMILIES[f].plural}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Génération
        <select value={filters.generation} onChange={(e) => set('generation', Number(e.target.value))}>
          <option value={0}>Toutes</option>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((g) => (
            <option key={g} value={g}>
              G{g}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Statut
        <select value={filters.status} onChange={(e) => set('status', e.target.value as Filters['status'])}>
          <option value="tous">Tous</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {FERTILITY_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Lieu
        <select value={filters.location} onChange={(e) => set('location', e.target.value as Filters['location'])}>
          <option value="tous">Tous</option>
          <option value="etable">Étable</option>
          <option value="inventaire">Inventaire</option>
          {PADDOCK_UNLOCK_LEVELS.map((_, i) => (
            <option key={i} value={`enclos-${i + 1}`}>
              Enclos {i + 1}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Sérénité
        <select value={filters.band} onChange={(e) => set('band', e.target.value as Filters['band'])}>
          <option value="toutes">Toutes</option>
          {SERENITY_BANDS.map((b) => (
            <option key={b} value={b}>
              {SERENITY_SMILEYS[b].face} {SERENITY_SMILEYS[b].color} — {SERENITY_SMILEYS[b].short}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Sort conseillé
        <select value={filters.fate} onChange={(e) => set('fate', e.target.value as Filters['fate'])}>
          <option value="tous">Tous</option>
          {FATE_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {FATE_ACTION_LABELS[a]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Trier par
        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <select value={sort.key} onChange={(e) => onSort({ ...sort, key: e.target.value as SortKey })}>
            <option value="generation">Génération</option>
            <option value="nom">Nom</option>
            <option value="niveau">Niveau</option>
            <option value="statut">Statut</option>
            <option value="serenite">Sérénité</option>
            <option value="jauges">Jauges</option>
            <option value="lieu">Lieu</option>
            <option value="sort">Sort conseillé</option>
            <option value="valeur">Valeur</option>
          </select>
          <button className="btn small" onClick={() => onSort({ ...sort, dir: sort.dir === 1 ? -1 : 1 })} aria-label={sort.dir === 1 ? 'Ordre croissant (inverser)' : 'Ordre décroissant (inverser)'}>
            {sort.dir === 1 ? '↑' : '↓'}
          </button>
        </span>
      </label>
    </div>
  )
}

function SortTh({ label, k, sort, onSort, num, className }: { label: string; k: SortKey; sort: SortState; onSort: (k: SortKey) => void; num?: boolean; className?: string }) {
  const active = sort.key === k
  return (
    <th className={[num ? 'num' : '', className ?? ''].filter(Boolean).join(' ') || undefined} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="mt-sort" onClick={() => onSort(k)}>
        {label}
        <span aria-hidden>{active ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  )
}

// ---------- Ligne du tableau ----------

function MountRow({
  m,
  fate,
  partner,
  selected,
  expanded,
  unlocked,
  onToggle,
  onExpand,
  onEdit,
  onMove,
  onDelete,
  onClonePair,
  onSelectPair,
}: {
  m: Mount
  fate: MountFate | undefined
  partner: Mount | undefined
  selected: boolean
  expanded: boolean
  unlocked: number
  onToggle: () => void
  onExpand: () => void
  onEdit: () => void
  onMove: () => void
  onDelete: () => void
  onClonePair: (partnerId: string) => void
  onSelectPair: (partnerId: string) => void
}) {
  const sp = getSpecies(m.speciesId)
  const eff = effectiveFertility(m)
  const lockedPaddock = m.location.kind === 'enclos' && m.location.paddock > unlocked
  return (
    <Fragment>
      <tr className={`mt-row${selected ? ' selected' : ''}`}>
        <td className="mt-col-check">
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Sélectionner ${mountName(m)}`} />
        </td>
        <td className="mt-c-name">
          <div className="mt-name">
            <span className="mt-name-main">
              {sp ? <GenBadge generation={sp.generation} /> : <Badge tone="danger">?</Badge>}
              <button className="btn ghost small" style={{ padding: 0, fontWeight: 600 }} onClick={onEdit} title="Modifier">
                {mountName(m)}
              </button>
            </span>
            {m.name && sp && <small className="muted">{sp.name}</small>}
            {m.parents.length === 2 && (
              <small className="muted">
                parents : {getSpecies(m.parents[0])?.name.replace(/^(Dragodinde|Muldo|Volkorne) /, '') ?? '?'} × {getSpecies(m.parents[1])?.name.replace(/^(Dragodinde|Muldo|Volkorne) /, '') ?? '?'}
              </small>
            )}
          </div>
        </td>
        <td className="mt-c-chip">
          <span className={`mt-gender ${m.gender}`} title={GENDER_LABELS[m.gender]}>
            {GENDER_ICONS[m.gender]}
          </span>
        </td>
        <td className="num mt-c-chip mt-c-level">{m.level}</td>
        <td className="mt-c-chip">
          <StatusBadge status={eff} />
        </td>
        <td className="mt-c-chip">
          <SerenitySmiley serenity={m.serenity} withValue />
        </td>
        <td className="mt-hide-sm">
          <GaugeBars mount={m} />
        </td>
        <td className="mt-c-chip mt-c-loc">
          {locationLabel(m.location)}
          {lockedPaddock && (
            <>
              {' '}
              <Badge tone="danger" title="Enclos non débloqué à votre niveau d'Éleveur">
                verrouillé
              </Badge>
            </>
          )}
          {eff === 'feconde' && m.location.kind === 'enclos' && <div className="mt-warn-text">à ramener à l'étable</div>}
        </td>
        <td className="mt-hide-sm">{m.ability ? <Badge tone="gold">{ABILITY_LABELS[m.ability]}</Badge> : <span className="muted">—</span>}</td>
        <td className="mt-c-fate">{fate ? <FateCell fate={fate} m={m} expanded={expanded} onExpand={onExpand} /> : <span className="muted">—</span>}</td>
        <td className="mt-c-actions">
          <div className="mt-actions">
            <button className="btn ghost small" onClick={onEdit} aria-label={`Modifier ${mountName(m)}`} title="Modifier">
              ✎
            </button>
            <button className="btn ghost small" onClick={onMove} aria-label={`Déplacer ${mountName(m)}`} title="Déplacer">
              ⇄
            </button>
            <button className="btn ghost small" onClick={onDelete} aria-label={`Supprimer ${mountName(m)}`} title="Supprimer">
              🗑
            </button>
          </div>
        </td>
      </tr>
      {expanded && fate && (
        <tr className="mt-detail">
          <td colSpan={11}>
            <FateDetail fate={fate} m={m} partner={partner} onClonePair={onClonePair} onSelectPair={onSelectPair} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function FateCell({ fate, m, expanded, onExpand }: { fate: MountFate; m: Mount; expanded: boolean; onExpand: () => void }) {
  const sp = getSpecies(m.speciesId)
  let valueLine: ReactNode
  if (fate.action === 'a-chiffrer')
    valueLine = (
      <>
        <Badge tone="danger">coût incomplet</Badge> <a href={href('prix', { onglet: 'montures', q: sp?.name ?? '' })}>Saisir un prix</a>
      </>
    )
  else if (fate.value !== null)
    valueLine = (
      <>
        <strong>
          {fate.complete ? '≈ ' : '≥ '}
          {formatKamas(fate.value, true)}
        </strong>{' '}
        <span className="muted">{fate.valueNote}</span>
        {!fate.complete && (
          <>
            {' '}
            <Badge tone="warn" title="Une option n'a pas de prix">
              coût incomplet
            </Badge>
          </>
        )}
      </>
    )
  else if (fate.floor !== null) valueLine = <span className="muted">sortie ≈ {formatKamas(fate.floor, true)} (plancher)</span>
  else valueLine = <span className="muted">{fate.valueNote}</span>
  return (
    <div className="mt-fate">
      <button className="mt-fate-btn" onClick={onExpand} aria-expanded={expanded} title={fate.reason}>
        <Badge tone={FATE_TONES[fate.action]}>{fate.label}</Badge>
        <ConfidenceBadge level={fate.confidence} />
        <span className="muted" aria-hidden>
          {expanded ? '▴' : '▾'}
        </span>
      </button>
      <small>{valueLine}</small>
    </div>
  )
}

function FateDetail({ fate, m, partner, onClonePair, onSelectPair }: { fate: MountFate; m: Mount; partner: Mount | undefined; onClonePair: (id: string) => void; onSelectPair: (id: string) => void }) {
  const grid = STRATEGY.mountFateGrid.find((g) => g.order === fate.rule)
  return (
    <div className="mt-detail-body">
      <p>
        <strong>Pourquoi : </strong>
        {fate.reason}
      </p>
      {fate.hint && <p className="mt-warn-text">{fate.hint}</p>}
      <div className="row" style={{ gap: 8 }}>
        <Badge tone={fate.usefulness.useful ? 'ok' : 'warn'}>{USEFULNESS_LABELS[fate.usefulness.kind]}</Badge>
        <span className="muted">{fate.usefulness.detail}</span>
      </div>
      {grid && (
        <small className="muted">
          Grille de sort, ligne {grid.order} : « {grid.if} » → {grid.label}.
        </small>
      )}
      {partner && (
        <div className="row" style={{ gap: 8 }}>
          <span>
            Partenaire : <strong>{mountName(partner)}</strong> ({GENDER_ICONS[partner.gender]}, niv. {partner.level}, {locationLabel(partner.location)})
          </span>
          {fate.action === 'cloner' && (
            <button className="btn small primary" onClick={() => onClonePair(partner.id)}>
              Enregistrer ce clonage…
            </button>
          )}
          {fate.action === 'accoupler' && (
            <a className="btn small primary" href={href('accouplement', { a: m.speciesId, b: partner.speciesId })}>
              Simuler l'accouplement
            </a>
          )}
          <button className="btn small" onClick={() => onSelectPair(partner.id)}>
            Sélectionner la paire
          </button>
        </div>
      )}
      {fate.action === 'monter' && fate.targetLevel && (
        <p className="muted">
          Placez-la dans un enclos avec la Mangeoire active (en 2e jauge pendant une fécondation, ou seule) jusqu'au niveau {fate.targetLevel}. <a href={href('enclos')}>Enclos</a>
        </p>
      )}
      {m.notes && (
        <p className="muted">
          <strong>Notes :</strong> {m.notes}
        </p>
      )}
    </div>
  )
}

// ---------- Accueil (inventaire vide) ----------

function Onboarding({ onCapture, onAdd }: { onCapture: () => void; onAdd: () => void }) {
  return (
    <Card>
      <div className="empty mt-onboarding">
        <h2 style={{ textAlign: 'center' }}>Aucune monture enregistrée</h2>
        <p>
          Enregistrez vos montures : l'application vous dira, pour chacune, s'il faut la <strong>garder</strong> pour votre plan, l'<strong>accoupler</strong>, la <strong>cloner</strong>, la{' '}
          <strong>monter en niveau</strong> ou la <strong>vendre, l'extraire ou la briser</strong> — avec la valeur estimée.
        </p>
        <ol className="steps">
          <li>
            <strong>Ajoutez vos captures</strong> en une fois après chaque session : couleur, nombre de mâles et de femelles (G1, niveau 1).
          </li>
          <li>
            <strong>Ajoutez les montures nées</strong> avec leurs deux parents : ils comptent dans le calcul des naissances et des génétons.
          </li>
          <li>
            <strong>Notez la sérénité</strong> (le smiley suffit : rouge :C, bleu :(, violet :), vert :D) et les jauges d'endurance, de maturité et d'amour.
          </li>
          <li>
            <strong>Choisissez votre monture visée</strong> dans les <a href={href('reglages')}>Réglages</a> : le sort conseillé garde ce qui sert à votre plan.
          </li>
        </ol>
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn" onClick={onCapture}>
            🪤 Ajouter des captures
          </button>
          <button className="btn primary" onClick={onAdd}>
            ＋ Ajouter une monture
          </button>
        </div>
      </div>
    </Card>
  )
}

// ---------- Fenêtres : captures ----------

function CaptureDialog({
  mounts,
  jobLevel,
  stableSlots,
  defaultFamily,
  onClose,
  onSave,
}: {
  mounts: Mount[]
  jobLevel: number
  stableSlots: number
  defaultFamily: FamilyId
  onClose: () => void
  onSave: (lines: CaptureLine[], location: NonNullable<ReturnType<typeof parseLocationKey>>, serenity: number) => void
}) {
  const first = CAPTURABLE.find((s) => s.family === defaultFamily) ?? CAPTURABLE[0]
  const [lines, setLines] = useState<CaptureLine[]>([{ speciesId: first?.id ?? null, males: 1, females: 1 }])
  const [dest, setDest] = useState<LocationKey>('etable')
  const [serenity, setSerenity] = useState(0)
  const occupancy = useMemo(() => paddockOccupancy(mounts), [mounts])
  const unlocked = unlockedPaddocks(jobLevel)
  const total = lines.reduce((s, l) => s + Math.max(0, Math.floor(l.males)) + Math.max(0, Math.floor(l.females)), 0)
  const loc = parseLocationKey(dest)
  const errors = [...captureBlockers(lines)]
  if (loc?.kind === 'enclos') {
    const free = PADDOCK_SLOTS - (occupancy.get(loc.paddock) ?? 0)
    if (loc.paddock > unlocked) errors.push(`L'enclos ${loc.paddock} n'est pas débloqué.`)
    else if (total > free) errors.push(`L'enclos ${loc.paddock} n'a que ${free} place${free > 1 ? 's' : ''} libre${free > 1 ? 's' : ''} pour ${total} montures : choisissez l'étable.`)
  } else if (loc?.kind === 'etable') {
    const inStable = mounts.filter((m) => m.location.kind === 'etable').length
    if (inStable + total > stableSlots) errors.push(`L'étable est limitée à ${stableSlots} montures (${inStable} déjà présentes).`)
  }
  const families = [...new Set(lines.map((l) => (l.speciesId !== null ? getSpecies(l.speciesId)?.family : undefined)).filter((f): f is FamilyId => !!f))]
  const setLine = (i: number, patch: Partial<CaptureLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  return (
    <Modal
      title="Ajouter des captures"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted">
            {plural(total, 'monture')} · +{formatNumber(total * JOB_XP_PER_CAPTURE)} XP d'Éleveur
          </span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={errors.length > 0 || !loc} onClick={() => loc && onSave(lines, loc, serenity)}>
            Ajouter {plural(total, 'monture')}
          </button>
        </>
      }
    >
      <p className="muted mt-help">
        Une monture capturée est une G1 de niveau 1, jauges à 0. Indiquez pour chaque couleur le nombre de mâles et de femelles ; chaque ligne est notée au journal (statistiques de capture).
      </p>
      {lines.map((l, i) => (
        <div className="mt-capture-line" key={i}>
          <label className="field">
            Couleur
            <select value={l.speciesId ?? ''} onChange={(e) => setLine(i, { speciesId: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">— Choisir —</option>
              {FAMILY_IDS.map((f) => (
                <optgroup key={f} label={FAMILIES[f].plural}>
                  {CAPTURABLE.filter((s) => s.family === f).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <NumberField label="♂ Mâles" value={l.males} min={0} max={500} onChange={(v) => setLine(i, { males: Math.floor(v) })} width={80} />
          <NumberField label="♀ Femelles" value={l.females} min={0} max={500} onChange={(v) => setLine(i, { females: Math.floor(v) })} width={80} />
          <span className="muted" style={{ paddingBottom: 8 }}>
            = {formatNumber(Math.max(0, l.males) + Math.max(0, l.females))}
          </span>
          <button className="btn ghost small" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Retirer la ligne ${i + 1}`}>
            ✕
          </button>
        </div>
      ))}
      <div className="row" style={{ margin: '10px 0' }}>
        <button className="btn small" onClick={() => setLines((ls) => [...ls, { speciesId: null, males: 0, females: 0 }])}>
          ＋ Ajouter une couleur
        </button>
      </div>
      <div className="mt-editor-grid">
        <label className="field">
          Où les placer
          <select value={dest} onChange={(e) => setDest(e.target.value as LocationKey)}>
            <option value="etable">Étable</option>
            <option value="inventaire">Inventaire / banque</option>
            {PADDOCK_UNLOCK_LEVELS.map((p, i) => {
              const n = i + 1
              const locked = n > unlocked
              return (
                <option key={n} value={`enclos-${n}`} disabled={locked}>
                  Enclos {n} — {locked ? `verrouillé (niv. ${p.level})` : `${occupancy.get(n) ?? 0}/${PADDOCK_SLOTS}`}
                </option>
              )
            })}
          </select>
        </label>
        <NumberField label="Sérénité de départ (si connue)" value={serenity} min={SERENITY_MIN} max={SERENITY_MAX} step={100} onChange={(v) => setSerenity(Math.round(v))} />
      </div>
      <Callout>
        <strong>Sérénité inconnue → 0.</strong> La sérénité d'une capture est aléatoire (distribution inconnue). Laissez 0 si vous ne la connaissez pas, puis corrigez chaque monture d'après son
        smiley en jeu : c'est elle qui décide des lots de fécondation.
      </Callout>
      {families.map((f) => {
        const z = FAMILIES[f].captureZone
        return z ? (
          <p key={f} className="muted mt-help">
            Où capturer les {FAMILIES[f].plural} : <strong>{z.subarea}</strong> ({z.area}), zaap le plus proche : {z.nearestZaap.name} [{z.nearestZaap.coords.join(',')}].
          </p>
        ) : null
      })}
      {errors.length > 0 && total > 0 && (
        <Callout tone="warn">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </Callout>
      )}
    </Modal>
  )
}

// ---------- Fenêtres : déplacer ----------

function MoveDialog({
  list,
  mounts,
  jobLevel,
  stableSlots,
  onClose,
  onConfirm,
}: {
  list: Mount[]
  mounts: Mount[]
  jobLevel: number
  stableSlots: number
  onClose: () => void
  onConfirm: (loc: NonNullable<ReturnType<typeof parseLocationKey>>) => void
}) {
  const [dest, setDest] = useState<LocationKey>('etable')
  const loc = parseLocationKey(dest)
  const ids = list.map((m) => m.id)
  const blockers = loc ? moveBlockers(mounts, ids, loc, { jobLevel, stableSlots }) : ['Emplacement inconnu.']
  const occupancy = useMemo(() => paddockOccupancy(mounts), [mounts])
  const unlocked = unlockedPaddocks(jobLevel)
  const fecund = list.filter((m) => effectiveFertility(m) === 'feconde').length
  return (
    <Modal
      title={`Déplacer ${plural(list.length, 'monture')}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={blockers.length > 0 || !loc} onClick={() => loc && onConfirm(loc)}>
            Déplacer
          </button>
        </>
      }
    >
      <label className="field">
        Destination
        <select value={dest} onChange={(e) => setDest(e.target.value as LocationKey)}>
          <option value="etable">Étable</option>
          <option value="inventaire">Inventaire / banque</option>
          {PADDOCK_UNLOCK_LEVELS.map((p, i) => {
            const n = i + 1
            const locked = n > unlocked
            return (
              <option key={n} value={`enclos-${n}`} disabled={locked}>
                Enclos {n} — {locked ? `verrouillé (Éleveur niv. ${p.level})` : `${occupancy.get(n) ?? 0}/${PADDOCK_SLOTS} occupées`}
              </option>
            )
          })}
        </select>
      </label>
      {blockers.length > 0 && (
        <Callout tone="danger">
          {blockers.map((b) => (
            <div key={b}>{b}</div>
          ))}
        </Callout>
      )}
      {loc?.kind === 'enclos' && fecund > 0 && (
        <Callout tone="warn">{plural(fecund, 'monture est déjà féconde', 'montures sont déjà fécondes')} : l'accouplement se fait depuis l'étable, inutile de l'occuper en enclos.</Callout>
      )}
      <p className="muted mt-help">
        En jeu, poser ou retirer une monture d'un enclos demande d'être sur une carte d'enclos ; l'accouplement et le clonage se font avec les deux montures dans l'étable.
      </p>
    </Modal>
  )
}

// ---------- Fenêtres : cloner ----------

function CloneDialog({ list, rules, onClose, onConfirm }: { list: Mount[]; rules: Ruleset; onClose: () => void; onConfirm: (kept: Mount, other: Mount) => void }) {
  const [keptId, setKeptId] = useState<string | null>(null)
  if (list.length !== 2)
    return (
      <Modal title="Cloner" onClose={onClose} footer={<button className="btn" onClick={onClose}>Fermer</button>}>
        <Callout tone="warn">Sélectionnez exactement deux montures de même famille et de même génération.</Callout>
      </Modal>
    )
  const [a, b] = list
  const blockers = cloningBlockers(a, b)
  const same = a.speciesId === b.speciesId
  const warnings: string[] = []
  for (const m of [a, b]) {
    const eff = effectiveFertility(m)
    if (eff === 'feconde') warnings.push(`${mountName(m)} est féconde : le clonage remet ses jauges à 0 (accouplez-la plutôt d'abord).`)
    else if (eff === 'fertile' && m.endurance + m.maturity + m.love > 0) warnings.push(`${mountName(m)} est fertile avec des jauges entamées : elles seront perdues.`)
    if (m.ability) warnings.push(`${mountName(m)} perdra sa capacité (${ABILITY_LABELS[m.ability]}) si elle est conservée.`)
  }
  const kept = keptId === a.id ? a : keptId === b.id ? b : null
  const other = kept ? (kept.id === a.id ? b : a) : null
  return (
    <Modal
      title="Enregistrer un clonage"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={blockers.length > 0 || !kept} onClick={() => kept && other && onConfirm(kept, other)}>
            Enregistrer le clonage
          </button>
        </>
      }
    >
      {blockers.length > 0 ? (
        <Callout tone="danger">
          <strong>Clonage impossible :</strong>
          {blockers.map((x) => (
            <div key={x}>{x}</div>
          ))}
        </Callout>
      ) : (
        <>
          <p>
            {same ? (
              <>
                <Badge tone="ok">Même couleur</Badge> Résultat certain : une {getSpecies(a.speciesId)?.name} fertile.
              </>
            ) : (
              <>
                <Badge tone="info">Couleurs différentes</Badge> Le jeu conserve l'une des deux au hasard (50/50). Indiquez laquelle a été gardée.
              </>
            )}
          </p>
          <div className="mt-clone-choice" role="radiogroup" aria-label="Monture conservée">
            {[a, b].map((m) => (
              <label key={m.id} className={`mt-clone-option${keptId === m.id ? ' on' : ''}`}>
                <input type="radio" name="clone-kept" checked={keptId === m.id} onChange={() => setKeptId(m.id)} />
                <span className="stack" style={{ gap: 2 }}>
                  <strong>{mountName(m)}</strong>
                  <span className="muted">
                    <SpeciesName id={m.speciesId} /> · {GENDER_ICONS[m.gender]} · niv. {m.level} · {FERTILITY_LABELS[effectiveFertility(m)]}
                  </span>
                  <small className="muted">{keptId === m.id ? 'Conservée' : keptId ? 'Disparaît' : 'Conservée ?'}</small>
                </span>
              </label>
            ))}
          </div>
          {warnings.length > 0 && (
            <Callout tone="warn">
              {warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </Callout>
          )}
          <Callout>
            <strong>Résultat enregistré :</strong> la monture conservée devient <strong>fertile</strong>, endurance, maturité et amour à 0, <strong>sans capacité</strong> ; sérénité{' '}
            {rules.cloneKeepsSerenity ? 'conservée (règles 3.7)' : 'remise à 0 (« réinitialisée » en 3.5/3.6 : valeur exacte non confirmée, corrigez-la d’après le smiley)'} ; couleur, sexe, nom,
            généalogie et niveau gardés (niveau : non confirmé). L'autre monture est retirée. Le clonage est noté au journal.
          </Callout>
        </>
      )}
    </Modal>
  )
}

// ---------- Fenêtres : extraire ----------

function ExtractDialog({ list, fates, onClose, onConfirm }: { list: Mount[]; fates: Map<string, MountFate>; onClose: () => void; onConfirm: (done: Mount[]) => void }) {
  const ctx = usePriceContext()
  const items = list.map((m) => ({ m, qty: extractionQuantity(m), res: extractionResource(m) }))
  const ok = items.filter((i) => i.qty > 0 && i.res)
  const skipped = items.filter((i) => i.qty === 0)
  const totals = new Map<number, { name: string; qty: number }>()
  for (const i of ok) {
    const res = i.res as { itemId: number; name: string }
    const t = totals.get(res.itemId) ?? { name: res.name, qty: 0 }
    t.qty += i.qty
    totals.set(res.itemId, t)
  }
  const otherAdvice = ok.filter((i) => fates.get(i.m.id)?.action !== 'extraction')
  return (
    <Modal
      title={`Extraire ${plural(ok.length, 'monture')}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={ok.length === 0} onClick={() => onConfirm(ok.map((i) => i.m))}>
            Extraire et noter au journal
          </button>
        </>
      }
    >
      <p className="muted mt-help">L'extraction détruit la monture et donne 1 ressource par génération (G1 : rien ; sénile : 1). Même résultat qu'elle soit fertile ou stérile.</p>
      <ul className="mt-dialog-list">
        {items.map((i) => (
          <li key={i.m.id}>
            <span>
              <SpeciesName id={i.m.speciesId} /> {i.m.name ? <small className="muted">({i.m.name})</small> : null}
            </span>
            {i.qty > 0 ? (
              <strong>
                {i.qty} × {i.res?.name}
              </strong>
            ) : (
              <Badge tone="warn">rien à extraire</Badge>
            )}
          </li>
        ))}
      </ul>
      {totals.size > 0 && (
        <Callout tone="ok">
          {[...totals.entries()].map(([id, t]) => {
            const p = marketPrice(id, ctx).price
            return (
              <div key={id}>
                <strong>
                  {formatNumber(t.qty)} × {t.name}
                </strong>{' '}
                {p !== null ? (
                  <span className="muted">≈ {formatKamas(t.qty * p)} brut (prix {formatKamas(p)})</span>
                ) : (
                  <>
                    <Badge tone="danger">prix inconnu</Badge> <a href={href('prix', { q: t.name })}>saisir le prix</a>
                  </>
                )}
              </div>
            )
          })}
        </Callout>
      )}
      {skipped.length > 0 && <Callout tone="warn">{plural(skipped.length, 'monture ne donne', 'montures ne donnent')} rien à l'extraction (G1 ou spéciale) : elle{skipped.length > 1 ? 's restent' : ' reste'} dans l'inventaire.</Callout>}
      {otherAdvice.length > 0 && (
        <Callout tone="warn">
          Sort conseillé différent pour {plural(otherAdvice.length, 'monture')} : {otherAdvice.slice(0, 4).map((i) => `${mountName(i.m)} (${fates.get(i.m.id)?.label.toLowerCase()})`).join(', ')}
          {otherAdvice.length > 4 ? '…' : ''}.
        </Callout>
      )}
    </Modal>
  )
}

// ---------- Fenêtres : vendre ----------

function SellDialog({
  list,
  fates,
  valuation,
  onClose,
  onConfirm,
}: {
  list: Mount[]
  fates: Map<string, MountFate>
  valuation: ValuationFn
  onClose: () => void
  onConfirm: (amount: number, label: string) => void
}) {
  const vals = list.map((m) => {
    const st = fateState(m)
    return { m, v: valuation(m.speciesId, m.level, st) as FateValuation }
  })
  const known = vals.filter((x) => x.v.sale.net !== null)
  const suggestion = known.reduce((s, x) => s + (x.v.sale.net ?? 0), 0)
  const [text, setText] = useState(known.length === vals.length && suggestion > 0 ? String(Math.round(suggestion)) : '')
  const amount = parseKamas(text)
  const invalid = amount === null || amount < 0
  const otherAdvice = list.filter((m) => fates.get(m.id)?.action !== 'vente')
  const counts = new Map<number, number>()
  for (const m of list) counts.set(m.speciesId, (counts.get(m.speciesId) ?? 0) + 1)
  const label = `Vente de ${plural(list.length, 'monture')} : ${[...counts.entries()].map(([id, n]) => `${getSpecies(id)?.name ?? `#${id}`}${n > 1 ? ` ×${n}` : ''}`).join(', ')}`
  return (
    <Modal
      title={`Vendre ${plural(list.length, 'monture')}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={invalid} onClick={() => amount !== null && onConfirm(amount, label)}>
            Enregistrer la vente
          </button>
        </>
      }
    >
      <ul className="mt-dialog-list">
        {vals.map(({ m, v }) => (
          <li key={m.id}>
            <span>
              <SpeciesName id={m.speciesId} /> <small className="muted">niv. {m.level}</small>
            </span>
            {v.sale.net !== null ? <span className="muted">≈ {formatKamas(v.sale.net)} net</span> : <Badge tone="danger">sans prix</Badge>}
          </li>
        ))}
      </ul>
      <label className="field">
        Montant encaissé (net de taxe d'HDV)
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="ex. 120 000, 120k, 1,2 M" inputMode="decimal" />
      </label>
      {text !== '' && invalid && <span className="mt-error">Montant illisible : écrivez par exemple 120 000, 120k ou 1,2 M.</span>}
      {amount !== null && !invalid && <p className="muted mt-help">Enregistré : {formatKamas(amount)}.</p>}
      {known.length < vals.length && (
        <Callout tone="warn">
          Prix de vente inconnu pour {plural(vals.length - known.length, 'monture')} : saisissez le montant réellement encaissé.{' '}
          <a href={href('prix', { onglet: 'montures' })}>Saisir les prix des montures</a>
        </Callout>
      )}
      {otherAdvice.length > 0 && (
        <Callout tone="warn">
          Sort conseillé différent pour {plural(otherAdvice.length, 'monture')} : {otherAdvice.slice(0, 4).map((m) => `${mountName(m)} (${fates.get(m.id)?.label.toLowerCase()})`).join(', ')}
          {otherAdvice.length > 4 ? '…' : ''}.
        </Callout>
      )}
      <p className="muted mt-help">La vente est notée au journal (revenus réels) et les montures sont retirées de l'inventaire.</p>
    </Modal>
  )
}

// ---------- Fenêtres : supprimer ----------

function DeleteDialog({ list, onClose, onConfirm }: { list: Mount[]; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal
      title={`Supprimer ${plural(list.length, 'monture')}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn danger" onClick={onConfirm}>
            Supprimer définitivement
          </button>
        </>
      }
    >
      <ul className="mt-dialog-list">
        {list.map((m) => (
          <li key={m.id}>
            <span>
              <SpeciesName id={m.speciesId} /> {m.name ? <small className="muted">({m.name})</small> : null}
            </span>
            <span className="muted">
              {GENDER_ICONS[m.gender]} niv. {m.level} · {locationLabel(m.location)}
            </span>
          </li>
        ))}
      </ul>
      <Callout tone="warn">
        La suppression n'est pas notée au journal. Pour une vente, une extraction ou un clonage, utilisez plutôt l'action correspondante afin de garder vos statistiques.
      </Callout>
    </Modal>
  )
}
