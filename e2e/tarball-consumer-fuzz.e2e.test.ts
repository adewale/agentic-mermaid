// Fuzz the REAL consumer path: `npm pack` -> install the tarball into a clean
// project -> drive the installed package and its bins under plain Node with
// fast-check-generated input. This is the last artifact layer the suite did not
// cover. dist-artifact.e2e.test.ts owns distinct bundler/dependency-loading risks;
// this owns differential fuzz of what actually ships and installs — files[] completeness, the
// exports map resolving bare specifiers, bin linking, native-dep install, and
// the CLI/MCP bins as spawned Node processes.
//
// Three arms, one install:
//   T1  installed library  — `import('agentic-mermaid')` / `.../agent` resolve
//       and render identically to the source build (crash parity + flowchart
//       byte-equality + raw PNG parity across runtimes and packaged resources).
//   T2  `am` bin           — `am batch --jsonl` over generated ops (one bad line
//       never aborts the stream; ASCII output matches source), plus one-shot
//       `am render` across formats and a not-found file.
//   T3  `agentic-mermaid-mcp` bin — generated JSON-RPC over stdio yields
//       well-formed responses and never crashes the server.
//
// Skips only when Node/npm are unavailable; a failed build/pack/install FAILS
// (that is the shipping path breaking), it does not skip.
import { describe, test, expect, beforeAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync, mkdtempSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import fc from 'fast-check'
import '../src/__tests__/fc-seed.preload.ts'
import { verifyMermaid, renderMermaidSVG, renderMermaidASCII, renderMermaidPNG, BUILTIN_FAMILY_METADATA } from '../src/agent/index.ts'
import { runGettingStartedCommands } from './helpers/getting-started.ts'

const REPO = join(import.meta.dir, '..')
const BUILD_TIMEOUT_MS = 180_000
const INSTALL_TIMEOUT_MS = 240_000
const RUN_TIMEOUT_MS = 180_000
const PNG_PARITY_N = 8
const PACKAGE_FAMILY_FIXTURES = [
  { family: 'mindmap', source: 'mindmap\n  Root\n    Research\n      Evidence' },
  { family: 'gitgraph', source: 'gitGraph\n  commit id:"base" msg:"Foundation"\n  branch feature\n  commit id:"work"' },
] as const

function findBinary(name: string, extra: string[] = []): string | null {
  const candidates = [process.env[`${name.toUpperCase()}_BINARY`], name, ...extra].filter((x): x is string => Boolean(x))
  for (const c of candidates) {
    try { if (spawnSync(c, ['--version'], { encoding: 'utf8' }).status === 0) return c } catch {}
  }
  return null
}
const NODE = findBinary('node', ['/opt/node22/bin/node'])
const NPM = findBinary('npm')
if (!NODE || !NPM) throw new Error('tarball consumer gate requires plain Node and npm executables')

// ---------------------------------------------------------------------------
// Reference (source build, Bun). Node drivers below mirror this tag logic.
// ---------------------------------------------------------------------------
const sha = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex')
const tag = (fn: () => string): string => { try { return sha(String(fn())) } catch { return 'THREW' } }
const refLayout = (src: string) => tag(() => JSON.stringify(verifyMermaid(src).layout ?? null))
const refSvg = (src: string) => tag(() => renderMermaidSVG(src))
const refTerminalDefault = (src: string) => tag(() => renderMermaidASCII(src))
const refAscii = (src: string) => tag(() => renderMermaidASCII(src, { useAscii: true }))

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------
const idArb = fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F', 'G', 'Svc', 'DB', 'Cache', 'n1', 'n2')
// This arm asserts unconditional render success, so construct labels from the
// admitted grammar rather than filtering arbitrary quote/backtick fragments.
const labelCharArb = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _')
const labelArb = fc.array(labelCharArb, { minLength: 1, maxLength: 10 }).map(chars => chars.join(''))
const edgeArb = fc.tuple(idArb, idArb, fc.option(labelArb, { nil: undefined })).map(
  ([a, b, l]) => (l ? `${a} -->|${l}| ${b}` : `${a} --> ${b}`),
)
const flowchartArb = fc.tuple(
  fc.constantFrom('flowchart TD', 'flowchart LR', 'graph TD', 'graph LR'),
  fc.array(edgeArb, { minLength: 1, maxLength: 8 }),
).map(([h, edges]) => [h, ...edges].join('\n'))

const SPECIAL_CHARS = ['[', ']', '{', '}', '(', ')', '|', ':', ';', '-', '=', '"', "'", '\\', '/', '\n', '\t', ' ', '​', '￿']
const specialCharStringArb = fc.array(fc.constantFrom(...SPECIAL_CHARS), { maxLength: 60 }).map(c => c.join(''))
// Every built-in enters the real installed-consumer transport. The canonical
// examples are packaging parity witnesses, not semantic expectations.
const familyHeaderArb = fc.constantFrom(...BUILTIN_FAMILY_METADATA.map(family => family.headers[0]!))
const mixedArb = fc.oneof(
  flowchartArb,
  fc.tuple(familyHeaderArb, fc.array(fc.string({ maxLength: 30 }), { maxLength: 6 })).map(([h, b]) => [h, ...b].join('\n')),
  // JSON.stringify escapes embedded line breaks in every consumer transport.
  fc.string({ maxLength: 120 }),
  specialCharStringArb,
)
const codeArb = fc.oneof(
  fc.string({ maxLength: 80 }).map(s => s.replace(/[\n\r]/g, ' ')),
  fc.constantFrom(
    'return 1 + 1',
    'return mermaid.parseRegisteredMermaid("flowchart TD\\n A --> B")',
    'while (true) {}',
    'throw new Error("boom")',
    'undefined.x',
    'return require("node:fs")',
  ),
)

// Consumer install state (populated by beforeAll).
let work = ''
let tarball = ''
let packageDir = ''
let amBin = ''
let mcpBin = ''
let binShimAm = ''
let binShimMcp = ''
let haveConsumer = false

beforeAll(() => {
  const build = spawnSync('bun', ['run', 'build'], { cwd: REPO, encoding: 'utf8', timeout: BUILD_TIMEOUT_MS })
  if (build.status !== 0) throw new Error(`bun run build failed (${build.status}):\n${build.stderr ?? ''}`)

  work = mkdtempSync(join(tmpdir(), 'am-consumer-'))
  const version = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version as string
  const privateEvalDir = join(REPO, 'skill-evals', 'private')
  mkdirSync(privateEvalDir, { recursive: true })
  const privateProbeDir = mkdtempSync(join(privateEvalDir, 'pack-exclusion-'))
  const privateSentinel = join(privateProbeDir, 'sentinel.txt')
  writeFileSync(privateSentinel, 'must never ship\n')
  let pack: ReturnType<typeof spawnSync>
  try {
    pack = spawnSync(NPM, ['pack', '--pack-destination', work], { cwd: REPO, encoding: 'utf8', timeout: BUILD_TIMEOUT_MS })
  } finally {
    rmSync(privateProbeDir, { recursive: true, force: true })
  }
  if (pack.status !== 0) throw new Error(`npm pack failed (${pack.status}):\n${pack.stderr ?? ''}`)
  tarball = join(work, `agentic-mermaid-${version}.tgz`)
  if (!existsSync(tarball)) throw new Error(`expected tarball missing: ${tarball}`)

  writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'am-consumer', private: true, version: '1.0.0' }))
  const install = spawnSync(NPM, ['install', tarball, '--no-audit', '--no-fund'], { cwd: work, encoding: 'utf8', timeout: INSTALL_TIMEOUT_MS })
  if (install.status !== 0) throw new Error(`npm install <tarball> failed (${install.status}):\n${install.stderr ?? ''}`)

  packageDir = join(work, 'node_modules', 'agentic-mermaid')
  if (existsSync(join(packageDir, 'skill-evals', 'private'))) {
    throw new Error('npm package leaked ignored private skill-eval material')
  }
  amBin = join(packageDir, 'dist', 'am.js')
  mcpBin = join(packageDir, 'dist', 'agentic-mermaid-mcp.js')
  binShimAm = join(work, 'node_modules', '.bin', 'am')
  binShimMcp = join(work, 'node_modules', '.bin', 'agentic-mermaid-mcp')
  for (const p of [amBin, mcpBin]) if (!existsSync(p)) throw new Error(`installed bin missing: ${p}`)
  haveConsumer = true
}, BUILD_TIMEOUT_MS + INSTALL_TIMEOUT_MS + RUN_TIMEOUT_MS)

