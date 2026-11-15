import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { decodeXML } from 'entities'
import { canonical, harvestModernCorpus, type Sample } from './corpus.ts'
import { admitModernReference, type ReferenceReply as Reference, startModernReference } from './reference.ts'
import { labelCensus } from './label-census.ts'
import { BUILTIN_FAMILY_METADATA } from '../../src/agent/families.ts'
import { officialCorpusInventory } from '../shared/official-fences.ts'
import type { ParsedDiagram } from '../../src/agent/types.ts'

interface Local {
  parseOk: boolean
  kind?: string
  representation?: 'structured' | 'opaque' | 'preserved'
  error?: string
  verifyOk?: boolean
  warnings?: Array<{ code: string; message: string }>
  verifyError?: string
  renderOk?: boolean
  renderError?: string
  deterministic?: boolean
  finiteSvg?: boolean
  svgBytes?: number
  missingSvgLabels?: string[]
  serialized?: string
  serializeError?: string
  serializedReference?: Reference
  changedGetters?: string[]
  snapshotExcludedGetters?: string[]
  snapshotComparison?: 'same' | 'drift-candidate' | 'unavailable'
  sameReferenceFamily?: boolean
  labelCensus?: ReturnType<typeof labelCensus>
}
interface Outcome extends Sample {
  family: string
  reference: Reference
  referenceRepeat?: Reference
  agentic: Local
  pele?: { renderOk: boolean; error?: string; finiteSvg?: boolean; deterministic?: boolean }
}
interface FamilySummary {
  family: string
  samples: number
  upstreamAccepted: number
  upstreamRejected: number
  nativeParsed: number
  structured: number
  opaque: number
  preserved: number
  verifyOk: number
  rendered: number
  deterministicFinite: number
  serializedAccepted: number
  serializedFamilyMatch: number
  snapshotComparable: number
  snapshotSame: number
  snapshotDriftCandidates: number
  peleRendered: number | null
}

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const target = resolve(process.env.AM_MODERN_TARGET_DIR ?? ROOT)
const { knownBuiltinFamilies, parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } = await import(pathToFileURL(join(target, 'src/agent/core.ts')).href) as typeof import('../../src/agent/core.ts')
const nativeFamilies = new Set<string>(knownBuiltinFamilies())
const argv = process.argv.slice(2)
function option(name: string, fallback?: string): string {
  const at = argv.indexOf(name)
  if (at < 0) {
    if (fallback !== undefined) return fallback
    throw new Error(`Required: ${name}`)
  }
  const value = argv[at + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing value: ${name}`)
  return value
}
if (argv.includes('--help')) {
  console.log('bun run eval/mermaid-modern-compat/run.ts --mermaid-dir PATH --reference-dir PATH [--pele-dir PATH] [--specs] [--labels] [--label-baseline PATH] [--fuzz 100] [--seed 7] [--output PATH]')
  process.exit(0)
}
const upstream = resolve(option('--mermaid-dir'))
const referenceDir = resolve(option('--reference-dir'))
const output = resolve(option('--output', join(HERE, 'output')))
const fuzzCount = Number(option('--fuzz', '0'))
const seed = Number(option('--seed', '7'))
if (!Number.isSafeInteger(fuzzCount) || fuzzCount < 0 || fuzzCount > 100_000) throw new Error('--fuzz must be an integer from 0 through 100000')
if (!Number.isSafeInteger(seed)) throw new Error('--seed must be an integer')
const referenceAdmission = admitModernReference(upstream, referenceDir)
const referencePackage = { version: referenceAdmission.version }
const git = (dir: string, ...args: string[]): string => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
const agenticCommit = git(target, 'rev-parse', 'HEAD')
const agenticDirty = Boolean(git(target, 'status', '--porcelain'))
const upstreamCommit = referenceAdmission.commit
const upstreamTags = referenceAdmission.tags

const { corpus, expectedFamilies, docFiles, skippedInterpolatedTemplates } = harvestModernCorpus(upstream, argv.includes('--specs'))
if (argv.includes('--labels')) {
  const bySource = new Map([...corpus.values()].map(sample => [sample.source.trim(), sample]))
  const enroll = (sample: Sample): void => {
    const previous = bySource.get(sample.source.trim())
    if (previous) previous.provenance.push(...sample.provenance)
    else { corpus.set(sample.id, sample); bySource.set(sample.source.trim(), sample) }
  }
  for (const family of BUILTIN_FAMILY_METADATA) enroll({ id: `registry-${family.id}`, source: family.example, provenance: [{ kind: 'authored', file: 'FamilyDescriptor.example', line: 1, familyHint: family.id }] })
  for (const fence of officialCorpusInventory().occurrences) enroll({ id: `official-${fence.id}`, source: fence.source, provenance: [{ kind: 'docs', file: fence.file, line: fence.line, familyHint: fence.family }] })
  const bench = JSON.parse(readFileSync(join(ROOT, 'eval/mermaid-upstream-suite-bench/cases.json'), 'utf8')) as Array<{ id: string; family: string; source: string }>
  for (const sample of bench) enroll({ id: `bench-${sample.id}`, source: sample.source, provenance: [{ kind: 'spec', file: 'eval/mermaid-upstream-suite-bench/cases.json', line: 1, familyHint: sample.family }] })
  const legacy = JSON.parse(readFileSync(join(ROOT, 'eval/mermaid-docs-corpus/corpus.json'), 'utf8')) as Array<{ family: string; source: string; origin: string; index: number }>
  for (const sample of legacy) enroll({ id: `legacy-docs-${sample.family}-${sample.index}`, source: sample.source, provenance: [{ kind: 'docs', file: sample.origin, line: sample.index, familyHint: sample.family }] })
}

const oracle = startModernReference(referenceDir)
let pele: { render(source: string): { svg: string } } | undefined
const peleDir = argv.includes('--pele-dir') ? resolve(option('--pele-dir')) : undefined
if (peleDir) {
  const entry = existsSync(join(peleDir, 'dist/pele.js')) ? join(peleDir, 'dist/pele.js') : join(peleDir, 'src/index.ts')
  pele = (await import(pathToFileURL(entry).href)) as typeof pele
}
const errorText = (error: unknown): string => String(error instanceof Error ? error.message : error).slice(0, 3000)
function finiteSvg(svg: string): boolean {
  if (!/<svg\b/.test(svg) || !/<\/svg>\s*$/.test(svg)) return false
  // Check coordinate-bearing attributes, not label text containing words such as Infinity.
  return !/\b(?:d|points|transform|viewBox|x|y|x1|x2|y1|y2|width|height|cx|cy|rx|ry|r)\s*=\s*["'][^"']*\b(?:NaN|[-+]?Infinity)\b/i.test(svg)
}
function assessStandaloneRender(sample: Sample, local: Local): string | undefined {
  try {
    const svg = renderMermaidSVG(sample.source, { security: 'strict' })
    local.renderOk = true
    delete local.renderError
    local.finiteSvg = finiteSvg(svg)
    local.deterministic = svg === renderMermaidSVG(sample.source, { security: 'strict' })
    local.svgBytes = Buffer.byteLength(svg)
    if (sample.expectedSvgLabels) {
      const labels = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => decodeXML(match[1]!.replace(/<[^>]*>/g, '')).trim())
      local.missingSvgLabels = sample.expectedSvgLabels.filter(label => !labels.includes(label))
    }
    return svg
  } catch (error) {
    local.renderOk = false
    local.renderError = errorText(error)
  }
}
async function assess(sample: Sample): Promise<Outcome> {
  const reference = await oracle.parse(sample.source)
  // A repeat of the unchanged original identifies volatile getter snapshots.
  // Such getters cannot support a serialization drift claim.
  const referenceRepeat = reference.ok ? await oracle.parse(sample.source) : undefined
  const family = reference.ok ? canonical(reference.type) : sample.provenance[0]!.familyHint
  const local: Local = { parseOk: false }
  let diagram: ParsedDiagram | undefined
  try {
    const parsed = parseRegisteredMermaid(sample.source)
    local.parseOk = parsed.ok
    if (!parsed.ok) local.error = parsed.error.map(error => `${error.code}: ${error.message}`).join('; ')
    else {
      const value = parsed.value
      diagram = value
      local.kind = value.kind
      local.representation = value.body.kind === 'preserved' ? 'preserved' : value.body.kind === 'opaque' ? 'opaque' : 'structured'
      try {
        const verification = verifyMermaid(value)
        local.verifyOk = verification.ok
        local.warnings = verification.warnings.map(warning => ({ code: warning.code, message: 'message' in warning ? String(warning.message) : JSON.stringify(warning) }))
      } catch (error) {
        local.verifyError = errorText(error)
      }
      try {
        local.serialized = serializeMermaid(value)
        local.serializedReference = await oracle.parse(local.serialized)
        if (reference.ok && referenceRepeat?.ok && local.serializedReference.ok) {
          local.sameReferenceFamily = canonical(reference.type) === canonical(local.serializedReference.type)
          const before = reference.snapshot.data,
            after = local.serializedReference.snapshot.data
          const control = referenceRepeat.snapshot.data
          local.snapshotExcludedGetters = [...new Set([...Object.keys(before), ...Object.keys(control)])].filter(key => JSON.stringify(before[key]) !== JSON.stringify(control[key])).sort()
          const excluded = new Set(local.snapshotExcludedGetters)
          const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !excluded.has(key)).sort()
          local.changedGetters = keys.filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
          local.snapshotComparison = keys.length ? (local.changedGetters.length || !local.sameReferenceFamily ? 'drift-candidate' : 'same') : 'unavailable'
        } else local.snapshotComparison = 'unavailable'
      } catch (error) {
        local.serializeError = errorText(error)
      }
    }
  } catch (error) {
    local.error = errorText(error)
  }
  // Public SVG rendering has its own contract. A structured-parser rejection
  // must not prevent us from checking the standalone renderer.
  const svg = assessStandaloneRender(sample, local)
  if (argv.includes('--labels') && diagram) local.labelCensus = labelCensus(family, reference, diagram, svg)
  const outcome: Outcome = { ...sample, family, reference, ...(referenceRepeat ? { referenceRepeat } : {}), agentic: local }
  if (pele) {
    try {
      const svg = pele.render(sample.source).svg
      outcome.pele = { renderOk: true, finiteSvg: finiteSvg(svg), deterministic: svg === pele.render(sample.source).svg }
    } catch (error) {
      outcome.pele = { renderOk: false, error: errorText(error) }
    }
  }
  return outcome
}

function summarize(outcomes: Outcome[]): FamilySummary[] {
  const families = [...new Set([...expectedFamilies, 'info', ...outcomes.map(result => result.family)])].sort()
  return families.map(family => {
    const all = outcomes.filter(result => result.family === family),
      valid = all.filter(result => result.reference.ok)
    const count = (predicate: (result: Outcome) => boolean): number => valid.filter(predicate).length
    return {
      family,
      samples: all.length,
      upstreamAccepted: valid.length,
      upstreamRejected: all.length - valid.length,
      nativeParsed: count(result => result.agentic.parseOk && result.agentic.representation !== 'preserved'),
      structured: count(result => result.agentic.representation === 'structured'),
      opaque: count(result => result.agentic.representation === 'opaque'),
      preserved: count(result => result.agentic.representation === 'preserved'),
      verifyOk: count(result => result.agentic.verifyOk === true),
      rendered: count(result => result.agentic.renderOk === true),
      deterministicFinite: count(result => !!result.agentic.renderOk && !!result.agentic.finiteSvg && !!result.agentic.deterministic),
      serializedAccepted: count(result => result.agentic.serializedReference?.ok === true),
      serializedFamilyMatch: count(result => result.agentic.sameReferenceFamily === true),
      snapshotComparable: count(result => result.agentic.snapshotComparison !== undefined && result.agentic.snapshotComparison !== 'unavailable'),
      snapshotSame: count(result => result.agentic.snapshotComparison === 'same'),
      snapshotDriftCandidates: count(result => result.agentic.snapshotComparison === 'drift-candidate'),
      peleRendered: pele ? count(result => result.pele?.renderOk === true) : null,
    }
  })
}

const outcomes: Outcome[] = []
console.log(`Mermaid ${referencePackage.version} (${upstreamCommit.slice(0, 12)}), ${corpus.size} deduplicated inputs; checking public Agentic Mermaid surfaces`)
try {
  for (const sample of corpus.values()) {
    outcomes.push(await assess(sample))
    if (outcomes.length % 100 === 0) console.log(`Assessed ${outcomes.length}/${corpus.size}`)
  }
  const authored = JSON.parse(readFileSync(join(HERE, 'authored-probes.json'), 'utf8')) as Array<{ id: string; family: string; source: string; upstream: string; expectedSvgLabels?: string[] }>
  for (const probe of authored) {
    outcomes.push(await assess({ id: `authored-${probe.id}`, source: probe.source, provenance: [{ kind: 'authored', file: probe.upstream, line: 1, familyHint: probe.family }], ...(probe.expectedSvgLabels ? { expectedSvgLabels: probe.expectedSvgLabels } : {}) }))
  }
  let state = seed >>> 0
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  const seeds = outcomes.filter(result => result.reference.ok && result.source.length <= 4000)
  const fragments = ['\n', ' ', ';', '-->', 'end', '"', '%%', '{', '}', '[', ']', 'é', ':', 'classDef ', 'title ', '\r\n']
  for (let i = 0; i < fuzzCount && seeds.length; i++) {
    const parent = seeds[Math.floor(random() * seeds.length)]!,
      at = Math.floor(random() * (parent.source.length + 1))
    const fragment = fragments[Math.floor(random() * fragments.length)]!
    const source = random() < 0.5 ? parent.source.slice(0, at) + fragment + parent.source.slice(at) : parent.source.slice(0, at) + parent.source.slice(at + 1 + Math.floor(random() * 3))
    outcomes.push(await assess({ id: `mutation-${seed}-${i}`, source, provenance: [{ kind: 'mutation', file: '<seeded mutation>', line: i + 1, familyHint: parent.family, parent: parent.id }] }))
  }
} finally {
  oracle.close()
}

mkdirSync(output, { recursive: true })
const base = outcomes.filter(result => result.provenance.some(origin => origin.kind === 'docs' || origin.kind === 'probe'))
const specs = outcomes.filter(result => result.provenance.some(origin => origin.kind === 'spec'))
const authored = outcomes.filter(result => result.provenance[0]!.kind === 'authored')
const mutations = outcomes.filter(result => result.provenance[0]!.kind === 'mutation')
const families = summarize(base),
  valid = base.filter(result => result.reference.ok)
const nativeRows = families.filter(row => nativeFamilies.has(row.family) && row.upstreamAccepted > 0)
const summary = {
  schemaVersion: 1,
  provenance: {
    generatedAt: new Date().toISOString(),
    mermaidVersion: referencePackage.version,
    referenceParserVersion: referenceAdmission.parserVersion,
    referenceDomVersion: referenceAdmission.domVersion,
    upstreamCommit,
    upstreamTags,
    agenticCommit,
    agenticDirty,
    agenticTarget: target,
    agenticCommitAtCompletion: git(target, 'rev-parse', 'HEAD'),
    agenticDirtyAtCompletion: Boolean(git(target, 'status', '--porcelain')),
    peleCommit: peleDir ? git(peleDir, 'rev-parse', 'HEAD') : null,
    referenceDom: 'jsdom; real DOMPurify; parser/DB only, no reference rendering',
    args: argv,
  },
  methodology: {
    docs: docFiles,
    expectedCoreFamilies: expectedFamilies.size,
    includesInfoProbe: true,
    includesSpecs: argv.includes('--specs'),
    skippedInterpolatedTemplates,
    seed,
    fuzzRequested: fuzzCount,
    fuzzRun: mutations.length,
    snapshotWarning:
      'Getter differences are conservative drift candidates, not proof of semantic loss. A repeated original-source parse excludes getters unstable in the control. Generated IDs, defaults, ordering and parser normalization may still differ. Unchanged snapshots do not prove visual or semantic fidelity. Opaque/preserved acceptance is separate from structured support.',
  },
  totals: {
    samples: base.length,
    upstreamAccepted: valid.length,
    upstreamRejected: base.length - valid.length,
    coreFamilies: expectedFamilies.size,
    nativeFamilies: [...nativeFamilies].sort(),
    nativeFamiliesWithAcceptedInput: nativeRows.length,
    nativeFamilyBalancedRenderRate: nativeRows.length ? nativeRows.reduce((sum, row) => sum + row.rendered / row.upstreamAccepted, 0) / nativeRows.length : null,
    rendered: valid.filter(result => result.agentic.renderOk).length,
    structured: valid.filter(result => result.agentic.representation === 'structured').length,
    opaque: valid.filter(result => result.agentic.representation === 'opaque').length,
    preserved: valid.filter(result => result.agentic.representation === 'preserved').length,
    snapshotDriftCandidates: valid.filter(result => result.agentic.snapshotComparison === 'drift-candidate').length,
    peleRendered: pele ? valid.filter(result => result.pele?.renderOk).length : null,
  },
  families,
  specs: { samples: specs.length, families: summarize(specs) },
  authored: { samples: authored.length, families: summarize(authored), renderContentViolations: authored.filter(result => result.agentic.missingSvgLabels?.length).map(result => ({ id: result.id, missingLabels: result.agentic.missingSvgLabels })) },
  mutations: {
    samples: mutations.length,
    upstreamAccepted: mutations.filter(result => result.reference.ok).length,
    upstreamRejected: mutations.filter(result => !result.reference.ok).length,
    families: summarize(mutations),
    note: 'Permissive local acceptance of upstream-rejected mutations is recorded, never treated as a fatal failure.',
  },
}
writeFileSync(join(output, 'cases.json'), JSON.stringify(outcomes, null, 2) + '\n')
writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
if (argv.includes('--labels')) {
  const cases = outcomes.map(result => ({ id: result.id, family: result.family, source: result.source, provenance: result.provenance, referenceAccepted: result.reference.ok, census: result.agentic.labelCensus ?? { status: 'unavailable', reason: result.agentic.error ?? 'Local source was not parsed' } }))
  const baseline = argv.includes('--label-baseline') ? JSON.parse(readFileSync(resolve(option('--label-baseline')), 'utf8')) as { cases: typeof cases } : undefined
  const before = new Map(baseline?.cases.map(result => [result.source.trim(), result]) ?? [])
  const changes = cases.flatMap(result => {
    const previous = before.get(result.source.trim())
    if (!previous || previous.census.status !== 'measured' || result.census.status !== 'measured') return []
    const old = new Map(previous.census.labels.map(label => [label.path, label]))
    return result.census.labels.flatMap(label => {
      const prior = old.get(label.path)
      return prior && JSON.stringify(prior) !== JSON.stringify(label) ? [{ id: result.id, family: result.family, path: label.path, before: prior, after: label }] : []
    })
  })
  const surfaceChanges = cases.flatMap(result => {
    const previous = before.get(result.source.trim())
    if (!previous || previous.census.status !== 'measured' || result.census.status !== 'measured') return []
    const previousSurfaces = previous.census.surfaces
    return Object.entries(result.census.surfaces).flatMap(([surface, value]) => {
      const prior = previousSurfaces[surface]
      return JSON.stringify(prior) === JSON.stringify(value) ? [] : [{ id: result.id, family: result.family, surface, before: prior, after: value }]
    })
  })
  writeFileSync(join(output, 'label-census.json'), JSON.stringify({
    schemaVersion: 1, provenance: summary.provenance,
    methodology: 'Every enrolled docs, official-fence, upstream-bench and registry input is retained, including rejected and unsupported cases. Raw independent getter labels and local surface values accompany existential text-presence diagnostics. Missing text requires semantic review; presence does not prove identity, multiplicity or equivalent drawing. Metrics expose aggregate counts only.',
    totals: { cases: cases.length, referenceAccepted: cases.filter(result => result.referenceAccepted).length, measured: cases.filter(result => result.census.status === 'measured').length, unavailable: cases.filter(result => result.census.status !== 'measured').length },
    comparison: baseline ? { status: 'measured', baseline: resolve(option('--label-baseline')), changes, surfaceChanges } : { status: 'unavailable', reason: 'No --label-baseline report supplied' },
    cases,
  }, null, 2) + '\n')
}
console.table(families.map(row => ({ family: row.family, valid: row.upstreamAccepted, invalid: row.upstreamRejected, structured: row.structured, opaque: row.opaque, rendered: row.rendered, serializedValid: row.serializedAccepted, drift: row.snapshotDriftCandidates, ...(pele ? { pele: row.peleRendered } : {}) })))
console.log(`${summary.totals.rendered}/${valid.length} upstream-valid inputs rendered; ${summary.totals.structured} structured, ${summary.totals.opaque} opaque, ${summary.totals.preserved} preserved; ${summary.totals.upstreamRejected} upstream-rejected inputs excluded from support denominator`)
console.log(`Saved ${join(output, 'summary.json')} and cases.json`)
