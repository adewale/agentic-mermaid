import { describe, expect, test } from 'bun:test'
import { analyzeMermaidSource } from '../agent/index.ts'

describe('analyzeMermaidSource', () => {
  test('reports graph feedback edges and source-only action records', () => {
    const result = analyzeMermaidSource(`flowchart LR
  A --> B
  B -- retry --> A
  click A call doThing()
  click B href "javascript:alert(1)"
  click C href "data:text/html,<script>bad</script>"
  click D href "https://example.com"
`)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.feedbackEdges).toEqual([
      { edgeIndex: 1, from: 'B', to: 'A', label: 'retry', routeClass: 'feedback' },
    ])
    expect(result.value.actions).toEqual([
      expect.objectContaining({ family: 'flowchart', target: 'A', action: 'call', executable: false, security: 'source-only' }),
      expect.objectContaining({ family: 'flowchart', target: 'B', action: 'href', href: 'javascript:alert(1)', executable: false, security: 'unsafe' }),
      expect.objectContaining({ family: 'flowchart', target: 'C', action: 'href', href: 'data:text/html,<script>bad</script>', executable: false, security: 'unsafe' }),
      expect.objectContaining({ family: 'flowchart', target: 'D', action: 'href', href: 'https://example.com', executable: false, security: 'safe' }),
    ])
  })

  test('reports Gantt critical path/slack analysis and click records without executing calls', () => {
    const result = analyzeMermaidSource(`gantt
  dateFormat YYYY-MM-DD
  section Build
    A :a, 2024-01-01, 2d
    B :b, after a, 1d
    C :c, 2024-01-01, 1d
  click b call notify()
`)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.gantt?.criticalPathTaskIds).toEqual(['a', 'b'])
    expect(result.value.gantt?.slackByTaskId.c).toBeGreaterThan(0)
    expect(result.value.actions).toEqual([
      expect.objectContaining({ family: 'gantt', target: 'b', action: 'call', executable: false, security: 'source-only' }),
    ])
  })
})
