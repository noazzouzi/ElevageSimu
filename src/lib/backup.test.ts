import { describe, expect, it } from 'vitest'
import { bootProfiles, legacyDivergence } from '../store/profileRegistry'
import { DEFAULT_SETTINGS, PROFILES_SHADOW_KEY } from '../store/schema'
import {
  BACKUP_APP,
  BACKUP_VERSION,
  KNOWN_STORES,
  STORE_VERSIONS,
  appKeys,
  backupFileName,
  exportAll,
  exportProfile,
  importAll,
  isAppKey,
  isRegenerableKey,
  mergePriceStates,
  parseBackup,
  planProfileServer,
  removeRegenerableData,
  resetAll,
  serializeBackup,
  TYPICAL_STORAGE_QUOTA_CHARS,
  WEBKIT_STORAGE_QUOTA_CHARS,
  storageQuotaChars,
  storageUsage,
  storeLabel,
  summarizeBackup,
  validateBackup,
  type BackupFile,
  type StorageLike,
} from './backup'

const CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/** Faux localStorage (ordre d'insertion, comme un navigateur). */
class FakeStorage implements StorageLike {
  map = new Map<string, string>()
  /** Quota (en caractères, clés + valeurs) au-delà duquel setItem lève QuotaExceededError. */
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
  snapshot() {
    return Object.fromEntries(this.map)
  }
}

// Données telles que l'application les enregistre (version actuelle, champs complets).
const settings = { state: { ...DEFAULT_SETTINGS, jobLevel: 87, jobLevelUpdatedAt: 1_790_000_000_000, server: 'Salar' }, version: STORE_VERSIONS['elevagesimu:settings'] }
/** Monture complète (Muldo Doré G1 = espèce 94). */
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
const inventory = { state: { mounts: [mountOf('m-1'), mountOf('m-2', { gender: 'femelle' }), mountOf('m-3')] }, version: 1 }

function sampleStorage() {
  return new FakeStorage({
    'elevagesimu:settings': JSON.stringify(settings),
    'elevagesimu:inventory': JSON.stringify(inventory),
    'elevagesimu:metier': JSON.stringify({ tab: 'plan' }),
    'autre-site:token': 'secret',
    elevagesimu: 'sans deux-points',
    'elevagesimu:': 'préfixe seul',
  })
}

describe('filtrage des clés', () => {
  it('ne retient que les clés « elevagesimu:xxx », triées', () => {
    expect(isAppKey('elevagesimu:settings')).toBe(true)
    expect(isAppKey('elevagesimu:')).toBe(false)
    expect(isAppKey('elevagesimu')).toBe(false)
    expect(isAppKey('autre:elevagesimu:x')).toBe(false)
    expect(isAppKey(null)).toBe(false)
    expect(appKeys(sampleStorage())).toEqual(['elevagesimu:inventory', 'elevagesimu:metier', 'elevagesimu:settings'])
  })

  it('renvoie une liste vide sans stockage', () => {
    expect(appKeys(null)).toEqual([])
    expect(storageUsage(null)).toEqual({ totalChars: 0, entries: [] })
  })

  it('donne un libellé lisible aux clés connues et inconnues', () => {
    expect(storeLabel('elevagesimu:inventory')).toMatch(/Montures/)
    expect(storeLabel('elevagesimu:metier')).toMatch(/Métier/)
    expect(storeLabel('elevagesimu:nouvelle-page')).toBe('Préférences (nouvelle-page)')
  })
})

describe('exportAll', () => {
  it('exporte les valeurs décodées des seules clés de l’application', () => {
    const b = exportAll(sampleStorage(), new Date('2026-10-02T12:00:00Z'))
    expect(b.app).toBe(BACKUP_APP)
    expect(b.version).toBe(BACKUP_VERSION)
    expect(b.exportedAt).toBe('2026-10-02T12:00:00.000Z')
    expect(Object.keys(b.stores).sort()).toEqual(['elevagesimu:inventory', 'elevagesimu:metier', 'elevagesimu:settings'])
    expect(b.stores['elevagesimu:settings']).toEqual(settings)
    expect(b.raw).toBeUndefined()
    expect(JSON.stringify(b)).not.toContain('secret')
  })

  it('exporte les modifications non enregistrées (quota plein) à la place de la valeur stockée', () => {
    const s = sampleStorage()
    const newer = JSON.stringify({ state: { mounts: [mountOf('m-9')] }, version: 1 })
    const b = exportAll(s, new Date('2026-10-02T12:00:00Z'), { 'elevagesimu:inventory': newer, 'autre:cle': '1' })
    expect((b.stores['elevagesimu:inventory'] as { state: { mounts: { id: string }[] } }).state.mounts.map((m) => m.id)).toEqual(['m-9'])
    expect(b.stores).not.toHaveProperty('autre:cle')
  })

  it('conserve telles quelles les valeurs qui ne sont pas du JSON', () => {
    const s = new FakeStorage({ 'elevagesimu:note': 'pas du {json' })
    const b = exportAll(s)
    expect(b.stores).toEqual({})
    expect(b.raw).toEqual({ 'elevagesimu:note': 'pas du {json' })
  })
})

