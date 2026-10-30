import { OP_SCHEMAS } from '../../src/agent/op-schema-definitions.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

// Runtime SDK text is emitted from authored TypeScript, never from the coarse
// JSON admission schemas. Output-only discovery summaries stay in sdk-decl.ts.
const root = resolve(import.meta.dir, '../..')
const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  skipLibCheck: true,
  noEmit: true,
}
const entries = ['src/agent/types.ts', 'src/shared/display-text.ts', 'src/shared/prepared-text.ts', 'src/shared/extension-identity.ts', 'src/agent/facts.ts', 'src/agent/create.ts', 'src/scene/resolved-types.ts']
const program = ts.createProgram(entries.map(path => resolve(root, path)), options)
const checker = program.getTypeChecker()
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
const renames = new Map([['MermaidGraph', 'FlowchartGraph'], ['RenderedLabelBounds', 'LayoutRect']])
const sourceReadonly = new Set(['SourceLocation', 'SourceMap', 'SourceMapSpans', 'SourcePreservationReceipt', 'ParseError'])
const primitives = new Map<string, ts.KeywordTypeSyntaxKind>([
  ['Finite', ts.SyntaxKind.NumberKeyword],
  ['NodeId', ts.SyntaxKind.StringKeyword], ['EdgeId', ts.SyntaxKind.StringKeyword],
  ['GroupId', ts.SyntaxKind.StringKeyword], ['ParticipantId', ts.SyntaxKind.StringKeyword],
])

type Declaration = ts.InterfaceDeclaration | ts.TypeAliasDeclaration
function resolveType(node: ts.Node): Declaration | undefined {
  let symbol = checker.getSymbolAtLocation(node)
  if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
  return symbol?.declarations?.find((declaration): declaration is Declaration =>
    (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration))
    && declaration.getSourceFile().fileName.startsWith(resolve(root, 'src') + '/'))
}

function rootDeclaration(path: string, name: string): Declaration {
  const file = program.getSourceFile(resolve(root, path))!
  const declaration = file.statements.find((statement): statement is Declaration =>
    (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && statement.name.text === name)
  if (!declaration) throw new Error(`Missing SDK source declaration ${path}:${name}`)
  return declaration
}

function declarations(roots: readonly Declaration[], external: ReadonlySet<string> = new Set(), compact = false): string {
  const selected = new Map<string, Declaration>()
  const collect = (declaration: Declaration): void => {
    const name = declaration.name.text
    if (selected.has(name) || external.has(name) || primitives.has(name)) return
    selected.set(name, declaration)
    const visit = (node: ts.Node): void => {
      if (name === 'ResolvedPart' && ts.isPropertySignature(node) && node.name && ['node', 'kind', 'role'].includes(node.name.getText())) return
      if (ts.isTypeReferenceNode(node)) {
        const target = resolveType(node.typeName)
        if (target) collect(target)
      } else if (ts.isExpressionWithTypeArguments(node)) {
        const target = resolveType(node.expression)
        if (target) collect(target)
      } else if (ts.isImportTypeNode(node) && node.qualifier) {
        const target = resolveType(node.qualifier)
        if (target) collect(target)
      }
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(declaration, visit)
  }
  roots.forEach(collect)
  return [...selected.values()].map(declaration => {
    const readonlySource = sourceReadonly.has(declaration.name.text)
    const transform: ts.TransformerFactory<ts.Node> = context => {
      const visit: ts.Visitor = node => {
        if (declaration.name.text === 'ResolvedPart' && ts.isPropertySignature(node) && node.name && ['node', 'kind', 'role'].includes(node.name.getText())) {
          return ts.factory.updatePropertySignature(node, node.modifiers, node.name, node.questionToken, ts.factory.createKeywordTypeNode(node.name.getText() === 'node' ? ts.SyntaxKind.UnknownKeyword : ts.SyntaxKind.StringKeyword))
        }
        if (ts.isTypeQueryNode(node)) {
          const type = checker.getTypeAtLocation(node)
          if (type.isNumberLiteral()) return ts.factory.createLiteralTypeNode(ts.factory.createNumericLiteral(type.value))
        }
        // Initial discovery intentionally exposes only the compact check spec;
        // field types still come from the canonical authored interface.
        if (compact && ts.isInterfaceDeclaration(node) && node.name.text === 'CheckMermaidObjectSpec') {
          return ts.factory.updateInterfaceDeclaration(node, node.modifiers, node.name, node.typeParameters, node.heritageClauses,
            node.members.filter(member => member.name && ['include', 'exclude', 'exact'].includes(member.name.getText(node.getSourceFile()))))
        }
        if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
          const primitive = primitives.get(node.typeName.text)
          if (primitive !== undefined) return ts.factory.createKeywordTypeNode(primitive)
          if (readonlySource && node.typeName.text === 'Map') return ts.factory.updateTypeReferenceNode(node, ts.factory.createIdentifier('ReadonlyMap'), node.typeArguments ? ts.factory.createNodeArray(node.typeArguments.map(argument => ts.visitNode(argument, visit) as ts.TypeNode)) : undefined)
        }
        if (ts.isImportTypeNode(node) && node.qualifier) {
          return ts.factory.createTypeReferenceNode(node.qualifier, node.typeArguments ? ts.factory.createNodeArray(node.typeArguments.map(argument => ts.visitNode(argument, visit) as ts.TypeNode)) : undefined)
        }
        if (ts.isIdentifier(node) && renames.has(node.text)) return ts.factory.createIdentifier(renames.get(node.text)!)
        if (readonlySource && ts.isPropertySignature(node)) {
          return ts.factory.updatePropertySignature(node, [ts.factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)], node.name, node.questionToken, ts.visitNode(node.type, visit) as ts.TypeNode | undefined)
        }
        return ts.visitEachChild(node, visit, context)
      }
      return node => ts.visitNode(node, visit)!
    }
    const transformed = ts.transform<ts.Node>(declaration, [transform])
    const output = printer.printNode(ts.EmitHint.Unspecified, transformed.transformed[0]!, declaration.getSourceFile())
      .replace(/^export /, '')
    transformed.dispose()
    return output
  }).join('\n')
}

