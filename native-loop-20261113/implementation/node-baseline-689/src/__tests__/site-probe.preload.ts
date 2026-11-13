/**
 * Subprocess-only `bun --preload` for authority probes. Both switches are
 * environment-gated, so loading this file without them is inert; tests pass it
 * to child processes and never import it themselves.
 *
 *   AM_TEST_PROBE_STYLES=1         register one probe Look and one probe Palette
 *                                  before any consumer module loads, proving
 *                                  that consumer derives its roster from the
 *                                  registry rather than a shadow list.
 *   AM_TEST_REDIRECT_WRITE=<path>  send every Bun.write to <path>, so a site
 *                                  generator can run without writing into the
 *                                  checkout (the website build reads and
 *                                  deletes the generator's fixed output path).
 */
import { registerStyle } from '../scene/style-registry.ts'

export const PROBE_LOOK = 'look:registry-authority-probe'
export const PROBE_PALETTE = 'palette:registry-authority-probe'

if (process.env.AM_TEST_PROBE_STYLES === '1') {
  registerStyle({ name: PROBE_LOOK, stroke: 'jittered', roughness: 1.5 })
  registerStyle({ name: PROBE_PALETTE, colors: { bg: '#102030', fg: '#F0F4F8' } })
}

const redirectTarget = process.env.AM_TEST_REDIRECT_WRITE
if (redirectTarget) {
  const write = Bun.write
  ;(Bun as { write: unknown }).write = (_destination: unknown, data: unknown) => write(redirectTarget, data as string)
}
