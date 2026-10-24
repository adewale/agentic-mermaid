import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ENGINES as engines, validateEngineEvidence } from './evidence.mjs'

const out = resolve(process.argv[2] ?? '.')
const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
const inventory = JSON.parse(readFileSync(join(out, 'inventory.json'), 'utf8'))
if (report.status !== 'completed') throw new Error('Application probes are incomplete')
validateEngineEvidence(report, inventory)
const catalog = report.catalog.themes
for (const [name, rows] of [['themes', report.themes], ['themeSharing', report.themeSharing]]) {
  if (!Array.isArray(rows) || rows.length !== catalog.length || new Set(rows.map(row => row.theme)).size !== catalog.length
    || rows.some(row => !catalog.includes(row.theme))) throw new Error(`Incomplete ${name} evidence; rerun the application theme probes`)
}
if (report.themes.some(row => row.ok && row.activeTheme !== row.theme)) throw new Error('Theme success requires the requested active theme')
if (report.themeSharing.some(row => row.ok && (row.sharedTheme !== row.theme || row.restoredTheme !== row.theme))) throw new Error('Theme sharing success requires preserved and restored theme identity')
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1]
const accepted = Object.fromEntries(engines.map(engine => {
  const rows = report.engines.filter(row => row.engine === engine)
  return [engine, new Set(inventory.occurrences.filter(input => rows.filter(row => row.id === input.id && row.ok).length === 3).map(input => input.id))]
}))
const totals = (engine, ids) => [1, 2, 3].map(round => report.engines.filter(row => row.engine === engine && row.round === round && (!ids || ids.has(row.id))).reduce((sum, row) => sum + row.ms, 0))
const comparisons = ['modern', 'reference'].map(peer => {
  const ids = new Set([...accepted.agentic].filter(id => accepted[peer].has(id)))
  const candidateMs = totals('agentic', ids), peerMs = totals(peer, ids)
  return { peer, occurrences: ids.size, candidateMs, peerMs, peerOverAgenticMedianRatio: median(peerMs.map((ms, i) => ms / candidateMs[i])) }
})
const families = [...new Set(inventory.occurrences.map(input => input.family))].map(family => {
  const inputs = inventory.occurrences.filter(input => input.family === family)
  return { family, population: inputs.length, ...Object.fromEntries(engines.map(engine => [engine, inputs.filter(input => accepted[engine].has(input.id)).length])) }
})
const summary = {
  measuredAt: report.date, revisions: report.revisions, environment: report.environment,
  engineMeasuredAt: report.engineMeasuredAt ?? report.date, engineEnvironment: report.engineEnvironment ?? report.environment,
  population: inventory.occurrences.length, distinctSources: inventory.distinctCount,
  acceptance: engines.map(engine => ({ engine, accepted: accepted[engine].size, distinctAccepted: new Set(inventory.occurrences.filter(input => accepted[engine].has(input.id)).map(input => input.source.trim())).size, attemptRoundMs: totals(engine) })),
  comparisons, families,
  startup: { ms: report.startupMs, files: report.startupPayload.length, ...Object.fromEntries(['raw', 'gzip', 'brotli'].map(key => [key, report.startupPayload.reduce((sum, row) => sum + row[key], 0)])) },
  editor: [5, 50, 150].map(nodes => {
    const samples = report.editor.filter(row => row.nodes === nodes && row.rep > 0)
    return { nodes, samples: samples.length, allOK: samples.every(row => row.ok), medianMs: median(samples.map(row => row.ms)), maxTimerGapMs: Math.max(...samples.map(row => row.maxTimerGapMs)) }
  }),
  examples: { accepted: report.examples.filter(row => row.ok).length, total: report.examples.length },
  themes: { accepted: report.themes.filter(row => row.ok).length, total: report.themes.length },
  themeSharing: { accepted: report.themeSharing.filter(row => row.ok).length, total: report.themeSharing.length, failures: report.themeSharing.filter(row => !row.ok) },
  themeMeasuredAt: report.themeMeasuredAt,
  themeFamilyMatrix: { accepted: report.themeFamilyMatrix.filter(row => row.ok).length, total: report.themeFamilyMatrix.length },
  exports: report.exports, probes: report.probes,
  modernOnly: inventory.occurrences.filter(input => accepted.modern.has(input.id) && !accepted.agentic.has(input.id)).map(input => ({ ...input, error: report.engines.find(row => row.engine === 'agentic' && row.id === input.id && !row.ok)?.error })),
}
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
