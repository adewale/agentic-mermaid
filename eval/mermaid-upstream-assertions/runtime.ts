import { appendFileSync, readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { knownBuiltinFamilies, getFamily } from '../../src/agent/core.ts'
import { normalizeMermaidSource } from '../../src/mermaid-source.ts'
import { parseNativeModel } from '../mermaid-modern-compat/grammar-agentic.ts'
import { withParserObservation, type ParserObservation } from '../../src/shared/parser-observation.ts'
import { nativeGetters, nativeAst } from './views.ts'
import * as candidateEventParser from '../../src/eventmodeling/parser.ts'

export const referenceMode = process.env.AM_ASSERT_MODE === 'reference'
const contexts = new Map<string, AdapterContext>()
const referenceRequire = createRequire(resolve(process.env.AM_ASSERT_REFERENCE ?? '../probe-runtime', 'package.json'))
let reference: any, referenceConfig: any, language: any, referenceEventValidation: any
interface ParsedInput { family: string; source: string; accepted?: boolean; error?: string }
interface ExecutedCheck { family: string; operation: string; targetType?: string; sourceTypes?: Array<string | null> }
let active: { file: string; name: string; path: string[]; inputs: ParsedInput[]; checks: ExecutedCheck[]; missing: Set<string> } | undefined

export class AdapterBoundary extends Error {}
export function noteUnavailable(name: string): void { active?.missing.add(name) }
export function unavailable(name: string): never {
  active?.missing.add(name)
  throw new AdapterBoundary(`UPSTREAM_ADAPTER_UNAVAILABLE: ${name}`)
}

function deferred(name: string): any {
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === 'then') return undefined
      if (key === Symbol.toStringTag) return 'UnmappedUpstreamAPI'
      return deferred(`${name}.${String(key)}`)
    },
    apply() { return unavailable(name) },
    construct() { return unavailable(`new ${name}`) },
  })
}

export async function initializeReference(): Promise<void> {
  if (!referenceMode || reference) return
  const entry = referenceRequire.resolve('mermaid')
  reference = (await import(/* @vite-ignore */ pathToFileURL(entry).href)).default
  reference.initialize({ startOnLoad: false, securityLevel: 'strict', logLevel: 'fatal' })
  // Read the packaged entry's own import, rather than guessing a chunk name.
  const source = readFileSync(entry, 'utf8')
  const configChunk = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)].find(match => /\bsetConfig\b/.test(match[1]!))?.[2]
  if (!configChunk) throw new Error('Pinned Mermaid does not expose its config import')
  referenceConfig = await import(/* @vite-ignore */ new URL(configChunk, pathToFileURL(entry)).href)
  const parserPackage = referenceRequire.resolve.paths('@mermaid-js/parser')?.map(directory => join(directory, '@mermaid-js/parser/package.json')).find(existsSync)
  if (!parserPackage) throw new Error('Independent pinned parser dependency is unavailable')
  const parserExport = JSON.parse(readFileSync(parserPackage, 'utf8')).exports['.'].import
  language = await import(/* @vite-ignore */ pathToFileURL(resolve(dirname(parserPackage), parserExport)).href)
  const requested = (process.env.AM_ASSERT_FAMILIES ?? knownBuiltinFamilies().join(',')).split(',')
  let zenReference: any
  if (requested.includes('zenuml')) {
    // run.ts fixes cwd to the Agentic checkout. Avoid Vite treating a
    // new-URL expression as an asset served through its HTTP origin.
    const helper = pathToFileURL(resolve('eval/mermaid-modern-compat/zenuml-reference.mjs')).href
    const { createZenUMLReference } = await import(/* @vite-ignore */ helper)
    const version = JSON.parse(readFileSync(referenceRequire.resolve('mermaid/package.json'), 'utf8')).version
    zenReference = createZenUMLReference(reference, version)
    await zenReference.load()
  }
  if (requested.includes('eventmodeling')) {
    // The runner verifies this checkout's pinned revision and clean tracked
    // source before either mode starts. Execute the original validator itself;
    // all its imports are type-only, so no Langium state is reconstructed.
    const validator = resolve(process.env.AM_ASSERT_UPSTREAM ?? '../mermaid-pinned', 'packages/parser/src/language/eventmodeling/event-modeling-validator.ts')
    referenceEventValidation = await import(/* @vite-ignore */ pathToFileURL(validator).href)
  }
  for (const family of requested) {
    const example = getFamily(family)?.example
    if (!example) continue
    try {
      const diagram = family === 'zenuml' ? await zenReference.diagram(example) : await reference.mermaidAPI.getDiagramFromText(example)
      referenceDefinitions.set(family, diagram)
    } catch (error) { referenceDefinitions.set(family, error) }
  }
}
const referenceDefinitions = new Map<string, any>()

