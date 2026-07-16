import { decodeXML } from 'entities'
import { measureFormattedTextWidth, measureMonospaceTextWidth } from './text-metrics.ts'

function attribute(attrs: string, name: string): string | undefined {
  const direct = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2]
  if (direct !== undefined) return direct
  const style = attrs.match(/\bstyle\s*=\s*(["'])(.*?)\1/i)?.[2]
  return style?.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i'))?.[1]?.trim()
}

function numericAttribute(attrs: string, name: string, fallback: number): number {
  const parsed = Number.parseFloat(attribute(attrs, name) ?? '')
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Resolve the CSS font-weight spellings emitted by formatted tspans. */
function fontWeightAttribute(attrs: string, fallback: number): number {
  const value = attribute(attrs, 'font-weight')?.trim().toLowerCase()
  if (value === undefined) return fallback
  if (value === 'normal') return 400
  if (value === 'bold') return 700
  if (value === 'bolder') {
    if (fallback < 350) return 400
    if (fallback < 550) return 700
    return 900
  }
  if (value === 'lighter') {
    if (fallback < 550) return 100
    if (fallback < 750) return 400
    return 700
  }
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function hasMonoClass(attrs: string): boolean {
  return /\bclass\s*=\s*(["'])[^"']*\bmono\b/i.test(attrs)
}

interface InheritedTextMetrics {
  readonly size: number
  readonly weight: number
  readonly letterSpacing: number
  readonly mono: boolean
}

function addFitAttributes(
  attrs: string,
  text: string,
  inherited: InheritedTextMetrics,
): string {
  if (/\btextLength\s*=/i.test(attrs)) return attrs
  const fontSize = numericAttribute(attrs, 'font-size', inherited.size)
  const fontWeight = fontWeightAttribute(attrs, inherited.weight)
  const letterSpacing = numericAttribute(attrs, 'letter-spacing', inherited.letterSpacing)
  const mono = inherited.mono || hasMonoClass(attrs)
  if (!(fontSize > 0) || text.length === 0) return attrs
  const measured = mono
    ? measureMonospaceTextWidth(text, fontSize, letterSpacing)
    : measureFormattedTextWidth(text, fontSize, fontWeight, letterSpacing)
  const width = Math.round(measured * 1000) / 1000
  return `${attrs} textLength="${width}" lengthAdjust="spacingAndGlyphs" data-font-metrics="deterministic-fit"`
}

/**
 * Force every painted SVG text run to the deterministic advance used by
 * layout. Resource availability is not metric calibration: even bundled faces
 * can be wider than the estimator, and SVG/browser/native hosts may resolve
 * different fallbacks. Existing emitter-owned textLength remains authoritative.
 *
 * `fontStack` is retained in the signature for compatibility with the original
 * unknown-font-only postpass; advance projection is now family-independent.
 */
export function fitUncalibratedSvgText(svg: string, _fontStack: string): string {
  return svg.replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi, (whole, rawAttrs: string, inner: string) => {
    const inherited: InheritedTextMetrics = {
      size: numericAttribute(rawAttrs, 'font-size', 0),
      weight: fontWeightAttribute(rawAttrs, 400),
      letterSpacing: numericAttribute(rawAttrs, 'letter-spacing', 0),
      mono: hasMonoClass(rawAttrs),
    }
    if (/<tspan\b/i.test(inner)) {
      const projected = inner.replace(/<tspan\b([^>]*)>([^<]*)<\/tspan>/gi, (tspan, tspanAttrs: string, encoded: string) => {
        const attrs = addFitAttributes(tspanAttrs, decodeXML(encoded), inherited)
        return attrs === tspanAttrs ? tspan : `<tspan${attrs}>${encoded}</tspan>`
      })
      return `<text${rawAttrs}>${projected}</text>`
    }
    if (/<[^>]+>/.test(inner)) return whole
    const attrs = addFitAttributes(rawAttrs, decodeXML(inner), inherited)
    return attrs === rawAttrs ? whole : `<text${attrs}>${inner}</text>`
  })
}
