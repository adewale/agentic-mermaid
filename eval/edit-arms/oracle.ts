// Independent semantic oracle for the edit-arms evaluation.
//
// Every model here comes from upstream Mermaid's own parser and diagram DB —
// the pinned 12.2.0 reference installation run in a separate Node/jsdom
// process (eval/mermaid-modern-compat/reference-worker.mjs). Nothing in this
// file imports Agentic Mermaid's parser, IR or serializer, so the scorer cannot
// inherit a defect from the product it is judging.
//
// A model is a list of facts. Each fact is a small tuple ("kind" plus string
// arguments) with element identities marked, so the scorer can rename elements
// that did not exist before the edit (see `finalizeFacts`). Attribute facts name
// an owner fact: when the owner is new, unrequested presentation details of a
// new element (shape, class, parent) are free unless a task makes them strict.

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { currentReferencePin, startModernReference, type Json, type ReferenceReply } from '../mermaid-modern-compat/reference.ts'

const ROOT = resolve(import.meta.dir, '../..')

export const DEFAULT_REFERENCE_DIR = resolve(process.env.MERMAID_REFERENCE_DIR ?? join(ROOT, '../mermaid-reference'))

/** An element identity inside a fact; rewritten when the element is new. */
export interface IdRef { readonly id: string }
type Part = string | IdRef
export interface RawFact { kind: string; parts: Part[]; owner?: RawFact }
export interface Fact { kind: string; key: string; owner?: string }

/** How much of the family's meaning the projection exposes. */
export type CheckStrength = 'full' | 'weaker'

export interface SemanticModel {
  /** Mermaid's own diagram type name, e.g. `flowchart-v2`. */
  type: string
  family: string
  strength: CheckStrength
  /** What the projection does not see, stated for the report. */
  limitations: string[]
  /** Identity-bearing elements and their display text. */
  elements: Map<string, string>
  raw: RawFact[]
}

export type OracleParse = { ok: true; model: SemanticModel } | { ok: false; error: string }

export interface Oracle {
  readonly mermaidVersion: string
  parse(source: string): Promise<OracleParse>
  close(): void
}

/** Start the pinned Mermaid reference. Refuses any version other than the policy pin. */
export function startOracle(referenceDir = DEFAULT_REFERENCE_DIR): Oracle {
  let version: string
  try {
    const require = createRequire(join(referenceDir, 'package.json'))
    version = (JSON.parse(readFileSync(require.resolve('mermaid/package.json'), 'utf8')) as { version: string }).version
  } catch {
    throw new Error(`No Mermaid reference installation at ${referenceDir}. Run \`bun run reference:mermaid\` or set MERMAID_REFERENCE_DIR.`)
  }
  if (version !== currentReferencePin.version) {
    throw new Error(`The edit-arms oracle requires Mermaid ${currentReferencePin.version} (docs/project/upstream-mermaid-policy.json); ${referenceDir} has ${version}`)
  }
  const reference = startModernReference(referenceDir)
  const cache = new Map<string, Promise<OracleParse>>()
  return {
    mermaidVersion: version,
    parse(source) {
      let hit = cache.get(source)
      if (!hit) {
        hit = reference.parse(source).then(reply => project(reply))
        cache.set(source, hit)
      }
      return hit
    },
    close: () => reference.close(),
  }
}

// ---------------------------------------------------------------------------
// Projection helpers

const id = (value: unknown): IdRef => ({ id: String(value) })
const fact = (kind: string, parts: Part[], owner?: RawFact): RawFact => ({ kind, parts, owner })

/** Display text: `<br>` is a line break; runs of blanks collapse; ends trimmed. */
export function normText(value: unknown): string {
  if (value === undefined || value === null) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .trim()
}

