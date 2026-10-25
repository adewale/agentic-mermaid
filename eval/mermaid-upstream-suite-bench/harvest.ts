import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { plainTextFromInlineFormatting } from '../../src/shared/inline-format.ts'
import { compareCodePointStrings } from '../../src/shared/deterministic-order.ts'
import { asArchitecture, asC4, asClass, asEr, asFlowchart, asGantt, asJourney, asPie, asQuadrant, asRadar, asSankey, asSequence, asState, asTimeline, asXyChart, layoutMermaid, parseRegisteredMermaid as parseMermaid, serializeMermaid, verifyMermaid } from '../../src/agent/index.ts'
import type { DiagramKind, ParsedDiagram, ValidDiagram } from '../../src/agent/types.ts'

// This dated harvest's adapters define its scope; new native families have
// separate exact-pin benches rather than rewriting historical provenance.
type Family = keyof typeof narrowers

interface FamilyConfig {
  family: Family
  consideredBlocks: number
  files: Array<{ path: string; testBlocks: number }>
  companionBench?: string
}

interface TestBlock {
  family: Family
  file: string
  name: string
  body: string
  skipped: boolean
}

interface BenchCase {
  id: string
  family: Family
  source: string
  upstream: { repo: 'mermaid-js/mermaid'; files: string[]; blocks: string[] }
  assertions: {
    expectStructured?: boolean
    nodeCount?: number
    edgeCount?: number
    groupCount?: number
    minNodes?: number
    minEdges?: number
    minGroups?: number
    labelsContain?: string[]
  }
}

interface GapTracking {
  issue: string
  owner: 'BUILD-20'
  lane: string
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  target: 'convert-to-case'
}

interface Exclusion {
  id: string
  families: Family[]
  reason: string
  disposition?: 'WONTFIX'
  summary: string
  blockCount: number
  tracking?: GapTracking
  upstream?: { repo: 'mermaid-js/mermaid'; files: string[]; blocks: string[] }
  source?: string
  ours?: { parseOk?: boolean; structured?: boolean; verifyOk?: boolean; layoutOk?: boolean; roundtripOk?: boolean }
}

interface PinnedCompanionOracle {
  upstream: {
    commit: string
    files: Array<{ family: 'mindmap' | 'gitgraph'; path: string; testBlocks: number }>
  }
  accounting: Record<
    'mindmap' | 'gitgraph',
    {
      consideredBlocks: number
      importedCases: number
      importedBlocks: number
      excludedBlocks: number
      deferredBlocks: number
    }
  >
}

interface LocalGapBudget {
  totalBlocks: number
  byReason: Record<string, number>
  byFamily: Record<string, number>
  byFamilyReason: Record<string, Record<string, number>>
}

interface Ratchet {
  version: 1
  upstreamRevision: string
  budgets: {
    importedCaseFloor: number
    importedBlockFloor: number
    localGaps: LocalGapBudget
  }
  observed: {
    importedCases: number
    importedBlocks: number
    localGaps: LocalGapBudget
  }
}

const ROOT = process.cwd()
const BENCH = join(ROOT, 'eval/mermaid-upstream-suite-bench')
const OUTPUT = resolve(process.env.MERMAID_HARVEST_OUTPUT_DIR ?? BENCH)
const UPSTREAM = resolve(process.env.MERMAID_UPSTREAM_DIR ?? join(ROOT, '../upstream-mermaid'))
const UPSTREAM_REVISION = 'a2d9686451df7c4644a3eeca20535bbd4c5776b0'
const UPSTREAM_REPO = 'mermaid-js/mermaid' as const
const PINNED_COMPANION_PATH = join(BENCH, 'mindmap-gitgraph-f3dea583.json')
const PINNED_COMPANION = JSON.parse(readFileSync(PINNED_COMPANION_PATH, 'utf8')) as PinnedCompanionOracle
const PINNED_FAMILIES = ['mindmap', 'gitgraph'] as const

