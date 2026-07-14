import { describe, expect, test } from 'bun:test'
import ts from 'typescript'

import { SHARED_RENDER_OPTION_FIELDS } from '../render-contract.ts'
import {
  CODE_MODE_CORE_RENDER_OPTION_DECLARATIONS,
  CODE_MODE_RENDER_OPTION_DECLARATIONS,
  CODE_MODE_SHARED_RENDER_OPTIONS_DECLARATION,
  SDK_DECLARATION,
} from '../mcp/sdk-decl.ts'
import { SDK_CORE_DECLARATION } from '../mcp/sdk-discovery.ts'

describe('Code Mode preservation declarations', () => {
  test('exposes lossless preservation spans and descriptor identity in both declarations', () => {
    for (const declaration of [SDK_DECLARATION, SDK_CORE_DECLARATION]) {
      expect(declaration).toContain('interface SourceSpanPoint {')
      expect(declaration).toContain('readonly offset: number')
      expect(declaration).toContain('interface PreservedSourceSpans {')
      expect(declaration).toContain('readonly wrapper?: SourceSpan')
      expect(declaration).toContain('readonly preservation: SourcePreservationReceipt')
      expect(declaration).toContain('readonly spans: PreservedSourceSpans')
      expect(declaration).toContain('readonly source: string')
      expect(declaration).toContain("readonly descriptorIdentity: ExtensionIdentity<'family'>")
      expect(declaration).toContain('readonly compatibility: ExtensionCompatibility')
      expect(declaration).toContain('readonly provenance: ExtensionProvenance')
      expect(declaration).toContain('parseRegisteredMermaid(source: string): Result<ParsedDiagram, ParseError[]>')
    }
  })

  test('uses one complete render-options and receipt authority in both declarations', () => {
    expect(SDK_DECLARATION).toContain(CODE_MODE_RENDER_OPTION_DECLARATIONS)
    expect(SDK_CORE_DECLARATION).toContain(CODE_MODE_CORE_RENDER_OPTION_DECLARATIONS)
    expect(SDK_DECLARATION).toContain(CODE_MODE_SHARED_RENDER_OPTIONS_DECLARATION)
    for (const declaration of [SDK_DECLARATION, SDK_CORE_DECLARATION]) {
      expect(declaration).toContain('interface SvgRenderOptions extends SharedRenderOptions')
      expect(declaration).toContain('interface AsciiRenderOptions extends SharedRenderOptions')
      expect(declaration).toContain('interface LayoutRenderOptions extends SharedRenderOptions')
      for (const field of SHARED_RENDER_OPTION_FIELDS) {
        expect(declaration).toContain(`${field}?:`)
      }
      expect(declaration).toContain('capabilityDecision?: CapabilityDecision')
      expect(declaration).toContain('graphicalProjectionDigest?: string')
      expect(declaration).toContain('executionDecision?: RenderExecutionDecision')
      expect(declaration).toContain("readonly status: 'selected' | 'unsupported' | 'incompatible'")
      expect(declaration).toContain("readonly mode: 'scene'")
      expect(declaration).toContain("readonly mode: 'family-svg'")
      expect(declaration).toContain('renderMermaidSVGWithReceipt(input: ParsedDiagram | string, opts?: SvgRenderOptions): RenderedSvg')
      expect(declaration).toContain('renderMermaidASCIIWithReceipt(input: ParsedDiagram | string, opts?: AsciiRenderOptions): RenderedAscii')
      expect(declaration).toContain('layoutMermaidWithReceipt(input: ParsedDiagram | string, opts?: LayoutRenderOptions): RenderedLayoutArtifact')
      const parsed = ts.createSourceFile('code-mode-sdk.d.ts', declaration, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      expect((parsed as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics).toEqual([])
    }
  })
})
