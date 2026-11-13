// Diagnostic source variant only; production files and limits stay unchanged.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const forceGlobal = process.argv.includes('--force-global')
const omitPending = process.argv.includes('--omit-pending')
const recoverAnchor = process.argv.includes('--recover-anchor')
const actualHeader = process.argv.includes('--actual-header')
const trace = process.argv.includes('--trace')
const out = import.meta.dir + (actualHeader ? omitPending ? '/actual-header-pending-anchor' : '/actual-header-only' : forceGlobal ? '/forced-global' : omitPending ? recoverAnchor ? '/omit-pending-recover-anchor' : '/omit-pending' : recoverAnchor ? '/recover-anchor' : trace ? '/recursive-trace' : '/recursive-baseline')
mkdirSync(out, { recursive: true })
if (forceGlobal || omitPending || recoverAnchor || actualHeader || trace) Bun.plugin({
  name: 'diagnostic-global-admission',
  setup(build) {
    build.onLoad({ filter: /\/native-nesting\.ts$/ }, args => {
      const source = readFileSync(args.path, 'utf8')
      if (!forceGlobal) return { contents: source, loader: 'ts' }
      const original = 'if (queued === subjects) return undefined'
      if (source.split(original).length !== 2) throw Error('Diagnostic admission site changed')
      return { contents: source.replace(original, '/* Diagnostic: force the existing global solve for an acyclic quotient. */'), loader: 'ts' }
    })
    build.onLoad({ filter: /\/compound-boundary-routes\.ts$/ }, args => {
      let source = readFileSync(args.path, 'utf8')
      if (omitPending) {
        const original = 'if (other === index || measured.visible === false || ancestorPlan?.connections.has(other)) continue'
        if (source.split(original).length !== 2) throw Error('Diagnostic peer obstacle site changed')
        source = source.replace(original, 'if (other === index || measured.visible === false || ancestorPlan?.connections.has(other) || lifted.has(other) && !completed.has(other)) continue')
      }
      if (recoverAnchor) {
        const original = "if (reason === 'agentic local cross-hierarchy visibility-expansion limit'"
        if (source.split(original).length !== 2) throw Error('Diagnostic decline owner changed')
        source = source.replace(original, "if (reason === 'cross-hierarchy route has no clear anchor' || reason === 'agentic local cross-hierarchy visibility-expansion limit'")
      }
      if (actualHeader) {
        const original = 'ancestorPlan || leafCount > 64 ? (headerGroups[group]!.headerHeight ?? headerGroups[group]!.padding.top) : groups[group]!.padding.top'
        if (source.split(original).length !== 2) throw Error('Diagnostic header owner changed')
        source = source.replace(original, '(headerGroups[group]!.headerHeight ?? headerGroups[group]!.padding.top)')
      }
      if (trace) {
        source = source.replace('let primaryVirtual = expanded', 'let primaryVirtual = expanded; let traceIndex = -1; (globalThis as any).__compoundStart = { input: structuredClone(input), placed: structuredClone(placed), owners: [...owners], lifted: [...lifted] }')
        source = source.replace('if (expanded + amount > expansionLimit)', '(globalThis as any).__compoundTrace.push({ event: "reserve", index: traceIndex, expanded, amount, expansionLimit }); if (expanded + amount > expansionLimit)')
        source = source.replace('const edge = input.edges[index]!, raw = placed.edges[index]!', 'traceIndex = index; (globalThis as any).__compoundTrace.push({event:"begin", index, expanded, primaryVirtual}); const edge = input.edges[index]!, raw = placed.edges[index]!')
        source = source.replace('if (grid.virtualVertices > remaining ||', ';(globalThis as any).__compoundTrace.push({event:"primary-grid", index, expanded, primaryVirtual, virtual:grid.virtualVertices}); if (grid.virtualVertices > remaining ||')
        source = source.replace('const finalPoints = points', ';(globalThis as any).__compoundTrace.push({event:"accepted",index,expanded,rescued:rescued.has(index)}); const finalPoints = points')
      }
      return { contents: source, loader: 'ts' }
    })
  },
})
const { renderMermaidSVGWithReceipt } = await import('/workspace/agentic-mermaid/src/index.ts')
const { parseMermaid } = await import('/workspace/agentic-mermaid/src/parser.ts')
const { layoutGraphSync } = await import('/workspace/agentic-mermaid/src/layout-engine.ts')
const { assessLayout, hardViolations } = await import('/workspace/agentic-mermaid/src/layout-rubric.ts')
const rows: unknown[] = []
for (const direction of ['TB', 'BT', 'LR', 'RL']) for (const variant of ['permutation', 'identity', 'two-groups']) {
  const groups = variant === 'two-groups' ? ['A', 'B'] : ['A', 'B', 'C']
  const first = variant === 'identity' ? [0, 1, 2, 3, 4] : [4, 2, 0, 3, 1]
  const second = variant === 'identity' ? [0, 1, 2, 3, 4] : [1, 3, 0, 4, 2]
  const source = ['flowchart ' + direction,
    ...groups.flatMap(g => ['subgraph Group' + g + '[Group ' + g + ']', ...Array.from({ length: 5 }, (_, i) => `${g}${i}[${g}${i}]`), 'end']),
    ...first.map((j, i) => `A${i} --> B${j}`),
    ...(groups.length > 2 ? second.map((j, i) => `B${i} --> C${j}`) : []),
  ].join('\n')
  const row: any = { direction, variant, source, forceGlobal }
  ;(globalThis as any).__compoundTrace = []
  try {
    const options = { graphLayout: { backend: 'agentic' as const, fallback: 'none' as const } }
    const product = renderMermaidSVGWithReceipt(source, options)
    writeFileSync(out + '/' + direction + '-' + variant + '.svg', product.svg)
    writeFileSync(out + '/' + direction + '-' + variant + '.product.json', JSON.stringify(product) + '\n')
    const graph = parseMermaid(source), positioned = layoutGraphSync(graph, options), rubric = assessLayout(graph, positioned)
    row.returned = true; row.proof = product.receipt.layoutCertification
    row.metrics = rubric.metrics; row.hardViolations = hardViolations(rubric)
    row.positioned = positioned
  } catch (e: any) { row.returned = false; row.error = { name: e.name, message: e.message, code: e.code, stack: e.stack } }
  if (trace) { row.trace = (globalThis as any).__compoundTrace; row.routeStart = (globalThis as any).__compoundStart }
  rows.push(row)
  writeFileSync(out + '/RESULTS.json', JSON.stringify(rows, null, 2) + '\n')
  console.log(JSON.stringify({ direction, variant, forceGlobal, returned: row.returned, proof: row.proof?.status, metrics: row.metrics, error: row.error?.message }))
}
