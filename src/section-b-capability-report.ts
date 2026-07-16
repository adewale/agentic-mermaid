import { createHash } from 'node:crypto'
import './scene/builtin-backends.ts'
import {
  INTERNAL_STYLE_FACE_PROJECTION,
  knownStyleDescriptors,
  ROLE_STYLE_PROPERTY_DESCRIPTORS,
  SEMANTIC_BINDING_CHANNELS,
  validateStyleSpec,
} from './scene/style-registry.ts'
import { SCENE_ROLE_DESCRIPTORS, type BuiltinSceneRole } from './scene/roles.ts'
import { getFamily, knownBuiltinFamilies, type BuiltinFamilyId, type FamilyDescriptor } from './agent/families.ts'
import { knownBackendDescriptors, type BackendDescriptor } from './scene/backend.ts'
import { resolveRenderRequest } from './render-contract.ts'
import { positionResolvedFamily } from './positioning.ts'
import { lowerPositionedFamilyScene } from './graphical-render.ts'
import { renderMermaidASCII } from './ascii/index.ts'
import type { SceneDoc, SceneNode, SemanticChannelName } from './scene/ir.ts'
import type { RenderOptions } from './types.ts'
import type { StyleSpec } from './scene/style-spec.ts'
import { SECTION_B_FAMILY_CENSUS_FIXTURES } from './scene/section-b-census-fixtures.ts'
import { sceneNodeSerialization } from './scene/serialization.ts'

export const SECTION_B_CAPABILITY_REPORT_VERSION = 3 as const

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

export interface SectionBCapabilityReport {
  readonly version: typeof SECTION_B_CAPABILITY_REPORT_VERSION
  readonly publicRoleStyleLeaves: readonly {
    readonly field: string
    readonly kind: string
    readonly description: string
  }[]
  readonly roles: readonly {
    readonly role: string
    readonly fallbackRole: string
    readonly consumption: 'exact' | 'fallback-only'
    readonly applicableProperties: readonly string[]
  }[]
  readonly privateFaceProjection: readonly {
    readonly face: string
    readonly sourceRole: string
    readonly publicFields: readonly string[]
  }[]
  readonly families: readonly {
    readonly id: string
    readonly semanticRoles: readonly string[]
    readonly semanticChannels: readonly string[]
    readonly bindingRoles: readonly string[]
    readonly bindingChannels: readonly string[]
    readonly graphicalBackends: readonly {
      readonly id: string
      readonly state: 'conformant-scene-consumer'
      readonly witnessId: string
    }[]
    readonly terminalProjection: {
      readonly state: 'native-lossy'
      readonly witnessId: string
      readonly outputDigest: string
    }
    readonly roleWitnesses: readonly {
      readonly role: string
      readonly observedKinds: readonly string[]
      readonly emittedChannelValues: Readonly<Record<string, readonly string[]>>
      readonly publicMigrationTarget: string
      readonly styleProjection: 'exact' | 'fallback-only' | 'not-applicable'
      readonly graphicalWitnessId: string
      readonly styleWitnessId: string
      readonly terminalProjection: 'family-level-only'
      readonly terminalWitnessId: string
    }[]
    readonly channelWitnesses: readonly {
      readonly channel: string
      readonly representativeValues: readonly string[]
      readonly emittingRoles: readonly string[]
      readonly publicBinding: 'category' | 'not-publicly-bindable'
      readonly witnessId: string
    }[]
    readonly bindingWitnesses: readonly {
      readonly role: string
      readonly channel: 'category'
      readonly representativeValue: string
      readonly graphicalProjection: 'changed'
      readonly graphicalWitnessId: string
      readonly terminalProjection: 'perceptible-no-color-cue' | 'not-projected-no-color' | 'not-applicable'
      readonly terminalWitnessId: string
    }[]
  }[]
  readonly builtInLooks: readonly {
    readonly id: string
    readonly inputName: string
    readonly exportable: true
    readonly roleKeys: readonly string[]
  }[]
  readonly paintAuthority: readonly {
    readonly id: string
    readonly authority: 'derived-default' | 'authored'
    readonly behavior: 'guard-may-substitute' | 'diagnose-only'
    readonly compositing: 'opaque-measurable' | 'host-dependent-unmeasurable'
    readonly foreground: string
    readonly background: string
    readonly provenance: 'core-derived' | 'theme-authored' | 'style-or-source-authored' | 'host-owned'
    readonly outputContext: string
    readonly evidence: readonly string[]
  }[]
  readonly brandPack: {
    readonly promoted: false
    readonly reason: string
    readonly evidence: readonly string[]
  }
  readonly phases: readonly {
    readonly id: 'B0' | 'B1' | 'B2' | 'B3' | 'B4' | 'B5'
    readonly status: 'complete' | 'not-promoted'
    readonly evidence: readonly string[]
  }[]
  readonly digest: string
}

