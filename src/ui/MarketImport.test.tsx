// @vitest-environment jsdom
// Import d'un export HDV (Prix › Marché HDV) : fichier partiel (confirmation, « Compléter »), annulation
// de l'import, serveur évoqué par le nom du fichier (revue « marché » : MKT-12, MKT-10, MKT-09).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import tylezia from '../data/market/tylezia-2026-10-02.json'
import { sanitizeSnapshot } from '../domain/market'
import { applyMarketSnapshot, useMarket, useMarketHistory } from '../store/market'
import { ACTIVE_SERVER_ID } from '../store/profiles'
import MarketImport from './MarketImport'

const HEADER = 'gid;nom;niveau;type;categorie;vendus_24h;vendus_7j;vendus_30j;median_30j;moyen_30j;median_24h;kamas_par_jour'
const TINY = [HEADER, '19975;Corne de volkorne;60;Os;Ressource;10744;38301;127342;30205;32111;26497;128212170'].join('\n')

async function upload(name: string, text: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File([text], name, { type: 'text/csv', lastModified: Date.UTC(2026, 9, 3) })
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } })
  })
  await waitFor(() => expect(screen.getByText(/Lignes lues/)).toBeTruthy())
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  useMarket.setState({ snapshot: null })
  useMarketHistory.setState({ entries: [] })
  expect(applyMarketSnapshot(ACTIVE_SERVER_ID, { ...sanitizeSnapshot(tylezia).snapshot!, importedAt: 1_000 })).toEqual({ ok: true })
})
afterEach(() => cleanup())

describe('import d’un export HDV', () => {
  it('MKT-12 : fichier partiel → avertissement et confirmation avant de remplacer ; « Compléter » garde les autres objets ; import annulable', async () => {
    render(<MarketImport />)
    const before = Object.keys(useMarket.getState().snapshot!.rows).length
    await upload('export-2026-10-03.csv', TINY)
    expect(screen.getByText(/Fichier partiel : 1 objets avec un prix/)).toBeTruthy()
    // Premier clic : rien n'est remplacé, confirmation demandée.
    fireEvent.click(screen.getByRole('button', { name: /Remplacer les prix du marché de/ }))
    expect(Object.keys(useMarket.getState().snapshot!.rows)).toHaveLength(before)
    expect(screen.getByRole('button', { name: /Confirmer : remplacer par 1 objets seulement/ })).toBeTruthy()
    // Compléter : la Corne prend le nouveau prix, les autres objets restent.
    fireEvent.click(screen.getByRole('button', { name: /Compléter les prix actuels/ }))
    const merged = useMarket.getState().snapshot!
    expect(Object.keys(merged.rows)).toHaveLength(before)
    expect(merged.exportDate).toBe('2026-10-02') // les objets gardés datent du 02/10
    expect(screen.getByText(/Prix du marché de .* complétés/)).toBeTruthy()
    // Annuler l'import : l'export précédent revient.
    fireEvent.click(screen.getByRole('button', { name: 'Annuler l’import' }))
    expect(useMarket.getState().snapshot!.importedAt).toBe(1_000)
    expect(screen.getByText(/Import annulé : prix du marché de .* rétablis \(export du 02\/10\/2026/)).toBeTruthy()
  })

  it('MKT-12 : remplacement confirmé puis annulé depuis « Annuler le dernier import »', async () => {
    render(<MarketImport />)
    await upload('export-2026-10-03.csv', TINY)
    fireEvent.click(screen.getByRole('button', { name: /Remplacer les prix du marché de/ }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmer : remplacer/ }))
    expect(Object.keys(useMarket.getState().snapshot!.rows)).toEqual(['19975'])
    cleanup()
    render(<MarketImport />)
    fireEvent.click(screen.getByRole('button', { name: 'Annuler le dernier import' }))
    expect(useMarket.getState().snapshot!.importedAt).toBe(1_000)
    expect(useMarketHistory.getState().entries.map((e) => e.importedAt)).toEqual([1_000])
  })

  it('MKT-10 / MKT-09 : fichier « tylezia-… » pour « Mon serveur » signalé ; réimport identique : aucune variation de prix clé', async () => {
    render(<MarketImport />)
    const csv = [HEADER, ...Object.entries(sanitizeSnapshot(tylezia).snapshot!.rows).map(([id, t]) => `${id};x;1;t;c;${t[3]};${t[4]};${t[5]};${t[0]};${t[1]};${t[2]};${t[6]}`)].join('\n')
    await upload('tylezia-2026-10-02.csv', csv)
    expect(screen.getByText(/Le nom du fichier évoque le serveur « Tylezia »/)).toBeTruthy()
    expect(screen.queryByText(/Fichier partiel/)).toBeNull()
    // Même export : toutes les variations sont nulles, aucun « Objet #… ».
    const table = screen.getByText(/Prix clés : export du 02\/10\/2026 → 02\/10\/2026/).nextElementSibling as HTMLElement
    expect(table.textContent).not.toMatch(/Objet #/)
    expect(table.querySelectorAll('.mi-up, .mi-down')).toHaveLength(0)
  })
})
