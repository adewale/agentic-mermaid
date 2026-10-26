import { describe, expect, test } from 'bun:test'
import ts from 'typescript'
import { CODE_MODE_CORE_RENDER_OPTION_DECLARATIONS, CODE_MODE_RENDER_OPTION_DECLARATIONS, CODE_MODE_SHARED_RENDER_OPTIONS_DECLARATION, SDK_DECLARATION } from '../mcp/sdk-decl.ts'
import { SDK_CORE_DECLARATION } from '../mcp/sdk-discovery.ts'
import { SHARED_RENDER_OPTION_FIELDS } from '../render-contract.ts'

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
  test.each([
    ['full', SDK_DECLARATION],
    ['core', SDK_CORE_DECLARATION],
  ])('a typed %s Code Mode client preserves advertised operation and read-back contracts', (label, declaration) => {
    const path = '/class-sdk-consumer.ts'
    const source = `${declaration}\n
const op = {
  kind: 'add_relation', from: 'Port', to: 'Service', relKind: 'lollipop',
  markerAt: 'both', fromKind: 'lollipop', toKind: 'aggregation', lineStyle: 'dashed',
} as const
const interfaceOp = { kind: 'add_interface', class: 'Service', label: 'Port', side: 'to' } as const
const c4 = mermaid.createMermaid('c4', {c4Variant:'C4Deployment'})
const builtC4 = mermaid.buildMermaid('c4', [], {c4Variant:'C4Container'})
declare const region: RenderedRegion
const covered: Array<{row:number;start:number;end:number}> | undefined = region.occludedCellSpans
declare const sourceMap: SourceMap
const nodeLocation: SourceLocation | undefined = sourceMap.nodes.get('A')
// @ts-expect-error Source locations are exposed through a read-only map facade.
sourceMap.nodes.set('A', { line: 1, col: 1 })
// @ts-expect-error Reading a location does not permit mutating source coordinates.
sourceMap.nodes.get('A')!.line = 2
const parsed = mermaid.parseRegisteredMermaid('classDiagram\\nclass Port\\nclass Service')
if (parsed.ok) {
  const diagram = mermaid.asClass(parsed.value)
  if (diagram) {
    const interfaceEdit = mermaid.mutate(diagram, interfaceOp)
    if (interfaceEdit.ok) mermaid.serializeMermaid(interfaceEdit.value)
    const edited = mermaid.mutate(diagram, op)
    if (edited.ok) mermaid.serializeMermaid(edited.value)
  }
}
${
  label === 'full'
    ? `
const typed: ClassMutationOp = op
const blockStatement: Statement = {
  id: 'A', label: 'A', width: 2, directions: ['LR'],
  children: [{ id: 'nested', width: 1, directions: ['TB'], children: [{ id: 'leaf' }] }],
}
const linkedBlocks: Statement = [{ id: 'A' }, { id: 'B', label: 'B' }]
const nestedDirections: string[] | undefined = blockStatement.children?.[0]?.directions
const statementWidth: number | undefined = blockStatement.width
// @ts-expect-error Block identities remain strings in either statement form.
const invalidBlockStatement: Statement = { id: 1 }
// @ts-expect-error Every linked-statement item must be a Block.
const invalidLinkedBlocks: Statement = [{ id: 'A' }, 1]
// @ts-expect-error Nested block directions are arrays of strings.
const invalidNestedDirections: Statement = { id: 'A', children: [{ id: 'B', directions: [1] }] }
// @ts-expect-error A block width is numeric.
const invalidStatementWidth: Statement = { id: 'A', width: '2' }
declare const relationship: ClassRelation
const shaft: 'solid' | 'dashed' | undefined = relationship.lineStyle
// A client can read literal/formatted runs without parsing the compatibility string again.
function visible(content: LabelContent | undefined): string | undefined {
  return content?.prepared.lines.map(line => line.map(run => run.text).join('')).join('\\n')
}
declare const flow: FlowchartGraph
declare const sequence: SequenceBody
const participant: SeqParticipant = sequence.participants[0]!
const participantKind: SeqParticipantKind = participant.kind
const scheduled: GanttTask = { id: 'launch', label: 'Launch', tags: ['active'], end: '2026-10-26' }
const scheduledTag: GanttTaskTag = scheduled.tags[0]!
const scheduleSection: GanttSection = { id: 'delivery', tasks: [scheduled] }
declare const er: ErBody
declare const uml: ClassBody
const displayed = [
  visible(flow.nodes.get('A')?.labelContent), visible(flow.edges[0]?.labelContent), visible(flow.subgraphs[0]?.labelContent),
  visible(sequence.participants[0]?.labelContent), visible(sequence.messages[0]?.textContent),
  visible(er.entities[0]?.labelContent), visible(er.relations[0]?.labelContent), visible(er.groups?.[0]?.labelContent),
  visible(uml.classes[0]?.labelContent), visible(uml.namespaces?.[0]?.labelContent), visible(uml.notes[0]?.textContent),
  visible(relationship.labelContent), visible(relationship.fromCardinalityContent), visible(relationship.toCardinalityContent),
]
const authored: string | undefined = relationship.labelContent?.authored
declare const mindmap: MindmapBody
declare const gitgraph: GitGraphBody
const mindmapLabels: string[] = mindmap.root.children.map(node => node.label)
const authoredCommit: string | undefined = gitgraph.commits[0]?.sourceId
const branchHead: string | undefined = gitgraph.branches[0]?.head
const statementKind: 'commit' | 'branch' | 'checkout' | 'merge' | 'cherry-pick' | undefined = gitgraph.statements[0]?.kind
const sourceStart: number | undefined = relationship.labelContent?.prepared.lines[0]?.[0]?.sourceStart
const fittedWidth: number | undefined = flow.nodes.get('A')?.labelBlock?.lineBlocks[0]?.width
`
    : ''
}
`
    const options: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    }
    const host = ts.createCompilerHost(options)
    const original = host.getSourceFile.bind(host)
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => (fileName === path ? ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true) : original(fileName, languageVersion, onError, shouldCreateNewSourceFile))
    const program = ts.createProgram([path], options, host)
    expect(ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([])
  })

  test('exposes lossless preservation spans and descriptor identity in both declarations', () => {
    for (const [label, declaration] of [
      ['full', SDK_DECLARATION],
      ['core', SDK_CORE_DECLARATION],
    ] as const) {
      const members = declaredMembers(declaration)
      for (const name of ['SourceSpanPoint', 'PreservedSourceSpans', 'SourceMapSpans']) {
        expect({ label, declared: members.has(`interface ${name}`) }, name).toEqual({ label, declared: true })
      }
      expectDeclared(
        members,
        {
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
        },
        label,
      )
    }
    expectDeclared(
      declaredMembers(SDK_DECLARATION),
      {
        'ValidDiagram.meta.wrapperSource': 'wrapperSource?: string;',
        'ValidDiagram.meta.droppedComments': 'droppedComments?: { text: string; line: number; }[];',
        'ClassRelation.markerAt': "markerAt?: 'from' | 'to' | 'both' | 'none';",
      },
      'full',
    )
  })

  test('uses one complete render-options and receipt authority in both declarations', () => {
    expect(SDK_DECLARATION).toContain(CODE_MODE_RENDER_OPTION_DECLARATIONS)
    expect(SDK_CORE_DECLARATION).toContain(CODE_MODE_CORE_RENDER_OPTION_DECLARATIONS)
    expect(SDK_DECLARATION).toContain(CODE_MODE_SHARED_RENDER_OPTIONS_DECLARATION)
    for (const [label, declaration] of [
      ['full', SDK_DECLARATION],
      ['core', SDK_CORE_DECLARATION],
    ] as const) {
      const members = declaredMembers(declaration)
      for (const name of ['RenderedRegion', 'DiagramActionRecord', 'RenderedLayout']) {
        expect({ label, declared: members.has(`interface ${name}`) }, name).toEqual({ label, declared: true })
      }
      expectDeclared(
        members,
        {
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
        },
        label,
      )
      expect({ label, modes: members.get('RenderExecutionDecision.backend.mode') ?? [] }).toEqual({ label, modes: expect.arrayContaining(["readonly mode: 'scene';", "readonly mode: 'family-svg';"]) })
      expect({ label, verify: (members.get('mermaid.verifyMermaid()') ?? []).map(text => text.startsWith('verifyMermaid(input: ParsedDiagram | string, opts?: {') && text.endsWith('): VerifyResult;')) }).toEqual({ label, verify: [true] })
      expect({ label, missingSharedFields: SHARED_RENDER_OPTION_FIELDS.filter(field => !(members.get(`SharedRenderOptions.${field}`) ?? []).some(text => text.startsWith(`${field}?:`))) }).toEqual({ label, missingSharedFields: [] })
      const parsed = ts.createSourceFile('code-mode-sdk.d.ts', declaration, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      expect((parsed as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics).toEqual([])
    }
  })

  test('declares structured fields populated by advertised mutation operations', () => {
    const parsed = ts.createSourceFile('code-mode-sdk.d.ts', SDK_DECLARATION, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const fields = (interfaceName: string): Set<string> => {
      const declaration = parsed.statements.find(statement => ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName)
      expect(declaration && ts.isInterfaceDeclaration(declaration)).toBe(true)
      if (!declaration || !ts.isInterfaceDeclaration(declaration)) return new Set()
      return new Set(declaration.members.flatMap(member => (member.name ? [member.name.getText(parsed)] : [])))
    }
    const expected: Record<string, string[]> = {
      FlowchartGraph: ['classDefs', 'classAssignments', 'nodeStyles', 'linkStyles'],
      StateNode: ['declaredBare', 'regions', 'className', 'style'],
      StateTransition: ['style'],
      StateBody: ['classDefs', 'defaultTransitionStyle', 'unresolvedClasses', 'unresolvedStyles'],
      ClassNode: ['className', 'style', 'isInterface'],
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
