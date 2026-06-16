/**
 * Regenerates scripts/site/upstream-layout-snapshots.json — pinned renders of
 * the layout-comparison cases from the *upstream* Beautiful Mermaid package, so
 * the differences page can show a faithful before/after without depending on
 * the upstream package at site-build time.
 *
 * The "before" panels on the differences page are these snapshots; the "after"
 * panels are rendered fresh from this repo. Pinning the upstream side keeps the
 * comparison honest and stable (it is labeled with the captured version) and
 * keeps `beautiful-mermaid` out of the normal build and CI dependency graph.
 *
 * Regenerate (only when intentionally refreshing the baseline):
 *   bun add -d beautiful-mermaid
 *   bun run scripts/site/capture-upstream-layout.ts
 *   bun remove beautiful-mermaid
 *
 * The case ids and sources must stay in sync with LAYOUT_CASES in differences.ts;
 * they are imported from there so there is a single source of truth.
 */

import { writeFileSync } from 'node:fs'
import { THEMES } from '../../src/theme.ts'
import { LAYOUT_CASES, FIGURE_THEME_KEY } from './differences.ts'

// `beautiful-mermaid` is a transient, dev-only dependency installed just for
// this regeneration (see header) and is not part of the normal dependency
// graph, so tsc cannot resolve it during the regular type check.
// @ts-ignore optional dev-only dependency, not installed in CI
const up: any = await import('beautiful-mermaid')
const upstreamVersion: string =
  // @ts-ignore optional dev-only dependency, not installed in CI
  (await import('beautiful-mermaid/package.json', { with: { type: 'json' } })).default.version

const theme = THEMES[FIGURE_THEME_KEY]!
const opt = {
  bg: theme.bg, fg: theme.fg, line: theme.line, accent: theme.accent,
  muted: theme.muted, surface: theme.surface, border: theme.border,
}

const cases: Record<string, string> = {}
for (const c of LAYOUT_CASES) {
  cases[c.id] = up.renderMermaidSVG(c.src, { ...opt, idPrefix: `up-${c.id}-` })
}

const out = {
  upstreamVersion,
  theme: FIGURE_THEME_KEY,
  generated: new Date().toISOString().slice(0, 10),
  cases,
}
const outPath = new URL('./upstream-layout-snapshots.json', import.meta.url).pathname
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n')
console.log(`wrote ${outPath}: ${Object.keys(cases).length} cases from beautiful-mermaid@${upstreamVersion}`)
