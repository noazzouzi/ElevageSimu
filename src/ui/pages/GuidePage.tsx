// Page « Guide & règles » : les mécaniques de l'élevage 3.5+ expliquées avec nos propres mots, chiffrées
// à partir du jeu de règles actif (useRules) et des données (src/data). Sommaire interne, exemple
// d'accouplement calculé en direct par le moteur (breed), calendrier Almanax, erreurs fréquentes,
// différences 3.7, fiabilité et sources. Le texte de référence de la communauté reste le guide de
// l'éleveur de Dofus pour les Noobs (cité et lié, jamais recopié).
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import {
  FAMILIES,
  FAMILY_IDS,
  FUELS,
  GAME,
  INGREDIENTS,
  MAKINAS,
  NETS,
  PRICES_DEFAULT,
  SPECIES,
  STRATEGY,
  defaultItemPrice,
  getSpecies,
  speciesOfFamily,
  type StrategyRule,
} from '../../data'
import { almanaxOn, isoDay, upcomingAlmanax } from '../../domain/almanax'
import {
  ABILITY_LABELS,
  ANIMAKINA_ODDS,
  FUEL_SIZES,
  FUEL_SIZE_DURABILITY,
  FUEL_TIER_NAMES,
  FUEL_TIER_UNLOCK_LEVEL,
  GAUGE_IDS,
  JOB_XP_PER_CAPTURE,
  MAX_ACTIVE_GAUGES,
  MAX_PADDOCKS,
  MOUNT_STAT_MAX,
  PADDOCK_SLOTS,
  PADDOCK_UNLOCK_LEVELS,
  SERENITY_MAX,
  SERENITY_MIN,
  TICK_SECONDS,
} from '../../domain/constants'
import { breed, naturalDistribution, TAKEZA_BONUS, TARGET_BASE, TARGET_PER_LEVEL, treeWeights, type BreedingParent } from '../../domain/genetics'
import { gaugeDrainSeconds } from '../../domain/paddock'
import { RULESETS, type Ruleset } from '../../domain/rules'
import type { Ability, FamilyId, FuelTier, GaugeId, RulesetId } from '../../domain/types'
import { jobXpForLevel } from '../../domain/xp'
import { formatDuration, formatKamas, formatNumber, formatPercent } from '../../lib/format'
import { useRules, useSettings } from '../../store/settings'
import { Badge, Callout, GaugeChip, NumberField, PageHeader } from '../components'
import { href, useRoute } from '../router'
import { ConfidenceBadge, GenBadge, SpeciesName } from '../species'
import './GuidePage.css'

// ---------- Sommaire ----------

const SECTIONS = [
  { id: 'bases', label: 'Bases' },
  { id: 'enclos', label: 'Enclos & jauges' },
  { id: 'serenite', label: 'Sérénité & procédure' },
  { id: 'accouplement', label: 'Accouplement & génération cible' },
  { id: 'genetons', label: 'Génétons' },
  { id: 'clonage', label: 'Clonage, extraction, brisage' },
  { id: 'captures', label: 'Captures' },
  { id: 'metier', label: 'Métier Éleveur' },
  { id: 'almanax', label: 'Almanax' },
  { id: 'erreurs', label: 'Erreurs fréquentes' },
  { id: 'v37', label: 'Version 3.7 bêta' },
  { id: 'fiabilite', label: 'Fiabilité & questions ouvertes' },
  { id: 'sources', label: 'Sources' },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

const sectionDomId = (id: string) => `guide-${id}`
const TIERS: FuelTier[] = [1, 2, 3, 4]
const RULESET_IDS: RulesetId[] = ['3.5', '3.6', '3.7']
const DPLN_GUIDE = 'https://www.dofuspourlesnoobs.com/guide-de-l-eleveur.html'

// ---------- Petits utilitaires (données JSON peu typées) ----------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function strings(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []
}

/** Nombre formaté avec un vrai signe moins (−5 000). */
const k = (n: number) => formatNumber(n).replace('-', '−')

const dayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function daysUntil(iso: string, now: number): number {
  const today = isoToDate(isoDay(now))
  return Math.round((isoToDate(iso).getTime() - today.getTime()) / 86_400_000)
}

function inDays(n: number): string {
  if (n === 0) return 'aujourd’hui'
  if (n === 1) return 'demain'
  return `dans ${n} jours`
}

// ---------- Mise en page ----------

function Section({ id, title, aside, children }: { id: SectionId; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={sectionDomId(id)} className="card guide-section" aria-labelledby={`${sectionDomId(id)}-titre`}>
      <div className="card-title">
        <h2 id={`${sectionDomId(id)}-titre`}>{title}</h2>
        {aside && <div className="row">{aside}</div>}
      </div>
      {children}
      <button className="btn ghost small guide-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
        ↑ Haut de page
      </button>
    </section>
  )
}

function RulesBadge({ rules }: { rules: Ruleset }) {
  return (
    <a href={href('reglages')} className="guide-rules-badge" title="Changer de jeu de règles dans les Réglages">
      <Badge tone={rules.id === '3.7' ? 'warn' : 'accent'}>Règles {rules.id}</Badge>
    </a>
  )
}

