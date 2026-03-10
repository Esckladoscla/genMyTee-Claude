/* ══════════════════════════════
   CATALOG — Fetch and render products
══════════════════════════════ */

let catalogProducts = [];

async function loadCatalog() {
  try {
    const res = await fetch('/api/catalog/products');
    const data = await res.json();
    if (data.ok && data.products) {
      catalogProducts = data.products;
      renderProductGrid();
    }
  } catch (err) {
    console.error('[catalog] failed to load products', err);
  }
}

function renderProductGrid() {
  const grid = document.getElementById('productGrid');
  if (!grid) return;

  grid.innerHTML = '';

  const customizable = catalogProducts.filter(p => p.customizable);
  for (const product of customizable) {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.innerHTML = `
      <div class="product-image">
        <span class="product-tag">Personalizable</span>
        <span class="product-emoji">${product.garment_emoji || '\uD83D\uDC55'}</span>
      </div>
      <div class="product-info">
        <div class="product-cat">${escapeHtml(product.garment_type || 'prenda')}</div>
        <div class="product-name">${escapeHtml(product.name)}</div>
        <div class="product-price">\u20AC${product.base_price_eur.toFixed(2)}</div>
      </div>
    `;
    card.addEventListener('click', () => {
      // Scroll to creator and pre-select this product
      const creatorSection = document.getElementById('creador');
      if (creatorSection) {
        creatorSection.scrollIntoView({ behavior: 'smooth' });
        // Pre-select the garment type after scroll
        setTimeout(() => {
          if (window.selectProduct) window.selectProduct(product.slug);
        }, 500);
      }
    });
    grid.appendChild(card);
  }
}

// Export for creator.js
window.getCatalogProducts = () => catalogProducts;

document.addEventListener('DOMContentLoaded', loadCatalog);
