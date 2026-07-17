export interface BrowserContractFile {
  /** Path resolved from the e2e/ working directory. */
  file: string
  browserOptIn?: boolean
}

/** One file per process: sharing Playwright/server hooks exhausts constrained
 * runners and can turn valid browser contracts into timeout cascades. */
export const BROWSER_CONTRACT_FILES: readonly BrowserContractFile[] = Object.freeze([
  Object.freeze({ file: 'security-csp.e2e.test.ts' }),
  Object.freeze({ file: 'browser.test.ts' }),
  Object.freeze({ file: '../src/__tests__/editor-theme-switch.test.ts', browserOptIn: true }),
  Object.freeze({ file: '../src/__tests__/editor-style-switch.test.ts', browserOptIn: true }),
  Object.freeze({ file: '../src/__tests__/website-browser-a11y.test.ts', browserOptIn: true }),
])
