// Executes the release workflow's attestation, artifact-verification, npm
// publication, and MCP publisher-install `run:` blocks with stubbed network
// tools, the way mcp-publish-recovery.test.ts executes the MCP Registry step.
// Assertions are on what the shell does (exit status, which commands it
// reaches, what it asks the registry for), not on the text of the scripts.
import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

const REPO = join(import.meta.dir, '..', '..')
const workflow = parseYaml(readFileSync(join(REPO, '.github', 'workflows', 'publish.yml'), 'utf8'))

interface Step { name?: string; run?: string; env?: Record<string, string> }

function step(job: string, name: string): Step & { run: string } {
  const found = (workflow.jobs[job]?.steps as Step[] | undefined)?.find(candidate => candidate.name === name)
  if (!found?.run) throw new Error(`publish.yml ${job} has no run step named "${name}"`)
  return found as Step & { run: string }
}

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-mermaid-release-step-'))
  tempDirs.push(dir)
  mkdirSync(join(dir, 'bin'))
  return dir
}

function stub(dir: string, name: string, script: string): void {
  writeFileSync(join(dir, 'bin', name), `#!/usr/bin/env bash\nset -euo pipefail\n${script}`)
  chmodSync(join(dir, 'bin', name), 0o755)
}

function lines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []
}

