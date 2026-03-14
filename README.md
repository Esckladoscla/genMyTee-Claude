# genMyTee

Aplicación web standalone de prendas personalizadas con diseño por IA. El cliente describe un diseño con palabras, el backend genera la imagen con OpenAI (gpt-image-1), y Printful fabrica y envía la prenda.

**Stack:** Node/Express · Stripe · OpenAI · Printful · Cloudflare R2 · Render

**Producción:** https://genmytee.com

---

## Cómo funciona

1. Cliente elige prenda y color en la web
2. Describe su diseño con palabras → OpenAI genera la imagen
3. Se previsualiza el diseño sobre la prenda (mockup Printful) con watermark
4. Cliente elige talla, añade al carrito
5. Pago vía Stripe Checkout (Apple Pay, Google Pay incluidos)
6. Stripe webhook → backend → Printful crea el pedido de producción
7. Emails automáticos de confirmación, envío y entrega (vía Resend)

---

## Instalación y arranque

```bash
npm install          # Instalar dependencias
npm start            # Servidor en puerto 3000
npm run dev          # Con auto-restart (--watch)
npm test             # Ejecutar todos los tests (290 tests)
```

Copia `.env.example` a `.env` y rellena las variables necesarias.

### Smoke tests (servidor debe estar corriendo)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-local.ps1
```

---

## Páginas del frontend

| URL | Archivo | Descripción |
|-----|---------|-------------|
| `/` | `index.html` | Homepage: hero, badges de confianza, grid de productos, creador, testimonios, FAQ, newsletter |
| `/mi-cuenta.html` | `mi-cuenta.html` | Perfil de usuario: historial de diseños, info de cuenta, verificación de email |
| `/checkout-success.html` | `checkout-success.html` | Página post-pago (vacía carrito, muestra confirmación) |
| `/checkout-cancel.html` | `checkout-cancel.html` | Página de pago cancelado |
| `/order-status.html` | `order-status.html` | Consulta de estado de pedido por Stripe session ID |
| `/terminos.html` | `terminos.html` | Términos y condiciones |
| `/privacidad.html` | `privacidad.html` | Política de privacidad |
| `/cookies.html` | `cookies.html` | Política de cookies |
| `/galeria/:id` | SSR (server-rendered) | Página de diseño individual (SEO) |
| `/galeria/coleccion/:slug` | SSR (server-rendered) | Página de colección temática (SEO) |
| `/admin/dashboard.html` | `admin/dashboard.html` | Panel de administración (requiere `ADMIN_SECRET`) |

---

## Rutas API

### Generación de diseños (`/api/preview`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/preview/captcha-config` | Config de Cloudflare Turnstile para el frontend |
| POST | `/api/preview/unlock` | Desbloquea sesión con email (bypass límite generaciones) |
| POST | `/api/preview/image` | Genera imagen con OpenAI (síncrono, con watermark) |
| POST | `/api/preview/image/async` | Genera imagen asíncrona (encola, devuelve inmediatamente) |
| GET | `/api/preview/image/status` | Estado de generación asíncrona (polling) |
| POST | `/api/preview/mockup` | Genera mockup Printful para una variante |
| GET | `/api/preview/mockup/status` | Estado de mockup asíncrono (polling) |

### Catálogo (`/api/catalog`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/catalog/products` | Lista todos los productos con info de layout |
| GET | `/api/catalog/products/:slug` | Detalle de un producto por slug |
| GET | `/api/catalog/bundles` | Reglas de precios por pack/bundle |

### Pagos (`/api/checkout`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/checkout/session` | Crea sesión Stripe Checkout desde carrito |
| GET | `/api/checkout/status` | Estado de sesión + tracking Printful |
| POST | `/api/checkout/webhook` | Webhook Stripe (`checkout.session.completed`) |

### Pedidos (`/api/orders`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/orders` | Creación de pedido directo (gift cards, integraciones) |

### Galería (`/api/gallery`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/gallery/designs` | Lista diseños (filtrable por tag, featured, collection) |
| GET | `/api/gallery/designs/:id` | Detalle de un diseño |
| GET | `/api/gallery/collections` | Lista colecciones con conteo de diseños |
| GET | `/sitemap.xml` | Sitemap dinámico (diseños, colecciones, páginas estáticas) |

