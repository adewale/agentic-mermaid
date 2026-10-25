// ============================================================================
// Wrapper fidelity (1C) + in-body comment policy (2C).
//
// 1C: the leading source wrapper — frontmatter block, %%{init}%% directives,
// %% comments before the header, blank lines — round-trips byte-verbatim
// through parse → serialize and through mutation. Canonical wrapper synthesis
// (Mermaid's documented config-nested shape) is opt-in.
//
// 2C: Structured families retain parser-identified body comments. Statements
// with stable identities keep anchors; otherwise the comment follows the body.
// Opaque bodies and preserved opaque segments keep comments and never warn.
//
// Each round-trip test also asserts the PREVIOUS bug shape is gone (flattened
// top-level frontmatter keys, synthesized duplicate frontmatter above a kept
// directive), so reverting the fix fails these tests.
// ============================================================================

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  parseRegisteredMermaid as parseMermaid, synthesizeFromGraph, serializeMermaid, verifyMermaid, mutate, asFlowchart, renderMermaidSVG,
} from '../agent/index.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import { useTestChildren } from './helpers/test-child.ts'
import { applyMutationBatch } from '../agent/mutate.ts'

const runChild = useTestChildren(20_000)

const FM_NESTED = '---\nconfig:\n  layout: elk\n  look: handDrawn\n---\nflowchart TD\n  A --> B'
const FM_DAGRE = '---\nconfig:\n  layout: dagre\n---\nflowchart TD\n  A --> B'
const INIT_ONLY = '%%{init: {"flowchart": {"curve": "basis"}}}%%\nflowchart TD\n  A --> B'
const LEAD_COMMENT = '%% keep: reviewed by security 2026-06\nflowchart TD\n  A --> B'
const COMBO = '---\ntitle: My flow\nconfig:\n  layout: elk\n---\n%%{init: {"theme": "dark"}}%%\n%% wrapper note\nflowchart TD\n  A --> B'
const MULTILINE_INIT = '%%{\n  init: {\n    "theme": "dark"\n  }\n}%%\nflowchart TD\n  A --> B'

function roundTrip(src: string): string {
  const p = parseMermaid(src)
  expect(p.ok).toBe(true)
  if (!p.ok) throw new Error('parse failed')
  return serializeMermaid(p.value)
}

