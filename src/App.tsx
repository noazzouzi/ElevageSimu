import { Component, Suspense, useState, type ErrorInfo, type ReactNode } from 'react'
import { DueSwitchBanner, PlanAlarms } from './ui/alarms'
import { DataRecoveryActions } from './ui/components'
import { PAGES } from './ui/pages/registry'
import { href, useRoute } from './ui/router'

const SECTIONS = ['Piloter', 'Simuler', 'Économie', 'Aide'] as const

export default function App() {
  const route = useRoute()
  const [menuOpen, setMenuOpen] = useState(false)
  const page = PAGES.find((p) => p.id === route.page) ?? PAGES[0]
  const Page = page.component
  return (
    <div className="app">
      <aside className={`sidebar${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(false)}>
        <a className="brand" href={href('accueil')} style={{ color: 'inherit', textDecoration: 'none' }}>
          <img src="./favicon.svg" alt="" />
          <span>ElevageSimu</span>
        </a>
        {SECTIONS.map((section) => (
          <nav key={section} aria-label={section}>
            <div className="nav-section">{section}</div>
            {PAGES.filter((p) => p.section === section).map((p) => (
              <a key={p.id} href={href(p.id)} className={`nav-link${p.id === page.id ? ' active' : ''}`} title={p.description}>
                <span className="ico" aria-hidden>
                  {p.icon}
                </span>
                {p.title}
              </a>
            ))}
          </nav>
        ))}
        <div className="spacer" />
        <small style={{ padding: '8px 10px' }}>
          Système d'élevage Dofus 3.5+. Outil non officiel, sans lien avec Ankama.
        </small>
      </aside>
      <div>
        <div className="mobile-bar">
          <button className="btn small" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">
            ☰
          </button>
          <strong>
            {page.icon} {page.title}
          </strong>
        </div>
        <main className="main">
          {/* Alarmes des plans d'enclos : actives quelle que soit la page affichée. */}
          <AlarmBoundary>
            <PlanAlarms />
            <DueSwitchBanner pageId={page.id} />
          </AlarmBoundary>
          <PageBoundary key={page.id} title={page.title} routeKey={`${route.page}?${route.params.toString()}`}>
            <Suspense fallback={<p className="muted">Chargement de la page…</p>}>
              <Page />
            </Suspense>
          </PageBoundary>
        </main>
      </div>
    </div>
  )
}

/** Filet des alarmes globales : une erreur dans les alarmes ne doit jamais empêcher d'afficher la page. */
class AlarmBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erreur dans les alarmes des enclos', error, info.componentStack)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * Filet de sécurité par page : une erreur d'affichage (ou un fichier de page introuvable après une
 * mise à jour du site) n'efface pas toute l'application ; la navigation reste utilisable.
 */
class PageBoundary extends Component<{ title: string; routeKey: string; children: ReactNode }, { error: Error | null; routeKey: string }> {
  state: { error: Error | null; routeKey: string } = { error: null, routeKey: this.props.routeKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  /** Nouvelle adresse (autre onglet, autre enclos…) : on retente l'affichage au lieu de garder l'erreur. */
  static getDerivedStateFromProps(props: { routeKey: string }, state: { error: Error | null; routeKey: string }) {
    return props.routeKey !== state.routeKey ? { error: null, routeKey: props.routeKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Erreur dans la page « ${this.props.title} »`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <section className="card" role="alert">
        <h1>{this.props.title}</h1>
        <div className="callout danger">
          <strong>Cette page a rencontré une erreur et n'a pas pu s'afficher.</strong> Vos données ne sont pas touchées (elles restent enregistrées dans ce
          navigateur). Rechargez la page ; si le problème persiste, exportez une sauvegarde depuis les Réglages.
          <div className="muted" style={{ marginTop: 6 }}>
            Détail : {error.message}
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Recharger
          </button>
          <a className="btn" href={href('reglages')}>
            Réglages et sauvegarde
          </a>
        </div>
        <div style={{ marginTop: 12 }}>
          <DataRecoveryActions />
        </div>
      </section>
    )
  }
}
