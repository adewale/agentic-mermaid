/**
 * Generates examples/showcases/new-diagrams.html — a focused showcase for the recently added
 * diagram types: Architecture, Timeline, and Journey.
 *
 * Usage: bun run scripts/site/new-diagrams.ts
 *
 * Reuses the exact same generator as the main gallery (scripts/site/generate.ts), just
 * filtered to the three new diagram families with additional samples.
 */

import { generateHtml } from './generate.ts'
import type { Sample } from './samples-data.ts'

const extraSamples: Sample[] = [
  {
    title: 'Architecture: Microservices',
    category: 'Architecture',
    description: 'A typical microservices topology with API gateway, service mesh, and backing stores.',
    source: `architecture-beta
  group mesh(cloud)[Service Mesh]
  service gateway(server)[API Gateway]
  service users(server)[User Service] in mesh
  service orders(server)[Order Service] in mesh
  service payments(server)[Payment Service] in mesh
  service db(database)[PostgreSQL]
  service cache(disk)[Redis Cache]
  gateway:B --> T:users
  gateway:B --> T:orders
  orders:R --> L:payments
  users:B --> T:cache
  orders:B --> T:db
  payments:B --> T:db`,
  },
  {
    title: 'Architecture: CI/CD Pipeline',
    category: 'Architecture',
    description: 'Build and deploy pipeline with artifact storage and staged environments.',
    source: `architecture-beta
  group build(server)[Build]
  group deploy(cloud)[Deploy]
  service repo(disk)[Git Repo]
  service ci(server)[CI Runner] in build
  service registry(database)[Container Registry] in build
  service staging(server)[Staging] in deploy
  service prod(server)[Production] in deploy
  junction gate in deploy
  repo:R --> L:ci
  ci:R --> L:registry
  registry:R --> L:gate
  gate:R -[promote]-> L:staging
  gate:B -[release]-> T:prod`,
    options: {
      bg: '#1e1b2e',
      fg: '#e0def4',
      line: '#6e6a86',
      accent: '#c4a7e7',
      muted: '#908caa',
      surface: '#26233a',
      border: '#524f67',
    },
  },
  {
    title: 'Timeline: Framework Evolution',
    category: 'Timeline',
    description: 'Evolution of a framework across major releases with grouped eras.',
    source: `timeline
  title Framework Evolution
  section Early Days
    2018 : Initial prototype
         : Core parser written
    2019 : First public release
         : 12 early adopters
  section Growth
    2020 : Plugin system
         : 200 GitHub stars
    2021 : Theme engine
         : Enterprise pilot
  section Maturity
    2023 : v2.0 rewrite
         : ASCII renderer
    2024 : Architecture diagrams
         : 10K weekly downloads`,
  },
  {
    title: 'Timeline: Sprint Roadmap',
    category: 'Timeline',
    description: 'A product sprint roadmap tracking feature delivery across quarters.',
    source: `timeline
  title 2024 Product Roadmap
  section Q1
    Jan : User research
    Feb : Design system v2
    Mar : Beta launch
  section Q2
    Apr : Public launch
        : Marketing campaign
    May : Mobile app
    Jun : Analytics dashboard
  section Q3
    Jul : API v2
    Aug : Enterprise features
    Sep : SOC 2 compliance`,
    options: {
      bg: '#fafaf9',
      fg: '#1c1917',
      line: '#a8a29e',
      accent: '#ea580c',
      muted: '#78716c',
      surface: '#f5f5f4',
      border: '#d6d3d1',
    },
  },
  {
    title: 'Journey: Onboarding Flow',
    category: 'Journey',
    description: 'New user onboarding experience scored by satisfaction.',
    source: `journey
  title New User Onboarding
  section Sign Up
    Visit landing page: 5: User
    Click "Get Started": 4: User
    Fill registration form: 2: User
    Verify email: 3: User
  section First Use
    Complete tutorial: 4: User, System
    Create first project: 5: User
    Invite teammate: 3: User
  section Retention
    Return next day: 4: User
    Upgrade to paid: 2: User, Sales`,
  },
  {
    title: 'Journey: Support Ticket',
    category: 'Journey',
    description: 'Customer support journey from issue to resolution.',
    source: `journey
  title Support Ticket Lifecycle
  section Report
    Encounter bug: 1: Customer
    Search knowledge base: 3: Customer
    Submit ticket: 4: Customer
  section Triage
    Auto-categorize: 5: System
    Assign to agent: 4: System, Agent
  section Resolve
    Reproduce issue: 3: Agent
    Deploy fix: 5: Agent, Engineer
    Confirm resolution: 5: Customer`,
    options: {
      bg: '#0c1222',
      fg: '#c9d1d9',
      accent: '#58a6ff',
      line: '#30363d',
      muted: '#8b949e',
      surface: '#161b22',
      border: '#30363d',
    },
  },
]

const html = await generateHtml({
  categories: new Set(['Architecture', 'Timeline', 'Journey']),
  title: 'Agentic Mermaid — New Diagram Types',
  description: 'Architecture, Timeline, and Journey diagram showcase for Agentic Mermaid.',
  extraSamples,
  visibleThemes: new Set(['tufte', 'tufte-dark', 'salmon', 'salmon-dark']),
})

const outPath = new URL('../../examples/showcases/new-diagrams.html', import.meta.url).pathname
await Bun.write(outPath, html)
console.log(`Written to ${outPath} (${(html.length / 1024).toFixed(1)} KB)`)
