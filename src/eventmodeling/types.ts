export type EventFrameType = 'ui' | 'processor' | 'command' | 'readmodel' | 'event'
export interface EventData {
  type?: string
  text: string
}
export interface EventFrame {
  id: string
  reset: boolean
  type: EventFrameType
  entity: string
  sources: string[]
  dataReference?: string
  data?: EventData
}
export interface EventSpecification {
  frame: string
  given: Array<{ type: EventFrameType; entity: string }>
  when: Array<{ type: EventFrameType; entity: string }>
  then: Array<{ type: EventFrameType; entity: string }>
}
export interface EventModelingBody {
  kind: 'eventmodeling'
  frames: EventFrame[]
  entities: string[]
  data: Record<string, EventData>
  notes: Array<{ frame: string; data: EventData }>
  specifications: EventSpecification[]
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
}
export type EventModelingMutationOp =
  | { kind: 'insert_frame'; frame: EventFrame; index?: number }
  | { kind: 'remove_frame'; id: string }
  | { kind: 'move_frame'; id: string; index: number }
  | { kind: 'set_frame'; id: string; frame: EventFrame }
  | { kind: 'set_data'; id: string; data: EventData }
  | { kind: 'set_entities'; entities: string[] }
  | { kind: 'set_notes'; notes: EventModelingBody['notes'] }
  | { kind: 'set_specifications'; specifications: EventSpecification[] }
  | { kind: 'set_title'; title?: string }
  | { kind: 'set_accessibility_title'; title?: string }
  | { kind: 'set_accessibility_description'; description?: string }
