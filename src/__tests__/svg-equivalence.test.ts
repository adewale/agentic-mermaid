// Differential SVG-equivalence gate.
//
// Renders the full layout-compare corpus (the mermaid-docs corpus plus the
// fixtures in eval/layout-compare/fixtures/) through the public
// renderMermaidSVG path and asserts the output hash of every diagram is
// byte-identical to a committed baseline. This is the determinism oracle for
// the SceneGraph migration (SPEC §11 phases 1–2): each family renderer is
// rewritten from string concatenation to scene lowering + DefaultBackend
// serialization, and this gate answers "did a single output byte change" for
// the whole corpus in one run, naming the first diagram that drifted.
//
// Two option profiles are hashed per diagram: the default path, and a
// post-pass-heavy profile (compact + idPrefix + strict security) so the
// namespaceSvgIds/stripExternalRefs/compactSvg interactions are covered too.
//
// Regenerate after an INTENTIONAL serialization change:
//   UPDATE_SVG_BASELINE=1 bun test src/__tests__/svg-equivalence.test.ts
// The baseline lives under src/__tests__/testdata/, so the golden-drift CI
// gate (scripts/ci/golden-drift.ts) forces an [approve-goldens] commit line
// once the diff has been reviewed — serialization drift can never land
// unnoticed.

import { describe, test, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { renderMermaidSVG } from '../index.ts'
import type { RenderOptions } from '../types.ts'
import { collectSamples } from '../../eval/layout-compare/run.ts'

const BASELINE = join(import.meta.dir, 'testdata', 'svg-output-baseline.json')
const UPDATE = process.env.UPDATE_SVG_BASELINE === '1'
const MIN_CORPUS = 258 // matches the floor the layout-equivalence gate pins

const PROFILES: Array<{ key: string; options: RenderOptions }> = [
  { key: 'default', options: {} },
  { key: 'postpass', options: { compact: true, idPrefix: 'eq-', security: 'strict' } },
]

/** What we record per diagram×profile: a SHA-256 of the SVG bytes, or the
 *  thrown error's message. A previously-rendering diagram that starts throwing
 *  — or vice versa — is itself a regression this gate must catch. */
function hashOf(source: string, options: RenderOptions): string {
  try {
    const svg = renderMermaidSVG(source, options)
    return createHash('sha256').update(svg).digest('hex')
  } catch (e) {
    return `error:${(e as Error).message}`
  }
}

function buildRecords(): Map<string, string> {
  const out = new Map<string, string>()
  for (const sample of collectSamples()) {
    for (const profile of PROFILES) {
      out.set(`${sample.id}#${profile.key}`, hashOf(sample.source, profile.options))
    }
  }
  return out
}

function serializeBaseline(records: Map<string, string>): string {
  const obj: Record<string, string> = {}
  for (const key of [...records.keys()].sort()) obj[key] = records.get(key)!
  return JSON.stringify(obj, null, 2) + '\n'
}

describe('svg output equivalence', () => {
  test('corpus SVG output is byte-identical to the committed baseline', () => {
    const records = buildRecords()
    expect(records.size).toBeGreaterThanOrEqual(MIN_CORPUS * PROFILES.length)

    if (UPDATE || !existsSync(BASELINE)) {
      writeFileSync(BASELINE, serializeBaseline(records))
      console.log(`svg-equivalence: baseline written (${records.size} records)`)
      return
    }

    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, string>
    const baselineKeys = Object.keys(baseline)
    // Corpus growth is fine (new records get added on regeneration); silent
    // shrinkage is not — a missing record means a diagram stopped being tested.
    for (const key of baselineKeys) {
      const actual = records.get(key)
      if (actual === undefined) {
        throw new Error(`svg-equivalence: baseline record ${key} is missing from the corpus`)
      }
      if (actual !== baseline[key]) {
        throw new Error(
          `svg-equivalence: SVG output drifted for ${key}\n` +
          `  baseline: ${baseline[key]}\n` +
          `  actual:   ${actual}\n` +
          `Regenerate deliberately with UPDATE_SVG_BASELINE=1 and review via [approve-goldens].`
        )
      }
    }
    const newKeys = [...records.keys()].filter(k => !(k in baseline))
    if (newKeys.length > 0) {
      throw new Error(
        `svg-equivalence: ${newKeys.length} corpus records missing from the baseline (e.g. ${newKeys[0]}). ` +
        'Regenerate with UPDATE_SVG_BASELINE=1.'
      )
    }
  }, 20_000) // Full corpus × output profiles; preserve a bounded CI budget above the 5 s default.
})
