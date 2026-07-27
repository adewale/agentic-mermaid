import { describe, expect, test } from 'bun:test'
import { publishedVersionProblem } from '../../scripts/ci/published-version.ts'

describe('premerge immutable npm version gate', () => {
  const identity = {
    name: 'agentic-mermaid',
    version: '1.2.3',
    localTreeHash: 'tree-local',
  }

  test('allows a version that does not exist on npm', () => {
    expect(publishedVersionProblem({ ...identity, publishedTreeHash: null })).toBeNull()
  })

  test('allows an idempotent retry of byte-identical package contents', () => {
    expect(publishedVersionProblem({ ...identity, publishedTreeHash: 'tree-local' })).toBeNull()
  })

  test('rejects divergent contents under an immutable published version', () => {
    expect(publishedVersionProblem({ ...identity, publishedTreeHash: 'tree-published' }))
      .toContain('bump the package version before merging')
  })
})
