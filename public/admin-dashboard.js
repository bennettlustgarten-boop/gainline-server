let USERS = [];

(async () => {
  try {
    await api("/admin/me");
  } catch {
    window.location.href = "/admin.html";
    return;
  }
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await api("/admin/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/admin.html";
  });
  document.getElementById("user-search").addEventListener("input", renderUsersTable);
  document.getElementById("support-hide-resolved").addEventListener("change", loadSupportRequests);
  setupResetModal();

  await Promise.all([loadStats(), loadUsers(), loadSupportRequests()]);
})();

async function loadSupportRequests() {
  const { requests } = await api("/admin/support");
  const hideResolved = document.getElementById("support-hide-resolved").checked;
  const visible = hideResolved ? requests.filter((r) => !r.resolved) : requests;
  const listEl = document.getElementById("support-list");

  listEl.innerHTML = visible.length
    ? visible
        .map(
          (r) => `
        <div class="card" style="margin-bottom:10px; ${r.resolved ? "opacity:0.6;" : ""}">
          <div class="flex-row" style="justify-content:space-between; align-items:flex-start;">
            <div>
              <div style="font-weight:700;">${escapeHtml(r.fromLabel)}</div>
              <div class="hint">${fmtDate(r.createdAt)}${r.replyTo ? ` &middot; reply to: ${escapeHtml(r.replyTo)}` : ""}</div>
            </div>
            ${r.resolved ? '<span class="pill ok">Resolved</span>' : '<span class="pill pending">Open</span>'}
          </div>
          <div style="margin-top:8px; white-space:pre-wrap;">${escapeHtml(r.message)}</div>
          <div class="flex-row" style="gap:8px; margin-top:10px;">
            ${!r.resolved ? `<button type="button" class="small-btn secondary" data-resolve="${r.id}" style="margin-top:0;">Mark resolved</button>` : ""}
            <button type="button" class="small-btn secondary" data-delete-support="${r.id}" style="margin-top:0; color:var(--danger);">Delete</button>
          </div>
        </div>
      `
        )
        .join("")
    : `<p class="hint">No support requests${hideResolved ? " (or all are resolved)" : ""}.</p>`;

  listEl.querySelectorAll("[data-resolve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/admin/support/${btn.dataset.resolve}/resolve`, { method: "POST" });
      loadSupportRequests();
    });
  });
  listEl.querySelectorAll("[data-delete-support]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this support request?")) return;
      await api(`/admin/support/${btn.dataset.deleteSupport}`, { method: "DELETE" });
      loadSupportRequests();
    });
  });
}

async function loadStats() {
  const stats = await api("/admin/stats");
  document.getElementById("stat-row").innerHTML = `
    <div class="card stat-card"><div class="num">${stats.totalUsers}</div><div class="label">Total users</div></div>
    <div class="card stat-card"><div class="num">${stats.totalCoaches}</div><div class="label">Coaches</div></div>
    <div class="card stat-card"><div class="num">${stats.totalClients}</div><div class="label">Clients</div></div>
    <div class="card stat-card"><div class="num">${stats.signups24h}</div><div class="label">Signups, last 24h</div></div>
    <div class="card stat-card"><div class="num">${stats.signups7d}</div><div class="label">Signups, last 7d</div></div>
    <div class="card stat-card"><div class="num">${stats.signups30d}</div><div class="label">Signups, last 30d</div></div>
    <div class="card stat-card"><div class="num">${stats.emailVerified}/${stats.totalUsers}</div><div class="label">Email verified</div></div>
    <div class="card stat-card"><div class="num">${stats.coachesOnboarded}/${stats.totalCoaches}</div><div class="label">Coaches payout-ready</div></div>
    <div class="card stat-card"><div class="num">${stats.activeMemberships}</div><div class="label">Active paid memberships</div></div>
    <div class="card stat-card"><div class="num">${stats.activeAdSubs}</div><div class="label">Active ad listings</div></div>
    <div class="card stat-card"><div class="num">${stats.clientPaymentCount}</div><div class="label">Client → coach payments</div></div>
    <div class="card stat-card"><div class="num">$${stats.clientPaymentTotalUsd.toLocaleString()}</div><div class="label">Total client → coach volume</div></div>
  `;

  const TIER_LABELS = { free: "Starter (free)", t40: "Growth ($40)", t80: "Studio ($80)", t140: "Unlimited ($140)" };
  const entries = Object.entries(stats.tierCounts);
  document.getElementById("tier-breakdown").innerHTML = entries.length
    ? entries.map(([id, count]) => `${escapeHtml(TIER_LABELS[id] || id)}: <strong style="color:var(--text);">${count}</strong>`).join(" &nbsp;&middot;&nbsp; ")
    : "No coaches yet.";
}

