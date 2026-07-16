// Homepage-coverage eval runner.
//
// Confirms that a model, given ONLY the URL https://agentic-mermaid.dev/, can
// (1) discover one of the agentic interfaces, (2) author one instance of every
// diagram family, and (3) exercise every built-in Style and Palette. The model
// returns a JSON CoverageManifest; the deterministic oracle re-verifies every
// claim against the shipped SDK.
//
// Two discovery modes:
//   --discovery browsing  (default)  the model is handed the bare URL and must
//        fetch /start.md, /capabilities.json and list styles itself. This is the
//        faithful "given just the URL" arm; it needs a browsing/tool-capable
//        endpoint (e.g. a subagent harness), not a plain chat completion.
//   --discovery preflight            the runner fetches the discovery docs over
//        the network and includes them, so a plain chat API can attempt the
//        task. Discovery is then pre-satisfied — this arm measures authoring
//        coverage, not discovery.
//
// `--record-reference` writes the deterministic reference transcript (no model
// call) that CI replays; use it after the roster grows.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveLiveModelConfig, callLiveModel } from '../agent-usage/live.ts'
import { coverageRoster } from './roster.ts'
import { gradeCoverage, type CoverageManifest, type CoverageReport } from './oracle.ts'
import { referenceCoverageManifest } from './reference.ts'

export const HOMEPAGE_URL = 'https://agentic-mermaid.dev/'
export type DiscoveryMode = 'browsing' | 'preflight'

export interface HomepageCoverageTranscript {
  schemaVersion: 1
  capturedAt: string
  provider: string
  model: string
  surface: 'homepage-url'
  discovery: DiscoveryMode
  prompts?: { system: string; user: string }
  rawResponse?: string
  roster: { families: string[]; styles: string[]; palettes: string[] }
  manifest: CoverageManifest
  report: CoverageReport
}

export interface HomepageCoverageSummary {
  ok: boolean
  capturedAt: string
  provider: string
  model: string
  surface: 'homepage-url'
  discovery: DiscoveryMode
  interfaceOk: boolean
  families: { total: number; passed: number }
  styles: { total: number; passed: number }
  palettes: { total: number; passed: number }
  transcript: string
}

function rosterSnapshot() {
  const r = coverageRoster()
  return {
    families: r.families.map(f => f.id),
    styles: [...r.styles],
    palettes: [...r.palettes],
  }
}

function summarize(report: CoverageReport, transcriptPath: string, meta: Pick<HomepageCoverageTranscript, 'capturedAt' | 'provider' | 'model' | 'discovery'>): HomepageCoverageSummary {
  const count = (items: readonly { ok: boolean }[]) => ({ total: items.length, passed: items.filter(i => i.ok).length })
  return {
    ok: report.ok,
    capturedAt: meta.capturedAt,
    provider: meta.provider,
    model: meta.model,
    surface: 'homepage-url',
    discovery: meta.discovery,
    interfaceOk: report.interfaceOk,
    families: count(report.families),
    styles: count(report.styles),
    palettes: count(report.palettes),
    transcript: transcriptPath,
  }
}

function writeRun(outDir: string, transcript: HomepageCoverageTranscript): HomepageCoverageSummary {
  mkdirSync(outDir, { recursive: true })
  const transcriptPath = join(outDir, 'transcript.json')
  writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2) + '\n')
  const repoRel = transcriptPath.slice(transcriptPath.indexOf('eval/'))
  const summary = summarize(transcript.report, repoRel, transcript)
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  return summary
}

/** Regenerate the committed deterministic reference transcript. */
export function recordReferenceTranscript(capturedAt: string, outDir = join(import.meta.dir, 'transcripts', 'reference')): HomepageCoverageSummary {
  const roster = coverageRoster()
  const manifest = referenceCoverageManifest(roster)
  const report = gradeCoverage(manifest, roster)
  const transcript: HomepageCoverageTranscript = {
    schemaVersion: 1,
    capturedAt,
    provider: 'reference',
    model: 'deterministic-sdk',
    surface: 'homepage-url',
    discovery: 'browsing',
    roster: rosterSnapshot(),
    manifest,
    report,
  }
  return writeRun(outDir, transcript)
}

// -- Live-model plumbing -----------------------------------------------------

