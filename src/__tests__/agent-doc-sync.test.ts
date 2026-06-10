// Doc-sync + no-tautology guards.

import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT_INSTRUCTIONS } from '../cli/agent-instructions.ts'
import { MUTATION_OPS_BY_FAMILY, buildCapabilities } from '../cli/index.ts'
import { SDK_DECLARATION } from '../mcp/sdk-decl.ts'
import { WARNING_SEVERITY, WARNING_TIER } from '../agent/types.ts'
import { THEMES } from '../theme.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { lintAgentTrace, type SdkCall } from '../../eval/agent-usage/harness.ts'

const REPO = join(import.meta.dir, '..', '..')

describe('Instructions_for_agents.md', () => {
  test('exists, under 100 lines', () => {
    const path = join(REPO, 'Instructions_for_agents.md')
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8').split('\n').length).toBeLessThanOrEqual(100)
  })
  test('byte-matches am --agent-instructions exactly', () => {
    const guide = readFileSync(join(REPO, 'Instructions_for_agents.md'), 'utf8')
    expect(AGENT_INSTRUCTIONS).toEqual(guide)
  })
  test('quick-start examples verify before every serialize', () => {
    const guide = readFileSync(join(REPO, 'Instructions_for_agents.md'), 'utf8')
    const snippets = Array.from(guide.matchAll(/```ts\n([\s\S]*?)\n```/g)).map(m => m[1]!)
    expect(snippets.length).toBeGreaterThan(0)
    for (const snippet of snippets) {
      const lines = snippet.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i]!.includes('serializeMermaid(')) continue
        const prior = lines.slice(Math.max(0, i - 5), i).join('\n')
        expect({ line: lines[i], prior }).toMatchObject({ prior: expect.stringContaining('verifyMermaid(') })
      }
    }
  })

  test('quick-start Code Mode snippets execute and lint clean', async () => {
    const guide = readFileSync(join(REPO, 'Instructions_for_agents.md'), 'utf8')
    const snippets = Array.from(guide.matchAll(/```ts\n([\s\S]*?)\n```/g)).map(m => m[1]!)
    for (const snippet of snippets) {
      const r = await executeInSandbox(snippet, { trace: true })
      expect({ ok: r.ok, error: r.error }).toEqual({ ok: true, error: undefined })
      expect(lintAgentTrace(r.trace as SdkCall[])).toEqual([])
    }
  })
})

function tsCodeBlocks(path: string): string[] {
  const text = readFileSync(path, 'utf8')
  return Array.from(text.matchAll(/```ts\n([\s\S]*?)\n```/g)).map(m => m[1]!)
}

