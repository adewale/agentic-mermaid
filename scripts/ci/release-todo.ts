#!/usr/bin/env bun
// Release to-do helper: manual creation and cleanup of existing issues.
//
// deploy-cloudflare.yml skips unpublished versions without opening issues.
// Its only automatic call here is `close` after production is verified.
//
//   open   Explicit manual use only. Opens one issue for the version, labelled
//          `release-todo`, that @mentions the owner and links a prefilled
//          new-release form. An existing issue, open or closed, means no write.
//   close  After promoted production is verified, closes every open release
//          to-do for the live version or an older one with a one-line comment.
//
// The to-do never changes the deploy's outcome: any GitHub or npm error becomes
// a `::warning::` and the script exits 0. It reads only GitHub and npm, never
// production. Run by hand, scripts/ci/production-freshness.ts remains the
// check of what production actually serves.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const RELEASE_TODO_LABEL = 'release-todo'
export const RELEASE_OWNER = 'adewale'
/** Longest prefilled release URL we hand out; longer release notes are left out. */
export const MAX_RELEASE_URL_LENGTH = 4000
const LABEL_COLOR = 'fbca04'
const LABEL_DESCRIPTION = 'A version on main is waiting for its GitHub Release (opened by the deploy)'
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const FULL_SHA_RE = /^[0-9a-f]{40}$/
const COMMAND_TIMEOUT_MS = 30_000

export interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
}

/** Runs an external command (`gh` or `npm`); tests substitute fakes on PATH. */
export type Exec = (command: string, args: string[], input?: string) => CommandResult

export interface Issue {
  number: number
  title: string
  body?: string | null
  state?: string
  html_url?: string
  pull_request?: unknown
}

export interface ReleaseTodoContext {
  repo: string
  serverUrl: string
  packageName: string
  version: string
  runUrl: string
  exec: Exec
  log: (line: string) => void
}

export class GitHubApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly result: CommandResult,
  ) {
    const detail = `${result.stderr} ${result.stdout}`.replace(/\s+/g, ' ').trim().slice(0, 300)
    super(`gh api ${method} ${path} failed (exit ${result.status}): ${detail || 'no output'}`)
  }

  get notFound(): boolean {
    return /\(HTTP 404\)|"status":\s*"?404/.test(`${this.result.stderr}\n${this.result.stdout}`)
  }
}

function api(ctx: ReleaseTodoContext, method: string, path: string, body?: unknown): unknown {
  const args = ['api', '--method', method, '-H', 'Accept: application/vnd.github+json', path]
  if (body !== undefined) args.push('--input', '-')
  const result = ctx.exec('gh', args, body === undefined ? undefined : JSON.stringify(body))
  if (result.status !== 0) throw new GitHubApiError(method, path, result)
  return result.stdout.trim() ? JSON.parse(result.stdout) : null
}

// ---- Pure pieces --------------------------------------------------------------

const marker = (version: string) => `<!-- release-todo version="${version}" -->`

/** The version an issue tracks: the body marker this script writes, else its title. */
export function trackedVersion(issue: Pick<Issue, 'title' | 'body'>): string | null {
  const fromBody = /<!-- release-todo version="([^"]+)" -->/.exec(issue.body ?? '')?.[1]
  const fromTitle = /^Publish v(\S+?):/.exec(issue.title)?.[1]
  const version = fromBody ?? fromTitle ?? null
  return version !== null && VERSION_RE.test(version) ? version : null
}