function Table({ head, children, caption }: { head: ReactNode[]; children: ReactNode; caption?: string }) {
  return (
    <div className="table-wrap guide-table">
      <table className="table">
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

// ---------- Section : Bases ----------

const ABILITY_EFFECT: Record<Ability, string> = {
  amoureuse: 'gain d’amour ×2 (Dragofesse)',
  endurante: 'gain d’endurance ×2 (Foudroyeur)',
  precoce: 'gain de maturité ×2 (Abreuvoir)',
  sage: 'gain d’XP ×2 (Mangeoire)',
  reproducteur: '2 bébés au lieu d’un à l’accouplement (ne se cumule pas si les deux parents l’ont)',
  cameleone: 'purement cosmétique (la monture prend les couleurs du cavalier)',
}

function BasesSection({ rules }: { rules: Ruleset }) {
  const perGen = (f: FamilyId) => {
    const counts = Array.from({ length: 10 }, () => 0)
    for (const s of speciesOfFamily(f, { breedableOnly: true })) if (s.generation >= 1 && s.generation <= 10) counts[s.generation - 1]++
    return counts
  }
  const abilities = Object.keys(ABILITY_LABELS) as Ability[]
  return (
    <Section id="bases" title="Les bases">
      <p>
        Depuis la mise à jour 3.5 (3 mars 2026), l’élevage tient en trois idées : on rend une monture <strong>féconde</strong> en la laissant
        dans un enclos où des jauges remplissent ses statistiques ; on <strong>accouple</strong> deux montures fécondes pour obtenir un bébé ; et
        un arbre de croisements fixe quelle couleur peut naître de quel couple. Les anciennes notions (gestation, fatigue, énergie, certificats,
        montures « sauvages » à apprivoiser, niveau minimum) ont disparu : méfiez-vous des tutoriels antérieurs à mars 2026.
      </p>

      <h3>Trois familles</h3>
      <Table head={['Famille', 'Montures élevables', 'G1 à capturer', 'Bonus commun', 'Ressource d’extraction']}>
        {FAMILY_IDS.map((f) => {
          const info = FAMILIES[f]
          const g1 = SPECIES.filter((s) => s.family === f && s.capturable)
          return (
            <tr key={f}>
              <td>
                <strong>{info.plural}</strong>
              </td>
              <td className="num">{speciesOfFamily(f, { breedableOnly: true }).length}</td>
              <td>{g1.map((s) => s.name.replace(`${info.label} `, '')).join(', ')}</td>
              <td>{info.commonBonus}</td>
              <td>{info.extractionItemName}</td>
            </tr>
          )
        })}
      </Table>
      <p className="muted">
        La Dragodinde en armure et la Dragodinde à Plumes sont des montures spéciales « génération 0 » : elles ne s’accouplent pas et ne
        s’extraient pas.
      </p>

      <h3>Générations</h3>
      <p>
        Une monture capturée est toujours de <strong>génération 1</strong> (G1). Un couple dont la paire figure dans l’arbre peut donner un bébé de
        génération <em>max(génération des parents) + 1</em>, jusqu’à la G10. Une bicolore « X et Y » naît toujours du couple X × Y. Chez les
        Dragodindes, chaque monture n’a qu’une seule recette ; chez les Muldos et les Volkornes, les monocolores de génération impaire en ont
        plusieurs. Nombre de montures par génération :
      </p>
      <Table head={['Famille', ...Array.from({ length: 10 }, (_, i) => `G${i + 1}`)]}>
        {FAMILY_IDS.map((f) => (
          <tr key={f}>
            <td>{FAMILIES[f].plural}</td>
            {perGen(f).map((n, i) => (
              <td key={i} className="num">
                {n}
              </td>
            ))}
          </tr>
        ))}
      </Table>

      <h3>Cycle de vie d’une monture</h3>
      <ol className="guide-flow">
        <li>
          <strong>Fertile</strong> — à la naissance ou à la capture : niveau 1, endurance, maturité et amour à 0, sérénité tirée au hasard.
        </li>
        <li>
          <strong>Féconde</strong> — dès que ses trois statistiques atteignent {k(MOUNT_STAT_MAX)}. Aucun niveau minimum n’est exigé.
        </li>
        <li>
          <strong>Stérile</strong> — juste après un accouplement (les deux parents). Elle peut encore être clonée, extraite, vendue ou brisée.
        </li>
      </ol>
      <p className="muted">
        Une monture d’avant la 3.5 est <strong>sénile</strong> : ni accouplement ni clonage ; on peut l’équiper, la monter en niveau ou l’extraire
        (1 ressource).
      </p>

      <h3>Capacités</h3>
      <Table head={['Capacité', 'Effet']}>
        {abilities.map((a) => (
          <tr key={a}>
            <td>
              <strong>{ABILITY_LABELS[a]}</strong>
            </td>
            <td>{ABILITY_EFFECT[a]}</td>
          </tr>
        ))}
      </Table>
      <p>
        Les capacités ne s’héritent pas et se perdent au clonage. On les obtient au moment de la naissance :{' '}
        {rules.animakina === 'capacite' ? (
          <>
            avec une <strong>Animakina</strong> (tirage :{' '}
            {(Object.entries(ANIMAKINA_ODDS) as [Ability, number][]).map(([a, p]) => `${ABILITY_LABELS[a]} ${formatPercent(p, 0)}`).join(', ')}), une{' '}
            <strong>Kromakina</strong> (Caméléone à coup sûr) ou certains jours d’Almanax.
          </>
        ) : (
          <>
            en 3.7, sans makina (tirage :{' '}
            {(Object.entries(rules.naturalAbilityOdds ?? {}) as [Ability, number][]).map(([a, p]) => `${ABILITY_LABELS[a]} ${formatPercent(p, 0)}`).join(', ')}
            , chiffres du devblog), avec une Kromakina (Caméléone) ou certains jours d’Almanax ; l’Animakina sert alors à choisir le sexe.
          </>
        )}
      </p>
    </Section>
  )
}

// ---------- Section : Enclos & jauges ----------

const GAUGE_WHO: Record<GaugeId, string> = {
  baffeur: `sérénité > ${k(SERENITY_MIN)}`,
  caresseur: `sérénité < ${k(SERENITY_MAX)}`,
  foudroyeur: `endurance < ${k(MOUNT_STAT_MAX)} et sérénité entre ${k(SERENITY_MIN)} et −1`,
  abreuvoir: `maturité < ${k(MOUNT_STAT_MAX)} et sérénité entre −2 000 et 2 000`,
  dragofesse: `amour < ${k(MOUNT_STAT_MAX)} et sérénité entre 0 et ${k(SERENITY_MAX)}`,
  mangeoire: 'niveau < 200',
}

const GAUGE_ROLE: Record<GaugeId, string> = {
  baffeur: 'fait baisser la sérénité',
  caresseur: 'fait monter la sérénité',
  foudroyeur: 'remplit l’endurance',
  abreuvoir: 'remplit la maturité',
  dragofesse: 'remplit l’amour',
  mangeoire: 'donne de l’expérience',
}

function EnclosSection({ rules, jobLevel }: { rules: Ruleset; jobLevel: number }) {
  const fullDrain = gaugeDrainSeconds(rules.gaugeTierMax[4], 0, rules)
  return (
    <Section id="enclos" title="Enclos et jauges" aside={<RulesBadge rules={rules} />}>
      <p>
        Le Village des Éleveurs compte <strong>{MAX_PADDOCKS} enclos de {PADDOCK_SLOTS} places</strong>, tous identiques. Ils sont liés au compte :
        c’est le meilleur niveau d’Éleveur parmi vos personnages qui les débloque. Tout se pilote à distance (remplir les jauges, les activer,
        accoupler, cloner, extraire) <strong>sauf</strong> poser ou retirer une monture, qui demande d’être sur la carte de l’enclos. Pour
        accoupler, les deux montures doivent être dans l’étable ({rules.stableSlots} places en {rules.id}).
      </p>
      <Table head={['Enclos', 'Niveau d’Éleveur', 'Position', 'Pour vous']}>
        {PADDOCK_UNLOCK_LEVELS.map((p, i) => (
          <tr key={p.level}>
            <td>
              {i + 1}. {p.name}
            </td>
            <td className="num">{p.level}</td>
            <td className="mono">{p.coords}</td>
            <td>{jobLevel >= p.level ? <Badge tone="ok">débloqué</Badge> : <Badge>encore {p.level - jobLevel} niv.</Badge>}</td>
          </tr>
        ))}
      </Table>

      <h3>Les six jauges</h3>
      <Table head={['Jauge', 'Rôle', 'Une monture en profite si…']}>
        {GAUGE_IDS.map((g) => (
          <tr key={g}>
            <td>
              <GaugeChip gauge={g} />
            </td>
            <td>{GAUGE_ROLE[g]}</td>
            <td>{GAUGE_WHO[g]}</td>
          </tr>
        ))}
      </Table>
      <ul>
        <li>
          Au plus <strong>{MAX_ACTIVE_GAUGES} jauges actives</strong> en même temps par enclos, et jamais Baffeur avec Caresseur.
        </li>
        <li>
          Toutes les {TICK_SECONDS} secondes, chaque jauge active qui a au moins une monture intéressée perd un nombre de points fixé par son palier ;
          chaque monture intéressée gagne <strong>ce même nombre</strong> (le double avec la capacité correspondante).
        </li>
        <li>
          Ce débit ne dépend pas du nombre de montures : la jauge se vide aussi vite pour 1 monture que pour 10. D’où la règle d’or :{' '}
          <strong>
            {PADDOCK_SLOTS} montures qui ont besoin de la jauge active, sinon le carburant est gaspillé
          </strong>{' '}
          (rendement = montures concernées ÷ {PADDOCK_SLOTS}).
        </li>
        <li>Une jauge sans aucune monture intéressée ne consomme rien (stat déjà pleine, sérénité hors zone, niveau 200…).</li>
      </ul>

      <h3>Paliers de jauge ({rules.id})</h3>
      <Table head={['Palier', 'Remplissage de la jauge', 'Débit / 10 s', 'Durée de la tranche', 'Une stat 0 → 20 000']}>
        {TIERS.map((t) => {
          const lo = t === 1 ? 0 : rules.gaugeTierMax[(t - 1) as FuelTier]
          const width = gaugeDrainSeconds(rules.gaugeTierMax[t], lo, rules)
          const fill = Math.ceil(MOUNT_STAT_MAX / rules.gaugeRatePerTick[t]) * TICK_SECONDS
          return (
            <tr key={t}>
              <td>
                {t} · {FUEL_TIER_NAMES[t]}
              </td>
              <td>
                {k(lo === 0 ? 0 : lo + 1)} → {k(rules.gaugeTierMax[t])}
              </td>
              <td className="num">{rules.gaugeRatePerTick[t]}</td>
              <td className="num">{formatDuration(width)}</td>
              <td className="num">{formatDuration(fill)}</td>
            </tr>
          )
        })}
      </Table>
      <p>
        Une jauge pleine ({k(rules.gaugeTierMax[4])}) se vide entièrement en <strong>{formatDuration(fullDrain)}</strong> : elle passe d’abord par la
        tranche du palier 4 (rapide), puis 3, 2 et 1 (lente). Le palier ne change que la <strong>vitesse</strong> ; le nombre de points à verser pour
        rendre un lot fécond, lui, ne change pas.
      </p>

      <h3>Carburants</h3>
      <p>
        On remplit les jauges avec des carburants fabriqués par les Éleveurs : 6 jauges × 4 familles × 5 tailles = 120 objets. Un carburant ne
        peut être versé que si la jauge est sous le plafond de sa famille, et il la remplit au plus jusqu’à ce plafond : le surplus est
        probablement perdu <ConfidenceBadge level="medium" />, donc visez des dépôts qui tombent juste. Utiliser un carburant ne demande aucun
        niveau de métier.
      </p>
      <Table head={['Famille', 'Plafond', 'Points par taille (Minuscule → Gigantesque)', 'Fabrication']}>
        {TIERS.map((t) => (
          <tr key={t}>
            <td>{FUEL_TIER_NAMES[t]}</td>
            <td className="num">{t === 4 ? `aucun (${k(rules.gaugeTierMax[4])})` : k(rules.gaugeTierMax[t])}</td>
            <td>{FUEL_SIZES.map((s) => k(FUEL_SIZE_DURABILITY[s] * rules.fuelDurabilityFactor)).join(' / ')}</td>
            <td>
              niv. {FUEL_TIER_UNLOCK_LEVEL[t]} à {FUEL_TIER_UNLOCK_LEVEL[t] + 40}
            </td>
          </tr>
        ))}
      </Table>
      <p className="muted">
        Coût d’un point pour une monture = prix du carburant ÷ points qu’il contient ÷ montures qui en profitent. Les prix réels se saisissent dans
        la page <a href={href('prix')}>Prix</a> ; la page <a href={href('enclos')}>Enclos</a> calcule les durées et les changements de jauges de vos
        lots.
      </p>
    </Section>
  )
}

// ---------- Section : Sérénité ----------

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="guide-mini-steps">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ol>
  )
}

const G = (g: GaugeId) => <GaugeChip gauge={g} />

