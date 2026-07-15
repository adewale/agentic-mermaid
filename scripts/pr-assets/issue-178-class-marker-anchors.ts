/**
 * Before/after evidence for issue #178 — class endpoint marker anchors.
 *
 * The same three minimal class diagrams are rendered from the rebased main
 * commit and the current tree, then captured in Chromium so SVG marker-start
 * `auto-start-reverse` semantics match the browser-facing artifact.
 *
 *   bun run scripts/pr-assets/issue-178-class-marker-anchors.ts
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { renderMermaidSVG } from '../../src/index.ts'
import { THEMES } from '../../src/theme.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'pr-assets')
const BEFORE_SHA = 'a8fb8194'

const CASES = [
  {
    caption: 'Composition — filled diamond',
    source: 'classDiagram\n  direction LR\n  Whole *-- Part',
  },
  {
    caption: 'Aggregation — hollow diamond',
    source: 'classDiagram\n  direction LR\n  Team o-- Member',
  },
  {
    caption: 'Lollipop — circle tangent',
    source: 'classDiagram\n  direction LR\n  Service ()-- Port',
  },
] as const

const THEME = THEMES['github-light']!
const chromePath = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/opt/pw-browsers/chromium',
].find(existsSync)

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderCurrent(source: string): string {
  return renderMermaidSVG(source, { ...THEME, embedFontImport: false })
}

function renderBefore(sources: readonly string[]): string[] {
  const worktree = join(tmpdir(), `agentic-mermaid-issue178-${Date.now()}`)
  rmSync(worktree, { recursive: true, force: true })
  execFileSync('git', ['worktree', 'add', '--detach', worktree, BEFORE_SHA], { cwd: ROOT, stdio: 'pipe' })
  try {
    const modules = join(worktree, 'node_modules')
    if (!existsSync(modules)) symlinkSync(join(ROOT, 'node_modules'), modules, 'dir')
    writeFileSync(join(worktree, 'issue-178-probe.ts'), `
      import { renderMermaidSVG } from './src/index.ts'
      import { THEMES } from './src/theme.ts'
      const sources = ${JSON.stringify(sources)}
      console.log(JSON.stringify(sources.map(source => renderMermaidSVG(source, {
        ...THEMES['github-light'],
        embedFontImport: false,
      }))))
    `)
    return JSON.parse(execFileSync('bun', ['issue-178-probe.ts'], {
      cwd: worktree,
      encoding: 'utf8',
      env: { ...process.env, BUN_OPTIONS: '' },
    }).trim()) as string[]
  } finally {
    execFileSync('git', ['worktree', 'remove', worktree, '--force'], { cwd: ROOT, stdio: 'pipe' })
  }
}

function sheet(kind: 'before' | 'after', subtitle: string, svgs: readonly string[]): string {
  const title = kind.toUpperCase()
  const rows = svgs.map((svg, index) => `
    <section class="card">
      <h2>${esc(CASES[index]!.caption)}</h2>
      <div class="diagram">${svg}</div>
    </section>`).join('')
  return `
    <article class="sheet ${kind}" data-kind="${kind}">
      <h1>${title} — issue #178</h1>
      <p>${esc(subtitle)}</p>
      <p>Inspect the marker where each relationship meets its owning class boundary.</p>
      <p class="fine">Real renderer SVG captured in Chromium; the magenta guide is computed from the routed endpoint.</p>
      ${rows}
    </article>`
}

mkdirSync(OUT_DIR, { recursive: true })
const before = renderBefore(CASES.map(testCase => testCase.source))
const after = CASES.map(testCase => renderCurrent(testCase.source))
function documentHtml(content: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: ${THEME.bg}; color: ${THEME.fg}; }
    body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { display: grid; gap: 24px; padding: 24px; width: max-content; }
    .sheet { width: 1040px; padding: 34px 48px 48px; background: ${THEME.bg}; }
    h1 { margin: 0 0 8px; font-size: 32px; line-height: 1.2; letter-spacing: .01em; }
    .before h1 { color: #9a3412; }
    .after h1 { color: #15803d; }
    p { margin: 6px 0; color: ${THEME.muted}; font-size: 18px; line-height: 1.35; }
    p.fine { font-size: 16px; }
    .card { margin-top: 20px; padding: 14px 18px 18px; border: 2px solid ${THEME.line}; border-radius: 16px; background: ${THEME.bg}; }
    h2 { margin: 0; font-size: 20px; line-height: 1.2; }
    .diagram { position: relative; width: 900px; margin-top: 10px; }
    .diagram > svg { display: block; width: 100%; height: auto; background: ${THEME.bg}; }
    .boundary-guide { position: absolute; inset-block: 0; width: 0; border-left: 2px dashed #c026d3; pointer-events: none; }
    .boundary-guide span { position: absolute; top: 4px; left: 7px; padding: 2px 5px; border-radius: 4px; background: #fdf4ff; color: #86198f; font-size: 12px; font-weight: 700; white-space: nowrap; }
  </style>
</head>
<body>
  <main>
    ${content}
  </main>
</body>
</html>`
}

const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) })
try {
  for (const [kind, subtitle, svgs] of [
    ['before', `rebased main ${BEFORE_SHA} — shapes intrude into class surfaces`, before],
    ['after', 'this branch — tips/tangent touch the boundary and shapes extend outward', after],
  ] as const) {
    // Keep each sheet in a separate document. SVG fragment identifiers are
    // document-scoped in browsers, so combining before and after would let the
    // duplicate class marker IDs resolve against the first sheet's resources.
    const page = await browser.newPage({ viewport: { width: 1120, height: 1800 }, deviceScaleFactor: 2 })
    await page.setContent(documentHtml(sheet(kind, subtitle, svgs)), { waitUntil: 'load' })
    await page.locator('.diagram').evaluateAll(diagrams => {
      for (const diagram of diagrams) {
        const carrier = diagram.querySelector<SVGPolylineElement>('.class-marker-overlay')
        const point = carrier?.points[0]
        const matrix = carrier?.getScreenCTM()
        if (!point || !matrix) throw new Error('class marker overlay endpoint is unavailable')
        const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix)
        const guide = document.createElement('div')
        guide.className = 'boundary-guide'
        guide.style.left = `${screenPoint.x - diagram.getBoundingClientRect().left}px`
        guide.innerHTML = '<span>class boundary</span>'
        diagram.append(guide)
      }
    })
    const file = `issue-178-class-marker-anchors-${kind}.png`
    const output = join(OUT_DIR, file)
    await page.locator(`[data-kind="${kind}"]`).screenshot({ path: output, animations: 'disabled' })
    await page.close()
    console.log(`wrote docs/pr-assets/${file} (${Math.round(statSync(output).size / 1024)} KB)`)
  }
} finally {
  await browser.close()
}
