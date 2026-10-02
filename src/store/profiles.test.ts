// @vitest-environment jsdom
// Profils et serveurs dans l'application : clés du profil ouvert, isolation stricte de deux profils sur
// deux serveurs (montures, réglages, prix, marché), changement de profil (registre puis rechargement),
// duplication, suppression, migration au premier chargement de la v2, marché importé par serveur.
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot, parseHdvCsv } from '../domain/market'
import { resolvePrice } from '../domain/pricing'
import { PROFILES_KEY } from './schema'

const HEADER = 'gid;nom;niveau;type;categorie;vendus_24h;vendus_7j;vendus_30j;median_30j;moyen_30j;median_24h;kamas_par_jour'
const CSV = [HEADER, '33515;Neurone de dragodinde;60;x;y;2203;17611;67939;26056;28517;28987;59007286', '1844;Truite;20;x;y;39154;366066;1554575;17;18;28;880925'].join('\n')
const snapshot = (serverName: string) => buildSnapshot(parseHdvCsv(CSV), { serverName, exportDate: '2026-10-02', source: 'test.csv', importedAt: 1_000 })

const st = (state: unknown, version = 1) => JSON.stringify({ state, version })
const mountOf = (id: string) => ({
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
})
const server = (id: string, name: string) => ({ id, name, createdAt: 1, priceStat: 'auto', maxMarketShare: 0.15 })
const REGISTRY = {
  version: 1,
  activeProfileId: 'alpha',
  profiles: [
    { id: 'alpha', name: 'Alpha', serverId: 'tylezia', createdAt: 1 },
    { id: 'beta', name: 'Beta', serverId: 'salar', createdAt: 2 },
  ],
  servers: [server('tylezia', 'Tylezia'), server('salar', 'Salar')],
}

function seedTwoProfiles() {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(REGISTRY))
  localStorage.setItem('elevagesimu:p:alpha:inventory', st({ mounts: [mountOf('a1'), mountOf('a2')] }))
  localStorage.setItem('elevagesimu:p:alpha:settings', st({ jobLevel: 50, server: 'ancien libellé' }, 3))
  localStorage.setItem('elevagesimu:p:alpha:montures-ui', JSON.stringify({ sort: 'alpha' }))
  localStorage.setItem('elevagesimu:p:beta:inventory', st({ mounts: ['b1', 'b2', 'b3', 'b4', 'b5'].map(mountOf) }))
  localStorage.setItem('elevagesimu:p:beta:settings', st({ jobLevel: 150 }, 3))
  localStorage.setItem('elevagesimu:s:tylezia:prices', st({ items: { '1844': 30 }, mounts: {}, generations: {}, genetonValue: null, updatedAt: 1 }))
  localStorage.setItem('elevagesimu:s:salar:prices', st({ items: { '1844': 99 }, mounts: {}, generations: {}, genetonValue: 400, updatedAt: 1 }))
}

/** Modules frais (comme un rechargement de la page) après avoir préparé le localStorage. */
async function load() {
  vi.resetModules()
  const profiles = await import('./profiles')
  const inventory = await import('./inventory')
  const settings = await import('./settings')
  const prices = await import('./prices')
  const market = await import('./market')
  const persistence = await import('./persistence')
  return { ...profiles, ...inventory, ...settings, ...prices, ...market, ...persistence }
}

