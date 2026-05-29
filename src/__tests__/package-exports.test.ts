import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const packageJson = require('../../package.json')

describe('package exports', () => {
  it('defines a default export fallback for runtimes resolving conditional exports', () => {
    expect(packageJson.exports['.']).toMatchObject({
      bun: './src/index.ts',
      import: './dist/index.js',
      types: './dist/index.d.ts',
      default: './dist/index.js',
    })
  })

  // Loop 7 A2: yhatt#74 — registry-driven regression that catches accidental
  // removal of conditional-export fallbacks during package.json edits.
  it('package.json parsed via fs.readFileSync has exports["."]["default"]', () => {
    const raw = readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8')
    const pkg = JSON.parse(raw)
    expect(pkg.exports).toBeDefined()
    expect(pkg.exports['.']).toBeDefined()
    expect(pkg.exports['.'].default).toBe('./dist/index.js')
  })

  it('package.json has exports["./agent"]["default"]', () => {
    const raw = readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8')
    const pkg = JSON.parse(raw)
    expect(pkg.exports['./agent']).toBeDefined()
    expect(pkg.exports['./agent'].default).toBe('./dist/agent.js')
    expect(pkg.exports['./agent'].bun).toBe('./src/agent/index.ts')
    expect(pkg.exports['./agent'].types).toBe('./dist/agent.d.ts')
  })
})
