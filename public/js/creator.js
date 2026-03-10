/* ══════════════════════════════
   CREATOR — 4-step design flow
══════════════════════════════ */

// ── State ──
let selectedProduct = null;
let selectedColor = null;
let selectedSize = null;
let selectedStyle = '';
let generatedImageUrl = null;
let currentStep = 1;
let panelQty = 1;

// ── Color hex map ──
const COLOR_HEX = {
  'Black': '#1C1A18',
  'White': '#FFFFFF',
  'Navy': '#2C3E60',
  'Sport Grey': '#B5AFA3',
  'Sand': '#C2B280',
  'Maroon': '#6B2C3B',
};

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  // Wait for catalog to load, then init creator
  setTimeout(initCreator, 300);
});

function initCreator() {
  initPanelTabs();
  initPromptInput();
  initPromptChips();
  initStylePresets();
  initInspoItems();
  initQuantityControls();
  initAddToCartButton();
  initGarmentTypes();
}

// ── Garment types from catalog ──
function initGarmentTypes() {
  const row = document.getElementById('garmentTypeRow');
  if (!row) return;

  const products = window.getCatalogProducts ? window.getCatalogProducts() : [];
  if (products.length === 0) {
    // Retry if catalog hasn't loaded yet
    setTimeout(initGarmentTypes, 300);
    return;
  }

  row.innerHTML = '';
  const customizable = products.filter(p => p.customizable);

  customizable.forEach((product, i) => {
    const btn = document.createElement('button');
    btn.className = 'g-type' + (i === 0 ? ' active' : '');
    btn.textContent = product.name.replace('Personalizada', '').replace('Personalizado', '').trim();
    btn.dataset.slug = product.slug;
    btn.addEventListener('click', () => {
      row.querySelectorAll('.g-type').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectProduct(product.slug);
    });
    row.appendChild(btn);
  });

  // Select first product
  if (customizable.length > 0) {
    selectProduct(customizable[0].slug);
  }
}

function selectProduct(slug) {
  const products = window.getCatalogProducts ? window.getCatalogProducts() : [];
  const product = products.find(p => p.slug === slug);
  if (!product) return;

  selectedProduct = product;
  selectedColor = null;
  selectedSize = null;

  // Update garment emoji
  const emojiEl = document.getElementById('garmentEmoji');
  if (emojiEl) emojiEl.textContent = product.garment_emoji || '\uD83D\uDC55';

  // Update price
  updatePrice();

  // Render colors if product has them
  renderColors(product);

  // Render sizes
  renderSizes(product);

  // Highlight active type button
  const row = document.getElementById('garmentTypeRow');
  if (row) {
    row.querySelectorAll('.g-type').forEach(b => {
      b.classList.toggle('active', b.dataset.slug === slug);
    });
  }

  advanceStep(1);
}

function renderColors(product) {
  const section = document.getElementById('colorSection');
  const row = document.getElementById('garmentColorRow');
  const nameEl = document.getElementById('colorName');
  if (!row || !section) return;

  if (!product.colors || product.colors.length === 0) {
    section.style.display = 'none';
    selectedColor = null;
    return;
  }

  section.style.display = 'block';
  row.innerHTML = '';

  product.colors.forEach((color, i) => {
    const swatch = document.createElement('div');
    swatch.className = 'g-color' + (i === 0 ? ' active' : '');
    swatch.style.background = COLOR_HEX[color] || '#888';
    if (color === 'White') swatch.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.3)';
    swatch.title = color;
    swatch.addEventListener('click', () => {
      row.querySelectorAll('.g-color').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      selectedColor = color;
      if (nameEl) nameEl.textContent = color;
    });
    row.appendChild(swatch);
  });

  selectedColor = product.colors[0];
  if (nameEl) nameEl.textContent = product.colors[0];
}

