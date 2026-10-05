// A long-lived child process that parses sources with the pinned upstream
// Mermaid (devDependency, 11.16.0) for grammar and differential oracles.
//
// Upstream's flowchart/class DBs call DOMPurify, which has no DOM under Bun.
// An identity sanitizer shim is isolated in a child process so the test
// process's module state never changes; this probes grammar/DB semantics,
// never output safety. One process serves many parses over a line protocol,
// so async fast-check properties can keep shrinking against upstream without
// a spawn per run, and a fidelity test never waits on a synchronous spawn.

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

export interface UpstreamSequenceActor {
  name: string
  description: string
  type: string
  /** The actor's menu links (label → href), as upstream stores them. */
  links: Record<string, string>
}

export interface UpstreamSequenceMessage {
  from?: string
  to?: string
  message: string
  /** Upstream LINETYPE: arrows, notes and block open/close markers share it. */
  type: number
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
      /** Present when the diagram DB exposes the sequence actor/message API. */
      sequence?: {
        actors: UpstreamSequenceActor[]
        messages: UpstreamSequenceMessage[]
      }
    }
  | { ok: false; error: string }

/** The diagram `getDiagramFromText` returns, as a projection receives it. */
export interface UpstreamDiagram {
  type: string
  text: string
  // Upstream's per-family DB and parser: untyped, as each probe reads its own getters.
  db: any
  parser: any
}

export type UpstreamProjection<T> = { ok: true; value: T } | { ok: false; error: string }

