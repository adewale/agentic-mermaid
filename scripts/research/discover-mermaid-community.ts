// Broad candidate discovery. Classify source-checked members separately from
// renderer benchmark eligibility; never discard an app for using another engine.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface Candidate {
  id: string
  repo?: string
  description?: string
  packages?: string[]
  sources: { service: 'github' | 'npm'; query: string; page: number; url: string }[]
}

export function repositoryIdentity(value: string): { id: string; repo: string } | undefined {
  const match = /^(?:git\+)?(?:https?:\/\/|git:\/\/|ssh:\/\/(?:git@)?|git@)github\.com[:/]([\w.-]+)\/([\w.-]+)/i.exec(value)
  if (!match) return undefined
  const id = `${match[1]}/${match[2]!.replace(/\.git$/, '')}`
  return { id, repo: `https://github.com/${id}` }
}

export function mergeCandidates(members: { id: string; categories?: string[] }[], hits: Candidate[]) {
  const known = new Map(members.map(member => [member.id.toLowerCase(), member]))
  const candidates = new Map<string, Candidate>()
  for (const hit of hits) {
    const key = hit.id.toLowerCase(), previous = candidates.get(key)
    if (previous) {
      previous.sources.push(...hit.sources)
      previous.packages = [...new Set([...(previous.packages ?? []), ...(hit.packages ?? [])])]
    } else candidates.set(key, { ...hit, sources: [...hit.sources], packages: [...(hit.packages ?? [])] })
  }
  return [...candidates].map(([key, candidate]) => ({ ...candidate,
    knownMember: known.has(key), categories: known.get(key)?.categories ?? [],
    classification: known.has(key) ? 'catalogued' : 'needs-source-review',
  })).sort((a, b) => a.id.localeCompare(b.id, 'en'))
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const option = (flag: string, fallback?: string) => {
    const index = args.indexOf(flag)
    return index < 0 ? fallback : args[index + 1]
  }
  const out = option('--out'), pages = Number(option('--pages', '1')), perPage = Number(option('--per-page', '50'))
  if (!out || !Number.isInteger(pages) || pages < 1 || pages > 3 || !Number.isInteger(perPage) || perPage < 1 || perPage > 100
    || args.some((arg, index) => index % 2 === 0 && !['--out', '--pages', '--per-page'].includes(arg))) {
    throw new Error('Usage: bun scripts/research/discover-mermaid-community.ts --out <file> [--pages 1..3] [--per-page 1..100]')
  }
  const graph = JSON.parse(readFileSync(new URL('../../docs/mermaid-community.json', import.meta.url), 'utf8')) as {
    nodes: { id: string; categories?: string[] }[]
    method: { discovery: { githubQueries: string[]; npmQueries: string[] } }
  }
  const hits: Candidate[] = []
  const searches: { service: string; query: string; page: number; total: number; returned: number; incomplete: boolean }[] = []
  const errors: { service: string; query: string; page: number; message: string }[] = []
  const destination = resolve(out)
  if (destination === resolve(new URL('../../docs/mermaid-community.json', import.meta.url).pathname)) throw new Error('Discovery cannot overwrite the curated community inventory')
  for (const query of graph.method.discovery.githubQueries) {
    for (let page = 1; page <= pages; page++) {
      try {
        const body = JSON.parse(execFileSync('gh', ['api', '--method', 'GET', 'search/repositories', '-f', `q=${query}`, '-f', `per_page=${perPage}`, '-f', `page=${page}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })) as {
          total_count: number; incomplete_results: boolean
          items: { full_name: string; html_url: string; description: string | null }[]
        }
        searches.push({ service: 'github', query, page, total: body.total_count, returned: body.items.length,
          incomplete: body.incomplete_results || page * perPage < body.total_count })
        for (const item of body.items) hits.push({ id: item.full_name, repo: item.html_url, description: item.description ?? undefined,
          sources: [{ service: 'github', query, page, url: `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories` }] })
        if (body.items.length < perPage) break
      } catch (error) {
        errors.push({ service: 'github', query, page, message: error instanceof Error ? error.message : String(error) })
        break
      }
    }
  }
  for (const query of graph.method.discovery.npmQueries) {
    for (let page = 1; page <= pages; page++) {
      try {
        const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${perPage}&from=${(page - 1) * perPage}`
        const response = await fetch(url)
        if (!response.ok) throw new Error(`npm search ${query} failed: ${response.status}`)
        const body = await response.json() as { total: number; objects: { package: { name: string; description?: string; links?: { repository?: string } } }[] }
        searches.push({ service: 'npm', query, page, total: body.total, returned: body.objects.length, incomplete: page * perPage < body.total })
        for (const { package: pkg } of body.objects) {
          const repository = repositoryIdentity(pkg.links?.repository ?? '')
          hits.push({ ...(repository ?? { id: `npm:${pkg.name}` }), description: pkg.description, packages: [pkg.name], sources: [{ service: 'npm', query, page, url }] })
        }
        if (body.objects.length < perPage) break
      } catch (error) {
        errors.push({ service: 'npm', query, page, message: error instanceof Error ? error.message : String(error) })
        break
      }
    }
  }
  const report = { checkedAt: new Date().toISOString(), policy: 'Bounded GitHub and npm searches; no stars, fork ancestry, publication or renderer-ownership gate. Source review is required before promotion.',
    status: errors.length ? 'partial' : 'complete', limits: { pages, perPage, exhaustive: false }, searches, errors, candidates: mergeCandidates(graph.nodes, hits) }
  writeFileSync(destination, JSON.stringify(report, null, 2) + '\n')
  console.log(`${report.candidates.length} candidates (${report.candidates.filter(candidate => !candidate.knownMember).length} need source review); report: ${destination}`)
  if (errors.length) {
    console.error(`${errors.length} searches failed; retained successful results in the partial report`)
    process.exitCode = 1
  }
}
