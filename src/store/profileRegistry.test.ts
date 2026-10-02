// Registre des profils et des serveurs (pur) : démarrage, migration des données d'avant les profils
// (idempotente, sûre en cas de quota plein), reconstruction d'un registre illisible, opérations.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROFILE_ID,
  acknowledgeLegacyKeys,
  addProfile,
  addServer,
  bootProfiles,
  copyProfileData,
  defaultRegistry,
  fingerprintOf,
  freeId,
  legacyDivergence,
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
  resolveOpenProfile,
  sanitizeRegistry,
  serverMarketMeta,
  setActiveProfile,
  setProfileServer,
  setServerOptions,
  type LegacyCopyInfo,
  type ProfilesRegistry,
} from './profileRegistry'
import { PROFILES_CORRUPT_KEY, PROFILES_KEY, PROFILES_SHADOW_KEY, parseStoreKey, persistedStoreInfo, profileStoreKey, serverStoreKey, storeKeysFor, type StorageLike } from './schema'

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
    expect(reg.legacy).toMatchObject({
      migratedAt: NOW,
      keys: ['elevagesimu:inventory', 'elevagesimu:journal', 'elevagesimu:montures-ui', 'elevagesimu:prices', 'elevagesimu:settings'],
      moved: [],
      removedAt: 0,
    })
    // Empreinte de chaque ancienne clé copiée (détection d'une écriture ultérieure de l'ancienne version).
    expect(Object.keys(reg.legacy?.fingerprints ?? {}).sort()).toEqual(reg.legacy?.keys)
    expect(reg.legacy?.fingerprints?.['elevagesimu:inventory']).toEqual(fingerprintOf(before.get('elevagesimu:inventory') as string))
    // Copie de secours du registre.
    expect(s.getItem(PROFILES_SHADOW_KEY)).toBe(s.getItem(PROFILES_KEY))
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
    const shadow = (probe.getItem(PROFILES_SHADOW_KEY) ?? '').length + PROFILES_SHADOW_KEY.length
    const C = probe.used() - used0 - R - shadow
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
    // Alerte dédiée (« Profils non activés »), sans « Réessayer d'enregistrer » qui ne peut pas aider.
    expect(b.issues[0].kind).toBe('migration')
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
    expect(profileDataSummary(s, 'c')).toMatchObject({ mounts: null, chars: 0 })
    s.quota = null
    // « a » ne touche pas « ab ».
    expect(removeProfileData(s, 'a')).toHaveLength(3)
    expect(s.getItem(profileStoreKey('ab', 'inventory'))).not.toBeNull()
    expect(serverMarketMeta(s, 't')).toEqual({ exportDate: '2026-10-02', importedAt: 5, source: 'x.csv', useful: 1022, serverName: 'Tylezia' })
    expect(serverMarketMeta(s, 'autre')).toBeNull()
    expect(removeServerData(s, 't')).toEqual([serverStoreKey('t', 'market')])
  })
})

describe('reprise : onglet resté sur l’ancienne version (DI-05)', () => {
  it('une ancienne clé réécrite après la reprise est repérée (empreinte), une nouvelle aussi ; « ignorer » les rend supprimables', () => {
    const s = legacyStorage()
    const b = bootProfiles(s, NOW)
    expect(legacyDivergence(s, b.registry)).toEqual([])
    // L'onglet v1 enregistre encore : clé existante modifiée, et nouvelle ancienne clé.
    s.setItem('elevagesimu:inventory', store({ mounts: [{ id: 'CAPTURE-APRES-MIGRATION' }] }))
    s.setItem('elevagesimu:paddocks', store({ paddocks: [] }))
    expect(legacyDivergence(s, b.registry)).toEqual(['elevagesimu:inventory', 'elevagesimu:paddocks'])
    // Empreintes relues après un rechargement (registre enregistré).
    const again = bootProfiles(s, NOW + 1)
    expect(legacyDivergence(s, again.registry)).toEqual(['elevagesimu:inventory', 'elevagesimu:paddocks'])
    const acked = acknowledgeLegacyKeys(s, again.registry, ['elevagesimu:inventory', 'elevagesimu:paddocks'])
    expect(legacyDivergence(s, acked)).toEqual([])
    expect(acked.legacy?.keys).toContain('elevagesimu:paddocks')
    // Copie supprimée : plus rien à signaler.
    expect(legacyDivergence(s, { ...acked, legacy: { ...(acked.legacy as LegacyCopyInfo), removedAt: NOW } })).toEqual([])
  })

  it('une clé déplacée (faute de place) puis réécrite par l’ancienne version est repérée', () => {
    const reg: ProfilesRegistry = { ...defaultRegistry(NOW), legacy: { migratedAt: NOW, keys: ['elevagesimu:journal'], moved: ['elevagesimu:journal'], removedAt: 0, fingerprints: {} } }
    const s = new FakeStorage({ 'elevagesimu:journal': store({ entries: [] }) })
    expect(legacyDivergence(s, reg)).toEqual(['elevagesimu:journal'])
  })
})

