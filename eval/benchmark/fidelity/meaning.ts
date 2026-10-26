export type MeaningJson = null | boolean | number | string | MeaningJson[] | { [key: string]: MeaningJson }
export interface MeaningNode { id: string; label: string }
export interface MeaningEdge { source: string; target: string; directed: boolean; label?: string; startMarker?: string; endMarker?: string }
export interface MeaningGroup { id: string; label: string; members: string[] }
export interface PaintExpectation { fontSize?: number; images?: { href: string; count: number }[] }
export interface MeaningExpectation {
  labels: string[]
  nodes?: MeaningNode[]
  edges?: MeaningEdge[]
  groups?: MeaningGroup[]
  facts?: Record<string, MeaningJson>
  unorderedFacts?: string[]
}
export interface AuthoredFidelityCase {
  id: string
  family: string
  required: boolean
  source: string
  features: string[]
  provenance: string
  expected: MeaningExpectation
  renderOptions?: Record<string, MeaningJson>
  paint?: PaintExpectation
  prelude?: { source: string; accept: boolean }[]
  edit?: { source: string; expected: MeaningExpectation; renderOptions?: Record<string, MeaningJson>; paint?: PaintExpectation }
}
export interface NormalizedMeaning {
  family: string
  nodes?: MeaningNode[]
  edges?: MeaningEdge[]
  groups?: MeaningGroup[]
  facts: Record<string, MeaningJson>
  unavailable: Record<string, string>
}
export interface MeaningCheck {
  criterion: string
  status: 'passed' | 'failed' | 'unavailable'
  expected: unknown
  actual: unknown
  scope: string
}
const display = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim()
const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, normalize(item)])) : value
const stable = (value: unknown) => JSON.stringify(normalize(value))
const ordered = (values: unknown[]) => values.map(stable).sort()

/** Authored literals choose the facts. Tool agreement never supplies an expectation. */
export function assessMeaning(testCase: Pick<AuthoredFidelityCase, 'family' | 'expected'>, observed?: NormalizedMeaning): { complete: boolean; passed: boolean; checks: MeaningCheck[] } {
  const checks: MeaningCheck[] = []
  const check = (criterion: string, expected: unknown, actual: unknown, scope: string, available = actual !== undefined) => {
    checks.push({ criterion, status: !available ? 'unavailable' : stable(expected) === stable(actual) ? 'passed' : 'failed', expected, actual: actual ?? null, scope: observed?.unavailable[criterion] ?? scope })
  }
  check('family', testCase.family, observed?.family, 'Returned native family; a source-preservation envelope is not native admission.')
  if (testCase.expected.nodes) {
    check('identities', ordered(testCase.expected.nodes.map(node => node.id)), observed?.nodes && ordered(observed.nodes.map(node => node.id)), 'Exact authored identity multiset, including duplicate and omitted identities.')
    const labels = (nodes: MeaningNode[]) => ordered(nodes.map(node => ({ ...node, label: display(node.label) })))
    check('node-labels', labels(testCase.expected.nodes), observed?.nodes && labels(observed.nodes), 'Authored identity-to-label binding; NFC/whitespace normalization applies to display labels, never identity strings.')
  }
  if (testCase.expected.edges) {
    // Every edge uses the union of declared fields. Dropping a direction/label
    // from one member must not quietly weaken other members' comparisons.
    const keys = [...new Set(testCase.expected.edges.flatMap(edge => Object.keys(edge)))].sort()
    const project = (edge: MeaningEdge) => Object.fromEntries(keys.map(key => [key, key === 'label' ? display(edge.label ?? '') : edge[key as keyof MeaningEdge] ?? null]))
    check('relationships', ordered(testCase.expected.edges.map(project)), observed?.edges && ordered(observed.edges.map(project)), 'Exact endpoint/direction/declared-marker/label multiset; parallel and reciprocal relationships remain distinct.')
  }
  if (testCase.expected.groups) {
    const groups = (values: MeaningGroup[]) => ordered(values.map(group => ({ ...group, label: display(group.label), members: [...group.members].sort() })))
    check('groups', groups(testCase.expected.groups), observed?.groups && groups(observed.groups), 'Exact immediate membership and label binding; nested groups are identities, not flattened leaves.')
  }
  for (const [key, expected] of Object.entries(testCase.expected.facts ?? {})) {
    const unordered = testCase.expected.unorderedFacts?.includes(key)
    const actual = observed?.facts[key]
    const compared = (value: unknown) => unordered && Array.isArray(value) ? ordered(value) : value
    check('fact:' + key, compared(expected), compared(actual), unordered ? 'Declared unordered family-content multiset; duplicates remain significant.' : 'Independently declared family content with meaningful ordering retained.', !!observed && Object.hasOwn(observed.facts, key))
  }
  return { complete: checks.every(item => item.status !== 'unavailable'), passed: checks.length > 0 && checks.every(item => item.status === 'passed'), checks }
}
