import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '..', '..', 'editor', 'js', 'helpers.js'), 'utf8')

type Popup = {
  _closingTimer?: ReturnType<typeof setTimeout> | null
  classList: {
    add(name: string): void
    contains(name: string): boolean
    remove(name: string): void
    toggle(name: string, force: boolean): boolean
  }
  getAttribute(name: string): string | null
  inert: boolean
  querySelector(): null
  querySelectorAll(): never[]
  setAttribute(name: string, value: string): void
}

type PopupHelpers = {
  clearPopupClosing(popup: Popup): void
  setPopupVisibility(popup: Popup, trigger: null, open: boolean, opts: { visualClose: boolean }): void
}

function loadPopupHelpers(): PopupHelpers {
  return new Function(`${source}; return { clearPopupClosing, setPopupVisibility };`)() as PopupHelpers
}

function popup(initialClasses: string[] = []): Popup {
  const classes = new Set(initialClasses)
  const attributes = new Map<string, string>()
  return {
    classList: {
      add(name) { classes.add(name) },
      contains(name) { return classes.has(name) },
      remove(name) { classes.delete(name) },
      toggle(name, force) {
        if (force) classes.add(name)
        else classes.delete(name)
        return force
      },
    },
    getAttribute(name) { return attributes.get(name) ?? null },
    inert: false,
    querySelector() { return null },
    querySelectorAll() { return [] },
    setAttribute(name, value) { attributes.set(name, value) },
  }
}

describe('editor popup visibility', () => {
  test('does not animate an idempotent close', () => {
    const { setPopupVisibility } = loadPopupHelpers()
    const menu = popup()

    setPopupVisibility(menu, null, false, { visualClose: true })

    expect(menu.classList.contains('open')).toBe(false)
    expect(menu.classList.contains('closing')).toBe(false)
    expect(menu.getAttribute('aria-hidden')).toBe('true')
    expect(menu.inert).toBe(true)
  })

  test('keeps the visual tail for a real open to closed transition', () => {
    const { clearPopupClosing, setPopupVisibility } = loadPopupHelpers()
    const menu = popup(['open'])

    setPopupVisibility(menu, null, false, { visualClose: true })

    expect(menu.classList.contains('open')).toBe(false)
    expect(menu.classList.contains('closing')).toBe(true)
    expect(menu.getAttribute('aria-hidden')).toBe('true')
    expect(menu.inert).toBe(true)
    clearPopupClosing(menu)
  })
})
