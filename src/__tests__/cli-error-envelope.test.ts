// Loop 12 M1: CLI error envelope carries structured ParseError[] in `details`
// rather than JSON-stringifying it into `message`.

import { describe, test, expect } from 'bun:test'
import { getFamily } from '../agent/families.ts'
import { replaceFamilyForTest } from '../agent/family-registry.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { renderMarkdownBlocks, runCli } from '../cli/index.ts'
import { LayoutCertificationError } from '../layout/certification-error.ts'
import { handleHostedRequest } from '../mcp/hosted-server.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { handleRequest } from '../mcp/server.ts'
import { captureCli as capture } from './helpers/cli-capture.ts'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs('am-cli-err-')
const tmp = (content: string): string => temp.file('input.mmd', content)

describe('M1 CLI structured error envelope', () => {
  test('named color refusals keep the same JSON envelope in every render format', () => {
    for (const [source, errorCode, named] of [
      ['flowchart TD\nA-->B\nstyle A fill:notacolor', 'INVALID_STYLE_COLOR', 'style A: fill "notacolor"'],
      ['%%{init: {"themeVariables":{"primaryColor":"notacolor"}}}%%\nflowchart TD\nA-->B', 'INVALID_THEME_COLOR', 'themeVariables.primaryColor: "notacolor"'],
      ['%%{init: {"sankey":{"linkColor":"notacolor"}}}%%\nsankey-beta\nA,B,1', 'INVALID_CONFIG_COLOR', 'sankey.linkColor: "notacolor"'],
    ] as const) {
      const input = tmp(source)
      for (const format of ['svg', 'png', 'ascii', 'unicode']) {
        const args = ['render', input, '--format', format, '--json']
        if (format === 'png') args.push('--output', `${input}.png`)
        const result = capture(() => runCli(args))
        expect(result.code, format).toBe(2)
        expect(result.out, format).not.toBe('')
        expect(JSON.parse(result.out), format).toMatchObject({
          ok: false, error: { code: errorCode, message: expect.stringContaining(named), value: 'notacolor' },
        })
      }
      const plain = capture(() => runCli(['render', input, '--format', 'png', '--output', `${input}.png`]))
      expect(plain.code).toBe(2)
      expect(plain.err).toContain(`Error: ${errorCode}: ${named}`)
    }
  })

  test('command-level flag validation errors honour --json with the ARG envelope', () => {
    const input = tmp('flowchart TD\n  A --> B')
    // [argv, the flag the message must name]
    for (const [argv, flag] of [
      [['render', input, '--format', 'nope'], '--format'],
      [['render', input, '--format', 'png'], '--output'],
      [['render', input, '--style', 'no-such-style'], '--style'],
      [['render', input, '--options', '{not json'], '--options'],
      [['render', input, '--seed', 'abc'], '--seed'],
      [['render', input, '--certificates'], '--certificates'],
      [['verify', input, '--suppress', 'NOT_A_CODE'], '--suppress'],
      [['verify', input, '--label-cap', '0'], '--label-cap'],
      [['describe', input, '--format', 'nope'], '--format'],
      [['mutate', input, '--op', '{bad'], 'mutation JSON'],
      [['mutate', input, '--ops', '[]'], '--ops'],
      [['mutate', input], '--op'],
      [['preview', input, '--security', 'lax'], '--security'],
    ] as const) {
      const label = argv.join(' ')
      const json = capture(() => runCli([...argv, '--json']))
      expect(json.code, label).toBe(2)
      const payload = JSON.parse(json.out)
      expect(payload, label).toEqual({ ok: false, error: { code: 'ARG', message: expect.stringContaining(flag) } })
      expect(json.err, label).toBe(`${payload.error.message}\n`)
      // Without --json the same text stays on stderr and stdout stays empty.
      expect(capture(() => runCli([...argv])), label).toEqual({ code: 2, out: '', err: json.err })
    }
  })

  test('am parse error: message is a human string, details is the ParseError[]', () => {
    const { code, out } = capture(() => runCli(['parse', tmp('flowchart XX\n  A --> B')]))
    expect(code).toBe(2)
    const payload = JSON.parse(out)
    expect(payload.ok).toBe(false)
    expect(payload.error.code).toBe('PARSE_FAILED')
    // message is a short human string, NOT a JSON-stringified array
    expect(typeof payload.error.message).toBe('string')
    expect(payload.error.message.startsWith('[')).toBe(false)
    // details is the structured array an agent can consume directly
    expect(Array.isArray(payload.error.details)).toBe(true)
    expect(payload.error.details[0].code).toBe('PARSE_FAILED')
  })

  test('am render --format layout error: same structured shape', () => {
    const { code, out } = capture(() => runCli(['render', '--format', 'layout', tmp('flowchart XX\n  A --> B')]))
    expect(code).toBe(2)
    const payload = JSON.parse(out)
    expect(payload.error.code).toBe('PARSE_FAILED')
    expect(Array.isArray(payload.error.details)).toBe(true)
  })

  test('unknown headers parse into a preserved forward-compatible envelope', () => {
    const source = 'futureDiagram-v99\n  untouched payload\n'
    const { code, out } = capture(() => runCli(['parse', tmp(source)]))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload).toMatchObject({
      kind: 'family:unknown',
      body: {
        kind: 'preserved',
        source,
        diagnostic: { code: 'UNKNOWN_HEADER' },
        preservation: { classification: 'unknown', source },
      },
    })
  })

  test('unknown headers remain a structured capability failure on render', () => {
    const source = 'futureDiagram-v99\n  payload'
    const { code, out } = capture(() => runCli(['render', '--format', 'layout', tmp(source)]))
    expect(code).toBe(2)
    const payload = JSON.parse(out)
    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: 'UNKNOWN_HEADER',
        line: 1,
        preservation: { source, header: 'futureDiagram-v99' },
        help: expect.stringContaining('source was preserved unchanged'),
      },
    })
  })

  test('successful am parse still emits the bare ValidDiagram (pipe contract intact)', () => {
    const { code, out } = capture(() => runCli(['parse', tmp('flowchart TD\n A --> B')]))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    // success path is NOT wrapped in {ok,error} — it's the diagram itself
    expect(payload.ok).toBeUndefined()
    expect(payload.kind).toBe('flowchart')
  })
})

