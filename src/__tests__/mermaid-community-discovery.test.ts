import { expect, test } from 'bun:test'
import { mergeCandidates, repositoryIdentity } from '../../scripts/research/discover-mermaid-community.ts'

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

test('recognises a curated npm package without repository search metadata and merges its provenance', () => {
  const members = [{ id: 'example/editor', categories: ['editor'], packages: [{ registry: 'npm', name: 'known-editor' }] }]
  const sources = [
    { service: 'npm' as const, query: 'mermaid editor', page: 1, url: 'https://registry.npmjs.org/-/v1/search' },
    { service: 'github' as const, query: 'mermaid editor', page: 1, url: 'https://github.com/example/editor' },
  ]
  const candidates = mergeCandidates(members, [
    { id: 'npm:known-editor', packages: ['known-editor'], sources: [sources[0]!] },
    { id: 'example/editor', repo: 'https://github.com/example/editor', sources: [sources[1]!] },
  ])
  expect(candidates).toHaveLength(1)
  expect(candidates[0]).toMatchObject({ id: 'example/editor', knownMember: true, categories: ['editor'], classification: 'catalogued', packages: ['known-editor'], sources })
})

test.each(['conflicting repository', 'known repository with conflicting ownership', 'ambiguous package ownership'])('retains %s for source review', scenario => {
  const members = [{ id: 'example/editor', categories: ['editor'], packages: [{ registry: 'npm', name: 'known-editor' }] }]
  if (scenario === 'ambiguous package ownership') members.push({ ...members[0]!, id: 'other/editor' })
  if (scenario === 'known repository with conflicting ownership') members.push({ id: 'other/editor', categories: ['renderer'], packages: [] })
  const hasRepository = scenario !== 'ambiguous package ownership'
  const hit = { id: hasRepository ? 'other/editor' : 'npm:known-editor',
    ...(hasRepository ? { repo: 'https://github.com/other/editor' } : {}), packages: ['known-editor'],
    sources: [{ service: 'npm' as const, query: 'mermaid editor', page: 1, url: 'https://registry.npmjs.org/-/v1/search' }] }
  const candidates = mergeCandidates(members, [hit])
  expect(candidates[0]).toMatchObject({ id: hit.id, classification: 'needs-source-review', identityConflict: true, sources: hit.sources })
})
