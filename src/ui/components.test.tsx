// @vitest-environment jsdom
// NumberField : la saisie n'est validée qu'en quittant le champ (ou Entrée), jamais à chaque frappe.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStorageHealth } from '../store/persistence'
import { NumberField, PageHeader } from './components'

afterEach(() => {
  cleanup()
  useStorageHealth.setState({ issues: [] })
})

/** Champ branché sur un état (comme dans les pages), avec espion sur onChange. */
function setup(props: { initial: number; min?: number; max?: number; step?: number; integer?: boolean }) {
  const spy = vi.fn()
  function Harness() {
    const [v, setV] = useState(props.initial)
    return (
      <NumberField
        label="Champ"
        value={v}
        min={props.min}
        max={props.max}
        step={props.step}
        integer={props.integer}
        onChange={(x) => {
          spy(x)
          setV(x)
        }}
      />
    )
  }
  render(<Harness />)
  const input = screen.getByLabelText('Champ') as HTMLInputElement
  /** Frappe au clavier : le navigateur émet un InputEvent avec inputType. */
  const type = (...texts: string[]) => {
    for (const t of texts) fireEvent.input(input, { target: { value: t }, inputType: t.length ? 'insertText' : 'deleteContentBackward' })
  }
  return { spy, input, type }
}

describe('NumberField (R1)', () => {
  it('effacer 100 puis taper 87 donne 87 (et pas 187), validé une seule fois au blur', () => {
    const { spy, input, type } = setup({ initial: 100, min: 1, max: 200 })
    type('10', '1', '', '8', '87')
    expect(spy).not.toHaveBeenCalled()
    expect(input.value).toBe('87')
    fireEvent.blur(input)
    expect(spy.mock.calls).toEqual([[87]])
    expect(input.value).toBe('87')
  })

  it('min 5 : tout sélectionner puis taper 30 donne 30 (pas 50) ; la valeur intermédiaire est signalée, pas corrigée', () => {
    const { spy, input, type } = setup({ initial: 60, min: 5, max: 1440, step: 5 })
    type('3')
    expect(input.value).toBe('3')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText(/entre 5 et 1[\s ]?440/)).toBeTruthy()
    type('30')
    expect(input.getAttribute('aria-invalid')).toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(spy.mock.calls).toEqual([[30]])
  })

  it('min 30 : taper 90 donne 90 (pas 300)', () => {
    const { spy, input, type } = setup({ initial: 365, min: 30, max: 730, step: 30 })
    type('9', '90')
    fireEvent.blur(input)
    expect(spy.mock.calls).toEqual([[90]])
  })

  it('champ entier : 2.5 est arrondi au blur, jamais transmis tel quel', () => {
    const { spy, input, type } = setup({ initial: 2, min: 1, max: 6 })
    type('2.5')
    expect(screen.getByText(/Nombre entier/)).toBeTruthy()
    fireEvent.blur(input)
    expect(spy.mock.calls).toEqual([[3]])
  })

  it('champ décimal (step 0,5) : 2.5 est gardé', () => {
    const { spy, input, type } = setup({ initial: 3, min: 0.5, max: 24, step: 0.5 })
    type('2.5')
    fireEvent.blur(input)
    expect(spy.mock.calls).toEqual([[2.5]])
  })

  it('champ vidé puis quitté : aucune modification, la valeur précédente revient', () => {
    const { spy, input, type } = setup({ initial: 40, min: 1, max: 200 })
    type('4', '')
    fireEvent.blur(input)
    expect(spy).not.toHaveBeenCalled()
    expect(input.value).toBe('40')
  })

  it('hors bornes au blur : ramené dans les bornes', () => {
    const { spy, input, type } = setup({ initial: 40, min: 1, max: 200 })
    type('250')
    expect(screen.getByText(/ramenée à 200/)).toBeTruthy()
    fireEvent.blur(input)
    expect(spy.mock.calls).toEqual([[200]])
  })

  it('Échap annule la saisie en cours', () => {
    const { spy, input, type } = setup({ initial: 40, min: 1, max: 200 })
    type('12')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('40')
    fireEvent.blur(input)
    expect(spy).not.toHaveBeenCalled()
  })

  it('flèches et boutons du champ (événement sans inputType) : validé tout de suite', () => {
    const { spy, input } = setup({ initial: 40, min: 1, max: 200 })
    fireEvent.change(input, { target: { value: '41' } })
    expect(spy.mock.calls).toEqual([[41]])
  })

  it('valeur inchangée : onChange n’est pas appelé', () => {
    const { spy, input, type } = setup({ initial: 40, min: 1, max: 200 })
    type('4', '40')
    fireEvent.blur(input)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('alertes de stockage (R10)', () => {
  it('PageHeader affiche l’alerte d’écriture impossible avec les actions utiles', () => {
    render(<PageHeader title="Titre" />)
    expect(screen.queryByRole('alert')).toBeNull()
    act(() =>
      useStorageHealth.setState({
        issues: [{ key: 'elevagesimu:journal', kind: 'ecriture', label: 'Journal', message: 'Espace plein.', quota: true, at: 0 }],
      }),
    )
    expect(screen.getByRole('alert').textContent).toMatch(/Modifications non enregistrées/)
    expect(screen.getByRole('button', { name: 'Télécharger une sauvegarde' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Réessayer/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Titre' })).toBeTruthy()
  })
})
