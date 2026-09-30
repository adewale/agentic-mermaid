import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs()

const ROOT = join(import.meta.dir, '..', '..')
const PROBE_HELPER_PATH = join(ROOT, 'scripts', 'ci', 'mcp-probe.sh')
const PRODUCTION_MCP = 'https://agentic-mermaid.dev/mcp'
const EXPECTED_SHA = '0123456789abcdef0123456789abcdef01234567'
const CANDIDATE_ID = '11111111-2222-3333-4444-555555555555'

interface Step { name?: string; run?: string; env?: Record<string, string> }
const deployJob = (parseYaml(readFileSync(join(ROOT, '.github', 'workflows', 'deploy-cloudflare.yml'), 'utf8')) as {
  jobs: { deploy: { env: Record<string, string>; steps: Step[] } }
}).jobs.deploy
const INTERVAL = deployJob.env.MCP_REQUEST_INTERVAL_SECONDS!
// Every deployment step that talks to the production /mcp endpoint.
const productionMcpSteps = deployJob.steps.filter(step => step.run?.includes(PRODUCTION_MCP))


function envelope(value: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } })
}

/**
 * Run a deploy step against stub `curl`/`sleep`/`wrangler` that log, in order,
 * every pause and every request, so pacing is observed rather than read.
 */
function executeStep(step: Step, responses: { execute?: unknown } = {}) {
  const dir = temp.dir('agentic-mermaid-deploy-probe-')
  for (const linked of ['scripts', 'website', 'src', 'package.json']) symlinkSync(join(ROOT, linked), join(dir, linked))
  mkdirSync(join(dir, 'bin'))
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true })
  writeFileSync(join(dir, 'card.json'), JSON.stringify({ generatedFrom: { gitSha: EXPECTED_SHA } }))
  writeFileSync(join(dir, 'verify.json'), envelope({ ok: true, family: 'flowchart' }))
  writeFileSync(join(dir, 'execute.json'), envelope(responses.execute ?? { ok: true, value: 42 }))
  writeFileSync(join(dir, 'deployments.json'), JSON.stringify([{ created_on: '2026-01-01', versions: [{ version_id: CANDIDATE_ID, percentage: 100 }] }]))
  const tool = (path: string, body: string) => {
    writeFileSync(path, `#!/usr/bin/env bash\n${body}`)
    chmodSync(path, 0o755)
  }
  tool(join(dir, 'bin', 'sleep'), 'printf \'sleep %s\\n\' "$*" >> "$MOCK_ROOT/log"\n')
  tool(join(dir, 'bin', 'curl'), `printf 'curl\\n' >> "$MOCK_ROOT/log"
case "$*" in
  *server-card.json*) cat "$MOCK_ROOT/card.json" ;;
  *'"name":"verify"'*) cat "$MOCK_ROOT/verify.json" ;;
  *'"name":"execute"'*) cat "$MOCK_ROOT/execute.json" ;;
  *) printf '{}' ;;
esac
`)
  tool(join(dir, 'node_modules', '.bin', 'wrangler'), 'cat "$MOCK_ROOT/deployments.json"\n')
  writeFileSync(join(dir, 'github-output'), '')
  const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run!], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...deployJob.env,
      ...step.env,
      EXPECTED_SHA,
      CANDIDATE_ID,
      MCP_WORKER_VERSION_ID: CANDIDATE_ID,
      GITHUB_OUTPUT: join(dir, 'github-output'),
      MOCK_ROOT: dir,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
    },
  })
  const log = readFileSync(join(dir, 'log'), 'utf8').split('\n').filter(Boolean)
  const requests = log.flatMap((entry, index) => entry === 'curl' ? [index] : [])
  return {
    status: result.status,
    requests: requests.length,
    unpaced: requests.filter(index => log[index - 1] !== `sleep ${INTERVAL}`).length,
    output: readFileSync(join(dir, 'github-output'), 'utf8'),
  }
}

describe('production MCP deployment probe rate budget', () => {
  test('one shared cadence keeps production-domain probes at or under 10 requests/minute', () => {
    expect(Number(INTERVAL)).toBeGreaterThan(0)
    expect(60 / Number(INTERVAL)).toBeLessThanOrEqual(10)
  })

  test('every deployment step that probes production /mcp paces each request', () => {
    // The candidate smoke, the full no-retry probe, and the promoted check.
    expect(productionMcpSteps.length).toBeGreaterThanOrEqual(3)
    for (const step of productionMcpSteps) {
      const run = executeStep(step)
      expect({ step: step.name, madeRequests: run.requests > 0, unpaced: run.unpaced })
        .toEqual({ step: step.name, madeRequests: true, unpaced: 0 })
    }
    // Under stubs the no-retry full probe stops at its first unmet expectation,
    // so only its first request is observed above; it has no other route to
    // the network than the paced primitive.
    const fullProbe = readFileSync(join(ROOT, 'website', 'e2e-mcp.sh'), 'utf8').split('\n').map(line => line.replace(/#.*$/, ''))
    expect(fullProbe.filter(line => /(?:^|[\s;|&(])curl\s/.test(line))).toEqual([])
  })

  test('promotion is verified from the decoded tool result, not from matching response text', () => {
    const promoted = productionMcpSteps.find(step => step.run?.includes('verified=true'))
    expect(promoted?.name).toBeDefined()
    expect(executeStep(promoted!).output).toContain('verified=true')
    // `"value":42` is present in the text, but the tool reports failure.
    const failing = executeStep(promoted!, { execute: { ok: false, value: 42 } })
    expect({ status: failing.status === 0, output: failing.output }).toEqual({ status: false, output: '' })
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
