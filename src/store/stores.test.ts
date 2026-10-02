// @vitest-environment jsdom
// Persistance des stores : versions (jamais de perte), normalisation des données mal formées,
// synchronisation entre onglets (événement « storage »), échecs d'écriture (quota plein).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PERSISTED_STORES } from './schema'

const INV = 'elevagesimu:inventory'
const SET = 'elevagesimu:settings'

const mountOf = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  speciesId: 94,
  gender: 'male',
  level: 1,
  ability: null,
  fertility: 'fertile',
  parents: [],
  location: { kind: 'etable' },
  serenity: 0,
  endurance: 0,
  maturity: 0,
  love: 0,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})

const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null') as { state: Record<string, unknown>; version: number } | null
/** Nombre de montures enregistrées (−1 si rien n'est enregistré). */
const storedMountCount = () => {
  const mounts = stored(INV)?.state.mounts
  return Array.isArray(mounts) ? mounts.length : -1
}

/** Modules frais (les stores se réhydratent à l'import) après avoir préparé le localStorage. */
async function load() {
  vi.resetModules()
  const inventory = await import('./inventory')
  const settings = await import('./settings')
  const journal = await import('./journal')
  const prices = await import('./prices')
  const persistence = await import('./persistence')
  return { ...inventory, ...settings, ...journal, ...prices, ...persistence }
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('versions persistées (R3)', () => {
  it('chaque store déclare la version de PERSISTED_STORES (source unique, utilisée par les sauvegardes)', async () => {
    const m = await load()
    const { usePaddocks } = await import('./paddocks')
    const { usePaddockPlans } = await import('./paddockPlans')
    const { usePlanProgress } = await import('./planProgress')
    const options = [m.useInventory, m.useSettings, m.useJournal, m.usePrices, usePaddocks, usePaddockPlans, usePlanProgress].map((s) => s.persist.getOptions())
    for (const { name, version } of options) {
      expect(PERSISTED_STORES[name ?? '']?.version, name).toBe(version ?? 0)
    }
  })

  it('une donnée enregistrée par une version plus récente est gardée telle quelle, jamais écrasée', async () => {
    const mounts = Array.from({ length: 50 }, (_, i) => mountOf(`m${i}`))
    const raw = JSON.stringify({ state: { mounts, futur: true }, version: 2 })
    localStorage.setItem(INV, raw)
    const m = await load()
    // Affichée au mieux…
    expect(m.useInventory.getState().mounts).toHaveLength(50)
    // … mais jamais réécrite : ni à la réhydratation, ni après une modification locale.
    m.useInventory.getState().add(mountOf('nouvelle') as never)
    m.useInventory.getState().removeMany(['m1', 'm2'])
    expect(localStorage.getItem(INV)).toBe(raw)
    const issue = m.useStorageHealth.getState().issues.find((i) => i.key === INV)
    expect(issue?.kind).toBe('version')
    expect(issue?.message).toMatch(/version plus récente/)
    // Le joueur peut choisir d'écraser explicitement (après export).
    m.overwriteBlocked(INV)
    expect(stored(INV)?.version).toBe(1)
    expect(storedMountCount()).toBe(49)
  })

  it('une donnée d’une version plus ancienne est migrée, pas jetée', async () => {
    localStorage.setItem(INV, JSON.stringify({ state: { mounts: [mountOf('a'), mountOf('b')] }, version: 0 }))
    const m = await load()
    expect(m.useInventory.getState().mounts.map((x) => x.id)).toEqual(['a', 'b'])
    expect(stored(INV)?.version).toBe(1)
    expect(storedMountCount()).toBe(2)
  })

  it('réglages v2 → v3 : jobLevelUpdatedAt ajouté et enregistré tout de suite (date stable)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
    localStorage.setItem(SET, JSON.stringify({ state: { jobLevel: 87, family: 'dragodinde' }, version: 2 }))
    const m = await load()
    expect(m.useSettings.getState()).toMatchObject({ jobLevel: 87, family: 'dragodinde', jobLevelUpdatedAt: 1_800_000_000_000, ruleset: '3.6' })
    expect(stored(SET)).toMatchObject({ version: 3, state: { jobLevel: 87, jobLevelUpdatedAt: 1_800_000_000_000 } })
  })

  it('réglages v3 sans « almanaxGaugeDoubling » (ajouté ensuite) : désactivé par défaut, le reste est gardé', async () => {
    localStorage.setItem(SET, JSON.stringify({ state: { jobLevel: 120, jobLevelUpdatedAt: 5, family: 'volkorne' }, version: 3 }))
    const m = await load()
    expect(m.useSettings.getState()).toMatchObject({ jobLevel: 120, family: 'volkorne', almanaxGaugeDoubling: false })
    m.useSettings.getState().update({ almanaxGaugeDoubling: true })
    expect(stored(SET)?.state.almanaxGaugeDoubling).toBe(true)
  })

  it('un stockage illisible est conservé (écriture bloquée) au lieu d’être remplacé par une étable vide', async () => {
    localStorage.setItem(INV, '{"state": {"mounts": [ coupé')
    const m = await load()
    expect(m.useInventory.getState().mounts).toEqual([])
    m.useInventory.getState().add(mountOf('x') as never)
    expect(localStorage.getItem(INV)).toBe('{"state": {"mounts": [ coupé')
    expect(m.useStorageHealth.getState().issues.map((i) => i.kind)).toContain('illisible')
  })
})