describe('validateBackup / parseBackup', () => {
  const valid = () => exportAll(sampleStorage(), new Date('2026-10-02T12:00:00Z'))

  it('accepte une sauvegarde valide', () => {
    const v = validateBackup(valid())
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.keys).toEqual(['elevagesimu:inventory', 'elevagesimu:metier', 'elevagesimu:settings'])
      expect(v.warnings).toEqual([])
    }
  })

  it.each([
    ['un tableau', []],
    ['null', null],
    ['un nombre', 42],
  ])('refuse %s', (_label, data) => {
    const v = validateBackup(data)
    expect(v.ok).toBe(false)
  })

  it('refuse un fichier d’une autre application', () => {
    const v = validateBackup({ ...valid(), app: 'AutreOutil' })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.error).toMatch(/AutreOutil/)
    expect(validateBackup({ version: 1, stores: {} }).ok).toBe(false)
  })

  it('refuse une version invalide ou plus récente', () => {
    expect(validateBackup({ ...valid(), version: 0 }).ok).toBe(false)
    expect(validateBackup({ ...valid(), version: 1.5 }).ok).toBe(false)
    expect(validateBackup({ ...valid(), version: '1' }).ok).toBe(false)
    const newer = validateBackup({ ...valid(), version: BACKUP_VERSION + 1 })
    expect(newer.ok).toBe(false)
    if (!newer.ok) expect(newer.error).toMatch(/plus récente/)
  })

  it('refuse une section stores absente ou un store connu mal formé', () => {
    expect(validateBackup({ app: BACKUP_APP, version: 1, exportedAt: '2026-10-02T12:00:00Z' }).ok).toBe(false)
    const bad = validateBackup({ ...valid(), stores: { 'elevagesimu:inventory': { mounts: [] } } })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toMatch(/Montures/)
    expect(validateBackup({ ...valid(), stores: { 'elevagesimu:settings': { state: {}, version: 'deux' } } }).ok).toBe(false)
    expect(validateBackup({ ...valid(), stores: {}, raw: { 'elevagesimu:settings': '{oups' } }).ok).toBe(false)
  })

  it('ignore (avec avertissement) les clés étrangères', () => {
    const v = validateBackup({ ...valid(), stores: { ...valid().stores, 'autre:cle': 1, 'elevagesimu:': 2 } })
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.keys).not.toContain('autre:cle')
      expect(v.backup.stores).not.toHaveProperty('autre:cle')
      expect(v.warnings.join(' ')).toMatch(/2 données étrangères/)
    }
  })

  it('signale une sauvegarde vide et une date illisible', () => {
    const v = validateBackup({ app: BACKUP_APP, version: 1, exportedAt: 'hier', stores: {} })
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.keys).toEqual([])
      expect(v.warnings.join(' ')).toMatch(/vide/)
      expect(v.warnings.join(' ')).toMatch(/Date/)
      expect(v.backup.exportedAt).toBe('')
    }
  })

  it('refuse un store enregistré par une version plus récente de l’application (rien n’est importé)', () => {
    const v = validateBackup({ ...valid(), stores: { ...valid().stores, 'elevagesimu:inventory': { ...inventory, version: 99 } } })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.error).toMatch(/plus récente/)
    const target = new FakeStorage()
    expect(importAll({ ...valid(), stores: { 'elevagesimu:inventory': { ...inventory, version: STORE_VERSIONS['elevagesimu:inventory'] + 1 } } }, { storage: target, reload: false }).ok).toBe(false)
    expect(appKeys(target)).toEqual([])
  })

  it('migre un store d’une version plus ancienne (réglages v2 → version actuelle)', () => {
    const old = { state: { ruleset: '3.6', jobLevel: 87, server: 'Salar' }, version: 2 }
    const v = validateBackup({ ...valid(), stores: { 'elevagesimu:settings': old } })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const st = v.backup.stores['elevagesimu:settings'] as { state: Record<string, unknown>; version: number }
    expect(st.version).toBe(STORE_VERSIONS['elevagesimu:settings'])
    expect(st.state.jobLevel).toBe(87)
    expect(st.state.server).toBe('Salar')
    expect(st.state.family).toBe(DEFAULT_SETTINGS.family)
    // Niveau saisi avant la migration : daté de la migration (l'XP du journal antérieure n'est pas recomptée).
    expect(typeof st.state.jobLevelUpdatedAt).toBe('number')
    expect(st.state.jobLevelUpdatedAt as number).toBeGreaterThan(0)
  })

  it('normalise les montures mal formées, avec avertissements (au lieu de faire planter les pages)', () => {
    const mounts = [
      mountOf('ok'),
      { id: 'sans-espece' },
      mountOf('inconnue', { speciesId: 999_999 }),
      mountOf('cassee', { location: undefined, parents: undefined, gender: 'x', level: 999, serenity: -99_999 }),
      mountOf('ok'),
    ]
    const v = validateBackup({ ...valid(), stores: { 'elevagesimu:inventory': { state: { mounts }, version: 1 } } })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const out = (v.backup.stores['elevagesimu:inventory'] as { state: { mounts: Record<string, unknown>[] } }).state.mounts
    expect(out).toHaveLength(3)
    const fixed = out.find((m) => m.id === 'cassee')
    expect(fixed).toMatchObject({ location: { kind: 'etable' }, parents: [], gender: 'male', level: 200, serenity: -5_000 })
    // L'identifiant en double est renouvelé (sinon modifier l'une modifierait l'autre).
    expect(new Set(out.map((m) => m.id)).size).toBe(3)
    const w = v.warnings.join(' ')
    expect(w).toMatch(/2 montures inutilisables ignorées/)
    expect(w).toMatch(/montures corrigées/)
    expect(summarizeBackup(v.backup).find((l) => l.key === 'elevagesimu:inventory')?.detail).toBe('3 montures')
  })

  it('accepte des montures sous forme d’objet, et une liste illisible devient vide avec avertissement', () => {
    const asObject = validateBackup({ ...valid(), stores: { 'elevagesimu:inventory': { state: { mounts: { a: mountOf('a') } }, version: 1 } } })
    expect(asObject.ok && (asObject.backup.stores['elevagesimu:inventory'] as { state: { mounts: unknown[] } }).state.mounts).toHaveLength(1)
    const broken = validateBackup({ ...valid(), stores: { 'elevagesimu:inventory': { state: { mounts: 42 }, version: 1 } } })
    expect(broken.ok).toBe(true)
    if (broken.ok) expect(broken.warnings.join(' ')).toMatch(/illisible/)
  })

  it('normalise des réglages invalides (famille inconnue, palier hors liste, niveau hors bornes)', () => {
    const bad = { state: { ...settings.state, family: 'dinde', preferredTier: 9, jobLevel: 500, ruleset: '9.9', saleTax: 'beaucoup' }, version: settings.version }
    const v = validateBackup({ ...valid(), stores: { 'elevagesimu:settings': bad } })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const st = (v.backup.stores['elevagesimu:settings'] as { state: Record<string, unknown> }).state
    expect(st).toMatchObject({ family: DEFAULT_SETTINGS.family, preferredTier: DEFAULT_SETTINGS.preferredTier, jobLevel: 200, ruleset: DEFAULT_SETTINGS.ruleset, saleTax: DEFAULT_SETTINGS.saleTax, server: 'Salar' })
    expect(v.warnings.join(' ')).toMatch(/Réglages : 5 réglages invalides corrigés/)
  })

  it('retire un prix invalide au lieu de le compter comme 0', () => {
    const prices = { state: { items: { '1': 10, '2': -5, '3': 'cher', '4': null }, mounts: [], generations: {}, genetonValue: 'x', updatedAt: 3 }, version: 1 }
    const v = validateBackup({ ...valid(), stores: { 'elevagesimu:prices': prices } })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const st = (v.backup.stores['elevagesimu:prices'] as { state: Record<string, unknown> }).state
    expect(st.items).toEqual({ '1': 10 })
    expect(st.genetonValue).toBeNull()
    expect(v.warnings.join(' ')).toMatch(/prix invalides retirés/)
  })

  it('reprend un store sans migration déclarée d’une version plus ancienne (au lieu de le laisser ignorer au chargement)', () => {
    const v = validateBackup({ ...valid(), stores: { 'elevagesimu:paddocks': { state: { paddocks: [] }, version: 0 } } })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect((v.backup.stores['elevagesimu:paddocks'] as { version: number }).version).toBe(STORE_VERSIONS['elevagesimu:paddocks'])
    expect(v.warnings.join(' ')).toMatch(/format v0 repris/)
  })

  it('reconnaît et vérifie l’avancement du plan (planProgress)', () => {
    expect(KNOWN_STORES['elevagesimu:planProgress']).toBeDefined()
    expect(storeLabel('elevagesimu:planProgress')).not.toMatch(/^Préférences/)
    expect(validateBackup({ ...valid(), stores: { 'elevagesimu:planProgress': { checked: {} } } }).ok).toBe(false)
    const v = validateBackup({ ...valid(), stores: { 'elevagesimu:planProgress': { state: { checked: { a: 1, b: 2 }, done: { c: 3 } }, version: 1 } } })
    expect(v.ok && summarizeBackup(v.backup)[0].detail).toBe('2 cases cochées, 1 conseil fait')
  })

  it('refuse un texte qui n’est pas du JSON', () => {
    const v = parseBackup('{ pas du json')
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.error).toMatch(/JSON/)
    expect(parseBackup(serializeBackup(valid())).ok).toBe(true)
  })
})

