import type { AsciiContext } from '../agent/families.ts'
import { parseTreemapDiagram } from '../treemap/parser.ts'
import { compileTreemapValueFormat, resolveTreemapConfig } from '../treemap/layout.ts'
import { hierarchyChildren } from '../shared/hierarchy-model.ts'
import { TerminalDocument } from './terminal-document.ts'
import { terminalArtifact } from './terminal-artifact.ts'
import { wrapText } from './wrap.ts'

/** A hierarchy/value projection preserves exact quantities in cell geometry. */
export function renderTreemapTerminal(ctx: AsciiContext) {
  const body = parseTreemapDiagram(ctx.source.authoredFamilyBody ?? ctx.source.familyBody)
  body.title ??= ctx.config.title
  const config = resolveTreemapConfig(ctx.source.config.treemap as Record<string, unknown> | undefined)
  const document = new TerminalDocument()
  document.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'treemap.area', message: 'Treemap cell areas are projected as an ordered hierarchy with exact values; terminal cells do not encode rectangle area.' })
  if (body.title) for (const line of wrapText(body.title, ctx.options.targetWidth)) document.line([{ text: line, role: 'text', owner: { id: 'title', kind: 'label' } }])
  const children = hierarchyChildren(body.nodes)
  const totals = new Map<string, number>()
  for (const node of [...body.nodes].reverse()) totals.set(node.id, node.value ?? (children.get(node.id) ?? []).reduce((sum, child) => sum + (totals.get(child.id) ?? 0), 0))
  const depths = new Map<string, number>()
  let formatValue: ((value: number) => string) | undefined
  for (const node of body.nodes) {
    const depth = node.parentId ? (depths.get(node.parentId) ?? 0) + 1 : 0
    depths.set(node.id, depth)
    const prefix = `${'  '.repeat(depth)}${ctx.config.useAscii ? '+-' : '├─'} `
    const label = `${node.label}${config.showValues ? `: ${(formatValue ??= compileTreemapValueFormat(config.valueFormat))(totals.get(node.id) ?? 0)}` : ''}`
    const lines = wrapText(label, ctx.options.targetWidth ? Math.max(1, ctx.options.targetWidth - prefix.length) : undefined)
    for (const [index, line] of lines.entries())
      document.line([
        { text: index === 0 ? prefix : ' '.repeat(prefix.length), kind: 'surface', owner: { id: node.id, kind: 'node' } },
        { text: line, role: 'text', owner: { id: node.id, kind: 'node' } },
      ])
  }
  return terminalArtifact(document, { colorMode: ctx.colorMode, theme: ctx.theme })
}
