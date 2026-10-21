import { getFrontmatterScalar, type MermaidFrontmatterMap } from '../mermaid-source.ts'

/** Read a finite non-negative spacing number from a family config section. */
export function configSpacing(frontmatter: MermaidFrontmatterMap, family: string, key: string): number | undefined {
  const value = getFrontmatterScalar<number>(frontmatter, [family, key])
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