export interface UpstreamMermaid {
  parse(source: string): Promise<UpstreamParse>
  /** Whether upstream parses `source` without error. */
  accepts(source: string): Promise<boolean>
  /** What `projection` returns for the parsed diagram (it may be async), or
   * the rejection. The projection runs in the worker: it is sent as source
   * text, so it may use only its argument and globals, never a test's
   * variables, and must return plain JSON (spread a Map or Set). */
  project<T>(source: string, projection: (diagram: UpstreamDiagram) => T | Promise<T>): Promise<UpstreamProjection<T>>
  /** `project` over each source in order, in one round trip. */
  projectEach<T>(sources: readonly string[], projection: (diagram: UpstreamDiagram) => T | Promise<T>): Promise<Array<UpstreamProjection<T>>>
  /** `projectEach` for sources upstream must accept: a rejection throws,
   * naming the source. */
  projectAll<T>(sources: readonly string[], projection: (diagram: UpstreamDiagram) => T | Promise<T>): Promise<T[]>
  /** Plain JSON of the diagram DB's getters (titles, sections, tasks, axes,
   * commits, ...) for families without a dedicated projection above, or
   * undefined when Mermaid rejects the source. GitGraph's random commit ids
   * are masked so two parses of one source compare equal. */
  database(source: string): Promise<string | undefined>
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
function sequence(db) {
  if (typeof db?.getActors !== 'function' || typeof db?.getMessages !== 'function') return undefined
  return {
    actors: [...db.getActors().values()].map(a => ({ name: a.name, description: String(a.description ?? ''), type: String(a.type ?? ''), links: { ...a.links } })),
    messages: db.getMessages().map(m => ({ from: m.from, to: m.to, message: String(m.message ?? ''), type: m.type })),
  }
}
const DB_GETTERS = ['getDiagramTitle', 'getAccTitle', 'getAccDescription', 'getSections', 'getShowData', 'getTasks',
  'getDateFormat', 'getAxisFormat', 'getTickInterval', 'getTodayMarker', 'topAxisEnabled', 'getDisplayMode', 'getIncludes',
  'getExcludes', 'getWeekday', 'getXYChartData', 'getQuadrantData', 'getAxes', 'getCurves', 'getOptions', 'getServices',
  'getGroups', 'getJunctions', 'getEdges', 'getCommits', 'getBranches', 'getDirection', 'getEntities', 'getRelationships']
function plain(value, depth = 0) {
  if (depth > 8) return '...'
  if (value instanceof Map) return [...value].map(([key, entry]) => [key, plain(entry, depth + 1)])
  if (value instanceof Set) return [...value].map(entry => plain(entry, depth + 1))
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(entry => plain(entry, depth + 1))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, entry] of Object.entries(value)) if (typeof entry !== 'function' && key !== 'domId' && key !== 'parent') out[key] = plain(entry, depth + 1)
    return out
  }
  return value
}
function database(db) {
  const out = {}
  for (const getter of DB_GETTERS) {
    if (typeof db?.[getter] !== 'function') continue
    try { out[getter] = plain(db[getter]()) } catch { /* not this family's getter */ }
  }
  return JSON.stringify(out).replace(/\\b\\d+-[0-9a-f]{7}\\b/g, '<commit>')
}
const failure = error => ({ ok: false, error: String(error?.message ?? error).split('\\n')[0] })
async function project(sources, projection) {
  const results = []
  for (const source of sources) {
    try {
      results.push({ ok: true, value: await projection(await mermaid.mermaidAPI.getDiagramFromText(source)) })
    } catch (error) {
      results.push(failure(error))
    }
  }
  return results
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
      const request = JSON.parse(line)
      if (typeof request.projection === 'string') {
        reply = { ok: true, results: await project(request.sources, (0, eval)('(' + request.projection + ')')) }
      } else {
        const source = typeof request === 'string' ? request : request.source
        const diagram = await mermaid.mermaidAPI.getDiagramFromText(source)
        reply = typeof request === 'string'
          ? { ok: true, type: diagram.type, flowchart: flowchart(diagram.db), sequence: sequence(diagram.db) }
          : { ok: true, type: diagram.type, database: database(diagram.db) }
      }
    } catch (error) {
      reply = failure(error)
    }
    process.stdout.write(REPLY + JSON.stringify(reply) + '\\n')
  }
}
`

type UpstreamReply = UpstreamParse & { database?: string; results?: Array<UpstreamProjection<unknown>> }

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

  async function readReply(): Promise<UpstreamReply> {
    for (;;) {
      const nl = buffered.indexOf('\n')
      if (nl >= 0) {
        const line = buffered.slice(0, nl)
        buffered = buffered.slice(nl + 1)
        if (line.startsWith(REPLY)) return JSON.parse(line.slice(REPLY.length)) as UpstreamReply
        continue
      }
      const { value, done } = await reader.read()
      if (done) throw new Error(`upstream Mermaid worker exited (code ${await child.exited})`)
      buffered += decoder.decode(value, { stream: true })
    }
  }

  function request(payload: unknown): Promise<UpstreamReply> {
    const next = queue.then(() => {
      child.stdin.write(`${JSON.stringify(payload)}\n`)
      child.stdin.flush()
      return readReply()
    })
    queue = next.catch(() => undefined)
    return next
  }

  async function projectEach<T>(sources: readonly string[], projection: (diagram: UpstreamDiagram) => T | Promise<T>): Promise<Array<UpstreamProjection<T>>> {
    const reply = await request({ sources, projection: projection.toString() })
    if (!reply.ok) throw new Error(`upstream Mermaid worker could not run the projection: ${reply.error}`)
    return reply.results as Array<UpstreamProjection<T>>
  }

  return {
    parse(source: string): Promise<UpstreamParse> {
      return request(source)
    },
    async accepts(source: string): Promise<boolean> {
      return (await request(source)).ok
    },
    async project<T>(source: string, projection: (diagram: UpstreamDiagram) => T | Promise<T>): Promise<UpstreamProjection<T>> {
      return (await projectEach([source], projection))[0]!
    },
    projectEach,
    async projectAll<T>(sources: readonly string[], projection: (diagram: UpstreamDiagram) => T | Promise<T>): Promise<T[]> {
      return (await projectEach(sources, projection)).map((reply, index) => {
        if (!reply.ok) throw new Error(`upstream Mermaid rejected ${JSON.stringify(sources[index])}: ${reply.error}`)
        return reply.value
      })
    },
    async database(source: string): Promise<string | undefined> {
      const reply = await request({ source })
      return reply.ok ? reply.database : undefined
    },
    close(): void {
      child.stdin.end()
      child.kill()
    },
  }
}
