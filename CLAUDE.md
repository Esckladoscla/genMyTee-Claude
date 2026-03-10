# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Role

Act as a senior full-stack engineer and pragmatic solution architect.

Your job is to help build, improve, and evolve this product safely.
Do not assume the current architecture is final.
Do not assume the current Shopify-based structure should remain the long-term default.

Be explicit about:
- what is currently true,
- what is a working assumption,
- what is a proposed direction,
- and what is risky.

## Product direction

This project is currently built around Shopify, Render, Printful, OpenAI, and Cloudflare R2.

However, the product is still under active construction.

The project has multiple simultaneous goals:
- continue building the backend;
- redesign and improve the frontend;
- evolve the product into a more independent web application over time;
- reduce unnecessary Shopify lock-in where it makes sense;
- keep the business functional while architecture evolves.

Shopify is the current platform context, not necessarily the final architecture.

## Constraints and rules

- Do not commit real secrets or credentials
- Never store real `.env` secrets in the repository
- Prefer `.env.example` for documented variables
- Assume real secrets live in Render environment variables
- Do not introduce new hard dependencies on Shopify unless explicitly requested
- Prefer modular design and provider abstraction when reasonable
- Avoid large risky rewrites unless clearly justified
- Flag risky changes before implementing them

## Current priorities

Claude should assume that the repository may require work in all of these areas:
- frontend redesign / UX changes;
- backend feature development;
- architecture cleanup;
- gradual decoupling from Shopify where justified;
- improved maintainability and deployment reliability.

Do not optimize only for migration.
Do not optimize only for preserving the current Shopify structure.
Think in terms of product evolution.

## Working style

When asked to make a change:
1. Inspect the relevant code first
2. Explain briefly:
   - current behavior,
   - coupling points,
   - affected files,
   - recommended approach
3. Make the smallest coherent changes possible
4. Preserve working behavior when practical
5. Update documentation when architecture or behavior changes
6. Add or adapt tests when it makes sense

When proposing solutions:
- separate facts from assumptions
- distinguish current state from target direction
- mention tradeoffs explicitly
- prefer phased progress over vague big-bang rewrites

## Project overview

Node/Express backend for a Shopify store selling AI-generated print-on-demand apparel. Customers enter a text prompt on the storefront, the backend generates artwork via OpenAI (gpt-image-1), uploads it to Cloudflare R2, creates Printful mockups, and fulfills orders through Shopify webhooks routed to Printful.

This project currently operates around Shopify, but that is the current state, not the long-term target.

Current business/infrastructure context:
- Public domain: `genmytee.com`
- The domain is currently purchased/configured through Shopify
- The application runs on Render
- Printful is used for product creation / fulfillment
- OpenAI is used to generate customer-requested artwork

Important:
this repository should be treated as an evolving full-stack product, not just as a fixed Shopify backend.
Frontend, backend, integrations, and architecture may all change.

## Commands

```bash
npm install          # Install dependencies
npm start            # Start server (node server.js)
npm run dev          # Start with --watch for auto-restart
npm test             # Run all tests (node tests/run-tests.js)
```

Smoke tests (server must be running):
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-local.ps1
```

## Architecture

**ES modules** throughout (`"type": "module"` in package.json). No build step, no TypeScript on the backend.

### Entry points
- `server.js` — loads dotenv, creates Express app, listens on `PORT` (default 3000)
- `app.js` — `createApp()` assembles middleware, routes, CORS, error handler

### Route layer (`routes/`)
- `preview.js` — `POST /api/preview/image` (AI generation), `POST /api/preview/mockup` (Printful mockup), `GET /api/preview/mockup/status`, `GET /api/preview/openai/usage`
- `webhooks.js` — `POST /api/webhooks/orders/create` (Shopify webhook → Printful order)

Both route files export a `build*Router()` factory that accepts dependency injection for testing, then export a default router instance using the real implementations.

### Service layer (`services/`)
- `openai.js` — prompt moderation (`omni-moderation-latest`) and image generation (`gpt-image-1`), with retry logic and in-memory usage tracking
- `storage.js` — uploads image buffers to Cloudflare R2 via S3-compatible API
- `printful.js` — creates Printful orders and generates mockups
- `variants.js` — resolves Shopify variant titles (e.g. "Black / M") to Printful variant IDs using `data/variants-map.json`
- `idempotency.js` — SQLite-backed (`node:sqlite` `DatabaseSync`) deduplication for webhook orders; falls back to in-memory if file DB unavailable
- `shopify-webhook-auth.js` — HMAC signature verification for Shopify webhooks
- `env.js` — typed env getters (`getEnv`, `requireEnv`, `getBooleanEnv`, `getNumberEnv`) with legacy alias support and deprecation warnings

### Data files (`data/`)
- `variants-map.json` — primary product→color→size→variant_id mapping (loaded once, cached)
- `color-alias.json` — color name normalization
- `printful_product_ids.json` — Printful product metadata
- `app.db` — SQLite database for idempotency

### Frontend / Theme (`FRONT/Theme Horizon/`)
Shopify Horizon theme with custom AI design block. Key files:
- `blocks/ai-design-generator.liquid` — Liquid block for product pages
- `assets/ai-design-horizon.js` — client-side JS for prompt→image→mockup flow

There is also a simpler/legacy theme integration in `theme/`.

## Testing

Tests use `node:test` and `node:assert` (no external test framework). The custom runner at `tests/run-tests.js` imports all `*.test.js` files sequentially. Route tests use the `buildPreviewRouter()`/`buildWebhooksRouter()` factories with injected mocks — no real API calls are made.

Services expose `_reset*ForTests()` functions to clear cached singletons between tests.

## Key conventions

- User-facing error messages in the preview route are in Spanish (target market)
- All API responses include `{ ok: boolean }` at the top level
- Mockup endpoint returns `mockup_status` ("completed", "processing", "failed", "skipped", "rate_limited") rather than HTTP error codes — the frontend polls `GET /api/preview/mockup/status?task_key=...` for async results
- Webhook processing is idempotent: duplicate Shopify deliveries are detected via SQLite and return `skipped: true`
- The `PRINTFUL_CONFIRM` env var controls whether Printful orders are auto-confirmed (default `false` for safety)
- `AI_ENABLED=false` disables OpenAI calls entirely; preview returns 503, webhooks use fallback image URL

## Environment variables

See README.md for the full list. Key ones: `OPENAI_KEY`, `R2_*` (Cloudflare storage), `SHOPIFY_WEBHOOK_SECRET`, `PRINTFUL_API_KEY`, `AI_ENABLED`, `ALLOWED_ORIGINS`.
