/**
 * Doc-sync tests — verify the library's public API matches its code registries.
 *
 * These tests ensure that:
 *   1. All named themes in THEMES have required color properties
 *   2. Every built-in family in the checked family registry renders
 *   3. All public exports from src/index.ts are real (not undefined)
 *   4. Package.json keywords include all supported diagram types
 */
import { describe, it, expect } from 'bun:test'
import {
  THEMES,
  DEFAULTS,
  fromShikiTheme,
  resolveColors,
  inlineResolvedColors,
  parseMermaid,
  renderMermaidASCII,
  renderMermaidAscii,
  parseArchitectureDiagram,
  architectureToMermaidGraph,
} from '../index.ts'
import { renderMermaidSVG, renderMermaidSVGAsync, renderMermaidSync, renderMermaid } from '../index.ts'
import type { DiagramColors } from '../theme.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import type { BuiltinFamilyId } from '../agent/families.ts'

// ============================================================================
// 1. All named themes have required color properties
// ============================================================================

describe('THEMES registry — required color properties', () => {
  const themeNames = Object.keys(THEMES)

  it('has at least 5 themes registered', () => {
    expect(themeNames.length).toBeGreaterThanOrEqual(5)
  })

  it('every theme has a bg property that is a non-empty string', () => {
    for (const name of themeNames) {
      const theme = THEMES[name]!
      expect(typeof theme.bg).toBe('string')
      expect(theme.bg.length).toBeGreaterThan(0)
    }
  })

  it('every theme has a fg property that is a non-empty string', () => {
    for (const name of themeNames) {
      const theme = THEMES[name]!
      expect(typeof theme.fg).toBe('string')
      expect(theme.fg.length).toBeGreaterThan(0)
    }
  })

  it('bg and fg are always valid hex colors', () => {
    const hexPattern = /^#[0-9a-fA-F]{3,8}$/
    for (const name of themeNames) {
      const theme = THEMES[name]!
      expect(hexPattern.test(theme.bg)).toBe(true)
      expect(hexPattern.test(theme.fg)).toBe(true)
    }
  })

  it('optional enrichment properties, when present, are non-empty hex strings', () => {
    const hexPattern = /^#[0-9a-fA-F]{3,8}$/
    const optionalKeys: (keyof DiagramColors)[] = ['line', 'accent', 'muted', 'surface', 'border']
    for (const name of themeNames) {
      const theme = THEMES[name]!
      for (const key of optionalKeys) {
        const value = theme[key]
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

  it('backward-compatible aliases are defined and equal to their targets', () => {
    expect(renderMermaidSync).toBe(renderMermaidSVG)
    expect(renderMermaid).toBe(renderMermaidSVGAsync)
    expect(typeof renderMermaidSync).toBe('function')
  })

  it('THEMES is a non-empty object', () => {
    expect(typeof THEMES).toBe('object')
    expect(THEMES).toBeDefined()
    expect(Object.keys(THEMES).length).toBeGreaterThan(0)
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

  it('parseMermaid is a function', () => {
    expect(typeof parseMermaid).toBe('function')
    expect(parseMermaid).toBeDefined()
    expect(parseMermaid.length).toBeGreaterThanOrEqual(1)
  })

  it('renderMermaidASCII and renderMermaidAscii are both defined', () => {
    expect(typeof renderMermaidASCII).toBe('function')
    expect(typeof renderMermaidAscii).toBe('function')
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