const commonRoots = ['ExternalFamilyId', 'SourceLocation', 'SourceMap', 'SourceMapSpans', 'SourceSpanPoint', 'SourceSpan', 'PreservedSourceSpans', 'SourcePreservationReceipt', 'ParseError', 'RenderedRegionKind', 'RenderedRegion', 'DiagramActionKind', 'DiagramActionSecurity', 'DiagramActionRecord', 'RenderedLabelBounds']
const commonDeclarations = [
  ...commonRoots.map(name => rootDeclaration('src/agent/types.ts', name)),
  rootDeclaration('src/shared/extension-identity.ts', 'ExtensionIdentity'),
  rootDeclaration('src/agent/facts.ts', 'CheckMermaidSpec'),
  rootDeclaration('src/agent/facts.ts', 'CheckMermaidResult'),
  rootDeclaration('src/agent/create.ts', 'CreateMermaidOptions'),
]
const common = declarations(commonDeclarations, new Set(['DiagramKind']))
const compactCommon = declarations(commonDeclarations, new Set(['DiagramKind']), true)
const text = declarations([
  ...['DisplayRun', 'PreparedDisplayText', 'LabelContent'].map(name => rootDeclaration('src/shared/display-text.ts', name)),
  rootDeclaration('src/shared/prepared-text.ts', 'PixelTextBlock'),
])
const models = declarations([
  rootDeclaration('src/agent/types.ts', 'DiagramBody'),
  rootDeclaration('src/agent/types.ts', 'AnyMutationOp'),
  // This public SDK name is not referenced by the body/operation roots.
  rootDeclaration('src/block/types.ts', 'Statement'),
], new Set(['DiagramKind', 'ExternalFamilyId', 'LabelContent', 'PixelTextBlock', 'MermaidRuntimeConfig', 'MermaidConfigMap', 'MermaidFrontmatterMap', 'C4Variant', 'Direction']))
// Output-only discovery keeps the Scene node opaque; painted primitives retain
// their canonical types without sending the entire internal Scene IR to agents.
const resolvedScene = declarations([rootDeclaration('src/scene/resolved-types.ts', 'ResolvedScene')])
const aliases = `\ntype SeqParticipantKind = SequenceParticipantKind\ntype SeqParticipant = SequenceParticipant\ntype SeqMessage = SequenceMessage\ntype SeqFragmentKind = SequenceFragmentKind\ntype SeqFragmentBranch = SequenceFragmentBranch\ntype SeqFragment = SequenceFragment\ntype GanttTaskTag = GanttBodyTaskTag\ntype GanttTask = GanttBodyTask\ntype GanttSection = GanttBodySection\n`
// Tokenize only the generated common fragment. String/template literal bytes
// remain intact while punctuation needs no whitespace in the compact prompt.
function compactDeclaration(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source)
  const templates: number[] = []
  let output = '', previous = ''
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.CloseBraceToken && templates.length > 0) {
      if (templates.at(-1) === 0) {
        token = scanner.reScanTemplateToken(false)
        if (token === ts.SyntaxKind.TemplateTail) templates.pop()
      } else templates[templates.length - 1]!--
    } else if (token === ts.SyntaxKind.OpenBraceToken && templates.length > 0) templates[templates.length - 1]!++
    if (token === ts.SyntaxKind.TemplateHead) templates.push(0)
    const text = scanner.getTokenText()
    if (/[\w$]$/.test(previous) && /^[\w$]/.test(text)) output += ' '
    output += text
    previous = text
  }
  return output
}

const out = resolve(root, 'src/mcp/generated/sdk-types.ts')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, '// Generated by scripts/build/generate-sdk-declarations.ts from canonical TypeScript models.\n'
  + `export const SDK_COMMON_DECLARATIONS = ${JSON.stringify(common)}\n`
  + `export const SDK_COMMON_CORE_DECLARATIONS = ${JSON.stringify(compactDeclaration(compactCommon))}\n`
  + `export const SDK_RESOLVED_SCENE_DECLARATIONS = ${JSON.stringify(resolvedScene)}\n`
  + `export const SDK_TEXT_DECLARATIONS = ${JSON.stringify(text)}\n`
  + `export const SDK_MODEL_DECLARATIONS = ${JSON.stringify(models + aliases)}\n`)
console.log('generated SDK model declarations')

// Rendering paths need only the small operation-name menu, not the admission
// schemas and their explanatory notes. Both projections have one authored owner.
const kindsPath = resolve(root, 'src/agent/generated/mutation-op-kinds.ts')
mkdirSync(dirname(kindsPath), { recursive: true })
writeFileSync(kindsPath, '// Generated from OP_SCHEMAS by scripts/build/generate-sdk-declarations.ts.\n'
  + `import type { DiagramKind } from '../types.ts'\n`
  + `export const MUTATION_OPS_BY_FAMILY = ${JSON.stringify(Object.fromEntries(Object.entries(OP_SCHEMAS).map(([family, schema]) => [family, Object.keys(schema)])), null, 2)} as const satisfies Record<DiagramKind, readonly string[]>\n`)
