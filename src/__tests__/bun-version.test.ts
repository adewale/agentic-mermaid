// The minimum Bun version (src/mcp/bun-version.ts) and every place that states
// it or pins a Bun: package.json, the workflows, and the website payload
// baseline, which CI compares byte for byte on its pinned Bun.
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import pkg from '../../package.json'
import { WEBSITE_PAYLOAD_RECORDING_TOOLCHAIN } from '../../scripts/site/website-payload-authority.ts'
import { MIN_BUN_VERSION, unsupportedBunReason } from '../mcp/bun-version.ts'

const REPO = join(import.meta.dir, '..', '..')

function workflowBunPins(): string[] {
  const dir = join(REPO, '.github', 'workflows')
  return readdirSync(dir).filter(file => /\.ya?ml$/.test(file)).flatMap(file => {
    const workflow = parseYaml(readFileSync(join(dir, file), 'utf8')) as { jobs?: Record<string, { steps?: Array<{ uses?: string; with?: Record<string, unknown> }> }> }
    return Object.values(workflow.jobs ?? {}).flatMap(job => job.steps ?? [])
      .filter(step => step.uses?.startsWith('oven-sh/setup-bun@'))
      .map(step => String(step.with?.['bun-version']))
  })
}

describe('minimum Bun version', () => {
  test('refuses every Bun before 1.4.0, whose node:vm timeout outlives the call or is ignored', () => {
    for (const version of ['0.9.99', '1.2.14', '1.2.15', '1.3.12', '1.3.13', '1.3.14']) {
      expect(unsupportedBunReason(version)).toContain(`requires Bun ${MIN_BUN_VERSION} or later (found ${version})`)
    }
  })

  test('accepts 1.4.0 onwards, comparing versions numerically', () => {
    for (const version of ['1.4.0', '1.4.2', '1.4.1-canary.3+abcdef', '1.10.0', '2.0.0']) {
      expect(unsupportedBunReason(version)).toBeUndefined()
    }
  })

  test('does not apply off Bun, fails closed on an unreadable version, and holds for this run', () => {
    expect(unsupportedBunReason(undefined)).toBeUndefined()
    expect(unsupportedBunReason('canary')).toContain('found canary')
    expect(unsupportedBunReason()).toBeUndefined()
  })

  test('package.json, every workflow, and the payload baseline agree on a supported Bun', () => {
    expect(pkg.engines.bun).toBe(`>=${MIN_BUN_VERSION}`)
    const pins = workflowBunPins()
    expect(pins.length).toBeGreaterThan(0)
    for (const pin of pins) expect(unsupportedBunReason(pin)).toBeUndefined()
    // CI verifies the payload baseline exactly, which only works on the Bun that recorded it.
    expect([...new Set(pins)]).toEqual([WEBSITE_PAYLOAD_RECORDING_TOOLCHAIN.bun])
  })
})
