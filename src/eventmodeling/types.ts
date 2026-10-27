export type EventModelingEntityType = 'ui' | 'processor' | 'command' | 'readmodel' | 'event'
export interface EventModelingData { type?: 'json' | 'jsobj' | 'figma' | 'salt' | 'uri' | 'md' | 'html' | 'text'; text: string }
export interface EventModelingFrame {
  id: string
  entityType: EventModelingEntityType
  entity: string
  reset: boolean
  sources: string[]
  dataReference?: string
  data?: EventModelingData
}
export interface EventModelingSpecification {
  frame: string
  given: { entityType: EventModelingEntityType; entity: string }[]
  when: { entityType: EventModelingEntityType; entity: string }[]
  then: { entityType: EventModelingEntityType; entity: string }[]
}
export interface EventModelingBody {
  kind: 'eventmodeling'
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
  frames: EventModelingFrame[]
  entities: string[]
  data: { id: string; value: EventModelingData }[]
  notes: { frame: string; text: string; type?: EventModelingData['type'] }[]
  specifications: EventModelingSpecification[]
}
export type EventModelingMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_frame'; id: string; entityType: EventModelingEntityType; entity: string; reset?: boolean; sources?: string[]; index?: number }
  | { kind: 'rename_frame'; from: string; to: string }
  | { kind: 'add_entity'; entity: string }
  | { kind: 'remove_entity'; entity: string; cascade?: boolean }
  | { kind: 'set_specification'; frame: string; given: EventModelingSpecification['given']; when?: EventModelingSpecification['when']; then: EventModelingSpecification['then']; occurrence?: number }
  | { kind: 'remove_specification'; frame: string; occurrence?: number }
  | { kind: 'set_note'; index: number; text: string; dataType?: EventModelingData['type'] | null }
  | { kind: 'remove_note'; index: number }
  | { kind: 'remove_frame'; id: string; cascade?: boolean }
  | { kind: 'set_frame_entity'; id: string; entity: string; entityType?: EventModelingEntityType }
  | { kind: 'set_frame_sources'; id: string; sources: string[]; reset?: boolean }
  | { kind: 'move_frame'; id: string; index: number }
  | { kind: 'set_frame_data'; id: string; text: string | null; dataType?: EventModelingData['type'] | null; reference?: string | null }
  | { kind: 'set_data'; id: string; text: string; dataType?: EventModelingData['type'] | null }
  | { kind: 'add_note'; frame: string; text: string; dataType?: EventModelingData['type'] }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }
