let ME = null;
let CLIENTS = []; // cached roster, refreshed on Clients/Sheets/Check-ins/Messages tab loads
let COACHES = []; // other onboarded coaches, for coach<->coach messaging
let ACTIVE_THREAD = null; // {id, name}
let ASSISTANT_HISTORY = [];

const CAMERA_ICON = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`;

(async () => {
  ME = await requireLogin("coach");
  if (!ME) return;
  document.getElementById("who-name").textContent = ME.name;
  document.getElementById("who-username").textContent = `@${ME.username}`;
  document.getElementById("logout-btn").addEventListener("click", logout);
  setupSupportLink();

  if (!ME.emailVerified) {
    showEmailVerifyGate(ME.email);
    return;
  }

  const notice = sessionStorage.getItem("gainline_notice");
  if (notice) {
    sessionStorage.removeItem("gainline_notice");
    showNotice(notice);
  }
  const checkout = qs("checkout");
  const sessionId = qs("session_id");
  if (checkout === "success" && sessionId) {
    try {
      await api("/platform/confirm", { method: "POST", body: JSON.stringify({ sessionId }) });
      showNotice("Payment confirmed — thanks!");
    } catch {
      showNotice("Payment received — it may take a moment to show as active.");
    }
  } else if (checkout === "success") {
    showNotice("Payment confirmed — thanks!");
  }
  if (checkout === "cancelled") showNotice("Checkout was cancelled — no charge was made.", true);

  if (!ME.coachSurveyComplete) await showOnboardingSurvey();

  setupTabs();
  setupLightbox();
  const initialTab = qs("tab") || "overview";
  activateTab(initialTab);
})();

function showNotice(text, isWarn) {
  const el = document.getElementById("notice-banner");
  el.style.display = "block";
  el.style.background = isWarn ? "rgba(248,113,113,0.1)" : "rgba(94,234,212,0.1)";
  el.textContent = text;
}

// ---------------- Post-signup onboarding survey ----------------

const CLIENT_COUNT_BANDS = [
  { value: "0", label: "0 — just starting out" },
  { value: "1-2", label: "1–2 clients" },
  { value: "3-5", label: "3–5 clients" },
  { value: "6-15", label: "6–15 clients" },
  { value: "16+", label: "16+ clients" },
];

const BAND_TO_RECOMMENDED_TIER = { "0": "free", "1-2": "free", "3-5": "t40", "6-15": "t80", "16+": "t140" };

// Shown once, right after a coach's first login — two quick questions, then
// every membership tier with its trial offer, so they can pick one on the
// spot instead of having to go find the Membership tab later.
function showOnboardingSurvey() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay open";
    overlay.innerHTML = `<div class="modal-card" style="max-width:560px;"><div id="onboarding-body"></div></div>`;
    document.body.appendChild(overlay);
    const body = overlay.querySelector("#onboarding-body");

    function onEscape(e) {
      if (e.key === "Escape") skipAndClose();
    }

    function close() {
      document.removeEventListener("keydown", onEscape);
      overlay.remove();
      resolve();
    }

    async function skipAndClose() {
      try {
        await api("/coach/survey", { method: "POST", body: JSON.stringify({ skip: true }) });
      } catch {}
      close();
    }

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) skipAndClose();
    });
    document.addEventListener("keydown", onEscape);

    function renderQuestions() {
      body.innerHTML = `
        <h2 style="margin-top:0;">Welcome to Gainline!</h2>
        <p class="hint">A couple quick questions to help set up your account.</p>

        <label>How many clients do you currently have?</label>
        <div class="flex-row" id="ob-client-count" style="flex-wrap:wrap;">
          ${CLIENT_COUNT_BANDS.map((b) => `<button type="button" class="small-btn button secondary" data-band="${b.value}">${b.label}</button>`).join("")}
        </div>

        <label style="margin-top:14px;">What type of coaching do you do?</label>
        <input type="text" id="ob-coaching-type" placeholder="e.g. strength training, online nutrition coaching..." />

        <button id="ob-continue-btn" style="margin-top:16px;" disabled>Continue</button>
        <div style="margin-top:10px;"><a href="#" id="ob-skip-link" class="hint">Skip for now</a></div>
      `;

      let selectedBand = null;
      const bandButtons = body.querySelectorAll("[data-band]");
      bandButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedBand = btn.dataset.band;
          bandButtons.forEach((b) => b.classList.toggle("secondary", b !== btn));
          document.getElementById("ob-continue-btn").disabled = false;
        });
      });

      document.getElementById("ob-continue-btn").addEventListener("click", async () => {
        const coachingType = document.getElementById("ob-coaching-type").value.trim();
        try {
          await api("/coach/survey", { method: "POST", body: JSON.stringify({ clientCountBand: selectedBand, coachingType }) });
        } catch {}
        renderTierPicker(selectedBand);
      });

      document.getElementById("ob-skip-link").addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          await api("/coach/survey", { method: "POST", body: JSON.stringify({ skip: true }) });
        } catch {}
        close();
      });
    }

    async function renderTierPicker(band) {
      body.innerHTML = `<p class="hint">Loading plans...</p>`;
      const { tiers, trialDays } = await api("/platform/status");
      const recommended = BAND_TO_RECOMMENDED_TIER[band] || "free";

      body.innerHTML = `
        <h2 style="margin-top:0;">Pick your plan</h2>
        <p class="hint">Every paid plan includes a ${trialDays}-day free trial — cancel before it ends and you won't be charged.</p>
        <div class="tier-ladder">
          ${tiers.map((t) => `
            <div class="tier-col ${t.id === recommended ? "active" : ""}" data-tier="${t.id}">
              ${t.id === recommended ? `<div class="pill ok" style="margin-bottom:6px;">Recommended</div>` : ""}
              <div class="label">${escapeHtml(t.label)}</div>
              <div class="meta">${t.max === null ? "&infin;" : `&le;${t.max}`} &middot; ${t.price === 0 ? "Free" : `$${t.price}/mo`}</div>
              <button type="button" class="small-btn" style="margin-top:8px;" data-choose-tier="${t.id}">${t.price === 0 ? "Start free" : `Start ${trialDays}-day trial`}</button>
            </div>
          `).join("")}
        </div>
        <div class="status" id="ob-tier-status"></div>
        <div style="margin-top:14px;"><a href="#" id="ob-later-link" class="hint">I'll choose later</a></div>
      `;

      body.querySelectorAll("[data-choose-tier]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const statusEl = document.getElementById("ob-tier-status");
          btn.disabled = true;
          try {
            const { url } = await api("/platform/membership/checkout", { method: "POST", body: JSON.stringify({ tierId: btn.dataset.chooseTier }) });
            if (url) window.location.href = url;
            else close();
          } catch (err) {
            showStatus(statusEl, err.message, "error");
            btn.disabled = false;
          }
        });
      });

      document.getElementById("ob-later-link").addEventListener("click", (e) => {
        e.preventDefault();
        close();
      });
    }

    renderQuestions();
  });
}

// ---------------- Tabs ----------------

function setupTabs() {
  document.getElementById("tab-bar").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (btn) activateTab(btn.dataset.tab);
  });
}

const TAB_LOADERS = {
  overview: loadOverview,
  clients: loadClients,
  calendar: loadCalendarTab,
  sheets: loadSheetsTab,
  checkins: loadCheckinsTab,
  billing: loadBillingTab,
  messages: loadMessagesTab,
  assistant: loadAssistantTab,
  ads: loadAdsTab,
  membership: loadMembershipTab,
};

function activateTab(tab) {
  if (!TAB_LOADERS[tab]) tab = "overview";
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll("[data-tab-panel]").forEach((p) => p.classList.toggle("active", p.dataset.tabPanel === tab));
  TAB_LOADERS[tab]();
}

// ---------------- Overview ----------------

async function loadOverview() {
  const { clients, tier } = await api("/clients");
  CLIENTS = clients;
  const tiers = TIERS;
  const idx = tiers.findIndex((t) => t.id === tier.id);
  const next = tiers[idx + 1];

  document.getElementById("overview-plan").innerHTML = `
    <div class="hint">YOUR PLAN</div>
    <div style="display:flex; align-items:baseline; gap:8px; margin-top:4px;">
      <div style="font-size:24px; font-weight:800;">${escapeHtml(tier.label)}</div>
      <span class="pill ok">${tier.price === 0 ? "Free" : `$${tier.price}/mo`}</span>
    </div>
    <div class="hint" style="margin-top:6px;">
      ${clients.length} of ${tier.max === Infinity ? "unlimited" : tier.max} client slots used
      ${next ? ` — upgrade to ${next.label} ($${next.price}/mo) for ${next.max === Infinity ? "unlimited" : next.max} clients` : ""}
    </div>
    <div class="tier-ladder">
      ${tiers.map((t) => `
        <div class="tier-col ${t.id === tier.id ? "active" : ""}">
          <div class="label">${escapeHtml(t.label)}</div>
          <div class="meta">${t.max === Infinity ? "&infin;" : `&le;${t.max}`} &middot; ${t.price === 0 ? "Free" : `$${t.price}/mo`}</div>
        </div>
      `).join("")}
    </div>
  `;

  const sheetsSent = clients.reduce((a, c) => a + (c.sheetCount || 0), 0);
  const checkinsReceived = clients.reduce((a, c) => a + (c.checkinCount || 0), 0);
  document.getElementById("overview-stats").innerHTML = `
    <div class="card stat-card"><div class="num">${clients.length}</div><div class="label">Active clients</div></div>
    <div class="card stat-card"><div class="num">${sheetsSent}</div><div class="label">Sheets sent</div></div>
    <div class="card stat-card"><div class="num">${checkinsReceived}</div><div class="label">Check-ins received</div></div>
  `;
}

// ---------------- Clients ----------------

async function loadClients() {
  document.getElementById("clients-roster-view").style.display = "block";
  document.getElementById("client-detail-view").style.display = "none";
  renderInviteCard();
  const { clients, tier } = await api("/clients");
  CLIENTS = clients;
  const atCap = clients.length >= tier.max;

  const searchInput = document.getElementById("client-search");
  searchInput.disabled = atCap;
  searchInput.oninput = debounce(async () => {
    const q = searchInput.value.trim();
    const resultsEl = document.getElementById("search-results");
    if (!q) { resultsEl.innerHTML = ""; return; }
    const { users } = await api(`/users/search?q=${encodeURIComponent(q)}`);
    const candidates = users.filter((u) => !clients.find((c) => c.id === u.id));
    resultsEl.innerHTML = candidates.length
      ? candidates.map((u) => `
          <div class="flex-row" style="justify-content:space-between; padding:8px; background:var(--surface-2); border-radius:8px; margin-bottom:6px;">
            <span>${escapeHtml(u.name)} <span class="hint">@${escapeHtml(u.username)}</span></span>
            <button class="small-btn" data-add-client="${u.id}">Add</button>
          </div>
        `).join("")
      : `<p class="hint">No matching clients found.</p>`;
  }, 300);

  document.getElementById("search-results").onclick = async (e) => {
    const btn = e.target.closest("[data-add-client]");
    if (!btn) return;
    btn.disabled = true;
    try {
      await api("/clients", { method: "POST", body: JSON.stringify({ clientId: btn.dataset.addClient }) });
      searchInput.value = "";
      document.getElementById("search-results").innerHTML = "";
      loadClients();
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
    }
  };

  if (atCap) {
    document.getElementById("search-card").insertAdjacentHTML(
      "beforeend",
      `<p class="hint" style="color:var(--danger);">You're at your ${escapeHtml(tier.label)} plan limit (${tier.max}). Upgrade on the Membership tab to add more clients.</p>`
    );
  }

  const listEl = document.getElementById("clients-list");
  listEl.innerHTML = clients.length
    ? clients.map((c) => `
        <div class="card flex-row" style="justify-content:space-between; cursor:pointer;" data-open-client="${c.id}" data-client-name="${escapeHtml(c.name)}" data-client-username="${escapeHtml(c.username)}">
          <div>
            <div style="font-weight:700;">${escapeHtml(c.name)} <span class="hint">@${escapeHtml(c.username)}</span></div>
            <div class="hint">${c.sheetCount || 0} sheets &middot; ${c.checkinCount || 0} check-ins</div>
          </div>
          <span class="hint">View profile &rarr;</span>
        </div>
      `).join("")
    : `<div class="card hint">No clients yet — search above or send your invite link.</div>`;
  listEl.querySelectorAll("[data-open-client]").forEach((el) => {
    el.onclick = () => openClientDetail(el.dataset.openClient, el.dataset.clientName, el.dataset.clientUsername);
  });
}

