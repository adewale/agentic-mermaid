// Doc-sync + no-tautology guards.

import { describe, test, expect } from 'bun:test'
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT_INSTRUCTIONS } from '../cli/agent-instructions.ts'
import { AGENTS_SNIPPET, INIT_SKILL_MD } from '../cli/init-agent.ts'
import { COMMAND_HELP, MUTATION_OPS_BY_FAMILY, buildCapabilities } from '../cli/index.ts'
import { SDK_DECLARATION } from '../mcp/sdk-decl.ts'
import { HOSTED_TOOLS } from '../mcp/hosted-server.ts'
import { LOCAL_TOOLS } from '../mcp/server.ts'
import { WARNING_SEVERITY, WARNING_TIER } from '../agent/types.ts'
import {
  asFlowchart, asState, asSequence, asTimeline, asClass, asEr,
  asJourney, asArchitecture, asXyChart, asPie, asQuadrant, asGantt, asMindmap, asGitGraph,
} from '../agent/types.ts'
import { BUILTIN_FAMILY_METADATA, BUILTIN_FAMILY_METADATA_COVERS_DIAGRAM_KIND, knownBuiltinFamilies, getFamily } from '../agent/families.ts'
import type { DiagramKind, ValidDiagram } from '../agent/types.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { lintAgentTrace, type SdkCall } from '../../eval/agent-usage/harness.ts'

