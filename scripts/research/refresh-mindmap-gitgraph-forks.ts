import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const roots = [
  { root: 'mermaid-js/mermaid', sampleSize: 3, excluded: [] },
  { root: 'lukilabs/beautiful-mermaid', sampleSize: 2, excluded: ['adewale/agentic-mermaid'] },
  { root: 'AlexanderGrooff/mermaid-ascii', sampleSize: 1, excluded: [] },
] as const

interface GitHubFork {
  id: number
  full_name: string
  html_url: string
  stargazers_count: number
  pushed_at: string
  archived: boolean
}

const fetchedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const snapshots = []
for (const selection of roots) {
  const apiUrl = `https://api.github.com/repos/${selection.root}/forks?sort=stargazers&per_page=100&page=1`
  const response = await fetch(apiUrl, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'agentic-mermaid-audit' },
  })
  if (!response.ok) throw new Error(`${apiUrl}: ${response.status} ${response.statusText}`)
  const raw = await response.text()
  const forks = JSON.parse(raw) as GitHubFork[]
  snapshots.push({
    root: selection.root,
    apiUrl,
    responseSha256: createHash('sha256').update(raw).digest('hex'),
    returned: forks.length,
    sampleSize: selection.sampleSize,
    excluded: selection.excluded,
    forks: forks.slice(0, 10).map(fork => ({
      id: fork.id,
      repo: fork.full_name,
      url: fork.html_url,
      stars: fork.stargazers_count,
      pushedAt: fork.pushed_at,
      archived: fork.archived,
    })),
    retained: Math.min(10, forks.length),
  })
}

const snapshot = {
  schemaVersion: 1,
  fetchedAt,
  policy: {
    ranking: 'GitHub forks REST endpoint sorted by stargazers, descending',
    pageSize: 100,
    sampleRule: 'Take the first N API-ranked, non-archived forks after exclusions; preserve API order for equal-star ties. No activity cutoff.',
    exclusions: {
      'lukilabs/beautiful-mermaid': [
        'adewale/agentic-mermaid — current evaluation target; including it would make the signal self-referential.',
      ],
    },
    sampleSizes: Object.fromEntries(roots.map(root => [root.root, root.sampleSize])),
  },
  roots: snapshots,
}

const output = join(import.meta.dir, '../../eval/mindmap-gitgraph-content-corpus/fork-snapshot.json')
await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`wrote ${output}`)