const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null') as { state: Record<string, unknown> } | null
const mountCount = (key: string) => {
  const m = stored(key)?.state.mounts
  return Array.isArray(m) ? m.length : -1
}
const storedServerName = (key: string) => {
  const snap = stored(key)?.state.snapshot
  return snap && typeof snap === 'object' && 'serverName' in snap ? snap.serverName : null
}
const registry = () => JSON.parse(localStorage.getItem(PROFILES_KEY) ?? 'null') as typeof REGISTRY

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  // jsdom ne sait pas recharger la page : il le signale par une erreur de console.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('profil ouvert et isolation', () => {
  it('les stores lisent les clés du profil ouvert et de son serveur ; les écritures ne touchent que lui', async () => {
    seedTwoProfiles()
    const m = await load()
    expect(m.ACTIVE_PROFILE_ID).toBe('alpha')
    expect(m.ACTIVE_SERVER_ID).toBe('tylezia')
    expect(m.STORE_KEYS.inventory).toBe('elevagesimu:p:alpha:inventory')
    expect(m.STORE_KEYS.prices).toBe('elevagesimu:s:tylezia:prices')
    expect(m.profileKey('montures-ui')).toBe('elevagesimu:p:alpha:montures-ui')
    expect(m.serverKey('market')).toBe('elevagesimu:s:tylezia:market')
    expect(m.useInventory.getState().mounts.map((x) => x.id)).toEqual(['a1', 'a2'])
    expect(m.useSettings.getState().jobLevel).toBe(50)
    expect(m.usePrices.getState().items).toEqual({ '1844': 30 })
    // Libellé du serveur dérivé du registre (compatibilité).
    expect(m.useSettings.getState().server).toBe('Tylezia')

    const beta = localStorage.getItem('elevagesimu:p:beta:inventory')
    const salar = localStorage.getItem('elevagesimu:s:salar:prices')
    m.useInventory.getState().add(mountOf('a3') as never)
    m.usePrices.getState().setItem(1844, 35)
    m.useSettings.getState().update({ jobLevel: 60 })
    expect(mountCount('elevagesimu:p:alpha:inventory')).toBe(3)
    expect(stored('elevagesimu:s:tylezia:prices')?.state.items).toEqual({ '1844': 35 })
    expect(stored('elevagesimu:p:alpha:settings')?.state.jobLevel).toBe(60)
    expect(localStorage.getItem('elevagesimu:p:beta:inventory')).toBe(beta)
    expect(localStorage.getItem('elevagesimu:s:salar:prices')).toBe(salar)
    // Aucune ancienne clé n'est écrite.
    expect(localStorage.getItem('elevagesimu:inventory')).toBeNull()
  })

  it('changer de profil : registre enregistré, plus aucune écriture, puis (rechargement) l’autre profil et son serveur', async () => {
    seedTwoProfiles()
    let m = await load()
    expect(m.useProfiles.getState().switchProfile('beta')).toMatchObject({ ok: true })
    expect(registry().activeProfileId).toBe('beta')
    expect(m.writesFrozen()).toBe(true)
    // Avant le rechargement, une modification n'écrit plus rien (le profil va changer).
    m.useInventory.getState().add(mountOf('perdue') as never)
    expect(mountCount('elevagesimu:p:alpha:inventory')).toBe(2)
    expect(sessionStorage.getItem('elevagesimu-flash')).toMatch(/Beta/)

    m = await load()
    expect(m.ACTIVE_PROFILE_ID).toBe('beta')
    expect(m.useInventory.getState().mounts).toHaveLength(5)
    expect(m.useSettings.getState()).toMatchObject({ jobLevel: 150, server: 'Salar' })
    expect(m.usePrices.getState()).toMatchObject({ items: { '1844': 99 }, genetonValue: 400 })
    expect(m.useActiveServer).toBeTypeOf('function')
  })

  it('deux profils du même serveur partagent ses prix, pas leurs montures', async () => {
    seedTwoProfiles()
    let m = await load()
    const r = m.useProfiles.getState().createProfile({ name: 'Gamma', serverId: 'tylezia' })
    expect(r).toMatchObject({ ok: true, id: 'gamma' })
    expect(registry().profiles.map((p) => p.id)).toEqual(['alpha', 'beta', 'gamma'])
    m.useProfiles.getState().switchProfile('gamma')
    m = await load()
    expect(m.useInventory.getState().mounts).toEqual([])
    expect(m.usePrices.getState().items).toEqual({ '1844': 30 })
    expect(m.useSettings.getState().jobLevel).toBe(1)
  })

  it('créer un profil sur un nouveau serveur, dupliquer un profil (toutes ses données)', async () => {
    seedTwoProfiles()
    const m = await load()
    expect(m.useProfiles.getState().createProfile({ name: 'Delta', newServerName: 'Ombre' })).toMatchObject({ ok: true, id: 'delta' })
    expect(registry().servers.map((s) => s.name)).toEqual(['Tylezia', 'Salar', 'Ombre'])
    expect(m.useProfiles.getState().createProfile({ name: 'Delta', serverId: 'salar' })).toMatchObject({ ok: false })
    expect(m.useProfiles.getState().createProfile({ name: 'Copie', serverId: 'tylezia', duplicateFrom: 'alpha' })).toMatchObject({ ok: true, id: 'copie' })
    expect(localStorage.getItem('elevagesimu:p:copie:inventory')).toBe(localStorage.getItem('elevagesimu:p:alpha:inventory'))
    expect(localStorage.getItem('elevagesimu:p:copie:montures-ui')).toBe(localStorage.getItem('elevagesimu:p:alpha:montures-ui'))
    expect(m.useProfiles.getState().duplicateProfile('beta')).toMatchObject({ ok: true, id: 'beta-copie' })
    expect(registry().profiles.find((p) => p.id === 'beta-copie')).toMatchObject({ name: 'Beta (copie)', serverId: 'salar' })
    expect(localStorage.getItem('elevagesimu:p:beta-copie:inventory')).toBe(localStorage.getItem('elevagesimu:p:beta:inventory'))
  })

  it('supprimer un autre profil efface ses données ; un serveur utilisé ne peut pas être supprimé', async () => {
    seedTwoProfiles()
    const m = await load()
    expect(m.useProfiles.getState().deleteServer('salar')).toMatchObject({ ok: false })
    expect(m.useProfiles.getState().deleteProfile('beta')).toMatchObject({ ok: true })
    expect(localStorage.getItem('elevagesimu:p:beta:inventory')).toBeNull()
    expect(registry().profiles.map((p) => p.id)).toEqual(['alpha'])
    expect(m.writesFrozen()).toBe(false)
    expect(m.useProfiles.getState().deleteServer('salar')).toMatchObject({ ok: true })
    expect(localStorage.getItem('elevagesimu:s:salar:prices')).toBeNull()
    expect(m.useProfiles.getState().deleteProfile('alpha')).toMatchObject({ ok: false })
  })

  it('supprimer le profil ouvert : bascule sur un autre, écritures bloquées, données effacées', async () => {
    seedTwoProfiles()
    const m = await load()
    expect(m.useProfiles.getState().deleteProfile('alpha')).toMatchObject({ ok: true })
    expect(m.writesFrozen()).toBe(true)
    expect(registry().activeProfileId).toBe('beta')
    m.useInventory.getState().add(mountOf('x') as never)
    expect(localStorage.getItem('elevagesimu:p:alpha:inventory')).toBeNull()
  })

  it('renommer le serveur (Réglages ou ancien champ « serveur ») met à jour le libellé', async () => {
    seedTwoProfiles()
    const m = await load()
    m.useSettings.getState().update({ server: 'Tylezia (Héroïque)' })
    expect(registry().servers[0].name).toBe('Tylezia (Héroïque)')
    expect(m.useSettings.getState().server).toBe('Tylezia (Héroïque)')
    // Nom déjà pris : refusé, le libellé reste celui du serveur.
    m.useSettings.getState().update({ server: 'Salar' })
    expect(m.useSettings.getState().server).toBe('Tylezia (Héroïque)')
    expect(m.useProfiles.getState().renameServer('salar', 'Salar 2')).toMatchObject({ ok: true })
  })

  it('un autre onglet supprime le profil ouvert : plus aucune écriture ici, rechargement', async () => {
    seedTwoProfiles()
    const m = await load()
    const next = { ...REGISTRY, activeProfileId: 'beta', profiles: [REGISTRY.profiles[1]] }
    localStorage.setItem(PROFILES_KEY, JSON.stringify(next))
    window.dispatchEvent(new StorageEvent('storage', { key: PROFILES_KEY, newValue: JSON.stringify(next), storageArea: localStorage }))
    expect(m.useProfiles.getState().registry.profiles.map((p) => p.id)).toEqual(['beta'])
    expect(m.writesFrozen()).toBe(true)
  })
})

