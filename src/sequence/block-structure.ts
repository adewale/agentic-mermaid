import type { Block, SequenceDiagram } from './types.ts'

/** Lexical ownership cannot be recovered from message ranges alone: empty
 * regions and notes in adjacent branches can share the same message cursor. */
export interface SequenceBlockScope {
  endMessageExclusive: number
  endNoteExclusive: number
  /** Note cursor at each divider, aligned with block.dividers. */
  dividerNoteIndices: number[]
  /** Notes in this lexical scope, including nested descendants. */
  noteIndices: number[]
  /** Direct children in diagram.blocks and their containing branch indices. */
  childBlockIndices: number[]
  childSectionIndices: number[]
}

export interface SequenceBlockBoundary {
  kind: 'open' | 'divider' | 'close'
  blockIndex: number
  messageIndex: number
  noteIndex: number
  dividerIndex?: number
}

const blockScopes = new WeakMap<Block, SequenceBlockScope>()
const blockBoundaries = new WeakMap<SequenceDiagram, SequenceBlockBoundary[]>()

export function getSequenceBlockBoundaries(diagram: SequenceDiagram): readonly SequenceBlockBoundary[] | undefined {
  return blockBoundaries.get(diagram)
}

export function getSequenceBlockScope(block: Block): SequenceBlockScope | undefined {
  return blockScopes.get(block)
}

/** Internal producers publish structure after completing the corresponding
 * block/diagram. These records are shared by pixel and terminal consumers. */
export function setSequenceBlockScope(block: Block, scope: SequenceBlockScope): void {
  blockScopes.set(block, scope)
}

export function setSequenceBlockBoundaries(diagram: SequenceDiagram, boundaries: SequenceBlockBoundary[]): void {
  blockBoundaries.set(diagram, boundaries)
}
