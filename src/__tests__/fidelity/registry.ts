import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { FidelityCaseDefinition } from './contract.ts'
import { compareCodePointStrings } from '../../shared/deterministic-order.ts'

const CASE_DIRECTORY = join(import.meta.dir, 'cases')

export interface DiscoveredFidelityRegistry {
  cases: readonly FidelityCaseDefinition[]
  caseFiles: readonly string[]
}

function caseModuleFiles(): string[] {
  return readdirSync(CASE_DIRECTORY)
    .filter(name => name.endsWith('.fidelity.ts'))
    .sort()
    .map(name => join(CASE_DIRECTORY, name))
}

/** Discover checked-in case modules without maintaining a second case roster. */
export async function discoverFidelityRegistry(): Promise<DiscoveredFidelityRegistry> {
  const caseFiles = caseModuleFiles()
  const cases: FidelityCaseDefinition[] = []
  for (const path of caseFiles) {
    const module = (await import(pathToFileURL(path).href)) as {
      fidelityCases?: readonly FidelityCaseDefinition[]
    }
    if (!Array.isArray(module.fidelityCases)) {
      throw new Error(`${path}: fidelity case module must export a fidelityCases array`)
    }
    cases.push(...module.fidelityCases)
  }
  return {
    cases: cases.sort((a, b) => compareCodePointStrings(a.id, b.id)),
    caseFiles,
  }
}
