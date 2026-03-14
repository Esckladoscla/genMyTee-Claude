import express from "express";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAFE_SLUG_RE = /^[a-z0-9-]+$/;

let _designsCache = null;
let _productsCache = null;
let _collectionsCache = null;

function loadDesigns() {
  if (!_designsCache) {
    const raw = readFileSync(
      join(__dirname, "..", "data", "curated-designs.json"),
      "utf8"
    );
    const designs = JSON.parse(raw).designs;
    for (const d of designs) {
      if (d.id && !SAFE_SLUG_RE.test(d.id)) {
        throw new Error(`Invalid design id: ${d.id}`);
      }
    }
    _designsCache = designs;
  }
  return _designsCache;
}

function loadProducts() {
  if (!_productsCache) {
    const raw = readFileSync(
      join(__dirname, "..", "data", "products.json"),
      "utf8"
    );
    _productsCache = JSON.parse(raw).products;
  }
  return _productsCache;
}

function loadCollections() {
  if (!_collectionsCache) {
    const raw = readFileSync(
      join(__dirname, "..", "data", "collections.json"),
      "utf8"
    );
    const collections = JSON.parse(raw).collections;
    for (const c of collections) {
      if (c.slug && !SAFE_SLUG_RE.test(c.slug)) {
        throw new Error(`Invalid collection slug: ${c.slug}`);
      }
    }
    _collectionsCache = collections;
  }
  return _collectionsCache;
}

/**
 * Renders a server-side HTML page for a design (SEO-indexable).
 */
