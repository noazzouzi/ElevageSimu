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

  it('MKT-12 : import annulable (instantané précédent rétabli, import retiré de l’historique) ; « compléter » garde les objets absents du fichier', async () => {
    seedTwoProfiles()
    const m = await load()
    const full = snapshot('Tylezia')
    expect(m.applyMarketSnapshot('tylezia', full)).toEqual({ ok: true })
    // Export partiel (une seule ligne) importé par-dessus : remplacement, puis annulation.
    const partial = buildSnapshot(parseHdvCsv([HEADER, '33515;Neurone de dragodinde;60;x;y;9;9;900;1;1;30000;1'].join('\n')), { serverName: 'Tylezia', exportDate: '2026-10-03', source: 'partiel.csv', importedAt: 5_000 })
    expect(m.applyMarketSnapshot('tylezia', partial)).toEqual({ ok: true })
    expect(Object.keys(m.useMarket.getState().snapshot?.rows ?? {})).toEqual(['33515'])
    expect(m.marketUndoFor('tylezia')?.previous?.importedAt).toBe(1_000)
    expect(m.undoMarketImport('tylezia')).toMatchObject({ ok: true })
    expect(Object.keys(m.useMarket.getState().snapshot?.rows ?? {}).sort()).toEqual(['1844', '33515'])
    expect(stored('elevagesimu:s:tylezia:market')?.state.snapshot).toMatchObject({ importedAt: 1_000 })
    expect(m.useMarketHistory.getState().entries.map((e) => e.importedAt)).toEqual([1_000])
    // Plus rien à annuler (l'annulation n'est pas elle-même annulable).
    expect(m.undoMarketImport('tylezia')).toMatchObject({ ok: false })
    // Compléter : la Neurone prend le nouveau prix, la Truite (absente du fichier) garde l'ancien.
    const r = m.mergeMarketSnapshot('tylezia', { ...partial, importedAt: 6_000 })
    expect(r.ok).toBe(true)
    const merged = m.useMarket.getState().snapshot!
    expect(merged.rows['33515'][2]).toBe(30000)
    expect(merged.rows['1844']).toEqual(full.rows['1844'])
    expect(merged.exportDate).toBe('2026-10-02') // la Truite date encore du 02/10
    expect(merged.source).toMatch(/complété par 1 objet de l’export du 02\/10\/2026/)
    // Annuler la fusion rétablit l'export complet.
    expect(m.undoMarketImport('tylezia')).toMatchObject({ ok: true })
    expect(m.useMarket.getState().snapshot?.importedAt).toBe(1_000)
    // Autre serveur : même chose sur ses clés ; serveur sans marché avant l'import → plus de marché.
    expect(m.applyMarketSnapshot('salar', { ...snapshot('Salar'), importedAt: 7_000 })).toEqual({ ok: true })
    expect(m.undoMarketImport('salar')).toMatchObject({ ok: true, restored: null })
    expect(localStorage.getItem('elevagesimu:s:salar:market')).toBeNull()
    expect(m.serverMarketHistory('salar')).toEqual([])
    // L'annulation survit au rechargement de l'onglet (sessionStorage).
    expect(m.applyMarketSnapshot('tylezia', partial)).toEqual({ ok: true })
    const m2 = await load()
    expect(m2.marketUndoFor('tylezia')?.previous?.importedAt).toBe(1_000)
  })

  it('MKT-10 : les prix d’un autre serveur chargés pour celui-ci gardent leur origine', async () => {
    seedTwoProfiles()
    const m = await load()
    // Le serveur « Tylezia » reçoit l'export d'« Ombre » : origine Ombre, chargés pour Tylezia.
    expect(m.applyMarketSnapshot('tylezia', snapshot('Ombre'))).toEqual({ ok: true })
    const { result } = renderHook(() => m.useMarketSource())
    expect(result.current).toMatchObject({ serverName: 'Tylezia', originServer: 'Ombre' })
    expect(resolvePrice(33515, { overrides: {}, useDefaults: true, market: result.current })).toMatchObject({ market: { serverName: 'Ombre', loadedFor: 'Tylezia' } })
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

// ---------- Revue v2 « données » ----------

const quotaError = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' })
/** localStorage qui refuse (quota) l'écriture des clés choisies. */
function refuseWrites(keys: string[]) {
  const real = Storage.prototype.setItem
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
    if (this === localStorage && keys.includes(k)) throw quotaError()
    return real.call(this, k, v)
  })
}

