import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { compareCodePointStrings } from '../../src/shared/deterministic-order.ts'
import {
  classifyResearchText,
  DEFAULT_RESEARCH_WEIGHTING,
  digestText,
  emptyReactionCounts,
  RESEARCH_REPOSITORIES,
  RESEARCH_SCHEMA_VERSION,
  researchHarvestDigest,
  scoreResearchItem,
  validateResearchHarvest,
  type ReactionCounts,
  type RepositoryHarvestSummary,
  type ResearchHarvest,
  type ResearchItem,
  type ResearchItemKind,
  type ResearchRepository,
} from './research.ts'

const ROOT = resolve(import.meta.dir, '../..')
export const RESEARCH_HARVEST_PATH = resolve(import.meta.dir, 'github-demand-harvest.json.gz')

interface GhAuthor {
  login?: string
  __typename?: string
}

interface GhReactionGroup {
  content: string
  users?: { totalCount?: number }
}

interface GhItem {
  number: number
  title: string
  body?: string
  url: string
  state: string
  createdAt: string
  updatedAt: string
  closedAt?: string | null
  mergedAt?: string | null
  isDraft?: boolean
  author?: GhAuthor | null
  labels?: { nodes?: Array<{ name?: string } | null> }
  comments?: { totalCount?: number }
  participants?: { totalCount?: number }
  reviews?: { totalCount?: number }
  reactionGroups?: GhReactionGroup[]
}

interface GhPage {
  nodes?: Array<GhItem | null>
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
  totalCount?: number
}

interface GhResponse {
  data?: {
    repository?: {
      issues?: GhPage
      pullRequests?: GhPage
    } | null
  }
}

const COMMON_FIELDS = `
  number
  title
  body
  url
  state
  createdAt
  updatedAt
  closedAt
  author { login __typename }
  labels(first: 100) { nodes { name } }
  comments(first: 1) { totalCount }
  participants(first: 1) { totalCount }
  reactionGroups { content users { totalCount } }
`

const ISSUE_QUERY = `
  query RepositoryIssues($owner: String!, $name: String!, $cursor: String, $pageSize: Int!) {
    repository(owner: $owner, name: $name) {
      issues(first: $pageSize, after: $cursor, orderBy: { field: CREATED_AT, direction: ASC }) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ${COMMON_FIELDS} }
      }
    }
  }
`

const PULL_REQUEST_QUERY = `
  query RepositoryPullRequests($owner: String!, $name: String!, $cursor: String, $pageSize: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequests(first: $pageSize, after: $cursor, orderBy: { field: CREATED_AT, direction: ASC }) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          ${COMMON_FIELDS}
          mergedAt
          isDraft
          reviews(first: 1) { totalCount }
        }
      }
    }
  }
`

function runGhPage(repository: ResearchRepository, kind: ResearchItemKind, cursor: string | null, pageSize: number): GhPage {
  const [owner, name] = repository.split('/') as [string, string]
  const query = kind === 'issue' ? ISSUE_QUERY : PULL_REQUEST_QUERY
  const args = [
    'api', 'graphql', '-f', `query=${query}`,
    '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `pageSize=${pageSize}`,
  ]
  if (cursor) args.push('-F', `cursor=${cursor}`)
  const result = Bun.spawnSync(['gh', ...args], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  })
  if (result.exitCode !== 0) {
    const diagnostic = new TextDecoder().decode(result.stderr).trim()
    throw new Error(`GitHub GraphQL crawl failed for ${repository} ${kind}: ${diagnostic}`)
  }
  const response = JSON.parse(new TextDecoder().decode(result.stdout)) as GhResponse
  const page = kind === 'issue' ? response.data?.repository?.issues : response.data?.repository?.pullRequests
  if (!page) throw new Error(`GitHub GraphQL returned no ${kind} connection for ${repository}`)
  return page
}

function collectConnection(repository: ResearchRepository, kind: ResearchItemKind): GhItem[] {
  const items: GhItem[] = []
  const cursors = new Set<string>()
  let cursor: string | null = null
  let expectedTotal: number | null = null
  let pageSize = kind === 'issue' ? 100 : 50
  for (let pageNumber = 1; pageNumber <= 2_000; pageNumber++) {
    process.stdout.write(`Collecting ${repository} ${kind} page ${pageNumber} (${pageSize} items) …\n`)
    let page: GhPage
    try {
      page = runGhPage(repository, kind, cursor, pageSize)
    } catch (error) {
      if (pageSize > 1 && error instanceof Error && error.message.includes('Resource limits for this query exceeded')) {
        pageSize = Math.max(1, Math.floor(pageSize / 2))
        process.stdout.write(`Retrying ${repository} ${kind} page ${pageNumber} at ${pageSize} items …\n`)
        pageNumber--
        continue
      }
      throw error
    }
    expectedTotal ??= page.totalCount ?? null
    items.push(...(page.nodes ?? []).filter((item): item is GhItem => item !== null))
    if (!page.pageInfo?.hasNextPage) break
    const next = page.pageInfo.endCursor
    if (!next || cursors.has(next)) throw new Error(`Invalid/repeated GitHub cursor for ${repository} ${kind}`)
    cursors.add(next)
    cursor = next
    if (pageNumber === 2_000) throw new Error(`GitHub crawl exceeded the page guard for ${repository} ${kind}`)
  }
  if (expectedTotal !== null && items.length !== expectedTotal) {
    throw new Error(`GitHub count mismatch for ${repository} ${kind}: received ${items.length} of ${expectedTotal}`)
  }
  return items
}

