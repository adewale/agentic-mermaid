// Scene-fidelity gate: for every family with a SceneGraph lowering, the
// semantic fields on each mark (geometry, markers, text) must agree with the
// mark's canonical serialization. Styled backends redraw from the semantic fields,
// so a divergence here means a styled render would silently draw different
// geometry than the crisp output shows — the regex-era blindness the IR
// exists to eliminate (SPEC §3.1).
//
// Runs the full layout-compare corpus through every registered lowerScene
// hook (replicating the index.ts dispatch plumbing) and reports every
// unfaithful mark, not just the first.

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { collectSamples } from '../../eval/layout-compare/run.ts'
import { getFamily, knownBuiltinFamilies } from '../agent/families.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { resolvedRenderExecutionPlanOf, resolveRenderRequest } from '../render-contract.ts'
import { BUILTIN_RENDER_HOOKS } from '../render-family-hooks.ts'
import { admitFamilyScene } from '../scene/admission.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { admitSceneDocument, admitBackendSceneDocument, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, snapshotBoundedExternalData } from '../scene/external-data-snapshot.ts'
import { buildExternalScene, EXTERNAL_SCENE_API_VERSION } from '../scene/external-scene.ts'
import { sceneFidelityProblems } from '../scene/fidelity.ts'
import { inspectScenePrimitives } from '../scene/inspection.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import { SECTION_B_FAMILY_CENSUS_FIXTURES } from '../scene/section-b-census-fixtures.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'
import type { RenderOptions } from '../types.ts'
import { useTestChildren } from './helpers/test-child.ts'
import { markerContact } from './helpers/marker-contact.ts'

const runChild = useTestChildren(20_000)

interface Lowered {
  id: string
  family: string
  doc: SceneDoc
}

/** Mirror the built-in renderMermaidSVG dispatch through its sole graphical
 * waist (before the resolve() post-pass, which is scene-independent). */
function lowerSample(source: string, options: RenderOptions = {}): { doc: SceneDoc } | { dropped: string } | undefined {
  let request: ReturnType<typeof resolveRenderRequest>
  let family: ReturnType<typeof resolvedRenderExecutionPlanOf>['family']
  let layout: ReturnType<typeof positionResolvedFamily>
  try {
    request = resolveRenderRequest(source, options, 'svg')
    family = resolvedRenderExecutionPlanOf(request).family
    if (!family?.layout || !family.lowerScene) return undefined
    layout = positionResolvedFamily(family.id, request)
  } catch (error) {
    // Diagrams that legitimately fail are the equivalence gate's concern, but
    // every drop is recorded so a layout regression cannot shrink the corpus.
    return { dropped: error instanceof Error ? error.message : String(error) }
  }
  const ctx = {
    positioned: layout.positioned,
    colors: request.appearance.colors,
    resolved: {
      renderOptions: request.renderOptions,
      ...(request.appearance.face ? { styleFace: request.appearance.face } : {}),
      ...(request.familyConfig ? { familyConfig: request.familyConfig } : {}),
      ...(request.appearance.family ? { familyAppearance: request.appearance.family } : {}),
    },
  }
  return { doc: family.lowerScene(ctx) }
}

function lowerAll(): { scenes: Lowered[]; dropped: Array<{ id: string; reason: string }> } {
  const scenes: Lowered[] = []
  const dropped: Array<{ id: string; reason: string }> = []
  const samples: Array<{ id: string; family: string; source: string; options?: RenderOptions }> = [
    ...collectSamples(),
    ...Object.entries(SECTION_B_FAMILY_CENSUS_FIXTURES).map(([family, source]) => ({ id: `composition/${family}`, family, source })),
    ...knownBuiltinFamilies().map(family => ({ id: `registry/${family}`, family, source: getFamily(family)!.example })),
  ]
  const gantt = samples.find(sample => sample.id === 'fixture/gantt-basic.mmd')!
  samples.push({ ...gantt, id: `${gantt.id}/dependency-arrows`, options: { gantt: { dependencyArrows: true } } })
  for (const sample of samples) {
    const lowered = lowerSample(sample.source, sample.options)
    if (!lowered) continue
    if ('dropped' in lowered) dropped.push({ id: sample.id, reason: lowered.dropped })
    else scenes.push({ id: sample.id, family: sample.family, ...lowered })
  }
  return { scenes, dropped }
}