describe('importAll', () => {
  it('remplace : l’état local devient celui de la sauvegarde, sans toucher aux autres sites', () => {
    const source = sampleStorage()
    const backup = exportAll(source)
    const target = new FakeStorage({
      'elevagesimu:journal': JSON.stringify({ state: { entries: [1, 2] }, version: 1 }),
      'elevagesimu:settings': JSON.stringify({ state: { jobLevel: 1 }, version: 2 }),
      'autre-site:pref': 'x',
    })
    const r = importAll(serializeBackup(backup), { mode: 'replace', storage: target, reload: false })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.removed).toEqual(['elevagesimu:journal'])
      expect(r.written).toEqual(['elevagesimu:inventory', 'elevagesimu:metier', 'elevagesimu:settings'])
    }
    expect(target.getItem('elevagesimu:journal')).toBeNull()
    expect(JSON.parse(target.getItem('elevagesimu:settings') ?? 'null')).toEqual(settings)
    expect(target.getItem('autre-site:pref')).toBe('x')
  })

  it('fusionne : garde les clés absentes de la sauvegarde', () => {
    const backup = exportAll(new FakeStorage({ 'elevagesimu:settings': JSON.stringify(settings) }))
    const target = new FakeStorage({ 'elevagesimu:journal': JSON.stringify({ state: { entries: [] }, version: 1 }) })
    const r = importAll(backup, { mode: 'merge', storage: target, reload: false })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.removed).toEqual([])
    expect(appKeys(target)).toEqual(['elevagesimu:journal', 'elevagesimu:settings'])
  })

  it('aller-retour export → import : données identiques, valeurs brutes comprises', () => {
    const source = sampleStorage()
    source.setItem('elevagesimu:brut', 'texte libre')
    const target = new FakeStorage()
    const r = importAll(serializeBackup(exportAll(source)), { storage: target, reload: false })
    expect(r.ok).toBe(true)
    for (const k of appKeys(source)) expect(target.getItem(k)).toBe(source.getItem(k))
    expect(appKeys(target)).toEqual(appKeys(source))
  })

  it('n’écrit rien si la sauvegarde est invalide', () => {
    const target = sampleStorage()
    const before = target.snapshot()
    const r = importAll('{"app":"ElevageSimu","version":99,"stores":{}}', { storage: target, reload: false })
    expect(r.ok).toBe(false)
    expect(target.snapshot()).toEqual(before)
  })

  it('restaure l’état précédent si le quota est dépassé en cours d’écriture', () => {
    const backup = exportAll(sampleStorage())
    const target = new FakeStorage({
      'elevagesimu:journal': JSON.stringify({ state: { entries: [1] }, version: 1 }),
      'elevagesimu:settings': JSON.stringify({ state: { jobLevel: 5 }, version: 2 }),
    })
    const before = target.snapshot()
    // L'état actuel tient tout juste ; la sauvegarde (plus grosse) ne tient pas.
    target.quota = target.used()
    const r = importAll(backup, { mode: 'replace', storage: target, reload: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/insuffisant/)
    expect(target.snapshot()).toEqual(before)
  })

  it('échoue proprement sans stockage', () => {
    expect(importAll(exportAll(sampleStorage()), { storage: null, reload: false }).ok).toBe(false)
  })
})

describe('resetAll', () => {
  it('efface uniquement les clés de l’application (sauf celles à garder)', () => {
    const s = sampleStorage()
    const removed = resetAll({ storage: s, keep: ['elevagesimu:metier'], reload: false })
    expect(removed).toEqual(['elevagesimu:inventory', 'elevagesimu:settings'])
    expect(appKeys(s)).toEqual(['elevagesimu:metier'])
    expect(s.getItem('autre-site:token')).toBe('secret')
    expect(resetAll({ storage: s, reload: false })).toEqual(['elevagesimu:metier'])
    expect(appKeys(s)).toEqual([])
  })
})

