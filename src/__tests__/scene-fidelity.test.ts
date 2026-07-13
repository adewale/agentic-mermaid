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
import type { RenderOptions } from '../types.ts'
import { sceneFidelityProblems } from '../scene/fidelity.ts'
import { DefaultBackend } from '../scene/backend.ts'
import type { SceneDoc } from '../scene/ir.ts'
import { collectSamples } from '../../eval/layout-compare/run.ts'
import { resolveRenderRequest, resolvedRenderExecutionPlanOf } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'

interface Lowered {
  id: string
  family: string
  doc: SceneDoc
}

/** Mirror the built-in renderMermaidSVG dispatch through its sole graphical
 * waist (before the resolve() post-pass, which is scene-independent). */
function lowerSample(source: string, options: RenderOptions = {}): { doc: SceneDoc } | undefined {
  const request = resolveRenderRequest(source, options, 'svg')
  const family = resolvedRenderExecutionPlanOf(request).family
  if (!family?.layout || !family.lowerScene) return undefined
  let layout: ReturnType<typeof positionResolvedFamily>
  try {
    layout = positionResolvedFamily(family.id, request)
  } catch {
    return undefined // diagrams that legitimately fail are the equivalence gate's concern
  }
  const ctx = {
    positioned: layout.positioned,
    colors: request.appearance.colors,
    options: request.renderOptions,
  }
  return { doc: family.lowerScene(ctx) }
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

  test('document furniture and definitions do not regress to RawMark', () => {
    const violations: string[] = []
    const visit = (node: SceneDoc['parts'][number], family: string): void => {
      if (node.kind === 'raw' && (node.role === 'defs' || node.id === 'svg-close' || ((family === 'mindmap' || family === 'gitgraph') && (node.id === 'acc-title' || node.id === 'acc-desc')))) {
        violations.push(`${family}:${node.id}`)
      }
      if (node.kind === 'group') for (const child of node.children) visit(child.node, family)
    }
    for (const scene of scenes) for (const part of scene.doc.parts) visit(part, scene.family)
    expect(violations).toEqual([])
  })

  test('DefaultBackend deterministically serializes every lowered scene', () => {
    for (const scene of scenes) {
      const first = DefaultBackend.render(scene.doc, { seed: 0 })
      const second = DefaultBackend.render(scene.doc, { seed: 0 })
      expect(second, `${scene.id} (${scene.family})`).toBe(first)
      expect(first, `${scene.id} (${scene.family})`).toContain('<svg')
      expect(first, `${scene.id} (${scene.family})`).not.toMatch(/NaN|undefined/)
    }
  })
})
