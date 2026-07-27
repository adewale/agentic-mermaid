// Runtime admission boundary for MCP messages.
//
// Raw JSON is deliberately kept on one side of this module. Code that can run
// a tool, consult the compute cache, or choose an era-specific result shape
// receives AdmittedMcpMessage instead, so it cannot accidentally skip envelope,
// version, or modern-metadata validation and cannot derive a second protocol
// context that disagrees with the first.

import { rpcError, type JsonRpcRequest, type JsonRpcResponse } from './protocol.ts'
import {
  HEADER_MISMATCH,
  isLegacyProtocolVersion,
  isModernProtocolVersion,
  META_PROTOCOL_VERSION,
  modernRequestMetaProblems,
  requestMetaProtocolVersion,
  requestMetaProtocolVersionClaim,
  UNSUPPORTED_PROTOCOL_VERSION,
  type ModernProtocolVersion,
  type ProtocolEra,
} from './protocol-versions.ts'

const admittedMcpMessage: unique symbol = Symbol('AdmittedMcpMessage')

export interface LegacyProtocolContext {
  readonly era: 'legacy'
  /** Legacy bodies normally omit this; stateful transports supply the version
   * selected by initialize and old HTTP clients may remain unversioned. */
  readonly version: string | undefined
  readonly supportedVersions: readonly string[]
}

export interface ModernProtocolContext {
  readonly era: 'modern'
  /** A modern message cannot cross admission without a known body declaration. */
  readonly version: ModernProtocolVersion
  readonly supportedVersions: readonly string[]
}

export type ProtocolContext = LegacyProtocolContext | ModernProtocolContext

interface AdmittedMcpMessageBase {
  readonly request: JsonRpcRequest
  readonly id: number | string | null
  readonly protocol: ProtocolContext
  readonly [admittedMcpMessage]: true
}

export interface AdmittedMcpRequest extends AdmittedMcpMessageBase {
  readonly notification: false
}

export interface AdmittedMcpNotification extends AdmittedMcpMessageBase {
  readonly notification: true
}

export type AdmittedMcpMessage = AdmittedMcpRequest | AdmittedMcpNotification

export function isAdmittedMcpRequest(message: AdmittedMcpMessage): message is AdmittedMcpRequest {
  return !message.notification
}

export type McpAdmissionFailureKind =
  | 'invalid-request'
  | 'header-mismatch'
  | 'unsupported-version'
  | 'invalid-modern-metadata'

export interface RejectedMcpMessage {
  readonly ok: false
  readonly kind: McpAdmissionFailureKind
  /** A valid notification has no JSON-RPC response even when its HTTP transport
   * rejects it. Malformed envelopes are never classified as notifications. */
  readonly response: JsonRpcResponse | null
  readonly protocol?: ProtocolContext
  /** Era selected by the request shape even when malformed input prevents a
   * branded ProtocolContext from being constructed. */
  readonly requestedEra?: ProtocolEra
}

export interface AcceptedMcpMessage {
  readonly ok: true
  readonly message: AdmittedMcpMessage
}

export type McpAdmissionResult = AcceptedMcpMessage | RejectedMcpMessage

export interface McpAdmissionOptions {
  /** Versions available on this exact transport, already intersected with the
   * server surface. Admission copies the list into ProtocolContext. */
  supportedVersions: readonly string[]
  /** HTTP mirror. Unlike negotiated state, disagreement with this value is a
   * HeaderMismatch error and an unsupported value is correlated with id:null,
   * preserving the pre-body transport refusal shape. */
  headerVersion?: string | null
  /** Version selected for a stateful connection. It supplies the version for a
   * legacy body but never fabricates an HTTP header-mismatch error. */
  negotiatedVersion?: string | null
  /** A stateful transport pins an era after its first admitted message. */
  protocolEra?: ProtocolEra
  /** Transport-specific mirrors for modern requests (Mcp-Method/Mcp-Name on
   * HTTP). The core owns ordering and error construction without importing a
   * web Request type. */
  requireModernVersionHeader?: boolean
  modernTransportProblem?: (request: JsonRpcRequest) => string | null
}

