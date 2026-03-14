/* ══════════════════════════════
   APP — Global UI: nav, cart, toast
══════════════════════════════ */

// ── Cart state (localStorage) ──
const CART_KEY = 'genmytee_cart';

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch { return []; }
}

function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  updateCartBadge();
}

function addToCart(item) {
  const cart = getCart();
  cart.push({ ...item, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) });
  saveCart(cart);
  renderCartItems();
  openCart();
  showToast('Añadido al carrito');
}

function removeFromCart(id) {
  const cart = getCart().filter(item => item.id !== id);
  saveCart(cart);
  renderCartItems();
}

function updateCartBadge() {
  const badge = document.getElementById('cartBadge');
  if (!badge) return;
  const count = getCart().length;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function renderCartItems() {
  const list = document.getElementById('cartItemsList');
  const footer = document.getElementById('cartFooter');
  const empty = document.getElementById('cartEmpty');
  if (!list || !footer || !empty) return;
  const cart = getCart();

  if (cart.length === 0) {
    empty.style.display = 'block';
    footer.style.display = 'none';
    // Clear any rendered items
    list.querySelectorAll('.cart-item').forEach(el => el.remove());
    return;
  }

  empty.style.display = 'none';
  footer.style.display = 'block';

  // Clear existing items
  list.querySelectorAll('.cart-item').forEach(el => el.remove());

  let total = 0;
  for (const item of cart) {
    const price = (item.price || 0) * (item.quantity || 1);
    total += price;

    const div = document.createElement('div');
    div.className = 'cart-item';
    const thumbSrc = item.mockup_url || item.product_image_url;
    div.innerHTML = `
      <div class="cart-item-img">${thumbSrc
        ? `<img src="${thumbSrc}" alt="${escapeHtml(item.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">`
        : (item.emoji || '\uD83D\uDC55')}</div>
      <div class="cart-item-details">
        <div class="cart-item-name">${escapeHtml(item.name)}</div>
        <div class="cart-item-meta">${escapeHtml(item.size || '')} ${item.color ? '· ' + escapeHtml(item.color) : ''} · x${item.quantity || 1}</div>
        <button class="cart-item-remove" data-id="${item.id}">Eliminar</button>
      </div>
      <div class="cart-item-price">\u20AC${price.toFixed(2)}</div>
    `;
    list.appendChild(div);
  }

  document.getElementById('cartTotal').textContent = `\u20AC${total.toFixed(2)}`;

  // Bind remove buttons
  list.querySelectorAll('.cart-item-remove').forEach(btn => {
    btn.addEventListener('click', () => removeFromCart(btn.dataset.id));
  });

  renderBundleBanner();
}

// ── Bundles / Upsells ──
let activeBundles = [];

async function loadBundles() {
  try {
    const res = await fetch('/api/catalog/bundles');
    const data = await res.json();
    if (data.ok) activeBundles = data.bundles || [];
  } catch {}
}

function checkBundleUpsell(cart) {
  if (activeBundles.length === 0 || cart.length === 0) return null;

  // Get catalog products to check categories
  const catalogProducts = window.getCatalogProducts ? window.getCatalogProducts() : [];

  for (const bundle of activeBundles) {
    // Count items in qualifying categories
    const qualifyingItems = cart.filter(item => {
      const catalogProduct = catalogProducts.find(p => p.product_key === item.product_key);
      return catalogProduct && bundle.categories.includes(catalogProduct.category);
    });

    const needed = bundle.min_items - qualifyingItems.length;

    if (needed <= 0) {
      // Bundle is met — show savings
      const normalTotal = qualifyingItems.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0);
      const savings = normalTotal - bundle.bundle_price_eur;
      if (savings > 0) {
        return {
          type: 'applied',
          bundle,
          savings: savings.toFixed(2),
          message: `${bundle.name}: ahorras ${savings.toFixed(2)}\u20AC`,
        };
      }
    } else if (needed <= 2 && qualifyingItems.length > 0) {
      // Close to qualifying — upsell
      return {
        type: 'upsell',
        bundle,
        needed,
        message: `Añade ${needed} ${needed === 1 ? 'prenda' : 'prendas'} más y consigue el ${bundle.name} por solo ${bundle.bundle_price_eur}\u20AC`,
      };
    }
  }

  return null;
}

function renderBundleBanner() {
  const existing = document.getElementById('bundleBanner');
  if (existing) existing.remove();

  const cart = getCart();
  const result = checkBundleUpsell(cart);
  if (!result) return;

  const banner = document.createElement('div');
  banner.id = 'bundleBanner';
  banner.style.cssText = 'padding:0.6rem 1rem;font-size:0.72rem;text-align:center;border-bottom:1px solid var(--border)';

  if (result.type === 'applied') {
    banner.style.background = '#e8f5e9';
    banner.style.color = '#2e7d32';
    banner.innerHTML = `&#x2705; ${result.message}`;
  } else {
    banner.style.background = '#fff3e0';
    banner.style.color = '#e65100';
    banner.innerHTML = `&#x1F381; ${result.message}`;
  }

  const cartList = document.getElementById('cartItemsList');
  if (cartList) cartList.parentNode.insertBefore(banner, cartList);
}

