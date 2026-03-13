/* global showToast */

// Auth state management
const AUTH_STATE = {
  user: null,
  authenticated: false,
  loading: true,
};

// --- API helpers ---

async function authFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    credentials: "include",
    headers: {
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = body;
    throw err;
  }
  return res.json();
}

// --- Auth state ---

async function checkAuth() {
  try {
    const data = await authFetch("/api/auth/me");
    AUTH_STATE.user = data.user;
    AUTH_STATE.authenticated = data.authenticated;
  } catch (_) {
    AUTH_STATE.user = null;
    AUTH_STATE.authenticated = false;
  }
  AUTH_STATE.loading = false;
  updateAuthUI();
}

function updateAuthUI() {
  const navActions = document.querySelector(".nav-actions");
  if (!navActions) return;

  // Remove existing auth button
  const existing = navActions.querySelector(".nav-user-btn");
  if (existing) existing.remove();

  const btn = document.createElement("button");
  btn.className = "nav-user-btn";

  if (AUTH_STATE.authenticated && AUTH_STATE.user) {
    const initial = (AUTH_STATE.user.name || AUTH_STATE.user.email || "U")[0].toUpperCase();
    const avatarSpan = document.createElement("span");
    avatarSpan.className = "nav-user-avatar";
    if (AUTH_STATE.user.avatar_url && AUTH_STATE.user.avatar_url.startsWith("https://")) {
      const img = document.createElement("img");
      img.src = AUTH_STATE.user.avatar_url;
      img.alt = "";
      avatarSpan.appendChild(img);
    } else {
      avatarSpan.textContent = initial;
    }
    btn.appendChild(avatarSpan);
    btn.title = AUTH_STATE.user.email;
    btn.onclick = () => { window.location.href = "/mi-cuenta.html"; };
  } else {
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    btn.title = "Iniciar sesión";
    btn.onclick = openAuthModal;
  }

  // Insert before cart button
  const cartBtn = navActions.querySelector('[onclick="openCart()"]');
  if (cartBtn) {
    navActions.insertBefore(btn, cartBtn);
  } else {
    navActions.appendChild(btn);
  }

  // Update mobile menu
  updateMobileMenuAuth();
}

function updateMobileMenuAuth() {
  const mobileNav = document.querySelector(".mobile-nav-list");
  if (!mobileNav) return;

  // Remove existing auth item
  const existing = mobileNav.querySelector(".mobile-auth-item");
  if (existing) existing.remove();

  const li = document.createElement("li");
  li.className = "mobile-auth-item";

  if (AUTH_STATE.authenticated && AUTH_STATE.user) {
    li.innerHTML = `<a href="/mi-cuenta.html">Mi cuenta</a>`;
  } else {
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = "Iniciar sesión";
    a.onclick = (e) => { e.preventDefault(); toggleMobileMenu(); openAuthModal(); };
    li.appendChild(a);
  }
  mobileNav.appendChild(li);
}

// --- Auth modal ---

let authModalEl = null;