function SereniteSection({ rules }: { rules: Ruleset }) {
  const perHour1 = rules.gaugeRatePerTick[1] * (3600 / TICK_SECONDS)
  const perHour4 = rules.gaugeRatePerTick[4] * (3600 / TICK_SECONDS)
  return (
    <Section id="serenite" title="Sérénité et procédure selon la zone">
      <p>
        La sérénité va de {k(SERENITY_MIN)} à {k(SERENITY_MAX)}. Elle ne bouge qu’avec le Baffeur (vers le bas) et le Caresseur (vers le haut) ;
        gagner de l’endurance, de la maturité ou de l’amour ne la modifie plus. Elle décide <strong>quelles statistiques peuvent monter</strong>, ce
        que le jeu résume par un smiley de couleur :
      </p>
      <Table head={['Zone (smiley)', 'Sérénité', 'Statistiques qui montent']}>
        <tr>
          <td>
            <span className="guide-mood red">:C</span> rouge
          </td>
          <td>{k(SERENITY_MIN)} à −2 001</td>
          <td>endurance seule</td>
        </tr>
        <tr>
          <td>
            <span className="guide-mood blue">:(</span> bleu
          </td>
          <td>−2 000 à −1</td>
          <td>endurance + maturité</td>
        </tr>
        <tr>
          <td>
            <span className="guide-mood purple">:)</span> violet
          </td>
          <td>0 à 2 000</td>
          <td>maturité + amour</td>
        </tr>
        <tr>
          <td>
            <span className="guide-mood green">:D</span> vert
          </td>
          <td>2 001 à {k(SERENITY_MAX)}</td>
          <td>amour seul</td>
        </tr>
      </Table>

      <h3>Que faire selon la sérénité de départ</h3>
      <p>
        L’idée : passer le plus de temps possible dans une zone où <strong>deux</strong> statistiques montent ensemble (les deux jauges actives
        travaillent alors pour toutes les montures), et ne traverser l’autre zone qu’une seule fois.
      </p>
      <div className="guide-procs">
        <div className="guide-proc">
          <h4>Sérénité &lt; −2 000 (rouge)</h4>
          <Steps
            items={[
              <>
                {G('foudroyeur')} + {G('caresseur')} : l’endurance monte pendant que la sérénité remonte vers −2 000.
              </>,
              <>
                Dès la zone bleue : {G('foudroyeur')} + {G('abreuvoir')} jusqu’à endurance et maturité pleines.
              </>,
              <>{G('caresseur')} jusqu’à une sérénité ≥ 0.</>,
              <>
                {G('dragofesse')} (+ {G('mangeoire')}) jusqu’à l’amour plein.
              </>,
            ]}
          />
        </div>
        <div className="guide-proc">
          <h4>Sérénité de −2 000 à −1 (bleu)</h4>
          <Steps
            items={[
              <>
                {G('foudroyeur')} + {G('abreuvoir')} : endurance et maturité finissent ensemble.
              </>,
              <>{G('caresseur')} du nombre de points qui manque pour atteindre 0.</>,
              <>
                {G('dragofesse')} (+ {G('mangeoire')}).
              </>,
            ]}
          />
        </div>
        <div className="guide-proc">
          <h4>Sérénité de 0 à 2 000 (violet)</h4>
          <Steps
            items={[
              <>
                {G('dragofesse')} + {G('abreuvoir')} : amour et maturité finissent ensemble.
              </>,
              <>{G('baffeur')} jusqu’à passer sous 0 (sérénité + 1 points).</>,
              <>
                {G('foudroyeur')} (+ {G('mangeoire')}).
              </>,
            ]}
          />
        </div>
        <div className="guide-proc">
          <h4>Sérénité &gt; 2 000 (vert)</h4>
          <Steps
            items={[
              <>
                {G('dragofesse')} + {G('baffeur')} : l’amour monte pendant que la sérénité redescend vers 2 000.
              </>,
              <>
                Dès la zone violette : {G('abreuvoir')} (+ {G('dragofesse')} si l’amour n’est pas plein).
              </>,
              <>{G('baffeur')} jusqu’à une sérénité ≤ −1.</>,
              <>
                {G('foudroyeur')} (+ {G('mangeoire')}).
              </>,
            ]}
          />
        </div>
      </div>

      <h3>Règles pratiques</h3>
      <ul>
        <li>
          <strong>Lots homogènes</strong> : ne mettez ensemble que des montures dont la sérénité tient dans une fenêtre de 2 000 points, sinon
          certaines sortent de la zone utile pendant que les autres y entrent.
        </li>
        <li>
          <strong>Alarme obligatoire</strong> sur toute jauge de sérénité active : elle déplace la sérénité de {k(perHour1)} points par heure au
          palier 1 et {k(perHour4)} au palier 4, et ne s’arrête qu’aux bornes ±5 000. Mieux : n’y versez que les points nécessaires, elle
          s’arrêtera seule.
        </li>
        <li>
          Pour un lot de {PADDOCK_SLOTS} montures, comptez <strong>60 000 points de statistiques</strong> (3 × 20 000, partagés par tout le lot) plus
          le déplacement de sérénité. Le palier choisi ne change que la vitesse et le prix au point.
        </li>
        <li>
          La <GaugeChip gauge="mangeoire" /> en 2e jauge pendant les phases à une seule statistique fait monter les parents en niveau sans temps
          perdu.
        </li>
      </ul>
      <p className="muted">
        La page <a href={href('enclos')}>Enclos</a> applique cette procédure à vos montures réelles, tick par tick, avec les heures de changement de
        jauges.
      </p>
    </Section>
  )
}

// ---------- Section : Accouplement (exemple calculé en direct) ----------

interface Example {
  id: string
  label: string
  a: BreedingParent
  b: BreedingParent
  note: ReactNode
}

const EXAMPLES: Example[] = [
  {
    id: 'g1',
    label: 'Deux G1 capturées : Muldo Doré × Muldo Indigo',
    a: { speciesId: 94, level: 1, parents: [] },
    b: { speciesId: 92, level: 1, parents: [] },
    note: 'Le cas le plus simple : deux captures sans arbre. Seule la bicolore G2 est « cible » ; le reste revient aux couleurs des parents.',
  },
  {
    id: 'ex1',
    label: 'Dragodinde Pourpre (G5) × Dragodinde Émeraude (G9, avec arbre)',
    a: { speciesId: 19, level: 200, parents: [] },
    b: { speciesId: 21, level: 1, parents: [66, 68] },
    note: (
      <>
        Couple tiré d’une capture d’écran du guide DPLN. En 3.6, niveaux 200 et 1, le jeu affichait 60,15 / 19,92 / 15,73 / 2,1 / 2,1 % sans makina,
        et 70,15 / 14,92 / 11,78 / 1,57 / 1,57 % avec Optimakina : le moteur de l’application retrouve exactement ces valeurs.
      </>
    ),
  },
]

function TreeTable({ parent, title }: { parent: BreedingParent; title: string }) {
  const weights = treeWeights(parent)
  const rows = [
    { id: parent.speciesId, pos: 10 },
    ...parent.parents.slice(0, 2).map((id) => ({ id, pos: 6 })),
  ]
  return (
    <div>
      <h4>{title}</h4>
      <Table head={['Membre', 'Position × poids génétique', 'Part de l’arbre']}>
        {rows.map((r, i) => {
          const sp = getSpecies(r.id)
          return (
            <tr key={`${r.id}-${i}`}>
              <td>
                <SpeciesName id={r.id} />
              </td>
              <td className="num">
                {r.pos} × {sp?.geneticWeight ?? '?'} = {r.pos * (sp?.geneticWeight ?? 0)}
              </td>
              <td className="num">{i === rows.findIndex((x) => x.id === r.id) ? formatPercent(weights.get(r.id) ?? 0, 1) : '(cumulé)'}</td>
            </tr>
          )
        })}
      </Table>
    </div>
  )
}