function reactions(groups: readonly GhReactionGroup[] | undefined): ReactionCounts {
  const result = emptyReactionCounts()
  const keys: Record<string, keyof ReactionCounts> = {
    THUMBS_UP: 'thumbsUp',
    THUMBS_DOWN: 'thumbsDown',
    LAUGH: 'laugh',
    HOORAY: 'hooray',
    CONFUSED: 'confused',
    HEART: 'heart',
    ROCKET: 'rocket',
    EYES: 'eyes',
  }
  for (const group of groups ?? []) {
    const key = keys[group.content]
    if (key) result[key] = group.users?.totalCount ?? 0
  }
  return result
}

function normalizeItem(
  repository: ResearchRepository,
  kind: ResearchItemKind,
  item: GhItem,
  referenceDate: string,
): ResearchItem {
  const body = item.body ?? ''
  const labels = (item.labels?.nodes ?? []).map(label => label?.name ?? '').filter(Boolean).sort()
  const classification = classifyResearchText(item.title, body, labels)
  const comments = item.comments?.totalCount ?? 0
  const participants = Math.max(item.author?.login ? 1 : 0, item.participants?.totalCount ?? 0)
  const reviews = item.reviews?.totalCount ?? 0
  const reactionCounts = reactions(item.reactionGroups)
  const authorIsBot = item.author?.__typename === 'Bot' || Boolean(item.author?.login?.endsWith('[bot]'))
  const weight = scoreResearchItem({
    kind,
    merged: Boolean(item.mergedAt),
    authorIsBot,
    comments,
    participants,
    reviews,
    reactions: reactionCounts,
    updatedAt: item.updatedAt,
    referenceDate,
  })
  return {
    repository,
    kind,
    number: item.number,
    title: item.title.trim(),
    url: item.url,
    state: item.state.toLowerCase(),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    closedAt: item.closedAt ?? null,
    ...(kind === 'pull-request' ? { mergedAt: item.mergedAt ?? null, draft: Boolean(item.isDraft) } : {}),
    author: item.author?.login ?? null,
    authorIsBot,
    labels,
    comments,
    participants,
    reviews,
    reactions: reactionCounts,
    bodyDigest: digestText(body),
    ...classification,
    weight,
  }
}

export function collectResearchHarvest(now = new Date()): ResearchHarvest {
  const referenceDate = now.toISOString()
  const items: ResearchItem[] = []
  const repositories: RepositoryHarvestSummary[] = []
  for (const repository of RESEARCH_REPOSITORIES) {
    const issues = collectConnection(repository, 'issue')
    const pullRequests = collectConnection(repository, 'pull-request')
    items.push(...issues.map(item => normalizeItem(repository, 'issue', item, referenceDate)))
    items.push(...pullRequests.map(item => normalizeItem(repository, 'pull-request', item, referenceDate)))
    repositories.push({
      repository,
      url: `https://github.com/${repository}`,
      issueCount: issues.length,
      pullRequestCount: pullRequests.length,
    })
  }
  items.sort((a, b) =>
    compareCodePointStrings(a.repository, b.repository) ||
    compareCodePointStrings(a.kind, b.kind) ||
    a.number - b.number,
  )
  const withoutDigest: Omit<ResearchHarvest, 'contentDigest'> = {
    schemaVersion: RESEARCH_SCHEMA_VERSION,
    capturedAt: referenceDate,
    referenceDate,
    collector: 'GitHub GraphQL repository pagination v1',
    collectionBoundary: 'Every issue and pull request in both repositories, paginated directly from the repository connections. Popularity uses total comment, distinct participant, review, and reaction counts. Titles, bodies, labels, states, and timestamps are classified during collection; bodies are retained only as SHA-256 digests.',
    weighting: DEFAULT_RESEARCH_WEIGHTING,
    repositories,
    items,
  }
  return { ...withoutDigest, contentDigest: researchHarvestDigest(withoutDigest) }
}

export function loadResearchHarvest(): ResearchHarvest {
  if (!existsSync(RESEARCH_HARVEST_PATH)) throw new Error(`Missing ${RESEARCH_HARVEST_PATH}; run bun run intent:github:refresh`)
  return JSON.parse(gunzipSync(readFileSync(RESEARCH_HARVEST_PATH)).toString('utf8')) as ResearchHarvest
}

export function writeResearchHarvest(harvest: ResearchHarvest): void {
  const canonical = `${JSON.stringify(harvest)}\n`
  writeFileSync(RESEARCH_HARVEST_PATH, gzipSync(canonical, { level: 9 }))
}

export function checkResearchHarvest(now = new Date()): void {
  validateResearchHarvest(loadResearchHarvest(), now)
}

if (import.meta.main) {
  if (process.argv.includes('--check')) {
    checkResearchHarvest()
  } else {
    const harvest = collectResearchHarvest()
    validateResearchHarvest(harvest)
    writeResearchHarvest(harvest)
    process.stdout.write(`Wrote ${harvest.items.length} normalized GitHub items to ${RESEARCH_HARVEST_PATH}\n`)
  }
}
