import type { AsciiContext } from '../agent/family-registry.ts'
import { parseVennDiagram, vennRegionId } from '../venn/parser.ts'
import { TerminalDocument } from './terminal-document.ts'
import { terminalArtifact } from './terminal-artifact.ts'
import { wrapText } from './wrap.ts'
export function renderVennTerminal(ctx: AsciiContext) {
  const body = parseVennDiagram(ctx.source.authoredFamilyBody ?? ctx.source.familyBody),
    document = new TerminalDocument()
  document.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'venn.regions', message: 'Venn intersections are shown as named set memberships and exact values; terminal cells do not encode proportional overlap areas.' })
  const line = (id: string, value: string) => {
    for (const text of wrapText(value, ctx.options.targetWidth)) document.line([{ text, role: 'text', owner: { id, kind: 'node' } }])
  }
  const title = body.title ?? (typeof ctx.source.frontmatter.title === 'string' ? ctx.source.frontmatter.title : undefined)
  if (title) line('title', title)
  for (const subset of body.subsets) {
    const id = vennRegionId(subset.sets)
    line(id, `${subset.sets.join(ctx.config.useAscii ? ' & ' : ' ∩ ')}${subset.label === undefined ? '' : `: ${subset.label}`} (${subset.size})`)
    for (const node of body.textNodes.filter(node => vennRegionId(node.sets) === id)) line(node.id, `  ${node.label ?? node.id}`)
  }
  for (const node of body.textNodes.filter(node => !body.subsets.some(subset => vennRegionId(subset.sets) === vennRegionId(node.sets)))) line(node.id, `${node.sets.join(' & ')}: ${node.label ?? node.id}`)
  return terminalArtifact(document, { colorMode: ctx.colorMode, theme: ctx.theme })
}