async function readWithTimeout(promise: Promise<string>, timeoutMs: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<string>(resolve => { timer = setTimeout(() => resolve(''), timeoutMs) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function runBunExample(script: string, args: string[] = [], timeoutMs = 60_000): Promise<{ status: number | null; timedOut: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', 'run', script, ...args], { cwd: REPO, stdout: 'pipe', stderr: 'pipe' })
  const stdoutPromise = new Response(proc.stdout).text()
  const stderrPromise = new Response(proc.stderr).text()
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const timeoutPromise = new Promise<null>(resolve => {
    timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
      setTimeout(() => proc.kill('SIGKILL'), 1_000)
      resolve(null)
    }, timeoutMs)
  })
  const exited = await Promise.race([proc.exited, timeoutPromise])
  if (timer) clearTimeout(timer)
  const [stdout, stderr] = await Promise.all(timedOut
    ? [readWithTimeout(stdoutPromise, 2_000), readWithTimeout(stderrPromise, 2_000)]
    : [stdoutPromise, stderrPromise])
  return { status: typeof exited === 'number' ? exited : null, timedOut, stdout, stderr }
}

describe('agent-facing runnable docs', () => {
  test('Code Mode skill snippets execute and lint clean', async () => {
    const snippets = tsCodeBlocks(join(REPO, 'skills/agentic-mermaid-diagram-workflow/references/code-mode.md'))
    expect(snippets.length).toBeGreaterThan(0)
    for (const snippet of snippets) {
      const r = await executeInSandbox(snippet, { trace: true })
      expect({ ok: r.ok, error: r.error }).toEqual({ ok: true, error: undefined })
      expect(lintAgentTrace(r.trace as SdkCall[])).toEqual([])
    }
  })
})

describe('vocabulary doc-sync', () => {
  test('every warning code in Instructions_for_agents.md and spec', () => {
    const guide = readFileSync(join(REPO, 'Instructions_for_agents.md'), 'utf8')
    const spec = readFileSync(join(REPO, 'AGENT_NATIVE.md'), 'utf8')
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(guide).toContain(code)
      expect(spec).toContain(code)
    }
  })
  test('every code tiered + severity', () => {
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(WARNING_SEVERITY[code as keyof typeof WARNING_SEVERITY]).toMatch(/^(error|warning)$/)
      expect(WARNING_TIER[code as keyof typeof WARNING_TIER]).toMatch(/^(structural|geometric)$/)
    }
  })
  test('every MutationOp kind is in spec, capabilities, and MCP SDK declaration', () => {
    const spec = readFileSync(join(REPO, 'AGENT_NATIVE.md'), 'utf8')
    const cap = buildCapabilities()
    for (const [family, ops] of Object.entries(MUTATION_OPS_BY_FAMILY)) {
      const familyCap = cap.families.find(f => f.id === family)
      expect(familyCap?.mutationOps).toEqual([...ops])
      expect(familyCap?.editPolicy).toBe('structured-when-narrowed')
      for (const op of ops) {
        expect(spec).toContain(op)
        expect(SDK_DECLARATION).toContain(op)
      }
    }
  })

  test('MCP SDK declaration exposes all mutable-family narrowers', () => {
    for (const narrower of ['asFlowchart', 'asSequence', 'asTimeline', 'asClass', 'asEr']) {
      expect(SDK_DECLARATION).toContain(narrower)
    }
    expect(SDK_DECLARATION).not.toContain('asJourney')
    expect(SDK_DECLARATION).not.toContain('asXyChart')
  })
})

