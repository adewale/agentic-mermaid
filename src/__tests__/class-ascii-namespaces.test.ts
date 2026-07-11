import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'

describe('Class terminal namespace frames (B05/CL4)', () => {
  test('draws a namespace frame containing its member classes', () => {
    const output = renderMermaidASCII(`classDiagram
      namespace Domain {
        class Account
        class Ledger
      }
      Account --> Ledger`, { useAscii: true, colorMode: 'none' })
    const rows = output.split('\n')
    const namespaceRow = rows.findIndex(row => row.includes('Domain'))
    const accountRow = rows.findIndex(row => row.includes('Account'))
    const ledgerRow = rows.findIndex(row => row.includes('Ledger'))
    expect(namespaceRow).toBeGreaterThanOrEqual(0)
    expect(accountRow).toBeGreaterThan(namespaceRow)
    expect(ledgerRow).toBeGreaterThan(namespaceRow)
    expect(output).toMatch(/\+[-]+ Domain [-]+\+/)
  })

  test('keeps nested namespace and class labels spatially contained', () => {
    const output = renderMermaidASCII(`classDiagram
      namespace Company {
        namespace Platform {
          class API
        }
      }`, { colorMode: 'none' })
    const rows = output.split('\n')
    const company = rows.findIndex(row => row.includes('Company'))
    const platform = rows.findIndex(row => row.includes('Platform'))
    const api = rows.findIndex(row => row.includes('API'))
    expect(company).toBeLessThan(platform)
    expect(platform).toBeLessThan(api)
    expect(rows[platform]!.indexOf('┌')).toBeGreaterThan(rows[company]!.indexOf('┌'))
    expect(rows[api]!.indexOf('API')).toBeGreaterThan(rows[platform]!.indexOf('┌'))
  })
})