describe('modifications non enregistrées et changement de profil (DI-03)', () => {
  it('ouvrir un autre profil ou changer le serveur du profil ouvert est refusé (code « pending ») sans « force »', async () => {
    seedTwoProfiles()
    const m = await load()
    const spy = refuseWrites(['elevagesimu:p:alpha:settings'])
    m.useSettings.getState().update({ jobLevel: 57 })
    expect(Object.keys(m.pendingWrites())).toEqual(['elevagesimu:p:alpha:settings'])
    expect(m.hasPendingForActive()).toBe(true)

    expect(m.useProfiles.getState().switchProfile('beta')).toMatchObject({ ok: false, code: 'pending', error: expect.stringMatching(/pas enregistrées/) })
    expect(registry().activeProfileId).toBe('alpha')
    expect(m.writesFrozen()).toBe(false)
    expect(sessionStorage.getItem('elevagesimu-flash')).toBeNull()
    expect(m.useProfiles.getState().setProfileServer('alpha', 'salar')).toMatchObject({ ok: false, code: 'pending' })
    expect(registry().profiles[0].serverId).toBe('tylezia')
    // Sans rechargement (autre profil) : accepté.
    expect(m.useProfiles.getState().setProfileServer('beta', 'tylezia')).toMatchObject({ ok: true })
    spy.mockRestore()

    // Confirmé par le joueur (après sauvegarde proposée) : on passe outre.
    expect(m.useProfiles.getState().switchProfile('beta', undefined, { force: true })).toMatchObject({ ok: true })
    expect(registry().activeProfileId).toBe('beta')
    expect(m.writesFrozen()).toBe(true)
  })
})

describe('profil de chaque onglet (DI-04)', () => {
  it('un rechargement garde le profil de CET onglet, même si un autre onglet en a ouvert un autre', async () => {
    seedTwoProfiles()
    let m = await load()
    expect(m.ACTIVE_PROFILE_ID).toBe('alpha')
    expect(sessionStorage.getItem('elevagesimu-tab-profile')).toBe('alpha')
    // Un autre onglet ouvre « beta » : le registre (profil par défaut des nouveaux onglets) change.
    localStorage.setItem(PROFILES_KEY, JSON.stringify({ ...REGISTRY, activeProfileId: 'beta' }))
    m = await load()
    expect(m.ACTIVE_PROFILE_ID).toBe('alpha')
    expect(m.ACTIVE_SERVER_ID).toBe('tylezia')
    expect(registry().activeProfileId).toBe('beta')
    // Changer de profil dans cet onglet : registre ET choix de l'onglet.
    m.useProfiles.getState().switchProfile('beta')
    expect(sessionStorage.getItem('elevagesimu-tab-profile')).toBe('beta')
    // Nouvel onglet (sessionStorage vide) : profil par défaut du registre.
    sessionStorage.clear()
    localStorage.setItem(PROFILES_KEY, JSON.stringify({ ...REGISTRY, activeProfileId: 'alpha' }))
    m = await load()
    expect(m.ACTIVE_PROFILE_ID).toBe('alpha')
  })

  it('profil de l’onglet supprimé entre-temps : profil par défaut ouvert, avec un message', async () => {
    seedTwoProfiles()
    sessionStorage.setItem('elevagesimu-tab-profile', 'gamma')
    const m = await load()
    expect(m.ACTIVE_PROFILE_ID).toBe('alpha')
    expect(sessionStorage.getItem('elevagesimu-flash')).toMatch(/Le profil de cet onglet a été supprimé : « Alpha » ouvert/)
    expect(sessionStorage.getItem('elevagesimu-tab-profile')).toBe('alpha')
  })
})

