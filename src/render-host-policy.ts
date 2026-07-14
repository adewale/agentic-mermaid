/** Host-owned policy shared by every hosted render/layout projection. Callers
 * may supply these fields for transport parity, but cannot weaken them. */
export const HOSTED_RENDER_OPTIONS = Object.freeze({
  security: 'strict' as const,
  embedFontImport: false as const,
})

export interface CodeModeHostPolicy {
  readonly render: typeof HOSTED_RENDER_OPTIONS
}

export const HOSTED_CODE_MODE_HOST_POLICY: CodeModeHostPolicy = Object.freeze({
  render: HOSTED_RENDER_OPTIONS,
})
