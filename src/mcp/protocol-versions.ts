// Protocol-revision eras, shared by every MCP surface.
//
// MCP split into two eras at revision 2026-07-28 (SEP-2575, Final):
//
//   LEGACY  (2024-11-05 … 2025-11-25) — an `initialize` handshake establishes a
//           session; version, clientInfo, and capabilities are negotiated once.
//   MODERN  (2026-07-28 and later)    — no handshake. Every request carries its
//           own version and capabilities in `_meta` (plus optional identity), and
//           `server/discover` replaces the handshake's discovery role.
//
// We serve BOTH. The spec explicitly permits it — "A server that wishes to
// support both legacy clients … and modern clients … MAY implement both
// behaviors" — and specifies the selection rule a dual-era server uses:
// "A request carrying modern per-request `_meta` is served statelessly
// according to this revision. An `initialize` request selects legacy
// semantics." Admission applies that rule once and carries the resulting era
// in a branded protocol context through caching and dispatch.
//
// The BODY is the source of truth for the version. On HTTP the transport also
// carries it in the MCP-Protocol-Version header and must reject mismatches
// (-32020); the header is a mirror for intermediaries, never the authority.

/** Revisions that establish a session with an `initialize` handshake. */
export const LEGACY_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'] as const
/** Revisions that carry version/identity/capabilities as per-request metadata. */
export const MODERN_PROTOCOL_VERSIONS = ['2026-07-28'] as const

export type ProtocolEra = 'legacy' | 'modern'
export type LegacyProtocolVersion = typeof LEGACY_PROTOCOL_VERSIONS[number]
export type ModernProtocolVersion = typeof MODERN_PROTOCOL_VERSIONS[number]

/** `_meta` keys defined by SEP-2575. Namespaced exactly as the spec requires. */
export const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion'
export const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo'
export const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities'
export const META_LOG_LEVEL = 'io.modelcontextprotocol/logLevel'
/** Per-response server identity stamp used by the modern protocol era. */
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo'

// Protocol-defined error codes from the MCP reserved sub-range. These are not
// JSON-RPC standard codes and must not be confused with -32602 (Invalid params).
/** The HTTP headers disagree with the request body, or a required one is absent. */
export const HEADER_MISMATCH = -32020
/** The requested protocol version is not implemented; `data.supported` lists ours. */
export const UNSUPPORTED_PROTOCOL_VERSION = -32022

// -32021 (MissingRequiredClientCapability) is deliberately absent. The spec makes
// it conditional — "If processing a request requires a capability the client did
// not include in io.modelcontextprotocol/clientCapabilities" — and every tool we
// expose is a pure function of its arguments, needing no sampling, elicitation,
// or roots. There is therefore no path that can require it, and the spec forbids
// emitting a reserved code outside its specified meaning. `mcp-reserved-error-
// codes.test.ts` holds us to that, and to the codes this revision retires.

/** Revisions that require a tool-execution envelope for input-validation
 *  failures rather than a JSON-RPC protocol error (SEP-1303, landed in
 *  2025-11-25): "input validation errors should be returned as Tool Execution
 *  Errors rather than Protocol Errors to enable model self-correction". Date
 *  strings are ISO-ordered, so lexical comparison is chronological. */
export const TOOL_ERROR_VALIDATION_SINCE = '2025-11-25'

export function isModernProtocolVersion(version: unknown): version is ModernProtocolVersion {
  return typeof version === 'string' && (MODERN_PROTOCOL_VERSIONS as readonly string[]).includes(version)
}

export function isLegacyProtocolVersion(version: unknown): version is LegacyProtocolVersion {
  return typeof version === 'string' && (LEGACY_PROTOCOL_VERSIONS as readonly string[]).includes(version)
}

export function usesToolErrorForInvalidArguments(version: string | null | undefined): boolean {
  return typeof version === 'string' && version >= TOOL_ERROR_VALIDATION_SINCE
}

function paramsMeta(req: { params?: unknown }): Record<string, unknown> | undefined {
  const params = req.params
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined
  const meta = (params as { _meta?: unknown })._meta
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined
  return meta as Record<string, unknown>
}

/** The protocol version a request declares in `_meta`, if any. Absent for every
 *  legacy request — those negotiate once via `initialize` instead. */
export function requestMetaProtocolVersion(req: { params?: unknown }): string | undefined {
  const value = paramsMeta(req)?.[META_PROTOCOL_VERSION]
  return typeof value === 'string' ? value : undefined
}

/**
 * Modern requests MUST carry protocolVersion and clientCapabilities in `_meta`:
 * "A request missing any required field is malformed; the server MUST reject it
 * with INVALID_PARAMS". Returns the problems, empty when valid.
 *
 * `clientInfo` is NOT one of them. The spec's per-request field table marks it
 * Required: No — "Clients SHOULD include io.modelcontextprotocol/clientInfo on
 * every request unless specifically configured not to do so" — so a client
 * configured to withhold it is conforming, and rejecting it would lock out a
 * legal client. It is still shape-checked WHEN PRESENT, because a supplied
 * `clientInfo` is an `Implementation` and a malformed one is malformed.
 *
 * Deliberately NOT applied to legacy requests, and deliberately NOT folded into
 * tool-argument validation: `_meta` lives on the params envelope, while the
 * closed `additionalProperties:false` tool schemas govern `arguments` alone.
 * Conflating them would make every modern tools/call fail its own schema.
 */
