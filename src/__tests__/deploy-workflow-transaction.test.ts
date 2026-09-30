/**
 * Production deploy transaction (.github/workflows/deploy-cloudflare.yml).
 *
 * The workflow is parsed, not string-matched: step order and `if:` guards are
 * read from the YAML and the guards are evaluated for concrete scenarios. The
 * shell that decides whether production changes is executed with stubbed
 * wrangler/gh/npm/curl, in the style of mcp-publish-recovery.test.ts, so these
 * tests observe what each gate does rather than how it is spelled.
 */
import { describe, expect, test } from 'bun:test'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from 'yaml'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs()

const REPO = join(import.meta.dir, '..', '..')
const WORKFLOW = parseYaml(readFileSync(join(REPO, '.github', 'workflows', 'deploy-cloudflare.yml'), 'utf8')) as {
  concurrency: Record<string, unknown>
  jobs: { deploy: { permissions: Record<string, string>; env: Record<string, string>; steps: Step[] } }
}
const JOB = WORKFLOW.jobs.deploy
const STEPS = JOB.steps
const PINNED_WRANGLER = (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> }).devDependencies.wrangler!
const SHA = '0123456789abcdef0123456789abcdef01234567'

interface Step {
  name?: string
  id?: string
  if?: string
  uses?: string
  run?: string
  with?: Record<string, unknown>
  env?: Record<string, string>
  'working-directory'?: string
}

function step(name: string): Step {
  const found = STEPS.find(candidate => candidate.name === name)
  if (!found) throw new Error(`deploy workflow has no step named ${JSON.stringify(name)}`)
  return found
}

function stepIndex(name: string): number {
  return STEPS.indexOf(step(name))
}

type Outputs = Record<string, Record<string, string>>

/**
 * Evaluate the small GitHub-expression subset the deploy guards use, including
 * job-status semantics: a guard without a status function is implicitly
 * `success() && (…)`, so it is skipped once any earlier step has failed.
 */
function guardAllows(condition: string | undefined, context: { event: string; outputs: Outputs; jobStatus?: 'success' | 'failure' }): boolean {
  const status = context.jobStatus ?? 'success'
  const expression = (condition ?? 'success()').trim().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1')
  if (!/\b(?:always|success|failure|cancelled)\(\)/.test(expression) && status !== 'success') return false
  const js = expression
    .replace(/steps\.([\w-]+)\.outputs\.([\w-]+)/g, (_, id: string, key: string) => `(outputs[${JSON.stringify(id)}]?.[${JSON.stringify(key)}] ?? '')`)
    .replace(/github\.event_name/g, 'event')
    .replace(/\balways\(\)/g, 'true')
    .replace(/\bsuccess\(\)/g, String(status === 'success'))
    .replace(/\bfailure\(\)/g, String(status === 'failure'))
    .replace(/\bcancelled\(\)/g, 'false')
    .replace(/==/g, '===')
    .replace(/!===/g, '!==')
  if (/[^\w\s'"().&|!=?[\]:-]/.test(js.replace(/"[^"]*"|'[^']*'/g, ''))) throw new Error(`unsupported guard expression: ${condition}`)
  return Boolean(new Function('outputs', 'event', `return (${js});`)(context.outputs, context.event))
}

/** Root of the most recent runStep fixture, for tests that read its files. */
let lastStepRoot = ''

interface StepRun {
  status: number | null
  stdout: string
  stderr: string
  outputs: Record<string, string>
  summary: string
  calls: string[]
}

/**
 * Execute one step's `run` exactly as Actions does (bash -e -o pipefail), with
 * every external command the gate depends on replaced by a recording stub.
 */
