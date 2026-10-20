// The LayoutPass abstraction — see docs/design/system/route-contracts.md §8.
//
// Generic over the concrete context so this module has NO dependency on the
// layout engine (and therefore cannot create an import cycle). The concrete
// `LayoutPassContext` and the `LAYOUT_PIPELINE` manifest live in
// `src/layout-engine.ts`, where the per-pass functions are in scope.
//
// Each pass mutates the shared context in place. Ordering, declared metric
// budgets and post-freeze geometry contracts apply to every production run.

export type PassEffect = 'extract' | 'positions' | 'dimensions' | 'edges' | 'translate'
export type Determinism = 'pure-order' | 'fixed-point' | 'in-place'
export type RubricMetric = 'hard' | 'crossings' | 'bends' | 'straight' | 'portRate' | 'symErr' | 'parallelOverlaps' | 'endpointApproaches' | 'opposingOverlaps'

/** Per-metric direction/budget for the ratchet (§3.3, resolves OQ-B1). */
export type MetricBudget = 'improve-only' | { worsenBy: number; whenImproves?: RubricMetric | readonly RubricMetric[]; perImprovement?: true }

export type PassMetrics = Partial<Record<RubricMetric, number>>

/** A broken pass contract must escape candidate fallback unchanged. */
export class LayoutPassContractError extends Error {
  readonly code: string = 'LAYOUT_PASS_CONTRACT_VIOLATION'
  constructor(readonly pass: string, readonly contract: 'ordering' | 'freeze' | 'certificate' | 'measurement' | 'metric-budget', message: string) {
    super(message)
    this.name = 'LayoutPassContractError'
  }
}

/** A pass exceeded its declared allowance on the geometry it actually produced. */
export class LayoutMetricBudgetError extends LayoutPassContractError {
  readonly code = 'LAYOUT_METRIC_BUDGET_EXCEEDED'
  constructor(
    pass: string,
    readonly metric: RubricMetric,
    readonly before: number,
    readonly after: number,
    readonly allowance: number,
  ) {
    super(pass, 'metric-budget', `Layout pass '${pass}' worsened ${metric} from ${before} to ${after} (allowance ${allowance})`)
    this.name = 'LayoutMetricBudgetError'
  }
}

/** The minimal shape `runPipeline` needs to enforce the freeze invariant (§3.2). */
export interface PassContextBase {
  frozen: boolean
  nodes: ReadonlyArray<PassBox>
  groups?: ReadonlyArray<PassGroup>
  edges?: ReadonlyArray<{
    points?: ReadonlyArray<{ x: number; y: number }>
    labelPosition?: { x: number; y: number }
    routeCertificate?: unknown
  }>
}

interface PassBox { id?: string; x: number; y: number; width: number; height: number }
interface PassGroup extends PassBox { children?: ReadonlyArray<PassGroup> }

export interface LayoutPass<C extends PassContextBase> {
  /** Stable id; the route-contracts §8 pipeline line is generated from `doc`. */
  id: string
  doc: string
  /** Partial-order deps (ids that must run earlier). */
  after: string[]
  /** Geometry channels this pass writes — drives the freeze invariant (§3.2). */
  mutates: PassEffect[]
  /** Per-metric direction/budget (the ratchet, §3.3), enforced in production. */
  mayChangeMetrics?: Partial<Record<RubricMetric, MetricBudget>>
  determinism: Determinism
  /** After this pass, node geometry is frozen (the route-contract pass). */
  freezesNodes?: boolean
  /** When present and false, the pass is skipped (e.g. bundling without mergeEdges). */
  enabled?: (ctx: C) => boolean
  run: (ctx: C) => void
}

export interface RunOptions<C extends PassContextBase> {
  /** Measure only requested declared budgets on actual before/after geometry. */
  measureMetrics?: (ctx: C, metrics: readonly RubricMetric[]) => PassMetrics
  /** Debug/CI only: called after each pass that actually ran (e.g. to measure the ratchet). */
  onAfterPass?: (pass: LayoutPass<C>, ctx: C) => void
}

const frozenBoxes = (ctx: PassContextBase): PassBox[] => {
  const boxes = [...ctx.nodes]
  const visit = (groups: ReadonlyArray<PassGroup>): void => {
    for (const group of groups) { boxes.push(group); visit(group.children ?? []) }
  }
  visit(ctx.groups ?? [])
  return boxes
}

/**
 * Run `passes` over `ctx` in array order and enforce its geometry contracts.
 */
