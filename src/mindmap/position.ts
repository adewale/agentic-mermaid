import { layoutMindmap } from './layout.ts'
import type { MindmapDiagram, PositionedMindmapDiagram } from './types.ts'

export interface MindmapPositionConfig {
  padding?: number
  maxNodeWidth?: number
  layout: 'radial' | 'tidy-tree'
}

export function resolveMindmapPositionConfig(raw: unknown, authoredLayout: unknown): MindmapPositionConfig {
  const options: MindmapPositionConfig = { layout: authoredLayout === 'tidy-tree' ? 'tidy-tree' : 'radial' }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return options
  const config = raw as Record<string, unknown>
  if (typeof config.padding === 'number' && Number.isFinite(config.padding) && config.padding >= 0) options.padding = config.padding
  if (typeof config.maxNodeWidth === 'number' && Number.isFinite(config.maxNodeWidth) && config.maxNodeWidth > 0) options.maxNodeWidth = config.maxNodeWidth
  return options
}

export function positionMindmap(body: MindmapDiagram, config: MindmapPositionConfig): PositionedMindmapDiagram {
  return layoutMindmap(body, config)
}
