// ============================================================================
// Class diagram types
//
// Models the parsed and positioned representations of a Mermaid class diagram.
// Class diagrams show UML class relationships, inheritance, composition, etc.
// ============================================================================

import type { PositionedDiagram, Direction } from '../types.ts'

/** Parsed class diagram — logical structure from mermaid text */
export interface ClassDiagram {
  /** Optional accessibility title (Mermaid accTitle) */
  accessibilityTitle?: string
  /** Optional accessibility description (Mermaid accDescr) */
  accessibilityDescription?: string
  /** Layout direction from a `direction TB|BT|LR|RL` statement (default TB). */
  direction?: Direction
  /** All class definitions */
  classes: ClassNode[]
  /** Relationships between classes */
  relationships: ClassRelationship[]
  /** Top-level namespace groupings (each may nest children) */
  namespaces: ClassNamespace[]
}

export interface ClassNode {
  /** Stable bare identity; Mermaid `~T~` parameters are stored separately. */
  id: string
  label: string
  /** Generic type parameter text from `ClassName~T~`. */
  generic?: string
  /** Annotation like <<interface>>, <<abstract>>, <<service>>, <<enumeration>> */
  annotation?: string
  /** Class attributes (fields/properties) */
  attributes: ClassMember[]
  /** Class methods (functions) */
  methods: ClassMember[]
}

export interface ClassMember {
  /** Visibility: + public, - private, # protected, ~ package */
  visibility: '+' | '-' | '#' | '~' | ''
  /** Member name */
  name: string
  /** Type annotation (e.g., "String", "int", "void") */
  type?: string
  /** Whether the member is static (underlined in UML) */
  isStatic?: boolean
  /** Whether the member is abstract (italic in UML) */
  isAbstract?: boolean
  /** Whether the member is a method (renders with parentheses) */
  isMethod?: boolean
  /** Method parameters (e.g., "data", "key, val") — only for methods */
  params?: string
}

/** Relationship types following UML conventions */
export type RelationshipType =
  | 'inheritance'   // A <|-- B   (solid line, hollow triangle)
  | 'composition'   // A *-- B    (solid line, filled diamond)
  | 'aggregation'   // A o-- B    (solid line, hollow diamond)
  | 'association'   // A --> B    (solid line, open arrow)
  | 'dependency'    // A ..> B    (dashed line, open arrow)
  | 'realization'   // A ..|> B   (dashed line, hollow triangle)

export interface ClassRelationship {
  from: string
  to: string
  type: RelationshipType
  /**
   * Which end of the relationship line has the UML marker (triangle, diamond, arrow).
   * Determined by the arrow syntax direction:
   *   - Prefix markers like `<|--`, `*--`, `o--` → 'from' (marker on left/from side)
   *   - Suffix markers like `..|>`, `-->`, `..>`, `--*`, `--o` → 'to' (marker on right/to side)
   */
  markerAt: 'from' | 'to'
  /** Label on the relationship line */
  label?: string
  /** Cardinality at the "from" end (e.g., "1", "*", "0..1") */
  fromCardinality?: string
  /** Cardinality at the "to" end */
  toCardinality?: string
}

/**
 * A namespace grouping (upstream: `namespace X { class A }`). Nesting follows
 * upstream Mermaid: syntactic (`namespace A { namespace B { … } }`) and dot
 * notation (`namespace A.B.C` auto-creates `A` and `A.B` as parents). `name`
 * is the SEGMENT name; the full path is the ancestor chain joined with dots.
 */
export interface ClassNamespace {
  name: string
  /** Optional display label from `namespace X["Label"]` (upstream v11.15+). */
  label?: string
  /** Ids of classes declared directly in this namespace. */
  classIds: string[]
  /** Nested child namespaces. */
  children: ClassNamespace[]
}

// ============================================================================
// Positioned class diagram — ready for SVG rendering
// ============================================================================

export interface PositionedClassDiagram extends PositionedDiagram {
  width: number
  height: number
  accessibilityTitle?: string
  accessibilityDescription?: string
  classes: PositionedClassNode[]
  relationships: PositionedClassRelationship[]
  /** Namespace boxes, flattened parent-first, in absolute coordinates. */
  namespaces: PositionedClassNamespace[]
}

/** A laid-out namespace box (ELK compound node), absolute coordinates. */
export interface PositionedClassNamespace {
  /** Full dot path (unique id), e.g. 'Company.Engineering.Backend'. */
  id: string
  /** Segment name (last path element). */
  name: string
  /** Display label to draw in the header (label ?? name). */
  label: string
  /** Parent namespace's full path (undefined = top-level). */
  parentId?: string
  /** Ids of classes declared directly in this namespace. */
  classIds: string[]
  x: number
  y: number
  width: number
  height: number
  /** Height of the header band carrying the label. */
  headerHeight: number
}

export interface PositionedClassNode {
  id: string
  label: string
  annotation?: string
  attributes: ClassMember[]
  methods: ClassMember[]
  x: number
  y: number
  width: number
  height: number
  /** Height of the header section (name + annotation) */
  headerHeight: number
  /** Height of the attributes section */
  attrHeight: number
  /** Height of the methods section */
  methodHeight: number
}

export interface PositionedClassRelationship {
  from: string
  to: string
  type: RelationshipType
  /** Which end of the line has the UML marker — propagated from ClassRelationship */
  markerAt: 'from' | 'to'
  label?: string
  fromCardinality?: string
  toCardinality?: string
  /** Path points from source to target */
  points: Array<{ x: number; y: number }>
  /** Dagre-computed label center position (avoids overlaps between nearby edges) */
  labelPosition?: { x: number; y: number }
}
