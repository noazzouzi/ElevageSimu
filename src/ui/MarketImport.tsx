// Page Prix › « Marché HDV (CSV) » : import d'un export CSV de l'HDV d'un serveur (aperçu : lignes lues,
// objets reconnus et utiles, couverture par catégorie, objets absents, évolution des prix clés), prix du
// marché du serveur ouvert (statistique, suppression), préréglage de Tylezia et historique des imports.
// Logique : src/domain/market.ts (pur) et src/store/market.ts (stockage par serveur).
import { useMemo, useRef, useState } from 'react'
import { isoDay } from '../domain/almanax'
import {
  MARKET_CATEGORY_LABELS,
  MOUNT_MARKET_NOTE,
  PRICE_STATS,
  PRICE_STAT_LABELS,
  PRICE_STAT_SHORT,
  MARKET_COLUMN_LABELS,
  buildSnapshot,
  frenchDay,
  importCoverageDrop,
  importPriceChanges,
  isIsoDay,
  marketItemName,
  parseHdvCsv,
  serverNameInFileName,
  slugify,
  type CsvParseResult,
  type MarketHistoryEntry,
  type MarketSnapshot,
  type PriceChange,
  type PriceStat,
} from '../domain/market'
import { formatDate, formatKamas, formatNumber, formatPercent, plural } from '../lib/format'
import {
  MARKET_PRESETS,
  applyMarketSnapshot,
  clearServerMarket,
  mergeMarketSnapshot,
  presetForServer,
  serverMarketHistory,
  serverMarketSnapshot,
  undoMarketImport,
  useMarket,
  useMarketHistory,
  useMarketUndo,
  type MarketPreset,
} from '../store/market'
import { ACTIVE_SERVER_ID, useActiveServer, useProfiles } from '../store/profiles'
import { Badge, Callout, Card, Empty, Progress, Stat } from './components'
import './MarketImport.css'

/** Message après une action ; `undoServerId` : l'import peut être annulé (bouton « Annuler l'import »). */
type Message = { tone: 'ok' | 'warn' | 'danger'; text: string; undoServerId?: string } | null

interface LoadedFile {
  name: string
  text: string
  lastModified: number
}

/** Barres de couverture par catégorie d'un instantané. */
function CoverageBars({ snapshot }: { snapshot: MarketSnapshot }) {
  return (
    <div className="mi-coverage" aria-label="Couverture par catégorie">
      {snapshot.stats.coverage.map((c) => (
        <div key={c.category}>
          <div className="label">
            <span>{c.label}</span>
            <span>
              {c.priced}/{c.total}
            </span>
          </div>
          <Progress value={c.priced} max={Math.max(1, c.total)} color={c.priced === c.total ? 'var(--ok)' : c.priced / Math.max(1, c.total) < 0.9 ? 'var(--warn)' : undefined} />
        </div>
      ))}
    </div>
  )
}

