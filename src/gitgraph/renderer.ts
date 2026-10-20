import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import type { Geometry } from '../scene/ir.ts';
import { gitGraphText, gitTagOffset, gitCommitLabelY } from './layout.ts'
import type { RenderContext } from '../types.ts'
import type { PositionedGitGraphCommit, PositionedGitGraphDiagram } from './types.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'

import { DefaultBackend } from '../scene/backend.ts'
import { snapshotSvgEmissionRecipe, svgValue as v, type SvgAttribute, type SvgGeometryField, type SvgGroupEmission } from '../scene/svg-emission.ts'
import type { DiagramColors } from '../theme.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { semanticChildId, semanticNamespacedId, semanticRelationId } from '../scene/identity.ts'
import { safeCssPaint } from '../shared/css-color.ts'
import { categoricalPalette } from '../shared/categorical-palette.ts'
import { ensureContrast, isHexColor, mixHex } from '../shared/color-math.ts'





import { GITGRAPH_COMMIT_LABEL_PADDING_X } from './layout.ts';
import { resolveGitGraphCommitLabelFontSize } from './position.ts'

import { gitGraphCommitLabel } from './types.ts'

const PAINT_ATTRIBUTES: readonly SvgAttribute[] = [
  { name: 'fill', value: v.paint('fill') }, { name: 'stroke', value: v.paint('stroke') }, { name: 'stroke-width', value: v.paint('strokeWidth') },
]
function primitive(fields: readonly SvgGeometryField[], before: readonly SvgAttribute[] = [], after: readonly SvgAttribute[] = PAINT_ATTRIBUTES) {
  return snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
    ...before, ...fields.map(name => ({ name, value: v.geometry(name), format: 'round3' as const })), ...after,
  ] })
}
const COMMIT_EMISSIONS = {
  circle: primitive(['cx', 'cy', 'r']), polygon: primitive(['points']), rect: primitive(['x', 'y', 'width', 'height', 'rx', 'ry']),
}
const INNER_EMISSION = primitive(['cx', 'cy', 'r'])
const CROSS_EMISSION = primitive(['x1', 'y1', 'x2', 'y2'], [], PAINT_ATTRIBUTES.slice(1))
const BACKGROUND_EMISSIONS = {
  branch: primitive(['x', 'y', 'width', 'height', 'rx'], [{ name: 'class', value: v.meta('git-branch-label-background') }]),
  tag: primitive(['x', 'y', 'width', 'height', 'rx'], [{ name: 'class', value: v.meta('git-tag-background') }]),
  commit: primitive(['x', 'y', 'width', 'height', 'rx'], [{ name: 'class', value: v.meta('git-commit-label-background') }], [
    PAINT_ATTRIBUTES[0]!, { name: 'fill-opacity', value: v.meta('0.94') }, ...PAINT_ATTRIBUTES.slice(1), { name: 'transform', value: v.transform() },
  ]),
}
const BRANCH_LINE_EMISSION = primitive(['x1', 'y1', 'x2', 'y2'], [
  { name: 'class', value: v.meta('git-branch-line') }, { name: 'data-branch', value: v.channel('category') },
], [...PAINT_ATTRIBUTES.slice(1), { name: 'opacity', value: v.paint('opacity') }])
function textEmission(className: string, extra: readonly SvgAttribute[] = [], roundedSize = false, transform = false) {
  return snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
    { name: 'class', value: v.meta(className) }, ...extra, { name: 'text-anchor', value: v.text('anchor') },
    { name: 'font-size', value: v.text('fontSize'), ...(roundedSize ? { format: 'round3' as const } : {}) },
    { name: 'font-weight', value: v.text('fontWeight') }, { name: 'letter-spacing', value: v.text('letterSpacing') },
    { name: 'fill', value: v.paint('fill') }, ...(transform ? [{ name: 'transform' as const, value: v.transform() }] : []),
  ] })
}
const TITLE_EMISSION = textEmission('gitgraph-title', [{ name: 'data-id', value: v.meta('gitgraph-title') }])
const BRANCH_LABEL_EMISSION = textEmission('git-branch-label', [{ name: 'data-branch', value: v.channel('category') }])
const COMMIT_LABEL_EMISSION = textEmission('git-commit-label', [], true, true)
const TAG_EMISSION = textEmission('git-tag')
const BRANCH_GROUP_EMISSION = snapshotSvgEmissionRecipe({ kind: 'group', attributes: [
  { name: 'class', value: v.meta('git-branch') }, { name: 'data-id', value: v.identity('id') }, { name: 'data-branch', value: v.channel('category') },
] }) as SvgGroupEmission

