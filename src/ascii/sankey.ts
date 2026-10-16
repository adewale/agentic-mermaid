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

import { getFrontmatterMap, type MermaidFrontmatterMap } from '../mermaid-source.ts'
import { pieSliceColors } from '../pie/palette.ts'
import type { SankeyVisualConfig } from '../sankey/config.ts'
import { resolveSankeyVisualConfig } from '../sankey/config.ts'
import { formatSankeyValue, sankeyLinkId } from '../sankey/layout.ts'
import { parseSankeyDiagram } from '../sankey/parser.ts'
import { TerminalDocument, finishTerminalDocument, type TerminalOwner } from './terminal-document.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'
import { displayText } from '../multiline-utils.ts'
import { terminalIds } from './identity.ts'
import { tryParseCssColor } from '../shared/color-math.ts'

/** Maximum bar length in characters (the largest flow fills this). */
const MAX_BAR = 20

export function renderSankeyAscii(lines: string[], config: AsciiConfig, colorMode: ColorMode, theme: AsciiTheme, frontmatter: MermaidFrontmatterMap = {}, targetWidth?: number, resolvedVisual?: SankeyVisualConfig): string {
  targetWidth ??= config.maxWidth
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

  const document = new TerminalDocument()
  document.titleHandled = true
  const generated = terminalIds(diagram.nodes)
  const authoredVisual = getFrontmatterMap(frontmatter, ['config', 'sankey']) ?? getFrontmatterMap(frontmatter, ['sankey']) ?? {}
  const project = (field: string, value: unknown, representation: string): void => document.report({
    code: 'TERMINAL_FAMILY_PROJECTION', feature: `sankey.${field}`,
    message: `sankey.${field}=${JSON.stringify(value)} is represented by ${representation}; source configuration is retained.`,
  })
  for (const field of ['width', 'height', 'nodeWidth', 'nodePadding'] as const) {
    if (typeof authoredVisual[field] === 'number' && authoredVisual[field] === visual[field]) {
      project(field, visual[field], 'measured adjacency-list columns and proportional bars rather than pixel ribbon/node geometry')
    }
  }
  if (typeof authoredVisual.nodeAlignment === 'string' && authoredVisual.nodeAlignment === visual.nodeAlignment) {
    project('nodeAlignment', visual.nodeAlignment, 'adjacency sections in first-appearance order rather than horizontal flow layers')
  }
  if (visual.labelStyle === 'outlined') project('labelStyle', visual.labelStyle, 'complete terminal labels without a pixel outline halo')
  if (visual.linkColor.mode === 'gradient') project('linkColor', 'gradient', 'solid target-colored bars rather than a source-to-target gradient')
  const occurrence = new Map<string, number>()
  const linkIds = new Map(diagram.links.map((link, linkIndex) => {
    const key = JSON.stringify([link.source, link.target])
    const index = occurrence.get(key) ?? 0
    occurrence.set(key, index + 1)
    return [link, generated(sankeyLinkId(link.source, link.target, index), `link:${linkIndex}`)]
  }))
  // Labels draw their display text, as the SVG node labels do.
  if (diagram.title) {
    for (const text of wrapText(displayText(diagram.title), targetWidth)) document.line([{ text, role: 'text', textGroup: 'title', owner: { id: generated('title', 'title'), kind: 'label' } }])
    document.line()
  }

  const sources = diagram.nodes.filter(label => outgoing.has(label))
  const wrappedTargets = new Map<string, string[]>()
  for (const link of diagram.links) {
    if (!wrappedTargets.has(link.target)) {
      wrappedTargets.set(link.target, wrapText(displayText(link.target), labelBudget))
    }
  }
  const labelWidth = Math.max(0, ...[...wrappedTargets.values()].flat().map(visualWidth))

  sources.forEach((source, sourceIndex) => {
    const links = outgoing.get(source)!
    const headerValue = visual.showValues ? `  ${formatSankeyValue(nodeTotal.get(source) ?? 0, visual)}` : ''
    const headerLines = wrapText(displayText(source), targetWidth)
    for (let i = 0; i < headerLines.length - 1; i++) document.line([{ text: headerLines[i]!, role: 'text', textGroup: 'header', owner: { id: source, kind: 'node' } }])
    document.line([
      { text: headerLines.at(-1) ?? '', role: 'text', textGroup: 'header', owner: { id: source, kind: 'node' } },
      { text: headerValue, role: 'text', owner: { id: generated(`${source}:value`, JSON.stringify(['source-value', source])), kind: 'label', parentId: source } },
    ])

    links.forEach((link, linkIndex) => {
      const last = linkIndex === links.length - 1
      const glyph = last ? branchLast : branch
      const barLen = maxValue > 0 && link.value > 0 ? Math.max(1, Math.round((link.value / maxValue) * MAX_BAR)) : 0
      const bar = barChar.repeat(barLen)
      const color = visual.linkColor.mode === 'static' ? visual.linkColor.color
        : colorOf.get(visual.linkColor.mode === 'source' ? link.source : link.target)!
      const id = linkIds.get(link)!
      const edgeOwner: TerminalOwner = { id, kind: 'edge', from: link.source, to: link.target }
      if (barLen > 0 && colorMode !== 'none' && colorMode !== 'html') {
        const parsed = tryParseCssColor(color)
        if (!parsed || parsed[3] !== 1) {
          const feature = visual.linkColor.mode === 'static' ? 'sankey.linkColor'
            : `sankey.nodeColors.${visual.linkColor.mode === 'source' ? link.source : link.target}`
          document.report({
            code: 'TERMINAL_COLOR_UNREPRESENTABLE', feature,
            message: `${feature}=${JSON.stringify(color)} cannot be encoded as an opaque terminal foreground; ANSI bars retain their owned cells without that paint. HTML retains the safe CSS color.`,
          })
        }
      }
      const valuePart = visual.showValues ? `${padStartToVisualWidth(formatSankeyValue(link.value, visual), valueWidth)}  ` : ''
      // Branch glyph on the first wrapped line, rail continuation beneath it,
      // value + bar riding on the last line (the pie multiline-row pattern).
      const targetLines = wrappedTargets.get(link.target)!
      const restPrefix = last ? '    ' : continuation
      targetLines.forEach((line, lineIndex) => {
        const prefix = lineIndex === 0 ? glyph : restPrefix
        if (lineIndex < targetLines.length - 1) {
          document.line([
            { text: `  ${prefix}`, role: 'line', kind: 'stroke', owner: edgeOwner },
            { text: line, role: 'text', textGroup: id, owner: { id: link.target, kind: 'node' } },
          ])
        } else {
          document.line([
            { text: `  ${prefix}`, role: 'line', kind: 'stroke', owner: edgeOwner },
            { text: line, role: 'text', textGroup: id, owner: { id: link.target, kind: 'node' } },
            { text: ' '.repeat(Math.max(0, labelWidth - visualWidth(line)) + 2) },
            { text: valuePart, role: 'text', owner: { id: generated(`${id}:value`, JSON.stringify(['link-value', id])), kind: 'label', parentId: id } },
            { text: bar, role: 'arrow', kind: 'stroke', color, owner: edgeOwner },
          ])
        }
      })
    })

    if (sourceIndex < sources.length - 1) document.line()
  })

  return finishTerminalDocument(config, document, { colorMode, theme, trimEnd: true })
}

function padStartToVisualWidth(text: string, width: number): string {
  const pad = width - visualWidth(text)
  return pad > 0 ? ' '.repeat(pad) + text : text
}
