import { describe, expect, test } from 'bun:test'
import { parseMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVG } from '../index.ts'
import {
  STATE_CONFIG_FIELDS, STATE_LEGACY_CONFIG_FIELDS, STATE_WIRED_CONFIG_FIELDS,
  stateConfigDiagnostics,
} from '../state/config.ts'
import { SDK_DECLARATION } from '../mcp/sdk-decl.ts'

const SOURCE = 'stateDiagram-v2\n  A --> B'

function wrapped(config: string, source = SOURCE): string {
  return `---\nconfig:\n  state:\n${config}\n---\n${source}`
}

function warnings(config: string) {
  const parsed = parseMermaid(wrapped(config))
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return []
  return verifyMermaid(parsed.value).warnings
}

function nodeRect(svg: string, id: string): { x: number; y: number; width: number; height: number; rx: number } {
  const match = svg.match(new RegExp(`<g class="node" data-id="${id}"[^>]*>\\s*<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" rx="([^"]+)"`))
  expect(match).not.toBeNull()
  return { x: Number(match![1]), y: Number(match![2]), width: Number(match![3]), height: Number(match![4]), rx: Number(match![5]) }
}

const EFFECT_CASES: Record<(typeof STATE_WIRED_CONFIG_FIELDS)[number], { value: number; source: string }> = {
  nodeSpacing: { value: 100, source: 'stateDiagram-v2\n  [*] --> A\n  [*] --> B' },
  rankSpacing: { value: 100, source: SOURCE },
  padding: { value: 30, source: SOURCE },
  radius: { value: 20, source: SOURCE },
  fontSize: { value: 24, source: SOURCE },
  compositTitleSize: { value: 24, source: 'stateDiagram-v2\n  state Composite {\n    A --> B\n  }' },
  forkWidth: { value: 120, source: 'stateDiagram-v2\n  state F <<fork>>\n  [*] --> F\n  F --> A' },
  forkHeight: { value: 25, source: 'stateDiagram-v2\n  state F <<fork>>\n  [*] --> F\n  F --> A' },
  noteMargin: { value: 50, source: 'stateDiagram-v2\n  A --> B\n  note right of A : hello' },
  dividerMargin: { value: 30, source: 'stateDiagram-v2\n  state Composite {\n    [*] --> A\n    --\n    [*] --> B\n  }' },
}

