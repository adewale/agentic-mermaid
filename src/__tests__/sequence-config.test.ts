// SequenceRuntimeConfig — typed sequence config with wire-or-warn (family-
// elevation-plan §Sequence item 6, config half; the class/er/flowchart
// pattern). Wired keys have natural mappings in src/sequence/layout.ts:
//   actorMargin      ↔ gap between actor box edges (upstream: "margin between actors")
//   width / height   ↔ actor box minimum size
//   diagramMarginX/Y ↔ outer padding
//   messageMargin    ↔ vertical space per message row
//   noteMargin       ↔ gap between a note and its anchor actor
//   activationWidth  ↔ activation rect width
//   showSequenceNumbers ↔ autonumber display (both SVG and ASCII surfaces)
// Everything else (wrap, mirrorActors, fonts, …) emits INEFFECTIVE_CONFIG
// from the single wire-or-warn table in src/sequence/config.ts.
//
// Hard gate: ABSENT config keeps default geometry byte-identical.

import { describe, test, expect } from 'bun:test'
import { renderMermaidSVG, renderMermaidASCII } from '../index.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { layoutSequenceDiagram } from '../sequence/layout.ts'
import { resolveSequenceConfig, SEQUENCE_NOOP_CONFIG_FIELDS, sequenceIneffectiveConfigFields } from '../sequence/config.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import type { SequenceRuntimeConfig } from '../mermaid-source.ts'

const SRC = `sequenceDiagram
  participant A
  participant B
  A->>B: Hello
  B->>A: World
`

function positioned(src: string, config = {}) {
  const lines = normalizeMermaidSource(src).lines
  return layoutSequenceDiagram(parseSequenceDiagram(lines), {}, config)
}

describe('SequenceRuntimeConfig type + resolution', () => {
  test('the typed shape accepts the documented keys', () => {
    // Compile-time: this assignment fails tsc if the typed surface is missing.
    const config: SequenceRuntimeConfig = {
      actorMargin: 100, width: 150, height: 65,
      diagramMarginX: 50, diagramMarginY: 10,
      messageMargin: 35, noteMargin: 10, activationWidth: 10,
      showSequenceNumbers: true, mirrorActors: true, wrap: false,
    }
    expect(config.actorMargin).toBe(100)
  })

  test('resolveSequenceConfig reads frontmatter and init directives', () => {
    const viaInit = normalizeMermaidSource(`%%{init: {"sequence": {"actorMargin": 90}}}%%\n${SRC}`)
    expect(resolveSequenceConfig(viaInit.frontmatter).actorMargin).toBe(90)
    const viaFm = normalizeMermaidSource(`---\nconfig:\n  sequence:\n    width: 120\n---\n${SRC}`)
    expect(resolveSequenceConfig(viaFm.frontmatter).width).toBe(120)
    expect(resolveSequenceConfig(normalizeMermaidSource(SRC).frontmatter)).toEqual({})
  })

  test('non-finite and negative values are ignored, not propagated', () => {
    const n = normalizeMermaidSource(`%%{init: {"sequence": {"actorMargin": -5, "width": "wide", "messageMargin": null}}}%%\n${SRC}`)
    expect(resolveSequenceConfig(n.frontmatter)).toEqual({})
  })
})