describe('wrapper fidelity (1C): verbatim round-trip by default', () => {
  test('config-nested frontmatter round-trips byte-identical (no flattening)', () => {
    const out = roundTrip(FM_NESTED)
    expect(out).toBe(FM_NESTED + '\n')
    // The old bug hoisted config keys to the top level, which Mermaid ignores.
    expect(out).not.toContain('\nlayout: elk')
    expect(out).toContain('config:\n  layout: elk')
  })

  test('a layout: dagre request survives round-trip even though this engine is ELK-only', () => {
    expect(roundTrip(FM_DAGRE)).toBe(FM_DAGRE + '\n')
  })

  test('an init directive round-trips verbatim without a synthesized duplicate frontmatter block', () => {
    const out = roundTrip(INIT_ONLY)
    expect(out).toBe(INIT_ONLY + '\n')
    expect(out.startsWith('---')).toBe(false)  // old bug: lifted config into frontmatter AND kept the directive
  })

  test('a multiline init directive round-trips verbatim', () => {
    expect(roundTrip(MULTILINE_INIT)).toBe(MULTILINE_INIT + '\n')
  })

  test('comments before the header round-trip verbatim', () => {
    expect(roundTrip(LEAD_COMMENT)).toBe(LEAD_COMMENT + '\n')
  })

  test('frontmatter + directive + wrapper comment round-trip together, serialize-idempotently', () => {
    const out = roundTrip(COMBO)
    expect(out).toBe(COMBO + '\n')
    expect(roundTrip(out)).toBe(out)
  })

  test('mutation keeps the wrapper byte-verbatim and only changes the body', () => {
    const p = parseMermaid(COMBO)
    if (!p.ok) throw new Error('parse failed')
    const flow = asFlowchart(p.value)
    expect(flow).not.toBeNull()
    const next = mutate(flow!, { kind: 'add_node', id: 'C', label: 'Cache' })
    expect(next.ok).toBe(true)
    if (!next.ok) return
    const wrapper = COMBO.slice(0, COMBO.indexOf('flowchart TD'))
    expect(next.value.canonicalSource.startsWith(wrapper)).toBe(true)
    expect(next.value.canonicalSource).toContain('C[Cache]')
  })

  test('diagrams with no wrapper are unchanged', () => {
    expect(roundTrip('flowchart TD\n  A --> B')).toBe('flowchart TD\n  A --> B\n')
  })

  test('a standalone BOM is retained as an exact wrapper', () => {
    const source = '\uFEFFflowchart TD\n  A --> B'
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.meta.wrapperSource).toBe('\uFEFF')
    expect(serializeMermaid(parsed.value)).toBe(source + '\n')
  })

  test('structured serialization retains init directives authored after the header', () => {
    const source = 'flowchart LR\n  A\n  %%{initialize: {"theme": "dark"}}%%\n  B'
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const serialized = serializeMermaid(parsed.value)
    expect(serialized.match(/%%\{initialize:/g)).toHaveLength(1)
    expect(serialized).toStartWith('  %%{initialize: {"theme": "dark"}}%%\nflowchart LR\n')
    const reparsed = parseMermaid(serialized)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.value.meta.frontmatter?.theme).toBe('dark')
    expect(serializeMermaid(reparsed.value)).toBe(serialized)
  })

  // Mermaid applies an init or wrap directive inside a statement too, and
  // reads the statement without it: ours does, and writes the directive
  // before the header.
  const DARK = '%%{init: {"theme": "dark"}}%%'
  test.each([
    ['classDiagram\n  class A\n  A : +x %%{init: {"theme": "dark"}}%%', 'A : +x', DARK, { theme: 'dark' }],
    ['stateDiagram-v2\n  A --> B : go %%{init: {"theme": "dark"}}%%', 'A --> B : go', DARK, { theme: 'dark' }],
    ['pie\n  "a" : 1 %%{init: {"theme": "dark"}}%%', '"a" : 1', DARK, { theme: 'dark' }],
    ['stateDiagram-v2\n  A --> B : go %%{wrap}%%', 'A --> B : go', '%%{wrap}%%', { wrap: true }],
    ['mindmap\n  root\n    child %%{wrap}%%', 'child', '%%{wrap}%%', { wrap: true }],
  ])('a directive inside a statement is applied, and written before the header: %j', async (source, statement, directive, config) => {
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).not.toBe('opaque')
    expect(parsed.value.canonicalSource.split('\n')).toContain(statement)
    expect(parsed.value.meta.initDirectives.map(directive => directive.parsed)).toEqual([config])
    const serialized = serializeMermaid(parsed.value)
    expect(serialized).toStartWith(`${directive}\n`)
    expect(serialized.split(directive)).toHaveLength(2)
    expect(verifyMermaid(source).warnings.map(warning => warning.code)).not.toContain('COMMENT_DROPPED')
    const reparsed = parseMermaid(serialized)
    if (!reparsed.ok) throw new Error(JSON.stringify(reparsed.error))
    expect(reparsed.value.body).toEqual(parsed.value.body)
    expect(serializeMermaid(reparsed.value)).toBe(serialized)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
      expect(await upstream.accepts(serialized)).toBe(true)
    } finally { upstream.close() }
  })

  test('a directive that configures nothing is removed, as Mermaid removes it, and is not a dropped comment', () => {
    const source = 'stateDiagram-v2\n  A --> B : go %%{config: {"theme": "dark"}}%%'
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.canonicalSource).toBe('stateDiagram-v2\nA --> B : go')
    expect(parsed.value.meta.initDirectives).toEqual([])
    expect(serializeMermaid(parsed.value)).toBe('stateDiagram-v2\n  A --> B : go\n')
    expect(verifyMermaid(source).warnings).toEqual([])
  })

  test('post-header init removal preserves indentation-sensitive family structure', () => {
    const source = `mindmap
  root
    child
    %%{init:{"theme":"dark"}}%%
      grandchild`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.body.kind).toBe('mindmap')
    const serialized = serializeMermaid(parsed.value)
    expect(serialized.match(/%%\{init:/g)).toHaveLength(1)
    const reparsed = parseMermaid(serialized)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.value.body.kind).toBe('mindmap')
    expect(serializeMermaid(reparsed.value)).toBe(serialized)
  })

  test('mutation retains init directives authored after the header', () => {
    const source = 'flowchart LR\n  A\n  %%{init: {"theme": "dark"}}%%\n  B'
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const flow = asFlowchart(parsed.value)
    expect(flow).not.toBeNull()
    const next = mutate(flow!, { kind: 'add_node', id: 'C', label: 'Cache' })
    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.value.canonicalSource.match(/%%\{init:/g)).toHaveLength(1)
    expect(next.value.canonicalSource).toStartWith('  %%{init: {"theme": "dark"}}%%\nflowchart LR\n')
    expect(next.value.meta.frontmatter?.theme).toBe('dark')
    expect(next.value.meta.wrapperSource).toBe('  %%{init: {"theme": "dark"}}%%\n')
    const wrapperSpan = next.value.source.spans?.preserved.wrapper
    expect(wrapperSpan).toBeDefined()
    if (wrapperSpan) {
      expect(next.value.canonicalSource.slice(wrapperSpan.start.offset, wrapperSpan.end.offset))
        .toBe(next.value.meta.wrapperSource ?? '')
    }
  })
})

