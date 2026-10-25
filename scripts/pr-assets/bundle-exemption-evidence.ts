/** Bun 1.4.2: bun reproduce-fix.ts [base-checkout] [fixed-checkout]
 * Synthetic late-writer fault; does not claim an ordinary-input producer bug.
 * Both checkouts need their frozen dependencies installed.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const out = resolve(process.argv[4] ?? dirname(fileURLToPath(import.meta.url)))
mkdirSync(out, { recursive: true })
process.env.AGENTIC_MERMAID_ELK_CACHE = '0'
const rows: any[] = []
for (const [variant, repo] of [
  ['base', resolve(process.argv[2] ?? resolve(out, '../../work/bundle-base'))],
  ['fixed', resolve(process.argv[3] ?? resolve(out, '../../work/bundle-investigation'))],
]) {
  const moduleAt = (file: string) => import(pathToFileURL(resolve(repo, file)).href)
  const [{ LAYOUT_PIPELINE }, renderer, agent] = await Promise.all([
    moduleAt('src/layout-engine.ts'), moduleAt('src/index.ts'), moduleAt('src/agent/index.ts'),
  ])
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  for (const direction of ['LR', 'RL', 'TD', 'BT']) {
    const source = `flowchart ${direction}\nA[Start] --> B[Done]`
    const clean = renderer.renderMermaidSVG(source, { embedFontImport: false })
    const pass = LAYOUT_PIPELINE.find((entry: any) => entry.id === 'separateEdgeLabelPills')!
    const run = pass.run
    let calls = 0
    pass.run = (context: any) => {
      run(context)
      if (context.edges.length !== 1) throw new Error('Expected one relationship')
      const edge = context.edges[0], a = edge.points[0], b = edge.points.at(-1)
      if (edge.points.length !== 2) throw new Error('Expected initially straight route')
      const horizontal = direction === 'LR' || direction === 'RL'
      const first = horizontal ? a.x + (b.x - a.x) / 3 : a.y + (b.y - a.y) / 3
      const second = horizontal ? a.x + (b.x - a.x) * 2 / 3 : a.y + (b.y - a.y) * 2 / 3
      edge.points = horizontal
        ? [a, { x: first, y: a.y }, { x: first, y: a.y + 12 }, { x: second, y: a.y + 12 }, { x: second, y: b.y }, b]
        : [a, { x: a.x, y: first }, { x: a.x + 12, y: first }, { x: a.x + 12, y: second }, { x: b.x, y: second }, b]
      const { straightened: _straightened, ...saved } = edge.routeCertificate
      edge.routeCertificate = { ...saved, invariant: 'bundle', bendCount: 4 }
      calls++
    }
    try {
      const result = renderer.renderMermaidSVGWithReceipt(source, { embedFontImport: false, layoutSafety: 'strict' })
      const verified = agent.verifyMermaid(source)
      const row = {
        variant, sha, direction, source, injectedCalls: calls,
        repairedToCleanSvg: result.svg === clean,
        strictStatus: result.receipt.layoutCertification?.status,
        verifyOk: verified.ok, warnings: verified.warnings,
        finalRoute: verified.layout.edges[0]?.path,
      }
      if (!calls || row.repairedToCleanSvg !== (variant === 'fixed') || row.finalRoute.length !== (variant === 'fixed' ? 2 : 6)) {
        throw new Error(`Unexpected result: ${JSON.stringify(row)}`)
      }
      rows.push(row)
      writeFileSync(resolve(out, `${variant}-${direction.toLowerCase()}.svg`), result.svg)
      if (direction === 'LR') {
        const { Resvg } = createRequire(resolve(repo, 'package.json'))('@resvg/resvg-js')
        writeFileSync(resolve(out, `${variant}.png`), new Resvg(result.svg, { background: 'white', fitTo: { mode: 'zoom', value: 2 } }).render().asPng())
      }
    } finally { pass.run = run }
  }
}
const report = {
  scope: 'Synthetic internal late-writer fault. No ordinary source that generates a false bundle claim has been established.',
  method: 'Same source and same six-point 12px dogleg, with truthful endpoints and bend count, injected at separateEdgeLabelPills in both immutable revisions. Public strict render and verify run with positioning caches disabled.',
  bun: Bun.version, rows,
}
writeFileSync(resolve(out, 'before-after.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
