import { normalizeMermaidSource } from '../mermaid-source.ts'
import type { EventModelingBody } from '../eventmodeling/types.ts'
import type { ZenUmlBody } from '../zenuml/types.ts'
import { accessibilityTitleText, accessibilityDescriptionText } from './accessibility-envelope.ts'
import type { FamilyOperations, ExtractedLabel } from './family-registry.ts'
import { err, ok, type AnyMutationOp, type MutationError, type Result } from './types.ts'

type NativeBody = EventModelingBody | ZenUmlBody
const identity = (body: NativeBody) => body
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export function nativeMutationFailure(error: unknown): Result<never, MutationError> {
  return err({ code: 'INVALID_OP', message: errorMessage(error) })
}

/** Refuse a typed write when grammar emission changes unrelated authored data.
 * Parser-generated statement occurrence IDs are removed by their owning family. */
export function sameAuthoredValue(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]))
    return value
  }
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

export function mutateNativeMetadata(body: NativeBody, op: { kind: string; title?: string | null; description?: string | null }): boolean {
  switch (op.kind) {
    case 'set_title': body.title = op.title ?? undefined; break
    case 'set_accessibility_title': body.accessibilityTitle = op.title == null ? undefined : accessibilityTitleText(op.title); break
    case 'set_accessibility_description': body.accessibilityDescription = op.description == null ? undefined : accessibilityDescriptionText(op.description); break
    default: return false
  }
  return true
}
export function readNativeWrite<T extends NativeBody>(body: T, render: (body: T) => string, parse: (source: string) => T, caption: string, authored: (body: T) => unknown = identity, validate?: (body: T) => unknown): T {
  const source = normalizeMermaidSource(render(body), {}, 'authored')
  const parsed = Object.assign(parse(source.familyBody), { accessibilityTitle: source.accessibility.title, accessibilityDescription: source.accessibility.descr })
  validate?.(parsed)
  if (!sameAuthoredValue(authored(body), authored(parsed))) throw Error(`${caption} edit cannot be serialized without changing authored meaning`)
  return parsed
}

/** Both native descriptors use the same error/opaque/write boundary. Family
 * parsers, authored projections and operation implementations remain owners. */
export function nativeDomainHooks<T extends NativeBody, O extends AnyMutationOp>(kind: T['kind'], caption: string, parse: (source: string) => T, render: (body: T) => string, mutate: (body: T, op: O) => Result<T, MutationError>, labels: (body: T) => ExtractedLabel[], validate?: (body: T) => unknown, copyAccessibility = false): FamilyOperations {
  const expected = `Expected ${caption} body`
  return {
    parse: ctx => {
      try {
        const body = parse(ctx.source.familyBody)
        if (copyAccessibility) Object.assign(body, ctx.meta.accessibility.title ? { accessibilityTitle: ctx.meta.accessibility.title } : {}, ctx.meta.accessibility.descr ? { accessibilityDescription: ctx.meta.accessibility.descr } : {})
        validate?.(body)
        return ok(body)
      } catch (error) {
        const message = errorMessage(error)
        return message.startsWith(`Unsupported ${caption}`) ? ok({ kind: 'opaque', family: kind, source: ctx.opaqueSource }) : err([{ code: 'PARSE_FAILED', message }])
      }
    },
    serialize: body => { if (body.kind !== kind) throw Error(expected); return render(body as T) },
    mutate: (body, op) => body.kind === kind ? mutate(body as T, op as O) : err({ code: 'UNSUPPORTED_FAMILY', message: expected }),
    renderSource: body => body.kind === 'opaque' ? 'canonical' : 'serialized',
    extractLabels: source => { try { return labels(parse(source)) } catch { return [] } },
  }
}
