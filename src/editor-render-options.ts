import type { RenderOptions } from './types.ts'
import { decodeXML } from 'entities'
import { mermaidFirstLine } from './mermaid-source-wrapper.ts'
import { detectsPieFamily, detectsRadarFamily } from './shared/builtin-family-detection.ts'
import { resolveAuthoredEditorOptions, type EditorRenderStateInput, type EditorRenderOptionDependencies } from './editor-option-policy.ts'

export type { EditorRenderStateInput, EditorRenderOptionDependencies } from './editor-option-policy.ts'

/** Add host-only fitting after the shared authored-option and sink policy. */
export function resolveEditorRenderOptions(state: EditorRenderStateInput | null | undefined, dependencies: EditorRenderOptionDependencies): RenderOptions {
  const input = state ?? {}
  const options = resolveAuthoredEditorOptions(state, dependencies)
  if (input.fitLabelsToPane === true && typeof input.paneWidth === 'number' && Number.isFinite(input.paneWidth) && input.paneWidth >= 1 && typeof input.source === 'string') {
    const line = mermaidFirstLine(decodeXML(input.source))
    const family = detectsPieFamily(line) ? 'pie' : detectsRadarFamily(line) ? 'radar' : undefined
    if (family) {
      const authored = options[family] as { maxWidth?: number } | undefined
      if (authored?.maxWidth === undefined) options[family] = { ...authored, maxWidth: Math.floor(input.paneWidth) }
    }
  }
  return options
}