describe('copie d’avant les profils modifiée par un onglet resté sur l’ancienne version (DI-05)', () => {
  function seedV1() {
    localStorage.setItem('elevagesimu:settings', st({ jobLevel: 87, server: 'Salar' }, 3))
    localStorage.setItem('elevagesimu:inventory', st({ mounts: [mountOf('v1')] }))
  }

  it('alerte, suppression de l’ancienne copie refusée ; « reprendre » copie le changement dans « Principal »', async () => {
    seedV1()
    let m = await load()
    expect(m.MIGRATED_AT_BOOT).toBe(true)
    expect(sessionStorage.getItem('elevagesimu-flash')).toMatch(/Fermez ou rechargez les autres onglets/)
    expect(m.useStorageHealth.getState().issues.filter((i) => i.kind === 'divergence')).toEqual([])
    // L'onglet v1 enregistre une capture après la reprise.
    localStorage.setItem('elevagesimu:inventory', st({ mounts: [mountOf('v1'), mountOf('CAPTURE-APRES-MIGRATION')] }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'elevagesimu:inventory', storageArea: localStorage }))
    expect(m.useStorageHealth.getState().issues.some((i) => i.kind === 'divergence')).toBe(true)

    m = await load()
    expect(m.useStorageHealth.getState().issues.find((i) => i.kind === 'divergence')?.message).toMatch(/Montures/)
    expect(m.useProfiles.getState().removeLegacyCopy()).toMatchObject({ ok: false, error: expect.stringMatching(/modifiée/) })
    expect(localStorage.getItem('elevagesimu:inventory')).toContain('CAPTURE-APRES-MIGRATION')

    expect(m.useProfiles.getState().adoptLegacyChanges(['elevagesimu:inventory'])).toMatchObject({ ok: true })
    expect(localStorage.getItem('elevagesimu:p:principal:inventory')).toContain('CAPTURE-APRES-MIGRATION')
    m = await load()
    expect(m.useInventory.getState().mounts.map((x) => x.id)).toEqual(['v1', 'CAPTURE-APRES-MIGRATION'])
    expect(m.useStorageHealth.getState().issues.filter((i) => i.kind === 'divergence')).toEqual([])
    expect(m.useProfiles.getState().removeLegacyCopy()).toMatchObject({ ok: true })
    expect(localStorage.getItem('elevagesimu:inventory')).toBeNull()
  })

  it('« ignorer » : le changement n’est pas repris, l’ancienne copie redevient supprimable', async () => {
    seedV1()
    await load()
    localStorage.setItem('elevagesimu:inventory', st({ mounts: [] }))
    const m = await load()
    expect(m.useProfiles.getState().ignoreLegacyChanges(['elevagesimu:inventory'])).toMatchObject({ ok: true })
    expect(mountCount('elevagesimu:p:principal:inventory')).toBe(1)
    expect(m.useProfiles.getState().removeLegacyCopy()).toMatchObject({ ok: true })
  })
})

