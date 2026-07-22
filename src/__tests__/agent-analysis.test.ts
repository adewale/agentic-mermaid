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

  test('reports class link/click hrefs through the shared action model', () => {
    const result = analyzeMermaidSource(`classDiagram
  class API
  click API href "https://example.com/api"
`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.actions).toEqual([
      expect.objectContaining({ family: 'class', target: 'API', action: 'href', href: 'https://example.com/api', security: 'safe' }),
    ])
  })

  test('uses renderer statement context for compound actions and ignores accessibility prose', () => {
    const flow = analyzeMermaidSource(`flowchart LR
  A; click A href "https://example.com/flow"
  accDescr {
  click A href https://example.com/not-an-action
  }
`)
    expect(flow.ok).toBe(true)
    if (!flow.ok) return
    expect(flow.value.actions).toEqual([
      expect.objectContaining({ target: 'A', href: 'https://example.com/flow', line: 2 }),
    ])

    const cls = analyzeMermaidSource(`classDiagram
  namespace X { class A; click A href "https://example.com/class" }
  class B {
    click A href "https://example.com/member-text"
  }
  accDescr {
  click A href https://example.com/not-an-action
  }
`)
    expect(cls.ok).toBe(true)
    if (!cls.ok) return
    expect(cls.value.actions).toEqual([
      expect.objectContaining({ target: 'A', href: 'https://example.com/class', line: 2 }),
    ])
  })

  test('reports actions after a closing accDescr brace without reporting block prose', () => {
    const analyzed = analyzeMermaidSource(`flowchart LR
  A
  accDescr {
    click A href https://example.com/not-an-action
  } click A href "javascript:alert(1)"`)

    expect(analyzed.ok).toBe(true)
    if (!analyzed.ok) return
    expect(analyzed.value.actions).toEqual([
      expect.objectContaining({
        target: 'A',
        href: 'javascript:alert(1)',
        security: 'unsafe',
        line: 5,
      }),
    ])
  })

  test('accessibility prose cannot extend markdown masking past its closing brace', () => {
    const analyzed = analyzeMermaidSource(`flowchart LR
  A
  accDescr {
    prose with unmatched \`
  } click A href "javascript:alert(1)"`)

    expect(analyzed.ok).toBe(true)
    if (!analyzed.ok) return
    expect(analyzed.value.actions).toEqual([
      expect.objectContaining({
        target: 'A',
        href: 'javascript:alert(1)',
        security: 'unsafe',
        line: 5,
      }),
    ])
  })

  test('does not report apparent actions after an unclosed accDescr opener', () => {
    const analyzed = analyzeMermaidSource(`flowchart LR
  A
  accDescr {
    click A href "javascript:alert(1)"`)

    expect(analyzed.ok).toBe(true)
    if (analyzed.ok) expect(analyzed.value.actions).toEqual([])
  })

  test('classifies entity- and control-obfuscated active schemes as unsafe', () => {
    for (const href of [
      'javascript&#58;alert(1)',
      'java\tscript:alert(1)',
      'javascript&colon;alert(1)',
      'javascript&amp;#58;alert(1)',
      'javascript&#0000058alert(1)',
    ]) {
      const analyzed = analyzeMermaidSource(`flowchart LR\n A\n click A href "${href}"`)
      expect(analyzed.ok).toBe(true)
      if (analyzed.ok) expect(analyzed.value.actions[0]).toEqual(expect.objectContaining({ security: 'unsafe' }))
    }
  })

  test('does not extract phantom actions from multiline markdown-string prose', () => {
    const analyzed = analyzeMermaidSource(`flowchart LR
  A["\`Docs say:
  click B href https://evil.example/not-action
  do not run\`"] --> B[Safe target]
`)
    expect(analyzed.ok).toBe(true)
    if (analyzed.ok) expect(analyzed.value.actions).toEqual([])
  })

  test('decodes quoted href escapes with the renderer grammar', () => {
    for (const [authored, href] of [
      ['https://example.com/a\\"b', 'https://example.com/a"b'],
      ['https://example.com/a\\\\b', 'https://example.com/a\\b'],
    ]) {
      const analyzed = analyzeMermaidSource(`flowchart LR\n  A\n  click A href "${authored}"`)
      expect(analyzed.ok).toBe(true)
      if (analyzed.ok) expect(analyzed.value.actions[0]).toEqual(expect.objectContaining({ href, security: 'safe' }))
    }
  })

  test('control-bearing hrefs are unsafe even behind a safe scheme', () => {
    for (const href of [
      'https://example.com/\u001b]52;c;payload\u0007',
      'https://example.com/&#27;]52;c;payload&#7;',
    ]) {
      const analyzed = analyzeMermaidSource(`flowchart LR\n  A\n  click A href "${href}"`)
      expect(analyzed.ok).toBe(true)
      if (analyzed.ok) expect(analyzed.value.actions[0]).toEqual(expect.objectContaining({ security: 'unsafe' }))
    }
  })

  test('preserves callback grammar and backticks in genuine action payloads', () => {
    for (const [directive, raw] of [
      ['click A callback', ''],
      ['click A callback "tooltip"', '"tooltip"'],
      ['click A call doThing(`x`)', 'doThing(`x`)'],
      ['click A myHandler', 'myHandler'],
      ['click A myHandler(1)', 'myHandler(1)'],
    ] as const) {
      const analyzed = analyzeMermaidSource(`flowchart LR\n A\n ${directive}`)
      expect(analyzed.ok).toBe(true)
      if (analyzed.ok) expect(analyzed.value.actions[0]).toEqual(expect.objectContaining({
        action: directive.includes(' call ') ? 'call' : 'callback', raw, security: 'source-only',
      }))
    }

    const cls = analyzeMermaidSource('classDiagram\n class Shape\n callback Shape "callbackFunction" "tip"')
    expect(cls.ok).toBe(true)
    if (cls.ok) expect(cls.value.actions[0]).toEqual(expect.objectContaining({
      family: 'class', target: 'Shape', action: 'callback', raw: '"callbackFunction" "tip"',
    }))
  })

  test('distinguishes quoted relative links from bare callback handlers', () => {
    const analyzed = analyzeMermaidSource('flowchart LR\n A\n click A "click.html" "tooltip"')
    expect(analyzed.ok).toBe(true)
    if (analyzed.ok) expect(analyzed.value.actions[0]).toEqual(expect.objectContaining({
      family: 'flowchart', target: 'A', action: 'href', href: 'click.html', security: 'safe',
    }))

    for (const href of ['javascript:alert(1)', 'javascript&#58;alert(1)']) {
      const unsafe = analyzeMermaidSource(`flowchart LR\n A\n click A "${href}"`)
      expect(unsafe.ok).toBe(true)
      if (unsafe.ok) expect(unsafe.value.actions[0]).toEqual(expect.objectContaining({
        family: 'flowchart', target: 'A', action: 'href', href, security: 'unsafe',
      }))
    }
  })

  test('enrolls safe sequence actor menus in the unified action model', () => {
    const analyzed = analyzeMermaidSource(`sequenceDiagram
 participant Alice
 link Alice: Dashboard @ https://example.com/dash`)
    expect(analyzed.ok).toBe(true)
    if (analyzed.ok) expect(analyzed.value.actions).toEqual([
      expect.objectContaining({
        family: 'sequence', target: 'Alice', action: 'href', href: 'https://example.com/dash', security: 'safe',
      }),
    ])
  })
})
