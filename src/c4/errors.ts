// Error identities shared by layout, rendering and diagnostics. No engine imports.
/** The most relationships one C4 diagram routes. Real C4 diagrams stay far
 * below it (the largest of 414 surveyed fork-network diagrams has 31), and
 * routing many more spends the route work before it draws. */
export const C4_RELATIONSHIP_LIMIT = 150

/** Pixel layout refuses a C4 diagram whose routes exceed the route work, or,
 * given `relationships`, whose relationship count exceeds
 * C4_RELATIONSHIP_LIMIT before any layout work. */
export class C4RouteWorkLimitError extends RangeError {
  readonly code = 'C4_ROUTE_WORK_LIMIT'
  constructor(relationships?: number) {
    super(relationships === undefined
      ? 'C4_ROUTE_WORK_LIMIT: physical corridor checks exceed 400000; split the diagram or reduce its relationships'
      : `C4_ROUTE_WORK_LIMIT: ${relationships} relationships exceed the ${C4_RELATIONSHIP_LIMIT} a C4 layout routes; split the diagram or reduce its relationships`)
    this.name = 'C4RouteWorkLimitError'
  }
}
