import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { plainTextFromInlineFormatting } from '../../src/shared/inline-format.ts'
import {
  asArchitecture,
  asClass,
  asEr,
  asFlowchart,
  asGantt,
  asJourney,
  asPie,
  asQuadrant,
  asRadar,
  asSequence,
  asState,
  asTimeline,
  asXyChart,
  layoutMermaid,
  parseMermaid,
  serializeMermaid,
  verifyMermaid,
} from '../../src/agent/index.ts'
import type { DiagramKind, ValidDiagram } from '../../src/agent/types.ts'

type Family = Exclude<DiagramKind, 'mindmap' | 'gitgraph'>

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
  accounting: Record<'mindmap' | 'gitgraph', {
    consideredBlocks: number
    importedCases: number
    importedBlocks: number
    excludedBlocks: number
    deferredBlocks: number
  }>
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
const UPSTREAM = resolve(process.env.MERMAID_UPSTREAM_DIR ?? join(ROOT, '../upstream-mermaid'))
const UPSTREAM_REVISION = 'a2d9686451df7c4644a3eeca20535bbd4c5776b0'
const UPSTREAM_REPO = 'mermaid-js/mermaid' as const
const PINNED_COMPANION_PATH = join(BENCH, 'mindmap-gitgraph-f3dea583.json')
const PINNED_COMPANION = JSON.parse(readFileSync(PINNED_COMPANION_PATH, 'utf8')) as PinnedCompanionOracle
const PINNED_FAMILIES = ['mindmap', 'gitgraph'] as const