const FAMILY_CONFIGS: Array<Omit<FamilyConfig, 'consideredBlocks' | 'files'> & { files: Array<{ path: string }> }> = [
  {
    family: 'flowchart',
    files: [
      { path: 'packages/mermaid/src/diagrams/flowchart/flowChartShapes.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/flowDb.spec.ts' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-arrows.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-comments.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-direction.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-edges.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-interactions.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-lines.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-md-string.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-node-data.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-singlenode.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-style.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-text.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-vertice-chaining.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/subgraph.spec.js' },
    ],
  },
  {
    family: 'state',
    files: [
      { path: 'packages/mermaid/src/diagrams/state/parser/state-parser.spec.js' },
      { path: 'packages/mermaid/src/diagrams/state/parser/state-style.spec.js' },
      { path: 'packages/mermaid/src/diagrams/state/stateDb.spec.js' },
      { path: 'packages/mermaid/src/diagrams/state/stateDiagram-v2.spec.js' },
      { path: 'packages/mermaid/src/diagrams/state/stateDiagram.spec.js' },
    ],
  },
  {
    family: 'sequence',
    files: [{ path: 'packages/mermaid/src/diagrams/sequence/sequenceDiagram.spec.js' }],
    companionBench: 'src/__tests__/agent-mermaidseqbench.test.ts',
  },
  {
    family: 'class',
    files: [
      { path: 'packages/mermaid/src/diagrams/class/parser/class.spec.js' },
      { path: 'packages/mermaid/src/diagrams/class/classDiagram.spec.ts' },
      { path: 'packages/mermaid/src/diagrams/class/classTypes.spec.ts' },
    ],
  },
  {
    family: 'er',
    files: [
      { path: 'packages/mermaid/src/diagrams/er/parser/erDiagram.spec.js' },
      { path: 'packages/mermaid/src/diagrams/er/parser/subgraph.spec.js' },
      { path: 'packages/mermaid/src/diagrams/er/erDb.spec.js' },
    ],
  },
  {
    family: 'timeline',
    files: [{ path: 'packages/mermaid/src/diagrams/timeline/timeline.spec.js' }],
  },
  {
    family: 'gantt',
    files: [
      { path: 'packages/mermaid/src/diagrams/gantt/parser/gantt.spec.js' },
      { path: 'packages/mermaid/src/diagrams/gantt/ganttDb.spec.ts' },
    ],
    companionBench: 'eval/mermaid-gantt-bench/',
  },
  {
    family: 'journey',
    files: [
      { path: 'packages/mermaid/src/diagrams/user-journey/parser/journey.spec.js' },
      { path: 'packages/mermaid/src/diagrams/user-journey/journeyDb.spec.js' },
    ],
  },
  {
    family: 'architecture',
    files: [
      { path: 'packages/mermaid/src/diagrams/architecture/architecture.spec.ts' },
      { path: 'packages/mermaid/src/diagrams/architecture/architectureSeed.spec.ts' },
    ],
  },
  {
    family: 'xychart',
    files: [
      { path: 'packages/mermaid/src/diagrams/xychart/parser/xychart.jison.spec.ts' },
      { path: 'packages/mermaid/src/diagrams/xychart/xychartDb.spec.ts' },
    ],
  },
  {
    family: 'pie',
    files: [{ path: 'packages/mermaid/src/diagrams/pie/pie.spec.ts' }],
  },
  {
    family: 'quadrant',
    files: [
      { path: 'packages/mermaid/src/diagrams/quadrant-chart/parser/quadrant.jison.spec.ts' },
      { path: 'packages/mermaid/src/diagrams/quadrant-chart/quadrantDb.spec.ts' },
    ],
  },
  {
    family: 'radar',
    files: [{ path: 'packages/mermaid/src/diagrams/radar/radar.spec.ts' }],
  },
]

const narrowers = {
  c4: asC4,
  flowchart: asFlowchart,
  state: asState,
  sequence: asSequence,
  class: asClass,
  er: asEr,
  timeline: asTimeline,
  journey: asJourney,
  architecture: asArchitecture,
  xychart: asXyChart,
  pie: asPie,
  quadrant: asQuadrant,
  radar: asRadar,
  gantt: asGantt,
  sankey: asSankey,
} satisfies Partial<Record<DiagramKind, (d: ValidDiagram) => ValidDiagram | null>>

const headerPattern = /\b(?:graph|flowchart|stateDiagram(?:-v2)?|sequenceDiagram|classDiagram|erDiagram|timeline|journey|architecture-beta|xychart(?:-beta)?|pie|quadrantChart|radar-beta|swimlane)\b/i
const LOCAL_GAP_REASONS = new Set(['local-parse-gap', 'local-verify-gap', 'local-layout-gap', 'local-roundtrip-gap', 'unsupported-header', 'unsupported-syntax', 'unsupported-structured-syntax'])

function main(): void {
  if (!existsSync(UPSTREAM)) {
    throw new Error(`Upstream Mermaid checkout not found at ${UPSTREAM}. Set MERMAID_UPSTREAM_DIR or clone the pinned repo next to this checkout.`)
  }
  assertPinnedUpstreamRevision()

  const blocksByFile = new Map<string, TestBlock[]>()
  const configs: FamilyConfig[] = FAMILY_CONFIGS.map(config => {
    const files = config.files.map(file => {
      const blocks = extractTestBlocks(readFileSync(join(UPSTREAM, file.path), 'utf8'), config.family, file.path)
      blocksByFile.set(file.path, blocks)
      return { path: file.path, testBlocks: blocks.length }
    })
    return { ...config, files, consideredBlocks: files.reduce((sum, file) => sum + file.testBlocks, 0) }
  })
  if (process.argv.includes('--inventory-only')) {
    console.log(JSON.stringify(configs.map(config => ({ family: config.family, consideredBlocks: config.consideredBlocks, files: config.files })), null, 2))
    return
  }

  mkdirSync(OUTPUT, { recursive: true })
  const outputDirectory = statSync(realpathSync(OUTPUT)), ledgerDirectory = statSync(realpathSync(BENCH))
  const inspecting = outputDirectory.dev !== ledgerDirectory.dev || outputDirectory.ino !== ledgerDirectory.ino
  const casesByKey = new Map<string, BenchCase>()
  const exclusions: Exclusion[] = []

  for (const config of configs) {
    for (const file of config.files) {
      for (const block of blocksByFile.get(file.path)!) {
        const classification = classifyBlock(block)
        if (classification.kind === 'case') {
          const key = `${config.family}\0${classification.source}\0${classification.structured ? 'structured' : 'opaque'}`
          const existing = casesByKey.get(key)
          if (existing) {
            pushUnique(existing.upstream.files, block.file)
            existing.upstream.blocks.push(blockLabel(block))
          } else {
            const c: BenchCase = {
              id: uniqueCaseId(casesByKey, `${config.family}-upstream-${slug(block.name)}`),
              family: config.family,
              source: classification.source,
              upstream: { repo: UPSTREAM_REPO, files: [block.file], blocks: [blockLabel(block)] },
              assertions: {
                expectStructured: classification.structured,
                nodeCount: classification.nodes,
                edgeCount: classification.edges,
                groupCount: classification.groups,
                ...(classification.nodes > 0 ? { minNodes: classification.nodes } : {}),
                ...(classification.edges > 0 ? { minEdges: classification.edges } : {}),
                ...(classification.groups > 0 ? { minGroups: classification.groups } : {}),
                ...(classification.labels.length > 0 ? { labelsContain: classification.labels } : {}),
              },
            }
            casesByKey.set(key, c)
          }
        } else {
          exclusions.push(exclusionForBlock(block, classification.reason, classification.summary, classification.source, classification.ours))
        }
      }
    }

  }

  const cases = [...casesByKey.values()].sort((a, b) => compareCodePointStrings(a.family, b.family) || compareCodePointStrings(a.id, b.id))
  const manifest = buildManifest(cases, exclusions, configs)
  const writeCorpus = (): void => {
    writeJson(join(OUTPUT, 'cases.json'), cases)
    writeJson(join(OUTPUT, 'exclusions.json'), exclusions.sort((a, b) => compareCodePointStrings(a.families[0]!, b.families[0]!) || compareCodePointStrings(a.id, b.id)))
    writeJson(join(OUTPUT, 'manifest.json'), manifest)
  }
  // Inspection keeps proposed findings even if the unchanged gap ratchet
  // refuses a refresh. Default output is never replaced before admission.
  if (inspecting) writeCorpus()
  const ratchet = buildRatchet(cases, exclusions)
  if (!inspecting) writeCorpus()
  writeJson(join(OUTPUT, 'ratchet.json'), ratchet)

  const companionCounts = Object.values(PINNED_COMPANION.accounting)
  const totalCases = cases.length + companionCounts.reduce((sum, row) => sum + row.importedCases, 0)
  const importedBlocks = cases.reduce((sum, c) => sum + c.upstream.blocks.length, 0) + companionCounts.reduce((sum, row) => sum + row.importedBlocks, 0)
  const excludedBlocks = exclusions.reduce((sum, e) => sum + e.blockCount, 0) + companionCounts.reduce((sum, row) => sum + row.excludedBlocks, 0)
  console.log(`Harvested ${totalCases} cases covering ${importedBlocks} blocks; excluded/accounted ${excludedBlocks}; local-gap budget ${ratchet.budgets.localGaps.totalBlocks}; deferred 0.`)
}

function assertPinnedUpstreamRevision(): void {
  let actual = ''
  try {
    actual = execFileSync('git', ['-C', UPSTREAM, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch (error) {
    throw new Error(`Unable to read upstream Mermaid checkout revision at ${UPSTREAM}: ${String(error)}`)
  }
  if (actual !== UPSTREAM_REVISION) {
    throw new Error(`Upstream Mermaid checkout is at ${actual}, but BUILD-20 is pinned to ${UPSTREAM_REVISION}. Check out the pinned revision or intentionally refresh the manifest, cases, exclusions, ratchet, and family block counts.`)
  }
}

function buildManifest(cases: BenchCase[], exclusions: Exclusion[], configs: FamilyConfig[]): unknown {
  const importedBlocksByFamily = new Map<Family, number>()
  const importedCasesByFamily = new Map<Family, number>()
  for (const c of cases) {
    importedBlocksByFamily.set(c.family, (importedBlocksByFamily.get(c.family) ?? 0) + c.upstream.blocks.length)
    importedCasesByFamily.set(c.family, (importedCasesByFamily.get(c.family) ?? 0) + 1)
  }
  const excludedBlocksByFamily = new Map<Family, number>()
  for (const e of exclusions) {
    for (const family of e.families) {
      excludedBlocksByFamily.set(family, (excludedBlocksByFamily.get(family) ?? 0) + e.blockCount)
    }
  }

  return {
    upstream: {
      repo: UPSTREAM_REPO,
      revision: UPSTREAM_REVISION,
      branch: 'develop',
      harvestDate: '2026-06-18',
      license: 'MIT',
    },
    scope: 'Current Agentic Mermaid renderable built-in families. Every considered upstream parser/DB block is imported as an executable case, excluded with a documented reason, or delegated to a named family companion bench. Mindmap and GitGraph are pinned separately to their declared compatibility revision.',
    families: [
      ...configs.map(config => {
        const importedBlocks = importedBlocksByFamily.get(config.family) ?? 0
        const importedCases = importedCasesByFamily.get(config.family) ?? 0
        const excludedBlocks = excludedBlocksByFamily.get(config.family) ?? 0
        const deferredBlocks = config.consideredBlocks - importedBlocks - excludedBlocks
        return {
          family: config.family,
          status: 'registration-harvest-accounted',
          consideredBlocks: config.consideredBlocks,
          importedCases,
          importedBlocks,
          excludedBlocks,
          deferredBlocks,
          files: config.files,
          ...(config.companionBench ? { companionBench: config.companionBench } : {}),
        }
      }),
      ...PINNED_FAMILIES.map(family => {
        const accounting = PINNED_COMPANION.accounting[family]
        const file = PINNED_COMPANION.upstream.files.find(entry => entry.family === family)
        if (!file) throw new Error(`Pinned companion oracle is missing ${family} file provenance.`)
        return {
          family,
          status: 'full-harvest-accounted',
          ...accounting,
          compatibilityRevision: PINNED_COMPANION.upstream.commit,
          files: [{ path: file.path, testBlocks: file.testBlocks }],
          companionBench: 'src/__tests__/mindmap-gitgraph-upstream-oracle.test.ts',
        }
      }),
    ],
  }
}

function buildRatchet(cases: BenchCase[], exclusions: Exclusion[]): Ratchet {
  const companionCounts = Object.values(PINNED_COMPANION.accounting)
  const observed: Ratchet['observed'] = {
    importedCases: cases.length + companionCounts.reduce((sum, row) => sum + row.importedCases, 0),
    importedBlocks: cases.reduce((sum, c) => sum + c.upstream.blocks.length, 0) + companionCounts.reduce((sum, row) => sum + row.importedBlocks, 0),
    localGaps: localGapBudget(exclusions),
  }
  const previous = readRatchet()
  if (!previous) {
    return {
      version: 1,
      upstreamRevision: UPSTREAM_REVISION,
      budgets: {
        importedCaseFloor: observed.importedCases,
        importedBlockFloor: observed.importedBlocks,
        localGaps: observed.localGaps,
      },
      observed,
    }
  }

  assertNoRatchetRegression(previous, observed)
  return {
    version: 1,
    upstreamRevision: UPSTREAM_REVISION,
    budgets: {
      importedCaseFloor: Math.max(previous.budgets.importedCaseFloor, observed.importedCases),
      importedBlockFloor: Math.max(previous.budgets.importedBlockFloor, observed.importedBlocks),
      localGaps: minLocalGapBudget(previous.budgets.localGaps, observed.localGaps),
    },
    observed,
  }
}

function readRatchet(): Ratchet | null {
  const path = join(BENCH, 'ratchet.json')
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as Ratchet
}

function localGapBudget(exclusions: Exclusion[]): LocalGapBudget {
  const budget: LocalGapBudget = { totalBlocks: 0, byReason: {}, byFamily: {}, byFamilyReason: {} }
  for (const e of exclusions) {
    if (!LOCAL_GAP_REASONS.has(e.reason)) continue
    const count = e.blockCount
    budget.totalBlocks += count
    budget.byReason[e.reason] = (budget.byReason[e.reason] ?? 0) + count
    for (const family of e.families) {
      budget.byFamily[family] = (budget.byFamily[family] ?? 0) + count
      budget.byFamilyReason[family] ??= {}
      budget.byFamilyReason[family]![e.reason] = (budget.byFamilyReason[family]![e.reason] ?? 0) + count
    }
  }
  return normalizeBudget(budget)
}

function normalizeBudget(budget: LocalGapBudget): LocalGapBudget {
  return {
    totalBlocks: budget.totalBlocks,
    byReason: sortRecord(budget.byReason),
    byFamily: sortRecord(budget.byFamily),
    byFamilyReason: Object.fromEntries(
      Object.entries(budget.byFamilyReason)
        .sort(([a], [b]) => compareCodePointStrings(a, b))
        .map(([family, values]) => [family, sortRecord(values)]),
    ),
  }
}

function sortRecord(values: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => compareCodePointStrings(a, b)),
  )
}

function minLocalGapBudget(previous: LocalGapBudget, observed: LocalGapBudget): LocalGapBudget {
  const byReason: Record<string, number> = {}
  const byFamily: Record<string, number> = {}
  const byFamilyReason: Record<string, Record<string, number>> = {}
  for (const key of new Set([...Object.keys(previous.byReason), ...Object.keys(observed.byReason)])) {
    byReason[key] = Math.min(previous.byReason[key] ?? 0, observed.byReason[key] ?? 0)
  }
  for (const key of new Set([...Object.keys(previous.byFamily), ...Object.keys(observed.byFamily)])) {
    byFamily[key] = Math.min(previous.byFamily[key] ?? 0, observed.byFamily[key] ?? 0)
  }
  for (const family of new Set([...Object.keys(previous.byFamilyReason), ...Object.keys(observed.byFamilyReason)])) {
    byFamilyReason[family] = {}
    const prevFamily = previous.byFamilyReason[family] ?? {}
    const observedFamily = observed.byFamilyReason[family] ?? {}
    for (const reason of new Set([...Object.keys(prevFamily), ...Object.keys(observedFamily)])) {
      byFamilyReason[family]![reason] = Math.min(prevFamily[reason] ?? 0, observedFamily[reason] ?? 0)
    }
  }
  return normalizeBudget({
    totalBlocks: Math.min(previous.totalBlocks, observed.totalBlocks),
    byReason,
    byFamily,
    byFamilyReason,
  })
}

function assertNoRatchetRegression(previous: Ratchet, observed: Ratchet['observed']): void {
  if (observed.importedCases < previous.budgets.importedCaseFloor) {
    throw new Error(`Imported case count regressed from floor ${previous.budgets.importedCaseFloor} to ${observed.importedCases}`)
  }
  if (observed.importedBlocks < previous.budgets.importedBlockFloor) {
    throw new Error(`Imported block count regressed from floor ${previous.budgets.importedBlockFloor} to ${observed.importedBlocks}`)
  }
  assertBudgetAtOrBelow('local total gaps', observed.localGaps.totalBlocks, previous.budgets.localGaps.totalBlocks)
  for (const [reason, count] of Object.entries(observed.localGaps.byReason)) {
    assertBudgetAtOrBelow(`local gaps by reason ${reason}`, count, previous.budgets.localGaps.byReason[reason] ?? 0)
  }
  for (const [family, count] of Object.entries(observed.localGaps.byFamily)) {
    assertBudgetAtOrBelow(`local gaps by family ${family}`, count, previous.budgets.localGaps.byFamily[family] ?? 0)
  }
  for (const [family, reasons] of Object.entries(observed.localGaps.byFamilyReason)) {
    for (const [reason, count] of Object.entries(reasons)) {
      assertBudgetAtOrBelow(`local gaps by family/reason ${family}/${reason}`, count, previous.budgets.localGaps.byFamilyReason[family]?.[reason] ?? 0)
    }
  }
}

function assertBudgetAtOrBelow(label: string, observed: number, budget: number): void {
  if (observed > budget) throw new Error(`${label} regressed above budget: observed ${observed}, budget ${budget}`)
}

function classifyBlock(block: TestBlock): { kind: 'case'; source: string; structured: boolean; nodes: number; edges: number; groups: number; labels: string[] } | { kind: 'exclude'; reason: string; summary: string; source?: string; ours?: Exclusion['ours'] } {
  const extraction = sourceLiterals(block.body)
  const sources = extraction.sources
  if (block.skipped) return { kind: 'exclude', reason: 'upstream-skipped', summary: 'This is an actual skipped/todo registration in the historical upstream source, not evidence of a missing public feature.', source: sources[0] }
  if (isNegativeTest(block.body)) {
    return {
      kind: 'exclude',
      reason: 'upstream-negative',
      summary: 'The upstream block asserts that this input throws or is rejected. BUILD-20 imports positive portable parser/DB behavior as cases and marks upstream negative coverage WONTFIX with Mermaid.js provenance.',
      source: sources[0],
      ours: sources[0] ? localBehavior(sources[0], block.family) : undefined,
    }
  }
  if (extraction.unresolved || sources.length === 0) {
    return {
      kind: 'exclude',
      reason: 'source-extraction-limit',
      summary: 'No constant Mermaid source could be recovered from this actual registration. This extraction limit does not establish that the behavior is private, unsupported, or WONTFIX.',
    }
  }
  const portableSources = sources.filter(source => !isHarvestedHelperLiteral(source, block.family))
  if (portableSources.length === 0) {
    return {
      kind: 'exclude',
      reason: 'api-internal',
      source: sources[0],
      ours: sources[0] ? localBehavior(sources[0], block.family) : undefined,
      summary: 'The upstream block exposes a helper string or accessibility/title payload harvested from parser database assertions, not one portable Mermaid source case.',
    }
  }

  let firstParseFailure = ''
  let sawDifferentFamily = false
  for (const source of portableSources) {
    const parsed = parseMermaid(source)
    if (!parsed.ok) {
      firstParseFailure = parsed.error.map(e => e.message).join('; ')
      continue
    }
    if (parsed.value.kind !== block.family) {
      sawDifferentFamily = true
      continue
    }
    if (isNonRenderableSourceScaffold(source, parsed.value)) {
      return {
        kind: 'exclude',
        reason: 'api-internal',
        source,
        ours: localBehavior(source, block.family),
        summary: 'The upstream block exposes only a header, declaration, title, or section scaffold while asserting parser database helper state, not one renderable portable Mermaid source case.',
      }
    }
    const verification = safeVerify(parsed.value)
    if (!verification.ok) {
      return {
        kind: 'exclude',
        reason: 'local-verify-gap',
        source,
        ours: localBehavior(source, block.family),
        summary: 'The upstream source parses locally but verifyMermaid reports warnings, so it is tracked as a compatibility gap instead of weakening the public case contract.',
      }
    }
    try {
      const layout = layoutMermaid(parsed.value)
      const serialized = serializeMermaid(parsed.value)
      const reparsed = parseMermaid(serialized)
      if (!reparsed.ok || serializeMermaid(reparsed.value) !== serialized) {
        return {
          kind: 'exclude',
          reason: 'local-roundtrip-gap',
          source,
          ours: { ...localBehavior(source, block.family), roundtripOk: false },
          summary: 'The upstream source parses, verifies, and lays out locally, but serialize/parse/serialize is not stable, so it is tracked as a compatibility gap instead of weakening the public case contract.',
        }
      }
      return {
        kind: 'case',
        source,
        structured: Boolean(narrowers[block.family](parsed.value)),
        nodes: layout.nodes.length,
        edges: layout.edges.length,
        groups: layout.groups.length,
        labels: caseLabels(layout),
      }
    } catch {
      return {
        kind: 'exclude',
        reason: 'local-layout-gap',
        source,
        ours: { ...localBehavior(source, block.family), layoutOk: false },
        summary: 'The upstream source parses and verifies locally but layoutMermaid throws, so the block is kept as an explicit compatibility gap.',
      }
    }
  }

  if (sawDifferentFamily) {
    return {
      kind: 'exclude',
      reason: 'unsupported-header',
      source: sources[0],
      ours: localBehavior(sources[0]!, block.family),
      summary: 'The upstream source uses a header alias or neighboring family syntax that is not routed to this Agentic Mermaid built-in family.',
    }
  }

  return {
    kind: 'exclude',
    reason: 'local-parse-gap',
    source: portableSources[0],
    ours: portableSources[0] ? localBehavior(portableSources[0], block.family) : { parseOk: false },
    summary: `The upstream source is positive parser coverage, but parseRegisteredMermaid currently rejects it${firstParseFailure ? ` (${firstParseFailure})` : ''}.`,
  }
}

function isHarvestedHelperLiteral(source: string, family: Family): boolean {
  const trimmed = source.trim()
  if (family === 'er' && !/^erDiagram\b/i.test(trimmed)) return true
  if (family === 'journey') {
    const first = trimmed.split(/\r?\n/)[0]?.trim() ?? ''
    if (!/^journey$/i.test(first)) return true
  }
  return false
}

function isNonRenderableSourceScaffold(source: string, diagram: ValidDiagram): boolean {
  if (isDeclarationOnlyFlowchartSource(source, diagram)) return true
  const lines = source
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('%%'))
  if (lines.length === 0) return true
  const one = lines.length === 1 ? lines[0]! : ''
  if (diagram.kind === 'class') return /^classDiagram$/i.test(one)
  if (diagram.kind === 'er') return /^erDiagram$/i.test(one)
  if (diagram.kind === 'state') return /^stateDiagram(?:-v2)?$/i.test(one)
  if (diagram.kind === 'sequence') return /^sequenceDiagram$/i.test(one)
  if (diagram.kind === 'journey') return /^journey$/i.test(one)
  if (diagram.kind === 'quadrant') return /^quadrantChart$/i.test(one)
  if (diagram.kind === 'architecture') return /^architecture-beta(?:\s+title\b.+)?$/i.test(one)
  if (diagram.kind === 'xychart') return /^xychart(?:-beta)?(?:\s+(?:horizontal|vertical))?$/i.test(one)
  if (diagram.kind === 'timeline' && /^timeline$/i.test(lines[0]!)) {
    return lines.slice(1).length > 0 && lines.slice(1).every(line => /^section\b/i.test(line))
  }
  // A declaration-only source (a state classDef, radar options with no axes)
  // parses as its family's typed empty body, which verify reports as empty.
  return safeVerify(diagram).warnings?.some(warning => warning.code === 'EMPTY_DIAGRAM') === true
}

function isDeclarationOnlyFlowchartSource(source: string, diagram: ValidDiagram): boolean {
  if (diagram.body.kind !== 'flowchart') return false
  const graph = diagram.body.graph
  if (graph.nodes.size > 0 || graph.edges.length > 0 || graph.subgraphs.length > 0) return false
  const statements = source
    .split(/[;\n]/)
    .map(line => line.trim())
    .filter(Boolean)
  const body = statements.filter(line => !/^(?:graph|flowchart)\b/i.test(line) && !line.startsWith('%%'))
  return body.length === 0 || body.every(line => /^(?:classDef|class|style|linkStyle)\b/i.test(line))
}

function caseLabels(layout: ReturnType<typeof layoutMermaid>): string[] {
  const labels: string[] = []
  for (const node of layout.nodes) if (node.label) labels.push(plainTextFromInlineFormatting(node.label))
  for (const edge of layout.edges) if (edge.label?.text) labels.push(plainTextFromInlineFormatting(edge.label.text))
  for (const group of layout.groups) if (group.label) labels.push(plainTextFromInlineFormatting(group.label))
  return [...new Set(labels)].slice(0, 8)
}

function localBehavior(source: string, family: Family): Exclusion['ours'] {
  const parsed = parseMermaid(source)
  if (!parsed.ok) return { parseOk: false }
  const verification = safeVerify(parsed.value)
  let layoutOk = true
  try {
    layoutMermaid(parsed.value)
  } catch {
    layoutOk = false
  }
  return {
    parseOk: true,
    structured: parsed.value.kind === family && Boolean(narrowers[family](parsed.value as ValidDiagram)),
    verifyOk: verification.ok,
    layoutOk,
  }
}

function safeVerify(diagram: ParsedDiagram): { ok: boolean; warnings?: ReturnType<typeof verifyMermaid>['warnings'] } {
  try {
    return verifyMermaid(diagram)
  } catch {
    return { ok: false }
  }
}

function exclusionForBlock(block: TestBlock, reason: string, summary: string, source?: string, ours?: Exclusion['ours']): Exclusion {
  const isWontfix = !LOCAL_GAP_REASONS.has(reason) && reason !== 'source-extraction-limit'
  return {
    id: `${block.family}-excluded-${slug(relative('packages/mermaid/src/diagrams', block.file))}-${slug(block.name)}`,
    families: [block.family],
    reason,
    ...(isWontfix ? { disposition: 'WONTFIX' as const } : {}),
    blockCount: 1,
    ...(trackingFor(block.family, reason) ? { tracking: trackingFor(block.family, reason)! } : {}),
    upstream: { repo: UPSTREAM_REPO, files: [block.file], blocks: [blockLabel(block)] },
    ...(!isWontfix && source ? { source } : {}),
    ...(!isWontfix && ours ? { ours } : {}),
    summary,
  }
}

function trackingFor(family: Family, reason: string): GapTracking | undefined {
  if (!LOCAL_GAP_REASONS.has(reason)) return undefined
  const kind = reason
    .replace(/^local-/, '')
    .replace(/-gap$/, '')
    .replace(/^unsupported-/, 'unsupported-')
  return {
    issue: '#55',
    owner: 'BUILD-20',
    lane: `${family}-${kind}-parity`,
    priority: gapPriority(family, reason),
    target: 'convert-to-case',
  }
}

function gapPriority(family: Family, reason: string): GapTracking['priority'] {
  if (reason === 'local-layout-gap') return 'P0'
  if (reason === 'local-roundtrip-gap') return 'P1'
  if (family === 'flowchart' || family === 'class' || family === 'state') return 'P1'
  if (family === 'er' || family === 'sequence') return 'P2'
  return 'P3'
}

function blockLabel(block: TestBlock): string {
  return `${block.file} :: ${block.name}`
}

/** TypeScript owns lexical boundaries, including comments, quoted method text,
 * callback braces and table-driven/dynamic registration names. */
function extractTestBlocks(text: string, family: Family, file: string): TestBlock[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const blocks: TestBlock[] = []
  function registration(node: ts.Expression): { test: boolean; skipped: boolean } {
    if (ts.isIdentifier(node)) return { test: node.text === 'it' || node.text === 'test', skipped: false }
    if (ts.isCallExpression(node)) return registration(node.expression)
    if (ts.isTaggedTemplateExpression(node)) return registration(node.tag)
    if (ts.isPropertyAccessExpression(node)) {
      const base = registration(node.expression)
      return { test: base.test, skipped: base.skipped || node.name.text === 'skip' || node.name.text === 'todo' }
    }
    return { test: false, skipped: false }
  }
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const kind = registration(node.expression)
      const callback = node.arguments.find(argument => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))
      const pending = ts.isPropertyAccessExpression(node.expression) && (node.expression.name.text === 'skip' || node.expression.name.text === 'todo')
      if (kind.test && (callback || pending) && node.arguments[0]) {
        const name = constantString(node.arguments[0]) ?? node.arguments[0].getText(source)
        blocks.push({ family, file, name, body: callback?.getText(source) ?? '', skipped: kind.skipped })
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return blocks
}

/** Evaluate only syntax-owned string constants. Never execute upstream code. */
function constantString(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isParenthesizedExpression(node)) return constantString(node.expression)
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantString(node.left), right = constantString(node.right)
    if (left !== undefined && right !== undefined) return left + right
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text
    for (const span of node.templateSpans) {
      const expression = constantString(span.expression)
      if (expression === undefined) return undefined
      value += expression + span.literal.text
    }
    return value
  }
  return undefined
}

/** Only actual source argument values can become candidate cases. Unknown
 * bindings, mutations, tags and dynamic expressions remain extraction limits. */
function sourceLiterals(body: string): { sources: string[]; unresolved: boolean } {
  const source = ts.createSourceFile('upstream-callback.ts', body, ts.ScriptTarget.Latest, true)
  const values = new Set<string>()
  // The compiler binder owns lexical scope, destructuring and var hoisting.
  // Extraction admits only immutable local string constants after binding.
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.Latest, noLib: true, noResolve: true, noEmit: true }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = name => name === source.fileName ? source : undefined
  host.fileExists = name => name === source.fileName
  host.readFile = name => name === source.fileName ? source.text : undefined
  const checker = ts.createProgram([source.fileName], options, host).getTypeChecker()
  function evaluate(node: ts.Node, active = new Set<ts.Node>()): string | undefined {
    if (active.has(node)) return undefined
    const next = new Set(active); next.add(node)
    if (ts.isIdentifier(node)) {
      const binding = checker.getSymbolAtLocation(node)?.valueDeclaration
      if (!binding || !ts.isVariableDeclaration(binding) || !ts.isVariableDeclarationList(binding.parent) || !(binding.parent.flags & ts.NodeFlags.Const)) return undefined
      return binding.initializer && binding.getStart(source) < node.getStart(source) ? evaluate(binding.initializer, next) : undefined
    }
    if (ts.isParenthesizedExpression(node)) return evaluate(node.expression, next)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = evaluate(node.left, next), right = evaluate(node.right, next)
      return left !== undefined && right !== undefined ? left + right : undefined
    }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text
      for (const span of node.templateSpans) {
        const expression = evaluate(span.expression, next)
        if (expression === undefined) return undefined
        value += expression + span.literal.text
      }
      return value
    }
    return constantString(node)
  }
  let unresolved = false
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ''
      const argument = name === 'render' ? 1 : ['parse', 'getDiagramFromText', 'preprocessDiagram', 'detectType'].includes(name) ? 0 : undefined
      const json = ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'JSON'
      if (argument !== undefined && !json) {
        const value = node.arguments[argument] ? evaluate(node.arguments[argument]!) : undefined
        if (value === undefined) unresolved = true
        else if (headerPattern.test(value) && value.split(/\r?\n/).length < 220) values.add(value.trim())
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { sources: [...values], unresolved }
}