const CENSUS_RENDER_OPTIONS: RenderOptions = Object.freeze({
  interactive: true,
  shadow: true,
  ganttToday: '2026-01-08',
  gantt: Object.freeze({ dependencyArrows: true, criticalPath: true }),
})

function visitScene(nodes: readonly SceneNode[], visit: (node: SceneNode) => void): void {
  for (const node of nodes) {
    visit(node)
    if (node.kind === 'group') visitScene(node.children.map(child => child.node), visit)
  }
}

function lowerCensusScene(family: BuiltinFamilyId, source: string, style?: StyleSpec): SceneDoc {
  const request = resolveRenderRequest(source, {
    ...CENSUS_RENDER_OPTIONS,
    ...(style ? { style } : {}),
  }, 'svg')
  return lowerPositionedFamilyScene(request, positionResolvedFamily(family, request))
}

function censusNodes(family: BuiltinFamilyId, source: string, style?: StyleSpec): SceneNode[] {
  const nodes: SceneNode[] = []
  visitScene(lowerCensusScene(family, source, style).parts, node => nodes.push(node))
  return nodes
}

function channelValue(value: string | number | boolean): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function valuesForChannel(nodes: readonly SceneNode[], channel: SemanticChannelName): string[] {
  return [...new Set(nodes.flatMap(node => {
    const value = node.channels?.[channel]
    return value === undefined ? [] : [channelValue(value)]
  }))].sort()
}

function rolesForChannel(nodes: readonly SceneNode[], channel: SemanticChannelName): string[] {
  return [...new Set(nodes.filter(node => node.channels?.[channel] !== undefined).map(node => node.role))].sort()
}

function roleSignature(nodes: readonly SceneNode[], role: string, value: string): string {
  return canonicalJson(nodes
    .filter(node => node.role === role && channelValue(node.channels?.category ?? '') === value)
    .map(node => ({
      id: node.id,
      kind: node.kind,
      serialization: sceneNodeSerialization(node),
      ...('paint' in node ? { paint: node.paint } : {}),
    })))
}

function bindingProbeStyle(role: string, value: string, properties: readonly string[], cue = false): StyleSpec {
  const selected: Record<string, string | number> = cue
    ? { cue: 'outline' }
    : properties.includes('fillColor')
      ? { fillColor: '#ff00fe' }
      : properties.includes('strokeColor')
        ? { strokeColor: '#ff00fe' }
        : properties.includes('textColor')
          ? { textColor: '#ff00fe' }
          : properties.includes('lineWidth')
            ? { lineWidth: 4 }
            : {}
  if (Object.keys(selected).length === 0) {
    throw new Error(`Section B binding witness ${role} has no perceptible applicable property`)
  }
  return {
    semanticSlots: { 'section-b-census': selected },
    bindings: [{ channel: 'category', value, slot: 'section-b-census', role: role as BuiltinSceneRole }],
  } as StyleSpec
}

