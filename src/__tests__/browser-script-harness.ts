/**
 * In-process harness for the shipped classic browser scripts (editor/js/*.js,
 * shared/browser/*.js, website assets). The scripts are evaluated with
 * `new Function`, exactly as editor-popup.test.ts and the sharing.js harness
 * do, against a deliberately small DOM double. Tests drive the scripts through
 * their real entry points (functions, listeners) and assert observable effects
 * — attributes, text, listener outcomes — never the scripts' source text.
 *
 * The double models only what those scripts touch. Selector support is the
 * compound subset `tag#id.class[attr][attr="v"]:last-child` plus comma lists;
 * anything else deliberately matches nothing.
 */
import { createContext, runInContext } from 'node:vm'

export type FakeListener = (event: FakeEvent) => void

export interface FakeEvent {
  type: string
  target: FakeNode
  key?: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  relatedTarget?: unknown
  defaultPrevented: boolean
  preventDefault(): void
  stopPropagation(): void
}

export interface FakeNode {
  parentNode: FakeElement | null
  readonly textContent: string
}

export interface FakeRect {
  width: number
  height: number
  left: number
  top: number
  right: number
  bottom: number
}

type StyleRecord = Record<string, string> & {
  setProperty(name: string, value: string): void
  getPropertyValue(name: string): string
  removeProperty(name: string): void
}

function fakeStyle(): StyleRecord {
  const custom = new Map<string, string>()
  const style = {
    setProperty(name: string, value: string) { custom.set(name, String(value)) },
    getPropertyValue(name: string) { return custom.get(name) ?? '' },
    removeProperty(name: string) { custom.delete(name) },
  }
  return style as StyleRecord
}

interface SimpleSelector {
  tag?: string
  id?: string
  classes: string[]
  attributes: Array<{ name: string; value?: string }>
  lastChild: boolean
}

