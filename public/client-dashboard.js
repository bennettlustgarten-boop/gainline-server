let ME = null;
let MY_COACH = null;
let sheetFilter = "all";

(async () => {
  ME = await requireLogin("client");
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

  const { coach } = await api("/my-coach");
  MY_COACH = coach;

  setupTabs();
  setupCoachProfileModal();
  activateTab(qs("tab") || "home");
})();

function showNotice(text) {
  const el = document.getElementById("notice-banner");
  el.style.display = "block";
  el.textContent = text;
}

function setupTabs() {
  document.getElementById("tab-bar").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (btn) activateTab(btn.dataset.tab);
  });
}

const TAB_LOADERS = {
  home: loadHome,
  calendar: loadCalendar,
  sheets: loadSheets,
  checkin: loadCheckin,
  messages: loadMessages,
  find: loadFind,
  pay: loadPay,
};

function activateTab(tab) {
  if (!TAB_LOADERS[tab]) tab = "home";
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll("[data-tab-panel]").forEach((p) => p.classList.toggle("active", p.dataset.tabPanel === tab));
  TAB_LOADERS[tab]();
}

// ---------------- Home ----------------

function loadHome() {
  const el = document.getElementById("home-coach-card");
  if (MY_COACH) {
    el.innerHTML = `
      <div class="hint">YOUR COACH</div>
      <div style="font-size:20px; font-weight:800; margin-top:4px;">${escapeHtml(MY_COACH.name)}</div>
      <div class="hint" style="margin-top:4px;">${escapeHtml(MY_COACH.bio || "")}</div>
      <button type="button" class="small-btn secondary" style="margin-top:10px;" data-view-profile="${MY_COACH.id}">View profile &amp; leave a review</button>
    `;
    el.querySelector("[data-view-profile]").onclick = () => openCoachProfile(MY_COACH.id, MY_COACH.name, MY_COACH.username);
  } else {
    el.innerHTML = `<p class="hint">You're not connected to a coach yet. Head to "Find a Coach" to browse the feed, or ask your coach for their invite link.</p>`;
  }
}

// ---------------- Calendar ----------------

let calMonthCursor = null;
let calSelectedKey = null;

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

async function loadCalendar() {
  if (!calMonthCursor) {
    const now = new Date();
    calMonthCursor = new Date(now.getFullYear(), now.getMonth(), 1);
    calSelectedKey = dateKey(now);
  }
  renderMonthCalendar();
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
        ${shown.map((o) => `<div class="month-chip">${escapeHtml(o.title || o.typeLabel)}</div>`).join("")}
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
                  <div style="font-weight:800; margin-top:6px;">${o.title ? escapeHtml(o.title) : escapeHtml(o.typeLabel)}</div>
                  <div class="hint">${new Date(o.occursAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} &middot; ${o.durationMinutes} min</div>
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
}

// ---------------- Sheets ----------------

async function loadSheets() {
  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.classList.toggle("secondary", btn.dataset.filter !== sheetFilter);
    btn.onclick = () => { sheetFilter = btn.dataset.filter; loadSheets(); };
  });
  const { sheets } = await api(`/sheets/${ME.id}`);
  const filtered = sheets.filter((s) => sheetFilter === "all" || s.type === sheetFilter);
  const listEl = document.getElementById("sheets-list");
  listEl.innerHTML = filtered.length
    ? [...filtered].reverse().map((s) => sheetCardHtml(s)).join("")
    : `<div class="card hint">Nothing here yet — new plans your coach sends will show up here.</div>`;
}

const WORKOUT_COLUMN_LABELS = { sets: "Sets", reps: "Reps", weight: "Weight", rest: "Rest", notes: "Notes" };

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
      s.meals.map((m) => `<div style="font-size:13px; margin-bottom:4px;"><b>${escapeHtml(m.name)}</b> — ${fmtMacro(m.totals)}<div class="hint">${m.foods.map((f) => `${escapeHtml(f.name)} (${f.amount}${f.unit || "g"}) — ${f.cal} kcal`).join(", ")}</div></div>`).join("");
  }
  const supplements = s.supplements ? `<div class="hint" style="margin-top:6px;">Notes: ${escapeHtml(s.supplements)}</div>` : "";
  return `<div class="card">${header}${body}${supplements}</div>`;
}

// ---------------- Check-in ----------------

let checkinTemplates = [];
let checkinAnswers = {};
let poseFiles = { front: [], side: [], back: [] }; // File | null per slot

