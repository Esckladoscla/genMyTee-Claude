# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Role

Act as a senior full-stack engineer and pragmatic solution architect.

Your job is to help build, improve, and evolve this product safely.
Be explicit about what is currently true, what is a working assumption, what is a proposed direction, and what is risky.

## Product direction

This project is a **standalone web application** — the Shopify migration is complete.

Stack: Node/Express · Stripe · OpenAI · Printful · Cloudflare R2 · Render

The product is live at https://genmytee.com and under active development.

Current priorities:
- frontend UX improvements and new features;
- backend feature development;
- improved maintainability and reliability.

## Constraints and rules

- Do not commit real secrets or credentials
- Never store real `.env` secrets in the repository
- Prefer `.env.example` for documented variables
- Assume real secrets live in Render environment variables
- No dependencies on Shopify — the migration is complete and Shopify is no longer part of the stack
- Prefer modular design and provider abstraction when reasonable
- Avoid large risky rewrites unless clearly justified
- Flag risky changes before implementing them

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

Standalone web application for personalized print-on-demand apparel. Customers describe a design in natural language → backend generates artwork via OpenAI (gpt-image-1) → uploads to Cloudflare R2 → creates Printful mockups → customer pays via Stripe Checkout → Stripe webhook triggers Printful order fulfillment.

Infrastructure:
- Public domain: `genmytee.com` (Cloudflare DNS → Render)
- Application runs on Render (deployed from `development` branch)
- Printful for product manufacturing and fulfillment
- OpenAI for image generation and moderation
- Cloudflare R2 for image storage
- Stripe for payments (Checkout Sessions + webhooks)
- SQLite for order idempotency and newsletter subscribers
- Plausible for privacy-friendly web analytics

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
- `preview.js` — `POST /api/preview/image` (AI generation), `POST /api/preview/mockup` (Printful mockup), `GET /api/preview/mockup/status`
- `orders.js` — `POST /api/orders` (generic order creation)
- `catalog.js` — `GET /api/catalog/products`, `GET /api/catalog/products/:slug` (product catalog from `data/products.json`)
- `checkout.js` — `POST /api/checkout/session` (creates Stripe Checkout Session from cart items), `POST /api/checkout/webhook` (handles Stripe `checkout.session.completed` → Printful order via `order-processing.js`), `GET /api/checkout/status`
- `newsletter.js` — `POST /api/newsletter` (email subscription, stored in SQLite)
- `gallery.js` — `GET /api/gallery/designs` (curated designs with tag/featured/collection filters), `GET /api/gallery/designs/:id` (design detail), `GET /api/gallery/collections` (collections with design counts), SSR pages: `/galeria/:id` (design page), `/galeria/coleccion/:slug` (collection page), `/sitemap.xml`
- `gift-cards.js` — `GET /api/gift-cards/amounts`, `POST /api/gift-cards/purchase`, `GET /api/gift-cards/validate`, `POST /api/gift-cards/redeem`
- `referrals.js` — `POST /api/referrals/generate` (create referral code), `GET /api/referrals/validate` (validate code + record visit), `GET /api/referrals/stats` (referral stats by email)
- `preview.js` also exposes: `POST /api/preview/image/async` (enqueue async generation), `GET /api/preview/image/status` (poll job status)
- `admin.js` — Admin panel: `GET /api/admin/dashboard` (business metrics), `POST /api/admin/ai` (toggle AI), `GET /api/admin/orders` (order review), `GET /api/admin/experiments` (A/B testing), `GET /api/admin/gift-cards` (gift card list), `POST /api/admin/gallery/batch-generate` (batch image generation)

All route files export a `build*Router()` factory that accepts dependency injection for testing, then export a default router instance using the real implementations.

