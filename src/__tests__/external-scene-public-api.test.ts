import { describe, expect, test } from 'bun:test'

// Intentionally import every extension-facing dependency from the published
// agent entry. A synthetic family must not reach into marks.ts or any built-in
// compatibility lowering helper.
import {
  EXTERNAL_SCENE_API_VERSION,
  buildExternalScene,
  createExtensionIdentity,
  declareFamilyScenePrimitiveEvidence,
  registerFamily,
  renderMermaidSVG,
  validateSceneDoc,
  verifyNoExternalRefs,
  type ExternalFamilyId,
  type ExternalSceneInput,
  type ExternalSceneNode,
  type FamilyDescriptor,
  type FamilySceneRolePrimitiveDeclaration,
} from '../agent/index.ts'

const EVIDENCE = 'src/__tests__/external-scene-public-api.test.ts'

const ROLES = [
  { role: 'prelude', primitives: ['document'] },
  { role: 'chrome', primitives: ['document'] },
  { role: 'defs', primitives: ['document', 'marker'] },
  { role: 'group', primitives: ['container'] },
  { role: 'node', primitives: ['shape'] },
  { role: 'label', primitives: ['text'] },
  { role: 'bar', primitives: ['shape', 'data-mark'] },
  { role: 'edge', primitives: ['connector'] },
] as const satisfies readonly FamilySceneRolePrimitiveDeclaration[]

const ARROW = {
  id: 'external-arrow',
  shape: 'arrow' as const,
  geometry: {
    kind: 'polygon' as const,
    points: [{ x: 0, y: 0 }, { x: 8, y: 4 }, { x: 0, y: 8 }],
  },
  size: { width: 8, height: 8 },
  viewBox: { x: 0, y: 0, width: 8, height: 8 },
  ref: { x: 8, y: 4 },
  bounds: { x0: 0, y0: 0, x1: 8, y1: 8 },
  units: 'userSpaceOnUse' as const,
  orient: 'auto' as const,
  paint: { fill: 'var(--_arrow)', stroke: 'var(--_arrow)', strokeWidth: '1' },
}

function sceneInput(family: string, colors: Parameters<typeof buildExternalScene>[0]['colors']): ExternalSceneInput {
  return {
    version: EXTERNAL_SCENE_API_VERSION,
    family,
    width: 220,
    height: 120,
    colors,
    metadata: {
      title: 'Safe external Scene',
      description: 'Structured marks rendered by every graphical backend',
    },
    markers: [ARROW],
    parts: [
      {
        kind: 'container',
        id: 'left-group',
        role: 'group',
        children: [
          {
            kind: 'shape',
            id: 'left-node',
            role: 'node',
            geometry: { kind: 'rect', x: 20, y: 35, width: 55, height: 40, rx: 7, ry: 7 },
            paint: { fill: 'var(--_node-fill)', stroke: 'var(--_node-stroke)', strokeWidth: '1.5' },
          },
          {
            kind: 'text',
            id: 'left-label',
            role: 'label',
            text: 'External',
            x: 47.5,
            y: 59,
            fontSize: 12,
            anchor: 'middle',
          },
        ],
      },
      {
        kind: 'data-mark',
        id: 'right-bar',
        role: 'bar',
        geometry: { kind: 'rect', x: 165, y: 40, width: 25, height: 35, rx: 2, ry: 2 },
        value: 0.75,
        channels: { category: 'public-api' },
        paint: { fill: '#b45309', stroke: '#78350f', strokeWidth: '1' },
      },
      {
        kind: 'connector',
        id: 'external-edge',
        role: 'edge',
        geometry: { kind: 'line', x1: 75, y1: 58, x2: 165, y2: 58 },
        from: 'left-node',
        to: 'right-bar',
        endMarker: ARROW.id,
        relationship: { kind: 'dependency', direction: 'forward' },
        labels: [{ id: 'external-edge-label', text: 'feeds' }],
      },
    ],
  }
}