describe('state runtime config is wire-or-warn', () => {
  test('the independent documented inventory is partitioned exactly once', () => {
    const expected = [
      'arrowMarkerAbsolute', 'compositTitleSize', 'defaultRenderer', 'dividerMargin',
      'edgeLengthFactor', 'fontSize', 'fontSizeFactor', 'forkHeight', 'forkWidth',
      'labelHeight', 'miniPadding', 'nodeSpacing', 'noteMargin', 'padding', 'radius',
      'rankSpacing', 'sizeUnit', 'textHeight', 'titleShift', 'titleTopMargin',
    ]
    expect([...STATE_CONFIG_FIELDS] as string[]).toEqual(expected)
    const classified = [...STATE_WIRED_CONFIG_FIELDS, ...STATE_LEGACY_CONFIG_FIELDS, 'defaultRenderer']
    expect(new Set(classified)).toEqual(new Set(expected))
    expect(classified).toHaveLength(expected.length)
  })

  test('the MCP SDK declares the complete canonical State field inventory', () => {
    const declaration = SDK_DECLARATION.split('state?: {')[1]?.split('\n  class?:')[0] ?? ''
    for (const field of STATE_CONFIG_FIELDS) expect(declaration).toContain(`${field}?:`)
    const declared = [...declaration.matchAll(/\b(\w+)\?:/g)].map(match => match[1]).filter(field => field !== 'undefined')
    expect(new Set(declared)).toEqual(new Set(STATE_CONFIG_FIELDS))
  })

  test.each([...STATE_WIRED_CONFIG_FIELDS])('%s changes rendered output and does not warn', field => {
    const probe = EFFECT_CASES[field]
    const base = renderMermaidSVG(probe.source)
    const configured = renderMermaidSVG(probe.source, { mermaidConfig: { state: { [field]: probe.value } } })
    expect(configured).not.toBe(base)
    expect(stateConfigDiagnostics([{ [field]: probe.value }])).toEqual([])
  })

  test('node/rank spacing, padding, radius, and fork dimensions change the intended geometry', () => {
    const rankBase = nodeRect(renderMermaidSVG(SOURCE), 'B')
    const rankWide = nodeRect(renderMermaidSVG(SOURCE, { mermaidConfig: { state: { rankSpacing: 100 } } }), 'B')
    expect(rankWide.y).toBeGreaterThan(rankBase.y)

    const baseA = nodeRect(renderMermaidSVG(SOURCE), 'A')
    const paddedA = nodeRect(renderMermaidSVG(SOURCE, { mermaidConfig: { state: { padding: 30 } } }), 'A')
    expect(paddedA.width).toBeGreaterThan(baseA.width)
    expect(nodeRect(renderMermaidSVG(SOURCE, { mermaidConfig: { state: { radius: 14 } } }), 'A').rx).toBe(14)

    const forkSource = EFFECT_CASES.forkWidth.source
    const fork = nodeRect(renderMermaidSVG(forkSource, { mermaidConfig: { state: { forkWidth: 120, forkHeight: 25 } } }), 'F')
    expect(fork.width).toBe(120)
    expect(fork.height).toBe(25)
  })

  test('explicit mermaidConfig wins over source config and diagnostics do not change bytes', () => {
    const source = wrapped('    rankSpacing: 60')
    const diagnostics: unknown[] = []
    const explicit = renderMermaidSVG(source, {
      mermaidConfig: { state: { rankSpacing: 100 } },
      onConfigDiagnostic: diagnostic => diagnostics.push(diagnostic),
    })
    const expected = renderMermaidSVG(wrapped('    rankSpacing: 100'))
    expect(explicit).toBe(expected)
    expect(diagnostics).toEqual([])
    expect(renderMermaidSVG(SOURCE, {
      layerSpacing: 60,
      mermaidConfig: { state: { rankSpacing: 100 } },
    })).toBe(renderMermaidSVG(SOURCE, { layerSpacing: 60 }))

    const warned: unknown[] = []
    const withCollector = renderMermaidSVG(SOURCE, {
      mermaidConfig: { state: { titleTopMargin: 10 } },
      onConfigDiagnostic: diagnostic => warned.push(diagnostic),
    })
    const suppressedConsole: unknown[] = []
    const originalWarn = console.warn
    console.warn = (...args) => { suppressedConsole.push(args) }
    try {
      expect(renderMermaidSVG(SOURCE, { mermaidConfig: { state: { titleTopMargin: 10 } } })).toBe(withCollector)
    } finally {
      console.warn = originalWarn
    }
    expect(warned).toEqual([expect.objectContaining({ field: 'state.titleTopMargin' })])
    expect(suppressedConsole).toHaveLength(1)
  })

  test.each([...STATE_LEGACY_CONFIG_FIELDS])('%s warns with a qualified field through frontmatter and init', field => {
    const frontmatter = warnings(`    ${field}: ${field === 'arrowMarkerAbsolute' ? 'true' : field === 'edgeLengthFactor' ? '"1"' : '10'}`)
    expect(frontmatter).toContainEqual(expect.objectContaining({ code: 'INEFFECTIVE_CONFIG', field: `state.${field}` }))

    const parsed = parseMermaid(`%%{init: {"state": {"${field}": 10}}}%%\n${SOURCE}`)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ field: `state.${field}` }))
  })

  test('renderer selection, invalid wired values, and unknown explicit keys fail loud', () => {
    expect(stateConfigDiagnostics([{ defaultRenderer: 'elk' }])).toEqual([])
    expect(stateConfigDiagnostics([{ defaultRenderer: 'dagre-d3' }])).toEqual([
      expect.objectContaining({ field: 'state.defaultRenderer' }),
    ])
    expect(stateConfigDiagnostics([{ nodeSpacing: -1 }])).toEqual([
      expect.objectContaining({ field: 'state.nodeSpacing' }),
    ])
    expect(stateConfigDiagnostics([{ madeUpKey: 1 }], true)).toEqual([
      expect.objectContaining({ field: 'state.madeUpKey' }),
    ])
  })
})
