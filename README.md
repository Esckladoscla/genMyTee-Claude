# Shopify AI Apparel Backend (OpenAI + Printful)

Node/Express backend for a Shopify store that sells print-on-demand products generated from customer prompts.

## What this MVP does

- Generates artwork before add-to-cart via `POST /api/preview/image`.
- Generates product mockups over the selected shirt via `POST /api/preview/mockup`.
- Stores prompt + generated image URL + Printful metadata in Shopify line item properties.
- Processes Shopify `orders/create` webhooks at `POST /api/webhooks/orders/create`.
- Verifies webhook HMAC signature (required).
- Prevents duplicate Printful orders with SQLite idempotency.
- Creates Printful orders using the image URL captured pre-cart (no regeneration in webhook).

## API routes

- `GET /health`
- `POST /api/preview/image`
- `POST /api/preview/mockup`
- `GET /api/preview/openai/usage` (in-memory usage snapshot)
- `POST /api/webhooks/orders/create`
- Legacy alias: `POST /webhooks/orders/create` (deprecated, logs warning)

## Environment variables

### Canonical variables

- `PORT` (default `3000`)
- `ALLOWED_ORIGINS` (comma-separated list)
- `OPENAI_KEY`
- `AI_ENABLED` (`true`/`false`, default `true`)
- `AI_FALLBACK_IMAGE_URL` (optional; if empty, uses `${R2_PUBLIC_BASE_URL}/printful/fallback.png` when `AI_ENABLED=false`)
- `AI_IMAGE_SIZE` (`auto`, `1024x1024`, `1024x1536`, `1536x1024`)
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_PUBLIC_BASE_URL`
- `SHOPIFY_WEBHOOK_SECRET`
- `PRINTFUL_API_KEY`
- `PRINTFUL_CONFIRM` (`true`/`false`, default `false`)
- `PRINTFUL_PLACEMENT` (default `front`)
- `PRINTFUL_STITCH_COLOR` (default `black`)
- `DB_PATH` (default `data/app.db`)

### Legacy aliases (supported temporarily)

- `PRINTFUL_KEY` -> `PRINTFUL_API_KEY`
- `SHOPIFY_ACCESS_TOKEN` -> `SHOPIFY_ADMIN_TOKEN`

The app logs a deprecation warning when aliases are used.

## Install and run

```bash
npm install
npm start
```

Run tests:

```bash
npm test
```

Run local smoke checks (server must be running):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-local.ps1
```

## OpenAI billing setup and no-spend mode

1. In OpenAI project settings, configure `Limits`:
   - monthly budget
   - alert thresholds
   - allowed model usage
2. Create an API key in that billed project/org and set it in `.env` as `OPENAI_KEY`.
3. While billing is not ready, use test mode:

```env
AI_ENABLED=false
```

In test mode:
- `POST /api/preview/image` returns `503 ai_disabled` without calling OpenAI.
- Webhook processing can still continue using fallback image URL if `ai_image_url` is missing.

## Preview endpoint contracts

`GET /api/preview/openai/usage`

- Returns in-memory OpenAI call history tracked by this process.
- Includes moderation and image-generation attempts, timestamp, status, duration.
- Optional query: `?limit=200` (min `1`, max `500`).

`POST /api/preview/image`

Request body:

```json
{
  "prompt": "A retro geometric tiger in orange and blue",
  "pf_product_key": "all-over-print-mens-athletic-t-shirt",
  "pf_placement": "front"
}
```

Success response:

```json
{
  "ok": true,
  "image_url": "https://cdn.example.com/previews/art-123.png",
  "moderation": { "flagged": false }
}
```

Validation rules:

- Prompt length must be 8-280 characters.
- Prompt must pass OpenAI moderation.
- Rate limit: 10 requests per IP per 5 minutes.

`POST /api/preview/mockup`

Request body:

```json
{
  "image_url": "https://cdn.example.com/previews/art-123.png",
  "pf_product_key": "all-over-print-mens-athletic-t-shirt",
  "pf_placement": "front",
  "variant_title": "M"
}
```

Success response:

```json
{
  "ok": true,
  "mockup_status": "completed",
  "mockup_url": "https://files.cdn.printful.com/mockup.png",
  "reason": null
}
```

`mockup_status` values:

- `completed`
- `processing`
- `failed`
- `skipped`

## Webhook endpoint contract

`POST /api/webhooks/orders/create`

- Request body must be raw JSON from Shopify.
- Header `X-Shopify-Hmac-Sha256` is mandatory.

Response fields:

- `ok`
- `skipped`
- `reason`
- `external_id`
- `printful_order_id`

## Required Shopify line item properties

- `ai_prompt`
- `ai_image_url`
- `ai_mockup_url` (optional)
- `pf_product_key`
- `pf_placement`

The webhook reads `ai_image_url` and sends that exact asset to Printful.

## Variants map source

Primary file:

- `data/variants-map.json`

Fallback (deprecated):

- `variants-map.json`

## Theme integration

See `docs/theme-integration.md`.

For Horizon theme, use:

- `FRONT/Theme Horizon/blocks/ai-design-generator.liquid`
- `FRONT/Theme Horizon/assets/ai-design-horizon.js`

## Notes

- This MVP defaults to product key `all-over-print-mens-athletic-t-shirt` and placement `front`.
- Duplicate webhook deliveries do not create duplicate Printful orders.
- If SQLite file storage is unavailable in your environment, idempotency falls back to in-memory mode and logs a warning.
- For production, keep webhook URL public and serve over HTTPS.