### Service layer (`services/`)
- `openai.js` — prompt moderation (`omni-moderation-latest`) and image generation (`gpt-image-1`), with retry logic and in-memory usage tracking
- `storage.js` — uploads image buffers to Cloudflare R2 via S3-compatible API
- `printful.js` — creates Printful orders and generates mockups
- `order-processing.js` — extracted order processing core: `buildPrintfulItems()` and `processOrder()`. Accepts generic `{product_key, color, size}` items. Used by `routes/orders.js` and `routes/checkout.js`.
- `variants.js` — resolves variant titles (e.g. "Black / M") to Printful variant IDs using `data/variants-map.json`
- `idempotency.js` — SQLite-backed (`node:sqlite` `DatabaseSync`) deduplication for orders; falls back to in-memory if file DB unavailable
- `stripe.js` — Stripe SDK wrapper: `createCheckoutSession()`, `verifyWebhookSignature()`, `extractOrderFromSession()`
- `newsletter.js` — SQLite-backed email subscription storage
- `env.js` — typed env getters (`getEnv`, `requireEnv`, `getBooleanEnv`, `getNumberEnv`) with legacy alias support and deprecation warnings
- `generation-queue.js` — SQLite-backed async generation queue with retry logic and FIFO processing
- `prompt-cache.js` — SQLite-backed prompt→image cache with TTL and hit tracking
- `image-provider.js` — Provider abstraction for image generation (OpenAI default, register fallbacks)
- `registry.js` — Service registry for all external dependencies (storage, image, fulfillment, payments)
- `captcha.js` — Cloudflare Turnstile CAPTCHA verification (invisible, configurable via `CAPTCHA_ENABLED`)
- `image-moderator.js` — Post-generation image moderation using OpenAI omni-moderation (configurable via `IMAGE_MODERATION_ENABLED`)
- `email.js` — Transactional email service (Resend API) with templates for order confirmation, shipping, review requests, gift cards (configurable via `EMAIL_ENABLED`, `RESEND_API_KEY`)
- `ab-testing.js` — A/B testing framework: experiments, deterministic variant assignment, event tracking, results aggregation (configurable via `AB_TESTING_ENABLED`)
- `gift-cards.js` — SQLite-backed digital gift cards: create, validate, redeem (codes: `GMT-XXXX-XXXX-XXXX`, amounts: €25/50/75/100, 1-year expiry)

### Data files (`data/`)
- `variants-map.json` — primary product→color→size→variant_id mapping (loaded once, cached)
- `color-alias.json` — color name normalization
- `printful_product_ids.json` — Printful product metadata
- `products.json` — product catalog (slug, name, product_key, base_price_eur, sizes, colors, placement)
- `curated-designs.json` — gallery of 55 pre-made designs (id, title, image_url, tags, compatible_products, collection)
- `collections.json` — 11 thematic collections (id, name, slug, description, emoji, sort_order)
- `bundles.json` — pack/bundle pricing rules (min_items, categories, bundle_price_eur)
- `app.db` — SQLite database for idempotency and newsletter subscribers

### Frontend (`public/`)
Standalone vanilla HTML/CSS/JS frontend served by Express.
- `index.html` — homepage: hero, trust badges, product grid, creator section, testimonials, FAQ, newsletter, cookie banner, footer
- `css/base.css` — design system (CSS custom properties, typography, animations)
- `css/components.css` — nav, hero, product cards, cart drawer, testimonials, newsletter, footer, responsive
- `css/creator.css` — 4-step creator panel (garment selection, prompt, preview, size/cart)
- `js/app.js` — global UI (cart with localStorage, nav, toast, newsletter, checkout via `/api/checkout/session`)
- `js/catalog.js` — fetches products from `/api/catalog/products`, renders product grid
- `js/creator.js` — 4-step design flow: garment → prompt → generate → size/add-to-cart. Calls `/api/preview/image` and `/api/preview/mockup`.
- `checkout-success.html` — post-payment success page (clears cart, shows confirmation)
- `checkout-cancel.html` — payment cancelled page
- `order-status.html` — consulta de estado de pedido por session ID

## Testing

Tests use `node:test` and `node:assert` (no external test framework). The custom runner at `tests/run-tests.js` imports all `*.test.js` files sequentially. Route tests use factory pattern (`buildPreviewRouter()`, etc.) with injected mocks — no real API calls are made.

Services expose `_reset*ForTests()` functions to clear cached singletons between tests.

## Key conventions

- User-facing error messages in the preview route are in Spanish (target market)
- All API responses include `{ ok: boolean }` at the top level
- Mockup endpoint returns `mockup_status` ("completed", "processing", "failed", "skipped", "rate_limited") rather than HTTP error codes — the frontend polls `GET /api/preview/mockup/status?task_key=...` for async results
- Order processing is idempotent: duplicate Stripe webhook deliveries are detected via SQLite and return `skipped: true`
- The `PRINTFUL_CONFIRM` env var controls whether Printful orders are auto-confirmed (default `false` for safety)
- `AI_ENABLED=false` disables OpenAI calls entirely; preview returns 503

## Environment variables

See README.md for the full list. Key ones: `OPENAI_KEY`, `R2_*` (Cloudflare storage), `PRINTFUL_API_KEY`, `AI_ENABLED`, `ALLOWED_ORIGINS`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.

## Product positioning

This product should be presented primarily as personalized, expressive, and created from the customer's idea.

Do not frame the main value proposition as “AI-generated clothing”.
AI is an enabling technology, not the main emotional selling point.

In customer-facing UX and copy:
- lead with personalization and identity,
- keep language natural and emotional,
- avoid overly technical AI-first messaging,
- treat the customization flow as a core product experience.

Avoid strong claims like “unique in the world” unless they can be genuinely supported.
