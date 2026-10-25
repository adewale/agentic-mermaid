import { mergeFrontmatterMaps, mermaidInitDirectiveConfig, type MermaidFrontmatterMap } from '../mermaid-source.ts'
import { tryParseCssColor } from '../shared/color-math.ts'
import type { ValidDiagramMeta } from './types.ts'

/** Canonical output owns configuration values. Verbatim wrapper output owns
 * authored bytes, including invalid bytes a caller may still need to repair. */
export function canonicalWrapperConfig(meta: ValidDiagramMeta, family?: string): MermaidFrontmatterMap {
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
    // Member names are case-sensitive. A raw value alone cannot establish
    // runtime rejection: directive sanitization and theme derivation own that.
    for (const [key, value] of Object.entries(vars)) {
      if (!/^(?:git[0-7]|cScale(?:[0-9]|1[01])|background|primaryColor|secondaryColor|tertiaryColor|noteBkgColor)$/.test(key)) continue
      if (typeof value === 'string' && tryParseCssColor(value) !== null) {
        vars[key] = value.trim()
        continue
      }
      if (derivedThemes(effective, family).some(theme => themeRequiresColor(theme, key, vars))) {
        throw new Error(`Cannot export canonical Mermaid: themeVariables.${key} must be a concrete CSS color; repair its value or use verbatim wrapper mode to preserve its source`)
      }
    }
  }
  return effective
}

/** The pinned appearance resolver chooses a usable diagram-scoped theme before
 * a global one. These diagram defaults differ from the site's default theme,
 * so they trigger derivation even when the document never names a theme. */
function derivedThemes(config: MermaidFrontmatterMap, family: string | undefined): unknown[] {
  const section = family === 'xychart' ? 'xyChart' : family
  const scoped = section && config[section]
  const scopedTheme = scoped && typeof scoped === 'object' && !Array.isArray(scoped) ? scoped.theme : undefined
  const themes = ['base', 'default', 'forest', 'dark', 'neutral', 'neo', 'neo-dark', 'redux', 'redux-dark', 'redux-color', 'redux-dark-color', 'null']
  const selected = [scopedTheme, config.theme].find(value => typeof value === 'string' && themes.includes(value))
    ?? (['flowchart', 'class', 'state', 'er', 'sequence', 'requirement', 'swimlane', 'agentflow', 'usecase', 'venn'].includes(family ?? '') ? 'redux-color' : 'default')
  // With no global theme request and no change from the initialized default,
  // Mermaid merges overrides without rerunning theme color calculations.
  const active = config.theme || selected !== 'default' ? selected : undefined
  // Public parse clears the diagram scope in finally. A global request is
  // derived there too, even when the diagram-scoped theme superseded it.
  return [...new Set([active, config.theme])]
}

/** The pinned directive sanitizer removes nulls and neutralizes strings outside
 * its theme-value vocabulary. Preserve the authored value in canonical source;
 * this view is only for deciding whether a known derivation will fail. */
function directiveThemeValue(vars: MermaidFrontmatterMap, key: string): unknown {
  const value = vars[key]
  if (value === null || value === undefined) return undefined
  return typeof value === 'string' && !/^[\d "#%(),.;A-Za-z]+$/.test(value) ? '' : value
}

/** Sufficient preconditions for known pinned theme calculations, not a full
 * configuration schema. Reject only when a calculation consumes the override;
 * an unused or explicitly replaced value does not require a concrete color. */
function themeRequiresColor(theme: unknown, key: string, vars: MermaidFrontmatterMap): boolean {
  if (!['base', 'default', 'forest', 'dark', 'neutral', 'redux-color'].includes(String(theme))) return false
  const value = directiveThemeValue(vars, key)
  if (value === undefined) return false
  const needs = (derived: string): boolean => !directiveThemeValue(vars, derived)
  if (/^git[0-7]$/.test(key)) return theme !== 'dark' && theme !== 'neutral' && Boolean(value)
  const scale = /^cScale(\d+)$/.exec(key)
  if (scale) {
    const index = Number(scale[1])
    if (!value || !(Number(directiveThemeValue(vars, 'THEME_COLOR_LIMIT') ?? 12) > index)) return false
    return theme !== 'dark' && theme !== 'neutral' && theme !== 'redux-color' || needs(`cScaleInv${index}`) || needs(`cScalePeer${index}`)
  }
  if (theme === 'redux-color') {
    const reset = (derived: string): boolean => directiveThemeValue(vars, derived) !== undefined && needs(derived)
    if (key === 'background') return needs('lineColor') || needs('arrowheadColor') || needs('rectBkgColor')
    // Redux-color constructs these two paints before applying overrides.
    if (key === 'primaryColor') return needs('secondaryColor') || reset('tertiaryColor') || reset('primaryBorderColor')
    if (key === 'secondaryColor') return needs('secondaryBorderColor') || needs('secondaryTextColor') || needs('activationBorderColor')
      || Boolean(directiveThemeValue(vars, 'darkMode')) && (needs('edgeLabelBackground') || needs('relationLabelBackground'))
    if (key === 'tertiaryColor') return needs('tertiaryBorderColor') || needs('tertiaryTextColor')
    return key === 'noteBkgColor' && reset('noteBorderColor')
  }
  if (theme !== 'base') {
    // These themes calculate fillType2/fillType3 unconditionally. Dark also
    // derives its event/ER backgrounds unless those paints were supplied.
    if (key === 'primaryColor' || key === 'secondaryColor') return true
    if (key === 'background' && theme === 'dark') return needs('emSwimlaneBackgroundOdd') || needs('emSwimlaneBackgroundStroke') || needs('attributeBackgroundColorOdd') || needs('attributeBackgroundColorEven')
    if (key === 'tertiaryColor' && theme === 'forest') return needs('cScalePeer2')
    return false
  }
  if (key === 'primaryColor') return needs('secondaryColor') || needs('tertiaryColor') || needs('primaryBorderColor')
  if (key === 'secondaryColor') return needs('secondaryBorderColor') || needs('secondaryTextColor') || needs('activationBorderColor')
  if (key === 'tertiaryColor') return needs('tertiaryBorderColor') || needs('tertiaryTextColor')
  if (key === 'noteBkgColor') return needs('noteBorderColor')
  if (key === 'background') return needs('lineColor') || needs('arrowheadColor')
  return false
}
