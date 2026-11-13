/**
 * Release to-do helper (scripts/ci/release-todo.ts): explicit manual creation
 * and cleanup of existing issues after verified deployment.
 *
 * The CLI runs as a subprocess against a stateful fake `gh` (and `npm`) on
 * PATH, so these tests see every REST call it makes and its exit status, the
 * same boundary used by deployment cleanup. The workflow wiring is covered in
 * deploy-workflow-transaction.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { changelogSection, compareVersions, MAX_RELEASE_URL_LENGTH, trackedVersion } from '../../scripts/ci/release-todo.ts'
import { useTempDirs } from './helpers/temp-dir.ts'
import { useTestChildren } from './helpers/test-child.ts'

const temp = useTempDirs()
const runChild = useTestChildren(30_000)

const REPO_ROOT = join(import.meta.dir, '..', '..')
const SCRIPT = join(REPO_ROOT, 'scripts', 'ci', 'release-todo.ts')
const REPO = 'adewale/agentic-mermaid'
const SHA = '0123456789abcdef0123456789abcdef01234567'
const RUN_ID = '4242'

interface FakeIssue {
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  state_reason?: string
  labels: Array<{ name: string }>
  html_url: string
  comments: string[]
  pull_request?: unknown
}

interface FakeState {
  labels: string[]
  issues: FakeIssue[]
  /** `npm view <pkg> version`; null makes npm fail. */
  npmLatest: string | null
  /** Regex over "METHOD path"; matching gh calls fail with HTTP 502. */
  fail?: string
}

interface Call {
  method: string
  path: string
  body: Record<string, unknown> | null
}

// The fake GitHub REST API behind `gh api`. It keeps issues and labels in a
// JSON file so consecutive runs see each other's writes.
const FAKE_GH = String.raw`
const fs = require('node:fs')
const statePath = process.env.FAKE_STATE
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const args = process.argv.slice(2)
if (args[0] !== 'api') { process.stderr.write('fake gh only serves gh api\n'); process.exit(64) }
let method = 'GET', path = null, input = false
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--method') method = args[++i]
  else if (args[i] === '-H') i++
  else if (args[i] === '--input') { input = args[++i] === '-' }
  else if (path === null) path = args[i]
  else { process.stderr.write('unexpected argument ' + args[i] + '\n'); process.exit(64) }
}
const body = input ? JSON.parse(fs.readFileSync(0, 'utf8')) : null
fs.appendFileSync(process.env.FAKE_CALLS, JSON.stringify({ method, path, body }) + '\n')
const save = () => fs.writeFileSync(statePath, JSON.stringify(state))
const reply = value => { save(); process.stdout.write(JSON.stringify(value)); process.exit(0) }
const fail = (status, message) => {
  process.stdout.write(JSON.stringify({ message, status: String(status) }))
  process.stderr.write('gh: ' + message + ' (HTTP ' + status + ')\n')
  process.exit(1)
}
if (state.fail && new RegExp(state.fail).test(method + ' ' + path)) fail(502, 'Server Error')
const prefix = 'repos/' + process.env.GITHUB_REPOSITORY + '/'
if (!path.startsWith(prefix)) fail(404, 'Not Found')
const url = new URL(path.slice(prefix.length), 'https://api.invalid/')
const route = method + ' ' + url.pathname
let match
if (route === 'GET /issues') {
  const want = url.searchParams.get('state') ?? 'open'
  const label = url.searchParams.get('labels')
  reply(state.issues
    .filter(issue => want === 'all' || issue.state === want)
    .filter(issue => !label || issue.labels.some(l => l.name === label))
    .sort((a, b) => b.number - a.number))
} else if ((match = /^GET \/labels\/(.+)$/.exec(route))) {
  if (state.labels.includes(decodeURIComponent(match[1]))) reply({ name: decodeURIComponent(match[1]) })
  fail(404, 'Not Found')
} else if (route === 'POST /labels') {
  if (state.labels.includes(body.name)) fail(422, 'Validation Failed')
  state.labels.push(body.name)
  reply({ name: body.name })
} else if (route === 'POST /issues') {
  const number = state.issues.reduce((max, issue) => Math.max(max, issue.number), 0) + 1
  const issue = { number, title: body.title, body: body.body, state: 'open', labels: (body.labels ?? []).map(name => ({ name })), html_url: 'https://github.com/' + process.env.GITHUB_REPOSITORY + '/issues/' + number, comments: [] }
  state.issues.push(issue)
  reply(issue)
} else if ((match = /^POST \/issues\/(\d+)\/comments$/.exec(route))) {
  const issue = state.issues.find(candidate => candidate.number === Number(match[1]))
  if (!issue) fail(404, 'Not Found')
  issue.comments.push(body.body)
  reply({ id: issue.comments.length })
} else if ((match = /^PATCH \/issues\/(\d+)$/.exec(route))) {
  const issue = state.issues.find(candidate => candidate.number === Number(match[1]))
  if (!issue) fail(404, 'Not Found')
  Object.assign(issue, body)
  reply(issue)
} else {
  fail(404, 'Not Found')
}
`

