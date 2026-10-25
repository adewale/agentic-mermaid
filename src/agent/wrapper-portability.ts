import { mergeFrontmatterMaps, mermaidInitDirectiveConfig, type MermaidFrontmatterMap } from '../mermaid-source.ts'
import { tryParseCssColor } from '../shared/color-math.ts'
import type { ValidDiagramMeta } from './types.ts'

/** Canonical output owns configuration values. Verbatim wrapper output owns
 * authored bytes, including invalid bytes a caller may still need to repair. */
export function canonicalWrapperConfig(meta: ValidDiagramMeta): MermaidFrontmatterMap {
  let effective = mergeFrontmatterMaps({}, meta.frontmatter ?? {})
  for (const directive of meta.initDirectives) {
    if (mermaidInitDirectiveConfig(directive.raw) === undefined) {
      throw new Error('Cannot export canonical Mermaid: init directive payload must be a configuration object; repair the directive or use verbatim wrapper mode to preserve its source')
    }
    effective = mergeFrontmatterMaps(effective, directive.parsed)
  }
  if (effective.themeVariables !== undefined && effective.themeVariables !== null) {
    const vars = effective.themeVariables
    if (!vars || typeof vars !== 'object' || Array.isArray(vars)) {
      throw new Error('Cannot export canonical Mermaid: themeVariables must be a configuration object; repair its value or use verbatim wrapper mode to preserve its source')
    }
    // Mermaid derives palette colors even for a different diagram family.
    // Those color slots require concrete colors, unlike native CSS variables.
    for (const [key, value] of Object.entries(vars)) {
      if (!/^(?:git[0-7]|cScale(?:[0-9]|1[01])|background|primaryColor|secondaryColor|tertiaryColor|noteBkgColor)$/i.test(key)) continue
      if (typeof value !== 'string' || tryParseCssColor(value) === null) {
        throw new Error(`Cannot export canonical Mermaid: themeVariables.${key} must be a concrete CSS color; repair its value or use verbatim wrapper mode to preserve its source`)
      }
      vars[key] = value.trim()
    }
  }
  return effective
}
