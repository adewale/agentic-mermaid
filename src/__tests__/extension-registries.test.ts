import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ExtensionCollisionError,
  canonicalExtensionId,
  createExtensionIdentity,
  evaluateExtensionCompatibility,
  registerCompatibilityAlias,
  registerExtension,
} from '../shared/extension-identity.ts'
import type { ExtensionRegistration } from '../shared/extension-identity.ts'
import {
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
import { SCENE_VALIDATION_LIMITS } from '../scene/scene-validation.ts'
import { createMermaidRenderer, renderMermaidSVGWithReceipt } from '../index.ts'
import '../scene/builtin-backends.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../palette-catalog.ts'
import { THEMES } from '../theme.ts'

const BACKEND_COMPATIBILITY = Object.freeze({ core: '^0.1.1', scene: '^1.0.0' })
const BACKEND_REGISTRATION_OPTIONS = Object.freeze({ compatibility: BACKEND_COMPATIBILITY })
const registerBackendFromJs = registerBackend as unknown as (
  backend: Parameters<typeof registerBackend>[0],
  options?: { readonly compatibility?: Readonly<Record<string, string>> },
) => () => void

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

  test('captures one deep identity snapshot before validation and storage', () => {
    const reads = { id: 0, version: 0, compatibility: 0, core: 0, provenance: 0, owner: 0 }
    const compatibility: Record<string, unknown> = {}
    Object.defineProperty(compatibility, 'core', {
      enumerable: true,
      get() {
        reads.core++
        return reads.core === 1 ? '^0.1.1' : '^99.0.0'
      },
    })
    const provenance: Record<string, unknown> = { source: 'test' }
    Object.defineProperty(provenance, 'owner', {
      enumerable: true,
      get() {
        reads.owner++
        return reads.owner === 1 ? 'snapshot-owner' : ''
      },
    })
    const input: Record<string, unknown> = { kind: 'look' }
    Object.defineProperties(input, {
      id: {
        enumerable: true,
        get() {
          reads.id++
          return reads.id === 1 ? 'look:test/identity-snapshot' : 'not-canonical'
        },
      },
      version: {
        enumerable: true,
        get() {
          reads.version++
          return reads.version === 1 ? '1.2.3' : 'not-semver'
        },
      },
      compatibility: {
        enumerable: true,
        get() {
          reads.compatibility++
          return compatibility
        },
      },
      provenance: {
        enumerable: true,
        get() {
          reads.provenance++
          return provenance
        },
      },
    })

    const identity = createExtensionIdentity(input as unknown as Parameters<typeof createExtensionIdentity<'look'>>[0])
    expect(reads).toEqual({ id: 1, version: 1, compatibility: 1, core: 1, provenance: 1, owner: 1 })
    expect(identity).toEqual({
      id: 'look:test/identity-snapshot',
      kind: 'look',
      version: '1.2.3',
      compatibility: { core: '^0.1.1' },
      provenance: { owner: 'snapshot-owner', source: 'test' },
    })
  })

  test('keys and stores a registration from one captured identity', () => {
    const identity = (localId: string) => createExtensionIdentity({
      id: `look:test/${localId}`,
      kind: 'look',
      version: '1.0.0',
      provenance: { owner: 'snapshot-owner', source: 'test' },
    })
    const first = identity('first')
    const second = identity('second')
    const third = identity('third')
    let identityReads = 0
    let valueReads = 0
    const registration: Record<string, unknown> = {}
    Object.defineProperties(registration, {
      identity: {
        enumerable: true,
        get() {
          identityReads++
          return identityReads === 1 ? first : identityReads === 2 ? second : third
        },
      },
      value: {
        enumerable: true,
        get() {
          valueReads++
          return valueReads === 1 ? 'captured' : 'poisoned'
        },
      },
    })
    const registry = new Map<string, ExtensionRegistration<string, 'look'>>()

    registerExtension(registry, registration as unknown as ExtensionRegistration<string, 'look'>)

    expect({ identityReads, valueReads }).toEqual({ identityReads: 1, valueReads: 1 })
    expect([...registry.keys()]).toEqual([first.id])
    expect(registry.get(first.id)).toEqual({ identity: first, value: 'captured' })
  })

  test('rejects a forged live identity before reading an accessor-backed id', () => {
    let idReads = 0
    const identity: Record<string, unknown> = {
      kind: 'look',
      version: '1.0.0',
      compatibility: {},
      provenance: { owner: 'forged', source: 'test' },
    }
    Object.defineProperty(identity, 'id', {
      enumerable: true,
      get() {
        idReads++
        return idReads === 1 ? 'look:test/forged' : 'look:test/retargeted'
      },
    })
    const registry = new Map<string, ExtensionRegistration<string, 'look'>>()

    expect(() => registerExtension(registry, {
      identity,
      value: 'payload',
    } as unknown as ExtensionRegistration<string, 'look'>))
      .toThrow(/identity must be created by createExtensionIdentity/)
    expect(idReads).toBe(0)
    expect(registry.size).toBe(0)
  })

  test('keeps extension registration atomic when an identity getter re-enters the same Map', () => {
    const nested = createExtensionIdentity({
      id: 'look:test/reentrant-nested',
      kind: 'look',
      version: '1.0.0',
      provenance: { owner: 'reentrancy-test', source: 'test' },
    })
    const forged = {
      id: 'look:test/reentrant-forged',
      kind: 'look',
      version: '1.0.0',
      compatibility: {},
      provenance: { owner: 'forged', source: 'test' },
    }
    const registry = new Map<string, ExtensionRegistration<string, 'look'>>()
    let nestedError: unknown
    const outer: Record<string, unknown> = { value: 'outer' }
    Object.defineProperty(outer, 'identity', {
      enumerable: true,
      get() {
        try {
          registerExtension(registry, { identity: nested, value: 'nested' })
        } catch (error) {
          nestedError = error
        }
        return forged
      },
    })

    expect(() => registerExtension(
      registry,
      outer as unknown as ExtensionRegistration<string, 'look'>,
    )).toThrow(/identity must be created by createExtensionIdentity/)
    expect(String(nestedError)).toMatch(/registry mutation is forbidden/)
    expect(registry.size).toBe(0)

    const admittedOuter = createExtensionIdentity({
      id: 'look:test/reentrant-outer',
      kind: 'look',
      version: '1.0.0',
      provenance: { owner: 'reentrancy-test', source: 'test' },
    })
    const caught: Record<string, unknown> = { value: 'outer' }
    Object.defineProperty(caught, 'identity', {
      enumerable: true,
      get() {
        try {
          registerExtension(registry, { identity: nested, value: 'nested' })
        } catch {}
        return admittedOuter
      },
    })
    expect(() => registerExtension(
      registry,
      caught as unknown as ExtensionRegistration<string, 'look'>,
    )).toThrow(/reentrant attempt/)
    expect(registry.size).toBe(0)
  })

  test('keeps stable input names separate from expiring compatibility aliases', () => {
    const aliases = new Map()
    expect(() => registerCompatibilityAlias(aliases, {
      alias: 'old-name',
      targetId: 'look:new-name',
    } as any)).toThrow(/requires a diagnostic and removal release\/date/)
    registerCompatibilityAlias(aliases, {
      alias: 'old-name',
      targetId: 'look:new-name',
      diagnostic: {
        code: 'STYLE_ALIAS_DEPRECATED',
        message: 'use new-name',
        removal: { release: '0.3.0', date: '2027-01-31' },
      },
    })
    expect(aliases.get('old-name')).toMatchObject({
      diagnostic: { removal: { release: '0.3.0', date: '2027-01-31' } },
    })
  })

  test('captures one deep compatibility alias before validation and keying', () => {
    const reads = { alias: 0, targetId: 0, diagnostic: 0, code: 0, message: 0, removal: 0, release: 0, date: 0 }
    const removal: Record<string, unknown> = {}
    Object.defineProperties(removal, {
      release: {
        enumerable: true,
        get() {
          reads.release++
          return reads.release === 1 ? '0.3.0' : ''
        },
      },
      date: {
        enumerable: true,
        get() {
          reads.date++
          return reads.date === 1 ? '2027-01-31' : 'not-a-date'
        },
      },
    })
    const diagnostic: Record<string, unknown> = {}
    Object.defineProperties(diagnostic, {
      code: { enumerable: true, get() { reads.code++; return reads.code === 1 ? 'STYLE_ALIAS_DEPRECATED' : '' } },
      message: { enumerable: true, get() { reads.message++; return reads.message === 1 ? 'use new-name' : '' } },
      removal: { enumerable: true, get() { reads.removal++; return removal } },
    })
    const input: Record<string, unknown> = {}
    Object.defineProperties(input, {
      alias: {
        enumerable: true,
        get() {
          reads.alias++
          return reads.alias === 1 ? 'old-snapshot' : 'bad:stored'
        },
      },
      targetId: {
        enumerable: true,
        get() {
          reads.targetId++
          return reads.targetId === 1 ? 'look:new-name' : 'not-canonical'
        },
      },
      diagnostic: { enumerable: true, get() { reads.diagnostic++; return diagnostic } },
    })
    const aliases = new Map<string, Parameters<typeof registerCompatibilityAlias>[1]>()

    registerCompatibilityAlias(aliases, input as unknown as Parameters<typeof registerCompatibilityAlias>[1])

    expect(reads).toEqual({ alias: 1, targetId: 1, diagnostic: 1, code: 1, message: 1, removal: 1, release: 1, date: 1 })
    expect([...aliases.entries()]).toEqual([['old-snapshot', {
      alias: 'old-snapshot',
      targetId: 'look:new-name',
      diagnostic: {
        code: 'STYLE_ALIAS_DEPRECATED',
        message: 'use new-name',
        removal: { release: '0.3.0', date: '2027-01-31' },
      },
    }]])
  })

  test('keeps alias registration atomic when an alias getter re-enters the same Map', () => {
    const diagnostic = {
      code: 'STYLE_ALIAS_DEPRECATED',
      message: 'use canonical input',
      removal: { release: '0.3.0', date: '2027-01-31' },
    }
    const aliases = new Map<string, Parameters<typeof registerCompatibilityAlias>[1]>()
    let nestedError: unknown
    const invalidOuter: Record<string, unknown> = {
      targetId: 'not-canonical',
      diagnostic,
    }
    Object.defineProperty(invalidOuter, 'alias', {
      enumerable: true,
      get() {
        try {
          registerCompatibilityAlias(aliases, {
            alias: 'nested-old',
            targetId: 'look:nested-new',
            diagnostic,
          })
        } catch (error) {
          nestedError = error
        }
        return 'outer-old'
      },
    })

    expect(() => registerCompatibilityAlias(
      aliases,
      invalidOuter as unknown as Parameters<typeof registerCompatibilityAlias>[1],
    )).toThrow(/requires a canonical target id/)
    expect(String(nestedError)).toMatch(/registry mutation is forbidden/)
    expect(aliases.size).toBe(0)

    const caught: Record<string, unknown> = {
      targetId: 'look:outer-new',
      diagnostic,
    }
    Object.defineProperty(caught, 'alias', {
      enumerable: true,
      get() {
        try {
          registerCompatibilityAlias(aliases, {
            alias: 'nested-old',
            targetId: 'look:nested-new',
            diagnostic,
          })
        } catch {}
        return 'outer-old'
      },
    })
    expect(() => registerCompatibilityAlias(
      aliases,
      caught as unknown as Parameters<typeof registerCompatibilityAlias>[1],
    )).toThrow(/reentrant attempt/)
    expect(aliases.size).toBe(0)
  })

  test('shares the same-Map mutation guard across both generic helpers', () => {
    const registry = new Map<string, ExtensionRegistration<string, 'look'>>()
    const outerIdentity = createExtensionIdentity({
      id: 'look:test/cross-helper-outer',
      kind: 'look',
      version: '1.0.0',
      provenance: { owner: 'reentrancy-test', source: 'test' },
    })
    let nestedError: unknown
    const outer: Record<string, unknown> = { value: 'outer' }
    Object.defineProperty(outer, 'identity', {
      enumerable: true,
      get() {
        try {
          registerCompatibilityAlias(
            registry as unknown as Map<string, Parameters<typeof registerCompatibilityAlias>[1]>,
            {
              alias: 'cross-helper-old',
              targetId: 'look:cross-helper-new',
              diagnostic: {
                code: 'STYLE_ALIAS_DEPRECATED',
                message: 'use canonical input',
                removal: { release: '0.3.0', date: '2027-01-31' },
              },
            },
          )
        } catch (error) {
          nestedError = error
        }
        return outerIdentity
      },
    })

    expect(() => registerExtension(
      registry,
      outer as unknown as ExtensionRegistration<string, 'look'>,
    )).toThrow(/reentrant attempt/)
    expect(String(nestedError)).toMatch(/registry mutation is forbidden/)
    expect(registry.size).toBe(0)
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
    const alias = knownStyleDescriptors()
      .find(descriptor => descriptor.identity.id === 'look:tufte')!
      .aliases.find(candidate => candidate.alias === 'tufte')!
    expect(resolution.canonicalId).toBe('look:tufte')
    expect(resolution.diagnostic).toEqual(alias.diagnostic)
    expect(resolution.diagnostic?.removal).toEqual({ release: '0.3.0', date: '2027-01-31' })
  })

  test('discovers canonical identities and retains legacy inputs without duplicate meanings', () => {
    const descriptors = knownStyleDescriptors()
    const ids = descriptors.map(descriptor => descriptor.identity.id)
    expect(ids).toContain('palette:tufte')
    expect(ids).toContain('look:tufte')
    expect(new Set(ids).size).toBe(ids.length)
    expect(knownStyles()).toContain('palette:tufte')
    expect(knownStyles()).toContain('look:tufte')
    expect(knownStyles()).not.toContain('tufte')
    expect(descriptors.find(descriptor => descriptor.identity.id === 'look:tufte')?.identity.provenance.owner)
      .toBe('agentic-mermaid')
    expect(resolveStyleReference('default')).toMatchObject({
      canonicalId: 'look:crisp',
      diagnostic: { code: 'STYLE_ALIAS_DEPRECATED', removal: { release: '0.3.0', date: '2027-01-31' } },
    })
    expect(descriptors.find(descriptor => descriptor.identity.id === 'look:crisp')).toMatchObject({
      inputName: 'crisp',
      kind: 'look',
      isDefault: true,
    })
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

  test('retains core compatibility when registration passes an empty override', () => {
    const unregister = registerStyle(
      { name: 'palette:test/core-default', colors: { bg: '#fff' } },
      { compatibility: {} },
    )
    try {
      expect(knownStyleDescriptors()
        .find(descriptor => descriptor.identity.id === 'palette:test/core-default')
        ?.identity.compatibility).toMatchObject({ core: '^0.1.1' })
    } finally {
      unregister()
    }
  })

  test('materializes accessor-backed StyleSpecs and registration metadata once before validation', () => {
    const id = 'look:test/accessor-snapshot'
    const reads = {
      name: 0,
      font: 0,
      passes: 0,
      colors: 0,
      bg: 0,
      version: 0,
      compatibility: 0,
      core: 0,
      provenance: 0,
      owner: 0,
    }
    const colors: Record<string, unknown> = { fg: '#111111' }
    Object.defineProperty(colors, 'bg', {
      enumerable: true,
      get() {
        reads.bg++
        return reads.bg === 1 ? '#ffffff' : 'url(https://attacker.invalid/background.svg)'
      },
    })
    const spec = {} as Parameters<typeof registerStyle>[0]
    Object.defineProperties(spec, {
      name: {
        enumerable: true,
        get() {
          reads.name++
          return reads.name === 1 ? id : 'look:test/poisoned-id'
        },
      },
      font: {
        enumerable: true,
        get() {
          reads.font++
          return reads.font === 1 ? 'Inter' : 'x;src:url(https://attacker.invalid/f.woff)'
        },
      },
      passes: {
        enumerable: true,
        get() {
          reads.passes++
          return reads.passes === 1 ? 1 : Number.MAX_SAFE_INTEGER
        },
      },
      colors: {
        enumerable: true,
        get() {
          reads.colors++
          return colors
        },
      },
    })
    const compatibility: Record<string, unknown> = {}
    Object.defineProperty(compatibility, 'core', {
      enumerable: true,
      get() {
        reads.core++
        return reads.core === 1 ? '^0.1.1' : '^99.0.0'
      },
    })
    const provenance: Record<string, unknown> = { source: 'test' }
    Object.defineProperty(provenance, 'owner', {
      enumerable: true,
      get() {
        reads.owner++
        return reads.owner === 1 ? 'style-snapshot-test' : ''
      },
    })
    const options = {} as Parameters<typeof registerStyle>[1] & Record<string, unknown>
    Object.defineProperties(options, {
      version: {
        enumerable: true,
        get() {
          reads.version++
          return reads.version === 1 ? '1.2.3' : 'not-semver'
        },
      },
      compatibility: {
        enumerable: true,
        get() {
          reads.compatibility++
          return compatibility
        },
      },
      provenance: {
        enumerable: true,
        get() {
          reads.provenance++
          return provenance
        },
      },
    })

    const unregister = registerStyle(spec, options)
    try {
      colors.fg = '#000000'
      expect(reads).toEqual({
        name: 1,
        font: 1,
        passes: 1,
        colors: 1,
        bg: 1,
        version: 1,
        compatibility: 1,
        core: 1,
        provenance: 1,
        owner: 1,
      })
      expect(getStyle(id)).toMatchObject({
        name: id,
        font: 'Inter',
        passes: 1,
        colors: { bg: '#ffffff', fg: '#111111' },
      })
      const descriptor = knownStyleDescriptors().find(candidate => candidate.identity.id === id)!
      expect(descriptor.identity).toMatchObject({
        version: '1.2.3',
        compatibility: { core: '^0.1.1' },
        provenance: { owner: 'style-snapshot-test', source: 'test' },
      })
      expect(Object.isFrozen(descriptor.spec)).toBe(true)
      expect(Object.isFrozen(descriptor.spec.colors)).toBe(true)
    } finally {
      unregister()
    }
  })

  test('materializes an inline StyleSpec before validation and stack resolution', () => {
    const reads = { font: 0, passes: 0, colors: 0, accent: 0 }
    const colors: Record<string, unknown> = {}
    Object.defineProperty(colors, 'accent', {
      enumerable: true,
      get() {
        reads.accent++
        return reads.accent === 1 ? '#ff0000' : 'url(https://attacker.invalid/accent.svg)'
      },
    })
    const inline = {} as Parameters<typeof resolveStyleStack>[0]
    Object.defineProperties(inline, {
      font: {
        enumerable: true,
        get() {
          reads.font++
          return reads.font === 1 ? 'Inter' : 'x;src:url(https://attacker.invalid/f.woff)'
        },
      },
      passes: {
        enumerable: true,
        get() {
          reads.passes++
          return reads.passes === 1 ? 1 : Number.MAX_SAFE_INTEGER
        },
      },
      colors: {
        enumerable: true,
        get() {
          reads.colors++
          return colors
        },
      },
    })

    expect(resolveStyleStack(inline)).toMatchObject({
      font: 'Inter',
      passes: 1,
      colors: { accent: '#ff0000' },
    })
    expect(reads).toEqual({ font: 1, passes: 1, colors: 1, accent: 1 })
  })

  test('keeps registration and inline admission mutation-atomic against accessors', () => {
    const nestedId = 'palette:test/reentrant-style'
    const invalidOuter = { stroke: 'invalid' } as unknown as Parameters<typeof registerStyle>[0]
    Object.defineProperty(invalidOuter, 'name', {
      enumerable: true,
      get() {
        registerStyle({ name: nestedId, colors: { bg: '#fff' } })
        return 'look:test/reentrant-outer'
      },
    })
    expect(() => registerStyle(invalidOuter))
      .toThrow(/Style registry mutation is forbidden while a Style input is undergoing admission/)
    expect(getStyle('look:test/reentrant-outer')).toBeUndefined()
    expect(getStyle(nestedId)).toBeUndefined()

    const optionsOuterId = 'look:test/reentrant-options'
    const options = {} as Parameters<typeof registerStyle>[1]
    Object.defineProperty(options, 'version', {
      enumerable: true,
      get() {
        registerStyle({ name: nestedId, colors: { bg: '#fff' } })
        return '1.0.0'
      },
    })
    expect(() => registerStyle({ name: optionsOuterId, stroke: 'jittered' }, options))
      .toThrow(/Style registry mutation is forbidden while a Style input is undergoing admission/)
    expect(getStyle(optionsOuterId)).toBeUndefined()
    expect(getStyle(nestedId)).toBeUndefined()

    const stableId = 'look:test/reentrant-disposer'
    const disposeStable = registerStyle({ name: stableId, stroke: 'jittered' })
    try {
      const inline = {} as Parameters<typeof resolveStyleStack>[0]
      Object.defineProperty(inline, 'font', {
        enumerable: true,
        get() {
          disposeStable()
          return 'Inter'
        },
      })
      expect(() => resolveStyleStack(inline))
        .toThrow(/Style registry mutation is forbidden while a Style input is undergoing admission/)
      expect(getStyle(stableId)).toBeDefined()
    } finally {
      disposeStable()
    }
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
  test('first-party backend implementations are inert and have one enrollment authority', () => {
    for (const file of ['rough-backend.ts', 'hybrid-backend.ts']) {
      const source = readFileSync(join(import.meta.dir, '..', 'scene', file), 'utf8')
      expect({ file, selfRegisters: source.includes('registerBuiltInBackend(') })
        .toEqual({ file, selfRegisters: false })
    }
    const enrollment = readFileSync(join(import.meta.dir, '..', 'scene', 'builtin-backends.ts'), 'utf8')
    expect(enrollment).toContain('DefaultBackend')
    expect(enrollment).toContain('RoughBackend')
    expect(enrollment).toContain('HybridBackend')
    expect(enrollment).toContain('for (const backend of BUILTIN_BACKENDS) registerBuiltInBackend(backend)')
  })

  test('stores canonical descriptors while retaining built-in short IDs', () => {
    expect(getBackend('default')).toBe(DefaultBackend)
    expect(getBackend('backend:default')).toBe(DefaultBackend)
    expect(knownBackendDescriptors().map(entry => entry.identity.id))
      .toEqual(['backend:default', 'backend:rough', 'backend:hybrid'])
    const descriptor = knownBackendDescriptors().find(entry => entry.identity.id === 'backend:default')!
    expect(descriptor.inputName).toBe('default')
    expect(descriptor.identity.provenance.owner).toBe('agentic-mermaid')
    expect(descriptor.conformance).toMatchObject({
      backendId: 'backend:default',
      directOutputs: ['svg'],
      passed: true,
      claims: expect.arrayContaining([expect.objectContaining({ status: 'passed' })]),
    })
    expect(knownBackendDescriptors().every(entry => entry.conformance.passed)).toBe(true)
    expect(runBackendConformance(DefaultBackend, 'backend:default').passed).toBe(true)
  })

  test('rejects unqualified registrations and registered-ID replacement', () => {
    expect(() => registerBackend({ ...DefaultBackend, id: 'probe' }, BACKEND_REGISTRATION_OPTIONS))
      .toThrow(/must use the "backend:" namespace/)
    expect(() => registerBackend(
      { ...DefaultBackend, id: 'backend:default' },
      {
        compatibility: BACKEND_COMPATIBILITY,
        provenance: { owner: 'collision-probe', source: 'test' },
      },
    )).toThrow(ExtensionCollisionError)
    expect(getBackend('default')).toBe(DefaultBackend)
    let incompatibleWitnessCalls = 0
    expect(() => registerBackendFromJs({
      ...DefaultBackend,
      id: 'backend:test/incompatible-scene',
      capabilities: DefaultBackend.capabilities.map(claim => ({
        ...claim,
        target: 'backend:test/incompatible-scene',
      })),
      drawNode(node, context) {
        incompatibleWitnessCalls++
        return DefaultBackend.drawNode(node, context)
      },
      render(document, context) {
        incompatibleWitnessCalls++
        return DefaultBackend.render(document, context)
      },
    }, { compatibility: { core: '^0.1.1', scene: '^99.0.0' } }))
      .toThrow(/scene.*\^99\.0\.0.*host version 1\.0\.0/i)
    expect(incompatibleWitnessCalls).toBe(0)
  })

  test('requires an explicit Scene range before backend conformance executes', () => {
    const id = 'backend:test/missing-scene-range'
    let witnessCalls = 0
    expect(() => registerBackendFromJs({
      ...DefaultBackend,
      id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      drawNode(node, context) {
        witnessCalls++
        return DefaultBackend.drawNode(node, context)
      },
      render(document, context) {
        witnessCalls++
        return DefaultBackend.render(document, context)
      },
    }, { compatibility: { core: '^0.1.1' } }))
      .toThrow(/must declare an explicit compatible "scene" range/i)
    expect(witnessCalls).toBe(0)
    expect(getBackend(id)).toBeUndefined()
  })

  test('requires explicit core and Scene ranges before backend conformance executes', () => {
    let witnessCalls = 0
    const candidate = (id: string) => ({
      ...DefaultBackend,
      id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      drawNode(node: Parameters<typeof DefaultBackend.drawNode>[0], context: Parameters<typeof DefaultBackend.drawNode>[1]) {
        witnessCalls++
        return DefaultBackend.drawNode(node, context)
      },
      render(document: Parameters<typeof DefaultBackend.render>[0], context: Parameters<typeof DefaultBackend.render>[1]) {
        witnessCalls++
        return DefaultBackend.render(document, context)
      },
    })
    expect(() => registerBackendFromJs(candidate('backend:test/no-registration-options')))
      .toThrow(/options with explicit core and Scene compatibility ranges are required/i)
    expect(() => registerBackendFromJs(
      candidate('backend:test/missing-core-range'),
      { compatibility: { scene: '^1.0.0' } },
    )).toThrow(/must declare an explicit compatible "core" range/i)
    expect(witnessCalls).toBe(0)
  })

  test('rejects missing, empty, and mis-targeted backend capability claims', () => {
    expect(() => registerBackend({
      ...DefaultBackend,
      id: 'backend:no-claims',
      capabilities: undefined,
    } as unknown as typeof DefaultBackend, BACKEND_REGISTRATION_OPTIONS)).toThrow(/must declare capability claims/)
    expect(() => registerBackend({
      ...DefaultBackend,
      id: 'backend:empty-claims',
      capabilities: [],
    }, BACKEND_REGISTRATION_OPTIONS)).toThrow(/must declare capability claims/)
    expect(() => registerBackend({
      ...DefaultBackend,
      id: 'backend:wrong-target',
    }, BACKEND_REGISTRATION_OPTIONS)).toThrow(/capability target must be "backend:wrong-target"/)
    const unevidencedId = 'backend:unevidenced'
    expect(() => registerBackend({
      ...DefaultBackend,
      id: unevidencedId,
      capabilities: DefaultBackend.capabilities.map((claim, index) => ({
        ...claim,
        target: unevidencedId,
        ...(index === 0 ? { evidence: undefined } : {}),
      })),
    }, BACKEND_REGISTRATION_OPTIONS)).toThrow(/must declare evidence/)
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
    }, BACKEND_REGISTRATION_OPTIONS)).toThrow(/essential document\/identity\/serialize capability/)
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
    ), BACKEND_REGISTRATION_OPTIONS)).toThrow(/failed registration SVG conformance:.*document-semantics/)

    let call = 0
    expect(() => registerBackend(backend(
      'backend:test/nondeterministic',
      (doc, context) => DefaultBackend.render(doc, context)
        .replace('<svg ', `<svg data-conformance-call="${++call}" `),
    ), BACKEND_REGISTRATION_OPTIONS)).toThrow(/failed registration SVG conformance:.*document-determinism/)

    expect(() => registerBackend(backend(
      'backend:test/unsafe',
      (doc, context) => DefaultBackend.render(doc, context)
        .replace('</svg>', '<script>alert(1)</script></svg>'),
    ), BACKEND_REGISTRATION_OPTIONS)).toThrow(/failed registration SVG conformance:.*output-security/)

    const oversized = `<svg>${'x'.repeat(SCENE_VALIDATION_LIMITS.maxFinalSvgBytes)}</svg>`
    expect(() => registerBackend(backend(
      'backend:test/oversized-svg',
      () => oversized,
    ), BACKEND_REGISTRATION_OPTIONS)).toThrow(/final SVG limit/)
  })

  test('keeps backend registration mutation-atomic during executable conformance', () => {
    const nestedId = 'backend:test/reentrant-nested'
    const outerId = 'backend:test/reentrant-outer'
    const nested = {
      ...DefaultBackend,
      id: nestedId,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: nestedId })),
    }
    const observedIds: string[][] = []
    const outer = {
      ...DefaultBackend,
      id: outerId,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: outerId })),
      render(document: Parameters<typeof DefaultBackend.render>[0], context: Parameters<typeof DefaultBackend.render>[1]) {
        observedIds.push(knownBackendDescriptors().map(descriptor => descriptor.identity.id))
        registerBackend(nested, BACKEND_REGISTRATION_OPTIONS)
        return DefaultBackend.render(document, context)
      },
    }
    expect(() => registerBackend(outer, BACKEND_REGISTRATION_OPTIONS))
      .toThrow(/registry mutation is forbidden while candidate/)
    expect(getBackend(outerId)).toBeUndefined()
    expect(getBackend(nestedId)).toBeUndefined()
    expect(observedIds.length).toBeGreaterThan(0)
    expect(observedIds.every(ids => !ids.includes(outerId) && !ids.includes(nestedId))).toBe(true)

    const stableId = 'backend:test/stable-during-conformance'
    const stable = {
      ...DefaultBackend,
      id: stableId,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: stableId })),
    }
    const unregisterStable = registerBackend(stable, BACKEND_REGISTRATION_OPTIONS)
    try {
      const removerId = 'backend:test/reentrant-remover'
      expect(() => registerBackend({
        ...DefaultBackend,
        id: removerId,
        capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: removerId })),
        render(document, context) {
          unregisterStable()
          return DefaultBackend.render(document, context)
        },
      }, BACKEND_REGISTRATION_OPTIONS)).toThrow(/registry mutation is forbidden while candidate/)
      expect(getBackend(stableId)).toBeDefined()
      expect(getBackend(removerId)).toBeUndefined()
    } finally {
      unregisterStable()
    }
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
      compatibility: BACKEND_COMPATIBILITY,
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
      compatibility: BACKEND_COMPATIBILITY,
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
      expect(descriptor.backend.capabilities).toHaveLength(capabilityCount)

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

  test('captures accessor-backed registration fields exactly once before validation and conformance', () => {
    const id = 'backend:test/accessor-snapshot'
    const capabilities = DefaultBackend.capabilities.map(claim => ({ ...claim, target: id }))
    const reads = { id: 0, capabilities: 0, claimTarget: 0, drawNode: 0, render: 0 }
    Object.defineProperty(capabilities[0]!, 'target', {
      enumerable: true,
      get() {
        reads.claimTarget++
        return reads.claimTarget === 1 ? id : 'backend:test/poisoned-target'
      },
    })
    const backend = {} as typeof DefaultBackend
    Object.defineProperties(backend, {
      id: {
        enumerable: true,
        get() {
          reads.id++
          return reads.id === 1 ? id : 'backend:test/poisoned-id'
        },
      },
      capabilities: {
        enumerable: true,
        get() {
          reads.capabilities++
          return reads.capabilities === 1 ? capabilities : []
        },
      },
      drawNode: {
        enumerable: true,
        get() {
          reads.drawNode++
          return reads.drawNode === 1
            ? DefaultBackend.drawNode
            : () => '<g data-poisoned-draw="true" />'
        },
      },
      render: {
        enumerable: true,
        get() {
          reads.render++
          return reads.render === 1
            ? DefaultBackend.render
            : () => '<svg data-poisoned-render="true" />'
        },
      },
    })

    const unregister = registerBackend(backend, BACKEND_REGISTRATION_OPTIONS)
    try {
      const descriptor = knownBackendDescriptors().find(entry => entry.identity.id === id)!
      expect(reads).toEqual({ id: 1, capabilities: 1, claimTarget: 1, drawNode: 1, render: 1 })
      expect(descriptor.backend.id).toBe(id)
      expect(descriptor.backend.capabilities).toHaveLength(capabilities.length)
      expect(descriptor.conformance.passed).toBe(true)
    } finally {
      unregister()
    }
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
    const unregisterFirst = registerBackend(backend('first'), BACKEND_REGISTRATION_OPTIONS)
    unregisterFirst()
    const unregisterSecond = registerBackend(backend('second'), BACKEND_REGISTRATION_OPTIONS)
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
