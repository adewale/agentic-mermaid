/** Tiny shared evidence constants. Keeping these separate prevents an SVG-only
 * entry from importing the executable PNG and terminal policy graphs merely
 * to describe the complete public output matrix. */
export const PNG_OUTPUT_POLICY_VERSION = 4 as const
export const TERMINAL_OUTPUT_POLICY_VERSION = 1 as const

/** Logical PNG projection scale shared with lightweight CLI help. */
export const PNG_DEFAULT_SCALE = 2 as const