function taskPath(task: any): string[] {
  const names = [task.name]
  for (let parent = task.suite; parent; parent = parent.suite) if (parent.name) names.unshift(parent.name)
  return names
}
export function beginCase(task: any): void {
  const path = taskPath(task)
  active = { file: task.file.filepath, name: path.join(' > '), path, inputs: [], checks: [], missing: new Set() }
  if (referenceMode) {
    referenceConfig.reset()
    const context = contexts.get(active.file)
    if (context) referenceConfig.setSiteConfig(context.config)
  }
}
export function finishCase(_task: any): void {
  if (!active) return
  const record = { file: active.file, name: active.name, path: active.path, inputs: active.inputs, checks: active.checks, unavailable: [...active.missing] }
  if (!record.inputs.length && !record.checks.length && !record.unavailable.length) record.unavailable.push('No native parse or production domain check executed: direct database/helper or renderer-only API case')
  const audit = process.env.AM_ASSERT_AUDIT
  if (audit) appendFileSync(audit, JSON.stringify(record) + '\n')
  active = undefined
  if (record.unavailable.length) throw new AdapterBoundary(`UPSTREAM_ADAPTER_UNAVAILABLE: ${record.unavailable.join('; ')}`)
}

export function recordInput(family: string, source: string): ParsedInput | undefined {
  const record = { family, source }
  active?.inputs.push(record)
  return active ? record : undefined
}

function recordEventSourceCheck(frame: any): void {
  active?.checks.push({ family: 'eventmodeling', operation: 'eventmodeling.source-types', targetType: frame.modelEntityType, sourceTypes: frame.sourceFrames.map((source: any) => source.ref?.modelEntityType ?? null) })
}

class NativeDatabase {
  model: any
  events: ParserObservation[] = []
  source = ''
  constructor(readonly context: AdapterContext) {}
  clear(): void { this.model = undefined; this.events = []; this.source = '' }
  parse(source: string): void {
    const input = recordInput(this.context.family, source)
    this.source = source
    this.events = []
    if (this.context.family === 'eventmodeling') this.model = undefined
    const configured = this.context.configured(source)
    try {
      this.model = withParserObservation(this.context.family, event => this.events.push(event), () => parseNativeModel(this.context.family, configured))
      if (input) input.accepted = true
    } catch (error) {
      if (input) { input.accepted = false; input.error = String(error) }
      throw error
    }
  }
  proxy(): any {
    return new Proxy(this, { get: (target, key) => {
      if (typeof key !== 'string' || key in target) {
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      }
      if (['then', 'toJSON', 'asymmetricMatch'].includes(key)) return undefined
      if (/^get[A-Z]|^showSequenceNumbers$/.test(key)) return (...args: any[]) => {
        const current = nativeGetters(target, key)
        if (typeof current !== 'function') return unavailable(`${this.context.family}.db.${key}`)
        return current(...args)
      }
      const value = nativeGetters(target, key)
      if (value !== undefined) return value
      noteUnavailable(`${this.context.family}.db.${key}`)
      return deferred(`${this.context.family}.db.${key}`)
    } })
  }
}
export type NativeDb = NativeDatabase

