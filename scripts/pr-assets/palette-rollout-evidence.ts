#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { renderMermaidSVG } from '../../src/index.ts'
import { wcagContrastRatio } from '../../src/shared/color-math.ts'
import { apcaContrast, minPairwiseDeltaEOK } from '../../src/shared/perceptual-color.ts'
import { filesUnder, hashFileTree, repositoryPath, sha256File, sortRepositoryPaths } from './artifact-receipt.ts'

type Family = 'xychart' | 'journey' | 'mindmap' | 'gitgraph'
interface EvidenceCase { id: string; family: Family; theme: 'github-light' | 'dracula'; source: string }
export interface PaletteMetrics {
  unique: number
  minDeltaEOK: number
  minWcagVsBackground: number
  minAbsApcaVsBackground: number
  violations: string[]
}
export interface CaseResult {
  id: string
  family: Family
  theme: string
  background: string
  colors: string[]
  metrics: PaletteMetrics
}
export interface BaselineFile {
  schemaVersion: 1
  commit: string
  cases: CaseResult[]
}

const ROOT = join(import.meta.dir, '..', '..')
const BASELINE_DIR = join(ROOT, 'eval', 'palette-rollout', 'baseline')
const BASELINE_JSON = join(BASELINE_DIR, 'baseline.json')
const REPORT = join(ROOT, 'eval', 'palette-rollout', 'report.json')
const CONTACT_SHEET = join(ROOT, 'docs', 'pr-assets', 'pr-179', 'palette-rollout-before-after.png')
const RECEIPT = join(ROOT, 'eval', 'palette-rollout', 'evidence-receipt.json')
const chromePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/opt/pw-browsers/chromium'].find(existsSync)

const FLOORS = { minDeltaEOK: 0.10, minWcagVsBackground: 1.25, minAbsApcaVsBackground: 15 } as const
const themes = ['github-light', 'dracula'] as const

const xychart = `xychart-beta
  title "Eight product signals"
  x-axis [Q1, Q2, Q3, Q4]
  y-axis "Score" 0 --> 10
  line [2, 4, 5, 7]
  line [5, 4, 6, 8]
  line [3, 6, 4, 7]
  line [7, 5, 8, 6]
  line [4, 7, 6, 9]
  line [8, 6, 7, 5]
  line [1, 3, 6, 8]
  line [6, 8, 5, 9]`

const journey = `journey
  title Eight-actor service journey
  section Discover
    Research: 4: Ada
    Interview: 3: Ben
    Synthesize: 4: Cy
    Prioritize: 2: Dee
  section Deliver
    Prototype: 5: Eve
    Review: 3: Fox
    Launch: 4: Gia
    Learn: 5: Hal`

const mindmap = `mindmap
  root((Portfolio))
    Discover
      Research
    Define
      Strategy
    Design
      Prototype
    Build
      Product
    Test
      Quality
    Launch
      Release
    Learn
      Insight
    Scale
      Growth`

const gitgraph = `gitGraph LR:
  commit id: "root"
  branch discover order: 1
  commit id: "d1"
  checkout main
  branch define order: 2
  commit id: "d2"
  checkout main
  branch design order: 3
  commit id: "d3"
  checkout main
  branch build order: 4
  commit id: "d4"
  checkout main
  branch test order: 5
  commit id: "d5"
  checkout main
  branch launch order: 6
  commit id: "d6"
  checkout main
  branch learn order: 7
  commit id: "d7"`

const sources: Record<Family, string> = { xychart, journey, mindmap, gitgraph }
const cases: EvidenceCase[] = (Object.keys(sources) as Family[]).flatMap(family =>
  themes.map(theme => ({ id: `${family}-${theme}`, family, theme, source: sources[family] })))

