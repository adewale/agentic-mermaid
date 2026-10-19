import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { requireSafeCssFontFamily } from '../shared/css-font.ts'
import { requireSafeCssPaint } from '../shared/css-color.ts'
import { buildStyleText, shadowDefinitionPaint } from '../theme.ts'
import type { DocumentMark } from './ir.ts'
import { writeSvgAttributes, type SvgPreludeEmission, type SvgShadowEmission } from './svg-emission.ts'
import type { SvgWriter } from './svg-writer.ts'

export function writeSceneShadow(recipe: SvgShadowEmission, writer: SvgWriter): void {
  const paint = shadowDefinitionPaint(recipe.colors)
  if (!paint) return
  if (recipe.wrap) writer.write('<defs>')
  writer.write('  <filter id="bm-shadow" x="-12%" y="-10%" width="128%" height="136%">\n    <feDropShadow dx="0" dy="1.5" stdDeviation="2.5"')
  writer.attribute('flood-color', paint.floodColor)
  writer.attribute('flood-opacity', paint.floodOpacity)
  writer.write(' />\n  </filter>')
  if (recipe.wrap) writer.write('</defs>')
}

/** Shared shell serialization. Families retain bounded shell data, never an
 * opening SVG or stylesheet fragment. Historical root attribute order remains. */
export function writeScenePrelude(node: DocumentMark, recipe: SvgPreludeEmission, writer: SvgWriter): void {
  const { colors } = recipe
  if (colors.font !== undefined) requireSafeCssFontFamily(colors.font)
  for (const field of ['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border'] as const) {
    if (colors[field] !== undefined) requireSafeCssPaint(colors[field], field)
  }
  const variables = [`--bg:${colors.bg}`, `--fg:${colors.fg}`]
  for (const field of ['line', 'accent', 'muted', 'surface', 'border', 'font'] as const) {
    if (colors[field]) variables.push(`--${field}:${colors[field]}`)
  }
  const style = variables.join(';') + (recipe.transparent ? '' : ';background:var(--bg)') + (recipe.extraStyle ? `;${recipe.extraStyle}` : '')
  writer.write('<svg xmlns="http://www.w3.org/2000/svg"')
  writer.attribute('width', String(recipe.widthAttribute ?? recipe.width))
  writer.attribute('height', String(recipe.heightAttribute ?? recipe.height))
  writer.attribute('viewBox', `0 0 ${recipe.width} ${recipe.height}`)
  writer.attribute('style', style, 'safe')
  if (recipe.attributes) writeSvgAttributes(node, [...recipe.attributes].sort((left, right) => compareCodePointStrings(left.name, right.name)), writer)
  writer.write('>')
  const join = recipe.join ?? '\n'
  for (const child of recipe.children) {
    writer.write(join)
    switch (child.kind) {
      case 'sharedStyle':
        writer.write('<style>\n')
        writer.write(buildStyleText(recipe.font, recipe.hasMonoFont, child.shadow === false ? false : colors.shadow, colors.embedFontImport))
        writer.write('\n</style>')
        break
      case 'shadow': writeSceneShadow(child, writer); break
      case 'stylesheet':
        writer.write('<style>')
        writer.write(child.css)
        writer.write('</style>')
        break
      case 'documentText':
        writer.write(`<${child.element}`)
        if (child.domId) writer.attribute('id', child.domId)
        writer.write('>')
        writer.text(child.text ?? '')
        writer.write(`</${child.element}>`)
        break
    }
  }
}