// One render failure, one diagnostic: every render surface reports the same
// stable code and the renderer's actionable reason for the same input, and the
// CLI exit code follows the documented table (2 = the caller's input, 4 = an
// Agentic Mermaid defect).
describe('render failure diagnostics agree across render surfaces', () => {
  const textTools = ['render_svg', 'render_ascii', 'render_png'] as const
  const pngOnly = ['render_png'] as const
  const graphicalTools = ['render_svg', 'render_png'] as const
  const chain = `flowchart LR\n${Array.from({ length: 60 }, (_, i) => `  N${i}[node number ${i}] --> N${i + 1}[node number ${i + 1}]`).join('\n')}`
  const cases = [
    {
      name: 'source the parser rejects',
      source: 'flowchart LR\n  A --> ',
      expected: { code: 'PARSE_FAILED', message: expect.stringContaining('could not fully consume expected edge target'), details: [expect.objectContaining({ code: 'PARSE_FAILED' })] },
      exit: 2, cli: ['svg', 'ascii', 'layout', 'png'], tools: textTools, markdown: true, codeMode: true,
    },
    {
      name: 'a statement the render parser refuses',
      source: 'sequenceDiagram\n  A->>B hi no colon',
      expected: { code: 'RENDER_FAILED', origin: 'source', message: expect.stringContaining('A->>B hi no colon') },
      exit: 2, cli: ['svg', 'ascii', 'layout', 'png'], tools: textTools, markdown: true, codeMode: true,
    },
    {
      // Injected below: the graphical layout fails certification.
      name: 'an engine defect',
      source: 'flowchart LR\n  Defect --> B',
      expected: { code: 'INTERNAL_ERROR', message: expect.stringContaining('member Defect: outside authored group G') },
      exit: 4, cli: ['svg', 'layout', 'png'], tools: graphicalTools, markdown: false, codeMode: true,
    },
    {
      name: 'a PNG over the raster budget',
      source: chain,
      expected: {
        code: 'PNG_RASTER_BUDGET_EXCEEDED', budget: 'portable', maxDimension: 16_384, maxPixels: 16_777_216,
        width: expect.any(Number), height: expect.any(Number), message: expect.stringContaining('fitTo'),
      },
      exit: 2, cli: ['png'], tools: pngOnly, markdown: false, codeMode: false,
    },
  ] as const

  const hostedPayload = async (tool: string, source: string): Promise<any> => {
    const response = await handleHostedRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: { source } } }, {
      async execute() { return { ok: true, value: null, logs: [] } },
      async renderPng(input, opts) { return { ...renderMermaidPNGWithReceipt(input, opts), warnings: [] } },
    })
    return JSON.parse((response?.result as { content: Array<{ text: string }> }).content[0]!.text)
  }

  const withCertificationDefect = async (run: () => Promise<void>): Promise<void> => {
    const flowchart = getFamily('flowchart')!
    const restore = replaceFamilyForTest('flowchart', {
      ...flowchart,
      layout: context => {
        if (context.source.text.includes('Defect')) {
          throw new LayoutCertificationError([{ strategy: 'default', violations: ['member Defect: outside authored group G'] }] as never)
        }
        return flowchart.layout!(context)
      },
    })
    try {
      await run()
    } finally {
      restore()
    }
  }

  test('CLI formats, hosted tools, stdio render_png, Code Mode and render-markdown report one diagnostic', async () => {
    await withCertificationDefect(async () => {
      for (const { name, source, expected, exit, cli, tools, markdown, codeMode } of cases) {
        const input = tmp(source)
        for (const format of cli) {
          const args = ['render', input, '--format', format, '--json', ...(format === 'png' ? ['--output', `${input}.png`] : [])]
          const result = capture(() => runCli(args))
          expect({ name, format, code: result.code }).toEqual({ name, format, code: exit })
          expect(JSON.parse(result.out), `${name} cli ${format}`).toEqual({ ok: false, error: expected })
        }
        for (const tool of tools) {
          expect(await hostedPayload(tool, source), `${name} hosted ${tool}`).toEqual({ ok: false, error: expected })
        }
        const stdio = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_png', arguments: { source } } })
        expect(JSON.parse((stdio!.result as { content: Array<{ text: string }> }).content[0]!.text), `${name} stdio render_png`).toEqual({ ok: false, error: expected })
        if (codeMode) {
          const sandbox = await executeInSandbox(`try { mermaid.renderMermaidSVG(${JSON.stringify(source)}); return null } catch (e) { return { code: e.code, origin: e.origin, message: e.message, details: e.details } }`)
          expect(JSON.parse(JSON.stringify(sandbox.value)), `${name} Code Mode`).toEqual(expected)
        }
        if (markdown) {
          expect(renderMarkdownBlocks(`\`\`\`mermaid\n${source}\n\`\`\``)[0], `${name} render-markdown`).toMatchObject({ ok: false, error: expected })
        }
      }
    })
  })

  test('a missing file in a multi-input render is an argument error, not a render failure', () => {
    const present = tmp('flowchart LR\n  A --> B')
    const missing = `${present}.missing.mmd`
    const { code, out } = capture(() => runCli(['render', present, missing, '--format', 'svg']))
    expect(code).toBe(0)
    expect(JSON.parse(out).files[1]).toMatchObject({ ok: false, error: { code: 'ARG', message: `File not found: ${missing}` } })
  })
})

