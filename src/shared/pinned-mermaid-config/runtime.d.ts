/** Every call has private defaults, state and a 100000-loop execution budget. */
export { mergeConfig } from './merge.js'
export function validateConfig(frontmatter: Record<string, unknown>, directives: readonly unknown[], diagramType: string, metadata?: Record<string, unknown>, wrap?: boolean): void

export function validateConfigSource(frontmatter: Record<string, unknown>, code: string, diagramType: string, metadata?: Record<string, unknown>): void