const CAMERA_ICON = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`;

async function loadCheckin() {
  const { templates } = await api("/checkins/templates");
  checkinTemplates = templates;
  const card = document.getElementById("checkin-card");
  if (!templates.length) {
    card.innerHTML = `<p class="hint">Your coach hasn't sent a check-in form yet.</p>`;
    return;
  }
  const latest = templates[templates.length - 1];
  checkinAnswers = {};
  poseFiles = { front: [], side: [], back: [] };
  renderCheckinForm(latest);
}

function renderCheckinForm(tmpl) {
  const card = document.getElementById("checkin-card");
  card.innerHTML = `
    <div style="font-weight:800;">${escapeHtml(tmpl.title)}</div>
    <label>Weight</label>
    <input type="text" id="checkin-weight" placeholder="e.g. 168 lbs" />
    <div id="checkin-fields"></div>
    ${tmpl.requireVideo ? `
      <label>Form-check video (required)</label>
      <input type="file" id="checkin-video" accept="video/*" />
    ` : ""}
    <div id="checkin-poses"></div>
    <button id="checkin-submit-btn">Submit check-in</button>
    <div class="status" id="checkin-status"></div>
  `;
  const fieldsEl = document.getElementById("checkin-fields");
  fieldsEl.innerHTML = tmpl.fields.map((f) => `
    <div style="margin-top:10px;">
      <label>${escapeHtml(f.label)}</label>
      ${f.kind === "scale"
        ? `<div class="scale-row" data-scale-for="${f.id}">${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `<button type="button" class="scale-btn" data-scale-val="${n}">${n}</button>`).join("")}</div>`
        : `<textarea class="cell-input" style="border:1px solid var(--border); width:100%;" rows="2" data-text-for="${f.id}"></textarea>`}
    </div>
  `).join("");
  fieldsEl.querySelectorAll("[data-scale-for]").forEach((row) => {
    row.querySelectorAll("[data-scale-val]").forEach((btn) => {
      btn.onclick = () => {
        row.querySelectorAll("[data-scale-val]").forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
        checkinAnswers[row.dataset.scaleFor] = btn.dataset.scaleVal;
      };
    });
  });
  fieldsEl.querySelectorAll("[data-text-for]").forEach((ta) => {
    ta.oninput = () => { checkinAnswers[ta.dataset.textFor] = ta.value; };
  });

  const posing = tmpl.posing || { front: 0, side: 0, back: 0 };
  const posesEl = document.getElementById("checkin-poses");
  posesEl.innerHTML = ["front", "side", "back"]
    .filter((pose) => posing[pose] > 0)
    .map((pose) => `
      <div style="margin-top:12px;">
        <label style="margin:0 0 4px;">${pose.charAt(0).toUpperCase() + pose.slice(1)} pose photos (${posing[pose]} required)</label>
        <div class="photo-upload-grid" data-pose-grid="${pose}"></div>
      </div>
    `).join("");
  ["front", "side", "back"].filter((pose) => posing[pose] > 0).forEach((pose) => renderPoseGrid(pose, posing[pose]));

  document.getElementById("checkin-submit-btn").onclick = () => submitCheckin(tmpl);
}

function renderPoseGrid(pose, count) {
  const gridEl = document.querySelector(`[data-pose-grid="${pose}"]`);
  if (!poseFiles[pose]) poseFiles[pose] = [];
  gridEl.innerHTML = Array.from({ length: count }, (_, i) => {
    const file = poseFiles[pose][i];
    return `
      <div class="photo-upload-box ${file ? "filled" : ""}" data-pose-box="${pose}" data-pose-index="${i}">
        ${file ? `<img src="${URL.createObjectURL(file)}" alt="" />` : CAMERA_ICON}
        <input type="file" accept="image/*" data-pose-file-input="${pose}" data-pose-file-index="${i}" />
      </div>
    `;
  }).join("");
  gridEl.querySelectorAll("[data-pose-file-input]").forEach((input) => {
    input.onchange = () => {
      const p = input.dataset.poseFileInput;
      const idx = Number(input.dataset.poseFileIndex);
      if (input.files[0]) {
        poseFiles[p][idx] = input.files[0];
        renderPoseGrid(p, count);
      }
    };
  });
}

