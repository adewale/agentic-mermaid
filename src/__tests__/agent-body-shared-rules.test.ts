// Characterization of mutation rules several agent bodies share: the
// optional-field rule (`null` removes the field, any other value must pass the
// family's validator), the insert-position rule (an omitted index appends,
// otherwise it must be an integer in 0..length), accessibility serialization
// and label-overflow collection. Each case pins the exact serialized source or
// error the family produced before these rules moved into
// src/agent/body-utils.ts, so adopting the shared helper is byte-identical.

import { describe, expect, test } from 'bun:test'
import { mutate } from '../agent/mutate.ts'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import type { AnyMutationOp } from '../agent/types.ts'
import { verifyMermaid } from '../agent/verify.ts'

const SOURCES = {
  pie: 'pie\n  title Pets\n  "Dogs" : 3\n  "Cats" : 2\n',
  quadrant: 'quadrantChart\n  title Reach\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.3, 0.6]\n',
  radar: 'radar-beta\n  title Skills\n  axis a["A"], b["B"], c["C"]\n  curve x["X"]{1, 2, 3}\n',
  xychart: 'xychart-beta\n  title Sales\n  x-axis [jan, feb]\n  y-axis "Revenue" 0 --> 10\n  bar [3, 5]\n',
  journey: 'journey\n  title Day\n  section Morning\n    Wake: 3: Me\n',
  timeline: 'timeline\n  title History\n  section One\n    2020 : Start\n',
  gantt: 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Build\n    Core : core, 2024-01-01, 3d\n',
  gitgraph: 'gitGraph\n  accTitle: History\n  commit id: "a"\n',
  mindmap: 'mindmap\n  accTitle: Ideas\n  root((Root))\n    Child\n',
  architecture: 'architecture-beta\n  accTitle: Stack\n  service api(server)[API]\n',
}

type Outcome = { ok: true; source: string } | { ok: false; error: unknown }
type Case = [keyof typeof SOURCES, object, Outcome]

