// ============================================================================
// ASCII renderer — Sankey diagram
//
// Ribbon geometry doesn't map cleanly to a character grid, so we render the
// flow graph as a grouped adjacency list (the conventional terminal sankey
// rendering): each node with outgoing flows becomes a section whose branches
// carry a value column and a value-proportional bar:
//
//   Electricity grid  626.591
//     ├─▶ Industry           342.165  ████████
//     ├─▶ Homes              113.726  ███
//     └─▶ Losses              56.691  █
//
// Sections follow first-appearance order (the SVG's node identity order) and
// branches follow authored row order — never re-sorted, matching the
// faithfulness contract. Bars use █ (Unicode) or # (ASCII fallback), colored
// with the SAME categorical palette as the SVG renderer — including
// `sankey.nodeColors` overrides — for cross-format consistency. `showValues`
// hides the numeric columns (bars remain); `prefix`/`suffix` format values.
// ============================================================================

import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { pieSliceColors } from '../pie/palette.ts'
import type { SankeyVisualConfig } from '../sankey/config.ts'
import { resolveSankeyVisualConfig } from '../sankey/config.ts'
import { formatSankeyValue } from '../sankey/layout.ts'
import { parseSankeyDiagram } from '../sankey/parser.ts'
import { colorizeText } from './ansi.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { padEndToVisualWidth, visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'

/** Maximum bar length in characters (the largest flow fills this). */
const MAX_BAR = 20

export function renderSankeyAscii(lines: string[], config: AsciiConfig, colorMode: ColorMode, theme: AsciiTheme, frontmatter: MermaidFrontmatterMap = {}, targetWidth?: number, resolvedVisual?: SankeyVisualConfig): string {
  const visual = resolvedVisual ?? resolveSankeyVisualConfig(frontmatter)
  const title = typeof frontmatter.title === 'string' ? frontmatter.title : undefined
  const diagram = parseSankeyDiagram(lines, title !== undefined ? { title } : {})

  const barChar = config.useAscii ? '#' : '█'
  const branch = config.useAscii ? '|-> ' : '├─▶ '
  const branchLast = config.useAscii ? '`-> ' : '└─▶ '
  const continuation = config.useAscii ? '|   ' : '│   '

  const palette = pieSliceColors(diagram.nodes.length, {
    accent: theme.accent,
    bg: theme.bg,
  })
  const colorOf = new Map<string, string>()
  diagram.nodes.forEach((label, index) => {
    colorOf.set(label, visual.nodeColors[label] ?? palette[index]!)
  })

  const outgoing = new Map<string, typeof diagram.links>()
  for (const link of diagram.links) {
    const links = outgoing.get(link.source)
    if (links) links.push(link)
    else outgoing.set(link.source, [link])
  }
  const nodeTotal = new Map<string, number>()
  for (const link of diagram.links) {
    nodeTotal.set(link.source, (nodeTotal.get(link.source) ?? 0) + link.value)
  }

  const maxValue = Math.max(...diagram.links.map(link => link.value), 0)
  const valueTexts = diagram.links.map(link => (visual.showValues ? formatSankeyValue(link.value, visual) : ''))
  const valueWidth = Math.max(0, ...valueTexts.map(visualWidth))

  // Width budget: indent(2) + branch(4) + label + 2 + value + 2 + bar.
  const fixedWidth = 2 + 4 + 2 + (visual.showValues ? valueWidth + 2 : 0) + MAX_BAR
  const labelBudget = targetWidth ? Math.max(1, targetWidth - fixedWidth) : undefined

  const out: string[] = []
  if (diagram.title) out.push(...wrapText(diagram.title, targetWidth), '')

  const sources = diagram.nodes.filter(label => outgoing.has(label))
  const wrappedTargets = new Map<string, string[]>()
  for (const link of diagram.links) {
    if (!wrappedTargets.has(link.target)) {
      wrappedTargets.set(link.target, wrapText(link.target, labelBudget))
    }
  }
  const labelWidth = Math.max(0, ...[...wrappedTargets.values()].flat().map(visualWidth))

  sources.forEach((source, sourceIndex) => {
    const links = outgoing.get(source)!
    const headerValue = visual.showValues ? `  ${formatSankeyValue(nodeTotal.get(source) ?? 0, visual)}` : ''
    const headerLines = wrapText(source, targetWidth)
    for (let i = 0; i < headerLines.length - 1; i++) out.push(headerLines[i]!)
    out.push(`${headerLines.at(-1) ?? ''}${headerValue}`)

    links.forEach((link, linkIndex) => {
      const last = linkIndex === links.length - 1
      const glyph = last ? branchLast : branch
      const barLen = maxValue > 0 && link.value > 0 ? Math.max(1, Math.round((link.value / maxValue) * MAX_BAR)) : 0
      const bar = barChar.repeat(barLen)
      const color = colorOf.get(link.target)!
      const coloredBar = colorMode === 'none' || bar.length === 0 ? bar : colorizeText(bar, color, colorMode)
      const valuePart = visual.showValues ? `${padStartToVisualWidth(formatSankeyValue(link.value, visual), valueWidth)}  ` : ''
      // Branch glyph on the first wrapped line, rail continuation beneath it,
      // value + bar riding on the last line (the pie multiline-row pattern).
      const targetLines = wrappedTargets.get(link.target)!
      const restPrefix = last ? '    ' : continuation
      targetLines.forEach((line, lineIndex) => {
        const prefix = lineIndex === 0 ? glyph : restPrefix
        if (lineIndex < targetLines.length - 1) {
          out.push(`  ${prefix}${line}`)
        } else {
          const label = padEndToVisualWidth(line, labelWidth)
          out.push(`  ${prefix}${label}  ${valuePart}${coloredBar}`.trimEnd())
        }
      })
    })

    if (sourceIndex < sources.length - 1) out.push('')
  })

  return out.join('\n')
}

function padStartToVisualWidth(text: string, width: number): string {
  const pad = width - visualWidth(text)
  return pad > 0 ? ' '.repeat(pad) + text : text
}
