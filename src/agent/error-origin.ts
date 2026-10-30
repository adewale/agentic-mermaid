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
// Scene admission also checks ranges, extents and identities that authored
// values reach (a negative stroke width, a canvas past its cap, a duplicate
// id), so a Scene validation failure is the engine's only when every
// diagnostic compares facts the engine derived itself.
// ============================================================================

import { C4RouteWorkLimitError } from '../c4/errors.ts'
import { ErRouteGeometryError, ErRouteWorkLimitError } from '../er/errors.ts'
import { ErLabelWorkLimitError } from '../er/errors.ts'
import { MermaidFamilyDetectionError } from '../family-detection.ts'
import { GanttError } from '../gantt/types.ts'
import { GitGraphParseError } from '../gitgraph/parser.ts'
import { LayoutCertificationError } from '../layout/certification-error.ts'
import { GraphLayoutUnsupportedError } from '../layout/backend.ts'
import { LayoutPassContractError } from '../layout/pass.ts'
import { MindmapParseError } from '../mindmap/parser.ts'
import { QuadrantStyleColorError } from '../quadrant/point-style.ts'
import { PngRasterBudgetError, PngRasterizerError } from '../png-contract.ts'
import { ParsedDiagramFamilyMismatchError, RenderCapabilityError, RenderConfigError } from '../render-contract.ts'
import { PaintLayoutCertificationError } from '../scene/paint-certification.ts'
import { SceneValidationError } from '../scene/scene-validation-core.ts'
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
  // Our own consistency checks and contracts. Scene validation and layout
  // certification failures are decided by their diagnostics in
  // renderErrorOrigin, below.
  [LayoutPassContractError, 'engine'],
  [ErRouteGeometryError, 'engine'],
  [FamilyConformanceError, 'engine'],
  [HtmlEntityTableNotLoadedError, 'engine'],
  [ParsedDiagramFamilyMismatchError, 'engine'],
  [PngRasterizerError, 'engine'],
  // Theme, Mermaid config and caller render options.
  [ThemeVariableColorError, 'config'],
  [RenderOptionColorError, 'config'],
  [FamilyConfigColorError, 'config'],
  [JsonConfigAdmissionError, 'config'],
  [RenderConfigError, 'config'],
  [GraphLayoutUnsupportedError, 'config'],
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
  [PngRasterBudgetError, 'source'],
  [PaintLayoutCertificationError, 'source'],
]

const RUNTIME_DEFECTS: readonly ErrorClass[] = [TypeError, RangeError, ReferenceError]

/** Scene diagnostics no authored value can produce: a lowering's derived
 * facts disagreeing, or a family emitting a role or channel it never declared. */
const ENGINE_SCENE_DIAGNOSTICS: ReadonlySet<string> = new Set(['SCENE_FIDELITY', 'SCENE_PRIMITIVE_CLAIM', 'SCENE_CHANNEL_CLAIM'])

/** Who can fix the render-path failure `error`: the source, its configuration, or the engine. */
export function renderErrorOrigin(error: unknown): WarningOrigin {
  const seen = new Set<Error>()
  let innermost: unknown = error
  let link: unknown = error
  while (link instanceof Error && !seen.has(link)) {
    const current = link
    seen.add(current)
    // Every attempt failing on a duplicate identity means the author reused
    // an id; any other certification failure is the layout engine's.
    if (current instanceof LayoutCertificationError) {
      return current.attempts.length > 0 && current.attempts.every(attempt => attempt.violations.some(violation => violation.endsWith(': duplicate identity'))) ? 'source' : 'engine'
    }
    if (current instanceof SceneValidationError) {
      return current.diagnostics.length > 0 && current.diagnostics.every(item => ENGINE_SCENE_DIAGNOSTICS.has(item.code)) ? 'engine' : 'source'
    }
    const typed = ORIGINS.find(([type]) => current instanceof type)
    if (typed) return typed[1]
    innermost = current
    link = current.cause
  }
  return innermost instanceof Error && RUNTIME_DEFECTS.some(type => Object.getPrototypeOf(innermost) === type.prototype) ? 'engine' : 'source'
}