describe('normalisation à la lecture (R4)', () => {
  it('une monture mal formée ne casse plus rien : champs neutres, inutilisables écartées, message', async () => {
    localStorage.setItem(
      INV,
      JSON.stringify({ state: { mounts: [mountOf('ok'), { id: 'sans-espece' }, mountOf('sans-lieu', { location: undefined, parents: 'x' })] }, version: 1 }),
    )
    const m = await load()
    const mounts = m.useInventory.getState().mounts
    expect(mounts.map((x) => x.id)).toEqual(['ok', 'sans-lieu'])
    expect(mounts[1]).toMatchObject({ location: { kind: 'etable' }, parents: [] })
    expect(m.useStorageHealth.getState().issues.find((i) => i.kind === 'corrige')?.message).toMatch(/1 monture inutilisable ignorée/)
  })

  it('« mounts: {} » (objet au lieu d’une liste) donne une liste', async () => {
    localStorage.setItem(INV, JSON.stringify({ state: { mounts: {} }, version: 1 }))
    const m = await load()
    expect(Array.isArray(m.useInventory.getState().mounts)).toBe(true)
  })

  it('réglages invalides (famille « dinde », règles 9.9, palier 7) : valeurs par défaut', async () => {
    localStorage.setItem(SET, JSON.stringify({ state: { family: 'dinde', ruleset: '9.9', preferredTier: 7, jobLevel: 87, jobLevelUpdatedAt: 5 }, version: 3 }))
    const m = await load()
    expect(m.useSettings.getState()).toMatchObject({ family: 'muldo', ruleset: '3.6', preferredTier: 2, jobLevel: 87, jobLevelUpdatedAt: 5 })
  })

  it('avancement du plan mal formé : entrées invalides écartées, plus « version plus récente » écrasée (R3/R4)', async () => {
    localStorage.setItem('elevagesimu:planProgress', JSON.stringify({ state: { checked: { a: 5, b: 'x', c: -1 }, done: [] }, version: 1 }))
    const m = await load()
    const { usePlanProgress } = await import('./planProgress')
    expect(usePlanProgress.getState().checked).toEqual({ a: 5 })
    expect(usePlanProgress.getState().done).toEqual({})
    expect(m.useStorageHealth.getState().issues.some((i) => i.kind === 'corrige' && i.key === 'elevagesimu:planProgress')).toBe(true)
    // Version plus récente : gardée telle quelle, écriture bloquée.
    localStorage.setItem('elevagesimu:planProgress', JSON.stringify({ state: { checked: { z: 1 }, done: {} }, version: 9 }))
    await load()
    const again = await import('./planProgress')
    again.usePlanProgress.getState().toggle('nouvelle')
    expect(JSON.parse(localStorage.getItem('elevagesimu:planProgress')!).version).toBe(9)
  })

  it('prix invalides retirés (jamais comptés comme 0)', async () => {
    localStorage.setItem('elevagesimu:prices', JSON.stringify({ state: { items: { '1': 10, '2': 'x', '3': -1 }, mounts: {}, generations: {}, genetonValue: null, updatedAt: 0 }, version: 1 }))
    const m = await load()
    expect(m.usePrices.getState().items).toEqual({ '1': 10 })
  })
})

