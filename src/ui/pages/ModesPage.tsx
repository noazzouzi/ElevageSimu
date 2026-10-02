// Page « Modes de rentabilité » (section Économie, docs/SPEC-v2.md §4) : comparaison des modes pour le
// profil ouvert (kamas par jour en régime permanent, production face au volume du marché, montée en
// charge, capital immobilisé, risques), calculée par le moteur de production dans un Web Worker
// (progression, annulation ; repli sur le fil principal), puis détail d'un mode : stratégie retenue et
// pourquoi, routine quotidienne précise, revenus et coûts, sensibilité au prix du produit, liquidité.
// « Activer ce mode » règle `settings.mode` (conseiller, accueil, plan) ; les résultats sont enregistrés
// pour le profil (src/store/modeResults.ts) et relus par l'accueil et le plan.
import { useEffect, useMemo, useRef } from 'react'
import { FAMILIES, getSpecies, itemName } from '../../data'
import { frenchDay, marketOriginMismatch, PRICE_STAT_SHORT } from '../../domain/market'
import {
  dailyRoutine,
  familySwitchText,
  liquidityCheck,
  LIQUIDITY_STATUS_LABELS,
  mainRevenueCategory,
  mergedSessions,
  MODE_HORIZON_DAYS,
  modeDef,
  modeSensitivity,
  MODES,
  pluralItemName,
  profilePaddocks,
  rankModes,
  revenueCostBreakdown,
  strategyParamLines,
  strategyWhy,
  type LiquidityStatus,
  type ModeId,
  type ModeProfile,
  type ModeRanking,
  type ModeRoutine,
  type StoredModeResults,
} from '../../domain/modes'
import { bandLabel, netKindForJobLevel, sessionsForHours, type PurchaseCheck } from '../../domain/production'
import { NET_KIND_LABELS } from '../../domain/economy'
import { formatDate, formatKamas, formatKamasRange, formatNumber, formatPercent } from '../../lib/format'
import { useModePlan, useModeResults } from '../../store/modeResults'
import { useInventory } from '../../store/inventory'
import { journalJobXp, useJournal } from '../../store/journal'
import { jobLevelFromXp, jobXpForLevel } from '../../domain/xp'
import { useActiveProfile, useActiveServer } from '../../store/profiles'
import { usePlanProgress } from '../../store/planProgress'
import { useSettings } from '../../store/settings'
import { Badge, Callout, Card, Empty, PageHeader, Progress, SelectField, Stat } from '../components'
import { MarketStatusCallouts } from '../MarketStatus'
import { href, navigate, useRoute } from '../router'
import { saveModesUiPrefs, useActiveMode, useModeContextKey, useModeProfile, useModesUiPrefs, type ModesPrecision } from '../useModes'
import { useServerDay } from '../useServerDay'
import { cancelModesRun, MODES_RUNS, startModesRun, useModesRun } from '../useModesRun'
import './ModesPage.css'

type Precision = ModesPrecision

const PRECISION_OPTIONS: { value: Precision; label: string }[] = [
  { value: 'rapide', label: 'Rapide (≈ 15 s, grilles réduites, 8 tirages)' },
  { value: 'fine', label: 'Fine (≈ 1 à 2 min, grilles complètes, 12 tirages)' },
]

const RUNS = MODES_RUNS

const SENS_TITLE: Record<ReturnType<typeof mainRevenueCategory>, string> = { ressources: 'de la ressource', runes: 'des runes', montures: 'des montures', genetons: 'des génétons' }

const LIQ_TONE: Record<LiquidityStatus, 'ok' | 'warn' | 'danger' | 'info'> = { ok: 'ok', limite: 'warn', sature: 'danger', inconnu: 'warn' }

const kamas = (v: number | null | undefined) => formatKamas(v ?? null, true)

