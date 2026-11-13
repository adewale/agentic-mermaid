// Error identities shared by layout, rendering and diagnostics. No engine imports.
export class C4RouteWorkLimitError extends RangeError {
  readonly code = 'C4_ROUTE_WORK_LIMIT'
  constructor() { super('C4_ROUTE_WORK_LIMIT: physical corridor checks exceed 400000; split the diagram or reduce its relationships'); this.name = 'C4RouteWorkLimitError' }
}
