import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ExtensionCollisionError,
  canonicalExtensionId,
  createExtensionIdentity,
  evaluateExtensionCompatibility,
  registerExtension,
} from '../shared/extension-identity.ts'
import type { ExtensionRegistration } from '../shared/extension-identity.ts'
import {
  TUFTE_STYLE_ALIAS,
  getStyle,
  knownStyleDescriptors,
  knownStyles,
  registerStyle,
  resolveStyleReference,
  resolveStyleStack,
  validateStyleSpec,
} from '../scene/style-registry.ts'
import {
  DefaultBackend,
  getBackend,
  knownBackendDescriptors,
  registerBackend,
} from '../scene/backend.ts'
import { runBackendConformance } from '../scene/backend-conformance.ts'
import { createMermaidRenderer, renderMermaidSVGWithReceipt } from '../index.ts'
import '../scene/rough-backend.ts'
import '../scene/hybrid-backend.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../palette-catalog.ts'
import { THEMES } from '../theme.ts'

describe('shared extension identity', () => {
  test('requires kind-qualified IDs and rejects replacement with owner evidence', () => {
    expect(canonicalExtensionId('look', 'acme/report')).toBe('look:acme/report')
    const first = createExtensionIdentity({
      id: 'look:acme/report',
      kind: 'look',
      version: '1.0.0',
      provenance: { owner: 'acme', source: 'test' },
    })
    const second = createExtensionIdentity({
      id: 'look:acme/report',
      kind: 'look',
      version: '2.0.0',
      provenance: { owner: 'other', source: 'test' },
    })
    const registry = new Map<string, ExtensionRegistration<string, 'look'>>()
    registerExtension(registry, { identity: first, value: 'first' })
    expect(() => registerExtension(registry, { identity: second, value: 'second' }))
      .toThrow(ExtensionCollisionError)
    expect(() => registerExtension(registry, { identity: second, value: 'second' }))
      .toThrow(/owner "other".*registered by "acme"/)
    expect(registry.get(first.id)?.value).toBe('first')
    expect(Object.isFrozen(first)).toBe(true)
  })

  test('enforces known compatibility ranges while deferring unknown namespaced contracts', () => {
    expect(() => createExtensionIdentity({
      id: 'family:test/incompatible-core',
      kind: 'family',
      version: '1.0.0',
      compatibility: { core: '^99.0.0' },
      provenance: { owner: 'test', source: 'test' },
    })).toThrow(/core.*\^99\.0\.0.*host version 0\.1\.1/i)

    const forwardCompatible = createExtensionIdentity({
      id: 'look:test/future-contract',
      kind: 'look',
      version: '1.0.0',
      compatibility: { core: '^0.1.1', 'acme:future-scene': '^99.0.0' },
      provenance: { owner: 'test', source: 'test' },
    })
    expect(evaluateExtensionCompatibility(forwardCompatible)).toEqual({
      accepted: true,
      resolutions: [
        { contract: 'core', range: '^0.1.1', status: 'compatible', version: '0.1.1' },
        { contract: 'acme:future-scene', range: '^99.0.0', status: 'deferred' },
      ],
    })
  })
})

