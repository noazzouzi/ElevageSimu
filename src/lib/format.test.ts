/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { capitalize, formatChars, formatDuration, formatInDays, formatIsoDay, formatKamas, formatKamasRange, plural, pluralWord } from './format'

describe('formatDuration (helper unique)', () => {
  it('format court par défaut', () => {
    expect(formatDuration(45)).toBe('45 s')
    expect(formatDuration(25 * 60)).toBe('25 min')
    expect(formatDuration(4 * 3600 + 9 * 60)).toBe('4 h 09')
    expect(formatDuration(26 * 3600 + 5 * 60)).toBe('1 j 2 h')
    expect(formatDuration(Infinity)).toBe('∞')
    expect(formatDuration(-5)).toBe('0 s')
  })
  it('format long (ancien formatDuration de paddock.ts) : minutes explicites', () => {
    expect(formatDuration(4 * 3600 + 9 * 60, { long: true })).toBe('4 h 09 min')
    expect(formatDuration(26 * 3600 + 5 * 60, { long: true })).toBe('1 j 2 h 05 min')
    expect(formatDuration(25 * 60, { long: true })).toBe('25 min')
    expect(formatDuration(30, { long: true })).toBe('30 s')
  })
})

describe('accords et dates', () => {
  it('pluriel français (à partir de 2)', () => {
    expect(plural(0, 'monture')).toBe('0 monture')
    expect(plural(1, 'monture')).toBe('1 monture')
    expect(plural(3, 'enclos', 'enclos')).toBe('3 enclos')
    expect(pluralWord(2, 'cheval', 'chevaux')).toBe('chevaux')
    expect(plural(1234, 'entrée').replace(/\s/g, ' ')).toBe('1 234 entrées')
  })
  it('formatInDays', () => {
    expect(formatInDays(0)).toBe('aujourd’hui')
    expect(formatInDays(1)).toBe('demain')
    expect(formatInDays(12)).toBe('dans 12 jours')
    expect(formatInDays(-3)).toBe('il y a 3 jours')
  })
  it('capitalize', () => {
    expect(capitalize('lundi')).toBe('Lundi')
    expect(capitalize('')).toBe('')
  })
  it('formatIsoDay ne dépend pas du fuseau du navigateur', () => {
    const tz = process.env.TZ
    try {
      for (const zone of ['Pacific/Kiritimati', 'America/Los_Angeles', 'Europe/Paris']) {
        process.env.TZ = zone
        expect(formatIsoDay('2026-10-12')).toBe('lundi 12 octobre')
        expect(formatIsoDay('2026-10-12', { year: true })).toBe('lundi 12 octobre 2026')
      }
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })
})

describe('formatKamasRange (bornes, jamais « ≈ »)', () => {
  it('exact, intervalle, borne haute, borne basse ou inconnu', () => {
    const k = (n: number) => formatKamas(n)
    expect(formatKamasRange({ low: 1_000, high: 1_000 })).toBe(k(1_000))
    expect(formatKamasRange({ low: -2_000, high: 5_000 })).toBe(`${k(-2_000)} à ${k(5_000)}`)
    expect(formatKamasRange({ low: null, high: 5_000 })).toBe(`≤ ${k(5_000)}`)
    expect(formatKamasRange({ low: 7_000, high: null })).toBe(`≥ ${k(7_000)}`)
    expect(formatKamasRange({ low: null, high: null })).toBe('inconnu')
  })
})

describe('formatChars (place occupée, unité du quota du navigateur)', () => {
  it('caractères, k caractères, M caractères', () => {
    expect(formatChars(1)).toBe('1 caractère')
    expect(formatChars(850)).toBe('850 caractères')
    expect(formatChars(88_885)).toBe('88,9 k caractères')
    expect(formatChars(5 * 1024 * 1024)).toBe('5,24 M caractères')
  })
})