describe('root docs consistency', () => {
  test('TODO.md is the only root markdown file with unchecked backlog boxes', () => {
    for (const name of readdirSync(REPO).filter(f => f.endsWith('.md'))) {
      const text = readFileSync(join(REPO, name), 'utf8')
      if (name === 'TODO.md') {
        expect(text).toMatch(/^- \[ \]/m)
      } else {
        expect({ file: name, hasUnchecked: /^- \[ \]/m.test(text) }).toEqual({ file: name, hasUnchecked: false })
      }
    }
  })

  test('removed backlog/agent guide names do not reappear in markdown', () => {
    expect(existsSync(join(REPO, 'ROADMAP.md'))).toBe(false)
    expect(existsSync(join(REPO, 'AGENT_TODO.md'))).toBe(false)
    expect(existsSync(join(REPO, 'AGENTS.md'))).toBe(false)
    for (const name of readdirSync(REPO).filter(f => f.endsWith('.md'))) {
      const text = readFileSync(join(REPO, name), 'utf8')
      expect({ file: name, stale: /\b(?:ROADMAP|AGENT_TODO)\b/.test(text) }).toEqual({ file: name, stale: false })
    }
  })

  test('advertised CLI verbs have help entries', () => {
    const commands = ['render', 'verify', 'parse', 'serialize', 'mutate', 'preview', 'format', 'describe', 'capabilities', 'batch', 'render-markdown', 'llms-txt', 'init-agent']
    for (const command of commands) {
      const r = spawnSync('bun', ['run', join(REPO, 'bin/am.ts'), command, '--help'], { encoding: 'utf8' })
      expect({ command, status: r.status, stderr: r.stderr }).toEqual({ command, status: 0, stderr: '' })
      expect(r.stdout).toContain(`am ${command}`)
    }
  })

  test('preview and batch-mutation affordances stay synced across agent surfaces', () => {
    const mutateHelp = spawnSync('bun', ['run', join(REPO, 'bin/am.ts'), 'mutate', '--help'], { encoding: 'utf8' }).stdout
    const previewHelp = spawnSync('bun', ['run', join(REPO, 'bin/am.ts'), 'preview', '--help'], { encoding: 'utf8' }).stdout
    const batchHelp = spawnSync('bun', ['run', join(REPO, 'bin/am.ts'), 'batch', '--help'], { encoding: 'utf8' }).stdout
    const capabilitiesHelp = spawnSync('bun', ['run', join(REPO, 'bin/am.ts'), 'capabilities', '--help'], { encoding: 'utf8' }).stdout
    const initAgentHelp = spawnSync('bun', ['run', join(REPO, 'bin/am.ts'), 'init-agent', '--help'], { encoding: 'utf8' }).stdout
    expect(mutateHelp).toContain('--ops')
    expect(previewHelp).toContain('--open')
    expect(batchHelp).toContain('"mutate"')
    expect(capabilitiesHelp).toContain('editPolicy')
    expect(initAgentHelp).toContain('skills/agentic-mermaid-diagram-workflow/SKILL.md')

    const guide = readFileSync(join(REPO, 'Instructions_for_agents.md'), 'utf8')
    const llms = readFileSync(join(REPO, 'llms.txt'), 'utf8')
    const skillCli = readFileSync(join(REPO, 'skills/agentic-mermaid-diagram-workflow/references/cli.md'), 'utf8')
    for (const [file, text] of [['Instructions_for_agents.md', guide], ['llms.txt', llms], ['skills/agentic-mermaid-diagram-workflow/references/cli.md', skillCli]] as const) {
      expect({ file, preview: text.includes('preview') }).toEqual({ file, preview: true })
      expect({ file, ops: text.includes('--ops') }).toEqual({ file, ops: true })
      expect({ file, editPolicy: text.includes('editPolicy') }).toEqual({ file, editPolicy: true })
      expect({ file, batchMutate: text.includes('render/verify/parse/serialize/mutate') || text.includes('including mutate') }).toEqual({ file, batchMutate: true })
    }
    const readme = readFileSync(join(REPO, 'README.md'), 'utf8')
    expect(readme).toContain('strict `preview`')
    expect(readme).toContain('mutate --op/--ops')
    expect(readme).toContain('npx agentic-mermaid init-agent')
  })

  test('docs structure keeps README short and long-form content delegated', () => {
    const readme = readFileSync(join(REPO, 'README.md'), 'utf8')
    expect(readme.split('\n').length).toBeLessThanOrEqual(250)
    expect(existsSync(join(REPO, 'docs/README.md'))).toBe(true)
    for (const doc of ['api.md', 'diagram-families.md', 'theming.md', 'react.md', 'ascii.md', 'config.md']) {
      expect(existsSync(join(REPO, 'docs', doc))).toBe(true)
      expect(readme).toContain(`./docs/${doc}`)
    }
    expect(readdirSync(REPO).filter(f => f.endsWith('.md')).sort()).toEqual([
      'AGENT_NATIVE.md',
      'CHANGELOG.md',
      'Instructions_for_agents.md',
      'README.md',
      'SECURITY.md',
      'TODO.md',
    ])
  })

  test('theme and RenderOptions inventory is delegated to focused docs', () => {
    const readme = readFileSync(join(REPO, 'README.md'), 'utf8')
    const theming = readFileSync(join(REPO, 'docs/theming.md'), 'utf8')
    const api = readFileSync(join(REPO, 'docs/api.md'), 'utf8')
    const themeNames = Object.keys(THEMES)
    expect(readme).toContain(`${themeNames.length} built-in themes`)
    expect(theming).toContain(`${themeNames.length} built-in themes`)
    for (const name of themeNames) expect(theming).toContain(`\`${name}\``)
    for (const option of ['shadow', 'embedFontImport', 'compact', 'idPrefix', 'security']) {
      expect(api).toContain(`\`${option}\``)
    }
    expect(readme).not.toContain('`thoroughness`')
    expect(api).not.toContain('`thoroughness`')
  })

  test('advertised PNG support has concrete library, CLI, and MCP examples', () => {
    const checks = [
      ['README.md', readFileSync(join(REPO, 'README.md'), 'utf8')],
      ['docs/api.md', readFileSync(join(REPO, 'docs/api.md'), 'utf8')],
      ['docs/agent-api-cookbook.md', readFileSync(join(REPO, 'docs/agent-api-cookbook.md'), 'utf8')],
      ['skills/agentic-mermaid-diagram-workflow/SKILL.md', readFileSync(join(REPO, 'skills/agentic-mermaid-diagram-workflow/SKILL.md'), 'utf8')],
    ] as const
    for (const [file, text] of checks) {
      expect({ file, library: text.includes('renderMermaidPNG') }).toEqual({ file, library: true })
      expect({ file, cli: text.includes('--format png') && text.includes('--output') }).toEqual({ file, cli: true })
    }
    const cookbook = readFileSync(join(REPO, 'docs/agent-api-cookbook.md'), 'utf8')
    expect(cookbook).toContain('writeFileSync(\'diagram.png\'')
    expect(cookbook).toContain('render_png')
  })
})

