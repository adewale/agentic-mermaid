import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { BUILTIN_FAMILY_METADATA, type BuiltinFamilyId } from '../agent/families.ts'
import { MUTATION_OPS_BY_FAMILY } from '../cli/index.ts'
import { parseMermaid, verifyMermaid, serializeMermaid, renderMermaidSVG, renderMermaidASCII } from '../agent/index.ts'
import { FAMILY_COUNT_FIXTURES } from './helpers/family-count-fixtures.ts'

const REPO = join(import.meta.dir, '..', '..')
const MATRIX_PATH = join(REPO, 'docs/contributing/diagram-family-citizenship.matrix.json')

const EXPECTED_SURFACES = [
  'registryDiscovery',
  'detectionParse',
  'semanticModel',
  'serializeRoundTrip',
  'typedMutation',
  'verifyRenderSeam',
  'determinism',
  'svgRender',
  'asciiUnicodeRender',
  'layoutProjection',
  'stableRegions',
  'editorExample',
  'docsAgentSurfaces',
  'evalFixture',
  'upstreamHarvest',
  'divergenceLedger',
  'domainProperties',
  'goldensEvidence',
  'generatedSite',
  'distributionPackage',
  'mutationLane',
] as const

// Previously four surfaces could ship as tracked 'exception's. The backfill (#49)
// drove the matrix to zero exceptions, so the contract now admits NONE: every
// family must satisfy every surface. Any regression back to an 'exception' fails
// both "every exception is tracked" and "core surfaces cannot be deferred". (#41)
const TRACKED_EXCEPTION_SURFACES = new Set<SurfaceId>()

type SurfaceId = typeof EXPECTED_SURFACES[number]

const MUTATION_CONFIG_NEEDLES = {
  flowchart: ['src/parser.ts'],
  state: ['src/agent/state-body.ts'],
  sequence: ['src/agent/sequence-body.ts', 'src/sequence/parser.ts'],
  timeline: ['src/agent/timeline-body.ts', 'src/timeline/parser.ts'],
  class: ['src/agent/class-body.ts', 'src/class/parser.ts'],
  er: ['src/agent/er-body.ts', 'src/er/parser.ts'],
  journey: ['src/agent/journey-body.ts', 'src/journey/parser.ts'],
  architecture: ['src/architecture/parser.ts'],
  xychart: ['src/xychart/parser.ts'],
  pie: ['src/agent/pie-body.ts', 'src/pie/parser.ts'],
  quadrant: ['src/agent/quadrant-body.ts', 'src/quadrant/parser.ts'],
  gantt: ['src/gantt/parser.ts'],
} satisfies Record<BuiltinFamilyId, readonly string[]>

