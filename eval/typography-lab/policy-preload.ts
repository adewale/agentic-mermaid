// Replaces src/typography.ts for one worker process with the typography
// option named in AM_TYPOGRAPHY_POLICY, so every family renders through the
// real layout and paint pipeline under that option. Production code carries
// no lab hook: only this preload changes what typeSize returns.
import { plugin } from 'bun'
import { policySource, type LabPolicy } from './policies.ts'

const raw = process.env.AM_TYPOGRAPHY_POLICY
if (!raw) throw new Error('AM_TYPOGRAPHY_POLICY is required')
const policy = JSON.parse(raw) as LabPolicy

plugin({
  name: 'typography-lab-policy',
  setup(build) {
    build.onLoad({ filter: /\/src\/typography\.ts$/ }, () => ({ contents: policySource(policy), loader: 'ts' }))
  },
})
