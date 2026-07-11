import { ineffectiveFieldsPresent } from '../shared/config-wire-or-warn.ts'

/**
 * Mermaid's documented stateDiagram config section. The state renderer does
 * not currently consume these fields, so Phase 0's wire-or-warn contract names
 * every present field rather than silently accepting it.
 */
export const STATE_CONFIG_FIELDS = [
  'arrowMarkerAbsolute', 'compositTitleSize', 'defaultRenderer', 'dividerMargin',
  'edgeLengthFactor', 'fontSize', 'fontSizeFactor', 'forkHeight', 'forkWidth',
  'labelHeight', 'miniPadding', 'nodeSpacing', 'noteMargin', 'padding', 'radius',
  'rankSpacing', 'sizeUnit', 'textHeight', 'titleShift', 'titleTopMargin',
] as const

export function stateIneffectiveConfigFields(configs: unknown[]): string[] {
  return ineffectiveFieldsPresent(configs, STATE_CONFIG_FIELDS)
}
