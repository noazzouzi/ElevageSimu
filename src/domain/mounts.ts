// Utilitaires sur les montures possédées (statut, compatibilité, création).
import { getSpecies } from '../data'
import type { BreedingParent } from './genetics'
import { isFecund } from './paddock'
import type { Fertility, Gender, Mount, MountLocation } from './types'

/** Statut effectif : « féconde » se déduit des jauges si la monture est fertile. */
export function effectiveFertility(m: Mount): Fertility {
  if (m.fertility === 'sterile' || m.fertility === 'senile') return m.fertility
  return isFecund(m) ? 'feconde' : 'fertile'
}

export const FERTILITY_LABELS: Record<Fertility, string> = {
  fertile: 'Fertile',
  feconde: 'Féconde',
  sterile: 'Stérile',
  senile: 'Sénile',
}

export const GENDER_LABELS: Record<Gender, string> = { male: 'Mâle', femelle: 'Femelle' }
export const GENDER_ICONS: Record<Gender, string> = { male: '♂', femelle: '♀' }

export function mountName(m: Mount): string {
  return m.name?.trim() || getSpecies(m.speciesId)?.name || `Monture ${m.speciesId}`
}

export function toBreedingParent(m: Mount): BreedingParent {
  return { speciesId: m.speciesId, level: m.level, parents: m.parents.slice(0, 2), ability: m.ability }
}

/** Raisons empêchant l'accouplement (vide = possible). */
export function matingBlockers(a: Mount, b: Mount): string[] {
  const out: string[] = []
  const sa = getSpecies(a.speciesId)
  const sb = getSpecies(b.speciesId)
  if (!sa || !sb) return ['Espèce inconnue.']
  if (sa.family !== sb.family) out.push('Familles différentes.')
  if (a.gender === b.gender) out.push('Il faut un mâle et une femelle.')
  if (!sa.breedable || !sb.breedable) out.push('Monture spéciale non élevable.')
  for (const m of [a, b]) {
    const f = effectiveFertility(m)
    if (f !== 'feconde') out.push(`${mountName(m)} n'est pas féconde (${FERTILITY_LABELS[f].toLowerCase()}).`)
  }
  return out
}

/** Raisons empêchant le clonage (vide = possible). */
export function cloningBlockers(a: Mount, b: Mount): string[] {
  const out: string[] = []
  const sa = getSpecies(a.speciesId)
  const sb = getSpecies(b.speciesId)
  if (!sa || !sb) return ['Espèce inconnue.']
  if (a.id === b.id) out.push('Il faut deux montures différentes.')
  if (sa.family !== sb.family) out.push('Familles différentes.')
  if (sa.generation !== sb.generation) out.push('Les deux montures doivent être de la même génération.')
  if (a.fertility === 'senile' || b.fertility === 'senile') out.push('Les montures séniles ne peuvent pas être clonées.')
  return out
}

/** Monture fraîchement capturée (G1, niveau 1, jauges à 0). */
export function capturedMount(speciesId: number, gender: Gender, serenity = 0, location: MountLocation = { kind: 'etable' }): Omit<Mount, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    speciesId,
    gender,
    level: 1,
    ability: null,
    fertility: 'fertile',
    parents: [],
    location,
    serenity,
    endurance: 0,
    maturity: 0,
    love: 0,
  }
}

/** Bébé issu de deux parents (niveau 1, jauges à 0, arbre = espèces des parents). */
export function babyMount(speciesId: number, gender: Gender, a: Mount, b: Mount, serenity = 0): Omit<Mount, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    ...capturedMount(speciesId, gender, serenity),
    parents: [a.speciesId, b.speciesId],
    grandparents: [...a.parents.slice(0, 2), ...b.parents.slice(0, 2)],
  }
}