describe('profil de chaque onglet (DI-04)', () => {
  it('le profil choisi dans l’onglet s’il existe, sinon le profil par défaut du registre (signalé)', () => {
    const p = addProfile(defaultRegistry(NOW, 'Tylezia'), { name: 'Alt', serverId: 'tylezia', now: NOW })
    if (!p.ok) throw new Error(p.error)
    expect(resolveOpenProfile(p.registry, 'alt')).toEqual({ profile: expect.objectContaining({ id: 'alt' }), missing: null })
    expect(p.registry.activeProfileId).toBe('principal')
    expect(resolveOpenProfile(p.registry, null).profile.id).toBe('principal')
    expect(resolveOpenProfile(p.registry, 'supprime')).toEqual({ profile: expect.objectContaining({ id: 'principal' }), missing: 'supprime' })
  })
})

describe('registre perdu ou illisible (DI-09)', () => {
  const settingsWith = (server: string) => store({ jobLevel: 10, server }, 3)
  function twoProfiles(extra: Record<string, string> = {}) {
    return new FakeStorage({
      [profileStoreKey('principal', 'settings')]: settingsWith('Tylezia'),
      [profileStoreKey('principal', 'inventory')]: store({ mounts: [] }),
      [profileStoreKey('alt-jahash', 'settings')]: settingsWith('Jahash'),
      [serverStoreKey('tylezia', 'prices')]: store({ items: { '33515': 27000 } }),
      [serverStoreKey('jahash', 'prices')]: store({ items: { '33515': 11111 } }),
      ...extra,
    })
  }

  it('registre absent alors que deux profils ont des données : les deux sont reconstruits (pas un registre neuf)', () => {
    const s = twoProfiles()
    const b = bootProfiles(s, NOW)
    expect(b.mode).toBe('profiles')
    expect(b.registry.profiles.map((p) => `${p.id}@${p.serverId}`)).toEqual(['alt-jahash@jahash', 'principal@tylezia'])
    expect(b.registry.servers.map((x) => x.name).sort()).toEqual(['Jahash', 'Tylezia'])
    expect(b.issues[0]).toMatchObject({ kind: 'corrige', message: expect.stringMatching(/absent : 2 profils reconstruits/) })
    expect(JSON.parse(s.getItem(PROFILES_KEY) ?? 'null').profiles).toHaveLength(2)
  })

  it('registre absent, copie d’avant les profils présente : pas de nouvelle migration par-dessus les profils', () => {
    const s = twoProfiles({ 'elevagesimu:inventory': store({ mounts: [{ id: 'v1' }] }) })
    const b = bootProfiles(s, NOW)
    expect(b.migrated).toBe(false)
    expect(b.registry.profiles.map((p) => p.id)).toEqual(['alt-jahash', 'principal'])
    // La copie reste signalée (et supprimable) dans les Réglages.
    expect(b.registry.legacy?.keys).toEqual(['elevagesimu:inventory'])
    expect(s.getItem(profileStoreKey('principal', 'inventory'))).toBe(store({ mounts: [] }))
  })

  it('registre absent, anciennes données jamais reprises et un autre profil : « Principal » ajouté et migré, l’autre profil gardé', () => {
    const s = new FakeStorage({
      [profileStoreKey('alt', 'settings')]: settingsWith('Jahash'),
      [serverStoreKey('jahash', 'prices')]: store({ items: {} }),
      'elevagesimu:settings': store({ jobLevel: 87, server: 'Salar' }, 3),
      'elevagesimu:inventory': store({ mounts: [{ id: 'v1' }] }),
    })
    const b = bootProfiles(s, NOW)
    expect(b.migrated).toBe(true)
    expect(b.registry.profiles.map((p) => `${p.id}@${p.serverId}`).sort()).toEqual(['alt@jahash', 'principal@salar'])
    expect(s.getItem(profileStoreKey('principal', 'inventory'))).toBe(store({ mounts: [{ id: 'v1' }] }))
  })

  it('registre illisible + copie de secours : noms, couleurs, serveurs (renommés) et options gardés', () => {
    const shadow: ProfilesRegistry = {
      version: 1,
      activeProfileId: 'alt-jahash',
      profiles: [
        { id: 'principal', name: 'Mon main', serverId: 'tylezia', createdAt: 5, color: 'gold' },
        { id: 'alt-jahash', name: 'Alt Jahash', serverId: 'jahash', createdAt: 6 },
      ],
      servers: [
        { id: 'tylezia', name: 'Draconiros', createdAt: 1, priceStat: 'median30', maxMarketShare: 0.2 },
        { id: 'jahash', name: 'Jahash', createdAt: 2, priceStat: 'auto', maxMarketShare: 0.15 },
      ],
    }
    const s = twoProfiles({ [PROFILES_KEY]: '{ cassé', [PROFILES_SHADOW_KEY]: JSON.stringify(shadow) })
    s.setItem(profileStoreKey('principal', 'settings'), settingsWith('Draconiros'))
    const b = bootProfiles(s, NOW)
    expect(b.registry.profiles).toEqual(shadow.profiles)
    expect(b.registry.servers).toEqual(shadow.servers)
    expect(b.registry.activeProfileId).toBe('alt-jahash')
    expect(b.issues[0].message).toMatch(/copie de secours/)
    expect(s.getItem(PROFILES_CORRUPT_KEY)).toBe('{ cassé')
  })

  it('serveur introuvable d’après les réglages : rattaché au premier serveur ET signalé « à vérifier » (jamais en silence)', () => {
    const s = twoProfiles({ [PROFILES_KEY]: '{ cassé' })
    s.setItem(profileStoreKey('principal', 'settings'), settingsWith('Draconiros'))
    const b = bootProfiles(s, NOW)
    const principal = b.registry.profiles.find((p) => p.id === 'principal')
    expect(principal).toMatchObject({ serverId: 'jahash', serverToCheck: true })
    expect(b.registry.profiles.find((p) => p.id === 'alt-jahash')?.serverToCheck).toBeUndefined()
    expect(b.issues.map((i) => i.message).join(' ')).toMatch(/Serveur deviné pour « Principal » → Jahash/)
    // Le joueur choisit (ou confirme) le serveur : marque effacée, et gardée par la normalisation sinon.
    expect(sanitizeRegistry(b.registry).registry?.profiles.find((p) => p.id === 'principal')?.serverToCheck).toBe(true)
    const fixed = setProfileServer(b.registry, 'principal', 'tylezia')
    expect(fixed.ok && fixed.registry.profiles.find((p) => p.id === 'principal')).toEqual(expect.not.objectContaining({ serverToCheck: true }))
  })

  it('la copie de secours suit chaque démarrage avec un registre lisible', () => {
    const s = new FakeStorage()
    bootProfiles(s, NOW)
    expect(s.getItem(PROFILES_SHADOW_KEY)).toBe(s.getItem(PROFILES_KEY))
    const reg = { ...defaultRegistry(NOW, 'Tylezia') }
    s.setItem(PROFILES_KEY, JSON.stringify(reg))
    bootProfiles(s, NOW + 1)
    expect(s.getItem(PROFILES_SHADOW_KEY)).toBe(JSON.stringify(reg))
    // La copie de secours est une clé globale (jamais prise pour une ancienne donnée à migrer).
    expect(legacyKeys(s)).toEqual([])
  })
})

