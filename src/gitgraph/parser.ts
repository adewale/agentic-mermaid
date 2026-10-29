import { scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { generatedIds } from '../shared/generated-identity.ts'
import { observeParserMutation, observeParserStatement, parserObservationActive } from '../shared/parser-observation.ts'
import { joinQuotedTextLines, type QuotedTextRule, quotedTextEnds, stripTrailingComment } from '../shared/trailing-comment.ts'
import type { GitGraphBranch, GitGraphCommit, GitGraphCommitType, GitGraphDiagram, GitGraphDirection, GitGraphStatement } from './types.ts'
import { gitGraphCommitLabel } from './types.ts'

export class GitGraphParseError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(message)
    this.name = 'GitGraphParseError'
  }
}

export class GitGraphDuplicateCommitError extends GitGraphParseError {
  readonly code = 'GITGRAPH_DUPLICATE_COMMIT_ID'
  constructor(
    readonly id: string,
    line: number,
  ) {
    super(`Duplicate gitGraph commit id '${id}' on line ${line}; commit IDs must be unique.`, line)
  }
}

export interface GitGraphParseOptions {
  mainBranchName?: string
  mainBranchOrder?: number
  title?: string
}

// Mermaid's GitGraph grammar reads either quoted string to its closing quote across
// line breaks, which it keeps; a title runs to the end of its line.
const QUOTED_TEXT: QuotedTextRule = { spanning: '"\'', wholeLine: line => /^title(?:\s|$)/i.test(line) }

/** For each line, the last line of the statement that starts there. */
export function gitGraphStatementEnds(lines: readonly string[]): number[] {
  return quotedTextEnds(lines, QUOTED_TEXT)
}

