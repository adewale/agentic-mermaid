import { preparePixelText, type PixelTextBlock } from '../shared/prepared-text.ts'
import { resolveArchitectureIcon } from './icons.ts'

export const normalizeIconName = (icon: string) => icon.trim().toLowerCase().split(/[:/]/).pop() ?? icon.trim().toLowerCase()

export function fallbackIconGlyph(icon: string): string {
  const token = normalizeIconName(icon).replace(/[^a-z0-9]/g, '')
  return (token[0] ?? '?').toUpperCase()
}

/** Native primitives and bundled paths do not paint fallback text. */
export function architectureIconFallbackBlock(icon: string | undefined, size: number): PixelTextBlock | undefined {
  if (!icon || resolveArchitectureIcon(icon) || ['cloud', 'database', 'disk', 'internet', 'server'].includes(normalizeIconName(icon))) return undefined
  return preparePixelText(fallbackIconGlyph(icon), { fontSize: Math.max(10, size * 0.56), fontWeight: 700 })
}
