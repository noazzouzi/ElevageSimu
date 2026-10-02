// Registre des profils et des serveurs (pur) : démarrage, migration des données d'avant les profils
// (idempotente, sûre en cas de quota plein), reconstruction d'un registre illisible, opérations.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROFILE_ID,
  addProfile,
  addServer,
  bootProfiles,
  copyProfileData,
  defaultRegistry,
  freeId,
  legacyKeys,
  migrateLegacyStorage,
  profileDataSummary,
  rebuildRegistry,
  removeLegacyCopy,
  removeProfile,
  removeProfileData,
  removeServer,
  removeServerData,
  renameProfile,
  renameServer,
  sanitizeRegistry,
  serverMarketMeta,
  setActiveProfile,
  setProfileServer,
  setServerOptions,
  type ProfilesRegistry,
} from './profileRegistry'
import { PROFILES_CORRUPT_KEY, PROFILES_KEY, parseStoreKey, persistedStoreInfo, profileStoreKey, serverStoreKey, storeKeysFor, type StorageLike } from './schema'

class FakeStorage implements StorageLike {
  map = new Map<string, string>()
  quota: number | null = null
  constructor(init: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(init)) this.map.set(k, v)
  }
  get length() {
    return this.map.size
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  used() {
    let n = 0
    for (const [k, v] of this.map) n += k.length + v.length
    return n
  }
  setItem(k: string, v: string) {
    const prev = this.map.get(k)
    const next = this.used() - (prev === undefined ? 0 : k.length + prev.length) + k.length + v.length
    if (this.quota !== null && next > this.quota) {
      const e = new Error('The quota has been exceeded.')
      e.name = 'QuotaExceededError'
      throw e
    }
    this.map.set(k, v)
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
}

const NOW = 1_790_000_000_000
const store = (state: unknown, version = 1) => JSON.stringify({ state, version })

/** Données d'une installation v1 (avant les profils). */
function legacyStorage(server = 'Salar') {
  return new FakeStorage({
    'elevagesimu:settings': store({ jobLevel: 87, server, family: 'volkorne' }, 3),
    'elevagesimu:inventory': store({ mounts: [{ id: 'm1' }, { id: 'm2' }] }),
    'elevagesimu:prices': store({ items: { '1844': 30 }, mounts: {}, generations: {}, genetonValue: null, updatedAt: 1 }),
    'elevagesimu:journal': store({ entries: [] }),
    'elevagesimu:montures-ui': JSON.stringify({ sort: 'x' }),
    'elevagesimu:enclos-notifications': 'oui',
    'autre-site:x': '1',
  })
}

describe('clés de stockage', () => {
  it('profil, serveur, clé globale ou ancienne clé ; store reconnu seulement dans sa portée', () => {
    expect(storeKeysFor('principal', 'tylezia')).toMatchObject({
      settings: 'elevagesimu:p:principal:settings',
      inventory: 'elevagesimu:p:principal:inventory',
      prices: 'elevagesimu:s:tylezia:prices',
      market: 'elevagesimu:s:tylezia:market',
      'market-history': 'elevagesimu:s:tylezia:market-history',
    })
    expect(parseStoreKey('elevagesimu:p:alt-2:montures-ui')).toEqual({ kind: 'profile', id: 'alt-2', base: 'montures-ui' })
    expect(parseStoreKey('elevagesimu:s:tylezia:prices')).toEqual({ kind: 'server', id: 'tylezia', base: 'prices' })
    expect(parseStoreKey('elevagesimu:profiles')).toMatchObject({ kind: 'global' })
    expect(parseStoreKey('elevagesimu:inventory')).toEqual({ kind: 'legacy', base: 'inventory' })
    expect(parseStoreKey('elevagesimu:p:Mauvais Id:x')).toBeNull()
    expect(parseStoreKey('autre:x')).toBeNull()
    expect(persistedStoreInfo('elevagesimu:p:x:inventory')?.version).toBe(1)
    expect(persistedStoreInfo('elevagesimu:s:x:prices')?.label).toBe('Prix saisis')
    expect(persistedStoreInfo('elevagesimu:p:x:prices')).toBeUndefined()
    expect(persistedStoreInfo('elevagesimu:s:x:settings')).toBeUndefined()
    expect(persistedStoreInfo('elevagesimu:settings')?.version).toBe(3)
    expect(persistedStoreInfo('elevagesimu:market')).toBeUndefined()
    expect(persistedStoreInfo('elevagesimu:p:x:montures-ui')).toBeUndefined()
  })
})

describe('démarrage', () => {
  it('sans stockage : registre en mémoire (rien n’est enregistré)', () => {
    const b = bootProfiles(null, NOW)
    expect(b.mode).toBe('memory')
    expect(b.registry.profiles).toEqual([{ id: DEFAULT_PROFILE_ID, name: 'Principal', serverId: 'mon-serveur', createdAt: NOW }])
  })

  it('première ouverture sans données : profil « Principal » sur « Mon serveur », enregistré', () => {
    const s = new FakeStorage()
    const b = bootProfiles(s, NOW)
    expect(b).toMatchObject({ mode: 'profiles', migrated: false, readOnly: false })
    expect(JSON.parse(s.getItem(PROFILES_KEY) ?? 'null')).toEqual(b.registry)
    expect(b.registry.servers[0]).toMatchObject({ id: 'mon-serveur', name: 'Mon serveur', priceStat: 'auto', maxMarketShare: 0.15 })
    // Second démarrage : registre relu tel quel.
    expect(bootProfiles(s, NOW + 1)).toMatchObject({ mode: 'profiles', migrated: false, registry: b.registry, issues: [] })
  })

  it('registre d’une version plus récente : lu au mieux, en lecture seule, jamais réécrit', () => {
    const reg = { ...defaultRegistry(NOW), version: 9 }
    const raw = JSON.stringify(reg)
    const s = new FakeStorage({ [PROFILES_KEY]: raw })
    const b = bootProfiles(s, NOW)
    expect(b.readOnly).toBe(true)
    expect(b.issues[0].kind).toBe('version')
    expect(s.getItem(PROFILES_KEY)).toBe(raw)
  })

  it('registre illisible : copie gardée, registre reconstruit d’après les données présentes', () => {
    const s = new FakeStorage({
      [PROFILES_KEY]: '{ cassé',
      [profileStoreKey('principal', 'settings')]: store({ server: 'Tylezia' }, 3),
      [profileStoreKey('alt', 'inventory')]: store({ mounts: [] }),
      [serverStoreKey('tylezia', 'prices')]: store({ items: {} }),
    })
    const b = bootProfiles(s, NOW)
    expect(s.getItem(PROFILES_CORRUPT_KEY)).toBe('{ cassé')
    expect(b.registry.profiles.map((p) => [p.id, p.serverId])).toEqual([
      ['alt', 'tylezia'],
      ['principal', 'tylezia'],
    ])
    expect(b.registry.servers).toEqual([expect.objectContaining({ id: 'tylezia', name: 'Tylezia' })])
    expect(b.registry.activeProfileId).toBe('principal')
    expect(b.issues[0].message).toMatch(/illisible/)
    expect(sanitizeRegistry(JSON.parse(s.getItem(PROFILES_KEY) ?? 'null')).registry).toEqual(b.registry)
    expect(rebuildRegistry(new FakeStorage(), NOW)).toBeNull()
  })
})

describe('migration des données d’avant les profils', () => {
  it('anciennes clés → profil « Principal » sur le serveur des réglages ; prix → serveur ; anciennes clés gardées', () => {
    const s = legacyStorage()
    const before = new Map(s.map)
    const b = bootProfiles(s, NOW)
    expect(b).toMatchObject({ mode: 'profiles', migrated: true })
    const reg = b.registry
    expect(reg.servers).toEqual([{ id: 'salar', name: 'Salar', createdAt: NOW, priceStat: 'auto', maxMarketShare: 0.15 }])
    expect(reg.profiles).toEqual([{ id: 'principal', name: 'Principal', serverId: 'salar', createdAt: NOW }])
    expect(s.getItem('elevagesimu:p:principal:inventory')).toBe(before.get('elevagesimu:inventory'))
    expect(s.getItem('elevagesimu:p:principal:settings')).toBe(before.get('elevagesimu:settings'))
    expect(s.getItem('elevagesimu:p:principal:montures-ui')).toBe(before.get('elevagesimu:montures-ui'))
    expect(s.getItem('elevagesimu:s:salar:prices')).toBe(before.get('elevagesimu:prices'))
    expect(s.getItem('elevagesimu:p:principal:prices')).toBeNull()
    // Réglage de l'appareil : global, non migré.
    expect(s.getItem('elevagesimu:p:principal:enclos-notifications')).toBeNull()
    // Anciennes clés intactes (copie de sécurité), clés étrangères non touchées.
    for (const [k, v] of before) expect(s.getItem(k)).toBe(v)
    expect(reg.legacy).toEqual({
      migratedAt: NOW,
      keys: ['elevagesimu:inventory', 'elevagesimu:journal', 'elevagesimu:montures-ui', 'elevagesimu:prices', 'elevagesimu:settings'],
      moved: [],
      removedAt: 0,
    })
    expect(legacyKeys(s)).toHaveLength(5)
  })

  it('serveur sans nom dans les anciens réglages : « Mon serveur »', () => {
    const b = bootProfiles(legacyStorage('  '), NOW)
    expect(b.registry.servers[0]).toMatchObject({ id: 'mon-serveur', name: 'Mon serveur' })
  })

  it('idempotente : relancée, elle ne réécrit pas une clé déjà migrée (modifiée depuis)', () => {
    const s = legacyStorage()
    expect(migrateLegacyStorage(s, NOW).ok).toBe(true)
    s.setItem('elevagesimu:p:principal:inventory', store({ mounts: [] }))
    const again = migrateLegacyStorage(s, NOW + 5)
    expect(again.ok).toBe(true)
    expect(s.getItem('elevagesimu:p:principal:inventory')).toBe(store({ mounts: [] }))
    // Et un démarrage avec un registre présent ne migre plus.
    expect(bootProfiles(s, NOW + 6).migrated).toBe(false)
  })

  it('stockage presque plein : une clé qui ne peut pas être copiée est déplacée (rien n’est perdu)', () => {
    // Mesure : taille du registre (R) et des copies (C) sans limite.
    const probe = legacyStorage()
    const used0 = probe.used()
    migrateLegacyStorage(probe, NOW)
    const R = (probe.getItem(PROFILES_KEY) ?? '').length + PROFILES_KEY.length
    const C = probe.used() - used0 - R
    const s = legacyStorage()
    const inventory = s.getItem('elevagesimu:inventory')
    // Place pour le registre et la moitié des copies seulement.
    s.quota = s.used() + R + Math.floor(C / 2) + 100
    const m = migrateLegacyStorage(s, NOW)
    expect(m.ok).toBe(true)
    if (!m.ok) return
    expect(m.moved.length).toBeGreaterThan(0)
    expect(m.registry.legacy?.moved).toEqual([...m.moved].sort())
    for (const k of m.moved) expect(s.getItem(k)).toBeNull()
    expect(s.getItem('elevagesimu:p:principal:inventory')).toBe(inventory)
  })

  it('stockage plein : migration annulée (clés déplacées remises en place), mode « ancien format »', () => {
    const s = legacyStorage()
    const before = new Map(s.map)
    s.quota = s.used() + 10
    const b = bootProfiles(s, NOW)
    expect(b.mode).toBe('legacy')
    expect(b.readOnly).toBe(true)
    expect(b.issues[0].kind).toBe('ecriture')
    expect(new Map(s.map)).toEqual(before)
  })

  it('« Supprimer l’ancienne copie » retire les seules anciennes clés', () => {
    const s = legacyStorage()
    bootProfiles(s, NOW)
    expect(removeLegacyCopy(s)).toHaveLength(5)
    expect(legacyKeys(s)).toEqual([])
    expect(s.getItem('elevagesimu:enclos-notifications')).toBe('oui')
    expect(s.getItem('elevagesimu:p:principal:inventory')).not.toBeNull()
    expect(s.getItem(PROFILES_KEY)).not.toBeNull()
  })
})

describe('opérations sur le registre', () => {
  const base = (): ProfilesRegistry => defaultRegistry(NOW, 'Tylezia')

  it('serveurs : création (nom unique, identifiant dérivé), renommage, réglages, suppression refusée s’il est utilisé', () => {
    let r = base()
    const a = addServer(r, { name: '  Salar  ', now: NOW })
    expect(a).toMatchObject({ ok: true, id: 'salar' })
    if (!a.ok) return
    r = a.registry
    expect(addServer(r, { name: 'SALAR' })).toMatchObject({ ok: false })
    expect(addServer(r, { name: '' })).toMatchObject({ ok: false })
    expect(addServer(r, { name: 'x'.repeat(41) })).toMatchObject({ ok: false })
    // Identifiant libre même si des données d'un ancien serveur « salar-2 » traînent.
    const b = addServer(r, { name: 'Salar 2', taken: ['salar-2'] })
    expect(b.ok && b.id).toBe('salar-2-2')
    expect(renameServer(r, 'salar', 'Tylezia')).toMatchObject({ ok: false })
    expect(renameServer(r, 'salar', 'Salar (Héroïque)')).toMatchObject({ ok: true })
    expect(setServerOptions(r, 'salar', { priceStat: 'median30', maxMarketShare: 0.2 })).toMatchObject({ ok: true })
    expect(setServerOptions(r, 'salar', { maxMarketShare: 0 })).toMatchObject({ ok: false })
    expect(removeServer(r, 'tylezia')).toMatchObject({ ok: false, error: expect.stringMatching(/Principal/) })
    expect(removeServer(r, 'salar')).toMatchObject({ ok: true })
  })

  it('profils : création, renommage, changement de serveur, profil actif, suppression (jamais le dernier)', () => {
    let r = base()
    expect(removeProfile(r, 'principal')).toMatchObject({ ok: false })
    const p = addProfile(r, { name: 'Alt Tylezia', serverId: 'tylezia', color: 'gold', now: NOW })
    expect(p).toMatchObject({ ok: true, id: 'alt-tylezia' })
    if (!p.ok) return
    r = p.registry
    expect(addProfile(r, { name: 'principal', serverId: 'tylezia' })).toMatchObject({ ok: false })
    expect(addProfile(r, { name: 'Autre', serverId: 'inconnu' })).toMatchObject({ ok: false })
    expect(renameProfile(r, 'alt-tylezia', 'Principal')).toMatchObject({ ok: false })
    const s = addServer(r, { name: 'Salar' })
    if (!s.ok) return
    r = s.registry
    const moved = setProfileServer(r, 'alt-tylezia', 'salar')
    expect(moved.ok && moved.registry.profiles[1].serverId).toBe('salar')
    const act = setActiveProfile(r, 'alt-tylezia')
    expect(act.ok && act.registry.activeProfileId).toBe('alt-tylezia')
    if (!act.ok) return
    const del = removeProfile(act.registry, 'alt-tylezia')
    expect(del.ok && del.registry.activeProfileId).toBe('principal')
    expect(freeId('Principal', ['principal', 'principal-2'], 'profil')).toBe('principal-3')
  })

  it('normalisation : doublons et entrées illisibles écartés, serveur manquant recréé, profil actif inconnu remplacé', () => {
    const r = sanitizeRegistry({
      version: 1,
      activeProfileId: 'fantome',
      servers: [{ id: 'tylezia', name: 'Tylezia', priceStat: 'n-importe', maxMarketShare: 5 }, { id: 'tylezia' }, { id: 'Mauvais Id' }],
      profiles: [{ id: 'a', name: 'A', serverId: 'tylezia' }, { id: 'b', name: '', serverId: 'disparu', color: 'rose' }, { id: 'a' }, 'x'],
    })
    expect(r.registry?.activeProfileId).toBe('a')
    expect(r.registry?.servers.map((s) => s.id)).toEqual(['tylezia', 'disparu'])
    expect(r.registry?.servers[0]).toMatchObject({ priceStat: 'auto', maxMarketShare: 1 })
    expect(r.registry?.profiles).toEqual([
      { id: 'a', name: 'A', serverId: 'tylezia', createdAt: 0 },
      { id: 'b', name: 'Profil b', serverId: 'disparu', createdAt: 0 },
    ])
    expect(r.issues.length).toBeGreaterThan(3)
    expect(sanitizeRegistry({ version: 1, profiles: [] }).registry).toBeNull()
    expect(sanitizeRegistry('x').registry).toBeNull()
  })
})

describe('données d’un profil ou d’un serveur', () => {
  it('duplication tout ou rien, suppression, résumé, dernier import', () => {
    const s = new FakeStorage({
      [profileStoreKey('a', 'inventory')]: store({ mounts: [{}, {}, {}] }),
      [profileStoreKey('a', 'settings')]: store({ jobLevel: 120 }, 3),
      [profileStoreKey('a', 'montures-ui')]: '{}',
      [profileStoreKey('ab', 'inventory')]: store({ mounts: [] }),
      [serverStoreKey('t', 'market')]: store({ snapshot: { exportDate: '2026-10-02', importedAt: 5, source: 'x.csv', serverName: 'Tylezia', rows: { '1': [1, 1, 1, 1, 1, 1, 1] }, stats: { useful: 1022 } } }),
    })
    const c = copyProfileData(s, 'a', 'b')
    expect(c.ok && c.copied).toEqual([profileStoreKey('b', 'inventory'), profileStoreKey('b', 'montures-ui'), profileStoreKey('b', 'settings')])
    expect(profileDataSummary(s, 'b')).toMatchObject({ mounts: 3, journal: null, jobLevel: 120 })
    // Pas de place : rien n'est copié.
    s.quota = s.used() + 30
    expect(copyProfileData(s, 'a', 'c').ok).toBe(false)
    expect(profileDataSummary(s, 'c')).toMatchObject({ mounts: null, bytes: 0 })
    s.quota = null
    // « a » ne touche pas « ab ».
    expect(removeProfileData(s, 'a')).toHaveLength(3)
    expect(s.getItem(profileStoreKey('ab', 'inventory'))).not.toBeNull()
    expect(serverMarketMeta(s, 't')).toEqual({ exportDate: '2026-10-02', importedAt: 5, source: 'x.csv', useful: 1022, serverName: 'Tylezia' })
    expect(serverMarketMeta(s, 'autre')).toBeNull()
    expect(removeServerData(s, 't')).toEqual([serverStoreKey('t', 'market')])
  })
})
