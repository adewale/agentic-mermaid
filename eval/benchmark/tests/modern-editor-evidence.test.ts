import { expect, test } from 'bun:test'
import { resumeEngineEvidence, validateEngineEvidence } from '../modern-editor/evidence.mjs'

function evidence() {
  const inventory = { upstream: { commit: 'upstream' }, pages: [{ file: 'example.md', sha256: 'fetched-page' }],
    occurrences: [{ id: 'example.md:1', family: 'flowchart', source: 'flowchart LR\nA-->B' }] }
  const report = { date: '2026-10-23T00:00:00Z', environment: { browser: 'measured-browser' }, corpus: inventory, revisions: { modern: 'modern', agentic: 'agentic' },
    fetchedArtifacts: { modernLockSha256: 'lock', modernModules: [{ path: 'engine.js', sha256: 'engine' }], referenceModules: [{ path: 'engine.js', sha256: 'reference' }], modernThemesSourceSha256: 'config', agenticBundleSha256: 'bundle' },
    engines: ['modern', 'agentic', 'reference'].flatMap(engine => [1, 2, 3].map(round => ({ engine, round, id: 'example.md:1', family: 'flowchart', ok: true, ms: 1 }))),
  }
  return { inventory, report }
}

test('resumes complete unchanged engine measurements with their original measurement date', () => {
  const { inventory, report } = evidence()
  expect(resumeEngineEvidence(report, inventory, report, inventory)).toEqual({ engines: report.engines, engineMeasuredAt: report.date, engineEnvironment: report.environment })
  expect(resumeEngineEvidence({ ...report, engineMeasuredAt: 'original' }, inventory, report, inventory).engineMeasuredAt).toBe('original')
  expect(resumeEngineEvidence({ ...report, engineEnvironment: { browser: 'original-browser' } }, inventory, report, inventory).engineEnvironment).toEqual({ browser: 'original-browser' })
})

test('rejects an inventory paired with measurements of different source under the same IDs', () => {
  const { inventory, report } = evidence(), changed = structuredClone(inventory)
  changed.occurrences[0]!.source = 'invalid syntax'
  expect(() => validateEngineEvidence(report, changed)).toThrow('does not match its input inventory')
})

test.each(['source', 'line identity', 'page bytes', 'upstream revision'] as const)('rejects a same-count change to %s before reusing engine results', change => {
  const { inventory, report } = evidence(), changed = structuredClone(inventory)
  if (change === 'source') changed.occurrences[0]!.source = 'invalid syntax'
  if (change === 'line identity') changed.occurrences[0]!.id = 'example.md:2'
  if (change === 'page bytes') changed.pages[0]!.sha256 = 'different-page'
  if (change === 'upstream revision') changed.upstream.commit = 'new-upstream'
  expect(() => resumeEngineEvidence(report, inventory, report, changed)).toThrow('Different engine inputs')
})

test.each(['lock', 'modern module', 'reference module', 'config', 'bundle'] as const)('rejects changed %s bytes under the same revisions', change => {
  const { inventory, report } = evidence(), changed = structuredClone(report)
  if (change === 'lock') changed.fetchedArtifacts.modernLockSha256 = 'new-lock'
  if (change === 'modern module') changed.fetchedArtifacts.modernModules[0]!.sha256 = 'new-engine'
  if (change === 'reference module') changed.fetchedArtifacts.referenceModules[0]!.sha256 = 'new-reference'
  if (change === 'config') changed.fetchedArtifacts.modernThemesSourceSha256 = 'new-config'
  if (change === 'bundle') changed.fetchedArtifacts.agenticBundleSha256 = 'new-bundle'
  expect(() => resumeEngineEvidence(report, inventory, changed, inventory)).toThrow('Different engine inputs')
})

test.each(['foreign ID', 'duplicate', 'extra round', 'wrong family', 'missing attempt'] as const)('rejects %s in engine coverage', change => {
  const { inventory, report } = evidence()
  if (change === 'foreign ID') report.engines[0]!.id = 'unmeasured.md:1'
  if (change === 'duplicate') report.engines[0] = { ...report.engines[1]! }
  if (change === 'extra round') report.engines[0]!.round = 4
  if (change === 'wrong family') report.engines[0]!.family = 'sequence'
  if (change === 'missing attempt') report.engines.pop()
  expect(() => validateEngineEvidence(report, inventory)).toThrow()
})
