import { describe, expect, test } from 'bun:test'

import type { FamilyDescriptor } from '../agent/families.ts'
import { registerFamily } from '../agent/family-registration.ts'
import type { ExternalFamilyId } from '../agent/types.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { createExtensionIdentity } from '../shared/extension-identity.ts'

const EVIDENCE = 'src/__tests__/code-mode-structured-errors.test.ts'

function nonGraphicalDescriptor(
  localId: string,
  header: string,
  serialize?: () => string,
): FamilyDescriptor {
  const id = `family:test/${localId}` as ExternalFamilyId
  return {
    contractVersion: 2,
    identity: createExtensionIdentity({
      id,
      kind: 'family',
      version: '1.0.0',
      compatibility: { core: '^0.1.1' },
      provenance: { owner: 'code-mode-structured-errors-test', source: 'test' },
    }),
    id,
    label: `Code Mode ${localId}`,
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
      { capability: 'serialize', state: serialize ? 'native' : 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'mutation', state: 'diagnosed', evidence: [EVIDENCE] },
      { capability: 'verify', state: 'diagnosed', evidence: [EVIDENCE] },
      { capability: 'layout', state: 'diagnosed', evidence: [EVIDENCE] },
      { capability: 'scene', state: 'absent', evidence: [EVIDENCE] },
      { capability: 'svg', state: 'absent', evidence: [EVIDENCE] },
      { capability: 'terminal', state: 'absent', evidence: [EVIDENCE] },
    ],
    layout: () => ({ width: 120, height: 40 }),
    ...(serialize ? { serialize } : {}),
  }
}

describe('Code Mode structured render errors', () => {
  test('preserves family-detection diagnostics as detached read-only data', async () => {
    const source = 'futureCodeModeDiagram\n  exact authored payload'
    const result = await executeInSandbox(`
      try {
        mermaid.renderMermaidSVG(${JSON.stringify(source)})
        return { failure: 'render unexpectedly succeeded' }
      } catch (error) {
        let mutation = 'unexpectedly mutable'
        try { error.preservation.source = 'tampered' } catch (_) { mutation = 'blocked' }
        let constructorEscape = 'unexpectedly reachable'
        try { constructorEscape = error.preservation.constructor.constructor('return typeof process')() } catch (_) { constructorEscape = 'blocked' }
        const span = error.preservation.spans.header
        return {
          name: error.name,
          code: error.code,
          line: error.line,
          help: error.help,
          source: error.preservation.source,
          header: error.preservation.source.slice(span.start.offset, span.end.offset),
          mutation,
          constructorEscape,
        }
      }
    `)

    expect(result).toMatchObject({
      ok: true,
      value: {
        name: 'MermaidFamilyDetectionError',
        code: 'UNKNOWN_HEADER',
        line: 1,
        source,
        header: 'futureCodeModeDiagram',
        mutation: 'blocked',
        constructorEscape: 'blocked',
      },
    })
    expect((result.value as { help: string }).help).toContain('register a namespaced family descriptor')
  })

  test('preserves capability negotiation detail without sharing host records', async () => {
    const header = 'codeModeNoSvgDiagram'
    const descriptor = nonGraphicalDescriptor('no-svg', header)
    const unregister = registerFamily(descriptor)
    try {
      const result = await executeInSandbox(`
        try {
          mermaid.renderMermaidSVG(${JSON.stringify(`${header}\n  payload`)})
          return { failure: 'render unexpectedly succeeded' }
        } catch (error) {
          let mutation = 'unexpectedly mutable'
          try { error.decision.resolutions[0].status = 'selected' } catch (_) { mutation = 'blocked' }
          let constructorEscape = 'unexpectedly reachable'
          try { constructorEscape = error.decision.constructor.constructor('return typeof process')() } catch (_) { constructorEscape = 'blocked' }
          return {
            name: error.name,
            code: error.code,
            output: error.output,
            family: error.family,
            accepted: error.decision.accepted,
            resolutions: error.decision.resolutions,
            mutation,
            constructorEscape,
          }
        }
      `)

      expect(result).toMatchObject({
        ok: true,
        value: {
          name: 'RenderCapabilityError',
          code: 'UNSATISFIED_RENDER_CAPABILITIES',
          output: 'svg',
          family: { id: descriptor.id, version: '1.0.0' },
          accepted: false,
          mutation: 'blocked',
          constructorEscape: 'blocked',
        },
      })
      expect((result.value as { resolutions: Array<{ id: string; status: string }> }).resolutions)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ id: 'operation:render-svg', status: 'unsupported' }),
          expect.objectContaining({ id: 'output:svg', status: 'unsupported' }),
        ]))
    } finally {
      unregister()
    }
  })

  test('rejects parsed-family mismatch sources before Code Mode and preserves structured width detail', async () => {
    const header = 'codeModeMismatchedSerializerDiagram'
    const descriptor = nonGraphicalDescriptor(
      'mismatched-serializer',
      header,
      () => 'flowchart TD\n  A --> B\n',
    )
    expect(() => registerFamily(descriptor)).toThrow(/serializer changed family identity to "flowchart"/i)
    const width = await executeInSandbox(`
      try {
        mermaid.renderMermaidASCII('flowchart TD\\n  A[🙂]', { targetWidth: 1 })
        return { failure: 'render unexpectedly succeeded' }
      } catch (error) {
        return {
          name: error.name,
          code: error.code,
          requestedWidth: error.requestedWidth,
          requiredWidth: error.requiredWidth,
          family: error.family,
          reason: error.reason,
        }
      }
    `)
    expect(width).toMatchObject({
      ok: true,
      value: {
        name: 'AsciiWidthError',
        code: 'ASCII_TARGET_WIDTH_IMPOSSIBLE',
        requestedWidth: 1,
        family: 'flowchart',
        reason: 'UNBREAKABLE_GRAPHEME',
      },
    })
    expect((width.value as { requiredWidth: number }).requiredWidth).toBeGreaterThan(1)
  })
})
