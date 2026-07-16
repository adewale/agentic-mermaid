// Self-validation for the homepage-coverage eval.
//
// Runs the deterministic reference through the oracle and asserts: (1) the
// roster spans the shipped registries, (2) the reference grades to full
// coverage, (3) the oracle actually discriminates — dropped/opaque/wrong/
// unrenderable/bad-interface manifests fail, (4) the live runner recovers a
// manifest from a raw response, and (5) the committed reference transcript
// still replays to full coverage. Exits nonzero on any failure.
//
// This lives under eval/ rather than src/__tests__/ on purpose: the repo's
// evidence-provenance receipts hash every src/**/*.ts file, so a new test file
// there would drift unrelated (browser-rendered) PNG evidence. Keeping the
// check under eval/ leaves those receipts untouched. Run it with:
//   bun run eval/homepage-coverage/check.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_FAMILY_METADATA, knownStyleDescriptors } from '../../src/agent/index.ts'
import { coverageRoster } from './roster.ts'
import { gradeCoverage, AGENT_INTERFACES, type CoverageManifest } from './oracle.ts'
import { referenceCoverageManifest } from './reference.ts'
import { extractManifest } from './live.ts'

const results: Array<{ name: string; ok: boolean; detail?: string }> = []

function check(name: string, fn: () => void): void {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (e) {
    results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) })
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

function clone(manifest: CoverageManifest): CoverageManifest {
  return JSON.parse(JSON.stringify(manifest)) as CoverageManifest
}

const roster = coverageRoster()
const reference = referenceCoverageManifest(roster)

check('roster spans every shipped family, Style, and Palette', () => {
  assert(sameList(roster.families.map(f => f.id), BUILTIN_FAMILY_METADATA.map(f => f.id)), 'families drifted from BUILTIN_FAMILY_METADATA')
  const descriptors = knownStyleDescriptors()
  assert(sameList(roster.styles, descriptors.filter(d => d.kind === 'look').map(d => d.inputName)), 'styles drifted from look descriptors')
  assert(sameList(roster.palettes, descriptors.filter(d => d.kind === 'palette').map(d => d.inputName)), 'palettes drifted from palette descriptors')
  assert(roster.styles.every(s => !roster.palettes.includes(s)), 'styles and palettes overlap')
})

check('reference manifest grades to full coverage with nothing missing', () => {
  const report = gradeCoverage(reference, roster)
  assert(report.ok, `not ok; missing: ${JSON.stringify(report.missing)}`)
  assert(report.interfaceOk, 'interface not recognised')
  assert(report.missing.families.length === 0 && report.missing.styles.length === 0 && report.missing.palettes.length === 0, 'missing entries present')
  assert(report.families.every(v => v.ok) && report.styles.every(v => v.ok) && report.palettes.every(v => v.ok), 'a per-item verdict failed')
  assert(report.families.length === roster.families.length, 'family verdict count mismatch')
})

check('oracle rejects an unknown interface (and accepts every real one)', () => {
  const bad = clone(reference)
  ;(bad as { interface: string }).interface = 'rest-api'
  assert(!gradeCoverage(bad, roster).interfaceOk && !gradeCoverage(bad, roster).ok, 'unknown interface passed')
  for (const name of AGENT_INTERFACES) {
    assert(gradeCoverage({ ...reference, interface: name }, roster).interfaceOk, `real interface ${name} rejected`)
  }
})

check('oracle reports a missing family instance', () => {
  const bad = clone(reference)
  delete (bad.families as Record<string, string>).pie
  const report = gradeCoverage(bad, roster)
  assert(!report.ok && report.missing.families.includes('pie'), 'missing family not reported')
})

check('oracle rejects a bodyless (unverifiable, non-structured) family instance', () => {
  const bad = clone(reference)
  ;(bad.families as Record<string, string>).pie = 'pie'
  const verdict = gradeCoverage(bad, roster).families.find(v => v.id === 'pie')
  assert(verdict !== undefined && !verdict.ok, 'bodyless pie counted as covered')
})

check('oracle rejects a right-source-wrong-family instance', () => {
  const bad = clone(reference)
  ;(bad.families as Record<string, string>).state = 'flowchart TD\n  A --> B'
  const verdict = gradeCoverage(bad, roster).families.find(v => v.id === 'state')
  assert(verdict !== undefined && !verdict.ok && (verdict.reason ?? '').includes('wrong family'), 'wrong-family instance counted as covered')
})

check('oracle rejects a Style probe that cannot render', () => {
  const bad = clone(reference)
  const style = roster.styles[0]!
  ;(bad.styles as Record<string, { source: string }>)[style] = { source: 'not a diagram at all' }
  const report = gradeCoverage(bad, roster)
  assert(!report.ok && report.missing.styles.includes(style), 'unrenderable Style counted as covered')
})

check('oracle reports a missing Palette probe', () => {
  const bad = clone(reference)
  const palette = roster.palettes[0]!
  delete (bad.palettes as Record<string, unknown>)[palette]
  const report = gradeCoverage(bad, roster)
  assert(!report.ok && report.missing.palettes.includes(palette), 'missing Palette not reported')
})

check('live runner recovers a manifest from a raw model response', () => {
  const fenced = `Here you go:\n\n\`\`\`json\n${JSON.stringify(reference)}\n\`\`\`\n`
  assert(gradeCoverage(extractManifest(fenced), roster).ok, 'fenced-JSON manifest did not grade to full coverage')
  const bare = extractManifest(JSON.stringify(reference))
  assert(bare.interface === 'sdk' && sameList(Object.keys(bare.families), Object.keys(reference.families)), 'bare-JSON manifest not recovered')
  let threw = false
  try { extractManifest('no interface here, sorry') } catch { threw = true }
  assert(threw, 'a response with no JSON manifest did not throw')
})

check('committed reference transcript replays to full coverage', () => {
  const path = join(import.meta.dir, 'transcripts', 'reference', 'transcript.json')
  const transcript = JSON.parse(readFileSync(path, 'utf8')) as {
    provider: string
    roster: { families: string[]; styles: string[]; palettes: string[] }
    manifest: CoverageManifest
    report: { ok: boolean }
  }
  assert(sameList(transcript.roster.families, roster.families.map(f => f.id)), 'stored family snapshot drifted — rerun --record-reference')
  assert(sameList(transcript.roster.styles, roster.styles), 'stored Style snapshot drifted — rerun --record-reference')
  assert(sameList(transcript.roster.palettes, roster.palettes), 'stored Palette snapshot drifted — rerun --record-reference')
  const report = gradeCoverage(transcript.manifest, roster)
  assert(report.ok && report.missing.families.length === 0, 'stored manifest no longer grades to full coverage')
  assert(transcript.provider === 'reference' && transcript.report.ok, 'stored transcript provenance is not the passing reference')
})

const failed = results.filter(r => !r.ok)
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (import.meta.main) process.exit(failed.length === 0 ? 0 : 1)
