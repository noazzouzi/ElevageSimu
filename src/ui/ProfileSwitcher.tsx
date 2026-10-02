// Sélecteur de profil de la barre latérale : profil ouvert — serveur, date du dernier import des prix
// du marché (HDV) du serveur, changement de profil (enregistre puis recharge) et lien « Gérer ».
import { useMemo, useState } from 'react'
import { exportAgeDays, frenchDay, MARKET_STALE_DAYS } from '../domain/market'
import { formatInDays } from '../lib/format'
import { useMarket } from '../store/market'
import { pendingWrites } from '../store/persistence'
import { ACTIVE_PROFILE_ID, useActiveProfile, useActiveServer, useProfiles } from '../store/profiles'
import { href } from './router'
import { useServerDay } from './useServerDay'
import './ProfileSwitcher.css'

export default function ProfileSwitcher() {
  const profile = useActiveProfile()
  const server = useActiveServer()
  const registry = useProfiles((s) => s.registry)
  const readOnly = useProfiles((s) => s.readOnly)
  const switchProfile = useProfiles((s) => s.switchProfile)
  const exportDate = useMarket((s) => s.snapshot?.exportDate ?? null)
  const [error, setError] = useState<string | null>(null)
  const today = useServerDay()
  const age = exportDate ? exportAgeDays(exportDate, today) : null
  const groups = useMemo(
    () => registry.servers.map((s) => ({ server: s, profiles: registry.profiles.filter((p) => p.serverId === s.id) })).filter((g) => g.profiles.length > 0),
    [registry],
  )

  const onSwitch = (id: string) => {
    if (id === ACTIVE_PROFILE_ID) return
    if (Object.keys(pendingWrites()).length && !window.confirm('Des modifications ne sont pas enregistrées (stockage plein) : elles seront perdues en changeant de profil. Continuer ?')) return
    const r = switchProfile(id)
    if (!r.ok) setError(r.error)
  }

  return (
    // Hors des <nav> : la navigation ne contient que les liens des pages.
    <section className="profile-switcher" aria-label="Profil">
      <div className="ps-head">
        <span className="ps-dot" style={{ background: `var(--${profile.color ?? 'accent'})` }} aria-hidden />
        <span className="ps-title" title={`Profil ${profile.name} sur le serveur ${server.name}`}>
          <strong>{profile.name}</strong> <span className="ps-server">— {server.name}</span>
        </span>
      </div>
      {registry.profiles.length > 1 && (
        <div className="ps-select">
          {/* Un clic dans la liste ne referme pas le menu mobile (les liens, si). */}
          <select value={ACTIVE_PROFILE_ID} disabled={readOnly} onChange={(e) => onSwitch(e.target.value)} onClick={(e) => e.stopPropagation()} aria-label="Changer de profil">
            {groups.map((g) => (
              <optgroup key={g.server.id} label={g.server.name}>
                {g.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {g.server.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}
      <div className="ps-meta">
        {exportDate ? (
          <a href={href('prix', { onglet: 'hdv' })} className={age !== null && age > MARKET_STALE_DAYS ? 'ps-stale' : undefined} title="Prix du marché importés pour ce serveur (export HDV)">
            Prix HDV du {frenchDay(exportDate)}
            {age !== null && age > 0 ? ` (${formatInDays(-age)})` : ''}
          </a>
        ) : (
          <a href={href('prix', { onglet: 'hdv' })} title="Importer un export CSV de l’HDV de ce serveur">
            Aucun prix HDV importé
          </a>
        )}
        <a href={href('reglages', { s: 'profils' })} className="ps-manage">
          Gérer
        </a>
      </div>
      {error && (
        <small className="ps-error" role="alert">
          {error}
        </small>
      )}
    </section>
  )
}
