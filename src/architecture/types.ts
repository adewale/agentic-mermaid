// ============================================================================
// Architecture diagram types
//
// Parsed representation for Mermaid `architecture-beta` diagrams plus the
// positioned structures used by the SVG renderer.
// ============================================================================

import type { Point, PositionedDiagram } from '../types.ts'

export type ArchitectureSide = 'L' | 'R' | 'T' | 'B'
export type ArchitectureEndpointBoundary = 'item' | 'group'

export interface ArchitectureChildRef {
  kind: 'group' | 'service' | 'junction'
  id: string
}

export interface ArchitectureGroup {
  id: string
  label: string
  icon?: string
  parentId?: string
  children: ArchitectureChildRef[]
}

export interface ArchitectureService {
  id: string
  label: string
  icon?: string
  parentId?: string
}

export interface ArchitectureJunction {
  id: string
  parentId?: string
}

export interface ArchitectureEndpoint {
  id: string
  side: ArchitectureSide
  boundary: ArchitectureEndpointBoundary
}

export interface ArchitectureEdge {
  source: ArchitectureEndpoint
  target: ArchitectureEndpoint
  label?: string
  hasArrowStart: boolean
  hasArrowEnd: boolean
}

export interface ArchitectureDiagram {
  groups: ArchitectureGroup[]
  services: ArchitectureService[]
  junctions: ArchitectureJunction[]
  edges: ArchitectureEdge[]
  rootChildren: ArchitectureChildRef[]
  accessibilityTitle?: string
  accessibilityDescription?: string
}

export interface PositionedArchitectureGroup {
  id: string
  label: string
  icon?: string
  parentId?: string
  x: number
  y: number
  width: number
  height: number
  children: PositionedArchitectureGroup[]
}

export interface PositionedArchitectureService {
  id: string
  label: string
  icon?: string
  parentId?: string
  x: number
  y: number
  width: number
  height: number
}

export interface PositionedArchitectureJunction {
  id: string
  parentId?: string
  x: number
  y: number
  width: number
  height: number
}

export interface PositionedArchitectureEdge {
  source: ArchitectureEndpoint
  target: ArchitectureEndpoint
  label?: string
  hasArrowStart: boolean
  hasArrowEnd: boolean
  points: Point[]
  labelPosition?: Point
}

export interface PositionedArchitectureDiagram extends PositionedDiagram {
  width: number
  height: number
  groups: PositionedArchitectureGroup[]
  services: PositionedArchitectureService[]
  junctions: PositionedArchitectureJunction[]
  edges: PositionedArchitectureEdge[]
  accessibilityTitle?: string
  accessibilityDescription?: string
}
