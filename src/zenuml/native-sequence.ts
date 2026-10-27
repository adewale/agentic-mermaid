import type { Actor, Block, Message, Note, SequenceDiagram } from '../sequence/types.ts'
import { setSequenceBlockBoundaries, setSequenceBlockScope, type SequenceBlockBoundary, type SequenceBlockScope } from '../sequence/parser.ts'
import { prepareDisplayText, type LabelContent } from '../shared/display-text.ts'
import { normalizeMarkdownEmphasis } from '../multiline-utils.ts'
import { validateZenUML, walkZenUML } from './native-body.ts'
import type { ZenUMLAssignment, ZenUMLBody, ZenUMLStatement } from './native-types.ts'

const actorTypes: Record<string, Actor['type']> = { actor: 'actor', boundary: 'boundary', control: 'control', entity: 'entity', database: 'database', collections: 'collections', queue: 'queue', participant: 'participant' }
const literal = (value: string): LabelContent => ({ value, prepared: prepareDisplayText(value, 'literal') })
interface Context { owner?: string; returnTo?: string; parentId?: string; blockIndex?: number; section: number }

/** Project call-stack semantics directly into the existing sequence model.
 * No vendor DOM, alternate layout engine, or Mermaid string round trip. */
export function projectZenUMLSequence(body: ZenUMLBody): SequenceDiagram {
  validateZenUML(body, true)
  const sequence: SequenceDiagram = { actors: [], messages: [], blocks: [], notes: [], activationEvents: [], boxes: [], ...(body.title === undefined ? {} : { title: body.title, titleContent: literal(body.title) }), ...(body.accessibilityTitle === undefined ? {} : { accessibilityTitle: body.accessibilityTitle }), ...(body.accessibilityDescription === undefined ? {} : { accessibilityDescription: body.accessibilityDescription }) }
  const byId = new Map<string, Actor>(), reserved = new Set(body.participants.map(p => p.id))
  if (body.starter) reserved.add(body.starter)
  walkZenUML(body.statements, s => {
    reserved.add(s.id)
    if (s.kind === 'call' || s.kind === 'message') { if (s.from) reserved.add(s.from); if (s.to) reserved.add(s.to) }
    if (s.kind === 'create') reserved.add(creationOwner(s))
  })
  let externalId = 'zenuml:outside'
  while (reserved.has(externalId)) externalId += ':'
  const derivedId = (base: string) => { let id = base; while (reserved.has(id)) id += ':'; reserved.add(id); return id }
  const actor = (id: string | undefined): string => {
    const identity = id ?? externalId
    if (!byId.has(identity)) {
      const value: Actor = { id: identity, label: id === undefined ? '' : id, type: 'participant', labelContent: literal(id ?? ''), ...(id === undefined ? { external: true } : {}) }
      sequence.actors.push(value); byId.set(identity, value)
    }
    return identity
  }
  for (const p of body.participants) {
    actor(p.id)
    const target = byId.get(p.id)!
    target.type = p.annotations.map(a => actorTypes[a.toLowerCase()]).find(Boolean) ?? 'participant'
    const extra = [...p.annotations.filter(a => !actorTypes[a.toLowerCase()]).map(a => `@${a}`), ...(p.stereotype ? [p.stereotype] : [])]
    target.label = [...extra.map(value => `«${value}»`), p.label].join('\n')
    target.labelContent = literal(target.label)
  }
  // An authored outside caller provides the origin for following implicit
  // root calls. Absence remains an external endpoint, never an invented actor.
  let starter = body.starter
  if (starter === undefined) for (const s of body.statements) {
    if (s.kind === 'message' || s.kind === 'call' && s.from !== undefined) { starter = s.from; break }
    if (s.kind !== 'comment') break
  }
  if (starter !== undefined) actor(starter)
  const boundaries: SequenceBlockBoundary[] = [], scopes = new Map<number, SequenceBlockScope>(), openScopes: number[] = []
  const addMessage = (id: string, from: string | undefined, to: string | undefined, label: string, context: Context, reply = false, activate = false) => {
    const source = actor(from), target = actor(to)
    const message: Message = { id, ...(context.parentId ? { parentId: context.parentId } : {}), from: source, to: target, label, labelContent: literal(label), lineStyle: reply ? 'dashed' : 'solid', startHead: 'none', endHead: reply ? 'open' : 'filled', centralStart: false, centralEnd: false, ...(activate && source !== target ? { activate: true } : {}) }
    sequence.messages.push(message)
  }
  const addNote = (id: string, text: string, ids: string[], context: Context) => {
    const label = normalizeMarkdownEmphasis(text)
    const note: Note = { id, ...(context.parentId ? { parentId: context.parentId } : {}), actorIds: [...new Set(ids.length ? ids : [actor(context.owner)])], text: label, textContent: { value: label, authored: text, prepared: prepareDisplayText(label, 'formatted') }, position: 'over', afterIndex: sequence.messages.length - 1 }
    const index = sequence.notes.length
    sequence.notes.push(note)
    for (const block of openScopes) scopes.get(block)!.noteIndices.push(index)
  }
  const directReturns = (values: ZenUMLStatement[]): boolean => values.some(s => s.kind === 'return' || s.kind === 'message' && s.reply || s.kind === 'fragment' && s.branches.some(branch => directReturns(branch.statements)))
  const visit = (values: readonly ZenUMLStatement[], context: Context) => {
    let pending: Extract<ZenUMLStatement, { kind: 'comment' }>[] = []
    const comments = (ids: string[]) => { for (const note of pending) addNote(note.id, note.text, ids, context); pending = [] }
    for (const s of values) {
      if (s.kind === 'comment') { pending.push(s); continue }
      switch (s.kind) {
        case 'call': {
          const from = s.from ?? context.owner, to = s.to ?? context.owner
          const source = actor(from), target = actor(to)
          comments([source, target])
          const self = source === target
          addMessage(s.id, from, to, self && s.assignment ? `${assignmentLabel(s.assignment)} = ${s.label}` : s.label, context, false, true)
          visit(s.children, { ...context, owner: to, returnTo: from })
          if (s.assignment && !self && !directReturns(s.children)) addMessage(derivedId(`${s.id}:reply`), to, from, assignmentLabel(s.assignment), context, true)
          if (!self) sequence.activationEvents!.push({ actorId: target, kind: 'deactivate', messageIndex: sequence.messages.length })
          break
        }
        case 'create': {
          const target = creationOwner(s), source = actor(context.owner)
          actor(target)
          comments([source, target])
          const participant = byId.get(target)!
          if (participant.createMessageIndex !== undefined) throw Error(`Repeated creation of ZenUML object ${target} cannot share one sequence lifeline`)
          participant.createMessageIndex = sequence.messages.length
          addMessage(s.id, context.owner, target, `«${s.arguments || 'create'}»`, context, false, true)
          visit(s.children, { ...context, owner: target, returnTo: context.owner })
          if (s.assignment && !directReturns(s.children)) addMessage(derivedId(`${s.id}:reply`), target, context.owner, assignmentLabel(s.assignment), context, true)
          sequence.activationEvents!.push({ actorId: target, kind: 'deactivate', messageIndex: sequence.messages.length })
          break
        }
        case 'message':
          comments([actor(s.from), actor(s.to)])
          addMessage(s.id, s.from, s.to, s.label, context, s.reply)
          sequence.messages.at(-1)!.endHead = 'open'
          break
        case 'return':
          comments([actor(context.owner), actor(context.returnTo)])
          addMessage(s.id, context.owner, context.returnTo, s.label, context, true)
          break
        case 'fragment': {
          if (pending.length) comments([actor(context.owner)])
          const index = sequence.blocks.length
          const type: Block['type'] = s.type === 'if' ? 'alt' : s.type === 'par' ? 'par' : s.type === 'opt' ? 'opt' : s.type === 'try' ? 'break' : s.type === 'critical' ? 'critical' : 'loop'
          const label = ['if', 'opt', 'par', 'critical'].includes(s.type) ? s.condition ?? '' : `${s.type}${s.condition === undefined ? '' : ` (${s.condition})`}`
          const block: Block = { id: s.id, ...(context.parentId ? { parentId: context.parentId } : {}), type, label, labelContent: literal(label), startIndex: sequence.messages.length, endIndex: sequence.messages.length - 1, dividers: [] }
          sequence.blocks.push(block)
          const scope: SequenceBlockScope = { endMessageExclusive: 0, endNoteExclusive: 0, dividerNoteIndices: [], noteIndices: [], childBlockIndices: [], childSectionIndices: [] }
          scopes.set(index, scope)
          if (context.blockIndex !== undefined) { const parent = scopes.get(context.blockIndex)!; parent.childBlockIndices.push(index); parent.childSectionIndices.push(context.section) }
          boundaries.push({ kind: 'open', blockIndex: index, messageIndex: sequence.messages.length, noteIndex: sequence.notes.length })
          openScopes.push(index)
          const branches = s.type === 'par' ? parallelBranches(s.branches[0]!.statements) : s.branches
          for (const [section, branch] of branches.entries()) {
            if (section) {
              const label = branch.kind === 'else-if' ? `else if (${branch.condition ?? ''})` : branch.kind === 'body' ? '' : `${branch.kind}${branch.condition === undefined ? '' : ` (${branch.condition})`}`
              const dividerIndex = block.dividers.length
              block.dividers.push({ index: sequence.messages.length, label, labelContent: literal(label) })
              scope.dividerNoteIndices.push(sequence.notes.length)
              boundaries.push({ kind: 'divider', blockIndex: index, dividerIndex, messageIndex: sequence.messages.length, noteIndex: sequence.notes.length })
            }
            visit(branch.statements, { ...context, parentId: s.id, blockIndex: index, section })
          }
          openScopes.pop()
          block.endIndex = sequence.messages.length - 1
          scope.endMessageExclusive = sequence.messages.length; scope.endNoteExclusive = sequence.notes.length
          setSequenceBlockScope(block, scope)
          boundaries.push({ kind: 'close', blockIndex: index, messageIndex: sequence.messages.length, noteIndex: sequence.notes.length })
          break
        }
        case 'opaque': throw Error('Unsupported ZenUML syntax cannot be projected partially')
      }
    }
    if (pending.length) comments([actor(context.owner)])
  }
  visit(body.statements, { owner: starter, section: 0 })
  // Fragment-only and note-only diagrams still need a layout anchor. It is
  // explicitly external and has no participant header or lifeline.
  if (!sequence.actors.length && (sequence.blocks.length || sequence.notes.length)) actor(undefined)
  setSequenceBlockBoundaries(sequence, boundaries)
  return sequence
}
function assignmentLabel(value: ZenUMLAssignment): string { return value.type === undefined ? value.name : `${value.name}:${value.type}` }
function creationOwner(value: Extract<ZenUMLStatement, { kind: 'create' }>): string { return value.assignment ? `${value.assignment.name}:${value.constructor}` : value.constructor }
function parallelBranches(statements: ZenUMLStatement[]) {
  const branches: Array<{ kind: 'body'; statements: ZenUMLStatement[] }> = []
  let pending: ZenUMLStatement[] = []
  for (const statement of statements) {
    pending.push(statement)
    if (statement.kind !== 'comment') { branches.push({ kind: 'body', statements: pending }); pending = [] }
  }
  if (pending.length || !branches.length) branches.push({ kind: 'body', statements: pending })
  return branches
}