export function parseGitGraph(source: string, options: GitGraphParseOptions = {}): GitGraphDiagram {
  const sourceLines = source.replace(/^\uFEFF/, '').split(/\r?\n/)
  const scanned = scanAccessibilityDirectives(sourceLines, gitGraphStatementEnds(sourceLines))
  if (scanned.unclosedIndex !== undefined) {
    throw new GitGraphParseError('Unclosed accDescr block', scanned.unclosedIndex + 1)
  }
  // Mermaid's GitGraph grammar ends every statement at a `%%` comment.
  const lines = joinQuotedTextLines(scanned.familyLines, QUOTED_TEXT).map(stripTrailingComment)
  const headerIndex = lines.findIndex(line => /^\s*gitgraph\b/i.test(line))
  if (headerIndex < 0) throw new GitGraphParseError('gitGraph source must start with a gitGraph header')
  const header = lines[headerIndex]!.trim().match(/^gitGraph(?:\s+(LR|TB|BT))?\s*:?[ \t]*$/i)
  if (!header) throw new GitGraphParseError('Invalid gitGraph header; expected gitGraph, gitGraph LR:, gitGraph TB:, or gitGraph BT:', headerIndex + 1)
  if (parserObservationActive('gitgraph')) observeParserStatement('gitgraph', 'header', lines[headerIndex]!, { line: headerIndex + 1, unit: 'normalized' })
  const direction = (header[1]?.toUpperCase() ?? 'LR') as GitGraphDirection
  const mainBranchName = typeof options.mainBranchName === 'string' && options.mainBranchName.trim() ? options.mainBranchName.trim() : 'main'
  const mainOrder = finiteOrder(options.mainBranchOrder, 0)
  const title = typeof options.title === 'string' && options.title.trim() ? options.title.trim() : undefined
  const commits: GitGraphCommit[] = []
  const branches = new Map<string, GitGraphBranch>([[mainBranchName, { name: mainBranchName, order: mainOrder, sequence: 0 }]])
  const statements: GitGraphStatement[] = []
  const commitById = new Map<string, GitGraphCommit>()
  // Reserve all valid authored declarations before allocating any occurrence,
  // including IDs that look like generated suffixes or deterministic c<N> IDs.
  // Reuse the actual attribute reader; invalid declarations are diagnosed in
  // source order by the normal replay below.
  const authoredIds: string[] = []
  const attrsByLine = new Map<number, ParsedAttrs>()
  for (let index = headerIndex + 1; index < lines.length; index++) {
    const text = lines[index]!.trim()
    const declaration = text.match(COMMIT_LINE)
    const merge = declaration ? undefined : text.match(MERGE_LINE)
    if (!declaration && !merge) continue
    const payload = declaration ? (declaration[1] ?? '') : (merge![2] ?? '')
    if (declaration && /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/.test(payload)) continue
    try {
      const attrs = parseAttrs(payload, index + 1, declaration ? ['id', 'tag', 'type', 'msg'] : ['id', 'tag', 'type'])
      attrsByLine.set(index, attrs)
      if (attrs.id !== undefined) authoredIds.push(attrs.id)
    } catch {
      /* Preserve the first actual replay error below. */
    }
  }
  const allocateId = generatedIds(authoredIds)
  const latestSourceCommit = new Map<string, GitGraphCommit>()
  let currentBranch = mainBranchName
  let sequence = 0
  const accessibilityTitle = scanned.accessibility.title
  const accessibilityDescription = scanned.accessibility.descr
  if (parserObservationActive('gitgraph')) observeParserMutation('gitgraph', 'initialize', { direction, mainBranchName, title, branch: branches.get(mainBranchName), currentBranch, accessibilityTitle, accessibilityDescription })

  const addCommit = (attrs: ParsedAttrs, sourceKind: GitGraphCommit['source'], line: number, extra: Partial<GitGraphCommit> = {}, parents?: string[]): GitGraphCommit => {
    const customId = attrs.id !== undefined
    const preferred = attrs.id ?? `c${sequence}`
    // Pinned syntax rejects an explicit merge ID that names an existing commit.
    if (sourceKind === 'merge' && customId && latestSourceCommit.has(preferred)) throw new GitGraphDuplicateCommitError(preferred, line)
    const id = customId && !commitById.has(preferred) ? preferred : allocateId(preferred, ['commit', sequence])
    const type = sourceKind === 'merge' ? 'MERGE' : sourceKind === 'cherry-pick' ? 'CHERRY_PICK' : (attrs.type ?? 'NORMAL')
    const branch = branches.get(currentBranch)!
    const commit: GitGraphCommit = {
      id,
      ...(customId && id !== attrs.id ? { sourceId: attrs.id } : {}),
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
    if (parserObservationActive('gitgraph')) observeParserMutation('gitgraph', 'addCommit', commit, { line, unit: 'normalized' })
    commitById.set(id, commit)
    latestSourceCommit.set(attrs.id ?? id, commit)
    branch.head = id
    if (parserObservationActive('gitgraph')) observeParserMutation('gitgraph', 'setBranchHead', { branch: currentBranch, head: id }, { line, unit: 'normalized' })
    return commit
  }

  for (let index = headerIndex + 1; index < lines.length; index++) {
    const text = lines[index]!.trim()
    if (!text || text.startsWith('%%')) continue
    const commitLine = text.match(COMMIT_LINE)
    if (commitLine) {
      if (parserObservationActive('gitgraph')) observeParserStatement('gitgraph', 'commit', text, { line: index + 1, unit: 'normalized' })
      const payload = commitLine[1] ?? ''
      const legacyMessage = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/.test(payload)
      const attrs = legacyMessage ? { tags: [], msg: unquote(payload) } : (attrsByLine.get(index) ?? parseAttrs(payload, index + 1, ['id', 'tag', 'type', 'msg']))
      const commit = addCommit(attrs, 'commit', index + 1)
      statements.push({ kind: 'commit', ref: commit.id })
      if (parserObservationActive('gitgraph')) observeParserMutation('gitgraph', 'appendStatement', statements.at(-1), { line: index + 1, unit: 'normalized' })
      continue
    }
    const branchLine = text.match(/^branch\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)(?:\s+order\s*:\s*(-?\d+))?$/i)
    if (branchLine) {
      if (parserObservationActive('gitgraph')) observeParserStatement('gitgraph', 'branch', text, { line: index + 1, unit: 'normalized' })
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
      if (parserObservationActive('gitgraph')) observeParserMutation('gitgraph', 'addBranch', branches.get(name), { line: index + 1, unit: 'normalized' })
      currentBranch = name
      if (parserObservationActive('gitgraph')) observeParserMutation('gitgraph', 'setCurrentBranch', name, { line: index + 1, unit: 'normalized' })
      statements.push({ kind: 'branch', name, ...(branchLine[2] !== undefined ? { order } : {}) })
      if (parserObservationActive('gitgraph')) observeParserMutation('gitgraph', 'appendStatement', statements.at(-1), { line: index + 1, unit: 'normalized' })
      continue
    }
    const checkout = text.match(/^(checkout|switch)\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)$/i)
    if (checkout) {
      if (parserObservationActive('gitgraph')) observeParserStatement('gitgraph', 'checkout', text, { line: index + 1, unit: 'normalized' })
      const name = unquote(checkout[2]!)
      if (!branches.has(name)) throw new GitGraphParseError(`Trying to checkout branch '${name}' before it is created.`, index + 1)
      currentBranch = name
      if (parserObservationActive('gitgraph')) observeParserMutation('gitgraph', 'setCurrentBranch', name, { line: index + 1, unit: 'normalized' })
      statements.push({ kind: 'checkout', branch: name, keyword: checkout[1]!.toLowerCase() as 'checkout' | 'switch' })
      if (parserObservationActive('gitgraph')) observeParserMutation('gitgraph', 'appendStatement', statements.at(-1), { line: index + 1, unit: 'normalized' })
      continue
    }
    const mergeLine = text.match(MERGE_LINE)
    if (mergeLine) {
      if (parserObservationActive('gitgraph')) observeParserStatement('gitgraph', 'merge', text, { line: index + 1, unit: 'normalized' })
      const other = unquote(mergeLine[1]!)
      const attrs = attrsByLine.get(index) ?? parseAttrs(mergeLine[2] ?? '', index + 1, ['id', 'tag', 'type'])
      if (other === currentBranch) throw new GitGraphParseError(`Cannot merge branch '${other}' into itself.`, index + 1)
      const current = branches.get(currentBranch)!
      const source = branches.get(other)
      if (!source) throw new GitGraphParseError(`Branch to be merged ('${other}') does not exist.`, index + 1)
      if (!current.head) throw new GitGraphParseError(`Current branch '${currentBranch}' has no commits.`, index + 1)
      if (!source.head) throw new GitGraphParseError(`Branch to be merged ('${other}') has no commits.`, index + 1)
      if (source.head === current.head) throw new GitGraphParseError('Cannot merge branches with the same head commit.', index + 1)
      const merged = addCommit(
        attrs,
        'merge',
        index + 1,
        {
          mergeBranch: other,
          message: `merged branch ${other} into ${currentBranch}`,
          ...(attrs.type ? { customType: attrs.type } : {}),
        },
        [current.head, source.head],
      )
      statements.push({ kind: 'merge', ref: merged.id, branch: other })
      if (parserObservationActive('gitgraph')) observeParserMutation('gitgraph', 'appendStatement', statements.at(-1), { line: index + 1, unit: 'normalized' })
      continue
    }
    const cherryLine = text.match(/^cherry-pick\s+(.+)$/is)
    if (cherryLine) {
      if (parserObservationActive('gitgraph')) observeParserStatement('gitgraph', 'cherry-pick', text, { line: index + 1, unit: 'normalized' })
      const attrs = parseAttrs(cherryLine[1]!, index + 1, ['id', 'tag', 'parent'])
      if (!attrs.id) throw new GitGraphParseError('cherry-pick requires id:"existing commit".', index + 1)
      const source = latestSourceCommit.get(attrs.id)
      if (!source) throw new GitGraphParseError(`Cherry-pick source commit '${attrs.id}' does not exist.`, index + 1)
      const current = branches.get(currentBranch)!
      if (!current.head) throw new GitGraphParseError(`Current branch '${currentBranch}' has no commits.`, index + 1)
      if (reachableFrom(current.head, source.id, commitById)) throw new GitGraphParseError(`Cherry-pick source '${source.id}' is already reachable from current branch '${currentBranch}'.`, index + 1)
      const parent = attrs.parent ? latestSourceCommit.get(attrs.parent)?.id : undefined
      if (source.parents.length === 2) {
        if (!attrs.parent) throw new GitGraphParseError(`Cherry-picking merge commit '${source.id}' requires parent:"immediate parent".`, index + 1)
        if (!parent || !source.parents.includes(parent)) throw new GitGraphParseError(`Cherry-pick parent '${attrs.parent}' is not an immediate parent of '${source.id}'.`, index + 1)
      }
      const syntheticCherryTag = attrs.tags.length === 0 ? `cherry-pick:${source.sourceId ?? source.id}${attrs.parent ? `|parent:${attrs.parent}` : ''}` : undefined
      const cherryAttrs: ParsedAttrs = { tags: syntheticCherryTag ? [syntheticCherryTag] : attrs.tags }
      const picked = addCommit(
        cherryAttrs,
        'cherry-pick',
        index + 1,
        {
          message: `cherry-picked ${gitGraphCommitLabel(source)} into ${currentBranch}`,
          cherrySource: source.id,
          ...(parent ? { cherryParent: parent } : {}),
          ...(syntheticCherryTag ? { syntheticCherryTag } : {}),
        },
        [current.head, source.id],
      )
      statements.push({ kind: 'cherry-pick', ref: picked.id, source: source.id, ...(parent ? { parent } : {}) })
      if (parserObservationActive('gitgraph')) observeParserMutation('gitgraph', 'appendStatement', statements.at(-1), { line: index + 1, unit: 'normalized' })
      continue
    }
    if (parserObservationActive('gitgraph')) observeParserStatement('gitgraph', 'invalid', text, { line: index + 1, unit: 'normalized' })
    throw new GitGraphParseError(`Unsupported gitGraph statement on line ${index + 1}: ${text}`, index + 1)
  }

  return {
    direction,
    mainBranchName,
    ...(title ? { title } : {}),
    commits,
    branches: [...branches.values()],
    statements,
    ...(accessibilityTitle ? { accessibilityTitle } : {}),
    ...(accessibilityDescription ? { accessibilityDescription } : {}),
  }
}