function renderDesignPage(design, compatibleProducts, collections) {
  const collection = collections.find((c) => c.id === design.collection);
  const priceRange = compatibleProducts.length > 0
    ? `${Math.min(...compatibleProducts.map(p => p.base_price_eur))}–${Math.max(...compatibleProducts.map(p => p.base_price_eur))}`
    : "29–59";

  const productsHtml = compatibleProducts.map((p) => `
    <div class="ssr-product-card">
      <span class="ssr-product-emoji">${p.garment_emoji || "👕"}</span>
      <span class="ssr-product-name">${escapeHtml(p.name)}</span>
      <span class="ssr-product-price">€${p.base_price_eur.toFixed(2)}</span>
    </div>
  `).join("");

  const tagsHtml = design.tags.map((t) => `<span class="ssr-tag">${escapeHtml(t)}</span>`).join("");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${design.title} — genMyTee`,
    description: design.description,
    image: design.image_url || "https://genmytee.com/img/hero.png",
    url: `https://genmytee.com/galeria/${design.id}`,
    brand: { "@type": "Brand", name: "genMyTee" },
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "EUR",
      lowPrice: compatibleProducts.length > 0 ? Math.min(...compatibleProducts.map(p => p.base_price_eur)).toFixed(2) : "29.00",
      highPrice: compatibleProducts.length > 0 ? Math.max(...compatibleProducts.map(p => p.base_price_eur)).toFixed(2) : "59.00",
      availability: "https://schema.org/InStock",
      offerCount: compatibleProducts.length,
    },
    category: collection ? collection.name : "Diseños",
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: "https://genmytee.com/" },
      { "@type": "ListItem", position: 2, name: "Galería", item: "https://genmytee.com/#galeria" },
      ...(collection ? [{ "@type": "ListItem", position: 3, name: collection.name, item: `https://genmytee.com/galeria/coleccion/${collection.slug}` }] : []),
      { "@type": "ListItem", position: collection ? 4 : 3, name: design.title, item: `https://genmytee.com/galeria/${design.id}` },
    ],
  };

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"/>
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png"/>
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"/>
<title>${escapeHtml(design.title)} — Diseño exclusivo | genMyTee</title>
<meta name="description" content="${escapeHtml(design.description)}. Disponible en ${compatibleProducts.length} prendas desde €${priceRange}. Envío a toda Europa."/>
<meta name="keywords" content="${design.tags.map(t => escapeHtml(t)).join(", ")}, camiseta personalizada, diseño exclusivo, genMyTee"/>
<link rel="canonical" href="https://genmytee.com/galeria/${escapeHtml(design.id)}"/>
<meta property="og:title" content="${escapeHtml(design.title)} — genMyTee"/>
<meta property="og:description" content="${escapeHtml(design.description)}"/>
<meta property="og:type" content="product"/>
<meta property="og:url" content="https://genmytee.com/galeria/${escapeHtml(design.id)}"/>
<meta property="og:image" content="${escapeHtml(design.image_url || "https://genmytee.com/img/hero.png")}"/>
<meta property="og:site_name" content="genMyTee"/>
<meta property="og:locale" content="es_ES"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(design.title)} — genMyTee"/>
<meta name="twitter:description" content="${escapeHtml(design.description)}"/>
<meta name="twitter:image" content="${escapeHtml(design.image_url || "https://genmytee.com/img/hero.png")}"/>
<link rel="stylesheet" href="/fonts/fonts.css"/>
<link rel="stylesheet" href="/css/base.css"/>
<link rel="stylesheet" href="/css/components.css"/>
<link rel="stylesheet" href="/css/gallery.css"/>
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/<\//g, "<\\/")}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbLd).replace(/<\//g, "<\\/")}</script>
<style>
  .ssr-design-page { max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem; }
  .ssr-breadcrumb { font-size: 0.8rem; color: rgba(255,255,255,0.5); margin-bottom: 1.5rem; }
  .ssr-breadcrumb a { color: rgba(255,255,255,0.6); text-decoration: none; }
  .ssr-breadcrumb a:hover { color: var(--accent, #7c5cff); }
  .ssr-design-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
  .ssr-design-image { border-radius: 12px; overflow: hidden; background: rgba(255,255,255,0.05); aspect-ratio: 1; display: flex; align-items: center; justify-content: center; }
  .ssr-design-image img { width: 100%; height: 100%; object-fit: cover; }
  .ssr-design-placeholder { font-size: 4rem; }
  .ssr-design-info h1 { font-size: 1.8rem; margin: 0 0 0.5rem; color: #fff; }
  .ssr-design-desc { color: rgba(255,255,255,0.7); font-size: 1rem; line-height: 1.6; margin-bottom: 1rem; }
  .ssr-tags { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1.5rem; }
  .ssr-tag { background: rgba(255,255,255,0.08); border-radius: 12px; padding: 0.25rem 0.75rem; font-size: 0.75rem; color: rgba(255,255,255,0.6); }
  .ssr-price-range { font-size: 1.4rem; font-weight: 700; color: var(--accent, #7c5cff); margin-bottom: 1rem; }
  .ssr-products-title { font-size: 0.85rem; color: rgba(255,255,255,0.5); margin-bottom: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .ssr-products-grid { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; }
  .ssr-product-card { display: flex; align-items: center; gap: 0.4rem; background: rgba(255,255,255,0.06); border-radius: 8px; padding: 0.5rem 0.75rem; font-size: 0.8rem; color: rgba(255,255,255,0.8); }
  .ssr-product-price { color: var(--accent, #7c5cff); font-weight: 600; }
  .ssr-cta { display: inline-block; padding: 0.75rem 2rem; background: var(--accent, #7c5cff); color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; transition: transform 0.2s; }
  .ssr-cta:hover { transform: translateY(-2px); }
  .ssr-collection-link { margin-top: 1.5rem; }
  .ssr-collection-link a { color: var(--accent, #7c5cff); text-decoration: none; font-size: 0.85rem; }
  @media (max-width: 640px) {
    .ssr-design-layout { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<nav>
  <div class="nav-top">
    <a href="/" class="nav-logo">genMyTee</a>
    <ul class="nav-center">
      <li><a href="/#galeria">Galería</a></li>
      <li><a href="/#productos">Prendas</a></li>
      <li><a href="/#creador" style="color:var(--accent)">Crear mi prenda</a></li>
    </ul>
  </div>
</nav>
<div class="ssr-design-page">
  <div class="ssr-breadcrumb">
    <a href="/">Inicio</a> › <a href="/#galeria">Galería</a>${collection ? ` › <a href="/galeria/coleccion/${escapeHtml(collection.slug)}">${escapeHtml(collection.name)}</a>` : ""} › ${escapeHtml(design.title)}
  </div>
  <div class="ssr-design-layout">
    <div class="ssr-design-image">
      ${design.image_url
        ? `<img src="${escapeHtml(design.image_url)}" alt="${escapeHtml(design.title)}" />`
        : `<span class="ssr-design-placeholder">🎨</span>`}
    </div>
    <div class="ssr-design-info">
      <h1>${escapeHtml(design.title)}</h1>
      <p class="ssr-design-desc">${escapeHtml(design.description)}</p>
      <div class="ssr-tags">${tagsHtml}</div>
      <div class="ssr-price-range">Desde €${priceRange}</div>
      <div class="ssr-products-title">Disponible en ${compatibleProducts.length} prendas</div>
      <div class="ssr-products-grid">${productsHtml}</div>
      <a href="/#galeria" class="ssr-cta">Ver en la galería</a>
      ${collection ? `<div class="ssr-collection-link"><a href="/galeria/coleccion/${escapeHtml(collection.slug)}">← Ver toda la colección ${escapeHtml(collection.name)}</a></div>` : ""}
    </div>
  </div>
</div>
<footer>
  <div class="footer-grid" style="max-width:900px;margin:0 auto;padding:2rem 1.5rem;">
    <div>
      <div class="footer-logo">genMyTee</div>
      <p class="footer-about">Prendas únicas diseñadas desde tu imaginación.</p>
    </div>
  </div>
</footer>
<script async src="https://plausible.io/js/pa-rbsS4LC3PN6oDWmTJM0DS.js"></script>
</body>
</html>`;
}

/**
 * Renders collection listing page (SSR).
 */
function renderCollectionPage(collection, designs, allCollections) {
  const designsHtml = designs.map((d) => `
    <a href="/galeria/${escapeHtml(d.id)}" class="ssr-collection-card">
      <div class="ssr-card-img">
        ${d.image_url ? `<img src="${escapeHtml(d.image_url)}" alt="${escapeHtml(d.title)}" loading="lazy"/>` : `<span class="ssr-card-placeholder">🎨</span>`}
        ${d.featured ? `<span class="ssr-card-badge">Destacado</span>` : ""}
      </div>
      <div class="ssr-card-title">${escapeHtml(d.title)}</div>
      <div class="ssr-card-desc">${escapeHtml(d.description)}</div>
    </a>
  `).join("");

  const otherCollections = allCollections
    .filter((c) => c.id !== collection.id)
    .slice(0, 5)
    .map((c) => `<a href="/galeria/coleccion/${escapeHtml(c.slug)}" class="ssr-other-collection">${c.emoji} ${escapeHtml(c.name)}</a>`)
    .join("");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${collection.name} — genMyTee`,
    description: collection.description,
    url: `https://genmytee.com/galeria/coleccion/${collection.slug}`,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: designs.length,
      itemListElement: designs.map((d, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `https://genmytee.com/galeria/${d.id}`,
        name: d.title,
      })),
    },
  };

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"/>
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png"/>
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"/>
<title>Colección ${escapeHtml(collection.name)} — genMyTee</title>
<meta name="description" content="${escapeHtml(collection.description)} ${designs.length} diseños exclusivos disponibles."/>
<link rel="canonical" href="https://genmytee.com/galeria/coleccion/${escapeHtml(collection.slug)}"/>
<meta property="og:title" content="Colección ${escapeHtml(collection.name)} — genMyTee"/>
<meta property="og:description" content="${escapeHtml(collection.description)}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="https://genmytee.com/galeria/coleccion/${escapeHtml(collection.slug)}"/>
<meta property="og:image" content="${escapeHtml(designs.length > 0 && designs[0].image_url ? designs[0].image_url : "https://genmytee.com/img/hero.png")}"/>
<meta property="og:site_name" content="genMyTee"/>
<meta property="og:locale" content="es_ES"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="Colección ${escapeHtml(collection.name)} — genMyTee"/>
<meta name="twitter:description" content="${escapeHtml(collection.description)}"/>
<meta name="twitter:image" content="${escapeHtml(designs.length > 0 && designs[0].image_url ? designs[0].image_url : "https://genmytee.com/img/hero.png")}"/>
<link rel="stylesheet" href="/fonts/fonts.css"/>
<link rel="stylesheet" href="/css/base.css"/>
<link rel="stylesheet" href="/css/components.css"/>
<link rel="stylesheet" href="/css/gallery.css"/>
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/<\//g, "<\\/")}</script>
<style>
  .ssr-collection-page { max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem; }
  .ssr-collection-header { text-align: center; margin-bottom: 2rem; }
  .ssr-collection-header h1 { font-size: 2rem; color: #fff; margin: 0; }
  .ssr-collection-header .emoji { font-size: 2.5rem; margin-bottom: 0.5rem; display: block; }
  .ssr-collection-header p { color: rgba(255,255,255,0.6); font-size: 1rem; max-width: 500px; margin: 0.75rem auto 0; }
  .ssr-collection-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
  .ssr-collection-card { background: rgba(255,255,255,0.04); border-radius: 12px; overflow: hidden; text-decoration: none; transition: transform 0.2s; }
  .ssr-collection-card:hover { transform: translateY(-4px); }
  .ssr-card-img { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.03); position: relative; }
  .ssr-card-img img { width: 100%; height: 100%; object-fit: cover; }
  .ssr-card-placeholder { font-size: 3rem; }
  .ssr-card-badge { position: absolute; top: 8px; right: 8px; background: var(--accent, #7c5cff); color: #fff; font-size: 0.65rem; padding: 2px 8px; border-radius: 8px; }
  .ssr-card-title { color: #fff; font-weight: 600; font-size: 0.9rem; padding: 0.75rem 0.75rem 0.25rem; }
  .ssr-card-desc { color: rgba(255,255,255,0.5); font-size: 0.75rem; padding: 0 0.75rem 0.75rem; line-height: 1.4; }
  .ssr-other-collections { margin-top: 2rem; text-align: center; }
  .ssr-other-collections h3 { color: rgba(255,255,255,0.6); font-size: 0.85rem; margin-bottom: 0.75rem; }
  .ssr-other-collection { display: inline-block; margin: 0.25rem 0.3rem; padding: 0.4rem 0.8rem; background: rgba(255,255,255,0.06); border-radius: 16px; color: rgba(255,255,255,0.7); text-decoration: none; font-size: 0.8rem; }
  .ssr-other-collection:hover { background: rgba(255,255,255,0.1); }
  .ssr-back-link { text-align: center; margin-top: 1rem; }
  .ssr-back-link a { color: var(--accent, #7c5cff); text-decoration: none; }
</style>
</head>
<body>
<nav>
  <div class="nav-top">
    <a href="/" class="nav-logo">genMyTee</a>
    <ul class="nav-center">
      <li><a href="/#galeria">Galería</a></li>
      <li><a href="/#productos">Prendas</a></li>
      <li><a href="/#creador" style="color:var(--accent)">Crear mi prenda</a></li>
    </ul>
  </div>
</nav>
<div class="ssr-collection-page">
  <div class="ssr-collection-header">
    <span class="emoji">${collection.emoji || "🎨"}</span>
    <h1>Colección ${escapeHtml(collection.name)}</h1>
    <p>${escapeHtml(collection.description)}</p>
  </div>
  <div class="ssr-collection-grid">${designsHtml}</div>
  <div class="ssr-other-collections">
    <h3>Otras colecciones</h3>
    ${otherCollections}
  </div>
  <div class="ssr-back-link"><a href="/#galeria">← Volver a la galería</a></div>
</div>
<footer>
  <div class="footer-grid" style="max-width:900px;margin:0 auto;padding:2rem 1.5rem;">
    <div><div class="footer-logo">genMyTee</div></div>
  </div>
</footer>
<script async src="https://plausible.io/js/pa-rbsS4LC3PN6oDWmTJM0DS.js"></script>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildGalleryRouter({
  designsFn = loadDesigns,
  productsFn = loadProducts,
  collectionsFn = loadCollections,
} = {}) {
  const router = express.Router();

  // ── API endpoints ──

  router.get("/designs", (req, res) => {
    try {
      let designs = designsFn();
      const { tag, featured, collection } = req.query;

      if (tag) {
        const tagLower = tag.toLowerCase();
        designs = designs.filter((d) =>
          d.tags.some((t) => t.toLowerCase() === tagLower)
        );
      }

      if (featured === "true") {
        designs = designs.filter((d) => d.featured);
      }

      if (collection) {
        designs = designs.filter((d) => d.collection === collection);
      }

      const showAll = req.query.show_all === "true";
      if (!showAll) {
        designs = designs.filter((d) => d.image_url);
      }

      return res.json({ ok: true, designs, total: designs.length });
    } catch (error) {
      return res
        .status(500)
        .json({ ok: false, error: "gallery_unavailable" });
    }
  });

  router.get("/designs/:id", (req, res) => {
    try {
      const designs = designsFn();
      const design = designs.find((d) => d.id === req.params.id);
      if (!design) {
        return res
          .status(404)
          .json({ ok: false, error: "design_not_found" });
      }

      const allProducts = productsFn();
      const compatibleProducts = design.compatible_products
        .map((key) => allProducts.find((p) => p.product_key === key))
        .filter(Boolean)
        .map((p) => ({
          slug: p.slug,
          name: p.name,
          product_key: p.product_key,
          base_price_eur: p.base_price_eur,
          sizes: p.sizes,
          colors: p.colors,
          garment_emoji: p.garment_emoji,
          image_url: p.image_url,
          default_mockup_url: p.default_mockup_url,
        }));

      return res.json({ ok: true, design, compatible_products: compatibleProducts });
    } catch (error) {
      return res
        .status(500)
        .json({ ok: false, error: "gallery_unavailable" });
    }
  });

  // ── Collections API ──

  router.get("/collections", (_req, res) => {
    try {
      const collections = collectionsFn();
      const designs = designsFn();

      const enriched = collections
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => ({
          ...c,
          design_count: designs.filter((d) => d.collection === c.id).length,
        }));

      return res.json({ ok: true, collections: enriched });
    } catch (error) {
      return res.status(500).json({ ok: false, error: "gallery_unavailable" });
    }
  });

  // ── SSR design page ──

  router.get("/page/:id", (req, res) => {
    try {
      const designs = designsFn();
      const design = designs.find((d) => d.id === req.params.id);
      if (!design) {
        return res.status(404).send("Diseño no encontrado");
      }

      const allProducts = productsFn();
      const compatibleProducts = design.compatible_products
        .map((key) => allProducts.find((p) => p.product_key === key))
        .filter(Boolean);

      const collections = collectionsFn();
      const html = renderDesignPage(design, compatibleProducts, collections);
      res.type("html").send(html);
    } catch (error) {
      return res.status(500).send("Error cargando diseño");
    }
  });

  // ── SSR collection page ──

  router.get("/coleccion/:slug", (req, res) => {
    try {
      const collections = collectionsFn();
      const collection = collections.find((c) => c.slug === req.params.slug);
      if (!collection) {
        return res.status(404).send("Colección no encontrada");
      }

      const designs = designsFn().filter((d) => d.collection === collection.id);
      const html = renderCollectionPage(collection, designs, collections);
      res.type("html").send(html);
    } catch (error) {
      return res.status(500).send("Error cargando colección");
    }
  });

  // ── Sitemap (dynamic) ──

  router.get("/sitemap.xml", (_req, res) => {
    try {
      const designs = designsFn();
      const collections = collectionsFn();
      const now = new Date().toISOString().split("T")[0];

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

      // Homepage
      xml += `  <url><loc>https://genmytee.com/</loc><lastmod>${now}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;

      // Design pages (only those with images)
      for (const d of designs.filter(d => d.image_url)) {
        xml += `  <url><loc>https://genmytee.com/galeria/${escapeHtml(d.id)}</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
      }

      // Collection pages
      for (const c of collections) {
        xml += `  <url><loc>https://genmytee.com/galeria/coleccion/${escapeHtml(c.slug)}</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
      }

      // Static pages
      for (const page of ["terminos.html", "privacidad.html", "cookies.html", "order-status.html"]) {
        xml += `  <url><loc>https://genmytee.com/${page}</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>\n`;
      }

      xml += `</urlset>`;

      res.type("application/xml").send(xml);
    } catch (error) {
      return res.status(500).send("");
    }
  });

  return router;
}

export function _resetGalleryForTests() {
  _designsCache = null;
  _productsCache = null;
  _collectionsCache = null;
}

const router = buildGalleryRouter();
export default router;
