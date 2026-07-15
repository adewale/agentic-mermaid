// Regenerates the "after" radar renders for the reverse-flow label-discipline
// PR: the whole-repo union of label lessons (ER de-collision, quadrant leaders,
// flowchart knockout tick boxes, timeline wrap compression, journey contrast
// gate) applied to the radar family. Renders each committed fixture with the
// current renderer and rasterizes to docs/design/families/*-after.png.
//
// The matching "-before.png" images are baselines rendered at the radar base
// commit (they predate this change) and are retained, not regenerated here —
// reproduce them with:
//   git worktree add --detach /tmp/agentic-mermaid-radar-before e27d9ed4caf1e161933c2ce797a616cbd92af784
//   (cd /tmp/agentic-mermaid-radar-before && bun install --frozen-lockfile && \
//     bun run bin/am.ts render \
//       docs/design/families/radar-reverse-lessons-demo.mmd \
//       --format png --output /tmp/radar-reverse-lessons-before.png)
//   cp /tmp/radar-reverse-lessons-before.png \
//     docs/design/families/radar-reverse-lessons-before.png
//
// Run: bun run scripts/pr-assets/radar-reverse-lessons.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import '../../src/index.ts'
import { renderMermaidSVG } from '../../src/agent/index.ts'
import { inlineFontVarForRaster } from '../../src/theme.ts'

const ROOT = join(import.meta.dir, '..', '..')
const FONT_DIR = join(ROOT, 'assets', 'fonts')
const FAMILIES = join(ROOT, 'docs', 'design', 'families')

const CASES = [
  { fixture: 'radar-reverse-lessons-demo.mmd', out: 'radar-reverse-lessons-after.png', width: 1320 },
  { fixture: 'radar-reverse-lessons-dense.mmd', out: 'radar-reverse-lessons-dense-after.png', width: 1240 },
] as const

for (const c of CASES) {
  const source = readFileSync(join(FAMILIES, c.fixture), 'utf8')
  const svg = renderMermaidSVG(source)
  const png = new Resvg(inlineFontVarForRaster(svg), {
    fitTo: { mode: 'width', value: c.width },
    font: { loadSystemFonts: false, fontDirs: [FONT_DIR], defaultFontFamily: 'Inter' },
  }).render().asPng()
  writeFileSync(join(FAMILIES, c.out), png)
  console.log(`wrote docs/design/families/${c.out}`)
}
