import { resolve } from 'node:path'
import { assertWebsiteFixture, prepareWebsiteFixture } from '../../scripts/site/prepare-website-fixture.ts'

const ROOT = resolve(import.meta.dir, '../..')
let ready = false

/** Focused tests prepare once on first use. The canonical runner prepares once
 * before starting workers and passes the owning checkout explicitly. Re-run
 * the test command after editing build inputs; no source snapshot is cached. */
export function ensureWebsiteBuilt(): void {
  if (ready) return
  if (process.env.AM_WEBSITE_FIXTURE_ROOT === ROOT) assertWebsiteFixture(ROOT)
  else prepareWebsiteFixture(ROOT)
  ready = true
}