export function modernRequestMetaProblems(req: { params?: unknown }): string[] {
  const meta = paramsMeta(req)
  if (!meta) return [`params._meta is required and must carry ${META_PROTOCOL_VERSION} and ${META_CLIENT_CAPABILITIES}`]
  const problems: string[] = []
  const clientInfo = meta[META_CLIENT_INFO]
  if (clientInfo !== undefined) {
    if (typeof clientInfo !== 'object' || clientInfo === null || Array.isArray(clientInfo)) {
      problems.push(`params._meta.${META_CLIENT_INFO} is optional, but when present must be an object with name and version`)
    } else {
      const info = clientInfo as Record<string, unknown>
      if (typeof info.name !== 'string') problems.push(`params._meta.${META_CLIENT_INFO}.name is required and must be a string`)
      if (typeof info.version !== 'string') problems.push(`params._meta.${META_CLIENT_INFO}.version is required and must be a string`)
      for (const key of ['title', 'description', 'websiteUrl']) {
        if (info[key] !== undefined && typeof info[key] !== 'string') {
          problems.push(`params._meta.${META_CLIENT_INFO}.${key} must be a string when present`)
        }
      }
      if (info.icons !== undefined) {
        if (!Array.isArray(info.icons)) {
          problems.push(`params._meta.${META_CLIENT_INFO}.icons must be an array when present`)
        } else {
          for (const [index, icon] of info.icons.entries()) {
            if (!icon || typeof icon !== 'object' || Array.isArray(icon)) {
              problems.push(`params._meta.${META_CLIENT_INFO}.icons[${index}] must be an object`)
              continue
            }
            const record = icon as Record<string, unknown>
            if (typeof record.src !== 'string') problems.push(`params._meta.${META_CLIENT_INFO}.icons[${index}].src is required and must be a string`)
            if (record.mimeType !== undefined && typeof record.mimeType !== 'string') problems.push(`params._meta.${META_CLIENT_INFO}.icons[${index}].mimeType must be a string when present`)
            if (record.sizes !== undefined && (!Array.isArray(record.sizes) || record.sizes.some(size => typeof size !== 'string'))) {
              problems.push(`params._meta.${META_CLIENT_INFO}.icons[${index}].sizes must be an array of strings when present`)
            }
            if (record.theme !== undefined && record.theme !== 'light' && record.theme !== 'dark') {
              problems.push(`params._meta.${META_CLIENT_INFO}.icons[${index}].theme must be light or dark when present`)
            }
          }
        }
      }
    }
  }
  const logLevel = meta[META_LOG_LEVEL]
  if (logLevel !== undefined && (typeof logLevel !== 'string'
    || !['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'].includes(logLevel))) {
    problems.push(`params._meta.${META_LOG_LEVEL} must be a valid logging level when present`)
  }
  const capabilities = meta[META_CLIENT_CAPABILITIES]
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    // An EMPTY object is valid and means "no optional capabilities" — absence is
    // not the same thing, and the server must never infer capabilities.
    problems.push(`params._meta.${META_CLIENT_CAPABILITIES} is required and must be an object (an empty object declares no optional capabilities)`)
  } else {
    const record = capabilities as Record<string, unknown>
    const objectMember = (key: string): Record<string, unknown> | undefined => {
      const value = record[key]
      if (value === undefined) return undefined
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        problems.push(`params._meta.${META_CLIENT_CAPABILITIES}.${key} must be an object when present`)
        return undefined
      }
      return value as Record<string, unknown>
    }

    // The capability set is intentionally open, but the members the protocol
    // defines still have defined shapes. Accepting `roots: "yes"` advertises a
    // capability no conforming peer could interpret and defeats validation at
    // the stateless request boundary.
    const roots = objectMember('roots')
    if (roots?.listChanged !== undefined && typeof roots.listChanged !== 'boolean') {
      problems.push(`params._meta.${META_CLIENT_CAPABILITIES}.roots.listChanged must be a boolean when present`)
    }
    const sampling = objectMember('sampling')
    for (const key of ['context', 'tools']) {
      const value = sampling?.[key]
      if (value !== undefined && (typeof value !== 'object' || value === null || Array.isArray(value))) {
        problems.push(`params._meta.${META_CLIENT_CAPABILITIES}.sampling.${key} must be an object when present`)
      }
    }
    const elicitation = objectMember('elicitation')
    for (const key of ['form', 'url']) {
      const value = elicitation?.[key]
      if (value !== undefined && (typeof value !== 'object' || value === null || Array.isArray(value))) {
        problems.push(`params._meta.${META_CLIENT_CAPABILITIES}.elicitation.${key} must be an object when present`)
      }
    }
    for (const key of ['experimental', 'extensions']) {
      const entries = objectMember(key)
      if (!entries) continue
      for (const [name, value] of Object.entries(entries)) {
        if (key === 'extensions' && !/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\/.+/.test(name)) {
          problems.push(`params._meta.${META_CLIENT_CAPABILITIES}.extensions.${name} must use a namespaced key with a prefix`)
        }
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          problems.push(`params._meta.${META_CLIENT_CAPABILITIES}.${key}.${name} must be an object`)
        }
      }
    }
  }
  return problems
}
