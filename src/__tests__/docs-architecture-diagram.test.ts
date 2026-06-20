/**
 * Dogfooding determinism snapshot for the system-architecture figure.
 *
 * The architecture diagram in docs/design/system/ is authored as Mermaid source
 * (`architecture.mmd`) and rendered to a committed SVG artifact (`architecture.svg`)
 * by our own renderer. This test re-renders the source and asserts:
 *   (a) the render is deterministic across calls, and
 *   (b) it matches the committed artifact (after whitespace normalization),
 * so the figure embedded in the docs can never silently drift from its source.
 *
 * Regenerate the artifact after an intentional source/renderer change:
 *   UPDATE_GOLDEN=1 bun test src/__tests__/docs-architecture-diagram.test.ts
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderMermaidSVG } from '../index.ts'

const systemDir = join(import.meta.dir, '..', '..', 'docs', 'design', 'system')
const sourcePath = join(systemDir, 'architecture.mmd')
const goldenPath = join(systemDir, 'architecture.svg')

function normalizeSvg(svg: string): string {
  return svg
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
}

describe('docs/design/system architecture figure', () => {
  const source = readFileSync(sourcePath, 'utf-8')

  it('renders deterministically across calls', () => {
    expect(renderMermaidSVG(source)).toBe(renderMermaidSVG(source))
  })

  it('matches the committed architecture.svg (regenerate with UPDATE_GOLDEN=1)', () => {
    const actual = renderMermaidSVG(source)
    if (process.env.UPDATE_GOLDEN) writeFileSync(goldenPath, actual)
    const expected = readFileSync(goldenPath, 'utf-8')
    expect(normalizeSvg(actual)).toBe(normalizeSvg(expected))
  })
})
