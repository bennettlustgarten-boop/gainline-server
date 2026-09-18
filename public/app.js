// Small shared helpers used by the plain-HTML pages in this folder.

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function showStatus(el, message, type = "info") {
  el.textContent = message;
  el.className = `status visible ${type}`;
}

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// The header "Support" link opens a modal with a message box instead of a
// plain mailto: link — mailto only does something if the OS has a mail
// client registered, which a lot of machines (and any sandboxed/headless
// browser) don't have, so clicking it was a silent no-op. The modal posts
// the message to the server, which stores it for review in the admin
// dashboard (no public support inbox anymore — it was getting bot-flooded).
function setupSupportLink() {
  const link = document.getElementById("support-link");
  if (!link) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <button type="button" class="modal-close" id="support-modal-close">&times;</button>
      <h2 style="margin-top:0;">Contact support</h2>
      <p class="hint">Tell us what's going on and we'll get back to you.</p>
      <label for="support-message">Your question</label>
      <textarea id="support-message" rows="5" placeholder="What's happening?"></textarea>
      <label for="support-reply-email">Your email (optional, so we can reply)</label>
      <input type="email" id="support-reply-email" placeholder="you@example.com" />
      <button type="button" id="support-send-btn" style="margin-top:12px;">Send</button>
      <div class="status" id="support-status"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const statusEl = overlay.querySelector("#support-status");
  const messageEl = overlay.querySelector("#support-message");
  const replyEl = overlay.querySelector("#support-reply-email");
  const sendBtn = overlay.querySelector("#support-send-btn");

  const close = () => overlay.classList.remove("open");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.id === "support-modal-close") close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  link.addEventListener("click", (e) => {
    e.preventDefault();
    statusEl.className = "status";
    statusEl.textContent = "";
    overlay.classList.add("open");
    messageEl.focus();
  });

  sendBtn.addEventListener("click", async () => {
    const message = messageEl.value.trim();
    if (!message) return showStatus(statusEl, "Type your question first.", "error");

    sendBtn.disabled = true;
    showStatus(statusEl, "Sending...", "info");
    try {
      await api("/support", { method: "POST", body: JSON.stringify({ message, replyTo: replyEl.value.trim() }) });
      showStatus(statusEl, "Sent — we'll get back to you soon.", "info");
      messageEl.value = "";
    } catch (err) {
      showStatus(statusEl, err.message, "error");
    } finally {
      sendBtn.disabled = false;
    }
  });
}

// Required for App Store review (Apple guideline 5.1.1(v)): any app that
// supports account creation must let the user delete their account from
// inside the app, not just deactivate it. Confirms with the current
// password, same as changing one, since this is permanent.
function setupDeleteAccountLink() {
  const link = document.getElementById("delete-account-link");
  if (!link) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <button type="button" class="modal-close" id="delete-account-modal-close">&times;</button>
      <h2 style="margin-top:0;">Delete your account</h2>
      <p class="hint">This permanently deletes your account and everything tied to it — sheets, check-ins, messages, notes, payment plans, calendar data. This can't be undone.</p>
      <label for="delete-account-password">Enter your password to confirm</label>
      <input type="password" id="delete-account-password" placeholder="Your password" />
      <button type="button" id="delete-account-submit-btn" style="margin-top:12px; background:var(--danger); color:#1a0505;">Permanently delete my account</button>
      <div class="status" id="delete-account-status"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const statusEl = overlay.querySelector("#delete-account-status");
  const passwordEl = overlay.querySelector("#delete-account-password");
  const submitBtn = overlay.querySelector("#delete-account-submit-btn");

  const close = () => overlay.classList.remove("open");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.id === "delete-account-modal-close") close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  link.addEventListener("click", (e) => {
    e.preventDefault();
    statusEl.className = "status";
    statusEl.textContent = "";
    passwordEl.value = "";
    overlay.classList.add("open");
    passwordEl.focus();
  });

  submitBtn.addEventListener("click", async () => {
    const password = passwordEl.value;
    if (!password) return showStatus(statusEl, "Enter your password first.", "error");

    submitBtn.disabled = true;
    showStatus(statusEl, "Deleting your account...", "info");
    try {
      await api("/auth/me", { method: "DELETE", body: JSON.stringify({ password }) });
      window.location.href = "/";
    } catch (err) {
      showStatus(statusEl, err.message, "error");
      submitBtn.disabled = false;
    }
  });
}

// Coach/client names and other user-entered text get rendered into innerHTML
// in a few places, so escape them first to avoid stored/reflected XSS.
function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

