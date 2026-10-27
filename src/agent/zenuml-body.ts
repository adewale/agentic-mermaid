import { mutateNativeMetadata, nativeDomainHooks, nativeMutationFailure, readNativeWrite } from './native-domain-writes.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import { parseZenUml, walkZenUml } from '../zenuml/parser.ts'
import { projectZenUmlSequence } from '../zenuml/projection.ts'
import type { ZenUmlBody, ZenUmlMutationOp, ZenUmlStatement } from '../zenuml/types.ts'
import type { FamilyOperations } from './family-registry.ts'
import { appendAccessibilityLines } from './accessibility-envelope.ts'
import { ok, type MutationError, type Result } from './types.ts'

export function renderZenUml(body: ZenUmlBody): string {
  const lines = ['zenuml']
  appendAccessibilityLines(lines, body)
  const single = (text: string) => { if (/[\r\n]/.test(text)) throw Error('ZenUML fields must remain one statement'); return text }
  if (body.title !== undefined) lines.push(`title ${single(body.title)}`)
  for (const actor of body.participants) {
    if (!/^[A-Za-z_$][\w$]*$/.test(actor.id)) throw Error('Invalid ZenUML participant ID')
    const annotation = actor.type === 'participant' ? '' : `@${actor.type[0]!.toUpperCase()}${actor.type.slice(1)} `
    lines.push(`${annotation}${actor.id}${actor.label !== actor.id ? ` as ${single(actor.label)}` : ''}`)
  }
  const write = (statements: readonly ZenUmlStatement[], depth: number) => {
    const indent = '  '.repeat(depth)
    for (const statement of statements) {
      if (statement.kind === 'comment') { for (const line of statement.text.split('\n')) lines.push(`${indent}// ${line}`); continue }
      if (statement.kind === 'return') { lines.push(`${indent}return ${single(statement.text)}`); continue }
      if (statement.kind === 'region') {
        for (const [index, branch] of statement.branches.entries()) {
          const label = single(branch.label)
          const first = statement.type === 'alt' ? `if(${label})` : statement.type === 'loop' ? `loop(${label})` : `${statement.type}${label ? `(${label})` : ''}`
          lines.push(`${indent}${index ? label : first} {`); write(branch.statements, depth + 1); lines.push(`${indent}}`)
        }
        continue
      }
      let line: string
      if (statement.mode === 'sync') line = `${statement.assignment ? `${statement.assignmentType ? `${statement.assignmentType} ` : ''}${statement.assignment} = ` : ''}${statement.from ? `${statement.from}->` : ''}${statement.to}.${single(statement.text)}`
      else if (statement.mode === 'create') line = single(statement.text)
      else { if (!statement.from) throw Error('Async/reply message requires an explicit sender'); line = `${statement.mode === 'reply' ? '@return ' : ''}${statement.from}->${statement.to}: ${single(statement.text)}` }
      if (statement.children.length) { lines.push(`${indent}${line} {`); write(statement.children, depth + 1); lines.push(`${indent}}`) }
      else lines.push(`${indent}${line}`)
    }
  }
  write(body.statements, 0)
  return lines.join('\n') + '\n'
}
function authored(body: ZenUmlBody): unknown {
  const statements = (items: readonly ZenUmlStatement[]): unknown[] => items.map(item => {
    const { id: _id, ...rest } = item
    return item.kind === 'message' ? { ...rest, children: statements(item.children) } : item.kind === 'region' ? { ...rest, branches: item.branches.map(branch => ({ ...branch, statements: statements(branch.statements) })) } : rest
  })
  return { ...body, statements: statements(body.statements) }
}
export function mutateZenUml(body: ZenUmlBody, op: ZenUmlMutationOp): Result<ZenUmlBody, MutationError> {
  try {
    const next = structuredClone(body)
    const actor = (id: string) => { const item = next.participants.find(item => item.id === id); if (!item) throw Error(`Unknown participant ${id}`); return item }
    const statement = (id: string) => { let found: ZenUmlStatement | undefined; walkZenUml(next.statements, item => { if (item.id === id) found = item }); if (!found) throw Error(`Unknown statement ${id}`); return found }
    const scope = (parentId?: string, branchIndex?: number): ZenUmlStatement[] => {
      if (!parentId) { if (branchIndex !== undefined) throw Error('Root statements have no branch index'); return next.statements }
      const parent = statement(parentId)
      if (parent.kind === 'message') { if (branchIndex !== undefined) throw Error('Message children have no branch index'); return parent.children }
      if (parent.kind !== 'region') throw Error('Statement cannot contain children')
      const index = branchIndex ?? 0
      if (!Number.isSafeInteger(index) || index < 0 || !parent.branches[index]) throw Error('Unknown region branch')
      return parent.branches[index]!.statements
    }
    const insert = (item: ZenUmlStatement, parentId?: string, branchIndex?: number, index?: number) => {
      const items = scope(parentId, branchIndex), at = index ?? items.length
      if (!Number.isSafeInteger(at) || at < 0 || at > items.length) throw Error('Invalid statement insertion index')
      items.splice(at, 0, item)
    }
    if (!mutateNativeMetadata(next, op)) switch (op.kind) {
      case 'add_participant': {
        if (next.participants.some(item => item.id === op.id)) throw Error('Duplicate participant ID')
        const index = op.index ?? next.participants.length
        if (!Number.isSafeInteger(index) || index < 0 || index > next.participants.length) throw Error('Invalid participant index')
        next.participants.splice(index, 0, { id: op.id, label: op.label ?? op.id, type: op.participantType ?? 'participant' }); break
      }
      case 'set_participant_label': actor(op.id).label = op.label; break
      case 'rename_participant': {
        actor(op.from); if (next.participants.some(item => item.id === op.to)) throw Error('Destination participant already exists')
        actor(op.from).id = op.to
        walkZenUml(next.statements, statement => { if (statement.kind === 'message') { if (statement.from === op.from) statement.from = op.to; if (statement.to === op.from) { statement.to = op.to; if (statement.mode === 'create') statement.text = `new ${op.to}${statement.text.slice(`new ${op.from}`.length)}` } } })
        break
      }
      case 'add_message': {
        actor(op.from); actor(op.to)
        insert({ kind: 'message', id: 'new', from: op.from, to: op.to, text: op.text, mode: op.mode ?? 'async', children: [] }, op.parentId, op.branchIndex, op.index); break
      }
      case 'add_call':
      case 'add_creation': {
        actor(op.to); if (op.from) actor(op.from)
        if (op.kind === 'add_call' && op.assignmentType && !op.assignment) throw Error('Assignment type requires an assignment variable')
        if (op.kind === 'add_creation' && op.from) throw Error('ZenUML creation uses the enclosing caller; omit from and insert it in that call')
        const mode = op.kind === 'add_call' ? 'sync' as const : 'create' as const
        const text = op.kind === 'add_call' ? op.method : `new ${op.to}${op.arguments === undefined ? '' : `(${op.arguments})`}`
        insert({ kind: 'message', id: 'new', ...(op.from ? { from: op.from } : {}), to: op.to, text, mode, children: [], ...(op.kind === 'add_call' && op.assignment ? { assignment: op.assignment, ...(op.assignmentType ? { assignmentType: op.assignmentType } : {}) } : {}) }, op.parentId, op.branchIndex, op.index); break
      }
      case 'add_region':
        insert({ kind: 'region', id: 'new', type: op.regionType, branches: [{ label: op.label ?? '', statements: [] }] }, op.parentId, op.branchIndex, op.index); break
      case 'add_branch': {
        const item = statement(op.id)
        if (item.kind !== 'region' || item.type !== 'alt' && item.type !== 'try') throw Error('Only conditional and try regions have additional branches')
        item.branches.push({ label: op.label, statements: [] }); break
      }
      case 'set_branch_label': {
        const item = statement(op.id)
        if (item.kind !== 'region' || !Number.isSafeInteger(op.branchIndex) || op.branchIndex < 0 || !item.branches[op.branchIndex]) throw Error('Region branch not found')
        item.branches[op.branchIndex]!.label = op.label; break
      }
      case 'add_return': insert({ kind: 'return', id: 'new', text: op.text }, op.parentId, op.branchIndex, op.index); break
      case 'add_comment': insert({ kind: 'comment', id: 'new', text: op.text }, op.parentId, op.branchIndex, op.index); break
      case 'set_message_text': {
        let found = false
        walkZenUml(next.statements, statement => { if (statement.id === op.id && statement.kind === 'message') { statement.text = op.text; found = true } })
        if (!found) throw Error(`Message ${op.id} not found`)
        break
      }
      case 'remove_statement': {
        let found = false
        const remove = (items: ZenUmlStatement[]): ZenUmlStatement[] => items.filter(item => { if (item.id === op.id) { found = true; return false } if (item.kind === 'message') item.children = remove(item.children); else if (item.kind === 'region') for (const branch of item.branches) branch.statements = remove(branch.statements); return true })
        next.statements = remove(next.statements); if (!found) throw Error(`Statement ${op.id} not found`); break
      }
      default: throw Error(unknownOpMessage('zenuml', op))
    }
    return ok(readNativeWrite(next, renderZenUml, parseZenUml, 'ZenUML', authored, projectZenUmlSequence))
  } catch (error) { return nativeMutationFailure(error) }
}
export const ZENUML_AGENT_HOOKS: FamilyOperations = {
  .../* @__PURE__ */ nativeDomainHooks('zenuml', 'ZenUML', parseZenUml, renderZenUml, mutateZenUml, body => { const labels = body.participants.map(item => ({ text: item.label, target: item.id })); if (body.title) labels.push({ text: body.title, target: 'title' }); walkZenUml(body.statements, statement => { if (statement.kind === 'message' || statement.kind === 'comment' || statement.kind === 'return') labels.push({ text: statement.text, target: statement.id }) }); return labels }, projectZenUmlSequence),
  verify: body => body.kind === 'zenuml' && !body.participants.length ? [{ code: 'EMPTY_DIAGRAM' }] : [],
}