async function renderInviteCard() {
  const card = document.getElementById("invite-card");
  card.innerHTML = `
    <h2 style="margin-top:0;">Invite a client by email</h2>
    <p class="hint">Generate a link — when someone signs up through it, they're connected to you automatically (if you have an open slot).</p>
    <button id="gen-invite-btn">Generate invite link</button>
    <div id="invite-link-area" style="margin-top:10px;"></div>
  `;
  document.getElementById("gen-invite-btn").addEventListener("click", async () => {
    const { token } = await api("/invites", { method: "POST" });
    const url = `${window.location.origin}/signup.html?invite=${token}`;
    const subject = `${ME.name} invited you to Gainline`;
    const body = `Hi,\n\n${ME.name} invited you to join Gainline as a client. Open the link below to create your account:\n\n${url}\n\nSee you inside!`;

    // A plain mailto: link only does something if the OS has a mail app
    // registered as the default handler — a lot of people only use webmail
    // (Gmail/Outlook in the browser) with nothing registered, so mailto:
    // silently does nothing for them. Gmail and Outlook both have a "web
    // compose" URL that opens a real prefilled draft in a new tab
    // regardless of OS mail settings; mailto: is offered too as a fallback
    // for anyone whose actual mail app (Apple Mail, Outlook desktop, etc.)
    // is genuinely set as their system default.
    const gmailHref = `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    // outlook.live.com is the personal-account (Outlook.com/Hotmail) compose
    // link — far more likely to match a coach's actual account than
    // outlook.office.com, which is for work/school Microsoft 365 accounts
    // and would just dead-end anyone without one at a login wall.
    const outlookHref = `https://outlook.live.com/mail/0/deeplink/compose?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const mailtoHref = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    document.getElementById("invite-link-area").innerHTML = `
      <div class="flex-row">
        <input type="text" readonly value="${escapeHtml(url)}" style="flex:1;" onclick="this.select()" />
        <button class="small-btn secondary button" id="copy-invite-btn">Copy</button>
      </div>
      <p class="hint" style="margin-top:10px; margin-bottom:4px;">Send it with:</p>
      <div class="flex-row">
        <a class="button small-btn secondary" target="_blank" rel="noopener" href="${gmailHref}">Gmail</a>
        <a class="button small-btn secondary" target="_blank" rel="noopener" href="${outlookHref}">Outlook</a>
        <a class="button small-btn secondary" href="${mailtoHref}">Other mail app</a>
      </div>
    `;
    document.getElementById("copy-invite-btn").addEventListener("click", () => {
      navigator.clipboard?.writeText(url).catch(() => {});
    });
  });
}

// ---------------- Calendar (custom event types, in-person training / check-in / etc.) ----------------

let calMonthCursor = null; // Date, first-of-month currently shown
let calSelectedKey = null; // "YYYY-MM-DD" or null
let CAL_TYPES = []; // [{id, label}] — this coach's own manageable list

async function loadCalendarTab() {
  if (!CLIENTS.length) CLIENTS = (await api("/clients")).clients;
  CAL_TYPES = (await api("/calendar/types")).types;
  renderCalendarBuilder();
  if (!calMonthCursor) {
    const now = new Date();
    calMonthCursor = new Date(now.getFullYear(), now.getMonth(), 1);
    calSelectedKey = dateKey(now);
  }
  renderMonthCalendar();
}

function renderCalendarBuilder() {
  const el = document.getElementById("calendar-builder");
  if (!CLIENTS.length) {
    el.innerHTML = `<p class="hint">Add a client first (Clients tab) to schedule something with them.</p>`;
    return;
  }
  el.innerHTML = `
    <h2 style="margin-top:0;">Schedule with a client</h2>
    <label>Client</label>
    <select id="cal-client">${CLIENTS.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}</select>

    <label>Type</label>
    <select id="cal-type-select">${CAL_TYPES.map((t) => `<option value="${escapeHtml(t.label)}">${escapeHtml(t.label)}</option>`).join("")}</select>
    <div class="flex-row" id="cal-type-chips" style="margin-top:6px;"></div>
    <div class="flex-row" style="margin-top:6px;">
      <input type="text" id="cal-new-type" placeholder="Add a new type..." style="flex:1;" />
      <button type="button" class="small-btn secondary" id="cal-add-type-btn">+ Add</button>
    </div>

    <label style="margin-top:12px;">Title (optional)</label>
    <input type="text" id="cal-title" placeholder="e.g. Leg day session" />

    <label>Date &amp; time</label>
    <input type="datetime-local" id="cal-start" />

    <label>Duration (minutes)</label>
    <input type="number" id="cal-duration" min="15" step="15" value="60" />

    <label>Repeats</label>
    <div class="flex-row">
      <button type="button" class="small-btn" id="cal-rec-none">One-time</button>
      <button type="button" class="small-btn secondary" id="cal-rec-weekly">Weekly</button>
    </div>

    <div id="cal-until-row" style="display:none;">
      <label>Repeat until (optional)</label>
      <input type="date" id="cal-until" />
    </div>

    <button id="cal-send-btn" style="margin-top:12px;">Schedule</button>
    <div class="status" id="cal-status"></div>
  `;

  renderCalTypeChips();

  let calRecurrence = "none";

  document.getElementById("cal-add-type-btn").onclick = async () => {
    const input = document.getElementById("cal-new-type");
    if (!input.value.trim()) return;
    CAL_TYPES = (await api("/calendar/types", { method: "POST", body: JSON.stringify({ label: input.value }) })).types;
    const selected = input.value.trim();
    input.value = "";
    renderCalendarBuilder();
    document.getElementById("cal-type-select").value = selected;
  };

  document.getElementById("cal-rec-none").onclick = () => {
    calRecurrence = "none";
    document.getElementById("cal-rec-none").classList.remove("secondary");
    document.getElementById("cal-rec-weekly").classList.add("secondary");
    document.getElementById("cal-until-row").style.display = "none";
  };
  document.getElementById("cal-rec-weekly").onclick = () => {
    calRecurrence = "weekly";
    document.getElementById("cal-rec-weekly").classList.remove("secondary");
    document.getElementById("cal-rec-none").classList.add("secondary");
    document.getElementById("cal-until-row").style.display = "block";
  };

  document.getElementById("cal-send-btn").onclick = async () => {
    const statusEl = document.getElementById("cal-status");
    const clientId = document.getElementById("cal-client").value;
    const startAt = document.getElementById("cal-start").value;
    const typeLabel = document.getElementById("cal-type-select").value;
    if (!typeLabel) { showStatus(statusEl, "Add a type first.", "error"); return; }
    if (!startAt) { showStatus(statusEl, "Pick a date and time.", "error"); return; }
    try {
      await api("/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          clientId,
          typeLabel,
          title: document.getElementById("cal-title").value,
          startAt,
          durationMinutes: document.getElementById("cal-duration").value,
          recurrence: calRecurrence,
          until: calRecurrence === "weekly" ? document.getElementById("cal-until").value || null : null,
        }),
      });
      showStatus(statusEl, "Scheduled!", "info");
      document.getElementById("cal-title").value = "";
      document.getElementById("cal-start").value = "";
      renderMonthCalendar();
    } catch (err) {
      showStatus(statusEl, err.message, "error");
    }
  };
}

function renderCalTypeChips() {
  const el = document.getElementById("cal-type-chips");
  el.innerHTML = CAL_TYPES.map((t) => `
    <span class="pill" style="background:var(--surface-2); display:inline-flex; align-items:center; gap:5px;">
      ${escapeHtml(t.label)}
      <button type="button" data-delete-type="${t.id}" style="background:none; border:none; color:var(--text-dim); cursor:pointer; padding:0; margin-top:0; font-size:13px; line-height:1;">&times;</button>
    </span>
  `).join("");
  el.querySelectorAll("[data-delete-type]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Delete this event type? Events already scheduled with it keep their label.")) return;
      CAL_TYPES = (await api(`/calendar/types/${btn.dataset.deleteType}`, { method: "DELETE" })).types;
      renderCalendarBuilder();
    };
  });
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The grid always shows full weeks, so it pads out to the Sunday before the
// 1st and the Saturday after the last day of the month.
function monthGridRange(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(last);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));
  gridEnd.setHours(23, 59, 59, 999);
  return { first, last, gridStart, gridEnd };
}

async function renderMonthCalendar() {
  const container = document.getElementById("calendar-list");
  const { first, gridStart, gridEnd } = monthGridRange(calMonthCursor);
  const { occurrences } = await api(`/calendar/events?from=${gridStart.toISOString()}&to=${gridEnd.toISOString()}`);

  const byDay = {};
  occurrences.forEach((o) => {
    const key = dateKey(new Date(o.occursAt));
    (byDay[key] = byDay[key] || []).push(o);
  });
  Object.values(byDay).forEach((list) => list.sort((a, b) => a.occursAt - b.occursAt));

  const todayKey = dateKey(new Date());
  const monthLabel = first.toLocaleDateString([], { month: "long", year: "numeric" });
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const cells = [];
  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
    const key = dateKey(d);
    const inMonth = d.getMonth() === calMonthCursor.getMonth();
    const dayEvents = byDay[key] || [];
    const shown = dayEvents.slice(0, 3);
    const extra = dayEvents.length - shown.length;
    cells.push(`
      <div class="month-cell ${inMonth ? "" : "other-month"} ${key === todayKey ? "today" : ""} ${key === calSelectedKey ? "selected" : ""}" data-day-cell="${key}">
        <div class="month-day-num">${d.getDate()}</div>
        ${shown.map((o) => `<div class="month-chip" title="${escapeHtml(o.typeLabel)}">${escapeHtml(o.clientName.split(" ")[0])}</div>`).join("")}
        ${extra > 0 ? `<div class="month-chip more">+${extra} more</div>` : ""}
      </div>
    `);
  }

  const selected = calSelectedKey ? (byDay[calSelectedKey] || []) : [];
  const selectedLabel = calSelectedKey ? new Date(calSelectedKey + "T00:00:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) : "";

  container.innerHTML = `
    <div class="card">
      <div class="month-nav">
        <button type="button" class="month-nav-btn" id="cal-prev-month">&larr;</button>
        <div class="month-nav-title">${monthLabel}</div>
        <button type="button" class="month-nav-btn" id="cal-next-month">&rarr;</button>
      </div>
      <div class="month-grid">
        ${WEEKDAYS.map((w) => `<div class="month-weekday">${w}</div>`).join("")}
        ${cells.join("")}
      </div>
    </div>
    <div class="card" style="margin-top:12px;">
      <div class="hint">${calSelectedKey ? selectedLabel.toUpperCase() : "SELECT A DAY"}</div>
      ${
        calSelectedKey
          ? selected.length
            ? selected.map((o) => `
                <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
                  <div class="flex-row" style="justify-content:space-between;">
                    <span class="pill" style="background:var(--surface-2);">${escapeHtml(o.typeLabel)}</span>
                    ${o.recurrence === "weekly" ? `<span class="hint">Weekly</span>` : ""}
                  </div>
                  <div style="font-weight:800; margin-top:6px;">${escapeHtml(o.clientName)}${o.title ? ` — ${escapeHtml(o.title)}` : ""}</div>
                  <div class="hint">${new Date(o.occursAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} &middot; ${o.durationMinutes} min</div>
                  <button type="button" class="small-btn secondary" style="margin-top:8px;" data-cancel-event="${o.eventId}">${o.recurrence === "weekly" ? "Cancel series" : "Cancel"}</button>
                </div>
              `).join("")
            : `<div class="hint" style="margin-top:8px;">Nothing scheduled.</div>`
          : ""
      }
    </div>
  `;

  document.getElementById("cal-prev-month").onclick = () => {
    calMonthCursor = new Date(calMonthCursor.getFullYear(), calMonthCursor.getMonth() - 1, 1);
    calSelectedKey = null;
    renderMonthCalendar();
  };
  document.getElementById("cal-next-month").onclick = () => {
    calMonthCursor = new Date(calMonthCursor.getFullYear(), calMonthCursor.getMonth() + 1, 1);
    calSelectedKey = null;
    renderMonthCalendar();
  };
  container.querySelectorAll("[data-day-cell]").forEach((cell) => {
    cell.onclick = () => { calSelectedKey = cell.dataset.dayCell; renderMonthCalendar(); };
  });
  container.querySelectorAll("[data-cancel-event]").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Cancel this scheduled event?")) return;
      await api(`/calendar/events/${btn.dataset.cancelEvent}`, { method: "DELETE" });
      renderMonthCalendar();
    };
  });
}

// ---------------- Sheets ----------------

let sheetDraft = { type: "workout", days: [], meals: [], columns: { sets: true, reps: true, weight: true, rest: true, notes: true } };
const WORKOUT_COLUMN_LABELS = { sets: "Sets", reps: "Reps", weight: "Weight", rest: "Rest", notes: "Notes" };

function newDay(n) { return { id: uid("day_"), name: `Day ${n}`, exercises: [] }; }
function newExercise() { return { id: uid("ex_"), name: "", sets: "", reps: "", weight: "", rest: "", notes: "" }; }
function newMeal(n) { return { id: uid("meal_"), name: n === 1 ? "Breakfast" : `Meal ${n}`, foods: [] }; }
function newFood() { return { id: uid("food_"), source: "db", name: "", amount: 100, unit: "g", per100: { cal: 0, p: 0, c: 0, f: 0 } }; }

async function loadSheetsTab() {
  if (!CLIENTS.length) CLIENTS = (await api("/clients")).clients;
  if (!CLIENTS.length) {
    document.getElementById("sheet-builder").innerHTML = `<p class="hint">Add a client first (Clients tab) to send sheets.</p>`;
    document.getElementById("sheet-history").innerHTML = "";
    return;
  }
  if (!sheetDraft.days.length) sheetDraft.days = [newDay(1)];
  if (!sheetDraft.meals.length) sheetDraft.meals = [newMeal(1)];
  renderSheetBuilder();
}

function renderSheetBuilder() {
  const builder = document.getElementById("sheet-builder");
  const clientOptions = CLIENTS.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

  builder.innerHTML = `
    <label>Client</label>
    <select id="sheet-client">${clientOptions}</select>

    <label>Sheet type</label>
    <div class="flex-row">
      <button type="button" class="small-btn ${sheetDraft.type === "workout" ? "" : "secondary"}" id="type-workout">Workout</button>
      <button type="button" class="small-btn ${sheetDraft.type === "diet" ? "" : "secondary"}" id="type-diet">Diet</button>
    </div>

    <label>Title</label>
    <input type="text" id="sheet-title" placeholder="${sheetDraft.type === "workout" ? "e.g. Week 3 Program" : "e.g. Cut Phase — Week 1"}" />

    ${sheetDraft.type === "workout" ? `
      <label style="margin-top:12px;">Exercise details to include</label>
      <div class="flex-row" id="column-toggles"></div>
    ` : ""}

    <div id="sheet-body" style="margin-top:12px;"></div>

    <label>Additional notes / supplements</label>
    <textarea id="sheet-notes" rows="2" style="width:100%; box-sizing:border-box; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--surface-2); color:var(--text);"></textarea>

    <button id="sheet-send-btn">Send sheet</button>
    <div class="status" id="sheet-status"></div>
  `;

  document.getElementById("type-workout").onclick = () => { sheetDraft.type = "workout"; renderSheetBuilder(); };
  document.getElementById("type-diet").onclick = () => { sheetDraft.type = "diet"; renderSheetBuilder(); };
  document.getElementById("sheet-send-btn").onclick = sendSheet;

  if (sheetDraft.type === "workout") renderColumnToggles();
  renderSheetBody();
}

function renderColumnToggles() {
  const el = document.getElementById("column-toggles");
  el.innerHTML = Object.keys(WORKOUT_COLUMN_LABELS).map((key) => `
    <button type="button" class="small-btn ${sheetDraft.columns[key] ? "" : "secondary"}" data-toggle-col="${key}">${sheetDraft.columns[key] ? "✓ " : ""}${WORKOUT_COLUMN_LABELS[key]}</button>
  `).join("");
  el.querySelectorAll("[data-toggle-col]").forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.toggleCol;
      sheetDraft.columns[key] = !sheetDraft.columns[key];
      renderColumnToggles();
      renderSheetBody();
    };
  });
}

function renderSheetBody() {
  const bodyEl = document.getElementById("sheet-body");
  if (sheetDraft.type === "workout") {
    bodyEl.innerHTML = sheetDraft.days.map((d) => dayTableHtml(d)).join("") + `<button type="button" class="small-btn secondary" id="add-day-btn">+ Add day</button>`;
    document.getElementById("add-day-btn").onclick = () => { sheetDraft.days.push(newDay(sheetDraft.days.length + 1)); renderSheetBody(); };
    bindDayEvents();
  } else {
    bodyEl.innerHTML = sheetDraft.meals.map((m) => mealTableHtml(m)).join("") + `<button type="button" class="small-btn secondary" id="add-meal-btn">+ Add meal</button>` + dietTotalsHtml();
    document.getElementById("add-meal-btn").onclick = () => { sheetDraft.meals.push(newMeal(sheetDraft.meals.length + 1)); renderSheetBody(); };
    bindMealEvents();
  }
}

const COLUMN_PLACEHOLDERS = { sets: "3", reps: "8-10", weight: "lbs", rest: "90s", notes: "Cues" };

function dayTableHtml(day) {
  const activeCols = Object.keys(WORKOUT_COLUMN_LABELS).filter((k) => sheetDraft.columns[k]);
  return `
    <div class="card" data-day="${day.id}" style="margin-bottom:10px;">
      <div class="flex-row">
        <input type="text" class="cell-input" style="font-weight:700;" data-day-name value="${escapeHtml(day.name)}" placeholder="Day name" />
        <button type="button" class="small-btn secondary" data-remove-day>Remove day</button>
      </div>
      <div class="sheet-table-wrap">
        <table class="sheet-table">
          <thead><tr><th>Exercise</th>${activeCols.map((k) => `<th>${WORKOUT_COLUMN_LABELS[k]}</th>`).join("")}<th></th></tr></thead>
          <tbody>
            ${day.exercises.map((ex) => `
              <tr data-ex="${ex.id}">
                <td><input class="cell-input" data-f="name" value="${escapeHtml(ex.name)}" placeholder="Exercise" /></td>
                ${activeCols.map((k) => `<td><input class="cell-input cell-num" data-f="${k}" value="${escapeHtml(ex[k])}" placeholder="${COLUMN_PLACEHOLDERS[k]}" /></td>`).join("")}
                <td><button type="button" class="small-btn secondary" data-remove-ex>&times;</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <button type="button" class="small-btn secondary" data-add-ex>+ Add row</button>
    </div>
  `;
}

function mealTableHtml(meal) {
  const macroList = meal.foods.filter((f) => f.name).map((f) => macrosFor(f.per100, gramsFromAmount(f.amount, f.unit)));
  const totals = sumMacros(macroList);
  return `
    <div class="card" data-meal="${meal.id}" style="margin-bottom:10px;">
      <div class="flex-row">
        <input type="text" class="cell-input" style="font-weight:700;" data-meal-name value="${escapeHtml(meal.name)}" placeholder="Meal name" />
        <button type="button" class="small-btn secondary" data-remove-meal>Remove meal</button>
      </div>
      <div class="sheet-table-wrap">
        <table class="sheet-table">
          <thead><tr><th>Food</th><th>Amount</th><th>Kcal</th><th>Protein</th><th>Carbs</th><th>Fat</th><th></th></tr></thead>
          <tbody>
            ${meal.foods.map((f) => foodRowHtml(f)).join("")}
          </tbody>
          ${meal.foods.length ? `<tfoot><tr><td>Meal total</td><td></td><td>${totals.cal}</td><td>${totals.p}g</td><td>${totals.c}g</td><td>${totals.f}g</td><td></td></tr></tfoot>` : ""}
        </table>
      </div>
      <button type="button" class="small-btn secondary" data-add-food>+ Add row</button>
    </div>
  `;
}

function foodRowHtml(food) {
  const isCustom = food.source === "custom";
  const m = macrosFor(food.per100, gramsFromAmount(food.amount, food.unit));
  const foodOptions = `<option value="" disabled ${food.name ? "" : "selected"}>Choose a food...</option>` +
    FOOD_DB.map((f) => `<option value="${escapeHtml(f.name)}" ${food.name === f.name ? "selected" : ""}>${escapeHtml(f.name)}</option>`).join("") +
    `<option value="__custom">+ Custom food...</option>`;
  const unitOptions = Object.keys(WEIGHT_UNITS).map((u) => `<option value="${u}" ${food.unit === u ? "selected" : ""}>${u}</option>`).join("");
  const amountCell = `
    <div class="flex-row" style="flex-wrap:nowrap; gap:2px;">
      <input class="cell-input cell-num" style="width:44px;" data-f="amount" value="${escapeHtml(food.amount)}" />
      <select class="cell-input" style="width:52px; padding:5px 2px;" data-f="unit">${unitOptions}</select>
    </div>
  `;

  return `
    <tr data-food="${food.id}">
      <td style="min-width:160px;">
        ${isCustom
          ? `<input class="cell-input" data-f="name" value="${escapeHtml(food.name)}" placeholder="Custom food name" />`
          : `<select class="cell-input" data-f="select">${foodOptions}</select>`}
      </td>
      ${isCustom ? `
        <td>${amountCell}</td>
        <td><input class="cell-input cell-num" data-f="cal" value="${food.per100.cal || ""}" placeholder="kcal/100g" /></td>
        <td><input class="cell-input cell-num" data-f="p" value="${food.per100.p || ""}" placeholder="P/100g" /></td>
        <td><input class="cell-input cell-num" data-f="c" value="${food.per100.c || ""}" placeholder="C/100g" /></td>
        <td><input class="cell-input cell-num" data-f="f" value="${food.per100.f || ""}" placeholder="F/100g" /></td>
      ` : `
        <td>${amountCell}</td>
        <td class="readcell">${food.name ? m.cal : "—"}</td>
        <td class="readcell">${food.name ? m.p : "—"}</td>
        <td class="readcell">${food.name ? m.c : "—"}</td>
        <td class="readcell">${food.name ? m.f : "—"}</td>
      `}
      <td><button type="button" class="small-btn secondary" data-remove-food>&times;</button></td>
    </tr>
  `;
}

function dietTotalsHtml() {
  const all = sheetDraft.meals.flatMap((m) => m.foods.filter((f) => f.name).map((f) => macrosFor(f.per100, gramsFromAmount(f.amount, f.unit))));
  const totals = sumMacros(all);
  if (totals.cal === 0) return "";
  return `<div class="card" style="background:var(--surface-2);"><div class="hint">PLAN TOTAL FOR THE DAY</div><div style="font-weight:800; margin-top:4px;">${fmtMacro(totals)}</div></div>`;
}

function bindDayEvents() {
  const bodyEl = document.getElementById("sheet-body");
  bodyEl.querySelectorAll("[data-day]").forEach((dayEl) => {
    const day = sheetDraft.days.find((d) => d.id === dayEl.dataset.day);
    dayEl.querySelector("[data-day-name]").onchange = (e) => { day.name = e.target.value; };
    dayEl.querySelector("[data-remove-day]").onclick = () => { sheetDraft.days = sheetDraft.days.filter((d) => d.id !== day.id); renderSheetBody(); };
    dayEl.querySelector("[data-add-ex]").onclick = () => { day.exercises.push(newExercise()); renderSheetBody(); };
    dayEl.querySelectorAll("tr[data-ex]").forEach((row) => {
      const ex = day.exercises.find((x) => x.id === row.dataset.ex);
      row.querySelectorAll("[data-f]").forEach((input) => {
        input.onchange = (e) => { ex[input.dataset.f] = e.target.value; };
      });
      row.querySelector("[data-remove-ex]").onclick = () => { day.exercises = day.exercises.filter((x) => x.id !== ex.id); renderSheetBody(); };
    });
  });
}

function bindMealEvents() {
  const bodyEl = document.getElementById("sheet-body");
  bodyEl.querySelectorAll("[data-meal]").forEach((mealEl) => {
    const meal = sheetDraft.meals.find((m) => m.id === mealEl.dataset.meal);
    mealEl.querySelector("[data-meal-name]").onchange = (e) => { meal.name = e.target.value; };
    mealEl.querySelector("[data-remove-meal]").onclick = () => { sheetDraft.meals = sheetDraft.meals.filter((m) => m.id !== meal.id); renderSheetBody(); };
    mealEl.querySelector("[data-add-food]").onclick = () => { meal.foods.push(newFood()); renderSheetBody(); };
    mealEl.querySelectorAll("tr[data-food]").forEach((row) => {
      const food = meal.foods.find((f) => f.id === row.dataset.food);
      row.querySelectorAll("[data-f]").forEach((input) => {
        input.onchange = (e) => {
          const key = input.dataset.f;
          if (key === "select") {
            if (e.target.value === "__custom") {
              food.source = "custom"; food.name = ""; food.per100 = { cal: 0, p: 0, c: 0, f: 0 };
            } else {
              const db = FOOD_DB.find((f) => f.name === e.target.value);
              food.source = "db"; food.name = db.name; food.per100 = { cal: db.cal, p: db.p, c: db.c, f: db.f };
            }
          } else if (key === "amount") {
            food.amount = e.target.value;
          } else if (key === "unit") {
            food.unit = e.target.value;
          } else if (key === "name") {
            food.name = e.target.value;
          } else {
            food.per100[key] = Number(e.target.value) || 0;
          }
          renderSheetBody();
        };
      });
      row.querySelector("[data-remove-food]").onclick = () => { meal.foods = meal.foods.filter((f) => f.id !== food.id); renderSheetBody(); };
    });
  });
}

async function sendSheet() {
  const statusEl = document.getElementById("sheet-status");
  const clientId = document.getElementById("sheet-client").value;
  const title = document.getElementById("sheet-title").value.trim();
  const supplements = document.getElementById("sheet-notes").value;
  if (!title) { showStatus(statusEl, "Give the sheet a title.", "error"); return; }

  try {
    await api("/sheets", {
      method: "POST",
      body: JSON.stringify({ clientId, type: sheetDraft.type, title, days: sheetDraft.days, meals: sheetDraft.meals, columns: sheetDraft.columns, supplements }),
    });
    showStatus(statusEl, "Sheet sent!", "info");
    sheetDraft.days = [newDay(1)];
    sheetDraft.meals = [newMeal(1)];
    renderSheetBuilder();
    renderSheetHistory(clientId);
  } catch (err) {
    showStatus(statusEl, err.message, "error");
  }
}

document.addEventListener("change", (e) => {
  if (e.target.id === "sheet-client") renderSheetHistory(e.target.value);
});

async function renderSheetHistory(clientId) {
  const historyEl = document.getElementById("sheet-history");
  if (!clientId) { historyEl.innerHTML = ""; return; }
  const { sheets } = await api(`/sheets/${clientId}`);
  historyEl.innerHTML = `<div class="hint">SENT TO THIS CLIENT &middot; ${sheets.length} plan${sheets.length === 1 ? "" : "s"}</div>` +
    [...sheets].reverse().map((s) => sheetCardHtml(s)).join("");
}

function sheetCardHtml(s) {
  const header = `
    <div class="flex-row" style="justify-content:space-between;">
      <span class="pill ok">${s.type === "workout" ? "Workout" : "Diet"}</span>
      <span class="hint">${fmtDate(s.createdAt)}</span>
    </div>
    <div style="font-weight:700; margin-top:6px;">${escapeHtml(s.title)}</div>
  `;
  let body;
  if (s.type === "workout") {
    const cols = Object.keys(WORKOUT_COLUMN_LABELS).filter((k) => (s.columns ? s.columns[k] : true));
    body = (s.days || []).map((d) => `
      <div class="sheet-table-wrap">
        <div style="font-weight:700; font-size:13px;">${escapeHtml(d.name)}</div>
        <table class="sheet-table">
          <thead><tr><th>Exercise</th>${cols.map((k) => `<th>${WORKOUT_COLUMN_LABELS[k]}</th>`).join("")}</tr></thead>
          <tbody>${d.exercises.map((ex) => `<tr><td>${escapeHtml(ex.name)}</td>${cols.map((k) => `<td>${escapeHtml(ex[k])}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    `).join("");
  } else {
    body = `<div class="pill ok" style="margin-bottom:6px;">Daily total: ${fmtMacro(s.totals)}</div>` +
      s.meals.map((m) => `<div style="font-size:13px; margin-bottom:4px;"><b>${escapeHtml(m.name)}</b> — ${fmtMacro(m.totals)}<div class="hint">${m.foods.map((f) => `${escapeHtml(f.name)} (${f.amount}${f.unit || "g"})`).join(", ")}</div></div>`).join("");
  }
  const supplements = s.supplements ? `<div class="hint" style="margin-top:6px;">Notes: ${escapeHtml(s.supplements)}</div>` : "";
  return `<div class="card">${header}${body}${supplements}</div>`;
}

// ---------------- Check-ins ----------------

let templateDraft = { title: "Weekly Check-In", fields: [{ id: uid("f_"), kind: "scale", label: "Energy in the gym" }, { id: uid("f_"), kind: "scale", label: "Hunger levels" }], requireVideo: false, posing: { front: 0, side: 0, back: 0 }, clientId: "" };

async function loadCheckinsTab() {
  if (!CLIENTS.length) CLIENTS = (await api("/clients")).clients;
  renderCheckinBuilder();
  const select = document.getElementById("checkin-client-select");
  select.innerHTML = CLIENTS.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("") || `<option value="">No clients yet</option>`;
  select.onchange = () => renderCheckinSubmissions(select.value);
  if (CLIENTS[0]) renderCheckinSubmissions(CLIENTS[0].id);
}

function renderCheckinBuilder() {
  const el = document.getElementById("checkin-builder");
  el.innerHTML = `
    <h2 style="margin-top:0;">Build a weekly check-in</h2>
    <label>Send to</label>
    <select id="tmpl-recipient">
      <option value="" ${templateDraft.clientId ? "" : "selected"}>All clients</option>
      ${CLIENTS.map((c) => `<option value="${c.id}" ${templateDraft.clientId === c.id ? "selected" : ""}>${escapeHtml(c.name)} only</option>`).join("")}
    </select>
    <label>Title</label>
    <input type="text" id="tmpl-title" value="${escapeHtml(templateDraft.title)}" />
    <div class="hint" style="margin-top:12px;">Always included: weight</div>
    <div id="tmpl-fields" style="margin-top:8px;"></div>
    <div class="flex-row" style="margin-top:8px;">
      <button type="button" class="small-btn secondary" id="add-scale-field">+ 1-10 scale</button>
      <button type="button" class="small-btn secondary" id="add-text-field">+ Text box</button>
    </div>
    <label class="flex-row" style="margin-top:12px; color:var(--text);">
      <input type="checkbox" id="tmpl-require-video" ${templateDraft.requireVideo ? "checked" : ""} style="width:auto;" />
      Require a form-check video with this check-in
    </label>

    <div class="hint" style="margin-top:14px;">Required posing photos</div>
    <div class="flex-row" id="pose-steppers" style="margin-top:6px; gap:22px;"></div>
    <div class="hint">Set any to 0 to skip that pose. Clients must upload exactly this many photos per pose.</div>

    <button id="tmpl-send-btn">${templateDraft.clientId ? `Send to ${escapeHtml(CLIENTS.find((c) => c.id === templateDraft.clientId)?.name || "client")}` : "Send to all clients"}</button>
    <div class="status" id="tmpl-status"></div>
  `;
  document.getElementById("tmpl-recipient").onchange = (e) => { templateDraft.clientId = e.target.value; renderCheckinBuilder(); };
  document.getElementById("tmpl-title").onchange = (e) => { templateDraft.title = e.target.value; };
  document.getElementById("tmpl-require-video").onchange = (e) => { templateDraft.requireVideo = e.target.checked; };
  document.getElementById("add-scale-field").onclick = () => { templateDraft.fields.push({ id: uid("f_"), kind: "scale", label: "" }); renderCheckinFields(); };
  document.getElementById("add-text-field").onclick = () => { templateDraft.fields.push({ id: uid("f_"), kind: "text", label: "" }); renderCheckinFields(); };
  document.getElementById("tmpl-send-btn").onclick = sendTemplate;
  renderCheckinFields();
  renderPoseSteppers();
}

const POSE_LABELS = { front: "Front", side: "Side", back: "Back" };
const POSE_MAX = 6;

function renderPoseSteppers() {
  const el = document.getElementById("pose-steppers");
  el.innerHTML = Object.keys(POSE_LABELS).map((pose) => `
    <div>
      <div class="hint" style="margin-bottom:4px;">${POSE_LABELS[pose]}</div>
      <div class="stepper">
        <button type="button" class="stepper-btn" data-pose-dec="${pose}" ${templateDraft.posing[pose] <= 0 ? "disabled" : ""}>&minus;</button>
        <span class="stepper-count">${templateDraft.posing[pose]}</span>
        <button type="button" class="stepper-btn" data-pose-inc="${pose}" ${templateDraft.posing[pose] >= POSE_MAX ? "disabled" : ""}>+</button>
      </div>
    </div>
  `).join("");
  el.querySelectorAll("[data-pose-dec]").forEach((btn) => {
    btn.onclick = () => { templateDraft.posing[btn.dataset.poseDec] = Math.max(0, templateDraft.posing[btn.dataset.poseDec] - 1); renderPoseSteppers(); };
  });
  el.querySelectorAll("[data-pose-inc]").forEach((btn) => {
    btn.onclick = () => { templateDraft.posing[btn.dataset.poseInc] = Math.min(POSE_MAX, templateDraft.posing[btn.dataset.poseInc] + 1); renderPoseSteppers(); };
  });
}

function renderCheckinFields() {
  const el = document.getElementById("tmpl-fields");
  el.innerHTML = templateDraft.fields.map((f) => `
    <div class="flex-row" data-field="${f.id}" style="margin-bottom:6px;">
      <span class="pill" style="background:var(--surface-2);">${f.kind === "scale" ? "1-10" : "text"}</span>
      <input type="text" class="cell-input" style="flex:1; border:1px solid var(--border);" data-field-label value="${escapeHtml(f.label)}" placeholder="Field label..." />
      <button type="button" class="small-btn secondary" data-remove-field>&times;</button>
    </div>
  `).join("");
  el.querySelectorAll("[data-field]").forEach((rowEl) => {
    const field = templateDraft.fields.find((f) => f.id === rowEl.dataset.field);
    rowEl.querySelector("[data-field-label]").onchange = (e) => { field.label = e.target.value; };
    rowEl.querySelector("[data-remove-field]").onclick = () => { templateDraft.fields = templateDraft.fields.filter((f) => f.id !== field.id); renderCheckinFields(); };
  });
}

async function sendTemplate() {
  const statusEl = document.getElementById("tmpl-status");
  if (!templateDraft.title.trim() || templateDraft.fields.some((f) => !f.label.trim())) {
    showStatus(statusEl, "Give the check-in a title and label every field.", "error");
    return;
  }
  try {
    await api("/checkins/templates", { method: "POST", body: JSON.stringify(templateDraft) });
    const recipient = templateDraft.clientId ? CLIENTS.find((c) => c.id === templateDraft.clientId)?.name || "that client" : "all your clients";
    showStatus(statusEl, `Check-in sent to ${recipient}!`, "info");
  } catch (err) {
    showStatus(statusEl, err.message, "error");
  }
}

async function renderCheckinSubmissions(clientId) {
  const listEl = document.getElementById("checkin-submissions-list");
  if (!clientId) { listEl.innerHTML = ""; return; }
  const { submissions } = await api(`/checkins/submissions/${clientId}`);
  listEl.innerHTML = checkinHistoryHtml(submissions);
}

function checkinHistoryHtml(submissions) {
  return submissions.length
    ? [...submissions].reverse().map((s) => `
        <div class="card">
          <div class="flex-row" style="justify-content:space-between;">
            <b>${escapeHtml(s.title)}</b>
            <span class="hint">${fmtDate(s.createdAt)}</span>
          </div>
          <div class="hint" style="margin-top:4px;">Weight: ${escapeHtml(s.weight || "—")}</div>
          ${s.answers.map((a) => `<div style="font-size:13px; margin-top:2px;"><b>${escapeHtml(a.label)}:</b> ${escapeHtml(a.value)}</div>`).join("")}
          ${s.videoFile ? `<video controls style="width:100%; margin-top:8px; border-radius:8px;" src="/api/checkins/media/${encodeURIComponent(s.videoFile)}"></video>` : ""}
          ${posingPhotosHtml(s.photos)}
        </div>
      `).join("")
    : `<div class="card hint">No submissions from this client yet.</div>`;
}

function posingPhotosHtml(photos) {
  if (!photos || !photos.length) return "";
  const groups = { front: [], side: [], back: [] };
  photos.forEach((p) => { (groups[p.pose] || groups.front).push(p); });
  return Object.entries(groups)
    .filter(([, list]) => list.length)
    .map(([pose, list]) => `
      <div style="margin-top:8px;">
        <div class="hint" style="text-transform:capitalize;">${escapeHtml(pose)}</div>
        <div class="flex-row">
          ${list.map((p) => `<img src="/api/checkins/media/${encodeURIComponent(p.file)}" data-lightbox="${encodeURIComponent(p.file)}" style="width:90px; height:90px; object-fit:cover; border-radius:8px; border:1px solid var(--border); cursor:pointer;" />`).join("")}
        </div>
      </div>
    `).join("");
}

// ---------------- Billing (coach sends a client a payment plan) ----------------

async function loadBillingTab() {
  renderPayoutsCard();
  if (!CLIENTS.length) CLIENTS = (await api("/clients")).clients;
  renderBillingBuilder();
  const select = document.getElementById("billing-client-select");
  select.innerHTML = CLIENTS.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("") || `<option value="">No clients yet</option>`;
  select.onchange = () => renderBillingPlans(select.value);
  if (CLIENTS[0]) renderBillingPlans(CLIENTS[0].id);
}

function renderBillingBuilder() {
  const el = document.getElementById("billing-builder");
  if (!CLIENTS.length) {
    el.innerHTML = `<p class="hint">Add a client first (Clients tab) to send a payment plan.</p>`;
    return;
  }
  el.innerHTML = `
    <h2 style="margin-top:0;">Send a payment plan</h2>
    <p class="hint">The client sees this on their "Pay My Coach" tab with a Pay button already filled in — no need for them to know the amount.</p>
    <label>Client</label>
    <select id="plan-client">${CLIENTS.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}</select>

    <label>Type</label>
    <div class="flex-row">
      <button type="button" class="small-btn" id="plan-type-payment">One-time</button>
      <button type="button" class="small-btn secondary" id="plan-type-subscription">Monthly</button>
    </div>

    <label>Amount (USD)</label>
    <input type="number" id="plan-amount" min="1" step="0.01" placeholder="150.00" />

    <label>What's this for?</label>
    <input type="text" id="plan-description" placeholder="e.g. October coaching package" />

    <button id="plan-send-btn">Send payment plan</button>
    <div class="status" id="plan-status"></div>
  `;

  let planMode = "payment";
  document.getElementById("plan-type-payment").onclick = () => {
    planMode = "payment";
    document.getElementById("plan-type-payment").classList.remove("secondary");
    document.getElementById("plan-type-subscription").classList.add("secondary");
  };
  document.getElementById("plan-type-subscription").onclick = () => {
    planMode = "subscription";
    document.getElementById("plan-type-subscription").classList.remove("secondary");
    document.getElementById("plan-type-payment").classList.add("secondary");
  };

  document.getElementById("plan-send-btn").onclick = async () => {
    const statusEl = document.getElementById("plan-status");
    const clientId = document.getElementById("plan-client").value;
    const amountUsd = document.getElementById("plan-amount").value;
    const description = document.getElementById("plan-description").value;
    if (!amountUsd || Number(amountUsd) <= 0) {
      showStatus(statusEl, "Enter an amount.", "error");
      return;
    }
    try {
      await api("/payments/plans", { method: "POST", body: JSON.stringify({ clientId, amountUsd, mode: planMode, description }) });
      showStatus(statusEl, "Payment plan sent!", "info");
      document.getElementById("plan-amount").value = "";
      document.getElementById("plan-description").value = "";
      document.getElementById("billing-client-select").value = clientId;
      renderBillingPlans(clientId);
    } catch (err) {
      showStatus(statusEl, err.message, "error");
    }
  };
}

let editingPlanId = null;

async function renderBillingPlans(clientId) {
  const listEl = document.getElementById("billing-plans-list");
  if (!clientId) { listEl.innerHTML = ""; return; }
  const { plans } = await api(`/payments/plans/${clientId}`);
  const STATUS_PILL = { pending: ["pending", ""], paid: ["paid", "ok"], active: ["active", "ok"], cancelled: ["cancelled", ""] };
  const editable = (status) => status === "pending" || status === "active";

  listEl.innerHTML = plans.length
    ? [...plans].reverse().map((p) => {
        const [label, cls] = STATUS_PILL[p.status] || [p.status, ""];
        const isEditing = editingPlanId === p.id;
        return `
          <div class="card">
            <div class="flex-row" style="justify-content:space-between;">
              <span class="pill ${cls}" style="${cls ? "" : "background:var(--surface-2);"}">${label}</span>
              <span class="hint">${fmtDate(p.createdAt)}</span>
            </div>
            ${isEditing ? `
              <label style="margin-top:8px;">Amount (USD)</label>
              <input type="number" min="1" step="0.01" id="edit-amount-${p.id}" value="${p.amountUsd}" />
              <label>What's this for?</label>
              <input type="text" id="edit-desc-${p.id}" value="${escapeHtml(p.description || "")}" />
              ${p.status === "active" ? `<div class="hint" style="margin-top:6px;">Changes the live subscription price — takes effect next billing cycle, no charge or credit for the switch.</div>` : ""}
              <div class="flex-row" style="margin-top:8px;">
                <button type="button" class="small-btn" data-save-plan="${p.id}" data-save-client="${clientId}">Save</button>
                <button type="button" class="small-btn secondary" data-cancel-edit>Cancel</button>
              </div>
              <div class="status" id="edit-status-${p.id}"></div>
            ` : `
              <div style="font-weight:800; font-size:18px; margin-top:6px;">$${p.amountUsd}${p.mode === "subscription" ? "/mo" : ""}</div>
              ${p.description ? `<div class="hint">${escapeHtml(p.description)}</div>` : ""}
              <div class="flex-row" style="margin-top:8px;">
                ${editable(p.status) ? `<button type="button" class="small-btn secondary" data-edit-plan="${p.id}">Edit</button>` : ""}
                ${p.status === "pending" ? `<button type="button" class="small-btn secondary" data-cancel-plan="${p.id}" data-cancel-client="${clientId}">Cancel</button>` : ""}
              </div>
            `}
          </div>
        `;
      }).join("")
    : `<div class="card hint">No payment plans sent to this client yet.</div>`;

  listEl.querySelectorAll("[data-edit-plan]").forEach((btn) => {
    btn.onclick = () => { editingPlanId = btn.dataset.editPlan; renderBillingPlans(clientId); };
  });
  listEl.querySelectorAll("[data-cancel-edit]").forEach((btn) => {
    btn.onclick = () => { editingPlanId = null; renderBillingPlans(clientId); };
  });
  listEl.querySelectorAll("[data-save-plan]").forEach((btn) => {
    btn.onclick = async () => {
      const planId = btn.dataset.savePlan;
      const targetClient = btn.dataset.saveClient;
      const statusEl = document.getElementById(`edit-status-${planId}`);
      const amountUsd = document.getElementById(`edit-amount-${planId}`).value;
      const description = document.getElementById(`edit-desc-${planId}`).value;
      if (!amountUsd || Number(amountUsd) <= 0) { showStatus(statusEl, "Enter an amount.", "error"); return; }
      try {
        await api(`/payments/plans/${targetClient}/${planId}`, { method: "PATCH", body: JSON.stringify({ amountUsd, description }) });
        editingPlanId = null;
        renderBillingPlans(targetClient);
      } catch (err) {
        showStatus(statusEl, err.message, "error");
      }
    };
  });
  listEl.querySelectorAll("[data-cancel-plan]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Cancel this payment plan?")) return;
      await api(`/payments/plans/${btn.dataset.cancelClient}/${btn.dataset.cancelPlan}`, { method: "DELETE" });
      renderBillingPlans(btn.dataset.cancelClient);
    };
  });
}

// ---------------- Messages ----------------

async function loadMessagesTab() {
  if (!CLIENTS.length) CLIENTS = (await api("/clients")).clients;
  if (!COACHES.length) {
    const { coaches } = await api("/coach/list");
    COACHES = coaches.filter((c) => c.coachId !== ME.id);
  }
  const listEl = document.getElementById("thread-list");
  const entries = [
    ...CLIENTS.map((c) => ({ id: c.id, name: c.name, sub: `@${c.username}` })),
    ...COACHES.map((c) => ({ id: c.coachId, name: c.name, sub: "Coach" })),
  ];
  listEl.innerHTML = entries.length
    ? entries.map((t) => `<div class="thread-item ${ACTIVE_THREAD?.id === t.id ? "active" : ""}" data-thread="${t.id}" data-name="${escapeHtml(t.name)}">${escapeHtml(t.name)}<div class="hint">${escapeHtml(t.sub)}</div></div>`).join("")
    : `<p class="hint">No clients or coaches to message yet.</p>`;
  listEl.querySelectorAll("[data-thread]").forEach((el) => {
    el.onclick = () => openThread(el.dataset.thread, el.dataset.name);
  });
  if (ACTIVE_THREAD) openThread(ACTIVE_THREAD.id, ACTIVE_THREAD.name);
}

async function openThread(otherId, otherName) {
  ACTIVE_THREAD = { id: otherId, name: otherName };
  document.querySelectorAll("[data-thread]").forEach((el) => el.classList.toggle("active", el.dataset.thread === otherId));
  const panel = document.getElementById("message-panel");
  panel.innerHTML = `
    <div style="font-weight:700; margin-bottom:8px;">${escapeHtml(otherName)}</div>
    <div class="msg-thread" id="msg-thread"></div>
    <div class="msg-compose">
      <input type="text" id="msg-input" placeholder="Message..." />
      <button id="msg-send-btn" class="small-btn" style="margin-top:0;">Send</button>
    </div>
  `;
  await renderThread(otherId);
  document.getElementById("msg-send-btn").onclick = () => sendMessage(otherId);
  document.getElementById("msg-input").onkeydown = (e) => { if (e.key === "Enter") sendMessage(otherId); };
}

async function renderThread(otherId) {
  const { messages } = await api(`/messages/${otherId}`);
  const threadEl = document.getElementById("msg-thread");
  if (!threadEl) return;
  threadEl.innerHTML = messages.length
    ? messages.map((m) => `<div class="bubble ${m.from === ME.id ? "me" : "them"}">${escapeHtml(m.text)}</div>`).join("")
    : `<div class="hint" style="text-align:center;">Say hello 👋</div>`;
  threadEl.scrollTop = threadEl.scrollHeight;
}

async function sendMessage(otherId) {
  const input = document.getElementById("msg-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  await api(`/messages/${otherId}`, { method: "POST", body: JSON.stringify({ text }) });
  renderThread(otherId);
}

// ---------------- Assistant ----------------

function loadAssistantTab() {
  if (!ASSISTANT_HISTORY.length) {
    ASSISTANT_HISTORY = [{ role: "assistant", text: `Hi ${ME.name.split(" ")[0]}, I'm your Gainline coaching assistant. Ask me to draft a workout split, adjust macros, brainstorm check-in questions, or troubleshoot a client's plateau.` }];
  }
  renderAssistantThread();
  const input = document.getElementById("assistant-input");
  document.getElementById("assistant-send").onclick = askAssistant;
  input.onkeydown = (e) => { if (e.key === "Enter") askAssistant(); };
}

function renderAssistantThread() {
  const threadEl = document.getElementById("assistant-thread");
  threadEl.innerHTML = ASSISTANT_HISTORY.map((m) => `<div class="bubble ${m.role === "user" ? "me" : "them"}" style="white-space:pre-wrap;">${escapeHtml(m.text)}</div>`).join("");
  threadEl.scrollTop = threadEl.scrollHeight;
}

async function askAssistant() {
  const input = document.getElementById("assistant-input");
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  ASSISTANT_HISTORY.push({ role: "user", text: question });
  renderAssistantThread();
  try {
    const { answer } = await api("/assistant/ask", { method: "POST", body: JSON.stringify({ question }) });
    ASSISTANT_HISTORY.push({ role: "assistant", text: answer });
  } catch (err) {
    ASSISTANT_HISTORY.push({ role: "assistant", text: err.message });
  }
  renderAssistantThread();
}

// ---------------- Advertise ----------------

let adDraftMediaFile = null; // File selected but not yet uploaded (null = keep existing / none)

async function loadAdsTab() {
  const [{ adsPriceUsd, adsIntervalMonths, adsIncluded, adsFreeWithTier }, { ads }] = await Promise.all([api("/platform/status"), api("/ads")]);
  const myAd = ads.find((a) => a.coachId === ME.id);
  const priceLabel = `$${adsPriceUsd} every ${adsIntervalMonths} months`;
  adDraftMediaFile = null;
  const card = document.getElementById("ads-card");
  card.innerHTML = `
    <h2 style="margin-top:0;">Advertise your coaching</h2>
    <p class="hint">Your post appears in the client-facing "Find a Coach" feed${adsFreeWithTier ? ` — <b>included free</b> with your Unlimited plan.` : ` for <b>${priceLabel}</b> while active.`}</p>
    ${adsIncluded ? `
      <div class="ig-post-preview">
        <div class="ig-post-header">
          <div class="ad-avatar">${escapeHtml((ME.name || "?").slice(0, 2).toUpperCase())}</div>
          <div style="font-weight:700; font-size:13.5px;">@${escapeHtml(ME.username)}</div>
        </div>
        <div class="ig-post-media" id="ad-media-box">
          ${myAd?.mediaFile ? mediaTag(myAd.mediaFile, myAd.mediaType, "ad-media-preview") : `<div class="ig-post-placeholder" id="ad-media-placeholder">${CAMERA_ICON}<span>Add a photo or video</span></div>`}
          <input type="file" id="ad-media-input" accept="image/*,video/*" />
        </div>
        <div class="ig-post-caption-row">
          <textarea id="ad-caption" rows="3" placeholder="Write a caption...">${escapeHtml(myAd?.caption || "")}</textarea>
        </div>
      </div>
      <div class="flex-row" style="margin-top:12px;">
        <button id="ad-save-btn">${myAd ? "Update post" : "Post ad"}</button>
        <button class="secondary" id="ad-cancel-btn">${adsFreeWithTier ? "Remove ad" : "Stop advertising"}</button>
      </div>
      <div class="status" id="ad-status-msg"></div>
      <div class="pill ok" style="margin-top:10px;">${adsFreeWithTier ? "Included free with your Unlimited plan" : `Ad subscription active &middot; ${priceLabel}`}</div>
    ` : `
      <button id="ad-subscribe-btn">Subscribe — ${priceLabel}</button>
      <div class="hint" style="margin-top:8px;">Or upgrade to the Unlimited membership tier and it's included free.</div>
      <div class="status" id="ad-status-msg"></div>
    `}
  `;

  if (adsIncluded) {
    bindAdMediaInput();
    document.getElementById("ad-save-btn").onclick = async () => {
      const statusEl = document.getElementById("ad-status-msg");
      const caption = document.getElementById("ad-caption").value;
      if (!caption.trim()) { showStatus(statusEl, "Write a caption first.", "error"); return; }
      try {
        const formData = new FormData();
        formData.append("caption", caption);
        if (adDraftMediaFile) formData.append("media", adDraftMediaFile);
        await api("/ads", { method: "POST", body: formData });
        showStatus(statusEl, "Saved!", "info");
        loadAdsTab();
      } catch (err) { showStatus(statusEl, err.message, "error"); }
    };
    document.getElementById("ad-cancel-btn").onclick = async () => {
      const confirmMsg = adsFreeWithTier ? "Remove your ad from the feed?" : `Stop advertising and cancel the ${priceLabel} subscription?`;
      if (!confirm(confirmMsg)) return;
      await api("/ads", { method: "DELETE" });
      if (!adsFreeWithTier) await api("/platform/ads/cancel", { method: "POST" });
      loadAdsTab();
    };
  } else {
    document.getElementById("ad-subscribe-btn").onclick = async () => {
      const statusEl = document.getElementById("ad-status-msg");
      try {
        const { url } = await api("/platform/ads/checkout", { method: "POST" });
        window.location.href = url;
      } catch (err) { showStatus(statusEl, err.message, "error"); }
    };
  }
}

function mediaTag(filename, type, cls) {
  const url = `/media/ads/${encodeURIComponent(filename)}`;
  return type === "video" ? `<video src="${url}" class="${cls}" muted controls></video>` : `<img src="${url}" class="${cls}" />`;
}

function bindAdMediaInput() {
  const input = document.getElementById("ad-media-input");
  input.onchange = (e) => {
    if (!e.target.files[0]) return;
    adDraftMediaFile = e.target.files[0];
    const url = URL.createObjectURL(adDraftMediaFile);
    const isVideo = adDraftMediaFile.type.startsWith("video/");
    document.getElementById("ad-media-box").innerHTML =
      (isVideo ? `<video src="${url}" class="ad-media-preview" muted></video>` : `<img src="${url}" class="ad-media-preview" />`) +
      `<input type="file" id="ad-media-input" accept="image/*,video/*" />`;
    bindAdMediaInput();
  };
}

// ---------------- Membership ----------------

async function loadMembershipTab() {
  const { tiers, membershipTier, membershipStatus, hasUsedTrial, trialDays } = await api("/platform/status");
  const card = document.getElementById("membership-card");
  card.innerHTML = `
    <h2 style="margin-top:0;">Membership</h2>
    <p class="hint">Your plan determines how many clients you can have.${!hasUsedTrial ? ` Paid plans include a ${trialDays}-day free trial.` : ""}</p>
    <div class="tier-ladder">
      ${tiers.map((t) => `
        <div class="tier-col ${t.id === membershipTier ? "active" : ""}" data-tier="${t.id}">
          <div class="label">${escapeHtml(t.label)}</div>
          <div class="meta">${t.max === null ? "&infin;" : `&le;${t.max}`} &middot; ${t.price === 0 ? "Free" : `$${t.price}/mo`}</div>
          ${t.max === null ? `<div class="hint" style="margin-top:4px;">Includes free ad listing</div>` : ""}
          ${t.id === membershipTier ? `<div class="hint" style="margin-top:6px;">Current${membershipStatus ? ` (${escapeHtml(membershipStatus)})` : ""}</div>` : `<button type="button" class="small-btn ${t.price === 0 ? "secondary button" : ""}" style="margin-top:8px;" data-choose-tier="${t.id}">${t.price === 0 ? "Cancel membership" : !hasUsedTrial ? `Start ${trialDays}-day trial` : "Choose"}</button>`}
        </div>
      `).join("")}
    </div>
    ${membershipTier !== "free" ? `<p class="hint" style="margin-top:12px;">Cancelling stops your $${tiers.find((t) => t.id === membershipTier)?.price}/mo membership charge immediately and moves you to the free Starter plan (max 2 clients). You'll keep any clients you already have, but won't be able to add more past the Starter limit.</p>` : ""}
    <div class="status" id="membership-status-msg"></div>
  `;
  card.querySelectorAll("[data-choose-tier]").forEach((btn) => {
    btn.onclick = async () => {
      const statusEl = document.getElementById("membership-status-msg");
      if (btn.dataset.chooseTier === "free" && !confirm("Cancel your paid membership and move to the free Starter plan? This takes effect immediately.")) return;
      try {
        const { url } = await api("/platform/membership/checkout", { method: "POST", body: JSON.stringify({ tierId: btn.dataset.chooseTier }) });
        if (url) window.location.href = url;
        else loadMembershipTab();
      } catch (err) { showStatus(statusEl, err.message, "error"); }
    };
  });
}

// ---------------- Get Paid (folded into the Billing tab) ----------------

async function renderPayoutsCard() {
  const card = document.getElementById("payouts-card");
  card.innerHTML = `<p class="hint">Checking your payout status...</p>`;
  const { onboarded } = await api("/coach/status");
  card.innerHTML = `
    <h2 style="margin-top:0;">Get paid by clients</h2>
    ${onboarded
      ? `<span class="pill ok">Ready</span><p class="hint" style="margin-top:8px;">Your Stripe payout account is set up. Clients can pay you one-time or monthly, and payment plans you send will work too.</p>`
      : `<span class="pill pending">Not set up</span><p class="hint" style="margin-top:8px;">Finish Stripe onboarding before sending payment plans or accepting payments from clients.</p><a class="button" href="/coach.html">Set up payouts</a>`
    }
  `;
}

// ---------------- Photo lightbox ----------------

function setupLightbox() {
  const overlay = document.createElement("div");
  overlay.id = "lightbox-overlay";
  overlay.className = "lightbox-overlay";
  overlay.innerHTML = `
    <button type="button" class="lightbox-close" id="lightbox-close">&times;</button>
    <img id="lightbox-img" class="lightbox-img" src="" alt="" />
    <a id="lightbox-download" class="button lightbox-download" download>Download</a>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.id === "lightbox-close") closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });

  document.addEventListener("click", (e) => {
    const img = e.target.closest("[data-lightbox]");
    if (!img) return;
    const filename = decodeURIComponent(img.dataset.lightbox);
    openLightbox(`/api/checkins/media/${encodeURIComponent(filename)}`, filename);
  });
}

function openLightbox(url, filename) {
  document.getElementById("lightbox-img").src = url;
  const downloadLink = document.getElementById("lightbox-download");
  downloadLink.href = url;
  downloadLink.setAttribute("download", filename);
  document.getElementById("lightbox-overlay").classList.add("open");
}

function closeLightbox() {
  document.getElementById("lightbox-overlay").classList.remove("open");
}

// ---------------- Client detail (in-tab: check-in history newest-first + private notes) ----------------

async function openClientDetail(clientId, name, username) {
  document.getElementById("clients-roster-view").style.display = "none";
  const detailEl = document.getElementById("client-detail-view");
  detailEl.style.display = "block";
  detailEl.innerHTML = `<p class="hint">Loading...</p>`;

  const [{ notes }, { submissions }] = await Promise.all([
    api(`/notes/${clientId}`),
    api(`/checkins/submissions/${clientId}`),
  ]);
  renderClientDetail(clientId, name, username, notes, submissions);
}

function closeClientDetail() {
  document.getElementById("client-detail-view").style.display = "none";
  document.getElementById("clients-roster-view").style.display = "block";
}

function renderClientDetail(clientId, name, username, notes, submissions) {
  const detailEl = document.getElementById("client-detail-view");
  detailEl.innerHTML = `
    <button type="button" class="small-btn secondary" id="client-detail-back">&larr; Back to clients</button>
    <div class="card" style="margin-top:10px;">
      <div style="font-size:20px; font-weight:800;">${escapeHtml(name)}</div>
      <div class="hint">@${escapeHtml(username)}</div>
    </div>

    <div class="card" style="margin-top:12px; background:var(--surface-2);">
      <div style="font-weight:700; margin-bottom:6px;">Private notes</div>
      <div class="hint" style="margin-bottom:8px;">Only you can see these — your client never does.</div>
      <textarea id="new-note-text" rows="2" style="width:100%; box-sizing:border-box; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--text);" placeholder="Add a note..."></textarea>
      <button type="button" id="add-note-btn" style="margin-top:8px;">Add note</button>
      <div class="status" id="note-status"></div>
      <div id="notes-list" style="margin-top:10px;">
        ${[...notes].reverse().map((n) => `
          <div style="padding:8px 0; border-top:1px solid var(--border);">
            <div class="flex-row" style="justify-content:space-between;">
              <span class="hint">${fmtDate(n.createdAt)}</span>
              <button type="button" data-delete-note="${n.id}" style="background:none; border:none; color:var(--text-dim); cursor:pointer; padding:0; margin-top:0;">&times;</button>
            </div>
            <div style="font-size:13px; margin-top:2px; white-space:pre-wrap;">${escapeHtml(n.text)}</div>
          </div>
        `).join("") || `<div class="hint">No notes yet.</div>`}
      </div>
    </div>

    <div class="hint" style="margin-top:16px;">CHECK-IN HISTORY &middot; NEWEST FIRST</div>
    <div style="margin-top:6px;">${checkinHistoryHtml(submissions)}</div>
  `;

  document.getElementById("client-detail-back").onclick = closeClientDetail;

  document.getElementById("add-note-btn").onclick = async () => {
    const statusEl = document.getElementById("note-status");
    const textEl = document.getElementById("new-note-text");
    if (!textEl.value.trim()) return;
    try {
      const result = await api("/notes", { method: "POST", body: JSON.stringify({ clientId, text: textEl.value }) });
      renderClientDetail(clientId, name, username, result.notes, submissions);
    } catch (err) {
      showStatus(statusEl, err.message, "error");
    }
  };
  detailEl.querySelectorAll("[data-delete-note]").forEach((btn) => {
    btn.onclick = async () => {
      const result = await api(`/notes/${clientId}/${btn.dataset.deleteNote}`, { method: "DELETE" });
      renderClientDetail(clientId, name, username, result.notes, submissions);
    };
  });
}

// ---------------- misc ----------------

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
