import { describe, expect, test } from 'bun:test'

import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { renderMermaidSVGAsync } from '../browser-lazy.ts'
import { parseRegisteredMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { runBatchLine } from '../cli/index.ts'
import { CHANNEL_THEME_KEYS } from '../color-resolver.ts'
import { handleHostedRequest } from '../mcp/hosted-server.ts'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'

const FLOW = 'flowchart TD\n  A --> B'
const PIE = 'pie\n  "A" : 3\n  "B" : 2'
const GITGRAPH = 'gitGraph\n  commit id:"A" type:HIGHLIGHT'
const invalid = ['notacolor', '#12345', 'rgb(x)', 'hsl(120 50% 50% / .5 / junk)', 'url(#a)'] as const

function init(source: string, key: string, value: unknown): string {
  return `%%{init: ${JSON.stringify({ themeVariables: { [key]: value } })}}%%\n${source}`
}

describe('theme color admission (#303, shared/Pie layer)', () => {
  test('shared color keys refuse malformed paint in graphical and terminal outputs', () => {
    for (const key of new Set(Object.values(CHANNEL_THEME_KEYS).flat())) {
      for (const value of invalid) {
        const source = init(FLOW, key, value)
        const named = `themeVariables.${key}: ${JSON.stringify(value)} is not a CSS color`
        expect(() => renderMermaidSVG(source), `${key} ${value}`).toThrow(named)
        expect(() => renderMermaidASCII(source, { useAscii: true }), `${key} ${value}`).toThrow(named)
        expect(() => renderMermaidASCII(source, { useAscii: false }), `${key} ${value}`).toThrow(named)
      }
    }
  })

  test('Pie-specific slice, border and ink colors are named instead of silently dropped', () => {
    const pieKeys = [
      ...Array.from({ length: 12 }, (_, index) => `pie${index + 1}`),
      'pieStrokeColor', 'pieOuterStrokeColor',
      'pieSectionTextColor', 'pieTitleTextColor', 'pieLegendTextColor',
    ]
    for (const key of pieKeys) {
      for (const value of invalid) {
        const source = init(PIE, key, value)
        const named = `themeVariables.${key}: ${JSON.stringify(value)} is not a CSS color`
        expect(() => renderMermaidSVG(source), `${key} ${value}`).toThrow(named)
        expect(() => renderMermaidASCII(source), `${key} ${value}`).toThrow(named)
      }
    }
  })

  test('merged frontmatter, init, and render-option theme values agree with verify and PNG', () => {
    const sources = [
      init(FLOW, 'primaryColor', '#12345'),
      '---\nconfig:\n  themeVariables:\n    primaryColor: "#12345"\n---\nflowchart TD\n  A --> B',
    ]
    for (const source of sources) {
      const named = 'themeVariables.primaryColor: "#12345" is not a CSS color'
      expect(() => renderMermaidSVG(source)).toThrow(named)
      expect(() => renderMermaidPNG(source)).toThrow(named)
      expect(verifyMermaid(source).warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(named) })
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(verifyMermaid(parsed.value).warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(named) })
    }
    const options = { mermaidConfig: { themeVariables: { primaryColor: 'notacolor' } } }
    expect(() => renderMermaidSVG(FLOW, options)).toThrow('themeVariables.primaryColor: "notacolor"')
    expect(verifyMermaid(FLOW, { renderOptions: options }).warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining('themeVariables.primaryColor: "notacolor"') })
  })

  test('browser-lazy rejects the same source before rendering', async () => {
    for (const [source, key] of [[init(FLOW, 'primaryColor', 'notacolor'), 'primaryColor'], [init(PIE, 'pie1', 'notacolor'), 'pie1']] as const) {
      await expect(renderMermaidSVGAsync(source)).rejects.toThrow(`themeVariables.${key}: "notacolor" is not a CSS color`)
    }
  })

  test('CLI and MCP carry only the nominal named diagnostic', async () => {
    const source = init(FLOW, 'primaryColor', 'notacolor')
    for (const format of ['svg', 'ascii', 'unicode'] as const) {
      const result = runBatchLine(JSON.stringify({ op: 'render', format, source }), 0) as { ok: boolean; error: { code: string; key: string; value: string; message: string } }
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_THEME_COLOR', key: 'primaryColor', value: 'notacolor', message: expect.stringContaining('themeVariables.primaryColor') } })
    }
    const response = await handleHostedRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_svg', arguments: { source } } },
      {
        async execute() { return { ok: true, value: null, logs: [] } },
        async renderPng() { throw new Error('not used') },
      },
    )
    const payload = JSON.parse((response?.result as { content: Array<{ text: string }> }).content[0]!.text)
    expect(payload).toMatchObject({ ok: false, error: { code: 'INVALID_THEME_COLOR', key: 'primaryColor', value: 'notacolor' } })
    expect(projectRenderErrorDiagnostic({ code: 'INVALID_THEME_COLOR', key: 'primaryColor', value: 'notacolor', message: 'forged' }))
      .toEqual({ code: 'RENDER_FAILED', message: 'Rendering failed' })
  })

  test('valid shared and Pie colors remain paintable, while none is not text ink', () => {
    for (const value of ['rebeccapurple', '#f96', '#3b82', '#112233', '#11223380', 'rgb(255 0 0)', 'hsl(120 100% 50%)', 'transparent', 'currentColor', 'var(--brand)']) {
      expect(() => renderMermaidSVG(init(FLOW, 'primaryColor', value)), value).not.toThrow()
      expect(() => renderMermaidSVG(init(PIE, 'pie1', value)), value).not.toThrow()
    }
    expect(() => renderMermaidSVG(init(FLOW, 'lineColor', 'none'))).not.toThrow()
    for (const key of ['primaryTextColor', 'textColor', 'nodeTextColor', 'secondaryTextColor', 'tertiaryTextColor']) {
      expect(() => renderMermaidSVG(init(FLOW, key, 'none')))
        .toThrow(`themeVariables.${key}: "none" is not a CSS color`)
    }
    for (const key of ['pieSectionTextColor', 'pieTitleTextColor', 'pieLegendTextColor']) {
      expect(() => renderMermaidSVG(init(PIE, key, 'none')))
        .toThrow(`themeVariables.${key}: "none" is not a CSS color`)
    }
    for (const [source, key] of [[FLOW, 'primaryColor'], [PIE, 'pie1']] as const) {
      expect(() => renderMermaidSVG(init(source, key, 123)))
        .toThrow(`themeVariables.${key}: "123" is not a CSS color`)
    }
  })
})

