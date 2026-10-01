// Génère les données de l'application (src/data/*.json) à partir des dumps DofusDB et de la recherche.
// Usage : node scripts/build-data.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RAW = join(ROOT, 'research/raw')
const OUT = join(ROOT, 'src/data')
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const write = (name, data) => {
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 1) + '\n')
  console.log(`écrit src/data/${name}`)
}

// ---------- Recettes du métier Éleveur ----------
const recipes = read(join(RAW, 'recipes-eleveur.slim.json'))
const items = read(join(RAW, 'items-eleveur.json'))

const SIZE_WORDS = { Minuscule: 'minuscule', Petit: 'petit', Petite: 'petit', Grand: 'grand', Grande: 'grand', Gigantesque: 'gigantesque' }
const SIZE_DURABILITY = { minuscule: 1000, petit: 2000, normal: 3000, grand: 4000, gigantesque: 5000 }
const TIER_WORDS = { Extrait: 1, Philtre: 2, Potion: 3, Élixir: 4 }
const GAUGE_WORDS = { Abreuvoir: 'abreuvoir', Baffeur: 'baffeur', Caresseur: 'caresseur', Dragofesse: 'dragofesse', Foudroyeur: 'foudroyeur', Mangeoire: 'mangeoire' }
const FAMILY_WORDS = { Dragodinde: 'dragodinde', Muldo: 'muldo', Volkorne: 'volkorne' }

const ingredientsOf = (r) =>
  r.ingredientIds.map((id, i) => ({ id, qty: r.quantities[i] }))

const fuels = []
const makinas = []
const nets = []
const unmapped = []
for (const r of recipes) {
  const name = r.resultName.fr
  const base = { id: r.resultId, name, level: r.resultLevel, ingredients: ingredientsOf(r) }
  if (r.resultTypeId === 326) {
    const words = name.split(' ')
    let size = 'normal'
    if (SIZE_WORDS[words[0]]) size = SIZE_WORDS[words.shift()]
    const tier = TIER_WORDS[words[0]]
    const gaugeWord = name.match(/(Abreuvoir|Baffeur|Caresseur|Dragofesse|Foudroyeur|Mangeoire)$/)?.[1]
    if (!tier || !gaugeWord) {
      unmapped.push(name)
      continue
    }
    fuels.push({ ...base, gauge: GAUGE_WORDS[gaugeWord], tier, size, durability: SIZE_DURABILITY[size] })
  } else if (r.resultTypeId === 323) {
    const m = name.match(/^(Animakina|Kromakina|Optimakina) (Dragodinde|Muldo|Volkorne) de Génération (\d+)$/)
    if (!m) {
      unmapped.push(name)
      continue
    }
    makinas.push({ ...base, kind: m[1].toLowerCase(), family: FAMILY_WORDS[m[2]], generation: Number(m[3]) })
  } else if (r.resultTypeId === 99) {
    let kind = 'universel'
    if (/multiplicateur .* renforcé$/.test(name)) kind = 'multiplicateur_renforce'
    else if (/^Filet multiplicateur/.test(name)) kind = 'multiplicateur'
    else if (/renforcé$/.test(name)) kind = 'renforce'
    const fam = name.match(/(Dragodinde|Muldo|Volkorne)/)?.[1]
    nets.push({ ...base, kind, family: fam ? FAMILY_WORDS[fam] : null })
  } else unmapped.push(name)
}

const usedIds = new Set(recipes.flatMap((r) => r.ingredientIds))
const resultIds = new Set(recipes.map((r) => r.resultId))
const ingredients = [...usedIds]
  .map((id) => items[String(id)])
  .filter(Boolean)
  .map((it) => ({
    id: it.id,
    name: it.name,
    level: it.level,
    typeId: it.typeId,
    npcPrice: it.price ?? null,
    craftedByEleveur: resultIds.has(it.id),
    usedIn: recipes.filter((r) => r.ingredientIds.includes(it.id)).length,
  }))
  .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'fr'))

// Fusion des informations de provenance issues de la recherche (si disponibles).
const craftsResearch = join(ROOT, 'research/data/crafts.json')
if (existsSync(craftsResearch)) {
  try {
    const cr = read(craftsResearch)
    const byId = new Map((cr.ingredients ?? []).map((i) => [i.id, i]))
    for (const ing of ingredients) {
      const r = byId.get(ing.id)
      if (!r) continue
      if (r.typeName) ing.typeName = r.typeName
      if (r.source) ing.source = r.source
      if (r.isMountResource !== undefined) ing.isMountResource = r.isMountResource
    }
  } catch (e) {
    console.warn('crafts.json illisible :', e.message)
  }
}

fuels.sort((a, b) => a.gauge.localeCompare(b.gauge) || a.tier - b.tier || a.durability - b.durability)
makinas.sort((a, b) => a.family.localeCompare(b.family) || a.kind.localeCompare(b.kind) || a.generation - b.generation)
nets.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'fr'))
if (unmapped.length) console.warn('Recettes non classées :', unmapped)
console.log(`${fuels.length} carburants, ${makinas.length} makinas, ${nets.length} filets, ${ingredients.length} ingrédients`)
write('recipes.json', { generatedFrom: 'DofusDB (api.dofusdb.fr), métier Éleveur (jobId 79)', fuels, makinas, nets, ingredients })