describe('premier chargement de la v2', () => {
  it('anciennes données → profil « Principal » sur le serveur noté dans les réglages, anciennes clés gardées', async () => {
    localStorage.setItem('elevagesimu:settings', st({ jobLevel: 87, server: 'Salar' }, 3))
    localStorage.setItem('elevagesimu:inventory', st({ mounts: [mountOf('v1')] }))
    localStorage.setItem('elevagesimu:prices', st({ items: { '1844': 42 }, mounts: {}, generations: {}, genetonValue: null, updatedAt: 1 }))
    const m = await load()
    expect(m.MIGRATED_AT_BOOT).toBe(true)
    expect(m.ACTIVE_PROFILE_ID).toBe('principal')
    expect(m.ACTIVE_SERVER_ID).toBe('salar')
    expect(m.useInventory.getState().mounts.map((x) => x.id)).toEqual(['v1'])
    expect(m.useSettings.getState()).toMatchObject({ jobLevel: 87, server: 'Salar' })
    expect(m.usePrices.getState().items).toEqual({ '1844': 42 })
    expect(localStorage.getItem('elevagesimu:inventory')).not.toBeNull()
    expect(m.useProfiles.getState().registry.legacy?.keys).toHaveLength(3)
    // Rechargement : pas de nouvelle migration.
    const again = await load()
    expect(again.MIGRATED_AT_BOOT).toBe(false)
    // « Supprimer l'ancienne copie ».
    expect(again.useProfiles.getState().removeLegacyCopy()).toMatchObject({ ok: true })
    expect(localStorage.getItem('elevagesimu:inventory')).toBeNull()
    expect(again.useInventory.getState().mounts).toHaveLength(1)
    expect((registry() as { legacy?: unknown }).legacy).toBeDefined()
  })

  it('nouvelle installation : profil « Principal » sur « Mon serveur »', async () => {
    const m = await load()
    expect(m.ACTIVE_PROFILE_ID).toBe('principal')
    expect(m.useActiveServer).toBeTypeOf('function')
    expect(m.useProfiles.getState().registry.servers[0].name).toBe('Mon serveur')
    expect(m.useSettings.getState().server).toBe('Mon serveur')
    expect(m.PROFILE_MODE).toBe('profiles')
  })
})

