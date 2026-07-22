import type {
  GitGraphBody, GitGraphMutationOp, LayoutWarning, MutationError, Result, VerifyOptions,
} from './types.ts'
import { err, ok } from './types.ts'
import type { GitGraphCommit } from '../gitgraph/types.ts'
import { GitGraphParseError, parseGitGraph, serializeGitGraph } from '../gitgraph/parser.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { unknownOpMessage } from './mutation-ops.ts'

export function parseGitGraphBody(source: string, options: import('../gitgraph/parser.ts').GitGraphParseOptions = {}): GitGraphBody {
  return { kind: 'gitgraph', ...parseGitGraph(source, options) }
}

export function renderGitGraphBody(body: GitGraphBody): string { return serializeGitGraph(body) }

function cloneBody(body: GitGraphBody): GitGraphBody {
  return {
    ...body,
    commits: body.commits.map(commit => ({ ...commit, tags: [...commit.tags], parents: [...commit.parents] })),
    branches: body.branches.map(branch => ({ ...branch })),
    statements: body.statements.map(statement => ({ ...statement })),
  }
}

function quote(value: string): string { return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` }

function appendStatement(body: GitGraphBody, statement: string): Result<GitGraphBody, MutationError> {
  try {
    const parsed = parseGitGraph(renderGitGraphBody(body).trimEnd() + `\n  ${statement}\n`, { mainBranchName: body.mainBranchName })
    return ok({ kind: 'gitgraph', ...parsed })
  } catch (error) {
    return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) })
  }
}

function commitAttrs(op: { id?: string; message?: string; type?: string; tags?: string[] }): string {
  const attrs: string[] = []
  if (op.id !== undefined) attrs.push(`id:${quote(op.id)}`)
  if (op.type !== undefined && op.type !== 'NORMAL') attrs.push(`type:${op.type}`)
  for (const tag of op.tags ?? []) attrs.push(`tag:${quote(tag)}`)
  if (op.message !== undefined) attrs.push(`msg:${quote(op.message)}`)
  return attrs.length ? ` ${attrs.join(' ')}` : ''
}

function validName(value: unknown, field: string): Result<string, MutationError> {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) return err({ code: 'INVALID_OP', message: `gitGraph ${field} must be a non-empty single-line string` })
  return ok(value.trim())
}

export function mutateGitGraph(body: GitGraphBody, op: GitGraphMutationOp): Result<GitGraphBody, MutationError> {
  const next = cloneBody(body)
  const commit = (id: string): GitGraphCommit | undefined => next.commits.find(item => item.id === id)
  switch (op.kind) {
    case 'append_commit':
      return appendStatement(next, `commit${commitAttrs(op)}`)
    case 'create_branch': {
      const name = validName(op.name, 'branch name'); if (!name.ok) return name
      return appendStatement(next, `branch ${quote(name.value)}${op.order !== undefined ? ` order:${op.order}` : ''}`)
    }
    case 'checkout_branch': {
      const name = validName(op.name, 'branch name'); if (!name.ok) return name
      return appendStatement(next, `checkout ${quote(name.value)}`)
    }
    case 'merge_branch': {
      const name = validName(op.name, 'branch name'); if (!name.ok) return name
      return appendStatement(next, `merge ${quote(name.value)}${commitAttrs(op)}`)
    }
    case 'cherry_pick': {
      const id = validName(op.id, 'cherry-pick id'); if (!id.ok) return id
      const attrs = [`id:${quote(id.value)}`]
      if (op.parent) attrs.push(`parent:${quote(op.parent)}`)
      for (const tag of op.tags ?? []) attrs.push(`tag:${quote(tag)}`)
      return appendStatement(next, `cherry-pick ${attrs.join(' ')}`)
    }
    case 'set_commit_message': {
      const target = commit(op.id)
      if (!target) return err({ code: 'NODE_NOT_FOUND', message: `gitGraph commit '${op.id}' not found` })
      if (target.source !== 'commit') return err({ code: 'INVALID_OP', message: `Commit '${op.id}' is produced by ${target.source}; its generated message cannot be replaced` })
      if (op.message === null) delete target.message
      else { const message = validName(op.message, 'commit message'); if (!message.ok) return message; target.message = message.value }
      return ok(next)
    }
    case 'set_commit_type': {
      const target = commit(op.id)
      if (!target) return err({ code: 'NODE_NOT_FOUND', message: `gitGraph commit '${op.id}' not found` })
      if (target.source !== 'commit') return err({ code: 'INVALID_OP', message: `Commit '${op.id}' is produced by ${target.source}; its semantic type cannot be replaced` })
      target.type = op.type
      return ok(next)
    }
    case 'set_commit_tags': {
      const target = commit(op.id)
      if (!target) return err({ code: 'NODE_NOT_FOUND', message: `gitGraph commit '${op.id}' not found` })
      for (const tag of op.tags) { const value = validName(tag, 'tag'); if (!value.ok) return value }
      target.tags = [...op.tags]
      delete target.syntheticCherryTag
      return ok(next)
    }
    case 'rename_branch': {
      if (op.from === next.mainBranchName) return err({ code: 'INVALID_OP', message: 'Renaming the configured main branch requires gitGraph.mainBranchName config; source syntax cannot express it' })
      const target = next.branches.find(branch => branch.name === op.from)
      if (!target) return err({ code: 'NODE_NOT_FOUND', message: `gitGraph branch '${op.from}' not found` })
      const to = validName(op.to, 'branch name'); if (!to.ok) return to
      if (next.branches.some(branch => branch.name === to.value)) return err({ code: 'DUPLICATE_NODE', message: `gitGraph branch '${to.value}' already exists` })
      target.name = to.value
      for (const item of next.commits) {
        const mergedFromRenamed = item.source === 'merge' && item.mergeBranch === op.from
        const mergedIntoRenamed = item.source === 'merge' && item.branch === op.from
        if (item.branch === op.from) item.branch = to.value
        if (mergedFromRenamed) item.mergeBranch = to.value
        if (mergedFromRenamed || mergedIntoRenamed) item.message = `merged branch ${item.mergeBranch} into ${item.branch}`
      }
      for (const statement of next.statements) {
        if (statement.kind === 'branch' && statement.name === op.from) statement.name = to.value
        else if (statement.kind === 'checkout' && statement.branch === op.from) statement.branch = to.value
        else if (statement.kind === 'merge' && statement.branch === op.from) statement.branch = to.value
      }
      return ok(next)
    }
    case 'set_accessibility_title':
      if (op.title === null) delete next.accessibilityTitle
      else { const title = validName(op.title, 'accessibility title'); if (!title.ok) return title; next.accessibilityTitle = title.value }
      return ok(next)
    case 'set_accessibility_description':
      if (op.description === null) delete next.accessibilityDescription
      else { const description = validName(op.description, 'accessibility description'); if (!description.ok) return description; next.accessibilityDescription = description.value }
      return ok(next)
    default:
      return err({ code: 'INVALID_OP', message: unknownOpMessage('gitgraph', op) })
  }
}

export function verifyGitGraph(body: GitGraphBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  const ids = new Set(body.commits.map(commit => commit.id))
  const overflow = labelOverflowCollector(warnings, opts)
  for (const commit of body.commits) {
    overflow(commit.id, commit.message || commit.id)
    for (const parent of commit.parents) if (!ids.has(parent)) warnings.push({ code: 'EDGE_MISANCHORED', edge: `${parent}->${commit.id}`, to: commit.id })
  }
  return warnings
}
