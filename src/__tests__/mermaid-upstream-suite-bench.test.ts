import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import {
  asArchitecture, asClass, asEr, asFlowchart, asGantt, asJourney, asPie, asQuadrant, asSequence, asState, asTimeline, asXyChart, asMindmap, asGitGraph,
  layoutMermaid, parseMermaid, serializeMermaid, verifyMermaid,
} from '../agent/index.ts'
import type { DiagramKind, ValidDiagram } from '../agent/types.ts'
import { countStructuralElements, isDrop } from '../agent/structural-count.ts'
import { stripFormattingTags } from '../multiline-utils.ts'

interface BenchCase {
  id: string
  family: string
  source: string
  upstream: { repo: string; files: string[]; blocks: string[] }
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

interface Exclusion {
  id: string
  families: string[]
  reason: string
  disposition?: 'WONTFIX'
  summary: string
  blockCount?: number
  tracking?: { issue: string; owner: string; lane: string; priority: string; target: string }
  upstream?: { repo: string; files: string[]; blocks: string[] }
  source?: string
  ours?: { parseOk?: boolean; structured?: boolean; verifyOk?: boolean; layoutOk?: boolean; roundtripOk?: boolean }
}

interface Manifest {
  upstream: { repo: string; revision: string; branch: string; harvestDate: string; license: string }
  families: Array<{
    family: string
    status: string
    consideredBlocks: number
    importedCases: number
    importedBlocks: number
    excludedBlocks: number
    deferredBlocks: number
    files: Array<{ path: string; testBlocks: number }>
    companionBench?: string
    compatibilityRevision?: string
  }>
}

interface CompanionOracle {
  upstream: { commit: string }
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
const manifest = JSON.parse(readFileSync(join(ROOT, 'eval/mermaid-upstream-suite-bench/manifest.json'), 'utf8')) as Manifest
const cases = JSON.parse(readFileSync(join(ROOT, 'eval/mermaid-upstream-suite-bench/cases.json'), 'utf8')) as BenchCase[]
const exclusions = JSON.parse(readFileSync(join(ROOT, 'eval/mermaid-upstream-suite-bench/exclusions.json'), 'utf8')) as Exclusion[]
const ratchet = JSON.parse(readFileSync(join(ROOT, 'eval/mermaid-upstream-suite-bench/ratchet.json'), 'utf8')) as Ratchet
const companionOracle = JSON.parse(readFileSync(join(ROOT, 'eval/mermaid-upstream-suite-bench/mindmap-gitgraph-f3dea583.json'), 'utf8')) as CompanionOracle
const companionFamilies = new Set(Object.keys(companionOracle.accounting))
const documentedReasons = new Set([
  'api-internal',
  'upstream-negative',
  'local-parse-gap',
  'local-verify-gap',
  'local-layout-gap',
  'local-roundtrip-gap',
  'unsupported-header',
  'unsupported-syntax',
  'unsupported-structured-syntax',
  'unextracted-dynamic-source',
])
const localGapReasons = new Set(['local-parse-gap', 'local-verify-gap', 'local-layout-gap', 'local-roundtrip-gap', 'unsupported-header', 'unsupported-syntax', 'unsupported-structured-syntax'])
const narrowerByFamily: Record<DiagramKind, (d: ValidDiagram) => ValidDiagram | null> = {
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
  gantt: asGantt,
  mindmap: asMindmap,
  gitgraph: asGitGraph,
}

function layoutLabels(layout: ReturnType<typeof layoutMermaid>): string[] {
  const labels: string[] = []
  for (const n of layout.nodes) if (n.label) labels.push(n.label)
  for (const e of layout.edges) if (e.label?.text) labels.push(e.label.text)
  for (const g of layout.groups) if (g.label) labels.push(g.label)
  return labels.map(stripFormattingTags)
}

function safeVerifyOk(diagram: ValidDiagram): boolean {
  try {
    return verifyMermaid(diagram).ok
  } catch {
    return false
  }
}

function localGapBudget(): LocalGapBudget {
  const budget: LocalGapBudget = { totalBlocks: 0, byReason: {}, byFamily: {}, byFamilyReason: {} }
  for (const e of exclusions) {
    if (!localGapReasons.has(e.reason)) continue
    const count = e.blockCount ?? e.upstream?.blocks.length ?? 1
    budget.totalBlocks += count
    budget.byReason[e.reason] = (budget.byReason[e.reason] ?? 0) + count
    for (const family of e.families) {
      budget.byFamily[family] = (budget.byFamily[family] ?? 0) + count
      budget.byFamilyReason[family] ??= {}
      budget.byFamilyReason[family]![e.reason] = (budget.byFamilyReason[family]![e.reason] ?? 0) + count
    }
  }
  return {
    totalBlocks: budget.totalBlocks,
    byReason: sortRecord(budget.byReason),
    byFamily: sortRecord(budget.byFamily),
    byFamilyReason: Object.fromEntries(Object.entries(budget.byFamilyReason).sort(([a], [b]) => a.localeCompare(b)).map(([family, values]) => [family, sortRecord(values)])),
  }
}

function sortRecord(values: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(values).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)))
}

