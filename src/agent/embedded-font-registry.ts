/**
 * One file embedded by a host executable. `manifestPath` is the canonical
 * package-relative resource or licence path; `embeddedPath` is the opaque
 * path returned by the host bundler (for Bun compile, a `/$bunfs/...` path).
 */
export interface EmbeddedFontResourceFile {
  readonly manifestPath: string
  readonly embeddedPath: string
}

// Dependency-free so the MCP render supervisor can hand the registered set to
// its renderer thread, which has its own module state.
let registeredFiles: readonly EmbeddedFontResourceFile[] | undefined

/** Register the closed font-resource set supplied by a binary-only host. */
export function registerEmbeddedFontResourceFiles(files: readonly EmbeddedFontResourceFile[]): void {
  if (registeredFiles) throw new Error('INVALID_RESOURCE_MANIFEST: embedded font resources are already registered')
  registeredFiles = Object.freeze(Array.from(files, file => {
    if (typeof file?.manifestPath !== 'string' || file.manifestPath === ''
      || typeof file.embeddedPath !== 'string' || file.embeddedPath === '') {
      throw new TypeError('INVALID_RESOURCE_MANIFEST: embedded font resource paths must be non-empty strings')
    }
    return Object.freeze({ manifestPath: file.manifestPath, embeddedPath: file.embeddedPath })
  }))
}

/** The registered set, if this is a binary-only host. */
export function registeredEmbeddedFontResourceFiles(): readonly EmbeddedFontResourceFile[] | undefined {
  return registeredFiles
}
