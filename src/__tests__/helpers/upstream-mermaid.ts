// A long-lived child process that parses sources with the pinned upstream
// Mermaid (devDependency, 11.16.0) for grammar and differential oracles.
//
// Upstream's flowchart/class DBs call DOMPurify, which has no DOM under Bun.
// Like the fidelity probes (class-annotation-parity.test.ts), an identity
// sanitizer shim is isolated in a child process so the test process's module
// state never changes; this probes grammar/DB semantics, never output safety.
// One process serves many parses over a line protocol, so async fast-check
// properties can keep shrinking against upstream without a spawn per run.

import { join } from 'node:path'

export interface UpstreamFlowchartVertex {
  id: string
  text: string
  type?: string
}

export interface UpstreamFlowchartEdge {
  start: string
  end: string
  type?: string
  stroke?: string
  text: string
}

export interface UpstreamFlowchartSubgraph {
  id: string
  title: string
  nodes: string[]
}

export type UpstreamParse =
  | {
      ok: true
      type: string
      /** Present when the diagram DB exposes the flowchart vertex/edge API. */
      flowchart?: {
        vertices: UpstreamFlowchartVertex[]
        edges: UpstreamFlowchartEdge[]
        subgraphs: UpstreamFlowchartSubgraph[]
      }
    }
  | { ok: false; error: string }

export interface UpstreamMermaid {
  parse(source: string): Promise<UpstreamParse>
  close(): void
}

const REPO = join(import.meta.dir, '..', '..', '..')
// Replies carry a sentinel so any stray upstream console output on stdout
// cannot be mistaken for a reply.
const REPLY = '\u0001am-upstream\u0001'

const WORKER = `
import DOMPurify from 'dompurify'
DOMPurify.addHook = () => {}
DOMPurify.sanitize = text => text
const { default: mermaid } = await import('mermaid')
mermaid.initialize({ startOnLoad: false })
const REPLY = ${JSON.stringify(REPLY)}
function flowchart(db) {
  if (typeof db?.getVertices !== 'function' || typeof db?.getEdges !== 'function') return undefined
  return {
    vertices: [...db.getVertices().values()].map(v => ({ id: v.id, text: String(v.text ?? ''), type: v.type })),
    edges: db.getEdges().map(e => ({ start: e.start, end: e.end, type: e.type, stroke: e.stroke, text: String(e.text ?? '') })),
    subgraphs: (db.getSubGraphs?.() ?? []).map(s => ({ id: s.id, title: String(s.title ?? ''), nodes: [...s.nodes] })),
  }
}
const decoder = new TextDecoder()
let buffered = ''
for await (const chunk of Bun.stdin.stream()) {
  buffered += decoder.decode(chunk, { stream: true })
  for (let nl = buffered.indexOf('\\n'); nl >= 0; nl = buffered.indexOf('\\n')) {
    const line = buffered.slice(0, nl)
    buffered = buffered.slice(nl + 1)
    let reply
    try {
      const diagram = await mermaid.mermaidAPI.getDiagramFromText(JSON.parse(line))
      reply = { ok: true, type: diagram.type, flowchart: flowchart(diagram.db) }
    } catch (error) {
      reply = { ok: false, error: String(error?.message ?? error).split('\\n')[0] }
    }
    process.stdout.write(REPLY + JSON.stringify(reply) + '\\n')
  }
}
`

export function startUpstreamMermaid(): UpstreamMermaid {
  const child = Bun.spawn({
    cmd: [process.execPath, '-e', WORKER],
    cwd: REPO,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  })
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  // Requests are strictly serialized: one line out, one reply back.
  let queue: Promise<unknown> = Promise.resolve()

  async function readReply(): Promise<UpstreamParse> {
    for (;;) {
      const nl = buffered.indexOf('\n')
      if (nl >= 0) {
        const line = buffered.slice(0, nl)
        buffered = buffered.slice(nl + 1)
        if (line.startsWith(REPLY)) return JSON.parse(line.slice(REPLY.length)) as UpstreamParse
        continue
      }
      const { value, done } = await reader.read()
      if (done) throw new Error(`upstream Mermaid worker exited (code ${await child.exited})`)
      buffered += decoder.decode(value, { stream: true })
    }
  }

  return {
    parse(source: string): Promise<UpstreamParse> {
      const next = queue.then(() => {
        child.stdin.write(`${JSON.stringify(source)}\n`)
        child.stdin.flush()
        return readReply()
      })
      queue = next.catch(() => undefined)
      return next
    },
    close(): void {
      child.stdin.end()
      child.kill()
    },
  }
}
