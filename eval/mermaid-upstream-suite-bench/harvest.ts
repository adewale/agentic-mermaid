import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { extractMermaidBlocks } from '../family-usage/count.ts'

// This tool records source provenance. It neither executes upstream tests nor
// derives test expectations from Agentic Mermaid's implementation.
type Family = string
interface FamilyConfig { family: Family; files: Array<{ path: string; testBlocks: number }>; consideredBlocks: number; companionBench?: string }
interface TestBlock {
  family: Family; file: string; name: string; body: string; skipped: boolean
  offset: number; line: number; column: number
  extraction: { sources: string[]; unresolved: boolean; inputs: string[] }
}
interface HistoricalFixture { id: string; family: string; source: string; upstream: { blocks: string[] } }
interface HistoricalManifest { families: Array<{ family: string; consideredBlocks: number; importedCases: number; importedBlocks: number }> }

const ROOT = process.cwd()
const BENCH = join(ROOT, 'eval/mermaid-upstream-suite-bench')
const OUTPUT = resolve(process.env.MERMAID_HARVEST_OUTPUT_DIR ?? join(ROOT, 'bench-report/historical-harvest'))
const UPSTREAM = resolve(process.env.MERMAID_UPSTREAM_DIR ?? join(ROOT, '../upstream-mermaid'))
const UPSTREAM_REVISION = 'a2d9686451df7c4644a3eeca20535bbd4c5776b0'
const UPSTREAM_REPO = 'mermaid-js/mermaid'

