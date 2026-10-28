import { describe, expect, test } from 'bun:test'
import { DEFAULT_ARCHITECTURE_VISUAL } from '../architecture/config.ts'
import { createMermaidRenderer, DefaultBackend, registerBackend, renderContractDigest, renderMermaidSVG } from '../index.ts'
import { renderedSvgDigest } from '../graphical-render.ts'
import { SCENE_VALIDATION_LIMITS } from '../scene/scene-validation.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { layoutMermaidWithReceipt } from '../agent/core.ts'
import {
  NON_SERIALIZABLE_RENDER_OPTION_FIELDS,
  SHARED_RENDER_OPTION_FIELDS,
  SHARED_RENDER_OPTION_FIELD_DESCRIPTORS,
  sharedRenderOptionsJsonSchema,
  styleInputJsonSchema,
  deferredRenderContractDigest,
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
      .toEqual(['render option "architecture.visual.boundaryRadius" is not allowed'])
    expect(validateSerializableRenderOptions({ style: { madeUp: true } }))
      .toContain('render option "style.madeUp" is not allowed')
    expect(validateSerializableRenderOptions({ style: { colors: { accent: 'url(https://invalid.example)' } } }))
      .toContain('render option "style.colors.accent" must be a safe, non-fetching CSS color')
    expect(validateSerializableRenderOptions({ bg: 'url(https://invalid.example)' }))
      .toContain('render option "bg" must be a safe, non-fetching CSS paint')
    expect(validateSerializableRenderOptions({ font: 'Inter" onload="alert(1)' }))
      .toContain('render option "font" must be a safe, non-fetching CSS font family or stack')
    expect(validateSerializableRenderOptions({
      architecture: { visual: { serviceSurface: 'url(https://invalid.example)' } },
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
    expect(() => resolveRenderRequest('flowchart LR\n  A --> B', hostile))
      .toThrow('render option "mermaidConfig.__proto__" uses a forbidden prototype key')
    const nullPrototypePayload = JSON.parse('{"mermaidConfig":{"__proto__":null}}')
    expect(() => resolveRenderRequest('flowchart LR\n  A --> B', nullPrototypePayload))
      .toThrow('render option "mermaidConfig.__proto__" uses a forbidden prototype key')
  })

  test('rejects a below-64KB deeply nested config before schema recursion', () => {
    let config: unknown = true
    for (let index = 0; index < 8_000; index++) config = { a: config }
    const options = { mermaidConfig: config }
    expect(JSON.stringify(options).length).toBeLessThan(64 * 1024)
    const problems = validateSerializableRenderOptions(options)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('exceeds maximum nesting depth 64')
    expect(() => resolveRenderRequest('flowchart LR\n  A --> B', options as never))
      .toThrow('exceeds maximum nesting depth 64')
  })

  test('rejects a below-64KB deeply nested source init config before normalization recursion', () => {
    let config = 'true'
    for (let index = 0; index < 12_000; index++) config = `{a:${config}}`
    const source = `%%{init: ${config}}%%\nflowchart LR\n  A --> B`
    expect(source.length).toBeLessThan(64 * 1024)
    expect(() => renderMermaidSVG(source)).toThrow('exceeds maximum nesting depth 64')
  })

  test('the public contract digest rejects hostile trees before canonical recursion', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => renderContractDigest(cyclic)).toThrow('must be acyclic')

    let deep: unknown = true
    for (let index = 0; index < 8_000; index++) deep = { a: deep }
    expect(() => renderContractDigest(deep)).toThrow('exceeds maximum nesting depth 64')
    expect(() => renderContractDigest({ callback: () => true })).toThrow('must be a JSON value, not function')
    expect(() => renderContractDigest([undefined])).toThrow('must be a JSON value, not undefined')
    expect(renderContractDigest({ omitted: undefined })).toBe(renderContractDigest({}))

    let getterReads = 0
    const accessorBacked: Record<string, unknown> = {}
    Object.defineProperty(accessorBacked, 'value', {
      enumerable: true,
      get() {
        getterReads++
        return getterReads === 1 ? 1 : accessorBacked
      },
    })
    expect(renderContractDigest(accessorBacked)).toBe(renderContractDigest({ value: 1 }))
    expect(getterReads).toBe(1)

    let boundary: unknown = null
    for (let index = 0; index < 64; index++) boundary = { a: boundary }
    expect(renderContractDigest(boundary)).toMatch(/^fnv1a64:/)
    expect(() => renderContractDigest({ a: boundary })).toThrow('exceeds maximum nesting depth 64')

    const width = Array(4096).fill(null)
    expect(renderContractDigest(width)).toMatch(/^fnv1a64:/)
    width.push(null)
    expect(() => renderContractDigest(width)).toThrow('at most 4096 items')
    let lengthReads = 0
    const changingLength = new Proxy(width, { get(target, key, receiver) {
      if (key === 'length' && lengthReads++ === 0) return 0
      return Reflect.get(target, key, receiver)
    } })
    expect(() => renderContractDigest(changingLength)).toThrow('at most 4096 items')

    const nodes = Array.from({ length: 25 }, (_, index) => Array(index === 24 ? 3974 : 4000).fill(null))
    expect(renderContractDigest(nodes)).toMatch(/^fnv1a64:/)
    nodes[24]!.push(null)
    expect(() => renderContractDigest(nodes)).toThrow('100000-node limit')

    for (const key of ['__proto__', 'prototype', 'constructor']) {
      expect(() => renderContractDigest(Object.fromEntries([[key, 1]]))).toThrow('forbidden prototype key')
      expect(renderContractDigest(Object.fromEntries([[key, undefined]]))).toBe(renderContractDigest({}))
    }
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined, 1n, Symbol('invalid')]) {
      expect(() => renderContractDigest([value])).toThrow(TypeError)
    }
    expect(() => renderContractDigest({ first: [Number.POSITIVE_INFINITY], second: {
      get value() { throw new Error('capture must finish before validation') },
    } })).toThrow('capture must finish before validation')
  })

  test.each(['drop', 'leak'] as const)('digest capture owns its slots when an inherited setter would %s a write', mode => {
    const original = Object.getOwnPropertyDescriptor(Array.prototype, '0')
    const marker = 123456
    let captured: unknown[] | undefined
    let reads = 0
    let intercepted = 0
    const source = mode === 'drop' ? [marker] : [marker, {
      get later() { reads++; if (captured) captured[0] = Number.POSITIVE_INFINITY; return true },
    }]
    let failure: unknown
    let digest: string | undefined
    try {
      Object.defineProperty(Array.prototype, '0', {
        configurable: true,
        set(this: unknown[], value: unknown) {
          if (value === marker) intercepted++
          if (value === marker && mode === 'drop') return
          if (value === marker) captured = this
          Object.defineProperty(this, '0', { value, writable: true, enumerable: true, configurable: true })
        },
      })
      try { digest = renderContractDigest(source) } catch (error) { failure = error }
    } finally {
      if (original) Object.defineProperty(Array.prototype, '0', original)
      else Reflect.deleteProperty(Array.prototype, '0')
    }
    expect(failure).toBeUndefined()
    expect(intercepted).toBe(0)
    expect(digest).toBe(renderContractDigest(mode === 'drop' ? [marker] : [marker, { later: true }]))
    expect(reads).toBe(mode === 'drop' ? 0 : 1)
  })

  test('digest capture does not hand private arrays to an ambient push replacement', () => {
    const original = Object.getOwnPropertyDescriptor(Array.prototype, 'push')!
    const marker = 123456
    let intercepted = 0
    let failure: unknown
    let digest: string | undefined
    try {
      Object.defineProperty(Array.prototype, 'push', { ...original,
        value(this: unknown[], ...values: unknown[]) {
          if (values.includes(marker)) { intercepted++; throw new Error('ambient push intercepted private data') }
          return Reflect.apply(original.value, this, values)
        },
      })
      try { digest = renderContractDigest([marker]) } catch (error) { failure = error }
    } finally { Object.defineProperty(Array.prototype, 'push', original) }
    expect(failure).toBeUndefined()
    expect(intercepted).toBe(0)
    expect(digest).toBe(renderContractDigest([marker]))
  })

  test.each(['array', 'object'] as const)('digest capture freezes each %s before a branding hook can change it', shape => {
    const original = Object.getOwnPropertyDescriptor(WeakSet.prototype, 'add')!
    const marker = 123456
    const source = () => shape === 'array' ? [marker] : { proofMarker: marker }
    let observed = 0
    let mutable = 0
    let digest: string | undefined
    let deferred: (() => string) | undefined
    let failure: unknown
    try {
      Object.defineProperty(WeakSet.prototype, 'add', { ...original,
        value(this: WeakSet<object>, value: object) {
          const key = Array.isArray(value) ? '0' : 'proofMarker'
          if (Reflect.get(value, key) === marker) {
            observed++
            if (!Object.isFrozen(value)) mutable++
            Reflect.set(value, key, Number.POSITIVE_INFINITY)
          }
          return Reflect.apply(original.value, this, [value])
        },
      })
      try {
        digest = renderContractDigest(source())
        deferred = deferredRenderContractDigest(source())
      } catch (error) { failure = error }
    } finally { Object.defineProperty(WeakSet.prototype, 'add', original) }
    expect(failure).toBeUndefined()
    expect(observed).toBe(2)
    expect(mutable).toBe(0)
    // Independent FNV-1a-64 vectors for [123456] / {"proofMarker":123456}.
    const expected = shape === 'array' ? 'fnv1a64:7dabd99ba02ca668' : 'fnv1a64:1c35bbcc0f62d15e'
    expect(digest).toBe(expected)
    expect(deferred!()).toBe(expected)
  })

  test.each(['proxy', 'getter'] as const)('bounds array copying when a %s grows after the length preflight', kind => {
    const maximum = 100_000
    let lastAllowedReads = 0
    let overflowReads = 0
    let source: unknown[]
    if (kind === 'proxy') {
      let lengthReads = 0
      source = new Proxy([], {
        get(target, key, receiver) {
          if (key === 'length') return lengthReads++ === 0 ? 0 : maximum + 1
          if (typeof key === 'string' && /^\d+$/.test(key)) {
            if (Number(key) === maximum - 1) lastAllowedReads++
            if (Number(key) === maximum) { overflowReads++; throw new Error('overflow slot was read') }
            return null
          }
          return Reflect.get(target, key, receiver)
        },
        getOwnPropertyDescriptor(target, key) {
          if (typeof key === 'string' && /^\d+$/.test(key)) return { value: null, writable: true, enumerable: true, configurable: true }
          return Reflect.getOwnPropertyDescriptor(target, key)
        },
      })
    } else {
      source = [null]
      Object.defineProperty(source, '0', { get() {
        source.length = maximum + 1
        source.fill(null, 1, maximum)
        Object.defineProperty(source, maximum - 1, { get() { lastAllowedReads++; return null } })
        Object.defineProperty(source, maximum, { get() { overflowReads++; throw new Error('overflow slot was read') } })
        return null
      } })
    }
    expect(() => renderContractDigest(source)).toThrow('100000-entry limit at $')
    expect(lastAllowedReads).toBe(1)
    expect(overflowReads).toBe(0)
  })

  test('graphical digests preserve the established canonical JSON string encoding', () => {
    expect(renderedSvgDigest('')).toBe('fnv1a64:07cc7607b4949e25')
    expect(renderedSvgDigest('a"\\\b\f\n\r\t\u0000\u001f/é😀\ud800x\udfff\u2028\u2029'))
      .toBe('fnv1a64:ab04f0d8cdd45e97')
  })

  test('graphical digests admit bounded output beyond the request-data character limit', () => {
    const svg = `<svg><!--${'x'.repeat(2_000_001)}--></svg>`
    const digest = renderedSvgDigest(svg)
    expect(digest).toMatch(/^fnv1a64:[0-9a-f]{16}$/)
    expect(renderedSvgDigest(svg.replace('--></svg>', 'y--></svg>'))).not.toBe(digest)
    expect(() => renderContractDigest(svg)).toThrow('2000000-character aggregate limit')
  })

  test('graphical digests retain primitive-string and final SVG byte admission', () => {
    let coercions = 0
    expect(() => renderedSvgDigest({ toString() { coercions++; return '<svg/>' } })).toThrow('must be a string')
    expect(coercions).toBe(0)
    const oversized = `<svg><!--${'é'.repeat(SCENE_VALIDATION_LIMITS.maxFinalSvgBytes / 2)}--></svg>`
    expect(oversized.length).toBeLessThan(SCENE_VALIDATION_LIMITS.maxFinalSvgBytes)
    expect(() => renderedSvgDigest(oversized)).toThrow(`${SCENE_VALIDATION_LIMITS.maxFinalSvgBytes}-byte final SVG limit`)
  })

  test('public SVG receipts hash admitted large backend output after the final security gate', () => {
    const id = 'backend:test/large-svg-digest'
    let padding = ''
    const unregister = registerBackend({
      ...DefaultBackend,
      id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      render(document, context) {
        return DefaultBackend.render(document, context).replace('</svg>', `<!--${padding}--></svg>`)
      },
    }, {
      compatibility: { core: '^0.5.0', scene: '^2.0.0' },
      provenance: { owner: 'large-svg-digest-test', source: 'test' },
    })
    try {
      padding = 'x'.repeat(2_000_001)
      const renderer = createMermaidRenderer({ backendPolicy: { selectBackend: () => id } })
      const result = renderer.renderMermaidSVGWithReceipt('flowchart LR\nA-->B', { embedFontImport: false, security: 'strict' })
      expect(result.svg.length).toBeGreaterThan(2_000_000)
      expect(result.svg).toContain(padding)
      expect(result.receipt.graphicalProjectionDigest).toMatch(/^fnv1a64:[0-9a-f]{16}$/)
    } finally {
      unregister()
    }
  })

  test('enforces the authority at the canonical render boundary', () => {
    const source = 'flowchart LR\n  A --> B'
    expect(() => resolveRenderRequest(source, { padding: 'wide' } as never)).toThrow('render option "padding" must be a non-negative finite number')
    expect(() => resolveRenderRequest(source, { security: 'loose' } as never)).toThrow('render option "security" must be default or strict')
    expect(() => resolveRenderRequest(source, { unknown: true } as never)).toThrow('unknown render option "unknown"')
    expect(() => resolveRenderRequest(source, { padding: null } as never)).toThrow('must be omitted instead of null')
    expect(() => resolveRenderRequest(source, { onConfigDiagnostic() {} })).not.toThrow()
  })

  test('admits top-level and nested RenderOptions accessors into one coherent snapshot', () => {
    let bgReads = 0
    let nestedReads = 0
    const classOptions: Record<string, unknown> = {}
    Object.defineProperty(classOptions, 'hierarchicalNamespaces', {
      enumerable: true,
      get() {
        nestedReads++
        return nestedReads === 1 ? false : 'changed after admission'
      },
    })
    const options: Record<string, unknown> = { class: classOptions }
    Object.defineProperty(options, 'bg', {
      enumerable: true,
      get() {
        bgReads++
        return bgReads === 1 ? '#123456' : 'url(https://invalid.example/after-validation)'
      },
    })

    const request = resolveRenderRequest('flowchart LR\n  A --> B', options as never)
    expect(bgReads).toBe(1)
    expect(nestedReads).toBe(1)
    expect(request.appearance.colors.bg).toBe('#123456')
    expect(request.renderOptions.bg).toBe('#123456')
    expect(request.renderOptions.class).toEqual({ hierarchicalNamespaces: false })
    expect(Object.isFrozen(request.renderOptions.class)).toBe(true)
  })

  test('preserves captured own option values despite inherited setters', () => {
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'padding')
    let padding: unknown
    try {
      Object.defineProperty(Object.prototype, 'padding', { configurable: true, set() {} })
      padding = resolveRenderRequest('sequenceDiagram\nA->>B: Hello', { padding: 42 }).renderOptions.padding
    } finally {
      if (prior) Object.defineProperty(Object.prototype, 'padding', prior)
      else Reflect.deleteProperty(Object.prototype, 'padding')
    }
    expect(padding).toBe(42)
  })

  test('captures onConfigDiagnostic once outside the serializable request', () => {
    let callbackReads = 0
    const first: string[] = []
    const replacement: string[] = []
    const options: Record<string, unknown> = {
      mermaidConfig: { flowchart: { curve: 'basis' } },
    }
    Object.defineProperty(options, 'onConfigDiagnostic', {
      enumerable: true,
      get() {
        callbackReads++
        return callbackReads === 1
          ? (diagnostic: { field: string }) => first.push(diagnostic.field)
          : (diagnostic: { field: string }) => replacement.push(diagnostic.field)
      },
    })

    renderMermaidSVG('flowchart LR\n  A --> B', options as never)
    expect(callbackReads).toBe(1)
    expect(first).toContain('flowchart.curve')
    expect(replacement).toEqual([])
  })

  test('emits explicit family-config diagnostics exactly once across SVG, terminal, and layout', () => {
    const source = 'flowchart LR\n  A --> B'
    const run = (render: (options: any) => unknown) => {
      const diagnostics: Array<{ code: string; field: string; message: string }> = []
      render({
        mermaidConfig: { flowchart: { curve: 'basis' } },
        onConfigDiagnostic: (diagnostic: { code: string; field: string; message: string }) => diagnostics.push(diagnostic),
      })
      return diagnostics
    }
    const graphical = run(options => renderMermaidSVG(source, options))
    const terminal = run(options => renderMermaidASCIIWithReceipt(source, { ...options, colorMode: 'none' }))
    const layout = run(options => layoutMermaidWithReceipt(source, options))
    expect(graphical).toHaveLength(1)
    expect(terminal).toEqual(graphical)
    expect(layout).toEqual(graphical)
    expect(graphical[0]).toMatchObject({ code: 'INEFFECTIVE_CONFIG', field: 'flowchart.curve' })
  })


})
