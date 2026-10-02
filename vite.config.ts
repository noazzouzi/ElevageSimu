/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Découpage du bundle : React à part, et chaque fichier de données du jeu (src/data/*.json, ~900 Ko au
 * total) dans son propre fichier. Les navigateurs gardent ainsi en cache ce qui ne change pas d'une
 * version à l'autre, et aucun fichier ne dépasse la limite d'avertissement de Vite (500 Ko).
 */
function chunkName(moduleId: string): string | null {
  if (moduleId.includes('/node_modules/')) return 'vendor'
  const data = /\/src\/data\/([\w-]+)\.json$/.exec(moduleId)
  return data ? `data-${data[1]}` : null
}

// https://vite.dev/config/
export default defineConfig({
  // Chemins relatifs : l'app fonctionne aussi bien en local qu'hébergée (GitHub Pages, fichier statique…)
  base: './',
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: chunkName, debugName: 'vendor-et-donnees' }] },
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
