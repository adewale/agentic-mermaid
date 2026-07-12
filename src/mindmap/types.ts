import type { PositionedDiagram } from '../types.ts'

export type MindmapShape = 'default' | 'rect' | 'rounded' | 'circle' | 'cloud' | 'bang' | 'hexagon'

export interface MindmapNode {
  /** Stable source identity; duplicate identities are rejected. */
  id: string
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
  accessibilityTitle?: string
  accessibilityDescription?: string
}

export interface PositionedMindmapNode {
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
  accessibilityTitle?: string
  accessibilityDescription?: string
  nodes: PositionedMindmapNode[]
  edges: PositionedMindmapEdge[]
}
