import type { PositionedDiagram } from '../types.ts'

export type MindmapShape = 'default' | 'rect' | 'rounded' | 'circle' | 'cloud' | 'bang' | 'hexagon'

export interface MindmapNode {
  /** Stable source identity; duplicate identities are rejected. */
  id: string
  label: string
  shape: MindmapShape
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
  icon?: string
  className?: string
  parentId?: string
  depth: number
  x: number
  y: number
  width: number
  height: number
}

export interface PositionedMindmapEdge {
  from: string
  to: string
  points: Array<{ x: number; y: number }>
}

export interface PositionedMindmapDiagram extends PositionedDiagram {
  accessibilityTitle?: string
  accessibilityDescription?: string
  nodes: PositionedMindmapNode[]
  edges: PositionedMindmapEdge[]
}