describe('serveur du profil ouvert changé dans un autre onglet (DI-06)', () => {
  const moved = () => ({ ...REGISTRY, profiles: [{ ...REGISTRY.profiles[0], serverId: 'salar' }, REGISTRY.profiles[1]] })
  const changeElsewhere = () => {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(moved()))
    window.dispatchEvent(new StorageEvent('storage', { key: PROFILES_KEY, newValue: JSON.stringify(moved()), storageArea: localStorage }))
  }

  it('plus aucune écriture sur l’ancien serveur, rechargement (prix et marché du nouveau serveur)', async () => {
    seedTwoProfiles()
    const m = await load()
    changeElsewhere()
    expect(m.writesFrozen()).toBe(true)
    expect(sessionStorage.getItem('elevagesimu-flash')).toMatch(/serveur de ce profil a été changé dans un autre onglet \(« Salar »\)/)
    m.usePrices.getState().setItem(1844, 777)
    expect(stored('elevagesimu:s:tylezia:prices')?.state.items).toEqual({ '1844': 30 })
    const again = await load()
    expect(again.ACTIVE_SERVER_ID).toBe('salar')
  })

  it('avec des modifications non enregistrées : pas de rechargement automatique, alerte avec sauvegarde', async () => {
    seedTwoProfiles()
    const m = await load()
    const spy = refuseWrites(['elevagesimu:p:alpha:settings'])
    m.useSettings.getState().update({ jobLevel: 57 })
    spy.mockRestore()
    changeElsewhere()
    expect(m.writesFrozen()).toBe(true)
    expect(m.useStorageHealth.getState().issues.find((i) => i.kind === 'onglet')?.message).toMatch(/téléchargez une sauvegarde/)
    expect(Object.keys(m.pendingWrites())).toEqual(['elevagesimu:p:alpha:settings'])
  })
})

describe('import HDV refusé par le stockage (DI-07)', () => {
  it('serveur ouvert : erreur, marché et historique inchangés (ni « succès » ni historique enregistré)', async () => {
    seedTwoProfiles()
    const m = await load()
    const spy = refuseWrites(['elevagesimu:s:tylezia:market'])
    const r = m.applyMarketSnapshot('tylezia', snapshot('Tylezia'))
    spy.mockRestore()
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/stockage plein\) : prix du marché inchangés/) })
    expect(m.useMarket.getState().snapshot).toBeNull()
    expect(m.useMarketHistory.getState().entries).toEqual([])
    expect(localStorage.getItem('elevagesimu:s:tylezia:market-history')).toBeNull()
    // Rien n'est « en attente » : l'import n'a simplement pas eu lieu.
    expect(m.pendingWrites()).toEqual({})
    // Autre serveur : même garantie, sans fausse alerte « modifications non enregistrées ».
    const spy2 = refuseWrites(['elevagesimu:s:salar:market'])
    expect(m.applyMarketSnapshot('salar', snapshot('Salar'))).toMatchObject({ ok: false })
    spy2.mockRestore()
    expect(m.useStorageHealth.getState().issues.filter((i) => i.kind === 'ecriture')).toEqual([])
  })
})

describe('supprimer l’ancienne copie (DI-13)', () => {
  const legacy = { migratedAt: 1, keys: ['elevagesimu:inventory'], moved: [], removedAt: 0 }

  it('registre d’une version plus récente (lecture seule) : refus AVANT toute suppression', async () => {
    localStorage.setItem(PROFILES_KEY, JSON.stringify({ ...REGISTRY, version: 2, legacy }))
    localStorage.setItem('elevagesimu:inventory', 'PRE-V2-ORIGINAL')
    const m = await load()
    expect(m.useProfiles.getState().readOnly).toBe(true)
    expect(m.useProfiles.getState().removeLegacyCopy()).toMatchObject({ ok: false })
    expect(localStorage.getItem('elevagesimu:inventory')).toBe('PRE-V2-ORIGINAL')
  })

  it('registre impossible à enregistrer : les anciennes clés restent en place', async () => {
    seedTwoProfiles()
    localStorage.setItem(PROFILES_KEY, JSON.stringify({ ...REGISTRY, legacy }))
    localStorage.setItem('elevagesimu:inventory', st({ mounts: [] }))
    const m = await load()
    const spy = refuseWrites([PROFILES_KEY])
    expect(m.useProfiles.getState().removeLegacyCopy()).toMatchObject({ ok: false })
    spy.mockRestore()
    expect(localStorage.getItem('elevagesimu:inventory')).not.toBeNull()
  })
})