// ── Cart drawer ──
function openCart() {
  const drawer = document.getElementById('cartDrawer');
  const overlay = document.getElementById('mainOverlay');
  if (!drawer || !overlay) return;
  drawer.classList.add('open');
  overlay.classList.add('open');
  renderCartItems();
  renderBundleBanner();
}

function closeCart() {
  const drawer = document.getElementById('cartDrawer');
  const overlay = document.getElementById('mainOverlay');
  if (!drawer || !overlay) return;
  drawer.classList.remove('open');
  overlay.classList.remove('open');
}

// ── Mobile menu ──
function toggleMobileMenu() {
  document.getElementById('mobileMenu').classList.toggle('open');
}

// ── Toast ──
let toastTimeout;
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ── Utility ──
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── FAQ accordion ──
function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  const wasOpen = item.classList.contains('open');

  // Close all
  document.querySelectorAll('.faq-item.open').forEach(el => {
    el.classList.remove('open');
    el.querySelector('.faq-answer').style.maxHeight = '0';
  });

  // Open clicked if it was closed
  if (!wasOpen) {
    item.classList.add('open');
    const answer = item.querySelector('.faq-answer');
    answer.style.maxHeight = answer.scrollHeight + 'px';
  }
}

// ── Cookie banner ──
function dismissCookie() {
  const banner = document.getElementById('cookieBanner');
  if (banner) banner.classList.add('hidden');
  try { localStorage.setItem('genmytee_cookies', '1'); } catch {}
}

function initCookieBanner() {
  try {
    if (localStorage.getItem('genmytee_cookies')) {
      const banner = document.getElementById('cookieBanner');
      if (banner) banner.classList.add('hidden');
    }
  } catch {}
}

// ── Newsletter ──
async function subscribeNewsletter() {
  const input = document.getElementById('nlEmail');
  const email = input?.value.trim();
  if (!email) { showToast('Introduce tu email'); return; }
  try {
    const res = await fetch('/api/newsletter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (data.already_subscribed) {
      showToast('Ya estás suscrito');
    } else {
      showToast('Gracias por suscribirte');
      input.value = '';
    }
  } catch {
    showToast('Error al suscribirse, inténtalo de nuevo');
  }
}

// ── Scroll animations ──
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));
}

// ── Checkout ──
async function startCheckout() {
  const cart = getCart();
  if (cart.length === 0) {
    showToast('Tu carrito está vacío');
    return;
  }

  const checkoutBtn = document.getElementById('checkoutBtn');
  if (checkoutBtn) {
    checkoutBtn.disabled = true;
    checkoutBtn.textContent = 'Procesando...';
  }

  try {
    const items = cart.map(item => ({
      slug: item.slug,
      product_key: item.product_key,
      color: item.color,
      size: item.size,
      quantity: item.quantity,
      image_url: item.image_url,
      layout: item.layout || null,
    }));

    const res = await fetch('/api/checkout/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });

    const data = await res.json();

    if (data.ok && data.url) {
      window.location.href = data.url;
    } else {
      showToast(data.error || 'Error al iniciar el pago');
      if (checkoutBtn) {
        checkoutBtn.disabled = false;
        checkoutBtn.textContent = 'Finalizar compra';
      }
    }
  } catch (err) {
    console.error('[checkout] failed', err);
    showToast('Error de conexión. Inténtalo de nuevo.');
    if (checkoutBtn) {
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = 'Finalizar compra';
    }
  }
}

// ── Referral tracking ──
function initReferralTracking() {
  const params = new URLSearchParams(window.location.search);
  const refCode = params.get('ref');
  if (!refCode) return;

  // Store in cookie for checkout
  try { localStorage.setItem('genmytee_ref', refCode); } catch {}

  // Validate and show banner
  fetch(`/api/referrals/validate?code=${encodeURIComponent(refCode)}`)
    .then(r => r.json())
    .then(data => {
      if (data.ok && data.valid) {
        showReferralBanner(data.discount_pct);
      }
    })
    .catch(() => {});
}

function showReferralBanner(discountPct) {
  const banner = document.createElement('div');
  banner.className = 'referral-banner';
  banner.innerHTML = `<span>&#x1F381; Te han invitado &mdash; <strong>${discountPct}% de descuento</strong> en tu primera compra</span>`;
  document.body.prepend(banner);
}

function getReferralCode() {
  try { return localStorage.getItem('genmytee_ref') || null; } catch { return null; }
}

// ── Gift Cards ──
let selectedGiftAmount = 75;

function initGiftCards() {
  const amountBtns = document.querySelectorAll('.gift-amount-btn');
  const buyBtn = document.getElementById('giftBuyBtn');
  const valueDisplay = document.getElementById('giftCardValue');

  if (!buyBtn) return;

  amountBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      amountBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedGiftAmount = parseInt(btn.dataset.amount, 10);
      if (valueDisplay) valueDisplay.textContent = `\u20AC${selectedGiftAmount}`;
    });
  });

  buyBtn.addEventListener('click', async () => {
    const recipientEmail = document.getElementById('giftRecipientEmail')?.value.trim();
    const recipientName = document.getElementById('giftRecipientName')?.value.trim();
    const message = document.getElementById('giftMessage')?.value.trim();

    if (!recipientEmail || !recipientEmail.includes('@')) {
      showToast('Introduce el email del destinatario');
      return;
    }

    buyBtn.disabled = true;
    buyBtn.textContent = 'Procesando...';

    try {
      // Create checkout session for gift card
      const res = await fetch('/api/checkout/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{
            name: `Tarjeta regalo genMyTee \u20AC${selectedGiftAmount}`,
            product_key: 'gift-card',
            size: '',
            color: '',
            quantity: 1,
            price: selectedGiftAmount,
            image_url: '',
            slug: 'tarjeta-regalo',
            is_gift_card: true,
            gift_card_data: { recipient_email: recipientEmail, recipient_name: recipientName, message },
          }],
        }),
      });

      const data = await res.json();
      if (data.ok && data.url) {
        // Store gift card data for post-purchase processing
        try {
          localStorage.setItem('genmytee_gift_pending', JSON.stringify({
            amount: selectedGiftAmount,
            recipient_email: recipientEmail,
            recipient_name: recipientName,
            message,
          }));
        } catch {}
        window.location.href = data.url;
      } else {
        showToast(data.error || 'Error al procesar el pago');
        buyBtn.disabled = false;
        buyBtn.textContent = 'Comprar tarjeta regalo';
      }
    } catch {
      showToast('Error de conexión. Inténtalo de nuevo.');
      buyBtn.disabled = false;
      buyBtn.textContent = 'Comprar tarjeta regalo';
    }
  });
}

