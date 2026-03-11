/* ══════════════════════════════
   CATALOG — Fetch and render products
══════════════════════════════ */

let catalogProducts = [];
let activeCategory = null;

const CATEGORY_LABELS = {
  camisetas: 'Camisetas',
  sudaderas: 'Sudaderas',
  pantalones: 'Pantalones',
  vestidos: 'Vestidos',
  bano: 'Baño',
  infantil: 'Infantil',
  bolsos: 'Bolsos',
  decoracion: 'Decoración',
  hogar: 'Hogar',
};

async function loadCatalog() {
  try {
    const res = await fetch('/api/catalog/products');
    const data = await res.json();
    if (data.ok && data.products) {
      catalogProducts = data.products;
      renderCategoryFilters();
      renderProductGrid();
    }
  } catch (err) {
    console.error('[catalog] failed to load products', err);
  }
}

function renderCategoryFilters() {
  const container = document.getElementById('categoryFilters');
  if (!container) return;

  const customizable = catalogProducts.filter(p => p.customizable);
  const categories = [...new Set(customizable.map(p => p.category).filter(Boolean))];

  container.innerHTML = '';

  // "Todos" button
  const allBtn = document.createElement('button');
  allBtn.className = 'cat-filter active';
  allBtn.textContent = 'Todos';
  allBtn.addEventListener('click', () => {
    activeCategory = null;
    container.querySelectorAll('.cat-filter').forEach(b => b.classList.remove('active'));
    allBtn.classList.add('active');
    renderProductGrid();
  });
  container.appendChild(allBtn);

  for (const cat of categories) {
    const btn = document.createElement('button');
    btn.className = 'cat-filter';
    btn.textContent = CATEGORY_LABELS[cat] || cat;
    btn.addEventListener('click', () => {
      activeCategory = cat;
      container.querySelectorAll('.cat-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderProductGrid();
    });
    container.appendChild(btn);
  }
}

function renderProductGrid() {
  const grid = document.getElementById('productGrid');
  if (!grid) return;

  grid.innerHTML = '';

  let products = catalogProducts.filter(p => p.customizable);
  if (activeCategory) {
    products = products.filter(p => p.category === activeCategory);
  }

  for (const product of products) {
    const card = document.createElement('div');
    card.className = 'product-card';
    const displayImg = product.default_mockup_url || product.image_url;
    const hasImage = !!displayImg;
    card.innerHTML = `
      <div class="product-image">
        <span class="product-tag">Personalizable</span>
        ${hasImage
          ? `<img class="product-photo" src="${displayImg}" alt="${escapeHtml(product.name)}" loading="lazy"
               onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
             <span class="product-emoji" style="display:none">${product.garment_emoji || '\uD83D\uDC55'}</span>`
          : `<span class="product-emoji">${product.garment_emoji || '\uD83D\uDC55'}</span>`}
      </div>
      <div class="product-info">
        <div class="product-cat">${escapeHtml(product.garment_type || 'prenda')}</div>
        <div class="product-name">${escapeHtml(product.name)}</div>
        <div class="product-price">\u20AC${product.base_price_eur.toFixed(2)}</div>
      </div>
    `;
    card.addEventListener('click', () => {
      const creatorSection = document.getElementById('creador');
      if (creatorSection) {
        creatorSection.scrollIntoView({ behavior: 'smooth' });
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
