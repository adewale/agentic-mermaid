#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { getFamily, knownBuiltinFamilies } from '../../src/agent/families.ts'
import { renderMermaidPNG } from '../../src/agent/png.ts'
import { inspectPngDimensions } from '../../src/output-color-profile.ts'
import { renderMermaidASCII, renderMermaidSVG, validateStyleSpec, type StyleSpec } from '../../src/index.ts'
import { hashFileTree, repositoryPath, sha256File, sortRepositoryPaths, transitiveLocalInputs } from './artifact-receipt.ts'

const ROOT = join(import.meta.dir, '..', '..')
export const OUTPUT = join(ROOT, 'docs', 'design', 'families', 'section-b-brand-evidence.png')
export const RECEIPT = join(ROOT, 'eval', 'section-b-brand-evidence', 'evidence-receipt.json')
export const VISUAL_APPROVAL = join(ROOT, 'eval', 'section-b-brand-evidence', 'visual-approval.json')
export const SECTION_B_BASELINE_COMMIT = 'e60be1e68b5aa51fac205c7cf9e481ea3b27ffc8'
const PRODUCTION_COMPARISON = join(ROOT, 'eval', 'section-b-brand-evidence', 'production-comparison.md')
const README = join(ROOT, 'eval', 'section-b-brand-evidence', 'README.md')
const FONT_FILES = [
  join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf'),
  join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
].filter(existsSync)

const SENTINEL: StyleSpec = {
  colors: { bg: '#fffdf7', fg: '#211a33', line: '#5b21b6', accent: '#be123c', muted: '#675d72', surface: '#f5e9ff', border: '#6d28d9' },
  roles: {
    node: { fontSize: 16, fontWeight: 800, paddingX: 30, paddingY: 16, cornerRadius: 12, lineWidth: 3, fillColor: '#f5e9ff', borderColor: '#6d28d9', textColor: '#211a33' },
    edge: { fontSize: 13, fontWeight: 700, lineWidth: 3, bendRadius: 14, strokeColor: '#5b21b6', textColor: '#211a33' },
    group: { fontSize: 14, fontWeight: 800, paddingX: 26, paddingY: 22, cornerRadius: 12, lineWidth: 2, fillColor: '#fff7ed', borderColor: '#be123c', textColor: '#211a33' },
    label: { fontSize: 14, fontWeight: 700, textColor: '#211a33' },
    'pie-slice': { lineWidth: 3 },
  },
  semanticSlots: { selected: { fillColor: '#fda4af', borderColor: '#881337', lineWidth: 4 } },
  bindings: [{ channel: 'category', value: 'Pro', slot: 'selected', role: 'pie-slice' }],
}

const HOLDOUT_EDITORIAL: StyleSpec = {
  colors: { bg: '#fbf7ef', fg: '#29231f', line: '#5f5148', accent: '#a33b20', muted: '#76685f', surface: '#fffaf0', border: '#77655a' },
  font: 'EB Garamond',
  roles: {
    node: { fontSize: 15, fontWeight: 600, paddingX: 25, paddingY: 13, cornerRadius: 2, lineWidth: 1.2 },
    edge: { fontSize: 12, fontWeight: 600, lineWidth: 1.3, bendRadius: 2 },
    group: { fontSize: 13, fontWeight: 700, letterSpacing: 0.06, paddingX: 23, paddingY: 20, cornerRadius: 2, lineWidth: 1.2 },
    label: { fontSize: 13, fontWeight: 600 },
  },
}

const HOLDOUT_TECHNICAL: StyleSpec = {
  colors: { bg: '#f4fbff', fg: '#102a43', line: '#176b87', accent: '#007f73', muted: '#486581', surface: '#e6f6fb', border: '#2287a5' },
  font: 'IBM Plex Sans',
  roles: {
    node: { fontSize: 14, fontWeight: 700, paddingX: 22, paddingY: 12, cornerRadius: 0, lineWidth: 1.8 },
    edge: { fontSize: 11, fontWeight: 600, lineWidth: 1.8, bendRadius: 0 },
    group: { fontSize: 12, fontWeight: 700, letterSpacing: 0.04, paddingX: 20, paddingY: 18, cornerRadius: 0, lineWidth: 1.5 },
    label: { fontSize: 12, fontWeight: 600 },
  },
}

const HOLDOUT_OPS: StyleSpec = {
  colors: { bg: '#07131d', fg: '#e2f2ff', line: '#54a3c7', accent: '#2dd4bf', muted: '#91afc2', surface: '#102638', border: '#3f7791' },
  font: 'Share Tech Mono',
  roles: {
    node: { fontSize: 13, fontWeight: 700, textTransform: 'uppercase', paddingX: 18, paddingY: 10, cornerRadius: 4, lineWidth: 2 },
    edge: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', lineWidth: 2, bendRadius: 0 },
    group: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', paddingX: 18, paddingY: 18, cornerRadius: 4, lineWidth: 2 },
    label: { fontSize: 12, fontWeight: 700 },
  },
}

