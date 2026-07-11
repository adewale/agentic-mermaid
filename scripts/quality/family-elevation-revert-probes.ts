#!/usr/bin/env bun
/**
 * Reproduce the causal red side of the final family-elevation review fixes.
 *
 * The script copies the current checkout to a temporary sandbox, injects one
 * real source fault at a time, and requires the named focused test to fail with
 * the recorded count. The working tree is never modified.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'

interface Probe {
  name: string
  file: string
  find?: string
  replace?: string
  append?: string
  test: string[]
  failures: number
}

const ROOT = resolve(import.meta.dir, '..', '..')
const sandbox = mkdtempSync(join(tmpdir(), 'agentic-mermaid-revert-'))
const excludedTopLevel = new Set([
  '.git', '.impeccable', '.pi-subagents', 'coverage', 'dist', 'node_modules',
  'reports', 'site', 'tmp-style-theme-artifacts',
])

const probes: Probe[] = [
  {
    name: 'State paint resolves an existing nested identity globally',
    file: 'src/agent/state-body.ts',
    find: `  const styledState = (scope: ParseScope, id: string): StateNode => {
    const existing = stateById.get(id)
    if (existing) return existing
    const state = ensureState(scope, id)
    state.declaredBare = true
    stateById.set(id, state)
    return state
  }`,
    replace: `  const styledState = (scope: ParseScope, id: string): StateNode => {
    const state = ensureState(scope, id)
    state.declaredBare = true
    return state
  }`,
    test: ['src/__tests__/state-typed-elevation.test.ts'],
    failures: 1,
  },
  {
    name: 'implicit GitGraph order stays monotone after branch nine',
    file: 'src/gitgraph/parser.ts',
    find: `function implicitBranchOrder(index: number): number {
  return index <= 9 ? index / 10 : 1 - 1 / (index + 1)
}`,
    replace: `function implicitBranchOrder(index: number): number {
  return Number(\`0.\${index}\`)
}`,
    test: ['src/__tests__/mindmap-gitgraph-citizenship.test.ts'],
    failures: 1,
  },
  {
    name: 'known invalid family config values cannot disappear silently',
    file: 'src/shared/family-config-diagnostics.ts',
    find: `export function familyConfigValueDiagnostics(kind: DiagramKind, root: unknown): ConfigDiagnostic[] {
  if (kind === 'state') return [] // state/config.ts owns its richer value diagnostics`,
    replace: `export function familyConfigValueDiagnostics(kind: DiagramKind, root: unknown): ConfigDiagnostic[] {
  return [] // injected fault: silently swallow invalid known values
  if (kind === 'state') return [] // state/config.ts owns its richer value diagnostics`,
    test: ['src/__tests__/unknown-config-wire-or-warn.test.ts'],
    failures: 14,
  },
  {
    name: 'invalid XY reserved-space config is ignored rather than clamped into geometry',
    file: 'src/xychart/config.ts',
    find: `    plotReservedSpacePercent: getBoundedPositiveNumber(
      config.plotReservedSpacePercent,
      DEFAULT_XY_CHART_CONFIG.plotReservedSpacePercent,
      10,
      100,
    ),`,
    replace: `    plotReservedSpacePercent: Math.min(100, Math.max(10,
      getPositiveNumber(config.plotReservedSpacePercent, DEFAULT_XY_CHART_CONFIG.plotReservedSpacePercent),
    )),`,
    test: ['src/__tests__/unknown-config-wire-or-warn.test.ts', '-t', 'xychart: invalid documented values'],
    failures: 1,
  },
  {
    name: 'expanded upstream loop variants remain one-to-one and ordered',
    file: 'eval/mermaid-upstream-suite-bench/mindmap-gitgraph-f3dea583.json',
    find: 'commit id:\\"__proto__\\"\\n        branch __proto__',
    replace: 'commit id:\\"prototype\\"\\n        branch prototype',
    test: ['src/__tests__/mindmap-gitgraph-upstream-oracle.test.ts', '-t', 'binds every classification'],
    failures: 1,
  },
  {
    name: 'pinned upstream provenance rejects changed source bytes',
    file: 'eval/mermaid-upstream-suite-bench/upstream-f3dea583/mindmap.spec.ts',
    append: '\n// injected provenance fault\n',
    test: ['src/__tests__/mindmap-gitgraph-upstream-oracle.test.ts', '-t', 'binds every classification'],
    failures: 1,
  },
  {
    name: 'SVG identity checks exact semantic ids, not only counts',
    file: 'src/renderer.ts',
    find: 'data-id="${escapeAttr(node.id)}" data-label=',
    replace: 'data-id="${escapeAttr(`fault:${node.id}`)}" data-label=',
    test: ['src/__tests__/svg-identity-contract.test.ts', '-t', 'enrolls every registered family'],
    failures: 1,
  },
  {
    name: 'SVG relation checks reject wrong ids with unchanged endpoints',
    file: 'src/renderer.ts',
    find: '    parts.push(renderEdge(edge, style, `edge:${pairKey}#${k}`))',
    replace: '    parts.push(renderEdge(edge, style, `fault:${pairKey}#${k}`))',
    test: ['src/__tests__/svg-identity-contract.test.ts', '-t', 'enrolls every registered family'],
    failures: 1,
  },
  {
    name: 'Mindmap parser cannot accept and then drop empty icons',
    file: 'src/mindmap/parser.ts',
    find: "      if (!icon || !value) throw new MindmapParseError('Mindmap icon decoration must contain a non-empty value without closing parentheses', index + 1)",
    replace: "      if (!icon) throw new MindmapParseError('Mindmap icon decoration must contain a non-empty value without closing parentheses', index + 1)",
    test: ['src/__tests__/mindmap-gitgraph-citizenship.test.ts', '-t', 'rejects empty icon decorations'],
    failures: 1,
  },
  {
    name: 'Mindmap decoration edits cannot change the reparsed tree',
    file: 'src/agent/mindmap-body.ts',
    find: "        if (!stableBodySyntax(next)) return unstableDecorationError('icon', icon.value)",
    replace: '        // injected fault: accept unstable icon syntax',
    test: ['src/__tests__/mindmap-agent-ops.test.ts', '-t', 'icon and class operations'],
    failures: 1,
  },
  {
    name: 'mutable style values cannot inject line-oriented statements',
    file: 'src/shared/style-props.ts',
    find: "  if (/[\\r\\n]/.test(source)) return { ok: false, reason: 'MULTILINE' }",
    replace: "  if (false) return { ok: false, reason: 'MULTILINE' } // injected fault",
    test: [
      'src/__tests__/flowchart-op-menu.test.ts',
      'src/__tests__/state-typed-elevation.test.ts',
      'src/__tests__/class-residual-elevation.test.ts',
      'src/__tests__/er-typed-segments.test.ts',
      '-t', 'paint mutations reject',
    ],
    failures: 4,
  },
  {
    name: 'targetWidth contraction cannot discard distinctive content',
    file: 'src/ascii/index.ts',
    find: `  const boundedOutput = output.split('\\n').map(line => line.trimEnd()).join('\\n').trimEnd()`,
    replace: `  const boundedOutput = output.replace(/descriptive/gi, '').split('\\n').map(line => line.trimEnd()).join('\\n').trimEnd()`,
    test: ['src/__tests__/ascii-target-width.test.ts', '-t', 'every registered family shrinks'],
    failures: 1,
  },
  {
    name: 'ER label-less relationships remain visible',
    file: 'src/er/parser.ts',
    find: `  const regex = new RegExp(\`^(\${ER_ENTITY_REFERENCE_SOURCE})\\\\s+([|o}{]+)(--|\\\\.\\\\.)([|o}{]+)\\\\s+(\${ER_ENTITY_REFERENCE_SOURCE})(?:\\\\s*:\\\\s*(.*))?$\`)`,
    replace: `  const regex = new RegExp(\`^(\${ER_ENTITY_REFERENCE_SOURCE})\\\\s+([|o}{]+)(--|\\\\.\\\\.)([|o}{]+)\\\\s+(\${ER_ENTITY_REFERENCE_SOURCE})\\\\s*:\\\\s*(.+)$\`)`,
    test: ['src/__tests__/er-parser.test.ts', '-t', 'label-less relationships parse and render visibly'],
    failures: 1,
  },
  {
    name: 'XYChart raster output honors authored backgroundColor',
    file: 'src/agent/png.ts',
    find: `    background: opts.background ?? familyBackground ?? 'white',`,
    replace: `    background: opts.background ?? 'white', // injected fault: drop family background`,
    test: ['src/__tests__/xychart-renderer.test.ts', '-t', 'carries the authored background'],
    failures: 1,
  },
  {
    name: 'Quadrant axis labels remain inside measured half-plot budgets',
    file: 'src/quadrant/layout.ts',
    find: `      near: budgetAxisLabel(chart.xAxis.near, halfBudget, axisFontX, style.edgeLabelFontWeight),`,
    replace: `      near: chart.xAxis.near, // injected fault: bypass half-plot budget`,
    test: ['src/__tests__/quadrant.test.ts', '-t', 'long axis labels wrap within their half-plot budgets'],
    failures: 1,
  },
  {
    name: 'Mindmap reserved-prefix whitespace cannot change node meaning on serialization',
    file: 'src/mindmap/parser.ts',
    find: `    if (/^::icon\\b/i.test(trimmed)) {`,
    replace: `    if (/^::icon\\(/i.test(trimmed)) { // injected fault: allow reserved-prefix whitespace as a node`,
    test: ['src/__tests__/mindmap-gitgraph-doc-parity.test.ts', '-t', 'reserved decorations'],
    failures: 1,
  },
  {
    name: 'GitGraph cherry-pick rejects commits already reachable through inherited history',
    file: 'src/gitgraph/parser.ts',
    find: `      if (reachableFrom(current.head, source.id, commitById)) throw new GitGraphParseError(\`Cherry-pick source '\${source.id}' is already reachable from current branch '\${currentBranch}'.\`, index + 1)`,
    replace: `      if (source.branch === currentBranch) throw new GitGraphParseError(\`Cherry-pick source '\${source.id}' is already on current branch '\${currentBranch}'.\`, index + 1)`,
    test: ['src/__tests__/mindmap-gitgraph-doc-parity.test.ts', '-t', 'already reachable'],
    failures: 1,
  },
  {
    name: 'GitGraph layout cannot emit duplicate coincident parent relations',
    file: 'src/gitgraph/layout.ts',
    find: `    for (const [index, parentId] of [...new Set(commit.parents)].entries()) {`,
    replace: `    for (const [index, parentId] of commit.parents.entries()) { // injected fault: duplicate parents`,
    test: ['src/__tests__/mindmap-gitgraph-doc-parity.test.ts', '-t', 'one semantic parent relation'],
    failures: 1,
  },
  {
    name: 'Delimiter-bearing relation endpoints retain injective semantic IDs',
    file: 'src/scene/identity.ts',
    find: `  const body = readableIdentityAtom(from) && readableIdentityAtom(to)
    ? \`\${from}->\${to}\`
    : \`relation:\${JSON.stringify([from, to])}\``,
    replace: `  const body = \`\${from}->\${to}\` // injected fault: delimiter-ambiguous identity`,
    test: ['src/__tests__/mindmap-gitgraph-doc-parity.test.ts', '-t', 'relation identities remain injective'],
    failures: 1,
  },
  {
    name: 'State concurrency separators remain continuous between region boxes',
    file: 'src/ascii/draw.ts',
    find: `        for (let y = top; y <= bottom; y++) canvas[x]![y] = graph.config.useAscii ? ':' : '┆'`,
    replace: `        for (let y = top; y <= bottom; y++) void y // injected fault: omit separator`,
    test: ['src/__tests__/state-ascii-elevation.test.ts', '-t', 'one continuous concurrency separator'],
    failures: 1,
  },
  {
    name: 'ER shortcut routing cannot overwrite a foreign entity rectangle',
    file: 'src/ascii/er-diagram.ts',
    find: `      const detourY = blockers.length > 0
        ? Math.max(left.y + left.height - 1, right.y + right.height - 1, ...blockers.map(item => item.y + item.height - 1)) + 2
        : lineY`,
    replace: `      const detourY = lineY // injected fault: tunnel directly through foreign boxes`,
    test: ['src/__tests__/er-ascii-clearance.test.ts', '-t', 'routes a non-adjacent'],
    failures: 1,
  },
]

function copyCheckout(): void {
  cpSync(ROOT, sandbox, {
    recursive: true,
    filter(source) {
      const rel = relative(ROOT, source)
      if (!rel) return true
      const normalized = rel.split(sep).join('/')
      if (normalized === 'website/public' || normalized.startsWith('website/public/')) return false
      return !excludedTopLevel.has(normalized.split('/')[0]!)
    },
  })
  symlinkSync(join(ROOT, 'node_modules'), join(sandbox, 'node_modules'), 'dir')
}

function failureCount(output: string): number | undefined {
  const matches = [...output.matchAll(/^\s*(\d+) fail\s*$/gm)]
  return matches.length > 0 ? Number(matches.at(-1)![1]) : undefined
}

function runProbe(probe: Probe): void {
  const path = join(sandbox, probe.file)
  const original = readFileSync(path, 'utf8')
  let faulted = original
  if (probe.find !== undefined) {
    const occurrences = original.split(probe.find).length - 1
    if (occurrences !== 1) throw new Error(`${probe.name}: expected one replacement site in ${probe.file}, found ${occurrences}`)
    faulted = original.replace(probe.find, probe.replace ?? '')
  }
  if (probe.append !== undefined) faulted += probe.append
  writeFileSync(path, faulted)

  try {
    const result = Bun.spawnSync(['bun', 'test', ...probe.test], {
      cwd: sandbox,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const output = `${result.stdout.toString()}\n${result.stderr.toString()}`
    const actual = failureCount(output)
    if (result.exitCode === 0 || actual !== probe.failures) {
      throw new Error(`${probe.name}: expected ${probe.failures} failing test(s), exit=${result.exitCode}, observed=${String(actual)}\n${output.slice(-4000)}`)
    }
    console.log(`RED ${probe.failures.toString().padStart(2)}  ${probe.name}`)
  } finally {
    writeFileSync(path, original)
  }
}

try {
  copyCheckout()
  for (const probe of probes) runProbe(probe)
  console.log(`\n${probes.length} revert probes produced the expected causal failures; sandbox sources were restored after every probe.`)
} finally {
  if (process.env.KEEP_REVERT_PROBE_SANDBOX === '1') console.log(`Sandbox retained at ${sandbox}`)
  else rmSync(sandbox, { recursive: true, force: true })
}