const REQUIRED_FAMILY_EVIDENCE = {
  flowchart: {
    semanticModel: ['src/agent/flowchart-body.ts'],
    serializeRoundTrip: ['src/__tests__/flowchart-parser-conformance.test.ts'],
    domainProperties: ['src/__tests__/route-contracts.test.ts'],
    stableRegions: ['src/__tests__/agent-ascii-meta.test.ts'],
    upstreamHarvest: ['eval/mermaid-docs-corpus/corpus.json'],
    divergenceLedger: ['eval/mermaid-docs-corpus/divergences.json'],
    mutationLane: ['stryker.link-grammar.config.json'],
  },
  state: {
    semanticModel: ['src/agent/state-body.ts'],
    serializeRoundTrip: ['src/__tests__/agent-state.test.ts'],
    domainProperties: ['src/__tests__/agent-state.test.ts'],
    stableRegions: ['src/__tests__/agent-ascii-meta.test.ts'],
    upstreamHarvest: ['eval/mermaid-docs-corpus/corpus.json'],
    divergenceLedger: ['eval/mermaid-docs-corpus/divergences.json'],
    mutationLane: ['stryker.state.config.json'],
  },
  sequence: {
    semanticModel: ['src/agent/sequence-body.ts'],
    serializeRoundTrip: ['src/__tests__/agent-mermaidseqbench.test.ts'],
    domainProperties: ['src/__tests__/ascii-sequence-blocks.test.ts'],
    stableRegions: ['src/__tests__/agent-ascii-meta.test.ts'],
    upstreamHarvest: ['eval/mermaidseqbench/data.csv'],
    divergenceLedger: ['eval/mermaid-docs-corpus/divergences.json'],
    mutationLane: ['stryker.sequence.config.json'],
  },
  timeline: {
    semanticModel: ['src/agent/timeline-body.ts'],
    serializeRoundTrip: ['src/__tests__/timeline-parser.test.ts'],
    domainProperties: ['src/__tests__/timeline-layout.test.ts'],
    goldensEvidence: ['src/__tests__/timeline-ascii.test.ts'],
    stableRegions: ['src/__tests__/agent-ascii-meta.test.ts'],
    upstreamHarvest: ['eval/mermaid-docs-corpus/corpus.json'],
    divergenceLedger: ['eval/mermaid-docs-corpus/divergences.json'],
    mutationLane: ['stryker.timeline.config.json'],
  },
  class: {
    semanticModel: ['src/agent/class-body.ts'],
    serializeRoundTrip: ['src/__tests__/class-parser.test.ts'],
    domainProperties: ['src/__tests__/class-er-edge-quality.test.ts'],
    goldensEvidence: ['src/__tests__/class-integration.test.ts'],
    stableRegions: ['src/__tests__/agent-ascii-meta.test.ts'],
    upstreamHarvest: ['eval/mermaid-docs-corpus/corpus.json'],
    divergenceLedger: ['eval/mermaid-docs-corpus/divergences.json'],
    mutationLane: ['stryker.class.config.json'],
  },
  er: {
    semanticModel: ['src/agent/er-body.ts'],
    serializeRoundTrip: ['src/__tests__/er-parser.test.ts'],
    domainProperties: ['src/__tests__/class-er-edge-quality.test.ts'],
    goldensEvidence: ['src/__tests__/er-integration.test.ts'],
    stableRegions: ['src/__tests__/agent-ascii-meta.test.ts'],
    upstreamHarvest: ['eval/mermaid-docs-corpus/corpus.json'],
    divergenceLedger: ['eval/mermaid-docs-corpus/divergences.json'],
    mutationLane: ['stryker.er.config.json'],
  },
  journey: {
    semanticModel: ['src/agent/journey-body.ts'],
    serializeRoundTrip: ['src/__tests__/journey-parser.test.ts'],
    domainProperties: ['src/__tests__/journey-layout.test.ts'],
    goldensEvidence: ['src/__tests__/journey-svg-snapshot.test.ts'],
    stableRegions: ['src/__tests__/agent-ascii-meta.test.ts'],
    upstreamHarvest: ['eval/mermaid-docs-corpus/corpus.json'],
    divergenceLedger: ['eval/mermaid-docs-corpus/divergences.json'],
    mutationLane: ['stryker.journey.config.json'],
  },
  architecture: {
    semanticModel: ['src/agent/architecture-body.ts'],
    serializeRoundTrip: ['src/__tests__/architecture-parser.test.ts'],
    domainProperties: ['src/__tests__/architecture-layout.test.ts'],
    stableRegions: ['src/__tests__/agent-ascii-meta.test.ts'],
    upstreamHarvest: ['eval/mermaid-docs-corpus/corpus.json'],
    divergenceLedger: ['eval/mermaid-docs-corpus/divergences.json'],
    mutationLane: ['stryker.families.config.json'],
  },
  xychart: {
    semanticModel: ['src/agent/xychart-body.ts'],
    serializeRoundTrip: ['src/__tests__/xychart-parser.test.ts'],
    domainProperties: ['src/__tests__/property-xychart.test.ts'],
    stableRegions: ['src/__tests__/agent-ascii-meta.test.ts'],
    upstreamHarvest: ['eval/mermaid-docs-corpus/corpus.json'],
    divergenceLedger: ['eval/mermaid-docs-corpus/divergences.json'],
    mutationLane: ['stryker.families.config.json'],
  },
  pie: {
    semanticModel: ['src/agent/pie-body.ts'],
    serializeRoundTrip: ['src/__tests__/pie.test.ts'],
    domainProperties: ['src/__tests__/pie.test.ts'],
    goldensEvidence: ['src/__tests__/pie.test.ts'],
    stableRegions: ['src/__tests__/agent-ascii-meta.test.ts'],
    upstreamHarvest: ['eval/mermaid-docs-corpus/corpus.json'],
    divergenceLedger: ['eval/mermaid-docs-corpus/divergences.json'],
    mutationLane: ['stryker.pie.config.json'],
  },
  quadrant: {
    semanticModel: ['src/agent/quadrant-body.ts'],
    serializeRoundTrip: ['src/__tests__/quadrant.test.ts'],
    domainProperties: ['src/__tests__/quadrant.test.ts'],
    goldensEvidence: ['src/__tests__/quadrant.test.ts'],
    stableRegions: ['src/__tests__/agent-ascii-meta.test.ts'],
    upstreamHarvest: ['eval/mermaid-docs-corpus/corpus.json'],
    divergenceLedger: ['eval/mermaid-docs-corpus/divergences.json'],
    mutationLane: ['stryker.quadrant.config.json'],
  },
  gantt: {
    semanticModel: ['src/gantt/schedule.ts'],
    serializeRoundTrip: ['src/__tests__/agent-gantt.test.ts'],
    domainProperties: ['src/__tests__/property-gantt-schedule.test.ts'],
    stableRegions: ['src/__tests__/agent-ascii-meta.test.ts'],
    upstreamHarvest: ['eval/mermaid-gantt-bench/cases.json'],
    divergenceLedger: ['eval/mermaid-gantt-bench/exclusions.json'],
    goldensEvidence: ['docs/assets/improvements/gantt-family.png'],
    mutationLane: ['stryker.gantt.config.json'],
  },
} satisfies Record<BuiltinFamilyId, Partial<Record<SurfaceId, readonly string[]>>>

