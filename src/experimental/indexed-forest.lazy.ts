import { isIndexedForestGraph as eligible } from './indexed-forest-eligibility.ts'
import { readyForest } from '../layout/forest-loader.lazy.ts'
import type { MermaidGraph } from '../types.ts'

/** Resolve the dependency at admission, before measured ELK graph preparation. */
export function isIndexedForestGraph(graph: MermaidGraph): boolean {
  if (!eligible(graph)) return false
  readyForest()
  return true
}

export const indexedForestLayout: typeof import('./indexed-forest.ts').indexedForestLayout = (...args) => readyForest().indexedForestLayout(...args)