function runStep(name: string, options: {
  env?: Record<string, string>
  stubs?: Record<string, string>
  wrangler?: string
  files?: Record<string, string>
  setup?: (root: string) => void
} = {}): StepRun {
  const target = step(name)
  if (!target.run) throw new Error(`${name} has no run script`)
  const root = temp.dir('am-deploy-step-')
  lastStepRoot = root
  const bin = join(root, '.stub-bin')
  mkdirSync(bin, { recursive: true })
  mkdirSync(join(root, 'website'), { recursive: true })
  mkdirSync(join(root, 'runner-temp'), { recursive: true })
  const writeStub = (path: string, label: string, body: string) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' "${label} $*" >> "$MOCK_ROOT/calls"\n${body}\n`)
    chmodSync(path, 0o755)
  }
  for (const [command, body] of Object.entries({ sleep: 'exit 0', ...options.stubs })) writeStub(join(bin, command), command, body)
  if (options.wrangler !== undefined) writeStub(join(root, 'node_modules', '.bin', 'wrangler'), 'wrangler', options.wrangler)
  for (const [rel, text] of Object.entries(options.files ?? {})) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  options.setup?.(root)
  const outputFile = join(root, 'github-output')
  const summaryFile = join(root, 'github-summary')
  writeFileSync(outputFile, '')
  writeFileSync(summaryFile, '')
  const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', target.run], {
    cwd: target['working-directory'] ? join(root, target['working-directory']) : root,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: root,
      MOCK_ROOT: root,
      EXPECTED_SHA: SHA,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      GITHUB_REPOSITORY: 'adewale/agentic-mermaid',
      GITHUB_RUN_ID: '4242',
      RUNNER_TEMP: join(root, 'runner-temp'),
      ...options.env,
    },
  })
  const outputs = Object.fromEntries(readFileSync(outputFile, 'utf8').split('\n').filter(Boolean).map(line => {
    const at = line.indexOf('=')
    return [line.slice(0, at), line.slice(at + 1)]
  }))
  const callsFile = join(root, 'calls')
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    outputs,
    summary: readFileSync(summaryFile, 'utf8'),
    calls: existsSync(callsFile) ? readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean) : [],
  }
}

/** Wrangler double: `deployments list` serves deployments.json; a `versions
 * deploy` or `rollback` swaps in after-deploy.json when the test provides it. */
const WRANGLER_DOUBLE = `
case "$1 \${2:-}" in
  "deployments list") cat "$MOCK_ROOT/deployments.json" ;;
  "versions deploy"|"rollback "*) if [ -f "$MOCK_ROOT/after-deploy.json" ]; then cp "$MOCK_ROOT/after-deploy.json" "$MOCK_ROOT/deployments.json"; fi ;;
  *) echo "unexpected wrangler call: $*" >&2; exit 64 ;;
esac`

const deployments = (...versions: Array<[string, number]>) => JSON.stringify([
  { created_on: '2026-01-01T00:00:00Z', versions: [{ version_id: 'ancient', percentage: 100 }] },
  { created_on: '2026-09-01T00:00:00Z', versions: versions.map(([version_id, percentage]) => ({ version_id, percentage })) },
])

describe('deploy workflow shape', () => {
  test('a started transaction is never cancelled, and it runs with read-only token scopes', () => {
    expect(WORKFLOW.concurrency['cancel-in-progress']).toBe(false)
    expect(WORKFLOW.concurrency).not.toHaveProperty('queue')
    expect(JOB.permissions).toEqual({ actions: 'read', contents: 'read' })
  })

  test('builds the exact CI-validated commit with pinned third-party actions and the locked wrangler', () => {
    // workflow_run's GITHUB_SHA is the default branch tip, not the validated commit.
    expect(JOB.env.EXPECTED_SHA).toBe("${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || github.sha }}")
    const checkout = STEPS.find(candidate => candidate.uses?.startsWith('actions/checkout@'))
    expect(checkout?.with).toMatchObject({ ref: '${{ env.EXPECTED_SHA }}', 'fetch-depth': 0 })
    for (const { uses } of STEPS.filter(candidate => candidate.uses)) {
      expect({ uses, pinned: /@[0-9a-f]{40}$/.test(uses!) }).toEqual({ uses, pinned: true })
    }
    // Every wrangler invocation goes through the lockfile-installed binary;
    // a bare, npx/bunx, or @version wrangler would bypass the pin.
    for (const { name, run } of STEPS.filter(candidate => candidate.run)) {
      const bare = run!.split('\n').filter(line => !line.trim().startsWith('#') && /(?<![\w./-])wrangler(?:@\S*)?(?=\s|$)/.test(line))
      expect({ name, bare }).toEqual({ name, bare: [] })
    }
  })
})

