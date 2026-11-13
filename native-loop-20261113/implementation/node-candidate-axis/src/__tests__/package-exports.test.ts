import { describe, expect, it } from 'bun:test'

const packageJson = require('../../package.json')

describe('package exports', () => {
  it('uses the Agentic Mermaid npm package name', () => {
    expect(packageJson.name).toBe('agentic-mermaid')
  })

  it('publishes publicly with npm provenance', () => {
    expect(packageJson.publishConfig).toMatchObject({ access: 'public', provenance: true })
  })
  // Loop 7 A2: yhatt#74 — catches accidental removal of conditional-export
  // fallbacks during package.json edits; workerd and browser bundles resolve
  // the runtime-neutral entries through `default`.
  it.each([
    ['.', { types: './dist/index.d.ts', import: './dist/index.js', default: './dist/index.js' }],
    ['./agent', { types: './dist/agent.d.ts', default: './dist/agent.js' }],
    ['./agent/core', { types: './dist/agent-core.d.ts', import: './dist/agent-core.js', default: './dist/agent-core.js' }],
    ['./browser/lazy', { types: './dist/browser-lazy/index.d.ts', import: './dist/browser-lazy/index.js', default: './dist/browser-lazy/index.js' }],
  ])('conditional export %s keeps its types and default fallback', (entry, targets) => {
    expect(packageJson.exports[entry]).toMatchObject(targets)
  })

  // BUILD-30: a `<script src>` consumer has no resolver, so the browser IIFE is
  // the one artifact that must be reachable without a bundler. Pin the export
  // and both CDN fields to the same file — unpkg/jsdelivr serve `unpkg`/
  // `jsdelivr` rather than the exports map, so a drifting pair silently sends
  // CDN users to the ESM build that cannot run in a script tag.
  it('publishes the browser IIFE under ./browser and both CDN fields', () => {
    const browserArtifact = './dist/browser.global.js'
    expect(packageJson.exports['./browser']).toBe(browserArtifact)
    expect(packageJson.unpkg).toBe(browserArtifact)
    expect(packageJson.jsdelivr).toBe(browserArtifact)
  })
})
