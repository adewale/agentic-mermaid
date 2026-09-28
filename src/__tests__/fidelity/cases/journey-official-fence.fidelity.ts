import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { renderMermaidSVG } from '../../../index.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../../../upstream-mermaid-manifest.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

const page = readFileSync(join(import.meta.dir, '..', '..', '..', '..', 'skills/agentic-mermaid-diagram-workflow/references/upstream/userJourney.md'), 'utf8')
const sources = [...page.matchAll(/^```mermaid(?:-example)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```[^\S\r\n]*$/gm)]
  .map(match => match[1]!.trim()).filter((source, index, all) => all.indexOf(source) === index)
const manifestExamples = UPSTREAM_MERMAID_MANIFEST.semanticInventory.examples
  .filter(example => example.origin === 'official-syntax/userJourney.md' && example.family === 'journey')
if (sources.length !== 1 || manifestExamples.length !== 1
  || manifestExamples[0]!.id !== 'journey:official-syntax/userJourney.md#0'
  || manifestExamples[0]!.sourceSha256 !== createHash('sha256').update(sources[0]!).digest('hex')) {
  throw new Error('Pinned Journey official-fence inventory changed; review the authored example')
}
const source = sources[0]!
const tasks = [
  { text: 'Make tea', score: 5, actors: ['Me'] },
  { text: 'Go upstairs', score: 3, actors: ['Me'] },
  { text: 'Do work', score: 1, actors: ['Me', 'Cat'] },
  { text: 'Go downstairs', score: 5, actors: ['Me'] },
  { text: 'Sit down', score: 5, actors: ['Me'] },
] as const
const sections = [
  { label: 'Go to work', taskIndexes: [0, 1, 2] },
  { label: 'Go home', taskIndexes: [3, 4] },
] as const