### Tarjetas regalo (`/api/gift-cards`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/gift-cards/amounts` | Denominaciones válidas (25, 50, 75, 100 EUR) |
| POST | `/api/gift-cards/purchase` | Crear tarjeta regalo tras pago |
| GET | `/api/gift-cards/validate` | Validar código y ver saldo |
| POST | `/api/gift-cards/redeem` | Canjear tarjeta (uso único) |

### Referidos (`/api/referrals`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/referrals/generate` | Crear código de referido para un email |
| GET | `/api/referrals/validate` | Validar código y registrar visita (`?ref=CODE`) |
| GET | `/api/referrals/stats` | Estadísticas de referidos por email |

### Autenticación (`/api/auth`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/register` | Registrar usuario (email/contraseña) |
| POST | `/api/auth/login` | Login con email/contraseña |
| POST | `/api/auth/logout` | Logout (borra cookie de sesión) |
| GET | `/api/auth/me` | Obtener usuario autenticado actual |
| POST | `/api/auth/verify-email/send` | Enviar código de verificación de email |
| POST | `/api/auth/verify-email/confirm` | Confirmar email con código de 6 dígitos |
| GET | `/api/auth/google` | Redirect a Google OAuth |
| GET | `/api/auth/google/callback` | Callback de Google OAuth |
| GET | `/api/auth/config` | Config de auth (Google OAuth habilitado, client ID) |

### Perfil de usuario (`/api/profile`) — requiere autenticación

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/profile/designs` | Historial de diseños del usuario (paginado) |
| GET | `/api/profile/orders` | Historial de pedidos (placeholder) |
| GET | `/api/profile/summary` | Resumen del perfil (email, nombre, conteo diseños) |

### Newsletter (`/api/newsletter`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/newsletter` | Suscripción a newsletter (email en SQLite) |

### Admin (`/api/admin`) — requiere `Authorization: Bearer <ADMIN_SECRET>`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/admin/dashboard` | Métricas completas (revenue, generaciones, costes, pedidos) |
| GET | `/api/admin/ai` | Estado de AI_ENABLED |
| POST | `/api/admin/ai` | Toggle AI on/off (`{ "enabled": true/false }`) |
| GET | `/api/admin/openai/usage` | Historial de uso OpenAI (últimas N llamadas) |
| GET | `/api/admin/stats` | Stats rápidos (generaciones hora/día, uso OpenAI) |
| GET | `/api/admin/orders` | Lista de pedidos procesados (últimos 100) |
| GET | `/api/admin/orders/:orderId` | Detalle de un pedido |
| POST | `/api/admin/orders/:orderId/hold` | Poner pedido en espera |
| POST | `/api/admin/orders/:orderId/approve` | Aprobar/completar pedido |
| GET | `/api/admin/experiments` | Lista de experimentos A/B |
| POST | `/api/admin/experiments` | Crear nuevo experimento |
| GET | `/api/admin/experiments/:id/results` | Resultados de un experimento |
| GET | `/api/admin/gift-cards` | Lista de tarjetas regalo (últimas 100) |
| POST | `/api/admin/gallery/batch-generate` | Generación batch de imágenes para galería |

### Otros

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/robots.txt` | Robots.txt para SEO |

---

## Admin Dashboard

Panel de administración en `/admin/dashboard.html` con métricas de negocio en tiempo real.

### Qué incluye

- **Revenue total** y últimos 30 días
- **Pedidos completados** (total + últimos 7 días)
- **Generaciones por hora** (con gráfico) — muestra uso actual vs umbral de alerta
- **Tasa de conversión** (pedidos / generaciones)
- **Coste API estimado** (generación de imagen + moderación)
- **Sesiones / Emails / IPs únicas**
- **Gráficos**: pedidos diarios, generaciones por hora, llamadas OpenAI por tipo, estado de pedidos
- **Toggle AI ON/OFF** — desactiva/activa generación de imágenes en un click
- **Revisión de pedidos** — hold/approve para cada pedido
- Se auto-actualiza cada 60 segundos

### Cómo acceder

1. Configura `ADMIN_SECRET` en tus variables de entorno. El valor que pongas es la contraseña directamente (comparación directa con timing-safe):

   ```env
   ADMIN_SECRET=tu-secreto-seguro-aqui
   ```

   Para generar un secreto aleatorio:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. Abre en el navegador:
   - **Local:** http://localhost:3000/admin/dashboard.html
   - **Producción:** https://genmytee.com/admin/dashboard.html

3. Introduce el secreto en el campo de texto y pulsa "Entrar"

### Usar la API directamente

Todas las rutas admin aceptan el header `Authorization: Bearer <ADMIN_SECRET>`:

```bash
# Ver métricas
curl http://localhost:3000/api/admin/dashboard -H "Authorization: Bearer tu-secreto"

