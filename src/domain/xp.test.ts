import { describe, expect, it } from 'vitest'
import { craftXp, jobLevelFromXp, jobXpForLevel, mountLevelFromXp, mountXpBetween, mountXpForLevel } from './xp'

describe('XP', () => {
  it('table XP monture (guide DPLN)', () => {
    expect(mountXpForLevel(1)).toBe(0)
    expect(mountXpForLevel(40)).toBe(20_437)
    expect(mountXpForLevel(100)).toBe(172_668)
    expect(mountXpForLevel(200)).toBe(867_582)
    expect(mountLevelFromXp(172_668)).toBe(100)
    expect(mountLevelFromXp(172_667)).toBe(99)
    expect(mountXpBetween(100, 200)).toBe(867_582 - 172_668)
  })

  it('table XP métier : 10·L·(L−1)', () => {
    expect(jobXpForLevel(40)).toBe(15_600)
    expect(jobXpForLevel(120)).toBe(142_800)
    expect(jobXpForLevel(200)).toBe(398_000)
    expect(jobLevelFromXp(398_000)).toBe(200)
  })

  it('XP de craft : L XP au niveau de la recette, valeurs en jeu 99/80/66 au niveau 110', () => {
    expect(craftXp(5, 5, 5)).toBe(5)
    expect(craftXp(1, 1, 50)).toBe(10)
    expect(craftXp(100, 99, 5)).toBe(0)
    expect(craftXp(5, 106, 5)).toBe(0)
    // Capture DPLN : Optimakina niv. 109, Animakina niv. 107 et 105 au niveau de métier 110 (mechanics.md §7)
    expect([109, 107, 105].map((L) => craftXp(L, 110, 5))).toEqual([99, 80, 66])
  })
})
