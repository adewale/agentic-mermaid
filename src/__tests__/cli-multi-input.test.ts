// Loop 13 M4 (#959) + M5 (#930): multi-input rendering + watch re-render step.

import { describe, test, expect } from 'bun:test'
import { readFileSync, renameSync, watch as fsWatch, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCli, renderWatchFrame, watchPathForChanges } from '../cli/index.ts'
import { captureCli as capture } from './helpers/cli-capture.ts'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs('am-multi-input-')
const tmp = (content: string): string => temp.file('input.mmd', content)

describe('#930 pathname watch lifecycle', () => {
  test('observes atomic rename-over saves and subsequent writes to the replacement inode', async () => {
    // Watch an owned directory, not the shared OS /tmp root: Bun's Linux
    // fs.watch implementation may inspect unrelated protected service dirs.
    const dir = temp.dir('am-watch-')
    const input = join(dir, 'input.mmd')
    writeFileSync(input, 'flowchart TD\n A --> B')
    const replacement = `${input}.replacement`
    const observed: string[] = []
    let notify: (() => void) | undefined
    const waitForChange = () =>
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('watch change timed out')), 10_000)
        notify = () => {
          clearTimeout(timeout)
          resolve()
        }
      })
    const handle = watchPathForChanges(
      input,
      () => {
        observed.push(readFileSync(input, 'utf8'))
        notify?.()
        notify = undefined
      },
      5,
    )
    try {
      // Yield once after watcher construction: Linux/Bun may register the
      // inotify subscription on the following event-loop turn under coverage.
      await new Promise(resolve => setTimeout(resolve, 100))
      // Some fs.watch implementations emit an initial metadata notification;
      // the contract under test begins with the authored post-watch save.
      observed.length = 0
      const atomic = waitForChange()
      writeFileSync(replacement, 'flowchart TD\n A --> C')
      renameSync(replacement, input)
      await atomic

      const subsequent = waitForChange()
      writeFileSync(input, 'flowchart TD\n A --> D')
      await subsequent
      expect(observed).toEqual(['flowchart TD\n A --> C', 'flowchart TD\n A --> D'])
    } finally {
      handle.close()
    }
  })

  test('metadata polling observes changes when the host event source stays silent', async () => {
    const dir = temp.dir('am-watch-poll-')
    const input = join(dir, 'input.mmd')
    writeFileSync(input, 'flowchart TD\n A --> B')
    const silentWatch = (() => ({ close() {} })) as unknown as typeof fsWatch
    let notify: (() => void) | undefined
    const changed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('watch polling timed out')), 2_000)
      notify = () => {
        clearTimeout(timeout)
        resolve()
      }
    })
    const handle = watchPathForChanges(input, () => notify?.(), 5, silentWatch)
    try {
      writeFileSync(input, 'flowchart TD\n A --> C')
      await changed
    } finally {
      handle.close()
    }
  })
})

describe('#959 multi-input rendering', () => {
  test('renders multiple files, emits a results array, skips bad ones', () => {
    const a = tmp('flowchart TD\n A --> B')
    const b = tmp('flowchart LR\n X --> Y')
    const bad = tmp('not a diagram')
    const { code, out } = capture(() => runCli(['render', a, b, bad, '--format', 'ascii']))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload.files.length).toBe(3)
    expect(payload.files[0].ok).toBe(true)
    expect(payload.files[1].ok).toBe(true)
    expect(payload.files[2].ok).toBe(false)
    expect(payload.files[2].error.code).toBe('UNKNOWN_HEADER')
  })

  test('multi-input json parse errors expose structured details, not stringified blobs', () => {
    const good = tmp('flowchart TD\n A --> B')
    const bad = tmp('flowchart XX\n  A --> B')
    const { code, out } = capture(() => runCli(['render', good, bad, '--format', 'layout']))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload.files[1].ok).toBe(false)
    expect(payload.files[1].error.code).toBe('PARSE_FAILED')
    expect(Array.isArray(payload.files[1].error.details)).toBe(true)
    expect(payload.files[1].error.message).not.toContain('"details"')
  })

  test('single input keeps single-output behavior (no results array)', () => {
    const a = tmp('flowchart TD\n A --> B')
    const { code, out } = capture(() => runCli(['render', a, '--format', 'ascii']))
    expect(code).toBe(0)
    expect(() => JSON.parse(out)).toThrow() // raw ASCII, not a JSON envelope
  })

  test('--security strict applies to multi-input SVG renders', () => {
    const a = tmp('flowchart TD\n A --> B')
    const b = tmp('flowchart LR\n X --> Y')
    const { code, out } = capture(() => runCli(['render', a, b, '--format', 'svg', '--security', 'strict']))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload.files.every((f: any) => f.ok && !f.output.includes('fonts.googleapis.com'))).toBe(true)
  })

  test('invalid --security values are rejected instead of silently using default mode', () => {
    const a = tmp('flowchart TD\n A --> B')
    expect(runCli(['render', a, '--security', 'stric'])).toBe(2)
  })

  test('--watch rejects multiple inputs instead of doing a one-shot multi-render', () => {
    const a = tmp('flowchart TD\n A --> B')
    const b = tmp('flowchart LR\n X --> Y')
    expect(runCli(['render', a, b, '--watch'])).toBe(2)
  })
})

