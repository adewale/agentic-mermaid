import { layoutMindmap, withMindmapTitle } from './layout.ts'
import type { MindmapDiagram, PositionedMindmapDiagram } from './types.ts'
import type { ResolvedRenderStyle } from '../styles.ts'

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

/** Lay out the map; a titled map (frontmatter `title:`) gets its title band,
 * measured with the style's group text case and tracking when one is given. */
export function positionMindmap(
  body: MindmapDiagram,
  config: MindmapPositionConfig,
  titleStyle: Pick<ResolvedRenderStyle, 'groupTextTransform' | 'groupLetterSpacing'> = { groupLetterSpacing: 0 },
): PositionedMindmapDiagram {
  return withMindmapTitle(layoutMindmap(body, config), body.title, titleStyle, config)
}
