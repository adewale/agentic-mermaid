#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { chromium } from 'playwright'
import { renderMermaidASCII, renderMermaidSVG } from '../../src/index.ts'
import { parseMermaid, serializeMermaid, verifyMermaid } from '../../src/agent/index.ts'
import { visualWidth } from '../../src/ascii/width.ts'

const ROOT = join(import.meta.dir, '..', '..')
const CORPUS = join(ROOT, 'eval', 'mindmap-gitgraph-content-corpus')
const OUT = join(ROOT, 'docs', 'design', 'families')
const RECEIPT = join(CORPUS, 'gallery-receipt.json')
const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const repositoryPath = (absolute: string): string => relative(ROOT, absolute).replaceAll('\\', '/')
const sha256 = (absolute: string): string => createHash('sha256').update(readFileSync(absolute)).digest('hex')
const typescriptFilesUnder = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name)
  if (entry.isDirectory()) return typescriptFilesUnder(path)
  return entry.isFile() && entry.name.endsWith('.ts') ? [path] : []
})
const inputPaths = (): string[] => [
  join(CORPUS, 'manifest.json'),
  join(CORPUS, 'fork-snapshot.json'),
  import.meta.filename,
  ...(['mindmap', 'gitgraph'] as const).flatMap(family =>
    readdirSync(join(CORPUS, family)).filter(name => name.endsWith('.mmd')).sort().map(name => join(CORPUS, family, name))),
  // Conservative by design: public render/verify/terminal APIs cross agent, ASCII,
  // Scene IR, theme, and shared helpers. Hash all TypeScript source so a transitive
  // renderer change can never leave a stale gallery receipt green.
  ...typescriptFilesUnder(join(ROOT, 'src')),
].sort((a, b) => repositoryPath(a).localeCompare(repositoryPath(b)))
const outputPaths = (): string[] => (['mindmap', 'gitgraph'] as const).map(family => join(OUT, `${family}-content-gallery.png`))
const receiptForCurrentFiles = () => ({
  schemaVersion: 1,
  generator: repositoryPath(import.meta.filename),
  inputs: inputPaths().map(path => ({ path: repositoryPath(path), sha256: sha256(path) })),
  outputs: outputPaths().map(path => ({ path: repositoryPath(path), sha256: sha256(path) })),
})

if (process.argv.includes('--check')) {
  const recorded = JSON.parse(readFileSync(RECEIPT, 'utf8'))
  const current = receiptForCurrentFiles()
  if (JSON.stringify(recorded) !== JSON.stringify(current)) {
    throw new Error('Mindmap/GitGraph gallery receipt is stale; run bun run gallery:mindmap-gitgraph')
  }
  console.log('Mindmap/GitGraph gallery receipt is synchronized')
  process.exit(0)
}

type Entry = { id: string; family: 'mindmap' | 'gitgraph'; file: string; scenario: string }
const manifest = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8')) as { cases: Entry[] }
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(localChrome) ? { executablePath: localChrome } : {}),
})

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

for (const family of ['mindmap', 'gitgraph'] as const) {
  const cards = manifest.cases.filter(entry => entry.family === family).map(entry => {
    const source = readFileSync(join(CORPUS, entry.file), 'utf8')
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(`${entry.id}: ${parsed.error}`)
    const canonical = serializeMermaid(parsed.value)
    const reparsed = parseMermaid(canonical)
    if (!reparsed.ok || serializeMermaid(reparsed.value) !== canonical) throw new Error(`${entry.id}: unstable canonical round-trip`)
    const svg = renderMermaidSVG(source, { embedFontImport: false })
    if (renderMermaidSVG(source, { embedFontImport: false }) !== svg) throw new Error(`${entry.id}: nondeterministic SVG`)
    const targetWidth = family === 'mindmap' ? 100 : 120
    const terminal = renderMermaidASCII(source, { targetWidth, colorMode: 'none' })
    if (Math.max(...terminal.split('\n').map(visualWidth)) > targetWidth) throw new Error(`${entry.id}: terminal width exceeded`)
    const verification = verifyMermaid(source)
    if (!verification.ok) throw new Error(`${entry.id}: verification failed`)
    const warnings = verification.warnings.map(warning => warning.code)
    return `<article>
      <header><h2>${escapeHtml(entry.id.replace(`${family}-`, '').replaceAll('-', ' '))}</h2><p>${escapeHtml(entry.scenario)}</p></header>
      <div class="visual">${svg}</div>
      <footer>${warnings.length > 0 ? `intentional stress warning: ${warnings.join(', ')}` : 'parse · round-trip · deterministic SVG · bounded terminal ✓'}</footer>
    </article>`
  }).join('')

  const title = family === 'mindmap' ? 'Mindmap real-content gallery' : 'GitGraph real-content gallery'
  const subtitle = family === 'mindmap'
    ? 'Official-doc shapes plus broad, deep, multilingual, organizational, and explicit tidy-tree content.'
    : 'Gitflow, CI/CD, long labels, many lanes, cherry-picks, Unicode, orientations, and transit-domain transfer.'
  // Real-content evidence must remain legible at review scale. A two-column
  // thumbnail grid made the 40-node Mindmap and 12-lane GitGraph look worse
  // than their actual geometry and hid label defects from reviewers.
  const columns = 1
  const visualHeight = family === 'gitgraph' ? 950 : 900
  const page = await browser.newPage({ viewport: { width: 1840, height: 7600 }, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif}
    main{width:1800px;margin:20px;padding:26px;background:white;border:1px solid #d4d4d8;border-radius:18px}
    h1{margin:0 0 6px;font-size:30px}.subtitle{margin:0 0 20px;color:#52525b;font-size:15px}
    .grid{display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:16px}
    article{border:1px solid #d4d4d8;border-radius:12px;overflow:hidden;background:#fff;display:grid;grid-template-rows:auto ${visualHeight}px auto}
    header{padding:14px 16px 8px;border-bottom:1px solid #e4e4e7}h2{margin:0 0 5px;text-transform:capitalize;font-size:17px}
    p{margin:0;color:#52525b;font-size:12px;line-height:1.35}.visual{display:flex;align-items:center;justify-content:center;padding:10px;overflow:hidden}
    .visual svg{display:block;max-width:100%!important;width:100%!important;max-height:${visualHeight - 20}px!important;height:auto!important}
    footer{border-top:1px solid #e4e4e7;padding:8px 14px;color:#3f3f46;background:#fafafa;font:11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace}
  </style><main><h1>${title}</h1><p class="subtitle">${subtitle} Same-source public rendering; semantic range, not pixel equivalence.</p><div class="grid">${cards}</div></main>`)
  await page.locator('main').screenshot({ path: join(OUT, `${family}-content-gallery.png`) })
  await page.close()
}

await browser.close()
writeFileSync(RECEIPT, `${JSON.stringify(receiptForCurrentFiles(), null, 2)}\n`)
console.log('wrote Mindmap/GitGraph real-content gallery artifacts and freshness receipt')