function isNegativeTest(body: string): boolean {
  const source = ts.createSourceFile('upstream-assertions.ts', body, ts.ScriptTarget.Latest, true)
  const caught = new Set<string>(), asserted = new Set<string>()
  let negative = false
  function visit(node: ts.Node): void {
    if (ts.isCatchClause(node)) {
      function assignments(child: ts.Node): void {
        if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(child.left) && child.right.kind === ts.SyntaxKind.TrueKeyword) caught.add(child.left.text)
        ts.forEachChild(child, assignments)
      }
      assignments(node.block)
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const matcher = node.expression.name.text
      let receiver: ts.Expression = node.expression.expression
      let negated = false, rejects = false
      while (ts.isPropertyAccessExpression(receiver)) {
        negated ||= receiver.name.text === 'not'; rejects ||= receiver.name.text === 'rejects'
        receiver = receiver.expression
      }
      if (!negated && (matcher === 'toThrow' || matcher === 'toThrowError' || matcher === 'throws' || rejects)) negative = true
      if (!negated && matcher === 'toBe' && node.arguments[0]?.kind === ts.SyntaxKind.TrueKeyword && ts.isCallExpression(receiver) && ts.isIdentifier(receiver.expression) && receiver.expression.text === 'expect' && receiver.arguments[0] && ts.isIdentifier(receiver.arguments[0])) asserted.add(receiver.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return negative || [...caught].some(name => asserted.has(name))
}

function uniqueCaseId(cases: Map<string, BenchCase>, base: string): string {
  const used = new Set([...cases.values()].map(c => c.id))
  if (!used.has(base)) return base
  let i = 2
  while (used.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value)
}

function slug(text: string): string {
  const base = basename(text)
    .replace(/\.[cm]?[jt]sx?$/i, '')
    .toLowerCase()
    .replace(/\$\{[^}]+\}/g, 'generated')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
  return base || 'block'
}

function writeJson(path: string, value: unknown): void {
  const scratch = mkdtempSync(join(dirname(path), '.harvest-'))
  try {
    const staged = join(scratch, basename(path))
    writeFileSync(staged, `${JSON.stringify(value, null, 2)}\n`)
    renameSync(staged, path)
  } finally { rmSync(scratch, { recursive: true, force: true }) }
}

main()