const FAMILY_CONFIGS: Array<Omit<FamilyConfig, 'consideredBlocks' | 'files'> & { files: Array<{ path: string }> }> = [
  {
    family: 'flowchart',
    files: [
      { path: 'packages/mermaid/src/diagrams/flowchart/flowChartShapes.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/flowDb.spec.ts' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-arrows.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-comments.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-direction.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-edges.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-interactions.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-lines.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-md-string.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-node-data.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-singlenode.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-style.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-text.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-vertice-chaining.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/flow.spec.js' },
      { path: 'packages/mermaid/src/diagrams/flowchart/parser/subgraph.spec.js' },
    ],
  },
  {
    family: 'state',
    files: [
      { path: 'packages/mermaid/src/diagrams/state/parser/state-parser.spec.js' },
      { path: 'packages/mermaid/src/diagrams/state/parser/state-style.spec.js' },
      { path: 'packages/mermaid/src/diagrams/state/stateDb.spec.js' },
      { path: 'packages/mermaid/src/diagrams/state/stateDiagram-v2.spec.js' },
      { path: 'packages/mermaid/src/diagrams/state/stateDiagram.spec.js' },
    ],
  },
  {
    family: 'sequence',
    files: [{ path: 'packages/mermaid/src/diagrams/sequence/sequenceDiagram.spec.js' }],
    companionBench: 'src/__tests__/agent-mermaidseqbench.test.ts',
  },
  {
    family: 'class',
    files: [
      { path: 'packages/mermaid/src/diagrams/class/parser/class.spec.js' },
      { path: 'packages/mermaid/src/diagrams/class/classDiagram.spec.ts' },
      { path: 'packages/mermaid/src/diagrams/class/classTypes.spec.ts' },
    ],
  },
  {
    family: 'er',
    files: [
      { path: 'packages/mermaid/src/diagrams/er/parser/erDiagram.spec.js' },
      { path: 'packages/mermaid/src/diagrams/er/parser/subgraph.spec.js' },
      { path: 'packages/mermaid/src/diagrams/er/erDb.spec.js' },
    ],
  },
  {
    family: 'timeline',
    files: [{ path: 'packages/mermaid/src/diagrams/timeline/timeline.spec.js' }],
  },
  {
    family: 'gantt',
    files: [
      { path: 'packages/mermaid/src/diagrams/gantt/parser/gantt.spec.js' },
      { path: 'packages/mermaid/src/diagrams/gantt/ganttDb.spec.ts' },
    ],
    companionBench: 'eval/mermaid-gantt-bench/',
  },
  {
    family: 'journey',
    files: [
      { path: 'packages/mermaid/src/diagrams/user-journey/parser/journey.spec.js' },
      { path: 'packages/mermaid/src/diagrams/user-journey/journeyDb.spec.js' },
    ],
  },
  {
    family: 'architecture',
    files: [
      { path: 'packages/mermaid/src/diagrams/architecture/architecture.spec.ts' },
      { path: 'packages/mermaid/src/diagrams/architecture/architectureSeed.spec.ts' },
    ],
  },
  {
    family: 'xychart',
    files: [
      { path: 'packages/mermaid/src/diagrams/xychart/parser/xychart.jison.spec.ts' },
      { path: 'packages/mermaid/src/diagrams/xychart/xychartDb.spec.ts' },
    ],
  },
  {
    family: 'pie',
    files: [{ path: 'packages/mermaid/src/diagrams/pie/pie.spec.ts' }],
  },
  {
    family: 'quadrant',
    files: [
      { path: 'packages/mermaid/src/diagrams/quadrant-chart/parser/quadrant.jison.spec.ts' },
      { path: 'packages/mermaid/src/diagrams/quadrant-chart/quadrantDb.spec.ts' },
    ],
  },
  {
    family: 'radar',
    files: [{ path: 'packages/mermaid/src/diagrams/radar/radar.spec.ts' }],
  },
]

function main(): void {
  const git = (...args: string[]): string => execFileSync('git', ['-C', UPSTREAM, ...args], { encoding: 'utf8' }).trim()
  if (!existsSync(UPSTREAM)) throw new Error(`Set MERMAID_UPSTREAM_DIR to a clean checkout at ${UPSTREAM_REVISION}`)
  const actual = git('rev-parse', 'HEAD')
  if (actual !== UPSTREAM_REVISION || git('status', '--porcelain')) throw new Error(`Historical provenance requires a clean checkout at ${UPSTREAM_REVISION}; found ${actual}`)
  const blocks: TestBlock[] = []
  const configs = FAMILY_CONFIGS.map(config => {
    const files = config.files.map(file => {
      const definitions = extractTestBlocks(readFileSync(join(UPSTREAM, file.path), 'utf8'), config.family, file.path)
      blocks.push(...definitions)
      return { path: file.path, testBlocks: definitions.length }
    })
    return { ...config, files, consideredBlocks: files.reduce((sum, file) => sum + file.testBlocks, 0) }
  })
  if (process.argv.includes('--inventory-only')) {
    console.log(JSON.stringify(configs, null, 2))
    return
  }
  const fixtures = JSON.parse(readFileSync(join(BENCH, 'cases.json'), 'utf8')) as HistoricalFixture[]
  const historical = JSON.parse(readFileSync(join(BENCH, 'manifest.json'), 'utf8')) as HistoricalManifest
  const ratchet = JSON.parse(readFileSync(join(BENCH, 'ratchet.json'), 'utf8')) as unknown
  const companion = JSON.parse(readFileSync(join(BENCH, 'mindmap-gitgraph-f3dea583.json'), 'utf8')) as { upstream: unknown; accounting: unknown; blocks: unknown[] }
  const gantt = JSON.parse(readFileSync(join(ROOT, 'eval/mermaid-gantt-bench/cases.json'), 'utf8')) as Array<{ origin: string }>
  const byCitation = new Map<string, TestBlock[]>()
  const definitionId = (block: Pick<TestBlock, 'file' | 'offset'>): string => `${block.file}:${block.offset}`
  for (const block of blocks) {
    const key = `${block.file} :: ${block.name}`
    const rows = byCitation.get(key) ?? []
    rows.push(block); byCitation.set(key, rows)
  }
  const fixtureProvenance = fixtures.map(fixture => ({
    id: fixture.id, family: fixture.family,
    citations: fixture.upstream.blocks.map(citation => {
      const definitions = byCitation.get(citation) ?? []
      const matches = definitions.filter(block => block.extraction.sources.some(source => source.trim() === fixture.source.trim()))
      const path = citation.split(' :: ')[0]!
      const doc = /\.md$/.test(path) && existsSync(join(UPSTREAM, path))
        ? extractMermaidBlocks(readFileSync(join(UPSTREAM, path), 'utf8')).map((source, index) => ({ source, index })).filter(row => row.source.trim() === fixture.source.trim()).map(row => row.index + 1) : []
      const inputs = definitions.filter(block => block.extraction.inputs.some(source => source.trim() === fixture.source.trim()))
      const renamed = blocks.filter(block => block.file === path && block.extraction.sources.some(source => source.trim() === fixture.source.trim()))
      return { citation, definitions: definitions.map(definitionId), matchingSourceDefinitions: matches.map(definitionId),
        documentFences: doc, transformedInputDefinitions: inputs.map(definitionId), sameFileSourceDefinitions: renamed.map(definitionId),
        status: matches.length === 1 ? 'witnessed' : matches.length > 1 ? 'ambiguous-registration' : doc.length ? 'document-fence' : inputs.length ? 'transformed-input' : renamed.length ? 'different-title' : definitions.length ? 'no-matching-static-source' : 'unmatched-title' }
    }),
  }))
  const report = {
    upstream: { repo: UPSTREAM_REPO, revision: UPSTREAM_REVISION },
    method: 'TypeScript registration definitions and syntax-owned string arguments; transparent local wrappers; no execution, parser admission, assertions or pass counts',
    registrationDefinitions: blocks.length,
    recoveredArgumentValues: blocks.reduce((sum, block) => sum + block.extraction.sources.length, 0),
    unresolvedDefinitions: blocks.filter(block => block.extraction.unresolved).length,
    historicalCapture: { reportedBlocks: historical.families.reduce((sum, row) => sum + row.consideredBlocks, 0), fixtureCases: fixtures.length, ratchet },
    families: configs.map(config => ({ ...config, legacyReportedBlocks: historical.families.find(row => row.family === config.family)?.consideredBlocks,
      definitionsWithSources: blocks.filter(block => block.family === config.family && block.extraction.sources.length).length,
      unresolvedDefinitions: blocks.filter(block => block.family === config.family && block.extraction.unresolved).length })),
    companions: {
      gantt: { fixtures: gantt.length, byOrigin: Object.fromEntries([...new Set(gantt.map(row => row.origin))].sort().map(origin => [origin, gantt.filter(row => row.origin === origin).length])),
        provenance: 'Separate dated corpus; no exact Mermaid commit is declared by its README. Non-Mermaid origins are not Mermaid registration definitions.' },
      mindmapGitgraph: { upstream: companion.upstream, accounting: companion.accounting, recordedDefinitions: companion.blocks.length },
    },
    fixtureProvenance,
    definitions: blocks.map(({ body, ...block }) => ({ ...block, id: definitionId(block), containsRejectionAssertion: isNegativeTest(body) })),
  }
  mkdirSync(OUTPUT, { recursive: true })
  const outputPath = realpathSync(OUTPUT), ledgerPath = realpathSync(BENCH)
  const output = statSync(outputPath), ledger = statSync(ledgerPath)
  const within = relative(ledgerPath, outputPath)
  if (output.dev === ledger.dev && output.ino === ledger.ino || !isAbsolute(within) && within !== '..' && !within.startsWith(`..${sep}`)) throw new Error('Reconciliation output must be outside the historical fixture directory')
  writeJson(join(OUTPUT, 'reconciliation.json'), report)
  const witnessed = fixtureProvenance.filter(row => row.citations.every(citation => citation.status === 'witnessed')).length
  console.log(`${blocks.length} registration definitions; ${report.recoveredArgumentValues} recovered string arguments; ${report.unresolvedDefinitions} definitions with unresolved arguments.`)
  console.log(`${witnessed}/${fixtures.length} historical fixtures have a unique matching source witness for every citation. Other citations require review; this is not a feature or test-pass count.`)
  console.log(`Report: ${join(OUTPUT, 'reconciliation.json')}. Historical cases, expectations, exclusions, manifest and ratchet were not rewritten.`)
}

function extractTestBlocks(text: string, family: Family, file: string): TestBlock[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.Latest, allowJs: true, noLib: true, noResolve: true, noEmit: true }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = name => name === source.fileName ? source : undefined
  host.fileExists = name => name === source.fileName
  host.readFile = name => name === source.fileName ? source.text : undefined
  const program = ts.createProgram([source.fileName], options, host)
  const syntax = program.getSyntacticDiagnostics(source)
  if (syntax.length) throw new Error(`Cannot inventory invalid upstream syntax in ${file}: ${ts.flattenDiagnosticMessageText(syntax[0]!.messageText, '\n')}`)
  const checker = program.getTypeChecker()
  const written = new Set<ts.Symbol>()
  let dynamicScope = false
  const target = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const symbol = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node)
      if (symbol) written.add(symbol)
    }
    ts.forEachChild(node, target)
  }
  const writes = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) target(node.left)
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) target(node.operand)
    if (ts.isForInStatement(node) || ts.isForOfStatement(node)) target(node.initializer)
    if (ts.isWithStatement(node) || ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'eval') dynamicScope = true
    ts.forEachChild(node, writes)
  }
  writes(source)
  const blocks: TestBlock[] = []
  function registration(node: ts.Expression): { test: boolean; skipped: boolean } {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node)
      const binding = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
      if (binding && ts.isImportSpecifier(binding)) {
        const declaration = binding.parent.parent.parent
        const imported = binding.propertyName?.text ?? binding.name.text
        return { test: (imported === 'it' || imported === 'test') && ts.isImportDeclaration(declaration) && ts.isStringLiteral(declaration.moduleSpecifier) && ['vitest', '@jest/globals', 'bun:test'].includes(declaration.moduleSpecifier.text), skipped: false }
      }
      return { test: !binding && (node.text === 'it' || node.text === 'test'), skipped: false }
    }
    if (ts.isCallExpression(node)) return registration(node.expression)
    if (ts.isTaggedTemplateExpression(node)) return registration(node.tag)
    if (ts.isPropertyAccessExpression(node)) {
      const base = registration(node.expression)
      return { test: base.test, skipped: base.skipped || node.name.text === 'skip' || node.name.text === 'todo' }
    }
    return { test: false, skipped: false }
  }
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const kind = registration(node.expression)
      const callback = node.arguments.find(argument => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))
      const pending = ts.isPropertyAccessExpression(node.expression) && (node.expression.name.text === 'skip' || node.expression.name.text === 'todo')
      if (kind.test && (callback || pending) && node.arguments[0]) {
        const name = constantString(node.arguments[0]) ?? node.arguments[0].getText(source)
        const position = source.getLineAndCharacterOfPosition(node.getStart(source))
        blocks.push({ family, file, name, body: callback?.getText(source) ?? '', skipped: kind.skipped,
          offset: node.getStart(source), line: position.line + 1, column: position.character + 1,
          extraction: callback ? sourceLiterals(callback, source, checker, written, dynamicScope) : { sources: [], unresolved: false, inputs: [] } })
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return blocks
}

