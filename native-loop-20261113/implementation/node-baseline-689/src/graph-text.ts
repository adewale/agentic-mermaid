import { preparePixelText, type PixelTextBlock } from './shared/prepared-text.ts'
import type { ResolvedRenderStyle } from './styles.ts'
import type { DisplayTextInput } from './shared/display-text.ts'

export function graphEdgeTextBlock(text: DisplayTextInput, style: Pick<ResolvedRenderStyle, 'edgeLabelFontSize' | 'edgeLabelFontWeight'> & Partial<Pick<ResolvedRenderStyle, 'edgeTextTransform' | 'edgeLetterSpacing'>>): PixelTextBlock {
  return preparePixelText(text, { transform: style.edgeTextTransform, fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing })
}

export function graphTextBlock(text: DisplayTextInput, style: ResolvedRenderStyle, role: 'node' | 'edge' | 'group' | 'note'): PixelTextBlock {
  if (role === 'group') return preparePixelText(text, { transform: style.groupTextTransform, fontSize: style.groupHeaderFontSize, fontWeight: style.groupHeaderFontWeight, letterSpacing: style.groupLetterSpacing, fontFamily: style.groupFont })
  if (role === 'edge') return graphEdgeTextBlock(text, style)
  if (role === 'note') return preparePixelText(text, { transform: style.nodeTextTransform, fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing })
  return preparePixelText(text, { transform: style.nodeTextTransform, fontSize: style.nodeLabelFontSize, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing })
}

