---
id: research-2026-03-13-documentacion-completa
type: research
date: 2026-03-13
---

# Documentación Completa de genMyTee

**Scope:** Toda la aplicación — backend, frontend, infraestructura, base de datos, testing
**Backend:** inline (Agent tool exploration)

---

## 1. Visión General del Producto

**genMyTee** es una aplicación web standalone de ropa personalizada bajo demanda (print-on-demand). El flujo principal es:

1. El cliente describe un diseño en lenguaje natural
2. OpenAI (gpt-image-1) genera la imagen
3. Se sube a Cloudflare R2
4. Printful genera mockups del producto
5. El cliente paga con Stripe Checkout
6. El webhook de Stripe dispara la orden en Printful para producción y envío

**URL de producción:** https://genmytee.com
**Render URL:** https://getmytee.onrender.com
**Stack:** Node.js/Express · Stripe · OpenAI · Printful · Cloudflare R2 · SQLite · Render

---

## 2. Arquitectura del Sistema

### 2.1 Estructura de Directorios

```
genMyTee-Claude/
├── server.js              # Punto de entrada
├── app.js                 # Factory de Express app
├── package.json           # Dependencias (ES modules)
├── .env.example           # Variables de entorno documentadas
├── CLAUDE.md              # Instrucciones del proyecto
│
├── routes/                # Capa de rutas (API endpoints)
│   ├── preview.js         # Generación de imagen + mockups
│   ├── checkout.js        # Stripe Checkout + webhook
│   ├── orders.js          # Creación de órdenes genéricas
│   ├── catalog.js         # Catálogo de productos
│   ├── gallery.js         # Galería + SSR + SEO
│   ├── auth.js            # Autenticación de usuarios
│   ├── profile.js         # Perfil de usuario
│   ├── admin.js           # Panel de administración
│   ├── newsletter.js      # Suscripción email
│   ├── gift-cards.js      # Tarjetas regalo
│   └── referrals.js       # Códigos de referido
│
├── services/              # Capa de servicios (lógica de negocio)
│   ├── openai.js          # Generación de imagen + moderación
│   ├── storage.js         # Upload a Cloudflare R2
│   ├── printful.js        # API de Printful (órdenes + mockups)
│   ├── stripe.js          # API de Stripe
│   ├── order-processing.js # Core de procesamiento de órdenes
│   ├── variants.js        # Resolución de variantes Printful
│   ├── idempotency.js     # Deduplicación de órdenes (SQLite)
│   ├── auth.js            # Autenticación (scrypt, OAuth, sesiones)
│   ├── design-history.js  # Historial de diseños por usuario
│   ├── gift-cards.js      # Tarjetas regalo digitales
│   ├── email.js           # Emails transaccionales (Resend)
│   ├── newsletter.js      # Suscriptores newsletter
│   ├── ab-testing.js      # Framework A/B testing
│   ├── captcha.js         # Cloudflare Turnstile
│   ├── image-moderator.js # Moderación post-generación
│   ├── generation-queue.js # Cola async de generación
│   ├── prompt-cache.js    # Cache prompt→imagen
│   ├── image-provider.js  # Abstracción de proveedor
│   ├── watermark.js       # Watermark en previews
│   ├── rate-limiter.js    # Rate limiting por IP
│   ├── session-limiter.js # Límites por sesión
│   ├── generation-tracker.js # Stats de generación
│   ├── layout-probe.js   # Detección features Printful
│   ├── registry.js        # Service registry (DI)
│   └── env.js             # Getters tipados de env vars
│
├── data/                  # Datos estáticos + SQLite
│   ├── products.json      # Catálogo de productos
│   ├── variants-map.json  # Mapa producto→variante Printful
│   ├── curated-designs.json # 55 diseños curados
│   ├── collections.json   # 11 colecciones temáticas
│   ├── bundles.json       # Reglas de packs/bundles
│   ├── color-alias.json   # Normalización de colores
│   ├── brand-blacklist.json # Filtro de marcas
│   └── app.db             # Base de datos SQLite
│
├── public/                # Frontend (vanilla HTML/CSS/JS)
│   ├── index.html         # Homepage
│   ├── mi-cuenta.html     # Perfil de usuario
│   ├── checkout-success.html # Confirmación de pago
│   ├── checkout-cancel.html  # Pago cancelado
│   ├── order-status.html  # Consulta de estado
│   ├── cookies.html       # Política de cookies
│   ├── privacidad.html    # Política de privacidad
│   ├── terminos.html      # Términos de servicio
│   ├── css/
│   │   ├── base.css       # Design system
│   │   ├── components.css # Componentes UI
│   │   ├── creator.css    # Panel de creación
│   │   ├── gallery.css    # Galería de diseños
│   │   └── auth.css       # Modal auth + perfil
│   ├── js/
│   │   ├── app.js         # Global (carrito, checkout, nav)
│   │   ├── catalog.js     # Grid de productos
│   │   ├── creator.js     # Flujo de diseño 4 pasos
│   │   ├── gallery.js     # Galería interactiva
│   │   └── auth.js        # Autenticación UI
│   └── admin/
│       └── dashboard.html # Panel admin
│
└── tests/                 # 279 tests (node:test)
    ├── run-tests.js       # Test runner
    └── *.test.js          # 32 archivos de test
```

