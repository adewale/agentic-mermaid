// ============================================================================
// Aesthetic styles, expressed as DATA. A Style composes four orthogonal
// strategies (the pluggable seam — see SPEC): stroke · fill · backdrop · postfx.
// Adding/removing a style = editing this table. No engine changes required.
//
// Each style is grounded in research notes (see commit history / SPEC refs).
// ============================================================================

export type StrokeKind = 'crisp' | 'jittered' | 'pencil' | 'freehand'
export type FillKind = 'none' | 'hachure' | 'wash' | 'scribble' | 'solid'
export type BackdropKind = 'paper-ruled' | 'plain' | 'rice' | 'washi' | 'grid' | 'slate' | 'blueprint' | 'parchment' | 'aurora'

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
  misregister?: number    // riso: duplicate strokes offset in a 2nd colour
  misColor?: string
  spotPalette?: string[]  // solid/wash: pick a per-region colour (seeded)
  /** wash fill weights — declared fields, never st.name forks (SPEC §11.0e) */
  washOpacity?: number
  washEdge?: number
  labelHalo?: string      // override the text knockout colour (default: page bg)
  labelInk?: string       // override the label ink (default: auto-contrast vs halo)
  textTransform?: 'uppercase'
  letterSpacing?: number
  nodeCornerRadius?: number // round node corners (for crisp/clean styles)
  boxShadow?: boolean       // soft drop-shadow under shapes (whiteboard)
  /** deliberately faint non-text rules (Tufte): exempts the 3:1 stroke gate */
  faintLinesIntentional?: boolean
  /**
   * Monochrome contract: this style conveys tone/emphasis via SHADING/HATCHING
   * density, never via multiple fill hues. Enforced by styles.test.ts:
   * a mono style must NOT set a multi-hue spotPalette and must keep keepHue=false.
   * (A single accent colour — like Tufte's red — is still allowed.)
   */
  mono?: boolean
  /** solid-fill opacity override (glassmorphism translucency). Default 0.95. */
  fillOpacity?: number
}