function ChangesTable({ changes, beforeLabel, afterLabel }: { changes: PriceChange[]; beforeLabel: string; afterLabel: string }) {
  if (!changes.length) return <Empty>Aucun prix clé à comparer.</Empty>
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Objet</th>
            <th className="num">{beforeLabel}</th>
            <th className="num">{afterLabel}</th>
            <th className="num">Évolution</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td className="num">{c.before === null ? '—' : formatKamas(c.before)}</td>
              <td className="num">{c.after === null ? '—' : formatKamas(c.after)}</td>
              <td className="num">
                {c.change === null ? (
                  <span className="muted">{c.before === null ? 'nouveau' : 'absent du fichier'}</span>
                ) : (
                  <span className={c.change > 0.005 ? 'mi-up' : c.change < -0.005 ? 'mi-down' : undefined}>
                    {c.change > 0 ? '+' : ''}
                    {formatPercent(c.change, 1)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Bouton « Charger les prix de Tylezia du 02/10/2026 » (avec avertissement pour un autre serveur). */
function PresetButton({ preset, serverId, serverName, onMessage }: { preset: MarketPreset; serverId: string; serverName: string; onMessage: (m: Message) => void }) {
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const same = slugify(serverName) === slugify(preset.serverName)
  const load = async () => {
    setBusy(true)
    try {
      const snap = await preset.load()
      const r = applyMarketSnapshot(serverId, snap)
      onMessage(
        r.ok
          ? {
              tone: same ? 'ok' : 'warn',
              text: `Prix du marché de ${preset.serverName} (export du ${frenchDay(preset.exportDate)}) chargés pour ${serverName} : ${formatNumber(Object.keys(snap.rows).length)} objets.${same ? '' : ` Attention : ce sont les prix de ${preset.serverName}.`}`,
              undoServerId: serverId,
            }
          : { tone: 'danger', text: r.error },
      )
    } catch {
      onMessage({ tone: 'danger', text: 'Chargement du préréglage impossible (connexion ?). Réessayez.' })
    }
    setBusy(false)
    setConfirm(false)
  }
  if (!same && confirm)
    return (
      <Callout tone="warn">
        Votre serveur est « {serverName} » : les prix de {preset.serverName} ne reflètent pas forcément son économie (chaque serveur a ses prix). À
        utiliser comme ordre de grandeur, en attendant l’export HDV de votre serveur.
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn small primary" type="button" disabled={busy} onClick={() => void load()}>
            {busy ? 'Chargement…' : `Charger quand même les prix de ${preset.serverName}`}
          </button>
          <button className="btn small ghost" type="button" onClick={() => setConfirm(false)}>
            Annuler
          </button>
        </div>
      </Callout>
    )
  return (
    <button className="btn" type="button" disabled={busy} onClick={() => (same ? void load() : setConfirm(true))}>
      {busy ? 'Chargement…' : preset.label}
    </button>
  )
}

function HistoryTable({ entries }: { entries: MarketHistoryEntry[] }) {
  if (!entries.length) return <Empty>Aucun import pour ce serveur.</Empty>
  const rows = [...entries].reverse()
  const ids = [19975, 17864, 33515, 1557, 1558]
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Export du</th>
            <th>Importé le</th>
            <th>Origine</th>
            <th className="num">Objets</th>
            {ids.map((id) => (
              <th key={id} className="num">
                {marketItemName(id)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => {
            const prev = rows[i + 1]
            return (
              <tr key={e.importedAt}>
                <td>{e.exportDate ? frenchDay(e.exportDate) : '—'}</td>
                <td>{formatDate(e.importedAt)}</td>
                <td>
                  <small>{e.source || '—'}</small>
                </td>
                <td className="num">{formatNumber(e.useful)}</td>
                {ids.map((id) => {
                  const v = e.keyPrices[String(id)]
                  const p = prev?.keyPrices[String(id)]
                  const ch = v !== undefined && p !== undefined && p > 0 ? v / p - 1 : null
                  return (
                    <td key={id} className="num">
                      {v === undefined ? '—' : formatKamas(v)}
                      {ch !== null && Math.abs(ch) >= 0.005 && (
                        <small className={ch > 0 ? 'mi-up' : 'mi-down'}>
                          {' '}
                          {ch > 0 ? '+' : ''}
                          {formatPercent(ch, 0)}
                        </small>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function MarketImport() {
  const registry = useProfiles((s) => s.registry)
  const setServerOptions = useProfiles((s) => s.setServerOptions)
  const activeServer = useActiveServer()
  const current = useMarket((s) => s.snapshot)
  const activeHistory = useMarketHistory((s) => s.entries)
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [parsed, setParsed] = useState<CsvParseResult | null>(null)
  const [target, setTarget] = useState(ACTIVE_SERVER_ID)
  const [exportDate, setExportDate] = useState('')
  const [message, setMessage] = useState<Message>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [historyServer, setHistoryServer] = useState(ACTIVE_SERVER_ID)
  const [historyTick, setHistoryTick] = useState(0)
  /** Remplacement confirmé malgré un fichier partiel (moins de la moitié des objets actuels). */
  const [confirmReplace, setConfirmReplace] = useState(false)
  /** Serveur évoqué par le nom du fichier (« tylezia-2026-10-02.csv » → Tylezia). */
  const [fileServer, setFileServer] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const targetServer = registry.servers.find((s) => s.id === target) ?? activeServer
  const lastUndo = useMarketUndo(ACTIVE_SERVER_ID)

  const preview = useMemo(() => {
    if (!file || !parsed || parsed.error || !isIsoDay(exportDate)) return null
    return buildSnapshot(parsed, { serverName: targetServer.name, exportDate, source: file.name })
  }, [file, parsed, exportDate, targetServer.name])

  // Prix actuels du serveur cible (comparaison avant / après l'import, fichier partiel, fusion) : son
  // instantané enregistré, sinon les prix clés de son dernier import (historique, statistique automatique).
  const targetCurrent = useMemo(() => (target === ACTIVE_SERVER_ID ? current : historyTick >= 0 ? serverMarketSnapshot(target) : null), [target, current, historyTick])
  const targetHistory = useMemo(() => (target === ACTIVE_SERVER_ID ? activeHistory : historyTick >= 0 ? serverMarketHistory(target) : []), [target, activeHistory, historyTick])
  const compared = useMemo(
    () => (preview ? importPriceChanges(preview, { snapshot: targetCurrent, history: targetHistory.at(-1) ?? null }, targetServer.priceStat) : null),
    [preview, targetCurrent, targetHistory, targetServer.priceStat],
  )
  const changes = compared?.changes ?? []
  const previousDate = compared?.previousDate ?? null
  const coverage = preview ? importCoverageDrop(targetCurrent, preview) : null
  const fileServerMismatch = fileServer !== null && slugify(fileServer) !== slugify(targetServer.name)
  const VOLUME_COLUMNS: string[] = ['sold24', 'sold7', 'sold30', 'kamasPerDay']
  const volumeMissing = parsed ? parsed.missingColumns.filter((c) => VOLUME_COLUMNS.includes(c)) : []
  const otherMissing = parsed ? parsed.missingColumns.filter((c) => c !== 'name' && !VOLUME_COLUMNS.includes(c)) : []

  const history = useMemo(() => (historyServer === ACTIVE_SERVER_ID ? activeHistory : historyTick >= 0 ? serverMarketHistory(historyServer) : []), [historyServer, activeHistory, historyTick])

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setMessage(null)
    try {
      const text = await f.text()
      setFile({ name: f.name, text, lastModified: f.lastModified })
      setParsed(parseHdvCsv(text))
      // Date de l'export : date de modification du fichier (modifiable), sinon une date AAAA-MM-JJ du nom.
      const fromName = /(\d{4}-\d{2}-\d{2})/.exec(f.name)?.[1]
      setExportDate(fromName && isIsoDay(fromName) ? fromName : isoDay(f.lastModified || Date.now()))
      // Serveur évoqué par le nom du fichier : présélectionné s'il existe, sinon signalé.
      const named = serverNameInFileName(f.name, [...registry.servers.map((x) => x.name), ...MARKET_PRESETS.map((x) => x.serverName)])
      setFileServer(named)
      const known = named ? registry.servers.find((x) => slugify(x.name) === slugify(named)) : undefined
      setTarget(known ? known.id : ACTIVE_SERVER_ID)
      setConfirmReplace(false)
    } catch {
      setMessage({ tone: 'danger', text: 'Lecture du fichier impossible.' })
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const reset = () => {
    setFile(null)
    setParsed(null)
    setFileServer(null)
    setConfirmReplace(false)
    setHistoryTick((n) => n + 1)
  }

  const apply = () => {
    if (!preview) return
    // Fichier partiel : le remplacement effacerait les prix des objets absents — confirmation demandée.
    if (coverage?.drop && !confirmReplace) {
      setConfirmReplace(true)
      return
    }
    const r = applyMarketSnapshot(target, { ...preview, importedAt: Date.now() })
    if (!r.ok) {
      setMessage({ tone: 'danger', text: r.error })
      return
    }
    setMessage({
      tone: coverage?.drop ? 'warn' : 'ok',
      text: `Prix du marché de ${targetServer.name} remplacés : ${formatNumber(preview.stats.useful)} objets avec un prix (export du ${frenchDay(preview.exportDate)}).${target === ACTIVE_SERVER_ID ? ' Toutes les pages les utilisent dès maintenant.' : ''}`,
      undoServerId: target,
    })
    reset()
  }

  const merge = () => {
    if (!preview) return
    const r = mergeMarketSnapshot(target, { ...preview, importedAt: Date.now() })
    if (!r.ok) {
      setMessage({ tone: 'danger', text: r.error })
      return
    }
    setMessage({
      tone: 'ok',
      text: `Prix du marché de ${targetServer.name} complétés : ${formatNumber(preview.stats.useful)} objets mis à jour (export du ${frenchDay(preview.exportDate)}), ${formatNumber(r.snapshot?.stats.useful ?? 0)} objets avec un prix au total (les autres gardent leur prix précédent${r.snapshot && r.snapshot.exportDate !== preview.exportDate ? ` ; date retenue : ${frenchDay(r.snapshot.exportDate)}, celle des prix les plus anciens` : ''}).`,
      undoServerId: target,
    })
    reset()
  }

  const undo = (serverId: string) => {
    const name = registry.servers.find((x) => x.id === serverId)?.name ?? serverId
    const r = undoMarketImport(serverId)
    setMessage(
      r.ok
        ? {
            tone: 'ok',
            text: r.restored
              ? `Import annulé : prix du marché de ${name} rétablis (export du ${frenchDay(r.restored.exportDate)}, ${formatNumber(r.restored.stats.useful)} objets).`
              : `Import annulé : ${name} n’a plus de prix du marché (comme avant l’import).`,
          }
        : { tone: 'danger', text: r.error },
    )
    setHistoryTick((n) => n + 1)
  }

  const preset = presetForServer(activeServer.name) ?? MARKET_PRESETS[0]

  return (
    <div className="stack market-import">
      {message && (
        <Callout tone={message.tone}>
          {message.text}
          {message.undoServerId && (
            <>
              {' '}
              <button className="btn small" type="button" onClick={() => undo(message.undoServerId as string)}>
                Annuler l’import
              </button>
            </>
          )}
        </Callout>
      )}

      <Card title={`Prix du marché de ${activeServer.name}`}>
        {current ? (
          <>
            <div className="grid grid-4">
              <Stat label="Export HDV du" value={frenchDay(current.exportDate)} hint={`importé le ${formatDate(current.importedAt)}`} />
              <Stat label="Objets avec un prix" value={formatNumber(current.stats.useful)} hint={`sur ${formatNumber(current.stats.relevant || current.stats.useful)} utiles à l’application`} />
              <Stat label="Origine" value={<small>{current.source || '—'}</small>} />
              <Stat label="Statistique" value={<small>{PRICE_STAT_LABELS[activeServer.priceStat]}</small>} />
            </div>
            <CoverageBars snapshot={current} />
          </>
        ) : (
          <Callout>
            Aucun prix du marché pour ce serveur. Importez un export CSV de l’HDV ci-dessous : il chiffre d’un coup ingrédients, carburants, makinas,
            filets, ressources d’extraction et objets-montures.
          </Callout>
        )}
        <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
          <label className="field">
            Statistique de prix du serveur
            <select value={activeServer.priceStat} onChange={(e) => setServerOptions(ACTIVE_SERVER_ID, { priceStat: e.target.value as PriceStat })}>
              {PRICE_STATS.map((s) => (
                <option key={s} value={s}>
                  {PRICE_STAT_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          {preset && <PresetButton preset={preset} serverId={ACTIVE_SERVER_ID} serverName={activeServer.name} onMessage={setMessage} />}
          {lastUndo && !message?.undoServerId && (
            <button
              className="btn"
              type="button"
              onClick={() => undo(ACTIVE_SERVER_ID)}
              title={lastUndo.previous ? `Rétablir l’export du ${frenchDay(lastUndo.previous.exportDate)} (${lastUndo.previous.source || 'import précédent'})` : 'Revenir à aucun prix du marché'}
            >
              Annuler le dernier import
            </button>
          )}
          <div className="spacer" />
          {current &&
            (confirmClear ? (
              <span className="row">
                <small>Supprimer les prix du marché de {activeServer.name} ? (vos prix saisis restent)</small>
                <button
                  className="btn small danger"
                  type="button"
                  onClick={() => {
                    clearServerMarket(ACTIVE_SERVER_ID)
                    setConfirmClear(false)
                    setMessage({ tone: 'warn', text: `Prix du marché de ${activeServer.name} supprimés (historique des imports gardé).` })
                  }}
                >
                  Oui, supprimer
                </button>
                <button className="btn small ghost" type="button" onClick={() => setConfirmClear(false)}>
                  Annuler
                </button>
              </span>
            ) : (
              <button className="btn danger" type="button" onClick={() => setConfirmClear(true)}>
                Supprimer les prix du marché…
              </button>
            ))}
        </div>
        <small className="muted" style={{ display: 'block', marginTop: 6 }}>
          Ordre des prix : votre prix saisi &gt; marché importé &gt; défaut de la recherche &gt; coût de fabrication (le moins cher entre un prix connu et le
          craft complet est retenu si vous savez le fabriquer). Un objet sans vente n’a pas de prix (jamais compté 0). {MOUNT_MARKET_NOTE}
        </small>
      </Card>

      <Card title="Importer un export HDV (CSV)">
        <p className="muted">
          Fichier CSV de l’HDV d’un serveur (une ligne par objet) : colonnes <code>gid;nom;…;vendus_24h;vendus_7j;vendus_30j;median_30j;moyen_30j;median_24h;kamas_par_jour</code>.
          Séparateur « ; », « , » ou tabulation ; en-têtes et nombres tolérants. Seuls les objets utiles à l’application sont gardés (≈ 1 000).
        </p>
        <div className="row">
          <label className="btn primary mi-file">
            📂 Choisir un fichier CSV…
            <input ref={fileRef} type="file" accept=".csv,text/csv,.txt,text/plain" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          {file && <small className="muted">{file.name}</small>}
        </div>
        {parsed?.error && <Callout tone="danger">Fichier refusé : {parsed.error}</Callout>}
        {file && parsed && !parsed.error && (
          <div className="stack" style={{ marginTop: 10 }}>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <label className="field">
                Serveur de cet export
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  {registry.servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.id === ACTIVE_SERVER_ID ? ' (profil ouvert)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Date de l’export
                <input type="date" value={exportDate} onChange={(e) => setExportDate(e.target.value)} required />
              </label>
              {!isIsoDay(exportDate) && <Badge tone="danger">date à saisir</Badge>}
            </div>
            {fileServerMismatch && (
              <Callout tone="warn">
                Le nom du fichier évoque le serveur « {fileServer} » : cet export est-il bien celui de « {targetServer.name} » ? Chaque serveur a ses prix —
                choisissez le bon serveur ci-dessus.
              </Callout>
            )}
            {preview && (
              <>
                <div className="grid grid-4">
                  <Stat label="Lignes lues" value={formatNumber(preview.stats.read)} hint={`${formatNumber(preview.stats.lines)} lignes de données`} />
                  <Stat label="Objets reconnus" value={formatNumber(preview.stats.recognized)} hint={`objets utiles à l’application trouvés (sur ${formatNumber(preview.stats.relevant)})`} />
                  <Stat label="Avec un prix" value={formatNumber(preview.stats.useful)} hint={formatPercent(preview.stats.useful / Math.max(1, preview.stats.relevant), 1)} />
                  <Stat
                    label="Lignes ignorées"
                    value={formatNumber(preview.stats.ignored)}
                    hint={[parsed.invalidCount ? plural(parsed.invalidCount, 'invalide') : '', parsed.empty ? plural(parsed.empty, 'vide') : '', parsed.duplicates ? plural(parsed.duplicates, 'doublon') : ''].filter(Boolean).join(', ') || 'aucune'}
                  />
                </div>
                <CoverageBars snapshot={preview} />
                {volumeMissing.length > 0 && (
                  <Callout tone="warn">
                    Volumes absents ({volumeMissing.map((c) => MARKET_COLUMN_LABELS[c as keyof typeof MARKET_COLUMN_LABELS]).join(', ')}) :{' '}
                    {volumeMissing.includes('sold30')
                      ? 'la liquidité sera inconnue — les plafonds de vente (part du volume du serveur) seront désactivés et signalés, jamais comptés comme « 0 vente ».'
                      : 'ces volumes ne seront pas affichés (« pas de donnée »).'}
                  </Callout>
                )}
                {otherMissing.length > 0 && (
                  <Callout tone="warn">
                    Colonnes de prix absentes ({otherMissing.map((c) => MARKET_COLUMN_LABELS[c as keyof typeof MARKET_COLUMN_LABELS]).join(', ')}) : la statistique de prix se replie
                    sur les colonnes présentes.
                  </Callout>
                )}
                {parsed.invalid.length > 0 && (
                  <details>
                    <summary>
                      {plural(parsed.invalidCount, 'ligne invalide ignorée', 'lignes invalides ignorées')} (détail des {Math.min(parsed.invalid.length, 12)} premières)
                    </summary>
                    <ul className="mi-list">
                      {parsed.invalid.slice(0, 12).map((l) => (
                        <li key={l.line}>
                          Ligne {l.line} : {l.reason} — <code>{l.text}</code>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {preview.stats.missingCount > 0 && (
                  <details>
                    <summary>{plural(preview.stats.missingCount, 'objet utile absent ou sans vente', 'objets utiles absents ou sans vente')} (restent au défaut ou au coût de craft)</summary>
                    <ul className="mi-list">
                      {preview.stats.missing.map((m) => (
                        <li key={m.id}>
                          {m.name} <small className="muted">({MARKET_CATEGORY_LABELS[m.category]})</small>
                        </li>
                      ))}
                      {preview.stats.missingCount > preview.stats.missing.length && <li>… et {preview.stats.missingCount - preview.stats.missing.length} autres</li>}
                    </ul>
                  </details>
                )}
                {previousDate && (
                  <>
                    <h4 style={{ margin: '6px 0 0' }}>
                      Prix clés : export du {frenchDay(previousDate)} → {frenchDay(preview.exportDate)}{' '}
                      {compared && (
                        <small className="muted">({compared.stat === 'auto' ? 'statistique automatique' : PRICE_STAT_SHORT[compared.stat]} des deux côtés)</small>
                      )}
                    </h4>
                    {previousDate > preview.exportDate && <Callout tone="warn">Cet export est plus ancien que celui déjà importé pour {targetServer.name}.</Callout>}
                    <ChangesTable changes={changes.slice(0, 12)} beforeLabel={frenchDay(previousDate)} afterLabel={frenchDay(preview.exportDate)} />
                  </>
                )}
                {coverage?.drop && (
                  <Callout tone="warn">
                    Fichier partiel : {formatNumber(coverage.incomingUseful)} objets avec un prix, contre {formatNumber(coverage.currentUseful)} dans les prix actuels de{' '}
                    {targetServer.name}. Remplacer effacerait le prix des {formatNumber(Math.max(0, coverage.currentUseful - coverage.incomingUseful))} autres objets :
                    préférez « Compléter », qui met à jour les objets du fichier et garde les autres.
                    {confirmReplace && <strong> Cliquez à nouveau sur « Remplacer » pour confirmer.</strong>}
                  </Callout>
                )}
                <div className="row">
                  {targetCurrent && (
                    <button className={coverage?.drop ? 'btn primary' : 'btn'} type="button" onClick={merge} title="Les objets du fichier remplacent les anciens ; les objets absents du fichier gardent leur prix précédent.">
                      Compléter les prix actuels de {targetServer.name}
                    </button>
                  )}
                  <button className={coverage?.drop ? (confirmReplace ? 'btn danger' : 'btn') : 'btn primary'} type="button" onClick={apply}>
                    {confirmReplace ? `Confirmer : remplacer par ${formatNumber(preview.stats.useful)} objets seulement` : `Remplacer les prix du marché de ${targetServer.name}`}
                  </button>
                  <button className="btn ghost" type="button" onClick={reset}>
                    Annuler
                  </button>
                </div>
                <small className="muted">Un import (remplacement ou complément) peut être annulé tant que cet onglet reste ouvert (« Annuler l’import »).</small>
                {target !== ACTIVE_SERVER_ID && <small className="muted">Ce serveur n’est pas celui du profil ouvert : ses profils verront ces prix à leur prochaine ouverture.</small>}
              </>
            )}
          </div>
        )}
      </Card>

      <Card
        title="Historique des imports"
        actions={
          registry.servers.length > 1 ? (
            <label className="field">
              Serveur
              <select value={historyServer} onChange={(e) => setHistoryServer(e.target.value)}>
                {registry.servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : undefined
        }
      >
        <HistoryTable entries={history} />
        <small className="muted">Prix clés en statistique automatique, au moment de chaque import (les {formatNumber(30)} derniers imports sont gardés).</small>
      </Card>
    </div>
  )
}