### 2.2 Diagrama de Flujo Principal

```
Cliente → index.html
  ├── Selecciona prenda (catalog.js → /api/catalog/products)
  ├── Escribe prompt (creator.js)
  ├── Genera diseño → /api/preview/image
  │   ├── moderatePrompt() → OpenAI omni-moderation
  │   ├── generateImageFromPrompt() → OpenAI gpt-image-1
  │   ├── uploadImageBuffer() → Cloudflare R2 (preview/ + production/)
  │   └── saveDesign() → SQLite user_designs
  ├── Genera mockup → /api/preview/mockup
  │   └── generateMockupForVariant() → Printful API
  ├── Añade al carrito (localStorage)
  ├── Checkout → /api/checkout/session → Stripe Checkout
  └── Stripe webhook → /api/checkout/webhook
      ├── processOrder() → Printful createOrderSafe()
      ├── idempotency.markCompleted()
      └── sendOrderConfirmation() → Resend API
```

---

## 3. API — Referencia Completa de Endpoints

### 3.1 Preview (Generación de Imagen + Mockups)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/preview/image` | Genera imagen con IA desde un prompt |
| POST | `/api/preview/image/async` | Encola generación asíncrona |
| GET | `/api/preview/image/status` | Consulta estado de job async |
| POST | `/api/preview/mockup` | Genera mockup de producto con Printful |
| GET | `/api/preview/mockup/status` | Consulta estado del mockup |

**POST /api/preview/image**
```json
// Request
{
  "prompt": "Un gato astronauta en estilo acuarela",
  "product_key": "all-over-print-mens-athletic-t-shirt",
  "color": "Black",
  "size": "M",
  "captcha_token": "..." // Si CAPTCHA_ENABLED
}

// Response (200)
{
  "ok": true,
  "image_url": "https://assets.genmytee.com/production/xxx.png",
  "preview_url": "https://assets.genmytee.com/preview/xxx.png",
  "production_url": "https://assets.genmytee.com/production/xxx.png"
}

// Errores
// 422 — Violación de política de contenido
// 429 — Rate limit excedido
// 503 — AI_ENABLED=false
```

**POST /api/preview/mockup**
```json
// Request
{
  "image_url": "https://assets.genmytee.com/production/xxx.png",
  "variant_id": 12345,
  "placement": "front",
  "layout": { "scale": 1.0, "x": 0, "y": 0 },
  "mockup_result_indexes": [0, 1],
  "mockup_result_limit": 3
}

// Response (200)
{
  "ok": true,
  "mockup_status": "completed", // completed|processing|failed|skipped|rate_limited
  "mockups": [{ "url": "https://..." }],
  "task_key": "abc123"
}
```

### 3.2 Checkout (Stripe)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/checkout/session` | Crea sesión de Stripe Checkout |
| GET | `/api/checkout/status` | Estado del pedido |
| POST | `/api/checkout/webhook` | Webhook de Stripe |

**POST /api/checkout/session**
```json
// Request
{
  "items": [{
    "slug": "mens-tee",
    "product_key": "all-over-print-mens-athletic-t-shirt",
    "color": "Black",
    "size": "M",
    "quantity": 1,
    "price": 29.99,
    "image_url": "https://assets.genmytee.com/production/xxx.png",
    "layout": { "scale": 1.0, "x": 0, "y": 0 }
  }]
}

// Response (200)
{
  "ok": true,
  "url": "https://checkout.stripe.com/...",
  "session_id": "cs_xxx"
}
```

**GET /api/checkout/status?session_id=cs_xxx**
```json
{
  "ok": true,
  "payment_status": "paid",
  "email": "cliente@email.com",
  "fulfillment_status": "processing",
  "tracking": {
    "tracking_number": "...",
    "tracking_url": "...",
    "shipping_carrier": "..."
  }
}
```

