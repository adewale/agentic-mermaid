import { mutate, parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/index.ts'

const SOURCE = 'journey\n  A: 5: Me; B: 3: Me\n'
const UPSTREAM_REVISION = 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc'

function tasks(source: string): string[] {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'journey') throw new Error('Journey extension did not parse structurally')
  return parsed.value.body.sections.flatMap(section => section.tasks.map(task => `${task.text}:${task.score}`))
}

/** Separate from upstream-feature fidelity receipts: this source is not Mermaid syntax. */
export function observeJourneyExtensionReceipt() {
  const upstream = Bun.spawnSync({
    cmd: [process.execPath, '-e', `
      import DOMPurify from 'dompurify'
      DOMPurify.addHook = () => {}
      DOMPurify.sanitize = text => text
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({ startOnLoad: false })
      await mermaid.mermaidAPI.getDiagramFromText(${JSON.stringify(SOURCE)})
    `],
    cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
  })
  const parsed = parseRegisteredMermaid(SOURCE)
  if (!parsed.ok || parsed.value.body.kind !== 'journey') throw new Error('Journey extension did not parse structurally')
  const warning = verifyMermaid(parsed.value).warnings.find(item => item.code === 'UNSUPPORTED_SYNTAX'
    && item.syntax === 'journey_semicolon_statement_extension')
  const svg = renderMermaidSVG(SOURCE)
  const markerScores = [...svg.matchAll(/<g class="journey-score-marker" data-score="([^"]+)">/g)]
    .map(match => Number(match[1]))
  const serialized = serializeMermaid(parsed.value)
  const changed = mutate(parsed.value, { kind: 'set_task_score', sectionIndex: 0, taskIndex: 1, score: 4 })

  return {
    schemaVersion: 1,
    id: 'agentic-extension:journey:semicolon-statements',
    classification: 'agentic-extension',
    upstreamFeatureId: null,
    capabilityProjection: 'excluded-from-mermaid-native-features',
    upstream: {
      version: '11.16.0',
      revision: UPSTREAM_REVISION,
      acceptsSource: upstream.exitCode === 0,
      parseError: new TextDecoder().decode(upstream.stderr).includes('Parse error'),
    },
    source: SOURCE,
    surfaces: {
      agent: {
        disposition: warning ? 'diagnosed-extension' : 'undiagnosed',
        tasks: tasks(SOURCE),
        warningCode: warning?.code ?? null,
        warningLine: warning && 'line' in warning ? warning.line ?? null : null,
      },
      render: {
        disposition: markerScores.length === 2 ? 'rendered-extension' : 'not-rendered',
        markerScores,
        taskLabelsVisible: svg.includes('>A</text>') && svg.includes('>B</text>'),
      },
      serialize: {
        disposition: 'portable-newline-output',
        source: serialized,
        tasks: tasks(serialized),
        extensionWarningCleared: !verifyMermaid(serialized).warnings.some(item => item.code === 'UNSUPPORTED_SYNTAX'
          && item.syntax === 'journey_semicolon_statement_extension'),
      },
      mutate: {
        disposition: changed.ok ? 'portable-newline-output' : 'failed',
        source: changed.ok ? serializeMermaid(changed.value) : null,
        tasks: changed.ok ? tasks(serializeMermaid(changed.value)) : [],
      },
    },
  } as const
}
