// Agent-facing docs and declarations stay true: their snippets and examples
// run, `am --agent-instructions` is the committed guide, and the Code Mode SDK
// declaration matches the runtime registries and sandbox.

import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build as buildWithEsbuild } from 'esbuild'
import ts from 'typescript'
import { lintAgentTrace, type SdkCall } from '../../eval/agent-usage/harness.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { mutate, parseRegisteredMermaid, serializeMermaid } from '../agent/core.ts'
import type { AnyMutationOp, DiagramKind, MutableValidDiagram, ParsedDiagram } from '../agent/types.ts'
import * as agentTypes from '../agent/types.ts'
import { WARNING_SEVERITY, WARNING_TIER } from '../agent/types.ts'
import { AGENT_INSTRUCTIONS } from '../cli/agent-instructions.ts'
import { buildCapabilities, MUTATION_OPS_BY_FAMILY } from '../cli/index.ts'
import { HOSTED_TOOLS } from '../mcp/hosted-server.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { SDK_DECLARATION } from '../mcp/sdk-decl.ts'

const REPO = join(import.meta.dir, '..', '..')

/** One declared, representative edit per built-in family; each introduces "zebra". */
const TYPED_EDIT_BY_FAMILY: Partial<Record<DiagramKind, { kind: string } & Record<string, unknown>>> = {
  flowchart: { kind: 'add_node', id: 'Zebra', label: 'Zebra' },
  state: { kind: 'add_state', id: 'Zebra' },
  sequence: { kind: 'add_participant', id: 'Zebra' },
  timeline: { kind: 'add_period', sectionIndex: 0, label: 'Zebra' },
  class: { kind: 'add_class', id: 'Zebra' },
  er: { kind: 'add_entity', id: 'ZEBRA' },
  journey: { kind: 'add_section', label: 'Zebra' },
  architecture: { kind: 'add_service', id: 'zebra', label: 'Zebra' },
  xychart: { kind: 'set_title', title: 'Zebra' },
  pie: { kind: 'add_slice', label: 'Zebra', value: 5 },
  quadrant: { kind: 'add_point', label: 'Zebra', x: 0.5, y: 0.5 },
  gantt: { kind: 'add_section', label: 'Zebra' },
  mindmap: { kind: 'add_node', id: 'Zebra', label: 'Zebra', parent: 'root' },
  gitgraph: { kind: 'create_branch', name: 'zebra' },
  radar: { kind: 'add_axis', id: 'zebra', label: 'Zebra' },
  sankey: { kind: 'add_link', source: 'Zebra', target: 'Industry', value: 1 },
}

const SDK_AST = ts.createSourceFile('code-mode-sdk.d.ts', SDK_DECLARATION, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

/** String-literal members of a `type Name = 'A' | 'B'` alias in the SDK declaration. */
function sdkStringUnion(name: string): string[] {
  const alias = SDK_AST.statements.find((statement): statement is ts.TypeAliasDeclaration =>
    ts.isTypeAliasDeclaration(statement) && statement.name.text === name)
  if (!alias) return []
  const members = ts.isUnionTypeNode(alias.type) ? alias.type.types : [alias.type]
  return members.flatMap(member => ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal) ? [member.literal.text] : [])
}

/** Method names declared on the SDK's `declare const mermaid: { ... }` global. */
function sdkMermaidMethodNames(): string[] {
  for (const statement of SDK_AST.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'mermaid' || !declaration.type || !ts.isTypeLiteralNode(declaration.type)) continue
      return declaration.type.members.flatMap(member => ts.isMethodSignature(member) && ts.isIdentifier(member.name) ? [member.name.text] : [])
    }
  }
  return []
}

