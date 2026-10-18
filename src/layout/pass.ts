// The LayoutPass abstraction — see docs/design/system/layout-pass-pipeline.md.
//
// Generic over the concrete context so this module has NO dependency on the
// layout engine (and therefore cannot create an import cycle). The concrete
// `LayoutPassContext` and the `LAYOUT_PIPELINE` manifest live in
// `src/layout-engine.ts`, where the per-pass functions are in scope.
//
// In production `runPipeline` is a thin dispatcher: each pass mutates the shared
// context in place, byte-identical to the former hand-wired sequence. The
// cross-pass invariants (§3) are enforced only when `checkInvariants` is set, so
// they ride debug/CI and never the production render path.

export type PassEffect = 'extract' | 'positions' | 'dimensions' | 'edges' | 'translate'
export type Determinism = 'pure-order' | 'fixed-point' | 'in-place'
export type RubricMetric = 'hard' | 'crossings' | 'bends' | 'straight' | 'portRate' | 'symErr'

/** Per-metric direction/budget for the ratchet (§3.3, resolves OQ-B1). */
export type MetricBudget = 'improve-only' | { worsenBy: number; whenImproves?: RubricMetric }

export type PassMetrics = Partial<Record<RubricMetric, number>>

/** A pass exceeded its declared allowance on the geometry it actually produced. */
export class LayoutMetricBudgetError extends Error {
  readonly code = 'LAYOUT_METRIC_BUDGET_EXCEEDED'
  constructor(
    readonly pass: string,
    readonly metric: RubricMetric,
    readonly before: number,
    readonly after: number,
    readonly allowance: number,
  ) {
    super(`Layout pass '${pass}' worsened ${metric} from ${before} to ${after} (allowance ${allowance})`)
    this.name = 'LayoutMetricBudgetError'
  }
}

/** The minimal shape `runPipeline` needs to enforce the freeze invariant (§3.2). */
export interface PassContextBase {
  frozen: boolean
  nodes: ReadonlyArray<{ x: number; y: number; width: number; height: number }>
  edges?: ReadonlyArray<{
    points?: ReadonlyArray<{ x: number; y: number }>
    routeCertificate?: unknown
  }>
}

export interface LayoutPass<C extends PassContextBase> {
  /** Stable id; the route-contracts §8 pipeline line is generated from `doc`. */
  id: string
  doc: string
  /** Partial-order deps (ids that must run earlier). Checked in debug mode. */
  after: string[]
  /** Geometry channels this pass writes — drives the freeze invariant (§3.2). */
  mutates: PassEffect[]
  /** Per-metric direction/budget (the ratchet, §3.3); enforced only in debug/CI. */
  mayChangeMetrics?: Partial<Record<RubricMetric, MetricBudget>>
  determinism: Determinism
  /** After this pass, node geometry is frozen (the route-contract pass). */
  freezesNodes?: boolean
  /** When present and false, the pass is skipped (e.g. bundling without mergeEdges). */
  enabled?: (ctx: C) => boolean
  run: (ctx: C) => void
}

export interface RunOptions<C extends PassContextBase> {
  /** Debug/CI only: enforce ordering + freeze invariants (O(n) per mover). */
  checkInvariants?: boolean
  /** With invariant checking, measure declared budgets on actual before/after geometry. */
  measureMetrics?: (ctx: C, metrics: readonly RubricMetric[]) => PassMetrics
  /** Debug/CI only: called after each pass that actually ran (e.g. to measure the ratchet). */
  onAfterPass?: (pass: LayoutPass<C>, ctx: C) => void
}

/** Post-freeze a pass may only translate the whole graph or rewrite edges (§3.2). */
const freezeSafe = (mutates: PassEffect[]): boolean => mutates.every(m => m === 'translate' || m === 'edges')

const routeKey = (edge: { points?: ReadonlyArray<{ x: number; y: number }> }): string => edge.points?.map(p => `${p.x},${p.y}`).join('|') ?? ''

/**
 * Run `passes` over `ctx` in array order. The array IS the execution path; with
 * `checkInvariants` the runner also enforces the §3 contract (ordering + freeze).
 */
