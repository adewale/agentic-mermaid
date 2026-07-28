import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const DEPLOY_WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-cloudflare.yml'), 'utf8')
const E2E_PROBE = readFileSync(join(ROOT, 'website', 'e2e-mcp.sh'), 'utf8')
const PROBE_HELPER_PATH = join(ROOT, 'scripts', 'ci', 'mcp-probe.sh')
const PROBE_HELPER = readFileSync(PROBE_HELPER_PATH, 'utf8')

describe('production MCP deployment probe rate budget', () => {
  test('paces every deployment phase through one conservative request primitive', () => {
    const interval = DEPLOY_WORKFLOW.match(/MCP_REQUEST_INTERVAL_SECONDS:\s*['"]?([\d.]+)['"]?/)?.[1]
    expect(interval).toBeDefined()
    expect(Number(interval)).toBe(6)
    expect(60 / Number(interval)).toBeLessThanOrEqual(10)

    const mcurl = E2E_PROBE.match(/mcurl\(\) \{([\s\S]*?)\n\}/)?.[1]
    expect(E2E_PROBE).toContain('source "$REPO_ROOT/scripts/ci/mcp-probe.sh"')
    expect(mcurl).toContain('mcp_curl')
    expect(PROBE_HELPER).toContain('sleep "$MCP_REQUEST_INTERVAL_SECONDS"')

    expect(DEPLOY_WORKFLOW.match(/source scripts\/ci\/mcp-probe\.sh/g)).toHaveLength(2)
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
    expect(smoke).toContain('mcp_result_json')
    expect(productionVerify).toContain('mcp_result_json')
    expect(productionVerify).not.toContain(`*'"value":42'*`)
  })

  test('decodes the JSON value inside a JSON-RPC text-content envelope', () => {
    const response = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, value: 42 }) }],
        isError: false,
      },
    })
    const parsed = spawnSync(
      'bash',
      ['-c', 'source "$1"; mcp_result_json "$2"', 'mcp-result-test', PROBE_HELPER_PATH, response],
      { encoding: 'utf8' },
    )
    expect(parsed.status).toBe(0)
    expect(JSON.parse(parsed.stdout)).toEqual({ ok: true, value: 42 })

    const malformed = spawnSync(
      'bash',
      ['-c', 'source "$1"; mcp_result_json "$2"', 'mcp-result-test', PROBE_HELPER_PATH, '{}'],
      { encoding: 'utf8' },
    )
    expect(malformed.status).not.toBe(0)
  })
})
