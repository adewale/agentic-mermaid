import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { DEFAULT_ARCHITECTURE_VISUAL } from '../architecture/config.ts'
import {
  NON_SERIALIZABLE_RENDER_OPTION_FIELDS,
  SHARED_RENDER_OPTION_FIELDS,
  SHARED_RENDER_OPTION_FIELD_DESCRIPTORS,
  SHARED_RENDER_OPTIONS_DOC_END,
  SHARED_RENDER_OPTIONS_DOC_START,
  sharedRenderOptionsJsonSchema,
  sharedRenderOptionsMarkdownTable,
  styleInputJsonSchema,
  resolveRenderRequest,
  validateSerializableRenderOptions,
} from '../render-contract.ts'

describe('shared RenderOptions authority', () => {
  test('projects every descriptor schema verbatim with terminal metadata', () => {
    const schema = sharedRenderOptionsJsonSchema() as {
      additionalProperties: boolean
      properties: Record<string, Record<string, unknown>>
      $defs: { jsonValue: Record<string, unknown> }
    }
    expect(schema.additionalProperties).toBe(false)
    expect(schema).toHaveProperty('$id', 'https://agentic-mermaid.dev/schemas/render-options.schema.json')
    expect(Object.keys(schema.properties)).toEqual([...SHARED_RENDER_OPTION_FIELDS])
    expect(schema.$defs.jsonValue).toHaveProperty('anyOf')

    for (const field of SHARED_RENDER_OPTION_FIELDS) {
      const descriptor = SHARED_RENDER_OPTION_FIELD_DESCRIPTORS[field]
      expect(schema.properties[field]).toMatchObject(descriptor.schema)
      expect(schema.properties[field]?.['x-agentic-mermaid-terminal']).toBe(descriptor.terminal)
    }
    expect(NON_SERIALIZABLE_RENDER_OPTION_FIELDS).toEqual(['onConfigDiagnostic'])
    expect(schema.properties).not.toHaveProperty('onConfigDiagnostic')
    expect(Object.isFrozen(SHARED_RENDER_OPTION_FIELD_DESCRIPTORS)).toBe(true)
    expect(Object.isFrozen(SHARED_RENDER_OPTION_FIELD_DESCRIPTORS.style.schema)).toBe(true)

    const mutableStyleProjection = styleInputJsonSchema() as { anyOf: Array<Record<string, unknown>> }
    mutableStyleProjection.anyOf[0]!.type = 'number'
    expect((styleInputJsonSchema() as { anyOf: Array<Record<string, unknown>> }).anyOf[0]?.type).not.toBe('number')
  })

  test('accepts the exact nested public shapes and recursive Mermaid JSON', () => {
    expect(validateSerializableRenderOptions({
      style: ['hand-drawn', { stroke: 'crisp', passes: 2, colors: { accent: '#005fcc' } }],
      class: { hierarchicalNamespaces: false },
      architecture: { visual: DEFAULT_ARCHITECTURE_VISUAL },
      timeline: { maxWidth: 800 },
      journey: { experienceCurve: false },
      gantt: { dependencyArrows: true, criticalPath: true },
      mermaidConfig: {
        theme: 'base',
        flowchart: { wrappingWidth: 160 },
        extensionData: [null, true, 4, 'value', { nested: ['ok'] }],
      },
    })).toEqual([])
  })

  test('rejects nested type drift, unknown keys, unsafe styles, and non-JSON values', () => {
    expect(validateSerializableRenderOptions({ class: { hierarchicalNamespaces: 'yes' } }))
      .toContain('render option "class.hierarchicalNamespaces" must be a boolean')
    expect(validateSerializableRenderOptions({ timeline: { maxWidth: Infinity } }))
      .toContain('render option "timeline.maxWidth" must be a finite number')
    expect(validateSerializableRenderOptions({ journey: { extra: true } }))
      .toContain('render option "journey.extra" is not allowed')
    expect(validateSerializableRenderOptions({ gantt: { dependencyArrows: 1 } }))
      .toContain('render option "gantt.dependencyArrows" must be a boolean')
    expect(validateSerializableRenderOptions({ architecture: { visual: { boundaryRadius: 9 } } }))
      .toEqual(expect.arrayContaining([
        'render option "architecture.visual.boundaryRadius" is not allowed',
        'render option "architecture.visual.groupHeaderHeight" is required',
      ]))
    expect(validateSerializableRenderOptions({ style: { madeUp: true } }))
      .toContain('render option "style.madeUp" is not allowed')
    expect(validateSerializableRenderOptions({ style: { colors: { accent: 'url(https://invalid.example)' } } }))
      .toContain('render option "style.colors.accent" must be a safe, non-fetching CSS color')
    expect(validateSerializableRenderOptions({ bg: 'url(https://invalid.example)' }))
      .toContain('render option "bg" must be a safe, non-fetching CSS paint')
    expect(validateSerializableRenderOptions({ font: 'Inter" onload="alert(1)' }))
      .toContain('render option "font" must be a safe, non-fetching CSS font family or stack')
    expect(validateSerializableRenderOptions({
      architecture: { visual: { ...DEFAULT_ARCHITECTURE_VISUAL, serviceSurface: 'url(https://invalid.example)' } },
    })).toContain('render option "architecture.visual.serviceSurface" must be a safe, non-fetching CSS paint')
    expect(validateSerializableRenderOptions({ style: 'not-a-registered-style' }).join('\n'))
      .toContain('Unknown style "not-a-registered-style"')
    expect(validateSerializableRenderOptions({ mermaidConfig: { nested: () => true } }).length).toBeGreaterThan(0)

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(validateSerializableRenderOptions({ mermaidConfig: cyclic }))
      .toContain('render option "mermaidConfig.self" must be acyclic')
    const hostile = JSON.parse('{"mermaidConfig":{"__proto__":{"polluted":true}}}')
    expect(validateSerializableRenderOptions(hostile))
      .toContain('render option "mermaidConfig.__proto__" uses a forbidden prototype key')
  })

  test('enforces the authority at the canonical render boundary', () => {
    const source = 'flowchart LR\n  A --> B'
    expect(() => resolveRenderRequest(source, { padding: 'wide' } as never)).toThrow('render option "padding" must be a finite number')
    expect(() => resolveRenderRequest(source, { security: 'loose' } as never)).toThrow('render option "security" must be default or strict')
    expect(() => resolveRenderRequest(source, { unknown: true } as never)).toThrow('unknown render option "unknown"')
    expect(() => resolveRenderRequest(source, { padding: null } as never)).toThrow('must be omitted instead of null')
    expect(() => resolveRenderRequest(source, { onConfigDiagnostic() {} })).not.toThrow()
  })

  test('keeps the marked API inventory byte-for-byte generated from descriptors', () => {
    const api = readFileSync(new URL('../../docs/api.md', import.meta.url), 'utf8')
    const start = api.indexOf(SHARED_RENDER_OPTIONS_DOC_START)
    const end = api.indexOf(SHARED_RENDER_OPTIONS_DOC_END)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const generated = api.slice(start + SHARED_RENDER_OPTIONS_DOC_START.length, end).trim()
    expect(generated).toBe(sharedRenderOptionsMarkdownTable())
    for (const field of ['wrappingWidth', 'class', 'architecture', 'timeline', 'journey', 'gantt']) {
      expect(generated).toContain(`\`${field}\``)
    }
    expect(generated).not.toContain('onConfigDiagnostic')
  })
})
