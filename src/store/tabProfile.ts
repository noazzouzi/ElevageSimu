// Profil ouvert dans CET onglet (sessionStorage, propre à l'onglet et hors sauvegarde : la clé ne commence
// pas par « elevagesimu: »). Deux onglets peuvent ainsi garder chacun leur profil d'un rechargement à
// l'autre ; `registry.activeProfileId` (localStorage) n'est que le profil ouvert par défaut dans un NOUVEL
// onglet. Lu au démarrage par src/store/profiles.ts ; écrit au changement de profil et avant les
// rechargements qui ouvrent un autre profil (import d'un profil, suppression du profil ouvert…).
// Documentation : docs/api/profiles.md.

export const TAB_PROFILE_KEY = 'elevagesimu-tab-profile'

function session(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null
  } catch {
    return null
  }
}

/** Profil choisi dans cet onglet (null : aucun, ou sessionStorage indisponible). */
export function readTabProfile(): string | null {
  try {
    return session()?.getItem(TAB_PROFILE_KEY) ?? null
  } catch {
    return null
  }
}

/** Retient le profil de cet onglet (sans effet si sessionStorage est indisponible). */
export function writeTabProfile(id: string): void {
  try {
    session()?.setItem(TAB_PROFILE_KEY, id)
  } catch {
    // Pas de sessionStorage : l'onglet suivra le profil par défaut du registre.
  }
}

/** Oublie le profil de cet onglet : le prochain chargement ouvre le profil par défaut du registre. */
export function clearTabProfile(): void {
  try {
    session()?.removeItem(TAB_PROFILE_KEY)
  } catch {
    // Rien à faire.
  }
}
