// ============================================================================
// Thirteen aesthetic styles, expressed as DATA.
//
// A Style composes four orthogonal strategies (the pluggable seam — see SPEC):
//   stroke : how an outline/edge is drawn
//   fill   : how a region is shaded (tone-driven)
//   backdrop: the "page"
//   postfx : palette + svg filters/compositing
//
// Adding a style = adding one record here. No engine changes required.
// ============================================================================

export type StrokeKind = 'crisp' | 'jittered' | 'brush' | 'pencil'
export type FillKind = 'none' | 'hachure' | 'crosshatch' | 'stipple' | 'halftone' | 'wash' | 'scribble' | 'solid'
export type BackdropKind = 'paper-ruled' | 'plain' | 'rice' | 'washi' | 'grid' | 'slate'

export interface Style {
  name: string
  label: string
  blurb: string
  colors: { bg: string; fg: string; line: string; accent: string; muted: string; surface: string; border: string }
  font: string
  fontFile: string

  stroke: StrokeKind
  roughness: number
  passes: number
  strokeWidth: number
  brushWidth?: number
  linecap: 'round' | 'butt'
  strokeOpacity?: number

  fill: FillKind
  fillColor: string
  baseTone: number        // floor tone applied to every region (so boxes aren't empty)
  toneFromLuminance: boolean
  keepHue: boolean        // watercolor: fill with the original region colour
  hachureAngle: number

  backdrop: BackdropKind
  defs?: string
  strokeFilter?: string
  fillFilter?: string     // distress filter applied to solid fills (screenprint)
  seal?: boolean
  misregister?: number    // riso: duplicate strokes offset in a 2nd colour
  misColor?: string
  spotPalette?: string[]  // solid fill: pick a flat spot colour per region (seeded)
  glowColor?: string      // offset drop-glow behind filled shapes (screenprint registration)
  glowOffset?: number
  labelHalo?: string      // override the text knockout colour (default: page bg)
  labelInk?: string       // override the label ink (default: auto-contrast vs halo)
}

const BLUE = '#1f3a8a', BLACK = '#161616', SUMI = '#1c1c1c'

