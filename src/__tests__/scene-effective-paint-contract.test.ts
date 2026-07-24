// Scene-tier EFFECTIVE-paint contract — registry-driven enforcement.
//
// Root cause this closes (found during the sankey addition): the palette's
// WCAG/APCA visibility floors are enforced where colors are GENERATED
// (categorical-palette, under an implicit opaque-mark assumption), and no gate
// re-checked visibility where opacity is APPLIED — the scene. Sankey's ribbons
// were the repo's first translucent sole-encoding marks and composited to
// invisible (WCAG ≈1.0, APCA 0) on several built-in backgrounds without any
// test noticing. This gate enumerates families from the registry, so the NEXT
// family with translucent connectors is bound the moment it registers instead
// of relying on someone hand-writing a reach test.
//
// Scope, deliberately: CONNECTOR marks. A translucent connector is its
// relation's only encoding — there is no opaque companion mark. Translucent
// SHAPE fills (radar areas, sequence activations) pair with opaque outlines,
// beads, or labels by the L4 discipline, so their raw-paint floors remain the
// generation-side contract. Paints that do not parse to concrete sRGB (CSS
// vars, authored color-mix) are resolved downstream and are out of measurable
// scope here — the sankey derived path emits concrete hex precisely so this
// gate can measure it.

import { describe, expect, test } from 'bun:test'
// Registers the default scene backend (resolveRenderRequest needs its
// capability set satisfied before any lowering can be planned).
import '../index.ts'
import { type BuiltinFamilyId, getFamily, knownBuiltinFamilies } from '../agent/families.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../palette-catalog.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { resolveRenderRequest } from '../render-contract.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import { SECTION_B_FAMILY_CENSUS_FIXTURES } from '../scene/section-b-census-fixtures.ts'
import { mixHex, toHex, tryParseCssColor, wcagContrastRatio } from '../shared/color-math.ts'
import { apcaContrast } from '../shared/perceptual-color.ts'
import type { RenderContext, RenderOptions } from '../types.ts'

function lowerScene(id: BuiltinFamilyId, source: string, options: RenderOptions = {}): { scene: SceneDoc; bg: string } {
  const descriptor = getFamily(id)!
  const request = resolveRenderRequest(source, options, 'svg')
  const result = positionResolvedFamily(id, request)
  const context: RenderContext = {
    positioned: result.positioned,
    colors: request.appearance.colors,
    resolved: {
      renderOptions: request.renderOptions,
      ...(request.appearance.face ? { styleFace: request.appearance.face } : {}),
      ...(request.familyConfig ? { familyConfig: request.familyConfig } : {}),
      ...(request.appearance.family ? { familyAppearance: request.appearance.family } : {}),
    },
  }
  return { scene: descriptor.lowerScene!(context), bg: request.appearance.colors.bg }
}

function visitScene(nodes: readonly SceneNode[], visit: (node: SceneNode) => void): void {
  for (const node of nodes) {
    visit(node)
    if (node.kind === 'group')
      visitScene(
        node.children.map(child => child.node),
        visit,
      )
  }
}

interface TranslucentConnector {
  id: string
  color: string
  opacity: number
}

function translucentConnectors(scene: SceneDoc): TranslucentConnector[] {
  const out: TranslucentConnector[] = []
  visitScene(scene.parts, node => {
    if (node.kind !== 'connector') return
    const opacity = node.stroke.opacity === undefined ? 1 : Number(node.stroke.opacity)
    if (!(opacity < 1)) return
    out.push({ id: node.id, color: node.stroke.color, opacity })
  })
  return out
}

function expectCompositedVisible(mark: TranslucentConnector, bg: string, where: string): void {
  const strokeRgba = tryParseCssColor(mark.color)
  const bgRgba = tryParseCssColor(bg)
  if (!strokeRgba || strokeRgba[3] !== 1 || !bgRgba || bgRgba[3] !== 1) return
  const bgHex = toHex(bgRgba[0], bgRgba[1], bgRgba[2])
  const effective = mixHex(toHex(strokeRgba[0], strokeRgba[1], strokeRgba[2]), bgHex, mark.opacity * 100)
  expect({ where, mark: mark.id, wcagOk: wcagContrastRatio(effective, bgHex)! >= 1.25, apcaOk: apcaContrast(effective, bgHex)! >= 15 }).toEqual({ where, mark: mark.id, wcagOk: true, apcaOk: true })
}

describe('scene effective-paint contract (translucent connectors)', () => {
  test('every registered family: translucent connector strokes composite to a visible color', () => {
    for (const id of knownBuiltinFamilies()) {
      const source = SECTION_B_FAMILY_CENSUS_FIXTURES[id] ?? getFamily(id)!.example
      const { scene, bg } = lowerScene(id, source)
      for (const mark of translucentConnectors(scene)) {
        expectCompositedVisible(mark, bg, `${id} (default theme)`)
      }
    }
  })

  test('the gate is not vacuous: the sankey census scene carries translucent connectors', () => {
    const { scene } = lowerScene('sankey', SECTION_B_FAMILY_CENSUS_FIXTURES.sankey!)
    expect(translucentConnectors(scene).length).toBeGreaterThanOrEqual(4)
  })

  test('sankey holds the contract across every built-in palette and derived link mode', () => {
    const source = (mode: string) => `---\nconfig:\n  sankey:\n    linkColor: ${mode}\n---\n${SECTION_B_FAMILY_CENSUS_FIXTURES.sankey!.split('---\n').at(-1)!}`
    for (const { inputName, colors: theme } of BUILTIN_PALETTE_DEFINITIONS) {
      for (const mode of ['source', 'target', 'gradient']) {
        const { scene, bg } = lowerScene('sankey', source(mode), {
          bg: theme.bg,
          fg: theme.fg,
          accent: 'accent' in theme ? theme.accent : theme.fg,
        } as RenderOptions)
        const marks = translucentConnectors(scene)
        expect(marks.length).toBeGreaterThanOrEqual(4)
        for (const mark of marks) {
          expectCompositedVisible(mark, bg, `sankey ${inputName} linkColor=${mode}`)
        }
      }
    }
  })
})
