/* ══════════════════════════════
   CREATOR — 4-step design flow
══════════════════════════════ */

// ── State ──
let selectedProduct = null;
let selectedColor = null;
let selectedSize = null;
let selectedStyle = '';
let generatedImageUrl = null;
let currentMockupUrl = null;
let currentStep = 1;
let panelQty = 1;
let layoutScale = 100;
let layoutX = 0;
let layoutY = 0;
let previewMode = 'mockup'; // 'mockup' | 'adjusting'

// ── Color hex map ──
const COLOR_HEX = {
  'Black': '#1C1A18',
  'White': '#FFFFFF',
  'Navy': '#2C3E60',
  'Sport Grey': '#B5AFA3',
  'Sand': '#C2B280',
  'Maroon': '#6B2C3B',
  'Khaki': '#C3B091',
  'Stone': '#928E85',
  'Pink': '#FFB6C1',
  'Charcoal': '#4A4A4A',
  'Black/White': 'linear-gradient(135deg, #1C1A18 50%, #FFFFFF 50%)',
  'Navy/White': 'linear-gradient(135deg, #2C3E60 50%, #FFFFFF 50%)',
  'Glossy': 'linear-gradient(135deg, #E8E8E8, #FFFFFF, #D0D0D0)',
  'Matte': '#A0A0A0',
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
  initLayoutControls();
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

  // Update garment preview (mockup > real photo > emoji fallback)
  const emojiEl = document.getElementById('garmentEmoji');
  const previewImg = product.default_mockup_url || product.image_url;
  if (emojiEl && previewImg) {
    emojiEl.innerHTML = `<img src="${previewImg}" alt="${product.name}" class="garment-product-img">`;
  } else if (emojiEl) {
    emojiEl.textContent = product.garment_emoji || '\uD83D\uDC55';
  }

  // Reset mockup state
  currentMockupUrl = null;
  hideMockup();

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
      // Update product image to color-specific variant
      updateProductImage(color);
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
    showMockupLoading();
    currentMockupUrl = null;

    const size = selectedSize || 'M';
    const color = selectedColor || undefined;
    const variantTitle = color ? `${color} / ${size}` : size;

    const body = {
      image_url: generatedImageUrl,
      pf_product_key: productKey,
      variant_title: variantTitle,
    };
    if (selectedProduct?.placement) body.pf_placement = selectedProduct.placement;
    const layout = getLayoutParam();
    if (layout) body.layout = layout;

    console.log('[creator] requestMockup body:', JSON.stringify(body, null, 2));

    const mockupRes = await fetch('/api/preview/mockup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const mockupData = await mockupRes.json();

    if (mockupData.ok && mockupData.mockup_url) {
      displayMockup(mockupData.mockup_url, mockupData.mockup_urls || []);
    } else if (mockupData.reason === 'layout_not_supported') {
      hideMockupLoading();
      showToast('Este producto no soporta ajuste de posici\u00F3n. Prueba con valores por defecto.');
      resetLayout();
    } else if (mockupData.task_key) {
      pollMockupStatus(mockupData.task_key);
    } else {
      hideMockupLoading();
    }
  } catch (err) {
    console.error('[creator] mockup request failed', err);
    hideMockupLoading();
  }
}

async function pollMockupStatus(taskKey, attempt = 0) {
  if (attempt > 10) {
    hideMockupLoading();
    return;
  }

  await new Promise(r => setTimeout(r, 3000));

  try {
    const res = await fetch(`/api/preview/mockup/status?task_key=${encodeURIComponent(taskKey)}`);
    const data = await res.json();

    if (data.mockup_status === 'completed' && data.mockup_url) {
      displayMockup(data.mockup_url, data.mockup_urls || []);
    } else if (data.mockup_status === 'processing') {
      pollMockupStatus(taskKey, attempt + 1);
    } else {
      hideMockupLoading();
    }
  } catch (err) {
    console.error('[creator] mockup poll failed', err);
    hideMockupLoading();
  }
}

// ── Product image helpers ──
function updateProductImage(color) {
  if (!selectedProduct) return;
  const emojiEl = document.getElementById('garmentEmoji');
  if (!emojiEl) return;
  const colorImg = selectedProduct.color_images?.[color];
  const imgSrc = colorImg || selectedProduct.default_mockup_url || selectedProduct.image_url;
  if (imgSrc) {
    emojiEl.innerHTML = `<img src="${imgSrc}" alt="${selectedProduct.name}" class="garment-product-img">`;
  }
}

