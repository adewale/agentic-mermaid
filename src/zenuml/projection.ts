import type { ZenUmlBody, ZenUmlStatement } from './types.ts'
import type { Block, SequenceDiagram, Message } from '../sequence/types.ts'
import { setSequenceBlockBoundaries, setSequenceBlockScope, type SequenceBlockBoundary, type SequenceBlockScope } from '../sequence/block-structure.ts'

/** ZenUML owns call-stack meaning; the sequence adapter owns pixel geometry. */
export function projectZenUmlSequence(body: ZenUmlBody): SequenceDiagram {
  const diagram: SequenceDiagram = { ...(body.title ? { title: body.title } : {}), accessibilityTitle: body.accessibilityTitle, accessibilityDescription: body.accessibilityDescription, actors: body.participants.map(item => ({ ...item })), messages: [], notes: [], blocks: [] }
  const boundaries: Array<Omit<SequenceBlockBoundary, 'blockIndex'> & { block: Block }> = []
  const scopes: Array<{ block: Block; scope: SequenceBlockScope }> = []
  const boundary = (kind: SequenceBlockBoundary['kind'], block: Block, dividerIndex?: number) => boundaries.push({ kind, block, messageIndex: diagram.messages.length, noteIndex: diagram.notes.length, ...(dividerIndex === undefined ? {} : { dividerIndex }) })
  const caller = '$zenuml:external'
  const external = () => { if (!diagram.actors.some(item => item.id === caller)) diagram.actors.unshift({ id: caller, label: 'Caller', type: 'actor' }); return caller }
  const add = (from: string, to: string, label: string, mode: 'sync' | 'async' | 'reply' | 'create', activation = false) => {
    const message: Message = { from, to, label, lineStyle: mode === 'reply' ? 'dashed' : 'solid', startHead: 'none', endHead: mode === 'reply' || mode === 'async' ? 'open' : 'filled', centralStart: false, centralEnd: false, ...(activation ? { activate: true } : {}) }
    diagram.messages.push(message)
  }
  const returnsHere = (items: readonly ZenUmlStatement[]): boolean => items.some(item => item.kind === 'return' || item.kind === 'region' && item.branches.some(branch => returnsHere(branch.statements)))
  const visit = (statements: readonly ZenUmlStatement[], current?: string, parent?: string, assignment?: string) => {
    for (const statement of statements) {
      if (statement.kind === 'comment') {
        const next = statements[statements.indexOf(statement) + 1]
        if (next && next.kind !== 'comment') {
          const noteIndex = diagram.notes.length
          diagram.notes.push({ actorIds: [current ?? (next.kind === 'message' ? next.from ?? next.to : body.participants[0]?.id ?? external())], text: statement.text, position: 'over', afterIndex: diagram.messages.length - 1 })
          for (const { scope } of scopes) scope.noteIndices.push(noteIndex)
        }
        continue
      }
      if (statement.kind === 'return') {
        if (!current || !parent) throw Error('ZenUML return needs an enclosing synchronous or creation call')
        add(current, parent, assignment ? `${assignment} = ${statement.text}` : statement.text, 'reply')
        continue
      }
      if (statement.kind === 'region') {
        const startIndex = diagram.messages.length
        const block: Block = { type: statement.type === 'try' ? 'critical' : statement.type, label: statement.branches[0]?.label ?? '', startIndex, endIndex: startIndex, dividers: [] }
        const scope: SequenceBlockScope = { endMessageExclusive: startIndex, endNoteExclusive: diagram.notes.length, dividerNoteIndices: [], noteIndices: [], childBlockIndices: [], childSectionIndices: [] }
        const parentSection = scopes.at(-1)?.block.dividers.length ?? 0
        scopes.push({ block, scope })
        boundary('open', block)
        const divide = (label: string) => {
          boundary('divider', block, block.dividers.length)
          scope.dividerNoteIndices.push(diagram.notes.length)
          block.dividers.push({ index: diagram.messages.length, label })
        }
        for (const [index, branch] of statement.branches.entries()) {
          if (index) divide(branch.label)
          if (statement.type === 'par') {
            let pending: ZenUmlStatement[] = [], section = 0
            for (const child of branch.statements) {
              pending.push(child)
              if (child.kind === 'comment') continue
              if (section++) divide('')
              visit(pending, current, parent, assignment)
              pending = []
            }
          } else visit(branch.statements, current, parent, assignment)
        }
        boundary('close', block)
        block.endIndex = Math.max(diagram.messages.length - 1, startIndex)
        scope.endMessageExclusive = diagram.messages.length
        scope.endNoteExclusive = diagram.notes.length
        setSequenceBlockScope(block, scope)
        scopes.pop()
        const parentScope = scopes.at(-1)?.scope
        if (parentScope) {
          parentScope.childBlockIndices.push(diagram.blocks.length)
          parentScope.childSectionIndices.push(parentSection)
        }
        diagram.blocks.push(block)
        continue
      }
      const from = statement.from ?? current ?? external(), to = statement.to, index = diagram.messages.length
      const label = statement.mode === 'create' ? statement.text : statement.text
      add(from, to, label, statement.mode, statement.mode === 'sync' && statement.children.length > 0)
      if (statement.mode === 'create') {
        const actor = diagram.actors.find(item => item.id === to)
        if (actor?.createMessageIndex !== undefined) throw Error(`ZenUML participant ${to} is created more than once`)
        if (actor) actor.createMessageIndex = index
      }
      const assigned = statement.assignment ? `${statement.assignmentType ? `${statement.assignmentType} ` : ''}${statement.assignment}` : undefined
      visit(statement.children, to, from, assigned)
      if (assigned && !returnsHere(statement.children)) add(to, from, assigned, 'reply')
      if (statement.mode === 'sync' && statement.children.length) (diagram.activationEvents ??= []).push({ actorId: to, kind: 'deactivate', messageIndex: diagram.messages.length })
    }
  }
  visit(body.statements)
  const blockIndices = new Map(diagram.blocks.map((block, index) => [block, index]))
  setSequenceBlockBoundaries(diagram, boundaries.map(({ block, ...event }) => ({ ...event, blockIndex: blockIndices.get(block)! })))
  return diagram
}