/** Pre-body HTTP gate for the mirrored protocol version. The full message
 * admission repeats this invariant so non-HTTP callers cannot bypass it; this
 * early form preserves transport refusal ordering ahead of content-type/body
 * reads without duplicating the rule in the HTTP handler. */
export function admitMcpHeaderVersion(
  headerVersion: string | null,
  supportedVersions: readonly string[],
): RejectedMcpMessage | null {
  if (headerVersion === null || supportedVersions.includes(headerVersion)) return null
  return {
    ok: false,
    kind: 'unsupported-version',
    response: rpcError(
      null,
      UNSUPPORTED_PROTOCOL_VERSION,
      `Unsupported protocol version: ${headerVersion}`,
      { supported: [...supportedVersions], requested: headerVersion },
    ),
  }
}

function responseId(raw: Record<string, unknown>, validId: boolean): number | string | null {
  const value = raw.id
  return validId && value !== undefined ? value as number | string | null : null
}

function rejection(
  kind: McpAdmissionFailureKind,
  notification: boolean,
  response: JsonRpcResponse,
  protocol?: ProtocolContext,
  requestedEra?: ProtocolEra,
): RejectedMcpMessage {
  return {
    ok: false,
    kind,
    response: notification ? null : response,
    ...(protocol ? { protocol } : {}),
    ...(requestedEra ? { requestedEra } : {}),
  }
}

function acceptance(
  request: JsonRpcRequest,
  id: number | string | null,
  notification: boolean,
  protocol: ProtocolContext,
): AcceptedMcpMessage {
  const base = { request, id, protocol, [admittedMcpMessage]: true } as const
  return notification
    ? { ok: true, message: { ...base, notification: true } }
    : { ok: true, message: { ...base, notification: false } }
}

