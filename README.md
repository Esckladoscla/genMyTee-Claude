# genMyTee

Aplicación web standalone de prendas personalizadas con diseño por IA. El cliente describe un diseño, el backend genera la imagen con OpenAI, y Printful fabrica y envía la prenda.

**Stack:** Node/Express · Stripe · OpenAI · Printful · Cloudflare R2 · Render

**Producción:** https://genmytee.com

---

## Cómo funciona

1. Cliente elige prenda y color en la web
2. Describe su diseño con palabras → OpenAI genera la imagen
3. Se previsualiza el diseño sobre la prenda (mockup Printful)
4. Cliente elige talla, añade al carrito
5. Pago vía Stripe Checkout
6. Stripe webhook → backend → Printful crea el pedido de producción

---

## Instalación y arranque

```bash
npm install
npm start        # Servidor en puerto 3000
npm run dev      # Con auto-restart (--watch)
npm test         # Tests
```

Copia `.env.example` a `.env` y rellena las variables.

---

## Rutas API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/preview/image` | Genera imagen con OpenAI |
| POST | `/api/preview/mockup` | Genera mockup Printful |
| GET | `/api/preview/mockup/status` | Estado de mockup asíncrono |
| GET | `/api/preview/openai/usage` | Snapshot de uso OpenAI |
| GET | `/api/catalog/products` | Catálogo de productos |
| GET | `/api/catalog/products/:slug` | Producto por slug |
| POST | `/api/checkout/session` | Crea sesión Stripe Checkout |
| POST | `/api/checkout/webhook` | Webhook Stripe (raw body) |
| GET | `/api/checkout/status` | Estado de sesión/pedido |
| POST | `/api/orders` | Creación de pedido genérico |
| POST | `/api/newsletter` | Suscripción newsletter |

---

## Variables de entorno

Ver `.env.example` para la lista completa. Las principales:

| Variable | Descripción |
|----------|-------------|
| `OPENAI_KEY` | Clave API OpenAI |
| `PRINTFUL_API_KEY` | Clave API Printful (alias: `PRINTFUL_KEY`) |
| `PRINTFUL_CONFIRM` | `true` = auto-confirma pedidos (default `false`) |
| `STRIPE_SECRET_KEY` | Clave secreta Stripe |
| `STRIPE_PUBLISHABLE_KEY` | Clave pública Stripe |
| `STRIPE_WEBHOOK_SECRET` | Signing secret del webhook Stripe |
| `R2_ACCOUNT_ID` | Cloudflare R2 Account ID |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 Access Key |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 Secret Key |
| `R2_BUCKET` | Nombre del bucket R2 |
| `R2_PUBLIC_BASE_URL` | URL pública del bucket (ej. `https://assets.genmytee.com`) |
| `ALLOWED_ORIGINS` | Orígenes CORS permitidos (comma-separated) |
| `AI_ENABLED` | `false` desactiva OpenAI (devuelve 503) |
| `DB_PATH` | Ruta SQLite (default `data/app.db`) |

---

## Arquitectura

```
server.js           → carga dotenv, inicia Express en PORT
app.js              → createApp(): middleware, rutas, CORS, error handler

routes/
  preview.js        → generación de imagen y mockup
  catalog.js        → catálogo de productos
  checkout.js       → Stripe Checkout + webhook
  orders.js         → creación de pedido genérico
  newsletter.js     → suscripción a newsletter

services/
  openai.js         → moderación e imagen (gpt-image-1)
  storage.js        → Cloudflare R2 (S3-compatible)
  printful.js       → creación de pedidos y mockups
  stripe.js         → Stripe SDK wrapper
  order-processing.js → lógica central de pedido
  variants.js       → resolución de variantes Printful
  idempotency.js    → deduplicación SQLite
  newsletter.js     → suscriptores en SQLite
  env.js            → typed env getters

data/
  products.json     → catálogo (6 productos)
  variants-map.json → mapa product_key → color → talla → variant_id
  color-alias.json  → normalización de colores

public/             → frontend standalone (vanilla HTML/CSS/JS)
  index.html
  css/base.css, components.css, creator.css
  js/app.js, catalog.js, creator.js
  checkout-success.html, checkout-cancel.html, order-status.html
```

---

## Tests

```bash
npm test
```

Framework: `node:test` + `node:assert` (sin dependencias externas). 47 tests. Las rutas usan factory pattern (`buildPreviewRouter()`, etc.) con mocks inyectados.

---

## Modo sin IA

```env
AI_ENABLED=false
```

`POST /api/preview/image` devuelve `503 ai_disabled` sin llamar a OpenAI.

---

## Notas

- Los pedidos duplicados no generan pedidos dobles en Printful (idempotencia SQLite)
- `PRINTFUL_CONFIRM=false` deja los pedidos en borrador en Printful (recomendado durante pruebas)
- Si SQLite no está disponible, la idempotencia cae a in-memory y registra un warning