/** Type-check the SDK declaration on its own, as an agent's editor would see it. */
function sdkDeclarationTypeErrors(): string[] {
  const fileName = join(tmpdir(), 'agentic-mermaid-code-mode-sdk.d.ts')
  const options: ts.CompilerOptions = { noEmit: true, strict: true, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts'], types: [] }
  const host = ts.createCompilerHost(options)
  const readSourceFile = host.getSourceFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  host.getSourceFile = (name, languageVersion, ...rest) => name === fileName
    ? ts.createSourceFile(name, SDK_DECLARATION, languageVersion, true, ts.ScriptKind.TS)
    : readSourceFile(name, languageVersion, ...rest)
  host.fileExists = name => name === fileName || fileExists(name)
  return ts.getPreEmitDiagnostics(ts.createProgram([fileName], options, host))
    .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

describe('Instructions_for_agents.md', () => {
  test('byte-matches am --agent-instructions exactly', () => {
    const guide = readFileSync(join(REPO, 'Instructions_for_agents.md'), 'utf8')
    expect(AGENT_INSTRUCTIONS).toEqual(guide)
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
      new Promise<string>(resolve => {
        timer = setTimeout(() => resolve(''), timeoutMs)
      }),
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
    const bunCrashed = r.stderr.includes('Bun has crashed') || (typeof r.status === 'number' && r.status >= 128) || (r.status === null && !r.timedOut)
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
  const [stdout, stderr] = await Promise.all(timedOut ? [readWithTimeout(stdoutPromise, 2_000), readWithTimeout(stderrPromise, 2_000)] : [stdoutPromise, stderrPromise])
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

describe('Code Mode SDK declaration matches the runtime', () => {
  test('MCP SDK WarningCode exactly matches the runtime warning registry', () => {
    expect(sdkStringUnion('WarningCode').sort()).toEqual(Object.keys(WARNING_TIER).sort())
  })

  test('every MutationOp kind is in capabilities and the MCP SDK declaration', () => {
    const cap = buildCapabilities()
    for (const [family, ops] of Object.entries(MUTATION_OPS_BY_FAMILY)) {
      const familyCap = cap.families.find(f => f.id === family)
      expect(familyCap?.mutationOps).toEqual([...ops])
      expect(familyCap?.editPolicy).toBe('structured-when-narrowed')
      for (const op of ops) expect(SDK_DECLARATION).toContain(op)
    }
  })

  test('MCP SDK declaration type-checks and exposes every mutable family', () => {
    // Every family's narrower is a method on the `mermaid` global, and the
    // whole declaration compiles: a family whose body or op union the
    // declaration names but never declares fails here.
    const methods = new Set(sdkMermaidMethodNames())
    for (const family of BUILTIN_FAMILY_METADATA) {
      expect({ family: family.id, narrower: methods.has(family.narrower) }).toEqual({ family: family.id, narrower: true })
    }
    expect(methods.has('mutate')).toBe(true)
    expect(sdkDeclarationTypeErrors()).toEqual([])
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
      asRadar: 'radar-beta\\n  axis a, b, c\\n  curve x{1, 2, 3}',
      asSankey: 'sankey-beta\\n  Coal,Electricity,127.93',
    }
    for (const narrower of advertised) {
      const source = SOURCES[narrower]
      expect({ narrower, known: Boolean(source) }).toEqual({ narrower, known: true })
      const code = `const r = mermaid.parseRegisteredMermaid('${source}')\nif (!r.ok) return { narrower: '${narrower}', phase: 'parse' }\nconst n = mermaid.${narrower}(r.value)\nreturn { narrower: '${narrower}', narrowed: n !== null }`
      const result = await executeInSandbox(code, {})
      expect({ narrower, ok: result.ok, value: result.ok ? result.value : result.error }).toEqual({ narrower, ok: true, value: { narrower, narrowed: true } })
    }
  })

  test('every registered renderable family ships typed mutation (default-by-default enforcement)', () => {
    // Typed mutation is the enforced default: a new family cannot register
    // source-level-only. For every registered family, its own example narrows
    // (and no other family's narrower accepts it), one declared op applies
    // through the FamilyDescriptor mutate + serialize hooks, and the edited
    // source reparses to the same family and re-serializes byte-identically.
    // This closes the loophole where a family could ship without a structured
    // editing surface (as pie/quadrant once did).
    const FAIL = 'New families ship with typed mutation by default — see docs/contributing/adding-diagram-types.md.'
    const narrowers = agentTypes as unknown as Record<string, (d: ParsedDiagram) => unknown>
    for (const family of BUILTIN_FAMILY_METADATA) {
      const kind = family.id
      const edit = TYPED_EDIT_BY_FAMILY[kind]
      expect({ kind, hasEditFixture: edit !== undefined, msg: FAIL }).toEqual({ kind, hasEditFixture: true, msg: FAIL })
      expect({ kind, opDeclared: (MUTATION_OPS_BY_FAMILY[kind] as readonly string[]).includes(edit!.kind), msg: FAIL })
        .toEqual({ kind, opDeclared: true, msg: FAIL })

      const parsed = parseRegisteredMermaid(family.example)
      if (!parsed.ok) throw new Error(`${kind} example does not parse`)
      for (const other of BUILTIN_FAMILY_METADATA) {
        const narrowed = typeof narrowers[other.narrower] === 'function' ? narrowers[other.narrower]!(parsed.value) : undefined
        expect({ kind, narrower: other.narrower, accepts: narrowed !== null && narrowed !== undefined })
          .toEqual({ kind, narrower: other.narrower, accepts: other.id === kind })
      }
      const typed = narrowers[family.narrower]!(parsed.value) as MutableValidDiagram
      const mutated = mutate(typed, edit as AnyMutationOp)
      expect({ kind, mutated: mutated.ok ? true : mutated.error, msg: FAIL }).toEqual({ kind, mutated: true, msg: FAIL })
      if (!mutated.ok) continue
      const source = serializeMermaid(mutated.value)
      expect({ kind, before: /zebra/i.test(serializeMermaid(parsed.value)), after: /zebra/i.test(source) })
        .toEqual({ kind, before: false, after: true })
      const reparsed = parseRegisteredMermaid(source)
      expect({ kind, reparsedKind: reparsed.ok ? reparsed.value.kind : reparsed.error })
        .toEqual({ kind, reparsedKind: kind })
      if (reparsed.ok) expect({ kind, stable: serializeMermaid(reparsed.value) === source }).toEqual({ kind, stable: true })
    }
  })
})

describe('start.md bootstrap claims stay true', () => {
  // start.md is the hosted bootstrap the homepage pointer fetches and the source
  // the inline homepage prompt is composed from. It is deliberately condensed —
  // it does NOT enumerate every narrower/warning code (it points at
  // capabilities.json for those), so it does not belong in the exhaustive
  // reference-doc loops above. Instead, pin every claim it DOES make: whatever
  // narrowers, warning codes, and tools it names must be real.
  const START = readFileSync(join(REPO, 'website/source/start.md'), 'utf8')

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

describe('documented package usage works', () => {
  test('React client recipes bundle through the browser ESM entry', async () => {
    for (const file of ['docs/react.md', 'docs/getting-started.md']) {
      const text = readFileSync(join(REPO, file), 'utf8')
      if (file === 'docs/react.md') {
        expect(text).toContain('className="diagram diagram-surface"')
        expect(text).toContain('.diagram-surface {')
        expect(text).toContain('.dark .diagram-surface {')
      }
      const clientBlocks = Array.from(text.matchAll(/```tsx\n([\s\S]*?)\n```/g))
        .map(match => match[1]!)
        .filter(block => /from ['"]react['"]/.test(block))
      expect(clientBlocks.length, file).toBeGreaterThan(0)
      for (const block of clientBlocks) {
        expect({ file, block }).toMatchObject({ block: expect.stringContaining("from 'agentic-mermaid/browser/lazy'") })
        expect(block).not.toMatch(/from ['"]agentic-mermaid(?:\/agent)?['"]/)
        const bundled = await buildWithEsbuild({
          stdin: {
            contents: block,
            loader: 'tsx',
            resolveDir: REPO,
            sourcefile: `${file}.tsx`,
          },
          bundle: true,
          platform: 'browser',
          format: 'esm',
          jsx: 'automatic',
          external: ['react', 'react/jsx-runtime'],
          write: false,
          metafile: true,
          logLevel: 'silent',
          plugins: [{
            name: 'agentic-mermaid-browser-entry',
            setup(build) {
              build.onResolve({ filter: /^agentic-mermaid\/browser\/lazy$/ }, () => ({
                path: join(REPO, 'src/browser-lazy.ts'),
              }))
            },
          }],
        })
        expect(bundled.outputFiles.length).toBeGreaterThan(0)
        const inputs = Object.keys(bundled.metafile.inputs)
        expect(inputs.some(input => input.includes('@resvg') || input.includes('/agent/png.'))).toBe(false)
      }
    }
  })

  test('package-runner quickstarts install the published package and run a real subcommand', () => {
    // `npx <pkg> <sub>` resolves the bin named after the package, so every
    // documented invocation must name this package, that bin must exist, and
    // the subcommand must be one `am` accepts.
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { name: string; bin: Record<string, string> }
    expect(pkg.bin[pkg.name]).toBe(pkg.bin.am)
    const docs = ['README.md', 'AGENT_NATIVE.md', 'Instructions_for_agents.md', 'llms.txt', 'website/source/start.md',
      ...readdirSync(join(REPO, 'docs')).filter(file => file.endsWith('.md')).map(file => `docs/${file}`)]
    const invocations: Array<{ file: string; pkg: string; sub: string }> = []
    for (const file of docs) {
      const text = readFileSync(join(REPO, file), 'utf8')
      for (const match of text.matchAll(/\bnpx\s+(?:-y\s+)?(agentic-mermaid[\w-]*)(?:\s+([a-z][\w-]*))?/g)) {
        invocations.push({ file, pkg: match[1]!, sub: match[2] ?? '' })
      }
      for (const match of text.matchAll(/"args":\s*\[\s*"-y",\s*"(agentic-mermaid[\w-]*)"(?:,\s*"([a-z][\w-]*)")?/g)) {
        invocations.push({ file, pkg: match[1]!, sub: match[2] ?? '' })
      }
    }
    expect(invocations.length).toBeGreaterThan(0)
    const subcommands = new Set<string>()
    for (const invocation of invocations) {
      expect(invocation).toEqual({ ...invocation, pkg: pkg.name })
      if (invocation.sub) subcommands.add(invocation.sub)
    }
    expect(subcommands.has('mcp')).toBe(true)
    for (const sub of subcommands) {
      const help = spawnSync('bun', ['run', join(REPO, 'bin/am.ts'), sub, '--help'], { cwd: REPO, encoding: 'utf8' })
      expect({ sub, status: help.status }).toEqual({ sub, status: 0 })
    }
  }, 60_000)
})

describe('shipped examples run', () => {
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
      // No --test-png-placeholder: exercise the real PNG render, in the same
      // process right after Code Mode's execute (the #298 sequence). This is
      // the documented `bun run examples/...` invocation end-to-end.
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
})
