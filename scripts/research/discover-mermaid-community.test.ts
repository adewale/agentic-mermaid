import { expect, test } from 'bun:test'
import { mergeCandidates, repositoryIdentity } from './discover-mermaid-community.ts'

test('retains an unpublished editor as a candidate without assuming renderer ownership', () => {
  const candidates = mergeCandidates([], [{ id: 'example/editor', repo: 'https://github.com/example/editor', description: 'Mermaid sharing and annotations',
    sources: [{ service: 'github', query: 'mermaid editor', page: 1, url: 'https://github.com/example/editor' }] }])
  expect(candidates).toHaveLength(1)
  expect(candidates[0]).toMatchObject({ id: 'example/editor', categories: [], knownMember: false, classification: 'needs-source-review' })
})

test('combines registry and GitHub discoveries while retaining their query provenance and curated categories', () => {
  const repository = repositoryIdentity('git+ssh://git@github.com/Example/Editor.git')!
  const candidates = mergeCandidates([{ id: 'example/editor', categories: ['editor', 'integration'] }], [
    { id: 'example/editor', repo: 'https://github.com/example/editor', sources: [{ service: 'github', query: 'mermaid editor', page: 1, url: 'https://github.com/example/editor' }] },
    { ...repository, packages: ['some-editor'], sources: [{ service: 'npm', query: 'mermaid export', page: 2, url: 'https://registry.npmjs.org/-/v1/search' }] },
  ])
  expect(candidates).toHaveLength(1)
  expect(candidates[0]?.categories).toEqual(['editor', 'integration'])
  expect(candidates[0]?.packages).toEqual(['some-editor'])
  expect(candidates[0]?.sources.map(source => [source.service, source.page])).toEqual([['github', 1], ['npm', 2]])
  expect(repositoryIdentity('https://github.com/Example/Editor/tree/main')).toEqual(repository)
  expect(repositoryIdentity('https://gitlab.com/example/editor')).toBeUndefined()
})
