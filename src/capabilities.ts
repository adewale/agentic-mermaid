/**
 * Audit/discovery entry point. Kept separate from the renderer so the full
 * characterization and upstream semantic inventories never enter browser or
 * render-only bundles accidentally.
 */
export {
  SECTION_A_CAPABILITY_REPORT_SCHEMA_VERSION,
  SECTION_A_CAPABILITY_STATE_VOCABULARIES,
  FAMILY_CAPABILITY_COLUMNS,
  UNREGISTERED_FAMILY_CAPABILITY_STATES,
  createSectionACapabilityReport,
  sectionACapabilityDiscoverySummary,
  validateSectionACapabilityReport,
  sectionACapabilityReportMarkdown,
} from './section-a-capability-report.ts'
export type {
  FamilyCapabilityColumn,
  FamilyCapabilityState,
  FamilySupportState,
  SectionARequestCapabilityRow,
  SectionAOutputOptionCapabilityRow,
  SectionABackendCapabilityRow,
  SectionAOutputCapabilityRow,
  SectionAFamilyHeaderRow,
  SectionAFamilyCapabilityRow,
  SectionASceneRoleRow,
  SectionAEvidenceSystem,
  SectionARetiredAuthority,
  SectionACapabilityReport,
  SectionACapabilityDiscoverySummary,
} from './section-a-capability-report.ts'
export {
  FAMILY_SYNTAX_STATES,
  SYNTAX_CAPABILITY_DIMENSIONS,
  classifySyntaxFeatureDimension,
  createSyntaxCapabilityLedger,
  validateSyntaxCapabilityLedger,
} from './syntax-capability-ledger.ts'
export type {
  FamilySyntaxState,
  SyntaxCapabilityDimensionId,
  SyntaxCapabilityEvidence,
  SyntaxFeatureCapabilityRow,
  SyntaxFamilyDimensionCapabilityRow,
  SyntaxCapabilityLedger,
} from './syntax-capability-ledger.ts'
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
