// ============================================================================
// Aesthetic styles, expressed as DATA. A Style composes four orthogonal
// strategies (the pluggable seam — see SPEC): stroke · fill · backdrop · postfx.
// Adding/removing a style = editing this table. No engine changes required.
//
// Each style is grounded in research notes (see commit history / SPEC refs).
// ============================================================================

export type StrokeKind = 'crisp' | 'jittered' | 'brush' | 'pencil'
export type FillKind = 'none' | 'hachure' | 'crosshatch' | 'stipple' | 'halftone' | 'wash' | 'scribble' | 'solid'
export type BackdropKind = 'paper-ruled' | 'plain' | 'rice' | 'washi' | 'grid' | 'slate' | 'blueprint'

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
  keepHue: boolean        // fill with the region's own colour
  hachureAngle: number

  backdrop: BackdropKind
  defs?: string
  strokeFilter?: string
  fillFilter?: string
  seal?: boolean
  misregister?: number    // riso: duplicate strokes offset in a 2nd colour
  misColor?: string
  spotPalette?: string[]  // solid/wash: pick a per-region colour (seeded)
  glowColor?: string
  glowOffset?: number
  labelHalo?: string      // override the text knockout colour (default: page bg)
  labelInk?: string       // override the label ink (default: auto-contrast vs halo)
  textTransform?: 'uppercase'
  letterSpacing?: number
  nodeCornerRadius?: number // round node corners (for crisp/clean styles)
  boxShadow?: boolean       // soft drop-shadow under shapes (whiteboard)
}

