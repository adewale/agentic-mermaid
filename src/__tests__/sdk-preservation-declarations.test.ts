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

const printer = ts.createPrinter({ removeComments: true })

/**
 * Every member of a declaration, keyed by its owner path (`Interface.member`,
 * `Type.nested.member`, `mermaid.method()`), as printer-normalized text, plus
 * `interface X` (its heritage clause) and `type X` (its type). Comparing the
 * normalized AST text, not substrings, means the compacted core declaration
 * and the full one are held to the same members regardless of whitespace, and
 * a member must sit in the named interface, not merely appear somewhere.
 */
function declaredMembers(declaration: string): Map<string, string[]> {
  const file = ts.createSourceFile('code-mode-sdk.d.ts', declaration, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const members = new Map<string, string[]>()
  const add = (key: string, node: ts.Node) => {
    const text = printer.printNode(ts.EmitHint.Unspecified, node, file).replace(/\s+/g, ' ').trim()
    members.set(key, [...(members.get(key) ?? []), text])
  }
  const visit = (node: ts.Node, path: string): void => {
    if (ts.isInterfaceDeclaration(node)) {
      path = node.name.text
      add(`interface ${path}`, node.heritageClauses?.[0] ?? node.name)
    } else if (ts.isTypeAliasDeclaration(node)) {
      path = node.name.text
      add(`type ${path}`, node.type)
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      path = node.name.text
    } else if ((ts.isPropertySignature(node) || ts.isMethodSignature(node)) && node.name) {
      const name = node.name.getText(file)
      add(`${path}.${name}${ts.isMethodSignature(node) ? '()' : ''}`, node)
      path = `${path}.${name}`
    }
    ts.forEachChild(node, child => visit(child, path))
  }
  visit(file, '')
  return members
}

function expectDeclared(members: Map<string, string[]>, expected: Record<string, string>, label: string): void {
  for (const [key, text] of Object.entries(expected)) {
    expect({ label, key, declared: members.get(key) ?? [] }).toEqual({ label, key, declared: expect.arrayContaining([text]) })
  }
}

describe('Code Mode preservation declarations', () => {
  test('exposes lossless preservation spans and descriptor identity in both declarations', () => {
    for (const [label, declaration] of [['full', SDK_DECLARATION], ['core', SDK_CORE_DECLARATION]] as const) {
      const members = declaredMembers(declaration)
      for (const name of ['SourceSpanPoint', 'PreservedSourceSpans', 'SourceMapSpans']) {
        expect({ label, declared: members.has(`interface ${name}`) }, name).toEqual({ label, declared: true })
      }
      expectDeclared(members, {
        'SourceSpanPoint.offset': 'readonly offset: number;',
        'SourceMapSpans.preserved': 'readonly preserved: PreservedSourceSpans;',
        'ValidDiagram.source': 'readonly source: SourceMap;',
        'PreservedSourceSpans.wrapper': 'readonly wrapper?: SourceSpan;',
        'PreservedValidDiagram.body.preservation': 'readonly preservation: SourcePreservationReceipt;',
        'PreservedValidDiagram.body.spans': 'readonly spans: PreservedSourceSpans;',
        'SourcePreservationReceipt.source': 'readonly source: string;',
        'ExtensionValidDiagram.descriptorIdentity': "readonly descriptorIdentity: ExtensionIdentity<'family'>;",
        'ExtensionIdentity.compatibility': 'readonly compatibility: ExtensionCompatibility;',
        'ExtensionIdentity.provenance': 'readonly provenance: ExtensionProvenance;',
        'mermaid.parseRegisteredMermaid()': 'parseRegisteredMermaid(source: string): Result<ParsedDiagram, ParseError[]>;',
      }, label)
    }
    expectDeclared(declaredMembers(SDK_DECLARATION), {
      'ValidDiagram.meta.wrapperSource': 'wrapperSource?: string;',
      'ValidDiagram.meta.droppedComments': 'droppedComments?: { text: string; line: number; }[];',
      'ClassRelation.markerAt': "markerAt?: 'from' | 'to' | 'both' | 'none';",
    }, 'full')
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
    for (const [label, declaration] of [['full', SDK_DECLARATION], ['core', SDK_CORE_DECLARATION]] as const) {
      const members = declaredMembers(declaration)
      for (const name of ['RenderedRegion', 'DiagramActionRecord', 'RenderedLayout']) {
        expect({ label, declared: members.has(`interface ${name}`) }, name).toEqual({ label, declared: true })
      }
      expectDeclared(members, {
        'interface SvgRenderOptions': 'extends SharedRenderOptions',
        'interface AsciiRenderOptions': 'extends SharedRenderOptions',
        'interface LayoutRenderOptions': 'extends SharedRenderOptions',
        'type RenderedRegionKind': "'node' | 'edge' | 'label' | 'canvas' | 'group' | 'cluster' | 'lane' | 'band' | 'compartment' | 'plot' | 'ring'",
        'type DiagramActionSecurity': "'safe' | 'unsafe' | 'source-only' | 'unsupported'",
        'RenderedRegion.kind': 'kind: RenderedRegionKind;',
        'RenderedRegion.bounds': 'bounds: { x: number; y: number; w: number; h: number; };',
        'DiagramActionRecord.security': 'security: DiagramActionSecurity;',
        'RenderedLayout.bounds': 'bounds: { w: number; h: number; };',
        'RenderedLayout.groups': 'groups: unknown[];',
        'RenderedLayout.regions': 'regions?: RenderedRegion[];',
        'RenderedLayout.actions': 'actions?: DiagramActionRecord[];',
        'RenderRequestReceipt.capabilityDecision': 'capabilityDecision: CapabilityDecision;',
        'RenderRequestReceipt.graphicalProjectionDigest': 'graphicalProjectionDigest?: string;',
        'RenderRequestReceipt.executionDecision': 'executionDecision?: RenderExecutionDecision;',
        'CapabilityResolution.status': "readonly status: 'selected' | 'unsupported' | 'incompatible';",
        'mermaid.verifyMermaid.renderOptions': 'renderOptions?: SharedRenderOptions;',
        'mermaid.renderMermaidSVGWithReceipt()': 'renderMermaidSVGWithReceipt(input: ParsedDiagram | string, opts?: SvgRenderOptions): RenderedSvg;',
        'mermaid.renderMermaidASCIIWithReceipt()': 'renderMermaidASCIIWithReceipt(input: ParsedDiagram | string, opts?: AsciiRenderOptions): RenderedAscii;',
        'mermaid.layoutMermaidWithReceipt()': 'layoutMermaidWithReceipt(input: ParsedDiagram | string, opts?: LayoutRenderOptions): RenderedLayoutArtifact;',
      }, label)
      expect({ label, modes: members.get('RenderExecutionDecision.backend.mode') ?? [] })
        .toEqual({ label, modes: expect.arrayContaining(["readonly mode: 'scene';", "readonly mode: 'family-svg';"]) })
      expect({ label, verify: (members.get('mermaid.verifyMermaid()') ?? []).map(text => text.startsWith('verifyMermaid(input: ParsedDiagram | string, opts?: {') && text.endsWith('): VerifyResult;')) })
        .toEqual({ label, verify: [true] })
      expect({ label, missingSharedFields: SHARED_RENDER_OPTION_FIELDS.filter(field => !(members.get(`SharedRenderOptions.${field}`) ?? []).some(text => text.startsWith(`${field}?:`))) })
        .toEqual({ label, missingSharedFields: [] })
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