type Obj = Record<string, Json>
const obj = (value: Json | undefined): Obj => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})
const arr = (value: Json | undefined): Json[] => (Array.isArray(value) ? value : [])
const str = (value: Json | undefined): string => (value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value))
/** Map-valued getters arrive as `[key, value]` pairs. */
const entries = (value: Json | undefined): Array<[string, Obj]> => arr(value).map(pair => [str(arr(pair)[0]), obj(arr(pair)[1])])

function commonFacts(data: Obj): RawFact[] {
  const out: RawFact[] = []
  for (const [getter, kind] of [['getDiagramTitle', 'title'], ['getAccTitle', 'accTitle'], ['getAccDescription', 'accDescr']] as const) {
    const value = normText(data[getter])
    if (value) out.push(fact(kind, [value]))
  }
  return out
}

function classDefFacts(data: Obj): RawFact[] {
  return entries(data.getClasses).map(([name, def]) => fact('classDef', [name, arr(def.styles).map(str).join(';'), arr(def.textStyles).map(str).join(';')]))
}

const userClasses = (value: Json | undefined, ignore: RegExp): string[] =>
  str(value).split(/\s+/).filter(c => c && !ignore.test(c))

// ---------------------------------------------------------------------------
// Family projections. Each states what it reads; anything not read is listed in
// `limitations` so the report can say which changes the oracle cannot see.

function flowchart(data: Obj): Omit<SemanticModel, 'type'> {
  const raw: RawFact[] = [...commonFacts(data), ...classDefFacts(data)]
  const elements = new Map<string, string>()
  if (str(data.getDirection)) raw.push(fact('direction', [str(data.getDirection)]))
  const nodes = arr(obj(data.getData).nodes).map(obj)
  // A subgraph declared by title alone gets a counter id (subGraph0, …) that
  // shifts when another subgraph is added earlier; identify it by its title.
  const generated = new Map(nodes.filter(n => n.isGroup && /^subGraph\d+$/.test(str(n.id))).map(n => [str(n.id), `subgraph "${normText(n.label)}"`]))
  const gid = (value: Json | undefined) => id(generated.get(str(value)) ?? str(value))
  for (const n of nodes) {
    const nid = generated.get(str(n.id)) ?? str(n.id)
    const label = normText(n.label)
    elements.set(nid, label || nid)
    const own = fact(n.isGroup ? 'subgraph' : 'node', [id(nid)])
    raw.push(own)
    raw.push(fact('label', [id(nid), label], own))
    if (!n.isGroup) raw.push(fact('shape', [id(nid), str(n.shape)], own))
    if (str(n.parentId)) raw.push(fact('parent', [id(nid), gid(n.parentId)], own))
    for (const c of userClasses(n.cssClasses, /^(default|clickable)$/)) raw.push(fact('class', [id(nid), c], own))
    const styles = arr(n.cssStyles).map(str).filter(Boolean)
    if (styles.length) raw.push(fact('style', [id(nid), styles.join(';')], own))
    if (str(n.link)) raw.push(fact('link', [id(nid), str(n.link)], own))
  }
  for (const e of arr(data.getEdges).map(obj)) {
    const core = fact('edge', [id(e.start), id(e.end), normText(e.text)])
    raw.push(core)
    raw.push(fact('edgeKind', [id(e.start), id(e.end), normText(e.text), `${str(e.type)}/${str(e.stroke)}`], core))
    const styles = arr(e.style).map(str).filter(Boolean)
    if (styles.length) raw.push(fact('edgeStyle', [id(e.start), id(e.end), normText(e.text), styles.join(';')], core))
  }
  return { family: 'flowchart', strength: 'full', elements, raw, limitations: ['`linkStyle default`, init directives and theme config are not exposed by the flowchart DB; only the source-preservation sub-metrics see them', 'edge minimum length (`--->`) is ignored as layout'] }
}

