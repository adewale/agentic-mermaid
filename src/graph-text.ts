import { preparePixelText, type PixelTextBlock } from './shared/prepared-text.ts'
import type { ResolvedRenderStyle } from './styles.ts'

export function graphTextBlock(text: string, style: ResolvedRenderStyle, role: 'node' | 'edge' | 'group' | 'note'): PixelTextBlock {
  if (role === 'group') return preparePixelText(text, { transform: style.groupTextTransform, fontSize: style.groupHeaderFontSize, fontWeight: style.groupHeaderFontWeight, letterSpacing: style.groupLetterSpacing })
  if (role === 'edge' || role === 'note') return preparePixelText(text, { transform: role === 'note' ? style.nodeTextTransform : style.edgeTextTransform, fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing })
  return preparePixelText(text, { transform: style.nodeTextTransform, fontSize: style.nodeLabelFontSize, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing })
}

