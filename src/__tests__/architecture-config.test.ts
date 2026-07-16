import { describe, expect, it } from 'bun:test'
import { DEFAULT_ARCHITECTURE_VISUAL, resolveArchitectureVisualConfig, architectureIneffectiveConfigFields } from '../architecture/config.ts'
import { preprocessMermaidSource } from '../mermaid-source.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { verifyMermaid } from '../agent/verify.ts'
import type { DiagramColors } from '../theme.ts'

function resolve(text: string, colors: DiagramColors = { bg: '#ffffff', fg: '#1f2937' }) {
  return resolveArchitectureVisualConfig(preprocessMermaidSource(text).frontmatter, colors)
}

describe('resolveArchitectureVisualConfig', () => {
  it('computes visual metrics from architecture frontmatter config', () => {
    const resolved = resolve(`---
config:
  themeVariables:
    clusterBkg: "#111827"
    clusterBorder: "#38bdf8"
  architecture:
    padding: 60
    iconSize: 26
    fontSize: 16
---
architecture-beta
  service api(server)[API]`, {
      bg: '#0b1120',
      fg: '#F8FAFC',
      line: '#f59e0b',
      accent: '#38bdf8',
      surface: '#0f172a',
    })

    expect(resolved.padding).toBe(60)
    expect(resolved.visual.serviceIconSize).toBe(26)
    expect(resolved.visual.iconSize).toBe(23)
    expect(resolved.visual.serviceFontSize).toBe(16)
    expect(resolved.visual.groupFontSize).toBe(15)
    expect(resolved.visual.edgeFontSize).toBe(14)
    expect(resolved.visual.groupHeaderHeight).toBe(35)
    expect(resolved.visual.groupSurface).toBe('#111827')
    expect(resolved.visual.groupBorder).toBe('#38bdf8')
  })

  it('falls back to DiagramColors when no theme variables present', () => {
    const resolved = resolve(`architecture-beta
  service api(server)[API]`, {
      bg: '#fafaf9',
      fg: '#1c1917',
      surface: '#e7e5e4',
      border: '#a8a29e',
    })

    expect(resolved.visual.groupSurface).toBe('#e7e5e4')
    expect(resolved.visual.groupBorder).toBe('#a8a29e')
    expect(resolved.visual.serviceSurface).toBe('#e7e5e4')
    expect(resolved.visual.serviceBorder).toBe('#a8a29e')
  })

  it('merges sparse public visual overrides into complete layout and Scene paint', () => {
    const visual = {
      serviceCornerRadius: 17,
      serviceSurface: '#AABBCC',
    }
    const resolved = resolveArchitectureVisualConfig({}, { bg: '#fff', fg: '#111' }, { architecture: { visual } })
    expect(resolved.visual.serviceCornerRadius).toBe(17)
    expect(resolved.layout.serviceCornerRadius).toBe(17)
    expect(resolved.visual.serviceSurface).toBe('#AABBCC')

    const svg = renderMermaidSVG('architecture-beta\n  service api(server)[API]', { architecture: { visual } })
    expect(svg).toContain('rx="17" ry="17"')
    expect(svg).toContain('--arch-service-fill:#AABBCC')
  })

  it('validates cross-field invariants after sparse overrides merge with resolved defaults', () => {
    expect(() => resolveArchitectureVisualConfig(
      {},
      { bg: '#fff', fg: '#111' },
      { architecture: { visual: { junctionInnerRadius: 99 } } },
    )).toThrow(/junctionInnerRadius must not exceed junctionOuterRadius/)
  })
})