describe('deploy workflow ordering and guards', () => {
  test('production state changes only after identity gates, and rollback is armed before the first change', () => {
    const order = [
      'Check Cloudflare deployment secrets',
      'Require the exact current main commit',
      'Require successful canonical CI for a manual deployment',
      'Require the site\'s exact package version on npm',
      'Install dependencies',
      'Verify every published browser artifact is byte-identical',
      'Build the site bundle',
      'Recheck current main before touching production state',
      'Resolve the immutable production version',
      'Upload the candidate without serving it',
      'Arm rollback before changing production state',
      'Attach the candidate at zero traffic',
      'Smoke-test the zero-traffic candidate through production',
      'Smoke-test the zero-traffic website candidate',
      'Probe the full zero-traffic /mcp candidate',
      'Require target still current before promotion',
      'Promote the verified candidate to all traffic',
      'Verify the promoted production version',
      'Smoke-test the promoted production website',
      'Roll back any unverified deployment',
    ]
    const indexes = order.map(stepIndex)
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
    expect(stepIndex('Roll back any unverified deployment')).toBe(STEPS.length - 1)
    expect(STEPS[stepIndex('Arm rollback before changing production state')]!.id).toBe('rollback-guard')
  })

  test('missing secrets or an unpublished package version stop every later step', () => {
    const afterSecrets = STEPS.slice(stepIndex('Check Cloudflare deployment secrets') + 1)
    for (const event of ['workflow_dispatch', 'workflow_run']) {
      const runs = afterSecrets.filter(candidate => guardAllows(candidate.if, { event, outputs: { 'cloudflare-secrets': {} } }))
      expect({ event, runs: runs.map(candidate => candidate.name ?? candidate.uses) }).toEqual({ event, runs: [] })
    }
    const afterNpm = STEPS.slice(stepIndex('Require the site\'s exact package version on npm') + 1)
    const unpublished = { 'cloudflare-secrets': { available: 'true' }, 'npm-version': { available: 'false' } }
    expect(afterNpm.filter(candidate => guardAllows(candidate.if, { event: 'workflow_run', outputs: unpublished })).map(candidate => candidate.name)).toEqual([])
  })

  test('manual dispatch, and only manual dispatch, must prove canonical CI', () => {
    const proof = step('Require successful canonical CI for a manual deployment')
    const ready = { 'cloudflare-secrets': { available: 'true' } }
    expect(guardAllows(proof.if, { event: 'workflow_dispatch', outputs: ready })).toBe(true)
    expect(guardAllows(proof.if, { event: 'workflow_run', outputs: ready })).toBe(false)
  })

  test('a failed gate stops every later production change', () => {
    const ready: Outputs = { 'cloudflare-secrets': { available: 'true' }, 'npm-version': { available: 'true' }, 'rollback-guard': { armed: 'true' } }
    for (const name of ['Attach the candidate at zero traffic', 'Promote the verified candidate to all traffic', 'Verify the promoted production version']) {
      expect({ name, runs: guardAllows(step(name).if, { event: 'workflow_run', outputs: ready, jobStatus: 'failure' }) }).toEqual({ name, runs: false })
      expect({ name, runs: guardAllows(step(name).if, { event: 'workflow_run', outputs: ready }) }).toEqual({ name, runs: true })
    }
  })

  test('rollback runs exactly when an armed deploy is not fully verified, even after a failed step', () => {
    const rollback = step('Roll back any unverified deployment')
    const outputs = (armed: boolean, mcp: boolean, site: boolean): Outputs => ({
      'rollback-guard': armed ? { armed: 'true' } : {},
      'production-verify': mcp ? { verified: 'true' } : {},
      'production-site-verify': site ? { verified: 'true' } : {},
    })
    // An unverified run has a failed verification step, so the job is failing.
    const table = [
      [false, false, false], [true, false, false], [true, true, false], [true, false, true], [true, true, true],
    ].map(([armed, mcp, site]) => ({
      armed,
      mcp,
      site,
      rollsBack: guardAllows(rollback.if, { event: 'workflow_run', outputs: outputs(armed!, mcp!, site!), jobStatus: mcp && site ? 'success' : 'failure' }),
    }))
    expect(table).toEqual([
      { armed: false, mcp: false, site: false, rollsBack: false },
      { armed: true, mcp: false, site: false, rollsBack: true },
      { armed: true, mcp: true, site: false, rollsBack: true },
      { armed: true, mcp: false, site: true, rollsBack: true },
      { armed: true, mcp: true, site: true, rollsBack: false },
    ])
  })
})

