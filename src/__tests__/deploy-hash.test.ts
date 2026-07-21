// Full-deploy version hash (website/src/deploy-hash.ts) drives the /mcp
// response-cache version. It must change when ANY hashed part changes and be
// stable otherwise, or a deploy that alters a hosted tool without moving the
// harness would keep serving stale cached results.

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeDeployVersion } from '../../website/src/deploy-hash.ts'
import { ensureWebsiteBuilt } from './website-public-fixture.ts'

ensureWebsiteBuilt()

const bytes = (s: string) => new TextEncoder().encode(s)

describe('computeDeployVersion', () => {
  test('is deterministic for identical inputs', () => {
    const parts = [bytes('worker'), bytes('harness'), bytes('wasm')]
    expect(computeDeployVersion('0.1.0', parts)).toBe(computeDeployVersion('0.1.0', parts))
  })

  test('changes when any single part changes — every part is covered', () => {
    const base = [bytes('worker'), bytes('harness'), bytes('wasm'), bytes('font')]
    const v0 = computeDeployVersion('0.1.0', base)
    for (let i = 0; i < base.length; i++) {
      const mutated = base.map((p, j) => (j === i ? bytes('changed') : p))
      expect(computeDeployVersion('0.1.0', mutated)).not.toBe(v0)
    }
  })

  test('changes when the package version changes', () => {
    const parts = [bytes('worker')]
    expect(computeDeployVersion('0.1.0', parts)).not.toBe(computeDeployVersion('0.2.0', parts))
  })

  test('part boundaries are unambiguous — concatenation cannot alias', () => {
    // ['ab',''] and ['a','b'] must not collide (a length-blind concat would).
    expect(computeDeployVersion('0.1.0', [bytes('ab'), bytes('')]))
      .not.toBe(computeDeployVersion('0.1.0', [bytes('a'), bytes('b')]))
  })

  test('emits the v<version>-<24 hex> shape', () => {
    expect(computeDeployVersion('9.9.9', [bytes('x')])).toMatch(/^v9\.9\.9-[0-9a-f]{24}$/)
  })
})

describe('generated deploy-version.ts', () => {
  const rel = join(import.meta.dir, '..', '..', 'website', 'src', 'generated', 'deploy-version.ts')

  test('exists and exports a well-formed DEPLOY_VERSION (run `bun run website`)', () => {
    expect(existsSync(rel)).toBe(true)
    const text = readFileSync(rel, 'utf8')
    expect(text).toMatch(/export const DEPLOY_VERSION = 'v\d+\.\d+\.\d+-[0-9a-f]{24}'/)
  })
})
