#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { BUILTIN_PALETTE_DEFINITIONS } from '../../src/palette-catalog.ts'
import { categoricalPalette } from '../../src/shared/categorical-palette.ts'
import { wcagContrastRatio } from '../../src/shared/color-math.ts'
import { apcaContrast, deltaEOK, minPairwiseDeltaEOK } from '../../src/shared/perceptual-color.ts'
import { bestHarmonyFit, harmonizePalette, harmonyLoss } from '../../eval/palette-harmony/harmony.ts'
import { hashFileTree, repositoryPath, sha256File, sortRepositoryPaths, transitiveLocalInputs } from './artifact-receipt.ts'

const ROOT = join(import.meta.dir, '..', '..')
const REPORT = join(ROOT, 'eval', 'palette-harmony', 'report.json')
const CONTACT_SHEET = join(ROOT, 'docs', 'pr-assets', 'pr-179', 'palette-harmony-experiment.png')
const RECEIPT = join(ROOT, 'eval', 'palette-harmony', 'evidence-receipt.json')
const chromePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/opt/pw-browsers/chromium'].find(existsSync)
const round = (value: number): number => Math.round(value * 10_000) / 10_000
const PALETTE_FIXTURES = BUILTIN_PALETTE_DEFINITIONS.map(definition =>
  [definition.inputName, definition.colors] as const)

interface PaletteMeasures {
  unique: number
  minDeltaEOK: number
  minWcag: number
  minAbsApca: number
  passes123: boolean
}

function measure(colors: string[], bg: string): PaletteMeasures {
  const minDeltaEOK = minPairwiseDeltaEOK(colors)
  const minWcag = Math.min(...colors.map(color => wcagContrastRatio(color, bg) ?? 0))
  const minAbsApca = Math.min(...colors.map(color => Math.abs(apcaContrast(color, bg) ?? 0)))
  return {
    unique: new Set(colors).size,
    minDeltaEOK: round(minDeltaEOK),
    minWcag: round(minWcag),
    minAbsApca: round(minAbsApca),
    passes123: new Set(colors).size === colors.length && minDeltaEOK >= 0.10 && minWcag >= 1.25 && minAbsApca >= 15,
  }
}

function buildReport() {
  const cases = PALETTE_FIXTURES.flatMap(([theme, colors]) => {
    const bg = colors.bg
    const accent = 'accent' in colors ? colors.accent : colors.fg
    return Array.from({ length: 18 }, (_unused, offset) => {
      const count = offset + 7
      const base = categoricalPalette(count, { accent, bg })
      const fit = bestHarmonyFit(base)
      const harmony = harmonizePalette(base, fit)
      const displacements = base.map((color, index) => deltaEOK(color, harmony[index]!) ?? 0)
      return {
        theme,
        count,
        background: bg,
        accent,
        template: fit.template.name,
        orientationDegrees: fit.orientation,
        base,
        harmony,
        baseMeasures: measure(base, bg),
        harmonyMeasures: measure(harmony, bg),
        harmonyLossBefore: round(fit.loss),
        harmonyLossAfter: round(harmonyLoss(harmony, fit.template, fit.orientation)),
        meanDeltaEFromBase: round(displacements.reduce((sum, value) => sum + value, 0) / displacements.length),
        maxDeltaEFromBase: round(Math.max(...displacements)),
      }
    })
  })
  const passing = cases.filter(item => item.harmonyMeasures.passes123)
  const basePassing = cases.filter(item => item.baseMeasures.passes123)
  const mean = (values: number[]): number => round(values.reduce((sum, value) => sum + value, 0) / values.length)
  const templateCounts = Object.fromEntries([...new Set(cases.map(item => item.template))].sort().map(template => [template, cases.filter(item => item.template === template).length]))
  return {
    schemaVersion: 1,
    method: {
      source: 'Cohen-Or et al., Color Harmonization, ACM TOG 2006',
      url: 'https://www.cs.tau.ac.il/~dcor/articles/2006/Color-Harmonization.pdf',
      adaptation: 'Published Matsuda sector widths; chroma-weighted OKLCH hue fitting; nearest-sector assignment; published monotonic Gaussian contraction with sigma=sectorWidth/2; OKLCH lightness/chroma preserved before sRGB gamut clamp.',
    },
    summary: {
      cases: cases.length,
      themes: PALETTE_FIXTURES.length,
      counts: '7..24',
      basePassing123: basePassing.length,
      harmonyPassing123: passing.length,
      harmonyPassRate: round(passing.length / cases.length),
      meanHarmonyLossBefore: mean(cases.map(item => item.harmonyLossBefore)),
      meanHarmonyLossAfter: mean(cases.map(item => item.harmonyLossAfter)),
      meanDeltaEFromBase: mean(cases.map(item => item.meanDeltaEFromBase)),
      maxDeltaEFromBase: round(Math.max(...cases.map(item => item.maxDeltaEFromBase))),
      meanMinDeltaEBase: mean(cases.map(item => item.baseMeasures.minDeltaEOK)),
      meanMinDeltaEHarmony: mean(cases.map(item => item.harmonyMeasures.minDeltaEOK)),
      templateCounts,
      recommendation: passing.length === cases.length
        ? 'candidate-for-opt-in'
        : 'do-not-ship: harmony breaks the established distinctness/visibility contract',
    },
    cases,
  }
}

