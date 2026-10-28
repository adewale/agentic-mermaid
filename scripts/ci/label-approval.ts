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

function gh(args: string[]): string {
  const result = Bun.spawnSync(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(`gh ${args.join(' ')} failed: ${result.stderr.toString()}`)
  return result.stdout.toString()
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

  const attached = gh(['api', '--paginate', `repos/${repo}/issues/${pr}/labels`, '--jq', '.[].name']).split('\n').filter(Boolean)
  const events: LabelEvent[] = gh([
    'api', '--paginate', `repos/${repo}/issues/${pr}/events`,
    '--jq', '.[] | select(.event == "labeled" or .event == "unlabeled") | {event, label: .label.name, actor: (.actor.login // "unknown"), createdAt: .created_at}',
  ]).split('\n').filter(Boolean).map(line => JSON.parse(line) as LabelEvent)
  // A re-run keeps its run's created_at, so it still dates the triggering event.
  const since = action === 'opened' ? undefined : gh(['api', `repos/${repo}/actions/runs/${runId}`, '--jq', '.created_at']).trim()

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
    gh(['api', '-X', 'DELETE', `repos/${repo}/issues/${pr}/labels/${name}`])
    process.stdout.write(`Removed ${name}: ${labelApproval(name, attached, events, since).message}\n`)
  }
  if (stale.length === 0) process.stdout.write('No approval label predates this head.\n')
}