async function submitCheckin(tmpl) {
  const statusEl = document.getElementById("checkin-status");
  const videoInput = document.getElementById("checkin-video");
  if (tmpl.requireVideo && (!videoInput || !videoInput.files[0])) {
    showStatus(statusEl, "This check-in requires a form-check video.", "error");
    return;
  }

  const posing = tmpl.posing || { front: 0, side: 0, back: 0 };
  for (const pose of ["front", "side", "back"]) {
    const required = posing[pose] || 0;
    const filled = (poseFiles[pose] || []).filter(Boolean).length;
    if (filled !== required) {
      showStatus(statusEl, `Add all ${required} ${pose} photo${required === 1 ? "" : "s"}.`, "error");
      return;
    }
  }

  const answers = tmpl.fields.map((f) => ({ id: f.id, label: f.label, value: checkinAnswers[f.id] || (f.kind === "scale" ? "5" : "") }));

  const formData = new FormData();
  formData.append("title", tmpl.title);
  formData.append("weight", document.getElementById("checkin-weight").value);
  formData.append("answers", JSON.stringify(answers));
  if (videoInput && videoInput.files[0]) formData.append("video", videoInput.files[0]);

  const photoMeta = [];
  for (const pose of ["front", "side", "back"]) {
    (poseFiles[pose] || []).forEach((file) => {
      formData.append("photos", file);
      photoMeta.push({ pose });
    });
  }
  formData.append("photoMeta", JSON.stringify(photoMeta));

  try {
    await api("/checkins/submissions", { method: "POST", body: formData });
    showStatus(statusEl, "Check-in submitted!", "info");
    checkinAnswers = {};
    poseFiles = { front: [], side: [], back: [] };
    renderCheckinForm(tmpl);
  } catch (err) {
    showStatus(statusEl, err.message, "error");
  }
}

// ---------------- Messages ----------------

async function loadMessages() {
  const card = document.getElementById("messages-card");
  if (!MY_COACH) {
    card.innerHTML = `<p class="hint">Connect with a coach first (see "Find a Coach").</p>`;
    return;
  }
  card.innerHTML = `
    <div style="font-weight:700; margin-bottom:8px;">${escapeHtml(MY_COACH.name)}</div>
    <div class="msg-thread" id="msg-thread"></div>
    <div class="msg-compose">
      <input type="text" id="msg-input" placeholder="Message..." />
      <button id="msg-send-btn" class="small-btn" style="margin-top:0;">Send</button>
    </div>
  `;
  await renderThread();
  document.getElementById("msg-send-btn").onclick = sendMessage;
  document.getElementById("msg-input").onkeydown = (e) => { if (e.key === "Enter") sendMessage(); };
}

async function renderThread() {
  const { messages } = await api(`/messages/${MY_COACH.id}`);
  const threadEl = document.getElementById("msg-thread");
  if (!threadEl) return;
  threadEl.innerHTML = messages.length
    ? messages.map((m) => `<div class="bubble ${m.from === ME.id ? "me" : "them"}">${escapeHtml(m.text)}</div>`).join("")
    : `<div class="hint" style="text-align:center;">Say hello 👋</div>`;
  threadEl.scrollTop = threadEl.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById("msg-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  await api(`/messages/${MY_COACH.id}`, { method: "POST", body: JSON.stringify({ text }) });
  renderThread();
}

// ---------------- Find a Coach ----------------

async function loadFind() {
  const { ads } = await api("/ads");
  const listEl = document.getElementById("find-list");
  listEl.innerHTML = ads.length
    ? ads.map((ad) => adCardHtml(ad)).join("")
    : `<div class="card hint">No coach ads yet — check back soon.</div>`;
  listEl.querySelectorAll("[data-connect]").forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api("/connect", { method: "POST", body: JSON.stringify({ coachId: btn.dataset.connect }) });
        btn.textContent = "Request sent";
        const { coach } = await api("/my-coach");
        MY_COACH = coach;
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    };
  });
  listEl.querySelectorAll("[data-view-profile]").forEach((el) => {
    el.onclick = () => openCoachProfile(el.dataset.viewProfile, el.dataset.name, el.dataset.username);
  });
}

function adMediaHtml(ad) {
  if (!ad.mediaFile) return escapeHtml(ad.mediaNote || "Coaching highlights");
  const url = `/media/ads/${encodeURIComponent(ad.mediaFile)}`;
  return ad.mediaType === "video"
    ? `<video src="${url}" controls style="width:100%; height:100%; object-fit:cover;"></video>`
    : `<img src="${url}" style="width:100%; height:100%; object-fit:cover;" />`;
}

function starDisplayHtml(avgRating, count) {
  if (avgRating == null) return `<span class="hint">No reviews yet</span>`;
  const filled = Math.round(avgRating);
  return `<span class="star-display">${"★".repeat(filled)}${"☆".repeat(5 - filled)}</span> <span class="hint">${avgRating} (${count})</span>`;
}

