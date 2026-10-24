# FIELD Plugin Capability Map

Baseline: `043cdf19b1c58df0540670a25e12362ac2e4e5da`  
Date: 2026-10-19

## Purpose

This document defines how ChatGPT plugins and skills contribute to FIELD POS without creating duplicate sources of truth, unsafe production changes, or tool-driven complexity.

## Operating principles

1. **GitHub is the source of truth for production code.**
2. **Vercel is the source of truth for deployed runtime evidence and Web Vitals.**
3. **Turso remains the authoritative operational database unless a measured bottleneck justifies change.**
4. **No plugin may rewrite payment, stock, cash, refund, expense, queue, or close-day logic without tests and independent verification.**
5. **Advisory plugins produce evidence, designs, research, models, or QA criteria; they do not bypass the GitHub review path.**
6. **New infrastructure is evidence-gated.** Replit, Base44, Redis, Supabase, or other platforms are not production replacements unless a specific experiment proves a benefit.
7. **Every change must preserve server-authoritative price/stock, idempotency, durable audit history, safe reversal, and offline recovery.**
8. **Performance work is measured using Web Vitals and exact-SHA verification, not perceived speed alone.**

## Capability ownership

| Plugin / skill | FIELD ownership | Deliverables | Production write authority |
|---|---|---|---|
| Figma | Design system, POS interaction states, touch hierarchy, contrast, layout | Components, tokens, screen specs, design QA | No direct production write |
| Template Creator | Reusable FIELD reports, SOPs, audit templates, launch checklists | Installable templates | No |
| tldraw | System maps, transaction flows, queue/payment/stock state diagrams | Architecture and process diagrams | No |
| Base44 | Rapid isolated prototypes only | Disposable proof-of-concept apps | No |
| Supermetrics Marketing Agent | Marketing-channel measurement and campaign reporting | Marketing dashboards, source reconciliation | No |
| Consensus | Peer-reviewed evidence for HCI, queueing, retail/POS, behavior research | Research notes with citations | No |
| Replit | Sandboxed prototypes and alternate UX experiments | Prototype apps only | No |
| SciSpace | Literature triage and technical research | Research tables / summaries | No |
| Public Equity Investing | Modeling discipline only: scenario analysis, sensitivity, model QC | Café unit-economics scenario framework | No |
| Sales | Customer-value framing, offer structure, objection handling, B2B/event sales motions | Sales scripts, offer logic, value cases | No |
| Brand & Market Social Research | Local demand signals, customer language, competitor themes | Market signal briefs | No |
| Amplitude | Product analytics, funnel, event taxonomy, usability friction | POS event schema, funnel diagnostics | No |
| Build Web Data Visualization | Operational dashboards and accessible charts | Dashboard/chart specifications | UI only through reviewed code |
| Code | Implementation, review, refactor, tests | Production code changes through GitHub | Yes, via PR only |
| Data Analytics | KPI definitions, data quality, reports, diagnostic analysis | KPI model, dashboards, validated metrics | No direct financial write |
| Prompt Engineer | Reliable prompts for internal AI-assist features and R&D workflows | Versioned prompts + evaluation rubrics | No direct transaction write |
| GSC Wizard | Public website/search performance after website is indexed | SEO diagnostics, search queries, technical findings | No POS write |
| Financial Datasets | External public-market/economic context only when relevant | Reference benchmarks | No |
| Code Tytor: Python | Reproducible scripts, calculations, test utilities | Python QA/analysis helpers | No production write by default |

## FIELD workstreams

### 1. POS Core Reliability
Owner: Code + GitHub + Superpowers  
Advisors: Data Analytics, Amplitude, Build Web Data Visualization

Required controls:
- idempotent checkout
- integer-satang / decimal-safe money
- server-authoritative price and stock
- offline outbox replay safety
- immutable audit history
- reversal instead of destructive edit
- exact-SHA tests before release

### 2. POS UX / Zero-Learning Operation
Owner: Figma + Code  
Advisors: Amplitude, tldraw, Data Analytics

Targets:
- common sale in 3–4 taps
- critical touch targets >= 44 px
- unambiguous Thai labels
- no hidden payment or stock state
- mobile layouts must not overlap at 320/360/390/412 px
- semantic color use; FIELD Gold reserved for primary action, not all actions

### 3. Performance
Owner: Code + Vercel  
Advisors: Data Analytics, Amplitude

Current evidence baseline:
- LCP around 4.0 s: poor
- TTFB around 1.5 s: needs improvement
- INP around 104 ms: good
- CLS 0: good

Priority:
1. reduce POS bootstrap work
2. isolate back-office bundles/data from sales path
3. defer noncritical analytics/admin modules
4. profile auth/database startup path
5. create performance regression budget

### 4. Analytics and Operations
Owner: Data Analytics + Amplitude + Build Web Data Visualization

Core metrics:
- sales/day
- orders/hour
- average ticket
- payment method mix
- gross profit by item
- waste rate
- stock variance
- refund/void rate
- order-to-handoff time
- checkout failure/retry rate
- close-day reconciliation variance
- LCP/TTFB/INP/CLS

### 5. Marketing / Demand
Owner: Brand & Market Social Research + Supermetrics  
Advisors: Sales, GSC Wizard, Data Analytics

Focus:
- local customer language
- launch offers
- repeat-purchase drivers
- menu interest
- channel attribution
- Google discovery after public site launch

### 6. Research
Owner: Consensus + SciSpace

Use only when evidence would change a product or operating decision, such as:
- retail queue design
- human-error prevention
- touchscreen target sizing
- menu choice overload
- loyalty behavior
- pricing presentation

### 7. Business / Financial Discipline
Owner: Data Analytics  
Advisors: Public Equity Investing, Financial Datasets

Adapt useful finance discipline without pretending FIELD is a public company:
- base / upside / downside scenarios
- contribution margin
- break-even volume
- sensitivity to ingredient price and demand
- cash runway / capex payback
- model audit and assumption traceability

## Explicit non-goals

- Do not migrate production to Base44 or Replit merely because those tools are available.
- Do not add third-party analytics scripts to the sales critical path without performance and privacy review.
- Do not use SEO tools to change POS behavior.
- Do not let marketing or research tools mutate financial records.
- Do not let prototypes become production sources of truth.
- Do not use public-equity market data as a substitute for FIELD's own operating data.

## Definition of evidence-ready work

A plugin contribution becomes implementation input only when it includes:
1. the problem being solved,
2. the evidence or source,
3. expected measurable effect,
4. owner and affected subsystem,
5. regression risk,
6. acceptance criteria.

A code change becomes release-ready only after fresh tests, build, browser QA, and exact-SHA deployment verification.