async function loadUsers() {
  const { users } = await api("/admin/users");
  USERS = users;
  renderUsersTable();
}

function renderUsersTable() {
  const q = document.getElementById("user-search").value.trim().toLowerCase();
  const filtered = !q
    ? USERS
    : USERS.filter(
        (u) =>
          (u.name || "").toLowerCase().includes(q) ||
          (u.username || "").toLowerCase().includes(q) ||
          (u.email || "").toLowerCase().includes(q)
      );

  document.getElementById("users-tbody").innerHTML = filtered.length
    ? filtered
        .map(
          (u) => `
        <tr>
          <td>${escapeHtml(u.name || "")}</td>
          <td>@${escapeHtml(u.username || "")}</td>
          <td>${escapeHtml(u.role)}${u.role === "coach" ? ` <span class="hint">(${escapeHtml(u.membershipTier || "free")})</span>` : ""}</td>
          <td>${escapeHtml(u.email || "—")}</td>
          <td>${u.emailVerified ? '<span class="pill ok">Yes</span>' : '<span class="pill pending">No</span>'}</td>
          <td>${u.createdAt ? fmtDate(u.createdAt) : "—"}</td>
          <td>
            <button type="button" class="small-btn secondary" data-reset="${u.id}" data-name="${escapeHtml(u.name || u.username)}" style="margin-top:0;">Reset password</button>
            <button type="button" class="small-btn secondary" data-delete="${u.id}" data-name="${escapeHtml(u.name || u.username)}" style="margin-top:0; color:var(--danger);">Delete</button>
          </td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="7" class="hint">No matching users.</td></tr>`;

  document.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.addEventListener("click", () => openResetModal(btn.dataset.reset, btn.dataset.name));
  });
  document.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => deleteUser(btn.dataset.delete, btn.dataset.name));
  });
}

let resetTargetId = null;

function setupResetModal() {
  const overlay = document.getElementById("reset-modal-overlay");
  const close = () => {
    overlay.classList.remove("open");
    document.getElementById("reset-new-password").value = "";
    document.getElementById("reset-status").className = "status";
    document.getElementById("reset-status").textContent = "";
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.id === "reset-modal-close") close();
  });
  document.getElementById("reset-submit-btn").addEventListener("click", async () => {
    const statusEl = document.getElementById("reset-status");
    const newPassword = document.getElementById("reset-new-password").value;
    if (!newPassword) return showStatus(statusEl, "Enter a new password first.", "error");
    try {
      await api(`/admin/users/${resetTargetId}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword }) });
      showStatus(statusEl, "Password updated.", "info");
    } catch (err) {
      showStatus(statusEl, err.message, "error");
    }
  });
}

function openResetModal(userId, name) {
  resetTargetId = userId;
  document.getElementById("reset-modal-name").textContent = `Setting a new password for ${name}.`;
  document.getElementById("reset-modal-overlay").classList.add("open");
}

async function deleteUser(userId, name) {
  if (!confirm(`Permanently delete ${name}'s account? This removes their sheets, check-ins, messages, notes, and everything else tied to them. This can't be undone.`)) return;
  try {
    await api(`/admin/users/${userId}`, { method: "DELETE" });
    await Promise.all([loadStats(), loadUsers()]);
  } catch (err) {
    alert(err.message);
  }
}