const FAKE_NPM = String.raw`
const fs = require('node:fs')
const state = JSON.parse(fs.readFileSync(process.env.FAKE_STATE, 'utf8'))
const args = process.argv.slice(2)
if (args[0] === 'view' && args[1] === 'agentic-mermaid' && args[2] === 'version' && state.npmLatest) {
  process.stdout.write(state.npmLatest + '\n')
  process.exit(0)
}
process.stderr.write('npm error code E404\n')
process.exit(1)
`

function fakeApi(initial: Partial<FakeState> = {}) {
  const dir = temp.dir('am-release-todo-')
  const bin = join(dir, 'bin')
  const statePath = join(dir, 'state.json')
  const callsPath = join(dir, 'calls.jsonl')
  mkdirSync(bin)
  for (const [name, source] of [
    ['gh', FAKE_GH],
    ['npm', FAKE_NPM],
  ] as const) {
    writeFileSync(join(dir, `fake-${name}.cjs`), source)
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\nexec "${process.execPath}" "${join(dir, `fake-${name}.cjs`)}" "$@"\n`)
    chmodSync(join(bin, name), 0o755)
  }
  writeFileSync(statePath, JSON.stringify({ labels: [], issues: [], npmLatest: '0.4.1', ...initial }))
  let seen = 0
  const state = (): FakeState => JSON.parse(readFileSync(statePath, 'utf8')) as FakeState
  return {
    state,
    update(patch: Partial<FakeState>) {
      writeFileSync(statePath, JSON.stringify({ ...state(), ...patch }))
    },
    /** Run the CLI once at `version`; returns its exit status, output and the API calls it made. */
    async run(command: 'open' | 'close', version: string, options: { changelog?: string } = {}) {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'agentic-mermaid', version }))
      writeFileSync(join(dir, 'CHANGELOG.md'), options.changelog ?? '# Changelog\n\n## Unreleased\n\n## 0.4.1 — 2026-07-30\n\nOlder notes.\n')
      const result = await runChild(process.execPath, [SCRIPT, command], {
        cwd: dir,
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          HOME: dir,
          FAKE_STATE: statePath,
          FAKE_CALLS: callsPath,
          GITHUB_REPOSITORY: REPO,
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_RUN_ID: RUN_ID,
          EXPECTED_SHA: SHA,
        },
      })
      const all = existsSync(callsPath)
        ? readFileSync(callsPath, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line) as Call)
        : []
      const calls = all.slice(seen)
      seen = all.length
      return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls, writes: calls.filter(call => call.method !== 'GET') }
    },
  }
}

const route = (call: Call) => `${call.method} ${call.path.replace(`repos/${REPO}/`, '').replace(/\?.*$/, '')}`

function releaseLink(body: string): URL {
  const match = /\[create the v[^\]]+ release\]\((https:\/\/github\.com\/[^)\s]+)\)/.exec(body)
  if (!match) throw new Error(`issue body has no release link:\n${body}`)
  return new URL(match[1]!)
}

describe('release to-do: first unpublished run', () => {
  test('(a) opens one issue that mentions the owner and links the prefilled release form', async () => {
    const api = fakeApi()
    const run = await api.run('open', '0.4.2')
    expect(run.status).toBe(0)
    expect(run.writes.map(route)).toEqual(['POST labels', 'POST issues'])
    expect(run.stdout).toContain('::notice title=Release to-do opened::#1')

    const [issue, ...others] = api.state().issues
    expect(others).toEqual([])
    expect(issue!.title).toBe('Publish v0.4.2: production still serves v0.4.1')
    expect(issue!.labels).toEqual([{ name: 'release-todo' }])
    expect(api.state().labels).toEqual(['release-todo'])
    expect(issue!.body).toContain('@adewale ')
    expect(issue!.body).toContain('production keeps serving v0.4.1 until the v0.4.2 GitHub Release is published')
    expect(issue!.body).toContain(`https://github.com/${REPO}/actions/runs/${RUN_ID}`)

    const link = releaseLink(issue!.body)
    expect(`${link.origin}${link.pathname}`).toBe(`https://github.com/${REPO}/releases/new`)
    expect(Object.fromEntries(link.searchParams)).toEqual({ tag: 'v0.4.2', target: SHA, title: 'Agentic Mermaid v0.4.2' })
    // Without a `## 0.4.2` CHANGELOG section, the issue says which release step is missing.
    expect(issue!.body).toContain('`CHANGELOG.md` has no `## 0.4.2` section yet')
  })

  test('prefills short release notes from the CHANGELOG section, and leaves out notes too long for a URL', async () => {
    const short = '# Changelog\n\n## Unreleased\n\n## 0.4.2 — 2026-10-11\n\nShort notes & fixes.\n\n## 0.4.1 — 2026-07-30\n\nOlder.\n'
    const api = fakeApi()
    expect((await api.run('open', '0.4.2', { changelog: short })).status).toBe(0)
    const prefilled = releaseLink(api.state().issues[0]!.body)
    expect(prefilled.searchParams.get('body')).toBe('Short notes & fixes.')

    const long = `## 0.5.0 — 2026-10-12\n\n${'- A long changelog line about many changes.\n'.repeat(200)}`
    expect((await api.run('open', '0.5.0', { changelog: long })).status).toBe(0)
    const body = api.state().issues.find(issue => issue.title.startsWith('Publish v0.5.0:'))!.body
    const trimmed = releaseLink(body)
    expect(trimmed.searchParams.has('body')).toBe(false)
    expect(trimmed.href.length).toBeLessThanOrEqual(MAX_RELEASE_URL_LENGTH)
    expect(body).toContain('too long to prefill')
  })

  test('names the previous release generically when npm cannot report its latest version', async () => {
    const api = fakeApi({ npmLatest: null })
    expect((await api.run('open', '0.4.2')).status).toBe(0)
    expect(api.state().issues[0]!.title).toBe('Publish v0.4.2: production still serves the previous release')
  })
})