# Desactivar IA de emergencia
curl -X POST http://localhost:3000/api/admin/ai \
  -H "Authorization: Bearer tu-secreto" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

---

## Protección de costes

El sistema tiene múltiples capas automáticas para evitar costes descontrolados en la API de OpenAI:

| Capa | Qué hace | Umbral default | Variable de entorno |
|------|----------|----------------|---------------------|
| **Rate limit por IP** | Limita generaciones por IP individual | Configurable | `RATE_LIMIT_*` |
| **Límite por sesión** | 3 gratis + email gate + 5 bonus | Hardcoded | — |
| **Límite mensual auth** | 15 gen/mes para usuarios registrados | 15 | `AUTH_GENERATIONS_LIMIT` |
| **Alerta** | Email/webhook al admin al llegar al umbral | 50/hora | `GENERATION_ALERT_THRESHOLD_PER_HOUR` |
| **Rate limit global** | Devuelve 429 a nuevas peticiones | 100/hora | `GLOBAL_RATE_LIMIT_PER_HOUR` |
| **Circuit breaker** | Auto-desactiva AI globalmente | 200/hora | `CIRCUIT_BREAKER_THRESHOLD_PER_HOUR` |
| **Cap diario** | Auto-desactiva AI hasta medianoche UTC | 500/día | `DAILY_GENERATION_CAP` |
| **Bonus compra** | +10 generaciones al completar Stripe checkout | 10 | `PURCHASE_GENERATION_BONUS` |

### Anti-abuso

| Mecanismo | Descripción |
|-----------|-------------|
| **CAPTCHA** | Cloudflare Turnstile invisible en endpoints de generación |
| **Browser fingerprinting** | Detecta botnets distribuidos (mismo User-Agent desde muchas IPs) |
| **Filtro de marcas** | Bloquea prompts con 100+ marcas registradas |
| **Moderación pre-generación** | OpenAI omni-moderation-latest filtra prompts |
| **Moderación post-generación** | Moderación de la imagen generada (configurable) |
| **Watermark en previews** | Las previews llevan marca de agua; la imagen limpia solo se usa en producción |
| **URLs no derivables** | Los filenames de preview y producción son independientes y aleatorios |

### Alertas externas

Cuando se activan umbrales de coste, el sistema envía alertas por:
- **Email** — vía Resend al `ALERT_EMAIL`
- **Webhook** — POST a `ALERT_WEBHOOK_URL` (compatible con Slack)

Cooldown de 1 hora por tipo de alerta para evitar spam.

---

## Autenticación de usuarios

### Métodos de login

- **Email + contraseña** — registro con verificación de email (código de 6 dígitos vía Resend, expira en 30 min)
- **Google OAuth2** — login con cuenta de Google (requiere `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`)

### Cómo funciona

- Las contraseñas se hashean con `scrypt` (Node.js nativo)
- Las sesiones se gestionan con cookies (`httpOnly`, `Secure`, `SameSite`)
- Al registrarse, el historial de diseños anónimos de la sesión se vincula al nuevo usuario
- Los usuarios autenticados tienen 15 generaciones/mes (se resetea automáticamente el primer acceso de cada mes)
- Al completar una compra, se otorgan +10 generaciones bonus

### Google OAuth — configuración

1. Crear proyecto en Google Cloud Console
2. Configurar OAuth consent screen
3. Crear credenciales OAuth 2.0 (Web application)
4. Añadir redirect URI: `https://genmytee.com/api/auth/google/callback`
5. Configurar variables de entorno:
   ```env
   GOOGLE_CLIENT_ID=tu-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=tu-client-secret
   ```

---

## Galería de diseños

55 diseños curados organizados en 11 colecciones temáticas.

- Filtrado por tags, colección, y featured
- Páginas SSR individuales por diseño y colección (indexables por Google)
- Sitemap XML dinámico en `/sitemap.xml`
- Generación batch de imágenes vía admin API

### Colecciones

Los datos están en `data/collections.json` (11 colecciones) y `data/curated-designs.json` (55 diseños).

---

## Tarjetas regalo

