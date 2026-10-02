// Page « Réglages » : profil d'éleveur (règles du jeu, niveau, objectif, rythme, accouplements,
// économie), sauvegarde des données (export / import / remise à zéro) et « à propos ».
// Tous les réglages sont dans useSettings (persisté) ; la sauvegarde dans src/lib/backup.ts.
// Les styles de la tranche « Guide & réglages » sont dans GuidePage.css.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FAMILIES, GAME, MAKINAS, NETS, PRICES_DEFAULT, getSpecies } from '../../data'
import {
  FUEL_TIER_NAMES,
  FUEL_TIER_UNLOCK_LEVEL,
  JOB_XP_PER_CAPTURE,
  MAX_PADDOCKS,
  MOUNT_STAT_MAX,
  PADDOCK_SLOTS,
  PADDOCK_UNLOCK_LEVELS,
  TICK_SECONDS,
} from '../../domain/constants'
import { TAKEZA_BONUS, TARGET_BASE, TARGET_PER_LEVEL, targetChance } from '../../domain/genetics'
import { gaugeDrainSeconds } from '../../domain/paddock'
import { RULESETS, type Ruleset } from '../../domain/rules'
import type { FamilyId, FuelTier, RulesetId } from '../../domain/types'
import { jobXpBetween, mountXpForLevel } from '../../domain/xp'
import {
  TYPICAL_STORAGE_QUOTA_BYTES,
  downloadBackup,
  exportAll,
  importAll,
  readBackupFile,
  resetAll,
  storageUsage,
  summarizeBackup,
  takeFlash,
  type BackupValidation,
  type ImportMode,
} from '../../lib/backup'
import { formatDate, formatDuration, formatNumber, formatPercent } from '../../lib/format'
import { useRules, useSettings, type Goal } from '../../store/settings'
import { Badge, Callout, Card, NumberField, PageHeader, Progress, Stat } from '../components'
import { href } from '../router'
import { ConfidenceBadge, GenBadge, SpeciesPicker } from '../species'
import './GuidePage.css'

const TIERS: FuelTier[] = [1, 2, 3, 4]
const RULESET_IDS: RulesetId[] = ['3.5', '3.6', '3.7']

const RULESET_INFO: Record<RulesetId, { title: string; tag: string; tone: 'info' | 'ok' | 'warn'; text: string }> = {
  '3.5': {
    title: '3.5',
    tag: 'historique',
    tone: 'info',
    text: 'Règles du 03/03 au 22/06/2026. Seule différence avec la 3.6 : 10 XP d’Éleveur par génération et par parent à l’accouplement (au lieu de 30). Utile pour comparer, pas pour jouer.',
  },
  '3.6': {
    title: '3.6',
    tag: 'live — recommandé',
    tone: 'ok',
    text: `Règles actuellement en jeu (client ${GAME.liveClientVersion}). C’est le choix par défaut.`,
  },
  '3.7': {
    title: '3.7',
    tag: 'bêta',
    tone: 'warn',
    text: `Serveur bêta (client ${GAME.betaClientVersion}) : jauges et carburants ×2, génétons ≈ ×2, Optimakina +20 %, Animakina = choix du sexe, étable 500. Pour préparer la sortie.`,
  },
}

const GOALS: { id: Goal; title: string; text: string }[] = [
  {
    id: 'profit',
    title: 'Kamas (profit)',
    text: 'Maximiser le bénéfice : ventes, extraction, brisage et génétons. Les dépenses (Optimakinas, carburants rapides) ne sont conseillées que si elles rapportent plus qu’elles ne coûtent.',
  },
  {
    id: 'succes',
    title: 'Succès (générations)',
    text: 'Atteindre la monture visée et les succès de génération le plus vite possible, quitte à dépenser davantage (Optimakina systématique, paliers rapides).',
  },
  {
    id: 'mixte',
    title: 'Mixte',
    text: 'Avancer dans l’arbre en restant rentable : on vise la génération suivante, mais chaque dépense doit rester raisonnable.',
  },
]

const TIER_ADVICE: Record<FuelTier, string> = {
  1: 'Le moins cher au point. Idéal la nuit et pendant les absences : les jauges tiennent longtemps sans surveillance.',
  2: 'Bon compromis pour la journée : deux fois plus rapide que le palier 1, coût au point modéré.',
  3: 'Pour une session active devant l’écran : rapide, mais chaque point coûte plus cher.',
  4: 'Réservé aux rushs (jour Takeza, fin d’objectif) : le plus rapide et de loin le plus cher au point.',
}

