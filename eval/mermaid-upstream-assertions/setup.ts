import { beforeEach, afterEach } from 'vitest'
import { beginCase, finishCase, initializeReference } from './runtime.ts'

await initializeReference()
beforeEach(context => beginCase(context.task))
afterEach(context => finishCase(context.task))