export type GitGraphThemeProjection = Record<string, string | number>

/** Sanitize the GitGraph-specific theme subset once at request resolution. */
export function resolveGitGraphThemeProjection(raw: unknown): GitGraphThemeProjection {
  const vars = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const projected: GitGraphThemeProjection = {
    commitLabelFontSize: resolveGitGraphCommitLabelFontSize(vars),
  }
  for (let index = 0; index < 8; index++) {
    for (const key of [`git${index}`, `gitBranchLabel${index}`, `gitInv${index}`]) {
      const color = safeCssPaint(vars[key])
      if (color !== undefined) projected[key] = color
    }
  }
  for (const key of ['commitLabelColor', 'commitLabelBackground'] as const) {
    const color = safeCssPaint(vars[key])
    if (color !== undefined) projected[key] = color
  }
  return projected
}

export function renderGitGraphSvg(ctx: RenderContext<PositionedGitGraphDiagram>): string {
  return DefaultBackend.render(lowerGitGraphScene(ctx), { seed: 0 })
}

export function lowerGitGraphDrawing<T>(marks: DrawingFactory<T>, ctx: RenderContext<PositionedGitGraphDiagram>): DrawingDocument<T> {
  const { positioned: diagram, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const titleId = 'gitgraph-title'
  const descId = 'gitgraph-desc'
  const attrs = buildAccessibilityAttrs(diagram.accessibilityTitle ?? 'Git graph', diagram.accessibilityDescription, titleId, descId, 'git graph')
  const familyAppearance = resolved.familyAppearance as { themeVariables?: GitGraphThemeProjection } | undefined
  if (!familyAppearance) throw new Error('GitGraph rendering requires request-boundary family appearance resolution')
  const projectedTheme = familyAppearance.themeVariables
  const paints = gitGraphPaints(diagram, projectedTheme, colors)
  const parts: T[] = [marks.documentOpen({ id: 'prelude', width: diagram.width, height: diagram.height, colors, transparent, font, hasMonoFont: false }, { kind: 'prelude', width: diagram.width, height: diagram.height, colors, transparent, font, hasMonoFont: false,
    attributes: Object.entries(attrs).filter((entry): entry is [string, string] => entry[1] !== undefined).map(([name, value]) => ({ name: name as SvgAttribute['name'], value: v.meta(value) })),
    children: [{ kind: 'sharedStyle' }, ...(colors.shadow ? [{ kind: 'shadow' as const, colors, wrap: true }] : [])],
  })]
  parts.push(marks.documentText({ id: 'acc-title', element: 'title', domId: titleId, text: diagram.accessibilityTitle ?? 'Git graph' }))
  if (diagram.accessibilityDescription) parts.push(marks.documentText({ id: 'acc-desc', element: 'description', domId: descId, text: diagram.accessibilityDescription }))
  if (diagram.title) {
    const block = diagram.titleBlock ?? gitGraphText(diagram.title, 16, 600)
    parts.push(marks.text({
    id: 'gitgraph-visible-title', role: 'title', text: block.text, block,
    x: diagram.width / 2, y: 8 + (diagram.titleBlock?.fontSize ?? 16) * 0.65 + ((diagram.titleBlock?.height ?? 0) - (diagram.titleBlock?.lineHeight ?? 0)) / 2, fontSize: block.fontSize, fontWeight: block.fontWeight, letterSpacing: block.letterSpacing, anchor: 'middle', paint: { fill: 'var(--_text)' },

      identity: { id: 'gitgraph-title', classNames: ['gitgraph-title'] },
      attributes: { className: 'gitgraph-title' },
    }, TITLE_EMISSION))
  }

  if (diagram.showBranches) {
    for (const branch of diagram.branches) {
      const branchId = semanticNamespacedId('branch', branch.name)
      const branchPaint = paints.branches.get(branch.name)!
      const labelX = r(diagram.direction === 'LR' ? branch.x1 - 10 : branch.x1)
      const labelY = r(diagram.direction === 'LR' ? branch.y1 : branch.y1 - 16)
      const block = branch.labelBlock ?? gitGraphText(branch.name, 12, 600)
      const extraHeight = block.height - block.lineHeight
      const labelWidth = r(block.width + 10)
      const labelBackgroundX = r(diagram.direction === 'LR' ? labelX - labelWidth : labelX - labelWidth / 2)
      parts.push(marks.group({
        id: branchId, role: 'group', channels: { category: branch.name },
        emission: BRANCH_GROUP_EMISSION,
        children: [
          { node: marks.shape({
            id: semanticChildId(branchId, 'label-bg'), role: 'chrome',
            geometry: { kind: 'rect', x: labelBackgroundX, y: labelY - block.fontSize - 1 - extraHeight / 2, width: labelWidth, height: block.fontSize + 6 + extraHeight, rx: 4, ry: 4 },
            paint: { fill: branchPaint.labelBackground, stroke: branchPaint.line, strokeWidth: '1' },

            attributes: { className: 'git-branch-label-background' },
          }, BACKGROUND_EMISSIONS.branch), indent: 2 },
          { node: marks.shape({
            id: semanticChildId(branchId, 'line'), role: 'rail',
            geometry: { kind: 'line', x1: branch.x1, y1: branch.y1, x2: branch.x2, y2: branch.y2 },
            paint: { stroke: branchPaint.line, strokeWidth: '3', opacity: '0.86' },
            channels: { category: branch.name },

            attributes: { className: 'git-branch-line', data: { branch: branch.name } },
          }, BRANCH_LINE_EMISSION), indent: 2 },
          { node: marks.text({
            id: semanticChildId(branchId, 'label'), role: 'label', text: block.text, block,
            x: labelX, y: labelY - block.fontSize * 0.35, fontSize: block.fontSize, fontWeight: block.fontWeight, letterSpacing: block.letterSpacing, anchor: diagram.direction === 'LR' ? 'end' : 'middle',
            paint: { fill: branchPaint.label }, channels: { category: branch.name },

            attributes: { className: 'git-branch-label', data: { branch: branch.name } },
          }, BRANCH_LABEL_EMISSION), indent: 2 },
        ],
      }))
    }
  }

  const commitById = new Map(diagram.commits.map(commit => [commit.id, commit]))
  for (const edge of diagram.edges) {
    const targetBranch = commitById.get(edge.to)?.branch
    const edgePaint = targetBranch ? paints.branches.get(targetBranch)?.line ?? 'var(--_line)' : 'var(--_line)'
    parts.push(marks.connector({
      id: semanticRelationId(edge.from, edge.to),
      role: 'edge', geometry: { kind: 'polyline', points: edge.points },
      lineStyle: edge.kind === 'cherry-pick' ? 'dashed' : 'solid',
      paint: { fill: 'none', stroke: edgePaint, strokeWidth: edge.kind === 'parent' ? '2' : '2.5', ...(edge.kind === 'cherry-pick' ? { strokeDasharray: '4 3' } : {}) },
      endpoints: { from: edge.from, to: edge.to },
      relationship: { kind: edge.kind, direction: 'forward' },
      route: { ownership: 'layout' },
      channels: { category: edge.kind },

      attributes: { className: `git-edge git-edge-${edge.kind}` },
    }, { kind: 'primitive', attributes: [
      { name: 'class', value: v.meta(`git-edge git-edge-${edge.kind}`) }, { name: 'data-from', value: v.identity('from') }, { name: 'data-to', value: v.identity('to') },
      { name: 'points', value: v.geometry('points'), format: 'round3' }, ...PAINT_ATTRIBUTES, { name: 'stroke-dasharray', value: v.paint('strokeDasharray') },
    ] }))
  }
  for (const commit of diagram.commits) parts.push(renderCommit(marks, commit, diagram, paints))
  parts.push(marks.documentClose())
  return { family: 'gitgraph', width: diagram.width, height: diagram.height, colors, transparent, parts }
}

function renderCommit<T>(marks: DrawingFactory<T>, commit: PositionedGitGraphCommit, diagram: PositionedGitGraphDiagram, paints: GitGraphPaints): T {
  const visualType = commit.customType ?? commit.type
  const geometry = commitGeometry(commit)
  const branchPaint = paints.branches.get(commit.branch)!
  const fill = visualType === 'HIGHLIGHT' ? branchPaint.highlight : visualType === 'MERGE' ? branchPaint.line : branchPaint.normalFill
  const stroke = branchPaint.line
  const children: Array<{ node: T; indent: number }> = [
    { node: marks.shape({ id: semanticChildId(commit.id, 'shape'), role: 'chrome', geometry, paint: { fill, stroke, strokeWidth: '2' }, channels: { status: visualType.toLowerCase(), category: commit.branch } }, COMMIT_EMISSIONS[geometry.kind as keyof typeof COMMIT_EMISSIONS]), indent: 2 },
  ]
  if (visualType === 'MERGE') {
    children.push({ node: marks.shape({ id: semanticChildId(commit.id, 'inner'), role: 'chrome', geometry: { kind: 'circle', cx: commit.x, cy: commit.y, r: 5 }, paint: { fill: 'none', stroke: 'var(--bg)', strokeWidth: '1.5' } }, INNER_EMISSION), indent: 2 })
  }
  if (visualType === 'REVERSE') {
    for (const sign of [-1, 1]) children.push({ node: marks.shape({ id: semanticChildId(commit.id, 'cross', sign), role: 'chrome', geometry: { kind: 'line', x1: commit.x - 6, y1: commit.y + sign * 6, x2: commit.x + 6, y2: commit.y - sign * 6 }, paint: { stroke: 'var(--_arrow)', strokeWidth: '2' } }, CROSS_EMISSION), indent: 2 })
  }
  if (diagram.showCommitLabel) {
    const block = commit.labelBlock ?? gitGraphText(gitGraphCommitLabel(commit), paints.commitLabelFontSize, 500)
    const label = block.text
    const extraHeight = block.height - block.lineHeight
    const labelX = diagram.direction === 'LR' ? commit.x : commit.x + 14
    const labelY = commit.y + gitCommitLabelY(block, diagram.direction)
    const anchor = diagram.direction === 'LR' ? 'middle' : 'start'
    const rotation = diagram.direction === 'LR' && diagram.rotateCommitLabel
      ? { kind: 'rotate' as const, angle: 45, cx: r(labelX), cy: r(labelY) }
      : undefined
    if (paints.commitLabelBackground) {
      const width = r(Math.max(18, block.width + GITGRAPH_COMMIT_LABEL_PADDING_X * 2))
      const backgroundX = r(anchor === 'middle' ? labelX - width / 2 : labelX - GITGRAPH_COMMIT_LABEL_PADDING_X)
      children.push({ node: marks.shape({ id: semanticChildId(commit.id, 'label-bg'), role: 'chrome', geometry: { kind: 'rect', x: backgroundX, y: labelY - block.fontSize - extraHeight / 2, width, height: block.fontSize + 6 + extraHeight, rx: 3, ry: 3 }, paint: { fill: paints.commitLabelBackground, fillOpacity: '0.94', stroke: branchPaint.line, strokeWidth: '0.75' }, transform: rotation, attributes: { className: 'git-commit-label-background' } }, BACKGROUND_EMISSIONS.commit), indent: 2 })
    }
    children.push({ node: marks.text({ id: semanticChildId(commit.id, 'label'), role: 'label', text: label, block, x: labelX, y: labelY - block.fontSize * 0.35, fontSize: block.fontSize, fontWeight: block.fontWeight, letterSpacing: block.letterSpacing, anchor, paint: { fill: paints.commitLabelColor }, transform: rotation ,
      attributes: { className: 'git-commit-label' },
    }, COMMIT_LABEL_EMISSION), indent: 2 })
  }
  const tagBlocks = commit.tagBlocks ?? commit.tags.map(tag => gitGraphText(tag, 10, 600))
  commit.tags.forEach((tag, index) => {
    const block = tagBlocks[index]!
    const extraHeight = block.height - block.lineHeight
    const x = commit.x + 14
    const y = commit.y + gitTagOffset(tagBlocks, index)
    const width = r(block.width + 10)
    children.push({ node: marks.shape({
      id: semanticChildId(commit.id, 'tag-bg', index), role: 'chrome',
      geometry: { kind: 'rect', x: x - 4, y: y - block.fontSize - 1 - extraHeight / 2, width, height: block.fontSize + 5 + extraHeight, rx: 4, ry: 4 },
      paint: { fill: branchPaint.labelBackground, stroke: branchPaint.line, strokeWidth: '0.75' },

      attributes: { className: 'git-tag-background' },
    }, BACKGROUND_EMISSIONS.tag), indent: 2 })
    children.push({ node: marks.text({ id: semanticChildId(commit.id, 'tag', index), role: 'label', text: block.text, block, x, y: y - block.fontSize * 0.35, fontSize: block.fontSize, fontWeight: block.fontWeight, letterSpacing: block.letterSpacing, anchor: 'start', paint: { fill: branchPaint.label } ,
      attributes: { className: 'git-tag' },
    }, TAG_EMISSION), indent: 2 })
  })
  return marks.group({
    id: commit.id, role: 'node', channels: { status: visualType.toLowerCase(), category: commit.branch },
    emission: { kind: 'group', attributes: [
      { name: 'class', value: v.meta(`git-commit type-${visualType.toLowerCase()}`) }, { name: 'data-id', value: v.identity('id') },
      { name: 'data-branch', value: v.channel('category') }, { name: 'data-commit-type', value: v.meta(commit.type) },
      ...(visualType !== commit.type ? [{ name: 'data-visual-type' as const, value: v.meta(visualType) }] : []),
    ] }, children,
  })
}

function commitGeometry(commit: PositionedGitGraphCommit): Geometry {
  const type = commit.customType ?? commit.type
  // Layout can produce binary float tails (for example 248.04000000000002);
  // the drawn geometry is rounded to three decimals.
  if (type === 'HIGHLIGHT') return { kind: 'rect', x: r(commit.x - 9), y: r(commit.y - 9), width: 18, height: 18, rx: 2, ry: 2 }
  if (type === 'CHERRY_PICK')
    return {
      kind: 'polygon',
      points: [
        { x: r(commit.x), y: r(commit.y - 10) },
        { x: r(commit.x + 10), y: r(commit.y) },
        { x: r(commit.x), y: r(commit.y + 10) },
        { x: r(commit.x - 10), y: r(commit.y) },
      ],
    }
  return { kind: 'circle', cx: r(commit.x), cy: r(commit.y), r: type === 'MERGE' ? 10 : 8 }
}

interface GitGraphBranchPaint {
  line: string
  label: string
  highlight: string
  normalFill: string
  labelBackground: string
}
interface GitGraphPaints {
  branches: Map<string, GitGraphBranchPaint>
  commitLabelColor: string
  commitLabelBackground?: string
  commitLabelFontSize: number
}

function gitGraphPaints(diagram: PositionedGitGraphDiagram, raw: unknown, colors: DiagramColors): GitGraphPaints {
  const vars = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const rawAccent = typeof colors.accent === 'string' ? colors.accent : '#3b82f6'
  const rawBg = typeof colors.bg === 'string' ? colors.bg : '#ffffff'
  const accent = /^#[0-9a-f]{6}$/i.test(rawAccent) ? rawAccent : '#3b82f6'
  const bg = /^#[0-9a-f]{6}$/i.test(rawBg) ? rawBg : '#ffffff'
  // GitGraph's <=6 path historically used strict six-digit fallbacks. Above
  // the compatibility boundary, pass through supported CSS spellings so the
  // shared waist can normalize and repair them against the actual background.
  const derivedPalette = categoricalPalette(diagram.branches.length, diagram.branches.length <= 6 ? { accent, bg } : { accent: rawAccent, bg: rawBg })
  const branches = new Map<string, GitGraphBranchPaint>()
  diagram.branches.forEach((branch, index) => {
    const paletteIndex = index % 8
    const line = safeCssPaint(vars[`git${paletteIndex}`]) ?? derivedPalette[index]!
    const rawLabel = safeCssPaint(vars[`gitBranchLabel${paletteIndex}`]) ?? line
    const highlight = safeCssPaint(vars[`gitInv${paletteIndex}`]) ?? line
    const normalFill = isHexColor(line) && isHexColor(bg) ? mixHex(line, bg, 18) : 'var(--_node-fill)'
    const labelBackground = isHexColor(line) && isHexColor(bg) ? mixHex(line, bg, 9) : 'var(--bg)'
    const label = ensureContrast(rawLabel, labelBackground, 4.5, colors.fg)
    branches.set(branch.name, { line, label, highlight, normalFill, labelBackground })
  })
  const commitLabelFontSize = resolveGitGraphCommitLabelFontSize(vars)
  return {
    branches,
    commitLabelColor: safeCssPaint(vars.commitLabelColor) ?? 'var(--_text-sec)',
    commitLabelBackground: safeCssPaint(vars.commitLabelBackground) ?? (isHexColor(bg) ? bg : 'var(--bg)'),
    commitLabelFontSize,
  }
}

function r(value: number): number {
  return Math.round(value * 1000) / 1000
}

export const lowerGitGraphScene = sceneLowering<PositionedGitGraphDiagram>(lowerGitGraphDrawing)
