#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { renderMermaidSVG, verifyNoExternalRefs } from '../../src/index.ts'
import { filesUnder, hashFileTree, repositoryPath, sha256File, sortRepositoryPaths } from './artifact-receipt.ts'

const ROOT = join(import.meta.dir, '..', '..')
const MANIFEST = join(ROOT, 'eval', 'mermaid-doc-showcase', 'manifest.json')
const RECEIPT = join(ROOT, 'eval', 'mermaid-doc-showcase', 'gallery-receipt.json')
const OUTPUT = join(ROOT, 'docs', 'design', 'families', 'mermaid-doc-examples-all-families.png')
const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

type Entry = { family: string; title: string; officialDocs: string; origin: string; index: number; source: string }
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { mermaidVersion: string; cases: Entry[] }
const repoPath = (path: string): string => repositoryPath(ROOT, path)
const inputPaths = sortRepositoryPaths(ROOT, [MANIFEST, join(ROOT, 'package.json'), join(ROOT, 'bun.lock'), import.meta.filename, join(import.meta.dir, 'artifact-receipt.ts'), ...filesUnder(join(ROOT, 'src'), path => path.endsWith('.ts'))])
const currentReceipt = () => ({
  schemaVersion: 1,
  generator: repoPath(import.meta.filename),
  inputCount: inputPaths.length,
  inputTreeSha256: hashFileTree(ROOT, inputPaths),
  output: repoPath(OUTPUT),
  outputSha256: sha256File(OUTPUT),
})

if (process.argv.includes('--check')) {
  const recorded = JSON.parse(readFileSync(RECEIPT, 'utf8'))
  if (JSON.stringify(recorded) !== JSON.stringify(currentReceipt())) {
    throw new Error('Mermaid-doc showcase gallery is stale; run bun run gallery:mermaid-docs')
  }
  console.log('Mermaid-doc showcase gallery is synchronized')
  process.exit(0)
}

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cards = manifest.cases.map(entry => {
  const svg = renderMermaidSVG(entry.source, { embedFontImport: false })
  if (verifyNoExternalRefs(svg).ok === false) throw new Error(`${entry.family}: external SVG reference`)
  return `<article>
    <header><h2>${escapeHtml(entry.family)}</h2><p>${escapeHtml(entry.title)} · <code>${escapeHtml(entry.origin)}#${entry.index}</code></p></header>
    <div class="visual">${svg}</div>
    <footer>Official Mermaid ${manifest.mermaidVersion} docs example · rendered by Agentic Mermaid</footer>
  </article>`
}).join('')

const browser = await chromium.launch({ headless: true, ...(existsSync(localChrome) ? { executablePath: localChrome } : {}) })
const page = await browser.newPage({ viewport: { width: 1840, height: 3800 }, deviceScaleFactor: 1 })
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif}
  main{width:1800px;margin:20px;padding:26px;background:white;border:1px solid #d4d4d8;border-radius:18px}
  h1{margin:0 0 6px;font-size:30px}.subtitle{margin:0 0 20px;color:#52525b;font-size:15px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  article{border:1px solid #d4d4d8;border-radius:12px;overflow:hidden;background:#fff;display:grid;grid-template-rows:auto 370px auto}
  header{padding:12px 16px 8px;border-bottom:1px solid #e4e4e7}h2{margin:0 0 4px;text-transform:capitalize;font-size:18px}
  p{margin:0;color:#52525b;font-size:12px}code{font:11px ui-monospace,SFMono-Regular,Menlo,monospace}
  .visual{display:flex;align-items:center;justify-content:center;padding:12px;overflow:hidden}
  .visual svg{display:block;max-width:100%!important;width:100%!important;max-height:346px!important;height:auto!important}
  footer{border-top:1px solid #e4e4e7;padding:8px 14px;color:#3f3f46;background:#fafafa;font:11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace}
</style><main><h1>All supported families — official Mermaid documentation examples</h1>
<p class="subtitle">The authored source for every card is pinned to Mermaid ${manifest.mermaidVersion} documentation; only the renderer is Agentic Mermaid.</p>
<div class="grid">${cards}</div></main>`)
await page.locator('main').screenshot({ path: OUTPUT })
await page.close()
await browser.close()
writeFileSync(RECEIPT, `${JSON.stringify(currentReceipt(), null, 2)}\n`)
console.log(`wrote ${OUTPUT}`)
