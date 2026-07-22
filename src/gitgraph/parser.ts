import type {
  GitGraphBranch, GitGraphCommit, GitGraphCommitType, GitGraphDiagram,
  GitGraphDirection, GitGraphStatement,
} from './types.ts'
import { scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'

export class GitGraphParseError extends Error {
  constructor(message: string, readonly line?: number) { super(message); this.name = 'GitGraphParseError' }
}

export class GitGraphDuplicateCommitError extends GitGraphParseError {
  readonly code = 'GITGRAPH_DUPLICATE_COMMIT_ID'
  constructor(readonly id: string, line: number) { super(`Duplicate gitGraph commit id '${id}' on line ${line}; commit IDs must be unique.`, line) }
}

export interface GitGraphParseOptions { mainBranchName?: string; mainBranchOrder?: number; title?: string }

export function parseGitGraph(source: string, options: GitGraphParseOptions = {}): GitGraphDiagram {
  const scanned = scanAccessibilityDirectives(source.replace(/^\uFEFF/, '').split(/\r?\n/))
  if (scanned.unclosedIndex !== undefined) {
    throw new GitGraphParseError('Unclosed accDescr block', scanned.unclosedIndex + 1)
  }
  const lines = scanned.familyLines
  const headerIndex = lines.findIndex(line => /^\s*gitgraph\b/i.test(line))
  if (headerIndex < 0) throw new GitGraphParseError('gitGraph source must start with a gitGraph header')
  const header = lines[headerIndex]!.trim().match(/^gitGraph(?:\s+(LR|TB|BT))?\s*:?[ \t]*$/i)
  if (!header) throw new GitGraphParseError('Invalid gitGraph header; expected gitGraph, gitGraph LR:, gitGraph TB:, or gitGraph BT:', headerIndex + 1)
  const direction = (header[1]?.toUpperCase() ?? 'LR') as GitGraphDirection
  const mainBranchName = typeof options.mainBranchName === 'string' && options.mainBranchName.trim() ? options.mainBranchName.trim() : 'main'
  const mainOrder = finiteOrder(options.mainBranchOrder, 0)
  const title = typeof options.title === 'string' && options.title.trim() ? options.title.trim() : undefined
  const commits: GitGraphCommit[] = []
  const branches = new Map<string, GitGraphBranch>([[mainBranchName, { name: mainBranchName, order: mainOrder, sequence: 0 }]])
  const statements: GitGraphStatement[] = []
  const commitById = new Map<string, GitGraphCommit>()
  let currentBranch = mainBranchName
  let sequence = 0
  const accessibilityTitle = scanned.accessibility.title
  const accessibilityDescription = scanned.accessibility.descr

  const addCommit = (
    attrs: ParsedAttrs,
    sourceKind: GitGraphCommit['source'],
    line: number,
    extra: Partial<GitGraphCommit> = {},
    parents?: string[],
  ): GitGraphCommit => {
    const customId = attrs.id !== undefined
    const id = attrs.id ?? `c${sequence}`
    if (commitById.has(id)) throw new GitGraphDuplicateCommitError(id, line)
    const type = sourceKind === 'merge' ? 'MERGE' : sourceKind === 'cherry-pick' ? 'CHERRY_PICK' : (attrs.type ?? 'NORMAL')
    const branch = branches.get(currentBranch)!
    const commit: GitGraphCommit = {
      id,
      ...(attrs.msg ? { message: attrs.msg } : {}),
      type,
      tags: attrs.tags,
      branch: currentBranch,
      parents: parents ?? (branch.head ? [branch.head] : []),
      sequence: sequence++,
      source: sourceKind,
      customId,
      ...extra,
    }
    commits.push(commit)
    commitById.set(id, commit)
    branch.head = id
    return commit
  }

  for (let index = headerIndex + 1; index < lines.length; index++) {
    const text = lines[index]!.trim()
    if (!text || text.startsWith('%%')) continue
    const commitLine = text.match(/^commit(?:\s+(.*))?$/i)
    if (commitLine) {
      const payload = commitLine[1] ?? ''
      const legacyMessage = payload.match(/^"((?:\\.|[^"])*)"$/)
      const attrs = legacyMessage
        ? { tags: [], msg: legacyMessage[1]!.replace(/\\(["\\])/g, '$1') }
        : parseAttrs(payload, index + 1, ['id', 'tag', 'type', 'msg'])
      const commit = addCommit(attrs, 'commit', index + 1)
      statements.push({ kind: 'commit', ref: commit.id })
      continue
    }
    const branchLine = text.match(/^branch\s+("(?:\\.|[^"])+"|\S+)(?:\s+order\s*:\s*(-?\d+))?$/i)
    if (branchLine) {
      const name = unquote(branchLine[1]!)
      if (branches.has(name)) throw new GitGraphParseError(`Trying to create existing branch '${name}'; use checkout ${quoteToken(name)} instead.`, index + 1)
      // Pinned Mermaid semantics place unordered branches before explicit
      // positive-integer orders. Keep the familiar 0.1…0.9 values, then use a
      // monotone sequence approaching 1 so creation order remains correct for
      // ten or more branches (decimal-string 0.10 aliases 0.1).
      const explicitOrder = branchLine[2] === undefined ? undefined : Number(branchLine[2])
      if (explicitOrder !== undefined && explicitOrder <= 0) throw new GitGraphParseError('Branch order must be a positive integer.', index + 1)
      const order = explicitOrder ?? implicitBranchOrder(branches.size)
      branches.set(name, { name, order, sequence: branches.size, ...(branches.get(currentBranch)?.head ? { head: branches.get(currentBranch)!.head } : {}) })
      currentBranch = name
      statements.push({ kind: 'branch', name, ...(branchLine[2] !== undefined ? { order } : {}) })
      continue
    }
    const checkout = text.match(/^(checkout|switch)\s+("(?:\\.|[^"])+"|\S+)$/i)
    if (checkout) {
      const name = unquote(checkout[2]!)
      if (!branches.has(name)) throw new GitGraphParseError(`Trying to checkout branch '${name}' before it is created.`, index + 1)
      currentBranch = name
      statements.push({ kind: 'checkout', branch: name, keyword: checkout[1]!.toLowerCase() as 'checkout' | 'switch' })
      continue
    }
    const mergeLine = text.match(/^merge\s+("(?:\\.|[^"])+"|\S+)(?:\s+(.*))?$/i)
    if (mergeLine) {
      const other = unquote(mergeLine[1]!)
      const attrs = parseAttrs(mergeLine[2] ?? '', index + 1, ['id', 'tag', 'type'])
      if (other === currentBranch) throw new GitGraphParseError(`Cannot merge branch '${other}' into itself.`, index + 1)
      const current = branches.get(currentBranch)!
      const source = branches.get(other)
      if (!source) throw new GitGraphParseError(`Branch to be merged ('${other}') does not exist.`, index + 1)
      if (!current.head) throw new GitGraphParseError(`Current branch '${currentBranch}' has no commits.`, index + 1)
      if (!source.head) throw new GitGraphParseError(`Branch to be merged ('${other}') has no commits.`, index + 1)
      if (source.head === current.head) throw new GitGraphParseError('Cannot merge branches with the same head commit.', index + 1)
      const merged = addCommit(attrs, 'merge', index + 1, {
        mergeBranch: other,
        message: `merged branch ${other} into ${currentBranch}`,
        ...(attrs.type ? { customType: attrs.type } : {}),
      }, [current.head, source.head])
      statements.push({ kind: 'merge', ref: merged.id, branch: other })
      continue
    }
    const cherryLine = text.match(/^cherry-pick\s+(.+)$/i)
    if (cherryLine) {
      const attrs = parseAttrs(cherryLine[1]!, index + 1, ['id', 'tag', 'parent'])
      if (!attrs.id) throw new GitGraphParseError('cherry-pick requires id:"existing commit".', index + 1)
      const source = commitById.get(attrs.id)
      if (!source) throw new GitGraphParseError(`Cherry-pick source commit '${attrs.id}' does not exist.`, index + 1)
      const current = branches.get(currentBranch)!
      if (!current.head) throw new GitGraphParseError(`Current branch '${currentBranch}' has no commits.`, index + 1)
      if (reachableFrom(current.head, source.id, commitById)) throw new GitGraphParseError(`Cherry-pick source '${source.id}' is already reachable from current branch '${currentBranch}'.`, index + 1)
      if (source.parents.length === 2) {
        if (!attrs.parent) throw new GitGraphParseError(`Cherry-picking merge commit '${source.id}' requires parent:"immediate parent".`, index + 1)
        if (!source.parents.includes(attrs.parent)) throw new GitGraphParseError(`Cherry-pick parent '${attrs.parent}' is not an immediate parent of '${source.id}'.`, index + 1)
      }
      const syntheticCherryTag = attrs.tags.length === 0
        ? `cherry-pick:${source.id}${attrs.parent ? `|parent:${attrs.parent}` : ''}`
        : undefined
      const cherryAttrs: ParsedAttrs = { tags: syntheticCherryTag ? [syntheticCherryTag] : attrs.tags }
      const picked = addCommit(cherryAttrs, 'cherry-pick', index + 1, {
        message: `cherry-picked ${source.message ?? source.id} into ${currentBranch}`,
        cherrySource: source.id,
        ...(attrs.parent ? { cherryParent: attrs.parent } : {}),
        ...(syntheticCherryTag ? { syntheticCherryTag } : {}),
      }, [current.head, source.id])
      statements.push({ kind: 'cherry-pick', ref: picked.id, source: source.id, ...(attrs.parent ? { parent: attrs.parent } : {}) })
      continue
    }
    throw new GitGraphParseError(`Unsupported gitGraph statement on line ${index + 1}: ${text}`, index + 1)
  }

  return {
    direction, mainBranchName, ...(title ? { title } : {}), commits, branches: [...branches.values()], statements,
    ...(accessibilityTitle ? { accessibilityTitle } : {}),
    ...(accessibilityDescription ? { accessibilityDescription } : {}),
  }
}

interface ParsedAttrs { id?: string; msg?: string; type?: Exclude<GitGraphCommitType, 'MERGE' | 'CHERRY_PICK'>; tags: string[]; parent?: string }

function parseAttrs(source: string, line: number, allowed: string[]): ParsedAttrs {
  const attrs: ParsedAttrs = { tags: [] }
  let cursor = 0
  const regex = /([A-Za-z][\w-]*)\s*:\s*(?:"((?:\\.|[^"])*)"|(\S+))/gy
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? '')) cursor++
    if (cursor >= source.length) break
    regex.lastIndex = cursor
    const match = regex.exec(source)
    if (!match) throw new GitGraphParseError(`Invalid gitGraph attribute syntax near '${source.slice(cursor)}'.`, line)
    const key = match[1]!.toLowerCase()
    if (!allowed.includes(key)) throw new GitGraphParseError(`Attribute '${key}' is not valid for this gitGraph statement.`, line)
    const value = (match[2] ?? match[3] ?? '').replace(/\\(["\\])/g, '$1')
    if (key === 'id') attrs.id = value
    else if (key === 'msg') attrs.msg = value
    else if (key === 'tag') attrs.tags.push(value)
    else if (key === 'parent') attrs.parent = value
    else {
      const type = value.toUpperCase()
      if (!['NORMAL', 'REVERSE', 'HIGHLIGHT'].includes(type)) throw new GitGraphParseError(`Invalid commit type '${value}'.`, line)
      attrs.type = type as Exclude<GitGraphCommitType, 'MERGE' | 'CHERRY_PICK'>
    }
    cursor = regex.lastIndex
  }
  return attrs
}

function unquote(value: string): string {
  return value.startsWith('"') ? value.slice(1, -1).replace(/\\(["\\])/g, '$1') : value
}

function quoteToken(value: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(value) && !/^(commit|branch|checkout|switch|merge|cherry-pick)$/i.test(value)
    ? value : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function finiteOrder(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function reachableFrom(head: string, target: string, commits: Map<string, GitGraphCommit>): boolean {
  const pending = [head]
  const seen = new Set<string>()
  while (pending.length > 0) {
    const id = pending.pop()!
    if (id === target) return true
    if (seen.has(id)) continue
    seen.add(id)
    pending.push(...(commits.get(id)?.parents ?? []))
  }
  return false
}

export function serializeGitGraph(diagram: GitGraphDiagram): string {
  const header = diagram.direction === 'LR' ? 'gitGraph' : `gitGraph ${diagram.direction}:`
  const lines = [header]
  if (diagram.accessibilityTitle) lines.push(`  accTitle: ${diagram.accessibilityTitle}`)
  if (diagram.accessibilityDescription?.includes('\n')) {
    lines.push('  accDescr {', ...diagram.accessibilityDescription.split('\n').map(line => `    ${line}`), '  }')
  } else if (diagram.accessibilityDescription) lines.push(`  accDescr: ${diagram.accessibilityDescription}`)
  const commits = new Map(diagram.commits.map(commit => [commit.id, commit]))
  for (const statement of diagram.statements) {
    if (statement.kind === 'branch') lines.push(`  branch ${quoteToken(statement.name)}${statement.order !== undefined ? ` order: ${statement.order}` : ''}`)
    else if (statement.kind === 'checkout') lines.push(`  ${statement.keyword} ${quoteToken(statement.branch)}`)
    else {
      const commit = commits.get(statement.ref)
      if (!commit) continue
      if (statement.kind === 'commit') lines.push(`  commit${commitAttrs(commit)}`)
      else if (statement.kind === 'merge') lines.push(`  merge ${quoteToken(statement.branch)}${commitAttrs(commit, false)}`)
      else {
        const tags = commit.tags.filter(tag => tag !== commit.syntheticCherryTag)
        lines.push(`  cherry-pick id:${quote(commit.cherrySource ?? statement.source)}${statement.parent ? ` parent:${quote(statement.parent)}` : ''}${tags.map(tag => ` tag:${quote(tag)}`).join('')}`)
      }
    }
  }
  return lines.join('\n') + '\n'
}

function commitAttrs(commit: GitGraphCommit, includeMessage = true): string {
  const attrs: string[] = []
  if (commit.customId) attrs.push(`id:${quote(commit.id)}`)
  const authoredType = commit.type === 'MERGE' ? commit.customType : commit.type
  if (authoredType && authoredType !== 'NORMAL' && authoredType !== 'CHERRY_PICK') attrs.push(`type:${authoredType}`)
  for (const tag of commit.tags) attrs.push(`tag:${quote(tag)}`)
  if (includeMessage && commit.message) attrs.push(`msg:${quote(commit.message)}`)
  return attrs.length ? ` ${attrs.join(' ')}` : ''
}

function implicitBranchOrder(index: number): number {
  return index <= 9 ? index / 10 : 1 - 1 / (index + 1)
}

function quote(value: string): string { return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` }