function parseSelector(selector: string): SimpleSelector[] | null {
  const parsed: SimpleSelector[] = []
  for (const part of selector.split(',').map(entry => entry.trim())) {
    const match = part.match(/^([a-zA-Z][\w-]*)?((?:[#.][\w-]+|\[[\w-]+(?:="[^"]*")?\])*)(:last-child)?$/)
    if (!match || /\s/.test(part)) return null
    const simple: SimpleSelector = { tag: match[1]?.toLowerCase(), classes: [], attributes: [], lastChild: Boolean(match[3]) }
    for (const token of match[2]!.matchAll(/#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      if (token[1]) simple.id = token[1]
      else if (token[2]) simple.classes.push(token[2])
      else simple.attributes.push({ name: token[3]!, value: token[4] })
    }
    parsed.push(simple)
  }
  return parsed
}

export class FakeText implements FakeNode {
  parentNode: FakeElement | null = null
  constructor(public data: string) {}
  get textContent() { return this.data }
}

export class FakeElement implements FakeNode {
  readonly tagName: string
  readonly localName: string
  id = ''
  dataset: Record<string, string> = {}
  style = fakeStyle()
  childNodes: FakeNode[] = []
  parentNode: FakeElement | null = null
  value = ''
  disabled = false
  hidden = false
  inert = false
  tabIndex = 0
  title = ''
  /** Layout double: tests replace this to model width/height. */
  layout: () => Partial<FakeRect> = () => ({})
  readonly listeners = new Map<string, FakeListener[]>()
  private readonly classes = new Set<string>()
  private readonly attributes = new Map<string, string>()

  constructor(readonly ownerDocument: FakeDocument, tagName: string) {
    this.tagName = tagName.toUpperCase()
    this.localName = tagName.toLowerCase()
  }

  readonly classList = {
    add: (...names: string[]) => { for (const name of names) this.classes.add(name) },
    remove: (...names: string[]) => { for (const name of names) this.classes.delete(name) },
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, force?: boolean) => {
      const on = force ?? !this.classes.has(name)
      if (on) this.classes.add(name)
      else this.classes.delete(name)
      return on
    },
  }

  get className() { return Array.from(this.classes).join(' ') }
  set className(value: string) {
    this.classes.clear()
    for (const name of String(value).split(/\s+/).filter(Boolean)) this.classes.add(name)
  }

  get children(): FakeElement[] { return this.childNodes.filter((node): node is FakeElement => node instanceof FakeElement) }
  get parentElement() { return this.parentNode }
  get firstChild() { return this.childNodes[0] ?? null }

  get textContent(): string { return this.childNodes.map(node => node.textContent).join('') }
  set textContent(value: string) {
    this.replaceChildren(...(String(value ?? '') ? [new FakeText(String(value))] : []))
  }

  setAttribute(name: string, value: string) {
    const text = String(value)
    if (name === 'id') this.id = text
    else if (name === 'class') this.className = text
    else if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = text
    this.attributes.set(name, text)
  }

  getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null
    if (name === 'class') return this.className || null
    return this.attributes.get(name) ?? null
  }

  hasAttribute(name: string) { return this.getAttribute(name) !== null }
  removeAttribute(name: string) {
    if (name === 'id') this.id = ''
    this.attributes.delete(name)
  }

  appendChild<T extends FakeNode>(node: T): T {
    return this.insertBefore(node, null)
  }

  insertBefore<T extends FakeNode>(node: T, reference: FakeNode | null): T {
    if (node.parentNode) node.parentNode.removeChild(node)
    const index = reference ? this.childNodes.indexOf(reference) : -1
    if (index < 0) this.childNodes.push(node)
    else this.childNodes.splice(index, 0, node)
    node.parentNode = this
    return node
  }

  removeChild<T extends FakeNode>(node: T): T {
    this.childNodes = this.childNodes.filter(child => child !== node)
    node.parentNode = null
    return node
  }

  remove() { this.parentNode?.removeChild(this) }

  replaceChildren(...nodes: FakeNode[]) {
    for (const child of this.childNodes) child.parentNode = null
    this.childNodes = []
    for (const node of nodes) this.appendChild(node)
  }

  cloneNode(deep = false): FakeElement {
    const clone = new FakeElement(this.ownerDocument, this.localName)
    clone.id = this.id
    clone.className = this.className
    Object.assign(clone.dataset, this.dataset)
    for (const [name, value] of this.attributes) clone.attributes.set(name, value)
    if (deep) for (const child of this.childNodes) clone.appendChild(child instanceof FakeElement ? child.cloneNode(true) : new FakeText(child.textContent))
    return clone
  }

  contains(node: unknown): boolean {
    for (let current = node as FakeNode | null; current; current = current.parentNode) if (current === this) return true
    return false
  }

  matches(selector: string): boolean {
    const parsed = parseSelector(selector)
    return !!parsed && parsed.some(simple => this.matchesSimple(simple))
  }

  private matchesSimple(simple: SimpleSelector): boolean {
    if (simple.tag && simple.tag !== this.localName) return false
    if (simple.id && simple.id !== this.id) return false
    if (simple.classes.some(name => !this.classes.has(name))) return false
    for (const attribute of simple.attributes) {
      const actual = this.getAttribute(attribute.name)
      if (actual === null || (attribute.value !== undefined && actual !== attribute.value)) return false
    }
    if (simple.lastChild && this.parentNode?.children.at(-1) !== this) return false
    return true
  }

  closest(selector: string): FakeElement | null {
    for (let current: FakeElement | null = this; current; current = current.parentNode) if (current.matches(selector)) return current
    return null
  }

  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = []
    const visit = (element: FakeElement) => {
      for (const child of element.children) {
        if (child.matches(selector)) found.push(child)
        visit(child)
      }
    }
    visit(this)
    return found
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  getBoundingClientRect(): FakeRect {
    const rect = { width: 0, height: 0, left: 0, top: 0, ...this.layout() }
    return { right: rect.left + rect.width, bottom: rect.top + rect.height, ...rect }
  }

  get clientWidth() { return this.getBoundingClientRect().width }
  get clientHeight() { return this.getBoundingClientRect().height }

  addEventListener(type: string, listener: FakeListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  removeEventListener(type: string, listener: FakeListener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(entry => entry !== listener))
  }

  /** Dispatch to this element, its ancestors, then the document (bubbling). */
  dispatch(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    return this.ownerDocument.dispatchFrom(this, type, init)
  }

  click() { this.dispatch('click') }
  focus() { this.ownerDocument.activeElement = this }
}

export class FakeDocument {
  readonly documentElement: FakeElement
  readonly body: FakeElement
  readonly listeners = new Map<string, FakeListener[]>()
  activeElement: FakeElement | null = null
  styleSheets: unknown[] = []
  baseURI = 'https://agentic-mermaid.test/editor/'
  readyState = 'complete'

  constructor() {
    this.documentElement = new FakeElement(this, 'html')
    this.body = this.documentElement.appendChild(new FakeElement(this, 'body'))
  }

  createElement(tag: string) { return new FakeElement(this, tag) }
  createElementNS(_namespace: string, tag: string) { return new FakeElement(this, tag) }
  createTextNode(text: string) { return new FakeText(text) }

  /** Build `<tag id=…>` (plus optional attributes/children) under a parent. */
  element(tag: string, attributes: Record<string, string> = {}, parent: FakeElement = this.body, children: FakeNode[] = []): FakeElement {
    const element = this.createElement(tag)
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
    for (const child of children) element.appendChild(child)
    return parent.appendChild(element)
  }

  getElementById(id: string): FakeElement | null {
    return this.documentElement.querySelectorAll(`#${id}`)[0] ?? null
  }

  querySelectorAll(selector: string) { return this.documentElement.querySelectorAll(selector) }
  querySelector(selector: string) { return this.documentElement.querySelector(selector) }
  importNode<T>(node: T): T { return node }

  addEventListener(type: string, listener: FakeListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  removeEventListener(type: string, listener: FakeListener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(entry => entry !== listener))
  }

  dispatchFrom(target: FakeNode | FakeDocument, type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    let propagate = true
    const event: FakeEvent = {
      type,
      target: (target instanceof FakeDocument ? this.documentElement : target) as FakeNode,
      defaultPrevented: false,
      preventDefault() { event.defaultPrevented = true },
      stopPropagation() { propagate = false },
      ...init,
    }
    const path: Array<{ listeners: Map<string, FakeListener[]> }> = []
    if (target instanceof FakeElement) for (let current: FakeElement | null = target; current; current = current.parentNode) path.push(current)
    path.push(this)
    for (const node of path) {
      for (const listener of [...(node.listeners.get(type) ?? [])]) listener(event)
      if (!propagate) break
    }
    return event
  }

  /** Keyboard events target the focused element, as in a browser. */
  keydown(init: Partial<FakeEvent>): FakeEvent {
    return this.dispatchFrom(this.activeElement ?? this.body, 'keydown', init)
  }
}

/** Deterministic manual timer queue for scripts that call setTimeout. */
export function manualTimers() {
  let nextId = 1
  const pending = new Map<number, () => void>()
  return {
    setTimeout: (callback: () => void) => { const id = nextId++; pending.set(id, callback); return id },
    clearTimeout: (id: number) => { pending.delete(id) },
    pending: () => pending.size,
    flush() {
      const queued = [...pending.values()]
      pending.clear()
      for (const callback of queued) callback()
    },
  }
}

/**
 * Evaluate a classic script with explicit globals and return whatever the
 * `exports` expression (evaluated in the script's scope) produces. Top-level
 * `var`/function declarations are visible to that expression, so getters can
 * observe later reassignments.
 */
export function evaluateBrowserScript<T>(source: string, globals: Record<string, unknown>, exports: string): T {
  const names = Object.keys(globals)
  return new Function(...names, `${source}\nreturn (${exports});`)(...names.map(name => globals[name])) as T
}

/**
 * Run a script whose modules communicate through real globals (`globalThis.x =
 * …` then a bare `x(…)` elsewhere) in a fresh VM context whose global object
 * carries `globals`. Returns that global object.
 */
export function runBrowserScriptInContext(source: string, globals: Record<string, unknown>, filename: string): Record<string, unknown> {
  const context = createContext({ ...globals })
  runInContext(source, context, { filename })
  return context as Record<string, unknown>
}
