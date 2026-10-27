import type { SequenceActorType } from '../sequence/types.ts'
export interface ZenUmlParticipant { id: string; label: string; type: SequenceActorType }
export interface ZenUmlMessage {
  kind: 'message'; id: string; from?: string; to: string; text: string
  mode: 'sync' | 'async' | 'reply' | 'create'
  assignment?: string
  assignmentType?: string
  children: ZenUmlStatement[]
}
export interface ZenUmlRegion {
  kind: 'region'; id: string; type: 'loop' | 'alt' | 'opt' | 'par' | 'try'
  branches: { label: string; statements: ZenUmlStatement[] }[]
}
export type ZenUmlStatement = ZenUmlMessage | ZenUmlRegion | { kind: 'return'; id: string; text: string } | { kind: 'comment'; id: string; text: string }
export interface ZenUmlBody {
  kind: 'zenuml'; title?: string; accessibilityTitle?: string; accessibilityDescription?: string
  participants: ZenUmlParticipant[]
  statements: ZenUmlStatement[]
}
export type ZenUmlMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_participant'; id: string; label?: string; participantType?: SequenceActorType; index?: number }
  | { kind: 'set_participant_label'; id: string; label: string }
  | { kind: 'rename_participant'; from: string; to: string }
  | { kind: 'add_message'; from: string; to: string; text: string; mode?: 'async' | 'reply'; parentId?: string; branchIndex?: number; index?: number }
  | { kind: 'add_call'; from?: string; to: string; method: string; assignment?: string; assignmentType?: string; parentId?: string; branchIndex?: number; index?: number }
  | { kind: 'add_creation'; from?: string; to: string; arguments?: string; parentId?: string; branchIndex?: number; index?: number }
  | { kind: 'add_region'; regionType: ZenUmlRegion['type']; label?: string; parentId?: string; branchIndex?: number; index?: number }
  | { kind: 'add_branch'; id: string; label: string }
  | { kind: 'set_branch_label'; id: string; branchIndex: number; label: string }
  | { kind: 'add_return'; parentId: string; text: string; branchIndex?: number; index?: number }
  | { kind: 'add_comment'; parentId?: string; text: string; branchIndex?: number; index?: number }
  | { kind: 'set_message_text'; id: string; text: string }
  | { kind: 'remove_statement'; id: string }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }
