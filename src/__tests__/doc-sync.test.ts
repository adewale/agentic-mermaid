/**
 * Doc-sync tests — verify the library's public API matches its code registries.
 *
 * These tests ensure that:
 *   1. All named themes in THEMES have required color properties
 *   2. Every diagram type listed in src/index.ts is actually handled
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
// 2. All diagram types listed in src/index.ts are actually handled
// ============================================================================

describe('diagram type coverage — all documented types render to SVG', () => {
  // These are the diagram types listed in the comment at the top of src/index.ts
  // and handled by the detectDiagramType switch statement.

  it('renders flowchart (graph TD)', () => {
    const svg = renderMermaidSVG('graph TD\n  A --> B')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('>A</text>')
  })

  it('renders flowchart (flowchart LR)', () => {
    const svg = renderMermaidSVG('flowchart LR\n  A --> B')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('>A</text>')
  })

  it('renders state diagrams (stateDiagram-v2)', () => {
    const svg = renderMermaidSVG('stateDiagram-v2\n  [*] --> Active')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('Active')
  })

  it('renders architecture diagrams (architecture-beta)', () => {
    const svg = renderMermaidSVG('architecture-beta\n  service api(server)[API]')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('API')
  })

  it('renders sequence diagrams (sequenceDiagram)', () => {
    const svg = renderMermaidSVG('sequenceDiagram\n  Alice->>Bob: Hello')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('Alice')
  })

  it('renders class diagrams (classDiagram)', () => {
    const svg = renderMermaidSVG('classDiagram\n  class Animal\n  Animal : +name string')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('Animal')
  })

  it('renders ER diagrams (erDiagram)', () => {
    const svg = renderMermaidSVG('erDiagram\n  CUSTOMER ||--o{ ORDER : places')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('CUSTOMER')
  })

  it('renders timeline diagrams (timeline)', () => {
    const svg = renderMermaidSVG('timeline\n  title History\n  2020 : Event A')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('2020')
  })

  it('renders journey diagrams (journey)', () => {
    const svg = renderMermaidSVG('journey\n  title User Journey\n  section Login\n    Open app: 5: User')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('Login')
  })

  it('renders XY charts (xychart-beta)', () => {
    const svg = renderMermaidSVG('xychart-beta\n  x-axis [A, B, C]\n  y-axis "Count" 0 --> 10\n  bar [3, 7, 5]')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('Count')
  })
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

  // The diagram types documented in src/index.ts comment header
  const expectedDiagramKeywords = [
    'flowchart',
    'sequence-diagram',
    'class-diagram',
    'er-diagram',
    'timeline-diagram',
    'journey-diagram',
    'xychart',
    'state-diagram',
  ]

  it('keywords array exists and is non-empty', () => {
    expect(Array.isArray(keywords)).toBe(true)
    expect(keywords.length).toBeGreaterThan(0)
    expect(keywords).toContain('mermaid')
  })

  it('includes all supported diagram type keywords', () => {
    for (const expected of expectedDiagramKeywords) {
      expect(keywords).toContain(expected)
    }
    // Verify at least 8 diagram types are covered
    expect(expectedDiagramKeywords.length).toBeGreaterThanOrEqual(8)
  })

  it('includes core library keywords (mermaid, svg, diagram)', () => {
    expect(keywords).toContain('mermaid')
    expect(keywords).toContain('svg')
    expect(keywords).toContain('diagram')
  })
})
