#!/usr/bin/env bun
// Rank direct GitHub forks before spending issue/PR/code-search quota.
//
// Usage:
//   bun run scripts/research/fork-journey-crawl.ts lukilabs/beautiful-mermaid --limit 20
//   GITHUB_TOKEN=... bun run scripts/research/fork-journey-crawl.ts mermaid-js/mermaid --max-forks 300 --limit 30
//
// The script intentionally does not crawl every direct fork's issues by default.
// GitHub fork sets are noisy; ranking first lets research passes inspect the
// forks most likely to contain independent user demand or divergent work.

interface ForkRepo {
  full_name: string
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  pushed_at: string
  updated_at: string
  html_url: string
}

interface RankedFork extends ForkRepo {
  pushedDaysAgo: number
  score: number
}

const args = process.argv.slice(2)
const target = args.find(arg => !arg.startsWith('--'))
if (!target || !/^[^/]+\/[^/]+$/.test(target)) {
  console.error('Usage: bun run scripts/research/fork-journey-crawl.ts owner/repo [--max-forks N] [--limit N]')
  process.exit(2)
}

const maxForks = readNumberArg('--max-forks', 200)
const limit = readNumberArg('--limit', 25)
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN

const forks = await fetchForks(target, maxForks)
const ranked = forks
  .map(rankFork)
  .sort((a, b) => b.score - a.score || b.stargazers_count - a.stargazers_count || a.pushedDaysAgo - b.pushedDaysAgo)
  .slice(0, limit)

console.log(JSON.stringify({
  target,
  fetchedForks: forks.length,
  rankedAt: new Date().toISOString(),
  ranking: {
    formula: 'stars*10 + forks*3 + openIssues*1.5 + recencyBoost(pushed_at)',
    recencyBoost: '30 for <=30d, 15 for <=90d, 5 for <=365d, else 0',
  },
  forks: ranked.map(fork => ({
    repo: fork.full_name,
    score: Number(fork.score.toFixed(2)),
    stars: fork.stargazers_count,
    forks: fork.forks_count,
    openIssues: fork.open_issues_count,
    pushedAt: fork.pushed_at,
    pushedDaysAgo: fork.pushedDaysAgo,
    url: fork.html_url,
  })),
  searchCommands: buildSearchCommands(ranked.map(fork => fork.full_name)),
}, null, 2))

function readNumberArg(name: string, fallback: number): number {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  const value = Number(args[index + 1])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

async function fetchForks(repo: string, max: number): Promise<ForkRepo[]> {
  const out: ForkRepo[] = []
  for (let page = 1; out.length < max; page++) {
    const url = `https://api.github.com/repos/${repo}/forks?sort=stargazers&per_page=100&page=${page}`
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'agentic-mermaid-fork-crawl',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub fork fetch failed (${response.status}) for ${url}: ${await response.text()}`)
    }
    const pageForks = await response.json() as ForkRepo[]
    if (pageForks.length === 0) break
    out.push(...pageForks)
  }
  return out.slice(0, max)
}

function rankFork(repo: ForkRepo): RankedFork {
  const pushedDaysAgo = daysAgo(repo.pushed_at)
  const recency = pushedDaysAgo <= 30 ? 30
    : pushedDaysAgo <= 90 ? 15
      : pushedDaysAgo <= 365 ? 5
        : 0
  return {
    ...repo,
    pushedDaysAgo,
    score: repo.stargazers_count * 10
      + repo.forks_count * 3
      + repo.open_issues_count * 1.5
      + recency,
  }
}

function daysAgo(iso: string): number {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000))
}

function buildSearchCommands(repos: string[]): string[] {
  const chunks: string[][] = []
  for (let i = 0; i < repos.length; i += 10) chunks.push(repos.slice(i, i + 10))
  return chunks.flatMap(chunk => {
    const repoArgs = chunk.map(repo => `--repo ${shellQuote(repo)}`).join(' ')
    return [
      `gh search issues journey ${repoArgs} --limit 100 --json repository,number,title,state,url`,
      `gh search prs journey ${repoArgs} --limit 100 --json repository,number,title,state,url`,
      `gh search code journey ${repoArgs} --limit 100 --json repository,path,url`,
    ]
  })
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