describe('spec honesty', () => {
  test('spec no longer claims a seed drives layout', () => {
    const spec = readFileSync(join(REPO, 'AGENT_NATIVE.md'), 'utf8')
    // The withSeededRandom apparatus is gone; spec should say determinism is structural.
    expect(spec).not.toContain('withSeededRandom(ctx.rng, fn)')
    expect(spec.toLowerCase()).toContain('there is no seed')
  })

  test('spec does not expose removed VerifyOptions layoutContext API', () => {
    const spec = readFileSync(join(REPO, 'AGENT_NATIVE.md'), 'utf8')
    expect(spec).not.toContain('layoutContext?: LayoutContext')
  })

  test('agent docs use verify-before-commit terminology', () => {
    for (const file of ['AGENT_NATIVE.md', 'CHANGELOG.md', 'Instructions_for_agents.md', 'skills/agentic-mermaid-diagram-workflow/references/code-mode.md', 'eval/agent-usage/README.md']) {
      const text = readFileSync(join(REPO, file), 'utf8')
      expect({ file, stale: text.includes('verify-after-mutate') }).toEqual({ file, stale: false })
    }
  })

  test('Cloudflare Code Mode remains future inspiration, not a shipped runtime claim', () => {
    const spec = readFileSync(join(REPO, 'AGENT_NATIVE.md'), 'utf8')
    const rationale = readFileSync(join(REPO, 'docs/mcp-code-mode-rationale.md'), 'utf8')
    for (const [file, text] of [['AGENT_NATIVE.md', spec], ['docs/mcp-code-mode-rationale.md', rationale]] as const) {
      expect({ file, cloudflareCodemode: text.includes('not Cloudflare Codemode') }).toEqual({ file, cloudflareCodemode: true })
      expect({ file, codemodePackage: text.includes('not backed by `@cloudflare/codemode`') }).toEqual({ file, codemodePackage: true })
    }
    expect(spec).toContain('future options, not shipped artifacts')
  })
})

