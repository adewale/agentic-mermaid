import { describe, it, expect } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'

/** Asserts each part appears and each starts on a later row than the one
 *  before it (a `<br>` that collapsed to a space would put them on one row).
 *  Returns the rows so callers can check spacing. */
function expectStacked(ascii: string, ...parts: string[]): number[] {
  const rows = ascii.split('\n')
  const at = parts.map(part => rows.findIndex(row => row.includes(part)))
  expect({ parts, found: at.every(row => row >= 0), stacked: at.every((row, i) => i === 0 || row > at[i - 1]!) })
    .toEqual({ parts, found: true, stacked: true })
  return at
}

describe('ASCII multi-line labels', () => {
  describe('flowchart nodes', () => {
    it('renders multi-line node labels', () => {
      const ascii = renderMermaidASCII('graph TD\n  A[Line1<br>Line2]', { useAscii: false })
      expect(ascii).toContain('Line1')
      expect(ascii).toContain('Line2')
      // Lines should be on different rows
      const lines = ascii.split('\n')
      const line1Row = lines.findIndex(l => l.includes('Line1'))
      const line2Row = lines.findIndex(l => l.includes('Line2'))
      expect(line2Row).toBeGreaterThan(line1Row)
    })

    it('handles 3+ line labels', () => {
      const ascii = renderMermaidASCII('graph TD\n  A[A<br>B<br>C]', { useAscii: false })
      expect(ascii).toContain('A')
      expect(ascii).toContain('B')
      expect(ascii).toContain('C')
      // Verify vertical ordering
      const lines = ascii.split('\n')
      const aRow = lines.findIndex(l => l.includes('A') && !l.includes('─') && !l.includes('-'))
      const bRow = lines.findIndex(l => l.includes('B'))
      const cRow = lines.findIndex(l => l.includes('C'))
      expect(bRow).toBeGreaterThan(aRow)
      expect(cRow).toBeGreaterThan(bRow)
    })

    it('renders in ASCII mode (not Unicode)', () => {
      const ascii = renderMermaidASCII('graph TD\n  A[Line1<br>Line2]', { useAscii: true })
      expect(ascii).toContain('Line1')
      expect(ascii).toContain('Line2')
      // Should use ASCII box characters
      expect(ascii).toContain('+')
      expect(ascii).toContain('-')
    })
  })

  describe('flowchart edge labels', () => {
    it('renders multi-line edge labels', () => {
      const ascii = renderMermaidASCII('graph TD\n  A --> B\n  A -->|Line1<br>Line2| C', { useAscii: false })
      expectStacked(ascii, 'Line1', 'Line2')
    })
  })

  describe('flowchart subgraph labels', () => {
    it('renders multi-line subgraph labels', () => {
      const ascii = renderMermaidASCII(`graph TD
        subgraph sg [Group<br>Header]
          A[Node]
        end
      `, { useAscii: false })
      expectStacked(ascii, 'Group', 'Header')
    })
  })

  describe('sequence diagram', () => {
    it('renders multi-line actor labels', () => {
      const ascii = renderMermaidASCII(`sequenceDiagram
        participant A as Actor<br>One
        A->>A: msg
      `, { useAscii: false })
      expectStacked(ascii, 'Actor', 'One')
    })

    it('renders multi-line message labels', () => {
      const ascii = renderMermaidASCII(`sequenceDiagram
        participant A
        participant B
        A->>B: Line1<br>Line2
      `, { useAscii: false })
      expectStacked(ascii, 'Line1', 'Line2')
    })

    it('splits multi-line self-arrow labels into separate rows (bug 3.1)', () => {
      const ascii = renderMermaidASCII(`sequenceDiagram
        participant A
        A->>A: hello<br/>world
      `, { useAscii: false })
      // Both lines must appear in the canvas — Loop 7 fix replaces the
      // single-line draw with splitLines + per-line rendering.
      expect(ascii).toContain('hello')
      expect(ascii).toContain('world')
      // And they must sit on different visible rows.
      const lines = ascii.split('\n')
      const helloRow = lines.findIndex(l => l.includes('hello'))
      const worldRow = lines.findIndex(l => l.includes('world'))
      expect(helloRow).toBeGreaterThanOrEqual(0)
      expect(worldRow).toBeGreaterThan(helloRow)
    })

    it('preserves existing note multi-line support', () => {
      const ascii = renderMermaidASCII(`sequenceDiagram
        participant A
        A->>A: self
        Note over A: Note line 1<br>Note line 2
      `, { useAscii: false })
      expectStacked(ascii, 'Note line 1', 'Note line 2')
    })
  })

  describe('class diagram', () => {
    it('renders multi-line class names', () => {
      const ascii = renderMermaidASCII(`classDiagram
        class MyClass["Long<br>Name"]
      `, { useAscii: false })
      expectStacked(ascii, 'Long', 'Name')
    })

    it('renders multi-line relationship labels', () => {
      const ascii = renderMermaidASCII(`classDiagram
        A --> B : uses<br>implements
      `, { useAscii: false })
      expectStacked(ascii, 'uses', 'implements')
    })
  })

  describe('ER diagram', () => {
    it('renders multi-line entity names', () => {
      const ascii = renderMermaidASCII(`erDiagram
        "Entity<br>Name" {
          string id
        }
      `, { useAscii: false })
      expectStacked(ascii, 'Entity', 'Name')
    })

    it('renders multi-line ER relationship labels', () => {
      const ascii = renderMermaidASCII(`erDiagram
        A ||--o{ B : "has<br>many"
      `, { useAscii: false })
      expectStacked(ascii, 'has', 'many')
    })
  })

  describe('edge cases', () => {
    it('handles empty lines from consecutive <br>', () => {
      const ascii = renderMermaidASCII('graph TD\n  A[Line1<br><br>Line3]', { useAscii: false })
      // The empty middle line keeps its row.
      const [line1, line3] = expectStacked(ascii, 'Line1', 'Line3')
      expect(line3! - line1!).toBe(2)
    })

    it('handles single-line labels (no <br>)', () => {
      const ascii = renderMermaidASCII('graph TD\n  A[SingleLine]', { useAscii: false })
      expect(ascii.split('\n').filter(row => row.includes('SingleLine'))).toHaveLength(1)
    })

    it('handles very long lines', () => {
      const long = 'A'.repeat(30)
      const ascii = renderMermaidASCII(`graph TD\n  A[${long}<br>Short]`, { useAscii: false })
      expectStacked(ascii, long, 'Short')
    })

    it('handles mixed short and long lines', () => {
      const ascii = renderMermaidASCII('graph TD\n  A[Short<br>VeryLongSecondLine<br>Med]', { useAscii: false })
      expectStacked(ascii, 'Short', 'VeryLongSecondLine', 'Med')
    })
  })

  describe('multiline-utils functions', () => {
    it('splitLines puts each <br> segment on its own row, in order', () => {
      // Test through the rendering pipeline
      const ascii = renderMermaidASCII('graph TD\n  A[One<br>Two<br>Three]', { useAscii: false })
      expectStacked(ascii, 'One', 'Two', 'Three')
    })

    it('maxLineWidth uses longest line for box sizing', () => {
      // Box should be wide enough for the longest line
      const ascii = renderMermaidASCII('graph TD\n  A[X<br>LongLine<br>Y]', { useAscii: false })
      // The box should contain LongLine without truncation
      expect(ascii).toContain('LongLine')
    })
  })
})
