export class ProjectionUnavailable extends Error {}
export class TargetParseRejection extends Error {}
export function classifyPeleParseFailure(error: unknown, PeleError: unknown): { accepted?: boolean; error?: string; unavailable?: string; errorCode: string | null }
export interface UpstreamCallbackResult {
  family: string
  path: string
  name: string
  status: string
  assertions: Array<{ matcher: string; negated: boolean; actual?: unknown; expected?: unknown; passed: boolean }>
  sources: string[]
  targetRejections?: number
  requestedParseCalls?: number
  preparedParseCalls?: number
  preparationReplays?: number
  unavailable?: string[]
  diagnostics?: string[]
  error?: string
  errorCode?: string | null
}
export interface PreparedPublicResult {
  accepted?: boolean
  error?: string
  errorCode?: string | null
  unavailable?: string
  view?: Record<string, (...args: any[]) => any>
  timing?: unknown
}
export function publicDatabaseView(engine: string, model: any, family: string): Record<string, (...args: any[]) => any>
export function executeUpstreamSpecs(files: Array<{ family: string; path: string; text: string }>, parse: (source: string, family: string) => Promise<PreparedPublicResult>): Promise<{
  callbacks: UpstreamCallbackResult[]
  publicSources: Array<{ caseName: string; family: string; source: string; accepted: boolean | null; error: string | null; errorCode: string | null; timing: unknown }>
}>
