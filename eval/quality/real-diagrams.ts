// ============================================================================
// Real diagrams: the inputs that decide diagram quality.
//
// A real diagram is one a person drew: the docs corpus, or a gate fixture taken
// from a user's issue (its text names the issue's github.com URL). Generated
// graphs, stress cases and hand-built geometry are robustness inputs: they
// guard against crashes and hard defects but do not decide what "better" means.
// See docs/contributing/diagram-quality.md.
// ============================================================================

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface RealDiagram { id: string; source: string; url?: string }

export const FIXTURES_DIR = resolve(import.meta.dir, '..', 'layout-compare', 'fixtures')
const ISSUE_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+/

/** The issue a fixture was taken from, if any. */
export const issueUrl = (source: string): string | undefined => source.match(ISSUE_URL)?.[0]

/** Every real diagram: the docs corpus and the fixtures drawn from user issues. */
export async function realDiagrams(root = resolve(import.meta.dir, '..', '..')): Promise<RealDiagram[]> {
  const { collectSamples } = await import(join(root, 'eval/layout-compare/run.ts')) as typeof import('../layout-compare/run.ts')
  const diagrams: RealDiagram[] = collectSamples({ includeStress: false })
    .filter(sample => sample.id.startsWith('corpus/'))
    .map(sample => ({ id: sample.id, source: sample.source }))
  const dir = join(root, 'eval/layout-compare/fixtures')
  for (const name of readdirSync(dir).filter(file => file.endsWith('.mmd')).sort()) {
    const source = readFileSync(join(dir, name), 'utf8')
    const url = issueUrl(source)
    if (url) diagrams.push({ id: `fixture/${name}`, source, url })
  }
  return diagrams
}