describe('wired keys move geometry', () => {
  test('actorMargin sets the edge-to-edge actor gap (upstream formula)', () => {
    const base = positioned(SRC)
    const wide = positioned(SRC, { actorMargin: 100 })
    const tight = positioned(SRC, { actorMargin: 20 })
    const gap = (p: ReturnType<typeof positioned>) => p.actors[1]!.x - p.actors[0]!.x
    // Default: max(140, halfWidths + 40) = 140 for two 80px actors.
    expect(gap(base)).toBe(140)
    // Configured: halfWidths + actorMargin.
    expect(gap(wide)).toBe(80 + 100)
    expect(gap(tight)).toBe(80 + 20)
  })

  test('width/height set the actor box minimums', () => {
    const p = positioned(SRC, { width: 150, height: 65 })
    expect(p.actors[0]!.width).toBe(150)
    expect(p.actors[0]!.height).toBe(65)
    const base = positioned(SRC)
    expect(base.actors[0]!.width).toBe(80)
  })

  test('diagramMarginX/Y set the outer padding', () => {
    const p = positioned(SRC, { diagramMarginX: 60, diagramMarginY: 5 })
    expect(p.actors[0]!.x - p.actors[0]!.width / 2).toBe(60)
    expect(p.actors[0]!.y).toBe(5)
  })

  test('messageMargin sets the per-row advance', () => {
    const p = positioned(SRC, { messageMargin: 60 })
    expect(p.messages[1]!.y - p.messages[0]!.y).toBe(60)
    const base = positioned(SRC)
    expect(base.messages[1]!.y - base.messages[0]!.y).toBe(40)
  })

  test('activationWidth sets the activation rect width', () => {
    const src = `sequenceDiagram
      A->>+B: go
      B-->>-A: done
    `
    const p = positioned(src, { activationWidth: 20 })
    expect(p.activations[0]!.width).toBe(20)
  })

  test('noteMargin sets the note-to-actor gap', () => {
    const src = `sequenceDiagram
      participant A
      participant B
      A->>B: hi
      Note right of B: careful
    `
    const base = positioned(src)
    const wide = positioned(src, { noteMargin: 30 })
    const actorRight = (p: ReturnType<typeof positioned>) => p.actors[1]!.x + p.actors[1]!.width / 2
    expect(base.notes[0]!.x - actorRight(base)).toBe(10)
    expect(wide.notes[0]!.x - actorRight(wide)).toBe(30)
  })

  test('showSequenceNumbers numbers messages on BOTH surfaces (SVG + ASCII)', () => {
    const src = `%%{init: {"sequence": {"showSequenceNumbers": true}}}%%\n${SRC}`
    const svg = renderMermaidSVG(src)
    expect(svg).toContain('1. Hello')
    expect(svg).toContain('2. World')
    const ascii = renderMermaidASCII(src)
    expect(ascii).toContain('1. Hello')
    expect(ascii).toContain('2. World')
    // An explicit autonumber directive still wins its own numbering.
    expect(renderMermaidSVG(`sequenceDiagram\n  autonumber 10\n  A->>B: Hello`)).toContain('10. Hello')
  })
})

describe('absent config is byte-inert', () => {
  test('empty config sections produce byte-identical SVG', () => {
    const plain = renderMermaidSVG(SRC)
    expect(renderMermaidSVG(`%%{init: {"sequence": {}}}%%\n${SRC}`)).toBe(plain)
    expect(renderMermaidSVG(`---\nconfig:\n  sequence: {}\n---\n${SRC}`)).toBe(plain)
  })

  test('layout with an empty resolved config equals layout without one', () => {
    const lines = normalizeMermaidSource(SRC).lines
    const a = layoutSequenceDiagram(parseSequenceDiagram(lines), {})
    const b = layoutSequenceDiagram(parseSequenceDiagram(lines), {}, {})
    expect(b).toEqual(a)
  })
})

describe('wire-or-warn: unwired keys emit INEFFECTIVE_CONFIG', () => {
  test('mirrorActors/wrap and friends are named; wired keys are not', () => {
    const src = `---
config:
  sequence:
    actorMargin: 100
    mirrorActors: true
    wrap: true
    rightAngles: true
---
${SRC}`
    const v = verifyMermaid(src)
    const fields = v.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG').map(w => (w as { field: string }).field)
    expect(fields).toContain('sequence.mirrorActors')
    expect(fields).toContain('sequence.wrap')
    expect(fields).toContain('sequence.rightAngles')
    expect(fields).not.toContain('sequence.actorMargin')
  })

  test('the NOOP table is disjoint from the wired keys and drives the lint', () => {
    expect(SEQUENCE_NOOP_CONFIG_FIELDS).toContain('mirrorActors')
    expect(SEQUENCE_NOOP_CONFIG_FIELDS).toContain('wrap')
    expect(SEQUENCE_NOOP_CONFIG_FIELDS).not.toContain('actorMargin')
    expect(SEQUENCE_NOOP_CONFIG_FIELDS).not.toContain('showSequenceNumbers')
    expect(sequenceIneffectiveConfigFields([{ wrap: true, actorMargin: 1 }])).toEqual(['wrap'])
  })

  test('no config → no INEFFECTIVE_CONFIG noise', () => {
    const v = verifyMermaid(SRC)
    expect(v.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG')).toEqual([])
  })
})