function outcome(source: string, op: object): Outcome {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.error)}`)
  const result = mutate(parsed.value, op as AnyMutationOp)
  return result.ok ? { ok: true, source: serializeMermaid(result.value) } : { ok: false, error: result.error }
}

const OPTIONAL_TEXT_CASES: Case[] = [
  ['pie', { kind: 'set_title', title: null }, { ok: true, source: 'pie\n  "Dogs" : 3\n  "Cats" : 2\n' }],
  ['pie', { kind: 'set_title', title: '  Pets 2 ' }, { ok: true, source: 'pie\n  title Pets 2\n  "Dogs" : 3\n  "Cats" : 2\n' }],
  ['pie', { kind: 'set_title', title: 'a\nb' }, { ok: false, error: { code: 'INVALID_OP', message: 'Pie title must be non-empty single-line text' } }],
  ['pie', { kind: 'set_title', title: 7 }, { ok: false, error: { code: 'INVALID_OP', message: 'Pie title must be a string' } }],
  ['quadrant', { kind: 'set_title', title: null }, { ok: true, source: 'quadrantChart\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.3, 0.6]\n' }],
  ['quadrant', { kind: 'set_title', title: 'Reach 2' }, { ok: true, source: 'quadrantChart\n  title Reach 2\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.3, 0.6]\n' }],
  ['quadrant', { kind: 'set_title', title: '' }, { ok: false, error: { code: 'INVALID_OP', message: 'Quadrant title must be non-empty single-line text' } }],
  ['radar', { kind: 'set_title', title: null }, { ok: true, source: 'radar-beta\n  axis a["A"], b["B"], c["C"]\n  curve x["X"]{1, 2, 3}\n' }],
  ['radar', { kind: 'set_title', title: 'Skills<br>2' }, { ok: true, source: 'radar-beta\n  title Skills<br/>2\n  axis a["A"], b["B"], c["C"]\n  curve x["X"]{1, 2, 3}\n' }],
  ['radar', { kind: 'set_title', title: ' ' }, { ok: false, error: { code: 'INVALID_OP', message: 'Radar title must be non-empty text' } }],
  ['xychart', { kind: 'set_title', title: null }, { ok: true, source: 'xychart-beta\n  x-axis [jan, feb]\n  y-axis Revenue 0 --> 10\n  bar [3, 5]\n' }],
  ['xychart', { kind: 'set_title', title: 'Sales 2' }, { ok: true, source: 'xychart-beta\n  title Sales 2\n  x-axis [jan, feb]\n  y-axis Revenue 0 --> 10\n  bar [3, 5]\n' }],
  ['xychart', { kind: 'set_title', title: 3 }, { ok: false, error: { code: 'INVALID_OP', message: 'XY chart title must be a string' } }],
  ['xychart', { kind: 'set_x_axis', axis: null }, { ok: true, source: 'xychart-beta\n  title Sales\n  y-axis Revenue 0 --> 10\n  bar [3, 5]\n' }],
  ['xychart', { kind: 'set_y_axis', axis: null }, { ok: true, source: 'xychart-beta\n  title Sales\n  x-axis [jan, feb]\n  bar [3, 5]\n' }],
  ['xychart', { kind: 'set_y_axis', axis: { name: 'Units', range: { min: 0, max: 20 } } }, { ok: true, source: 'xychart-beta\n  title Sales\n  x-axis [jan, feb]\n  y-axis Units 0 --> 20\n  bar [3, 5]\n' }],
  ['xychart', { kind: 'set_x_axis', axis: { categories: [] } }, { ok: false, error: { code: 'INVALID_OP', message: 'XY chart x-axis categories must be a non-empty array' } }],
  ['journey', { kind: 'set_title', title: null }, { ok: true, source: 'journey\n  section Morning\n    Wake: 3: Me\n' }],
  ['journey', { kind: 'set_title', title: 'Day: two' }, { ok: true, source: 'journey\n  title Day: two\n  section Morning\n    Wake: 3: Me\n' }],
  ['journey', { kind: 'set_title', title: 'a;b' }, { ok: false, error: { code: 'INVALID_OP', message: 'Journey title must be non-empty, and must not contain statement-delimiter semicolons' } }],
  ['timeline', { kind: 'set_title', title: null }, { ok: true, source: 'timeline\n  section One\n  2020 : Start\n' }],
  ['timeline', { kind: 'set_title', title: 'History 2' }, { ok: true, source: 'timeline\n  title History 2\n  section One\n  2020 : Start\n' }],
  ['timeline', { kind: 'set_title', title: 'a\nb' }, { ok: false, error: { code: 'INVALID_OP', message: 'Timeline title must be single-line; pinned Mermaid renders <br> literally in titles' } }],
  ['gitgraph', { kind: 'set_accessibility_title', title: null }, { ok: true, source: 'gitGraph\n  commit id:"a"\n' }],
  ['gitgraph', { kind: 'set_accessibility_title', title: 'Log' }, { ok: true, source: 'gitGraph\n  accTitle: Log\n  commit id:"a"\n' }],
  ['gitgraph', { kind: 'set_accessibility_description', description: 'Two\nlines' }, { ok: false, error: { code: 'INVALID_OP', message: 'gitGraph accessibility description must be a non-empty single-line string' } }],
  ['gitgraph', { kind: 'set_accessibility_description', description: 'One line' }, { ok: true, source: 'gitGraph\n  accTitle: History\n  accDescr: One line\n  commit id:"a"\n' }],
  ['gitgraph', { kind: 'set_accessibility_description', description: null }, { ok: true, source: 'gitGraph\n  accTitle: History\n  commit id:"a"\n' }],
  ['mindmap', { kind: 'set_accessibility_title', title: null }, { ok: true, source: 'mindmap\n  root((Root))\n    Child\n' }],
  ['mindmap', { kind: 'set_accessibility_title', title: 'Map' }, { ok: true, source: 'mindmap\n  accTitle: Map\n  root((Root))\n    Child\n' }],
  ['mindmap', { kind: 'set_accessibility_title', title: '' }, { ok: false, error: { code: 'INVALID_OP', message: 'Mindmap accessibility title must be a non-empty single-line string' } }],
  ['mindmap', { kind: 'set_accessibility_description', description: 'About ideas' }, { ok: true, source: 'mindmap\n  accTitle: Ideas\n  accDescr: About ideas\n  root((Root))\n    Child\n' }],
  ['mindmap', { kind: 'set_accessibility_description', description: null }, { ok: true, source: 'mindmap\n  accTitle: Ideas\n  root((Root))\n    Child\n' }],
  ['architecture', { kind: 'set_accessibility_title', title: null }, { ok: true, source: 'architecture-beta\n  service api(server)[API]\n' }],
  ['architecture', { kind: 'set_accessibility_title', title: 'Stack 2' }, { ok: true, source: 'architecture-beta\n  accTitle: Stack 2\n  service api(server)[API]\n' }],
  ['architecture', { kind: 'set_accessibility_title', title: 'a\nb' }, { ok: true, source: 'architecture-beta\n  accTitle: a b\n  service api(server)[API]\n' }],
  ['architecture', { kind: 'set_accessibility_description', description: 'Two\nlines' }, { ok: true, source: 'architecture-beta\n  accTitle: Stack\n  accDescr {\n    Two\n    lines\n  }\n  service api(server)[API]\n' }],
  ['architecture', { kind: 'set_accessibility_description', description: 'One line' }, { ok: true, source: 'architecture-beta\n  accTitle: Stack\n  accDescr: One line\n  service api(server)[API]\n' }],
  ['architecture', { kind: 'set_accessibility_description', description: null }, { ok: true, source: 'architecture-beta\n  accTitle: Stack\n  service api(server)[API]\n' }],
]
const INSERT_INDEX_CASES: Case[] = [
  ['journey', { kind: 'add_section', label: 'Noon' }, { ok: true, source: 'journey\n  title Day\n  section Morning\n    Wake: 3: Me\n  section Noon\n' }],
  ['journey', { kind: 'add_section', label: 'Dawn', index: 0 }, { ok: true, source: 'journey\n  title Day\n  section Dawn\n  section Morning\n    Wake: 3: Me\n' }],
  ['journey', { kind: 'add_section', label: 'Late', index: 2 }, { ok: false, error: { code: 'INVALID_OP', message: 'Journey insert index 2 out of range (0..1)' } }],
  ['journey', { kind: 'add_task', sectionIndex: 0, text: 'Tea', score: 4, index: 1.5 }, { ok: false, error: { code: 'INVALID_OP', message: 'Journey insert index 1.5 out of range (0..1)' } }],
  ['journey', { kind: 'add_task', sectionIndex: 0, text: 'Tea', score: 4, index: 0 }, { ok: true, source: 'journey\n  title Day\n  section Morning\n    Tea: 4\n    Wake: 3: Me\n' }],
  ['timeline', { kind: 'add_section', label: 'Zero', index: 0 }, { ok: true, source: 'timeline\n  title History\n  section Zero\n  section One\n  2020 : Start\n' }],
  ['timeline', { kind: 'add_section', label: 'Two', index: -1 }, { ok: false, error: { code: 'INVALID_OP', message: 'Timeline insert index -1 out of range (0..1)' } }],
  ['timeline', { kind: 'add_period', sectionIndex: 0, label: '2021', index: 1 }, { ok: true, source: 'timeline\n  title History\n  section One\n  2020 : Start\n  2021\n' }],
  ['timeline', { kind: 'add_event', sectionIndex: 0, periodIndex: 0, text: 'Late', index: 3 }, { ok: false, error: { code: 'INVALID_OP', message: 'Timeline insert index 3 out of range (0..1)' } }],
  ['timeline', { kind: 'add_event', sectionIndex: 0, periodIndex: 0, text: 'Early', index: 0 }, { ok: true, source: 'timeline\n  title History\n  section One\n  2020 : Early\n       : Start\n' }],
  ['gantt', { kind: 'add_task', sectionIndex: 0, label: 'Docs', end: '2d' }, { ok: true, source: 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Core :core, 2024-01-01, 3d\n  Docs :2d\n' }],
  ['gantt', { kind: 'add_task', sectionIndex: 0, label: 'Docs', end: '2d', index: 0 }, { ok: true, source: 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Docs :2d\n  Core :core, 2024-01-01, 3d\n' }],
  ['gantt', { kind: 'add_task', sectionIndex: 0, label: 'Docs', end: '2d', index: 5 }, { ok: false, error: { code: 'INVALID_OP', message: 'Gantt insert index 5 out of range (0..1)' } }],
  ['gantt', { kind: 'add_task', sectionIndex: 0, label: 'Docs', end: '2d', index: 0.5 }, { ok: false, error: { code: 'INVALID_OP', message: 'Gantt insert index 0.5 out of range (0..1)' } }],
]

describe('optional-field rule: null removes the field, other values pass the family validator', () => {
  for (const [family, op, expected] of OPTIONAL_TEXT_CASES) {
    test(`${family} ${JSON.stringify(op)}`, () => {
      expect(outcome(SOURCES[family], op)).toEqual(expected)
    })
  }
})

describe('insert-position rule: an omitted index appends, otherwise an integer in 0..length', () => {
  for (const [family, op, expected] of INSERT_INDEX_CASES) {
    test(`${family} ${JSON.stringify(op)}`, () => {
      expect(outcome(SOURCES[family], op)).toEqual(expected)
    })
  }
})

test('sankey reports LABEL_OVERFLOW once per distinct node label, in link order, at the caller cap', () => {
  const long = 'N'.repeat(45)
  const parsed = parseRegisteredMermaid(`sankey-beta\n${long},B,1\n${long},C,1\nB,C,2\n`)
  if (!parsed.ok) throw new Error('parse failed')
  const overflow = (labelCharCap?: number) => verifyMermaid(parsed.value, labelCharCap === undefined ? {} : { labelCharCap })
    .warnings.filter(warning => warning.code === 'LABEL_OVERFLOW')
  expect(overflow()).toEqual([{ code: 'LABEL_OVERFLOW', target: long, charCount: 45, limit: 40 }])
  expect(overflow(0)).toEqual([
    { code: 'LABEL_OVERFLOW', target: long, charCount: 45, limit: 0 },
    { code: 'LABEL_OVERFLOW', target: 'B', charCount: 1, limit: 0 },
    { code: 'LABEL_OVERFLOW', target: 'C', charCount: 1, limit: 0 },
  ])
})