describe('scene fidelity', () => {
  const { scenes, dropped } = lowerAll()

  test('reuses only its own immutable admitted Scene without retaining mutable caller data', () => {
    const source = { ...scenes[0]!.doc }
    const admitted = admitBackendSceneDocument(source)
    expect(admitted).not.toBe(source)
    expect(admitBackendSceneDocument(admitted)).toBe(admitted)
    expect(Object.isFrozen(admitted.parts)).toBe(true)
    expect(Object.isFrozen(admitted.parts[0])).toBe(true)
    const svg = DefaultBackend.render(admitted, { seed: 0 })
    source.width = Number.NaN
    expect(DefaultBackend.render(admitted, { seed: 0 })).toBe(svg)
    expect(() => admitBackendSceneDocument(source)).toThrow()
    const unownedFrozen = Object.freeze({ ...admitted })
    expect(admitBackendSceneDocument(unownedFrozen)).not.toBe(unownedFrozen)
    const proxy = new Proxy(admitted, {})
    expect(admitBackendSceneDocument(proxy)).not.toBe(admitted)
  })

  test('admitted Scene reuse retains backend mode inference and family role authority', () => {
    const builtIn = scenes[0]!
    const family = getFamily(builtIn.family)!
    const internalOnly = admitFamilyScene(family, {
      ...builtIn.doc,
      family: 'family:test/needs-external-validation',
    })
    expect(() => admitBackendSceneDocument(internalOnly)).toThrow()
    expect(() => DefaultBackend.render(internalOnly, { seed: 0 })).toThrow()
    const external = admitBackendSceneDocument(
      buildExternalScene({
        version: EXTERNAL_SCENE_API_VERSION,
        family: 'family:test/admission-mode-reuse',
        width: 100,
        height: 100,
        colors: { bg: '#fff', fg: '#111' },
        metadata: { title: 'Admitted' },
        parts: [],
      }),
    )
    expect(admitBackendSceneDocument(external)).toBe(external)
    expect(DefaultBackend.render(external, { seed: 0 })).toContain('<svg')
    const admitted = admitFamilyScene(family, builtIn.doc)
    expect(admitFamilyScene(family, admitted)).toBe(admitted)
    expect(admitBackendSceneDocument(admitted)).toBe(admitted)
    expect(() => admitFamilyScene({ ...family, semanticRoles: [] }, admitted)).toThrow(/undeclared role/)
    // A built-in's document is frozen in place, which still refuses a hole
    // rather than reading it through Array.prototype.
    const holed = [...builtIn.doc.parts]
    holed.length += 1
    expect(() => admitFamilyScene(family, { ...builtIn.doc, parts: holed })).toThrow(/scene\.parts must not be sparse/)
  })

  test('the corpus exercises every built-in family with a scene lowering', () => {
    const lowering = Object.entries(BUILTIN_RENDER_HOOKS)
      .filter(([, hooks]) => 'lowerScene' in hooks)
      .map(([id]) => id)
      .sort()
    expect(lowering.length).toBeGreaterThan(0)
    expect([...new Set(scenes.map(scene => scene.family))].sort()).toEqual(lowering)
  })

  test('only the known-unrenderable corpus samples drop out before lowering', () => {
    // gantt/6 lowers an explicit empty state. gantt/10 still carries an
    // undocumented workaround task tag and raw themeCSS, which default
    // security refuses. Inline task comments now read generously, but do not
    // make these other invalid/unsafe inputs lowerable.
    expect(dropped.map(sample => sample.id).sort()).toEqual(['corpus/gantt/10'])
  })

  test('semantic fields agree with canonical serialization for every lowered mark', () => {
    const problems: string[] = []
    for (const scene of scenes) {
      for (const problem of sceneFidelityProblems(scene.doc)) {
        problems.push(`${scene.id}: ${problem}`)
      }
    }
    if (problems.length > 0) {
      throw new Error(`scene fidelity violations (${problems.length}):\n` + problems.slice(0, 40).join('\n'))
    }
  })

  test('registered marker-producing families retain explicit contact meanings and reference points', () => {
    const resources = new Set<string>(), uses = new Set<string>()
    for (const { family, doc } of scenes) {
      const visit = (node: SceneNode): void => {
        if (node.kind === 'document') for (const marker of node.markerResources ?? []) {
          resources.add(family)
          const contact = markerContact(family, marker)
          if (contact.point && contact.attachment !== 'free-axis') expect(marker.ref, `${family}/${marker.id}: ${contact.attachment}`).toEqual(contact.point)
        }
        if (node.kind === 'connector' && (node.markers.start || node.markers.end || node.markers.mid.length)) uses.add(family)
        if (node.kind === 'group') for (const child of node.children) visit(child.node)
      }
      for (const node of doc.parts) visit(node)
    }
    // Both sets come from the registry-enrolled corpus above. An unclassified
    // new family's resource fails at its meaning, without copying family IDs.
    expect(resources.size).toBeGreaterThan(0)
    expect([...resources].sort()).toEqual([...uses].sort())
  })

  test('no family stylesheet restyles what a typed mark draws', () => {
    // The writer emits a mark's paint and typography as presentation
    // attributes, which any stylesheet rule overrides; certification reads the
    // typed fields. So no rule may set them on a class a typed mark carries.
    // Interactive-state rules (`:hover`) and conditional artwork are excluded.
    const drawn = /^(?:fill|fill-opacity|stroke|stroke-[a-z]+|opacity|color|paint-order|marker(?:-start|-mid|-end)?|font-size|font-weight|font-style|letter-spacing|text-anchor|text-decoration|dominant-baseline|transform|display|visibility)$/
    const problems: string[] = []
    for (const scene of scenes) {
      const css = scene.doc.parts
        .filter(part => part.kind === 'document')
        .flatMap(part => sceneNodeSerialization(part).match(/<style>[\s\S]*?<\/style>/g) ?? [])
        .join('\n')
      const rules = [...css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selectors, body]) => {
        const properties = body!
          .split(';')
          .map(declaration => declaration.split(':')[0]!.trim())
          .filter(property => drawn.test(property))
        return properties.length === 0
          ? []
          : selectors!
              .split(',')
              .map(selector => selector.trim())
              .filter(selector => selector && !selector.includes(':'))
              .map(selector => {
                const compound = selector
                  .split(/[\s>+~]+/)
                  .filter(Boolean)
                  .at(-1)!
                return { selector, properties, element: /^[a-z]+/.exec(compound)?.[0], classes: [...compound.matchAll(/\.([\w-]+)/g)].map(match => match[1]!) }
              })
      })
      const visit = (node: SceneNode, conditional: boolean): void => {
        if (node.kind === 'group') {
          for (const child of node.children) visit(child.node, conditional || node.visibility === 'conditional')
          return
        }
        if (node.kind === 'document' || conditional || node.visibility === 'conditional') return
        const classes = new Set(node.attributes?.className?.split(' ') ?? [])
        // The elements the writer emits for this mark.
        const elements = new Set(node.kind === 'text' ? ['text', 'tspan'] : node.kind === 'connector' ? [node.route.geometry.kind, 'text'] : node.geometry.kind === 'compound' ? node.geometry.children.map(child => child.kind) : [node.geometry.kind])
        for (const rule of rules) {
          const matches = rule.classes.length > 0 ? rule.classes.every(name => classes.has(name)) && (!rule.element || elements.has(rule.element)) : rule.element !== undefined && elements.has(rule.element)
          if (matches) problems.push(`${scene.id}: "${rule.selector}" sets ${rule.properties.join(', ')} on ${node.kind} ${node.id}`)
        }
      }
      for (const part of scene.doc.parts) visit(part, false)
    }
    expect(problems.slice(0, 40)).toEqual([])
  })

  test('all final artwork is measured or explicitly non-painting across the corpus', () => {
    const missing: string[] = []
    for (const scene of scenes) {
      const inspection = inspectScenePrimitives(scene.doc)
      for (const primitive of inspection.primitives) {
        if (primitive.coverage === 'unmeasured') missing.push(`${scene.id}: ${primitive.id}: ${primitive.reason}`)
        if (primitive.text && primitive.coverage !== 'non-painting' && primitive.text.measurement !== 'prepared') missing.push(`${scene.id}: ${primitive.id}: text was not retained from layout`)
      }
    }
    expect(missing).toEqual([])
  })

  test('sequence label gaps preserve unique identities beside delimiter-bearing actor ids', () => {
    const lowered = lowerSample(`sequenceDiagram
      participant A
      participant B
      participant C
      participant B:start
      activate B
      A->>C: across B
      A->>C: across B again
      deactivate B`)
    expect(lowered && 'doc' in lowered).toBe(true)
    if (!lowered || !('doc' in lowered)) throw new Error('sequence did not lower')
    const nodes: SceneDoc['parts'] = []
    const visit = (node: SceneDoc['parts'][number]): void => {
      nodes.push(node)
      if (node.kind === 'group') for (const child of node.children) visit(child.node)
    }
    for (const node of lowered.doc.parts) visit(node)
    const ids = nodes.map(node => node.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(nodes).toContainEqual(expect.objectContaining({ id: 'lifeline:B', kind: 'group', role: 'lifeline' }))
    expect(nodes).toContainEqual(expect.objectContaining({ id: 'lifeline:B:start', kind: 'connector', role: 'lifeline' }))
    expect(nodes).toContainEqual(expect.objectContaining({ id: 'activation:B#0', kind: 'group', role: 'activation' }))
    expect(sceneFidelityProblems(lowered.doc)).toEqual([])
  })

  test('public Scene nodes expose no serialization carriers', () => {
    const violations: string[] = []
    const visit = (node: SceneDoc['parts'][number], family: string): void => {
      for (const key of ['crisp', 'raw', 'prelude']) {
        if (Object.prototype.hasOwnProperty.call(node, key)) violations.push(`${family}:${node.id}:${key}`)
      }
      if (node.kind === 'group') for (const child of node.children) visit(child.node, family)
    }
    for (const scene of scenes) for (const part of scene.doc.parts) visit(part, scene.family)
    expect(violations).toEqual([])
  })

  test('DefaultBackend deterministically serializes every lowered scene', () => {
    for (const scene of scenes) {
      const first = DefaultBackend.render(scene.doc, { seed: 0 })
      const second = DefaultBackend.render(scene.doc, { seed: 0 })
      expect(second, `${scene.id} (${scene.family})`).toBe(first)
      expect(first, `${scene.id} (${scene.family})`).toContain('<svg')
      expect(first, `${scene.id} (${scene.family})`).not.toMatch(/NaN|undefined/)
    }
  })
})