// ── Gift Card Redemption (in cart) ──
function initGiftCardRedemption() {
  // Add redemption UI to cart footer if it exists
  const cartFooter = document.getElementById('cartFooter');
  if (!cartFooter || document.getElementById('giftCodeRow')) return;

  const row = document.createElement('div');
  row.id = 'giftCodeRow';
  row.style.cssText = 'display:flex;gap:0.4rem;margin-bottom:0.6rem;';
  row.innerHTML = `
    <input type="text" id="giftCodeInput" placeholder="Código regalo" style="flex:1;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid var(--border);background:rgba(255,255,255,0.04);color:#fff;font-size:0.75rem;font-family:inherit;" />
    <button id="giftCodeApply" style="padding:0.4rem 0.8rem;border-radius:6px;border:none;background:var(--accent,#7c5cff);color:#fff;font-size:0.72rem;cursor:pointer;font-family:inherit;">Aplicar</button>
  `;
  const shippingNote = cartFooter.querySelector('.cart-shipping-note');
  if (shippingNote) {
    cartFooter.insertBefore(row, shippingNote);
  } else {
    cartFooter.prepend(row);
  }

  document.getElementById('giftCodeApply')?.addEventListener('click', async () => {
    const code = document.getElementById('giftCodeInput')?.value.trim();
    if (!code) { showToast('Introduce un código de regalo'); return; }
    try {
      const res = await fetch(`/api/gift-cards/validate?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (data.ok && data.valid) {
        showToast(`Tarjeta válida: ${data.amount_eur}\u20AC de descuento`);
        try { localStorage.setItem('genmytee_gift_code', code); } catch {}
      } else {
        const msgs = { not_found: 'Código no válido', already_redeemed: 'Ya ha sido canjeada', expired: 'Código caducado' };
        showToast(msgs[data.error] || 'Código no válido');
      }
    } catch {
      showToast('Error al validar el código');
    }
  });
}

// ── Social counter ──
function loadSocialCounter() {
  const el = document.getElementById('counterNumber');
  if (!el) return;
  fetch('/api/stats/designs-count')
    .then(r => r.json())
    .then(data => {
      if (data.ok && data.count > 0) {
        el.textContent = '+' + data.count.toLocaleString('es-ES');
      }
    })
    .catch(() => { /* keep default */ });
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();
  initScrollAnimations();
  initCookieBanner();
  initReferralTracking();
  initGiftCards();
  initGiftCardRedemption();
  loadBundles();
  loadSocialCounter();

  const checkoutBtn = document.getElementById('checkoutBtn');
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', startCheckout);
  }
});

// Make functions available globally (used by onclick handlers)
window.openCart = openCart;
window.closeCart = closeCart;
window.toggleMobileMenu = toggleMobileMenu;
window.showToast = showToast;
window.addToCart = addToCart;
window.toggleFaq = toggleFaq;
window.dismissCookie = dismissCookie;
window.subscribeNewsletter = subscribeNewsletter;