describe('storageUsage', () => {
  it('compte des CARACTÈRES (clé + valeur, l’unité du quota de Chrome, Edge et Firefox), du plus gros au plus petit', () => {
    const s = new FakeStorage({ 'elevagesimu:a': 'xx', 'elevagesimu:bb': 'xxxxxxxx', 'autre:c': 'zzzzzzzzzzzz' })
    const u = storageUsage(s)
    expect(u.entries.map((e) => e.key)).toEqual(['elevagesimu:bb', 'elevagesimu:a'])
    expect(u.entries[0].chars).toBe('elevagesimu:bb'.length + 8)
    expect(u.totalChars).toBe('elevagesimu:a'.length + 2 + 'elevagesimu:bb'.length + 8)
    // 2,6 millions de caractères = la moitié de la limite de Chrome (et pas 100 %).
    expect(TYPICAL_STORAGE_QUOTA_CHARS).toBe(5 * 1024 * 1024)
    expect((2.6e6 / storageQuotaChars(CHROME_UA)) * 100).toBeCloseTo(49.6, 0)
  })

  it('limite du navigateur : Chrome, Edge, Firefox ≈ 5,2 M caractères ; Safari et iPhone moitié moins', () => {
    expect(storageQuotaChars(CHROME_UA)).toBe(TYPICAL_STORAGE_QUOTA_CHARS)
    expect(storageQuotaChars('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0')).toBe(TYPICAL_STORAGE_QUOTA_CHARS)
    expect(storageQuotaChars('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0')).toBe(TYPICAL_STORAGE_QUOTA_CHARS)
    expect(storageQuotaChars('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15')).toBe(WEBKIT_STORAGE_QUOTA_CHARS)
    expect(storageQuotaChars('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1')).toBe(WEBKIT_STORAGE_QUOTA_CHARS)
  })
})

describe('summarizeBackup', () => {
  it('décrit le contenu des stores connus', () => {
    const s = sampleStorage()
    s.setItem('elevagesimu:prices', JSON.stringify({ state: { items: { '1': 10, '2': 20 }, mounts: { '94|1': 5 }, generations: {}, genetonValue: 375 }, version: 1 }))
    s.setItem('elevagesimu:journal', JSON.stringify({ state: { entries: [{}] }, version: 1 }))
    const lines = summarizeBackup(exportAll(s))
    const byKey = Object.fromEntries(lines.map((l) => [l.key, l.detail]))
    expect(byKey['elevagesimu:inventory']).toBe('3 montures')
    expect(byKey['elevagesimu:journal']).toBe('1 entrée')
    expect(byKey['elevagesimu:prices']).toBe('2 prix d’objets, 1 prix de monture, valeur du généton')
    expect(byKey['elevagesimu:settings']).toBe('règles 3.6, Éleveur niv. 87, serveur Salar')
    expect(byKey['elevagesimu:metier']).toBeNull()
  })
})

describe('backupFileName', () => {
  it('produit un nom daté en heure locale', () => {
    expect(backupFileName(new Date(2026, 9, 2, 14, 5))).toBe('elevagesimu-sauvegarde-2026-10-02-14h05.json')
  })
})

// ---------- v2 : profils et serveurs ----------

const REG = {
  version: 1,
  activeProfileId: 'alpha',
  profiles: [
    { id: 'alpha', name: 'Alpha', serverId: 'tylezia', createdAt: 1 },
    { id: 'beta', name: 'Beta', serverId: 'salar', createdAt: 2 },
  ],
  servers: [
    { id: 'tylezia', name: 'Tylezia', createdAt: 1, priceStat: 'auto', maxMarketShare: 0.15 },
    { id: 'salar', name: 'Salar', createdAt: 1, priceStat: 'median30', maxMarketShare: 0.15 },
  ],
}
const pricesOf = (p: number) => JSON.stringify({ state: { items: { '1844': p }, mounts: {}, generations: {}, genetonValue: null, updatedAt: 1 }, version: 1 })
const market = JSON.stringify({ state: { snapshot: { format: 'elevagesimu-hdv', version: 1, serverName: 'Tylezia', exportDate: '2026-10-02', importedAt: 5, source: 'x.csv', rows: { '1844': [17, 18, 28, 39154, 366066, 1554575, 880925] }, names: {}, stats: { lines: 1, read: 1, ignored: 0, invalid: 0, duplicates: 0, relevant: 1, recognized: 1, useful: 1, coverage: [], missing: [], missingCount: 0 } } }, version: 1 })

function v2Storage() {
  return new FakeStorage({
    'elevagesimu:profiles': JSON.stringify(REG),
    'elevagesimu:p:alpha:settings': JSON.stringify(settings),
    'elevagesimu:p:alpha:inventory': JSON.stringify(inventory),
    'elevagesimu:p:alpha:metier': JSON.stringify({ tab: 'plan' }),
    'elevagesimu:p:beta:inventory': JSON.stringify({ state: { mounts: [mountOf('b-1')] }, version: 1 }),
    'elevagesimu:s:tylezia:prices': pricesOf(30),
    'elevagesimu:s:tylezia:market': market,
    'elevagesimu:s:salar:prices': pricesOf(99),
    'elevagesimu:enclos-notifications': 'oui',
  })
}