const COMMIT_LINE = /^commit(?:\s+(.*))?$/is
const MERGE_LINE = /^merge\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)(?:\s+(.*))?$/is

interface ParsedAttrs {
  id?: string
  msg?: string
  type?: Exclude<GitGraphCommitType, 'MERGE' | 'CHERRY_PICK'>
  tags: string[]
  parent?: string
}

function parseAttrs(source: string, line: number, allowed: string[]): ParsedAttrs {
  const attrs: ParsedAttrs = { tags: [] }
  let cursor = 0
  const regex = /([A-Za-z][\w-]*)\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)/gy
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? '')) cursor++
    if (cursor >= source.length) break
    regex.lastIndex = cursor
    const match = regex.exec(source)
    if (!match) throw new GitGraphParseError(`Invalid gitGraph attribute syntax near '${source.slice(cursor)}'.`, line)
    const key = match[1]!.toLowerCase()
    if (!allowed.includes(key)) throw new GitGraphParseError(`Attribute '${key}' is not valid for this gitGraph statement.`, line)
    const value = unquote(match[2]!)
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
  // Langium's STRING converter recognizes these controls and otherwise drops
  // the backslash. It does not interpret JavaScript Unicode or hex escapes.
  // A generous bare-token extension may start with an unmatched quote; only
  // a complete STRING has delimiters or escapes to decode.
  if (!/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/.test(value)) return value
  const controls: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', 0: '\0' }
  return value.slice(1, -1).replace(/\\(.)/g, (_, char: string) => controls[char] ?? char)
}