function adCardHtml(ad) {
  return `
    <div class="card ad-card">
      <div class="ad-head" data-view-profile="${ad.coachId}" data-name="${escapeHtml(ad.coachName)}" data-username="${escapeHtml(ad.coachUsername || "")}" style="cursor:pointer;">
        <div class="ad-avatar">${escapeHtml((ad.coachName || "?").slice(0, 2).toUpperCase())}</div>
        <div style="flex:1;">
          <div style="font-weight:700;">${escapeHtml(ad.coachName)}</div>
          <div style="margin-top:2px;">${starDisplayHtml(ad.avgRating, ad.reviewCount)}</div>
        </div>
        <span class="pill" style="background:var(--surface-2);">Sponsored</span>
      </div>
      <div class="ad-media">${adMediaHtml(ad)}</div>
      <div class="ad-body">
        <div class="flex-row" style="justify-content:space-between;">
          <span class="pill ${ad.atCap ? "" : "ok"}">${ad.atCap ? "Fully booked" : ad.spotsLeft == null ? "Open" : `${ad.spotsLeft} spot${ad.spotsLeft === 1 ? "" : "s"} open`}</span>
        </div>
        <div style="margin-top:8px; font-size:14px;"><b>@${escapeHtml(ad.coachUsername || "coach")}</b> ${escapeHtml(ad.caption)}</div>
        ${ad.atCap
          ? `<button class="secondary" disabled style="width:100%;">Fully booked</button>`
          : `<button data-connect="${ad.coachId}" style="width:100%;">Request to connect</button>`}
      </div>
    </div>
  `;
}

// ---------------- Pay My Coach ----------------

async function loadPay() {
  const card = document.getElementById("pay-card");
  if (!MY_COACH) {
    card.innerHTML = `<p class="hint">Connect with a coach first (see "Find a Coach") before paying.</p>`;
    return;
  }
  const { plans } = await api(`/payments/plans/${ME.id}`);
  const STATUS_PILL = { pending: ["Payment due", ""], paid: ["Paid", "ok"], active: ["Active", "ok"], cancelled: ["Cancelled", ""] };

  card.innerHTML = `
    <div class="hint">YOUR COACH</div>
    <div style="font-size:18px; font-weight:800; margin-top:4px;">${escapeHtml(MY_COACH.name)}</div>

    ${plans.length ? `<div class="hint" style="margin-top:16px;">PAYMENT PLANS FROM YOUR COACH</div>` : ""}
    ${[...plans].reverse().map((p) => {
      const [label, cls] = STATUS_PILL[p.status] || [p.status, ""];
      return `
        <div class="card" style="margin-top:8px;">
          <div class="flex-row" style="justify-content:space-between;">
            <span class="pill ${cls}" style="${cls ? "" : "background:var(--surface-2);"}">${label}</span>
            <span class="hint">${fmtDate(p.createdAt)}</span>
          </div>
          <div style="font-weight:800; font-size:18px; margin-top:6px;">$${p.amountUsd}${p.mode === "subscription" ? "/mo" : ""}</div>
          ${p.description ? `<div class="hint">${escapeHtml(p.description)}</div>` : ""}
          ${p.status === "pending" ? `<button type="button" data-pay-plan="${p.id}" style="width:100%; margin-top:8px;">Pay $${p.amountUsd}${p.mode === "subscription" ? "/mo" : ""}</button>` : ""}
        </div>
      `;
    }).join("")}

    <div class="hint" style="margin-top:16px;">Anything else to pay for?</div>
    <a class="button secondary" href="/pay.html?coachId=${encodeURIComponent(MY_COACH.id)}&name=${encodeURIComponent(MY_COACH.name)}">Pay a custom amount</a>
  `;

  card.querySelectorAll("[data-pay-plan]").forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      const plan = plans.find((p) => p.id === btn.dataset.payPlan);
      try {
        const { url } = await api("/payments/checkout", {
          method: "POST",
          body: JSON.stringify({ coachId: MY_COACH.id, amountUsd: plan.amountUsd, mode: plan.mode, description: plan.description, planId: plan.id }),
        });
        window.location.href = url;
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    };
  });
}

// ---------------- Coach profile modal (reviews) ----------------

