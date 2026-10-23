import { DeferredDependencyError } from '../layout/certification-error.ts'
import type { MermaidYamlResult, YamlMappingRange } from './mermaid-yaml-runtime.ts'

let runtime: typeof import('./mermaid-yaml-runtime.ts') | undefined

async function load(): Promise<void> {
  runtime ??= await import('./mermaid-yaml-runtime.ts')
}

function yaml(): NonNullable<typeof runtime> {
  if (!runtime) throw new DeferredDependencyError('YAML', load)
  return runtime
}

/** Build-only facade: frontmatter, init directives and metadata all demand
 * the same canonical parser, while ordinary diagrams fetch no YAML code. */
export function parseMermaidYaml(source: string): MermaidYamlResult {
  return yaml().parseMermaidYaml(source)
}

export function parseDirectiveYaml(source: string): unknown {
  return yaml().parseDirectiveYaml(source)
}

export function readYamlMappingRanges(source: string): YamlMappingRange[] {
  return yaml().readYamlMappingRanges(source)
}

export function stringifyMermaidYaml(value: unknown): string {
  return yaml().stringifyMermaidYaml(value)
}

export type { MermaidYamlResult }
