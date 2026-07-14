// Higher-level executable registration for external Mermaid families.
//
// The low-level registry stays renderer-independent in families.ts. This
// module temporarily stages one immutable candidate, exercises its bounded
// example through the same canonical paths public callers use, and commits
// only when every declared native capability has a deterministic witness.

import {
  FAMILY_CAPABILITY_COLUMNS,
  FAMILY_CONFORMANCE_VERSION,
  getFamilyConformanceReport,
  stageFamilyCandidateForConformance,
  type FamilyCapability,
  type FamilyCapabilityConformanceResult,
  type FamilyConformanceReport,
  type FamilyDescriptor,
} from './families.ts'
import { parseRegisteredMermaid } from './parse.ts'
import { serializeMermaid } from './serialize.ts'
import { positionFamilyArtifact } from './family-layouts.ts'
import { verifyMermaid } from './verify.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { RESOLVED_TERMINAL_COLOR_MODES } from '../terminal-contract.ts'
import {
  executeGraphicalRequest,
  lowerPositionedFamilyScene,
} from '../graphical-render.ts'
import { renderPortablePngGraphicalProjection } from '../png-graphical.ts'
import { positionResolvedFamily } from '../positioning.ts'
import {
  assertFamilyScopedRenderOptionDeclaration,
  receiptOf,
  renderContractDigest,
  resolveRenderRequestForExecution,
} from '../render-contract.ts'
import { sceneNodePrimitives } from '../scene/capabilities.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'

const WITNESS_RENDER_OPTIONS = Object.freeze({
  security: 'strict' as const,
  embedFontImport: false,
})

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parsedExample(descriptor: FamilyDescriptor) {
  const parsed = parseRegisteredMermaid(descriptor.example)
  if (!parsed.ok) {
    throw new Error(parsed.error.map(error => `${error.code}: ${error.message}`).join('; '))
  }
  if (parsed.value.kind !== descriptor.id) {
    throw new Error(`canonical example routed to "${parsed.value.kind}" instead of "${descriptor.id}"`)
  }
  return parsed.value
}

function parsedWitness(descriptor: FamilyDescriptor): unknown {
  const parsed = parsedExample(descriptor)
  // SourceMap intentionally contains Maps for runtime lookup. It is not
  // descriptor output and has its own deterministic contract, so keep the
  // conformance witness on the family-owned body plus core source envelope.
  return {
    kind: parsed.kind,
    ...('descriptorIdentity' in parsed ? { descriptorIdentity: parsed.descriptorIdentity } : {}),
    meta: parsed.meta,
    body: parsed.body,
    canonicalSource: parsed.canonicalSource,
  }
}

function serializationWitness(descriptor: FamilyDescriptor): unknown {
  const serialized = serializeMermaid(parsedExample(descriptor))
  const reparsed = parseRegisteredMermaid(serialized)
  if (!reparsed.ok) {
    throw new Error(`serialized canonical example did not reparse: ${reparsed.error.map(error => error.message).join('; ')}`)
  }
  if (reparsed.value.kind !== descriptor.id) {
    throw new Error(`serializer changed family identity to "${reparsed.value.kind}"`)
  }
  const serializedAgain = serializeMermaid(reparsed.value)
  if (serializedAgain !== serialized) {
    throw new Error('serializer is not byte-stable after parse → serialize → reparse')
  }
  return { serialized, reparsedKind: reparsed.value.kind, canonicalSource: reparsed.value.canonicalSource }
}

