/** Pure pinned layer processing; native display can retain sanitized strings. */
export function mergeConfig(frontmatter: Record<string, unknown>, directives: readonly unknown[], diagramType: string, wrap?: boolean, preserveText?: boolean): Record<string, unknown>

/** Construct a complete argument token accepted by the pinned directive lexer. */
export function initDirective(payload: unknown): string

/** Consume directive source without discarding selector names or match counts. */
export function mergeConfigSource(frontmatter: Record<string, unknown>, code: string, diagramType: string, preserveText?: boolean): Record<string, unknown>
export function configDirective(kind: string, payload: unknown, hasArgs?: boolean): string