function roleProbeRecord(properties: readonly string[]): Record<string, string | number> {
  if (properties.includes('fillColor')) return { fillColor: '#ff00fe' }
  if (properties.includes('strokeColor')) return { strokeColor: '#ff00fe' }
  if (properties.includes('textColor')) return { textColor: '#ff00fe' }
  if (properties.includes('borderColor')) return { borderColor: '#ff00fe' }
  if (properties.includes('lineWidth')) return { lineWidth: 7 }
  if (properties.includes('fontSize')) return { fontSize: 23 }
  throw new Error('Section B role probe has no perceptible applicable property')
}

function roleProbeStyle(roles: readonly string[]): StyleSpec {
  return {
    roles: Object.fromEntries(roles.map(role => {
      const descriptor = SCENE_ROLE_DESCRIPTORS.find(candidate => candidate.role === role)
      if (!descriptor || descriptor.style.applicableProperties.length === 0) {
        throw new Error(`Section B role probe has no exact style descriptor for ${role}`)
      }
      return [role, roleProbeRecord(descriptor.style.applicableProperties)]
    })),
  } as StyleSpec
}

function allRoleSignature(nodes: readonly SceneNode[], role: string): string {
  return canonicalJson(nodes.filter(node => node.role === role).map(node => ({
    id: node.id,
    kind: node.kind,
    serialization: sceneNodeSerialization(node),
    ...('paint' in node ? { paint: node.paint } : {}),
  })))
}

