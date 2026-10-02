// @vitest-environment jsdom
// Alarmes globales des plans d'enclos (R6) : la notification part sur n'importe quelle page, une seule
// fois par changement (pas de répétition en changeant de page ni en rechargeant l'application).
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { useInventory } from '../store/inventory'
import { usePaddockPlans, type NewPaddockPlan } from '../store/paddockPlans'
import { initialPaddocks, usePaddocks } from '../store/paddocks'
import { DEFAULT_SETTINGS, useSettings } from '../store/settings'
import { DueSwitchBanner, useAlarmPrefs } from './alarms'

const calls: { title: string; body?: string }[] = []

class FakeNotification {
  static permission: NotificationPermission = 'granted'
  static requestPermission = () => Promise.resolve('granted' as NotificationPermission)
  constructor(title: string, opts?: NotificationOptions) {
    calls.push({ title, body: opts?.body })
  }
}

function planDueIn(ms: number): NewPaddockPlan {
  const now = Date.now()
  return {
    paddockId: 1,
    startedAt: now - 3_600_000 + ms,
    tier: 2,
    withXp: false,
    rulesetId: '3.6',
    almanaxDoubled: null,
    mountIds: [],
    fecundAt: {},
    totalSeconds: 7_200,
    steps: [
      { gauges: ['foudroyeur', 'abreuvoir'], startSeconds: 0, durationSeconds: 3_600, purpose: 'Endurance', consumed: {} },
      { gauges: ['dragofesse', 'caresseur'], startSeconds: 3_600, durationSeconds: 3_600, purpose: 'Amour', consumed: {} },
    ],
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  calls.length = 0
  window.localStorage.clear()
  vi.stubGlobal('Notification', FakeNotification)
  useSettings.setState({ ...DEFAULT_SETTINGS })
  useInventory.setState({ mounts: [] })
  usePaddocks.setState({ paddocks: initialPaddocks() })
  usePaddockPlans.setState({ plans: {} })
  useAlarmPrefs.setState({ supported: true, permission: 'granted', wanted: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '#/')
})

describe('alarmes globales des plans d’enclos (R6)', () => {
  it('notifie sur l’accueil, une seule fois malgré les changements de page et un rechargement', async () => {
    window.history.replaceState(null, '', '#/accueil')
    usePaddockPlans.getState().start(planDueIn(10_000))
    const first = render(<App />)
    expect(calls).toHaveLength(0)
    await act(async () => {
      vi.advanceTimersByTime(11_000)
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].title).toBe('ElevageSimu — Enclos 1')
    expect(calls[0].body).toMatch(/Désactiver Foudroyeur et Abreuvoir, activer Dragofesse et Caresseur/)

    // Aller sur la page Enclos puis revenir : pas de nouvelle notification.
    await act(async () => {
      window.location.hash = '#/enclos'
      vi.advanceTimersByTime(2_000)
    })
    await act(async () => {
      window.location.hash = '#/accueil'
      vi.advanceTimersByTime(61_000)
    })
    expect(calls).toHaveLength(1)

    // « Rechargement » : l'application remontée ne répète pas l'alarme déjà notifiée.
    first.unmount()
    render(<App />)
    await act(async () => {
      vi.advanceTimersByTime(61_000)
    })
    expect(calls).toHaveLength(1)
  })

  it('notifications coupées : rien n’est envoyé, et l’alarme passée ne part pas en rafale à l’activation', async () => {
    useAlarmPrefs.setState({ wanted: false })
    window.history.replaceState(null, '', '#/accueil')
    usePaddockPlans.getState().start(planDueIn(5_000))
    render(<App />)
    await act(async () => {
      vi.advanceTimersByTime(6_000)
    })
    expect(calls).toHaveLength(0)
    await act(async () => {
      useAlarmPrefs.getState().setWanted(true)
      vi.advanceTimersByTime(61_000)
    })
    expect(calls).toHaveLength(0)
  })

  it('rappel dans l’application sur les autres pages, avec les boutons « Fait »', async () => {
    usePaddockPlans.getState().start(planDueIn(-60_000))
    render(<DueSwitchBanner pageId="prix" />)
    expect(screen.getByRole('status').textContent).toMatch(/Enclos 1/)
    await act(async () => {
      screen.getByRole('button', { name: "Fait à l'heure" }).click()
    })
    expect(usePaddockPlans.getState().plans['1'].acknowledgedStepIndex).toBe(1)
    expect(usePaddocks.getState().paddocks[0].active).toEqual(['dragofesse', 'caresseur'])
  })

  it('pas de rappel en double sur l’accueil et la page Enclos', () => {
    usePaddockPlans.getState().start(planDueIn(-60_000))
    const { container } = render(<DueSwitchBanner pageId="accueil" />)
    expect(container.textContent).toBe('')
  })
})
