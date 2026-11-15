import { editorModuleScript } from './helpers/editor-module-harness.ts'
import { describe, expect, test } from 'bun:test'
import { EDITOR_SUPPORTED_FAMILY_LIST } from '../editor-family-data.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { UPSTREAM_MERMAID_FAMILY_INDEX } from '../upstream-family-index.ts'
import { evaluateBrowserScript } from './browser-script-harness.ts'

const HELPERS = await editorModuleScript('helpers.js')

function editorErrorCard(): (error: unknown) => string {
  return evaluateBrowserScript<(error: unknown) => string>(HELPERS, { SUPPORTED_FAMILY_LIST: EDITOR_SUPPORTED_FAMILY_LIST }, 'formatRenderErrorHtml')
}

/** The exact error the editor's renderer adapter throws for this source. */
function rendererError(source: string): unknown {
  try {
    renderMermaidSVGWithReceipt(source, { security: 'strict' })
  } catch (error) {
    return error
  }
  throw new Error(`expected the renderer to reject: ${JSON.stringify(source)}`)
}

describe('editor family diagnostics are registry-derived', () => {
  test('every registry-classified non-native Mermaid header gets the unsupported-family card', () => {
    const card = editorErrorCard()
    const nonNative = UPSTREAM_MERMAID_FAMILY_INDEX.families.flatMap(family => family.headers
      .filter(header => header.agenticStatus !== 'native')
      .map(header => ({ family: family.id, header: header.value, status: header.agenticStatus })))
    expect(nonNative.length).toBeGreaterThan(0)
    for (const entry of nonNative) {
      const html = card(rendererError(`${entry.header}\n  A`))
      expect({ ...entry, recognized: html.includes(`<strong class="preview-error-title">${entry.family} is valid Mermaid, but this editor does not support it.</strong>`) })
        .toEqual({ ...entry, recognized: true })
      expect(html).toContain(`Supported families: ${EDITOR_SUPPORTED_FAMILY_LIST}.`)
    }
  })

  test('a malformed supported diagram keeps the generic located render-error card', () => {
    const html = editorErrorCard()(rendererError('flowchart TD\n  A --> '))
    expect(html).toContain('We could not render this diagram.')
    expect(html).not.toContain('this editor does not support it')
  })
})
