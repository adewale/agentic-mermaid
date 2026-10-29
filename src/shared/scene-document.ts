import type { DrawingDocument, DrawingFactory } from '../scene/drawing.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import type { DiagramColors } from '../theme.ts'
import { buildStyleBlock, buildShadowDefs, svgOpenTag } from '../theme.ts'
import * as marks from '../scene/marks.ts'

/** Common typed Scene shell; family placement and owned artwork stay local. */
export function sceneDocument(family: string, size: { width: number; height: number }, colors: DiagramColors, transparent: boolean, parts: SceneNode[]): SceneDoc {
  return drawingDocument(marks, family, size, colors, transparent, parts)
}

export function drawingDocument<T>(marks: DrawingFactory<T>, family: string, size: { width: number; height: number }, colors: DiagramColors, transparent: boolean, parts: T[]): DrawingDocument<T> {
  const font = colors.font ?? 'Inter'
  const shadow = buildShadowDefs(colors)
  return {
    family,
    width: size.width,
    height: size.height,
    colors,
    transparent,
    parts: [
      marks.documentOpen({ id: 'prelude', width: size.width, height: size.height, colors, transparent, font, hasMonoFont: false }, `${svgOpenTag(size.width, size.height, colors, transparent)}\n${buildStyleBlock(font, false, colors.shadow, colors.embedFontImport)}${shadow ? `\n<defs>${shadow}</defs>` : ''}`),
      ...parts,
      marks.documentClose(),
    ],
  }
}
