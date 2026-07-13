/**
 * Audit/discovery entry point. Kept separate from the renderer so the full
 * characterization and upstream semantic inventories never enter browser or
 * render-only bundles accidentally.
 */
export {
  SECTION_A_CAPABILITY_REPORT_SCHEMA_VERSION,
  SECTION_A_CAPABILITY_STATE_VOCABULARIES,
  FAMILY_CAPABILITY_COLUMNS,
  createSectionACapabilityReport,
  validateSectionACapabilityReport,
  sectionACapabilityReportMarkdown,
} from './section-a-capability-report.ts'
export type {
  FamilyCapabilityColumn,
  FamilyCapabilityState,
  FamilySupportState,
  SectionARequestCapabilityRow,
  SectionABackendCapabilityRow,
  SectionAOutputCapabilityRow,
  SectionAFamilyHeaderRow,
  SectionAFamilyCapabilityRow,
  SectionASceneRoleRow,
  SectionAEvidenceSystem,
  SectionARetiredAuthority,
  SectionACapabilityReport,
} from './section-a-capability-report.ts'
export {
  UPSTREAM_MERMAID_MANIFEST,
  canonicalUpstreamInventory,
  diffUpstreamMermaidManifests,
  validateUpstreamMermaidManifest,
} from './upstream-mermaid-manifest.ts'
export type {
  UpstreamMermaidManifest,
  UpstreamManifestDiff,
} from './upstream-mermaid-manifest.ts'