/** Semver precedence: negative when a < b. Prerelease identifiers sort before the release. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre] = v.split(/-(.*)/s, 2) as [string, string | undefined]
    return { core: core.split('.').map(Number), pre: pre === undefined ? [] : pre.split('.') }
  }
  const x = split(a)
  const y = split(b)
  for (let i = 0; i < 3; i++) {
    const diff = (x.core[i] ?? 0) - (y.core[i] ?? 0)
    if (diff !== 0) return diff
  }
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn && Number(p) !== Number(q)) return Number(p) - Number(q)
    if (pn !== qn) return pn ? -1 : 1
    if (p !== q) return p < q ? -1 : 1
  }
  return 0
}

/** The text under `## <version>` in CHANGELOG.md, without its heading; null when absent. */
export function changelogSection(changelog: string, version: string): string | null {
  const lines = changelog.split(/\r?\n/)
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const start = lines.findIndex(line => new RegExp(`^## ${escaped}(?:\\s|$)`).test(line))
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => line.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

export function releaseTitle(version: string): string {
  return `Agentic Mermaid v${version}`
}

/** GitHub's new-release form, prefilled through its query parameters. */
export function newReleaseUrl(options: { serverUrl: string; repo: string; version: string; target: string; notes?: string | null }): string {
  const params = [
    ['tag', `v${options.version}`],
    ['target', options.target],
    ['title', releaseTitle(options.version)],
  ]
  const base = `${options.serverUrl}/${options.repo}/releases/new?`
  const encode = (pairs: string[][]) => pairs.map(([key, value]) => `${key}=${encodeURIComponent(value!)}`).join('&')
  const withoutNotes = base + encode(params)
  if (!options.notes) return withoutNotes
  const withNotes = base + encode([...params, ['body', options.notes]])
  return withNotes.length <= MAX_RELEASE_URL_LENGTH ? withNotes : withoutNotes
}

export function issueTitle(version: string, liveVersion: string | null): string {
  return `Publish v${version}: production still serves ${liveVersion ? `v${liveVersion}` : 'the previous release'}`
}

export function issueBody(options: { serverUrl: string; repo: string; packageName: string; version: string; liveVersion: string | null; target: string; runUrl: string; changelog: string }): string {
  const { serverUrl, repo, packageName, version, liveVersion, target, runUrl } = options
  const notes = changelogSection(options.changelog, version)
  const url = newReleaseUrl({ serverUrl, repo, version, target, notes })
  const prefilledNotes = url.includes('&body=')
  const live = liveVersion ? `v${liveVersion}` : 'the previous release'
  const guide = `${serverUrl}/${repo}/blob/main/docs/contributing/releasing.md#cutting-a-release`
  const notesLine =
    notes === null
      ? `- \`CHANGELOG.md\` has no \`## ${version}\` section yet. Step 3 of [Cutting a release](${guide}) adds it.`
      : prefilledNotes
        ? `- The release notes are prefilled from the \`## ${version}\` section of \`CHANGELOG.md\`.`
        : `- The \`## ${version}\` section of \`CHANGELOG.md\` is too long to prefill, so the notes start empty.`
  return [
    marker(version),
    `@${RELEASE_OWNER} \`${packageName}@${version}\` is on \`main\`, but npm does not have it. The deploy never ships a version that is not on npm, so production keeps serving ${live} until the v${version} GitHub Release is published.`,
    '',
    `**Next step:** [create the v${version} release](${url}). The form is prefilled with tag \`v${version}\`, title \`${releaseTitle(version)}\` and target \`${target.slice(0, 12)}\`, the \`main\` commit that passed CI and that this deploy run checked. Publishing it runs \`publish.yml\`, which publishes to npm and then triggers the deploy. A verified deploy closes this issue.`,
    '',
    `- If \`main\` has moved on before you publish, set the target to the current \`main\` commit once its CI is green. The deploy only ships the current \`main\` commit.`,
    notesLine,
    '',
    `Opened once, by [this deploy run](${runUrl}). Later deploy runs that find v${version} unpublished leave this issue alone, and none opens another for v${version}, even if you close this one by hand.`,
  ].join('\n')
}

// ---- GitHub operations ------------------------------------------------------

function listTodos(ctx: ReleaseTodoContext, state: 'open' | 'all'): Issue[] {
  const path = `repos/${ctx.repo}/issues?labels=${RELEASE_TODO_LABEL}&state=${state}&sort=created&direction=desc&per_page=100`
  const issues = api(ctx, 'GET', path)
  if (!Array.isArray(issues)) throw new Error(`gh api GET ${path} did not return a list`)
  return (issues as Issue[]).filter(issue => issue.pull_request === undefined)
}

function ensureLabel(ctx: ReleaseTodoContext): void {
  try {
    api(ctx, 'GET', `repos/${ctx.repo}/labels/${RELEASE_TODO_LABEL}`)
  } catch (error) {
    if (!(error instanceof GitHubApiError) || !error.notFound) throw error
    api(ctx, 'POST', `repos/${ctx.repo}/labels`, { name: RELEASE_TODO_LABEL, color: LABEL_COLOR, description: LABEL_DESCRIPTION })
    ctx.log(`ok   created the ${RELEASE_TODO_LABEL} label`)
  }
}

/** The newest version on npm: what the last successful deploy shipped. Null when npm cannot say. */
function npmLatest(ctx: ReleaseTodoContext): string | null {
  const viewed = ctx.exec('npm', ['view', ctx.packageName, 'version'])
  const version = viewed.stdout.trim()
  return viewed.status === 0 && VERSION_RE.test(version) ? version : null
}

export type OpenOutcome = { action: 'exists'; issue: Issue } | { action: 'created'; issue: Issue }

export function openReleaseTodo(ctx: ReleaseTodoContext & { target: string; changelog: string }): OpenOutcome {
  const existing = listTodos(ctx, 'all').find(issue => trackedVersion(issue) === ctx.version)
  if (existing) {
    ctx.log(`ok   release to-do #${existing.number} (${existing.state ?? 'open'}) already covers v${ctx.version}; nothing to do`)
    return { action: 'exists', issue: existing }
  }
  ensureLabel(ctx)
  const liveVersion = npmLatest(ctx)
  const created = api(ctx, 'POST', `repos/${ctx.repo}/issues`, {
    title: issueTitle(ctx.version, liveVersion),
    body: issueBody({ ...ctx, liveVersion }),
    labels: [RELEASE_TODO_LABEL],
  }) as Issue
  ctx.log(`::notice title=Release to-do opened::#${created.number} asks for the v${ctx.version} release: ${created.html_url ?? ''}`)
  return { action: 'created', issue: created }
}

export interface CloseOutcome {
  closed: number[]
  failed: number[]
}

export function closeReleaseTodos(ctx: ReleaseTodoContext): CloseOutcome {
  const outcome: CloseOutcome = { closed: [], failed: [] }
  const due = listTodos(ctx, 'open').filter(issue => {
    const tracked = trackedVersion(issue)
    return tracked !== null && compareVersions(tracked, ctx.version) <= 0
  })
  for (const issue of due) {
    const tracked = trackedVersion(issue)!
    const supersedes = tracked === ctx.version ? '' : `, which supersedes v${tracked}`
    try {
      api(ctx, 'POST', `repos/${ctx.repo}/issues/${issue.number}/comments`, {
        body: `Production now serves v${ctx.version}${supersedes}, deployed and verified by [this deploy run](${ctx.runUrl}).`,
      })
      api(ctx, 'PATCH', `repos/${ctx.repo}/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' })
      outcome.closed.push(issue.number)
      ctx.log(`ok   closed release to-do #${issue.number} (v${tracked})`)
    } catch (error) {
      outcome.failed.push(issue.number)
      ctx.log(`::warning title=Release to-do not closed::#${issue.number}: ${(error as Error).message}`)
    }
  }
  if (due.length === 0) ctx.log(`ok   no open release to-do for v${ctx.version} or older`)
  return outcome
}

// ---- CLI ---------------------------------------------------------------------

export const spawnExec: Exec = (command, args, input) => {
  const result = spawnSync(command, args, { encoding: 'utf8', input, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: `${result.stderr ?? ''}${result.error ? ` ${result.error.message}` : ''}`,
  }
}

/** Runs one command and never throws: every failure is a warning, so the deploy's outcome is untouched. */
export function main(argv: string[], env: Record<string, string | undefined>, options: { cwd: string; exec?: Exec; log?: (line: string) => void }): number {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`))
  const [command] = argv
  try {
    if (command !== 'open' && command !== 'close') throw new Error(`usage: release-todo.ts open|close (got ${JSON.stringify(command)})`)
    const repo = env.GITHUB_REPOSITORY ?? ''
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`GITHUB_REPOSITORY is not owner/name: ${JSON.stringify(repo)}`)
    const pkg = JSON.parse(readFileSync(join(options.cwd, 'package.json'), 'utf8')) as { name: string; version: string }
    if (!VERSION_RE.test(pkg.version)) throw new Error(`package.json version is not semver: ${JSON.stringify(pkg.version)}`)
    const serverUrl = env.GITHUB_SERVER_URL || 'https://github.com'
    const ctx: ReleaseTodoContext = {
      repo,
      serverUrl,
      packageName: pkg.name,
      version: pkg.version,
      runUrl: `${serverUrl}/${repo}/actions/runs/${env.GITHUB_RUN_ID ?? ''}`,
      exec: options.exec ?? spawnExec,
      log,
    }
    if (command === 'close') {
      closeReleaseTodos(ctx)
      return 0
    }
    const target = env.EXPECTED_SHA ?? ''
    if (!FULL_SHA_RE.test(target)) throw new Error(`EXPECTED_SHA is not a full commit SHA: ${JSON.stringify(target)}`)
    const changelogPath = join(options.cwd, 'CHANGELOG.md')
    openReleaseTodo({ ...ctx, target, changelog: existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '' })
    return 0
  } catch (error) {
    log(`::warning title=Release to-do skipped::${(error as Error).message}`)
    return 0
  }
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2), process.env, { cwd: process.cwd() }))
}