function layoutWitness(descriptor: FamilyDescriptor): unknown {
  const parsed = parsedExample(descriptor)
  const artifact = positionFamilyArtifact(parsed, {
    output: 'layout',
    renderOptions: WITNESS_RENDER_OPTIONS,
  })
  if (!artifact) throw new Error(`canonical example has no public positioned-layout projection`)
  const positionedBounds = [artifact.positioned.width, artifact.positioned.height]
  const projectedBounds = [artifact.rendered.bounds.w, artifact.rendered.bounds.h]
  if ([...positionedBounds, ...projectedBounds].some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error('canonical example layout and projected bounds must be finite and positive')
  }
  if (artifact.rendered.nodes.length + artifact.rendered.edges.length + artifact.rendered.groups.length === 0) {
    throw new Error('canonical example layout must expose at least one semantic node, edge, or group')
  }
  return {
    layout: artifact.rendered,
    receiptDigest: renderContractDigest(receiptOf(artifact.request)),
  }
}

function visitScene(nodes: readonly SceneNode[], callback: (node: SceneNode) => void): void {
  for (const node of nodes) {
    callback(node)
    if (node.kind === 'group') visitScene(node.children.map(child => child.node), callback)
  }
}

function sceneWitness(descriptor: FamilyDescriptor): unknown {
  const request = resolveRenderRequestForExecution(
    descriptor.example,
    WITNESS_RENDER_OPTIONS,
    'svg',
  )
  const layout = positionResolvedFamily(descriptor.id, request)
  const scene: SceneDoc = lowerPositionedFamilyScene(request, layout)
  const observed = new Set<string>()
  visitScene(scene.parts, node => {
    for (const primitive of sceneNodePrimitives(node)) observed.add(`${node.role}\u0000${primitive}`)
  })
  const missing = descriptor.scenePrimitiveEvidence
    .filter(cell => cell.applicability === 'applicable')
    .filter(cell => !observed.has(`${cell.role}\u0000${cell.primitive}`))
    .map(cell => `${cell.role}/${cell.primitive}`)
  if (missing.length > 0) {
    throw new Error(`canonical example did not witness declared positive Scene cells: ${missing.join(', ')}`)
  }
  return {
    sceneDigest: renderContractDigest(scene),
    cells: [...observed].sort(),
    receiptDigest: renderContractDigest(receiptOf(request)),
  }
}

function svgWitness(descriptor: FamilyDescriptor): unknown {
  const svg = executeGraphicalRequest(
    descriptor.example,
    WITNESS_RENDER_OPTIONS,
    'svg',
  )
  // SVG support also promises a valid, offline pre-raster artifact. This
  // catches invalid root dimensions/viewBox before any native/WASM/browser
  // rasterizer is involved.
  const png = renderPortablePngGraphicalProjection(
    descriptor.example,
    WITNESS_RENDER_OPTIONS,
  )
  return {
    svg: svg.svg,
    svgReceiptDigest: renderContractDigest(svg.receipt),
    pngSvg: png.svg,
    pngReceiptDigest: renderContractDigest(png.receipt),
    rasterBackground: png.rasterBackground,
    rasterDimensions: png.rasterDimensions,
  }
}

function terminalWitness(descriptor: FamilyDescriptor): unknown {
  const outputs = []
  for (const useAscii of [true, false] as const) {
    for (const colorMode of RESOLVED_TERMINAL_COLOR_MODES) {
      const encoding = useAscii ? 'ascii' : 'unicode'
      let rendered: ReturnType<typeof renderMermaidASCIIWithReceipt>
      try {
        rendered = renderMermaidASCIIWithReceipt(descriptor.example, {
          ...WITNESS_RENDER_OPTIONS,
          useAscii,
          colorMode,
        })
      } catch (error) {
        throw new Error(`${encoding}/${colorMode} terminal witness failed: ${reasonOf(error)}`)
      }
      outputs.push({
        encoding,
        colorMode,
        textDigest: renderContractDigest(rendered.text),
        receiptDigest: renderContractDigest(rendered.receipt),
      })
    }
  }
  return { outputs }
}