describe('no-tautology guard for our own test suite', () => {
  // The prior loop shipped `expect(typeof observedDifference).toBe('boolean')`.
  // Guard against that class of assertion sneaking back into agent tests.
  test('no typeof-tautology assertions in agent tests', () => {
    const dir = join(REPO, 'src', '__tests__')
    const names = require('node:fs').readdirSync(dir)
      .filter((f: string) => f.startsWith('agent') && f.endsWith('.test.ts'))
      .filter((f: string) => f !== 'agent-doc-sync.test.ts') // this guard mentions the pattern in prose
    const TAUT = /expect\(\s*typeof[^)]*\)\s*\.\s*toBe\(\s*['"]boolean['"]\s*\)/
    for (const name of names) {
      // Strip line comments so prose can't trip the guard.
      const code = readFileSync(join(dir, name), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
      expect({ file: name, tautology: TAUT.test(code) }).toEqual({ file: name, tautology: false })
    }
  })
})

describe('detector drift guard (agent vs shared router)', () => {
  // Agent parse, SVG rendering, and ASCII rendering all share the routed
  // detector in mermaid-source.ts. The agent layer only splits state out from
  // the renderer's flowchart route.
  test('agent.parseMermaid and detectDiagramType agree on routed families', async () => {
    const { parseMermaid: agentParse } = await import('../agent/parse.ts')
    const { detectDiagramType } = await import('../mermaid-source.ts')
    const cases: Array<[string, string]> = [
      ['flowchart TD\n  A --> B', 'flowchart'],
      ['sequenceDiagram\n  A->>B: x', 'sequence'],
      ['classDiagram\n  A <|-- B', 'class'],
      ['erDiagram\n  A ||--o{ B : x', 'er'],
      ['timeline\n  2020 : A', 'timeline'],
      ['journey\n  title T\n  section S\n    Wake: 3: Me', 'journey'],
      ['xychart-beta\n  bar [1,2,3]', 'xychart'],
      ['architecture-beta\n  group api(cloud)[API]', 'architecture'],
    ]
    for (const [src, expected] of cases) {
      const agentR = agentParse(src)
      expect(agentR.ok).toBe(true)
      if (!agentR.ok) continue
      expect(agentR.value.kind).toBe(expected as never)
      expect(detectDiagramType(src)).toBe(expected as never)
    }
  })
})

describe('skill eval manifest coverage', () => {
  test('covers families, channels, adversarial/no-trigger cases, fixtures, and hidden splits', () => {
    const manifest = JSON.parse(readFileSync(join(REPO, 'evals/shared-benchmark.json'), 'utf8'))
    const cases = manifest.cases as Array<{ id: string; split: string; kind: string; tags?: string[]; files?: string[]; prompt?: string; prompt_ref?: string }>
    const tags = new Set(cases.flatMap(c => c.tags ?? []))
    for (const family of ['flowchart', 'sequence', 'timeline', 'class', 'er', 'journey', 'xychart', 'architecture']) {
      expect({ family, covered: tags.has(`family:${family}`) }).toEqual({ family, covered: true })
    }
    for (const channel of ['library', 'cli', 'mcp-code-mode']) {
      expect({ channel, covered: tags.has(`channel:${channel}`) }).toEqual({ channel, covered: true })
    }
    expect(cases.filter(c => c.kind === 'adversarial').length).toBeGreaterThanOrEqual(4)
    expect(cases.some(c => c.kind === 'negative')).toBe(true)
    expect(cases.filter(c => c.kind === 'trigger' && (c.tags ?? []).includes('no-trigger')).length).toBeGreaterThanOrEqual(2)
    expect(cases.filter(c => c.files?.length).length).toBeGreaterThanOrEqual(8)
    expect(cases.filter(c => c.split === 'holdout').length).toBeGreaterThan(0)
    expect(cases.filter(c => c.split === 'holdback').length).toBeGreaterThan(0)
    for (const c of cases.filter(c => c.split === 'holdout' || c.split === 'holdback')) {
      expect({ id: c.id, publicPrompt: Boolean(c.prompt), privateRef: c.prompt_ref?.startsWith('private/') }).toEqual({ id: c.id, publicPrompt: false, privateRef: true })
    }
    for (const c of cases.flatMap(c => c.files ?? [])) expect(existsSync(join(REPO, 'evals', c))).toBe(true)
    expect(manifest.run_policy.minimum_runs_per_variant).toBeGreaterThanOrEqual(3)
    expect(manifest.run_policy.recommended_runs_per_variant).toBeGreaterThanOrEqual(5)
  })
})

describe('shipped distribution artifacts present', () => {
  test('skill bundle + workflow + examples', () => {
    expect(existsSync(join(REPO, '.claude'))).toBe(false)
    expect(existsSync(join(REPO, '.agents'))).toBe(false)
    expect(existsSync(join(REPO, 'skills/README.md'))).toBe(true)
    expect(existsSync(join(REPO, 'skills/agentic-mermaid-diagram-workflow/SKILL.md'))).toBe(true)
    expect(existsSync(join(REPO, 'skills/agentic-mermaid-live-editor/SKILL.md'))).toBe(true)
    expect(existsSync(join(REPO, '.github/workflows/sync-mermaid-docs.yml'))).toBe(true)
    expect(existsSync(join(REPO, 'examples/agent-loop.ts'))).toBe(true)
    expect(existsSync(join(REPO, 'examples/mcp-vs-cli-complex-diagrams.ts'))).toBe(true)
    expect(existsSync(join(REPO, 'examples/agent-improve-auth-flow.ts'))).toBe(true)
    expect(existsSync(join(REPO, 'docs/mcp-code-mode-rationale.md'))).toBe(true)
    expect(existsSync(join(REPO, 'docs/agent-workflow-examples.md'))).toBe(true)
  })

  test('MCP/CLI parity example runs', async () => {
    const r = await runBunExample(join(REPO, 'examples/mcp-vs-cli-complex-diagrams.ts'))
    expect({ status: r.status, timedOut: r.timedOut, stderr: r.stderr }).toEqual({ status: 0, timedOut: false, stderr: '' })
    const payload = JSON.parse(r.stdout)
    expect(payload.ok).toBe(true)
    expect(payload.channelA).toBe('mcp.execute')
    expect(payload.channelB).toBe('am mutate --ops')
    expect(payload.cases).toEqual(['auth-flow', 'order-domain-er'])
    expect(payload.sources['auth-flow']).toContain('G --> H[Dashboard]')
    expect(payload.sources['order-domain-er']).toContain('CUSTOMER ||--o{ ORDER : places')
  }, 30_000)

  test('agent improvement example assesses, mutates, reassesses, and writes render files', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'am-example-test-'))
    try {
      const r = await runBunExample(join(REPO, 'examples/agent-improve-auth-flow.ts'), ['--out-dir', outDir])
      expect({ status: r.status, timedOut: r.timedOut, stderr: r.stderr }).toEqual({ status: 0, timedOut: false, stderr: '' })
      const payload = JSON.parse(r.stdout)
      expect(payload.ok).toBe(true)
      expect(payload.problems.length).toBeGreaterThan(0)
      expect(payload.impact.warningsBefore).toBeGreaterThan(payload.impact.warningsAfter)
      expect(payload.impact.longestLabelBefore).toBeGreaterThan(payload.impact.longestLabelAfter)
      const svg = readFileSync(join(outDir, 'auth-flow-improved.svg'), 'utf8')
      const ascii = readFileSync(join(outDir, 'auth-flow-improved.txt'), 'utf8')
      const png = readFileSync(join(outDir, 'auth-flow-improved.png'))
      const assessment = JSON.parse(readFileSync(join(outDir, 'assessment.json'), 'utf8'))
      expect(svg).toContain('<svg')
      expect(svg).toContain('Login Page')
      expect(ascii).toContain('Dashboard')
      expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      expect(assessment.improveOps).toBe(3)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 30_000)

  test('npm package includes bundled PNG fonts and delegated docs', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    expect(pkg.files).toContain('assets/fonts/')
    for (const doc of ['TODO.md', 'SECURITY.md', 'docs/', 'skills/', 'evals/']) expect(pkg.files).toContain(doc)
    for (const removedRootDoc of ['FEATURES.md', 'FORK_DIFFERENCES.md', 'QUALITY.md']) expect(pkg.files).not.toContain(removedRootDoc)
    expect(pkg.bin).toEqual({
      am: './dist/am.js',
      'agentic-mermaid': './dist/am.js',
      'agentic-mermaid-mcp': './dist/agentic-mermaid-mcp.js',
    })
    expect(pkg.publishConfig).toMatchObject({ access: 'public', provenance: true })
    expect(pkg.engines.node).toBe('>=18')
    for (const example of ['examples/agent-loop.ts', 'examples/mcp-vs-cli-complex-diagrams.ts', 'examples/agent-improve-auth-flow.ts']) expect(pkg.files).toContain(example)
    expect(existsSync(join(REPO, 'assets/fonts/DejaVuSans.ttf'))).toBe(true)
    expect(existsSync(join(REPO, 'assets/fonts/DejaVuSans-Bold.ttf'))).toBe(true)
  })
})