/** Validate and classify one parsed JSON value exactly once. */
export function admitMcpMessage(rawMessage: unknown, options: McpAdmissionOptions): McpAdmissionResult {
  const raw = rawMessage as Record<string, unknown> | null
  const hasId = Boolean(raw && Object.prototype.hasOwnProperty.call(raw, 'id'))
  const rawId = raw?.id
  const validId = rawId === undefined || typeof rawId === 'string'
    || (typeof rawId === 'number' && Number.isSafeInteger(rawId))
  const validEnvelope = Boolean(raw && !Array.isArray(raw) && raw.jsonrpc === '2.0'
    && typeof raw.method === 'string' && validId)
  if (!validEnvelope) {
    return { ok: false, kind: 'invalid-request', response: rpcError(null, -32600, 'invalid JSON-RPC request') }
  }

  const request = rawMessage as JsonRpcRequest
  const id = responseId(raw!, validId)
  const notification = !hasId
  const versionClaim = requestMetaProtocolVersionClaim(request)
  const declaredVersion = requestMetaProtocolVersion(request)
  const requestedEra: ProtocolEra = versionClaim.present ? 'modern' : 'legacy'
  const supportedVersions = options.protocolEra === 'legacy'
    ? options.supportedVersions.filter(isLegacyProtocolVersion)
    : options.protocolEra === 'modern'
      ? options.supportedVersions.filter(isModernProtocolVersion)
      : [...options.supportedVersions]

  const effectiveTransportVersion = options.negotiatedVersion ?? options.headerVersion ?? undefined
  const provisionalProtocol: ProtocolContext = isModernProtocolVersion(declaredVersion)
    ? { era: 'modern', version: declaredVersion, supportedVersions }
    : { era: 'legacy', version: declaredVersion ?? effectiveTransportVersion, supportedVersions }

  // HTTP used to reject an unknown MCP-Protocol-Version before parsing the
  // body. Keep its id:null response and notification-independent envelope even
  // though the decision now lives in this shared admission boundary.
  const headerAdmission = admitMcpHeaderVersion(options.headerVersion ?? null, supportedVersions)
  if (headerAdmission) {
    return { ...headerAdmission, protocol: provisionalProtocol, requestedEra }
  }

  if (versionClaim.present && typeof versionClaim.value !== 'string') {
    return rejection(
      'invalid-modern-metadata',
      notification,
      rpcError(id, -32602, `Invalid params: params._meta.${META_PROTOCOL_VERSION} is required and must be a string`),
      undefined,
      'modern',
    )
  }

  if (options.negotiatedVersion != null && !supportedVersions.includes(options.negotiatedVersion)) {
    return rejection(
      'unsupported-version',
      notification,
      rpcError(
        id,
        UNSUPPORTED_PROTOCOL_VERSION,
        `Unsupported protocol version: ${options.negotiatedVersion}`,
        { supported: [...supportedVersions], requested: options.negotiatedVersion },
      ),
      provisionalProtocol,
      requestedEra,
    )
  }

  if (declaredVersion !== undefined && options.headerVersion != null
    && declaredVersion !== options.headerVersion) {
    return rejection(
      'header-mismatch',
      notification,
      rpcError(
        id,
        HEADER_MISMATCH,
        `Header mismatch: MCP-Protocol-Version header value '${options.headerVersion}' does not match body value '${declaredVersion}'`,
      ),
      provisionalProtocol,
      requestedEra,
    )
  }

  if (options.protocolEra !== undefined && requestedEra !== options.protocolEra) {
    const requested = declaredVersion ?? effectiveTransportVersion ?? 'unversioned'
    return rejection(
      'unsupported-version',
      notification,
      rpcError(
        id,
        UNSUPPORTED_PROTOCOL_VERSION,
        `Unsupported protocol version: ${requested}`,
        { supported: [...supportedVersions], requested },
      ),
      provisionalProtocol,
      requestedEra,
    )
  }

  if (declaredVersion !== undefined && !supportedVersions.includes(declaredVersion)) {
    return rejection(
      'unsupported-version',
      notification,
      rpcError(
        id,
        UNSUPPORTED_PROTOCOL_VERSION,
        `Unsupported protocol version: ${declaredVersion}`,
        { supported: [...supportedVersions], requested: declaredVersion },
      ),
      provisionalProtocol,
      requestedEra,
    )
  }

  const era = options.protocolEra
    ?? (isModernProtocolVersion(options.headerVersion) || isModernProtocolVersion(options.negotiatedVersion)
      ? 'modern'
      : requestedEra)

  if (era === 'modern') {
    // A modern ProtocolContext is constructible only from the body declaration;
    // a modern header with no matching body reaches the mirror error below.
    if (!isModernProtocolVersion(declaredVersion)) {
      const problem = `params._meta.${META_PROTOCOL_VERSION} is required and must match the MCP-Protocol-Version header (${options.headerVersion})`
      return rejection(
        'header-mismatch',
        notification,
        rpcError(id, HEADER_MISMATCH, `Header mismatch: ${problem}`),
        provisionalProtocol,
        requestedEra,
      )
    }
    const protocol: ModernProtocolContext = { era: 'modern', version: declaredVersion, supportedVersions }
    if (options.requireModernVersionHeader && options.headerVersion == null) {
      return rejection(
        'header-mismatch',
        notification,
        rpcError(
          id,
          HEADER_MISMATCH,
          `Header mismatch: MCP-Protocol-Version header is required for protocol version ${declaredVersion}`,
        ),
        protocol,
        requestedEra,
      )
    }
    const transportProblem = options.modernTransportProblem?.(request) ?? null
    if (transportProblem !== null) {
      return rejection(
        'header-mismatch',
        notification,
        rpcError(id, HEADER_MISMATCH, `Header mismatch: ${transportProblem}`),
        protocol,
        requestedEra,
      )
    }
    const metaProblems = modernRequestMetaProblems(request)
    if (metaProblems.length > 0) {
      return rejection(
        'invalid-modern-metadata',
        notification,
        rpcError(id, -32602, `Invalid params: ${metaProblems.join('; ')}`),
        protocol,
        requestedEra,
      )
    }
    return acceptance(request, id, notification, protocol)
  }

  const protocol: LegacyProtocolContext = {
    era: 'legacy',
    version: declaredVersion ?? effectiveTransportVersion,
    supportedVersions,
  }
  return acceptance(request, id, notification, protocol)
}