describe('wrapper fidelity (1C): a parsed or edited diagram renders under its wrapper', () => {
  test('a parsed diagram draws what its source draws, config wrapper included', () => {
    for (const source of [
      COMBO,
      '%%{init: {"flowchart": {"rankSpacing": 300}}}%%\nflowchart LR\n  A --> B',
      '---\nconfig:\n  theme: forest\n---\nclassDiagram\n  class A',
      '%%{init: {"theme": "dark"}}%%\narchitecture-beta\n  service a(server)[A]',
      'flowchart LR\n%%{init: {"theme": "dark"}}%%\n  A --> B',
    ]) {
      const p = parseMermaid(source)
      if (!p.ok) throw new Error(`parse failed: ${source}`)
      expect({ source, same: renderMermaidSVG(p.value) === renderMermaidSVG(source) }).toEqual({ source, same: true })
    }
  })

  test('an edited diagram draws what its saved source draws', () => {
    // A regression guard: an edited body already carries its wrapper, which
    // the render source must not add twice.
    const p = parseMermaid(COMBO)
    if (!p.ok) throw new Error('parse failed')
    const next = mutate(asFlowchart(p.value)!, { kind: 'add_node', id: 'C', label: 'Cache' })
    if (!next.ok) throw new Error('mutation failed')
    expect(renderMermaidSVG(next.value)).toBe(renderMermaidSVG(serializeMermaid(next.value)))
  })

  test('verify refuses a parsed diagram whose wrapper render refuses', () => {
    const styled = parseMermaid('%%{init: {"themeCSS": ".node rect { fill: red }"}}%%\nflowchart LR\n  A --> B')
    if (!styled.ok) throw new Error('parse failed')
    expect(() => renderMermaidSVG(styled.value)).toThrow(/themeCSS/)
    expect(verifyMermaid(styled.value).warnings.map(w => w.code)).toContain('RENDER_FAILED')
  })
})