function BreedingExample({ rules }: { rules: Ruleset }) {
  const [exId, setExId] = useState(EXAMPLES[1].id)
  const ex = EXAMPLES.find((e) => e.id === exId) ?? EXAMPLES[0]
  const [levels, setLevels] = useState<[number, number]>([ex.a.level, ex.b.level])
  const [opti, setOpti] = useState(false)
  const [takeza, setTakeza] = useState(false)

  const choose = (id: string) => {
    const next = EXAMPLES.find((e) => e.id === id) ?? EXAMPLES[0]
    setExId(next.id)
    setLevels([next.a.level, next.b.level])
  }

  const a = useMemo(() => ({ ...ex.a, level: levels[0] }), [ex, levels])
  const b = useMemo(() => ({ ...ex.b, level: levels[1] }), [ex, levels])
  const result = useMemo(() => {
    try {
      return breed(a, b, { makina: opti ? 'optimakina' : null, takeza, rules })
    } catch {
      return null
    }
  }, [a, b, opti, takeza, rules])
  const natural = useMemo(() => {
    try {
      return naturalDistribution(a, b)
    } catch {
      return null
    }
  }, [a, b])

  if (!result || !natural) return <Callout tone="danger">Exemple indisponible (données manquantes).</Callout>
  const levelPart = TARGET_PER_LEVEL * (levels[0] + levels[1])
  const raw = TARGET_BASE + levelPart + (opti ? rules.optimakinaBonus : 0) + (takeza ? TAKEZA_BONUS : 0)

  return (
    <div className="guide-example">
      <div className="guide-example-controls">
        <label className="field">
          Exemple
          <select value={exId} onChange={(e) => choose(e.target.value)}>
            {EXAMPLES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <NumberField label={`Niveau — ${getSpecies(ex.a.speciesId)?.name ?? 'parent A'}`} value={levels[0]} min={1} max={200} onChange={(v) => setLevels([Math.round(v), levels[1]])} />
        <NumberField label={`Niveau — ${getSpecies(ex.b.speciesId)?.name ?? 'parent B'}`} value={levels[1]} min={1} max={200} onChange={(v) => setLevels([levels[0], Math.round(v)])} />
        <label className="gs-check">
          <input type="checkbox" checked={opti} onChange={(e) => setOpti(e.target.checked)} /> Optimakina (+{formatPercent(rules.optimakinaBonus, 0)})
        </label>
        <label className="gs-check">
          <input type="checkbox" checked={takeza} onChange={(e) => setTakeza(e.target.checked)} /> Jour Takeza (+{formatPercent(TAKEZA_BONUS, 0)})
        </label>
      </div>
      <p className="muted">{ex.note}</p>

      <div className="grid grid-2">
        <TreeTable parent={a} title={`Arbre du parent A`} />
        <TreeTable parent={b} title={`Arbre du parent B`} />
      </div>

      <p className="guide-formula">
        B = {formatPercent(TARGET_BASE, 0)} + {formatPercent(TARGET_PER_LEVEL, 2)} × ({levels[0]} + {levels[1]}) = {formatPercent(TARGET_BASE + levelPart, 2)}
        {opti && <> + {formatPercent(rules.optimakinaBonus, 0)} (Optimakina)</>}
        {takeza && <> + {formatPercent(TAKEZA_BONUS, 0)} (Takeza)</>}
        {(opti || takeza) && <> = {formatPercent(raw, 2)}</>}
        {raw > 1 && <> → plafonné à 100 %</>}
        {result.targetChance === 1 && raw < 1 && <> → 100 % (aucune autre issue possible)</>}
      </p>

      <Table head={['Bébé possible', 'Gén.', 'Part naturelle', 'Probabilité finale', 'Rôle', 'Génétons']}>
        {result.outcomes.map((o) => (
          <tr key={o.speciesId} className={o.isTarget ? 'guide-target-row' : undefined}>
            <td>
              <SpeciesName id={o.speciesId} withGen={false} />
            </td>
            <td>
              <GenBadge generation={o.generation} />
            </td>
            <td className="num">{formatPercent(natural.get(o.speciesId) ?? 0, 2)}</td>
            <td className="num">
              <strong>{formatPercent(o.probability, 2)}</strong>
            </td>
            <td>{o.isTarget ? <Badge tone="gold">cible G{o.generation}</Badge> : <Badge>autre</Badge>}</td>
            <td className="num">{o.genetons > 0 ? o.genetons : '—'}</td>
          </tr>
        ))}
      </Table>
      <p className="muted">
        XP d’Éleveur de cet accouplement : {k(result.jobXp)} ({rules.matingXpPerGeneration} × (G{getSpecies(a.speciesId)?.generation} + G
        {getSpecies(b.speciesId)?.generation})). Makina utilisable : génération ≥ {result.makinaGenerationRequired}. Pour vos propres couples, utilisez
        la page <a href={href('accouplement')}>Accouplement</a>.
      </p>
    </div>
  )
}

function levelsFor100(bonus: number): number | null {
  const bp = 10_000 - Math.round(TARGET_BASE * 10_000) - Math.round(bonus * 10_000)
  if (bp <= 0) return 2
  const n = Math.ceil(bp / Math.round(TARGET_PER_LEVEL * 10_000))
  return n <= 400 ? Math.max(2, n) : null
}

function AccouplementSection({ rules }: { rules: Ruleset }) {
  const t100 = [
    { label: 'avec Optimakina', bonus: rules.optimakinaBonus },
    { label: 'avec Optimakina, jour Takeza', bonus: rules.optimakinaBonus + TAKEZA_BONUS },
    { label: 'jour Takeza, sans makina', bonus: TAKEZA_BONUS },
    { label: 'sans makina ni Takeza', bonus: 0 },
  ].map((t) => ({ ...t, n: levelsFor100(t.bonus), max: Math.min(1, TARGET_BASE + 400 * TARGET_PER_LEVEL + t.bonus) }))
  return (
    <Section id="accouplement" title="Fécondité, accouplement et génération cible" aside={<RulesBadge rules={rules} />}>
      <h3>Conditions</h3>
      <ul>
        <li>Deux montures <strong>fécondes</strong>, de sexes opposés et de la même famille, toutes deux dans l’étable.</li>
        <li>
          Naissance immédiate d’un bébé (deux si un parent est Reproducteur) ; les deux parents deviennent stériles. Le bébé est de niveau 1, de sexe
          aléatoire, et son arbre se compose de ses deux parents.
        </li>
        <li>
          Une makina au plus par accouplement, facultative, de la même famille et de génération <strong>supérieure ou égale à la génération cible</strong>.
        </li>
        <li>
          Chaque accouplement rapporte {rules.matingXpPerGeneration} XP d’Éleveur par génération de chaque parent, multipliés par le nombre de bébés.
        </li>
      </ul>

      <h3>La génération cible</h3>
      <p>
        Le jeu regarde toutes les naissances possibles du couple : les montures présentes dans les deux arbres (chaque parent et ses deux propres
        parents) et les croisements entre un membre d’un arbre et un membre de l’autre. La <strong>génération cible</strong> est la plus haute de ces
        issues. Elle reçoit à elle seule une part garantie :
      </p>
      <p className="guide-formula guide-formula-big">
        B = {formatPercent(TARGET_BASE, 0)} + {formatPercent(TARGET_PER_LEVEL, 2)} × (niveau A + niveau B) + Optimakina ({formatPercent(rules.optimakinaBonus, 0)}) +
        Takeza ({formatPercent(TAKEZA_BONUS, 0)}), plafonné à 100 %
      </p>
      <p>
        Si la cible est la seule issue possible, elle vaut 100 %. Le niveau compte donc vraiment : deux parents niveau 40 ajoutent{' '}
        {formatPercent(TARGET_PER_LEVEL * 80, 0)}, deux parents niveau 200 ajoutent {formatPercent(TARGET_PER_LEVEL * 400, 0)}.
      </p>

      <h3>Comment le reste se répartit</h3>
      <ol>
        <li>
          Dans chaque arbre, le parent pèse <strong>10</strong> et chacun de ses propres parents <strong>6</strong>, multipliés par le « poids
          génétique » de la couleur (donnée du client : 90 pour les monocolores Dragodinde et Muldo, 20 pour les bicolores, la Dragodinde Dorée et les
          Muldos G9, 1 pour tous les Volkornes). Les doublons s’additionnent.
        </li>
        <li>Chaque arbre est ramené à un total de 1 : un parent sans arbre compte autant qu’un parent avec arbre.</li>
        <li>
          Chaque membre garde sa part ; chaque paire (membre de A, membre de B) qui figure dans l’arbre des croisements ajoute le produit de leurs parts
          à l’enfant correspondant. On obtient la « part naturelle » de chaque issue.
        </li>
        <li>
          Les issues de la génération cible se partagent <strong>B</strong> au prorata de leur part naturelle ; toutes les autres se partagent{' '}
          <strong>1 − B</strong> de la même façon.
        </li>
      </ol>
      <p className="muted">
        Ce modèle a été reconstitué à partir de captures d’écran en jeu (la formule n’a jamais été publiée) ; il retrouve au centième les 24
        pourcentages de cinq interfaces d’accouplement <ConfidenceBadge level="high" />.
      </p>

      <h3>Exemple calculé en direct</h3>
      <BreedingExample rules={rules} />

      <h3>Seuils de 100 % ({rules.id})</h3>
      <Table head={['Situation', 'Niveaux cumulés des deux parents']}>
        {t100.map((t) => (
          <tr key={t.label}>
            <td>{t.label}</td>
            <td className="num">{t.n === null ? `impossible (au mieux ${formatPercent(t.max, 0)} à 200 + 200)` : `≥ ${t.n}`}</td>
          </tr>
        ))}
      </Table>

      <h3>Conseils</h3>
      <ul>
        <li>
          Montez les parents vers le niveau <strong>40</strong> pendant la fécondation (Mangeoire en 2e jauge) : +12 % par couple pour un coût en XP
          modeste. Réglage : <a href={href('reglages')}>niveau visé des parents</a>.
        </li>
        <li>
          Préférez des parents à <strong>arbre « propre »</strong> : si un arbre contient déjà la génération cible ou plus, le bonus est partagé avec
          ces montures et l’accouplement ne rapporte aucun généton.
        </li>
        <li>
          Ne tentez pas une génération avec un seul couple : à 40 % de réussite, une tentative isolée échoue 6 fois sur 10. Accumulez de quoi faire au
          moins trois essais.
        </li>
      </ul>
    </Section>
  )
}

// ---------- Section : Génétons ----------

function GenetonsSection({ rules }: { rules: Ruleset }) {
  const g = rules.genetonsByGeneration
  const examples: [number, number][] = [
    [5, 9],
    [8, 8],
    [9, 1],
    [9, 9],
  ]
  const zeroSpecies = SPECIES.filter((s) => s.breedable && s.generation >= 1 && s.generation <= 9 && (s.genetons[rules.id] ?? 0) === 0)
  const shop = GAME.genetonShop.filter(isRecord)
  const gv = PRICES_DEFAULT.genetons
  return (
    <Section id="genetons" title="Génétons" aside={<RulesBadge rules={rules} />}>
      <p>
        Les génétons récompensent les naissances « record » : il faut que le bébé obtenu soit d’une génération <strong>strictement supérieure à
        toutes les montures des deux arbres</strong> (les deux parents et leurs quatre propres parents). Si un arbre contient déjà cette génération,
        c’est 0 généton, même si le bébé est bien de la génération cible. Le montant est la somme des barèmes des deux parents, selon leur
        génération :
      </p>
      <Table head={['Règles', ...Array.from({ length: 10 }, (_, i) => `G${i + 1}`)]}>
        {RULESET_IDS.map((id) => (
          <tr key={id} className={id === rules.id ? 'guide-active-row' : undefined}>
            <td>
              {id}
              {id === rules.id && ' (actives)'}
            </td>
            {Array.from({ length: 10 }, (_, i) => (
              <td key={i} className="num">
                {RULESETS[id].genetonsByGeneration[i + 1]}
              </td>
            ))}
          </tr>
        ))}
      </Table>
      <p>Exemples en {rules.id}, pour une naissance record :</p>
      <ul className="guide-inline-list">
        {examples.map(([x, y]) => (
          <li key={`${x}-${y}`}>
            parents G{x} + G{y} → <strong>{g[x] + g[y]}</strong> génétons
          </li>
        ))}
      </ul>
      {zeroSpecies.length > 0 && (
        <Callout tone="warn">
          Exception des données du client : {zeroSpecies.map((s) => s.name).join(' et ')} rapportent 0 généton comme parents (probable erreur de
          données, effet en jeu non confirmé <ConfidenceBadge level="low" />).
        </Callout>
      )}
      <h3>À quoi ils servent</h3>
      <p>
        Les génétons s’échangent chez <strong>Eugène Éton</strong> [−18,1], au Village des Éleveurs. Barème relevé sur une capture de la bêta 3.5 (seul
        le prix du Puissant Parchemin a été reconfirmé depuis) <ConfidenceBadge level="medium" /> :
      </p>
      <Table head={['Objet', 'Coût (génétons)', 'Échangeable']}>
        {shop.map((it, i) => (
          <tr key={i}>
            <td>{typeof it.item === 'string' ? it.item : '—'}</td>
            <td className="num">{typeof it.cost === 'number' ? it.cost : '—'}</td>
            <td>{it.exchangeable === true ? 'oui' : it.exchangeable === false ? 'non' : '—'}</td>
          </tr>
        ))}
      </Table>
      <p>
        Valeur par défaut d’un généton dans les calculs : <strong>{formatKamas(gv.kamasPerGeneton)}</strong> (plage {formatKamas(gv.range[0])} à{' '}
        {formatKamas(gv.range[1])}) <ConfidenceBadge level={gv.confidence} />, à ajuster selon votre serveur dans la page{' '}
        <a href={href('prix')}>Prix</a>. Les génétons sont liés au compte selon DPLN et le devblog, mais DofusDB les marque échangeables : à vérifier
        en jeu.
      </p>
    </Section>
  )
}

// ---------- Section : Clonage, extraction, brisage ----------

function ClonageSection({ rules }: { rules: Ruleset }) {
  const brisage = isRecord(PRICES_DEFAULT.valuation.brisage) ? PRICES_DEFAULT.valuation.brisage : null
  const byLevel = brisage && isRecord(brisage.defaultValuePerMountByLevel) ? brisage.defaultValuePerMountByLevel : null
  const brisageRows = byLevel
    ? Object.entries(byLevel)
        .filter((e): e is [string, Record<string, unknown>] => isRecord(e[1]))
        .map(([fam, levels]) => ({ fam, levels: Object.entries(levels).filter((l): l is [string, number] => typeof l[1] === 'number') }))
    : []
  const brisageLevels = [...new Set(brisageRows.flatMap((r) => r.levels.map(([l]) => l)))].sort((x, y) => Number(x) - Number(y))
  return (
    <Section id="clonage" title="Clonage, extraction et brisage" aside={<RulesBadge rules={rules} />}>
      <h3>Clonage</h3>
      <ul>
        <li>
          On donne <strong>deux montures de la même famille et de la même génération</strong> (couleurs différentes acceptées), stériles, fertiles ou
          fécondes, mais pas séniles.
        </li>
        <li>
          On récupère <strong>l’une des deux, au hasard (50/50)</strong>, redevenue fertile : elle garde sa couleur, son sexe, son nom et sa généalogie ;
          ses jauges repartent de 0 et elle perd sa capacité.
        </li>
        <li>
          Sérénité du clone : {rules.cloneKeepsSerenity ? 'conservée (3.7).' : 'réinitialisée en 3.5/3.6 (conservée à partir de la 3.7).'} Niveau
          conservé ou non : inconnu <ConfidenceBadge level="low" />.
        </li>
      </ul>
      <p>
        <strong>Pourquoi c’est indispensable :</strong> un accouplement consomme deux montures fertiles et ne rend qu’un bébé. Cloner les deux stériles
        rend une fertile de plus : sans clonage, chaque génération demande des dizaines de fois plus de captures (la simulation de la recherche
        trouve ×80 à ×90 dès la G7). Clonez juste après les accouplements, deux stériles de même couleur d’abord, puis une couleur utile avec une
        inutile ; jamais deux inutiles.
      </p>

      <h3>Extraction</h3>
      <p>
        L’extraction <strong>détruit la monture</strong> et donne autant de ressources que sa génération (une G1 ne donne rien, une G10 en donne 10 ;
        une sénile en donne 1). Ces ressources servent aux recettes de l’Amateur de Guildaton et se revendent à l’HDV.
      </p>
      <Table head={['Famille', 'Ressource', 'Prix par défaut', 'Exemple : une G5']}>
        {FAMILY_IDS.map((f) => {
          const info = FAMILIES[f]
          const p = defaultItemPrice(info.extractionItemId)
          return (
            <tr key={f}>
              <td>{info.plural}</td>
              <td>{info.extractionItemName}</td>
              <td>
                {typeof p?.price === 'number' ? (
                  <>
                    {formatKamas(p.price)} <ConfidenceBadge level={p.confidence} />
                  </>
                ) : (
                  <a href={href('prix', { q: info.extractionItemName })}>à saisir</a>
                )}
              </td>
              <td>5 ressources{typeof p?.price === 'number' ? ` ≈ ${formatKamas(5 * p.price)} brut` : ''}</td>
            </tr>
          )
        })}
      </Table>

      <h3>Brisage</h3>
      <p>
        Depuis la 3.5, une monture est un équipement de niveau 60 : on peut la briser en runes de forgemagie (coefficient de 50 %). Les Muldos
        donnent surtout des runes de PM, les Volkornes des runes de PA, à partir d’un niveau ≈ 40 à 55. Aucune formule ne colle à tous les relevés :
        l’application utilise des <strong>rendements observés</strong> par des joueurs.
      </p>
      {brisageRows.length > 0 && (
        <Table head={['Famille', ...brisageLevels.map((l) => `niv. ${l}`)]}>
          {brisageRows.map((r) => (
            <tr key={r.fam}>
              <td>{r.fam}</td>
              {brisageLevels.map((l) => {
                const v = r.levels.find(([x]) => x === l)
                return (
                  <td key={l} className="num">
                    {v ? formatKamas(v[1]) : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </Table>
      )}
      <Callout tone="warn">
        Valeurs par monture <ConfidenceBadge level="low" /> issues de quelques vidéos (surtout sur Salar), et un correctif reste possible : en 2025,
        Ankama avait écrit que le brisage des montures ne serait pas possible.
      </Callout>

      <h3>Que faire d’une monture ?</h3>
      <p>Grille de décision retenue par l’application, à appliquer dans l’ordre :</p>
      <ol>
        {[...STRATEGY.mountFateGrid]
          .sort((x, y) => x.order - y.order)
          .map((row) => (
            <li key={row.order}>
              <strong>{row.label}</strong> — {row.if.charAt(0).toLowerCase() + row.if.slice(1)}.
            </li>
          ))}
      </ol>
      <p className="muted">
        La page <a href={href('montures')}>Mes montures</a> applique cette grille à votre étable avec vos prix.
      </p>
    </Section>
  )
}

// ---------- Section : Captures ----------

/** Zone principale des Dragodindes selon la recherche (strategy.md §2.1 : DofusDB + DPLN, confiance haute). */
const DRAGODINDE_MAIN_ZONE = {
  subarea: 'Territoire des dragodindes sauvages',
  area: 'Montagne des Koalaks',
  x: [-23, -11] as [number, number],
  y: [-2, 9] as [number, number],
  zaap: 'Village des Éleveurs',
  zaapCoords: [-16, 1] as [number, number],
  note: 'anneau autour du Village des Éleveurs ; seule zone où apparaît la Dorée ; archimonstres Draglida la Disparue et Dragnoute l’Irascible (capturables ou non : inconnu)',
}

const FAMILY_DANGERS: Record<FamilyId, string> = {
  dragodinde: 'désenvoûtent et frappent fort (≈ 120 dégâts) : ne comptez pas sur vos buffs.',
  muldo: 'réduisent vos dommages finaux de 10 % et retirent 2 PA au corps à corps.',
  volkorne: 'attirent de loin (7 cases), repoussent, retirent PA et PM, posent l’état Pesanteur dès le 2e tour et volent de la vie.',
}

const coords = (c: [number, number]) => `[${c[0]},${c[1]}]`
const range = (r: [number, number]) => `${r[0]} → ${r[1]}`

const NET_KIND_LABELS: Record<string, { title: string; effect: string }> = {
  universel: { title: 'Filet de capture universel', effect: 'une monture ciblée, toutes familles' },
  multiplicateur: { title: 'Filet multiplicateur', effect: 'une monture ciblée, capturée en double (sexe du double non garanti)' },
  renforce: { title: 'Filet renforcé', effect: 'toutes les montures dans un cercle de rayon 3' },
  multiplicateur_renforce: { title: 'Filet multiplicateur renforcé', effect: 'zone de rayon 3 et chaque monture en double' },
}

function CapturesSection({ jobLevel }: { jobLevel: number }) {
  const netKinds = Object.keys(NET_KIND_LABELS).map((kind) => {
    const list = NETS.filter((n) => n.kind === kind)
    return { kind, level: Math.min(...list.map((n) => n.level)), names: list.map((n) => n.name) }
  })
  const tips = ['C-SUCCESS-01', 'C-SEX-01', 'C-MIX-01', 'C-TEAM-01', 'C-AOE-01', 'C-DROP-01', 'C-MULTI-01']
    .map((id) => STRATEGY.captureRules.find((r) => r.id === id))
    .filter((r): r is StrategyRule => r !== undefined)
  return (
    <Section id="captures" title="Captures">
      <p>
        Toutes les montures commencent par une capture de G1. Les montures sauvages sont des monstres de niveau{' '}
        {FAMILIES.muldo.captureZone ? range(FAMILIES.muldo.captureZone.levels) : '62 → 70'} : un seul personnage de bon niveau suffit.
      </p>
      <div className="grid grid-3">
        {FAMILY_IDS.map((f) => {
          const info = FAMILIES[f]
          const z = info.captureZone
          const g1 = SPECIES.filter((s) => s.family === f && s.capturable)
          const useResearch = f === 'dragodinde' && z?.subarea !== DRAGODINDE_MAIN_ZONE.subarea
          return (
            <div key={f} className="guide-zone">
              <h4>{info.plural}</h4>
              {useResearch ? (
                <>
                  <p>
                    <strong>{DRAGODINDE_MAIN_ZONE.subarea}</strong> ({DRAGODINDE_MAIN_ZONE.area}) <ConfidenceBadge level="high" />
                    <br />x {range(DRAGODINDE_MAIN_ZONE.x)}, y {range(DRAGODINDE_MAIN_ZONE.y)}
                    <br />
                    Zaap : {DRAGODINDE_MAIN_ZONE.zaap} {coords(DRAGODINDE_MAIN_ZONE.zaapCoords)}
                  </p>
                  <p className="muted">{DRAGODINDE_MAIN_ZONE.note}.</p>
                  {z && (
                    <p className="muted">
                      DofusDB rattache aussi l’Amande et la Rousse à la {z.subarea} ({z.area}, x {range(z.xRange)}, y {range(z.yRange)}, zaap{' '}
                      {coords(z.nearestZaap.coords)}) : probable reste de l’ancien système <ConfidenceBadge level="low" />.
                    </p>
                  )}
                </>
              ) : z ? (
                <>
                  <p>
                    <strong>{z.subarea}</strong> ({z.area})
                    <br />x {range(z.xRange)}, y {range(z.yRange)}
                    <br />
                    Zaap : {z.nearestZaap.name} {coords(z.nearestZaap.coords)}
                  </p>
                  {f === 'muldo' && (
                    <p className="muted">
                      Accès : barque du Territoire des Bandits [15,19] puis corde, échelle face au sous-marin de Sufokia [22,19], ou scaphandre de
                      l’atelier des éleveurs de Sufokia [19,23].
                    </p>
                  )}
                </>
              ) : (
                <p className="muted">Zone non renseignée.</p>
              )}
              <p>
                <strong>G1 :</strong> {g1.map((s) => s.name.replace(`${info.label} `, '')).join(', ')}
              </p>
              <p className="muted">Attention, elles {FAMILY_DANGERS[f]}</p>
            </div>
          )
        })}
      </div>

      <h3>Le sort de capture</h3>
      <p>
        Équiper un filet dans l’emplacement de consommable donne le sort « Apprivoisement de monture » : 1 PA, 7 cases de portée, sans ligne de vue,{' '}
        <strong>une fois par combat et par personnage</strong>. Le filet est consommé au lancer ; la capture est garantie si le combat est gagné (et
        perdue sinon). Marquez vos cibles dès le premier tour. En groupe, chaque personnage lance son propre filet.
      </p>
      <Table head={['Filet', 'Niveau d’Éleveur pour l’équiper', 'Effet', 'Pour vous']}>
        {netKinds.map((n) => (
          <tr key={n.kind}>
            <td>
              <strong>{NET_KIND_LABELS[n.kind].title}</strong>
              {n.names.some((name) => name !== NET_KIND_LABELS[n.kind].title) && (
                <>
                  <br />
                  <small>{n.names.join(', ')}</small>
                </>
              )}
            </td>
            <td className="num">{n.level}</td>
            <td>{NET_KIND_LABELS[n.kind].effect}</td>
            <td>{jobLevel >= n.level ? <Badge tone="ok">équipable</Badge> : <Badge>niv. {n.level}</Badge>}</td>
          </tr>
        ))}
      </Table>
      <p>
        Chaque monture capturée rapporte <strong>{JOB_XP_PER_CAPTURE} XP d’Éleveur</strong> (que le double d’un filet multiplicateur compte aussi n’est
        pas confirmé <ConfidenceBadge level="medium" />). Les montures sauvages droppent leurs ressources comme n’importe quel monstre : la prospection
        compte, et ces ressources alimentent filets et makinas.
      </p>
      <h3>Bonnes pratiques</h3>
      <ul>
        {tips.map((r) => (
          <li key={r.id}>
            <strong>{r.title}</strong> — {r.then}
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ---------- Section : Métier ----------

function MetierSection({ rules, jobLevel }: { rules: Ruleset; jobLevel: number }) {
  const milestones = useMemo(() => {
    const out: { level: number; kind: string; what: string }[] = []
    PADDOCK_UNLOCK_LEVELS.forEach((p, i) => out.push({ level: p.level, kind: 'Enclos', what: `${i === 0 ? '1er' : `${i + 1}e`} enclos : ${p.name} ${p.coords}` }))
    for (const t of TIERS)
      out.push({
        level: FUEL_TIER_UNLOCK_LEVEL[t],
        kind: 'Carburants',
        what: `${FUEL_TIER_NAMES[t]}s (palier ${t}) : Minuscule, puis une taille de plus tous les 10 niveaux jusqu’à Gigantesque (niv. ${FUEL_TIER_UNLOCK_LEVEL[t] + 40})`,
      })
    for (const kind of Object.keys(NET_KIND_LABELS)) {
      const list = NETS.filter((n) => n.kind === kind)
      if (list.length) out.push({ level: Math.min(...list.map((n) => n.level)), kind: 'Filets', what: NET_KIND_LABELS[kind].title })
    }
    for (let g = 2; g <= 10; g++) {
      const lv = MAKINAS.filter((m) => m.generation === g).map((m) => m.level)
      if (lv.length) out.push({ level: Math.min(...lv), kind: 'Makinas', what: `Makinas G${g} (niv. ${Math.min(...lv)} à ${Math.max(...lv)} selon la famille et le type)` })
    }
    return out.sort((a, b) => a.level - b.level || a.kind.localeCompare(b.kind))
  }, [])
  const fuelCount = FUELS.length
  return (
    <Section id="metier" title="Métier Éleveur" aside={<RulesBadge rules={rules} />}>
      <p>
        Le niveau d’Éleveur débloque les enclos, les recettes ({fuelCount} carburants, {MAKINAS.length} makinas, {NETS.length} filets) et le droit
        d’équiper les meilleurs filets. Objectif minimal conseillé : <strong>niveau 120</strong>, soit 4 enclos. Votre niveau actuel (réglages) :{' '}
        <strong>{jobLevel}</strong>.
      </p>
      <Table head={['Niveau', 'Type', 'Déblocage', '']}>
        {milestones.map((m, i) => (
          <tr key={i} className={jobLevel >= m.level ? 'guide-done-row' : undefined}>
            <td className="num">{m.level}</td>
            <td>{m.kind}</td>
            <td>{m.what}</td>
            <td>{jobLevel >= m.level ? <Badge tone="ok">atteint</Badge> : null}</td>
          </tr>
        ))}
      </Table>
      <h3>Gagner de l’XP</h3>
      <ul>
        <li>
          <strong>Crafts</strong> : une recette de niveau L fabriquée au niveau L rapporte L XP (10 pour le filet universel au niveau 1) ; le gain baisse
          vite quand votre niveau dépasse celui de la recette (≈ 47 % à 9 niveaux d’écart) et tombe à 0 au-delà de 100 niveaux d’écart. C’est la voie
          principale vers 120 puis 200.
        </li>
        <li>
          <strong>Accouplements</strong> : {rules.matingXpPerGeneration} XP par génération et par parent, ×2 avec Reproducteur (deux G5 = {k(rules.matingXpPerGeneration * 10)}{' '}
          XP).
        </li>
        <li>
          <strong>Captures</strong> : {JOB_XP_PER_CAPTURE} XP par monture.
        </li>
      </ul>
      <Table head={['Niveau', 'XP cumulée', 'Depuis le palier précédent']}>
        {PADDOCK_UNLOCK_LEVELS.filter((p) => p.level > 1).map((p, i, arr) => {
          const prev = i === 0 ? 1 : arr[i - 1].level
          return (
            <tr key={p.level}>
              <td className="num">{p.level}</td>
              <td className="num">{k(jobXpForLevel(p.level))}</td>
              <td className="num">+{k(jobXpForLevel(p.level) - jobXpForLevel(prev))}</td>
            </tr>
          )
        })}
      </Table>
      <p className="muted">
        La page <a href={href('metier')}>Métier Éleveur</a> calcule le plan de montée le moins cher avec vos prix et votre niveau.
      </p>
    </Section>
  )
}

// ---------- Section : Almanax ----------

function AlmanaxSection() {
  const [now] = useState(() => Date.now())
  const upcoming = useMemo(() => upcomingAlmanax(now, 120), [now])
  const today = isoDay(now)
  const otherDays = GAME.almanaxCalendar.filter((d) => d.date >= today && !almanaxOn(d.date)).slice(0, 6)
  return (
    <Section id="almanax" title="Almanax">
      <p>
        Le 10 de chaque mois, l’Almanax donne un bonus d’élevage, et un jour d’octobre (date variable) est le jour <strong>Takeza</strong> : +20 % de
        génération cible pour tous les accouplements. Préparez vos couples féconds la veille.
      </p>
      <h3>Prochains bonus d’élevage</h3>
      {upcoming.length === 0 ? (
        <p className="muted">Aucun bonus d’élevage dans les 120 prochains jours.</p>
      ) : (
        <ul className="guide-almanax">
          {upcoming.map((e) => (
            <li key={e.date} className={e.takeza ? 'takeza' : undefined}>
              <span className="guide-almanax-date">
                {dayFormat.format(isoToDate(e.date))}
                <small>{inDays(daysUntil(e.date, now))}</small>
              </span>
              <span>
                <strong>{e.name}</strong> — {e.effect}
                {e.doubledGauge && (
                  <>
                    {' '}
                    <GaugeChip gauge={e.doubledGauge} />
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h3>Calendrier annuel</h3>
      <Table head={['Date', 'Méryde', 'Effet']}>
        {GAME.almanaxBreedingBonuses.map((b) => (
          <tr key={`${b.date}-${b.meryde ?? ''}`} className={b.meryde === 'Takeza' ? 'guide-active-row' : undefined}>
            <td>{b.date.startsWith('variable') ? `octobre, ${b.date}` : `${b.date} (${b.month.toLowerCase()})`}</td>
            <td>{b.meryde ?? '—'}</td>
            <td>{b.effect}</td>
          </tr>
        ))}
      </Table>
      <p className="muted">
        « Effet doublé » est compté comme un gain ×2 pour les montures, consommation inchangée : hypothèse non vérifiée <ConfidenceBadge level="low" />.
        Les bébés nés un jour « capacité » reçoivent cette capacité.
      </p>
      {otherDays.length > 0 && (
        <>
          <h3>Autres jours utiles (métier, captures)</h3>
          <ul>
            {otherDays.map((d) => (
              <li key={d.date}>
                <strong>{dayFormat.format(isoToDate(d.date))}</strong> — {d.name} : {d.effect}
                {d.use && <span className="muted"> ({d.use})</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  )
}

// ---------- Section : Erreurs fréquentes ----------

const RULE_BY_ID = new Map<string, StrategyRule>([...STRATEGY.paddockRules, ...STRATEGY.matingRules, ...STRATEGY.captureRules].map((r) => [r.id, r]))
const RULE_ID_RE = /\b[A-Z]-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g

/** Correctifs trop elliptiques dans les données : reformulés en renvoyant à la bonne section du guide. */
const FIX_OVERRIDES: Record<string, string> = {
  X03: 'Appliquer la procédure de la zone de sérénité du lot (voir « Sérénité et procédure selon la zone »).',
  X08: 'Passer chaque monture par la grille « Que faire d’une monture ? » (section Clonage) avant de la vendre ou de l’extraire.',
}

/** Correctif lisible : les identifiants de règles (« E-FULL-01 ») sont remplacés par leur contenu. */
function fixText(fix: string): string {
  const ids = (fix.match(RULE_ID_RE) ?? []).filter((id) => RULE_BY_ID.has(id))
  if (ids.length === 0) return fix
  const rest = fix.replace(RULE_ID_RE, '').replace(/[\s/()+,;]/g, '')
  if (rest === '') return ids.map((id) => RULE_BY_ID.get(id)?.then ?? id).join(' ')
  return fix.replace(RULE_ID_RE, (id) => (RULE_BY_ID.has(id) ? `« ${RULE_BY_ID.get(id)?.title} »` : id))
}

function ErreursSection() {
  return (
    <Section id="erreurs" title="Erreurs fréquentes">
      <p>Les pièges relevés dans les guides, vidéos et outils de la communauté, et comment les éviter :</p>
      <div className="guide-mistakes">
        {STRATEGY.commonMistakes.map((m) => (
          <div key={m.id} className="guide-mistake">
            <strong>{m.mistake}</strong>
            <span className="guide-mistake-cons">→ {m.consequence}</span>
            <span className="guide-mistake-fix">✓ {FIX_OVERRIDES[m.id] ?? fixText(m.fix)}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ---------- Section : 3.7 ----------

function V37Section({ rules }: { rules: Ruleset }) {
  const a = RULESETS['3.6']
  const b = RULESETS['3.7']
  const kk = (r: Ruleset) => TIERS.map((t) => `${k(r.gaugeTierMax[t] / 1000)}k`).join(' / ')
  const rows: [string, ReactNode, ReactNode][] = [
    ['Paliers de jauge (bornes hautes)', kk(a), kk(b)],
    ['Vidage complet d’une jauge', formatDuration(gaugeDrainSeconds(a.gaugeTierMax[4], 0, a)), formatDuration(gaugeDrainSeconds(b.gaugeTierMax[4], 0, b))],
    ['Points par carburant (Minuscule → Gigantesque)', `${k(1000 * a.fuelDurabilityFactor)} → ${k(5000 * a.fuelDurabilityFactor)}`, `${k(1000 * b.fuelDurabilityFactor)} → ${k(5000 * b.fuelDurabilityFactor)}`],
    ['Optimakina', `+${formatPercent(a.optimakinaBonus, 0)}`, `+${formatPercent(b.optimakinaBonus, 0)}`],
    ['Génétons d’un parent G1 / G8 / G9', `${a.genetonsByGeneration[1]} / ${a.genetonsByGeneration[8]} / ${a.genetonsByGeneration[9]}`, `${b.genetonsByGeneration[1]} / ${b.genetonsByGeneration[8]} / ${b.genetonsByGeneration[9]}`],
    ['Animakina', 'capacité aléatoire', 'choix du sexe du bébé'],
    ['Capacité sans makina', 'non', 'oui (3 à 8 % selon la capacité, devblog)'],
    ['Étable', `${a.stableSlots} places`, `${b.stableSlots} places`],
    ['Sérénité après clonage', a.cloneKeepsSerenity ? 'conservée' : 'réinitialisée', b.cloneKeepsSerenity ? 'conservée' : 'réinitialisée'],
  ]
  const changes = strings(GAME.changes37.changes)
  const before = strings((GAME.changes37 as unknown as Record<string, unknown>).strategyBefore37)
  return (
    <Section id="v37" title="Version 3.7 (bêta)" aside={<Badge tone="warn">bêta</Badge>}>
      <Callout tone="warn">
        Statut : {GAME.changes37.status}. Les valeurs ci-dessous viennent du client bêta {GAME.betaClientVersion} et du devblog du 16/09/2026 ; elles
        peuvent encore changer.
      </Callout>
      <Table head={['', 'Live (3.6)', 'Bêta (3.7)']}>
        {rows.map(([label, x, y]) => (
          <tr key={label}>
            <td>{label}</td>
            <td>{x}</td>
            <td>
              <strong>{y}</strong>
            </td>
          </tr>
        ))}
      </Table>
      <p>
        À retenir : la consommation par tick ne change pas, donc chaque palier dure deux fois plus longtemps, et un carburant contient deux fois plus de
        points (le coût au point dépendra des nouvelles recettes et des prix). Le seuil de 100 % de génération cible avec Optimakina descend à{' '}
        {levelsFor100(b.optimakinaBonus)} niveaux cumulés.
      </p>
      {changes.length > 0 && (
        <>
          <h3>Liste des changements annoncés</h3>
          <ul>
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}
      {before.length > 0 && (
        <>
          <h3>En attendant la sortie</h3>
          <ul>
            {before.map((c) => (
              <li key={c}>{c.charAt(0).toUpperCase() + c.slice(1)}.</li>
            ))}
          </ul>
        </>
      )}
      <p className="muted">
        {rules.id === '3.7' ? (
          <>
            L’application utilise actuellement les règles 3.7. <a href={href('reglages')}>Revenir aux règles live</a>
          </>
        ) : (
          <>
            Pour simuler avec ces valeurs, choisissez les règles 3.7 dans les <a href={href('reglages')}>Réglages</a>.
          </>
        )}
      </p>
    </Section>
  )
}

// ---------- Section : Fiabilité ----------

function FiabiliteSection() {
  const priced = (ids: number[]) => ids.filter((id) => typeof defaultItemPrice(id)?.price === 'number').length
  const coverage = [
    { label: 'Ingrédients', n: priced(INGREDIENTS.map((i) => i.id)), total: INGREDIENTS.length },
    { label: 'Carburants', n: priced(FUELS.map((f) => f.id)), total: FUELS.length },
    { label: 'Makinas', n: priced(MAKINAS.map((m) => m.id)), total: MAKINAS.length },
    { label: 'Filets', n: priced(NETS.map((n) => n.id)), total: NETS.length },
  ]
  return (
    <Section id="fiabilite" title="Fiabilité et questions ouvertes">
      <p>Chaque valeur de l’application porte un niveau de confiance, affiché par un badge :</p>
      <ul className="guide-legend">
        <li>
          <ConfidenceBadge level="high" /> donnée du client officiel, devblog Ankama, ou valeur retrouvée exactement sur une capture d’écran en jeu.
        </li>
        <li>
          <ConfidenceBadge level="medium" /> source communautaire sérieuse (guide DPLN, outils reconnus) ou déduction cohérente.
        </li>
        <li>
          <ConfidenceBadge level="low" /> hypothèse, témoignage isolé ou extrapolation : à prendre comme un ordre de grandeur.
        </li>
      </ul>

      <h3>Ce qui est solide</h3>
      <p>
        Les jauges, paliers, durabilités, croisements, poids génétiques, génétons et XP viennent des tables du client (versions {GAME.liveClientVersion} et
        bêta {GAME.betaClientVersion}), vérifiées sur huit versions successives. Le modèle de naissance, reconstitué faute de formule officielle,
        reproduit au centième les pourcentages de cinq interfaces d’accouplement capturées en jeu.
      </p>

      <h3>Ce que vous devez compléter : les prix</h3>
      <p>
        Il n’existe aucune source publique de prix d’HDV : les prix par défaut sont des relevés ponctuels (surtout Salar, entre mars et septembre 2026)
        ou des estimations. Couverture des prix par défaut :
      </p>
      <ul className="guide-inline-list">
        {coverage.map((c) => (
          <li key={c.label}>
            {c.label} : <strong>{c.n}</strong>/{c.total}
          </li>
        ))}
      </ul>
      <p>
        Quand un prix manque, l’application calcule le coût depuis les ingrédients ; si un ingrédient manque aussi, elle affiche « coût incomplet » au
        lieu de compter 0. Saisissez vos prix de serveur dans la page <a href={href('prix')}>Prix</a> : c’est ce qui rend les calculs de rentabilité
        fiables.
      </p>

      <h3>Ce qui reste incertain dans les règles</h3>
      <ul>
        <li>
          <strong>Naissances</strong> : le poids d’un croisement dont l’enfant est monocolore n’a pas pu être testé (supposé identique) ; on ignore si
          la cible peut dépasser B quand sa part naturelle est déjà plus grande ; avec Reproducteur, on suppose deux tirages indépendants.
        </li>
        <li>
          <strong>Hasard</strong> : sexe des bébés et des captures supposé 50/50 ; sérénité de départ supposée uniforme entre −5 000 et 5 000 ;
          fréquence de chaque couleur sauvage inconnue. Notez vos captures dans le journal pour affiner.
        </li>
        <li>
          <strong>Enclos</strong> : ordre des effets dans un tick quand une jauge de sérénité et une jauge de statistique sont actives ensemble ; sort
          exact du surplus d’un carburant (perdu ou refusé) ; effet réel des jours Almanax « doublés » et cumul avec une capacité.
        </li>
        <li>
          <strong>Clonage</strong> : le niveau est-il conservé ? (cela change l’intérêt de monter des « étalons »).
        </li>
        <li>
          <strong>Versions</strong> : date de sortie de la 3.7 inconnue et valeurs bêta modifiables ; génétons liés au compte ou échangeables ; 0
          généton pour deux Volkornes G6 (probable bug) ; boutique d’Eugène Éton relevée sur la bêta 3.5.
        </li>
        <li>
          <strong>XP</strong> : la formule d’XP de craft vient de Dofus 2 (validée sur trois valeurs en jeu) ; la table d’XP des montures vient de DPLN
          (absente du client) ; l’XP du double d’un filet multiplicateur n’est pas confirmée.
        </li>
        <li>
          <strong>Brisage</strong> : toléré aujourd’hui mais annoncé impossible par Ankama en 2025 ; rendements estimés sur peu de relevés.
        </li>
        <li>
          <strong>Noms</strong> : « Reproducteur » ou « Reproductrice », « Caméléone » ou « Caméléon » selon les sources ; l’application affiche
          Reproducteur et Caméléone.
        </li>
      </ul>
      <p className="muted">
        Détail complet, sources et arbitrages : dossier de recherche du projet (<code>research/README.md</code>, §4 « Lacunes connues »).
      </p>
    </Section>
  )
}

// ---------- Section : Sources ----------

interface SourceLink {
  title: string
  url: string
  note?: string
}

const OFFICIAL: SourceLink[] = [
  { title: 'Devblog élevage, partie I (27/02/2025)', url: 'https://www.dofus.com/fr/mmorpg/actualites/devblog/billets/1761570-devblog-elevage-monture', note: 'pistes en partie abandonnées' },
  { title: 'Devblog élevage, partie II (28/04/2025)', url: 'https://www.dofus.com/fr/mmorpg/actualites/devblog/billets/1762596-devblog-elevage-monture-partie-ii', note: 'base du système 3.5' },
  { title: 'Devblog 3.7 : confort, lisibilité, ajustements (16/09/2026)', url: 'https://www.dofus.com/fr/mmorpg/actualites/devblog/billets/1771790-maj-3-7-confort-jeu-lisibilite-ajustements' },
  { title: 'Mise à jour 3.5 en ligne', url: 'https://www.dofus.com/fr/mmorpg/actualites/news/1767665-maj-3-5-ligne' },
  { title: 'Mise à jour 3.6 en ligne', url: 'https://www.dofus.com/fr/mmorpg/actualites/news/1770358-maj-3-6-raid-not-dead-maintenant-ligne' },
]

const DPLN: SourceLink[] = [
  { title: 'Guide de l’éleveur (édition 2026)', url: DPLN_GUIDE, note: 'la référence de la communauté' },
  { title: 'Les Dragodindes', url: 'https://www.dofuspourlesnoobs.com/les-dragodindes.html' },
  { title: 'Les Muldos', url: 'https://www.dofuspourlesnoobs.com/les-muldos.html' },
  { title: 'Les Volkornes', url: 'https://www.dofuspourlesnoobs.com/les-volkornes.html' },
  { title: 'Gestion d’enclos (outil)', url: 'https://www.dofuspourlesnoobs.com/gestion-d-enclos.html' },
  { title: 'Tableaux d’expérience', url: 'https://www.dofuspourlesnoobs.com/tableaux-dexpeacuterience.html' },
  { title: 'Mise à jour 3.5', url: 'https://www.dofuspourlesnoobs.com/mise-a-jour-305.html' },
  { title: 'Mise à jour 3.6', url: 'https://www.dofuspourlesnoobs.com/mise-a-jour-306.html' },
]

const DATA_SOURCES: SourceLink[] = [
  { title: 'DofusDB', url: 'https://dofusdb.fr', note: 'objets, recettes, monstres, zones, Almanax' },
  { title: 'API DofusDB', url: 'https://api.dofusdb.fr' },
  { title: 'Index du client Dofus (CDN Ankama)', url: 'https://cytrus.cdn.ankama.com/cytrus.json', note: 'tables du client 3.6 et 3.7 bêta' },
]

function SourceList({ items }: { items: SourceLink[] }) {
  return (
    <ul className="guide-sources">
      {items.map((s) => (
        <li key={s.url}>
          <a href={s.url} target="_blank" rel="noopener noreferrer">
            {s.title}
          </a>
          {s.note && <span className="muted"> — {s.note}</span>}
        </li>
      ))}
    </ul>
  )
}

function strategySources(types: string[]): SourceLink[] {
  const known = new Set([...OFFICIAL, ...DPLN, ...DATA_SOURCES].map((s) => s.url))
  const out: SourceLink[] = []
  for (const s of STRATEGY.sources) {
    if (!isRecord(s) || typeof s.url !== 'string' || typeof s.title !== 'string' || typeof s.type !== 'string') continue
    if (!types.includes(s.type) || known.has(s.url) || !s.url.startsWith('https://')) continue
    known.add(s.url)
    out.push({ title: s.title, url: s.url, note: typeof s.date === 'string' ? s.date : undefined })
  }
  return out
}

function SourcesSection() {
  const tools = strategySources(['tool', 'guide'])
  const videos = strategySources(['video'])
  return (
    <Section id="sources" title="Sources">
      <p>
        Ce guide est rédigé pour ElevageSimu à partir des sources ci-dessous, recoupées et chiffrées par l’application. Pour une explication complète
        et illustrée, lisez le{' '}
        <a href={DPLN_GUIDE} target="_blank" rel="noopener noreferrer">
          guide de l’éleveur de Dofus pour les Noobs
        </a>
        .
      </p>
      <div className="grid grid-2">
        <div>
          <h3>Ankama (officiel)</h3>
          <SourceList items={OFFICIAL} />
          <h3>Dofus pour les Noobs</h3>
          <SourceList items={DPLN} />
          <h3>Données du jeu</h3>
          <SourceList items={DATA_SOURCES} />
        </div>
        <div>
          <h3>Outils et guides de la communauté</h3>
          <SourceList items={tools} />
          {videos.length > 0 && (
            <>
              <h3>Vidéos</h3>
              <SourceList items={videos} />
            </>
          )}
        </div>
      </div>
      <Callout>
        <strong>ElevageSimu est un outil non officiel</strong>, sans lien avec Ankama. Dofus est une marque d’Ankama Games. Les règles peuvent changer à
        chaque mise à jour : en cas de doute, le jeu fait foi.
      </Callout>
    </Section>
  )
}

// ---------- Page ----------

export default function GuidePage() {
  const rules = useRules()
  const jobLevel = useSettings((s) => s.jobLevel)
  const route = useRoute()
  const target = route.params.get('s')
  const [active, setActive] = useState<string>(SECTIONS[0].id)

  // Défilement vers la section demandée (#/guide?s=genetons).
  useEffect(() => {
    if (!target) return
    const el = document.getElementById(sectionDomId(target))
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [target])

  // Section visible (surlignée dans le sommaire).
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id.replace(/^guide-/, ''))
      },
      { rootMargin: '-15% 0px -70% 0px' },
    )
    for (const s of SECTIONS) {
      const el = document.getElementById(sectionDomId(s.id))
      if (el) obs.observe(el)
    }
    return () => obs.disconnect()
  }, [])

  const go = (id: string) => (e: MouseEvent) => {
    // Le lien met à jour l'adresse (partageable) ; on force le défilement même si l'adresse ne change pas.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    document.getElementById(sectionDomId(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="guide-page">
      <PageHeader
        title="Guide & règles"
        subtitle="Les mécaniques de l’élevage 3.5+ expliquées simplement, avec les chiffres du jeu de règles actif."
        actions={<RulesBadge rules={rules} />}
      />
      <Callout>
        Résumé rédigé pour ElevageSimu (outil non officiel). Les durées, seuils et barèmes sont calculés à partir des règles <strong>{rules.label}</strong>{' '}
        et changent si vous changez de version dans les <a href={href('reglages')}>Réglages</a>. Guide complet de la communauté :{' '}
        <a href={DPLN_GUIDE} target="_blank" rel="noopener noreferrer">
          Dofus pour les Noobs
        </a>
        .
      </Callout>
      <div className="guide-layout">
        <nav className="guide-toc" aria-label="Sommaire du guide">
          <details open>
            <summary>Sommaire</summary>
            <ol>
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={href('guide', { s: s.id })} onClick={go(s.id)} aria-current={active === s.id ? 'true' : undefined} className={active === s.id ? 'active' : undefined}>
                    {s.label}
                  </a>
                </li>
              ))}
            </ol>
          </details>
        </nav>
        <div className="guide-content">
          <BasesSection rules={rules} />
          <EnclosSection rules={rules} jobLevel={jobLevel} />
          <SereniteSection rules={rules} />
          <AccouplementSection rules={rules} />
          <GenetonsSection rules={rules} />
          <ClonageSection rules={rules} />
          <CapturesSection jobLevel={jobLevel} />
          <MetierSection rules={rules} jobLevel={jobLevel} />
          <AlmanaxSection />
          <ErreursSection />
          <V37Section rules={rules} />
          <FiabiliteSection />
          <SourcesSection />
        </div>
      </div>
    </div>
  )
}