function sequence(data: Obj): Omit<SemanticModel, 'type'> {
  const raw: RawFact[] = [...commonFacts(data)]
  const elements = new Map<string, string>()
  const actors = entries(data.getActors)
  for (const [key, a] of actors) {
    elements.set(key, normText(a.description) || key)
    const own = fact('participant', [id(key)])
    raw.push(own)
    raw.push(fact('participantKind', [id(key), str(a.type)], own))
    raw.push(fact('participantLabel', [id(key), normText(a.description)], own))
  }
  const order = arr(data.getActorKeys).map(str)
  for (let i = 1; i < order.length; i++) raw.push(fact('participantNext', [id(order[i - 1]), id(order[i])]))
  for (const box of arr(data.getBoxes).map(obj)) raw.push(fact('box', [normText(box.name), ...arr(box.actorKeys).map(k => id(k))]))
  for (const name of arr(data.getCreatedActors)) raw.push(fact('created', [str(name)]))
  for (const name of arr(data.getDestroyedActors)) raw.push(fact('destroyed', [str(name)]))
  // Messages, notes, activations and block markers form one ordered stream.
  // Each item is a fact; `next` facts fix their order, so an insertion in the
  // wrong place or a reordering elsewhere is visible.
  // A message's arrow style is an attribute of the message, so a new message
  // whose style the request leaves open is not penalised for it.
  const items: Part[][] = []
  for (const m of arr(data.getMessages).map(obj)) {
    const type = str(m.type)
    let item: Part[]
    if (m.from !== undefined && m.to !== undefined && type === '2') item = ['note', str(m.placement), id(m.from), id(m.to), normText(m.message)]
    else if (m.from !== undefined && m.to !== undefined) item = ['message', id(m.from), id(m.to), normText(m.message)]
    else if (m.from !== undefined) item = ['activation', type, id(m.from)]
    else item = ['control', type, normText(m.message)]
    items.push(item)
    const own = fact(String(item[0]), item.slice(1))
    raw.push(own)
    if (item[0] === 'message') raw.push(fact('messageKind', [...item.slice(1), type], own))
  }
  for (let i = 1; i < items.length; i++) raw.push(fact('next', [...items[i - 1]!, '→', ...items[i]!]))
  return { family: 'sequence', strength: 'full', elements, raw, limitations: ['message wrap flags, links and actor properties are ignored', 'init directives and theme config are not exposed'] }
}

function classDiagram(data: Obj): Omit<SemanticModel, 'type'> {
  // In the class DB `getClasses` is the class map itself, not classDef styles.
  const raw: RawFact[] = [...commonFacts(data)]
  const elements = new Map<string, string>()
  if (str(data.getDirection)) raw.push(fact('direction', [str(data.getDirection)]))
  for (const [key, c] of entries(data.getClasses)) {
    elements.set(key, normText(c.label) || key)
    const own = fact('class', [id(key)])
    raw.push(own)
    raw.push(fact('classLabel', [id(key), normText(c.label)], own))
    if (str(c.type)) raw.push(fact('generic', [id(key), str(c.type)]))
    for (const a of arr(c.annotations)) raw.push(fact('annotation', [id(key), normText(a)]))
    for (const m of arr(c.members).map(obj)) raw.push(fact('member', [id(key), normText(m.text)]))
    for (const m of arr(c.methods).map(obj)) raw.push(fact('method', [id(key), normText(m.text)]))
    if (str(c.parent)) raw.push(fact('namespace', [id(key), str(c.parent)], own))
    for (const k of userClasses(c.cssClasses, /^default$/)) raw.push(fact('cssClass', [id(key), k], own))
    const styles = arr(c.styles).map(str).filter(Boolean)
    if (styles.length) raw.push(fact('style', [id(key), styles.join(';')], own))
  }
  for (const r of arr(data.getRelations).map(obj)) {
    const rel = obj(r.relation)
    const core = fact('relation', [id(r.id1), id(r.id2), normText(r.title), normText(r.relationTitle1), normText(r.relationTitle2)])
    raw.push(core)
    raw.push(fact('relationKind', [id(r.id1), id(r.id2), normText(r.title), `${str(rel.type1)}/${str(rel.lineType)}/${str(rel.type2)}`], core))
  }
  for (const [, n] of entries(data.getNotes)) raw.push(fact('note', [n.class === undefined ? '' : id(n.class), normText(n.text)]))
  return { family: 'class', strength: 'full', elements, raw, limitations: ['member order inside a class is ignored', 'click/link/callback statements are ignored'] }
}

