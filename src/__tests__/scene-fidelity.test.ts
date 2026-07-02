// Scene-fidelity gate: for every family with a SceneGraph lowering, the
// semantic fields on each mark (geometry, markers, text) must agree with the
// mark's crisp serialization. Styled backends redraw from the semantic fields,
// so a divergence here means a styled render would silently draw different
// geometry than the crisp output shows — the regex-era blindness the IR
// exists to eliminate (SPEC §3.1).
//
// Runs the full layout-compare corpus through every registered lowerScene
// hook (replicating the index.ts dispatch plumbing) and reports every
// unfaithful mark, not just the first.

import { describe, test, expect } from 'bun:test'
import { decodeXML } from 'entities'
import { getFamily } from '../render-family-hooks.ts'
import type { DiagramKind } from '../agent/types.ts'
import type { FamilyLayoutResult } from '../agent/families.ts'
import type { PositionedDiagram, RenderOptions } from '../types.ts'
import { normalizeMermaidSource, detectDiagramTypeFromFirstLine } from '../mermaid-source.ts'
import { readThemeValue, resolveDiagramColors } from '../color-resolver.ts'
import { sceneFidelityProblems } from '../scene/fidelity.ts'
import { DefaultBackend } from '../scene/backend.ts'
import type { SceneDoc } from '../scene/ir.ts'
import { collectSamples } from '../../eval/layout-compare/run.ts'

interface Lowered {
  id: string
  family: string
  doc: SceneDoc
  renderSvgOutput: string
}

/** Mirror the renderMermaidSVG dispatch up to the family renderSvg/lowerScene
 *  calls (before the resolve() post-pass, which is scene-independent). */
function lowerSample(source: string, options: RenderOptions = {}): { doc: SceneDoc; renderSvgOutput: string } | undefined {
  const text = decodeXML(source)
  const normalizedSource = normalizeMermaidSource(text, options.mermaidConfig ?? {})
  const font = options.font
    ?? normalizedSource.config.fontFamily
    ?? readThemeValue(normalizedSource.config.themeVariables, 'fontFamily')
    ?? 'Inter'
  const colors = resolveDiagramColors(options, normalizedSource.config, font)
  const diagramType = detectDiagramTypeFromFirstLine(normalizedSource.firstLine) ?? 'flowchart'
  const family = getFamily(diagramType as DiagramKind)
  if (!family?.layout || !family.renderSvg || !family.lowerScene) return undefined
  const renderOptions: RenderOptions = { ...options, mermaidConfig: normalizedSource.config }
  let layout: FamilyLayoutResult
  try {
    const result = family.layout({ source: normalizedSource, options, renderOptions, colors })
    layout = 'positioned' in result ? result as FamilyLayoutResult : { positioned: result as PositionedDiagram }
  } catch {
    return undefined // diagrams that legitimately fail are the equivalence gate's concern
  }
  const ctx = {
    positioned: layout.positioned,
    colors: layout.colors ?? colors,
    options: layout.options ?? renderOptions,
  }
  return { doc: family.lowerScene(ctx), renderSvgOutput: family.renderSvg(ctx) }
}

function lowerAll(): Lowered[] {
  const out: Lowered[] = []
  for (const sample of collectSamples()) {
    const lowered = lowerSample(sample.source)
    if (lowered) out.push({ id: sample.id, family: sample.family, ...lowered })
  }
  return out
}

describe('scene fidelity', () => {
  const scenes = lowerAll()

  test('the corpus exercises at least one lowered family', () => {
    expect(scenes.length).toBeGreaterThan(0)
  })

  test('semantic fields agree with crisp serialization for every lowered mark', () => {
    const problems: string[] = []
    for (const scene of scenes) {
      for (const problem of sceneFidelityProblems(scene.doc)) {
        problems.push(`${scene.id}: ${problem}`)
      }
    }
    if (problems.length > 0) {
      throw new Error(`scene fidelity violations (${problems.length}):\n` + problems.slice(0, 40).join('\n'))
    }
  })

  test('DefaultBackend serialization of the lowered scene is the rendered SVG', () => {
    for (const scene of scenes) {
      const serialized = DefaultBackend.render(scene.doc, { seed: 0 })
      if (serialized !== scene.renderSvgOutput) {
        throw new Error(`DefaultBackend drift for ${scene.id} (family ${scene.family})`)
      }
    }
  })
})