const round = (value: number): number => Math.round(value * 10_000) / 10_000
const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function backgroundFromSvg(svg: string): string {
  const bg = svg.match(/--bg:\s*(#[0-9a-f]{6})/i)?.[1]
  if (!bg) throw new Error('Evidence SVG does not expose a concrete --bg color')
  return bg.toLowerCase()
}

function indexedColors(matches: IterableIterator<RegExpMatchArray>, indexGroup: number, colorGroup: number): string[] {
  const colors = new Map<number, string>()
  for (const match of matches) colors.set(Number(match[indexGroup]), match[colorGroup]!.toLowerCase())
  return [...colors.entries()].sort((a, b) => a[0] - b[0]).map(([, color]) => color)
}

function paletteFromSvg(family: Family, svg: string): string[] {
  if (family === 'xychart') {
    return indexedColors(svg.matchAll(/--xychart-color-(\d+):\s*(#[0-9a-f]{6})/gi), 1, 2)
  }
  if (family === 'journey') {
    return indexedColors(svg.matchAll(/\.journey-actor-(\d+)\s*\{\s*fill:\s*(#[0-9a-f]{6})/gi), 1, 2)
  }
  if (family === 'mindmap') {
    const colors = new Map<number, string>()
    for (const tag of svg.matchAll(/<path class="mindmap-edge"[^>]+>/gi)) {
      const index = tag[0].match(/data-branch-index="(\d+)"/)?.[1]
      const color = tag[0].match(/stroke="(#[0-9a-f]{6})"/i)?.[1]
      if (index && color) colors.set(Number(index), color.toLowerCase())
    }
    return [...colors.entries()].sort((a, b) => a[0] - b[0]).map(([, color]) => color)
  }
  const colors: string[] = []
  for (const tag of svg.matchAll(/<line class="git-branch-line"[^>]+>/gi)) {
    const color = tag[0].match(/stroke="(#[0-9a-f]{6})"/i)?.[1]
    if (color) colors.push(color.toLowerCase())
  }
  return colors
}

function git(args: string[], root = ROOT): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

export function cleanHeadCommit(root = ROOT): string {
  const status = git(['status', '--porcelain=v1', '--untracked-files=all'], root)
  if (status.exitCode !== 0) {
    throw new Error(`Cannot inspect worktree before recording the palette baseline: ${status.stderr.trim()}`)
  }
  if (status.stdout.trim()) {
    throw new Error('Refusing to record a palette baseline from a dirty worktree; commit or stash every tracked and untracked change first')
  }
  const head = git(['rev-parse', '--verify', 'HEAD^{commit}'], root)
  const commit = head.stdout.trim()
  if (head.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`Cannot resolve HEAD to a full commit identity: ${head.stderr.trim()}`)
  }
  return commit
}

export function verifyBaselineCommit(commit: string, root = ROOT): void {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('Palette baseline commit must be a full lowercase Git commit identity')
  }
  const object = git(['cat-file', '-e', `${commit}^{commit}`], root)
  if (object.exitCode !== 0) {
    throw new Error(`Palette baseline commit ${commit} does not resolve to a commit in this repository`)
  }
  const ancestor = git(['merge-base', '--is-ancestor', commit, 'HEAD'], root)
  if (ancestor.exitCode === 1) {
    throw new Error(`Palette baseline commit ${commit} is not an ancestor of HEAD`)
  }
  if (ancestor.exitCode !== 0) {
    throw new Error(`Cannot verify palette baseline ancestry: ${ancestor.stderr.trim()}`)
  }
}

function measure(colors: string[], background: string): PaletteMetrics {
  const unique = new Set(colors).size
  const minDeltaEOK = minPairwiseDeltaEOK(colors)
  const minWcagVsBackground = Math.min(...colors.map(color => wcagContrastRatio(color, background) ?? 0))
  const minAbsApcaVsBackground = Math.min(...colors.map(color => Math.abs(apcaContrast(color, background) ?? 0)))
  const violations: string[] = []
  if (unique !== colors.length) violations.push(`unique ${unique}/${colors.length}`)
  if (minDeltaEOK + 1e-9 < FLOORS.minDeltaEOK) violations.push(`ΔE ${round(minDeltaEOK)} < ${FLOORS.minDeltaEOK}`)
  if (minWcagVsBackground + 1e-9 < FLOORS.minWcagVsBackground) violations.push(`WCAG ${round(minWcagVsBackground)} < ${FLOORS.minWcagVsBackground}`)
  if (minAbsApcaVsBackground + 1e-9 < FLOORS.minAbsApcaVsBackground) violations.push(`APCA ${round(minAbsApcaVsBackground)} < ${FLOORS.minAbsApcaVsBackground}`)
  return {
    unique,
    minDeltaEOK: round(minDeltaEOK),
    minWcagVsBackground: round(minWcagVsBackground),
    minAbsApcaVsBackground: round(minAbsApcaVsBackground),
    violations,
  }
}

function resultFromSvg(evidence: EvidenceCase, svg: string, label: string): CaseResult {
  const background = backgroundFromSvg(svg)
  const colors = paletteFromSvg(evidence.family, svg)
  if (colors.length !== 8) throw new Error(`${label} exposes ${colors.length} categorical colors; expected 8`)
  return {
    id: evidence.id,
    family: evidence.family,
    theme: evidence.theme,
    background,
    colors,
    metrics: measure(colors, background),
  }
}

function renderAll(): Array<{ evidence: EvidenceCase; svg: string; result: CaseResult }> {
  return cases.map(evidence => {
    const svg = renderMermaidSVG(evidence.source, { style: evidence.theme, embedFontImport: false, idPrefix: evidence.id })
    return {
      evidence,
      svg,
      result: resultFromSvg(evidence, svg, evidence.id),
    }
  })
}

const baselineSvgPath = (id: string): string => join(BASELINE_DIR, `${id}.svg`)
const repoPath = (path: string): string => repositoryPath(ROOT, path)

export function verifiedBaselineCases(baseline: BaselineFile, baselineDirectory = BASELINE_DIR): CaseResult[] {
  if (baseline.schemaVersion !== 1) throw new Error(`Unsupported palette baseline schema ${String(baseline.schemaVersion)}`)
  if (!/^[0-9a-f]{40}$/.test(baseline.commit)) throw new Error('Palette baseline commit must be a full lowercase Git commit identity')
  if (!Array.isArray(baseline.cases)) throw new Error('Palette baseline cases must be an array')

  const expectedSvgNames = cases.map(item => `${item.id}.svg`).sort()
  const actualSvgNames = readdirSync(baselineDirectory).filter(name => name.endsWith('.svg')).sort()
  if (JSON.stringify(actualSvgNames) !== JSON.stringify(expectedSvgNames)) {
    throw new Error(`Palette baseline SVG set does not match its ${cases.length} canonical evidence cases`)
  }

  const storedById = new Map<string, CaseResult>()
  for (const stored of baseline.cases) {
    if (storedById.has(stored.id)) throw new Error(`Palette baseline contains duplicate case ${stored.id}`)
    storedById.set(stored.id, stored)
  }
  if (storedById.size !== cases.length) {
    throw new Error(`Palette baseline contains ${storedById.size} cases; expected exactly ${cases.length}`)
  }

  const reconstructed = cases.map(evidence => {
    const path = join(baselineDirectory, `${evidence.id}.svg`)
    if (!existsSync(path)) throw new Error(`Palette baseline is missing frozen SVG ${repoPath(path)}`)
    const fromSvg = resultFromSvg(evidence, readFileSync(path, 'utf8'), `Frozen baseline ${evidence.id}`)
    const stored = storedById.get(evidence.id)
    if (!stored) throw new Error(`Palette baseline manifest is missing ${evidence.id}`)
    if (JSON.stringify(stored) !== JSON.stringify(fromSvg)) {
      throw new Error(`Palette baseline manifest metrics/colors for ${evidence.id} do not match its frozen SVG`)
    }
    return fromSvg
  })
  return reconstructed
}

function buildReport(currentCases: CaseResult[], baseline: BaselineFile, baselineCases: CaseResult[]) {
  const beforeById = new Map(baselineCases.map(item => [item.id, item]))
  const comparisons = currentCases.map(after => {
    const before = beforeById.get(after.id)
    if (!before) throw new Error(`Baseline is missing ${after.id}`)
    return {
      id: after.id,
      family: after.family,
      theme: after.theme,
      before: before.metrics,
      after: after.metrics,
      delta: {
        minDeltaEOK: round(after.metrics.minDeltaEOK - before.metrics.minDeltaEOK),
        minWcagVsBackground: round(after.metrics.minWcagVsBackground - before.metrics.minWcagVsBackground),
        minAbsApcaVsBackground: round(after.metrics.minAbsApcaVsBackground - before.metrics.minAbsApcaVsBackground),
      },
      improved: before.metrics.violations.length > after.metrics.violations.length,
    }
  })
  const beforeViolations = comparisons.reduce((sum, item) => sum + item.before.violations.length, 0)
  const afterViolations = comparisons.reduce((sum, item) => sum + item.after.violations.length, 0)
  return {
    schemaVersion: 1,
    baselineCommit: baseline.commit,
    contract: FLOORS,
    cases: currentCases,
    comparisons,
    summary: {
      caseCount: comparisons.length,
      beforeViolations,
      afterViolations,
      correctedCases: comparisons.filter(item => item.improved).length,
      passingCases: comparisons.filter(item => item.after.violations.length === 0).length,
      automaticVerdict: afterViolations === 0 && beforeViolations > afterViolations ? 'improvement' : 'not-an-improvement',
    },
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--record-baseline')) {
    const commit = cleanHeadCommit()
    const rendered = renderAll()
    mkdirSync(BASELINE_DIR, { recursive: true })
    for (const item of rendered) writeFileSync(baselineSvgPath(item.evidence.id), item.svg)
    const baseline: BaselineFile = { schemaVersion: 1, commit, cases: rendered.map(item => item.result) }
    writeFileSync(BASELINE_JSON, `${JSON.stringify(baseline, null, 2)}\n`)
    console.log(`Recorded palette baseline from ${commit}`)
    return
  }

  if (!existsSync(BASELINE_JSON)) throw new Error('Missing palette baseline; run bun run gallery:palette-rollout:baseline before changing palette code')
  const baseline = JSON.parse(readFileSync(BASELINE_JSON, 'utf8')) as BaselineFile
  verifyBaselineCommit(baseline.commit)
  // Frozen SVG bytes, not baseline.json, are the source of truth. Re-extract
  // every color and recompute every metric before building/checking evidence.
  const baselineCases = verifiedBaselineCases(baseline)

  const inputPaths = sortRepositoryPaths(ROOT, [
    join(ROOT, 'package.json'),
    join(ROOT, 'bun.lock'),
    import.meta.filename,
    join(import.meta.dir, 'artifact-receipt.ts'),
    BASELINE_JSON,
    ...cases.map(item => baselineSvgPath(item.id)),
    ...filesUnder(join(ROOT, 'src'), path => path.endsWith('.ts')),
  ])
  const currentReceipt = () => ({
    schemaVersion: 1,
    generator: repoPath(import.meta.filename),
    inputCount: inputPaths.length,
    inputTreeSha256: hashFileTree(ROOT, inputPaths),
    outputs: [REPORT, CONTACT_SHEET].map(path => ({ path: repoPath(path), sha256: sha256File(path) })),
  })

  if (process.argv.includes('--check')) {
    const rendered = renderAll()
    const expectedReport = buildReport(rendered.map(item => item.result), baseline, baselineCases)
    const recordedReport = JSON.parse(readFileSync(REPORT, 'utf8'))
    if (JSON.stringify(recordedReport) !== JSON.stringify(expectedReport)) {
      throw new Error('Palette rollout report is stale; run bun run gallery:palette-rollout')
    }
    const recordedReceipt = JSON.parse(readFileSync(RECEIPT, 'utf8'))
    if (JSON.stringify(recordedReceipt) !== JSON.stringify(currentReceipt())) {
      throw new Error('Palette rollout evidence is stale; run bun run gallery:palette-rollout')
    }
    if (expectedReport.summary.automaticVerdict !== 'improvement') throw new Error('Palette rollout does not clear the automatic improvement gate')
    console.log('Palette rollout evidence is synchronized and clears the improvement gate')
    return
  }

  const rendered = renderAll()
  const report = buildReport(rendered.map(item => item.result), baseline, baselineCases)
  mkdirSync(join(ROOT, 'eval', 'palette-rollout'), { recursive: true })
  mkdirSync(join(ROOT, 'docs', 'pr-assets', 'pr-179'), { recursive: true })
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`)

  const afterById = new Map(rendered.map(item => [item.evidence.id, item]))
  const beforeById = new Map(baselineCases.map(item => [item.id, item]))
  const metricCaption = (item: CaseResult): string =>
    `ΔE ${item.metrics.minDeltaEOK.toFixed(3)} · WCAG ${item.metrics.minWcagVsBackground.toFixed(2)} · APCA ${item.metrics.minAbsApcaVsBackground.toFixed(1)} · ${item.metrics.violations.length === 0 ? 'PASS' : item.metrics.violations.join(', ')}`
  const rows = cases.map(evidence => {
    const before = beforeById.get(evidence.id)!
    const after = afterById.get(evidence.id)!
    return `<section><header><h2>${escapeHtml(evidence.family)} · ${escapeHtml(evidence.theme)}</h2><p>Eight peer categories; inspect identity separation and background visibility.</p></header>
    <article><h3>Before · legacy family palette</h3><div class="visual">${readFileSync(baselineSvgPath(evidence.id), 'utf8')}</div><footer>${escapeHtml(metricCaption(before))}</footer></article>
    <article><h3>After · controlled {1,2,3}</h3><div class="visual">${after.svg}</div><footer>${escapeHtml(metricCaption(after.result))}</footer></article>
  </section>`
  }).join('')

  const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) })
  const page = await browser.newPage({ viewport: { width: 1900, height: 3600 }, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#e4e4e7;color:#18181b;font-family:Arial,sans-serif}main{width:1860px;margin:20px;background:white;border:1px solid #a1a1aa;border-radius:18px;overflow:hidden}main>header{padding:24px 28px 20px;background:#18181b;color:#fafafa}h1{margin:0 0 8px;font-size:32px}main>header p{margin:0;color:#d4d4d8;font-size:15px}section{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #d4d4d8;position:relative;padding-top:72px}section>header{position:absolute;inset:0 0 auto;padding:12px 20px;background:#fafafa;border-bottom:1px solid #e4e4e7}h2{display:inline;margin:0 12px 0 0;font-size:19px;text-transform:capitalize}section>header p{display:inline;margin:0;color:#52525b;font-size:13px}article{min-width:0;padding:12px 14px 14px}article+article{border-left:1px solid #d4d4d8}h3{margin:0 0 8px;font-size:14px}.visual{height:300px;display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid #e4e4e7;border-radius:8px;background:#fff}.visual svg{display:block;max-width:100%!important;max-height:294px!important;width:auto!important;height:auto!important}footer{margin-top:8px;padding:7px 9px;background:#f4f4f5;border-radius:6px;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}
</style><main><header><h1>Controlled categorical palette rollout · before / after</h1><p>Frozen baseline ${escapeHtml(baseline.commit.slice(0, 8))} · automatic gates: unique colors, ΔE_OK ≥ 0.10, WCAG ≥ 1.25, |APCA| ≥ 15</p></header>${rows}</main>`)
  await page.evaluate(() => document.fonts?.ready)
  await page.locator('main').screenshot({ path: CONTACT_SHEET })
  await page.close()
  await browser.close()
  writeFileSync(RECEIPT, `${JSON.stringify(currentReceipt(), null, 2)}\n`)
  if (report.summary.automaticVerdict !== 'improvement') {
    throw new Error(`Palette rollout failed its automatic improvement gate (${report.summary.afterViolations} remaining violations)`)
  }
  console.log(`Wrote ${repoPath(REPORT)} and ${repoPath(CONTACT_SHEET)}; ${report.summary.beforeViolations} → ${report.summary.afterViolations} violations`)
}

if (import.meta.main) await main()