describe('built-in Scene cross-checks', () => {
  test('a cheap admission cannot suppress later strict connector checks', () => {
    const lowered = lowerSample('flowchart LR\n  A --> B')
    if (!lowered || !('doc' in lowered)) throw new Error('Expected native Scene')
    const connectors = (node: SceneNode): Array<Extract<SceneNode, { kind: 'connector' }>> =>
      node.kind === 'connector' ? [node] : node.kind === 'group' ? node.children.flatMap(child => connectors(child.node)) : []
    const connector = lowered.doc.parts.flatMap(connectors)[0]!
    Object.assign(connector, { terminalProjection: { ...connector.terminalProjection, relationship: 'not-derived' } })
    const admitted = admitSceneDocument(lowered.doc, 'internal', false)
    expect(admitted).not.toBe(lowered.doc)
    expect(() => admitSceneDocument(admitted, 'internal', true)).toThrow(/terminalProjection/)
  })

  test('render skips them unless scene assertions are on; verify, strict renders and ASCII always run them', async () => {
    // A lowering that stores a connector projection disagreeing with the one
    // derived from its own semantics. Fresh processes control the variable the
    // test preload sets.
    const probe = async (assertions: boolean) => {
      const env = { ...process.env }
      if (assertions) env.AGENTIC_MERMAID_SCENE_ASSERTIONS = '1'
      else delete env.AGENTIC_MERMAID_SCENE_ASSERTIONS
      const result = await runChild(
        process.execPath,
        [
          '--eval',
          `
        const { getFamily, replaceFamilyForTest } = await import('./src/agent/families.ts')
        const { renderMermaidSVG, renderMermaidASCIIWithReceipt } = await import('./src/index.ts')
        const { verifyMermaid } = await import('./src/agent/verify.ts')
        const { resolveRenderRequest } = await import('./src/render-contract.ts')
        const { positionResolvedFamily } = await import('./src/positioning.ts')
        const { renderPositionedMermaidSVG } = await import('./src/graphical-render.ts')
        const { assertScenesOf } = await import('./src/scene/assertions.ts')
        const descriptor = getFamily('flowchart')
        const lowerScene = descriptor.lowerScene
        const connectors = node => node.kind === 'connector' ? [node] : node.kind === 'group' ? node.children.flatMap(child => connectors(child.node)) : []
        replaceFamilyForTest('flowchart', { ...descriptor, lowerScene(context) {
          const scene = lowerScene(context)
          const connector = scene.parts.flatMap(connectors)[0]
          connector.terminalProjection = { ...connector.terminalProjection, relationship: 'not-derived' }
          return scene
        } })
        const source = 'flowchart LR\\n  A --> B'
        const attempt = run => { try { run(); return 'rendered' } catch (error) { return error.message } }
        const render = attempt(() => renderMermaidSVG(source))
        const strict = attempt(() => renderMermaidSVG(source, { layoutSafety: 'strict' }))
        const verify = verifyMermaid(source).warnings.filter(warning => warning.code === 'RENDER_FAILED' || warning.code === 'INTERNAL_ERROR')
        const ascii = renderMermaidASCIIWithReceipt(source).terminalStyle.diagnostics.map(diagnostic => diagnostic.code)
        const request = resolveRenderRequest(source)
        const positioned = positionResolvedFamily('flowchart', request)
        const retainedBefore = attempt(() => renderPositionedMermaidSVG(request, positioned, []))
        assertScenesOf(request)
        const retainedAfter = attempt(() => renderPositionedMermaidSVG(request, positioned, []))
        console.log(JSON.stringify({ render, strict, verify, ascii, retainedBefore, retainedAfter }))
      `], { cwd: join(import.meta.dir, '..', '..'), env })
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
      return JSON.parse(result.stdout) as { render: string; strict: string; verify: unknown[]; ascii: string[]; retainedBefore: string; retainedAfter: string }
    }
    const projectionMismatch = /terminalProjection: must equal the canonical projection derived from connector semantics/
    // The mismatch is a lowering defect, never the source's: verify reports it
    // as INTERNAL_ERROR and says whether an ordinary render still draws.
    const defect = (defaultRender: string) => [{ code: 'INTERNAL_ERROR', reason: expect.stringMatching(projectionMismatch), defaultRender }]
    const off = await probe(false)
    expect(off.render).toBe('rendered')
    // Strict layout safety, verify and the ASCII connector projection, which
    // all rely on the derived facts, still cross-check them.
    expect(off.strict).toMatch(projectionMismatch)
    expect(off.verify).toEqual(defect('succeeds-unchecked'))
    expect(off.ascii).toContain('TERMINAL_CONNECTOR_PROJECTION_UNAVAILABLE')
    expect(off.retainedBefore).toBe('rendered')
    expect(off.retainedAfter).toMatch(projectionMismatch)
    const on = await probe(true)
    expect(on.render).toMatch(projectionMismatch)
    expect(on.retainedBefore).toMatch(projectionMismatch)
    expect(on.retainedAfter).toMatch(projectionMismatch)
    expect(on.verify).toEqual(defect('fails'))
  })
})