type Cell = { status: 'satisfied' | 'exception'; evidence: string[]; tracked?: string[]; note?: string }
type FamilyRow = { label: string; auditLevel: string; role: string; workedExample: boolean; cells: Record<SurfaceId, Cell> }
type Matrix = {
  schemaVersion: number
  updated: string
  statusValues: string[]
  surfaces: Array<{ id: SurfaceId; description: string }>
  families: Record<string, FamilyRow>
}

function loadMatrix(): Matrix {
  return JSON.parse(readFileSync(MATRIX_PATH, 'utf8')) as Matrix
}

function repoPathExists(ref: string): boolean {
  const path = ref.split('#', 1)[0]!
  return existsSync(join(REPO, path))
}

describe('diagram-family citizenship ratchet (issue #41)', () => {
  test('matrix schema and family rows cover the built-in registry exactly', () => {
    const matrix = loadMatrix()
    expect(matrix.schemaVersion).toBe(1)
    expect(matrix.statusValues).toEqual(['satisfied', 'exception'])
    expect(matrix.surfaces.map(s => s.id)).toEqual([...EXPECTED_SURFACES])
    for (const surface of matrix.surfaces) expect(surface.description.length).toBeGreaterThan(20)

    const registryIds = BUILTIN_FAMILY_METADATA.map(f => f.id).sort()
    const matrixIds = Object.keys(matrix.families).sort()
    expect(matrixIds).toEqual(registryIds)
    expect(Object.keys(MUTATION_OPS_BY_FAMILY).sort()).toEqual(registryIds)

    for (const family of BUILTIN_FAMILY_METADATA) {
      const row = matrix.families[family.id]
      expect({ family: family.id, present: Boolean(row) }).toEqual({ family: family.id, present: true })
      const checkedRow = row!
      expect(checkedRow.label).toBe(family.label)
      expect(new Set(Object.keys(checkedRow.cells))).toEqual(new Set(EXPECTED_SURFACES))
      expect(checkedRow.role.length).toBeGreaterThan(5)
    }
  })

  test('each cell has real evidence, and every exception is tracked', () => {
    const matrix = loadMatrix()
    const todo = readFileSync(join(REPO, 'TODO.md'), 'utf8')
    for (const [family, row] of Object.entries(matrix.families)) {
      for (const [surface, cell] of Object.entries(row.cells) as Array<[SurfaceId, Cell]>) {
        expect({ family, surface, status: cell.status }).toEqual({ family, surface, status: expect.stringMatching(/^(satisfied|exception)$/) })
        expect({ family, surface, evidence: cell.evidence.length }).toEqual({ family, surface, evidence: expect.any(Number) })
        expect(cell.evidence.length).toBeGreaterThan(0)
        for (const evidence of cell.evidence) {
          expect({ family, surface, evidence, exists: repoPathExists(evidence) }).toEqual({ family, surface, evidence, exists: true })
        }
        if (cell.status === 'exception') {
          expect({ family, surface, allowed: TRACKED_EXCEPTION_SURFACES.has(surface) }).toEqual({ family, surface, allowed: true })
          expect({ family, surface, tracked: cell.tracked?.length ?? 0 }).toEqual({ family, surface, tracked: expect.any(Number) })
          expect(cell.tracked?.length ?? 0).toBeGreaterThan(0)
          for (const ref of cell.tracked ?? []) {
            if (ref.startsWith('TODO:')) {
              const id = ref.slice('TODO:'.length)
              expect({ family, surface, ref, present: todo.includes(id) }).toEqual({ family, surface, ref, present: true })
            } else {
              expect(ref).toMatch(/^#\d+$/)
            }
          }
        }
      }
    }
  })

  test('citizenship backfill has no remaining matrix exceptions', () => {
    const matrix = loadMatrix()
    const exceptions = Object.entries(matrix.families).flatMap(([family, row]) =>
      Object.entries(row.cells).filter(([, cell]) => cell.status === 'exception').map(([surface]) => `${family}:${surface}`),
    )
    expect(exceptions).toEqual([])
  })

  test('core citizenship surfaces cannot be deferred as exceptions', () => {
    const matrix = loadMatrix()
    const mustBeSatisfied = EXPECTED_SURFACES.filter(s => !TRACKED_EXCEPTION_SURFACES.has(s))
    for (const [family, row] of Object.entries(matrix.families)) {
      for (const surface of mustBeSatisfied) {
        expect({ family, surface, status: row.cells[surface].status }).toEqual({ family, surface, status: 'satisfied' })
      }
    }
  })

  test('behavioral citizenship: every family parses, verifies, renders SVG+ASCII, round-trips, and is deterministic', () => {
    // Most matrix cells are evidenced by file-existence only. This test makes the
    // core surfaces (detectionParse, serializeRoundTrip, verifyRenderSeam,
    // svgRender, asciiUnicodeRender, determinism) behavioral: it actually exercises
    // the capability for every registered family, so a family that regressed while
    // its evidence file still existed would now fail here. (#41)
    const registryIds = new Set<string>(BUILTIN_FAMILY_METADATA.map(f => f.id))
    const covered = new Set<string>()
    for (const fx of FAMILY_COUNT_FIXTURES) {
      const parsed = parseMermaid(fx.source)
      expect({ family: fx.family, parseOk: parsed.ok }).toEqual({ family: fx.family, parseOk: true })
      if (!parsed.ok) continue
      covered.add(fx.family)

      // detectionParse: detected as the right family.
      expect({ family: fx.family, kind: parsed.value.kind }).toEqual({ family: fx.family, kind: fx.family })
      // verifyRenderSeam: structural verify passes.
      expect({ family: fx.family, verifyOk: verifyMermaid(fx.source).ok }).toEqual({ family: fx.family, verifyOk: true })
      // serializeRoundTrip: serialize → reparse → serialize is stable.
      const serialized = serializeMermaid(parsed.value)
      const reparsed = parseMermaid(serialized)
      expect({ family: fx.family, reparseOk: reparsed.ok }).toEqual({ family: fx.family, reparseOk: true })
      if (reparsed.ok) {
        expect({ family: fx.family, stable: serializeMermaid(reparsed.value) === serialized })
          .toEqual({ family: fx.family, stable: true })
      }
      // svgRender: emits a real SVG document.
      const svg = renderMermaidSVG(fx.source)
      expect({ family: fx.family, svg: svg.includes('<svg') && svg.length > 100 })
        .toEqual({ family: fx.family, svg: true })
      // asciiUnicodeRender: emits non-empty text.
      expect({ family: fx.family, ascii: renderMermaidASCII(fx.source).trim().length > 0 })
        .toEqual({ family: fx.family, ascii: true })
      // determinism: identical SVG across repeated renders.
      expect({ family: fx.family, deterministic: renderMermaidSVG(fx.source) === svg })
        .toEqual({ family: fx.family, deterministic: true })
    }
    // No registered family is silently skipped: each must have a behavioral fixture.
    expect([...registryIds].filter(id => !covered.has(id)).sort()).toEqual([])
  })

  test('family-sensitive cells cite load-bearing family-specific evidence', () => {
    const matrix = loadMatrix()
    for (const family of BUILTIN_FAMILY_METADATA) {
      const row = matrix.families[family.id]!
      const required = REQUIRED_FAMILY_EVIDENCE[family.id]
      for (const [surface, evidencePaths] of Object.entries(required) as Array<[SurfaceId, readonly string[]]>) {
        const cell = row.cells[surface]
        expect({ family: family.id, surface, status: cell.status }).toEqual({ family: family.id, surface, status: 'satisfied' })
        for (const evidence of evidencePaths) {
          expect({ family: family.id, surface, evidence, listed: cell.evidence.includes(evidence) })
            .toEqual({ family: family.id, surface, evidence, listed: true })
        }
      }
    }
  })

  test('satisfied mutation-lane evidence names an executable Stryker lane that mutates the family path', () => {
    const matrix = loadMatrix()
    for (const family of BUILTIN_FAMILY_METADATA) {
      const cell = matrix.families[family.id]!.cells.mutationLane
      if (cell.status !== 'satisfied') continue
      const strykerEvidence = cell.evidence.filter(e => e.startsWith('stryker.') && e.endsWith('.config.json'))
      expect({ family: family.id, strykerEvidence }).toEqual({ family: family.id, strykerEvidence: expect.arrayContaining([expect.any(String)]) })
      const configs = strykerEvidence.map(e => readFileSync(join(REPO, e), 'utf8')).join('\n')
      const needles = MUTATION_CONFIG_NEEDLES[family.id]
      expect({ family: family.id, needles, covered: needles.some(needle => configs.includes(needle)) })
        .toEqual({ family: family.id, needles, covered: true })
    }
  })

  test('Gantt is the worked example and at least one non-Gantt family is audited', () => {
    const matrix = loadMatrix()
    const worked = Object.entries(matrix.families).filter(([, row]) => row.workedExample).map(([id]) => id)
    expect(worked).toEqual(['gantt'])
    for (const [surface, cell] of Object.entries(matrix.families.gantt!.cells) as Array<[SurfaceId, Cell]>) {
      expect({ family: 'gantt', surface, status: cell.status }).toEqual({ family: 'gantt', surface, status: 'satisfied' })
    }

    const auditedNonGantt = Object.entries(matrix.families).filter(([id, row]) => id !== 'gantt' && row.auditLevel === 'audited')
    expect(auditedNonGantt.map(([id]) => id)).toContain('xychart')
    const xychart = matrix.families.xychart!
    expect(xychart.cells.semanticModel.evidence).toContain('src/agent/xychart-body.ts')
    expect(xychart.cells.domainProperties.evidence).toContain('src/__tests__/property-xychart.test.ts')
    expect(xychart.cells.stableRegions.evidence).toContain('src/__tests__/agent-ascii-meta.test.ts')
    expect(xychart.cells.upstreamHarvest.evidence).toContain('eval/mermaid-docs-corpus/corpus.json')
    expect(xychart.cells.divergenceLedger.evidence).toContain('eval/mermaid-docs-corpus/divergences.json')
    expect(xychart.cells.mutationLane.evidence).toContain('stryker.families.config.json')
  })

  test('reviewer-facing docs link the checklist, matrix, and follow-up ledger', () => {
    const citizenship = readFileSync(join(REPO, 'docs/contributing/diagram-family-citizenship.md'), 'utf8')
    const adding = readFileSync(join(REPO, 'docs/contributing/adding-diagram-types.md'), 'utf8')
    const docsIndex = readFileSync(join(REPO, 'docs/README.md'), 'utf8')
    const todo = readFileSync(join(REPO, 'TODO.md'), 'utf8')

    expect(citizenship).toContain('Worked example: Gantt')
    expect(citizenship).toContain('Non-Gantt audit: XY chart')
    expect(citizenship).toContain('diagram-family-citizenship.matrix.json')
    expect(adding).toContain('diagram-family citizenship matrix')
    expect(docsIndex).toContain('diagram-family-citizenship.md')
    expect(todo).toContain('BUILD-22 — Diagram-family citizenship gap backfill')
    expect(todo).toContain('docs-corpus citizenship backfill')
  })
})
