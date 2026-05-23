import { describe, expect, it } from 'bun:test'

import { renderMermaidASCII } from '../ascii/index.ts'
import { maxLineWidth, visualWidth } from '../ascii/multiline-utils.ts'

describe('ASCII CJK/fullwidth display width', () => {
  it('counts CJK, Hangul, and emoji by terminal column width', () => {
    expect(visualWidth('开始')).toBe(4)
    expect(visualWidth('시작')).toBe(4)
    expect(visualWidth('A🙂B')).toBe(4)
    expect(maxLineWidth('A\n开始')).toBe(4)
  })

  it('sizes unicode node boxes by visual width, not JavaScript string length', () => {
    const output = renderMermaidASCII('graph TD\n  A[开始]')
    const lines = output.split('\n').filter(Boolean)
    const top = lines.find(line => line.includes('┌')) ?? ''
    const label = lines.find(line => line.includes('开始')) ?? ''
    expect(top).toContain('────')
    expect(label).toContain('开始')
    expect(label).toContain('│')
  })

  it('keeps CJK target labels visible in connected diagrams', () => {
    const output = renderMermaidASCII('graph LR\n  A[开始] --> B[처리]')
    expect(output).toContain('开始')
    expect(output).toContain('처리')
    expect(output).toContain('►')
  })

  it('sizes custom ASCII shapes by visual width too', () => {
    const output = renderMermaidASCII('graph TD\n  A([开始])\n  B[[처리]]\n  C[(数据🙂)]')
    expect(output).toContain('开始')
    expect(output).toContain('처리')
    expect(output).toContain('数据🙂')
    expect(output).not.toContain('\x00')
  })
})