const FAMILY_CONFIGS: FamilyConfig[] = [
  {
    family: 'flowchart',
    consideredBlocks: 301,
    files: [
      { path: 'packages/mermaid/src/diagrams/flowchart/flowChartShapes.spec.js', testBlocks: 3 },
      { path: 'packages/mermaid/src/diagrams/flowchart/flowDb.spec.ts', testBlocks: 13 },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-arrows.spec.js', testBlocks: 14 },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-comments.spec.js', testBlocks: 9 },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-direction.spec.js', testBlocks: 4 },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-edges.spec.js', testBlocks: 29 },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-interactions.spec.js', testBlocks: 13 },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-lines.spec.js', testBlocks: 12 },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-md-string.spec.js', testBlocks: 2 },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-node-data.spec.js', testBlocks: 30 },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-singlenode.spec.js', testBlocks: 34 },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-style.spec.js', testBlocks: 25 },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-text.spec.js', testBlocks: 59 },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-vertice-chaining.spec.js', testBlocks: 7 },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow.spec.js', testBlocks: 25 },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/subgraph.spec.js', testBlocks: 22 },
    ],
  },
  {
    family: 'state',
    consideredBlocks: 108,
    files: [
      { path: 'packages/mermaid/src/diagrams/state/parser/state-parser.spec.js', testBlocks: 16 },
      { path: 'packages/mermaid/src/diagrams/state/parser/state-style.spec.js', testBlocks: 24 },
      { path: 'packages/mermaid/src/diagrams/state/stateDb.spec.js', testBlocks: 6 },
      { path: 'packages/mermaid/src/diagrams/state/stateDiagram-v2.spec.js', testBlocks: 32 },
      { path: 'packages/mermaid/src/diagrams/state/stateDiagram.spec.js', testBlocks: 30 },
    ],
  },
  {
    family: 'sequence',
    consideredBlocks: 139,
    files: [
      { path: 'packages/mermaid/src/diagrams/sequence/sequenceDiagram.spec.js', testBlocks: 139 },
    ],
    companionBench: 'src/__tests__/agent-mermaidseqbench.test.ts',
  },
  {
    family: 'class',
    consideredBlocks: 251,
    files: [
      { path: 'packages/mermaid/src/diagrams/class/parser/class.spec.js', testBlocks: 2 },
      { path: 'packages/mermaid/src/diagrams/class/classDiagram.spec.ts', testBlocks: 156 },
      { path: 'packages/mermaid/src/diagrams/class/classTypes.spec.ts', testBlocks: 93 },
    ],
  },
  {
    family: 'er',
    consideredBlocks: 142,
    files: [
      { path: 'packages/mermaid/src/diagrams/er/parser/erDiagram.spec.js', testBlocks: 116 },
      { path: 'packages/mermaid/src/diagrams/er/parser/subgraph.spec.js', testBlocks: 18 },
      { path: 'packages/mermaid/src/diagrams/er/erDb.spec.js', testBlocks: 8 },
    ],
  },
  {
    family: 'timeline',
    consideredBlocks: 11,
    files: [
      { path: 'packages/mermaid/src/diagrams/timeline/timeline.spec.js', testBlocks: 11 },
    ],
  },
  {
    family: 'gantt',
    consideredBlocks: 68,
    files: [
      { path: 'packages/mermaid/src/diagrams/gantt/parser/gantt.spec.js', testBlocks: 0 },
      { path: 'packages/mermaid/src/diagrams/gantt/ganttDb.spec.ts', testBlocks: 0 },
    ],
    companionBench: 'eval/mermaid-gantt-bench/',
  },
  {
    family: 'journey',
    consideredBlocks: 10,
    files: [
      { path: 'packages/mermaid/src/diagrams/user-journey/parser/journey.spec.js', testBlocks: 7 },
      { path: 'packages/mermaid/src/diagrams/user-journey/journeyDb.spec.js', testBlocks: 3 },
    ],
  },
  {
    family: 'architecture',
    consideredBlocks: 33,
    files: [
      { path: 'packages/mermaid/src/diagrams/architecture/architecture.spec.ts', testBlocks: 26 },
      { path: 'packages/mermaid/src/diagrams/architecture/architectureSeed.spec.ts', testBlocks: 7 },
    ],
  },
  {
    family: 'xychart',
    consideredBlocks: 64,
    files: [
      { path: 'packages/mermaid/src/diagrams/xychart/parser/xychart.jison.spec.ts', testBlocks: 58 },
      { path: 'packages/mermaid/src/diagrams/xychart/xychartDb.spec.ts', testBlocks: 6 },
    ],
  },
  {
    family: 'pie',
    consideredBlocks: 14,
    files: [
      { path: 'packages/mermaid/src/diagrams/pie/pie.spec.ts', testBlocks: 14 },
    ],
  },
  {
    family: 'quadrant',
    consideredBlocks: 29,
    files: [
      { path: 'packages/mermaid/src/diagrams/quadrant-chart/parser/quadrant.jison.spec.ts', testBlocks: 24 },
      { path: 'packages/mermaid/src/diagrams/quadrant-chart/quadrantDb.spec.ts', testBlocks: 5 },
    ],
  },
  {
    family: 'radar',
    consideredBlocks: 19,
    files: [
      { path: 'packages/mermaid/src/diagrams/radar/radar.spec.ts', testBlocks: 19 },
    ],
  },
]

const narrowers: Record<Family, (d: ValidDiagram) => ValidDiagram | null> = {
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
}

const headerPattern = /\b(?:graph|flowchart|stateDiagram(?:-v2)?|sequenceDiagram|classDiagram|erDiagram|timeline|journey|architecture-beta|xychart(?:-beta)?|pie|quadrantChart|radar-beta|swimlane)\b/i
const LOCAL_GAP_REASONS = new Set(['local-parse-gap', 'local-verify-gap', 'local-layout-gap', 'local-roundtrip-gap', 'unsupported-header', 'unsupported-syntax', 'unsupported-structured-syntax'])

