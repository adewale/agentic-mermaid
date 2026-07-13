import { describe, expect, test } from 'bun:test'

import {
  getFamily,
  layoutMermaid,
  layoutMermaidWithReceipt,
  parseRegisteredMermaid,
  registerFamily,
  verifyMermaid,
  type ExternalFamilyId,
  type FamilyDescriptor,
} from '../agent/index.ts'
import { ok, toFinite } from '../agent/types.ts'
import { createExtensionIdentity } from '../shared/extension-identity.ts'

const EVIDENCE = 'src/__tests__/extension-family-public-api.test.ts'

function extensionDescriptor(localId: string, header: string): FamilyDescriptor {
  const id = `family:test/${localId}` as ExternalFamilyId
  return {
    contractVersion: 1,
    identity: createExtensionIdentity({
      id,
      kind: 'family',
      version: '1.0.0',
      compatibility: { core: '^0.1.1' },
      provenance: { owner: 'extension-public-api-test', source: 'test' },
    }),
    id,
    label: `Extension ${localId}`,
    headers: [header],
    aliases: [],
    maturity: 'experimental',
    collisionPriority: 0,
    detect: line => line === header.toLowerCase(),
    semanticRoles: [],
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
  test('accepts the open ParsedDiagram envelope and parses receipt-aware layout strings through the registry', () => {
    let verifyCalls = 0
    const descriptor: FamilyDescriptor = {
      ...extensionDescriptor('reachable', 'reachableDiagram'),
      verify: () => { verifyCalls++; return [] },
    }
    const unregister = registerFamily(descriptor)
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

  test('isolates verify-hook and layout-hook failures instead of returning a clean 0x0 result', () => {
    const verifyFailure: FamilyDescriptor = {
      ...extensionDescriptor('verify-failure', 'verifyFailureDiagram'),
      verify: () => { throw new Error('verify exploded') },
    }
    const layoutFailure: FamilyDescriptor = {
      ...extensionDescriptor('layout-failure', 'layoutFailureDiagram'),
      layout: () => { throw new Error('layout exploded') },
    }
    const unregisterVerify = registerFamily(verifyFailure)
    const unregisterLayout = registerFamily(layoutFailure)
    try {
      const verifyResult = verifyMermaid('verifyFailureDiagram\n  payload')
      expect(verifyResult.ok).toBe(false)
      expect(verifyResult.warnings).toContainEqual(expect.objectContaining({
        code: 'RENDER_FAILED',
        reason: expect.stringMatching(/verify hook failed: verify exploded/),
      }))

      const parsed = parseRegisteredMermaid('layoutFailureDiagram\n  payload')
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      expect(() => layoutMermaid(parsed.value)).toThrow(/layout hook failed: layout exploded/)
      expect(() => layoutMermaidWithReceipt('layoutFailureDiagram\n  payload'))
        .toThrow(/layout hook failed: layout exploded/)
      const layoutResult = verifyMermaid(parsed.value)
      expect(layoutResult.ok).toBe(false)
      expect(layoutResult.warnings).toContainEqual(expect.objectContaining({
        code: 'RENDER_FAILED',
        reason: expect.stringMatching(/layout hook failed: layout exploded/),
      }))
      expect(layoutResult.layout).toMatchObject({ kind: layoutFailure.id, bounds: { w: 0, h: 0 } })
    } finally {
      unregisterLayout()
      unregisterVerify()
    }
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
