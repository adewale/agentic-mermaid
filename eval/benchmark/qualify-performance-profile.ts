import './ci-policy-enforce.ts'
// Correctness qualification, never a speed benchmark. Every official fence
// remains accounted for; exact duplicate sources reuse the same observation.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { decodeXML } from 'entities'
import { renderMermaidASCII, renderMermaidSVGWithReceipt } from '../../src/index.ts'
import { PERFORMANCE_EXPERIMENTS, withPerformanceExperiments, type PerformanceExperiment } from '../../src/experimental-performance.ts'
import { isIndexedForestGraph } from '../../src/experimental/indexed-forest.ts'
import { normalizeMermaidSource } from '../../src/mermaid-source.ts'
import { parseMermaid } from '../../src/parser.ts'
import { scanSvgStartTags, decodedSvgAttributeValue } from '../../src/svg-structure.ts'
import { officialCorpusInventory } from '../shared/official-fences.ts'
import { workingRevision } from './revision-tree.ts'

const options = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]!, value = process.argv[i + 1]
  if (!['--features', '--out'].includes(key) || value === undefined || options.has(key)) throw Error(`Invalid option ${key}`)
  options.set(key, value)
}
const features = (options.get('--features') ?? 'indexed-layout').split(',') as PerformanceExperiment[]
if (features.some(name => !PERFORMANCE_EXPERIMENTS.includes(name)) || new Set(features).size !== features.length) throw Error('Invalid profile')
const out = resolve(options.get('--out') ?? 'bench-report/profile-qualification.json')
const inventory = officialCorpusInventory()
const inputs = new Map<string, { id: string; occurrences: number }>()
for (const input of inventory.occurrences) {
  const key = input.source.trim(), prior = inputs.get(key)
  if (prior) prior.occurrences++
  else inputs.set(key, { id: input.id, occurrences: 1 })
}
const texts = (svg: string) => [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
  .map(match => decodeXML(match[1]!.replace(/<[^>]*>/g, ''))).sort()
const identities = (svg: string) => scanSvgStartTags(svg).flatMap(tag => {
  const id = decodedSvgAttributeValue(tag, 'data-id')
  return id === undefined ? [] : [JSON.stringify([id, ...['data-role', 'data-from', 'data-to'].map(key => decodedSvgAttributeValue(tag, key))])]
}).sort()
function render(source: string, flags: readonly PerformanceExperiment[]) {
  return withPerformanceExperiments(flags, () => {
    try {
      const result = renderMermaidSVGWithReceipt(source)
      return { ok: true as const, svg: result.svg, receipt: JSON.stringify(result.receipt), bytes: Buffer.byteLength(result.svg) }
    } catch (error) { return { ok: false as const, error: String(error) } }
  })
}
const rows = []
for (const [source, input] of inputs) {
  const before = render(source, []), after = render(source, features)
  let eligible = false
  if (features.includes('indexed-layout')) {
    try {
      const normalized = normalizeMermaidSource(source)
      eligible = /^(?:graph|flowchart)\b/i.test(normalized.familyText) && isIndexedForestGraph(parseMermaid(normalized.familyText))
    } catch { /* the public outcome below owns rejection */ }
  }
  const failures: string[] = []
  if (before.ok && !after.ok) failures.push(`new rejection: ${after.error}`)
  if (!before.ok && !after.ok && before.error !== after.error && !eligible) failures.push('changed rejection')
  if (before.ok && after.ok) {
    if (JSON.stringify(texts(before.svg)) !== JSON.stringify(texts(after.svg))) failures.push('changed displayed text')
    if (JSON.stringify(identities(before.svg)) !== JSON.stringify(identities(after.svg))) failures.push('changed semantic identities or endpoints')
    if (!eligible && (before.svg !== after.svg || before.receipt !== after.receipt)) failures.push('changed output outside the forest cohort')
    const again = render(source, features)
    if (!again.ok || again.svg !== after.svg || again.receipt !== after.receipt) failures.push('nondeterministic SVG or receipt')
    if (before.svg !== after.svg) {
      const parses = (svg: string) => { try { new Resvg(svg, { font: { loadSystemFonts: false } }); return true } catch { return false } }
      if (parses(before.svg) && !parses(after.svg)) failures.push('new invalid SVG')
    }
  }
  const terminal = (flags: readonly PerformanceExperiment[]) => withPerformanceExperiments(flags, () => {
    try { return { ok: true, output: renderMermaidASCII(source, { colorMode: 'none' }) } }
    catch (error) { return { ok: false, output: String(error) } }
  })
  if (JSON.stringify(terminal([])) !== JSON.stringify(terminal(features))) failures.push('changed terminal outcome')
  rows.push({ ...input, eligible, before: before.ok, after: after.ok, changed: before.ok && after.ok && before.svg !== after.svg, failures,
    ...(!after.ok ? { error: after.error } : {}) })
  if (rows.length % 50 === 0) console.log(`${rows.length}/${inputs.size} distinct sources checked`)
}
const failures = rows.filter(row => row.failures.length)
const report = { revision: workingRevision(), features, assertions: process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS,
  occurrences: inventory.occurrenceCount, distinct: inputs.size, eligible: rows.filter(row => row.eligible).length,
  baselineAccepted: rows.filter(row => row.before).length, candidateAccepted: rows.filter(row => row.after).length,
  changed: rows.filter(row => row.changed).length, ok: failures.length === 0, rows }
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ ...report, rows: undefined, failures }, null, 2))
if (failures.length) process.exitCode = 1