describe('bounded Scene admission snapshot', () => {
  // Small limits stand in for the multi-megabyte production ones.
  const limits = { ...EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, maxTextBytes: 30, maxPropertyKeyBytes: 6, maxAggregatePropertyKeyBytes: 12 }
  test.each([
    ['ASCII text under the byte limit but over the three-byte bound', { a: 'x'.repeat(14), b: 'y'.repeat(16) }, undefined],
    ['ASCII text one byte over', { a: 'x'.repeat(15), b: 'y'.repeat(16) }, 'text values exceed the aggregate 30-byte limit'],
    ['three-byte characters over', { a: '€'.repeat(11) }, 'text values exceed the aggregate 30-byte limit'],
    ['keys under the aggregate limit but over the bound', { abcdef: 1, ghijkl: 2 }, undefined],
    ['keys over the aggregate limit', { abcdef: 1, ghijkl: 2, m: 3 }, 'property keys exceed the aggregate 12-byte limit'],
    ['a key over the per-key limit', { abcdefg: 1 }, 'property key longer than 6 bytes'],
    ['a sparse array, named by its path', { parts: [{ points: [0, , 2] }] }, 'External Scene scene.parts[0].points must not be sparse'],
  ] as const)('%s', (_name, document, error) => {
    const value = structuredClone(document)
    const admit = () => snapshotBoundedExternalData(value, limits, 'scene')
    if (error) expect(admit).toThrow(error)
    else {
      const snapshot = admit()
      expect(snapshot).not.toBe(value)
      expect(snapshot).toEqual(value)
      expect(Object.isFrozen(snapshot)).toBe(true)
    }
  })
})
