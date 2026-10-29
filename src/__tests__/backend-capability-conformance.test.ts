import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'

import {
  DefaultBackend,
  KNOWN_EXTENSION_CONTRACT_VERSIONS,
  createMermaidBrowserPNGRenderer,
  createMermaidRenderer,
  applyOutputSecurityPolicy,
  knownBackendDescriptors,
  registerBackend,
  verifyNoExternalRefs,
  verifySvgDocumentEnvelope,
} from '../index.ts'
import { createMermaidPNGRenderer } from '../agent/png.ts'
import { getFamily } from '../agent/core.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { primitiveCapabilityClaimKey } from '../scene/capabilities.ts'
import { pngFixture } from './helpers/png-fixture.ts'
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const BACKEND_REGISTRATION_OPTIONS = Object.freeze({
  compatibility: Object.freeze({ core: KNOWN_EXTENSION_CONTRACT_VERSIONS.core, scene: '^2.0.0' }),
})

function firstPartyBackends() {
  return knownBackendDescriptors().filter(descriptor => descriptor.identity.provenance.owner === 'agentic-mermaid')
}

describe('claim-keyed backend capability conformance', () => {
  test.each(['open', 'close'] as const)('preserves the untouched group field after redefining %s as equal own data', field => {
    for (const { backend } of firstPartyBackends()) {
      const positioned = layoutClassDiagram(parseClassDiagram(['classDiagram', 'class A']))
      const scene = getFamily('class')!.lowerScene!({ positioned,
        colors: { bg: '#fff', fg: '#111', embedFontImport: false }, resolved: { renderOptions: {} } })
      const group = scene.parts.find(part => part.kind === 'group' && part.role === 'class-box')!
      if (group.kind !== 'group') throw new Error('Expected the public Class group')
      const original = group[field]
      Object.defineProperty(group, field, { value: original, writable: true })
      const svg = backend.render(scene, { seed: 0 })
      expect(verifySvgDocumentEnvelope(svg)).toBe(true)
      expect(svg).toContain('class="class-node" data-id="A" data-label="A"')
      expect(svg).toContain('>A</text>')
      expect(() => applyOutputSecurityPolicy(svg, 'strict')).not.toThrow()
      expect(Object.getOwnPropertyDescriptor(group, field)?.value).toBe(original)
      expect(Object.isFrozen(group)).toBe(false)
      expect(Object.isFrozen(scene)).toBe(false)
    }
  })

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
      expect(results.every(result => result.witnessId?.startsWith('backend-claim-matrix@4/'))).toBe(true)
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
    for (const descriptor of backends) {
      // Bun's asymmetric toMatchObject matchers may rewrite their received
      // value. Match structural copies so this assertion cannot poison the
      // registry's shared conformance authority for later capability reports.
      expect(structuredClone(descriptor.conformance.claims.find(claim =>
        claim.primitive === 'connector' && claim.feature === 'compositing' && claim.operation === 'render')))
        .toMatchObject({ status: 'passed' })
      expect(structuredClone(descriptor.conformance.claims.find(claim =>
        claim.primitive === 'document' && claim.feature === 'resources' && claim.operation === 'serialize')))
        .toMatchObject({ status: 'passed', observation: expect.stringContaining('marker and linear-gradient') })
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

  test('checks every host SVG after backend registration and isolates failed requests', () => {
    const id = 'backend:test/conditional-svg-policy'
    let content = ''
    const unregister = registerBackend({
      ...DefaultBackend,
      id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      render(document, context) {
        return DefaultBackend.render(document, context).replace('</svg>', `${content}</svg>`)
      },
    }, BACKEND_REGISTRATION_OPTIONS)
    try {
      const renderer = createMermaidRenderer({ backendPolicy: { selectBackend: () => id } })
      const source = 'flowchart LR\n  A[Alpha] --> B[Beta]'
      const safe = renderer.renderMermaidSVG(source)
      expect(safe).toContain('>Alpha</text>')
      expect(safe).toContain('>Beta</text>')
      for (const security of ['default', 'strict'] as const) {
        for (const [markup, diagnostic] of [
          ['<g onload="alert(1)"/>', 'active content'],
          ['<a href="javascript&#x3a;alert(1)"><rect/></a>', 'active content'],
          [String.raw`<rect style="fill:java\73 cript:alert(1)"/>`, 'active content'],
          ['<style>rect{fill:expre/**/ssion(alert(1))}</style>', 'active content'],
          ['<rect x="1" x="2"/>', 'invalid SVG document envelope'],
          ['<text>\ud800</text>', 'invalid SVG document envelope'],
          ['<script>&#xFFFF;</script>', 'invalid SVG document envelope'],
        ] as const) {
          content = markup
          expect(() => renderer.renderMermaidSVG(source, { security })).toThrow(diagnostic)
          expect(() => renderer.renderMermaidSVGWithReceipt(source, { security })).toThrow(diagnostic)
          content = ''
          expect(renderer.renderMermaidSVG(source, { security })).toBe(safe)
        }
      }
      for (const [markup, reference] of [
        ['<a href="https://example.invalid/host-link"><rect/></a>', 'https://example.invalid/host-link'],
        [String.raw`<rect fill="u\2f\2a x\2a\2f rl(https://example.invalid/fill.svg)"/>`,
          String.raw`fill=u\2f\2a x\2a\2f rl(https://example.invalid/fill.svg)`],
        [String.raw`<rect fill="\26 #117;rl(relative.svg)"/>`, String.raw`fill=\26 #117;rl(relative.svg)`],
      ] as const) {
        content = markup
        const external = renderer.renderMermaidSVGWithReceipt(source)
        expect(external.svg).toContain(content)
        expect(external.receipt.diagnostics).toContainEqual({ code: 'EXTERNAL_REFERENCE', reference })
        expect(() => renderer.renderMermaidSVG(source, { security: 'strict' })).toThrow('strict verification failed')
        expect(() => renderer.renderMermaidSVGWithReceipt(source, { security: 'strict' })).toThrow('strict verification failed')
      }
      content = ''
      expect(renderer.renderMermaidSVGWithReceipt(source).svg).toBe(safe)
    } finally {
      unregister()
    }
  })

  test('rejects malformed XML during backend admission and final envelope validation', () => {
    const xmlns = 'xmlns="http://www.w3.org/2000/svg"'
    expect(verifySvgDocumentEnvelope(`<svg ${xmlns}><text>safe &amp; sound</text></svg>`)).toBe(true)
    // Raw XML characters and numeric references obey the same scalar bounds.
    for (const text of ['\t\n\r', 'café 東京', '👩‍💻 é', '\u{10000}', '\u{1fffe}', '\u{10ffff}', '&#9;&#10;&#13;&#x10000;&#x1FFFE;']) {
      expect(verifySvgDocumentEnvelope(`<svg ${xmlns}><text>${text}</text></svg>`), text).toBe(true)
      expect(verifySvgDocumentEnvelope(`<svg ${xmlns} data-label="${text}"></svg>`), text).toBe(true)
    }
    for (const text of ['\u0000', '\u0008', '\u000b', '\u000c', '\u001f', '\ud800', '\udfff', '\ufffe', '\uffff', '&#0;', '&#55296;', '&#xD800;', '&#xFFFE;', '&#xFFFF;', '&#x110000;']) {
      for (const document of [`<svg ${xmlns}><text>${text}</text></svg>`, `<svg ${xmlns} data-label="${text}"></svg>`]) {
        expect(verifySvgDocumentEnvelope(document), text).toBe(false)
        expect(() => applyOutputSecurityPolicy(document, 'strict')).toThrow(/invalid SVG document envelope/)
      }
    }
    // Child bindings are inherited by descendants, then restored for siblings.
    expect(verifySvgDocumentEnvelope(`<svg ${xmlns} xmlns:a="urn:outer" xmlns:b="urn:inner"><g xmlns:a="urn:inner"><rect a:x="1" /></g><rect a:x="1" b:x="2" /></svg>`)).toBe(true)
    expect(verifySvgDocumentEnvelope(`<svg ${xmlns} xmlns:a="urn:outer" xmlns:b="urn:inner" xml:lang="en"><g xmlns:a="urn:inner" /><rect x="0" a:x="1" b:x="2" /></svg>`)).toBe(true)
    for (const document of [
      `<svg ${xmlns}><rect data-label="&quot;'&#34;&#39;" data-next='&apos;"'/></svg>`,
      `<svg ${xmlns}><rect data-label="&#60; &lt; >"/><text>&#60; &lt; ]]&gt;</text><!--a-b--></svg>`,
      `<svg ${xmlns} data-label="&#${'0'.repeat(256)}65;"><text>&#x${'0'.repeat(256)}41;</text></svg>`,
    ]) {
      expect(verifySvgDocumentEnvelope(document), document).toBe(true)
      let spent = 0
      expect(verifySvgDocumentEnvelope(document, operations => {
        if (operations > 400_000 - spent) return false
        spent += operations
        return true
      }), document).toBe(true)
      expect(applyOutputSecurityPolicy(document, 'strict')).toEqual({ svg: document, diagnostics: [] })
    }
    const malformedDocuments = [
      '<svg><rect /></svg>',
      `<svg ${xmlns}><text>&</text></svg>`,
      `<svg ${xmlns}><rect broken /></svg>`,
      `<svg ${xmlns}><rect x="1" x="2" /></svg>`,
      `<svg ${xmlns}><rect data-label="a"b" /></svg>`,
      `<svg ${xmlns}><rect data-label="<" /></svg>`,
      `<svg ${xmlns}><text>]]></text></svg>`,
      `<svg ${xmlns}><rect data-label="&amp" data-next=";" /></svg>`,
      `<svg ${xmlns}><rect data-label="&#65" data-next=";" /></svg>`,
      `<svg ${xmlns}><text>&amp</text><text>;</text></svg>`,
      `<svg ${xmlns}><text>&#x41</text><text>;</text></svg>`,
      `<svg ${xmlns}><p:rect /></svg>`,
      `<svg ${xmlns} xmlns:a="urn:test" xmlns:b="urn:test"><rect a:x="1" b:x="2" /></svg>`,
      `<svg ${xmlns}><g xmlns:a="urn:child"><rect a:x="1" /></g><rect a:x="1" /></svg>`,
      `<svg ${xmlns} xmlns:a="urn:outer" xmlns:b="urn:inner"><g xmlns:a="urn:inner"><g><rect a:x="1" b:x="2" /></g></g></svg>`,
      `<svg ${xmlns} xmlns:a="urn:test"><rect a:b:x="1" /></svg>`,
      `<svg ${xmlns} xmlns:a=""><rect a:x="1" /></svg>`,
      `<svg ${xmlns} xmlns:a="urn:test" xmlns:b="urn:te&#115;t"><rect a:x="1" b:x="2" /></svg>`,
      `<svg ${xmlns}><x:svg xmlns:x="${'http://www.w3.org/2000/svg'}"></x:svg></svg>`,
      `<svg ${xmlns} xmlns:s="${'http://www.w3.org/2000/svg'}"><s:style>@import url(https://evil.example/x.css);</s:style></svg>`,
      `<svg ${xmlns}><style><![CDATA[/*</style>*/ @import url(https://evil.example/x.css);]]></style></svg>`,
      `<svg ${xmlns}><!--x---></svg>`,
      `<svg ${xmlns}><!--a--b--></svg>`,
      `<svg ${xmlns} xmlns:xml="urn:not-xml"><rect /></svg>`,
      `<svg ${xmlns} xmlns:p="${'http://www.w3.org/2000/xmlns/'}"><rect /></svg>`,
    ]
    for (const document of malformedDocuments) {
      expect(verifySvgDocumentEnvelope(document), document).toBe(false)
      expect(verifySvgDocumentEnvelope(document, () => true), document).toBe(false)
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

  test('envelope validation stays independent of CSS inspection errors and wins for malformed XML', () => {
    const opening = '<svg xmlns="http://www.w3.org/2000/svg">'
    for (const content of ['<rect fill="\\ffffff"/>', '<style>.x{fill:\\ffffff}</style>']) {
      const valid = `${opening}${content}</svg>`
      expect(verifySvgDocumentEnvelope(valid)).toBe(true)
      expect(() => applyOutputSecurityPolicy(valid, 'strict')).toThrow(RangeError)
      for (const malformed of [`${opening}${content}</g>`, `${opening}${content}<rect x="1" x="2"/></svg>`]) {
        expect(verifySvgDocumentEnvelope(malformed)).toBe(false)
        expect(() => applyOutputSecurityPolicy(malformed, 'strict')).toThrow(/invalid SVG document envelope/)
      }
    }
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
