/**
 * Doc-sync tests — verify the library's public API matches its code registries.
 *
 * These tests ensure that:
 *   1. All built-in palette definitions have required color properties
 *   2. Every built-in family in the checked family registry renders
 *   3. All public exports from src/index.ts are real (not undefined)
 *   4. Package.json keywords include all supported diagram types
 */
import { describe, expect, it } from 'bun:test'
import type { BuiltinFamilyId } from '../agent/families.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { architectureToMermaidGraph, DEFAULTS, fromShikiTheme, inlineResolvedColors, parseArchitectureDiagram, parseRegisteredMermaid, renderMermaidASCII, renderMermaidSVG, renderMermaidSVGAsync, resolveColors } from '../index.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../palette-catalog.ts'
import type { DiagramColors } from '../theme.ts'

// ============================================================================
// 1. All named themes have required color properties
// ============================================================================

describe('built-in palette catalog — required color properties', () => {
  const palettes = BUILTIN_PALETTE_DEFINITIONS

  it('has at least 5 themes registered', () => {
    expect(palettes.length).toBeGreaterThanOrEqual(5)
  })

  it('every theme has a bg property that is a non-empty string', () => {
    for (const { colors } of palettes) {
      expect(typeof colors.bg).toBe('string')
      expect(colors.bg.length).toBeGreaterThan(0)
    }
  })

  it('every theme has a fg property that is a non-empty string', () => {
    for (const { colors } of palettes) {
      expect(typeof colors.fg).toBe('string')
      expect(colors.fg.length).toBeGreaterThan(0)
    }
  })

  it('bg and fg are always valid hex colors', () => {
    const hexPattern = /^#[0-9a-fA-F]{3,8}$/
    for (const { colors } of palettes) {
      expect(hexPattern.test(colors.bg)).toBe(true)
      expect(hexPattern.test(colors.fg)).toBe(true)
    }
  })

  it('optional enrichment properties, when present, are non-empty hex strings', () => {
    const hexPattern = /^#[0-9a-fA-F]{3,8}$/
    const optionalKeys = ['line', 'accent', 'muted', 'surface', 'border'] as const
    for (const { colors } of palettes) {
      for (const key of optionalKeys) {
        const value = (colors as DiagramColors)[key]
        if (value !== undefined && typeof value === 'string') {
          expect(hexPattern.test(value)).toBe(true)
        }
      }
    }
  })
})

// ============================================================================
// 2. All built-in families in the registry are actually handled
// ============================================================================

