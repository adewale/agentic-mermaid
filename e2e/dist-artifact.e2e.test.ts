// Built-artifact contracts with distinct browser/Node bundler and lazy-ELK risks.
// Installed Node/Bun fuzz and PNG parity live at the stronger tarball consumer boundary.
import { describe, test, expect, beforeAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { useTempDirs } from '../src/__tests__/helpers/temp-dir.ts'

const REPO = join(import.meta.dir, '..')
const DIST_CORE = join(REPO, 'dist', 'agent-core.js')
const BUILD_TIMEOUT_MS = 180_000
const RUN_TIMEOUT_MS = 180_000

function findNodeBinary(): string | null {
  const candidates = [process.env.NODE_BINARY, 'node', '/opt/node22/bin/node'].filter((x): x is string => Boolean(x))
  for (const candidate of candidates) {
    try { if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate } catch {}
  }
  return null
}

const NODE = findNodeBinary()
if (!NODE) throw new Error('dist artifact gate requires a plain Node executable')

const temp = useTempDirs('am-dist-')

beforeAll(() => {
  const build = spawnSync('bun', ['run', 'build'], { cwd: REPO, encoding: 'utf8', timeout: BUILD_TIMEOUT_MS })
  // A broken build must fail loudly, not skip — that is exactly what shipping
  // would break.
  if (build.status !== 0 || !existsSync(DIST_CORE)) {
    throw new Error(`\`bun run build\` failed (status ${build.status}); built artifact contracts cannot run.\n${build.stderr ?? ''}`)
  }
}, BUILD_TIMEOUT_MS)

describe('built artifact bundler and deferred dependency contracts', () => {

  test('runtime-neutral agent entry bundles for a browser target', () => {
    const work = temp.dir('am-agent-core-browser-')
    const outfile = join(work, 'agent-core.js')
    const bundled = spawnSync('bun', ['build', DIST_CORE, '--target=browser', '--outfile', outfile], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: BUILD_TIMEOUT_MS,
    })
    expect({ status: bundled.status, stderr: bundled.stderr }).toEqual({ status: 0, stderr: '' })
    expect(existsSync(outfile)).toBe(true)
    // A browser bundler resolves `#elk-constructor` to the bundled ELK, so an
    // ELK family lays out synchronously with no Node module loader.
    const rendered = spawnSync('bun', ['--eval', `const { renderMermaidSVG } = await import(${JSON.stringify(outfile)}); console.log(renderMermaidSVG('flowchart TD\\n  A -->|needs ELK| B').startsWith('<svg'))`], { cwd: work, encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
    expect({ status: rendered.status, stdout: rendered.stdout.trim(), stderr: rendered.stderr }).toEqual({ status: 0, stdout: 'true', stderr: '' })
  }, BUILD_TIMEOUT_MS + RUN_TIMEOUT_MS)

  test('Node loads elkjs only when a family first lays out with it', () => {
    const probe = `
      import { createRequire } from 'node:module'
      const require = createRequire(import.meta.url)
      const loaded = () => Object.keys(require.cache).some(path => path.includes('/elkjs/'))
      const { renderMermaidSVG } = await import(${JSON.stringify(DIST_CORE)})
      const states = [loaded()]
      renderMermaidSVG('sequenceDiagram\\n  A->>B: hi')
      states.push(loaded())
      renderMermaidSVG('flowchart TD\\n  A --> B')
      states.push(loaded())
      renderMermaidSVG('flowchart TD\\n  A -->|needs ELK| B')
      states.push(loaded())
      console.log(JSON.stringify(states))`
    const run = spawnSync(NODE, ['--input-type=module', '--eval', probe], { cwd: REPO, encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
    expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: '' })
    // Import, sequence, certified forest, then an ineligible labelled edge.
    expect(JSON.parse(run.stdout)).toEqual([false, false, false, true])
  }, RUN_TIMEOUT_MS)

  test('a Node bundle of the agent entry carries ELK and needs no node_modules', () => {
    const work = temp.dir('am-agent-core-node-bundle-')
    const entry = join(work, 'entry.mjs')
    writeFileSync(entry, `import { renderMermaidSVG } from ${JSON.stringify(DIST_CORE)}\nconsole.log(renderMermaidSVG('flowchart TD\\n  A -->|needs ELK| B').startsWith('<svg'))\n`)
    for (const format of ['esm', 'cjs'] as const) {
      const outfile = join(work, `bundle.${format === 'esm' ? 'mjs' : 'cjs'}`)
      const bundled = spawnSync('bun', ['build', entry, '--target=node', `--format=${format}`, '--outfile', outfile], { cwd: work, encoding: 'utf8', timeout: BUILD_TIMEOUT_MS })
      expect({ format, status: bundled.status, stderr: bundled.stderr }).toEqual({ format, status: 0, stderr: '' })
      const rendered = spawnSync(NODE, [outfile], { cwd: work, encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
      expect({ format, status: rendered.status, stdout: rendered.stdout.trim(), stderr: rendered.stderr }).toEqual({ format, status: 0, stdout: 'true', stderr: '' })
    }
  }, BUILD_TIMEOUT_MS + RUN_TIMEOUT_MS)
})