describe('deploy workflow gates (executed with stubs)', () => {
  test('missing Cloudflare credentials fail the run loudly instead of skipping', () => {
    const missing = runStep('Check Cloudflare deployment secrets', { env: { CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: 'account' } })
    expect(missing.status).toBe(1)
    expect(missing.stdout).toContain('::error title=Cloudflare credentials missing::')
    expect(missing.summary).toContain('### Cloudflare deploy failed')
    expect(missing.outputs).toEqual({})
    const present = runStep('Check Cloudflare deployment secrets', { env: { CLOUDFLARE_API_TOKEN: 'token', CLOUDFLARE_ACCOUNT_ID: 'account' } })
    expect({ status: present.status, outputs: present.outputs }).toEqual({ status: 0, outputs: { available: 'true' } })
  })

  test('a manual deploy requires a successful push CI run for the exact commit on main', () => {
    const run = (overrides: Record<string, string>) => ({ head_sha: SHA, head_branch: 'main', event: 'push', conclusion: 'success', ...overrides })
    const attempt = (runs: unknown[]) => runStep('Require successful canonical CI for a manual deployment', {
      stubs: { gh: `cat "$MOCK_ROOT/runs.json"` },
      files: { 'runs.json': JSON.stringify({ workflow_runs: runs }) },
    })
    const accepted = attempt([run({ head_sha: 'f'.repeat(40) }), run({})])
    expect(accepted.status).toBe(0)
    const query = accepted.calls.find(call => call.startsWith('gh api'))!
    for (const filter of [`-f head_sha=${SHA}`, '-f branch=main', '-f event=push', '-f status=success']) expect(query).toContain(filter)
    expect(query).toContain('repos/adewale/agentic-mermaid/actions/workflows/ci.yml/runs')

    const mismatches: Array<Record<string, string>> = [{ head_sha: 'f'.repeat(40) }, { head_branch: 'release' }, { event: 'workflow_dispatch' }, { conclusion: 'failure' }]
    for (const mismatch of mismatches) {
      const refused = attempt([run(mismatch)])
      expect({ mismatch, status: refused.status }).toEqual({ mismatch, status: 1 })
      expect(refused.stdout).toContain('::error title=Canonical CI proof missing::')
    }
  })

  test('the installed wrangler must be the version package.json locks', () => {
    const install = (version: string) => runStep('Install dependencies', { stubs: { bun: 'exit 0' }, wrangler: `echo ${version}` })
    const locked = install(PINNED_WRANGLER)
    expect(locked.status).toBe(0)
    expect(locked.calls).toContain('bun install --frozen-lockfile')
    expect(install('0.0.0-drifted').status).not.toBe(0)
  })

  test('the site deploys only when every browser artifact matches the published npm package', () => {
    const verify = (published: { global: string; lazy: string }) => runStep('Verify every published browser artifact is byte-identical', {
      files: {
        'package.json': JSON.stringify({ version: '9.9.9' }),
        'dist/browser.global.js': 'global-bundle',
        'dist/browser-lazy/index.js': 'lazy-entry',
        'published/package/dist/browser.global.js': published.global,
        'published/package/dist/browser-lazy/index.js': published.lazy,
      },
      stubs: {
        npm: `dest="\${@: -1}"; tar -czf "$dest/agentic-mermaid-9.9.9.tgz" -C "$MOCK_ROOT/published" package; echo '[{"filename":"agentic-mermaid-9.9.9.tgz"}]'`,
      },
    })
    const identical = verify({ global: 'global-bundle', lazy: 'lazy-entry' })
    expect(identical.status).toBe(0)
    expect(identical.stdout).toContain('byte-identical to agentic-mermaid@9.9.9')
    expect(identical.calls.some(call => call.startsWith('npm pack agentic-mermaid@9.9.9 --ignore-scripts'))).toBe(true)

    const globalDrift = verify({ global: 'other-bundle', lazy: 'lazy-entry' })
    expect(globalDrift.status).toBe(1)
    expect(globalDrift.stdout).toContain('::error title=Published browser artifact mismatch::')
    const lazyDrift = verify({ global: 'global-bundle', lazy: 'other-entry' })
    expect(lazyDrift.status).toBe(1)
    expect(lazyDrift.stdout).toContain('::error title=Published lazy browser graph mismatch::')
  })

  test('the site build is stamped with the validated commit and a UTC build time', () => {
    const built = runStep('Build the site bundle', { stubs: { bun: 'printf "%s|%s|%s\\n" "$*" "$SITE_GIT_SHA" "$SITE_BUILD_TIME" > "$MOCK_ROOT/build"' } })
    expect(built.status).toBe(0)
    const [args, gitSha, buildTime] = readFileSync(join(lastStepRoot, 'build'), 'utf8').trim().split('|')
    expect({ args, gitSha }).toEqual({ args: 'run website', gitSha: SHA })
    expect(buildTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })

  test('the rollback target is the single version serving all production traffic', () => {
    const resolve = (state: string) => runStep('Resolve the immutable production version', { wrangler: WRANGLER_DOUBLE, files: { 'deployments.json': state } })
    const single = resolve(deployments(['prod-v1', 100]))
    expect({ status: single.status, outputs: single.outputs }).toEqual({ status: 0, outputs: { previous_id: 'prod-v1' } })
    // A split or partial deployment has no single safe rollback target.
    for (const state of [deployments(['prod-v1', 60], ['prod-v2', 40]), deployments(['prod-v1', 90])]) {
      const refused = resolve(state)
      expect(refused.status).not.toBe(0)
      expect(refused.outputs).toEqual({})
    }
  })

  test('the candidate is attached at zero traffic and the split is verified', () => {
    const attach = (after: string) => runStep('Attach the candidate at zero traffic', {
      env: { PREVIOUS_ID: 'prod-v1', CANDIDATE_ID: 'cand-v2' },
      wrangler: WRANGLER_DOUBLE,
      files: { 'deployments.json': deployments(['prod-v1', 100]), 'after-deploy.json': after },
    })
    const staged = attach(deployments(['prod-v1', 100], ['cand-v2', 0]))
    expect(staged.status).toBe(0)
    expect(staged.calls.find(call => call.startsWith('wrangler versions deploy'))).toStartWith('wrangler versions deploy prod-v1@100% cand-v2@0% -y')
    expect(attach(deployments(['cand-v2', 100])).status).not.toBe(0)
  })

  test('candidate probes wait for the expected build SHA before touching /mcp', () => {
    const smoke = (servedSha: string) => runStep('Smoke-test the zero-traffic candidate through production', {
      env: { CANDIDATE_ID: 'cand-v2', SERVED_SHA: servedSha },
      setup(root) {
        mkdirSync(join(root, 'scripts', 'ci'), { recursive: true })
        copyFileSync(join(REPO, 'scripts', 'ci', 'mcp-probe.sh'), join(root, 'scripts', 'ci', 'mcp-probe.sh'))
      },
      stubs: {
        curl: `
body=''
case " $* " in
  *" -X POST "*) body="\${@: -1}" ;;
esac
case "$body" in
  '') printf '{"generatedFrom":{"gitSha":"%s"}}' "$SERVED_SHA" ;;
  *'"verify"'*) printf '%s' '{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\\"ok\\":true,\\"family\\":\\"flowchart\\"}"}]}}' ;;
  *'"execute"'*) printf '%s' '{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\\"ok\\":true,\\"value\\":42}"}]}}' ;;
esac`,
      },
    })
    const ready = smoke(SHA)
    expect({ status: ready.status, stdout: ready.stdout }).toMatchObject({ status: 0 })
    const requests = ready.calls.filter(call => call.startsWith('curl ')).map(call => (call.includes(' -X POST ') ? `POST ${call.includes('"execute"') ? 'execute' : 'verify'}` : 'GET card'))
    expect(requests).toEqual(['GET card', 'POST verify', 'POST execute'])
    expect(ready.calls.filter(call => call.startsWith('curl ')).every(call => call.includes('Cloudflare-Workers-Version-Overrides: agentic-mermaid-website="cand-v2"'))).toBe(true)

    const stale = smoke('ffffffffffffffffffffffffffffffffffffffff')
    expect(stale.status).toBe(1)
    expect(stale.stdout).toContain('::error title=Deployment propagation failed::')
    expect(stale.calls.filter(call => call.includes(' -X POST '))).toEqual([])
  })

  test('promotion moves all traffic to the verified candidate and records it', () => {
    const promoted = runStep('Promote the verified candidate to all traffic', {
      env: { CANDIDATE_ID: 'cand-v2' },
      wrangler: WRANGLER_DOUBLE,
      files: { 'deployments.json': deployments(['prod-v1', 100], ['cand-v2', 0]) },
    })
    expect(promoted.status).toBe(0)
    expect(promoted.calls.find(call => call.startsWith('wrangler versions deploy'))).toStartWith('wrangler versions deploy cand-v2@100% -y')
    expect(promoted.outputs).toEqual({ promoted: 'true' })
  })

  test('rollback restores the recorded production version and verifies it serves all traffic', () => {
    const rollBack = (after: string) => runStep('Roll back any unverified deployment', {
      env: { PREVIOUS_ID: 'prod-v1' },
      wrangler: WRANGLER_DOUBLE,
      files: { 'deployments.json': deployments(['cand-v2', 100]), 'after-deploy.json': after },
    })
    const restored = rollBack(deployments(['prod-v1', 100]))
    expect(restored.status).toBe(0)
    expect(restored.calls.find(call => call.startsWith('wrangler rollback'))).toStartWith('wrangler rollback prod-v1 -y')
    expect(rollBack(deployments(['cand-v2', 100])).status).not.toBe(0)
  })
})
