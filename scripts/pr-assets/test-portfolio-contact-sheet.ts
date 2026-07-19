#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderMermaidSVG } from '../../src/index.ts'
import { buildContactSheetPlan, type ContactSheetKind } from '../../src/__tests__/helpers/render-conformance-plan.ts'

const CONTACT_SHEET_VERSION = 1
const args = process.argv.slice(2)
const valueAfter = (flag: string): string | undefined => {
  const index = args.indexOf(flag)
  return index < 0 ? undefined : args[index + 1]
}
const kind = (valueAfter('--kind') ?? 'citizenship') as ContactSheetKind
if (!['change', 'citizenship', 'interaction', 'outlier'].includes(kind)) throw new Error(`Unknown --kind ${kind}`)
const outputDirectory = resolve(valueAfter('--output-dir') ?? '/tmp/agentic-mermaid-test-portfolio')
const changedRowIds = args.flatMap((arg, index) => arg === '--row-id' ? [args[index + 1]!] : [])
const beforeHtmlPath = valueAfter('--before-html')
if (kind === 'change' && !beforeHtmlPath) throw new Error('A change sheet requires --before-html <previous-sheet.html>')
const beforeHtml = beforeHtmlPath ? readFileSync(resolve(beforeHtmlPath), 'utf8') : undefined
const check = args.includes('--check')
const htmlPath = join(outputDirectory, `${kind}.html`)
const manifestPath = join(outputDirectory, `${kind}.manifest.json`)
const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const rows = buildContactSheetPlan(kind, changedRowIds)
const renderedRows = rows.map(row => {
  const svg = renderMermaidSVG(row.source, row.options)
  const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/u.exec(svg)
  if (!viewBox) throw new Error(`${row.id} has no finite origin-zero viewBox`)
  return { row, svg, width: Number(viewBox[1]), height: Number(viewBox[2]) }
})
const beforeSvgFor = (rowId: string): string | undefined => {
  if (!beforeHtml) return undefined
  const escaped = rowId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`<article id="${escaped}"[^>]*>[\\s\\S]*?<div class="visual">([\\s\\S]*?)</div><dl>`, 'u').exec(beforeHtml)?.[1]
}
const cards = renderedRows.map(({ row, svg, width, height }) => {
  const changed = changedRowIds.includes(row.id)
  const beforeSvg = changed ? beforeSvgFor(row.id) : undefined
  if (changed && !beforeSvg) throw new Error(`Previous sheet has no before cell for ${row.id}`)
  const visual = changed
    ? `<div class="comparison"><section><h3>Before</h3><div class="visual">${beforeSvg}</div></section><section><h3>After</h3><div class="visual">${svg}</div></section></div>`
    : `<div class="visual">${svg}</div>`
  return `<article id="${row.id}" data-comparison-role="${changed ? 'changed' : 'control'}"><header><strong>${escapeHtml(row.family)}</strong><code>${row.id}</code></header>${visual}<dl><dt>Source</dt><dd>${escapeHtml(row.sourceId)}</dd><dt>Complexity</dt><dd>${row.complexity}</dd><dt>Style</dt><dd>${escapeHtml(row.look)} + ${escapeHtml(row.palette)}</dd><dt>Projection</dt><dd>${row.backend} · ${row.background} · ${row.security}</dd><dt>Native size</dt><dd>${width} × ${height}</dd></dl><details><summary>Authored Mermaid</summary><pre>${escapeHtml(row.source)}</pre></details></article>`
}).join('\n')
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Agentic Mermaid ${kind} contact sheet</title><style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#e4e4e7;color:#18181b;font:14px/1.4 system-ui,sans-serif}h1{margin:0}.instructions{max-width:1000px;margin:8px 0 24px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}article{background:#fff;border:1px solid #a1a1aa;border-radius:10px;overflow:hidden}header{display:flex;justify-content:space-between;padding:10px 12px;background:#f4f4f5}.visual{height:420px;padding:12px;display:flex;align-items:center;justify-content:center;overflow:auto}.visual svg{max-width:100%;max-height:100%}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#a1a1aa}.comparison section{background:#fff}.comparison h3{margin:0;padding:6px 10px;background:#f4f4f5}.comparison .visual{height:360px}dl{display:grid;grid-template-columns:max-content 1fr;gap:3px 10px;margin:0;padding:10px 12px;border-top:1px solid #e4e4e7}dt{font-weight:700}dd{margin:0}details{border-top:1px solid #e4e4e7;padding:8px 12px}pre{white-space:pre-wrap;overflow:auto}@media(max-width:900px){.grid,.comparison{grid-template-columns:1fr}}
</style><main><h1>${kind} contact sheet</h1><p class="instructions">Probe → sense → respond. Scan the whole sheet for patterns and outliers, then inspect changed/high-risk cells at native size. This artifact is a bounded visual sanity check, not proof about unrendered combinations.</p><div class="grid">${cards}</div></main></html>\n`
const manifest = {
  schemaVersion: CONTACT_SHEET_VERSION,
  kind,
  selectionAlgorithm: 'registry-derived-diversity-v1',
  baselineCommit: 'cb2412b15b48ae41e55ace80f613be3723072d49',
  rowCount: rows.length,
  html: `${kind}.html`,
  htmlSha256: sha256(html),
  rows: renderedRows.map(({ row, width, height }) => ({
    id: row.id,
    comparisonRole: changedRowIds.includes(row.id) ? 'changed' : 'control',
    beforeSvgSha256: changedRowIds.includes(row.id) ? sha256(beforeSvgFor(row.id)!) : undefined,
    family: row.family,
    sourceId: row.sourceId,
    sourceSha256: sha256(row.source),
    complexity: row.complexity,
    look: row.look,
    palette: row.palette,
    backend: row.backend,
    background: row.background,
    security: row.security,
    format: 'svg',
    width,
    height,
  })),
}
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`

if (check) {
  if (!existsSync(htmlPath) || !existsSync(manifestPath)) throw new Error(`Missing ${kind} contact sheet under ${outputDirectory}`)
  if (readFileSync(htmlPath, 'utf8') !== html || readFileSync(manifestPath, 'utf8') !== manifestText) {
    throw new Error(`${kind} contact sheet is stale; regenerate without --check`)
  }
  console.log(`${kind} contact sheet is synchronized (${rows.length} cells)`)
} else {
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(htmlPath, html)
  writeFileSync(manifestPath, manifestText)
  console.log(`wrote ${htmlPath} and ${manifestPath} (${rows.length} cells)`)
}
