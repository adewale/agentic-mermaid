import type { RenderContext } from '../types.ts'
import type { PositionedGitGraphCommit, PositionedGitGraphDiagram } from './types.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import { serializeGeometryShape, type SerializableShapeGeometry } from '../scene/svg-serialize.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import type { DiagramColors } from '../theme.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { semanticChildId, semanticNamespacedId, semanticRelationId } from '../scene/identity.ts'
import { escapeAttr, escapeXml } from '../multiline-utils.ts'
import { safeCssColor } from '../shared/css-color.ts'
import { getSeriesColor } from '../xychart/colors.ts'
import { measureTextWidth } from '../text-metrics.ts'
import { ensureContrast, isHexColor, mixHex } from '../shared/color-math.ts'
import { resolveGitGraphCommitLabelFontSize } from './position.ts'

export function renderGitGraphSvg(ctx: RenderContext<PositionedGitGraphDiagram>): string {
  return DefaultBackend.render(lowerGitGraphScene(ctx), { seed: 0 })
}

export function lowerGitGraphScene(ctx: RenderContext<PositionedGitGraphDiagram>): SceneDoc {
  const { positioned: diagram, colors, options } = ctx
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const titleId = 'gitgraph-title'
  const descId = 'gitgraph-desc'
  const attrs = buildAccessibilityAttrs(diagram.accessibilityTitle ?? 'Git graph', diagram.accessibilityDescription, titleId, descId, 'git graph')
  const head = [svgOpenTag(diagram.width, diagram.height, colors, transparent, { attrs }), buildStyleBlock(font, false, colors.shadow, colors.embedFontImport)]
  const shadow = buildShadowDefs(colors)
  if (shadow) head.push(`<defs>${shadow}</defs>`)
  const paints = gitGraphPaints(diagram, options.mermaidConfig?.themeVariables, colors)
  const parts: SceneNode[] = [marks.prelude({ id: 'prelude', width: diagram.width, height: diagram.height, colors, transparent, font, hasMonoFont: false }, head.join('\n'))]
  parts.push(marks.documentText({ id: 'acc-title', element: 'title', domId: titleId, text: diagram.accessibilityTitle ?? 'Git graph' }))
  if (diagram.accessibilityDescription) parts.push(marks.documentText({ id: 'acc-desc', element: 'description', domId: descId, text: diagram.accessibilityDescription }))
  if (diagram.title) parts.push(marks.text({
    id: 'gitgraph-visible-title', role: 'title', text: diagram.title,
    x: diagram.width / 2, y: 24, fontSize: 16, anchor: 'middle', paint: { fill: 'var(--_text)' },
  }, `<text class="gitgraph-title" data-id="gitgraph-title" x="${r(diagram.width / 2)}" y="24" text-anchor="middle" font-size="16" font-weight="600" fill="var(--_text)">${escapeXml(diagram.title)}</text>`))

  if (diagram.showBranches) {
    for (const branch of diagram.branches) {
      const branchId = semanticNamespacedId('branch', branch.name)
      const branchPaint = paints.branches.get(branch.name)!
      const labelX = r(diagram.direction === 'LR' ? branch.x1 - 10 : branch.x1)
      const labelY = r(diagram.direction === 'LR' ? branch.y1 : branch.y1 - 16)
      const labelWidth = r(measureTextWidth(branch.name, 12, 600) + 10)
      const labelBackgroundX = r(diagram.direction === 'LR' ? labelX - labelWidth : labelX - labelWidth / 2)
      parts.push(marks.group({
        id: branchId, role: 'group', channels: { category: branch.name },
        open: `<g class="git-branch" data-id="${escapeAttr(branchId)}" data-branch="${escapeAttr(branch.name)}">`,
        close: '</g>',
        children: [
          { node: marks.shape({
            id: semanticChildId(branchId, 'label-bg'), role: 'chrome',
            geometry: { kind: 'rect', x: labelBackgroundX, y: labelY - 13, width: labelWidth, height: 18, rx: 4, ry: 4 },
            paint: { fill: branchPaint.labelBackground, stroke: branchPaint.line, strokeWidth: '1' },
          }, `<rect class="git-branch-label-background" x="${r(labelBackgroundX)}" y="${r(labelY - 13)}" width="${r(labelWidth)}" height="18" rx="4" fill="${escapeAttr(branchPaint.labelBackground)}" stroke="${escapeAttr(branchPaint.line)}" stroke-width="1" />`), indent: 2 },
          { node: marks.shape({
            id: semanticChildId(branchId, 'line'), role: 'rail',
            geometry: { kind: 'line', x1: branch.x1, y1: branch.y1, x2: branch.x2, y2: branch.y2 },
            paint: { stroke: branchPaint.line, strokeWidth: '3', opacity: '0.86' },
            channels: { category: branch.name },
          }, `<line class="git-branch-line" data-branch="${escapeAttr(branch.name)}" x1="${r(branch.x1)}" y1="${r(branch.y1)}" x2="${r(branch.x2)}" y2="${r(branch.y2)}" stroke="${escapeAttr(branchPaint.line)}" stroke-width="3" opacity="0.86" />`), indent: 2 },
          { node: marks.text({
            id: semanticChildId(branchId, 'label'), role: 'label', text: branch.name,
            x: labelX, y: labelY, fontSize: 12, anchor: diagram.direction === 'LR' ? 'end' : 'middle',
            paint: { fill: branchPaint.label }, channels: { category: branch.name },
          }, `<text class="git-branch-label" data-branch="${escapeAttr(branch.name)}" x="${r(labelX)}" y="${r(labelY)}" text-anchor="${diagram.direction === 'LR' ? 'end' : 'middle'}" font-size="12" font-weight="600" fill="${escapeAttr(branchPaint.label)}">${escapeXml(branch.name)}</text>`), indent: 2 },
        ],
      }))
    }
  }

  const commitById = new Map(diagram.commits.map(commit => [commit.id, commit]))
  for (const edge of diagram.edges) {
    const points = edge.points.map(point => `${r(point.x)},${r(point.y)}`).join(' ')
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
      projectAccessibilityToSvg: true,
      channels: { category: edge.kind },
    }, `<polyline class="git-edge git-edge-${edge.kind}" data-from="${escapeAttr(edge.from)}" data-to="${escapeAttr(edge.to)}" points="${points}" fill="none" stroke="${escapeAttr(edgePaint)}" stroke-width="${edge.kind === 'parent' ? 2 : 2.5}"${edge.kind === 'cherry-pick' ? ' stroke-dasharray="4 3"' : ''} />`))
  }
  for (const commit of diagram.commits) parts.push(renderCommit(commit, diagram, paints))
  parts.push(marks.documentClose())
  return { family: 'gitgraph', width: diagram.width, height: diagram.height, colors, parts }
}

