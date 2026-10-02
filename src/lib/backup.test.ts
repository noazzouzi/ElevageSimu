import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../store/schema'
import {
  BACKUP_APP,
  BACKUP_VERSION,
  KNOWN_STORES,
  STORE_VERSIONS,
  appKeys,
  backupFileName,
  exportAll,
  importAll,
  isAppKey,
  parseBackup,
  resetAll,
  serializeBackup,
  storageUsage,
  storeLabel,
  summarizeBackup,
  validateBackup,
  type StorageLike,
} from './backup'

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
    expect(storageUsage(null)).toEqual({ totalBytes: 0, entries: [] })
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
  it('compte 2 octets par caractère (clé + valeur), du plus gros au plus petit', () => {
    const s = new FakeStorage({ 'elevagesimu:a': 'xx', 'elevagesimu:bb': 'xxxxxxxx', 'autre:c': 'zzzzzzzzzzzz' })
    const u = storageUsage(s)
    expect(u.entries.map((e) => e.key)).toEqual(['elevagesimu:bb', 'elevagesimu:a'])
    expect(u.entries[0].bytes).toBe(2 * ('elevagesimu:bb'.length + 8))
    expect(u.totalBytes).toBe(2 * ('elevagesimu:a'.length + 2) + 2 * ('elevagesimu:bb'.length + 8))
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