export function runPipeline<C extends PassContextBase>(ctx: C, passes: ReadonlyArray<LayoutPass<C>>, opts: RunOptions<C> = {}): void {
  const ran = new Set<string>()
  let frozen = ctx.frozen
  for (const pass of passes) {
    if (pass.enabled && !pass.enabled(ctx)) {
      ran.add(pass.id)
      continue
    }

    for (const dep of pass.after) {
      if (!ran.has(dep)) {
        throw new LayoutPassContractError(pass.id, 'ordering', `LayoutPass ordering: '${pass.id}' must run after '${dep}', which has not run`)
      }
    }

    const budgets = Object.entries(pass.mayChangeMetrics ?? {}) as Array<[RubricMetric, MetricBudget]>
    const conditions = (budget: MetricBudget): readonly RubricMetric[] => budget === 'improve-only' || !budget.whenImproves ? [] : typeof budget.whenImproves === 'string' ? [budget.whenImproves] : budget.whenImproves
    const measured = [...new Set(budgets.flatMap(([metric, budget]) => [metric, ...conditions(budget)]))]
    if (budgets.length && !opts.measureMetrics) throw new LayoutPassContractError(pass.id, 'measurement', `Layout pass '${pass.id}' declares metric budgets but no geometry measurement was supplied`)
    const measure = (): PassMetrics => {
      try { return opts.measureMetrics!(ctx, measured) }
      catch (error) {
        if (error instanceof LayoutPassContractError) throw error
        throw new LayoutPassContractError(pass.id, 'measurement', `Layout pass '${pass.id}' could not measure its declared geometry: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const metricsBefore = budgets.length ? measure() : undefined

    // Inspect actual geometry even when a pass advertises only edge effects.
    // Coordinate snapshots are linear in the already-admitted artifact size.
    const before = frozen ? frozenBoxes(ctx).map(({ id, x, y, width, height }) => ({ id, x, y, width, height })) : undefined
    const beforeEdges = frozen ? (ctx.edges ?? []).map(edge => ({
      points: edge.points?.map(point => ({ ...point })),
      labelPosition: edge.labelPosition ? { ...edge.labelPosition } : undefined,
      certificate: edge.routeCertificate,
    })) : undefined

    pass.run(ctx)

    if (metricsBefore) {
      const metricsAfter = measure()
      const change = (metric: RubricMetric): number => {
        const before = metricsBefore[metric],
          after = metricsAfter[metric]
        if (before === undefined || after === undefined || !Number.isFinite(before) || !Number.isFinite(after)) {
          throw new LayoutPassContractError(pass.id, 'measurement', `Layout pass '${pass.id}' has no finite measurement for ${metric}`)
        }
        return (metric === 'straight' || metric === 'portRate' ? -1 : 1) * (after - before)
      }
      for (const [metric, budget] of budgets) {
        const improvement = Math.max(0, ...conditions(budget).map(metric => -change(metric)))
        const allowance = budget === 'improve-only' || (budget.whenImproves && improvement <= 1e-6) ? 0
          : budget.worsenBy * (budget.perImprovement ? Math.floor(improvement + 1e-6) : 1)
        if (change(metric) > allowance + 1e-6) throw new LayoutMetricBudgetError(pass.id, metric, metricsBefore[metric]!, metricsAfter[metric]!, allowance)
      }
    }

    if (before) {
      const after = frozenBoxes(ctx)
      const translate = pass.mutates.includes('translate')
      const dx = translate && before[0] && after[0] ? after[0].x - before[0].x : 0
      const dy = translate && before[0] && after[0] ? after[0].y - before[0].y : 0
      const shifted = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
        translate ? Math.abs(b.x - a.x - dx) <= 1e-6 && Math.abs(b.y - a.y - dy) <= 1e-6 : a.x === b.x && a.y === b.y
      if (after.length !== before.length || !ctx.frozen) throw new LayoutPassContractError(pass.id, 'freeze', `LayoutPass freeze: '${pass.id}' changed frozen geometry membership or state`)
      for (let i = 0; i < before.length; i++) {
        const a = before[i]!, b = after[i]!
        if (a.id !== b.id || a.width !== b.width || a.height !== b.height || !shifted(a, b)) {
          throw new LayoutPassContractError(pass.id, 'freeze', `LayoutPass freeze: '${pass.id}' moved frozen geometry without a uniform translation`)
        }
      }
      if (beforeEdges) {
        if ((ctx.edges?.length ?? 0) !== beforeEdges.length) throw new LayoutPassContractError(pass.id, 'freeze', `LayoutPass freeze: '${pass.id}' changed frozen edge membership`)
        for (let i = 0; i < beforeEdges.length; i++) {
          const prior = beforeEdges[i]!, edge = ctx.edges![i]!
          const unchanged = prior.points?.length === edge.points?.length && (prior.points ?? []).every((point, index) => edge.points?.[index] && shifted(point, edge.points[index]!))
          if (translate) {
            if (!unchanged || Boolean(prior.labelPosition) !== Boolean(edge.labelPosition) || (prior.labelPosition && !shifted(prior.labelPosition, edge.labelPosition!))) {
              throw new LayoutPassContractError(pass.id, 'freeze', `LayoutPass freeze: '${pass.id}' did not translate all frozen routes and labels uniformly`)
            }
          } else if (!unchanged && (!pass.mutates.includes('edges') || edge.routeCertificate === undefined || edge.routeCertificate === prior.certificate)) {
            throw new LayoutPassContractError(pass.id, 'certificate', `LayoutPass certificate: '${pass.id}' rewrote edge geometry after the route-contract freeze without re-issuing routeCertificate`)
          }
        }
      }
    }

    if (pass.freezesNodes) ctx.frozen = true
    frozen ||= ctx.frozen
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