const VARIANTS = [
  ['Sentinel · every channel deliberately distinctive', SENTINEL],
  ['Holdout · warm editorial', HOLDOUT_EDITORIAL],
  ['Holdout · light technical', HOLDOUT_TECHNICAL],
  ['Holdout · dark operations', HOLDOUT_OPS],
] as const

const GRAPHICAL_BACKEND_PROBES = [
  ['default', {}],
  ['rough', { stroke: 'jittered' }],
  ['hybrid', { stroke: 'freehand' }],
] as const satisfies readonly (readonly [string, StyleSpec])[]
for (const [name, style] of VARIANTS) {
  const problems = validateStyleSpec(style)
  if (problems.length) throw new Error(`${name} is not an admissible public StyleSpec: ${problems.join('; ')}`)
}

const PIE = `---
config:
  pie:
    highlightSlice: Pro
---
pie title Plans
  "Free" : 60
  "Pro" : 30
  "Enterprise" : 10`

function familySource(id: string): string {
  return id === 'pie' ? PIE : getFamily(id)!.example
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function sectionBVariantHeadingMarkup(
  variantName: string,
  cursorY: number,
  width: number,
  headingHeight: number,
): string {
  return `<rect x="0" y="${cursorY}" width="${width}" height="${headingHeight}" fill="#18181b"/>` +
    `<text x="24" y="${cursorY + 37}" fill="#fafafa" font-family="DejaVu Sans" font-size="23" font-weight="700">${escapeXml(variantName)}</text>` +
    `<text x="24" y="${cursorY + 64}" fill="#d4d4d8" font-family="DejaVu Sans" font-size="14">All registered families · public StyleSpec only · Pie keeps authored Pro emphasis and exact wedge geometry</text>`
}

function svgSize(svg: string): { width: number; height: number } {
  const viewBox = svg.match(/viewBox="(?:[-\d.]+\s+){2}([\d.]+)\s+([\d.]+)"/)
  if (!viewBox) throw new Error('Section B evidence SVG has no finite viewBox')
  return { width: Number(viewBox[1]), height: Number(viewBox[2]) }
}

function raster(source: string, style: StyleSpec): { data: string; width: number; height: number } {
  const svg = renderMermaidSVG(source, { style, seed: 17, security: 'strict', embedFontImport: false })
  const size = svgSize(svg)
  const maxWidth = 470
  const maxHeight = 300
  const scale = Math.min(maxWidth / size.width, maxHeight / size.height)
  const width = Math.max(1, Math.round(size.width * scale))
  const height = Math.max(1, Math.round(size.height * scale))
  // Exercise the public native PNG request path for every cell rather than
  // privately rasterizing the SVG and merely claiming PNG parity.
  const png = renderMermaidPNG(source, {
    style,
    seed: 17,
    security: 'strict',
    embedFontImport: false,
    fitTo: { width },
    onWarning: () => {},
  })
  const dimensions = inspectPngDimensions(png)
  return { data: Buffer.from(png).toString('base64'), width: dimensions.width, height: dimensions.height }
}

export function buildSectionBBrandEvidence(): Uint8Array {
  const families = knownBuiltinFamilies()
  const columns = 3
  const cellWidth = 520
  const cellHeight = 380
  const headingHeight = 86
  const rowsPerVariant = Math.ceil(families.length / columns)
  const width = columns * cellWidth
  const height = VARIANTS.length * (headingHeight + rowsPerVariant * cellHeight)
  let cursorY = 0
  const sections: string[] = []
  for (const [variantName, style] of VARIANTS) {
    sections.push(sectionBVariantHeadingMarkup(variantName, cursorY, width, headingHeight))
    const top = cursorY + headingHeight
    for (const [index, id] of families.entries()) {
      const image = raster(familySource(id), style)
      const column = index % columns
      const row = Math.floor(index / columns)
      const x0 = column * cellWidth
      const y0 = top + row * cellHeight
      const x = x0 + (cellWidth - image.width) / 2
      const y = y0 + 45 + (cellHeight - 55 - image.height) / 2
      sections.push(`<g><rect x="${x0 + 1}" y="${y0 + 1}" width="${cellWidth - 2}" height="${cellHeight - 2}" fill="#f4f4f5" stroke="#a1a1aa"/>`)
      sections.push(`<text x="${x0 + 18}" y="${y0 + 29}" fill="#18181b" font-family="DejaVu Sans" font-size="17" font-weight="700">${escapeXml(getFamily(id)!.label)}</text>`)
      sections.push(`<image x="${x}" y="${y}" width="${image.width}" height="${image.height}" href="data:image/png;base64,${image.data}"/></g>`)
    }
    cursorY += headingHeight + rowsPerVariant * cellHeight
  }
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#e4e4e7"/>${sections.join('')}</svg>`
  return new Resvg(sheet, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' },
  }).render().asPng()
}

