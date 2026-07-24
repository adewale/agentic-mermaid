import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from 'yaml'

const REPO = join(import.meta.dir, '..', '..')
const workflow = parseYaml(readFileSync(join(REPO, '.github', 'workflows', 'publish.yml'), 'utf8'))
const publishStep = workflow.jobs['publish-mcp'].steps.find(
  (step: { name?: string }) => step.name === 'Publish or recover the exact MCP Registry metadata',
)
const run = publishStep?.run as string | undefined
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type RegistryState = 'match' | 'absent' | 'mismatch' | 'malformed' | 'malformed404' | 'unavailable' | 'network'

function executeRecovery(
  states: RegistryState[],
  options: { publishStatus?: number; loginStatus?: number } = {},
) {
  if (!run) throw new Error('missing MCP recovery workflow step')
  const dir = mkdtempSync(join(tmpdir(), 'agentic-mermaid-mcp-recovery-'))
  tempDirs.push(dir)
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })

  const server = JSON.parse(readFileSync(join(REPO, 'server.json'), 'utf8'))
  writeFileSync(join(dir, 'server.json'), `${JSON.stringify(server)}\n`)
  writeFileSync(join(dir, 'states'), `${states.join('\n')}\n`)
  writeFileSync(join(dir, 'response-match.json'), JSON.stringify({
    server,
    _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } },
  }))
  writeFileSync(join(dir, 'response-absent.json'), JSON.stringify({
    title: 'Not Found',
    status: 404,
    detail: 'Server not found',
  }))
  writeFileSync(join(dir, 'response-mismatch.json'), JSON.stringify({
    server: { ...server, description: 'different immutable metadata' },
    _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } },
  }))
  writeFileSync(join(dir, 'response-malformed.json'), '{}')
  writeFileSync(join(dir, 'response-malformed404.json'), '{}')
  writeFileSync(join(dir, 'response-unavailable.json'), JSON.stringify({
    title: 'Unavailable',
    status: 503,
    detail: 'try later',
  }))

  const curlMock = `#!/usr/bin/env bash
set -euo pipefail
output_file=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output_file="$2"; shift 2 ;;
    --write-out) shift 2 ;;
    *) shift ;;
  esac
done
test -n "$output_file"
count=0
if [ -f "$MOCK_ROOT/curl-count" ]; then count="$(cat "$MOCK_ROOT/curl-count")"; fi
count=$((count + 1))
printf '%s' "$count" > "$MOCK_ROOT/curl-count"
state="$(sed -n "\${count}p" "$MOCK_ROOT/states")"
if [ -z "$state" ]; then state="$(tail -n 1 "$MOCK_ROOT/states")"; fi
if [ "$state" = network ]; then
  printf '000'
  exit 7
fi
cp "$MOCK_ROOT/response-$state.json" "$output_file"
case "$state" in
  absent|malformed404) printf '404' ;;
  unavailable) printf '503' ;;
  *) printf '200' ;;
esac
`
  writeFileSync(join(bin, 'curl'), curlMock)
  chmodSync(join(bin, 'curl'), 0o755)

  const publisherMock = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$MOCK_ROOT/publisher-calls"
case "\${1:-}" in
  login) exit "\${MOCK_LOGIN_STATUS:-0}" ;;
  publish) exit "\${MOCK_PUBLISH_STATUS:-0}" ;;
  *) exit 64 ;;
esac
`
  writeFileSync(join(dir, 'mcp-publisher'), publisherMock)
  chmodSync(join(dir, 'mcp-publisher'), 0o755)

  const result = spawnSync(
    'bash',
    ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', run],
    {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...publishStep.env,
        PATH: `${bin}:${process.env.PATH}`,
        MOCK_ROOT: dir,
        MOCK_LOGIN_STATUS: String(options.loginStatus ?? 0),
        MOCK_PUBLISH_STATUS: String(options.publishStatus ?? 0),
        MCP_REGISTRY_RETRY_DELAYS: '0 0',
      },
    },
  )
  const publisherCalls = (() => {
    try {
      return readFileSync(join(dir, 'publisher-calls'), 'utf8').trim().split('\n').filter(Boolean)
    } catch {
      return []
    }
  })()
  const curlCalls = Number.parseInt(readFileSync(join(dir, 'curl-count'), 'utf8'), 10)
  return { ...result, publisherCalls, curlCalls }
}

describe('MCP Registry immutable publication recovery', () => {
  test('the executable contract uses the exact frozen-version endpoint and structural equality', () => {
    expect(run).toContain('/servers/$encoded_server_name/versions/$encoded_server_version')
    expect(run).toContain('$value | @uri')
    expect(run).toContain('.server == $expected[0]')
    expect(run).toContain('and (._meta | type == "object")')
    expect(run).toContain('--connect-timeout 5')
    expect(run).toContain('--max-time 10')
    expect(run).not.toContain('${{')
  })

  test('an existing exact version recovers without requesting OIDC or publishing', () => {
    const result = executeRecovery(['match'])
    expect({ status: result.status, calls: result.publisherCalls, curlCalls: result.curlCalls })
      .toEqual({ status: 0, calls: [], curlCalls: 1 })
    expect(result.stdout).toContain('already contains the verified metadata; recovering publication')
  })

  test('an absent version authenticates and publishes once', () => {
    const result = executeRecovery(['absent'])
    expect({ status: result.status, calls: result.publisherCalls, curlCalls: result.curlCalls }).toEqual({
      status: 0,
      calls: ['login github-oidc', 'publish'],
      curlCalls: 1,
    })
  })

  test('a response-lost or concurrent exact publish recovers after publisher failure', () => {
    const result = executeRecovery(['absent', 'match'], { publishStatus: 42 })
    expect({ status: result.status, calls: result.publisherCalls, curlCalls: result.curlCalls }).toEqual({
      status: 0,
      calls: ['login github-oidc', 'publish'],
      curlCalls: 2,
    })
    expect(result.stdout).toContain('after an ambiguous publish; recovering publication')
  })

  test.each([
    ['different immutable metadata', ['mismatch'] as RegistryState[]],
    ['a malformed success response', ['malformed'] as RegistryState[]],
    ['a malformed not-found response', ['malformed404'] as RegistryState[]],
    ['an unavailable Registry', ['unavailable'] as RegistryState[]],
    ['a network failure', ['network'] as RegistryState[]],
  ])('fails closed before authentication for %s', (_name, states) => {
    const result = executeRecovery(states)
    expect(result.status).not.toBe(0)
    expect(result.publisherCalls).toEqual([])
    expect(result.curlCalls).toBe(1)
  })

  test('a conflicting version appearing after publish remains a hard failure', () => {
    const result = executeRecovery(['absent', 'mismatch'], { publishStatus: 42 })
    expect(result.status).not.toBe(0)
    expect(result.publisherCalls).toEqual(['login github-oidc', 'publish'])
    expect(result.curlCalls).toBe(2)
  })

  test('an ambiguous failure that remains absent preserves the publisher failure', () => {
    const result = executeRecovery(['absent'], { publishStatus: 42 })
    expect(result.status).toBe(42)
    expect(result.publisherCalls).toEqual(['login github-oidc', 'publish'])
    expect(result.curlCalls).toBe(3)
  })

  test('authentication failure cannot reach publication', () => {
    const result = executeRecovery(['absent'], { loginStatus: 17 })
    expect(result.status).toBe(17)
    expect(result.publisherCalls).toEqual(['login github-oidc'])
    expect(result.curlCalls).toBe(1)
  })
})
