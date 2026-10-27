#!/usr/bin/env bun
// Label approvals approve one head, not the pull request for good. CI honours
// two PR labels: `no-red-green` (a pure refactor needs no red → green test) and
// `payload-growth-approved` (the payload growth is intended). Read live, a label
// applied to one head kept approving every later push, so new code rode on an
// old approval. A label now counts only when it was applied after the event
// that brought the current head, and on each push the approval labels applied
// before it are removed, as GitHub dismisses stale reviews.

export const APPROVAL_LABELS = ['no-red-green', 'payload-growth-approved'] as const
export type ApprovalLabel = (typeof APPROVAL_LABELS)[number]

export interface LabelEvent {
  event: string
  label: string
  actor: string
  createdAt: string
}

export type LabelApproval =
  | { approved: true; message: string }
  | { approved: false; stale: boolean; message: string }

/**
 * Whether `label` approves the current head. `since` is when the event that
 * brought this head happened; it is undefined when the head is the one the PR
 * was opened with, which every label on the PR was applied to.
 */
export function labelApproval(label: string, attached: readonly string[], events: readonly LabelEvent[], since: string | undefined): LabelApproval {
  if (!attached.includes(label)) return { approved: false, stale: false, message: `The PR does not carry the ${label} label.` }
  if (since === undefined) return { approved: true, message: `${label} approves the head this PR was opened with.` }
  const applied = events
    .filter(event => event.event === 'labeled' && event.label === label)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .at(-1)
  const appliedAt = applied ? Date.parse(applied.createdAt) : Number.NaN
  const sinceAt = Date.parse(since)
  if (!applied || Number.isNaN(appliedAt) || Number.isNaN(sinceAt)) {
    return { approved: false, stale: true, message: `Cannot tell whether ${label} was applied after this head arrived (${since}), so it approves nothing.` }
  }
  if (appliedAt > sinceAt) {
    return { approved: true, message: `${label} was applied by ${applied.actor} at ${applied.createdAt}, after this head arrived (${since}).` }
  }
  return {
    approved: false,
    stale: true,
    message: `${label} was applied by ${applied.actor} at ${applied.createdAt}, before this head arrived (${since}), so it approved an earlier head. Remove and re-add it to approve this one.`,
  }
}

/** The approval labels on the PR that were applied to an earlier head. */
export function staleApprovalLabels(attached: readonly string[], events: readonly LabelEvent[], since: string | undefined): ApprovalLabel[] {
  return APPROVAL_LABELS.filter(label => {
    const verdict = labelApproval(label, attached, events, since)
    return !verdict.approved && verdict.stale
  })
}

async function github(path: string, method: 'GET' | 'DELETE' = 'GET'): Promise<unknown> {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (!token) throw new Error('A GitHub token is required to check head-specific label approval')
  let response: Response
  try {
    response = await fetch(`https://api.github.com/${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'agentic-mermaid-label-approval' },
    })
  } catch { throw new Error('GitHub label approval request failed before receiving a response') }
  if (!response.ok) throw new Error(`GitHub label approval request failed: HTTP ${response.status}`)
  if (response.status === 204) return undefined
  try { return await response.json() } catch { throw new Error('GitHub label approval returned invalid JSON') }
}

async function githubPages(path: string): Promise<unknown[]> {
  const rows: unknown[] = []
  for (let page = 1; page <= 1000; page++) {
    const batch = await github(`${path}?per_page=100&page=${page}`)
    if (!Array.isArray(batch)) throw new Error('GitHub label approval expected a paginated array')
    rows.push(...batch)
    if (batch.length < 100) return rows
  }
  throw new Error('GitHub label approval pagination exceeded 1000 pages; no approval inferred')
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GitHub label approval expected a response object')
  return value as Record<string, unknown>
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error('GitHub label approval has no valid event timestamp; no approval inferred')
  }
  return value
}

function labelName(value: unknown): string {
  const name = record(value).name
  if (typeof name !== 'string' || !name) throw new Error('GitHub label approval has no valid label name')
  return name
}

function labelEvents(values: readonly unknown[]): LabelEvent[] {
  return values.flatMap(value => {
    const row = record(value)
    if (typeof row.event !== 'string') throw new Error('GitHub label approval has no valid event kind')
    if (row.event !== 'labeled' && row.event !== 'unlabeled') return []
    const actor = row.actor === null || row.actor === undefined ? undefined : record(row.actor).login
    if (actor !== undefined && (typeof actor !== 'string' || !actor)) throw new Error('GitHub label approval has no valid event actor')
    return [{ event: row.event, label: labelName(row.label), actor: typeof actor === 'string' ? actor : 'unknown', createdAt: timestamp(row.created_at) }]
  })
}

const USAGE = 'Usage: bun run scripts/ci/label-approval.ts check --label <no-red-green|payload-growth-approved> | expire  (in a pull_request workflow run)\n'

if (import.meta.main) {
  const [mode, ...rest] = process.argv.slice(2)
  const labelIndex = rest.indexOf('--label')
  const label = labelIndex >= 0 ? rest[labelIndex + 1] : undefined
  const { GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: runId, PR_NUMBER: pr, EVENT_ACTION: action } = process.env
  const known = (name: string | undefined): name is ApprovalLabel => APPROVAL_LABELS.includes(name as ApprovalLabel)
  if (!repo || !runId || !pr || !action || !(mode === 'expire' || (mode === 'check' && known(label)))) {
    process.stderr.write(USAGE)
    process.exit(2)
  }

  const attached = (await githubPages(`repos/${repo}/issues/${pr}/labels`)).map(labelName)
  const events = labelEvents(await githubPages(`repos/${repo}/issues/${pr}/events`))
  // A re-run keeps its run's created_at, so it still dates the triggering event.
  // Missing metadata must never become undefined: that means the opened head
  // to labelApproval and would incorrectly approve a stale attached label.
  const since = action === 'opened' ? undefined : timestamp(record(await github(`repos/${repo}/actions/runs/${runId}`)).created_at)

  if (mode === 'check') {
    const verdict = labelApproval(label!, attached, events, since)
    process.stdout.write(`${verdict.message}\n`)
    if (!verdict.approved && verdict.stale && process.env.GITHUB_ACTIONS === 'true') {
      process.stdout.write(`::warning title=Stale ${label} label::${verdict.message}\n`)
    }
    process.exit(verdict.approved ? 0 : 1)
  }

  const stale = staleApprovalLabels(attached, events, since)
  for (const name of stale) {
    await github(`repos/${repo}/issues/${pr}/labels/${encodeURIComponent(name)}`, 'DELETE')
    process.stdout.write(`Removed ${name}: ${labelApproval(name, attached, events, since).message}\n`)
  }
  if (stale.length === 0) process.stdout.write('No approval label predates this head.\n')
}
