// Native iPhone/iPad features for the Gainline iOS app (a Capacitor shell
// that loads this site). Capacitor injects window.Capacitor into the page
// when it's running inside the app; in a normal browser none of this runs
// and GainlineNative.isApp is false, so every page works exactly as before.
//
// Plugins are called through Capacitor.nativePromise(plugin, method, opts)
// directly, since this site has no bundler to import @capacitor/* packages.
// The plugins themselves are installed in mobile/package.json.
//
// Features: Apple Health (weight, steps, active calories, heart rate),
// Face ID login (credentials kept in the iOS Keychain), local reminders
// before calendar sessions, native camera for check-in photos, the native
// share sheet for invite links, and haptic feedback.
(function () {
  const cap = window.Capacitor;
  const isApp = !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
  const KEYCHAIN_SERVER = "gainlineapp.online";
  const LBS_PER_KG = 2.20462;
  const DAY_MS = 24 * 60 * 60 * 1000;

  function hasPlugin(name) {
    return isApp && Array.isArray(cap.PluginHeaders) && cap.PluginHeaders.some((h) => h.name === name);
  }
  function call(plugin, method, options) {
    return cap.nativePromise(plugin, method, options || {});
  }

  // Per-device preferences. localStorage persists inside the app's web view;
  // wrapped because storage can throw in some private/locked-down contexts.
  const prefs = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} },
    remove(key) { try { localStorage.removeItem(key); } catch {} },
  };

  // ---- Haptics ---------------------------------------------------------------

  function haptic(kind) {
    if (!hasPlugin("Haptics")) return;
    const req = kind === "success" ? call("Haptics", "notification", { type: "SUCCESS" }) : call("Haptics", "impact", { style: "LIGHT" });
    req.catch(() => {});
  }

  // ---- Face ID login ---------------------------------------------------------

  async function biometryLabel() {
    if (!hasPlugin("NativeBiometric")) return null;
    try {
      const r = await call("NativeBiometric", "isAvailable", {});
      if (!r.isAvailable) return null;
      return r.biometryType === 1 ? "Touch ID" : r.biometryType === 2 ? "Face ID" : "Face ID / Touch ID";
    } catch {
      return null;
    }
  }

  function hasSavedLogin() {
    return prefs.get("gl_biometric_login") === "1";
  }

  async function saveLogin(username, password) {
    await call("NativeBiometric", "setCredentials", { username, password, server: KEYCHAIN_SERVER });
    prefs.set("gl_biometric_login", "1");
  }

  async function forgetLogin() {
    prefs.remove("gl_biometric_login");
    if (hasPlugin("NativeBiometric")) await call("NativeBiometric", "deleteCredentials", { server: KEYCHAIN_SERVER }).catch(() => {});
  }

  // Asks for Face ID, then returns the Keychain-stored credentials.
  async function unlockSavedLogin() {
    await call("NativeBiometric", "verifyIdentity", { reason: "Log in to Gainline", title: "Log in to Gainline" });
    return call("NativeBiometric", "getCredentials", { server: KEYCHAIN_SERVER });
  }

  // Called by login.html after a successful password login.
  async function offerBiometricLogin(username, password) {
    if (hasSavedLogin() || prefs.get("gl_biometric_declined") === "1") return;
    const label = await biometryLabel();
    if (!label) return;
    if (confirm(`Use ${label} to log in next time?`)) {
      await saveLogin(username, password).catch(() => {});
    } else {
      prefs.set("gl_biometric_declined", "1");
    }
  }

  // ---- Apple Health ----------------------------------------------------------

  const HEALTH_READ = ["weight", "steps", "calories", "heartRate"];

  async function healthAvailable() {
    if (!hasPlugin("Health")) return false;
    try {
      return !!(await call("Health", "isAvailable", {})).available;
    } catch {
      return false;
    }
  }

  function healthConnected() {
    return prefs.get("gl_health") === "1";
  }

  async function connectHealth() {
    await call("Health", "requestAuthorization", { read: HEALTH_READ, write: ["weight"] });
    prefs.set("gl_health", "1");
  }

  function readSamples(dataType, days, limit) {
    return call("Health", "readSamples", {
      dataType,
      startDate: new Date(Date.now() - days * DAY_MS).toISOString(),
      endDate: new Date().toISOString(),
      limit,
    }).then((r) => r.samples || []);
  }

  async function latestWeightLbs() {
    const samples = await readSamples("weight", 90, 50);
    if (!samples.length) return null;
    const latest = samples.reduce((a, b) => (new Date(b.endDate) > new Date(a.endDate) ? b : a));
    return Math.round(latest.value * LBS_PER_KG * 10) / 10;
  }

  // Daily totals for a cumulative metric (steps, active calories). An iPhone
  // and an Apple Watch both log steps for the same walk, so summing every
  // sample double-counts — per day, keep only the source with the highest
  // total, which is close to what the Health app itself shows.
  function dailyAverage(samples, days) {
    const byDay = {};
    for (const s of samples) {
      const day = new Date(s.startDate).toDateString();
      const src = s.sourceId || s.sourceName || "unknown";
      byDay[day] = byDay[day] || {};
      byDay[day][src] = (byDay[day][src] || 0) + (Number(s.value) || 0);
    }
    const totals = Object.values(byDay).map((bySource) => Math.max(...Object.values(bySource)));
    if (!totals.length) return null;
    return Math.round(totals.reduce((a, b) => a + b, 0) / days);
  }

  // Last 7 days, shown on the client's Home tab and attached to check-ins.
  async function weeklySummary() {
    const [steps, calories, heartRate, weightLbs] = await Promise.all([
      readSamples("steps", 7, 5000).catch(() => []),
      readSamples("calories", 7, 5000).catch(() => []),
      readSamples("heartRate", 7, 2000).catch(() => []),
      latestWeightLbs().catch(() => null),
    ]);
    const avgHeartRate = heartRate.length ? Math.round(heartRate.reduce((a, s) => a + (Number(s.value) || 0), 0) / heartRate.length) : null;
    return {
      avgSteps: dailyAverage(steps, 7),
      avgActiveCalories: dailyAverage(calories, 7),
      avgHeartRate,
      latestWeightLbs: weightLbs,
    };
  }

  async function saveWeightToHealth(weightText) {
    const m = String(weightText || "").match(/(\d+(?:\.\d+)?)\s*(kg|kgs|kilo|kilos)?/i);
    if (!m) return;
    const value = Number(m[1]);
    const kg = m[2] ? value : value / LBS_PER_KG;
    if (!(kg > 20 && kg < 400)) return;
    await call("Health", "saveSample", { dataType: "weight", value: Math.round(kg * 100) / 100 });
  }

  function healthSummaryHtml(summary) {
    const parts = [];
    if (summary.avgSteps != null) parts.push(`<div class="stat"><div class="stat-num">${summary.avgSteps.toLocaleString()}</div><div class="hint">steps / day</div></div>`);
    if (summary.avgActiveCalories != null) parts.push(`<div class="stat"><div class="stat-num">${summary.avgActiveCalories.toLocaleString()}</div><div class="hint">active cal / day</div></div>`);
    if (summary.avgHeartRate != null) parts.push(`<div class="stat"><div class="stat-num">${summary.avgHeartRate}</div><div class="hint">avg heart rate</div></div>`);
    if (summary.latestWeightLbs != null) parts.push(`<div class="stat"><div class="stat-num">${summary.latestWeightLbs}</div><div class="hint">lbs (latest)</div></div>`);
    return parts.length
      ? `<div class="native-stats">${parts.join("")}</div>`
      : `<p class="hint">No Apple Health data from the last 7 days yet. If you've turned access off, you can turn it back on in the Health app → Sharing → Apps → Gainline.</p>`;
  }

  // Client Home tab card: connect prompt, or this week's numbers.
  async function renderHealthCard(el) {
    if (!el || !(await healthAvailable())) return;
    el.style.display = "block";
    if (!healthConnected()) {
      el.innerHTML = `
        <div class="hint">APPLE HEALTH</div>
        <p style="margin:6px 0 10px;">Connect Apple Health to fill in your weight automatically and share your weekly steps, active calories, and heart rate with your coach in each check-in.</p>
        <button type="button" class="small-btn" data-connect-health>Connect Apple Health</button>
        <div class="status" data-health-status></div>`;
      el.querySelector("[data-connect-health]").onclick = async () => {
        try {
          await connectHealth();
          haptic("success");
          renderHealthCard(el);
        } catch (err) {
          showStatus(el.querySelector("[data-health-status]"), err.message || "Couldn't connect to Apple Health.", "error");
        }
      };
      return;
    }
    el.innerHTML = `<div class="hint">YOUR WEEK · APPLE HEALTH</div><p class="hint">Loading…</p>`;
    try {
      const summary = await weeklySummary();
      el.innerHTML = `<div class="hint">YOUR WEEK · APPLE HEALTH</div>${healthSummaryHtml(summary)}`;
    } catch {
      el.innerHTML = `<div class="hint">YOUR WEEK · APPLE HEALTH</div><p class="hint">Couldn't read Apple Health right now.</p>`;
    }
  }

  // ---- Session reminders (local notifications) -------------------------------

  function remindersOn() {
    return prefs.get("gl_reminders") === "1";
  }

  async function enableReminders(role) {
    const perm = await call("LocalNotifications", "requestPermissions", {});
    if (perm.display !== "granted") {
      throw new Error("Notifications are off for Gainline — turn them on in the iPhone Settings app → Gainline → Notifications.");
    }
    prefs.set("gl_reminders", "1");
    await syncReminders(role);
  }

  async function clearReminders() {
    const { notifications } = await call("LocalNotifications", "getPending", {});
    if (notifications && notifications.length) {
      await call("LocalNotifications", "cancel", { notifications: notifications.map((n) => ({ id: n.id })) });
    }
  }

  async function disableReminders() {
    prefs.remove("gl_reminders");
    if (hasPlugin("LocalNotifications")) await clearReminders().catch(() => {});
  }

  // Re-schedules a reminder one hour before each session in the next two
  // weeks. Run on every dashboard load so added/removed sessions stay in sync.
  async function syncReminders(role) {
    if (!remindersOn() || !hasPlugin("LocalNotifications")) return;
    const now = Date.now();
    const { occurrences } = await api(`/calendar/events?from=${new Date(now).toISOString()}&to=${new Date(now + 14 * DAY_MS).toISOString()}`);
    await clearReminders();
    const notifications = occurrences
      .filter((o) => o.occursAt - 60 * 60 * 1000 > now)
      .slice(0, 60) // iOS keeps at most 64 pending local notifications per app
      .map((o, i) => {
        const time = new Date(o.occursAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const what = o.title ? `${o.typeLabel}: ${o.title}` : o.typeLabel;
        return {
          id: i + 1,
          title: "Session in 1 hour",
          body: `${what} ${role === "coach" ? `with ${o.clientName}` : "with your coach"} at ${time}`,
          schedule: { at: new Date(o.occursAt - 60 * 60 * 1000), allowWhileIdle: true },
        };
      });
    if (notifications.length) await call("LocalNotifications", "schedule", { notifications });
  }

  // ---- Camera ----------------------------------------------------------------

  function canUseCamera() {
    return hasPlugin("Camera");
  }

  // Opens the native "Take Photo / Choose from Library" sheet and returns a
  // File ready to append to FormData, or null if the user cancelled.
  async function pickPhoto() {
    let photo;
    try {
      photo = await call("Camera", "getPhoto", {
        quality: 85,
        width: 1600,
        resultType: "base64",
        source: "PROMPT",
        correctOrientation: true,
        promptLabelHeader: "Progress photo",
        promptLabelPhoto: "Choose from Library",
        promptLabelPicture: "Take Photo",
      });
    } catch (err) {
      if (/cancel/i.test(err?.message || "")) return null;
      throw err;
    }
    const format = (photo.format || "jpeg").toLowerCase() === "png" ? "png" : "jpeg";
    const bin = atob(photo.base64String);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], `photo-${Date.now()}.${format === "png" ? "png" : "jpg"}`, { type: `image/${format}` });
  }

  // ---- Share sheet -----------------------------------------------------------

  function canShare() {
    return hasPlugin("Share");
  }

  async function share({ title, text, url }) {
    try {
      await call("Share", "share", { title, text, url, dialogTitle: title });
    } catch (err) {
      if (!/cancel/i.test(err?.message || "")) throw err;
    }
  }

  // ---- App settings modal (footer link, app only) ----------------------------

  async function openSettings(me) {
    const [bioLabel, healthOk] = await Promise.all([biometryLabel(), me.role === "client" ? healthAvailable() : false]);
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay open";
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.hasAttribute("data-close")) close();
    });

    const render = () => {
      const rows = [];
      if (bioLabel) {
        rows.push(`
          <div class="native-setting">
            <div><b>${bioLabel} login</b><div class="hint">Log in without typing your password.</div></div>
            <button type="button" class="small-btn ${hasSavedLogin() ? "secondary" : ""}" data-toggle="bio">${hasSavedLogin() ? "Turn off" : "Turn on"}</button>
          </div>
          <div data-bio-form style="display:none; margin-top:8px;">
            <label for="native-bio-password">Enter your password to turn on ${bioLabel}</label>
            <input type="password" id="native-bio-password" autocomplete="current-password" />
            <button type="button" class="small-btn" data-bio-save style="margin-top:8px;">Save</button>
          </div>`);
      }
      if (hasPlugin("LocalNotifications")) {
        rows.push(`
          <div class="native-setting">
            <div><b>Session reminders</b><div class="hint">A notification 1 hour before each scheduled session.</div></div>
            <button type="button" class="small-btn ${remindersOn() ? "secondary" : ""}" data-toggle="reminders">${remindersOn() ? "Turn off" : "Turn on"}</button>
          </div>`);
      }
      if (healthOk) {
        rows.push(`
          <div class="native-setting">
            <div><b>Apple Health</b><div class="hint">${healthConnected() ? "Connected. Manage access in the Health app → Sharing → Apps → Gainline." : "Share weight, steps, active calories, and heart rate with your check-ins."}</div></div>
            ${healthConnected() ? `<span class="pill ok">Connected</span>` : `<button type="button" class="small-btn" data-toggle="health">Connect</button>`}
          </div>`);
      }
      overlay.innerHTML = `
        <div class="modal-card">
          <button type="button" class="modal-close" data-close>&times;</button>
          <h2 style="margin-top:0;">App settings</h2>
          ${rows.join("") || `<p class="hint">No device features are available on this device.</p>`}
          <div class="status" data-settings-status></div>
        </div>`;
      const statusEl = overlay.querySelector("[data-settings-status]");
      const fail = (err) => showStatus(statusEl, err.message || "Something went wrong.", "error");

      overlay.querySelector('[data-toggle="bio"]')?.addEventListener("click", async () => {
        if (hasSavedLogin()) {
          await forgetLogin();
          render();
        } else {
          overlay.querySelector("[data-bio-form]").style.display = "block";
          overlay.querySelector("#native-bio-password").focus();
        }
      });
      overlay.querySelector("[data-bio-save]")?.addEventListener("click", async () => {
        const password = overlay.querySelector("#native-bio-password").value;
        if (!password) return showStatus(statusEl, "Enter your password first.", "error");
        try {
          // Confirms the password is right before it goes in the Keychain.
          await api("/auth/login", { method: "POST", body: JSON.stringify({ username: me.username, password }) });
          await saveLogin(me.username, password);
          haptic("success");
          render();
        } catch (err) {
          fail(err);
        }
      });
      overlay.querySelector('[data-toggle="reminders"]')?.addEventListener("click", async () => {
        try {
          if (remindersOn()) await disableReminders();
          else await enableReminders(me.role);
          haptic("success");
          render();
        } catch (err) {
          fail(err);
        }
      });
      overlay.querySelector('[data-toggle="health"]')?.addEventListener("click", async () => {
        try {
          await connectHealth();
          haptic("success");
          render();
          document.dispatchEvent(new CustomEvent("gainline:health-connected"));
        } catch (err) {
          fail(err);
        }
      });
    };
    render();
  }

  // Adds the "App settings" link to the dashboard footer and keeps session
  // reminders in sync. Called once the dashboard knows who's logged in.
  function setupDashboard(me) {
    if (!isApp) return;
    const footer = document.querySelector(".site-footer");
    if (footer && !footer.querySelector("[data-app-settings]")) {
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = "App settings";
      link.setAttribute("data-app-settings", "");
      link.addEventListener("click", (e) => {
        e.preventDefault();
        openSettings(me);
      });
      footer.insertBefore(link, footer.children[1] || null);
    }
    syncReminders(me.role).catch(() => {});
  }

  window.GainlineNative = {
    isApp,
    haptic,
    biometryLabel,
    hasSavedLogin,
    unlockSavedLogin,
    offerBiometricLogin,
    forgetLogin,
    healthAvailable,
    healthConnected,
    connectHealth,
    latestWeightLbs,
    weeklySummary,
    saveWeightToHealth,
    healthSummaryHtml,
    renderHealthCard,
    syncReminders,
    canUseCamera,
    pickPhoto,
    canShare,
    share,
    setupDashboard,
  };
})();