Tarjetas regalo digitales con códigos `GMT-XXXX-XXXX-XXXX`.

- Denominaciones: 25, 50, 75, 100 EUR
- Validez: 1 año desde la compra
- Uso único (se canjean completas en el carrito)
- Se envían por email al comprador

---

## Programa de referidos

- Cada usuario puede generar un código de referido vinculado a su email
- Las visitas con `?ref=CODE` se registran
- Banner de descuento automático para visitantes referidos
- Estadísticas de referidos por email

---

## Emails transaccionales

Servicio de emails vía Resend (requiere `RESEND_API_KEY` + `EMAIL_ENABLED=true`):

| Email | Cuándo se envía |
|-------|-----------------|
| Confirmación de pedido | Al completar Stripe checkout |
| Pedido en producción | Al confirmar Printful |
| Pedido enviado | Al actualizar tracking |
| Pedido entregado | Al confirmar entrega |
| Solicitud de reseña | Días después de entrega |
| Verificación de email | Al registrarse o solicitar verificación |
| Tarjeta regalo | Al comprar una gift card |
| Alertas de coste | Al superar umbrales de generación (al admin) |

---

## A/B Testing

Framework de testing A/B integrado (requiere `AB_TESTING_ENABLED=true`):

- Creación de experimentos con variantes
- Asignación determinista de variantes por sesión
- Tracking de eventos por variante
- Resultados agregados vía admin API

---

## Variables de entorno

### Claves API externas

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `OPENAI_KEY` | Clave API OpenAI (generación de imagen + moderación) | Sí |
| `PRINTFUL_API_KEY` | Clave API Printful (alias: `PRINTFUL_KEY`) | Sí |
| `STRIPE_SECRET_KEY` | Clave secreta Stripe | Sí |
| `STRIPE_PUBLISHABLE_KEY` | Clave pública Stripe | Sí |
| `STRIPE_WEBHOOK_SECRET` | Signing secret del webhook Stripe | Sí |
| `RESEND_API_KEY` | Clave API Resend (emails transaccionales) | No |

### Cloudflare R2 (almacenamiento de imágenes)

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `R2_ACCOUNT_ID` | Cloudflare R2 Account ID | Sí |
| `R2_ACCESS_KEY_ID` | R2 Access Key | Sí |
| `R2_SECRET_ACCESS_KEY` | R2 Secret Key | Sí |
| `R2_BUCKET` | Nombre del bucket (default: `genmytee-printful`) | Sí |
| `R2_PUBLIC_BASE_URL` | URL pública (default: `https://assets.genmytee.com`) | Sí |

### Servidor

| Variable | Descripción | Default |
|----------|-------------|---------|
| `PORT` | Puerto del servidor | `3000` (Render usa `10000`) |
| `ALLOWED_ORIGINS` | Orígenes CORS (comma-separated o `*`) | — |
| `DB_PATH` | Ruta de la base de datos SQLite | `data/app.db` |
| `ADMIN_SECRET` | Contraseña para el panel de admin | — |
| `AI_ENABLED` | Habilitar/deshabilitar generación con IA | `true` |

### Control de costes

| Variable | Descripción | Default |
|----------|-------------|---------|
| `GENERATION_ALERT_THRESHOLD_PER_HOUR` | Umbral para disparar alertas | `50` |
| `GLOBAL_RATE_LIMIT_PER_HOUR` | Soft limit — devuelve 429 | `100` |
| `CIRCUIT_BREAKER_THRESHOLD_PER_HOUR` | Hard limit — desactiva AI globalmente | `200` |
| `DAILY_GENERATION_CAP` | Límite diario, reset a medianoche UTC | `500` |
| `PURCHASE_GENERATION_BONUS` | Generaciones bonus al comprar | `10` |
| `AUTH_GENERATIONS_LIMIT` | Generaciones/mes para usuarios registrados | `15` |
| `ALERT_EMAIL` | Email del admin para alertas de coste | — |
| `ALERT_WEBHOOK_URL` | URL webhook (Slack/genérico) para alertas | — |

### CAPTCHA (Cloudflare Turnstile)

| Variable | Descripción | Default |
|----------|-------------|---------|
| `CAPTCHA_ENABLED` | Habilitar CAPTCHA invisible | `false` |
| `TURNSTILE_SITE_KEY` | Clave de sitio Turnstile | — |
| `TURNSTILE_SECRET_KEY` | Clave secreta Turnstile | — |