describe('#930 watch frame (the step every --watch change runs)', () => {
  test('reflects file changes on re-invocation', () => {
    const f = tmp('flowchart TD\n A[Before]')
    expect(renderWatchFrame(f, 'ascii', {}, false)).toMatchObject({ output: expect.stringContaining('Before'), stderr: [] })
    writeFileSync(f, 'flowchart TD\n A[After]')
    expect(renderWatchFrame(f, 'ascii', {}, false).output).toContain('After')
  })

  test('a frame reports each ineffective config field once, before its output', () => {
    const f = tmp('---\nconfig:\n  journey:\n    boxMargin: 10\n---\njourney\n  Task: 3: Me')
    const frame = renderWatchFrame(f, 'svg', {}, false)
    expect(frame.output).toContain('<svg')
    expect(frame.stderr.filter(line => line.includes('journey.boxMargin'))).toEqual([
      expect.stringMatching(/^am render --watch: warning INEFFECTIVE_CONFIG \(journey\.boxMargin\): .+\n$/),
    ])
  })

  test('strict SVG option applies to the watch frame', () => {
    const f = tmp('flowchart TD\n A --> B')
    const output = renderWatchFrame(f, 'svg', { security: 'strict' }, false).output
    expect(output).toContain('<svg')
    expect(output).not.toContain('fonts.googleapis.com')
  })

  test('a failed frame prints the family diagnostic, as JSON under --json and as one line otherwise', () => {
    for (const fixture of [
      {
        source: 'futureDiagram&#45;v99\n  payload',
        code: 'UNKNOWN_HEADER',
        authoredHeader: 'futureDiagram&#45;v99',
      },
      {
        source: 'swimlane&#45;beta\n  preserved future payload',
        code: 'UNSUPPORTED_FAMILY',
        authoredHeader: 'swimlane&#45;beta',
      },
    ]) {
      const file = tmp(fixture.source)
      const structured = renderWatchFrame(file, 'svg', {}, true)
      expect(structured.output).toBeUndefined()
      expect(structured.stderr).toHaveLength(1)
      const payload = JSON.parse(structured.stderr[0]!)
      expect(payload).toMatchObject({
        ok: false,
        error: {
          code: fixture.code,
          line: 1,
          preservation: { source: fixture.source },
          help: expect.stringContaining('source was preserved unchanged'),
        },
      })
      expect(payload.error.message).not.toContain('undefined')
      const span = payload.error.preservation.spans.header
      expect(fixture.source.slice(span.start.offset, span.end.offset)).toBe(fixture.authoredHeader)

      const plain = renderWatchFrame(file, 'svg', {}, false)
      expect(plain.output).toBeUndefined()
      expect(plain.stderr).toEqual([`render error: ${fixture.code}: ${payload.error.message}\n`])
    }
  })

  test('watch mode rejects PNG instead of writing SVG to a PNG path', () => {
    const f = tmp('flowchart TD\n A --> B')
    const code = runCli(['render', f, '--format', 'png', '--output', `${f}.png`, '--watch'])
    expect(code).toBe(2)
  })

  test('PNG rejects non-positive and non-finite scales as argument errors', () => {
    const f = tmp('flowchart TD\n A --> B')
    const output = `${f}.png`
    for (const scale of ['0', '-1', 'NaN', 'Infinity']) {
      expect(runCli(['render', f, '--format', 'png', '--output', output, '--scale', scale])).toBe(2)
    }
  })
})