describe('canonical style identities', () => {
  test('keeps palette:tufte and look:tufte distinct while the bare alias selects the Look', () => {
    const palette = getStyle('palette:tufte')!
    const look = getStyle('look:tufte')!
    expect(palette.name).toBe('palette:tufte')
    expect(palette.font).toBeUndefined()
    expect(look.name).toBe('look:tufte')
    expect(look.font).toBe('EB Garamond')
    expect(getStyle('tufte')).toEqual(look)

    const resolution = resolveStyleReference('tufte')!
    expect(resolution.canonicalId).toBe('look:tufte')
    expect(resolution.diagnostic).toEqual(TUFTE_STYLE_ALIAS.diagnostic)
    expect(resolution.diagnostic?.removal).toEqual({ release: '0.3.0', date: '2027-01-31' })
  })

  test('discovers canonical identities and retains legacy inputs without duplicate meanings', () => {
    const descriptors = knownStyleDescriptors()
    const ids = descriptors.map(descriptor => descriptor.identity.id)
    expect(ids).toContain('palette:tufte')
    expect(ids).toContain('look:tufte')
    expect(new Set(ids).size).toBe(ids.length)
    expect(knownStyles()).toContain('palette:tufte')
    expect(knownStyles().filter(name => name === 'tufte')).toEqual(['tufte'])
    expect(descriptors.find(descriptor => descriptor.identity.id === 'look:tufte')?.identity.provenance.owner)
      .toBe('agentic-mermaid')
  })

  test('generates the legacy THEMES view from the canonical palette catalog', () => {
    expect(Object.keys(THEMES)).toEqual(BUILTIN_PALETTE_DEFINITIONS.map(definition => definition.legacyName))
    const descriptors = new Map(knownStyleDescriptors().map(descriptor => [descriptor.identity.id, descriptor]))
    for (const definition of BUILTIN_PALETTE_DEFINITIONS) {
      expect(THEMES[definition.legacyName]).toEqual(definition.colors)
      expect(descriptors.get(definition.id)?.spec.colors).toEqual(definition.colors)
    }
  })

  test('new registrations are namespaced, kind-correct, and collision-safe', () => {
    expect(() => registerStyle({ name: 'unqualified', stroke: 'jittered' }))
      .toThrow(/must use the "look:" or "palette:" namespace/)
    expect(() => registerStyle({ name: 'look:not-a-look', colors: { bg: '#fff' } }))
      .toThrow(/is a palette/)
    expect(() => registerStyle(
      { ...getStyle('look:tufte')!, name: 'look:tufte' },
      { provenance: { owner: 'collision-probe', source: 'test' } },
    )).toThrow(ExtensionCollisionError)
    expect(getStyle('tufte')?.font).toBe('EB Garamond')
    expect(() => registerStyle(
      { name: 'look:test/incompatible-core', stroke: 'jittered' },
      { compatibility: { core: '^99.0.0' } },
    )).toThrow(/incompatible requirements.*core/i)
  })

  test('returns an identity-guarded disposer for plugin unload and HMR', () => {
    const firstDispose = registerStyle({ name: 'look:dispose-probe', stroke: 'jittered' })
    expect(getStyle('look:dispose-probe')).toBeDefined()
    expect(firstDispose()).toBe(true)
    expect(getStyle('look:dispose-probe')).toBeUndefined()

    const replacementDispose = registerStyle({ name: 'look:dispose-probe', stroke: 'jittered', roughness: 2 })
    expect(firstDispose()).toBe(false)
    expect(getStyle('look:dispose-probe')?.roughness).toBe(2)
    expect(replacementDispose()).toBe(true)
  })

  test('returns deeply immutable discovery specs', () => {
    const descriptor = knownStyleDescriptors().find(candidate => candidate.identity.id === 'palette:tufte')!
    expect(Object.isFrozen(descriptor)).toBe(true)
    expect(Object.isFrozen(descriptor.spec)).toBe(true)
    expect(Object.isFrozen(descriptor.spec.colors)).toBe(true)
  })

  test('skips nested undefined channels and rejects null or backend data', () => {
    const merged = resolveStyleStack([
      { colors: { bg: '#ffffff', fg: '#111111' } },
      { colors: { bg: undefined, accent: '#ff0000' } },
    ])!
    expect(merged.colors).toEqual({ bg: '#ffffff', fg: '#111111', accent: '#ff0000' })
    expect(validateStyleSpec(null)).not.toEqual([])
    expect(validateStyleSpec({ font: null })).not.toEqual([])
    expect(validateStyleSpec({ colors: null })).not.toEqual([])
    expect(validateStyleSpec({ colors: { bg: null } })).not.toEqual([])
    expect(validateStyleSpec({ backend: 'rough' })).toContain('unknown field "backend"')
    const schema = JSON.parse(readFileSync(
      join(import.meta.dir, '..', '..', 'docs', 'schemas', 'style-spec.schema.json'),
      'utf8',
    )) as { properties: Record<string, unknown> }
    expect(schema.properties.backend).toBeUndefined()
  })
})