### 3.3 Catálogo

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/catalog/products` | Lista todos los productos |
| GET | `/api/catalog/products/:slug` | Detalle de producto |
| GET | `/api/catalog/bundles` | Reglas de packs |

**GET /api/catalog/products**
```json
{
  "ok": true,
  "products": [{
    "slug": "mens-tee",
    "product_key": "all-over-print-mens-athletic-t-shirt",
    "name": "Camiseta Unisex",
    "base_price_eur": 29.99,
    "sizes": ["XS", "S", "M", "L", "XL", "XXL"],
    "colors": ["Black", "White"],
    "customizable": true,
    "placement": "front",
    "layout_support": { "supported": true }
  }]
}
```

### 3.4 Galería y Colecciones

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/gallery/designs` | Lista diseños curados (filtros: tag, featured, collection) |
| GET | `/api/gallery/designs/:id` | Detalle de diseño |
| GET | `/api/gallery/collections` | Lista colecciones con conteo |
| GET | `/galeria/:id` | Página SSR de diseño (SEO) |
| GET | `/galeria/coleccion/:slug` | Página SSR de colección |
| GET | `/sitemap.xml` | Sitemap dinámico |

**GET /api/gallery/designs?tag=animal&collection=naturaleza&featured=true&limit=12&offset=0**
```json
{
  "ok": true,
  "designs": [{
    "id": "design-001",
    "title": "Lobo Geométrico",
    "description": "...",
    "image_url": "https://...",
    "tags": ["animal", "geometrico"],
    "collection": "naturaleza",
    "featured": true,
    "compatible_products": ["all-over-print-mens-athletic-t-shirt"]
  }],
  "total": 55
}
```

### 3.5 Autenticación

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/register` | Registro con email/contraseña |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Usuario actual (o null) |
| POST | `/api/auth/verify-email/send` | Enviar código de verificación |
| POST | `/api/auth/verify-email/confirm` | Confirmar código |
| GET | `/api/auth/google` | Redirige a Google OAuth |
| GET | `/api/auth/google/callback` | Callback de OAuth |
| GET | `/api/auth/config` | Config pública (google_enabled) |

**POST /api/auth/register**
```json
// Request
{ "email": "user@email.com", "password": "min8chars", "name": "Juan" }

// Response (201)
{
  "ok": true,
  "user": {
    "id": "uuid",
    "email": "user@email.com",
    "name": "Juan",
    "email_verified": false
  },
  "needs_verification": true
}
// Set-Cookie: auth_token=xxx; HttpOnly; SameSite=Lax; Max-Age=2592000
```

**POST /api/auth/verify-email/confirm**
```json
// Request (requiere auth cookie)
{ "code": "123456" }

// Response
{ "ok": true, "verified": true }
```

### 3.6 Perfil de Usuario

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| GET | `/api/profile/designs` | Historial de diseños | Requerida |
| GET | `/api/profile/orders` | Historial de pedidos (placeholder) | Requerida |
| GET | `/api/profile/summary` | Resumen del perfil | Requerida |

### 3.7 Tarjetas Regalo

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/gift-cards/amounts` | Importes disponibles: [25, 50, 75, 100] EUR |
| POST | `/api/gift-cards/purchase` | Comprar tarjeta regalo |
| GET | `/api/gift-cards/validate?code=GMT-XXXX-XXXX-XXXX` | Validar código |
| POST | `/api/gift-cards/redeem` | Canjear tarjeta |

### 3.8 Referidos

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/referrals/generate` | Genera código de referido |
| GET | `/api/referrals/validate?code=xxx` | Valida código + registra visita |
| GET | `/api/referrals/stats?email=xxx` | Stats de visitas + conversiones |

### 3.9 Newsletter

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/newsletter` | Suscribir email |

### 3.10 Admin

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| GET | `/api/admin/dashboard` | Métricas completas | ADMIN_SECRET |
| POST | `/api/admin/ai` | Toggle AI on/off | ADMIN_SECRET |
| GET | `/api/admin/ai` | Estado actual de AI | ADMIN_SECRET |
| GET | `/api/admin/openai/usage` | Log de uso OpenAI | ADMIN_SECRET |
| GET | `/api/admin/stats` | Stats de generación | ADMIN_SECRET |
| GET | `/api/admin/orders` | Revisión de órdenes | ADMIN_SECRET |
| GET | `/api/admin/experiments` | Resultados A/B | ADMIN_SECRET |
| GET | `/api/admin/gift-cards` | Lista tarjetas regalo | ADMIN_SECRET |
| POST | `/api/admin/gallery/batch-generate` | Generación batch | ADMIN_SECRET |

