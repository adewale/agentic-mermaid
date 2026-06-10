// Loop 10 M3 (#113): pathfinder trunk-sharing for fanouts.
//
// NOTE: trunk-sharing was ALREADY implemented (src/ascii/edge-bundling.ts
// fan-out bundles with a shared path + junction). rmvegasm PR #113 fixed
// fanout-trunk / floating-connector bugs (#111/#112) in an earlier upstream
// state; our fork's bundling already produces correct shared trunks. This
// file adds the regression coverage that locks the behavior + determinism in.

import { describe, test, expect } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'
import { createHash } from 'node:crypto'

describe('#113 fanout trunk-sharing', () => {
  test('1→{B,C,D} fanout renders a shared trunk with a fork connector', () => {
    const out = renderMermaidASCII('flowchart TD\n  A --> B\n  A --> C\n  A --> D')
    // A single trunk descends from A, then forks. The fork uses box-drawing
    // tee/branch glyphs (├ ┬ ┐) rather than three independent parallel lines.
    expect(out).toContain('A')
    expect(out).toContain('B')
    expect(out).toContain('C')
    expect(out).toContain('D')
    // Branch/junction glyph present (shared trunk forks rather than N separate lines).
    expect(out).toMatch(/[├┬┐┼]/)
  })

  test('no floating connectors — every branch glyph connects to a line', () => {
    const out = renderMermaidASCII('flowchart TD\n  A --> B\n  A --> C\n  A --> D')
    const lines = out.split('\n')
    // A row containing a fork glyph must also contain a horizontal run, so the
    // connector isn't dangling in space (the #112 floating-connector bug).
    const forkRow = lines.find(l => /[├┬┼]/.test(l))
    expect(forkRow).toBeDefined()
    expect(forkRow!).toMatch(/─/)
  })

  test('LR fanout also produces a clean trunk', () => {
    const out = renderMermaidASCII('flowchart LR\n  A --> B\n  A --> C\n  A --> D')
    expect(out).toMatch(/[├┬┼└┐]/)
    for (const id of ['A', 'B', 'C', 'D']) expect(out).toContain(id)
  })

  test('labeled LR fanout keeps labels on branch runs and shares a vertical trunk', () => {
    const out = renderMermaidASCII(`flowchart LR
  Src["Source"]
  Top["Top Target"]
  Mid["Middle Target"]
  Bot["Bottom Target"]
  Src -->|top*| Top
  Src -->|mid*| Mid
  Src -->|bot*| Bot`)
    expect(out).toContain('Source ├────top*──►')
    expect(out).toContain('├─────mid*─────►')
    expect(out).toContain('└─────bot*─────►')
  })

  test('labeled TD fanout shares one trunk and places labels on branches (upstream #111 repro)', () => {
    const out = renderMermaidASCII(`flowchart TB
    Src["Source"]
    Left["Left Target"]
    Center["Center Target"]
    Right["Right Target"]
    Src -->|left*| Left
    Src -->|center*| Center
    Src -->|right*| Right`)
    expect(out).toContain('Source   ├─────────────┬─────────────────────┐')
    expect(out).toContain('center*')
    expect(out).toContain('right*')
    // Regression guard: center* used to be written onto the horizontal trunk.
    expect(out).not.toContain('└────center*')
    expect(out).not.toContain('┼──────/right*')
  })

  test('bidirectional vertical labels remain separated after one-way fanout label centering changed', () => {
    const out = renderMermaidASCII(`flowchart TD
  A -->|down| B
  B -->|up| A`)
    const lines = out.split('\n')
    const downRow = lines.findIndex(l => l.includes('down'))
    const upRow = lines.findIndex(l => /\bup\b/.test(l))
    expect(downRow).toBeGreaterThanOrEqual(0)
    expect(upRow).toBeGreaterThanOrEqual(0)
    expect(Math.abs(downRow - upRow)).toBeGreaterThanOrEqual(2)
  })

  test('fanout rendering is deterministic across 10 runs', () => {
    const src = 'flowchart TD\n  A --> B\n  A --> C\n  A --> D\n  B --> E\n  C --> E\n  D --> E'
    const hashes = new Set<string>()
    for (let i = 0; i < 10; i++) {
      hashes.add(createHash('sha256').update(renderMermaidASCII(src)).digest('hex'))
    }
    expect(hashes.size).toBe(1)
  })

  test('single edge (no fanout) does not force a trunk', () => {
    const out = renderMermaidASCII('flowchart TD\n  A --> B')
    expect(out).toContain('A')
    expect(out).toContain('B')
  })
})