describe('wrapper fidelity (1C): canonical synthesis on demand', () => {
  test('canonical mode nests config keys under config: with title top-level, directives folded', () => {
    const p = parseMermaid(COMBO)
    if (!p.ok) throw new Error('parse failed')
    const out = serializeMermaid(p.value, { wrapper: 'canonical' })
    expect(out).toBe('---\ntitle: My flow\nconfig:\n  layout: elk\n  theme: dark\n---\nflowchart TD\n  A --> B\n')
    expect(out).not.toContain('%%{init')  // folded, not duplicated
  })

  test('an unparsed directive remains repairable source and cannot masquerade as canonical output', () => {
    // A scalar is not a config map, so it cannot be folded into frontmatter.
    const src = '%%{init: definitely-not-an-object}%%\nflowchart TD\n  A --> B'
    const p = parseMermaid(src)
    if (!p.ok) throw new Error('parse failed')
    expect(serializeMermaid(p.value)).toContain('%%{init: definitely-not-an-object}%%')
    expect(() => serializeMermaid(p.value, { wrapper: 'canonical' })).toThrow('init directive payload must be a configuration object')
    expect(verifyMermaid(p.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'mermaid_wrapper_config' }))
  })

  test('canonical mode folds post-header config out of an opaque body exactly once', () => {
    const src = `sequenceDiagram
  %%{init: {"theme": "dark"}}%%
  Alice->>Bob: hi
  end`
    const parsed = parseMermaid(src)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.body.kind).toBe('opaque')
    const canonical = serializeMermaid(parsed.value, { wrapper: 'canonical' })
    expect(canonical).toContain('config:\n  theme: dark\n')
    expect(canonical).not.toContain('%%{init:')
    const reparsed = parseMermaid(canonical)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(reparsed.value, { wrapper: 'canonical' })).toBe(canonical)
  })

  test.each([
    {
      name: 'a fully shadowed scalar',
      source: '%%{init: {"theme":"forest"}}%%\nflowchart TD\n%%{init: {"theme":"dark"}}%%\n  A --> B',
    },
    {
      name: 'a partially shadowed top-level map',
      source: '%%{init: {"theme":"forest","logLevel":"debug"}}%%\nflowchart TD\n%%{init: {"theme":"dark"}}%%\n  A --> B',
    },
    {
      name: 'a partially shadowed nested map',
      source: '%%{init: {"flowchart":{"curve":"linear","htmlLabels":true}}}%%\n%%{init: {"flowchart":{"curve":"basis"}}}%%\nflowchart TD\n  A --> B',
    },
    {
      name: 'an object replaced by null',
      source: '%%{init: {"flowchart":{"curve":"basis"}}}%%\n%%{init: {"flowchart":null}}%%\nflowchart TD\n  A --> B',
    },
  ])('canonical mode preserves effective config for $name', ({ source }) => {
    // Parsed frontmatter already represents the final directive merge. Folding
    // parseable directives again in authored order must retain that exact
    // semantic result without re-emitting any stale raw values.
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const canonical = serializeMermaid(parsed.value, { wrapper: 'canonical' })
    expect(canonical).not.toContain('%%{init')
    const reparsed = parseMermaid(canonical)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.value.meta.frontmatter).toEqual(parsed.value.meta.frontmatter)
    expect(serializeMermaid(reparsed.value, { wrapper: 'canonical' })).toBe(canonical)
  })

  test.each([{ value: 'reset' }, { value: [] }])('canonical themeVariables must be an object, preserving $value for repair', ({ value }) => {
    const source = `%%{init: {"themeVariables":{"primaryColor":"red"}}}%%\n%%{init: ${JSON.stringify({ themeVariables: value })}}%%\nflowchart TD\n  A --> B`
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error('parse failed')
    expect(serializeMermaid(parsed.value)).toBe(source + '\n')
    expect(() => serializeMermaid(parsed.value, { wrapper: 'canonical' })).toThrow('themeVariables must be a configuration object')
    expect<unknown>(parsed.value.meta.frontmatter?.themeVariables).toEqual(value)
  })

  test('canonical wrapper color admission respects exact keys, sanitization and actual derivation', async () => {
    const upstream = startUpstreamMermaid()
    const controls = [
      { theme: 'base', themeVariables: { PrimaryColor: 'var(--brand)', PRIMARYCOLOR: 'none' } },
      { theme: 'base', themeVariables: { cScale0: 'var(--brand)', git0: 'red!important' } },
      { theme: 'base', themeVariables: { cScale0: '', git0: null } },
      { theme: 'base', themeVariables: { THEME_COLOR_LIMIT: 0, cScale0: 'currentColor' } },
      { theme: 'default', themeVariables: { background: 'currentColor' } },
      { theme: 'dark', themeVariables: { git0: 'currentColor', noteBkgColor: 'var(--brand)' } },
      { theme: 'base', themeVariables: { background: 'currentColor', lineColor: 'red', arrowheadColor: 'blue', noteBkgColor: 'currentColor', noteBorderColor: 'red' } },
    ]
    try {
      for (const config of controls) {
        const source = `%%{init: ${JSON.stringify(config)}}%%\nflowchart LR\nA --> B`
        expect(await upstream.accepts(source)).toBe(true)
        const parsed = parseMermaid(source)
        if (!parsed.ok) throw new Error('parse failed')
        const canonical = serializeMermaid(parsed.value, { wrapper: 'canonical' })
        expect(await upstream.accepts(canonical)).toBe(true)
        const reloaded = parseMermaid(canonical)
        if (!reloaded.ok) throw new Error('parse failed')
        // Canonical output retains authored values. The pinned runtime owns
        // dropping unknown keys and neutralizing disallowed directive values.
        expect(reloaded.value.meta.frontmatter).toEqual(config)
        expect(serializeMermaid(parsed.value)).toContain(JSON.stringify(config))
      }
      for (const themeVariables of [{ git0: '##374151' }, { cScale1: '#12345' }, { primaryColor: 'var(--brand)' }]) {
        const source = `%%{init: ${JSON.stringify({ theme: 'base', themeVariables })}}%%\nflowchart LR\nA --> B`
        expect(await upstream.accepts(source)).toBe(false)
        expect(await upstream.accepts('flowchart LR\nControl --> Next')).toBe(true)
        const parsed = parseMermaid(source)
        if (!parsed.ok) throw new Error('parse failed')
        expect(() => serializeMermaid(parsed.value, { wrapper: 'canonical' })).toThrow('must be a concrete CSS color')
        expect(serializeMermaid(parsed.value)).toContain(JSON.stringify(themeVariables).slice(1, -1))
      }
    } finally { upstream.close() }
  })

  test('canonical palette admission follows implicit, scoped and global theme derivations', async () => {
    const upstream = startUpstreamMermaid()
    const controls = [
      { diagram: 'pie\n"a": 1', config: { themeVariables: { git0: 'notacolor' } } },
      { config: { flowchart: { theme: 'default' }, themeVariables: { git0: 'notacolor' } } },
      { config: { flowchart: { theme: 'dark' }, themeVariables: { git0: 'notacolor' } } },
      { config: { themeVariables: { background: 'currentColor', lineColor: 'red', arrowheadColor: 'blue', rectBkgColor: 'green' } } },
      { config: { themeVariables: { cScale2: 'currentColor', cScaleInv2: 'red', cScalePeer2: 'blue' } } },
      { config: { themeVariables: { primaryColor: 'currentColor', secondaryColor: 'red' } } },
      { config: { themeVariables: { noteBkgColor: 'currentColor' } } },
      { config: { themeVariables: { cScale2: 'var(--brand)' } } },
      { config: { theme: 'null', themeVariables: { primaryColor: 'currentColor' } } },
    ]
    const rejected = [
      { config: { themeVariables: { git0: 'notacolor' } } },
      { config: { themeVariables: { cScale2: 'notacolor' } } },
      { config: { themeVariables: { primaryColor: 'notacolor' } } },
      { config: { themeVariables: { background: 'notacolor' } } },
      { diagram: 'sequenceDiagram\nA->>B: hello', config: { themeVariables: { git0: 'notacolor' } } },
      // The scoped theme wins during parsing, but the global theme is derived
      // when public parse clears the diagram scope in its finally block.
      { config: { theme: 'base', flowchart: { theme: 'default' }, themeVariables: { background: 'currentColor' } } },
    ]
    try {
      for (const { config, diagram = 'flowchart TD\nA --> B' } of controls) {
        const source = `%%{init: ${JSON.stringify(config)}}%%\n${diagram}`
        expect(await upstream.publicAccepts(source), source).toBe(true)
        const parsed = parseMermaid(source)
        if (!parsed.ok) throw new Error('Expected preserved wrapper')
        const written = serializeMermaid(parsed.value, { wrapper: 'canonical' })
        expect(await upstream.publicAccepts(written), written).toBe(true)
        const reloaded = parseMermaid(written)
        if (!reloaded.ok) throw new Error('Expected canonical wrapper reload')
        expect(reloaded.value.meta.frontmatter).toEqual(config)
      }
      for (const { config, diagram = 'flowchart TD\nA --> B' } of rejected) {
        const source = `%%{init: ${JSON.stringify(config)}}%%\n${diagram}`
        expect(await upstream.publicAccepts(source), source).toBe(false)
        expect(await upstream.publicAccepts('flowchart LR\nControl --> Next')).toBe(true)
        const parsed = parseMermaid(source)
        if (!parsed.ok) throw new Error('Expected repairable wrapper source')
        expect(serializeMermaid(parsed.value)).toStartWith(source.slice(0, source.indexOf('\n') + 1))
        expect(() => serializeMermaid(parsed.value, { wrapper: 'canonical' })).toThrow('must be a concrete CSS color')
      }
    } finally { upstream.close() }
  })
  test('canonical mode keeps a directive no later directive shadows', () => {
    const parsed = parseMermaid(
      '%%{init: {"logLevel":"debug"}}%%\nflowchart TD\n%%{init: {"theme":"dark"}}%%\n  A --> B',
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const canonical = serializeMermaid(parsed.value, { wrapper: 'canonical' })
    expect(canonical).toContain('logLevel: debug')
    expect(canonical).toContain('theme: dark')
  })

  test('am format defaults to verbatim; --canonical-wrapper opts into synthesis', async () => {
    const run = (args: string[]) => runChild('bun', [join(import.meta.dir, '..', '..', 'bin', 'am.ts'), 'format', '-', ...args], { input: COMBO })
    const verbatim = await run([])
    expect(verbatim.status).toBe(0)
    expect(verbatim.stdout).toBe(COMBO + '\n')
    const canonical = await run(['--canonical-wrapper'])
    expect(canonical.status).toBe(0)
    expect(canonical.stdout.startsWith('---\ntitle: My flow\nconfig:\n')).toBe(true)
    expect(canonical.stdout).not.toContain('%%{init')
  })
})