describe('diagram type coverage — all documented types render to SVG', () => {
  const renderCases = {
    flowchart: { source: 'graph TD\n  A --> B', marker: '>A</text>' },
    state: { source: 'stateDiagram-v2\n  [*] --> Active', marker: 'Active' },
    sequence: { source: 'sequenceDiagram\n  Alice->>Bob: Hello', marker: 'Alice' },
    timeline: { source: 'timeline\n  title History\n  2020 : Event A', marker: '2020' },
    class: { source: 'classDiagram\n  class Animal\n  Animal : +name string', marker: 'Animal' },
    er: { source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places', marker: 'CUSTOMER' },
    journey: { source: 'journey\n  title User Journey\n  section Login\n    Open app: 5: User', marker: 'Login' },
    architecture: { source: 'architecture-beta\n  service api(server)[API]', marker: 'API' },
    xychart: { source: 'xychart-beta\n  x-axis [A, B, C]\n  y-axis "Count" 0 --> 10\n  bar [3, 7, 5]', marker: 'Count' },
    pie: { source: 'pie title Pets\n  "Dogs" : 3\n  "Cats" : 2', marker: 'Dogs' },
    quadrant: { source: 'quadrantChart\n  title Priorities\n  x-axis Low --> High\n  y-axis Risk --> Reward\n  A: [0.7, 0.8]', marker: 'Priorities' },
    gantt: { source: 'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n    Spec :spec, 2024-01-01, 2d', marker: 'Spec' },
    mindmap: { source: 'mindmap\n  root((Product))\n    Research\n    Delivery', marker: 'Product' },
    gitgraph: { source: 'gitGraph\n  commit id:"base" msg:"Base"', marker: 'Base' },
    radar: { source: 'radar-beta\n  title Skills\n  axis a["Alpha"], b["Beta"], c["Gamma"]\n  curve x["Series"]{3, 5, 4}\n  max 5', marker: 'Alpha' },
    sankey: { source: 'sankey-beta\n  Coal,Electricity,42\n  Electricity,Homes,30', marker: 'Electricity' },
  } satisfies Record<BuiltinFamilyId, { source: string; marker: string }>

  it('has a render case for every built-in family', () => {
    expect(new Set(Object.keys(renderCases))).toEqual(new Set(BUILTIN_FAMILY_METADATA.map(f => f.id)))
  })

  for (const family of BUILTIN_FAMILY_METADATA) {
    const c = renderCases[family.id]
    it(`renders ${family.id}`, () => {
      const svg = renderMermaidSVG(c.source)
      expect(svg).toContain('<svg')
      expect(svg).toContain('</svg>')
      expect(svg).toContain(c.marker)
    })
  }
})

// ============================================================================
// 3. All public exports from src/index.ts are real (not undefined)
// ============================================================================

describe('public API exports — all are defined', () => {
  it('renderMermaidSVG is a function', () => {
    expect(typeof renderMermaidSVG).toBe('function')
    expect(renderMermaidSVG).toBeDefined()
    expect(renderMermaidSVG.length).toBeGreaterThanOrEqual(1)
  })

  it('renderMermaidSVGAsync is a function', () => {
    expect(typeof renderMermaidSVGAsync).toBe('function')
    expect(renderMermaidSVGAsync).toBeDefined()
    expect(renderMermaidSVGAsync.length).toBeGreaterThanOrEqual(1)
  })

  it('DEFAULTS has bg and fg', () => {
    expect(DEFAULTS).toBeDefined()
    expect(typeof DEFAULTS.bg).toBe('string')
    expect(typeof DEFAULTS.fg).toBe('string')
  })

  it('fromShikiTheme is a function', () => {
    expect(typeof fromShikiTheme).toBe('function')
    expect(fromShikiTheme).toBeDefined()
    expect(fromShikiTheme.length).toBeGreaterThanOrEqual(1)
  })

  it('resolveColors is a function', () => {
    expect(typeof resolveColors).toBe('function')
    expect(resolveColors).toBeDefined()
    expect(resolveColors.length).toBeGreaterThanOrEqual(1)
  })

  it('inlineResolvedColors is a function', () => {
    expect(typeof inlineResolvedColors).toBe('function')
    expect(inlineResolvedColors).toBeDefined()
    expect(inlineResolvedColors.length).toBeGreaterThanOrEqual(2)
  })

  it('parseRegisteredMermaid is a function', () => {
    expect(typeof parseRegisteredMermaid).toBe('function')
    expect(parseRegisteredMermaid).toBeDefined()
    expect(parseRegisteredMermaid.length).toBeGreaterThanOrEqual(1)
  })

  it('renderMermaidASCII is defined', () => {
    expect(typeof renderMermaidASCII).toBe('function')
    expect(renderMermaidASCII).toBeDefined()
  })

  it('architecture parser exports are defined', () => {
    expect(typeof parseArchitectureDiagram).toBe('function')
    expect(typeof architectureToMermaidGraph).toBe('function')
    expect(parseArchitectureDiagram).toBeDefined()
  })
})

// ============================================================================
// 4. Package.json keywords include all supported diagram types
// ============================================================================

describe('package.json keywords — cover all supported diagram types', () => {
  // Read keywords from package.json at import time
  const pkg = require('../../package.json')
  const keywords: string[] = pkg.keywords

  const expectedDiagramKeywords = {
    flowchart: 'flowchart',
    state: 'state-diagram',
    sequence: 'sequence-diagram',
    timeline: 'timeline-diagram',
    class: 'class-diagram',
    er: 'er-diagram',
    journey: 'journey-diagram',
    architecture: 'architecture-diagram',
    xychart: 'xychart',
    pie: 'pie-chart',
    quadrant: 'quadrant-chart',
    gantt: 'gantt-chart',
    mindmap: 'mindmap',
    gitgraph: 'git-graph',
    radar: 'radar-chart',
    sankey: 'sankey-diagram',
  } satisfies Record<BuiltinFamilyId, string>

  it('keywords array exists and is non-empty', () => {
    expect(Array.isArray(keywords)).toBe(true)
    expect(keywords.length).toBeGreaterThan(0)
    expect(keywords).toContain('mermaid')
  })

  it('includes all supported diagram type keywords', () => {
    expect(new Set(Object.keys(expectedDiagramKeywords))).toEqual(new Set(BUILTIN_FAMILY_METADATA.map(f => f.id)))
    for (const expected of Object.values(expectedDiagramKeywords)) {
      expect(keywords).toContain(expected)
    }
    expect(Object.keys(expectedDiagramKeywords).length).toBe(BUILTIN_FAMILY_METADATA.length)
  })

  it('includes core library keywords (mermaid, svg, diagram)', () => {
    expect(keywords).toContain('mermaid')
    expect(keywords).toContain('svg')
    expect(keywords).toContain('diagram')
  })
})

describe('cross-family aesthetics — registry-driven enrollment', () => {
  // Root cause (sankey addition): the union review table and the per-family
  // aesthetic thesis were prose conventions with no forcing function, so a new
  // family could enroll everywhere the typechecker looks and still skip the
  // aesthetics ledger entirely. These gates enumerate the registry: the next
  // family fails CI until it has a review row and (unless grandfathered) a
  // stated thesis.
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const { join } = require('node:path') as typeof import('node:path')
  const ROOT = join(import.meta.dir, '..', '..')

  it('every registered family has a row in the union review table', () => {
    const doc = readFileSync(join(ROOT, 'docs/design/system/cross-family-aesthetics.md'), 'utf8')
    for (const family of BUILTIN_FAMILY_METADATA) {
      const row = new RegExp(String.raw`^\| \*\*[^|]*\b${family.id}\b[^|]*\*\*`, 'm')
      expect({ id: family.id, reviewed: row.test(doc) }).toEqual({ id: family.id, reviewed: true })
    }
  })

  // Families registered before the thesis gate existed. Do NOT add to this
  // list: a new family states its aesthetic thesis (L9) in
  // docs/design/families/<id>.md; retrofitting the legacy docs is tracked in
  // the union review's "Top opportunity" column instead.
  const AESTHETIC_THESIS_GRANDFATHERED = new Set<BuiltinFamilyId>(['flowchart', 'state', 'sequence', 'timeline', 'class', 'er', 'journey', 'architecture', 'xychart', 'pie', 'quadrant', 'gantt', 'mindmap', 'gitgraph', 'radar'])

  it('every post-gate family states its aesthetic thesis in its design doc', () => {
    for (const family of BUILTIN_FAMILY_METADATA) {
      if (AESTHETIC_THESIS_GRANDFATHERED.has(family.id)) continue
      const doc = readFileSync(join(ROOT, `docs/design/families/${family.id}.md`), 'utf8')
      expect({ id: family.id, hasThesis: doc.includes('## Aesthetic thesis') }).toEqual({ id: family.id, hasThesis: true })
    }
  })
})
