import { describe, expect, test } from 'bun:test'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import * as agentApi from '../agent/index.ts'
import { layoutMermaid, parseRegisteredMermaid as parseMermaid, renderMermaidASCII, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { MUTATION_OPS_BY_FAMILY } from '../cli/index.ts'
import { FAMILY_COUNT_FIXTURES } from './helpers/family-count-fixtures.ts'

describe('diagram-family citizenship (issue #41)', () => {
  test('behavioral citizenship: every family parses, verifies, renders SVG+ASCII, round-trips, and is deterministic', () => {
    // Exercises the cheaply checkable citizenship surfaces (detection, semantic
    // model, round-trip, typed mutation, verify, SVG, ASCII/Unicode, stable
    // regions, determinism) for every registered family. (#41)
    const registryIds = new Set<string>(BUILTIN_FAMILY_METADATA.map(f => f.id))
    const metadata = new Map(BUILTIN_FAMILY_METADATA.map(f => [f.id as string, f]))
    const covered = new Set<string>()
    for (const fx of FAMILY_COUNT_FIXTURES) {
      const parsed = parseMermaid(fx.source)
      expect({ family: fx.family, parseOk: parsed.ok }).toEqual({ family: fx.family, parseOk: true })
      if (!parsed.ok) continue
      covered.add(fx.family)

      // detectionParse: detected as the right family.
      expect({ family: fx.family, kind: parsed.value.kind }).toEqual({ family: fx.family, kind: fx.family })
      // semanticModel: the family's own structured body, not the opaque fallback.
      expect({ family: fx.family, body: parsed.value.body.kind }).toEqual({ family: fx.family, body: fx.family })
      // typedMutation: the advertised public narrower accepts the diagram and
      // the family exposes structured mutation ops.
      const narrower = (agentApi as Record<string, unknown>)[metadata.get(fx.family)!.narrower]
      expect({ family: fx.family, narrower: typeof narrower }).toEqual({ family: fx.family, narrower: 'function' })
      expect({ family: fx.family, narrowed: (narrower as (diagram: unknown) => unknown)(parsed.value) === parsed.value })
        .toEqual({ family: fx.family, narrowed: true })
      expect({ family: fx.family, ops: MUTATION_OPS_BY_FAMILY[fx.family].length > 0 }).toEqual({ family: fx.family, ops: true })
      // verifyRenderSeam: structural verify passes.
      expect({ family: fx.family, verifyOk: verifyMermaid(fx.source).ok }).toEqual({ family: fx.family, verifyOk: true })
      // serializeRoundTrip: serialize → reparse → serialize is stable.
      const serialized = serializeMermaid(parsed.value)
      const reparsed = parseMermaid(serialized)
      expect({ family: fx.family, reparseOk: reparsed.ok }).toEqual({ family: fx.family, reparseOk: true })
      if (reparsed.ok) {
        expect({ family: fx.family, stable: serializeMermaid(reparsed.value) === serialized }).toEqual({ family: fx.family, stable: true })
      }
      // svgRender: emits a real SVG document.
      const svg = renderMermaidSVG(fx.source)
      expect({ family: fx.family, svg: svg.includes('<svg') && svg.length > 100 }).toEqual({ family: fx.family, svg: true })
      // asciiUnicodeRender: emits non-empty text.
      expect({ family: fx.family, ascii: renderMermaidASCII(fx.source).trim().length > 0 }).toEqual({ family: fx.family, ascii: true })
      // determinism: identical SVG across repeated renders.
      expect({ family: fx.family, deterministic: renderMermaidSVG(fx.source) === svg }).toEqual({ family: fx.family, deterministic: true })
      // stableRegions: layout exposes node regions inside the canvas, and the
      // region metadata is identical across repeated layouts.
      const regions = layoutMermaid(parsed.value, { regions: true }).regions ?? []
      const canvas = regions.find(region => region.kind === 'canvas')?.bounds
      const nodeRegions = regions.filter(region => region.kind === 'node')
      expect({ family: fx.family, canvas: canvas !== undefined, nodeRegions: nodeRegions.length > 0 })
        .toEqual({ family: fx.family, canvas: true, nodeRegions: true })
      const outside = nodeRegions.filter(({ bounds: b }) =>
        !canvas || b.x < canvas.x || b.y < canvas.y || b.x + b.w > canvas.x + canvas.w || b.y + b.h > canvas.y + canvas.h)
      expect({ family: fx.family, outside: outside.map(region => region.id) }).toEqual({ family: fx.family, outside: [] })
      expect({ family: fx.family, stableRegions: JSON.stringify(layoutMermaid(parsed.value, { regions: true }).regions) === JSON.stringify(regions) })
        .toEqual({ family: fx.family, stableRegions: true })
    }
    // No registered family is silently skipped: each must have a behavioral fixture.
    expect([...registryIds].filter(id => !covered.has(id)).sort()).toEqual([])
  })
})