describe('release to-do: later runs stay silent', () => {
  test('(b) a second run for the same version makes no API write at all', async () => {
    const api = fakeApi()
    expect((await api.run('open', '0.4.2')).writes).toHaveLength(2)
    const before = api.state()
    const again = await api.run('open', '0.4.2')
    expect(again.status).toBe(0)
    expect(again.writes).toEqual([])
    expect(again.calls.map(route)).toEqual(['GET issues'])
    expect(api.state()).toEqual(before)
  })

  test('an issue the owner closed by hand also silences that version', async () => {
    const api = fakeApi()
    await api.run('open', '0.4.2')
    api.update({ issues: api.state().issues.map(issue => ({ ...issue, state: 'closed' as const })) })
    expect((await api.run('open', '0.4.2')).writes).toEqual([])
  })

  test('a newer unpublished version gets its own issue, and the existing label is reused', async () => {
    const api = fakeApi()
    await api.run('open', '0.4.2')
    const next = await api.run('open', '0.4.3')
    expect(next.writes.map(route)).toEqual(['POST issues'])
    expect(api.state().issues.map(issue => [issue.title, issue.state])).toEqual([
      ['Publish v0.4.2: production still serves v0.4.1', 'open'],
      ['Publish v0.4.3: production still serves v0.4.1', 'open'],
    ])
  })
})