// Belt-and-suspenders alongside the Cache-Control: no-store header the
// server sends for the dashboard pages: some browsers can still restore any
// page from bfcache (e.g. hitting Back right after logout) without
// re-running any JS, showing the previous session's page and data with no
// auth check at all. Forces a real reload from the server in that case,
// which re-runs requireLogin() from scratch on the dashboard pages.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) window.location.reload();
});

// Fetches the logged-in user, or redirects to /login.html if there isn't one.
// Pass a role ("coach" or "client") to also bounce anyone logged in as the
// wrong role to their own dashboard.
async function requireLogin(role) {
  try {
    const { user } = await api("/auth/me");
    if (role && user.role !== role) {
      window.location.href = user.role === "coach" ? "/coach-dashboard.html" : "/client-dashboard.html";
      return null;
    }
    return user;
  } catch (err) {
    window.location.href = `/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    return null;
  }
}

// Blocks dashboard use until the account's email is verified — replaces the
// tab content with a resend-email prompt, leaving the header (so logout /
// support still work) intact. Called from both dashboards right after login.
function showEmailVerifyGate(email) {
  const tabBar = document.getElementById("tab-bar");
  if (tabBar) tabBar.style.display = "none";
  const main = document.querySelector(".dash-main");
  if (!main) return;
  main.innerHTML = `
    <div class="card" style="max-width:480px; margin:40px auto; text-align:center;">
      <h2 style="margin-top:0;">Verify your email</h2>
      <p class="hint">We sent a verification link to <strong>${escapeHtml(email || "your email")}</strong>. Click the link to activate your account — you'll need to do this before you can use Gainline.</p>
      <button id="resend-verify-btn">Resend email</button>
      <div class="status" id="verify-status"></div>
    </div>
  `;
  document.getElementById("resend-verify-btn").addEventListener("click", async () => {
    const statusEl = document.getElementById("verify-status");
    const btn = document.getElementById("resend-verify-btn");
    btn.disabled = true;
    try {
      await api("/auth/resend-verification", { method: "POST" });
      showStatus(statusEl, "Verification email sent — check your inbox.", "info");
    } catch (err) {
      showStatus(statusEl, err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });
}

async function logout() {
  await api("/auth/logout", { method: "POST" }).catch(() => {});
  window.location.href = "/";
}

// Shared coach membership tier ladder — keep in sync with lib/tiers.js.
const TIERS = [
  { id: "free", label: "Starter", max: 2, price: 0 },
  { id: "t40", label: "Growth", max: 5, price: 40 },
  { id: "t80", label: "Studio", max: 15, price: 80 },
  { id: "t140", label: "Unlimited", max: Infinity, price: 140 },
];

function tierForCount(n) {
  return TIERS.find((t) => n <= t.max) || TIERS[TIERS.length - 1];
}

// Common foods with macros per 100g, used by the diet sheet builder to
// auto-calculate calories/macros as a coach adds foods to a meal.
const FOOD_DB = [
  { name: "Chicken breast, cooked", cal: 165, p: 31, c: 0, f: 3.6 },
  { name: "Chicken thigh, cooked", cal: 209, p: 26, c: 0, f: 10.9 },
  { name: "Salmon, cooked", cal: 208, p: 20, c: 0, f: 13 },
  { name: "Tuna, canned in water", cal: 116, p: 26, c: 0, f: 1 },
  { name: "Shrimp, cooked", cal: 99, p: 24, c: 0.2, f: 0.3 },
  { name: "Ground beef 90/10, cooked", cal: 176, p: 20, c: 0, f: 10 },
  { name: "Turkey breast, cooked", cal: 135, p: 30, c: 0, f: 1 },
  { name: "Eggs, whole", cal: 155, p: 13, c: 1.1, f: 11 },
  { name: "Egg whites", cal: 52, p: 11, c: 0.7, f: 0.2 },
  { name: "Greek yogurt, plain 2%", cal: 73, p: 10, c: 3.9, f: 2 },
  { name: "Cottage cheese", cal: 98, p: 11, c: 3.4, f: 4.3 },
  { name: "Milk, 2%", cal: 50, p: 3.4, c: 4.8, f: 2 },
  { name: "Whey protein powder", cal: 380, p: 80, c: 8, f: 5 },
  { name: "White rice, cooked", cal: 130, p: 2.7, c: 28, f: 0.3 },
  { name: "Brown rice, cooked", cal: 123, p: 2.7, c: 26, f: 1 },
  { name: "Oats, dry", cal: 389, p: 17, c: 66, f: 7 },
  { name: "Quinoa, cooked", cal: 120, p: 4.4, c: 21, f: 1.9 },
  { name: "Sweet potato, baked", cal: 86, p: 1.6, c: 20, f: 0.1 },
  { name: "Potato, boiled", cal: 87, p: 2, c: 20, f: 0.1 },
  { name: "Whole wheat bread", cal: 247, p: 13, c: 41, f: 3.4 },
  { name: "White bread", cal: 265, p: 9, c: 49, f: 3.2 },
  { name: "Pasta, cooked", cal: 131, p: 5, c: 25, f: 1.1 },
  { name: "Banana", cal: 89, p: 1.1, c: 23, f: 0.3 },
  { name: "Apple", cal: 52, p: 0.3, c: 14, f: 0.2 },
  { name: "Orange", cal: 47, p: 0.9, c: 12, f: 0.1 },
  { name: "Avocado", cal: 160, p: 2, c: 9, f: 15 },
  { name: "Broccoli", cal: 34, p: 2.8, c: 7, f: 0.4 },
  { name: "Spinach", cal: 23, p: 2.9, c: 3.6, f: 0.4 },
  { name: "Almonds", cal: 579, p: 21, c: 22, f: 50 },
  { name: "Peanut butter", cal: 588, p: 25, c: 20, f: 50 },
  { name: "Olive oil", cal: 884, p: 0, c: 0, f: 100 },
  { name: "Butter", cal: 717, p: 0.9, c: 0.1, f: 81 },
  { name: "Black beans, cooked", cal: 132, p: 8.9, c: 24, f: 0.5 },
  { name: "Lentils, cooked", cal: 116, p: 9, c: 20, f: 0.4 },
  { name: "Chickpeas, cooked", cal: 164, p: 9, c: 27, f: 2.6 },
  { name: "Tofu", cal: 76, p: 8, c: 1.9, f: 4.8 },
  { name: "Cheddar cheese", cal: 403, p: 25, c: 1.3, f: 33 },
  { name: "Mozzarella cheese", cal: 280, p: 28, c: 3.1, f: 17 },
  { name: "Casein protein powder", cal: 360, p: 75, c: 6, f: 2 },
  { name: "Plant protein powder (pea)", cal: 380, p: 75, c: 8, f: 5 },
  { name: "Sirloin steak, cooked", cal: 201, p: 27, c: 0, f: 10 },
  { name: "Flank steak, cooked", cal: 192, p: 29, c: 0, f: 8 },
  { name: "Pork tenderloin, cooked", cal: 143, p: 26, c: 0, f: 3.5 },
  { name: "Tilapia, cooked", cal: 128, p: 26, c: 0, f: 2.7 },
  { name: "Cod, cooked", cal: 105, p: 23, c: 0, f: 0.9 },
  { name: "Turkey bacon, cooked", cal: 150, p: 20, c: 1, f: 7 },
  { name: "Beef jerky", cal: 410, p: 33, c: 11, f: 26 },
  { name: "Rice cakes", cal: 387, p: 8, c: 82, f: 2.8 },
  { name: "Ezekiel bread", cal: 247, p: 10, c: 43, f: 1.5 },
  { name: "Cream of rice, dry", cal: 366, p: 6.6, c: 82, f: 0.6 },
  { name: "Coconut oil", cal: 862, p: 0, c: 0, f: 100 },
  { name: "Walnuts", cal: 654, p: 15, c: 14, f: 65 },
  { name: "Edamame, cooked", cal: 121, p: 12, c: 10, f: 5 },
  { name: "Honey", cal: 304, p: 0.3, c: 82, f: 0 },
];

// Weight units a coach can log a food amount in — macros are always
// calculated per 100g internally, so everything gets converted to grams
// first (see gramsFromAmount).
const WEIGHT_UNITS = { g: 1, oz: 28.3495, lb: 453.592, kg: 1000 };

function gramsFromAmount(amount, unit) {
  return (Number(amount) || 0) * (WEIGHT_UNITS[unit] || 1);
}

function macrosFor(per100, grams) {
  const factor = (Number(grams) || 0) / 100;
  return {
    cal: Math.round((per100.cal || 0) * factor),
    p: Math.round((per100.p || 0) * factor * 10) / 10,
    c: Math.round((per100.c || 0) * factor * 10) / 10,
    f: Math.round((per100.f || 0) * factor * 10) / 10,
  };
}
function sumMacros(list) {
  return list.reduce((a, m) => ({ cal: a.cal + m.cal, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }), { cal: 0, p: 0, c: 0, f: 0 });
}
function fmtMacro(m) {
  return `${Math.round(m.cal)} kcal · P ${Math.round(m.p)}g · C ${Math.round(m.c)}g · F ${Math.round(m.f)}g`;
}

function uid(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 10);
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString();
}