function renderSizes(product) {
  const row = document.getElementById('sizeRow');
  if (!row || !product.sizes) return;

  row.innerHTML = '';
  product.sizes.forEach((size, i) => {
    const btn = document.createElement('button');
    btn.className = 'p-size' + (i === 1 ? ' active' : '');  // Default to S or second size
    btn.textContent = size;
    btn.addEventListener('click', () => {
      row.querySelectorAll('.p-size').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedSize = size;
      checkAddToCartReady();
    });
    row.appendChild(btn);
  });

  selectedSize = product.sizes[1] || product.sizes[0];
}

function updatePrice() {
  const priceEl = document.getElementById('creatorPrice');
  if (!priceEl || !selectedProduct) return;
  const total = (selectedProduct.base_price_eur || 39) * panelQty;
  priceEl.textContent = `\u20AC${total.toFixed(2)}`;
}

// ── Panel tabs ──
function initPanelTabs() {
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const tabName = tab.dataset.tab;
      document.getElementById('panelTab-disenar').style.display = tabName === 'disenar' ? '' : 'none';
      document.getElementById('panelTab-estilos').style.display = tabName === 'estilos' ? '' : 'none';
      document.getElementById('panelTab-inspiracion').style.display = tabName === 'inspiracion' ? '' : 'none';
    });
  });
}

// ── Prompt input ──
function initPromptInput() {
  const input = document.getElementById('promptInput');
  const count = document.getElementById('charCount');
  const genBtn = document.getElementById('generateBtn');
  if (!input) return;

  input.addEventListener('input', () => {
    if (count) count.textContent = `${input.value.length}/200`;
    if (genBtn) genBtn.disabled = input.value.trim().length < 5;
    if (input.value.length > 5 && currentStep < 2) advanceStep(2);
  });
}

// ── Prompt chips ──
function initPromptChips() {
  document.querySelectorAll('.prompt-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const input = document.getElementById('promptInput');
      if (input) {
        input.value = chip.dataset.prompt || chip.dataset.inspo || '';
        input.dispatchEvent(new Event('input'));
      }
    });
  });
}

// ── Style presets ──
function initStylePresets() {
  document.querySelectorAll('.style-preset').forEach(preset => {
    preset.addEventListener('click', () => {
      document.querySelectorAll('.style-preset').forEach(p => p.classList.remove('active'));
      preset.classList.add('active');
      selectedStyle = preset.dataset.style;

      const input = document.getElementById('promptInput');
      if (input && input.value.trim()) {
        // Append style to existing prompt
        const base = input.value.replace(/,\s*estilo\s.+$/i, '');
        input.value = `${base}, ${selectedStyle}`;
      } else if (input) {
        input.value = selectedStyle;
      }
      if (input) input.dispatchEvent(new Event('input'));

      // Switch to design tab
      document.querySelector('[data-tab="disenar"]').click();
    });
  });
}

// ── Inspiration items ──
function initInspoItems() {
  document.querySelectorAll('.inspo-item').forEach(item => {
    item.addEventListener('click', () => {
      const input = document.getElementById('promptInput');
      if (input) {
        input.value = item.dataset.inspo;
        input.dispatchEvent(new Event('input'));
      }
      // Switch to design tab
      document.querySelector('[data-tab="disenar"]').click();
    });
  });
}

// ── Generate button ──
document.addEventListener('DOMContentLoaded', () => {
  const genBtn = document.getElementById('generateBtn');
  if (genBtn) {
    genBtn.addEventListener('click', generateDesign);
  }
});

