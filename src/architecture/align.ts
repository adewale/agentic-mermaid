// ============================================================================
// Architecture `align` directives (upstream v11.16.0, PR #7708)
//
//   align row {idA} {idB} ...
//   align column {idA} {idB} ...
//
// Upstream grammar: `align` / `row` / `column` are reserved words; members
// must be already-declared services or junctions (never groups); at least two
// members are required; a member may not repeat within one directive.
//
// This module is the single owner of the directive's shape: the strict render
// parser (src/architecture/parser.ts) and the structured agent body parser
// (src/agent/architecture-body.ts) both consume it, so the two surfaces
// cannot drift. Placement semantics are deliberately NOT implemented: the
// deterministic layered layout never collapses siblings onto one coordinate
// (the fcose failure mode `align` was invented to patch), so alignments are
// parsed, preserved losslessly, and announced by verify's Tier-3
// UNSUPPORTED_SYNTAX lint (syntax: architecture_align) instead of silently
// dropped or hard-errored. See docs/design/families/architecture.md.
// ============================================================================

export type ArchitectureAlignmentAxis = 'row' | 'column'

export interface ArchitectureAlignment {
  axis: ArchitectureAlignmentAxis
  /** Declared services/junctions, in source order (≥2, unique per directive). */
  members: string[]
}

/**
 * Lines whose first token is the reserved word `align`. Ids that merely start
 * with the keyword (`alignment`, or an edge endpoint `align:R`) do not match.
 */
export const ALIGN_DIRECTIVE_RE = /^align(?:\s|$)/

const MEMBER_RE = /^[\w-]+$/

export type AlignParseResult =
  | { ok: true; alignment: ArchitectureAlignment }
  | { ok: false; reason: string }

/**
 * Parse one `align` directive line (already known to match
 * ALIGN_DIRECTIVE_RE). Enforces the shape-level upstream rules — axis keyword,
 * member-token syntax, minimum two members, no duplicates. Member DECLARATION
 * (service/junction vs group vs unknown) is the caller's check because the two
 * consumers hold their declaration tables differently.
 */
export function parseAlignDirective(line: string): AlignParseResult {
  const tokens = line.trim().split(/\s+/)
  const axis = tokens[1]
  if (axis !== 'row' && axis !== 'column') {
    return { ok: false, reason: `expected "align row" or "align column", got "${axis ?? ''}"` }
  }
  const members = tokens.slice(2)
  if (members.length < 2) {
    return { ok: false, reason: 'an align directive needs at least two members' }
  }
  const seen = new Set<string>()
  for (const member of members) {
    if (!MEMBER_RE.test(member)) {
      return { ok: false, reason: `align member "${member}" must match [A-Za-z0-9_-]+` }
    }
    if (seen.has(member)) {
      return { ok: false, reason: `align member "${member}" is listed twice` }
    }
    seen.add(member)
  }
  return { ok: true, alignment: { axis, members } }
}

/** Canonical serialization — the exact form both parsers re-accept. */
export function serializeAlignDirective(alignment: ArchitectureAlignment): string {
  return `align ${alignment.axis} ${alignment.members.join(' ')}`
}
