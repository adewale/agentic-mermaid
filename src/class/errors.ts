// Error identities shared by layout, rendering and diagnostics. No engine imports.

/** The Class layout's admission checks (marker capacity, header lanes, owned
 * surfaces and final sharp contacts) share one 400000-operation budget per
 * render (MAX_OCCLUSION_OPERATIONS). Exhausting it is a property of the
 * diagram's size, not an engine defect. */
export class ClassLayoutWorkLimitError extends RangeError {
  readonly code = 'CLASS_LAYOUT_WORK_LIMIT'
  constructor(options?: { cause?: unknown }) {
    super('CLASS_LAYOUT_WORK_LIMIT: layout admission checks exceed 400000 operations; split the diagram or reduce its classes or relationships', options)
    this.name = 'ClassLayoutWorkLimitError'
  }
}