function executableFamilyCensus(id: BuiltinFamilyId): SectionBCapabilityReport['families'][number] {
  const descriptor = getFamily(id)!
  const richSource = SECTION_B_FAMILY_CENSUS_FIXTURES[id] ?? descriptor.example
  const sources = richSource === descriptor.example ? [descriptor.example] : [descriptor.example, richSource]
  const observed = sources.flatMap(source => censusNodes(id, source))
  const missingRoles = descriptor.semanticRoles.filter(role => !observed.some(node => node.role === role))
  if (missingRoles.length > 0) throw new Error(`Section B census ${id} did not emit declared roles: ${missingRoles.join(', ')}`)
  const missingChannels = descriptor.semanticChannels.filter(channel => valuesForChannel(observed, channel).length === 0)
  if (missingChannels.length > 0) throw new Error(`Section B census ${id} did not emit declared channels: ${missingChannels.join(', ')}`)

  const bindingRoles = SCENE_ROLE_DESCRIPTORS
    .filter(role => role.traits.styleBindingFamilies.includes(id))
    .map(role => role.role)
  const bindingChannels = bindingRoles.length === 0
    ? []
    : SEMANTIC_BINDING_CHANNELS.filter(channel => descriptor.semanticChannels.includes(channel))
  const backends = knownBackendDescriptors()
    .filter(backend => backend.identity.provenance.source === 'built-in')
    .map(backend => {
      if (!backend.conformance.passed) throw new Error(`Section B census backend ${backend.identity.id} is not conformant`)
      return {
        id: backend.identity.id,
        state: 'conformant-scene-consumer' as const,
        witnessId: `${backend.conformance.fixtureId}/${backend.identity.id}`,
      }
    })
  if (backends.length === 0) throw new Error('Section B census found no conformant built-in graphical backend')

  const terminal = renderMermaidASCII(richSource, { ...CENSUS_RENDER_OPTIONS, colorMode: 'none' })
  if (terminal.trim().length === 0) throw new Error(`Section B census ${id} produced empty terminal output`)
  const terminalWitnessId = `section-b/${id}/terminal/no-color`

  // Probe one public role record at a time. Combining exact roles or fallback
  // archetypes would let a sibling's visual change create a false witness for
  // this role when their marks are nested in the same group serialization.
  const isolatedProbeCache = new Map<string, readonly SceneNode[]>()
  const isolatedProbe = (target: string): readonly SceneNode[] => {
    const cached = isolatedProbeCache.get(target)
    if (cached) return cached
    const nodes = sources.flatMap(source => censusNodes(id, source, roleProbeStyle([target])))
    isolatedProbeCache.set(target, nodes)
    return nodes
  }

  const roleWitnesses = descriptor.semanticRoles.map(role => {
    const roleDescriptor = SCENE_ROLE_DESCRIPTORS.find(candidate => candidate.role === role)
    if (!roleDescriptor) throw new Error(`Section B census ${id} emitted unknown public role ${role}`)
    const roleNodes = observed.filter(node => node.role === role)
    const emittedChannelValues = Object.fromEntries(descriptor.semanticChannels
      .map(channel => [channel, valuesForChannel(roleNodes, channel)] as const)
      .filter(([, values]) => values.length > 0))
    const baselineSignature = allRoleSignature(observed, role)
    const exactChanged = roleDescriptor.traits.styleConsumption === 'exact'
      && baselineSignature !== allRoleSignature(isolatedProbe(role), role)
    const fallbackChanged = !exactChanged
      && baselineSignature !== allRoleSignature(isolatedProbe(roleDescriptor.style.fallbackRole), role)
    const styleProjection = exactChanged ? 'exact' as const
      : fallbackChanged ? 'fallback-only' as const
        : 'not-applicable' as const
    const publicMigrationTarget = styleProjection === 'exact' ? role
      : styleProjection === 'fallback-only' ? roleDescriptor.style.fallbackRole
        : 'none'
    return {
      role,
      observedKinds: [...new Set(roleNodes.map(node => node.kind))].sort(),
      emittedChannelValues,
      publicMigrationTarget,
      styleProjection,
      graphicalWitnessId: `section-b/${id}/scene-role/${role}`,
      styleWitnessId: `section-b/${id}/style/${role}/${styleProjection}`,
      terminalProjection: 'family-level-only' as const,
      terminalWitnessId,
    }
  })

  const channelWitnesses = descriptor.semanticChannels.map(channel => ({
    channel,
    representativeValues: valuesForChannel(observed, channel),
    emittingRoles: rolesForChannel(observed, channel),
    publicBinding: channel === 'category' && bindingChannels.includes('category')
      ? 'category' as const
      : 'not-publicly-bindable' as const,
    witnessId: `section-b/${id}/semantic-channel/${channel}`,
  }))

  const richNodes = censusNodes(id, richSource)
  const bindingWitnesses = bindingRoles.map(role => {
    const roleDescriptor = SCENE_ROLE_DESCRIPTORS.find(candidate => candidate.role === role)!
    const representative = richNodes.find(node => node.role === role && node.channels?.category !== undefined)
    if (!representative) throw new Error(`Section B binding census ${id}/${role} emitted no category value`)
    const representativeValue = channelValue(representative.channels!.category!)
    const style = bindingProbeStyle(role, representativeValue, roleDescriptor.style.applicableProperties)
    const styledNodes = censusNodes(id, richSource, style)
    if (roleSignature(richNodes, role, representativeValue) === roleSignature(styledNodes, role, representativeValue)) {
      throw new Error(`Section B binding census ${id}/${role} accepted an inert graphical binding`)
    }

    let terminalProjection: 'perceptible-no-color-cue' | 'not-projected-no-color' | 'not-applicable' = 'not-applicable'
    if (roleDescriptor.style.applicableProperties.includes('cue')) {
      const cueStyle = bindingProbeStyle(role, representativeValue, roleDescriptor.style.applicableProperties, true)
      const cueTerminal = renderMermaidASCII(richSource, { ...CENSUS_RENDER_OPTIONS, colorMode: 'none', style: cueStyle })
      terminalProjection = cueTerminal === terminal ? 'not-projected-no-color' : 'perceptible-no-color-cue'
    }
    return {
      role,
      channel: 'category' as const,
      representativeValue,
      graphicalProjection: 'changed' as const,
      graphicalWitnessId: `section-b/${id}/binding/${role}/category/graphical`,
      terminalProjection,
      terminalWitnessId: `section-b/${id}/binding/${role}/category/terminal`,
    }
  })

  return {
    id,
    semanticRoles: [...descriptor.semanticRoles],
    semanticChannels: [...descriptor.semanticChannels],
    bindingRoles,
    bindingChannels,
    graphicalBackends: backends,
    terminalProjection: {
      state: 'native-lossy',
      witnessId: terminalWitnessId,
      outputDigest: digest(terminal),
    },
    roleWitnesses,
    channelWitnesses,
    bindingWitnesses,
  }
}

