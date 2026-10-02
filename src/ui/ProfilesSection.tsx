// Réglages › « Profils et serveurs » : liste des profils (ouvrir, renommer, couleur, changer de serveur,
// dupliquer, sauvegarder, supprimer avec confirmation et sauvegarde proposée), création d'un profil
// (vierge ou copie, serveur existant ou nouveau, préréglage de prix), serveurs (renommer, statistique de
// prix, part du marché, dernier import HDV, supprimer s'il est inutilisé) et copie des données d'avant
// les profils (avec les changements faits après la reprise par un onglet resté sur l'ancienne version).
// Logique : src/store/profiles.ts (store) et src/store/profileRegistry.ts (pur).
import { useMemo, useState, type FormEvent } from 'react'
import { PRICE_STATS, PRICE_STAT_LABELS, frenchDay, type PriceStat } from '../domain/market'
import { downloadBackup, downloadProfileBackup, getBrowserStorage, storeLabel } from '../lib/backup'
import { formatChars, formatDate, formatNumber, plural } from '../lib/format'
import { MARKET_PRESETS, applyMarketSnapshot, presetForServer, type MarketPreset } from '../store/market'
import {
  PROFILE_COLORS,
  legacyDivergence,
  legacyKeys,
  profileDataSummary,
  profilesOnServer,
  serverMarketMeta,
  type ProfileColor,
  type ProfileEntry,
  type ServerEntry,
} from '../store/profileRegistry'
import { ACTIVE_PROFILE_ID, ACTIVE_SERVER_ID, useProfiles, type ActionResult } from '../store/profiles'
import { Badge, Callout, NumberField } from './components'
import { confirmPendingThenRetry } from './confirmPending'
import { href } from './router'
import './ProfilesSection.css'

const COLOR_LABELS: Record<ProfileColor, string> = { accent: 'Vert', gold: 'Or', info: 'Bleu', ok: 'Vert clair', warn: 'Orange', danger: 'Rouge' }

type Message = { tone: 'ok' | 'warn' | 'danger'; text: string } | null

function ColorDot({ color }: { color?: ProfileColor }) {
  return <span className="gs-profile-dot" style={{ background: `var(--${color ?? 'accent'})` }} aria-hidden />
}

/** Applique un préréglage de prix du marché à un serveur (chargement du fichier à la demande). */
async function loadPreset(preset: MarketPreset, serverId: string): Promise<ActionResult> {
  try {
    const snap = await preset.load()
    const r = applyMarketSnapshot(serverId, snap)
    return r.ok ? { ok: true, message: `Prix du marché de ${preset.serverName} (export du ${frenchDay(preset.exportDate)}) chargés : ${formatNumber(Object.keys(snap.rows).length)} objets.` } : r
  } catch {
    return { ok: false, error: 'Chargement du préréglage impossible (connexion ?). Réessayez.' }
  }
}

/** Case « Charger les prix de Tylezia… » (avec avertissement si le serveur porte un autre nom). */
function PresetChoice({ serverName, checked, onChange }: { serverName: string; checked: boolean; onChange: (v: boolean) => void }) {
  const preset = presetForServer(serverName) ?? MARKET_PRESETS[0]
  if (!preset) return null
  const sameServer = presetForServer(serverName) !== undefined
  return (
    <div className="stack" style={{ gap: 4 }}>
      <label className="gs-check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>{preset.label}</span>
      </label>
      {checked && !sameServer && (
        <small className="gs-help" style={{ margin: 0 }}>
          <Badge tone="warn">autre économie</Badge> Ce sont les prix du serveur {preset.serverName} : ceux de {serverName.trim() || 'votre serveur'} peuvent être très différents. Importez
          plutôt l’export HDV de votre serveur dès que possible (page Prix).
        </small>
      )}
    </div>
  )
}

// ---------- Profil (ligne) ----------