describe('backend registration and host policy', () => {
  test('stores canonical descriptors while retaining built-in short IDs', () => {
    expect(getBackend('default')).toBe(DefaultBackend)
    expect(getBackend('backend:default')).toBe(DefaultBackend)
    expect(knownBackendDescriptors().map(entry => entry.identity.id))
      .toEqual(['backend:default', 'backend:rough', 'backend:hybrid'])
    const descriptor = knownBackendDescriptors().find(entry => entry.identity.id === 'backend:default')!
    expect(descriptor.aliases).toEqual(['default'])
    expect(descriptor.identity.provenance.owner).toBe('agentic-mermaid')
    expect(descriptor.conformance).toMatchObject({
      backendId: 'backend:default',
      directOutputs: ['svg'],
      inheritedOutputs: [{ output: 'png', via: 'canonical-secured-svg-rasterizer', directlyTested: false }],
      passed: true,
    })
    expect(knownBackendDescriptors().every(entry => entry.conformance.passed)).toBe(true)
    expect(runBackendConformance(DefaultBackend, 'backend:default').passed).toBe(true)
  })

  test('rejects unqualified registrations and registered-ID replacement', () => {
    expect(() => registerBackend({ ...DefaultBackend, id: 'probe' }))
      .toThrow(/must use the "backend:" namespace/)
    expect(() => registerBackend(
      { ...DefaultBackend, id: 'backend:default' },
      { provenance: { owner: 'collision-probe', source: 'test' } },
    )).toThrow(ExtensionCollisionError)
    expect(getBackend('default')).toBe(DefaultBackend)
    expect(() => registerBackend({
      ...DefaultBackend,
      id: 'backend:test/incompatible-scene',
      capabilities: DefaultBackend.capabilities.map(claim => ({
        ...claim,
        target: 'backend:test/incompatible-scene',
      })),
    }, { compatibility: { core: '^0.1.1', scene: '^99.0.0' } }))
      .toThrow(/scene.*\^99\.0\.0.*host version 1\.0\.0/i)
  })

  test('rejects missing, empty, and mis-targeted backend capability claims', () => {
    expect(() => registerBackend({
      ...DefaultBackend,
      id: 'backend:no-claims',
      capabilities: undefined,
    } as unknown as typeof DefaultBackend)).toThrow(/must declare capability claims/)
    expect(() => registerBackend({
      ...DefaultBackend,
      id: 'backend:empty-claims',
      capabilities: [],
    })).toThrow(/must declare capability claims/)
    expect(() => registerBackend({
      ...DefaultBackend,
      id: 'backend:wrong-target',
    })).toThrow(/capability target must be "backend:wrong-target"/)
    const unevidencedId = 'backend:unevidenced'
    expect(() => registerBackend({
      ...DefaultBackend,
      id: unevidencedId,
      capabilities: DefaultBackend.capabilities.map((claim, index) => ({
        ...claim,
        target: unevidencedId,
        ...(index === 0 ? { evidence: undefined } : {}),
      })),
    })).toThrow(/must declare evidence/)
    const incompleteId = 'backend:incomplete'
    expect(() => registerBackend({
      ...DefaultBackend,
      id: incompleteId,
      capabilities: [{
        target: incompleteId,
        primitive: 'shape',
        feature: 'geometry',
        operation: 'render',
        realization: 'native',
        evidence: 'src/__tests__/extension-registries.test.ts',
      }],
    })).toThrow(/essential document\/serialize capability/)
  })

  test('rejects backends that discard semantics, vary identical renders, or emit unsafe SVG', () => {
    const backend = (id: string, render: typeof DefaultBackend.render) => ({
      ...DefaultBackend,
      id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      render,
    })

    expect(() => registerBackend(backend(
      'backend:test/discards-semantics',
      () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    ))).toThrow(/failed registration SVG conformance:.*document-semantics/)

    let call = 0
    expect(() => registerBackend(backend(
      'backend:test/nondeterministic',
      (doc, context) => DefaultBackend.render(doc, context)
        .replace('<svg ', `<svg data-conformance-call="${++call}" `),
    ))).toThrow(/failed registration SVG conformance:.*document-determinism/)

    expect(() => registerBackend(backend(
      'backend:test/unsafe',
      (doc, context) => DefaultBackend.render(doc, context)
        .replace('</svg>', '<script>alert(1)</script></svg>'),
    ))).toThrow(/failed registration SVG conformance:.*output-security/)
  })

  test('allows trusted in-process policy selection without serializable style data', () => {
    const selected = getBackend('backend:host/requested', {
      selectBackend(selection) {
        expect(selection.canonicalId).toBeUndefined()
        expect(selection.registered.map(entry => entry.identity.id)).toContain('backend:default')
        return 'backend:default'
      },
    })
    expect(selected).toBe(DefaultBackend)
    expect(getBackend('default', { selectBackend: () => null })).toBeUndefined()
  })

  test('renderer construction reaches a registered backend without changing the serializable request', () => {
    const id = 'backend:test/host-policy'
    const backend = {
      ...DefaultBackend,
      id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      render(doc: Parameters<typeof DefaultBackend.render>[0], context: Parameters<typeof DefaultBackend.render>[1]) {
        return DefaultBackend.render(doc, context).replace('<svg ', '<svg data-host-backend="test/host-policy" ')
      },
    }
    const unregister = registerBackend(backend, {
      provenance: { owner: 'host-policy-test', source: 'test' },
    })
    try {
      const renderer = createMermaidRenderer({
        backendPolicy: {
          selectBackend(selection) {
            expect(selection.requestedId).toBe('rough')
            expect(selection.registered.map(entry => entry.identity.id)).toContain(id)
            return id
          },
        },
      })
      const source = 'flowchart LR\n  A --> B'
      const options = { style: 'hand-drawn', seed: 9 } as const
      const hosted = renderer.renderMermaidSVGWithReceipt(source, options)
      const ordinary = renderMermaidSVGWithReceipt(source, options)

      expect(hosted.svg).toContain('data-host-backend="test/host-policy"')
      expect(ordinary.svg).not.toContain('data-host-backend="test/host-policy"')
      // The logical request stays comparable, while the artifact receipt names
      // the host-selected execution and emitted projection separately.
      expect(hosted.receipt.sharedRequestDigest).toBe(ordinary.receipt.sharedRequestDigest)
      expect(hosted.receipt.requestDigest).toBe(ordinary.receipt.requestDigest)
      expect(hosted.receipt.executionDecision?.backend).toMatchObject({
        mode: 'scene', selectedId: id, hostPolicy: true,
      })
      expect(ordinary.receipt.executionDecision?.backend).toMatchObject({
        mode: 'scene', selectedId: 'backend:rough', hostPolicy: false,
      })
      expect(hosted.receipt.graphicalProjectionDigest).not.toBe(ordinary.receipt.graphicalProjectionDigest)
    } finally {
      unregister()
    }
    expect(getBackend(id)).toBeUndefined()
  })

  test('snapshots backend identity, methods, and capabilities at registration', () => {
    const id = 'backend:test/immutable-snapshot'
    const backend = {
      ...DefaultBackend,
      id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      render(doc: Parameters<typeof DefaultBackend.render>[0], context: Parameters<typeof DefaultBackend.render>[1]) {
        return DefaultBackend.render(doc, context).replace('<svg ', `<svg data-snapshot-id="${this.id}" `)
      },
    }
    const capabilityCount = backend.capabilities.length
    const unregister = registerBackend(backend, {
      provenance: { owner: 'immutable-backend-test', source: 'test' },
    })
    try {
      backend.id = 'backend:test/tampered'
      backend.render = () => '<svg data-mutated="true" />'
      backend.capabilities.splice(0, backend.capabilities.length)

      const registered = getBackend(id)!
      const descriptor = knownBackendDescriptors().find(entry => entry.identity.id === id)!
      expect(Object.isFrozen(registered)).toBe(true)
      expect(registered.id).toBe(id)
      expect(registered.capabilities).toHaveLength(capabilityCount)
      expect(descriptor.capabilities).toHaveLength(capabilityCount)

      const renderer = createMermaidRenderer({ backendPolicy: { selectBackend: () => id } })
      const rendered = renderer.renderMermaidSVG('flowchart LR\n  A --> B', { style: 'hand-drawn' })
      expect(rendered).toContain(`data-snapshot-id="${id}"`)
      expect(rendered).not.toContain('data-mutated="true"')
    } finally {
      unregister()
    }
    expect(getBackend(id)).toBeUndefined()
    expect(getBackend('backend:test/tampered')).toBeUndefined()
  })

  test('a stale unregister token cannot delete a later registration with the same id', () => {
    const id = 'backend:test/stale-unregister'
    const backend = (marker: string) => ({
      ...DefaultBackend,
      id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      render(doc: Parameters<typeof DefaultBackend.render>[0], context: Parameters<typeof DefaultBackend.render>[1]) {
        return DefaultBackend.render(doc, context).replace('<svg ', `<svg data-registration="${marker}" `)
      },
    })
    const unregisterFirst = registerBackend(backend('first'))
    unregisterFirst()
    const unregisterSecond = registerBackend(backend('second'))
    try {
      unregisterFirst()
      expect(getBackend(id)).toBeDefined()
      const renderer = createMermaidRenderer({ backendPolicy: { selectBackend: () => id } })
      expect(renderer.renderMermaidSVG('flowchart LR\n  A --> B', { style: 'hand-drawn' }))
        .toContain('data-registration="second"')
    } finally {
      unregisterSecond()
    }
    expect(getBackend(id)).toBeUndefined()
  })
})