describe('release to-do: closing after a verified deploy', () => {
  test('(c) a verified deploy of the version closes its issue with a one-line comment', async () => {
    const api = fakeApi()
    await api.run('open', '0.4.2')
    const close = await api.run('close', '0.4.2')
    expect(close.status).toBe(0)
    expect(close.writes.map(route)).toEqual(['POST issues/1/comments', 'PATCH issues/1'])
    const [issue] = api.state().issues
    expect(issue!.state).toBe('closed')
    expect(issue!.state_reason).toBe('completed')
    expect(issue!.comments).toHaveLength(1)
    expect(issue!.comments[0]).not.toContain('\n')
    expect(issue!.comments[0]).toContain('Production now serves v0.4.2')
    expect(issue!.comments[0]).toContain(`/actions/runs/${RUN_ID}`)
    // Closed means done: the next deploy of the same version writes nothing.
    expect((await api.run('close', '0.4.2')).writes).toEqual([])
  })

  test('closes to-dos the live version supersedes, and leaves newer ones open', async () => {
    const api = fakeApi()
    for (const version of ['0.4.2', '0.4.3', '0.5.0']) await api.run('open', version)
    const close = await api.run('close', '0.4.3')
    expect(close.writes.map(route)).toEqual(['POST issues/2/comments', 'PATCH issues/2', 'POST issues/1/comments', 'PATCH issues/1'])
    expect(api.state().issues.map(issue => issue.state)).toEqual(['closed', 'closed', 'open'])
    expect(api.state().issues[0]!.comments[0]).toContain('Production now serves v0.4.3, which supersedes v0.4.2')
  })

  test('(e) a published version with no open to-do makes no API write', async () => {
    const api = fakeApi()
    const close = await api.run('close', '0.4.2')
    expect(close.status).toBe(0)
    expect(close.calls.map(route)).toEqual(['GET issues'])
    expect(close.writes).toEqual([])
    expect(close.stdout).toContain('no open release to-do')
  })
})

describe('release to-do: never fails the deploy', () => {
  test('(d) a GitHub API error becomes a warning and exit 0', async () => {
    for (const [command, fail] of [
      ['open', '^GET'],
      ['open', '^POST .*/issues$'],
      ['close', '^GET'],
      ['close', '^PATCH'],
    ] as const) {
      const api = fakeApi()
      if (command === 'close') await api.run('open', '0.4.2')
      api.update({ fail })
      const run = await api.run(command, '0.4.2')
      expect({ command, fail, status: run.status }).toEqual({ command, fail, status: 0 })
      expect(run.stdout).toContain('::warning title=Release to-do')
      expect(run.stdout).toContain('HTTP 502')
    }
  })

  test('a failed listing never creates an issue, so an outage cannot duplicate one', async () => {
    const api = fakeApi()
    api.update({ fail: '^GET' })
    expect((await api.run('open', '0.4.2')).writes).toEqual([])
    expect(api.state().issues).toEqual([])
  })

  test('missing run context is a warning, not a failure', async () => {
    const dir = temp.dir('am-release-todo-bare-')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'agentic-mermaid', version: '0.4.2' }))
    const bare = await runChild(process.execPath, [SCRIPT, 'open'], { cwd: dir, env: { PATH: process.env.PATH } })
    expect(bare.status).toBe(0)
    expect(bare.stdout).toContain('::warning title=Release to-do skipped::GITHUB_REPOSITORY')
  })
})

describe('release to-do pure helpers', () => {
  test('reads the tracked version from the body marker, else the title', () => {
    expect(trackedVersion({ title: 'anything', body: '<!-- release-todo version="1.2.3" -->\ntext' })).toBe('1.2.3')
    expect(trackedVersion({ title: 'Publish v0.4.2: production still serves v0.4.1', body: 'edited by hand' })).toBe('0.4.2')
    expect(trackedVersion({ title: 'Unrelated issue', body: null })).toBeNull()
  })

  test('orders versions by semver precedence', () => {
    const sorted = ['1.0.0', '0.4.10', '1.0.0-rc.1', '0.4.2', '1.0.0-beta.2', '1.0.0-beta.11'].sort(compareVersions)
    expect(sorted).toEqual(['0.4.2', '0.4.10', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'])
  })

  test('extracts exactly one CHANGELOG section', () => {
    const changelog = '## Unreleased\n\n## 0.4.2 — 2026-10-11\n\nA.\n\n### Fixed\n- B.\n\n## 0.4.1 — 2026-07-30\n\nC.\n'
    expect(changelogSection(changelog, '0.4.2')).toBe('A.\n\n### Fixed\n- B.')
    expect(changelogSection(changelog, '0.4.1')).toBe('C.')
    expect(changelogSection(changelog, '0.4')).toBeNull()
  })
})
