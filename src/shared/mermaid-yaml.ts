/** Synchronous APIs keep the canonical YAML reader/writer available. The lazy
 * browser build swaps only this facade, not the grammar or error handling. */
export { parseDirectiveYaml, parseMermaidYaml, readYamlMappingRanges, stringifyMermaidYaml } from './mermaid-yaml-runtime.ts'
export type { MermaidYamlResult, YamlMappingRange } from './mermaid-yaml-runtime.ts'
