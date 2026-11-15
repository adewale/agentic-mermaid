/** Authored Zen semantics. Statement IDs are local editing addresses, assigned
 * in lexical order on parsing; participant IDs are authored identities. */
export interface ZenUMLParticipant {
  id: string
  label: string
  annotations: string[]
  stereotype?: string
  /** Comments on declarations are preserved but have no rendered note. */
  comments?: string[]
}
export interface ZenUMLAssignment { name: string; type?: string }
export interface ZenUMLBranch {
  kind: 'body' | 'else-if' | 'else' | 'catch' | 'finally'
  condition?: string
  statements: ZenUMLStatement[]
}
export type ZenUMLFragmentType = 'if' | 'opt' | 'while' | 'for' | 'forEach' | 'foreach' | 'loop' | 'par' | 'try' | 'critical'
export type ZenUMLStatement =
  | { kind: 'call'; id: string; from?: string; to?: string; label: string; assignment?: ZenUMLAssignment; children: ZenUMLStatement[] }
  | { kind: 'message'; id: string; from: string; to: string; label: string; reply: boolean }
  | { kind: 'create'; id: string; constructor: string; arguments?: string; assignment?: ZenUMLAssignment; children: ZenUMLStatement[] }
  | { kind: 'return'; id: string; label: string }
  | { kind: 'fragment'; id: string; type: ZenUMLFragmentType; condition?: string; branches: ZenUMLBranch[] }
  | { kind: 'comment'; id: string; text: string }
  | { kind: 'opaque'; id: string; source: string }
export interface ZenUMLBody {
  kind: 'zenuml'
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
  starter?: string
  /** Whole authored document retained when any construct is not modelled. */
  unsupportedSource?: string
  participants: ZenUMLParticipant[]
  statements: ZenUMLStatement[]
}
export type ZenUMLMutationOp =
  | { kind: 'upsert_participant'; participant: ZenUMLParticipant; index?: number }
  | { kind: 'remove_participant'; id: string }
  | { kind: 'rename_participant'; id: string; newId: string }
  | { kind: 'insert_statement'; statement: ZenUMLStatement; parentId?: string; branchIndex?: number; index?: number }
  | { kind: 'remove_statement'; id: string }
  | { kind: 'set_statement'; id: string; statement: ZenUMLStatement }
  | { kind: 'set_title'; title?: string }
  | { kind: 'set_accessibility_title'; title?: string }
  | { kind: 'set_accessibility_description'; description?: string }
