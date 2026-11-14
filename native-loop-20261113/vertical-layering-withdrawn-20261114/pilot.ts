// Diagnostic source variant only; production files and limits stay unchanged.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const candidate = process.env.AM_VERTICAL_LAYERING === '1'
const sourceRoot = '/workspace/pr449-native-loop-20261113/path-order-implementation/build-candidate'
const out = import.meta.dir + (candidate ? '/candidate' : '/baseline')
mkdirSync(out, { recursive: true })
if (candidate) Bun.plugin({ name: 'vertical-complete-bundle-global-diagnostic', setup(build) {
  build.onLoad({filter: /\/native-nesting\.ts$/}, args => {
    let source = readFileSync(args.path, 'utf8')
    const original = "if (queued === subjects) return 'acyclic-quotient'"
    if (source.split(original).length !== 2) throw Error('Acyclic outcome owner changed')
    source = source.replace(original, `if (queued === subjects) {
      // Scratch admission only; original global placement/routing below is unchanged.
      if ((direction !== 'TB' && direction !== 'BT') || g < 2 || n - edgeCount < 2 || n !== g * (n - edgeCount)) return 'acyclic-quotient'
      const admissionPairs = 4 * n + 2 * g + 6 * edgeCount, admissionSlots = 2 * n + 2
      if (work.pairs < admissionPairs || work.arcs < admissionSlots) return 'acyclic-quotient'
      reserve(admissionPairs, admissionSlots)
      if (groups.some(group => (group.parent ?? -1) !== -1)
        || input.nodes.some((node, i) => owners[i]! < 0)
        || input.edges.some(edge => edge.visible === false || edge.label !== undefined || owners[edge.source] === owners[edge.target])) return 'acyclic-quotient'
      const incoming = new Uint8Array(n), outgoing = new Uint8Array(n)
      for (const edge of input.edges) {
        if (outgoing[edge.source] || incoming[edge.target]) return 'acyclic-quotient'
        outgoing[edge.source] = 1; incoming[edge.target] = 1
      }
      ;(globalThis as any).__verticalLayeringAdmissions = ((globalThis as any).__verticalLayeringAdmissions ?? 0) + 1
    }`)
    return {contents:source,loader:'ts'}
  })
}})
const { renderMermaidSVGWithReceipt } = await import('/workspace/pr449-native-loop-20261113/path-order-implementation/build-candidate/src/index.ts')
const rows: unknown[] = []
for (const direction of ['TB', 'BT']) for (const variant of ['permutation', 'identity']) {
  const groups = variant === 'two-groups' ? ['A', 'B'] : ['A', 'B', 'C']
  const first = variant === 'identity' ? [0, 1, 2, 3, 4] : [4, 2, 0, 3, 1]
  const second = variant === 'identity' ? [0, 1, 2, 3, 4] : [1, 3, 0, 4, 2]
  const source = ['flowchart ' + direction,
    ...groups.flatMap(g => ['subgraph Group' + g + '[Group ' + g + ']', ...Array.from({ length: 5 }, (_, i) => `${g}${i}[${g}${i}]`), 'end']),
    ...first.map((j, i) => `A${i} --> B${j}`),
    ...(groups.length > 2 ? second.map((j, i) => `B${i} --> C${j}`) : []),
  ].join('\n')
  const row: any = { direction, variant, source, candidate, options: {graphLayout:{backend:"agentic",fallback:"none"}} }
  ;(globalThis as any).__verticalLayeringAdmissions = 0
  try {
    const options = { graphLayout: { backend: 'agentic' as const, fallback: 'none' as const } }
    const product = renderMermaidSVGWithReceipt(source, options)
    writeFileSync(out + '/' + direction + '-' + variant + '.svg', product.svg)
    writeFileSync(out + '/' + direction + '-' + variant + '.product.json', JSON.stringify(product) + '\n')
    row.returned = true; row.proof = product.receipt.layoutCertification
    row.admissions = (globalThis as any).__verticalLayeringAdmissions
  } catch (e: any) { row.returned = false; row.error = { name: e.name, message: e.message, code: e.code, stack: e.stack } }
  rows.push(row)
  writeFileSync(out + '/RESULTS.json', JSON.stringify(rows, null, 2) + '\n')
  console.log(JSON.stringify({ direction, variant, candidate, admissions:row.admissions, returned: row.returned, proof: row.proof?.status, metrics: row.metrics, error: row.error?.message }))
}