class AdapterContext {
  config: Record<string, any> = { securityLevel: 'strict' }
  singleton: any
  parser: any
  constructor(readonly family: string) {
    this.singleton = family === 'parser-helper' ? {} : this.database()
    const context = this
    this.parser = { yy: this.singleton, parse(source: string) {
      if (referenceMode) {
        recordInput(family, source)
        const definition = context.referenceDefinition()
        const parser = definition.getParser()
        parser.yy = context.parser.yy
        if (parser.parser) parser.parser.yy = context.parser.yy
        return parser.parse(source)
      }
      // This pinned family exposes an asynchronous parser. Adapt completion,
      // never acceptance or error wording, around the actual synchronous native parse.
      if (family === 'eventmodeling') return Promise.resolve().then(() => context.parser.yy.parse(source))
      return context.parser.yy.parse(source)
    } }
    this.parser.parser = this.parser
  }
  referenceDefinition(): any {
    const definition = referenceDefinitions.get(this.family)
    if (!definition || definition instanceof Error) return unavailable(`${this.family}: pinned diagram bootstrap: ${definition?.message ?? 'unavailable'}`)
    return definition
  }
  database(...args: any[]): any {
    if (!referenceMode) return new NativeDatabase(this).proxy()
    const db = this.referenceDefinition().db
    return typeof db.constructor !== 'function' || db.constructor.name === 'Object' ? db : new db.constructor(...args)
  }
  configured(source: string): string {
    const directive = `%%{init: ${JSON.stringify(this.config)}}%%\n`
    const frontmatter = source.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0]
    return frontmatter ? frontmatter + directive + source.slice(frontmatter.length) : directive + source
  }
  module(specifier: string): any {
    const context = this
    const api = {
      initialize(value: any) { context.config = structuredClone(value); if (referenceMode) reference.initialize(value) },
      setConfig(value: any) { context.config = { ...context.config, ...value }; if (referenceMode) referenceConfig.setConfig(value) },
      setSiteConfig(value: any) { context.config = structuredClone(value); if (referenceMode) referenceConfig.setSiteConfig(value) },
      getConfig: () => referenceMode ? referenceConfig.getConfig() : context.config,
      reset() { if (referenceMode) referenceConfig.reset() },
      getSiteConfig: () => context.config,
      setLogLevel() {},
      async parse(source: string) {
        if (referenceMode) {
          recordInput(context.family, source)
          return reference.parse(source)
        }
        const db = new NativeDatabase(context)
        db.parse(source)
        return { diagramType: context.family }
      },
    }
    const Diagram = { async fromText(source: string) {
      if (referenceMode) {
        recordInput(context.family, source)
        return context.referenceDefinition().constructor.fromText(source)
      }
      const db = new NativeDatabase(context)
      db.parse(source)
      const renderer = { draw() {
        return unavailable('Mermaid renderer.draw: pixel geometry and renderer bookkeeping are outside the native model adapter')
      }, bounds: deferred('Mermaid renderer.bounds pixel bookkeeping') }
      return { db: db.proxy(), renderer, type: context.family }
    } }
    if (/mermaidAPI/.test(specifier)) {
      const publicApi = referenceMode ? { ...reference.mermaidAPI, async parse(...args: any[]) {
        const input = recordInput(context.family, args[0])
        try {
          const result = await reference.mermaidAPI.parse(...args)
          if (input) input.accepted = result !== false
          return result
        } catch (error) {
          if (input) { input.accepted = false; input.error = String(error) }
          throw error
        }
      } } : api
      return { default: publicApi, mermaidAPI: publicApi, ...publicApi }
    }
    if (/config\.js$|diagramAPI\.js$/.test(specifier)) return { ...api, default: api }
    if (/Diagram\.js$/.test(specifier)) return { Diagram }
    if (/diagram-orchestration/.test(specifier)) return { addDiagrams() {} }
    if (/logger/.test(specifier)) return { log: Object.fromEntries(['info', 'warn', 'error', 'debug', 'trace', 'fatal'].map(name => [name, () => {}])), setLogLevel() {} }
    if (context.family === 'eventmodeling' && /event-modeling-validator\.js$/.test(specifier)) {
      if (referenceMode) {
        const ActualValidator = referenceEventValidation.EventModelingValidator
        return {
          EventModelingValidator: class extends ActualValidator {
            checkSourceFrameTypes(frame: any, accept: any) { recordEventSourceCheck(frame); return super.checkSourceFrameTypes(frame, accept) }
          },
          registerValidationChecks(services: any) {
            active?.checks.push({ family: 'eventmodeling', operation: 'eventmodeling.register-validation-checks' })
            return referenceEventValidation.registerValidationChecks(services)
          },
        }
      }
      return {
        EventModelingValidator: class {
          checkSourceFrameTypes(frame: any, accept: any) {
            if (typeof candidateEventParser.eventSourceTypeProblems !== 'function') return unavailable('EventModelingValidator.checkSourceFrameTypes: candidate revision has no production source-type rule authority')
            recordEventSourceCheck(frame)
            // Project only the actual rule inputs supplied by the unchanged
            // assertion. This is the same production authority native verify
            // calls; no synthetic frame IDs, parser result or expected state.
            const problems = candidateEventParser.eventSourceTypeProblems(candidateEventParser.eventType(frame.modelEntityType), frame.sourceFrames.map((source: any) => source.ref === undefined ? undefined : candidateEventParser.eventType(source.ref.modelEntityType)))
            for (const problem of problems) accept('warning', problem.message, { node: frame, property: 'sourceFrames' })
          }
        },
        registerValidationChecks() { return unavailable('EventModelingValidator.registerValidationChecks: private Langium service registry has no native equivalent') },
      }
    }
    if (/language\/index|language\/generated|language\/\w+\/module\.js$/.test(specifier)) {
      if (referenceMode) return new Proxy(language, { get(target, key) {
        const value = target[key]
        const service = typeof key === 'string' && /^create(\w+)Services$/.exec(key)
        if (!service || typeof value !== 'function') return value
        return (...args: any[]) => {
          const services = value(...args)
          const selected = services[service[1] === 'EventModeling' ? 'EventModel' : service[1]!]
          const parser = selected.parser.LangiumParser
          return { ...services, [service[1] === 'EventModeling' ? 'EventModel' : service[1]!]: {
            ...selected, parser: { ...selected.parser, LangiumParser: new Proxy(parser, { get(inner, property) {
              if (property !== 'parse') return Reflect.get(inner, property)
              return (source: string, ...rest: any[]) => {
                const input = recordInput(service[1]!.toLowerCase(), source)
                const result = inner.parse(source, ...rest)
                if (input) input.accepted = !result.lexerErrors.length && !result.parserErrors.length
                return result
              }
            } }) },
          } }
        }
      } })
      return new Proxy({}, { get(_target, key) {
        if (typeof key !== 'string') return undefined
        const service = /^create(\w+)Services$/.exec(key)
        if (service) return () => ({ [service[1] === 'EventModeling' ? 'EventModel' : service[1]!]: { parser: { LangiumParser: { parse: (source: string) => nativeAst(service[1]!, source) } } } })
        if (key === 'parse') return async (family: string, source: string) => nativeAst(family, source).value
        return { $type: key }
      } })
    }
    if (/\.jison$|[Pp]arser\.[jt]s$|\/parser\.[jt]s$/.test(specifier)) {
      // The modern parser modules return promises; Jison's parse is synchronous.
      const parser = !referenceMode && !specifier.endsWith('.jison') && ['architecture', 'packet', 'pie', 'radar', 'gitgraph', 'treemap'].includes(this.family)
        ? new Proxy(this.parser, { get(target, key) { return key === 'parse' ? async (source: string) => target.parse(source) : target[key] } })
        : this.parser
      return { default: parser, parser }
    }
    if (/(?:[dD][bB]|[aA]st)\.js$/.test(specifier) || /\/db\.js$/.test(specifier)) {
      return new Proxy({}, { ownKeys: () => Reflect.ownKeys(context.singleton),
        getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }),
        get(_target, key) {
        if (key === 'default' || key === 'db') return context.singleton
        if (typeof key === 'string' && /(?:DB|Db)$/.test(key)) return class { constructor(...args: any[]) { return context.database(...args) } }
        const value = context.singleton[key]
        return value === undefined ? deferred(`${specifier}.${String(key)}`) : value
      } })
    }
    return new Proxy({}, { get: (_target, key) => deferred(`${specifier}.${String(key)}`) })
  }
}

export function moduleFor(family: string, specifier: string, file: string): any {
  let context = contexts.get(file)
  if (!context) { context = new AdapterContext(family); contexts.set(file, context) }
  return context.module(specifier)
}

export function parseForAst(family: string, source: string): any {
  const input = recordInput(family, source)
  try {
    const model = parseNativeModel(family, source)
    if (input) input.accepted = true
    return model
  } catch (error) {
    if (input) { input.accepted = false; input.error = String(error) }
    throw error
  }
}

export { normalizeMermaidSource }