describe('migration près du quota (DI-10)', () => {
  it('un déplacement qui ne tient pas (clé plus longue) libère de la place en déplaçant une copie déjà faite', () => {
    const val = (n: number) => 'x'.repeat(n)
    const s = new FakeStorage({
      'elevagesimu:inventory': val(8002),
      'elevagesimu:journal': val(20032),
      'elevagesimu:paddocks': val(15032),
      'elevagesimu:prices': val(12032),
      'elevagesimu:settings': store({ jobLevel: 1 }, 3),
    })
    // Place pour la copie de l'inventaire et ≈ 30 caractères de plus.
    s.quota = s.used() + 'elevagesimu:p:principal:inventory'.length + 8002 + 30
    const before = new Map(s.map)
    const m = migrateLegacyStorage(s, NOW)
    expect(m.ok).toBe(true)
    if (!m.ok) return
    expect(m.moved).toContain('elevagesimu:inventory')
    expect(m.moved).toEqual(expect.arrayContaining(['elevagesimu:journal', 'elevagesimu:paddocks', 'elevagesimu:prices']))
    for (const [k, v] of before) {
      const target = k === 'elevagesimu:prices' ? serverStoreKey('mon-serveur', 'prices') : profileStoreKey('principal', k.slice('elevagesimu:'.length))
      expect(s.getItem(target)).toBe(v)
    }
    expect(JSON.parse(s.getItem(PROFILES_KEY) ?? 'null').legacy.moved).toEqual([...m.moved].sort())
    expect(bootProfiles(s, NOW + 1).mode).toBe('profiles')
  })
})