describe('sauvegardes v2 (profils et serveurs)', () => {
  it('tout : registre, profils, serveurs ; aller-retour identique ; libellés avec les noms', () => {
    const source = v2Storage()
    const b = exportAll(source, new Date('2026-10-02T12:00:00Z'))
    expect(b.version).toBe(2)
    expect(b.scope).toEqual({ kind: 'all' })
    const v = validateBackup(JSON.parse(serializeBackup(b)))
    expect(v.ok && v.warnings).toEqual([])
    const target = new FakeStorage({ 'elevagesimu:p:vieux:inventory': '{}' })
    const r = importAll(b, { storage: target, reload: false })
    expect(r.ok).toBe(true)
    for (const k of appKeys(source)) expect(target.getItem(k)).toBe(source.getItem(k))
    expect(target.getItem('elevagesimu:p:vieux:inventory')).toBeNull()
    const lines = Object.fromEntries(summarizeBackup(b).map((l) => [l.key, l]))
    expect(lines['elevagesimu:profiles'].detail).toBe('2 profils, 2 serveurs')
    expect(lines['elevagesimu:p:alpha:inventory']).toMatchObject({ label: 'Montures (étable, enclos, inventaire) — profil Alpha', detail: '3 montures' })
    expect(lines['elevagesimu:s:tylezia:market']).toMatchObject({ label: 'Prix du marché (export HDV) — serveur Tylezia', detail: '1 objet, export du 02/10/2026' })
    expect(lines['elevagesimu:p:alpha:metier'].label).toBe('Préférences de la page Métier — profil Alpha')
    const usage = storageUsage(source)
    expect(usage.entries.find((e) => e.key === 'elevagesimu:s:salar:prices')?.label).toBe('Prix saisis — serveur Salar')
  })

  it('valide et normalise les stores de n’importe quel profil ou serveur ; refuse un registre plus récent', () => {
    const b = exportAll(v2Storage())
    const bad = { ...b, stores: { ...b.stores, 'elevagesimu:s:tylezia:prices': JSON.parse(pricesOf(-5)) } }
    const v = validateBackup(bad)
    expect(v.ok && v.warnings.join(' ')).toMatch(/Prix saisis — serveur tylezia : 1 prix invalide retiré/)
    expect(validateBackup({ ...b, stores: { ...b.stores, 'elevagesimu:p:alpha:inventory': { ...inventory, version: 99 } } }).ok).toBe(false)
    expect(validateBackup({ ...b, stores: { ...b.stores, 'elevagesimu:profiles': { ...REG, version: 5 } } }).ok).toBe(false)
    const unreadable = validateBackup({ ...b, stores: { ...b.stores, 'elevagesimu:profiles': 'cassé' } })
    expect(unreadable.ok && unreadable.warnings.join(' ')).toMatch(/Registre des profils illisible/)
    expect(validateBackup({ ...b, scope: { kind: 'profil' } }).ok).toBe(false)
  })

  it('un seul profil : ses données et celles de son serveur, sans les autres profils', () => {
    const b = exportProfile('alpha', v2Storage(), new Date('2026-10-02T12:00:00Z'))
    expect(b?.scope).toMatchObject({ kind: 'profile', profile: { id: 'alpha', name: 'Alpha' }, server: { id: 'tylezia', name: 'Tylezia' } })
    expect(Object.keys(b?.stores ?? {})).toEqual([
      'elevagesimu:p:alpha:inventory',
      'elevagesimu:p:alpha:metier',
      'elevagesimu:p:alpha:settings',
      'elevagesimu:s:tylezia:market',
      'elevagesimu:s:tylezia:prices',
    ])
    expect(exportProfile('inconnu', v2Storage())).toBeNull()
    expect(backupFileName(new Date(2026, 9, 2, 14, 5), 'Alpha')).toBe('elevagesimu-profil-alpha-2026-10-02-14h05.json')
    // Une clé d'un autre profil glissée dans le fichier est ignorée.
    const v = validateBackup({ ...b, stores: { ...b?.stores, 'elevagesimu:p:beta:inventory': {} } })
    expect(v.ok && v.keys).not.toContain('elevagesimu:p:beta:inventory')
  })

  it('restaurer un profil sur un autre appareil : profil et serveur créés, profil ouvert, autres profils intacts', () => {
    const b = exportProfile('alpha', v2Storage())
    const target = new FakeStorage({
      'elevagesimu:profiles': JSON.stringify({ ...REG, activeProfileId: 'beta', profiles: [REG.profiles[1]], servers: [REG.servers[1]] }),
      'elevagesimu:p:beta:inventory': JSON.stringify({ state: { mounts: [] }, version: 1 }),
    })
    const r = importAll(serializeBackup(b as BackupFile), { storage: target, reload: false })
    expect(r).toMatchObject({ ok: true, profileId: 'alpha' })
    const reg = JSON.parse(target.getItem('elevagesimu:profiles') ?? 'null')
    expect(reg.activeProfileId).toBe('alpha')
    expect(reg.profiles.map((p: { id: string }) => p.id)).toEqual(['beta', 'alpha'])
    expect(reg.servers.map((s: { id: string }) => s.id)).toEqual(['salar', 'tylezia'])
    expect(target.getItem('elevagesimu:p:alpha:inventory')).toBe(JSON.stringify(inventory))
    expect(target.getItem('elevagesimu:s:tylezia:prices')).toBe(pricesOf(30))
    expect(target.getItem('elevagesimu:p:beta:inventory')).not.toBeNull()
  })

  it('restaurer un profil existant le remplace ; le serveur existant garde ses prix ; « comme nouveau profil » crée une copie', () => {
    const b = exportProfile('alpha', v2Storage()) as BackupFile
    const target = v2Storage()
    target.setItem('elevagesimu:p:alpha:journal', JSON.stringify({ state: { entries: [] }, version: 1 }))
    target.setItem('elevagesimu:s:tylezia:prices', pricesOf(31))
    const r = importAll(b, { storage: target, reload: false })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings.join(' ')).toMatch(/Serveur « Tylezia » déjà présent/)
    expect(target.getItem('elevagesimu:p:alpha:journal')).toBeNull()
    expect(target.getItem('elevagesimu:s:tylezia:prices')).toBe(pricesOf(31))

    const copy = importAll(b, { storage: target, reload: false, asNewProfile: true })
    expect(copy).toMatchObject({ ok: true, profileId: 'alpha-2' })
    const reg = JSON.parse(target.getItem('elevagesimu:profiles') ?? 'null')
    expect(reg.profiles.find((p: { id: string }) => p.id === 'alpha-2')).toMatchObject({ name: 'Alpha (2)', serverId: 'tylezia' })
    expect(target.getItem('elevagesimu:p:alpha-2:inventory')).toBe(JSON.stringify(inventory))
    expect(target.getItem('elevagesimu:p:alpha:inventory')).toBe(JSON.stringify(inventory))
  })

  it('fusionner une sauvegarde complète : registres fusionnés, profil ouvert gardé ; une sauvegarde v1 va dans le profil ouvert', () => {
    const target = new FakeStorage({
      'elevagesimu:profiles': JSON.stringify({ ...REG, activeProfileId: 'gamma', profiles: [{ id: 'gamma', name: 'Gamma', serverId: 'salar', createdAt: 3 }], servers: [REG.servers[1]] }),
    })
    expect(importAll(exportAll(v2Storage()), { storage: target, mode: 'merge', reload: false }).ok).toBe(true)
    const reg = JSON.parse(target.getItem('elevagesimu:profiles') ?? 'null')
    expect(reg.activeProfileId).toBe('gamma')
    expect(reg.profiles.map((p: { id: string }) => p.id).sort()).toEqual(['alpha', 'beta', 'gamma'])

    const v1 = { app: BACKUP_APP, version: 1, exportedAt: '2026-01-01T00:00:00Z', stores: { 'elevagesimu:inventory': inventory, 'elevagesimu:prices': JSON.parse(pricesOf(7)), 'elevagesimu:montures-ui': { sort: 'x' } } }
    const r = importAll(v1, { storage: target, mode: 'merge', reload: false })
    expect(r.ok && r.warnings.join(' ')).toMatch(/3 données versées dans le profil « Gamma »/)
    expect(target.getItem('elevagesimu:p:gamma:inventory')).toBe(JSON.stringify(inventory))
    expect(target.getItem('elevagesimu:s:salar:prices')).toBe(pricesOf(7))
    expect(target.getItem('elevagesimu:p:gamma:montures-ui')).toBe(JSON.stringify({ sort: 'x' }))
    expect(target.getItem('elevagesimu:inventory')).toBeNull()
  })
})

