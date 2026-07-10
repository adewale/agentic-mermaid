export interface HostedFontFace {
  family: string
  file: string
  weight: string
  style: string
}

export const HOSTED_FONT_FACES: readonly HostedFontFace[] = [
  { family: 'Inter', file: 'Inter-Regular.ttf', weight: '400', style: 'normal' },
  { family: 'Inter', file: 'Inter-Medium.ttf', weight: '500', style: 'normal' },
  { family: 'Inter', file: 'Inter-SemiBold.ttf', weight: '600', style: 'normal' },
  { family: 'Inter', file: 'Inter-Bold.ttf', weight: '700', style: 'normal' },
  { family: 'Caveat', file: 'Caveat.ttf', weight: '400 700', style: 'normal' },
  { family: 'EB Garamond', file: 'EBGaramond.ttf', weight: '400 700', style: 'normal' },
  { family: 'Architects Daughter', file: 'ArchitectsDaughter.ttf', weight: '400', style: 'normal' },
  { family: 'Share Tech Mono', file: 'ShareTechMono.ttf', weight: '400', style: 'normal' },
  { family: 'DejaVu Sans', file: 'DejaVuSans.ttf', weight: '400', style: 'normal' },
  { family: 'DejaVu Sans', file: 'DejaVuSans-Bold.ttf', weight: '700', style: 'normal' },
]

export const HOSTED_FONT_FILES = [...new Set(HOSTED_FONT_FACES.map((font) => font.file))] as readonly string[]

function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export function hostedFontFaceCss(prefix = '/fonts/'): string {
  return HOSTED_FONT_FACES.map((font) =>
    `@font-face { font-family: '${cssString(font.family)}'; src: url('${prefix}${font.file}') format('truetype'); font-weight: ${font.weight}; font-style: ${font.style}; font-display: swap; }`,
  ).join('\n')
}
