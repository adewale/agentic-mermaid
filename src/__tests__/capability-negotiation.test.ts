import { describe, expect, test } from 'bun:test'
import '../render-family-hooks.ts'
import {
  negotiateCapabilities,
  negotiateRenderCapabilities,
  semVerSatisfies,
  type CapabilityRequirement,
} from '../capability-negotiation.ts'
import { RenderCapabilityError, resolveRenderRequest, receiptOf } from '../render-contract.ts'
import { createExtensionIdentity } from '../shared/extension-identity.ts'
import { resolveStyleStack, STYLE_SPEC_FORMAT_VERSION, validateStyleSpec } from '../scene/style-registry.ts'
import {
  getFamily,
  registerFamily,
  replaceFamilyForTest,
  type FamilyDescriptor,
} from '../agent/families.ts'
import type { ExternalFamilyId } from '../agent/types.ts'
import { createMermaidRenderer, renderMermaidSVGWithReceipt } from '../index.ts'
import * as publicAgentApi from '../agent/index.ts'
import { DefaultBackend, knownBackendDescriptors, registerBackend } from '../scene/backend.ts'

const EVIDENCE = 'src/__tests__/capability-negotiation.test.ts'

function extensionDescriptor(
  localId: string,
  header: string,
  options: { readonly version?: string; readonly renderSvg?: boolean } = {},
): FamilyDescriptor {
  const id = `family:test/${localId}` as ExternalFamilyId
  const hasSvg = options.renderSvg ?? false
  return {
    contractVersion: 1,
    identity: createExtensionIdentity({
      id,
      kind: 'family',
      version: options.version ?? '1.0.0',
      compatibility: { core: 'family-descriptor@1' },
      provenance: { owner: 'capability-negotiation-test', source: 'test' },
    }),
    id,
    label: `Capability ${localId}`,
    headers: [header],
    aliases: [],
    maturity: 'experimental',
    collisionPriority: 0,
    detect: line => line === header.toLowerCase(),
    semanticRoles: [],
    capabilityEvidence: [
      { capability: 'detection', state: 'native', evidence: [EVIDENCE] },
      { capability: 'source-preservation', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'parse', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'serialize', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'mutation', state: 'diagnosed', evidence: [EVIDENCE] },
      { capability: 'verify', state: 'diagnosed', evidence: [EVIDENCE] },
      { capability: 'layout', state: 'native', evidence: [EVIDENCE] },
      { capability: 'scene', state: 'absent', evidence: [EVIDENCE] },
      { capability: 'svg', state: hasSvg ? 'native' : 'absent', evidence: [EVIDENCE] },
      { capability: 'terminal', state: 'absent', evidence: [EVIDENCE] },
    ],
    layout: () => ({ width: 120, height: 40 }),
    ...(hasSvg ? {
      renderSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"></svg>',
    } : {}),
  }
}

