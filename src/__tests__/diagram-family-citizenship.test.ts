import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { BUILTIN_FAMILY_METADATA, type BuiltinFamilyId } from '../agent/families.ts'
import { MUTATION_OPS_BY_FAMILY } from '../cli/index.ts'

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

const TRACKED_EXCEPTION_SURFACES = new Set(['stableRegions', 'upstreamHarvest', 'divergenceLedger', 'mutationLane'])

type SurfaceId = typeof EXPECTED_SURFACES[number]

const REQUIRED_FAMILY_EVIDENCE = {
  flowchart: {
    semanticModel: ['src/agent/flowchart-body.ts'],
    serializeRoundTrip: ['src/__tests__/flowchart-parser-conformance.test.ts'],
    domainProperties: ['src/__tests__/route-contracts.test.ts'],
    stableRegions: ['src/__tests__/agent-ascii-meta.test.ts'],
    mutationLane: ['stryker.link-grammar.config.json'],
  },
  state: {
    semanticModel: ['src/agent/state-body.ts'],
    serializeRoundTrip: ['src/__tests__/agent-state.test.ts'],
    domainProperties: ['src/__tests__/agent-state.test.ts'],
  },
  sequence: {
    semanticModel: ['src/agent/sequence-body.ts'],
    serializeRoundTrip: ['src/__tests__/agent-mermaidseqbench.test.ts'],
    domainProperties: ['src/__tests__/ascii-sequence-blocks.test.ts'],
    stableRegions: ['src/__tests__/agent-ascii-meta.test.ts'],
  },
  timeline: {
    semanticModel: ['src/agent/timeline-body.ts'],
    serializeRoundTrip: ['src/__tests__/timeline-parser.test.ts'],
    domainProperties: ['src/__tests__/timeline-layout.test.ts'],
    goldensEvidence: ['src/__tests__/timeline-ascii.test.ts'],
  },
  class: {
    semanticModel: ['src/agent/class-body.ts'],
    serializeRoundTrip: ['src/__tests__/class-parser.test.ts'],
    domainProperties: ['src/__tests__/class-er-edge-quality.test.ts'],
    goldensEvidence: ['src/__tests__/class-integration.test.ts'],
  },
  er: {
    semanticModel: ['src/agent/er-body.ts'],
    serializeRoundTrip: ['src/__tests__/er-parser.test.ts'],
    domainProperties: ['src/__tests__/class-er-edge-quality.test.ts'],
    goldensEvidence: ['src/__tests__/er-integration.test.ts'],
  },
  journey: {
    semanticModel: ['src/agent/journey-body.ts'],
    serializeRoundTrip: ['src/__tests__/journey-parser.test.ts'],
    domainProperties: ['src/__tests__/journey-layout.test.ts'],
    goldensEvidence: ['src/__tests__/journey-svg-snapshot.test.ts'],
  },
  architecture: {
    semanticModel: ['src/agent/architecture-body.ts'],
    serializeRoundTrip: ['src/__tests__/architecture-parser.test.ts'],
    domainProperties: ['src/__tests__/architecture-layout.test.ts'],
    mutationLane: ['stryker.families.config.json'],
  },
  xychart: {
    semanticModel: ['src/agent/xychart-body.ts'],
    serializeRoundTrip: ['src/__tests__/xychart-parser.test.ts'],
    domainProperties: ['src/__tests__/property-xychart.test.ts'],
    mutationLane: ['stryker.families.config.json'],
  },
  pie: {
    semanticModel: ['src/agent/pie-body.ts'],
    serializeRoundTrip: ['src/__tests__/pie.test.ts'],
    domainProperties: ['src/__tests__/pie.test.ts'],
    goldensEvidence: ['src/__tests__/pie.test.ts'],
  },
  quadrant: {
    semanticModel: ['src/agent/quadrant-body.ts'],
    serializeRoundTrip: ['src/__tests__/quadrant.test.ts'],
    domainProperties: ['src/__tests__/quadrant.test.ts'],
    goldensEvidence: ['src/__tests__/quadrant.test.ts'],
  },
  gantt: {
    semanticModel: ['src/gantt/schedule.ts'],
    serializeRoundTrip: ['src/__tests__/agent-gantt.test.ts'],
    domainProperties: ['src/__tests__/property-gantt-schedule.test.ts'],
    stableRegions: ['src/__tests__/agent-gantt.test.ts'],
    upstreamHarvest: ['eval/mermaid-gantt-bench/cases.json'],
    divergenceLedger: ['eval/mermaid-gantt-bench/exclusions.json'],
    goldensEvidence: ['docs/assets/improvements/gantt-family.png'],
    mutationLane: ['stryker.gantt.config.json'],
  },
} satisfies Record<BuiltinFamilyId, Partial<Record<SurfaceId, readonly string[]>>>

const AUDITED_NON_GANTT_EXCEPTIONS = {
  xychart: {
    stableRegions: ['TODO:BUILD-22'],
    upstreamHarvest: ['TODO:BUILD-20'],
    divergenceLedger: ['TODO:BUILD-20', 'TODO:BUILD-22'],
  },
} satisfies Partial<Record<BuiltinFamilyId, Partial<Record<SurfaceId, readonly string[]>>>>

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

  test('core citizenship surfaces cannot be deferred as exceptions', () => {
    const matrix = loadMatrix()
    const mustBeSatisfied = EXPECTED_SURFACES.filter(s => !TRACKED_EXCEPTION_SURFACES.has(s))
    for (const [family, row] of Object.entries(matrix.families)) {
      for (const surface of mustBeSatisfied) {
        expect({ family, surface, status: row.cells[surface].status }).toEqual({ family, surface, status: 'satisfied' })
      }
    }
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
      const configs = strykerEvidence.map(e => readFileSync(join(REPO, e), 'utf8').toLowerCase()).join('\n')
      const familyNeedle = family.id === 'flowchart' ? 'src/parser.ts' : `src/${family.id}`
      expect({ family: family.id, familyNeedle, covered: configs.includes(familyNeedle) })
        .toEqual({ family: family.id, familyNeedle, covered: true })
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
    expect(xychart.cells.mutationLane.evidence).toContain('stryker.families.config.json')
    for (const [surface, tracked] of Object.entries(AUDITED_NON_GANTT_EXCEPTIONS.xychart) as Array<[SurfaceId, readonly string[]]>) {
      expect({ family: 'xychart', surface, status: xychart.cells[surface].status }).toEqual({ family: 'xychart', surface, status: 'exception' })
      expect(xychart.cells[surface].tracked).toEqual([...tracked])
    }
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
  })
})
