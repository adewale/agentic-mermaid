import { describe, expect, it } from 'bun:test'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'

/**
 * Issue #25 acceptance criterion 1 (ASCII side): the MFA/login regression's
 * forward edges must run forward. The greedy placement used to park a fan-in
 * target at its FIRST parent's level (D --No--> G placed G right after D), so
 * the later F --Yes--> G edge ran backward across the diagram. Longest-path
 * placement puts a fan-in target after its deepest parent.
 */
describe('ASCII layering — fan-in targets sit after their deepest parent', () => {
  it('MFA: Create Session renders to the right of Code Valid?', () => {
    const { regions } = renderMermaidASCIIWithMeta(`flowchart LR
  A[User] --> B[Login Page]
  B --> C{Valid Credentials?}
  C -- No --> B
  C -- Yes --> D{MFA Enabled?}
  D -- No --> G[Create Session]
  D -- Yes --> E[Enter MFA Code]
  E --> F{Code Valid?}
  F -- No --> E
  F -- Yes --> G`)
    const region = (id: string) => {
      const r = regions.find(r => r.id === id)
      if (!r) throw new Error(`region ${id} not found in ${regions.map(r => r.id).join(', ')}`)
      return r
    }
    expect(region('G').canvasColStart).toBeGreaterThan(region('F').canvasColStart)
    expect(region('F').canvasColStart).toBeGreaterThan(region('E').canvasColStart)
  })

  it('TD: a skip edge over a longer branch keeps the join below both branches', () => {
    const { regions } = renderMermaidASCIIWithMeta(`flowchart TD
  A --> Join[Join]
  A --> B
  B --> C
  C --> Join`)
    const region = (id: string) => {
      const r = regions.find(r => r.id === id)
      if (!r) throw new Error(`region ${id} not found`)
      return r
    }
    expect(region('Join').canvasRow).toBeGreaterThan(region('C').canvasRow)
  })
})