function descriptor(
  localId: string,
  header: string,
  roles: readonly FamilySceneRolePrimitiveDeclaration[],
  lowerScene: NonNullable<FamilyDescriptor['lowerScene']>,
): FamilyDescriptor {
  const id = `family:test/${localId}` as ExternalFamilyId
  return {
    contractVersion: 1,
    identity: createExtensionIdentity({
      id,
      kind: 'family',
      version: '1.0.0',
      compatibility: { core: '^0.1.1', scene: '^1.0.0' },
      provenance: { owner: 'external-scene-public-api-test', source: 'test', reference: EVIDENCE },
    }),
    id,
    label: `External Scene ${localId}`,
    headers: [header],
    aliases: [],
    maturity: 'experimental',
    collisionPriority: 0,
    detect: line => line === header.toLowerCase(),
    semanticRoles: roles.map(row => row.role),
    scenePrimitiveEvidence: declareFamilyScenePrimitiveEvidence(id, roles, [EVIDENCE]),
    capabilityEvidence: [
      { capability: 'detection', state: 'native', evidence: [EVIDENCE] },
      { capability: 'source-preservation', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'parse', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'serialize', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'mutation', state: 'diagnosed', evidence: [EVIDENCE] },
      { capability: 'verify', state: 'native', evidence: [EVIDENCE] },
      { capability: 'layout', state: 'native', evidence: [EVIDENCE] },
      { capability: 'scene', state: 'native', evidence: [EVIDENCE] },
      { capability: 'svg', state: 'native', evidence: [EVIDENCE] },
      { capability: 'terminal', state: 'absent', evidence: [EVIDENCE] },
    ],
    verify: () => [],
    layout: () => ({ width: 220, height: 120 }),
    lowerScene,
  }
}