const inputPaths = sortRepositoryPaths(ROOT, [
  join(ROOT, 'package.json'),
  join(ROOT, 'bun.lock'),
  join(ROOT, 'eval', 'section-b-brand-evidence', 'baseline.mmd'),
  join(ROOT, 'eval', 'section-b-brand-evidence', 'role-style.json'),
  join(ROOT, 'eval', 'section-b-brand-evidence', 'usability-agent-session.json'),
  VISUAL_APPROVAL,
  PRODUCTION_COMPARISON,
  ...FONT_FILES,
  ...transitiveLocalInputs(ROOT, [import.meta.filename]),
])

interface VisualApprovalRecord {
  schemaVersion: 1
  status: 'approved'
  artifact: string
  artifactSha256: string
  reviewedAt: string
  reviewer: string
  scope: string
  audit: string
}

function verifiedVisualApproval(outputSha256: string) {
  const approval = JSON.parse(readFileSync(VISUAL_APPROVAL, 'utf8')) as Partial<VisualApprovalRecord>
  const expectedArtifact = repositoryPath(ROOT, OUTPUT)
  if (approval.schemaVersion !== 1 || approval.status !== 'approved' || approval.artifact !== expectedArtifact) {
    throw new Error('Section B visual approval is malformed; inspect the generated sheet and update visual-approval.json')
  }
  if (approval.artifactSha256 !== outputSha256) {
    throw new Error(`Section B visual approval covers ${approval.artifactSha256 ?? 'no hash'}, not ${outputSha256}; inspect the generated sheet at native size before approving it`)
  }
  for (const field of ['reviewedAt', 'reviewer', 'scope', 'audit'] as const) {
    if (typeof approval[field] !== 'string' || approval[field]!.trim().length === 0) {
      throw new Error(`Section B visual approval requires a non-empty ${field}`)
    }
  }
  return {
    path: repositoryPath(ROOT, VISUAL_APPROVAL),
    status: approval.status,
    artifactSha256: approval.artifactSha256,
    reviewedAt: approval.reviewedAt,
    reviewer: approval.reviewer,
    audit: approval.audit,
  }
}

function digestBackendProbe(style: StyleSpec): { svgSha256: string; pngSha256: string } {
  const svgHash = createHash('sha256')
  const pngHash = createHash('sha256')
  for (const id of knownBuiltinFamilies()) {
    const source = familySource(id)
    const stack = [SENTINEL, style]
    const svg = renderMermaidSVG(source, { style: stack, seed: 29, security: 'strict', embedFontImport: false })
    const png = renderMermaidPNG(source, {
      style: stack, seed: 29, security: 'strict', embedFontImport: false, onWarning: () => {},
    })
    svgHash.update(`${id}\0${svg.length}\0`).update(svg)
    pngHash.update(`${id}\0${png.byteLength}\0`).update(png)
  }
  return { svgSha256: svgHash.digest('hex'), pngSha256: pngHash.digest('hex') }
}

export function verifySectionBCausalBaseline(): { commit: string; exitCode: number; diagnostic: string } {
  const worktree = mkdtempSync(join(tmpdir(), 'am-section-b-base-'))
  rmSync(worktree, { recursive: true, force: true })
  const add = spawnSync('git', ['worktree', 'add', '--quiet', '--detach', worktree, SECTION_B_BASELINE_COMMIT], {
    cwd: ROOT, encoding: 'utf8',
  })
  if (add.status !== 0) throw new Error(`Unable to create Section B baseline worktree: ${add.stderr || add.stdout}`)
  try {
    const dependencies = join(ROOT, 'node_modules')
    if (existsSync(dependencies)) symlinkSync(dependencies, join(worktree, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    const run = spawnSync(process.execPath, [
      'run', 'bin/am.ts', 'render',
      join(ROOT, 'eval/section-b-brand-evidence/baseline.mmd'),
      '--format', 'svg',
      '--style', join(ROOT, 'eval/section-b-brand-evidence/role-style.json'),
    ], { cwd: worktree, encoding: 'utf8' })
    const diagnostic = `${run.stderr ?? ''}${run.stdout ?? ''}`.trim()
    if (run.status !== 2 || !diagnostic.includes('unknown field "roles"')) {
      throw new Error(`Pinned Section B baseline did not reject roles as expected (exit ${run.status}): ${diagnostic}`)
    }
    return { commit: SECTION_B_BASELINE_COMMIT, exitCode: run.status, diagnostic }
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: ROOT, encoding: 'utf8' })
    rmSync(worktree, { recursive: true, force: true })
  }
}

