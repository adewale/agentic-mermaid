// Executes the release workflow's attestation, artifact-verification, npm
// publication, and MCP publisher-install `run:` blocks with stubbed network
// tools, the way mcp-publish-recovery.test.ts executes the MCP Registry step.
// Assertions are on what the shell does (exit status, which commands it
// reaches, what it asks the registry for), not on the text of the scripts.
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs()

const REPO = join(import.meta.dir, '..', '..')
const workflow = parseYaml(readFileSync(join(REPO, '.github', 'workflows', 'publish.yml'), 'utf8'))
const ciWorkflow = parseYaml(readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8'))
const qualification = parseYaml(readFileSync(join(REPO, '.github', 'workflows', 'qualify-ci.yml'), 'utf8'))

interface Step { name?: string; run?: string; env?: Record<string, string> }

function step(job: string, name: string, source = workflow): Step & { run: string } {
  const found = (source.jobs[job]?.steps as Step[] | undefined)?.find(candidate => candidate.name === name)
  if (!found?.run) throw new Error(`${job} has no run step named "${name}"`)
  return found as Step & { run: string }
}

function tempDir(): string {
  const dir = temp.dir('agentic-mermaid-release-step-')
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
  const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', target.run], { timeout: 20_000, killSignal: 'SIGKILL',
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
  const packed = spawnSync('tar', ['--create', '--gzip', '--file', out, '-C', staging, 'package'], { timeout: 20_000, killSignal: 'SIGKILL', encoding: 'utf8' })
  if (packed.status !== 0) throw new Error(packed.stderr)
  rmSync(staging, { recursive: true, force: true })
  const bytes = readFileSync(out)
  rmSync(out)
  return bytes
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const sriSha512 = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

describe('shared exact-SHA canonical CI qualification', () => {
  const gate = step('qualify', 'Require full canonical CI qualification', qualification)
  const SHA = '0123456789abcdef0123456789abcdef01234567'
  type Job = { name: string; conclusion: string }
  const passing = [{ name: 'test', conclusion: 'success' }, { name: 'CI complete', conclusion: 'success' }]

  function attest(options: { required?: boolean; jobs?: Job[]; run?: Record<string, unknown> | null; apiFailure?: boolean; malformedJobs?: boolean } = {}) {
    const dir = tempDir()
    writeFileSync(join(dir, 'runs.json'), JSON.stringify({ workflow_runs: options.run === null ? [] : [{ id: 42, head_sha: SHA, head_branch: 'main', conclusion: 'success', ...options.run }] }))
    writeFileSync(join(dir, 'jobs.json'), options.malformedJobs ? '{' : JSON.stringify({ jobs: options.jobs ?? passing }))
    stub(dir, 'gh', options.apiFailure ? 'exit 17' : `case "$*" in
      *'/jobs'*) cat "$MOCK_ROOT/jobs.json" ;;
      *) cat "$MOCK_ROOT/runs.json" ;;
    esac`)
    const output = join(dir, 'output')
    writeFileSync(output, '')
    const result = execute(gate, dir, {
      EXPECTED_SHA: SHA, GITHUB_REPOSITORY: 'owner/repo', GH_TOKEN: 'test-token',
      REQUIRE_QUALIFICATION: String(options.required ?? true),
      GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(dir, 'summary'),
    })
    return { ...result, output: readFileSync(output, 'utf8') }
  }

  test('release identity cannot run before the shared required qualification', () => {
    expect(workflow.jobs['release-gate'].needs).toBe('qualification')
    expect(workflow.jobs.qualification.uses).toBe('./.github/workflows/qualify-ci.yml')
    expect(workflow.jobs.qualification.with.commit).toBe('${{ github.sha }}')
    expect(workflow.jobs.qualification.with.required ?? qualification.on.workflow_call.inputs.required.default).toBe(true)
  })

  test.each([true, false])('full runtime proof qualifies with required=%s', required => {
    const result = attest({ required })
    expect({ status: result.status, output: result.output }).toEqual({ status: 0, output: 'qualified=true\n' })
  })

  test.each(['failure', 'cancelled', 'skipped', 'missing'])('a runtime aggregate that is %s cannot qualify docs-only success', conclusion => {
    const jobs = passing.flatMap(job => job.name === 'test' ? conclusion === 'missing' ? [] : [{ ...job, conclusion }] : [job])
    for (const required of [true, false]) {
      const result = attest({ required, jobs })
      expect({ status: result.status, output: result.output }).toEqual({ status: required ? 1 : 0, output: 'qualified=false\n' })
    }
  })

  test('canonical completion is required in addition to runtime proof', () => {
    expect(attest({ jobs: passing.filter(job => job.name !== 'CI complete') }).status).not.toBe(0)
  })

  test.each([{ head_sha: 'f'.repeat(40) }, { head_branch: 'release' }, { conclusion: 'cancelled' }])('refuses mismatched run identity %j', run => {
    expect(attest({ run }).output).toBe('qualified=false\n')
  })

  test('no successful canonical run cannot qualify', () => {
    const result = attest({ run: null })
    expect(result.status).not.toBe(0)
    expect(result.output).toBe('qualified=false\n')
  })

  test.each([{ apiFailure: true }, { malformedJobs: true }])('an unreadable Actions API fails rather than reporting a normal deployment skip: %j', failure => {
    const result = attest({ required: false, ...failure })
    expect(result.status).not.toBe(0)
    expect(result.output).toBe('')
  })
})

// Every downloaded-artifact consumer checks the bytes before acting on them.
describe.each([
  ['publish', 'Verify the transferred tarball digest', workflow],
  ['publish-mcp', 'Verify the tarball and extract registry metadata', workflow],
])('%s job: transferred artifact verification', (job, name, source) => {
  const verify = step(job, name, source)

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

  test('rejects a manifest with mismatched SHA-512 integrity', () => {
    const { result } = artifact(dir => {
      const path = join(dir, 'package-manifest.json')
      const manifest = JSON.parse(readFileSync(path, 'utf8'))
      writeFileSync(path, JSON.stringify({ ...manifest, integrity: sriSha512(Buffer.from('other bytes')) }))
    })
    expect(result.status).not.toBe(0)
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

describe('publish-mcp job: public npm availability', () => {
  const wait = step('publish-mcp', 'Wait for the byte-identical public npm version')
  type PublicState = 'match' | 'absent' | 'unavailable' | 'network' | 'mismatch' | 'wrongVersion' | 'wrongName' | 'malformed' | 'forbidden'

  function availability(states: PublicState[]) {
    const dir = tempDir()
    mkdirSync(join(dir, 'release-artifact'))
    const bytes = tarball(dir, { name: 'agentic-mermaid', version: '9.9.9' })
    writeFileSync(join(dir, 'release-artifact', 'package.tgz'), bytes)
    const integrity = sriSha512(bytes)
    writeFileSync(join(dir, 'release-artifact', 'package-manifest.json'), JSON.stringify({ integrity }))
    const metadata = { name: 'agentic-mermaid', version: '9.9.9', dist: { integrity } }
    writeFileSync(join(dir, 'response-match'), JSON.stringify(metadata))
    writeFileSync(join(dir, 'response-mismatch'), JSON.stringify({ ...metadata, dist: { integrity: sriSha512(Buffer.from('other bytes')) } }))
    writeFileSync(join(dir, 'response-wrongVersion'), JSON.stringify({ ...metadata, version: '9.9.8' }))
    writeFileSync(join(dir, 'response-wrongName'), JSON.stringify({ ...metadata, name: 'someone-else' }))
    writeFileSync(join(dir, 'response-malformed'), '{')
    writeFileSync(join(dir, 'states'), `${states.join('\n')}\n`)
    stub(dir, 'sleep', 'printf \'%s\\n\' "$*" >> "$MOCK_ROOT/sleeps"\n')
    stub(dir, 'curl', `output=
connect_timeout=none
max_time=none
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --write-out) shift 2 ;;
    --connect-timeout) connect_timeout="$2"; shift 2 ;;
    --max-time) max_time="$2"; shift 2 ;;
    --silent|--show-error|--location) shift ;;
    *) printf '%s\\n' "$1" >> "$MOCK_ROOT/requests"; shift ;;
  esac
done
printf '%s %s\\n' "$connect_timeout" "$max_time" >> "$MOCK_ROOT/request-timeouts"
count=$(wc -l < "$MOCK_ROOT/requests")
state="$(sed -n "\${count}p" "$MOCK_ROOT/states")"
if [ -z "$state" ]; then state="$(tail -n 1 "$MOCK_ROOT/states")"; fi
case "$state" in
  network) exit 7 ;;
  absent) printf '404' ;;
  unavailable) printf '503' ;;
  forbidden) printf '403' ;;
  *) cp "$MOCK_ROOT/response-$state" "$output"; printf '200' ;;
esac
`)
    const result = execute(wait, dir, { NPM_AVAILABILITY_RETRY_DELAYS: '0 15 30' })
    return { ...result, requests: lines(join(dir, 'requests')), sleeps: lines(join(dir, 'sleeps')), timeouts: lines(join(dir, 'request-timeouts')) }
  }

  test.each(['absent', 'unavailable', 'network'] as const)('waits through %s until the exact published bytes are public', state => {
    const result = availability([state, state, 'match'])
    expect({ status: result.status, requests: result.requests, sleeps: result.sleeps }).toEqual({
      status: 0,
      requests: Array(3).fill('https://registry.npmjs.org/agentic-mermaid/9.9.9'),
      sleeps: ['0', '15', '30'],
    })
  })

  test.each(['mismatch', 'wrongVersion', 'wrongName', 'malformed', 'forbidden'] as const)('fails closed without retry for %s metadata', state => {
    const result = availability([state, 'match'])
    expect(result.status).not.toBe(0)
    expect(result.requests).toEqual(['https://registry.npmjs.org/agentic-mermaid/9.9.9'])
  })

  test('bounds every metadata request even while retrying a network failure', () => {
    const result = availability(['network', 'match'])
    expect(result.timeouts).toEqual(['5 10', '5 10'])
  })

  test('stops after the bounded wait when public availability never converges', () => {
    const result = availability(['absent'])
    expect(result.status).not.toBe(0)
    expect(result.requests).toHaveLength(3)
    expect(result.sleeps).toEqual(['0', '15', '30'])
  })
})

describe('publish-mcp job: pinned publisher binary', () => {
  const install = step('publish-mcp', 'Install MCP Registry publisher')

  // Built once and reused: tar embeds the file mtime (and gzip a timestamp),
  // so two separately built archives differ whenever the builds straddle a
  // second boundary, and "serve the archive whose digest we just took" flaked.
  let servedArchive: Buffer | undefined
  function servedArchiveBytes(): Buffer {
    if (servedArchive) return servedArchive
    const dir = tempDir()
    const staging = join(dir, 'staging')
    mkdirSync(staging)
    writeFileSync(join(staging, 'mcp-publisher'), '#!/bin/sh\n')
    const archive = join(dir, 'served.tar.gz')
    expect(spawnSync('tar', ['--create', '--gzip', '--file', archive, '-C', staging, 'mcp-publisher'], { timeout: 20_000, killSignal: 'SIGKILL' }).status).toBe(0)
    servedArchive = readFileSync(archive)
    return servedArchive
  }

  function installWith(digest: string | undefined) {
    const archiveBytes = servedArchiveBytes()
    const dir = tempDir()
    const archive = join(dir, 'served.tar.gz')
    writeFileSync(archive, archiveBytes)
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

  test.each([undefined, '', '0'.repeat(64), 'not-a-digest'])('refuses to extract a download with a mismatched or malformed pin (%s)', pin => {
    const tampered = installWith(pin)
    expect({ status: tampered.status === 0, extracted: tampered.extracted }).toEqual({ status: false, extracted: false })
  })

  test('extracts the binary when the download matches the pinned digest', () => {
    const served = installWith(undefined).servedDigest
    const matched = installWith(served)
    expect({ status: matched.status, extracted: matched.extracted }).toEqual({ status: 0, extracted: true })
  })
})

describe('canonical CI completion', () => {
  const complete = step('ci-complete', 'Require every selected CI lane to pass', ciWorkflow)
  const runtime = step('test', 'Require every runtime lane to pass', ciWorkflow)
  type Outcome = Record<string, { result: string }>
  function selected(full: boolean): Outcome {
    return { scope: { result: 'success' }, docs: { result: full ? 'skipped' : 'success' },
      test: { result: full ? 'success' : 'skipped' }, 'expire-label-approvals': { result: 'skipped' } }
  }
  function aggregate(full: string, results: Outcome) {
    return execute(complete, tempDir(), { FULL: full, RESULTS: JSON.stringify(results) })
  }

  test.each([true, false])('selected checks pass with full=%s, including additional successful work', full => {
    expect(aggregate(String(full), selected(full)).status).toBe(0)
    const extra = selected(full)
    extra[full ? 'docs' : 'test'] = { result: 'success' }
    expect(aggregate(String(full), extra).status).toBe(0)
  })

  test.each(['failure', 'cancelled', 'skipped', 'missing'])('required work that is %s cannot pass', result => {
    for (const full of [true, false]) {
      const outcomes = selected(full)
      const key = full ? 'test' : 'docs'
      if (result === 'missing') delete outcomes[key]
      else outcomes[key] = { result }
      expect(aggregate(String(full), outcomes).status).not.toBe(0)
    }
  })

  test.each(['failure', 'cancelled'])('additional work that ends in %s still fails completion', result => {
    for (const full of [true, false]) {
      const outcomes = selected(full)
      outcomes[full ? 'docs' : 'test'] = { result }
      expect(aggregate(String(full), outcomes).status).not.toBe(0)
    }
  })

  test('a missing scope or unknown mode cannot pass', () => {
    const outcomes = selected(true)
    delete outcomes.scope
    expect(aggregate('true', outcomes).status).not.toBe(0)
    for (const mode of ['', 'unknown']) expect(aggregate(mode, selected(false)).status).not.toBe(0)
  })

  test('full runtime proof requires every declared dependency to succeed', () => {
    const results: Outcome = Object.fromEntries(ciWorkflow.jobs.test.needs.map((name: string) => [name, { result: 'success' }]))
    const run = () => execute(runtime, tempDir(), { RESULTS: JSON.stringify(results) })
    expect(run().status).toBe(0)
    for (const name of Object.keys(results)) {
      results[name] = { result: 'skipped' }
      expect(run().status).not.toBe(0)
      results[name] = { result: 'success' }
    }
  })
})
