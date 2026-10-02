// Alarmes des plans d'enclos, valables sur TOUTES les pages (montées une fois dans App.tsx) :
//  - `PlanAlarms` : notification du navigateur à l'heure de chaque changement de jauges (et quand la
//    fenêtre de sérénité est dépassée), une seule fois par changement : les alarmes notifiées sont
//    enregistrées dans le plan (`notified`), donc ni un changement de page ni un rechargement ne les
//    répètent ;
//  - `DueSwitchBanner` : rappel compact dans l'application (pages autres que l'accueil et les enclos,
//    qui ont déjà leurs propres alarmes), utile quand les notifications ne sont pas autorisées ;
//  - `NotificationControl` / `useAlarmPrefs` : réglage partagé des notifications ;
//  - `usePlanClock`, `useAdvancePlan` : horloge réveillée aux heures de changement et validation d'un
//    changement (plan + jauges actives), partagées avec la page Enclos.
// Les notifications ne fonctionnent que tant que l'application est ouverte (aucun service en arrière-plan).
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { validateActiveGauges } from '../domain/paddock'
import { planStatus, type PlanStatus } from '../domain/paddockPlanStatus'
import { capitalize, formatClock, formatDuration } from '../lib/format'
import { currentStep, nextAlarmWake, pendingAlarms, usePaddockPlans, type ActivePaddockPlan, type PendingAlarm } from '../store/paddockPlans'
import { usePaddocks } from '../store/paddocks'
import { Badge } from './components'
import { href } from './router'
import './alarms.css'

/** Clé localStorage du réglage « notifications des changements » (partagé par toutes les pages). */
export const NOTIF_KEY = 'elevagesimu:enclos-notifications'

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // stockage indisponible : réglage non mémorisé
  }
}

export type NotifPermission = NotificationPermission | 'unsupported'

const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window

interface AlarmPrefs {
  supported: boolean
  permission: NotifPermission
  /** Le joueur veut les notifications (réglage mémorisé) ; effectives seulement si `permission = granted`. */
  wanted: boolean
  setWanted: (v: boolean) => void
  request: () => Promise<void>
  /** Relit l'autorisation du navigateur et le réglage mémorisé (retour sur l'onglet, autre onglet). */
  refresh: () => void
}

const readPrefs = () => {
  const supported = notificationsSupported()
  return { supported, permission: (supported ? Notification.permission : 'unsupported') as NotifPermission, wanted: readLocal(NOTIF_KEY) === '1' }
}

export const useAlarmPrefs = create<AlarmPrefs>()((set) => ({
  ...readPrefs(),
  setWanted: (v) => {
    writeLocal(NOTIF_KEY, v ? '1' : '0')
    set({ wanted: v })
  },
  request: async () => {
    if (!notificationsSupported()) return
    const permission = await Notification.requestPermission()
    set({ permission })
    if (permission === 'granted') {
      writeLocal(NOTIF_KEY, '1')
      set({ wanted: true })
    }
  },
  refresh: () => set(readPrefs()),
}))

const enabledNow = () => {
  const s = useAlarmPrefs.getState()
  return s.supported && s.wanted && s.permission === 'granted'
}

/** Affiche une notification du navigateur si elles sont activées et autorisées ; renvoie vrai si elle a été envoyée. */
export function notify(title: string, body: string, tag: string): boolean {
  if (!enabledNow()) return false
  try {
    new Notification(title, { body, tag })
    return true
  } catch {
    // certains navigateurs (mobile) refusent le constructeur hors service worker
    return false
  }
}

/** Texte de la notification d'une alarme. */
export function alarmMessage(a: PendingAlarm, now: number): { title: string; body: string } {
  const title = `ElevageSimu — Enclos ${a.paddockId}`
  const text = capitalize(a.next.text)
  if (a.kind === 'late')
    return { title, body: `Fenêtre de changement dépassée (jusqu'à ${formatClock(a.next.latest ?? a.next.at, now)}) : ${text}, au plus vite.` }
  return { title, body: `À ${formatClock(a.next.at, now)} : ${text}.` }
}

/**
 * Planificateur des notifications (aucun affichage). Un seul minuteur, réglé sur la prochaine alarme de
 * tous les plans ; vérification aussi toutes les minutes et au retour sur l'onglet (les navigateurs
 * ralentissent les minuteurs des onglets en arrière-plan). Chaque alarme est notée dans son plan.
 */
export function PlanAlarms() {
  const plans = usePaddockPlans((s) => s.plans)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const now = Date.now()
    const pending = pendingAlarms(plans, now)
    if (pending.length === 0) return
    const byPaddock = new Map<number, string[]>()
    for (const a of pending) {
      const { title, body } = alarmMessage(a, now)
      notify(title, body, `enclos-${a.paddockId}`)
      byPaddock.set(a.paddockId, [...(byPaddock.get(a.paddockId) ?? []), a.key])
    }
    // Notée même si les notifications sont coupées : pas de rafale d'anciennes alarmes à leur activation.
    for (const [paddockId, keys] of byPaddock) usePaddockPlans.getState().markNotified(paddockId, keys)
  }, [plans, tick])

  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    const wake = nextAlarmWake(plans, Date.now())
    const timeout = wake === null ? null : window.setTimeout(bump, Math.min(2_147_000_000, Math.max(0, wake - Date.now() + 250)))
    const interval = window.setInterval(bump, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        useAlarmPrefs.getState().refresh()
        bump()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timeout !== null) window.clearTimeout(timeout)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [plans, tick])

  return null
}