test('Getting Started shell commands and pinned MCP config work against the packed package', () => {
  expect(haveConsumer).toBe(true)
  runGettingStartedCommands(REPO, tarball)
}, BUILD_TIMEOUT_MS + INSTALL_TIMEOUT_MS + RUN_TIMEOUT_MS)

// ---------------------------------------------------------------------------
// T1 — installed library, imported by bare specifier and run under Node.
// ---------------------------------------------------------------------------
const LIB_DRIVER = `
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const { inputs, pngInputs } = JSON.parse(readFileSync(process.env.AM_FUZZ_INPUT, 'utf8'))
const base = await import('agentic-mermaid')
const agent = await import('agentic-mermaid/agent')
const core = await import('agentic-mermaid/agent/core')
const resolved = {
  baseSvg: typeof base.renderMermaidSVG, baseAscii: typeof base.renderMermaidASCII, baseStyles: typeof base.knownStyleDescriptors,
  agentVerify: typeof agent.verifyMermaid, agentSvg: typeof agent.renderMermaidSVG, agentPng: typeof agent.renderMermaidPNG,
  coreVerify: typeof core.verifyMermaid, coreSvg: typeof core.renderMermaidSVG, corePng: typeof core.renderMermaidPNG,
}
const { verifyMermaid, renderMermaidSVG, renderMermaidASCII, renderMermaidPNG } = agent
const sha = (s) => createHash('sha256').update(s).digest('hex')
const tag = (fn) => { try { return sha(String(fn())) } catch { return 'THREW' } }
const results = inputs.map((src) => {
  const parsed = agent.parseRegisteredMermaid(src)
  const r = {
    kind: parsed.ok ? parsed.value.body.kind : 'THREW',
    layout: tag(() => JSON.stringify(verifyMermaid(src).layout ?? null)),
    svg: tag(() => renderMermaidSVG(src)),
    ascii: tag(() => renderMermaidASCII(src)),
  }
  return r
})
const pngResults = pngInputs.map(({ source, options }) => {
  const png = renderMermaidPNG(source, options)
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
  return {
    sha256: sha(png), length: png.length, signature: [...png.subarray(0, 8)],
    ihdr: bytes.toString('ascii', 12, 16), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
  }
})
process.stdout.write(JSON.stringify({ resolved, results, pngResults }))
`