function verifyWitness(descriptor: FamilyDescriptor): unknown {
  const verified = verifyMermaid(descriptor.example, { renderOptions: WITNESS_RENDER_OPTIONS })
  if (!verified.ok) {
    const diagnostics = verified.warnings.map(warning => warning.code === 'RENDER_FAILED'
      ? `${warning.code}: ${warning.reason}`
      : warning.code)
    throw new Error(`canonical example failed verification: ${diagnostics.join(', ')}`)
  }
  return verified
}

function capabilityWitness(descriptor: FamilyDescriptor, capability: FamilyCapability): unknown {
  switch (capability) {
    case 'detection': {
      const parsed = parsedExample(descriptor)
      return { family: parsed.kind, canonicalSource: parsed.canonicalSource }
    }
    case 'source-preservation': {
      const parsed = parsedExample(descriptor)
      return {
        family: parsed.kind,
        canonicalSource: parsed.canonicalSource,
        roundtrip: serializationWitness(descriptor),
      }
    }
    case 'parse': return parsedWitness(descriptor)
    case 'serialize': return serializationWitness(descriptor)
    case 'mutation': throw new Error('external structured mutation is not an executable native capability')
    case 'verify': return verifyWitness(descriptor)
    case 'layout': return layoutWitness(descriptor)
    case 'scene': return sceneWitness(descriptor)
    case 'svg': return svgWitness(descriptor)
    case 'terminal': return terminalWitness(descriptor)
  }
}

function runCapabilityConformance(
  descriptor: FamilyDescriptor,
  capability: FamilyCapability,
): FamilyCapabilityConformanceResult {
  const declaredState = descriptor.capabilityEvidence.find(claim => claim.capability === capability)!.state
  if (declaredState !== 'native') {
    return Object.freeze({
      capability,
      declaredState,
      status: 'unverified-extension' as const,
      diagnostic: `Descriptor declares "${declaredState}"; no executable native claim was made.`,
    })
  }
  const witnessId = `family-example@${FAMILY_CONFORMANCE_VERSION}/${descriptor.id}/${capability}`
  try {
    const first = renderContractDigest(capabilityWitness(descriptor, capability))
    const second = renderContractDigest(capabilityWitness(descriptor, capability))
    if (first !== second) {
      throw new Error(`canonical example was nondeterministic (${first} != ${second})`)
    }
    return Object.freeze({ capability, declaredState, status: 'passed' as const, witnessId })
  } catch (error) {
    return Object.freeze({
      capability,
      declaredState,
      status: 'failed' as const,
      diagnostic: reasonOf(error),
    })
  }
}

function runFamilyConformance(descriptor: FamilyDescriptor): FamilyConformanceReport {
  const capabilities = Object.freeze(FAMILY_CAPABILITY_COLUMNS.map(capability =>
    runCapabilityConformance(descriptor, capability)))
  return Object.freeze({
    version: FAMILY_CONFORMANCE_VERSION,
    familyId: descriptor.id,
    example: descriptor.example,
    passed: capabilities.every(result => result.declaredState !== 'native' || result.status === 'passed'),
    capabilities,
  })
}

export class FamilyConformanceError extends Error {
  readonly report: FamilyConformanceReport

  constructor(report: FamilyConformanceReport) {
    const failures = report.capabilities
      .filter(result => result.status === 'failed')
      .map(result => `${result.capability}: ${result.diagnostic}`)
    super(`Family "${report.familyId}" failed executable registration conformance: ${failures.join('; ')}`)
    this.name = 'FamilyConformanceError'
    this.report = report
  }
}

/** Register a namespaced extension only after its canonical example proves
 * every native declaration twice against the public execution contracts. */
export function registerFamily(descriptor: FamilyDescriptor): () => void {
  const staged = stageFamilyCandidateForConformance(
    descriptor,
    assertFamilyScopedRenderOptionDeclaration,
  )
  try {
    const report = runFamilyConformance(staged.descriptor)
    if (!report.passed) throw new FamilyConformanceError(report)
    return staged.commit(report)
  } catch (error) {
    staged.rollback()
    throw error
  }
}

export { getFamilyConformanceReport }
