import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const DEPLOY_WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-cloudflare.yml'), 'utf8')
const E2E_PROBE = readFileSync(join(ROOT, 'website', 'e2e-mcp.sh'), 'utf8')

describe('production MCP deployment probe rate budget', () => {
  test('paces every request at no more than half the documented WAF budget', () => {
    const interval = DEPLOY_WORKFLOW.match(/MCP_REQUEST_INTERVAL_SECONDS:\s*['"]?([\d.]+)['"]?/)?.[1]
    expect(interval).toBeDefined()
    expect(Number(interval)).toBe(2)
    expect(60 / Number(interval)).toBeLessThanOrEqual(30)

    const mcurl = E2E_PROBE.match(/mcurl\(\) \{([\s\S]*?)\n\}/)?.[1]
    expect(mcurl).toContain('pace_request')
    expect(E2E_PROBE).toContain('sleep "$MCP_REQUEST_INTERVAL_SECONDS"')
  })
})