// Plan §Architecture 3 (workstream X7, wire-or-warn): of the six documented
// architecture.* layout-tuning keys, the two with natural deterministic
// mappings are wired — nodeSeparation (sibling spacing, px pass-through like
// class/er nodeSpacing) and idealEdgeLengthMultiplier (scales the layer gap
// from upstream's 1.5 default) — and the four fcose-simulation knobs
// (edgeElasticity, numIter, seed, randomize) have no meaning in a
// deterministic layout, so verify names them via INEFFECTIVE_CONFIG.
describe('architecture config wire-or-warn (X7)', () => {
  it('wires nodeSeparation to the deterministic sibling spacing', () => {
    const resolved = resolve(`---
config:
  architecture:
    nodeSeparation: 100
---
architecture-beta
  service api(server)[API]`)
    expect(resolved.nodeSpacing).toBe(100)

    const unset = resolve(`architecture-beta
  service api(server)[API]`)
    expect(unset.nodeSpacing).toBeUndefined()
  })

  it('wires idealEdgeLengthMultiplier as a layer-spacing multiplier around upstream\'s 1.5 default', () => {
    const tripled = resolve(`---
config:
  architecture:
    idealEdgeLengthMultiplier: 3
---
architecture-beta
  service api(server)[API]`)
    // 56px default layer gap × 3 / 1.5
    expect(tripled.layerSpacing).toBe(112)

    const neutral = resolve(`---
config:
  architecture:
    idealEdgeLengthMultiplier: 1.5
---
architecture-beta
  service api(server)[API]`)
    expect(neutral.layerSpacing).toBe(56)

    const invalid = resolve(`---
config:
  architecture:
    idealEdgeLengthMultiplier: -2
---
architecture-beta
  service api(server)[API]`)
    expect(invalid.layerSpacing).toBeUndefined()
  })

  it('names exactly the unwired fcose-simulation keys', () => {
    const fields = architectureIneffectiveConfigFields([{
      nodeSeparation: 100,
      idealEdgeLengthMultiplier: 2,
      edgeElasticity: 0.9,
      numIter: 5000,
      seed: 7,
      randomize: true,
    }])
    expect(fields).toEqual(['edgeElasticity', 'numIter', 'randomize', 'seed'])
  })

  it('verify emits INEFFECTIVE_CONFIG for the fcose keys and stays ok; wired keys stay silent', () => {
    const r = parseMermaid(`---
config:
  architecture:
    nodeSeparation: 100
    idealEdgeLengthMultiplier: 2
    edgeElasticity: 0.9
    numIter: 5000
    seed: 7
    randomize: true
---
architecture-beta
  service api(server)[API]
  service db(database)[DB]
  api:R --> L:db`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const v = verifyMermaid(r.value)
    expect(v.ok).toBe(true)
    const named = v.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG').map(w => (w as { field: string }).field)
    expect(named).toEqual(['architecture.edgeElasticity', 'architecture.numIter', 'architecture.randomize', 'architecture.seed'])
  })

  it('renderMermaidSVG honors the wired keys with real geometry changes', () => {
    const siblings = (config: string) => `${config}architecture-beta
  service a(server)[A]
  service b(server)[B]
  service c(server)[C]
  a:R --> L:c
  b:R --> L:c`
    const height = (svg: string) => Number(svg.match(/height="(\d+(?:\.\d+)?)"/)![1])
    const width = (svg: string) => Number(svg.match(/width="(\d+(?:\.\d+)?)"/)![1])

    // nodeSeparation: a and b are same-layer siblings — the vertical gap grows.
    const spread = renderMermaidSVG(siblings('---\nconfig:\n  architecture:\n    nodeSeparation: 160\n---\n'))
    const dflt = renderMermaidSVG(siblings(''))
    expect(height(spread)).toBeGreaterThan(height(dflt))

    // idealEdgeLengthMultiplier: layer gap grows along the flow axis.
    const chain = (config: string) => `${config}architecture-beta
  service a(server)[A]
  service b(server)[B]
  service c(server)[C]
  a:R --> L:b
  b:R --> L:c`
    const stretched = renderMermaidSVG(chain('---\nconfig:\n  architecture:\n    idealEdgeLengthMultiplier: 4\n---\n'))
    const chainDflt = renderMermaidSVG(chain(''))
    expect(width(stretched)).toBeGreaterThan(width(chainDflt))
  })
})
