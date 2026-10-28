import type { LabelContent } from '../shared/display-text.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
// ============================================================================
// ER diagram types
//
// Models the parsed and positioned representations of a Mermaid ER diagram.
// ER diagrams show database entities, their attributes, and relationships.
// ============================================================================

import type { PositionedDiagramTitle } from '../styles.ts'
import type { PositionedDiagram, Direction } from '../types.ts'

/** Parsed ER diagram — logical structure from mermaid text */
export interface ErDiagram {
  /** The diagram's title (frontmatter `title:`). */
  title?: string
  /** Optional accessibility title (Mermaid accTitle) */
  accessibilityTitle?: string
  /** Optional accessibility description (Mermaid accDescr) */
  accessibilityDescription?: string
  /**
   * Layout direction from a `direction TB|BT|LR|RL` statement (upstream
   * v11.4+). Default is LR — this fork's deliberate divergence from
   * upstream's TB default (documented in docs/design/families/er.md).
   */
  direction?: Direction
  /** All entity definitions */
  entities: ErEntity[]
  /** Mermaid classDef paint declarations. */
  classDefs: Map<string, Record<string, string>>
  /** Relationships between entities or subgraph boundaries. */
  relationships: ErRelationship[]
  /** Nested ER frames and their authored membership. */
  groups: ErGroup[]
}

export interface ErGroup {
  id: string
  label: string
  labelContent?: LabelContent
  parentId?: string
  direction?: Direction
  entityIds: string[]
}

export interface ErEntity {
  id: string
  /** Display name (same as id unless aliased) */
  label: string
  labelContent?: LabelContent
  /** Entity attributes (columns) */
  attributes: ErAttribute[]
  /** Applied CSS class names in source order, separated by spaces. */
  className?: string
  inlineStyle?: Record<string, string>
  groupId?: string
}

export interface ErAttribute {
  /** Data type (string, int, varchar, etc.) */
  type: string
  /** Attribute name */
  name: string
  /** Key constraints: PK, FK, UK */
  keys: Array<'PK' | 'FK' | 'UK'>
  /** Optional comment */
  comment?: string
  commentContent?: LabelContent
}

/**
 * Cardinality notation (crow's foot):
 *   'one'       ||  exactly one
 *   'zero-one'  |o  zero or one
 *   'many'      }|  one or more
 *   'zero-many' o{  zero or more
 */
export type Cardinality = 'one' | 'zero-one' | 'many' | 'zero-many' | 'parent'

export interface ErRelationship {
  entity1: string
  entity2: string
  /** Cardinality at entity1's end */
  cardinality1: Cardinality
  /** Cardinality at entity2's end */
  cardinality2: Cardinality
  /** Relationship verb/label (e.g., "places", "contains") */
  label: string
  labelContent?: LabelContent
  /** Whether the relationship is identifying (solid line) or non-identifying (dashed) */
  identifying: boolean
}

// ============================================================================
// Positioned ER diagram — ready for SVG rendering
// ============================================================================

export interface PositionedErDiagram extends PositionedDiagram {
  width: number
  height: number
  /** The diagram's title, in its band above the entities. */
  title?: PositionedDiagramTitle
  accessibilityTitle?: string
  accessibilityDescription?: string
  entities: PositionedErEntity[]
  relationships: PositionedErRelationship[]
  groups: PositionedErGroup[]
  /** @internal Selected native producer's label policy; absent for ELK and fallback results. */
  labelPlacement?: 'shaft-aware'
}

export interface PositionedErGroup {
  labelBlock?: PixelTextBlock
  id: string
  label: string
  labelContent?: LabelContent
  parentId?: string
  x: number
  y: number
  width: number
  height: number
  headerHeight: number
}

export interface PositionedErEntity {
  labelBlock?: PixelTextBlock
  emptyAttributeBlock?: PixelTextBlock
  attributeBlocks?: { type: PixelTextBlock; name: PixelTextBlock; keys: PixelTextBlock; comment?: PixelTextBlock }[]
  id: string
  label: string
  labelContent?: LabelContent
  attributes: ErAttribute[]
  x: number
  y: number
  width: number
  height: number
  /** Height of the header row */
  headerHeight: number
  /** Height per attribute row */
  rowHeight: number
  className?: string
  inlineStyle?: Record<string, string>
  groupId?: string
}

export interface PositionedErRelationship {
  labelBlock?: PixelTextBlock
  /** Producer's preferred label center; final label layout checks the current route and obstacles. */
  labelPosition?: { x: number; y: number }
  /** Final native label center, owned by the complete positioned artifact and its resolved request. */
  finalLabelPosition?: { x: number; y: number }
  entity1: string
  entity2: string
  cardinality1: Cardinality
  cardinality2: Cardinality
  label: string
  labelContent?: LabelContent
  identifying: boolean
  /** Path points from entity1 to entity2 */
  points: Array<{ x: number; y: number }>
}
