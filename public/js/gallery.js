/* ══════════════════════════════
   GALLERY — Curated designs browsing + purchase
══════════════════════════════ */

let galleryDesigns = [];
let galleryCollections = [];
let activeGalleryTag = null;
let activeGalleryCollection = null;
let selectedModalDesign = null;
let selectedModalProduct = null;
let selectedModalSize = null;

async function loadGallery() {
  const section = document.getElementById('galeria');
  if (!section) return;

  try {
    const [designsRes, collectionsRes] = await Promise.all([
      fetch('/api/gallery/designs?show_all=true'),
      fetch('/api/gallery/collections'),
    ]);
    const designsData = await designsRes.json();
    const collectionsData = await collectionsRes.json();

    if (designsData.ok && designsData.designs) {
      galleryDesigns = designsData.designs;
    }
    if (collectionsData.ok && collectionsData.collections) {
      galleryCollections = collectionsData.collections;
    }

    renderCollectionChips();
    renderGalleryFilters();
    renderGalleryGrid();
    renderHeroExamples();
    injectGalleryStructuredData();
  } catch (err) {
    console.error('[gallery] failed to load designs', err);
  }
}

function renderGalleryFilters() {
  const container = document.getElementById('galleryFilters');
  if (!container) return;

  // Collect all unique tags
  const tagSet = new Set();
  for (const d of galleryDesigns) {
    for (const t of d.tags) tagSet.add(t);
  }
  const tags = [...tagSet].sort();

  container.innerHTML = '';

  // "Todos" button
  const allBtn = document.createElement('button');
  allBtn.className = 'gallery-tag-btn active';
  allBtn.textContent = 'Todos';
  allBtn.addEventListener('click', () => {
    activeGalleryTag = null;
    container.querySelectorAll('.gallery-tag-btn').forEach(b => b.classList.remove('active'));
    allBtn.classList.add('active');
    renderGalleryGrid();
  });
  container.appendChild(allBtn);

  const TAG_LABELS = {
    animal: 'Animal',
    geometrico: 'Geométrico',
    minimalista: 'Minimalista',
    naturaleza: 'Naturaleza',
    vintage: 'Vintage',
    japones: 'Japonés',
    floral: 'Floral',
    acuarela: 'Acuarela',
    espacio: 'Espacio',
    retro: 'Retro',
    cultural: 'Cultural',
    urbano: 'Urbano',
    cyberpunk: 'Cyberpunk',
    tattoo: 'Tattoo',
    mandala: 'Mandala',
    'blanco-negro': 'B&N',
    'linea-fina': 'Línea fina',
    neon: 'Neón',
    celestial: 'Celestial',
    noche: 'Noche',
    oceano: 'Océano',
    clasico: 'Clásico',
    calido: 'Cálido',
    scifi: 'Sci-Fi',
    colorido: 'Colorido',
    mexicano: 'Mexicano',
    dorado: 'Dorado',
    botanico: 'Botánico',
    placeholder: 'Otro',
    tribal: 'Tribal',
    steampunk: 'Steampunk',
    abstracto: 'Abstracto',
    musica: 'Música',
    montaña: 'Montaña',
  };

  for (const tag of tags) {
    if (tag === 'placeholder') continue;
    const btn = document.createElement('button');
    btn.className = 'gallery-tag-btn';
    btn.textContent = TAG_LABELS[tag] || tag;
    btn.addEventListener('click', () => {
      activeGalleryTag = tag;
      container.querySelectorAll('.gallery-tag-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderGalleryGrid();
    });
    container.appendChild(btn);
  }
}

function renderCollectionChips() {
  const section = document.getElementById('galeria');
  if (!section || galleryCollections.length === 0) return;

  // Insert collection row before the filters if not already present
  let row = document.getElementById('collectionChips');
  if (!row) {
    row = document.createElement('div');
    row.id = 'collectionChips';
    row.className = 'collection-chips';
    const filters = document.getElementById('galleryFilters');
    if (filters) filters.parentNode.insertBefore(row, filters);
  }

  row.innerHTML = '';

  // "Todos" chip
  const allChip = document.createElement('button');
  allChip.className = 'collection-chip active';
  allChip.textContent = 'Todas las colecciones';
  allChip.addEventListener('click', () => {
    activeGalleryCollection = null;
    row.querySelectorAll('.collection-chip').forEach(c => c.classList.remove('active'));
    allChip.classList.add('active');
    renderGalleryGrid();
  });
  row.appendChild(allChip);

  for (const col of galleryCollections) {
    const chip = document.createElement('a');
    chip.className = 'collection-chip';
    chip.href = `/galeria/coleccion/${col.slug}`;
    chip.innerHTML = `${col.emoji || ''} ${escapeHtml(col.name)} <span class="collection-count">${col.design_count}</span>`;
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      activeGalleryCollection = col.id;
      activeGalleryTag = null;
      row.querySelectorAll('.collection-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      // Reset tag filters
      const tagContainer = document.getElementById('galleryFilters');
      if (tagContainer) {
        tagContainer.querySelectorAll('.gallery-tag-btn').forEach(b => b.classList.remove('active'));
        const allBtn = tagContainer.querySelector('.gallery-tag-btn');
        if (allBtn) allBtn.classList.add('active');
      }
      renderGalleryGrid();
    });
    row.appendChild(chip);
  }
}