describe('body comment preservation', () => {
  test('in-body Flowchart comments survive serialization without a loss warning', () => {
    const src = 'flowchart TD\n  %% do not reorder\n  A --> B\n  %% another note\n  B --> C'
    const p = parseMermaid(src)
    if (!p.ok) throw new Error('parse failed')
    const v = verifyMermaid(p.value)
    expect(v.ok).toBe(true)  // lint never flips ok
    const w = v.warnings.find(x => x.code === 'COMMENT_DROPPED')
    expect(w).toBeUndefined()
    expect(serializeMermaid(p.value)).toContain('%% do not reorder')
    expect(serializeMermaid(p.value)).toContain('%% another note')
  })

  test('mutation retains the original comment text', () => {
    const parsed = parseMermaid('flowchart LR\n  %% keep context\n  A --> B')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const flow = asFlowchart(parsed.value)
    expect(flow).not.toBeNull()
    const next = mutate(flow!, { kind: 'add_node', id: 'C', label: 'Cache' })
    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.value.meta.droppedComments).toBeUndefined()
    expect(serializeMermaid(next.value)).toContain('%% keep context')
  })

  test('wrapper comments do not raise COMMENT_DROPPED (they are preserved verbatim)', () => {
    const p = parseMermaid(LEAD_COMMENT)
    if (!p.ok) throw new Error('parse failed')
    expect(verifyMermaid(p.value).warnings.filter(w => w.code === 'COMMENT_DROPPED')).toEqual([])
  })

  test('duplicate comments retain their occurrence counts across wrapper and body', () => {
    const src = '%% same\nflowchart TD\n  %% same\n  A --> B'
    const p = parseMermaid(src)
    if (!p.ok) throw new Error('parse failed')
    expect(serializeMermaid(p.value).match(/%% same/g)).toHaveLength(2)
    const w = verifyMermaid(p.value).warnings.find(w => w.code === 'COMMENT_DROPPED')
    expect(w).toBeUndefined()
  })

  test('Sequence comments remain preserved both before and inside opaque blocks', () => {
    const src = `sequenceDiagram
  %% same
  A->>B: hi
  alt ok
    %% same
    B->>A: ok
  end`
    const p = parseMermaid(src)
    if (!p.ok) throw new Error('parse failed')
    expect(serializeMermaid(p.value).split('%% same')).toHaveLength(3)
    expect(verifyMermaid(p.value).warnings.filter(w => w.code === 'COMMENT_DROPPED')).toEqual([])
  })

  test('opaque bodies preserve in-body comments and do not warn', () => {
    // A stray `end` makes the sequence un-segmentable → whole-opaque fallback.
    const src = 'sequenceDiagram\n  %% opaque-preserved note\n  Alice->>Bob: hi\n  end'
    const p = parseMermaid(src)
    if (!p.ok) throw new Error('parse failed')
    expect(serializeMermaid(p.value)).toContain('%% opaque-preserved note')
    expect(verifyMermaid(p.value).warnings.filter(w => w.code === 'COMMENT_DROPPED')).toEqual([])
  })
})