/** Horloge qui avance toutes les 15 s, et pile à l'heure des prochains changements (et fins de fenêtre). */
export function usePlanClock(plans: Record<string, ActivePaddockPlan>): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [])
  const nextWake = useMemo(() => nextAlarmWake(plans, now), [plans, now])
  useEffect(() => {
    if (nextWake === null) return
    const id = window.setTimeout(() => setNow(Date.now()), Math.min(2_147_000_000, Math.max(0, nextWake - Date.now() + 250)))
    return () => window.clearTimeout(id)
  }, [nextWake])
  return now
}

/**
 * Validation d'un changement de jauges : avance le plan et reporte les nouvelles jauges actives dans
 * l'enclos, datées de l'heure réelle du changement (heure prévue pour « fait à l'heure »).
 */
export function useAdvancePlan(): (plan: ActivePaddockPlan, at?: number) => void {
  const advance = usePaddockPlans((s) => s.advance)
  const setActive = usePaddocks((s) => s.setActive)
  return (plan, at) => {
    const pr = currentStep(plan, Date.now())
    advance(plan.paddockId, at)
    if (pr.next && validateActiveGauges(pr.next.to) === null) setActive(plan.paddockId, pr.next.to, at ?? Math.min(pr.next.at, Date.now()))
  }
}

/** Réglage des notifications (autorisation du navigateur, activation, test). */
export function NotificationControl() {
  const prefs = useAlarmPrefs()
  const tip = "Prévenir à l'heure de chaque changement de jauges, tant que l'application est ouverte (n'importe quelle page)."
  if (!prefs.supported) return <Badge title={tip}>Notifications non prises en charge</Badge>
  if (prefs.permission === 'denied')
    return (
      <Badge tone="warn" title="Autorisez les notifications pour ce site dans les réglages du navigateur.">
        Notifications bloquées par le navigateur
      </Badge>
    )
  if (prefs.permission !== 'granted')
    return (
      <button className="btn" onClick={() => void prefs.request()} title={tip}>
        🔔 Activer les notifications
      </button>
    )
  const enabled = prefs.wanted
  return (
    <label className="row al-notif" title={tip}>
      <input type="checkbox" checked={enabled} onChange={(e) => prefs.setWanted(e.target.checked)} />
      🔔 Notifications des changements <small className="muted">(application ouverte, toute page)</small>
      {enabled && (
        <button className="btn small ghost" onClick={() => notify('ElevageSimu', 'Les alarmes des enclos fonctionnent.', 'test')}>
          Tester
        </button>
      )}
    </label>
  )
}

/** Phrase courte de l'état d'un plan qui demande une action. */
export function planStatusText(st: PlanStatus, now: number): string {
  const next = st.progress.next
  if (st.state === 'stale') return `plan dépassé (changement de ${next ? formatClock(next.at, now) : '—'} manqué) : relevez les sérénités et recalculez.`
  if (st.state === 'end-overdue') return `plan terminé depuis ${formatDuration(st.lateMs / 1000)} : coupez les jauges et enregistrez l'état du lot.`
  if (!next) return 'plan terminé.'
  return `à ${formatClock(next.at, now)} : ${capitalize(next.text)}${st.state === 'late' ? ' — fenêtre dépassée, faites-le au plus vite' : ''}.`
}

/**
 * Rappel des changements de jauges dus, sur les pages qui n'affichent pas déjà les alarmes (l'accueil et
 * la page Enclos ont les leurs). Boutons « Fait » pour les changements simples ; un plan dépassé renvoie
 * à la page de l'enclos (il faut recalculer).
 */
export function DueSwitchBanner({ pageId }: { pageId: string }) {
  const plans = usePaddockPlans((s) => s.plans)
  const now = usePlanClock(plans)
  const onAdvance = useAdvancePlan()
  if (pageId === 'accueil' || pageId === 'enclos') return null
  const due = Object.values(plans)
    .map((plan) => ({ plan, st: planStatus(plan, now) }))
    .filter(({ st }) => st.state !== 'running' && st.state !== 'finished')
    .sort((a, b) => (a.st.progress.next?.at ?? 0) - (b.st.progress.next?.at ?? 0))
  if (due.length === 0) return null
  return (
    <div className="al-banner" role="status" aria-live="polite">
      {due.map(({ plan, st }) => {
        const simple = st.state === 'due' || st.state === 'late'
        return (
          <div key={plan.paddockId} className={`al-row${st.state === 'due' ? '' : ' danger'}`}>
            <span className="al-text">
              ⏰ <strong>Enclos {plan.paddockId}</strong> — {planStatusText(st, now)}
            </span>
            <span className="al-actions">
              {simple && (
                <>
                  <button className="btn small primary" onClick={() => onAdvance(plan)} title="Le changement a été fait à l'heure prévue">
                    Fait à l'heure
                  </button>
                  <button className="btn small" onClick={() => onAdvance(plan, Date.now())} title="Le changement vient d'être fait : la suite du plan est décalée d'autant">
                    Fait maintenant
                  </button>
                </>
              )}
              <a className="btn small ghost" href={href('enclos', { enclos: plan.paddockId })}>
                Voir l'enclos
              </a>
            </span>
          </div>
        )
      })}
    </div>
  )
}
