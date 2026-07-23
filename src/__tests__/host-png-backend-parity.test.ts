import { describe, expect, test } from 'bun:test'

import {
  DefaultBackend,
  createMermaidBrowserPNGRenderer,
  createMermaidRenderer,
  registerBackend,
  renderMermaidASCIIWithReceipt,
  verifyNoExternalRefs,
} from '../index.ts'
import { createMermaidPNGRenderer } from '../agent/index.ts'
import { getFamily, replaceFamilyForTest } from '../agent/families.ts'
import { inspectPngColorProfile } from '../output-color-profile.ts'
import type { HostBackendPolicy } from '../scene/backend.ts'
import type { SceneRole } from '../scene/roles.ts'
import type { RenderOptions } from '../types.ts'
import { pngFixture } from './helpers/png-fixture.ts'

function registerProbeBackend(id: string, rendered: () => void): () => void {
  return registerBackend({
    ...DefaultBackend,
    id,
    capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
    render(document, context) {
      rendered()
      return DefaultBackend.render(document, context)
        .replace('<svg ', `<svg data-host-backend="${id}" `)
    },
  }, {
    compatibility: { core: '^0.2.0', scene: '^2.0.0' },
    provenance: { owner: 'host-png-parity-test', source: 'test' },
  })
}

describe('host-selected graphical backend parity', () => {
  test('SVG, native PNG, and browser PNG share host selection, security, policy, and receipts', async () => {
    const id = 'backend:test/host-png-parity'
    let backendRenders = 0
    const unregister = registerProbeBackend(id, () => { backendRenders++ })
    backendRenders = 0 // exclude registration conformance
    const backendPolicy: HostBackendPolicy = { selectBackend: () => id }
    let browserSvg = ''
    const browser = createMermaidBrowserPNGRenderer({
      backendPolicy,
      async rasterize(svg, context) {
        browserSvg = svg
        expect(context.receipt.executionDecision?.backend).toMatchObject({
          mode: 'scene', selectedId: id, hostPolicy: true,
        })
        return {
          png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height),
          fontSources: ['embedded-data-uri'],
        }
      },
    })
    const svg = createMermaidRenderer({ backendPolicy })
    const native = createMermaidPNGRenderer({ backendPolicy })
    const source = 'flowchart LR\n  A --> B'
    const options = {
      style: 'hand-drawn',
      seed: 7,
      security: 'strict',
      padding: 18,
    } as const satisfies RenderOptions
    try {
      const svgArtifact = svg.renderMermaidSVGWithReceipt(source, options)
      const nativeArtifact = native.renderMermaidPNGWithReceipt(source, {
        ...options,
        scale: 0.1,
        background: '#fefefe',
        fitTo: { width: 64 },
        onWarning: () => {},
      })
      const browserArtifact = await browser.renderMermaidPNGWithReceipt(source, options, {
        scale: 0.1,
        background: '#fefefe',
        fitTo: { width: 64 },
      })

      expect(backendRenders).toBe(3)
      expect(svgArtifact.svg).toContain(`data-host-backend="${id}"`)
      expect(browserSvg).toContain(`data-host-backend="${id}"`)
      expect(verifyNoExternalRefs(svgArtifact.svg).ok).toBe(true)
      expect(verifyNoExternalRefs(browserSvg).ok).toBe(true)
      for (const receipt of [svgArtifact.receipt, nativeArtifact.receipt, browserArtifact.receipt]) {
        expect(receipt.executionDecision?.backend).toMatchObject({
          mode: 'scene', selectedId: id, hostPolicy: true,
        })
      }
      expect(new Set([
        svgArtifact.receipt.sharedRequestDigest,
        nativeArtifact.receipt.sharedRequestDigest,
        browserArtifact.receipt.sharedRequestDigest,
      ]).size).toBe(1)
      // Both rasterizers consume the exact same secured PNG graphical request.
      expect(nativeArtifact.receipt).toEqual(browserArtifact.receipt)
      expect(nativeArtifact.receipt.graphicalProjectionDigest).toBeDefined()
      expect(inspectPngColorProfile(nativeArtifact.png)).toMatchObject({ profile: 'srgb', hasICC: false })
      expect(browserArtifact.colorProfile).toMatchObject({ profile: 'srgb', hasICC: false })
      expect(browserArtifact.runtime.fontSources).toEqual(['embedded-data-uri'])
    } finally {
      unregister()
    }
  })

  test('bound renderers snapshot the host policy selector at construction', async () => {
    const first = 'backend:test/bound-policy-first'
    const second = 'backend:test/bound-policy-second'
    const unregisterFirst = registerProbeBackend(first, () => {})
    const unregisterSecond = registerProbeBackend(second, () => {})
    const policy: HostBackendPolicy = { selectBackend: () => first }
    let browserSvg = ''
    const svg = createMermaidRenderer({ backendPolicy: policy })
    const native = createMermaidPNGRenderer({ backendPolicy: policy })
    const browser = createMermaidBrowserPNGRenderer({
      backendPolicy: policy,
      async rasterize(projected, context) {
        browserSvg = projected
        return { png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height) }
      },
    })
    ;(policy as { selectBackend: HostBackendPolicy['selectBackend'] }).selectBackend = () => second
    const source = 'flowchart LR\n  A --> B'
    const options = { style: 'hand-drawn' } as const
    try {
      const svgArtifact = svg.renderMermaidSVGWithReceipt(source, options)
      const nativeArtifact = native.renderMermaidPNGWithReceipt(source, { ...options, scale: 0.1, onWarning: () => {} })
      const browserArtifact = await browser.renderMermaidPNGWithReceipt(source, options, 0.1)
      expect(svgArtifact.svg).toContain(`data-host-backend="${first}"`)
      expect(browserSvg).toContain(`data-host-backend="${first}"`)
      for (const receipt of [svgArtifact.receipt, nativeArtifact.receipt, browserArtifact.receipt]) {
        expect(receipt.executionDecision?.backend).toMatchObject({ selectedId: first, hostPolicy: true })
      }
    } finally {
      unregisterSecond()
      unregisterFirst()
    }
  })

  test('Scene admission rejects undeclared graphical lowering while native terminal remains independent', async () => {
    const id = 'backend:test/host-png-admission'
    let backendRenders = 0
    let browserRasters = 0
    const unregister = registerProbeBackend(id, () => { backendRenders++ })
    backendRenders = 0
    const descriptor = getFamily('flowchart')!
    const originalLowerScene = descriptor.lowerScene!
    const restoreFamily = replaceFamilyForTest('flowchart', {
      ...descriptor,
      lowerScene(context) {
        const scene = originalLowerScene(context)
        const first = scene.parts[0]!
        ;(first as { role: SceneRole }).role = 'test:undeclared'
        return scene
      },
    })
    const backendPolicy: HostBackendPolicy = { selectBackend: () => id }
    const svg = createMermaidRenderer({ backendPolicy })
    const native = createMermaidPNGRenderer({ backendPolicy })
    const browser = createMermaidBrowserPNGRenderer({
      backendPolicy,
      async rasterize() {
        browserRasters++
        return { png: pngFixture(1, 1) }
      },
    })
    const source = 'flowchart LR\n  A --> B'
    const options = { style: 'hand-drawn', security: 'strict' } as const satisfies RenderOptions
    try {
      const terminal = renderMermaidASCIIWithReceipt(source)
      expect(terminal.text).toContain('A')
      expect(terminal.terminalStyle.diagnostics).toContainEqual(expect.objectContaining({
        code: 'TERMINAL_CONNECTOR_PROJECTION_UNAVAILABLE',
      }))
      expect(() => svg.renderMermaidSVG(source, options)).toThrow(/undeclared role/i)
      expect(() => native.renderMermaidPNG(source, { ...options, scale: 0.1, onWarning: () => {} }))
        .toThrow(/undeclared role/i)
      await expect(browser.renderMermaidPNG(source, options, 0.1)).rejects.toThrow(/undeclared role/i)
      expect(backendRenders).toBe(0)
      expect(browserRasters).toBe(0)
    } finally {
      restoreFamily()
      unregister()
    }
  })
})
