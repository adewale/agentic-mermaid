import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { inlineFontVarForRaster } from '../../src/theme.ts'
import {
  CUSTOM_STYLE_CATALOG,
  CUSTOM_STYLE_SCREENSHOT_ROOT,
  customStylePath,
  customStyleSamplePath,
  customStyleScreenshotPath,
} from './custom-style-catalog.ts'

const ROOT = join(import.meta.dir, '..', '..')
const FONT_FILES = [
  join(ROOT, 'assets', 'fonts', 'Inter-Regular.ttf'),
  join(ROOT, 'assets', 'fonts', 'Inter-Medium.ttf'),
  join(ROOT, 'assets', 'fonts', 'Inter-SemiBold.ttf'),
  join(ROOT, 'assets', 'fonts', 'Inter-Bold.ttf'),
  join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf'),
  join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
  join(ROOT, 'assets', 'fonts', 'Caveat.ttf'),
  join(ROOT, 'assets', 'fonts', 'EBGaramond.ttf'),
  join(ROOT, 'assets', 'fonts', 'ArchitectsDaughter.ttf'),
  join(ROOT, 'assets', 'fonts', 'ShareTechMono.ttf'),
].filter(existsSync)

const SAMPLE = readFileSync(customStyleSamplePath(), 'utf8')

export function buildCookbookScreenshot(stylePath: string, renderOptions: Readonly<{ shadow?: boolean }> = {}): Uint8Array {
  const style = JSON.parse(readFileSync(stylePath, 'utf8'))
  const svg = inlineFontVarForRaster(renderMermaidSVG(SAMPLE, {
    style,
    seed: 11,
    padding: 28,
    ...renderOptions,
    embedFontImport: false,
    security: 'strict',
  }))
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: 900 },
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'DejaVu Sans' },
  }).render().asPng()
}

export function buildCookbookScreenshots(): Array<{ path: string; png: Uint8Array }> {
  return CUSTOM_STYLE_CATALOG.examples.map(entry => ({
    path: customStyleScreenshotPath(entry),
    png: buildCookbookScreenshot(customStylePath(entry), entry.renderOptions),
  }))
}

function writeOrCheck(): void {
  mkdirSync(CUSTOM_STYLE_SCREENSHOT_ROOT, { recursive: true })
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
