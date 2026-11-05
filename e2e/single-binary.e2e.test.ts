// Loop 13 M3 (#1018): single-binary distribution via `bun build --compile`.
// Builds the standalone executable and smoke-runs it across formats.
// Compilation is the distribution gate: failure must fail, never skip.

import { describe, test, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { useTempDirs } from '../src/__tests__/helpers/temp-dir.ts'

const REPO = join(import.meta.dir, '..')
const BUILD_SCRIPT = join(REPO, 'scripts', 'build', 'build-binary.ts')
const BUILD_TIMEOUT_MS = 120_000
const RUN_TIMEOUT_MS = 30_000

// Build once into a temp dir so we don't fight the gitignored dist/am.
const work = useTempDirs('am-bin-').dir()
const BIN = join(work, 'am')
const build = spawnSync('bun', ['run', BUILD_SCRIPT, '--outfile', BIN], { cwd: REPO, encoding: 'utf8', timeout: BUILD_TIMEOUT_MS })
const haveBinary = build.status === 0 && existsSync(BIN)
if (!haveBinary) {
  throw new Error([
    'single-binary compilation failed',
    `status=${String(build.status)} signal=${String(build.signal)}`,
    `error=${build.error?.message ?? ''}`,
    `stdout=${build.stdout ?? ''}`,
    `stderr=${build.stderr ?? ''}`,
  ].join('\n'))
}

const fixture = join(work, 'd.mmd')
writeFileSync(fixture, 'flowchart TD\n  A[Start] --> B[End]\n')

describe('#1018 single-binary distribution', () => {
  test('binary classifies an early old-Node exit before sending its embedded bundle', () => {
    const oldNode = join(work, 'old-node')
    mkdirSync(oldNode)
    writeFileSync(join(oldNode, 'node'), '#!/bin/sh\nexit 3\n', { mode: 0o755 })
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_ascii', arguments: { source: 'sequenceDiagram\nA->>B: Hello' } } }
    const result = spawnSync(BIN, ['mcp'], { cwd: work, env: { ...process.env, PATH: oldNode }, input: JSON.stringify(request) + '\n', encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).result.structuredContent).toMatchObject({ ok: false, error: { code: 'WORKER_RUNTIME_UNAVAILABLE' } })
  })

  test('binary refuses to silently drop the worker heap limit when Node is unavailable', () => {
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_ascii', arguments: { source: 'sequenceDiagram\nA->>B: Hello' } } }
    const result = spawnSync(BIN, ['mcp'], { cwd: work, env: { ...process.env, PATH: work }, input: JSON.stringify(request) + '\n', encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).result.structuredContent).toMatchObject({ ok: false, error: { code: 'WORKER_RUNTIME_UNAVAILABLE' } })
  })

  test('binary embeds its MCP source worker and returns structured results from an unrelated cwd', () => {
    const requests = ['render_svg', 'render_ascii', 'verify'].map((name, index) => ({
      jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: {
        name, arguments: { source: 'sequenceDiagram\nA->>B: Embedded worker' },
      },
    }))
    const result = spawnSync(BIN, ['mcp'], {
      cwd: work, input: requests.map(request => JSON.stringify(request)).join('\n') + '\n',
      encoding: 'utf8', timeout: RUN_TIMEOUT_MS,
    })
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
    const responses = result.stdout.trim().split('\n').map(line => JSON.parse(line))
    expect(responses).toHaveLength(3)
    for (const response of responses) {
      expect(response.result.isError).toBe(false)
      expect(response.result.structuredContent.ok).toBe(true)
      expect(response.result.structuredContent).toEqual(JSON.parse(response.result.content[0].text))
    }
  })

  test('binary renders SVG', () => {
    const r = spawnSync(BIN, ['render', fixture], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('<svg')
  })

  test('binary renders ASCII', () => {
    const r = spawnSync(BIN, ['render', '--format', 'ascii', fixture], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Start')
    expect(r.stdout).toContain('End')
    expect(r.stdout).toContain('+')
    expect(r.stdout).toMatch(/^[\x00-\x7f]*$/)
  })

  test('binary emits capabilities JSON', () => {
    const r = spawnSync(BIN, ['capabilities', '--json'], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
    expect(r.status).toBe(0)
    const cap = JSON.parse(r.stdout)
    expect(cap.families.find((family: { id: string }) => family.id === 'flowchart')?.mutationOps).toContain('add_node')
  })

  test('binary renders PNG (resvg native addon embeds)', () => {
    const out = join(work, 'd.png')
    // An unrelated cwd proves the executable is not rediscovering this repo's
    // installed assets. Its complete required resource closure must be inside
    // the binary and still pass the normal manifest verifier.
    const r = spawnSync(BIN, ['render', '--format', 'png', fixture, '--output', out], {
      cwd: work,
      encoding: 'utf8',
      timeout: RUN_TIMEOUT_MS,
    })
    expect(r.status, r.stderr).toBe(0)
    expect(existsSync(out)).toBe(true)
    expect([...readFileSync(out).subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  })
})
// No cold-start timing gate here: a wall-clock ceiling is not a merge blocker
// (docs/testing-strategy.md), and on a loaded runner the binary's cold start
// (~1s) is no faster than `bun bin/am.ts`. "binary renders SVG" covers the run.