function record(value: FidelityJson | undefined): Readonly<Record<string, FidelityJson>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Journey evidence must be an object')
  return value as Readonly<Record<string, FidelityJson>>
}
function semantic(evidence: ObservedFidelitySurfaceEvidence): Readonly<Record<string, FidelityJson>> {
  return record(evidence.semantics)
}
function same(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key, canonical(item)]))
      : value
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}
function attrs(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g)].map(match => [match[1]!, match[2]!]))
}
function elements(svg: string, tag: string, className: string): { attributes: Record<string, string>; text: string }[] {
  return [...svg.matchAll(new RegExp(`<${tag}\\b[^>]*>(?:[^<]*<\\/${tag}>)?`, 'g'))]
    .map(match => ({ attributes: attrs(match[0]), text: match[0].match(new RegExp(`>([^<]*)<\\/${tag}>$`))?.[1] ?? '' }))
    .filter(item => (item.attributes.class ?? '').split(/\s+/).includes(className))
}
function modelFacts(text: string): FidelityJson {
  const parsed = parseRegisteredMermaid(text)
  if (!parsed.ok || parsed.value.body.kind !== 'journey') return { kind: parsed.ok ? parsed.value.body.kind : 'parse-failure' }
  return { title: parsed.value.body.title ?? null,
    sections: parsed.value.body.sections.map(section => ({ label: section.label ?? null,
      tasks: section.tasks.map(task => ({ text: task.text, score: task.score, actors: task.actors })) })) }
}
function curveFacts(d: string): FidelityJson {
  const number = '-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)'
  const grammar = new RegExp(`^M${number},${number}(?: C${number},${number} ${number},${number} ${number},${number}){4}$`)
  if (!grammar.test(d)) return { validShape: false }
  const start = d.match(/^M(-?[\d.]+),(-?[\d.]+)/)!
  const segments = [...d.matchAll(/ C(-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+)/g)]
  return { validShape: true, points: [[Number(start[1]), Number(start[2])],
    ...segments.map(match => [Number(match[5]), Number(match[6])])],
  controls: segments.flatMap(match => [[Number(match[1]), Number(match[2])], [Number(match[3]), Number(match[4])]]) }
}
function renderFacts(svg: string): FidelityJson {
  const sectionBlocks = [...svg.matchAll(/<g class="journey-section"([^>]*)>([\s\S]*?)\n<\/g>/g)]
  const taskBlocks = [...svg.matchAll(/<g class="journey-task"([^>]*)>([\s\S]*?)\n<\/g>/g)]
  const title = elements(svg, 'text', 'journey-title')[0]
  const curve = elements(svg, 'path', 'journey-curve')[0]
  return {
    viewBox: svg.match(/<svg\b[^>]*viewBox="([^"]+)"/)?.[1] ?? null,
    accessibilityTitle: svg.match(/<title id="([^"]+)">([^<]*)<\/title>/)?.slice(1) ?? null,
    ariaLabelledBy: svg.match(/<svg\b[^>]*aria-labelledby="([^"]+)"/)?.[1] ?? null,
    title: title ? { text: title.text, x: Number(title.attributes.x), y: Number(title.attributes.y) } : null,
    sections: sectionBlocks.map(([, attributeText, body]) => {
      const section = attrs(attributeText!)
      const rect = elements(body!, 'rect', 'journey-section-bg')[0]
      const label = elements(body!, 'text', 'journey-section-label')[0]
      return { id: section['data-id'] ?? null, label: section['data-label'] ?? null,
        role: section['data-role'] ?? null, text: label?.text ?? null,
        box: rect ? { x: Number(rect.attributes.x), y: Number(rect.attributes.y),
          width: Number(rect.attributes.width), height: Number(rect.attributes.height) } : null }
    }),
    tasks: taskBlocks.map(([, attributeText, body]) => {
      const task = attrs(attributeText!)
      const box = elements(body!, 'rect', 'journey-task-box')[0]
      const text = elements(body!, 'text', 'journey-task-text')[0]
      const face = elements(body!, 'circle', 'journey-score-face')[0]
      const track = elements(body!, 'line', 'journey-track')[0]
      const marker = body!.match(/<g class="journey-score-marker" data-score="([^"]+)"/)
      return { id: task['data-id'] ?? null, role: task['data-role'] ?? null,
        score: Number(task['data-score']), section: task['data-section'] ?? null,
        actors: task['data-actors'] ?? null, text: text?.text ?? null,
        textX: Number(text?.attributes.x), textY: Number(text?.attributes.y),
        box: box ? { x: Number(box.attributes.x), y: Number(box.attributes.y),
          width: Number(box.attributes.width), height: Number(box.attributes.height) } : null,
        markerScore: marker ? Number(marker[1]) : null,
        face: face ? { x: Number(face.attributes.cx), y: Number(face.attributes.cy), r: Number(face.attributes.r) } : null,
        track: track ? { x1: Number(track.attributes.x1), x2: Number(track.attributes.x2),
          y1: Number(track.attributes.y1), y2: Number(track.attributes.y2) } : null,
        actorDots: elements(body!, 'circle', 'journey-actor-dot').map(dot => ({
          actor: dot.attributes['data-actor'] ?? null, x: Number(dot.attributes.cx),
          y: Number(dot.attributes.cy), colorIndex: Number(dot.attributes.class?.match(/journey-actor-(\d+)/)?.[1] ?? -1),
          r: Number(dot.attributes.r) })),
      }
    }),
    guides: elements(svg, 'text', 'journey-score-label').map(item => ({ score: Number(item.text), y: Number(item.attributes.y) })),
    guideLines: elements(svg, 'line', 'journey-guide').map(item => ({
      x1: Number(item.attributes.x1), x2: Number(item.attributes.x2),
      y1: Number(item.attributes.y1), y2: Number(item.attributes.y2) })),
    curve: curve ? curveFacts(curve.attributes.d ?? '') : null,
    curvePaint: svg.match(/\.journey-curve \{[^}]*stroke: ([^;]+); stroke-width: ([^;]+);/)?.slice(1) ?? null,
    facePaint: svg.match(/\.journey-score-face \{ fill: ([^;]+); stroke: ([^;]+); stroke-width: ([^;]+);/)?.slice(1) ?? null,
    actorPaint: [0, 1].map(index => svg.match(new RegExp(`\\.journey-actor-${index} \\{ fill: ([^;]+); \\}`))?.[1] ?? null),
    sectionPaint: [0, 1].map(index => svg.match(new RegExp(`\\.journey-section-${index} \\{ fill: ([^;]+);`))?.[1] ?? null),
    taskBoxPaint: svg.match(/\.journey-task-box \{ fill: ([^;]+); stroke: ([^;]+); stroke-width: ([^;]+);/)?.slice(1) ?? null,
    taskTextPaint: svg.match(/\.journey-task-text \{ fill: ([^;]+);/)?.[1] ?? null,
    actorLegend: elements(svg, 'circle', 'journey-actor-dot').filter(item => item.attributes['data-id']?.startsWith('actor-legend-dot:'))
      .map(item => ({ actor: item.attributes['data-actor'] ?? null,
        colorIndex: Number(item.attributes.class?.match(/journey-actor-(\d+)/)?.[1] ?? -1),
        x: Number(item.attributes.cx), y: Number(item.attributes.cy) })),
    actorLegendText: elements(svg, 'text', 'journey-actor-legend-text').map(item => ({
      text: item.text, x: Number(item.attributes.x), y: Number(item.attributes.y) })),
  }
}
function renderMatches(value: FidelityJson): boolean {
  const actual = record(value)
  if (actual.viewBox !== '0 0 982 482.3' || !same(actual.accessibilityTitle, [actual.ariaLabelledBy, 'My working day'])
    || actual.curve !== null || actual.curvePaint !== null
    || !same(actual.facePaint, ['#d7d7d7', '#47474a', '1.2'])
    || !same(actual.actorPaint, ['#34438d', '#8d3f34'])
    || !same(actual.sectionPaint, ['#f0f0f1', '#ecedf4'])
    || !same(actual.taskBoxPaint, ['#f9f9f9', '#d4d4d4', '1'])
    || actual.taskTextPaint !== '#27272A') return false
  const title = actual.title == null ? null : record(actual.title)
  if (!title || title.text !== 'My working day' || title.x !== 491 || title.y !== 39.7) return false
  const renderedSections = actual.sections
  const renderedTasks = actual.tasks
  const guides = actual.guides
  const guideLines = actual.guideLines
  const actorLegend = actual.actorLegend
  const actorLegendText = actual.actorLegendText
  if (!Array.isArray(renderedSections) || renderedSections.length !== sections.length
    || !Array.isArray(renderedTasks) || renderedTasks.length !== tasks.length
    || !Array.isArray(guides) || guides.length !== 5 || !Array.isArray(guideLines) || guideLines.length !== 5
    || !Array.isArray(actorLegend) || !same(actorLegend.map(item => {
      const actor = record(item)
      return [actor.actor, actor.colorIndex]
    }), [['Me', 0], ['Cat', 1]]) || !Array.isArray(actorLegendText)
    || !same(actorLegendText.map(item => record(item).text), ['Me', 'Cat'])) return false
  for (const [index, value] of actorLegend.entries()) {
    const dot = record(value)
    const label = record(actorLegendText[index]!)
    if (typeof dot.x !== 'number' || typeof dot.y !== 'number'
      || typeof label.x !== 'number' || typeof label.y !== 'number'
      || dot.x < 0 || dot.y < 0 || dot.x >= label.x || label.x > 982
      || dot.y !== label.y || dot.y > 482.3) return false
    if (index > 0 && dot.y - Number(record(actorLegend[index - 1]!).y) < 12) return false
  }
  const guideYs = new Map<number, number>()
  for (const [index, guideValue] of guides.entries()) {
    const guide = record(guideValue)
    if (guide.score !== 5 - index || typeof guide.y !== 'number' || !Number.isFinite(guide.y)
      || guide.y < 0 || guide.y > 482.3) return false
    const line = record(guideLines[index]!)
    if (line.y1 !== guide.y || line.y2 !== guide.y || line.x1 !== 176 || line.x2 !== 950) return false
    guideYs.set(guide.score, guide.y)
  }
  if ([5, 4, 3, 2, 1].some((score, index) => index > 0 && Math.abs(guideYs.get(score)! - guideYs.get(score + 1)! - 40) > 0.01)) return false
  const taskBoxes: { x: number; right: number }[] = []
  for (const [index, expected] of tasks.entries()) {
    const item = record(renderedTasks[index]!)
    const face = item.face == null ? null : record(item.face)
    const box = item.box == null ? null : record(item.box)
    const track = item.track == null ? null : record(item.track)
    const expectedSection = index < 3 ? 'Go to work' : 'Go home'
    if (!face || !box || !track || item.id !== `task-${index}` || item.role !== 'task'
      || item.text !== expected.text || item.score !== expected.score || item.markerScore !== expected.score
      || item.section !== expectedSection || item.actors !== expected.actors.join(', ')
      || typeof face.x !== 'number' || typeof face.y !== 'number' || face.r !== 16
      || face.y !== guideYs.get(expected.score) || face.x !== track.x1 || track.x1 !== track.x2
      || typeof box.x !== 'number' || typeof box.y !== 'number'
      || typeof box.width !== 'number' || typeof box.height !== 'number'
      || box.width <= 0 || box.height <= 0 || box.x < 0 || box.y < 0
      || box.x + box.width > 982 || box.y + box.height > 482.3
      || face.x !== box.x + box.width / 2 || item.textX !== face.x
      || typeof track.y1 !== 'number' || typeof track.y2 !== 'number'
      || !Number.isFinite(track.y1) || !Number.isFinite(track.y2)
      || track.y1 < 0 || track.y2 > 482.3 || track.y1 >= track.y2
      || typeof item.textY !== 'number' || item.textY < box.y || item.textY > box.y + box.height) return false
    const boxX = box.x
    const boxY = box.y
    const boxWidth = box.width
    const boxHeight = box.height
    const dots = item.actorDots
    if (!Array.isArray(dots) || dots.length !== expected.actors.length
      || !same(dots.map(dotValue => {
        const dot = record(dotValue)
        return [dot.actor, dot.colorIndex]
      }), expected.actors.map(actor => [actor, actor === 'Me' ? 0 : 1]))
      || dots.some(dotValue => {
        const dot = record(dotValue)
        return typeof dot.x !== 'number' || typeof dot.y !== 'number' || dot.r !== 4
          || dot.x < boxX || dot.x > boxX + boxWidth || dot.y < boxY || dot.y > boxY + boxHeight
      })) return false
    if (dots.length > 1 && dots.some((dotValue, dotIndex) => dotIndex > 0
      && Math.hypot(Number(record(dotValue).x) - Number(record(dots[dotIndex - 1]!).x),
        Number(record(dotValue).y) - Number(record(dots[dotIndex - 1]!).y)) < 8)) return false
    if (index > 0 && boxX < taskBoxes[index - 1]!.right) return false
    taskBoxes.push({ x: boxX, right: boxX + boxWidth })
  }
  for (const [index, expected] of sections.entries()) {
    const item = record(renderedSections[index]!)
    const box = item.box == null ? null : record(item.box)
    if (!box || item.id !== `section-${index}` || item.role !== 'section'
      || item.label !== expected.label || item.text !== expected.label
      || typeof box.x !== 'number' || typeof box.width !== 'number' || typeof box.y !== 'number'
      || typeof box.height !== 'number' || box.width <= 0 || box.height <= 0
      || box.x < 0 || box.x + box.width > 982 || box.y < 0 || box.y + box.height > 482.3
      ) return false
    const sectionX = box.x
    const sectionWidth = box.width
    if (index > 0) {
      const previous = record(record(renderedSections[index - 1]!).box!)
      if (Number(previous.x) + Number(previous.width) > sectionX) return false
    }
    if (expected.taskIndexes.some(taskIndex => taskBoxes[taskIndex]!.x < sectionX
      || taskBoxes[taskIndex]!.right > sectionX + sectionWidth)) return false
  }
  return true
}

function renderDisposition(evidence: ObservedFidelitySurfaceEvidence): 'absent' | 'native' {
  const observation = semantic(evidence)
  const normal = record(observation.default)
  const parityMode = record(observation.parityMode)
  if (!renderMatches(parityMode)) throw new Error('Journey no-curve parity-mode geometry changed')
  if (!same({ ...normal, curve: null, curvePaint: null }, parityMode)) {
    throw new Error('Journey default render differs from parity mode beyond the experience curve')
  }
  if (normal.curve === null && normal.curvePaint === null) return 'native'
  const curve = record(normal.curve)
  const centers = (parityMode.tasks as readonly FidelityJson[]).map(task => {
    const face = record(record(task).face)
    return [face.x, face.y]
  })
  if (curve.validShape !== true || !same(curve.points, centers)
    || !same(normal.curvePaint, ['#9a9a9b', '2'])) {
    throw new Error('Journey default render does not show the known extra experience curve')
  }
  return 'absent'
}

export const fidelityCases: readonly FidelityCaseDefinition[] = [{
  id: 'journey.official.fence-0', family: 'journey',
  featureId: 'official-doc:journey:section:user-journey-diagram', source,
  upstreamReference: manifestExamples[0]!.officialDocs ?? 'https://mermaid.ai/open-source/syntax/userJourney.html',
  upstreamRevision: UPSTREAM_MERMAID_MANIFEST.provenance.commit,
  expected: {
    agent: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
      const expected = { title: 'My working day', sections: sections.map(section => ({ label: section.label,
        tasks: section.taskIndexes.map(index => tasks[index]!) })) }
      return same(semantic(evidence), expected) ? 'native' : 'absent'
    } },
    render: { applicability: 'applicable', disposition: 'absent', evaluate: renderDisposition },
    serialize: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
      const facts = semantic(evidence)
      return facts.stable === true && same(facts.model, modelFacts(source)) ? 'native' : 'absent'
    } },
    mutate: { applicability: 'not-applicable', rationale: 'This case classifies official syntax; Journey set_task_score has a separate semantic receipt.' },
  },
  observe: () => {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'journey') throw new Error('Pinned official Journey fence must parse')
    const verified = verifyMermaid(source)
    if (!verified.ok) throw new Error('Pinned official Journey fence must verify')
    const serialized = serializeMermaid(parsed.value)
    const reparsed = parseRegisteredMermaid(serialized)
    if (!reparsed.ok) throw new Error('Pinned official Journey fence must reparse')
    return {
      agent: { status: 'observed', diagnosticCodes: verified.warnings.map(warning => warning.code), semantics: modelFacts(source) },
      // Mermaid's Journey renderer has no connecting experience curve. Keep the
      // default-route divergence visible; the opt-out is supplementary evidence.
      render: { status: 'observed', diagnosticCodes: [], semantics: {
        default: renderFacts(renderMermaidSVG(source)),
        parityMode: renderFacts(renderMermaidSVG(source, { journey: { experienceCurve: false } })),
      } },
      serialize: { status: 'observed', diagnosticCodes: [], semantics: {
        model: modelFacts(serialized), stable: serializeMermaid(reparsed.value) === serialized } },
    }
  },
}]
