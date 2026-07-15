import { createHash } from 'node:crypto'
import {
  INTERNAL_STYLE_FACE_PROJECTION,
  knownStyleDescriptors,
  ROLE_STYLE_PROPERTY_DESCRIPTORS,
  SEMANTIC_BINDING_CHANNELS,
  validateStyleSpec,
} from './scene/style-registry.ts'
import { SCENE_ROLE_DESCRIPTORS } from './scene/roles.ts'
import { getFamily, knownBuiltinFamilies } from './agent/families.ts'

export const SECTION_B_CAPABILITY_REPORT_VERSION = 1 as const

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
    readonly acceptanceEvidence: readonly string[]
  }[]
  readonly digest: string
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
  const families = knownBuiltinFamilies().map(id => {
    const descriptor = getFamily(id)!
    const bindingRoles = SCENE_ROLE_DESCRIPTORS
      .filter(role => role.traits.styleBindingFamilies.includes(id))
      .map(role => role.role)
    return {
      id,
      semanticRoles: [...descriptor.semanticRoles],
      semanticChannels: [...descriptor.semanticChannels],
      bindingRoles,
      bindingChannels: bindingRoles.length === 0
        ? []
        : SEMANTIC_BINDING_CHANNELS.filter(channel => descriptor.semanticChannels.includes(channel)),
    }
  })
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
      evidence: ['docs/project/brand-primitives-plan.md', 'eval/section-b-brand-evidence/usability-agent-session.json'],
    },
    phases: [
      { id: 'B0', acceptanceEvidence: ['src/__tests__/section-b-capability-report.test.ts', 'docs/project/section-b-capability-report.json'] },
      { id: 'B1', acceptanceEvidence: ['src/__tests__/section-b-role-styles.test.ts', 'src/__tests__/radar-label-discipline.test.ts'] },
      { id: 'B2', acceptanceEvidence: ['src/__tests__/section-b-role-styles.test.ts', 'src/__tests__/style-spec-authority.test.ts'] },
      { id: 'B3', acceptanceEvidence: ['src/__tests__/section-b-policy.test.ts', 'src/scene/brand-constraints.ts'] },
      { id: 'B4', acceptanceEvidence: ['docs/project/brand-primitives-plan.md', 'eval/section-b-brand-evidence/usability-agent-session.json'] },
      { id: 'B5', acceptanceEvidence: ['docs/style-authoring.md', 'scripts/pr-assets/section-b-brand-evidence.ts', 'eval/section-b-brand-evidence/evidence-receipt.json', 'eval/section-b-brand-evidence/usability-agent-session.json'] },
    ],
  }
}

export function createSectionBCapabilityReport(): SectionBCapabilityReport {
  const reportBody = body()
  return deepFreeze({ ...reportBody, digest: digest(reportBody) })
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
  const channelRows = report.families.map(family => `| \`${family.id}\` | ${family.semanticRoles.length ? family.semanticRoles.map(value => `\`${value}\``).join(', ') : 'none'} | ${family.semanticChannels.length ? family.semanticChannels.map(value => `\`${value}\``).join(', ') : 'none'} | ${family.bindingRoles.length ? family.bindingRoles.map(value => `\`${value}\``).join(', ') : 'none'} | ${family.bindingChannels.length ? family.bindingChannels.map(value => `\`${value}\``).join(', ') : 'none'} |`).join('\n')
  const roleRows = report.roles.map(role => `| \`${role.role}\` | \`${role.fallbackRole}\` | ${role.consumption} | ${role.applicableProperties.length ? role.applicableProperties.map(value => `\`${value}\``).join(', ') : 'fallback-only'} |`).join('\n')
  const privateFaceRows = report.privateFaceProjection.map(face => `| \`${face.face}\` | \`${face.sourceRole}\` | ${face.publicFields.map(value => `\`${value}\``).join(', ')} |`).join('\n')
  const looks = report.builtInLooks.map(look => `- \`${look.inputName}\` → \`${look.id}\`; public export ${look.exportable ? 'valid' : 'invalid'}; role keys: ${look.roleKeys.length ? look.roleKeys.map(value => `\`${value}\``).join(', ') : 'none'}`).join('\n')
  const paintRows = report.paintAuthority.map(row => `| \`${row.id}\` | ${row.provenance} | ${row.foreground} | ${row.background} | ${row.outputContext} | ${row.compositing} / ${row.behavior} |`).join('\n')
  return `# Section B capability report\n\nGenerated from the Style, SceneRole, and FamilyDescriptor registries. Do not edit by hand. Machine-readable sibling: [section-b-capability-report.json](./section-b-capability-report.json).\n\n- Public role-style leaves: **${report.publicRoleStyleLeaves.length}**\n- Registered Scene roles: **${report.roles.length}**\n- Built-in families: **${report.families.length}**\n- Exportable built-in Looks: **${report.builtInLooks.length}**\n- BrandPack promoted: **no** — ${report.brandPack.reason}\n- Digest: \`${report.digest}\`\n\n## SceneRole styling\n\n| Role | Fallback | Exact consumption | Applicable public leaves |\n|---|---|---|---|\n${roleRows}\n\n## Derived private-face projection\n\nThe remaining private face is compiled only from these public role records; it has no author-only leaf.\n\n| Compiled face | Public source role | Public fields |\n|---|---|---|\n${privateFaceRows}\n\n## Family semantic-channel census\n\n| Family | Admitted Scene roles | Emitted channels | Binding consumer roles | Public binding channels |\n|---|---|---|---|---|\n${channelRows}\n\n## Built-in public exportability\n\n${looks}\n\n## Paint authority and constraints\n\nDerived defaults may be guarded while they are chosen. Concrete authored theme/config/element paint is diagnose-only. Opaque concrete pairs are measurable; transparent host backdrops are explicitly unmeasurable.\n\n| Case | Provenance | Foreground | Background | Output context | Measurement / behavior |\n|---|---|---|---|---|---|\n${paintRows}\n\n## Phase evidence\n\n${report.phases.map(phase => `- **${phase.id}:** ${phase.acceptanceEvidence.map(value => `\`${value}\``).join(', ')}`).join('\n')}\n`
}