const SECTIONS: { id: string; label: string }[] = [
  { id: 'regles', label: 'Version du jeu' },
  { id: 'profil', label: 'Profil' },
  { id: 'objectif', label: 'Objectif' },
  { id: 'rythme', label: 'Rythme & enclos' },
  { id: 'accouplement', label: 'Accouplements' },
  { id: 'economie', label: 'Économie' },
  { id: 'donnees', label: 'Données' },
  { id: 'apropos', label: 'À propos' },
]

/** Dates AAAA-MM-JJ trouvées dans un texte, au format JJ/MM/AAAA. */
function frDates(text: string): string[] {
  return [...text.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)].map((m) => `${m[3]}/${m[2]}/${m[1]}`)
}
const PRICE_DATES = frDates(PRICES_DEFAULT.asOf)
const FEES_CONFIDENCE = (PRICES_DEFAULT.marketFees as unknown as { confidence?: string }).confidence ?? 'medium'

function formatBytes(n: number): string {
  if (n < 1024) return `${formatNumber(n)} o`
  if (n < 1024 * 1024) return `${formatNumber(n / 1024, 1)} Ko`
  return `${formatNumber(n / (1024 * 1024), 2)} Mo`
}

/** Bloc champ + explication. */
function Field({ children, help, wide }: { children: ReactNode; help?: ReactNode; wide?: boolean }) {
  return (
    <div className={`gs-field${wide ? ' wide' : ''}`}>
      {children}
      {help && <p className="gs-help">{help}</p>}
    </div>
  )
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="gs-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

/** Groupe de cartes-options (boutons radio). */
function OptionCards<T extends string | number>({
  legend,
  name,
  value,
  onChange,
  options,
}: {
  legend: string
  name: string
  value: T
  onChange: (v: T) => void
  options: { value: T; title: ReactNode; body: ReactNode; disabledHint?: ReactNode }[]
}) {
  return (
    <fieldset className="gs-fieldset">
      <legend>{legend}</legend>
      <div className="gs-options">
        {options.map((o) => (
          <label key={String(o.value)} className="gs-option" data-selected={o.value === value}>
            <span className="gs-option-head">
              <input type="radio" name={name} checked={o.value === value} onChange={() => onChange(o.value)} />
              <span className="gs-option-title">{o.title}</span>
            </span>
            <span className="gs-option-body">{o.body}</span>
            {o.disabledHint && <span className="gs-option-hint">{o.disabledHint}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function rulesetFacts(r: Ruleset): string[] {
  const k = (n: number) => `${formatNumber(n / 1000)}k`
  return [
    `Paliers ${k(r.gaugeTierMax[1])}/${k(r.gaugeTierMax[2])}/${k(r.gaugeTierMax[3])}/${k(r.gaugeTierMax[4])}`,
    `Optimakina +${formatPercent(r.optimakinaBonus, 0)}`,
    `Génétons G9 : ${r.genetonsByGeneration[9]}`,
    `XP accouplement : ${r.matingXpPerGeneration}/gén.`,
    `Étable : ${r.stableSlots}`,
  ]
}

/** Somme des niveaux des deux parents nécessaire pour 100 % de génération cible (ou null si impossible). */
function levelsFor100(bonus: number): number | null {
  const bp = 10_000 - Math.round(TARGET_BASE * 10_000) - Math.round(bonus * 10_000)
  if (bp <= 0) return 2
  const n = Math.ceil(bp / Math.round(TARGET_PER_LEVEL * 10_000))
  return n <= 400 ? Math.max(2, n) : null
}

// ---------- Déblocages du métier ----------

function JobUnlocks({ level, family }: { level: number; family: FamilyId }) {
  const paddocks = PADDOCK_UNLOCK_LEVELS.filter((p) => p.level <= level).length
  const nextPaddock = PADDOCK_UNLOCK_LEVELS.find((p) => p.level > level)
  const tiers = TIERS.filter((t) => FUEL_TIER_UNLOCK_LEVEL[t] <= level)
  const sizesInTopTier = tiers.length ? Math.min(5, Math.floor((level - FUEL_TIER_UNLOCK_LEVEL[tiers[tiers.length - 1]]) / 10) + 1) : 0
  const nets = NETS.filter((n) => (n.family === null || n.family === family) && n.level <= level)
  const nextNet = NETS.filter((n) => (n.family === null || n.family === family) && n.level > level).sort((a, b) => a.level - b.level)[0]
  const optis = MAKINAS.filter((m) => m.family === family && m.kind === 'optimakina' && m.level <= level)
  const maxOpti = optis.reduce((g, m) => Math.max(g, m.generation), 0)
  const firstOpti = MAKINAS.filter((m) => m.family === family && m.kind === 'optimakina').sort((a, b) => a.level - b.level)[0]
  const nextMilestone = [nextPaddock?.level, nextNet?.level, ...TIERS.map((t) => FUEL_TIER_UNLOCK_LEVEL[t])].filter((l): l is number => l !== undefined && l > level).sort((a, b) => a - b)[0]
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="gs-unlocks">
        <div>
          <strong>Enclos</strong>
          <span>
            {paddocks}/{MAX_PADDOCKS} ({paddocks * PADDOCK_SLOTS} places)
            {nextPaddock && <small> · suivant au niv. {nextPaddock.level}</small>}
          </span>
        </div>
        <div>
          <strong>Carburants fabriqués</strong>
          <span>
            {tiers.length === 0 ? (
              <>aucun avant le niv. {FUEL_TIER_UNLOCK_LEVEL[1]} (on peut toujours en acheter)</>
            ) : (
              <>
                {tiers.map((t) => FUEL_TIER_NAMES[t]).join(', ')}
                <small> · {sizesInTopTier}/5 tailles d’{FUEL_TIER_NAMES[tiers[tiers.length - 1]]}</small>
              </>
            )}
          </span>
        </div>
        <div>
          <strong>Filets équipables</strong>
          <span>
            {nets.map((n) => n.name).join(', ')}
            {nextNet && <small> · suivant au niv. {nextNet.level}</small>}
          </span>
        </div>
        <div>
          <strong>Optimakina {FAMILIES[family].label}</strong>
          <span>{maxOpti > 0 ? `jusqu’à G${maxOpti}` : `aucune avant le niv. ${firstOpti?.level ?? '?'}`}</span>
        </div>
      </div>
      {nextMilestone !== undefined && (
        <small>
          Prochain déblocage au niveau {nextMilestone} : encore {formatNumber(jobXpBetween(level, nextMilestone))} XP d’Éleveur (l’équivalent de{' '}
          {formatNumber(Math.ceil(jobXpBetween(level, nextMilestone) / JOB_XP_PER_CAPTURE))} captures à {JOB_XP_PER_CAPTURE} XP).{' '}
          <a href={href('metier')}>Plan de montée du métier</a>
        </small>
      )}
    </div>
  )
}

// ---------- Section Données ----------

type ImportState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'ready'; fileName: string; validation: Extract<BackupValidation, { ok: true }> }

function DataSection() {
  const [usage, setUsage] = useState(() => storageUsage())
  const refreshUsage = () => setUsage(storageUsage())
  const [exported, setExported] = useState<string | null>(null)
  const [imp, setImp] = useState<ImportState>({ status: 'idle' })
  const [confirmReset, setConfirmReset] = useState<'none' | 'all' | 'settings'>('none')
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const resetSettings = useSettings((s) => s.reset)

  useEffect(() => {
    const m = takeFlash()
    if (m) setMessage({ tone: 'ok', text: m })
  }, [])

  const doExport = () => {
    try {
      const name = downloadBackup(exportAll())
      setExported(name)
      refreshUsage()
    } catch {
      setMessage({ tone: 'danger', text: 'Le téléchargement a échoué : votre navigateur bloque peut-être les téléchargements.' })
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    const v = await readBackupFile(file)
    setImp(v.ok ? { status: 'ready', fileName: file.name, validation: v } : { status: 'error', message: v.error })
    if (fileRef.current) fileRef.current.value = ''
  }

  const doImport = (mode: ImportMode) => {
    if (imp.status !== 'ready') return
    const r = importAll(imp.validation.backup, { mode })
    // En cas de succès, la page se recharge (message affiché au retour).
    if (!r.ok) setImp({ status: 'error', message: r.error })
  }

  const pct = usage.totalBytes / TYPICAL_STORAGE_QUOTA_BYTES
  return (
    <Card title="Sauvegarde des données">
      {message && <Callout tone={message.tone}>{message.text}</Callout>}
      <p className="muted">
        Tout est enregistré <strong>uniquement dans ce navigateur</strong> (aucun serveur). Exportez régulièrement une sauvegarde : vider les données
        du navigateur, changer d’appareil ou de navigateur fait tout perdre. Le fichier se réimporte ici, sur n’importe quel appareil.
      </p>

      <div className="grid grid-2">
        <div className="stack">
          <h3>Place utilisée</h3>
          {usage.entries.length === 0 ? (
            <p className="muted">Aucune donnée enregistrée pour l’instant (réglages par défaut).</p>
          ) : (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{formatBytes(usage.totalBytes)}</strong>
                <small>sur ≈ {formatBytes(TYPICAL_STORAGE_QUOTA_BYTES)} autorisés par le navigateur ({formatPercent(pct, 1)})</small>
              </div>
              <Progress value={usage.totalBytes} max={TYPICAL_STORAGE_QUOTA_BYTES} color={pct > 0.8 ? 'var(--danger)' : pct > 0.5 ? 'var(--warn)' : undefined} />
              {pct > 0.8 && <Callout tone="danger">Stockage presque plein : exportez une sauvegarde puis allégez le journal.</Callout>}
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Donnée</th>
                      <th className="num">Taille</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.entries.map((e) => (
                      <tr key={e.key}>
                        <td>
                          {e.label}
                          <br />
                          <small className="mono">{e.key}</small>
                        </td>
                        <td className="num">{formatBytes(e.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="stack">
          <h3>Exporter</h3>
          <p className="gs-help" style={{ marginTop: 0 }}>
            Télécharge un fichier <code>.json</code> avec vos montures, enclos, plans, prix, journal, réglages et préférences d’affichage.
          </p>
          <div className="row">
            <button className="btn primary" onClick={doExport}>
              ⬇ Télécharger une sauvegarde
            </button>
          </div>
          {exported && <Callout tone="ok">Sauvegarde téléchargée : {exported}</Callout>}

          <h3>Importer</h3>
          <p className="gs-help" style={{ marginTop: 0 }}>
            Choisissez un fichier exporté par ElevageSimu. Il est vérifié avant tout changement, et rien n’est écrit sans votre confirmation.
          </p>
          <div className="row">
            <label className="btn gs-file">
              📂 Choisir un fichier…
              <input ref={fileRef} type="file" accept=".json,application/json" onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
          </div>
          {imp.status === 'error' && <Callout tone="danger">{imp.message}</Callout>}
          {imp.status === 'ready' && (
            <div className="gs-import-preview">
              <strong>{imp.fileName}</strong>
              <small>
                {imp.validation.backup.exportedAt ? `Exporté le ${formatDate(Date.parse(imp.validation.backup.exportedAt))}` : 'Date d’export inconnue'} · format v
                {imp.validation.backup.version}
              </small>
              {imp.validation.keys.length > 0 && (
                <ul>
                  {summarizeBackup(imp.validation.backup).map((l) => (
                    <li key={l.key}>
                      {l.label}
                      {l.detail && <span className="muted"> — {l.detail}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {imp.validation.warnings.map((w) => (
                <Callout key={w} tone="warn">
                  {w}
                </Callout>
              ))}
              <p className="gs-help">
                <strong>Remplacer</strong> : vos données actuelles sont effacées et remplacées par celles du fichier. <strong>Fusionner</strong> : seules
                les données présentes dans le fichier sont remplacées, le reste est gardé. La page se recharge ensuite.
              </p>
              <div className="row">
                <button className="btn" onClick={doExport}>
                  Sauvegarder d’abord mes données actuelles
                </button>
              </div>
              <div className="row">
                <button className="btn primary" onClick={() => doImport('replace')}>
                  Remplacer mes données
                </button>
                <button className="btn" onClick={() => doImport('merge')} disabled={imp.validation.keys.length === 0}>
                  Fusionner
                </button>
                <button className="btn ghost" onClick={() => setImp({ status: 'idle' })}>
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="divider" />
      <h3>Remise à zéro</h3>
      {confirmReset === 'none' && (
        <div className="row">
          <button className="btn" onClick={() => setConfirmReset('settings')}>
            Réinitialiser les réglages seulement…
          </button>
          <button className="btn danger" onClick={() => setConfirmReset('all')}>
            Tout effacer…
          </button>
        </div>
      )}
      {confirmReset === 'settings' && (
        <Callout tone="warn">
          <p>Les réglages de cette page reviennent aux valeurs par défaut (règles 3.6, niveau 1, Muldo…). Vos montures, prix et journal ne changent pas.</p>
          <div className="row">
            <button
              className="btn primary"
              onClick={() => {
                resetSettings()
                setConfirmReset('none')
                setMessage({ tone: 'ok', text: 'Réglages réinitialisés.' })
                refreshUsage()
              }}
            >
              Oui, réinitialiser les réglages
            </button>
            <button className="btn ghost" onClick={() => setConfirmReset('none')}>
              Annuler
            </button>
          </div>
        </Callout>
      )}
      {confirmReset === 'all' && (
        <Callout tone="danger">
          <p>
            <strong>Action définitive.</strong> Toutes les données d’ElevageSimu de ce navigateur seront effacées : montures, enclos et plans en cours,
            prix saisis, journal, réglages et préférences. Les autres sites ne sont pas touchés.
          </p>
          <div className="row">
            <button className="btn" onClick={doExport}>
              Télécharger une sauvegarde d’abord
            </button>
            <button className="btn danger" onClick={() => resetAll()}>
              Oui, tout effacer
            </button>
            <button className="btn ghost" onClick={() => setConfirmReset('none')}>
              Annuler
            </button>
          </div>
        </Callout>
      )}
    </Card>
  )
}

// ---------- Page ----------

export default function SettingsPage() {
  const s = useSettings()
  const update = useSettings((st) => st.update)
  const rules = useRules()
  const goal = s.goalSpeciesId !== null ? getSpecies(s.goalSpeciesId) : undefined
  const paddocks = PADDOCK_UNLOCK_LEVELS.filter((p) => p.level <= s.jobLevel).length

  const jump = (id: string) => document.getElementById(`reglages-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // Accouplements : effet du niveau visé des parents.
  const L = s.parentTargetLevel
  const chanceBase = targetChance(1, 1, { rules })
  const chanceAtL = targetChance(L, L, { rules })
  const chanceAtLOpti = targetChance(L, L, { rules, makina: 'optimakina' })
  const xpPerMount = mountXpForLevel(L)
  const xpRate = rules.gaugeRatePerTick[s.preferredTier]
  const xpSeconds = Math.ceil(xpPerMount / xpRate) * TICK_SECONDS
  const need100Opti = levelsFor100(rules.optimakinaBonus)
  const need100OptiTakeza = levelsFor100(rules.optimakinaBonus + TAKEZA_BONUS)
  const need100Bare = levelsFor100(0)

  const nightSeconds = gaugeDrainSeconds(rules.gaugeTierMax[1], 0, rules)

  return (
    <div className="settings-page">
      <PageHeader
        title="Réglages"
        subtitle="Votre profil d’éleveur : il alimente tous les calculs (plans, probabilités, coûts, conseils). Chaque changement est enregistré automatiquement dans ce navigateur."
      />

      <div className="grid grid-4 gs-summary">
        <Stat label="Règles du jeu" value={rules.id} hint={rules.id === '3.7' ? 'bêta' : rules.id === '3.6' ? 'live' : 'historique'} />
        <Stat label="Éleveur" value={`niv. ${s.jobLevel}`} hint={`${paddocks} enclos sur ${MAX_PADDOCKS}`} />
        <Stat label="Objectif" value={GOALS.find((g) => g.id === s.goal)?.title ?? s.goal} hint={FAMILIES[s.family].plural} />
        <Stat label="Monture visée" value={goal ? `G${goal.generation}` : '—'} hint={goal ? goal.name : 'aucune choisie'} />
      </div>

      <nav className="gs-jump" aria-label="Sections des réglages">
        {SECTIONS.map((sec) => (
          <button key={sec.id} className="btn small" onClick={() => jump(sec.id)}>
            {sec.label}
          </button>
        ))}
      </nav>

      <div id="reglages-regles" className="gs-anchor">
        <Card title="Version des règles du jeu">
          <OptionCards
            legend="Jeu de règles utilisé par tous les calculs"
            name="ruleset"
            value={s.ruleset}
            onChange={(v) => update({ ruleset: v })}
            options={RULESET_IDS.map((id) => ({
              value: id,
              title: (
                <>
                  {RULESET_INFO[id].title} <Badge tone={RULESET_INFO[id].tone}>{RULESET_INFO[id].tag}</Badge>
                </>
              ),
              body: (
                <>
                  {RULESET_INFO[id].text}
                  <span className="gs-facts">
                    {rulesetFacts(RULESETS[id]).map((f) => (
                      <span key={f} className="badge">
                        {f}
                      </span>
                    ))}
                  </span>
                </>
              ),
            }))}
          />
          {s.ruleset === '3.7' && (
            <Callout tone="warn">
              <strong>Règles bêta.</strong> Les valeurs viennent du client bêta {GAME.betaClientVersion} et du devblog du 16/09/2026 : elles peuvent encore
              changer et la date de sortie est inconnue. Les capacités sans makina (3 à 8 %) ne sont annoncées que par le devblog. Repassez en 3.6
              pour jouer sur les serveurs actuels. <a href={href('guide', { s: 'v37' })}>Ce qui change en 3.7</a>
            </Callout>
          )}
          {s.ruleset === '3.5' && (
            <Callout tone="warn">
              Règles historiques : elles ne correspondent plus au jeu actuel. Les plans et l’XP d’accouplement (10 au lieu de 30) seront faux pour vos
              sessions réelles.
            </Callout>
          )}
        </Card>
      </div>

      <div id="reglages-profil" className="gs-anchor">
        <Card title="Profil d’éleveur">
          <div className="gs-fields">
            <Field help="Les prix varient beaucoup d’un serveur à l’autre : notez le vôtre pour savoir à quoi correspondent vos prix saisis.">
              <label className="field">
                Serveur
                <input value={s.server} onChange={(e) => update({ server: e.target.value })} placeholder="ex. Salar, Tal Kasha…" maxLength={40} />
              </label>
            </Field>
            <Field help="Meilleur niveau d’Éleveur parmi les personnages du compte : c’est lui qui débloque les enclos (liés au compte).">
              <NumberField label="Niveau du métier d’Éleveur" value={s.jobLevel} min={1} max={200} onChange={(v) => update({ jobLevel: Math.round(v) })} />
              <div className="row gs-quick" role="group" aria-label="Niveaux clés">
                {PADDOCK_UNLOCK_LEVELS.map((p) => (
                  <button key={p.level} className="btn small" aria-pressed={s.jobLevel === p.level} onClick={() => update({ jobLevel: p.level })}>
                    {p.level}
                  </button>
                ))}
              </div>
            </Field>
            <Field
              help={
                <>
                  Chaque personnage du combat lance son propre filet (un par combat) : plus de personnages = plus de captures par combat. Un 2e personnage du
                  même compte n’ajoute pas d’enclos ; un 2e compte, si.
                </>
              }
            >
              <NumberField label="Personnages pour les captures" value={s.accounts} min={1} max={8} onChange={(v) => update({ accounts: Math.round(v) })} suffix="perso." />
            </Field>
          </div>
          <div className="divider" />
          <h3>Ce que votre niveau débloque</h3>
          <JobUnlocks level={s.jobLevel} family={s.family} />
        </Card>
      </div>

      <div id="reglages-objectif" className="gs-anchor">
        <Card title="Objectif d’élevage">
          <div className="grid grid-2">
            <div className="stack">
              <h3>Famille et monture visée</h3>
              <SpeciesPicker
                label="Monture visée"
                value={s.goalSpeciesId}
                onChange={(id) => update({ goalSpeciesId: id })}
                family={s.family}
                onFamilyChange={(f) => update({ family: f })}
                allowEmpty
              />
              <p className="gs-help">
                Bonus commun des {FAMILIES[s.family].plural} : {FAMILIES[s.family].commonBonus}. La monture visée sert de cible au plan d’élevage, à
                l’optimiseur et au tri de vos montures (garder ce qui sert la lignée).
              </p>
              {goal && goal.family !== s.family && (
                <Callout tone="warn">
                  La monture visée ({goal.name}) n’est pas de la famille choisie.{' '}
                  <button className="btn small" onClick={() => update({ family: goal.family })}>
                    Passer aux {FAMILIES[goal.family].plural}
                  </button>
                </Callout>
              )}
              {goal ? (
                <div className="gs-goal">
                  <GenBadge generation={goal.generation} /> <strong>{goal.name}</strong>
                  <small>
                    {goal.crossings.length === 0
                      ? 'Génération 1 : se capture.'
                      : `${goal.crossings.length} croisement${goal.crossings.length > 1 ? 's' : ''} possible${goal.crossings.length > 1 ? 's' : ''}`}
                    {' · '}
                    <a href={href('genetique', { id: goal.id })}>Voir l’arbre</a> · <a href={href('plan')}>Plan d’élevage</a>
                  </small>
                </div>
              ) : (
                <p className="muted">Aucune monture visée : choisissez-en une pour obtenir un plan étape par étape.</p>
              )}
            </div>
            <div className="stack">
              <OptionCards
                legend="Ce que vous cherchez avant tout"
                name="goal"
                value={s.goal}
                onChange={(v) => update({ goal: v })}
                options={GOALS.map((g) => ({ value: g.id, title: g.title, body: g.text }))}
              />
            </div>
          </div>
        </Card>
      </div>

      <div id="reglages-rythme" className="gs-anchor">
        <Card title="Rythme de jeu et enclos">
          <OptionCards
            legend={`Palier de jauge préféré (règles ${rules.id})`}
            name="tier"
            value={s.preferredTier}
            onChange={(v) => update({ preferredTier: v })}
            options={TIERS.map((t) => {
              const rate = rules.gaugeRatePerTick[t]
              const fill = Math.ceil(MOUNT_STAT_MAX / rate) * TICK_SECONDS
              const width = gaugeDrainSeconds(rules.gaugeTierMax[t], t === 1 ? 0 : rules.gaugeTierMax[(t - 1) as FuelTier], rules)
              const locked = s.jobLevel < FUEL_TIER_UNLOCK_LEVEL[t]
              return {
                value: t,
                title: (
                  <>
                    Palier {t} · {FUEL_TIER_NAMES[t]}
                  </>
                ),
                body: (
                  <>
                    <span className="gs-kv">
                      <span>{rate} pts / 10 s</span>
                      <span>stat 0 → 20 000 : {formatDuration(fill)}</span>
                      <span>tranche de palier : {formatDuration(width)}</span>
                    </span>
                    {TIER_ADVICE[t]}
                  </>
                ),
                disabledHint: locked ? `Fabrication au niv. ${FUEL_TIER_UNLOCK_LEVEL[t]} (achat possible avant).` : undefined,
              }
            })}
          />
          <p className="gs-help">
            <strong>Pourquoi ?</strong> Le nombre de points à verser est le même quel que soit le palier (60 000 points de stats par lot de 10 montures,
            plus le déplacement de sérénité) : le palier ne change que la <strong>vitesse</strong> et le <strong>prix au point</strong>. Une jauge
            remplie à {formatNumber(rules.gaugeTierMax[1])} (palier 1) tient {formatDuration(nightSeconds)} : parfait pour la nuit.
          </p>
          <div className="divider" />
          <div className="gs-fields">
            <Field help="Quand une seule jauge de statistique sert, la Mangeoire en 2e jauge fait gagner des niveaux sans temps perdu (+0,15 % de génération cible par niveau de parent).">
              <Check checked={s.xpFiller} onChange={(v) => update({ xpFiller: v })}>
                Mangeoire en complément
              </Check>
            </Field>
            <Field help="Sert à dimensionner les plannings (nombre de sessions, captures possibles par jour).">
              <NumberField label="Temps de jeu par jour" value={s.hoursPerDay} min={0.5} max={24} step={0.5} onChange={(v) => update({ hoursPerDay: v })} suffix="h" />
            </Field>
            <Field
              help={
                <>
                  Les plans évitent de vous demander un changement de jauges moins de {formatDuration(s.checkIntervalMinutes * 60)} après le précédent
                  (et privilégient un palier lent si vous passez rarement). Une jauge de sérénité active (Baffeur, Caresseur) demande quand même une
                  alarme.
                </>
              }
            >
              <NumberField
                label="Passage aux enclos toutes les"
                value={s.checkIntervalMinutes}
                min={5}
                max={1440}
                step={5}
                onChange={(v) => update({ checkIntervalMinutes: Math.round(v) })}
                suffix="min"
              />
            </Field>
          </div>
        </Card>
      </div>

      <div id="reglages-accouplement" className="gs-anchor">
        <Card title="Accouplements">
          <div className="gs-fields">
            <Field
              wide
              help={
                <>
                  Chaque niveau d’un parent ajoute {formatPercent(TARGET_PER_LEVEL, 2)} de chance d’obtenir la génération cible. La recherche retient{' '}
                  <strong>≈ 40</strong> comme meilleur compromis : +12 % par couple pour ≈ {formatNumber(mountXpForLevel(40))} XP par monture, gagnée
                  pendant la fécondation avec la Mangeoire. Au-delà, chaque niveau coûte de plus en plus d’XP et immobilise des places.
                </>
              }
            >
              <NumberField
                label="Niveau visé des parents avant l’accouplement"
                value={s.parentTargetLevel}
                min={1}
                max={200}
                onChange={(v) => update({ parentTargetLevel: Math.round(v) })}
              />
              <div className="row gs-quick" role="group" aria-label="Niveaux types">
                {[1, 20, 40, 60, 100, 200].map((l) => (
                  <button key={l} className="btn small" aria-pressed={s.parentTargetLevel === l} onClick={() => update({ parentTargetLevel: l })}>
                    {l}
                    {l === 40 ? ' (conseillé)' : ''}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <div className="grid grid-4">
            <Stat label="Chance de génération cible" value={formatPercent(chanceAtL, 2)} hint={`niv. ${L} + ${L}, sans makina (niv. 1 : ${formatPercent(chanceBase, 2)})`} />
            <Stat label="Avec Optimakina" value={formatPercent(chanceAtLOpti, 2)} hint={`+${formatPercent(rules.optimakinaBonus, 0)} en ${rules.id}`} />
            <Stat label="XP par monture" value={formatNumber(xpPerMount)} hint={`du niveau 1 au niveau ${L}`} />
            <Stat label={`Mangeoire palier ${s.preferredTier}`} value={formatDuration(xpSeconds)} hint="par lot (toutes les montures montent ensemble) ; ÷2 avec Sage" />
          </div>
          {L > 100 && (
            <Callout tone="warn">
              Viser plus de 100 coûte très cher en temps ({formatDuration(xpSeconds)} de Mangeoire par lot au palier {s.preferredTier}) pour peu de chance
              en plus : réservez-le aux couples de très haute génération.
            </Callout>
          )}
          <div className="divider" />
          <div className="gs-fields">
            <Field
              wide
              help={
                <>
                  L’Optimakina ajoute {formatPercent(rules.optimakinaBonus, 0)} de génération cible (règles {rules.id}). Une seule makina par
                  accouplement, de la même famille et de génération ≥ génération cible. Elle est rentable si son prix est inférieur à (valeur du bébé
                  cible × {formatPercent(rules.optimakinaBonus, 0)}) ÷ chance actuelle : la page{' '}
                  <a href={href('rentabilite')}>Rentabilité</a> fait le calcul avec vos prix.
                </>
              }
            >
              <Check checked={s.useOptimakina} onChange={(v) => update({ useOptimakina: v })}>
                Utiliser une Optimakina quand la génération cible le justifie
              </Check>
            </Field>
          </div>
          <p className="gs-help">
            100 % de génération cible : niveaux cumulés des deux parents ≥{' '}
            {need100Opti !== null ? <strong>{need100Opti}</strong> : 'impossible'} avec Optimakina
            {need100OptiTakeza !== null && (
              <>
                {' '}
                (≥ <strong>{need100OptiTakeza}</strong> le jour Takeza)
              </>
            )}
            {need100Bare === null ? ' ; sans makina, le maximum est ' + formatPercent(targetChance(200, 200, { rules }), 0) + '.' : `, ≥ ${need100Bare} sans makina.`}
          </p>
        </Card>
      </div>

      <div id="reglages-economie" className="gs-anchor">
        <Card title="Économie">
          <div className="gs-fields">
            <Field
              help={
                <>
                  Prélevée sur chaque vente à l’HDV : {PRICES_DEFAULT.marketFees.hdvListingTaxPct} % à la mise en vente, +{PRICES_DEFAULT.marketFees.priceChangeFeePct} % à
                  chaque modification de prix <ConfidenceBadge level={FEES_CONFIDENCE} />. Montez-la si vous baissez souvent vos prix.
                </>
              }
            >
              <NumberField
                label="Taxe HDV sur les ventes"
                value={Math.round(s.saleTax * 1000) / 10}
                min={0}
                max={10}
                step={0.5}
                onChange={(v) => update({ saleTax: Math.round(v * 10) / 1000 })}
                suffix="%"
              />
            </Field>
            <Field
              help={
                <>
                  Relevés communautaires datés ({PRICE_DATES.length >= 2 ? `du ${PRICE_DATES[0]} au ${PRICE_DATES[PRICE_DATES.length - 1]}` : PRICES_DEFAULT.asOf}), surtout sur Salar, souvent des estimations. Décoché :
                  seuls vos prix comptent et tout coût sans prix est signalé « coût incomplet ». <a href={href('prix')}>Saisir mes prix</a>
                </>
              }
            >
              <Check checked={s.useDefaultPrices} onChange={(v) => update({ useDefaultPrices: v })}>
                Utiliser les prix par défaut quand je n’ai rien saisi
              </Check>
            </Field>
          </div>
        </Card>
      </div>

      <div id="reglages-donnees" className="gs-anchor">
        <DataSection />
      </div>

      <div id="reglages-apropos" className="gs-anchor">
        <Card title="À propos">
          <div className="grid grid-4">
            <Stat label="Client live (règles 3.6)" value={GAME.liveClientVersion} />
            <Stat label="Client bêta (règles 3.7)" value={GAME.betaClientVersion} />
            <Stat label="Recherche" value="02/10/2026" hint="dernière relecture des sources" />
            <Stat label="Prix par défaut" value={PRICE_DATES[PRICE_DATES.length - 1] ?? '—'} hint="dernier relevé (voir page Prix)" />
          </div>
          <p style={{ marginTop: 12 }}>
            Les règles viennent des tables du client officiel, des devblogs Ankama, du guide de l’éleveur de Dofus pour les Noobs et d’outils communautaires,
            recoupés dans un dossier de recherche (<code>research/README.md</code>). Le modèle de naissance reproduit au centième les pourcentages de cinq
            captures d’écran en jeu ; les points encore incertains sont signalés par des badges de confiance{' '}
            <Badge tone="ok">fiable</Badge> <Badge tone="info">moyenne</Badge> <Badge tone="warn">estimation</Badge>.
          </p>
          <p>
            <a href={href('guide', { s: 'fiabilite' })}>Fiabilité et questions ouvertes</a> · <a href={href('guide', { s: 'sources' })}>Sources</a> ·{' '}
            <a href={href('guide')}>Guide & règles</a>
          </p>
          <Callout>
            <strong>Outil non officiel</strong>, gratuit et sans lien avec Ankama. Dofus est une marque d’Ankama Games. Les valeurs affichées peuvent être
            fausses après une mise à jour du jeu : en cas de doute, le jeu fait foi.
          </Callout>
        </Card>
      </div>
    </div>
  )
}
