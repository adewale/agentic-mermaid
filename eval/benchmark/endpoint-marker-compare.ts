// bun eval/trident/run.ts source bench:endpoint-marker BASE_CHECKOUT HEAD_CHECKOUT OUT_DIR
// Both checkouts must be immutable revisions with built Node packages.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { collectSamples } from '../layout-compare/run.ts'
import { extractOfficialCorpus } from '../shared/official-fences.ts'
import { releaseBenchCases } from './release-bench-cases.ts'
import { getFamily } from '../../src/agent/families.ts'
import type { RenderOptions } from '../../src/types.ts'
import { architectureSvgMetrics } from '../endpoint-marker/architecture-metrics.ts'

interface Input { id: string; family: string; source: string; options?: RenderOptions }
type Metric = keyof ReturnType<typeof architectureSvgMetrics>['metrics']
const [baseDirectory, headDirectory, destination] = process.argv.slice(2)
if (!baseDirectory || !headDirectory || !destination) throw new Error('Expected BASE_CHECKOUT HEAD_CHECKOUT OUT_DIR')
const directories = [baseDirectory, headDirectory].map(path => resolve(path))
for (const directory of directories) {
  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src', 'package.json'], { cwd: directory, encoding: 'utf8' }).trim()
  if (dirty) throw new Error(`Production source is dirty in ${directory}`)
}
const apis = await Promise.all(directories.map(async directory => await import(pathToFileURL(`${directory}/dist/agent.js`).href) as typeof import('../../src/agent/index.ts')))
const revisions = directories.map(directory => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim())
const out = resolve(destination)
mkdirSync(out, { recursive: true })

const corpus: Input[] = [...collectSamples(), ...extractOfficialCorpus().map(input => ({ ...input, id: `official/${input.id}` }))]
const architecture: Input[] = [
  { id: 'registry/architecture', family: 'architecture', source: getFamily('architecture')!.example },
  ...releaseBenchCases().filter(input => input.family === 'architecture'),
  ...corpus.filter(input => input.family === 'architecture'),
]
for (const [from, to] of [['R', 'L'], ['L', 'R'], ['B', 'T'], ['T', 'B']]) {
  for (const junctionFirst of [true, false]) for (const custom of [false, true]) {
    const relation = junctionFirst ? `j:${from}<-->${to}:b` : `b:${from}<-->${to}:j`
    architecture.push({ id: `junction/${from}/${junctionFirst ? 'start' : 'end'}/${custom ? 'custom' : 'default'}`, family: 'architecture',
      source: custom
        ? `---\ntitle: Junction connections\n---\narchitecture-beta\ngroup outer(cloud)[Outer]\ngroup g(cloud)[Group] in outer\njunction j in g\nservice b(database)[B] in g\n${relation}\nalign ${from === 'L' || from === 'R' ? 'row' : 'column'} j b`
        : `architecture-beta\njunction j\nservice b(database)[B]\n${relation}`,
      options: { architecture: { visual: { junctionOuterRadius: custom ? 20 : 8, edgeLineWidth: custom ? 3 : 1 } } },
    })
  }
}
architecture.push({ id: 'junction/labelled-group-boundary', family: 'architecture',
  source: 'architecture-beta\ngroup g(cloud)[Group]\nservice a(server)[A] in g\njunction j\na{group}:R<-[handoff]->L:j',
})