function main(): void {
  if (!existsSync(UPSTREAM)) {
    throw new Error(`Upstream Mermaid checkout not found at ${UPSTREAM}. Set MERMAID_UPSTREAM_DIR or clone the pinned repo next to this checkout.`)
  }
  assertPinnedUpstreamRevision()

  const casesByKey = new Map<string, BenchCase>()
  const exclusions: Exclusion[] = []
  const extractedByFamily = new Map<Family, number>()

  for (const config of FAMILY_CONFIGS) {
    if (config.family === 'gantt') continue
    for (const file of config.files) {
      const abs = join(UPSTREAM, file.path)
      const text = readFileSync(abs, 'utf8')
      for (const block of extractTestBlocks(text, config.family, file.path)) {
        extractedByFamily.set(config.family, (extractedByFamily.get(config.family) ?? 0) + 1)
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

    const extracted = extractedByFamily.get(config.family) ?? 0
    if (extracted < config.consideredBlocks) {
      exclusions.push({
        id: `${config.family}-unextracted-dynamic-blocks`,
        families: [config.family],
        reason: 'unextracted-dynamic-source',
        disposition: 'WONTFIX',
        blockCount: config.consideredBlocks - extracted,
        upstream: {
          repo: UPSTREAM_REPO,
          files: config.files.map(file => file.path),
          blocks: [`${config.consideredBlocks - extracted} upstream test blocks not expressible as direct Mermaid source literals by the harvester`],
        },
        summary: 'These upstream blocks build inputs dynamically, assert renderer or database helper behavior, or use table-driven cases that are counted from the spec file but do not expose one portable Mermaid source literal to run through the public agent API.',
      })
    }
  }

  const cases = [...casesByKey.values()].sort((a, b) => a.family.localeCompare(b.family) || a.id.localeCompare(b.id))
  const manifest = buildManifest(cases, exclusions)
  const ratchet = buildRatchet(cases, exclusions)
  writeJson(join(BENCH, 'cases.json'), cases)
  writeJson(join(BENCH, 'exclusions.json'), exclusions.sort((a, b) => a.families[0].localeCompare(b.families[0]) || a.id.localeCompare(b.id)))
  writeJson(join(BENCH, 'manifest.json'), manifest)
  writeJson(join(BENCH, 'ratchet.json'), ratchet)

  const companionCounts = Object.values(PINNED_COMPANION.accounting)
  const totalCases = cases.length + companionCounts.reduce((sum, row) => sum + row.importedCases, 0)
  const importedBlocks = cases.reduce((sum, c) => sum + c.upstream.blocks.length, 0) + 68 + companionCounts.reduce((sum, row) => sum + row.importedBlocks, 0)
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

function buildManifest(cases: BenchCase[], exclusions: Exclusion[]): unknown {
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
    families: [...FAMILY_CONFIGS.map(config => {
      const importedBlocks = config.family === 'gantt' ? 68 : importedBlocksByFamily.get(config.family) ?? 0
      const importedCases = config.family === 'gantt' ? 68 : importedCasesByFamily.get(config.family) ?? 0
      const excludedBlocks = excludedBlocksByFamily.get(config.family) ?? 0
      const deferredBlocks = config.consideredBlocks - importedBlocks - excludedBlocks
      return {
        family: config.family,
        status: config.family === 'gantt' ? 'dedicated-full-family-bench-existing' : 'full-harvest-accounted',
        consideredBlocks: config.consideredBlocks,
        importedCases,
        importedBlocks,
        excludedBlocks,
        deferredBlocks,
        files: config.files,
        ...(config.companionBench ? { companionBench: config.companionBench } : {}),
      }
    }), ...PINNED_FAMILIES.map(family => {
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
    })],
  }
}

function buildRatchet(cases: BenchCase[], exclusions: Exclusion[]): Ratchet {
  const companionCounts = Object.values(PINNED_COMPANION.accounting)
  const observed: Ratchet['observed'] = {
    importedCases: cases.length + 68 + companionCounts.reduce((sum, row) => sum + row.importedCases, 0),
    importedBlocks: cases.reduce((sum, c) => sum + c.upstream.blocks.length, 0) + 68 + companionCounts.reduce((sum, row) => sum + row.importedBlocks, 0),
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
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([family, values]) => [family, sortRecord(values)]),
    ),
  }
}

function sortRecord(values: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(values).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)))
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

