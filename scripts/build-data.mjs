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

// Données de la recherche (enrichissement des recettes).
const craftsPath = join(ROOT, 'research/data/crafts.json')
const crafts = existsSync(craftsPath) ? read(craftsPath) : null
const craftById = new Map()
if (crafts) for (const x of [...crafts.fuels, ...crafts.makinas, ...crafts.nets]) craftById.set(x.id, x)
for (const f of fuels) {
  const c = craftById.get(f.id)
  f.fillCap = c?.fillCap ?? { 1: 40000, 2: 70000, 3: 90000, 4: 100000 }[f.tier]
  f.xpRatio = c?.xp?.craftXpRatioPct ?? 5
}
for (const m of makinas) {
  const c = craftById.get(m.id)
  m.xpRatio = c?.xp?.craftXpRatioPct ?? 5
  if (c?.beta_3_7?.recipeChanged) m.beta37Ingredients = c.beta_3_7.ingredients?.map((i) => ({ id: i.id, qty: i.qty })) ?? null
}
for (const n of nets) {
  const c = craftById.get(n.id)
  n.xpRatio = c?.xp?.craftXpRatioPct ?? (n.kind === 'universel' ? 50 : 5)
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

// Provenance des ingrédients (recherche crafts.json), résumée pour l'application.
if (crafts) {
  const byId = new Map(crafts.ingredients.map((i) => [i.id, i]))
  for (const ing of ingredients) {
    const r = byId.get(ing.id)
    if (!r) continue
    ing.typeName = r.typeName ?? null
    ing.isMountResource = Boolean(r.isMountResource)
    const src = r.source ?? {}
    ing.source = {
      kind: src.kind ?? 'other',
      details: src.details ?? '',
      job: src.job ?? null,
      jobLevel: src.jobLevel ?? null,
      bossOnly: Boolean(src.bossOnly),
      requiresHunterJobLevel: src.requiresHunterJobLevel ?? null,
      monsters: (src.monsters ?? [])
        .slice()
        .sort((a, b) => (b.dropPctMax ?? 0) - (a.dropPctMax ?? 0))
        .slice(0, 3)
        .map((m) => ({ name: m.name, levelMin: m.levelMin, levelMax: m.levelMax, dropPct: m.dropPctMax, archmonster: Boolean(m.isArchmonster), boss: Boolean(m.isBoss) })),
    }
  }
}

fuels.sort((a, b) => a.gauge.localeCompare(b.gauge) || a.tier - b.tier || a.durability - b.durability)
makinas.sort((a, b) => a.family.localeCompare(b.family) || a.kind.localeCompare(b.kind) || a.generation - b.generation)
nets.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'fr'))
if (unmapped.length) console.warn('Recettes non classées :', unmapped)
console.log(`${fuels.length} carburants, ${makinas.length} makinas, ${nets.length} filets, ${ingredients.length} ingrédients`)
write('recipes.json', { generatedFrom: 'DofusDB (api.dofusdb.fr), métier Éleveur (jobId 79)', fuels, makinas, nets, ingredients })