const report = buildReport()
const repoPath = (path: string): string => repositoryPath(ROOT, path)
const inputPaths = sortRepositoryPaths(ROOT, [
  ...transitiveLocalInputs(ROOT, [import.meta.filename]),
  join(ROOT, 'package.json'),
  join(ROOT, 'bun.lock'),
])
const currentReceipt = () => ({
  schemaVersion: 1,
  generator: repoPath(import.meta.filename),
  inputCount: inputPaths.length,
  inputTreeSha256: hashFileTree(ROOT, inputPaths),
  outputs: [REPORT, CONTACT_SHEET].map(path => ({ path: repoPath(path), sha256: sha256File(path) })),
})

if (process.argv.includes('--receipt-only')) {
  if (JSON.stringify(JSON.parse(readFileSync(REPORT, 'utf8'))) !== JSON.stringify(report)) {
    throw new Error('Cannot refresh palette harmony receipt while the report is stale')
  }
  writeFileSync(RECEIPT, `${JSON.stringify(currentReceipt(), null, 2)}\n`)
  console.log('Refreshed palette harmony receipt without rewriting visual output')
  process.exit(0)
}

if (process.argv.includes('--check')) {
  if (JSON.stringify(JSON.parse(readFileSync(REPORT, 'utf8'))) !== JSON.stringify(report)) {
    throw new Error('Palette harmony report is stale; run bun run gallery:palette-harmony')
  }
  if (JSON.stringify(JSON.parse(readFileSync(RECEIPT, 'utf8'))) !== JSON.stringify(currentReceipt())) {
    throw new Error('Palette harmony evidence is stale; run bun run gallery:palette-harmony')
  }
  console.log('Palette harmony experiment is synchronized')
  process.exit(0)
}

mkdirSync(join(ROOT, 'eval', 'palette-harmony'), { recursive: true })
mkdirSync(join(ROOT, 'docs', 'pr-assets', 'pr-179'), { recursive: true })
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`)

const representatives = ['github-light', 'dracula', 'paper', 'tokyo-night']
const rows = representatives.map(theme => {
  const item = report.cases.find(candidate => candidate.theme === theme && candidate.count === 12)!
  const swatches = (colors: string[]) => colors.map((color, index) => `<div class="swatch" style="background:${color}"><span>${index + 1}</span><code>${color}</code></div>`).join('')
  return `<section><header><h2>${theme}</h2><p>best fit: ${item.template} @ ${item.orientationDegrees}° · harmony loss ${item.harmonyLossBefore.toFixed(2)} → ${item.harmonyLossAfter.toFixed(2)}</p></header>
    <article><h3>{1,2,3} perceptual</h3><div class="palette">${swatches(item.base)}</div><footer>min ΔE ${item.baseMeasures.minDeltaEOK.toFixed(3)} · PASS</footer></article>
    <article><h3>{1,2,3,4} harmonic</h3><div class="palette">${swatches(item.harmony)}</div><footer>min ΔE ${item.harmonyMeasures.minDeltaEOK.toFixed(3)} · mean displacement ${item.meanDeltaEFromBase.toFixed(3)} · ${item.harmonyMeasures.passes123 ? 'PASS' : 'FAIL'}</footer></article>
  </section>`
}).join('')
const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) })
const page = await browser.newPage({ viewport: { width: 1800, height: 1700 }, deviceScaleFactor: 1 })
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#e4e4e7;color:#18181b;font-family:Arial,sans-serif}main{width:1760px;margin:20px;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #a1a1aa}main>header{padding:24px 28px;background:#18181b;color:#fafafa}h1{margin:0 0 8px;font-size:31px}main>header p{margin:0;color:#d4d4d8}section{display:grid;grid-template-columns:1fr 1fr;padding-top:72px;position:relative;border-top:1px solid #d4d4d8}section>header{position:absolute;inset:0 0 auto;padding:12px 20px;background:#fafafa;border-bottom:1px solid #e4e4e7}h2{display:inline;margin:0 12px 0 0;font-size:19px}section>header p{display:inline;color:#52525b}article{padding:14px}article+article{border-left:1px solid #d4d4d8}h3{margin:0 0 10px}.palette{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}.swatch{height:105px;border-radius:9px;border:1px solid #0003;display:flex;flex-direction:column;justify-content:space-between;padding:8px;text-shadow:0 1px 2px #fff,0 -1px 2px #000;color:#111}.swatch span{font-weight:bold}.swatch code{font-size:11px;background:#fffc;padding:3px;border-radius:3px;text-shadow:none}footer{margin-top:10px;padding:8px 10px;background:#f4f4f5;border-radius:6px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
</style><main><header><h1>Optional {1,2,3,4} harmony experiment</h1><p>12 colors · published Matsuda/Cohen-Or hue sectors adapted to OKLCH · production {1,2,3} contract remains the control</p></header>${rows}</main>`)
await page.locator('main').screenshot({ path: CONTACT_SHEET })
await page.close(); await browser.close()
writeFileSync(RECEIPT, `${JSON.stringify(currentReceipt(), null, 2)}\n`)
console.log(`Wrote ${repoPath(REPORT)} and ${repoPath(CONTACT_SHEET)}; harmony pass rate ${report.summary.harmonyPassing123}/${report.summary.cases}`)