// ── Mockup display ──
function showMockupLoading() {
  const preview = document.querySelector('.garment-preview');
  if (!preview || preview.querySelector('.mockup-loading')) return;
  const loader = document.createElement('div');
  loader.className = 'mockup-loading';
  loader.innerHTML = '<div class="mockup-loading-text">Aplicando dise\u00F1o a la prenda\u2026</div>';
  preview.appendChild(loader);
}

function hideMockupLoading() {
  document.querySelectorAll('.mockup-loading').forEach(el => el.remove());
}

function displayMockup(primaryUrl, allUrls) {
  hideMockupLoading();
  currentMockupUrl = primaryUrl;

  const preview = document.querySelector('.garment-preview');
  if (!preview) return;

  // Hide the garment photo and design overlay — the mockup replaces everything
  const garmentBg = preview.querySelector('.garment-bg');
  const garmentCanvas = preview.querySelector('.garment-canvas');
  if (garmentBg) garmentBg.style.display = 'none';
  if (garmentCanvas) garmentCanvas.style.display = 'none';

  // Remove existing mockup container
  const existing = preview.querySelector('.mockup-container');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.className = 'mockup-container';

  const mainImg = document.createElement('img');
  mainImg.className = 'mockup-img';
  mainImg.src = primaryUrl;
  mainImg.alt = 'Vista previa del producto';
  container.appendChild(mainImg);

  // Gallery thumbnails if multiple mockups
  const urls = allUrls.length > 0 ? allUrls : [primaryUrl];
  if (urls.length > 1) {
    const gallery = document.createElement('div');
    gallery.className = 'mockup-gallery';
    urls.forEach((url, i) => {
      const thumb = document.createElement('img');
      thumb.className = 'mockup-thumb' + (i === 0 ? ' active' : '');
      thumb.src = url;
      thumb.alt = `Vista ${i + 1}`;
      thumb.addEventListener('click', () => {
        mainImg.src = url;
        gallery.querySelectorAll('.mockup-thumb').forEach(t => t.classList.remove('active'));
        thumb.classList.add('active');
        currentMockupUrl = url;
      });
      gallery.appendChild(thumb);
    });
    container.appendChild(gallery);
  }

  preview.appendChild(container);

  // If user is adjusting sliders, don't interrupt — keep mockup hidden in DOM
  if (previewMode === 'adjusting') {
    container.style.display = 'none';
  } else {
    if (selectedProduct?.supports_layout) {
      showLayoutControls();
    } else {
      hideLayoutControls();
    }
  }
}

function hideMockup() {
  hideLayoutControls();
  resetLayout();
  exitAdjustMode();
  hideMockupLoading();
  document.querySelectorAll('.mockup-container').forEach(el => el.remove());

  // Restore garment photo and design overlay
  const preview = document.querySelector('.garment-preview');
  if (!preview) return;
  const garmentBg = preview.querySelector('.garment-bg');
  const garmentCanvas = preview.querySelector('.garment-canvas');
  if (garmentBg) garmentBg.style.display = '';
  if (garmentCanvas) garmentCanvas.style.display = '';
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
      mockup_url: currentMockupUrl || null,
      product_image_url: selectedProduct.image_url || null,
    });
  });
}

// ── Layout controls ──
function initLayoutControls() {
  const scaleSlider = document.getElementById('layoutScale');
  const xSlider = document.getElementById('layoutX');
  const ySlider = document.getElementById('layoutY');
  const resetBtn = document.getElementById('layoutResetBtn');
  const updateBtn = document.getElementById('layoutUpdateBtn');

  if (!scaleSlider) return;

  scaleSlider.addEventListener('input', () => {
    layoutScale = parseInt(scaleSlider.value, 10);
    document.getElementById('layoutScaleValue').textContent = layoutScale + '%';
    enterAdjustMode();
    updateClientPreview();
  });

  xSlider.addEventListener('input', () => {
    layoutX = parseInt(xSlider.value, 10);
    document.getElementById('layoutXValue').textContent = layoutX;
    enterAdjustMode();
    updateClientPreview();
  });

  ySlider.addEventListener('input', () => {
    layoutY = parseInt(ySlider.value, 10);
    document.getElementById('layoutYValue').textContent = layoutY;
    enterAdjustMode();
    updateClientPreview();
  });

  resetBtn.addEventListener('click', () => {
    resetLayout();
    if (previewMode === 'adjusting') {
      updateClientPreview();
    }
  });

  updateBtn.addEventListener('click', async () => {
    if (!generatedImageUrl || !selectedProduct) return;
    updateBtn.disabled = true;
    updateBtn.classList.add('loading');
    updateBtn.textContent = 'Generando\u2026';
    // Exit adjust mode first so displayMockup() will show the result
    previewMode = 'mockup';
    const clientPreview = document.getElementById('clientPreview');
    if (clientPreview) clientPreview.style.display = 'none';
    await requestMockup(selectedProduct.product_key);
    updateBtn.disabled = false;
    updateBtn.classList.remove('loading');
    updateBtn.textContent = 'Ver mockup real';
  });
}

