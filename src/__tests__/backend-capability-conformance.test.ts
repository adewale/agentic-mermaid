import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'

import {
  DefaultBackend,
  createMermaidBrowserPNGRenderer,
  applyOutputSecurityPolicy,
  knownBackendDescriptors,
  registerBackend,
  verifyNoExternalRefs,
  verifySvgDocumentEnvelope,
} from '../index.ts'
import { createMermaidPNGRenderer } from '../agent/png.ts'
import { primitiveCapabilityClaimKey } from '../scene/capabilities.ts'
import { pngFixture } from './helpers/png-fixture.ts'
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const BACKEND_REGISTRATION_OPTIONS = Object.freeze({
  compatibility: Object.freeze({ core: '^0.2.0', scene: '^2.0.0' }),
})

function firstPartyBackends() {
  return knownBackendDescriptors().filter(descriptor => descriptor.identity.provenance.owner === 'agentic-mermaid')
}

describe('claim-keyed backend capability conformance', () => {
  test('executes exactly one passing witness for every first-party declaration', () => {
    const backends = firstPartyBackends()
    expect(backends.map(descriptor => descriptor.identity.id)).toEqual([
      'backend:default',
      'backend:rough',
      'backend:hybrid',
    ])

    for (const descriptor of backends) {
      const declarations = descriptor.backend.capabilities.map(primitiveCapabilityClaimKey)
      const results = descriptor.conformance.claims
      expect(results.map(result => result.claimKey)).toEqual(declarations)
      expect(new Set(results.map(result => result.claimKey)).size).toBe(declarations.length)
      expect(results.every(result => result.status === 'passed')).toBe(true)
      expect(results.every(result => result.witnessId?.startsWith('backend-claim-matrix@3/'))).toBe(true)
      expect(results.every(result => Boolean(result.observation))).toBe(true)
      expect(descriptor.conformance.checks.find(check => check.id === 'capability-claims'))
        .toEqual({ id: 'capability-claims', passed: true })
    }

    const hybrid = backends.find(descriptor => descriptor.identity.id === 'backend:hybrid')!
    for (const feature of ['geometry', 'paint']) {
      expect(hybrid.conformance.claims.find(claim =>
        claim.primitive === 'shape' && claim.feature === feature && claim.operation === 'render'))
        .toMatchObject({ realization: 'emulated', status: 'passed' })
    }
  })

  test('rejects a backend whose shape-paint declaration has no matching behavior', () => {
    const id = 'backend:test/false-shape-paint-claim'
    expect(() => registerBackend({
      ...DefaultBackend,
      id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      drawNode(node, context) {
        const output = DefaultBackend.drawNode(node, context)
        return node.kind === 'shape' ? output.replaceAll('#f4efe6', 'none') : output
      },
    }, BACKEND_REGISTRATION_OPTIONS)).toThrow(/capability-claims: shape\/paint\/render/)
  })

  test('rejects a backend that would fail the final always-on output policy', () => {
    const id = 'backend:test/active-css'
    expect(() => registerBackend({
      ...DefaultBackend,
      id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      render(doc, context) {
        return DefaultBackend.render(doc, context)
          .replace('</svg>', '<style>.x{color:javascript:alert(1)}</style></svg>')
      },
    }, BACKEND_REGISTRATION_OPTIONS)).toThrow(/output-security.*active content/i)
  })

  test('rejects malformed XML during backend admission and final envelope validation', () => {
    const xmlns = 'xmlns="http://www.w3.org/2000/svg"'
    expect(verifySvgDocumentEnvelope(`<svg ${xmlns}><text>safe &amp; sound</text></svg>`)).toBe(true)
    const malformedDocuments = [
      '<svg><rect /></svg>',
      `<svg ${xmlns}><text>&</text></svg>`,
      `<svg ${xmlns}><rect broken /></svg>`,
      `<svg ${xmlns}><rect x="1" x="2" /></svg>`,
      `<svg ${xmlns}><p:rect /></svg>`,
      `<svg ${xmlns} xmlns:a="urn:test" xmlns:b="urn:test"><rect a:x="1" b:x="2" /></svg>`,
      `<svg ${xmlns}><x:svg xmlns:x="${'http://www.w3.org/2000/svg'}"></x:svg></svg>`,
      `<svg ${xmlns} xmlns:s="${'http://www.w3.org/2000/svg'}"><s:style>@import url(https://evil.example/x.css);</s:style></svg>`,
      `<svg ${xmlns}><style><![CDATA[/*</style>*/ @import url(https://evil.example/x.css);]]></style></svg>`,
      `<svg ${xmlns}><!--x---></svg>`,
      `<svg ${xmlns} xmlns:xml="urn:not-xml"><rect /></svg>`,
      `<svg ${xmlns} xmlns:p="${'http://www.w3.org/2000/xmlns/'}"><rect /></svg>`,
    ]
    for (const document of malformedDocuments) {
      expect(verifySvgDocumentEnvelope(document), document).toBe(false)
      expect(() => applyOutputSecurityPolicy(document, 'strict')).toThrow(/invalid SVG document envelope/)
    }

    for (const [localId, malformed] of [
      ['bare-reference', '<text>&</text>'],
      ['malformed-attribute', '<rect broken />'],
      ['unbound-prefix', '<p:rect />'],
      ['invalid-comment', '<!--x--->'],
    ] as const) {
      const id = `backend:test/${localId}`
      expect(() => registerBackend({
        ...DefaultBackend,
        id,
        capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
        render(doc, context) {
          return DefaultBackend.render(doc, context).replace('</svg>', `${malformed}</svg>`)
        },
      }, BACKEND_REGISTRATION_OPTIONS)).toThrow(/single-svg-document/)
    }

    const id = 'backend:test/missing-svg-namespace'
    expect(() => registerBackend({
      ...DefaultBackend,
      id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      render(doc, context) {
        return DefaultBackend.render(doc, context)
          .replace(' xmlns="http://www.w3.org/2000/svg"', '')
      },
    }, BACKEND_REGISTRATION_OPTIONS)).toThrow(/single-svg-document/)
  })

  test('projects every first-party backend through native and browser PNG adapters', async () => {
    const source = 'flowchart LR\n  A[Alpha] --> B[Beta]'
    const options = {
      style: { stroke: 'freehand' as const, fill: 'wash' as const, strokeWidth: 1.5 },
      seed: 23,
      security: 'strict' as const,
    }
    const nativeHashes = new Set<string>()
    const browserSvgHashes = new Set<string>()

    for (const descriptor of firstPartyBackends()) {
      const id = descriptor.identity.id
      const backendPolicy = { selectBackend: () => id }
      let browserSvg = ''
      const browser = createMermaidBrowserPNGRenderer({
        backendPolicy,
        async rasterize(svg, context) {
          browserSvg = svg
          return {
            png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height),
            fontSources: ['embedded-data-uri'],
          }
        },
      })
      const native = createMermaidPNGRenderer({ backendPolicy })
      const nativeArtifact = native.renderMermaidPNGWithReceipt(source, {
        ...options,
        scale: 0.1,
        onWarning: () => {},
      })
      const browserArtifact = await browser.renderMermaidPNGWithReceipt(source, options, 0.1)

      expect([...nativeArtifact.png.slice(0, 8)]).toEqual(PNG_SIGNATURE)
      expect([...browserArtifact.png.slice(0, 8)]).toEqual(PNG_SIGNATURE)
      expect(verifyNoExternalRefs(browserSvg).ok).toBe(true)
      expect(nativeArtifact.receipt.executionDecision?.backend).toMatchObject({ selectedId: id })
      expect(browserArtifact.receipt.executionDecision?.backend).toMatchObject({ selectedId: id })
      nativeHashes.add(createHash('sha256').update(nativeArtifact.png).digest('hex'))
      browserSvgHashes.add(createHash('sha256').update(browserSvg).digest('hex'))
    }

    // This catches an adapter silently bypassing the selected backend.
    expect(nativeHashes.size).toBe(3)
    expect(browserSvgHashes.size).toBe(3)
  })
})
