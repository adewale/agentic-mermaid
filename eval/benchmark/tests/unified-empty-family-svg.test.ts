import { expect, test } from 'bun:test'
import { qualifyFamilySvg } from '../unified/family-suite.ts'

const workload = { id: 'authored:empty-model', family: 'class', source: 'classDiagram', provenance: 'authored independent zero-model oracle', features: [] }
const evidence = { assertions: { nodeCount: 0, edgeCount: 0, groupCount: 0 }, origins: ['authored independent zero-model oracle'] }
const empty = { nodes: 0, edges: 0, groups: 0 }
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0"><title>Accessible metadata</title></svg>'

test('independently empty and actually empty SVG excludes only the inapplicable positive-canvas criterion', () => {
  expect(qualifyFamilySvg(workload, svg, evidence, empty).status).toBe('not-applicable')
  expect(qualifyFamilySvg(workload, svg, evidence, empty).metrics).toMatchObject({ independentNodes: 0, observedLayoutNodes: 0, explicitLabelExpectations: 0 })
  expect(qualifyFamilySvg(workload, svg, undefined, empty).findings).toContain('SVG has no positive finite viewBox or explicit canvas')
  expect(qualifyFamilySvg(workload, svg, evidence, { ...empty, nodes: 1 }).findings).toContain('SVG has no positive finite viewBox or explicit canvas')
  expect(qualifyFamilySvg(workload, svg, evidence, undefined).findings).toContain('SVG has no positive finite viewBox or explicit canvas')
})

test('empty expectations cannot hide malformed XML, foreign roots, required labels or contradictory nonempty assertions', () => {
  expect(qualifyFamilySvg(workload, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 -1 0"/>', evidence, empty).status).not.toBe('not-applicable')
  expect(qualifyFamilySvg(workload, '<svg xmlns="http://www.w3.org/2000/svg" width="NaN" height="0"/>', evidence, empty).status).not.toBe('not-applicable')
  expect(qualifyFamilySvg(workload, '<svg xmlns="http://www.w3.org/2000/svg"/>', evidence, empty).status).not.toBe('not-applicable')
  expect(qualifyFamilySvg(workload, '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="0" viewBox="0 0 0 0"/>', evidence, empty).status).not.toBe('not-applicable')
  expect(qualifyFamilySvg(workload, '<svg>', evidence, empty).status).not.toBe('not-applicable')
  expect(qualifyFamilySvg(workload, '<svg xmlns="urn:wrong"/>', evidence, empty).status).not.toBe('not-applicable')
  expect(qualifyFamilySvg({ ...workload, expectedLabels: ['Node'] }, svg, evidence, empty).status).not.toBe('not-applicable')
  expect(qualifyFamilySvg(workload, svg, { ...evidence, assertions: { ...evidence.assertions, minNodes: 1 } }, empty).status).not.toBe('not-applicable')
  expect(qualifyFamilySvg(workload, svg, { ...evidence, assertions: { ...evidence.assertions, labelsContain: ['Node'] } }, empty).status).not.toBe('not-applicable')
  expect(qualifyFamilySvg(workload, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>', evidence, empty).findings).toEqual([])
})