// RENDER_FAILED is the verify finding for source the parser, or the render
// path, refuses (the warning catalog's definition). Every verify surface
// reports it with the same code; hosted verify keeps its structured parse or
// family diagnostic alongside.
describe('verify reports one finding across verify surfaces', () => {
  test('library, CLI, Code Mode and hosted verify agree on a source that does not parse', async () => {
    for (const [source, reason] of [
      ['notafamily\n  x', 'UNKNOWN_HEADER'],
      ['flowchart LR\n  A[Alpha] --> B[Beta] %% c', 'remaining input: "%% c"'],
    ] as const) {
      const library = verifyMermaid(source).warnings
      expect(library, source).toContainEqual({ code: 'RENDER_FAILED', origin: 'source', reason: expect.stringContaining(reason) })
      const cli = capture(() => runCli(['verify', tmp(source)]))
      expect(cli.code, source).toBe(3)
      expect(JSON.parse(cli.out).warnings, `${source} cli`).toEqual(library)
      const sandbox = await executeInSandbox(`return mermaid.verifyMermaid(${JSON.stringify(source)}).warnings`)
      expect(JSON.parse(JSON.stringify(sandbox.value)), `${source} Code Mode`).toEqual(library)
      const response = await handleHostedRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verify', arguments: { source } } }, {
        async execute() { return { ok: true, value: null, logs: [] } },
        async renderPng() { throw new Error('verify does not rasterize') },
      })
      const hosted = JSON.parse((response?.result as { content: Array<{ text: string }> }).content[0]!.text)
      expect(hosted.ok, source).toBe(false)
      expect(hosted.warnings, `${source} hosted`).toEqual(library)
    }
  })
})
