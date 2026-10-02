// Formatage FR (nombres, kamas, pourcentages, durées, dates).
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })

export function formatNumber(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '—'
  return (digits === 0 ? nf0 : digits === 1 ? nf1 : nf2).format(n)
}

/** Kamas : « 1 234 567 K », ou compact « 1,23 M K ». */
export function formatKamas(n: number | null | undefined, compact = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  if (compact) {
    const a = Math.abs(n)
    if (a >= 1e9) return `${nf2.format(n / 1e9)} Md K`
    if (a >= 1e6) return `${nf2.format(n / 1e6)} M K`
    if (a >= 1e4) return `${nf1.format(n / 1e3)} k K`
  }
  return `${nf0.format(Math.round(n))} K`
}

/**
 * Intervalle de kamas : exact (« 12 K »), « X à Y », « ≤ Y », « ≥ X » ou « inconnu » (bornes nulles =
 * inconnues). Ne présente jamais une borne comme une estimation (« ≈ »).
 */
export function formatKamasRange(r: { low: number | null; high: number | null }, compact = false): string {
  const f = (x: number) => formatKamas(x, compact)
  if (r.low !== null && r.high !== null) return Math.abs(r.high - r.low) < 0.5 ? f(r.low) : `${f(r.low)} à ${f(r.high)}`
  if (r.high !== null) return `≤ ${f(r.high)}`
  if (r.low !== null) return `≥ ${f(r.low)}`
  return 'inconnu'
}

/** Probabilité 0…1 → « 30,3 % ». */
export function formatPercent(p: number, digits = 1): string {
  if (!Number.isFinite(p)) return '—'
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(p * 100)} %`
}

/**
 * Durée lisible (helper unique de l'application) :
 *  - court (défaut, affichage compact) : « 45 s », « 25 min », « 4 h 09 », « 1 j 2 h » ;
 *  - `long` (textes de plan, consignes) : « 4 h 09 min », « 1 j 2 h 05 min ».
 * Durée infinie ou non numérique : « ∞ ».
 */
export function formatDuration(seconds: number, opts: { long?: boolean } = {}): string {
  if (!Number.isFinite(seconds)) return '∞'
  const s = Math.max(0, Math.round(seconds))
  const d = Math.floor(s / 86_400)
  const h = Math.floor((s % 86_400) / 3_600)
  const m = Math.floor((s % 3_600) / 60)
  const mm = String(m).padStart(2, '0')
  if (opts.long) {
    if (d > 0) return `${d} j ${h} h ${mm} min`
    if (h > 0) return `${h} h ${mm} min`
  } else {
    if (d > 0) return `${d} j ${h} h`
    if (h > 0) return `${h} h ${mm}`
  }
  if (m > 0) return `${m} min`
  return `${s} s`
}

/**
 * Taille d'une donnée enregistrée, en caractères (l'unité du quota du localStorage) : « 850 caractères »,
 * « 88,9 k caractères », « 1,25 M caractères ».
 */
export function formatChars(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) < 1000) return `${nf0.format(n)} ${Math.abs(n) >= 2 ? 'caractères' : 'caractère'}`
  if (Math.abs(n) < 1_000_000) return `${nf1.format(n / 1000)} k caractères`
  return `${nf2.format(n / 1_000_000)} M caractères`
}

/** Accord en nombre (règle française : pluriel à partir de 2) : `pluralWord(3, 'monture')` → « montures ». */
export function pluralWord(n: number, one: string, many = `${one}s`): string {
  return Math.abs(n) >= 2 ? many : one
}

/** Nombre + mot accordé : `plural(3, 'monture')` → « 3 montures », `plural(1, 'enclos', 'enclos')` → « 1 enclos ». */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${pluralWord(n, one, many)}`
}

/** Échéance en jours : « aujourd’hui », « demain », « dans 12 jours » (« il y a 3 jours » si négatif). */
export function formatInDays(n: number): string {
  if (n === 0) return 'aujourd’hui'
  if (n === 1) return 'demain'
  if (n === -1) return 'hier'
  return n > 0 ? `dans ${formatNumber(n)} jours` : `il y a ${formatNumber(-n)} jours`
}

/** Première lettre en majuscule. */
export function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

const isoDayLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const isoDayLongYear = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/**
 * Date de calendrier AAAA-MM-JJ en toutes lettres : « lundi 12 octobre » (`year` : « lundi 12 octobre
 * 2026 »). Indépendant du fuseau horaire du navigateur (la date affichée est celle de la chaîne).
 */
export function formatIsoDay(iso: string, opts: { year?: boolean } = {}): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (![y, m, d].every(Number.isFinite)) return iso
  return (opts.year ? isoDayLongYear : isoDayLong).format(Date.UTC(y, m - 1, d, 12))
}

const dtf = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
const df = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Heure locale lisible d'un instant (ms), avec le jour si ce n'est pas aujourd'hui. */
export function formatClock(ms: number, now = Date.now()): string {
  const sameDay = new Date(ms).toDateString() === new Date(now).toDateString()
  return sameDay ? new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : dtf.format(ms)
}

export function formatDate(ms: number): string {
  return df.format(ms)
}