function resetLayout() {
  layoutScale = 100;
  layoutX = 0;
  layoutY = 0;
  const scaleSlider = document.getElementById('layoutScale');
  const xSlider = document.getElementById('layoutX');
  const ySlider = document.getElementById('layoutY');
  if (scaleSlider) scaleSlider.value = 100;
  if (xSlider) xSlider.value = 0;
  if (ySlider) ySlider.value = 0;
  document.getElementById('layoutScaleValue').textContent = '100%';
  document.getElementById('layoutXValue').textContent = '0';
  document.getElementById('layoutYValue').textContent = '0';
}

function showLayoutControls() {
  const el = document.getElementById('layoutControls');
  if (el) el.style.display = '';
}

function hideLayoutControls() {
  const el = document.getElementById('layoutControls');
  if (el) el.style.display = 'none';
}

function getLayoutParam() {
  if (layoutScale === 100 && layoutX === 0 && layoutY === 0) return undefined;
  return {
    scale: layoutScale / 100,
    offset_x: layoutX,
    offset_y: layoutY,
  };
}

// ── Client-side layout preview ──
function enterAdjustMode() {
  if (previewMode === 'adjusting') return;
  if (!generatedImageUrl || !selectedProduct) return;
  previewMode = 'adjusting';

  // Hide Printful mockup
  const mockupContainer = document.querySelector('.mockup-container');
  if (mockupContainer) mockupContainer.style.display = 'none';

  setupClientPreview();
}

function exitAdjustMode() {
  if (previewMode !== 'adjusting') return;
  previewMode = 'mockup';

  const clientPreview = document.getElementById('clientPreview');
  if (clientPreview) clientPreview.style.display = 'none';

  // Restore Printful mockup
  const mockupContainer = document.querySelector('.mockup-container');
  if (mockupContainer) mockupContainer.style.display = '';

  if (selectedProduct?.supports_layout) {
    showLayoutControls();
  } else {
    hideLayoutControls();
  }
}

function setupClientPreview() {
  const clientPreview = document.getElementById('clientPreview');
  const baseImg = document.getElementById('clientPreviewBase');
  const designImg = document.getElementById('clientPreviewDesign');
  const printArea = document.getElementById('clientPreviewPrintArea');
  if (!clientPreview || !baseImg || !designImg || !printArea) return;

  // Base image: product color photo or catalog image
  const baseUrl = selectedProduct.color_images?.[selectedColor]
    || selectedProduct.image_url
    || selectedProduct.default_mockup_url;
  baseImg.src = baseUrl;

  // Design image: the AI-generated artwork
  designImg.src = generatedImageUrl;

  // Position the print area overlay
  const area = selectedProduct.preview_print_area;
  if (area) {
    printArea.style.top = area.top_pct + '%';
    printArea.style.left = area.left_pct + '%';
    printArea.style.width = area.width_pct + '%';
    printArea.style.height = area.height_pct + '%';
  } else {
    // Fallback: center area
    printArea.style.top = '15%';
    printArea.style.left = '15%';
    printArea.style.width = '70%';
    printArea.style.height = '70%';
  }

  clientPreview.style.display = '';
  updateClientPreview();
}

function updateClientPreview() {
  const designImg = document.getElementById('clientPreviewDesign');
  if (!designImg) return;
  const scaleVal = layoutScale / 100;
  const txPct = layoutX * 0.3;
  const tyPct = layoutY * 0.3;
  designImg.style.transform = `scale(${scaleVal}) translate(${txPct}%, ${tyPct}%)`;
}

// Expose for catalog.js product card clicks
window.selectProduct = selectProduct;