function stateDiagram(data: Obj): Omit<SemanticModel, 'type'> {
  const raw: RawFact[] = [...commonFacts(data), ...classDefFacts(data)]
  const elements = new Map<string, string>()
  if (str(data.getDirection)) raw.push(fact('direction', [str(data.getDirection)]))
  const graph = obj(data.getData)
  const nodes = arr(graph.nodes).map(obj)
  const byId = new Map(nodes.map(n => [str(n.id), n]))
  // Pseudo-states and notes carry generated ids; name them by what they mean.
  const nameOf = (raw: string): string => {
    const n = byId.get(raw)
    if (!n) return raw
    const parent = str(n.parentId) || 'root'
    if (str(n.shape) === 'stateStart') return `[*]start@${parent}`
    if (str(n.shape) === 'stateEnd') return `[*]end@${parent}`
    return raw
  }
  const notes = new Map<string, string>()
  for (const n of nodes) {
    const raw0 = str(n.id)
    if (str(n.shape) === 'note' || str(n.shape) === 'noteGroup') { notes.set(raw0, normText(n.label)); continue }
    const sid = nameOf(raw0)
    const label = normText(n.label)
    elements.set(sid, label || sid)
    const own = fact(n.isGroup ? 'composite' : 'state', [id(sid)])
    raw.push(own)
    if (!sid.startsWith('[*]')) raw.push(fact('stateLabel', [id(sid), label], own))
    raw.push(fact('stateShape', [id(sid), str(n.shape)], own))
    if (str(n.parentId) && !sid.startsWith('[*]')) raw.push(fact('parent', [id(sid), id(n.parentId)], own))
    for (const c of userClasses(n.cssClasses, /^statediagram-/)) raw.push(fact('class', [id(sid), c], own))
    const styles = arr(n.cssStyles).map(str).filter(Boolean)
    if (styles.length) raw.push(fact('style', [id(sid), styles.join(';')], own))
  }
  for (const e of arr(graph.edges).map(obj)) {
    const start = str(e.start)
    const end = str(e.end)
    if (notes.has(end)) { raw.push(fact('note', [id(nameOf(start)), notes.get(end)!])); continue }
    if (notes.has(start)) { raw.push(fact('note', [id(nameOf(end)), notes.get(start)!])); continue }
    raw.push(fact('transition', [id(nameOf(start)), id(nameOf(end)), normText(e.label)]))
  }
  return { family: 'state', strength: 'full', elements, raw, limitations: ['note placement (left/right) is ignored; note text and target are checked', 'start/end pseudo-states are identified by their enclosing composite'] }
}

function erDiagram(data: Obj): Omit<SemanticModel, 'type'> {
  const raw: RawFact[] = [...commonFacts(data), ...classDefFacts(data)]
  const elements = new Map<string, string>()
  if (str(data.getDirection)) raw.push(fact('direction', [str(data.getDirection)]))
  const nameByInternal = new Map<string, string>()
  for (const [name, e] of entries(data.getEntities)) {
    nameByInternal.set(str(e.id), name)
    elements.set(name, normText(e.alias) || name)
    const own = fact('entity', [id(name)])
    raw.push(own)
    if (str(e.alias)) raw.push(fact('entityAlias', [id(name), normText(e.alias)], own))
    for (const a of arr(e.attributes).map(obj)) raw.push(fact('attribute', [id(name), str(a.type), str(a.name), arr(a.keys).map(str).join(','), normText(a.comment)]))
    for (const c of userClasses(e.cssClasses, /^default$/)) raw.push(fact('class', [id(name), c], own))
    const styles = arr(e.cssStyles).map(str).filter(Boolean)
    if (styles.length) raw.push(fact('style', [id(name), styles.join(';')], own))
  }
  for (const r of arr(data.getRelationships).map(obj)) {
    const spec = obj(r.relSpec)
    const a = nameByInternal.get(str(r.entityA)) ?? str(r.entityA)
    const b = nameByInternal.get(str(r.entityB)) ?? str(r.entityB)
    raw.push(fact('relationship', [id(a), id(b), str(spec.cardA), str(spec.cardB), str(spec.relType), normText(r.roleA)]))
  }
  return { family: 'er', strength: 'full', elements, raw, limitations: ['attribute order inside an entity is ignored'] }
}

