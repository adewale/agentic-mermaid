import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII } from '../index.ts'

describe('terminal reciprocal edge conservation', () => {
  for (const direction of ['LR', 'RL'] as const) {
    for (const useAscii of [false, true]) {
      test(`${direction} ${useAscii ? 'ASCII' : 'Unicode'} keeps both labels and directional markers at minimum padding`, () => {
        const source = `flowchart ${direction}\n  A -- left --> B\n  B -- back --> A`
        const options = { colorMode: 'none' as const, paddingX: 1, paddingY: 1, useAscii }
        const output = renderMermaidASCII(source, options)
        expect(output.match(/left/g)).toHaveLength(1)
        expect(output.match(/back/g)).toHaveLength(1)
        expect(output).toContain('A')
        expect(output).toContain('B')
        expect(output.match(new RegExp(useAscii ? '<' : '◄', 'g'))).toHaveLength(1)
        expect(output.match(new RegExp(useAscii ? '>' : '►', 'g'))).toHaveLength(1)
        expect(renderMermaidASCII(source, options)).toBe(output)
      })

      test(`${direction} ${useAscii ? 'ASCII' : 'Unicode'} keeps both markers for an unlabeled two-cycle`, () => {
        const output = renderMermaidASCII(`flowchart ${direction}\n  A --> B\n  B --> A`, {
          colorMode: 'none', paddingX: 1, paddingY: 1, useAscii,
        })
        expect(output.match(new RegExp(useAscii ? '<' : '◄', 'g'))).toHaveLength(1)
        expect(output.match(new RegExp(useAscii ? '>' : '►', 'g'))).toHaveLength(1)
      })
    }
  }
})