describe('theme color admission (#303, GitGraph layer)', () => {
  const gitGraphColorKeys = [
    ...Array.from({ length: 8 }, (_, index) => [`git${index}`, `gitBranchLabel${index}`, `gitInv${index}`]).flat(),
    'commitLabelColor', 'commitLabelBackground',
  ]

  test('every indexed branch, label, highlight and commit-label paint refuses invalid values', () => {
    for (const key of gitGraphColorKeys) {
      for (const value of invalid) {
        const source = init(GITGRAPH, key, value)
        const named = `themeVariables.${key}: ${JSON.stringify(value)} is not a CSS color`
        expect(() => renderMermaidSVG(source), `${key} ${value}`).toThrow(named)
        expect(() => renderMermaidASCII(source), `${key} ${value}`).toThrow(named)
      }
    }
  })

  test('GitGraph ink refuses none, while fills and strokes may use it', () => {
    for (const key of [...Array.from({ length: 8 }, (_, index) => `gitBranchLabel${index}`), 'commitLabelColor']) {
      expect(() => renderMermaidSVG(init(GITGRAPH, key, 'none')))
        .toThrow(`themeVariables.${key}: "none" is not a CSS color`)
    }
    for (const key of ['git0', 'gitInv0', 'commitLabelBackground']) {
      expect(() => renderMermaidSVG(init(GITGRAPH, key, 'none'))).not.toThrow()
    }
    expect(() => renderMermaidSVG(init(GITGRAPH, 'git0', 123)))
      .toThrow('themeVariables.git0: "123" is not a CSS color')
  })

  test('admitted custom properties survive every GitGraph SVG paint sink', () => {
    const source = `%%{init: ${JSON.stringify({ themeVariables: {
      git0: 'var(--branch)', gitInv0: 'var(--highlight)', gitBranchLabel0: 'var(--label)',
      commitLabelColor: 'var(--ink)', commitLabelBackground: 'var(--pill)',
    } })}}%%\n${GITGRAPH}`
    const svg = renderMermaidSVG(source)
    for (const variable of ['branch', 'highlight', 'label', 'ink', 'pill']) {
      expect(svg).toContain(`var(--${variable})`)
    }
    expect(verifyMermaid(source).warnings).not.toContainEqual({ code: 'RENDER_FAILED', reason: expect.any(String) })
  })

  test('GitGraph rejection agrees across verify, PNG, browser-lazy and CLI', async () => {
    const source = init(GITGRAPH, 'git7', 'url(#unsafe)')
    const named = 'themeVariables.git7: "url(#unsafe)" is not a CSS color'
    expect(() => renderMermaidPNG(source)).toThrow(named)
    expect(verifyMermaid(source).warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(named) })
    await expect(renderMermaidSVGAsync(source)).rejects.toThrow(named)
    const result = runBatchLine(JSON.stringify({ op: 'render', format: 'svg', source }), 0)
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_THEME_COLOR', key: 'git7', value: 'url(#unsafe)' } })
  })

  test('family-private keys remain scoped to GitGraph', () => {
    expect(() => renderMermaidSVG(init(FLOW, 'git0', 'notacolor'))).not.toThrow()
    expect(() => renderMermaidSVG(init(PIE, 'commitLabelColor', 'notacolor'))).not.toThrow()
  })
})