function body(): Omit<SectionBCapabilityReport, 'digest'> {
  const publicRoleStyleLeaves = Object.entries(ROLE_STYLE_PROPERTY_DESCRIPTORS).map(([field, descriptor]) => ({
    field,
    kind: descriptor.kind,
    description: descriptor.description,
  }))
  const roles = SCENE_ROLE_DESCRIPTORS.map(descriptor => ({
    role: descriptor.role,
    fallbackRole: descriptor.style.fallbackRole,
    consumption: descriptor.traits.styleConsumption,
    applicableProperties: [...descriptor.style.applicableProperties],
  }))
  const privateFaceProjection = Object.entries(INTERNAL_STYLE_FACE_PROJECTION).map(([face, descriptor]) => ({
    face,
    sourceRole: descriptor.sourceRole,
    publicFields: [...descriptor.fields],
  }))
  const families = knownBuiltinFamilies().map(executableFamilyCensus)
  const builtInLooks = knownStyleDescriptors()
    .filter(descriptor => descriptor.kind === 'look' && descriptor.identity.provenance.source === 'built-in')
    .map(descriptor => {
      const problems = validateStyleSpec(descriptor.spec)
      if (problems.length) throw new Error(`Built-in Look ${descriptor.identity.id} is not publicly exportable: ${problems.join('; ')}`)
      return {
        id: descriptor.identity.id,
        inputName: descriptor.inputName,
        exportable: true as const,
        roleKeys: Object.keys(descriptor.spec.roles ?? {}).sort(),
      }
    })
  return {
    version: SECTION_B_CAPABILITY_REPORT_VERSION,
    publicRoleStyleLeaves,
    roles,
    privateFaceProjection,
    families,
    builtInLooks,
    paintAuthority: [
      {
        id: 'core-derived-semantic-paint-tokens',
        authority: 'derived-default',
        behavior: 'guard-may-substitute',
        compositing: 'opaque-measurable',
        foreground: 'derived semantic foreground token', background: 'resolved opaque page/surface token',
        provenance: 'core-derived', outputContext: 'shared SVG/PNG appearance',
        evidence: ['src/theme.ts', 'src/__tests__/property-color-algebra.test.ts'],
      },
      {
        id: 'journey-derived-label-ink',
        authority: 'derived-default',
        behavior: 'guard-may-substitute',
        compositing: 'opaque-measurable',
        foreground: 'derived journey label ink', background: 'resolved journey surface',
        provenance: 'core-derived', outputContext: 'Journey SVG/PNG Scene',
        evidence: ['src/journey/renderer.ts', 'src/__tests__/journey-theme.test.ts'],
      },
      {
        id: 'mindmap-derived-label-ink',
        authority: 'derived-default',
        behavior: 'guard-may-substitute',
        compositing: 'opaque-measurable',
        foreground: 'derived mindmap label ink', background: 'resolved node fill',
        provenance: 'core-derived', outputContext: 'Mindmap SVG/PNG Scene',
        evidence: ['src/mindmap/renderer.ts', 'src/__tests__/closing-the-gap.test.ts'],
      },
      {
        id: 'gitgraph-derived-label-ink',
        authority: 'derived-default',
        behavior: 'guard-may-substitute',
        compositing: 'opaque-measurable',
        foreground: 'derived branch/commit label ink', background: 'derived label surface',
        provenance: 'core-derived', outputContext: 'GitGraph SVG/PNG Scene',
        evidence: ['src/gitgraph/renderer.ts', 'src/__tests__/mindmap-gitgraph-content-corpus.test.ts'],
      },
      {
        id: 'pie-derived-series-palette',
        authority: 'derived-default',
        behavior: 'guard-may-substitute',
        compositing: 'opaque-measurable',
        foreground: 'derived slice/label palette', background: 'resolved opaque page',
        provenance: 'core-derived', outputContext: 'Pie SVG/PNG and terminal palette',
        evidence: ['src/pie/palette.ts', 'src/__tests__/pie-elevation.test.ts'],
      },
      {
        id: 'radar-derived-label-ink',
        authority: 'derived-default',
        behavior: 'guard-may-substitute',
        compositing: 'opaque-measurable',
        foreground: 'derived radar label ink', background: 'resolved opaque page',
        provenance: 'core-derived', outputContext: 'Radar SVG/PNG Scene',
        evidence: ['src/radar/renderer.ts', 'src/__tests__/radar-label-discipline.test.ts'],
      },
      {
        id: 'radar-authored-axis-color',
        authority: 'authored',
        behavior: 'diagnose-only',
        compositing: 'opaque-measurable',
        foreground: 'themeVariables.radar.axisColor', background: 'resolved opaque page',
        provenance: 'theme-authored', outputContext: 'Radar SVG/PNG verification artifact',
        evidence: ['src/agent/verify.ts', 'src/__tests__/radar-label-discipline.test.ts'],
      },
      {
        id: 'brand-constraint-final-scene-paint',
        authority: 'authored',
        behavior: 'diagnose-only',
        compositing: 'opaque-measurable',
        foreground: 'final admitted text MarkPaint', background: 'nearest admitted semantic surface or page',
        provenance: 'style-or-source-authored', outputContext: 'final admitted Scene before graphical backend',
        evidence: ['src/scene/brand-constraints.ts', 'src/__tests__/section-b-policy.test.ts'],
      },
      {
        id: 'transparent-host-backdrop',
        authority: 'authored',
        behavior: 'diagnose-only',
        compositing: 'host-dependent-unmeasurable',
        foreground: 'final admitted text MarkPaint', background: 'unknown embedding-host backdrop',
        provenance: 'host-owned', outputContext: 'transparent SVG/PNG host composition',
        evidence: ['src/scene/brand-constraints.ts', 'src/__tests__/section-b-policy.test.ts'],
      },
    ],
    brandPack: {
      promoted: false,
      reason: 'No external consumer has shown that ordinary version-controlled StyleSpec files are insufficient for repeated distribution, exact selection, or installed-resource integrity.',
      evidence: ['TODO.md#dec-1--get-one-real-external-consumer', 'docs/project/brand-primitives-plan.md'],
    },
    phases: [
      { id: 'B0', status: 'complete', evidence: ['src/__tests__/section-b-capability-report.test.ts', 'docs/project/section-b-capability-report.json'] },
      { id: 'B1', status: 'complete', evidence: ['src/__tests__/section-b-role-styles.test.ts', 'src/__tests__/radar-label-discipline.test.ts'] },
      { id: 'B2', status: 'complete', evidence: ['src/__tests__/section-b-role-styles.test.ts', 'src/__tests__/style-spec-authority.test.ts'] },
      { id: 'B3', status: 'complete', evidence: ['src/__tests__/section-b-policy.test.ts', 'src/scene/brand-constraints.ts'] },
      { id: 'B4', status: 'not-promoted', evidence: ['TODO.md#dec-1--get-one-real-external-consumer', 'docs/project/brand-primitives-plan.md'] },
      { id: 'B5', status: 'complete', evidence: [
        'docs/style-authoring.md',
        'scripts/pr-assets/section-b-brand-evidence.ts',
        'eval/section-b-brand-evidence/evidence-receipt.json',
        'eval/section-b-brand-evidence/usability-agent-session.json',
        'examples/styles/catalog.json',
        'eval/style-prototype-evidence/visual-approval.json',
      ] },
    ],
  }
}

