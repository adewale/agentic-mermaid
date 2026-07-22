import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  getFamily,
  detectRegisteredFamilyFromFirstLine,
  layoutMermaid,
  layoutMermaidWithReceipt,
  parseRegisteredMermaid,
  registerFamily,
  renderMermaidSVG,
  serializeMermaid,
  SCENE_VALIDATION_LIMITS,
  verifyMermaid,
  type ExternalFamilyId,
  type FamilyDescriptor,
} from '../agent/index.ts'
import { ok, toFinite } from '../agent/types.ts'
import { createExtensionIdentity } from '../shared/extension-identity.ts'
import { buildCapabilities, runBatchLine, runCli } from '../cli/index.ts'
import { createTracingMermaid } from '../mcp/facade.ts'
import { SDK_DECLARATION } from '../mcp/sdk-decl.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'

const EVIDENCE = 'src/__tests__/extension-family-public-api.test.ts'

function extensionDescriptor(localId: string, header: string): FamilyDescriptor {
  const id = `family:test/${localId}` as ExternalFamilyId
  return {
    contractVersion: 2,
    identity: createExtensionIdentity({
      id,
      kind: 'family',
      version: '1.0.0',
      compatibility: { core: '^0.1.1' },
      provenance: { owner: 'extension-public-api-test', source: 'test' },
    }),
    id,
    label: `Extension ${localId}`,
    example: `${header}\n  example payload`,
    headers: [header],
    aliases: [],
    maturity: 'experimental',
    collisionPriority: 0,
    detect: line => line === header.toLowerCase(),
    semanticRoles: [],
    semanticChannels: [],
    scenePrimitiveEvidence: [],
    capabilityEvidence: [
      { capability: 'detection', state: 'native', evidence: [EVIDENCE] },
      { capability: 'source-preservation', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'parse', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'serialize', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'mutation', state: 'diagnosed', evidence: [EVIDENCE] },
      { capability: 'verify', state: 'native', evidence: [EVIDENCE] },
      { capability: 'layout', state: 'native', evidence: [EVIDENCE] },
      { capability: 'scene', state: 'absent', evidence: [EVIDENCE] },
      { capability: 'svg', state: 'native', evidence: [EVIDENCE] },
      { capability: 'terminal', state: 'absent', evidence: [EVIDENCE] },
    ],
    verify: () => [],
    layout: () => ({ width: 120, height: 40 }),
    projectPositioned: () => ({
      version: 1,
      nodes: [{
        id: 'extension-node',
        x: toFinite(8),
        y: toFinite(8),
        w: toFinite(104),
        h: toFinite(24),
        shape: 'rectangle',
        label: 'Extension',
      }],
      edges: [],
      groups: [],
      bounds: { w: toFinite(120), h: toFinite(40) },
    }),
    renderSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><text x="8" y="24">Extension</text></svg>',
  }
}

