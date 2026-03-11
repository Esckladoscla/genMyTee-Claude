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
    div.innerHTML = `
      <div class="cart-item-img">${item.emoji || '\uD83D\uDC55'}</div>
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
}

// ── Cart drawer ──
function openCart() {
  document.getElementById('cartDrawer').classList.add('open');
  document.getElementById('mainOverlay').classList.add('open');
  renderCartItems();
}

function closeCart() {
  document.getElementById('cartDrawer').classList.remove('open');
  document.getElementById('mainOverlay').classList.remove('open');
}

// ── Mobile menu ──
function toggleMobileMenu() {
  document.getElementById('mobileMenu').classList.toggle('open');
}

// ── Toast ──
let toastTimeout;
function showToast(message) {
  const toast = document.getElementById('toast');
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

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();
  initScrollAnimations();
  initCookieBanner();

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
