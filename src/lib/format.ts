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

/** Probabilité 0…1 → « 30,3 % ». */
export function formatPercent(p: number, digits = 1): string {
  if (!Number.isFinite(p)) return '—'
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(p * 100)} %`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '∞'
  const s = Math.max(0, Math.round(seconds))
  const d = Math.floor(s / 86_400)
  const h = Math.floor((s % 86_400) / 3_600)
  const m = Math.floor((s % 3_600) / 60)
  if (d > 0) return `${d} j ${h} h`
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`
  if (m > 0) return `${m} min`
  return `${s} s`
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