describe('versioned capability negotiation', () => {
  test('supports the documented deterministic semantic-version ranges', () => {
    expect(semVerSatisfies('1.4.2', '^1.2.0')).toBe(true)
    expect(semVerSatisfies('2.0.0', '^1.2.0')).toBe(false)
    expect(semVerSatisfies('0.3.9', '^0.3.1')).toBe(true)
    expect(semVerSatisfies('1.4.2', '~1.4.0')).toBe(true)
    expect(semVerSatisfies('1.5.0', '~1.4.0')).toBe(false)
    expect(semVerSatisfies('1.4.2', '1.x')).toBe(true)
    expect(semVerSatisfies('1.4.2-beta.1', '*')).toBe(false)
    expect(semVerSatisfies('1.4.2-beta.1', '1.4.2-beta.1')).toBe(true)
    expect(semVerSatisfies('1.4.2-beta.2', '1.4.2-beta.1')).toBe(false)
  })

  test('rejects malformed requirement levels and ranges at the negotiation boundary', () => {
    expect(() => negotiateCapabilities([], [{
      id: 'core:test', range: '^1.0.0', level: 'mandatory' as never,
    }])).toThrow(/invalid requirement level/i)
    expect(() => negotiateCapabilities([], [{
      id: 'core:test', range: 'eventually', level: 'required',
    }])).toThrow(/invalid semantic-version range/i)
    expect(() => negotiateCapabilities([], [{
      id: 'core:test', range: '^1.0.0-beta.1', level: 'required',
    }])).toThrow(/invalid semantic-version range/i)
  })

  test('greases unknown optional capabilities but rejects unknown required ones', () => {
    const grease: CapabilityRequirement = {
      id: 'grease:future-7', range: '^99.0.0', level: 'optional',
    }
    const optional = negotiateCapabilities(
      [{ id: 'core:test', version: '1.0.0' }],
      [{ id: 'core:test', range: '^1.0.0', level: 'required' }, grease],
    )
    expect(optional.accepted).toBe(true)
    expect(optional.resolutions[1]).toMatchObject({ status: 'unsupported', level: 'optional' })

    const required = negotiateCapabilities([], [{ ...grease, level: 'required' }])
    expect(required.accepted).toBe(false)
    expect(negotiateRenderCapabilities('future-output').accepted).toBe(false)
  })

  test('request receipts carry the exact frozen negotiation decision', () => {
    const request = resolveRenderRequest('flowchart TD\n  A --> B', {}, 'svg')
    const receipt = receiptOf(request)
    expect(receipt.capabilityDecision).toEqual(request.capabilityDecision)
    expect(receipt.capabilityDecision).toBeDefined()
    expect(receipt.executionDecision?.family).toEqual({ id: 'family:flowchart', version: '1.0.0' })
    const decision = receipt.capabilityDecision!
    expect(decision.accepted).toBe(true)
    expect(Object.isFrozen(decision.resolutions)).toBe(true)
    expect(decision.resolutions).toContainEqual({
      id: 'family:flowchart',
      range: '1.0.0',
      level: 'required',
      status: 'selected',
      version: '1.0.0',
    })
  })

  test('rejects an SVG-absent extension during resolution with structured tuple detail', () => {
    const descriptor = extensionDescriptor('no-svg', 'noSvgDiagram')
    const unregister = registerFamily(descriptor)
    try {
      let failure: unknown
      try {
        resolveRenderRequest('noSvgDiagram\n  payload', {}, 'svg')
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(RenderCapabilityError)
      const capabilityError = failure as RenderCapabilityError
      expect(capabilityError.code).toBe('UNSATISFIED_RENDER_CAPABILITIES')
      expect(capabilityError.output).toBe('svg')
      expect(capabilityError.family).toEqual({ id: descriptor.identity.id, version: '1.0.0' })
      expect(capabilityError.decision.accepted).toBe(false)
      expect(capabilityError.decision.resolutions).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'operation:render-svg', status: 'unsupported' }),
        expect.objectContaining({ id: 'output:svg', status: 'unsupported' }),
      ]))
    } finally {
      unregister()
    }
  })

  test('an exact prerelease family identity self-negotiates without broad prerelease ranges', () => {
    const descriptor = extensionDescriptor('prerelease', 'prereleaseDiagram', {
      version: '2.0.0-beta.1',
      renderSvg: true,
    })
    expect(() => registerFamily({
      ...descriptor,
      lowerScene: () => { throw new Error('unreachable') },
    })).toThrow(/one graphical waist.*extension fallback/i)
    const unregister = registerFamily(descriptor)
    try {
      const request = resolveRenderRequest('prereleaseDiagram\n  payload', {}, 'svg')
      expect(request.capabilityDecision.accepted).toBe(true)
      expect(request.capabilityDecision.resolutions).toContainEqual({
        id: descriptor.identity.id,
        range: '2.0.0-beta.1',
        level: 'required',
        status: 'selected',
        version: '2.0.0-beta.1',
      })
      const rendered = renderMermaidSVGWithReceipt('prereleaseDiagram\n  payload')
      expect(rendered.svg).toContain('<svg')
      expect(rendered.receipt.executionDecision?.backend).toEqual({ mode: 'family-svg' })
    } finally {
      unregister()
    }
  })

  test('config callbacks cannot replace the negotiated family implementation', () => {
    const original = getFamily('flowchart')!
    let restoreReplacement: (() => void) | undefined
    try {
      const rendered = renderMermaidSVGWithReceipt('flowchart LR\n  A --> B', {
        mermaidConfig: { flowchart: { callbackReplacementProbe: true } },
        onConfigDiagnostic() {
          if (restoreReplacement) return
          restoreReplacement = replaceFamilyForTest('flowchart', {
            ...original,
            identity: createExtensionIdentity({
              id: original.identity.id,
              kind: 'family',
              version: '2.0.0',
              compatibility: original.identity.compatibility,
              provenance: original.identity.provenance,
            }),
            layout: () => { throw new Error('replacement layout must not execute') },
          })
        },
      })
      expect(restoreReplacement).toBeDefined()
      expect(getFamily('flowchart')?.identity.version).toBe('2.0.0')
      expect(rendered.svg).toContain('<svg')
      expect(rendered.receipt.executionDecision?.family).toEqual({
        id: original.identity.id,
        version: original.identity.version,
      })
      expect(rendered.receipt.capabilityDecision?.resolutions).toContainEqual({
        id: original.identity.id,
        range: original.identity.version,
        level: 'required',
        status: 'selected',
        version: original.identity.version,
      })
    } finally {
      restoreReplacement?.()
    }
  })

  test('host policy executes the backend descriptor from its selection snapshot', () => {
    const id = 'backend:test/frozen-plan'
    const backend = (marker: string) => ({
      ...DefaultBackend,
      id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      render(doc: Parameters<typeof DefaultBackend.render>[0], context: Parameters<typeof DefaultBackend.render>[1]) {
        return DefaultBackend.render(doc, context).replace('<svg ', `<svg data-frozen-backend="${marker}" `)
      },
    })
    const unregisterV1 = registerBackend(backend('v1'), {
      version: '1.0.0',
      provenance: { owner: 'frozen-plan-test', source: 'test-v1' },
    })
    let unregisterV2: (() => void) | undefined
    try {
      const renderer = createMermaidRenderer({
        backendPolicy: {
          selectBackend() {
            unregisterV1()
            unregisterV2 = registerBackend(backend('v2'), {
              version: '2.0.0',
              provenance: { owner: 'frozen-plan-test', source: 'test-v2' },
            })
            return id
          },
        },
      })
      const rendered = renderer.renderMermaidSVGWithReceipt(
        'flowchart LR\n  A --> B',
        { style: 'hand-drawn' },
      )
      expect(rendered.svg).toContain('data-frozen-backend="v1"')
      expect(rendered.svg).not.toContain('data-frozen-backend="v2"')
      expect(rendered.receipt.executionDecision?.backend).toEqual({
        mode: 'scene',
        requestedId: 'rough',
        selectedId: id,
        version: '1.0.0',
        hostPolicy: true,
      })
      expect(knownBackendDescriptors().find(descriptor => descriptor.identity.id === id)?.identity.version)
        .toBe('2.0.0')
    } finally {
      unregisterV2?.()
      unregisterV1()
    }
  })

  test('keeps built-in augmentation and test replacement out of the public agent barrel', () => {
    expect('augmentFamily' in publicAgentApi).toBe(false)
    expect('replaceFamilyForTest' in publicAgentApi).toBe(false)
    expect('registerFamily' in publicAgentApi).toBe(true)
  })

  test('extension identity versions are semantic and resolved styles are explicitly versioned', () => {
    expect(() => createExtensionIdentity({
      id: 'resource:test', kind: 'resource', version: 'latest',
      provenance: { owner: 'test', source: 'test' },
    })).toThrow('semantic version')
    expect(resolveStyleStack({ colors: { bg: '#fff' } })?.formatVersion).toBe(STYLE_SPEC_FORMAT_VERSION)
    expect(validateStyleSpec({ formatVersion: 2 })).toContain('"formatVersion" must be 1')
  })
})
