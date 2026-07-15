import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'

const GANTT = `gantt
  dateFormat YYYY-MM-DD
  section Build
  Critical :crit, a, 2026-01-01, 2d
  section Release
  Done :done, b, after a, 2d
  Gate :milestone, done, m, after b, 0d`

const temporalStyle = {
  semanticSlots: {
    build: { fillColor: '#ff00ff', borderColor: '#00aa00', lineWidth: 9, cue: 'double-line' },
    done: { fillColor: '#00ffff', borderColor: '#005555', lineWidth: 7, cue: 'pattern' },
  },
  bindings: [
    { channel: 'category', value: 'Build', slot: 'build', role: 'task' },
    { channel: 'category', value: 'Release', slot: 'done', role: 'task' },
    { channel: 'category', value: 'Release', slot: 'done', role: 'milestone' },
  ],
} as const

function taskGeometry(svg: string): string[] {
  return [...svg.matchAll(/<(rect|path)[^>]*data-task="[^"]+"[^>]*>/g)].map(match => {
    const mark = match[0]
    const attr = (name: string) => mark.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? ''
    return match[1] === 'rect'
      ? ['rect', attr('data-task'), attr('x'), attr('y'), attr('width'), attr('height'), attr('rx'), attr('ry')].join('|')
      : ['path', attr('data-task'), attr('d')].join('|')
  })
}

describe('Section B temporal semantic bindings', () => {
  test('Gantt category slots alter paint while preserving geometry and critical emphasis', () => {
    const options = { gantt: { criticalPath: true } } as const
    const baseline = renderMermaidSVG(GANTT, options)
    const branded = renderMermaidSVG(GANTT, { ...options, style: temporalStyle })

    expect(taskGeometry(branded)).toEqual(taskGeometry(baseline))
    expect(branded).toContain('data-task="a"')
    expect(branded).toContain('data-task="b"')
    expect(branded).toContain('data-task="m"')
    expect(branded.match(/gantt-bar-critical-path/g)?.length).toBeGreaterThanOrEqual(3)
    expect(branded).toContain('data-brand-cue="double-line"')
    expect(branded).toContain('data-brand-cue="pattern"')
    expect(branded).toContain('stroke-dasharray:8 2 2 2')
    expect(branded).toContain('stroke-dasharray:3 2')
    expect(branded).toContain('fill:#ff00ff')
    expect(branded).toContain('fill:#00ffff')
    // Critical-path stroke and width are family-owned and remain the final
    // crisp/semantic authority instead of the deliberately conflicting slots.
    for (const mark of branded.match(/<(?:rect|path)[^>]*gantt-bar-critical-path[^>]*>/g) ?? []) {
      expect(mark).not.toContain('stroke:#00aa00')
      expect(mark).not.toContain('stroke:#005555')
      expect(mark).not.toContain('stroke-width:9')
      expect(mark).not.toContain('stroke-width:7')
    }
    const terminalBaseline = renderMermaidASCII(GANTT, { colorMode: 'none', useAscii: true })
    const terminalBranded = renderMermaidASCII(GANTT, { colorMode: 'none', useAscii: true, style: temporalStyle })
    expect(terminalBranded).not.toBe(terminalBaseline)
    expect(terminalBranded).toContain('%%%%')
  })

  test('Journey category slot is a default beneath explicit family section paint', () => {
    const body = `journey
  section Browse
    Find product: 4: Shopper`
    const style = {
      semanticSlots: { browse: { fillColor: '#ff00ff', borderColor: '#006600', lineWidth: 3, fontSize: 15, fontWeight: 800, textColor: '#2222aa', cue: 'outline' } },
      bindings: [{ channel: 'category', value: 'Browse', slot: 'browse', role: 'group-header' }],
    } as const
    const baseline = renderMermaidSVG(body)
    const branded = renderMermaidSVG(body, { style })
    const headerHeight = (svg: string) => Number(svg.match(/<rect class="journey-section-bg[^>]*\sheight="([^"]+)"/)?.[1])
    const taskWidth = (svg: string) => Number(svg.match(/<rect class="journey-task-box"[^>]*\swidth="([^"]+)"/)?.[1])
    // The bound typography participates in layout: the header grows rather
    // than painting a larger font into baseline geometry. Task width and the
    // family-owned score remain unchanged.
    expect(headerHeight(branded)).toBeGreaterThan(headerHeight(baseline))
    expect(taskWidth(branded)).toBe(taskWidth(baseline))
    expect(branded).toContain('data-score="4"')
    expect(branded).toContain('fill:#ff00ff')
    expect(branded).toContain('data-brand-cue="outline"')
    expect(branded).toContain('stroke-width:4')
    expect(branded).toContain('font-size="15" font-weight="800"')
    expect(branded).toContain('style="fill:#2222aa"')
    const terminalBaseline = renderMermaidASCII(body, { colorMode: 'none' })
    const terminalBranded = renderMermaidASCII(body, { colorMode: 'none', style })
    expect(terminalBranded).not.toBe(terminalBaseline)
    expect(terminalBranded).toContain('◇ [Browse]')

    const authored = `---
config:
  journey:
    sectionFills: ["#123456"]
---
${body}`
    const authoredSvg = renderMermaidSVG(authored, { style })
    expect(authoredSvg).toContain('.journey-section-label-band { fill: #123456;')
    expect(authoredSvg).not.toContain('fill:#ff00ff')
    expect(authoredSvg).not.toContain('style="fill:#2222aa"')
  })
})
