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
    expect(SDK_DECLARATION).toContain('wrapperSource?: string')
    expect(SDK_DECLARATION).toContain('droppedComments?: { text: string; line: number }[]')
  })

  test('keeps parser-populated mindmap and gitgraph read-back fields recursively visible', () => {
    const declaration = ts.createSourceFile('code-mode-sdk.d.ts', SDK_DECLARATION, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const source = (path: string) => ts.createSourceFile(path, require('node:fs').readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const root = require('node:path').join(import.meta.dir, '..')
    const mindmap = source(require('node:path').join(root, 'mindmap/types.ts'))
    const gitgraph = source(require('node:path').join(root, 'gitgraph/types.ts'))
    const fields = (file: ts.SourceFile, name: string) => {
      const node = file.statements.find(statement => ts.isInterfaceDeclaration(statement) && statement.name.text === name)
      expect(node && ts.isInterfaceDeclaration(node)).toBe(true)
      if (!node || !ts.isInterfaceDeclaration(node)) return []
      return node.members.flatMap(member => member.name ? [member.name.getText(file)] : []).sort()
    }
    expect(fields(declaration, 'MindmapNode')).toEqual(fields(mindmap, 'MindmapNode'))
    expect(fields(declaration, 'GitGraphCommit')).toEqual(fields(gitgraph, 'GitGraphCommit'))
    expect(fields(declaration, 'GitGraphBranch')).toEqual(fields(gitgraph, 'GitGraphBranch'))
    expect(fields(declaration, 'GitGraphBody').filter(field => field !== 'kind'))
      .toEqual(fields(gitgraph, 'GitGraphDiagram'))

    const unionFields = (file: ts.SourceFile, name: string) => {
      const alias = file.statements.find(statement => ts.isTypeAliasDeclaration(statement) && statement.name.text === name)
      expect(alias && ts.isTypeAliasDeclaration(alias)).toBe(true)
      if (!alias || !ts.isTypeAliasDeclaration(alias) || !ts.isUnionTypeNode(alias.type)) return []
      return alias.type.types.map(member => ts.isTypeLiteralNode(member)
        ? member.members.flatMap(field => field.name ? [field.name.getText(file)] : []).sort().join(',')
        : '').sort()
    }
    expect(unionFields(declaration, 'GitGraphStatement')).toEqual(unionFields(gitgraph, 'GitGraphStatement'))
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
      expect(declaration).toContain('capabilityDecision: CapabilityDecision')
      expect(declaration).toMatch(/verifyMermaid\(input: ParsedDiagram \| string, opts\?: \{[^}]*renderOptions\?: SharedRenderOptions[^}]*\}\): VerifyResult/)
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

  test('declares structured fields populated by advertised mutation operations', () => {
    const parsed = ts.createSourceFile('code-mode-sdk.d.ts', SDK_DECLARATION, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const fields = (interfaceName: string): Set<string> => {
      const declaration = parsed.statements.find(statement =>
        ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName)
      expect(declaration && ts.isInterfaceDeclaration(declaration)).toBe(true)
      if (!declaration || !ts.isInterfaceDeclaration(declaration)) return new Set()
      return new Set(declaration.members.flatMap(member => member.name ? [member.name.getText(parsed)] : []))
    }
    const expected: Record<string, string[]> = {
      FlowchartGraph: ['classDefs', 'classAssignments', 'nodeStyles', 'linkStyles'],
      StateNode: ['declaredBare', 'regions', 'className', 'style'],
      StateTransition: ['style'],
      StateBody: ['classDefs', 'defaultTransitionStyle'],
      ClassNode: ['className', 'style'],
      ClassBody: ['classDefs'],
      ErEntity: ['className', 'style'],
      ErBody: ['direction', 'classDefs', 'statements'],
      ArchitectureEndpoint: ['boundary'],
      ArchitectureBody: ['accessibilityTitle', 'accessibilityDescription'],
    }
    for (const [interfaceName, requiredFields] of Object.entries(expected)) {
      expect([...fields(interfaceName)]).toEqual(expect.arrayContaining(requiredFields))
    }
  })
})