function classifyBlock(block: TestBlock):
  | { kind: 'case'; source: string; structured: boolean; nodes: number; edges: number; groups: number; labels: string[] }
  | { kind: 'exclude'; reason: string; summary: string; source?: string; ours?: Exclusion['ours'] } {
  const sources = sourceLiterals(block.body).filter(source => !source.includes('${expr}'))
  if (isNegativeTest(block.body)) {
    return {
      kind: 'exclude',
      reason: 'upstream-negative',
      summary: 'The upstream block asserts that this input throws or is rejected. BUILD-20 imports positive portable parser/DB behavior as cases and marks upstream negative coverage WONTFIX with Mermaid.js provenance.',
      source: sources[0],
      ours: sources[0] ? localBehavior(sources[0], block.family) : undefined,
    }
  }
  if (sources.length === 0) {
    return {
      kind: 'exclude',
      reason: 'api-internal',
      summary: 'The upstream block exercises parser database helper state, renderer DOM details, mocks, shape factories, or generated/table-driven inputs rather than a direct portable Mermaid source string.',
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
    summary: `The upstream source is positive parser coverage, but parseMermaid currently rejects it${firstParseFailure ? ` (${firstParseFailure})` : ''}.`,
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
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('%%'))
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
  return false
}

function isDeclarationOnlyFlowchartSource(source: string, diagram: ValidDiagram): boolean {
  if (diagram.body.kind !== 'flowchart') return false
  const graph = diagram.body.graph
  if (graph.nodes.size > 0 || graph.edges.length > 0 || graph.subgraphs.length > 0) return false
  const statements = source.split(/[;\n]/).map(line => line.trim()).filter(Boolean)
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
    structured: Boolean(narrowers[family](parsed.value)),
    verifyOk: verification.ok,
    layoutOk,
  }
}

function safeVerify(diagram: ValidDiagram): { ok: boolean } {
  try {
    return verifyMermaid(diagram)
  } catch {
    return { ok: false }
  }
}

function exclusionForBlock(block: TestBlock, reason: string, summary: string, source?: string, ours?: Exclusion['ours']): Exclusion {
  const isWontfix = !LOCAL_GAP_REASONS.has(reason)
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

function extractTestBlocks(text: string, family: Family, file: string): TestBlock[] {
  const blocks: TestBlock[] = []
  const re = /\b(?:it|test)\s*(?:\.each\s*\([\s\S]*?\))?\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    let p = re.lastIndex
    while (/\s/.test(text[p] ?? '')) p++
    if (text[p] !== ',') continue
    p++
    while (/\s/.test(text[p] ?? '')) p++
    const brace = text.indexOf('{', p)
    if (brace < 0 || brace - p > 300) continue
    const end = findMatchingBrace(text, brace)
    if (end < 0) continue
    blocks.push({ family, file, name: unescapeDescription(m[2] ?? 'unnamed upstream block'), body: text.slice(p, end + 1) })
    re.lastIndex = end + 1
  }
  return blocks
}

function findMatchingBrace(text: string, start: number): number {
  let depth = 0
  let quote: '"' | "'" | '`' | null = null
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (escaped) {
      escaped = false
      continue
    }
    if (quote) {
      if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function sourceLiterals(body: string): string[] {
  const values: string[] = []
  const re = /(?:`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const value = unquote(m[0])
    if (headerPattern.test(value) && value.split(/\r?\n/).length < 220) values.push(value.trim())
  }
  return [...new Set(values)]
}

function unquote(raw: string): string {
  if (raw[0] === '`') {
    const withoutInterpolation = raw.replace(/\$\{[^}]*\}/g, '\\${expr}')
    try {
      return Function(`return ${withoutInterpolation}`)() as string
    } catch {
      return raw.slice(1, -1).replace(/\$\{[^}]*\}/g, '${expr}')
    }
  }
  try {
    return Function(`return ${raw}`)() as string
  } catch {
    return raw.slice(1, -1)
  }
}

function isNegativeTest(body: string): boolean {
  return /\.(?:toThrow|toThrowError)\s*\(|rejects\.|throws/.test(body) && !/not\.toThrow/.test(body)
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

function unescapeDescription(text: string): string {
  return text.replace(/\\([`"'])/g, '$1').replace(/\s+/g, ' ').trim()
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

main()
