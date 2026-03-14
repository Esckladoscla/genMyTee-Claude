import express from "express";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _articlesCache = null;

function loadArticles() {
  if (!_articlesCache) {
    const raw = readFileSync(
      join(__dirname, "..", "data", "blog-articles.json"),
      "utf8"
    );
    _articlesCache = JSON.parse(raw).articles;
  }
  return _articlesCache;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderBlogListing(articles) {
  const articlesHtml = articles.map((a) => `
    <a href="/blog/${escapeHtml(a.slug)}" class="blog-card">
      <div class="blog-card-content">
        <div class="blog-card-date">${escapeHtml(a.published_at)}</div>
        <h2 class="blog-card-title">${escapeHtml(a.title)}</h2>
        <p class="blog-card-desc">${escapeHtml(a.description)}</p>
        <div class="blog-card-tags">${a.tags.map(t => `<span class="blog-tag">${escapeHtml(t)}</span>`).join("")}</div>
      </div>
    </a>
  `).join("");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Blog — genMyTee",
    description: "Guías, consejos e inspiración para tus prendas personalizadas.",
    url: "https://genmytee.com/blog",
    publisher: { "@type": "Organization", name: "genMyTee", url: "https://genmytee.com" },
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
<title>Blog — genMyTee</title>
<meta name="description" content="Guías, consejos e inspiración para tus prendas personalizadas. Tallas, cuidado de prendas, ideas de diseño y más."/>
<link rel="canonical" href="https://genmytee.com/blog"/>
<meta property="og:title" content="Blog — genMyTee"/>
<meta property="og:description" content="Guías, consejos e inspiración para tus prendas personalizadas."/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="https://genmytee.com/blog"/>
<meta property="og:image" content="https://genmytee.com/img/hero.png"/>
<meta property="og:site_name" content="genMyTee"/>
<meta property="og:locale" content="es_ES"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="Blog — genMyTee"/>
<meta name="twitter:description" content="Guías, consejos e inspiración para tus prendas personalizadas."/>
<meta name="twitter:image" content="https://genmytee.com/img/hero.png"/>
<link rel="stylesheet" href="/fonts/fonts.css"/>
<link rel="stylesheet" href="/css/base.css"/>
<link rel="stylesheet" href="/css/components.css"/>
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/<\//g, "<\\/")}</script>
<style>
  .blog-page { max-width: 800px; margin: 0 auto; padding: 6rem 1.5rem 3rem; }
  .blog-header { text-align: center; margin-bottom: 3rem; }
  .blog-header h1 { font-size: 2rem; color: #fff; margin: 0 0 0.75rem; }
  .blog-header p { color: rgba(255,255,255,0.6); font-size: 1rem; margin: 0; }
  .blog-breadcrumb { font-size: 0.8rem; color: rgba(255,255,255,0.5); margin-bottom: 1.5rem; }
  .blog-breadcrumb a { color: rgba(255,255,255,0.6); text-decoration: none; }
  .blog-breadcrumb a:hover { color: var(--accent); }
  .blog-list { display: flex; flex-direction: column; gap: 1.5rem; }
  .blog-card { display: block; background: rgba(255,255,255,0.04); border-radius: 12px; padding: 1.5rem; text-decoration: none; transition: transform 0.2s, background 0.2s; }
  .blog-card:hover { transform: translateY(-2px); background: rgba(255,255,255,0.07); }
  .blog-card-date { font-size: 0.75rem; color: rgba(255,255,255,0.4); margin-bottom: 0.5rem; }
  .blog-card-title { font-size: 1.3rem; color: #fff; font-weight: 600; margin: 0 0 0.5rem; }
  .blog-card-desc { color: rgba(255,255,255,0.6); font-size: 0.9rem; line-height: 1.5; margin: 0 0 0.75rem; }
  .blog-card-tags { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .blog-tag { background: rgba(255,255,255,0.08); border-radius: 12px; padding: 0.2rem 0.6rem; font-size: 0.7rem; color: rgba(255,255,255,0.5); }
  .blog-cta { text-align: center; margin-top: 3rem; padding: 2rem; background: rgba(255,255,255,0.04); border-radius: 12px; }
  .blog-cta p { color: rgba(255,255,255,0.6); font-size: 0.9rem; margin: 0 0 1rem; }
  .blog-cta a { display: inline-block; padding: 0.6rem 1.5rem; background: var(--accent); color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; }
</style>
</head>
<body>
<nav>
  <div class="nav-top">
    <a href="/" class="nav-logo">genMyTee</a>
    <ul class="nav-center">
      <li><a href="/#galeria">Galería</a></li>
      <li><a href="/#productos">Prendas</a></li>
      <li><a href="/blog" style="color:var(--accent)">Blog</a></li>
      <li><a href="/#creador">Crear mi prenda</a></li>
    </ul>
  </div>
</nav>
<div class="blog-page">
  <div class="blog-breadcrumb"><a href="/">Inicio</a> › Blog</div>
  <div class="blog-header">
    <h1>Blog</h1>
    <p>Guías, consejos e inspiración para tus prendas personalizadas.</p>
  </div>
  <div class="blog-list">${articlesHtml}</div>
  <div class="blog-cta">
    <p>¿Listo para crear tu prenda única?</p>
    <a href="/#creador">Crear mi prenda</a>
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

function renderArticlePage(article) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    author: { "@type": "Organization", name: "genMyTee" },
    publisher: { "@type": "Organization", name: "genMyTee", url: "https://genmytee.com" },
    datePublished: article.published_at,
    url: `https://genmytee.com/blog/${article.slug}`,
    mainEntityOfPage: `https://genmytee.com/blog/${article.slug}`,
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
<title>${escapeHtml(article.title)} — genMyTee</title>
<meta name="description" content="${escapeHtml(article.description)}"/>
<link rel="canonical" href="https://genmytee.com/blog/${escapeHtml(article.slug)}"/>
<meta property="og:title" content="${escapeHtml(article.title)} — genMyTee"/>
<meta property="og:description" content="${escapeHtml(article.description)}"/>
<meta property="og:type" content="article"/>
<meta property="og:url" content="https://genmytee.com/blog/${escapeHtml(article.slug)}"/>
<meta property="og:image" content="${escapeHtml(article.image_url || "https://genmytee.com/img/hero.png")}"/>
<meta property="og:site_name" content="genMyTee"/>
<meta property="og:locale" content="es_ES"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(article.title)} — genMyTee"/>
<meta name="twitter:description" content="${escapeHtml(article.description)}"/>
<meta name="twitter:image" content="${escapeHtml(article.image_url || "https://genmytee.com/img/hero.png")}"/>
<link rel="stylesheet" href="/fonts/fonts.css"/>
<link rel="stylesheet" href="/css/base.css"/>
<link rel="stylesheet" href="/css/components.css"/>
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/<\//g, "<\\/")}</script>
<style>
  .blog-article-page { max-width: 720px; margin: 0 auto; padding: 6rem 1.5rem 3rem; }
  .blog-breadcrumb { font-size: 0.8rem; color: rgba(255,255,255,0.5); margin-bottom: 1.5rem; }
  .blog-breadcrumb a { color: rgba(255,255,255,0.6); text-decoration: none; }
  .blog-breadcrumb a:hover { color: var(--accent); }
  .blog-article-header { margin-bottom: 2rem; }
  .blog-article-header h1 { font-size: 2rem; color: #fff; margin: 0 0 0.75rem; line-height: 1.3; }
  .blog-article-meta { color: rgba(255,255,255,0.4); font-size: 0.8rem; display: flex; align-items: center; gap: 1rem; }
  .blog-article-tags { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.75rem; }
  .blog-tag { background: rgba(255,255,255,0.08); border-radius: 12px; padding: 0.2rem 0.6rem; font-size: 0.7rem; color: rgba(255,255,255,0.5); }
  .blog-article-body { color: rgba(255,255,255,0.8); font-size: 1rem; line-height: 1.8; }
  .blog-article-body h2 { color: #fff; font-size: 1.4rem; margin: 2rem 0 0.75rem; }
  .blog-article-body h3 { color: #fff; font-size: 1.15rem; margin: 1.5rem 0 0.5rem; }
  .blog-article-body p { margin: 0 0 1rem; }
  .blog-article-body ul, .blog-article-body ol { margin: 0 0 1rem; padding-left: 1.5rem; }
  .blog-article-body li { margin-bottom: 0.5rem; }
  .blog-article-body a { color: var(--accent); text-decoration: underline; }
  .blog-article-body strong { color: #fff; }
  .blog-table { width: 100%; border-collapse: collapse; margin: 1rem 0 1.5rem; font-size: 0.9rem; }
  .blog-table th { background: rgba(255,255,255,0.08); color: #fff; padding: 0.6rem 0.75rem; text-align: left; font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.1); }
  .blog-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05); color: rgba(255,255,255,0.7); }
  .blog-table tr:hover td { background: rgba(255,255,255,0.03); }
  .blog-article-cta { text-align: center; margin-top: 3rem; padding: 2rem; background: rgba(255,255,255,0.04); border-radius: 12px; }
  .blog-article-cta p { color: rgba(255,255,255,0.6); font-size: 0.95rem; margin: 0 0 1rem; }
  .blog-article-cta a { display: inline-block; padding: 0.65rem 1.5rem; background: var(--accent); color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; }
  .blog-back { margin-top: 2rem; }
  .blog-back a { color: var(--accent); text-decoration: none; font-size: 0.85rem; }
</style>
</head>
<body>
<nav>
  <div class="nav-top">
    <a href="/" class="nav-logo">genMyTee</a>
    <ul class="nav-center">
      <li><a href="/#galeria">Galería</a></li>
      <li><a href="/#productos">Prendas</a></li>
      <li><a href="/blog" style="color:var(--accent)">Blog</a></li>
      <li><a href="/#creador">Crear mi prenda</a></li>
    </ul>
  </div>
</nav>
<div class="blog-article-page">
  <div class="blog-breadcrumb"><a href="/">Inicio</a> › <a href="/blog">Blog</a> › ${escapeHtml(article.title)}</div>
  <div class="blog-article-header">
    <h1>${escapeHtml(article.title)}</h1>
    <div class="blog-article-meta">
      <span>${escapeHtml(article.published_at)}</span>
      <span>Por ${escapeHtml(article.author)}</span>
    </div>
    <div class="blog-article-tags">${article.tags.map(t => `<span class="blog-tag">${escapeHtml(t)}</span>`).join("")}</div>
  </div>
  <div class="blog-article-body">${article.content_html}</div>
  <div class="blog-article-cta">
    <p>¿Ya sabes tu talla? Crea tu prenda personalizada</p>
    <a href="/#creador">Crear mi prenda</a>
  </div>
  <div class="blog-back"><a href="/blog">← Volver al blog</a></div>
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

export function buildBlogRouter({
  articlesFn = loadArticles,
} = {}) {
  const router = express.Router();

  // Blog listing
  router.get("/", (_req, res) => {
    try {
      const articles = articlesFn();
      const html = renderBlogListing(articles);
      res.type("html").send(html);
    } catch (error) {
      return res.status(500).send("Error cargando blog");
    }
  });

  // Individual article
  router.get("/:slug", (req, res) => {
    try {
      const articles = articlesFn();
      const article = articles.find((a) => a.slug === req.params.slug);
      if (!article) {
        return res.status(404).send("Artículo no encontrado");
      }
      const html = renderArticlePage(article);
      res.type("html").send(html);
    } catch (error) {
      return res.status(500).send("Error cargando artículo");
    }
  });

  return router;
}

export function _resetBlogForTests() {
  _articlesCache = null;
}

const router = buildBlogRouter();
export default router;
