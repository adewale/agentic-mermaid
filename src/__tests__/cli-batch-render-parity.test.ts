import { describe, expect, test } from 'bun:test'
import { renderSourceToFormatWithReceipt, runBatchLine } from '../cli/index.ts'

const source = 'flowchart LR\n  A --> B'

function render(options: Record<string, unknown>, lineIndex = 0) {
  return runBatchLine(JSON.stringify({ op: 'render', source, options }), lineIndex)
}

describe('batch render uses the canonical render contract', () => {
  test('threads shared options and returns the same SVG receipt', () => {
    const options = { format: 'svg', style: 'nord-light', seed: 8, security: 'strict', idPrefix: 'caller-' }
    const actual = render(options, 3)
    const expected = renderSourceToFormatWithReceipt(source, 'svg', {
      style: 'nord-light', seed: 8, security: 'strict', idPrefix: 'd3-caller-',
    })
    expect(actual).toEqual({ ok: true, op: 'render', data: { svg: expected.output, receipt: expected.receipt } })
  })

  test('renders the canonical ASCII format with a receipt', () => {
    const actual = render({ format: 'ascii', targetWidth: 80 })
    expect(actual.ok).toBe(true)
    expect(actual.data).toEqual(expect.objectContaining({
      ascii: expect.any(String),
      receipt: expect.objectContaining({ output: 'ascii' }),
    }))
  })

  test('rejects unknown styles, malformed shared fields, and removed aliases', () => {
    expect(render({ style: 'not-a-style' })).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: 'INVALID_OPTIONS', message: expect.stringContaining('Unknown style') }),
    }))
    expect(render({ seed: 'bad' })).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: 'INVALID_OPTIONS', message: expect.stringContaining('seed') }),
    }))
    expect(render({ ascii: true })).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: 'INVALID_OPTIONS', message: expect.stringContaining('ascii') }),
    }))
  })
})