### Autenticación (Google OAuth)

| Variable | Descripción | Default |
|----------|-------------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret | — |
| `GOOGLE_OAUTH_REDIRECT_URI` | URI de callback (auto-derivado si no se pone) | — |

### Browser fingerprinting (anti-bot)

| Variable | Descripción | Default |
|----------|-------------|---------|
| `FINGERPRINT_ENABLED` | Habilitar fingerprinting | `true` |
| `FP_MAX_IPS_PER_FINGERPRINT` | Max IPs por fingerprint antes de flag | `5` |
| `FP_MAX_FINGERPRINTS_PER_IP` | Max fingerprints por IP | `10` |
| `FP_WINDOW_MS` | Ventana de detección en ms | `3600000` (1 hora) |

### Moderación y generación

| Variable | Descripción | Default |
|----------|-------------|---------|
| `IMAGE_MODERATION_ENABLED` | Moderación post-generación de imagen | `false` |
| `AI_IMAGE_SIZE` | Tamaño de imagen para generación | `auto` |

### Emails y features opcionales

| Variable | Descripción | Default |
|----------|-------------|---------|
| `EMAIL_ENABLED` | Habilitar emails transaccionales (Resend) | `false` |
| `AB_TESTING_ENABLED` | Habilitar framework A/B testing | `false` |

### Printful

| Variable | Descripción | Default |
|----------|-------------|---------|
| `PRINTFUL_CONFIRM` | Auto-confirmar pedidos en Printful | `false` |
| `PRINTFUL_PLACEMENT` | Placement por defecto de la imagen | `front` |

---

## Arquitectura

```
server.js                → carga dotenv, inicia Express en PORT
app.js                   → createApp(): middleware, rutas, CORS, error handler

routes/
  preview.js             → generación de imagen (sync/async), mockup, CAPTCHA
  checkout.js            → Stripe Checkout + webhook + estado
  orders.js              → creación de pedido directo
  catalog.js             → catálogo de productos + bundles
  gallery.js             → galería de diseños, colecciones, SSR, sitemap
  gift-cards.js          → tarjetas regalo (compra, validación, canje)
  referrals.js           → programa de referidos
  auth.js                → registro, login, Google OAuth, verificación email
  profile.js             → perfil de usuario (diseños, pedidos, resumen)
  newsletter.js          → suscripción a newsletter
  admin.js               → dashboard, toggle AI, revisión pedidos, A/B testing

services/
  openai.js              → moderación (omni-moderation-latest) + imagen (gpt-image-1)
  storage.js             → Cloudflare R2 (S3-compatible)
  printful.js            → pedidos, mockups, tracking
  stripe.js              → Stripe SDK wrapper
  order-processing.js    → lógica central de pedido (idempotente)
  variants.js            → resolución product → color → talla → variant_id
  idempotency.js         → deduplicación SQLite
  auth.js                → usuarios, sesiones, scrypt, Google OAuth2
  design-history.js      → historial de diseños por usuario/sesión
  watermark.js           → watermark en previews + mapping preview→producción
  generation-tracker.js  → conteo hora/día, circuit breaker, daily cap
  rate-limiter.js        → rate limiting por IP (SQLite)
  session-limiter.js     → límite generaciones por sesión anónima
  browser-fingerprint.js → fingerprinting anti-botnet
  captcha.js             → Cloudflare Turnstile
  image-moderator.js     → moderación post-generación
  brand-filter.js        → blacklist de marcas registradas (100+)
  alerts.js              → alertas externas (email + webhook)
  email.js               → emails transaccionales (Resend)
  gift-cards.js          → tarjetas regalo (SQLite)
  referrals.js           → referidos (SQLite)
  newsletter.js          → suscriptores (SQLite)
  ab-testing.js          → A/B testing (SQLite)
  prompt-cache.js        → caché de prompts (SQLite, TTL 7 días)
  generation-queue.js    → cola asíncrona de generación (SQLite, FIFO)
  image-provider.js      → abstracción multi-proveedor (OpenAI default)
  registry.js            → service registry (DI)
  env.js                 → typed env getters con aliases
  layout-probe.js        → probe de layout Printful por producto

data/
  products.json          → catálogo (slug, nombre, precio, tallas, colores)
  variants-map.json      → product_key → color → talla → variant_id
  color-alias.json       → normalización de colores
  printful_product_ids.json → metadata Printful
  curated-designs.json   → 55 diseños curados (galería)
  collections.json       → 11 colecciones temáticas
  bundles.json           → reglas de precios por pack
  brand-blacklist.json   → marcas prohibidas (100+)
  pricing-model.json     → modelo de precios
  app.db                 → base de datos SQLite

public/                  → frontend standalone (vanilla HTML/CSS/JS)
  index.html             → homepage
  mi-cuenta.html         → perfil de usuario
  checkout-success.html  → pago completado
  checkout-cancel.html   → pago cancelado
  order-status.html      → estado de pedido
  terminos.html          → términos y condiciones
  privacidad.html        → política de privacidad
  cookies.html           → política de cookies
  admin/dashboard.html   → panel de administración
  css/                   → base.css, components.css, creator.css, auth.css, gallery.css, legal.css
  js/                    → app.js, catalog.js, creator.js, auth.js, gallery.js
```

