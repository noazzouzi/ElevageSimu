// @vitest-environment jsdom
// Modal : le focus va au premier champ à l'ouverture seulement ; un nouveau rendu du parent (nouvelle
// fonction onClose, minuterie…) ne le déplace plus pendant la saisie (revue R11). SmileyPicker : choix
// rapide de la sérénité d'après le smiley.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SERENITY_BAND_MIDPOINT } from '../domain/mountFate'
import { Modal, SmileyPicker } from './MountEditor'

afterEach(() => cleanup())

describe('Modal', () => {
  it('un nouveau rendu du parent ne vole pas le focus du champ en cours de saisie', () => {
    const trigger: { rerender?: () => void } = {}
    function Parent() {
      const [n, setN] = useState(0)
      useEffect(() => {
        trigger.rerender = () => setN((x) => x + 1)
      }, [])
      return (
        // onClose est une nouvelle fonction à chaque rendu, comme dans MountsPage.
        <Modal title={`Fenêtre ${n}`} onClose={() => {}}>
          <label>
            Famille
            <select aria-label="Famille">
              <option>Muldo</option>
            </select>
          </label>
          <input aria-label="Nom" />
        </Modal>
      )
    }
    render(<Parent />)
    // À l'ouverture : premier champ.
    expect(document.activeElement).toBe(screen.getByLabelText('Famille'))
    const name = screen.getByLabelText('Nom')
    name.focus()
    expect(document.activeElement).toBe(name)
    act(() => trigger.rerender?.())
    act(() => trigger.rerender?.())
    expect(screen.getByRole('heading', { name: 'Fenêtre 2' })).toBeTruthy()
    expect(document.activeElement).toBe(name)
  })

  it('Échap appelle la dernière fonction onClose reçue', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(
      <Modal title="T" onClose={first}>
        <input aria-label="x" />
      </Modal>,
    )
    rerender(
      <Modal title="T" onClose={second}>
        <input aria-label="x" />
      </Modal>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('SmileyPicker', () => {
  it('un smiley d’une autre zone donne le milieu de la zone ; celui de la zone actuelle garde la valeur exacte', () => {
    const onChange = vi.fn()
    render(<SmileyPicker value={1_234} onChange={onChange} label="Smiley" allowUnknown />)
    fireEvent.click(screen.getByRole('button', { name: ':D' }))
    expect(onChange).toHaveBeenLastCalledWith(SERENITY_BAND_MIDPOINT.amour)
    fireEvent.click(screen.getByRole('button', { name: ':)' }))
    expect(onChange).toHaveBeenLastCalledWith(1_234)
    fireEvent.click(screen.getByRole('button', { name: '?' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole('button', { name: ':)' }).getAttribute('aria-pressed')).toBe('true')
  })
})
