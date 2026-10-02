// Prix du marché (HDV) importés depuis un export CSV d'un serveur : lecture tolérante du fichier,
// sélection des objets utiles à l'application, instantané compact, statistique de prix, liquidité,
// valeur du généton et évolution entre deux imports. Module pur (aucun accès au navigateur ni au store).
//
// Format de référence (export du joueur, docs/SPEC-v2.md §1) :
//   gid;nom;niveau;type;categorie;vendus_24h;vendus_7j;vendus_30j;median_30j;moyen_30j;median_24h;kamas_par_jour
// Règle commune : un prix 0 = pas de vente = pas de prix (jamais compté comme 0 kamas).
import { FAMILIES, FAMILY_IDS, FUELS, INGREDIENTS, MAKINAS, NETS, PRICES_DEFAULT, SPECIES, getSpecies, itemName } from '../data'

// ---------- Statistique de prix ----------

/** Statistique retenue pour transformer une ligne HDV en prix (réglage par serveur). */
export type PriceStat = 'auto' | 'median30' | 'median24' | 'mean30'
export type ConcretePriceStat = Exclude<PriceStat, 'auto'>

export const PRICE_STATS: PriceStat[] = ['auto', 'median30', 'median24', 'mean30']

export const PRICE_STAT_LABELS: Record<PriceStat, string> = {
  auto: 'Automatique (médiane 24 h si ≥ 5 ventes, sinon 30 j)',
  median30: 'Médiane 30 jours',
  median24: 'Médiane 24 heures (si ≥ 5 ventes en 24 h, sinon 30 j)',
  mean30: 'Moyenne 30 jours',
}

export const PRICE_STAT_SHORT: Record<ConcretePriceStat, string> = { median30: 'méd. 30 j', median24: 'méd. 24 h', mean30: 'moy. 30 j' }

/** Ventes sur 24 h à partir desquelles la médiane 24 h est jugée représentative (statistique `auto`). */
export const AUTO_MIN_SOLD_24H = 5

/**
 * Ligne compacte d'un objet : [médiane 30 j, moyenne 30 j, médiane 24 h, vendus 24 h, vendus 7 j,
 * vendus 30 j, kamas échangés par jour]. Prix unitaires en kamas ; 0 = pas de vente sur la période.
 */
export type MarketTuple = [number, number, number, number, number, number, number]

export const TUPLE = { median30: 0, mean30: 1, median24: 2, sold24: 3, sold7: 4, sold30: 5, kamasPerDay: 6 } as const

/** Ligne lue dans le CSV. */
export interface HdvRow {
  id: number
  name: string
  level: number | null
  type: string
  category: string
  sold24: number
  sold7: number
  sold30: number
  median30: number
  mean30: number
  median24: number
  kamasPerDay: number
}

export function tupleOf(row: HdvRow): MarketTuple {
  return [row.median30, row.mean30, row.median24, row.sold24, row.sold7, row.sold30, row.kamasPerDay]
}

type RowLike = MarketTuple | HdvRow

function asTuple(row: RowLike): MarketTuple {
  return Array.isArray(row) ? row : tupleOf(row)
}

/**
 * Prix d'une ligne selon la statistique, avec la statistique réellement utilisée :
 *  - `auto` : médiane 24 h si ≥ 5 ventes en 24 h, sinon médiane 30 j, sinon moyenne 30 j ;
 *  - statistique choisie (`median24`, `median30`, `mean30`) : sa valeur, et si elle vaut 0 (pas de vente
 *    sur la période) la médiane 30 j puis la moyenne 30 j (repli signalé par `stat`) ;
 *  - `median24` : seulement avec ≥ 5 ventes en 24 h (`AUTO_MIN_SOLD_24H`, comme `auto`) — une médiane de
 *    1 à 4 ventes s'écarte souvent de plus de 50 % du prix réel (montures : 61 033 → 495 000 sur 2 ventes) ;
 *    sinon repli médiane 30 j puis moyenne 30 j (signalé par `stat`).
 * Un prix 0 n'est jamais un prix : null si aucune valeur n'est positive.
 */
export function priceDetail(row: RowLike, stat: PriceStat = 'auto'): { price: number; stat: ConcretePriceStat } | null {
  const t = asTuple(row)
  const val = (s: ConcretePriceStat) => {
    const v = t[TUPLE[s]]
    return Number.isFinite(v) && v > 0 ? v : null
  }
  let order: ConcretePriceStat[]
  const enough24 = t[TUPLE.sold24] >= AUTO_MIN_SOLD_24H
  if (stat === 'auto' || stat === 'median24') order = enough24 ? ['median24', 'median30', 'mean30'] : ['median30', 'mean30']
  else order = [stat, ...(['median30', 'mean30'] as ConcretePriceStat[]).filter((s) => s !== stat)]
  for (const s of order) {
    const v = val(s)
    if (v !== null) return { price: v, stat: s }
  }
  return null
}

/** Prix d'une ligne selon la statistique (null = pas de prix). */
export function priceFromRow(row: RowLike, stat: PriceStat = 'auto'): number | null {
  return priceDetail(row, stat)?.price ?? null
}

/** Confiance d'un prix de marché selon le volume : beaucoup de ventes = prix fiable. */
export function marketConfidence(row: RowLike): 'high' | 'medium' | 'low' {
  const t = asTuple(row)
  if (t[TUPLE.sold24] >= AUTO_MIN_SOLD_24H || t[TUPLE.sold30] >= 30) return 'high'
  if (t[TUPLE.sold30] >= 5) return 'medium'
  return 'low'
}

// ---------- Lecture du CSV ----------

type Column = keyof HdvRow

/** Alias d'en-têtes (normalisés : minuscules, sans accents, « _ » entre les mots). */
const HEADER_ALIASES: Record<Column, string[]> = {
  id: ['gid', 'id', 'item_id', 'itemid', 'id_objet', 'objet_id', 'object_id', 'ankama_id'],
  name: ['nom', 'name', 'objet', 'item', 'item_name', 'nom_objet', 'libelle'],
  level: ['niveau', 'level', 'lvl', 'niv'],
  type: ['type', 'type_objet', 'item_type'],
  category: ['categorie', 'category', 'cat'],
  sold24: ['vendus_24h', 'sold_24h', 'ventes_24h', 'vendus24h', 'sold24h', 'sold24', 'sales_24h', 'vendu_24h'],
  sold7: ['vendus_7j', 'vendus_7d', 'sold_7d', 'sold_7j', 'ventes_7j', 'sold7d', 'sold7', 'sales_7d', 'vendu_7j'],
  sold30: ['vendus_30j', 'vendus_30d', 'sold_30d', 'sold_30j', 'ventes_30j', 'sold30d', 'sold30', 'sales_30d', 'vendu_30j'],
  median30: ['median_30j', 'median_30d', 'mediane_30j', 'mediane_30d', 'prix_median_30j', 'median30', 'median_price_30d', 'median_30_j'],
  mean30: ['moyen_30j', 'moyenne_30j', 'mean_30d', 'mean_30j', 'avg_30d', 'average_30d', 'prix_moyen_30j', 'moyen30', 'mean30', 'moyenne_30d'],
  median24: ['median_24h', 'mediane_24h', 'median24', 'median24h', 'median_price_24h', 'prix_median_24h'],
  kamasPerDay: ['kamas_par_jour', 'kamas_per_day', 'kamas_jour', 'volume_kamas', 'kamasperday', 'volume_jour', 'kamas_day'],
}

