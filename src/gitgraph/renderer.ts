import type { RenderContext } from '../types.ts'
import type { PositionedGitGraphCommit, PositionedGitGraphDiagram } from './types.ts'
import type { SceneDoc, SceneNode, Geometry } from '../scene/ir.ts'
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
  parts.push(marks.raw({ id: 'acc-title', role: 'chrome' }, `<title id="${titleId}">${escapeXml(diagram.accessibilityTitle ?? 'Git graph')}</title>`))
  if (diagram.accessibilityDescription) parts.push(marks.raw({ id: 'acc-desc', role: 'chrome' }, `<desc id="${descId}">${escapeXml(diagram.accessibilityDescription)}</desc>`))
  if (diagram.title) parts.push(marks.text({
    id: 'gitgraph-visible-title', role: 'title', text: diagram.title,
    x: diagram.width / 2, y: 24, fontSize: 16, anchor: 'middle', paint: { fill: 'var(--_text)' },
  }, `<text class="gitgraph-title" data-id="gitgraph-title" x="${r(diagram.width / 2)}" y="24" text-anchor="middle" font-size="16" font-weight="600" fill="var(--_text)">${escapeXml(diagram.title)}</text>`))

  if (diagram.showBranches) {
    for (const branch of diagram.branches) {
      const branchId = semanticNamespacedId('branch', branch.name)
      const branchPaint = paints.branches.get(branch.name)!
      const labelX = diagram.direction === 'LR' ? branch.x1 - 10 : branch.x1
      const labelY = diagram.direction === 'LR' ? branch.y1 : branch.y1 - 16
      parts.push(marks.group({
        id: branchId, role: 'group', channels: { category: branch.name },
        open: `<g class="git-branch" data-id="${escapeAttr(branchId)}" data-branch="${escapeAttr(branch.name)}">`,
        close: '</g>',
        children: [
          { node: marks.shape({
            id: semanticChildId(branchId, 'line'), role: 'rail',
            geometry: { kind: 'line', x1: branch.x1, y1: branch.y1, x2: branch.x2, y2: branch.y2 },
            paint: { stroke: branchPaint.line, strokeWidth: '3', opacity: '0.72' },
            channels: { category: branch.name },
          }, `<line class="git-branch-line" data-branch="${escapeAttr(branch.name)}" x1="${r(branch.x1)}" y1="${r(branch.y1)}" x2="${r(branch.x2)}" y2="${r(branch.y2)}" stroke="${escapeAttr(branchPaint.line)}" stroke-width="3" opacity="0.72" />`), indent: 2 },
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
      channels: { category: edge.kind },
    }, `<polyline class="git-edge git-edge-${edge.kind}" data-from="${escapeAttr(edge.from)}" data-to="${escapeAttr(edge.to)}" points="${points}" fill="none" stroke="${escapeAttr(edgePaint)}" stroke-width="${edge.kind === 'parent' ? 2 : 2.5}"${edge.kind === 'cherry-pick' ? ' stroke-dasharray="4 3"' : ''} />`))
  }
  for (const commit of diagram.commits) parts.push(renderCommit(commit, diagram, paints))
  parts.push(marks.raw({ id: 'svg-close', role: 'chrome' }, '</svg>'))
  return { family: 'gitgraph', width: diagram.width, height: diagram.height, colors, parts }
}

function renderCommit(commit: PositionedGitGraphCommit, diagram: PositionedGitGraphDiagram, paints: GitGraphPaints): SceneNode {
  const visualType = commit.customType ?? commit.type
  const geometry = commitGeometry(commit)
  const branchPaint = paints.branches.get(commit.branch)!
  const fill = visualType === 'HIGHLIGHT' ? branchPaint.highlight : visualType === 'MERGE' ? branchPaint.line : 'var(--_node-fill)'
  const stroke = visualType === 'CHERRY_PICK' ? branchPaint.line : 'var(--_node-stroke)'
  const children: Array<{ node: SceneNode; indent: number }> = [
    { node: marks.shape({ id: semanticChildId(commit.id, 'shape'), role: 'chrome', geometry, paint: { fill, stroke, strokeWidth: '2' }, channels: { status: visualType.toLowerCase(), category: commit.branch } }, geometrySvg(geometry, fill, stroke)), indent: 2 },
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
    const transform = diagram.direction === 'LR' && diagram.rotateCommitLabel ? ` transform="rotate(45 ${r(labelX)} ${r(labelY)})"` : ''
    if (paints.commitLabelBackground) {
      const width = Math.max(18, measureTextWidth(label, paints.commitLabelFontSize, 500) + 8)
      const backgroundX = anchor === 'middle' ? labelX - width / 2 : labelX - 4
      children.push({ node: marks.shape({ id: semanticChildId(commit.id, 'label-bg'), role: 'chrome', geometry: { kind: 'rect', x: backgroundX, y: labelY - paints.commitLabelFontSize, width, height: paints.commitLabelFontSize + 6, rx: 3, ry: 3 }, paint: { fill: paints.commitLabelBackground } }, `<rect class="git-commit-label-background" x="${r(backgroundX)}" y="${r(labelY - paints.commitLabelFontSize)}" width="${r(width)}" height="${r(paints.commitLabelFontSize + 6)}" rx="3" fill="${escapeAttr(paints.commitLabelBackground)}"${transform} />`), indent: 2 })
    }
    children.push({ node: marks.text({ id: semanticChildId(commit.id, 'label'), role: 'label', text: label, x: labelX, y: labelY, fontSize: paints.commitLabelFontSize, anchor, paint: { fill: paints.commitLabelColor } }, `<text class="git-commit-label" x="${r(labelX)}" y="${r(labelY)}" text-anchor="${anchor}" font-size="${r(paints.commitLabelFontSize)}" fill="${escapeAttr(paints.commitLabelColor)}"${transform}>${escapeXml(label)}</text>`), indent: 2 })
  }
  commit.tags.forEach((tag, index) => {
    const x = commit.x + 14
    const y = commit.y - 14 - index * 14
    children.push({ node: marks.text({ id: semanticChildId(commit.id, 'tag', index), role: 'label', text: tag, x, y, fontSize: 9, anchor: 'start', paint: { fill: 'var(--_arrow)' } }, `<text class="git-tag" x="${r(x)}" y="${r(y)}" text-anchor="start" font-size="9" font-weight="600" fill="var(--_arrow)">${escapeXml(tag)}</text>`), indent: 2 })
  })
  return marks.group({
    id: commit.id, role: 'node', channels: { status: visualType.toLowerCase(), category: commit.branch },
    open: `<g class="git-commit type-${visualType.toLowerCase()}" data-id="${escapeAttr(commit.id)}" data-branch="${escapeAttr(commit.branch)}" data-commit-type="${commit.type}"${visualType !== commit.type ? ` data-visual-type="${visualType}"` : ''}>`,
    close: '</g>', children,
  })
}

function commitGeometry(commit: PositionedGitGraphCommit): Geometry {
  const type = commit.customType ?? commit.type
  if (type === 'HIGHLIGHT') return { kind: 'rect', x: commit.x - 9, y: commit.y - 9, width: 18, height: 18, rx: 2, ry: 2 }
  if (type === 'CHERRY_PICK') return { kind: 'polygon', points: [{ x: commit.x, y: commit.y - 10 }, { x: commit.x + 10, y: commit.y }, { x: commit.x, y: commit.y + 10 }, { x: commit.x - 10, y: commit.y }] }
  return { kind: 'circle', cx: commit.x, cy: commit.y, r: type === 'MERGE' ? 10 : 8 }
}

function geometrySvg(geometry: Geometry, fill: string, stroke: string): string {
  if (geometry.kind === 'rect') return `<rect x="${r(geometry.x)}" y="${r(geometry.y)}" width="${r(geometry.width)}" height="${r(geometry.height)}" rx="${geometry.rx ?? 0}" ry="${geometry.ry ?? 0}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`
  if (geometry.kind === 'polygon') return `<polygon points="${geometry.points.map(point => `${r(point.x)},${r(point.y)}`).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`
  if (geometry.kind === 'circle') return `<circle cx="${r(geometry.cx)}" cy="${r(geometry.cy)}" r="${r(geometry.r)}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`
  return ''
}

interface GitGraphBranchPaint { line: string; label: string; highlight: string }
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
    const label = safeCssColor(vars[`gitBranchLabel${paletteIndex}`]) ?? line
    const highlight = safeCssColor(vars[`gitInv${paletteIndex}`]) ?? line
    branches.set(branch.name, { line, label, highlight })
  })
  const commitLabelFontSize = resolveGitGraphCommitLabelFontSize(vars)
  return {
    branches,
    commitLabelColor: safeCssColor(vars.commitLabelColor) ?? 'var(--_text-sec)',
    ...(safeCssColor(vars.commitLabelBackground) ? { commitLabelBackground: safeCssColor(vars.commitLabelBackground)! } : {}),
    commitLabelFontSize,
  }
}

export function resolveGitGraphCommitLabelFontSize(raw: unknown): number {
  const vars = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const value = vars.commitLabelFontSize
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : 11
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 11
}

function r(value: number): number { return Math.round(value * 1000) / 1000 }