// ---------- Revue v2 « données » (DI-01, DI-02, DI-08, DI-09, DI-12) ----------

const NOW = 1_790_000_000_000
const pricesState = (items: Record<string, number>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ state: { items, mounts: {}, generations: {}, genetonValue: null, updatedAt: 1, ...extra }, version: 1 })
const marketAt = (exportDate: string, importedAt: number) => {
  const m = JSON.parse(market) as { state: { snapshot: Record<string, unknown> }; version: number }
  return JSON.stringify({ state: { snapshot: { ...m.state.snapshot, exportDate, importedAt } }, version: 1 })
}
const historyOf = (...importedAt: number[]) =>
  JSON.stringify({ state: { entries: importedAt.map((t) => ({ importedAt: t, exportDate: '2026-10-02', source: 'x.csv', serverName: 'X', useful: 1, recognized: 1, read: 1, keyPrices: {} })) }, version: 1 })
const regOf = (server: { id: string; name: string }, profiles: { id: string; name: string }[] = [{ id: 'principal', name: 'Principal' }]) =>
  JSON.stringify({
    version: 1,
    activeProfileId: profiles[0].id,
    profiles: profiles.map((p, i) => ({ ...p, serverId: server.id, createdAt: i + 1 })),
    servers: [{ ...server, createdAt: 1, priceStat: 'auto', maxMarketShare: 0.15 }],
  })
const stateOf = (s: StorageLike, key: string) => (JSON.parse(s.getItem(key) ?? 'null') as { state: Record<string, unknown> } | null)?.state

/** Sauvegarde du profil « Principal » d'un navigateur où son serveur (« mon-serveur ») porte ce nom. */
function principalBackup(serverName = 'Mon serveur'): BackupFile {
  const source = new FakeStorage({
    'elevagesimu:profiles': regOf({ id: 'mon-serveur', name: serverName }),
    'elevagesimu:p:principal:settings': JSON.stringify(settings),
    'elevagesimu:s:mon-serveur:prices': pricesState({ '1844': 30, '33515': 27000, '7033': 100 }, { genetonValue: 420, mounts: { '94|1': 5000 }, generations: { 'muldo|1|1': 3000 } }),
    'elevagesimu:s:mon-serveur:market': marketAt('2026-10-02', 2_000),
    'elevagesimu:s:mon-serveur:market-history': historyOf(2_000),
  })
  return exportProfile('principal', source) as BackupFile
}

describe('restaurer un profil sur un serveur déjà présent ici (DI-01)', () => {
  it('navigateur neuf (« Mon serveur » vide) : les prix et le marché de la sauvegarde sont écrits, et annoncés', () => {
    const target = new FakeStorage()
    bootProfiles(target, NOW)
    const r = importAll(principalBackup(), { storage: target, reload: false })
    expect(r.ok).toBe(true)
    expect(stateOf(target, 'elevagesimu:s:mon-serveur:prices')).toMatchObject({ items: { '1844': 30, '33515': 27000, '7033': 100 }, genetonValue: 420 })
    expect(stateOf(target, 'elevagesimu:s:mon-serveur:market')?.snapshot).toMatchObject({ exportDate: '2026-10-02' })
    expect(stateOf(target, 'elevagesimu:s:mon-serveur:market-history')?.entries).toHaveLength(1)
    expect(r.ok && r.warnings.join(' ')).toMatch(/repris de la sauvegarde/)
  })

  it('serveur renommé dans la sauvegarde, navigateur neuf : le serveur vide d’ici prend son nom et ses prix', () => {
    const target = new FakeStorage()
    bootProfiles(target, NOW)
    const r = importAll(principalBackup('Tylezia'), { storage: target, reload: false })
    expect(r.ok).toBe(true)
    const reg = JSON.parse(target.getItem('elevagesimu:profiles') ?? 'null')
    expect(reg.servers).toEqual([expect.objectContaining({ id: 'mon-serveur', name: 'Tylezia' })])
    expect(stateOf(target, 'elevagesimu:s:mon-serveur:prices')?.items).toMatchObject({ '33515': 27000 })
  })

  it('même identifiant mais autre nom, serveur d’ici utilisé : serveur distinct créé (jamais de rattachement silencieux)', () => {
    const target = new FakeStorage({
      'elevagesimu:profiles': regOf({ id: 'mon-serveur', name: 'Jahash' }, [
        { id: 'principal', name: 'Principal' },
        { id: 'alt', name: 'Alt' },
      ]),
      'elevagesimu:s:mon-serveur:prices': pricesState({ '33515': 11111 }),
    })
    const r = importAll(principalBackup('Tylezia'), { storage: target, reload: false })
    expect(r.ok).toBe(true)
    const reg = JSON.parse(target.getItem('elevagesimu:profiles') ?? 'null')
    expect(reg.servers.map((x: { id: string; name: string }) => `${x.id}:${x.name}`)).toEqual(['mon-serveur:Jahash', 'tylezia:Tylezia'])
    expect(reg.profiles.find((p: { id: string }) => p.id === 'principal').serverId).toBe('tylezia')
    expect(stateOf(target, 'elevagesimu:s:tylezia:prices')?.items).toMatchObject({ '33515': 27000 })
    expect(stateOf(target, 'elevagesimu:s:mon-serveur:prices')?.items).toEqual({ '33515': 11111 })
    expect(r.ok && r.warnings.join(' ')).toMatch(/même identifiant que « Jahash »/)
  })

  function localWithPrices() {
    return new FakeStorage({
      'elevagesimu:profiles': regOf({ id: 'mon-serveur', name: 'Mon serveur' }, [
        { id: 'principal', name: 'Principal' },
        { id: 'alt', name: 'Alt' },
      ]),
      'elevagesimu:s:mon-serveur:prices': pricesState({ '1844': 31, '999': 5 }),
      'elevagesimu:s:mon-serveur:market': marketAt('2026-09-01', 1_000),
      'elevagesimu:s:mon-serveur:market-history': historyOf(1_000),
    })
  }

  it('prix des deux côtés, choix par défaut « garder » : ceux d’ici restent, avertissement (et aperçu : choix nécessaire)', () => {
    const target = localWithPrices()
    const before = target.getItem('elevagesimu:s:mon-serveur:prices')
    const plan = planProfileServer(principalBackup(), target)
    expect(plan).toMatchObject({ action: 'existing', needsChoice: true, sharedWith: ['Alt'] })
    expect(plan?.localData).toMatchObject({ prices: 2, marketExportDate: '2026-09-01', history: 1 })
    expect(plan?.backupData).toMatchObject({ prices: 5, geneton: true, marketExportDate: '2026-10-02' })
    const r = importAll(principalBackup(), { storage: target, reload: false })
    expect(r.ok && r.warnings.join(' ')).toMatch(/ceux de ce navigateur sont gardés/)
    expect(target.getItem('elevagesimu:s:mon-serveur:prices')).toBe(before)
  })

  it('« prendre ceux de la sauvegarde » : prix, marché et historique remplacés', () => {
    const target = localWithPrices()
    const r = importAll(principalBackup(), { storage: target, reload: false, serverData: 'replace' })
    expect(r.ok && r.warnings.join(' ')).toMatch(/remplacés par ceux de la sauvegarde, partagés aussi par « Alt »/)
    expect(stateOf(target, 'elevagesimu:s:mon-serveur:prices')?.items).toEqual({ '1844': 30, '33515': 27000, '7033': 100 })
    expect(stateOf(target, 'elevagesimu:s:mon-serveur:market')?.snapshot).toMatchObject({ exportDate: '2026-10-02' })
  })

  it('« fusionner » : prix réunis (ceux d’ici gardés en cas de doublon), marché le plus récent, historiques réunis', () => {
    const target = localWithPrices()
    const r = importAll(principalBackup(), { storage: target, reload: false, serverData: 'merge' })
    expect(r.ok).toBe(true)
    expect(stateOf(target, 'elevagesimu:s:mon-serveur:prices')).toMatchObject({
      items: { '1844': 31, '999': 5, '33515': 27000, '7033': 100 },
      mounts: { '94|1': 5000 },
      genetonValue: 420,
    })
    expect(stateOf(target, 'elevagesimu:s:mon-serveur:market')?.snapshot).toMatchObject({ exportDate: '2026-10-02', importedAt: 2_000 })
    const history = (stateOf(target, 'elevagesimu:s:mon-serveur:market-history')?.entries ?? []) as { importedAt: number }[]
    expect(history.map((e) => e.importedAt)).toEqual([1_000, 2_000])
  })

  it('fusions pures : un prix absent n’est jamais compté comme 0', () => {
    const local = { items: { a: 1 }, mounts: {}, generations: {}, genetonValue: null, updatedAt: 1 }
    const incoming = { items: { a: 2, b: 3 }, mounts: { m: 4 }, generations: {}, genetonValue: 400, updatedAt: 2 }
    expect(mergePriceStates(local, incoming, 'local')).toEqual({ items: { a: 1, b: 3 }, mounts: { m: 4 }, generations: {}, genetonValue: 400, updatedAt: 2 })
    expect(mergePriceStates(local, incoming, 'incoming').items).toEqual({ a: 2, b: 3 })
  })
})