describe('public external Scene construction and admission', () => {
  test('one public-only family renders through default, rough, and hybrid backends', () => {
    const family = descriptor('safe-scene', 'safeScene', ROLES, ctx => sceneInput('family:test/safe-scene', ctx.colors) && buildExternalScene(sceneInput('family:test/safe-scene', ctx.colors)))
    const unregister = registerFamily(family)
    try {
      const source = 'safeScene\n  opaque extension payload'
      const crisp = renderMermaidSVG(source)
      const rough = renderMermaidSVG(source, { style: { stroke: 'jittered', roughness: 0.9 } })
      const hybrid = renderMermaidSVG(source, { style: { stroke: 'freehand', strokeWidth: 1.4 } })

      for (const svg of [crisp, rough, hybrid]) {
        expect(svg).toStartWith('<svg')
        expect(svg).toContain('data-id="left-node"')
        expect(svg).toContain('data-role="edge"')
        expect(svg).not.toContain('<script')
        expect(verifyNoExternalRefs(svg)).toEqual({ ok: true, refs: [] })
      }
      expect(crisp).toContain('<rect x="20" y="35" width="55" height="40" rx="7" ry="7"')
      expect(crisp).not.toContain('stroke-opacity="0"')
      expect(rough).toContain('stroke-opacity="0"')
      expect(hybrid).toContain('stroke-opacity="0"')
      expect(rough).not.toBe(crisp)
      expect(hybrid).not.toBe(rough)
    } finally {
      unregister()
    }
  })

  test('escapes text and rejects fetching paint and non-canonical document CSS', () => {
    const safe = sceneInput('family:test/security-scene', { bg: '#fff', fg: '#111' })
    const container = safe.parts[0]
    expect(container?.kind).toBe('container')
    if (!container || container.kind !== 'container') return
    const node = container.children[1] as Extract<ExternalSceneNode, { kind: 'text' }>
    const escaped = buildExternalScene({
      ...safe,
      parts: [{
        ...container,
        children: [container.children[0]!, { ...node, text: '<script>alert(1)</script>', x: 110, fontSize: 8 }],
      }, ...safe.parts.slice(1)],
    })
    const svg = escaped.parts.map(part => part.crisp).join('\n')
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(svg).not.toContain('<script>')

    const unsafePaint = sceneInput('family:test/security-scene', { bg: '#fff', fg: '#111' })
    const data = unsafePaint.parts[1] as Extract<ExternalSceneNode, { kind: 'data-mark' }>
    expect(() => buildExternalScene({
      ...unsafePaint,
      parts: [unsafePaint.parts[0]!, { ...data, paint: { fill: 'url(https://evil.example/fill.svg)' } }, ...unsafePaint.parts.slice(2)],
    })).toThrow(/safe non-fetching CSS paint/)

    const prelude = escaped.parts[0]!
    expect(prelude.kind).toBe('prelude')
    if (prelude.kind !== 'prelude') return
    const forged = {
      ...escaped,
      parts: [{ ...prelude, crisp: prelude.crisp.replace('</style>', '*{fill:red}</style>') }, ...escaped.parts.slice(1)],
    }
    expect(validateSceneDoc(forged).diagnostics).toContainEqual(expect.objectContaining({
      code: 'SCENE_SECURITY',
      message: expect.stringMatching(/canonical/),
    }))
  })

  test('rejects undeclared primitives and malformed manual connector semantics before rendering', () => {
    const roles = ROLES.map(row => row.role === 'bar' ? { role: 'bar' as const, primitives: ['shape' as const] } : row)
    const family = descriptor('undeclared-scene', 'undeclaredScene', roles, ctx => buildExternalScene(sceneInput('family:test/undeclared-scene', ctx.colors)))
    const unregister = registerFamily(family)
    try {
      for (const style of [undefined, { stroke: 'jittered' as const }, { stroke: 'freehand' as const }]) {
        expect(() => renderMermaidSVG('undeclaredScene', style ? { style } : {})).toThrow(/undeclared bar\/data-mark primitive/)
      }
    } finally {
      unregister()
    }

    const valid = buildExternalScene(sceneInput('family:test/manual-scene', { bg: '#fff', fg: '#111' }))
    const edgeIndex = valid.parts.findIndex(part => part.kind === 'connector')
    const edge = valid.parts[edgeIndex]!
    expect(edge.kind).toBe('connector')
    if (edge.kind !== 'connector') return
    const malformed = {
      ...valid,
      parts: valid.parts.map((part, index) => index === edgeIndex
        ? { ...edge, relationship: { ...edge.relationship, direction: 'sideways' } }
        : part),
    }
    expect(validateSceneDoc(malformed).diagnostics).toContainEqual(expect.objectContaining({
      path: expect.stringContaining('relationship.direction'),
    }))
  })

  test('preflights cyclic and over-deep declarative trees before recursive compilation', () => {
    const cycle: { kind: 'container'; id: string; role: 'group'; children: ExternalSceneNode[] } = {
      kind: 'container', id: 'cycle', role: 'group', children: [],
    }
    cycle.children.push(cycle)
    const cyclic = sceneInput('family:test/cyclic-scene', { bg: '#fff', fg: '#111' })
    expect(() => buildExternalScene({ ...cyclic, parts: [cycle] })).toThrow(/acyclic/)

    let nested: ExternalSceneNode = {
      kind: 'shape', id: 'deep-leaf', role: 'node',
      geometry: { kind: 'rect', x: 1, y: 1, width: 1, height: 1 },
    }
    for (let depth = 0; depth <= 65; depth++) {
      nested = { kind: 'container', id: `deep-${depth}`, role: 'group', children: [nested] }
    }
    const deep = sceneInput('family:test/deep-scene', { bg: '#fff', fg: '#111' })
    expect(() => buildExternalScene({ ...deep, parts: [nested] })).toThrow(/depth|deeply nested/)
  })
})