test('structured edits retain repeated body comments and rationale', () => {
  for (const source of [
    'flowchart TD\n  %% keep this reason\n  A --> B\n  %% endpoint rationale\n  %% keep this reason\n  B --> C',
    'stateDiagram-v2\n  %% keep this reason\n  A --> B: start %% endpoint rationale\n  %% keep this reason\n  B --> C: done',
  ]) {
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error('parse failed')
    const out = serializeMermaid(parsed.value)
    expect(out.match(/%% keep this reason/g)).toHaveLength(2)
    expect(out).toContain('%% endpoint rationale')
    const edited = parsed.value.kind === 'flowchart' ? mutate(parsed.value, { kind: 'add_node', id: 'D', label: 'Extra' }) : mutate(parsed.value, { kind: 'add_state', id: 'D' })
    if (parsed.value.kind === 'flowchart') {
      if (!edited.ok) throw new Error(edited.error.message)
      expect(serializeMermaid(edited.value)).toContain('%% endpoint rationale')
    }
    const reloaded = parseMermaid(out)
    if (!reloaded.ok) throw new Error('reload failed')
    expect(serializeMermaid(reloaded.value)).toBe(out)
  }
})


test('comment anchors survive renaming and JSON transport; metadata cannot introduce statements', () => {
  const parsed = parseMermaid('flowchart LR\n %% name rationale\n A[Before]\n B[Other]')
  if (!parsed.ok) throw new Error('parse failed')
  const renamed = mutate(parsed.value, { kind: 'rename_node', from: 'A', to: 'Renamed' })
  if (!renamed.ok) throw new Error(renamed.error.message)
  const source = serializeMermaid(renamed.value)
  expect(source.indexOf('%% name rationale')).toBeLessThan(source.indexOf('Renamed['))
  const payload = JSON.parse(JSON.stringify(renamed.value, (_key, value) => value instanceof Map ? Object.fromEntries(value) : value))
  const restored = synthesizeFromGraph(payload)
  if (!restored.ok) throw new Error('JSON reload failed')
  expect(serializeMermaid(restored.value)).toContain('%% name rationale')
  payload.meta.bodyComments[0].raw = 'Injected --> Other'
  expect(synthesizeFromGraph(payload).ok).toBe(false)
})