/** Faux stockage dont le quota compte les caractères (clé + valeur), comme Chrome. */
function quotaStorage(init: Record<string, string>, margin: number) {
  const s = new FakeStorage(init)
  s.quota = s.used() + margin
  return s
}
const sized = (n: number) => 'x'.repeat(n)
const precious = JSON.stringify({ state: { entries: [{ id: 'precieux', kind: 'note', at: 1, text: 'entrée précieuse' }] }, version: 1 })

describe('import interrompu par le quota : retour EXACT à l’état d’avant (DI-02)', () => {
  it('sauvegarde complète : toutes les clés et valeurs identiques, journal compris, quel que soit l’ordre des écritures', () => {
    const target = quotaStorage(
      { 'elevagesimu:aaa': JSON.stringify(sized(3000)), 'elevagesimu:bbb': JSON.stringify(sized(500)), 'elevagesimu:ccc': JSON.stringify(sized(1500)), 'elevagesimu:journal': precious },
      150,
    )
    const before = target.snapshot()
    const backup = { app: BACKUP_APP, version: 1, exportedAt: '2026-10-02T00:00:00Z', stores: { 'elevagesimu:aaa': sized(500), 'elevagesimu:bbb': sized(3000), 'elevagesimu:ddd': sized(2000) } }
    const r = importAll(backup, { mode: 'replace', storage: target, reload: false })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/vos données n’ont pas changé/) })
    expect(target.snapshot()).toEqual(before)
  })

  it('sauvegarde d’un profil : idem', () => {
    const reg = JSON.stringify(REG)
    const source = new FakeStorage({
      'elevagesimu:profiles': reg,
      'elevagesimu:p:alpha:aaa': JSON.stringify(sized(500)),
      'elevagesimu:p:alpha:bbb': JSON.stringify(sized(3000)),
      'elevagesimu:p:alpha:ddd': JSON.stringify(sized(2000)),
    })
    const target = quotaStorage(
      {
        'elevagesimu:profiles': reg,
        'elevagesimu:p:alpha:aaa': JSON.stringify(sized(3000)),
        'elevagesimu:p:alpha:bbb': JSON.stringify(sized(500)),
        'elevagesimu:p:alpha:ccc': JSON.stringify(sized(1500)),
        'elevagesimu:p:alpha:journal': precious,
      },
      150,
    )
    const before = target.snapshot()
    const r = importAll(exportProfile('alpha', source) as BackupFile, { storage: target, reload: false })
    expect(r.ok).toBe(false)
    expect(target.snapshot()).toEqual(before)
  })

  it('restauration impossible (un autre onglet remplit le stockage) : erreur distincte et copie des données d’avant', () => {
    class HostileStorage extends FakeStorage {
      broken = false
      setItem(k: string, v: string) {
        if (this.broken) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
        try {
          super.setItem(k, v)
        } catch (e) {
          this.broken = true
          throw e
        }
      }
    }
    const target = new HostileStorage({ 'elevagesimu:aaa': JSON.stringify(sized(3000)), 'elevagesimu:journal': precious })
    target.quota = target.used() + 100
    const r = importAll({ app: BACKUP_APP, version: 1, exportedAt: '2026-10-02T00:00:00Z', stores: { 'elevagesimu:aaa': sized(10), 'elevagesimu:bbb': sized(4000) } }, { storage: target, reload: false })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Import interrompu/) })
    if (r.ok) return
    expect(r.snapshot?.stores['elevagesimu:journal']).toEqual(JSON.parse(precious))
    expect(r.snapshot?.stores['elevagesimu:aaa']).toBe(sized(3000))
  })
})

