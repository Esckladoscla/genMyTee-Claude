# Horizon Theme Integration (Prompt + Image + Mockup)

This repo contains the backend and a ready-to-use Horizon theme implementation under:

- `FRONT/Theme Horizon`

## Theme files used

- `FRONT/Theme Horizon/blocks/ai-design-generator.liquid`
- `FRONT/Theme Horizon/assets/ai-design-horizon.js`

## Setup checklist

1. In Shopify theme settings, configure:
   - `AI Design > AI backend base URL`
   - Example: `https://YOUR-BACKEND-DOMAIN`
2. Ensure POD products include metafields:
   - `custom.printful_product_key` (required)
   - `custom.printful_placement` (optional, defaults to `front`)
3. Ensure backend CORS includes your storefront origin via `ALLOWED_ORIGINS`.
4. Keep product template using Horizon `product-information` with `ai-design-generator` before `buy-buttons`.

## Runtime flow on product page

1. Customer writes prompt.
2. Front calls `POST /api/preview/image` and stores `ai_image_url`.
3. Front calls `POST /api/preview/mockup` for shirt mockup.
4. If mockup completes, `ai_mockup_url` is stored and shown.
5. Add-to-cart is blocked until a valid `ai_image_url` exists for the current prompt and variant.
6. If mockup fails/skips/processes, add-to-cart is still allowed (non-blocking).

## Line item properties written by Horizon block

- `ai_prompt`
- `ai_image_url`
- `ai_mockup_url` (optional)
- `pf_product_key`
- `pf_placement`

Webhook consumption:

- `POST /api/webhooks/orders/create` reads `ai_image_url`, `pf_product_key`, and `pf_placement`.
- `ai_mockup_url` is for storefront/cart display only.