export const STYLES: Style[] = [
  {
    // Matches the reference notebook photo: deep-navy ballpoint, clean confident
    // single strokes, EMPTY boxes (no shading), faint blue ruled paper.
    name: 'hand-drawn', label: 'Hand-drawn (notebook)',
    blurb: 'Deep-navy ballpoint on faint-ruled paper. Clean confident strokes, unfilled boxes.',
    colors: { bg: '#fbfaf3', fg: '#1e2f6b', line: '#1e2f6b', accent: '#1e2f6b', muted: '#5566aa', surface: '#fbfaf3', border: '#1e2f6b' },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    stroke: 'jittered', roughness: 1.0, passes: 2, strokeWidth: 1.8, linecap: 'round',
    fill: 'none', fillColor: '#1e2f6b', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    backdrop: 'paper-ruled',
  },
  {
    // Research: pen-and-ink diagrams are CONTOUR-driven — no interior hatching.
    // Confident near-black ink on warm cream; serif lettering; no fills.
    name: 'pen-and-ink', label: 'Pen & ink',
    blurb: 'Contour-driven technical pen: confident near-black ink on cream, no interior hatching.',
    colors: { bg: '#f4ecd8', fg: '#1a1a1a', line: '#1a1a1a', accent: '#3d2b1f', muted: '#5b4636', surface: '#f4ecd8', border: '#1a1a1a' },
    font: 'EB Garamond', fontFile: 'EBGaramond.ttf',
    stroke: 'jittered', roughness: 0.5, passes: 1, strokeWidth: 1.5, linecap: 'round',
    fill: 'none', fillColor: '#1a1a1a', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -45,
    backdrop: 'plain',
  },
  {
    // Research: data-ink maximalism. Warm off-white, near-black, ONE sparing
    // dark-red accent, faint grey hairline connectors, serif type, no fills.
    name: 'tufte', label: 'Tufte (minimal)',
    blurb: 'Max data-ink: hairline grey connectors, serif labels, one sparing dark-red accent.',
    colors: { bg: '#fffff8', fg: '#111111', line: '#b4b4ac', accent: '#a00000', muted: '#8a8a82', surface: '#fffff8', border: '#d8d8cf' },
    font: 'EB Garamond', fontFile: 'EBGaramond.ttf',
    stroke: 'crisp', roughness: 0, passes: 1, strokeWidth: 0.8, linecap: 'butt',
    fill: 'none', fillColor: '#000', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -45,
    backdrop: 'plain',
  },
  {
    // Research: cyanotype. Deep Prussian-blue ground, thin uniform WHITE lines,
    // NO fills, border frame + bottom-right title block, all-caps mono lettering.
    name: 'blueprint', label: 'Blueprint',
    blurb: 'Cyanotype: Prussian-blue ground, thin white lines, border + title block, all-caps mono.',
    colors: { bg: '#0e3a6b', fg: '#eef3f8', line: '#eef3f8', accent: '#ffffff', muted: '#a9c2e0', surface: '#0e3a6b', border: '#eef3f8' },
    font: 'Share Tech Mono', fontFile: 'ShareTechMono.ttf',
    stroke: 'jittered', roughness: 0.28, passes: 1, strokeWidth: 1.0, linecap: 'butt',
    fill: 'none', fillColor: '#eef3f8', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -45,
    backdrop: 'blueprint', textTransform: 'uppercase', letterSpacing: 1,
  },
  {
    // Curtis-style layered washes; now with a varied watercolour spot palette so
    // colour genuinely leads, plus edge-darkening (pigment pooling).
    name: 'watercolor', label: 'Watercolor',
    blurb: 'Layered translucent washes in a varied pigment palette, with edge-darkening.',
    colors: { bg: '#fdfbf6', fg: '#33312e', line: '#6a7b86', accent: '#c0653a', muted: '#8a8a8a', surface: '#eaf2f8', border: '#7a93a8' },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    stroke: 'jittered', roughness: 1.0, passes: 1, strokeWidth: 1.2, linecap: 'round', strokeOpacity: 0.8,
    fill: 'wash', fillColor: '#6fa8c7', baseTone: 0.55, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    spotPalette: ['#e08a8a', '#8fb8d4', '#a9cf98', '#e6c879', '#c39bd1', '#e0a878'],
    backdrop: 'plain',
  },
  {
    // Research: green slate, off-white (never pure white) chalk, dusty broken
    // strokes, loose open hatching, pastel accents.
    name: 'chalkboard', label: 'Chalkboard',
    blurb: 'Green slate, dusty off-white chalk, broken strokes, loose open hatching.',
    colors: { bg: '#2b3d35', fg: '#f3efe2', line: '#e3ebe0', accent: '#f6e58d', muted: '#9fb4a4', surface: '#2b3d35', border: '#f0f3ec' },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    stroke: 'pencil', roughness: 1.6, passes: 2, strokeWidth: 1.6, linecap: 'round', strokeOpacity: 0.82,
    fill: 'scribble', fillColor: '#f3efe2', baseTone: 0.12, toneFromLuminance: true, keepHue: false, hachureAngle: -38,
    backdrop: 'slate',
    defs: '<filter id="chalk"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.6"/></filter>',
    strokeFilter: 'chalk',
  },
  {
    // Research: real Riso spot inks (Fluorescent Pink + Blue), visible
    // misregistration, grain, paper showing through, bold sans.
    name: 'risograph', label: 'Risograph',
    blurb: 'Two Riso spot inks (fluoro pink + blue), visible misregistration, grain, paper showing.',
    colors: { bg: '#f4f0e6', fg: '#1f2147', line: '#0078bf', accent: '#ff48b0', muted: '#5a6a9a', surface: '#f4f0e6', border: '#0078bf' },
    font: 'DejaVu Sans', fontFile: '../../assets/fonts/DejaVuSans-Bold.ttf',
    stroke: 'jittered', roughness: 0.7, passes: 1, strokeWidth: 2.4, linecap: 'round',
    fill: 'wash', fillColor: '#0078bf', baseTone: 0.45, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    spotPalette: ['#ff48b0', '#0078bf'],
    backdrop: 'rice', misregister: 2.8, misColor: '#ff48b0',
  },
  {
    // ref: makingsoftware.com (research). The premium feel = warm neutrals
    // (NOT pure #000/#fff), refined HAIRLINES, ROUNDED corners, a Fraunces serif
    // (closest free match to ABC Arizona), and ONE accent per figure — blue
    // #002ef4 as highlight only, geometry stays monochrome. Precise (crisp),
    // not hand-drawn. Own poster.
    name: 'making-software', label: 'Making Software',
    blurb: 'Warm off-white, stone-black hairlines, rounded boxes, Fraunces serif, one blue accent.',
    colors: { bg: '#fafaf9', fg: '#0c0a09', line: '#0c0a09', accent: '#002ef4', muted: '#57534e', surface: '#fafaf9', border: '#0c0a09' },
    font: 'Fraunces', fontFile: 'Fraunces.ttf',
    stroke: 'crisp', roughness: 0, passes: 1, strokeWidth: 1.3, linecap: 'round',
    fill: 'none', fillColor: '#002ef4', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    backdrop: 'plain', nodeCornerRadius: 7,
  },
  {
    // ref: excalidraw.com (research) — rough.js sketchy dark #1e1e1e strokes,
    // PASTEL hachure fills distinct from the stroke, rounded corners, open
    // arrowheads, casual hand font. The community's #1 requested look.
    name: 'excalidraw', label: 'Excalidraw',
    blurb: 'rough.js sketch: dark #1e1e1e strokes, pastel hachure fills, casual hand lettering.',
    colors: { bg: '#ffffff', fg: '#1e1e1e', line: '#1e1e1e', accent: '#1971c2', muted: '#495057', surface: '#ffffff', border: '#1e1e1e' },
    font: 'Architects Daughter', fontFile: 'ArchitectsDaughter.ttf',
    stroke: 'jittered', roughness: 1.1, passes: 2, strokeWidth: 1.8, linecap: 'round',
    fill: 'hachure', fillColor: '#a5d8ff', baseTone: 0.55, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    spotPalette: ['#a5d8ff', '#ffc9c9', '#b2f2bb', '#ffec99', '#d0bfff', '#ffd8a8'],
    backdrop: 'plain',
  },
  {
    // Research: dry-erase whiteboard. Light board, the standard 4 marker
    // colours, thick translucent rounded strokes, no fills, marker handwriting.
    name: 'whiteboard', label: 'Whiteboard',
    blurb: 'Dry-erase board: thick translucent marker strokes, multiple marker colours, no fills.',
    colors: { bg: '#f8f9fa', fg: '#1f2430', line: '#2b6cb0', accent: '#d64545', muted: '#2f855a', surface: '#f8f9fa', border: '#1f2430' },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    stroke: 'jittered', roughness: 0.85, passes: 1, strokeWidth: 4.2, linecap: 'round', strokeOpacity: 0.9,
    fill: 'none', fillColor: '#2b6cb0', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    backdrop: 'plain', boxShadow: true,
    defs: '<filter id="wbsh" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="2.6"/></filter>',
  },
]
