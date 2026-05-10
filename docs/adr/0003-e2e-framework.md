# ADR-0003: E2E Test Framework — Playwright

**Date:** 2026-05-10  
**Status:** Accepted

## Context

Issue #153 identified that the paid-course paywall (access control) flow spans four subsystems — Supabase RLS, the `confirm_order` RPC, client-side routing, and the paywall UI — and cannot be adequately verified by unit tests alone. An E2E framework is needed.

Two candidates were evaluated:

| Criterion | Playwright | Cypress |
|-----------|-----------|---------|
| Language  | TypeScript-native | JS/TS |
| Parallelism | Built-in, per-worker isolation | Paid tier |
| Network mocking | `page.route()` — intercept any HTTP | `cy.intercept()` |
| CI speed | Faster (no Electron) | Slower |
| Browser coverage | Chromium, Firefox, WebKit | Chromium, Firefox, Electron |
| Community | Growing rapidly | Mature |

## Decision

**Use Playwright** (`@playwright/test`).

Key reasons:
- TypeScript-native API matches the rest of the codebase.
- `page.route()` intercepts Supabase REST/RPC/Auth calls without a real Supabase instance, enabling CI without DB credentials.
- Free parallel execution across workers in CI.
- Single `playwright.config.ts` to configure browsers, web server, and retries.

## Consequences

- Playwright browsers must be installed in CI (`npx playwright install --with-deps chromium`).
- E2E tests live in `e2e/` and run separately from Vitest unit tests (`npm run test:e2e`).
- Supabase API is mocked via `page.route()` — no real DB required in CI.
- Phase 2 can add Firefox/WebKit projects to the config with zero test changes.
