import { useState } from 'react'
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
          <Page />
        </main>
      </div>
    </div>
  )
}
