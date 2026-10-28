import { err, ok, type MutationError, type Result } from '../agent/types.ts'
import { appendNativeAccessibilityLines } from '../shared/accessibility-directives.ts'
import { accessibilityDescriptionText, accessibilityTitleText } from '../agent/accessibility-envelope.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { unknownOpMessage } from '../agent/mutation-ops.ts'
import { parseZenUML, zenNameSource } from './native-parser.ts'
import type { ZenUMLAssignment, ZenUMLBody, ZenUMLMutationOp, ZenUMLStatement } from './native-types.ts'

export function walkZenUML(statements: readonly ZenUMLStatement[], visit: (statement: ZenUMLStatement, siblings: ZenUMLStatement[]) => void): void {
  for (const statement of statements) {
    visit(statement, statements as ZenUMLStatement[])
    if (statement.kind === 'call' || statement.kind === 'create') walkZenUML(statement.children, visit)
    if (statement.kind === 'fragment') for (const branch of statement.branches) walkZenUML(branch.statements, visit)
  }
}
export function validateZenUML(body: ZenUMLBody, writing = false): void {
  if (!body || body.kind !== 'zenuml' || !Array.isArray(body.participants) || !Array.isArray(body.statements)) throw Error('Invalid ZenUML body')
  for (const value of [body.title, body.accessibilityTitle, body.accessibilityDescription]) if (value !== undefined && typeof value !== 'string') throw Error('ZenUML metadata must be text')
  if (body.starter !== undefined) zenNameSource(body.starter)
  const participants = new Set<string>()
  for (const p of body.participants) {
    zenNameSource(p.id)
    if (typeof p.label !== 'string' || /[\r\n]/.test(p.label)) throw Error('ZenUML aliases must be single-line text')
    if (participants.has(p.id)) throw Error(`Duplicate ZenUML participant: ${p.id}`)
    participants.add(p.id)
    if (!Array.isArray(p.annotations) || p.annotations.some(a => typeof a !== 'string' || !/^\w+$/.test(a))) throw Error('Invalid ZenUML annotator')
    if (p.annotations.length > 1 && (writing || body.unsupportedSource === undefined)) throw Error('ZenUML declarations accept one participant annotator')
    if (p.stereotype !== undefined && (typeof p.stereotype !== 'string' || !p.stereotype || /[<>\r\n]/.test(p.stereotype))) throw Error('Invalid ZenUML stereotype')
    if (p.comments !== undefined && (!Array.isArray(p.comments) || p.comments.some(c => typeof c !== 'string'))) throw Error('Invalid ZenUML participant comments')
  }
  const ids = new Set<string>(), seen = new Set<object>()
  const text = (value: unknown) => { if (typeof value !== 'string') throw Error('ZenUML content must be text') }
  const assigned = (value: ZenUMLAssignment | undefined) => { if (value) { zenNameSource(value.name); if (value.type !== undefined) zenNameSource(value.type) } }
  const check = (statements: ZenUMLStatement[], depth: number) => {
    if (!Array.isArray(statements) || depth > 128) throw Error('Invalid or excessive ZenUML scope nesting')
    for (const s of statements) {
      if (!s || typeof s !== 'object' || seen.has(s)) throw Error('Cyclic or shared ZenUML statement')
      seen.add(s)
      if (typeof s.id !== 'string' || !s.id || ids.has(s.id)) throw Error('ZenUML statement identities must be unique')
      ids.add(s.id)
      switch (s.kind) {
        case 'call':
          if (s.from !== undefined) zenNameSource(s.from)
          if (s.to !== undefined) zenNameSource(s.to)
          if (s.from !== undefined && s.to === undefined) throw Error('An explicit ZenUML caller requires a target')
          text(s.label); assigned(s.assignment); check(s.children, depth + 1); break
        case 'create':
          zenNameSource(s.constructor); if (s.arguments !== undefined) text(s.arguments)
          assigned(s.assignment); check(s.children, depth + 1); break
        case 'message':
          zenNameSource(s.from); zenNameSource(s.to); text(s.label)
          if (typeof s.reply !== 'boolean') throw Error('ZenUML message reply flag must be boolean')
          break
        case 'return': text(s.label); break
        case 'comment': text(s.text); break
        case 'fragment': {
          if (!['if', 'opt', 'while', 'for', 'forEach', 'foreach', 'loop', 'par', 'try', 'critical'].includes(s.type) || !Array.isArray(s.branches) || !s.branches.length || s.branches[0]?.kind !== 'body') throw Error('Invalid ZenUML fragment')
          if (s.condition !== undefined) text(s.condition)
          let terminal = false
          for (const [index, branch] of s.branches.entries()) {
            if (index && (terminal || (s.type === 'if' ? !['else-if', 'else'].includes(branch.kind) : s.type === 'try' ? !['catch', 'finally'].includes(branch.kind) : true))) throw Error('Invalid ZenUML branch order')
            if (branch.kind === 'else' || branch.kind === 'finally') terminal = true
            if (branch.condition !== undefined) text(branch.condition)
            check(branch.statements, depth + 1)
          }
          break
        }
        case 'opaque':
          text(s.source)
          if (writing || body.unsupportedSource === undefined) throw Error('Unsupported ZenUML syntax is retained; typed editing and rendering require a fully modelled document')
          break
        default: throw Error('Unknown ZenUML statement kind')
      }
    }
  }
  check(body.statements, 0)
  if (writing && body.unsupportedSource !== undefined) throw Error('Unsupported ZenUML source cannot be rewritten through typed editing')
  assertDiagramWorkLimit('nodes', zenUMLActorIdentities(body).size)
  assertDiagramWorkLimit('edges', ids.size)
}
function assignmentSource(value: ZenUMLAssignment | undefined): string {
  return value ? `${value.type ? `${zenNameSource(value.type)} ` : ''}${zenNameSource(value.name)} = ` : ''
}
export function serializeZenUML(body: ZenUMLBody, includeTitleWrapper = true): string {
  validateZenUML(body)
  if (body.unsupportedSource !== undefined) return body.unsupportedSource
  const lines = ['zenuml']
  appendNativeAccessibilityLines(lines, body)
  if (body.title !== undefined && includeTitleWrapper) {
    if (/[\r\n]/.test(body.title)) {
      lines.unshift(`---\ntitle: ${JSON.stringify(body.title)}\n---`)
    } else lines.push(`title ${body.title}`)
  }
  for (const p of body.participants) {
    for (const comment of p.comments ?? []) for (const line of comment.split('\n')) lines.push(`//${line ? ` ${line}` : ''}`)
    lines.push(`${p.annotations.map(a => `@${a} `).join('')}${p.stereotype ? `<<${zenNameSource(p.stereotype)}>> ` : ''}${zenNameSource(p.id)}${p.label === p.id ? '' : ` as ${p.label ? zenNameSource(p.label) : '""'}`}`)
  }
  if (body.starter !== undefined) lines.push(`@Starter(${zenNameSource(body.starter)})`)
  const emit = (statements: readonly ZenUMLStatement[], depth: number) => {
    const indent = '  '.repeat(depth)
    const children = (prefix: string, inner: readonly ZenUMLStatement[]) => {
      if (!inner.length) { lines.push(indent + prefix); return }
      lines.push(`${indent}${prefix} {`); emit(inner, depth + 1); lines.push(`${indent}}`)
    }
    for (const s of statements) switch (s.kind) {
      case 'comment':
        for (const line of s.text.split('\n')) lines.push(`${indent}//${line ? ` ${line}` : ''}`)
        break
      case 'call': children(`${assignmentSource(s.assignment)}${s.to === undefined ? '' : `${s.from === undefined ? '' : `${zenNameSource(s.from)}->`}${zenNameSource(s.to)}.`}${s.label}`, s.children); break
      case 'create': children(`${assignmentSource(s.assignment)}new ${zenNameSource(s.constructor)}${s.arguments === undefined ? '' : `(${s.arguments})`}`, s.children); break
      case 'return': lines.push(`${indent}return${s.label ? ` ${s.label}` : ''}`); break
      case 'message': lines.push(`${indent}${zenNameSource(s.from)}${s.reply ? '-->' : '->'}${zenNameSource(s.to)}: ${s.label}`); break
      case 'fragment':
        for (const [index, branch] of s.branches.entries()) {
          const head = index === 0 ? `${s.type}${s.condition === undefined ? '' : ` (${s.condition})`}` : `${branch.kind === 'else-if' ? 'else if' : branch.kind}${branch.condition === undefined ? '' : ` (${branch.condition})`}`
          lines.push(`${indent}${index ? '} ' : ''}${head} {`)
          emit(branch.statements, depth + 1)
        }
        lines.push(`${indent}}`)
        break
      case 'opaque': throw Error('Unsupported ZenUML source cannot be serialized partially')
    }
  }
  emit(body.statements, 0)
  return lines.join('\n') + '\n'
}
/** IDs address this parsed body, rather than changing the authored grammar. */
export function zenUMLMeaning(body: ZenUMLBody): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key, v]) => v !== undefined && !(key === 'id' && 'kind' in value && value.kind !== 'zenuml')).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, v]) => [key, canonical(v)]))
    return value
  }
  return JSON.stringify(canonical(body))
}
export function mutateZenUML(body: ZenUMLBody, op: ZenUMLMutationOp): Result<ZenUMLBody, MutationError> {
  try {
    validateZenUML(body, true)
    const next = structuredClone(body)
    const find = (id: string) => {
      let found: { statement: ZenUMLStatement; siblings: ZenUMLStatement[] } | undefined
      walkZenUML(next.statements, (statement, siblings) => { if (statement.id === id) found = { statement, siblings } })
      if (!found) throw Error(`Unknown ZenUML statement: ${id}`)
      return found
    }
    const position = (index: number | undefined, size: number) => {
      const at = index ?? size
      if (!Number.isSafeInteger(at) || at < 0 || at > size) throw Error('Invalid ZenUML insertion position')
      return at
    }
    const participantIndex = (id: string) => {
      const index = next.participants.findIndex(p => p.id === id)
      if (index < 0) throw Error(`Unknown declared ZenUML participant: ${id}`)
      return index
    }
    switch (op.kind) {
      case 'upsert_participant': {
        const index = next.participants.findIndex(p => p.id === op.participant.id)
        if (index < 0) next.participants.splice(position(op.index, next.participants.length), 0, structuredClone(op.participant))
        else next.participants[index] = structuredClone(op.participant)
        break
      }
      case 'remove_participant': {
        if (referencedParticipant(next, op.id)) throw Error('Cannot remove a participant referenced by ZenUML interactions')
        const index = participantIndex(op.id)
        next.participants.splice(index, 1); break
      }
      case 'rename_participant': {
        const identities = zenUMLActorIdentities(next)
        if (!identities.has(op.id)) throw Error(`Unknown ZenUML participant: ${op.id}`)
        zenNameSource(op.newId)
        const renames = new Map([[op.id, op.newId]])
        walkZenUML(next.statements, s => {
          if (s.kind !== 'create') return
          const oldOwner = s.assignment ? `${s.assignment.name}:${s.constructor}` : s.constructor
          if (oldOwner === op.id && s.assignment) {
            const suffix = `:${s.constructor}`
            if (!op.newId.endsWith(suffix)) throw Error('Renaming a created instance must retain its constructor suffix')
            s.assignment.name = op.newId.slice(0, -suffix.length)
            zenNameSource(s.assignment.name)
          } else if (s.constructor === op.id) {
            s.constructor = op.newId
            renames.set(oldOwner, s.assignment ? `${s.assignment.name}:${s.constructor}` : s.constructor)
          }
        })
        const targets = new Set<string>()
        for (const [oldId, newId] of renames) {
          if (targets.has(newId) || oldId !== newId && identities.has(newId) && !renames.has(newId)) throw Error('Renaming would merge distinct ZenUML participants')
          targets.add(newId)
        }
        for (const p of next.participants) if (renames.has(p.id)) {
          const oldId = p.id; p.id = renames.get(oldId)!
          if (p.label === oldId) p.label = p.id
        }
        if (next.starter !== undefined) next.starter = renames.get(next.starter) ?? next.starter
        walkZenUML(next.statements, s => {
          if (s.kind === 'call' || s.kind === 'message') {
            if (s.from !== undefined) s.from = renames.get(s.from) ?? s.from
            if (s.to !== undefined) s.to = renames.get(s.to) ?? s.to
          }
        })
        break
      }
      case 'insert_statement': {
        let siblings = next.statements
        if (op.parentId !== undefined) {
          const owner = find(op.parentId).statement
          if (owner.kind === 'call' || owner.kind === 'create') {
            if (op.branchIndex !== undefined) throw Error('Only fragments own branch indices')
            siblings = owner.children
          } else if (owner.kind === 'fragment') {
            const branch = owner.branches[position(op.branchIndex ?? 0, owner.branches.length - 1)]
            if (!branch) throw Error('Unknown ZenUML branch')
            siblings = branch.statements
          } else throw Error('Statement cannot own nested ZenUML interactions')
        } else if (op.branchIndex !== undefined) throw Error('A branch index requires a parent fragment')
        siblings.splice(position(op.index, siblings.length), 0, structuredClone(op.statement)); break
      }
      case 'remove_statement': {
        const found = find(op.id); found.siblings.splice(found.siblings.indexOf(found.statement), 1); break
      }
      case 'set_statement': {
        const found = find(op.id)
        if (op.statement.id !== op.id) throw Error('Statement replacement must retain its editing identity')
        found.siblings[found.siblings.indexOf(found.statement)] = structuredClone(op.statement); break
      }
      case 'set_title': next.title = op.title; break
      case 'set_accessibility_title': next.accessibilityTitle = op.title === undefined ? undefined : accessibilityTitleText(op.title); break
      case 'set_accessibility_description': next.accessibilityDescription = op.description === undefined ? undefined : accessibilityDescriptionText(op.description); break
      default: throw Error(unknownOpMessage('zenuml', op))
    }
    validateZenUML(next, true)
    const reparsed = parseZenUML(serializeZenUML(next))
    if (zenUMLMeaning(next) !== zenUMLMeaning(reparsed)) throw Error('ZenUML edit cannot be written without changing owned meaning')
    // Canonical reload owns local editing addresses, including collisions
    // introduced by renaming an actor to an address-looking authored name.
    return ok(reparsed)
  } catch (error) {
    return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) })
  }
}
function referencedParticipant(body: ZenUMLBody, id: string): boolean {
  let found = body.starter === id
  walkZenUML(body.statements, s => {
    if ((s.kind === 'call' || s.kind === 'message') && (s.from === id || s.to === id)) found = true
    if (s.kind === 'create' && (s.constructor === id || (s.assignment ? `${s.assignment.name}:${s.constructor}` : s.constructor) === id)) found = true
  })
  return found
}
export function zenUMLActorIdentities(body: ZenUMLBody): Set<string> {
  const ids = new Set(body.participants.map(p => p.id))
  if (body.starter !== undefined) ids.add(body.starter)
  walkZenUML(body.statements, s => {
    if (s.kind === 'call' || s.kind === 'message') { if (s.from !== undefined) ids.add(s.from); if (s.to !== undefined) ids.add(s.to) }
    if (s.kind === 'create') ids.add(s.assignment ? `${s.assignment.name}:${s.constructor}` : s.constructor)
  })
  return ids
}