describe('sauvegarde d’avant les profils fusionnée (DI-08)', () => {
  it('ses prix sont fusionnés clé par clé avec ceux du serveur ouvert (pas de remplacement en bloc), avertissement nommant le serveur et ses profils', () => {
    const target = new FakeStorage({
      'elevagesimu:profiles': regOf({ id: 'tylezia', name: 'Tylezia' }, [
        { id: 'principal', name: 'Principal' },
        { id: 'alt', name: 'Alt' },
      ]),
      'elevagesimu:s:tylezia:prices': pricesState({ '33515': 27000, '1844': 30 }),
    })
    const v1 = { app: BACKUP_APP, version: 1, exportedAt: '2026-01-01T00:00:00Z', stores: { 'elevagesimu:prices': JSON.parse(pricesState({ '1844': 7 })) } }
    const r = importAll(v1, { storage: target, mode: 'merge', reload: false })
    expect(r.ok && r.warnings.join(' ')).toMatch(/serveur « Tylezia » .*partagés par 2 profils : « Principal », « Alt »/)
    expect(stateOf(target, 'elevagesimu:s:tylezia:prices')?.items).toEqual({ '33515': 27000, '1844': 7 })
  })
})

describe('registre illisible dans une sauvegarde complète (DI-09)', () => {
  it('« remplacer » : le registre est reconstruit d’après les données du fichier (le message dit vrai)', () => {
    const source = v2Storage()
    source.setItem(PROFILES_SHADOW_KEY, JSON.stringify(REG))
    const b = exportAll(source)
    const broken = { ...b, stores: { ...b.stores, 'elevagesimu:profiles': 'cassé' } }
    const target = new FakeStorage()
    const r = importAll(broken, { storage: target, reload: false })
    expect(r.ok && r.warnings.join(' ')).toMatch(/Registre des profils reconstruit/)
    const reg = JSON.parse(target.getItem('elevagesimu:profiles') ?? 'null')
    // Copie de secours du fichier : noms et serveurs repris.
    expect(reg.profiles.map((p: { id: string; name: string; serverId: string }) => `${p.id}:${p.name}@${p.serverId}`).sort()).toEqual(['alpha:Alpha@tylezia', 'beta:Beta@salar'])
    expect(bootProfiles(target, NOW).registry.profiles).toHaveLength(2)
  })
})

describe('données recalculables (DI-12)', () => {
  it('les résultats des modes sont libellés « recalculables » et supprimables pour tous les profils', () => {
    expect(storeLabel('elevagesimu:p:principal:modes')).toMatch(/recalculables/)
    expect(storeLabel('elevagesimu:p:principal:modes-ui')).toBe('Préférences de la page Modes — profil principal')
    expect(storeLabel('elevagesimu:p:principal:investissement')).toBe('Préférences de la page Investissement — profil principal')
    const s = new FakeStorage({ 'elevagesimu:p:a:modes': sized(80_000), 'elevagesimu:p:b:modes': '{}', 'elevagesimu:p:a:modes-ui': '{}', 'elevagesimu:p:a:inventory': '{}' })
    const u = storageUsage(s)
    expect(u.entries[0]).toMatchObject({ key: 'elevagesimu:p:a:modes', regenerable: true })
    expect(u.entries.find((e) => e.key === 'elevagesimu:p:a:modes-ui')?.regenerable).toBe(false)
    expect(isRegenerableKey('elevagesimu:s:x:modes')).toBe(false)
    expect(removeRegenerableData(s)).toEqual(['elevagesimu:p:a:modes', 'elevagesimu:p:b:modes'])
    expect(appKeys(s)).toEqual(['elevagesimu:p:a:inventory', 'elevagesimu:p:a:modes-ui'])
  })
})

describe('restauration complète et copie d’avant les profils (intégration finale)', () => {
  // Anciens réglages v3 sans le champ `mode` (ajouté par la v2 à la normalisation de la sauvegarde).
  const legacySettings = JSON.stringify({ state: { ruleset: '3.6', jobLevel: 85, family: 'volkorne', server: '', saleTax: 0.02 }, version: 3 })
  const migrated = () => {
    const source = new FakeStorage({
      'elevagesimu:settings': legacySettings,
      'elevagesimu:journal': JSON.stringify({ state: { entries: [] }, version: 1 }),
    })
    bootProfiles(source, NOW)
    return source
  }

  it('aucune fausse alerte « modifiées par l’ancienne version » après avoir restauré une sauvegarde complète dans un navigateur neuf', () => {
    const source = migrated()
    expect(legacyDivergence(source, JSON.parse(source.getItem('elevagesimu:profiles') ?? 'null'))).toEqual([])
    const text = serializeBackup(exportAll(source, new Date(NOW)))
    // Fichier brut, ou sauvegarde déjà validée (normalisée) comme le fait la page Réglages.
    const validated = parseBackup(text)
    expect(validated.ok).toBe(true)
    for (const input of [JSON.parse(text) as BackupFile, validated.ok ? validated.backup : null]) {
      const target = new FakeStorage()
      bootProfiles(target, NOW)
      const r = importAll(input, { storage: target, reload: false })
      expect(r.ok).toBe(true)
      // La normalisation a bien réécrit l'ancienne clé (champ `mode` ajouté)…
      expect(target.getItem('elevagesimu:settings')).not.toBe(legacySettings)
      // … sans lever d'alerte de divergence.
      const reg = JSON.parse(target.getItem('elevagesimu:profiles') ?? 'null')
      expect(legacyDivergence(target, reg)).toEqual([])
    }
  })

  it('une ancienne clé déjà modifiée après la reprise dans le navigateur d’origine reste signalée après la restauration', () => {
    const source = migrated()
    source.setItem('elevagesimu:journal', JSON.stringify({ state: { entries: [{ id: 'x', at: NOW, kind: 'note', text: 'onglet resté en v1' }] }, version: 1 }))
    expect(legacyDivergence(source, JSON.parse(source.getItem('elevagesimu:profiles') ?? 'null'))).toEqual(['elevagesimu:journal'])
    const validated = parseBackup(serializeBackup(exportAll(source, new Date(NOW))))
    const target = new FakeStorage()
    const r = importAll(validated.ok ? validated.backup : null, { storage: target, reload: false })
    expect(r.ok).toBe(true)
    expect(legacyDivergence(target, JSON.parse(target.getItem('elevagesimu:profiles') ?? 'null'))).toEqual(['elevagesimu:journal'])
  })
})
