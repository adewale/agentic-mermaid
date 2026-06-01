// ============================================================================
// am CLI — exit code conventions.
//
// Replaces the inline 0/1/2 literals across src/cli/index.ts with a single
// shared scheme so downstream scripts can branch on cause-of-failure.
// ============================================================================

/** Success. The command produced its expected output. */
export const EXIT_OK = 0

/** Usage / argument-parse error (bad flag, missing file, malformed --op JSON). */
export const EXIT_ARG_ERROR = 2

/** Verify ran successfully but the diagram has errors (warnings of severity 'error'). */
export const EXIT_VERIFY_FAILED = 3

/** Uncaught exception inside the CLI (a bug). */
export const EXIT_INTERNAL = 4