export function runPipeline<C extends PassContextBase>(ctx: C, passes: ReadonlyArray<LayoutPass<C>>, opts: RunOptions<C> = {}): void {
  const ran = new Set<string>()
  for (const pass of passes) {
    if (pass.enabled && !pass.enabled(ctx)) {
      ran.add(pass.id)
      continue
    }

    if (opts.checkInvariants) {
      for (const dep of pass.after) {
        if (!ran.has(dep)) {
          throw new Error(`LayoutPass ordering: '${pass.id}' must run after '${dep}', which has not run`)
        }
      }
    }

    const budgets = opts.checkInvariants ? (Object.entries(pass.mayChangeMetrics ?? {}) as Array<[RubricMetric, MetricBudget]>) : []
    const measured = [...new Set(budgets.flatMap(([metric, budget]) => [metric, ...(typeof budget === 'object' && budget.whenImproves ? [budget.whenImproves] : [])]))]
    if (budgets.length && !opts.measureMetrics) throw new Error(`Layout pass '${pass.id}' declares metric budgets but no geometry measurement was supplied`)
    const metricsBefore = budgets.length ? opts.measureMetrics!(ctx, measured) : undefined

    // Freeze invariant (§3.2): after the route-contract pass only a whole-graph
    // translation (or an edge rewrite) may run; a positions/dimensions move is illegal.
    const guardFreeze = opts.checkInvariants === true && ctx.frozen && !freezeSafe(pass.mutates)
    const before = guardFreeze ? ctx.nodes.map(n => ({ x: n.x, y: n.y, width: n.width, height: n.height })) : undefined
    const beforeEdges = opts.checkInvariants === true && ctx.frozen && pass.mutates.includes('edges') && ctx.edges ? ctx.edges.map(routeKey) : undefined

    pass.run(ctx)

    if (metricsBefore) {
      const metricsAfter = opts.measureMetrics!(ctx, measured)
      const change = (metric: RubricMetric): number => {
        const before = metricsBefore[metric],
          after = metricsAfter[metric]
        if (before === undefined || after === undefined || !Number.isFinite(before) || !Number.isFinite(after)) {
          throw new Error(`Layout pass '${pass.id}' has no finite measurement for ${metric}`)
        }
        return (metric === 'straight' || metric === 'portRate' ? -1 : 1) * (after - before)
      }
      for (const [metric, budget] of budgets) {
        const allowance = budget === 'improve-only' || (budget.whenImproves && change(budget.whenImproves) >= -1e-6) ? 0 : budget.worsenBy
        if (change(metric) > allowance + 1e-6) throw new LayoutMetricBudgetError(pass.id, metric, metricsBefore[metric]!, metricsAfter[metric]!, allowance)
      }
    }

    if (before) {
      for (let i = 0; i < before.length; i++) {
        const a = before[i]
        const b = ctx.nodes[i]
        if (!a || !b) continue
        if (a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height) {
          throw new Error(`LayoutPass freeze: '${pass.id}' moved node geometry after the route-contract freeze ` + `(only translate/edge passes are allowed; declare 'translate' in mutates if this is a uniform shift)`)
        }
      }
    }

    if (beforeEdges && ctx.edges) {
      for (let i = 0; i < beforeEdges.length; i++) {
        const edge = ctx.edges[i]
        if (!edge) continue
        if (beforeEdges[i] !== routeKey(edge) && edge.routeCertificate === undefined) {
          throw new Error(`LayoutPass certificate: '${pass.id}' rewrote edge geometry after the route-contract freeze ` + 'without re-issuing routeCertificate')
        }
      }
    }

    if (pass.freezesNodes) ctx.frozen = true
    ran.add(pass.id)
    opts.onAfterPass?.(pass, ctx)
  }
}

/** A pipeline is well-formed iff its array order is a topological order of `after`. */
export function assertTopologicalOrder<C extends PassContextBase>(passes: ReadonlyArray<LayoutPass<C>>): void {
  const seen = new Set<string>()
  for (const pass of passes) {
    for (const dep of pass.after) {
      if (!seen.has(dep)) {
        throw new Error(`LayoutPass pipeline order: '${pass.id}' precedes its dependency '${dep}'`)
      }
    }
    seen.add(pass.id)
  }
}
