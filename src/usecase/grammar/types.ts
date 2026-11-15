// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
export type LabelType = 'text' | 'markdown'
export type ActorType = 'normal' | 'hollow' | 'awesome' | 'icon'
export type UseCaseShape = 'ellipse' | 'rect'
export type BoundaryType = 'rect' | 'package'
export type RelationshipType = 'association' | 'include' | 'extend' | 'generalization'
export type Animation = 'fast' | 'slow'
export type Direction = 'TB' | 'TD' | 'BT' | 'RL' | 'LR'
export type SymbolKind = 'actor' | 'usecase' | 'boundary' | 'json' | 'edge'

// Start and end offsets in the source, end exclusive.
export type Span = [start: number, end: number]

export interface Actor {
  id: string
  label: string
  labelType: LabelType
  type: ActorType
  icon?: string
  business: boolean
  stereotype?: string
  parentId?: string
  classes: string[]
  styles: string[]
}

export interface UseCase {
  id: string
  label: string
  labelType: LabelType
  shape: UseCaseShape
  business: boolean
  stereotype?: string
  parentId?: string
  classes: string[]
  styles: string[]
}

export interface SystemBoundary {
  id: string
  label: string
  labelType: LabelType
  type: BoundaryType
  members: string[]
  classes: string[]
  styles: string[]
}

export const enum Arrow {
  SOLID_ARROW,
  BACK_ARROW,
  LINE_SOLID,
  CIRCLE_ARROW,
  CROSS_ARROW,
  CIRCLE_ARROW_REVERSED,
  CROSS_ARROW_REVERSED,
}

export interface Relationship {
  id: string
  explicitId: boolean
  source: string
  target: string
  type: RelationshipType
  arrowType: number
  label?: string
  labelType?: LabelType
  minlen: number
  classes: string[]
  styles: string[]
  animate: boolean
  animation?: Animation
}

export interface UsecaseNote {
  id: string
  target: string
  label: string
  labelType: LabelType
}

export interface UsecaseJsonNode {
  id: string
  value: Record<string, unknown>
  // The keys of each object in the order they were written, by JSON Pointer.
  propertyOrder: Map<string, string[]>
  classes: string[]
  styles: string[]
}

export interface ClassDef {
  id: string
  styles: string[]
}

export interface MetadataOccurrence {
  key: string
  span: Span
  keySpan: Span
  valueSpan: Span
}

export interface NodeOccurrence {
  id: string
  span: Span
  idSpan: Span
  labelSpan?: Span
  defines?: boolean
  stereotypeSpan?: Span
  metadata?: MetadataOccurrence[]
  classSpans?: Span[]
}

export interface EdgeOccurrence {
  id: string
  span: Span
  labelSpan?: Span
  idSpan?: Span
  metadata?: MetadataOccurrence[]
}

// One statement of the source with the positions of its parts, as in Mermaid's use case AST.
export interface GraphStatement {
  kind: 'node' | 'edge' | 'group' | 'note' | 'json' | 'metadata' | 'edgeMetadata' | 'classDef' | 'classAssign' | 'style' | 'direction' | 'accTitle' | 'accDescr' | 'comment' | 'blank'
  span: Span
  nodes?: NodeOccurrence[]
  edges?: EdgeOccurrence[]
  group?: string
  idSpan?: Span
  titleSpan?: Span
  endSpan?: Span
  ref?: string
  refSpan?: Span
  children?: GraphStatement[]
  metadata?: MetadataOccurrence[]
  classSpans?: Span[]
}

export interface UsecaseModel {
  type: 'usecase'
  actors: Map<string, Actor>
  useCases: Map<string, UseCase>
  systemBoundaries: Map<string, SystemBoundary>
  relationships: Relationship[]
  notes: Map<string, UsecaseNote>
  jsonNodes: Map<string, UsecaseJsonNode>
  classDefs: Map<string, ClassDef>
  direction: Direction
  title?: string
  accTitle: string
  accDescr: string
  // The accessible description as written, before the indentation of its lines is dropped.
  accDescription: string
  source: string
  headerSpan: Span
  statements: GraphStatement[]
}

export function emptyModel(): UsecaseModel {
  return {
    type: 'usecase',
    actors: new Map(),
    useCases: new Map(),
    systemBoundaries: new Map(),
    relationships: [],
    notes: new Map(),
    jsonNodes: new Map(),
    classDefs: new Map(),
    direction: 'LR',
    title: undefined,
    accTitle: '',
    accDescr: '',
    accDescription: '',
    source: '',
    headerSpan: [0, 0],
    statements: [],
  }
}