export default function ModesPage() {
  const route = useRoute()
  const profile = useModeProfile()
  // Niveau estimé d'après le journal (comme l'accueil et l'estimateur) : signalé s'il dépasse le niveau saisi.
  const journal = useJournal((st) => st.entries)
  const jobLevelUpdatedAt = useSettings((st) => st.jobLevelUpdatedAt)
  const estimatedJobLevel = useMemo(
    () => Math.min(200, Math.max(profile.jobLevel, jobLevelFromXp(jobXpForLevel(profile.jobLevel) + journalJobXp(journal, jobLevelUpdatedAt).xp))),
    [profile.jobLevel, journal, jobLevelUpdatedAt],
  )
  const contextKey = useModeContextKey(profile)
  const activeProfile = useActiveProfile()
  const server = useActiveServer()
  const stored = useModeResults((s) => s.results)
  const activeModeId = useSettings((s) => s.mode)
  const update = useSettings((s) => s.update)
  const market = profile.prices.ctx.market ?? null
  const prefs = useModesUiPrefs()
  const precision = prefs.precision
  const setPrecision = (p: Precision) => saveModesUiPrefs({ precision: p })

  // ---- Calcul : contrôleur du module (src/ui/useModesRun.ts), indépendant de la page — quitter la page
  // ne l'interrompt pas, ses résultats sont enregistrés à la fin (revue UX2-18).
  const progress = useModesRun((s) => s.progress)
  const error = useModesRun((s) => s.error)
  const saveFailed = useModesRun((s) => s.saveFailed)
  const run = () => startModesRun(profile, { precision, serverId: server.id })
  const cancel = cancelModesRun

  // Premier passage sans résultat enregistré : calcul automatique (≈ 15 s).
  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoStarted.current || stored || useModesRun.getState().progress) return
    // Minuterie annulée au démontage (double montage du mode strict) : un seul calcul démarre.
    const t = window.setTimeout(() => {
      autoStarted.current = true
      run()
    }, 0)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ranking = useMemo(() => (stored ? rankModes(stored.outcomes) : null), [stored])
  const family = useSettings((s) => s.family)
  const mounts = useInventory((s) => s.mounts)
  const pinned = useModePlan((s) => s.plan)
  const unpin = useModePlan((s) => s.unpin)
  const active = useActiveMode()
  /**
   * Activer un mode (ou le mode automatique) : s'il travaille une autre famille que celle du profil, le
   * dire et demander confirmation (revue UX2-01) ; un plan d'investissement suivi cède la place au choix
   * fait ici.
   */
  const activate = (id: ModeId) => {
    const target = id === 'auto' ? (stored?.bestModeId ?? null) : id
    const tdef = target ? modeDef(target) : null
    const row = target ? ranking?.rows.find((r) => r.modeId === target) : undefined
    const fam = tdef ? (tdef.family ?? (tdef.kind === 'vente' ? (row?.family ?? null) : null)) : null
    if (tdef && fam && fam !== family) {
      const owned = mounts.filter((m) => getSpecies(m.speciesId)?.family === family).length
      const who = id === 'auto' ? `Le mode automatique (aujourd’hui ${tdef.label})` : `Le mode ${tdef.label}`
      if (!window.confirm(`${familySwitchText(who, family, fam, owned)}\n\nActiver quand même ?`)) return
    }
    if (pinned) unpin()
    update({ mode: id })
  }
  const stale = !!stored && stored.contextKey !== contextKey
  const paramMode = route.params.get('mode')
  const best = stored?.bestModeId ?? null
  const selectedId: ModeId =
    paramMode && MODES.some((m) => m.id === paramMode) ? (paramMode as ModeId) : activeModeId !== 'auto' ? activeModeId : (best ?? 'rush-corne')
  const select = (id: ModeId) => navigate('modes', { mode: id })

  const paddocks = profilePaddocks(profile)
  const sessions = sessionsForHours(profile.hoursPerDay)
  const net = netKindForJobLevel(profile.jobLevel)

  return (
    <div className="modes-page">
      <PageHeader
        title="Modes de rentabilité"
        subtitle={
          <>
            Profil <strong>{activeProfile.name}</strong> — serveur <strong>{server.name || 'sans nom'}</strong> ·{' '}
            {market ? (
              <>
                prix HDV{marketOriginMismatch(market) ? ` de ${marketOriginMismatch(market)}` : ''} du <strong>{frenchDay(market.exportDate)}</strong> (
                {market.stat === 'auto' ? 'statistique auto' : PRICE_STAT_SHORT[market.stat]})
              </>
            ) : (
              <span className="md-warn-text">aucun export HDV importé (prix par défaut de la recherche)</span>
            )}
          </>
        }
        actions={
          progress ? (
            <button className="btn small" onClick={cancel}>
              Annuler le calcul
            </button>
          ) : (
            <button className="btn small primary" onClick={run}>
              {stored ? 'Recalculer' : 'Calculer'}
            </button>
          )
        }
      />

      {!market && (
        <Callout tone="warn">
          Aucun export HDV n’est importé pour <strong>{server.name || 'ce serveur'}</strong> : les modes sont chiffrés avec les prix par défaut de la recherche
          (datés, autre serveur) et <strong>sans plafond de liquidité</strong>. Importez l’export de votre serveur dans{' '}
          <a href={href('prix', { onglet: 'hdv' })}>Prix › Marché HDV</a> pour des montants fiables.
        </Callout>
      )}
      <MarketStatusCallouts context="classements et routines" />

      <Card
        title="Hypothèses du profil"
        actions={
          <a className="btn small ghost" href={href('reglages')}>
            Modifier les réglages
          </a>
        }
      >
        <div className="md-assumptions">
          <Stat
            label="Niveau d’Éleveur"
            value={`niv. ${profile.jobLevel}`}
            hint={
              <>
                {paddocks} enclos de 10 places au départ{profile.jobLevel < 200 ? ', puis ceux que l’XP d’élevage débloque' : ''}
                {estimatedJobLevel > profile.jobLevel && (
                  <>
                    {' '}
                    · niveau saisi ; ≈ {estimatedJobLevel} d’après le journal : <a href={href('reglages')}>mettez-le à jour</a>
                  </>
                )}
              </>
            }
          />
          <Stat label="Temps de jeu" value={`${formatNumber(profile.hoursPerDay, 1)} h/jour`} hint={`${sessions} passage${sessions > 1 ? 's' : ''} aux enclos par jour`} />
          <Stat label="Captures" value={`${profile.characters} personnage${profile.characters > 1 ? 's' : ''}`} hint={NET_KIND_LABELS[net]} />
          <Stat label="Ventes" value={`≤ ${formatPercent(profile.prices.maxMarketShare ?? 0.15, 0)} du volume`} hint={`taxe ${formatPercent(profile.prices.saleTax ?? 0.02, 1)}`} />
          <Stat label="Durée simulée" value={`${MODE_HORIZON_DAYS} jours`} hint={`règles ${profile.rules.label}`} />
          <SelectField<Precision> label="Précision du calcul" value={precision} onChange={setPrecision} options={PRECISION_OPTIONS} />
        </div>
        <label className="check md-trust">
          <input type="checkbox" checked={prefs.trustMixed} onChange={(e) => saveModesUiPrefs({ trustMixed: e.target.checked })} />
          Compter les prix « HDV mixte » des montures dans le classement
          <small className="muted">
            {' '}
            — sinon la vente de montures chiffrée au prix de l’objet-monture du marché (niveaux, états et séniles mélangés) est affichée à part, jamais choisie par le mode
            automatique. Mieux : saisissez le prix d’un bébé niveau 1 fécond sur la page <a href={href('prix', { onglet: 'montures' })}>Prix</a>.
          </small>
        </label>
        <label className="check md-trust">
          <input type="checkbox" checked={prefs.includeGenetons} onChange={(e) => saveModesUiPrefs({ includeGenetons: e.target.checked })} />
          Compter les génétons dans le bénéfice
          <small className="muted">
            {' '}
            — valeur estimée (Puissants Parchemins revendus, liés au compte selon DPLN) ; décochez pour classer les modes et les générations sans eux.
          </small>
        </label>
        <p className="muted md-note">
          Chaque mode est optimisé (génération, niveau des parents, Optimakina, palier, accoupler avant d’extraire ; brisage : niveau et palier) par simulation session
          par session, puis classé par bénéfice net par jour en régime permanent : les meilleures stratégies sont recalculées sur {RUNS[precision]} tirages indépendants,
          et sur une durée plus longue (jusqu’à 180 jours) si leur régime n’est pas stabilisé en {MODE_HORIZON_DAYS} jours. Deux stratégies dont l’écart tient dans le
          bruit des tirages sont à égalité : la moins gourmande en capital passe devant. Enclos et filets débloqués en route par l’XP d’élevage (sans crafts).
          Joueur parfait : comptez ×1,5 sur les durées pour un joueur réel. Simulation depuis un élevage vide : votre étable actuelle n’est pas prise en compte (montée
          en charge plus courte en réalité si vous avez déjà des montures ; l’estimateur d’investissement peut partir de votre étable). Classement sur le bénéfice du
          régime permanent : l’estimateur d’investissement, lui, classe sur le bénéfice cumulé de son horizon (montée comprise) et retient souvent une génération plus
          basse, qui rapporte plus tôt.
        </p>
      </Card>

      {progress && (
        <Card>
          <div className="md-progress">
            <span>
              Calcul en cours : <strong>{progress.label}</strong> — {formatPercent(progress.total > 0 ? progress.done / progress.total : 0, 0)}
            </span>
            <span className="muted">{progress.engine === 'worker' ? 'en arrière-plan (Web Worker)' : 'sur la page (Web Workers indisponibles)'}</span>
            <Progress value={progress.done} max={Math.max(1, progress.total)} />
            <button className="btn small" onClick={cancel}>
              Annuler
            </button>
          </div>
        </Card>
      )}
      {error && <Callout tone="danger">Calcul impossible : {error}</Callout>}
      {saveFailed && <Callout tone="warn">Résultats calculés mais non enregistrés (stockage plein ou indisponible) : l’accueil et le plan ne pourront pas les reprendre.</Callout>}

      {stored && ranking ? (
        <>
          {stale && (
            <Callout tone="warn">
              Résultats calculés le {formatDate(stored.computedAt)} avec d’autres hypothèses (niveau {stored.context.jobLevel}, {stored.context.paddocks} enclos,{' '}
              {formatNumber(stored.context.hoursPerDay, 1)} h/jour, {stored.context.marketDate ? `prix du ${frenchDay(stored.context.marketDate)}` : 'sans export HDV'}) :{' '}
              <button className="btn small" onClick={run} disabled={!!progress}>
                Recalculer
              </button>
            </Callout>
          )}
          <BestBanner stored={stored} ranking={ranking.rows} activeModeId={activeModeId} onActivate={activate} />
          {active.familySwitch && (
            <Callout tone="warn">
              {familySwitchText(
                activeModeId === 'auto' ? `Le mode automatique (${active.def.label})` : `Le mode ${active.def.label}`,
                active.familySwitch.from,
                active.familySwitch.to,
                mounts.filter((m) => getSpecies(m.speciesId)?.family === active.familySwitch?.from).length,
              )}{' '}
              Choisissez un mode de vos {FAMILIES[active.familySwitch.from]?.plural ?? active.familySwitch.from} pour qu’ils servent la stratégie.
            </Callout>
          )}
          {pinned && (
            <Callout>
              Plan d’investissement suivi : <strong>{pinned.label}</strong>
              {pinned.budget !== null ? ` (budget ${formatKamas(pinned.budget, true)})` : ''} — l’accueil et le plan appliquent sa stratégie tant que le mode {modeDef(pinned.modeId).label} est actif.{' '}
              <button className="btn small" type="button" onClick={unpin}>
                Ne plus suivre ce plan
              </button>
            </Callout>
          )}
          <ComparisonTable rows={ranking.rows} selected={selectedId} activeModeId={activeModeId} onSelect={select} stored={stored} />
          <ModeDetail
            id={selectedId}
            stored={stored}
            ranking={ranking.rows}
            activeModeId={activeModeId}
            onActivate={activate}
            profile={profile}
          />
        </>
      ) : (
        !progress && (
          <Card>
            <Empty>
              <p>Aucune comparaison calculée pour ce profil.</p>
              <button className="btn primary" onClick={run}>
                Comparer les modes (≈ 15 s)
              </button>
            </Empty>
          </Card>
        )
      )}
    </div>
  )
}

// ---------- Meilleur mode (« auto ») ----------

function BestBanner({ stored, ranking, activeModeId, onActivate }: { stored: StoredModeResults; ranking: ModeRanking[]; activeModeId: ModeId; onActivate: (id: ModeId) => void }) {
  const best = ranking.find((r) => r.modeId === stored.bestModeId)
  const active = modeDef(activeModeId)
  return (
    <div className="md-best">
      <div>
        <span className="md-best-label">Mode actif du profil</span>
        <strong>
          {active.icon} {active.label}
        </strong>
        {activeModeId === 'auto' && best && <span className="muted"> → {best.def.label}</span>}
      </div>
      <div>
        <span className="md-best-label">Le plus rentable par jour</span>
        {best ? (
          <strong>
            {best.def.icon} {best.def.label}
            {best.family && best.def.families.length > 1 ? ` (${FAMILIES[best.family]?.plural ?? best.family})` : ''} — {formatKamasRange(best.net, true)}/jour
          </strong>
        ) : (
          <span className="muted">aucun mode au coût chiffré (prix manquants)</span>
        )}
      </div>
      <div className="row">
        {activeModeId !== 'auto' && (
          <button className="btn small" onClick={() => onActivate('auto')} title="Suivre automatiquement le mode le plus rentable de la dernière comparaison">
            Mode automatique
          </button>
        )}
        <span className="muted md-best-date">calculé le {formatDate(stored.computedAt)}{stored.quick ? ' (précision rapide)' : ' (précision fine)'}</span>
      </div>
    </div>
  )
}

