// @vitest-environment jsdom
// Page Montures : actions groupées « Marquer féconde » et « Définir le niveau… » (ux F2), une seule
// écriture dans le stockage par action groupée (R10).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectiveFertility } from '../../domain/mounts'
import type { Mount } from '../../domain/types'
import { useInventory } from '../../store/inventory'
import { useJournal } from '../../store/journal'
import { usePrices } from '../../store/prices'
import { STORE_KEYS } from '../../store/profiles'
import { DEFAULT_SETTINGS, useSettings } from '../../store/settings'
import MountsPage from './MountsPage'

let seq = 0
const mk = (over: Partial<Mount> = {}): Mount => ({
  id: `b${++seq}`,
  speciesId: 94,
  gender: seq % 2 ? 'male' : 'femelle',
  level: 1,
  ability: null,
  fertility: 'fertile',
  parents: [],
  serenity: 0,
  endurance: 0,
  maturity: 0,
  love: 0,
  location: { kind: 'etable' },
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})
beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '#/montures')
  useSettings.setState({ ...DEFAULT_SETTINGS })
  useJournal.setState({ entries: [] })
  usePrices.setState({ items: {}, mounts: {}, generations: {}, genetonValue: null, updatedAt: 0 })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Montures — actions groupées', () => {
  it('« Marquer féconde » met endurance, maturité et amour au maximum des fertiles sélectionnées, en une écriture', () => {
    const lot = [mk(), mk(), mk({ fertility: 'sterile' })]
    useInventory.setState({ mounts: lot })
    render(<MountsPage />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tout sélectionner (montures affichées)' }))
    const toolbar = screen.getByRole('toolbar', { name: 'Actions sur la sélection' })
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    fireEvent.click(within(toolbar).getByRole('button', { name: /Marquer féconde/ }))
    const inventoryWrites = writes.mock.calls.filter(([k]) => k === STORE_KEYS.inventory).length
    expect(inventoryWrites).toBe(1)
    const after = useInventory.getState().mounts
    expect(after.filter((m) => effectiveFertility(m) === 'feconde')).toHaveLength(2)
    expect(after.find((m) => m.fertility === 'sterile')?.endurance).toBe(0)
  })

  it('« Définir le niveau… » applique le niveau saisi aux montures sélectionnées', () => {
    useInventory.setState({ mounts: [mk({ level: 3 }), mk({ level: 12 })] })
    render(<MountsPage />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tout sélectionner (montures affichées)' }))
    const toolbar = screen.getByRole('toolbar', { name: 'Actions sur la sélection' })
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Définir le niveau…' }))
    const field = within(toolbar).getByRole('spinbutton')
    fireEvent.change(field, { target: { value: '55' } })
    fireEvent.blur(field)
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Appliquer' }))
    expect(useInventory.getState().mounts.map((m) => m.level)).toEqual([55, 55])
  })
})