function renderCommit(commit: PositionedGitGraphCommit, diagram: PositionedGitGraphDiagram, paints: GitGraphPaints): SceneNode {
  const visualType = commit.customType ?? commit.type
  const geometry = commitGeometry(commit)
  const branchPaint = paints.branches.get(commit.branch)!
  const fill = visualType === 'HIGHLIGHT' ? branchPaint.highlight : visualType === 'MERGE' ? branchPaint.line : branchPaint.normalFill
  const stroke = branchPaint.line
  const children: Array<{ node: SceneNode; indent: number }> = [
    { node: marks.shape({ id: semanticChildId(commit.id, 'shape'), role: 'chrome', geometry, paint: { fill, stroke, strokeWidth: '2' }, channels: { status: visualType.toLowerCase(), category: commit.branch } }, serializeGeometryShape(geometry, { fill, stroke, strokeWidth: '2' })), indent: 2 },
  ]
  if (visualType === 'MERGE') {
    children.push({ node: marks.shape({ id: semanticChildId(commit.id, 'inner'), role: 'chrome', geometry: { kind: 'circle', cx: commit.x, cy: commit.y, r: 5 }, paint: { fill: 'none', stroke: 'var(--bg)', strokeWidth: '1.5' } }, `<circle cx="${r(commit.x)}" cy="${r(commit.y)}" r="5" fill="none" stroke="var(--bg)" stroke-width="1.5" />`), indent: 2 })
  }
  if (visualType === 'REVERSE') {
    for (const sign of [-1, 1]) children.push({ node: marks.shape({ id: semanticChildId(commit.id, 'cross', sign), role: 'chrome', geometry: { kind: 'line', x1: commit.x - 6, y1: commit.y + sign * 6, x2: commit.x + 6, y2: commit.y - sign * 6 }, paint: { stroke: 'var(--_arrow)', strokeWidth: '2' } }, `<line x1="${r(commit.x - 6)}" y1="${r(commit.y + sign * 6)}" x2="${r(commit.x + 6)}" y2="${r(commit.y - sign * 6)}" stroke="var(--_arrow)" stroke-width="2" />`), indent: 2 })
  }
  if (diagram.showCommitLabel) {
    const label = commit.message || commit.id
    const labelX = diagram.direction === 'LR' ? commit.x : commit.x + 14
    const labelY = diagram.direction === 'LR' ? commit.y + 24 : commit.y + 4
    const anchor = diagram.direction === 'LR' ? 'middle' : 'start'
    const rotation = diagram.direction === 'LR' && diagram.rotateCommitLabel
      ? { kind: 'rotate' as const, angle: 45, cx: r(labelX), cy: r(labelY) }
      : undefined
    const transform = rotation ? ` transform="rotate(${rotation.angle} ${rotation.cx} ${rotation.cy})"` : ''
    if (paints.commitLabelBackground) {
      const width = r(Math.max(18, measureTextWidth(label, paints.commitLabelFontSize, 500) + 8))
      const backgroundX = r(anchor === 'middle' ? labelX - width / 2 : labelX - 4)
      children.push({ node: marks.shape({ id: semanticChildId(commit.id, 'label-bg'), role: 'chrome', geometry: { kind: 'rect', x: backgroundX, y: labelY - paints.commitLabelFontSize, width, height: paints.commitLabelFontSize + 6, rx: 3, ry: 3 }, paint: { fill: paints.commitLabelBackground, stroke: branchPaint.line, strokeWidth: '0.75' }, transform: rotation }, `<rect class="git-commit-label-background" x="${r(backgroundX)}" y="${r(labelY - paints.commitLabelFontSize)}" width="${r(width)}" height="${r(paints.commitLabelFontSize + 6)}" rx="3" fill="${escapeAttr(paints.commitLabelBackground)}" fill-opacity="0.94" stroke="${escapeAttr(branchPaint.line)}" stroke-width="0.75"${transform} />`), indent: 2 })
    }
    children.push({ node: marks.text({ id: semanticChildId(commit.id, 'label'), role: 'label', text: label, x: labelX, y: labelY, fontSize: paints.commitLabelFontSize, anchor, paint: { fill: paints.commitLabelColor }, transform: rotation }, `<text class="git-commit-label" x="${r(labelX)}" y="${r(labelY)}" text-anchor="${anchor}" font-size="${r(paints.commitLabelFontSize)}" fill="${escapeAttr(paints.commitLabelColor)}"${transform}>${escapeXml(label)}</text>`), indent: 2 })
  }
  commit.tags.forEach((tag, index) => {
    const x = commit.x + 14
    const y = commit.y - 16 - index * 17
    const width = r(measureTextWidth(tag, 10, 600) + 10)
    children.push({ node: marks.shape({
      id: semanticChildId(commit.id, 'tag-bg', index), role: 'chrome',
      geometry: { kind: 'rect', x: x - 4, y: y - 11, width, height: 15, rx: 4, ry: 4 },
      paint: { fill: branchPaint.labelBackground, stroke: branchPaint.line, strokeWidth: '0.75' },
    }, `<rect class="git-tag-background" x="${r(x - 4)}" y="${r(y - 11)}" width="${r(width)}" height="15" rx="4" fill="${escapeAttr(branchPaint.labelBackground)}" stroke="${escapeAttr(branchPaint.line)}" stroke-width="0.75" />`), indent: 2 })
    children.push({ node: marks.text({ id: semanticChildId(commit.id, 'tag', index), role: 'label', text: tag, x, y, fontSize: 10, anchor: 'start', paint: { fill: branchPaint.label } }, `<text class="git-tag" x="${r(x)}" y="${r(y)}" text-anchor="start" font-size="10" font-weight="600" fill="${escapeAttr(branchPaint.label)}">${escapeXml(tag)}</text>`), indent: 2 })
  })
  return marks.group({
    id: commit.id, role: 'node', channels: { status: visualType.toLowerCase(), category: commit.branch },
    open: `<g class="git-commit type-${visualType.toLowerCase()}" data-id="${escapeAttr(commit.id)}" data-branch="${escapeAttr(commit.branch)}" data-commit-type="${commit.type}"${visualType !== commit.type ? ` data-visual-type="${visualType}"` : ''}>`,
    close: '</g>', children,
  })
}

