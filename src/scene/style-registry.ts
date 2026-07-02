// ============================================================================
// Aesthetic style registry (SPEC §3.3/§3.5) — a style is DATA that selects a
// backend, palette, fonts, and parameters. Registered once, a style applies to
// every diagram family that lowers to the SceneGraph — N styles + M families,
// never N×M wiring. Mirrors the THEMES record in theme.ts.
//
// The public RenderOptions.aesthetic selects a registered style by name;
// 'crisp' (or unset) is the byte-identical DefaultBackend path.
// ============================================================================

import type { DiagramStyleOptions } from '../types.ts'

export interface AestheticStyle {
  name: string
  label: string
  blurb: string
  /** Which StyleBackend serializes the scene. 'default' = crisp geometry with
   *  this style's palette/typography only. */
  backend: 'default' | 'rough' | 'hybrid'
  intent: 'premium' | 'draft' | 'lofi'
  density: 'delicate' | 'normal' | 'bold'

  /** Palette defaults — compose with the user's theme: any channel the user
   *  sets via RenderOptions/themeVariables wins over these. */
  colors: { bg: string; fg: string; line?: string; accent?: string; muted?: string; surface?: string; border?: string }
  /** Font family default (threaded through the --font CSS variable). PNG
   *  export needs the family bundled or resolvable by the rasterizer. */
  font?: string
  /** Role-style defaults merged UNDER the user's RenderOptions.style. */
  style?: DiagramStyleOptions

  // Rough/hybrid backend parameters (ignored by 'default').
  roughness?: number
  bowing?: number
  /** 1 = single stroke (disableMultiStroke), 2 = sketchy double stroke. */
  passes?: number
  strokeWidth?: number
  fill?: 'none' | 'hachure' | 'solid'
  hachureAngle?: number
  hachureGap?: number
  fillWeight?: number
  /** Flat page furniture drawn right after the document prelude. */
  backdrop?: 'plain' | 'paper-ruled' | 'grid'
  /** §3.8 monochrome contract: tone via shading/weight, never extra hues. */
  mono?: boolean
}

const AESTHETICS = new Map<string, AestheticStyle>()

export function registerAesthetic(spec: AestheticStyle): void {
  AESTHETICS.set(spec.name, spec)
}

export function getAesthetic(name: string): AestheticStyle | undefined {
  return AESTHETICS.get(name)
}

export function knownAesthetics(): string[] {
  return ['crisp', ...AESTHETICS.keys()]
}

// ----------------------------------------------------------------------------
// Built-in styles (Phase 3 set — the four that exercise the design: rough
// jitter, hachure fill, mono contract, and a default-backend palette style).
// Parameters were converged in the prototype (scripts/sketch-prototype).
// ----------------------------------------------------------------------------

registerAesthetic({
  name: 'hand-drawn',
  label: 'Hand-drawn (notebook)',
  blurb: 'Black ink on ruled paper — wobbly double strokes, unfilled boxes.',
  backend: 'rough',
  intent: 'draft',
  density: 'normal',
  colors: { bg: '#f7f5ef', fg: '#1a1a1e', line: '#26262b', accent: '#26262b', border: '#26262b' },
  font: 'Caveat',
  roughness: 1.0,
  bowing: 1,
  passes: 2,
  strokeWidth: 1.8,
  fill: 'none',
  backdrop: 'paper-ruled',
  mono: true,
})

registerAesthetic({
  name: 'excalidraw',
  label: 'Excalidraw',
  blurb: 'Virtual whiteboard look — rough strokes, pastel hachure fills.',
  backend: 'rough',
  intent: 'draft',
  density: 'normal',
  colors: { bg: '#ffffff', fg: '#1e1e1e', line: '#1e1e1e', accent: '#4263eb', surface: '#f1f3f5' },
  font: 'Caveat',
  roughness: 1.1,
  bowing: 1.2,
  passes: 2,
  strokeWidth: 1.6,
  fill: 'hachure',
  hachureAngle: -41,
  hachureGap: 5.5,
  fillWeight: 0.9,
  backdrop: 'plain',
  mono: false,
})

registerAesthetic({
  name: 'pen-and-ink',
  label: 'Pen & ink',
  blurb: 'Fine single-pass linework on warm cream — no interior hatching.',
  backend: 'rough',
  intent: 'premium',
  density: 'delicate',
  colors: { bg: '#faf6ec', fg: '#241f1a', line: '#2b241d', accent: '#2b241d', border: '#2b241d' },
  font: 'EB Garamond',
  roughness: 0.5,
  bowing: 0.6,
  passes: 1,
  strokeWidth: 1.5,
  fill: 'none',
  backdrop: 'plain',
  mono: true,
})

registerAesthetic({
  name: 'tufte',
  label: 'Tufte (minimal)',
  blurb: 'Maximal data-ink: crisp hairlines, warm paper, one red accent.',
  backend: 'default',
  intent: 'premium',
  density: 'delicate',
  colors: { bg: '#fffff8', fg: '#111111', line: '#4a4a45', accent: '#a00000', muted: '#6b6b64', border: '#8a8a80' },
  font: 'EB Garamond',
  style: {
    node: { lineWidth: 0.8, cornerRadius: 0 },
    edge: { lineWidth: 0.8 },
    group: { lineWidth: 0.8 },
  },
  mono: true,
})
