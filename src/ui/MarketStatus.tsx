// État des prix du marché du serveur ouvert, affiché sur les pages qui conseillent avec ces prix :
// export ancien (à rafraîchir / périmé), prix d'un AUTRE serveur chargés pour celui-ci, export sans
// colonnes de ventes (liquidité inconnue). Et libellé de l'origine d'un prix (« marché (02/10) · 1 034
// vendus/24 h », « coût des ingrédients », « votre prix »…) partagé par les listes de courses.
// Logique : src/domain/market.ts, src/domain/marketInsights.ts (snapshotFreshness).
import { frenchDay, marketOriginMismatch, PRICE_STAT_SHORT } from '../domain/market'
import { snapshotFreshness } from '../domain/marketInsights'
import type { MarketPriceInfo, PriceOrigin } from '../domain/pricing'
import { formatNumber } from '../lib/format'
import { useMarketSource } from '../store/market'
import { useActiveServer } from '../store/profiles'
import { Callout } from './components'
import { href } from './router'
import { useServerDay } from './useServerDay'

/**
 * Bandeaux sur les prix du marché du serveur ouvert : rien si l'export est récent, du bon serveur et
 * complet. `context` : ce que la page en tire (« conseils », « montants »…), pour le texte.
 * `showSource` : rappelle aussi d'où viennent les prix quand tout va bien (une ligne discrète :
 * « Prix : HDV de Tylezia du 02/10/2026 »), ou qu'aucun export n'est importé — pour les pages de coûts
 * qui n'affichent pas l'origine de chaque prix (Métier, Enclos, Accouplement, Optimiseur).
 */
export function MarketStatusCallouts({ context = 'conseils', showSource = false }: { context?: string; showSource?: boolean }) {
  const market = useMarketSource()
  const today = useServerDay()
  const server = useActiveServer()
  if (!market)
    return showSource ? (
      <p className="muted market-source">
        Prix : aucun export HDV importé pour {server.name} — vos prix, puis les prix par défaut de la recherche (autres serveurs, datés).{' '}
        <a href={href('prix', { onglet: 'hdv' })}>Importer l’export HDV</a>
      </p>
    ) : null
  const fr = snapshotFreshness(market.exportDate, today)
  const origin = marketOriginMismatch(market)
  const link = (
    <a href={href('prix', { onglet: 'hdv' })} style={{ whiteSpace: 'nowrap' }}>
      Importer un export récent
    </a>
  )
  return (
    <>
      {showSource && (
        <p className="muted market-source">
          Prix : HDV de {market.serverName} du {frenchDay(market.exportDate)} ({formatNumber(Object.keys(market.rows).length)} objets,{' '}
          {market.stat === 'auto' ? 'statistique automatique' : PRICE_STAT_SHORT[market.stat]}), après vos prix saisis et avant les défauts de la recherche.{' '}
          <a href={href('prix', { onglet: 'marche' })}>Lecture du marché</a>
        </p>
      )}
      {fr.level !== 'frais' && (
        <Callout tone={fr.tone === 'danger' ? 'danger' : 'warn'}>
          <strong>{fr.level === 'perime' ? 'Prix périmés' : fr.level === 'a-rafraichir' ? 'Prix à rafraîchir' : 'Date des prix à vérifier'}</strong> — {fr.message} Les {context} de cette page
          s’appuient sur ces prix. {link}
        </Callout>
      )}
      {origin && (
        <Callout tone="warn">
          <strong>
            Prix de {origin} (chargés pour {market.serverName})
          </strong>{' '}
          : ce sont les prix de l’HDV d’un autre serveur (chaque serveur a son économie) — un ordre de grandeur en attendant l’export de{' '}
          {market.serverName}. {link}
        </Callout>
      )}
      {market.volumeUnknown && (
        <Callout tone="warn">
          Export HDV sans colonnes de ventes (vendus_24h/7j/30j) : la <strong>liquidité est inconnue</strong>, les ventes prévues ne sont pas plafonnées par le
          volume du serveur. {link}
        </Callout>
      )}
    </>
  )
}

/** Libellé court de l'origine d'un prix (listes de courses, carburants, makinas). */
export function priceOriginText(origin: PriceOrigin | 'estimation', market?: MarketPriceInfo | null): string {
  switch (origin) {
    case 'marche':
      if (!market) return 'marché'
      return `marché (${frenchDay(market.exportDate).slice(0, 5)})${market.loadedFor ? ` de ${market.serverName}` : ''} · ${
        market.volumeUnknown
          ? 'volume inconnu'
          : market.sold24 > 0
            ? `${formatNumber(market.sold24)} vendus/24 h`
            : `≈ ${formatNumber(market.perDayAvg, market.perDayAvg < 10 ? 1 : 0)} vendus/jour (30 j)`
      }`
    case 'craft':
      return 'coût des ingrédients'
    case 'joueur':
      return 'votre prix'
    case 'defaut':
      return 'prix par défaut (recherche)'
    case 'estimation':
      return 'estimation'
    default:
      return 'prix à saisir'
  }
}

/** Infobulle détaillée d'un prix du marché importé. */
export function marketPriceTitle(market: MarketPriceInfo): string {
  const where = `HDV${market.serverName ? ` de ${market.serverName}` : ''} du ${frenchDay(market.exportDate)}${market.loadedFor ? `, chargés pour ${market.loadedFor}` : ''}`
  const vol = market.volumeUnknown
    ? 'volumes inconnus (export sans colonnes de ventes)'
    : `${formatNumber(market.sold24)} vendus en 24 h, ≈ ${formatNumber(market.perDayAvg, market.perDayAvg < 10 ? 1 : 0)}/jour sur 30 jours`
  return `Prix du marché importé (${where}, ${PRICE_STAT_SHORT[market.stat]}) : ${vol}.`
}

/** Origine d'un prix, en petit (avec le détail du marché en infobulle). */
export function PriceOriginNote({ origin, market }: { origin: PriceOrigin | 'estimation'; market?: MarketPriceInfo | null }) {
  return (
    <small className="muted" title={origin === 'marche' && market ? marketPriceTitle(market) : undefined}>
      {priceOriginText(origin, market)}
    </small>
  )
}