const NUMERIC_COLUMNS: Column[] = ['sold24', 'sold7', 'sold30', 'median30', 'mean30', 'median24', 'kamasPerDay']
const PRICE_COLUMNS: Column[] = ['median30', 'mean30', 'median24']

/** En-tête normalisé : « Médiane 30j » → « mediane_30j ». */
export function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, '')
    .trim()
    .replace(/^"|"$/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Nombre d'une cellule : « 12 000 », « 12 000 », « 1'000 », « 12,5 », « 1.234.567 », « 29,534 »
 * (groupes de 3 chiffres = milliers), vide ou « - » = 0. NaN si illisible ou négatif.
 */
export function parseNumberCell(raw: string): number {
  let s = raw.trim().replace(/^"|"$/g, '').trim()
  if (s === '' || s === '-' || s === '—' || s === '–') return 0
  s = s.replace(/[\s  '’]/g, '')
  if (!/^\d[\d.,]*$/.test(s)) return Number.NaN
  const hasDot = s.includes('.')
  const hasComma = s.includes(',')
  if (hasDot && hasComma) {
    // Le dernier séparateur est la décimale, l'autre sépare les milliers.
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ','
    const thousands = dec === '.' ? ',' : '.'
    s = s.split(thousands).join('').replace(dec, '.')
  } else if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ','
    const parts = s.split(sep)
    const grouped = parts.length > 1 && parts[0].length <= 3 && parts.slice(1).every((p) => p.length === 3)
    s = grouped ? parts.join('') : parts.length === 2 ? `${parts[0]}.${parts[1]}` : ''
  }
  const n = Number(s)
  return s !== '' && Number.isFinite(n) && n >= 0 ? n : Number.NaN
}

/** Découpe un texte CSV en lignes de cellules (guillemets, guillemets doublés, séparateurs et sauts de ligne entre guillemets). */
function splitCsv(text: string, sep: string): { cells: string[]; line: number }[] {
  const out: { cells: string[]; line: number }[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let startLine = 1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else {
        if (c === '\n') line++
        cell += c
      }
      continue
    }
    if (c === '"' && cell.trim() === '') {
      quoted = true
      cell = ''
    } else if (c === sep) {
      cells.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      cells.push(cell)
      out.push({ cells, line: startLine })
      cells = []
      cell = ''
      line++
      startLine = line
    } else cell += c
  }
  if (cell !== '' || cells.length) {
    cells.push(cell)
    out.push({ cells, line: startLine })
  }
  return out
}

/** Séparateur le plus fréquent de la première ligne non vide (hors guillemets) : « ; », « , » ou tabulation. */
function detectSeparator(text: string): ';' | ',' | '\t' {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? ''
  const counts: Record<';' | ',' | '\t', number> = { ';': 0, ',': 0, '\t': 0 }
  let quoted = false
  for (const c of first) {
    if (c === '"') quoted = !quoted
    else if (!quoted && (c === ';' || c === ',' || c === '\t')) counts[c]++
  }
  if (counts['\t'] > counts[';'] && counts['\t'] > counts[',']) return '\t'
  return counts[','] > counts[';'] ? ',' : ';'
}

export interface CsvInvalidLine {
  /** Numéro de ligne dans le fichier (1 = en-tête). */
  line: number
  reason: string
  text: string
}

export interface CsvParseResult {
  /** Lignes valides (une par objet ; en cas de doublon, celle qui a le plus de ventes sur 30 j). */
  rows: HdvRow[]
  separator: ';' | ',' | '\t'
  /** En-têtes du fichier (texte brut). */
  header: string[]
  /** Colonnes reconnues → index dans le fichier. */
  columns: Partial<Record<Column, number>>
  /** Colonnes utiles absentes (prix ou volumes valant alors 0). */
  missingColumns: Column[]
  /** Lignes de données du fichier (hors en-tête et lignes vides). */
  lines: number
  /** Lignes vides ignorées. */
  empty: number
  /** Lignes invalides ou incomplètes ignorées (nombre total). */
  invalidCount: number
  /** Détail des premières lignes invalides (≤ 50). */
  invalid: CsvInvalidLine[]
  /** Objets présents plusieurs fois (une seule ligne gardée). */
  duplicates: number
  /** Erreur bloquante (fichier vide, colonne d'identifiant ou de prix introuvable), sinon absent. */
  error?: string
}

const INVALID_DETAIL_MAX = 50

/** Lecture tolérante d'un export CSV de l'HDV (voir en-tête du module). Ne lève jamais d'exception. */
export function parseHdvCsv(text: string): CsvParseResult {
  const clean = text.replace(/^﻿/, '')
  const separator = detectSeparator(clean)
  const base: CsvParseResult = { rows: [], separator, header: [], columns: {}, missingColumns: [], lines: 0, empty: 0, invalidCount: 0, invalid: [], duplicates: 0 }
  const records = splitCsv(clean, separator)
  const headerIdx = records.findIndex((r) => r.cells.some((c) => c.trim() !== ''))
  if (headerIdx < 0) return { ...base, error: 'Fichier vide.' }
  const header = records[headerIdx].cells.map((c) => c.trim())
  const normalized = header.map(normalizeHeader)
  const columns: Partial<Record<Column, number>> = {}
  for (const col of Object.keys(HEADER_ALIASES) as Column[]) {
    const idx = normalized.findIndex((h) => HEADER_ALIASES[col].includes(h))
    if (idx >= 0) columns[col] = idx
  }
  const missingColumns = ([...NUMERIC_COLUMNS, 'name'] as Column[]).filter((c) => columns[c] === undefined)
  const out: CsvParseResult = { ...base, header, columns, missingColumns }
  if (columns.id === undefined) return { ...out, error: 'Colonne d’identifiant d’objet introuvable (attendu « gid » ou « id »).' }
  if (!PRICE_COLUMNS.some((c) => columns[c] !== undefined))
    return { ...out, error: 'Aucune colonne de prix reconnue (attendu « median_30j », « moyen_30j » ou « median_24h »).' }
  const needed = Math.max(...Object.values(columns).map((i) => i as number)) + 1
  const byId = new Map<number, HdvRow>()
  for (const rec of records.slice(headerIdx + 1)) {
    if (rec.cells.every((c) => c.trim() === '')) {
      out.empty++
      continue
    }
    out.lines++
    const bad = (reason: string) => {
      out.invalidCount++
      if (out.invalid.length < INVALID_DETAIL_MAX) out.invalid.push({ line: rec.line, reason, text: rec.cells.join(separator).slice(0, 160) })
    }
    if (rec.cells.length < needed) {
      bad(`ligne incomplète (${rec.cells.length} colonnes sur ${needed})`)
      continue
    }
    const cell = (c: Column) => (columns[c] === undefined ? '' : (rec.cells[columns[c] as number] ?? ''))
    const idText = cell('id').trim().replace(/^"|"$/g, '')
    if (!/^\d+$/.test(idText) || Number(idText) <= 0) {
      bad('identifiant d’objet manquant ou invalide')
      continue
    }
    const nums: Partial<Record<Column, number>> = {}
    let unreadable: Column | null = null
    for (const c of NUMERIC_COLUMNS) {
      const v = parseNumberCell(cell(c))
      if (Number.isNaN(v)) {
        unreadable = c
        break
      }
      nums[c] = v
    }
    if (unreadable) {
      bad(`nombre illisible (colonne « ${header[columns[unreadable] as number]} »)`)
      continue
    }
    const levelText = cell('level').trim()
    const level = /^\d+$/.test(levelText) ? Number(levelText) : null
    const row: HdvRow = {
      id: Number(idText),
      name: cell('name').trim(),
      level,
      type: cell('type').trim(),
      category: cell('category').trim(),
      sold24: Math.round(nums.sold24 ?? 0),
      sold7: Math.round(nums.sold7 ?? 0),
      sold30: Math.round(nums.sold30 ?? 0),
      median30: nums.median30 ?? 0,
      mean30: nums.mean30 ?? 0,
      median24: nums.median24 ?? 0,
      kamasPerDay: nums.kamasPerDay ?? 0,
    }
    const prev = byId.get(row.id)
    if (prev) {
      out.duplicates++
      if (row.sold30 <= prev.sold30) continue
    }
    byId.set(row.id, row)
  }
  out.rows = [...byId.values()]
  return out
}

// ---------- Objets utiles à l'application ----------

export type MarketCategory = 'ingredient' | 'carburant' | 'makina' | 'filet' | 'monture' | 'extraction' | 'rune' | 'geneton' | 'autre'

export const MARKET_CATEGORIES: MarketCategory[] = ['ingredient', 'carburant', 'makina', 'filet', 'monture', 'extraction', 'rune', 'geneton', 'autre']

export const MARKET_CATEGORY_LABELS: Record<MarketCategory, string> = {
  ingredient: 'Ingrédients',
  carburant: 'Carburants',
  makina: 'Makinas',
  filet: 'Filets',
  monture: 'Objets-montures',
  extraction: 'Ressources d’extraction',
  rune: 'Runes de brisage',
  geneton: 'Boutique de génétons',
  autre: 'Autres',
}

/** Rune Ga Pa (brisage des Volkornes) et Rune Ga Pme (brisage des Muldos). */
export const RUNE_GA_PA = 1557
export const RUNE_GA_PME = 1558
export const TOURMALINE = 15271
export const PEPITE = 14635
export const PARCHEMIN_ELEVEUR = 34203

export interface GenetonShopItem {
  id: number
  name: string
  /** Coût en génétons chez Eugène Éton. */
  cost: number
  /**
   * Échange reconfirmé après la sortie de la 3.5 (research/README.md §4.3 n° 18 : seuls les Puissants
   * Parchemins à 160 génétons) ; les autres lignes viennent d'une capture de la bêta.
   */
  confirmed: boolean
}

/** Coût des Puissants Parchemins, seul échange reconfirmé de la boutique d'Eugène Éton. */
export const CONFIRMED_GENETON_COST = 160

/** Objets échangeables de la boutique de génétons (parchemins de caractéristique ×24, Tourmaline). */
export const GENETON_SHOP: GenetonShopItem[] = (PRICES_DEFAULT.genetons.shop as { reward?: string; itemId?: number | null; costGenetons?: number | null; priceType?: string }[])
  .filter((s) => typeof s.itemId === 'number' && typeof s.costGenetons === 'number' && s.costGenetons > 0 && s.priceType !== 'non-tradable')
  .map((s) => {
    const name = s.reward ?? itemName(s.itemId as number)
    const cost = s.costGenetons as number
    return { id: s.itemId as number, name, cost, confirmed: cost === CONFIRMED_GENETON_COST && /^Puissant/i.test(name) }
  })

let categoryIds: Record<MarketCategory, number[]> | null = null

/** Objets utiles de chaque catégorie (un objet peut appartenir à plusieurs catégories). */
export function marketCategoryIds(): Record<MarketCategory, number[]> {
  if (categoryIds) return categoryIds
  const extraction = FAMILY_IDS.map((f) => FAMILIES[f].extractionItemId)
  const runes = [...new Set([RUNE_GA_PA, RUNE_GA_PME, ...PRICES_DEFAULT.items.filter((i) => i.category === 'rune' && i.id !== null).map((i) => i.id as number)])]
  const known = new Set<number>([
    ...INGREDIENTS.map((i) => i.id),
    ...FUELS.map((f) => f.id),
    ...MAKINAS.map((m) => m.id),
    ...NETS.map((n) => n.id),
    ...SPECIES.filter((s) => s.itemId).map((s) => s.itemId as number),
    ...extraction,
    ...runes,
    ...GENETON_SHOP.map((g) => g.id),
  ])
  const other = [PEPITE, PARCHEMIN_ELEVEUR, ...PRICES_DEFAULT.items.filter((i) => i.id !== null && i.category !== 'jeton').map((i) => i.id as number)].filter(
    (id, i, all) => all.indexOf(id) === i && (id === PEPITE || id === PARCHEMIN_ELEVEUR || !known.has(id)),
  )
  categoryIds = {
    ingredient: INGREDIENTS.map((i) => i.id),
    carburant: FUELS.map((f) => f.id),
    makina: MAKINAS.map((m) => m.id),
    filet: NETS.map((n) => n.id),
    monture: [...new Set(SPECIES.filter((s) => s.itemId).map((s) => s.itemId as number))],
    extraction,
    rune: runes,
    geneton: GENETON_SHOP.map((g) => g.id),
    autre: other,
  }
  return categoryIds
}

let relevant: Map<number, MarketCategory> | null = null

/** Catégorie principale de chaque objet utile (ordre : extraction, monture, carburant, makina, filet, génétons, rune, ingrédient, autre). */
export function relevantItems(): Map<number, MarketCategory> {
  if (relevant) return relevant
  const cats = marketCategoryIds()
  const order: MarketCategory[] = ['extraction', 'monture', 'carburant', 'makina', 'filet', 'geneton', 'rune', 'ingredient', 'autre']
  const map = new Map<number, MarketCategory>()
  for (const c of order) for (const id of cats[c]) if (!map.has(id)) map.set(id, c)
  relevant = map
  return map
}

/** Identifiants des objets dont l'application a besoin du prix (≈ 1 040 objets). */
export function relevantItemIds(): Set<number> {
  return new Set(relevantItems().keys())
}

// ---------- Instantané compact ----------

export const MARKET_FORMAT = 'elevagesimu-hdv'
export const MARKET_SNAPSHOT_VERSION = 1

export interface CategoryCoverage {
  category: MarketCategory
  label: string
  /** Objets utiles de la catégorie. */
  total: number
  /** Trouvés dans le fichier. */
  present: number
  /** Trouvés avec un prix (statistique automatique). */
  priced: number
}

export interface MarketSnapshotStats {
  /** Lignes de données du fichier (hors en-tête et lignes vides). */
  lines: number
  /** Lignes valides lues. */
  read: number
  /** Lignes vides, invalides ou incomplètes ignorées. */
  ignored: number
  invalid: number
  duplicates: number
  /** Objets utiles à l'application dans le catalogue. */
  relevant: number
  /** Objets utiles trouvés dans le fichier. */
  recognized: number
  /** Objets utiles trouvés avec un prix. */
  useful: number
  coverage: CategoryCoverage[]
  /** Échantillon (≤ 40) des objets utiles absents du fichier ou sans prix. */
  missing: { id: number; name: string; category: MarketCategory }[]
  missingCount: number
}

export interface MarketSnapshot {
  format: typeof MARKET_FORMAT
  version: number
  /** Serveur de l'export (tel que saisi à l'import). */
  serverName: string
  /** Date de l'export (AAAA-MM-JJ). */
  exportDate: string
  /** Instant de l'import (ms). */
  importedAt: number
  /** Origine : nom du fichier ou du préréglage. */
  source: string
  /** id d'objet → ligne compacte (objets utiles seulement). */
  rows: Record<string, MarketTuple>
  /** Noms du fichier pour les objets inconnus des données de l'application (parchemins, runes…). */
  names: Record<string, string>
  stats: MarketSnapshotStats
  /**
   * Colonnes de volume ou de prix absentes du fichier importé (`CsvParseResult.missingColumns`, hors
   * `name`). Sans `sold30`, la liquidité est INCONNUE (`marketDepth` → null), jamais « 0 vente ».
   * Absent : export complet (préréglages, imports d'avant ce champ).
   */
  missingColumns?: MarketColumn[]
}

/** Colonnes numériques d'un export (volumes et prix). */
export type MarketColumn = 'sold24' | 'sold7' | 'sold30' | 'median30' | 'mean30' | 'median24' | 'kamasPerDay'

const MARKET_COLUMNS: MarketColumn[] = ['sold24', 'sold7', 'sold30', 'median30', 'mean30', 'median24', 'kamasPerDay']

/** Libellés des colonnes (aperçu d'import). */
export const MARKET_COLUMN_LABELS: Record<MarketColumn, string> = {
  sold24: 'vendus_24h',
  sold7: 'vendus_7j',
  sold30: 'vendus_30j',
  median30: 'median_30j',
  mean30: 'moyen_30j',
  median24: 'median_24h',
  kamasPerDay: 'kamas_par_jour',
}

export interface BuildSnapshotOptions {
  serverName: string
  exportDate: string
  source?: string
  importedAt?: number
  /** Objets à garder (défaut : `relevantItemIds()`). */
  ids?: Set<number>
  /** Colonnes absentes du fichier (défaut : celles de `CsvParseResult.missingColumns`). */
  missingColumns?: MarketColumn[]
}

const MISSING_SAMPLE = 40

/** Nom d'un objet : données de l'application, sinon nom du fichier importé, sinon « Objet #id ». */
export function marketItemName(id: number, names?: Record<string, string> | null): string {
  const n = itemName(id)
  if (!n.startsWith('Objet #')) return n
  return names?.[String(id)] ?? KNOWN_NAMES.get(id) ?? n
}

/**
 * Noms connus hors recettes : ressources d'extraction, objets à prix par défaut, boutique de génétons
 * (Puissants Parchemins, Tourmaline…), Parchemin d'Éleveur — pour qu'un prix clé ne s'affiche jamais
 * « Objet #… » quand on n'a pas les noms de l'export (historique, aperçu d'import, comparaison).
 */
const KNOWN_NAMES = new Map<number, string>([
  ...PRICES_DEFAULT.items.filter((i) => i.id !== null).map((i): [number, string] => [i.id as number, i.name]),
  ...FAMILY_IDS.map((f): [number, string] => [FAMILIES[f].extractionItemId, FAMILIES[f].extractionItemName]),
  ...GENETON_SHOP.map((g): [number, string] => [g.id, g.name]),
  [TOURMALINE, 'Tourmaline'],
  [PARCHEMIN_ELEVEUR, "Parchemin d'Éleveur"],
  [PEPITE, 'Pépite'],
])

/**
 * Instantané compact d'un export : seuls les objets utiles (ayant au moins une valeur non nulle) sont
 * gardés, avec leurs 7 nombres ; statistiques de lecture et couverture par catégorie.
 */
export function buildSnapshot(input: CsvParseResult | HdvRow[], opts: BuildSnapshotOptions): MarketSnapshot {
  const parsed: Pick<CsvParseResult, 'rows' | 'lines' | 'empty' | 'invalidCount' | 'duplicates'> = Array.isArray(input)
    ? { rows: input, lines: input.length, empty: 0, invalidCount: 0, duplicates: 0 }
    : input
  const relevantMap = relevantItems()
  const keep = opts.ids ?? new Set(relevantMap.keys())
  const rows: Record<string, MarketTuple> = {}
  const names: Record<string, string> = {}
  let recognized = 0
  let useful = 0
  for (const r of parsed.rows) {
    if (!keep.has(r.id)) continue
    recognized++
    const t = tupleOf(r)
    if (priceFromRow(t) !== null) useful++
    if (!t.some((v) => v > 0)) continue
    rows[String(r.id)] = t
    if (r.name && itemName(r.id).startsWith('Objet #')) names[String(r.id)] = r.name
  }
  const cats = marketCategoryIds()
  const inFile = new Set(parsed.rows.map((r) => r.id))
  const coverage: CategoryCoverage[] = MARKET_CATEGORIES.map((category) => {
    const ids = cats[category].filter((id) => keep.has(id))
    const present = ids.filter((id) => inFile.has(id)).length
    const priced = ids.filter((id) => rows[String(id)] !== undefined && priceFromRow(rows[String(id)]) !== null).length
    return { category, label: MARKET_CATEGORY_LABELS[category], total: ids.length, present, priced }
  })
  const missingAll = [...keep].filter((id) => !rows[String(id)] || priceFromRow(rows[String(id)]) === null)
  const missing = missingAll.slice(0, MISSING_SAMPLE).map((id) => ({ id, name: marketItemName(id, names), category: relevantMap.get(id) ?? 'autre' }))
  const absentColumns = (opts.missingColumns ?? (Array.isArray(input) ? [] : input.missingColumns)).filter((c): c is MarketColumn => (MARKET_COLUMNS as string[]).includes(c))
  return {
    format: MARKET_FORMAT,
    version: MARKET_SNAPSHOT_VERSION,
    serverName: opts.serverName.trim(),
    exportDate: opts.exportDate,
    importedAt: opts.importedAt ?? Date.now(),
    source: opts.source ?? '',
    rows,
    names,
    stats: {
      lines: parsed.lines,
      read: parsed.rows.length,
      ignored: parsed.empty + parsed.invalidCount,
      invalid: parsed.invalidCount,
      duplicates: parsed.duplicates,
      relevant: keep.size,
      recognized,
      useful,
      coverage,
      missing,
      missingCount: missingAll.length,
    },
    ...(absentColumns.length ? { missingColumns: absentColumns } : {}),
  }
}

/** Les volumes (ventes sur 30 jours) sont-ils connus ? Faux pour un export sans colonne `vendus_30j`. */
export function volumeKnown(src: MarketSnapshot | MarketSource | null | undefined): boolean {
  if (!src) return false
  if ('volumeUnknown' in src && src.volumeUnknown) return false
  if ('missingColumns' in src && Array.isArray(src.missingColumns) && src.missingColumns.includes('sold30')) return false
  return true
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** Date AAAA-MM-JJ valide ? */
export function isIsoDay(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_DAY.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const nonNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/**
 * Instantané lu (stockage, préréglage, sauvegarde) normalisé : lignes invalides retirées (jamais remplacées
 * par 0), champs manquants complétés. `snapshot: null` si la structure est inutilisable.
 */
export function sanitizeSnapshot(raw: unknown): { snapshot: MarketSnapshot | null; issues: string[] } {
  if (!isObj(raw) || !isObj(raw.rows)) return { snapshot: null, issues: raw === null || raw === undefined ? [] : ['instantané de marché illisible'] }
  const issues: string[] = []
  const rows: Record<string, MarketTuple> = {}
  let dropped = 0
  for (const [k, v] of Object.entries(raw.rows)) {
    if (!/^\d+$/.test(k) || !Array.isArray(v) || v.length !== 7 || !v.every(nonNeg)) {
      dropped++
      continue
    }
    rows[k] = v as MarketTuple
  }
  if (dropped) issues.push(`${dropped} ligne${dropped > 1 ? 's' : ''} de marché invalide${dropped > 1 ? 's' : ''} retirée${dropped > 1 ? 's' : ''}`)
  const names: Record<string, string> = {}
  if (isObj(raw.names)) for (const [k, v] of Object.entries(raw.names)) if (typeof v === 'string' && /^\d+$/.test(k)) names[k] = v.slice(0, 120)
  let exportDate = typeof raw.exportDate === 'string' ? raw.exportDate : ''
  if (!isIsoDay(exportDate)) {
    issues.push('date d’export illisible')
    exportDate = ''
  }
  const statsRaw = isObj(raw.stats) ? raw.stats : {}
  const num = (v: unknown) => (nonNeg(v) ? v : 0)
  const coverage: CategoryCoverage[] = Array.isArray(statsRaw.coverage)
    ? statsRaw.coverage.filter(
        (c): c is CategoryCoverage => isObj(c) && typeof c.category === 'string' && (MARKET_CATEGORIES as string[]).includes(c.category) && nonNeg(c.total) && nonNeg(c.priced) && nonNeg(c.present),
      ).map((c) => ({ category: c.category, label: MARKET_CATEGORY_LABELS[c.category], total: c.total, present: c.present, priced: c.priced }))
    : []
  const missing = Array.isArray(statsRaw.missing)
    ? statsRaw.missing
        .filter((m): m is { id: number; name: string; category: MarketCategory } => isObj(m) && typeof m.id === 'number' && typeof m.name === 'string' && (MARKET_CATEGORIES as string[]).includes(m.category as string))
        .map((m) => ({ id: m.id, name: m.name, category: m.category }))
    : []
  const missingColumns = Array.isArray(raw.missingColumns) ? [...new Set(raw.missingColumns.filter((c): c is MarketColumn => typeof c === 'string' && (MARKET_COLUMNS as string[]).includes(c)))] : []
  const snapshot: MarketSnapshot = {
    format: MARKET_FORMAT,
    version: MARKET_SNAPSHOT_VERSION,
    serverName: typeof raw.serverName === 'string' ? raw.serverName.slice(0, 60) : '',
    exportDate,
    importedAt: num(raw.importedAt),
    source: typeof raw.source === 'string' ? raw.source.slice(0, 200) : '',
    rows,
    names,
    stats: {
      lines: num(statsRaw.lines),
      read: num(statsRaw.read),
      ignored: num(statsRaw.ignored),
      invalid: num(statsRaw.invalid),
      duplicates: num(statsRaw.duplicates),
      relevant: num(statsRaw.relevant),
      recognized: num(statsRaw.recognized) || Object.keys(rows).length,
      useful: num(statsRaw.useful) || Object.values(rows).filter((t) => priceFromRow(t) !== null).length,
      coverage,
      missing,
      missingCount: num(statsRaw.missingCount),
    },
    ...(missingColumns.length ? { missingColumns } : {}),
  }
  return { snapshot, issues }
}

// ---------- Source de prix (contexte de prix) ----------

/** Prix du marché d'un serveur tels que les lit la résolution des prix (`PriceContext.market`). */
export interface MarketSource {
  rows: Record<string, MarketTuple>
  /** Statistique de prix du serveur. */
  stat: PriceStat
  /** Date de l'export (AAAA-MM-JJ). */
  exportDate: string
  /** Nom du serveur (affichage). */
  serverName?: string
  /** Noms des objets inconnus des données de l'application. */
  names?: Record<string, string>
  /**
   * Serveur de l'EXPORT (`snapshot.serverName`) : diffère de `serverName` quand on a chargé les prix
   * d'un autre serveur (préréglage de Tylezia pour « Mon serveur »…) — à afficher (`marketOriginMismatch`).
   */
  originServer?: string
  /** Instant de l'import (ms) : un nouvel import du même jour change les prix (clé des résultats). */
  importedAt?: number
  /** Export sans colonne de ventes : liquidité inconnue (`marketDepth` → null), jamais « 0 vente ». */
  volumeUnknown?: boolean
}

/** Source de prix d'un instantané. */
export function marketSourceOf(snapshot: MarketSnapshot, stat: PriceStat = 'auto', serverName?: string): MarketSource {
  return {
    rows: snapshot.rows,
    stat,
    exportDate: snapshot.exportDate,
    serverName: serverName || snapshot.serverName,
    names: snapshot.names,
    originServer: snapshot.serverName,
    importedAt: snapshot.importedAt,
    ...(volumeKnown(snapshot) ? {} : { volumeUnknown: true }),
  }
}

/**
 * Où vient un prix du marché, pour un libellé : « HDV de Tylezia du 02/10/2026 », et quand ce sont les prix
 * d'un autre serveur : « HDV de Tylezia du 02/10/2026, chargés pour Mon serveur ».
 */
export function marketWhere(src: Pick<MarketSource, 'serverName' | 'originServer' | 'exportDate'>): string {
  const origin = marketOriginMismatch(src)
  const name = origin ?? src.serverName
  return `HDV${name ? ` de ${name}` : ''} du ${frenchDay(src.exportDate)}${origin ? `, chargés pour ${src.serverName}` : ''}`
}

/**
 * Prix d'un autre serveur chargés pour celui-ci (export de « Tylezia » utilisé par « Mon serveur ») :
 * le nom du serveur de l'export, sinon null (même serveur, ou origine inconnue).
 */
export function marketOriginMismatch(src: Pick<MarketSource, 'serverName' | 'originServer'> | null | undefined): string | null {
  const origin = src?.originServer?.trim()
  const name = src?.serverName?.trim()
  if (!origin || !name) return null
  return slugify(origin) === slugify(name) ? null : origin
}

type SourceLike = MarketSource | MarketSnapshot | null | undefined

function rowsOf(src: SourceLike): Record<string, MarketTuple> | null {
  return src ? src.rows : null
}

function statOf(src: SourceLike, stat?: PriceStat): PriceStat {
  if (stat) return stat
  return src && 'stat' in src ? src.stat : 'auto'
}

/** Prix de marché d'un objet (null = absent ou sans vente). */
export function snapshotPrice(src: SourceLike, id: number, stat?: PriceStat): number | null {
  const t = rowsOf(src)?.[String(id)]
  return t ? priceFromRow(t, statOf(src, stat)) : null
}

export interface MarketDepth {
  sold24: number
  sold7: number
  sold30: number
  /** Ventes moyennes par jour sur 30 jours (vendus_30j ÷ 30). */
  perDayAvg: number
  /** Kamas échangés par jour. */
  kamasPerDay: number
}

/** Liquidité d'un objet sur ce serveur (null = absent de l'export, ou export sans volumes : inconnue). */
export function marketDepth(src: SourceLike, id: number): MarketDepth | null {
  const t = rowsOf(src)?.[String(id)]
  if (!t || !volumeKnown(src)) return null
  return { sold24: t[TUPLE.sold24], sold7: t[TUPLE.sold7], sold30: t[TUPLE.sold30], perDayAvg: t[TUPLE.sold30] / 30, kamasPerDay: t[TUPLE.kamasPerDay] }
}

/** Rapport moyenne 30 j ÷ médiane 30 j au-delà duquel une médiane sans vente récente est peu fiable. */
export const UNRELIABLE_MEAN_RATIO = 2

/**
 * Médiane 30 j peu fiable pour un ACHAT (revue UX2-02) : moins de 5 ventes en 24 h (le prix retenu est la
 * médiane 30 j) et moyenne 30 j plus de 2 fois la médiane — l'offre bon marché du mois s'est tarie
 * (Tylezia, Grand Élixir d'Abreuvoir : 0 vente en 24 h, médiane 2 872, moyenne 9 145). Rend le prix prudent
 * (moyenne 30 j) et la raison, sinon null.
 */
export function unreliableMedian(src: SourceLike, id: number): { prudentPrice: number; median30: number; mean30: number; sold24: number; sold7: number; reason: string } | null {
  const t = rowsOf(src)?.[String(id)]
  if (!t) return null
  const median30 = t[TUPLE.median30]
  const mean30 = t[TUPLE.mean30]
  if (!(median30 > 0) || !(mean30 > UNRELIABLE_MEAN_RATIO * median30) || t[TUPLE.sold24] >= AUTO_MIN_SOLD_24H) return null
  return {
    prudentPrice: mean30,
    median30,
    mean30,
    sold24: t[TUPLE.sold24],
    sold7: t[TUPLE.sold7],
    reason: `médiane 30 j peu fiable (${t[TUPLE.sold24]} vente${t[TUPLE.sold24] > 1 ? 's' : ''} en 24 h, moyenne 30 j ${Math.round(mean30).toLocaleString('fr-FR')} > ${UNRELIABLE_MEAN_RATIO} × médiane ${Math.round(median30).toLocaleString('fr-FR')}) : chiffré à la moyenne 30 j`,
  }
}

/** Part du volume quotidien moyen qu'une production peut écouler sans saturer le marché (défaut 15 %). */
export const DEFAULT_MAX_MARKET_SHARE = 0.15

/**
 * Quantité vendable par jour sans dépasser `share` du volume quotidien moyen (30 j) ; null si l'objet est
 * absent de l'export (liquidité inconnue).
 */
export function sellablePerDay(src: SourceLike, id: number, share = DEFAULT_MAX_MARKET_SHARE): number | null {
  const d = marketDepth(src, id)
  return d ? Math.floor(d.perDayAvg * share) : null
}

/**
 * Prix de l'objet-monture d'une espèce sur ce serveur : indication de marché seulement (« HDV mixte » :
 * niveaux, fertile/stérile et montures séniles d'avant la 3.5 mélangés). Jamais un prix d'achat pour
 * extraire sans avertissement.
 */
export function marketMountReference(src: SourceLike, speciesId: number, stat?: PriceStat): { itemId: number; price: number | null; depth: MarketDepth | null; mixed: true } | null {
  const itemId = getSpecies(speciesId)?.itemId
  if (!itemId) return null
  return { itemId, price: snapshotPrice(src, itemId, stat), depth: marketDepth(src, itemId), mixed: true }
}

export const MOUNT_MARKET_NOTE =
  'HDV mixte : le prix d’un objet-monture mélange niveaux, états (fertile, stérile) et montures séniles d’avant la 3.5 (extraction = 1 ressource). Indication de marché seulement.'

// ---------- Valeur du généton ----------

export interface GenetonMarketLine extends GenetonShopItem {
  /** Prix unitaire brut (statistique du serveur), null = sans prix. */
  price: number | null
  /** Kamas bruts par généton (prix ÷ coût). */
  perGeneton: number | null
  /** Ventes sur 24 h (liquidité). */
  sold24: number
}

export interface GenetonMarketValue {
  /** Valeur brute d'un généton (kamas) : meilleur prix ÷ coût parmi les échanges retenus. */
  value: number
  /** Valeur nette de la taxe de vente. */
  net: number
  best: GenetonMarketLine
  /** Lignes retenues (échanges reconfirmés par défaut), de la meilleure à la moins bonne (sans prix en dernier). */
  lines: GenetonMarketLine[]
  /** Échanges reconfirmés seulement (Puissants Parchemins, 160 génétons). */
  confirmedOnly: boolean
  /**
   * Valeur optimiste : meilleur échange de TOUTE la boutique (capture de la bêta, non reconfirmée), si
   * elle est plus haute — affichée en alternative, jamais comptée par défaut.
   */
  optimistic: { value: number; net: number; best: GenetonMarketLine } | null
}

/**
 * Valeur du généton sur ce serveur : max(prix ÷ coût) sur la boutique d'Eugène Éton, brute et nette de
 * taxe. Par défaut (`confirmedOnly`) seulement les échanges reconfirmés après la 3.5 (Puissants
 * Parchemins, 160 génétons) ; la meilleure valeur de toute la boutique (Petits 10, normaux 50, Grands
 * 100, Tourmaline 130 : capture de la bêta) est rendue à part (`optimistic`). null si aucun objet retenu
 * n'a de prix.
 */
export function genetonValueFromMarket(src: SourceLike, saleTax = 0.02, stat?: PriceStat, opts: { confirmedOnly?: boolean } = {}): GenetonMarketValue | null {
  const confirmedOnly = opts.confirmedOnly ?? true
  const all: GenetonMarketLine[] = GENETON_SHOP.map((g) => {
    const price = snapshotPrice(src, g.id, stat)
    return { ...g, price, perGeneton: price === null ? null : price / g.cost, sold24: marketDepth(src, g.id)?.sold24 ?? 0 }
  })
  all.sort((a, b) => (b.perGeneton ?? -1) - (a.perGeneton ?? -1) || a.cost - b.cost)
  const lines = confirmedOnly ? all.filter((l) => l.confirmed) : all
  const best = lines[0]
  if (!best || best.perGeneton === null) return null
  const top = all[0]
  const optimistic = confirmedOnly && top && top.perGeneton !== null && top.perGeneton > best.perGeneton + 1e-9 ? { value: top.perGeneton, net: top.perGeneton * (1 - saleTax), best: top } : null
  return { value: best.perGeneton, net: best.perGeneton * (1 - saleTax), best, lines, confirmedOnly, optimistic }
}

// ---------- Évolution entre deux imports ----------

function isSourceLike(x: unknown): x is MarketSnapshot | MarketSource {
  return isObj(x) && isObj(x.rows) && typeof x.exportDate === 'string'
}

/** Objets suivis d'un import à l'autre (ressources d'extraction, runes Ga, Tourmaline, parchemins…). */
export const KEY_MARKET_IDS: number[] = [
  ...FAMILY_IDS.map((f) => FAMILIES[f].extractionItemId),
  RUNE_GA_PA,
  RUNE_GA_PME,
  TOURMALINE,
  PEPITE,
  PARCHEMIN_ELEVEUR,
  ...GENETON_SHOP.filter((g) => g.cost === 160).map((g) => g.id),
  32521, // Filet de capture universel
  33331, // Extrait de Mangeoire
]

/** Prix clés d'un instantané (statistique donnée) : id → prix (objets sans prix omis). */
export function keyPrices(src: SourceLike, stat?: PriceStat, ids: number[] = KEY_MARKET_IDS): Record<string, number> {
  const out: Record<string, number> = {}
  for (const id of ids) {
    const p = snapshotPrice(src, id, stat)
    if (p !== null) out[String(id)] = p
  }
  return out
}

export interface PriceChange {
  id: number
  name: string
  before: number | null
  after: number | null
  /** Variation relative (after ÷ before − 1), null si l'un des deux manque. */
  change: number | null
}

/**
 * Variations de prix entre un import précédent (prix clés ou instantané) et le nouvel instantané, triées
 * par variation absolue décroissante (objets apparus ou disparus en fin de liste). `minChange` : seuil
 * de variation relative (défaut 0 = toutes les lignes).
 */
export function diffPrices(
  before: Record<string, number> | MarketSnapshot | MarketSource,
  after: Record<string, number> | MarketSnapshot | MarketSource,
  opts: { ids?: number[]; stat?: PriceStat; minChange?: number; names?: Record<string, string> } = {},
): PriceChange[] {
  const priceOf = (src: Record<string, number> | MarketSnapshot | MarketSource, id: number): number | null =>
    isSourceLike(src) ? snapshotPrice(src, id, opts.stat) : ((src as Record<string, number>)[String(id)] ?? null)
  const ids = opts.ids ?? KEY_MARKET_IDS
  const min = opts.minChange ?? 0
  const out: PriceChange[] = []
  for (const id of ids) {
    const b = priceOf(before, id)
    const a = priceOf(after, id)
    if (b === null && a === null) continue
    const change = a !== null && b !== null && b > 0 ? a / b - 1 : null
    if (change !== null && Math.abs(change) < min) continue
    out.push({ id, name: marketItemName(id, opts.names), before: b, after: a, change })
  }
  return out.sort((x, y) => (y.change === null ? -1 : Math.abs(y.change)) - (x.change === null ? -1 : Math.abs(x.change)))
}

// ---------- Historique des imports ----------

export interface MarketHistoryEntry {
  importedAt: number
  exportDate: string
  source: string
  serverName: string
  /** Objets utiles avec un prix. */
  useful: number
  recognized: number
  read: number
  /** Prix clés (statistique automatique) pour suivre l'évolution. */
  keyPrices: Record<string, number>
}

/** Nombre d'imports gardés dans l'historique d'un serveur. */
export const MARKET_HISTORY_MAX = 30

/** Entrée d'historique d'un instantané. */
export function historyEntryOf(snapshot: MarketSnapshot): MarketHistoryEntry {
  return {
    importedAt: snapshot.importedAt,
    exportDate: snapshot.exportDate,
    source: snapshot.source,
    serverName: snapshot.serverName,
    useful: snapshot.stats.useful,
    recognized: snapshot.stats.recognized,
    read: snapshot.stats.read,
    keyPrices: keyPrices(snapshot, 'auto'),
  }
}

/** Historique normalisé (entrées illisibles retirées, plus récent en dernier, au plus MARKET_HISTORY_MAX). */
export function sanitizeHistory(raw: unknown): { entries: MarketHistoryEntry[]; dropped: number } {
  const list = isObj(raw) && Array.isArray(raw.entries) ? raw.entries : []
  const entries: MarketHistoryEntry[] = []
  let dropped = 0
  for (const e of list) {
    if (!isObj(e) || !nonNeg(e.importedAt) || typeof e.exportDate !== 'string') {
      dropped++
      continue
    }
    const kp: Record<string, number> = {}
    if (isObj(e.keyPrices)) for (const [k, v] of Object.entries(e.keyPrices)) if (/^\d+$/.test(k) && nonNeg(v) && v > 0) kp[k] = v
    entries.push({
      importedAt: e.importedAt,
      exportDate: e.exportDate,
      source: typeof e.source === 'string' ? e.source : '',
      serverName: typeof e.serverName === 'string' ? e.serverName : '',
      useful: nonNeg(e.useful) ? e.useful : 0,
      recognized: nonNeg(e.recognized) ? e.recognized : 0,
      read: nonNeg(e.read) ? e.read : 0,
      keyPrices: kp,
    })
  }
  entries.sort((a, b) => a.importedAt - b.importedAt)
  return { entries: entries.slice(-MARKET_HISTORY_MAX), dropped }
}

/**
 * Prix clés avant → après un import (aperçu de la page Prix) comparés À STATISTIQUE ÉGALE : avec
 * l'instantané courant du serveur, sa statistique (`stat`) des deux côtés ; sinon les prix clés du dernier
 * import de l'historique, enregistrés en statistique automatique, donc comparés en `auto` (comparer
 * l'historique `auto` au nouvel export en médiane 30 j inventerait des variations, ex. Corne +14 %).
 * Noms : ceux des deux exports, puis les noms connus (jamais « Objet #… » pour un prix clé).
 */
export function importPriceChanges(
  preview: MarketSnapshot,
  previous: { snapshot?: MarketSnapshot | null; history?: MarketHistoryEntry | null },
  stat: PriceStat,
): { changes: PriceChange[]; stat: PriceStat; previousDate: string | null } {
  if (previous.snapshot) {
    const names = { ...previous.snapshot.names, ...preview.names }
    return { changes: diffPrices(keyPrices(previous.snapshot, stat), preview, { stat, names }), stat, previousDate: previous.snapshot.exportDate || null }
  }
  if (previous.history) return { changes: diffPrices(previous.history.keyPrices, preview, { stat: 'auto', names: preview.names }), stat: 'auto', previousDate: previous.history.exportDate || null }
  return { changes: [], stat, previousDate: null }
}

// ---------- Remplacer ou compléter un instantané ----------

/** Part minimale d'objets avec un prix (par rapport aux prix actuels) sous laquelle un remplacement est confirmé. */
export const IMPORT_COVERAGE_MIN_RATIO = 0.5

/**
 * Un import couvre-t-il nettement moins d'objets que les prix actuels du serveur ? (fichier partiel :
 * le remplacement effacerait les prix des objets absents — proposer de compléter, confirmer.)
 */
export function importCoverageDrop(current: MarketSnapshot | null | undefined, incoming: MarketSnapshot): { drop: boolean; currentUseful: number; incomingUseful: number; ratio: number | null } {
  const currentUseful = current?.stats.useful ?? 0
  const incomingUseful = incoming.stats.useful
  const ratio = currentUseful > 0 ? incomingUseful / currentUseful : null
  return { drop: ratio !== null && ratio < IMPORT_COVERAGE_MIN_RATIO, currentUseful, incomingUseful, ratio }
}

/**
 * Complète un instantané par un nouvel export (« fusionner ») : les objets du nouvel export remplacent
 * ceux de l'ancien, les objets absents du nouveau fichier gardent leur ligne précédente. Serveur du nouvel
 * export ; date = la PLUS ANCIENNE des deux tant que des objets de l'ancien export restent (la fraîcheur
 * affichée ne doit pas rajeunir des prix qui ne l'ont pas été) ; origine notée « complété ». Colonnes
 * absentes : celles des deux (prudent).
 */
export function mergeSnapshots(base: MarketSnapshot, incoming: MarketSnapshot, opts: { importedAt?: number } = {}): MarketSnapshot {
  const rows: Record<string, MarketTuple> = { ...base.rows, ...incoming.rows }
  const names = { ...base.names, ...incoming.names }
  const hdv: HdvRow[] = Object.entries(rows).map(([id, t]) => ({
    id: Number(id),
    name: names[id] ?? '',
    level: null,
    type: '',
    category: '',
    median30: t[TUPLE.median30],
    mean30: t[TUPLE.mean30],
    median24: t[TUPLE.median24],
    sold24: t[TUPLE.sold24],
    sold7: t[TUPLE.sold7],
    sold30: t[TUPLE.sold30],
    kamasPerDay: t[TUPLE.kamasPerDay],
  }))
  const kept = Object.keys(base.rows).filter((id) => !(id in incoming.rows)).length
  const missingColumns = [...new Set([...(base.missingColumns ?? []), ...(incoming.missingColumns ?? [])])]
  const oldest = kept > 0 && isIsoDay(base.exportDate) && (!isIsoDay(incoming.exportDate) || base.exportDate < incoming.exportDate) ? base.exportDate : incoming.exportDate
  const merged = buildSnapshot(hdv, {
    serverName: incoming.serverName,
    exportDate: oldest,
    source: `${incoming.source || 'export'} (${frenchDay(incoming.exportDate)}) — complété par ${kept.toLocaleString('fr-FR')} objet${kept > 1 ? 's' : ''} de l’export du ${frenchDay(base.exportDate)}`.slice(0, 200),
    importedAt: opts.importedAt ?? incoming.importedAt,
    missingColumns,
  })
  return { ...merged, names }
}

/**
 * Serveur évoqué par le nom d'un fichier d'export (« tylezia-2026-10-02.csv » → « Tylezia ») parmi des
 * noms connus (serveurs du registre, préréglages) : le plus long nom trouvé comme suite de mots du nom
 * du fichier, sinon null.
 */
export function serverNameInFileName(fileName: string, names: string[]): string | null {
  const words = slugify(fileName.replace(/\.[a-z0-9]+$/i, '')).split('-').filter(Boolean)
  let best: string | null = null
  let bestLen = 0
  for (const n of names) {
    const target = slugify(n).split('-').filter(Boolean)
    if (!target.length) continue
    for (let i = 0; i + target.length <= words.length; i++) {
      if (target.every((w, j) => words[i + j] === w)) {
        const len = target.join('-').length
        if (len > bestLen) {
          best = n
          bestLen = len
        }
        break
      }
    }
  }
  return best
}

// ---------- Divers ----------

/** Identifiant de fichier : « Tylezia » → « tylezia ». */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Âge d'un export en jours (date de l'export → aujourd'hui, AAAA-MM-JJ). */
export function exportAgeDays(exportDate: string, todayIso: string): number | null {
  if (!isIsoDay(exportDate) || !isIsoDay(todayIso)) return null
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  return Math.round((t(todayIso) - t(exportDate)) / 86_400_000)
}

/** « 02/10/2026 » d'une date AAAA-MM-JJ (affichage). */
export function frenchDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

/** Export de plus de 14 jours : prix à rafraîchir. */
export const MARKET_STALE_DAYS = 14

/** Au-delà de ce nombre de jours, l'export est jugé périmé (au-delà de `MARKET_STALE_DAYS` : à rafraîchir). */
export const MARKET_OLD_DAYS = 30