// ---------- Tableau comparatif ----------

function productCell(r: ModeRanking) {
  if (!r.available) return <span className="muted">—</span>
  const per = r.def.kind === 'brisage' ? r.outcome.strategy?.brokenPerDay : null
  return (
    <>
      {r.producedPerDay !== null ? (
        <strong>
          {formatNumber(r.producedPerDay, r.producedPerDay < 10 ? 1 : 0)} {r.productName && r.def.kind !== 'vente' ? pluralItemName(r.productName, r.producedPerDay) : r.productName}
        </strong>
      ) : (
        <span className="muted">—</span>
      )}
      {per ? <small className="md-cell-sub">{formatNumber(per, 1)} montures brisées</small> : null}
      {r.def.kind === 'vente' && r.outcome.strategy ? <small className="md-cell-sub">{formatNumber(r.outcome.strategy.mountsSoldPerDay, 1)} montures vendues</small> : null}
      <small className="md-cell-sub">
        {r.shareOfMarket !== null && r.marketPerDay !== null
          ? `${formatPercent(r.shareOfMarket, 1)} des ${formatNumber(r.marketPerDay, r.marketPerDay < 10 ? 1 : 0)} ventes/j`
          : r.capPerDay === null && r.producedPerDay
            ? 'volume inconnu'
            : ''}
      </small>
    </>
  )
}

