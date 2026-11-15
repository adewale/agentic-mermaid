import { describe, expect, test } from 'bun:test'
import cases from '../../eval/mermaid-packet-bench/cases.json'
import { renderPacket } from '../agent/packet-body.ts'
import { renderMermaidSVG } from '../index.ts'
import { normalizeMermaidSource, withFrontmatterTitle } from '../mermaid-source.ts'
import { resolvePacketConfig } from '../packet/config.ts'
import { layoutPacketDiagram } from '../packet/layout.ts'
import { parsePacketDiagram } from '../packet/parser.ts'

describe('Packet pinned Mermaid 12.2.0 harvest', () => {
  for (const fixture of cases)
    test(`${fixture.id}: ${fixture.upstreamTest}`, () => {
      const source = normalizeMermaidSource(fixture.source)
      const parse = () => withFrontmatterTitle(parsePacketDiagram(source.familyBody, source.accessibility), source.frontmatter)
      if (!fixture.reference.ok) {
        expect(parse).toThrow()
        return
      }
      const model = parse(),
        positioned = layoutPacketDiagram(model, {}, resolvePacketConfig(source.frontmatter))
      const expected = fixture.reference.snapshot!.data!
      expect(parsePacketDiagram(source.familyBody).title ?? '').toBe(expected.getDiagramTitle)
      expect(model.accessibilityTitle ?? '').toBe(expected.getAccTitle)
      expect(model.accessibilityDescription ?? '').toBe(expected.getAccDescription)
      // Upstream's split-block `bits` metadata omits one bit at row boundaries.
      // Inclusive start/end and label are portable; our independently asserted
      // conservation law uses end-start+1. The exact difference is ledgered.
      const rows = Array.from({ length: positioned.rows }, (_, row) => positioned.fields.filter(field => field.row === row).map(field => ({ start: field.start, end: field.end, label: field.label })))
      expect(rows).toEqual(expected.getPacket!.map(row => row.map(field => ({ start: field.start, end: field.end, label: field.label }))))
      const canonical = renderPacket(model)
      expect(renderPacket(parsePacketDiagram(canonical))).toBe(canonical)
      expect(renderMermaidSVG(fixture.source)).toContain('<svg')
    })
})