function ProfileRow({
  profile,
  servers,
  summary,
  onMessage,
  onDuplicate,
  readOnly,
}: {
  profile: ProfileEntry
  servers: ServerEntry[]
  summary: ReturnType<typeof profileDataSummary> | null
  onMessage: (m: Message) => void
  onDuplicate: (p: ProfileEntry) => void
  readOnly: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const actions = useProfiles.getState()
  const active = profile.id === ACTIVE_PROFILE_ID
  const report = (r: ActionResult | null, ok?: string) => {
    if (r) onMessage(r.ok ? (ok || r.message ? { tone: 'ok', text: ok ?? r.message ?? '' } : null) : { tone: 'danger', text: r.error })
  }
  const server = servers.find((s) => s.id === profile.serverId)
  return (
    <tr>
      <td>
        {editing ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              const r = actions.renameProfile(profile.id, name)
              report(r, r.ok ? `Profil renommé en « ${name.trim()} ».` : undefined)
              if (r.ok) setEditing(false)
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label={`Nouveau nom du profil ${profile.name}`} maxLength={40} style={{ width: 150 }} />
            <select value={profile.color ?? ''} aria-label="Couleur du profil" onChange={(e) => report(actions.setProfileColor(profile.id, (e.target.value || null) as ProfileColor | null))}>
              <option value="">Couleur…</option>
              {PROFILE_COLORS.map((c) => (
                <option key={c} value={c}>
                  {COLOR_LABELS[c]}
                </option>
              ))}
            </select>
            <button className="btn small primary" type="submit">
              Enregistrer
            </button>
            <button className="btn small ghost" type="button" onClick={() => setEditing(false)}>
              Annuler
            </button>
          </form>
        ) : (
          <span className="row" style={{ gap: 6 }}>
            <ColorDot color={profile.color} />
            <strong>{profile.name}</strong>
            {active && <Badge tone="accent">ouvert</Badge>}
          </span>
        )}
        <small className="muted mono">{profile.id}</small>
      </td>
      <td>
        <select
          value={profile.serverId}
          disabled={readOnly}
          aria-label={`Serveur du profil ${profile.name}`}
          onChange={(e) => {
            const serverId = e.target.value
            const target = servers.find((s) => s.id === serverId)
            if (active && !window.confirm(`Passer le profil ouvert sur le serveur « ${target?.name} » ? Ses prix et son marché seront ceux de ce serveur (l’application se recharge).`)) return
            const r = confirmPendingThenRetry(actions.setProfileServer(profile.id, serverId), 'Changer de serveur', () => actions.setProfileServer(profile.id, serverId, { force: true }))
            report(r, `Profil « ${profile.name} » rattaché au serveur « ${target?.name} ».`)
          }}
        >
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {!server && <Badge tone="danger">serveur inconnu</Badge>}
        {profile.serverToCheck && (
          <div className="row" style={{ gap: 4, marginTop: 4 }}>
            <Badge tone="warn">serveur à vérifier</Badge>
            <button
              className="btn small"
              type="button"
              disabled={readOnly}
              title="Le registre des profils a été reconstruit et ce serveur a été deviné : confirmez-le, ou choisissez le bon dans la liste."
              onClick={() => report(actions.setProfileServer(profile.id, profile.serverId), `Serveur « ${server?.name ?? profile.serverId} » confirmé pour « ${profile.name} ».`)}
            >
              C’est le bon
            </button>
          </div>
        )}
      </td>
      <td>
        {summary ? (
          <small>
            {summary.mounts === null ? 'aucune monture' : plural(summary.mounts, 'monture', 'montures')}
            {summary.jobLevel !== null && ` · Éleveur niv. ${summary.jobLevel}`}
            {summary.journal ? ` · ${plural(summary.journal, 'entrée', 'entrées')} de journal` : ''}
            <br />
            <span className="muted">{formatChars(summary.chars)}</span>
          </small>
        ) : (
          '—'
        )}
      </td>
      <td>
        {confirmDelete ? (
          <div className="stack" style={{ gap: 6 }}>
            <small>
              Supprimer « {profile.name} » et <strong>toutes ses données</strong> (montures, enclos, plans, journal, réglages) ? Les prix du serveur sont gardés.
            </small>
            <div className="row">
              <button className="btn small" type="button" onClick={() => onMessage(downloadProfileBackup(profile.id) ? { tone: 'ok', text: `Sauvegarde de « ${profile.name} » téléchargée.` } : { tone: 'danger', text: 'Sauvegarde impossible.' })}>
                Télécharger sa sauvegarde d’abord
              </button>
              <button
                className="btn small danger"
                type="button"
                onClick={() => {
                  report(actions.deleteProfile(profile.id))
                  setConfirmDelete(false)
                }}
              >
                Oui, supprimer
              </button>
              <button className="btn small ghost" type="button" onClick={() => setConfirmDelete(false)}>
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <div className="row" style={{ gap: 6 }}>
            {!active && (
              <button
                className="btn small primary"
                type="button"
                disabled={readOnly}
                onClick={() => report(confirmPendingThenRetry(actions.switchProfile(profile.id), 'Ouvrir ce profil', () => actions.switchProfile(profile.id, undefined, { force: true })))}
              >
                Ouvrir
              </button>
            )}
            <button className="btn small" type="button" disabled={readOnly} onClick={() => setEditing(true)}>
              Renommer
            </button>
            <button className="btn small" type="button" disabled={readOnly} onClick={() => onDuplicate(profile)}>
              Dupliquer
            </button>
            <button
              className="btn small"
              type="button"
              onClick={() => onMessage(downloadProfileBackup(profile.id) ? { tone: 'ok', text: `Sauvegarde de « ${profile.name} » téléchargée.` } : { tone: 'danger', text: 'Sauvegarde impossible (profil introuvable dans le stockage).' })}
            >
              Sauvegarder
            </button>
            <button className="btn small danger" type="button" disabled={readOnly} onClick={() => setConfirmDelete(true)}>
              Supprimer…
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

// ---------- Nouveau profil ----------

const NEW_SERVER = '__nouveau__'

function NewProfileForm({ duplicate, onDone, onMessage, readOnly }: { duplicate: ProfileEntry | null; onDone: () => void; onMessage: (m: Message) => void; readOnly: boolean }) {
  const registry = useProfiles((s) => s.registry)
  const [name, setName] = useState(duplicate ? `${duplicate.name} (copie)` : '')
  const [serverChoice, setServerChoice] = useState(duplicate?.serverId ?? ACTIVE_SERVER_ID)
  const [serverName, setServerName] = useState('')
  const [from, setFrom] = useState<string>(duplicate?.id ?? '')
  const [color, setColor] = useState<ProfileColor | ''>('')
  const [usePreset, setUsePreset] = useState(false)
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const isNewServer = serverChoice === NEW_SERVER

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const actions = useProfiles.getState()
    const r = actions.createProfile({ name, ...(isNewServer ? { newServerName: serverName } : { serverId: serverChoice }), duplicateFrom: from || undefined, color: color || undefined })
    if (!r.ok) {
      onMessage({ tone: 'danger', text: r.error })
      return
    }
    const created = useProfiles.getState().registry.profiles.find((p) => p.id === r.id)
    const lines = [`Profil « ${created?.name ?? name} » créé${from ? ' (copie)' : ''}.`]
    if (isNewServer && usePreset && created) {
      setBusy(true)
      const p = await loadPreset(presetForServer(serverName) ?? MARKET_PRESETS[0], created.serverId)
      setBusy(false)
      lines.push(p.ok ? (p.message ?? '') : `Préréglage non chargé : ${p.error}`)
    }
    onDone()
    if (!open || !created) {
      onMessage({ tone: 'ok', text: lines.join(' ') })
      return
    }
    const flash = `${lines.join(' ')} Profil ouvert.`
    const sw = useProfiles.getState().switchProfile
    // Modifications non enregistrées du profil ouvert : sauvegarde proposée, puis confirmation.
    const opened = confirmPendingThenRetry(sw(created.id, flash), 'Ouvrir le nouveau profil', () => sw(created.id, flash, { force: true }))
    if (!opened) onMessage({ tone: 'ok', text: `${lines.join(' ')} Profil créé (non ouvert).` })
    else if (!opened.ok) onMessage({ tone: 'warn', text: `${lines.join(' ')} Profil créé (non ouvert) : ${opened.error}` })
  }

  return (
    <form className="gs-new-profile" onSubmit={(e) => void submit(e)} aria-label="Nouveau profil">
      <h4>{duplicate ? `Dupliquer « ${duplicate.name} »` : 'Nouveau profil'}</h4>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field">
          Nom du profil
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Alt Tylezia" maxLength={40} required />
        </label>
        <label className="field">
          Serveur
          <select value={serverChoice} onChange={(e) => setServerChoice(e.target.value)}>
            {registry.servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value={NEW_SERVER}>+ Nouveau serveur…</option>
          </select>
        </label>
        {isNewServer && (
          <label className="field">
            Nom du nouveau serveur
            <input
              value={serverName}
              onChange={(e) => {
                setServerName(e.target.value)
                setUsePreset(presetForServer(e.target.value) !== undefined)
              }}
              placeholder="ex. Tylezia"
              maxLength={40}
              required
            />
          </label>
        )}
        <label className="field">
          Départ
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Profil vierge</option>
            {registry.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                Copie de « {p.name} »
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Couleur
          <select value={color} onChange={(e) => setColor(e.target.value as ProfileColor | '')}>
            <option value="">Par défaut</option>
            {PROFILE_COLORS.map((c) => (
              <option key={c} value={c}>
                {COLOR_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {isNewServer && serverName.trim() && <PresetChoice serverName={serverName} checked={usePreset} onChange={setUsePreset} />}
      <p className="gs-help">
        {from
          ? 'La copie reprend montures, enclos, plans, journal, réglages et préférences du profil choisi. '
          : 'Un profil vierge part des réglages par défaut (règles 3.6, niveau 1) : complétez-les ensuite. '}
        {isNewServer ? 'Un nouveau serveur commence sans prix : importez son export HDV (page Prix).' : 'Les profils d’un même serveur partagent ses prix.'}
      </p>
      <div className="row">
        <label className="gs-check">
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
          <span>Ouvrir ce profil après la création (l’application se recharge)</span>
        </label>
        <div className="spacer" />
        {duplicate && (
          <button className="btn ghost" type="button" onClick={onDone}>
            Annuler
          </button>
        )}
        <button className="btn primary" type="submit" disabled={readOnly || busy || !name.trim() || (isNewServer && !serverName.trim())}>
          {busy ? 'Chargement des prix…' : 'Créer le profil'}
        </button>
      </div>
    </form>
  )
}

// ---------- Serveurs ----------

function ServerRow({ server, onMessage, readOnly, refresh }: { server: ServerEntry; onMessage: (m: Message) => void; readOnly: boolean; refresh: number }) {
  const registry = useProfiles((s) => s.registry)
  const actions = useProfiles.getState()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(server.name)
  const [busy, setBusy] = useState(false)
  const users = profilesOnServer(registry, server.id)
  const meta = useMemo(() => {
    const ls = getBrowserStorage()
    // `refresh` : relu après un import de préréglage.
    return ls && refresh >= 0 ? serverMarketMeta(ls, server.id) : null
  }, [server.id, refresh])
  const preset = presetForServer(server.name)
  const report = (r: ActionResult, ok?: string) => onMessage(r.ok ? (ok || r.message ? { tone: 'ok', text: ok ?? r.message ?? '' } : null) : { tone: 'danger', text: r.error })
  return (
    <tr>
      <td>
        {editing ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              const r = actions.renameServer(server.id, name)
              report(r, r.ok ? `Serveur renommé en « ${name.trim()} ».` : undefined)
              if (r.ok) setEditing(false)
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label={`Nouveau nom du serveur ${server.name}`} maxLength={40} style={{ width: 140 }} />
            <button className="btn small primary" type="submit">
              Enregistrer
            </button>
            <button className="btn small ghost" type="button" onClick={() => setEditing(false)}>
              Annuler
            </button>
          </form>
        ) : (
          <span className="row" style={{ gap: 6 }}>
            <strong>{server.name}</strong>
            {server.id === ACTIVE_SERVER_ID && <Badge tone="accent">profil ouvert</Badge>}
          </span>
        )}
        <small className="muted">{users.length ? users.map((p) => p.name).join(', ') : 'aucun profil'}</small>
      </td>
      <td>
        <select
          value={server.priceStat}
          disabled={readOnly}
          aria-label={`Statistique de prix du serveur ${server.name}`}
          onChange={(e) => report(actions.setServerOptions(server.id, { priceStat: e.target.value as PriceStat }))}
        >
          {PRICE_STATS.map((s) => (
            <option key={s} value={s}>
              {PRICE_STAT_LABELS[s]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <NumberField
          label="% du volume"
          value={Math.round(server.maxMarketShare * 100)}
          min={1}
          max={100}
          integer
          suffix="%"
          width={70}
          onChange={(v) => report(actions.setServerOptions(server.id, { maxMarketShare: v / 100 }))}
        />
      </td>
      <td>
        {meta ? (
          <small>
            Export du <strong>{frenchDay(meta.exportDate)}</strong> · {formatNumber(meta.useful)} objets
            <br />
            <span className="muted">importé le {formatDate(meta.importedAt)}</span>
            {server.id === ACTIVE_SERVER_ID && (
              <>
                {' '}
                · <a href={href('prix', { onglet: 'hdv' })}>détail</a>
              </>
            )}
          </small>
        ) : (
          <small className="muted">aucun import</small>
        )}
        {preset && !meta && (
          <div>
            <button
              className="btn small"
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                report(await loadPreset(preset, server.id))
                setBusy(false)
              }}
            >
              {busy ? 'Chargement…' : preset.label}
            </button>
          </div>
        )}
      </td>
      <td>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn small" type="button" disabled={readOnly} onClick={() => setEditing(true)}>
            Renommer
          </button>
          <button
            className="btn small danger"
            type="button"
            disabled={readOnly || users.length > 0}
            title={users.length ? 'Utilisé par un profil : changez d’abord le serveur de ses profils.' : 'Supprimer ce serveur, ses prix saisis et son marché importé'}
            onClick={() => {
              if (!window.confirm(`Supprimer le serveur « ${server.name} », ses prix saisis et ses prix du marché importés ?`)) return
              report(actions.deleteServer(server.id))
            }}
          >
            Supprimer
          </button>
        </div>
      </td>
    </tr>
  )
}

function NewServerForm({ onMessage, readOnly, onCreated }: { onMessage: (m: Message) => void; readOnly: boolean; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [usePreset, setUsePreset] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="stack"
      style={{ gap: 6 }}
      aria-label="Nouveau serveur"
      onSubmit={async (e) => {
        e.preventDefault()
        const r = useProfiles.getState().createServer(name)
        if (!r.ok) {
          onMessage({ tone: 'danger', text: r.error })
          return
        }
        let text = `Serveur « ${name.trim()} » créé : rattachez-y un profil (création ou liste ci-dessus).`
        if (usePreset && r.id) {
          setBusy(true)
          const p = await loadPreset(presetForServer(name) ?? MARKET_PRESETS[0], r.id)
          setBusy(false)
          text += ` ${p.ok ? p.message : `Préréglage non chargé : ${p.error}`}`
        }
        onMessage({ tone: 'ok', text })
        setName('')
        setUsePreset(false)
        onCreated()
      }}
    >
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field">
          Nouveau serveur
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setUsePreset(presetForServer(e.target.value) !== undefined)
            }}
            placeholder="ex. Salar"
            maxLength={40}
          />
        </label>
        <button className="btn" type="submit" disabled={readOnly || busy || !name.trim()}>
          {busy ? 'Chargement des prix…' : 'Créer le serveur'}
        </button>
      </div>
      {name.trim() && <PresetChoice serverName={name} checked={usePreset} onChange={setUsePreset} />}
    </form>
  )
}

// ---------- Section ----------

export default function ProfilesSection() {
  const registry = useProfiles((s) => s.registry)
  const readOnly = useProfiles((s) => s.readOnly)
  const readOnlyReason = useProfiles((s) => s.readOnlyReason)
  const mode = useProfiles((s) => s.mode)
  const [message, setMessage] = useState<Message>(null)
  const [duplicate, setDuplicate] = useState<ProfileEntry | null>(null)
  const [formKey, setFormKey] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [confirmLegacy, setConfirmLegacy] = useState(false)
  const summaries = useMemo(() => {
    const ls = getBrowserStorage()
    return Object.fromEntries(registry.profiles.map((p) => [p.id, ls && refresh >= 0 ? profileDataSummary(ls, p.id) : null]))
  }, [registry, refresh])
  const legacy = useMemo(() => {
    const ls = getBrowserStorage()
    if (!ls || mode !== 'profiles' || refresh < 0) return null
    const keys = legacyKeys(ls)
    if (!keys.length) return null
    const chars = keys.reduce((t, k) => t + k.length + (ls.getItem(k)?.length ?? 0), 0)
    // Anciennes clés modifiées après la reprise (onglet resté sur l'ancienne version).
    const diverged = legacyDivergence(ls, registry)
    return { keys, chars, diverged }
  }, [mode, refresh, registry])
  const onMessage = (m: Message) => {
    setMessage(m)
    setRefresh((n) => n + 1)
  }

  return (
    <div className="stack">
      {readOnly && readOnlyReason && <Callout tone="warn">{readOnlyReason}</Callout>}
      {message && <Callout tone={message.tone === 'warn' ? 'warn' : message.tone}>{message.text}</Callout>}
      <p className="gs-help" style={{ marginTop: 0 }}>
        Un <strong>profil</strong> est un élevage (un compte sur un serveur) : réglages, montures, enclos, plans, avancement, journal et préférences
        des pages. Un <strong>serveur</strong> porte l’économie : vos prix saisis et les prix du marché importés (export HDV), partagés par tous ses
        profils. Changer de profil recharge l’application.
      </p>

      <h3>Profils</h3>
      <div className="table-wrap">
        <table className="table gs-profiles-table">
          <thead>
            <tr>
              <th>Profil</th>
              <th>Serveur</th>
              <th>Contenu</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {registry.profiles.map((p) => (
              <ProfileRow
                key={p.id}
                profile={p}
                servers={registry.servers}
                summary={summaries[p.id] ?? null}
                onMessage={onMessage}
                readOnly={readOnly}
                onDuplicate={(prof) => {
                  setDuplicate(prof)
                  setFormKey((k) => k + 1)
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
      <NewProfileForm
        key={formKey}
        duplicate={duplicate}
        readOnly={readOnly}
        onMessage={onMessage}
        onDone={() => {
          setDuplicate(null)
          setFormKey((k) => k + 1)
        }}
      />

      <div className="divider" />
      <h3>Serveurs</h3>
      <div className="table-wrap">
        <table className="table gs-servers-table">
          <thead>
            <tr>
              <th>Serveur et profils</th>
              <th>Statistique de prix (export HDV)</th>
              <th>Ventes prévues max.</th>
              <th>Dernier import HDV</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {registry.servers.map((s) => (
              <ServerRow key={s.id} server={s} onMessage={onMessage} readOnly={readOnly} refresh={refresh} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="gs-help">
        <strong>Statistique de prix</strong> : comment un prix est tiré de l’export HDV (automatique = médiane des dernières 24 h s’il y a eu au moins 5
        ventes, sinon médiane sur 30 jours). <strong>Ventes prévues max.</strong> : part du volume quotidien moyen d’un objet que les calculs supposent
        vendable sans faire chuter son prix (15 % par défaut).
      </p>
      <NewServerForm onMessage={onMessage} readOnly={readOnly} onCreated={() => setRefresh((n) => n + 1)} />

      {legacy && registry.legacy && (
        <>
          <div className="divider" />
          <h3>Données d’avant les profils</h3>
          {legacy.diverged.length > 0 && (
            <Callout tone="warn">
              <strong>
                {plural(legacy.diverged.length, 'donnée modifiée', 'données modifiées')} par l’ancienne version après la reprise
              </strong>{' '}
              (un onglet d’ElevageSimu est sans doute resté ouvert sur l’ancienne version) : {legacy.diverged.map((k) => storeLabel(k)).join(', ')}. Ces changements ne
              sont pas dans vos profils. <strong>Reprendre</strong> remplace les données correspondantes du profil «{' '}
              {registry.profiles.find((p) => p.id === 'principal')?.name ?? 'Principal'} » (pour les prix saisis : ceux de son serveur) par celles de l’ancienne version ;{' '}
              <strong>Ignorer</strong> les laisse de côté. Fermez d’abord les onglets restés sur l’ancienne version.
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn small" type="button" onClick={() => onMessage({ tone: 'ok', text: `Sauvegarde téléchargée : ${downloadBackup()}` })}>
                  Télécharger une sauvegarde d’abord
                </button>
                <button
                  className="btn small primary"
                  type="button"
                  disabled={readOnly}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Reprendre ces changements de l’ancienne version (${legacy.diverged.map((k) => storeLabel(k)).join(', ')}) ? Les données correspondantes du profil « Principal » seront remplacées (l’application se recharge).`,
                      )
                    )
                      return
                    const r = useProfiles.getState().adoptLegacyChanges(legacy.diverged)
                    onMessage(r.ok ? { tone: 'ok', text: r.message ?? '' } : { tone: 'danger', text: r.error })
                  }}
                >
                  Reprendre ces changements…
                </button>
                <button
                  className="btn small"
                  type="button"
                  disabled={readOnly}
                  onClick={() => {
                    const r = useProfiles.getState().ignoreLegacyChanges(legacy.diverged)
                    onMessage(r.ok ? { tone: 'ok', text: r.message ?? '' } : { tone: 'danger', text: r.error })
                  }}
                >
                  Ignorer
                </button>
              </div>
            </Callout>
          )}
          <Callout>
            {plural(legacy.keys.length, 'donnée', 'données')} ({formatChars(legacy.chars)}) de l’ancienne version ont été reprises dans le profil «{' '}
            {registry.profiles.find((p) => p.id === 'principal')?.name ?? 'Principal'} » le {formatDate(registry.legacy.migratedAt)}. L’original est gardé
            par sécurité : supprimez-le quand tout vous semble correct, pour libérer de la place.
            {confirmLegacy ? (
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn small" type="button" onClick={() => onMessage({ tone: 'ok', text: `Sauvegarde téléchargée : ${downloadBackup()}` })}>
                  Télécharger une sauvegarde d’abord
                </button>
                <button
                  className="btn small danger"
                  type="button"
                  disabled={readOnly}
                  onClick={() => {
                    const r = useProfiles.getState().removeLegacyCopy()
                    onMessage(r.ok ? { tone: 'ok', text: r.message ?? 'Ancienne copie supprimée.' } : { tone: 'danger', text: r.error })
                    setConfirmLegacy(false)
                  }}
                >
                  Oui, supprimer l’ancienne copie
                </button>
                <button className="btn small ghost" type="button" onClick={() => setConfirmLegacy(false)}>
                  Annuler
                </button>
              </div>
            ) : (
              <div className="row" style={{ marginTop: 8 }}>
                <button
                  className="btn small"
                  type="button"
                  disabled={readOnly || legacy.diverged.length > 0}
                  title={legacy.diverged.length ? 'Reprenez ou ignorez d’abord les changements de l’ancienne version (ci-dessus).' : undefined}
                  onClick={() => setConfirmLegacy(true)}
                >
                  Supprimer l’ancienne copie…
                </button>
              </div>
            )}
          </Callout>
        </>
      )}
    </div>
  )
}