function createAuthModal() {
  if (authModalEl) return authModalEl;

  const overlay = document.createElement("div");
  overlay.className = "auth-modal-overlay";
  overlay.id = "authModalOverlay";
  overlay.onclick = (e) => { if (e.target === overlay) closeAuthModal(); };

  overlay.innerHTML = `
    <div class="auth-modal">
      <button class="auth-modal-close" onclick="closeAuthModal()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>

      <h2 class="auth-modal-title" id="authModalTitle">Bienvenido</h2>
      <p class="auth-modal-subtitle" id="authModalSubtitle">Crea una cuenta para guardar tus diseños y acceder a más generaciones.</p>

      <div class="auth-tabs" id="authTabs">
        <button class="auth-tab active" data-tab="register" onclick="switchAuthTab('register')">Registrarse</button>
        <button class="auth-tab" data-tab="login" onclick="switchAuthTab('login')">Iniciar sesión</button>
      </div>

      <!-- Register form -->
      <form class="auth-form" id="authRegisterForm" onsubmit="handleRegister(event)">
        <input class="auth-input" name="name" placeholder="Nombre (opcional)" autocomplete="name" />
        <input class="auth-input" name="email" type="email" placeholder="Email" required autocomplete="email" />
        <input class="auth-input" name="password" type="password" placeholder="Contraseña (mín. 8 caracteres)" required minlength="8" autocomplete="new-password" />
        <p class="auth-error" id="registerError"></p>
        <button class="auth-submit" type="submit" id="registerSubmit">Crear cuenta</button>
      </form>

      <!-- Login form -->
      <form class="auth-form" id="authLoginForm" style="display:none" onsubmit="handleLogin(event)">
        <input class="auth-input" name="email" type="email" placeholder="Email" required autocomplete="email" />
        <input class="auth-input" name="password" type="password" placeholder="Contraseña" required autocomplete="current-password" />
        <p class="auth-error" id="loginError"></p>
        <button class="auth-submit" type="submit" id="loginSubmit">Iniciar sesión</button>
      </form>

      <!-- Verification form -->
      <div class="auth-form" id="authVerifyForm" style="display:none">
        <div class="auth-verification">
          <p style="color:var(--muted);font-size:0.85rem;margin-bottom:1rem;">
            Hemos enviado un código de verificación a <strong id="verifyEmail"></strong>
          </p>
          <input class="auth-code-input" id="verifyCodeInput" maxlength="6" placeholder="000000" inputmode="numeric" pattern="[0-9]*" />
          <p class="auth-error" id="verifyError"></p>
          <button class="auth-submit" onclick="handleVerifyCode()" id="verifySubmit">Verificar</button>
          <button class="auth-resend" onclick="handleResendCode()" id="resendBtn">Reenviar código</button>
          <button class="auth-resend" onclick="skipVerification()" style="color:var(--muted)">Saltar por ahora</button>
        </div>
      </div>

      <div id="authGoogleSection">
        <div class="auth-divider">o</div>
        <button class="auth-google-btn" onclick="handleGoogleLogin()">
          <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Continuar con Google
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  authModalEl = overlay;

  // Load Google config
  loadGoogleConfig();

  return overlay;
}

async function loadGoogleConfig() {
  try {
    const data = await authFetch("/api/auth/config");
    if (!data.google_enabled) {
      const section = document.getElementById("authGoogleSection");
      if (section) section.style.display = "none";
    }
  } catch (_) {
    const section = document.getElementById("authGoogleSection");
    if (section) section.style.display = "none";
  }
}

function openAuthModal(tab) {
  const modal = createAuthModal();
  modal.classList.add("active");
  if (tab) switchAuthTab(tab);
}

function closeAuthModal() {
  if (authModalEl) authModalEl.classList.remove("active");
}

function switchAuthTab(tab) {
  const tabs = document.querySelectorAll(".auth-tab");
  tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tab));

  const registerForm = document.getElementById("authRegisterForm");
  const loginForm = document.getElementById("authLoginForm");
  const verifyForm = document.getElementById("authVerifyForm");
  const googleSection = document.getElementById("authGoogleSection");
  const title = document.getElementById("authModalTitle");
  const subtitle = document.getElementById("authModalSubtitle");

  if (tab === "register") {
    registerForm.style.display = "";
    loginForm.style.display = "none";
    verifyForm.style.display = "none";
    if (googleSection) googleSection.style.display = "";
    title.textContent = "Crear cuenta";
    subtitle.textContent = "Guarda tus diseños y accede a más generaciones.";
  } else if (tab === "login") {
    registerForm.style.display = "none";
    loginForm.style.display = "";
    verifyForm.style.display = "none";
    if (googleSection) googleSection.style.display = "";
    title.textContent = "Bienvenido de nuevo";
    subtitle.textContent = "Inicia sesión para acceder a tus diseños.";
  }

  // Clear errors
  const errors = document.querySelectorAll(".auth-error");
  errors.forEach(e => { e.textContent = ""; });
}

function showVerificationStep(email) {
  const tabs = document.getElementById("authTabs");
  const registerForm = document.getElementById("authRegisterForm");
  const loginForm = document.getElementById("authLoginForm");
  const verifyForm = document.getElementById("authVerifyForm");
  const googleSection = document.getElementById("authGoogleSection");
  const title = document.getElementById("authModalTitle");
  const subtitle = document.getElementById("authModalSubtitle");
  const verifyEmail = document.getElementById("verifyEmail");

  if (tabs) tabs.style.display = "none";
  registerForm.style.display = "none";
  loginForm.style.display = "none";
  verifyForm.style.display = "";
  if (googleSection) googleSection.style.display = "none";
  title.textContent = "Verifica tu email";
  subtitle.textContent = "";
  verifyEmail.textContent = email;
}

// --- Handlers ---

const ERROR_MESSAGES = {
  email_invalid: "Email no válido",
  password_too_short: "La contraseña debe tener al menos 8 caracteres",
  email_exists: "Ya existe una cuenta con este email",
  credentials_required: "Email y contraseña requeridos",
  invalid_credentials: "Email o contraseña incorrectos",
  use_google_login: "Esta cuenta usa inicio de sesión con Google",
  invalid_or_expired_code: "Código incorrecto o expirado",
};

async function handleRegister(e) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector(".auth-submit");
  const errorEl = document.getElementById("registerError");
  errorEl.textContent = "";
  btn.disabled = true;

  const name = form.name.value.trim();
  const email = form.email.value.trim();
  const password = form.password.value;

  try {
    const data = await authFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name: name || undefined }),
    });

    if (!data.ok) {
      errorEl.textContent = ERROR_MESSAGES[data.error] || data.error;
      btn.disabled = false;
      return;
    }

    AUTH_STATE.user = data.user;
    AUTH_STATE.authenticated = true;
    updateAuthUI();

    if (data.needs_verification) {
      showVerificationStep(email);
    } else {
      closeAuthModal();
      if (typeof showToast === "function") showToast("Cuenta creada correctamente");
    }
  } catch (err) {
    errorEl.textContent = "Error de conexión. Inténtalo de nuevo.";
  }
  btn.disabled = false;
}

async function handleLogin(e) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector(".auth-submit");
  const errorEl = document.getElementById("loginError");
  errorEl.textContent = "";
  btn.disabled = true;

  const email = form.email.value.trim();
  const password = form.password.value;

  try {
    const data = await authFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    if (!data.ok) {
      errorEl.textContent = ERROR_MESSAGES[data.error] || data.error;
      btn.disabled = false;
      return;
    }

    AUTH_STATE.user = data.user;
    AUTH_STATE.authenticated = true;
    updateAuthUI();
    closeAuthModal();
    if (typeof showToast === "function") showToast("Sesión iniciada");
  } catch (err) {
    errorEl.textContent = "Error de conexión. Inténtalo de nuevo.";
  }
  btn.disabled = false;
}

async function handleVerifyCode() {
  const code = document.getElementById("verifyCodeInput").value.trim();
  const errorEl = document.getElementById("verifyError");
  const btn = document.getElementById("verifySubmit");
  errorEl.textContent = "";
  btn.disabled = true;

  try {
    const data = await authFetch("/api/auth/verify-email/confirm", {
      method: "POST",
      body: JSON.stringify({ code }),
    });

    if (!data.ok) {
      errorEl.textContent = ERROR_MESSAGES[data.error] || data.error;
      btn.disabled = false;
      return;
    }

    if (AUTH_STATE.user) AUTH_STATE.user.email_verified = true;
    closeAuthModal();
    if (typeof showToast === "function") showToast("Email verificado correctamente");
    updateAuthUI();
  } catch (err) {
    errorEl.textContent = "Error de conexión.";
  }
  btn.disabled = false;
}

async function handleResendCode() {
  const btn = document.getElementById("resendBtn");
  btn.disabled = true;
  btn.textContent = "Enviando...";

  try {
    await authFetch("/api/auth/verify-email/send", { method: "POST" });
    btn.textContent = "Código reenviado";
    setTimeout(() => { btn.textContent = "Reenviar código"; btn.disabled = false; }, 30000);
  } catch (_) {
    btn.textContent = "Error al enviar";
    setTimeout(() => { btn.textContent = "Reenviar código"; btn.disabled = false; }, 5000);
  }
}

function skipVerification() {
  closeAuthModal();
  if (typeof showToast === "function") showToast("Cuenta creada. Podrás verificar tu email más tarde.");
}

function handleGoogleLogin() {
  window.location.href = "/api/auth/google";
}

async function handleLogout() {
  try {
    await authFetch("/api/auth/logout", { method: "POST" });
  } catch (_) { /* ignore */ }
  AUTH_STATE.user = null;
  AUTH_STATE.authenticated = false;
  updateAuthUI();
  if (typeof showToast === "function") showToast("Sesión cerrada");
  if (window.location.pathname === "/mi-cuenta.html") {
    window.location.href = "/";
  }
}

// --- Init ---

// Check for auth query params (from Google OAuth redirect)
function checkAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("auth") === "success") {
    if (typeof showToast === "function") showToast("Sesión iniciada con Google");
    // Clean URL
    window.history.replaceState({}, "", window.location.pathname);
  }
  if (params.get("auth_error")) {
    const errorMap = {
      google_denied: "Se canceló el inicio de sesión con Google",
      google_failed: "Error al iniciar sesión con Google",
    };
    const msg = errorMap[params.get("auth_error")] || "Error de autenticación";
    if (typeof showToast === "function") showToast(msg);
    window.history.replaceState({}, "", window.location.pathname);
  }
}

// Auto-init on page load
document.addEventListener("DOMContentLoaded", () => {
  checkAuth();
  checkAuthRedirect();
});

// Expose globally
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.switchAuthTab = switchAuthTab;
window.handleRegister = handleRegister;
window.handleLogin = handleLogin;
window.handleVerifyCode = handleVerifyCode;
window.handleResendCode = handleResendCode;
window.skipVerification = skipVerification;
window.handleGoogleLogin = handleGoogleLogin;
window.handleLogout = handleLogout;
window.AUTH_STATE = AUTH_STATE;
