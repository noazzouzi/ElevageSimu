// Routage minimal par hash (#/page?param=…), compatible hébergement statique.
import { useEffect, useState } from 'react'

export interface Route {
  page: string
  params: URLSearchParams
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const [page, query] = raw.split('?')
  return { page: page || 'accueil', params: new URLSearchParams(query ?? '') }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(page: string, params?: Record<string, string | number>) {
  const q = params ? new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() : ''
  window.location.hash = `#/${page}${q ? `?${q}` : ''}`
}

export function href(page: string, params?: Record<string, string | number>): string {
  const q = params ? new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() : ''
  return `#/${page}${q ? `?${q}` : ''}`
}