describe('installed tarball — library', () => {
  test('canonical API examples typecheck and run against the installed package', () => {
    expect(haveConsumer).toBe(true)
    const markdown = readFileSync(join(REPO, 'docs/api.md'), 'utf8')
    const examples = [...markdown.matchAll(/^```ts\s*\n([\s\S]*?)^```/gm)]
    const files = examples.map((match, index) => {
      const file = join(work, `api-example-${index}.mts`)
      writeFileSync(file, match[1]!)
      return file
    })
    const checked = spawnSync(NODE!, [join(REPO, 'node_modules/typescript/bin/tsc'), '--strict', '--skipLibCheck', '--target', 'ESNext', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--typeRoots', join(REPO, 'node_modules/@types'), ...files], {
      cwd: work, encoding: 'utf8', timeout: RUN_TIMEOUT_MS,
    })
    expect({ status: checked.status, stdout: checked.stdout, stderr: checked.stderr }).toEqual({ status: 0, stdout: '', stderr: '' })
    for (const file of files) {
      const result = spawnSync(NODE!, [file.replace(/\.mts$/, '.mjs')], { cwd: work, encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
      expect({ file, status: result.status, stderr: result.stderr }).toEqual({ file, status: 0, stderr: '' })
    }
  }, RUN_TIMEOUT_MS)

  test('resolved scenes ship typed, synchronous and browser-free through the main entry', () => {
    expect(haveConsumer).toBe(true)
    const consumer = join(work, 'resolved-scene.mts')
    writeFileSync(consumer, `
import { renderResolvedScene, RESOLVED_SCENE_VERSION, type ResolvedScene, type ResolvedPrimitive } from 'agentic-mermaid';
const scene: ResolvedScene = renderResolvedScene('flowchart LR\\n A --> B');
const version: 2 = RESOLVED_SCENE_VERSION;
const primitives: ResolvedPrimitive[] = scene.parts.flatMap(part => part.primitives);
`)
    const types = spawnSync(NODE!, [join(REPO, 'node_modules/typescript/bin/tsc'), '--noEmit', '--skipLibCheck', '--target', 'ESNext', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', consumer], {
      cwd: work, encoding: 'utf8', timeout: RUN_TIMEOUT_MS,
    })
    expect({ status: types.status, stdout: types.stdout, stderr: types.stderr }).toEqual({ status: 0, stdout: '', stderr: '' })
    const runtime = spawnSync(NODE!, ['--input-type=module', '--eval', `
import { renderResolvedScene, renderMermaidSVG } from 'agentic-mermaid';
const source='flowchart LR\\n A -->|uses ELK| B', options={style:'hand-drawn'};
const scene=renderResolvedScene(source, options);
console.log(JSON.stringify({version:scene.version, document:typeof document,
  families:['stateDiagram', 'stateDiagram-v2', 'flowchart LR'].map(header => renderResolvedScene(header+'\\nA --> B',options).family),
  parts:scene.parts.length>0, equal:scene.svg===renderMermaidSVG(source,options),
  stable:JSON.stringify(scene)===JSON.stringify(renderResolvedScene(source,options)),
  jsonSafe:JSON.stringify(scene)===JSON.stringify(JSON.parse(JSON.stringify(scene)))}));
`], { cwd: work, encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
    expect({ status: runtime.status, stderr: runtime.stderr }).toEqual({ status: 0, stderr: '' })
    expect(JSON.parse(runtime.stdout)).toEqual({ version: 2, document: 'undefined', families: ['state', 'state', 'flowchart'], parts: true, equal: true, stable: true, jsonSafe: true })
  }, RUN_TIMEOUT_MS)

  test('public package entries keep internal Style aliases out of runtime and typed consumers', () => {
    expect(haveConsumer).toBe(true)
    const consumer = join(work, 'public-api.mts')
    writeFileSync(consumer, `
import { renderMermaidSVG as baseRender } from 'agentic-mermaid';
import { renderMermaidSVG as agentRender } from 'agentic-mermaid/agent';
import { renderMermaidSVG as coreRender } from 'agentic-mermaid/agent/core';
const rendered: string[] = [baseRender('flowchart LR\\nA-->B'), agentRender('flowchart LR\\nA-->B'), coreRender('flowchart LR\\nA-->B')];
// @ts-expect-error internal implementation aliases are not public exports
import { TUFTE_STYLE_ALIAS as baseAlias } from 'agentic-mermaid';
// @ts-expect-error internal implementation aliases are not public exports
import { TUFTE_STYLE_ALIAS as agentAlias } from 'agentic-mermaid/agent';
// @ts-expect-error internal implementation aliases are not public exports
import { TUFTE_STYLE_ALIAS as coreAlias } from 'agentic-mermaid/agent/core';
`)
    const types = spawnSync(NODE!, [join(REPO, 'node_modules/typescript/bin/tsc'), '--noEmit', '--skipLibCheck', '--target', 'ESNext', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', consumer], {
      cwd: work, encoding: 'utf8', timeout: RUN_TIMEOUT_MS,
    })
    expect({ status: types.status, stdout: types.stdout, stderr: types.stderr }).toEqual({ status: 0, stdout: '', stderr: '' })
    const runtime = spawnSync(NODE!, ['--input-type=module', '--eval', `
const entries = await Promise.all(['agentic-mermaid', 'agentic-mermaid/agent', 'agentic-mermaid/agent/core'].map(name => import(name)));
console.log(JSON.stringify(entries.map(entry => Object.hasOwn(entry, 'TUFTE_STYLE_ALIAS'))));
`], { cwd: work, encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
    expect({ status: runtime.status, stderr: runtime.stderr }).toEqual({ status: 0, stderr: '' })
    expect(JSON.parse(runtime.stdout)).toEqual([false, false, false])
  }, RUN_TIMEOUT_MS)
  test('ships public API documentation without benchmark reports or benchmark tooling', () => {
    expect(haveConsumer).toBe(true)
    expect(existsSync(join(packageDir, 'docs/api.md'))).toBe(true)
    for (const path of ['docs/community-benchmark-ranking.md', 'eval/benchmark', 'eval/trident', 'bench-report']) {
      expect({ path, shipped: existsSync(join(packageDir, path)) }).toEqual({ path, shipped: false })
    }
  })

  test('published documentation entry points have no broken relative links', () => {
    expect(haveConsumer).toBe(true)
    for (const relativeHubPath of ['README.md', 'docs/README.md', 'docs/api.md', 'docs/api-advanced.md']) {
      const hubPath = join(packageDir, relativeHubPath)
      const hub = readFileSync(hubPath, 'utf8')
      const relativeLinks = [...hub.matchAll(/\]\(([^)]+)\)/g)]
        .map(match => match[1]!.trim())
        .filter(href => href !== '' && !href.startsWith('#') && !/^[a-z][a-z\d+.-]*:/i.test(href))
        .map(href => href.split('#', 1)[0]!)

      expect(relativeLinks.length).toBeGreaterThan(0)
      for (const href of relativeLinks) {
        expect({ hub: relativeHubPath, href, exists: existsSync(resolve(dirname(hubPath), href)) }).toEqual({ hub: relativeHubPath, href, exists: true })
      }
    }
  })

  test('resolves all three entry points and renders every registered family identically to source', () => {
    expect(haveConsumer).toBe(true)
    const flow = fc.sample(flowchartArb, 120)
    const mixed = fc.sample(mixedArb, 120)
    const canonicalInputs = BUILTIN_FAMILY_METADATA.map(family => family.example)
    const inputs = [...flow, ...canonicalInputs, ...PACKAGE_FAMILY_FIXTURES.map(fixture => fixture.source), ...mixed]
    const fixtureStart = flow.length + canonicalInputs.length
    const pngInputs: Array<{ source: string; options: NonNullable<Parameters<typeof renderMermaidPNG>[1]> }> = [
      ...flow.slice(0, PNG_PARITY_N).map(source => ({ source, options: {} })),
      { source: 'sequenceDiagram\n  participant A as Café\n  participant B as Zoë\n  A->>B: Contour ∮ integral', options: { scale: 1 } },
      { source: 'flowchart LR\n  A[Draft] --> B[Review]', options: { style: 'hand-drawn', seed: 7, scale: 1 } },
    ]
    writeFileSync(join(work, 'inputs.json'), JSON.stringify({ inputs, pngInputs }))
    const r = spawnSync(NODE!, ['--input-type=module', '-e', LIB_DRIVER], {
      cwd: work, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, AM_FUZZ_INPUT: join(work, 'inputs.json') },
    })
    expect(r.status, `installed library Node driver stderr:\n${r.stderr}`).toBe(0) // exports resolution / native dep load must not crash
    const { resolved, results, pngResults } = JSON.parse(r.stdout) as {
      resolved: Record<string, string>
      results: Array<{ kind: string; layout: string; svg: string; ascii: string }>
      pngResults: Array<{ sha256: string; length: number; signature: number[]; ihdr: string; width: number; height: number }>
    }
    // Bare-specifier resolution through the exports map.
    expect(resolved).toEqual({
      baseSvg: 'function', baseAscii: 'function', baseStyles: 'function',
      agentVerify: 'function', agentSvg: 'function', agentPng: 'function',
      coreVerify: 'function', coreSvg: 'function', corePng: 'undefined',
    })

    const crashParity: unknown[] = []
    const equivalence: unknown[] = []
    expect(results).toHaveLength(inputs.length)
    for (let i = 0; i < inputs.length; i++) {
      const ref = { layout: refLayout(inputs[i]!), svg: refSvg(inputs[i]!), ascii: refTerminalDefault(inputs[i]!) }
      for (const ch of ['layout', 'svg', 'ascii'] as const) {
        if (i < flow.length) {
          expect(ref[ch], `valid source ${ch}: ${inputs[i]}`).not.toBe('THREW')
          expect(results[i]![ch], `installed ${ch}: ${inputs[i]}`).not.toBe('THREW')
        }
        const refThrew = ref[ch] === 'THREW'
        const gotThrew = results[i]![ch] === 'THREW'
        if (refThrew !== gotThrew) crashParity.push({ src: inputs[i], ch, ref: refThrew, got: gotThrew })
        else if (!refThrew && i < fixtureStart + PACKAGE_FAMILY_FIXTURES.length && ref[ch] !== results[i]![ch]) equivalence.push({ src: inputs[i], ch })
      }
    }
    expect(crashParity).toEqual([])
    expect(equivalence).toEqual([])
    BUILTIN_FAMILY_METADATA.forEach((family, index) => {
      const result = results[flow.length + index]!
      expect(result.kind, family.id).toBe(family.id)
      expect(result.layout, family.id).not.toBe('THREW')
      expect(refLayout(family.example), family.id).not.toBe('THREW')
      expect(result.svg, family.id).not.toBe('THREW')
      expect(result.ascii, family.id).not.toBe('THREW')
    })
    PACKAGE_FAMILY_FIXTURES.forEach((fixture, index) => {
      expect(results[fixtureStart + index]!.kind).toBe(fixture.family)
      expect(results[fixtureStart + index]!.svg).not.toBe('THREW')
      expect(results[fixtureStart + index]!.ascii).not.toBe('THREW')
    })
    // This differential protects installed exports, native dependencies and font
    // resources across Node/Bun. Raster quality has independent source keepers.
    expect(pngResults).toHaveLength(pngInputs.length)
    pngInputs.forEach(({ source, options }, index) => {
      const installed = pngResults[index]!
      expect(installed.signature, source).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      expect(installed.ihdr, source).toBe('IHDR')
      expect(installed.width, source).toBeGreaterThan(0)
      expect(installed.height, source).toBeGreaterThan(0)
      const reference = renderMermaidPNG(source, options)
      expect({ sha256: installed.sha256, length: installed.length }, source).toEqual({ sha256: sha(reference), length: reference.length })
    })

    // Bins are linked into node_modules/.bin.
    expect(existsSync(binShimAm)).toBe(true)
    expect(existsSync(binShimMcp)).toBe(true)

    // Apache-2.0-derived Architecture icon paths reach actual recipients with
    // both the attribution and the complete license, not merely files[] intent.
    const notice = readFileSync(join(packageDir, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    const apache = readFileSync(join(packageDir, 'LICENSES', 'Apache-2.0.txt'), 'utf8')
    expect(notice).toContain('LICENSES/Apache-2.0.txt')
    expect(notice).toContain('contains no upstream `NOTICE` file')
    expect(apache).toContain('Apache License\n                           Version 2.0, January 2004')
  }, RUN_TIMEOUT_MS)
})

// ---------------------------------------------------------------------------
// T2 — the `am` bin under Node.
// ---------------------------------------------------------------------------
describe('installed tarball — am bin', () => {
  test('batch --jsonl: one result per line, bad lines never abort, ASCII matches source', () => {
    expect(haveConsumer).toBe(true)
    // Interleave valid ASCII-render ops (differential), other ops, and hostile
    // lines (non-JSON, JSON-but-invalid) to prove the stream never aborts.
    const flow = fc.sample(flowchartArb, 30)
    const lines: string[] = []
    const asciiAt = new Map<number, string>() // line index -> source
    flow.forEach((src) => { asciiAt.set(lines.length, src); lines.push(JSON.stringify({ op: 'render', source: src, options: { format: 'ascii' } })) })
    // Sample sources and ops in ONE draw each — `fc.sample(arb, 1)` inside a loop
    // re-seeds from the pinned global seed every call and returns the same pick.
    const mixedSrcs = fc.sample(mixedArb, 20)
    const mixedOps = fc.sample(fc.constantFrom('render', 'verify', 'parse', 'serialize'), 20)
    mixedSrcs.forEach((src, k) => lines.push(JSON.stringify({ op: mixedOps[k], source: src })))
    for (const bad of ['not json at all', '{"op":123}', '{"nope":1}', '[]', 'null']) lines.push(bad)

    const r = spawnSync(NODE!, [amBin, 'batch', '--jsonl'], { cwd: work, input: lines.join('\n') + '\n', encoding: 'utf8', timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 })
    expect(r.status).toBe(0) // clean exit; a segfault/panic would be 132/139
    const out = r.stdout.split('\n').filter(Boolean)
    expect(out.length).toBe(lines.length) // exactly one result per input line

    const mismatches: unknown[] = []
    out.forEach((line, i) => {
      const res = JSON.parse(line) as { ok: boolean; op?: string; data?: { ascii?: string }; error?: { code?: string } }
      expect(typeof res.ok).toBe('boolean')
      if (!res.ok) expect(typeof res.error?.code).toBe('string')
      if (asciiAt.has(i)) {
        // A valid flowchart ASCII render must SUCCEED and carry `ascii` — assert
        // unconditionally so a regression that drops the field (still ok:true)
        // can't let the differential pass vacuously.
        expect(res.ok).toBe(true)
        expect(typeof res.data?.ascii).toBe('string')
        if (sha(res.data!.ascii!) !== refAscii(asciiAt.get(i)!)) mismatches.push({ i, src: asciiAt.get(i) })
      }
    })
    expect(mismatches).toEqual([])
  }, RUN_TIMEOUT_MS)

  test('Mindmap and GitGraph parse/render identically through the installed CLI', () => {
    expect(haveConsumer).toBe(true)
    for (const fixture of PACKAGE_FAMILY_FIXTURES) {
      const file = join(work, `${fixture.family}.mmd`)
      writeFileSync(file, fixture.source)
      const installedParse = spawnSync(NODE!, [amBin, 'parse', file], {
        cwd: work, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
      })
      const sourceParse = spawnSync('bun', ['run', join(REPO, 'bin/am.ts'), 'parse', file], {
        cwd: REPO, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
      })
      expect({ family: fixture.family, status: installedParse.status, stderr: installedParse.stderr }).toEqual({ family: fixture.family, status: 0, stderr: '' })
      expect(installedParse.stdout).toBe(sourceParse.stdout)
      expect(JSON.parse(installedParse.stdout).body.kind).toBe(fixture.family)

      for (const format of ['svg', 'ascii', 'unicode', 'layout'] as const) {
        const installed = spawnSync(NODE!, [amBin, 'render', file, '--format', format], {
          cwd: work, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
        })
        const source = spawnSync('bun', ['run', join(REPO, 'bin/am.ts'), 'render', file, '--format', format], {
          cwd: REPO, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
        })
        expect({ family: fixture.family, format, status: installed.status }).toEqual({ family: fixture.family, format, status: 0 })
        expect(installed.stdout, `${fixture.family} ${format} package equality`).toBe(source.stdout)
      }
    }
  }, RUN_TIMEOUT_MS)

  test('render across formats + not-found file yield valid exit codes, never a crash', () => {
    expect(haveConsumer).toBe(true)
    const file = join(work, 'd.mmd')
    writeFileSync(file, 'flowchart TD\n  A[Start] --> B{Choice}\n  B -->|yes| C\n  B -->|no| D\n')
    for (const fmt of ['svg', 'ascii', 'unicode', 'layout'] as const) {
      const r = spawnSync(NODE!, [amBin, 'render', file, '--format', fmt], { cwd: work, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 })
      expect(r.status).toBe(0)
      expect(r.stdout.length).toBeGreaterThan(0)
    }
    // A missing file is a clean arg error (exit 2), not a crash.
    const miss = spawnSync(NODE!, [amBin, 'render', join(work, 'nope.mmd')], { cwd: work, encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
    expect(miss.status).toBe(2)
    // capabilities JSON is stable schema.
    const cap = spawnSync(NODE!, [amBin, 'capabilities', '--json'], { cwd: work, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 })
    expect(cap.status).toBe(0)
    expect(Array.isArray(JSON.parse(cap.stdout).families)).toBe(true)
  }, RUN_TIMEOUT_MS)
})

// ---------------------------------------------------------------------------
// T3 — the `agentic-mermaid-mcp` bin under Node (stdio JSON-RPC).
// ---------------------------------------------------------------------------
describe('installed tarball — mcp bin', () => {
  test('default package binary routes the registry mcp argument', () => {
    expect(haveConsumer).toBe(true)
    const r = spawnSync(NODE!, [amBin, 'mcp', '--help'], { cwd: work, encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' })
    expect(r.stdout).toContain('agentic-mermaid-mcp [--transport stdio|http]')
  }, RUN_TIMEOUT_MS)

  test('Mindmap and GitGraph stay structured and source-equal through the installed MCP', () => {
    expect(haveConsumer).toBe(true)
    const requests = PACKAGE_FAMILY_FIXTURES.map((fixture, index) => ({
      jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: {
        name: 'execute', arguments: {
          code: `const source = ${JSON.stringify(fixture.source)}; const parsed = mermaid.parseRegisteredMermaid(source); return { ok: parsed.ok, kind: parsed.ok ? parsed.value.body.kind : null, svg: mermaid.renderMermaidSVG(source), ascii: mermaid.renderMermaidASCII(source) }`,
        },
      },
    }))
    const r = spawnSync(NODE!, [mcpBin], {
      cwd: work, input: requests.map(request => JSON.stringify(request)).join('\n') + '\n',
      encoding: 'utf8', timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
    })
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' })
    const responses = r.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line) as any)
    expect(responses).toHaveLength(PACKAGE_FAMILY_FIXTURES.length)
    PACKAGE_FAMILY_FIXTURES.forEach((fixture, index) => {
      const envelope = JSON.parse(responses[index]!.result.content[0].text)
      expect(envelope.value).toEqual({
        ok: true,
        kind: fixture.family,
        svg: renderMermaidSVG(fixture.source),
        ascii: renderMermaidASCII(fixture.source),
      })
    })
  }, RUN_TIMEOUT_MS)

  test('stdio preserves unsafe numeric JSON-RPC id tokens exactly', () => {
    expect(haveConsumer).toBe(true)
    const ids = ['9007199254740993', '9007199254740993.0', '9.007199254740993e15']
    const input = ids.map(id => `{"jsonrpc":"2.0","id":${id},"method":"ping"}`).join('\n') + '\n'
    const r = spawnSync(NODE!, [mcpBin], {
      cwd: work, input, encoding: 'utf8', timeout: RUN_TIMEOUT_MS,
    })
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' })
    const output = r.stdout.split('\n').filter(Boolean)
    expect(output).toHaveLength(ids.length)
    for (const id of ids) expect(output.some(line => line.includes(`"id":${id}`))).toBe(true)
  }, RUN_TIMEOUT_MS)

  test('generated JSON-RPC over stdio yields well-formed responses and never crashes', () => {
    expect(haveConsumer).toBe(true)
    const codes = fc.sample(codeArb, 18)
    const sources = fc.sample(mixedArb, 8)
    const reqs: Array<{ id: number | null; line: string; expectResponse: boolean }> = []
    let id = 1
    const push = (obj: Record<string, unknown>, expectResponse = true) => {
      reqs.push({ id: id, line: JSON.stringify({ jsonrpc: '2.0', id: id, ...obj }), expectResponse })
      id++
    }
    push({ method: 'initialize', params: {} })
    push({ method: 'tools/list' })
    push({ method: 'ping' })
    push({ method: 'prompts/list' })
    push({ method: 'resources/list' })
    push({ method: 'no/such/method' }) // -> method-not-found error, still a response
    codes.forEach(code => push({ method: 'tools/call', params: { name: 'execute', arguments: { code, timeoutMs: 50 } } }))
    sources.forEach(src => push({ method: 'tools/call', params: { name: 'describe', arguments: { source: src } } }))
    fc.sample(flowchartArb, 4).forEach(src => push({ method: 'tools/call', params: { name: 'render_png', arguments: { source: src, output: 'base64' } } }))
    push({ method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } })

    // Interleave hostile non-JSON lines: each yields a parse-error response
    // (id null) and must not abort the server.
    const inputLines = [reqs[0]!.line, 'not json', reqs[1]!.line, '{unterminated', ...reqs.slice(2).map(r => r.line)]

    const r = spawnSync(NODE!, [mcpBin], { cwd: work, input: inputLines.join('\n') + '\n', encoding: 'utf8', timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 })
    expect(r.status).toBe(0) // server drained stdin and exited cleanly, no panic

    const responses = r.stdout.split('\n').filter(Boolean).map(l => JSON.parse(l) as { jsonrpc: string; id: number | string | null; result?: unknown; error?: { code: number; message: string } })
    for (const resp of responses) {
      expect(resp.jsonrpc).toBe('2.0')
      expect('result' in resp !== 'error' in resp).toBe(true) // exactly one
      if (resp.error) { expect(typeof resp.error.code).toBe('number'); expect(typeof resp.error.message).toBe('string') }
    }
    // Compare the multiset before any indexing can hide duplicate responses.
    // The two malformed input lines must still yield null-id parse errors.
    const expectedIds = [...reqs.filter(rq => rq.expectResponse).map(rq => rq.id), null, null]
    expect(responses.map(response => response.id).sort()).toEqual(expectedIds.sort())
    expect(responses.filter(response => response.id === null).map(response => response.error?.code))
      .toEqual([-32700, -32700])
  }, RUN_TIMEOUT_MS)
})