function expectBudgetAtOrBelow(observed: LocalGapBudget, budget: LocalGapBudget): void {
  expect(observed.totalBlocks).toBeLessThanOrEqual(budget.totalBlocks)
  for (const [reason, count] of Object.entries(observed.byReason)) expect(count).toBeLessThanOrEqual(budget.byReason[reason] ?? 0)
  for (const [family, count] of Object.entries(observed.byFamily)) expect(count).toBeLessThanOrEqual(budget.byFamily[family] ?? 0)
  for (const [family, reasons] of Object.entries(observed.byFamilyReason)) {
    for (const [reason, count] of Object.entries(reasons)) expect(count).toBeLessThanOrEqual(budget.byFamilyReason[family]?.[reason] ?? 0)
  }
}

describe('BUILD-20 Mermaid upstream parser/DB bench', () => {
  it('keeps the committed case corpus in canonical two-space JSON', () => {
    const path = join(ROOT, 'eval/mermaid-upstream-suite-bench/cases.json')
    const text = readFileSync(path, 'utf8')
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2) + '\n')
  })

  it('has a manifest row and portable upstream-derived case for every renderable built-in family', () => {
    const covered = new Set(cases.map(c => c.family))
    const manifested = new Set(manifest.families.map(f => f.family))
    const renderable = BUILTIN_FAMILY_METADATA.map(f => f.id)
    expect(renderable.length).toBeGreaterThan(0)
    expect(manifest.upstream).toEqual(expect.objectContaining({
      repo: 'mermaid-js/mermaid',
      revision: 'a2d9686451df7c4644a3eeca20535bbd4c5776b0',
      license: 'MIT',
    }))
    for (const family of renderable) {
      expect(manifested.has(family)).toBe(true)
      const row = manifest.families.find(f => f.family === family)
      expect(covered.has(family) || Boolean(row?.companionBench && row.importedCases > 0)).toBe(true)
    }
  })

  it('keeps manifest counts internally consistent with imported cases', () => {
    const casesByFamily = new Map<string, number>()
    const importedBlocksByFamily = new Map<string, number>()
    const excludedBlocksByFamily = new Map<string, number>()
    for (const c of cases) {
      casesByFamily.set(c.family, (casesByFamily.get(c.family) ?? 0) + 1)
      importedBlocksByFamily.set(c.family, (importedBlocksByFamily.get(c.family) ?? 0) + c.upstream.blocks.length)
    }
    for (const e of exclusions) {
      for (const family of e.families) excludedBlocksByFamily.set(family, (excludedBlocksByFamily.get(family) ?? 0) + (e.blockCount ?? e.upstream?.blocks.length ?? 1))
    }
    for (const row of manifest.families) {
      const fileBlocks = row.files.reduce((sum, f) => sum + f.testBlocks, 0)
      if (row.family !== 'gantt') expect(fileBlocks).toBe(row.consideredBlocks)
      if (row.family === 'gantt') {
        expect(row.importedCases).toBe(68)
        expect(row.importedBlocks).toBe(68)
        expect(row.excludedBlocks).toBe(0)
      } else if (companionFamilies.has(row.family)) {
        const accounting = companionOracle.accounting[row.family as 'mindmap' | 'gitgraph']
        expect(row).toMatchObject(accounting)
        expect(row.compatibilityRevision).toBe(companionOracle.upstream.commit)
        expect(row.companionBench).toBe('src/__tests__/mindmap-gitgraph-upstream-oracle.test.ts')
      } else {
        expect(row.importedCases).toBe(casesByFamily.get(row.family) ?? 0)
        expect(row.importedBlocks).toBe(importedBlocksByFamily.get(row.family) ?? 0)
        expect(row.excludedBlocks).toBe(excludedBlocksByFamily.get(row.family) ?? 0)
      }
      expect(row.importedBlocks + row.excludedBlocks + row.deferredBlocks).toBe(row.consideredBlocks)
      expect(row.deferredBlocks).toBe(0)
      expect(row.importedCases).toBeGreaterThan(0)
    }
  })

  it('keeps imported coverage above the ratchet floor and local gaps within budget', () => {
    const companionCounts = Object.values(companionOracle.accounting)
    const importedCases = cases.length + 68 + companionCounts.reduce((sum, row) => sum + row.importedCases, 0)
    const importedBlocks = cases.reduce((sum, c) => sum + c.upstream.blocks.length, 0) + 68 + companionCounts.reduce((sum, row) => sum + row.importedBlocks, 0)
    const observedLocalGaps = localGapBudget()

    expect(ratchet.version).toBe(1)
    expect(ratchet.upstreamRevision).toBe(manifest.upstream.revision)
    expect(importedCases).toBeGreaterThanOrEqual(ratchet.budgets.importedCaseFloor)
    expect(importedBlocks).toBeGreaterThanOrEqual(ratchet.budgets.importedBlockFloor)
    expect(ratchet.observed.importedCases).toBe(importedCases)
    expect(ratchet.observed.importedBlocks).toBe(importedBlocks)
    expect(ratchet.observed.localGaps).toEqual(observedLocalGaps)
    expectBudgetAtOrBelow(observedLocalGaps, ratchet.budgets.localGaps)
  })

  it('records upstream provenance and uses documented exclusion reasons', () => {
    const caseIds = new Set<string>()
    for (const c of cases) {
      expect(caseIds.has(c.id)).toBe(false)
      caseIds.add(c.id)
      expect(c.id).toMatch(/^[a-z0-9-]+$/)
      expect(c.upstream.repo).toBe('mermaid-js/mermaid')
      expect(c.upstream.files.length).toBeGreaterThan(0)
      expect(c.upstream.blocks.length).toBeGreaterThan(0)
    }
    for (const e of exclusions) {
      expect(documentedReasons.has(e.reason)).toBe(true)
      expect(e.summary.length).toBeGreaterThan(20)
      expect(e.families.length).toBeGreaterThan(0)
      expect(e.blockCount ?? e.upstream?.blocks.length ?? 1).toBeGreaterThan(0)
      if (e.upstream) {
        expect(e.upstream.repo).toBe('mermaid-js/mermaid')
        expect(e.upstream.files.length).toBeGreaterThan(0)
        expect(e.upstream.blocks.length).toBeGreaterThan(0)
      }
      if (localGapReasons.has(e.reason)) {
        expect(e.disposition).toBeUndefined()
        expect(e.tracking).toEqual(expect.objectContaining({
          issue: expect.stringMatching(/^#[0-9]+$/),
          owner: 'BUILD-20',
          target: 'convert-to-case',
        }))
        expect(e.tracking!.lane).toMatch(/^[a-z0-9-]+-parity$/)
        expect(['P0', 'P1', 'P2', 'P3']).toContain(e.tracking!.priority)
      } else {
        expect(e.disposition).toBe('WONTFIX')
        expect(e.tracking).toBeUndefined()
        expect(e.source).toBeUndefined()
        expect(e.ours).toBeUndefined()
        expect(e.upstream).toEqual(expect.objectContaining({
          repo: 'mermaid-js/mermaid',
          files: expect.any(Array),
          blocks: expect.any(Array),
        }))
        expect(e.upstream!.files.length).toBeGreaterThan(0)
        expect(e.upstream!.blocks.length).toBeGreaterThan(0)
      }
    }
  })

  for (const c of cases) {
    it(`${c.id} parses, verifies, and lays out via public APIs`, () => {
      const parsed = parseMermaid(c.source)
      expect(parsed.ok, parsed.ok ? '' : parsed.error.map(e => e.message).join('; ')).toBe(true)
      if (!parsed.ok) return
      expect(String(parsed.value.kind)).toBe(c.family)
      const narrowed = narrowerByFamily[c.family as DiagramKind](parsed.value)
      if (c.assertions.expectStructured === false) expect(narrowed).toBeNull()
      else expect(narrowed).not.toBeNull()

      const verification = verifyMermaid(parsed.value)
      expect(verification.ok, JSON.stringify(verification.warnings)).toBe(true)

      const layout = layoutMermaid(parsed.value)
      if (c.assertions.nodeCount !== undefined) expect(layout.nodes.length).toBe(c.assertions.nodeCount)
      if (c.assertions.edgeCount !== undefined) expect(layout.edges.length).toBe(c.assertions.edgeCount)
      if (c.assertions.groupCount !== undefined) expect(layout.groups.length).toBe(c.assertions.groupCount)
      if (c.assertions.minNodes !== undefined) expect(layout.nodes.length).toBeGreaterThanOrEqual(c.assertions.minNodes)
      if (c.assertions.minEdges !== undefined) expect(layout.edges.length).toBeGreaterThanOrEqual(c.assertions.minEdges)
      if (c.assertions.minGroups !== undefined) expect(layout.groups.length).toBeGreaterThanOrEqual(c.assertions.minGroups)

      const labels = layoutLabels(layout).join('\n')
      for (const label of c.assertions.labelsContain ?? []) expect(labels).toContain(label)

      const serialized = serializeMermaid(parsed.value)
      const reparsed = parseMermaid(serialized)
      expect(reparsed.ok, reparsed.ok ? '' : reparsed.error.map(e => e.message).join('; ')).toBe(true)
      if (reparsed.ok) {
        expect(serializeMermaid(reparsed.value)).toBe(serialized)
        // Faithfulness count-oracle (unifies the three differential gates on one
        // check): byte-stability above proves serialize∘parse is idempotent;
        // this proves no node/edge/group was silently dropped on the way.
        const before = countStructuralElements(parsed.value)
        const after = countStructuralElements(reparsed.value)
        // Route through the shared verdict (Move 3). Keep this gate's original
        // lenient policy: a structured body that re-parses to OPAQUE (after=null)
        // is owned by the byte round-trip check above, not flagged here.
        if (before && after) expect({ id: c.id, drop: isDrop(before, after), before, after }).toEqual({ id: c.id, drop: false, before, after })
      }
    })
  }

  describe('exclusions with local expectations are executable', () => {
    for (const e of exclusions.filter(e => e.source && e.ours)) {
      it(`${e.id} matches the documented local behavior`, () => {
        const parsed = parseMermaid(e.source!)
        if (e.ours!.parseOk !== undefined) expect(parsed.ok).toBe(e.ours!.parseOk)
        if (!parsed.ok) return
        const expectedFamily = e.families[0] as DiagramKind
        if (e.ours!.structured !== undefined) expect(Boolean(narrowerByFamily[expectedFamily](parsed.value))).toBe(e.ours!.structured)
        if (e.ours!.verifyOk !== undefined) expect(safeVerifyOk(parsed.value)).toBe(e.ours!.verifyOk)
        if (e.ours!.layoutOk !== undefined) {
          let layoutOk = true
          try { layoutMermaid(parsed.value) } catch { layoutOk = false }
          expect(layoutOk).toBe(e.ours!.layoutOk)
        }
        if (e.ours!.roundtripOk !== undefined) {
          let roundtripOk = false
          const serialized = serializeMermaid(parsed.value)
          const reparsed = parseMermaid(serialized)
          if (reparsed.ok) roundtripOk = serializeMermaid(reparsed.value) === serialized
          expect(roundtripOk).toBe(e.ours!.roundtripOk)
        }
      })
    }
  })
})