describe('synchronisation entre onglets (R5)', () => {
  it('relit le store quand un autre onglet écrit, sans perdre ses changements à la modification suivante', async () => {
    localStorage.setItem(INV, JSON.stringify({ state: { mounts: Array.from({ length: 20 }, (_, i) => mountOf(`m${i}`)) }, version: 1 }))
    const m = await load()
    expect(m.useInventory.getState().mounts).toHaveLength(20)
    // L'autre onglet supprime 5 montures.
    const remote = JSON.stringify({ state: { mounts: Array.from({ length: 15 }, (_, i) => mountOf(`m${i}`)) }, version: 1 })
    localStorage.setItem(INV, remote)
    window.dispatchEvent(new StorageEvent('storage', { key: INV, newValue: remote, storageArea: localStorage }))
    expect(m.useInventory.getState().mounts).toHaveLength(15)
    expect(localStorage.getItem(INV)).toBe(remote)
    // Ce onglet modifie ensuite une monture : la suppression de l'autre onglet n'est pas annulée.
    m.useInventory.getState().update('m3', { name: 'Renommée' })
    expect(storedMountCount()).toBe(15)
  })

  it('revient à l’état initial quand un autre onglet efface la donnée (remise à zéro)', async () => {
    localStorage.setItem(SET, JSON.stringify({ state: { jobLevel: 120 }, version: 3 }))
    const m = await load()
    expect(m.useSettings.getState().jobLevel).toBe(120)
    localStorage.removeItem(SET)
    window.dispatchEvent(new StorageEvent('storage', { key: SET, newValue: null, storageArea: localStorage }))
    expect(m.useSettings.getState().jobLevel).toBe(1)
    // L'état initial n'est pas réécrit en réaction à l'événement.
    expect(localStorage.getItem(SET)).toBeNull()
  })

  it('synchronise aussi les enclos, plans d’enclos et l’avancement du plan (src/store/sync.ts)', async () => {
    await load()
    const { usePaddocks } = await import('./paddocks')
    const { usePlanProgress } = await import('./planProgress')
    const paddocks = usePaddocks.getState().paddocks.map((p) => (p.id === 1 ? { ...p, active: ['foudroyeur'] } : p))
    const remote = JSON.stringify({ state: { paddocks }, version: 1 })
    localStorage.setItem('elevagesimu:paddocks', remote)
    window.dispatchEvent(new StorageEvent('storage', { key: 'elevagesimu:paddocks', newValue: remote, storageArea: localStorage }))
    expect(usePaddocks.getState().paddocks[0].active).toEqual(['foudroyeur'])
    const progress = JSON.stringify({ state: { checked: { 'phase:P1:actions:0': 5 }, done: {} }, version: 1 })
    localStorage.setItem('elevagesimu:planProgress', progress)
    window.dispatchEvent(new StorageEvent('storage', { key: 'elevagesimu:planProgress', newValue: progress, storageArea: localStorage }))
    expect(usePlanProgress.getState().checked).toEqual({ 'phase:P1:actions:0': 5 })
  })

  it('ignore les clés étrangères et le sessionStorage', async () => {
    const m = await load()
    m.useInventory.getState().add(mountOf('a') as never)
    window.dispatchEvent(new StorageEvent('storage', { key: 'autre:cle', newValue: '1', storageArea: localStorage }))
    window.dispatchEvent(new StorageEvent('storage', { key: INV, newValue: null, storageArea: sessionStorage }))
    expect(m.useInventory.getState().mounts).toHaveLength(1)
  })
})

