import { describe, expect, test } from 'bun:test'
import { renderSourceToFormatWithReceipt, runBatchLine } from '../cli/index.ts'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { once } from 'node:events'

const source = 'flowchart LR\n  A --> B'

function render(options: Record<string, unknown>, lineIndex = 0) {
  return runBatchLine(JSON.stringify({ op: 'render', source, options }), lineIndex)
}

describe('batch render uses the canonical render contract', () => {
  test('live JSONL emits before EOF and preserves UTF-8, nonblank indices and per-line errors', async () => {
    const child = spawn(process.execPath, ['src/cli/am-bin.ts', 'batch', '--jsonl'], { stdio: ['pipe', 'pipe', 'pipe'] })
    const closed = once(child, 'close')
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', text => { stderr += text })
    const deadline = async <T>(promise: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout>
      const result = await Promise.race([promise.then(value => ({ kind: 'response' as const, value })), new Promise<{ kind: 'timeout' }>(resolve => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), 10000)
      })]).finally(() => clearTimeout(timer))
      expect(result.kind).toBe('response')
      if (result.kind !== 'response') throw new Error('batch did not respond while stdin remained open')
      return result.value
    }
    try {
      const request = Buffer.from('\r\n  \n' + JSON.stringify({ op: 'render', source: 'flowchart LR\n A["λ🚀"] --> B', options: { idPrefix: 'caller-' } }) + '\r\n')
      const split = request.indexOf(Buffer.from('🚀')) + 2
      child.stdin.write(request.subarray(0, split))
      await new Promise(resolve => setTimeout(resolve, 10))
      child.stdin.write(request.subarray(split))
      const first = await deadline(lines.next())
      expect(first.done).toBe(false)
      const value = JSON.parse(first.value!)
      expect(value.ok).toBe(true)
      expect(value.data.svg).toContain('λ🚀')
      expect(value.data.svg).toContain('d0-caller-')
      expect(value.data.receipt.output).toBe('svg')
      // Error lines count towards the namespace; blank lines do not. The last
      // request deliberately has no trailing newline.
      child.stdin.end('\n{bad json}\n \r\n' + JSON.stringify({ op: 'render', source, options: { idPrefix: 'caller-' } }))
      const bad = JSON.parse((await deadline(lines.next())).value!)
      expect(bad).toMatchObject({ ok: false, error: { code: 'INVALID_JSON' } })
      const last = JSON.parse((await deadline(lines.next())).value!)
      expect(last.ok).toBe(true)
      expect(last.data.svg).toContain('d2-caller-')
      expect((await deadline(lines.next())).done).toBe(true)
      expect((await closed)[0]).toBe(0)
      expect(stderr).toBe('')
    } finally {
      child.stdin.destroy()
      child.kill()
      await closed
    }
  })

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