---

## Tests

```bash
npm test
```

**290 tests** con `node:test` + `node:assert` (sin dependencias externas).

Las rutas usan factory pattern (`buildPreviewRouter()`, `buildCheckoutRouter()`, etc.) con inyección de dependencias para mocks — ningún test hace llamadas reales a APIs externas.

Los servicios exponen funciones `_reset*ForTests()` para limpiar singletons entre tests.

| Área | Tests |
|------|-------|
| Preview route | Generación, rate limiting, moderación, CAPTCHA, async |
| Checkout route | Sesiones Stripe, webhook, procesamiento de pedido |
| Catalog route | Lista productos, detalle, bundles |
| Gallery route | Filtros, colecciones, SSR, sitemap |
| Admin route | Dashboard, toggle AI, revisión pedidos, experiments, gift cards |
| Auth | Registro, login, verificación email, Google OAuth, quotas |
| Design history | Historial por usuario/sesión |
| Gift cards | Creación, validación, canje |
| Referrals | Códigos, stats |
| A/B testing | Experimentos, variantes, eventos |
| Cost hardening | Circuit breaker, daily cap, purchase bonus, URL mapping |
| Browser fingerprint | Detección de bots, botnets, rotación |
| Alerts | Email, webhook, cooldown |
| Rate limiter | Límites por IP |
| Session limiter | Límites por sesión |
| Generation tracker | Conteo hora/día, alertas |
| Captcha | Verificación Turnstile |
| Image moderator | Moderación post-generación |
| Watermark | Overlay + URL mapping |
| Email | Templates Resend |
| Prompt cache | Caché con TTL |
| Image provider | Abstracción multi-proveedor |
| Variants | Resolución de variantes |
| Brand filter | Blacklist de marcas |
| Service registry | Inyección de dependencias |
| Order processing | Lógica central de pedido |

---

## Modo sin IA

```env
AI_ENABLED=false
```

`POST /api/preview/image` devuelve `503 ai_disabled` sin llamar a OpenAI. Se puede activar/desactivar en caliente desde el admin dashboard.

---

## Convenciones clave

- **ES modules** en todo el proyecto (`"type": "module"` en package.json). Sin build step, sin TypeScript
- **Mensajes de error al usuario en español** (mercado objetivo España)
- Todas las respuestas API incluyen `{ ok: boolean }` en el top level
- El endpoint de mockup devuelve `mockup_status` en vez de códigos HTTP de error — el frontend hace polling
- Los pedidos son idempotentes: webhooks duplicados de Stripe se detectan vía SQLite
- `PRINTFUL_CONFIRM=false` deja los pedidos en borrador en Printful (recomendado para pruebas)
- Las previews llevan watermark; los filenames de producción son independientes y no derivables
- Si SQLite no está disponible, los servicios caen a in-memory con un warning en consola

---

## Dependencias principales

| Paquete | Uso |
|---------|-----|
| `express` | Framework web |
| `openai` | Cliente API OpenAI |
| `stripe` | Cliente API Stripe |
| `@aws-sdk/client-s3` | Cloudflare R2 (compatible S3) |
| `sharp` | Procesamiento de imágenes (watermark) |
| `cors` | Middleware CORS |
| `dotenv` | Carga de variables de entorno |

Módulos nativos de Node.js usados: `node:sqlite` (DatabaseSync), `node:crypto` (scrypt, timingSafeEqual), `node:test`, `node:assert`.

Requiere **Node.js 22+** (por `node:sqlite` DatabaseSync).