interface SectionBReportCache {
  readonly families: readonly FamilyDescriptor[]
  readonly backends: readonly BackendDescriptor[]
  readonly report: SectionBCapabilityReport
}

let cachedReport: SectionBReportCache | undefined

function sameLiveRegistrations(
  cache: SectionBReportCache,
  families: readonly FamilyDescriptor[],
  backends: readonly BackendDescriptor[],
): boolean {
  return cache.families.length === families.length
    && cache.families.every((descriptor, index) => descriptor === families[index])
    && cache.backends.length === backends.length
    && cache.backends.every((descriptor, index) =>
      descriptor.identity === backends[index]?.identity
      && descriptor.backend === backends[index]?.backend
      && descriptor.conformance === backends[index]?.conformance)
}

export function createSectionBCapabilityReport(): SectionBCapabilityReport {
  const families = knownBuiltinFamilies().map(id => getFamily(id)!)
  const backends = knownBackendDescriptors()
  if (cachedReport && sameLiveRegistrations(cachedReport, families, backends)) return cachedReport.report
  const reportBody = body()
  const report = deepFreeze({ ...reportBody, digest: digest(reportBody) })
  cachedReport = { families, backends, report }
  return report
}

export function validateSectionBCapabilityReport(report: SectionBCapabilityReport): string[] {
  const problems: string[] = []
  const live = createSectionBCapabilityReport()
  if (report.version !== SECTION_B_CAPABILITY_REPORT_VERSION) problems.push('report version is stale')
  const { digest: _reportedDigest, ...payload } = report
  if (report.digest !== digest(payload)) problems.push('report digest does not match its payload')
  if (canonicalJson(report) !== canonicalJson(live)) problems.push('report does not match live Section B authorities')
  return problems
}

