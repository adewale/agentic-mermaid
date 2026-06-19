// ============================================================================
// Five aesthetic styles, expressed as DATA (not code paths).
//
// This is the heart of the pluggability story: a style is just a parameter
// bundle. `restyle.ts` reads these fields and transforms a normally-rendered
// SVG accordingly. Adding a sixth style = adding another object here.
//
// The fields split cleanly into the three things that actually vary between
// hand-rendered looks:
//   1. palette / font   — colours + typeface fed to the real renderer
//   2. stroke           — how an outline is drawn (jitter, width, passes)
//   3. fill + backdrop  — how regions are shaded + what the "page" looks like
// ============================================================================

export type FillStyle = 'none' | 'hachure' | 'crosshatch' | 'wash'
export type Backdrop = 'paper-ruled' | 'plain' | 'rice' | 'washi'

export interface Style {
  name: string
  label: string
  blurb: string

  // 1. palette + font (passed straight into renderMermaidSVG) -----------------
  colors: { bg: string; fg: string; line: string; accent: string; muted: string; surface: string; border: string }
  font: string
  fontFile: string

  // 2. stroke treatment -------------------------------------------------------
  roughen: boolean      // false = keep crisp geometry (Tufte)
  roughness: number     // jitter amplitude (px)
  bowing: number        // how much straight lines bow
  passes: number        // overlapping strokes per outline
  strokeWidth: number
  linecap: 'round' | 'butt'

  // 3. fill + page ------------------------------------------------------------
  fill: FillStyle
  fillColor: string
  fillOpacity: number
  hachureGap: number
  hachureAngle: number
  backdrop: Backdrop
  defs?: string         // extra <filter> defs (e.g. ink-bleed blur)
  strokeFilter?: string // filter id applied to every stroke (sumi-e bleed)
  seal?: boolean        // red chop stamp (brush)
}

const INK_BLUE = '#1f3a8a'
const INK_BLACK = '#161616'
const SUMI = '#1c1c1c'

export const STYLES: Style[] = [
  {
    name: 'hand-drawn',
    label: 'Hand-drawn (notebook)',
    blurb: 'Blue ballpoint on ruled paper. Jittered double strokes, light ink hachure.',
    colors: { bg: '#fbfaf3', fg: INK_BLUE, line: INK_BLUE, accent: INK_BLUE, muted: '#5566aa', surface: '#fbfaf3', border: INK_BLUE },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    roughen: true, roughness: 1.6, bowing: 1.1, passes: 2, strokeWidth: 1.6, linecap: 'round',
    fill: 'hachure', fillColor: INK_BLUE, fillOpacity: 0.13, hachureGap: 7, hachureAngle: -41,
    backdrop: 'paper-ruled',
  },
  {
    name: 'pen-and-ink',
    label: 'Pen & ink',
    blurb: 'Fine confident lines, dense cross-hatch shading. Black ink on white.',
    colors: { bg: '#ffffff', fg: INK_BLACK, line: INK_BLACK, accent: INK_BLACK, muted: '#444', surface: '#ffffff', border: INK_BLACK },
    font: 'EB Garamond', fontFile: 'EBGaramond.ttf',
    roughen: true, roughness: 0.5, bowing: 0.3, passes: 1, strokeWidth: 1.0, linecap: 'butt',
    fill: 'crosshatch', fillColor: INK_BLACK, fillOpacity: 0.5, hachureGap: 4.5, hachureAngle: -45,
    backdrop: 'plain',
  },
  {
    name: 'tufte',
    label: 'Tufte (minimal)',
    blurb: 'Maximum data-ink ratio: hairline strokes, no fills, serif type, quiet page.',
    colors: { bg: '#fffff8', fg: '#111111', line: '#bbbbbb', accent: '#7a0000', muted: '#888888', surface: '#fffff8', border: '#cfcfcf' },
    font: 'EB Garamond', fontFile: 'EBGaramond.ttf',
    roughen: false, roughness: 0, bowing: 0, passes: 1, strokeWidth: 0.7, linecap: 'butt',
    fill: 'none', fillColor: '#000', fillOpacity: 0, hachureGap: 8, hachureAngle: -45,
    backdrop: 'plain',
  },
  {
    name: 'chinese-brush',
    label: 'Chinese paintbrush',
    blurb: 'Bold tapered brushwork, ink-wash fills, rice-paper ground, a red seal.',
    colors: { bg: '#f3ece0', fg: '#1a1a1a', line: '#1a1a1a', accent: '#b22222', muted: '#555', surface: '#f3ece0', border: '#1a1a1a' },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    roughen: true, roughness: 1.0, bowing: 1.4, passes: 2, strokeWidth: 3.0, linecap: 'round',
    fill: 'wash', fillColor: '#2b2b2b', fillOpacity: 0.1, hachureGap: 6, hachureAngle: -41,
    backdrop: 'rice', seal: true,
  },
  {
    name: 'sumi-e',
    label: 'Sumi-e (ink wash)',
    blurb: 'Sparse monochrome gestures with soft ink bleed and lots of empty space.',
    colors: { bg: '#f7f5ef', fg: SUMI, line: SUMI, accent: SUMI, muted: '#666', surface: '#f7f5ef', border: SUMI },
    font: 'Caveat', fontFile: 'Caveat.ttf',
    roughen: true, roughness: 1.3, bowing: 1.6, passes: 1, strokeWidth: 2.2, linecap: 'round',
    fill: 'wash', fillColor: SUMI, fillOpacity: 0.06, hachureGap: 7, hachureAngle: -41,
    backdrop: 'washi',
    defs: '<filter id="sumi-bleed" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.6"/></filter>',
    strokeFilter: 'sumi-bleed',
  },
]
