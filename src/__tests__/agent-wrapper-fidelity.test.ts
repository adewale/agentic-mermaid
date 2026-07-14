// ============================================================================
// Wrapper fidelity (1C) + in-body comment policy (2C).
//
// 1C: the leading source wrapper — frontmatter block, %%{init}%% directives,
// %% comments before the header, blank lines — round-trips byte-verbatim
// through parse → serialize and through mutation. Canonical wrapper synthesis
// (Mermaid's documented config-nested shape) is opt-in.
//
// 2C: in-body %% comments are not modeled by structured bodies; their loss is
// announced by the Tier 3 COMMENT_DROPPED lint instead of being silent.
// Opaque bodies and preserved opaque segments keep comments and never warn.
//
// Each round-trip test also asserts the PREVIOUS bug shape is gone (flattened
// top-level frontmatter keys, synthesized duplicate frontmatter above a kept
// directive), so reverting the fix fails these tests.
// ============================================================================

import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import {
  parseMermaid, serializeMermaid, verifyMermaid, mutate, asFlowchart,
} from '../agent/index.ts'

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
})

describe('wrapper fidelity (1C): canonical synthesis on demand', () => {
  test('canonical mode nests config keys under config: with title top-level, directives folded', () => {
    const p = parseMermaid(COMBO)
    if (!p.ok) throw new Error('parse failed')
    const out = serializeMermaid(p.value, { wrapper: 'canonical' })
    expect(out).toBe('---\ntitle: My flow\nconfig:\n  layout: elk\n  theme: dark\n---\nflowchart TD\n  A --> B\n')
    expect(out).not.toContain('%%{init')  // folded, not duplicated
  })

  test('a directive whose payload cannot be parsed is preserved raw in canonical mode', () => {
    // A scalar is not a config map, so it cannot be folded into frontmatter.
    const src = '%%{init: definitely-not-an-object}%%\nflowchart TD\n  A --> B'
    const p = parseMermaid(src)
    if (!p.ok) throw new Error('parse failed')
    const out = serializeMermaid(p.value, { wrapper: 'canonical' })
    expect(out).toContain('%%{init: definitely-not-an-object}%%')
  })

  test('am format defaults to verbatim; --canonical-wrapper opts into synthesis', () => {
    const run = (args: string[]) => spawnSync('bun', [join(import.meta.dir, '..', '..', 'bin', 'am.ts'), 'format', '-', ...args], {
      input: COMBO, encoding: 'utf8',
    })
    const verbatim = run([])
    expect(verbatim.status).toBe(0)
    expect(verbatim.stdout).toBe(COMBO + '\n')
    const canonical = run(['--canonical-wrapper'])
    expect(canonical.status).toBe(0)
    expect(canonical.stdout.startsWith('---\ntitle: My flow\nconfig:\n')).toBe(true)
    expect(canonical.stdout).not.toContain('%%{init')
  })
})

describe('comment policy (2C): announced, never silent', () => {
  test('in-body comments in a structured flowchart raise COMMENT_DROPPED with count and lines', () => {
    const src = 'flowchart TD\n  %% do not reorder\n  A --> B\n  %% another note\n  B --> C'
    const p = parseMermaid(src)
    if (!p.ok) throw new Error('parse failed')
    const v = verifyMermaid(p.value)
    expect(v.ok).toBe(true)  // lint never flips ok
    const w = v.warnings.find(x => x.code === 'COMMENT_DROPPED')
    expect(w).toMatchObject({ code: 'COMMENT_DROPPED', count: 2 })
    expect((w as { lines: number[] }).lines.length).toBe(2)
  })

  test('wrapper comments do not raise COMMENT_DROPPED (they are preserved verbatim)', () => {
    const p = parseMermaid(LEAD_COMMENT)
    if (!p.ok) throw new Error('parse failed')
    expect(verifyMermaid(p.value).warnings.filter(w => w.code === 'COMMENT_DROPPED')).toEqual([])
  })

  test('duplicate comment text is occurrence-counted, so a preserved wrapper comment does not mask a dropped body comment', () => {
    const src = '%% same\nflowchart TD\n  %% same\n  A --> B'
    const p = parseMermaid(src)
    if (!p.ok) throw new Error('parse failed')
    expect(serializeMermaid(p.value)).toBe('%% same\nflowchart TD\n  A --> B\n')
    const w = verifyMermaid(p.value).warnings.find(w => w.code === 'COMMENT_DROPPED')
    expect(w).toMatchObject({ code: 'COMMENT_DROPPED', count: 1, lines: [3] })
  })

  test('duplicate comment text is position-matched, so a later preserved opaque-block comment does not mask an earlier dropped comment', () => {
    const src = `sequenceDiagram
  %% same
  A->>B: hi
  alt ok
    %% same
    B->>A: ok
  end`
    const p = parseMermaid(src)
    if (!p.ok) throw new Error('parse failed')
    expect(serializeMermaid(p.value)).toContain('%% same')
    const w = verifyMermaid(p.value).warnings.find(w => w.code === 'COMMENT_DROPPED')
    expect(w).toMatchObject({ code: 'COMMENT_DROPPED', count: 1, lines: [2] })
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