test('batch edge removal and rename keep comments on the surviving occurrence', () => {
  const wrapper = '---\ntitle: Kept wrapper\n---\n%% wrapper rationale\n'
  const parsed = parseMermaid(wrapper + 'flowchart LR\n %% removed rationale\n A -->|first| B\n %% surviving rationale\n A -->|second| B')
  if (!parsed.ok) throw Error('Expected Flowchart')
  const before = serializeMermaid(parsed.value)
  const result = applyMutationBatch(parsed.value, [
    { kind: 'set_label', target: 'A', label: 'Updated' },
    { kind: 'remove_edge', id: 'A->B#0' },
    { kind: 'rename_node', from: 'A', to: 'Renamed' },
    { kind: 'add_edge', from: 'A', to: 'B', label: 'replacement' },
  ])
  if (!result.ok) throw Error(result.error.message)
  const source = serializeMermaid(result.value)
  expect(source).toStartWith(wrapper)
  expect(source).toMatch(/%% surviving rationale\n\s*Renamed\[Updated\] -->\|second\| B/)
  expect(source.trimEnd()).toEndWith('%% removed rationale')
  expect(serializeMermaid(parsed.value)).toBe(before)
  const again = parseMermaid(source)
  expect(again.ok && serializeMermaid(again.value)).toBe(source)
})

