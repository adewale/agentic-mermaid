import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'
import { visualWidth } from '../ascii/width.ts'

function assertRectangularBorder(lines: string[], label: string): void {
  const row = lines.findIndex(line => line.includes(label))
  expect(row).toBeGreaterThanOrEqual(0)
  const top = lines.slice(0, row + 1).reverse().find(line => /[┌+].*[┐+]$/.test(line.trimEnd()))
  const bottom = lines.slice(row).find(line => /[└+].*[┘+]$/.test(line.trimEnd()))
  expect(top).toBeDefined()
  expect(bottom).toBeDefined()
  expect(visualWidth(top!.trimEnd())).toBe(visualWidth(bottom!.trimEnd()))
}

describe('Class and ER terminal Unicode geometry', () => {
  test('Class preserves CJK and emoji graphemes inside rectangular boxes', () => {
    const output = renderMermaidASCII(`classDiagram
  class Start["開始🙂"] {
    +処理👩‍💻()
  }`)
    expect(output).toContain('開始🙂')
    expect(output).toContain('処理👩‍💻()')
    expect(output).not.toContain('\x00')
    assertRectangularBorder(output.split('\n'), '開始🙂')
  })

  test('ER preserves CJK/emoji attributes, comments, labels, and box geometry', () => {
    const output = renderMermaidASCII(`erDiagram
  CUSTOMER["顧客🙂"] {
    string name PK "表示名👩‍💻"
  }
  ORDER["注文"] {
    string id PK
  }
  CUSTOMER ||--o{ ORDER : "所有🙂"`)
    expect(output).toContain('顧客🙂')
    expect(output).toContain('name')
    expect(output).toContain('表示名👩‍💻')
    expect(output).toContain('所有🙂')
    expect(output).not.toContain('\x00')
    assertRectangularBorder(output.split('\n'), '顧客🙂')
  })
})