export function sectionBCapabilityReportMarkdown(report = createSectionBCapabilityReport()): string {
  const familyRows = report.families.map(family => `| \`${family.id}\` | ${family.roleWitnesses.length} / ${family.semanticRoles.length} | ${family.channelWitnesses.length} / ${family.semanticChannels.length} | ${family.graphicalBackends.map(backend => `\`${backend.id}\``).join(', ')} | ${family.terminalProjection.state}; \`${family.terminalProjection.outputDigest}\` |`).join('\n')
  const executableRoleRows = report.families.flatMap(family => family.roleWitnesses.map(witness => `| \`${family.id}\` | \`${witness.role}\` | ${witness.observedKinds.map(kind => `\`${kind}\``).join(', ')} | ${witness.styleProjection} → \`${witness.publicMigrationTarget}\` | ${Object.keys(witness.emittedChannelValues).length ? Object.entries(witness.emittedChannelValues).map(([channel, values]) => `\`${channel}\`=${values.map(value => `\`${value}\``).join('/')}`).join('; ') : 'none'} | ${witness.terminalProjection} | \`${witness.graphicalWitnessId}\`; \`${witness.styleWitnessId}\` |`)).join('\n')
  const executableChannelRows = report.families.flatMap(family => family.channelWitnesses.map(witness => `| \`${family.id}\` | \`${witness.channel}\` | ${witness.representativeValues.map(value => `\`${value}\``).join(', ')} | ${witness.emittingRoles.map(role => `\`${role}\``).join(', ')} | ${witness.publicBinding} | \`${witness.witnessId}\` |`)).join('\n')
  const bindingRows = report.families.flatMap(family => family.bindingWitnesses.map(witness => `| \`${family.id}\` | \`${witness.role}\` | \`${witness.channel}\`=\`${witness.representativeValue}\` | ${witness.graphicalProjection} | ${witness.terminalProjection} | \`${witness.graphicalWitnessId}\` |`)).join('\n') || '| none | none | none | none | none | none |'
  const roleRows = report.roles.map(role => `| \`${role.role}\` | \`${role.fallbackRole}\` | ${role.consumption} | ${role.applicableProperties.length ? role.applicableProperties.map(value => `\`${value}\``).join(', ') : 'fallback-only'} |`).join('\n')
  const privateFaceRows = report.privateFaceProjection.map(face => `| \`${face.face}\` | \`${face.sourceRole}\` | ${face.publicFields.map(value => `\`${value}\``).join(', ')} |`).join('\n')
  const looks = report.builtInLooks.map(look => `- \`${look.inputName}\` → \`${look.id}\`; public export ${look.exportable ? 'valid' : 'invalid'}; role keys: ${look.roleKeys.length ? look.roleKeys.map(value => `\`${value}\``).join(', ') : 'none'}`).join('\n')
  const paintRows = report.paintAuthority.map(row => `| \`${row.id}\` | ${row.provenance} | ${row.foreground} | ${row.background} | ${row.outputContext} | ${row.compositing} / ${row.behavior} |`).join('\n')
  return `# Section B capability report\n\nGenerated from the Style, SceneRole, and FamilyDescriptor registries. Do not edit by hand. Machine-readable sibling: [section-b-capability-report.json](./section-b-capability-report.json).\n\n- Public role-style leaves: **${report.publicRoleStyleLeaves.length}**\n- Registered Scene roles: **${report.roles.length}**\n- Built-in families: **${report.families.length}**\n- Exportable built-in Looks: **${report.builtInLooks.length}**\n- BrandPack promoted: **no** — ${report.brandPack.reason}\n- Digest: \`${report.digest}\`\n\n## SceneRole styling\n\n| Role | Fallback | Exact consumption | Applicable public leaves |\n|---|---|---|---|\n${roleRows}\n\n## Derived private-face projection\n\nThe remaining private face is compiled only from these public role records; it has no author-only leaf.\n\n| Compiled face | Public source role | Public fields |\n|---|---|---|\n${privateFaceRows}\n\n## Executable family census\n\nEvery row below is generated by lowering the descriptor example plus its rich census fixture through the admitted Scene path, executing no-color terminal output, and composing that Scene evidence with each registered built-in backend's executable conformance receipt. Generation fails when a declared role/channel is not emitted or an enrolled binding is inert.\n\n| Family | Emitted roles | Populated channels | Conformant graphical backends | Terminal witness |\n|---|---:|---:|---|---|\n${familyRows}\n\n### Role migration and projection witnesses\n\n| Family | Emitted role | Observed mark kinds | Public migration target | Representative emitted channels | Terminal evidence boundary | Executable witness |\n|---|---|---|---|---|---|---|\n${executableRoleRows}\n\n### Semantic-channel emission witnesses\n\n| Family | Populated channel | Representative values | Emitting roles | Public binding state | Executable witness |\n|---|---|---|---|---|---|\n${executableChannelRows}\n\n### Binding-consumer witnesses\n\n| Family | Consumer role | Emitted selector | Graphical projection | No-color terminal projection | Executable witness |\n|---|---|---|---|---|---|\n${bindingRows}\n\n## Built-in public exportability\n\n${looks}\n\n## Paint authority and constraints\n\nDerived defaults may be guarded while they are chosen. Concrete authored theme/config/element paint is diagnose-only. Opaque concrete pairs are measurable; transparent host backdrops are explicitly unmeasurable.\n\n| Case | Provenance | Foreground | Background | Output context | Measurement / behavior |\n|---|---|---|---|---|---|\n${paintRows}\n\n## Phase evidence\n\n${report.phases.map(phase => `- **${phase.id} (${phase.status}):** ${phase.evidence.map(value => `\`${value}\``).join(', ')}`).join('\n')}\n`
}
