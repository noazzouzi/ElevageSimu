#!/usr/bin/env node
// Génère un préréglage de prix de marché (src/data/market/<serveur>-<date>.json) depuis un export CSV
// de l'HDV d'un serveur, avec la même logique que l'application (src/domain/market.ts, chargé par Vite) :
// lecture tolérante du CSV, objets utiles seulement (ingrédients, carburants, makinas, filets,
// objets-montures, ressources d'extraction, runes, boutique de génétons…), 7 nombres par objet.
//
// Usage : node scripts/import-hdv-csv.mjs <fichier.csv> <serveur> <AAAA-MM-JJ> [--out <dossier>]
// Exemple : node scripts/import-hdv-csv.mjs research/raw/hdv/tylezia-2026-10-02.csv Tylezia 2026-10-02
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runnerImport } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const outDir = outIdx >= 0 ? resolve(args[outIdx + 1] ?? '') : join(root, 'src/data/market')
const [csvPath, serverName, exportDate] = outIdx >= 0 ? args.filter((_, i) => i !== outIdx && i !== outIdx + 1) : args

if (!csvPath || !serverName || !/^\d{4}-\d{2}-\d{2}$/.test(exportDate ?? '')) {
  console.error('Usage : node scripts/import-hdv-csv.mjs <fichier.csv> <serveur> <AAAA-MM-JJ> [--out <dossier>]')
  process.exit(1)
}

const { module: market } = await runnerImport(join(root, 'src/domain/market.ts'), { root, logLevel: 'error', configFile: false })

const text = readFileSync(resolve(csvPath), 'utf8')
const parsed = market.parseHdvCsv(text)
if (parsed.error) {
  console.error(`Fichier refusé : ${parsed.error}`)
  process.exit(1)
}
const snapshot = market.buildSnapshot(parsed, {
  serverName,
  exportDate,
  source: basename(csvPath),
  // Date fixe (midi UTC du jour de l'export) : le fichier généré est reproductible.
  importedAt: Date.parse(`${exportDate}T12:00:00Z`),
})

/** JSON lisible et compact : une ligne par objet (diffs courts d'un import à l'autre). */
function serialize(s) {
  const head = { ...s, rows: undefined, names: undefined, stats: undefined }
  const lines = ['{']
  for (const [k, v] of Object.entries(head)) if (v !== undefined) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  lines.push('  "rows": {')
  const ids = Object.keys(s.rows).sort((a, b) => Number(a) - Number(b))
  ids.forEach((id, i) => lines.push(`    ${JSON.stringify(id)}: ${JSON.stringify(s.rows[id])}${i < ids.length - 1 ? ',' : ''}`))
  lines.push('  },')
  lines.push(`  "names": ${JSON.stringify(s.names)},`)
  lines.push(`  "stats": ${JSON.stringify(s.stats)}`)
  lines.push('}')
  return `${lines.join('\n')}\n`
}

mkdirSync(outDir, { recursive: true })
const file = join(outDir, `${market.slugify(serverName)}-${exportDate}.json`)
writeFileSync(file, serialize(snapshot))

const st = snapshot.stats
console.log(`${file}`)
console.log(`Lignes lues : ${st.read} / ${st.lines} (${st.ignored} ignorées, ${st.duplicates} doublons)`)
console.log(`Objets utiles reconnus : ${st.recognized} / ${st.relevant}, avec un prix : ${st.useful}`)
for (const c of st.coverage) console.log(`  ${c.label.padEnd(26)} ${String(c.priced).padStart(4)} / ${c.total}`)
if (st.missingCount) console.log(`Sans prix (${st.missingCount}) : ${st.missing.map((m) => m.name).join(', ')}`)
