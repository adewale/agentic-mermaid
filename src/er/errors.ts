// Error identities shared by layout, rendering and diagnostics. No engine imports.
export class ErRouteWorkLimitError extends RangeError {
  readonly code = 'ER_ROUTE_WORK_LIMIT'
  constructor() { super('ER_ROUTE_WORK_LIMIT: frame corridor checks exceed 400000; split the diagram or reduce its relationships'); this.name = 'ErRouteWorkLimitError' }
}

export class ErRouteGeometryError extends Error {
  readonly code = 'ER_ROUTE_BLOCKED'
  constructor(from: string, to: string) { super(`ER_ROUTE_BLOCKED: no clear frame corridor from ${from} to ${to}`); this.name = 'ErRouteGeometryError' }
}

export class ErLabelWorkLimitError extends RangeError {
  readonly code = 'ER_LABEL_WORK_LIMIT'
  constructor() { super('ER_LABEL_WORK_LIMIT: label-slot search exceeds 400000 operations; split the diagram or reduce its relationships'); this.name = 'ErLabelWorkLimitError' }
}
