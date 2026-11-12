import type { PixelTextBlock } from '../shared/prepared-text.ts'
import type { PositionedDiagram } from '../types.ts'
import type { PositionedDiagramTitle } from '../styles.ts'

export type MindmapShape = 'default' | 'rect' | 'rounded' | 'circle' | 'cloud' | 'bang' | 'hexagon'

export interface MindmapNode {
  /** Distinct, addressable identity: the authored identity (explicit id, or a
   * default node's text), or for a later node repeating one, `<identity>#<n>`
   * in document order (see assignMindmapIdentities). */
  id: string
  /** The authored identity, present only when `id` is a later occurrence's
   * generated id; serialization writes this, never `id`. */
  sourceId?: string
  label: string
  shape: MindmapShape
  /** Label originated as Mermaid's quoted Markdown String syntax. */
  markdown?: true
  icon?: string
  className?: string
  children: MindmapNode[]
}

export interface MindmapDiagram {
  root: MindmapNode
  /** The diagram's title (frontmatter `title:`). */
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
}

export interface PositionedMindmapNode {
  labelBlock?: PixelTextBlock
  iconFallbackBlock?: PixelTextBlock
  id: string
  label: string
  shape: MindmapShape
  markdown?: true
  icon?: string
  className?: string
  parentId?: string
  depth: number
  /** Root-relative side assigned at the first branch boundary. */
  side: 'root' | 'left' | 'right'
  x: number
  y: number
  width: number
  height: number
}

export interface PositionedMindmapEdge {
  from: string
  to: string
  /** Cubic branch control points: start, control1, control2, end. */
  points: Array<{ x: number; y: number }>
  d: string
}

export interface PositionedMindmapDiagram extends PositionedDiagram {
  /** The diagram's title, in its band above the map. */
  title?: PositionedDiagramTitle
  accessibilityTitle?: string
  accessibilityDescription?: string
  nodes: PositionedMindmapNode[]
  edges: PositionedMindmapEdge[]
}
