// Child-process helper for the cross-process determinism test.
import { verifyMermaid } from '../../agent/verify.ts'
process.stdout.write(JSON.stringify(verifyMermaid(process.argv[2]!).layout))