test('State comments stay before their authored state through serialization and renaming', () => {
  const parsed = parseMermaid('stateDiagram-v2\n  %% state rationale\n  state "Start" as A')
  if (!parsed.ok) throw new Error('parse failed')
  const source = serializeMermaid(parsed.value)
  expect(source).toMatch(/%% state rationale\n\s*state "Start" as A/)
  const renamed = mutate(parsed.value, { kind: 'rename_state', from: 'A', to: 'Renamed' })
  if (!renamed.ok) throw new Error(renamed.error.message)
  expect(serializeMermaid(renamed.value)).toMatch(/%% state rationale\n\s*state "Start" as Renamed/)
})

test.each([
  ['stateDiagram-v2\n  state "A %% quoted" as A %% real comment\n  A --> B', 'state "A %% quoted" as A'],
  ['stateDiagram-v2\n  state "A\nB" as A %% real comment\n  A --> C', 'state "A<br/>B" as A'],
])('State inline comments follow their complete quoted alias: %s', (authored, alias) => {
  const parsed = parseMermaid(authored)
  if (!parsed.ok) throw new Error('parse failed')
  const source = serializeMermaid(parsed.value)
  expect(source).toContain(`${alias}\n%% real comment\n`)
  const reparsed = parseMermaid(source)
  if (!reparsed.ok) throw new Error('reload failed')
  expect(serializeMermaid(reparsed.value)).toBe(source)
})

test.each([
  ['stateDiagram-v2\n%% rationale\nstate "Actual" as stateDiagram-v2', 'state "Actual" as stateDiagram-v2'],
  ['stateDiagram-v2\nnote left of A\nB\nend note\n%% rationale\nstate "Actual" as B', 'state "Actual" as B'],
  ['---\ntitle: B\n---\nstateDiagram-v2\naccTitle: Heading\n%% rationale\nstate "Actual" as B', 'state "Actual" as B'],
])('State comments anchor to declarations rather than document or note text: %s', (authored, declaration) => {
  const parsed = parseMermaid(authored)
  if (!parsed.ok) throw new Error('parse failed')
  expect(serializeMermaid(parsed.value)).toContain(`%% rationale\n  ${declaration}`)
})
