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
// scope here. Typed local gradient references are resolved through the Scene
// definitions and sampled across the ribbon so adding a paint server cannot
// accidentally make this gate vacuous.

import { describe, expect, test } from 'bun:test'
// Registers the default scene backend (resolveRenderRequest needs its
// capability set satisfied before any lowering can be planned).
import '../index.ts'
import { type BuiltinFamilyId, getFamily, knownBuiltinFamilies } from '../agent/families.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../palette-catalog.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { resolveRenderRequest } from '../render-contract.ts'
import type { LinearGradientDescriptor, SceneDoc, SceneNode } from '../scene/ir.ts'
import { SECTION_B_FAMILY_CENSUS_FIXTURES } from '../scene/section-b-census-fixtures.ts'
import { validateSceneDoc } from '../scene/scene-validation.ts'
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
  colors: string[]
  opacity: number
  mixBlendMode: 'normal' | 'multiply'
}

function concreteHex(color: string): string | undefined {
  const rgba = tryParseCssColor(color)
  return rgba && rgba[3] === 1 ? toHex(rgba[0], rgba[1], rgba[2]) : undefined
}

function sampleGradient(gradient: LinearGradientDescriptor): string[] {
  const samples: string[] = []
  for (const offset of [0, 0.25, 0.5, 0.75, 1]) {
    const rightIndex = gradient.stops.findIndex(stop => stop.offset >= offset)
    const right = gradient.stops[rightIndex < 0 ? gradient.stops.length - 1 : rightIndex]!
    const left = gradient.stops[Math.max(0, (rightIndex < 0 ? gradient.stops.length : rightIndex) - 1)]!
    const leftHex = concreteHex(left.color)
    const rightHex = concreteHex(right.color)
    if (!leftHex || !rightHex) continue
    const span = right.offset - left.offset
    const local = span > 0 ? (offset - left.offset) / span : 1
    samples.push(mixHex(rightHex, leftHex, Math.max(0, Math.min(1, local)) * 100))
  }
  return samples
}

function translucentConnectors(scene: SceneDoc): TranslucentConnector[] {
  const out: TranslucentConnector[] = []
  const gradients = new Map<string, LinearGradientDescriptor>()
  visitScene(scene.parts, node => {
    if (node.kind === 'document') {
      for (const gradient of node.gradientResources ?? []) gradients.set(gradient.id, gradient)
    }
  })
  visitScene(scene.parts, node => {
    if (node.kind !== 'connector') return
    const opacity = node.stroke.opacity === undefined ? 1 : Number(node.stroke.opacity)
    if (!(opacity < 1)) return
    const resource = /^url\(#([^)]+)\)$/.exec(node.stroke.color)?.[1]
    const gradient = resource ? gradients.get(resource) : undefined
    out.push({
      id: node.id,
      colors: gradient ? sampleGradient(gradient) : [node.stroke.color],
      opacity,
      mixBlendMode: node.stroke.mixBlendMode ?? 'normal',
    })
  })
  return out
}

function expectCompositedVisible(mark: TranslucentConnector, bg: string, where: string): void {
  const bgRgba = tryParseCssColor(bg)
  if (!bgRgba || bgRgba[3] !== 1) return
  const bgHex = toHex(bgRgba[0], bgRgba[1], bgRgba[2])
  for (const color of mark.colors) {
    const strokeHex = concreteHex(color)
    if (!strokeHex) continue
    const blended = mark.mixBlendMode === 'multiply' ? multiplyHex(strokeHex, bgHex) : strokeHex
    const effective = mixHex(blended, bgHex, mark.opacity * 100)
    expect({ where, mark: mark.id, color, wcagOk: wcagContrastRatio(effective, bgHex)! >= 1.25, apcaOk: apcaContrast(effective, bgHex)! >= 15 }).toEqual({ where, mark: mark.id, color, wcagOk: true, apcaOk: true })
  }
}

function multiplyHex(foreground: string, background: string): string {
  const fg = tryParseCssColor(foreground)!
  const bg = tryParseCssColor(background)!
  return toHex(fg[0] * bg[0] / 255, fg[1] * bg[1] / 255, fg[2] * bg[2] / 255)
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
    const marks = translucentConnectors(scene)
    expect(marks.length).toBeGreaterThanOrEqual(4)
    expect(marks.every(mark => mark.colors.length === 5)).toBe(true)
  })

  test('sankey dark-page ribbons use normal compositing because multiply cannot brighten a dark backdrop', () => {
    const { scene, bg } = lowerScene('sankey', SECTION_B_FAMILY_CENSUS_FIXTURES.sankey!, { bg: '#071823', fg: '#e6edf3', accent: '#2dd4bf' })
    const marks = translucentConnectors(scene)
    expect(marks.length).toBeGreaterThanOrEqual(4)
    expect(marks.every(mark => mark.mixBlendMode === 'normal')).toBe(true)
    for (const mark of marks) expectCompositedVisible(mark, bg, 'sankey (dark theme)')
  })

  test('sankey local gradient references are declared and dangling references fail validation', () => {
    const { scene } = lowerScene('sankey', SECTION_B_FAMILY_CENSUS_FIXTURES.sankey!)
    expect(validateSceneDoc(scene)).toEqual({ valid: true, diagnostics: [] })

    const forged = structuredClone(scene)
    const connector = forged.parts.find(node => node.kind === 'connector')
    if (!connector || connector.kind !== 'connector') throw new Error('missing sankey connector')
    connector.stroke.color = 'url(#missing-gradient)'
    expect(validateSceneDoc(forged).diagnostics).toContainEqual(expect.objectContaining({
      code: 'SCENE_REFERENCE',
      message: 'references undeclared gradient "missing-gradient"',
    }))
  })

  test('external Scene admission rejects local paint references', () => {
    const { scene } = lowerScene('sankey', SECTION_B_FAMILY_CENSUS_FIXTURES.sankey!)
    expect(validateSceneDoc(scene, { mode: 'external' }).diagnostics).toContainEqual(expect.objectContaining({
      code: 'SCENE_PAINT',
      message: 'must be a safe non-fetching CSS paint',
    }))
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