describe('marché importé, par serveur', () => {
  it('serveur ouvert : instantané et historique enregistrés, contexte de prix « marché » ; autre serveur : ses clés seulement', async () => {
    seedTwoProfiles()
    const m = await load()
    expect(m.applyMarketSnapshot('tylezia', snapshot('Tylezia'))).toEqual({ ok: true })
    expect(m.useMarket.getState().snapshot?.exportDate).toBe('2026-10-02')
    expect(storedServerName('elevagesimu:s:tylezia:market')).toBe('Tylezia')
    expect(m.useMarketHistory.getState().entries).toHaveLength(1)
    expect(m.serverMarketHistory('tylezia')).toHaveLength(1)

    const { result } = renderHook(() => m.usePriceContext())
    expect(result.current.market?.serverName).toBe('Tylezia')
    expect(resolvePrice(33515, result.current)).toMatchObject({ origin: 'marche', price: 28987 })
    // Prix saisi : prioritaire sur le marché.
    expect(resolvePrice(1844, result.current)).toMatchObject({ origin: 'joueur', price: 30 })

    // Statistique de prix du serveur.
    m.useProfiles.getState().setServerOptions('tylezia', { priceStat: 'median30' })
    expect(m.marketSource()?.stat).toBe('median30')
    const { result: r2 } = renderHook(() => m.usePriceContext())
    expect(resolvePrice(33515, r2.current)).toMatchObject({ origin: 'marche', price: 26056 })

    // Import pour un autre serveur : n'affecte pas le serveur ouvert.
    expect(m.applyMarketSnapshot('salar', { ...snapshot('Salar'), importedAt: 2_000 })).toEqual({ ok: true })
    expect(storedServerName('elevagesimu:s:salar:market')).toBe('Salar')
    expect(m.serverMarketHistory('salar')).toHaveLength(1)
    expect(m.useMarket.getState().snapshot?.serverName).toBe('Tylezia')

    // Suppression des prix du marché.
    expect(m.clearServerMarket('salar')).toEqual({ ok: true })
    expect(localStorage.getItem('elevagesimu:s:salar:market')).toBeNull()
    m.clearServerMarket('tylezia')
    expect(m.useMarket.getState().snapshot).toBeNull()
    expect(stored('elevagesimu:s:tylezia:market')?.state.snapshot).toBeNull()
  })

  it('préréglage de Tylezia : chargé à la demande, proposé pour un serveur nommé Tylezia', async () => {
    seedTwoProfiles()
    const m = await load()
    expect(m.presetForServer('tylézia')?.id).toBe('tylezia-2026-10-02')
    expect(m.presetForServer('Salar')).toBeUndefined()
    const snap = await m.MARKET_PRESETS[0].load()
    expect(snap.serverName).toBe('Tylezia')
    expect(snap.source).toMatch(/Préréglage/)
    expect(Object.keys(snap.rows).length).toBeGreaterThan(1000)
  })
})