describe('échec d’écriture : quota plein (R10)', () => {
  it('une action groupée s’applique entièrement, sans exception, et l’échec est signalé puis rattrapé', async () => {
    localStorage.setItem(INV, JSON.stringify({ state: { mounts: ['a', 'b', 'c', 'd', 'e'].map((id) => mountOf(id)) }, version: 1 }))
    const m = await load()
    const realSetItem = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === INV) {
        const e = new Error('The quota has been exceeded.')
        e.name = 'QuotaExceededError'
        throw e
      }
      realSetItem.call(this, k, v)
    })
    expect(() => m.useInventory.getState().removeMany(['a', 'b', 'c'])).not.toThrow()
    expect(m.useInventory.getState().mounts.map((x) => x.id)).toEqual(['d', 'e'])
    const issue = m.useStorageHealth.getState().issues.find((i) => i.kind === 'ecriture')
    expect(issue).toMatchObject({ key: INV, quota: true })
    expect(issue?.message).toMatch(/espace de stockage du navigateur est plein/)
    // La sauvegarde exportée contiendrait l'état non enregistré.
    expect(JSON.parse(m.pendingWrites()[INV]).state.mounts).toHaveLength(2)
    // De la place se libère : le prochain enregistrement réussi rattrape l'écriture en attente.
    spy.mockRestore()
    m.useSettings.getState().update({ server: 'Salar' })
    expect(storedMountCount()).toBe(2)
    expect(m.useStorageHealth.getState().issues.some((i) => i.kind === 'ecriture')).toBe(false)
  })

  it('updateMany et patchMany modifient plusieurs montures en une seule écriture', async () => {
    localStorage.setItem(INV, JSON.stringify({ state: { mounts: ['a', 'b', 'c'].map((id) => mountOf(id)) }, version: 1 }))
    const m = await load()
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    m.useInventory.getState().updateMany(['a', 'c'], { fertility: 'sterile' })
    m.useInventory.getState().patchMany({ b: { level: 40 }, zzz: { level: 3 } })
    expect(spy.mock.calls.filter(([k]) => k === INV)).toHaveLength(2)
    expect(m.useInventory.getState().mounts.map((x) => [x.id, x.fertility, x.level])).toEqual([
      ['a', 'sterile', 1],
      ['b', 'fertile', 40],
      ['c', 'sterile', 1],
    ])
  })
})

describe('niveau d’Éleveur et journal (F14)', () => {
  it('changer le niveau le date ; le même niveau ne change pas la date ; reset la date de maintenant', async () => {
    const m = await load()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    m.useSettings.getState().update({ jobLevel: 40 })
    expect(m.useSettings.getState().jobLevelUpdatedAt).toBe(1_000)
    now.mockReturnValue(2_000)
    m.useSettings.getState().update({ jobLevel: 40, server: 'x' })
    expect(m.useSettings.getState().jobLevelUpdatedAt).toBe(1_000)
    m.useSettings.getState().update({ jobLevel: 41, jobLevelUpdatedAt: 1_500 })
    expect(m.useSettings.getState().jobLevelUpdatedAt).toBe(1_500)
    now.mockReturnValue(3_000)
    m.useSettings.getState().reset()
    expect(m.useSettings.getState()).toMatchObject({ jobLevel: 1, jobLevelUpdatedAt: 3_000 })
  })

  it('journalJobXp additionne l’XP enregistrée après la saisie du niveau', async () => {
    const m = await load()
    const j = m.useJournal.getState()
    j.log({ kind: 'capture', speciesId: 94, count: 4 }, 100)
    j.log({ kind: 'capture', speciesId: 94, count: 2 }, 300)
    j.log({ kind: 'craft', itemId: 1, count: 3, jobXp: 450 }, 400)
    j.log({ kind: 'accouplement', parentA: 94, parentB: 92, babies: [102], targetGeneration: 2, targetChance: 0.3, makina: null, genetons: 0, jobXp: 120 }, 500)
    j.log({ kind: 'vente', label: 'x', amount: 10 }, 600)
    const r = m.journalJobXp(m.useJournal.getState().entries, 200)
    expect(r).toEqual({ xp: 2 * 30 + 450 + 120, entries: 3, captures: 2, matings: 1, crafts: 3 })
    expect(m.journalJobXp(m.useJournal.getState().entries, 0).xp).toBe(6 * 30 + 450 + 120)
    expect(j.removeBefore(350)).toBe(2)
    expect(m.useJournal.getState().entries).toHaveLength(3)
  })
})