const REPO = join(import.meta.dir, '..', '..')

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('Instructions_for_agents.md', () => {
  test('exists, under 100 lines', () => {
    const path = join(REPO, 'Instructions_for_agents.md')
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8').split('\n').length).toBeLessThanOrEqual(100)
  })
  test('front-loads explicit when-to-use guidance', () => {
    const guide = readFileSync(join(REPO, 'Instructions_for_agents.md'), 'utf8')
    const whenToUse = guide.indexOf('## When to use Agentic Mermaid')
    const quickStart = guide.indexOf('## Quick start')

    expect(whenToUse).toBeGreaterThan(0)
    expect(whenToUse).toBeLessThan(quickStart)
    expect(guide.slice(whenToUse, quickStart)).toContain('create, edit, verify, describe, or render Mermaid diagrams')
    expect(guide.slice(whenToUse, quickStart)).toContain('Do not use the hosted MCP for private diagrams')
  })
  test('byte-matches am --agent-instructions exactly', () => {
    const guide = readFileSync(join(REPO, 'Instructions_for_agents.md'), 'utf8')
    expect(AGENT_INSTRUCTIONS).toEqual(guide)
  })
  test('names every hosted MCP tool (so a new tool cannot silently drift the guide)', () => {
    for (const tool of HOSTED_TOOLS) {
      expect({ tool: tool.name, named: AGENT_INSTRUCTIONS.includes(`\`${tool.name}\``) })
        .toEqual({ tool: tool.name, named: true })
    }
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
  // Bun 1.3.11 intermittently dies with SIGILL ("panic(main thread):
  // unreachable — This indicates a bug in Bun, not your code") when spawning
  // these examples in sandboxed containers. Retry ONLY on that runtime-crash
  // signature; genuine example failures (nonzero exit without the panic
  // banner, bad payloads) are never retried.
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await runBunExampleOnce(script, args, timeoutMs)
    // Signal deaths surface as 128+signal (observed: 132 SIGILL, 134
    // SIGABRT), sometimes with empty stderr because the crash preempts the
    // panic banner, or as a null status without our timeout firing. Genuine
    // example failures exit 1-4 and are never retried.
    const bunCrashed = r.stderr.includes('Bun has crashed') ||
      (typeof r.status === 'number' && r.status >= 128) ||
      (r.status === null && !r.timedOut)
    if (!bunCrashed) return r
  }
  return runBunExampleOnce(script, args, timeoutMs)
}

async function runBunExampleOnce(script: string, args: string[] = [], timeoutMs = 60_000): Promise<{ status: number | null; timedOut: boolean; stdout: string; stderr: string }> {
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

  // Public-API library docs are import-based (not MCP Code Mode), so they cannot
  // run in the sandbox above. Execute their standalone snippets as real Bun
  // modules against the in-repo source. This catches snippets that FAIL TO RUN —
  // renamed/missing exports, wrong call signatures, options that throw, runtime
  // errors — i.e. API drift that breaks the documented code. It does NOT catch
  // silent type/semantic mismatches that still execute (e.g. assigning a Result
  // to a var the prose calls a string); those need human review. Skipped:
  // continuation fragments (no import), module/handler fragments (top-level
  // export/return), and React/JSX blocks.
  test('public-API doc snippets execute', () => {
    const AGENT = JSON.stringify(join(REPO, 'src/agent/index.ts'))
    const CORE = JSON.stringify(join(REPO, 'src/index.ts'))
    const docs = ['README.md', 'docs/getting-started.md', 'docs/api.md', 'docs/ascii.md', 'docs/config.md', 'docs/theming.md', 'docs/diagram-families.md']
    // Reader-supplied placeholders the docs reference but expect you to provide.
    const placeholders = (block: string): string => {
      const declared = (id: string) => new RegExp(`(?:const|let|var)\\s+${id}\\b`).test(block) || new RegExp(`(?:const|let|var)\\s*\\{[^}]*\\b${id}\\b[^}]*\\}`).test(block)
      const used = (id: string) => new RegExp(`\\b${id}\\b`).test(block) && !declared(id)
      const defs: string[] = []
      if (used('source')) defs.push("const source = 'flowchart TD\\n  API --> DB'")
      if (used('diagram')) defs.push("const diagram = 'flowchart TD\\n  API --> DB'")
      if (used('userProvidedSource')) defs.push("const userProvidedSource = 'flowchart TD\\n  A --> B'")
      if (used('myTheme')) defs.push("const myTheme = { bg: '#ffffff', fg: '#111111' }")
      if (used('ascii')) defs.push(`import { renderMermaidASCII as __ra } from ${AGENT}\nconst ascii = __ra('flowchart LR\\n  A --> B', { useAscii: true })`)
      return defs.join('\n')
    }
    const dir = mkdtempSync(join(tmpdir(), 'doc-snippets-'))
    try {
      let ran = 0
      for (const doc of docs) {
        for (const [i, block] of tsCodeBlocks(join(REPO, doc)).entries()) {
          const runnable = /^\s*import\b/m.test(block) && !/^\s*(?:export|return)\b/m.test(block) && !/from ['"]react['"]/.test(block)
          if (!runnable) continue
          // Point published specifiers at in-repo source; a temp cwd keeps any
          // written artifacts (diagram.svg/png) out of the repo.
          const wired = block.replaceAll("'agentic-mermaid/agent'", AGENT).replaceAll("'agentic-mermaid'", CORE)
          const file = join(dir, `${doc.replace(/[/.]/g, '_')}__${i}.ts`)
          writeFileSync(file, placeholders(block) + '\n' + wired)
          const r = spawnSync('bun', ['run', file], { cwd: dir, encoding: 'utf8' })
          expect({ doc, block: i, status: r.status, stderr: r.stderr }).toEqual({ doc, block: i, status: 0, stderr: '' })
          ran++
        }
      }
      // Guard against the skip logic silently excluding everything (23 today).
      expect(ran).toBeGreaterThanOrEqual(18)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})

describe('vocabulary doc-sync', () => {
  test('built-in family metadata is the checked source for shipped family surfaces', () => {
    const metadataIds = new Set(BUILTIN_FAMILY_METADATA.map(f => f.id))
    const mutationFamilyIds = new Set(Object.keys(MUTATION_OPS_BY_FAMILY) as Array<keyof typeof MUTATION_OPS_BY_FAMILY>)
    const capabilities = buildCapabilities()
    expect(BUILTIN_FAMILY_METADATA_COVERS_DIAGRAM_KIND).toBe(true)
    expect(metadataIds).toEqual(new Set(knownBuiltinFamilies()))
    expect(metadataIds).toEqual(mutationFamilyIds)

    for (const family of BUILTIN_FAMILY_METADATA) {
      const descriptor = getFamily(family.id)
      const capability = capabilities.families.find(entry => entry.id === family.id)
      expect(descriptor?.narrower).toBe(family.narrower)
      expect(capability?.narrower).toBe(family.narrower)
      expect(capability?.headers).toEqual(family.headers)
    }
  })

  test('summary capability docs delegate the live family roster', () => {
    const docs = [
      'README.md',
      'docs/features.md',
      'docs/ascii.md',
    ]
    for (const file of docs) {
      const text = readFileSync(join(REPO, file), 'utf8')
      expect({
        file,
        delegates: /am capabilities --json|section-a-capability-report|diagram-families/i.test(text),
      }).toEqual({ file, delegates: true })
    }
  })

  test('quality geometry table lists every built-in family', () => {
    const quality = readFileSync(join(REPO, 'docs/quality.md'), 'utf8')
    for (const family of BUILTIN_FAMILY_METADATA) {
      expect({
        family: family.id,
        row: new RegExp(`\\|\\s*${escapeRegExp(family.id)}\\s*\\|`).test(quality),
      }).toEqual({ family: family.id, row: true })
    }
  })

  test('source preservation ladder lists every built-in family and all levels', () => {
    const ladder = readFileSync(join(REPO, 'docs/design/system/source-preservation-ladder.md'), 'utf8')
    for (const level of ['L0', 'L1', 'L2', 'L3', 'L4']) expect(ladder).toContain(level)
    for (const family of BUILTIN_FAMILY_METADATA) {
      expect({ family: family.id, listed: new RegExp(`\\|\\s*${escapeRegExp(family.id)}\\s*\\|`).test(ladder) })
        .toEqual({ family: family.id, listed: true })
    }
  })

  test('TODO backlog IDs are unique', () => {
    const todo = readFileSync(join(REPO, 'TODO.md'), 'utf8')
    const ids = [...todo.matchAll(/\*\*([A-Z]+-\d+)\b/g)].map(m => m[1]!)
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(duplicates).toEqual([])
  })

  test('TODO references only current backlog IDs', () => {
    const todo = readFileSync(join(REPO, 'TODO.md'), 'utf8')
    const defined = new Set([...todo.matchAll(/^- \[ \] \*\*([A-Z]+-\d+)\b/gm)].map(match => match[1]!))
    const prefixes = new Set([...defined].map(id => id.split('-')[0]!))
    const referenced = new Set(
      [...todo.matchAll(/\b([A-Z]+-\d+)\b/g)]
        .map(match => match[1]!)
        .filter(id => prefixes.has(id.split('-')[0]!)),
    )
    expect([...referenced].filter(id => !defined.has(id)).sort()).toEqual([])
  })

  test('upstream syntax workflow verifies the reviewed pin without writing', () => {
    const workflow = readFileSync(join(REPO, '.github/workflows/sync-mermaid-docs.yml'), 'utf8')
    expect(workflow).toContain('docs/project/upstream-mermaid-policy.json')
    expect(workflow).toContain('ref: ${{ steps.pin.outputs.commit }}')
    expect(workflow).toContain('diff -ru "$expected" "$harvested"')
    expect(workflow).toContain('contents: read')
    expect(workflow).not.toContain('contents: write')
    expect(workflow).not.toContain('git-auto-commit-action')
  })

  test('BrandPack and Treatment examples keep kind-specific registry identities', () => {
    const plan = readFileSync(join(REPO, 'docs/project/brand-primitives-plan.md'), 'utf8')
    expect(plan).toContain("identity: ExtensionIdentity<'brand-pack'>")
    expect(plan).toContain("id: 'treatment:acme/corner-brackets'")
    expect(plan).toContain('separate BrandPack registry')
    expect(plan).not.toContain('NamespacedId')
    expect(plan).not.toContain('same canonical installed-appearance registry')
  })

  test('nightly route mutation workflow stays synced with documented commands', () => {
    const workflow = readFileSync(join(REPO, '.github/workflows/nightly-route-mutation.yml'), 'utf8')
    const docs = readFileSync(join(REPO, 'docs/mutation-testing.md'), 'utf8')
    for (const command of ['bun run mutation-test:routes', 'bun run mutation-test:routes:certs', 'bun run mutation-test:routes:subgraph', 'bun run sabotage:routes']) {
      expect(workflow).toContain(command)
      expect(docs).toContain(command.replace('bun run ', ''))
    }
  })

  test('every warning code in Instructions_for_agents.md and spec', () => {
    const guide = readFileSync(join(REPO, 'Instructions_for_agents.md'), 'utf8')
    const spec = readFileSync(join(REPO, 'AGENT_NATIVE.md'), 'utf8')
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(guide).toContain(code)
      expect(spec).toContain(code)
    }
  })
  test('public verify docs list every warning code', () => {
    const surfaces = [
      COMMAND_HELP.verify,
      readFileSync(join(REPO, 'docs/features.md'), 'utf8'),
      readFileSync(join(REPO, 'docs/agent-api-cookbook.md'), 'utf8'),
    ]
    for (const code of Object.keys(WARNING_SEVERITY)) {
      for (const surface of surfaces) expect(surface).toContain(code)
    }
  })
  test('MCP SDK WarningCode exactly matches the runtime warning registry', () => {
    const block = /type WarningCode =([\s\S]*?)\n\ninterface VerifyResult/.exec(SDK_DECLARATION)?.[1] ?? ''
    const declared = [...block.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map(match => match[1]!).sort()
    expect(declared).toEqual(Object.keys(WARNING_TIER).sort())
  })

  test('every code tiered + severity', () => {
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(WARNING_SEVERITY[code as keyof typeof WARNING_SEVERITY]).toMatch(/^(error|warning)$/)
      expect(WARNING_TIER[code as keyof typeof WARNING_TIER]).toMatch(/^(structural|geometric|lint)$/)
    }
  })
  test('public mutate help delegates the live family roster', () => {
    const help = COMMAND_HELP.mutate?.toLowerCase() ?? ''
    expect(help.length).toBeGreaterThan(0)
    expect(help).toContain('am capabilities --json')
    expect(help).not.toContain('flowchart/state, sequence')
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

  test('MCP SDK declaration exposes and describes all mutable families', () => {
    for (const family of BUILTIN_FAMILY_METADATA) {
      expect(SDK_DECLARATION).toContain(family.narrower)
    }
    const convention = SDK_DECLARATION.split('// 3. mutate works on')[1]?.split('//    State owns')[0] ?? ''
    for (const family of BUILTIN_FAMILY_METADATA) {
      expect({ family: family.id, described: convention.toLowerCase().includes(family.id) })
        .toEqual({ family: family.id, described: true })
    }
  })

  test('agent-facing docs delegate family and operation discovery to generated surfaces', () => {
    const agentNative = readFileSync(join(REPO, 'AGENT_NATIVE.md'), 'utf8')
    const familyGuide = readFileSync(join(REPO, 'docs/diagram-families.md'), 'utf8')
    const llms = readFileSync(join(REPO, 'llms.txt'), 'utf8')
    const skill = readFileSync(join(REPO, 'skills/agentic-mermaid-diagram-workflow/SKILL.md'), 'utf8')
    const codeMode = readFileSync(join(REPO, 'skills/agentic-mermaid-diagram-workflow/references/code-mode.md'), 'utf8')
    const cliReference = readFileSync(join(REPO, 'skills/agentic-mermaid-diagram-workflow/references/cli.md'), 'utf8')
    const skillEvalReadme = readFileSync(join(REPO, 'skill-evals/README.md'), 'utf8')
    const cookbook = readFileSync(join(REPO, 'docs/agent-api-cookbook.md'), 'utf8')
    const api = readFileSync(join(REPO, 'docs/api.md'), 'utf8')
    const capabilities = buildCapabilities()

    for (const [family, ops] of Object.entries(MUTATION_OPS_BY_FAMILY) as Array<[keyof typeof MUTATION_OPS_BY_FAMILY, readonly string[]]>) {
      const descriptor = getFamily(family)!
      const capability = capabilities.families.find(entry => entry.id === family)
      expect(capability?.mutationOps).toEqual([...ops])
      expect(capability?.narrower).toBe(descriptor.narrower)
      expect(SDK_DECLARATION).toContain(descriptor.narrower!)

      for (const [file, text] of [
        ['llms.txt', llms],
        ['init-agent AGENTS.md snippet', AGENTS_SNIPPET],
        ['init-agent skill bundle', INIT_SKILL_MD],
      ] as const) {
        expect({ family, file, narrowerListed: text.includes(descriptor.narrower!) })
          .toEqual({ family, file, narrowerListed: true })
      }
    }

    expect(agentNative).toContain('section-a-capability-report.md')
    expect(agentNative).not.toContain('| Family | Parse / verify / render / round-trip |')
    expect(agentNative).not.toContain('asFlowchart/asState/asSequence')
    expect(familyGuide).toContain('section-a-capability-report.md')
    expect(familyGuide).not.toContain('| Family | Header(s) | Render | Structured mutation |')
    expect(cookbook).toContain('## Mutation operation discovery')
    expect(cookbook).toContain('describeOps(family)')
    expect(cookbook).toContain('opSignatures(family)')
    expect(cookbook).not.toContain('| Family | Narrower | Op kinds |')
    expect(codeMode).not.toContain('mermaid.asState(d)')
    expect(cliReference).not.toContain('flowchart, state, sequence')
    expect(skillEvalReadme).toContain('rather than copied here')
    expect(api).toContain('am capabilities --json')
    expect(api).toContain('describeOps(family)')
    expect(api).toContain('does not copy an exhaustive')

    for (const text of [skill, codeMode, SDK_DECLARATION]) {
      expect(text).toContain('ganttToday')
    }
  })

  test('every narrower advertised by the SDK declaration is callable in the Code Mode sandbox', async () => {
    // Consistency-audit guard: the declaration once advertised narrowers the
    // sandbox did not expose, so Code Mode scripts copying the declaration
    // crashed. Drive each advertised narrower end-to-end through execute().
    const advertised = [...new Set(Array.from(SDK_DECLARATION.matchAll(/\bas[A-Z]\w+/g), m => m[0]))]
    expect(advertised.length).toBeGreaterThanOrEqual(9)
    const SOURCES: Record<string, string> = {
      asFlowchart: 'flowchart TD\\n  A --> B',
      asState: 'stateDiagram-v2\\n  [*] --> A',
      asSequence: 'sequenceDiagram\\n  A->>B: hi',
      asTimeline: 'timeline\\n  2020 : event',
      asClass: 'classDiagram\\n  class A',
      asEr: 'erDiagram\\n  A ||--o{ B : has',
      asJourney: 'journey\\n  Wake: 3: Me',
      asArchitecture: 'architecture-beta\\n  service a(server)[A]',
      asXyChart: 'xychart-beta\\n  bar [1, 2]',
      asPie: 'pie\\n  "Dogs" : 3',
      asQuadrant: 'quadrantChart\\n  Campaign A: [0.3, 0.6]',
      asGantt: 'gantt\\n  Task A :a1, 2024-01-01, 3d',
      asMindmap: 'mindmap\\n  root\\n    child',
      asGitGraph: 'gitGraph\\n  commit',
    }
    for (const narrower of advertised) {
      const source = SOURCES[narrower]
      expect({ narrower, known: Boolean(source) }).toEqual({ narrower, known: true })
      const code = `const r = mermaid.parseMermaid('${source}')\nif (!r.ok) return { narrower: '${narrower}', phase: 'parse' }\nconst n = mermaid.${narrower}(r.value)\nreturn { narrower: '${narrower}', narrowed: n !== null }`
      const result = await executeInSandbox(code, {})
      expect({ narrower, ok: result.ok, value: result.ok ? result.value : result.error })
        .toEqual({ narrower, ok: true, value: { narrower, narrowed: true } })
    }
  })

  test('every registered renderable family ships typed mutation (default-by-default enforcement)', () => {
    // Typed mutation is the enforced default: a new family cannot register
    // source-level-only. Every registered family must (a) expose mutate +
    // serialize FamilyDescriptor hooks, (b) declare its ops in MUTATION_OPS_BY_FAMILY,
    // and (c) have a narrower returning non-null on its own structured body. This
    // closes the loophole where a family could ship without a structured editing
    // surface (as pie/quadrant once did).
    const NARROWERS: Record<DiagramKind, (d: ValidDiagram) => unknown> = {
      flowchart: asFlowchart, state: asState, sequence: asSequence, timeline: asTimeline,
      class: asClass, er: asEr, journey: asJourney, architecture: asArchitecture,
      xychart: asXyChart, pie: asPie, quadrant: asQuadrant, gantt: asGantt,
      mindmap: asMindmap, gitgraph: asGitGraph,
    }
    const FAIL = 'New families ship with typed mutation by default — see docs/contributing/adding-diagram-types.md.'
    for (const kind of knownBuiltinFamilies()) {
      const plugin = getFamily(kind)!
      expect({ kind, hasMutate: typeof plugin.mutate === 'function', msg: FAIL })
        .toEqual({ kind, hasMutate: true, msg: FAIL })
      expect({ kind, hasSerialize: typeof plugin.serialize === 'function', msg: FAIL })
        .toEqual({ kind, hasSerialize: true, msg: FAIL })
      expect({ kind, declaresOps: kind in MUTATION_OPS_BY_FAMILY, msg: FAIL })
        .toEqual({ kind, declaresOps: true, msg: FAIL })
      expect({ kind, hasNarrower: typeof NARROWERS[kind] === 'function', msg: FAIL })
        .toEqual({ kind, hasNarrower: true, msg: FAIL })
    }
    // Sanity: the narrower table covers every registered family kind exactly.
    expect(new Set(Object.keys(NARROWERS))).toEqual(new Set(knownBuiltinFamilies()))
  })

  test('state-narrows-via-asState is documented on every agent surface that claims state mutation', () => {
    // BUILD-19: state owns a dedicated body. Docs that advertise state mutation
    // must say the path is asState (not asFlowchart), or agents either conclude
    // state is not mutable or reach for the wrong narrower.
    for (const file of ['Instructions_for_agents.md', 'llms.txt', 'skills/agentic-mermaid-diagram-workflow/SKILL.md', 'website/source/start.md']) {
      const text = readFileSync(join(REPO, file), 'utf8')
      expect({ file, documentsStateNarrowing: /[Ss]tate.*asState|asState.*(narrows?|state)/s.test(text) }).toEqual({ file, documentsStateNarrowing: true })
    }
  })
})

describe('start.md bootstrap claims stay true', () => {
  // start.md is the hosted bootstrap the homepage pointer fetches and the source
  // the inline homepage prompt is composed from. It is deliberately condensed —
  // it does NOT enumerate every narrower/warning code (it points at
  // capabilities.json for those), so it does not belong in the exhaustive
  // reference-doc loops above. Instead, pin every claim it DOES make: whatever
  // families, narrowers, warning codes, and tools it names must be real. Family
  // discovery delegates to generated capabilities instead of retaining another
  // manually synchronized roster here.
  const START = readFileSync(join(REPO, 'website/source/start.md'), 'utf8')

  test('delegates family discovery instead of copying the roster', () => {
    const copiedRoster = [...knownBuiltinFamilies()].map(kind => kind.toLowerCase()).join(', ')
    expect(START).not.toMatch(/Families:\s*/)
    expect(START.toLowerCase()).not.toContain(copiedRoster)
    expect(START).toContain('am capabilities --json')
    expect(START).toContain('capabilities.json')
  })

  test('every as* narrower it names is a real narrower', () => {
    const real = new Set<string>(BUILTIN_FAMILY_METADATA.map(family => family.narrower))
    const named = [...START.matchAll(/\bas[A-Z][A-Za-z]*\b/g)].map(m => m[0])
    expect(named.length).toBeGreaterThan(0)
    for (const n of named) expect({ narrower: n, real: real.has(n) }).toEqual({ narrower: n, real: true })
  })

  test('every warning code it names is a real code', () => {
    const codes = new Set(Object.keys(WARNING_SEVERITY))
    const named = [...START.matchAll(/\b[A-Z]{2,}(?:_[A-Z]+)+\b/g)].map(m => m[0])
    expect(named.length).toBeGreaterThan(0) // at least LABEL_OVERFLOW
    for (const c of named) expect({ code: c, real: codes.has(c) }).toEqual({ code: c, real: true })
  })

  test('Code Mode instructions do not name library-only methods', async () => {
    expect(START).not.toContain('applyOps({ source, family, ops })')
    expect(START).toContain('Code Mode intentionally exposes neither of those batch wrappers')
    const result = await executeInSandbox('return typeof mermaid.applyOps')
    expect(result).toEqual(expect.objectContaining({ ok: true, value: 'undefined' }))
  })

  test('the hosted MCP tools it lists match the server exactly', () => {
    const sentence = START.match(/Tools:\s*([^.\n]+)/)?.[1] ?? ''
    const named = new Set([...sentence.matchAll(/`([a-z_]+)`/g)].map(m => m[1]))
    expect(named).toEqual(new Set(HOSTED_TOOLS.map(t => t.name)))
  })
})

describe('hosted-tool enumeration does not rot', () => {
  // The hosted tool list was restated as prose across ~8 docs; only start.md and
  // the agent guide were pinned, so the rest silently drifted to a stale "six
  // tools" TWICE (see lessons-learned "guard the invariant not the instance").
  // `render_svg` and `render_ascii` are HOSTED-ONLY tools (the local stdio server
  // has neither), so any shipped doc that names one is describing the hosted
  // surface and MUST also name the newer declarative tools — else it has rotted.
  const HOSTED_ONLY = HOSTED_TOOLS.map(t => t.name).filter(n => n === 'render_svg' || n === 'render_ascii')
  const REQUIRED_IF_HOSTED = ['mutate', 'build'] // the tools that keep getting dropped

  function shippedDocs(dir: string, acc: string[] = []): string[] {
    for (const e of readdirSync(join(REPO, dir), { withFileTypes: true })) {
      const rel = join(dir, e.name)
      // Skip generated copies (regenerated + website:check-gated), deps, and
      // frozen eval transcript artifacts.
      if (/node_modules|website\/public|agent-usage\/transcripts/.test(rel)) continue
      if (e.isDirectory()) shippedDocs(rel, acc)
      else if (e.name.endsWith('.md')) acc.push(rel)
    }
    return acc
  }

  test('every doc that names a hosted-only tool also names mutate + build', () => {
    const docs = [...shippedDocs('docs'), ...shippedDocs('skills'), ...shippedDocs('website/source'),
      'website/README.md', 'eval/agent-usage/RUNBOOK.md', 'Instructions_for_agents.md', 'README.md']
    let checked = 0
    for (const rel of docs) {
      const path = join(REPO, rel)
      if (!existsSync(path)) continue
      const text = readFileSync(path, 'utf8')
      if (!HOSTED_ONLY.some(t => text.includes(t))) continue // not a hosted-surface doc
      checked++
      for (const tool of REQUIRED_IF_HOSTED) {
        expect({ doc: rel, names: tool, present: text.includes(tool) }).toEqual({ doc: rel, names: tool, present: true })
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4) // start.md, agent guide, README, mcp-code-mode-rationale, …
  })
})

describe('exact MCP inventories match the runtime registries', () => {
  const names = (text: string): string[] => [...text.matchAll(/`([a-z_]+)`/g)].map(match => match[1]!)
  // `source` and `family` are argument nouns inside two inventory descriptions.
  // Everything else remains raw: no runtime-name filter and no deduplication,
  // so an unknown or repeated advertised tool makes equality fail.
  const scopedInventoryNames = (text: string): string[] => names(text).filter(name => name !== 'source' && name !== 'family')
  const matchOrThrow = (text: string, pattern: RegExp, label: string): RegExpMatchArray => {
    const match = text.match(pattern)
    if (!match) throw new Error(`missing exact MCP inventory in ${label}`)
    return match
  }

  test('inventory extraction preserves duplicates and unknown names for the equality guard', () => {
    expect(scopedInventoryNames('`execute`, `execute`, `source`, and `not_a_tool`.')).toEqual(['execute', 'execute', 'not_a_tool'])
  })

  test('llms and maintained docs name every local and hosted tool exactly once', () => {
    const local = LOCAL_TOOLS.map(tool => tool.name)
    const hosted = HOSTED_TOOLS.map(tool => tool.name)

    const llms = readFileSync(join(REPO, 'llms.txt'), 'utf8')
    const llmsInventory = matchOrThrow(
      llms,
      /Local MCP exposes (\d+) tools:([\s\S]*?)\. Hosted MCP exposes (\d+) tools:([\s\S]*?)\.\n/,
      'llms.txt',
    )
    expect({ count: Number(llmsInventory[1]), tools: names(llmsInventory[2]!) })
      .toEqual({ count: local.length, tools: local })
    expect({ count: Number(llmsInventory[3]), tools: names(llmsInventory[4]!) })
      .toEqual({ count: hosted.length, tools: hosted })

    const exactHostedInventories = [
      ['website/README.md', /Hosted tools:([\s\S]*?)\. Tool inputs/],
      ['docs/api.md', /Hosted tools are ([^;]+);/],
      ['website/source/start.md', /Tools: ([^(]+) \(64 KB/],
      ['README.md', /- \*\*Hosted\.\*\*[^\n]*?\(tools: ([^;]+); 64 KB/],
      ['Instructions_for_agents.md', /A hosted MCP at ([\s\S]*?) — which apply/],
      ['skills/agentic-mermaid-diagram-workflow/SKILL.md', /No local install, network only[\s\S]*?JSON-RPC; ([\s\S]*?) tools —/],
      ['docs/features.md', /It exposes nine bounded MCP JSON-RPC tools:([\s\S]*?)structured edits\./],
      ['docs/fork-differences.md', /registry-checked tools:([\s\S]*?)structured-edit tools\./],
      ['docs/mcp-http-transport.md', /Cloudflare-backed, tools ([\s\S]*?), inputs capped/],
    ] as const
    for (const [file, pattern] of exactHostedInventories) {
      const inventory = matchOrThrow(readFileSync(join(REPO, file), 'utf8'), pattern, file)
      const mentioned = scopedInventoryNames(inventory[1]!)
      expect({ file, tools: mentioned }).toEqual({ file, tools: hosted })
    }
  })

  test('every maintained hosted-cache contract says private compute + no-store + observable status', () => {
    const surfaces = [
      'llms.txt',
      'docs/mcp-http-transport.md',
      'website/public/llms.txt',
      'website/public/.well-known/llms.txt',
    ]
    for (const file of surfaces) {
      const text = readFileSync(join(REPO, file), 'utf8')
      expect({ file, privateCompute: /private[^\n.]*cache/i.test(text) }).toEqual({ file, privateCompute: true })
      expect({ file, noStore: /cache-control:?`?\s*no-store|`cache-control: no-store`/i.test(text) }).toEqual({ file, noStore: true })
      expect({ file, status: text.includes('x-agentic-mermaid-compute-cache') }).toEqual({ file, status: true })
      expect({ file, falseEdgeClaim: /(?:responses?|results?) (?:are|is) edge-cached/i.test(text) }).toEqual({ file, falseEdgeClaim: false })
    }
  })
})

describe('family and operation prose derives from registries', () => {
  test('comparison docs avoid copied family and operation totals', () => {
    for (const file of ['docs/comparison.md', 'docs/fork-differences.md']) {
      const text = readFileSync(join(REPO, file), 'utf8')
      expect({ file, opTotal: /\b\d+ ops?\b/.test(text) }).toEqual({ file, opTotal: false })
      expect({ file, familyFraction: /\b\d+ of \d+ families\b/.test(text) }).toEqual({ file, familyFraction: false })
      expect(text.toLowerCase()).toContain('every registered family')
    }
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
      'CLAUDE.md',
      'DESIGN.md',
      'Instructions_for_agents.md',
      'PRODUCT.md',
      'README.md',
      'SECURITY.md',
      'THIRD_PARTY_NOTICES.md',
      'TODO.md',
    ])
  })

  test('theme and RenderOptions inventory is delegated to live discovery and focused docs', () => {
    const readme = readFileSync(join(REPO, 'README.md'), 'utf8')
    const theming = readFileSync(join(REPO, 'docs/theming.md'), 'utf8')
    const api = readFileSync(join(REPO, 'docs/api.md'), 'utf8')
    const config = readFileSync(join(REPO, 'docs/config.md'), 'utf8')
    expect(readme).toContain('Discoverable palettes')
    expect(theming).toContain('knownStyleDescriptors()')
    expect(theming).toContain('does not copy the registry')
    expect(theming).not.toMatch(/ships \*\*\d+ built-in themes/)
    for (const option of ['shadow', 'embedFontImport', 'compact', 'idPrefix', 'security', 'ganttToday']) {
      expect(api).toContain(`\`${option}\``)
    }
    for (const seam of [
      'Live host retheming',
      'AsciiRenderOptions',
      'onProjectionDiagnostic',
      'BrowserPngRasterizer',
      'parseExtensionId',
      'registerExtension',
      'ExtensionCollisionError',
    ]) {
      expect({ seam, inventoried: api.includes(seam) }).toEqual({ seam, inventoried: true })
    }
    expect(config).toContain('gantt.displayMode')
    expect(SDK_DECLARATION).toContain('gantt?:')
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
    // The withSeededRandom apparatus is gone; spec should say determinism is
    // structural. "layout seed" (not bare "seed"): the render option seed is
    // a STYLE seed that re-rolls ink, and the spec must not deny it exists.
    expect(spec).not.toContain('withSeededRandom(ctx.rng, fn)')
    expect(spec.toLowerCase()).toContain('there is no layout seed')
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

  test('removed editor seed-shuffle affordance is not advertised as current UI', () => {
    const checks = [
      ['src/types.ts', 'editor "shuffle"'],
      ['docs/project/archive/styles-rollout.md', '🎲'],
      ['docs/project/archive/styles-rollout.md', 'style picker, 🎲 shuffle'],
      ['scripts/sketch-prototype/SPEC.md', 'editor "shuffle"'],
    ] as const
    for (const [file, stale] of checks) {
      const text = readFileSync(join(REPO, file), 'utf8')
      expect({ file, stale, present: text.includes(stale) }).toEqual({ file, stale, present: false })
    }
  })

  test('local and hosted Code Mode boundaries are named honestly', () => {
    const spec = readFileSync(join(REPO, 'AGENT_NATIVE.md'), 'utf8')
    const rationale = readFileSync(join(REPO, 'docs/mcp-code-mode-rationale.md'), 'utf8')
    for (const [file, text] of [['AGENT_NATIVE.md', spec], ['docs/mcp-code-mode-rationale.md', rationale]] as const) {
      expect({ file, localVm: text.includes('node:vm') }).toEqual({ file, localVm: true })
      expect({ file, hostedIsolate: text.includes('Dynamic Worker') }).toEqual({ file, hostedIsolate: true })
      expect({ file, codemodePackage: text.includes('@cloudflare/codemode') }).toEqual({ file, codemodePackage: true })
    }
    expect(spec).toContain('neither runtime depends on `@cloudflare/codemode`')
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
      ['pie title Pets\n  "Dogs" : 386\n  "Cats" : 85', 'pie'],
      ['quadrantChart\n  title T\n  Campaign A: [0.3, 0.6]', 'quadrant'],
      ['architecture-beta\n  group api(cloud)[API]', 'architecture'],
      ['gantt\n  Task A :a1, 2024-01-01, 3d', 'gantt'],
      ['mindmap\n  root\n    child', 'mindmap'],
      ['gitGraph\n  commit', 'gitgraph'],
    ]
    // `detectDiagramType` is the shared renderer router: state diagrams still
    // route through the flowchart renderer path, then agent parsing splits
    // them into the dedicated `state` family.
    expect(new Set(cases.map(([, expected]) => expected))).toEqual(new Set(BUILTIN_FAMILY_METADATA.filter(f => f.id !== 'state').map(f => f.id)))
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
    const manifestText = readFileSync(join(REPO, 'skill-evals/shared-benchmark.json'), 'utf8')
    const manifest = JSON.parse(manifestText)
    const cases = manifest.cases as Array<{ id: string; split: string; kind: string; tags?: string[]; files?: string[]; prompt?: string; prompt_ref?: string }>
    const tags = new Set(cases.flatMap(c => c.tags ?? []))
    for (const family of BUILTIN_FAMILY_METADATA.map(f => f.id)) {
      expect({ family, covered: tags.has(`family:${family}`) }).toEqual({ family, covered: true })
      expect({
        family,
        fixtureCase: cases.some(c => (c.tags ?? []).includes(`family:${family}`) && Boolean(c.files?.length)),
      }).toEqual({ family, fixtureCase: true })
    }
    expect(manifestText).not.toContain('source-level-only in Agentic Mermaid')
    for (const channel of ['library', 'cli', 'mcp-code-mode']) {
      expect({ channel, covered: tags.has(`channel:${channel}`) }).toEqual({ channel, covered: true })
    }
    expect(cases.filter(c => c.kind === 'adversarial').length).toBeGreaterThanOrEqual(4)
    expect(cases.some(c => c.kind === 'negative')).toBe(true)
    expect(cases.filter(c => c.kind === 'trigger' && (c.tags ?? []).includes('no-trigger')).length).toBeGreaterThanOrEqual(2)
    expect(cases.filter(c => c.files?.length).length).toBeGreaterThanOrEqual(BUILTIN_FAMILY_METADATA.length)
    expect(cases.filter(c => c.split === 'holdout').length).toBeGreaterThan(0)
    expect(cases.filter(c => c.split === 'holdback').length).toBeGreaterThan(0)
    for (const c of cases.filter(c => c.split === 'holdout' || c.split === 'holdback')) {
      expect({ id: c.id, publicPrompt: Boolean(c.prompt), privateRef: c.prompt_ref?.startsWith('private/') }).toEqual({ id: c.id, publicPrompt: false, privateRef: true })
    }
    for (const c of cases.flatMap(c => c.files ?? [])) expect(existsSync(join(REPO, 'skill-evals', c))).toBe(true)
    expect(manifest.run_policy.minimum_runs_per_variant).toBeGreaterThanOrEqual(3)
    expect(manifest.run_policy.recommended_runs_per_variant).toBeGreaterThanOrEqual(5)
  })
})

describe('shipped distribution artifacts present', () => {
  test('skill bundle + workflow + examples', () => {
    // No committed Claude hooks/settings or bundled agents/worktrees may ship.
    // Check what Git TRACKS, not what sits on disk: agent harnesses drop
    // untracked session files (settings.local.json, task locks) into .claude/
    // and a disk-based check fails on developer machines for files that could
    // never ship.
    const trackedClaude = spawnSync('git', ['ls-files', '.claude'], { cwd: REPO, encoding: 'utf8' })
    expect((trackedClaude.stdout ?? '').trim()).toBe('')
    const trackedAgents = spawnSync('git', ['ls-files', '.agents'], { cwd: REPO, encoding: 'utf8' })
    expect((trackedAgents.stdout ?? '').trim()).toBe('')
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

  test('agent-loop example runs', async () => {
    // Previously only existence-checked; execute it so parse/mutate/serialize
    // drift can't ship green. It prints a human-readable trace, not JSON.
    const r = await runBunExample(join(REPO, 'examples/agent-loop.ts'))
    expect({ status: r.status, timedOut: r.timedOut, stderr: r.stderr }).toEqual({ status: 0, timedOut: false, stderr: '' })
    expect(r.stdout).toContain('round-trips losslessly: true')
  }, 90_000)

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
  }, 90_000)

  test('agent improvement example assesses, mutates, reassesses, and writes render files', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'am-example-test-'))
    try {
      // No --test-png-placeholder: exercise the real out-of-process PNG render.
      // This is the documented `bun run examples/...` invocation end-to-end.
      const r = await runBunExample(join(REPO, 'examples/agent-improve-auth-flow.ts'), ['--out-dir', outDir], 120_000)
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
      // A real rasterized diagram is many KB; a placeholder/regression would not be.
      expect(png.length).toBeGreaterThan(1000)
      expect(assessment.improveOps).toBe(3)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 150_000)

  test('npm package includes bundled PNG fonts and delegated docs', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    expect(pkg.files).toContain('assets/fonts/')
    for (const doc of ['TODO.md', 'SECURITY.md', 'docs/', 'skills/', 'skill-evals/']) expect(pkg.files).toContain(doc)
    for (const removedRootDoc of ['FEATURES.md', 'FORK_DIFFERENCES.md', 'QUALITY.md']) expect(pkg.files).not.toContain(removedRootDoc)
    // Paths are in npm's canonical (no `./`) form after `npm pkg fix`; both
    // forms resolve identically at install, and the canonical form keeps
    // `npm publish` from emitting an auto-correct warning.
    expect(pkg.bin).toEqual({
      am: 'dist/am.js',
      'agentic-mermaid': 'dist/am.js',
      'agentic-mermaid-mcp': 'dist/agentic-mermaid-mcp.js',
    })
    expect(pkg.publishConfig).toMatchObject({ access: 'public', provenance: true })
    expect(pkg.engines.node).toBe('>=18')
    for (const example of ['examples/agent-loop.ts', 'examples/mcp-vs-cli-complex-diagrams.ts', 'examples/agent-improve-auth-flow.ts']) expect(pkg.files).toContain(example)
    expect(existsSync(join(REPO, 'assets/fonts/DejaVuSans.ttf'))).toBe(true)
    expect(existsSync(join(REPO, 'assets/fonts/DejaVuSans-Bold.ttf'))).toBe(true)
    // Tarball slimming: sourcemaps, shipped tests, and PR-evidence images are
    // kept out of the npm tarball via files negation (keeps unpacked size ~10MB).
    for (const exclude of ['!dist/**/*.map', '!src/**/__tests__/**', '!src/**/*.test.ts', '!docs/pr-assets/**']) expect(pkg.files).toContain(exclude)
    // Redundant Bun source bins are not published; the bin map points at dist/*.js.
    expect(pkg.files).not.toContain('bin/')
  })
})