// ---------- Espèces (arbres généalogiques) ----------
// Source d'autorité : tables du client Ankama (research/raw/dofus-client/rides-*.json), noms et stats
// issus des arbres de la recherche (research/data/tree-*.json).
const RES = join(ROOT, 'research')
const rides36 = new Map(read(join(RAW, 'dofus-client/rides-3.6.12.16.json')).data.map((r) => [r.id, r]))
const rides37 = new Map(read(join(RAW, 'dofus-client/rides-3.7.3.3-beta.json')).data.map((r) => [r.id, r]))
const FAMILIES = {
  dragodinde: { label: 'Dragodinde', plural: 'Dragodindes', clientSpeciesId: 1, dofusdbFamilyId: 1, commonBonus: 'Vitalité', extractionItemId: 33515, extractionItemName: 'Neurone de dragodinde' },
  muldo: { label: 'Muldo', plural: 'Muldos', clientSpeciesId: 2, dofusdbFamilyId: 5, commonBonus: '1 PM dès le niveau 100', extractionItemId: 17864, extractionItemName: 'Ambre de muldo' },
  volkorne: { label: 'Volkorne', plural: 'Volkornes', clientSpeciesId: 3, dofusdbFamilyId: 6, commonBonus: '1 PA dès le niveau 100', extractionItemId: 19975, extractionItemName: 'Corne de volkorne' },
}
const species = []
for (const fam of Object.keys(FAMILIES)) {
  const tree = read(join(RES, `data/tree-${fam}.json`))
  const nameToId = new Map(tree.mounts.map((m) => [m.name, m.dofusdbId]))
  for (const m of tree.mounts) {
    const r = rides36.get(m.dofusdbId)
    const r37 = rides37.get(m.dofusdbId)
    if (!r) throw new Error(`Monture absente du client : ${m.name}`)
    // Croisements : client (ids) — vérifiés égaux aux noms des arbres.
    const crossings = (r.parents ?? []).map((p) => [p.parent1, p.parent2].sort((a, b) => a - b))
    const fromTree = (m.crossings ?? []).map((pair) => pair.map((n) => nameToId.get(n)).sort((a, b) => a - b))
    const key = (c) => c.join('-')
    const a = new Set(crossings.map(key))
    const b = new Set(fromTree.map(key))
    if (a.size !== b.size || [...a].some((k) => !b.has(k))) throw new Error(`Croisements incohérents pour ${m.name}`)
    const stats = (m.statsRaw ?? []).map((s) => {
      const prog = s.progressionPerLevel ?? []
      const p1 = prog.find((x) => x[0] === 100)?.[1] ?? 0
      const p2 = prog.find((x) => x[0] === 200)?.[1] ?? 0
      const r1 = Math.round(p1 * 100)
      const r2 = Math.round(p2 * 100)
      if (Math.abs(p1 * 100 - r1) > 1e-6 || Math.abs(p2 * 100 - r2) > 1e-6) throw new Error(`Taux non centésimal : ${m.name} ${s.characteristic}`)
      return { name: s.characteristic, effectId: s.effectId, r1, r2 }
    })
    species.push({
      id: m.dofusdbId,
      family: fam,
      name: m.name,
      generation: r.generation,
      colors: m.colors ?? [],
      capturable: Boolean(m.capturable),
      breedable: m.breedable !== false && r.generation > 0,
      geneticWeight: r.geneticWeight,
      itemId: r.linkedItemGid ?? m.itemId ?? null,
      extractionQty: r.extractionRewardQuantity ?? 0,
      genetons: { '3.5': r.breedingTokenRewardQuantity, '3.6': r.breedingTokenRewardQuantity, '3.7': r37?.breedingTokenRewardQuantity ?? r.breedingTokenRewardQuantity },
      captureMonsterId: m.captureMonsterId ?? null,
      crossings,
      stats,
      crossingsConfidence: m.crossingsConfidence ?? 'high',
    })
  }
}
species.sort((a, b) => a.family.localeCompare(b.family) || a.generation - b.generation || a.name.localeCompare(b.name, 'fr'))
const counts = {}
for (const s of species) counts[s.family] = (counts[s.family] ?? 0) + 1
console.log('espèces :', counts)

