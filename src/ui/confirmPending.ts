// Refus « modifications non enregistrées » (`code: 'pending'`, src/store/profiles.ts) : changer de profil
// ou de serveur recharge l'application, ce qui perdrait les modifications qu'un stockage plein a empêché
// d'enregistrer. On propose d'abord une sauvegarde qui les contient (`downloadBackup()` inclut
// `pendingWrites()`), puis on demande confirmation avant de relancer l'action avec `{force: true}`.
import { downloadBackup } from '../lib/backup'
import type { ActionResult } from '../store/profiles'

/**
 * Résultat de l'action, ou de sa nouvelle tentative forcée après confirmation ; null si le joueur renonce.
 * `what` : l'action à confirmer (« Changer de profil »).
 */
export function confirmPendingThenRetry(result: ActionResult, what: string, retry: () => ActionResult): ActionResult | null {
  if (result.ok || result.code !== 'pending') return result
  let saved = ''
  if (window.confirm(`${result.error}\n\nTélécharger d’abord une sauvegarde qui contient ces modifications ?\n(OK : télécharger la sauvegarde ; Annuler : ne pas la télécharger)`)) {
    try {
      saved = downloadBackup()
    } catch {
      saved = ''
    }
  }
  const lost = saved ? `elles sont dans la sauvegarde « ${saved} »` : 'aucune sauvegarde téléchargée'
  if (!window.confirm(`${what} quand même ? Les modifications non enregistrées de ce profil seront perdues ici (${lost}).`)) return null
  return retry()
}
