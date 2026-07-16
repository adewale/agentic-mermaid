import { describe, expect, test } from 'bun:test'

// Intentionally import every extension-facing dependency from the published
// agent entry. A synthetic family must not reach into marks.ts or any built-in
// compatibility lowering helper.
import {
  EXTERNAL_SCENE_API_VERSION,
  SCENE_VALIDATION_LIMITS,
  DefaultBackend,
  buildExternalScene,
  createExtensionIdentity,
  declareFamilyScenePrimitiveEvidence,
  getBackend,
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
        labels: [{
          id: 'external-edge-label', text: 'feeds', clearance: 4,
          halo: { color: '#ffffff', width: 2 }, paint: { fill: '#172033' }, fontSize: 13,
        }],
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
    contractVersion: 2,
    identity: createExtensionIdentity({
      id,
      kind: 'family',
      version: '1.0.0',
      compatibility: { core: '^0.1.1', scene: '^2.0.0' },
      provenance: { owner: 'external-scene-public-api-test', source: 'test', reference: EVIDENCE },
    }),
    id,
    label: `External Scene ${localId}`,
    example: `${header}\n  example payload`,
    headers: [header],
    aliases: [],
    maturity: 'experimental',
    collisionPriority: 0,
    detect: line => line === header.toLowerCase(),
    semanticRoles: roles.map(row => row.role),
    semanticChannels: ['category', 'value'],
    scenePrimitiveEvidence: declareFamilyScenePrimitiveEvidence(id, roles, [EVIDENCE]),
    capabilityEvidence: [
      { capability: 'detection', state: 'native', evidence: [EVIDENCE] },
      { capability: 'source-preservation', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'parse', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'serialize', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'mutation', state: 'diagnosed', evidence: [EVIDENCE] },
      // This fixture exercises the public graphical Scene tuple only. Without a
      // projectPositioned hook, layout JSON and render-backed verification are
      // deliberately diagnosed rather than advertised as native.
      { capability: 'verify', state: 'diagnosed', evidence: [EVIDENCE] },
      { capability: 'layout', state: 'diagnosed', evidence: [EVIDENCE] },
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
  test('requires an explicit Scene range for an external family with lowerScene', () => {
    const base = descriptor(
      'missing-scene-range',
      'missingSceneRange',
      ROLES,
      ctx => buildExternalScene(sceneInput('family:test/missing-scene-range', ctx.colors)),
    )
    const missingSceneRange: FamilyDescriptor = {
      ...base,
      identity: createExtensionIdentity({
        id: base.identity.id,
        kind: 'family',
        version: base.identity.version,
        compatibility: { core: '^0.1.1' },
        provenance: base.identity.provenance,
      }),
    }

    expect(() => registerFamily(missingSceneRange))
      .toThrow(/must declare an explicit compatible "scene" range/i)
  })

  test('rejects a Scene lowering that has no executable positioning hook', () => {
    const base = descriptor(
      'scene-without-layout',
      'sceneWithoutLayout',
      ROLES,
      ctx => buildExternalScene(sceneInput('family:test/scene-without-layout', ctx.colors)),
    )
    const partial: FamilyDescriptor = {
      ...base,
      layout: undefined,
      capabilityEvidence: base.capabilityEvidence.map(claim => {
        if (claim.capability === 'layout' || claim.capability === 'svg') return { ...claim, state: 'absent' }
        if (claim.capability === 'scene') return { ...claim, state: 'diagnosed' }
        return claim
      }),
    }
    expect(() => registerFamily(partial)).toThrow(/cannot lower Scene without a layout hook/)
  })

  test('one public-only family renders through default, rough, and hybrid backends', () => {
    const family = descriptor('safe-scene', 'safeScene', ROLES, ctx => sceneInput('family:test/safe-scene', ctx.colors) && buildExternalScene(sceneInput('family:test/safe-scene', ctx.colors)))
    const unregister = registerFamily(family)
    try {
      const source = 'safeScene\n  opaque extension payload'
      const precise = renderMermaidSVG(source)
      const rough = renderMermaidSVG(source, { style: { stroke: 'jittered', roughness: 0.9 } })
      const hybrid = renderMermaidSVG(source, { style: { stroke: 'freehand', strokeWidth: 1.4 } })

      for (const svg of [precise, rough, hybrid]) {
        expect(svg).toStartWith('<svg')
        expect(svg).toContain('data-id="left-node"')
        expect(svg).toContain('data-role="edge"')
        expect(svg).toContain('data-id="external-edge-label"')
        expect(svg).toContain('data-connector-label-for="external-edge"')
        expect(svg).toContain('x="120" y="54"')
        expect(svg).toContain('font-size="13"')
        expect(svg).toContain('fill="#172033"')
        expect(svg).toContain('stroke="#ffffff"')
        expect(svg).toContain('>feeds</text>')
        expect(svg).not.toContain('<script')
        expect(verifyNoExternalRefs(svg)).toEqual({ ok: true, refs: [] })
      }
      for (const attribute of ['x="20"', 'y="35"', 'width="55"', 'height="40"', 'rx="7"', 'ry="7"']) {
        expect(precise).toContain(attribute)
      }
      expect(precise).not.toContain('stroke-opacity="0"')
      expect(rough).toContain('stroke-opacity="0"')
      expect(hybrid).toContain('stroke-opacity="0"')
      expect(rough).not.toBe(precise)
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
    const svg = DefaultBackend.render(escaped, { seed: 0 })
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(svg).not.toContain('<script>')

    const unsafePaint = sceneInput('family:test/security-scene', { bg: '#fff', fg: '#111' })
    const data = unsafePaint.parts[1] as Extract<ExternalSceneNode, { kind: 'data-mark' }>
    expect(() => buildExternalScene({
      ...unsafePaint,
      parts: [unsafePaint.parts[0]!, { ...data, paint: { fill: 'url(https://evil.example/fill.svg)' } }, ...unsafePaint.parts.slice(2)],
    })).toThrow(/safe non-fetching CSS paint/)

    expect(escaped.parts[0]).toMatchObject({ kind: 'document', element: 'open' })
    expect(escaped.parts.every(part => !Object.prototype.hasOwnProperty.call(part, 'crisp'))).toBe(true)
  })

  test('rejects every unvalidated paint escape and unknown paint fields', () => {
    const safe = sceneInput('family:test/paint-containment', { bg: '#fff', fg: '#111' })
    const data = safe.parts[1] as Extract<ExternalSceneNode, { kind: 'data-mark' }>
    const hostilePaints: Array<[Record<string, string>, string]> = [
      [{ strokeLinecap: 'round" /><text>FORGED</text><rect stroke-linecap="round' }, 'strokeLinecap'],
      [{ strokeLinejoin: 'round" /><style>*{display:none}</style><rect stroke-linejoin="round' }, 'strokeLinejoin'],
      [{ vectorEffect: 'none" /><text>FORGED</text><rect vector-effect="none' }, 'vectorEffect'],
      [{ paintOrder: 'stroke url(https://evil.invalid/x)' }, 'paintOrder'],
      [{ unknownPaintEscape: '<style>*{display:none}</style>' }, 'unknownPaintEscape'],
    ]
    for (const [hostile, field] of hostilePaints) {
      expect(() => buildExternalScene({
        ...safe,
        parts: [safe.parts[0]!, { ...data, paint: { ...data.paint, ...hostile } }, ...safe.parts.slice(2)],
      })).toThrow(new RegExp(field))
    }
  })

  test('parses external SVG path data semantically before projection', () => {
    const safe = sceneInput('family:test/path-admission', { bg: '#fff', fg: '#111' })
    const edge = safe.parts[2]
    expect(edge?.kind).toBe('connector')
    if (!edge || edge.kind !== 'connector') return
    const points = [{ x: 75, y: 58 }, { x: 165, y: 58 }]

    for (const d of [
      'M',
      'Z',
      'M 0 0 L',
      'M 1e999 0 L 1 1',
      'M 0 0 A 1 1 999 9 9 2 2',
    ]) {
      expect(() => buildExternalScene({
        ...safe,
        parts: [...safe.parts.slice(0, 2), { ...edge, geometry: { kind: 'path', d, points } }],
      })).toThrow(/semantic SVG path data|exactly one SVG subpath|closed must exactly match|canonical M\/L|supports only absolute M\/L\/Z/)
    }
    expect(() => buildExternalScene({
      ...safe,
      parts: [
        ...safe.parts.slice(0, 2),
        { ...edge, geometry: { kind: 'path', d: 'M 75 58 L 100 58 M 120 58 L 165 58', points } },
      ],
    })).toThrow(/exactly one SVG subpath|typed subpath geometry/)

    expect(() => buildExternalScene({
      ...safe,
      parts: [
        ...safe.parts.slice(0, 2),
        { ...edge, geometry: { kind: 'path', d: 'M 75 58 A 45 20 0 01 165 58', points } },
      ],
    })).toThrow(/supports only absolute M\/L\/Z/)

    expect(() => buildExternalScene({
      ...safe,
      parts: [
        ...safe.parts.slice(0, 2),
        { ...edge, geometry: { kind: 'path', d: 'M 75 58 L 165 58', points: [{ x: 75, y: 58 }, { x: 180, y: 58 }] } },
      ],
    })).toThrow(/vertices must exactly match typed connector points/)

    expect(() => buildExternalScene({
      ...safe,
      parts: [
        ...safe.parts.slice(0, 2),
        {
          ...edge,
          geometry: {
            kind: 'path',
            d: 'M 75 58 L 165 58',
            points,
            subpaths: [{ points, closed: false }],
          },
        },
      ],
    } as unknown as ExternalSceneInput)).toThrow(/does not expose typed connector subpaths/)

    const closedScene = buildExternalScene({
      ...safe,
      parts: [
        ...safe.parts.slice(0, 2),
        {
          ...edge,
          geometry: {
            kind: 'path',
            d: 'M 75 58 L 120 38 L 165 58 Z',
            points: [{ x: 75, y: 58 }, { x: 120, y: 38 }, { x: 165, y: 58 }],
          },
          closed: true,
        },
      ],
    })
    const closedConnector = closedScene.parts.find(part => part.kind === 'connector')
    expect(closedConnector?.kind).toBe('connector')
    if (closedConnector?.kind === 'connector') {
      expect(closedConnector.route.closed).toBe(true)
      expect(closedConnector.hit.closed).toBe(true)
    }
    for (const candidate of [
      { d: 'M 75 58 L 165 58 Z', closed: false },
      { d: 'M 75 58 L 165 58', closed: true },
    ]) {
      expect(() => buildExternalScene({
        ...safe,
        parts: [
          ...safe.parts.slice(0, 2),
          { ...edge, geometry: { kind: 'path', d: candidate.d, points }, closed: candidate.closed },
        ],
      })).toThrow(/closed must exactly match/)
    }

    const openScene = buildExternalScene({
      ...safe,
      parts: [
        ...safe.parts.slice(0, 2),
        { ...edge, geometry: { kind: 'path', d: 'M 75 58 L 165 58', points } },
      ],
    })
    const openConnector = openScene.parts.find(part => part.kind === 'connector')
    expect(openConnector?.kind).toBe('connector')
    if (openConnector?.kind === 'connector') {
      expect(openConnector.route.closed).toBe(false)
      expect(openConnector.hit.closed).toBe(false)
    }
  })

  test('projects one external mid marker repeatedly through SVG and terminal semantics', () => {
    const base = sceneInput('family:test/mid-marker', { bg: '#fff', fg: '#111' })
    const edge = base.parts[2]
    expect(edge?.kind).toBe('connector')
    if (!edge || edge.kind !== 'connector') return
    const withMidMarker: ExternalSceneInput = {
      ...base,
      parts: [
        ...base.parts.slice(0, 2),
        {
          ...edge,
          geometry: {
            kind: 'polyline',
            points: [{ x: 75, y: 58 }, { x: 120, y: 38 }, { x: 165, y: 58 }],
          },
          midMarker: ARROW.id,
        },
      ],
    }

    const scene = buildExternalScene(withMidMarker)
    const connector = scene.parts.find(part => part.kind === 'connector')
    expect(connector?.kind).toBe('connector')
    if (!connector || connector.kind !== 'connector') return
    expect(DefaultBackend.drawNode(connector, { seed: 0 })).toContain('marker-mid="url(#external-arrow)"')
    expect(connector.markers.mid).toEqual([expect.objectContaining({ id: ARROW.id })])
    expect(connector.terminalProjection.markers.mid).toEqual([expect.objectContaining({ id: ARROW.id })])
    expect(validateSceneDoc(scene, { mode: 'external' }).valid).toBe(true)

    expect(() => buildExternalScene({
      ...base,
      parts: [...base.parts.slice(0, 2), { ...edge, midMarker: 'missing-marker' }],
    })).toThrow(/Unknown external Scene marker/)
    expect(() => buildExternalScene({
      ...base,
      parts: [...base.parts.slice(0, 2), { ...edge, midMarker: ARROW.id }],
    })).toThrow(/no typed interior route points/)
    expect(() => buildExternalScene({
      ...base,
      parts: [...base.parts.slice(0, 2), {
        ...edge,
        geometry: {
          kind: 'path', d: 'M 75 58 L 120 38 L 165 58',
          points: [{ x: 75, y: 58 }, { x: 120, y: 38 }, { x: 165, y: 58 }],
        },
        midMarker: ARROW.id,
      }],
    })).toThrow(/does not expose exact SVG marker vertices/)
  })

  test('closes marker enums and keys, DOM ids, connector endpoints, and color booleans', () => {
    const base = sceneInput('family:test/typed-admission', { bg: '#fff', fg: '#111' })
    const edge = base.parts[2]
    expect(edge?.kind).toBe('connector')
    if (!edge || edge.kind !== 'connector') return

    for (const marker of [
      { ...ARROW, shape: 'forged' },
      { ...ARROW, units: 'forged' },
      { ...ARROW, orient: 'forged' },
      { ...ARROW, overflow: 'forged' },
      { ...ARROW, unknownMarkerField: true },
      { ...ARROW, size: { ...ARROW.size, unknownSizeField: true } },
    ]) {
      expect(() => buildExternalScene({ ...base, markers: [marker] } as unknown as ExternalSceneInput)).toThrow()
    }

    const collidingMarker = { ...ARROW, id: 'external-scene-title' }
    expect(() => buildExternalScene({
      ...base,
      markers: [collidingMarker],
      parts: [...base.parts.slice(0, 2), { ...edge, endMarker: collidingMarker.id }],
    })).toThrow(/collides with DOM id/)

    const { from: _from, to: _to, ...missingEndpoints } = edge
    expect(() => buildExternalScene({
      ...base,
      parts: [...base.parts.slice(0, 2), missingEndpoints],
    } as unknown as ExternalSceneInput)).toThrow(/required for external connectors/)
    expect(() => buildExternalScene({
      ...base,
      colors: { ...base.colors, shadow: 'forged' },
    } as unknown as ExternalSceneInput)).toThrow(/scene\.colors\.shadow: must be boolean/)

    for (const bounds of [
      { x0: Number.NaN, y0: 0, x1: 1, y1: 1 },
      { x0: 2, y0: 0, x1: 1, y1: 1 },
      { x0: 0, y0: 2, x1: 1, y1: 1 },
      { x0: 0, y0: 0, x1: 1, y1: 1 },
    ]) {
      expect(() => buildExternalScene({
        ...base,
        parts: [...base.parts.slice(0, 2), { ...edge, labels: [{ text: 'unsafe bounds', bounds }] }],
      })).toThrow(/bounds/)
    }
  })

  test('rejects malformed node records with stable boundary diagnostics', () => {
    const base = sceneInput('family:test/node-admission', { bg: '#fff', fg: '#111' })
    const malformed: Array<[Record<string, unknown>, RegExp]> = [
      [{ kind: 'container', id: 'group', role: 'group' }, /input\.parts\[0\]\.children must be a plain array/],
      [{ kind: 'shape', id: 'shape', role: 'node' }, /input\.parts\[0\]\.geometry must be a plain object/],
      [{ kind: 'text', id: 'label', role: 'label', x: 1, y: 2, fontSize: 12 }, /input\.parts\[0\]\.text must be a string/],
      [{ kind: 'not-a-node', id: 'unknown', role: 'node' }, /input\.parts\[0\]\.kind must be one of/],
    ]
    for (const [part, message] of malformed) {
      expect(() => buildExternalScene({ ...base, parts: [part] } as unknown as ExternalSceneInput)).toThrow(message)
    }
  })

  test('rejects oversized, sparse, accessor-backed, and custom-iterated arrays before iteration', () => {
    const base = sceneInput('family:test/input-preflight', { bg: '#fff', fg: '#111' })
    const oversized = new Array<ExternalSceneNode>(SCENE_VALIDATION_LIMITS.maxNodes + 1)
    expect(() => buildExternalScene({ ...base, parts: oversized })).toThrow(/too many entries/)

    const sparse = new Array<ExternalSceneNode>(1)
    expect(() => buildExternalScene({ ...base, parts: sparse })).toThrow(/must not be sparse/)

    let getterCalls = 0
    const accessorBacked: ExternalSceneNode[] = []
    Object.defineProperty(accessorBacked, '0', {
      enumerable: true,
      get() {
        getterCalls++
        return base.parts[0]
      },
    })
    expect(() => buildExternalScene({ ...base, parts: accessorBacked })).toThrow(/data property/)
    expect(getterCalls).toBe(0)

    const customIterated = [...base.parts]
    Object.defineProperty(customIterated, Symbol.iterator, {
      value: function* () {
        while (true) yield base.parts[0]!
      },
    })
    expect(() => buildExternalScene({ ...base, parts: customIterated })).toThrow(/custom array properties or iterators/)
  })

  test('bounds object property counts and property-key bytes before schema walking', () => {
    const base = sceneInput('family:test/object-preflight', { bg: '#fff', fg: '#111' })
    const propertyFlood = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`unknown${index}`, index]),
    )
    expect(() => buildExternalScene({ ...base, ...propertyFlood } as unknown as ExternalSceneInput))
      .toThrow(/contains too many properties/)

    const longKeyColors = { ...base.colors, ['x'.repeat(257)]: '#fff' }
    expect(() => buildExternalScene({ ...base, colors: longKeyColors } as unknown as ExternalSceneInput))
      .toThrow(/property key longer than 256 bytes/)

    const sharedLargeArray = Array.from({ length: SCENE_VALIDATION_LIMITS.maxNodes }, () => 0)
    const multipliedEntries = Array.from({ length: 17 }, () => new Proxy(sharedLargeArray, {}))
    expect(() => buildExternalScene({
      ...base,
      ignoredAggregateArrayPayload: multipliedEntries,
    } as unknown as ExternalSceneInput)).toThrow(/aggregate .*array-entry limit/)
  })

  test('compiles exactly the admitted descriptor snapshot rather than rereading a root Proxy', () => {
    const base = sceneInput('family:test/proxy-snapshot', { bg: '#fff', fg: '#111' })
    let liveGetCalls = 0
    const input = new Proxy(base, {
      get(target, property, receiver) {
        liveGetCalls++
        if (property === 'metadata') {
          return { ...target.metadata, title: 'FORGED LIVE TITLE' }
        }
        return Reflect.get(target, property, receiver)
      },
    })

    const scene = buildExternalScene(input)
    const svg = DefaultBackend.render(scene, { seed: 0 })
    expect(svg).toContain('Safe external Scene')
    expect(svg).not.toContain('FORGED LIVE TITLE')
    expect(liveGetCalls).toBe(0)
  })

  test('admits only own Scene input data and never inherits metadata or parts', () => {
    const base = sceneInput('family:test/inherited-input', { bg: '#fff', fg: '#111' })
    Object.defineProperty(Object.prototype, 'title', {
      value: 'INHERITED TITLE',
      enumerable: false,
      configurable: true,
    })
    try {
      expect(() => buildExternalScene({
        ...base,
        metadata: {} as ExternalSceneInput['metadata'],
      })).toThrow()
    } finally {
      delete (Object.prototype as { title?: unknown }).title
    }

    let inheritedPartReads = 0
    const inheritedParts: ExternalSceneNode[] = []
    Object.defineProperty(inheritedParts, '0', {
      enumerable: true,
      configurable: true,
      get() {
        inheritedPartReads++
        return base.parts[0]
      },
    })
    Object.defineProperty(Object.prototype, 'parts', {
      value: inheritedParts,
      enumerable: false,
      configurable: true,
    })
    try {
      const { parts: _parts, ...withoutOwnParts } = base
      expect(() => buildExternalScene(withoutOwnParts as ExternalSceneInput))
        .toThrow(/parts must be a plain array/)
      expect(inheritedPartReads).toBe(0)
    } finally {
      delete (Object.prototype as { parts?: unknown }).parts
    }
  })

  test('serializes the immutable admitted Scene rather than a late-swapping lowerScene Proxy', () => {
    const id = 'family:test/late-swap-scene'
    let armed = false
    let livePartsReads = 0
    const family = descriptor('late-swap-scene', 'lateSwapScene', ROLES, ctx => {
      const safe = buildExternalScene(sceneInput(id, ctx.colors))
      if (!armed) return safe
      const forged = [{ kind: 'document', element: 'content', id: 'forged', role: 'chrome' }]
      let scenePartsReads = 0
      return new Proxy(safe, {
        get(target, property, receiver) {
          if (property === 'parts') {
            livePartsReads++
            scenePartsReads++
            // Before snapshot admission, the family gate and DefaultBackend
            // completed 70 validation reads and serialized the 71st value.
            if (scenePartsReads >= 71) return forged as unknown as typeof safe.parts
          }
          return Reflect.get(target, property, receiver)
        },
      })
    })
    const unregister = registerFamily(family)
    try {
      armed = true
      for (const style of [
        undefined,
        { stroke: 'jittered' as const, roughness: 0.5 },
        { stroke: 'freehand' as const, strokeWidth: 1.4 },
      ]) {
        const svg = renderMermaidSVG(
          'lateSwapScene\n  opaque extension payload',
          style === undefined ? {} : { style },
        )
        expect(svg).toContain('data-id="left-node"')
        expect(svg).not.toContain('audit.invalid')
        expect(verifyNoExternalRefs(svg)).toEqual({ ok: true, refs: [] })
      }
      // Descriptor-based snapshotting never invokes the live root get trap.
      expect(livePartsReads).toBe(0)
    } finally {
      unregister()
    }
  })

  test('direct exported backends serialize their admitted snapshot rather than a late-swapping Scene Proxy', () => {
    const safe = buildExternalScene(sceneInput('family:test/direct-backend-snapshot', { bg: '#fff', fg: '#111' }))
    let validationPartsReads = 0
    const measuring = new Proxy(safe, {
      get(target, property, receiver) {
        if (property === 'parts') validationPartsReads++
        return Reflect.get(target, property, receiver)
      },
    })
    expect(validateSceneDoc(measuring, { mode: 'external' }).valid).toBe(true)
    expect(validationPartsReads).toBeGreaterThan(0)

    const forgedParts = [{ kind: 'document', element: 'content', id: 'forged', role: 'chrome' }]
    const backends = [DefaultBackend, getBackend('rough'), getBackend('hybrid')]
    for (const backend of backends) {
      expect(backend).toBeDefined()
      if (!backend) continue
      let livePartsReads = 0
      const swapping = new Proxy(safe, {
        get(target, property, receiver) {
          if (property === 'parts' && ++livePartsReads > validationPartsReads) {
            return forgedParts as unknown as typeof safe.parts
          }
          return Reflect.get(target, property, receiver)
        },
      })
      const svg = backend.render(swapping, { seed: 0 })
      expect(svg, backend.id).toContain('Safe external Scene')
      expect(svg, backend.id).not.toContain('audit.invalid')
      expect(livePartsReads, backend.id).toBe(0)
    }
  })

  test('bounds aggregate text and point collections before compilation', () => {
    const textBase = sceneInput('family:test/text-budget', { bg: '#fff', fg: '#111' })
    const textChunk = 'x'.repeat(Math.floor(SCENE_VALIDATION_LIMITS.maxTextBytes / 3) + 1)
    expect(() => buildExternalScene({
      ...textBase,
      parts: [0, 1, 2].map(index => ({
        kind: 'text' as const,
        id: `large-text-${index}`,
        role: 'label' as const,
        text: textChunk,
        x: 10,
        y: 10 + index * 10,
        fontSize: 8,
      })),
    })).toThrow(/aggregate .*byte limit/)

    const pointBase = sceneInput('family:test/point-budget', { bg: '#fff', fg: '#111' })
    const sharedPoint = { x: 1, y: 1 }
    expect(() => buildExternalScene({
      ...pointBase,
      parts: [{
        kind: 'shape',
        id: 'too-many-points',
        role: 'node',
        geometry: {
          kind: 'polyline',
          points: Array.from({ length: SCENE_VALIDATION_LIMITS.maxPoints + 1 }, () => sharedPoint),
        },
      }],
    })).toThrow(/aggregate .*point limit/)

    const valid = buildExternalScene(sceneInput('family:test/svg-budget', { bg: '#fff', fg: '#111' }))
    const groupIndex = valid.parts.findIndex(part => part.kind === 'group')
    const group = valid.parts[groupIndex]
    expect(group?.kind).toBe('group')
    if (!group || group.kind !== 'group') return
    const text = group.children.map(child => child.node).find(node => node.kind === 'text')
    expect(text?.kind).toBe('text')
    if (!text || text.kind !== 'text') return
    const close = valid.parts.at(-1)!
    const furniture = valid.parts.slice(0, groupIndex)
    const textTooLarge = validateSceneDoc({
      ...valid,
      parts: [
        ...furniture,
        ...[0, 1, 2].map(index => ({ ...text, id: `manual-large-text-${index}`, text: textChunk })),
        close,
      ],
    }, { mode: 'external' })
    expect(textTooLarge.diagnostics).toContainEqual(expect.objectContaining({
      code: 'SCENE_BOUNDS',
      message: expect.stringContaining('Scene text values exceed the aggregate'),
    }))

    const shape = valid.parts.find(part => part.kind === 'shape')
    expect(shape?.kind).toBe('shape')
    if (!shape || shape.kind !== 'shape') return
    const pointsTooLarge = validateSceneDoc({
      ...valid,
      parts: [
        ...furniture,
        {
          ...shape,
          id: 'manual-large-polyline',
          geometry: {
            kind: 'polyline',
            points: Array.from({ length: SCENE_VALIDATION_LIMITS.maxPoints + 1 }, () => sharedPoint),
          },
        },
        close,
      ],
    }, { mode: 'external' })
    expect(pointsTooLarge.diagnostics).toContainEqual(expect.objectContaining({
      code: 'SCENE_BOUNDS',
      message: expect.stringContaining('Scene points exceed the aggregate'),
    }))

  })

  test('applies the point limit to typed point collections rather than x/y-bearing shapes', () => {
    const make = (kind: 'rect' | 'circle'): ExternalSceneInput => ({
      version: EXTERNAL_SCENE_API_VERSION,
      family: 'family:test/point-accounting',
      width: 10,
      height: 10,
      colors: { bg: '#fff', fg: '#111' },
      metadata: { title: 'Point accounting' },
      parts: Array.from({ length: SCENE_VALIDATION_LIMITS.maxPoints + 1 }, (_, index) => ({
        kind: 'shape' as const,
        id: `n${index}`,
        role: 'node' as const,
        geometry: kind === 'rect'
          ? { kind: 'rect' as const, x: 1, y: 1, width: 0, height: 0 }
          : { kind: 'circle' as const, cx: 1, cy: 1, r: 0 },
      })),
    })

    expect(buildExternalScene(make('rect')).parts)
      .toHaveLength(SCENE_VALIDATION_LIMITS.maxPoints + 4)
    expect(buildExternalScene(make('circle')).parts)
      .toHaveLength(SCENE_VALIDATION_LIMITS.maxPoints + 4)
  })

  test('rejects undeclared primitives and malformed manual connector semantics before rendering', () => {
    const roles = ROLES.map(row => row.role === 'bar' ? { role: 'bar' as const, primitives: ['shape' as const] } : row)
    const family = descriptor('undeclared-scene', 'undeclaredScene', roles, ctx => buildExternalScene(sceneInput('family:test/undeclared-scene', ctx.colors)))
    expect(() => registerFamily(family)).toThrow(/undeclared bar\/data-mark primitive/)

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