describe('registered family public layout and verify APIs', () => {
  test('keeps canonical, preserved, and upstream family identities under one authority', () => {
    const descriptorWithId = (id: ExternalFamilyId, header: string): FamilyDescriptor => {
      const base = extensionDescriptor(`reserved-${header.toLowerCase()}`, header)
      return {
        ...base,
        id,
        identity: createExtensionIdentity({
          id,
          kind: 'family',
          version: '1.0.0',
          compatibility: { core: '^0.1.1' },
          provenance: { owner: 'extension-public-api-test', source: 'test' },
        }),
      }
    }
    for (const [id, header] of [
      ['family:flowchart', 'reservedFlowchart'],
      ['family:unknown', 'reservedUnknown'],
      ['family:upstream/sankey', 'reservedUpstream'],
    ] as const) {
      expect(() => registerFamily(descriptorWithId(id, header))).toThrow(/reserved by the core family\/preservation envelope/)
    }

    const alias = extensionDescriptor('upstream-alias', 'upstreamAliasDiagram')
    expect(() => registerFamily({
      ...alias,
      aliases: ['sankey'],
      detect: line => line === 'upstreamaliasdiagram' || line === 'sankey',
    })).toThrow(/alias "sankey" is an upstream public header/)

    const hiddenStrict = extensionDescriptor('hidden-strict', 'hiddenStrictDiagram')
    const unregisterStrict = registerFamily({
      ...hiddenStrict,
      detect: line => line === 'hiddenstrictdiagram' || line === 'sankey',
    })
    expect(detectRegisteredFamilyFromFirstLine('sankey')).toBeNull()
    unregisterStrict()

    const hiddenLoose = extensionDescriptor('hidden-loose', 'hiddenLooseDiagram')
    const unregisterLoose = registerFamily({
      ...hiddenLoose,
      detectLoose: line => line === 'hiddenloosediagram' || line === 'requirementdiagram',
    })
    expect(detectRegisteredFamilyFromFirstLine('requirementDiagram', 'loose')).toBeNull()
    unregisterLoose()

    const multiFamily = extensionDescriptor('multi-upstream', 'sankey')
    expect(() => registerFamily({
      ...multiFamily,
      headers: ['sankey', 'requirementDiagram'],
      detect: line => line === 'sankey' || line === 'requirementdiagram',
    })).toThrow(/cannot claim upstream headers from multiple Mermaid families/)
  })

  test('uses declared headers as the routing prefilter for broad or adversarial detectors', () => {
    const base = extensionDescriptor('routing-prefilter', 'auditDiagram')
    let calls = 0
    const unregister = registerFamily({
      ...base,
      collisionPriority: 1_000,
      detect: line => {
        calls++
        return line.startsWith('auditdiagram') || line === 'flowchart lr'
      },
    })
    try {
      expect(detectRegisteredFamilyFromFirstLine('auditDiagram payload')).toBe(base.id)
      const ownCalls = calls
      expect(detectRegisteredFamilyFromFirstLine('auditDiagramFuture')).toBeNull()
      expect(detectRegisteredFamilyFromFirstLine('flowchart LR')).toBe('flowchart')
      expect(calls).toBe(ownCalls)
      expect(parseRegisteredMermaid('auditDiagramFuture\n  payload'))
        .toMatchObject({ ok: true, value: { body: { kind: 'preserved' } } })
    } finally {
      unregister()
    }
  })

  test('keeps extension source core-owned when a parse hook returns a lossy source field', () => {
    const base = extensionDescriptor('lossy-parse', 'lossyParseDiagram')
    const descriptor: FamilyDescriptor = {
      ...base,
      capabilityEvidence: base.capabilityEvidence.map(claim =>
        claim.capability === 'source-preservation' || claim.capability === 'parse'
          ? { ...claim, state: 'native' }
          : claim),
      parse: () => ok({
        kind: 'extension',
        family: base.id as ExternalFamilyId,
        source: '',
        data: { parsed: true },
      }),
    }
    const source = 'lossyParseDiagram\n  must survive'
    const unregister = registerFamily(descriptor)
    try {
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok || parsed.value.body.kind !== 'extension') return
      expect(parsed.value.body.source).toBe(source)
      expect(parsed.value.body.data).toEqual({ parsed: true })
      expect(serializeMermaid(parsed.value)).toBe(`${source}\n`)
    } finally {
      unregister()
    }
  })

  test('gives newly registered families directive-free grammar and shared accessibility metadata', () => {
    const base = extensionDescriptor('shared-accessibility', 'sharedAccessibilityDiagram')
    let observed: { lines: readonly string[]; accessibility: unknown } | undefined
    const descriptor: FamilyDescriptor = {
      ...base,
      capabilityEvidence: base.capabilityEvidence.map(claim =>
        claim.capability === 'source-preservation' || claim.capability === 'parse' || claim.capability === 'serialize'
          ? { ...claim, state: 'native' }
          : claim),
      parse: context => {
        observed = { lines: [...context.lines], accessibility: context.meta.accessibility }
        return ok({
          kind: 'extension',
          family: base.id as ExternalFamilyId,
          source: context.opaqueSource,
          data: { lines: [...context.lines] },
        })
      },
      serialize: body => `${(body.kind === 'extension' ? (body.data as { lines: string[] }).lines : []).join('\n')}\n`,
    }
    const unregister = registerFamily(descriptor)
    try {
      observed = undefined
      const parsed = parseRegisteredMermaid(`sharedAccessibilityDiagram
  accTitle Shared title
  accDescr {
    Shared description
  }
  family payload`)
      expect(parsed.ok).toBe(true)
      expect(observed as { lines: readonly string[]; accessibility: unknown } | undefined).toEqual({
        lines: ['sharedAccessibilityDiagram', 'family payload'],
        accessibility: { title: 'Shared title', descr: 'Shared description' },
      })
      if (!parsed.ok) return
      const serialized = serializeMermaid(parsed.value)
      expect(serialized).toBe(`sharedAccessibilityDiagram
  accTitle: Shared title
  accDescr: Shared description
family payload
`)
      const reparsed = parseRegisteredMermaid(serialized)
      expect(reparsed.ok).toBe(true)
      if (reparsed.ok) expect(serializeMermaid(reparsed.value)).toBe(serialized)
    } finally {
      unregister()
    }
  })

  test('publishes an admitted, deeply immutable snapshot of extension parse data', () => {
    const base = extensionDescriptor('parse-data-snapshot', 'parseDataSnapshotDiagram')
    const owned = {
      nested: { value: 1 },
      entries: [{ label: 'first' }],
    }
    const descriptor: FamilyDescriptor = {
      ...base,
      capabilityEvidence: base.capabilityEvidence.map(claim =>
        claim.capability === 'source-preservation' || claim.capability === 'parse'
          ? { ...claim, state: 'native' }
          : claim),
      parse: context => ok({
        kind: 'extension',
        family: base.id as ExternalFamilyId,
        source: context.opaqueSource,
        data: owned,
      }),
    }
    const unregister = registerFamily(descriptor)
    try {
      const parsed = parseRegisteredMermaid('parseDataSnapshotDiagram\n  payload')
      expect(parsed.ok).toBe(true)
      if (!parsed.ok || parsed.value.body.kind !== 'extension') return
      const data = parsed.value.body.data as typeof owned
      expect(data).not.toBe(owned)
      expect(Object.isFrozen(parsed.value.body)).toBe(true)
      expect(Object.isFrozen(data)).toBe(true)
      expect(Object.isFrozen(data.nested)).toBe(true)
      expect(Object.isFrozen(data.entries)).toBe(true)
      expect(Object.isFrozen(data.entries[0])).toBe(true)
      owned.nested.value = 99
      owned.entries[0]!.label = 'mutated'
      expect(data).toEqual({ nested: { value: 1 }, entries: [{ label: 'first' }] })
      expect(() => { data.nested.value = 2 }).toThrow()
      expect(JSON.parse(JSON.stringify(parsed.value.body))).toEqual({
        kind: 'extension',
        family: base.id,
        source: 'parseDataSnapshotDiagram\n  payload',
        data: { nested: { value: 1 }, entries: [{ label: 'first' }] },
      })
    } finally {
      unregister()
    }
  })

  test('returns a descriptor-contract error for non-JSON parse data on non-example sources', () => {
    const base = extensionDescriptor('parse-data-admission', 'parseDataAdmissionDiagram')
    const descriptor: FamilyDescriptor = {
      ...base,
      capabilityEvidence: base.capabilityEvidence.map(claim =>
        claim.capability === 'source-preservation' || claim.capability === 'parse'
          ? { ...claim, state: 'native' }
          : claim),
      parse: context => {
        let data: unknown = { safe: true }
        if (context.opaqueSource.includes('cycle')) {
          const cyclic: { self?: unknown } = {}
          cyclic.self = cyclic
          data = cyclic
        } else if (context.opaqueSource.includes('non-plain')) {
          data = new Date(0)
        }
        return ok({
          kind: 'extension',
          family: base.id as ExternalFamilyId,
          source: context.opaqueSource,
          data,
        })
      },
    }
    const unregister = registerFamily(descriptor)
    try {
      for (const [payload, problem] of [['cycle', /acyclic/i], ['non-plain', /plain JSON object/i]] as const) {
        const parsed = parseRegisteredMermaid(`parseDataAdmissionDiagram\n  ${payload}`)
        expect(parsed.ok).toBe(false)
        if (parsed.ok) continue
        expect(parsed.error).toContainEqual(expect.objectContaining({
          code: 'FAMILY_DESCRIPTOR_CONTRACT',
          message: expect.stringMatching(problem),
        }))
      }
    } finally {
      unregister()
    }
  })

  test('does not pass parsed extension data into a replacement descriptor version', () => {
    const source = 'descriptorUpgradeDiagram\n  payload'
    const v1Base = extensionDescriptor('descriptor-upgrade', 'descriptorUpgradeDiagram')
    const v1: FamilyDescriptor = {
      ...v1Base,
      capabilityEvidence: v1Base.capabilityEvidence.map(claim =>
        claim.capability === 'source-preservation' || claim.capability === 'parse' || claim.capability === 'serialize'
          ? { ...claim, state: 'native' }
          : claim),
      parse: context => ok({
        kind: 'extension',
        family: v1Base.id as ExternalFamilyId,
        source: context.opaqueSource,
        data: { version: 1 },
      }),
      serialize: body => body.kind === 'extension' ? body.source : '',
    }
    const unregisterV1 = registerFamily(v1)
    const parsed = parseRegisteredMermaid(source)
    unregisterV1()
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    let v2SerializerCalls = 0
    const v2Base = extensionDescriptor('descriptor-upgrade', 'descriptorUpgradeDiagram')
    const v2: FamilyDescriptor = {
      ...v2Base,
      identity: createExtensionIdentity({
        id: v2Base.id,
        kind: 'family',
        version: '2.0.0',
        compatibility: { core: '^0.1.1' },
        provenance: { owner: 'extension-public-api-test', source: 'test' },
      }),
      capabilityEvidence: v2Base.capabilityEvidence.map(claim =>
        claim.capability === 'source-preservation' || claim.capability === 'parse' || claim.capability === 'serialize'
          ? { ...claim, state: 'native' }
          : claim),
      parse: context => ok({
        kind: 'extension',
        family: v2Base.id as ExternalFamilyId,
        source: context.opaqueSource,
        data: { version: 2 },
      }),
      serialize: body => {
        v2SerializerCalls++
        if (body.kind !== 'extension' || (body.data as { version?: number } | undefined)?.version !== 2) {
          throw new Error('v2 serializer received pre-upgrade body')
        }
        return body.source
      },
    }
    const unregisterV2 = registerFamily(v2)
    v2SerializerCalls = 0
    try {
      expect(serializeMermaid(parsed.value)).toBe(`${source}\n`)
      expect(v2SerializerCalls).toBe(0)
      // Rendering explicitly reparses the core-owned source under v2 rather
      // than invoking v2's serializer on v1-owned data.
      expect(renderMermaidSVG(parsed.value)).toContain('>Extension</text>')
      expect(v2SerializerCalls).toBe(0)
    } finally {
      unregisterV2()
    }
  })

  test('reparses source before a replacement descriptor verifies a stale parsed body', () => {
    const source = 'verifyUpgradeDiagram\n  payload'
    const v1Base = extensionDescriptor('verify-upgrade', 'verifyUpgradeDiagram')
    const v1: FamilyDescriptor = {
      ...v1Base,
      capabilityEvidence: v1Base.capabilityEvidence.map(claim =>
        claim.capability === 'source-preservation' || claim.capability === 'parse'
          ? { ...claim, state: 'native' }
          : claim),
      parse: context => ok({
        kind: 'extension',
        family: v1Base.id as ExternalFamilyId,
        source: context.opaqueSource,
        data: { version: 1 },
      }),
    }
    const unregisterV1 = registerFamily(v1)
    const parsed = parseRegisteredMermaid(source)
    unregisterV1()
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    let verifyCalls = 0
    const v2Base = extensionDescriptor('verify-upgrade', 'verifyUpgradeDiagram')
    const v2: FamilyDescriptor = {
      ...v2Base,
      identity: createExtensionIdentity({
        id: v2Base.id,
        kind: 'family',
        version: '2.0.0',
        compatibility: { core: '^0.1.1' },
        provenance: { owner: 'extension-public-api-test', source: 'test' },
      }),
      capabilityEvidence: v2Base.capabilityEvidence.map(claim =>
        claim.capability === 'source-preservation' || claim.capability === 'parse'
          ? { ...claim, state: 'native' }
          : claim),
      parse: context => ok({
        kind: 'extension',
        family: v2Base.id as ExternalFamilyId,
        source: context.opaqueSource,
        data: { version: 2 },
      }),
      verify: body => {
        verifyCalls++
        if (body.kind !== 'extension' || (body.data as { version?: number } | undefined)?.version !== 2) {
          throw new Error('v2 verifier received pre-upgrade body')
        }
        return []
      },
    }
    const unregisterV2 = registerFamily(v2)
    verifyCalls = 0
    try {
      const verified = verifyMermaid(parsed.value)
      expect(verified.warnings).not.toContainEqual(expect.objectContaining({
        code: 'RENDER_FAILED',
        reason: expect.stringContaining('pre-upgrade body'),
      }))
      expect(verified.ok).toBe(true)
      expect(verifyCalls).toBeGreaterThan(0)
    } finally {
      unregisterV2()
    }
  })

  test('captures the detected immutable descriptor even when detector code mutates the registry', () => {
    const base = extensionDescriptor('detector-snapshot', 'detectorSnapshotDiagram')
    let armed = false
    let unregister = () => {}
    const descriptor: FamilyDescriptor = {
      ...base,
      detect: line => {
        const matched = line === 'detectorsnapshotdiagram'
        if (matched && armed) unregister()
        return matched
      },
    }
    unregister = registerFamily(descriptor)
    armed = true
    try {
      expect(renderMermaidSVG('detectorSnapshotDiagram\n  payload')).toContain('>Extension</text>')
      expect(getFamily(descriptor.id)).toBeUndefined()
    } finally {
      unregister()
    }
  })

  test('rejects oversized family SVG before output transforms and security scanning', () => {
    const descriptor: FamilyDescriptor = {
      ...extensionDescriptor('svg-budget', 'svgBudgetDiagram'),
      renderSvg: () => `<svg xmlns="http://www.w3.org/2000/svg"><!--${'x'.repeat(SCENE_VALIDATION_LIMITS.maxFinalSvgBytes)}--></svg>`,
    }
    expect(() => registerFamily(descriptor)).toThrow(/failed executable registration conformance.*final SVG limit/i)
    expect(getFamily(descriptor.id)).toBeUndefined()
  })

  test('compact rendering rejects malformed split attributes at the final security gate', () => {
    const descriptor: FamilyDescriptor = {
      ...extensionDescriptor('compact-security', 'compactSecurityDiagram'),
      renderSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40">\n  <rect on\n load="alert(1)" width="10" height="10" />\n</svg>',
    }
    expect(() => registerFamily(descriptor)).toThrow(/failed executable registration conformance.*invalid SVG document envelope/i)
    expect(getFamily(descriptor.id)).toBeUndefined()
  })

  test('CLI, batch, and Code Mode expose the canonical registered parser', async () => {
    const descriptor: FamilyDescriptor = {
      ...extensionDescriptor('transport-parse', 'transportParseDiagram'),
      example: 'transportParseDiagram\n  example payload',
    }
    const source = 'transportParseDiagram\n  extension payload'
    const unregister = registerFamily(descriptor)
    const directory = mkdtempSync(join(tmpdir(), 'agentic-mermaid-open-parse-'))
    const path = join(directory, 'extension.mmd')
    writeFileSync(path, source)
    try {
      const sdk = createTracingMermaid()
      expect('parseMermaid' in sdk).toBe(false)
      const open = sdk.parseRegisteredMermaid(source)
      expect(open.ok).toBe(true)
      if (open.ok) {
        expect(open.value.kind).toBe(descriptor.id)
        expect(open.value.body.kind).toBe('extension')
        if (open.value.body.kind === 'extension') {
          expect(open.value.body.family).toBe(descriptor.id as ExternalFamilyId)
          expect(open.value.body.source).toBe(source)
        }
        expect(sdk.serializeMermaid(open.value)).toBe(`${source}\n`)
      }
      expect(buildCapabilities().families.find(row => row.id === descriptor.id)).toMatchObject({
        headers: descriptor.headers,
        example: descriptor.example,
      })

      const chunks: string[] = []
      const originalWrite = process.stdout.write
      process.stdout.write = ((chunk: unknown) => { chunks.push(String(chunk)); return true }) as typeof process.stdout.write
      try {
        expect(runCli(['parse', path])).toBe(0)
      } finally {
        process.stdout.write = originalWrite
      }
      expect(JSON.parse(chunks.join(''))).toMatchObject({
        kind: descriptor.id,
        body: { kind: 'extension', family: descriptor.id, source },
      })

      expect(runBatchLine(JSON.stringify({ op: 'parse', source }))).toMatchObject({
        ok: true,
        op: 'parse',
        data: { kind: descriptor.id, body: { kind: 'extension', family: descriptor.id, source } },
      })

      const executed = await executeInSandbox(`
        const parsed = mermaid.parseRegisteredMermaid(${JSON.stringify(source)})
        if (!parsed.ok) return parsed
        const verified = mermaid.verifyMermaid(parsed.value)
        if (!verified.ok) return verified
        return { kind: parsed.value.kind, source: mermaid.serializeMermaid(parsed.value) }
      `)
      expect(executed).toMatchObject({ ok: true, value: { kind: descriptor.id, source: `${source}\n` } })
      expect(SDK_DECLARATION).toContain('parseRegisteredMermaid(source: string): Result<ParsedDiagram')
    } finally {
      rmSync(directory, { recursive: true, force: true })
      unregister()
    }
  })

  test('accepts the open ParsedDiagram envelope and parses receipt-aware layout strings through the registry', () => {
    let verifyCalls = 0
    const descriptor: FamilyDescriptor = {
      ...extensionDescriptor('reachable', 'reachableDiagram'),
      verify: () => { verifyCalls++; return [] },
    }
    const unregister = registerFamily(descriptor)
    verifyCalls = 0
    try {
      const source = 'reachableDiagram\n  extension payload'
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return

      expect(layoutMermaid(parsed.value)).toMatchObject({
        kind: descriptor.id,
        nodes: [{ id: 'extension-node', label: 'Extension' }],
        bounds: { w: 120, h: 40 },
      })
      expect(layoutMermaidWithReceipt(source).layout).toMatchObject({
        kind: descriptor.id,
        nodes: [{ id: 'extension-node' }],
      })

      const verifiedFromSource = verifyMermaid(source)
      const verifiedFromParsed = verifyMermaid(parsed.value)
      expect(verifiedFromSource).toMatchObject({ ok: true, layout: { kind: descriptor.id } })
      expect(verifiedFromParsed).toMatchObject({ ok: true, layout: { kind: descriptor.id } })
      expect(verifyCalls).toBe(2)
    } finally {
      unregister()
    }
  })

  test('diagnoses partial layout hooks and rejects native layout or verify claims without the public projection tuple', () => {
    const base = extensionDescriptor('partial-projection', 'partialProjectionDiagram')
    const svgWithoutLayout: FamilyDescriptor = {
      ...base,
      layout: undefined,
      projectPositioned: undefined,
      capabilityEvidence: base.capabilityEvidence.map(claim => {
        if (claim.capability === 'verify') return { ...claim, state: 'diagnosed' }
        if (claim.capability === 'layout' || claim.capability === 'svg') return { ...claim, state: 'absent' }
        return claim
      }),
    }
    expect(() => registerFamily(svgWithoutLayout)).toThrow(/cannot render SVG without a layout hook/)

    const partial: FamilyDescriptor = {
      ...base,
      projectPositioned: undefined,
      capabilityEvidence: base.capabilityEvidence.map(claim =>
        claim.capability === 'verify' || claim.capability === 'layout'
          ? { ...claim, state: 'diagnosed' }
          : claim),
    }

    expect(() => registerFamily({
      ...partial,
      capabilityEvidence: partial.capabilityEvidence.map(claim =>
        claim.capability === 'verify' ? { ...claim, state: 'native' } : claim),
    })).toThrow(/capability "verify" claims "native" but its hooks require "diagnosed"/)
    expect(() => registerFamily({
      ...partial,
      capabilityEvidence: partial.capabilityEvidence.map(claim =>
        claim.capability === 'layout' ? { ...claim, state: 'native' } : claim),
    })).toThrow(/capability "layout" claims "native" but its hooks require "diagnosed"/)

    const unregister = registerFamily(partial)
    try {
      const source = 'partialProjectionDiagram\n  payload'
      expect(getFamily(partial.id)?.capabilityEvidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ capability: 'verify', state: 'diagnosed' }),
        expect.objectContaining({ capability: 'layout', state: 'diagnosed' }),
        expect.objectContaining({ capability: 'svg', state: 'native' }),
      ]))
      expect(renderMermaidSVG(source)).toContain('>Extension</text>')

      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      expect(() => layoutMermaid(parsed.value)).toThrow(/no public layout projection registered/i)
      expect(verifyMermaid(parsed.value)).toMatchObject({
        ok: false,
        warnings: expect.arrayContaining([expect.objectContaining({
          code: 'RENDER_FAILED',
          reason: expect.stringMatching(/no public layout projection registered/i),
        })]),
      })
    } finally {
      unregister()
    }
  })

  test('rejects throwing verify and layout hooks before they can advertise native support', () => {
    const verifyFailure: FamilyDescriptor = {
      ...extensionDescriptor('verify-failure', 'verifyFailureDiagram'),
      verify: () => { throw new Error('verify exploded') },
    }
    const layoutFailure: FamilyDescriptor = {
      ...extensionDescriptor('layout-failure', 'layoutFailureDiagram'),
      layout: () => { throw new Error('layout exploded') },
    }
    expect(() => registerFamily(verifyFailure)).toThrow(/verify exploded/)
    expect(() => registerFamily(layoutFailure)).toThrow(/layout exploded/)
    expect(getFamily(verifyFailure.id)).toBeUndefined()
    expect(getFamily(layoutFailure.id)).toBeUndefined()
  })

  test('reports unavailable layout/verify capabilities and keeps extension mutation diagnosed', () => {
    const base = extensionDescriptor('unavailable', 'unavailableDiagram')
    const unavailable: FamilyDescriptor = {
      ...base,
      verify: undefined,
      layout: undefined,
      projectPositioned: undefined,
      renderSvg: undefined,
      capabilityEvidence: base.capabilityEvidence.map(claim => {
        if (claim.capability === 'verify') return { ...claim, state: 'diagnosed' }
        if (claim.capability === 'layout' || claim.capability === 'svg') return { ...claim, state: 'absent' }
        return claim
      }),
    }
    const mutationBase = extensionDescriptor('mutation-diagnosed', 'mutationDiagnosedDiagram')
    const mutationDiagnosed: FamilyDescriptor = {
      ...mutationBase,
      mutate: body => ok(body),
    }
    const unregisterUnavailable = registerFamily(unavailable)
    const unregisterMutation = registerFamily(mutationDiagnosed)
    try {
      const parsed = parseRegisteredMermaid('unavailableDiagram\n  payload')
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      expect(() => layoutMermaid(parsed.value)).toThrow(/no public layout projection registered/i)
      const result = verifyMermaid(parsed.value)
      expect(result.ok).toBe(false)
      expect(result.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'RENDER_FAILED', reason: expect.stringMatching(/no verify hook registered/) }),
        expect.objectContaining({ code: 'RENDER_FAILED', reason: expect.stringMatching(/no public layout projection registered/) }),
      ]))
      expect(getFamily(mutationDiagnosed.id)?.capabilityEvidence.find(claim => claim.capability === 'mutation')?.state)
        .toBe('diagnosed')

      const nativeMutation: FamilyDescriptor = {
        ...extensionDescriptor('mutation-native-claim', 'mutationNativeClaimDiagram'),
        mutate: body => ok(body),
        capabilityEvidence: extensionDescriptor('mutation-native-claim', 'mutationNativeClaimDiagram').capabilityEvidence
          .map(claim => claim.capability === 'mutation' ? { ...claim, state: 'native' } : claim),
      }
      expect(() => registerFamily(nativeMutation)).toThrow(/mutation.*claims "native".*require "diagnosed"/)
    } finally {
      unregisterMutation()
      unregisterUnavailable()
    }
  })
})
