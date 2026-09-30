// Scene-fidelity gate: for every family with a SceneGraph lowering, the
// semantic fields on each mark (geometry, markers, text) must agree with the
// mark's canonical serialization. Styled backends redraw from the semantic fields,
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
import { BUILTIN_RENDER_HOOKS } from '../render-family-hooks.ts'

interface Lowered {
  id: string
  family: string
  doc: SceneDoc
}

/** Mirror the built-in renderMermaidSVG dispatch through its sole graphical
 * waist (before the resolve() post-pass, which is scene-independent). */
function lowerSample(source: string, options: RenderOptions = {}): { doc: SceneDoc } | { dropped: string } | undefined {
  let request: ReturnType<typeof resolveRenderRequest>
  let family: ReturnType<typeof resolvedRenderExecutionPlanOf>['family']
  let layout: ReturnType<typeof positionResolvedFamily>
  try {
    request = resolveRenderRequest(source, options, 'svg')
    family = resolvedRenderExecutionPlanOf(request).family
    if (!family?.layout || !family.lowerScene) return undefined
    layout = positionResolvedFamily(family.id, request)
  } catch (error) {
    // Diagrams that legitimately fail are the equivalence gate's concern, but
    // every drop is recorded so a layout regression cannot shrink the corpus.
    return { dropped: error instanceof Error ? error.message : String(error) }
  }
  const ctx = {
    positioned: layout.positioned,
    colors: request.appearance.colors,
    resolved: {
      renderOptions: request.renderOptions,
      ...(request.appearance.face ? { styleFace: request.appearance.face } : {}),
      ...(request.familyConfig ? { familyConfig: request.familyConfig } : {}),
      ...(request.appearance.family ? { familyAppearance: request.appearance.family } : {}),
    },
  }
  return { doc: family.lowerScene(ctx) }
}

function lowerAll(): { scenes: Lowered[]; dropped: Array<{ id: string; reason: string }> } {
  const scenes: Lowered[] = []
  const dropped: Array<{ id: string; reason: string }> = []
  for (const sample of collectSamples()) {
    const lowered = lowerSample(sample.source)
    if (!lowered) continue
    if ('dropped' in lowered) dropped.push({ id: sample.id, reason: lowered.dropped })
    else scenes.push({ id: sample.id, family: sample.family, ...lowered })
  }
  return { scenes, dropped }
}

describe('scene fidelity', () => {
  const { scenes, dropped } = lowerAll()

  test('the corpus exercises every built-in family with a scene lowering', () => {
    const lowering = Object.entries(BUILTIN_RENDER_HOOKS).filter(([, hooks]) => 'lowerScene' in hooks).map(([id]) => id).sort()
    expect(lowering.length).toBeGreaterThan(0)
    expect([...new Set(scenes.map(scene => scene.family))].sort()).toEqual(lowering)
  })

  test('only the known-unrenderable corpus samples drop out before lowering', () => {
    // gantt/6 has no tasks (GANTT_EMPTY, correct). gantt/10 is BUG-34: a task
    // line with a trailing `%% comment` fails with GANTT_BAD_DATE. Its
    // frontmatter also carries raw `themeCSS`, which the default security
    // mode refuses; that frontmatter was ignored until it was read as Mermaid
    // reads it (BUG-28), so fixing BUG-34 alone no longer makes it lower.
    expect(dropped.map(sample => sample.id).sort()).toEqual(['corpus/gantt/10', 'corpus/gantt/6'])
  })

  test('semantic fields agree with canonical serialization for every lowered mark', () => {
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

  test('public Scene nodes expose no serialization carriers', () => {
    const violations: string[] = []
    const visit = (node: SceneDoc['parts'][number], family: string): void => {
      for (const key of ['crisp', 'raw', 'prelude']) {
        if (Object.prototype.hasOwnProperty.call(node, key)) violations.push(`${family}:${node.id}:${key}`)
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