/** GitHub runs `run:` with `bash --noprofile --norc -eo pipefail {0}`. */
function execute(target: Step & { run: string }, dir: string, env: Record<string, string> = {}) {
  const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', target.run], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...target.env, ...env, MOCK_ROOT: dir, PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function tarball(dir: string, packageJson: Record<string, unknown>, extra: Record<string, string> = {}): Buffer {
  const staging = join(dir, 'staging')
  mkdirSync(join(staging, 'package'), { recursive: true })
  writeFileSync(join(staging, 'package', 'package.json'), JSON.stringify(packageJson))
  for (const [file, content] of Object.entries(extra)) writeFileSync(join(staging, 'package', file), content)
  const out = join(dir, 'fixture.tgz')
  const packed = spawnSync('tar', ['--create', '--gzip', '--file', out, '-C', staging, 'package'], { encoding: 'utf8' })
  if (packed.status !== 0) throw new Error(packed.stderr)
  rmSync(staging, { recursive: true, force: true })
  const bytes = readFileSync(out)
  rmSync(out)
  return bytes
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const sriSha512 = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

describe('release gate: exact-SHA canonical CI attestation', () => {
  const gate = step('release-gate', 'Require successful canonical CI for the exact release commit')
  const SHA = '0123456789abcdef0123456789abcdef01234567'
  const OTHER = 'fedcba9876543210fedcba9876543210fedcba98'

  function attest(runs: Array<{ head_sha: string; conclusion: string }>) {
    const dir = tempDir()
    writeFileSync(join(dir, 'runs.json'), JSON.stringify({ workflow_runs: runs }))
    stub(dir, 'gh', 'printf \'%s\\n\' "$*" >> "$MOCK_ROOT/gh-calls"\ncat "$MOCK_ROOT/runs.json"\n')
    const result = execute(gate, dir, { GITHUB_SHA: SHA, GITHUB_REPOSITORY: 'owner/repo', GH_TOKEN: 'test-token' })
    return { ...result, calls: lines(join(dir, 'gh-calls')) }
  }

  test('passes only when canonical CI succeeded on the exact release commit', () => {
    expect(attest([{ head_sha: SHA, conclusion: 'success' }]).status).toBe(0)
    expect(attest([]).status).not.toBe(0)
    expect(attest([{ head_sha: OTHER, conclusion: 'success' }]).status).not.toBe(0)
    expect(attest([{ head_sha: SHA, conclusion: 'failure' }, { head_sha: OTHER, conclusion: 'success' }]).status).not.toBe(0)
  })

  test('asks for main-branch CI runs of the exact release commit', () => {
    const { calls } = attest([{ head_sha: SHA, conclusion: 'success' }])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('repos/owner/repo/actions/workflows/ci.yml/runs')
    expect(calls[0]).toContain(`head_sha=${SHA}`)
    expect(calls[0]).toContain('branch=main')
  })
})

// Both OIDC jobs re-verify the downloaded artifact before acting on it.
describe.each([
  ['publish', 'Verify the transferred tarball digest'],
  ['publish-mcp', 'Verify the tarball and extract registry metadata'],
])('%s job: transferred artifact verification', (job, name) => {
  const verify = step(job, name)

  function artifact(tamper: (dir: string, bytes: Buffer) => void = () => {}) {
    const dir = tempDir()
    const artifactDir = join(dir, 'release-artifact')
    mkdirSync(artifactDir)
    const bytes = tarball(dir, { name: 'agentic-mermaid', version: '9.9.9' }, { 'server.json': '{"name":"io.github.adewale/agentic-mermaid"}' })
    writeFileSync(join(artifactDir, 'package.tgz'), bytes)
    writeFileSync(join(artifactDir, 'package.sha256'), `${sha256(bytes)}  package.tgz\n`)
    writeFileSync(join(artifactDir, 'package-manifest.json'), JSON.stringify({
      schemaVersion: 1,
      filename: 'package.tgz',
      sha256: sha256(bytes),
      integrity: sriSha512(bytes),
    }))
    tamper(artifactDir, bytes)
    return { dir, result: execute(verify, dir) }
  }

  test('accepts the untouched artifact the package job produced', () => {
    const { result } = artifact()
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
  })

  test.each([
    ['a tarball changed after packing', (dir: string, bytes: Buffer) => writeFileSync(join(dir, 'package.tgz'), Buffer.concat([bytes, Buffer.from('x')]))],
    ['a checksum file for other bytes', (dir: string) => writeFileSync(join(dir, 'package.sha256'), `${'0'.repeat(64)}  package.tgz\n`)],
    ['a manifest naming another file', (dir: string) => {
      const manifest = JSON.parse(readFileSync(join(dir, 'package-manifest.json'), 'utf8'))
      writeFileSync(join(dir, 'package-manifest.json'), JSON.stringify({ ...manifest, filename: 'other.tgz' }))
    }],
    ['a malformed manifest digest', (dir: string) => {
      const manifest = JSON.parse(readFileSync(join(dir, 'package-manifest.json'), 'utf8'))
      writeFileSync(join(dir, 'package-manifest.json'), JSON.stringify({ ...manifest, sha256: manifest.sha256.toUpperCase() }))
    }],
    ['an unexpected extra file', (dir: string) => writeFileSync(join(dir, 'extra.txt'), 'x')],
    ['a symlinked tarball', (dir: string, bytes: Buffer) => {
      writeFileSync(join(dir, '..', 'elsewhere.tgz'), bytes)
      rmSync(join(dir, 'package.tgz'))
      symlinkSync(join(dir, '..', 'elsewhere.tgz'), join(dir, 'package.tgz'))
    }],
  ])('rejects %s', (_label, tamper) => {
    expect(artifact(tamper).result.status).not.toBe(0)
  })
})

describe('publish job: exact npm tarball publication and recovery', () => {
  const publish = step('publish', 'Publish or recover the exact npm tarball (OIDC trusted publishing)')
  type RegistryView = 'absent' | 'match' | 'mismatch' | 'unavailable'

  function run(views: RegistryView[], options: { publishStatus?: number; name?: string } = {}) {
    const dir = tempDir()
    const tarballPath = join(dir, publish.env?.TARBALL ?? '')
    mkdirSync(join(tarballPath, '..'), { recursive: true })
    const bytes = tarball(dir, { name: options.name ?? 'agentic-mermaid', version: '9.9.9' })
    writeFileSync(tarballPath, bytes)
    writeFileSync(join(dir, 'views'), `${views.join('\n')}\n`)
    writeFileSync(join(dir, 'integrity-match'), JSON.stringify(sriSha512(bytes)))
    writeFileSync(join(dir, 'integrity-mismatch'), JSON.stringify(sriSha512(Buffer.from('other bytes'))))
    stub(dir, 'npm', `printf '%s\\n' "$*" >> "$MOCK_ROOT/npm-calls"
case "$1" in
  view)
    count=0
    if [ -f "$MOCK_ROOT/view-count" ]; then count="$(cat "$MOCK_ROOT/view-count")"; fi
    count=$((count + 1))
    printf '%s' "$count" > "$MOCK_ROOT/view-count"
    state="$(sed -n "\${count}p" "$MOCK_ROOT/views")"
    if [ -z "$state" ]; then state="$(tail -n 1 "$MOCK_ROOT/views")"; fi
    case "$state" in
      absent) echo 'npm error code E404'; echo 'npm error 404 Not Found'; exit 1 ;;
      unavailable) echo 'npm error code ETIMEDOUT' >&2; exit 1 ;;
      match) cat "$MOCK_ROOT/integrity-match" ;;
      mismatch) cat "$MOCK_ROOT/integrity-mismatch" ;;
    esac
    ;;
  publish) exit "\${MOCK_PUBLISH_STATUS:-0}" ;;
  *) exit 64 ;;
esac
`)
    const result = execute(publish, dir, { MOCK_PUBLISH_STATUS: String(options.publishStatus ?? 0) })
    const calls = lines(join(dir, 'npm-calls'))
    return { ...result, calls, publishes: calls.filter(call => call.startsWith('publish')) }
  }

  test('publishes the verified tarball once, without lifecycle scripts, when the version is absent', () => {
    const result = run(['absent'])
    expect(result.status).toBe(0)
    expect(result.calls[0]).toBe('view agentic-mermaid@9.9.9 dist.integrity --json')
    expect(result.publishes).toHaveLength(1)
    const args = result.publishes[0]!.split(' ')
    expect(args).toContain(publish.env!.TARBALL!)
    expect(args).toContain('--ignore-scripts')
  })

  test('an already published byte-identical version recovers without publishing again', () => {
    const result = run(['match'])
    expect({ status: result.status, publishes: result.publishes }).toEqual({ status: 0, publishes: [] })
    expect(result.stdout).toContain('recovering publication')
  })

  test.each([
    ['the same version with different bytes', ['mismatch'] as RegistryView[]],
    ['an unreadable registry', ['unavailable'] as RegistryView[]],
  ])('fails closed before publishing for %s', (_label, views) => {
    const result = run(views)
    expect(result.status).not.toBe(0)
    expect(result.publishes).toEqual([])
  })

  test('refuses a tarball that is not this package', () => {
    const result = run(['absent'], { name: 'someone-else' })
    expect(result.status).not.toBe(0)
    expect(result.calls).toEqual([])
  })

  test('an ambiguous publish failure recovers only when the registry holds identical bytes', () => {
    const recovered = run(['absent', 'match'], { publishStatus: 42 })
    expect({ status: recovered.status, publishes: recovered.publishes.length }).toEqual({ status: 0, publishes: 1 })
    expect(recovered.stdout).toContain('after an ambiguous publish; recovering publication')

    const diverged = run(['absent', 'mismatch'], { publishStatus: 42 })
    expect(diverged.status).not.toBe(0)

    const stillAbsent = run(['absent', 'absent'], { publishStatus: 42 })
    expect(stillAbsent.status).toBe(42)
  })
})

describe('publish-mcp job: pinned publisher binary', () => {
  const install = step('publish-mcp', 'Install MCP Registry publisher')

  function installWith(digest: string | undefined) {
    const dir = tempDir()
    const staging = join(dir, 'staging')
    mkdirSync(staging)
    writeFileSync(join(staging, 'mcp-publisher'), '#!/bin/sh\n')
    const archive = join(dir, 'served.tar.gz')
    expect(spawnSync('tar', ['--create', '--gzip', '--file', archive, '-C', staging, 'mcp-publisher']).status).toBe(0)
    rmSync(staging, { recursive: true, force: true })
    stub(dir, 'curl', `output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s\\n' "$url" >> "$MOCK_ROOT/curl-urls"
cp "$MOCK_ROOT/served.tar.gz" "$output"
`)
    const result = execute(install, dir, digest === undefined ? {} : { MCP_PUBLISHER_SHA256: digest })
    return {
      ...result,
      servedDigest: sha256(readFileSync(archive)),
      urls: lines(join(dir, 'curl-urls')),
      extracted: existsSync(join(dir, 'mcp-publisher')),
    }
  }

  test('the workflow pins a SHA-256 digest and a versioned release download', () => {
    expect(install.env?.MCP_PUBLISHER_SHA256).toMatch(/^[0-9a-f]{64}$/)
    const { urls } = installWith(undefined)
    expect(urls).toHaveLength(1)
    expect(urls[0]).toMatch(/^https:\/\/github\.com\/modelcontextprotocol\/registry\/releases\/download\/v\d+\.\d+\.\d+\//)
  })

  test('refuses to extract a download whose digest differs from the pin', () => {
    const tampered = installWith(undefined)
    expect({ status: tampered.status === 0, extracted: tampered.extracted }).toEqual({ status: false, extracted: false })
  })

  test('extracts the binary when the download matches the pinned digest', () => {
    const served = installWith(undefined).servedDigest
    const matched = installWith(served)
    expect({ status: matched.status, extracted: matched.extracted }).toEqual({ status: 0, extracted: true })
  })
})
