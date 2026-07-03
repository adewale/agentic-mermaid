/**
 * Every diagram family must expose accTitle/accDescr through the same SVG
 * accessibility contract: exactly one <title> and one <desc>, wired from the
 * root via aria-labelledby (title) and aria-describedby (description).
 *
 * This is a conformance loop over the family registry, so a newly registered
 * family is covered automatically. It pins the contract two past defects
 * violated: the central injector put the desc id inside aria-labelledby and
 * never emitted aria-describedby, and families that thread accessibility
 * through their own renderer (sequence, class, er, timeline, journey) were
 * double-injected — duplicate <title>/<desc> elements and a duplicate
 * aria-labelledby attribute on the root tag, which is not well-formed XML.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { builtinFamilyMetadata, knownFamilies } from '../agent/families.ts'

const ACC_TITLE = 'Conformance title'
const ACC_DESCR = 'Conformance description'

function withAccessibility(example: string): string {
  const lines = example.split('\n')
  lines.splice(1, 0, `  accTitle: ${ACC_TITLE}`, `  accDescr: ${ACC_DESCR}`)
  return lines.join('\n')
}

describe('SVG accessibility conformance (all families)', () => {
  for (const kind of knownFamilies()) {
    const meta = builtinFamilyMetadata(kind)
    if (!meta) continue

    it(`${kind}: accTitle/accDescr produce singly-wired <title>/<desc>`, () => {
      const svg = renderMermaidSVG(withAccessibility(meta.example))
      const openTag = svg.match(/<svg[^>]*>/)?.[0]
      expect(openTag).toBeDefined()

      // Exactly one accessible title/desc element each (xychart also uses
      // <title> for datapoint tooltips, so count only id-carrying ones).
      const titles = svg.match(/<title id="[^"]*">/g) ?? []
      const descs = svg.match(/<desc id="[^"]*">/g) ?? []
      expect(titles).toHaveLength(1)
      expect(descs).toHaveLength(1)
      expect(svg).toContain(ACC_TITLE)
      expect(svg).toContain(ACC_DESCR)

      // The root must reference them — once each; a duplicated attribute is
      // not well-formed XML.
      const labelledby = openTag!.match(/aria-labelledby="([^"]*)"/g) ?? []
      const describedby = openTag!.match(/aria-describedby="([^"]*)"/g) ?? []
      expect(labelledby).toHaveLength(1)
      expect(describedby).toHaveLength(1)

      const titleId = titles[0]!.match(/id="([^"]*)"/)![1]!
      const descId = descs[0]!.match(/id="([^"]*)"/)![1]!
      expect(labelledby[0]).toBe(`aria-labelledby="${titleId}"`)
      expect(describedby[0]).toBe(`aria-describedby="${descId}"`)
      expect(openTag!).toContain('role="img"')
    })
  }
})
