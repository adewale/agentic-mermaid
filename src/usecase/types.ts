import type { PositionedGraph } from '../types.ts'
import type { Actor, ClassDef, Relationship, SystemBoundary, UseCase, UsecaseJsonNode, UsecaseNote } from './grammar/types.ts'
export type UsecaseNode = ({ kind: 'actor' } & Actor) | ({ kind: 'usecase' } & UseCase)
export interface UsecaseBody {
  kind: 'usecase'
  direction: 'TB' | 'BT' | 'LR' | 'RL'
  nodes: UsecaseNode[]
  boundaries: SystemBoundary[]
  relationships: Relationship[]
  notes: UsecaseNote[]
  jsonNodes: (Omit<UsecaseJsonNode, 'propertyOrder'> & { propertyOrder: [string, string[]][] })[]
  classDefs: ClassDef[]
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
}
export type UsecaseMutationOp =
  | { kind: 'add_actor'; id: string; label?: string; parentId?: string }
  | { kind: 'add_usecase'; id: string; label?: string; parentId?: string; shape?: 'ellipse' | 'rect' }
  | { kind: 'add_boundary'; id: string; label?: string; boundaryType?: 'rect' | 'package' }
  | { kind: 'remove_node'; id: string; cascade?: boolean }
  | { kind: 'set_label'; id: string; label: string }
  | { kind: 'move_node'; id: string; parentId: string | null }
  | { kind: 'add_relationship'; from: string; to: string; id?: string; relation?: 'association' | 'include' | 'extend' | 'generalization'; label?: string }
  | { kind: 'remove_relationship'; id: string }
  | { kind: 'set_direction'; direction: UsecaseBody['direction'] }
  | { kind: 'set_title'; title: string | null }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }
export interface PositionedUsecase extends PositionedGraph {
  body: UsecaseBody
}