function setupCoachProfileModal() {
  const overlay = document.createElement("div");
  overlay.id = "coach-profile-overlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal-card"><button type="button" class="modal-close" id="coach-profile-close">&times;</button><div id="coach-profile-body"></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeCoachProfile(); });
  document.getElementById("coach-profile-close").onclick = closeCoachProfile;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCoachProfile(); });
}

function closeCoachProfile() {
  document.getElementById("coach-profile-overlay").classList.remove("open");
}

let profileDraftStars = 0;

async function openCoachProfile(coachId, fallbackName, fallbackUsername) {
  const body = document.getElementById("coach-profile-body");
  body.innerHTML = `<p class="hint">Loading...</p>`;
  document.getElementById("coach-profile-overlay").classList.add("open");

  const isMyCoach = MY_COACH && MY_COACH.id === coachId;
  const [{ user: coach }, { reviews, average, count }, mine] = await Promise.all([
    api(`/users/${coachId}`).catch(() => ({ user: { name: fallbackName, username: fallbackUsername, bio: "" } })),
    api(`/reviews/${coachId}`),
    isMyCoach ? api(`/reviews/${coachId}/mine`).catch(() => ({ review: null })) : Promise.resolve({ review: null }),
  ]);

  profileDraftStars = mine.review ? mine.review.stars : 0;
  renderCoachProfileBody(coachId, coach, reviews, average, count, isMyCoach, mine.review);
}

function renderCoachProfileBody(coachId, coach, reviews, average, count, isMyCoach, myReview) {
  const body = document.getElementById("coach-profile-body");
  body.innerHTML = `
    <div style="font-size:20px; font-weight:800;">${escapeHtml(coach.name)}</div>
    <div class="hint">@${escapeHtml(coach.username || "coach")}</div>
    ${coach.bio ? `<div class="hint" style="margin-top:8px;">${escapeHtml(coach.bio)}</div>` : ""}
    <div style="margin-top:10px;">${starDisplayHtml(average, count)}</div>

    ${isMyCoach ? `
      <div class="card" style="margin-top:14px; background:var(--surface-2);">
        <div style="font-weight:700; margin-bottom:6px;">${myReview ? "Edit your review" : "Leave a review"}</div>
        <div class="star-row" id="profile-star-picker"></div>
        <textarea id="profile-review-comment" rows="3" style="width:100%; box-sizing:border-box; margin-top:8px; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--text);" placeholder="How's your experience been?">${escapeHtml(myReview?.comment || "")}</textarea>
        <button type="button" id="profile-review-submit" style="margin-top:8px;">Submit review</button>
        <div class="status" id="profile-review-status"></div>
      </div>
    ` : ""}

    <div class="hint" style="margin-top:16px;">REVIEWS ${count ? `(${count})` : ""}</div>
    ${reviews.length ? reviews.map((r) => `
      <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
        <div class="flex-row" style="justify-content:space-between;">
          <span class="star-display">${"★".repeat(r.stars)}${"☆".repeat(5 - r.stars)}</span>
          <span class="hint">${fmtDate(r.createdAt)}</span>
        </div>
        <div style="font-weight:700; margin-top:2px;">${escapeHtml(r.clientName)}</div>
        ${r.comment ? `<div class="hint" style="margin-top:2px;">${escapeHtml(r.comment)}</div>` : ""}
      </div>
    `).join("") : `<div class="hint" style="margin-top:8px;">No reviews yet.</div>`}
  `;

  if (isMyCoach) {
    renderProfileStarPicker();
    document.getElementById("profile-review-submit").onclick = async () => {
      const statusEl = document.getElementById("profile-review-status");
      const comment = document.getElementById("profile-review-comment").value;
      try {
        const result = await api("/reviews", { method: "POST", body: JSON.stringify({ coachId, stars: profileDraftStars, comment }) });
        showStatus(statusEl, "Thanks for the review!", "info");
        renderCoachProfileBody(coachId, coach, result.reviews, result.average, result.count, true, result.reviews.find((r) => r.clientName === ME.name) || { stars: profileDraftStars, comment });
      } catch (err) {
        showStatus(statusEl, err.message, "error");
      }
    };
  }
}

function renderProfileStarPicker() {
  const el = document.getElementById("profile-star-picker");
  el.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="star-btn ${n <= profileDraftStars ? "filled" : ""}" data-star="${n}">★</button>`).join("");
  el.querySelectorAll("[data-star]").forEach((btn) => {
    btn.onclick = () => {
      const n = Number(btn.dataset.star);
      profileDraftStars = profileDraftStars === n ? n - 1 : n;
      renderProfileStarPicker();
    };
  });
}