export const STYLES: Style[] = [
  {
    // Anthropic public palette: ivory grounds, slate text, clay/accent ink,
    // with secondary soft swatches used as quiet fills.
    name: 'crab', label: 'Crab',
    blurb: 'Anthropic-inspired ivory, slate, and clay with restrained editorial fills.',
    colors: { bg: '#faf9f5', fg: '#141413', line: '#141413', accent: '#c6613f', muted: '#5e5d59', surface: '#f0eee6', border: '#3d3d3a' },
    font: 'Fraunces', fontFile: 'Fraunces.ttf',
    stroke: 'crisp', roughness: 0, passes: 1, strokeWidth: 1.5, linecap: 'round',
    fill: 'solid', fillColor: '#d97757', baseTone: 1, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    spotPalette: ['#e8e6dc', '#e3dacc', '#bcd1ca', '#cbcadb', '#ebcece', '#d97757'],
    backdrop: 'plain', nodeCornerRadius: 8, labelHalo: '#faf9f5',
  },
  {
    // CF Workers design system: warm cream surfaces, warm brown text,
    // Cloudflare orange accent, subtle fills, dashed-border feeling.
    name: 'salmon', label: 'Salmon',
    blurb: 'Cloudflare Workers design-system tokens: cream, warm brown, orange, dashed-card energy.',
    colors: { bg: '#F5F1EB', fg: '#521000', line: '#521000', accent: '#FF4801', muted: '#8B5B4A', surface: '#FFFBF5', border: '#EBD5C1' },
    font: 'DejaVu Sans', fontFile: '../../assets/fonts/DejaVuSans.ttf',
    stroke: 'crisp', roughness: 0, passes: 1, strokeWidth: 1.7, linecap: 'round',
    fill: 'solid', fillColor: '#FF4801', baseTone: 1, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    spotPalette: ['#FEF7ED', '#FFFBF5', '#FFE7D6', '#FFD4BD', '#FFB38A'],
    backdrop: 'plain', nodeCornerRadius: 16, labelHalo: '#FFFBF5',
  },
  {
    // Perfect Freehand: pressure-sensitive filled stroke outlines from
    // perfect-freehand, with a clean paper ground and no node fills.
    name: 'freehand', label: 'Freehand',
    blurb: 'Pressure-sensitive perfect-freehand ribbons: tapered marker strokes on clean paper.',
    colors: { bg: '#fffaf1', fg: '#20201d', line: '#20201d', accent: '#277da1', muted: '#6c6a61', surface: '#fffaf1', border: '#20201d' },
    font: 'Architects Daughter', fontFile: 'ArchitectsDaughter.ttf',
    stroke: 'freehand', roughness: 1.1, passes: 1, strokeWidth: 2.2, brushWidth: 8.5, linecap: 'round', strokeOpacity: 0.95,
    fill: 'none', fillColor: '#20201d', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    backdrop: 'plain', nodeCornerRadius: 10, mono: true,
  },
  {
    // Matches the reference notebook photo: BLACK ink, clean confident single
    // strokes, EMPTY boxes (no shading), faint ruled paper. Monochrome.
    name: 'hand-drawn', label: 'Hand-drawn (notebook)',
    blurb: 'Black ink on faint-ruled paper. Clean confident strokes, unfilled boxes.',
    colors: { bg: '#fbfaf3', fg: '#1a1a1a', line: '#1a1a1a', accent: '#1a1a1a', muted: '#555555', surface: '#fbfaf3', border: '#1a1a1a' },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    stroke: 'jittered', roughness: 1.0, passes: 2, strokeWidth: 1.8, linecap: 'round',
    fill: 'none', fillColor: '#1a1a1a', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    backdrop: 'paper-ruled', mono: true,
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
    backdrop: 'plain', mono: true,
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
    backdrop: 'plain', mono: true, faintLinesIntentional: true,
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
    backdrop: 'blueprint', textTransform: 'uppercase', letterSpacing: 1, mono: true,
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
    washOpacity: 0.30, washEdge: 0.38,
    backdrop: 'plain',
  },
  {
    // Research: green slate, off-white (never pure white) chalk, dusty broken
    // strokes. A real person draws a box and writes INSIDE it — they do NOT
    // crosshatch the interior. So: outlines only, no node fill. Monochrome.
    name: 'chalkboard', label: 'Chalkboard',
    blurb: 'Green slate, dusty off-white chalk, broken strokes, unfilled boxes (you write inside them).',
    colors: { bg: '#2b3d35', fg: '#f3efe2', line: '#e3ebe0', accent: '#f6e58d', muted: '#9fb4a4', surface: '#2b3d35', border: '#f0f3ec' },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    stroke: 'pencil', roughness: 1.6, passes: 2, strokeWidth: 1.6, linecap: 'round', strokeOpacity: 0.82,
    fill: 'none', fillColor: '#f3efe2', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -38,
    backdrop: 'slate', mono: true,
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
    stroke: 'crisp', roughness: 0, passes: 1, strokeWidth: 1.6, linecap: 'round',
    fill: 'none', fillColor: '#002ef4', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    backdrop: 'plain', nodeCornerRadius: 7, mono: true,
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
    backdrop: 'plain', boxShadow: true, mono: true,
  },
  // ---- additional historical research fixtures ----
  {
    // ★ Terminal / TUI: phosphor-green monospace on black, crisp thin lines.
    name: 'terminal', label: 'Terminal / TUI',
    blurb: 'Phosphor-green monospace on black; crisp thin box-rules, no fills.',
    colors: { bg: '#0b0f0b', fg: '#3bd16f', line: '#33b85f', accent: '#7dffa6', muted: '#2a8048', surface: '#0b0f0b', border: '#33b85f' },
    font: 'Share Tech Mono', fontFile: 'ShareTechMono.ttf',
    stroke: 'crisp', roughness: 0, passes: 1, strokeWidth: 1.1, linecap: 'butt',
    fill: 'none', fillColor: '#33b85f', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -45,
    backdrop: 'plain', mono: true,
  },
  {
    // Transit map (Beck): clean white, thick rounded route strokes, station nodes.
    name: 'transit', label: 'Transit map',
    blurb: 'Beck tube-map: thick rounded route lines, rounded station nodes, clean sans.',
    colors: { bg: '#fbfbf9', fg: '#1a1a2e', line: '#d1232a', accent: '#0067a8', muted: '#5a6172', surface: '#fbfbf9', border: '#1a1a2e' },
    font: 'DejaVu Sans', fontFile: '../../assets/fonts/DejaVuSans-Bold.ttf',
    stroke: 'crisp', roughness: 0, passes: 1, strokeWidth: 5.0, linecap: 'round',
    fill: 'none', fillColor: '#0067a8', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    backdrop: 'plain', nodeCornerRadius: 12,
  },
  {
    // ★ PCB schematic: green solder mask, gold traces, white silkscreen, mono.
    name: 'pcb', label: 'PCB schematic',
    blurb: 'Circuit board: green solder-mask ground, gold traces, white silkscreen, mono labels.',
    colors: { bg: '#0d3b2e', fg: '#eef3ee', line: '#e0b84a', accent: '#ffd76a', muted: '#7fae8e', surface: '#0d3b2e', border: '#e0b84a' },
    font: 'Share Tech Mono', fontFile: 'ShareTechMono.ttf',
    stroke: 'jittered', roughness: 0.25, passes: 1, strokeWidth: 1.6, linecap: 'round',
    fill: 'none', fillColor: '#e0b84a', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    backdrop: 'plain', textTransform: 'uppercase', letterSpacing: 0.5,
  },
  {
    // Patent drawing: uniform black line on white, tone via oblique hatching, no fills besides hatch.
    name: 'patent', label: 'Patent drawing',
    blurb: 'USPTO patent: uniform thin black lines on white, tone via oblique hatching. Monochrome.',
    colors: { bg: '#ffffff', fg: '#111111', line: '#111111', accent: '#111111', muted: '#444444', surface: '#ffffff', border: '#111111' },
    font: 'EB Garamond', fontFile: 'EBGaramond.ttf',
    stroke: 'jittered', roughness: 0.3, passes: 1, strokeWidth: 1.1, linecap: 'butt',
    fill: 'hachure', fillColor: '#111111', baseTone: 0.14, toneFromLuminance: true, keepHue: false, hachureAngle: -50,
    backdrop: 'plain', mono: true,
  },
  {
    // ★ Stained glass: bold black cames + flat luminous jewel-tone fills.
    name: 'stained-glass', label: 'Stained glass',
    blurb: 'Bold black lead cames + flat luminous jewel-tone panels.',
    colors: { bg: '#e7e1d4', fg: '#15130f', line: '#0a0a0a', accent: '#9b1b30', muted: '#6b6456', surface: '#e7e1d4', border: '#0a0a0a' },
    font: 'Cinzel', fontFile: 'Cinzel.ttf',
    stroke: 'jittered', roughness: 0.5, passes: 1, strokeWidth: 4.5, linecap: 'round',
    fill: 'solid', fillColor: '#1f4e8c', baseTone: 1, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    spotPalette: ['#1f4e8c', '#9b1b30', '#1b7a4b', '#c79a2e', '#5b2a86', '#2a8c9b'],
    backdrop: 'plain',
  },
  {
    // ★ Star chart: deep night sky, faint coordinate grid, pale-gold nodes/lines.
    name: 'star-chart', label: 'Star chart',
    blurb: 'Celestial atlas: deep night-sky ground, faint coordinate grid, pale-gold stars and lines.',
    colors: { bg: '#0b1026', fg: '#ece4c4', line: '#8a96c0', accent: '#f0e6b8', muted: '#6b76a0', surface: '#0b1026', border: '#cfc69e' },
    font: 'EB Garamond', fontFile: 'EBGaramond.ttf',
    stroke: 'jittered', roughness: 0.35, passes: 1, strokeWidth: 1.0, linecap: 'round',
    fill: 'none', fillColor: '#ece4c4', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    backdrop: 'grid',
  },
  {
    // Bauhaus: geometric primaries, black, warm-white, geometric sans.
    name: 'bauhaus', label: 'Bauhaus',
    blurb: 'Geometric primary blocks (red/yellow/blue) + black, on warm white. The designed flowchart.',
    colors: { bg: '#f4f1ea', fg: '#15140f', line: '#15140f', accent: '#e53935', muted: '#55524a', surface: '#f4f1ea', border: '#15140f' },
    font: 'DejaVu Sans', fontFile: '../../assets/fonts/DejaVuSans-Bold.ttf',
    stroke: 'crisp', roughness: 0, passes: 1, strokeWidth: 2.4, linecap: 'butt',
    fill: 'solid', fillColor: '#1e88e5', baseTone: 1, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    spotPalette: ['#e53935', '#fdd835', '#1e88e5', '#15140f'],
    backdrop: 'plain', labelHalo: '#f4f1ea',
  },
  {
    // Ukiyo-e woodblock: bold keyline + flat muted traditional colour on washi.
    name: 'ukiyo-e', label: 'Ukiyo-e',
    blurb: 'Woodblock: bold dark keyline + large flat muted colour areas on washi paper.',
    colors: { bg: '#efe6d2', fg: '#2a2018', line: '#2a2018', accent: '#c0432e', muted: '#6b5d49', surface: '#efe6d2', border: '#2a2018' },
    font: 'EB Garamond', fontFile: 'EBGaramond.ttf',
    stroke: 'jittered', roughness: 0.7, passes: 1, strokeWidth: 2.6, linecap: 'round',
    fill: 'solid', fillColor: '#2e4a6b', baseTone: 1, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    spotPalette: ['#2e4a6b', '#c0432e', '#c89b3c', '#6b8e6b', '#9a6b52'],
    backdrop: 'washi',
  },
  {
    // ★ Mesoamerican codex: heavy black contours, flat saturated fills, amate paper.
    name: 'codex', label: 'Mesoamerican codex',
    blurb: 'Codex: heavy black contours, flat saturated red/turquoise/ochre fills, amate-paper ground.',
    colors: { bg: '#e2c79a', fg: '#1d1408', line: '#1d1408', accent: '#b3331f', muted: '#6e5a36', surface: '#e2c79a', border: '#1d1408' },
    font: 'DejaVu Sans', fontFile: '../../assets/fonts/DejaVuSans-Bold.ttf',
    stroke: 'jittered', roughness: 0.6, passes: 1, strokeWidth: 3.0, linecap: 'round',
    fill: 'solid', fillColor: '#b3331f', baseTone: 1, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    spotPalette: ['#b3331f', '#2a8c8c', '#d9a441', '#3a5a8c', '#6e4b2a'],
    backdrop: 'rice', labelHalo: '#e2c79a',
  },
  {
    // Mid-century modern infographic: flat teal/mustard/red on cream, clean sans.
    name: 'mid-century', label: 'Mid-century',
    blurb: 'Mid-century infographic: flat teal/mustard/red blocks on cream, clean sans, lots of air.',
    colors: { bg: '#f3ead9', fg: '#2b2b2b', line: '#2b2b2b', accent: '#d1495b', muted: '#7a756b', surface: '#f3ead9', border: '#2b2b2b' },
    font: 'DejaVu Sans', fontFile: '../../assets/fonts/DejaVuSans.ttf',
    stroke: 'crisp', roughness: 0, passes: 1, strokeWidth: 1.4, linecap: 'butt',
    fill: 'solid', fillColor: '#2a9d8f', baseTone: 1, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    spotPalette: ['#2a9d8f', '#e1ad01', '#d1495b', '#3d5a80'],
    backdrop: 'plain', nodeCornerRadius: 3, labelHalo: '#f3ead9',
  },
  {
    // ★ "Vinegar" — Balsamiq-style LOW-FIDELITY wireframe/mockup. Greyscale
    // sketch, wobbly single strokes, Balsamiq Sans, unfilled rounded containers.
    // Lo-fi on purpose: signals "draft — critique structure, not pixels".
    // Monochrome (one sparse blue accent allowed).
    name: 'vinegar', label: 'Vinegar (lo-fi)',
    blurb: 'Balsamiq-style lo-fi wireframe: greyscale sketch, wobbly strokes, Balsamiq Sans, unfilled rounded boxes.',
    colors: { bg: '#fcfcfa', fg: '#3a3a3a', line: '#3a3a3a', accent: '#2c6fb3', muted: '#8a8a88', surface: '#fcfcfa', border: '#3a3a3a' },
    font: 'Balsamiq Sans', fontFile: 'BalsamiqSans.ttf',
    stroke: 'jittered', roughness: 1.0, passes: 1, strokeWidth: 2.0, linecap: 'round',
    fill: 'none', fillColor: '#3a3a3a', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    backdrop: 'plain', nodeCornerRadius: 6, mono: true,
  },
  {
    // ★ GiscardPunk (Florent Deloison): French 1970s retro-futurism — warm
    // "harvest" palette (burnt orange / mustard / olive / brown) on cream,
    // dark-brown ink, chunky rounded pill nodes, flat colour blocks, paper grain.
    name: 'giscardpunk', label: 'GiscardPunk',
    blurb: 'French 70s retro-futurism: warm harvest palette on cream, dark-brown ink, chunky rounded pills.',
    colors: { bg: '#efe3cb', fg: '#3a2a1a', line: '#3a2a1a', accent: '#c8531c', muted: '#7a4a24', surface: '#efe3cb', border: '#3a2a1a' },
    font: 'Fredoka', fontFile: 'Fredoka.ttf',
    stroke: 'jittered', roughness: 0.4, passes: 1, strokeWidth: 4.0, linecap: 'round',
    fill: 'solid', fillColor: '#c8531c', baseTone: 1, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    spotPalette: ['#c8531c', '#d8a23a', '#6e7b2f', '#7a4a24', '#a23b22'],
    backdrop: 'rice', nodeCornerRadius: 16, labelHalo: '#efe3cb',
  },
  // ---- design-coverage gap styles (SPEC §3.5c): each exercises a dimension
  // no other style tests. ----
  {
    // GAP 1 — authored DARK composition (top-3 community ask; D2 dark-theme
    // model). Dark-native premium: OLED-near-black ground, cool slate ink,
    // one restrained indigo accent. Catches hardcoded-light-fill leaks.
    name: 'midnight', label: 'Midnight',
    blurb: 'Authored dark theme: OLED-black ground, cool slate hairlines, one indigo accent. Premium dark-native.',
    colors: { bg: '#0b0e14', fg: '#e6e9f0', line: '#8a93a6', accent: '#7aa2f7', muted: '#6b7385', surface: '#131722', border: '#3a4254' },
    font: 'Fraunces', fontFile: 'Fraunces.ttf',
    stroke: 'crisp', roughness: 0, passes: 1, strokeWidth: 1.4, linecap: 'round',
    fill: 'none', fillColor: '#8a93a6', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    backdrop: 'plain', nodeCornerRadius: 8, mono: true,
  },
  {
    // GAP 2 — ACCESSIBILITY-FIRST (forced-colors / WHCM; Highcharts
    // highContrastTheme precedent). The WCAG machinery IS the aesthetic:
    // AAA-level contrast, heavy minimum strokes, zero decorative fills,
    // category via shape/pattern never hue. Intentionally pure #000/#fff —
    // the premium-neutrals default is opted out because system-color fidelity
    // is the point.
    name: 'high-contrast', label: 'High contrast',
    blurb: 'Accessibility-first: AAA contrast, thick strokes, no fills, structure never rests on hue.',
    colors: { bg: '#ffffff', fg: '#000000', line: '#000000', accent: '#0000cc', muted: '#1a1a1a', surface: '#ffffff', border: '#000000' },
    font: 'DejaVu Sans', fontFile: '../../assets/fonts/DejaVuSans-Bold.ttf',
    stroke: 'crisp', roughness: 0, passes: 1, strokeWidth: 2.8, linecap: 'butt',
    fill: 'none', fillColor: '#000000', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -45,
    backdrop: 'plain', mono: true,
  },
  {
    // GAP 3 — ADVERSARIAL CONTRAST (glassmorphism; NN/g-documented failure
    // modes). Translucent white panels over an aurora ground — the style the
    // WCAG guardrail must FIGHT: text sits on unpredictable composited
    // backgrounds, so the halo/ink machinery is load-bearing, not decorative.
    // backdrop-filter doesn't exist in static SVG, so frosted glass is faked
    // with layered semi-opaque fills (the capability-fallback path).
    name: 'glass', label: 'Glassmorphism',
    blurb: 'Frosted translucent panels over an aurora ground — the adversarial test of the contrast guardrail.',
    colors: { bg: '#101423', fg: '#f2f4fa', line: '#c9d4f2', accent: '#8fd3e8', muted: '#8d97b5', surface: '#1a2033', border: '#dfe6fa' },
    font: 'DejaVu Sans', fontFile: '../../assets/fonts/DejaVuSans.ttf',
    stroke: 'crisp', roughness: 0, passes: 1, strokeWidth: 1.2, linecap: 'round',
    fill: 'solid', fillColor: '#ffffff', fillOpacity: 0.14, baseTone: 1, toneFromLuminance: false, keepHue: false, hachureAngle: -41,
    backdrop: 'aurora', nodeCornerRadius: 14,
  },
  {
    // GAP 4 — FILTER-STACK COMPOSITOR on a dark-first ground (PlantUML
    // crt-amber / hacker precedent). Phosphor glow = blur+merge filter stack;
    // all-caps mono lettering. Monochrome by construction (one amber ink).
    name: 'crt-amber', label: 'CRT amber',
    blurb: 'Amber phosphor terminal: glowing monochrome strokes on near-black glass, all-caps mono.',
    colors: { bg: '#120c02', fg: '#ffb000', line: '#e6a000', accent: '#ffd35c', muted: '#a37a20', surface: '#120c02', border: '#e6a000' },
    font: 'Share Tech Mono', fontFile: 'ShareTechMono.ttf',
    stroke: 'jittered', roughness: 0.3, passes: 1, strokeWidth: 1.4, linecap: 'butt',
    fill: 'none', fillColor: '#e6a000', baseTone: 0, toneFromLuminance: false, keepHue: false, hachureAngle: -45,
    backdrop: 'plain', textTransform: 'uppercase', letterSpacing: 1, mono: true,
    defs: '<filter id="crtglow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
    strokeFilter: 'crtglow',
  },
]
