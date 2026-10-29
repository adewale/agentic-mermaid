import type { LabelContent } from '../shared/display-text.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
// ============================================================================
// Class diagram types
//
// Models the parsed and positioned representations of a Mermaid class diagram.
// Class diagrams show UML class relationships, inheritance, composition, etc.
// ============================================================================

import type { PositionedDiagramTitle } from '../styles.ts'
import type { Direction, PositionedDiagram } from '../types.ts'

/** Parsed class diagram — logical structure from mermaid text */
export interface ClassDiagram {
  /** The diagram's title (frontmatter `title:`). */
  title?: string
  /** Optional accessibility title (Mermaid accTitle) */
  accessibilityTitle?: string
  /** Optional accessibility description (Mermaid accDescr) */
  accessibilityDescription?: string
  /** Layout direction from a `direction TB|BT|LR|RL` statement (default TB). */
  direction?: Direction
  /** All class definitions */
  classes: ClassNode[]
  /** Mermaid classDef paint declarations. */
  classDefs: Map<string, Record<string, string>>
  /** Relationships between classes */
  relationships: ClassRelationship[]
  /** UML notes, optionally anchored to one class. */
  notes: ClassNote[]
  /** Top-level namespace groupings (each may nest children) */
  namespaces: ClassNamespace[]
}

export interface ClassNode {
  /** Independent named lollipop endpoint, with no class compartments. */
  isInterface?: boolean
  /** Stable bare identity; Mermaid `~T~` parameters are stored separately. */
  id: string
  label: string
  labelContent?: LabelContent
  /** Generic type parameter text from `ClassName~T~`. */
  generic?: string
  /** Annotation like <<interface>>, <<abstract>>, <<service>>, <<enumeration>> */
  annotation?: string
  /** Class attributes (fields/properties) */
  attributes: ClassMember[]
  /** Class methods (functions) */
  methods: ClassMember[]
  /** Assigned classDef name (`A:::hot`, `class`, or `cssClass`). */
  className?: string
  /** Inline `style A ...` paint. */
  inlineStyle?: Record<string, string>
  /** Safe inert link metadata; callbacks are never executable. */
  href?: string
  /** Optional authored hover text for a safe inert link. */
  tooltip?: string
}

export interface ClassMember {
  /** Visibility: + public, - private, # protected, ~ package */
  visibility: '+' | '-' | '#' | '~' | ''
  /** Member name */
  name: string
  /** Authored attribute text; display preserves Mermaid's member order and punctuation. */
  sourceText?: string
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
export interface ClassNote {
  text: string
  textContent?: LabelContent
  for?: string
}

export type RelationshipType =
  | 'inheritance' // A <|-- B   (solid line, hollow triangle)
  | 'composition' // A *-- B    (solid line, filled diamond)
  | 'aggregation' // A o-- B    (solid line, hollow diamond)
  | 'association' // A --> B    (solid line, open arrow)
  | 'dependency' // A ..> B    (dashed line, open arrow)
  | 'realization' // A ..|> B   (dashed line, hollow triangle)
  | 'link-solid' // A -- B    (solid line, no marker)
  | 'link-dashed' // A .. B    (dashed line, no marker)
  | 'lollipop' // Interface ()-- Class

export interface ClassRelationship {
  from: string
  to: string
  type: RelationshipType
  /** Explicit shaft style when endpoint kinds alone do not describe it. */
  lineStyle?: 'solid' | 'dashed'
  /**
   * Which end of the relationship line has the UML marker (triangle, diamond, arrow).
   * Determined by the arrow syntax direction:
   *   - Prefix markers like `<|--`, `*--`, `o--` → 'from' (marker on left/from side)
   *   - Suffix markers like `..|>`, `-->`, `..>`, `--*`, `--o` → 'to' (marker on right/to side)
   */
  markerAt: 'from' | 'to' | 'both' | 'none'
  /** Exact endpoint marker types when a two-way relation uses different ends. */
  fromType?: RelationshipType
  toType?: RelationshipType
  /** Label on the relationship line */
  label?: string
  labelContent?: LabelContent
  /** Cardinality at the "from" end (e.g., "1", "*", "0..1") */
  fromCardinality?: string
  fromCardinalityContent?: LabelContent
  /** Cardinality at the "to" end */
  toCardinality?: string
  toCardinalityContent?: LabelContent
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
  labelContent?: LabelContent
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
  /** The diagram's title, in its band above the classes. */
  title?: PositionedDiagramTitle
  accessibilityTitle?: string
  accessibilityDescription?: string
  classes: PositionedClassNode[]
  relationships: PositionedClassRelationship[]
  notes: PositionedClassNote[]
  /** Namespace boxes, flattened parent-first, in absolute coordinates. */
  namespaces: PositionedClassNamespace[]
}

/** A laid-out namespace box (ELK compound node), absolute coordinates. */
export interface PositionedClassNamespace {
  labelBlock?: PixelTextBlock
  /** Full dot path (unique id), e.g. 'Company.Engineering.Backend'. */
  id: string
  /** Segment name (last path element). */
  name: string
  /** Display label to draw in the header (label ?? name). */
  label: string
  labelContent?: LabelContent
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
  /** The header text as drawn, wrapped to the namespace's width when the
   * label would otherwise run past the frame. Absent: `label` fits. */
  title?: string
}

export interface PositionedClassNode {
  isInterface?: boolean
  /** Circle geometry from the actual endpoint marker, excluding its stroke. */
  interfaceBox?: { x: number; y: number; width: number; height: number }
  labelBlock?: PixelTextBlock
  annotationBlock?: PixelTextBlock
  attributeBlocks?: PixelTextBlock[]
  methodBlocks?: PixelTextBlock[]
  id: string
  label: string
  labelContent?: LabelContent
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
  className?: string
  inlineStyle?: Record<string, string>
  href?: string
  tooltip?: string
}

export interface PositionedClassNote {
  textBlock?: PixelTextBlock
  text: string
  textContent?: LabelContent
  for?: string
  x: number
  y: number
  width: number
  height: number
  targetX?: number
  targetY?: number
  noteX?: number
  noteY?: number
}

export interface PositionedClassRelationship {
  labelBlock?: PixelTextBlock
  fromCardinalityBlock?: PixelTextBlock
  toCardinalityBlock?: PixelTextBlock
  from: string
  to: string
  type: RelationshipType
  lineStyle?: 'solid' | 'dashed'
  /** Which end of the line has the UML marker — propagated from ClassRelationship */
  markerAt: 'from' | 'to' | 'both' | 'none'
  fromType?: RelationshipType
  toType?: RelationshipType
  label?: string
  labelContent?: LabelContent
  fromCardinality?: string
  fromCardinalityContent?: LabelContent
  toCardinality?: string
  toCardinalityContent?: LabelContent
  /** Path points from source to target */
  points: Array<{ x: number; y: number }>
  /** Dagre-computed label center position (avoids overlaps between nearby edges) */
  labelPosition?: { x: number; y: number }
  /** Collision-separated endpoint text positions, computed by layout. */
  fromCardinalityPosition?: { x: number; y: number }
  toCardinalityPosition?: { x: number; y: number }
}