function quoteToken(value: string): string {
  // INT and title tokens precede branch references in the pinned lexer.
  // Quote their prefixes, keywords, and names outside the reference alphabet.
  return /^[A-Za-z_](?:[-./\w]*[-\w])?$/.test(value) && !/^(?:title|(?:gitGraph|commit|branch|checkout|switch|merge|cherry-pick|LR|TB|BT|NORMAL|REVERSE|HIGHLIGHT)$)/i.test(value) ? value : quote(value)
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
    const commit = commits.get(id)
    // A cherry-pick's second edge records the copied source for drawing;
    // it does not make that source an ancestor of the receiving branch.
    if (commit) pending.push(...(commit.source === 'cherry-pick' ? commit.parents.slice(0, 1) : commit.parents))
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
        lines.push(`  cherry-pick id:${quote(commits.get(commit.cherrySource ?? statement.source)?.sourceId ?? commit.cherrySource ?? statement.source)}${statement.parent ? ` parent:${quote(commits.get(statement.parent)?.sourceId ?? statement.parent)}` : ''}${tags.map(tag => ` tag:${quote(tag)}`).join('')}`)
      }
    }
  }
  return lines.join('\n') + '\n'
}

function commitAttrs(commit: GitGraphCommit, includeMessage = true): string {
  const attrs: string[] = []
  if (commit.customId) attrs.push(`id:${quote(commit.sourceId ?? commit.id)}`)
  const authoredType = commit.type === 'MERGE' ? commit.customType : commit.type
  if (authoredType && authoredType !== 'NORMAL' && authoredType !== 'CHERRY_PICK') attrs.push(`type:${authoredType}`)
  for (const tag of commit.tags) attrs.push(`tag:${quote(tag)}`)
  if (includeMessage && commit.message) attrs.push(`msg:${quote(commit.message)}`)
  return attrs.length ? ` ${attrs.join(' ')}` : ''
}

function implicitBranchOrder(index: number): number {
  return index <= 9 ? index / 10 : 1 - 1 / (index + 1)
}

export function quoteGitGraphString(value: string): string {
  const escapes: Record<string, string> = { '\b': 'b', '\f': 'f', '\n': 'n', '\r': 'r', '\t': 't', '\v': 'v', '\0': '0' }
  // Mermaid preprocesses comments, directives and entity-looking codes without
  // observing STRING boundaries. Unknown STRING escapes restore these literal
  // characters after the prepasses, including percent beside LS/PS. Its style
  // prepass also strips a semicolon from strings containing these keywords.
  const escaped = value.replace(/[\\"%\b\f\n\r\t\v\0]/g, char => `\\${escapes[char] ?? char}`)
    .replace(/#\w+;/g, entity => `${entity.slice(0, -1)}\\;`)
    .replace(/style/g, 'sty\\le')
    .replace(/classDef/g, 'class\\Def')
  return `"${escaped}"`
}

const quote = quoteGitGraphString