// ---------- Règles et tables de jeu ----------
const mech = read(join(RES, 'data/mechanics.json'))
const strat = read(join(RES, 'data/strategy.json'))
const prices = read(join(RES, 'data/prices-default.json'))
const levelTable = (obj) => {
  const out = []
  for (let L = 1; L <= 200; L++) out.push(obj[String(L)])
  if (out.some((v) => typeof v !== 'number')) throw new Error('table XP incomplète')
  return out
}
// Une famille peut avoir plusieurs zones dans la recherche (ex. zone héritée peu fiable) :
// on garde la plus fiable, puis la première rencontrée.
const CONF_RANK = { high: 0, medium: 1, low: 2 }
const zonesById = {}
for (const z of strat.captureZones ?? []) {
  const k = z.family.toLowerCase()
  const prev = zonesById[k]
  if (!prev || (CONF_RANK[z.confidence] ?? 3) < (CONF_RANK[prev.confidence] ?? 3)) zonesById[k] = z
}
const game = {
  generatedFrom: 'research/data/mechanics.json + strategy.json (client Dofus 3.6.12.16 / bêta 3.7.3.3, guide DPLN, DofusDB)',
  liveClientVersion: mech.meta.liveClientVersion,
  betaClientVersion: mech.meta.betaClientVersion,
  families: Object.fromEntries(
    Object.entries(FAMILIES).map(([k, v]) => {
      const z = zonesById[v.label.toLowerCase()]
      return [
        k,
        {
          ...v,
          captureZone: z
            ? { subarea: z.subarea, area: z.area, xRange: z.xRange, yRange: z.yRange, nearestZaap: z.nearestZaap, levels: z.levels, monsters: z.monsters }
            : null,
        },
      ]
    }),
  ),
  mountXpTable: levelTable(mech.mountXp.cumulativeXpToReachLevel),
  jobXpTable: levelTable(mech.breederJob.xpTable.cumulativeXpToReachLevel),
  almanaxBreedingBonuses: mech.almanax.breedingBonuses,
  almanaxCalendar: strat.almanaxCalendar,
  genetonShop: strat.genetonShop,
  nets: mech.capture.nets,
  naturalAbilityOdds37: mech.makinas.naturalAbilityOdds_3_7beta,
  changes37: strat.version37,
  timeline: mech.timeline,
}

// ---------- Prix par défaut ----------
const pricesDefault = {
  asOf: prices.asOf,
  server: prices.server,
  notes: prices.notes,
  priceTypeLegend: prices.priceTypeLegend,
  sources: prices.sources,
  marketFees: prices.marketFees,
  items: prices.items.map((i) => ({
    id: i.id ?? null,
    name: i.name,
    category: i.category ?? null,
    price: i.price ?? null,
    range: i.priceRange ?? null,
    priceType: i.priceType,
    confidence: i.confidence,
    date: i.date ?? null,
    source: i.source ?? null,
    notes: i.notes ?? null,
  })),
  mounts: prices.mounts.map((m) => ({
    family: m.family?.toLowerCase() ?? null,
    generation: m.generation ?? null,
    name: m.name ?? null,
    level: m.level ?? null,
    state: m.state ?? null,
    price: m.price ?? null,
    range: m.priceRange ?? null,
    priceType: m.priceType,
    confidence: m.confidence,
    date: m.date ?? null,
    source: m.source ?? null,
    notes: m.notes ?? null,
  })),
  genetons: {
    kamasPerGeneton: prices.genetons.kamasPerGeneton,
    range: prices.genetons.kamasPerGenetonRange,
    basis: prices.genetons.kamasPerGenetonBasis,
    confidence: prices.genetons.kamasPerGenetonConfidence,
    shop: prices.genetons.shop,
  },
  poussiere: { kamasPerPoussiere: prices.poussiere.kamasPerPoussiere, range: prices.poussiere.kamasPerPoussiereRange, confidence: prices.poussiere.kamasPerPoussiereConfidence, shop: prices.poussiere.shopAdeleVage },
  valuation: prices.valuation,
  coverage: prices.coverage,
}

// ---------- Stratégie ----------
const strategy = {
  phases: strat.phases,
  paddockRules: strat.paddockRules,
  paddockAllocationByCount: strat.paddockAllocationByCount,
  matingRules: strat.matingRules,
  captureRules: strat.captureRules,
  mountFateGrid: strat.mountFateGrid,
  formulas: strat.formulas,
  dailyRoutine: strat.dailyRoutine,
  jobLevelingPlan: strat.jobLevelingPlan,
  jobLevelingNotes: strat.jobLevelingNotes,
  commonMistakes: strat.commonMistakes,
  simulation: { keyFindings: strat.simulation.keyFindings, caveats: strat.simulation.caveats },
  toolsReview: strat.toolsReview,
  sources: strat.sources,
}

write('species.json', { families: game.families, species })
write('game.json', game)
write('prices-default.json', pricesDefault)
write('strategy.json', strategy)