const errors: unknown[] = []
const measurements = architecture.map(input => {
  const values = apis.map((api, index) => {
    try {
      const options = { ...input.options, embedFontImport: false, seed: 7 }
      const rendered = api.renderMermaidSVGWithReceipt(input.source, options)
      const layout = api.layoutMermaidWithReceipt(input.source, { ...options, debug: true }).layout
      const certification = rendered.receipt.layoutCertification
      if (!certification || certification.scope !== 'native-scene') throw new Error('Missing final SVG paint certificate')
      return { ...architectureSvgMetrics(rendered.svg, layout, certification), meaning: JSON.stringify({
        nodes: layout.nodes.map(node => ({ id: node.id, label: node.label, shape: node.shape, role: node.role })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        edges: layout.edges.map(edge => ({ from: edge.from, to: edge.to, label: edge.label?.text })),
        groups: layout.groups.map(group => ({ id: group.id, label: group.label, parentId: group.parentId, members: [...group.members].sort() })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      }) }
    } catch (error) {
      errors.push({ id: input.id, revision: revisions[index], error: String(error) })
      return undefined
    }
  })
  return { id: input.id, before: values[0], after: values[1] }
})
const regressions = measurements.flatMap(row => row.before && row.after
  ? Object.entries(row.before.metrics).flatMap(([metric, value]) => {
    const after = row.after!.metrics[metric as Metric]
    const coverage = ['routes', 'endpointChecks', 'markerChecks'].includes(metric)
    return (coverage ? after !== value : after > value + 1e-6) ? [{ id: row.id, metric, before: value, after }] : []
  }) : [])
const meaningChanges = measurements.filter(row => row.before && row.after && (row.before.meaning !== row.after.meaning
  || JSON.stringify(row.before.markerEndpoints) !== JSON.stringify(row.after.markerEndpoints))).map(row => row.id)
const failedContacts = measurements.filter(row => row.after && (row.after.metrics.offOutlineEndpoints || row.after.metrics.offOutlineMarkers || row.after.metrics.unverifiedMarkerBodies || row.after.metrics.routeCertificateFindings)).map(row => row.id)

// Unchanged final SVG, public geometry and paint/route certificates preserve
// every deterministic geometry metric without applying Architecture semantics
// to another family. Render refusals stay explicit, not hidden by filtering.
const preservation = corpus.map(input => {
  const values = apis.map(api => {
    try {
      const rendered = api.renderMermaidSVGWithReceipt(input.source, { embedFontImport: false, seed: 7 })
      const layout = api.layoutMermaidWithReceipt(input.source, { debug: true }).layout
      return { svg: rendered.svg, geometry: JSON.stringify(layout), certificate: JSON.stringify(rendered.receipt.layoutCertification) }
    } catch (error) { return { error: String(error) } }
  })
  const [before, after] = values
  return { id: input.id, family: input.family, beforeError: before!.error, afterError: after!.error,
    svgIdentical: before!.svg === after!.svg, geometryIdentical: before!.geometry === after!.geometry,
    certificateIdentical: before!.certificate === after!.certificate }
})
const changedUnrelated = preservation.filter(row => row.family !== 'architecture' && (!row.svgIdentical || !row.geometryIdentical || !row.certificateIdentical || row.beforeError !== row.afterError))
const lostRenders = preservation.filter(row => !row.beforeError && row.afterError)
const measured = measurements.filter(row => row.before && row.after)
const totals = (phase: 'before' | 'after') => Object.fromEntries(Object.keys(measured[0]?.[phase]?.metrics ?? {}).map(metric => {
  const values = measured.map(row => row[phase]!.metrics[metric as Metric])
  return [metric, metric.startsWith('max') ? Math.max(...values) : values.reduce((a, b) => a + b, 0)]
}))
const report = { revisions, ok: !errors.length && !regressions.length && !meaningChanges.length && !failedContacts.length && !changedUnrelated.length && !lostRenders.length,
  architecture: { enrolled: architecture.length, measured: measured.length, totals: { before: totals('before'), after: totals('after') }, regressions, meaningChanges, failedContacts, errors, measurements },
  preservation: { enrolled: corpus.length, successful: preservation.filter(row => !row.beforeError && !row.afterError).length,
    changedUnrelated, lostRenders, rows: preservation },
}
writeFileSync(`${out}/metrics.json`, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ revisions, ok: report.ok, enrolledArchitecture: architecture.length, measured: measured.length, totals: report.architecture.totals,
  regressions, meaningChanges, failedContacts, errors, unrelatedChanges: changedUnrelated.length, lostRenders: lostRenders.length }, null, 2))
process.exitCode = report.ok ? 0 : 1