function commitGeometry(commit: PositionedGitGraphCommit): SerializableShapeGeometry {
  const type = commit.customType ?? commit.type
  if (type === 'HIGHLIGHT') return { kind: 'rect', x: commit.x - 9, y: commit.y - 9, width: 18, height: 18, rx: 2, ry: 2 }
  if (type === 'CHERRY_PICK') return { kind: 'polygon', points: [{ x: commit.x, y: commit.y - 10 }, { x: commit.x + 10, y: commit.y }, { x: commit.x, y: commit.y + 10 }, { x: commit.x - 10, y: commit.y }] }
  return { kind: 'circle', cx: commit.x, cy: commit.y, r: type === 'MERGE' ? 10 : 8 }
}

interface GitGraphBranchPaint { line: string; label: string; highlight: string; normalFill: string; labelBackground: string }
interface GitGraphPaints {
  branches: Map<string, GitGraphBranchPaint>
  commitLabelColor: string
  commitLabelBackground?: string
  commitLabelFontSize: number
}

function gitGraphPaints(diagram: PositionedGitGraphDiagram, raw: unknown, colors: DiagramColors): GitGraphPaints {
  const vars = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const accent = typeof colors.accent === 'string' && /^#[0-9a-f]{6}$/i.test(colors.accent) ? colors.accent : '#3b82f6'
  const bg = typeof colors.bg === 'string' && /^#[0-9a-f]{6}$/i.test(colors.bg) ? colors.bg : '#ffffff'
  const branches = new Map<string, GitGraphBranchPaint>()
  diagram.branches.forEach((branch, index) => {
    const paletteIndex = index % 8
    const line = safeCssColor(vars[`git${paletteIndex}`]) ?? getSeriesColor(index, accent, bg)
    const rawLabel = safeCssColor(vars[`gitBranchLabel${paletteIndex}`]) ?? line
    const highlight = safeCssColor(vars[`gitInv${paletteIndex}`]) ?? line
    const normalFill = isHexColor(line) && isHexColor(bg) ? mixHex(line, bg, 18) : 'var(--_node-fill)'
    const labelBackground = isHexColor(line) && isHexColor(bg) ? mixHex(line, bg, 9) : 'var(--bg)'
    const label = ensureContrast(rawLabel, labelBackground, 4.5, colors.fg)
    branches.set(branch.name, { line, label, highlight, normalFill, labelBackground })
  })
  const commitLabelFontSize = resolveGitGraphCommitLabelFontSize(vars)
  return {
    branches,
    commitLabelColor: safeCssColor(vars.commitLabelColor) ?? 'var(--_text-sec)',
    commitLabelBackground: safeCssColor(vars.commitLabelBackground) ?? (isHexColor(bg) ? bg : 'var(--bg)'),
    commitLabelFontSize,
  }
}

function r(value: number): number { return Math.round(value * 1000) / 1000 }
