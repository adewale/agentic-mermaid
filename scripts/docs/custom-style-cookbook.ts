import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { inlineFontVarForRaster } from '../../src/theme.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'assets', 'style-cookbook')
const FONT_FILES = [
  join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf'),
  join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
  join(ROOT, 'assets', 'fonts', 'Caveat.ttf'),
  join(ROOT, 'assets', 'fonts', 'EBGaramond.ttf'),
  join(ROOT, 'assets', 'fonts', 'ArchitectsDaughter.ttf'),
  join(ROOT, 'assets', 'fonts', 'ShareTechMono.ttf'),
].filter(existsSync)

const SAMPLE = `flowchart LR
  subgraph Core["Routing core"]
    Intake["Intake"] --> Validate{"Valid?"}
    Validate -- yes --> Render["Render SVG"]
    Validate -- no --> Repair["Repair source"]
    Repair --> Validate
  end
  Render --> Export["Export PNG"]
  Render --> Audit["Contrast audit"]
  Audit --> Export`

const STYLE_CASES = [
  {
    source: join(ROOT, 'examples', 'styles', 'transit-route-map.style.json'),
    output: join(OUT_DIR, 'transit-route-map.png'),
  },
  {
    source: join(ROOT, 'examples', 'styles', 'mid-century-report.style.json'),
    output: join(OUT_DIR, 'mid-century-report.png'),
  },
  {
    source: join(ROOT, 'examples', 'styles', 'star-chart-atlas.style.json'),
    output: join(OUT_DIR, 'star-chart-atlas.png'),
  },
] as const

export function buildCookbookScreenshot(stylePath: string): Uint8Array {
  const style = JSON.parse(readFileSync(stylePath, 'utf8'))
  const svg = inlineFontVarForRaster(renderMermaidSVG(SAMPLE, {
    style,
    seed: 11,
    padding: 28,
    embedFontImport: false,
    security: 'strict',
  }))
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: 900 },
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'DejaVu Sans' },
  }).render().asPng()
}

export function buildCookbookScreenshots(): Array<{ path: string; png: Uint8Array }> {
  return STYLE_CASES.map(c => ({ path: c.output, png: buildCookbookScreenshot(c.source) }))
}

function writeOrCheck(): void {
  mkdirSync(OUT_DIR, { recursive: true })
  let failed = false
  for (const { path, png } of buildCookbookScreenshots()) {
    if (process.argv.includes('--check')) {
      if (!existsSync(path) || !Buffer.from(readFileSync(path)).equals(Buffer.from(png))) {
        process.stderr.write(`${path} is out of date; run bun run scripts/docs/custom-style-cookbook.ts\n`)
        failed = true
      }
    } else {
      writeFileSync(path, png)
      process.stdout.write(`wrote ${path}\n`)
    }
  }
  if (failed) process.exit(1)
}

if (import.meta.main) writeOrCheck()