function buildSystemPrompt(): string {
  return [
    'You are an autonomous agent evaluating a developer tool you have never seen.',
    'Return ONLY a single JSON object (no markdown, no prose) matching this schema:',
    '{',
    '  "interface": "sdk" | "cli" | "mcp",           // the agentic interface you used',
    '  "families": { "<familyId>": "<mermaid source>" },   // ONE instance of EVERY diagram family',
    '  "styles":   { "<styleName>": { "source": "<mermaid source>" } },   // EVERY built-in Style (look)',
    '  "palettes": { "<paletteName>": { "source": "<mermaid source>" } }  // EVERY built-in Palette',
    '}',
    'Each family source must parse, verify, and be that exact family. Style/palette sources just need to render.',
  ].join('\n')
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { accept: 'text/plain, application/json, */*' } })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
  return res.text()
}

async function buildUserPrompt(discovery: DiscoveryMode): Promise<string> {
  const base = [
    `You are given ONLY this URL: ${HOMEPAGE_URL}`,
    '',
    'Task:',
    '1. Discover one of its agentic interfaces (library SDK, the `am` CLI, or the hosted MCP).',
    '2. Author one instance of EVERY diagram family the tool supports.',
    '3. Exercise EVERY built-in Style and EVERY built-in Palette with a render probe.',
    'Discover the exact family ids, Style names, and Palette names from the tool itself — do not guess them.',
  ]
  if (discovery === 'browsing') {
    base.push('Fetch the URL and follow it (start.md), read capabilities.json, and list styles/palettes before answering.')
    return base.join('\n')
  }
  // preflight: the runner performs discovery over the network and includes it.
  const [startMd, capabilities] = await Promise.all([
    fetchText(new URL('start.md', HOMEPAGE_URL).href).catch(e => `# unavailable: ${e}`),
    fetchText(new URL('capabilities.json', HOMEPAGE_URL).href).catch(e => `{"unavailable":"${e}"}`),
  ])
  const snap = rosterSnapshot()
  base.push(
    '',
    'Discovery documents fetched for you from the URL:',
    '--- start.md ---',
    startMd,
    '--- capabilities.json ---',
    capabilities,
    '--- style & palette catalog (am styles --json) ---',
    JSON.stringify({ styles: snap.styles, palettes: snap.palettes }, null, 2),
  )
  return base.join('\n')
}

/** Extract the JSON CoverageManifest from a model response. */
export function extractManifest(text: string): CoverageManifest {
  const fenced = Array.from(text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)).map(m => m[1]!)
  const candidates = fenced.length ? fenced : [text]
  let lastErr: unknown
  for (const c of candidates.sort((a, b) => b.length - a.length)) {
    const start = c.indexOf('{')
    const end = c.lastIndexOf('}')
    if (start < 0 || end <= start) continue
    try {
      return JSON.parse(c.slice(start, end + 1)) as CoverageManifest
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error(`No JSON manifest found in response: ${lastErr instanceof Error ? lastErr.message : ''}`)
}

export async function runHomepageCoverageLive(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<HomepageCoverageSummary> {
  const capturedAt = new Date().toISOString()
  const discovery: DiscoveryMode = args.includes('--discovery') && args[args.indexOf('--discovery') + 1] === 'preflight' ? 'preflight' : 'browsing'
  const config = resolveLiveModelConfig(env, args)
  const system = buildSystemPrompt()
  const user = await buildUserPrompt(discovery)
  const rawResponse = await callLiveModel(config, system, user)
  const manifest = extractManifest(rawResponse)
  const roster = coverageRoster()
  const report = gradeCoverage(manifest, roster)
  const outDir = join(import.meta.dir, 'transcripts', `${config.provider}-${capturedAt.replace(/[:.]/g, '-')}`)
  const transcript: HomepageCoverageTranscript = {
    schemaVersion: 1,
    capturedAt,
    provider: config.provider,
    model: config.model,
    surface: 'homepage-url',
    discovery,
    prompts: { system, user },
    rawResponse,
    roster: rosterSnapshot(),
    manifest,
    report,
  }
  return writeRun(outDir, transcript)
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  try {
    if (args.includes('--help')) {
      console.log('Usage:\n  bun run eval/homepage-coverage/live.ts --record-reference\n  bun run eval/homepage-coverage/live.ts --provider anthropic --model claude-haiku-4-5 [--discovery browsing|preflight]\n  bun run eval/homepage-coverage/live.ts --provider openai-compatible --model gpt-5-mini --discovery preflight')
      process.exit(0)
    }
    const summary = args.includes('--record-reference')
      ? recordReferenceTranscript(new Date().toISOString())
      : await runHomepageCoverageLive(args)
    console.log(JSON.stringify(summary, null, 2))
    process.exit(summary.ok ? 0 : 1)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(2)
  }
}