export const STYLES: Style[] = [
  {
    name: 'hand-drawn', label: 'Hand-drawn (notebook)',
    blurb: 'Blue ballpoint on ruled paper. Damped-bow double strokes, tonal hachure.',
    colors: { bg: '#fbfaf3', fg: BLUE, line: BLUE, accent: BLUE, muted: '#5566aa', surface: '#fbfaf3', border: BLUE },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    stroke: 'jittered', roughness: 1.5, passes: 2, strokeWidth: 1.6, linecap: 'round',
    fill: 'hachure', fillColor: BLUE, baseTone: 0.18, toneFromLuminance: true, keepHue: false, hachureAngle: -41,
    backdrop: 'paper-ruled',
  },
  {
    name: 'pen-and-ink', label: 'Pen & ink',
    blurb: 'Fine confident lines; tone built from cross-hatch density. Black on white.',
    colors: { bg: '#ffffff', fg: BLACK, line: BLACK, accent: BLACK, muted: '#444', surface: '#ffffff', border: BLACK },
    font: 'EB Garamond', fontFile: 'EBGaramond.ttf',
    stroke: 'jittered', roughness: 0.5, passes: 1, strokeWidth: 1.0, linecap: 'butt',
    fill: 'crosshatch', fillColor: BLACK, baseTone: 0.18, toneFromLuminance: true, keepHue: false, hachureAngle: -45,
    backdrop: 'plain',
  },
  {
    name: 'tufte', label: 'Tufte (minimal)',
    blurb: 'Maximum data-ink: hairline strokes, no fills, serif type, quiet page.',
    colors: { bg: '#fffff8', fg: '#111', line: '#bbb', accent: '#7a0000', muted: '#888', surface: '#fffff8', border: '#cfcfcf' },
    font: 'EB Garamond', fontFile: 'EBGaramond.ttf',
    stroke: 'crisp', roughness: 0, passes: 1, strokeWidth: 0.7, linecap: 'butt',
    fill: 'none', fillColor: '#000', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -45,
    backdrop: 'plain',
  },
  {
    name: 'chinese-brush', label: 'Chinese paintbrush',
    blurb: 'Tapered brushwork (variable-width ribbons), ink-wash fills, rice paper, a red seal.',
    colors: { bg: '#f3ece0', fg: '#1a1a1a', line: '#1a1a1a', accent: '#b22222', muted: '#555', surface: '#f3ece0', border: '#1a1a1a' },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    stroke: 'brush', roughness: 1.0, passes: 1, strokeWidth: 3, brushWidth: 7, linecap: 'round',
    fill: 'wash', fillColor: '#2b2b2b', baseTone: 0.14, toneFromLuminance: true, keepHue: false, hachureAngle: -41,
    backdrop: 'rice', seal: true,
  },
  {
    name: 'sumi-e', label: 'Sumi-e (ink wash)',
    blurb: 'Sparse monochrome brush gestures, soft ink bleed, generous empty space.',
    colors: { bg: '#f7f5ef', fg: SUMI, line: SUMI, accent: SUMI, muted: '#666', surface: '#f7f5ef', border: SUMI },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    stroke: 'brush', roughness: 1.3, passes: 1, strokeWidth: 2.4, brushWidth: 6, linecap: 'round',
    fill: 'wash', fillColor: SUMI, baseTone: 0.08, toneFromLuminance: true, keepHue: false, hachureAngle: -41,
    backdrop: 'washi',
    defs: '<filter id="sumi-bleed" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="0.7"/></filter>',
    strokeFilter: 'sumi-bleed',
  },
  // ---- the 8 new styles ----
  {
    name: 'blueprint', label: 'Blueprint',
    blurb: 'White ink on cyanotype ground, drafting grid, precise thin lines.',
    colors: { bg: '#10497e', fg: '#eaf3ff', line: '#eaf3ff', accent: '#ffffff', muted: '#bcd6f0', surface: '#10497e', border: '#dfeeff' },
    font: 'EB Garamond', fontFile: 'EBGaramond.ttf',
    stroke: 'jittered', roughness: 0.35, passes: 1, strokeWidth: 1.1, linecap: 'butt',
    fill: 'none', fillColor: '#eaf3ff', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -45,
    backdrop: 'grid',
  },
  {
    name: 'watercolor', label: 'Watercolor',
    blurb: 'Layered translucent glazes with edge-darkening; colour leads. (Curtis-style fake.)',
    colors: { bg: '#fdfbf6', fg: '#3a3a3a', line: '#52606d', accent: '#c0653a', muted: '#8a8a8a', surface: '#eaf2f8', border: '#7a93a8' },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    stroke: 'jittered', roughness: 1.1, passes: 1, strokeWidth: 1.3, linecap: 'round', strokeOpacity: 0.8,
    fill: 'wash', fillColor: '#6fa8c7', baseTone: 0.5, toneFromLuminance: false, keepHue: true, hachureAngle: -41,
    backdrop: 'plain',
    defs: '<filter id="wc-grain"><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.05 0"/></filter>',
  },
  {
    name: 'stipple', label: 'Stipple engraving',
    blurb: 'Tone built from blue-noise dot density. Old-textbook / banknote feel.',
    colors: { bg: '#f6f1e7', fg: '#2a2620', line: '#2a2620', accent: '#5a2d1a', muted: '#6b6356', surface: '#f6f1e7', border: '#2a2620' },
    font: 'EB Garamond', fontFile: 'EBGaramond.ttf',
    stroke: 'jittered', roughness: 0.3, passes: 1, strokeWidth: 0.8, linecap: 'butt',
    fill: 'stipple', fillColor: '#2a2620', baseTone: 0.18, toneFromLuminance: true, keepHue: false, hachureAngle: -41,
    backdrop: 'plain',
  },
  {
    name: 'comic-halftone', label: 'Comic / halftone',
    blurb: 'Bold ink outlines and Ben-Day dots whose radius tracks tone.',
    colors: { bg: '#fffef7', fg: '#111', line: '#111', accent: '#d11', muted: '#444', surface: '#fffef7', border: '#111' },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    stroke: 'jittered', roughness: 0.8, passes: 2, strokeWidth: 2.4, linecap: 'round',
    fill: 'halftone', fillColor: '#111', baseTone: 0.16, toneFromLuminance: true, keepHue: false, hachureAngle: 30,
    backdrop: 'plain',
  },
  {
    name: 'chalkboard', label: 'Chalkboard',
    blurb: 'Dusty light strokes on slate; loose scribble shading.',
    colors: { bg: '#22312c', fg: '#eef3ee', line: '#dfe8df', accent: '#f4d35e', muted: '#9fb4a4', surface: '#22312c', border: '#e6efe6' },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    stroke: 'pencil', roughness: 1.8, passes: 2, strokeWidth: 1.5, linecap: 'round', strokeOpacity: 0.85,
    fill: 'scribble', fillColor: '#dfe8df', baseTone: 0.16, toneFromLuminance: true, keepHue: false, hachureAngle: -38,
    backdrop: 'slate',
    defs: '<filter id="chalk"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.6"/></filter>',
    strokeFilter: 'chalk',
  },
  {
    name: 'woodcut', label: 'Woodcut / linocut',
    blurb: 'High-contrast carved lines; tone ONLY from line spacing, never grey.',
    colors: { bg: '#f4ecd8', fg: '#161210', line: '#161210', accent: '#161210', muted: '#161210', surface: '#f4ecd8', border: '#161210' },
    font: 'EB Garamond', fontFile: 'EBGaramond.ttf',
    stroke: 'jittered', roughness: 0.9, passes: 1, strokeWidth: 2.6, linecap: 'butt',
    fill: 'hachure', fillColor: '#161210', baseTone: 0.18, toneFromLuminance: true, keepHue: false, hachureAngle: -90,
    backdrop: 'plain',
  },
  {
    name: 'risograph', label: 'Risograph',
    blurb: 'Two-ink overprint with deliberate misregistration and paper grain.',
    colors: { bg: '#f4efe6', fg: '#2b2b8f', line: '#2b2b8f', accent: '#ff5a5f', muted: '#6a6ab0', surface: '#f4efe6', border: '#2b2b8f' },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    stroke: 'jittered', roughness: 0.7, passes: 1, strokeWidth: 1.8, linecap: 'round',
    fill: 'wash', fillColor: '#2b2b8f', baseTone: 0.3, toneFromLuminance: true, keepHue: false, hachureAngle: -41,
    backdrop: 'rice', misregister: 2.4, misColor: '#ff5a5f',
  },
  {
    name: 'crayon', label: 'Crayon',
    blurb: 'Waxy textured strokes and loose multi-pass scribble fills.',
    colors: { bg: '#fffdf6', fg: '#3a2f2a', line: '#6b4f3a', accent: '#d1495b', muted: '#8a7a6a', surface: '#fffdf6', border: '#6b4f3a' },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    stroke: 'pencil', roughness: 2.2, passes: 2, strokeWidth: 2.2, linecap: 'round', strokeOpacity: 0.9,
    fill: 'scribble', fillColor: '#d1495b', baseTone: 0.2, toneFromLuminance: true, keepHue: false, hachureAngle: -33,
    backdrop: 'plain',
    defs: '<filter id="wax"><feTurbulence type="turbulence" baseFrequency="0.04 0.06" numOctaves="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.2"/></filter>',
    strokeFilter: 'wax',
  },
  // ---- requested styles ----
  {
    // ref: replicate.com/jakedahn/flux-latentpop (+ supplied example images) —
    // bold flat cartoon screenprint: VIVID ORANGE ground, deep-navy shapes with
    // an ACID YELLOW-GREEN rim light, a CORAL offset glow behind, subtle grain.
    name: 'flux-latentpop', label: 'Flux LatentPop',
    blurb: 'Bold flat screenprint: vivid orange ground, navy shapes, acid-green rims, coral offset glow.',
    colors: { bg: '#f4791f', fg: '#181425', line: '#181425', accent: '#c3e021', muted: '#9a5a23', surface: '#f4791f', border: '#c3e021' },
    font: 'DejaVu Sans', fontFile: '../../assets/fonts/DejaVuSans-Bold.ttf',
    stroke: 'jittered', roughness: 0.6, passes: 1, strokeWidth: 3.2, linecap: 'round',
    fill: 'solid', fillColor: '#181425', baseTone: 1, toneFromLuminance: false, keepHue: false, hachureAngle: 15,
    backdrop: 'rice',
    glowColor: '#ef4d23', glowOffset: 6,
    labelHalo: '#181425', labelInk: '#eaf6a0',
  },
  {
    // ref: makingsoftware.com (Dan Hollick) — WHITE ground, pure black ink,
    // Arizona serif + Departure mono, vivid accents (signature blue #002ef4).
    // Clean, precise technical illustration with a hand-drawn squiggle accent.
    name: 'making-software', label: 'Making Software',
    blurb: 'White ground, pure-black serif ink, vivid-blue (#002ef4) accent lines. Precise technical illustration.',
    colors: { bg: '#ffffff', fg: '#000000', line: '#002ef4', accent: '#002ef4', muted: '#6b7280', surface: '#ffffff', border: '#000000' },
    font: 'EB Garamond', fontFile: 'EBGaramond.ttf',
    stroke: 'jittered', roughness: 0.32, passes: 1, strokeWidth: 1.6, linecap: 'round',
    fill: 'none', fillColor: '#002ef4', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    backdrop: 'plain',
  },
]
