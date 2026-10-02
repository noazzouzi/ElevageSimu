import { describe, expect, it } from 'vitest'
import { almanaxOn, upcomingAlmanax } from './almanax'

describe('Almanax', () => {
  it('reconnaît les bonus du 10 et Takeza', () => {
    expect(almanaxOn('2026-12-10')?.doubledGauge).toBe('dragofesse')
    expect(almanaxOn('2026-10-10')?.babyAbility).toBe('sage')
    expect(almanaxOn('2026-10-12')?.takeza).toBe(true)
    expect(almanaxOn('2026-10-11')).toBeNull()
  })
  it('liste les prochains bonus', () => {
    const list = upcomingAlmanax(new Date(2026, 9, 2).getTime(), 30)
    expect(list.map((e) => e.date)).toEqual(['2026-10-10', '2026-10-12'])
  })
})
