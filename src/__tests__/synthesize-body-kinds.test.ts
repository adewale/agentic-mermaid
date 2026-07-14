/**
 * synthesizeFromGraph must accept every body kind ValidDiagramPayload
 * declares. The body-kind acceptance list used to be a hand-maintained `||`
 * chain, and pie and quadrant were missing from it — a structurally valid
 * payload for either family was rejected with INVALID_PAYLOAD. The loop
 * below feeds every family's canonical example back through the payload
 * path, so a newly registered family is covered automatically.
 */
import { describe, it, expect } from 'bun:test'
import { parseMermaid } from '../agent/parse.ts'
import { synthesizeFromGraph } from '../agent/serialize.ts'
import { builtinFamilyMetadata, knownBuiltinFamilies } from '../agent/families.ts'
import type { ValidDiagramPayload } from '../agent/types.ts'

describe('synthesizeFromGraph accepts every declared body kind', () => {
  it('publicly types the registered structured radar payload without a cast', () => {
    const payload = {
      kind: 'radar',
      body: {
        kind: 'radar',
        axes: [{ id: 'a', label: 'A' }],
        curves: [{ id: 'x', label: 'X', values: [1] }],
        min: 0,
        max: 2,
        ticks: 5,
        graticule: 'circle',
        showLegend: true,
      },
    } satisfies ValidDiagramPayload
    expect(synthesizeFromGraph(payload).ok).toBe(true)
  })

  for (const kind of knownBuiltinFamilies()) {
    const meta = builtinFamilyMetadata(kind)
    if (!meta) continue

    it(`${kind}: round-trips its parsed body through the payload path`, () => {
      const parsed = parseMermaid(meta.example)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      const result = synthesizeFromGraph({
        kind: parsed.value.kind,
        body: parsed.value.body as never,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.body.kind).toBe(parsed.value.body.kind)
      expect(result.value.canonicalSource.length).toBeGreaterThan(0)
    })
  }

  it('still rejects an unknown body kind', () => {
    const result = synthesizeFromGraph({
      kind: 'flowchart',
      body: { kind: 'nonsense' } as never,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error[0]?.code).toBe('INVALID_PAYLOAD')
  })
})