### 3.11 A/B Testing

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/ab/assign?experiment=xxx&session=xxx` | Asigna variante |
| POST | `/api/ab/track` | Registra evento de conversión |

### 3.12 Health

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Health check |

---

## 4. Servicios — Detalle de Implementación

### 4.1 OpenAI (`services/openai.js`)

- **Moderación de prompts:** `moderatePrompt(prompt)` usa `omni-moderation-latest` para detectar contenido inapropiado
- **Generación de imagen:** `generateImageFromPrompt(prompt)` usa `gpt-image-1`
- **Normalización:** prompts de 8-280 caracteres, tamaños: 1024x1024, 1024x1536, 1536x1024, auto
- **Reintentos:** configurable vía `OPENAI_IMAGE_GENERATION_RETRIES` (default 2), para errores transientes (408/429/500-504)
- **Tracking de uso:** log en memoria (últimos 500 eventos) con timestamps y costes estimados

### 4.2 Almacenamiento R2 (`services/storage.js`)

- Sube buffers a Cloudflare R2 via API S3-compatible
- Carpetas: `preview/` (con watermark) y `production/` (limpia para Printful)
- Cache-Control: `public, max-age=31536000, immutable`
- URL pública: `R2_PUBLIC_BASE_URL` (assets.genmytee.com)

### 4.3 Printful (`services/printful.js`)

- **Órdenes:** `createOrderSafe()` con fallback para stitch_color
- **Mockups:** pipeline completo: crear task → polling → devolver URLs
- **Layout:** normalización de escala [0.30, 1.35], offsets [-100, 100], cálculo de posiciones en píxeles
- **Filtrado de mockups:** por índices, límite, y grupos de opciones
- **Rate limiting:** detecta 429 de Printful y devuelve "processing"

### 4.4 Stripe (`services/stripe.js`)

- **Checkout:** sesiones en EUR con metadata de producto (product_key, color, size, image_url, layout)
- **Envío:** recopila dirección + teléfono. Países: ES, FR, DE, IT, PT, NL, BE, AT, IE, GB, US, CA, MX
- **Webhook:** verificación de firma + extracción de datos del pedido
- **Configuración:** claves TEST activas en Render, LIVE configuradas pero inactivas

### 4.5 Procesamiento de Órdenes (`services/order-processing.js`)

- `buildPrintfulItems()` convierte items genéricos a formato Printful
- `processOrder()` ejecuta el pipeline completo con idempotencia
- Soporta formatos genéricos `{product_key, color, size}` y legacy Shopify

### 4.6 Autenticación (`services/auth.js`)

- **Hash de contraseña:** scrypt (cost=16384, keylen=64, block_size=8)
- **Sesiones:** token aleatorio, 30 días de expiración, cookie HttpOnly
- **Verificación email:** código de 6 dígitos, 30 minutos de expiración
- **Google OAuth2:** intercambio de código → userinfo → upsert de usuario
- **Cuota de generación:** tracking por usuario (`generation_count`)
- **Comparación timing-safe:** para tokens y códigos

### 4.7 Historial de Diseños (`services/design-history.js`)

- Almacena prompt + preview_url + production_url por usuario/sesión
- `linkDesignsToUser()` migra diseños anónimos al registrarse
- Paginación con limit/offset

### 4.8 Tarjetas Regalo (`services/gift-cards.js`)

- Códigos formato `GMT-XXXX-XXXX-XXXX`
- Importes: €25, €50, €75, €100
- Expiración: 1 año desde creación
- Estados: pending → active → redeemed

### 4.9 Email Transaccional (`services/email.js`)

- Proveedor: Resend API
- Templates: order_confirmation, order_shipped, gift_card, email_verification, review_request
- Configurable: `EMAIL_ENABLED` (default false), `EMAIL_FROM` (pedidos@genmytee.com)

### 4.10 A/B Testing (`services/ab-testing.js`)

- Asignación determinista: hash SHA256 del session_id
- Tracking de eventos: click, conversion, etc.
- Agregación de resultados por variante
- Configurable: `AB_TESTING_ENABLED` (default false)

### 4.11 Seguridad y Control de Costes

- **CAPTCHA:** Cloudflare Turnstile invisible (`CAPTCHA_ENABLED`)
- **Rate Limiting:** por IP (global) + por sesión (generaciones)
- **Moderación:** prompt pre-generación + imagen post-generación
- **Brand blacklist:** filtro de marcas registradas
- **Circuit breaker:** auto-desactiva AI cuando las generaciones/hora superan el umbral (`CIRCUIT_BREAKER_THRESHOLD_PER_HOUR`, default 200). Se re-habilita automáticamente al cambiar de hora. Override manual via `POST /api/admin/ai`
- **Daily cap:** auto-desactiva AI cuando las generaciones/día superan el límite (`DAILY_GENERATION_CAP`, default 500). Se reinicia a medianoche UTC
- **Filenames independientes:** las imágenes de preview y producción usan nombres de archivo independientes aleatorios. La URL de producción NO es derivable desde la URL de preview. Mapping SQLite (`url_mappings`) con fallback legacy para imágenes antiguas
- **Bonus por compra:** al completar un checkout exitoso, se otorgan +10 generaciones (configurable vía `PURCHASE_GENERATION_BONUS`) tanto a usuarios autenticados como a sesiones anónimas

---

## 5. Base de Datos — Esquema SQLite

Todas las tablas viven en `data/app.db` (SQLite via `node:sqlite` DatabaseSync).

### 5.1 Usuarios y Autenticación

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  name TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  google_id TEXT,
  avatar_url TEXT,
  generation_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE email_verifications (
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### 5.2 Pedidos

```sql
CREATE TABLE processed_orders (
  order_id TEXT PRIMARY KEY,
  external_id TEXT,
  printful_order_id TEXT,
  status TEXT NOT NULL,  -- processing, completed, failed, held
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  printful_status TEXT,
  tracking_number TEXT,
  tracking_url TEXT,
  shipping_carrier TEXT,
  tracking_updated_at TEXT,
  amount_cents INTEGER,
  currency TEXT
);
```

### 5.3 Diseños

```sql
CREATE TABLE user_designs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  session_id TEXT,
  prompt TEXT NOT NULL,
  preview_url TEXT,
  production_url TEXT,
  created_at TEXT NOT NULL
);
```

### 5.4 Tarjetas Regalo

```sql
CREATE TABLE gift_cards (
  code TEXT PRIMARY KEY,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  sender_email TEXT,
  recipient_email TEXT,
  recipient_name TEXT,
  message TEXT,
  stripe_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  redeemed_by_session TEXT,
  redeemed_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
```

### 5.5 Control de Costes (Sprint 10)

```sql
-- Tracking horario de generaciones + circuit breaker
CREATE TABLE generation_tracker (
  hour_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  alerted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Tracking diario de generaciones + daily cap
CREATE TABLE daily_generation_tracker (
  day_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  cap_triggered INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Mapping preview→production URLs (filenames independientes)
CREATE TABLE url_mappings (
  preview_url TEXT PRIMARY KEY,
  production_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### 5.6 Newsletter, Referidos, A/B Testing, Cache, Cola

```sql
CREATE TABLE newsletter_subscribers (email TEXT PRIMARY KEY, subscribed_at TEXT, source TEXT DEFAULT 'website');

CREATE TABLE referral_codes (code TEXT PRIMARY KEY, email TEXT, created_at TEXT);
CREATE TABLE referral_visits (id INTEGER PRIMARY KEY, code TEXT, visitor_session TEXT, visited_at TEXT, converted INTEGER, order_session_id TEXT);

CREATE TABLE ab_experiments (id TEXT PRIMARY KEY, name TEXT, variants TEXT, active INTEGER DEFAULT 1, created_at TEXT);
CREATE TABLE ab_assignments (experiment_id TEXT, session_id TEXT, variant TEXT, created_at TEXT, PRIMARY KEY(experiment_id, session_id));
CREATE TABLE ab_events (id INTEGER PRIMARY KEY AUTOINCREMENT, experiment_id TEXT, session_id TEXT, variant TEXT, event_type TEXT, created_at TEXT);

CREATE TABLE prompt_cache (prompt_hash TEXT PRIMARY KEY, prompt_normalized TEXT, image_url TEXT, hit_count INTEGER DEFAULT 0, created_at TEXT, last_hit_at TEXT);

CREATE TABLE generation_queue (job_id TEXT PRIMARY KEY, status TEXT DEFAULT 'pending', prompt TEXT, session_id TEXT, client_ip TEXT, result_url TEXT, error_message TEXT, retries INTEGER DEFAULT 0, created_at TEXT, started_at TEXT, completed_at TEXT);
```

---

## 6. Frontend — Páginas y Funcionalidades

### 6.1 Homepage (`index.html`)

**Secciones (en orden):**
1. **Navegación sticky** — Logo, enlaces (Galería, Prendas, Regalos, Crear), botón carrito con badge, menú hamburguesa móvil
2. **Hero** — "Tu imaginación, hecha prenda", CTAs: Ver diseños / Crear mi prenda, grid de ejemplos
3. **Trust badges** — Diseño único, Calidad premium, Envío 5-7 días, Devolución fácil
4. **Galería** — Diseños curados con filtros por colección y tag, modal de compra directa
5. **Productos** — Grid con filtro por categoría, click lleva al creator
6. **Creator** (sección principal) — Flujo de 4 pasos para diseñar
7. **FAQ** — Accordion con preguntas frecuentes
8. **Testimonios** — 3 reseñas con 5 estrellas
9. **Tarjetas regalo** — Selector de importes, formulario de envío
10. **Newsletter** — Suscripción por email
11. **Cookie banner** — Solo esenciales / Aceptar
12. **Footer** — Info, ayuda, legal, métodos de pago
13. **Cart drawer** — Panel lateral con items, subtotal, checkout

### 6.2 Flujo de Creación de Diseño (4 Pasos)

```
Paso 1: Selección de prenda
├── Botones por tipo de prenda (camiseta, sudadera, etc.)
├── Selector de color (swatches circulares)
└── Preview de la prenda seleccionada

Paso 2: Describir diseño
├── Textarea con contador (max 200 chars)
├── Chips de sugerencia ("Un gato astronauta", etc.)
├── Tabs: Diseñar / Estilos / Inspiración
│   ├── Estilos: acuarela, grabado, minimalista, etc.
│   └── Inspiración: items con emoji + descripción
└── Botón "Generar mi diseño" (requiere 5+ chars)

Paso 3: Preview + Mockup
├── Imagen generada por IA
├── Controles de layout:
│   ├── Escala: 30% - 135%
│   ├── Horizontal: -100 a +100
│   └── Vertical: -100 a +100
├── Botón "Ver mockup real" → genera mockup Printful
└── Galería de thumbnails del mockup

Paso 4: Talla + Carrito
├── Botones de talla (XS - XXL)
├── Controles de cantidad (± con número)
├── Precio dinámico (base × cantidad)
└── Botón "Añadir al carrito"
```

### 6.3 Galería (`gallery.js`)

- Carga 55 diseños curados + 11 colecciones desde la API
- **Filtros:** por colección (pills con emoji + nombre + conteo) y por tag
- **Cards:** imagen, título, descripción, tags, badge "Destacado"
- **Modal de compra directa:**
  - Imagen grande del diseño
  - Selector de producto compatible (chips con emoji + nombre + precio)
  - Selector de talla
  - Precio + botón "Añadir al carrito"

### 6.4 Carrito (`app.js`)

- **Persistencia:** localStorage
- **Funciones:** addToCart, removeFromCart, updateQty
- **Cart drawer:** panel lateral con lista de items, imagen, talla/color, controles de cantidad, subtotal
- **Bundle upsells:** detecta si el carrito aplica para descuento por pack
- **Checkout:** POST a `/api/checkout/session` → redirect a Stripe

### 6.5 Autenticación (`auth.js`)

- **Modal con tabs:** Registrarse / Iniciar sesión
- **Registro:** nombre (opcional), email, contraseña (8+ chars)
- **Login:** email + contraseña
- **Google OAuth:** botón "Continuar con Google"
- **Verificación email:** formulario de código 6 dígitos, reenvío, skip
- **Nav:** avatar con iniciales (logueado) o icono de login (anónimo)
- **Mensajes de error localizados** en español

### 6.6 Perfil (`mi-cuenta.html`)

- Header con avatar, nombre, email, badge verificado/no verificado
- Stats: diseños creados, pedidos
- Grid de diseños con thumbnails
- Banner de verificación de email si pendiente
- Botón logout

### 6.7 Otras Páginas

- **checkout-success.html** — Confirmación, referencia, sección de referidos (genera código + link compartible)
- **checkout-cancel.html** — Mensaje de pago cancelado, carrito preservado
- **order-status.html** — Formulario con session ID, muestra estado de pago/producción/envío con badges
- **cookies.html, privacidad.html, terminos.html** — Documentos legales completos

### 6.8 Design System

```css
/* Colores */
--bg: #F7F4F0         /* Crema (fondo) */
--surface: #EFEBE5     /* Beige claro */
--text: #1C1A18        /* Marrón oscuro */
--muted: #8C8680       /* Gris cálido */
--accent: #B5603F      /* Terracota (principal) */
--accent2: #D4896A     /* Terracota claro */
--green: #3D7A5A       /* Éxito */

/* Tipografía */
Headers: Cormorant Garamond (serif, light 300)
Body: DM Sans (sans-serif, 400)

/* Breakpoints responsive */
900px — Creator grid 1 columna
768px — Hero 1 columna, nav hamburguesa
600px — Perfil en columna
```

---

## 7. Variables de Entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `PORT` | Puerto del servidor | 3000 (Render: 10000) |
| `OPENAI_KEY` | API key de OpenAI | Requerida |
| `AI_ENABLED` | Activa/desactiva generación IA | true |
| `AI_IMAGE_SIZE` | Tamaño de imagen | auto |
| `R2_ACCOUNT_ID` | ID cuenta Cloudflare | Requerida |
| `R2_ACCESS_KEY_ID` | Clave acceso R2 | Requerida |
| `R2_SECRET_ACCESS_KEY` | Secret R2 | Requerida |
| `R2_BUCKET` | Bucket R2 | genmytee-printful |
| `R2_PUBLIC_BASE_URL` | URL pública R2 | assets.genmytee.com |
| `PRINTFUL_API_KEY` | API key Printful | Requerida |
| `PRINTFUL_CONFIRM` | Auto-confirmar órdenes | false |
| `PRINTFUL_STITCH_COLOR` | Color de costura | black |
| `STRIPE_SECRET_KEY` | Clave secreta Stripe | Requerida |
| `STRIPE_PUBLISHABLE_KEY` | Clave pública Stripe | Requerida |
| `STRIPE_WEBHOOK_SECRET` | Secreto del webhook | Requerida |
| `ALLOWED_ORIGINS` | Orígenes CORS (comma-separated) | localhost:3000,5173 |
| `DB_PATH` | Ruta SQLite | data/app.db |
| `EMAIL_ENABLED` | Activa emails transaccionales | false |
| `EMAIL_FROM` | Email remitente | pedidos@genmytee.com |
| `RESEND_API_KEY` | API key de Resend | — |
| `CAPTCHA_ENABLED` | Activa Turnstile | false |
| `CAPTCHA_SECRET_KEY` | Secret Turnstile | — |
| `CAPTCHA_SITE_KEY` | Site key Turnstile | — |
| `GOOGLE_CLIENT_ID` | Client ID Google OAuth | — |
| `GOOGLE_CLIENT_SECRET` | Client Secret OAuth | — |
| `GOOGLE_REDIRECT_URI` | Callback URL OAuth | — |
| `AB_TESTING_ENABLED` | Activa A/B testing | false |
| `IMAGE_MODERATION_ENABLED` | Moderación post-gen | false |
| `ADMIN_SECRET` | Contraseña panel admin | — |
| `REFERRAL_DISCOUNT_PCT` | Descuento referidos | 10 |
| `CIRCUIT_BREAKER_THRESHOLD_PER_HOUR` | Auto-disable AI a >N gen/hora | 200 |
| `DAILY_GENERATION_CAP` | Auto-disable AI a >N gen/día | 500 |
| `PURCHASE_GENERATION_BONUS` | Generaciones bonus tras compra | 10 |
| `GENERATION_ALERT_THRESHOLD_PER_HOUR` | Umbral de alerta (solo log) | 50 |

---

## 8. Guía de Uso

### 8.1 Instalación y Desarrollo Local

```bash
# Clonar y entrar
git clone https://github.com/Esckladoscla/genMyTee-Claude.git
cd genMyTee-Claude

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus claves reales

# Iniciar en modo desarrollo (auto-restart)
npm run dev

# O iniciar normalmente
npm start

# Abrir en navegador
# http://localhost:3000
```

### 8.2 Testing

```bash
# Ejecutar todos los tests (279 tests)
npm test

# Smoke tests (requiere servidor corriendo)
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-local.ps1
```

Los tests usan `node:test` + `node:assert` sin framework externo. Cada archivo de ruta exporta una función factory (`buildXxxRouter()`) que acepta mocks inyectados — nunca se hacen llamadas reales a APIs externas en tests.

### 8.3 Despliegue

- **Plataforma:** Render
- **Rama desplegada:** `development`
- **Flujo de trabajo:**
  1. Crear rama feature desde `development` (ej: `feat/sprint9-auth`)
  2. Desarrollar y hacer commits
  3. Crear PR hacia `development`
  4. Merge a `development` → deploy automático en Render
  5. **NUNCA** PR directo a `main`

### 8.4 Flujo de Trabajo Git

```bash
# Crear rama feature
git checkout development
git pull origin development
git checkout -b feat/mi-feature

# Desarrollar...
git add <archivos>
git commit -m "feat: descripción del cambio"

# Push y crear PR
git push -u origin feat/mi-feature
# Crear PR de feat/mi-feature → development
```

### 8.5 Panel de Administración

1. Navegar a `/admin/dashboard.html`
2. Introducir `ADMIN_SECRET` como contraseña
3. Funcionalidades disponibles:
   - KPIs: ingresos, pedidos, valor medio, conversión
   - Gráficas: generaciones por hora/día, uso OpenAI
   - Toggle AI on/off en tiempo real
   - Revisión de órdenes
   - Resultados de A/B tests
   - Lista de tarjetas regalo
   - Generación batch de imágenes para galería

### 8.6 Configuración de Stripe

**Modo test:**
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

**Webhook:** Configurar en Stripe Dashboard → Developers → Webhooks
- URL: `https://tu-dominio.com/api/checkout/webhook`
- Evento: `checkout.session.completed`

**Modo live:** Cambiar a claves `sk_live_` / `pk_live_` y activar webhook correspondiente.

### 8.7 Configuración de Google OAuth

1. Crear proyecto en Google Cloud Console
2. Configurar OAuth consent screen
3. Crear credenciales OAuth 2.0 (Web application)
4. Añadir redirect URI: `https://tu-dominio.com/api/auth/google/callback`
5. Configurar variables de entorno:
```
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=https://tu-dominio.com/api/auth/google/callback
```

### 8.8 Uso del Watermark y Protección de Assets

- **Preview (cliente):** Imagen con watermark visible → carpeta `previews/` en R2 (filename aleatorio independiente)
- **Producción (Printful):** Imagen limpia sin watermark → carpeta `production/` en R2 (filename aleatorio independiente)
- El watermark protege la imagen hasta que se paga
- **Seguridad:** Los filenames de preview y producción son independientes — NO se puede derivar la URL limpia desde la preview. El mapping se almacena en SQLite (`url_mappings`) y se resuelve internamente al crear órdenes en Printful
- URLs antiguas (pre-Sprint 10) siguen funcionando via fallback de reemplazo de carpeta

---

## 9. Patrones y Convenciones Clave

| Patrón | Descripción |
|--------|-------------|
| **Factory DI** | Todas las rutas: `buildXxxRouter({deps})` + instancia default con implementaciones reales |
| **Respuestas API** | Siempre `{ ok: boolean, ...data }` |
| **Idempotencia** | Webhooks duplicados de Stripe se detectan por order_id y devuelven `skipped: true` |
| **Mensajes en español** | Errores user-facing en la ruta preview en español (mercado objetivo) |
| **ES Modules** | `import/export` en todo el proyecto, `"type": "module"` en package.json |
| **SQLite sync** | `node:sqlite` DatabaseSync, fallback a `:memory:` si el archivo no está disponible |
| **Mockup polling** | Estado como string ("completed"/"processing"/etc.) en vez de códigos HTTP de error |
| **PRINTFUL_CONFIRM=false** | Órdenes NO se auto-confirman por seguridad |

---

## 10. Sprints Completados

| Sprint | Contenido | PR |
|--------|-----------|----|
| 1-2 | Protección de costes + conversión UX | #27 |
| 3 | Legal, operaciones y calidad | #28 |
| 4 | Crecimiento, retención, hardening | #29 |
| 5 | Técnico y escalabilidad | #30 |
| 6 | Seguridad avanzada | #31 |
| 7 | Dashboard, emails post-compra, A/B testing | #32 |
| 8 | Galería escalada, SEO avanzado, colecciones, tarjetas regalo | #33 |
| 9 | Auth usuarios, verificación email, Google OAuth, perfil y diseños | #34 |
| 10 P1 | Hardening costes: circuit breaker, daily cap, filenames independientes, bonus compra | #38 |

---

## 11. Dependencias del Proyecto

| Paquete | Versión | Uso |
|---------|---------|-----|
| express | ^4.19.2 | Framework web |
| openai | ^5.16.0 | Generación de imagen + moderación |
| @aws-sdk/client-s3 | ^3.878.0 | Upload a Cloudflare R2 |
| stripe | ^20.4.1 | Pagos |
| cors | ^2.8.5 | CORS middleware |
| dotenv | ^16.4.5 | Variables de entorno |
| sharp | ^0.34.5 | Procesamiento de imagen (watermark) |

Sin dependencias de desarrollo — todo nativo de Node.js (test, assert, sqlite).
