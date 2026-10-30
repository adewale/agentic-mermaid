import { asZenUML, asEventModeling } from '../agent/types.ts'
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { reviewedUpstreamCases } from '../../eval/mermaid-upstream-suite-bench/cases.ts'
import { asArchitecture, asC4, asClass, asEr, asFlowchart, asGantt, asGitGraph, asJourney, asMindmap, asPie, asQuadrant, asRadar, asSankey, asSequence, asState, asTimeline, asXyChart, layoutMermaid, parseRegisteredMermaid as parseMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { countStructuralElements, faithfulnessWarning } from '../agent/structural-count.ts'
import type { DiagramKind, ParsedDiagram, ValidDiagram } from '../agent/types.ts'
import { asBlock, asIshikawa, asKanban, asPacket, asRequirement, asTreemap } from '../agent/types.ts'
import { displayText } from '../multiline-utils.ts'

interface BenchCase {
  id: string
  family: string
  source: string
  upstream: { repo: string; files: string[]; blocks: string[] }
  assertions: {
    expectStructured?: boolean
    renderError?: string
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

const ROOT = process.cwd()
const cases: BenchCase[] = reviewedUpstreamCases(ROOT)
const exclusions = JSON.parse(readFileSync(join(ROOT, 'eval/mermaid-upstream-suite-bench/exclusions.json'), 'utf8')) as Exclusion[]
const narrowerByFamily: Record<DiagramKind, (d: ParsedDiagram) => ValidDiagram | null> = {
  zenuml: asZenUML,
  eventmodeling: asEventModeling,
  packet: asPacket,
  kanban: asKanban,
  requirement: asRequirement,
  treemap: asTreemap,
  ishikawa: asIshikawa,
  block: asBlock,
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
  gantt: asGantt,
  mindmap: asMindmap,
  gitgraph: asGitGraph,
  radar: asRadar,
  sankey: asSankey,
}

function layoutLabels(layout: ReturnType<typeof layoutMermaid>): string[] {
  const labels: string[] = []
  for (const n of layout.nodes) if (n.label) labels.push(n.label)
  for (const e of layout.edges) if (e.label?.text) labels.push(e.label.text)
  for (const g of layout.groups) if (g.label) labels.push(g.label)
  return labels.map(label => displayText(label))
}

function safeVerifyOk(diagram: ParsedDiagram): boolean {
  try {
    return verifyMermaid(diagram).ok
  } catch {
    return false
  }
}

describe('BUILD-20 Mermaid upstream parser/DB bench', () => {
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
      if (c.assertions.renderError) {
        // Unmodeled source must remain preserved and fail explicitly, never
        // count as a successful empty or partial drawing.
        expect(verification.ok).toBe(false)
        expect(verification.warnings.map(w => w.code)).toContain('RENDER_FAILED')
        expect(() => layoutMermaid(parsed.value)).toThrow(c.assertions.renderError)
        expect(serializeMermaid(parsed.value)).toBe(c.source + '\n')
        return
      }
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
      if (c.assertions.expectStructured === false) expect(serialized).toBe(c.source.endsWith('\n') ? c.source : c.source + '\n')
      const reparsed = parseMermaid(serialized)
      expect(reparsed.ok, reparsed.ok ? '' : reparsed.error.map(e => e.message).join('; ')).toBe(true)
      if (reparsed.ok) {
        expect(serializeMermaid(reparsed.value)).toBe(serialized)
        // Faithfulness count-oracle (unifies the three differential gates on one
        // check): byte-stability above proves serialize∘parse is idempotent;
        // this proves no node/edge/group was silently dropped on the way.
        const before = countStructuralElements(parsed.value)
        const after = countStructuralElements(reparsed.value)
        // A stable string is insufficient if writing silently removes typed
        // editability. Source-only input is checked against authored bytes above.
        if (before) {
          expect(after, `${c.id} lost its structured representation on reload`).not.toBeNull()
          if (after) expect({ id: c.id, drop: faithfulnessWarning(before, after).length > 0, before, after }).toEqual({ id: c.id, drop: false, before, after })
        }
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
          try {
            layoutMermaid(parsed.value)
          } catch {
            layoutOk = false
          }
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