/** Evaluate only syntax-owned string constants. Never execute upstream code. */
function constantString(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isParenthesizedExpression(node)) return constantString(node.expression)
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantString(node.left), right = constantString(node.right)
    if (left !== undefined && right !== undefined) return left + right
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text
    for (const span of node.templateSpans) {
      const expression = constantString(span.expression)
      if (expression === undefined) return undefined
      value += expression + span.literal.text
    }
    return value
  }
  return undefined
}

/** Only actual source argument values can become candidate cases. Unknown
 * bindings, mutations, tags and dynamic expressions remain extraction limits. */
function sourceLiterals(body: ts.Node, source: ts.SourceFile, checker: ts.TypeChecker, written: ReadonlySet<ts.Symbol>, dynamicScope: boolean): TestBlock['extraction'] {
  const values = new Set<string>()
  const inputs = new Set<string>()
  type Arguments = ReadonlyMap<ts.Symbol, string | undefined>
  function evaluate(node: ts.Node, parameters: Arguments, active = new Set<ts.Node>()): string | undefined {
    if (active.has(node)) return undefined
    const next = new Set(active); next.add(node)
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node)
      if (symbol && parameters.has(symbol)) return parameters.get(symbol)
      const binding = symbol?.valueDeclaration
      if (!binding || !ts.isVariableDeclaration(binding) || !ts.isVariableDeclarationList(binding.parent)) return undefined
      const flags = binding.parent.flags
      if (!(flags & ts.NodeFlags.Const) && (!(flags & ts.NodeFlags.Let) || !symbol || written.has(symbol) || dynamicScope)) return undefined
      return binding.initializer && binding.getStart(source) < node.getStart(source) ? evaluate(binding.initializer, parameters, next) : undefined
    }
    if (ts.isParenthesizedExpression(node)) return evaluate(node.expression, parameters, next)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = evaluate(node.left, parameters, next), right = evaluate(node.right, parameters, next)
      return left !== undefined && right !== undefined ? left + right : undefined
    }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text
      for (const span of node.templateSpans) {
        const expression = evaluate(span.expression, parameters, next)
        if (expression === undefined) return undefined
        value += expression + span.literal.text
      }
      return value
    }
    return constantString(node)
  }
  let unresolved = false
  function stringTerm(node: ts.Node): boolean {
    if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true
    if (ts.isParenthesizedExpression(node)) return stringTerm(node.expression)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return stringTerm(node.left) && stringTerm(node.right)
    return ts.isTemplateExpression(node) && node.templateSpans.every(span => stringTerm(span.expression))
  }
  function callReference(node: ts.Node): boolean {
    return ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) && callReference(node.expression)
  }
  // A transparent wrapper is one call, optionally returned through a
  // zero-argument closure. No assignments, branches or other statements can
  // change the bound parameter before that source argument is consumed.
  function wrappedCall(node: ts.Node): ts.CallExpression | undefined {
    if (ts.isBlock(node)) return node.statements.length === 1 ? wrappedCall(node.statements[0]!) : undefined
    if (ts.isReturnStatement(node)) return node.expression ? wrappedCall(node.expression) : undefined
    if (ts.isExpressionStatement(node)) return wrappedCall(node.expression)
    if (ts.isParenthesizedExpression(node)) return wrappedCall(node.expression)
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node.parameters.length === 0 ? wrappedCall(node.body) : undefined
    return ts.isCallExpression(node) && callReference(node.expression) && node.arguments.every(stringTerm) ? node : undefined
  }
  function visit(node: ts.Node, parameters: Arguments, calls: ReadonlySet<ts.Node>): void {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) return
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)) return
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ''
      const argument = name === 'render' ? 1 : ['parse', 'fromText', 'draw', 'getDiagramFromText', 'preprocessDiagram', 'detectType'].includes(name) ? 0 : undefined
      const json = ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'JSON'
      const symbol = checker.getSymbolAtLocation(node.expression)
      const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
      const local = declaration && !ts.isImportSpecifier(declaration) && !ts.isImportClause(declaration) && !ts.isNamespaceImport(declaration)
      // Resolve a local callee before interpreting an API spelling: a helper
      // named parse/render can consume another argument or transform its input.
      if (local) {
        const helper = ts.isFunctionDeclaration(declaration) ? declaration
          : ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent)
            && declaration.parent.flags & ts.NodeFlags.Const && declaration.initializer
            && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) ? declaration.initializer : undefined
        // A reassigned function declaration no longer identifies the called
        // body. Never recover witnesses from that obsolete implementation.
        if (helper && (written.has(symbol!) || dynamicScope)) unresolved = true
        else if (helper?.body && !calls.has(helper)) {
          const parametersAreImmutable = helper.parameters.every(parameter => ts.isIdentifier(parameter.name)
            && !parameter.dotDotDotToken && !written.has(checker.getSymbolAtLocation(parameter.name)!)
            && (!parameter.initializer || stringTerm(parameter.initializer)))
          const call = parametersAreImmutable ? wrappedCall(helper.body) : undefined
          const bound = new Map(parameters)
          for (let index = 0; index < helper.parameters.length; index++) {
            const parameter = helper.parameters[index]!
            if (!ts.isIdentifier(parameter.name) || parameter.dotDotDotToken) continue
            const parameterSymbol = checker.getSymbolAtLocation(parameter.name)
            // Only a transparent call path permits argument substitution.
            // Other helpers expose their own closed literals, while their
            // mutable parameters remain unknown.
            if (parameterSymbol) bound.set(parameterSymbol, call ? node.arguments[index] ? evaluate(node.arguments[index]!, parameters) : parameter.initializer ? evaluate(parameter.initializer, bound) : undefined : undefined)
          }
          const next = new Set(calls); next.add(helper)
          visit(call ?? helper.body, bound, next)
        } else if (!helper?.body && argument !== undefined) unresolved = true
      } else if (argument !== undefined && !json) {
        const value = node.arguments[argument] ? evaluate(node.arguments[argument]!, parameters) : undefined
        if (value === undefined) {
          unresolved = true
          const origin = (expression: ts.Node): void => {
            if (ts.isCallExpression(expression)) for (const input of expression.arguments) {
              const text = evaluate(input, parameters)
              if (text !== undefined) inputs.add(text)
              else origin(input)
            }
          }
          if (node.arguments[argument]) origin(node.arguments[argument]!)
        }
        else values.add(value)
      }
    }
    ts.forEachChild(node, child => visit(child, parameters, calls))
  }
  visit(ts.isArrowFunction(body) || ts.isFunctionExpression(body) ? body.body : body, new Map(), new Set())
  return { sources: [...values], unresolved, inputs: [...inputs] }
}

function isNegativeTest(body: string): boolean {
  const source = ts.createSourceFile('upstream-assertions.ts', body, ts.ScriptTarget.Latest, true)
  const caught = new Set<string>(), asserted = new Set<string>()
  let negative = false
  function visit(node: ts.Node): void {
    if (ts.isCatchClause(node)) {
      function assignments(child: ts.Node): void {
        if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(child.left) && child.right.kind === ts.SyntaxKind.TrueKeyword) caught.add(child.left.text)
        ts.forEachChild(child, assignments)
      }
      assignments(node.block)
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const matcher = node.expression.name.text
      let receiver: ts.Expression = node.expression.expression
      let negated = false, rejects = false
      while (ts.isPropertyAccessExpression(receiver)) {
        negated ||= receiver.name.text === 'not'; rejects ||= receiver.name.text === 'rejects'
        receiver = receiver.expression
      }
      if (!negated && (matcher === 'toThrow' || matcher === 'toThrowError' || matcher === 'throws' || rejects)) negative = true
      if (!negated && matcher === 'toBe' && node.arguments[0]?.kind === ts.SyntaxKind.TrueKeyword && ts.isCallExpression(receiver) && ts.isIdentifier(receiver.expression) && receiver.expression.text === 'expect' && receiver.arguments[0] && ts.isIdentifier(receiver.arguments[0])) asserted.add(receiver.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return negative || [...caught].some(name => asserted.has(name))
}

function writeJson(path: string, value: unknown): void {
  const scratch = mkdtempSync(join(dirname(path), '.harvest-'))
  try {
    const staged = join(scratch, basename(path))
    writeFileSync(staged, `${JSON.stringify(value, null, 2)}\n`)
    renameSync(staged, path)
  } finally { rmSync(scratch, { recursive: true, force: true }) }
}

main()
