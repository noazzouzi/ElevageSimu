/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import {
  addIsoDays,
  almanaxAt,
  almanaxOn,
  isoDay,
  isoDaysBetween,
  nextServerDayStart,
  serverDay,
  serverDayChangeIfNotLocalMidnight,
  serverDayStart,
  serverUtcOffsetMs,
  upcomingAlmanax,
} from './almanax'

const HOUR = 3_600_000
const ORIGINAL_TZ = process.env.TZ

/** Exécute `fn` avec le fuseau horaire `tz` pour le processus (Node relit TZ à chaque changement). */
function inTimeZone<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz
  try {
    return fn()
  } finally {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ
    else process.env.TZ = ORIGINAL_TZ
  }
}

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe('Almanax', () => {
  it('reconnaît les bonus du 10 et Takeza', () => {
    expect(almanaxOn('2026-12-10')?.doubledGauge).toBe('dragofesse')
    expect(almanaxOn('2026-10-10')?.babyAbility).toBe('sage')
    expect(almanaxOn('2026-10-12')?.takeza).toBe(true)
    expect(almanaxOn('2026-10-11')).toBeNull()
  })
  it('liste les prochains bonus', () => {
    const list = upcomingAlmanax(Date.parse('2026-10-02T10:00:00Z'), 30)
    expect(list.map((e) => e.date)).toEqual(['2026-10-10', '2026-10-12'])
  })
})

describe('jour de jeu (heure de Paris)', () => {
  // 2026-10-11T23:30Z = 12/10 01:30 à Paris (Takeza en jeu) = 11/10 19:30 au Québec.
  const takezaNight = Date.parse('2026-10-11T23:30:00Z')
  // 2026-10-12T23:30Z = 13/10 01:30 à Paris (Takeza terminé) = 12/10 19:30 au Québec.
  const afterTakeza = Date.parse('2026-10-12T23:30:00Z')

  it.each(['America/Montreal', 'Europe/Paris', 'UTC', 'Indian/Reunion', 'Pacific/Kiritimati', 'America/Martinique'])(
    'donne le jour de Paris quel que soit le fuseau du navigateur (%s)',
    (tz) =>
      inTimeZone(tz, () => {
        expect(serverDay(takezaNight)).toBe('2026-10-12')
        expect(almanaxAt(takezaNight)?.takeza).toBe(true)
        expect(serverDay(afterTakeza)).toBe('2026-10-13')
        expect(almanaxAt(afterTakeza)).toBeNull()
        expect(upcomingAlmanax(takezaNight, 0).map((e) => e.name)).toEqual(['Takeza'])
      }),
  )

  it('la date locale du navigateur (isoDay) diffère au Québec : c’est le bogue corrigé', () =>
    inTimeZone('America/Montreal', () => {
      expect(isoDay(takezaNight)).toBe('2026-10-11')
      expect(almanaxOn(isoDay(takezaNight))).toBeNull()
    }))

  it('décalage de Paris : +2 h l’été, +1 h l’hiver', () => {
    expect(serverUtcOffsetMs(Date.parse('2026-07-01T12:00:00Z'))).toBe(2 * HOUR)
    expect(serverUtcOffsetMs(Date.parse('2026-12-01T12:00:00Z'))).toBe(1 * HOUR)
  })

  it('minuit à Paris, y compris autour du passage à l’heure d’hiver (25/10/2026)', () => {
    expect(serverDayStart('2026-07-02')).toBe(Date.parse('2026-07-01T22:00:00Z'))
    expect(serverDayStart('2026-10-25')).toBe(Date.parse('2026-10-24T22:00:00Z'))
    expect(serverDayStart('2026-10-26')).toBe(Date.parse('2026-10-25T23:00:00Z'))
    // 00:30 à Paris le 25/10 (encore en heure d'été) → prochain jour à minuit heure d'hiver.
    expect(nextServerDayStart(Date.parse('2026-10-24T22:30:00Z'))).toBe(Date.parse('2026-10-25T23:00:00Z'))
    expect(nextServerDayStart(Date.parse('2026-10-25T22:59:59Z'))).toBe(Date.parse('2026-10-25T23:00:00Z'))
    expect(serverDay(Date.parse('2026-10-25T22:59:59Z'))).toBe('2026-10-25')
    expect(serverDay(Date.parse('2026-10-25T23:00:00Z'))).toBe('2026-10-26')
  })

  it('les jours à venir ne sautent ni ne répètent de date au changement d’heure', () => {
    const start = Date.parse('2026-10-24T22:30:00Z')
    const days = Array.from({ length: 4 }, (_, i) => addIsoDays(serverDay(start), i))
    expect(days).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'])
    expect(isoDaysBetween('2026-10-24', '2026-11-02')).toBe(9)
    expect(addIsoDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('heure locale du changement de jour de jeu : 18:00 au Québec, rien à Paris', () => {
    inTimeZone('America/Montreal', () => {
      const at = serverDayChangeIfNotLocalMidnight('2026-10-11')
      expect(at).toBe(Date.parse('2026-10-11T22:00:00Z'))
      expect(new Date(at ?? 0).getHours()).toBe(18)
    })
    inTimeZone('Europe/Paris', () => {
      expect(serverDayChangeIfNotLocalMidnight('2026-10-11')).toBeNull()
      expect(serverDayChangeIfNotLocalMidnight(takezaNight)).toBeNull()
    })
  })
})
