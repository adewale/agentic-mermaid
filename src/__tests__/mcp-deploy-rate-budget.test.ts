import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const DEPLOY_WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-cloudflare.yml'), 'utf8')
const E2E_PROBE = readFileSync(join(ROOT, 'website', 'e2e-mcp.sh'), 'utf8')
const PACED_CURL = readFileSync(join(ROOT, 'scripts', 'ci', 'mcp-paced-curl.sh'), 'utf8')

describe('production MCP deployment probe rate budget', () => {
  test('paces every deployment phase through one conservative request primitive', () => {
    const interval = DEPLOY_WORKFLOW.match(/MCP_REQUEST_INTERVAL_SECONDS:\s*['"]?([\d.]+)['"]?/)?.[1]
    expect(interval).toBeDefined()
    expect(Number(interval)).toBe(6)
    expect(60 / Number(interval)).toBeLessThanOrEqual(10)

    const mcurl = E2E_PROBE.match(/mcurl\(\) \{([\s\S]*?)\n\}/)?.[1]
    expect(E2E_PROBE).toContain('source "$REPO_ROOT/scripts/ci/mcp-paced-curl.sh"')
    expect(mcurl).toContain('mcp_curl')
    expect(PACED_CURL).toContain('sleep "$MCP_REQUEST_INTERVAL_SECONDS"')

    expect(DEPLOY_WORKFLOW.match(/source scripts\/ci\/mcp-paced-curl\.sh/g)).toHaveLength(2)
    expect(DEPLOY_WORKFLOW).toContain('got="$(mcp_curl')
    expect(DEPLOY_WORKFLOW).toContain('card="$(mcp_curl')
    expect(DEPLOY_WORKFLOW).toContain('verify="$(mcp_curl')
    expect(DEPLOY_WORKFLOW).toContain('execute="$(mcp_curl')

    const smoke = DEPLOY_WORKFLOW.slice(
      DEPLOY_WORKFLOW.indexOf('- name: Smoke-test the zero-traffic candidate through production'),
      DEPLOY_WORKFLOW.indexOf('- name: Probe the full zero-traffic /mcp candidate'),
    )
    const productionVerify = DEPLOY_WORKFLOW.slice(
      DEPLOY_WORKFLOW.indexOf('- name: Verify the promoted production version'),
      DEPLOY_WORKFLOW.indexOf('- name: Roll back any unverified deployment'),
    )
    expect(smoke).not.toContain('$(curl ')
    expect(productionVerify).not.toContain('$(curl ')
  })
})