export const buildSectionBBrandEvidenceReceipt = () => {
  const outputSha256 = sha256File(OUTPUT)
  return {
    schemaVersion: 3,
    generator: repositoryPath(ROOT, import.meta.filename),
    inputs: { count: inputPaths.length, treeSha256: hashFileTree(ROOT, inputPaths) },
    fontInputs: sortRepositoryPaths(ROOT, FONT_FILES).map(path => ({
      path: repositoryPath(ROOT, path),
      sha256: sha256File(path),
    })),
    families: knownBuiltinFamilies(),
    variants: VARIANTS.map(([name]) => name),
    outputPaths: {
      graphicalCells: 'public native renderMermaidPNG',
      graphicalBackends: 'public renderMermaidSVG + renderMermaidPNG sentinel probes',
      terminal: 'public renderMermaidASCII (Unicode, no color)',
    },
    graphicalBackends: Object.fromEntries(GRAPHICAL_BACKEND_PROBES.map(([backend, style]) => [
      backend,
      { familyCount: knownBuiltinFamilies().length, ...digestBackendProbe(style) },
    ])),
    terminalSha256: createHash('sha256').update(VARIANTS.flatMap(([, style]) =>
      knownBuiltinFamilies().map(id => renderMermaidASCII(familySource(id), { style, colorMode: 'none' })),
    ).join('\n\u0000\n')).digest('hex'),
    baseline: {
      state: 'unsupported-style-fields',
      commit: SECTION_B_BASELINE_COMMIT,
      command: `git worktree add --detach /tmp/am-section-b-base ${SECTION_B_BASELINE_COMMIT} && (cd /tmp/am-section-b-base && bun install --frozen-lockfile && bun run bin/am.ts render "$OLDPWD/eval/section-b-brand-evidence/baseline.mmd" --format svg --style "$OLDPWD/eval/section-b-brand-evidence/role-style.json")`,
      expectedExitCode: 2,
      expected: 'Invalid style spec: unknown field "roles" (no fabricated before image)',
    },
    visualApproval: verifiedVisualApproval(outputSha256),
    outputs: [{ path: repositoryPath(ROOT, OUTPUT), sha256: outputSha256 }],
  }
}

if (process.argv.includes('--check')) {
  const recorded = JSON.parse(readFileSync(RECEIPT, 'utf8'))
  if (JSON.stringify(recorded) !== JSON.stringify(buildSectionBBrandEvidenceReceipt())) throw new Error('Section B visual evidence is stale; run bun run gallery:section-b')
  process.stdout.write('Section B visual evidence is synchronized.\n')
} else if (import.meta.main) {
  mkdirSync(join(ROOT, 'docs', 'design', 'families'), { recursive: true })
  mkdirSync(join(ROOT, 'eval', 'section-b-brand-evidence'), { recursive: true })
  writeFileSync(OUTPUT, buildSectionBBrandEvidence())
  writeFileSync(README, `# Section B visual evidence\n\nThe pinned pre-Section-B commit \`${SECTION_B_BASELINE_COMMIT}\` rejects the public \`roles\` field, so no plausible before image exists. \`baseline.mmd\` and \`role-style.json\` are the exact committed inputs. Reproduce the causal baseline with the commit-pinned command retained in \`evidence-receipt.json\`; \`section-b-visual-evidence.test.ts\` executes the same commit and requires exit 2 plus the \`unknown field "roles"\` diagnostic.\n\nThe generated after sheet renders every registered family through one deliberately distinctive sentinel and three holdout inline StyleSpec records. Every cell uses the public native PNG API; the receipt also hashes no-color Unicode output for the same family×style matrix and executes the sentinel across all registered families through default, rough, and hybrid SVG+PNG probes. Inspect typography, padding/radius/line-weight changes, cross-family palette coherence, and the Pie card: \`Pro\` remains the family-authored highlighted slice while the sentinel category binding changes its paint without changing wedge geometry. The manual native-size review and deployed-website comparison are recorded by \`visual-approval.json\` and \`production-comparison.md\`. The separate Cupertino-, Vercel-, and Cloudflare Workers-inspired public-record evidence is catalogued in \`examples/styles/catalog.json\` and pinned by \`eval/style-prototype-evidence/visual-approval.json\`.\n\nApproval is intentionally separate from generation: run \`bun run gallery:section-b\` to create a candidate, inspect all 60 cells at native size, update \`visual-approval.json\` with the candidate SHA-256 and audit path, then rerun the command to refresh the receipt. \`bun run gallery:section-b:check\` verifies source/font freshness, output bytes, and that the approval names those exact bytes.\n`)
  writeFileSync(RECEIPT, `${JSON.stringify(buildSectionBBrandEvidenceReceipt(), null, 2)}\n`)
  process.stdout.write(`wrote ${OUTPUT}\n`)
}
