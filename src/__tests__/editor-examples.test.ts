import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { EDITOR_EXAMPLES } from '../../editor/examples.ts'
import { parseMermaid, renderMermaidSVG } from '../agent/index.ts'
import { BUILTIN_FAMILY_METADATA, knownFamilies } from '../agent/families.ts'

const REPO = join(import.meta.dir, '..', '..')

interface EditorExample {
  id: string
  label: string
  category?: string
  diagramType?: string
  description?: string
  source: string
  options?: unknown
}

function loadEditorExamples(): { examples: EditorExample[]; exampleGlyph: (example: { diagramType?: string }) => string } {
  const source = readFileSync(join(REPO, 'editor/js/examples.js'), 'utf8')
  const context: {
    EDITOR_EXAMPLES: EditorExample[]
    exampleGlyph?: (example: { diagramType?: string }) => string
    document: {
      getElementById: () => null
      addEventListener: () => void
      querySelectorAll: () => unknown[]
    }
  } = {
    EDITOR_EXAMPLES: EDITOR_EXAMPLES as EditorExample[],
    document: {
      getElementById: () => null,
      addEventListener: () => undefined,
      querySelectorAll: () => [],
    },
  }

  runInNewContext(source, context, { filename: 'editor/js/examples.js' })

  expect(Array.isArray(context.EDITOR_EXAMPLES)).toBe(true)
  expect(typeof context.exampleGlyph).toBe('function')
  return { examples: context.EDITOR_EXAMPLES, exampleGlyph: context.exampleGlyph! }
}

describe('live editor examples', () => {
  test('Supported diagrams has a working basic example for every built-in family', () => {
    const { examples } = loadEditorExamples()
    const supported = examples.filter(e => e.category === 'Supported diagrams')
    const byId = new Map(supported.map(e => [e.id, e]))

    expect(new Set(knownFamilies())).toEqual(new Set(BUILTIN_FAMILY_METADATA.map(f => f.id)))
    expect(new Set(supported.map(e => e.diagramType))).toEqual(new Set(BUILTIN_FAMILY_METADATA.map(f => f.editorDiagramType)))

    for (const family of BUILTIN_FAMILY_METADATA) {
      const example = byId.get(family.editorExampleId)
      expect({ family: family.id, exampleId: family.editorExampleId, present: Boolean(example) })
        .toEqual({ family: family.id, exampleId: family.editorExampleId, present: true })
      expect(example!.diagramType).toBe(family.editorDiagramType)

      const parsed = parseMermaid(example!.source)
      expect({ family: family.id, example: example!.id, parsed: parsed.ok })
        .toEqual({ family: family.id, example: example!.id, parsed: true })
      if (!parsed.ok) continue
      expect({ example: example!.id, kind: parsed.value.kind }).toEqual({ example: example!.id, kind: family.id })
      expect(renderMermaidSVG(parsed.value)).toContain('<svg')
    }
  })

  test('example picker glyphs are explicitly mapped for every built-in family', () => {
    const { exampleGlyph } = loadEditorExamples()

    for (const family of BUILTIN_FAMILY_METADATA) {
      expect({ family: family.id, glyph: exampleGlyph({ diagramType: family.editorDiagramType }) })
        .toEqual({ family: family.id, glyph: family.editorGlyph })
    }
  })
})