function renderGalleryGrid() {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;

  grid.innerHTML = '';

  let designs = galleryDesigns;
  if (activeGalleryCollection) {
    designs = designs.filter(d => d.collection === activeGalleryCollection);
  }
  if (activeGalleryTag) {
    designs = designs.filter(d => d.tags.includes(activeGalleryTag));
  }

  if (designs.length === 0) {
    grid.innerHTML = `
      <div class="gallery-empty" style="grid-column: 1 / -1">
        <div class="gallery-empty-icon">&#x1F3A8;</div>
        <p>No hay diseños en esta categoría todavía.</p>
      </div>
    `;
    return;
  }

  for (const design of designs) {
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.innerHTML = `
      <div class="gallery-card-img">
        ${design.featured ? '<span class="gallery-card-featured">Destacado</span>' : ''}
        ${design.image_url
          ? `<img src="${escapeHtml(design.image_url)}" alt="${escapeHtml(design.title)}" loading="lazy"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          : ''}
        <span class="gallery-placeholder" ${design.image_url ? 'style="display:none"' : ''}>&#x1F3A8;</span>
      </div>
      <div class="gallery-card-info">
        <div class="gallery-card-title">${escapeHtml(design.title)}</div>
        <div class="gallery-card-desc">${escapeHtml(design.description)}</div>
        <div class="gallery-card-tags">
          ${design.tags.map(t => `<span class="gallery-card-tag">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>
    `;
    card.addEventListener('click', () => openDesignModal(design));
    grid.appendChild(card);
  }
}

async function openDesignModal(design) {
  selectedModalDesign = design;
  selectedModalProduct = null;
  selectedModalSize = null;

  // Fetch compatible products
  let compatibleProducts = [];
  try {
    const res = await fetch(`/api/gallery/designs/${design.id}`);
    const data = await res.json();
    if (data.ok) {
      compatibleProducts = data.compatible_products || [];
    }
  } catch (err) {
    console.error('[gallery] failed to load design details', err);
  }

  const overlay = document.getElementById('galleryModalOverlay');
  if (!overlay) return;

  const modal = overlay.querySelector('.gallery-modal');
  modal.innerHTML = `
    <button class="gallery-modal-close" id="galleryModalClose">&times;</button>
    <div class="gallery-modal-image">
      ${design.image_url
        ? `<img src="${escapeHtml(design.image_url)}" alt="${escapeHtml(design.title)}"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ''}
      <span class="gallery-placeholder" ${design.image_url ? 'style="display:none"' : ''}>&#x1F3A8;</span>
    </div>
    <div class="gallery-modal-body">
      <div class="gallery-modal-title">${escapeHtml(design.title)}</div>
      <div class="gallery-modal-desc">${escapeHtml(design.description)}</div>

      ${compatibleProducts.length > 0 ? `
        <div class="gallery-product-label">Elige tu prenda</div>
        <div class="gallery-product-row" id="galleryProductRow">
          ${compatibleProducts.map(p => `
            <button class="gallery-product-chip" data-product-key="${p.product_key}">
              <span class="chip-emoji">${p.garment_emoji || '&#x1F455;'}</span>
              <span>${escapeHtml(p.name)}</span>
              <span class="chip-price">&euro;${p.base_price_eur.toFixed(2)}</span>
            </button>
          `).join('')}
        </div>

        <div id="gallerySizeSection" style="display:none">
          <div class="gallery-product-label">Elige tu talla</div>
          <div class="gallery-size-row" id="gallerySizeRow"></div>
        </div>

        <div class="gallery-modal-price">
          <span class="gallery-modal-price-value" id="galleryModalPrice">&euro;0.00</span>
          <button class="gallery-add-btn" id="galleryAddBtn" disabled>Añadir al carrito</button>
        </div>
      ` : `
        <div class="gallery-coming-soon">
          <div class="gallery-coming-soon-badge">Próximamente</div>
          <p>Este diseño estará disponible para comprar muy pronto.</p>
        </div>
      `}
    </div>
  `;

  // Bind close
  modal.querySelector('#galleryModalClose').addEventListener('click', closeDesignModal);

  // Bind product chips
  const productRow = modal.querySelector('#galleryProductRow');
  if (productRow) {
    productRow.querySelectorAll('.gallery-product-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const productKey = chip.dataset.productKey;
        const product = compatibleProducts.find(p => p.product_key === productKey);
        if (!product) return;

        selectedModalProduct = product;
        selectedModalSize = null;

        // Highlight selected
        productRow.querySelectorAll('.gallery-product-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');

        // Show sizes
        renderModalSizes(product);
        updateModalPrice();
      });
    });
  }

  // Bind add to cart
  const addBtn = modal.querySelector('#galleryAddBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => addGalleryDesignToCart(design));
  }

  overlay.classList.add('open');
}

function renderModalSizes(product) {
  const section = document.getElementById('gallerySizeSection');
  const row = document.getElementById('gallerySizeRow');
  if (!section || !row) return;

  section.style.display = 'block';
  row.innerHTML = '';

  for (const size of product.sizes) {
    const btn = document.createElement('button');
    btn.className = 'gallery-size-btn';
    btn.textContent = size;
    btn.addEventListener('click', () => {
      selectedModalSize = size;
      row.querySelectorAll('.gallery-size-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      updateModalPrice();
    });
    row.appendChild(btn);
  }
}

function updateModalPrice() {
  const priceEl = document.getElementById('galleryModalPrice');
  const addBtn = document.getElementById('galleryAddBtn');
  if (!priceEl || !addBtn) return;

  if (selectedModalProduct) {
    priceEl.textContent = `\u20AC${selectedModalProduct.base_price_eur.toFixed(2)}`;
  }

  addBtn.disabled = !(selectedModalProduct && selectedModalSize);
}

function addGalleryDesignToCart(design) {
  if (!selectedModalProduct || !selectedModalSize) return;

  const item = {
    name: `${selectedModalProduct.name} — ${design.title}`,
    slug: selectedModalProduct.slug,
    product_key: selectedModalProduct.product_key,
    size: selectedModalSize,
    color: selectedModalProduct.colors?.[0] || 'White',
    quantity: 1,
    price: selectedModalProduct.base_price_eur,
    image_url: design.image_url,
    emoji: selectedModalProduct.garment_emoji || '\uD83D\uDC55',
    mockup_url: null,
    product_image_url: selectedModalProduct.default_mockup_url || selectedModalProduct.image_url,
    layout: null,
    gallery_design_id: design.id,
  };

  if (window.addToCart) {
    window.addToCart(item);
  }

  closeDesignModal();
}

function closeDesignModal() {
  const overlay = document.getElementById('galleryModalOverlay');
  if (overlay) overlay.classList.remove('open');
  selectedModalDesign = null;
  selectedModalProduct = null;
  selectedModalSize = null;
}

function injectGalleryStructuredData() {
  // Inject JSON-LD for SEO
  const designsWithImages = galleryDesigns.filter(d => d.image_url);
  if (designsWithImages.length === 0) return;

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Galería de diseños exclusivos — genMyTee',
    description: 'Diseños exclusivos listos para llevar en camisetas, sudaderas y más.',
    numberOfItems: designsWithImages.length,
    itemListElement: designsWithImages.map((d, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: d.title,
        description: d.description,
        image: d.image_url,
        url: `https://genmytee.com/#galeria`,
        brand: { '@type': 'Brand', name: 'genMyTee' },
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'EUR',
          lowPrice: '29.00',
          highPrice: '59.00',
          availability: 'https://schema.org/InStock',
        },
      },
    })),
  };

  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(itemList);
  document.head.appendChild(script);
}

function renderHeroExamples() {
  const container = document.getElementById('heroExamples');
  if (!container) return;

  // Show featured designs in the hero area
  const featured = galleryDesigns.filter(d => d.featured).slice(0, 6);
  if (featured.length === 0) return;

  container.innerHTML = '';
  for (const design of featured) {
    const tile = document.createElement('div');
    tile.className = 'hero-example-tile';
    tile.innerHTML = `
      ${design.image_url
        ? `<img src="${escapeHtml(design.image_url)}" alt="${escapeHtml(design.title)}" loading="lazy"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ''}
      <span class="hero-example-placeholder" ${design.image_url ? 'style="display:none"' : ''}>
        &#x1F3A8;
      </span>
      <span class="hero-example-label">${escapeHtml(design.title)}</span>
    `;
    tile.addEventListener('click', () => {
      const section = document.getElementById('galeria');
      if (section) section.scrollIntoView({ behavior: 'smooth' });
    });
    container.appendChild(tile);
  }

  // Show the examples grid (hides hero-img)
  container.style.display = 'grid';
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  loadGallery();

  // Close modal on overlay click
  const overlay = document.getElementById('galleryModalOverlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDesignModal();
    });
  }
});
