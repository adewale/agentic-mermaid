import { beforeEach, afterEach } from 'vitest'
import { beginCase, finishCase, initializeReference, restoreSvgBBoxHost } from './runtime.ts'

await initializeReference()
restoreSvgBBoxHost()
beforeEach(context => beginCase(context.task))
afterEach(context => finishCase(context.task))
