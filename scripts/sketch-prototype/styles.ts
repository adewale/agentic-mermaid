// ============================================================================
// Aesthetic styles, expressed as DATA. A Style composes four orthogonal
// strategies (the pluggable seam — see SPEC): stroke · fill · backdrop · postfx.
// Adding/removing a style = editing this table. No engine changes required.
//
// Each style is grounded in research notes (see commit history / SPEC refs).
// ============================================================================

export type StrokeKind = 'crisp' | 'jittered' | 'brush' | 'pencil'
export type FillKind = 'none' | 'hachure' | 'crosshatch' | 'stipple' | 'halftone' | 'wash' | 'scribble' | 'solid'
export type BackdropKind = 'paper-ruled' | 'plain' | 'rice' | 'washi' | 'grid' | 'slate' | 'blueprint' | 'parchment'

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
  ringNode?: boolean        // draw nodes as circular ink rings (Arrival)
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
    colors: { bg: '#0a2a5e', fg: '#e8eef5', line: '#dbe6f0', accent: '#ffffff', muted: '#9fbbe0', surface: '#0a2a5e', border: '#e8eef5' },
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
  {
    // research: visual note-taking — bold wobbly containers, drop shadows,
    // limited cheerful accents, chunky arrows, marker lettering.
    name: 'sketchnotes', label: 'Sketchnotes',
    blurb: 'Visual notes: bold wobbly containers, lifted drop shadows, cheerful accent fills, marker hand.',
    colors: { bg: '#fbf7ef', fg: '#1d1d1b', line: '#1d1d1b', accent: '#f08c00', muted: '#2a9d8f', surface: '#fbf7ef', border: '#1d1d1b' },
    font: 'Architects Daughter', fontFile: 'ArchitectsDaughter.ttf',
    stroke: 'jittered', roughness: 1.2, passes: 2, strokeWidth: 3.0, linecap: 'round',
    fill: 'solid', fillColor: '#f08c00', baseTone: 1, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    spotPalette: ['#ffe3c2', '#c7ece6', '#fdebb6', '#f7d5c4'],
    backdrop: 'plain', boxShadow: true, nodeCornerRadius: 8,
    defs: '<filter id="wbsh" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="2.2"/></filter>',
  },
  {
    // research: industrial-design graphite sketch — toned paper, graphite (not
    // black), construction-line wobble, cool-grey shading, ONE marker accent.
    name: 'pencil', label: 'Pencil sketch',
    blurb: 'Industrial-design graphite: toned paper, dark-grey lines, cool-grey shading, one orange marker accent.',
    colors: { bg: '#efe9dd', fg: '#2b2b2b', line: '#3a3a3a', accent: '#e8703a', muted: '#9aa0a8', surface: '#efe9dd', border: '#2b2b2b' },
    font: 'Architects Daughter', fontFile: 'ArchitectsDaughter.ttf',
    stroke: 'jittered', roughness: 1.3, passes: 2, strokeWidth: 1.7, linecap: 'round', strokeOpacity: 0.9,
    fill: 'scribble', fillColor: '#b8bcc2', baseTone: 0.16, toneFromLuminance: true, keepHue: false, hachureAngle: -45,
    backdrop: 'plain', boxShadow: true,
  },
  {
    // research: Arrival heptapod logograms — circular variable-weight ink rings
    // with splatter, on warm pale ground; labels stay clean sans on a chip.
    name: 'arrival', label: 'Arrival (logograms)',
    blurb: 'Heptapod ink rings: circular variable-weight ink bands with splatter on pale ground.',
    colors: { bg: '#f1efe9', fg: '#15130f', line: '#15130f', accent: '#3a352d', muted: '#5c574d', surface: '#f1efe9', border: '#15130f' },
    font: 'DejaVu Sans', fontFile: '../../assets/fonts/DejaVuSans.ttf',
    stroke: 'jittered', roughness: 1.6, passes: 2, strokeWidth: 5.0, linecap: 'round',
    fill: 'none', fillColor: '#15130f', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    backdrop: 'plain', ringNode: true,
  },
  {
    // BetiDraws (research): warm "crayon over canvas" storybook — cream canvas,
    // warm-brown hand outlines, soft warm fills, crayon grain, rounded shapes.
    name: 'betidraws', label: 'BetiDraws (crayon)',
    blurb: 'Warm crayon-over-canvas storybook: cream ground, brown hand outlines, soft warm fills.',
    colors: { bg: '#f4ecdc', fg: '#3a2a22', line: '#3a2a22', accent: '#e8896a', muted: '#7a6657', surface: '#f4ecdc', border: '#3a2a22' },
    font: 'Fredoka', fontFile: 'Fredoka.ttf',
    stroke: 'pencil', roughness: 1.8, passes: 2, strokeWidth: 2.6, linecap: 'round', strokeOpacity: 0.92,
    fill: 'solid', fillColor: '#e8896a', baseTone: 1, toneFromLuminance: false, keepHue: false, hachureAngle: -33,
    spotPalette: ['#e8896a', '#4fa39a', '#e3b23c', '#8fb97a', '#d98c9a'],
    backdrop: 'plain', nodeCornerRadius: 10,
    defs: '<filter id="crayon"><feTurbulence type="fractalNoise" baseFrequency="0.04 0.05" numOctaves="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.4"/></filter>',
    strokeFilter: 'crayon', fillFilter: 'crayon',
  },
  {
    // Vegetius (research): late-Roman military-treatise manuscript — aged
    // parchment, sepia/iron-gall ink, rubric-red emphasis, Roman capitals.
    name: 'vegetius', label: 'Vegetius (manuscript)',
    blurb: 'Roman military-treatise manuscript: aged parchment, iron-gall sepia ink, rubric-red, Roman caps.',
    colors: { bg: '#e3d4b0', fg: '#2c1e10', line: '#3a2a18', accent: '#8b2e1f', muted: '#6b5a3e', surface: '#e3d4b0', border: '#3a2a18' },
    font: 'Cinzel', fontFile: 'Cinzel.ttf',
    stroke: 'jittered', roughness: 0.7, passes: 1, strokeWidth: 1.6, linecap: 'round',
    fill: 'none', fillColor: '#8b2e1f', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    backdrop: 'parchment', textTransform: 'uppercase', letterSpacing: 0.5,
  },
]
