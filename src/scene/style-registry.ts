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
  /** Stroke rendering: 'jittered' rough.js strokes (default) or 'freehand'
   *  pressure-ribbon strokes (hybrid backend only). */
  stroke?: 'jittered' | 'freehand'
  roughness?: number
  bowing?: number
  /** 1 = single stroke (disableMultiStroke), 2 = sketchy double stroke. */
  passes?: number
  strokeWidth?: number
  fill?: 'none' | 'hachure' | 'solid' | 'wash'
  hachureAngle?: number
  hachureGap?: number
  fillWeight?: number
  /** Wash fill glaze opacity / edge-darkening opacity (fill: 'wash'). */
  washOpacity?: number
  washEdge?: number
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
  name: 'freehand',
  label: 'Freehand',
  blurb: 'Pressure-sensitive marker ribbons — variable-width filled strokes.',
  backend: 'hybrid',
  intent: 'draft',
  density: 'bold',
  colors: { bg: '#fbfaf7', fg: '#16161a', line: '#1d1d22', accent: '#1d1d22', border: '#1d1d22' },
  font: 'Architects Daughter',
  stroke: 'freehand',
  roughness: 0.9,
  passes: 1,
  strokeWidth: 1.6,
  fill: 'none',
  backdrop: 'plain',
  mono: true,
})

registerAesthetic({
  name: 'watercolor',
  label: 'Watercolor',
  blurb: 'Rough outlines over translucent glazes with pigment-pooled edges.',
  backend: 'hybrid',
  intent: 'premium',
  density: 'normal',
  colors: { bg: '#fdfbf6', fg: '#31302c', line: '#4d4a44', accent: '#7a6a52', surface: '#ead9b9', border: '#5a564e' },
  font: 'Caveat',
  stroke: 'jittered',
  roughness: 0.9,
  bowing: 0.8,
  passes: 1,
  strokeWidth: 1.5,
  fill: 'wash',
  washOpacity: 0.3,
  washEdge: 0.34,
  backdrop: 'plain',
  mono: false,
})

registerAesthetic({
  name: 'blueprint',
  label: 'Blueprint',
  blurb: 'Cyanotype: white linework on Prussian blue with a drafting grid.',
  backend: 'rough',
  intent: 'premium',
  density: 'bold',
  colors: { bg: '#123a63', fg: '#eaf2fb', line: '#dbe9f7', accent: '#ffffff', muted: '#b8cfe6', surface: '#1c4a78', border: '#dbe9f7' },
  font: 'Share Tech Mono',
  roughness: 0.4,
  bowing: 0.4,
  passes: 1,
  strokeWidth: 1.4,
  fill: 'none',
  backdrop: 'grid',
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