function gantt(data: Obj): Omit<SemanticModel, 'type'> {
  const raw: RawFact[] = [...commonFacts(data)]
  for (const [getter, name] of [['getDateFormat', 'dateFormat'], ['getAxisFormat', 'axisFormat'], ['getTodayMarker', 'todayMarker'], ['getDisplayMode', 'displayMode'], ['getWeekday', 'weekday']] as const) {
    if (str(data[getter])) raw.push(fact('setting', [name, str(data[getter])]))
  }
  for (const v of arr(data.getExcludes)) raw.push(fact('exclude', [str(v)]))
  for (const v of arr(data.getIncludes)) raw.push(fact('include', [str(v)]))
  const sections = arr(data.getSections).map(str)
  for (const s of sections) raw.push(fact('section', [normText(s)]))
  for (let i = 1; i < sections.length; i++) raw.push(fact('sectionNext', [normText(sections[i - 1]), normText(sections[i])]))
  const tasks = arr(data.getTasks).map(obj)
  // A date-less dateFormat (e.g. HH:mm) places tasks on the day the parser
  // runs. Measure such times from the earliest task's midnight instead, so the
  // facts do not depend on the wall clock.
  const dateless = !/[YMDQWwdEgGXx]/.test(str(data.getDateFormat))
  const starts = tasks.map(t => Date.parse(str(t.startTime))).filter(Number.isFinite)
  const anchor = starts.length ? new Date(Math.min(...starts)).setUTCHours(0, 0, 0, 0) : 0
  const time = (value: Json | undefined) => {
    const ms = Date.parse(str(value))
    return dateless && Number.isFinite(ms) ? `+${ms - anchor}ms` : str(value)
  }
  const names: string[] = []
  for (const t of tasks) {
    const name = normText(t.task)
    names.push(name)
    raw.push(fact('task', [name, normText(t.section)]))
    raw.push(fact('taskTime', [name, time(t.startTime), time(t.endTime)]))
    const flags = ['milestone', 'crit', 'active', 'done', 'vert'].filter(f => t[f] === true || arr(t.classes).map(str).includes(f))
    if (flags.length) raw.push(fact('taskFlags', [name, flags.join(',')]))
    // Generated ids (task1, task2, …) are counters; only authored ids are facts.
    const authored = str(obj(t.raw).data).replace(/^:/, '').split(',').map(s => s.trim())
    if (authored.includes(str(t.id))) raw.push(fact('taskId', [name, str(t.id)]))
  }
  for (let i = 1; i < names.length; i++) raw.push(fact('taskNext', [names[i - 1]!, names[i]!]))
  return { family: 'gantt', strength: 'full', elements: new Map(), raw, limitations: ['tasks are identified by their text; computed start/end times are compared, not the authored expressions', 'tickInterval and frontmatter display config other than displayMode are not exposed'] }
}

function pie(data: Obj): Omit<SemanticModel, 'type'> {
  const raw: RawFact[] = [...commonFacts(data)]
  if (data.getShowData === true) raw.push(fact('showData', ['true']))
  for (const pair of arr(data.getSections)) raw.push(fact('slice', [normText(arr(pair)[0]), str(arr(pair)[1])]))
  return { family: 'pie', strength: 'weaker', elements: new Map(), raw, limitations: ['the reference snapshot sorts slices by label, so slice order is not checked'] }
}

