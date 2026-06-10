// ============================================================================
// Tests for the Mermaid family-usage counter (BUILD-5 evidence step).
//
// Golden-input fixture: eval/family-usage/__fixtures__/corpus contains a known
// set of markdown files with a known distribution of ```mermaid families. The
// counter must reproduce that distribution exactly.
// ============================================================================

import { describe, it, expect } from 'bun:test'
import { join } from 'node:path'
import {
  familyFromHeader,
  headerOfBlock,
  extractMermaidBlocks,
  countMarkdown,
  countDirectories,
  rankCounts,
} from './count.ts'

const FIXTURE_DIR = join(import.meta.dir, '__fixtures__', 'corpus')

describe('familyFromHeader', () => {
  it('maps canonical headers to families', () => {
    expect(familyFromHeader('pie title Pets')).toBe('pie')
    expect(familyFromHeader('pie showData')).toBe('pie')
    expect(familyFromHeader('flowchart TD')).toBe('flowchart')
    expect(familyFromHeader('graph LR')).toBe('flowchart')
    expect(familyFromHeader('gitGraph')).toBe('gitgraph')
    expect(familyFromHeader('mindmap')).toBe('mindmap')
    expect(familyFromHeader('gantt')).toBe('gantt')
  })

  it('is case-insensitive and tolerant of trailing tokens', () => {
    expect(familyFromHeader('SequenceDiagram')).toBe('sequence')
    expect(familyFromHeader('stateDiagram-v2')).toBe('state')
    expect(familyFromHeader('erDiagram')).toBe('er')
  })

  it('never drops an unknown header — buckets it visibly', () => {
    expect(familyFromHeader('wibblechart foo')).toBe('other:wibblechart')
    expect(familyFromHeader('')).toBe('unknown')
  })
})

describe('headerOfBlock', () => {
  it('skips YAML frontmatter and comments to find the header', () => {
    const body = '---\ntitle: T\n---\npie showData\n  "A" : 1'
    expect(headerOfBlock(body)).toBe('pie showData')
  })

  it('skips %% comment lines', () => {
    expect(headerOfBlock('%% a comment\nquadrantChart')).toBe('quadrantChart')
  })

  it('returns null for an empty block', () => {
    expect(headerOfBlock('\n   \n')).toBeNull()
  })
})

describe('extractMermaidBlocks', () => {
  it('extracts backtick and tilde fences and ignores non-mermaid fences', () => {
    const md = [
      '```mermaid',
      'pie',
      '```',
      '```ts',
      'not mermaid',
      '```',
      '~~~mermaid',
      'gantt',
      '~~~',
    ].join('\n')
    const blocks = extractMermaidBlocks(md)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toContain('pie')
    expect(blocks[1]).toContain('gantt')
  })
})

describe('countMarkdown', () => {
  it('counts multiple families in one document', () => {
    const counts: Record<string, number> = {}
    const md = '```mermaid\npie\n```\n```mermaid\nflowchart TD\nA-->B\n```'
    const n = countMarkdown(md, counts)
    expect(n).toBe(2)
    expect(counts.pie).toBe(1)
    expect(counts.flowchart).toBe(1)
  })
})

describe('countDirectories — golden fixture corpus', () => {
  const result = countDirectories([FIXTURE_DIR])

  it('scans only markdown files (ignores the .txt decoy)', () => {
    // a.md, c.md, nested/b.markdown — the .txt file is not scanned.
    expect(result.filesScanned).toBe(3)
  })

  it('reproduces the exact known family distribution', () => {
    expect(result.counts).toEqual({
      flowchart: 2,
      pie: 3,
      sequence: 1,
      gantt: 1,
      mindmap: 1,
      gitgraph: 1,
      quadrant: 1,
    })
  })

  it('totals all counted blocks', () => {
    expect(result.totalBlocks).toBe(10)
  })

  it('ranks pie above the single-occurrence families', () => {
    const ranked = rankCounts(result.counts)
    expect(ranked[0]).toEqual(['pie', 3])
    expect(ranked[1]).toEqual(['flowchart', 2])
    // The single-count families follow, alphabetically ordered on ties.
    const tail = ranked.slice(2).map(([family]) => family)
    expect(tail).toEqual(['gantt', 'gitgraph', 'mindmap', 'quadrant', 'sequence'])
  })
})