async function generateDesign() {
  const input = document.getElementById('promptInput');
  const genBtn = document.getElementById('generateBtn');
  if (!input || !input.value.trim()) return;

  genBtn.disabled = true;
  genBtn.classList.add('loading');

  try {
    const productKey = selectedProduct ? selectedProduct.product_key : 'all-over-print-mens-athletic-t-shirt';

    // Step 1: Generate AI image
    const imageRes = await fetch('/api/preview/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: input.value.trim() }),
    });
    const imageData = await imageRes.json();

    if (!imageData.ok || !imageData.image_url) {
      const errorMsg = imageData.error || imageData.message || 'Error al generar el diseño';
      showToast(typeof errorMsg === 'string' ? errorMsg : 'Error al generar el diseño');
      return;
    }

    generatedImageUrl = imageData.image_url;

    // Show generated image in preview
    const genImg = document.getElementById('generatedImg');
    const placeholder = document.getElementById('designPlaceholder');
    const designEl = document.getElementById('garmentDesign');
    if (genImg && placeholder && designEl) {
      genImg.src = generatedImageUrl;
      genImg.style.display = 'block';
      placeholder.style.display = 'none';
      designEl.classList.add('has-design');
    }

    advanceStep(3);

    // Step 2: Request mockup (non-blocking)
    requestMockup(productKey);

    // Enable step 4
    const step4 = document.getElementById('step4Section');
    if (step4) step4.style.opacity = '1';
    advanceStep(4);
    checkAddToCartReady();

    showToast('Diseño generado');

  } catch (err) {
    console.error('[creator] generation failed', err);
    showToast('Error de conexión. Inténtalo de nuevo.');
  } finally {
    genBtn.disabled = false;
    genBtn.classList.remove('loading');
  }
}

async function requestMockup(productKey) {
  try {
    const size = selectedSize || 'M';
    const color = selectedColor || undefined;
    const variantTitle = color ? `${color} / ${size}` : size;

    const mockupRes = await fetch('/api/preview/mockup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: generatedImageUrl,
        product_key: productKey,
        variant_title: variantTitle,
      }),
    });
    const mockupData = await mockupRes.json();

    if (mockupData.ok && mockupData.mockup_url) {
      // Could display mockup in a gallery — for now, the AI image is shown
      console.log('[creator] mockup ready:', mockupData.mockup_url);
    } else if (mockupData.task_key) {
      // Poll for async mockup
      pollMockupStatus(mockupData.task_key);
    }
  } catch (err) {
    console.error('[creator] mockup request failed', err);
  }
}

async function pollMockupStatus(taskKey, attempt = 0) {
  if (attempt > 10) return;

  await new Promise(r => setTimeout(r, 3000));

  try {
    const res = await fetch(`/api/preview/mockup/status?task_key=${encodeURIComponent(taskKey)}`);
    const data = await res.json();

    if (data.mockup_status === 'completed' && data.mockup_url) {
      console.log('[creator] mockup completed:', data.mockup_url);
    } else if (data.mockup_status === 'processing') {
      pollMockupStatus(taskKey, attempt + 1);
    }
  } catch (err) {
    console.error('[creator] mockup poll failed', err);
  }
}

// ── Step progress ──
function advanceStep(step) {
  if (step <= currentStep) return;
  currentStep = step;

  document.querySelectorAll('.step-item').forEach(el => {
    const s = parseInt(el.dataset.step, 10);
    el.classList.remove('active', 'done');
    if (s < step) el.classList.add('done');
    if (s === step) el.classList.add('active');
  });
}

// ── Quantity controls ──
function initQuantityControls() {
  const minus = document.getElementById('qtyMinus');
  const plus = document.getElementById('qtyPlus');
  const display = document.getElementById('panelQtyNum');

  if (minus) minus.addEventListener('click', () => {
    if (panelQty > 1) {
      panelQty--;
      display.textContent = panelQty;
      updatePrice();
    }
  });

  if (plus) plus.addEventListener('click', () => {
    if (panelQty < 10) {
      panelQty++;
      display.textContent = panelQty;
      updatePrice();
    }
  });
}

// ── Add to cart ──
function checkAddToCartReady() {
  const btn = document.getElementById('panelAddBtn');
  if (!btn) return;
  btn.disabled = !generatedImageUrl || !selectedProduct || !selectedSize;
}

function initAddToCartButton() {
  const btn = document.getElementById('panelAddBtn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (!generatedImageUrl || !selectedProduct) return;

    addToCart({
      name: selectedProduct.name,
      slug: selectedProduct.slug,
      product_key: selectedProduct.product_key,
      size: selectedSize,
      color: selectedColor,
      quantity: panelQty,
      price: selectedProduct.base_price_eur,
      image_url: generatedImageUrl,
      emoji: selectedProduct.garment_emoji || '\uD83D\uDC55',
    });
  });
}

// Expose for catalog.js product card clicks
window.selectProduct = selectProduct;