function ComparisonTable({
  rows,
  selected,
  activeModeId,
  onSelect,
  stored,
}: {
  rows: ModeRanking[]
  selected: ModeId
  activeModeId: ModeId
  onSelect: (id: ModeId) => void
  stored: StoredModeResults
}) {
  const shown = rows.filter((r) => r.modeId !== 'auto')
  const hasProgression = shown.some((r) => r.modeId === 'progression')
  return (
    <Card title="Comparaison des modes" actions={<span className="muted">régime permanent, par jour</span>}>
      <div className="table-wrap">
        <table className="table md-table">
          <thead>
            <tr>
              <th>Mode</th>
              <th className="num">Bénéfice net / jour</th>
              <th>Production / jour face au marché</th>
              <th className="num">Montée en charge</th>
              <th className="num">Capital immobilisé</th>
              <th className="num">Point mort</th>
              <th>Risques</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const isActive = activeModeId === r.modeId || (activeModeId === 'auto' && stored.bestModeId === r.modeId)
              return (
                <tr key={r.modeId} className={`${selected === r.modeId ? 'selected' : ''}${r.available ? '' : ' unavailable'}`} onClick={() => onSelect(r.modeId)}>
                  <td>
                    <button type="button" className="md-mode-btn" onClick={() => onSelect(r.modeId)} aria-pressed={selected === r.modeId}>
                      <span aria-hidden>{r.def.icon}</span> {r.def.label}
                    </button>
                    {r.family && r.def.families.length > 1 && r.def.kind === 'vente' && <small className="md-cell-sub">{FAMILIES[r.family]?.plural ?? r.family}</small>}
                    <span className="md-badges">
                      {r.rank !== null && <Badge tone={r.best ? 'gold' : undefined}>{r.best ? '1er' : `${r.rank}e`}</Badge>}
                      {r.tieWithBest && (
                        <Badge tone="info" title="Écart avec le premier dans le bruit des tirages (moins de 2 erreurs types) : départagé par le capital engagé, puis la montée en charge.">
                          à égalité
                        </Badge>
                      )}
                      {r.speculative && (
                        <Badge tone="danger" title="Ventes chiffrées au prix « HDV mixte » des objets-montures (niveaux, états, séniles mélangés) : saisissez le prix d’un bébé niveau 1 fécond (page Prix) pour classer ce mode.">
                          spéculatif · hors classement
                        </Badge>
                      )}
                      {isActive && <Badge tone="accent">actif</Badge>}
                    </span>
                    {r.outcome.strategy && <small className="md-cell-sub md-strategy">{r.outcome.strategy.label}</small>}
                  </td>
                  <td className="num">
                    {r.available ? (
                      <>
                        <strong className={r.netMean < 0 ? 'neg' : undefined}>{r.scoreBasis === 'quantite' ? `${formatKamasRange(r.net, true)}` : formatKamasRange(r.net, true)}</strong>
                        {r.scoreBasis === 'quantite' && <small className="md-cell-sub">prix du produit inconnu</small>}
                        {r.outcome.digest && Math.abs(r.outcome.digest.steady.netPerDay.max - r.outcome.digest.steady.netPerDay.min) > 1 && (
                          <small className="md-cell-sub" title={`Bénéfice par jour de chaque tirage (${bandLabel(r.runs)}) ; erreur type de la moyenne ≈ ${kamas(r.netSe)}.`}>
                            {kamas(r.outcome.digest.steady.netPerDay.min)} à {kamas(r.outcome.digest.steady.netPerDay.max)} ({bandLabel(r.runs)})
                          </small>
                        )}
                        {r.genetonShareOfNet !== null && r.genetonShareOfNet >= 0.05 && (
                          <small className={`md-cell-sub${r.genetonShareOfNet > 0.25 ? ' md-warn-text' : ''}`} title="Valeur estimée des génétons (Puissants Parchemins revendus) : voir « Pourquoi » et la sensibilité « Sans génétons » du mode.">
                            dont génétons {kamas(r.genetonsPerDay)} ({formatPercent(r.genetonShareOfNet, 0)} du net)
                          </small>
                        )}
                        {r.outcome.strategy?.extendedDays && (
                          <small className="md-cell-sub" title="Régime non stabilisé ou montée longue en 60 jours : stratégie réévaluée sur une durée plus longue, bénéfice de ce régime-là.">
                            régime sur {r.outcome.strategy.extendedDays} j
                          </small>
                        )}
                        {r.speculative && (
                          <small className="md-cell-sub md-warn-text">
                            potentiel spéculatif (HDV mixte) — <a href={href('prix', { onglet: 'montures' })}>saisissez le prix d’un bébé niv. 1 fécond</a>
                          </small>
                        )}
                      </>
                    ) : (
                      <span className="muted">{r.outcome.reason ?? 'indisponible'}</span>
                    )}
                  </td>
                  <td>{productCell(r)}</td>
                  <td className="num">{r.available ? (r.rampUpDays !== null ? `${formatNumber(r.rampUpDays)} j` : '> durée') : '—'}</td>
                  <td className="num">{r.capital !== null ? kamas(r.capital) : '—'}</td>
                  <td className="num">{r.available ? (r.breakEvenDay !== null ? `jour ${formatNumber(r.breakEvenDay)}` : `> ${MODE_HORIZON_DAYS} j`) : '—'}</td>
                  <td>
                    <span className="md-risks">
                      {r.risks.length === 0 && <span className="muted">—</span>}
                      {r.risks.map((x) => (
                        <Badge key={x.code} tone={x.tone === 'danger' ? 'danger' : x.tone === 'warn' ? 'warn' : 'info'} title={x.text}>
                          {x.label}
                        </Badge>
                      ))}
                    </span>
                  </td>
                </tr>
              )
            })}
            {!hasProgression && (
              <tr className={selected === 'progression' ? 'selected' : undefined} onClick={() => onSelect('progression')}>
                <td>
                  <button type="button" className="md-mode-btn" onClick={() => onSelect('progression')}>
                    <span aria-hidden>{modeDef('progression').icon}</span> {modeDef('progression').label}
                  </button>
                  {activeModeId === 'progression' && <Badge tone="accent">actif</Badge>}
                </td>
                <td colSpan={6} className="muted">
                  Objectif de génération du Plan d’élevage (non chiffré ici).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {stored.notes.length > 0 && (
        <ul className="md-notes muted">
          {stored.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <p className="muted md-note">
        Bénéfice net = revenus (ressources, runes ou montures vendues dans la limite du volume, génétons) − coûts (filets, carburant au prix du serveur, Mangeoire,
        Optimakinas). Capital immobilisé = socle des jauges + trésorerie avancée avant que la production ne paie. Un prix inconnu n’est jamais compté 0 : montant
        « ≥ » ou « inconnu ».
      </p>
    </Card>
  )
}

// ---------- Détail d'un mode ----------

function ModeDetail({
  id,
  stored,
  ranking,
  activeModeId,
  onActivate,
  profile,
}: {
  id: ModeId
  stored: StoredModeResults
  ranking: ModeRanking[]
  activeModeId: ModeId
  onActivate: (id: ModeId) => void
  profile: ModeProfile
}) {
  const def = modeDef(id)
  const row = ranking.find((r) => r.modeId === id)
  const o = row?.outcome ?? null
  const isActive = activeModeId === id
  const routine = useMemo(() => (o && o.strategy && o.digest ? dailyRoutine(id, o, { characters: profile.characters, maxMarketShare: profile.prices.maxMarketShare }) : null), [id, o, profile.characters, profile.prices.maxMarketShare])
  const actions = (
    <>
      {isActive ? (
        <Badge tone="accent">mode actif</Badge>
      ) : (
        <button className="btn small primary" onClick={() => onActivate(id)}>
          Activer ce mode
        </button>
      )}
      <a className="btn small" href={href('investissement', { mode: id })}>
        Estimer un investissement
      </a>
    </>
  )
  const title = (
    <h2>
      <span aria-hidden>{def.icon}</span> {def.label}
    </h2>
  )
  if (id === 'auto') {
    const best = ranking.find((r) => r.modeId === stored.bestModeId)
    return (
      <Card title={title} actions={actions} className="md-detail">
        <p>{def.description}</p>
        {best ? (
          <p>
            Aujourd’hui : <a href={href('modes', { mode: best.modeId })}>{best.def.label}</a> ({formatKamasRange(best.net, true)}/jour). Le mode suivi change si une nouvelle
            comparaison en désigne un autre.
          </p>
        ) : (
          <Callout tone="warn">Aucun mode au coût chiffré : saisissez les prix manquants ou importez l’export HDV.</Callout>
        )}
      </Card>
    )
  }
  if (!o || !o.strategy || !o.digest) {
    return (
      <Card title={title} actions={actions} className="md-detail">
        <p>{def.description}</p>
        {id === 'progression' ? (
          <p className="muted">
            Ce mode suit votre objectif de génération : voir le <a href={href('plan')}>Plan d’élevage</a> et l’<a href={href('optimiseur')}>Optimiseur</a>.
          </p>
        ) : (
          <Callout tone="warn">{o?.reason ?? 'Pas encore calculé pour ce profil.'}</Callout>
        )}
      </Card>
    )
  }
  const s = o.strategy
  const d = o.digest
  const st = d.steady
  const why = strategyWhy(o)
  const params = strategyParamLines(o)
  const sens = modeSensitivity(o)
  const liq = liquidityCheck(o, profile.prices.maxMarketShare ?? 0.15)
  const breakdown = revenueCostBreakdown(o)
  const missing = d.missing
  return (
    <Card title={title} actions={actions} className="md-detail">
      <p>{def.description}</p>
      {def.risk && <Callout tone="warn">{def.risk}</Callout>}
      {(s.speculative || d.speculative) && (
        <Callout tone="danger">
          <strong>Spéculatif (HDV mixte)</strong> : les montures vendues sont chiffrées au prix de leur objet-monture sur le marché (niveaux, états fertile/stérile et
          montures séniles mélangés), pas au prix d’un bébé niveau 1 fécond. Ce mode reste hors classement et n’est jamais choisi par le mode automatique : saisissez le
          prix d’un bébé niveau 1 fécond des espèces vendues sur la page <a href={href('prix', { onglet: 'montures' })}>Prix</a>.
        </Callout>
      )}
      {st.stable === false && (
        <Callout tone="warn">
          <strong>Régime non stabilisé</strong>{s.extendedDays ? ` (simulé sur ${s.extendedDays} jours)` : ''} : {st.instability.join(' ; ')}. Le bénéfice affiché est celui de la fin de
          la simulation, pas forcément celui du long terme.
        </Callout>
      )}
      {s.extendedDays && st.stable !== false && (
        <p className="muted md-note">
          Montée longue en {MODE_HORIZON_DAYS} jours : stratégie réévaluée sur {s.extendedDays} jours (enclos et filets d’ici le jour {MODE_HORIZON_DAYS}), régime permanent des jours{' '}
          {st.fromDay}–{st.toDay}.
        </p>
      )}
      {!s.complete && (
        <Callout tone="warn">
          Des prix manquent : les montants sont des minimums. À chiffrer :{' '}
          {missing.slice(0, 6).map((m, i) => (
            <span key={m}>
              {i > 0 && ', '}
              <a href={href('prix', { q: itemName(m) })}>{itemName(m)}</a>
            </span>
          ))}
          {missing.length > 6 ? '…' : ''}
        </Callout>
      )}
      <div className="grid grid-4 md-kpis">
        <Stat
          label="Bénéfice net / jour"
          value={formatKamasRange(st.net, true)}
          tone={st.netPerDay.mean < 0 ? 'neg' : 'pos'}
          hint={`${Math.abs(st.netPerDay.max - st.netPerDay.min) > 1 ? `${kamas(st.netPerDay.min)} à ${kamas(st.netPerDay.max)} (${bandLabel(d.runs)})` : `régime permanent (jours ${st.fromDay}–${st.toDay})`}${
            st.genetonShareOfNet !== null && st.genetonShareOfNet >= 0.05 ? ` · dont génétons ${kamas(st.revenueByCategory.genetons)} (${formatPercent(st.genetonShareOfNet, 0)} du net)` : ''
          }`}
        />
        <Stat label="Revenus / coûts par jour" value={`${kamas(st.revenueKnown)} / ${kamas(st.costKnown)}`} hint={`statut : ${st.status === 'exact' ? 'exact' : st.status}`} />
        <Stat
          label="Montée en charge"
          value={s.rampUpDays !== null ? `${formatNumber(s.rampUpDays)} jours` : st.stable === false ? 'non stabilisé' : `> ${d.config.horizonDays} jours`}
          hint={d.firstTargetDay !== null && def.kind !== 'brisage' ? `1re G${d.config.targetGeneration} vers le jour ${formatNumber(d.firstTargetDay)}` : '90 % du régime permanent'}
        />
        <Stat
          label="Capital immobilisé"
          value={kamas(d.capital.total)}
          hint={`socle des jauges ${kamas(d.capital.socleLow)} + trésorerie ${kamas(d.capital.peakCashNeed)}${d.capital.breakEvenDay !== null ? ` · point mort jour ${d.capital.breakEvenDay}` : ''}`}
        />
      </div>
      <CumulativeChart values={d.cumulativeByDay} />

      <div className="grid grid-2 md-sections">
        <section>
          <h3>Stratégie retenue</h3>
          <p className="md-strategy-label">{s.label}</p>
          <dl className="md-params">
            {params.map((p) => (
              <div key={p.label}>
                <dt>{p.label}</dt>
                <dd>{p.value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3>Pourquoi</h3>
          <ul className="md-why">
            {why.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          {o.alternatives.length > 0 && (
            <div className="table-wrap">
              <table className="table md-alts">
                <thead>
                  <tr>
                    <th>Autres stratégies</th>
                    <th className="num">Net / jour</th>
                    <th className="num">Montée</th>
                    <th className="num">Capital</th>
                  </tr>
                </thead>
                <tbody>
                  {o.alternatives.slice(0, 4).map((a) => (
                    <tr key={a.id}>
                      <td>{a.label}</td>
                      <td className="num">{formatKamasRange(a.net, true)}</td>
                      <td className="num">{a.rampUpDays !== null ? `${formatNumber(a.rampUpDays)} j` : '—'}</td>
                      <td className="num">{kamas(a.capital)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {o.variants.length > 0 && (
            <p className="muted md-note">
              Par famille :{' '}
              {o.variants.map((v, i) => (
                <span key={v.family}>
                  {i > 0 && ' · '}
                  {FAMILIES[v.family]?.plural ?? v.family} {v.strategy ? `${formatKamasRange(v.strategy.net, true)}/jour (G${v.strategy.targetGeneration})` : 'indisponible'}
                </span>
              ))}
            </p>
          )}
        </section>
      </div>

      {routine && <RoutineView routine={routine} modeId={id} />}

      <div className="grid grid-2 md-sections">
        <section>
          <h3>Revenus et coûts par jour</h3>
          <table className="table md-breakdown">
            <tbody>
              {breakdown.revenue.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="num pos">+ {kamas(r.value)}</td>
                </tr>
              ))}
              {breakdown.cost.map((c) => (
                <tr key={c.key}>
                  <td>{c.label}</td>
                  <td className="num neg">− {kamas(c.value)}</td>
                </tr>
              ))}
              <tr className="md-total">
                <td>Bénéfice net</td>
                <td className="num">{formatKamasRange(st.net, true)}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section>
          <h3>Sensibilité au prix {SENS_TITLE[mainRevenueCategory(o)]}</h3>
          <table className="table md-sens">
            <thead>
              <tr>
                <th>Scénario</th>
                <th className="num">Bénéfice net / jour</th>
                <th className="num">Écart</th>
              </tr>
            </thead>
            <tbody>
              {sens
                .filter((x) => x.factor < 1 && x.id.startsWith('prix-0'))
                .map((x) => (
                  <tr key={x.id}>
                    <td>Prix {x.label}</td>
                    <td className="num">{formatKamasRange(x.net, true)}</td>
                    <td className="num neg">{kamas(x.delta)}</td>
                  </tr>
                ))}
              <tr className="md-total">
                <td>Prix actuels</td>
                <td className="num">{formatKamasRange(st.net, true)}</td>
                <td className="num">—</td>
              </tr>
              {sens
                .filter((x) => x.factor > 1)
                .map((x) => (
                  <tr key={x.id}>
                    <td>Prix {x.label}</td>
                    <td className="num">{formatKamasRange(x.net, true)}</td>
                    <td className="num pos">+{kamas(x.delta)}</td>
                  </tr>
                ))}
              {sens
                .filter((x) => !x.id.startsWith('prix-0') && !x.id.startsWith('prix-1'))
                .map((x) => (
                  <tr key={x.id}>
                    <td>{x.label}</td>
                    <td className="num">{formatKamasRange(x.net, true)}</td>
                    <td className="num neg">{kamas(x.delta)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="muted md-note">
            À stratégie et quantités vendues inchangées (plafond de volume). « Sans génétons » : leur valeur est estimée (Puissants Parchemins revendus) et ils sont liés
            au compte ; « prix des montures −50 % » : prix « HDV mixte » incertain.
          </p>
        </section>
      </div>

      <section className="md-liquidity">
        <h3>Liquidité du marché</h3>
        {liq.length === 0 ? (
          <p className="muted">Rien à vendre à l’HDV dans ce mode (hors génétons).</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th className="num">Produit / jour</th>
                  <th className="num">Vendu / jour</th>
                  <th className="num">Plafond / jour</th>
                  <th className="num">Ventes du marché / jour</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {liq.slice(0, 8).map((l) => (
                  <tr key={`${l.kind}-${l.itemId}-${l.speciesId ?? ''}`}>
                    <td>{l.speciesId ? <a href={href('genetique', { id: l.speciesId })}>{getSpecies(l.speciesId)?.name ?? l.name}</a> : l.name}</td>
                    <td className="num">{formatNumber(l.producedPerDay, l.producedPerDay < 10 ? 1 : 0)}</td>
                    <td className="num">{formatNumber(l.soldPerDay, l.soldPerDay < 10 ? 1 : 0)}</td>
                    <td className="num">{l.capPerDay !== null ? formatNumber(l.capPerDay, l.capPerDay < 10 ? 1 : 0) : '?'}</td>
                    <td className="num">{l.marketPerDay !== null ? formatNumber(l.marketPerDay, l.marketPerDay < 10 ? 1 : 0) : '?'}</td>
                    <td>
                      <Badge tone={LIQ_TONE[l.status]} title={l.text}>
                        {LIQUIDITY_STATUS_LABELS[l.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted md-note">
          Plafond = {formatPercent(profile.prices.maxMarketShare ?? 0.15, 0)} des ventes quotidiennes moyennes (30 jours) de l’objet sur votre serveur (réglage du serveur) ; le
          reste est reporté au lendemain.
        </p>
        <PurchasesTable purchases={d.purchases ?? null} share={profile.prices.maxMarketShare ?? 0.15} />
      </section>

      {d.warnings.length > 0 && (
        <ul className="md-warnings">
          {d.warnings.slice(0, 6).map((w) => (
            <li key={`${w.code}-${w.text}`} className={w.tone}>
              {w.text}
            </li>
          ))}
        </ul>
      )}
      <details className="md-assumptions-list">
        <summary>Hypothèses et prix utilisés</summary>
        <ul>
          {d.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Prix</th>
                <th>Unité</th>
                <th className="num">Valeur</th>
                <th>Origine</th>
              </tr>
            </thead>
            <tbody>
              {d.prices.map((l) => (
                <tr key={l.key}>
                  <td>{l.itemId !== null ? <a href={href('prix', { q: itemName(l.itemId) })}>{l.label}</a> : l.label}</td>
                  <td>{l.unit}</td>
                  <td className="num">{l.value === null ? 'inconnu' : `${l.bound === 'min' ? '≥ ' : l.bound === 'max' ? '≤ ' : ''}${formatKamas(l.value)}`}</td>
                  <td>
                    {l.origin}
                    {l.estimated ? ' (estimation)' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  )
}

// ---------- Achats face au marché ----------

/** Achats au marché par jour (carburants, Optimakinas, filets) face aux ventes du serveur (revue UX2-02). */
function PurchasesTable({ purchases, share }: { purchases: PurchaseCheck[] | null; share: number }) {
  if (purchases === null) return <p className="muted md-note">Achats face au volume du marché : recalculez la comparaison pour les voir.</p>
  if (!purchases.length) return null
  const KIND: Record<string, string> = { carburant: 'Carburant', makina: 'Optimakina', filet: 'Filet' }
  const q = (v: number | null) => (v === null ? '?' : formatNumber(v, v < 10 ? 1 : 0))
  return (
    <>
      <h4>Achats / jour face aux ventes du marché</h4>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Achat</th>
              <th className="num">Acheté / jour</th>
              <th className="num">Plafond / jour</th>
              <th className="num">Ventes du marché / jour</th>
              <th className="num">Part</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={`${p.kind}-${p.itemId}`}>
                <td>
                  <a href={href('prix', { q: itemName(p.itemId) })}>{p.name}</a> <small className="muted">{KIND[p.kind] ?? p.kind}</small>
                </td>
                <td className="num">{q(p.buyPerDay)}</td>
                <td className="num">{q(p.capPerDay)}</td>
                <td className="num">
                  {q(p.marketPerDay)}
                  {p.recentPerDay !== null && p.marketPerDay !== null && p.recentPerDay < 0.5 * p.marketPerDay && <small className="md-cell-sub">7 derniers jours : {q(p.recentPerDay)}/jour</small>}
                </td>
                <td className="num">{p.shareOfMarket !== null ? formatPercent(p.shareOfMarket, 0) : '?'}</td>
                <td>
                  {p.marketPerDay === null ? (
                    <Badge tone="warn">volume inconnu</Badge>
                  ) : p.overCap ? (
                    <Badge
                      tone={p.marketPerDay > 0 && p.buyPerDay > p.marketPerDay ? 'danger' : 'warn'}
                      title={`${p.overVolumePerDay > 0.005 && p.highPrice !== null ? `≈ ${q(p.overVolumePerDay)}/jour au-delà du plafond comptées au prix haut (${formatKamas(p.highPrice)}). ` : ''}${p.craftLevel !== null ? (p.canCraft ? `Fabricable à votre niveau (recette niv. ${p.craftLevel}).` : `Recette niv. ${p.craftLevel}, hors de portée.`) : ''}`}
                    >
                      Achats &gt; volume
                    </Badge>
                  ) : (
                    <Badge tone="ok">absorbé</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted md-note">
        Au-delà de {formatPercent(share, 0)} des ventes quotidiennes d’un objet, vos achats font monter son prix : les Optimakinas au-delà sont comptées au prix haut du marché
        (stock d’avance de 14 jours), un carburant au-delà est remplacé par le suivant le moins cher (ou fabriqué).
      </p>
    </>
  )
}

// ---------- Routine ----------

function RoutineView({ routine, modeId }: { routine: ModeRoutine; modeId: ModeId }) {
  const checked = usePlanProgress((s) => s.checked)
  const toggle = usePlanProgress((s) => s.toggle)
  const day = useServerDay()
  const key = (session: string, item: string) => `routine:${day}:mode-${modeId}-${session}:${item}`
  const sessions = mergedSessions(routine)
  return (
    <section className="md-routine">
      <h3>Routine quotidienne (régime permanent)</h3>
      <p className="muted md-note">
        {routine.summary}. Ordre d’un passage : accoupler → cloner → sortir (extraire, vendre, briser) → capturer → mettre en enclos. Les cases cochées sont enregistrées
        pour aujourd’hui.
      </p>
      <div className={`md-sessions grid grid-${Math.min(3, sessions.length + 1)}`}>
        {sessions.map((s) => (
          <div key={s.id} className="md-session">
            <h4>{s.label}</h4>
            <ul>
              {s.items.map((it) => {
                const k = key(s.id, it.id)
                return (
                  <li key={it.id} className={checked[k] !== undefined ? 'done' : undefined}>
                    <label>
                      <input type="checkbox" checked={checked[k] !== undefined} onChange={() => toggle(k)} aria-label={`Fait : ${it.text}`} />
                      <span>{it.text}</span>
                    </label>
                    {it.hint && <small>{it.hint}</small>}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        <div className="md-session daily">
          <h4>Une fois par jour</h4>
          <ul>
            {routine.daily.map((it) => {
              const k = key('jour', it.id)
              return (
                <li key={it.id} className={`${checked[k] !== undefined ? 'done' : ''}${it.tone ? ` ${it.tone}` : ''}`}>
                  <label>
                    <input type="checkbox" checked={checked[k] !== undefined} onChange={() => toggle(k)} aria-label={`Fait : ${it.text}`} />
                    <span>{it.text}</span>
                  </label>
                  {it.kamas && it.kamas.value !== null && (
                    <small className="md-amount">
                      {it.kamas.label} : {it.kamas.complete ? '' : '≥ '}
                      {formatKamas(it.kamas.value, true)}
                    </small>
                  )}
                  {it.hint && <small>{it.hint}</small>}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
      {routine.notes.length > 0 && (
        <ul className="md-notes muted">
          {routine.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------- Courbe de trésorerie ----------

/** Cumul connu moyen jour après jour (SVG fait main) : montée en charge et point mort. */
function CumulativeChart({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const W = 600
  const H = 120
  const pad = 4
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const span = max - min || 1
  const x = (i: number) => pad + (i / (values.length - 1)) * (W - 2 * pad)
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - 2 * pad)
  const path = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = values[values.length - 1]
  return (
    <figure className="md-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cumul du bénéfice sur ${values.length} jours : ${formatKamas(last, true)} à la fin`} preserveAspectRatio="none">
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="md-chart-zero" />
        <path d={path} className="md-chart-line" />
      </svg>
      <figcaption className="muted">
        Cumul du bénéfice jour après jour (socle non compris) : {kamas(Math.min(...values))} au plus bas, {kamas(last)} au jour {values.length}.
      </figcaption>
    </figure>
  )
}
