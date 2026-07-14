#!/usr/bin/env bun
import architectsDaughter from '../assets/fonts/ArchitectsDaughter.ttf' with { type: 'file' }
import caveat from '../assets/fonts/Caveat.ttf' with { type: 'file' }
import dejaVuSansBold from '../assets/fonts/DejaVuSans-Bold.ttf' with { type: 'file' }
import dejaVuSans from '../assets/fonts/DejaVuSans.ttf' with { type: 'file' }
import ebGaramond from '../assets/fonts/EBGaramond.ttf' with { type: 'file' }
import fontLicenses from '../assets/fonts/FONT-LICENSES.md' with { type: 'file' }
import interBold from '../assets/fonts/Inter-Bold.ttf' with { type: 'file' }
import interMedium from '../assets/fonts/Inter-Medium.ttf' with { type: 'file' }
import interRegular from '../assets/fonts/Inter-Regular.ttf' with { type: 'file' }
import interSemiBold from '../assets/fonts/Inter-SemiBold.ttf' with { type: 'file' }
import shareTechMono from '../assets/fonts/ShareTechMono.ttf' with { type: 'file' }
import { registerEmbeddedFontResourceFiles } from '../src/agent/embedded-font-resources.ts'
import { dependencyStartupMessage } from './dependency-error.ts'

// Bun rewrites file imports to opaque `/$bunfs/...` paths in a compiled
// executable. Preserve the canonical manifest paths alongside them so the PNG
// host can reconstruct and verify the complete offline resource closure.
registerEmbeddedFontResourceFiles([
  { manifestPath: 'assets/fonts/Inter-Regular.ttf', embeddedPath: interRegular },
  { manifestPath: 'assets/fonts/Inter-Medium.ttf', embeddedPath: interMedium },
  { manifestPath: 'assets/fonts/Inter-SemiBold.ttf', embeddedPath: interSemiBold },
  { manifestPath: 'assets/fonts/Inter-Bold.ttf', embeddedPath: interBold },
  { manifestPath: 'assets/fonts/Caveat.ttf', embeddedPath: caveat },
  { manifestPath: 'assets/fonts/EBGaramond.ttf', embeddedPath: ebGaramond },
  { manifestPath: 'assets/fonts/ArchitectsDaughter.ttf', embeddedPath: architectsDaughter },
  { manifestPath: 'assets/fonts/ShareTechMono.ttf', embeddedPath: shareTechMono },
  { manifestPath: 'assets/fonts/DejaVuSans.ttf', embeddedPath: dejaVuSans },
  { manifestPath: 'assets/fonts/DejaVuSans-Bold.ttf', embeddedPath: dejaVuSansBold },
  { manifestPath: 'assets/fonts/FONT-LICENSES.md', embeddedPath: fontLicenses },
])

let entry: typeof import('../src/cli/run-entrypoint.ts')
try {
  entry = await import('../src/cli/run-entrypoint.ts')
} catch (error) {
  process.stderr.write(`agentic-mermaid: ${dependencyStartupMessage(error)}\n`)
  process.exit(1)
}

const code = await entry.runAmCli(process.argv.slice(2)); if (code !== 0) process.exit(code)