function gitGraph(data: Obj): Omit<SemanticModel, 'type'> {
  const raw: RawFact[] = [...commonFacts(data)]
  if (str(data.getDirection)) raw.push(fact('direction', [str(data.getDirection)]))
  const branches = arr(data.getBranchesAsObjArray).map(b => str(obj(b).name))
  for (const b of branches) raw.push(fact('branch', [b]))
  for (let i = 1; i < branches.length; i++) raw.push(fact('branchNext', [branches[i - 1]!, branches[i]!]))
  // Commits without an authored id get random ids; name them branch#ordinal.
  const commits = arr(data.getCommitsArray).map(obj)
  const perBranch = new Map<string, number>()
  const nameOf = new Map<string, string>()
  for (const c of commits) {
    const branch = str(c.branch)
    const n = (perBranch.get(branch) ?? 0) + 1
    perBranch.set(branch, n)
    const custom = c.customId === true || !/^\d+-[0-9a-f]{7}$/.test(str(c.id))
    nameOf.set(str(c.id), custom ? str(c.id) : `${branch}#${n}`)
  }
  for (const c of commits) {
    const name = nameOf.get(str(c.id))!
    raw.push(fact('commit', [name, str(c.branch), str(c.type), normText(c.message), arr(c.tags).map(str).join(',')]))
    for (const p of arr(c.parents)) raw.push(fact('commitParent', [name, nameOf.get(str(p)) ?? str(p)]))
  }
  return { family: 'gitGraph', strength: 'full', elements: new Map(), raw, limitations: ['commits without an authored id are identified by branch and ordinal, so inserting one earlier on a branch renames the later ones', 'init directives (including mainBranchName) are applied by the parser but theme options are not exposed'] }
}

/**
 * Weaker fallback for families without a projection: every leaf of the DB
 * snapshot is a fact keyed by its JSON path. It detects that something changed
 * but cannot tell an intended change from collateral by element.
 */
function generic(family: string, data: Obj): Omit<SemanticModel, 'type'> {
  const raw: RawFact[] = []
  const walk = (value: Json, path: string) => {
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`))
      else for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`)
    } else raw.push(fact('leaf', [path, str(value)]))
  }
  walk(data, '$')
  return { family, strength: 'weaker', elements: new Map(), raw, limitations: ['generic DB-snapshot diff: no element identities, positional paths'] }
}

export function project(reply: ReferenceReply): OracleParse {
  if (!reply.ok) return { ok: false, error: reply.error }
  const data = reply.snapshot.data as Obj
  const type = reply.type
  const base = type === 'flowchart-v2' || type === 'flowchart' ? flowchart(data)
    : type === 'sequence' ? sequence(data)
    : type === 'classDiagram' || type === 'class' ? classDiagram(data)
    : type === 'stateDiagram' || type === 'state' ? stateDiagram(data)
    : type === 'er' ? erDiagram(data)
    : type === 'gantt' ? gantt(data)
    : type === 'pie' ? pie(data)
    : type === 'gitGraph' ? gitGraph(data)
    : generic(type, data)
  return { ok: true, model: { type, ...base } }
}

/**
 * Serialize facts. Element ids absent from `knownIds` (the pre-edit diagram's
 * elements) are new: they are renamed to `+<display text>`, so two correct
 * edits that chose different ids for the same new element compare equal.
 */
export function finalizeFacts(model: SemanticModel, knownIds: ReadonlySet<string>): Fact[] {
  const rename = (ref: IdRef) => (knownIds.has(ref.id) ? ref.id : `+${model.elements.get(ref.id) ?? ref.id}`)
  const key = (f: RawFact) => JSON.stringify([f.kind, ...f.parts.map(p => (typeof p === 'string' ? p : rename(p)))])
  return model.raw.map(f => ({ kind: f.kind, key: key(f), owner: f.owner ? key(f.owner) : undefined }))
}
