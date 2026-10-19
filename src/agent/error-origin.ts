// ============================================================================
// Render error origins — who can fix a failed render.
//
// verify reports a failure the author can fix as RENDER_FAILED, naming the
// source or its configuration as the origin, and a defect in Agentic Mermaid
// itself as INTERNAL_ERROR, which blames nothing the author wrote. The
// decision is by class, along the error's ES2022 `cause` chain:
//   - the first link whose class (or an ancestor) is in ORIGINS decides;
//   - otherwise the innermost error decides. A direct TypeError, RangeError or
//     ReferenceError is the runtime reporting a defect in our code, or an
//     invariant our code asserts with one. Anything else, a plain Error
//     included, is the source's: many parsers still throw plain Errors for
//     author mistakes, and an unlisted typed error is a deliberate refusal.
// Author input that could reach one of those runtime classes throws a typed
// error instead (work limits, JSON/config admission, RenderConfigError), and
// a subclass of a runtime class is never itself read as a runtime defect.
// ============================================================================

import { C4RouteWorkLimitError } from '../c4/routing.ts'
import { ErRouteGeometryError, ErRouteWorkLimitError } from '../er/layout.ts'
import { ErLabelWorkLimitError } from '../er/renderer.ts'
import { MermaidFamilyDetectionError } from '../family-detection.ts'
import { GanttError } from '../gantt/types.ts'
import { GitGraphParseError } from '../gitgraph/parser.ts'
import { LayoutCertificationError } from '../layout/certification-error.ts'
import { LayoutPassContractError } from '../layout/pass.ts'
import { MindmapParseError } from '../mindmap/parser.ts'
import { QuadrantStyleColorError } from '../quadrant/point-style.ts'
import { ParsedDiagramFamilyMismatchError, RenderCapabilityError, RenderConfigError } from '../render-contract.ts'
import { PaintLayoutCertificationError } from '../scene/paint-certification.ts'
import { SceneValidationError } from '../scene/scene-validation.ts'
import { StyleSpecError } from '../scene/style-registry.ts'
import { DiagramWorkLimitError } from '../shared/diagram-limits.ts'
import { HtmlEntityTableNotLoadedError } from '../shared/html-entity-table.ts'
import { JsonConfigAdmissionError } from '../shared/json-config-admission.ts'
import { AuthoredStyleColorError } from '../shared/style-props.ts'
import { MermaidSyntaxError } from '../shared/syntax-error.ts'
import { FamilyConfigColorError, RenderOptionColorError, ThemeVariableColorError } from '../theme-color-admission.ts'
import { FamilyConformanceError } from './families.ts'
import type { WarningOrigin } from './types.ts'

type ErrorClass = abstract new (...args: never[]) => Error

const ORIGINS: ReadonlyArray<readonly [ErrorClass, WarningOrigin]> = [
  // Our own consistency checks and contracts.
  [SceneValidationError, 'engine'],
  [LayoutPassContractError, 'engine'],
  [LayoutCertificationError, 'engine'],
  [ErRouteGeometryError, 'engine'],
  [FamilyConformanceError, 'engine'],
  [HtmlEntityTableNotLoadedError, 'engine'],
  [ParsedDiagramFamilyMismatchError, 'engine'],
  // Theme, Mermaid config and caller render options.
  [ThemeVariableColorError, 'config'],
  [RenderOptionColorError, 'config'],
  [FamilyConfigColorError, 'config'],
  [JsonConfigAdmissionError, 'config'],
  [RenderConfigError, 'config'],
  [RenderCapabilityError, 'config'],
  [StyleSpecError, 'config'],
  // The authored diagram, including host work limits it can exceed and the
  // final paint certification a strict render requires of it.
  [MermaidSyntaxError, 'source'],
  [GanttError, 'source'],
  [MindmapParseError, 'source'],
  [GitGraphParseError, 'source'],
  [AuthoredStyleColorError, 'source'],
  [QuadrantStyleColorError, 'source'],
  [MermaidFamilyDetectionError, 'source'],
  [DiagramWorkLimitError, 'source'],
  [ErRouteWorkLimitError, 'source'],
  [ErLabelWorkLimitError, 'source'],
  [C4RouteWorkLimitError, 'source'],
  [PaintLayoutCertificationError, 'source'],
]

const RUNTIME_DEFECTS: readonly ErrorClass[] = [TypeError, RangeError, ReferenceError]

/** Who can fix the render-path failure `error`: the source, its configuration, or the engine. */
export function renderErrorOrigin(error: unknown): WarningOrigin {
  const seen = new Set<Error>()
  let innermost: unknown = error
  let link: unknown = error
  while (link instanceof Error && !seen.has(link)) {
    const current = link
    seen.add(current)
    const typed = ORIGINS.find(([type]) => current instanceof type)
    if (typed) return typed[1]
    innermost = current
    link = current.cause
  }
  return innermost instanceof Error && RUNTIME_DEFECTS.some(type => Object.getPrototypeOf(innermost) === type.prototype) ? 'engine' : 'source'
}
